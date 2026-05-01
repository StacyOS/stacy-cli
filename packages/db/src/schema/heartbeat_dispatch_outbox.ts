import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
import { agentWakeupRequests } from "./agent_wakeup_requests.js";
import { heartbeatRuns } from "./heartbeat_runs.js";

export const heartbeatDispatchOutbox = pgTable(
  "heartbeat_dispatch_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    runId: uuid("run_id").notNull().references(() => heartbeatRuns.id, { onDelete: "cascade" }),
    wakeupRequestId: uuid("wakeup_request_id").references(() => agentWakeupRequests.id, { onDelete: "set null" }),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull().default("pending"),
    reason: text("reason").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    leasedBy: text("leased_by"),
    leasedAt: timestamp("leased_at", { withTimezone: true }),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    idempotencyKeyIdx: uniqueIndex("heartbeat_dispatch_outbox_idempotency_key_idx").on(table.idempotencyKey),
    companyStatusAvailableIdx: index("heartbeat_dispatch_outbox_company_status_available_idx").on(
      table.companyId,
      table.status,
      table.availableAt,
    ),
    runStatusIdx: index("heartbeat_dispatch_outbox_run_status_idx").on(table.runId, table.status),
    leaseExpiryIdx: index("heartbeat_dispatch_outbox_lease_expiry_idx").on(table.status, table.leaseExpiresAt),
  }),
);
