/**
 * Real backend implementation of the Api interface, following docs/api.md.
 * This is the only file that knows a route or a wire shape: it maps the backend's
 * snake_case rows onto the shapes in types.ts that the UI reads.
 *
 * The browser calls the backend directly with its httpOnly `merit_session` cookie
 * (credentials: "include"). It never sees a token or asserts a role.
 *
 * GitHub display metadata accompanies immutable ids. Only the ids are used for identity checks.
 */
import {
  ApiError,
  type Address,
  type Api,
  type ApiErrorCode,
  type Approval,
  type Bounty,
  type ChainEvent,
  type GithubUser,
  type Hex,
  type PullRequest,
  type ReviewCandidate,
  type TxRef,
  type QualificationEvidence,
} from "@/lib/api/types";
import { recordedDepositHash } from "@/lib/chain/deposit-store";
import { BACKEND_URL } from "@/lib/env";

/* ------------------------------------------------------------------ wire shapes (docs/api.md) */

interface WUser { id: number; login?: string; avatar_url?: string }
interface WBounty {
  id: number;
  onchain_bounty_id: string | null;
  status: Bounty["status"];
  amount_units: string;
  funder_wallet: Address | null;
  deadline: string;
  created_at: string;
  pr: { github_pr_number: number; head_sha: string; status: "open" | "closed" | "merged"; author_github_id: number; title?: string; author?: WUser };
  repo: { github_repo_id: number; name: string; maintainer_github_id: number; maintainer?: WUser };
  description?: string | null;
  language?: string | null;
  candidates?: WCandidate[];
  approvals?: WApproval[];
  events?: WEvent[];
}
interface WCandidate {
  id: number;
  github_comment_id: number;
  github_reviewer_id: number;
  file_path: string;
  diff_hunk: string;
  thread_resolved: boolean;
  status: "pending" | "candidate" | "confirmed" | "rejected";
  reviewer?: WUser;
  qualification_evidence: { method: "heuristic" | "manual"; limitations: string; file_touched?: string;
    reviewer?: WUser; comment_body?: string; commented_at?: string; line?: number;
    compared_head?: string; later_commit_touched?: boolean | null; checked_at?: string;
    resolved_at?: string; check_reason?: QualificationEvidence["checkReason"] };
  reviewer_wallet: Address | null;
  created_at: string;
}
interface WApproval {
  id: number;
  candidate_id: number;
  reviewer_id: number;
  approver_github_id: number;
  amount_units: string;
  approved_recipient: Address;
  claim_id: Hex;
  chain_tx_hash: Hex | null;
  status: "prepared" | "signed" | "paid";
  created_at: string;
  reviewer?: WUser;
  approver?: WUser;
}
interface WEvent {
  chain_id: number;
  contract: Address;
  tx_hash: Hex;
  log_index: number;
  block_number: number;
  event_type: ChainEvent["eventType"];
  payload: Record<string, string>;
  ingestion_timestamp: string;
}
interface WMe {
  github_user_id: number;
  login: string;
  wallet: { address: Address; verified_at: string } | null;
  maintains: { github_repo_id: number; name: string }[];
  as_reviewer: { candidate: WCandidate; bounty: WBounty; approval: WApproval | null }[];
}

/* ------------------------------------------------------------------ transport */

const CODE_BY_STATUS: Record<number, ApiErrorCode> = {
  400: "validation",
  401: "unauthenticated",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
};

async function request<T>(path: string, init?: { method?: "GET" | "POST"; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BACKEND_URL}${path}`, {
      method: init?.method ?? "GET",
      credentials: "include",
      headers: init?.body ? { "content-type": "application/json" } : undefined,
      body: init?.body ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new ApiError("network", "Couldn't reach the Merit API. Check your connection and try again.");
  }
  if (!res.ok) {
    let message = `The Merit API returned ${res.status}.`;
    try {
      message = ((await res.json()) as { error?: string }).error ?? message;
    } catch {
      /* non-JSON error body: keep the default message */
    }
    throw new ApiError(CODE_BY_STATUS[res.status] ?? "network", message);
  }
  return (res.status === 204 ? null : await res.json()) as T;
}

const q = (params: Record<string, string | undefined>) => {
  const s = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1])).toString();
  return s ? `?${s}` : "";
};

/* ------------------------------------------------------------------ mapping */

const user = (id: number, login = `user ${id}`): GithubUser => ({
  id: String(id),
  login,
  avatarUrl: `https://avatars.githubusercontent.com/u/${id}`,
});
const identity = (value: WUser | undefined, id: number): GithubUser => ({
  ...user(id, value?.login), ...(value?.avatar_url ? { avatarUrl: value.avatar_url } : {}),
});

