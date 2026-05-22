# StacyOS Public Federation Demo Gate

Status: complete.

The public demo closes the Phase 5 report's marketing gap by proving a literal
task-to-KO flow from a real CSV file:

```bash
pnpm --filter @arpanstacy/stacy-federation demo:public
```

## What It Proves

- `stacy run "<task>" --input <csv>` creates a signed dashboard KO.
- KO content is derived from `demo/acme-q2-revenue.csv`.
- CSV parsing covers BOM, CRLF, quoted commas, escaped quotes, multiline quoted
  cells, and blank trailing lines.
- The public Acme demo uses `demo/acme-dashboard.schema.json` for explicit
  CSV-column-to-widget mapping.
- The default generator is deterministic, and `STACY_PUBLIC_DEMO_ADAPTER`
  can switch the public demo to an adapter-command path.
- The adapter-smoke path uses `--adapter-output json`, so the fake adapter owns
  dashboard title, summary, widgets, and notes through a validated JSON contract.
- Adapter stdin supports `--redact-column` and
  `STACY_PUBLIC_DEMO_REDACT_COLUMNS`; redaction affects adapter input only and
  is recorded on the signed KO.
- B exports a signed contact card, and A verifies/imports it as contact
  `meera`.
- `stacy share <ko> --with-contact meera` resolves B's install ID and
  federation endpoint from the verified contact book.
- Federation delivery and revocation lookup URLs require `https://` outside the
  local loopback demo; public-demo loopback HTTP remains allowed.
- Stacy server can serve HTTPS directly from configured PEM cert/key paths, and
  advertises `https://` runtime API URLs when TLS is enabled.
- A-to-B federation messages carry a signed nonce and signed timestamp; B
  persists accepted nonces and rejects stale or replayed messages before storage.
- B reads before revoke with provenance and verification.
- A revokes access.
- B's next read is denied through read-time revocation enforcement.
- Receipts persist on both installs.
- Per-KO receipt hash chains verify on both installs.
- Global instance receipt anchors verify on both installs.

## Copy-Paste Gate

Run from the `stacy-cli` repo root:

```bash
pnpm install
pnpm --filter @arpanstacy/stacy-federation preflight
STACY_FEDERATION_PUBLIC_DEMO_REPEAT=3 pnpm --filter @arpanstacy/stacy-federation demo:public:repeat
pnpm --filter @arpanstacy/stacy-federation demo:public:adapter-smoke
```

## Latest Local Result

```text
StacyOS public federation demo complete
KO: ko_public_revenue_dashboard
Generator: deterministic_dashboard
B read before revoke: allowed
A revoked access
B read after revoke: denied
Receipt chain A: valid
Receipt chain B: valid
Global receipt anchor A: valid
Global receipt anchor B: valid
Receipts A: create, sign, share, revoke
Receipts B: store, receive, read, deny
Total runtime: 20.32s
```

Latest adapter-smoke result:

```text
Generator: adapter_command
B read before revoke: allowed
B read after revoke: denied
Receipt chain A: valid
Receipt chain B: valid
Global receipt anchor A: valid
Global receipt anchor B: valid
Total runtime: 21.22s
```

## Repeat Gate

```bash
STACY_FEDERATION_PUBLIC_DEMO_REPEAT=3 pnpm --filter @arpanstacy/stacy-federation demo:public:repeat
```

The repeat gate must pass 3/3 under four minutes per run before a public demo.

Latest repeat gate:

- repeated public demo checks: 3/3 passed
- run 1: 17.96 seconds
- run 2: 17.39 seconds
- run 3: 17.62 seconds
- slowest run: 17.96 seconds

## Final Verification Commands

```bash
pnpm --filter @arpanstacy/stacy-federation typecheck
pnpm --filter @arpanstacy/stacy-federation test
pnpm --filter @arpanstacy/stacy typecheck
pnpm --filter @arpanstacy/stacy-server typecheck
pnpm --filter @arpanstacy/stacy-shared typecheck
pnpm exec vitest run packages/shared/src/config-schema.test.ts server/src/__tests__/runtime-api.test.ts server/src/__tests__/server-startup-feedback-export.test.ts
pnpm --filter @arpanstacy/stacy-federation demo:check
pnpm --filter @arpanstacy/stacy-federation demo:public:adapter-smoke
STACY_FEDERATION_PUBLIC_DEMO_REPEAT=3 pnpm --filter @arpanstacy/stacy-federation demo:public:repeat
```
