#!/usr/bin/env bash
# bboxai-desktop installer (Linux only).
#
# Sets up bbox-api + a local bbox-web build behind nginx on this machine.
# Run from a checkout of the bboxAI repo: ./bboxai-desktop/install.sh
#
# After this finishes, run ./bboxai-desktop/enable-remote.sh (once you've
# registered an account through the web UI) to enable away-from-home access
# via the shared bbox-relay / bboxai-remote.unitani.com.

set -euo pipefail

if [ "$(uname -s)" != "Linux" ]; then
  echo "This installer only supports Linux." >&2
  exit 1
fi

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_DIR="$HOME/bboxai-desktop"
WEB_PORT=8321
API_PORT=8000
DB_NAME=bboxai
DB_USER=bboxai
DB_PASS_FILE="$INSTALL_DIR/.db_password"

echo "==> Installing bboxai-desktop into $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"

echo "==> Checking base packages (sudo required)"
sudo -v
sudo apt-get update -qq
sudo apt-get install -y -qq python3 python3-venv python3-pip curl rsync openssl >/dev/null

NODE_MAJOR=$(command -v node >/dev/null 2>&1 && node -e 'console.log(process.versions.node.split(".")[0])' || echo 0)
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "==> Installing Node.js 20.x (distro nodejs is missing or too old: $(node --version 2>/dev/null || echo none))"
  # the distro's nodejs/npm/libnode-dev conflict with NodeSource's package on file paths
  sudo apt-get remove -y -qq --purge nodejs npm libnode-dev libnode72 >/dev/null 2>&1 || true
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - >/dev/null
  sudo apt-get install -y -qq nodejs >/dev/null
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "==> Installing PostgreSQL"
  sudo apt-get install -y -qq postgresql >/dev/null
  sudo systemctl enable --now postgresql
fi

if ! command -v nginx >/dev/null 2>&1; then
  echo "==> Installing nginx"
  sudo apt-get install -y -qq nginx >/dev/null
fi

if ! grep -qE '(^|[[:space:]])bboxai([[:space:]]|$)' /etc/hosts; then
  echo "==> Adding 'bboxai' hostname to /etc/hosts (resolves to this machine)"
  echo "127.0.0.1 bboxai" | sudo tee -a /etc/hosts >/dev/null
fi

echo "==> Provisioning Postgres role/db"
# run from /tmp -- sudo -u postgres can't chdir into a private $HOME subdirectory
cd /tmp
ROLE_EXISTS=$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'")
if [ "$ROLE_EXISTS" = "1" ] && [ -f "$DB_PASS_FILE" ]; then
  DB_PASS="$(cat "$DB_PASS_FILE")"
  echo "    role '$DB_USER' already exists, reusing saved password"
else
  DB_PASS="$(openssl rand -hex 16)"
  if [ "$ROLE_EXISTS" = "1" ]; then
    sudo -u postgres psql -c "ALTER ROLE $DB_USER WITH PASSWORD '$DB_PASS';" >/dev/null
  else
    sudo -u postgres psql -c "CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASS';" >/dev/null
  fi
  echo "$DB_PASS" > "$DB_PASS_FILE"
  chmod 600 "$DB_PASS_FILE"
fi
DB_EXISTS=$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'")
if [ "$DB_EXISTS" != "1" ]; then
  sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"
fi
cd "$INSTALL_DIR"

echo "==> Copying source into $INSTALL_DIR"
rsync -a --exclude venv --exclude __pycache__ --exclude '.env' \
  "$SOURCE_DIR/bbox-api/" "$INSTALL_DIR/bbox-api/"
rsync -a --exclude node_modules --exclude dist --exclude '.env.production' \
  "$SOURCE_DIR/bbox-web/" "$INSTALL_DIR/bbox-web/"

echo "==> Setting up bbox-api venv"
cd "$INSTALL_DIR/bbox-api"
if [ ! -d venv ]; then
  python3 -m venv venv
