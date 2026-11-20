import { and, desc, eq, inArray, isNotNull, lt, notInArray, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { refreshBounty } from "../bounty.js";
import { claimId, encodeApproveReward, encodeCreateBounty, prHash } from "../chain/escrow.js";
import { HttpError, type Ctx } from "../ctx.js";
import { isUniqueViolation } from "../db/index.js";
import { approvals, bounties, chain_events, pull_requests, repositories, review_candidates, wallet_links } from "../db/schema.js";
import { MANUAL_LIMITATIONS } from "../github/evidence.js";
import { syncReviews } from "../github/sync.js";
import { reconcile } from "../streams/webhook.js";
import { eventContext } from "../streams/match.js";
import { repoOfPr, requireMaintainer, requireSession, type Session } from "../session.js";
import { approvalsOfBounty, bountyViews, candidatesOfPr, canReadRepository, eventView } from "./view.js";

const units = z.string().regex(/^[1-9]\d{0,77}$/, "decimal string of integer units");
const id = z.coerce.number().int().positive();
const txHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const EVIDENCE_URL = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)#discussion_r(\d+)$/;

export function bountyRoutes(app: FastifyInstance, ctx: Ctx) {
  const chain = { chainId: ctx.env.chainId, escrow: ctx.env.escrowAddress, usdc: ctx.env.usdcAddress };

  app.get("/config", async () => ({
    chain_id: ctx.env.chainId, escrow_address: ctx.env.escrowAddress, usdc_address: ctx.env.usdcAddress,
    usdc_decimals: 6, explorer_url: ctx.env.explorerUrl,
  }));

  app.get("/bounties", async (req) => {
    const q = z.object({ status: z.string().optional(), repo: z.string().optional() }).parse(req.query);
    let session: Session | undefined;
    try { session = requireSession(req); } catch { /* public discovery needs no session */ }
    const repos = await ctx.db.select().from(repositories);
    const access = await Promise.all(repos.map(async (r) => await canReadRepository(ctx, r, session) ? r.id : null));
    const visible = access.filter((id) => id !== null);
    let rows = visible.length ? await bountyViews(ctx, inArray(bounties.pr_id,
      ctx.db.select({ id: pull_requests.id }).from(pull_requests).where(inArray(pull_requests.repo_id, visible)))) : [];
    if (q.status) rows = rows.filter((r) => r.status === q.status);
    if (q.repo) rows = rows.filter((r) => r.repo.name === q.repo);
    // Each row carries its indexed events (the same shape as GET /bounties/:id), so a list can show confirmed
    // funded, paid and refunded amounts without a request per bounty. One query for the whole list.
    const ids = rows.flatMap((r) => (r.onchain_bounty_id === null ? [] : [r.onchain_bounty_id]));
    const events = ids.length ? await ctx.db.select().from(chain_events).where(and(eventContext(ctx), inArray(chain_events.onchain_bounty_id, ids)))
      .orderBy(desc(chain_events.block_number), desc(chain_events.log_index)) : [];
    return { bounties: rows.map((r) => ({ ...r, events: events.filter((e) => e.onchain_bounty_id === r.onchain_bounty_id).map((e) => eventView(ctx, e)) })) };
  });

  const loadBounty = async (bountyId: number) => {
    const [v] = await bountyViews(ctx, eq(bounties.id, bountyId));
    if (!v) throw new HttpError(404, "bounty not found");
    const [pr] = await ctx.db.select().from(pull_requests).where(eq(pull_requests.pr_hash, v.pr.pr_hash));
    return { v, prId: pr!.id };
  };

  const refreshing = new Set<number>();
  const refreshedAt = new Map<number, number>();
  app.post("/bounties/:id/refresh", async (req) => {
    const session = requireSession(req);
    const { prId } = await loadBounty(id.parse((req.params as { id: string }).id));
    const { repo } = await repoOfPr(ctx, prId);
    const info = await ctx.gh.getRepository(repo.installation_id, repo.name).catch(() => {
      throw new HttpError(502, "GitHub repository access could not be verified. Try again shortly.");
    });
    if (!info.isPublic) await requireMaintainer(ctx, session, repo);
    if (refreshing.has(prId) || Date.now() - (refreshedAt.get(prId) ?? 0) < 10_000)
      throw new HttpError(429, "GitHub was just checked. Try again in a few seconds.");
    refreshing.add(prId);
    try {
      await syncReviews(ctx, prId);
      if (refreshedAt.size >= 1000) refreshedAt.delete(refreshedAt.keys().next().value!);
      refreshedAt.set(prId, Date.now());
      return { ok: true, checked_at: new Date().toISOString() };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, "GitHub could not be checked. Your review is still pending; try again.");
    } finally { refreshing.delete(prId); }
  });

  app.get("/bounties/:id", async (req) => {
    const { v, prId } = await loadBounty(id.parse((req.params as { id: string }).id));
    const { repo } = await repoOfPr(ctx, prId);
    let session: Session | undefined;
    try { session = requireSession(req); } catch { /* public bounties need no session */ }
    if (!(await canReadRepository(ctx, repo, session))) throw new HttpError(404, "bounty not found or repository access unavailable");
    const events = v.onchain_bounty_id === null ? [] :
      await ctx.db.select().from(chain_events).where(and(eventContext(ctx), eq(chain_events.onchain_bounty_id, v.onchain_bounty_id))).orderBy(desc(chain_events.block_number), desc(chain_events.log_index));
    return { ...v, candidates: await candidatesOfPr(ctx, prId), approvals: await approvalsOfBounty(ctx, v.id), events: events.map((e) => eventView(ctx, e)) };
  });

  app.get("/bounties/:id/candidates", async (req) => {
    const { prId } = await loadBounty(id.parse((req.params as { id: string }).id));
    const { repo } = await repoOfPr(ctx, prId);
    let session: Session | undefined;
    try { session = requireSession(req); } catch { /* public bounties need no session */ }
    if (!(await canReadRepository(ctx, repo, session))) throw new HttpError(404, "bounty not found or repository access unavailable");
    return { candidates: await candidatesOfPr(ctx, prId) };
  });

  app.get("/events", async (req) => {
    const q = z.object({ bounty_id: id.optional(), limit: z.coerce.number().int().min(1).max(200).default(50), before: id.optional() }).parse(req.query);
    const conds = [eventContext(ctx)];
    if (q.before) conds.push(lt(chain_events.id, q.before));
    if (q.bounty_id) {
      const [b] = await ctx.db.select().from(bounties).where(eq(bounties.id, q.bounty_id));
      if (!b?.onchain_bounty_id) return { events: [], next_before: null };
      conds.push(eq(chain_events.onchain_bounty_id, b.onchain_bounty_id));
    }
    const rows = await ctx.db.select().from(chain_events).where(and(...conds)).orderBy(desc(chain_events.id)).limit(q.limit);
    return { events: rows.map((e) => eventView(ctx, e)), next_before: rows.length === q.limit ? rows[rows.length - 1]!.id : null };
  });

  // ---- maintainer: create a bounty (prepares the funding txs; the maintainer's wallet signs) ----
  app.post("/bounties", async (req, reply) => {
    const s = requireSession(req);
    const b = z.object({ github_repo_id: z.number().int(), pr_number: z.number().int(), amount_units: units, expiry: z.number().int() }).parse(req.body);
    if (b.expiry * 1000 <= Date.now()) throw new HttpError(400, "expiry must be in the future");
    const [repo] = await ctx.db.select().from(repositories).where(eq(repositories.github_repo_id, b.github_repo_id));
    if (!repo) throw new HttpError(404, "repository not registered");
    await requireMaintainer(ctx, s, repo);
    let [pr] = await ctx.db.select().from(pull_requests).where(and(eq(pull_requests.repo_id, repo.id), eq(pull_requests.github_pr_number, b.pr_number)));
    if (!pr) {
      // A PR opened before installation has no webhook row. Fetch it through the
      // installation-scoped GitHub client before creating its first bounty.
      const fromGitHub = await ctx.gh.getPullRequest(repo.installation_id, repo.name, b.pr_number);
      if (!fromGitHub || fromGitHub.status !== "open") throw new HttpError(404, "open pull request not found");
      await ctx.db.insert(pull_requests).values({
        repo_id: repo.id, github_pr_number: fromGitHub.number, head_sha: fromGitHub.headSha,
        status: fromGitHub.status, author_github_id: fromGitHub.authorId,
        pr_hash: prHash(repo.github_repo_id, fromGitHub.number),
      }).onConflictDoNothing();
      [pr] = await ctx.db.select().from(pull_requests).where(and(eq(pull_requests.repo_id, repo.id), eq(pull_requests.github_pr_number, b.pr_number)));
    }
    if (!pr) throw new HttpError(404, "pull request not found");
    const prRow = pr;

    // The funding intent: who will fund, how much, until when. The funder is the maintainer's wallet as proven
    // by the signed wallet link, never an address from this request. Streams binds the BountyFunded event to
    // this row only if its funder, amount and expiry all match (streams/webhook.ts matchesIntent).
    const [w] = await ctx.db.select().from(wallet_links).where(eq(wallet_links.github_user_id, s.id));
    if (!w) throw new HttpError(409, "link and verify your wallet first: a bounty only accepts funding from your verified wallet");

    // Serialise intent creation per PR with a row lock, so two concurrent requests cannot both pass the
    // one-live-bounty check. Pending rows from before funding intents existed (no funder recorded) can never
    // be bound to an event, so they do not block a new bounty.
    const row = await ctx.db.transaction(async (tx) => {
      await tx.select({ id: pull_requests.id }).from(pull_requests).where(eq(pull_requests.id, prRow.id)).for("update");
      const live = await tx.select({ id: bounties.id }).from(bounties).where(and(
        eq(bounties.pr_id, prRow.id),
        notInArray(bounties.status, ["expired", "refunded"]),
        or(isNotNull(bounties.onchain_bounty_id), isNotNull(bounties.funder_wallet)),
      ));
      if (live.length) throw new HttpError(409, "a live bounty already exists for this pull request");
      const [inserted] = await tx.insert(bounties).values({
        pr_id: prRow.id, funder_wallet: w.wallet_address.toLowerCase(), amount_units: b.amount_units,
        deadline: new Date(b.expiry * 1000), status: "funding_pending",
      }).returning();
      return inserted!;
    });

    // Heal: a matching BountyFunded that was indexed before this intent existed is bound now.
    const early = await ctx.db.select({ onchainId: chain_events.onchain_bounty_id }).from(chain_events).where(and(
      eventContext(ctx),
      eq(chain_events.event_type, "BountyFunded"), sql`${chain_events.payload}->>'prHash' = ${prRow.pr_hash}`,
      sql`not exists (select 1 from bounties where bounties.onchain_bounty_id = ${chain_events.onchain_bounty_id})`,
    ));
    for (const e of early) if (e.onchainId) await reconcile(ctx, e.onchainId);

    const [v] = await bountyViews(ctx, eq(bounties.id, row.id));
    return reply.code(201).send({ bounty: v, funding: encodeCreateBounty(chain, { prHash: prRow.pr_hash, amount: b.amount_units, expiry: b.expiry }) });
  });

  // ---- candidates ----
  app.post("/bounties/:id/candidates/manual", async (req, reply) => {
    const s = requireSession(req);
    const { v, prId } = await loadBounty(id.parse((req.params as { id: string }).id));
    const { evidence_url } = z.object({ evidence_url: z.string().max(500) }).parse(req.body);
    const m = EVIDENCE_URL.exec(evidence_url);
    if (!m) throw new HttpError(400, "evidence_url must look like https://github.com/<owner>/<repo>/pull/<n>#discussion_r<id>");
    const { pr, repo } = await repoOfPr(ctx, prId);
    await requireMaintainer(ctx, s, repo);
    if (m[1]!.toLowerCase() !== repo.name.toLowerCase() || Number(m[2]) !== pr.github_pr_number) throw new HttpError(400, "evidence url is for a different pull request");
    const c = await ctx.gh.getReviewComment(repo.installation_id, repo.name, Number(m[3]));
    if (!c || c.pull_number !== pr.github_pr_number) throw new HttpError(404, "review comment not found on this pull request");
    if (c.user.type === "Bot" || c.user.id === pr.author_github_id) throw new HttpError(409, "bots and the pull request author cannot be reviewers");
    const evidence = { method: "manual", limitations: MANUAL_LIMITATIONS, evidence_url, line: c.line, confirmed_by_github_id: s.id,
      reviewer: c.user, comment_body: c.body, commented_at: c.created_at };
    const [existing] = await ctx.db.select().from(review_candidates).where(eq(review_candidates.github_comment_id, c.id));
    if (existing && existing.status !== "pending") throw new HttpError(409, "this comment is already a " + existing.status + " candidate");
    const vals = { status: "candidate", qualification_evidence: evidence };
    const [row] = existing
      ? await ctx.db.update(review_candidates).set(vals).where(eq(review_candidates.id, existing.id)).returning()
      : await ctx.db.insert(review_candidates).values({ ...vals, pr_id: pr.id, github_comment_id: c.id, github_reviewer_id: c.user.id, file_path: c.path, diff_hunk: c.diff_hunk, commit_sha: c.commit_sha }).returning();
    await refreshBounty(ctx, v.id);
    return reply.code(201).send(row);
  });

  const decide = (action: "confirm" | "reject") => app.post(`/candidates/:id/${action}`, async (req) => {
    const s = requireSession(req);
    const [c] = await ctx.db.select().from(review_candidates).where(eq(review_candidates.id, id.parse((req.params as { id: string }).id)));
    if (!c) throw new HttpError(404, "candidate not found");
    const { repo } = await repoOfPr(ctx, c.pr_id);
    await requireMaintainer(ctx, s, repo);
    const allowed = action === "confirm" ? ["candidate"] : ["pending", "candidate", "confirmed"];
    if (!allowed.includes(c.status)) throw new HttpError(409, `cannot ${action} a ${c.status} candidate`);
    const [row] = await ctx.db.update(review_candidates).set({ status: action === "confirm" ? "confirmed" : "rejected" }).where(eq(review_candidates.id, c.id)).returning();
    const bs = await ctx.db.select({ id: bounties.id }).from(bounties).where(eq(bounties.pr_id, c.pr_id));
    for (const b of bs) await refreshBounty(ctx, b.id);
    return row;
  });
  decide("confirm");
  decide("reject");

  // ---- approval gate: prepares approveReward. The backend never signs or sends it. ----
  app.post("/bounties/:id/approvals", async (req, reply) => {
    const s = requireSession(req);
    const { v, prId } = await loadBounty(id.parse((req.params as { id: string }).id));
    const body = z.object({ candidate_id: z.number().int(), amount_units: units.optional() }).parse(req.body);
    const { pr, repo } = await repoOfPr(ctx, prId);
    await requireMaintainer(ctx, s, repo); // live GitHub permission, every time

    if (v.onchain_bounty_id === null || !["funded", "review_candidate", "approved"].includes(v.status)) throw new HttpError(409, `bounty is ${v.status}, not open for approval`);
    const [c] = await ctx.db.select().from(review_candidates).where(and(eq(review_candidates.id, body.candidate_id), eq(review_candidates.pr_id, prId)));
    if (!c) throw new HttpError(404, "candidate not found on this bounty's pull request");
    if (!["candidate", "confirmed"].includes(c.status)) throw new HttpError(409, `candidate is ${c.status}`);
    if (c.github_reviewer_id === pr.author_github_id) throw new HttpError(403, "the pull request author cannot be paid");
    if (c.github_reviewer_id === s.id) throw new HttpError(403, "approvers cannot approve their own review");
    const [w] = await ctx.db.select().from(wallet_links).where(eq(wallet_links.github_user_id, c.github_reviewer_id));
    if (!w) throw new HttpError(409, "reviewer has not linked a wallet");
    if (w.wallet_address === v.funder_wallet) throw new HttpError(403, "recipient cannot be the funder wallet");
    const amount = body.amount_units ?? v.amount_units;
    if (BigInt(amount) > BigInt(v.amount_units)) throw new HttpError(400, "amount exceeds the funded amount");

    const claim = claimId(c.github_comment_id);
    const [existing] = await ctx.db.select().from(approvals).where(eq(approvals.claim_id, claim));
    if (existing && existing.status !== "prepared") throw new HttpError(409, `approval already ${existing.status}`);
    const vals = { bounty_id: v.id, candidate_id: c.id, reviewer_id: c.github_reviewer_id, approver_github_id: s.id, amount_units: amount, approved_recipient: w.wallet_address, claim_id: claim };
    let approval;
    try {
      [approval] = existing
        ? await ctx.db.update(approvals).set(vals).where(eq(approvals.id, existing.id)).returning()
        : await ctx.db.insert(approvals).values(vals).returning();
    } catch (e) {
      if (isUniqueViolation(e)) throw new HttpError(409, "approval already exists");
      throw e;
    }
    await refreshBounty(ctx, v.id);
    const tx = encodeApproveReward(chain, { bountyId: v.onchain_bounty_id, recipient: w.wallet_address, amount, claimId: claim });
    return reply.code(201).send({ approval, tx, funder_wallet: v.funder_wallet });
  });

  app.post("/approvals/:id/tx", async (req) => {
    const s = requireSession(req);
    const [a] = await ctx.db.select().from(approvals).where(eq(approvals.id, id.parse((req.params as { id: string }).id)));
    if (!a) throw new HttpError(404, "approval not found");
    const { tx_hash } = z.object({ tx_hash: txHash }).parse(req.body);
    const [b] = await ctx.db.select().from(bounties).where(eq(bounties.id, a.bounty_id));
    const { repo } = await repoOfPr(ctx, b!.pr_id);
    await requireMaintainer(ctx, s, repo);
    const hash = tx_hash.toLowerCase();
    if (a.status !== "prepared") {
      if (a.chain_tx_hash === hash) return a; // idempotent
      throw new HttpError(409, `approval already ${a.status}`);
    }
    try {
      const [row] = await ctx.db.update(approvals).set({ status: "signed", chain_tx_hash: hash }).where(and(eq(approvals.id, a.id), inArray(approvals.status, ["prepared"]))).returning();
      await refreshBounty(ctx, a.bounty_id);
      return row;
    } catch (e) {
      if (isUniqueViolation(e)) throw new HttpError(409, "another approval for this bounty is already signed or paid");
      throw e;
    }
  });
}
