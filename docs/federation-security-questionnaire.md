# StacyOS Federation Security Questionnaire

Use this as the first-response document for design partners, security buyers, and
audit firms. Answers should be updated whenever the protocol or deployment model
changes.

## Data Handling

**Does the demo use real patient data?**

No. The healthcare referral demo uses synthetic data only. Real PHI must not be
placed in demo fixtures.

**Where is data stored?**

Federation KOs, grants, tombstones, contacts, receipts, nonces, and protocol
metadata are stored in the Stacy install database. Install private keys are
stored in the local install secrets directory.

**Can an adapter receive sensitive rows?**

Only when the operator explicitly opts into adapter egress with `--ack-egress`.
Operators can redact selected CSV columns before adapter stdin with
`--redact-column` or `STACY_PUBLIC_DEMO_REDACT_COLUMNS`.

## Cryptography

**What signatures are used?**

Install identities use Ed25519. Signed objects use canonical JSON bytes before
hashing and signing.

**How are install ids derived?**

Install ids are derived from the install public key:
`install_${sha256(publicKeyPem)[0..32]}`.

**Can keys rotate?**

Yes. `stacy identity rotate` creates a dual-signed transition from old key to new
key. `stacy identity verify-chain` verifies continuity.

## Authorization

**What can a read grant do?**

Read a specific KO while grant, recipient, expiry, tenant, producer, KO hash, and
revocation checks pass.

**What can a write grant do?**

Create a consumer-signed derived KO that references the original. It does not
mutate the producer-owned source KO.

**Is admin supported?**

`admin` is reserved in the signed grant vocabulary, but product admin behavior is
not enabled unless a future SPEC revision defines it.

**Are group grants supported?**

Yes. Group grants target a producer-signed group roster. Removed members are
denied on the next read.

## Revocation

**When is revocation enforced?**

At read time. Consumers check producer revocation state on next read rather than
depending on producer fan-out.

**Can revocations require witnesses?**

Yes at the protocol/enforcement layer. Consumers can require N valid witnessed
revocation attestations, optionally constrained to trusted witness ids.

## Transport

**Is plaintext HTTP allowed?**

Only for loopback demo URLs. Non-loopback federation and revocation URLs must use
HTTPS.

**How is replay prevented?**

Federation messages carry a signed nonce and timestamp. Accepted nonces are
persisted and checked before storage side effects.

## Auditability

**Are receipts tamper-evident?**

Yes. Receipts are hash-chained per KO and also anchored in a global instance
chain.

**How do I verify receipts?**

```bash
pnpm --filter @arpanstacy/stacy dev -- receipts verify --ko <ko_id>
pnpm --filter @arpanstacy/stacy dev -- receipts verify --global
```

## Current Limitations

- No public witness operator network.
- No production directory service.
- No automated PHI detection.
- No external audit completed yet.
- No real design-partner production deployment yet.
