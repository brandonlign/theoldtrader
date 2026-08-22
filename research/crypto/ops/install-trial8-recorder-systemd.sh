#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="theoldtrader-trial8-recorder"
REQUIRED_BRANCH="research/bitnomial-carry-v1"
SERVICE_USER="${1:-$(id -un)}"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "Trial 8 recorder must be installed on a persistent Linux host." >&2
  exit 1
fi

ROOT="$(git rev-parse --show-toplevel)"
CURRENT_BRANCH="$(git -C "$ROOT" branch --show-current)"
NPM_BIN="$(command -v npm || true)"
NODE_BIN="$(command -v node || true)"
SHA256SUM_BIN="$(command -v sha256sum || true)"

[[ -n "$NPM_BIN" && -n "$NODE_BIN" ]] || { echo "node and npm are required" >&2; exit 1; }
[[ -n "$SHA256SUM_BIN" ]] || { echo "sha256sum is required" >&2; exit 1; }
command -v systemctl >/dev/null 2>&1 || { echo "systemd/systemctl is required" >&2; exit 1; }
[[ "$CURRENT_BRANCH" == "$REQUIRED_BRANCH" ]] || { echo "Refusing Trial 8 install from branch '$CURRENT_BRANCH'; required '$REQUIRED_BRANCH'" >&2; exit 1; }
git -C "$ROOT" diff --quiet && git -C "$ROOT" diff --cached --quiet || { echo "Refusing Trial 8 install from a dirty worktree" >&2; exit 1; }
id "$SERVICE_USER" >/dev/null 2>&1 || { echo "Service user '$SERVICE_USER' does not exist" >&2; exit 1; }

cd "$ROOT"
npm test
npm run research:t8:freeze-guard
npm run research:t8:connectivity

DATA_DIR="$ROOT/research/crypto/data-cache"
mkdir -p "$DATA_DIR"
chmod 700 "$DATA_DIR"
if [[ "$(id -u)" -eq 0 ]]; then
  chown "$SERVICE_USER":"$(id -gn "$SERVICE_USER")" "$DATA_DIR"
else
  sudo chown "$SERVICE_USER":"$(id -gn "$SERVICE_USER")" "$DATA_DIR"
fi

RUNTIME_FILES=(
  "package.json"
  "research/crypto/manifests/bitnomial-carry-v1.json"
  "research/crypto/trial8-manifest-guard.mjs"
  "research/crypto/record-bitnomial-carry.mjs"
  "research/crypto/lib/trial8-freeze-identity.js"
)
CHECKSUM_CONTENT="$(for relative in "${RUNTIME_FILES[@]}"; do "$SHA256SUM_BIN" "$ROOT/$relative"; done)"
CHECKSUM_PATH="/etc/${SERVICE_NAME}.sha256"
UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}.service"
NODE_DIR="$(dirname "$NODE_BIN")"
SYSTEM_PATH="${NODE_DIR}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
UNIT_CONTENT="$(cat <<UNIT
[Unit]
Description=TheOldTrader Trial 8 sealed Bitnomial carry recorder
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${ROOT}
Environment=PATH=${SYSTEM_PATH}
ExecStartPre=${SHA256SUM_BIN} -c ${CHECKSUM_PATH}
ExecStart=${NPM_BIN} run research:t8:record
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
  printf '%s\n' "$CHECKSUM_CONTENT" > "$CHECKSUM_PATH"
  chmod 0444 "$CHECKSUM_PATH"
  printf '%s\n' "$UNIT_CONTENT" > "$UNIT_PATH"
  systemctl daemon-reload
  systemctl enable --now "$SERVICE_NAME"
  systemctl --no-pager --full status "$SERVICE_NAME"
else
  printf '%s\n' "$CHECKSUM_CONTENT" | sudo tee "$CHECKSUM_PATH" >/dev/null
  sudo chmod 0444 "$CHECKSUM_PATH"
  printf '%s\n' "$UNIT_CONTENT" | sudo tee "$UNIT_PATH" >/dev/null
  sudo systemctl daemon-reload
  sudo systemctl enable --now "$SERVICE_NAME"
  sudo systemctl --no-pager --full status "$SERVICE_NAME"
fi

cat <<EOF
Trial 8 recorder installed.
Data: ${DATA_DIR}/bitnomial-carry-v1-forward.ndjson
Raw:  ${DATA_DIR}/bitnomial-carry-v1-forward.raw.ndjson.gz
Health: cd ${ROOT} && npm run research:t8:health
Logs: sudo journalctl -u ${SERVICE_NAME} -f
This is public-data collection only. It has no order path and uses no exchange credentials.
EOF
