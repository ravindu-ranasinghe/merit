/**
 * Where a bounty's money is, from indexed contract events only. Integer 6-decimal USDC units as bigint.
 *
 * The escrow contract (contracts/src/BountyEscrow.sol) works like this: funding locks `funded`;
 * approveReward reserves `approved` of it for one recipient; claim pays exactly that reservation, at any time;
 * refundExpired, after the deadline and once, returns `funded - approved` to the funder. Claim and refund
 * are independent, so either can come first. A prepared or signed-but-unindexed approval reserves nothing
 * here: only RewardApproved does. The bounty's status label is not used for any amount.
 *
 * No runtime imports, so scripts/accounting.test.mjs can run it under Node.
 */
import type { Bounty } from "@/lib/api/types";

export interface EscrowAmounts {
  /** Locked by BountyFunded. */
  funded: bigint;
  /** Reserved for the approved reviewer by RewardApproved. */
  approved: bigint;
  /** Sent to the reviewer by RewardPaid. */
  paid: bigint;
  /** Returned to the funder by BountyRefunded. */
  refunded: bigint;
  /** Still in escrow: funded, minus paid out, minus refunded. */
  held: bigint;
  /** Approved but not yet claimed. Part of `held`, and never refundable. */
  reserved: bigint;
  /** What refundExpired returns once the deadline passes: funded minus approved. Zero once refunded. */
  refundable: bigint;
  /** The deadline has passed, a remainder exists and has not been refunded: the refund can be sent now. */
  refundOpen: boolean;
  /** An approved reward is waiting for its recipient to claim it. */
  claimOpen: boolean;
}

type Chain = Bounty["chain"];
const ZERO = BigInt(0);
const units = (v: string | undefined) => (v ? BigInt(v) : ZERO);
const max = (a: bigint, b: bigint) => (a > b ? a : b);

export function escrowAmounts(b: { chain: Chain; amountUnits: string; deadline: string }, nowMs: number): EscrowAmounts {
  const c = b.chain;
  // An indexed funding event without an amount (older data) falls back to the bounty's own amount.
  const funded = c.funded ? (c.funded.amountUnits !== undefined ? units(c.funded.amountUnits) : units(b.amountUnits)) : ZERO;
  const paid = units(c.paid?.amountUnits);
  // A payout can only be of an approved amount, even if its RewardApproved is not indexed yet.
  const approved = max(units(c.approved?.amountUnits), paid);
  const refunded = units(c.refunded?.amountUnits);
  const held = max(funded - paid - refunded, ZERO);
  const reserved = max(approved - paid, ZERO);
  const refundable = c.refunded ? ZERO : max(funded - approved, ZERO);
  const expired = nowMs >= new Date(b.deadline).getTime();
  return {
    funded, approved, paid, refunded, held, reserved, refundable,
    refundOpen: !!c.funded && expired && refundable > ZERO,
    claimOpen: approved > ZERO && !c.paid,
  };
}

/** Totals across bounties, for a dashboard. */
export function totalAmounts(list: { chain: Chain; amountUnits: string; deadline: string }[], nowMs: number) {
  let held = ZERO, paid = ZERO, refunded = ZERO, reserved = ZERO, paidCount = 0;
  for (const b of list) {
    const a = escrowAmounts(b, nowMs);
    held += a.held; paid += a.paid; refunded += a.refunded; reserved += a.reserved;
    if (a.paid > ZERO) paidCount++;
  }
  return { held, paid, refunded, reserved, paidCount };
}
