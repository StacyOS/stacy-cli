# Changelog

All notable changes to Stacy are recorded here. This file is a high-level
index; full per-release notes live in [`releases/`](releases/).

Stacy uses **date-based versioning**: `vYYYY.MDD.N` (e.g. `v2026.524.0` is the
first stable cut dated 2026-05-24; `.1`, `.2` … are same-day follow-ups).

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
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
