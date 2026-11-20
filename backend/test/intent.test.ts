import { and, eq } from "drizzle-orm";
import { encodeAbiParameters, encodeEventTopics, keccak256, type Hex } from "viem";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { claimId, escrowAbi, prHash } from "../src/chain/escrow.js";
import { approvals, bounties, chain_events, pull_requests, review_candidates, wallet_links } from "../src/db/schema.js";
import { qnSign, reconcile } from "../src/streams/webhook.js";
import { DEMO, ESCROW, QN_TOKEN, setup, type Harness } from "./helpers.js";

/**
 * Event-to-bounty identity. PR hashes and claim ids are public, so anyone can emit escrow events carrying
 * them. These cases pin that such events can neither bind to nor advance nor be credited to someone else's
 * bounty. They are about Merit's records; they say nothing about escrowed funds, which the contract guards.
 */

let h: Harness;
beforeEach(async () => { h?.close && (await h.close()); h = await setup(); });
afterAll(() => h.close());

const MAINTAINER = "0x00000000000000000000000000000000000000f1";
const ATTACKER = "0x00000000000000000000000000000000000000bd";
const REVIEWER = "0x00000000000000000000000000000000000000a2";
const OTHER = "0x00000000000000000000000000000000000000c3";
const EXPIRY = 4102444800n; // 2100-01-01T00:00:00Z
const PRH = prHash(DEMO.repoId, DEMO.prNumber);
const CLAIM = claimId(5550001);
const M = DEMO.maintainerId;

let txn = 0;
const raw = (eventName: string, args: Record<string, unknown>, types: { type: string }[], data: unknown[], block: number) => ({
  address: ESCROW,
  topics: encodeEventTopics({ abi: escrowAbi, eventName, args } as never),
  data: encodeAbiParameters(types as never, data as never) as Hex,
  blockNumber: `0x${block.toString(16)}`, transactionHash: keccak256(`0x${(++txn).toString(16).padStart(4, "0")}`), logIndex: "0x0",
});
const funded = (id: bigint, funder: string, amount = 10_000_000n, expiry = EXPIRY, ph: Hex = PRH, block = 1) =>
  raw("BountyFunded", { bountyId: id, funder, prHash: ph }, [{ type: "uint256" }, { type: "uint64" }], [amount, expiry], block);
const approved = (id: bigint, recipient = REVIEWER, amount = 10_000_000n, claim: Hex = CLAIM, block = 2) =>
  raw("RewardApproved", { bountyId: id, recipient }, [{ type: "uint256" }, { type: "bytes32" }], [amount, claim], block);
const paid = (id: bigint, recipient = REVIEWER, amount = 10_000_000n, claim: Hex = CLAIM, block = 3) =>
  raw("RewardPaid", { bountyId: id, recipient }, [{ type: "uint256" }, { type: "bytes32" }], [amount, claim], block);

const deliver = (logs: unknown[]) => {
  const body = JSON.stringify({ data: [logs] });
  return h.app.inject({ method: "POST", url: "/webhooks/streams", payload: body,
    headers: { "content-type": "application/json", "x-qn-nonce": "n", "x-qn-timestamp": "1", "x-qn-signature": qnSign(QN_TOKEN, "n", "1", body) } });
};
const linkWallet = (uid: number, addr: string) =>
  h.db.insert(wallet_links).values({ github_user_id: uid, wallet_address: addr, signed_challenge: "{}", verified_at: new Date() });
const create = (over: object = {}, uid = M) => h.app.inject({ method: "POST", url: "/bounties", headers: h.cookie(uid),
  payload: { github_repo_id: DEMO.repoId, pr_number: DEMO.prNumber, amount_units: "10000000", expiry: Number(EXPIRY), ...over } });
const bountyRow = async (id: number) => (await h.db.select().from(bounties).where(eq(bounties.id, id)))[0]!;

/** The maintainer's pending intent created through the real route: funder taken from their verified wallet link. */
async function intent() {
  await linkWallet(M, MAINTAINER);
  const r = await create();
  expect(r.statusCode).toBe(201);
  return r.json().bounty.id as number;
}

