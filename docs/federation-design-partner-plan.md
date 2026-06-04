# StacyOS Federation Design Partner Plan

This document turns the product-ready federation work into a design-partner
conversation plan.

## Target Partner Profile

Best first partner:

- Has cross-organization knowledge handoff.
- Needs audit, provenance, consent, and revocation.
- Can tolerate a CLI-first or early UI workflow.
- Has a narrow first use case that does not require broad directory services.

Priority verticals:

1. Healthcare referral coordination.
2. External audit and diligence.
3. Legal disclosure and matter handoff.

## Healthcare Referral Pilot

Actors:

- Producer: Northstar Clinic.
- Consumer: Dr. Meera Patel / Eastside Specialty.
- Subject: synthetic patient referral packet.

Pilot workflow:

1. Clinic creates referral packet KO.
2. Clinic shares with specialist or specialist group.
3. Specialist reads with provenance and consent status.
4. Specialist creates a derived KO as a response or annotation when write scope
   is granted.
5. Clinic revokes after patient withdraws consent.
6. Specialist's next read is denied.
7. Both sides verify receipts.

## Discovery Questions

- What artifact crosses org boundaries today?
- Who needs to prove they created, received, read, or denied access?
- What is the real consent withdrawal event?
- How long should access last by default?
- Does the consumer need read-only access, annotations, or revisions?
- Are groups/roles required on day one?
- Who would operate a witness in high-stakes revocation?
- What evidence would satisfy legal/security review?

## Demo Script For Partner Call

1. Show Northstar creating a referral packet.
2. Show signed KO provenance.
3. Share to Dr. Meera Patel or a group roster.
4. Show Eastside read allowed.
5. Create a derived KO if discussing write scope.
6. Revoke with reason: `Patient withdrew consent`.
7. Show Eastside read denied.
8. Verify receipt chains and global anchor.
9. Explain what is production-ready and what still needs deployment hardening.

## Feedback Capture Template

Partner:

Date:

Use case:

Current workflow:

Minimum viable artifact:

Consent/revocation trigger:

Read/write/admin needs:

Group/role needs:

Audit/export needs:

Deployment constraints:

Security concerns:

Must-have before pilot:

Nice-to-have:

Decision:

Follow-up tickets:

## Pilot Exit Criteria

- Partner can explain who owns the source KO and who owns derived KOs.
- Partner can reproduce allowed read and denied read.
- Partner accepts the audit trail shape.
- Partner identifies a real non-production dataset for a pilot.
- Partner names one owner for deployment/security review.

## Roadmap Conversion

Convert feedback into product tickets under these buckets:

- UX clarity.
- Deployment.
- Security/compliance.
- Protocol extension.
- Adapter/data-shaping.
- Documentation.
