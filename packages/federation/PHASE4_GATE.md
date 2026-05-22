# StacyOS Federation Phase 4 Gate

Status: implementation complete.

Phase 4 proves revocation and durable receipts:

1. Install A can create a signed revocation tombstone with `stacy revoke`.
2. Install B checks A's revocation state on the next federated read.
3. B denies/redacts the read after revocation without A pushing a message to B.
4. Receipts cover the required event set and persist in Stacy Postgres.
5. The full acceptance contract has no TODOs.

## Implemented Scope

- Signed revocation tombstones:
  - canonical serialization
  - Ed25519 signature
  - tamper/forge adversarial tests
- Revocation tombstone store in existing Stacy Postgres/Drizzle persistence.
- `stacy revoke <ko_id> --reason <text>`.
- Producer revocation lookup endpoint:
  - `GET /api/federation/revocations?koId=...&grantId=...`
- Share message revocation lookup metadata:
  - `stacy share --revocation-url <url>`
- Consumer next-read revocation pull:
  - `brain show --as-consumer` checks the producer lookup URL first
  - pulled tombstones are stored locally on B
  - the existing read-time enforcement path denies the read
- Required receipt events:
  - `create`
  - `sign`
  - `share`
  - `receive`
  - `store`
  - `read`
  - `deny`
  - `revoke`
- Receipt persistence verified through a fresh DB client in the real DB smoke.

## Acceptance State

All six acceptance criteria are green in `test/acceptance/federation-demo.acceptance.test.ts`:

- Green: `TIME`
- Green: `INSTALLS`
- Green: `SIGNED KO`
- Green: `PER-OBJECT CONSENT`
- Green: `REVOKE`
- Green: `RECEIPTS`

The fast acceptance test is deterministic. The gated real-server smoke is the black-box
proof for the operational path:

- starts two isolated Stacy installs
- creates on A
- federates to B through `/api/federation`
- reads on B with valid consent
- denies expired grant
- revokes on A
- denies B's next read without producer push

## Scope Guard

No blockchain, schema registry, delegation chain, or multi-install coordination kernel
was added. Revocation remains read-time consumer enforcement, not producer fan-out.
`stacyvm` was not modified.

## Final Verification

Run from the `stacy-cli` repo root:

```bash
pnpm --filter @arpanstacy/stacy-federation typecheck
pnpm --filter @arpanstacy/stacy-federation test
pnpm --filter @arpanstacy/stacy-server typecheck
pnpm --filter @arpanstacy/stacy typecheck
STACY_FEDERATION_REAL_DB_SMOKE=1 pnpm --filter @arpanstacy/stacy-federation test -- src/brain/local-brain.integration.test.ts
STACY_FEDERATION_REAL_SERVER_SMOKE=1 pnpm --filter @arpanstacy/stacy-federation test -- test/harness/real-two-install-smoke.test.ts
pnpm typecheck
```

The two `STACY_FEDERATION_REAL_*` commands start real local services and may require
sandbox permission for local ports, embedded Postgres, and process IPC.

## Phase 5 Handoff

Phase 5 is reliability only:

- no new federation behavior
- clean-checkout setup hardening
- repeatability and timing margin
- demo script polish
- fallback messaging for unavailable optional systems
