import { and, eq } from "drizzle-orm";
import type { Ctx } from "../ctx.js";
import { bounties, pull_requests, repositories, review_candidates } from "../db/schema.js";
import { refreshBounty } from "../bounty.js";

export const LIMITATIONS =
  "Heuristic only: a later commit touched the file near the commented line and the thread is resolved. " +
  "It breaks on rebase, force-push and line movement, and does not show the comment was useful. A maintainer must decide.";
export const MANUAL_LIMITATIONS = "Evidence URL supplied by a maintainer; not machine-checked beyond the comment existing on this PR.";

const NEAR = 10; // lines either side of the comment

export interface Evidence {
  method: "heuristic" | "manual";
  limitations: string;
  line?: number;
  reviewer?: { id: number; login?: string; avatar_url?: string };
  comment_body?: string;
  commented_at?: string;
  checked_at?: string;
  check_reason?: "waiting_for_commit" | "waiting_for_fix" | "waiting_for_resolution" | "github_unavailable" | "missing_line" | "ready";
  later_commit_touched?: boolean | null;
  file_touched?: string;
  compared?: string;
  compared_head?: string;
  resolved_at?: string;
}

/** The comment's original line is in the base file, so compare against each hunk's old-file range. */
export function touchesNear(patch: string | undefined, line: number): boolean {
  if (patch === undefined) return true;
  for (const m of patch.matchAll(/^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/gm)) {
    const start = Number(m[1]);
    const end = start + Math.max(Number(m[2] ?? 1), 1) - 1;
    if (start <= line + NEAR && end >= line - NEAR) return true;
  }
  return false;
}

/** pending -> candidate when: comment exists (it does), thread resolved, a later commit touched the file near it. */
export async function evaluateCandidate(ctx: Ctx, candidateId: number) {
  const [c] = await ctx.db.select().from(review_candidates).where(eq(review_candidates.id, candidateId));
  if (!c || !["pending", "candidate"].includes(c.status)) return;
  const ev = c.qualification_evidence as Evidence;
  if (ev.method === "manual") return;
  const [row] = await ctx.db.select({ pr: pull_requests, repo: repositories }).from(pull_requests)
    .innerJoin(repositories, eq(repositories.id, pull_requests.repo_id)).where(eq(pull_requests.id, c.pr_id));
  if (!row) return;
  const save = async (reason: Evidence["check_reason"], touched: boolean | null) => {
    const ready = touched === true && c.thread_resolved;
    await ctx.db.update(review_candidates).set({
      status: ready ? "candidate" : "pending",
      qualification_evidence: {
        ...ev, file_touched: touched ? c.file_path : undefined,
        compared: `${c.commit_sha}...${row.pr.head_sha}`, compared_head: row.pr.head_sha,
        check_reason: reason, later_commit_touched: touched, checked_at: new Date().toISOString(),
      },
    }).where(and(eq(review_candidates.id, c.id), eq(review_candidates.status, c.status), eq(review_candidates.thread_resolved, c.thread_resolved)));
  };
  if (row.pr.head_sha === c.commit_sha) return save("waiting_for_commit", false);
  if (!ev.line || !c.commit_sha) return save("missing_line", null);
  let files;
  try {
    files = await ctx.gh.compareFiles(row.repo.installation_id, row.repo.name, c.commit_sha, row.pr.head_sha);
  } catch { return save("github_unavailable", null); }
  const f = files.find((x) => x.filename === c.file_path);
  const touched = !!f && touchesNear(f.patch, ev.line);
  await save(!touched ? "waiting_for_fix" : c.thread_resolved ? "ready" : "waiting_for_resolution", touched);
  await refreshBountiesOfPr(ctx, c.pr_id);
}

export async function refreshBountiesOfPr(ctx: Ctx, prId: number) {
  const rows = await ctx.db.select({ id: bounties.id }).from(bounties).where(eq(bounties.pr_id, prId));
  for (const b of rows) await refreshBounty(ctx, b.id);
}
