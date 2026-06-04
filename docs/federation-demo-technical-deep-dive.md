# Federation Demo Technical Deep Dive

Use this after the quickstart and conceptual guide.

## Core References

- Security contract: `packages/federation/SPEC.md`
- Public runbook: `packages/federation/DEMO_RUNBOOK.md`
- Public gate: `packages/federation/PUBLIC_DEMO_GATE.md`
- OpenAPI: `docs/openapi/federation.yaml`

## Main Commands

```bash
pnpm --filter @arpanstacy/stacy-federation demo:public
pnpm --filter @arpanstacy/stacy-federation demo:public:cached-adapter
pnpm --filter @arpanstacy/stacy-federation demo:adversarial
pnpm --filter @arpanstacy/stacy-federation demo:check
```

## Signed Objects

- Knowledge Object: signed content, content hash, provenance.
- Consent Grant: signed producer permission for a consumer install.
- Revocation Tombstone: signed denial of an existing grant.
- Contact Card: signed install discovery metadata.
- Contact Share Link: short-lived signed envelope around a contact card.
- Receipt: append-only audit event with per-KO and global anchor chains.

## API Surface

- `GET /api/federation/v1/ko/:id`
- `GET /api/federation/ko/:id`
- `GET /api/federation/metrics`
- `GET /api/federation/brain/:koId/events`
- `GET /api/federation/revocations?koId=...`

## Troubleshooting

- If public demo setup fails, run `pnpm --filter @arpanstacy/stacy-federation preflight`.
- If embedded Postgres cannot start, check for port conflicts and rerun the demo.
- If an adapter hangs, use `--adapter-timeout-ms` and inspect adapter stderr.
- If a read denies unexpectedly, check `stacy receipts list --ko <id>` and the revocation URL.
- If a share-link import fails, check expiry and make sure the link was not modified.
