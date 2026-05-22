# StacyOS Federation Demo Security Contract

This document is the source of truth for `packages/federation`. Every session that
changes federation behavior must read it first. The goal is a falsifiable N=2 demo,
not a general-purpose federation protocol.

## Demo Invariant

Consent is enforced at read time by the consumer. A producer revokes once; consumers
honor revocation on their next read. The implementation must not depend on fan-out
pushes to every consumer.

## Boundary

Security-critical federation code lives in `packages/federation`. Cross-package edits
are limited to package/workspace wiring, CLI verb registration, the server route mount,
and repo guidance docs. `stacyvm` must not be modified.

## Persistence

Federation uses the existing Stacy embedded Postgres/Drizzle persistence stack. The
Brain and receipt log must not introduce a separate SQLite database for the demo.

## Identity Model

Each install has a stable Ed25519 keypair and an install identity document. Demo
identities distinguish:

- person identity: the operator who owns the install
- worker identity: local agent/runtime identity
- install identity: the federation sender or receiver

Signatures are made by the install identity unless a later spec revision explicitly
names a different signer.

## Canonical Serialization

Signed objects are serialized with a deterministic field order before hashing or
signing. Objects must not be signed using incidental `JSON.stringify` insertion order.
The implementation must define one canonical serialization function and reuse it for
Knowledge Objects, consent grants, revocation tombstones, and receipts.

## Knowledge Object

A Knowledge Object is signed, content-addressed JSON.

Minimum unsigned payload:

- object kind: `knowledge_object`
- schema version
- tenant: `stacy/acme` for the demo
- creator install id
- content type
- content JSON
- created timestamp

Hashing and signing order:

1. Canonicalize the unsigned payload.
2. Compute the content hash over those canonical bytes.
3. Build the signed payload with the hash included.
4. Canonicalize the signed payload.
5. Sign those canonical bytes with Ed25519.

Verification fails if any signed field, content field, hash, signer, or signature is
changed.

## Consent Grant

A consent grant is a signed object authorizing one consumer install to read one KO.

Minimum payload:

- object kind: `consent_grant`
- schema version
- tenant
- KO id or content hash
- producer install id
- consumer install id
- scope: `read`
- expiry timestamp
- revocable flag
- created timestamp

Read access requires a valid, unexpired grant matching the consumer, producer, tenant,
KO hash, and `read` scope.

## Revocation Tombstone

A revocation tombstone is a signed object issued by the producer install.

Minimum payload:

- object kind: `revocation_tombstone`
- schema version
- tenant
- KO id or content hash
- revoked grant id when available
- issuer install id
- reason
- created timestamp

Read access fails or redacts when a valid tombstone exists for the KO or grant.

## Receipts

Receipts are append-only audit records stored on both installs where relevant.

Minimum receipt events:

- create
- sign
- share
- receive
- read
- deny
- revoke

Receipt records must survive restart and must never be updated in place through the
federation package API.

## Read-Time Enforcement

`brain show` and every federated read path must:

1. Load the KO and provenance.
2. Verify the KO signature and content hash.
3. If the KO is local, allow the read after verification.
4. If the KO is federated, require a valid consent grant.
5. Reject expired grants.
6. Reject grants for the wrong consumer, tenant, producer, or KO hash.
7. Check for revocation tombstones.
8. Deny or redact the content if any check fails.
9. Append a read or deny receipt.

## Explicit Non-Goals

- no blockchain or data availability layer
- no schema registry
- no delegation chains
- no multi-install coordination kernel
- no key rotation for the 90-day demo
- no StacyVM changes

## Acceptance Contract

The acceptance harness must prove:

1. Full create -> federate -> read -> revoke loop finishes in under 4 minutes.
2. The loop uses two isolated installs and tenant `stacy/acme`.
3. KO signatures and hashes verify; tampering fails.
4. Per-object consent is required and expiry is enforced.
5. Revocation is honored on next read without a push from A to B.
6. Receipts persist on both installs after restart.
