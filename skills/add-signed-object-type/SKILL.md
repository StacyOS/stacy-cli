---
name: add-signed-object-type
description: Add a signed StacyOS federation object type using the reviewed schema, canonicalization, signature, storage, and adversarial-test pattern.
---

# Add Signed Object Type

Use this skill only inside `packages/federation` unless a task explicitly allows
one of the known federation cross-package wiring edits.

## Required Reading

Read `packages/federation/SPEC.md` before changing code. Treat it as the security
contract.

## Pattern

Apply this sequence for Knowledge Objects, consent grants, revocation tombstones,
and any later signed federation object:

1. Define the schema and signer identity.
2. Add canonical serialization using the shared federation canonicalizer.
3. Hash the canonical unsigned payload when the object is content-addressed.
4. Sign the canonical signed payload bytes with Ed25519.
5. Verify every signed field, signer, hash, and signature.
6. Add storage through the federation Brain or receipt API.
7. Write the happy-path unit test.
8. Write adversarial tests before relying on the object:
   - tampered field
   - wrong signer
   - malformed signature
   - mismatched hash or object reference
   - expired object when expiry exists
9. Run the federation acceptance harness.

## Guardrails

- Do not introduce new crypto-path dependencies without explicit approval.
- Do not use incidental object key order for signed bytes.
- Do not modify `stacyvm`.
- Do not replace read-time enforcement with producer push semantics.
