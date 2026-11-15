import { describe, expect, it } from "vitest";
import { buildApp, type Ctx } from "../src/fastify-app.js";
import { loadEnv } from "../src/env.js";
import { MockGitHubClient } from "../src/github/client.js";

const WEB = "https://web.example.com";
// These routes never touch the database.
const appFor = (WEB_ORIGIN?: string) =>
  buildApp({ db: null as never, env: loadEnv({ DATABASE_URL: "postgres://x/y", ...(WEB_ORIGIN && { WEB_ORIGIN }) }), gh: new MockGitHubClient() } as Ctx);

describe("web app on a different host than the api", () => {
  it("https web origin: cookies are SameSite=None; Secure, and CORS allows only that origin with credentials", async () => {
    const app = await appFor(WEB);
    const login = await app.inject({ method: "GET", url: "/auth/github/login" });
    expect(String(login.headers["set-cookie"])).toMatch(/SameSite=None/);
    expect(String(login.headers["set-cookie"])).toMatch(/Secure/);
    const me = await app.inject({ method: "GET", url: "/me", headers: { origin: WEB } });
    expect(me.headers["access-control-allow-origin"]).toBe(WEB);
    expect(me.headers["access-control-allow-credentials"]).toBe("true");
    const other = await app.inject({ method: "GET", url: "/me", headers: { origin: "https://evil.example.com" } });
    expect(other.headers["access-control-allow-origin"]).not.toBe("https://evil.example.com");
  });

  it("refuses a write from any other site, allows the web origin and origin-less callers", async () => {
    const app = await appFor(WEB);
    const post = (origin?: string) => app.inject({ method: "POST", url: "/auth/logout", headers: origin ? { origin } : {} });
    expect((await post("https://evil.example.com")).statusCode).toBe(403);
    expect((await post(WEB)).statusCode).toBe(204);
    expect((await post()).statusCode).toBe(204);
  });

  it("http localhost keeps SameSite=Lax (None needs Secure, which http cannot set)", async () => {
    const login = await (await appFor()).inject({ method: "GET", url: "/auth/github/login" });
    expect(String(login.headers["set-cookie"])).toMatch(/SameSite=Lax/);
    expect(String(login.headers["set-cookie"])).not.toMatch(/Secure/);
  });
});
