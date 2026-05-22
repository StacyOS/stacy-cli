# StacyOS Federation Demo Runbook

This is the Phase 5 operator script for the day-90 federation demo.

## Clean Checkout Setup

From the `stacy-cli` repo root:

```bash
pnpm install
pnpm --filter @arpanstacy/stacy-federation preflight
```

The preflight verifies that the federation package, Stacy CLI entrypoint, server
package, test harness, and local `tsx` runtime are present before any slower
demo checks run.

## One-Command Verification

```bash
pnpm --filter @arpanstacy/stacy-federation demo:check
```

This is the command to run before every demo. It verifies:

1. preflight
2. TypeScript typecheck
3. six acceptance criteria
4. real Stacy Postgres persistence
5. real two-install local server flow

Expected high-level result:

```text
Stacy federation demo preflight passed.
test/acceptance/federation-demo.acceptance.test.ts: 6 passed
src/brain/local-brain.integration.test.ts: 4 passed
test/harness/real-two-install-smoke.test.ts: 4 passed
```

The full real-server smoke should complete well under the four-minute demo bar.
On the latest local run it completed in about 53 seconds.

## Repeated Verification

Before an investor-facing run, repeat the full check:

```bash
pnpm --filter @arpanstacy/stacy-federation demo:repeat
```

By default this runs `demo:check` twice. Override the count when needed:

```bash
STACY_FEDERATION_DEMO_REPEAT=3 pnpm --filter @arpanstacy/stacy-federation demo:repeat
```

Latest known-good repeated run:

```text
repeated demo check passed 3/3 runs
run 1: 63.03s
run 2: 57.03s
run 3: 57.18s
slowest run: 63.03s
```

## Demo Storyboard

The real two-install smoke is the executable storyboard:

1. Start install A and install B with separate homes, configs, DB ports, server
   ports, storage directories, and identities.
2. Create a signed Knowledge Object on A.
3. Create or load B's install identity.
4. Share A's KO to B with per-object read consent and a producer revocation URL.
5. Read the federated KO on B with provenance and signature verification.
6. Confirm expired consent denies B's read.
7. Revoke the KO on A.
8. Read on B again.
9. B checks A's revocation state at read time and denies the read without a
   producer push.

## Troubleshooting

- If preflight fails, run `pnpm install` from the repo root and retry.
- If a real smoke test fails with `listen EPERM`, rerun in an environment that
  allows loopback ports for embedded Postgres and the local Stacy servers.
- If a server startup fails, the harness error includes the health URL, PID,
  stdout, and stderr for the failed install.
- If the static acceptance suite passes but real smokes fail, treat that as a
  Phase 5 reliability issue, not a federation feature request.
- If `demo:repeat` fails only on a later run, suspect leaked local process,
  port, or data-directory state and inspect the failed run output first.

## Feature Freeze

Do not add new behavior during Phase 5. Only improve reproducibility, diagnostics,
demo scripting, timing margin, and fallback clarity.
