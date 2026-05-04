# Stacy Self-Hosted Operations

This is the operator runbook for a local or small self-hosted Stacy instance.
It is intentionally boring: verify, back up, upgrade, restore, and recover
without reading source code.

## Quickstart Smoke

Validate the Docker quickstart from the current checkout:

```bash
pnpm smoke:docker-quickstart
```

The smoke script:

- validates `docker/docker-compose.quickstart.yml`
- builds the Docker image
- starts Stacy on `http://localhost:3132`
- waits for `/api/health`
- verifies embedded Postgres data and server logs persist in the mounted data dir
- restarts the compose service and checks health again

Useful overrides:

```bash
HOST_PORT=3200 pnpm smoke:docker-quickstart
DATA_DIR=./data/docker-stacy-smoke PRESERVE_DATA=true pnpm smoke:docker-quickstart
PRESERVE_CONTAINER=true pnpm smoke:docker-quickstart
```

## Before Upgrade

Run the read-only upgrade preflight:

```bash
pnpm stacy upgrade:check
```

Block scripted upgrades on warnings:

```bash
pnpm stacy upgrade:check --strict
```

The command reports:

- CLI version
- config path
- database connection source
- Postgres data directory, when visible
- applied and pending migrations
- latest backup file
- backup age

Create a fresh backup before applying code, image, or migration changes:

```bash
pnpm stacy db:backup
pnpm stacy upgrade:check --strict
```

## Restore Drill

Inspect the restore target first:

```bash
pnpm stacy db:restore --latest --dry-run
```

For Docker/self-hosted instances, stop the app before applying restore so no
worker writes into the database during replay:

```bash
docker compose -f docker/docker-compose.quickstart.yml down
pnpm stacy db:restore --latest --yes
docker compose -f docker/docker-compose.quickstart.yml up -d
```

After restore:

```bash
pnpm stacy upgrade:check
curl -fsS http://localhost:3100/api/health
```

## Release Checklist

Before tagging a Stacy release:

- `pnpm release:notes -- --version <version>`
- `./scripts/create-github-release.sh <version> --init-notes` if the notes file
  is missing
- `./scripts/release.sh stable --date YYYY-MM-DD --dry-run --skip-verify` to
  preview the full workspace publish payload
- `NPM_TOKEN` or `NODE_AUTH_TOKEN` can be set to a granular npm token with 2FA
  bypass for the stable release script; the script writes only an
  environment-variable reference to a temporary npm userconfig and removes it on
  exit
- The npm user or token must have write access to every package in the release,
  including `@arpanstacy/stacy` and the publishable `@arpanstacy/stacy-*`
  packages. The stable release script preflights package maintainership before
  publishing existing packages.
- `pnpm release:phase5-gate` to run the distribution gate and show whether the
  wrapper publish is complete or still npm-auth gated
- `pnpm release:package-name` to confirm the `stacy-cli` package target
- `pnpm release:stacy-cli:status` to inspect the live wrapper version,
  dependency, deprecation state, and next action
- `pnpm release:stacy-cli` to dry-run the wrapper publish
- `pnpm release:stacy-cli:publish -- --otp <code>` to publish with a fresh npm
  OTP, or set `NPM_TOKEN`/`NODE_AUTH_TOKEN` from a hidden prompt before running
  `pnpm release:stacy-cli:publish` with a granular npm token that can bypass
  2FA
- `pnpm release:stacy-cli:deprecate-old -- --replacement-version <version> --otp <code>`
  after the corrected wrapper version is live
- `pnpm --filter @arpanstacy/stacy typecheck`
- `pnpm exec vitest run cli/src/__tests__/db-restore.test.ts cli/src/__tests__/upgrade-check.test.ts`
- `pnpm smoke:codex-local-preflight`
- `pnpm smoke:claude-local-preflight`
- `pnpm smoke:docker-quickstart`
- `pnpm smoke:stacy-cli-npm -- --version <version> --expected-core <version>` after publishing `stacy-cli`
- document any manual migration, backup, or restore notes in the release notes
- remove or update `> Status: Draft` before creating the GitHub release

Real Codex/Claude adapter smokes remain opt-in because they can use
authenticated accounts or billable API usage.
