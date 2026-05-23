# StacyOS Federation Threat Model

This threat model covers the public federation demo substrate and the
product-ready protocol extensions built on top of it.

## Assets

- Install private keys
- Signed Knowledge Objects
- Consent grants
- Group rosters
- Delegation grants
- Revocation tombstones
- Witness attestations
- Receipt logs and global anchors
- Contact cards and share links
- Adapter input records and redacted fields

## Trust Boundaries

| Boundary | Risk | Control |
| --- | --- | --- |
| Install filesystem | Private key disclosure or tampering | Identity file mode, keypair validation, key transition backup |
| A-to-B federation HTTP | Replay or message tampering | Signed message envelope, nonce, replay window, persistent nonce log, HTTPS-off-loopback policy |
| Contact exchange | Fake endpoint or install id | Signed contact cards, signed expiring share links |
| Read enforcement | Unauthorized access after share/revoke changes | Grant verification, roster verification, revocation lookup, witnessed policy |
| Adapter process | Input records leave install | `--ack-egress`, timeout, allowlist, redaction, schema-validated output |
| Audit store | Receipt edits or deletion | Per-KO receipt chain and global anchor chain |
| Key lifecycle | Identity continuity loss after rotation | Dual-signed key transition chain |

## STRIDE Summary

| Category | Example Attack | Current Defense |
| --- | --- | --- |
| Spoofing | Attacker claims to be Eastside Specialty | Contact card signature and install id derivation |
| Tampering | Modify KO content after share | Canonical content hash and Ed25519 signature |
| Repudiation | Producer denies sharing or revoking | Signed grants, tombstones, receipts |
| Information disclosure | Adapter receives sensitive columns | Explicit egress acknowledgement and redaction metadata |
| Denial of service | Adapter hangs public demo | Adapter timeout and deterministic fallback |
| Elevation of privilege | Group member reads after removal | Latest signed roster check at read time |

## Important Failure Modes

### Revocation Endpoint Unreachable

The safer product posture is deny-by-default when revocation state cannot be
verified for a federated read. Error UX should say that access could not be
verified, not that the data is missing.

### Stale Contact Card

A valid old contact card can point to an obsolete endpoint. This is not a
signature failure. Operators need expiry and replacement UX; the current link
wrapper already supports expiry.

### Witness Threshold Not Met

Under `producer_only`, the producer tombstone is enough. Under `witnessed`, the
consumer should not accept the tombstone as authoritative unless the configured
threshold is met by valid, trusted witness attestations.

### Key Rotation Chain Broken

Old KOs still verify against their embedded signer, but continuity from old
install id to new install id fails. UI and audit tools should display this as an
identity-chain failure rather than a KO signature failure.

## Security Review Checklist

- Verify canonicalization rejects undefined, non-finite numbers, and circular
  structures.
- Verify every signature covers the fields relied on by enforcement.
- Verify storage refuses invalid signed objects.
- Verify replay rejection happens before KO/grant/receipt writes.
- Verify revocation checks happen at read time, not only at receive time.
- Verify group membership is evaluated against the latest roster.
- Verify delegated sharing cannot occur without a valid delegation grant.
- Verify witness policy cannot be satisfied by duplicated witness ids.
- Verify receipt chain checks detect missing, edited, reordered, or hash-mismatched
  records.
- Verify adapter invalid JSON fails before KO creation.

## Open Security Work

- External security audit.
- Production witness server/operator model.
- Automated PHI/PII detection before adapter egress.
- Key transition transparency publication.
- Cross-machine deployment hardening beyond loopback demo.
