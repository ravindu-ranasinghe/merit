import { encodeAbiParameters, encodeEventTopics, keccak256, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { claimId, escrowAbi, prHash } from "../src/chain/escrow.js";
import { approvals, bounties, pull_requests, review_candidates, wallet_links } from "../src/db/schema.js";
import { qnSign } from "../src/streams/webhook.js";
import { DEMO, ESCROW, QN_TOKEN, setup, type Harness } from "./helpers.js";

let h: Harness;
beforeEach(async () => { h?.close && (await h.close()); h = await setup(); });
afterAll(() => h.close());

const FUNDER = "0x00000000000000000000000000000000000000f1";
const REVIEWER = privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
const COMMENT = 5550001;
const M = DEMO.maintainerId;

async function fundedBounty() {
  const [pr] = await h.db.select().from(pull_requests);
  const [b] = await h.db.insert(bounties).values({ pr_id: pr!.id, funder_wallet: FUNDER, amount_units: "10000000", deadline: new Date("2100-01-01"), status: "funding_pending" }).returning();
  const topics = encodeEventTopics({ abi: escrowAbi, eventName: "BountyFunded", args: { bountyId: 7n, funder: FUNDER as Hex, prHash: prHash(DEMO.repoId, DEMO.prNumber) } } as never);
  const data = encodeAbiParameters([{ type: "uint256" }, { type: "uint64" }], [10_000_000n, 4102444800n]);
  await stream([{ address: ESCROW, topics, data, blockNumber: "0x1", transactionHash: keccak256("0x01"), logIndex: "0x0" }]);
  return b!;
}
async function stream(logs: unknown[]) {
  const body = JSON.stringify({ data: [logs] });
  return h.app.inject({ method: "POST", url: "/webhooks/streams", payload: body, headers: { "content-type": "application/json", "x-qn-nonce": "n", "x-qn-timestamp": "1", "x-qn-signature": qnSign(QN_TOKEN, "n", "1", body) } });
}
const addCandidate = async (status = "confirmed", reviewer: number = DEMO.reviewerId, comment = COMMENT) => {
  const [pr] = await h.db.select().from(pull_requests);
  return (await h.db.insert(review_candidates).values({ pr_id: pr!.id, github_comment_id: comment, github_reviewer_id: reviewer, file_path: "src/a.ts", diff_hunk: "@@", commit_sha: "c1", status, qualification_evidence: { method: "heuristic", limitations: "l" } }).returning())[0]!;
};
const linkWallet = (uid: number = DEMO.reviewerId, addr = REVIEWER) =>
  h.db.insert(wallet_links).values({ github_user_id: uid, wallet_address: addr, signed_challenge: "{}", verified_at: new Date() });
const approve = (bid: number, body: object, uid = M) => h.app.inject({ method: "POST", url: `/bounties/${bid}/approvals`, headers: h.cookie(uid), payload: body });

describe("approval gate", () => {
  it("prepares approveReward for the linked wallet only, with a derived claimId", async () => {
    const b = await fundedBounty(); const c = await addCandidate(); await linkWallet();
    const r = await approve(b.id, { candidate_id: c.id });
    expect(r.statusCode).toBe(201);
    const j = r.json();
    expect(j.funder_wallet).toBe(FUNDER);
    expect(j.tx).toMatchObject({ chainId: 5042002, to: ESCROW, functionName: "approveReward", args: ["7", REVIEWER, "10000000", claimId(COMMENT)] });
    expect(j.tx.data).toMatch(/^0x[0-9a-f]+$/);
    expect(j.approval).toMatchObject({ status: "prepared", approver_github_id: M, approved_recipient: REVIEWER, amount_units: "10000000" });
  });

  it("rejects a caller who is not a maintainer (live GitHub check), even with a valid session", async () => {
    const b = await fundedBounty(); const c = await addCandidate(); await linkWallet();
    expect((await approve(b.id, { candidate_id: c.id }, DEMO.authorId)).statusCode).toBe(403);
    expect(await h.db.select().from(approvals)).toHaveLength(0);
  });

  it("uses the permission GitHub reports now, not a stale one", async () => {
    const b = await fundedBounty(); const c = await addCandidate(); await linkWallet();
    h.gh.permissions.set(`${DEMO.name}:${M}`, "write"); // demoted since login
    expect((await approve(b.id, { candidate_id: c.id })).statusCode).toBe(403);
  });

  it("requires a session", async () => {
    const b = await fundedBounty();
    expect((await h.app.inject({ method: "POST", url: `/bounties/${b.id}/approvals`, payload: { candidate_id: 1 } })).statusCode).toBe(401);
  });

  it("rejects when the reviewer has no linked wallet", async () => {
    const b = await fundedBounty(); const c = await addCandidate();
    const r = await approve(b.id, { candidate_id: c.id });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toMatch(/wallet/);
  });

  it("rejects the PR author as reviewer, matched by id", async () => {
    const b = await fundedBounty(); const c = await addCandidate("confirmed", DEMO.authorId, 1); await linkWallet(DEMO.authorId);
    expect((await approve(b.id, { candidate_id: c.id })).statusCode).toBe(403);
  });

  it("rejects an approver approving their own review", async () => {
    const b = await fundedBounty(); const c = await addCandidate("confirmed", M, 2); await linkWallet(M);
    expect((await approve(b.id, { candidate_id: c.id })).statusCode).toBe(403);
  });

  it("rejects a pending or rejected candidate", async () => {
    const b = await fundedBounty(); await linkWallet();
    const p = await addCandidate("pending", DEMO.reviewerId, 11);
    expect((await approve(b.id, { candidate_id: p.id })).statusCode).toBe(409);
    const x = await addCandidate("rejected", DEMO.reviewerId, 12);
    expect((await approve(b.id, { candidate_id: x.id })).statusCode).toBe(409);
  });

  it("rejects an amount above the funded amount", async () => {
    const b = await fundedBounty(); const c = await addCandidate(); await linkWallet();
    expect((await approve(b.id, { candidate_id: c.id, amount_units: "10000001" })).statusCode).toBe(400);
    expect((await approve(b.id, { candidate_id: c.id, amount_units: "-5" })).statusCode).toBe(400);
  });

  it("rejects a recipient equal to the funder wallet", async () => {
    const b = await fundedBounty(); const c = await addCandidate(); await linkWallet(DEMO.reviewerId, FUNDER);
    expect((await approve(b.id, { candidate_id: c.id })).statusCode).toBe(403);
  });

  it("rejects approval of a bounty that is not funded onchain", async () => {
    const [pr] = await h.db.select().from(pull_requests);
    const [b] = await h.db.insert(bounties).values({ pr_id: pr!.id, amount_units: "1", deadline: new Date("2100-01-01") }).returning();
    const c = await addCandidate(); await linkWallet();
    expect((await approve(b!.id, { candidate_id: c.id })).statusCode).toBe(409);
  });

  it("preparing twice returns the same claimId without a duplicate row", async () => {
    const b = await fundedBounty(); const c = await addCandidate(); await linkWallet();
    const a = (await approve(b.id, { candidate_id: c.id })).json();
    const again = (await approve(b.id, { candidate_id: c.id, amount_units: "5000000" })).json();
    expect(again.approval.id).toBe(a.approval.id);
    expect(again.approval.amount_units).toBe("5000000");
    expect(await h.db.select().from(approvals)).toHaveLength(1);
  });

  it("only one approval per bounty can be signed", async () => {
    const b = await fundedBounty(); await linkWallet();
    const c1 = await addCandidate("confirmed", DEMO.reviewerId, 21);
    await linkWallet(4004, "0x00000000000000000000000000000000000000b3");
    const c2 = await addCandidate("confirmed", 4004, 22);
    const a1 = (await approve(b.id, { candidate_id: c1.id })).json().approval;
    const a2 = (await approve(b.id, { candidate_id: c2.id })).json().approval;
    const sign = (id: number, n: number) => h.app.inject({ method: "POST", url: `/approvals/${id}/tx`, headers: h.cookie(M), payload: { tx_hash: "0x" + String(n).repeat(64) } });
    expect((await sign(a1.id, 1)).statusCode).toBe(200);
    expect((await sign(a2.id, 2)).statusCode).toBe(409);
    expect((await sign(a1.id, 1)).statusCode).toBe(200); // same hash is idempotent
    expect((await sign(a1.id, 3)).statusCode).toBe(409);
  });

  it("rejects a malformed tx hash and a non-maintainer reporting one", async () => {
    const b = await fundedBounty(); const c = await addCandidate(); await linkWallet();
    const a = (await approve(b.id, { candidate_id: c.id })).json().approval;
    const post = (uid: number, tx_hash: string) => h.app.inject({ method: "POST", url: `/approvals/${a.id}/tx`, headers: h.cookie(uid), payload: { tx_hash } });
    expect((await post(M, "0x12")).statusCode).toBe(400);
    expect((await post(DEMO.authorId, "0x" + "1".repeat(64))).statusCode).toBe(403);
  });
});

describe("maintainer actions", () => {
  // A maintainer funds from their verified wallet: POST /bounties records it as the funding intent's funder.
  beforeEach(async () => { await linkWallet(M, FUNDER); });
  const expiry = () => Math.floor(Date.now() / 1000) + 86400;
  const create = (body: object, uid = M) => h.app.inject({ method: "POST", url: "/bounties", headers: h.cookie(uid), payload: body });
  const req = (over: object = {}) => ({ github_repo_id: DEMO.repoId, pr_number: 1, amount_units: "10000000", expiry: expiry(), ...over });

  it("creates a funding_pending bounty and prepares approve + createBounty calldata", async () => {
    const r = await create(req());
    expect(r.statusCode).toBe(201);
    const j = r.json();
    expect(j.bounty.status).toBe("funding_pending");
    expect(j.funding.create_bounty).toMatchObject({ functionName: "createBounty", to: ESCROW, args: [prHash(DEMO.repoId, 1), "10000000", expect.any(String)] });
    expect(j.funding.approve_usdc).toMatchObject({ functionName: "approve", to: "0x3600000000000000000000000000000000000000" });
    expect((await create(req())).statusCode).toBe(409); // one live bounty per PR
  });

  it("loads an existing open PR from GitHub when no webhook has seen it yet", async () => {
    h.gh.pullRequests.set(`${DEMO.name}#2`, { number: 2, headSha: "existing-head", status: "open", authorId: DEMO.authorId });
    const r = await create(req({ pr_number: 2 }));
    expect(r.statusCode).toBe(201);
    const pr = (await h.db.select().from(pull_requests)).find((row) => row.github_pr_number === 2);
    expect(pr).toMatchObject({ head_sha: "existing-head", author_github_id: DEMO.authorId, pr_hash: prHash(DEMO.repoId, 2) });
  });

  it("rejects non-maintainers, bad amounts, past expiry and unknown PRs", async () => {
    expect((await create(req(), DEMO.reviewerId)).statusCode).toBe(403);
    expect((await create(req({ amount_units: "1.5" }))).statusCode).toBe(400);
    expect((await create(req({ amount_units: 10 }))).statusCode).toBe(400);
    expect((await create(req({ expiry: 5 }))).statusCode).toBe(400);
    expect((await create(req({ pr_number: 99 }))).statusCode).toBe(404);
    expect((await h.app.inject({ method: "POST", url: "/bounties", payload: req() })).statusCode).toBe(401);
  });

  it("manual contingency: an evidence URL creates a manual candidate that can then be confirmed", async () => {
    const b = await fundedBounty();
    h.gh.comments.set(COMMENT, { id: COMMENT, user: { id: DEMO.reviewerId, type: "User" }, path: "src/a.ts", diff_hunk: "@@", commit_sha: "c1", line: 5, pull_number: 1 });
    const url = `https://github.com/${DEMO.name}/pull/1#discussion_r${COMMENT}`;
    const r = await h.app.inject({ method: "POST", url: `/bounties/${b.id}/candidates/manual`, headers: h.cookie(M), payload: { evidence_url: url } });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ status: "candidate", qualification_evidence: { method: "manual" } });
    const ok = await h.app.inject({ method: "POST", url: `/candidates/${r.json().id}/confirm`, headers: h.cookie(M) });
    expect(ok.json().status).toBe("confirmed");
    expect((await h.app.inject({ method: "GET", url: `/bounties/${b.id}` })).json().status).toBe("review_candidate");
    // not a maintainer
    expect((await h.app.inject({ method: "POST", url: `/candidates/${r.json().id}/reject`, headers: h.cookie(DEMO.reviewerId) })).statusCode).toBe(403);
  });

  it("manual evidence rejects the PR author's comment and a URL for another PR", async () => {
    const b = await fundedBounty();
    h.gh.comments.set(9, { id: 9, user: { id: DEMO.authorId, type: "User" }, path: "a", diff_hunk: "", commit_sha: "c", line: 1, pull_number: 1 });
    const post = (u: string) => h.app.inject({ method: "POST", url: `/bounties/${b.id}/candidates/manual`, headers: h.cookie(M), payload: { evidence_url: u } });
    expect((await post(`https://github.com/${DEMO.name}/pull/1#discussion_r9`)).statusCode).toBe(409);
    expect((await post(`https://github.com/${DEMO.name}/pull/2#discussion_r9`)).statusCode).toBe(400);
    expect((await post(`https://example.com/x`)).statusCode).toBe(400);
  });
});

