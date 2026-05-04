# Stacy Phase 5

Phase 5 is the distribution and self-hosting phase. The product is only ready
for Stacey when a new developer/operator can install it, verify it, back it up,
restore it, and upgrade it without spelunking through source code.

## Phase 5 Acceptance Target

A fresh operator can:

- run Stacy locally with `pnpm stacy onboard --yes` or the public
  `npx stacy-cli@latest onboard`
- run `pnpm stacy doctor --repair --yes` and understand what is unsafe
- run non-billable Codex/Claude adapter preflights before real agent work
- create and restore a database backup through documented CLI commands
- start the Docker quickstart with persistent state
- inspect migration/upgrade status before changing a live instance
- recover enough operational context from docs and command output alone

## Completed In This Slice

- Added non-billable local adapter preflight commands:
  - `pnpm smoke:codex-local-preflight`
  - `pnpm smoke:claude-local-preflight`
  - `pnpm smoke:phase4-local-adapters-preflight`
- Added a billing guard to real Codex/Claude adapter smokes. Real CLI
  invocation now requires `STACY_REAL_SMOKE_ALLOW_BILLING=1`.
- Added a guarded database restore CLI:
  - `pnpm stacy db:restore ./backup.sql.gz --dry-run`
  - `pnpm stacy db:restore ./backup.sql.gz --yes`
  - `pnpm stacy db:restore --latest --dry-run`
- Added a root shortcut:
  - `pnpm db:restore -- --latest --dry-run`
- Added tests covering dry-run/latest restore selection and confirmed restore
  invocation.
- Added a read-only upgrade preflight command:
  - `pnpm stacy upgrade:check`
  - `pnpm stacy upgrade:check --json`
  - `pnpm stacy upgrade:check --strict`
- Added a root shortcut:
  - `pnpm upgrade:check`
- Added tests covering current migration/fresh backup and pending
  migration/missing backup summaries.
- Added a Docker quickstart smoke profile:
  - `pnpm smoke:docker-quickstart`
- Verified the Docker quickstart smoke against a running Docker Desktop daemon
  on April 30, 2026. The smoke built the image, started Stacy, checked health,
  verified persisted instance data, restarted the service, and checked health
  again.
- Re-ran the Docker quickstart smoke on May 1, 2026 after the public-readiness
  dependency cleanup. It rebuilt the image, started Stacy on localhost, verified
  persisted state after restart, and exited cleanly without leaving a smoke
  container running.
- Made the Docker quickstart self-contained for local evaluation by giving
  `BETTER_AUTH_SECRET` a local-only default in
  `docker/docker-compose.quickstart.yml`.
- Added `docs/stacy/SELF-HOSTED-OPERATIONS.md` with the upgrade, backup,
  restore, Docker smoke, and release checklist flow.
- Added a release notes scaffolder:
  - `pnpm release:notes`
  - `pnpm release:notes -- --date 2026-04-30`
  - `pnpm release:notes -- --version 2026.430.0`
- Updated the stable release gate to print the release-notes scaffolding command
  when notes are missing.
- Tied the release notes template into GitHub release automation:
  - `./scripts/create-github-release.sh <version> --init-notes`
  - GitHub release creation now refuses notes still marked as draft unless
    `--allow-draft-notes` is explicitly passed.
- Added `stacy` as the published CLI binary.
- Documented the public CLI package decision in
  `docs/stacy/PUBLIC-CLI-PACKAGING.md`.
- Confirmed the public npm package name `stacy` is already taken as of
  April 30, 2026 (`stacy@2.0.0`, owner `levahim`).
- Confirmed `stacy-cli` and `stacycli` were available on npm as of April 30,
  2026, and selected `stacy-cli` as the Phase 5 public package target.
- Added a small `stacy-cli` wrapper package that depends on `@arpanstacy/stacy` and
  exposes the `stacy` binary.
- Added an npm package README for the `stacy-cli` wrapper so the public npm page
  explains the Stacy bridge without requiring source-code context.
- Published `stacy-cli@0.3.1` on April 30, 2026 to reserve the name under the
  `arpanstacy` npm account.
