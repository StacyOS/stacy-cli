# StacyOS Federation Demo Runbook

This is the operator script for the federation demo and the public CSV-backed
storyline.

## Canonical Public Story

The public demo story is the healthcare referral scenario:

- Producer: Northstar Clinic
- Consumer: Dr. Meera Patel / Eastside Specialty
- Subject: patient referral packet
- Revocation trigger: patient withdrew consent

Scenario and script source-of-truth:

- `docs/federation-scenario.md`
- `docs/federation-demo-script.md`

Phase B should replace the current internal revenue fixture with the referral
packet fixture described in those docs. Until then, the runnable harness may
still use the existing CSV fixture internally, but public-facing copy, video,
deck, landing page, and UI work should use the healthcare referral story.

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

This executes the healthcare referral public demo.

1. Start isolated install A and install B.
2. Create a signed KO on A from the demo CSV fixture:
   `stacy run "Northstar Clinic Referral Packet" --input ... --output-kind referral_packet ...`
3. Export B's signed contact card and import it on A as `meera`.
4. Share the KO using `stacy share <ko> --with-contact meera`.
5. Read on B with provenance and signature verification.
6. Revoke on A.
7. Confirm B's next read is denied.
8. Print receipt summaries and verify both per-KO and global receipt chains on
   both installs.

By default the content generator is deterministic so the demo is reliable
offline. Dashboard, report, table, and referral-packet KOs are supported through `--output-kind`.
Without `--schema`, Stacy infers a compact dashboard from numeric CSV columns.

CSV input supports UTF-8 with an optional BOM, CRLF or LF line endings, quoted
commas, escaped quotes, multiline quoted cells, and blank trailing lines. An
unclosed quoted field fails before KO creation with a clear parser error.

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
outside this install, adapter-backed `stacy run` requires `--ack-egress`.

Adapters can return plain text or validated JSON. Plain text is stored as
narrative `adapterOutput`; validated JSON can own the selected KO content
contract. `dashboard` is the default output kind, while `report`, `table`, and
`referral_packet` are available for adapter-generated reports, structured
tables, and healthcare referral packets:

```bash
stacy run "build a dashboard" \
  --input ./data.csv \
  --adapter-command ./my-adapter \
  --adapter-output json \
  --ack-egress
```

```bash
stacy run "write a board report" \
  --input ./data.csv \
  --output-kind report \
  --adapter-command ./my-report-adapter \
  --adapter-output json \
  --ack-egress
```

```bash
stacy run "normalize this CSV into a table" \
  --input ./data.csv \
  --output-kind table \
  --adapter-command ./my-table-adapter \
  --adapter-output json \
  --ack-egress
```

```bash
stacy run "Northstar Clinic Referral Packet" \
  --input packages/federation/demo/referral-packet.csv \
  --output-kind referral_packet \
  --adapter-command ./my-referral-adapter \
  --adapter-output json \
  --ack-egress
```

If the input file contains columns that should not be sent to the adapter, redact
them from adapter stdin. The signed KO still records the original file hash and
the list of redacted columns:

```bash
stacy run "build a dashboard" \
  --input ./data.csv \
  --adapter-command ./my-adapter \
  --adapter-output json \
  --redact-column customer_email \
  --redact-column account_owner \
  --ack-egress
```

For scripted demos, the same redaction list can be provided as
`STACY_PUBLIC_DEMO_REDACT_COLUMNS=customer_email,account_owner`.

```bash
STACY_PUBLIC_DEMO_ALLOWED_ADAPTERS=claude STACY_PUBLIC_DEMO_ADAPTER=claude pnpm --filter @arpanstacy/stacy-federation demo:public
STACY_PUBLIC_DEMO_ADAPTER=node STACY_PUBLIC_DEMO_ADAPTER_ARGS='["packages/federation/scripts/public-demo-fake-adapter.mjs"]' pnpm --filter @arpanstacy/stacy-federation demo:public
pnpm --filter @arpanstacy/stacy-federation demo:public:cached-adapter
```

## Write Scope: Consumer Counter-KOs

Write consent does not let Dr. Meera Patel mutate Northstar Clinic's referral
packet. It lets Eastside Specialty create a new consumer-signed derived KO that
references the original referral KO, source content hash, producer install, and
grant id.

Use this when the consumer needs to attach an annotation, response, revision
proposal, or clinical counter-note without changing the producer-owned source
artifact:

