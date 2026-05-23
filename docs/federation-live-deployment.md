# Federation Live Deployment Runbook

This runbook is the Phase 1F checklist for turning the local federation demo
into a clickable public demo.

## Target URLs

- Producer install: `https://a.stacy.dev`
- Consumer install: `https://b.stacy.dev`
- Producer KO page: `https://a.stacy.dev/federation/brain/ko_referral_packet`
- Consumer KO page: `https://b.stacy.dev/federation/brain/ko_referral_packet?asConsumer=<eastside_install_id>`
- Landing page: `https://stacy.dev/demo`

## Required State

Install A, Northstar Clinic:

- stable install identity
- signed referral packet KO: `ko_referral_packet`
- signed contact share link for Eastside imported as `meera`
- revocation endpoint reachable at `https://a.stacy.dev/api/federation/revocations`

Install B, Eastside Specialty:

- stable install identity
- signed contact share link created for Dr. Meera Patel / Eastside Specialty
- federation endpoint reachable at `https://b.stacy.dev/api/federation`
- federated copy of `ko_referral_packet`

## Deployment Steps

1. Provision two hosts or two isolated service instances.
2. Point DNS:
   - `a.stacy.dev` -> producer host
   - `b.stacy.dev` -> consumer host
3. Install dependencies and build the repo.
4. Configure TLS with either a reverse proxy or Stacy server TLS:

```bash
STACY_SERVER_TLS_ENABLED=true
STACY_SERVER_TLS_CERT_PATH=/etc/letsencrypt/live/a.stacy.dev/fullchain.pem
STACY_SERVER_TLS_KEY_PATH=/etc/letsencrypt/live/a.stacy.dev/privkey.pem
```

5. Start each Stacy server under a process manager.
6. Run the seed script once.
7. Verify both public URLs return HTTP 200 over HTTPS.
8. Run the remote preflight:

```bash
STACY_FEDERATION_REMOTE_PRODUCER_BASE_URL=https://a.stacy.dev \
STACY_FEDERATION_REMOTE_CONSUMER_BASE_URL=https://b.stacy.dev \
pnpm --filter @arpanstacy/stacy-federation demo:remote:preflight
```

## Seed Script Contract

The seed script must:

1. create or load both install identities
2. create B's signed contact share link with label `Dr. Meera Patel / Eastside Specialty`
3. import that link into A as `meera`
4. create `ko_referral_packet` on A from `packages/federation/demo/referral-packet.csv`
5. share it to B with `--with-contact meera`
6. read on B once to prove allowed state
7. verify receipts on both installs

The reset script may delete only demo-owned KO, grant, revocation, nonce, and
receipt rows. It must not rotate install identities during normal resets because
stable URLs and screenshots depend on stable labels.

## Reseed Cron

Run the reset/seed script hourly while the public demo is live:

```cron
0 * * * * cd /srv/stacy-cli && ./scripts/seed-federation-referral-demo.sh >> /var/log/stacy-federation-seed.log 2>&1
```

## Health Checks

Required checks before publishing the URL:

- `https://a.stacy.dev/api/health` returns 200
- `https://b.stacy.dev/api/health` returns 200
- producer KO page renders
- consumer KO page renders allowed state
- revoke on A causes B to deny on next read
- receipt chain verification passes on both installs

## Gate

Phase 1F is complete when a person outside the development machine can open the
consumer URL, see the referral packet, watch it lose access after revocation,
and reload both pages after a server restart without losing seeded state.
