import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { decodeLog } from "../chain/escrow.js";
import { refreshBounty } from "../bounty.js";
import type { Ctx } from "../ctx.js";
import { approvals, bounties, chain_events, pull_requests } from "../db/schema.js";
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

export interface RawLog { address: string; topics: string[]; data: string; blockNumber: string | number; transactionHash: string; logIndex: string | number }

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

    let inserted = 0;
    const touched = new Set<string>();
    for (const log of extractLogs(json)) {
      if (log.address.toLowerCase() !== ctx.env.escrowAddress.toLowerCase()) continue;
      const ev = decodeLog({ topics: log.topics, data: log.data });
      if (!ev) continue;
      const r = await ctx.db.insert(chain_events).values({
        chain_id: ctx.env.chainId, contract: log.address.toLowerCase(), tx_hash: log.transactionHash.toLowerCase(),
        log_index: Number(BigInt(log.logIndex)), event_type: ev.eventName, payload: { ...ev.args, bountyId: ev.bountyId },
        block_number: Number(BigInt(log.blockNumber)), onchain_bounty_id: ev.bountyId,
      }).onConflictDoNothing().returning({ id: chain_events.id });
      inserted += r.length;
      touched.add(ev.bountyId);
    }
    // Reconcile every touched bounty even when the log was a duplicate: it is idempotent and heals partial runs.
    for (const id of touched) await reconcile(ctx, id);
    return { ok: true, inserted };
  });
}

const RANK: Record<string, number> = { prepared: 0, signed: 1, paid: 2 };

/** Rebuild one bounty's state from its stored events. Same events in any order, any number of times, same result. */
export async function reconcile(ctx: Ctx, onchainId: string) {
  const events = await ctx.db.select().from(chain_events).where(eq(chain_events.onchain_bounty_id, onchainId));

  // 1. Link the offchain bounty row to its onchain id (matched by pr_hash from BountyFunded).
  const funded = events.find((e) => e.event_type === "BountyFunded");
  if (funded) {
    const p = funded.payload as { funder: string; prHash: string; amount: string; expiry: string };
    const [prRow] = await ctx.db.select({ id: pull_requests.id }).from(pull_requests).where(eq(pull_requests.pr_hash, p.prHash));
    if (prRow) {
      await ctx.db.update(bounties).set({
        onchain_bounty_id: onchainId, funder_wallet: p.funder, amount_units: p.amount, deadline: new Date(Number(p.expiry) * 1000),
      }).where(and(eq(bounties.pr_id, prRow.id), isNull(bounties.onchain_bounty_id),
        sql`${bounties.id} = (select max(id) from bounties where pr_id = ${prRow.id} and onchain_bounty_id is null)`));
    }
  }

  // 2. Match RewardApproved / RewardPaid to approvals by claim_id. Status only moves forward.
  for (const e of events) {
    if (e.event_type !== "RewardApproved" && e.event_type !== "RewardPaid") continue;
    const claim = (e.payload as { claimId: string }).claimId;
    const [a] = await ctx.db.select().from(approvals).where(eq(approvals.claim_id, claim));
    if (!a) continue;
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
  const [b] = await ctx.db.select({ id: bounties.id }).from(bounties).where(eq(bounties.onchain_bounty_id, onchainId));
  if (b) await refreshBounty(ctx, b.id);
}
