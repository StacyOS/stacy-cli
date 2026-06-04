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

## Contact Share Links

A contact share link is a short-lived signed envelope around a signed contact
card. The link payload contains the card, created timestamp, and expiry
timestamp, then signs those canonical bytes with the same install Ed25519 key.

Import-link verification must reject links where:

- the share-link signature is invalid
- the share-link signer does not match the nested contact-card signer
- the link is expired at import time
- the nested contact card fails contact-card verification

Share links are a transport convenience for exchanging contact cards through
email, chat, QR code, or another out-of-band channel. They do not grant consent
and must still be followed by an explicit per-object share.

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
bounded capability against one KO. The original v1 grant shape targeted one
install through `consumerInstallId`; product-ready grants may also carry a
`recipient` object so the target can be an install or a signed group roster.

Minimum payload:

- object kind: `consent_grant`
- schema version
- tenant
- KO id or content hash
- producer install id
- consumer install id or group id, retained as `consumerInstallId` for storage
  compatibility
- recipient:
  - `{ type: "install", id: <install_id> }`
  - `{ type: "group", id: <group_id>, role?: <role_name> }`
- scope: one of `read`, `write`, or `admin`
- expiry timestamp
- revocable flag
- created timestamp

Scope semantics for the public demo roadmap:

- `read`: consumer can read the federated KO while the grant is valid.
- `write`: consumer can read the federated KO and create a new consumer-signed
  derived KO that references the original. Product meaning: an annotation,
  response, revision proposal, or counter-KO. The original remains immutable and
  producer-signed; write never lets the consumer mutate A's KO.
- `admin`: reserved for future delegation/admin operations. For now it includes
  read capability but does not enable re-sharing, revocation by the consumer, key
  rotation, or producer-side mutation.

Read access requires a valid, unexpired grant matching the consumer, producer,
tenant, KO hash, and a scope that includes read capability (`read`, `write`, or
`admin`). `write` is implemented as derived-KO creation. `admin`
remains signed and verifiable but reserved until the corresponding SPEC revision
and tests land.

Group grant semantics:

- a group id must start with `group_`
- the group grant recipient must point at a signed group roster
- the roster must be signed by the producer install that signed the grant
- the roster tenant must match the grant tenant
- the reading install must appear in the roster, and must match the requested
  role when the grant recipient includes a role
- removing a member from the latest signed roster denies that install's next read

Role grant semantics are intentionally narrow in this phase: roles are labels on
signed roster members, not standalone identities. A role-targeted grant is
therefore enforced by checking membership in the producer-signed roster plus a
matching `member.role` value.

Derived KO semantics:

- a derived KO is a new signed Knowledge Object created by the consumer install
- it must reference the original KO id, original content hash, producer install id,
  and grant id in signed content/provenance
- it must not overwrite the original KO or change its content hash/signature
- producer revocation of the source grant must deny future derived writes, while
  already-created derived KOs remain independently signed artifacts
- `stacy brain derive <source_ko_id> --content-json <json>` is the user-facing
  operation for creating a derived KO

## Group Roster

A group roster is a producer-signed object binding a human-readable group label
to install members and optional role labels.

Minimum payload:

- object kind: `group_roster`
- schema version
- tenant
- group id
- label
- members: `{ installId, label?, role? }[]`
- created timestamp
- roster hash

Rosters do not grant access by themselves. They are membership evidence used by
group-targeted consent grants. Tampering with membership, label, group id, tenant,
or creation timestamp must break the roster hash or signature.

### Group Roster Updates