```bash
stacy brain derive ko_referral_packet \
  --content-json '{"annotation":"Eastside recommends cardiology follow-up within 7 days."}' \
  --json
```

The derived KO is independently signed by the consumer and emits a `derive`
receipt. Producer revocation of the source grant blocks future derived writes;
already-created derived KOs remain independently signed audit artifacts.

`admin` remains reserved for delegation/admin work and should not be presented as
implemented until group delegation semantics land.

## Group Grants

Phase 3B starts the organizational sharing model with signed group rosters. A
producer-signed roster binds a group id such as `group_eastside_specialty` to
install members and optional role labels. A consent grant can then target:

- one install: `{ "type": "install", "id": "install_..." }`
- one group: `{ "type": "group", "id": "group_eastside_specialty" }`
- one group role: `{ "type": "group", "id": "group_eastside_specialty", "role": "clinician" }`

Read enforcement checks the grant, the producer signature on the roster, the
roster tenant, the producer signer, and current membership. If Dr. Meera Patel is
removed from the producer-signed roster, her next group-grant read is denied.

Delegation now has a signed object and revocation checks at the protocol layer:
a delegate can sign an intended re-share to an install or group, and producer
revocation of that delegation id denies it. The public `stacy share` command
still does not perform delegated delivery; consumers cannot re-share a producer
KO in the demo until that command path is wired to require a verified delegation.

## Schema Compatibility

The public demo verifies content contract versions explicitly. Legacy
dashboard/report/table KOs without `schemaVersion` are treated as v1, while
`referral_packet` supports v1 and v2. Unknown versions fail with a
`content_contract_version` check instead of silently passing.

The migration guide and compatibility matrix are in:

```text
docs/federation-schema-compatibility.md
```

Expected proof:

```text
Generator: deterministic_referral_packet
B read before revoke: allowed
A revoked access: Patient withdrew consent
B read after revoke: denied
Receipt chain A: valid
Receipt chain B: valid
Global receipt anchor A: valid
Global receipt anchor B: valid
Receipts A includes: create, sign, share, revoke
Receipts B includes: receive, store, read, deny
```

The federation transport message also carries a signed nonce and timestamp. B
rejects stale or replayed messages before storing the KO or grant. Accepted
nonces are persisted on B until their replay window expires, so a B-side restart
does not reopen the same signed message inside the window.

## Live UI Revocation Moment

The federation Brain UI subscribes to:

```text
GET /api/federation/brain/:koId/events
```

This server-sent events stream emits a `receipt` event when a new `read`, `deny`,
`revoke`, `receive`, or `store` receipt appears for the KO. The browser uses that
event to refetch the KO read state. During the investor demo, keep B's
`/federation/brain/<ko_id>?asConsumer=<consumer_install_id>` tab open, revoke on
A, and B should transition from `Read allowed` to `Read denied` without a manual
refresh.

If the UI shows `Reconnecting`, wait for the live badge to return before filming
the revocation moment. If the browser does not support EventSource, the page
still works with manual refresh but is not ready for the 90-second video take.

Federation delivery and revocation lookup URLs must use `https://` outside the
local loopback demo. The runbook commands use `http://127.0.0.1:<port>` because
both installs run on the same machine; non-loopback `http://` endpoints are
rejected before delivery or revocation fetch.

For a non-loopback federation demo, configure the Stacy server with PEM files
and share `https://` endpoints:

```json
{
  "server": {
    "tls": {
      "enabled": true,
      "certPath": "~/.stacy/certs/server.crt",
      "keyPath": "~/.stacy/certs/server.key"
    }
  }
}
```

Equivalent environment variables:

```bash
STACY_SERVER_TLS_ENABLED=true \
STACY_SERVER_TLS_CERT_PATH=~/.stacy/certs/server.crt \
STACY_SERVER_TLS_KEY_PATH=~/.stacy/certs/server.key \
pnpm --filter @arpanstacy/stacy dev -- run
```

When TLS is enabled, Stacy advertises `https://` runtime API candidates unless
an explicit public base URL overrides them.

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
stacy run "Northstar Clinic Referral Packet" \
  --input packages/federation/demo/referral-packet.csv \
  --output-kind referral_packet \
  --ack-egress \
  --adapter-timeout-ms 60000 \
  --ko-id ko_referral_packet \
  --json

