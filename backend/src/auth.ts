import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Ctx } from "./ctx.js";
import { HttpError } from "./ctx.js";
import { randomState } from "./github/client.js";
import { clearSession, setSession } from "./session.js";

const STATE = "merit_oauth_state";

export function authRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get("/auth/github/login", async (_req, reply) => {
    const state = randomState();
    reply.setCookie(STATE, state, { signed: true, httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 });
    return reply.redirect(ctx.gh.oauthUrl(state));
  });

  app.get("/auth/github/callback", async (req, reply) => {
    const q = z.object({ code: z.string().min(1), state: z.string().min(1) }).parse(req.query);
    const raw = req.cookies[STATE];
    const st = raw ? req.unsignCookie(raw) : null;
    if (!st?.valid || st.value !== q.state) throw new HttpError(400, "bad oauth state");
    let user;
    try { user = await ctx.gh.exchangeCode(q.code); } catch { throw new HttpError(400, "oauth code exchange failed"); }
    reply.clearCookie(STATE, { path: "/" });
    setSession(reply, { id: user.id, login: user.login });
    return reply.redirect(ctx.env.webOrigin);
  });

  app.post("/auth/logout", async (_req, reply) => {
    clearSession(reply);
    return reply.code(204).send();
  });
}
