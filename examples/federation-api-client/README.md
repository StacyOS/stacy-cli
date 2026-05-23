# StacyOS Federation API Client Example

This example proves `docs/openapi/federation.yaml` can drive a real TypeScript
client for the stable federation read API.

## Try It

```bash
cd examples/federation-api-client
pnpm install
STACY_FEDERATION_API_BASE_URL=http://127.0.0.1:3000 pnpm exec tsx example.ts ko_referral_packet
```

For a federated consumer read, pass the consumer install ID:

```bash
pnpm exec tsx example.ts ko_referral_packet http://127.0.0.1:3000 install_consumer
```

The script calls `GET /api/federation/v1/ko/{id}` and prints the parsed JSON
response. It exits non-zero if the server returns an OpenAPI-modeled error.

## Regenerate Types

The generated types are committed so users can run the example immediately. To
refresh them after editing the OpenAPI document:

```bash
pnpm run generate
```
