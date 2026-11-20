// Regression check: a broadcast deposit followed by a receipt failure must never lead to a second deposit.
// Runs the real orchestration in src/lib/chain/deposit-flow.ts against a fake chain and storage.
//   cd web && node --test scripts/deposit-recovery.test.mjs
// Simulated failures only: no wallet, RPC or network is involved.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fund, matchesDeposit, resolveDeposit } from "../src/lib/chain/deposit-flow.ts";
import { browserDepositStore } from "../src/lib/chain/deposit-store.ts";

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
    assertWritable() {},
    get: (id) => (backing.has(id) ? structuredClone(backing.get(id)) : null),
    set: (r) => { backing.set(r.bountyId, structuredClone(r)); return true; },
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
    wallet: OWNER, chainId: 5042002,
    assertWallet(owner) { if (c.wallet !== owner || c.chainId !== 5042002) throw Error("funding wallet or network changed"); },
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

test("blocked, full or non-writing browser storage prevents funding, including after refresh", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  try {
    for (const failure of ["blocked", "quota", "small-quota", "discarded"]) {
      const saved = new Map();
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
        getItem(k) { if (failure === "blocked") throw Error("storage blocked"); return saved.get(k) ?? null; },
        setItem(k, v) {
          if (failure === "blocked" || failure === "quota" || (failure === "small-quota" && v.length > 800)) throw Error(failure);
          if (failure !== "discarded") saved.set(k, v);
        },
        removeItem(k) { saved.delete(k); },
      } });
      const c = chain();
      for (let refresh = 0; refresh < 2; refresh++) {
        const store = browserDepositStore({ chainId: 5042002, escrow: ESCROW });
        await assert.rejects(fund(c, store, req({ bountyId: `storage-${failure}` })), /Enable browser storage/);
      }
      assert.equal(c.approvals, 0);
      assert.equal(c.broadcasts.length, 0, "a deposit cannot start without recovery storage");
    }
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else delete globalThis.localStorage;
  }
});

test("storage disappearing after broadcast warns and preserves recovery through remount and retry", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const saved = new Map();
  let lost = false;
  try {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
      getItem(k) { if (lost) throw Error("storage lost"); return saved.get(k) ?? null; },
      setItem(k, v) { if (lost) throw Error("storage lost"); saved.set(k, v); },
      removeItem(k) { saved.delete(k); },
    } });
    const c = chain({ deposit: ["receipt-throws"], outcome: "pending" });
    const send = c.createBounty;
    c.createBounty = async (...args) => { lost = true; return send(...args); };
    const events = [];
    const open = () => browserDepositStore({ chainId: 5042002, escrow: ESCROW });
    const request = req({ bountyId: "lost-after-broadcast" });
    assert.equal((await fund(c, open(), request, (e) => events.push(e))).kind, "pending");
    assert.ok(events.some((e) => e.type === "storage_failed"));
    assert.equal((await fund(c, open(), request)).kind, "pending");
    assert.equal(c.broadcasts.length, 1);
    c.outcome = "reverted";
    assert.equal((await fund(c, open(), request)).kind, "not_funded");
    assert.equal(open().get(request.bountyId), null);
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else delete globalThis.localStorage;
  }
});

test("a wallet or network change during allowance confirmation prevents the deposit", async () => {
  for (const changed of ["wallet", "network"]) {
    const c = chain();
    const s = storage();
    const approve = c.approveUsdc;
    c.approveUsdc = async (...args) => {
      const result = await approve(...args);
      if (changed === "wallet") c.wallet = OTHER;
      else c.chainId = 1;
      return result;
    };
    await assert.rejects(fund(c, s.open(), req()), /wallet or network changed/);
    assert.equal(c.broadcasts.length, 0);
    assert.equal(s.open().get("12"), null);
  }
});

test("a wallet change while reading allowance prevents even the allowance signature", async () => {
  const c = chain();
  const s = storage();
  c.allowance = async () => { c.wallet = OTHER; return 0n; };
  await assert.rejects(fund(c, s.open(), req()), /wallet or network changed/);
  assert.equal(c.approvals, 0);
  assert.equal(c.broadcasts.length, 0);
});

test("the actual browser store restores a timed-out deposit after its module is reloaded", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const saved = new Map();
  try {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
      getItem: (k) => saved.get(k) ?? null,
      setItem: (k, v) => { saved.set(k, v); },
      removeItem: (k) => { saved.delete(k); },
    } });
    const request = req({ bountyId: "actual-browser-refresh" });
    const c = chain({ deposit: ["receipt-throws"], outcome: "pending" });
    await fund(c, browserDepositStore({ chainId: 5042002, escrow: ESCROW }), request);
    // A new module instance has no in-page cache, just like reloading the browser.
    const reloaded = await import("../src/lib/chain/deposit-store.ts?refresh-check");
    const store = reloaded.browserDepositStore({ chainId: 5042002, escrow: ESCROW });
    assert.equal(store.get(request.bountyId).hash, c.broadcasts[0].hash);
    assert.equal((await fund(c, store, request)).kind, "pending");
    assert.equal(c.broadcasts.length, 1);
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else delete globalThis.localStorage;
  }
});

test("a funding receipt must match the escrow, wallet and all intended terms", () => {
  const record = { wallet: OWNER, escrow: ESCROW, expect: { prHash: req().prHash, amount: "10000000", expiry: "4102444800" } };
  const event = { address: ESCROW.toUpperCase(), args: { funder: OWNER.toUpperCase(), prHash: req().prHash, amount: 10_000_000n, expiry: 4_102_444_800n } };
  assert.equal(matchesDeposit(record, event), true);
  for (const args of [{ funder: OTHER }, { prHash: hash(999) }, { amount: 1n }, { expiry: 1n }]) {
    assert.equal(matchesDeposit(record, { ...event, args: { ...event.args, ...args } }), false);
  }
  assert.equal(matchesDeposit(record, { ...event, address: OTHER }), false);
  assert.equal([].some((e) => matchesDeposit(record, e)), false, "a successful cancellation receipt has no funding event");
});

test("a replacement hash is saved before receipt failure; a cancellation can retry and a funded replacement cannot", async () => {
  for (const outcome of ["replaced", "confirmed"]) {
    const s = storage(); const c = chain({ outcome });
    c.createBounty = async (args, onSubmitted) => {
      c.broadcasts.push({ hash: hash(1), args });
      onSubmitted(hash(1));
      onSubmitted(hash(2)); // viem's onReplaced callback identifies the mined replacement
      throw Error("receipt lookup failed after replacement");
    };
    const result = await fund(c, s.open(), req());
    assert.equal(result.hash, hash(2));
    assert.equal(result.kind, outcome === "replaced" ? "not_funded" : "confirmed");
    if (outcome === "confirmed") {
      assert.equal(s.open().get("12").hash, hash(2));
      await fund(c, s.open(), req());
      assert.equal(c.broadcasts.length, 1);
    } else assert.equal(s.open().get("12"), null);
  }
});
