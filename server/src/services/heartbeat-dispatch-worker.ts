import { randomUUID } from "node:crypto";
import type { Db } from "@arpanstacy/stacy-db";
import { logger } from "../middleware/logger.js";
import {
  heartbeatDispatchOutboxService,
  type HeartbeatDispatchOutboxRow,
} from "./heartbeat-dispatch-outbox.js";

export type HeartbeatQueuedRunDispatchResult =
  | { outcome: "dispatched"; runId: string }
  | { outcome: "deferred"; reason: string; retryAfterMs?: number }
  | { outcome: "skipped"; reason: string }
  | { outcome: "not_found"; reason?: string }
  | { outcome: "not_queued"; status: string; reason?: string };

export interface HeartbeatDispatchWorkerOptions {
  db: Db;
  dispatchQueuedRun: (runId: string) => Promise<HeartbeatQueuedRunDispatchResult>;
  workerId?: string;
  intervalMs?: number;
  batchSize?: number;
  leaseMs?: number;
  retryDelayMs?: number;
  companyId?: string;
}

export interface HeartbeatDispatchWorkerTickResult {
  claimed: number;
  completed: number;
  released: number;
  failed: number;
  skipped: number;
}

export interface HeartbeatDispatchWorkerDiagnostics {
  running: boolean;
  workerId: string;
  tickInProgress: boolean;
  tickCount: number;
  lastTickAt: string | null;
}

export interface HeartbeatDispatchWorker {
  start(): void;
  stop(): void;
  tick(): Promise<HeartbeatDispatchWorkerTickResult>;
  diagnostics(): HeartbeatDispatchWorkerDiagnostics;
}

function normalizePositiveInt(value: number | undefined, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value ?? NaN)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value!)));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function createHeartbeatDispatchWorker(options: HeartbeatDispatchWorkerOptions): HeartbeatDispatchWorker {
  const outbox = heartbeatDispatchOutboxService(options.db);
  const workerId = options.workerId?.trim() || `heartbeat-dispatch:${process.pid}:${randomUUID()}`;
  const intervalMs = normalizePositiveInt(options.intervalMs, 5_000, 1_000, 60_000);
  const batchSize = normalizePositiveInt(options.batchSize, 10, 1, 100);
  const leaseMs = normalizePositiveInt(options.leaseMs, 60_000, 5_000, 10 * 60_000);
  const retryDelayMs = normalizePositiveInt(options.retryDelayMs, 10_000, 1_000, 10 * 60_000);
  const log = logger.child({ service: "heartbeat-dispatch-worker", workerId });

  let running = false;
  let tickInProgress = false;
  let tickTimer: ReturnType<typeof setInterval> | null = null;
  let tickCount = 0;
  let lastTickAt: Date | null = null;

  async function complete(row: HeartbeatDispatchOutboxRow, reason: string, result: HeartbeatDispatchWorkerTickResult) {
    await outbox.markClaimedRunDispatchCompleted(row.id, workerId, { error: reason });
    result.completed += 1;
  }

  async function release(
    row: HeartbeatDispatchOutboxRow,
    reason: string,
    retryAfterMs: number,
    result: HeartbeatDispatchWorkerTickResult,
  ) {
    await outbox.releaseClaimedRunDispatch(row.id, workerId, {
      availableAt: new Date(Date.now() + retryAfterMs),
      error: reason,
    });
    result.released += 1;
  }

  async function fail(row: HeartbeatDispatchOutboxRow, reason: string, result: HeartbeatDispatchWorkerTickResult) {
    await outbox.markClaimedRunDispatchFailed(row.id, workerId, { error: reason });
    result.failed += 1;
  }

  async function dispatchRow(row: HeartbeatDispatchOutboxRow, result: HeartbeatDispatchWorkerTickResult) {
    try {
      const dispatch = await options.dispatchQueuedRun(row.runId);
      switch (dispatch.outcome) {
        case "dispatched":
          await complete(row, "dispatched_by_outbox_worker", result);
          return;
        case "not_queued":
          await complete(row, dispatch.reason ?? `run_already_${dispatch.status}`, result);
          result.skipped += 1;
          return;
        case "skipped":
          await complete(row, dispatch.reason, result);
          result.skipped += 1;
          return;
        case "deferred":
          await release(row, dispatch.reason, dispatch.retryAfterMs ?? retryDelayMs, result);
          return;
        case "not_found":
          await fail(row, dispatch.reason ?? "run_not_found", result);
          return;
      }
    } catch (error) {
      const message = errorMessage(error);
      if (row.attemptCount >= row.maxAttempts) {
        await fail(row, message, result);
      } else {
        await release(row, message, retryDelayMs, result);
      }
    }
  }

  async function tick(): Promise<HeartbeatDispatchWorkerTickResult> {
    if (tickInProgress) {
      return { claimed: 0, completed: 0, released: 0, failed: 0, skipped: 1 };
    }

    tickInProgress = true;
    tickCount += 1;
    lastTickAt = new Date();

    const result: HeartbeatDispatchWorkerTickResult = {
      claimed: 0,
      completed: 0,
      released: 0,
      failed: 0,
      skipped: 0,
    };

    try {
      const rows = await outbox.claimReadyRunDispatches({
        workerId,
        companyId: options.companyId,
        limit: batchSize,
        leaseMs,
      });
      result.claimed = rows.length;

      for (const row of rows) {
        await dispatchRow(row, result);
      }

      if (rows.length > 0) {
        log.info({ ...result }, "heartbeat dispatch worker processed outbox rows");
      }

      return result;
    } catch (error) {
      log.error({ err: error }, "heartbeat dispatch worker tick failed");
      return result;
    } finally {
      tickInProgress = false;
    }
  }

  function start() {
    if (running) return;
    running = true;
    tickTimer = setInterval(() => {
      void tick();
    }, intervalMs);
    tickTimer.unref?.();
    void tick();
    log.info({ intervalMs, batchSize, leaseMs }, "heartbeat dispatch worker started");
  }

  function stop() {
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
    if (!running) return;
    running = false;
    log.info("heartbeat dispatch worker stopped");
  }

  function diagnostics(): HeartbeatDispatchWorkerDiagnostics {
    return {
      running,
      workerId,
      tickInProgress,
      tickCount,
      lastTickAt: lastTickAt?.toISOString() ?? null,
    };
  }

  return {
    start,
    stop,
    tick,
    diagnostics,
  };
}
