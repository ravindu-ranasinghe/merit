import { isDeepStrictEqual } from "node:util";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { createCanonicalChain } from "../chain/canonical.js";
import { decodeLog } from "../chain/escrow.js";
import { HttpError, type Ctx } from "../ctx.js";
import { bounties, chain_events } from "../db/schema.js";
import { eventDeployment } from "./match.js";
import { extractLogs, reconcile, type RawLog } from "./webhook.js";

const height = (n: unknown) => {
  if (typeof n !== "number" && typeof n !== "string") throw new HttpError(400, "invalid block number");
  let v: number;
  try { v = Number(BigInt(n)); } catch { throw new HttpError(400, "invalid block number"); }
  if (!Number.isSafeInteger(v) || v < 0) throw new HttpError(400, "invalid block number");
  return v;
};

/** Only signed body metadata participates; HTTP reorg headers are outside the HMAC. */
function reorgBlocks(body: unknown, out = new Set<number>()): Set<number> {
  if (Array.isArray(body)) for (const x of body) reorgBlocks(x, out);
  else if (body && typeof body === "object") {
    const o = body as Record<string, unknown>;
    if (o.metadata && typeof o.metadata === "object") {
      const m = o.metadata as { blocks_reorged?: unknown; reorgs?: unknown };
      if (Array.isArray(m.blocks_reorged)) for (const n of m.blocks_reorged) out.add(height(n));
      if (Array.isArray(m.reorgs)) for (const r of m.reorgs) out.add(height(r?.block_number));
    }
    if (o.data) reorgBlocks(o.data, out);
  }
  return out;
}

