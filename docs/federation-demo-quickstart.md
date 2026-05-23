# Federation Demo Quickstart

This is the fastest path from a fresh checkout to a working public demo.

## 1. Install

```bash
pnpm install
```

## 2. Run The Public Story

```bash
pnpm --filter @arpanstacy/stacy-federation demo:public
```

Expected proof:

```text
B read before revoke: allowed
A revoked access: Patient withdrew consent
B read after revoke: denied
Receipt chain A: valid
Global receipt anchor B: valid
```

## 3. Run The Signed Contact Share-Link Flow

```bash
stacy contacts share-link meera \
  --endpoint https://b.stacy.dev/api/federation \
  --revocation-url https://b.stacy.dev/api/federation/revocations \
  --label "Dr. Meera Patel / Eastside Specialty" \
  --expires 15m \
  --json

stacy contacts import-link "<signed_share_link>" --as meera
```

## 4. Run The Adversarial Demo

```bash
pnpm --filter @arpanstacy/stacy-federation demo:adversarial
```

This proves replay, tampering, forged signatures, expired grants, and revoked
grants fail closed.

## 5. OpenAPI

Read KOs through:

```http
GET /api/federation/v1/ko/:id
```

Contract: `docs/openapi/federation.yaml`
