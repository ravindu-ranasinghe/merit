import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Ctx } from "../ctx.js";
import { sweepExpired } from "../sweep.js";

/** Hash both sides first so the compare is constant-time regardless of the presented token's length. */
const digest = (s: string) => createHash("sha256").update(s).digest();

export function bearerMatches(header: unknown, secret: string) {
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return false;
  return timingSafeEqual(digest(header.slice(7)), digest(secret));
}

/**
 * Scheduler-only routes. They do not exist (404) unless SWEEP_SECRET is set, and they accept no session cookie:
 * only `Authorization: Bearer <SWEEP_SECRET>`. Nothing here holds a key or moves money.
 */
export function internalRoutes(app: FastifyInstance, ctx: Ctx) {
  app.post("/internal/sweep", async (req, reply) => {
    const secret = ctx.env.sweepSecret;
    if (!secret) return reply.code(404).send({ error: "not found" });
    if (!bearerMatches(req.headers.authorization, secret)) return reply.code(401).send({ error: "unauthorized" });
    const report = await sweepExpired(ctx, Date.now(), req.log);
    if (report.refundable.length) req.log.info({ refundable: report.refundable }, "expired bounties awaiting refund");
    return report;
  });
}
