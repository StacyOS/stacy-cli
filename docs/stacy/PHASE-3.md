# Stacy Phase 3

Phase 3 replaces direct in-process heartbeat run dispatch with a Postgres-backed
outbox and worker path. The first slices are intentionally shadow-mode: write
the durable dispatch request, let the existing in-process claimer continue doing
the work, and give operators a feature-flagged worker that can recover pending
dispatch rows without changing the default local developer path.

## Completed In This Slice

- Added `heartbeat_dispatch_outbox`.
- Added migration `0072_heartbeat_dispatch_outbox`.
- Exported the table from `@paperclipai/db`.
- Added `heartbeatDispatchOutboxService`.
- Added idempotent dispatch request creation keyed by run id.
- Added pending-dispatch listing for the future worker.
- Added completed/cancelled markers for active dispatch requests.
- Added lease-based worker claims with `FOR UPDATE SKIP LOCKED`.
- Added claimed-row complete/release/fail transitions scoped by `workerId`.
- Added a feature-flagged heartbeat dispatch worker.
- Added dispatch queue health summaries for dashboards and startup diagnostics:
  pending, ready, leased, expired leases, failed, stale pending, and oldest row
  ages.
- Added dashboard risk reasons for failed, expired, and stale dispatch work.
- Added a Stacy cockpit dispatch queue cell so operators can see queue health
  without reading database tables.
- Added a shadow-worker comparison regression that wakes a real heartbeat run,
  verifies direct in-process claim metadata, verifies the matching outbox row
  completes with `claimed_by_in_process_dispatch`, and confirms a worker tick
  has no stale pending work left to claim.
- Added a worker-owned Phase 2 smoke profile:
  `pnpm smoke:heartbeat-worker-owned`.
- Added `heartbeat-worker-owned-phase2-smoke.test.ts`, which runs a local
  wakeup through `worker_owned` dispatch and verifies idempotency, claim leases,
  transition audits, cost ledger writes, completed dispatch outbox state, and
  clear queue health.
- Added a public heartbeat `dispatchQueuedRun(runId)` entrypoint for worker
  dispatch.
- Added explicit heartbeat dispatch modes:
  - `direct` keeps the current in-process dispatch behavior.
  - `shadow_worker` starts the worker while direct dispatch still drives runs.
  - `worker_owned` queues runs through the outbox and lets the worker claim
    them.
- Added dispatch worker env flags:
  - `PAPERCLIP_HEARTBEAT_DISPATCH_MODE=direct|shadow_worker|worker_owned`
  - `PAPERCLIP_HEARTBEAT_DISPATCH_WORKER_ENABLED=true`
  - `PAPERCLIP_HEARTBEAT_DISPATCH_WORKER_INTERVAL_MS`
  - `PAPERCLIP_HEARTBEAT_DISPATCH_WORKER_BATCH_SIZE`
  - `PAPERCLIP_HEARTBEAT_DISPATCH_WORKER_LEASE_MS`
- Wired heartbeat queue creation paths to record dispatch requests:
  - normal wakeup enqueue
  - missing issue-comment retry
  - process-loss retry
  - scheduled retry promotion
  - deferred issue execution promotion
  - execution-path recovery
- Wired the current in-process claim path to mark the dispatch request
  completed once the queued run becomes `running`.
- Wired cancellation paths to cancel active dispatch requests.

## Shadow-Mode Contract

The current runtime still calls `startNextQueuedRunForAgent` directly. The new
outbox is therefore a durable preparation layer, not yet the executor.

Expected row lifecycle in shadow mode:

```text
pending -> completed
pending -> cancelled
pending -> leased -> completed
pending -> leased -> pending
pending -> leased -> failed
leased -> leased
```

The worker is disabled by default. When enabled, it consumes ready `pending`
rows, reclaims expired `leased` rows, dispatches the target queued run through
the same claim-token guard, and releases rows back to `pending` when the agent
has no concurrency slots.

## Local Smoke Profile

Run the worker-owned local profile with:

```bash
pnpm smoke:heartbeat-worker-owned
```

The profile sets:

```text
PAPERCLIP_HEARTBEAT_DISPATCH_MODE=worker_owned
PAPERCLIP_HEARTBEAT_DISPATCH_WORKER_ENABLED=true
PAPERCLIP_HEARTBEAT_DISPATCH_WORKER_INTERVAL_MS=1000
PAPERCLIP_HEARTBEAT_DISPATCH_WORKER_BATCH_SIZE=10
PAPERCLIP_HEARTBEAT_DISPATCH_WORKER_LEASE_MS=60000
```

## Queue Dependency Decision

Keep the lightweight outbox poller for the current local Stacy fork. `pg-boss`
is still the likely next queue dependency when Stacy needs higher queue volume,
multi-node workers, delayed job governance, or operational queue dashboards.
For this phase, the outbox worker plus explicit leases is enough to prove the
worker-owned execution path without adding another runtime dependency.

## Phase 3 Closeout

Phase 3 is complete for the current local Stacy fork. Do not remove the
in-process scheduler yet; keep `direct` as the default until the worker-owned
path has passed real local operator smokes against Codex/Claude adapters, not
only deterministic mocked-adapter tests.
