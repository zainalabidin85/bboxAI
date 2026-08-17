#!/usr/bin/env bash
# Enables away-from-home access for a bboxai-desktop install by setting up
# bbox-agent as a systemd service, tunneling to the shared bbox-relay so
# https://bboxai-remote.unitani.com can reach this machine.
#
# Run this AFTER ./install.sh and AFTER registering a bboxAI account through
# the local web UI (http://localhost:8080).

set -euo pipefail

if [ "$(uname -s)" != "Linux" ]; then
  echo "This script only supports Linux." >&2
  exit 1
fi

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_DIR="$HOME/bboxai-desktop"
API_BASE="http://localhost:8000"
RELAY_URL="https://bboxai-relay.unitani.com"
ENV_FILE="/etc/bboxai-agent.env"

USERNAME="${BBOXAI_USERNAME:-}"
PASSWORD="${BBOXAI_PASSWORD:-}"
if [ -z "$USERNAME" ]; then
  read -rp "bboxAI username: " USERNAME
fi
if [ -z "$PASSWORD" ]; then
  read -rsp "bboxAI password: " PASSWORD
  echo
fi

echo "==> Validating login against $API_BASE"
LOGIN_TMP="$(mktemp)"
trap 'rm -f "$LOGIN_TMP"' EXIT
STATUS=$(curl -s -o "$LOGIN_TMP" -w '%{http_code}' -X POST "$API_BASE/auth/login" \
  --data-urlencode "username=$USERNAME" \
  --data-urlencode "password=$PASSWORD")
if [ "$STATUS" != "200" ]; then
  echo "Login failed (HTTP $STATUS). Register an account at http://localhost:8080 first, or check your bbox-api install." >&2
  exit 1
fi
echo "    login OK"

echo "==> Copying bbox-agent into $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
rsync -a --exclude venv --exclude __pycache__ \
  "$SOURCE_DIR/bbox-agent/" "$INSTALL_DIR/bbox-agent/"

echo "==> Setting up bbox-agent venv"
cd "$INSTALL_DIR/bbox-agent"
if [ ! -d venv ]; then
  python3 -m venv venv
fi
# shellcheck disable=SC1091
source venv/bin/activate
pip install --upgrade pip -q
pip install -q -r requirements.txt
deactivate

echo "==> Writing $ENV_FILE (root-only)"
sudo tee "$ENV_FILE" >/dev/null <<EOF
BBOXAI_API_BASE=$API_BASE
BBOXAI_RELAY_URL=$RELAY_URL
BBOXAI_USERNAME=$USERNAME
BBOXAI_PASSWORD=$PASSWORD
EOF
sudo chmod 600 "$ENV_FILE"

echo "==> Installing bboxai-agent.service"
sudo tee /etc/systemd/system/bboxai-agent.service >/dev/null <<EOF
[Unit]
Description=bboxAI desktop agent (relay tunnel for remote access)
After=network.target bboxai-api.service
Wants=bboxai-api.service

[Service]
Type=simple
User=$USER
EnvironmentFile=$ENV_FILE
WorkingDirectory=$INSTALL_DIR/bbox-agent
ExecStart=$INSTALL_DIR/bbox-agent/venv/bin/python -u agent.py
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now bboxai-agent.service

echo "==> Waiting for the agent to register/connect..."
sleep 4

echo
echo "================================================================"
sudo journalctl -u bboxai-agent -n 20 --no-pager
echo "================================================================"
echo
echo "If a 'Pairing code' appeared above, enter it at"
echo "  https://bboxai-remote.unitani.com"
echo "within 10 minutes to pair this device."
echo
echo "If it instead says 'Tunnel connected.', this device is already"
echo "paired and remote access is live."
echo "================================================================"
