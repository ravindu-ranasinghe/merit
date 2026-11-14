import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { isAddress, verifyMessage, type Hex } from "viem";
import { z } from "zod";
import { HttpError, type Ctx } from "../ctx.js";
import { wallet_links } from "../db/schema.js";
import { requireSession } from "../session.js";

const TTL_MS = 5 * 60_000;
const mac = (secret: string, body: string) => createHmac("sha256", secret).update(body).digest("hex");

export const buildChallenge = (secret: string, userId: number, now = Date.now()) => {
  const issued = new Date(now).toISOString(), expires = new Date(now + TTL_MS).toISOString();
  const body = `Merit wallet link\ngithub_user_id: ${userId}\nnonce: ${randomBytes(16).toString("hex")}\nissued_at: ${issued}\nexpires_at: ${expires}`;
  return { message: `${body}\nmac: ${mac(secret, body)}`, expires_at: expires };
};

export function walletRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get("/wallet/challenge", async (req) => buildChallenge(ctx.env.sessionSecret, requireSession(req).id));

  app.post("/wallet/link", async (req) => {
    const s = requireSession(req);
    const b = z.object({ address: z.string(), message: z.string().max(1000), signature: z.string() }).parse(req.body);
    if (!isAddress(b.address)) throw new HttpError(400, "invalid address");

    const i = b.message.lastIndexOf("\nmac: ");
    if (i < 0) throw new HttpError(403, "challenge not issued by this server");
    const body = b.message.slice(0, i), given = b.message.slice(i + 6);
    const want = Buffer.from(mac(ctx.env.sessionSecret, body)), have = Buffer.from(given);
    if (want.length !== have.length || !timingSafeEqual(want, have)) throw new HttpError(403, "challenge not issued by this server");

    const f = Object.fromEntries(body.split("\n").slice(1).map((l) => l.split(": ") as [string, string]));
    const issued = Date.parse(f.issued_at ?? ""), expires = Date.parse(f.expires_at ?? "");
    if (Number(f.github_user_id) !== s.id) throw new HttpError(403, "challenge was issued for a different user");
    if (!(Date.now() < expires)) throw new HttpError(403, "challenge expired");
    const [prev] = await ctx.db.select().from(wallet_links).where(eq(wallet_links.github_user_id, s.id));
    // A used challenge always predates the verified_at it produced, so replays fail here without an extra table.
    if (prev && !(issued > prev.verified_at.getTime())) throw new HttpError(403, "challenge already used");

    let ok = false;
    try { ok = await verifyMessage({ address: b.address as Hex, message: b.message, signature: b.signature as Hex }); } catch { /* bad sig */ }
    if (!ok) throw new HttpError(403, "signature does not match address");

    const verified_at = new Date();
    const row = { github_user_id: s.id, wallet_address: b.address.toLowerCase(), signed_challenge: JSON.stringify({ message: b.message, signature: b.signature }), verified_at };
    await ctx.db.insert(wallet_links).values(row).onConflictDoUpdate({ target: wallet_links.github_user_id, set: row });
    return { wallet_address: row.wallet_address, verified_at: verified_at.toISOString() };
  });
}
