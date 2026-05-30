# Concept: Connectors

A **connector** brings data from an external tool (GitHub, and more to come)
into StacyOS as signed Knowledge Objects. The connector framework is the plugin
architecture every connector implements, plus the shared infrastructure for
auth, token storage, and rate limiting.

## The connector interface

Every connector implements a small, uniform contract
(`packages/federation/src/connectors/types.ts`):

```typescript
export interface ConnectorDescriptor {
  readonly id: string;                     // e.g. "github"
  readonly displayName: string;            // e.g. "GitHub"
  readonly authType: "oauth" | "api-key";  // v0.2: oauth only
  readonly scopes: readonly string[];      // OAuth scopes requested
  readonly objectKinds: readonly string[]; // KO kinds it produces
}

export interface Connector extends ConnectorDescriptor {
  authenticate(opts: AuthenticateOptions): Promise<TokenBundle>;
  refresh(token: TokenBundle): Promise<TokenBundle>;
  ingest(opts: IngestOptions): AsyncIterable<NormalizedObject>;
  status(token: TokenBundle): Promise<StatusReport>;
}
```

`ingest` is an async iterable so large result sets stream object-by-object
instead of buffering an entire repository in memory.

## Normalization and provenance

A connector never stores raw API payloads. It emits **`NormalizedObject`s** — a
stable, canonical shape per object kind plus a `ConnectorProvenance` record:

```typescript
interface ConnectorProvenance {
  connectorId: string;       // "github"
  connectorVersion: string;  // "0.2.0"
  sourceId: string;          // "github:pull:owner/repo#231"
  sourceUrl?: string;        // link back to the source
  sourceTimestamp?: string;  // upstream updated-at
  ingestCommand?: string;    // the exact `stacy ingest …` invocation
}
```

When an object is persisted (`storeIngestedObject`), it becomes a normal signed
KO and the framework appends two extra receipts — `ingest` (connector
provenance) and `normalize` (object kind + content hash) — next to the standard
`create` and `sign`. Provenance is therefore verifiable, not advisory.

## Token storage

Tokens are stored through a `KeychainStore` abstraction. The default backend is
an **encrypted file** (`FileKeychain`): AES-256-GCM with a per-install key held
in a sibling `*.key` file (mode `0600`), each entry carrying its own random IV
and auth tag. Tokens are never written to plaintext config. The interface lets
an OS-keychain backend drop in later without touching connector code.

## Rate limiting

A shared `SlidingWindowRateLimiter` enforces a hard "≤ N requests per window"
invariant for any window size, honors a server-provided 429 / `x-ratelimit-reset`
deadline, and **persists** the last-reset state to disk so restarts don't
re-hammer the API.

## Discovery and the CLI

Connectors register in a `ConnectorRegistry`. The CLI surfaces them via:

- `stacy connect <connector>` — OAuth device-code flow, stores the token.
- `stacy connectors list` — available connectors + connection status.
- `stacy connectors status` — live token check (account, scopes).
- `stacy connectors disconnect <connector>` — remove the stored token.
- `stacy ingest <connector> …` — fetch, normalize, confirm, and sign KOs.

See the [GitHub connector reference](../connectors/github.md) for the first
concrete implementation.
