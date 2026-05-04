---
title: Setup Commands
summary: Onboard, run, doctor, and configure
---

Instance setup and diagnostics commands.

## `stacy run`

One-command bootstrap and start:

```sh
pnpm stacy run
```

Does:

1. Auto-onboards if config is missing
2. Runs `stacy doctor` with repair enabled
3. Starts the server when checks pass

Choose a specific instance:

```sh
pnpm stacy run --instance dev
```

## `stacy onboard`

Interactive first-time setup:

```sh
pnpm stacy onboard
```

If Stacy is already configured, rerunning `onboard` keeps the existing config in place. Use `stacy configure` to change settings on an existing install.

First prompt:

1. `Quickstart` (recommended): local defaults (embedded database, no LLM provider, local disk storage, default secrets)
2. `Advanced setup`: full interactive configuration

Start immediately after onboarding:

```sh
pnpm stacy onboard --run
```

Non-interactive defaults + immediate start (opens browser on server listen):

```sh
pnpm stacy onboard --yes
```

On an existing install, `--yes` now preserves the current config and just starts Stacy with that setup.

## `stacy doctor`

Health checks with optional auto-repair:

```sh
pnpm stacy doctor
pnpm stacy doctor --repair
```

Validates:

- Server configuration
- Database connectivity
- Secrets adapter configuration
- Storage configuration
- Missing key files

## `stacy configure`

Update configuration sections:

```sh
pnpm stacy configure --section server
pnpm stacy configure --section secrets
pnpm stacy configure --section storage
```

## `stacy env`

Show resolved environment configuration:

```sh
pnpm stacy env
```

This now includes bind-oriented deployment settings such as `STACY_BIND` and `STACY_BIND_HOST` when configured.

## `stacy allowed-hostname`

Allow a private hostname for authenticated/private mode:

```sh
pnpm stacy allowed-hostname my-tailscale-host
```

## Local Storage Paths

| Data | Default Path |
|------|-------------|
| Config | `~/.stacy/instances/default/config.json` |
| Database | `~/.stacy/instances/default/db` |
| Logs | `~/.stacy/instances/default/logs` |
| Storage | `~/.stacy/instances/default/data/storage` |
| Secrets key | `~/.stacy/instances/default/secrets/master.key` |

Override with:

```sh
STACY_HOME=/custom/home STACY_INSTANCE_ID=dev pnpm stacy run
```

Or pass `--data-dir` directly on any command:

```sh
pnpm stacy run --data-dir ./tmp/stacy-dev
pnpm stacy doctor --data-dir ./tmp/stacy-dev
```