stacy contacts share-link meera \
  --endpoint <consumer_api>/api/federation \
  --revocation-url <consumer_api>/api/federation/revocations \
  --label "Dr. Meera Patel / Eastside Specialty" \
  --expires 15m \
  --json

stacy contacts import-link "<signed_share_link>" --as meera

stacy share ko_referral_packet \
  --with-contact meera \
  --revocation-url <producer_api>/api/federation/revocations \
  --expires 30d \
  --revocable
stacy brain show ko_referral_packet --as-consumer <consumer_install_id>
stacy revoke ko_referral_packet --reason "Patient withdrew consent"
stacy brain show ko_referral_packet --as-consumer <consumer_install_id>
stacy receipts list --ko ko_referral_packet
stacy receipts verify --ko ko_referral_packet
stacy receipts verify --global
```

## Federation-Aware Onboarding

Fresh cloned-repo users can discover federation without reading the deep
protocol docs first:

```bash
stacy onboard --federation-demo
```

Onboarding now creates the local federation install identity and prints the
next commands for the local two-install referral demo.

To connect a remote peer during onboarding, paste a signed contact share link:

```bash
stacy onboard --federation-peer-link "<signed_share_link>"
```

The peer link is verified before it is saved as contact `peer`. Onboarding then
prints the follow-up share command:

```bash
stacy share <ko_id> --with-contact peer --revocable
```

## Stable Read API

The public integration endpoint is:

```http
GET /api/federation/v1/ko/:id
```

It returns the same consent-enforced payload used by the Brain UI. Add
`?asConsumer=<install_id>` to enforce a federated consumer read:

```bash
curl "https://b.stacy.dev/api/federation/v1/ko/ko_referral_packet?asConsumer=<consumer_install_id>"
```

The unversioned alias `GET /api/federation/ko/:id` is also mounted for the
current public demo. The OpenAPI contract lives at
`docs/openapi/federation.yaml`.

## Metrics And Observability

Each install exposes public-demo metrics at:

```http
GET /api/federation/metrics
```

The response includes KO, share, receive, read, deny, and revoke counts, average
receive/read-enforcement timings when timing receipts are present, and global
receipt-anchor validity. The Brain UI renders the same values in its
Federation metrics panel so presenters can quote measured numbers instead of
hand-waving.

Note: `packages/federation/demo/referral-packet.csv` is the Phase B fixture
target. If you are running the current pre-Phase-B harness, use the checked-in
demo fixture referenced by `demo:public`.

`receipts verify --ko` checks the per-KO receipt hash chain. It should report:

```text
Receipt chain valid. Checked <n> receipt(s).
```

`receipts verify --global` checks the instance-level receipt anchor chain across
all KOs. It should report:

```text
Global receipt anchor valid. Checked <n> anchor(s).
```

## Two-Machine HTTPS Demo

Phase T runs the same story across two real machines. Use one terminal on the
producer machine A and one terminal on the consumer machine B.

Prerequisites:

- Both machines are on the same branch and have run `pnpm install`.
- Both Stacy servers are reachable through HTTPS.
- Each config has TLS enabled, either through `server.tls` or
  `STACY_SERVER_TLS_*`.
- The producer base URL and consumer base URL are stable for the demo.

### 1. Start Both Installs

On machine A:

```bash
STACY_SERVER_TLS_ENABLED=true \
STACY_SERVER_TLS_CERT_PATH=/path/to/producer.crt \
STACY_SERVER_TLS_KEY_PATH=/path/to/producer.key \
pnpm --filter @arpanstacy/stacy dev -- run --config /path/to/producer/config.json
```

On machine B:

```bash
STACY_SERVER_TLS_ENABLED=true \
STACY_SERVER_TLS_CERT_PATH=/path/to/consumer.crt \
STACY_SERVER_TLS_KEY_PATH=/path/to/consumer.key \
pnpm --filter @arpanstacy/stacy dev -- run --config /path/to/consumer/config.json
```

### 2. Verify Remote Reachability

From either checkout:

```bash
STACY_FEDERATION_REMOTE_PRODUCER_BASE_URL=https://producer.example.com \
STACY_FEDERATION_REMOTE_CONSUMER_BASE_URL=https://consumer.example.com \
pnpm --filter @arpanstacy/stacy-federation demo:remote:preflight
```

For a private test with self-signed certs, add:

```bash
STACY_FEDERATION_REMOTE_ALLOW_SELF_SIGNED=1
```

Do not use `http://` for non-loopback hosts. The federation CLI rejects
plaintext remote delivery and revocation URLs.

