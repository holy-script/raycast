#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

BLENDER_BIN="${BLENDER_BIN:-blender}"
CHARACTERS=(guardian scout brute)

for character in "${CHARACTERS[@]}"; do
  out="assets-src/characters/$character/raw"
  mkdir -p "$out"
  echo "== rendering $character =="
  "$BLENDER_BIN" -b --factory-startup \
    --python tools/blender/render_turntable.py -- \
    --character "$character" --out "$out" \
    --resolution 384 --samples 16 --yaws 16 "$@"
done
