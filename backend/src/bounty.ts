import { and, asc, eq, inArray } from "drizzle-orm";
import type { Ctx } from "./ctx.js";
import { approvals, bounties, chain_events, review_candidates } from "./db/schema.js";
import { project } from "./streams/project.js";

/** Recompute one bounty's status from ALL its facts. A pure function of stored state, so it is replay- and order-safe. */
export async function refreshBounty(ctx: Ctx, bountyId: number, now = Date.now()) {
  const [b] = await ctx.db.select().from(bounties).where(eq(bounties.id, bountyId));
  if (!b) return null;
  const events = b.onchain_bounty_id === null ? [] :
    await ctx.db.select().from(chain_events).where(eq(chain_events.onchain_bounty_id, b.onchain_bounty_id))
      .orderBy(asc(chain_events.block_number), asc(chain_events.log_index));
  const cands = await ctx.db.select({ id: review_candidates.id }).from(review_candidates)
    .where(and(eq(review_candidates.pr_id, b.pr_id), inArray(review_candidates.status, ["candidate", "confirmed"])));
  const apps = await ctx.db.select({ id: approvals.id }).from(approvals).where(eq(approvals.bounty_id, b.id));
  const status = project({
    events: events.map((e) => e.event_type),
    deadlineMs: b.deadline.getTime(), nowMs: now,
    hasCandidate: cands.length > 0, hasApproval: apps.length > 0,
  });
  if (status !== b.status) await ctx.db.update(bounties).set({ status }).where(eq(bounties.id, b.id));
  return status;
}
