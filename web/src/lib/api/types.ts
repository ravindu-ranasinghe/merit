/**
 * Shapes the UI reads. They follow the tables and status machine in SPEC.md.
 * Every amount is a string of integer 6-decimal USDC units ("10000000" is $10.00).
 * Only src/lib/format.ts turns units into text for people.
 */

export type Hex = `0x${string}`;
export type Address = `0x${string}`;

export type BountyStatus =
  | "draft"
  | "funding_pending"
  | "funded"
  | "review_candidate"
  | "approved"
  | "claimable"
  | "paid"
  | "expired"
  | "refunded"
  | "rejected";

export interface GithubUser {
  /** Immutable GitHub user ID. Identity checks compare this, never the login. */
  id: string;
  login: string;
  name?: string;
  avatarUrl?: string;
}

export interface Repository {
  id: string;
  githubRepoId: string;
  fullName: string;
  installationId: string;
  maintainer: GithubUser;
}

export interface PullRequest {
  repoId: string;
  number: number;
  title: string;
  author: GithubUser;
  headSha: string;
  url: string;
  state: "open" | "merged" | "closed";
  /** Set when a bounty already exists for this PR. */
  bountyId?: string;
}

export interface TxRef {
  txHash: Hex;
  blockNumber: number | null;
  logIndex?: number;
  at: string;
}

/** The three heuristics from SPEC.md. They are signals for the maintainer, not proof. */
export interface QualificationEvidence {
  commentExists: boolean;
  laterCommitTouchedContext: boolean;
  threadResolved: boolean;
  note?: string;
}

export type CandidateStatus = "candidate" | "approved" | "rejected" | "ineligible";

export interface ReviewCandidate {
  id: string;
  githubCommentId: string;
  reviewer: GithubUser;
  /** The reviewer's verified payout wallet, or null if they have not linked one. */
  reviewerWallet: Address | null;
  filePath: string;
  diffHunk: string;
  commentBody: string;
  commentUrl: string;
  commentedAt: string;
  /** The later commit that touched the commented context. */
  commitSha: string | null;
  commitMessage?: string;
  evidence: QualificationEvidence;
  status: CandidateStatus;
  ineligibleReason?: string;
}

export interface Approval {
  candidateId: string;
  reviewer: GithubUser;
  approver: GithubUser;
  amountUnits: string;
  approvedRecipient: Address;
  claimId: Hex;
  chainTxHash: Hex | null;
  approvedAt: string;
}

export interface Bounty {
  id: string;
  onchainBountyId: string | null;
  repo: Pick<Repository, "id" | "githubRepoId" | "fullName">;
  pr: PullRequest;
  funder: GithubUser;
  funderWallet: Address | null;
  amountUnits: string;
  deadline: string;
  status: BountyStatus;
  candidates: ReviewCandidate[];
  approval: Approval | null;
  /** Transactions the indexer has confirmed. A key is absent until its event is indexed. */
  chain: {
    funded?: TxRef;
    approved?: TxRef;
    paid?: TxRef;
    refunded?: TxRef & { amountUnits: string };
  };
  /** A transaction the user sent that the indexer has not confirmed yet. */
  pendingTxHash?: Hex | null;
  createdAt: string;
}

export interface CreateBountyInput {
  repoId: string;
  prNumber: number;
  amountUnits: string;
  deadline: string;
}

/** The four arguments of approveReward, prepared by the backend, signed by the maintainer. */
export interface PreparedApproval {
  onchainBountyId: string;
  recipient: Address;
  amountUnits: string;
  claimId: Hex;
}

export interface WalletLink {
  githubUserId: string;
  walletAddress: Address;
  verifiedAt: string;
}

export interface WalletChallenge {
  nonce: string;
  message: string;
}

export type ChainEventType = "BountyFunded" | "RewardApproved" | "RewardPaid" | "BountyRefunded";

export interface ChainEvent {
  chainId: number;
  contract: Address;
  txHash: Hex;
  logIndex: number;
  blockNumber: number;
  eventType: ChainEventType;
  /** Decoded event arguments. Amounts are unit strings. */
  payload: Record<string, string>;
  ingestionTimestamp: string;
  /** App bounty id this event belongs to, when the backend has matched it. */
  bountyId?: string;
}

export interface EventFeed {
  /** Where the rows came from. "fixtures" in mock mode; never claim Streams without it. */
  source: "quicknode-streams" | "fixtures";
  lastIndexedBlock: number | null;
  lastDeliveryAt: string | null;
  events: ChainEvent[];
}

export type ApiErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "validation"
  | "network";

export class ApiError extends Error {
  constructor(
    public code: ApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Every backend call the UI makes. Implemented by http.ts (real) and mock/api.ts. */
export interface Api {
  listRepositories(): Promise<Repository[]>;
  listPullRequests(repoId: string): Promise<PullRequest[]>;
  listBounties(scope: "funded-by-me" | "reviewed-by-me"): Promise<Bounty[]>;
  getBounty(id: string): Promise<Bounty>;
  createBounty(input: CreateBountyInput): Promise<Bounty>;
  reportFundingTx(bountyId: string, txHash: Hex): Promise<Bounty>;
  rejectCandidate(bountyId: string, candidateId: string): Promise<Bounty>;
  prepareApproval(bountyId: string, candidateId: string, amountUnits: string): Promise<PreparedApproval>;
  reportApprovalTx(bountyId: string, txHash: Hex): Promise<Bounty>;
  getWalletLink(): Promise<WalletLink | null>;
  createWalletChallenge(address: Address): Promise<WalletChallenge>;
  verifyWalletLink(input: { address: Address; nonce: string; signature: Hex }): Promise<WalletLink>;
  listEvents(filter?: { bountyId?: string }): Promise<EventFeed>;
}