- Added an npm wrapper smoke that verifies `stacy-cli` metadata, the
  Stacy core dependency, and the runtime `stacy --version` result.
- Added a repeatable package-name preflight:
  - `pnpm release:package-name`
  - `STACY_NPM_EXPECTED_OWNER=<npm-user> pnpm release:package-name`
- Added a repeatable `stacy-cli` publish helper:
  - `pnpm release:stacy-cli -- --status`
  - `pnpm release:stacy-cli:status`
  - `pnpm release:stacy-cli`
  - `pnpm release:stacy-cli -- --publish --otp <code>`
  - `pnpm release:stacy-cli:publish -- --otp <code>`
  - `pnpm release:stacy-cli -- --publish --otp <code> --deprecate-old 0.3.1`
  - `pnpm release:stacy-cli:deprecate-old -- --replacement-version <version> --otp <code>`
- Added a read-only Phase 5 release gate:
  - `pnpm release:phase5-gate`
  - `pnpm release:phase5-gate -- --strict-live`
  - `pnpm release:phase5-gate -- --skip-network`
- The publish helper also accepts `NPM_TOKEN` or `NODE_AUTH_TOKEN` for a
  granular npm token with 2FA bypass. It writes only an environment-variable
  reference to a temporary npm userconfig outside the repo and removes that file
  when the command exits.
- The publish helper now allows unauthenticated dry-runs. Real publish and
  deprecation actions still require npm auth through `--otp`, `NPM_TOKEN`, or
  `NODE_AUTH_TOKEN`.
- Added a deprecate-only wrapper path so `stacy-cli@0.3.1` can be deprecated
  after the stable release script publishes the matching corrected wrapper.
- The stable release script now supports `NPM_TOKEN` or `NODE_AUTH_TOKEN` for a
  granular npm token with 2FA bypass using the same temporary-userconfig pattern
  as the wrapper helper.
- Verified the corrected `stacy-cli` wrapper publish path with
  `pnpm release:stacy-cli` on May 1, 2026. The dry-run tarball includes
  `README.md`, `bin/stacy.js`, and `package.json`.
- Verified `pnpm release:stacy-cli -- --status` on May 1, 2026. It reports the
  local target, current npm latest, whether the corrected wrapper is live,
  whether the reserved `0.3.1` wrapper is deprecated, and the next publish or
  deprecation command.
- Verified `pnpm release:phase5-gate` on May 1, 2026. The gate passes local
  checks and dry-run publish readiness, then reports `AUTH_GATED` while npm
  still needs a fresh OTP or granular token for the live publish/deprecate step.
- Attempted the real corrected wrapper publish on May 1, 2026 with
  `pnpm release:stacy-cli -- --publish --deprecate-old 0.3.1`; npm stopped the
  publish with `EOTP`, so the corrected package and deprecation remain gated by
  a fresh OTP or granular token with 2FA bypass.
- Attempted the May 1, 2026 stable workspace release on May 4, 2026 with a
  granular token. Auth succeeded, but npm rejected the first old scoped package
  with `E404` because `arpanstacy` owns `stacy-cli`, not the legacy package
  namespace. The release surface now uses Stacy-owned package names instead.
- Aligned the local `stacy-cli` wrapper target with the May 1 cleanup release
  slot, `2026.501.0`, so local Phase 5 gates and public cleanup docs point at
  the same final stable version.
- Updated the `stacy-cli` publish helper so status and dry-run paths can run
  before the matching core package is live. Real wrapper publishing remains
  blocked until `@arpanstacy/stacy@2026.501.0` is available on npm.
- Verified the corrected `stacy-cli@2026.501.0` wrapper dry-run on May 4, 2026.
  The tarball includes `README.md`, `bin/stacy.js`, and `package.json`, and it
  stages a dependency on `@arpanstacy/stacy@2026.501.0`.
- Re-ran `pnpm release:phase5-gate` with live npm registry access on May 4,
  2026. It confirms `stacy-cli` is owned by `arpanstacy`, verifies the
  `2026.501.0` wrapper dry-run, and now reports the exact remaining sequence:
  publish `@arpanstacy/stacy@2026.501.0`, publish `stacy-cli@2026.501.0`, then
  deprecate `stacy-cli@0.3.1`.
