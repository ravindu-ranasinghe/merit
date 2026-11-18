import { encodeAbiParameters, encodeEventTopics, keccak256, type Hex } from "viem";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { claimId, escrowAbi, prHash } from "../src/chain/escrow.js";
import { approvals, bounties, chain_events, pull_requests } from "../src/db/schema.js";
import { qnSign } from "../src/streams/webhook.js";
import { project } from "../src/streams/project.js";
import { DEMO, ESCROW, QN_TOKEN, setup, type Harness } from "./helpers.js";

let h: Harness;
beforeEach(async () => { h?.close && (await h.close()); h = await setup(); });
afterAll(() => h.close());

const FUNDER = "0x00000000000000000000000000000000000000f1";
const REVIEWER = "0x00000000000000000000000000000000000000a2";
const BID = 7n, AMOUNT = 10_000_000n;
const hash = (n: number) => keccak256(`0x${n.toString(16).padStart(2, "0")}`);
const CLAIM = claimId(5550001);
const PRH = prHash(DEMO.repoId, DEMO.prNumber);

type Spec = { name: "BountyFunded" | "RewardApproved" | "RewardPaid" | "BountyRefunded"; args: Record<string, unknown>; types: { type: string }[]; data: unknown[] };
const EV = {
  funded: { name: "BountyFunded", args: { bountyId: BID, funder: FUNDER, prHash: PRH }, types: [{ type: "uint256" }, { type: "uint64" }], data: [AMOUNT, 4102444800n] },
  approved: { name: "RewardApproved", args: { bountyId: BID, recipient: REVIEWER }, types: [{ type: "uint256" }, { type: "bytes32" }], data: [AMOUNT, CLAIM] },
  paid: { name: "RewardPaid", args: { bountyId: BID, recipient: REVIEWER }, types: [{ type: "uint256" }, { type: "bytes32" }], data: [AMOUNT, CLAIM] },
  refunded: { name: "BountyRefunded", args: { bountyId: BID, funder: FUNDER }, types: [{ type: "uint256" }], data: [3_000_000n] },
} satisfies Record<string, Spec>;

function log(s: Spec, block: number, logIndex: number, tx = hash(block * 10 + logIndex)) {
  const topics = encodeEventTopics({ abi: escrowAbi, eventName: s.name, args: s.args } as never);
  return { address: ESCROW, topics, data: encodeAbiParameters(s.types as never, s.data as never) as Hex, blockNumber: `0x${block.toString(16)}`, transactionHash: tx, logIndex: `0x${logIndex.toString(16)}` };
}
const deliver = (logs: unknown[], shape: "data" | "array" = "data", token = QN_TOKEN) => {
  const body = JSON.stringify(shape === "data" ? { data: [logs] } : logs);
  const nonce = "n-123", ts = "1700000000";
  return h.app.inject({ method: "POST", url: "/webhooks/streams", payload: body, headers: { "content-type": "application/json", "x-qn-nonce": nonce, "x-qn-timestamp": ts, "x-qn-signature": qnSign(token, nonce, ts, body) } });
};

async function seedBounty(withApproval = false) {
  const [pr] = await h.db.select().from(pull_requests);
  const [b] = await h.db.insert(bounties).values({ pr_id: pr!.id, funder_wallet: FUNDER, amount_units: "10000000", deadline: new Date("2100-01-01"), status: "funding_pending" }).returning();
  if (withApproval) {
    const { review_candidates } = await import("../src/db/schema.js");
    const [c] = await h.db.insert(review_candidates).values({ pr_id: pr!.id, github_comment_id: 5550001, github_reviewer_id: DEMO.reviewerId, file_path: "a", diff_hunk: "", commit_sha: "x", status: "confirmed", qualification_evidence: { method: "manual", limitations: "l" } }).returning();
    await h.db.insert(approvals).values({ bounty_id: b!.id, candidate_id: c!.id, reviewer_id: DEMO.reviewerId, approver_github_id: DEMO.maintainerId, amount_units: "10000000", approved_recipient: REVIEWER, claim_id: CLAIM });
  }
  return b!;
}
const state = async () => {
  const [b] = await h.db.select().from(bounties);
  return { status: b!.status, onchain: b!.onchain_bounty_id, funder: b!.funder_wallet };
};

