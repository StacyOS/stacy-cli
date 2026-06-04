# Phase 3 (v0.3 alpha) — Local file ingest + run chains

**Track:** Federation CLI customer-facing alpha
(`v0.1` local KOs → `v0.2` connectors + AI runs → **`v0.3` this doc**).
**Theme:** Close the credential-free loop. Get local files into signed KOs with
zero external setup, and let AI runs compose into multi-step chains.

> Eng-reviewed 2026-06-02 (Claude + Codex outside voice). The original draft
> proposed a generic-ingest refactor + an `fs` *connector*; the review showed
> that was premature for the alpha goal. v0.3 takes the smaller path: a
> `brain create --file` command (reusing existing KO signing) plus run chains.
> The connector-framework work (generic ingest, `fs`/Linear connectors) is real
> but deferred until a second OAuth source justifies it — see `TODOS.md`.

> Not to be confused with `docs/stacy/PHASE-3.md` (heartbeat dispatch in the
> StacyVM control plane) or `packages/federation/PHASE3_GATE.md` (the shipped
> two-install consent gate). This is the v0.3 alpha of the federation CLI.

---

## 1. Why this, why now

v0.2 shipped a real loop — GitHub → signed KO → AI run → signed `agent_output`
KO — but with two limits that block dogfooding:

1. **Every path needs external credentials.** `connect github` needs an OAuth
   app; the live `anthropic` run needs an API key. A brand-new user cannot
   exercise the loop end-to-end with zero setup. This is what holds
   `releases/v2026.602.0.md` in *Draft / awaiting validation*.
2. **Runs are single-shot.** `stacy run "task" --use <ko>` is one task, one
   adapter, one output. "Summarize each input, then synthesize one report" is
   not expressible as a single command.

v0.3 removes both with the **smallest diff that delivers the unlock**:

- **Local files → signed KOs with no credentials** via `brain create --file`.
  Combined with the existing `--adapter deterministic` run path, a new user runs
  the *entire* ingest → run loop offline, today.
- **Run chains** so an `agent_output` KO feeds the next run as input.

### Dependency on v0.2

v0.2 external validation (independent engineer + design-partner metrics, per
`PHASE-2-HANDOFF.md`) is **not** required to *build* v0.3, but *is* required to
tag a public v0.3. The `brain create --file` path is what makes the
zero-credential loop demonstrable, which directly unblocks that validation.

---

## 2. Goals & non-goals

**Goals**
- `brain create --file <path>` (+ `--glob`/`--ext` for directories): turn local
  text/markdown/JSON files into signed KOs, **no connector, no credential**.
- **Run chains**: a multi-step run where later steps consume earlier steps'
  `agent_output` KOs, expressed as a single command + spec file.
- Fix the two correctness gaps the review surfaced in the existing run path
  (content-hash determinism for caching; a reusable run executor).

**Non-goals (explicitly deferred — see `TODOS.md`)**
- Generic registry-driven `ingest` refactor + `fs` as a real `Connector`
  (`authType: "none"`, connect/status story). Real work, but only pays off with
  a second OAuth connector. Deferred.
- **Linear connector** — no OAuth device-code flow; needs a PAT-vs-OAuth
  decision. Deferred to v0.3.1.
- **Rate-limit/retry + resumable ingest** — hardening for real-API load.
  Deferred.
- **`brain lineage` graph-walk command** — one-hop provenance already exists in
  the KO content; a walker/visualizer is a separate feature. Deferred.
- KO retrieval/selection, output-schema validation, in-output citations, eval
  harness, cost governance → Phase 4 "Run depth & trust."

---

## 3. Workstreams

### W1 — `brain create --file` (no-credential file ingest)

Add a file → signed KO path to the existing `brain create` verb. Reuses the
current signing/storage pipeline (`verbs/brain-create.ts`); **no connector
framework changes**.

- New options on `brain create` (`BrainCreateOptions`):
  - `--file <path>` — read one file; content becomes the KO body. Content type
    inferred from extension (`.md`/`.txt` → `text/markdown` or `text/plain`,
    `.json` → `application/json` and parsed/validated).
  - `--glob <pattern>` / `--ext md,txt,json` — ingest a directory; create one
    signed KO per matching file. Reuses the same per-file path in a loop.
