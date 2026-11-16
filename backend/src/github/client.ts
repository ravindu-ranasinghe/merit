import { App } from "@octokit/app";
import { randomBytes } from "node:crypto";
import type { Env } from "../env.js";

export interface GithubIdentity { id: number; login: string; avatar_url?: string }
export interface ReviewComment {
  id: number;
  user: { id: number; type: string; login?: string; avatar_url?: string };
  path: string;
  diff_hunk: string;
  commit_sha: string;
  line: number;
  pull_number: number;
  body?: string;
  created_at?: string;
  in_reply_to_id?: number;
}
export interface ChangedFile { filename: string; patch?: string }
export interface PullRequestInfo { number: number; headSha: string; status: "open" | "closed" | "merged"; authorId: number; title?: string; author?: GithubIdentity }
export interface RepositoryInfo { isPublic: boolean; description: string | null; language: string | null }
export interface ReviewThread { id: string; resolved: boolean; commentId: number }

// Everything the backend needs from GitHub. Real impl below; in-memory mock for local dev and tests.
export interface GitHubClient {
  readonly mock: boolean;
  oauthUrl(state: string): string;
  /** Exchange an OAuth code for the immutable user id + login. */
  exchangeCode(code: string): Promise<{ id: number; login: string }>;
  /** Live repo permission of a user id ("admin" | "maintain" | "write" | "triage" | "read" | "none"). */
  getRepoPermission(installationId: number, repoFullName: string, userId: number): Promise<string>;
  compareFiles(installationId: number, repoFullName: string, base: string, head: string): Promise<ChangedFile[]>;
  getReviewComment(installationId: number, repoFullName: string, commentId: number): Promise<ReviewComment | null>;
  getPullRequest(installationId: number, repoFullName: string, prNumber: number, fresh?: boolean): Promise<PullRequestInfo | null>;
  getUser(installationId: number, userId: number): Promise<GithubIdentity>;
  getRepository(installationId: number, repoFullName: string): Promise<RepositoryInfo>;
  listReviewComments(installationId: number, repoFullName: string, prNumber: number): Promise<ReviewComment[]>;
  listReviewThreads(installationId: number, repoFullName: string, prNumber: number): Promise<ReviewThread[]>;
}

export function createOctokitClient(env: Env): GitHubClient {
  const { appId, privateKey, clientId, clientSecret } = env.github;
  const app = new App({ appId, privateKey });
  const inst = (id: number) => app.getInstallationOctokit(id);
  const split = (full: string) => { const [owner, repo] = full.split("/"); return { owner: owner!, repo: repo! }; };
  // Display metadata only; authorization and repository visibility always use live requests.
  const users = new Map<number, { until: number; value: GithubIdentity }>();
  const pulls = new Map<string, { until: number; value: PullRequestInfo }>();
  return {
    mock: false,
    oauthUrl: (state) => `https://github.com/login/oauth/authorize?client_id=${clientId}&state=${state}`,
    async exchangeCode(code) {
      const t = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
      });
      const token = ((await t.json()) as { access_token?: string }).access_token;
      if (!token) throw new Error("oauth code exchange failed");
      const u = await fetch("https://api.github.com/user", { headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" } });
      const j = (await u.json()) as { id: number; login: string };
      return { id: j.id, login: j.login };
    },
    async getRepoPermission(installationId, repoFullName, userId) {
      const o = await inst(installationId);
      // Resolve the login from the immutable id at call time; never trust a login from the browser.
      const { data: u } = await o.request("GET /user/{account_id}", { account_id: userId });
      const { owner, repo } = split(repoFullName);
      const { data } = await o.request("GET /repos/{owner}/{repo}/collaborators/{username}/permission", { owner, repo, username: u.login });
      return data.role_name ?? data.permission;
    },
    async compareFiles(installationId, repoFullName, base, head) {
      const o = await inst(installationId);
      const { owner, repo } = split(repoFullName);
      const { data } = await o.request("GET /repos/{owner}/{repo}/compare/{basehead}", { owner, repo, basehead: `${base}...${head}` });
      return (data.files ?? []).map((f) => ({ filename: f.filename, patch: f.patch }));
    },
    async getUser(installationId, userId) {
      const cached = users.get(userId);
      if (cached && cached.until > Date.now()) return cached.value;
      const o = await inst(installationId);
      const { data: u } = await o.request("GET /user/{account_id}", { account_id: userId });
      const value = { id: Number(u.id), login: u.login, avatar_url: u.avatar_url };
      if (users.size >= 1000) users.delete(users.keys().next().value!);
      users.set(userId, { value, until: Date.now() + 300_000 });
      return value;
    },
    async getRepository(installationId, repoFullName) {
      const o = await inst(installationId);
      const { data: r } = await o.request("GET /repos/{owner}/{repo}", split(repoFullName));
      return { isPublic: !r.private, description: r.description, language: r.language ?? null };
    },
    async listReviewComments(installationId, repoFullName, prNumber) {
      const o = await inst(installationId);
      const comments: ReviewComment[] = [];
      for (let page = 1; ; page++) {
        const { data } = await o.request("GET /repos/{owner}/{repo}/pulls/{pull_number}/comments", { ...split(repoFullName), pull_number: prNumber, per_page: 100, page });
        for (const c of data) {
          if (!c.user) continue;
          comments.push({ id: Number(c.id), user: { id: Number(c.user.id), type: c.user.type, login: c.user.login, avatar_url: c.user.avatar_url },
            path: c.path, diff_hunk: c.diff_hunk, commit_sha: c.original_commit_id,
            line: c.original_line ?? c.line ?? 0, pull_number: prNumber, body: c.body,
            created_at: c.created_at, in_reply_to_id: c.in_reply_to_id ? Number(c.in_reply_to_id) : undefined });
        }
        if (data.length < 100) return comments;
      }
    },
    async listReviewThreads(installationId, repoFullName, prNumber) {
      const o = await inst(installationId);
      const threads: ReviewThread[] = [];
      let cursor: string | null = null;
      do {
        const result: { repository: { pullRequest: { reviewThreads: {
          nodes: { id: string; isResolved: boolean; comments: { nodes: { fullDatabaseId: string | number | null }[] } }[];
          pageInfo: { hasNextPage: boolean; endCursor: string };
        } } } } = await o.graphql(`query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
          repository(owner: $owner, name: $repo) { pullRequest(number: $number) {
            reviewThreads(first: 100, after: $cursor) {
              nodes { id isResolved comments(first: 1) { nodes { fullDatabaseId } } }
              pageInfo { hasNextPage endCursor }
            }
          } }
        }`, { ...split(repoFullName), number: prNumber, cursor });
        const page = result.repository.pullRequest.reviewThreads;
        for (const t of page.nodes) {
          const commentId = Number(t.comments.nodes[0]?.fullDatabaseId);
          if (Number.isSafeInteger(commentId) && commentId > 0) threads.push({ id: t.id, resolved: t.isResolved, commentId });
        }
        cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
      } while (cursor);
      return threads;
    },
    async getReviewComment(installationId, repoFullName, commentId) {
      const o = await inst(installationId);
      const { owner, repo } = split(repoFullName);
      try {
        const { data: c } = await o.request("GET /repos/{owner}/{repo}/pulls/comments/{comment_id}", { owner, repo, comment_id: commentId });
        const pull_number = Number(c.pull_request_url.split("/").pop());
        if (!c.user) return null; // deleted account
        return { id: Number(c.id), user: { id: Number(c.user.id), type: c.user.type, login: c.user.login, avatar_url: c.user.avatar_url }, path: c.path, diff_hunk: c.diff_hunk, commit_sha: c.original_commit_id, line: c.original_line ?? c.line ?? 0, pull_number, body: c.body, created_at: c.created_at, in_reply_to_id: c.in_reply_to_id ? Number(c.in_reply_to_id) : undefined };
      } catch {
        return null;
      }
    },
    async getPullRequest(installationId, repoFullName, prNumber, fresh = false) {
      const key = `${installationId}:${repoFullName}#${prNumber}`;
      const cached = pulls.get(key);
      if (!fresh && cached && cached.until > Date.now()) return cached.value;
      const o = await inst(installationId);
      const { owner, repo } = split(repoFullName);
      try {
        const { data: p } = await o.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", { owner, repo, pull_number: prNumber });
        if (!p.user) return null;
        const value: PullRequestInfo = { number: p.number, headSha: p.head.sha, status: p.merged ? "merged" : p.state === "closed" ? "closed" : "open", authorId: Number(p.user.id), title: p.title, author: { id: Number(p.user.id), login: p.user.login, avatar_url: p.user.avatar_url } };
        if (pulls.size >= 1000) pulls.delete(pulls.keys().next().value!);
        pulls.set(key, { value, until: Date.now() + 30_000 });
        return value;
      } catch (err) {
        if ((err as { status?: number }).status === 404) return null;
        throw err;
      }
    },
  };
}

