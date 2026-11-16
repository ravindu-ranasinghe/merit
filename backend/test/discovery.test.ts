import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { approvals, bounties, chain_events, pull_requests, review_candidates } from "../src/db/schema.js";
import { syncReviews } from "../src/github/sync.js";
import { evaluateCandidate, touchesNear } from "../src/github/evidence.js";
import { DEMO, ESCROW, setup, type Harness } from "./helpers.js";

let h: Harness;
beforeEach(async () => {
  if (h) await h.close();
  h = await setup();
  h.gh.repos.set(DEMO.name, { isPublic: true, description: "Useful code", language: "TypeScript" });
  h.gh.pullRequests.set(`${DEMO.name}#1`, { number: 1, headSha: "fix-sha", authorId: DEMO.authorId, status: "open", title: "Fix the timer" });
  h.gh.users.set(DEMO.reviewerId, { id: DEMO.reviewerId, login: "reviewer" });
});
afterAll(() => h.close());

async function bounty(events: string[] = ["BountyFunded"], deadline = new Date(Date.now() + 86_400_000)) {
  const [row] = await h.db.insert(bounties).values({ pr_id: 1, amount_units: "12500000", deadline }).returning();
  if (events.length) {
    await h.db.update(bounties).set({ onchain_bounty_id: String(row!.id) }).where(eq(bounties.id, row!.id));
    for (const [i, event_type] of events.entries()) await h.db.insert(chain_events).values({
      chain_id: 5042002, contract: ESCROW, tx_hash: `0x${row!.id.toString().padStart(62, "0")}${i.toString().padStart(2, "0")}`,
      log_index: i, event_type, payload: { amount: "12500000" }, block_number: 100 + i, onchain_bounty_id: String(row!.id),
    });
  }
  return row!;
}

function review() {
  h.gh.comments.set(555, { id: 555, user: { id: DEMO.reviewerId, type: "User", login: "reviewer" },
    path: "server.ts", diff_hunk: "@@ -20,3 +20,3 @@\n-old\n+new", commit_sha: "comment-sha", line: 21,
    pull_number: 1, body: "Clear the timer before returning.", created_at: "2026-11-15T12:00:00Z" });
  h.gh.threads.set(`${DEMO.name}#1`, [{ id: "thread-1", commentId: 555, resolved: true }]);
  h.gh.compares.set("comment-sha...fix-sha", [{ filename: "server.ts", patch: "@@ -20,3 +100,4 @@\n+clearTimeout(timer);" }]);
}

