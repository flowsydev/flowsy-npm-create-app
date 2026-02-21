#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/compose.yml"
ENGINE="${1:-docker}"

info() { printf 'ℹ️  %s\n' "$*"; }
success() { printf '✅ %s\n' "$*"; }
error() { printf '❌ %s\n' "$*"; }

usage() {
  cat <<USAGE
Usage: ./start.sh [docker|podman]

Arguments:
  docker  Use Docker as the container engine (default)
  podman  Use Podman as the container engine
USAGE
}

run_with_spinner() {
  local message="$1"
  shift

  local log_file
  log_file="$(mktemp)"

  "$@" >"$log_file" 2>&1 &
  local pid=$!
  local spin='|/-\\'
  local i=0

  while kill -0 "$pid" >/dev/null 2>&1; do
    i=$(( (i + 1) % 4 ))
    printf '\r⏳ %s %s' "$message" "${spin:$i:1}"
    sleep 0.15
  done

  if wait "$pid"; then
    printf '\r✅ %s\n' "$message"
    rm -f "$log_file"
  else
    printf '\r❌ %s\n' "$message"
    cat "$log_file"
    rm -f "$log_file"
    exit 1
  fi
}

wait_for_healthchecks() {
  local timeout_seconds=300
  local elapsed=0

  printf '⏳ Waiting for postgres and keycloak health checks'
  while (( elapsed < timeout_seconds )); do
    local status_output
    status_output="$("${COMPOSE_CMD[@]}" -f "$COMPOSE_FILE" ps 2>/dev/null || true)"

    if [[ "$status_output" == *"postgres"* ]] && [[ "$status_output" == *"keycloak"* ]]; then
      local healthy_count
      healthy_count="$(printf '%s' "$status_output" | grep -oi 'healthy' | wc -l | tr -d ' ')"
      if [[ "$healthy_count" -ge 2 ]]; then
        printf '\r✅ Health checks complete                                  \n'
        return 0
      fi
    fi

    printf '.'
    sleep 3
    elapsed=$((elapsed + 3))
  done

  printf '\n'
  error "Maximum wait time for health checks reached."
  info "Check the logs with: ${COMPOSE_CMD[*]} -f $COMPOSE_FILE logs -f"
  return 1
}

if [[ "$ENGINE" != "podman" && "$ENGINE" != "docker" ]]; then
  error "Invalid engine: '$ENGINE'. Only 'podman' or 'docker' are allowed."
  usage
  exit 1
fi

declare -a COMPOSE_CMD

if [[ "$ENGINE" == "docker" ]]; then
  if ! command -v docker >/dev/null 2>&1; then
    error "docker not found on system."
    exit 1
  fi
  if ! docker compose version >/dev/null 2>&1; then
    error "docker is installed but 'docker compose' is not available."
    exit 1
  fi
  COMPOSE_CMD=(docker compose)
else
  if ! command -v podman >/dev/null 2>&1; then
    error "podman not found on system."
    exit 1
  fi

  if podman compose version >/dev/null 2>&1; then
    COMPOSE_CMD=(podman compose)
  elif command -v podman-compose >/dev/null 2>&1; then
    COMPOSE_CMD=(podman-compose)
  else
    error "neither 'podman compose' nor 'podman-compose' found."
    exit 1
  fi
fi

info "Selected engine: $ENGINE"
run_with_spinner "Bringing up identity provider services" "${COMPOSE_CMD[@]}" -f "$COMPOSE_FILE" up -d
wait_for_healthchecks

# make sure placeholders have been replaced before we try to parse the file
if grep -q '__KEYCLOAK_PORT__' "$COMPOSE_FILE"; then
  error "compose.yml still contains placeholder values. Please run the project generator/configure step or edit the file to set a real port."
  exit 1
fi

KC_PORT=$(grep -E "^\s*-\s*['\"]?[0-9]+:8080['\"]?" "$COMPOSE_FILE" 2>/dev/null | head -1 | sed -E 's/[^0-9]*([0-9]+):8080.*/\1/' || true)
KC_ADMIN_USER=$(grep 'KC_ADMIN_USERNAME:' "$COMPOSE_FILE" 2>/dev/null | head -1 | sed -E 's/.*KC_ADMIN_USERNAME:[[:space:]]*//' | tr -d '"' | xargs || true)
KC_ADMIN_PASSWORD=$(grep 'KC_ADMIN_PASSWORD:' "$COMPOSE_FILE" 2>/dev/null | head -1 | sed -E 's/.*KC_ADMIN_PASSWORD:[[:space:]]*//' | tr -d '"' | xargs || true)

success "Services ready 🚀"
info "Keycloak: http://localhost:${KC_PORT:-8080}"
# note: the default of 8080 is only used if grep failed; the check above should
# have prevented an unconfigured compose.yml from reaching this point.
info "Admin user: ${KC_ADMIN_USER:-admin}"
info "Admin password: ${KC_ADMIN_PASSWORD:-admin}"
info "To stop: ./stop.sh $ENGINE"
