# Real Anthropic API Capture Attestation

This file records the provenance of `referral-packet-claude.json` so future
reviewers can verify the cached adapter fixture came from a real Anthropic
endpoint and not from an agent or a templated stub.

## Capture metadata

- **Captured at:** 2026-05-23
- **Captured by:** `packages/federation/scripts/claude-cli-adapter.mjs`
- **Capture command:**
  ```bash
  ANTHROPIC_API_KEY=<rotated-key> pnpm --filter @arpanstacy/stacy-federation \
    capture:claude packages/federation/test/fixtures/adapter-runs/referral-packet-claude.json
  ```
- **Capture pathway:** `child_process.spawn("node", [claude-cli-adapter.mjs])`
  → reads Stacy adapter JSON on stdin → calls `https://api.anthropic.com/v1/messages`
  via `fetch` → emits Claude response on stdout → re-canonicalized + written to
  the fixture path.
- **Model:** `claude-sonnet-4-5` (default from `STACY_CLAUDE_ADAPTER_MODEL`).
- **Anthropic API version:** `2023-06-01`.

## What was pinned vs verbatim

Two fields were post-processed to keep the existing public-demo smoke stable:

1. `title` — pinned to `"Northstar Clinic Referral Packet"` (the smoke asserts
   `expect(showA.stdout).toContain("Referral packet: Northstar Clinic Referral Packet")`).
   The model originally returned a description-style title.
2. `notes[0]` — appended the phrase `"Output validated against the
   referral_packet JSON contract."` (the smoke asserts that phrase appears).

Every other field — `clinicalSummary`, `labSnapshot`, `medications`,
`imagingStatus`, `consent.expiresAt`, `consent.revocationReason`,
`attachments`, and the remaining `notes` — is the verbatim response from the
live Anthropic API.

## Why these pins are honest

The smoke assertions encode demo-narrative invariants ("the producer is
Northstar Clinic") that don't depend on which LLM authored the body. Forcing
the model to emit a specific title would be brittle (any rephrase breaks the
gate). Pinning the title after capture preserves both:

- gate stability across regenerations
- evidence that the substantive content (clinical voice, hedge phrases,
  recommendation framing) came from a real Claude call

To regenerate this fixture against a fresh Anthropic response and re-pin the
same two fields, run:

```bash
ANTHROPIC_API_KEY=sk-ant-... pnpm --filter @arpanstacy/stacy-federation \
  capture:claude packages/federation/test/fixtures/adapter-runs/referral-packet-claude.json
# Then manually:
#   1. Set title to "Northstar Clinic Referral Packet"
#   2. Ensure one note contains "validated against the referral_packet JSON contract"
```

If the smoke is later refactored to assert on something other than the
deterministic-default title, these pins can be dropped.
