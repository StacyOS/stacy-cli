CREATE TABLE IF NOT EXISTS "heartbeat_dispatch_outbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "agent_id" uuid NOT NULL,
  "run_id" uuid NOT NULL,
  "wakeup_request_id" uuid,
  "idempotency_key" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "reason" text NOT NULL,
  "payload" jsonb,
  "available_at" timestamp with time zone DEFAULT now() NOT NULL,
  "leased_by" text,
  "leased_at" timestamp with time zone,
  "lease_expires_at" timestamp with time zone,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer DEFAULT 3 NOT NULL,
  "completed_at" timestamp with time zone,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "heartbeat_dispatch_outbox" ADD CONSTRAINT "heartbeat_dispatch_outbox_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "heartbeat_dispatch_outbox" ADD CONSTRAINT "heartbeat_dispatch_outbox_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "heartbeat_dispatch_outbox" ADD CONSTRAINT "heartbeat_dispatch_outbox_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "heartbeat_dispatch_outbox" ADD CONSTRAINT "heartbeat_dispatch_outbox_wakeup_request_id_agent_wakeup_requests_id_fk" FOREIGN KEY ("wakeup_request_id") REFERENCES "public"."agent_wakeup_requests"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "heartbeat_dispatch_outbox_idempotency_key_idx"
  ON "heartbeat_dispatch_outbox" USING btree ("idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "heartbeat_dispatch_outbox_company_status_available_idx"
  ON "heartbeat_dispatch_outbox" USING btree ("company_id","status","available_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "heartbeat_dispatch_outbox_run_status_idx"
  ON "heartbeat_dispatch_outbox" USING btree ("run_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "heartbeat_dispatch_outbox_lease_expiry_idx"
  ON "heartbeat_dispatch_outbox" USING btree ("status","lease_expires_at");
