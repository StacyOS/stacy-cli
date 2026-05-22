# StacyOS Federation Demo Runbook

This is the operator script for the federation demo and the public CSV-backed
storyline.

## Clean Checkout Setup

From the `stacy-cli` repo root:

```bash
pnpm install
pnpm --filter @arpanstacy/stacy-federation preflight
```

The preflight verifies that the federation package, Stacy CLI entrypoint, server
package, test harness, and local `tsx` runtime are present before any slower
demo checks run.

## One-Command Verification

```bash
pnpm --filter @arpanstacy/stacy-federation demo:check
```

This is the command to run before every protocol demo. It verifies:

1. preflight
2. TypeScript typecheck
3. acceptance criteria
4. real Stacy Postgres persistence
5. real two-install local server flow

Expected high-level result:

```text
Stacy federation demo preflight passed.
test/acceptance/federation-demo.acceptance.test.ts: 7 passed
src/brain/local-brain.integration.test.ts: 4 passed
test/harness/real-two-install-smoke.test.ts: 4 passed
```

The full real-server smoke should complete well under the four-minute demo bar.
On the latest local run it completed in about 53 seconds.

## Repeated Verification

Before an investor-facing run, repeat the full check:

```bash
pnpm --filter @arpanstacy/stacy-federation demo:repeat
```

By default this runs `demo:check` twice. Override the count when needed:

```bash
STACY_FEDERATION_DEMO_REPEAT=3 pnpm --filter @arpanstacy/stacy-federation demo:repeat
```

Latest known-good repeated run:

```text
repeated demo check passed 3/3 runs
run 1: 63.03s
run 2: 57.03s
run 3: 57.18s
slowest run: 63.03s
```

## Public Demo Quickstart

Use this for the public, literal "task becomes signed KO" demo:

```bash
pnpm install
pnpm --filter @arpanstacy/stacy-federation preflight
STACY_FEDERATION_PUBLIC_DEMO_REPEAT=3 pnpm --filter @arpanstacy/stacy-federation demo:public:repeat
```

The repeated public demo should finish 3/3 under the four-minute bar. The latest
known-good slowest run is 17.96 seconds.

## Public Demo Walkthrough

Run the public storyline:

```bash
pnpm --filter @arpanstacy/stacy-federation demo:public
```

This executes the literal public demo:

1. Start isolated install A and install B.
2. Create a signed dashboard KO on A from `demo/acme-q2-revenue.csv`:
   `stacy run "build a quarterly revenue dashboard from this CSV" --input ... --schema ...`
3. Export B's signed contact card and import it on A as `meera`.
4. Share the KO using `stacy share <ko> --with-contact meera`.
5. Read on B with provenance and signature verification.
6. Revoke on A.
7. Confirm B's next read is denied.
8. Print receipt summaries for both installs.

By default the dashboard generator is deterministic so the demo is reliable
offline. The public Acme demo passes `demo/acme-dashboard.schema.json` so the
CSV-to-widget mapping is explicit rather than hardcoded. Without `--schema`,
Stacy infers a compact dashboard from numeric CSV columns.

To prove the adapter seam with a local fake adapter, run:

```bash
pnpm --filter @arpanstacy/stacy-federation demo:public:adapter-smoke
```

To use a real adapter command, set `STACY_PUBLIC_DEMO_ADAPTER` and optionally
`STACY_PUBLIC_DEMO_ADAPTER_ARGS` as a JSON array of strings. Adapter execution
is bounded by `--adapter-timeout-ms`, which defaults to 60000ms and kills the
adapter process on timeout. For safer demos, set
`STACY_PUBLIC_DEMO_ALLOWED_ADAPTERS` to a comma-separated list of permitted
adapter binary names. Because adapter execution can send parsed input records
outside this install, adapter-backed `stacy run` requires `--ack-egress`:

```bash
STACY_PUBLIC_DEMO_ALLOWED_ADAPTERS=claude STACY_PUBLIC_DEMO_ADAPTER=claude pnpm --filter @arpanstacy/stacy-federation demo:public
STACY_PUBLIC_DEMO_ADAPTER=node STACY_PUBLIC_DEMO_ADAPTER_ARGS='["packages/federation/scripts/public-demo-fake-adapter.mjs"]' pnpm --filter @arpanstacy/stacy-federation demo:public
```

