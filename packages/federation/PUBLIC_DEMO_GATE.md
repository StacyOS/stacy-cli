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
- A stores B as contact `meera`.
- `stacy share <ko> --with-contact meera` resolves install ID, federation
  endpoint, and revocation URL from the contact book.
- B reads before revoke with provenance and verification.
- A revokes access.
- B's next read is denied through read-time revocation enforcement.
- Receipts persist on both installs.

## Copy-Paste Gate

Run from the `stacy-cli` repo root:

```bash
pnpm install
pnpm --filter @arpanstacy/stacy-federation preflight
STACY_FEDERATION_PUBLIC_DEMO_REPEAT=3 pnpm --filter @arpanstacy/stacy-federation demo:public:repeat
```

## Latest Local Result

```text
StacyOS public federation demo complete
KO: ko_public_revenue_dashboard
B read before revoke: allowed
A revoked access
B read after revoke: denied
Receipts A: create, sign, share, revoke
Receipts B: store, receive, read, deny
Total runtime: 15.56s
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
pnpm --filter @arpanstacy/stacy-federation demo:check
STACY_FEDERATION_PUBLIC_DEMO_REPEAT=3 pnpm --filter @arpanstacy/stacy-federation demo:public:repeat
```
