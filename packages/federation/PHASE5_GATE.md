# StacyOS Federation Phase 5 Gate

Status: complete.

Phase 5 is feature freeze. The goal is to make the existing federation demo
boringly reproducible without changing the federation behavior.

## Demo Check

Run from the `stacy-cli` repo root:

```bash
pnpm --filter @arpanstacy/stacy-federation demo:check
```

This command runs:

1. preflight file/runtime checks
2. federation package typecheck
3. six-criterion acceptance contract
4. real DB smoke
5. real two-install server smoke

The real smoke tests start local services and bind loopback ports. In sandboxed
agent environments they may need explicit permission for localhost process and
embedded Postgres access.

## Individual Commands

```bash
pnpm --filter @arpanstacy/stacy-federation preflight
pnpm --filter @arpanstacy/stacy-federation typecheck
pnpm --filter @arpanstacy/stacy-federation test
pnpm --filter @arpanstacy/stacy-federation test:acceptance
pnpm --filter @arpanstacy/stacy-federation smoke:db
pnpm --filter @arpanstacy/stacy-federation smoke:server
pnpm --filter @arpanstacy/stacy-federation demo:repeat
pnpm --filter @arpanstacy/stacy-server typecheck
pnpm --filter @arpanstacy/stacy typecheck
```

## Feature Freeze Rules

- Do not add new federation behavior.
- Do not modify `stacyvm`.
- Keep security-critical code in `packages/federation`.
- Use Phase 5 only for reproducibility, clearer failures, demo scripts,
  repeated harness checks, and timing margin.

## Current Reliability Additions

- Package scripts for preflight, acceptance, real DB smoke, real server smoke,
  and full demo check.
- Preflight checks for required local files and runtime entrypoints before the
  slower demo tests start.
- Repeated harness setup/cleanup test to catch state leakage across runs.
- Demo runbook with clean-checkout setup, one-command verification, storyboard,
  and troubleshooting notes.
- Repeat runner for full `demo:check` loops.
- Real two-install revoke smoke asserts the full revoke path remains under the
  four-minute demo bar.

## Latest Local Demo Check

`pnpm --filter @arpanstacy/stacy-federation demo:check` passed locally:

- acceptance contract: 6 tests passed
- real DB smoke: 4 tests passed
- real two-install server smoke: 4 tests passed
- real server smoke duration: about 53 seconds

Final Phase 5 repeat gate:

`STACY_FEDERATION_DEMO_REPEAT=3 pnpm --filter @arpanstacy/stacy-federation demo:repeat`
passed locally:

- repeated full demo checks: 3/3 passed
- run 1: 63.03 seconds
- run 2: 57.03 seconds
- run 3: 57.18 seconds
- slowest run: 63.03 seconds

Cross-package wiring checks also passed:

- `pnpm --filter @arpanstacy/stacy-server typecheck`
- `pnpm --filter @arpanstacy/stacy typecheck`

## Completion Criteria

- One-command demo verification exists.
- Repeated full demo verification exists.
- Clean-checkout runbook exists.
- Real DB persistence is covered.
- Real two-install server flow is covered.
- Full revoke path has a real-smoke timing assertion under four minutes.
- No new federation behavior was added during Phase 5.
