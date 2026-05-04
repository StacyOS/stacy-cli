import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { agents, companies, createDb, heartbeatRuns } from "@arpanstacy/stacy-db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { heartbeatService } from "../services/heartbeat.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres heartbeat run claim lease tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("heartbeat run claim leases", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("stacy-heartbeat-run-claim-leases-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.execute(sql.raw(`TRUNCATE TABLE "companies" CASCADE`));
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("fails abandoned running runs whose durable claim lease has expired", async () => {
    const now = new Date();
    const companyId = randomUUID();
    const agentId = randomUUID();
    const runId = randomUUID();
    const claimedAt = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const expiredAt = new Date(now.getTime() - 60 * 1000);

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
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      status: "running",
      invocationSource: "on_demand",
      triggerDetail: "manual",
      startedAt: claimedAt,
      claimToken: randomUUID(),
      claimOwner: "stacy-server:999999",
      claimLeasedAt: claimedAt,
      claimLeaseExpiresAt: expiredAt,
      updatedAt: claimedAt,
      contextSnapshot: { taskKey: "lease-expired" },
    });

    const result = await heartbeatService(db).reapOrphanedRuns({ staleThresholdMs: 0 });

    expect(result).toEqual({ reaped: 1, runIds: [runId] });
    const run = await db
      .select({
        status: heartbeatRuns.status,
        error: heartbeatRuns.error,
        errorCode: heartbeatRuns.errorCode,
        finishedAt: heartbeatRuns.finishedAt,
        resultJson: heartbeatRuns.resultJson,
      })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runId))
      .then((rows) => rows[0] ?? null);

    expect(run?.status).toBe("failed");
    expect(run?.errorCode).toBe("claim_lease_expired");
    expect(run?.error).toContain("Run claim lease expired");
    expect(run?.error).toContain("stacy-server:999999");
    expect(run?.finishedAt).toBeInstanceOf(Date);
    expect(run!.finishedAt!.getTime()).toBeGreaterThanOrEqual(now.getTime());
    expect(run?.resultJson).toMatchObject({
      stopReason: "adapter_failed",
    });
  });
});
