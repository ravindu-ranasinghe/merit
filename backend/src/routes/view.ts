import { desc, eq, getTableColumns, type SQL } from "drizzle-orm";
import type { Ctx } from "../ctx.js";
import { approvals, bounties, chain_events, pull_requests, repositories, review_candidates, wallet_links } from "../db/schema.js";
import { refreshBounty } from "../bounty.js";
import type { Evidence } from "../github/evidence.js";
import type { Session } from "../session.js";
import { approvalMatches } from "../streams/match.js";

export async function canReadRepository(ctx: Ctx, repo: typeof repositories.$inferSelect, session?: Session) {
  try {
    if ((await ctx.gh.getRepository(repo.installation_id, repo.name)).isPublic) return true;
    if (!session) return false;
    return ["admin", "maintain", "write", "triage", "read"].includes(await ctx.gh.getRepoPermission(repo.installation_id, repo.name, session.id));
  } catch { return false; }
}

export async function displayUser(ctx: Ctx, installationId: number, id: number) {
  try { return await ctx.gh.getUser(installationId, id); }
  catch { return { id, login: `GitHub user ${id}` }; }
}

export async function bountyViews(ctx: Ctx, where?: SQL) {
  const q = baseQuery(ctx);
  const rows = await (where ? q.where(where) : q).orderBy(desc(bounties.id));
  const out = [];
  for (const r of rows) {
    r.b.status = (await refreshBounty(ctx, r.b.id)) ?? r.b.status; // time-based overlays (expiry) are applied at read
    const [live, maintainer, author] = await Promise.all([
      ctx.gh.getPullRequest(r.repo.installation_id, r.repo.name, r.pr.github_pr_number).catch(() => null),
      displayUser(ctx, r.repo.installation_id, r.repo.maintainer_github_id),
      displayUser(ctx, r.repo.installation_id, r.pr.author_github_id),
    ]);
    const view = shape(r);
    out.push({ ...view,
      pr: { ...view.pr, title: live?.title, author: live?.author ?? author },
      repo: { ...view.repo, maintainer },
    });
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
  const [repo] = await ctx.db.select({ installationId: repositories.installation_id }).from(pull_requests)
    .innerJoin(repositories, eq(repositories.id, pull_requests.repo_id)).where(eq(pull_requests.id, prId));
  return Promise.all(rows.map(async (c) => ({ ...c,
    reviewer: (c.qualification_evidence as Evidence).reviewer?.login
      ? (c.qualification_evidence as Evidence).reviewer
      : await displayUser(ctx, repo!.installationId, c.github_reviewer_id),
  })));
}

export async function approvalsOfBounty(ctx: Ctx, bountyId: number) {
  const rows = await ctx.db.select().from(approvals).where(eq(approvals.bounty_id, bountyId)).orderBy(approvals.id);
  if (!rows.length) return [];
  const [r] = await ctx.db.select({ installationId: repositories.installation_id, onchainId: bounties.onchain_bounty_id }).from(bounties)
    .innerJoin(pull_requests, eq(pull_requests.id, bounties.pr_id))
    .innerJoin(repositories, eq(repositories.id, pull_requests.repo_id)).where(eq(bounties.id, bountyId));
  const payments = r!.onchainId === null ? [] : await ctx.db.select().from(chain_events)
    .where(eq(chain_events.onchain_bounty_id, r!.onchainId));
  const payout = payments.find((e) => e.event_type === "RewardPaid")?.payload as { claimId: string; recipient: string; amount: string } | undefined;
  // Same rule as the Streams receiver: this bounty's approval, matching claim id, recipient and amount.
  const matched = payout ? rows.filter((a) => a.status !== "prepared" && a.claim_id === payout.claimId && approvalMatches(a, payout)) : rows;
  return Promise.all(matched.map(async (a) => ({ ...a,
    amount_units: payout?.amount ?? a.amount_units,
    reviewer: await displayUser(ctx, r!.installationId, a.reviewer_id),
    approver: await displayUser(ctx, r!.installationId, a.approver_github_id),
  })));
}

export const eventView = (ctx: Ctx, e: typeof chain_events.$inferSelect) => ({ ...e, explorer_url: `${ctx.env.explorerUrl}/tx/${e.tx_hash}` });
