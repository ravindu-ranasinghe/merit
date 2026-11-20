/** Mock implementation of the backend API, backed by the in-memory store. */
import { fakeHash } from "@/fixtures/seed";
import { ApiError, type Api, type Bounty } from "@/lib/api/types";
import { currentPersona, getDb, sleep } from "@/mock/store";

const LATENCY_MS = 220;

/** Hand back copies, like JSON over the wire, so React Query sees changes. */
const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/**
 * The clock overlay the real backend applies at read time (backend/src/streams/project.ts): a bounty the chain
 * says is funded, with no approval, becomes "expired" once its deadline passes. Chain states (claimable, paid,
 * refunded) and pending approvals are never overridden. Status only moves forward.
 */
const CLOCK_EXPIRES: Bounty["status"][] = ["funded", "review_candidate", "rejected"];
function applyClock(b: Bounty): Bounty {
  if (CLOCK_EXPIRES.includes(b.status) && !b.approval && new Date(b.deadline).getTime() <= Date.now()) b.status = "expired";
  return b;
}

function find(id: string): Bounty {
  const b = getDb().bounties.find((x) => x.id === id);
  if (!b) throw new ApiError("not_found", "This bounty does not exist.");
  return applyClock(b);
}

export const mockApi: Api = {
  async listRepositories() {
    await sleep(LATENCY_MS);
    const me = currentPersona().user.id;
    return copy(getDb().repositories.filter((r) => r.maintainer.id === me));
  },

  async listPullRequests(repoId) {
    await sleep(LATENCY_MS);
    return copy(getDb().pullRequests.filter((p) => p.repoId === repoId && p.state === "open"));
  },

  async listBounties(scope) {
    await sleep(LATENCY_MS);
    const me = currentPersona().user.id;
    const all = getDb().bounties.map(applyClock);
    const mine =
      scope === "funded-by-me"
        ? all.filter((b) => b.funder.id === me)
        : all.filter((b) => b.candidates.some((c) => c.reviewer.id === me));
    return copy([...mine].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  },

  async getBounty(id) {
    await sleep(LATENCY_MS);
    return copy(find(id));
  },

  async listOpenSource() {
    await sleep(LATENCY_MS);
    return copy(getDb().bounties.filter((b) => b.onchainBountyId && ["funded", "review_candidate"].includes(b.status)
      && b.pr.state === "open" && new Date(b.deadline).getTime() > Date.now()));
  },

  async refreshBounty(id) {
    await sleep(LATENCY_MS);
    const b = find(id);
    for (const c of b.candidates) c.evidence.checkedAt = new Date().toISOString();
    return copy(b);
  },

  async getReviewerProfile(id) {
    await sleep(LATENCY_MS);
    const bounties = getDb().bounties.map(applyClock).filter((b) => b.candidates.some((c) => c.reviewer.id === id));
    const user = bounties.flatMap((b) => b.candidates).find((c) => c.reviewer.id === id)?.reviewer;
    if (!user) throw new ApiError("not_found", "This reviewer has no public contributions yet.");
    return copy({ user, bounties });
  },

  async createBounty(input) {
    await sleep(LATENCY_MS);
    const d = getDb();
    const me = currentPersona().user;
    const repo = d.repositories.find((r) => r.id === input.repoId);
    if (!repo) throw new ApiError("not_found", "Repository not found.");
    if (repo.maintainer.id !== me.id) {
      throw new ApiError("forbidden", "Only a maintainer of this repository can create a bounty.");
    }
    const pr = d.pullRequests.find((p) => p.repoId === repo.id && p.number === input.prNumber);
    if (!pr) throw new ApiError("not_found", "Pull request not found.");
    if (pr.bountyId) throw new ApiError("conflict", "This pull request already has a bounty.");

    const id = `b-${d.nextBountyNumber++}`;
    pr.bountyId = id;
    const bounty: Bounty = {
      id,
      onchainBountyId: null,
      repo: { id: repo.id, githubRepoId: repo.githubRepoId, fullName: repo.fullName },
      pr,
      funder: me,
      funderWallet: null,
      amountUnits: input.amountUnits,
      deadline: input.deadline,
      status: "draft",
      candidates: [],
      approval: null,
      chain: {},
      pendingTxHash: null,
      createdAt: new Date().toISOString(),
    };
    d.bounties.push(bounty);
    return copy(bounty);
  },

  async reportFundingTx(bountyId, txHash) {
    await sleep(LATENCY_MS);
    const b = find(bountyId);
    // The indexer may already have confirmed it; never move a status backwards.
    if (b.status === "draft") {
      b.status = "funding_pending";
      b.pendingTxHash = txHash;
    }
    return copy(b);
  },

  async rejectCandidate(bountyId, candidateId) {
    await sleep(LATENCY_MS);
    const b = find(bountyId);
    if (b.funder.id !== currentPersona().user.id) {
      throw new ApiError("forbidden", "Only the maintainer who funded this bounty can decide on its reviews.");
    }
    const c = b.candidates.find((x) => x.id === candidateId);
    if (!c) throw new ApiError("not_found", "Review not found.");
    c.status = "rejected";
    if (!b.candidates.some((x) => x.status === "candidate")) b.status = "rejected";
    return copy(b);
  },

  async prepareApproval(bountyId, candidateId, amountUnits) {
    await sleep(LATENCY_MS);
    const b = find(bountyId);
    const me = currentPersona().user;
    const repo = getDb().repositories.find((r) => r.id === b.repo.id);
    // Maintainer permission is re-checked at approval time, by immutable GitHub user ID.
    if (!repo || repo.maintainer.id !== me.id) {
      throw new ApiError("forbidden", "You are not a maintainer of this repository, so you cannot approve this payout.");
    }
    const c = b.candidates.find((x) => x.id === candidateId);
    if (!c) throw new ApiError("not_found", "Review not found.");
    if (c.reviewer.id === b.pr.author.id || c.reviewer.id === me.id) {
      throw new ApiError("validation", "The PR author and the approving maintainer cannot be paid for this review.");
    }
    if (!c.reviewerWallet) throw new ApiError("validation", "This reviewer has not linked a payout wallet yet.");
    if (!b.onchainBountyId) throw new ApiError("conflict", "This bounty is not funded yet.");
    if (BigInt(amountUnits) > BigInt(b.amountUnits)) {
      throw new ApiError("validation", "The payout cannot be more than the bounty holds.");
    }
    return {
      onchainBountyId: b.onchainBountyId,
      recipient: c.reviewerWallet,
      amountUnits,
      claimId: fakeHash(`claim:${c.githubCommentId}`),
    };
  },

  async reportApprovalTx(bountyId, txHash) {
    await sleep(LATENCY_MS);
    const b = find(bountyId);
    const d = getDb();
    const oc = b.onchainBountyId ? d.onchain.get(b.onchainBountyId) : undefined;
    const c = b.candidates.find((x) => x.reviewerWallet && x.reviewerWallet === oc?.recipient);
    if (c && oc && !b.approval) {
      c.status = "approved";
      b.approval = {
        candidateId: c.id,
        reviewer: c.reviewer,
        approver: currentPersona().user,
        amountUnits: oc.approvedAmount.toString(),
        approvedRecipient: oc.recipient as `0x${string}`,
        claimId: oc.claimId as `0x${string}`,
        chainTxHash: null,
        approvedAt: new Date().toISOString(),
      };
    }
    if (b.status === "review_candidate") {
      b.status = "approved";
      b.pendingTxHash = txHash;
    }
    return copy(b);
  },

  async getWalletLink() {
    await sleep(LATENCY_MS);
    const me = currentPersona().user.id;
    return copy(getDb().walletLinks.find((w) => w.githubUserId === me) ?? null);
  },

  async createWalletChallenge(address) {
    await sleep(LATENCY_MS);
    const me = currentPersona().user;
    const nonce = fakeHash(`nonce:${address}:${Date.now()}`).slice(2, 18);
    getDb().challenges.set(nonce, { address, userId: me.id });
    return {
      nonce,
      message: `Merit: link this wallet to GitHub user ${me.login} (id ${me.id}).\n\nWallet: ${address}\nNonce: ${nonce}\n\nSigning is free and moves no money.`,
    };
  },

  async verifyWalletLink({ address, nonce }) {
    await sleep(LATENCY_MS);
    const d = getDb();
    const me = currentPersona().user;
    const ch = d.challenges.get(nonce);
    if (!ch || ch.userId !== me.id || ch.address !== address) {
      throw new ApiError("validation", "That signature does not match the challenge. Start again.");
    }
    d.challenges.delete(nonce);
    const link = { githubUserId: me.id, walletAddress: address, verifiedAt: new Date().toISOString() };
    d.walletLinks = [...d.walletLinks.filter((w) => w.githubUserId !== me.id), link];
    // Candidates by this reviewer can now be approved.
    for (const b of d.bounties) for (const c of b.candidates) if (c.reviewer.id === me.id) c.reviewerWallet = address;
    return copy(link);
  },

  async listEvents(filter) {
    await sleep(LATENCY_MS);
    const d = getDb();
    const events = filter?.bountyId ? d.events.filter((e) => e.bountyId === filter.bountyId) : d.events;
    return copy({
      source: "fixtures" as const,
      lastIndexedBlock: d.headBlock,
      lastDeliveryAt: d.events[0]?.ingestionTimestamp ?? null,
      events,
    });
  },
};
