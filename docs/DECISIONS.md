# StacyOS Foundational Decisions

> The six week-zero decisions that everything downstream depends on. This file
> records the decisions as they actually stand in the repo today, not as a
> green-field proposal — several were already made implicitly by shipped code
> and published artifacts. Where the build plan
> (`stacyos-detailed-build-plan.md`) recommended something different from the
> shipped reality, the conflict is called out explicitly under **Note**.
>
> Revisit annually or on a major milestone (v1.0, first paying customer, first
> regulated-industry customer).

**Status:** DRAFT — needs founder sign-off.
**Last updated:** 2026-05-30
**Sign-off required from:** founders

---

## How to read this doc

Each decision has:

- **Decision** — the answer that holds today
- **Why** — rationale in 2-3 sentences
- **Reversibility** — how painful to change later
- **Alternatives considered** — what we chose against
- **Status** — `RECOMMENDED` (awaiting sign-off) or `LOCKED` (signed off)

To accept: change `Status: RECOMMENDED` → `Status: LOCKED`.
To override: change **Decision**, add a sentence to **Why** explaining the
override, then set `Status: LOCKED`.

---

## D1: Product name on npm

**Decision:** Ship as `stacy-cli`; hold the vanity name `stacy` for the
flagship binary.

**Why:** `stacy-cli` is already published to npm (currently `2026.505.0`) and
is the name users install today, so changing it now would orphan existing
installs. `stacy` is reserved as the eventual vanity/short name and is already
referenced by the `release:vanity-package-name` check.

**Reversibility:** Painful after launch; near-impossible after 1000+ installs.
Renaming `stacy-cli` → `stacy` would require a deprecation-and-redirect dance.

**Alternatives considered:** `stacyvm` (belongs to the separate microVM
project), bare `stacy` as primary (held back until the install story justifies
the migration cost).

**Status:** RECOMMENDED

> **Note — conflicts with build plan D1.** The plan recommended `stacy` as the
> primary name. Reality: `stacy-cli` is already the published, installed name.
> This doc reflects reality; flag for founder decision if a rename is wanted
> before broader launch.

---

## D2: License

**Decision:** MIT for the open-source code (current `LICENSE`, "Stacy AI").

**Why:** The repository already ships under MIT, which is the most permissive
and least friction for early adoption and contributions. Commercial / hosted
team terms can be layered on separately when the Team tier lands (~v0.5)
without changing the OSS license of the core.

**Reversibility:** Tightening MIT → a source-available or copyleft license
later is possible for new versions but cannot be applied retroactively to code
already released under MIT.

**Alternatives considered:** Apache-2.0 (build plan's recommendation — adds an
explicit patent grant; worth reconsidering before v1.0 if patent posture
matters), BSL/source-available (premature for an early OSS-first product).

**Status:** RECOMMENDED

> **Note — conflicts with build plan D2.** The plan recommended Apache-2.0.
> Shipped reality is MIT. Decide before v1.0 whether the Apache patent grant is
> worth a relicense while the contributor set is still small.

---

## D3: Default LLM model

**Decision:** Anthropic Claude (`claude-sonnet-4-5` for the captured/cached
adapter path), bring-your-own-key, with a pluggable adapter contract.

**Why:** The federation demo and live/cached adapter paths are already built
and captured against Claude Sonnet, and the adapter contract is documented.
BYO-key keeps user LLM spend at $0 to us.

**Reversibility:** Easy — the adapter registry is designed for additional
providers (OpenAI, Gemini, local) without touching the core.

**Alternatives considered:** Bundling a hosted key (rejected: cost + abuse),
local-only model default (rejected: quality at this stage).

**Status:** RECOMMENDED

---

## D4: Database

**Decision:** Embedded Postgres by default (`database.mode = "embedded-postgres"`),
with external Postgres supported for hosted/team deployments.

**Why:** The config schema, migrations (`@arpanstacy/stacy-db`), and CI e2e
setup already standardize on embedded Postgres, giving every install a real
SQL engine with zero external dependencies while keeping a clean upgrade path
to managed Postgres.

**Reversibility:** Moderate — schema is portable, but switching the default
engine would mean a migration path for existing installs.

**Alternatives considered:** SQLite default (rejected: federation/audit queries
benefit from Postgres semantics; the project already has dual-mode history
elsewhere), external-Postgres-required (rejected: kills the zero-setup local
story).

**Status:** RECOMMENDED

---

## D5: Telemetry

**Decision:** Off by default; opt-in via an explicit env var. Anonymous,
content-free events only; full disclosure in `docs/telemetry.md` (to ship with
Phase 1).

**Why:** Privacy-sensitive developer audience; opt-in is the only defensible
default. We still need activation data to know whether the KO abstraction
lands, so a documented opt-in path exists.

**Reversibility:** Easy to extend the event set; the off-by-default contract
must never be reversed.

**Alternatives considered:** On-by-default with opt-out (rejected on trust
grounds), no telemetry at all (rejected: flying blind on activation).

**Status:** RECOMMENDED

---

## D6: Hosting (public demo + site)

**Decision:** Static landing/site on GitHub Pages (`stacyos.github.io`);
hosted federation demo on small VPS instances (`a.stacy.dev` / `b.stacy.dev`)
behind a TLS-terminating reverse proxy, deployed in Phase 3.

**Why:** Cheapest credible path: free static hosting for the marketing
surface, ~$40-80/mo for the two-install live federation demo that is the main
credibility unlock for non-engineer audiences.

**Reversibility:** Easy — both surfaces are stateless/reseeded and can move
hosts without user impact.

**Alternatives considered:** Single-box two-port demo (kept as the cheaper
fallback), fully managed PaaS (rejected: cost vs. control at this stage).

**Status:** RECOMMENDED

---

## Open cross-cutting issue: default branch vs. CI triggers

Not one of the six decisions, but it blocks the Phase 0 release gate and is
worth a founder call:

- `origin/HEAD` points at **`main`** (the GitHub default branch).
- Existing workflows `pr.yml` and `release.yml` trigger on **`master`**.

These two facts are inconsistent: PR/release CI may not fire on PRs targeting
the actual default branch. Resolve by either (a) renaming the default to
`master`, or (b) updating the workflow triggers to `main`. The new
`release-check.yml` gate triggers on **both** as a stopgap until this is
settled.

**Status:** NEEDS DECISION
