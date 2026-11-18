/**
 * Replay demo: rebuild Merit's money state from Arc history, then prove replays change nothing.
 *
 *   npm run replay-demo          (needs the docker Postgres: docker compose up -d db)
 *
 * 1. Reads every BountyEscrow log since the deploy block straight from Arc RPC.
 * 2. Rebuilds a SEPARATE database (merit_replay; never the app database) by feeding those logs
 *    through the real QuickNode Streams receiver, signed like a Streams delivery, one block at a time.
 * 3. Replays them three more ways and checks every bounty's status, amounts and recipient, and every
 *    reviewer's earnings, are identical:
 *      - a full historical backfill on top of the live state,
 *      - every log delivered twice, shuffled, in small batches,
 *      - downtime recovery: a fresh database that missed a third of history, then a backfill.
 * 4. Checks the rebuilt state against the escrow contract's own `bounties(id)` view.
 *
 * This replays real Arc logs through Merit's receiver. It does not use QuickNode's backfill API,
 * and GitHub comments are turned off. Exit code 1 means a mismatch.
 */
import { randomBytes } from "node:crypto";
import { asc } from "drizzle-orm";
import pg from "pg";
import { createPublicClient, http, toHex, type Hex } from "viem";
import { decodeLog, escrowAbi } from "../src/chain/escrow.js";
import { createDb, runMigrations } from "../src/db/index.js";
import { bounties, chain_events, pull_requests, repositories } from "../src/db/schema.js";
import { loadEnv } from "../src/env.js";
import { buildApp } from "../src/fastify-app.js";
import { MockGitHubClient } from "../src/github/client.js";
import { qnSign, type RawLog } from "../src/streams/webhook.js";

const RPC_URL = process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.io";
const ESCROW = (process.env.ESCROW_ADDRESS ?? "0x924525bF3f3A39f9c7f298E71aFf43F4c27a4727") as Hex;
const DEPLOY_BLOCK = BigInt(process.env.DEPLOY_BLOCK ?? 72270484);
const REPLAY_DB = process.env.REPLAY_DATABASE_URL ?? "postgres://merit:merit@localhost:5433/merit_replay";
const MAX_RANGE = 10_000n; // Arc RPC refuses eth_getLogs over more blocks than this

// The public Arc RPC rate-limits bursts, so query one range at a time and back off on 429.
const client = createPublicClient({ transport: http(RPC_URL, { retryCount: 8, retryDelay: 1500 }) });

/* ------------------------------------------------------------------ Arc history */

