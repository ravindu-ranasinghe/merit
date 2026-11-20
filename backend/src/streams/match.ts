/**
 * Identity rules that tie public escrow events to Merit's own records. PR hashes and claim ids are public,
 * so anyone can emit events that carry them; these checks make sure such events cannot bind to, advance or
 * be attributed to someone else's bounty or approval. Used by the Streams receiver, the PR status comment
 * and the receipt view, so all three agree.
 */

import { and, eq } from "drizzle-orm";
import type { Ctx } from "../ctx.js";
import { chain_events } from "../db/schema.js";

/** Bounty ids are local to a contract; historical logs from another deployment cannot supply its facts. */
export const eventContext = (ctx: Ctx) => and(
  eq(chain_events.chain_id, ctx.env.chainId), eq(chain_events.contract, ctx.env.escrowAddress.toLowerCase()),
);

const sameAddress = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** A BountyFunded event matches a funding intent only on funder, integer amount and expiry (unix seconds). */
export function matchesIntent(
  b: { funder_wallet: string | null; amount_units: string; deadline: Date },
  ev: { funder: string; amount: string; expiry: string },
) {
  return sameAddress(b.funder_wallet, ev.funder)
    && BigInt(b.amount_units) === BigInt(ev.amount)
    && Math.floor(b.deadline.getTime() / 1000) === Number(ev.expiry);
}

/** A RewardApproved / RewardPaid event belongs to an approval only if recipient and amount match too. */
export function approvalMatches(
  a: { approved_recipient: string; amount_units: string },
  ev: { recipient: string; amount: string },
) {
  return sameAddress(a.approved_recipient, ev.recipient) && BigInt(a.amount_units) === BigInt(ev.amount);
}
