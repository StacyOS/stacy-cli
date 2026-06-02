# Phase 2 (v0.2 alpha) — Engineer Handoff

**Branch:** `phase-2/v0.2-handoff` (contains all Phase 2 commits + this doc)
**Scope:** GitHub connector + AI runs on top of the v0.1 local Knowledge Object
surface. Everything is local-only; nothing leaves the install unless you pass
`--ack-egress`.

This document tells you **what was built**, **what is already verified**, and
**what needs external credentials/services that the author could not provision**
— plus a concrete step-by-step test plan for those external paths.

---

## TL;DR — what we need from you

To finish validating Phase 2, an engineer with real accounts must:

1. **Register a GitHub OAuth app** (device-flow enabled) and provide its
   **client id** → unblocks `stacy connect github` and `stacy ingest github`.
2. **Provide an `ANTHROPIC_API_KEY`** and an **adapter command** → unblocks the
   live `anthropic` path of `stacy run`.
3. **Run the manual test plan** in [§4](#4-external-test-plan) on macOS (and,
   ideally, Linux) and report results.

Without these, the code is complete and unit-tested, but the live OAuth and
live-LLM paths cannot be exercised in CI or by the author.

---

## 1. What shipped in this branch

| Area | Commit | Summary |
|---|---|---|
| Connector framework | `6ff9d7d8` | Connector interface/types, encrypted-file keychain (AES-256-GCM), sliding-window rate limiter, registry |
| GitHub connector | `29794662` | OAuth device-code flow, REST API client, PR/issue normalization, streaming ingest |
| Ingest verbs | `861913de` | `connect`, `connectors list\|status\|disconnect`, `ingest` + ingest→signed-KO pipeline |
| AI runs | `4e27a28c` | `stacy run "task" --use <ko_id>` → signed `agent_output` KO; `deterministic` + `anthropic` adapters |
| Docs | `8eab3b61` | v0.2 quickstart, connector/AI-run concept docs, GitHub reference, CHANGELOG entry |

### New CLI surface

```bash
stacy connect github [--client-id <id>] [--org <org>] [--scope <scope>]
stacy connectors list
stacy connectors status
stacy connectors disconnect github
stacy ingest github --repo <owner/name> [--pulls] [--issues] \
                    [--state open|closed|all] [--label <l>] [--since 7d] [--yes]
stacy run "<task>" --use <ko_id> [--use <ko_id> ...] \
                   [--model <name>] [--adapter anthropic|deterministic] [--ack-egress]
```

### Key design points (so you know what to expect)

- **Tokens are encrypted at rest** under `<instance>/secrets/connector-tokens.json`
  with a sibling `*.key` file (mode `0600`). Never plaintext config.
- **Egress gate:** `stacy run` with a non-deterministic adapter refuses to read
  any KO or call any model unless `--ack-egress` is passed. The
  `deterministic` adapter never egresses and needs no acknowledgement.
- **Provenance:** every ingested KO carries connector provenance; every
  `agent_output` KO lists its input KO ids in `provenance.inputKoIds`.
- **Receipts:** the tamper-evident chain now records `ingest`, `normalize`, and
  `run` events alongside `create` and `sign`.

---

## 2. What is already verified (no external services needed)

Run from the repo root:

```bash
pnpm install
pnpm --filter @arpanstacy/stacy-federation typecheck   # clean
pnpm --filter @arpanstacy/stacy typecheck               # clean
pnpm --filter @arpanstacy/stacy-federation test         # 274 passed / 10 skipped
```

Covered by unit tests (mocked HTTP / in-memory deps, no network):

- OAuth device-flow polling (pending/slow-down/expired/denied paths)
- GitHub API + normalization (PR/issue shapes, PR-vs-issue filtering)
- Keychain round-trip + encryption-at-rest
- Rate limiter window invariant + 429 reset + persistence
- `connect` / `connectors` / `ingest` verb behavior with a fake connector
- **`stacy run` end-to-end with the `deterministic` adapter** (input
  verification, egress gate, `agent_output` signing, `run` receipt)

You can also exercise the **fully offline** run path yourself with no keys:

