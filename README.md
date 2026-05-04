# Stacy

Stacy is a trust-first control plane for assigning, supervising, and auditing
AI agents.

It is built for operators who need more than a chat box: every agent has an
owner, a budget, a workspace, a run history, logs, approvals, and a visible stop
button. The first product promise is simple: you should know what each agent is
doing, what it changed, what it cost, and whether it touched anything risky.

![Stacy product cockpit](docs/images/stacy-product-screenshot-dark.png)

## Quick Start

Run Stacy from npm:

```bash
npx stacy-cli@latest onboard --yes
npx stacy-cli@latest run
```

The npm package is `stacy-cli`; it exposes the `stacy` command when installed.
Inside a cloned repository, use the workspace shortcut:

```bash
pnpm stacy onboard --yes
pnpm stacy run
```

Stacy starts the local UI and API at
[http://localhost:3100](http://localhost:3100).

## What You Get

- Company dashboard for agents, tasks, runs, approvals, spend, and risk
- Agents with roles, budgets, permissions, and adapter configuration
- Projects connected to local repos and workspaces
- Issues and tasks with parent-child structure
- One-click assignment to Codex, Claude, and other local adapters
- Live run timeline with logs, status, retries, and cancellation
- Cost tracking per agent, task, project, and run
- Approval gates before risky actions
- Git worktree isolation per task
- Secrets redaction and local sandbox defaults
- Backup, restore, upgrade, and Docker self-hosting guides

## Core Workflow

1. Create a company.
2. Connect a project or workspace.
3. Add a Codex or Claude agent with budgets and permissions.
4. Assign a task.
5. Watch the live run, inspect logs, and cancel when needed.
6. Review cost, risk, and output before marking the task done.

The product should feel like Linear plus GitHub Actions plus an agent runtime
console. Stacy keeps autonomy visible, interruptible, and auditable.

## Local Development

Prerequisites: Node.js 20+ and pnpm 9+.

```bash
pnpm install
pnpm dev
```

Useful local commands:

```bash
pnpm stacy onboard --yes
pnpm stacy doctor --repair --yes
pnpm stacy db:backup
pnpm stacy upgrade:check
```

## Documentation

- [Quickstart](docs/start/quickstart.md)
- [What is Stacy?](docs/start/what-is-stacy.md)
- [Architecture](docs/stacy/ARCHITECTURE.md)
- [Self-hosted operations](docs/stacy/SELF-HOSTED-OPERATIONS.md)
- [Public CLI packaging](docs/stacy/PUBLIC-CLI-PACKAGING.md)
- [Phase 5 release notes](docs/stacy/PHASE-5.md)

## License

Stacy is released under the MIT license. See [LICENSE](LICENSE).
