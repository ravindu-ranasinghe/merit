import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { buildChallenge } from "../src/routes/wallet.js";
import { DEMO, setup, type Harness } from "./helpers.js";

let h: Harness;
beforeEach(async () => { h?.close && (await h.close()); h = await setup(); });
afterAll(() => h.close());
const acct = privateKeyToAccount(generatePrivateKey());
const SECRET = "test-session-secret-0123456789";

const challenge = async (uid = DEMO.reviewerId) => (await h.app.inject({ method: "GET", url: "/wallet/challenge", headers: h.cookie(uid) })).json().message as string;
const link = (body: object, uid = DEMO.reviewerId) => h.app.inject({ method: "POST", url: "/wallet/link", headers: h.cookie(uid), payload: body });

describe("wallet binding", () => {
  it("links a wallet when the signature recovers to the address", async () => {
    const message = await challenge();
    expect(message).toContain(`github_user_id: ${DEMO.reviewerId}`);
    const r = await link({ address: acct.address, message, signature: await acct.signMessage({ message }) });
    expect(r.statusCode).toBe(200);
    expect(r.json().wallet_address).toBe(acct.address.toLowerCase());
    const me = (await h.app.inject({ method: "GET", url: "/me", headers: h.cookie(DEMO.reviewerId) })).json();
    expect(me.wallet.address).toBe(acct.address.toLowerCase());
  });

  it("requires a session", async () => {
    expect((await h.app.inject({ method: "GET", url: "/wallet/challenge" })).statusCode).toBe(401);
  });

  it("rejects a replayed challenge", async () => {
    const message = await challenge();
    const body = { address: acct.address, message, signature: await acct.signMessage({ message }) };
    expect((await link(body)).statusCode).toBe(200);
    const again = await link(body);
    expect(again.statusCode).toBe(403);
    expect(again.json().error).toMatch(/already used/);
  });

  it("rejects an expired challenge", async () => {
    const { message } = buildChallenge(SECRET, DEMO.reviewerId, Date.now() - 6 * 60_000);
    const r = await link({ address: acct.address, message, signature: await acct.signMessage({ message }) });
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toMatch(/expired/);
  });

  it("rejects a challenge issued for a different user", async () => {
    const message = await challenge(DEMO.authorId);
    const r = await link({ address: acct.address, message, signature: await acct.signMessage({ message }) }, DEMO.reviewerId);
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toMatch(/different user/);
  });

  it("rejects a signature from a different key", async () => {
    const other = privateKeyToAccount(generatePrivateKey());
    const message = await challenge();
    const r = await link({ address: acct.address, message, signature: await other.signMessage({ message }) });
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toMatch(/does not match/);
  });

  it("rejects a message the server did not issue (forged mac)", async () => {
    const message = `Merit wallet link\ngithub_user_id: ${DEMO.reviewerId}\nnonce: x\nissued_at: ${new Date().toISOString()}\nexpires_at: ${new Date(Date.now() + 1e6).toISOString()}\nmac: deadbeef`;
    const r = await link({ address: acct.address, message, signature: await acct.signMessage({ message }) });
    expect(r.statusCode).toBe(403);
  });

  it("allows re-linking a new address with a fresh challenge", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const m1 = await challenge();
      await link({ address: acct.address, message: m1, signature: await acct.signMessage({ message: m1 }) });
      vi.setSystemTime(Date.now() + 1000);
      const b = privateKeyToAccount(generatePrivateKey());
      const m2 = await challenge();
      const r = await link({ address: b.address, message: m2, signature: await b.signMessage({ message: m2 }) });
      expect(r.statusCode).toBe(200);
      expect(r.json().wallet_address).toBe(b.address.toLowerCase());
    } finally { vi.useRealTimers(); }
  });
});