describe("POST /webhooks/streams", () => {
  it("rejects a bad signature", async () => {
    expect((await deliver([log(EV.funded, 1, 0)], "data", "wrong-token")).statusCode).toBe(401);
    expect(await h.db.select().from(chain_events)).toHaveLength(0);
  });

  it("persists BountyFunded, links the bounty by pr_hash and marks it funded", async () => {
    await seedBounty();
    const r = await deliver([log(EV.funded, 1, 0)]);
    expect(r.json()).toEqual({ ok: true, inserted: 1 });
    expect(await state()).toEqual({ status: "funded", onchain: "7", funder: FUNDER });
  });

  it("accepts a bare array of logs and ignores logs from other contracts", async () => {
    await seedBounty();
    const foreign = { ...log(EV.funded, 1, 1), address: "0x0000000000000000000000000000000000000bad" };
    await deliver([log(EV.funded, 1, 0), foreign], "array");
    expect(await h.db.select().from(chain_events)).toHaveLength(1);
  });

  it("the same event delivered 3 times makes one row and one transition", async () => {
    await seedBounty();
    const l = log(EV.funded, 1, 0);
    const results = [await deliver([l]), await deliver([l]), await deliver([l])];
    expect(results.map((r) => r.json().inserted)).toEqual([1, 0, 0]);
    expect(await h.db.select().from(chain_events)).toHaveLength(1);
    expect((await state()).status).toBe("funded");
  });

  it("full lifecycle, replayed 3x: one paid approval, status paid", async () => {
    await seedBounty(true);
    const logs = [log(EV.funded, 1, 0), log(EV.approved, 2, 0), log(EV.paid, 3, 0)];
    for (let i = 0; i < 3; i++) await deliver(logs);
    expect(await h.db.select().from(chain_events)).toHaveLength(3);
    const apps = await h.db.select().from(approvals);
    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({ status: "paid", chain_tx_hash: hash(20) });
    expect((await state()).status).toBe("paid");
  });

  it("out-of-order delivery (Paid before Funded) converges to the same final state", async () => {
    await seedBounty(true);
    await deliver([log(EV.paid, 3, 0)]);
    await deliver([log(EV.approved, 2, 0)]);
    await deliver([log(EV.funded, 1, 0)]);
    expect(await state()).toEqual({ status: "paid", onchain: "7", funder: FUNDER });
    const apps = await h.db.select().from(approvals);
    expect(apps.map((a) => a.status)).toEqual(["paid"]);
  });

  it("backfill of the whole history after live delivery changes nothing", async () => {
    await seedBounty(true);
    await deliver([log(EV.funded, 1, 0)]);
    await deliver([log(EV.approved, 2, 0)]);
    const before = JSON.stringify(await h.db.select().from(approvals));
    await deliver([log(EV.funded, 1, 0), log(EV.approved, 2, 0)]); // backfill overlaps
    expect(JSON.stringify(await h.db.select().from(approvals))).toBe(before);
    expect((await state()).status).toBe("claimable");
    expect(await h.db.select().from(chain_events)).toHaveLength(2);
  });

  it("RewardApproved then a partial BountyRefunded stays claimable", async () => {
    await seedBounty(true);
    await deliver([log(EV.funded, 1, 0), log(EV.approved, 2, 0), log(EV.refunded, 3, 0)]);
    expect((await state()).status).toBe("claimable");
  });

  it("re-delivering an old bounty's events never links them to a newer bounty on the same PR", async () => {
    // Bounty A is funded and refunded; the maintainer then opens bounty B on the same PR, not yet funded.
    const a = await seedBounty();
    await deliver([log(EV.funded, 1, 0), log(EV.refunded, 2, 0)]);
    const [pr] = await h.db.select().from(pull_requests);
    const [b] = await h.db.insert(bounties).values({ pr_id: pr!.id, amount_units: "5000000", deadline: new Date("2100-01-01"), status: "funding_pending" }).returning();
    // A backfill, a retry or a late event for A arrives again.
    const r = await deliver([log(EV.funded, 1, 0), log(EV.refunded, 2, 0)]);
    expect(r.statusCode).toBe(200);
    const rows = Object.fromEntries((await h.db.select().from(bounties)).map((x) => [x.id, x]));
    expect(rows[a.id]).toMatchObject({ onchain_bounty_id: "7", status: "refunded" });
    expect(rows[b!.id]).toMatchObject({ onchain_bounty_id: null, status: "funding_pending", amount_units: "5000000" });
  });

  it("a plain BountyRefunded (nothing approved) is refunded", async () => {
    await seedBounty();
    await deliver([log(EV.funded, 1, 0), log(EV.refunded, 2, 0)]);
    expect((await state()).status).toBe("refunded");
  });
});

