# Changelog

All notable changes to Stacy are recorded here. This file is a high-level
index; full per-release notes live in [`releases/`](releases/).

Stacy uses **date-based versioning**: `vYYYY.MDD.N` (e.g. `v2026.524.0` is the
first stable cut dated 2026-05-24; `.1`, `.2` … are same-day follow-ups).

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
- **v0.3 alpha — local file ingest + run chains.** `stacy brain create --file`
  and `--dir`/`--glob`/`--ext` turn local text/markdown/json files into signed
  Knowledge Objects with **no connector and no credentials** (leak-safe
  cwd-relative source labels; dotfiles/`node_modules`/`.git`/symlinks/binary/
  oversized files skipped). `stacy run --chain <spec.json>` composes multi-step
  runs where a later step consumes an earlier step's `agent_output` via an
  `@<stepId>` reference (validated before egress, gated once, one-hop
  provenance, abort-on-step-failure). Together they make the whole ingest → run
  → synthesize loop runnable offline. See
  `docs/v0.3-files-and-chains-quickstart.md`.

### Fixed
- **Run-result caching now composes across chain steps.** `agent_output` content
  no longer embeds a wall-clock `generatedAt`, so identical runs hash
  identically and an identical chain re-run reuses every step (zero adapter
  calls). The generation time still lives on the KO record and the `run`
  receipt.

### Changed
- Extracted a reusable `runOnce` run executor (single-run verb and run chains
  share it); single-run behavior is unchanged.

### Added (v0.2 alpha)
- **v0.2 alpha — connectors + AI runs.** GitHub connector (OAuth device-code
  flow, encrypted-at-rest token storage, sliding-window rate limiting), the
  `stacy connect` / `connectors list|status|disconnect` / `ingest` verbs that
  turn GitHub pull requests and issues into signed Knowledge Objects with
  connector provenance, and `stacy run "task" --use <ko_id>` AI runs that verify
  every input KO, gate egress, and sign a new `agent_output` KO whose provenance
  lists its inputs. Ships `deterministic` (offline) and `anthropic` run
  adapters. Receipt chain extended with `ingest`, `normalize`, and `run` events.
- `docs/v0.2-connectors-and-runs-quickstart.md`, `docs/concepts/connectors.md`,
  `docs/concepts/ai-runs.md`, and `docs/connectors/github.md`.
- `docs/DECISIONS.md` — the six foundational (week-zero) decisions, recorded
  against actual shipped state.
- `CODE_OF_CONDUCT.md` — Contributor Covenant 2.1 (by reference).
- `.github/ISSUE_TEMPLATE/` — bug report, feature request, and config.
- `.github/workflows/release-check.yml` — federation demo gate (preflight,
  typecheck, test, demo:check, public-demo, cached-adapter, repeat).
- `docs/design-partners.md` — design-partner program one-pager.

## [v2026.524.0] — 2026-05-24

First public land of the full Phase 0–3G federation product-readiness
substrate, plus the polish layer closing pre-investor credibility gaps, plus a
real-LLM cached adapter fixture and a live-adapter path.

See [`releases/v2026.524.0.md`](releases/v2026.524.0.md) for the full list.

---

Earlier releases (`v2026.523.0` and prior) are documented in
[`releases/`](releases/).
