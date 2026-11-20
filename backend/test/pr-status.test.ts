import { encodeAbiParameters, encodeEventTopics, keccak256, type Hex } from "viem";
import Fastify from "fastify";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb } from "../src/db/index.js";
import { claimId, escrowAbi, prHash } from "../src/chain/escrow.js";
import { approvals, bounties, chain_events, pull_requests, review_candidates } from "../src/db/schema.js";
import { marker, renderStatusComment, stageOf, syncPrStatusComment, usd } from "../src/github/pr-status.js";
import { loadEnv } from "../src/env.js";
import { buildApp } from "../src/fastify-app.js";
import { qnSign } from "../src/streams/webhook.js";
import { DEMO, ESCROW, QN_TOKEN, setup, type Harness } from "./helpers.js";

let h: Harness;
beforeEach(async () => { h?.close && (await h.close()); h = await setup(); });
afterAll(() => h.close());

const FUNDER = "0x00000000000000000000000000000000000000f1";
const REVIEWER = "0x00000000000000000000000000000000000000a2";
const BID = 7n, AMOUNT = 10_000_000n;
const CLAIM = claimId(5550001);
const PRH = prHash(DEMO.repoId, DEMO.prNumber);
const hash = (n: number) => keccak256(`0x${n.toString(16).padStart(2, "0")}`);

type Spec = { name: "BountyFunded" | "RewardApproved" | "RewardPaid" | "BountyRefunded"; args: Record<string, unknown>; types: { type: string }[]; data: unknown[] };
const EV = {
  funded: { name: "BountyFunded", args: { bountyId: BID, funder: FUNDER, prHash: PRH }, types: [{ type: "uint256" }, { type: "uint64" }], data: [AMOUNT, 4102444800n] },
  approved: { name: "RewardApproved", args: { bountyId: BID, recipient: REVIEWER }, types: [{ type: "uint256" }, { type: "bytes32" }], data: [AMOUNT, CLAIM] },
  paid: { name: "RewardPaid", args: { bountyId: BID, recipient: REVIEWER }, types: [{ type: "uint256" }, { type: "bytes32" }], data: [AMOUNT, CLAIM] },
  refunded: { name: "BountyRefunded", args: { bountyId: BID, funder: FUNDER }, types: [{ type: "uint256" }], data: [AMOUNT] },
} satisfies Record<string, Spec>;

function log(s: Spec, block: number) {
  const topics = encodeEventTopics({ abi: escrowAbi, eventName: s.name, args: s.args } as never) as string[];
  return { address: ESCROW, topics, data: encodeAbiParameters(s.types as never, s.data as never) as Hex, blockNumber: `0x${block.toString(16)}`, transactionHash: hash(block), logIndex: "0x0" };
}
const deliver = (logs: unknown[]) => {
  const body = JSON.stringify({ data: [logs] });
  return h.app.inject({ method: "POST", url: "/webhooks/streams", payload: body,
    headers: { "content-type": "application/json", "x-qn-nonce": "n", "x-qn-timestamp": "1", "x-qn-signature": qnSign(QN_TOKEN, "n", "1", body) } });
};

async function seedBounty(withApproval = false) {
  const [pr] = await h.db.select().from(pull_requests);
  const [b] = await h.db.insert(bounties).values({ pr_id: pr!.id, funder_wallet: FUNDER, amount_units: "10000000", deadline: new Date("2100-01-01"), status: "funding_pending" }).returning();
  if (withApproval) {
    const [c] = await h.db.insert(review_candidates).values({ pr_id: pr!.id, github_comment_id: 5550001, github_reviewer_id: DEMO.reviewerId, file_path: "a", diff_hunk: "", commit_sha: "x", status: "confirmed", qualification_evidence: { method: "manual", limitations: "l" } }).returning();
    await h.db.insert(approvals).values({ bounty_id: b!.id, candidate_id: c!.id, reviewer_id: DEMO.reviewerId, approver_github_id: DEMO.maintainerId, amount_units: "10000000", approved_recipient: REVIEWER, claim_id: CLAIM });
  }
  h.gh.users.set(DEMO.reviewerId, { id: DEMO.reviewerId, login: "jun-park" });
  return b!;
}
const comments = () => h.gh.issueComments.get(`${DEMO.name}#${DEMO.prNumber}`) ?? [];