const toApproval = (a: WApproval): Approval => ({
  candidateId: String(a.candidate_id),
  reviewer: identity(a.reviewer, a.reviewer_id),
  approver: identity(a.approver, a.approver_github_id),
  amountUnits: a.amount_units,
  approvedRecipient: a.approved_recipient,
  claimId: a.claim_id,
  chainTxHash: a.chain_tx_hash,
  approvedAt: a.created_at,
});

/** The approval that counts: the signed or paid one if any, else the latest prepared. */
const pickApproval = (list: WApproval[] = []) => list.find((a) => a.status !== "prepared") ?? list.at(-1) ?? null;

function toCandidate(c: WCandidate, b: WBounty, approval: WApproval | null): ReviewCandidate {
  const ev = c.qualification_evidence;
  const touched = ev.later_commit_touched ?? (ev.file_touched ? true : null);
  const location = `${c.file_path}${ev.line ? `:${ev.line}` : ""}`;
  const reasons: Record<NonNullable<QualificationEvidence["checkReason"]>, string> = {
    waiting_for_commit: `Push a new commit to this pull request with a fix near ${location}.`,
    waiting_for_fix: `The later commits did not change code near ${location}. Push the relevant fix, then recheck.`,
    waiting_for_resolution: "A later change was found. Resolve the review thread on GitHub, then recheck.",
    github_unavailable: "GitHub could not be checked. This review is pending; recheck when GitHub is available.",
    missing_line: "GitHub did not provide enough line context to check this review automatically.",
    ready: "Ready for the maintainer to review.",
  };
  return {
    id: String(c.id),
    githubCommentId: String(c.github_comment_id),
    reviewer: identity(c.reviewer ?? ev.reviewer, c.github_reviewer_id),
    reviewerWallet: c.reviewer_wallet,
    filePath: c.file_path,
    diffHunk: c.diff_hunk,
    commentBody: ev.comment_body ?? "Open this review on GitHub, or recheck to load the original comment.",
    commentUrl: `https://github.com/${b.repo.name}/pull/${b.pr.github_pr_number}#discussion_r${c.github_comment_id}`,
    commentedAt: ev.commented_at ?? c.created_at,
    commitSha: touched ? ev.compared_head ?? null : null,
    evidence: {
      commentExists: true,
      laterCommitTouchedContext: touched,
      threadResolved: c.thread_resolved,
      note: ev.limitations,
      line: ev.line, method: ev.method, checkedAt: ev.checked_at, resolvedAt: ev.resolved_at, checkReason: ev.check_reason,
    },
    status:
      c.status === "rejected" ? "rejected"
      : approval?.candidate_id === c.id && approval.status !== "prepared" ? "approved"
      : c.status === "pending" ? "ineligible"
      : "candidate",
    ineligibleReason:
      c.status === "pending"
        ? ev.check_reason ? reasons[ev.check_reason] : !c.thread_resolved
          ? "Resolve the review thread after pushing a fix, then recheck GitHub."
          : "The fix has not been verified yet. Recheck GitHub to see what is missing."
        : undefined,
  };
}

const toEvent = (e: WEvent, bountyId?: string): ChainEvent => ({
  chainId: e.chain_id,
  contract: e.contract,
  txHash: e.tx_hash,
  logIndex: e.log_index,
  blockNumber: e.block_number,
  eventType: e.event_type,
  payload: e.payload,
  ingestionTimestamp: e.ingestion_timestamp,
  bountyId,
});

const CHAIN_KEY = { BountyFunded: "funded", RewardApproved: "approved", RewardPaid: "paid", BountyRefunded: "refunded" } as const;

/**
 * The backend calls a bounty `funding_pending` from the moment it is created and records no funding
 * hash. The UI only says "deposit sent" for a real transaction: the createBounty deposit is recorded in
 * this browser the moment it is broadcast (lib/chain/deposit-store.ts); without one the bounty is a
 * `draft` to fund. That record is per browser; see deposit-store.ts for the limit.
 */
