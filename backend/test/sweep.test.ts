import { sql } from "drizzle-orm";
import { encodeAbiParameters, encodeEventTopics, keccak256, type Hex } from "viem";
import { afterAll, describe, expect, it } from "vitest";
import { claimId, escrowAbi, prHash } from "../src/chain/escrow.js";
import { bounties, pull_requests, repositories } from "../src/db/schema.js";
import { loadEnv } from "../src/env.js";
import { bearerMatches } from "../src/routes/internal.js";
import { qnSign } from "../src/streams/webhook.js";
import { sweepExpired } from "../src/sweep.js";
import { DEMO, ESCROW, QN_TOKEN, setup, type Harness } from "./helpers.js";

const SECRET = "sweep-secret-0123456789";
let h: Harness;
// PR status comments are on by default on main; the sweep-logic tests turn them off, the comment tests turn them on.
const start = async (env: Record<string, string> = { GITHUB_PR_COMMENTS: "0" }) => { if (h) await h.close(); h = await setup(env); };
afterAll(() => h.close());

const FUNDER = "0x00000000000000000000000000000000000000f1";
const REVIEWER = "0x00000000000000000000000000000000000000a2";
const FUTURE = 4102444800n; // 2100-01-01: deadline still ahead when events are ingested
const AFTER = Date.parse("2101-01-01T00:00:00Z"); // sweep clock, past every FUTURE deadline
let block = 1;

function log(name: "BountyFunded" | "RewardApproved" | "RewardPaid" | "BountyRefunded", args: Record<string, unknown>, types: { type: string }[], data: unknown[]) {
  const b = block++;
  return { address: ESCROW, topics: encodeEventTopics({ abi: escrowAbi, eventName: name, args } as never),
    data: encodeAbiParameters(types as never, data as never) as Hex, blockNumber: `0x${b.toString(16)}`, transactionHash: keccak256(`0x${b.toString(16).padStart(4, "0")}`), logIndex: "0x0" };
}
const deliver = (logs: unknown[]) => {
  const body = JSON.stringify({ data: [logs] }); const n = "n", t = "1";
  return h.app.inject({ method: "POST", url: "/webhooks/streams", payload: body, headers: { "content-type": "application/json", "x-qn-nonce": n, "x-qn-timestamp": t, "x-qn-signature": qnSign(QN_TOKEN, n, t, body) } });
};

/** A bounty on its own PR (number = onchain id), funded for $10 with the given expiry, plus optional later events. */
async function bounty(id: number, o: { expiry?: bigint; approve?: bigint; paid?: boolean; refund?: bigint } = {}) {
  const [repo] = await h.db.select().from(repositories);
  const [pr] = await h.db.insert(pull_requests).values({ repo_id: repo!.id, github_pr_number: 100 + id, head_sha: "h", status: "open", author_github_id: DEMO.authorId, pr_hash: prHash(DEMO.repoId, 100 + id) }).returning();
  // The funding intent must match the BountyFunded event (funder, amount, expiry) for the backend to link it.
  const expiry = o.expiry ?? FUTURE;
  const [b] = await h.db.insert(bounties).values({ pr_id: pr!.id, funder_wallet: FUNDER, amount_units: "10000000", deadline: new Date(Number(expiry) * 1000), status: "funding_pending" }).returning();
  const B = BigInt(id), claim = claimId(9000 + id);
  const logs = [log("BountyFunded", { bountyId: B, funder: FUNDER, prHash: prHash(DEMO.repoId, 100 + id) }, [{ type: "uint256" }, { type: "uint64" }], [10_000_000n, expiry])];
  if (o.approve) logs.push(log("RewardApproved", { bountyId: B, recipient: REVIEWER }, [{ type: "uint256" }, { type: "bytes32" }], [o.approve, claim]));
  if (o.paid) logs.push(log("RewardPaid", { bountyId: B, recipient: REVIEWER }, [{ type: "uint256" }, { type: "bytes32" }], [o.approve, claim]));
  if (o.refund) logs.push(log("BountyRefunded", { bountyId: B, funder: FUNDER }, [{ type: "uint256" }], [o.refund]));
  expect((await deliver(logs)).statusCode).toBe(200);
  return b!;
}
const status = async (id: number) => (await h.db.select().from(bounties).where(sql`${bounties.id} = ${id}`))[0]!.status;

