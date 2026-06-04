# StacyOS CLI Reference

This is the command reference for the `stacy` CLI as of the v0.2 alpha
(connectors + AI runs). It covers the federation surface — Knowledge Objects,
connectors, AI runs, sharing, contacts, receipts, and install identity — plus
the local bootstrap commands.

Every federation command is local-first and supports two common flags:

| Flag | Description |
| --- | --- |
| `-c, --config <path>` | Path to the instance config file. Defaults to the resolved local instance. |
| `--db-url <url>` | Postgres connection string. Overrides `STACY_FEDERATION_DB_URL` / `DATABASE_URL` and the config value. |
| `--json` | Print raw JSON instead of human-readable text. Stable for scripting. |

Unless a command explicitly acknowledges egress (`--ack-egress`), nothing leaves
your install. Knowledge Objects are Ed25519-signed by your install identity and
addressed by their content hash, so every object is independently verifiable.

## Environment variables

| Variable | Used by | Purpose |
| --- | --- | --- |
| `STACY_FEDERATION_DB_URL` / `DATABASE_URL` | all | Default Postgres connection string. |
| `STACY_GITHUB_CLIENT_ID` | `connect github` | OAuth client id for the GitHub device-code flow. |
| `ANTHROPIC_API_KEY` | anthropic adapter (via your adapter command) | Model credentials. Never read directly by Stacy; consumed by the adapter command. |
| `STACY_ANTHROPIC_ADAPTER_COMMAND` | `run --use` (anthropic adapter) | External command that receives the run request as JSON on stdin and emits `agent_output`-shaped JSON on stdout. |
| `STACY_DEFAULT_ADAPTER` | `run --use` | Overrides the default run adapter (`anthropic`). |

---

## Knowledge Objects — `stacy brain`

Operations on locally stored signed Knowledge Objects (KOs).

### `stacy brain create`
Create and store a local signed Knowledge Object.

Provide content one of four ways: inline JSON, a prompt, a single local file, or
a directory of files. The file/directory modes are credential-free.

| Option | Description |
| --- | --- |
| `--content-json <json>` | KO content as inline JSON. |
| `--prompt <text>` | Generate KO content from a prompt. |
| `--file <path>` | Create a KO from a local text/markdown/json file (no credentials). Wraps it in a `{ kind: "document", source, mediaType, text\|data }` envelope. |
| `--dir <path>` | Create one KO per file under a directory (no credentials). |
| `--glob <pattern>` | Glob pattern for `--dir`, e.g. `'**/*.md'` (relative to `--dir` or cwd). |
| `--ext <list>` | Comma-separated extension allowlist for directory ingest, e.g. `md,txt,json`. |
| `--source-label <label>` | Override the `--file` provenance label (default: cwd-relative path, basename if outside cwd). |
| `--max-bytes <n>` | Max file size for `--file`/`--dir` in bytes (default `1048576`). |
| `--yes` | Skip the directory-ingest confirmation prompt (for scripting). |
| `--adapter-command <command>` | Adapter-like command that reads the prompt on stdin and writes output. |
| `--adapter-arg <arg>` | Argument passed to `--adapter-command`; repeat for multiple. |
| `--content-type <type>` | KO content type (default `application/json`). |
| `--ko-id <id>` | Deterministic KO id (single-object modes only). |

Exactly one of `--content-json`, `--prompt`, or `--file` may be given. Directory
mode (`--dir`/`--glob`/`--ext`) skips dotfiles, `node_modules`, `.git`, and
symlinks; binary and oversized files are skipped with a warning rather than
aborting the batch. Source labels are always cwd-relative (or a bare filename
when the file sits outside cwd), so absolute paths never leak into shareable KOs.

### `stacy brain list`
List locally stored signed Knowledge Objects.

| Option | Description |
| --- | --- |
| `--content-type <type>` | Filter by content type. |
| `--source <source>` | Filter by `local` or `federated`. |
| `--limit <n>` | Max rows to return (1–100, default 20). |

### `stacy brain show <ko_id>`
Show a signed KO with provenance. Accepts a KO id or content hash.

| Option | Description |
| --- | --- |
| `--as-consumer <install_id>` | Enforce federated read consent as this consumer install. |

