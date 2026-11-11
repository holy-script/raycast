# Asset pipeline

The renderer consumes one atlas plus three wall/floor textures. Everything is generated
locally and deterministically except for Blender's renderer, which is deterministic given
the same version and samples.

```text
ASCII map ─┐
           ├─► engine
textures ──┤
atlas ─────┘

Blender proxy ─► 144 RGBA renders ─► 96² pixel-art frames ─► 768×1728 atlas + JSON
```

## Commands

```bash
npm run assets:textures   # requires only Node
npm run assets:blender    # requires Blender on PATH (or BLENDER_BIN=...)
npm run assets:stylize    # requires raw renders
npm run assets:atlas      # requires stylized frames
npm run assets            # all four, in order
```

`npm run assets:blender` passes extra arguments through to the Python script, e.g.:

```bash
npm run assets:blender -- --yaws 16 --samples 32
npm run assets:blender -- --only idle:0:1:0 --resolution 128
BLENDER_BIN=/Applications/Blender.app/Contents/MacOS/Blender npm run assets:blender
```

Tested with Blender 5.2.2 and Node 24. Raw renders take roughly 1.2 s/frame at 24 samples
on Apple Silicon (~3 minutes for 144 frames). Raw renders and stylized intermediate frames
are gitignored; only the packed atlas, manifest, and textures are committed.

## Stage 1 — textures (`tools/assets/make-textures.ts`)

Pure TypeScript + `pngjs`, no external image tools. Produces:

| File | Tile | Look |
| --- | --- | --- |
| `brick.png` | `#` | Staggered brick, mortar, bevel highlights |
| `panel.png` | `X` | Teal tech panel with rivets and seams |
| `floor.png` | floor | Slate tiles with grout and variation |

Textures are 64×64, tiled by the renderer. Rerunning the script gives identical bytes.

## Stage 2 — Blender turntable (`tools/blender/`)

`render_turntable.py` builds a boxy robot from primitives (helmet, face plate, emissive
visor, antenna, backpack, tanks, shoulder pads), lights it with three suns, and renders
each frame with an orthographic camera and transparent film.

- Cycles, 384×384, 24 samples, Standard view transform.
- Ortho scale 1.15 world units, camera aimed at `(0, 0, 0.5)`.
- Yaw: camera orbits with `azimuth = yaw / yaws × 2π`.
- Pitch: camera elevation `z = 0.5 + sin(pitch) × R`, with `PITCH_ANGLES = [-0.31, 0, 0.49]`
  (low, level, high).
- States: `idle` (2 frames), `walk` (4 frames, hip/arm swing).
- Frame filenames: `{state}_f{frame}_p{pitch}_y{yaw}.png`.

Output: `assets-src/character/raw/` — 144 files, RGBA with transparent background.

### Adding a state

1. Add the state to the pose/timeline logic in `render_turntable.py`.
2. Add `{ name, fps, frames }` to `STATES` in `tools/atlas/pack.ts`.
3. Update `manifest.states` expectations and the engine's state fallback if needed.
4. Rerun `npm run assets:blender && npm run assets:stylize && npm run assets:atlas`.

### Adding a character

The current pipeline is hardcoded to one proxy. To add another:

1. Parameterize or fork `render_turntable.py` with a `--variant` material set.
2. Render into `assets-src/<name>/raw/`.
3. Point the stylizer and packer at those directories (both use constants at the top).
4. Emit `public/assets/sprites/<name>/atlas.{png,json}` and load it in `main.ts`.

Tint variants of the same body do not need new renders: set `tint` in `src/content/actors.ts`.

## Stage 3 — stylize (`tools/stylize/pixel-art.ts`)

Turns 384² renders into crisp 96² pixel art:

1. **Premultiplied 4× box downsample** to avoid dark fringes around alpha edges.
2. **Alpha cutoff** at 0.5 (keeps sprite edges hard for nearest-neighbor upscaling).
3. **Color punch:** saturation ×1.35, contrast ×1.08 around mid-grey.
4. **Palette quantization** to a fixed ~50-color palette (teals, oranges, browns,
   blue-greys) using nearest RGB distance.
5. **1 px outline** in near-black, drawn only where an opaque pixel touches transparency.
   The alpha mask is captured before outlining so the outline cannot flood the background.

Output: `public/assets/sprites/character/frames/{state}_f{frame}_p{pitch}_y{yaw}.png`.

The outline pass is order-dependent and uses an immutable `solid` mask. Do not replace it
with an in-place neighbor test; that bug produced opaque black rectangles.

## Stage 4 — atlas (`tools/atlas/pack.ts`)

Packs frames row-major into a uniform grid and writes a manifest.

- Frame size: 96×96.
- Grid: 8 columns (yaw) × 18 rows (state × frame × pitch) = 768×1728.
- `frameWorldSize = 1.15`, `frameAnchorZ = -0.075`.
- Row order: for each state, for each frame, for each pitch (low, level, high), then yaw.

Manifest shape (`atlas.json`):

```json
{
  "version": 1,
  "image": "atlas.png",
  "frameWidth": 96,
  "frameHeight": 96,
  "frameWorldSize": 1.15,
  "frameAnchorZ": -0.075,
  "directions": 8,
  "pitches": 3,
  "pitchOrder": ["low", "level", "high"],
  "states": {
    "idle": { "fps": 2, "frames": 2 },
    "walk": { "fps": 8, "frames": 4 }
  },
  "frames": [
    { "state": "idle", "pitch": 0, "yaw": 0, "frame": 0, "x": 0, "y": 0, "w": 96, "h": 96 }
  ]
}
```

Lookup order: exact `(state, pitch, yaw, frame)` → level pitch → `idle/level/yaw/0`.
Yaw and frame indices wrap, so 16-way mode can read a slightly rotated entry from an
8-way atlas if no 16-way atlas is present.

`anchorZ` shifts the frame bottom relative to the actor's feet. It exists because the
high-angle orthographic frames leave empty space below the feet; without it, feet clip
during pitch.

## Future: AI stylization (M6)

The style stage is intentionally swappable. The contract is:

```text
input:  384×384 RGBA render + depth/normal control image + style preset + fixed seed
output: 96×96 RGBA stylized frame with the same filename
```

Planned flow:

1. Blender exports a depth (and optionally normal) pass per frame.
2. ComfyUI workflow: img2img with ControlNet depth/normal, fixed seed, reference image
   per character to lock costume details.
3. A Node or Python wrapper runs the workflow per frame and writes into the frames dir.
4. The existing atlas packer runs unchanged.
5. An MCP server exposes `generate_character_atlas(character, style, states)` and
   `regenerate_view(frame)` so an LLM can drive regeneration from the IDE.

The palette stylizer remains the deterministic fallback and the comparison baseline.
Validation should include silhouette IoU and palette drift across views, because AI
stylization tends to drift in color and detail between angles.

See the spec, [AI Sprites In Raycasting Games](spec/AI-Sprites-In-Raycasting-Games.pdf),
for the ComfyUI/MCP discussion and generator references.
