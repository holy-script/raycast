#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

BLENDER_BIN="${BLENDER_BIN:-blender}"
OUT="assets-src/character/raw"
mkdir -p "$OUT"

"$BLENDER_BIN" -b --factory-startup \
  --python tools/blender/render_turntable.py -- \
  --out "$OUT" --resolution 384 --samples 24 "$@"
