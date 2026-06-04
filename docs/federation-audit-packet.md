# StacyOS Federation Audit Packet

This packet is the reviewer-facing map for the federation demo substrate. It is
intended for security auditors, technical design partners, and customers doing a
first-pass architecture review.

## Scope

In scope:

- `packages/federation`
- federation routes mounted by `server/src/app.ts`
- federation UI and API readers
- CLI verbs for federation, identity rotation, contacts, receipts, and public
  demo tasks
- docs and demo fixtures that define public claims

Out of scope:

- StacyVM
- unrelated agent runtime orchestration
- production directory services
- production witness network operations
- third-party LLM provider security

## Security-Critical Primitives

| Primitive | Purpose | Primary Files |
| --- | --- | --- |
| Install identity | Ed25519 install keypair and install id derivation | `packages/federation/src/identity/install-identity.ts` |
| Key transition | Dual-signed install key rotation | `packages/federation/src/identity/key-transition.ts` |
| Knowledge Object | Signed, content-addressed context object | `packages/federation/src/ko/knowledge-object.ts` |
| Consent grant | Signed per-object read/write/admin authorization | `packages/federation/src/consent/grant.ts` |
| Group roster | Signed producer-owned membership list | `packages/federation/src/consent/group-roster.ts` |
| Delegation grant | Signed delegation primitive | `packages/federation/src/consent/delegation.ts` |
| Revocation tombstone | Producer-signed revocation evidence | `packages/federation/src/consent/revocation.ts` |
| Witnessed revocation | Witness-signed attestation over a tombstone | `packages/federation/src/consent/witnessed-revocation.ts` |
| Federation message | Signed A-to-B delivery envelope with nonce | `packages/federation/src/sync/federation-message.ts` |
| Receipt chain | Per-KO and global tamper-evident audit log | `packages/federation/src/receipts/receipt-store.ts` |
| Adapter contracts | Schema-validated AI-generated KO surfaces | `packages/federation/src/dashboard/adapter-output.ts` |

## Canonical Review Questions

1. Can a malformed or non-canonical object verify?
2. Can a KO be altered without changing the content hash?
3. Can a grant authorize the wrong install, group, producer, tenant, or KO hash?
4. Can a removed group member still read through an old roster?
5. Can a consumer mutate a producer-owned KO through write scope?
6. Can revocation be bypassed by replay, expiry, bad tombstone binding, or offline
   state?
7. Can witness policy accept forged, untrusted, or insufficient witnesses?
8. Can receipts be edited, deleted, or globally rolled back without detection?
9. Can key rotation sever provenance or silently impersonate a prior install?
10. Can adapter execution leak data without operator acknowledgement or column
    redaction metadata?

## Test Matrix

Run these commands from the repository root:

```bash
pnpm --filter @arpanstacy/stacy-federation typecheck
pnpm --filter @arpanstacy/stacy-federation test
pnpm --filter @arpanstacy/stacy-federation demo:public
pnpm --filter @arpanstacy/stacy-federation demo:public:adapter-smoke
pnpm --filter @arpanstacy/stacy typecheck
pnpm --filter @arpanstacy/stacy-server typecheck
pnpm --filter @arpanstacy/stacy-ui typecheck
```

Focused audit tests:

```bash
pnpm --filter @arpanstacy/stacy-federation exec vitest run \
  src/ko/knowledge-object.test.ts \
  src/consent/grant.test.ts \
  src/consent/enforcement.test.ts \
  src/consent/group-roster.test.ts \
  src/consent/delegation.test.ts \
  src/consent/witnessed-revocation.test.ts \
  src/identity/key-transition.test.ts \
  src/receipts/receipt-store.test.ts \
  src/sync/federation-message.test.ts \
  src/verification/content-contract.test.ts
```

## Known Limitations

- The live public demo is still N=2 by design.
- Contact share links require an out-of-band channel; there is no public directory
  service.
- Witnessed revocation has protocol and enforcement support, but no production
  witness operator network.
- Group and delegation primitives are present; production org policy UX is still
  early.
- Key rotation records identity continuity; it does not yet publish a global
  transparency log.
- Adapter redaction is column-level and operator-selected; it is not automated
  PHI/PII detection.
- The healthcare referral fixture is synthetic and must never contain real PHI.

## Review Artifacts

- [Security contract](../packages/federation/SPEC.md)
- [Threat model](federation-threat-model.md)
- [Schema compatibility](federation-schema-compatibility.md)
- [Technical deep dive](federation-demo-technical-deep-dive.md)
- [Public demo runbook](../packages/federation/DEMO_RUNBOOK.md)
- [Security questionnaire](federation-security-questionnaire.md)
- [Design partner plan](federation-design-partner-plan.md)
