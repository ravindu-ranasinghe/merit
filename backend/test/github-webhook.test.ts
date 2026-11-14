import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pull_requests, repositories, review_candidates } from "../src/db/schema.js";
import { ghHeaders, setup, type Harness } from "./helpers.js";

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), "utf8");
let h: Harness;
beforeEach(async () => { h?.close && (await h.close()); h = await setup(); });
afterAll(() => h.close());
const post = (body: string, event: string, delivery: string, headers = ghHeaders(body, event, delivery)) =>
  h.app.inject({ method: "POST", url: "/webhooks/github", headers, payload: body });

describe("POST /webhooks/github", () => {
  it("accepts a validly signed delivery and records the head sha", async () => {
    const r = await post(fx("pr_synchronize"), "pull_request", "d1");
    expect(r.statusCode).toBe(200);
    const [pr] = await h.db.select().from(pull_requests);
    expect(pr!.head_sha).toBe("headsha2");
  });

  it("rejects a forged signature with 401 and changes nothing", async () => {
    const body = fx("pr_synchronize");
    const r = await post(body, "pull_request", "d2", ghHeaders(body, "pull_request", "d2", "wrong-secret"));
    expect(r.statusCode).toBe(401);
    const [pr] = await h.db.select().from(pull_requests);
    expect(pr!.head_sha).toBe("demo-head-sha");
  });

  it("rejects a body tampered after signing", async () => {
    const body = fx("pr_synchronize");
    const r = await post(body.replace("headsha2", "evil"), "pull_request", "d3", ghHeaders(body, "pull_request", "d3"));
    expect(r.statusCode).toBe(401);
  });

  it("rejects a missing signature", async () => {
    const r = await h.app.inject({ method: "POST", url: "/webhooks/github", headers: { "content-type": "application/json", "x-github-event": "ping", "x-github-delivery": "d4" }, payload: "{}" });
    expect(r.statusCode).toBe(401);
  });

  it("treats a replayed X-GitHub-Delivery as a no-op", async () => {
    expect((await post(fx("review_comment_created"), "pull_request_review_comment", "d5")).json()).toEqual({ ok: true });
    const again = await post(fx("review_comment_created"), "pull_request_review_comment", "d5");
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ ok: true, duplicate: true });
    expect(await h.db.select().from(review_candidates)).toHaveLength(1);
  });

  it("returns 403 for a repository that is not registered", async () => {
    const body = fx("pr_synchronize").replace('"id": 900001', '"id": 424242');
    expect((await post(body, "pull_request", "d6")).statusCode).toBe(403);
  });

  it("registers a repository from a signed GitHub App installation", async () => {
    const body = JSON.stringify({
      action: "created", installation: { id: 88 }, sender: { id: 4444 },
      repositories: [{ id: 424242, full_name: "octocat/review-repo" }],
    });
    expect((await post(body, "installation", "install-1")).json()).toEqual({ ok: true, registered: 1 });
    const rows = await h.db.select().from(repositories);
    expect(rows.find((r) => r.github_repo_id === 424242)).toMatchObject({
      installation_id: 88, name: "octocat/review-repo", maintainer_github_id: 4444,
    });
    const me = await h.app.inject({ method: "GET", url: "/me", headers: h.cookie(4444) });
    expect(me.json().maintains).toContainEqual({ github_repo_id: 424242, name: "octocat/review-repo" });
  });

  it("ignores events it does not handle", async () => {
    const r = await post("{}", "issues", "d7");
    expect(r.json()).toMatchObject({ ignored: "issues" });
  });
});

describe("review evidence pipeline", () => {
  const comment = (over: object = {}) => {
    const j = JSON.parse(fx("review_comment_created"));
    return JSON.stringify({ ...j, comment: { ...j.comment, ...over } });
  };
  const status = async () => (await h.db.select().from(review_candidates))[0]?.status;

  it("a resolved thread plus a later commit touching the lines makes a heuristic candidate", async () => {
    h.gh.compares.set("headsha1...headsha2", [{ filename: "src/app.ts", patch: "@@ -10,6 +10,8 @@ x\n+changed" }]);
    await post(fx("review_comment_created"), "pull_request_review_comment", "e1");
    expect(await status()).toBe("pending");
    await post(fx("pr_synchronize"), "pull_request", "e2");
    expect(await status()).toBe("pending"); // not resolved yet
    await post(fx("review_thread_resolved"), "pull_request_review_thread", "e3");
    const [c] = await h.db.select().from(review_candidates);
    expect(c!.status).toBe("candidate");
    expect(c!.thread_node_id).toBe("PRRT_kwDOdemo1");
    expect(c!.qualification_evidence).toMatchObject({ method: "heuristic" });
    expect((c!.qualification_evidence as { limitations: string }).limitations).toMatch(/rebase/);
  });

  it("stays pending when the later commit only touches far-away lines", async () => {
    h.gh.compares.set("headsha1...headsha2", [{ filename: "src/app.ts", patch: "@@ -200,3 +200,4 @@ y\n+far" }]);
    await post(fx("review_comment_created"), "pull_request_review_comment", "f1");
    await post(fx("pr_synchronize"), "pull_request", "f2");
    await post(fx("review_thread_resolved"), "pull_request_review_thread", "f3");
    expect(await status()).toBe("pending");
  });

  it("stays pending when a different file changed", async () => {
    h.gh.compares.set("headsha1...headsha2", [{ filename: "README.md", patch: "@@ -1,1 +1,2 @@\n+x" }]);
    await post(fx("review_comment_created"), "pull_request_review_comment", "g1");
    await post(fx("pr_synchronize"), "pull_request", "g2");
    await post(fx("review_thread_resolved"), "pull_request_review_thread", "g3");
    expect(await status()).toBe("pending");
  });

  it("never creates a candidate for the PR author (matched by numeric id, not login)", async () => {
    await post(comment({ user: { id: 2002, login: "a-different-name", type: "User" } }), "pull_request_review_comment", "h1");
    expect(await h.db.select().from(review_candidates)).toHaveLength(0);
  });

  it("never creates a candidate for a bot", async () => {
    await post(comment({ user: { id: 777, login: "ci[bot]", type: "Bot" } }), "pull_request_review_comment", "h2");
    expect(await h.db.select().from(review_candidates)).toHaveLength(0);
  });

  it("ignores replies to a comment", async () => {
    await post(comment({ in_reply_to_id: 1 }), "pull_request_review_comment", "h3");
    expect(await h.db.select().from(review_candidates)).toHaveLength(0);
  });
});