describe("read routes, auth and /me", () => {
  it("serves public bounty list, detail, config and events", async () => {
    const b = await fundedBounty(); await addCandidate("candidate");
    const list = (await h.app.inject({ method: "GET", url: "/bounties?status=review_candidate" })).json();
    expect(list.bounties).toHaveLength(1);
    expect(list.bounties[0]).toMatchObject({ id: b.id, onchain_bounty_id: "7", amount_units: "10000000", funder_wallet: FUNDER, repo: { name: DEMO.name } });
    expect((await h.app.inject({ method: "GET", url: "/bounties?status=paid" })).json().bounties).toHaveLength(0);
    // List rows carry their indexed events, so a dashboard can read confirmed amounts.
    expect(list.bounties[0].events).toEqual([expect.objectContaining({ event_type: "BountyFunded", payload: expect.objectContaining({ amount: "10000000" }) })]);
    const d = (await h.app.inject({ method: "GET", url: `/bounties/${b.id}` })).json();
    expect(d.candidates[0].qualification_evidence.method).toBe("heuristic");
    expect(d.events[0]).toMatchObject({ event_type: "BountyFunded", explorer_url: expect.stringContaining("/tx/0x") });
    const ev = (await h.app.inject({ method: "GET", url: `/events?bounty_id=${b.id}` })).json();
    expect(ev.events).toHaveLength(1);
    expect(ev.next_before).toBeNull();
    expect((await h.app.inject({ method: "GET", url: "/bounties/9999" })).statusCode).toBe(404);
    expect((await h.app.inject({ method: "GET", url: "/config" })).json()).toMatchObject({ chain_id: 5042002, usdc_decimals: 6 });
  });

  it("marks a funded bounty past its deadline as expired on read", async () => {
    const b = await fundedBounty();
    await h.db.update(bounties).set({ deadline: new Date(Date.now() - 1000) });
    expect((await h.app.inject({ method: "GET", url: `/bounties/${b.id}` })).json().status).toBe("expired");
  });

  it("/me needs a session and shows wallet, maintained repos and reviewer rows", async () => {
    expect((await h.app.inject({ method: "GET", url: "/me" })).statusCode).toBe(401);
    expect((await h.app.inject({ method: "GET", url: "/me", headers: { cookie: "merit_session=forged" } })).statusCode).toBe(401);
    await fundedBounty(); await addCandidate(); await linkWallet();
    const rev = (await h.app.inject({ method: "GET", url: "/me", headers: h.cookie(DEMO.reviewerId) })).json();
    expect(rev.wallet.address).toBe(REVIEWER);
    expect(rev.as_reviewer).toHaveLength(1);
    expect(rev.as_reviewer[0].approval).toBeNull();
    const mt = (await h.app.inject({ method: "GET", url: "/me", headers: h.cookie(M) })).json();
    expect(mt.maintains).toEqual([{ github_repo_id: DEMO.repoId, name: DEMO.name }]);
  });

  it("mock OAuth login sets a session cookie that /me accepts", async () => {
    const login = await h.app.inject({ method: "GET", url: "/auth/github/login" });
    expect(login.statusCode).toBe(302);
    const stateCookie = login.cookies.find((c) => c.name === "merit_oauth_state")!;
    const cb = await h.app.inject({ method: "GET", url: login.headers.location as string, cookies: { merit_oauth_state: stateCookie.value } });
    expect(cb.statusCode).toBe(302);
    const sess = cb.cookies.find((c) => c.name === "merit_session")!;
    const me = await h.app.inject({ method: "GET", url: "/me", cookies: { merit_session: sess.value } });
    expect(me.json()).toMatchObject({ github_user_id: 1001, login: "maintainer-demo" });
  });

  it("rejects an OAuth callback with a bad state", async () => {
    const r = await h.app.inject({ method: "GET", url: "/auth/github/callback?code=mock:1:x&state=nope" });
    expect(r.statusCode).toBe(400);
  });
});