describe("PR status comment from indexed events", () => {
  it("BountyFunded creates one comment on the PR", async () => {
    const b = await seedBounty();
    expect((await deliver([log(EV.funded, 1)])).statusCode).toBe(200);
    expect(comments()).toHaveLength(1);
    expect(comments()[0]!.body).toContain(marker(b.id));
    expect(comments()[0]!.body).toContain("$10.00 test USDC review reward · Funded");
    expect(comments()[0]!.body).toContain(`http://localhost:3000/bounties/${b.id}`);
  });

  it("independent database pools cannot both create the initial comment", async () => {
    await seedBounty();
    h.ctx.env.github.prComments = false;
    await deliver([log(EV.funded, 1)]);
    h.ctx.env.github.prComments = true;
    const other = createDb(h.ctx.env.databaseUrl);
    const original = h.gh.listIssueComments.bind(h.gh);
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const hold = new Promise<void>((resolve) => { release = resolve; });
    h.gh.listIssueComments = async (...args) => { entered(); await hold; return original(...args); };
    const first = syncPrStatusComment(h.ctx, "7");
    try {
      await started;
      expect(await syncPrStatusComment({ ...h.ctx, db: other.db }, "7")).toBe("skipped");
      release();
      expect(await first).toBe("created");
      expect(await syncPrStatusComment({ ...h.ctx, db: other.db }, "7")).toBe("unchanged");
      expect(h.gh.issueCommentWrites).toEqual({ create: 1, update: 0, delete: 0 });
    } finally { release(); await first; await other.pool.end(); }
  });

  it("cancellation releases the database lock before an uncooperative GitHub read returns", async () => {
    await seedBounty();
    h.ctx.env.github.prComments = false;
    await deliver([log(EV.funded, 1)]);
    h.ctx.env.github.prComments = true;
    const original = h.gh.listIssueComments.bind(h.gh);
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const hold = new Promise<void>((resolve) => { release = resolve; });
    h.gh.listIssueComments = async () => { entered(); await hold; return []; };
    const controller = new AbortController();
    const first = syncPrStatusComment(h.ctx, "7", controller.signal);
    try {
      await started;
      controller.abort(new Error("synthetic timeout"));
      await expect(first).rejects.toThrow("synthetic timeout");
      h.gh.listIssueComments = original;
      expect(await syncPrStatusComment(h.ctx, "7")).toBe("created");
      release();
      await new Promise((resolve) => setImmediate(resolve));
      expect(h.gh.issueCommentWrites).toEqual({ create: 1, update: 0, delete: 0 });
    } finally { release(); h.gh.listIssueComments = original; }
  });

  it("a replayed delivery neither posts nor edits anything", async () => {
    await seedBounty();
    for (let i = 0; i < 3; i++) await deliver([log(EV.funded, 1)]);
    expect(comments()).toHaveLength(1);
    expect(h.gh.issueCommentWrites).toEqual({ create: 1, update: 0, delete: 0 });
  });

  it("follows the lifecycle in one comment: mention when claimable, receipt link when paid", async () => {
    const b = await seedBounty(true);
    await deliver([log(EV.funded, 1)]);
    await deliver([log(EV.approved, 2)]);
    expect(comments()[0]!.body).toContain("@jun-park, your reward is ready to claim");
    await deliver([log(EV.paid, 3)]);
    expect(comments()).toHaveLength(1);
    const body = comments()[0]!.body;
    expect(body).toContain("review reward · Paid");
    expect(body).toContain(`/bounties/${b.id}/receipt`);
    expect(body).not.toContain("@jun-park"); // the paid stage links the profile instead of notifying again
    expect(h.gh.issueCommentWrites).toEqual({ create: 1, update: 2, delete: 0 });
  });

  it("a backfill of the whole history after live delivery changes nothing", async () => {
    await seedBounty(true);
    await deliver([log(EV.funded, 1)]);
    await deliver([log(EV.approved, 2)]);
    await deliver([log(EV.paid, 3)]);
    const before = { ...h.gh.issueCommentWrites };
    await deliver([log(EV.funded, 1), log(EV.approved, 2), log(EV.paid, 3)]);
    expect(h.gh.issueCommentWrites).toEqual(before);
  });

  it("out-of-order delivery ends on the same body as in-order delivery", async () => {
    await seedBounty(true);
    await deliver([log(EV.paid, 3)]); // no bounty linked yet: nothing to comment on
    expect(comments()).toHaveLength(0);
    await deliver([log(EV.approved, 2)]);
    await deliver([log(EV.funded, 1)]);
    expect(comments()).toHaveLength(1);
    expect(comments()[0]!.body).toContain("review reward · Paid");
  });

  it("GitHub failure never fails or blocks indexing", async () => {
    await seedBounty();
    h.gh.failIssueComments = true;
    const r = await deliver([log(EV.funded, 1)]);
    expect(r.statusCode).toBe(200);
    expect(await h.db.select().from(chain_events)).toHaveLength(1);
    expect((await h.db.select().from(bounties))[0]!.status).toBe("funded");
    h.gh.failIssueComments = false;
    await deliver([log(EV.funded, 1)]); // the next delivery (a retry or backfill) heals it
    expect(comments()).toHaveLength(1);
  });

  it("caps a four-bounty batch, prevents late comment writes and heals on replay", async () => {
    const [seedPr] = await h.db.select().from(pull_requests);
    const logs = [];
    for (let i = 0; i < 4; i++) {
      const number = DEMO.prNumber + i;
      const prh = prHash(DEMO.repoId, number);
      const pr = i === 0 ? seedPr! : (await h.db.insert(pull_requests).values({
        repo_id: seedPr!.repo_id, github_pr_number: number, head_sha: "synthetic-head", status: "open",
        author_github_id: seedPr!.author_github_id, pr_hash: prh,
      }).returning())[0]!;
      await h.db.insert(bounties).values({
        pr_id: pr.id, funder_wallet: FUNDER, amount_units: "10000000", deadline: new Date("2100-01-01"), status: "funding_pending",
      });
      logs.push(log({ ...EV.funded, args: { bountyId: BID + BigInt(i), funder: FUNDER, prHash: prh } }, 10 + i));
    }

    const original = h.gh.listIssueComments.bind(h.gh);
    let release!: () => void;
    let signal: AbortSignal | undefined;
    // Deliberately ignore cancellation like a late response from an installation-token lookup.
    const stalled = new Promise<void>((resolve) => { release = resolve; });
    const reads = vi.fn(async (_i: number, _repo: string, _n: number, abort?: AbortSignal) => {
      signal = abort;
      await stalled;
      return [];
    });
    h.gh.listIssueComments = reads;
    const warnings: unknown[] = [];
    await h.app.close();
    h.app = await buildApp(h.ctx, { app: Fastify({ logger: { stream: { write(line: string) {
      const record = JSON.parse(line);
      if (record.level === 40) warnings.push(record);
    } } } }) });
    await h.app.ready();

    h.ctx.canonical.observe(logs);
    const start = performance.now();
    try {
      const response = await deliver(logs);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true, inserted: 4 });
      expect(performance.now() - start).toBeLessThan(11000);
      expect(signal?.aborted).toBe(true);
      expect(reads).toHaveBeenCalledTimes(1);
      expect(warnings).toHaveLength(4);
      expect(await h.db.select().from(chain_events)).toHaveLength(4);
      expect((await h.db.select().from(bounties)).map((b) => b.status)).toEqual(["funded", "funded", "funded", "funded"]);
    } finally {
      release();
      // An aborted call must not enqueue another sync; let the late response settle before replay.
      await expect(syncPrStatusComment(h.ctx, "7", signal)).rejects.toThrow();
      await new Promise((resolve) => setImmediate(resolve));
      h.gh.listIssueComments = original;
    }
    expect(h.gh.issueCommentWrites.create).toBe(0);
    expect((await deliver(logs)).json()).toEqual({ ok: true, inserted: 0 });
    expect(h.gh.issueCommentWrites).toEqual({ create: 4, update: 0, delete: 0 });
    expect(await h.db.select().from(chain_events)).toHaveLength(4);
    await deliver(logs);
    expect(h.gh.issueCommentWrites).toEqual({ create: 4, update: 0, delete: 0 });
  }, 15000);

  it("ignores a user comment that copies the marker, and removes duplicate Merit comments", async () => {
    const b = await seedBounty();
    const key = `${DEMO.name}#${DEMO.prNumber}`;
    h.gh.issueComments.set(key, [
      { id: 900, body: `${marker(b.id)} I am not Merit`, appId: null },
      { id: 901, body: `${marker(b.id)} old`, appId: h.gh.appId },
      { id: 902, body: `${marker(b.id)} racing duplicate`, appId: h.gh.appId },
    ]);
    await deliver([log(EV.funded, 1)]);
    const list = comments();
    expect(list.map((c) => c.id)).toEqual([900, 901]);
    expect(list[0]!.body).toContain("I am not Merit");
    expect(list[1]!.body).toContain("review reward · Funded");
  });

  it("GITHUB_PR_COMMENTS=0 turns the feature off", async () => {
    await seedBounty();
    h.ctx.env.github.prComments = false;
    await deliver([log(EV.funded, 1)]);
    expect(comments()).toHaveLength(0);
  });
});

