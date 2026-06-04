# Federation Demo Script

This is the canonical pitch and screen-recording script for the StacyOS
federation demo. It should be used verbatim across the video, landing page,
README, investor deck, and live demo talk track until the scenario changes.

## One-Sentence Pitch

StacyOS proves that coordination between people and AI systems is a protocol
problem: signed context, consent, provenance, and revocation across independent
installs.

## Thirty-Second Explanation

Today, when one organization sends sensitive context to another organization or
an AI system, that context usually leaves without durable provenance,
per-object consent, or reliable revocation. StacyOS changes the unit of trust.
Northstar Clinic creates a signed referral packet, grants Eastside Specialty
read consent for that exact object, and Eastside verifies provenance every time
it reads. When the patient withdraws consent, Northstar revokes the grant and
Eastside's own Stacy install denies the next read. No blockchain, no shared
database, no central memory vendor: just signed objects, local enforcement, and
receipts on both sides.

## Ninety-Second Demo Script

### 0-10s: The Problem

"When Northstar Clinic refers a patient to Eastside Specialty, sensitive context
crosses an organizational boundary. Today that usually means a PDF, email
thread, or AI tool upload with weak provenance, unclear consent, and no real
revocation."

Visual:

- show a referral packet leaving Northstar
- callouts: `no provenance`, `no per-object consent`, `no revocation`

### 10-25s: Create Signed Context

"With StacyOS, Northstar turns the referral packet into a signed Knowledge
Object. It has a content hash, creator identity, timestamp, and signature."

Canonical command shape:

```bash
pnpm --filter @arpanstacy/stacy dev -- run "Northstar Clinic Referral Packet" \
  --input packages/federation/demo/referral-packet.csv \
  --output-kind referral_packet \
  --ko-id ko_referral_packet \
  --json
```

Visual:

- producer install A
- `ko_referral_packet`
- content hash
- `Signature: verified`

### 25-45s: Federate With Consent

"Northstar shares only this object with Dr. Meera Patel at Eastside. The consent
grant is signed, scoped to read, revocable, and tied to the referral packet."

Canonical command shape:

```bash
pnpm --filter @arpanstacy/stacy dev -- share ko_referral_packet \
  --with-contact meera \
  --expires 30d \
  --revocable \
  --json
```

Visual:

- B's UI renders the referral packet
- readable identities:
  - Northstar Clinic
  - Dr. Meera Patel / Eastside Specialty
- provenance and consent panels

### 45-65s: Revoke

"Now the patient withdraws consent. Northstar revokes access. Stacy does not
pretend A can delete B's database. Instead, B re-checks consent on read."

Canonical command shape:

```bash
pnpm --filter @arpanstacy/stacy dev -- revoke ko_referral_packet \
  --reason "Patient withdrew consent" \
  --json
```

Visual:

- keep B's browser tab open
- B transitions from `Read allowed` to `Read denied`
- denial reason: `Access revoked by Northstar Clinic`

### 65-82s: Audit

"Both installs keep receipts. The audit trail shows create, sign, share,
receive, read, revoke, and deny. The receipt chains verify."

Canonical command shape:

```bash
pnpm --filter @arpanstacy/stacy dev -- receipts verify --ko ko_referral_packet
pnpm --filter @arpanstacy/stacy dev -- receipts verify --global
```

Visual:

- receipt summary on A
- receipt summary on B
- `Receipt chain valid`
- `Global receipt anchor valid`

### 82-90s: The Claim

"Two installs is the unit test. Ten thousand installs use the same protocol:
signed context, owned consent, local enforcement, and durable receipts."

Visual:

- A and B as two independent installs
- expand to many installs
- end on the one-sentence pitch

## Investor Q&A Anchors

| Question | Answer |
| --- | --- |
| Is this a blockchain? | No. The proof is signed objects and local enforcement, not a global ledger. |
| Does A delete B's copy? | No. B stores what it received, but B denies reads after revocation. |
| Why is revocation scalable? | Consent is enforced at read time, so A does not fan out delete messages to every consumer. |
| Where is AI? | The adapter can generate structured KO content, but the trust layer is model-agnostic. |
| What does the signature prove? | It proves who created the object and whether any signed field changed. |
| What survives restart? | Identities, KOs, grants, revocations, nonces, and receipts persist in Stacy's DB. |

## Public Demo Commands

Phase B should make these commands runnable by replacing the current demo fixture
with `referral-packet.csv` and any matching schema/adapter fixture:

```bash
pnpm --filter @arpanstacy/stacy-federation demo:public
pnpm --filter @arpanstacy/stacy-federation demo:public:adapter-smoke
STACY_FEDERATION_PUBLIC_DEMO_REPEAT=3 pnpm --filter @arpanstacy/stacy-federation demo:public:repeat
```

The canonical public URLs are defined in `docs/federation-scenario.md`.

## Phase 0 Gate

Phase 0 is complete when:

- this one-sentence pitch is stable
- the 30-second explanation is stable
- the 90-second script uses the healthcare referral scenario
- Phase B can copy commands and labels from this document without reopening the
  scenario decision
