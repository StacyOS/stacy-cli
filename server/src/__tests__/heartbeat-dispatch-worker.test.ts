import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agentWakeupRequests,
  agents,
  companies,
  createDb,
  heartbeatDispatchOutbox,
  heartbeatRuns,
} from "@arpanstacy/stacy-db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { heartbeatDispatchOutboxService } from "../services/heartbeat-dispatch-outbox.ts";
import { createHeartbeatDispatchWorker } from "../services/heartbeat-dispatch-worker.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres heartbeat dispatch worker tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("heartbeat dispatch worker", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("stacy-heartbeat-dispatch-worker-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.execute(sql.raw(`TRUNCATE TABLE "companies" CASCADE`));
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedRun() {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const wakeupRequestId = randomUUID();
    const runId = randomUUID();

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
      status: "running",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(agentWakeupRequests).values({
      id: wakeupRequestId,
      companyId,
      agentId,
      source: "on_demand",
      triggerDetail: "manual",
      status: "queued",
    });
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      status: "queued",
      invocationSource: "on_demand",
      triggerDetail: "manual",
      wakeupRequestId,
      contextSnapshot: { taskKey: "dispatch-worker" },
    });
    await db
      .update(agentWakeupRequests)
      .set({ runId })
      .where(eq(agentWakeupRequests.id, wakeupRequestId));

    return { companyId, agentId, wakeupRequestId, runId };
  }

  it("completes dispatched rows and releases deferred rows", async () => {
    const dispatched = await seedRun();
    const deferred = await seedRun();
    const outbox = heartbeatDispatchOutboxService(db);
    await outbox.enqueueRunDispatch({ ...dispatched, reason: "wakeup_enqueued" });
    await outbox.enqueueRunDispatch({ ...deferred, reason: "wakeup_enqueued" });

    const worker = createHeartbeatDispatchWorker({
      db,
      workerId: "test-worker",
      batchSize: 10,
      dispatchQueuedRun: async (runId) => {
        if (runId === dispatched.runId) {
          return { outcome: "dispatched", runId };
        }
        return { outcome: "deferred", reason: "agent_concurrency_full", retryAfterMs: 60_000 };
      },
    });

    const result = await worker.tick();
    expect(result).toMatchObject({
      claimed: 2,
      completed: 1,
      released: 1,
      failed: 0,
    });

    const rows = await db
      .select({
        runId: heartbeatDispatchOutbox.runId,
        status: heartbeatDispatchOutbox.status,
        leasedBy: heartbeatDispatchOutbox.leasedBy,
        error: heartbeatDispatchOutbox.error,
      })
      .from(heartbeatDispatchOutbox);

    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        runId: dispatched.runId,
        status: "completed",
        leasedBy: null,
        error: "dispatched_by_outbox_worker",
      }),
      expect.objectContaining({
        runId: deferred.runId,
        status: "pending",
        leasedBy: null,
        error: "agent_concurrency_full",
      }),
    ]));
  });

  it("fails exhausted rows when dispatch keeps throwing", async () => {
    const ids = await seedRun();
    const outbox = heartbeatDispatchOutboxService(db);
    await outbox.enqueueRunDispatch({
      ...ids,
      reason: "wakeup_enqueued",
      maxAttempts: 1,
    });

    const worker = createHeartbeatDispatchWorker({
      db,
      workerId: "test-worker",
      dispatchQueuedRun: async () => {
        throw new Error("dispatcher unavailable");
      },
    });

    const result = await worker.tick();
    expect(result).toMatchObject({
      claimed: 1,
      completed: 0,
      released: 0,
      failed: 1,
    });

    const rows = await db
      .select()
      .from(heartbeatDispatchOutbox)
      .where(eq(heartbeatDispatchOutbox.runId, ids.runId));
    expect(rows[0]).toMatchObject({
      status: "failed",
      leasedBy: null,
      error: "dispatcher unavailable",
      attemptCount: 1,
    });
    expect(rows[0].completedAt).toEqual(expect.any(Date));
  });
});
