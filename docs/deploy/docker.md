---
title: Docker
summary: Docker Compose quickstart
---

Run Stacy in Docker without installing Node or pnpm locally.

## Compose Quickstart (Recommended)

```sh
docker compose -f docker/docker-compose.quickstart.yml up --build
```

Open [http://localhost:3100](http://localhost:3100).

Defaults:

- Host port: `3100`
- Data directory: `./data/docker-stacy`
- Auth secret: local-only default from the quickstart compose file

Override with environment variables:

```sh
STACY_PORT=3200 STACY_DATA_DIR=../data/stacy BETTER_AUTH_SECRET=change-me \
  docker compose -f docker/docker-compose.quickstart.yml up --build
```

**Note:** `STACY_DATA_DIR` is resolved relative to the compose file (`docker/`), so `../data/stacy` maps to `data/stacy` in the project root.

Validate the quickstart from a checkout with:

```sh
pnpm smoke:docker-quickstart
```

The smoke starts Stacy on `http://localhost:3132`, checks `/api/health`,
verifies embedded Postgres data and server logs persist in the mounted data
dir, restarts the service, and checks health again. It skips cleanly when
Docker is not installed or not running.

## Manual Docker Build

```sh
docker build -t stacy-local .
docker run --name stacy \
  -p 3100:3100 \
  -e HOST=0.0.0.0 \
  -e STACY_HOME=/stacy \
  -v "$(pwd)/data/docker-stacy:/stacy" \
  stacy-local
```

## Data Persistence

All data is persisted under the bind mount (`./data/docker-stacy`):

- Embedded PostgreSQL data
- Uploaded assets
- Local secrets key
- Agent workspace data

## Backups And Restore

Create a manual backup from a running local checkout:

```sh
pnpm stacy db:backup
```

Before upgrading, run the read-only preflight:

```sh
pnpm stacy upgrade:check
```

Before applying a restore, stop the app, inspect the target, then run restore
from the checkout or from an operator shell that has the same config mounted:

```sh
docker compose -f docker/docker-compose.quickstart.yml down
pnpm stacy db:restore ./data/docker-stacy/instances/default/data/backups/stacy-20260430-010000.sql.gz --dry-run
pnpm stacy db:restore ./data/docker-stacy/instances/default/data/backups/stacy-20260430-010000.sql.gz --yes
docker compose -f docker/docker-compose.quickstart.yml up -d
```

## Claude and Codex Adapters in Docker

The Docker image pre-installs:

- `claude` (Anthropic Claude Code CLI)
- `codex` (OpenAI Codex CLI)

Pass API keys to enable local adapter runs inside the container:

```sh
docker run --name stacy \
  -p 3100:3100 \
  -e HOST=0.0.0.0 \
  -e STACY_HOME=/stacy \
  -e OPENAI_API_KEY=sk-... \
  -e ANTHROPIC_API_KEY=sk-... \
  -v "$(pwd)/data/docker-stacy:/stacy" \
  stacy-local
```

Without API keys, the app runs normally — adapter environment checks will surface missing prerequisites.