```bash
# after init + a local KO exists:
stacy run "Summarize" --use <ko_id> --adapter deterministic
```

---

## 3. What needs external support (BLOCKED on credentials)

### 3.1 GitHub OAuth app + client id

`stacy connect github` uses the **device-code flow** and requires a GitHub OAuth
app client id.

**What to provision:**
- A GitHub OAuth app with **device flow enabled**.
- The app's **client id**.

**How the CLI consumes it:**
```bash
export STACY_GITHUB_CLIENT_ID=Iv1.xxxxxxxxxxxxxxxx   # or pass --client-id
```

- Default scopes requested: **`repo`, `read:org`** (override with `--scope`).
- Restrict to a single org with `--org <org>`.

> Why the author couldn't do this: registering an OAuth app requires a GitHub
> account/org with admin rights and produces a secret-bearing client id that
> must not be committed. This is your call to make and provision securely.

### 3.2 Anthropic API key + adapter command (live `stacy run`)

The default `anthropic` adapter shells out to an **external adapter command**
that receives the run request as JSON on stdin and must emit an
`agent_output`-shaped JSON object on stdout (the proven
`claude-cli-adapter.mjs` pattern from the demo runner).

A ready-to-use reference adapter ships in this repo at
**`scripts/anthropic-run-adapter.mjs`** (dependency-free, calls the live Messages
API, reads the key from its own env). It has been verified end-to-end against the
real Anthropic API. Point `STACY_ANTHROPIC_ADAPTER_COMMAND` straight at it — note
it must be a single executable path (Stacy does not shell-split, so
`node script.mjs` will not work).

**What to provision:**
```bash
export ANTHROPIC_API_KEY=sk-ant-...
export STACY_ANTHROPIC_ADAPTER_COMMAND="$PWD/scripts/anthropic-run-adapter.mjs"
# optional: export STACY_DEFAULT_ADAPTER=anthropic   (already the default)
```

The adapter contract (stdin it receives):
```jsonc
{
  "task": "Create a release risk report",
  "model": "claude-sonnet-4-5",
  "input_kos": [
    { "ko_id": "ko_...", "content_hash": "sha256:...",
      "content_type": "application/json", "content": { /* KO content */ } }
  ]
}
```
The adapter must print JSON to stdout. Either a bare result object (used as
`output`) or `{ "output": {...}, "notes": ["..."] }`.

> Why the author couldn't do this: a live Anthropic key is a billable secret and
> must not be committed; the live call cannot run in CI without it.

### 3.3 Database

The verbs need a Postgres connection (same as the rest of federation). Provide
one of:
```bash
--db-url postgres://...           # per-command
export STACY_FEDERATION_DB_URL=postgres://...
export DATABASE_URL=postgres://...
```
or rely on the embedded-postgres config written by `stacy init` / `stacy start`.

---

## 4. External test plan

Run on **macOS** first (Linux is best-effort for v0.2 — see §6). Assumes
`stacy` is on PATH; in a checkout use
`pnpm --filter @arpanstacy/stacy exec tsx src/index.ts <args>`.

### Setup
```bash
pnpm install
stacy init && stacy start --daemon          # or supply --db-url on each command
export STACY_GITHUB_CLIENT_ID=Iv1.xxxx
```

### Test A — Connect GitHub (3.1)
```bash
stacy connect github
```
- [ ] Prints a verification URL + user code.
- [ ] After browser authorization, reports `Connected as @<you>` and scopes.
- [ ] `stacy connectors list` shows `github` as connected.
- [ ] `stacy connectors status` makes a live call and reports account + scopes.
- [ ] Token file exists at `<instance>/secrets/connector-tokens.json`, is **not**
      world-readable, and the value is **not** plaintext.

### Test B — Ingest real GitHub data (3.1)
```bash
stacy ingest github --repo <owner/name> --pulls --since 7d
```
- [ ] Shows a confirmation summary with an estimated count before writing.
- [ ] After `y`, creates one signed KO per object.
- [ ] `stacy brain verify <ko_id>` passes for an ingested KO.
- [ ] `stacy receipts list --ko <ko_id>` shows `create`, `sign`, `ingest`,
      `normalize`.
