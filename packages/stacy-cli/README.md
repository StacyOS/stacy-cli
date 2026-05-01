# stacy-cli

Public Stacy CLI wrapper.

This package provides the `stacy` binary for the published `paperclipai` CLI
package. It exists so new operators can start Stacy with a Stacy-branded npm
command while the original `paperclipai` package remains available as the
compatibility package.

```bash
npx stacy-cli onboard
```

The wrapper version should match the wrapped `paperclipai` version after it is
published. Inside the monorepo the dependency uses `workspace:*`; the release
helper stages the npm payload with the matching released `paperclipai` version.
