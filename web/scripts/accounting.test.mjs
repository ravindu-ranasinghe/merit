// Regression check for partial payouts: where a bounty's money is, from indexed events only.
//   cd web && node --test scripts/accounting.test.mjs
// $10 funding is 10000000 integer units. Runs the real web/src/lib/accounting.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { escrowAmounts, totalAmounts } from "../src/lib/accounting.ts";

const $ = (dollars) => BigInt(Math.round(dollars * 100)) * 10_000n;
const NOW = Date.parse("2026-11-18T12:00:00Z");
const FUTURE = "2026-11-25T00:00:00Z";
const PAST = "2026-11-18T10:00:00Z";
const ref = (units) => ({ txHash: "0x01", blockNumber: 1, at: PAST, amountUnits: units === undefined ? undefined : String(units) });
const bounty = (chain, deadline = PAST) => ({ chain, amountUnits: String($(10)), deadline });
const pick = (a) => ({ held: a.held, paid: a.paid, refunded: a.refunded, reserved: a.reserved, refundable: a.refundable, refundOpen: a.refundOpen, claimOpen: a.claimOpen });

test("before approval: $10 held, $0 paid", () => {
  assert.deepEqual(pick(escrowAmounts(bounty({ funded: ref($(10)) }, FUTURE), NOW)),
    { held: $(10), paid: 0n, refunded: 0n, reserved: 0n, refundable: $(10), refundOpen: false, claimOpen: false });
});

test("$4 approved, before claim or refund: $10 held including $4 reserved; after expiry only $6 refundable", () => {
  const chain = { funded: ref($(10)), approved: ref($(4)) };
  const before = escrowAmounts(bounty(chain, FUTURE), NOW);
  assert.equal(before.held, $(10)); assert.equal(before.reserved, $(4)); assert.equal(before.refundOpen, false);
  const after = escrowAmounts(bounty(chain, PAST), NOW);
  assert.equal(after.refundable, $(6)); assert.equal(after.refundOpen, true); assert.equal(after.claimOpen, true);
});

test("claim first: $4 paid, $6 held; then the remainder refund: $4 paid, $6 refunded, $0 held", () => {
  const claimed = escrowAmounts(bounty({ funded: ref($(10)), approved: ref($(4)), paid: ref($(4)) }), NOW);
  assert.deepEqual(pick(claimed), { held: $(6), paid: $(4), refunded: 0n, reserved: 0n, refundable: $(6), refundOpen: true, claimOpen: false });
  const done = escrowAmounts(bounty({ funded: ref($(10)), approved: ref($(4)), paid: ref($(4)), refunded: ref($(6)) }), NOW);
  assert.deepEqual(pick(done), { held: 0n, paid: $(4), refunded: $(6), reserved: 0n, refundable: 0n, refundOpen: false, claimOpen: false });
});

test("refund first: $6 refunded, $4 still held and reserved; the recipient then claims $4, ending $0 held", () => {
  const refunded = escrowAmounts(bounty({ funded: ref($(10)), approved: ref($(4)), refunded: ref($(6)) }), NOW);
  assert.deepEqual(pick(refunded), { held: $(4), paid: 0n, refunded: $(6), reserved: $(4), refundable: 0n, refundOpen: false, claimOpen: true });
  const done = escrowAmounts(bounty({ funded: ref($(10)), approved: ref($(4)), refunded: ref($(6)), paid: ref($(4)) }), NOW);
  assert.deepEqual(pick(done), { held: 0n, paid: $(4), refunded: $(6), reserved: 0n, refundable: 0n, refundOpen: false, claimOpen: false });
});

test("a full $10 approval leaves nothing refundable; an already-refunded remainder is not offered again", () => {
  const full = escrowAmounts(bounty({ funded: ref($(10)), approved: ref($(10)) }), NOW);
  assert.equal(full.refundable, 0n); assert.equal(full.refundOpen, false);
  const again = escrowAmounts(bounty({ funded: ref($(10)), approved: ref($(4)), refunded: ref($(6)) }), NOW);
  assert.equal(again.refundOpen, false);
});

test("no approval and expired: the full $10 is refundable", () => {
  const a = escrowAmounts(bounty({ funded: ref($(10)) }), NOW);
  assert.equal(a.refundable, $(10)); assert.equal(a.refundOpen, true);
});

test("unconfirmed money changes nothing: no funding event means $0 held; a prepared approval reserves nothing", () => {
  const pending = escrowAmounts(bounty({}), NOW);
  assert.equal(pending.held, 0n); assert.equal(pending.refundOpen, false);
  // A prepared or signed approval has no RewardApproved event yet: the full $10 stays unreserved.
  const prepared = escrowAmounts(bounty({ funded: ref($(10)) }, FUTURE), NOW);
  assert.equal(prepared.reserved, 0n);
});

test("dashboard totals add confirmed amounts, not status labels", () => {
  const t = totalAmounts([
    bounty({ funded: ref($(10)), approved: ref($(4)), paid: ref($(4)) }), // paid, $6 still held
    bounty({ funded: ref($(10)), approved: ref($(4)) }), // expired, $4 reserved + $6 remainder
    bounty({ funded: ref($(5)), refunded: ref($(5)) }), // fully refunded
    bounty({}), // not funded yet
  ], NOW);
  assert.deepEqual(t, { held: $(16), paid: $(4), refunded: $(5), reserved: $(4), paidCount: 1 });
});