describe("funding intent at creation", () => {
  it("needs a verified wallet link, and records it as the intended funder", async () => {
    expect((await create()).statusCode).toBe(409);
    await linkWallet(M, "0x00000000000000000000000000000000000000AB");
    const r = await create();
    expect(r.statusCode).toBe(201);
    expect(r.json().bounty).toMatchObject({ status: "funding_pending", funder_wallet: "0x00000000000000000000000000000000000000ab", onchain_bounty_id: null });
  });

  it("two concurrent creations for one PR leave exactly one pending intent", async () => {
    await linkWallet(M, MAINTAINER);
    const codes = (await Promise.all([create(), create(), create()])).map((r) => r.statusCode).sort();
    expect(codes).toEqual([201, 409, 409]);
    expect(await h.db.select().from(bounties)).toHaveLength(1);
  });
});

describe("BountyFunded binds only the matching intent", () => {
  it("a wrong-wallet funding of the same PR arriving first cannot take the intent; the real one binds after", async () => {
    const id = await intent();
    expect((await deliver([funded(8n, ATTACKER)])).statusCode).toBe(200);
    expect(await bountyRow(id)).toMatchObject({ onchain_bounty_id: null, funder_wallet: MAINTAINER, amount_units: "10000000", status: "funding_pending" });

    await deliver([funded(9n, MAINTAINER, 10_000_000n, EXPIRY, PRH, 5)]);
    expect(await bountyRow(id)).toMatchObject({ onchain_bounty_id: "9", funder_wallet: MAINTAINER, status: "funded" });
    // The foreign event is kept in the ledger, attached to nothing.
    const ledger = await h.db.select().from(chain_events);
    expect(ledger.map((e) => e.onchain_bounty_id).sort()).toEqual(["8", "9"]);
    expect(await h.db.select().from(bounties).where(eq(bounties.onchain_bounty_id, "8"))).toHaveLength(0);
  });

  it("the right wallet with the wrong amount or the wrong expiry does not bind", async () => {
    const id = await intent();
    await deliver([funded(8n, MAINTAINER, 1_000_000n)]);
    await deliver([funded(9n, MAINTAINER, 10_000_000n, EXPIRY + 60n)]);
    expect(await bountyRow(id)).toMatchObject({ onchain_bounty_id: null, amount_units: "10000000", status: "funding_pending" });
    expect(Math.floor((await bountyRow(id)).deadline.getTime() / 1000)).toBe(Number(EXPIRY));
  });

  it("address case differences do not reject a legitimate match", async () => {
    await linkWallet(M, "0x00000000000000000000000000000000000000AB");
    const id = (await create()).json().bounty.id as number;
    await deliver([funded(7n, "0x00000000000000000000000000000000000000ab")]);
    expect(await bountyRow(id)).toMatchObject({ onchain_bounty_id: "7", status: "funded" });
  });

  it("a funding event indexed before its intent existed is bound when the intent is created", async () => {
    await deliver([funded(7n, MAINTAINER)]);
    const id = await intent();
    expect(await bountyRow(id)).toMatchObject({ onchain_bounty_id: "7", status: "funded" });
  });

  it("a pending row from before intents existed (no funder) never binds, and does not block a new bounty", async () => {
    const [pr] = await h.db.select().from(pull_requests);
    const [legacy] = await h.db.insert(bounties).values({ pr_id: pr!.id, amount_units: "10000000", deadline: new Date(Number(EXPIRY) * 1000), status: "funding_pending" }).returning();
    const id = await intent();
    await deliver([funded(7n, MAINTAINER)]);
    expect(await bountyRow(legacy!.id)).toMatchObject({ onchain_bounty_id: null, funder_wallet: null });
    expect(await bountyRow(id)).toMatchObject({ onchain_bounty_id: "7" });
  });

  it("duplicate and overlapping deliveries leave one ledger row per event and the same state", async () => {
    const id = await intent();
    const logs = [funded(7n, MAINTAINER), funded(8n, ATTACKER)];
    for (let i = 0; i < 3; i++) await deliver(logs);
    await deliver([logs[1], logs[0]]);
    expect(await h.db.select().from(chain_events)).toHaveLength(2);
    expect(await bountyRow(id)).toMatchObject({ onchain_bounty_id: "7", status: "funded" });
  });

  it.each(["chain", "contract"])("stored funding from another %s cannot bind or heal an intent", async (context) => {
    await h.db.insert(chain_events).values({
      chain_id: context === "chain" ? h.ctx.env.chainId + 1 : h.ctx.env.chainId,
      contract: context === "contract" ? ATTACKER : ESCROW,
      tx_hash: `0x${"11".repeat(32)}`, log_index: 0, event_type: "BountyFunded", block_number: 1,
      onchain_bounty_id: "7", payload: { bountyId: "7", funder: MAINTAINER, prHash: PRH, amount: "10000000", expiry: EXPIRY.toString() },
    });
    const id = await intent(); // the creation route also tries to heal early events
    await reconcile(h.ctx, "7");
    expect(await bountyRow(id)).toMatchObject({ onchain_bounty_id: null, status: "funding_pending" });
    await deliver([funded(7n, MAINTAINER)]);
    expect(await bountyRow(id)).toMatchObject({ onchain_bounty_id: "7", status: "funded" });
    expect(await h.db.select().from(chain_events)).toHaveLength(2); // preserve the unrelated history
  });
});

