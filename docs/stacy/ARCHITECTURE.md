# Stacy Architecture

Stacy is a trust-first AI company control plane. It is forked from Paperclip,
but the product target is narrower: dependable autonomous work execution for an
operator who wants durable tasks, visible agent activity, hard stops, and clear
audit trails.

## CTO Priorities

1. Reliability before breadth.
2. Safe execution before more adapters.
3. Clear task ownership before fancy org charts.
4. Auditability before autonomy.
5. Fast local setup before cloud complexity.

## System Shape

The upstream foundation is useful and should not be thrown away:

```text
React UI + CLI
      |
Node/TypeScript API
      |
Postgres domain model
      |
Heartbeat/run queue
      |
Agent adapter layer
      |
Codex / Claude / Cursor / HTTP / process runtimes
```

Stacy hardens the execution path:

```text
Stacy UI / CLI
      |
API Gateway + Auth
      |
Domain API
      |
Postgres
      |
Outbox + Job Queue
      |
Run Orchestrator
      |
Sandboxed Worker
      |
Agent Adapter
      |
Codex / Claude / HTTP
```

## Core Domains

- Companies: tenant boundary, budgets, settings, membership.
- Agents: role, title, adapter, permissions, budget, runtime policy.
- Projects: repo/workspace configuration and execution environment policy.
- Issues: durable task ownership, status, parent-child planning, blockers.
- Runs: immutable execution attempts with status, logs, usage, and result.
- Costs: token/cost events linked to company, agent, project, issue, and run.
- Approvals: explicit signoff before risky or expensive work continues.
- Secrets: scoped runtime injection with redaction and audit events.
- Activity: append-only operator-visible audit log.

## Execution State Machines

Issue lifecycle:

```text
backlog -> todo -> claimed -> running -> in_review -> done
                         \-> blocked
                         \-> failed
```

Run lifecycle:

```text
created -> queued -> running -> succeeded
                         |    -> failed
                         |    -> cancelled
                         |    -> timed_out

created -> scheduled_retry -> queued
created -> scheduled_retry -> cancelled
```

`created` is an audit concept, not a persisted run status. Claim leases are
metadata on `running` rows. Starting/finalizing remain timeline phases rather
than public database statuses until the queue worker split requires them.

Every important transition must be stored and safe to retry. Retrying the same
request must not start two agents, duplicate costs, or let two workers claim the
same task.

## Execution Kernel

The v1 kernel should use Postgres as the source of truth and move away from
ad-hoc in-process scheduling for critical work.

Preferred path:

- Use `pg-boss` plus a small domain outbox for run dispatch.
- Keep the domain database and queue in the same Postgres instance for v1.
- Use leases and idempotency keys for every run claim and state transition.
- Store full logs outside hot run rows, with bounded excerpts in Postgres.
- Keep a single kill switch path that can cancel queued, leased, and running
  work.

Do not introduce Temporal or a distributed workflow engine in v1. That becomes
reasonable only when Stacy needs multi-node execution, long-lived workflow
history, or cloud-scale retries.

Current Phase 3 dispatch modes:

- `direct`: in-process heartbeat dispatch owns run claims.
- `shadow_worker`: the outbox records the same dispatch intent while direct
  dispatch still owns claims; worker ticks must find no stale duplicate work
  after direct claim completion.
- `worker_owned`: the outbox worker owns queued run dispatch through leased
  rows and the same run-claim guard.

The local worker-owned acceptance profile is:

```bash
pnpm smoke:heartbeat-worker-owned
```

## Adapter Scope

Stacy v1 should harden only the adapters needed for trustworthy coding work:

- Codex local
- Claude local
- HTTP
- Process, but treated as advanced/risky

Phase 4 treats adapter output as a stable trust contract. Codex and Claude must
normalize session identity, summary, usage, cost, retry windows, failure family,
and raw result metadata before worker-owned execution becomes the default local
path.

The real local adapter smoke profiles are:

```bash
pnpm smoke:codex-local-preflight
pnpm smoke:claude-local-preflight
pnpm smoke:phase4-local-adapters-preflight
STACY_REAL_SMOKE_ALLOW_BILLING=1 pnpm smoke:codex-local-real
STACY_REAL_SMOKE_ALLOW_BILLING=1 pnpm smoke:claude-local-real
STACY_REAL_SMOKE_ALLOW_BILLING=1 pnpm smoke:phase4-local-adapters
```

The `*-preflight` profiles are non-billable. The real profiles require explicit
account/API usage opt-in; without it, they stop after preflight.

Cursor, Gemini, OpenCode, OpenClaw, plugin adapters, and marketplace-style
extensions can remain in the codebase behind product flags until the cockpit and
execution kernel are dependable.

## Safety Model

Stacy should make these guarantees visible in the UI:

- Every running agent has a task, run, cost scope, and kill control.
- Every mutating action has an actor and an audit event.
- Risky execution can require an approval gate.
- Secrets are injected only for the run that needs them.
- Logs and prompts redact known secret values.
- Workspaces are isolated by task where possible.
- Budget hard stops cancel queued work and stop active work.

## Operator Cockpit

The first UI objective is not a large app surface. It is one trustworthy cockpit:

- Active runs
- Blocked work
- Failed runs
- Spend this month
- Agents paused by budget or error
- Pending approvals
- Recent risky actions
- Kill switch controls

This cockpit is the product. The rest of the app supports it.

## Non-Goals For V1

- Plugin marketplace
- Dozens of adapters
- Complex autonomous org redesign
- CEO chat
- Mobile app
- Cloud multi-region deployment
- Company template marketplace

These are deferred until the execution kernel earns trust.

## Distribution

Stacy needs a clean install path before it is a product:

- `npx stacy onboard`
- Docker image with persistent `/stacy`
- Docker quickstart smoke:
  - `pnpm smoke:docker-quickstart`
- Backup/restore commands:
  - `pnpm stacy db:backup`
  - `pnpm stacy db:restore ./backup.sql.gz --dry-run`
  - `pnpm stacy db:restore ./backup.sql.gz --yes`
- Migration and upgrade checks:
  - `pnpm stacy upgrade:check`
  - `pnpm stacy upgrade:check --strict`
- Upgrade notes between releases
- Clear self-hosted production guide

Until the CLI package is renamed, `pnpm stacy` is the preferred local command
and the upstream-compatible `paperclipai` command remains available as a
temporary bridge. The publishable CLI also exposes a `stacy` binary alias while
the npm package name decision remains open.

Phase 5 tracks this handoff work in `docs/stacy/PHASE-5.md`.
Self-hosted operator steps live in `docs/stacy/SELF-HOSTED-OPERATIONS.md`.
The public CLI package decision lives in
`docs/stacy/PUBLIC-CLI-PACKAGING.md`.
