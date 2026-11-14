import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { ZodError } from "zod";
import type { Db } from "./db/index.js";
import type { Env } from "./env.js";
import type { GitHubClient } from "./github/client.js";

export interface Ctx { db: Db; env: Env; gh: GitHubClient }

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function buildApp(ctx: Ctx, opts: { logger?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? false });
  await app.register(cors, { origin: ctx.env.webOrigin, credentials: true });
  await app.register(cookie, { secret: ctx.env.sessionSecret });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: "invalid request", issues: err.issues });
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: (err as Error).message });
    req.log.error(err);
    return reply.code(500).send({ error: "internal error" });
  });

  app.get("/health", async () => ({ ok: true, github_mock: ctx.gh.mock }));
  return app;
}
