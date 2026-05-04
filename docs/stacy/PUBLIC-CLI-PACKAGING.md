# Stacy Public CLI Packaging

Phase 5 decision: publish Stacy-owned packages. The public operator entrypoint
is the existing `stacy-cli` package, and the wrapped core package is
`@arpanstacy/stacy`.

## Current Bridge

The main publishable CLI package now uses:

```text
package: @arpanstacy/stacy
binary:  stacy
```

This means an installed package exposes the Stacy command:

```bash
npx stacy-cli onboard
stacy onboard
```

Inside the repo, the preferred local command is:

```bash
pnpm stacy onboard --yes
```

The Stacy-branded public package target is:

```text
package: stacy-cli
binary:  stacy
```

That gives new users:

```bash
npx stacy-cli onboard
```

The package name is now reserved by the `arpanstacy` npm account. The first
published version, `stacy-cli@0.3.1`, should not be announced because it pointed
at the old core package. The corrected release target should wrap the matching
published `@arpanstacy/stacy` version.

As of May 4, 2026, the old package namespace is no longer part of the release
plan. The full workspace stable release publishes under the `@arpanstacy/*`
scope, which `arpanstacy` can own directly.

## Target End State

The ideal public vanity command remains:

```bash
npx stacy onboard
```

As of April 30, 2026, the npm package name `stacy` already exists on the
public registry at version `2.0.0` and is owned by `levahim`. That means Stacy
cannot safely publish the main CLI under `stacy` unless ownership is transferred
or an approved wrapper/package-name plan is made.

As of April 30, 2026, the npm package names `stacy-cli` and `stacycli` are
available. We are using `stacy-cli` because it is more readable and matches npm
package naming conventions.

There are now two package lanes:

1. Phase 5 public package: publish `stacy-cli`, which depends on
   `@arpanstacy/stacy` and exposes the `stacy` binary.
2. Future vanity package: publish `stacy` only if npm ownership is transferred
   or an explicit owner-approved wrapper plan exists.

This gives Stacy a branded install path without depending on legacy package
ownership.

## Release Rule

Before shipping a public `stacy-cli` package:

- confirm npm package availability or ownership for `stacy-cli`
- confirm `stacy-cli` depends on the matching released `@arpanstacy/stacy`
  version
- keep only the `stacy` binary in the public CLI bundle
- include the package-name decision in `releases/v<version>.md`
- run the release notes, upgrade preflight, and Docker quickstart smoke gates

Do not publish a new package name from local assumptions alone. The npm
namespace check must happen during release prep.

Run the package-name preflight with:

```bash
pnpm release:package-name
```

The repo gate expects the package owner to be `arpanstacy`. If ownership moves,
pass the new expected owner:

```bash
STACY_NPM_EXPECTED_OWNER=<npm-user> pnpm release:package-name
```

After publishing the wrapper, run the npm smoke:

```bash
pnpm smoke:stacy-cli-npm -- --version <version> --expected-core <version>
```

Run the full read-only Phase 5 distribution gate with:

```bash
pnpm release:phase5-gate
```

Use strict mode only after npm publishing should already be complete:

```bash
pnpm release:phase5-gate -- --strict-live
```

For the current correction, publish and verify:

```bash
pnpm release:stacy-cli:status
pnpm release:stacy-cli
pnpm release:stacy-cli:publish -- --otp <code>
```

`pnpm release:stacy-cli` is a dry-run and can run without npm auth. Real publish
and deprecation still require a fresh OTP or a granular token with 2FA bypass.
Pass the raw token value only; do not wrap it in angle brackets.

When the stable release script publishes the wrapper as part of the full
workspace release, deprecate the reserved wrapper separately:

```bash
pnpm release:stacy-cli:deprecate-old -- --replacement-version 2026.501.0 --otp <code>
```

If using a granular npm access token with 2FA bypass enabled, keep the token out
of shell history and pass it through `NPM_TOKEN` or `NODE_AUTH_TOKEN`:

```bash
read -r -s NPM_TOKEN
export NPM_TOKEN
pnpm release:stacy-cli:publish
unset NPM_TOKEN
```

If using a granular npm access token with 2FA bypass enabled for deprecation:

```bash
read -r -s NPM_TOKEN
export NPM_TOKEN
pnpm release:stacy-cli:deprecate-old -- --replacement-version 2026.501.0
unset NPM_TOKEN
```

Check the blocked vanity package separately with:

```bash
pnpm release:vanity-package-name
```