### 3. Create B's Signed Contact Share Link

On machine B:

```bash
pnpm --filter @arpanstacy/stacy dev -- contacts share-link meera \
  --config /path/to/consumer/config.json \
  --endpoint https://consumer.example.com/api/federation \
  --revocation-url https://consumer.example.com/api/federation/revocations \
  --label "Dr. Meera Patel / Eastside Specialty" \
  --expires 15m \
  --json
```

Send the printed `link` to machine A. Email, Signal, QR code, or any message
channel is fine; import verifies the signed link, expiry, contact-card
signature, and install-id binding.

### 4. Import B On A From The Link

On machine A:

```bash
pnpm --filter @arpanstacy/stacy dev -- contacts import-link "<signed_share_link>" \
  --config /path/to/producer/config.json \
  --as meera \
  --json
```

Save the printed `installId`; B will use it as the consumer id when reading.

### 5. Create The CSV-Backed Referral KO On A

On machine A:

```bash
pnpm --filter @arpanstacy/stacy dev -- run "Northstar Clinic Referral Packet" \
  --config /path/to/producer/config.json \
  --input packages/federation/demo/referral-packet.csv \
  --output-kind referral_packet \
  --ko-id ko_referral_packet \
  --json
```

### 6. Share From A To B

On machine A:

```bash
pnpm --filter @arpanstacy/stacy dev -- share ko_referral_packet \
  --config /path/to/producer/config.json \
  --with-contact meera \
  --revocation-url https://producer.example.com/api/federation/revocations \
  --expires 30d \
  --revocable \
  --json
```

The JSON output should show delivery status `201`.

### 7. Read On B

On machine B:

```bash
pnpm --filter @arpanstacy/stacy dev -- brain show ko_referral_packet \
  --config /path/to/consumer/config.json \
  --as-consumer <consumer_install_id>
```

Expected proof:

```text
Signature: verified
Consent: enforced on read
Referral packet: Northstar Clinic Referral Packet
```

### 8. Revoke On A, Then Read Again On B

On machine A:

```bash
pnpm --filter @arpanstacy/stacy dev -- revoke ko_referral_packet \
  --config /path/to/producer/config.json \
  --reason "Patient withdrew consent" \
  --json
```

On machine B:

```bash
pnpm --filter @arpanstacy/stacy dev -- brain show ko_referral_packet \
  --config /path/to/consumer/config.json \
  --as-consumer <consumer_install_id>
```

Expected final proof:

```text
Consent grant has been revoked
```

### 9. Verify Receipts

Run on both machines:

```bash
pnpm --filter @arpanstacy/stacy dev -- receipts list \
  --config /path/to/config.json \
  --ko ko_referral_packet

pnpm --filter @arpanstacy/stacy dev -- receipts verify \
  --config /path/to/config.json \
  --ko ko_referral_packet

pnpm --filter @arpanstacy/stacy dev -- receipts verify \
  --config /path/to/config.json \
  --global
```

### 10. Optional: Rotate An Install Key

Historical KOs keep verifying because every signed object carries its signer.
The rotation command records a dual-signed transition from the old install key
to the new install key, then replaces the active identity file.

```bash
pnpm --filter @arpanstacy/stacy dev -- identity rotate \
  --config /path/to/config.json \
  --reason "scheduled operator rotation" \
  --json

pnpm --filter @arpanstacy/stacy dev -- identity verify-chain \
  --config /path/to/config.json
```

Expected proof:

```text
Install key chain valid. Checked 1 transition(s).
```

### 11. Optional: Require Witnessed Revocation

The default demo uses producer-only revocation: A's signed tombstone is enough
for B to deny the next read. High-stakes flows can layer witness policy on top.
A witness signs an attestation over the tombstone id and tombstone hash, and B
can require at least N valid witnesses before accepting the revocation as
authoritative.

Policy modes:

- `producer_only`: current public demo behavior.
- `witnessed`: require one or more valid witness attestations, optionally from a
  trusted witness allowlist.

The witness layer does not change KO, grant, or tombstone formats. It is an
additional verification policy for sensitive referral packets.

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
- If `demo:public` fails before the share step, check that the configured demo
  CSV fixture exists and that the public task command printed a KO id.

## Feature Freeze

Do not modify demo behavior during public presentations. If a gate fails, fix the
reproducibility issue and rerun the repeat gate before presenting.