describe("public discovery", () => {
  it("lists funded, open rewards with their actual PR title and language", async () => {
    const b = await bounty();
    await bounty([]);
    await bounty(["BountyFunded"], new Date(Date.now() - 1000));
    await bounty(["BountyFunded", "RewardApproved"]);
    await bounty(["BountyFunded", "RewardPaid"]);
    const r = await h.app.inject({ url: "/open-source" });
    expect(r.statusCode).toBe(200);
    expect(r.json().bounties).toHaveLength(1);
    expect(r.json().bounties[0]).toMatchObject({ id: b.id, amount_units: "12500000", language: "TypeScript", pr: { title: "Fix the timer" } });
  });

  it("never lists a private repo or a repo whose visibility cannot be verified", async () => {
    await bounty();
    h.gh.repos.set(DEMO.name, { isPublic: false, description: "secret", language: null });
    expect((await h.app.inject({ url: "/open-source" })).json().bounties).toEqual([]);
    h.gh.repos.clear();
    expect((await h.app.inject({ url: "/open-source" })).json().bounties).toEqual([]);
  });

  it("excludes a PR that is closed on GitHub even if the stored PR is open", async () => {
    await bounty();
    h.gh.pullRequests.set(`${DEMO.name}#1`, { number: 1, headSha: "fix-sha", authorId: DEMO.authorId, status: "closed" });
    expect((await h.app.inject({ url: "/open-source" })).json().bounties).toEqual([]);
  });

  it("protects private bounty details and review bodies, while allowing a current collaborator", async () => {
    const b = await bounty();
    h.gh.repos.set(DEMO.name, { isPublic: false, description: null, language: null });
    expect((await h.app.inject({ url: `/bounties/${b.id}` })).statusCode).toBe(404);
    expect((await h.app.inject({ url: `/bounties/${b.id}/candidates` })).statusCode).toBe(404);
    expect((await h.app.inject({ url: "/bounties" })).json().bounties).toEqual([]);
    expect((await h.app.inject({ url: `/bounties/${b.id}`, headers: h.cookie(9999) })).statusCode).toBe(404);
    expect((await h.app.inject({ url: `/bounties/${b.id}`, headers: h.cookie(DEMO.maintainerId) })).statusCode).toBe(200);
  });

  it("serves a public SVG badge with exact USDC decimals, and refuses private badges", async () => {
    const b = await bounty();
    const r = await h.app.inject({ url: `/bounties/${b.id}/badge.svg` });
    expect(r.headers["content-type"]).toContain("image/svg+xml");
    expect(r.body).toContain("12.50 test USDC");
    h.gh.repos.set(DEMO.name, { isPublic: false, description: null, language: null });
    expect((await h.app.inject({ url: `/bounties/${b.id}/badge.svg` })).statusCode).toBe(404);
  });

  it("requires current private repository access in the reviewer dashboard", async () => {
    await bounty();
    review();
    await syncReviews(h.ctx, 1);
    h.gh.repos.set(DEMO.name, { isPublic: false, description: null, language: null });
    const headers = h.cookie(DEMO.reviewerId);
    expect((await h.app.inject({ url: "/me", headers })).json().as_reviewer).toEqual([]);
    h.gh.permissions.set(`${DEMO.name}:${DEMO.reviewerId}`, "read");
    expect((await h.app.inject({ url: "/me", headers })).json().as_reviewer).toHaveLength(1);
  });

  it("profiles contain indexed payment evidence and exclude prepared approvals and private activity", async () => {
    const b = await bounty(["BountyFunded", "RewardApproved", "RewardPaid"]);
    review();
    await syncReviews(h.ctx, 1);
    const [c] = await h.db.select().from(review_candidates);
    await h.db.insert(approvals).values({ bounty_id: b.id, candidate_id: c!.id, reviewer_id: DEMO.reviewerId,
      approver_github_id: DEMO.maintainerId, amount_units: "10000000", approved_recipient: "0x123", claim_id: "claim", status: "prepared" });
    await h.db.update(chain_events).set({ payload: { amount: "4000000", recipient: "0x123", claimId: "claim" } }).where(eq(chain_events.event_type, "RewardPaid"));
    const pending = (await h.app.inject({ url: `/reviewers/${DEMO.reviewerId}` })).json();
    expect(pending.bounties[0].approvals).toEqual([]);
    await h.db.update(approvals).set({ status: "paid" });
    const r = await h.app.inject({ url: `/reviewers/${DEMO.reviewerId}` });
    expect(r.statusCode).toBe(200);
    expect(r.json().user.login).toBe("reviewer");
    expect(r.json().bounties[0].approvals[0].amount_units).toBe("4000000");
    expect(r.json().bounties[0].events.map((e: { event_type: string }) => e.event_type)).toContain("RewardPaid");
    await h.db.update(chain_events).set({ payload: { amount: "4000000", recipient: "0x999", claimId: "claim" } }).where(eq(chain_events.event_type, "RewardPaid"));
    expect((await h.app.inject({ url: `/reviewers/${DEMO.reviewerId}` })).json().bounties[0].approvals).toEqual([]);
    h.gh.repos.set(DEMO.name, { isPublic: false, description: null, language: null });
    expect((await h.app.inject({ url: `/reviewers/${DEMO.reviewerId}` })).json().bounties).toEqual([]);
  });
});