Expected proof:

```text
Generator: deterministic_dashboard
B read before revoke: allowed
A revoked access
B read after revoke: denied
Receipt chain A: valid
Receipt chain B: valid
Receipts A includes: create, sign, share, revoke
Receipts B includes: receive, store, read, deny
```

The federation transport message also carries a signed nonce and timestamp. B
rejects stale or replayed messages before storing the KO or grant. Accepted
nonces are persisted on B until their replay window expires, so a B-side restart
does not reopen the same signed message inside the window.

Federation delivery and revocation lookup URLs must use `https://` outside the
local loopback demo. The runbook commands use `http://127.0.0.1:<port>` because
both installs run on the same machine; non-loopback `http://` endpoints are
rejected before delivery or revocation fetch.

Before a public presentation, run:

```bash
STACY_FEDERATION_PUBLIC_DEMO_REPEAT=3 pnpm --filter @arpanstacy/stacy-federation demo:public:repeat
```

Latest known-good public repeat:

```text
repeated public demo passed 3/3 runs
run 1: 17.96s
run 2: 17.39s
run 3: 17.62s
slowest public demo run: 17.96s
```

## Manual Public Commands

The public smoke creates isolated configs dynamically, but the human-facing
commands it exercises are:

```bash
stacy run "build a quarterly revenue dashboard from this CSV" \
  --input packages/federation/demo/acme-q2-revenue.csv \
  --schema packages/federation/demo/acme-dashboard.schema.json \
  --ack-egress \
  --adapter-timeout-ms 60000 \
  --ko-id ko_public_revenue_dashboard \
  --json

stacy contacts export meera \
  --endpoint <consumer_api>/api/federation \
  --revocation-url <consumer_api>/api/federation/revocations \
  --out meera.contact-card.json

stacy contacts import meera.contact-card.json --as meera

stacy share ko_public_revenue_dashboard \
  --with-contact meera \
  --revocation-url <producer_api>/api/federation/revocations \
  --expires 30d \
  --revocable
stacy brain show ko_public_revenue_dashboard --as-consumer <consumer_install_id>
stacy revoke ko_public_revenue_dashboard --reason "Public demo revoke"
stacy brain show ko_public_revenue_dashboard --as-consumer <consumer_install_id>
stacy receipts list --ko ko_public_revenue_dashboard
stacy receipts verify --ko ko_public_revenue_dashboard
```

`receipts verify` checks the per-KO receipt hash chain. It should report:

```text
Receipt chain valid. Checked <n> receipt(s).
```

## Demo Storyboard

The real two-install smoke is the executable storyboard:

1. Start install A and install B with separate homes, configs, DB ports, server
   ports, storage directories, and identities.
2. Create a signed Knowledge Object on A.
3. Create or load B's install identity.
4. Share A's KO to B with per-object read consent and a producer revocation URL.
5. Read the federated KO on B with provenance and signature verification.
6. Confirm expired consent denies B's read.
7. Revoke the KO on A.
8. Read on B again.
9. B checks A's revocation state at read time and denies the read without a
   producer push.

## Troubleshooting

- If preflight fails, run `pnpm install` from the repo root and retry.
- If a real smoke test fails with `listen EPERM`, rerun in an environment that
  allows loopback ports for embedded Postgres and the local Stacy servers.
- If a server startup fails, the harness error includes the health URL, PID,
  stdout, and stderr for the failed install.
- If the static acceptance suite passes but real smokes fail, treat that as a
  Phase 5 reliability issue, not a federation feature request.
- If `demo:repeat` fails only on a later run, suspect leaked local process,
  port, or data-directory state and inspect the failed run output first.
- If `demo:public` fails before the share step, check that
  `packages/federation/demo/acme-q2-revenue.csv` exists and that the public task
  command printed a KO id.

## Feature Freeze

Do not modify demo behavior during public presentations. If a gate fails, fix the
reproducibility issue and rerun the repeat gate before presenting.
