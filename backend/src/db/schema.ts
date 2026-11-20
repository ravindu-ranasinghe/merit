import { sql } from "drizzle-orm";
import { bigint, boolean, index, integer, jsonb, numeric, pgTable, serial, text, timestamp, unique, uniqueIndex } from "drizzle-orm/pg-core";

// GitHub ids fit in a JS number (< 2^53). On-chain ids and amounts are uint256, so they are
// numeric(78,0) and travel as decimal strings: never floats.
const ghId = (name: string) => bigint(name, { mode: "number" });
const uint = (name: string) => numeric(name, { precision: 78, scale: 0 });

export const repositories = pgTable("repositories", {
  id: serial("id").primaryKey(),
  github_repo_id: ghId("github_repo_id").notNull().unique(),
  installation_id: ghId("installation_id").notNull(),
  name: text("name").notNull(), // "owner/repo"
  maintainer_github_id: ghId("maintainer_github_id").notNull(),
});

export const pull_requests = pgTable(
  "pull_requests",
  {
    id: serial("id").primaryKey(),
    repo_id: integer("repo_id").notNull().references(() => repositories.id),
    github_pr_number: integer("github_pr_number").notNull(),
    head_sha: text("head_sha").notNull(),
    status: text("status").notNull(), // open | closed | merged
    author_github_id: ghId("author_github_id").notNull(),
    pr_hash: text("pr_hash").notNull().unique(), // keccak256(abi.encode(repoId, prNumber)), see chain/escrow.ts
  },
  (t) => [unique("pull_requests_repo_number").on(t.repo_id, t.github_pr_number)],
);

export const bounties = pgTable("bounties", {
  id: serial("id").primaryKey(),
  onchain_bounty_id: uint("onchain_bounty_id").unique(), // null until BountyFunded is seen
  pr_id: integer("pr_id").notNull().references(() => pull_requests.id),
  funder_wallet: text("funder_wallet"),
  amount_units: uint("amount_units").notNull(),
  deadline: timestamp("deadline", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("funding_pending"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const review_candidates = pgTable("review_candidates", {
  id: serial("id").primaryKey(),
  pr_id: integer("pr_id").notNull().references(() => pull_requests.id),
  github_comment_id: ghId("github_comment_id").notNull().unique(),
  github_reviewer_id: ghId("github_reviewer_id").notNull(),
  file_path: text("file_path").notNull(),
  diff_hunk: text("diff_hunk").notNull(),
  commit_sha: text("commit_sha").notNull(),
  thread_node_id: text("thread_node_id"),
  thread_resolved: boolean("thread_resolved").notNull().default(false),
  // Always carries {method: "heuristic"|"manual", limitations}. Evidence, never proof.
  qualification_evidence: jsonb("qualification_evidence").notNull(),
  status: text("status").notNull().default("pending"), // pending | candidate | confirmed | rejected
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const wallet_links = pgTable("wallet_links", {
  id: serial("id").primaryKey(),
  github_user_id: ghId("github_user_id").notNull().unique(),
  wallet_address: text("wallet_address").notNull(), // lowercase
  signed_challenge: text("signed_challenge").notNull(), // JSON {message, mac, signature}
  verified_at: timestamp("verified_at", { withTimezone: true }).notNull(),
});

export const approvals = pgTable(
  "approvals",
  {
    id: serial("id").primaryKey(),
    bounty_id: integer("bounty_id").notNull().references(() => bounties.id),
    candidate_id: integer("candidate_id").notNull().references(() => review_candidates.id),
    reviewer_id: ghId("reviewer_id").notNull(),
    approver_github_id: ghId("approver_github_id").notNull(),
    amount_units: uint("amount_units").notNull(),
    approved_recipient: text("approved_recipient").notNull(),
    claim_id: text("claim_id").notNull().unique(),
    chain_tx_hash: text("chain_tx_hash"),
    status: text("status").notNull().default("prepared"), // prepared | signed | paid
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // At most one signed/paid approval per bounty, enforced by Postgres, not by app code.
    uniqueIndex("approvals_one_committed_per_bounty").on(t.bounty_id).where(sql`${t.status} in ('signed','paid')`),
  ],
);

export const chain_events = pgTable(
  "chain_events",
  {
    id: serial("id").primaryKey(),
    chain_id: integer("chain_id").notNull(),
    contract: text("contract").notNull(), // lowercase
    tx_hash: text("tx_hash").notNull(),
    log_index: integer("log_index").notNull(),
    event_type: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    block_number: bigint("block_number", { mode: "number" }).notNull(),
    block_hash: text("block_hash"), // null only for records created before canonical validation
    removed: boolean("removed").notNull().default(false),
    app_bounty_id: integer("app_bounty_id"), // retained on orphan rows so duplicate corrections can repair comments
    reorg_history: jsonb("reorg_history").$type<unknown[]>().notNull().default([]),
    onchain_bounty_id: uint("onchain_bounty_id"),
    ingestion_timestamp: timestamp("ingestion_timestamp", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("chain_events_identity").on(t.chain_id, t.contract, t.tx_hash, t.log_index),
    index("chain_events_bounty").on(t.onchain_bounty_id),
  ],
);
