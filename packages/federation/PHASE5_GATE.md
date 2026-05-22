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

- acceptance contract: 7 tests passed
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

## Public Demo Addendum

The post-Phase-5 public-demo layer adds:

- CSV-backed `stacy run "<task>" --input <csv>` KO creation.
- Signed contact-card export/import for peer setup:
  - `stacy contacts export meera --out meera.contact-card.json`
  - `stacy contacts import meera.contact-card.json --as meera`
- Federation contact book resolution for `--with-contact meera`.
- Optional adapter-backed public demo path:
  - `pnpm --filter @arpanstacy/stacy-federation demo:public:adapter-smoke`
- Tamper-evident receipt verification:
  - `stacy receipts verify --ko <ko_id>`
- Cross-KO receipt anchoring:
  - `stacy receipts verify --global`
- Transport replay hardening:
  - signed federation message nonce
  - 60-second signed timestamp replay window
  - duplicate nonce rejection before storage
- Optional HTTPS serving for non-loopback federation demos:
  - `server.tls.enabled`
  - `server.tls.certPath`
  - `server.tls.keyPath`
  - `STACY_SERVER_TLS_*` environment overrides
- Public demo script and repeat gate:
  - `pnpm --filter @arpanstacy/stacy-federation demo:public`
  - `STACY_FEDERATION_PUBLIC_DEMO_REPEAT=3 pnpm --filter @arpanstacy/stacy-federation demo:public:repeat`
- Receipt summary command:
  - `stacy receipts list --ko <ko_id>`

Phase P public-readiness polish confirms:

- Existing config files do not need a `server.tls` block.
- TLS-enabled configs parse cleanly with PEM cert/key paths.
- Release notes no longer claim server TLS is missing.
- Public demo docs include both per-KO and global receipt verification.

See `PUBLIC_DEMO_GATE.md` for the public-demo proof and latest timing.

Public demo gate status: complete.
