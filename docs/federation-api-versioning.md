# StacyOS Federation API Versioning

The stable federation read API is versioned under `/api/federation/v1`.

## Stable Endpoint

```text
GET /api/federation/v1/ko/:id
```

This endpoint returns the same enforcement payload used by the federation Brain
UI. It is the recommended integration point for downstream systems.

## Deprecated Alias

```text
GET /api/federation/ko/:id
```

The unversioned endpoint remains available as a compatibility alias, but it is
deprecated. Responses include:

```text
Deprecation: true
Sunset: Fri, 21 Aug 2026 00:00:00 GMT
Link: </api/federation/v1/ko/{id}>; rel="successor-version"
```

The sunset window is 90 days from the public-readiness cutoff date. Clients
should migrate to `/api/federation/v1/ko/:id` before the sunset date.

## Migration

Replace:

```text
/api/federation/ko/ko_referral_packet
```

with:

```text
/api/federation/v1/ko/ko_referral_packet
```

Query parameters, including `asConsumer`, are unchanged.

## Policy

- New public federation endpoints must be versioned.
- Existing versioned endpoint behavior should remain backward compatible within
  a major version.
- Deprecated aliases must advertise `Deprecation` and `Sunset` headers.
- The OpenAPI file marks deprecated paths with `deprecated: true`.