describe("rechecking GitHub", () => {
  it("requires a signed-in user", async () => {
    const b = await bounty();
    expect((await h.app.inject({ method: "POST", url: `/bounties/${b.id}/refresh` })).statusCode).toBe(401);
  });

  it("recovers missed comments, resolution and fixes, keeping real identity and comment text", async () => {
    const b = await bounty();
    review();
    const r = await h.app.inject({ method: "POST", url: `/bounties/${b.id}/refresh`, headers: h.cookie(DEMO.reviewerId) });
    expect(r.statusCode).toBe(200);
    const detail = (await h.app.inject({ url: `/bounties/${b.id}` })).json();
    expect(detail.status).toBe("review_candidate");
    expect(detail.candidates[0]).toMatchObject({ status: "candidate", thread_resolved: true, reviewer: { login: "reviewer" },
      qualification_evidence: { comment_body: "Clear the timer before returning.", compared_head: "fix-sha", check_reason: "ready", later_commit_touched: true } });
    expect((await h.app.inject({ method: "POST", url: `/bounties/${b.id}/refresh`, headers: h.cookie(DEMO.reviewerId) })).statusCode).toBe(429);
  });

  it("reports a failed comparison as unverified instead of claiming no fix exists", async () => {
    await bounty();
    review();
    h.gh.compares.clear();
    await syncReviews(h.ctx, 1);
    const [c] = await h.db.select().from(review_candidates);
    expect(c!.status).toBe("pending");
    expect(c!.qualification_evidence).toMatchObject({ check_reason: "github_unavailable", later_commit_touched: null });
  });

  it("reports a detected fix while waiting for the thread to resolve", async () => {
    await bounty();
    review();
    h.gh.threads.set(`${DEMO.name}#1`, [{ id: "thread-1", commentId: 555, resolved: false }]);
    await syncReviews(h.ctx, 1);
    const [c] = await h.db.select().from(review_candidates);
    expect(c!.status).toBe("pending");
    expect(c!.qualification_evidence).toMatchObject({ check_reason: "waiting_for_resolution", later_commit_touched: true });
  });

  it("returns a heuristic candidate to pending when its thread is reopened", async () => {
    const b = await bounty();
    review();
    await syncReviews(h.ctx, 1);
    h.gh.threads.set(`${DEMO.name}#1`, [{ id: "thread-1", commentId: 555, resolved: false }]);
    await syncReviews(h.ctx, 1);
    const [c] = await h.db.select().from(review_candidates);
    expect(c!.status).toBe("pending");
    expect((await h.app.inject({ url: `/bounties/${b.id}` })).json().status).toBe("funded");
  });

  it("preserves a rejection and excludes self reviews, bots and replies during reconciliation", async () => {
    await bounty();
    review();
    await syncReviews(h.ctx, 1);
    await h.db.update(review_candidates).set({ status: "rejected" });
    const c = h.gh.comments.get(555)!;
    h.gh.comments.set(556, { ...c, id: 556, user: { id: DEMO.authorId, type: "User" } });
    h.gh.comments.set(557, { ...c, id: 557, user: { id: 777, type: "Bot" } });
    h.gh.comments.set(558, { ...c, id: 558, in_reply_to_id: 555 });
    await syncReviews(h.ctx, 1);
    const rows = await h.db.select().from(review_candidates);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("rejected");
  });

  it.each(["rejected", "confirmed"])("does not overwrite a newer %s decision while GitHub is responding", async (decision) => {
    await bounty();
    review();
    await syncReviews(h.ctx, 1);
    const [c] = await h.db.select().from(review_candidates);
    vi.spyOn(h.gh, "compareFiles").mockImplementationOnce(async () => {
      await h.db.update(review_candidates).set({ status: decision }).where(eq(review_candidates.id, c!.id));
      return [{ filename: "server.ts", patch: "@@ -20,3 +100,4 @@" }];
    });
    await evaluateCandidate(h.ctx, c!.id);
    expect((await h.db.select().from(review_candidates))[0]!.status).toBe(decision);
  });

  it("does not qualify a thread reopened while GitHub is responding", async () => {
    await bounty();
    review();
    await syncReviews(h.ctx, 1);
    const [c] = await h.db.select().from(review_candidates);
    await h.db.update(review_candidates).set({ status: "pending" }).where(eq(review_candidates.id, c!.id));
    vi.spyOn(h.gh, "compareFiles").mockImplementationOnce(async () => {
      await h.db.update(review_candidates).set({ thread_resolved: false }).where(eq(review_candidates.id, c!.id));
      return [{ filename: "server.ts", patch: "@@ -20,3 +100,4 @@" }];
    });
    await evaluateCandidate(h.ctx, c!.id);
    expect((await h.db.select().from(review_candidates))[0]).toMatchObject({ status: "pending", thread_resolved: false });
  });

  it("requires live maintainer permission to refresh a private repository", async () => {
    const b = await bounty();
    h.gh.repos.set(DEMO.name, { isPublic: false, description: null, language: null });
    expect((await h.app.inject({ method: "POST", url: `/bounties/${b.id}/refresh`, headers: h.cookie(9999) })).statusCode).toBe(403);
  });

  it("matches the original line even when additions shift the new-file line far away", () => {
    expect(touchesNear("@@ -20,3 +120,4 @@", 21)).toBe(true);
    expect(touchesNear("@@ -120,3 +20,4 @@", 21)).toBe(false);
  });
});
