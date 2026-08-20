#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="theoldtrader-e1-recorder"
TRIAL8_SERVICE="theoldtrader-trial8-recorder.service"
REQUIRED_BRANCH="research/execution-e1-ops"
SERVICE_USER="${1:-$(id -un)}"
MIN_FREE_GIB=22

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "E1 scientific recorder must be installed on a persistent Linux host." >&2
  exit 1
fi

ROOT="$(realpath "$(git rev-parse --show-toplevel)")"
CURRENT_BRANCH="$(git -C "$ROOT" branch --show-current)"
NPM_BIN="$(command -v npm || true)"
NODE_BIN="$(command -v node || true)"
SHA256SUM_BIN="$(command -v sha256sum || true)"

[[ -n "$NPM_BIN" && -n "$NODE_BIN" ]] || { echo "node and npm are required" >&2; exit 1; }
[[ -n "$SHA256SUM_BIN" ]] || { echo "sha256sum is required" >&2; exit 1; }
command -v systemctl >/dev/null 2>&1 || { echo "systemd/systemctl is required" >&2; exit 1; }
[[ "$CURRENT_BRANCH" == "$REQUIRED_BRANCH" ]] || { echo "Refusing E1 install from branch '$CURRENT_BRANCH'; required '$REQUIRED_BRANCH'" >&2; exit 1; }
git -C "$ROOT" diff --quiet && git -C "$ROOT" diff --cached --quiet || { echo "Refusing E1 install from a dirty worktree" >&2; exit 1; }
id "$SERVICE_USER" >/dev/null 2>&1 || { echo "Service user '$SERVICE_USER' does not exist" >&2; exit 1; }

# Trial 8 is a sealed live prospective recorder. E1 must never be installed from
# the same checkout because changing that checkout's branch/files could invalidate
# Trial 8's root-owned runtime hashes or break a later restart.
TRIAL8_ROOT="$(systemctl show -p WorkingDirectory --value "$TRIAL8_SERVICE" 2>/dev/null || true)"
if [[ -n "$TRIAL8_ROOT" ]] && [[ "$(realpath -m "$TRIAL8_ROOT")" == "$ROOT" ]]; then
  echo "Refusing E1 install from the Trial 8 working directory '$ROOT'. Use a separate clone/worktree (for example ~/theoldtrader-e1)." >&2
  exit 1
fi

cd "$ROOT"

if find research/crypto/data-cache -maxdepth 1 -type d -name 'coinbase-maker-e1-scientific-*' -print -quit 2>/dev/null | grep -q .; then
  echo "An E1 scientific run directory already exists; refusing to create a second scientific run." >&2
  exit 1
fi

FREE_KIB="$(df -Pk "$ROOT" | awk 'NR==2 {print $4}')"
MIN_FREE_KIB=$((MIN_FREE_GIB * 1024 * 1024))
if (( FREE_KIB < MIN_FREE_KIB )); then
  echo "E1 requires at least ${MIN_FREE_GIB} GiB free disk before start; available KiB=${FREE_KIB}." >&2
  exit 1
fi

npm test
node --check research/crypto/run-coinbase-maker-e1.mjs
node --check research/crypto/record-coinbase-microstructure.mjs
node --check research/crypto/evaluate-coinbase-maker-e1-run.mjs

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
  "research/crypto/manifests/coinbase-maker-execution-v1.json"
  "research/crypto/run-coinbase-maker-e1.mjs"
  "research/crypto/record-coinbase-microstructure.mjs"
  "research/crypto/evaluate-coinbase-maker-e1-run.mjs"
  "research/crypto/e1-recorder-health.mjs"
)
CHECKSUM_CONTENT="$(for relative in "${RUNTIME_FILES[@]}"; do "$SHA256SUM_BIN" "$ROOT/$relative"; done)"
CHECKSUM_PATH="/etc/${SERVICE_NAME}.sha256"
UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}.service"
NODE_DIR="$(dirname "$NODE_BIN")"
SYSTEM_PATH="${NODE_DIR}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
UNIT_CONTENT="$(cat <<UNIT
[Unit]
Description=TheOldTrader E1 sealed Coinbase maker-execution recorder
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${ROOT}
Environment=PATH=${SYSTEM_PATH}
ExecStartPre=${SHA256SUM_BIN} -c ${CHECKSUM_PATH}
ExecStart=${NPM_BIN} run research:e1:scientific
Restart=on-failure
RestartSec=30
TimeoutStopSec=45
KillSignal=SIGTERM
UMask=0077
Nice=10
CPUWeight=20
IOWeight=20
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
E1 scientific recorder installed from isolated checkout: ${ROOT}
Frozen duration: 168 hours across BTC-USD, ETH-USD, SOL-USD.
Observed 5-minute preflight projected roughly 13.4 GB compressed total for seven days; installer requires ${MIN_FREE_GIB} GiB free before start.
Health: cd ${ROOT} && node research/crypto/e1-recorder-health.mjs
Logs: sudo journalctl -u ${SERVICE_NAME} -f
The service is deliberately low-priority (Nice=10, CPUWeight=20, IOWeight=20) and exits after the frozen scientific window.
Public market-data collection only: no API keys, orders, or real-money path.
EOF