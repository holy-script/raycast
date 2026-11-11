#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

BLENDER_BIN="${BLENDER_BIN:-blender}"
CHARACTERS=(guardian)

for character in "${CHARACTERS[@]}"; do
  out="assets-src/characters/$character/raw"
  mkdir -p "$out"
  echo "== rendering $character =="
  "$BLENDER_BIN" -b --factory-startup \
    --python tools/blender/render_turntable.py -- \
    --character "$character" --out "$out" \
    --resolution 384 --samples 16 --yaws 16 "$@"
done

echo "== rendering first-person viewmodel =="
view_out="assets-src/viewmodel/raw"
mkdir -p "$view_out" public/assets/sprites/player
"$BLENDER_BIN" -b --factory-startup \
  --python tools/blender/render_viewmodel.py -- \
  --out "$view_out" --resolution 256 --height 208 --samples 28 "$@"
for pose in idle0 idle1 windup strike recover; do
  cp "$view_out/$pose.png" "public/assets/sprites/player/$pose.png"
done
