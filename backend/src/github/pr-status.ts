import { and, eq } from "drizzle-orm";
import type { Ctx } from "../ctx.js";
import { approvals, bounties, chain_events, pull_requests, repositories } from "../db/schema.js";
import { approvalMatches, eventContext } from "../streams/match.js";

/**
 * One Merit status comment per bounty on its pull request, driven only by indexed contract events.
 *
 * The comment body is a pure function of the bounty's stored chain events, so a Streams replay, a backfill or
 * out-of-order delivery renders the same body and the sync is a no-op: GitHub sees no new comment and no edit,
 * so nobody is notified twice. The comment is found by a hidden marker AND by being posted by this GitHub App,
 * so a user who copies the marker into their own comment cannot hijack it.
 */

export const marker = (bountyId: number) => `<!-- merit:bounty-status:${bountyId} -->`;

export type Stage = "funded" | "claimable" | "paid" | "refunded";

/** Chain-confirmed stage only: paid > claimable > refunded > funded. No offchain overlay can change the comment. */
export function stageOf(eventTypes: string[]): Stage | null {
  const has = (t: string) => eventTypes.includes(t);
  if (has("RewardPaid")) return "paid";
  if (has("RewardApproved")) return "claimable";
  if (has("BountyRefunded")) return "refunded";
  if (has("BountyFunded")) return "funded";
  return null;
}

