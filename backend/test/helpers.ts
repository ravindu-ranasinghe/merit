import { sql } from "drizzle-orm";
import { buildApp } from "../src/fastify-app.js";
import { createDb } from "../src/db/index.js";
import { DEMO, seed } from "../src/db/seed.js";
import { loadEnv } from "../src/env.js";
import { MockGitHubClient } from "../src/github/client.js";
import { signGithubBody } from "../src/github/webhook.js";

export const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? "postgres://merit:merit@localhost:5433/merit_test";
export const ESCROW = "0x00000000000000000000000000000000000e5c20";
export const WEBHOOK_SECRET = "test-webhook-secret";
export const QN_TOKEN = "test-qn-token";
export { DEMO };

export async function setup() {
  const { db, pool } = createDb(TEST_DB_URL);
  await db.execute(sql`truncate approvals, chain_events, review_candidates, wallet_links, bounties, pull_requests, repositories restart identity cascade`);
  await seed(db);
  const gh = new MockGitHubClient();
  gh.repos.set(DEMO.name, { isPublic: true, description: null, language: null });
  gh.permissions.set(`${DEMO.name}:${DEMO.maintainerId}`, "admin");
  const env = loadEnv({
    DATABASE_URL: TEST_DB_URL, ESCROW_ADDRESS: ESCROW, SESSION_SECRET: "test-session-secret-0123456789",
    QN_SECURITY_TOKEN: QN_TOKEN, GITHUB_WEBHOOK_SECRET: WEBHOOK_SECRET,
  });
  const ctx = { db, env, gh };
  const app = await buildApp(ctx);
  await app.ready();
  const cookie = (id: number, login = `user${id}`) => ({ cookie: `merit_session=${encodeURIComponent(app.signCookie(JSON.stringify({ id, login })))}` });
  return { app, ctx, db, gh, cookie, close: async () => { await app.close(); await pool.end(); } };
}
export type Harness = Awaited<ReturnType<typeof setup>>;

export function ghHeaders(body: string, event: string, delivery: string, secret = WEBHOOK_SECRET) {
  return { "content-type": "application/json", "x-github-event": event, "x-github-delivery": delivery, "x-hub-signature-256": signGithubBody(secret, body) };
}
