# Developing

This project can run fully in local dev without setting up PostgreSQL manually.

## Deployment Modes

For mode definitions and intended CLI behavior, see `doc/DEPLOYMENT-MODES.md`.

Current implementation status:

- canonical model: `local_trusted` and `authenticated` (with `private/public` exposure)

## Prerequisites

- Node.js 20+
- pnpm 9+

## Dependency Lockfile Policy

GitHub Actions owns `pnpm-lock.yaml`.

- Do not commit `pnpm-lock.yaml` in pull requests.
- Pull request CI validates dependency resolution when manifests change.
- Pushes to `master` regenerate `pnpm-lock.yaml` with `pnpm install --lockfile-only --no-frozen-lockfile`, commit it back if needed, and then run verification with `--frozen-lockfile`.

## Start Dev

From repo root:

```sh
pnpm install
pnpm dev
```

This starts:

- API server: `http://localhost:3100`
- UI: served by the API server in dev middleware mode (same origin as API)

`pnpm dev` runs the server in watch mode and restarts on changes from workspace packages (including adapter packages). Use `pnpm dev:once` to run without file watching.

`pnpm dev:once` auto-applies pending local migrations by default before starting the dev server.

`pnpm dev` and `pnpm dev:once` are now idempotent for the current repo and instance: if the matching Stacy dev runner is already alive, Stacy reports the existing process instead of starting a duplicate.

## Storybook

The board UI Storybook keeps stories and Storybook config under `ui/storybook/` so component review files stay out of the app source routes.

```sh
pnpm storybook
pnpm build-storybook
```

These run the `@arpanstacy/stacy-ui` Storybook on port `6006` and build the static output to `ui/storybook-static/`.

Inspect or stop the current repo's managed dev runner:

```sh
pnpm dev:list
pnpm dev:stop
```

`pnpm dev:once` now tracks backend-relevant file changes and pending migrations. When the current boot is stale, the board UI shows a `Restart required` banner. You can also enable guarded auto-restart in `Instance Settings > Experimental`, which waits for queued/running local agent runs to finish before restarting the dev server.

Tailscale/private-auth dev mode:

```sh
pnpm dev --bind lan
```

This runs dev as `authenticated/private` with a private-network bind preset.

For Tailscale-only reachability on a detected tailnet address:

```sh
pnpm dev --bind tailnet
```

Legacy aliases still map to the old broad private-network behavior:

```sh
pnpm dev --tailscale-auth
pnpm dev --authenticated-private
```

Allow additional private hostnames (for example custom Tailscale hostnames):

```sh
pnpm stacy allowed-hostname dotta-macbook-pro
```

## Test Commands

Use the cheap local default unless you are specifically working on browser flows:

```sh
pnpm test
```

`pnpm test` runs the Vitest suite only. For interactive Vitest watch mode use:

```sh
pnpm test:watch
```

Browser suites stay separate:

```sh
pnpm test:e2e
pnpm test:release-smoke
```

These browser suites are intended for targeted local verification and CI, not the default agent/human test command.

## One-Command Local Run

For a first-time local install, you can bootstrap and run in one command:

```sh
pnpm stacy run
```

`stacy run` does:

1. auto-onboard if config is missing
2. `stacy doctor` with repair enabled
3. starts the server when checks pass

## Docker Quickstart (No local Node install)

Build and run Stacy in Docker:

```sh
docker build -t stacy-local .
docker run --name stacy \
  -p 3100:3100 \
  -e HOST=0.0.0.0 \
  -e STACY_HOME=/stacy \
  -v "$(pwd)/data/docker-stacy:/stacy" \
  stacy-local
```

Or use Compose:

```sh
docker compose -f docker/docker-compose.quickstart.yml up --build
```

See `doc/DOCKER.md` for API key wiring (`OPENAI_API_KEY` / `ANTHROPIC_API_KEY`) and persistence details.

## Docker For Untrusted PR Review

For a separate review-oriented container that keeps `codex`/`claude` login state in Docker volumes and checks out PRs into an isolated scratch workspace, see `doc/UNTRUSTED-PR-REVIEW.md`.

## Database in Dev (Auto-Handled)

For local development, leave `DATABASE_URL` unset.
The server will automatically use embedded PostgreSQL and persist data at:

- `~/.stacy/instances/default/db`

Override home and instance:

