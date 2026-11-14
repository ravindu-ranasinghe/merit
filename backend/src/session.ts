import type { FastifyReply, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import type { Ctx } from "./ctx.js";
import { HttpError } from "./ctx.js";
import { pull_requests, repositories } from "./db/schema.js";

export interface Session { id: number; login: string }
const COOKIE = "merit_session";

export function setSession(reply: FastifyReply, s: Session) {
  reply.setCookie(COOKIE, JSON.stringify(s), { signed: true, httpOnly: true, sameSite: "lax", path: "/", maxAge: 7 * 86400 });
}
export const clearSession = (reply: FastifyReply) => reply.clearCookie(COOKIE, { path: "/" });

/** Signed httpOnly cookie only. The browser never supplies an identity or a role. */
export function requireSession(req: FastifyRequest): Session {
  const raw = req.cookies[COOKIE];
  const u = raw ? req.unsignCookie(raw) : null;
  if (!u?.valid || !u.value) throw new HttpError(401, "login required");
  try {
    const s = JSON.parse(u.value) as Session;
    if (typeof s.id === "number") return s;
  } catch { /* fall through */ }
  throw new HttpError(401, "login required");
}

/** Live GitHub check at call time: admin or maintain on the repo. Never a role from the client. */
export async function requireMaintainer(ctx: Ctx, user: Session, repo: typeof repositories.$inferSelect) {
  const perm = await ctx.gh.getRepoPermission(repo.installation_id, repo.name, user.id);
  if (perm !== "admin" && perm !== "maintain") throw new HttpError(403, "maintainer permission required on this repository");
}

export async function repoOfPr(ctx: Ctx, prId: number) {
  const [row] = await ctx.db.select({ pr: pull_requests, repo: repositories }).from(pull_requests)
    .innerJoin(repositories, eq(repositories.id, pull_requests.repo_id)).where(eq(pull_requests.id, prId));
  if (!row) throw new HttpError(404, "pull request not found");
  return row;
}
