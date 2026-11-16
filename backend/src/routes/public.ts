import { eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError, type Ctx } from "../ctx.js";
import { bounties, chain_events, pull_requests, repositories } from "../db/schema.js";
import { approvalsOfBounty, bountyViews, candidatesOfPr, displayUser } from "./view.js";

/** Fail closed: a repository is public only after a successful, live GitHub visibility check. */
async function publicBounties(ctx: Ctx) {
  const repos = await ctx.db.select().from(repositories);
  const visible = await Promise.all(repos.map(async (repo) => {
    try {
      const info = await ctx.gh.getRepository(repo.installation_id, repo.name);
      return info.isPublic ? { ...repo, ...info } : null;
    } catch { return null; }
  }));
  const verified = visible.filter((r) => r !== null);
  if (!verified.length) return [];
  const rows = await bountyViews(ctx, inArray(bounties.pr_id,
    ctx.db.select({ id: pull_requests.id }).from(pull_requests).where(inArray(pull_requests.repo_id, verified.map((r) => r.id)))));
  return rows.map((b) => ({ ...b, repository: verified.find((r) => r.github_repo_id === b.repo.github_repo_id)! }));
}

export function publicRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get("/open-source", async () => {
    const rows = await publicBounties(ctx);
    const open = rows.filter((b) => b.onchain_bounty_id !== null && ["funded", "review_candidate"].includes(b.status)
      && b.pr.status === "open" && b.deadline.getTime() > Date.now());
    const live = await Promise.all(open.map(async (b) => {
      try {
        const pr = await ctx.gh.getPullRequest(b.repository.installation_id, b.repo.name, b.pr.github_pr_number);
        if (pr?.status !== "open") return null;
        const { repository, ...view } = b;
        return { ...view, description: repository.description, language: repository.language };
      } catch { return null; }
    }));
    return { bounties: live.filter((b) => b !== null) };
  });

  app.get("/reviewers/:id", async (req) => {
    const userId = z.coerce.number().int().positive().safe().parse((req.params as { id: string }).id);
    const rows = await publicBounties(ctx);
    const contributions = [];
    for (const { repository, ...bounty } of rows) {
      const [pr] = await ctx.db.select({ id: pull_requests.id }).from(pull_requests).where(eq(pull_requests.pr_hash, bounty.pr.pr_hash));
      const candidates = (await candidatesOfPr(ctx, pr!.id)).filter((c) => c.github_reviewer_id === userId);
      if (!candidates.length) continue;
      const approvals = (await approvalsOfBounty(ctx, bounty.id)).filter((a) => a.reviewer_id === userId && a.status !== "prepared");
      const events = bounty.onchain_bounty_id === null ? [] : await ctx.db.select().from(chain_events)
        .where(eq(chain_events.onchain_bounty_id, bounty.onchain_bounty_id));
      contributions.push({ ...bounty, candidates, approvals, events });
    }
    const first = rows[0];
    const identity = contributions[0]?.candidates[0]?.reviewer
      ?? (first ? await displayUser(ctx, first.repository.installation_id, userId) : { id: userId, login: `GitHub user ${userId}` });
    return { user: identity, bounties: contributions };
  });

  app.get("/bounties/:id/badge.svg", async (req, reply) => {
    const bountyId = z.coerce.number().int().positive().parse((req.params as { id: string }).id);
    const b = (await publicBounties(ctx)).find((b) => b.id === bountyId);
    if (!b) throw new HttpError(404, "public bounty not found");
    const units = BigInt(b.amount_units);
    const amount = `${units / 1_000_000n}.${((units % 1_000_000n) / 10_000n).toString().padStart(2, "0")}`;
    const status = b.deadline.getTime() <= Date.now() && ["funded", "review_candidate"].includes(b.status) ? "expired" : b.status;
    const right = `${amount} test USDC · ${status.replaceAll("_", " ")}`;
    const width = Math.max(230, right.length * 7 + 20);
    reply.type("image/svg+xml").header("cache-control", "public, max-age=30").header("x-content-type-options", "nosniff");
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width + 103}" height="28" role="img" aria-label="Merit review bounty: ${right}"><title>Merit review bounty: ${right}</title><rect width="${width + 103}" height="28" rx="3" fill="#4e5843"/><path d="M3 0h100v28H3a3 3 0 0 1-3-3V3a3 3 0 0 1 3-3" fill="#3f3b33"/><g fill="#f4eddd" font-family="Verdana,sans-serif" font-size="11" text-anchor="middle"><text x="51" y="18">Merit review</text><text x="${103 + width / 2}" y="18">${right}</text></g></svg>`;
  });
}
