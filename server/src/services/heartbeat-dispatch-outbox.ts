import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { heartbeatDispatchOutbox } from "@paperclipai/db";
import type { DashboardDispatchQueueSummary } from "@paperclipai/shared";

export type HeartbeatDispatchOutboxRow = typeof heartbeatDispatchOutbox.$inferSelect;

export type HeartbeatDispatchOutboxStatus =
  | "pending"
  | "leased"
  | "completed"
  | "failed"
  | "cancelled";

export const ACTIVE_HEARTBEAT_DISPATCH_OUTBOX_STATUSES: HeartbeatDispatchOutboxStatus[] = [
  "pending",
  "leased",
];

export function buildHeartbeatDispatchIdempotencyKey(runId: string) {
  return `heartbeat-dispatch:${runId}`;
}

export function heartbeatDispatchOutboxService(db: Db) {
  function normalizeLimit(limit: number | undefined, fallback: number) {
    if (!Number.isFinite(limit ?? NaN)) return fallback;
    return Math.max(1, Math.min(100, Math.floor(limit!)));
  }

  async function enqueueRunDispatch(input: {
    companyId: string;
    agentId: string;
    runId: string;
    wakeupRequestId?: string | null;
    reason: string;
    payload?: Record<string, unknown> | null;
    availableAt?: Date;
    maxAttempts?: number;
    idempotencyKey?: string | null;
  }) {
    const now = new Date();
    const idempotencyKey = input.idempotencyKey?.trim() || buildHeartbeatDispatchIdempotencyKey(input.runId);

    const inserted = await db
      .insert(heartbeatDispatchOutbox)
      .values({
        companyId: input.companyId,
        agentId: input.agentId,
        runId: input.runId,
        wakeupRequestId: input.wakeupRequestId ?? null,
        idempotencyKey,
        status: "pending",
        reason: input.reason,
        payload: input.payload ?? null,
        availableAt: input.availableAt ?? now,
        maxAttempts: input.maxAttempts ?? 3,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: heartbeatDispatchOutbox.idempotencyKey })
      .returning()
      .then((rows) => rows[0] ?? null);

    if (inserted) return inserted;

    return db
      .select()
      .from(heartbeatDispatchOutbox)
      .where(eq(heartbeatDispatchOutbox.idempotencyKey, idempotencyKey))
      .then((rows) => rows[0] ?? null);
  }

  async function listReadyRunDispatches(opts?: {
    companyId?: string;
    now?: Date;
    limit?: number;
  }) {
    const now = opts?.now ?? new Date();
    const conditions = [
      eq(heartbeatDispatchOutbox.status, "pending"),
      lte(heartbeatDispatchOutbox.availableAt, now),
    ];
    if (opts?.companyId) {
      conditions.push(eq(heartbeatDispatchOutbox.companyId, opts.companyId));
    }

    return db
      .select()
      .from(heartbeatDispatchOutbox)
      .where(and(...conditions))
      .orderBy(
        asc(heartbeatDispatchOutbox.availableAt),
        asc(heartbeatDispatchOutbox.createdAt),
        asc(heartbeatDispatchOutbox.id),
      )
      .limit(opts?.limit ?? 50);
  }

  async function summarizeQueueHealth(opts?: {
    companyId?: string;
    now?: Date;
    stalePendingThresholdMs?: number;
  }): Promise<DashboardDispatchQueueSummary> {
    const now = opts?.now ?? new Date();
    const nowIso = now.toISOString();
    const stalePendingThresholdMs = Math.max(1_000, opts?.stalePendingThresholdMs ?? 5 * 60 * 1000);
    const stalePendingBeforeIso = new Date(now.getTime() - stalePendingThresholdMs).toISOString();
    const query = db
      .select({
        pending: sql<number>`count(*) filter (where ${heartbeatDispatchOutbox.status} = 'pending')::double precision`,
        ready: sql<number>`count(*) filter (
          where ${heartbeatDispatchOutbox.status} = 'pending'
          and ${heartbeatDispatchOutbox.availableAt} <= ${nowIso}::timestamptz
        )::double precision`,
        leased: sql<number>`count(*) filter (where ${heartbeatDispatchOutbox.status} = 'leased')::double precision`,
        expiredLeases: sql<number>`count(*) filter (
          where ${heartbeatDispatchOutbox.status} = 'leased'
          and ${heartbeatDispatchOutbox.leaseExpiresAt} <= ${nowIso}::timestamptz
        )::double precision`,
        failed: sql<number>`count(*) filter (where ${heartbeatDispatchOutbox.status} = 'failed')::double precision`,
        stalePending: sql<number>`count(*) filter (
          where ${heartbeatDispatchOutbox.status} = 'pending'
          and ${heartbeatDispatchOutbox.availableAt} <= ${stalePendingBeforeIso}::timestamptz
        )::double precision`,
        oldestPendingAt: sql<Date | null>`min(${heartbeatDispatchOutbox.availableAt}) filter (
          where ${heartbeatDispatchOutbox.status} = 'pending'
        )`,
        oldestLeasedAt: sql<Date | null>`min(${heartbeatDispatchOutbox.leasedAt}) filter (
          where ${heartbeatDispatchOutbox.status} = 'leased'
        )`,
      })
      .from(heartbeatDispatchOutbox);

    const [row] = opts?.companyId
      ? await query.where(eq(heartbeatDispatchOutbox.companyId, opts.companyId))
      : await query;

    const pending = Number(row?.pending ?? 0);
    const ready = Number(row?.ready ?? 0);
    const leased = Number(row?.leased ?? 0);
    const expiredLeases = Number(row?.expiredLeases ?? 0);
    const failed = Number(row?.failed ?? 0);
    const stalePending = Number(row?.stalePending ?? 0);
    const oldestPendingAt = row?.oldestPendingAt ? new Date(row.oldestPendingAt) : null;
    const oldestLeasedAt = row?.oldestLeasedAt ? new Date(row.oldestLeasedAt) : null;

    const status =
      failed > 0 || expiredLeases > 0 || stalePending > 0
        ? "action"
        : pending > 0 || leased > 0 || ready > 0
          ? "watch"
          : "clear";

    return {
      status,
      pending,
      ready,
      leased,
      expiredLeases,
      failed,
      stalePending,
      oldestPendingAgeMs: oldestPendingAt ? Math.max(0, now.getTime() - oldestPendingAt.getTime()) : null,
      oldestLeasedAgeMs: oldestLeasedAt ? Math.max(0, now.getTime() - oldestLeasedAt.getTime()) : null,
    };
  }

  async function claimReadyRunDispatches(opts: {
    workerId: string;
    companyId?: string;
    now?: Date;
    limit?: number;
    leaseMs?: number;
  }) {
    const workerId = opts.workerId.trim();
    if (!workerId) throw new Error("workerId is required to claim heartbeat dispatches");

    const now = opts.now ?? new Date();
    const nowIso = now.toISOString();
    const leaseExpiresAt = new Date(now.getTime() + Math.max(1_000, opts.leaseMs ?? 60_000));
    const limit = normalizeLimit(opts.limit, 10);
    const companyFilter = opts.companyId
      ? sql`and ${heartbeatDispatchOutbox.companyId} = ${opts.companyId}`
      : sql``;

    return db.transaction(async (tx) => {
      const candidateRows = await tx.execute<{ id: string }>(sql`
        select ${heartbeatDispatchOutbox.id} as id
        from ${heartbeatDispatchOutbox}
        where
          ${heartbeatDispatchOutbox.attemptCount} < ${heartbeatDispatchOutbox.maxAttempts}
          ${companyFilter}
          and (
            (
              ${heartbeatDispatchOutbox.status} = 'pending'
              and ${heartbeatDispatchOutbox.availableAt} <= ${nowIso}::timestamptz
            )
            or (
              ${heartbeatDispatchOutbox.status} = 'leased'
              and ${heartbeatDispatchOutbox.leaseExpiresAt} <= ${nowIso}::timestamptz
            )
          )
        order by
          ${heartbeatDispatchOutbox.availableAt} asc,
          ${heartbeatDispatchOutbox.createdAt} asc,
          ${heartbeatDispatchOutbox.id} asc
        limit ${limit}
        for update skip locked
      `);
      const ids = Array.from(candidateRows).map((row) => row.id).filter(Boolean);
      if (ids.length === 0) return [];

      return tx
        .update(heartbeatDispatchOutbox)
        .set({
          status: "leased",
          leasedBy: workerId,
          leasedAt: now,
          leaseExpiresAt,
          attemptCount: sql`${heartbeatDispatchOutbox.attemptCount} + 1`,
          error: null,
          updatedAt: now,
        })
        .where(inArray(heartbeatDispatchOutbox.id, ids))
        .returning();
    });
  }

  async function markClaimedRunDispatchCompleted(id: string, workerId: string, opts?: {
    now?: Date;
    error?: string | null;
  }) {
    const now = opts?.now ?? new Date();
    return db
      .update(heartbeatDispatchOutbox)
      .set({
        status: "completed",
        leasedBy: null,
        leasedAt: null,
        leaseExpiresAt: null,
        completedAt: now,
        error: opts?.error ?? null,
        updatedAt: now,
      })
      .where(and(
        eq(heartbeatDispatchOutbox.id, id),
        eq(heartbeatDispatchOutbox.status, "leased"),
        eq(heartbeatDispatchOutbox.leasedBy, workerId),
      ))
      .returning()
      .then((rows) => rows[0] ?? null);
  }

  async function releaseClaimedRunDispatch(id: string, workerId: string, opts?: {
    now?: Date;
    availableAt?: Date;
    error?: string | null;
  }) {
    const now = opts?.now ?? new Date();
    return db
      .update(heartbeatDispatchOutbox)
      .set({
        status: "pending",
        availableAt: opts?.availableAt ?? now,
        leasedBy: null,
        leasedAt: null,
        leaseExpiresAt: null,
        error: opts?.error ?? null,
        updatedAt: now,
      })
      .where(and(
        eq(heartbeatDispatchOutbox.id, id),
        eq(heartbeatDispatchOutbox.status, "leased"),
        eq(heartbeatDispatchOutbox.leasedBy, workerId),
      ))
      .returning()
      .then((rows) => rows[0] ?? null);
  }

  async function markClaimedRunDispatchFailed(id: string, workerId: string, opts?: {
    now?: Date;
    error?: string | null;
  }) {
    const now = opts?.now ?? new Date();
    return db
      .update(heartbeatDispatchOutbox)
      .set({
        status: "failed",
        leasedBy: null,
        leasedAt: null,
        leaseExpiresAt: null,
        completedAt: now,
        error: opts?.error ?? null,
        updatedAt: now,
      })
      .where(and(
        eq(heartbeatDispatchOutbox.id, id),
        eq(heartbeatDispatchOutbox.status, "leased"),
        eq(heartbeatDispatchOutbox.leasedBy, workerId),
      ))
      .returning()
      .then((rows) => rows[0] ?? null);
  }

  async function markRunDispatchCompleted(runId: string, opts?: {
    now?: Date;
    error?: string | null;
  }) {
    const now = opts?.now ?? new Date();
    return db
      .update(heartbeatDispatchOutbox)
      .set({
        status: "completed",
        leasedBy: null,
        leasedAt: null,
        leaseExpiresAt: null,
        completedAt: now,
        error: opts?.error ?? null,
        updatedAt: now,
      })
      .where(and(
        eq(heartbeatDispatchOutbox.runId, runId),
        inArray(heartbeatDispatchOutbox.status, ACTIVE_HEARTBEAT_DISPATCH_OUTBOX_STATUSES),
      ))
      .returning();
  }

  async function cancelRunDispatch(runId: string, opts?: {
    now?: Date;
    error?: string | null;
  }) {
    const now = opts?.now ?? new Date();
    return db
      .update(heartbeatDispatchOutbox)
      .set({
        status: "cancelled",
        leasedBy: null,
        leasedAt: null,
        leaseExpiresAt: null,
        completedAt: now,
        error: opts?.error ?? null,
        updatedAt: now,
      })
      .where(and(
        eq(heartbeatDispatchOutbox.runId, runId),
        inArray(heartbeatDispatchOutbox.status, ACTIVE_HEARTBEAT_DISPATCH_OUTBOX_STATUSES),
      ))
      .returning();
  }

  return {
    enqueueRunDispatch,
    listReadyRunDispatches,
    summarizeQueueHealth,
    claimReadyRunDispatches,
    markClaimedRunDispatchCompleted,
    releaseClaimedRunDispatch,
    markClaimedRunDispatchFailed,
    markRunDispatchCompleted,
    cancelRunDispatch,
  };
}