```sh
STACY_HOME=/custom/path STACY_INSTANCE_ID=dev pnpm stacy run
```

No Docker or external database is required for this mode.

## Storage in Dev (Auto-Handled)

For local development, the default storage provider is `local_disk`, which persists uploaded images/attachments at:

- `~/.stacy/instances/default/data/storage`

Configure storage provider/settings:

```sh
pnpm stacy configure --section storage
```

## Default Agent Workspaces

When a local agent run has no resolved project/session workspace, Stacy falls back to an agent home workspace under the instance root:

- `~/.stacy/instances/default/workspaces/<agent-id>`

This path honors `STACY_HOME` and `STACY_INSTANCE_ID` in non-default setups.

For `codex_local`, Stacy also manages a per-company Codex home under the instance root and seeds it from the shared Codex login/config home (`$CODEX_HOME` or `~/.codex`):

- `~/.stacy/instances/default/companies/<company-id>/codex-home`

If the `codex` CLI is not installed or not on `PATH`, `codex_local` agent runs fail at execution time with a clear adapter error. Quota polling uses a short-lived `codex app-server` subprocess: when `codex` cannot be spawned, that provider reports `ok: false` in aggregated quota results and the API server keeps running (it must not exit on a missing binary).

## Worktree-local Instances

When developing from multiple git worktrees, do not point two Stacy servers at the same embedded PostgreSQL data directory.

Instead, create a repo-local Stacy config plus an isolated instance for the worktree:

```sh
stacy worktree init
# or create the git worktree and initialize it in one step:
pnpm stacy worktree:make stacy-pr-432
```

This command:

- writes repo-local files at `.stacy/config.json` and `.stacy/.env`
- creates an isolated instance under `~/.stacy-worktrees/instances/<worktree-id>/`
- when run inside a linked git worktree, mirrors the effective git hooks into that worktree's private git dir
- picks a free app port and embedded PostgreSQL port
- by default seeds the isolated DB in `minimal` mode from the current effective Stacy instance/config (repo-local worktree config when present, otherwise the default instance) via a logical SQL snapshot

Seed modes:

- `minimal` keeps core app state like companies, projects, issues, comments, approvals, and auth state, preserves schema for all tables, but omits row data from heavy operational history such as heartbeat runs, wake requests, activity logs, runtime services, and agent session state
- `full` makes a full logical clone of the source instance
- `--no-seed` creates an empty isolated instance

Seeded worktree instances quarantine copied live execution by default for both `minimal` and `full` seeds. During restore, Stacy disables copied agent timer heartbeats, resets copied `running` agents to `idle`, blocks and unassigns copied agent-owned `in_progress` issues, and unassigns copied agent-owned `todo`/`in_review` issues. This keeps a freshly booted worktree from starting agents for work already owned by the source instance. Pass `--preserve-live-work` only when you intentionally want the isolated worktree to resume copied assignments.

After `worktree init`, both the server and the CLI auto-load the repo-local `.stacy/.env` when run inside that worktree, so normal commands like `pnpm dev`, `stacy doctor`, and `stacy db:backup` stay scoped to the worktree instance.

`pnpm dev` now fails fast in a linked git worktree when `.stacy/.env` is missing, instead of silently booting against the default instance/port. If that happens, run `stacy worktree init` in the worktree first.

Provisioned git worktrees also pause seeded routines that still have enabled schedule triggers in the isolated worktree database by default. This prevents copied daily/cron routines from firing unexpectedly inside the new workspace instance during development without disabling webhook/API-only routines.

That repo-local env also sets:

- `STACY_IN_WORKTREE=true`
- `STACY_WORKTREE_NAME=<worktree-name>`
- `STACY_WORKTREE_COLOR=<hex-color>`

The server/UI use those values for worktree-specific branding such as the top banner and dynamically colored favicon.
Authenticated worktree servers also use the `STACY_INSTANCE_ID` value to scope Better Auth cookie names.
Browser cookies are shared by host rather than port, so this prevents logging into one `127.0.0.1:<port>` worktree from replacing another worktree server's session cookie.

Print shell exports explicitly when needed:

```sh
stacy worktree env
# or:
eval "$(stacy worktree env)"
```

### Worktree CLI Reference

**`pnpm stacy worktree init [options]`** — Create repo-local config/env and an isolated instance for the current worktree.