describe("sweepExpired()", () => {
  it("expires a funded bounty once its deadline passes and lists it as fully refundable", async () => {
    await start();
    const b = await bounty(1);
    expect(await status(b.id)).toBe("funded");
    const r = await sweepExpired(h.ctx, AFTER);
    expect(r).toMatchObject({ ran: true, checked: 1, changed: [{ bounty_id: b.id, from: "funded", to: "expired" }],
      refundable: [{ bounty_id: b.id, onchain_bounty_id: "1", refundable_units: "10000000" }], comments: null });
    expect(await status(b.id)).toBe("expired");
  });

  it("computes refundable exactly as the contract does: amount - approvedAmount, never an approved reward", async () => {
    await start();
    const none = await bounty(1);
    const partial = await bounty(2, { approve: 6_000_000n });
    const partialPaid = await bounty(3, { approve: 6_000_000n, paid: true });
    const full = await bounty(4, { approve: 10_000_000n });
    const r = await sweepExpired(h.ctx, AFTER);
    expect(r.checked).toBe(4);
    expect(r.refundable).toEqual([
      { bounty_id: none.id, onchain_bounty_id: "1", refundable_units: "10000000" },
      { bounty_id: partial.id, onchain_bounty_id: "2", refundable_units: "4000000" },
      { bounty_id: partialPaid.id, onchain_bounty_id: "3", refundable_units: "4000000" },
    ]);
    expect(r.refundable.map((x) => x.bounty_id)).not.toContain(full.id);
    // Chain states win: approved and paid bounties are not turned into "expired".
    expect([await status(partial.id), await status(partialPaid.id), await status(full.id)]).toEqual(["claimable", "paid", "claimable"]);
  });

  it("skips bounties that are not due: deadline ahead, already refunded, or never funded onchain", async () => {
    await start();
    await bounty(1); // deadline ahead of the sweep clock below
    await bounty(2, { refund: 10_000_000n });
    const [pr] = await h.db.select().from(pull_requests);
    await h.db.insert(bounties).values({ pr_id: pr!.id, amount_units: "1", deadline: new Date("2000-01-01"), status: "funding_pending" });
    const r = await sweepExpired(h.ctx, Date.parse("2099-01-01"));
    expect(r).toMatchObject({ ran: true, checked: 0, changed: [], refundable: [] });
    expect((await sweepExpired(h.ctx, AFTER)).refundable.map((x) => x.onchain_bounty_id)).toEqual(["1"]);
  });

  it("is idempotent: a second sweep changes nothing and reports the same work", async () => {
    await start();
    await bounty(1); await bounty(2, { approve: 3_000_000n });
    const first = await sweepExpired(h.ctx, AFTER);
    const second = await sweepExpired(h.ctx, AFTER);
    expect(first.changed).toHaveLength(1);
    expect(second.changed).toEqual([]);
    expect(second.refundable).toEqual(first.refundable);
  });

  it("does nothing while another sweep holds the lock", async () => {
    await start();
    await bounty(1);
    const inner = await h.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(761496107)`);
      return sweepExpired(h.ctx, AFTER);
    });
    expect(inner).toEqual({ ran: false, checked: 0, changed: [], refundable: [], comments: null });
    expect((await sweepExpired(h.ctx, AFTER)).ran).toBe(true);
  });

  it("repairs a PR status comment that a failed delivery left missing, then leaves it alone", async () => {
    await start({ GITHUB_PR_COMMENTS: "1" });
    h.gh.failIssueComments = true; // e.g. a 403 before the App permission was granted
    await bounty(1);
    expect(h.gh.issueComments.get(`${DEMO.name}#101`) ?? []).toHaveLength(0);
    h.gh.failIssueComments = false;
    expect((await sweepExpired(h.ctx, AFTER)).comments).toEqual({ created: 1, updated: 0, unchanged: 0, skipped: 0, failed: 0 });
    expect(h.gh.issueComments.get(`${DEMO.name}#101`)).toHaveLength(1);
    expect((await sweepExpired(h.ctx, AFTER)).comments).toMatchObject({ created: 0, updated: 0, unchanged: 1 });
  });

  it("a GitHub failure is counted, not thrown: status and the refund list still update", async () => {
    await start({ GITHUB_PR_COMMENTS: "1" });
    const b = await bounty(1);
    h.gh.failIssueComments = true;
    const r = await sweepExpired(h.ctx, AFTER);
    expect(r.comments).toMatchObject({ failed: 1 });
    expect(r.refundable).toHaveLength(1);
    expect(await status(b.id)).toBe("expired");
  });
});

describe("POST /internal/sweep", () => {
  const call = (auth?: string) => h.app.inject({ method: "POST", url: "/internal/sweep", headers: auth ? { authorization: auth } : {} });

  it("does not exist unless SWEEP_SECRET is set", async () => {
    await start();
    expect((await call(`Bearer ${SECRET}`)).statusCode).toBe(404);
  });

  it("refuses a missing, wrong or non-Bearer token, and a session cookie", async () => {
    await start({ SWEEP_SECRET: SECRET });
    expect((await call()).statusCode).toBe(401);
    expect((await call("Bearer wrong-secret-0123456789")).statusCode).toBe(401);
    expect((await call(SECRET)).statusCode).toBe(401);
    expect((await h.app.inject({ method: "POST", url: "/internal/sweep", headers: h.cookie(DEMO.maintainerId) })).statusCode).toBe(401);
  });

  it("runs the sweep with the right token", async () => {
    await start({ SWEEP_SECRET: SECRET });
    const b = await bounty(1, { expiry: BigInt(Math.floor(Date.now() / 1000) + 2) });
    await h.db.update(bounties).set({ deadline: new Date(Date.now() - 1000) }).where(sql`${bounties.id} = ${b.id}`);
    const r = await call(`Bearer ${SECRET}`);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ran: true, checked: 1, refundable: [{ bounty_id: b.id, refundable_units: "10000000" }] });
  });
});

describe("SWEEP_SECRET and bearer check", () => {
  it("is off when unset or empty, and needs 16+ characters", () => {
    expect(loadEnv({ DATABASE_URL: "postgres://x" }).sweepSecret).toBeNull();
    expect(loadEnv({ DATABASE_URL: "postgres://x", SWEEP_SECRET: "" }).sweepSecret).toBeNull();
    expect(() => loadEnv({ DATABASE_URL: "postgres://x", SWEEP_SECRET: "short" })).toThrow();
  });
  it("matches only the exact bearer token", () => {
    expect(bearerMatches(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(bearerMatches(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(bearerMatches(`bearer ${SECRET}`, SECRET)).toBe(false);
    expect(bearerMatches(undefined, SECRET)).toBe(false);
  });
});
