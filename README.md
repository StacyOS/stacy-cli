# Stacy

Stacy is a trust-first AI company control plane built from the MIT-licensed
Stacy codebase.

The product direction is deliberately narrower than the upstream project:
Stacy should feel like Linear plus GitHub Actions plus an agent runtime console.
The goal is not maximum autonomy on day one. The goal is that an operator can
leave agents running overnight and still answer:

- What is every agent doing?
- What changed?
- What did it cost?
- Can I stop it?
- Did it touch secrets or risky systems?

## Product Principles

1. Reliability before breadth.
2. Safe execution before more adapters.
3. Clear task ownership before fancy org charts.
4. Auditability before autonomy.
5. Fast local setup before cloud complexity.

## What Stacy Keeps

Stacy keeps the useful control-plane foundation:

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
Codex / Claude / HTTP / process runtimes
```

The durable product concepts remain: companies, agents, goals, issues,
workspaces, runs, logs, costs, approvals, and live updates.

## What Stacy Changes

Stacy narrows the product around a safer execution kernel:

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

The first version prioritizes:

- Company dashboard
- Agents with roles, budgets, permissions, and adapter config
- Projects connected to repos/workspaces
- Issues/tasks with parent-child structure
- One-click assignment to an agent
- Run timeline with live logs
- Cost tracking per agent/task/project
- Approval gates before risky actions
- Pause/cancel/kill switch everywhere
- Local Codex and Claude adapters
- Git worktree isolation per task
- Secrets broker with redaction
- Docker/local sandbox mode by default

## Deferred On Purpose

These are intentionally not v1:

- Full plugin marketplace
- Dozens of adapters
- Complex autonomous org self-restructuring
- CEO chat
- Mobile app
- Cloud multi-region deployment
- Sophisticated company template marketplace

## Development

This repository is past the first fork-and-stabilize pass and is now hardening
the execution kernel. The public package graph is Stacy-owned under the
`@arpanstacy/*` npm scope and no longer depends on the Stacy package names.

```bash
pnpm install
pnpm dev
```

The Stacy CLI is available locally through the workspace script:

```bash
pnpm stacy onboard --yes
pnpm stacy run
```

For published installs, use the public wrapper package:

```bash
npx stacy-cli onboard
```

## Architecture

Read `docs/stacy/ARCHITECTURE.md` for the Stacy system design and
`docs/stacy/PHASE-1.md`, `docs/stacy/PHASE-2.md`,
`docs/stacy/PHASE-3.md`, `docs/stacy/PHASE-4.md`, and
`docs/stacy/PHASE-5.md` for implementation closeouts.
Self-hosted backup, restore, Docker smoke, and upgrade steps are in
`docs/stacy/SELF-HOSTED-OPERATIONS.md`.

## Attribution

Stacy is an MIT-licensed fork. The original license and copyright notice are
preserved in `LICENSE`.