| Option | Description |
|---|---|
| `--name <name>` | Display name used to derive the instance id |
| `--instance <id>` | Explicit isolated instance id |
| `--home <path>` | Home root for worktree instances (default: `~/.stacy-worktrees`) |
| `--from-config <path>` | Source config.json to seed from |
| `--from-data-dir <path>` | Source STACY_HOME used when deriving the source config |
| `--from-instance <id>` | Source instance id (default: `default`) |
| `--server-port <port>` | Preferred server port |
| `--db-port <port>` | Preferred embedded Postgres port |
| `--seed-mode <mode>` | Seed profile: `minimal` or `full` (default: `minimal`) |
| `--no-seed` | Skip database seeding from the source instance |
| `--force` | Replace existing repo-local config and isolated instance data |

Examples:

```sh
stacy worktree init --no-seed
stacy worktree init --seed-mode full
stacy worktree init --from-instance default
stacy worktree init --from-data-dir ~/.stacy
stacy worktree init --force
```

Repair an already-created repo-managed worktree and reseed its isolated instance from the main default install:

```sh
cd /path/to/stacy/.stacy/worktrees/PAP-884-ai-commits-component
pnpm stacy worktree init --force --seed-mode minimal \
  --name PAP-884-ai-commits-component \
  --from-config ~/.stacy/instances/default/config.json
```

That rewrites the worktree-local `.stacy/config.json` + `.stacy/.env`, recreates the isolated instance under `~/.stacy-worktrees/instances/<worktree-id>/`, and preserves the git worktree contents themselves.

For an already-created worktree where you want the CLI to decide whether to rebuild missing worktree metadata or just reseed the isolated DB, use `worktree repair`.

**`pnpm stacy worktree repair [options]`** — Repair the current linked worktree by default, or create/repair a named linked worktree under `.stacy/worktrees/` when `--branch` is provided. The command never targets the primary checkout unless you explicitly pass `--branch`.

| Option | Description |
|---|---|
| `--branch <name>` | Existing branch/worktree selector to repair, or a branch name to create under `.stacy/worktrees` |
| `--home <path>` | Home root for worktree instances (default: `~/.stacy-worktrees`) |
| `--from-config <path>` | Source config.json to seed from |
| `--from-data-dir <path>` | Source `STACY_HOME` used when deriving the source config |
| `--from-instance <id>` | Source instance id when deriving the source config (default: `default`) |
| `--seed-mode <mode>` | Seed profile: `minimal` or `full` (default: `minimal`) |
| `--no-seed` | Repair metadata only when bootstrapping a missing worktree config |
| `--allow-live-target` | Override the guard that requires the target worktree DB to be stopped first |

Examples:

```sh
# From inside a linked worktree, rebuild missing .stacy metadata and reseed it from the default instance.
cd /path/to/stacy/.stacy/worktrees/PAP-1132-assistant-ui-pap-1131-make-issues-comments-be-like-a-chat
pnpm stacy worktree repair

# From the primary checkout, create or repair a linked worktree for a branch under .stacy/worktrees/.
cd /path/to/stacy
pnpm stacy worktree repair --branch PAP-1132-assistant-ui-pap-1131-make-issues-comments-be-like-a-chat
```

For an already-created worktree where you want to keep the existing repo-local config/env and only overwrite the isolated database, use `worktree reseed` instead. Stop the target worktree's Stacy server first so the command can replace the DB safely.

**`pnpm stacy worktree reseed [options]`** — Re-seed an existing worktree-local instance from another Stacy instance or worktree while preserving the target worktree's current config, ports, and instance identity.

| Option | Description |
|---|---|
| `--from <worktree>` | Source worktree path, directory name, branch name, or `current` |
| `--to <worktree>` | Target worktree path, directory name, branch name, or `current` (defaults to `current`) |
| `--from-config <path>` | Source config.json to seed from |
| `--from-data-dir <path>` | Source `STACY_HOME` used when deriving the source config |
| `--from-instance <id>` | Source instance id when deriving the source config |
| `--seed-mode <mode>` | Seed profile: `minimal` or `full` (default: `full`) |
| `--yes` | Skip the destructive confirmation prompt |
| `--allow-live-target` | Override the guard that requires the target worktree DB to be stopped first |

Examples:

