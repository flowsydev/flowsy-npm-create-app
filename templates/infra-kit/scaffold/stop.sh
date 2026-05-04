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
Usage: ./stop.sh [podman|docker]

Arguments:
  podman  Use Podman as the container engine (default)
  docker  Use Docker as the container engine
USAGE
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
info "Stopping infrastructure services..."
"${COMPOSE_CMD[@]}" -f "$COMPOSE_FILE" down
success "Services stopped."
