import { randomUUID } from "node:crypto";
import { asc, and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  agents,
  agentRuntimeState,
  agentWakeupRequests,
  companySkills,
  companies,
  createDb,
  heartbeatRunEvents,
  heartbeatRuns,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { runningProcesses } from "../adapters/index.ts";
import { heartbeatService } from "../services/heartbeat.ts";

const mockAdapterExecute = vi.hoisted(() =>
  vi.fn(async () => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    errorMessage: null,
    summary: "Idempotent wakeup test run.",
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
    `Skipping embedded Postgres heartbeat wakeup idempotency tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
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

async function waitForValue<T>(
  read: () => Promise<T | null | undefined>,
  timeoutMs = 3_000,
) {
  const deadline = Date.now() + timeoutMs;
  let latest: T | null | undefined = null;
  while (Date.now() < deadline) {
    latest = await read();
    if (latest) return latest;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return latest ?? null;
}

describeEmbeddedPostgres("heartbeat wakeup idempotency", () => {
  let db!: ReturnType<typeof createDb>;
  let heartbeat!: ReturnType<typeof heartbeatService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-heartbeat-wakeup-idempotency-");
    db = createDb(tempDb.connectionString);
    heartbeat = heartbeatService(db);
  }, 20_000);

  afterEach(async () => {
    vi.clearAllMocks();
    runningProcesses.clear();
    await db.delete(heartbeatRunEvents);
    await db.delete(activityLog);
    await db.delete(companySkills);
    await db.delete(heartbeatRuns);
    await db.delete(agentWakeupRequests);
    await db.delete(agentRuntimeState);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("returns the original run when a completed wakeup is retried with the same idempotency key", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const idempotencyKey = "operator-click:task-123";

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

    const firstRun = await heartbeat.wakeup(agentId, {
      source: "on_demand",
      triggerDetail: "manual",
      reason: "operator_task",
      payload: { taskId: "task-123", attempt: 1 },
      contextSnapshot: { taskId: "task-123", taskKey: "task-123" },
      idempotencyKey,
    });
    expect(firstRun).not.toBeNull();
    expect(await waitForRunStatus(db, firstRun!.id, "succeeded")).toBe(true);
    const claimedRun = await db
      .select({
        claimToken: heartbeatRuns.claimToken,
        claimOwner: heartbeatRuns.claimOwner,
        claimLeasedAt: heartbeatRuns.claimLeasedAt,
        claimLeaseExpiresAt: heartbeatRuns.claimLeaseExpiresAt,
      })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, firstRun!.id))
      .then((rows) => rows[0] ?? null);
    expect(claimedRun?.claimToken).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(claimedRun?.claimOwner).toMatch(/^stacy-server:\d+$/);
    expect(claimedRun?.claimLeasedAt).toBeInstanceOf(Date);
    expect(claimedRun?.claimLeaseExpiresAt).toBeInstanceOf(Date);
    expect(claimedRun!.claimLeaseExpiresAt!.getTime()).toBeGreaterThan(
      claimedRun!.claimLeasedAt!.getTime(),
    );
    const transitions = await waitForValue(async () => {
      const rows = await db
        .select({
          message: heartbeatRunEvents.message,
          payload: heartbeatRunEvents.payload,
        })
        .from(heartbeatRunEvents)
        .where(and(
          eq(heartbeatRunEvents.runId, firstRun!.id),
          eq(heartbeatRunEvents.eventType, "status.transition"),
        ))
        .orderBy(asc(heartbeatRunEvents.seq));
      return rows.length >= 3 ? rows : null;
    });
    expect(transitions).not.toBeNull();
    const transitionRows = transitions ?? [];
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

    const retriedRun = await heartbeat.wakeup(agentId, {
      source: "on_demand",
      triggerDetail: "manual",
      reason: "operator_task",
      payload: { taskId: "task-123", attempt: 2 },
      contextSnapshot: { taskId: "task-123", taskKey: "task-123" },
      idempotencyKey,
    });

    expect(retriedRun?.id).toBe(firstRun!.id);

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
  });
});
