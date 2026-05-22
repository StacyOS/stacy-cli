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
   `stacy run "build a quarterly revenue dashboard from this CSV" --input ...`
3. Register B as contact `meera`.
4. Share the KO using `stacy share <ko> --with-contact meera`.
5. Read on B with provenance and signature verification.
6. Revoke on A.
7. Confirm B's next read is denied.
8. Print receipt summaries for both installs.

Expected proof:

```text
B read before revoke: allowed
A revoked access
B read after revoke: denied
Receipts A includes: create, sign, share, revoke
Receipts B includes: receive, store, read, deny
```

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
  --ko-id ko_public_revenue_dashboard \
  --json

stacy contacts add meera \
  --install-id <consumer_install_id> \
  --endpoint <consumer_api>/api/federation \
  --revocation-url <producer_api>/api/federation/revocations

stacy share ko_public_revenue_dashboard --with-contact meera --expires 30d --revocable
stacy brain show ko_public_revenue_dashboard --as-consumer <consumer_install_id>
stacy revoke ko_public_revenue_dashboard --reason "Public demo revoke"
stacy brain show ko_public_revenue_dashboard --as-consumer <consumer_install_id>
stacy receipts list --ko ko_public_revenue_dashboard
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