describe("SQL constraints", () => {
  it("chain_events rejects a duplicate (chain_id, contract, tx_hash, log_index)", async () => {
    const row = { chain_id: 1, contract: "0xc", tx_hash: "0xt", log_index: 0, event_type: "BountyFunded", payload: {}, block_number: 1 };
    await h.db.insert(chain_events).values(row);
    await expect(h.db.insert(chain_events).values(row)).rejects.toThrow();
  });

  it("bounties.onchain_bounty_id is unique", async () => {
    const [pr] = await h.db.select().from(pull_requests);
    const v = { pr_id: pr!.id, amount_units: "1", deadline: new Date(), onchain_bounty_id: "9" };
    await h.db.insert(bounties).values(v);
    await expect(h.db.insert(bounties).values(v)).rejects.toThrow();
  });

  it("at most one signed/paid approval per bounty", async () => {
    const { review_candidates } = await import("../src/db/schema.js");
    const [pr] = await h.db.select().from(pull_requests);
    const b = await seedBounty();
    const mk = async (cid: number) => (await h.db.insert(review_candidates).values({ pr_id: pr!.id, github_comment_id: cid, github_reviewer_id: 3003, file_path: "a", diff_hunk: "", commit_sha: "x", qualification_evidence: {} }).returning())[0]!;
    const ap = (c: number, claim: string, status: string) => ({ bounty_id: b.id, candidate_id: c, reviewer_id: 3003, approver_github_id: 1001, amount_units: "1", approved_recipient: "0xa", claim_id: claim, status });
    const [c1, c2, c3] = [await mk(1), await mk(2), await mk(3)];
    await h.db.insert(approvals).values(ap(c1.id, "c1", "paid"));
    await expect(h.db.insert(approvals).values(ap(c2.id, "c2", "signed"))).rejects.toThrow();
    await h.db.insert(approvals).values(ap(c3.id, "c3", "prepared")); // prepared rows are unrestricted
    await expect(h.db.insert(approvals).values(ap(c3.id, "c1", "prepared"))).rejects.toThrow(); // claim_id unique
  });

  it("wallet_links is unique per github_user_id", async () => {
    const { wallet_links } = await import("../src/db/schema.js");
    const v = { github_user_id: 5, wallet_address: "0xa", signed_challenge: "{}", verified_at: new Date() };
    await h.db.insert(wallet_links).values(v);
    await expect(h.db.insert(wallet_links).values(v)).rejects.toThrow();
  });
});

describe("project()", () => {
  const base = { deadlineMs: 2000, nowMs: 1000, hasCandidate: false, hasApproval: false };
  it("precedence is paid > claimable > refunded > funded", () => {
    expect(project({ ...base, events: ["BountyFunded", "RewardApproved", "BountyRefunded", "RewardPaid"] })).toBe("paid");
    expect(project({ ...base, events: ["BountyRefunded", "RewardApproved"] })).toBe("claimable");
    expect(project({ ...base, events: ["BountyFunded", "BountyRefunded"] })).toBe("refunded");
  });
  it("offchain overlays only apply while the chain says funded", () => {
    const e = ["BountyFunded"];
    expect(project({ ...base, events: e, hasCandidate: true })).toBe("review_candidate");
    expect(project({ ...base, events: e, hasApproval: true })).toBe("approved");
    expect(project({ ...base, events: e, nowMs: 3000 })).toBe("expired");
    expect(project({ ...base, events: ["BountyFunded", "RewardPaid"], hasCandidate: true, nowMs: 3000 })).toBe("paid");
    expect(project({ ...base, events: [] })).toBe("funding_pending");
  });
});
