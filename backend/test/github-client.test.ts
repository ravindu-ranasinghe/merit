import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadEnv } from "../src/env.js";
import { createOctokitClient } from "../src/github/client.js";

const { request, graphql } = vi.hoisted(() => ({ request: vi.fn(), graphql: vi.fn() }));
vi.mock("@octokit/app", () => ({ App: class {
  async getInstallationOctokit() { return { request, graphql }; }
} }));
beforeEach(() => { request.mockReset(); graphql.mockReset(); });
const client = () => createOctokitClient(loadEnv({ DATABASE_URL: "postgres://unused" }));

describe("GitHub read boundaries", () => {
  it("paginates review threads using full database IDs, including IDs larger than a 32-bit integer", async () => {
    graphql.mockResolvedValueOnce({ repository: { pullRequest: { reviewThreads: {
      nodes: [{ id: "first", isResolved: true, comments: { nodes: [{ fullDatabaseId: "3500000000" }] } }],
      pageInfo: { hasNextPage: true, endCursor: "next" },
    } } } }).mockResolvedValueOnce({ repository: { pullRequest: { reviewThreads: {
      nodes: [{ id: "second", isResolved: false, comments: { nodes: [{ fullDatabaseId: "3500000001" }] } }],
      pageInfo: { hasNextPage: false, endCursor: null },
    } } } });
    expect(await client().listReviewThreads(1, "owner/repo", 2)).toEqual([
      { id: "first", resolved: true, commentId: 3500000000 }, { id: "second", resolved: false, commentId: 3500000001 },
    ]);
    expect(graphql.mock.calls[0]![0]).toContain("fullDatabaseId");
    expect(graphql.mock.calls[1]![1]).toMatchObject({ cursor: "next", owner: "owner", repo: "repo", number: 2 });
  });

  it("loads subsequent comment pages and retains comment bodies and immutable reviewer IDs", async () => {
    const comment = { id: 3_500_000_000, user: { id: 3003, type: "User", login: "reviewer" },
      path: "server.ts", diff_hunk: "@@", original_commit_id: "base", original_line: 72,
      body: "Please check ownership.", created_at: "2026-11-15T12:00:00Z" };
    request.mockResolvedValueOnce({ data: Array.from({ length: 100 }, (_, i) => ({ ...comment, id: comment.id + i })) })
      .mockResolvedValueOnce({ data: [{ ...comment, id: comment.id + 100 }] });
    const comments = await client().listReviewComments(1, "owner/repo", 2);
    expect(comments).toHaveLength(101);
    expect(comments[100]).toMatchObject({ id: 3500000100, pull_number: 2, body: "Please check ownership.", user: { id: 3003, login: "reviewer" } });
    expect(request.mock.calls[1]![1]).toMatchObject({ page: 2 });
  });

  it("checks repository visibility on every call, even when it becomes private", async () => {
    request.mockResolvedValueOnce({ data: { private: false, description: "Public", language: "TypeScript" } })
      .mockResolvedValueOnce({ data: { private: true, description: "Private", language: "TypeScript" } });
    const gh = client();
    expect((await gh.getRepository(1, "owner/repo")).isPublic).toBe(true);
    expect((await gh.getRepository(1, "owner/repo")).isPublic).toBe(false);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("allows recheck to bypass the PR display cache", async () => {
    const pr = { number: 2, title: "A fix", head: { sha: "old" }, state: "open", merged: false, user: { id: 2002, login: "author" } };
    request.mockResolvedValueOnce({ data: pr }).mockResolvedValueOnce({ data: { ...pr, head: { sha: "new" } } });
    const gh = client();
    expect((await gh.getPullRequest(1, "owner/repo", 2))?.headSha).toBe("old");
    expect((await gh.getPullRequest(1, "owner/repo", 2))?.headSha).toBe("old");
    expect((await gh.getPullRequest(1, "owner/repo", 2, true))?.headSha).toBe("new");
    expect(request).toHaveBeenCalledTimes(2);
  });
});
