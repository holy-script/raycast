# Asset pipeline

The renderer consumes three character atlases plus three wall/floor textures. Everything
is generated locally and deterministically except for Blender's renderer, which is
deterministic given the same version and samples.

```text
ASCII map ─────────────┐
                       ├─► engine
textures ──────────────┤
3 × atlas.{png,json} ──┘

Blender chassis ─► 1152 RGBA renders ─► 384 frames per character ─► 3 × 1536×2304 atlases
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
npm run assets:blender -- --pitches 4
npm run assets:blender -- --character scout --only idle:0:1:0 --resolution 128
BLENDER_BIN=/Applications/Blender.app/Contents/MacOS/Blender npm run assets:blender
```

The stylizer and packer default to guardian, scout, and brute; pass names to limit them:
`npm run assets:stylize -- scout` and `npm run assets:atlas -- scout`.

Tested with Blender 5.2.2 and Node 24. The full 1152-frame render takes roughly two and a
half minutes at 384² / 16 samples on Apple Silicon. Raw renders and stylized intermediate
frames are gitignored; only the packed atlases, manifests, and textures are committed.

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
each frame with an orthographic camera and transparent film. Three chassis share the rig
with different materials and proportions:

| Character | Palette | Silhouette |
| --- | --- | --- |
| `guardian` | Rust jacket, teal pants, bright teal visor | Standard bulk, antenna, twin tanks |
| `scout` | Teal jacket, dark trousers, pale visor | Slim (0.84 bulk), small helmet, long antenna, no tanks |
| `brute` | Dark rust/charcoal, orange visor | Wide (1.3 bulk), large helmet, shoulder plates, no antenna |

- Cycles, 384×384, 16 samples, Standard view transform.
- Ortho scale 1.15 world units, camera aimed at `(0, 0, 0.5)`. The near-overhead pitch
  uses `PITCH_SCALES[3] = 0.78` so the foreshortened top view fills more of the frame.
- Yaw: camera orbits with `azimuth = yaw / yaws × 2π`, 16 yaws by default.
- Pitch: camera elevation `z = 0.5 + sin(pitch) × R`, with
  `PITCH_ANGLES = [-0.31, 0, 0.49, 1.25]` (low, level, high, top).
- States: `idle` (2 frames), `walk` (4 frames, hip/arm swing).
- Frame filenames: `{state}_f{frame}_p{pitch}_y{yaw}.png`.

Output: `assets-src/characters/<character>/raw/` — 384 files per character (16 yaws ×
4 pitches × 6 poses), RGBA with a transparent background.

### Adding a state

1. Add the state to the pose/timeline logic in `render_turntable.py`.
2. Add `{ name, fps, frames }` to `STATES` in `tools/atlas/pack.ts`.
3. Update `manifest.states` expectations and the engine's state fallback if needed.
4. Rerun `npm run assets:blender && npm run assets:stylize && npm run assets:atlas`.

### Adding a pitch

1. Extend `PITCH_ANGLES`, `PITCH_NAMES`, and `PITCH_SCALES` together in
   `render_turntable.py`; the index must match the atlas row order.
2. Extend `pitchOrder` in `tools/atlas/pack.ts` and the bands in
   `quantizePitch` (`src/engine/math.ts`) so each frame covers its elevation range.
3. Rerun the Blender, stylize, and atlas stages. The packer and engine read the count
   from the manifest, so no other wiring changes.

### Adding a character

1. Add an entry to `CHARACTERS` in `render_turntable.py` (palette, bulk, helmet scale,
   visor emission, tanks/antenna/shoulder plates, pack size).
2. Add the name to `CHARACTERS` in `tools/blender/render-all.sh` and to
   `DEFAULT_CHARACTERS` in both `tools/stylize/pixel-art.ts` and `tools/atlas/pack.ts`.
3. Load the new atlas in `src/main.ts` and add its id to `SpriteId` in
   `src/content/actors.ts`; assign `sprite` per actor.
4. Run `npm run assets`. The packer detects the direction/pitch counts from filenames.

Tint variants of the same chassis do not need new renders: set `tint` and `scale` in
`src/content/actors.ts`.

## Stage 3 — stylize (`tools/stylize/pixel-art.ts`)

Turns 384² renders into crisp 96² pixel art:

1. **Premultiplied 4× box downsample** to avoid dark fringes around alpha edges.
2. **Alpha cutoff** at 0.5 (keeps sprite edges hard for nearest-neighbor upscaling).
3. **Color punch:** saturation ×1.35, contrast ×1.08 around mid-grey.
4. **Palette quantization** to a fixed ~50-color palette (teals, oranges, browns,
   blue-greys) using nearest RGB distance.
5. **1 px outline** in near-black, drawn only where an opaque pixel touches transparency.
   The alpha mask is captured before outlining so the outline cannot flood the background.

Output: `public/assets/sprites/<character>/frames/{state}_f{frame}_p{pitch}_y{yaw}.png`.

The outline pass is order-dependent and uses an immutable `solid` mask. Do not replace it
with an in-place neighbor test; that bug produced opaque black rectangles.

## Stage 4 — atlas (`tools/atlas/pack.ts`)

Packs frames row-major into a uniform grid and writes a manifest. Direction and pitch
counts are detected from the frame filenames, so 8-way and 16-way atlases use the same
code.

- Frame size: 96×96.
- Grid: 16 columns (yaw) × 24 rows (state × frame × pitch) = 1536×2304 per character.
- `frameWorldSize = 1.15`, `frameAnchorZ = -0.075`.
- Row order: for each state, for each frame, for each pitch (low, level, high, top), then
  yaw.
- Output: `public/assets/sprites/<character>/atlas.{png,json}`.

Manifest shape (`atlas.json`):

```json
{
  "version": 1,
  "name": "guardian",
  "image": "atlas.png",
  "frameWidth": 96,
  "frameHeight": 96,
  "frameWorldSize": 1.15,
  "frameAnchorZ": -0.075,
  "directions": 16,
  "pitches": 4,
  "pitchOrder": ["low", "level", "high", "top"],
  "states": {
    "idle": { "fps": 2, "frames": 2 },
    "walk": { "fps": 8, "frames": 4 }
  },
  "frames": [
    { "state": "idle", "pitch": 0, "yaw": 0, "frame": 0, "x": 0, "y": 0, "w": 96, "h": 96 }
  ]
}
```

The packer detects direction and pitch counts from filenames, so 3-pitch atlases remain
valid; the engine reads `pitches` to choose the quantization bands.

Lookup order: exact `(state, pitch, yaw, frame)` → level pitch → `idle/level/yaw/0`.
Yaw and frame indices wrap, so a smaller fallback atlas still renders if a character
atlas is incomplete.

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