- **Provenance (no path leak — review #10):** store the **relative path from
  cwd** (or basename) as the source label, never an absolute `file://…` URL.
  Absolute paths leak usernames and directory layout, and KOs can later be
  exported/shared. Decision: relative path; add `--source-label` to override.
- **Traversal safety (review #11):** when walking a directory, by default skip
  dotfiles, `node_modules`, `.git`, and symlinks; detect and skip binary/non-UTF8
  files (warn); enforce a max-file-size guard (skip + warn, default e.g. 1 MB,
  `--max-bytes` override); on a permission error, warn + skip, never abort the
  whole batch.
- **Confirmation:** for a directory ingest, print a count + the file list before
  creating KOs; `--yes` to skip (mirrors the `ingest` UX so it's familiar).

*Exit:* `stacy brain create --file ./notes.md` and `stacy brain create --glob
'docs/**/*.md'` create verifying signed KOs with `create`/`sign` receipts,
**no env vars set**, source label is a relative path, oversized/binary files are
skipped with a warning.

### W3 — Run chains

Compose runs: an `agent_output` KO from one step becomes a `--use` input to the
next. Mechanically possible today (`run.ts:90` reads any KO); W3 makes it a
single declared command and fixes two correctness gaps the review found.

- New module `packages/federation/src/runs/chain.ts` + verb path
  `stacy run --chain <spec.json> [--adapter …] [--ack-egress] [--no-cache]`.
- **Spec:** JSON, ordered `steps[]`, `@<id>` references to a prior step's output:
  ```jsonc
  {
    "steps": [
      { "id": "per_doc",   "task": "Summarize each document", "use": ["ko_a", "ko_b"] },
      { "id": "synthesis", "task": "Synthesize one report",   "use": ["@per_doc"] }
    ]
  }
  ```
- **Reusable run executor (review #8).** `agentRunCommand` currently returns
  `void`; the real run logic (adapter resolution, egress gate, KO load+verify,
  cache, sign) lives inside it. Extract a `runOnce(...) → { koId, … }` executor
  that both the single-run verb and the chain call. Without this, chains would
  parse stdout or duplicate the logic — neither acceptable.
- **Content-hash determinism for caching (review #7 — REAL BUG).** Today
  `agent-output.ts:59` writes `generatedAt` into the hashed content envelope, so
  two identical runs produce **different** content hashes. In a chain this means
  a downstream step's input hash changes every run → the "re-bill only changed
  steps" claim is false. Fix: **exclude volatile fields (`generatedAt`) from the
  content used to derive the KO content hash / chain cache key** (keep them as
  metadata, not hashed body), or key downstream steps on the upstream adapter
  result hash. Add a test asserting two identical chain runs are fully cached.
- **Provenance: one-hop.** Each step's `agent_output` lists only its *direct*
  inputs (synthesis → [per_doc output]; per_doc → [file KOs]). No transitive
  flattening, no schema change. A lineage walker is deferred (non-goal).
- **Egress + validation up front.** Spec parse + `@ref` resolution + egress gate
  all happen before any adapter call (consistent with `run.ts:77`). A bad
  `@ref` fails before egress.
- **Failure semantics.** A step failure aborts the chain; already-produced step
  KOs are durable (no rollback); the chain reports which step failed.

*Exit:* a 2-step chain (per-file summaries → synthesis) produces a final signed
`agent_output` KO with correct one-hop provenance; **re-running the identical
chain is fully cached (zero adapter calls)** — the determinism fix is verified
by test.

### Deferred (tracked in `TODOS.md`)

- **Generic ingest refactor + `fs`/Linear connectors** — the connector-framework
  path. Revisit when a second OAuth source exists.
- **W4 robustness** (rate-limit backoff, resumable cursor).
- **`brain lineage <ko>`** — graph-walk lineage command/visualizer.

---

## 4. Sequencing

W1 and W3 are genuinely independent (W1 touches `verbs/brain-create.ts`; W3
touches `verbs/run.ts` + `runs/`). They share only `verbs/index.ts` for command
registration, so the *registration edits* must be coordinated, but the feature
work parallelizes.

```text
Lane A: W1  (verbs/brain-create.ts, file walk)        -- independent
Lane B: W3  (runs/chain.ts, runOnce refactor, #7 fix) -- independent
Shared: verbs/index.ts + cli/src/index.ts registration -- coordinate merge
```

Recommended order: **W3's #7/#8 fixes first** (they correct existing behavior
and de-risk the run path), then W1, then chain syntax on top.

## 5. Exit criteria (v0.3 alpha gate)

- [x] `brain create --file` and `--glob` create verifying signed KOs with
      **zero external credentials**; source label is a relative path (no
      absolute-path leak); binary/oversized files skipped with a warning.
- [x] Full loop runnable credential-free: `brain create --file` → `run --adapter
      deterministic --use` → `run --chain`.
- [x] **Content-hash determinism fix (review #7):** two identical runs produce
      the same hashed content; an identical chain re-run makes **zero adapter
      calls**. Verified by test (`agent-output.test.ts`, `run.test.ts`).
- [x] **Reusable `runOnce` executor (review #8)** extracted; single-run verb and
      chain both use it; single-run behavior unchanged (6 existing tests pass).
- [x] Run chain of ≥2 steps: correct one-hop provenance, `@ref` resolution,
      egress fires once, bad `@ref` fails before egress, step-failure aborts with
      prior KOs durable (`run.test.ts`, `chain.test.ts`).
- [x] Tests green: file ingest (single/glob/ext/empty/binary/oversized),
      chain resolver (valid/@ref-missing/step-failure/egress-once/full-cache-hit),
      determinism + executor regressions. Full suite 318 passed / 11 skipped.
- [x] Docs: `brain create --file`/`--dir`/`--chain` in `docs/cli-reference.md`,
      run-chains section in `docs/concepts/ai-runs.md`,
      `docs/v0.3-files-and-chains-quickstart.md`.
- [x] CHANGELOG `[Unreleased]` → v0.3 entry.
- [ ] **Gate (carryover):** do not tag public v0.3 until v0.2 external validation
      (`PHASE-2-HANDOFF.md`) clears. A draft `releases/` note will be cut at tag
      time (held with v0.2).

## 6. Decisions (resolved in eng review 2026-06-02)

1. **Approach** → `brain create --file` + run chains. Connector-framework
   refactor (generic ingest, `fs`/Linear) deferred (Codex outside-voice #12). ✅
2. **File provenance** → relative path / basename, never absolute `file://`
   (path-leak, review #10). ✅
3. **Chain spec** → JSON, ordered `steps[]`, `@<id>` refs; no workflow engine. ✅
4. **Chain provenance** → one-hop; lineage walker deferred. ✅
5. **Caching** → fix content-hash determinism by excluding `generatedAt` from the
   hashed body (review #7). ✅
6. **Run reuse** → extract `runOnce` returning the KO id (review #8). ✅
7. **Chain failure** → abort-on-step-failure, prior KOs durable, report step. ✅

## 7. Failure modes (new code paths)

| Path | Realistic failure | Test? | Error handling | Silent? |
|---|---|---|---|---|
| `--file` read | file missing / no perm | yes | warn + skip (dir) or clear error (single) | no |
| `--glob` walk | huge/binary file | yes | size-guard + binary skip, warn | no |
| chain `@ref` | references unknown step | yes | fail before egress, clear error | no |
| chain step | step N adapter fails | yes | abort, prior KOs durable, name step | no |
| chain cache | `generatedAt` non-determinism (#7) | yes | excluded from hash; identical re-run fully cached | **was silent — now fixed** |

No critical gaps (no failure mode left untested + unhandled + silent) once the
#7 determinism test lands.

---

*Status: Eng-reviewed 2026-06-02 (Claude + Codex). Scope: W1 (`brain create
--file`) + W3 (run chains, with #7/#8 fixes). Connector refactor, Linear, and
robustness deferred to `TODOS.md`. Ready to implement.*

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (PLAN) | scope reduced; 2 arch + 1 regression resolved |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | (CLI-only, n/a) |
| Outside Voice | `codex-plan-review` | Independent 2nd opinion | 1 | ISSUES FOUND | 12 findings; #12 reshaped the approach |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **CODEX:** 12 findings; 4 contradicted the Claude review (caching #7, count-vs-stream #4, parallelism #6, run-service reuse #8). #12 (simpler `brain create --file` over a connector refactor) was accepted and reshaped v0.3.
- **CROSS-MODEL:** the two reviews diverged on whether to refactor the connector framework now. Codex's narrower path won; plan rewritten.
- **UNRESOLVED:** 0.
- **VERDICT:** ENG CLEARED — ready to implement. Public v0.3 tag still gated on v0.2 external validation (`PHASE-2-HANDOFF.md`).
