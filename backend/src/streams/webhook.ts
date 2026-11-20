import { createHmac, timingSafeEqual } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { refreshBounty } from "../bounty.js";
import type { Ctx } from "../ctx.js";
import { approvals, bounties, chain_events, pull_requests } from "../db/schema.js";
import { PR_COMMENT_BUDGET_MS, syncPrStatusCommentById, withCommentTimeout } from "../github/pr-status.js";
import { approvalMatches, eventContext, matchesIntent } from "./match.js";
import { ingestCanonical } from "./canonical.js";
import { isUniqueViolation } from "../db/index.js";

/**
 * QuickNode Streams signature (QuickNode guide "Validating incoming Streams webhook messages"):
 * headers x-qn-nonce, x-qn-timestamp, x-qn-signature; signature = hex HMAC-SHA256 over
 * nonce + timestamp + payload (no separators), keyed by the stream's security token. The payload is the
 * decompressed JSON body. UNVERIFIED against a live stream until one exists.
 */
export const qnSign = (token: string, nonce: string, ts: string, body: string) =>
  createHmac("sha256", token).update(nonce + ts + body).digest("hex");

function validSig(token: string, h: Record<string, unknown>, body: string) {
  const [n, t, s] = [h["x-qn-nonce"], h["x-qn-timestamp"], h["x-qn-signature"]];
  if (typeof n !== "string" || typeof t !== "string" || typeof s !== "string") return false;
  const a = Buffer.from(qnSign(token, n, t, body));
  const b = Buffer.from(s);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface RawLog { address: string; topics: string[]; data: string; blockNumber: string | number; transactionHash: string; logIndex: string | number; blockHash?: string; removed?: boolean }

/** The Logs dataset payload shape is not confirmed, so find log-shaped objects anywhere in the JSON. */
export function extractLogs(j: unknown, out: RawLog[] = []): RawLog[] {
  if (Array.isArray(j)) j.forEach((x) => extractLogs(x, out));
  else if (j && typeof j === "object") {
    const o = j as Record<string, unknown>;
    if (Array.isArray(o.topics) && typeof o.transactionHash === "string" && typeof o.address === "string") out.push(o as unknown as RawLog);
    else Object.values(o).forEach((x) => extractLogs(x, out));
  }
  return out;
}

export async function streamsWebhook(app: FastifyInstance, ctx: Ctx) {
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => done(null, body));

  app.post("/webhooks/streams", async (req, reply) => {
    const body = req.body as string;
    if (!validSig(ctx.env.qnSecurityToken, req.headers, body)) {
      req.log.warn({
        hasNonce: typeof req.headers["x-qn-nonce"] === "string",
        hasTimestamp: typeof req.headers["x-qn-timestamp"] === "string",
        hasSignature: typeof req.headers["x-qn-signature"] === "string",
        contentEncoding: req.headers["content-encoding"] ?? "none",
      }, "QuickNode signature rejected");
      return reply.code(401).send({ error: "bad signature" });
    }
    let json: unknown;
    try { json = JSON.parse(body); } catch { return reply.code(400).send({ error: "invalid json" }); }

    const { inserted, localIds } = await ingestCanonical(ctx, json);
    // Then mirror the confirmed state onto the PR. GitHub trouble must never fail or delay indexing much:
    // Errors are logged; the entire comment phase shares one budget, regardless of batch size.
    const commentDeadline = Date.now() + PR_COMMENT_BUDGET_MS;
    for (const id of localIds) {
      const remaining = commentDeadline - Date.now();
      if (remaining <= 0) {
        req.log.warn({ bountyId: id }, "PR status comment deferred: batch time budget exhausted; indexing complete");
        continue;
      }
      try {
        const result = await withCommentTimeout((signal) => syncPrStatusCommentById(ctx, id, signal), remaining);
        if (result === "created" || result === "updated") req.log.info({ bountyId: id, result }, "PR status comment synced");
      } catch (err) {
        req.log.warn({ err, bountyId: id }, "PR status comment not updated");
      }
    }
    return { ok: true, inserted };
  });
}

const RANK: Record<string, number> = { prepared: 0, signed: 1, paid: 2 };

