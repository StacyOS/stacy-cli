# StacyOS Federation Security Roadmap

This roadmap tracks what must happen before a customer security review can move
from demo confidence to deployment approval.

## Ready Now

- Signed KOs, grants, tombstones, contact cards, group rosters, delegation
  primitives, key transitions, and witnessed revocation attestations.
- Read-time revocation enforcement.
- Replay protection with persistent nonce log.
- HTTPS-required transport policy outside loopback.
- Adapter timeout, allowlist, egress acknowledgement, redaction, and output
  schema validation.
- Per-KO receipt chain and global receipt anchor chain.
- Public demo and repeat gates.

## Before External Audit

- Freeze the federation SPEC for the audit window.
- Generate fresh diagrams for signed object flows.
- Export current test matrix and coverage list.
- Run full local gate and public demo repeat gate.
- Produce known limitations list with owner and severity.
- Decide whether witnessed revocation server operations are in or out of audit
  scope.

## External Audit Candidates

Candidate categories:

- Crypto/protocol specialist.
- Application security firm.
- Healthcare/security compliance advisor for scenario review.

Outreach packet:

- Audit packet.
- Threat model.
- SPEC.
- Test matrix.
- Known limitations.
- One-page demo scenario.

## Customer Security Review Prep

- Complete security questionnaire.
- Provide deployment diagram.
- Provide data-flow diagram.
- Provide key management notes.
- Provide adapter egress controls.
- Provide incident/bug bounty contact.
- Provide changelog and release branch.

## Bug Bounty Starter Scope

In scope:

- Signature bypass.
- Consent bypass.
- Revocation bypass.
- Replay acceptance.
- Receipt tamper undetected.
- Contact card/link forgery.
- Key transition forgery.
- Witness policy bypass.

Out of scope for starter bounty:

- Denial-of-service on local demo processes.
- Social engineering.
- Bugs requiring real PHI.
- Issues outside federation package unless they directly bypass federation
  guarantees.

## Security Milestones

| Milestone | Exit Criteria |
| --- | --- |
| Audit-ready | Packet complete, gates green, limitations signed off |
| Partner-ready | Design partner can run synthetic pilot and review security docs |
| Audit complete | Findings triaged, fixes landed, public summary written |
| Customer-ready | Deployment guide, incident path, and questionnaire accepted |
