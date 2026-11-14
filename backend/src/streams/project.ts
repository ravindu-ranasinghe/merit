export type BountyStatus =
  | "draft" | "funding_pending" | "funded" | "review_candidate" | "approved" | "claimable" | "paid" | "expired" | "refunded";

export interface ProjectInput {
  events: string[]; // event_type of every stored chain event for the bounty; order does not matter
  deadlineMs: number; nowMs: number;
  hasCandidate: boolean; // a candidate or confirmed candidate exists on the PR
  hasApproval: boolean;  // an approval row exists (prepared/signed/paid)
}

/**
 * Pure fold. Status is a function of the SET of events, so replays, out-of-order delivery and backfills cannot
 * double-transition. Chain dominates: paid > claimable > refunded > funded. RewardApproved followed by a partial
 * BountyRefunded (contract refunds amount - approved) stays claimable. Offchain overlays apply only while the
 * chain says "funded".
 */
export function project(i: ProjectInput): BountyStatus {
  const has = (t: string) => i.events.includes(t);
  if (has("RewardPaid")) return "paid";
  if (has("RewardApproved")) return "claimable";
  if (has("BountyRefunded")) return "refunded";
  if (!has("BountyFunded")) return "funding_pending";
  if (i.hasApproval) return "approved";
  if (i.nowMs >= i.deadlineMs) return "expired";
  if (i.hasCandidate) return "review_candidate";
  return "funded";
}
