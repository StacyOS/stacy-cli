# @arpanstacy/stacy

Core Stacy CLI package.

Stacy is a trust-first AI agent control plane for running local coding agents
with durable tasks, live run logs, cancellation, cost visibility, and audit
history.

Most users should install through the public wrapper package:

```bash
npx stacy-cli@latest onboard --yes
```

The wrapper installs the `stacy` binary and pins the matching
`@arpanstacy/stacy` core package.

## Common Commands

```bash
npx stacy-cli@latest onboard --yes
npx stacy-cli@latest doctor --repair --yes
npx stacy-cli@latest run
```

After onboarding, Stacy starts the local UI and API at
`http://127.0.0.1:3100` by default.

## Local Agent Accounts

Stacy does not ship shared Codex or Claude credentials. Each operator connects
their own local account:

```bash
codex login
claude login
```

Then open the Stacy UI, create a Codex CLI or Claude Code agent, and use the
adapter connection panel to retest the local account before assigning work.

## Development

From a cloned repository:

```bash
pnpm install
pnpm dev
```

Useful checks:

```bash
pnpm typecheck
pnpm test:run
pnpm build
```

## Links

- Repository: https://github.com/StacyOS/stacy-cli
- Releases: https://github.com/StacyOS/stacy-cli/releases
- Issues: https://github.com/StacyOS/stacy-cli/issues
