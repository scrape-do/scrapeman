#!/usr/bin/env bash
# Render the Scrapeman mark from assets/logos/scrapeman-mark.svg into the
# full icon set used by electron-builder and macOS iconutil.
#
# Requirements:
#   - pnpm (dlx pulls @resvg/resvg-js-cli on demand, no install needed)
#   - iconutil (macOS built-in, for .icns)
#
# Windows .ico is currently skipped — electron-builder can accept a single
# 256×256 PNG as the Windows icon fallback, and that is what we wire up.
# Real .ico generation will come with the signing milestone (M10).

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

SRC="assets/logos/scrapeman-app-icon.svg"
OUT_BUILD="apps/desktop/build-resources"
OUT_ASSETS="assets/icons"
ICONSET_DIR="$(mktemp -d)/scrapeman.iconset"

if [ ! -f "$SRC" ]; then
  echo "[icons] source not found: $SRC"
  exit 1
fi

mkdir -p "$OUT_BUILD" "$OUT_ASSETS" "$ICONSET_DIR"

# Transparent PNG for light surfaces and macOS dock; the mark is orange on
# transparent so it reads on any backdrop.
SIZES=(16 32 64 128 256 512 1024)

for size in "${SIZES[@]}"; do
  OUT="$OUT_ASSETS/icon-${size}.png"
  pnpm dlx @resvg/resvg-js-cli --fit-width "$size" "$SRC" "$OUT"
done

# macOS .iconset layout: icon_<base>x<base>[@2x].png for each required size.
# iconutil then compiles into a single .icns.
cp "$OUT_ASSETS/icon-16.png"   "$ICONSET_DIR/icon_16x16.png"
cp "$OUT_ASSETS/icon-32.png"   "$ICONSET_DIR/icon_16x16@2x.png"
cp "$OUT_ASSETS/icon-32.png"   "$ICONSET_DIR/icon_32x32.png"
cp "$OUT_ASSETS/icon-64.png"   "$ICONSET_DIR/icon_32x32@2x.png"
cp "$OUT_ASSETS/icon-128.png"  "$ICONSET_DIR/icon_128x128.png"
cp "$OUT_ASSETS/icon-256.png"  "$ICONSET_DIR/icon_128x128@2x.png"
cp "$OUT_ASSETS/icon-256.png"  "$ICONSET_DIR/icon_256x256.png"
cp "$OUT_ASSETS/icon-512.png"  "$ICONSET_DIR/icon_256x256@2x.png"
cp "$OUT_ASSETS/icon-512.png"  "$ICONSET_DIR/icon_512x512.png"
cp "$OUT_ASSETS/icon-1024.png" "$ICONSET_DIR/icon_512x512@2x.png"

iconutil -c icns "$ICONSET_DIR" -o "$OUT_BUILD/icon.icns"

# Linux AppImage + deb + the Windows PNG fallback all eat a plain 1024 PNG.
cp "$OUT_ASSETS/icon-1024.png" "$OUT_BUILD/icon.png"

echo "[icons] built $OUT_BUILD/icon.icns and $OUT_BUILD/icon.png"
