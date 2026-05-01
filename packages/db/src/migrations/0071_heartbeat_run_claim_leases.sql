ALTER TABLE "heartbeat_runs" ADD COLUMN IF NOT EXISTS "claim_token" text;
--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ADD COLUMN IF NOT EXISTS "claim_owner" text;
--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ADD COLUMN IF NOT EXISTS "claim_leased_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ADD COLUMN IF NOT EXISTS "claim_lease_expires_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "heartbeat_runs_company_status_claim_lease_idx"
  ON "heartbeat_runs" USING btree ("company_id","status","claim_lease_expires_at");