async function fetchHistory(): Promise<RawLog[]> {
  const head = await client.getBlockNumber();
  const ranges: [bigint, bigint][] = [];
  for (let from = DEPLOY_BLOCK; from <= head; from += MAX_RANGE) {
    ranges.push([from, from + MAX_RANGE - 1n > head ? head : from + MAX_RANGE - 1n]);
  }
  const out: RawLog[] = [];
  for (const [fromBlock, toBlock] of ranges) {
    for (const l of await client.getLogs({ address: ESCROW, fromBlock, toBlock })) {
      out.push({
        address: l.address, topics: l.topics as string[], data: l.data,
        blockNumber: toHex(l.blockNumber!), transactionHash: l.transactionHash!, logIndex: toHex(l.logIndex!),
      });
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  out.sort((a, b) => Number(BigInt(a.blockNumber) - BigInt(b.blockNumber)) || Number(BigInt(a.logIndex) - BigInt(b.logIndex)));
  console.log(`Read ${out.length} escrow logs from Arc, blocks ${DEPLOY_BLOCK} to ${head} (${ranges.length} RPC queries).`);
  return out;
}

/* ------------------------------------------------------------------ separate replay database */

async function freshDatabase() {
  const name = new URL(REPLAY_DB).pathname.slice(1);
  // Guard: this drops the database, so only ever touch one whose name says it is for replays.
  if (!/_replay$/.test(name)) throw new Error(`refusing to reset "${name}": REPLAY_DATABASE_URL must name a *_replay database`);
  const admin = new pg.Client({ connectionString: REPLAY_DB.replace(/\/[^/]+$/, "/postgres") });
  await admin.connect();
  await admin.query(`drop database if exists "${name}" with (force)`);
  await admin.query(`create database "${name}"`);
  await admin.end();
  const { db, pool } = createDb(REPLAY_DB);
  await runMigrations(db);
  return { db, pool };
}

/**
 * The app creates a bounty row before it is funded. History only has the funding event, so create a
 * placeholder repository, PR (keyed by the event's prHash) and unfunded bounty for each BountyFunded.
 * The receiver then links them exactly as it does live.
 */
async function seedPlaceholders(db: ReturnType<typeof createDb>["db"], logs: RawLog[]) {
  const [repo] = await db.insert(repositories).values({ github_repo_id: 1, installation_id: 0, name: "replay/arc-history", maintainer_github_id: 0 }).returning();
  const prIds = new Map<string, number>();
  for (const l of logs) {
    const ev = decodeLog(l);
    if (ev?.eventName !== "BountyFunded") continue;
    let prId = prIds.get(ev.args.prHash);
    if (prId === undefined) {
      const [pr] = await db.insert(pull_requests).values({ repo_id: repo!.id, github_pr_number: Number(ev.bountyId), head_sha: "replay", status: "open", author_github_id: 0, pr_hash: ev.args.prHash }).returning();
      prId = pr!.id;
      prIds.set(ev.args.prHash, prId);
    }
    await db.insert(bounties).values({ pr_id: prId, amount_units: ev.args.amount, deadline: new Date(Number(ev.args.expiry) * 1000), status: "funding_pending" });
  }
}

async function replayApp(logs: RawLog[]) {
  const { db, pool } = await freshDatabase();
  await seedPlaceholders(db, logs);
  const token = randomBytes(16).toString("hex");
  const env = loadEnv({ DATABASE_URL: REPLAY_DB, ESCROW_ADDRESS: ESCROW, QN_SECURITY_TOKEN: token, SESSION_SECRET: randomBytes(16).toString("hex"), GITHUB_PR_COMMENTS: "0" });
  const app = await buildApp({ db, env, gh: new MockGitHubClient() }, { logger: process.env.REPLAY_DEBUG === "1" });
  await app.ready();

  /** POST logs to /webhooks/streams exactly as QuickNode would: JSON body, HMAC over nonce + timestamp + body. */
  const deliver = async (batch: RawLog[]) => {
    const body = JSON.stringify({ data: [batch] });
    const nonce = randomBytes(8).toString("hex"), ts = String(Math.floor(Date.now() / 1000));
    const r = await app.inject({ method: "POST", url: "/webhooks/streams", payload: body,
      headers: { "content-type": "application/json", "x-qn-nonce": nonce, "x-qn-timestamp": ts, "x-qn-signature": qnSign(token, nonce, ts, body) } });
    if (r.statusCode !== 200) throw new Error(`receiver returned ${r.statusCode}: ${r.body}`);
    return (r.json() as { inserted: number }).inserted;
  };
  const close = async () => { await app.close(); await pool.end(); };
  return { db, deliver, close };
}

/* ------------------------------------------------------------------ state snapshot */

interface BountyState { status: string; funded: string; approved: string | null; paid: string | null; refunded: string | null; recipient: string | null; funder: string | null }
interface Snapshot { events: number; bounties: Record<string, BountyState>; earnings: Record<string, string> }

async function snapshot(db: ReturnType<typeof createDb>["db"]): Promise<Snapshot> {
  const evs = await db.select().from(chain_events).orderBy(asc(chain_events.block_number), asc(chain_events.log_index));
  const rows = await db.select().from(bounties);
  const out: Snapshot = { events: evs.length, bounties: {}, earnings: {} };
  for (const b of rows) {
    if (b.onchain_bounty_id === null) continue;
    const mine = evs.filter((e) => e.onchain_bounty_id === b.onchain_bounty_id);
    const amt = (t: string) => (mine.find((e) => e.event_type === t)?.payload as { amount?: string } | undefined)?.amount ?? null;
    const recipient = (mine.find((e) => e.event_type === "RewardApproved")?.payload as { recipient?: string } | undefined)?.recipient ?? null;
    out.bounties[b.onchain_bounty_id] = { status: b.status, funded: b.amount_units, approved: amt("RewardApproved"), paid: amt("RewardPaid"), refunded: amt("BountyRefunded"), recipient, funder: b.funder_wallet };
  }
  for (const e of evs) {
    if (e.event_type !== "RewardPaid") continue;
    const p = e.payload as { recipient: string; amount: string };
    out.earnings[p.recipient] = (BigInt(out.earnings[p.recipient] ?? "0") + BigInt(p.amount)).toString();
  }
  return out;
}

const same = (a: Snapshot, b: Snapshot) => JSON.stringify(a) === JSON.stringify(b);

/* ------------------------------------------------------------------ helpers */

const usd = (units: string | null) => {
  if (units === null) return "-";
  const v = BigInt(units);
  return `$${v / 1_000_000n}.${(v % 1_000_000n).toString().padStart(6, "0").replace(/0{1,4}$/, "")}`;
};

/** Deterministic shuffle (mulberry32) so a failing run can be reproduced. */
function shuffled<T>(xs: T[], seed = 2011): T[] {
  let s = seed >>> 0;
  const rand = () => { s += 0x6d2b79f5; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; }
  return a;
}

const byBlock = (logs: RawLog[]) => {
  const m = new Map<string, RawLog[]>();
  for (const l of logs) m.set(String(l.blockNumber), [...(m.get(String(l.blockNumber)) ?? []), l]);
  return [...m.values()];
};

/* ------------------------------------------------------------------ main */

async function main() {
  const logs = await fetchHistory();
  if (logs.length === 0) { console.log("No escrow events yet; nothing to replay."); return; }
  const results: { name: string; inserted: number; ok: boolean }[] = [];

  // Live: one delivery per block, in order, like the stream running normally.
  const live = await replayApp(logs);
  let inserted = 0;
  for (const block of byBlock(logs)) inserted += await live.deliver(block);
  const truth = await snapshot(live.db);
  results.push({ name: "Live delivery, one block at a time", inserted, ok: inserted === logs.length });

  // Backfill: the whole history again, on top of the live state.
  inserted = 0;
  for (let i = 0; i < logs.length; i += 100) inserted += await live.deliver(logs.slice(i, i + 100));
  results.push({ name: "Full historical backfill on top", inserted, ok: inserted === 0 && same(truth, await snapshot(live.db)) });

  // Chaos: every log twice, shuffled, in batches of 7.
  inserted = 0;
  const chaos = shuffled([...logs, ...logs]);
  for (let i = 0; i < chaos.length; i += 7) inserted += await live.deliver(chaos.slice(i, i + 7));
  results.push({ name: "Every log twice, shuffled", inserted, ok: inserted === 0 && same(truth, await snapshot(live.db)) });
  await live.close();

  // Downtime: a fresh database misses the middle third of history, receives the rest out of order,
  // then a backfill restores it.
  const recovered = await replayApp(logs);
  const third = Math.ceil(logs.length / 3);
  inserted = 0;
  for (const block of byBlock([...logs.slice(2 * third), ...logs.slice(0, third)])) inserted += await recovered.deliver(block);
  const gap = await snapshot(recovered.db);
  for (let i = 0; i < logs.length; i += 100) inserted += await recovered.deliver(logs.slice(i, i + 100));
  const healed = await snapshot(recovered.db);
  results.push({ name: `Downtime: missed ${logs.length - 2 * third} logs, then backfilled`, inserted, ok: inserted === logs.length && same(truth, healed) && (logs.length < 3 || !same(truth, gap)) });
  await recovered.close();

  // The contract's own view, read from Arc, must agree with the rebuilt state.
  const chainMismatches: string[] = [];
  for (const [id, s] of Object.entries(truth.bounties)) {
    const [funder, , paid, refunded, recipient, , , amount, approvedAmount] = await client.readContract({ address: ESCROW, abi: escrowAbi, functionName: "bounties", args: [BigInt(id)] }) as readonly [string, bigint, boolean, boolean, string, string, string, bigint, bigint];
    const zero = /^0x0+$/.test(recipient);
    const checks: [string, boolean][] = [
      ["funder", funder.toLowerCase() === s.funder],
      ["paid", paid === (s.paid !== null)],
      ["refunded", refunded === (s.refunded !== null)],
      ["recipient", zero ? s.recipient === null : recipient.toLowerCase() === s.recipient],
      ["approved amount", approvedAmount === BigInt(s.approved ?? "0")],
      ["funded amount", amount === BigInt(s.funded)],
    ];
    for (const [what, ok] of checks) if (!ok) chainMismatches.push(`bounty ${id}: ${what}`);
  }
  results.push({ name: `Rebuilt state matches the contract's bounties() view`, inserted: 0, ok: chainMismatches.length === 0 });

  console.log(`\nRebuilt from Arc: ${truth.events} events, ${Object.keys(truth.bounties).length} bounties\n`);
  console.table(Object.fromEntries(Object.entries(truth.bounties).map(([id, s]) => [`#${id}`, {
    status: s.status, funded: usd(s.funded), approved: usd(s.approved), paid: usd(s.paid), refunded: usd(s.refunded),
  }])));
  console.log("Reviewer earnings (indexed RewardPaid only):");
  console.table(Object.fromEntries(Object.entries(truth.earnings).map(([who, units]) => [who, { earned: usd(units) }])));
  console.log("Replay checks:");
  for (const r of results) console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.inserted ? ` (${r.inserted} new rows)` : " (0 new rows)"}`);
  for (const m of chainMismatches) console.log(`        mismatch: ${m}`);
  if (results.some((r) => !r.ok)) process.exitCode = 1;
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
