CREATE TABLE "approvals" (
	"id" serial PRIMARY KEY NOT NULL,
	"bounty_id" integer NOT NULL,
	"candidate_id" integer NOT NULL,
	"reviewer_id" bigint NOT NULL,
	"approver_github_id" bigint NOT NULL,
	"amount_units" numeric(78, 0) NOT NULL,
	"approved_recipient" text NOT NULL,
	"claim_id" text NOT NULL,
	"chain_tx_hash" text,
	"status" text DEFAULT 'prepared' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approvals_claim_id_unique" UNIQUE("claim_id")
);
--> statement-breakpoint
CREATE TABLE "bounties" (
	"id" serial PRIMARY KEY NOT NULL,
	"onchain_bounty_id" numeric(78, 0),
	"pr_id" integer NOT NULL,
	"funder_wallet" text,
	"amount_units" numeric(78, 0) NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'funding_pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bounties_onchain_bounty_id_unique" UNIQUE("onchain_bounty_id")
);
--> statement-breakpoint
CREATE TABLE "chain_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"contract" text NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"block_number" bigint NOT NULL,
	"onchain_bounty_id" numeric(78, 0),
	"ingestion_timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chain_events_identity" UNIQUE("chain_id","contract","tx_hash","log_index")
);
--> statement-breakpoint
CREATE TABLE "pull_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"repo_id" integer NOT NULL,
	"github_pr_number" integer NOT NULL,
	"head_sha" text NOT NULL,
	"status" text NOT NULL,
	"author_github_id" bigint NOT NULL,
	"pr_hash" text NOT NULL,
	CONSTRAINT "pull_requests_pr_hash_unique" UNIQUE("pr_hash"),
	CONSTRAINT "pull_requests_repo_number" UNIQUE("repo_id","github_pr_number")
);
--> statement-breakpoint
CREATE TABLE "repositories" (
	"id" serial PRIMARY KEY NOT NULL,
	"github_repo_id" bigint NOT NULL,
	"installation_id" bigint NOT NULL,
	"name" text NOT NULL,
	"maintainer_github_id" bigint NOT NULL,
	CONSTRAINT "repositories_github_repo_id_unique" UNIQUE("github_repo_id")
);
--> statement-breakpoint
CREATE TABLE "review_candidates" (
	"id" serial PRIMARY KEY NOT NULL,
	"pr_id" integer NOT NULL,
	"github_comment_id" bigint NOT NULL,
	"github_reviewer_id" bigint NOT NULL,
	"file_path" text NOT NULL,
	"diff_hunk" text NOT NULL,
	"commit_sha" text NOT NULL,
	"thread_node_id" text,
	"thread_resolved" boolean DEFAULT false NOT NULL,
	"qualification_evidence" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_candidates_github_comment_id_unique" UNIQUE("github_comment_id")
);
--> statement-breakpoint
CREATE TABLE "wallet_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"github_user_id" bigint NOT NULL,
	"wallet_address" text NOT NULL,
	"signed_challenge" text NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	CONSTRAINT "wallet_links_github_user_id_unique" UNIQUE("github_user_id")
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_bounty_id_bounties_id_fk" FOREIGN KEY ("bounty_id") REFERENCES "public"."bounties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_candidate_id_review_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."review_candidates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bounties" ADD CONSTRAINT "bounties_pr_id_pull_requests_id_fk" FOREIGN KEY ("pr_id") REFERENCES "public"."pull_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_repo_id_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repositories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_candidates" ADD CONSTRAINT "review_candidates_pr_id_pull_requests_id_fk" FOREIGN KEY ("pr_id") REFERENCES "public"."pull_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approvals_one_committed_per_bounty" ON "approvals" USING btree ("bounty_id") WHERE "approvals"."status" in ('signed','paid');--> statement-breakpoint
CREATE INDEX "chain_events_bounty" ON "chain_events" USING btree ("onchain_bounty_id");