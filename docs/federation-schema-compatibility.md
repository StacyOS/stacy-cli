# Federation Schema Compatibility

This document is the compatibility policy for public demo Knowledge Object
content contracts.

## Policy

- Signed KOs are immutable. Migration never rewrites old signed payloads.
- Readers verify old KOs by supporting their historical contract version.
- New contract versions are additive unless a SPEC revision explicitly says
  otherwise.
- Unknown versions fail clearly during verification instead of being accepted as
  best-effort JSON.
- Content hash and signature verification happen before contract checks.

## Compatibility Matrix

| Content kind | Supported versions | Notes |
|---|---:|---|
| `dashboard` | `1` | Existing public dashboard contract. Missing `schemaVersion` is treated as v1 for backward compatibility. |
| `report` | `1` | Existing report contract. Missing `schemaVersion` is treated as v1 for backward compatibility. |
| `table` | `1` | Existing table contract. Missing `schemaVersion` is treated as v1 for backward compatibility. |
| `referral_packet` | `1`, `2` | v1 is the healthcare referral contract. v2 is additive and may include fields such as `carePriority`. |

## Referral Packet v1

Required fields:

- `kind: "referral_packet"`
- `schemaVersion: 1`
- `patientReference`
- `referralReason`
- `clinicalSummary`
- `labSnapshot`
- non-empty `medications[]`
- `imagingStatus`
- `consent.expiresAt`
- `consent.revocationReason`

## Referral Packet v2

v2 keeps all v1 requirements and allows additive fields. The first v2 fixture
uses `carePriority` to prove new readers can support a newer contract without
breaking v1 KOs.

## Migration Rule

When adding v3 or any future version:

1. Add the new version to `CONTENT_CONTRACT_COMPATIBILITY`.
2. Keep validators for all previously supported versions.
3. Add a fixture test proving the old version still passes.
4. Add a fixture test proving the new version passes.
5. Add a negative test proving an unknown version fails with a clear reason.
6. Update this compatibility matrix.

Do not mutate old signed KOs to "upgrade" them. If a new representation is
needed, create a new KO that references the old one.
