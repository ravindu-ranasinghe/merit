// Regression check: a broadcast deposit followed by a receipt failure must never lead to a second deposit.
// Runs the real orchestration in src/lib/chain/deposit-flow.ts against a fake chain and storage.
//   cd web && node --test scripts/deposit-recovery.test.mjs
// Simulated failures only: no wallet, RPC or network is involved.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fund, resolveDeposit } from "../src/lib/chain/deposit-flow.ts";

const OWNER = "0x00000000000000000000000000000000000000f1";
const OTHER = "0x00000000000000000000000000000000000000c3";
const ESCROW = "0x924525bf3f3a39f9c7f298e71aff43f4c27a4727";
const req = (over = {}) => ({
  bountyId: "12", owner: OWNER, chainId: 5042002, escrow: ESCROW,
  prHash: `0x${"ab".repeat(32)}`, amount: 10_000_000n, expiry: 4_102_444_800n, ...over,
});
const hash = (n) => `0x${n.toString(16).padStart(64, "0")}`;

/** Storage backed by a Map that outlives the store object, like localStorage across a page refresh. */
function storage() {
  const backing = new Map();
  const open = () => ({
    get: (id) => (backing.has(id) ? structuredClone(backing.get(id)) : null),
    set: (r) => backing.set(r.bountyId, structuredClone(r)),
    clear: (id) => backing.delete(id),
  });
  return { backing, open };
}

/**
 * A fake chain. `deposit` decides what happens to each createBounty after broadcast:
 *   "ok" | "receipt-throws" | "reject-before-broadcast" | "revert-before-broadcast".
 * `outcome` is what checkDeposit reports for a recorded deposit.
 */
function chain({ allowance = 0n, approve = "ok", deposit = ["ok"], outcome = "pending" } = {}) {
  const c = {
    broadcasts: [], approvals: 0, allowanceNow: allowance, outcome,
    async allowance() { return c.allowanceNow; },
    async approveUsdc(amount, onSubmitted) {
      c.approvals++;
      onSubmitted(hash(1000 + c.approvals));
      if (approve === "receipt-throws") { c.allowanceNow = amount; throw new Error("approval receipt timed out"); }
      c.allowanceNow = amount;
      return { hash: hash(1000 + c.approvals) };
    },
    async blockNumber() { return 72_800_000n; },
    async createBounty(args, onSubmitted) {
      const mode = deposit.shift() ?? "ok";
      if (mode === "reject-before-broadcast") throw new Error("User rejected the request.");
      if (mode === "revert-before-broadcast") throw new Error("simulation reverted: ExpiryNotInFuture");
      await new Promise((r) => setTimeout(r, 5)); // the wallet takes a moment, so double clicks overlap
      const h = hash(c.broadcasts.length + 1);
      c.broadcasts.push({ hash: h, args });
      onSubmitted(h);
      if (mode === "receipt-throws") throw new Error("Timed out waiting for the transaction receipt.");
      return { hash: h };
    },
    async checkDeposit() { return { outcome: c.outcome }; },
  };
  return c;
}

test("broadcast succeeds, receipt lookup throws, user retries: exactly one deposit, hash kept", async () => {
  const s = storage(); const c = chain({ deposit: ["receipt-throws"], outcome: "pending" });
  const first = await fund(c, s.open(), req());
  assert.equal(first.kind, "pending");
  assert.equal(c.broadcasts.length, 1);
  const retry = await fund(c, s.open(), req());
  assert.deepEqual(retry, { kind: "pending", hash: c.broadcasts[0].hash });
  assert.equal(c.broadcasts.length, 1, "retry checked the deposit instead of sending another");
  assert.equal(s.open().get("12").hash, c.broadcasts[0].hash);
});

