# StacyOS Federation Phase 2 Gate

Status: implementation complete.

Phase 2 proves the single-install Brain path:

1. A Stacy install has a stable Ed25519 install identity.
2. `stacy brain create` creates a signed, content-addressed Knowledge Object.
3. The KO is stored in Stacy Postgres through the federation Brain store.
4. `stacy brain show <ko_id>` reads it back, verifies hash/signature, and renders
   content plus provenance.
5. Prompt-generated content is supported through `--prompt`, with an optional
   adapter-like command bridge and deterministic fallback for harness runs.

## Implemented Scope

- Canonical JSON serialization shared by signed object types.
- Ed25519 install identity creation, persistence, reload, and keypair self-check.
- Signed Knowledge Object creation and verification.
- Content-addressed default KO ids derived from the KO content hash.
- Tamper tests for content, metadata, hash, signature, wrong public key, and wrong signer.
- Brain storage in the existing Stacy Postgres/Drizzle stack.
- `stacy brain create` with `--content-json`, `--prompt`, `--adapter-command`, and
  deterministic fallback output.
- `stacy brain show` with JSON output, provenance, verification metadata, and static
  dashboard-shaped rendering.
- Gated real Postgres/actual CLI smoke for create -> show.

## Phase 2 Acceptance State

- Green: `INSTALLS`
- Green: `SIGNED KO`
- Covered by Phase 2 integration smoke: local create -> store -> read with provenance.
- Deferred to Phase 3+: `PER-OBJECT CONSENT`, `TIME`, `REVOKE`, `RECEIPTS`

## Crypto Self-Review Notes

- Hashing order follows `SPEC.md`: canonical unsigned payload -> SHA-256 content hash
  -> canonical signed payload -> Ed25519 signature.
- Verification reconstructs the unsigned payload from signed fields before checking
  the content hash.
- Verification rejects signer install mismatch before signature verification.
- Canonical object keys sort with stable string comparison, not locale-sensitive order.
- Unsupported canonical inputs throw: `undefined`, functions, symbols, non-finite
  numbers, and circular references.
- Install identity ids derive from the public key fingerprint.
- Install identity reload verifies the private key matches the stored public key.
- No new crypto-path dependency was added; signing uses Node's built-in Ed25519.

Human review still required by the 90-day plan before treating the crypto model as
approved. Review these files line-by-line:

- `src/crypto/canonical.ts`
- `src/identity/install-identity.ts`
- `src/ko/knowledge-object.ts`

## Final Verification

Run from the `stacy-cli` repo root:

```bash
pnpm --filter @arpanstacy/stacy-federation typecheck
pnpm --filter @arpanstacy/stacy-federation test
pnpm --filter @arpanstacy/stacy typecheck
STACY_FEDERATION_REAL_DB_SMOKE=1 pnpm --filter @arpanstacy/stacy-federation test -- src/brain/local-brain.integration.test.ts
pnpm typecheck
```

The full workspace `pnpm typecheck` may require permission to create the local `tsx`
IPC pipe in restricted sandboxes.

## Phase 3 Handoff

Start Phase 3 with signed consent grants and read-time enforcement. Do not expand into
schema registries, blockchain, delegation chains, or a multi-install coordination
kernel.
