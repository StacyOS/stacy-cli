# stacy-cli

Public Stacy CLI wrapper.

This package provides the `stacy` binary for the published Stacy core package.
It exists so new operators can start Stacy with a short public npm command.

```bash
npx stacy-cli onboard
```

The wrapper version should match the wrapped `@arpanstacy/stacy` version after
it is published. Inside the monorepo the dependency uses `workspace:*`; the
release helper stages the npm payload with the matching released Stacy core
version.
