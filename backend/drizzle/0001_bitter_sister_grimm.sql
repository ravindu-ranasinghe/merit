ALTER TABLE "chain_events" ADD COLUMN "block_hash" text;--> statement-breakpoint
ALTER TABLE "chain_events" ADD COLUMN "removed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "chain_events" ADD COLUMN "reorg_history" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "chain_events" ADD COLUMN "app_bounty_id" integer;
