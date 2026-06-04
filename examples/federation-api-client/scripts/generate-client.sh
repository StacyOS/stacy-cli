#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."
pnpm exec openapi-typescript ../../docs/openapi/federation.yaml -o src/generated/federation.ts
