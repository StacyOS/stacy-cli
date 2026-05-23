# StacyOS Federation Demo

This is the operator-facing walkthrough for the public StacyOS federation demo.
The canonical scenario is a synthetic healthcare referral: Northstar Clinic
shares a signed referral packet with Dr. Meera Patel at Eastside Specialty, then
revokes access after the patient withdraws consent.

## Quick Start

From the repository root:

```bash
pnpm --filter @arpanstacy/stacy-federation preflight
pnpm --filter @arpanstacy/stacy-federation demo:public
```

Expected final proof:

```text
B read before revoke: allowed
A revoked access
B read after revoke: denied
Receipts A: sign, create, share, revoke
Receipts B: receive, store, read, deny
```

## Adapter Modes

The public demo can run in three adapter modes.

### 1. Deterministic

No external model or network call. Stacy computes the referral packet from the
demo CSV and schema.

```bash
pnpm --filter @arpanstacy/stacy-federation demo:public
```

### 2. Fake Adapter

Runs the bundled fake adapter. This exercises the adapter-command path without
requiring API credentials.

```bash
pnpm --filter @arpanstacy/stacy-federation demo:public:adapter-smoke
```

Expected proof includes:

```text
Generator: adapter_command
```

### 3. Cached Real-LLM Adapter

Replays a committed fixture captured from a real LLM-shaped referral packet
output. This keeps the demo deterministic and offline while making the
LLM-authored content path visible.

```bash
pnpm --filter @arpanstacy/stacy-federation demo:public:adapter-cached
```

The cached fixture lives at:

```text
packages/federation/test/fixtures/adapter-runs/referral-packet-claude.json
```

To refresh it with a real adapter, set the adapter environment variables and run
the capture script:

```bash
STACY_PUBLIC_DEMO_ADAPTER=claude \
STACY_PUBLIC_DEMO_ADAPTER_ARGS='["--some-safe-json-mode"]' \
node packages/federation/scripts/capture-real-adapter.mjs \
  packages/federation/test/fixtures/adapter-runs/referral-packet-claude.json
```

Do not commit API keys or real protected health information. The fixture must
remain synthetic and byte-stable.

## Related Docs

- `docs/federation-demo-quickstart.md`
- `docs/federation-demo-conceptual.md`
- `docs/federation-demo-technical-deep-dive.md`
- `packages/federation/DEMO_RUNBOOK.md`
