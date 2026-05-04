#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/compose.yml"
ENGINE="${1:-podman}"

info() { printf 'ℹ️  %s\n' "$*"; }
success() { printf '✅ %s\n' "$*"; }
error() { printf '❌ %s\n' "$*"; }

usage() {
  cat <<USAGE
Usage: ./start.sh [podman|docker]

Arguments:
  podman  Use Podman as the container engine (default)
  docker  Use Docker as the container engine
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

  # determine which services are defined so we can wait for all of them
  local services
  services="$("${COMPOSE_CMD[@]}" -f "$COMPOSE_FILE" config --services 2>/dev/null || true)"
  local svc_count
  svc_count=$(echo "$services" | wc -w | tr -d ' ')

  printf '⏳ Waiting for service health checks: %s' "$services"
  while (( elapsed < timeout_seconds )); do
    local status_output
    status_output="$("${COMPOSE_CMD[@]}" -f "$COMPOSE_FILE" ps 2>/dev/null || true)"

    if [[ -n "$svc_count" ]]; then
      local healthy_count
      healthy_count="$(printf '%s' "$status_output" | grep -oi 'healthy' | wc -l | tr -d ' ')"
      if [[ "$healthy_count" -ge $svc_count ]]; then
        printf '\r✅ Health checks completed                                  \n'
        return 0
      fi
    fi

    printf '.'
    sleep 3
    elapsed=$((elapsed + 3))
  done

  printf '\n'
  error "Timed out waiting for health checks."
  info "Check logs with: ${COMPOSE_CMD[*]} -f $COMPOSE_FILE logs -f"
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
    error "docker was not found on this system."
    exit 1
  fi
  if ! docker compose version >/dev/null 2>&1; then
    error "docker is installed, but 'docker compose' is not available."
    exit 1
  fi
  COMPOSE_CMD=(docker compose)
else
  if ! command -v podman >/dev/null 2>&1; then
    error "podman was not found on this system."
    exit 1
  fi

  if podman compose version >/dev/null 2>&1; then
    COMPOSE_CMD=(podman compose)
  elif command -v podman-compose >/dev/null 2>&1; then
    COMPOSE_CMD=(podman-compose)
  else
    error "'podman compose' and 'podman-compose' were not found."
    exit 1
  fi
fi

info "Selected engine: $ENGINE"
run_with_spinner "Starting infrastructure services" "${COMPOSE_CMD[@]}" -f "$COMPOSE_FILE" up -d
wait_for_healthchecks

success "Services ready 🚀"

# list exposed ports by parsing compose.yml
info "Exposed ports by service:"
current_svc=""
in_services=false
in_ports=false
while IFS= read -r line; do
  if [[ "$line" == "services:" ]]; then
    in_services=true; continue
  fi
  $in_services || continue
  if [[ "$line" =~ ^[[:space:]]{2}([a-zA-Z][^:[:space:]]+): ]]; then
    current_svc="${BASH_REMATCH[1]}"; in_ports=false
  elif [[ "$line" =~ ^[[:space:]]{4}ports:[[:space:]]*$ ]]; then
    in_ports=true
  elif $in_ports && [[ "$line" =~ ^[[:space:]]{6}-[[:space:]] ]]; then
    port="${line#*- }"; port="${port//\"/}"
    printf 'ℹ️    %-25s %s\n' "${current_svc}:" "$port"
  elif $in_ports && [[ "$line" =~ ^[[:space:]]{4}[^[:space:]] ]]; then
    in_ports=false
  fi
done < "$COMPOSE_FILE"

info "To stop: ./stop.sh $ENGINE"
