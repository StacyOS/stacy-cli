# CLI Reference

Stacy CLI now supports both:

- instance setup/diagnostics (`onboard`, `doctor`, `configure`, `env`, `allowed-hostname`, `env-lab`)
- control-plane client operations (issues, approvals, agents, activity, dashboard)

## Base Usage

Use repo script in development:

```sh
pnpm stacy --help
```

First-time local bootstrap + run:

```sh
pnpm stacy run
```

Choose local instance:

```sh
pnpm stacy run --instance dev
```

## Deployment Modes

Mode taxonomy and design intent are documented in `doc/DEPLOYMENT-MODES.md`.

Current CLI behavior:

- `stacy onboard` and `stacy configure --section server` set deployment mode in config
- server onboarding/configure ask for reachability intent and write `server.bind`
- `stacy run --bind <loopback|lan|tailnet>` passes a quickstart bind preset into first-run onboarding when config is missing
- runtime can override mode with `STACY_DEPLOYMENT_MODE`
- `stacy run` and `stacy doctor` still do not expose a direct low-level `--mode` flag

Canonical behavior is documented in `doc/DEPLOYMENT-MODES.md`.

Allow an authenticated/private hostname (for example custom Tailscale DNS):

```sh
pnpm stacy allowed-hostname dotta-macbook-pro
```

Bring up the default local SSH fixture for environment testing:

```sh
pnpm stacy env-lab up
pnpm stacy env-lab doctor
pnpm stacy env-lab status --json
pnpm stacy env-lab down
```

All client commands support:

- `--data-dir <path>`
- `--api-base <url>`
- `--api-key <token>`
- `--context <path>`
- `--profile <name>`
- `--json`

Company-scoped commands also support `--company-id <id>`.

Use `--data-dir` on any CLI command to isolate all default local state (config/context/db/logs/storage/secrets) away from `~/.stacy`:

```sh
pnpm stacy run --data-dir ./tmp/stacy-dev
pnpm stacy issue list --data-dir ./tmp/stacy-dev
```

## Context Profiles

Store local defaults in `~/.stacy/context.json`:

```sh
pnpm stacy context set --api-base http://localhost:3100 --company-id <company-id>
pnpm stacy context show
pnpm stacy context list
pnpm stacy context use default
```

To avoid storing secrets in context, set `apiKeyEnvVarName` and keep the key in env:

```sh
pnpm stacy context set --api-key-env-var-name STACY_API_KEY
export STACY_API_KEY=...
```

## Company Commands

```sh
pnpm stacy company list
pnpm stacy company get <company-id>
pnpm stacy company delete <company-id-or-prefix> --yes --confirm <same-id-or-prefix>
```

Examples:

```sh
pnpm stacy company delete PAP --yes --confirm PAP
pnpm stacy company delete 5cbe79ee-acb3-4597-896e-7662742593cd --yes --confirm 5cbe79ee-acb3-4597-896e-7662742593cd
```

Notes:

- Deletion is server-gated by `STACY_ENABLE_COMPANY_DELETION`.
- With agent authentication, company deletion is company-scoped. Use the current company ID/prefix (for example via `--company-id` or `STACY_COMPANY_ID`), not another company.

## Issue Commands

```sh
pnpm stacy issue list --company-id <company-id> [--status todo,in_progress] [--assignee-agent-id <agent-id>] [--match text]
pnpm stacy issue get <issue-id-or-identifier>
pnpm stacy issue create --company-id <company-id> --title "..." [--description "..."] [--status todo] [--priority high]
pnpm stacy issue update <issue-id> [--status in_progress] [--comment "..."]
pnpm stacy issue comment <issue-id> --body "..." [--reopen]
pnpm stacy issue checkout <issue-id> --agent-id <agent-id> [--expected-statuses todo,backlog,blocked]
pnpm stacy issue release <issue-id>
```

## Agent Commands

```sh
pnpm stacy agent list --company-id <company-id>
pnpm stacy agent get <agent-id>
pnpm stacy agent local-cli <agent-id-or-shortname> --company-id <company-id>
```

`agent local-cli` is the quickest way to run local Claude/Codex manually as a Stacy agent:

- creates a new long-lived agent API key
- installs missing Stacy skills into `~/.codex/skills` and `~/.claude/skills`
- prints `export ...` lines for `STACY_API_URL`, `STACY_COMPANY_ID`, `STACY_AGENT_ID`, and `STACY_API_KEY`

Example for shortname-based local setup:

```sh
pnpm stacy agent local-cli codexcoder --company-id <company-id>
pnpm stacy agent local-cli claudecoder --company-id <company-id>
```

## Approval Commands

```sh
pnpm stacy approval list --company-id <company-id> [--status pending]
pnpm stacy approval get <approval-id>
pnpm stacy approval create --company-id <company-id> --type hire_agent --payload '{"name":"..."}' [--issue-ids <id1,id2>]
pnpm stacy approval approve <approval-id> [--decision-note "..."]
pnpm stacy approval reject <approval-id> [--decision-note "..."]
pnpm stacy approval request-revision <approval-id> [--decision-note "..."]
pnpm stacy approval resubmit <approval-id> [--payload '{"...":"..."}']
pnpm stacy approval comment <approval-id> --body "..."
```

## Activity Commands

```sh
pnpm stacy activity list --company-id <company-id> [--agent-id <agent-id>] [--entity-type issue] [--entity-id <id>]
```

## Dashboard Commands

```sh
pnpm stacy dashboard get --company-id <company-id>
```

## Heartbeat Command

`heartbeat run` now also supports context/api-key options and uses the shared client stack:

```sh
pnpm stacy heartbeat run --agent-id <agent-id> [--api-base http://localhost:3100] [--api-key <token>]
```

## Local Storage Defaults

Default local instance root is `~/.stacy/instances/default`:

- config: `~/.stacy/instances/default/config.json`
- embedded db: `~/.stacy/instances/default/db`
- logs: `~/.stacy/instances/default/logs`
- storage: `~/.stacy/instances/default/data/storage`
- secrets key: `~/.stacy/instances/default/secrets/master.key`

Override base home or instance with env vars:

```sh
STACY_HOME=/custom/home STACY_INSTANCE_ID=dev pnpm stacy run
```

## Storage Configuration

Configure storage provider and settings:

```sh
pnpm stacy configure --section storage
```

Supported providers:

- `local_disk` (default; local single-user installs)
- `s3` (S3-compatible object storage)