/** Rebuild one bounty's state from its stored events. Same events in any order, any number of times, same result. */
export async function reconcile(ctx: Ctx, onchainId: string, correction = false) {
  const localIds: number[] = [];
  const events = await ctx.db.select().from(chain_events).where(and(eventContext(ctx), eq(chain_events.onchain_bounty_id, onchainId)));

  // 1. Link the offchain bounty row (the maintainer's funding intent) to its onchain id, once.
  // The PR hash is public, so anyone can fund the same PR. A BountyFunded event binds a pending intent only
  // when funder, amount and expiry ALSO match what the maintainer committed to at creation. A non-matching
  // event stays in the ledger unattached; the intent's terms are never overwritten. Already-linked bounties
  // are not relinked, so replays cannot pick a newer bounty on the same PR.
  const funded = events.find((e) => e.event_type === "BountyFunded");
  let [own] = await ctx.db.select().from(bounties).where(eq(bounties.onchain_bounty_id, onchainId));
  if (correction && own) {
    await ctx.db.update(approvals).set({ status: "prepared", chain_tx_hash: null }).where(eq(approvals.bounty_id, own.id));
    const p = funded?.payload as { funder: string; amount: string; expiry: string } | undefined;
    const [pr] = await ctx.db.select().from(pull_requests).where(eq(pull_requests.id, own.pr_id));
    if (!p || !matchesIntent(own, p) || (funded!.payload as { prHash: string }).prHash !== pr?.pr_hash) {
      await ctx.db.update(bounties).set({ onchain_bounty_id: null }).where(eq(bounties.id, own.id));
      await refreshBounty(ctx, own.id);
      localIds.push(own.id);
      own = undefined;
    }
  }
  if (funded && !own) {
    const p = funded.payload as { funder: string; prHash: string; amount: string; expiry: string };
    const [prRow] = await ctx.db.select({ id: pull_requests.id }).from(pull_requests).where(eq(pull_requests.pr_hash, p.prHash));
    if (prRow) {
      const pending = await ctx.db.select().from(bounties)
        .where(and(eq(bounties.pr_id, prRow.id), isNull(bounties.onchain_bounty_id))).orderBy(asc(bounties.id));
      // Every match has the same funder wallet, so taking the oldest never hands one user's event to another.
      const intent = pending.find((b) => matchesIntent(b, p));
      if (intent) {
        try {
          await ctx.db.update(bounties).set({ onchain_bounty_id: onchainId })
            .where(and(eq(bounties.id, intent.id), isNull(bounties.onchain_bounty_id)));
        } catch (err) {
          if (!isUniqueViolation(err)) throw err; // a concurrent delivery linked this onchain id first
        }
        [own] = await ctx.db.select().from(bounties).where(eq(bounties.onchain_bounty_id, onchainId));
      }
    }
  }
  if (!own) return localIds; // unattached ledger event: kept, but it changes no app bounty or approval

  // 2. Match RewardApproved / RewardPaid to THIS bounty's approval: same linked bounty, claim id, recipient and
  // amount. Claim ids are public, so a foreign bounty's event must never advance or attribute this one.
  for (const e of events) {
    if (e.event_type !== "RewardApproved" && e.event_type !== "RewardPaid") continue;
    const ev = e.payload as { claimId: string; recipient: string; amount: string };
    const [a] = await ctx.db.select().from(approvals).where(and(eq(approvals.claim_id, ev.claimId), eq(approvals.bounty_id, own.id)));
    if (!a || !approvalMatches(a, ev)) continue;
    const next = e.event_type === "RewardPaid" ? "paid" : "signed";
    const set: Partial<typeof approvals.$inferInsert> = {};
    if (e.event_type === "RewardApproved") set.chain_tx_hash = e.tx_hash;
    if (RANK[next]! > RANK[a.status]!) set.status = next;
    if (Object.keys(set).length === 0) continue;
    try {
      await ctx.db.update(approvals).set(set).where(eq(approvals.id, a.id));
    } catch (err) {
      // The partial unique index refused a second signed/paid approval for one bounty: keep the first, never double-pay.
      if (!isUniqueViolation(err)) throw err;
    }
  }

  // 3. Status.
  await refreshBounty(ctx, own.id);
  localIds.push(own.id);
  return localIds;
}