/** Integer 6-decimal units to "$10.00". BigInt only; sub-cent amounts keep their digits. */
export function usd(units: string): string {
  const v = BigInt(units);
  const whole = (v / 1_000_000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  let frac = (v % 1_000_000n).toString().padStart(6, "0");
  frac = /^\d{2}0{4}$/.test(frac) ? frac.slice(0, 2) : frac.replace(/0+$/, "");
  return `$${whole}.${frac}`;
}

export interface StatusInput {
  bountyId: number;
  stage: Stage;
  amountUnits: string;
  deadline: Date;
  /** Present once RewardApproved / RewardPaid / BountyRefunded is indexed. */
  approvedUnits?: string;
  paidUnits?: string;
  refundedUnits?: string;
  /** Reviewer's current GitHub login, or null if it could not be resolved (then nobody is mentioned). */
  reviewerLogin: string | null;
  tx: Partial<Record<"funded" | "approved" | "paid" | "refunded", string>>;
  webOrigin: string;
  explorerUrl: string;
}

const date = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export function renderStatusComment(i: StatusInput): string {
  const web = i.webOrigin.replace(/\/$/, "");
  const bountyUrl = `${web}/bounties/${i.bountyId}`;
  const txLink = (label: string, hash?: string) => (hash ? `[${label}](${i.explorerUrl.replace(/\/$/, "")}/tx/${hash})` : null);
  const links = (...xs: (string | null)[]) => xs.filter(Boolean).join(" · ");
  const amount = `${usd(i.amountUnits)} test USDC`;

  let title: string;
  let body: string;
  let footer: string;
  switch (i.stage) {
    case "funded":
      title = `${amount} review reward · Funded`;
      body = `A reward of ${amount} is locked in escrow on Arc testnet for a review of this pull request, open until ${date(i.deadline)}.\n\n`
        + "Leave an inline review comment. If it leads to a fix and the maintainer approves it, the reviewer can claim the reward.";
      footer = links(`[View the bounty](${bountyUrl})`, txLink("Funding transaction", i.tx.funded));
      break;
    case "claimable": {
      const approved = `${usd(i.approvedUnits ?? i.amountUnits)} test USDC`;
      title = `${amount} review reward · Ready to claim`;
      body = i.reviewerLogin
        ? `@${i.reviewerLogin}, your reward is ready to claim. The maintainer approved ${approved} for your review.`
        : `The maintainer approved ${approved} for a review on this pull request. The reviewer can now claim it.`;
      footer = links(`[Claim on Merit](${bountyUrl})`, txLink("Approval transaction", i.tx.approved));
      break;
    }
    case "paid": {
      const paid = `${usd(i.paidUnits ?? i.approvedUnits ?? i.amountUnits)} test USDC`;
      // A profile link, not an @mention: the reviewer was already notified when the reward became claimable.
      const who = i.reviewerLogin ? `[${i.reviewerLogin}](https://github.com/${i.reviewerLogin})` : "the reviewer";
      title = `${amount} review reward · Paid`;
      body = `Paid ${paid} to ${who} for their review.`;
      footer = links(`[View the receipt](${bountyUrl}/receipt)`, txLink("Payout transaction", i.tx.paid));
      break;
    }
    case "refunded":
      title = `${amount} review reward · Refunded`;
      body = `This bounty expired without a payout. ${usd(i.refundedUnits ?? i.amountUnits)} test USDC was returned to the funder.`;
      footer = links(`[View the bounty](${bountyUrl})`, txLink("Refund transaction", i.tx.refunded));
      break;
  }
  return [
    marker(i.bountyId),
    `**Merit: ${title}**`,
    "",
    body,
    "",
    footer,
    "",
    "<sub>Testnet USDC has no monetary value. Merit updates this comment from indexed escrow events on Arc.</sub>",
  ].join("\n");
}

const norm = (s: string) => s.replace(/\r\n/g, "\n").trim();

// Serialise syncs per bounty within this instance, so two deliveries in flight cannot both create a comment.
// Across instances the duplicate sweep below converges on the oldest comment.
const inFlight = new Map<number, Promise<unknown>>();

export type SyncResult = "disabled" | "skipped" | "created" | "updated" | "unchanged";

export async function syncPrStatusComment(ctx: Ctx, onchainBountyId: string, signal?: AbortSignal): Promise<SyncResult> {
  signal?.throwIfAborted();
  if (!ctx.env.github.prComments) return "disabled";
  const [row] = await ctx.db.select({ b: bounties, pr: pull_requests, repo: repositories }).from(bounties)
    .innerJoin(pull_requests, eq(pull_requests.id, bounties.pr_id))
    .innerJoin(repositories, eq(repositories.id, pull_requests.repo_id))
    .where(eq(bounties.onchain_bounty_id, onchainBountyId));
  if (!row) return "skipped"; // BountyFunded not linked to a Merit bounty yet

  const previous = inFlight.get(row.b.id) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(() => {
    signal?.throwIfAborted();
    return sync(ctx, row, onchainBountyId, signal);
  });
  inFlight.set(row.b.id, run);
  try {
    return await run;
  } finally {
    if (inFlight.get(row.b.id) === run) inFlight.delete(row.b.id);
  }
}

type Row = {
  b: typeof bounties.$inferSelect;
  pr: typeof pull_requests.$inferSelect;
  repo: typeof repositories.$inferSelect;
};

async function sync(ctx: Ctx, { b, pr, repo }: Row, onchainBountyId: string, signal?: AbortSignal): Promise<SyncResult> {
  const events = await ctx.db.select().from(chain_events).where(and(eventContext(ctx), eq(chain_events.onchain_bounty_id, onchainBountyId)));
  const stage = stageOf(events.map((e) => e.event_type));
  if (!stage) return "skipped";
  const ev = (t: string) => events.find((e) => e.event_type === t);
  const amountOf = (t: string) => (ev(t)?.payload as { amount?: string } | undefined)?.amount;

  // The reviewer is whoever the contract approved: match the indexed recipient's claim to a GitHub user.
  let reviewerLogin: string | null = null;
  const claimEvent = ev("RewardPaid") ?? ev("RewardApproved");
  if (claimEvent) {
    // Only this bounty's approval, with the event's recipient and amount: claim ids are public.
    const ev = claimEvent.payload as { claimId?: string; recipient: string; amount: string };
    const [a] = ev.claimId
      ? await ctx.db.select().from(approvals).where(and(eq(approvals.claim_id, ev.claimId), eq(approvals.bounty_id, b.id)))
      : [];
    if (a && approvalMatches(a, ev)) {
      signal?.throwIfAborted();
      try { reviewerLogin = (await ctx.gh.getUser(repo.installation_id, a.reviewer_id, signal)).login; }
      catch { signal?.throwIfAborted(); reviewerLogin = null; }
    }
  }

  const body = renderStatusComment({
    bountyId: b.id,
    stage,
    amountUnits: amountOf("BountyFunded") ?? b.amount_units,
    deadline: b.deadline,
    approvedUnits: amountOf("RewardApproved"),
    paidUnits: amountOf("RewardPaid"),
    refundedUnits: amountOf("BountyRefunded"),
    reviewerLogin,
    tx: {
      funded: ev("BountyFunded")?.tx_hash,
      approved: ev("RewardApproved")?.tx_hash,
      paid: ev("RewardPaid")?.tx_hash,
      refunded: ev("BountyRefunded")?.tx_hash,
    },
    webOrigin: ctx.env.webOrigin,
    explorerUrl: ctx.env.explorerUrl,
  });

  const gh = ctx.gh;
  const ours = async () => {
    signal?.throwIfAborted();
    const comments = await gh.listIssueComments(repo.installation_id, repo.name, pr.github_pr_number, signal);
    signal?.throwIfAborted();
    return comments.filter((c) => c.appId === gh.appId && c.body.includes(marker(b.id))).sort((x, y) => x.id - y.id);
  };

  let mine = await ours();
  let result: SyncResult = "unchanged";
  if (mine.length === 0) {
    await gh.createIssueComment(repo.installation_id, repo.name, pr.github_pr_number, body, signal);
    result = "created";
    mine = await ours(); // another instance may have created one at the same moment
  }
  const [keep, ...extra] = mine;
  for (const c of extra) {
    signal?.throwIfAborted();
    await gh.deleteIssueComment(repo.installation_id, repo.name, c.id, signal);
  }
  if (keep && norm(keep.body) !== norm(body)) {
    signal?.throwIfAborted();
    await gh.updateIssueComment(repo.installation_id, repo.name, keep.id, body, signal);
    if (result === "unchanged") result = "updated";
  }
  return result;
}