fi
# shellcheck disable=SC1091
source venv/bin/activate
pip install --upgrade pip -q
if command -v nvidia-smi >/dev/null 2>&1 && [ "$(uname -m)" = "x86_64" ]; then
  echo "    NVIDIA GPU detected (x86_64) -- pinning CUDA 12.4 torch build"
  pip install -q torch==2.6.0 --index-url https://download.pytorch.org/whl/cu124
  printf 'torch==2.6.0+cu124\n' > constraints.txt
  pip install -q -r requirements.txt -c constraints.txt
else
  echo "    No NVIDIA GPU detected (or non-x86_64 arch) -- installing default (CPU) torch"
  echo "    Note: GPUs needing vendor-specific wheels (e.g. Jetson/Tegra) are not auto-handled here."
  pip install -q -r requirements.txt
fi
deactivate

if [ ! -f .env ]; then
  echo "==> Writing bbox-api/.env"
  cat > .env <<EOF
STORAGE_PATH=./storage
WEIGHTS_PATH=./weights
DATABASE_URL=postgresql://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME
SECRET_KEY=$(openssl rand -hex 32)
ACCESS_TOKEN_EXPIRE_MINUTES=10080
CORS_ORIGINS=http://localhost:$WEB_PORT,http://bboxai:$WEB_PORT
EOF
else
  echo "==> bbox-api/.env already exists, leaving it as-is"
fi

echo "==> Fetching default base model weight"
mkdir -p weights
if [ ! -f weights/yolo11n.pt ]; then
  curl -sL -o weights/yolo11n.pt \
    https://github.com/ultralytics/assets/releases/download/v8.3.0/yolo11n.pt
  if ! file weights/yolo11n.pt | grep -q data; then
    echo "ERROR: yolo11n.pt download failed (unexpected file type)" >&2
    cat weights/yolo11n.pt >&2
    rm -f weights/yolo11n.pt
    exit 1
  fi
fi

echo "==> Installing bboxai-api.service"
sudo tee /etc/systemd/system/bboxai-api.service >/dev/null <<EOF
[Unit]
Description=bboxAI desktop API
After=network.target postgresql.service

[Service]
Type=simple
User=$USER
WorkingDirectory=$INSTALL_DIR/bbox-api
ExecStart=$INSTALL_DIR/bbox-api/venv/bin/uvicorn main:app --host 127.0.0.1 --port $API_PORT
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now bboxai-api.service

echo "==> Building bbox-web (local build, talks to http://localhost:$API_PORT)"
cd "$INSTALL_DIR/bbox-web"
cat > .env.production <<EOF
VITE_API_BASE_URL=http://localhost:$API_PORT
VITE_REMOTE=false
VITE_APP_TITLE=bboxAI-Desktop
EOF
npm install --silent
npm run build --silent

# nginx runs as www-data, which can't traverse into a private $HOME --
# copy the build to /var/www instead of serving it from $INSTALL_DIR.
WEB_ROOT=/var/www/bboxai-desktop
sudo mkdir -p "$WEB_ROOT"
sudo rm -rf "${WEB_ROOT:?}"/*
sudo cp -r dist/. "$WEB_ROOT/"
sudo chown -R www-data:www-data "$WEB_ROOT"

echo "==> Configuring nginx (bboxai-desktop.conf, port $WEB_PORT)"
sudo tee /etc/nginx/sites-available/bboxai-desktop.conf >/dev/null <<EOF
server {
    listen $WEB_PORT;
    server_name _;
    root $WEB_ROOT;
    index index.html;

    location / {
        try_files \$uri /index.html;
    }
}
EOF
sudo ln -sf /etc/nginx/sites-available/bboxai-desktop.conf /etc/nginx/sites-enabled/bboxai-desktop.conf
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx

echo
echo "================================================================"
echo " bboxai-desktop installed."
echo " Local UI:  http://bboxai:$WEB_PORT  (or http://localhost:$WEB_PORT)"
echo " API:       http://localhost:$API_PORT (docs at /docs)"
echo
echo " Next: open the UI above and register an account, then run"
echo "   ./bboxai-desktop/enable-remote.sh"
echo " to enable away-from-home access via bboxai-remote.unitani.com."
echo "================================================================"
