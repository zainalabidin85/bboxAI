#!/usr/bin/env bash
# Manual override for remote access on a bboxai-desktop install.
#
# install.sh already sets up bbox-agent and enables remote access
# automatically the first time you register a local account -- you don't
# need this script for a normal fresh install. Use it only to force a
# *different* local account to become the remote-enabled one (bbox-agent
# sticks with whichever account it picked up first).

set -euo pipefail

if [ "$(uname -s)" != "Linux" ]; then
  echo "This script only supports Linux." >&2
  exit 1
fi

API_BASE="http://localhost:8000"
AGENT_ENV_FILE="/etc/bboxai-agent.env"

if [ ! -f "$AGENT_ENV_FILE" ]; then
  echo "bbox-agent isn't installed yet -- run ./bboxai-desktop/install.sh first." >&2
  exit 1
fi

AGENT_CREDENTIALS_FILE="$(grep '^BBOXAI_CREDENTIALS_FILE=' "$AGENT_ENV_FILE" | cut -d= -f2-)"
if [ -z "$AGENT_CREDENTIALS_FILE" ]; then
  echo "BBOXAI_CREDENTIALS_FILE not set in $AGENT_ENV_FILE -- unexpected install state." >&2
  exit 1
fi

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
  echo "Login failed (HTTP $STATUS). Check the username/password and try again." >&2
  exit 1
fi
echo "    login OK"

echo "==> Writing credentials for bbox-agent to pick up"
sudo install -m 600 /dev/null "$AGENT_CREDENTIALS_FILE"
printf '{"username": %s, "password": %s}' \
  "$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$USERNAME")" \
  "$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$PASSWORD")" \
  | sudo tee "$AGENT_CREDENTIALS_FILE" >/dev/null

echo "==> Restarting bboxai-agent.service to pick it up"
sudo systemctl restart bboxai-agent.service

echo "==> Waiting for the agent to connect..."
sleep 4
echo
echo "================================================================"
sudo journalctl -u bboxai-agent -n 20 --no-pager
echo "================================================================"
echo
echo "If it says 'Tunnel connected.', log in at"
echo "  https://bboxai-remote.unitani.com"
echo "with account '$USERNAME' from anywhere."
echo "================================================================"
