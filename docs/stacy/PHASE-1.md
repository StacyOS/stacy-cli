# Stacy Phase 1

Phase 1 is fork-and-stabilize. The goal is to create a Stacy base that still
builds like upstream Paperclip while clearly pointing engineering effort toward
the trust-first product.

## Completed In This Slice

- Cloned the upstream Paperclip repository into a separate `stacy/` checkout.
- Created `codex/stacy-foundation` for Stacy-specific work.
- Replaced the top-level README with Stacy product direction.
- Added this Stacy architecture source of truth.
- Added a root `pnpm stacy` script as a bridge to the current CLI.
- Updated the CLI and server startup banners to say Stacy.
- Updated the browser title and PWA name to Stacy.
- Verified the Phase 1 local run path through the API:
  - start Stacy locally
  - create a company
  - create and approve a Codex local agent
  - assign an issue
  - observe the live run and log stream
  - cancel the run
  - verify live runs stay empty after one heartbeat interval
  - inspect the dashboard and cost summary
- Fixed cancellation recovery behavior so a cancelled run does not automatically
  create continuation or stranded-work recovery tasks.
- Added `STACY_*` environment aliases across CLI, server startup, and adapter
  runtime injection while preserving `PAPERCLIP_*` compatibility.
- Cleaned known Codex local plugin/rollout warning noise from live run logs
  without hiding real adapter failures.
- Added zero-dollar subscription-included cost events so local Codex runs are
  visible in the ledger even when token usage is unavailable.
- Added the Stacy cockpit summary to the dashboard: live/cancellable runs,
  recent failures/cancellations, budget utilization, and risk signals.
- Fixed stale-company skill inventory requests so invalid company IDs return a
  clear 404 instead of a database foreign-key failure.

## Phase 1 Acceptance Notes

Latest smoke test used:

```bash
STACY_HOME=/tmp/stacy-phase1-home-final PORT=3201 pnpm stacy onboard --yes
```

Observed result:

- Company creation worked.
- Codex local agent creation required board approval and then became available.
- Assigning a task auto-started a live run.
- The run log endpoint returned live Codex output.
- The local Codex account was quota-limited during the final smoke. Stacy
  captured the adapter failure, log file, usage metadata, and risk signal
  instead of failing silently.
- Cancelling the active retry marked it `cancelled` with
  `stopReason: cancelled`.
- After cancellation, the company had zero active live runs.
- Cost summary exposed budget and spend: `budgetCents: 2500`, `spendCents: 0`.
- Subscription-included Codex runs now still create a zero-cost ledger event,
  so the run appears in cost detail surfaces instead of disappearing from the
  financial history.
- Cost detail views showed `subscriptionRunCount: 6` for biller `chatgpt`.
- Dashboard cockpit showed `liveRuns: 0`, `cancelledRuns24h: 1`, `riskLevel:
  watch`, and risk reasons for blocked/failed work.
- Stale company skill inventory requests returned `404 Company not found`.
- Final closure probe on April 28, 2026 restarted the saved smoke instance,
  passed doctor with 9 checks, returned healthy API status, confirmed zero
  active runs, confirmed run logs remained inspectable, and confirmed cost/risk
  surfaces without reading code.

Phase 1 is complete for the local developer acceptance path. Remaining before
Phase 2:

- Decide whether Stacey should hide plugin marketplace surfaces by default in
  Phase 2 or keep them visible under an "advanced" affordance.
- Keep the internal `@paperclipai/*` package graph stable until the execution
  kernel hardening is complete.

## Keep Stable For Now

Do not mechanically rename all internal packages yet:

- `@paperclipai/server`
- `@paperclipai/ui`
- `@paperclipai/db`
- `@paperclipai/shared`
- `@paperclipai/*` adapter packages

That rename is mostly churn and creates a wide test burden before we have
changed the product behavior. Keep the internal graph stable until the kernel
and cockpit changes land.

## Phase 1 Build Tasks

1. Install dependencies and run baseline checks.
   - `pnpm install`
   - `pnpm test`
   - `pnpm typecheck`

2. Add a product capability flag layer. *(Phase 2 candidate)*
   - Default Stacy mode hides plugin marketplace surfaces.
   - Default Stacy mode emphasizes Codex, Claude, HTTP, and process adapters.
   - Advanced/experimental adapters stay reachable only behind settings.

3. Create the cockpit route. *(Started in Phase 1 dashboard summary; expand in Phase 2.)*
   - Active runs
   - Failed runs
   - Blocked issues
   - Pending approvals
   - Monthly spend
   - Paused/error agents
   - Kill controls

4. Start the execution-kernel hardening. *(Phase 2)*
   - Define the target run state machine in code.
   - Add idempotency-key requirements for wakeup/run creation.
   - Identify the current in-process scheduling points.
   - Choose `pg-boss` or `graphile-worker` for Postgres-backed dispatch.

5. Tighten workspace safety.
   - Make git worktree isolation the recommended default.
   - Surface workspace path and branch in the run UI.
   - Add rollback/cleanup notes to failed run summaries.

6. Tighten adapter contracts.
   - Codex local contract tests.
   - Claude local contract tests.
   - Error-family classification.
   - Session resume tests.
   - Cost/usage extraction tests.

7. Rename distribution only after the app is stable.
   - CLI package: `stacy`
   - Command: `stacy`
   - Docker volume: `/stacy`
   - Config home: `~/.stacy`
   - Environment aliases: keep `PAPERCLIP_*` compatibility for at least one
     release while introducing `STACY_*`.

## Definition Of Done

Phase 1 is complete when a developer can run Stacy locally, create a company,
create a Codex or Claude agent, assign a task, see the live run, cancel it,
inspect logs, and understand the cost and risk surface without reading code.
