import { and, eq } from "drizzle-orm";
import { HttpError, type Ctx } from "../ctx.js";
import { pull_requests, review_candidates } from "../db/schema.js";
import { repoOfPr } from "../session.js";
import { evaluateCandidate, LIMITATIONS, refreshBountiesOfPr, type Evidence } from "./evidence.js";

/** Reconcile with GitHub so missed webhooks can be recovered without creating any money state. */
export async function syncReviews(ctx: Ctx, prId: number) {
  const { pr, repo } = await repoOfPr(ctx, prId);
  const [live, comments, threads] = await Promise.all([
    ctx.gh.getPullRequest(repo.installation_id, repo.name, pr.github_pr_number, true),
    ctx.gh.listReviewComments(repo.installation_id, repo.name, pr.github_pr_number),
    ctx.gh.listReviewThreads(repo.installation_id, repo.name, pr.github_pr_number),
  ]);
  if (!live) throw new HttpError(404, "pull request not found on GitHub");
  await ctx.db.update(pull_requests).set({ head_sha: live.headSha, status: live.status }).where(eq(pull_requests.id, prId));
  for (const c of comments) {
    if (c.in_reply_to_id || c.user.type === "Bot" || c.user.id === pr.author_github_id) continue;
    const [existing] = await ctx.db.select().from(review_candidates).where(and(eq(review_candidates.pr_id, prId), eq(review_candidates.github_comment_id, c.id)));
    const thread = threads.find((t) => t.commentId === c.id);
    const evidence: Evidence = {
      method: "heuristic", limitations: LIMITATIONS, ...(existing?.qualification_evidence as Evidence | undefined),
      line: c.line, reviewer: c.user, comment_body: c.body, commented_at: c.created_at,
    };
    if (thread) evidence.resolved_at = thread.resolved ? evidence.resolved_at ?? new Date().toISOString() : undefined;
    const vals = { qualification_evidence: evidence,
      ...(thread ? { thread_resolved: thread.resolved, thread_node_id: thread.id } : {}) };
    const [candidate] = existing
      ? await ctx.db.update(review_candidates).set(vals).where(and(eq(review_candidates.id, existing.id), eq(review_candidates.status, existing.status))).returning()
      : await ctx.db.insert(review_candidates).values({ ...vals, pr_id: prId,
        github_comment_id: c.id, github_reviewer_id: c.user.id, file_path: c.path,
        diff_hunk: c.diff_hunk, commit_sha: c.commit_sha,
      }).onConflictDoNothing().returning();
    if (candidate) await evaluateCandidate(ctx, candidate.id);
  }
  await refreshBountiesOfPr(ctx, prId);
}
