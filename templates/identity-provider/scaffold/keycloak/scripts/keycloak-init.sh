#!/usr/bin/env bash
set -euo pipefail

KEYCLOAK_BIN="/opt/keycloak/bin/kc.sh"
KCADM_BIN="/opt/keycloak/bin/kcadm.sh"
IMPORT_DIR="/opt/keycloak/data/import-realms"
BOOTSTRAP_USER="${KC_BOOTSTRAP_ADMIN_USERNAME:-bootstrap-admin}"
BOOTSTRAP_PASSWORD="${KC_BOOTSTRAP_ADMIN_PASSWORD:-bootstrap-admin}"
FINAL_ADMIN_USER="${KC_ADMIN_USER:-admin}"
FINAL_ADMIN_PASSWORD="${KC_ADMIN_PASSWORD:-admin}"

log() {
  printf '[keycloak-init] %s\n' "$*"
}

cleanup() {
  if [[ -n "${KC_PID:-}" ]] && kill -0 "$KC_PID" >/dev/null 2>&1; then
    log "Stopping Keycloak process..."
    kill "$KC_PID"
    wait "$KC_PID" || true
  fi
}

wait_for_keycloak() {
  local retries=120

  for ((i=1; i<=retries; i++)); do
    if bash -c 'exec 3<>/dev/tcp/127.0.0.1/9000; printf "GET /health/ready HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n" >&3; grep -q "\"status\": \"UP\"" <&3' 2>/dev/null; then
      return 0
    fi
    sleep 2
  done

  return 1
}

extract_realm_name() {
  local realm_file="$1"
  sed -n 's/^[[:space:]]*"realm"[[:space:]]*:[[:space:]]*"\([^"]\+\)".*/\1/p' "$realm_file" | head -n 1
}

setup_admin_user() {
  log "Authenticating with bootstrap user..."

  # On first start the bootstrap user exists; on later restarts
  # Keycloak does not recreate it (the master realm already has an admin),
  # so we try authenticating with the final user as a fallback.
  if ! "$KCADM_BIN" config credentials \
    --server http://127.0.0.1:8080 \
    --realm master \
    --user "$BOOTSTRAP_USER" \
    --password "$BOOTSTRAP_PASSWORD" 2>/dev/null; then

    log "Bootstrap user not available. Trying final user '$FINAL_ADMIN_USER'..."
    if ! "$KCADM_BIN" config credentials \
      --server http://127.0.0.1:8080 \
      --realm master \
      --user "$FINAL_ADMIN_USER" \
      --password "$FINAL_ADMIN_PASSWORD" 2>/dev/null; then
      log "ERROR: Could not authenticate with any admin user."
      return 1
    fi
    log "Authenticated as '$FINAL_ADMIN_USER'. Admin setup was already done on a previous startup."
    return 0
  fi

  # Check whether the final admin user already exists
  if "$KCADM_BIN" get users -r master -q "username=$FINAL_ADMIN_USER" 2>/dev/null | grep -q "\"username\" : \"$FINAL_ADMIN_USER\""; then
    log "Final admin user '$FINAL_ADMIN_USER' already exists."
  else
    log "Creating final admin user '$FINAL_ADMIN_USER'..."
    "$KCADM_BIN" create users -r master \
      -s username="$FINAL_ADMIN_USER" \
      -s enabled=true >/dev/null
    
    log "Setting password for '$FINAL_ADMIN_USER'..."
    "$KCADM_BIN" set-password -r master \
      --username "$FINAL_ADMIN_USER" \
      --new-password "$FINAL_ADMIN_PASSWORD" >/dev/null
    
    log "Assigning admin role to '$FINAL_ADMIN_USER'..."
    "$KCADM_BIN" add-roles -r master \
      --uusername "$FINAL_ADMIN_USER" \
      --rolename admin >/dev/null
    
    log "Final admin user '$FINAL_ADMIN_USER' created successfully."
  fi

  # Re-authenticate with the final user before removing the bootstrap user,
  # so the active session does not get invalidated when the bootstrap user is deleted.
  log "Re-authenticating with final admin user '$FINAL_ADMIN_USER'..."
  "$KCADM_BIN" config credentials \
    --server http://127.0.0.1:8080 \
    --realm master \
    --user "$FINAL_ADMIN_USER" \
    --password "$FINAL_ADMIN_PASSWORD" >/dev/null

  # Remove bootstrap user if it exists and is different from final user
  if [[ "$BOOTSTRAP_USER" != "$FINAL_ADMIN_USER" ]]; then
    if "$KCADM_BIN" get users -r master -q "username=$BOOTSTRAP_USER" 2>/dev/null | grep -q "\"username\" : \"$BOOTSTRAP_USER\""; then
      log "Deleting bootstrap user '$BOOTSTRAP_USER'..."
      local bootstrap_id
      bootstrap_id=$("$KCADM_BIN" get users -r master -q "username=$BOOTSTRAP_USER" --fields id --format csv --noquotes 2>/dev/null | tail -n 1)
      "$KCADM_BIN" delete "users/$bootstrap_id" -r master >/dev/null
      log "Bootstrap user '$BOOTSTRAP_USER' removed."
    fi
  fi
}

import_missing_realms() {
  shopt -s nullglob
  local realm_files=("$IMPORT_DIR"/*.json)
  local failed_imports=0

  if (( ${#realm_files[@]} == 0 )); then
    log "No JSON files found in $IMPORT_DIR."
    return 0
  fi

  for realm_file in "${realm_files[@]}"; do
    local realm_name
    realm_name="$(extract_realm_name "$realm_file")"

    if [[ -z "$realm_name" ]]; then
      log "Skipping $realm_file: missing top-level \"realm\" attribute."
      continue
    fi

    if "$KCADM_BIN" get "realms/$realm_name" >/dev/null 2>&1; then
      log "Realm '$realm_name' already exists; skipping import."
      continue
    fi

    log "Importing realm '$realm_name' from $(basename "$realm_file")..."
    local import_err_file
    import_err_file="$(mktemp)"
    if ! "$KCADM_BIN" create realms -f "$realm_file" >/dev/null 2>"$import_err_file"; then
      log "ERROR: Import failed for realm '$realm_name'."
      if [[ -s "$import_err_file" ]]; then
        log "kcadm error: $(tr '\n' ' ' < "$import_err_file")"
      fi
      rm -f "$import_err_file"
      failed_imports=$((failed_imports + 1))
      continue
    fi
    rm -f "$import_err_file"
    log "Realm '$realm_name' imported."
  done

  if (( failed_imports > 0 )); then
    log "Realm import process completed with $failed_imports error(s). Keycloak will remain running."
  else
    log "Realm import process completed."
  fi
}

trap cleanup SIGINT SIGTERM

log "Starting Keycloak..."
"$KEYCLOAK_BIN" start --http-enabled=true --hostname-strict=false --cache=local &
KC_PID=$!

if ! wait_for_keycloak; then
  log "Keycloak did not report READY status in time."
  cleanup
  exit 1
fi

log "Configuring final admin user..."
setup_admin_user

log "Importing realms..."
import_missing_realms

wait "$KC_PID"
