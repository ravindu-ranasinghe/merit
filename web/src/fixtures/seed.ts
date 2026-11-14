/**
 * Fixture data for mock mode (NEXT_PUBLIC_MOCK=1). Every person, repository, pull request,
 * address and transaction here is fictional sample data. Nothing in this file is a real
 * key or a real onchain transaction.
 */
import type {
  Address,
  Bounty,
  BountyStatus,
  ChainEvent,
  GithubUser,
  Hex,
  PullRequest,
  Repository,
  ReviewCandidate,
  WalletLink,
} from "@/lib/api/types";
import { ARC, MOCK_ESCROW_ADDRESS } from "@/lib/env";

/** Deterministic fake 32-byte hex from a seed string. Not a hash of anything real. */
export function fakeHash(seed: string): Hex {
  let h1 = 0x811c9dc5;
  let h2 = 0x1b873593;
  for (let i = 0; i < seed.length; i++) {
    h1 = Math.imul(h1 ^ seed.charCodeAt(i), 0x01000193);
    h2 = Math.imul(h2 + seed.charCodeAt(i), 0x85ebca6b) ^ (h2 >>> 13);
  }
  let out = "";
  for (let i = 0; i < 8; i++) {
    h1 = Math.imul(h1 ^ (h1 >>> 15), 0x2c1b3c6d) + i;
    h2 = Math.imul(h2 ^ (h2 >>> 13), 0x297a2d39) ^ h1;
    out += ((h1 ^ h2) >>> 0).toString(16).padStart(8, "0");
  }
  return `0x${out}`;
}

export type PersonaKey = "maintainer" | "reviewer" | "newReviewer" | "outsider";

export interface Persona {
  key: PersonaKey;
  label: string;
  blurb: string;
  user: GithubUser;
  wallet: Address;
}

export const PERSONAS: Record<PersonaKey, Persona> = {
  maintainer: {
    key: "maintainer",
    label: "Maintainer",
    blurb: "Funds bounties and approves payouts",
    user: { id: "4100201", login: "mira-okafor", name: "Mira Okafor" },
    wallet: "0x71c0000000000000000000000000000000a1fa01",
  },
  reviewer: {
    key: "reviewer",
    label: "Reviewer",
    blurb: "Reviewed PRs, has a linked wallet",
    user: { id: "4100305", login: "jun-park", name: "Jun Park" },
    wallet: "0x9e40000000000000000000000000000000b2cb02",
  },
  newReviewer: {
    key: "newReviewer",
    label: "New reviewer",
    blurb: "Reviewed a PR, no wallet linked yet",
    user: { id: "4100518", login: "ines-moreau", name: "Ines Moreau" },
    wallet: "0x3ad0000000000000000000000000000000c3dc03",
  },
  outsider: {
    key: "outsider",
    label: "No access",
    blurb: "Signed in, but not a maintainer or reviewer",
    user: { id: "4100999", login: "sam-reyes", name: "Sam Reyes" },
    wallet: "0x5bf0000000000000000000000000000000d4ed04",
  },
};

const author: GithubUser = { id: "4100412", login: "theo-lindqvist", name: "Theo Lindqvist" };

const mira = PERSONAS.maintainer;
const jun = PERSONAS.reviewer;
const ines = PERSONAS.newReviewer;

export interface SeedOnchain {
  funder: Address;
  expiry: number;
  paid: boolean;
  refunded: boolean;
  recipient: Address | null;
  claimId: Hex | null;
  amount: bigint;
  approvedAmount: bigint;
}

