import { describe, expect, it } from "vitest";
import { HEARTBEAT_RUN_STATUSES, WAKEUP_REQUEST_STATUSES } from "@paperclipai/shared";
import {
  ACTIVE_HEARTBEAT_RUN_STATUSES,
  ACTIVE_WAKEUP_REQUEST_STATUSES,
  CANCELLABLE_HEARTBEAT_RUN_STATUSES,
  COVERING_HEARTBEAT_RUN_STATUSES,
  HEARTBEAT_RUN_STATUS_TRANSITIONS,
  HEARTBEAT_RUN_TERMINAL_STATUSES,
  INITIAL_HEARTBEAT_RUN_STATUSES,
  PENDING_WAKEUP_REQUEST_STATUSES,
  UNSUCCESSFUL_HEARTBEAT_RUN_TERMINAL_STATUSES,
  allowedHeartbeatRunTransitionSources,
  formatHeartbeatRunStatusTransition,
  getAllowedHeartbeatRunStatusTransitions,
  isAllowedHeartbeatRunStatusTransition,
  isActiveHeartbeatRunStatus,
  isActiveWakeupRequestStatus,
  isCancellableHeartbeatRunStatus,
  isCoveringHeartbeatRunStatus,
  isHeartbeatRunStatus,
  isPendingWakeupRequestStatus,
  isTerminalHeartbeatRunStatus,
  isUnsuccessfulHeartbeatRunTerminalStatus,
  isWakeupRequestStatus,
} from "../services/execution-kernel/status.ts";

