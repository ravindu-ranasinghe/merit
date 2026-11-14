import { App } from "@octokit/app";
import { randomBytes } from "node:crypto";
import type { Env } from "../env.js";

export interface ReviewComment {
  id: number;
  user: { id: number; type: string };
  path: string;
  diff_hunk: string;
  commit_sha: string;
  line: number;
  pull_number: number;
}
export interface ChangedFile { filename: string; patch?: string }

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
}

export function createOctokitClient(env: Env): GitHubClient {
  const { appId, privateKey, clientId, clientSecret } = env.github;
  const app = new App({ appId, privateKey });
  const inst = (id: number) => app.getInstallationOctokit(id);
  const split = (full: string) => { const [owner, repo] = full.split("/"); return { owner: owner!, repo: repo! }; };
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
    async getReviewComment(installationId, repoFullName, commentId) {
      const o = await inst(installationId);
      const { owner, repo } = split(repoFullName);
      try {
        const { data: c } = await o.request("GET /repos/{owner}/{repo}/pulls/comments/{comment_id}", { owner, repo, comment_id: commentId });
        const pull_number = Number(c.pull_request_url.split("/").pop());
        if (!c.user) return null; // deleted account
        return { id: Number(c.id), user: { id: Number(c.user.id), type: c.user.type }, path: c.path, diff_hunk: c.diff_hunk, commit_sha: c.original_commit_id, line: c.original_line ?? c.line ?? 0, pull_number };
      } catch {
        return null;
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
}

export const randomState = () => randomBytes(16).toString("hex");