export interface Seed {
  repositories: Repository[];
  pullRequests: PullRequest[];
  bounties: Bounty[];
  events: ChainEvent[];
  walletLinks: WalletLink[];
  onchain: Map<string, SeedOnchain>;
  headBlock: number;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

interface Spec {
  n: number;
  repo: 0 | 1;
  pr: number;
  title: string;
  status: BountyStatus;
  dollars: string;
  /** Funded this long ago (ms). */
  fundedAgo: number;
  /** Deadline relative to now (ms, negative means past). */
  deadlineIn: number;
  candidates?: ReviewCandidate[];
  approvedAgo?: number;
  paidAgo?: number;
  refundedAgo?: number;
  prState?: PullRequest["state"];
}

export function buildSeed(now: number = Date.now()): Seed {
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

  const repositories: Repository[] = [
    { id: "r-1", githubRepoId: "880123401", fullName: "lumen-labs/quill", installationId: "55120", maintainer: mira.user },
    { id: "r-2", githubRepoId: "880123977", fullName: "lumen-labs/quill-cli", installationId: "55120", maintainer: mira.user },
  ];

  const candidate = (
    id: string,
    reviewer: GithubUser,
    wallet: Address | null,
    c: Omit<ReviewCandidate, "id" | "reviewer" | "reviewerWallet" | "githubCommentId" | "commentUrl">,
    prUrl: string,
  ): ReviewCandidate => {
    const commentId = String(2_204_118_000 + Number(id.replace(/\D/g, "")));
    return { id, reviewer, reviewerWallet: wallet, githubCommentId: commentId, commentUrl: `${prUrl}#discussion_r${commentId}`, ...c };
  };

  const prUrl = (repo: 0 | 1, n: number) => `https://github.com/${repositories[repo].fullName}/pull/${n}`;

  const autosaveHunk = `@@ -41,9 +41,12 @@ export class Autosave {
   dispose() {
     this.disposed = true;
+    clearTimeout(this.timer);
   }

   private flush() {
+    if (this.disposed) return;
     this.handle.write(this.pending);`;

  const specs: Spec[] = [
    {
      n: 1, repo: 0, pr: 198, title: "Cache parsed frontmatter between renders", status: "paid", dollars: "10",
      fundedAgo: 6 * DAY, deadlineIn: 1 * DAY, approvedAgo: 3 * DAY + 2 * HOUR, paidAgo: 3 * DAY, prState: "merged",
      candidates: [
        candidate("c-11", jun.user, jun.wallet, {
          filePath: "src/render/frontmatter.ts",
          diffHunk: `@@ -18,7 +18,8 @@ export function parseFrontmatter(doc: Doc) {
-  const key = doc.path;
+  // Key on content hash: path alone goes stale after an edit.
+  const key = \`\${doc.path}:\${doc.hash}\`;
   if (cache.has(key)) return cache.get(key);`,
          commentBody: "Keying the cache on `doc.path` returns stale frontmatter after an edit, because the path does not change. Include the content hash in the key.",
          commentedAt: iso(4 * DAY), commitSha: "c7d91e2", commitMessage: "frontmatter: key cache on path + content hash",
          evidence: { commentExists: true, laterCommitTouchedContext: true, threadResolved: true },
          status: "approved",
        }, prUrl(0, 198)),
      ],
    },
    { n: 2, repo: 1, pr: 201, title: "Add --dry-run to publish", status: "refunded", dollars: "5", fundedAgo: 12 * DAY, deadlineIn: -5 * DAY, refundedAgo: 4 * DAY, prState: "closed" },
    {
      n: 3, repo: 0, pr: 205, title: "Normalize line endings on import", status: "rejected", dollars: "5",
      fundedAgo: 4 * DAY, deadlineIn: 3 * DAY,
      candidates: [
        candidate("c-31", ines.user, null, {
          filePath: "src/import/normalize.ts",
          diffHunk: `@@ -7,6 +7,6 @@ export function normalize(text: string) {
-  return text.replace(/\\r\\n/g, "\\n");
+  return text.replace(/\\r\\n?/g, "\\n");`,
          commentBody: "Nit: could this be a one-liner?",
          commentedAt: iso(3 * DAY), commitSha: null,
          evidence: { commentExists: true, laterCommitTouchedContext: false, threadResolved: false, note: "No later commit touched this file after the comment." },
          status: "rejected",
        }, prUrl(0, 205)),
      ],
    },
    { n: 4, repo: 1, pr: 207, title: "Speed up config discovery", status: "expired", dollars: "7.5", fundedAgo: 8 * DAY, deadlineIn: -1 * HOUR },
    {
      n: 5, repo: 0, pr: 211, title: "Escape pipe characters in table cells", status: "claimable", dollars: "10",
      fundedAgo: 2 * DAY, deadlineIn: 5 * DAY, approvedAgo: 20 * MIN, prState: "merged",
      candidates: [
        candidate("c-51", jun.user, jun.wallet, {
          filePath: "src/markdown/table.ts",
          diffHunk: `@@ -52,7 +52,7 @@ function renderCell(value: string) {
-  return value.trim();
+  return value.trim().replace(/\\|/g, "\\\\|");`,
          commentBody: "A cell containing `|` breaks the row into extra columns. Escape pipes before joining the row.",
          commentedAt: iso(1 * DAY + 3 * HOUR), commitSha: "e02b6aa", commitMessage: "table: escape pipes in cell values",
          evidence: { commentExists: true, laterCommitTouchedContext: true, threadResolved: true },
          status: "approved",
        }, prUrl(0, 211)),
      ],
    },
    {
      n: 6, repo: 0, pr: 212, title: "Handle empty selection in toolbar", status: "approved", dollars: "5",
      fundedAgo: 2 * DAY, deadlineIn: 5 * DAY,
      candidates: [
        candidate("c-61", jun.user, jun.wallet, {
          filePath: "src/toolbar/actions.ts",
          diffHunk: `@@ -30,6 +30,7 @@ export function toggleBold(sel: Selection) {
+  if (sel.isEmpty) return;
   const range = sel.ranges[0];`,
          commentBody: "`sel.ranges[0]` is undefined when nothing is selected, so this throws on a fresh document. Return early for an empty selection.",
          commentedAt: iso(1 * DAY), commitSha: "5f3a0d4", commitMessage: "toolbar: no-op on empty selection",
          evidence: { commentExists: true, laterCommitTouchedContext: true, threadResolved: true },
          status: "approved",
        }, prUrl(0, 212)),
      ],
    },
    {
      n: 7, repo: 0, pr: 214, title: "Fix race in debounced autosave", status: "review_candidate", dollars: "10",
      fundedAgo: 1 * DAY, deadlineIn: 6 * DAY,
      candidates: [
        candidate("c-71", jun.user, jun.wallet, {
          filePath: "src/editor/autosave.ts",
          diffHunk: autosaveHunk,
          commentBody: "`flush()` can still run after `dispose()`: the debounce timer is never cleared, so a late tick writes to a closed file handle. Clear the timer in `dispose()` and guard `flush()`.",
          commentedAt: iso(5 * HOUR), commitSha: "a41c9e7", commitMessage: "autosave: clear pending timer on dispose",
          evidence: { commentExists: true, laterCommitTouchedContext: true, threadResolved: true },
          status: "candidate",
        }, prUrl(0, 214)),
        candidate("c-72", ines.user, null, {
          filePath: "src/editor/autosave.ts",
          diffHunk: `@@ -12,7 +12,7 @@ export class Autosave {
-  private delay = 500;
+  private delay = 750;`,
          commentBody: "500ms feels aggressive on slow disks. Worth making the debounce delay configurable?",
          commentedAt: iso(6 * HOUR), commitSha: "a41c9e7", commitMessage: "autosave: clear pending timer on dispose",
          evidence: { commentExists: true, laterCommitTouchedContext: true, threadResolved: false, note: "The branch was force-pushed, so line matching is approximate." },
          status: "candidate",
        }, prUrl(0, 214)),
        candidate("c-73", author, null, {
          filePath: "src/editor/autosave.ts",
          diffHunk: `@@ -60,6 +60,7 @@ export class Autosave {
+    // TODO: surface write errors to the status bar`,
          commentBody: "Note to self: surface write errors in the status bar.",
          commentedAt: iso(7 * HOUR), commitSha: "a41c9e7",
          evidence: { commentExists: true, laterCommitTouchedContext: true, threadResolved: true },
          status: "ineligible", ineligibleReason: "Written by the PR author. Authors cannot be paid for reviewing their own PR.",
        }, prUrl(0, 214)),
      ],
    },
    { n: 8, repo: 0, pr: 219, title: "Add retry with backoff to sync client", status: "funded", dollars: "10", fundedAgo: 3 * HOUR, deadlineIn: 7 * DAY },
    { n: 9, repo: 0, pr: 221, title: "Validate webhook payload sizes", status: "funding_pending", dollars: "7.5", fundedAgo: 0, deadlineIn: 7 * DAY },
    { n: 10, repo: 0, pr: 223, title: "Lazy-load the emoji picker", status: "draft", dollars: "5", fundedAgo: 0, deadlineIn: 7 * DAY },
  ];

  const toUnits = (d: string) => String(Math.round(Number(d) * 100) * 10_000);

  const bounties: Bounty[] = [];
  const events: ChainEvent[] = [];
  const onchain = new Map<string, SeedOnchain>();
  const pullRequests: PullRequest[] = [];

  // Arc testnet produces blocks in well under a second; fixtures use ~2 blocks per second.
  const headBlock = 3_847_260;
  const blockAt = (msAgo: number) => headBlock - Math.round(msAgo / 500);

  const pushEvent = (
    eventType: ChainEvent["eventType"],
    msAgo: number,
    bountyId: string,
    payload: Record<string, string>,
  ) => {
    const txHash = fakeHash(`${eventType}:${bountyId}`);
    const blockNumber = blockAt(msAgo);
    events.push({
      chainId: ARC.chainId,
      contract: MOCK_ESCROW_ADDRESS,
      txHash,
      logIndex: eventType === "BountyFunded" ? 1 : 0,
      blockNumber,
      eventType,
      payload,
      ingestionTimestamp: new Date(now - msAgo + 1800).toISOString(),
      bountyId,
    });
    return { txHash, blockNumber, logIndex: eventType === "BountyFunded" ? 1 : 0, at: iso(msAgo) };
  };

  for (const s of specs) {
    const repo = repositories[s.repo];
    const id = `b-${100 + s.n}`;
    const amountUnits = toUnits(s.dollars);
    const isOnchain = s.status !== "draft" && s.status !== "funding_pending";
    const onchainId = isOnchain ? String(s.n) : null;
    const deadline = new Date(now + s.deadlineIn).toISOString();
    const expiry = Math.floor((now + s.deadlineIn) / 1000);
    const pr: PullRequest = {
      repoId: repo.id, number: s.pr, title: s.title, author,
      headSha: fakeHash(`sha:${s.pr}`).slice(2, 9), url: prUrl(s.repo, s.pr), state: s.prState ?? "open", bountyId: id,
    };
    pullRequests.push(pr);

    const b: Bounty = {
      id, onchainBountyId: onchainId, repo: { id: repo.id, githubRepoId: repo.githubRepoId, fullName: repo.fullName }, pr,
      funder: mira.user, funderWallet: isOnchain ? mira.wallet : null, amountUnits, deadline, status: s.status,
      candidates: s.candidates ?? [], approval: null, chain: {},
      pendingTxHash: s.status === "funding_pending" ? fakeHash(`pending-fund:${id}`) : null,
      createdAt: iso(s.fundedAgo + 10 * MIN),
    };

    if (isOnchain && onchainId) {
      const prHash = fakeHash(`pr:${repo.githubRepoId}:${s.pr}`);
      b.chain.funded = pushEvent("BountyFunded", s.fundedAgo, id, {
        bountyId: onchainId, funder: mira.wallet, prHash, amount: amountUnits, expiry: String(expiry),
      });
      const oc: SeedOnchain = {
        funder: mira.wallet, expiry, paid: false, refunded: false, recipient: null, claimId: null,
        amount: BigInt(amountUnits), approvedAmount: BigInt(0),
      };

      const approved = b.candidates.find((c) => c.status === "approved");
      if (approved && approved.reviewerWallet) {
        const claimId = fakeHash(`claim:${approved.githubCommentId}`);
        b.approval = {
          candidateId: approved.id, reviewer: approved.reviewer, approver: mira.user, amountUnits,
          approvedRecipient: approved.reviewerWallet, claimId, chainTxHash: null,
          approvedAt: iso(s.approvedAgo ?? 5 * MIN),
        };
        if (s.status === "approved") {
          b.pendingTxHash = fakeHash(`pending-approve:${id}`);
        } else if (s.approvedAgo !== undefined) {
          const ref = pushEvent("RewardApproved", s.approvedAgo, id, {
            bountyId: onchainId, recipient: approved.reviewerWallet, amount: amountUnits, claimId,
          });
          b.chain.approved = ref;
          b.approval.chainTxHash = ref.txHash;
          oc.recipient = approved.reviewerWallet;
          oc.claimId = claimId;
          oc.approvedAmount = BigInt(amountUnits);
        }
        if (s.paidAgo !== undefined) {
          b.chain.paid = pushEvent("RewardPaid", s.paidAgo, id, {
            bountyId: onchainId, recipient: approved.reviewerWallet, amount: amountUnits, claimId,
          });
          oc.paid = true;
        }
      }
      if (s.refundedAgo !== undefined) {
        b.chain.refunded = { ...pushEvent("BountyRefunded", s.refundedAgo, id, { bountyId: onchainId, funder: mira.wallet, amount: amountUnits }), amountUnits };
        oc.refunded = true;
      }
      onchain.set(onchainId, oc);
    }
    bounties.push(b);
  }

  // Open pull requests with no bounty yet, for the create flow.
  pullRequests.push(
    { repoId: "r-1", number: 226, title: "Persist scroll position per document", author, headSha: "9b1e44c", url: prUrl(0, 226), state: "open" },
    { repoId: "r-1", number: 228, title: "Debounce search-as-you-type requests", author, headSha: "d20f7a1", url: prUrl(0, 228), state: "open" },
    { repoId: "r-2", number: 227, title: "Print a summary table after sync", author, headSha: "3c8a5be", url: prUrl(1, 227), state: "open" },
  );

  events.sort((a, b) => b.blockNumber - a.blockNumber || b.logIndex - a.logIndex);

  const walletLinks: WalletLink[] = [
    { githubUserId: mira.user.id, walletAddress: mira.wallet, verifiedAt: iso(14 * DAY) },
    { githubUserId: jun.user.id, walletAddress: jun.wallet, verifiedAt: iso(9 * DAY) },
  ];

  return { repositories, pullRequests, bounties, events, walletLinks, onchain, headBlock };
}
