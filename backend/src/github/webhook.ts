import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prHash } from "../chain/escrow.js";
import type { Ctx } from "../ctx.js";
import { pull_requests, repositories, review_candidates } from "../db/schema.js";
import { evaluateCandidate, refreshBountiesOfPr, LIMITATIONS } from "./evidence.js";

export function signGithubBody(secret: string, raw: Buffer | string) {
  return "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
}
function validSignature(secret: string, raw: Buffer, header: string | undefined) {
  if (!header) return false;
  const a = Buffer.from(signGithubBody(secret, raw));
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}

const user = z.object({ id: z.number(), type: z.string().default("User"), login: z.string().optional(), avatar_url: z.string().optional() });
const repo = z.object({ id: z.number() });
const pr = z.object({ number: z.number(), user, head: z.object({ sha: z.string() }), merged: z.boolean().optional(), state: z.string().optional() });
const base = z.object({ repository: repo });
const installedRepository = z.object({ id: z.number(), full_name: z.string().min(3) });
const installationEvent = z.object({
  action: z.string(),
  installation: z.object({ id: z.number() }),
  sender: z.object({ id: z.number() }),
  repositories: z.array(installedRepository).optional(),
  repositories_added: z.array(installedRepository).optional(),
});
const prEvent = base.extend({ action: z.string(), pull_request: pr });
const commentEvent = base.extend({
  action: z.string(),
  pull_request: pr,
  comment: z.object({
    id: z.number(), user, path: z.string(), diff_hunk: z.string(),
    body: z.string().optional(), created_at: z.string().optional(),
    commit_id: z.string().optional(), original_commit_id: z.string().optional(),
    line: z.number().nullish(), original_line: z.number().nullish(), in_reply_to_id: z.number().nullish(),
  }),
});
const threadEvent = base.extend({
  action: z.string(),
  pull_request: pr,
  thread: z.object({ node_id: z.string(), comments: z.array(z.object({ id: z.number() })).min(1) }),
});

const DELIVERIES_MAX = 5000;

export async function githubWebhook(app: FastifyInstance, ctx: Ctx) {
  // shortcut: in-memory delivery dedupe (only 7 tables allowed). Handlers are idempotent upserts keyed on
  // GitHub ids, so a replay after a restart is harmless; upgrade to a table if a 8th is ever allowed.
  const seen = new Set<string>();
  // Raw bytes: the signature covers the exact body, so verify BEFORE parsing.
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => done(null, body));

  app.post("/webhooks/github", async (req, reply) => {
    const raw = req.body as Buffer;
    if (!validSignature(ctx.env.github.webhookSecret, raw, req.headers["x-hub-signature-256"] as string | undefined))
      return reply.code(401).send({ error: "bad signature" });

    const delivery = req.headers["x-github-delivery"] as string | undefined;
    if (!delivery) return reply.code(400).send({ error: "missing X-GitHub-Delivery" });
    if (seen.has(delivery)) return { ok: true, duplicate: true };

    let json: unknown;
    try { json = JSON.parse(raw.toString("utf8")); } catch { return reply.code(400).send({ error: "invalid json" }); }
    const event = req.headers["x-github-event"] as string | undefined;
    if (event === "ping") return { ok: true };
    if (event === "installation" || event === "installation_repositories") {
      const parsed = installationEvent.parse(json);
      const added = event === "installation" && parsed.action === "created" ? parsed.repositories
        : event === "installation_repositories" && parsed.action === "added" ? parsed.repositories_added
        : undefined;
      if (added) {
        for (const r of added) {
          await ctx.db.insert(repositories).values({
            github_repo_id: r.id,
            installation_id: parsed.installation.id,
            name: r.full_name,
            maintainer_github_id: parsed.sender.id,
          }).onConflictDoUpdate({
            target: repositories.github_repo_id,
            set: { installation_id: parsed.installation.id, name: r.full_name, maintainer_github_id: parsed.sender.id },
          });
        }
      }
      seen.add(delivery);
      return { ok: true, registered: added?.length ?? 0 };
    }
    if (!["pull_request", "pull_request_review_comment", "pull_request_review_thread"].includes(event ?? "")) return { ok: true, ignored: event };

    const { repository } = base.parse(json);
    const [repoRow] = await ctx.db.select().from(repositories).where(eq(repositories.github_repo_id, repository.id));
    if (!repoRow) return reply.code(403).send({ error: "repository not registered" });

    if (event === "pull_request") await onPullRequest(ctx, repoRow, prEvent.parse(json));
    else if (event === "pull_request_review_comment") await onComment(ctx, repoRow, commentEvent.parse(json));
    else await onThread(ctx, repoRow, threadEvent.parse(json));

    seen.add(delivery);
    if (seen.size > DELIVERIES_MAX) seen.delete(seen.values().next().value!);
    return { ok: true };
  });
}