test("refresh during the failure resumes the recorded deposit without another one", async () => {
  const s = storage(); const c = chain({ deposit: ["receipt-throws"], outcome: "pending" });
  await fund(c, s.open(), req());
  // New page: a fresh store object over the same browser storage.
  const reopened = s.open();
  const record = reopened.get("12");
  assert.ok(record, "the deposit record survived the refresh");
  assert.equal((await resolveDeposit(c, reopened, record, OWNER)).kind, "pending");
  c.outcome = "confirmed";
  assert.equal((await fund(c, s.open(), req())).kind, "confirmed");
  assert.equal(c.broadcasts.length, 1);
});

test("a confirmed deposit waiting for Streams stays waiting and never offers another deposit", async () => {
  const s = storage(); const c = chain({ deposit: ["receipt-throws"], outcome: "confirmed" });
  assert.equal((await fund(c, s.open(), req())).kind, "confirmed");
  for (let i = 0; i < 3; i++) assert.equal((await fund(c, s.open(), req())).kind, "confirmed");
  assert.equal(c.broadcasts.length, 1);
  assert.ok(s.open().get("12"), "the record is kept while the deposit is unindexed");
});

test("a known revert permits another attempt", async () => {
  const s = storage(); const c = chain({ deposit: ["receipt-throws", "ok"], outcome: "reverted" });
  const first = await fund(c, s.open(), req());
  assert.deepEqual(first, { kind: "not_funded", hash: c.broadcasts[0].hash, reason: "reverted" });
  assert.equal(s.open().get("12"), null, "a reverted deposit's record is cleared");
  assert.equal((await fund(c, s.open(), req())).kind, "confirmed");
  assert.equal(c.broadcasts.length, 2);
});

test("a replaced deposit that did not fund permits another attempt; a pending one does not", async () => {
  const s = storage(); const c = chain({ deposit: ["receipt-throws", "ok"], outcome: "pending" });
  await fund(c, s.open(), req());
  await fund(c, s.open(), req());
  assert.equal(c.broadcasts.length, 1);
  c.outcome = "replaced";
  assert.equal((await fund(c, s.open(), req())).kind, "not_funded");
  assert.equal((await fund(c, s.open(), req())).kind, "confirmed");
  assert.equal(c.broadcasts.length, 2);
});

test("a wallet rejection or simulation revert before broadcast leaves no deposit record", async () => {
  for (const mode of ["reject-before-broadcast", "revert-before-broadcast"]) {
    const s = storage(); const c = chain({ deposit: [mode] });
    await assert.rejects(fund(c, s.open(), req()));
    assert.equal(s.open().get("12"), null);
    assert.equal(c.broadcasts.length, 0);
  }
});

test("an allowance-only failure is never recorded as a deposit; the retry skips the landed approval", async () => {
  const s = storage(); const c = chain({ approve: "receipt-throws" });
  await assert.rejects(fund(c, s.open(), req()));
  assert.equal(s.open().get("12"), null, "no deposit recorded, nothing marked funded");
  assert.equal(c.broadcasts.length, 0);
  assert.equal((await fund(c, s.open(), req())).kind, "confirmed");
  assert.equal(c.approvals, 1, "the approval landed, so it is not requested again");
  assert.equal(c.broadcasts.length, 1);
});

test("rapid double clicks broadcast one deposit", async () => {
  const s = storage(); const c = chain();
  const results = await Promise.all([fund(c, s.open(), req()), fund(c, s.open(), req()), fund(c, s.open(), req())]);
  assert.equal(c.broadcasts.length, 1);
  assert.deepEqual(results.map((r) => r.kind).sort(), ["busy", "busy", "confirmed"]);
});

test("another wallet cannot resume or replace this wallet's recorded deposit", async () => {
  const s = storage(); const c = chain({ deposit: ["receipt-throws"], outcome: "pending" });
  await fund(c, s.open(), req());
  const other = await fund(c, s.open(), req({ owner: OTHER }));
  assert.deepEqual(other, { kind: "other_wallet", hash: c.broadcasts[0].hash, wallet: OWNER });
  assert.equal(c.broadcasts.length, 1);
});
