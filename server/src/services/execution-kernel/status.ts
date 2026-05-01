import {
  HEARTBEAT_RUN_STATUSES,
  WAKEUP_REQUEST_STATUSES,
  type HeartbeatRunStatus,
  type WakeupRequestStatus,
} from "@paperclipai/shared";

export type ActiveHeartbeatRunStatus = Extract<
  HeartbeatRunStatus,
  "queued" | "running" | "scheduled_retry"
>;
export type CoveringHeartbeatRunStatus = Extract<HeartbeatRunStatus, "queued" | "running">;
export type TerminalHeartbeatRunStatus = Exclude<HeartbeatRunStatus, ActiveHeartbeatRunStatus>;
export type UnsuccessfulTerminalHeartbeatRunStatus = Extract<
  TerminalHeartbeatRunStatus,
  "failed" | "timed_out"
>;
export type ActiveWakeupRequestStatus = Extract<
  WakeupRequestStatus,
  "queued" | "deferred_issue_execution" | "claimed"
>;
export type PendingWakeupRequestStatus = Extract<
  WakeupRequestStatus,
  "queued" | "deferred_issue_execution"
>;

export const ACTIVE_HEARTBEAT_RUN_STATUSES: ActiveHeartbeatRunStatus[] = [
  "queued",
  "running",
  "scheduled_retry",
];
export const COVERING_HEARTBEAT_RUN_STATUSES: CoveringHeartbeatRunStatus[] = [
  "queued",
  "running",
];
export const EXECUTION_PATH_HEARTBEAT_RUN_STATUSES = ACTIVE_HEARTBEAT_RUN_STATUSES;
export const CANCELLABLE_HEARTBEAT_RUN_STATUSES: ActiveHeartbeatRunStatus[] = [
  ...ACTIVE_HEARTBEAT_RUN_STATUSES,
];
export const HEARTBEAT_RUN_TERMINAL_STATUSES: TerminalHeartbeatRunStatus[] = [
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
];
export const UNSUCCESSFUL_HEARTBEAT_RUN_TERMINAL_STATUSES: UnsuccessfulTerminalHeartbeatRunStatus[] = [
  "failed",
  "timed_out",
];
export const INITIAL_HEARTBEAT_RUN_STATUSES: ActiveHeartbeatRunStatus[] = [
  "queued",
  "scheduled_retry",
];
export const HEARTBEAT_RUN_STATUS_TRANSITIONS = {
  queued: ["running", "cancelled"],
  scheduled_retry: ["queued", "cancelled"],
  running: ["succeeded", "failed", "cancelled", "timed_out"],
  succeeded: [],
  failed: [],
  cancelled: [],
  timed_out: [],
} satisfies Record<HeartbeatRunStatus, readonly HeartbeatRunStatus[]>;
export const ACTIVE_WAKEUP_REQUEST_STATUSES: ActiveWakeupRequestStatus[] = [
  "queued",
  "deferred_issue_execution",
  "claimed",
];
export const PENDING_WAKEUP_REQUEST_STATUSES: PendingWakeupRequestStatus[] = [
  "queued",
  "deferred_issue_execution",
];

const heartbeatRunStatusSet = new Set<string>(HEARTBEAT_RUN_STATUSES);
const wakeupRequestStatusSet = new Set<string>(WAKEUP_REQUEST_STATUSES);
const activeHeartbeatRunStatusSet = new Set<string>(ACTIVE_HEARTBEAT_RUN_STATUSES);
const coveringHeartbeatRunStatusSet = new Set<string>(COVERING_HEARTBEAT_RUN_STATUSES);
const cancellableHeartbeatRunStatusSet = new Set<string>(CANCELLABLE_HEARTBEAT_RUN_STATUSES);
const terminalHeartbeatRunStatusSet = new Set<string>(HEARTBEAT_RUN_TERMINAL_STATUSES);
const unsuccessfulHeartbeatRunTerminalStatusSet = new Set<string>(
  UNSUCCESSFUL_HEARTBEAT_RUN_TERMINAL_STATUSES,
);
const activeWakeupRequestStatusSet = new Set<string>(ACTIVE_WAKEUP_REQUEST_STATUSES);
const pendingWakeupRequestStatusSet = new Set<string>(PENDING_WAKEUP_REQUEST_STATUSES);