describe("approvals and payouts advance only this bounty's approval", () => {
  /** The victim: funded bounty 7 with a prepared approval for the reviewer's comment. */
  async function victim() {
    const id = await intent();
    await deliver([funded(7n, MAINTAINER)]);
    const [pr] = await h.db.select().from(pull_requests);
    const [c] = await h.db.insert(review_candidates).values({ pr_id: pr!.id, github_comment_id: 5550001, github_reviewer_id: DEMO.reviewerId, file_path: "a", diff_hunk: "", commit_sha: "x", status: "confirmed", qualification_evidence: { method: "manual", limitations: "l" } }).returning();
    const [a] = await h.db.insert(approvals).values({ bounty_id: id, candidate_id: c!.id, reviewer_id: DEMO.reviewerId, approver_github_id: M, amount_units: "10000000", approved_recipient: REVIEWER, claim_id: CLAIM }).returning();
    h.gh.users.set(DEMO.reviewerId, { id: DEMO.reviewerId, login: "jun-park" });
    return { id, approvalId: a!.id };
  }
  const approvalRow = async (id: number) => (await h.db.select().from(approvals).where(eq(approvals.id, id)))[0]!;
  const prComment = () => (h.gh.issueComments.get(`${DEMO.name}#${DEMO.prNumber}`) ?? [])[0]?.body ?? "";

  it.each(["chain", "contract"])("another %s cannot supply approval, payout, receipt or profile facts", async (context) => {
    const { id, approvalId } = await victim();
    for (const [i, event_type] of ["RewardApproved", "RewardPaid"].entries()) {
      await h.db.insert(chain_events).values({
        chain_id: context === "chain" ? h.ctx.env.chainId + 1 : h.ctx.env.chainId,
        contract: context === "contract" ? ATTACKER : ESCROW,
        tx_hash: `0x${(20 + i).toString(16).repeat(32)}`, log_index: 0, event_type, block_number: 10 + i,
        onchain_bounty_id: "7", payload: { bountyId: "7", recipient: REVIEWER, amount: "10000000", claimId: CLAIM },
      });
    }
    const [funding] = await h.db.select().from(chain_events).where(eq(chain_events.event_type, "BountyFunded"));
    await deliver([{ ...funded(7n, MAINTAINER), transactionHash: funding!.tx_hash }]); // duplicate delivery cannot import the foreign payout
    expect(await approvalRow(approvalId)).toMatchObject({ status: "prepared", chain_tx_hash: null });
    expect(prComment()).not.toContain("jun-park");
    const detail = (await h.app.inject({ url: `/bounties/${id}` })).json();
    expect(detail.status).toBe("approved");
    expect(detail.events.map((e: { event_type: string }) => e.event_type)).toEqual(["BountyFunded"]);
    const list = (await h.app.inject({ url: "/bounties" })).json();
    expect(list.bounties[0].events).toHaveLength(1);
    const feed = (await h.app.inject({ url: `/events?bounty_id=${id}` })).json();
    expect(feed.events).toHaveLength(1);
    const profile = (await h.app.inject({ url: `/reviewers/${DEMO.reviewerId}` })).json();
    expect(profile.bounties[0].approvals).toEqual([]);
    expect(profile.bounties[0].events).toHaveLength(1);
    const me = (await h.app.inject({ url: "/me", headers: h.cookie(DEMO.reviewerId) })).json();
    expect(me.as_reviewer[0].bounty.events).toHaveLength(1);
  });

  it("a foreign bounty reusing the claim id cannot advance the approval or credit the reviewer", async () => {
    const { id, approvalId } = await victim();
    // Attacker's own bounty 8, on another PR they fund themselves, approving and paying the victim's public claim id.
    const otherPr = prHash(DEMO.repoId, 2);
    const [repoPr] = await h.db.select().from(pull_requests);
    const [pr2] = await h.db.insert(pull_requests).values({ repo_id: repoPr!.repo_id, github_pr_number: 2, head_sha: "h", status: "open", author_github_id: DEMO.authorId, pr_hash: otherPr }).returning();
    await h.db.insert(bounties).values({ pr_id: pr2!.id, funder_wallet: ATTACKER, amount_units: "10000000", deadline: new Date(Number(EXPIRY) * 1000) });
    await deliver([funded(8n, ATTACKER, 10_000_000n, EXPIRY, otherPr, 10), approved(8n, REVIEWER, 10_000_000n, CLAIM, 11), paid(8n, REVIEWER, 10_000_000n, CLAIM, 12)]);
    // And an unattached bounty 9 doing the same.
    await deliver([approved(9n), paid(9n)]);

    expect(await approvalRow(approvalId)).toMatchObject({ status: "prepared", chain_tx_hash: null });
    const victimRow = await bountyRow(id);
    expect(victimRow.onchain_bounty_id).toBe("7");
    expect(["claimable", "paid"]).not.toContain(victimRow.status);
    expect(prComment()).not.toContain("jun-park");
  });

  it("this bounty's event with the wrong recipient or amount cannot advance it; the right one does", async () => {
    const { approvalId } = await victim();
    await deliver([approved(7n, OTHER)]);
    expect(await approvalRow(approvalId)).toMatchObject({ status: "prepared", chain_tx_hash: null });
    expect(prComment()).not.toContain("jun-park");

    // Fresh harness for the amount case: the contract allows only one approval per bounty.
    await h.close(); h = await setup();
    const second = await victim();
    await deliver([approved(7n, REVIEWER, 4_000_000n)]);
    expect(await approvalRow(second.approvalId)).toMatchObject({ status: "prepared", chain_tx_hash: null });
    expect(prComment()).not.toContain("jun-park");

    await h.close(); h = await setup();
    const third = await victim();
    await deliver([approved(7n)]);
    expect(await approvalRow(third.approvalId)).toMatchObject({ status: "signed" });
    expect(prComment()).toContain("@jun-park, your reward is ready to claim");
  });

  it("valid funding, approval and payment in any order converge on paid", async () => {
    const { id, approvalId } = await victim();
    await h.db.delete(chain_events); // replay the whole lifecycle from scratch, newest first
    await h.db.update(bounties).set({ onchain_bounty_id: null, status: "funding_pending" }).where(eq(bounties.id, id));
    await deliver([paid(7n)]);
    await deliver([approved(7n)]);
    await deliver([funded(7n, MAINTAINER)]);
    expect(await approvalRow(approvalId)).toMatchObject({ status: "paid" });
    expect(await bountyRow(id)).toMatchObject({ onchain_bounty_id: "7", status: "paid" });
    const linked = await h.db.select().from(approvals).where(and(eq(approvals.bounty_id, id), eq(approvals.status, "paid")));
    expect(linked).toHaveLength(1);
  });
});
