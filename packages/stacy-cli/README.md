# stacy-cli

Public npm entrypoint for Stacy.

`stacy-cli` installs the `stacy` binary and wraps the matching
`@arpanstacy/stacy` core package. Use it when you want to start Stacy from npm
without cloning the repository.

```bash
npx stacy-cli@latest onboard --yes
npx stacy-cli@latest run
```

Useful checks:

```bash
npx stacy-cli@latest --version
npx stacy-cli@latest doctor --repair --yes
```

Inside the monorepo, the dependency uses `workspace:*`. The release helper
stages the npm payload with the matching released Stacy core version.
