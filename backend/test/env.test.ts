import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/env.js";
import { setup } from "./helpers.js";
import { afterAll } from "vitest";

const DB = "postgres://x/y";
const GH = { GITHUB_APP_ID: "1", GITHUB_PRIVATE_KEY: "k", GITHUB_WEBHOOK_SECRET: "w", GITHUB_CLIENT_ID: "c", GITHUB_CLIENT_SECRET: "s" };
const SECRETS = { SESSION_SECRET: "0123456789abcdef0123", QN_SECURITY_TOKEN: "qn" };
const prod = { NODE_ENV: "production", DATABASE_URL: DB };

describe("production refuses insecure configuration", () => {
  it("throws without GitHub credentials (no mock client, no default webhook secret)", () => {
    expect(() => loadEnv({ ...prod, ...SECRETS })).toThrow(/GitHub App credentials are required in production/);
  });
  it("throws on a partial GitHub config too", () => {
    expect(() => loadEnv({ ...prod, ...SECRETS, GITHUB_APP_ID: "1" })).toThrow(/required in production/);
  });
  it("throws without SESSION_SECRET", () => {
    expect(() => loadEnv({ ...prod, ...GH, QN_SECURITY_TOKEN: "qn" })).toThrow(/SESSION_SECRET is required/);
  });
  it("throws without QN_SECURITY_TOKEN", () => {
    expect(() => loadEnv({ ...prod, ...GH, SESSION_SECRET: SECRETS.SESSION_SECRET })).toThrow(/QN_SECURITY_TOKEN is required/);
  });
  it("boots with everything set, in real (non-mock) mode and no warnings about defaults", () => {
    const env = loadEnv({ ...prod, ...GH, ...SECRETS, ESCROW_ADDRESS: "0x00000000000000000000000000000000000e5c20" });
    expect(env.github.mock).toBe(false);
    expect(env.warnings.join()).not.toMatch(/DEFAULT/);
  });
});

describe("development defaults", () => {
  it("still boot, with the loud warning", () => {
    const env = loadEnv({ DATABASE_URL: DB });
    expect(env.github.mock).toBe(true);
    expect(env.warnings).toContain("DEV DEFAULT SECRETS IN USE: webhooks and sessions are forgeable by anyone who reads this repo. Never expose this instance publicly.");
  });
});

describe("session cookie integrity", () => {
  let h: Awaited<ReturnType<typeof setup>>;
  afterAll(() => h?.close());
  it("rejects a cookie signed with a different secret, and an unsigned one", async () => {
    h = await setup();
    const { default: Fastify } = await import("fastify");
    const { default: cookie } = await import("@fastify/cookie");
    const other = Fastify();
    await other.register(cookie, { secret: "some-other-secret-entirely" });
    await other.ready();
    const value = JSON.stringify({ id: 1001, login: "maintainer-demo" });
    const wrong = `merit_session=${encodeURIComponent(other.signCookie(value))}`;
    const unsigned = `merit_session=${encodeURIComponent(value)}`;
    for (const c of [wrong, unsigned]) {
      expect((await h.app.inject({ method: "GET", url: "/me", headers: { cookie: c } })).statusCode).toBe(401);
      expect((await h.app.inject({ method: "GET", url: "/wallet/challenge", headers: { cookie: c } })).statusCode).toBe(401);
    }
    await other.close();
  });
});
