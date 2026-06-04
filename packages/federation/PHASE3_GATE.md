# StacyOS Federation Phase 3 Gate

Status: implementation complete for the Day-60 kill-switch scope.

Phase 3 proves the two-install federation and consent path:

1. Install A creates a signed Knowledge Object in Stacy Postgres.
2. Install A creates a signed per-object consent grant for install B.
3. `stacy share` wraps the KO and grant in a signed federation message.
4. Install B receives the message through `POST /api/federation`.
5. Install B stores the KO as federated/read-only and stores the grant.
6. `stacy brain show --as-consumer <install_b>` enforces consent at read time.
7. Expired grants deny reads through the same CLI read path.
8. Lightweight share/receive/store receipts are appended on the relevant installs.

## Implemented Scope

- Signed consent grant creation and verification.
- Consent grant persistence in the existing Stacy Postgres/Drizzle stack.
- Read-time enforcement for federated KOs:
  - missing grant denies
  - expired grant denies
  - wrong consumer denies
  - wrong producer, tenant, KO id, or KO hash denies
- Signed federation KO message envelope.
- Message signature verification before B stores KO or grant state.
- Package-owned receive API handler for `/api/federation`.
- Server route mount: `POST /api/federation`.
- `stacy share <ko_id> --with <install_id> --to <url> --scope read --expires <duration> --revocable`.
- `stacy brain show <ko_id> --as-consumer <install_id>`.
- Real two-install server smoke:
  - starts two isolated Stacy installs
  - creates on A
  - POSTs to B's `/api/federation`
  - reads on B with consent
  - denies B read when grant is expired
- Phase 3 receipt hooks:
  - A appends `share`
  - B appends `receive`
  - B appends `store`

## Acceptance State

- Green: `INSTALLS`
- Green: `SIGNED KO`
- Green: `PER-OBJECT CONSENT`
- Proven in gated real-server smoke: create on A -> federate through B server -> read on B.
- Proven in gated real-server smoke: expired grant denies B read.
- Partially implemented ahead of Phase 4: share/receive/store receipts.
- Deferred to Phase 4: revocation tombstone and revoke-on-next-read.
- Deferred to Phase 4/5: full timed create -> federate -> read -> revoke loop under 4 minutes.
- Deferred to Phase 4: full durable receipt acceptance after restart for all events.

## Scope Guard

No schema registry, blockchain, delegation chain, compatibility kernel, or multi-install
coordination layer was added. StacyVM was not modified.

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

## Phase 4 Handoff

Start Phase 4 with signed revocation tombstones and extend the existing read-time
enforcement path. Do not add push-based revocation fan-out; the consumer must deny on
the next read by checking revocation state through the same read path.