- Completed a public-readiness validation pass on May 4, 2026:
  - `pnpm test:run`
  - `pnpm build`
  - `pnpm check:tokens`
  - `git diff --check`
  - a repository scan for legacy upstream package/name tokens
  - `pnpm audit --prod --audit-level moderate`
- The production audit passes at the moderate threshold. `pnpm audit --prod
  --json` still reports one low-severity advisory against the workspace importer
  path `cli@0.3.1`, which is not an installed runtime dependency named `cli`.
  Re-run the audit after the stable release script performs its temporary
  `2026.501.0` package-version rewrite.

## Operator Backup And Restore

Create a one-off backup from the configured database:

```bash
pnpm stacy db:backup
```

Inspect a restore target without applying SQL:

```bash
pnpm stacy db:restore ./stacy-20260430-010000.sql.gz --dry-run
pnpm stacy db:restore --latest --dry-run
```

Apply a restore after reviewing the target database and backup file:

```bash
pnpm stacy db:restore ./stacy-20260430-010000.sql.gz
pnpm stacy db:restore --latest --yes
```

Restore is intentionally guarded because it applies SQL to the configured
database. Operators should run a backup first, check the connection source, then
restore during a maintenance window.

## Upgrade Preflight

Run this before changing a self-hosted instance:

```bash
pnpm stacy upgrade:check
```

The check is read-only. It reports the Stacy CLI version, config path,
connection source, Postgres data directory, migration state, latest backup, and
backup age. Use strict mode in scripts when warnings should block the upgrade:

```bash
pnpm stacy upgrade:check --strict
pnpm stacy upgrade:check --json
```

## Docker Quickstart Smoke

Validate the Docker quickstart with:

```bash
pnpm smoke:docker-quickstart
```

The smoke validates the compose file, builds the image, waits for `/api/health`,
checks the mounted data directory for persisted instance data, restarts the
service, and verifies health again. It skips cleanly when Docker or Docker
Compose is not available.

For the full operator checklist, read `docs/stacy/SELF-HOSTED-OPERATIONS.md`.

## Release Notes

Stable releases require `releases/v<version>.md`. Scaffold the file with:

```bash
pnpm release:notes -- --version 2026.430.0
```

When `--version` is omitted, the script picks the next local notes slot for
today or for the date passed with `--date`. The final publish version is still
controlled by `scripts/release.sh`, because it checks npm for already-published
versions.

GitHub release creation is tied to the same template. If notes are missing:

```bash
./scripts/create-github-release.sh 2026.430.0 --init-notes
```

The command creates `releases/v2026.430.0.md` and stops. Edit the notes, remove
or update the draft status, then rerun the GitHub release command.

## Public CLI Package

The public CLI package exposes the Stacy binary:

```text
stacy
```

The package-name decision is documented in
`docs/stacy/PUBLIC-CLI-PACKAGING.md`. The safe Phase 5 bridge is to publish the
Stacy core under `@arpanstacy/stacy` and publish the `stacy-cli` wrapper package
for `npx stacy-cli@latest onboard`.

The current registry check shows `stacy` is already taken, so the exact
`npx stacy onboard` vanity package must not be published unless ownership is
transferred or an owner-approved wrapper plan exists.

## Public Release Status

- Published the Stacy-owned package graph under `@arpanstacy/*` at
  `2026.501.0`.
- Published the matching public wrapper, `stacy-cli@2026.501.0`.
- Confirmed the wrapper with
  `pnpm smoke:stacy-cli-npm -- --version 2026.501.0 --expected-core 2026.501.0`.
- Deprecated the old reserved package version, `stacy-cli@0.3.1`.
- Created the local release tag `v2026.501.0`.

Keep `stacy` as a future vanity-package migration only if ownership is
transferred or approved. The public install path for this release is
`npx stacy-cli@latest onboard`.

Before the next public release, repeat `pnpm smoke:docker-quickstart` from a
fresh clone or clean host when cutting the final release artifact.