### `stacy brain export <ko_id>`
Export a signed KO to a portable file.

| Option | Description |
| --- | --- |
| `--out <path>` | Output path (default `<ko_id>.stacy-ko.json`). |

### `stacy brain import <path>`
Import and verify a signed KO from a portable file.

| Option | Description |
| --- | --- |
| `--source <source>` | Record source as `local` or `federated` (default `federated`). |

### `stacy brain derive <source_ko_id>`
Create a consumer-signed derived KO from a write-granted federated KO.

| Option | Description |
| --- | --- |
| `--content-json <json>` | Derived KO content as JSON (required). |
| `--content-type <type>` | Derived KO content type. |
| `--ko-id <id>` | Deterministic KO id (for harness runs). |

### `stacy brain verify <source_ko_id>`
Create a signed verification report for a KO.

| Option | Description |
| --- | --- |
| `--input <path>` | Original input file used by the KO. |
| `--schema <path>` | Dashboard schema used for deterministic reconciliation. |
| `--ko-id <id>` | Deterministic verification KO id (for harness runs). |

---

## Connectors — `stacy connect` / `stacy connectors`

Connect external tools and pull their data in as signed KOs. GitHub is the first
connector.

### `stacy connect <connector>`
Connect an external tool via OAuth (device-code flow). Currently `github`.

| Option | Description |
| --- | --- |
| `--client-id <id>` | OAuth client id (or set `STACY_GITHUB_CLIENT_ID`). |
| `--org <org>` | Restrict access to a single organization. |
| `--scope <scope>` | Override the requested OAuth scope (GitHub default: `repo`, `read:org`). |

Tokens are stored in an AES-256-GCM encrypted keychain file under
`<instance>/secrets/connector-tokens.json` (mode 0600).

### `stacy connectors list`
List available connectors and their connection status.

### `stacy connectors status`
Show the live status of a connected tool (account, scopes). Refreshes the stored
token if it is near expiry.

### `stacy connectors disconnect <connector>`
Remove a connector's stored token.

---

## Ingest — `stacy ingest`

### `stacy ingest <connector> --repo <owner/name>`
Ingest external-tool data as signed Knowledge Objects. Currently `github`.

| Option | Description |
| --- | --- |
| `--repo <owner/name>` | Repository to ingest from (required). |
| `--pulls` | Ingest pull requests (default when neither `--pulls` nor `--issues` is given). |
| `--issues` | Ingest issues. |
| `--state <state>` | Filter by `open`, `closed`, or `all` (default `open`). |
| `--label <label>` | Only ingest objects with this label. |
| `--since <duration>` | Only ingest objects updated since (`7d`, `24h`, or ISO date). |
| `--yes` | Skip the confirmation prompt (for scripting). |

Ingestion fetches and normalizes first, then shows a confirmation summary with a
real object count before anything is stored. Storage is local-only.

---

## AI runs — `stacy run <task> --use <ko_id>`

Run an adapter over one or more input KOs and store the result as a new signed
`agent_output` KO. This mode is selected whenever at least one `--use` flag is
present; without `--use`, `stacy run` performs local bootstrap (onboard + doctor)
instead.

| Option | Description |
| --- | --- |
| `--use <ko_id>` | Input Knowledge Object for the run; repeat for multiple. At least one is required (single-run mode). |
| `--chain <path>` | Run a multi-step chain from a JSON spec file instead of a single run. Mutually exclusive with `--use`. |
| `--model <name>` | Model identifier passed to the adapter (default `claude-sonnet-4-5`). |
| `--adapter <name>` | `anthropic` (default) or `deterministic`. |
| `--ack-egress` | Acknowledge that a non-deterministic adapter may send input KO content outside this install. |
| `--ko-id <id>` | Deterministic output KO id (single-run mode only). |
| `--no-cache` | Skip the run-result cache and force a fresh adapter call. |

**Adapters.** The `deterministic` adapter is offline, makes no network call, and
needs no egress acknowledgement. The `anthropic` adapter spawns the command in
`STACY_ANTHROPIC_ADAPTER_COMMAND`, leaves the install, and therefore requires
`--ack-egress`. The egress gate fires before any KO is read.

