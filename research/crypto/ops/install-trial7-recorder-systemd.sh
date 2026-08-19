#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="theoldtrader-trial7-recorder"
REQUIRED_BRANCH="research/cross-venue-funding-v1-current"
SERVICE_USER="${1:-$(id -un)}"
ROOT="$(git rev-parse --show-toplevel)"
CURRENT_BRANCH="$(git -C "$ROOT" branch --show-current)"
NPM_BIN="$(command -v npm || true)"

if [[ -z "$NPM_BIN" ]]; then
  echo "npm is required" >&2
  exit 1
fi
if [[ "$CURRENT_BRANCH" != "$REQUIRED_BRANCH" ]]; then
  echo "Refusing Trial 7 install from branch '$CURRENT_BRANCH'; required '$REQUIRED_BRANCH'" >&2
  exit 1
fi
if ! git -C "$ROOT" diff --quiet || ! git -C "$ROOT" diff --cached --quiet; then
  echo "Refusing Trial 7 install from a dirty worktree" >&2
  exit 1
fi
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  echo "Service user '$SERVICE_USER' does not exist" >&2
  exit 1
fi

cd "$ROOT"

# Do not mutate the dependency graph during scientific deployment.
if [[ -f package-lock.json ]]; then
  npm ci
else
  echo "package-lock.json is required for sealed Trial 7 deployment" >&2
  exit 1
fi

npm test
npm run research:cv:prestart
npm run research:cv:connectivity

DATA_DIR="$ROOT/research/crypto/data-cache"
mkdir -p "$DATA_DIR"
chmod 700 "$DATA_DIR"
if [[ "$(id -u)" -eq 0 ]]; then
  chown "$SERVICE_USER":"$(id -gn "$SERVICE_USER")" "$DATA_DIR"
else
  sudo chown "$SERVICE_USER":"$(id -gn "$SERVICE_USER")" "$DATA_DIR"
fi

UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}.service"
UNIT_CONTENT="$(cat <<UNIT
[Unit]
Description=TheOldTrader Trial 7 sealed cross-venue funding recorder
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${ROOT}
ExecStart=${NPM_BIN} run research:cv:record
Restart=on-failure
RestartSec=30
TimeoutStopSec=30
KillSignal=SIGTERM
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=full
ProtectHome=read-only
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
ReadWritePaths=${DATA_DIR}
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT
)"

if [[ "$(id -u)" -eq 0 ]]; then
  printf '%s\n' "$UNIT_CONTENT" > "$UNIT_PATH"
  systemctl daemon-reload
  systemctl enable --now "$SERVICE_NAME"
  systemctl --no-pager --full status "$SERVICE_NAME"
else
  printf '%s\n' "$UNIT_CONTENT" | sudo tee "$UNIT_PATH" >/dev/null
  sudo systemctl daemon-reload
  sudo systemctl enable --now "$SERVICE_NAME"
  sudo systemctl --no-pager --full status "$SERVICE_NAME"
fi

cat <<EOF

Trial 7 recorder service installed.

Scientific outputs (gitignored):
  ${DATA_DIR}/cross-venue-funding-v1-forward.ndjson
  ${DATA_DIR}/cross-venue-funding-v1-forward.raw.ndjson.gz

Sealed health check:
  cd ${ROOT} && npm run research:cv:health

Journal:
  sudo journalctl -u ${SERVICE_NAME} -f

This service uses public market-data endpoints only. It has no order path and no exchange credentials.
EOF
