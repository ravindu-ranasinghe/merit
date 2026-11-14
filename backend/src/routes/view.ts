import { desc, eq, getTableColumns, type SQL } from "drizzle-orm";
import type { Ctx } from "../ctx.js";
import { approvals, bounties, chain_events, pull_requests, repositories, review_candidates, wallet_links } from "../db/schema.js";
import { refreshBounty } from "../bounty.js";

export async function bountyViews(ctx: Ctx, where?: SQL) {
  const q = baseQuery(ctx);
  const rows = await (where ? q.where(where) : q).orderBy(desc(bounties.id));
  const out = [];
  for (const r of rows) {
    r.b.status = (await refreshBounty(ctx, r.b.id)) ?? r.b.status; // time-based overlays (expiry) are applied at read
    out.push(shape(r));
  }
  return out;
}

const baseQuery = (ctx: Ctx) =>
  ctx.db.select({ b: bounties, pr: pull_requests, repo: repositories }).from(bounties)
    .innerJoin(pull_requests, eq(pull_requests.id, bounties.pr_id))
    .innerJoin(repositories, eq(repositories.id, pull_requests.repo_id)).$dynamic();

type Row = { b: typeof bounties.$inferSelect; pr: typeof pull_requests.$inferSelect; repo: typeof repositories.$inferSelect };
export const shape = ({ b, pr, repo }: Row) => ({
  id: b.id, onchain_bounty_id: b.onchain_bounty_id, status: b.status, amount_units: b.amount_units,
  funder_wallet: b.funder_wallet, deadline: b.deadline, created_at: b.created_at,
  pr: { github_pr_number: pr.github_pr_number, head_sha: pr.head_sha, status: pr.status, author_github_id: pr.author_github_id, pr_hash: pr.pr_hash },
  repo: { github_repo_id: repo.github_repo_id, name: repo.name, maintainer_github_id: repo.maintainer_github_id },
});

export async function candidatesOfPr(ctx: Ctx, prId: number) {
  const rows = await ctx.db.select({ ...getTableColumns(review_candidates), reviewer_wallet: wallet_links.wallet_address })
    .from(review_candidates).leftJoin(wallet_links, eq(wallet_links.github_user_id, review_candidates.github_reviewer_id))
    .where(eq(review_candidates.pr_id, prId)).orderBy(review_candidates.id);
  return rows;
}

export const approvalsOfBounty = (ctx: Ctx, bountyId: number) =>
  ctx.db.select().from(approvals).where(eq(approvals.bounty_id, bountyId)).orderBy(approvals.id);

export const eventView = (ctx: Ctx, e: typeof chain_events.$inferSelect) => ({ ...e, explorer_url: `${ctx.env.explorerUrl}/tx/${e.tx_hash}` });
