# Asset pipeline

The renderer consumes three character atlases plus three wall/floor textures. Everything
is generated locally and deterministically except for Blender's renderer, which is
deterministic given the same version and samples.

```text
ASCII map ─────────────┐
                       ├─► engine
textures ──────────────┤
3 × atlas.{png,json} ──┘

Blender chassis ─► 1,216 RGBA renders + depth/normal controls ─► 1,216 stylized frames per character ─► 3 × 1536×7296 atlases
```

## Commands

```bash
npm run assets:textures   # requires only Node
npm run assets:blender    # requires Blender on PATH (or BLENDER_BIN=...)
npm run assets:stylize    # palette stylizer, requires raw renders
npm run assets:comfy      # ComfyUI stylizer, requires raw renders + controls
npm run assets:comfy:dry  # print the resolved ComfyUI plan, no calls/writes
npm run assets:verify     # silhouette IoU + palette drift report
npm run assets:atlas      # requires stylized frames
npm run assets            # textures → Blender → palette stylize → atlas
```

`npm run assets:blender` passes extra arguments through to the Python script, e.g.:

```bash
npm run assets:blender -- --yaws 16 --samples 32
npm run assets:blender -- --pitches 4
npm run assets:blender -- --character guardian --only idle:0:1:0 --resolution 128
npm run assets:blender -- --no-controls          # skip depth/normal passes
BLENDER_BIN=/Applications/Blender.app/Contents/MacOS/Blender npm run assets:blender
```

The stylizer, verifier, and packer default to guardian, the only shipped chassis; pass
`guardian` explicitly if you want to be verbose: `npm run assets:stylize -- guardian`,
`npm run assets:comfy -- guardian`, `npm run assets:verify -- guardian`,
`npm run assets:atlas -- guardian`.

Tested with Blender 5.2.2, Node 24, and ComfyUI's `/prompt` HTTP API. The full 1,216-frame
render per character takes roughly 3–4 minutes at 384² / 16 samples on Apple Silicon,
plus two cheap control passes per frame. Raw renders, control images, and intermediate
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

The scout and brute specs were retired from shipping assets after the M9 content pass;
every actor renders through the guardian atlas.

- Cycles, 384×384, 16 samples, Standard view transform.
- Ortho scale 1.15 world units, camera aimed at `(0, 0, 0.5)`. The near-overhead pitch
  uses `PITCH_SCALES[3] = 0.78` so the foreshortened top view fills more of the frame.
- Yaw: camera orbits with `azimuth = yaw / yaws × 2π`, 16 yaws by default.
- Pitch: camera elevation `z = 0.5 + sin(pitch) × R`, with
  `PITCH_ANGLES = [-0.31, 0, 0.49, 1.25]` (low, level, high, top).
- States: `idle` (2 frames), `walk` (4 frames, hip/arm swing), `attack` (4 frames, arm
  swing + forward lean), `hurt` (2 frames, recoil), `death` (4 frames, collapse to the
  floor), `talk` (3 frames, head/arm gesture).
- Frame filenames: `{state}_f{frame}_p{pitch}_y{yaw}.png`.

Output: `assets-src/characters/<character>/raw/` — 1,216 files per character (16 yaws ×
4 pitches × 19 poses), RGBA with a transparent background.

Each frame also gets two control passes rendered through `scene.compositing_node_group`
(Blender 5.2 removed the legacy compositor API and multilayer EXR):

| Pass | Path | Encoding |
| --- | --- | --- |
| Depth | `assets-src/characters/<character>/control/depth/<frame>.png` | grayscale, `3.2–5.0` world units mapped to white→black |
| Normal | `assets-src/characters/<character>/control/normal/<frame>.png` | `-1..1` per axis mapped to `0..1`, black background via alpha |

Controls render with `--control-samples 4` (default) and the Raw view transform; they are
cheap because they carry no colour detail. Pass `--no-controls` when only the raw frames
are needed. The ComfyUI stage consumes the depth pass; the normal pass is available for a
normal-ControlNet variant.

### Adding a state

1. Add the state to the pose/timeline logic in `render_turntable.py`.
2. Add `{ name, fps, frames }` to `STATES` in `tools/atlas/pack.ts`.
3. Update `manifest.states` expectations and the engine's state fallback if needed.
4. Rerun `npm run assets:blender`, then `assets:comfy` (or `assets:stylize`), then
   `assets:atlas`.

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

This command overwrites every frame with the palette fallback. The committed atlas is
AI-stylized, so running it alone silently replaces the approved art. To change one state,
restore the other frames from the committed atlas (or rerun them through `assets:comfy
--resume`) and stylize only the new frames with ComfyUI.

The outline pass is order-dependent and uses an immutable `solid` mask. Do not replace it
with an in-place neighbor test; that bug produced opaque black rectangles.

## Stage 4 — atlas (`tools/atlas/pack.ts`)

Packs frames row-major into a uniform grid and writes a manifest. Direction and pitch
counts are detected from the frame filenames, so 8-way and 16-way atlases use the same
code.