function isStringInSet<T extends string>(set: Set<string>, value: unknown): value is T {
  return typeof value === "string" && set.has(value);
}

export function isHeartbeatRunStatus(value: unknown): value is HeartbeatRunStatus {
  return isStringInSet<HeartbeatRunStatus>(heartbeatRunStatusSet, value);
}

export function isActiveHeartbeatRunStatus(value: unknown): value is ActiveHeartbeatRunStatus {
  return isStringInSet<ActiveHeartbeatRunStatus>(activeHeartbeatRunStatusSet, value);
}

export function isCoveringHeartbeatRunStatus(value: unknown): value is CoveringHeartbeatRunStatus {
  return isStringInSet<CoveringHeartbeatRunStatus>(coveringHeartbeatRunStatusSet, value);
}

export function isCancellableHeartbeatRunStatus(
  value: unknown,
): value is ActiveHeartbeatRunStatus {
  return isStringInSet<ActiveHeartbeatRunStatus>(cancellableHeartbeatRunStatusSet, value);
}

export function isTerminalHeartbeatRunStatus(value: unknown): value is TerminalHeartbeatRunStatus {
  return isStringInSet<TerminalHeartbeatRunStatus>(terminalHeartbeatRunStatusSet, value);
}

export function getAllowedHeartbeatRunStatusTransitions(
  fromStatus: HeartbeatRunStatus | null,
  opts?: { allowNoop?: boolean },
): HeartbeatRunStatus[] {
  const transitions: HeartbeatRunStatus[] = fromStatus === null
    ? [...INITIAL_HEARTBEAT_RUN_STATUSES]
    : [...HEARTBEAT_RUN_STATUS_TRANSITIONS[fromStatus]];

  if (opts?.allowNoop && fromStatus !== null && !transitions.includes(fromStatus)) {
    transitions.push(fromStatus);
  }

  return transitions;
}

export function isAllowedHeartbeatRunStatusTransition(
  fromStatus: HeartbeatRunStatus | null,
  toStatus: HeartbeatRunStatus,
  opts?: { allowNoop?: boolean },
) {
  return getAllowedHeartbeatRunStatusTransitions(fromStatus, opts).includes(toStatus);
}

export function allowedHeartbeatRunTransitionSources(
  toStatus: HeartbeatRunStatus,
  opts?: { allowNoop?: boolean },
): HeartbeatRunStatus[] {
  return HEARTBEAT_RUN_STATUSES.filter((fromStatus) =>
    isAllowedHeartbeatRunStatusTransition(fromStatus, toStatus, opts),
  );
}

export function formatHeartbeatRunStatusTransition(
  fromStatus: HeartbeatRunStatus | null,
  toStatus: HeartbeatRunStatus,
) {
  return `${fromStatus ?? "created"} -> ${toStatus}`;
}

export function isUnsuccessfulHeartbeatRunTerminalStatus(
  value: unknown,
): value is UnsuccessfulTerminalHeartbeatRunStatus {
  return isStringInSet<UnsuccessfulTerminalHeartbeatRunStatus>(
    unsuccessfulHeartbeatRunTerminalStatusSet,
    value,
  );
}

export function isWakeupRequestStatus(value: unknown): value is WakeupRequestStatus {
  return isStringInSet<WakeupRequestStatus>(wakeupRequestStatusSet, value);
}

export function isActiveWakeupRequestStatus(value: unknown): value is ActiveWakeupRequestStatus {
  return isStringInSet<ActiveWakeupRequestStatus>(activeWakeupRequestStatusSet, value);
}

export function isPendingWakeupRequestStatus(value: unknown): value is PendingWakeupRequestStatus {
  return isStringInSet<PendingWakeupRequestStatus>(pendingWakeupRequestStatusSet, value);
}
