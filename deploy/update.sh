#!/usr/bin/env bash
# Folio Cloud — replace binary + bundled assets, restart service.
#
# Expects the same release tarball layout as install.sh:
#   dist/folio-linux-x64
#   themes/
#   templates/
# Run as root, in the unpacked tarball dir.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [ "$EUID" -ne 0 ]; then
  echo "✗ update.sh must run as root (try: sudo $0)" >&2
  exit 1
fi

if [ ! -e /etc/systemd/system/folio-cloud.service ]; then
  echo "✗ folio-cloud.service not installed — run install.sh first" >&2
  exit 1
fi

for f in themes/linen/theme.css; do
  if [ ! -e "$f" ]; then
    echo "✗ missing $f — did you unpack the release tarball?" >&2
    exit 1
  fi
done

# Binary lives at ./folio (current layout) or ./dist/folio-linux-x64 (legacy).
BINSRC=""
for cand in folio dist/folio-linux-x64; do [ -f "$cand" ] && { BINSRC="$cand"; break; }; done
[ -n "$BINSRC" ] || { echo "✗ no folio binary in tarball (looked for ./folio and dist/folio-linux-x64)" >&2; exit 1; }

install -m 755 "$BINSRC" /opt/folio/folio
rsync -a --delete themes/ /opt/folio/themes/
rsync -a --delete templates/ /opt/folio/templates/

systemctl restart folio-cloud
sleep 1
systemctl --no-pager status folio-cloud | head -10