Read-time enforcement uses the latest producer-signed roster available for the
granted group. If a producer removes an install from the latest roster, that
install's next read fails with `Consumer not in producer's latest group roster`
and appends a `deny` receipt. If a producer adds an install to the latest roster,
that install can read on its next attempt as long as the grant, role, expiry, KO
binding, and revocation checks also pass.

## Delegation Grant

A delegation grant is a consumer-signed object that records an intended re-share
from a delegated consumer to another install or group. It is bound to:

- tenant
- KO id and content hash
- producer install id
- delegate install id
- recipient install or group
- source grant id
- scope
- expiry
- revocability
- delegation hash

Delegation verification checks the delegate signature, hash, KO binding,
producer binding, delegate binding, expiry, and optional producer revocation
tombstone targeting the delegation id.

Delegation depth is capped at 4 signed delegation grants. A chain with depth 5
or greater must fail with: `Delegation chain depth 5 exceeds the limit of 4.`
The depth cap prevents unbounded re-share chains while keeping simple
department/team handoffs possible.

Product rule: consumers must not re-share producer KOs unless a verified
delegation grant authorizes that action. The signed delegation object and
revocation checks exist in this phase; the public `stacy share` command still
rejects `--scope admin` until the full delegated delivery path is wired.

## Content Contract Versioning

Signed KO content contracts are versioned independently from the cryptographic KO
envelope. Verification policy:

- content hash and signature checks run before content-contract checks
- old signed KOs are never rewritten during migration
- missing `schemaVersion` on legacy `dashboard`, `report`, and `table` content is
  treated as v1
- `referral_packet` supports schema versions 1 and 2
- unknown versions fail verification clearly with `content_contract_version`

The compatibility matrix lives in `docs/federation-schema-compatibility.md` and
is enforced by `validateKnowledgeContentContract`.

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

## Install Key Rotation

Install keys can rotate without invalidating historical Knowledge Objects. Old
KOs continue to verify against the signer embedded in their envelope. Continuity
between the old install id and new install id is proven by a dual-signed key
transition object.

Minimum transition payload:

- object kind: `install_key_transition`
- schema version
- old install id and old public key
- new install id and new public key
- effective timestamp
- created timestamp
- optional reason

The transition is canonicalized once, then signed by both the old private key and
the new private key. Verification requires:

1. Old and new install ids derive from their public keys.
2. The old signature verifies with the old public key.
3. The new countersignature verifies with the new public key.
4. The transition id matches the canonical payload hash.
5. Multi-step chains link each transition's old install id to the previous
   transition's new install id.

`stacy identity rotate` stores the transition before replacing the active
identity file and writes a local backup of the previous identity. `stacy identity
verify-chain` verifies all recorded transitions for the install database.

## Witnessed Revocation

High-stakes KOs can require external witness evidence before a revocation is
accepted as authoritative by the consumer. The producer still creates the normal
revocation tombstone. One or more witness identities then sign an attestation
over that tombstone.

Minimum witnessed revocation payload:

- object kind: `witnessed_revocation`
- schema version
- tenant
- KO id and content hash
- tombstone id and tombstone hash
- producer install id
- witness id and label
- witnessed timestamp

Witness ids are derived from the witness public key:
`witness_${sha256(publicKeyPem)[0..32]}`. Verification requires the witnessed
payload to bind exactly to a valid producer tombstone, the witness id to derive
from the witness public key, and the witness signature to verify over the
canonical witnessed payload.

Consumers can enforce one of two revocation policies:

- `producer_only`: the producer tombstone alone is sufficient.
- `witnessed`: the tombstone must be accompanied by at least N valid witness
  attestations, optionally from a trusted witness allowlist.

If the witness threshold is not met, the consumer does not treat the tombstone as
accepted under that policy. This is a policy layer on top of the existing
producer-signed tombstone; it does not change tombstone format.

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
- no multi-install coordination kernel
- no StacyVM changes

## Acceptance Contract

The acceptance harness must prove:

1. Full create -> federate -> read -> revoke loop finishes in under 4 minutes.
2. The loop uses two isolated installs and tenant `stacy/acme`.
3. KO signatures and hashes verify; tampering fails.
4. Per-object consent is required and expiry is enforced.
5. Revocation is honored on next read without a push from A to B.
6. Receipts persist on both installs after restart.
