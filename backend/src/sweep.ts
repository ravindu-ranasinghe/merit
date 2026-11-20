// Expiry sweep: the time-based half of the bounty lifecycle.
//
// The contract cannot act on a clock, and nothing in the backend runs on one either: a bounty only became "expired"
// when someone read it, and a PR status comment that failed to sync waited for the next event. A scheduler calls
// POST /internal/sweep every few minutes; the sweep re-derives status for every bounty whose deadline has passed and
// that still holds unrefunded escrow, re-syncs its PR status comment (repairing one a failed delivery left stale),
// and reports which ones can be refunded.
//
// It holds NO key and sends NO transaction. `refundable` is the work list a future refund keeper would act on (see
// backend/README.md); today the refund is still sent by a person from the bounty page. Everything here is derived
// from stored state, so after downtime the next sweep picks up exactly what is outstanding: there is no queue to lose.
import { and, eq, isNotNull, lte, notExists, sql } from "drizzle-orm";
import { refreshBounty } from "./bounty.js";
import type { Ctx } from "./ctx.js";
import { bounties, chain_events } from "./db/schema.js";
import { syncPrStatusComment } from "./github/pr-status.js";
import { eventContext } from "./streams/match.js";

export interface SweepReport {
  /** false when another sweep held the lock; nothing was done. */
  ran: boolean;
  checked: number;
  /** Offchain bounty ids whose status changed during this sweep, with the new status. */
  changed: { bounty_id: number; from: string; to: string }[];
  /** Expired bounties with escrow the contract would refund (amount - approvedAmount > 0, no refund yet). */
  refundable: { bounty_id: number; onchain_bounty_id: string; refundable_units: string }[];
  /** PR status comment re-syncs (src/github/pr-status.ts); null when GITHUB_PR_COMMENTS is off. */
  comments: { created: number; updated: number; unchanged: number; skipped: number; failed: number } | null;
}

const SWEEP_LOCK = 761496107; // 761496105 boot migrations, 761496106 per-bounty PR comment

export async function sweepExpired(ctx: Ctx, nowMs = Date.now(), log?: { warn: (o: object, m: string) => void }): Promise<SweepReport> {
  return ctx.db.transaction(async (tx) => {
    const [lock] = (await tx.execute(sql`select pg_try_advisory_xact_lock(${SWEEP_LOCK}) as got`)).rows as { got: boolean }[];
    if (!lock?.got) return { ran: false, checked: 0, changed: [], refundable: [], comments: null };

    // Past the deadline, funded onchain, and no BountyRefunded indexed yet. Paid bounties are included on purpose:
    // a partial approval leaves a remainder the contract still refunds after expiry.
    const due = await ctx.db.select().from(bounties).where(and(
      isNotNull(bounties.onchain_bounty_id),
      lte(bounties.deadline, new Date(nowMs)),
      notExists(ctx.db.select({ one: sql`1` }).from(chain_events).where(and(
        eventContext(ctx),
        eq(chain_events.onchain_bounty_id, bounties.onchain_bounty_id),
        eq(chain_events.event_type, "BountyRefunded"),
      ))),
    )).orderBy(bounties.id);

    const report: SweepReport = {
      ran: true, checked: due.length, changed: [], refundable: [],
      comments: ctx.env.github.prComments ? { created: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0 } : null,
    };

    for (const b of due) {
      const events = await ctx.db.select().from(chain_events).where(and(eventContext(ctx), eq(chain_events.onchain_bounty_id, b.onchain_bounty_id!)));
      const funded = events.find((e) => e.event_type === "BountyFunded");
      if (!funded) continue; // linked by id but its funding event is not indexed: nothing confirmed to act on
      const approved = events.find((e) => e.event_type === "RewardApproved");
      const amount = BigInt((funded.payload as { amount: string }).amount);
      const committed = approved ? BigInt((approved.payload as { amount: string }).amount) : 0n;

      const to = await refreshBounty(ctx, b.id, nowMs);
      if (to && to !== b.status) report.changed.push({ bounty_id: b.id, from: b.status, to });
      if (amount > committed) {
        report.refundable.push({ bounty_id: b.id, onchain_bounty_id: b.onchain_bounty_id!, refundable_units: (amount - committed).toString() });
      }

      if (report.comments) {
        try {
          const r = await syncPrStatusComment(ctx, b.onchain_bounty_id!);
          if (r !== "disabled") report.comments[r]++;
        } catch (err) {
          report.comments.failed++;
          log?.warn({ bountyId: b.id, status: (err as { status?: number }).status, error: (err as Error).message }, "PR status comment not synced by sweep");
        }
      }
    }
    return report;
  });
}