- Frame size: 96×96.
- Grid: 16 columns (yaw) × 76 rows (19 poses × 4 pitch) = 1536×7296 per character.
- `frameWorldSize = 1.15`, `frameAnchorZ = -0.075`.
- Row order: for each state, for each frame, for each pitch (low, level, high, top), then
  yaw.
- Output: `public/assets/sprites/<character>/atlas.{png,json}`.

Six states are packed: `idle` (2 frames, 2 fps), `walk` (4, 8), `attack` (4, 10),
`hurt` (2, 8), `death` (4, 6), `talk` (3, 4). The engine animates `idle`/`walk` from a
per-actor clock and uses a separate state clock for one-shot states; `death` clamps to its
last frame so corpses hold their final pose.

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
    "walk": { "fps": 8, "frames": 4 },
    "attack": { "fps": 10, "frames": 4 },
    "hurt": { "fps": 8, "frames": 2 },
    "death": { "fps": 6, "frames": 4 },
    "talk": { "fps": 4, "frames": 3 }
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

## Stage 5 — ComfyUI stylization (`tools/stylize/comfy.ts`)

The palette stylizer (stage 3) remains the deterministic fallback. The AI stage is
backend-swappable and keeps the same contract:

```text
input:  384×384 RGBA render + depth control image + style preset + fixed seed
output: 96×96 RGBA frame with the same filename
```

### Local setup (Apple Silicon, verified)

ComfyUI lives outside the repo (not vendored). Installed at `~/Desktop/projects/ComfyUI`
with Python 3.12, PyTorch 2.15 (MPS), and ComfyUI 0.45.0:

```bash
git clone --depth 1 https://github.com/comfyanonymous/ComfyUI
cd ComfyUI && python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -c "import torch; print(torch.backends.mps.is_available())"   # True
```

Models (SD1.5 base + fp16 SD1.5 depth ControlNet):

```bash
curl -L -o models/checkpoints/v1-5-pruned-emaonly.safetensors \
  https://huggingface.co/runwayml/stable-diffusion-v1-5/resolve/main/v1-5-pruned-emaonly.safetensors
curl -L -o models/controlnet/control_v11f1p_sd15_depth.safetensors \
  https://huggingface.co/comfyanonymous/ControlNet-v1-1_fp16_safetensors/resolve/main/control_v11f1p_sd15_depth_fp16.safetensors
```

Start the server (first boot takes ~25 s):

```bash
cd ~/Desktop/projects/ComfyUI
.venv/bin/python main.py --listen 127.0.0.1 --port 8188 --disable-auto-launch
```

Verify before a long run:

```bash
curl -s http://127.0.0.1:8188/system_stats
npm run assets:comfy -- guardian --only idle:0:1:0 \
  --checkpoint v1-5-pruned-emaonly.safetensors \
  --controlnet control_v11f1p_sd15_depth.safetensors \
  --out /tmp/comfy-smoke --timeout 600
```

Measured on M-series / 36 GB: ~22 s for the first frame (model load) and ~8–11 s per warm
frame at 512² with 20 steps. The full six-state guardian pass (1,216 frames) runs in
roughly 2–2.5 h. Use `--resume` so an interrupted pass continues, and verify afterward.

### Workflow

`tools/comfy/workflow_api.json` is an API-format graph (`/prompt` format, not the UI
format). The wrapper fills `__PLACEHOLDER__` tokens per frame:

```text
LoadImage(raw) ─┐
                ├─► VAEEncode ─► KSampler (fixed seed, dpmpp_2m/karras) ─► VAEDecode ─► SaveImage
Checkpoint ─────┤                      ▲
CLIP + prompts ─┘                      │
LoadImage(depth) ─► ControlNetApplyAdvanced (strength, start/end) ─┘
```

Placeholders: checkpoint, ControlNet, both image names, positive/negative prompt, seed,
steps, cfg, denoise, control strength, start/end percent, filename prefix. The workflow
validator checks node shape, `SaveImage` presence, and that every link points at an
existing node. The model file names are required; they are passed as
`--checkpoint` / `--controlnet` or `COMFY_CHECKPOINT` / `COMFY_CONTROLNET`.

### CLI

```bash
npm run assets:comfy -- guardian \
  --checkpoint sd15.safetensors \
  --controlnet control_v11f1p_sd15_depth.pth \
  --style "SNES RPG, muted palette" \
  --seed 1337

npm run assets:comfy -- guardian --palette --only idle:0:1:0   # no server needed
npm run assets:comfy -- guardian --fallback                     # palette on any failure
npm run assets:comfy -- guardian --only attack,hurt --resume    # only missing outputs
npm run assets:comfy -- guardian --only attack:0 --resume       # one state frame, all views
npm run assets:comfy -- --dry-run                               # plan only
```

Flags: `--endpoint` (default `http://127.0.0.1:8188`), `--workflow`, `--prompt`,
`--negative`, `--steps`, `--cfg`, `--denoise`, `--strength`, `--start`, `--end`,
`--timeout`, `--concurrency`, `--limit`, `--only`, `--resume`, `--out`, `--raw`,
`--control`, and `--no-outline`. `--resume` skips frames whose output already exists, so
an interrupted pass continues where it stopped; `--only` accepts
`state:frame:pitch:yaw` prefixes, which makes targeted repair of a single pose cheap. The client uploads each raw/control pair to `/upload/image`, queues the
graph at `/prompt`, polls `/history/<id>`, downloads the result from `/view`, then:

