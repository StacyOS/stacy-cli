# Stacy Phase 2

Phase 2 is execution-kernel hardening. The goal is to make local autonomous
work dependable enough that Stacy can recover from duplicate clicks, server
restarts, lost process handles, stale queues, and cancellation races without
silently drifting away from the operator's intent.

## Completed In This Slice

- Added a shared execution-kernel status registry in
  `server/src/services/execution-kernel/status.ts`.
- Defined the legal heartbeat run state machine in code.
- Guarded `setRunStatus` so status writes only apply from legal source states.
- Added wakeup/run idempotency for repeated wakeup requests with the same
  idempotency key.
- Added durable run claim metadata:
  - `claimToken`
  - `claimOwner`
  - `claimLeasedAt`
  - `claimLeaseExpiresAt`
- Renewed running-run claims during execution and output flushes.
- Reaped abandoned running runs when their durable claim lease expires.
- Hardened cancellation so queued, scheduled retry, and running work share one
  guarded kill path.
- Added durable `status.transition` run events for important state moves.
- Kept transition audit events out of liveness/useful-work classification.
- Preserved cancellation race behavior: no cancel audit event is written unless
  the guarded status update actually wins.
- Kept subscription-included Codex runs visible in the cost ledger even when
  the billed amount is zero.
- Kept the Stacy cockpit summary focused on live runs, cancellable work, cost,
  and risk signals.

## Current Run State Machine

The database status machine now intentionally uses a smaller set of durable
states than the conceptual architecture:

```text
created -> queued -> running -> succeeded
                         |    -> failed
                         |    -> cancelled
                         |    -> timed_out

created -> scheduled_retry -> queued
created -> scheduled_retry -> cancelled
```

`created` is not a persisted status. It describes the moment a run row is
inserted. Claim lease details are persisted as metadata on `running` rows rather
than as a separate public `leased` status.

## In-Process Scheduling Points

These are the remaining scheduler entry points that Phase 3 can move behind a
Postgres-backed queue:

- `server/src/index.ts` startup recovery:
  `reapOrphanedRuns`, `promoteDueScheduledRetries`, `resumeQueuedRuns`,
  `reconcileStrandedAssignedIssues`, `reconcileIssueGraphLiveness`, and
  `scanSilentActiveRuns`.
- `server/src/index.ts` heartbeat interval:
  `tickTimers`, routine trigger ticks, periodic run reaping, scheduled retry
  promotion, queued run resume, issue-graph liveness reconciliation, and active
  run output watchdog scans.
- `server/src/services/heartbeat.ts` run dispatch:
  `startNextQueuedRunForAgent` claims queued rows and starts `executeRun` in
  the current process.
- `server/src/services/heartbeat.ts` running execution:
  `executeRun` owns adapter invocation, claim renewal, live log flushing,
  finalization, retry scheduling, cost writes, and issue release/promotion.
- `server/src/services/heartbeat.ts` scheduled retry lifecycle:
  transient failures create `scheduled_retry` rows and the heartbeat interval
  promotes due retries back to `queued`.
- `server/src/services/recovery/*` liveness recovery:
  recovery scans enqueue bounded follow-up work and create explicit recovery
  issues when automatic recovery is exhausted.
- `server/src/services/routines.ts` routine scheduler:
  scheduled routine triggers enqueue issue assignment wakeups.
- `server/src/app.ts` plugin job scheduler:
  plugin jobs already have a separate scheduler surface and should remain
  separate from heartbeat run dispatch unless the product merges job types
  later.

## Queue Decision

Use `pg-boss` for the first Postgres-backed heartbeat dispatch queue.

Reasoning:

- It keeps the queue in the same Postgres deployment as the Stacy domain data.
- It gives the execution kernel a boring worker/lease/retry primitive without
  introducing Temporal or another workflow control plane.
- It supports delayed work, which maps cleanly to `scheduled_retry` promotion.
- It is a smaller conceptual dependency than adopting the Graphile ecosystem
  only for queueing.

Phase 3 should introduce this with a small outbox first:

```text
domain transaction
      |
heartbeat_runs / agent_wakeup_requests
      |
heartbeat_dispatch_outbox
      |
pg-boss dispatch job
      |
worker claims run with existing claim-token guard
      |
executeRun
```

The outbox keeps domain writes atomic even if queue insertion fails. Once this
is stable, direct in-process calls to `startNextQueuedRunForAgent` can become
queue submissions instead of immediate execution.

## Product Decisions Closed

- Hide plugin marketplace-style surfaces by default for Stacy. Keep them
  reachable only through advanced/admin surfaces until the cockpit and kernel
  are dependable.
- Keep behavior stable during kernel work. The package graph now moves under
  Stacy-owned npm names because the public distribution story requires it.
- Keep Codex local, Claude local, HTTP, and process as the adapter focus. Treat
  process as advanced/risky. Leave Cursor, Gemini, OpenCode, OpenClaw, and
  plugin adapters available only as advanced/experimental surfaces.

## Verification

Latest Phase 2 verification:

```bash
pnpm exec vitest run server/src/__tests__/execution-kernel-status.test.ts
pnpm exec vitest run server/src/__tests__/heartbeat-wakeup-idempotency.test.ts server/src/__tests__/heartbeat-process-recovery.test.ts server/src/__tests__/heartbeat-run-claim-leases.test.ts server/src/__tests__/heartbeat-retry-scheduling.test.ts server/src/__tests__/agent-live-run-routes.test.ts
pnpm --filter @arpanstacy/stacy-server typecheck
git diff --check
```

Observed result:

- 8 execution-kernel status tests passed.
- 39 focused heartbeat/live-run integration tests passed.
- Server typecheck passed.
- Diff whitespace check passed.

## Phase 2 Closeout

Phase 2 is complete for the current local Stacy fork. The execution kernel now
has durable status definitions, guarded transitions, idempotent wakeup reuse,
claim leases, cancellation hardening, transition audits, and a documented
queue migration path.

The next phase is not more ad-hoc hardening. It is replacing direct in-process
run dispatch with the `pg-boss` outbox/worker path described above.