/** In-memory stand-in. Tests and local dev seed it through its public maps. Not a GitHub emulator. */
export class MockGitHubClient implements GitHubClient {
  readonly mock = true;
  permissions = new Map<string, string>(); // `${repoFullName}:${userId}` -> permission
  compares = new Map<string, ChangedFile[]>(); // `${base}...${head}`
  comments = new Map<number, ReviewComment>();
  pullRequests = new Map<string, PullRequestInfo>();
  users = new Map<number, GithubIdentity>();
  repos = new Map<string, RepositoryInfo>();
  threads = new Map<string, ReviewThread[]>();
  compareCalls = 0;
  oauthUrl = (state: string) => `/auth/github/callback?code=mock:1001:maintainer-demo&state=${state}`;
  async exchangeCode(code: string) {
    const m = /^mock:(\d+):(.+)$/.exec(code);
    if (!m) throw new Error("mock mode: code must look like mock:<id>:<login>");
    return { id: Number(m[1]), login: m[2]! };
  }
  async getRepoPermission(_i: number, repo: string, userId: number) {
    return this.permissions.get(`${repo}:${userId}`) ?? "none";
  }
  async compareFiles(_i: number, _r: string, base: string, head: string) {
    this.compareCalls++;
    const f = this.compares.get(`${base}...${head}`);
    if (!f) throw new Error("mock: no compare registered");
    return f;
  }
  async getReviewComment(_i: number, _r: string, id: number) {
    return this.comments.get(id) ?? null;
  }
  async getPullRequest(_i: number, repo: string, prNumber: number) {
    return this.pullRequests.get(`${repo}#${prNumber}`) ?? null;
  }
  async getUser(_i: number, id: number) {
    return this.users.get(id) ?? { id, login: `user ${id}` };
  }
  async getRepository(_i: number, repo: string) {
    const info = this.repos.get(repo);
    if (!info) throw new Error("mock: no repository registered");
    return info;
  }
  async listReviewComments(_i: number, _repo: string, prNumber: number) {
    return [...this.comments.values()].filter((c) => c.pull_number === prNumber);
  }
  async listReviewThreads(_i: number, repo: string, prNumber: number) {
    return this.threads.get(`${repo}#${prNumber}`) ?? [];
  }
}

export const randomState = () => randomBytes(16).toString("hex");
