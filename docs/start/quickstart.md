---
title: Quickstart
summary: Get Stacy running in minutes
---

Get Stacy running locally in under 5 minutes.

## Quick Start

```sh
npx stacy-cli@latest onboard --yes
```

This walks you through setup, configures local data paths, and starts Stacy.

If you already have a Stacy install, rerunning `onboard` keeps your current
config and data paths intact. Use `stacy configure` if you want to edit
settings.

To start Stacy again later:

```sh
npx stacy-cli@latest run
```

> **Note:** The public npm package is `stacy-cli`; it exposes the `stacy`
> binary when installed. The `pnpm stacy` form only works inside a cloned copy
> of the Stacy repository.

## Local Development

For contributors working on Stacy itself. Prerequisites: Node.js 20+ and pnpm
9+.

Clone the repository, then:

```sh
pnpm install
pnpm dev
```

This starts the API server and UI at
[http://localhost:3100](http://localhost:3100).

No external database is required for local onboarding. Stacy uses an embedded
PostgreSQL instance by default.

When working from the cloned repo, you can also use:

```sh
pnpm stacy run
```

This auto-onboards if config is missing, runs health checks with auto-repair,
and starts the server.

## What's Next

Once Stacy is running:

1. Create your first company in the web UI.
2. Connect a project or local workspace.
3. Create a Codex or Claude agent and configure its adapter.
4. Set budgets, permissions, and approval gates.
5. Assign an initial task.
6. Watch the live run, inspect logs, and review cost and risk.

<Card title="Core Concepts" href="/start/core-concepts">
  Learn the key concepts behind Stacy
</Card>
