#!/usr/bin/env bash
# Folio Cloud — one-command relay deploy/upgrade.
#
# Analog `notibox-backplane-deploy`: fetch latest (or pinned) jzmudzinski/folio
# release for this host's arch → install binary + themes + templates →
# restart folio-cloud → health check. Idempotent (skips if already current).
#
# Installed to /usr/local/bin/folio-cloud-deploy by deploy/install.sh.
#
# Usage:
#   sudo folio-cloud-deploy             # upgrade to latest (no-op if current)
#   sudo folio-cloud-deploy --check     # report current vs latest, change nothing
#   sudo folio-cloud-deploy --force     # reinstall even if same version
#   sudo FOLIO_VERSION=v0.32.0 folio-cloud-deploy   # pin a release (rollback)
#
# Private repo: export GH_TOKEN to authenticate the GitHub API tag lookup.
# Data in /var/lib/folio-cloud/ is never touched.

set -euo pipefail

REPO="jzmudzinski/folio"
BIN="/opt/folio/folio"
SERVICE="folio-cloud"
PORT="${FOLIO_CLOUD_PORT:-8081}"

err() { echo "✗ $*" >&2; }
log() { echo "→ $*"; }
norm() { echo "${1#v}"; }  # strip leading v for comparison

[ "$EUID" -eq 0 ] || { err "must run as root (try: sudo $0)"; exit 1; }
for c in curl tar rsync install systemctl; do
  command -v "$c" >/dev/null 2>&1 || { err "required command not found: $c"; exit 1; }
done
[ -e "/etc/systemd/system/${SERVICE}.service" ] || {
  err "${SERVICE}.service not installed — run install.sh / bootstrap.sh first"; exit 1; }

detect_target() {
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64) echo "linux-x64" ;;
    Linux-aarch64|Linux-arm64) echo "linux-arm64" ;;
    Darwin-arm64) echo "darwin-arm64" ;;
    *) err "unsupported platform $(uname -s)-$(uname -m)"; exit 1 ;;
  esac
}
TARGET="$(detect_target)"

# ───── Resolve target version ─────────────────────────────────────────────
WANT="${FOLIO_VERSION:-latest}"
GH_AUTH=()
[ -n "${GH_TOKEN:-${GITHUB_TOKEN:-}}" ] && GH_AUTH=(-H "Authorization: Bearer ${GH_TOKEN:-$GITHUB_TOKEN}")
if [ "$WANT" = "latest" ]; then
  TAG="$(curl -fsSL "${GH_AUTH[@]}" "https://api.github.com/repos/${REPO}/releases/latest" \
    | grep -m1 '"tag_name"' | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')"
  [ -n "$TAG" ] || { err "could not resolve latest tag from GitHub API"; exit 1; }
else
  TAG="$WANT"
fi

CUR=""
[ -x "$BIN" ] && CUR="$("$BIN" version 2>/dev/null | grep -oiE 'v?[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)"
log "relay binary: ${CUR:-none}   target: ${TAG}   arch: ${TARGET}"

ARG="${1:-}"

if [ "$ARG" = "--check" ]; then
  if [ -n "$CUR" ] && [ "$(norm "$CUR")" = "$(norm "$TAG")" ]; then
    echo "✓ up to date (${CUR})"
  else
    echo "↑ update available: ${CUR:-none} → ${TAG}"
  fi
  exit 0
fi

if [ "$ARG" != "--force" ] && [ -n "$CUR" ] && [ "$(norm "$CUR")" = "$(norm "$TAG")" ]; then
  echo "✓ already on ${CUR} — nothing to do (use --force to reinstall)"
  exit 0
fi

# ───── Download + extract ─────────────────────────────────────────────────
URL="https://github.com/${REPO}/releases/download/${TAG}/folio-${TARGET}.tar.gz"
WORK="$(mktemp -d -t folio-deploy-XXXXXX)"
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"
log "downloading ${URL}"
curl -fL --retry 3 --progress-bar "$URL" -o folio.tar.gz
tar xzf folio.tar.gz
[ -e "dist/folio-${TARGET}" ] || { err "tarball missing dist/folio-${TARGET}"; exit 1; }
[ -e "themes/linen/theme.css" ] || { err "tarball missing themes/"; exit 1; }

# ───── Install (mirror of update.sh) ──────────────────────────────────────
log "installing binary + themes + templates"
install -m 755 "dist/folio-${TARGET}" "$BIN"
rsync -a --delete themes/ /opt/folio/themes/
rsync -a --delete templates/ /opt/folio/templates/

log "restarting ${SERVICE}"
systemctl restart "$SERVICE"

# ───── Health check ───────────────────────────────────────────────────────
# Relay is "up" if it answers on its bind port. 401 (no bearer token) is fine —
# it means the HTTP server is serving; only a connection refusal (000) is bad.
sleep 2
code="000"
for _ in 1 2 3 4 5; do
  code="$(curl -s -o /dev/null -m 5 -w '%{http_code}' "http://127.0.0.1:${PORT}/" || echo 000)"
  [ "$code" != "000" ] && break
  sleep 2
done
NEW="$("$BIN" version 2>/dev/null | grep -oiE 'v?[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)"

if [ "$code" != "000" ] && systemctl is-active --quiet "$SERVICE"; then
  echo "✓ folio-cloud upgraded to ${NEW:-$TAG} — service active, port ${PORT} responding (HTTP ${code})"
else
  err "health check FAILED — service active=$(systemctl is-active "$SERVICE" || true), port ${PORT} code=${code}"
  systemctl --no-pager status "$SERVICE" 2>/dev/null | head -15 >&2 || true
  exit 1
fi
