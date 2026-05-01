import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  agents,
  companies,
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
    summary: "Worker-owned dispatch test run.",
    provider: "test",
    model: "test-model",
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
    `Skipping embedded Postgres heartbeat dispatch mode tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
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

async function waitForRunBookkeeping(
  db: ReturnType<typeof createDb>,
  runId: string,
  agentId: string,
  timeoutMs = 3_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [event] = await db
      .select({ id: heartbeatRunEvents.id })
      .from(heartbeatRunEvents)
      .where(and(
        eq(heartbeatRunEvents.runId, runId),
        eq(heartbeatRunEvents.eventType, "lifecycle"),
        eq(heartbeatRunEvents.message, "run succeeded"),
      ))
      .limit(1);
    const agent = await db
      .select({ status: agents.status })
      .from(agents)
      .where(eq(agents.id, agentId))
      .then((rows) => rows[0] ?? null);
    if (event && agent?.status === "idle") return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

describeEmbeddedPostgres("heartbeat dispatch mode", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-heartbeat-dispatch-mode-");
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

  async function seedActiveAgent() {
    const companyId = randomUUID();
    const agentId = randomUUID();

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

    return { companyId, agentId };
  }

  it("keeps shadow-worker outbox rows aligned with direct in-process claims", async () => {
    const { companyId, agentId } = await seedActiveAgent();
    const heartbeat = heartbeatService(db, { dispatchMode: "shadow_worker" });
    const run = await heartbeat.wakeup(agentId, {
      source: "on_demand",
      triggerDetail: "manual",
      reason: "operator_task",
      contextSnapshot: { taskId: "shadow-task-123", taskKey: "shadow-task-123" },
    });

    expect(run).not.toBeNull();
    expect(await waitForRunStatus(db, run!.id, "succeeded")).toBe(true);
    expect(await waitForRunBookkeeping(db, run!.id, agentId)).toBe(true);
    expect(mockAdapterExecute).toHaveBeenCalledTimes(1);

    const [runRow] = await db
      .select({
        id: heartbeatRuns.id,
        status: heartbeatRuns.status,
        claimToken: heartbeatRuns.claimToken,
        claimOwner: heartbeatRuns.claimOwner,
        startedAt: heartbeatRuns.startedAt,
      })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, run!.id));
    expect(runRow).toMatchObject({
      id: run!.id,
      status: "succeeded",
      claimToken: expect.any(String),
      startedAt: expect.any(Date),
    });
    expect(runRow.claimOwner).toContain("stacy-server:");

    const outboxRows = await db
      .select({
        runId: heartbeatDispatchOutbox.runId,
        status: heartbeatDispatchOutbox.status,
        reason: heartbeatDispatchOutbox.reason,
        leasedBy: heartbeatDispatchOutbox.leasedBy,
        error: heartbeatDispatchOutbox.error,
        payload: heartbeatDispatchOutbox.payload,
      })
      .from(heartbeatDispatchOutbox)
      .where(eq(heartbeatDispatchOutbox.runId, run!.id));
    expect(outboxRows).toEqual([
      expect.objectContaining({
        runId: run!.id,
        status: "completed",
        reason: "wakeup_enqueued",
        leasedBy: null,
        error: "claimed_by_in_process_dispatch",
        payload: expect.objectContaining({
          requestedByActorType: null,
          requestedByActorId: null,
        }),
      }),
    ]);

    const queueHealth = await heartbeatDispatchOutboxService(db).summarizeQueueHealth({ companyId });
    expect(queueHealth).toMatchObject({
      status: "clear",
      pending: 0,
      ready: 0,
      leased: 0,
      expiredLeases: 0,
      failed: 0,
      stalePending: 0,
    });

    const worker = createHeartbeatDispatchWorker({
      db,
      workerId: "shadow-worker-comparison",
      dispatchQueuedRun: heartbeat.dispatchQueuedRun,
    });
    await expect(worker.tick()).resolves.toMatchObject({
      claimed: 0,
      completed: 0,
      failed: 0,
      released: 0,
    });
  });

  it("leaves new runs queued in worker-owned mode until the dispatch worker claims them", async () => {
    const { agentId } = await seedActiveAgent();
    const heartbeat = heartbeatService(db, { dispatchMode: "worker_owned" });
    const run = await heartbeat.wakeup(agentId, {
      source: "on_demand",
      triggerDetail: "manual",
      reason: "operator_task",
      contextSnapshot: { taskId: "task-123", taskKey: "task-123" },
    });

    expect(run).not.toBeNull();
    expect(mockAdapterExecute).not.toHaveBeenCalled();

    const queuedRun = await db
      .select({ status: heartbeatRuns.status })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, run!.id))
      .then((rows) => rows[0] ?? null);
    expect(queuedRun?.status).toBe("queued");

    const pendingOutboxRows = await db
      .select()
      .from(heartbeatDispatchOutbox)
      .where(eq(heartbeatDispatchOutbox.runId, run!.id));
    expect(pendingOutboxRows).toHaveLength(1);
    expect(pendingOutboxRows[0]).toMatchObject({
      status: "pending",
      reason: "wakeup_enqueued",
    });

    const worker = createHeartbeatDispatchWorker({
      db,
      workerId: "dispatch-mode-test",
      dispatchQueuedRun: heartbeat.dispatchQueuedRun,
    });
    const tickResult = await worker.tick();

    expect(tickResult).toMatchObject({
      claimed: 1,
      completed: 1,
      failed: 0,
      released: 0,
    });
    expect(await waitForRunStatus(db, run!.id, "succeeded")).toBe(true);
    expect(await waitForRunBookkeeping(db, run!.id, agentId)).toBe(true);
    expect(mockAdapterExecute).toHaveBeenCalledTimes(1);

    const completedOutboxRows = await db
      .select({
        status: heartbeatDispatchOutbox.status,
        leasedBy: heartbeatDispatchOutbox.leasedBy,
        error: heartbeatDispatchOutbox.error,
      })
      .from(heartbeatDispatchOutbox)
      .where(eq(heartbeatDispatchOutbox.runId, run!.id));
    expect(completedOutboxRows[0]).toMatchObject({
      status: "completed",
      leasedBy: null,
      error: "dispatched_by_outbox_worker",
    });
  });
});