```sh
# From the main repo, reseed a worktree from the current default/master instance.
cd /path/to/stacy
pnpm stacy worktree reseed \
  --from current \
  --to PAP-1132-assistant-ui-pap-1131-make-issues-comments-be-like-a-chat \
  --seed-mode full \
  --yes

# From inside a worktree, reseed it from the default instance config.
cd /path/to/stacy/.stacy/worktrees/PAP-1132-assistant-ui-pap-1131-make-issues-comments-be-like-a-chat
pnpm stacy worktree reseed \
  --from-instance default \
  --seed-mode full
```

**`pnpm stacy worktree:make <name> [options]`** — Create `~/NAME` as a git worktree, then initialize an isolated Stacy instance inside it. This combines `git worktree add` with `worktree init` in a single step.

| Option | Description |
|---|---|
| `--start-point <ref>` | Remote ref to base the new branch on (e.g. `origin/main`) |
| `--instance <id>` | Explicit isolated instance id |
| `--home <path>` | Home root for worktree instances (default: `~/.stacy-worktrees`) |
| `--from-config <path>` | Source config.json to seed from |
| `--from-data-dir <path>` | Source STACY_HOME used when deriving the source config |
| `--from-instance <id>` | Source instance id (default: `default`) |
| `--server-port <port>` | Preferred server port |
| `--db-port <port>` | Preferred embedded Postgres port |
| `--seed-mode <mode>` | Seed profile: `minimal` or `full` (default: `minimal`) |
| `--no-seed` | Skip database seeding from the source instance |
| `--force` | Replace existing repo-local config and isolated instance data |

Examples:

```sh
pnpm stacy worktree:make stacy-pr-432
pnpm stacy worktree:make my-feature --start-point origin/main
pnpm stacy worktree:make experiment --no-seed
```

**`pnpm stacy worktree env [options]`** — Print shell exports for the current worktree-local Stacy instance.

| Option | Description |
|---|---|
| `-c, --config <path>` | Path to config file |
| `--json` | Print JSON instead of shell exports |

Examples:

```sh
pnpm stacy worktree env
pnpm stacy worktree env --json
eval "$(pnpm stacy worktree env)"
```

For project execution worktrees, Stacy can also run a project-defined provision command after it creates or reuses an isolated git worktree. Configure this on the project's execution workspace policy (`workspaceStrategy.provisionCommand`). The command runs inside the derived worktree and receives `STACY_WORKSPACE_*`, `STACY_PROJECT_ID`, `STACY_AGENT_ID`, and `STACY_ISSUE_*` environment variables so each repo can bootstrap itself however it wants.

## Quick Health Checks

In another terminal:

```sh
curl http://localhost:3100/api/health
curl http://localhost:3100/api/companies
```

Expected:

- `/api/health` returns `{"status":"ok"}`
- `/api/companies` returns a JSON array

## Reset Local Dev Database

To wipe local dev data and start fresh:

```sh
rm -rf ~/.stacy/instances/default/db
pnpm dev
```

## Optional: Use External Postgres

If you set `DATABASE_URL`, the server will use that instead of embedded PostgreSQL.

## Automatic DB Backups

Stacy can run automatic DB backups on a timer. Defaults:

- enabled
- every 60 minutes
- retain 30 days
- backup dir: `~/.stacy/instances/default/data/backups`

Configure these in:

```sh
pnpm stacy configure --section database
```

Run a one-off backup manually:

```sh
pnpm stacy db:backup
# or:
pnpm db:backup
```

Environment overrides:

- `STACY_DB_BACKUP_ENABLED=true|false`
- `STACY_DB_BACKUP_INTERVAL_MINUTES=<minutes>`
- `STACY_DB_BACKUP_RETENTION_DAYS=<days>`
- `STACY_DB_BACKUP_DIR=/absolute/or/~/path`

## Secrets in Dev

Agent env vars now support secret references. By default, secret values are stored with local encryption and only secret refs are persisted in agent config.

- Default local key path: `~/.stacy/instances/default/secrets/master.key`
- Override key material directly: `STACY_SECRETS_MASTER_KEY`
- Override key file path: `STACY_SECRETS_MASTER_KEY_FILE`

Strict mode (recommended outside local trusted machines):

```sh
STACY_SECRETS_STRICT_MODE=true
```

When strict mode is enabled, sensitive env keys (for example `*_API_KEY`, `*_TOKEN`, `*_SECRET`) must use secret references instead of inline plain values.