describe("rendering", () => {
  const base = { bountyId: 3, amountUnits: "7500000", deadline: new Date("2026-11-24T00:00:00Z"), reviewerLogin: "jun-park", tx: {}, webOrigin: "https://merit.example/", explorerUrl: "https://explorer.testnet.arc.io" };
  it("formats units with BigInt and states the deadline", () => {
    expect(usd("10000000")).toBe("$10.00");
    expect(usd("1234567")).toBe("$1.234567");
    expect(usd("1000000000000")).toBe("$1,000,000.00");
    const body = renderStatusComment({ ...base, stage: "funded", tx: { funded: "0xabc" } });
    expect(body).toContain("$7.50 test USDC");
    expect(body).toContain("open until Nov 24, 2026");
    expect(body).toContain("[Funding transaction](https://explorer.testnet.arc.io/tx/0xabc)");
    expect(body).toContain("https://merit.example/bounties/3");
  });
  it("mentions nobody when the reviewer login is unknown", () => {
    expect(renderStatusComment({ ...base, stage: "claimable", reviewerLogin: null })).not.toContain("@");
  });
  it("stage is chain-confirmed only", () => {
    expect(stageOf([])).toBeNull();
    expect(stageOf(["BountyFunded", "BountyRefunded", "RewardApproved"])).toBe("claimable");
    expect(stageOf(["BountyFunded", "BountyRefunded"])).toBe("refunded");
  });
  it("env flag defaults on and parses 0", () => {
    expect(loadEnv({ DATABASE_URL: "x" }).github.prComments).toBe(true);
    expect(loadEnv({ DATABASE_URL: "x", GITHUB_PR_COMMENTS: "0" }).github.prComments).toBe(false);
  });
});
