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
import {
  buildHeartbeatDispatchIdempotencyKey,
  heartbeatDispatchOutboxService,
} from "../services/heartbeat-dispatch-outbox.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres heartbeat dispatch outbox tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("heartbeat dispatch outbox", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("stacy-heartbeat-dispatch-outbox-");
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
      contextSnapshot: { taskKey: "dispatch-outbox" },
    });
    await db
      .update(agentWakeupRequests)
      .set({ runId })
      .where(eq(agentWakeupRequests.id, wakeupRequestId));

    return { companyId, agentId, wakeupRequestId, runId };
  }

  it("creates one idempotent dispatch row for a queued run", async () => {
    const ids = await seedRun();
    const service = heartbeatDispatchOutboxService(db);

    const first = await service.enqueueRunDispatch({
      ...ids,
      reason: "wakeup_enqueued",
      payload: { source: "test" },
    });
    const second = await service.enqueueRunDispatch({
      ...ids,
      reason: "wakeup_enqueued",
      payload: { source: "duplicate" },
    });

    expect(first?.id).toBe(second?.id);
    expect(first?.idempotencyKey).toBe(buildHeartbeatDispatchIdempotencyKey(ids.runId));

    const rows = await db
      .select()
      .from(heartbeatDispatchOutbox)
      .where(eq(heartbeatDispatchOutbox.runId, ids.runId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      companyId: ids.companyId,
      agentId: ids.agentId,
      runId: ids.runId,
      wakeupRequestId: ids.wakeupRequestId,
      status: "pending",
      reason: "wakeup_enqueued",
      payload: { source: "test" },
      attemptCount: 0,
      maxAttempts: 3,
    });

    const ready = await service.listReadyRunDispatches({ companyId: ids.companyId });
    expect(ready.map((row) => row.id)).toEqual([first?.id]);
  });

  it("marks active dispatch requests completed or cancelled idempotently", async () => {
    const first = await seedRun();
    const second = await seedRun();
    const service = heartbeatDispatchOutboxService(db);

    await service.enqueueRunDispatch({ ...first, reason: "wakeup_enqueued" });
    await service.enqueueRunDispatch({ ...second, reason: "wakeup_enqueued" });

    const completed = await service.markRunDispatchCompleted(first.runId, {
      error: "claimed_by_in_process_dispatch",
    });
    const cancelled = await service.cancelRunDispatch(second.runId, {
      error: "operator_cancelled",
    });
    const completedAgain = await service.markRunDispatchCompleted(first.runId);

    expect(completed).toHaveLength(1);
    expect(cancelled).toHaveLength(1);
    expect(completedAgain).toHaveLength(0);

    const rows = await db
      .select({
        runId: heartbeatDispatchOutbox.runId,
        status: heartbeatDispatchOutbox.status,
        completedAt: heartbeatDispatchOutbox.completedAt,
        error: heartbeatDispatchOutbox.error,
      })
      .from(heartbeatDispatchOutbox);
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        runId: first.runId,
        status: "completed",
        completedAt: expect.any(Date),
        error: "claimed_by_in_process_dispatch",
      }),
      expect.objectContaining({
        runId: second.runId,
        status: "cancelled",
        completedAt: expect.any(Date),
        error: "operator_cancelled",
      }),
    ]));
  });

  it("summarizes queue health for startup diagnostics and dashboards", async () => {
    const service = heartbeatDispatchOutboxService(db);
    const pending = await seedRun();
    const leased = await seedRun();
    const failed = await seedRun();
    const baseTime = new Date("2026-01-01T00:00:00.000Z");
    const now = new Date("2026-01-01T00:10:00.000Z");

    await service.enqueueRunDispatch({
      ...pending,
      reason: "wakeup_enqueued",
      availableAt: baseTime,
    });
    await service.enqueueRunDispatch({
      ...leased,
      reason: "wakeup_enqueued",
      availableAt: baseTime,
    });
    await service.enqueueRunDispatch({
      ...failed,
      reason: "wakeup_enqueued",
      availableAt: baseTime,
      maxAttempts: 1,
    });

    const [leasedRow] = await service.claimReadyRunDispatches({
      workerId: "worker-a",
      companyId: leased.companyId,
      now: baseTime,
      leaseMs: 60_000,
    });
    expect(leasedRow).toMatchObject({
      runId: leased.runId,
      status: "leased",
    });

    const [failedRow] = await service.claimReadyRunDispatches({
      workerId: "worker-a",
      companyId: failed.companyId,
      now: baseTime,
      leaseMs: 60_000,
    });
    expect(failedRow).toMatchObject({
      runId: failed.runId,
      status: "leased",
    });
    await service.markClaimedRunDispatchFailed(failedRow.id, "worker-a", {
      now: new Date("2026-01-01T00:01:00.000Z"),
      error: "boom",
    });

    const summary = await service.summarizeQueueHealth({
      now,
      stalePendingThresholdMs: 5 * 60 * 1000,
    });

    expect(summary).toMatchObject({
      status: "action",
      pending: 1,
      ready: 1,
      leased: 1,
      expiredLeases: 1,
      failed: 1,
      stalePending: 1,
      oldestPendingAgeMs: 10 * 60 * 1000,
      oldestLeasedAgeMs: 10 * 60 * 1000,
    });

    const scoped = await service.summarizeQueueHealth({
      companyId: pending.companyId,
      now,
      stalePendingThresholdMs: 5 * 60 * 1000,
    });

    expect(scoped).toMatchObject({
      status: "action",
      pending: 1,
      ready: 1,
      leased: 0,
      expiredLeases: 0,
      failed: 0,
      stalePending: 1,
    });
  });

  it("claims ready dispatch rows with leases and reclaims expired leases", async () => {
    const ids = await seedRun();
    const service = heartbeatDispatchOutboxService(db);
    const availableAt = new Date("2026-01-01T00:00:00.000Z");

    await service.enqueueRunDispatch({
      ...ids,
      reason: "wakeup_enqueued",
      availableAt,
    });

    const firstClaim = await service.claimReadyRunDispatches({
      workerId: "worker-a",
      now: new Date("2026-01-01T00:00:01.000Z"),
      leaseMs: 60_000,
    });
    expect(firstClaim).toHaveLength(1);
    expect(firstClaim[0]).toMatchObject({
      runId: ids.runId,
      status: "leased",
      leasedBy: "worker-a",
      attemptCount: 1,
    });
    expect(firstClaim[0].leasedAt).toEqual(new Date("2026-01-01T00:00:01.000Z"));
    expect(firstClaim[0].leaseExpiresAt).toEqual(new Date("2026-01-01T00:01:01.000Z"));

    const hiddenWhileLeased = await service.claimReadyRunDispatches({
      workerId: "worker-b",
      now: new Date("2026-01-01T00:00:02.000Z"),
    });
    expect(hiddenWhileLeased).toHaveLength(0);

    const released = await service.releaseClaimedRunDispatch(firstClaim[0].id, "worker-a", {
      availableAt: new Date("2026-01-01T00:00:05.000Z"),
      error: "agent_concurrency_full",
    });
    expect(released).toMatchObject({
      status: "pending",
      leasedBy: null,
      error: "agent_concurrency_full",
    });

    const secondClaim = await service.claimReadyRunDispatches({
      workerId: "worker-b",
      now: new Date("2026-01-01T00:00:05.000Z"),
      leaseMs: 60_000,
    });
    expect(secondClaim).toHaveLength(1);
    expect(secondClaim[0]).toMatchObject({
      status: "leased",
      leasedBy: "worker-b",
      attemptCount: 2,
    });

    const reclaimedExpiredLease = await service.claimReadyRunDispatches({
      workerId: "worker-c",
      now: new Date("2026-01-01T00:02:06.000Z"),
      leaseMs: 60_000,
    });
    expect(reclaimedExpiredLease).toHaveLength(1);
    expect(reclaimedExpiredLease[0]).toMatchObject({
      status: "leased",
      leasedBy: "worker-c",
      attemptCount: 3,
    });

    const wrongWorkerCompletion = await service.markClaimedRunDispatchCompleted(
      reclaimedExpiredLease[0].id,
      "worker-b",
    );
    expect(wrongWorkerCompletion).toBeNull();

    const completed = await service.markClaimedRunDispatchCompleted(
      reclaimedExpiredLease[0].id,
      "worker-c",
      { error: "done" },
    );
    expect(completed).toMatchObject({
      status: "completed",
      leasedBy: null,
      error: "done",
    });
  });
});
