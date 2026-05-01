export interface DashboardRunActivityDay {
  date: string;
  succeeded: number;
  failed: number;
  other: number;
  total: number;
}

export interface DashboardControlPlaneSummary {
  liveRuns: number;
  cancellableRuns: number;
  failedRuns24h: number;
  cancelledRuns24h: number;
  dispatchQueue: DashboardDispatchQueueSummary;
  riskLevel: "ok" | "watch" | "action";
  riskReasons: string[];
}

export interface DashboardDispatchQueueSummary {
  status: "clear" | "watch" | "action";
  pending: number;
  ready: number;
  leased: number;
  expiredLeases: number;
  failed: number;
  stalePending: number;
  oldestPendingAgeMs: number | null;
  oldestLeasedAgeMs: number | null;
}

export interface DashboardSummary {
  companyId: string;
  agents: {
    active: number;
    running: number;
    paused: number;
    error: number;
  };
  tasks: {
    open: number;
    inProgress: number;
    blocked: number;
    done: number;
  };
  costs: {
    monthSpendCents: number;
    monthBudgetCents: number;
    monthUtilizationPercent: number;
  };
  pendingApprovals: number;
  budgets: {
    activeIncidents: number;
    pendingApprovals: number;
    pausedAgents: number;
    pausedProjects: number;
  };
  controlPlane: DashboardControlPlaneSummary;
  runActivity: DashboardRunActivityDay[];
}