const depositHash = (id: string | number) => recordedDepositHash(String(id));

function toBounty(b: WBounty): Bounty {
  const approval = pickApproval(b.approvals);
  const deposit = b.status === "funding_pending" ? depositHash(b.id) : null;
  const chain: Bounty["chain"] = {};
  for (const e of b.events ?? []) {
    const ref: TxRef = { txHash: e.tx_hash, blockNumber: e.block_number, logIndex: e.log_index, at: e.ingestion_timestamp };
    const key = CHAIN_KEY[e.event_type];
    if (key === "refunded") chain.refunded = { ...ref, amountUnits: e.payload.amount ?? "0" };
    else chain[key] = ref;
  }
  const repoId = String(b.repo.github_repo_id);
  return {
    id: String(b.id),
    onchainBountyId: b.onchain_bounty_id,
    repo: { id: repoId, githubRepoId: repoId, fullName: b.repo.name },
    pr: {
      repoId,
      number: b.pr.github_pr_number,
      title: b.pr.title ?? `Pull request #${b.pr.github_pr_number}`,
      author: identity(b.pr.author, b.pr.author_github_id),
      headSha: b.pr.head_sha,
      url: `https://github.com/${b.repo.name}/pull/${b.pr.github_pr_number}`,
      state: b.pr.status,
    },
    // The backend has no funder GitHub id; only the repository maintainer can create a bounty.
    funder: identity(b.repo.maintainer, b.repo.maintainer_github_id),
    funderWallet: b.funder_wallet,
    amountUnits: b.amount_units,
    deadline: b.deadline,
    status: b.status === "funding_pending" && !deposit ? "draft" : b.status,
    candidates: (b.candidates ?? []).map((c) => toCandidate(c, b, approval)),
    approval: approval && toApproval(approval),
    chain,
    pendingTxHash: deposit ?? (approval?.status === "signed" ? approval.chain_tx_hash : null),
    createdAt: b.created_at,
    repositoryDescription: b.description,
    language: b.language,
  };
}

const me = () => request<WMe>("/me");
const getBounty = async (id: string) => toBounty(await request<WBounty>(`/bounties/${id}`));

/** Who holds the session cookie, or null when nobody is signed in. Used by viewer.ts. */
export async function fetchViewer(): Promise<GithubUser | null> {
  try {
    const m = await me();
    return user(m.github_user_id, m.login);
  } catch (err) {
    if (err instanceof ApiError && err.code === "unauthenticated") return null;
    throw err;
  }
}

export const loginUrl = `${BACKEND_URL}/auth/github/login`;
export const logout = () => request<null>("/auth/logout", { method: "POST" });

/* ------------------------------------------------------------------ the Api */