**Caching.** Identical runs (same task, model, adapter, and input content
hashes) reuse a cached adapter result stored under `<instance>/runs/cache`, so
repeated runs do not re-incur a billable model call. `--no-cache` bypasses it.
The cache key is independent of `--use` ordering.

Every run loads and verifies each input KO, then emits `create`, `sign`, and
`run` receipts for the new `agent_output` KO.

### Run chains — `stacy run --chain <spec.json>`

Compose runs: a later step consumes an earlier step's `agent_output` KO via an
`@<stepId>` reference. The spec is an ordered `steps[]` array:

```jsonc
{
  "steps": [
    { "id": "per_doc",   "task": "Summarize each document", "use": ["ko_a", "ko_b"] },
    { "id": "synthesis", "task": "Synthesize one report",   "use": ["@per_doc"] }
  ]
}
```

```bash
stacy run --chain ./chain.json --adapter deterministic
```

Each step is a full run (`--model`/`--adapter`/`--ack-egress`/`--no-cache` apply
to the whole chain; a step may override `model`). The spec is validated and all
`@ref`s resolved **before** the egress gate or any KO read — a forward, unknown,
or self reference fails immediately. Egress is acknowledged once for the whole
chain. Provenance is one-hop (each step lists its direct inputs). A step failure
aborts the chain and names the failed step; already-produced step KOs stay
durable. See [Concept: AI Runs](concepts/ai-runs.md#run-chains-v03).

---

## Sharing & revocation

### `stacy share <ko_id>`
Federate a signed KO with per-object consent.

| Option | Description |
| --- | --- |
| `--with <install>` | Consumer install id. |
| `--with-contact <name>` | Consumer contact name from the contacts book. |
| `--to <url>` | Consumer `/api/federation` endpoint URL. |
| `--revocation-url <url>` | Producer revocation lookup URL for consumer next-read checks. |
| `--scope <scope>` | Consent scope `read` or `write` (default `read`; `admin` reserved). |
| `--expires <duration>` | Consent expiry duration (default `30d`). |
| `--revocable` | Mark the consent grant revocable. |

### `stacy revoke <ko_id>`
Revoke a federated Knowledge Object grant.

| Option | Description |
| --- | --- |
| `--reason <text>` | Revocation reason (required). |
| `--grant-id <id>` | Specific consent grant id to revoke. |

---

## Contacts — `stacy contacts`

A signed federation address book.

| Subcommand | Description |
| --- | --- |
| `contacts add <name>` | Add or update a contact. Requires `--install-id`, `--endpoint`, `--revocation-url`; optional `--label`. |
| `contacts list` | List contacts. |
| `contacts show <name>` | Show a contact. |
| `contacts export <name>` | Export this install as a signed contact card. Requires `--endpoint`, `--revocation-url`; optional `--label`, `--out`. |
| `contacts import <path>` | Import and verify a signed contact card. Optional `--as <name>`. |
| `contacts share-link <name>` | Create a short-lived signed contact import link. Requires `--endpoint`, `--revocation-url`; optional `--label`, `--expires` (default `15m`), `--base-url`. |
| `contacts import-link <url>` | Import and verify a signed contact share link. Optional `--as <name>`. |

---

## Receipts — `stacy receipts`

Tamper-evident receipt log (hash chain).

### `stacy receipts list`
List federation receipts.

| Option | Description |
| --- | --- |
| `--ko <ko_id>` | Filter receipts by Knowledge Object id. |

### `stacy receipts verify`
Verify the tamper-evident receipt hash chain.

| Option | Description |
| --- | --- |
| `--ko <ko_id>` | Filter receipts by Knowledge Object id. |
| `--global` | Verify the global instance receipt anchor chain. |

---

## Install identity — `stacy identity`

| Subcommand | Description |
| --- | --- |
| `identity show` | Show this install's federation identity and public key. Never prints the private key. |
| `identity backup` | Write a private backup of this install's identity. Optional `--out`. The backup contains the install private key — keep it private (mode 0600). |
| `identity rotate` | Rotate the keypair and record a dual-signed transition. Optional `--reason`, `--effective-at`. |
| `identity verify-chain` | Verify the dual-signed key transition chain. |