CLI configuration support:

- `pnpm stacy onboard` writes a default `secrets` config section (`local_encrypted`, strict mode off, key file path set) and creates a local key file when needed.
- `pnpm stacy configure --section secrets` lets you update provider/strict mode/key path and creates the local key file when needed.
- `pnpm stacy doctor` validates secrets adapter configuration and can create a missing local key file with `--repair`.

Migration helper for existing inline env secrets:

```sh
pnpm secrets:migrate-inline-env         # dry run
pnpm secrets:migrate-inline-env --apply # apply migration
```

## Company Deletion Toggle

Company deletion is intended as a dev/debug capability and can be disabled at runtime:

```sh
STACY_ENABLE_COMPANY_DELETION=false
```

Default behavior:

- `local_trusted`: enabled
- `authenticated`: disabled

## CLI Client Operations

Stacy CLI now includes client-side control-plane commands in addition to setup commands.

Quick examples:

```sh
pnpm stacy issue list --company-id <company-id>
pnpm stacy issue create --company-id <company-id> --title "Investigate checkout conflict"
pnpm stacy issue update <issue-id> --status in_progress --comment "Started triage"
```

Set defaults once with context profiles:

```sh
pnpm stacy context set --api-base http://localhost:3100 --company-id <company-id>
```

Then run commands without repeating flags:

```sh
pnpm stacy issue list
pnpm stacy dashboard get
```

See full command reference in `doc/CLI.md`.

## OpenClaw Invite Onboarding Endpoints

Agent-oriented invite onboarding now exposes machine-readable API docs:

- `GET /api/invites/:token` returns invite summary plus onboarding and skills index links.
- `GET /api/invites/:token/onboarding` returns onboarding manifest details (registration endpoint, claim endpoint template, skill install hints).
- `GET /api/invites/:token/onboarding.txt` returns a plain-text onboarding doc intended for both human operators and agents (llm.txt-style handoff), including optional inviter message and suggested network host candidates.
- `GET /api/skills/index` lists available skill documents.
- `GET /api/skills/stacy` returns the Stacy heartbeat skill markdown.

## OpenClaw Join Smoke Test

Run the end-to-end OpenClaw join smoke harness:

```sh
pnpm smoke:openclaw-join
```

What it validates:

- invite creation for agent-only join
- agent join request using `adapterType=openclaw`
- board approval + one-time API key claim semantics
- callback delivery on wakeup to a dockerized OpenClaw-style webhook receiver

Required permissions:

- This script performs board-governed actions (create invite, approve join, wakeup another agent).
- In authenticated mode, run with board auth via `STACY_AUTH_HEADER` or `STACY_COOKIE`.

Optional auth flags (for authenticated mode):

- `STACY_AUTH_HEADER` (for example `Bearer ...`)
- `STACY_COOKIE` (session cookie header value)

## OpenClaw Docker UI One-Command Script

To boot OpenClaw in Docker and print a host-browser dashboard URL in one command:

```sh
pnpm smoke:openclaw-docker-ui
```

This script lives at `scripts/smoke/openclaw-docker-ui.sh` and automates clone/build/config/start for Compose-based local OpenClaw UI testing.

Pairing behavior for this smoke script:

- default `OPENCLAW_DISABLE_DEVICE_AUTH=1` (no Control UI pairing prompt for local smoke; no extra pairing env vars required)
- set `OPENCLAW_DISABLE_DEVICE_AUTH=0` to require standard device pairing

Model behavior for this smoke script:

- defaults to OpenAI models (`openai/gpt-5.2` + OpenAI fallback) so it does not require Anthropic auth by default

State behavior for this smoke script:

- defaults to isolated config dir `~/.openclaw-stacy-smoke`
- resets smoke agent state each run by default (`OPENCLAW_RESET_STATE=1`) to avoid stale provider/auth drift

Networking behavior for this smoke script:

- auto-detects and prints a Stacy host URL reachable from inside OpenClaw Docker
- default container-side host alias is `host.docker.internal` (override with `STACY_HOST_FROM_CONTAINER` / `STACY_HOST_PORT`)
- if Stacy rejects container hostnames in authenticated/private mode, allow `host.docker.internal` via `pnpm stacy allowed-hostname host.docker.internal` and restart Stacy
