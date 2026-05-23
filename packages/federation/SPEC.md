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

## Contact Cards

A signed contact card is an install-issued discovery object for the N=2 demo. It
contains the install id, public key, federation endpoint, revocation endpoint,
label, tenant, and created timestamp, then signs those canonical bytes with the
install Ed25519 key.

Import verification must reject cards where:

- the signature is invalid
- the payload install id does not match the signer install id
- the public key does not derive the payload install id
- the signer public key differs from the payload public key
- the contact name is malformed after normalization

Contact cards are discovery metadata only. They do not grant consent, do not
change KO signing semantics, and do not replace the producer revocation lookup
URL embedded in a revocable share.

## Federation Transport Hardening

Federation endpoint URLs must use HTTPS outside the local demo loopback path.
`http://` is accepted only for loopback hostnames such as `127.0.0.1`,
`127.x.x.x`, `localhost`, and `::1`. The same policy applies to A-to-B
federation delivery URLs and producer revocation lookup URLs.

The Stacy server can serve HTTPS directly when `server.tls.enabled` is true and
`server.tls.certPath` / `server.tls.keyPath` point at PEM files, or through the
matching `STACY_SERVER_TLS_*` environment variables. When TLS is enabled and no
explicit public base URL is configured, runtime API discovery advertises
`https://` origins. The local harness remains HTTP loopback by default.

Every A-to-B federation KO message includes a signed nonce and signed
`createdAt` timestamp. Consumers reject messages that are outside the demo replay
window or reuse a nonce already accepted by the receiver install.

For the public N=2 demo:

- loopback HTTP is allowed so the local harness remains copy-pasteable
- the replay window is 60 seconds
- the nonce is part of the signed federation message payload
- accepted nonces are persisted in `federation_received_nonces` with expiry
- replay checks happen after signature verification and before storage
- freshness failure must not store the KO, grant, revocation source, or receipts

This is transport hardening only. It does not replace object signatures, consent
grants, revocation tombstones, or read-time enforcement.

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

## Public Task Adapter Output

`stacy run "<task>" --input <file>` is deterministic by default. When an adapter
is supplied, adapter execution must remain bounded by timeout, optional allowlist,
and explicit `--ack-egress`.

Task KOs support three public content contracts selected with
`--output-kind dashboard|report|table`. The default is `dashboard`, preserving
the public demo storyboard.

Adapter stdout has two supported modes:

- `--adapter-output text`: stdout is stored as narrative `adapterOutput`, while
  the selected KO content remains deterministic.
- `--adapter-output json`: stdout must be valid JSON matching the selected
  `--output-kind` contract:
  - `dashboard`: optional `title`, optional `summary`, non-empty `widgets[]`
    with `kind`, `label`, and string/number `value`, plus optional string
    `notes[]`.
  - `report`: non-empty `summary`, optional `title`, optional `sections[]`
    with non-empty `heading` and `body`, plus optional string `notes[]`.
  - `table`: non-empty `columns[]`, non-empty `rows[]`, each row object
    containing string/number/boolean/null values for the declared columns, plus
    optional `title`, `summary`, and string `notes[]`.

Invalid JSON adapter output must fail before KO creation. Valid JSON adapter
output may own the selected content surface while the KO still records the
original input file name, row count, and content hash.

Adapter stdin may redact selected CSV columns through `--redact-column` or
`STACY_PUBLIC_DEMO_REDACT_COLUMNS`. Redaction applies only to the JSON sent to
the adapter process. The KO still records the original file hash and row count,
plus `redactedColumns[]` metadata when redaction was used.

CSV input parsing supports UTF-8 text with optional BOM, CRLF or LF line
endings, quoted commas, escaped quotes, multiline quoted cells, and blank
trailing lines. Malformed unclosed quoted fields must fail before KO creation.

## Consent Grant

A consent grant is a signed object authorizing one consumer install to exercise a
bounded capability against one KO.

Minimum payload:

- object kind: `consent_grant`
- schema version
- tenant
- KO id or content hash
- producer install id
- consumer install id
- scope: one of `read`, `write`, or `admin`
- expiry timestamp
- revocable flag
- created timestamp

Scope semantics for the public demo roadmap:

- `read`: consumer can read the federated KO while the grant is valid.
- `write`: consumer can read the federated KO and, in Phase S, create a new
  consumer-signed derived KO that references the original. The original remains
  immutable and producer-signed; write never lets the consumer mutate A's KO.
- `admin`: reserved for future delegation/admin operations. For now it includes
  read capability but does not enable re-sharing, revocation by the consumer, key
  rotation, or producer-side mutation.

Read access requires a valid, unexpired grant matching the consumer, producer,
tenant, KO hash, and a scope that includes read capability (`read`, `write`, or
`admin`). `write` is implemented as derived-KO creation in Phase S. `admin`
remains signed and verifiable but reserved until the corresponding SPEC revision
and tests land.

Derived KO semantics for Phase S:

- a derived KO is a new signed Knowledge Object created by the consumer install
- it must reference the original KO id, original content hash, producer install id,
  and grant id in signed content/provenance
- it must not overwrite the original KO or change its content hash/signature
- producer revocation of the source grant must deny future derived writes, while
  already-created derived KOs remain independently signed artifacts
- `stacy brain derive <source_ko_id> --content-json <json>` is the user-facing
  Phase S operation for creating a derived KO

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
- derive

Receipt records must survive restart and must never be updated in place through the
federation package API.

Receipts are tamper-evident per Knowledge Object. Every new receipt includes the
previous receipt hash for the same KO and its own canonical SHA-256 receipt hash.
Verification fails if a receipt is edited, deleted from the middle of the chain,
or linked to the wrong predecessor.

Receipts are also anchored in an instance-level global chain. Every appended
receipt advances `federation_receipt_anchors` with the previous global anchor
hash, anchored receipt id, anchored receipt hash, and its own canonical SHA-256
anchor hash. The latest anchor hash is mirrored into
`federation_receipt_chain_head`. Global verification fails if an anchor is
edited, forked, unlinked, points to a missing or hash-mismatched receipt, or no
longer matches the instance head. This does not replace the per-KO chain; it
prevents deleting one KO's entire receipt history without breaking the
instance-level anchor trail.

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
