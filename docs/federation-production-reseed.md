# Federation Production Demo Reseed

Use the reseed script to restore a public demo deployment to a clean referral
scenario without restarting the Stacy servers. The script truncates only
federation demo tables on both installs, then recreates the signed contact,
referral KO, and share grant through the normal Stacy CLI path.

## Required Environment

```bash
export STACY_FEDERATION_RESEED_A_CONFIG=/opt/stacy/a/config.json
export STACY_FEDERATION_RESEED_B_CONFIG=/opt/stacy/b/config.json
export STACY_FEDERATION_RESEED_B_ENDPOINT=https://b.stacy.dev/api/federation
export STACY_FEDERATION_RESEED_A_REVOCATION_URL=https://a.stacy.dev/api/federation/revocations
```

Optional settings:

```bash
export STACY_FEDERATION_RESEED_B_REVOCATION_URL=https://b.stacy.dev/api/federation/revocations
export STACY_FEDERATION_RESEED_CONTACT_NAME=meera
export STACY_FEDERATION_RESEED_CONTACT_LABEL="Dr. Meera Patel / Eastside Specialty"
export STACY_FEDERATION_RESEED_KO_ID=ko_referral_packet
export STACY_FEDERATION_RESEED_LINK_EXPIRES=15m
export STACY_FEDERATION_RESEED_GRANT_EXPIRES=30d
```

## Manual Run

```bash
cd /opt/stacy
pnpm --filter @arpanstacy/stacy-federation reseed:production
```

To verify the script in a local ephemeral harness before wiring production
variables:

```bash
pnpm --filter @arpanstacy/stacy-federation exec node scripts/reseed-production-demo.mjs --local-check
```

## Cron

Recommended nightly cron:

```cron
0 4 * * * cd /opt/stacy && pnpm --filter @arpanstacy/stacy-federation reseed:production >> /var/log/stacy-federation-reseed.log 2>&1
```

## systemd Timer

`/etc/systemd/system/stacy-federation-reseed.service`:

```ini
[Unit]
Description=Reseed Stacy federation public demo

[Service]
Type=oneshot
WorkingDirectory=/opt/stacy
EnvironmentFile=/etc/stacy/federation-reseed.env
ExecStart=/usr/bin/pnpm --filter @arpanstacy/stacy-federation reseed:production
```

`/etc/systemd/system/stacy-federation-reseed.timer`:

```ini
[Unit]
Description=Nightly Stacy federation public demo reseed

[Timer]
OnCalendar=*-*-* 04:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

Enable it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now stacy-federation-reseed.timer
```

## Rollback

1. Stop the timer with `sudo systemctl stop stacy-federation-reseed.timer`.
2. Restore both install databases from the most recent Stacy backup.
3. Restart the two Stacy servers.
4. Run `stacy receipts verify --global` on both installs.
5. Re-enable the timer only after the manual public demo flow succeeds.