describe("execution kernel status registry", () => {
  it("partitions heartbeat run statuses into active and terminal states", () => {
    const categorized = new Set([
      ...ACTIVE_HEARTBEAT_RUN_STATUSES,
      ...HEARTBEAT_RUN_TERMINAL_STATUSES,
    ]);

    expect(HEARTBEAT_RUN_STATUSES.filter((status) => !categorized.has(status))).toEqual([]);
    expect(ACTIVE_HEARTBEAT_RUN_STATUSES.filter(isTerminalHeartbeatRunStatus)).toEqual([]);
    expect(HEARTBEAT_RUN_TERMINAL_STATUSES.filter(isActiveHeartbeatRunStatus)).toEqual([]);
    expect(HEARTBEAT_RUN_STATUSES.filter(isActiveHeartbeatRunStatus)).toEqual([
      "queued",
      "scheduled_retry",
      "running",
    ]);
    expect(HEARTBEAT_RUN_STATUSES.filter(isTerminalHeartbeatRunStatus)).toEqual([
      "succeeded",
      "failed",
      "cancelled",
      "timed_out",
    ]);
  });

  it("keeps cancellation aligned with active heartbeat execution states", () => {
    expect(new Set(CANCELLABLE_HEARTBEAT_RUN_STATUSES)).toEqual(
      new Set(ACTIVE_HEARTBEAT_RUN_STATUSES),
    );
    expect(HEARTBEAT_RUN_STATUSES.filter(isCancellableHeartbeatRunStatus)).toEqual([
      "queued",
      "scheduled_retry",
      "running",
    ]);
    expect(isCancellableHeartbeatRunStatus("succeeded")).toBe(false);
    expect(isCancellableHeartbeatRunStatus("cancelled")).toBe(false);
  });

  it("distinguishes covered blocker work from scheduled retry ownership", () => {
    expect(COVERING_HEARTBEAT_RUN_STATUSES).toEqual(["queued", "running"]);
    expect(HEARTBEAT_RUN_STATUSES.filter(isCoveringHeartbeatRunStatus)).toEqual([
      "queued",
      "running",
    ]);
    expect(isActiveHeartbeatRunStatus("scheduled_retry")).toBe(true);
    expect(isCoveringHeartbeatRunStatus("scheduled_retry")).toBe(false);
  });

  it("separates unsuccessful terminal runs from controlled terminal outcomes", () => {
    expect(UNSUCCESSFUL_HEARTBEAT_RUN_TERMINAL_STATUSES).toEqual(["failed", "timed_out"]);
    expect(HEARTBEAT_RUN_STATUSES.filter(isUnsuccessfulHeartbeatRunTerminalStatus)).toEqual([
      "failed",
      "timed_out",
    ]);
    expect(isUnsuccessfulHeartbeatRunTerminalStatus("succeeded")).toBe(false);
    expect(isUnsuccessfulHeartbeatRunTerminalStatus("cancelled")).toBe(false);
  });

  it("classifies wakeup requests by pending queue and active execution ownership", () => {
    expect(PENDING_WAKEUP_REQUEST_STATUSES).toEqual(["queued", "deferred_issue_execution"]);
    expect(ACTIVE_WAKEUP_REQUEST_STATUSES).toEqual([
      "queued",
      "deferred_issue_execution",
      "claimed",
    ]);
    expect(WAKEUP_REQUEST_STATUSES.filter(isPendingWakeupRequestStatus)).toEqual([
      "queued",
      "deferred_issue_execution",
    ]);
    expect(WAKEUP_REQUEST_STATUSES.filter(isActiveWakeupRequestStatus)).toEqual([
      "queued",
      "deferred_issue_execution",
      "claimed",
    ]);
  });

  it("rejects unknown status strings at the kernel boundary", () => {
    expect(isHeartbeatRunStatus("lost")).toBe(false);
    expect(isWakeupRequestStatus("lost")).toBe(false);
    expect(isActiveHeartbeatRunStatus(null)).toBe(false);
    expect(isPendingWakeupRequestStatus(undefined)).toBe(false);
  });

  it("defines the legal heartbeat run state machine edges", () => {
    expect(INITIAL_HEARTBEAT_RUN_STATUSES).toEqual(["queued", "scheduled_retry"]);
    expect(HEARTBEAT_RUN_STATUS_TRANSITIONS).toEqual({
      queued: ["running", "cancelled"],
      scheduled_retry: ["queued", "cancelled"],
      running: ["succeeded", "failed", "cancelled", "timed_out"],
      succeeded: [],
      failed: [],
      cancelled: [],
      timed_out: [],
    });

    expect(getAllowedHeartbeatRunStatusTransitions(null)).toEqual(["queued", "scheduled_retry"]);
    expect(isAllowedHeartbeatRunStatusTransition(null, "queued")).toBe(true);
    expect(isAllowedHeartbeatRunStatusTransition(null, "failed")).toBe(false);
    expect(isAllowedHeartbeatRunStatusTransition("queued", "running")).toBe(true);
    expect(isAllowedHeartbeatRunStatusTransition("queued", "failed")).toBe(false);
    expect(isAllowedHeartbeatRunStatusTransition("scheduled_retry", "queued")).toBe(true);
    expect(isAllowedHeartbeatRunStatusTransition("scheduled_retry", "running")).toBe(false);
    expect(isAllowedHeartbeatRunStatusTransition("running", "succeeded")).toBe(true);
    expect(isAllowedHeartbeatRunStatusTransition("running", "timed_out")).toBe(true);
    expect(isAllowedHeartbeatRunStatusTransition("succeeded", "running")).toBe(false);
    expect(isAllowedHeartbeatRunStatusTransition("failed", "cancelled")).toBe(false);
  });

  it("allows same-status guarded writes without treating them as transitions", () => {
    expect(isAllowedHeartbeatRunStatusTransition("failed", "failed")).toBe(false);
    expect(isAllowedHeartbeatRunStatusTransition("failed", "failed", { allowNoop: true })).toBe(true);
    expect(allowedHeartbeatRunTransitionSources("failed", { allowNoop: true })).toEqual([
      "running",
      "failed",
    ]);
    expect(allowedHeartbeatRunTransitionSources("cancelled", { allowNoop: true })).toEqual([
      "queued",
      "scheduled_retry",
      "running",
      "cancelled",
    ]);
    expect(formatHeartbeatRunStatusTransition(null, "queued")).toBe("created -> queued");
    expect(formatHeartbeatRunStatusTransition("running", "failed")).toBe("running -> failed");
  });
});
