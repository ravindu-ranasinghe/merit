import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { authRoutes } from "./auth.js";
import { HttpError, type Ctx } from "./ctx.js";
import { githubWebhook } from "./github/webhook.js";
import { bountyRoutes } from "./routes/bounties.js";
import { meRoutes } from "./routes/me.js";
import { walletRoutes } from "./routes/wallet.js";
import { streamsWebhook } from "./streams/webhook.js";

export type { Ctx };

export async function buildApp(ctx: Ctx, opts: { logger?: boolean; app?: FastifyInstance } = {}) {
  const app: FastifyInstance = opts.app ?? Fastify({ logger: opts.logger ?? false });
  await app.register(cors, { origin: ctx.env.webOrigin, credentials: true });
  await app.register(cookie, { secret: ctx.env.sessionSecret });

  // CSRF: a browser always sends Origin on a cross-site write, so a write from any other site is
  // refused even though the SameSite=None session cookie rides along. Webhooks send no Origin.
  app.addHook("onRequest", async (req) => {
    const o = req.headers.origin;
    if (o && o !== ctx.env.webOrigin && !["GET", "HEAD", "OPTIONS"].includes(req.method)) throw new HttpError(403, "cross-site request refused");
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: "invalid request", issues: err.issues });
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: (err as Error).message });
    req.log.error(err);
    return reply.code(500).send({ error: "internal error" });
  });

  authRoutes(app, ctx);
  meRoutes(app, ctx);
  walletRoutes(app, ctx);
  bountyRoutes(app, ctx);
  // Webhooks keep the raw body (signature is over bytes), so each lives in its own encapsulated scope.
  await app.register(async (s) => githubWebhook(s, ctx));
  await app.register(async (s) => streamsWebhook(s, ctx));

  app.get("/health", async () => ({ ok: true, github_mock: ctx.gh.mock }));
  return app;
}