- [ ] Repeat with `--issues`, `--state all`, `--label <l>` and confirm filters.
- [ ] `--yes` skips the prompt (scripting).

### Test C — Live AI run (3.2)
```bash
export ANTHROPIC_API_KEY=sk-ant-...
export STACY_ANTHROPIC_ADAPTER_COMMAND="node /abs/path/claude-cli-adapter.mjs"

stacy run "Summarize these PRs into a release risk report" \
  --use <ko_id_1> --use <ko_id_2> --ack-egress --model claude-sonnet-4-5
```
- [ ] **Without `--ack-egress`** the command errors *before any network call*.
- [ ] With `--ack-egress`, a real Claude call returns and a new `agent_output`
      KO is created.
- [ ] `stacy brain show <output_ko_id>` shows `provenance.inputKoIds` = the inputs.
- [ ] `stacy receipts list --ko <output_ko_id>` shows `create`, `sign`, `run`.
- [ ] A non-existent `--use ko_missing` fails with a clear error before the call.

### Test D — Offline run (no keys; sanity)
```bash
stacy run "Summarize" --use <ko_id> --adapter deterministic
```
- [ ] Succeeds with no network and no `--ack-egress`.

---

## 5. Not yet built (in-scope, but optional / deferrable)

These are Phase 2 plan items that are **not** blocked on credentials but were not
built; flagged so nothing is silently lost:

- **`docs/cli-reference.md`** — plan lists a CLI reference covering the new
  verbs; `docs/cli/` is currently empty.
- **Run-result caching** — plan's risk mitigation: cache `stacy run` by
  `(task, sorted input content-hashes)` so identical inputs skip the API call.
- **Env-gated live-Anthropic integration test** — a skipped-by-default test that
  runs only when `ANTHROPIC_API_KEY` is present (mirrors the existing
  `demo:public:adapter-live` pattern).
- **Token refresh on expiry** — the connector exposes `refresh()`, but it is not
  auto-invoked in `ingest`/`status`. Low urgency for GitHub OAuth-app tokens
  (they don't rotate), but note it for connectors that do.

---

## 6. Known limitations / risks

- **Linux OAuth + keychain** is untested; the encrypted-file keychain is
  cross-platform, but treat Linux as **beta** for v0.2.
- **Messy PR bodies** (markdown, code blocks, large diffs) may surface
  normalization edge cases on real data — budget time when testing Test B.
- **Anthropic rate limits** during repeated demo runs — the run-result cache
  (§5) is the intended mitigation and is not yet built.

---

## 7. Phase 2 exit checklist (status)

- [x] `stacy ingest github` creates valid KOs that verify *(unit-tested; confirm live in Test B)*
- [x] `stacy run "..." --use ko --ack-egress` produces signed output KOs *(deterministic path tested; confirm live in Test C)*
- [x] Quickstart v2 published — `docs/v0.2-connectors-and-runs-quickstart.md`
- [x] CHANGELOG v0.2 entry written *(under `[Unreleased]`; not yet tagged)*
- [ ] `stacy connect github` works on macOS without manual intervention — **needs Test A + a real OAuth app**
- [ ] 15 alpha users; ≥10 ingested real data; ≥5 generated `agent_output` KOs — **external program work**
- [ ] `v0.2.0` tagged/released — **release step after the live tests pass**

---

## Reference: environment variables

| Variable | Purpose | Required for |
|---|---|---|
| `STACY_GITHUB_CLIENT_ID` | GitHub OAuth app client id | `connect`/`ingest` (Test A/B) |
| `ANTHROPIC_API_KEY` | Anthropic API key (read by the adapter command) | live `run` (Test C) |
| `STACY_ANTHROPIC_ADAPTER_COMMAND` | Command the `anthropic` adapter shells out to | live `run` (Test C) |
| `STACY_DEFAULT_ADAPTER` | Override default adapter (`anthropic`) | optional |
| `STACY_FEDERATION_DB_URL` / `DATABASE_URL` | Postgres connection | all verbs (or `--db-url` / config) |
