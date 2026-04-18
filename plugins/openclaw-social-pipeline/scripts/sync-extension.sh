#!/usr/bin/env bash
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
EXT="${OPENCLAW_EXTENSION_DIR:-$HOME/.openclaw/extensions/openclaw-social-pipeline}"
[ -d "$EXT" ] || { echo "extension dir missing: $EXT" >&2; exit 0; }

for f in openclaw.plugin.json package.json tsconfig.json; do
  cmp -s "$SRC/$f" "$EXT/$f" 2>/dev/null || cp "$SRC/$f" "$EXT/$f"
done

for d in dist skills lobster; do
  [ -L "$EXT/$d" ] && rm "$EXT/$d"
  mkdir -p "$EXT/$d"
  rsync -a --delete "$SRC/$d/" "$EXT/$d/"
done

echo "[sync] extension updated at $EXT"
