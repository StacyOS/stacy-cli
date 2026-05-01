import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  agentWakeupRequests,
  agents,
  companies,
  costEvents,
  createDb,
  heartbeatDispatchOutbox,
  heartbeatRunEvents,
  heartbeatRuns,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { runningProcesses } from "../adapters/index.ts";
import { heartbeatService } from "../services/heartbeat.ts";
import { heartbeatDispatchOutboxService } from "../services/heartbeat-dispatch-outbox.ts";
import { createHeartbeatDispatchWorker } from "../services/heartbeat-dispatch-worker.ts";

const mockAdapterExecute = vi.hoisted(() =>
  vi.fn(async () => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    errorMessage: null,
    summary: "Worker-owned Phase 2 acceptance smoke run.",
    provider: "test",
    biller: "test-biller",
    model: "test-model",
    billingType: "metered_api",
    usage: {
      inputTokens: 12,
      outputTokens: 8,
      cachedInputTokens: 2,
    },
    costUsd: 0.04,
  })),
);

vi.mock("../adapters/index.ts", async () => {
  const actual = await vi.importActual<typeof import("../adapters/index.ts")>("../adapters/index.ts");
  return {
    ...actual,
    getServerAdapter: vi.fn(() => ({
      supportsLocalAgentJwt: false,
      execute: mockAdapterExecute,
    })),
  };
});

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres worker-owned Phase 2 smoke tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

async function waitForRunStatus(
  db: ReturnType<typeof createDb>,
  runId: string,
  expectedStatus: string,
  timeoutMs = 3_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = await db
      .select({ status: heartbeatRuns.status })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runId))
      .then((rows) => rows[0] ?? null);
    if (row?.status === expectedStatus) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