1. Box-downsamples the generated image and the raw render to 96×96 (premultiplied alpha).
2. Uses the **raw alpha mask as the cutout authority**, so the generated sprite cannot
   grow outside the Blender silhouette or keep a black/white background fringe.
3. Optionally adds the same 1 px dark outline as the palette stylizer.
4. Writes the frame, so the atlas packer (stage 4) runs unchanged.

If ComfyUI is unreachable or a frame fails, `--fallback` (also used by the MCP server by
default) reruns that frame through the palette stylizer. `--palette` skips ComfyUI
entirely. `npm run assets:comfy:dry` never writes and lists missing controls.

The prompt is character-aware (guardian descriptor), and one fixed seed is
shared by every view to reduce view-to-view drift. There is no reference-image lock yet;
the depth pass plus img2img keeps geometry, while the verifier catches colour drift.

## Stage 6 — style verification (`tools/verify/style.ts`)

```bash
npm run assets:verify                       # guardian (the only shipped chassis)
npm run assets:verify -- guardian           # explicit name
npm run assets:verify -- --min-iou 0.97 --max-drift 10
```

Writes `artifacts/style-report.json` (gitignored) and prints a per-character table:

- **Silhouette IoU** compares the stylized alpha mask with the raw render downsampled to
  96². It allows a 1 px dilation (`--tolerance 1`, default) because the outline pass is
  intentionally outside the raw silhouette; use `--tolerance 0` for strict masks.
- **Palette drift** compares each frame's mean opaque colour with the average of its two
  yaw neighbours. Adjacent views show almost the same surfaces, so this detects a
  generator changing costume colours between angles without flagging legitimate
  front/back or top-down differences. Frames are grouped by state, frame index, and pitch,
  so walk poses and pitch bands are compared only to their peers.
- Missing raw renders, non-square frames, low IoU, or high mean drift fail the command.

Baseline for the shipped guardian atlas (1,216 frames): mean IoU 0.90 at 1 px tolerance,
with the lowest frame at 0.43 in the near-overhead hurt row where the depth model
straightens steep foreshortening, and mean neighbour-yaw palette drift 5.9 (threshold is
mean ≤ 12). The palette fallback reproduces the raw silhouette exactly (IoU 1.000), so the
default `0.98` per-frame floor only applies to fallback art; for the AI atlas use
`--min-iou 0.4` as a regression gate and review the per-state numbers before changing
thresholds. Thresholds default to `0.98` IoU and `12` mean drift. Tune
`--max-drift` only when a deliberate style preset shifts the palette consistently across
all views.

## MCP studio server (`tools/mcp/studio.ts`)

`npm run mcp:studio` speaks newline-delimited JSON-RPC 2.0 over stdio with no SDK
dependency. It exposes:

| Tool | Arguments | Action |
| --- | --- | --- |
| `generate_character_atlas` | `character`, `style`, `seed`, `mode` (comfy/palette), `fallback`, `only`, `pack`, `verify`, `dryRun` | Stylize the character, repack the atlas, then verify |
| `regenerate_view` | `character`, `frame`, `style`, `seed`, `mode`, `fallback`, `pack` | Stylize one cell and repack |

Both tools spawn the CLI directly with an argv array (no shell), restrict characters to
the three atlas ids, validate frame keys, and default to `--fallback` so a missing
ComfyUI server still produces frames. Logs go to stderr; stdout carries only JSON-RPC.

Example IDE configuration:

```json
{
  "mcpServers": {
    "raycast-studio": {
      "command": "npx",
      "args": ["tsx", "tools/mcp/studio.ts"],
      "cwd": "/absolute/path/to/raycast",
      "env": {
        "COMFY_ENDPOINT": "http://127.0.0.1:8188",
        "COMFY_CHECKPOINT": "sd15.safetensors",
        "COMFY_CONTROLNET": "control_v11f1p_sd15_depth.pth"
      }
    }
  }
}
```

Smoke test without an IDE:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | npm run mcp:studio
```

The ComfyUI call path is covered by `tests/comfy-cli.test.ts`, which runs the real CLI
against a mock HTTP server (upload → prompt → history → view → 96² frame), so the test
suite needs no GPU or models. The real pass was run on Apple Silicon (see
[Local setup](#local-setup-apple-silicon-verified)): all 1,152 frames generated with 0
palette fallbacks in ~3 h total, so the committed atlases are now AI-stylized. No
ComfyUI server, checkpoint, or ControlNet model is bundled with this repo. The optional
AutoSprite/Gamelabs adapter from the roadmap is not built; the CLI/workflow boundary is
the integration point.

See the spec, [AI Sprites In Raycasting Games](spec/AI-Sprites-In-Raycasting-Games.pdf),
for the ComfyUI/MCP discussion and generator references.
