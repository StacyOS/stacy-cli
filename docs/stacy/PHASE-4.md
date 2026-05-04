# Stacy Phase 4

Phase 4 hardens the local Codex and Claude adapters before Stacy trusts real
worker-owned execution by default. The goal is not more adapters. The goal is
for every real run to explain what happened, what session it used, what it
cost, whether it is retryable, and what raw result data backed those claims.

## Phase 4 Acceptance Target

A local developer can run Stacy with Codex or Claude, assign work through the
worker-owned path, and trust the run record without opening adapter code:

- session id and resume metadata are captured consistently
- usage and cost are preserved on successful and failed runs
- retry windows are extracted for transient quota/upstream failures
- deterministic adapter failures are not mislabeled as transient
- raw result metadata remains available for debugging
- contract tests protect Codex and Claude stream parsing behavior

## Completed In This Slice

- Hardened Codex server parsing to preserve:
  - `total_cost_usd`
  - completed-turn raw result JSON
  - failed-turn raw result JSON
  - failed-turn usage
  - snake_case and camelCase usage fields
- Wired Codex execution results to surface parsed cost and raw result metadata
  instead of dropping cost on the floor.
- Added Codex parser contracts for completed-run cost metadata and failed-run
  usage/cost capture.
- Added Claude parser contracts for session, model, usage, cost, summary, and
  raw result metadata.
- Added Claude fallback contract for assistant-text summaries when no final
  result event is emitted.
- Added fake-CLI execute contracts proving Codex and Claude execution results
  carry parsed session, provider, billing type, usage, cost, summary, and raw
  result metadata into the adapter result.
- Added stale-session execute contracts proving Codex and Claude retry a dead
  saved session with a fresh session and return the fresh result.
- Added a shared adapter failure taxonomy in `@arpanstacy/stacy-adapter-utils` for:
  transient upstream, auth required, unknown session, max turns, validation,
  timeout, and cancelled.
- Wired shared `errorFamily` values into Codex and Claude execution results for
  timeout, auth required, unknown session, and transient upstream failures.
- Wired Claude max-turns failures to `errorCode=claude_max_turns`,
  `errorFamily=max_turns`, and session clearing.
- Wired identifiable Codex validation/configuration failures to
  `errorCode=codex_validation` and `errorFamily=validation`.
- Isolated Claude execute tests from the developer home directory by forcing
  the managed prompt cache under a temporary `STACY_HOME`.
- Added opt-in real local smoke profiles:
  - `pnpm smoke:codex-local-preflight`
  - `pnpm smoke:claude-local-preflight`
  - `pnpm smoke:phase4-local-adapters-preflight`
  - `pnpm smoke:codex-local-real`
  - `pnpm smoke:claude-local-real`
  - `pnpm smoke:phase4-local-adapters`
- Added a billing guard to real local smoke profiles. Real Codex/Claude
  invocation requires `STACY_REAL_SMOKE_ALLOW_BILLING=1`, while preflight checks
  remain non-billable.

## Adapter Contract

Every local coding adapter should normalize the same trust payload:

```text
sessionId
sessionParams
summary
usage.inputTokens
usage.cachedInputTokens
usage.outputTokens
costUsd
errorCode
errorFamily
retryNotBefore
resultJson
```

The cockpit and cost ledger should be able to consume this payload without
adapter-specific parsing.

## Failure Taxonomy

| Family | Retry Default | Clears Session | Operator Action |
| --- | --- | --- | --- |
| `transient_upstream` | yes | no | wait or retry |
| `auth_required` | no | no | reauthenticate |
| `unknown_session` | yes | yes | retry fresh session |
| `max_turns` | no | yes | revise task or limits |
| `validation` | no | no | fix configuration |
| `timeout` | no | no | inspect timeout |
| `cancelled` | no | no | none |

Adapter-specific `errorCode` values can remain provider-specific, but the
shared `errorFamily` must use this taxonomy when a family is known.

## Real Local Smokes

Preflight commands are non-billable. They check that the configured local CLI is
reachable and print the detected version plus auth hints.

```bash
pnpm smoke:codex-local-preflight
pnpm smoke:claude-local-preflight
pnpm smoke:phase4-local-adapters-preflight
```

Real smoke commands invoke real local CLIs and may use authenticated accounts or
billable API usage. They are not part of the deterministic test suite and they
refuse to run unless billing/account usage is explicitly allowed.

```bash
STACY_REAL_SMOKE_ALLOW_BILLING=1 pnpm smoke:codex-local-real
STACY_REAL_SMOKE_ALLOW_BILLING=1 pnpm smoke:claude-local-real
STACY_REAL_SMOKE_ALLOW_BILLING=1 pnpm smoke:phase4-local-adapters
```

Useful overrides:

```bash
STACY_CODEX_COMMAND=/path/to/codex STACY_REAL_SMOKE_ALLOW_BILLING=1 pnpm smoke:codex-local-real
STACY_CLAUDE_COMMAND=/path/to/claude STACY_REAL_SMOKE_ALLOW_BILLING=1 pnpm smoke:claude-local-real
STACY_SMOKE_TIMEOUT_SEC=120 STACY_REAL_SMOKE_ALLOW_BILLING=1 pnpm smoke:phase4-local-adapters
```

## Remaining Phase 4 Targets

- Run the real local Codex and Claude smoke profiles on an authenticated
  operator machine.
- Keep `direct` as the default dispatch mode until real local smokes pass.