async function waitForTransitionEvents(
  db: ReturnType<typeof createDb>,
  runId: string,
  count: number,
  timeoutMs = 3_000,
) {
  const deadline = Date.now() + timeoutMs;
  let latest: Array<{
    message: string;
    payload: unknown;
  }> = [];
  while (Date.now() < deadline) {
    latest = await db
      .select({
        message: heartbeatRunEvents.message,
        payload: heartbeatRunEvents.payload,
      })
      .from(heartbeatRunEvents)
      .where(and(
        eq(heartbeatRunEvents.runId, runId),
        eq(heartbeatRunEvents.eventType, "status.transition"),
      ))
      .orderBy(asc(heartbeatRunEvents.seq));
    if (latest.length >= count) return latest;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return latest;
}

describeEmbeddedPostgres("heartbeat worker-owned Phase 2 smoke", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-worker-owned-phase2-smoke-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    vi.clearAllMocks();
    runningProcesses.clear();
    await db.execute(sql.raw(`TRUNCATE TABLE "companies" CASCADE`));
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("runs the Phase 2 acceptance path through worker-owned dispatch", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const idempotencyKey = "worker-owned-smoke:task-123";

    await db.insert(companies).values({
      id: companyId,
      name: "Stacy",
      issuePrefix: `S${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "CodexCoder",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {
        heartbeat: {
          wakeOnDemand: true,
          maxConcurrentRuns: 1,
        },
      },
      permissions: {},
    });

    const heartbeat = heartbeatService(db, { dispatchMode: "worker_owned" });
    const outbox = heartbeatDispatchOutboxService(db);
    const worker = createHeartbeatDispatchWorker({
      db,
      workerId: "phase2-worker-owned-smoke",
      batchSize: 10,
      dispatchQueuedRun: heartbeat.dispatchQueuedRun,
    });

    const firstRun = await heartbeat.wakeup(agentId, {
      source: "on_demand",
      triggerDetail: "manual",
      reason: "operator_task",
      payload: { taskId: "task-123", attempt: 1 },
      contextSnapshot: { taskId: "task-123", taskKey: "task-123" },
      idempotencyKey,
    });

    expect(firstRun).not.toBeNull();
    expect(firstRun?.status).toBe("queued");
    expect(mockAdapterExecute).not.toHaveBeenCalled();

    expect(await outbox.summarizeQueueHealth({ companyId })).toMatchObject({
      status: "watch",
      pending: 1,
      ready: 1,
      leased: 0,
      failed: 0,
    });

    await expect(worker.tick()).resolves.toMatchObject({
      claimed: 1,
      completed: 1,
      released: 0,
      failed: 0,
    });
    expect(await waitForRunStatus(db, firstRun!.id, "succeeded")).toBe(true);
    expect(mockAdapterExecute).toHaveBeenCalledTimes(1);

    const retriedRun = await heartbeat.wakeup(agentId, {
      source: "on_demand",
      triggerDetail: "manual",
      reason: "operator_task",
      payload: { taskId: "task-123", attempt: 2 },
      contextSnapshot: { taskId: "task-123", taskKey: "task-123" },
      idempotencyKey,
    });
    expect(retriedRun?.id).toBe(firstRun!.id);

    await expect(worker.tick()).resolves.toMatchObject({
      claimed: 0,
      completed: 0,
      released: 0,
      failed: 0,
    });
    expect(mockAdapterExecute).toHaveBeenCalledTimes(1);

    const [claimedRun] = await db
      .select({
        status: heartbeatRuns.status,
        claimToken: heartbeatRuns.claimToken,
        claimOwner: heartbeatRuns.claimOwner,
        claimLeasedAt: heartbeatRuns.claimLeasedAt,
        claimLeaseExpiresAt: heartbeatRuns.claimLeaseExpiresAt,
      })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, firstRun!.id));
    expect(claimedRun).toMatchObject({
      status: "succeeded",
      claimToken: expect.any(String),
      claimOwner: expect.stringMatching(/^stacy-server:\d+$/),
      claimLeasedAt: expect.any(Date),
      claimLeaseExpiresAt: expect.any(Date),
    });
    expect(claimedRun.claimLeaseExpiresAt!.getTime()).toBeGreaterThan(
      claimedRun.claimLeasedAt!.getTime(),
    );

    const transitionRows = await waitForTransitionEvents(db, firstRun!.id, 3);
    expect(transitionRows.map((event) => event.message)).toEqual([
      "Run status transition: created -> queued",
      "Run status transition: queued -> running",
      "Run status transition: running -> succeeded",
    ]);
    expect(transitionRows.map((event) => event.payload)).toEqual([
      expect.objectContaining({ fromStatus: null, toStatus: "queued", reason: "wakeup_enqueued" }),
      expect.objectContaining({ fromStatus: "queued", toStatus: "running", reason: "run_claimed" }),
      expect.objectContaining({ fromStatus: "running", toStatus: "succeeded", reason: "adapter_result" }),
    ]);

    const runs = await db
      .select({ id: heartbeatRuns.id })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.agentId, agentId));
    const wakes = await db
      .select({ id: agentWakeupRequests.id })
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.idempotencyKey, idempotencyKey));
    expect(runs).toHaveLength(1);
    expect(wakes).toHaveLength(1);

    const [dispatchRow] = await db
      .select({
        status: heartbeatDispatchOutbox.status,
        leasedBy: heartbeatDispatchOutbox.leasedBy,
        error: heartbeatDispatchOutbox.error,
        attemptCount: heartbeatDispatchOutbox.attemptCount,
      })
      .from(heartbeatDispatchOutbox)
      .where(eq(heartbeatDispatchOutbox.runId, firstRun!.id));
    expect(dispatchRow).toMatchObject({
      status: "completed",
      leasedBy: null,
      error: "dispatched_by_outbox_worker",
      attemptCount: 1,
    });

    const [costEvent] = await db
      .select({
        heartbeatRunId: costEvents.heartbeatRunId,
        inputTokens: costEvents.inputTokens,
        cachedInputTokens: costEvents.cachedInputTokens,
        outputTokens: costEvents.outputTokens,
        costCents: costEvents.costCents,
        billingType: costEvents.billingType,
      })
      .from(costEvents)
      .where(eq(costEvents.heartbeatRunId, firstRun!.id));
    expect(costEvent).toMatchObject({
      heartbeatRunId: firstRun!.id,
      inputTokens: 12,
      cachedInputTokens: 2,
      outputTokens: 8,
      costCents: 4,
      billingType: "metered_api",
    });

    expect(await outbox.summarizeQueueHealth({ companyId })).toMatchObject({
      status: "clear",
      pending: 0,
      ready: 0,
      leased: 0,
      expiredLeases: 0,
      failed: 0,
      stalePending: 0,
    });
  });
});
