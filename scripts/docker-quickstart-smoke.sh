#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$REPO_ROOT/docker/docker-compose.quickstart.yml}"
PROJECT_NAME="${PROJECT_NAME:-stacy-quickstart-smoke-$$}"
HOST_PORT="${HOST_PORT:-3132}"
STACY_PUBLIC_URL="${STACY_PUBLIC_URL:-http://localhost:${HOST_PORT}}"
BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-N0llpQBJ4f4T1zWmWRH1gHiZPzIwKQYKpCQkWuWoLFU=}"
DATA_DIR="${DATA_DIR:-}"
PRESERVE_DATA="${PRESERVE_DATA:-false}"
PRESERVE_CONTAINER="${PRESERVE_CONTAINER:-false}"
WAIT_ATTEMPTS="${WAIT_ATTEMPTS:-90}"
WAIT_SLEEP_SECONDS="${WAIT_SLEEP_SECONDS:-1}"
CREATED_DATA_DIR="false"

if ! command -v docker >/dev/null 2>&1; then
  echo "SKIP: docker not found — skipping quickstart smoke"
  exit 0
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "SKIP: docker compose is not available — skipping quickstart smoke"
  exit 0
fi

if ! docker info >/dev/null 2>&1; then
  echo "SKIP: docker is installed but not running — skipping quickstart smoke"
  exit 0
fi

if [[ -z "$DATA_DIR" ]]; then
  DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/stacy-docker-quickstart.XXXXXX")"
  CREATED_DATA_DIR="true"
fi

mkdir -p "$DATA_DIR"

compose() {
  STACY_PORT="$HOST_PORT" \
    STACY_PUBLIC_URL="$STACY_PUBLIC_URL" \
    STACY_DATA_DIR="$DATA_DIR" \
    BETTER_AUTH_SECRET="$BETTER_AUTH_SECRET" \
    docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" "$@"
}

cleanup() {
  if [[ "$PRESERVE_CONTAINER" != "true" ]]; then
    compose down --remove-orphans >/dev/null 2>&1 || true
  fi
  if [[ "$PRESERVE_DATA" != "true" && "$CREATED_DATA_DIR" == "true" ]]; then
    rm -rf "$DATA_DIR"
  fi
}

trap cleanup EXIT INT TERM

wait_for_health() {
  local health_url="$STACY_PUBLIC_URL/api/health"
  local i
  for ((i = 1; i <= WAIT_ATTEMPTS; i += 1)); do
    if curl -fsS "$health_url" >/dev/null 2>&1; then
      return 0
    fi
    if ! compose ps --status running --services | grep -q .; then
      echo "Quickstart smoke failed: compose project is not running" >&2
      compose logs >&2 || true
      return 1
    fi
    sleep "$WAIT_SLEEP_SECONDS"
  done

  echo "Quickstart smoke failed: server did not become ready at $health_url" >&2
  compose logs >&2 || true
  return 1
}

assert_persisted_instance() {
  local phase="$1"
  local instance_dir="$DATA_DIR/instances/default"
  local db_version_path="$instance_dir/db/PG_VERSION"
  local log_path="$instance_dir/logs/server.log"

  if [[ ! -d "$instance_dir" ]]; then
    echo "Quickstart smoke failed after $phase: expected persisted instance dir at $instance_dir" >&2
    compose logs >&2 || true
    exit 1
  fi

  if [[ ! -f "$db_version_path" ]]; then
    echo "Quickstart smoke failed after $phase: expected embedded Postgres data at $db_version_path" >&2
    compose logs >&2 || true
    exit 1
  fi

  if [[ ! -s "$log_path" ]]; then
    echo "Quickstart smoke failed after $phase: expected server log at $log_path" >&2
    compose logs >&2 || true
    exit 1
  fi
}

echo "==> Validating Docker quickstart compose config"
compose config >/dev/null

echo "==> Starting Stacy Docker quickstart"
echo "    URL: $STACY_PUBLIC_URL"
echo "    Data dir: $DATA_DIR"
compose up -d --build
wait_for_health

assert_persisted_instance "startup"

echo "==> Restarting to verify persisted state"
compose restart
wait_for_health

assert_persisted_instance "restart"

echo "PASS: Docker quickstart smoke succeeded"
echo "      URL: $STACY_PUBLIC_URL"
echo "      Data dir: $DATA_DIR"