export const httpApi: Api = {
  async listRepositories() {
    const m = await me();
    return m.maintains.map((r) => ({
      id: String(r.github_repo_id),
      githubRepoId: String(r.github_repo_id),
      fullName: r.name,
      installationId: "",
      maintainer: user(m.github_user_id, m.login),
    }));
  },

  // shortcut: the backend has no pull-request listing, so open PRs come from GitHub's public
  // API (public repos only, 60 requests/hour per IP). Upgrade when the backend adds a route.
  async listPullRequests(repoId) {
    const [repo, live] = await Promise.all([
      me().then((m) => m.maintains.find((r) => String(r.github_repo_id) === repoId)),
      request<{ bounties: WBounty[] }>("/bounties"),
    ]);
    if (!repo) return [];
    const res = await fetch(`https://api.github.com/repos/${repo.name}/pulls?state=open&per_page=50`).catch(() => null);
    if (!res?.ok) throw new ApiError("network", "Couldn't list pull requests from GitHub (private repository or rate limit).");
    const pulls = (await res.json()) as { number: number; title: string; html_url: string; head: { sha: string }; user: { id: number; login: string } }[];
    return pulls.map((p): PullRequest => ({
      repoId,
      number: p.number,
      title: p.title,
      author: user(p.user.id, p.user.login),
      headSha: p.head.sha,
      url: p.html_url,
      state: "open",
      bountyId: live.bounties.find(
        (b) => String(b.repo.github_repo_id) === repoId && b.pr.github_pr_number === p.number && !["paid", "refunded"].includes(b.status),
      )?.id.toString(),
    }));
  },

  async listBounties(scope) {
    const m = await me();
    if (scope === "funded-by-me") {
      const { bounties } = await request<{ bounties: WBounty[] }>("/bounties");
      return bounties.filter((b) => b.repo.maintainer_github_id === m.github_user_id).map(toBounty);
    }
    // One row per bounty, carrying this reviewer's candidates and their approval if there is one.
    const byId = new Map<number, WBounty>();
    for (const r of m.as_reviewer) {
      const b = byId.get(r.bounty.id) ?? { ...r.bounty, candidates: [], approvals: [] };
      b.candidates!.push(r.candidate);
      if (r.approval) b.approvals!.push(r.approval);
      byId.set(b.id, b);
    }
    return [...byId.values()].map(toBounty);
  },

  getBounty,

  async listOpenSource() {
    const { bounties } = await request<{ bounties: WBounty[] }>("/open-source");
    return bounties.map(toBounty);
  },

  async refreshBounty(id) {
    await request(`/bounties/${id}/refresh`, { method: "POST" });
    return getBounty(id);
  },

  async getReviewerProfile(id) {
    const r = await request<{ user: WUser; bounties: WBounty[] }>(`/reviewers/${encodeURIComponent(id)}`);
    return { user: identity(r.user, Number(id)), bounties: r.bounties.map(toBounty) };
  },

  async createBounty(input) {
    const { bounty } = await request<{ bounty: WBounty }>("/bounties", {
      method: "POST",
      body: {
        github_repo_id: Number(input.repoId),
        pr_number: input.prNumber,
        amount_units: input.amountUnits,
        expiry: Math.floor(new Date(input.deadline).getTime() / 1000),
      },
    });
    return toBounty(bounty);
  },

  // Only the BountyFunded event from Streams marks a bounty funded. The deposit itself is already recorded,
  // with its wallet and terms, by the funding hook at broadcast; this only refreshes the bounty.
  async reportFundingTx(id) {
    return getBounty(id);
  },

  async rejectCandidate(id, candidateId) {
    await request(`/candidates/${candidateId}/reject`, { method: "POST" });
    return getBounty(id);
  },

  async prepareApproval(id, candidateId, amountUnits) {
    const { tx } = await request<{ tx: { args: [string, Address, string, Hex] } }>(`/bounties/${id}/approvals`, {
      method: "POST",
      body: { candidate_id: Number(candidateId), amount_units: amountUnits },
    });
    const [onchainBountyId, recipient, amount, claimId] = tx.args;
    return { onchainBountyId, recipient, amountUnits: amount, claimId };
  },

  async reportApprovalTx(id, txHash) {
    const b = await request<WBounty>(`/bounties/${id}`);
    const prepared = b.approvals?.findLast((a) => a.status === "prepared");
    if (!prepared) throw new ApiError("not_found", "No prepared approval to attach this transaction to.");
    await request(`/approvals/${prepared.id}/tx`, { method: "POST", body: { tx_hash: txHash } });
    return getBounty(id);
  },

  async getWalletLink() {
    const m = await me();
    return m.wallet && { githubUserId: String(m.github_user_id), walletAddress: m.wallet.address, verifiedAt: m.wallet.verified_at };
  },

  // The backend's challenge is the whole message, with no separate nonce: it is carried in
  // `nonce` so verifyWalletLink can send back exactly what was signed.
  async createWalletChallenge() {
    const { message } = await request<{ message: string }>("/wallet/challenge");
    return { nonce: message, message };
  },

  async verifyWalletLink({ address, nonce, signature }) {
    const r = await request<{ wallet_address: Address; verified_at: string }>("/wallet/link", {
      method: "POST",
      body: { address, message: nonce, signature },
    });
    return { githubUserId: "", walletAddress: r.wallet_address, verifiedAt: r.verified_at };
  },

  async listEvents(filter) {
    const { events } = await request<{ events: WEvent[] }>(`/events${q({ bounty_id: filter?.bountyId, limit: "200" })}`);
    return {
      source: "quicknode-streams",
      lastIndexedBlock: events.length ? Math.max(...events.map((e) => e.block_number)) : null,
      lastDeliveryAt: events[0]?.ingestion_timestamp ?? null,
      events: events.map((e) => toEvent(e, filter?.bountyId)),
    };
  },
};
