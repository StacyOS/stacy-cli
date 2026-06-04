# StacyOS Federation Phase T Gate

Status: implementation ready; real remote execution is environment-gated.

Phase T moves the demo beyond one host. It does not change the federation
protocol. It adds an operator preflight and runbook for two Stacy installs on
two machines using HTTPS endpoints and signed contact cards.

## Remote Preflight

Run from the `stacy-cli` repo root:

```bash
STACY_FEDERATION_REMOTE_PRODUCER_BASE_URL=https://producer.example.com \
STACY_FEDERATION_REMOTE_CONSUMER_BASE_URL=https://consumer.example.com \
pnpm --filter @arpanstacy/stacy-federation demo:remote:preflight
```

The preflight checks:

1. Both base URLs are valid `https://` URLs.
2. Producer `/api/health` returns HTTP 200 with `{ "status": "ok" }`.
3. Consumer `/api/health` returns HTTP 200 with `{ "status": "ok" }`.
4. The derived federation endpoints are the expected HTTPS paths:
   - producer revocations: `/api/federation/revocations`
   - consumer federation receive: `/api/federation`
   - consumer revocations: `/api/federation/revocations`

For test-only self-signed certificates:

```bash
STACY_FEDERATION_REMOTE_ALLOW_SELF_SIGNED=1 \
STACY_FEDERATION_REMOTE_PRODUCER_BASE_URL=https://producer.example.com \
STACY_FEDERATION_REMOTE_CONSUMER_BASE_URL=https://consumer.example.com \
pnpm --filter @arpanstacy/stacy-federation demo:remote:preflight
```

## Gate Criteria

- The local protocol/public gates remain green.
- A real remote preflight fails closed on plaintext non-loopback HTTP.
- A real remote preflight passes only when both HTTPS installs are reachable.
- Contact exchange uses signed contact cards, not plaintext contact entries.
- The human runbook uses the same public-demo commands as the local harness.

## Non-Goals

- NAT traversal.
- Public directory service.
- Certificate provisioning automation.
- SSH orchestration.
- Any change to KO, grant, tombstone, nonce, or receipt formats.
