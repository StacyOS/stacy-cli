import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, approvals, companies, costEvents, heartbeatRuns, issues } from "@paperclipai/db";
import { notFound } from "../errors.js";
import { budgetService } from "./budgets.js";
import { ACTIVE_HEARTBEAT_RUN_STATUSES } from "./execution-kernel/status.js";
import { heartbeatDispatchOutboxService } from "./heartbeat-dispatch-outbox.js";

const DASHBOARD_RUN_ACTIVITY_DAYS = 14;

function formatUtcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function getUtcMonthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function getRecentUtcDateKeys(now: Date, days: number): string[] {
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: days }, (_, index) => {
    const dayOffset = index - (days - 1);
    return formatUtcDateKey(new Date(todayUtc + dayOffset * 24 * 60 * 60 * 1000));
  });
}

export function dashboardService(db: Db) {
  const budgets = budgetService(db);
  const dispatchOutbox = heartbeatDispatchOutboxService(db);
  return {
    summary: async (companyId: string) => {
      const company = await db
        .select()
        .from(companies)
        .where(eq(companies.id, companyId))
        .then((rows) => rows[0] ?? null);

      if (!company) throw notFound("Company not found");

      const agentRows = await db
        .select({ status: agents.status, count: sql<number>`count(*)` })
        .from(agents)
        .where(eq(agents.companyId, companyId))
        .groupBy(agents.status);

      const taskRows = await db
        .select({ status: issues.status, count: sql<number>`count(*)` })
        .from(issues)
        .where(eq(issues.companyId, companyId))
        .groupBy(issues.status);

      const pendingApprovals = await db
        .select({ count: sql<number>`count(*)` })
        .from(approvals)
        .where(and(eq(approvals.companyId, companyId), eq(approvals.status, "pending")))
        .then((rows) => Number(rows[0]?.count ?? 0));

      const agentCounts: Record<string, number> = {
        active: 0,
        running: 0,
        paused: 0,
        error: 0,
      };
      for (const row of agentRows) {
        const count = Number(row.count);
        // "idle" agents are operational — count them as active
        const bucket = row.status === "idle" ? "active" : row.status;
        agentCounts[bucket] = (agentCounts[bucket] ?? 0) + count;
      }

      const taskCounts: Record<string, number> = {
        open: 0,
        inProgress: 0,
        blocked: 0,
        done: 0,
      };
      for (const row of taskRows) {
        const count = Number(row.count);
        if (row.status === "in_progress") taskCounts.inProgress += count;
        if (row.status === "blocked") taskCounts.blocked += count;
        if (row.status === "done") taskCounts.done += count;
        if (row.status !== "done" && row.status !== "cancelled") taskCounts.open += count;
      }

      const now = new Date();
      const dispatchQueue = await dispatchOutbox.summarizeQueueHealth({ companyId, now });
      const monthStart = getUtcMonthStart(now);
      const runActivityDays = getRecentUtcDateKeys(now, DASHBOARD_RUN_ACTIVITY_DAYS);
      const runActivityStart = new Date(`${runActivityDays[0]}T00:00:00.000Z`);
      const [{ monthSpend }] = await db
        .select({
          monthSpend: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::double precision`,
        })
        .from(costEvents)
        .where(
          and(
            eq(costEvents.companyId, companyId),
            gte(costEvents.occurredAt, monthStart),
          ),
        );

      const monthSpendCents = Number(monthSpend);
      const runActivityDayExpr = sql<string>`to_char(${heartbeatRuns.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`;
      const runActivityRows = await db
        .select({
          date: runActivityDayExpr,
          status: heartbeatRuns.status,
          count: sql<number>`count(*)::double precision`,
        })
        .from(heartbeatRuns)
        .where(
          and(
            eq(heartbeatRuns.companyId, companyId),
            gte(heartbeatRuns.createdAt, runActivityStart),
          ),
        )
        .groupBy(runActivityDayExpr, heartbeatRuns.status);

      const runActivity = new Map(
        runActivityDays.map((date) => [
          date,
          { date, succeeded: 0, failed: 0, other: 0, total: 0 },
        ]),
      );
      for (const row of runActivityRows) {
        const bucket = runActivity.get(row.date);
        if (!bucket) continue;
        const count = Number(row.count);
        if (row.status === "succeeded") bucket.succeeded += count;
        else if (row.status === "failed" || row.status === "timed_out") bucket.failed += count;
        else bucket.other += count;
        bucket.total += count;
      }

      const utilization =
        company.budgetMonthlyCents > 0
          ? (monthSpendCents / company.budgetMonthlyCents) * 100
          : 0;
      const budgetOverview = await budgets.overview(companyId);
      const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const activeRunRows = await db
        .select({
          status: heartbeatRuns.status,
          count: sql<number>`count(*)::double precision`,
        })
        .from(heartbeatRuns)
        .where(
          and(
            eq(heartbeatRuns.companyId, companyId),
            inArray(heartbeatRuns.status, ACTIVE_HEARTBEAT_RUN_STATUSES),
          ),
        )
        .groupBy(heartbeatRuns.status);
      const recentTerminalRunRows = await db
        .select({
          status: heartbeatRuns.status,
          count: sql<number>`count(*)::double precision`,
        })
        .from(heartbeatRuns)
        .where(
          and(
            eq(heartbeatRuns.companyId, companyId),
            gte(heartbeatRuns.updatedAt, dayAgo),
            inArray(heartbeatRuns.status, ["failed", "timed_out", "cancelled"]),
          ),
        )
        .groupBy(heartbeatRuns.status);
      const activeRunCount = activeRunRows.reduce((sum, row) => sum + Number(row.count), 0);
      const failedRuns24h = recentTerminalRunRows
        .filter((row) => row.status === "failed" || row.status === "timed_out")
        .reduce((sum, row) => sum + Number(row.count), 0);
      const cancelledRuns24h = recentTerminalRunRows
        .filter((row) => row.status === "cancelled")
        .reduce((sum, row) => sum + Number(row.count), 0);
      const totalPendingApprovals = pendingApprovals + budgetOverview.pendingApprovalCount;
      const riskReasons: string[] = [];

      if (activeRunCount > 0) {
        riskReasons.push(`${activeRunCount} live run${activeRunCount === 1 ? "" : "s"} with cancel controls available`);
      }
      if (budgetOverview.activeIncidents.length > 0) {
        riskReasons.push(`${budgetOverview.activeIncidents.length} active budget incident${budgetOverview.activeIncidents.length === 1 ? "" : "s"}`);
      }
      if (agentCounts.error > 0) {
        riskReasons.push(`${agentCounts.error} agent${agentCounts.error === 1 ? "" : "s"} in error state`);
      }
      if (taskCounts.blocked > 0) {
        riskReasons.push(`${taskCounts.blocked} blocked task${taskCounts.blocked === 1 ? "" : "s"}`);
      }
      if (totalPendingApprovals > 0) {
        riskReasons.push(`${totalPendingApprovals} pending approval${totalPendingApprovals === 1 ? "" : "s"}`);
      }
      if (failedRuns24h > 0) {
        riskReasons.push(`${failedRuns24h} failed run${failedRuns24h === 1 ? "" : "s"} in the last 24h`);
      }
      if (dispatchQueue.failed > 0) {
        riskReasons.push(`${dispatchQueue.failed} failed dispatch request${dispatchQueue.failed === 1 ? "" : "s"}`);
      }
      if (dispatchQueue.expiredLeases > 0) {
        riskReasons.push(`${dispatchQueue.expiredLeases} expired dispatch lease${dispatchQueue.expiredLeases === 1 ? "" : "s"}`);
      }
      if (dispatchQueue.stalePending > 0) {
        riskReasons.push(`${dispatchQueue.stalePending} stale pending dispatch request${dispatchQueue.stalePending === 1 ? "" : "s"}`);
      }
      if (company.budgetMonthlyCents > 0 && utilization >= 80) {
        riskReasons.push(`${Number(utilization.toFixed(0))}% of monthly budget used`);
      }

      const riskLevel =
        budgetOverview.activeIncidents.length > 0 || agentCounts.error > 0 || dispatchQueue.status === "action"
          ? "action"
          : riskReasons.length > 0
            ? "watch"
            : "ok";

      return {
        companyId,
        agents: {
          active: agentCounts.active,
          running: agentCounts.running,
          paused: agentCounts.paused,
          error: agentCounts.error,
        },
        tasks: taskCounts,
        costs: {
          monthSpendCents,
          monthBudgetCents: company.budgetMonthlyCents,
          monthUtilizationPercent: Number(utilization.toFixed(2)),
        },
        pendingApprovals,
        budgets: {
          activeIncidents: budgetOverview.activeIncidents.length,
          pendingApprovals: budgetOverview.pendingApprovalCount,
          pausedAgents: budgetOverview.pausedAgentCount,
          pausedProjects: budgetOverview.pausedProjectCount,
        },
        controlPlane: {
          liveRuns: activeRunCount,
          cancellableRuns: activeRunCount,
          failedRuns24h,
          cancelledRuns24h,
          dispatchQueue,
          riskLevel,
          riskReasons,
        },
        runActivity: Array.from(runActivity.values()),
      };
    },
  };
}
