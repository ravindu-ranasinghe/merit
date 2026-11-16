import { eq, getTableColumns } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { Ctx } from "../ctx.js";
import { bounties, chain_events, repositories, review_candidates, wallet_links } from "../db/schema.js";
import { repoOfPr, requireSession } from "../session.js";
import { approvalsOfBounty, bountyViews, canReadRepository } from "./view.js";

export function meRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get("/me", async (req) => {
    const s = requireSession(req);
    const [w] = await ctx.db.select().from(wallet_links).where(eq(wallet_links.github_user_id, s.id));
    const maintains = await ctx.db.select({ github_repo_id: repositories.github_repo_id, name: repositories.name })
      .from(repositories).where(eq(repositories.maintainer_github_id, s.id));
    const mine = await ctx.db.select({ ...getTableColumns(review_candidates), reviewer_wallet: wallet_links.wallet_address })
      .from(review_candidates).leftJoin(wallet_links, eq(wallet_links.github_user_id, review_candidates.github_reviewer_id))
      .where(eq(review_candidates.github_reviewer_id, s.id));
    const as_reviewer = [];
    for (const candidate of mine) {
      const { repo } = await repoOfPr(ctx, candidate.pr_id);
      if (!(await canReadRepository(ctx, repo, s))) continue;
      for (const bounty of await bountyViews(ctx, eq(bounties.pr_id, candidate.pr_id))) {
        const approval = (await approvalsOfBounty(ctx, bounty.id)).find((a) => a.candidate_id === candidate.id);
        const events = bounty.onchain_bounty_id === null ? [] : await ctx.db.select().from(chain_events)
          .where(eq(chain_events.onchain_bounty_id, bounty.onchain_bounty_id));
        as_reviewer.push({ candidate, bounty: { ...bounty, events }, approval: approval ?? null });
      }
    }
    return {
      github_user_id: s.id, login: s.login,
      wallet: w ? { address: w.wallet_address, verified_at: w.verified_at } : null,
      maintains, as_reviewer,
    };
  });
}
