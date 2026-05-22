# StacyOS Federation SPEC Review Checklist

Use this checklist for the Phase 1 human review of `SPEC.md`. Do not start
crypto implementation until each item is either accepted or explicitly changed in
`SPEC.md`.

## Security Model

- [ ] The demo invariant is correct: consent and revocation are enforced by the
  consumer at read time.
- [ ] Revocation on next read does not depend on producer fan-out pushes.
- [ ] N=2 demo scope is intentionally smaller than a general federation protocol.

## Signed Object Pattern

- [ ] Canonical serialization is mandatory and shared by all signed object types.
- [ ] Knowledge Objects hash the canonical unsigned payload before signing the
  canonical signed payload.
- [ ] Consent grants and revocation tombstones name all fields required to reject
  wrong signer, wrong consumer, wrong tenant, wrong KO, expiry, and tampering.
- [ ] The spec avoids new crypto-path dependencies unless explicitly reviewed.

## Persistence And Boundary

- [ ] Brain and receipts use existing Stacy embedded Postgres/Drizzle persistence.
- [ ] No separate SQLite store is introduced for the demo.
- [ ] All security-critical federation code remains in `packages/federation`.
- [ ] Cross-package edits are limited to CLI registration, server route mount,
  workspace/package wiring, and repo guidance docs.
- [ ] `stacyvm` remains optional and unmodified.

## Acceptance Harness

- [ ] The harness creates two isolated installs with separate homes, configs,
  server ports, embedded Postgres ports, storage, logs, backups, and secrets.
- [ ] The real lifecycle smoke passes with
  `STACY_FEDERATION_REAL_SERVER_SMOKE=1 pnpm --filter @arpanstacy/stacy-federation test`.
- [ ] The six acceptance criteria are represented in the test suite before
  feature implementation begins.
