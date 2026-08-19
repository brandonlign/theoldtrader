#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="theoldtrader-trial7-recorder"
REQUIRED_BRANCH="research/cross-venue-funding-v1-current"
SERVICE_USER="${1:-$(id -un)}"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "Trial 7 recorder must be installed on the persistent Linux host, not this $(uname -s) machine." >&2
  exit 1
fi

ROOT="$(git rev-parse --show-toplevel)"
CURRENT_BRANCH="$(git -C "$ROOT" branch --show-current)"
NPM_BIN="$(command -v npm || true)"
NODE_BIN="$(command -v node || true)"
SHA256SUM_BIN="$(command -v sha256sum || true)"

if [[ -z "$NPM_BIN" || -z "$NODE_BIN" ]]; then
  echo "node and npm are required" >&2
  exit 1
fi
if [[ -z "$SHA256SUM_BIN" ]]; then
  echo "sha256sum is required" >&2
  exit 1
fi
if ! command -v systemctl >/dev/null 2>&1; then
  echo "systemd/systemctl is required for sealed Trial 7 deployment" >&2
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

# Trial 7 acquisition/evaluation uses Node built-ins only. Do not run npm install
# during scientific deployment: this repo intentionally has no package-lock.json,
# and mutating the dependency graph is unnecessary for the sealed collector.
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

# Snapshot the exact acquisition runtime after all preflight checks. The
# root-owned checksum file prevents a later pull/edit from silently changing
# the recorder on a systemd restart. These are the complete files reachable by
# the acquisition command before public HTTP requests are made.
RUNTIME_FILES=(
  "package.json"
  "research/crypto/manifests/cross-venue-funding-v1.json"
  "research/crypto/trial7-manifest-guard.mjs"
  "research/crypto/trial7-recorder-start.mjs"
  "research/crypto/record-cross-venue-funding.mjs"
  "research/crypto/lib/trial7-freeze-identity.js"
  "research/crypto/lib/trial7-collection-schedule.js"
  "research/crypto/lib/cross-venue-record.js"
)
CHECKSUM_CONTENT="$(for relative in "${RUNTIME_FILES[@]}"; do "$SHA256SUM_BIN" "$ROOT/$relative"; done)"
CHECKSUM_PATH="/etc/${SERVICE_NAME}.sha256"
UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}.service"
NODE_DIR="$(dirname "$NODE_BIN")"
SYSTEM_PATH="${NODE_DIR}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

UNIT_CONTENT="$(cat <<UNIT
[Unit]
Description=TheOldTrader Trial 7 sealed cross-venue funding recorder
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${ROOT}
Environment=PATH=${SYSTEM_PATH}
ExecStartPre=${SHA256SUM_BIN} -c ${CHECKSUM_PATH}
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

Trial 7 recorder service installed.

Scientific outputs (gitignored):
  ${DATA_DIR}/cross-venue-funding-v1-forward.ndjson
  ${DATA_DIR}/cross-venue-funding-v1-forward.raw.ndjson.gz

Runtime identity snapshot:
  ${CHECKSUM_PATH}
  Every service start verifies these acquisition files before network access.

Node runtime:
  ${NODE_BIN} ($(${NODE_BIN} --version))

Sealed health check:
  cd ${ROOT} && npm run research:cv:health

Journal:
  sudo journalctl -u ${SERVICE_NAME} -f

This service uses public market-data endpoints only. It has no order path and no exchange credentials.
EOF