type Repo = typeof repositories.$inferSelect;

async function upsertPr(ctx: Ctx, repoRow: Repo, p: z.infer<typeof pr>) {
  // pull_request events carry `merged`; review-comment and review-thread payloads omit it, so a closed PR in
  // them may or may not be merged. Without a merge flag this reads as "closed", and a first sighting never
  // invents a merge.
  const status = p.merged ? "merged" : p.state === "closed" ? "closed" : "open";
  const [row] = await ctx.db.insert(pull_requests).values({
    repo_id: repoRow.id, github_pr_number: p.number, head_sha: p.head.sha, status,
    author_github_id: p.user.id, pr_hash: prHash(repoRow.github_repo_id, p.number),
  }).onConflictDoUpdate({
    target: [pull_requests.repo_id, pull_requests.github_pr_number],
    // A merge is final on GitHub (a merged PR cannot be reopened or unmerged), so a known "merged" is kept
    // against any later payload: a sparse one without the flag, or a delayed older delivery. Done in the
    // same statement, so concurrent deliveries cannot race past it.
    set: { head_sha: p.head.sha, status: sql`case when ${pull_requests.status} = 'merged' then 'merged' else excluded.status end` },
  }).returning();
  return row!;
}

async function reevaluate(ctx: Ctx, prId: number) {
  const pend = await ctx.db.select({ id: review_candidates.id }).from(review_candidates)
    .where(eq(review_candidates.pr_id, prId));
  for (const c of pend) await evaluateCandidate(ctx, c.id);
  await refreshBountiesOfPr(ctx, prId);
}

async function onPullRequest(ctx: Ctx, repoRow: Repo, e: z.infer<typeof prEvent>) {
  const row = await upsertPr(ctx, repoRow, e.pull_request);
  if (e.action === "synchronize") await reevaluate(ctx, row.id); // new head commit may now touch a commented file
}

async function onComment(ctx: Ctx, repoRow: Repo, e: z.infer<typeof commentEvent>) {
  const row = await upsertPr(ctx, repoRow, e.pull_request);
  const c = e.comment;
  if (e.action !== "created" || c.in_reply_to_id) return; // only top-level review comments can become candidates
  // Immutable numeric ids, never logins. Bots and the PR author are never candidates.
  if (c.user.type === "Bot" || c.user.id === row.author_github_id) return;
  const [candidate] = await ctx.db.insert(review_candidates).values({
    pr_id: row.id, github_comment_id: c.id, github_reviewer_id: c.user.id,
    file_path: c.path, diff_hunk: c.diff_hunk, commit_sha: c.original_commit_id ?? c.commit_id ?? "",
    qualification_evidence: { method: "heuristic", limitations: LIMITATIONS, line: c.original_line ?? c.line ?? 0,
      reviewer: c.user, comment_body: c.body, commented_at: c.created_at },
  }).onConflictDoNothing({ target: review_candidates.github_comment_id }).returning();
  if (candidate) await evaluateCandidate(ctx, candidate.id);
}

async function onThread(ctx: Ctx, repoRow: Repo, e: z.infer<typeof threadEvent>) {
  const row = await upsertPr(ctx, repoRow, e.pull_request);
  const resolved = e.action === "resolved";
  if (!resolved && e.action !== "unresolved") return;
  const rootId = e.thread.comments[0]!.id;
  await ctx.db.update(review_candidates)
    .set({ thread_node_id: e.thread.node_id, thread_resolved: resolved,
      qualification_evidence: resolved
        ? sql`jsonb_set(${review_candidates.qualification_evidence}, '{resolved_at}', ${JSON.stringify(new Date().toISOString())}::jsonb)`
        : sql`${review_candidates.qualification_evidence} - 'resolved_at'` })
    .where(and(eq(review_candidates.pr_id, row.id), eq(review_candidates.github_comment_id, rootId)));
  await reevaluate(ctx, row.id);
}

