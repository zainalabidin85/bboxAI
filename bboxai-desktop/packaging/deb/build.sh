#!/usr/bin/env bash
# Builds bboxai-desktop_<version>_all.deb.
#
# Pre-builds bbox-web (so the package doesn't need Node.js at install time)
# and bundles bbox-api + bbox-agent source, then assembles a standard
# Debian package tree and runs dpkg-deb.
#
# Usage: ./bboxai-desktop/packaging/deb/build.sh [version]
set -euo pipefail

VERSION="${1:-1.0.0}"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PKG_DIR="$SOURCE_DIR/bboxai-desktop/packaging/deb"
BUILD_ROOT="$(mktemp -d)"
PKG_ROOT="$BUILD_ROOT/bboxai-desktop_${VERSION}_all"

echo "==> Building bbox-web (bundled, pre-built — no Node needed at install time)"
cd "$SOURCE_DIR/bbox-web"
cat > .env.production.pkgbuild <<EOF
VITE_API_BASE_URL=http://bboxai:8000
VITE_REMOTE=false
VITE_APP_TITLE=bboxAI-Desktop
EOF
cp .env.production.pkgbuild .env.production
npm install --silent
npm run build --silent
rm -f .env.production.pkgbuild

echo "==> Assembling package tree at $PKG_ROOT"
mkdir -p "$PKG_ROOT/DEBIAN"
mkdir -p "$PKG_ROOT/opt/bboxai-desktop"
mkdir -p "$PKG_ROOT/usr/bin"

sed "s/VERSION_PLACEHOLDER/$VERSION/" "$PKG_DIR/control" > "$PKG_ROOT/DEBIAN/control"
install -m 755 "$PKG_DIR/postinst" "$PKG_ROOT/DEBIAN/postinst"
install -m 755 "$PKG_DIR/prerm"    "$PKG_ROOT/DEBIAN/prerm"
install -m 755 "$PKG_DIR/postrm"   "$PKG_ROOT/DEBIAN/postrm"

# App source (bbox-api, bbox-agent) — excluding dev/runtime artifacts.
# storage/ and weights/ are runtime data dirs; postinst creates fresh ones
# under /var/lib/bboxai-desktop instead.
rsync -a --exclude venv --exclude __pycache__ --exclude '.env' --exclude '*.pyc' \
  --exclude storage --exclude weights \
  "$SOURCE_DIR/bbox-api/" "$PKG_ROOT/opt/bboxai-desktop/bbox-api/"
rsync -a --exclude venv --exclude __pycache__ --exclude '.env' --exclude '*.pyc' \
  "$SOURCE_DIR/bbox-agent/" "$PKG_ROOT/opt/bboxai-desktop/bbox-agent/"

# Pre-built web UI
mkdir -p "$PKG_ROOT/opt/bboxai-desktop/bbox-web-dist"
cp -r "$SOURCE_DIR/bbox-web/dist/." "$PKG_ROOT/opt/bboxai-desktop/bbox-web-dist/"

# systemd units + nginx site template (copied into place by postinst)
mkdir -p "$PKG_ROOT/opt/bboxai-desktop/packaging"
cp "$SOURCE_DIR/bboxai-desktop/packaging/bboxai-api.service"   "$PKG_ROOT/opt/bboxai-desktop/packaging/"
cp "$SOURCE_DIR/bboxai-desktop/packaging/bboxai-agent.service" "$PKG_ROOT/opt/bboxai-desktop/packaging/"
cp "$SOURCE_DIR/bboxai-desktop/packaging/bboxai-desktop.nginx.conf" "$PKG_ROOT/opt/bboxai-desktop/packaging/"

# CLI entrypoint for enabling remote access after install
install -m 755 "$SOURCE_DIR/bboxai-desktop/packaging/bboxai-enable-remote" "$PKG_ROOT/usr/bin/bboxai-enable-remote"

find "$PKG_ROOT" -type d -exec chmod 755 {} \;

echo "==> Building .deb"
OUT_DIR="$SOURCE_DIR/bboxai-desktop/packaging/deb/out"
mkdir -p "$OUT_DIR"
dpkg-deb --root-owner-group --build "$PKG_ROOT" "$OUT_DIR/bboxai-desktop_${VERSION}_all.deb"

rm -rf "$BUILD_ROOT"
echo "==> Built: $OUT_DIR/bboxai-desktop_${VERSION}_all.deb"