export async function ingestCanonical(ctx: Ctx, body: unknown) {
  const logs = extractLogs(body).filter((l) => l.address.toLowerCase() === ctx.env.escrowAddress.toLowerCase() && decodeLog(l));
  const blocks = reorgBlocks(body);
  for (const l of logs) blocks.add(height(l.blockNumber));
  if (!blocks.size) return { inserted: 0, touched: new Set<string>(), localIds: new Set<number>() };
  const chain = ctx.canonical ?? createCanonicalChain(ctx.env);
  const hashes = new Map<number, Promise<string>>();
  const receipts = new Map<string, ReturnType<typeof chain.getReceipt>>();
  const blockHash = (n: number) => {
    if (!hashes.has(n)) hashes.set(n, chain.getBlockHash(n).then((h) => h.toLowerCase()));
    return hashes.get(n)!;
  };
  const receipt = (tx: string) => {
    if (!receipts.has(tx)) receipts.set(tx, chain.getReceipt(tx));
    return receipts.get(tx)!;
  };
  const canonicalLog = async (l: RawLog): Promise<string | null> => {
    const r = await receipt(l.transactionHash.toLowerCase());
    if (!r || Number(r.blockNumber) !== height(l.blockNumber)) return null;
    const hash = r.blockHash.toLowerCase();
    if (l.blockHash && l.blockHash.toLowerCase() !== hash) return null;
    if (await blockHash(Number(r.blockNumber)) !== hash) return null;
    const found = r.logs.some((x) => x.address.toLowerCase() === l.address.toLowerCase()
      && height(x.logIndex) === height(l.logIndex) && x.data.toLowerCase() === l.data.toLowerCase()
      && x.topics.map((t) => t.toLowerCase()).join() === l.topics.map((t) => t.toLowerCase()).join());
    return found ? hash : null;
  };
  try {
    if (await chain.getChainId() !== ctx.env.chainId) throw new Error("wrong RPC chain");
    return await ctx.db.transaction(async (tx) => {
      const lock = await tx.execute<{ locked: boolean }>(sql`select pg_try_advisory_xact_lock(761496108, hashtext(${`${ctx.env.chainId}:${ctx.env.escrowAddress.toLowerCase()}`})) as locked`);
      if (!lock.rows[0]?.locked) throw new HttpError(503, "Streams reconciliation busy; retry delivery");
      const work = { ...ctx, db: tx };
      const stored = await tx.select().from(chain_events).where(and(eventDeployment(ctx), or(inArray(chain_events.block_number, [...blocks]), ...(logs.length ? [inArray(chain_events.tx_hash, logs.map((l) => l.transactionHash.toLowerCase()))] : []))));
      const incoming = await Promise.all(logs.map(async (l) => ({ l, hash: await canonicalLog(l) })));
      for (const { l, hash } of incoming) {
        const old = stored.find((e) => e.tx_hash === l.transactionHash.toLowerCase() && e.log_index === height(l.logIndex));
        if (!hash && (!old || (!l.blockHash && old.block_number !== height(l.blockNumber))
          || (l.blockHash && l.blockHash.toLowerCase() === await blockHash(height(l.blockNumber)) && (old.removed || old.block_hash !== l.blockHash.toLowerCase())))) {
          throw new HttpError(503, "Streams log not yet verifiable on canonical RPC; retry delivery");
        }
      }
      const orphaned = (await Promise.all(stored.filter((e) => !e.removed).map(async (e) => {
        if (e.block_hash) return await blockHash(e.block_number) !== e.block_hash ? e : null;
        // Legacy rows have no block hash. Validate their decoded identity against the current receipt.
        const r = await receipt(e.tx_hash);
        const valid = r && Number(r.blockNumber) === e.block_number && await blockHash(e.block_number) === r.blockHash.toLowerCase()
          && r.logs.some((l) => {
            const d = decodeLog(l);
            return l.address.toLowerCase() === e.contract && height(l.logIndex) === e.log_index && d?.eventName === e.event_type
              && Object.entries(e.payload as Record<string, unknown>).every(([k, v]) => ({ ...d.args, bountyId: d.bountyId } as Record<string, unknown>)[k] === v);
          });
        return valid ? null : e;
      }))).filter((e) => e !== null);
      let inserted = 0;
      const touched = new Set<string>();
      const corrected = new Set<string>();
      const localIds = new Set<number>();
      for (const e of stored) {
        if (e.app_bounty_id) localIds.add(e.app_bounty_id);
        for (const version of e.reorg_history) {
          const id = (version as { app_bounty_id?: number } | null)?.app_bounty_id;
          if (id) localIds.add(id);
        }
      }
      for (const e of orphaned) {
        const [owner] = e.onchain_bounty_id ? await tx.select({ id: bounties.id }).from(bounties).where(eq(bounties.onchain_bounty_id, e.onchain_bounty_id)) : [];
        const appBountyId = e.app_bounty_id ?? owner?.id ?? null;
        await tx.update(chain_events).set({ removed: true, app_bounty_id: appBountyId }).where(eq(chain_events.id, e.id));
        if (appBountyId) localIds.add(appBountyId);
        if (e.onchain_bounty_id) { touched.add(e.onchain_bounty_id); corrected.add(e.onchain_bounty_id); }
      }
      for (const { l, hash } of incoming) {
        if (!hash) continue; // an old signed replay can never resurrect an orphan
        const ev = decodeLog(l)!;
        const value = {
          chain_id: ctx.env.chainId, contract: l.address.toLowerCase(), tx_hash: l.transactionHash.toLowerCase(),
          log_index: height(l.logIndex), event_type: ev.eventName, payload: { ...ev.args, bountyId: ev.bountyId },
          block_number: height(l.blockNumber), block_hash: hash, onchain_bounty_id: ev.bountyId, removed: false, app_bounty_id: null,
        };
        const [old] = await tx.select().from(chain_events).where(and(eventDeployment(ctx), eq(chain_events.tx_hash, value.tx_hash), eq(chain_events.log_index, value.log_index)));
        if (!old) {
          await tx.insert(chain_events).values(value);
          inserted++;
        } else if (old.removed || old.block_hash !== hash || old.block_number !== value.block_number) {
          const changed = old.block_number !== value.block_number || (old.block_hash !== null && old.block_hash !== hash)
            || old.event_type !== value.event_type || !isDeepStrictEqual(old.payload, value.payload);
          const history = changed ? [...old.reorg_history, {
            block_hash: old.block_hash, block_number: old.block_number, payload: old.payload, event_type: old.event_type,
            onchain_bounty_id: old.onchain_bounty_id, app_bounty_id: old.app_bounty_id,
          }] : old.reorg_history;
          await tx.update(chain_events).set({ ...value, reorg_history: history }).where(eq(chain_events.id, old.id));
          if (old.removed || changed) {
            if (old.onchain_bounty_id) { touched.add(old.onchain_bounty_id); corrected.add(old.onchain_bounty_id); }
            corrected.add(ev.bountyId);
          }
        }
        touched.add(ev.bountyId);
      }
      for (const id of touched) {
        for (const localId of await reconcile(work, id, corrected.has(id))) localIds.add(localId);
      }
      return { inserted, touched, localIds };
    });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    // Provider credentials, URLs and raw RPC errors must not escape into logs or responses.
    throw new HttpError(503, "Canonical chain validation unavailable; retry delivery");
  }
}
