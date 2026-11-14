import { eq } from "drizzle-orm";
import type { Ctx } from "../ctx.js";
import { bounties, pull_requests, repositories, review_candidates } from "../db/schema.js";
import { refreshBounty } from "../bounty.js";

export const LIMITATIONS =
  "Heuristic only: a later commit touched the file near the commented line and the thread is resolved. " +
  "It breaks on rebase, force-push and line movement, and does not show the comment was useful. A maintainer must decide.";
export const MANUAL_LIMITATIONS = "Evidence URL supplied by a maintainer; not machine-checked beyond the comment existing on this PR.";

const NEAR = 10; // lines either side of the comment

/** True if any hunk's new-file range comes within NEAR lines of `line`. No patch (huge diff) counts as touched. */
export function touchesNear(patch: string | undefined, line: number): boolean {
  if (patch === undefined) return true;
  for (const m of patch.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(m[1]);
    const end = start + Math.max(Number(m[2] ?? 1), 1) - 1;
    if (start <= line + NEAR && end >= line - NEAR) return true;
  }
  return false;
}

/** pending -> candidate when: comment exists (it does), thread resolved, a later commit touched the file near it. */
export async function evaluateCandidate(ctx: Ctx, candidateId: number) {
  const [c] = await ctx.db.select().from(review_candidates).where(eq(review_candidates.id, candidateId));
  if (!c || c.status !== "pending" || !c.thread_resolved) return;
  const [row] = await ctx.db.select({ pr: pull_requests, repo: repositories }).from(pull_requests)
    .innerJoin(repositories, eq(repositories.id, pull_requests.repo_id)).where(eq(pull_requests.id, c.pr_id));
  if (!row || row.pr.head_sha === c.commit_sha) return;
  const ev = c.qualification_evidence as { line?: number };
  let files;
  try {
    files = await ctx.gh.compareFiles(row.repo.installation_id, row.repo.name, c.commit_sha, row.pr.head_sha);
  } catch { return; } // GitHub unavailable: stay pending, a later event retries
  const f = files.find((x) => x.filename === c.file_path);
  if (!f || !touchesNear(f.patch, ev.line ?? 0)) return;
  await ctx.db.update(review_candidates).set({
    status: "candidate",
    qualification_evidence: { ...ev, method: "heuristic", limitations: LIMITATIONS, compared: `${c.commit_sha}...${row.pr.head_sha}`, file_touched: c.file_path, thread_resolved: true },
  }).where(eq(review_candidates.id, c.id));
  await refreshBountiesOfPr(ctx, c.pr_id);
}

export async function refreshBountiesOfPr(ctx: Ctx, prId: number) {
  const rows = await ctx.db.select({ id: bounties.id }).from(bounties).where(eq(bounties.pr_id, prId));
  for (const b of rows) await refreshBounty(ctx, b.id);
}
