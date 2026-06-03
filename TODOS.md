# TODOS

Deferred work, captured so it is not silently lost. Each item has enough context
to pick up cold.

## Later — Generic ingest refactor + `fs`/Linear as real Connectors

- **What:** Refactor `verbs/ingest.ts` (currently `ingestGithubCommand`, GitHub-
  specific) into a generic registry-driven `ingestCommand(connectorId, params)`,
  and implement `fs` as a real `Connector` (with `authType: "none"`).
- **Why deferred:** Eng review (Codex outside voice #12) showed this is premature
  for the alpha. `brain create --file` (v0.3 W1) unblocks the zero-credential loop
  without touching connector auth/registry/connect/status. The framework refactor
  only pays off once a second OAuth connector (Linear) justifies it.
- **Scope when revisited (holes the review found):** `authType: "none"` is a core
  interface change — `Connector.authenticate/status/ingest` and
  `IngestOptions.token` all currently require `TokenBundle`
  (`connectors/types.ts:44,77`). `connectors list/status` derive "connected" from
  keychain entries, so a no-auth connector needs a status story. The confirmation
  count currently forces full enumeration before storing — reconcile with
  streaming. Command registration lives in `packages/federation/verbs/index.ts`,
  not just `cli/src/index.ts`.
- **Depends on:** a concrete second connector (Linear) to justify the work.

## Later — `brain lineage <ko>` graph-walk command

- **What:** A command/visualizer that walks `provenance.inputKoIds` edges to show
  a KO's full lineage back to its original inputs.
- **Why:** v0.3 uses one-hop provenance (each KO lists direct inputs only). Full
  lineage is *derivable* by walking edges but there's no tool to do it. Eng
  review (#9) flagged that a graph-walk exit criterion needs a real walker.
- **Where:** new `brain lineage` verb over `agent-output` content `inputKoIds` +
  run receipts.

## v0.3.1 — Linear connector (deferred from Phase 3 / W2)

- **What:** Add a Linear connector (issues → signed `document`/`issue` KOs) on
  the W0 generic ingest path.
- **Why:** Second real connector — proves the framework against a non-GitHub
  OAuth + GraphQL shape and gives the run/chain loop a second real source.
- **Blocker to resolve first:** Linear has **no OAuth device-code flow** (the
  affordance GitHub's `connect` UX is built on). Decide: localhost-redirect
  OAuth listener vs. **personal access token** (`authType: "api-key"`). PAT is
  the leaning for alpha speed.
- **Where to start:** `packages/federation/src/connectors/linear/`
  (`connector.ts`, `api.ts` GraphQL client, `normalize.ts`); register in
  `connectors/registry.ts`; CLI flag→params mapping in `cli/src/index.ts`
  (`--team`, `--state`, `--label`, `--since`). Env `STACY_LINEAR_CLIENT_ID` or a
  PAT entry in the keychain.
- **Depends on:** Phase 3 W0 (generic `ingestCommand`) landing first.

## v0.3.1 — Real-API robustness (deferred from Phase 3 / W4)

- **What:** Rate-limit backoff/retry + resumable ingest cursor.
- **Why:** Repeated dogfooding against real APIs hits 429s and transient
  failures; today an interrupted `ingest` restarts from scratch.
- **Where to start:** centralize retry/backoff in `connectors/http.ts` (honor
  `Retry-After` / `X-RateLimit-Reset`; `rate-limiter.ts` already models the
  window). Add a per-(connector, source) cursor file under
  `<instance>/connectors/` so `ingest` resumes. Optional: a provider-agnostic
  second reference adapter in `scripts/` to prove the adapter contract.
- **Depends on:** best done once ≥2 connectors exist (after W2) so there is real
  load to harden against.

## Post-v0.2 — Independent validation gate (carryover)

- **What:** Independent engineer validates the live GitHub + Anthropic paths
  with their own credentials; meet design-partner metrics (15 alpha users, ≥10
  real ingests, ≥5 `agent_output` KOs).
- **Why:** `releases/v2026.602.0.md` is **Draft** until this clears; it also
  gates tagging public v0.3.
- **Where:** `PHASE-2-HANDOFF.md` §4 test plan.
