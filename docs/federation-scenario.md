# Federation Demo Scenario

## Scenario Brief

Northstar Clinic is a primary-care clinic running StacyOS as install A.
Eastside Specialty is a cardiology practice running an independent StacyOS
install B. Dr. Aria Shah at Northstar prepares a second-opinion referral packet
for Dr. Meera Patel at Eastside after patient `N.P.` reports chest tightness and
shows an abnormal ECG. The packet contains a referral summary, lab snapshot,
current medications, imaging status, consent expiry, and clinical questions for
the specialist.

Northstar creates the packet locally as a signed Knowledge Object. The object is
content-addressed, signed by Northstar's install identity, and stored with
provenance. Northstar then grants Eastside per-object read consent and federates
the packet to Eastside. Eastside can read the packet only while the grant is
valid; the read path verifies the signature, content hash, consent grant,
expiry, and revocation state.

The revocation moment is patient-driven. Before the appointment, patient `N.P.`
withdraws consent. Northstar revokes the grant with reason `Patient withdrew
consent`. Eastside's next read is denied by Eastside's own Stacy install without
Northstar pushing a delete message. Receipts on both installs preserve the full
audit trail: create, sign, share, receive, read, revoke, and deny.

## Actors

| Role | Demo Name | Stacy Identity |
| --- | --- | --- |
| Producer organization | Northstar Clinic | Install A |
| Producer clinician | Dr. Aria Shah | Northstar operator |
| Consumer organization | Eastside Specialty | Install B |
| Consumer clinician | Dr. Meera Patel | Eastside operator |
| Subject | Patient N.P. | Referenced in referral packet only |

## Artifact Shape

The canonical artifact is a patient referral packet. Phase B should replace the
current generic revenue fixture with synthetic healthcare data shaped like this:

- referral summary
- lab snapshot
- medication list
- imaging status
- consent expiry
- revocation reason

Suggested synthetic fields:

| Field | Example |
| --- | --- |
| `patient_ref` | `N.P.` |
| `referral_reason` | `Second opinion after abnormal ECG` |
| `clinical_summary` | `Intermittent chest tightness, elevated LDL, family history of CAD` |
| `lab_snapshot` | `LDL 162 mg/dL; hs-CRP 4.8 mg/L; troponin negative` |
| `medications` | `Atorvastatin 20mg; aspirin 81mg pending specialist review` |
| `imaging_status` | `ECG attached; echo scheduled` |
| `consent_expires` | `2026-06-22T23:59:59Z` |
| `revocation_reason` | `Patient withdrew consent` |

Use synthetic data only. The demo should feel regulated and realistic, but it
must never include real protected health information.

## Locked Pitch

StacyOS proves that coordination between people and AI systems is a protocol
problem: signed context, consent, provenance, and revocation across independent
installs.

## Public Copy Rules

Use:

- "Northstar Clinic creates a signed referral packet."
- "Eastside Specialty receives it with per-object consent."
- "Dr. Meera Patel can read only while consent is valid."
- "The patient withdraws consent."
- "Northstar revokes access."
- "Eastside's next read is denied by Eastside's own Stacy install."

Avoid in public-facing demo material:

- legacy finance placeholder names
- generic revenue dashboard framing
- "toy data"
- "A deletes B's copy"
- "A pushes revocation to B"

## Canonical Public URLs

Use these placeholders until deployment is complete:

- Producer demo: `https://a.stacy.dev/federation/brain/ko_referral_packet`
- Consumer demo: `https://b.stacy.dev/federation/brain/ko_referral_packet?asConsumer=<eastside_install_id>`
- Landing page: `https://stacy.dev/demo`
- Technical walkthrough: `https://stacy.dev/demo/technical`

If the final domains differ, update this section first and then update the
runbook, landing page, README, deck, and video description from here.

## Phase 0 Gate

Phase 0 is complete when every new public demo artifact uses this scenario,
actor list, pitch, artifact shape, and URL vocabulary.
