# Progress

Last updated: **2026-11-11**

## Status at a glance

| Area | Milestone | Status |
| --- | --- | --- |
| Toolchain, tests, docs, playtest | M0 | ✅ Complete (CI intentionally deferred) |
| DDA renderer, textures, HUD, minimap | M1 | ✅ Complete |
| Jetpack, rotational pitch, roof plane, depth | M2 | ✅ Complete |
| 16-way × 4-pitch billboard sprites | M3 | ✅ Complete |
| Blender → stylize → atlas, 3 chassis | M4 | ✅ Complete |
| Heightmap blocks: stairs, platforms, crates | M5 | ✅ Complete |
| ComfyUI / MCP AI stylization | M6 | ✅ Complete (real generation needs a server + models) |
| 16-way and multi-character content | M7 | 🚧 Chassis, directions, behaviors done; combat pending |
| Audio, menus, deployment | M8 | 🚧 Live + auto-deploy; audio/menus pending |

## Verification snapshot

Run from a clean checkout:

```bash
npm ci
npm run typecheck   # passes
npm test            # 6 files, 43 tests pass
npm run build       # tsc + vite build
npm run playtest    # 29/29 browser checks pass
npm run assets:verify  # 384 frames/character; IoU 1.000, mean drift 4.6–5.1
```

Asset-side verification (2026-11-11, after the M6 pipeline landed):

- Blender exports 384 raw + 384 depth + 384 normal PNGs per character (1,152 frames per
  pass, 3,456 files total); `assets:comfy --dry-run` reports no missing controls.
- `npm run assets:verify` compares all 1,152 palette frames against raw renders: minimum
  IoU 1.000 with the 1 px outline tolerance; mean neighbour-yaw palette drift 4.6
  (guardian), 4.6 (scout), 5.1 (brute); worst single frame 27.5 / 27.7 / 30.1.
- `tests/comfy-cli.test.ts` runs the real CLI against a mock ComfyUI HTTP server and
  verifies both uploads, the queued graph (seed 1337, SaveImage prefix), history polling,
  download, silhouette masking, and 96×96 output.
- MCP smoke test: `initialize`, `tools/list`, and a dry-run `generate_character_atlas`
  call return valid JSON-RPC with only stdout framing.

Browser verification (2026-11-11, headless Chrome over CDP, `http://127.0.0.1:5199/?screenshot`):

- Three atlases load: guardian / scout / brute, each 16 directions × 4 pitches × 384
  frames (1536×2304).
- Movement, strafing, mouse yaw, and wall collision match screen direction.
- Jetpack lifts to 4.85 m and burns fuel, lands and refuels, holds an 18 m ceiling; pitch
  clamps at -63° on the ground and unlocks past it airborne.
- Front/back yaw selection verified at yaw 0 / 8 for all three chassis.
- Aerial views show a solid courtyard with wall tops, straight floor grid, visible actors,
  and sky only outside the map boundary.
- Airborne wall faces stay opaque: 384 columns / 35,120 wall pixels at altitude.
- Pressed against a wall the view stays solid (384 columns / 92,160 pixels) and survives a
  steep look-down (55,680 pixels), with no fisheye or vanishing geometry.
- Overhead sprites keep a readable silhouette (6×6 px, 26 opaque px), stay centred, and an
  actor near the map edge remains in view.
- The player lands on a wall top at 1.40 m (`support 1.40`, grounded) and drops to 0 when
  stepping off.
- Walking north from the courtyard floor climbs the two 0.2 steps onto the 0.4 platform
  (`support 0.40`, grounded); a 0.6 crate blocks walking but can be landed on.
- Per-cell tops render from the ground and from altitude, and the crate occludes 1,706
  opaque scholar pixels behind it while leaving the upper body visible.
- Screenshots: `docs/screenshots/playtest/01-…26-…`; machine-readable results in
  `docs/screenshots/playtest/report.json`.
- No console errors during the checked session.
- Production deployment: https://raycast-rosy.vercel.app — HTML, atlas JSON/PNG, and
  textures all return 200; the scene renders with no console errors in headless Chrome.
- Production harness run (2026-11-11, after the 4-pitch deploy):
  `PLAYTEST_OUT=/tmp/rc-prod-check npm run playtest
  -- --url https://raycast-rosy.vercel.app/` passed 24/24 against the deployed build,
  with all three 16-way / 4-pitch / 384-frame atlases served.
- Production harness run (2026-11-11, after the M5 heightmap deploy): passed 29/29 against
  the deployed build, including stairs, per-cell tops, crate block/occlusion, and landing
  on the crate.
- Production harness run (2026-11-11, after the M6 deploy): passed 29/29 against
  https://raycast-rosy.vercel.app/ with all three 16×4 atlases served; Vercel deployment
  `raycast-knbwjpvue` reached Ready in 11 s.

## Session log

### 2026-11-11 — M6 ComfyUI pipeline, verification, and MCP studio

- Blender now renders two control passes per frame through `scene.compositing_node_group`
  (the Blender 5.2 replacement for the removed legacy compositor): depth normalised
  3.2–5.0 and normals encoded from -1..1 to 0..1 with an alpha-cut black background.
  `--control-samples` keeps them cheap and `--no-controls` skips them. All 1,152 frames
  were re-rendered with controls (384 raw + 768 control files per character).
- Added `tools/comfy/workflow_api.json`, an API-format img2img + depth-ControlNet graph,
  and a dependency-free client (`/upload/image`, `/prompt`, `/history/<id>`, `/view`) with
  typed history/error handling.
- Added `tools/stylize/comfy.ts`: per-frame placeholder substitution and validation,
  upload/poll/download, fixed seed and style preset, 96² premultiplied downsample, raw
  silhouette masking, optional 1 px outline, `--dry-run`, `--palette`, `--fallback`,
  `--only`, `--limit`, and per-character directories. `assets:comfy`/`assets:comfy:dry`
  scripts added; `.gitignore` now excludes `control/` and `artifacts/`.
- Added `tools/verify/style.ts` + metrics: silhouette IoU with a 1 px outline tolerance,
  neighbour-yaw palette drift, and `artifacts/style-report.json`. Calibrated against the
  palette baseline (IoU 1.000, mean drift 4.6–5.1); thresholds 0.98 / 12.
- Added `tools/mcp/studio.ts`, a no-SDK newline-delimited JSON-RPC stdio server exposing
  `generate_character_atlas` and `regenerate_view`. It shells out with an argv array,
  validates character/frame inputs, defaults to palette fallback, and repacks/verifies.
- Tests: 43 across 6 files, including the mock ComfyUI integration test and workflow
  validation/metrics; typecheck and build clean.

### 2026-11-11 — M5 heightmap blocks, stairs, and crate occlusion

- Added `World.heights`: every solid cell stores its own surface height. Map digits `1`–`9`
  are panel platforms at `0.2 × digit`; `#`/`X` remain `WALL_HEIGHT = 1.4`.
- `supportHeight` returns the centre cell's height and `canOccupy` takes a `maxStep`, so
  the player climbs 0.2/0.4 stairs (`STEP_UP = 0.3`), is blocked by a 0.6 crate, lands on
  any surface from above, and snaps down a tread while grounded.
- `castRayHits` now returns every solid cell with its height and exit distance, and emits
  the cell under the camera at distance 0 so steep rays still hit its top.
- Replaced the single roof plane with per-cell tops: each hit scans the screen rows between
  its near/far projections and inverts the pitch projection to sample `z = height`. Every
  face renders at its own height, so low steps no longer hide walls behind them.
- Sprite stats gained an `occluded` count; the harness asserts the crate hides 1,706
  opaque scholar pixels while the upper body stays visible.
- Demo map gains a 0.4 platform with 0.2 step treads (x=10–13, y=18–21) and a 0.6 crate at
  (4.5, 13.5).
- Tests: 32 unit tests (sector heights, step limits, all-hit traversal, origin cell) and
  29 browser checks (stairs, top pixels, crate block/occlusion/landing); new screenshots
  20–26.

### 2026-11-11 — Wall landing, overhead sprites, and visual regression suite

- Walls are now solid, walkable platforms: added `WALL_HEIGHT`, `tileHeightAt`,
  `supportHeight`, and z-aware `canOccupy`. The player lands on wall tops, the HUD shows
  `PERCH · WALL 1.4 m`, and stepping off falls back to the floor.
- Removed the airborne wall-face skip. Walls render at every eye height; near-plane
  clipping (`zCam > 0.01`) keeps faces solid when pressed against or looking steeply past
  them, and per-pixel inverse projection keeps texture V correct as the span clips.
- Replaced feet/head projection with screen-aligned camera-space billboards using `zCam`.
  Overhead actors no longer collapse to a line or drift far outside the map.
- Added a fourth atlas pitch (top, elevation 1.25 rad) with a tighter 0.78 ortho scale;
  re-rendered 1152 frames (384/character) and grew atlases to 1536×2304. Raised the
  airborne pitch limit to 1.45 rad so the top band is reachable.
- Added chase and hover behaviors, five new actors (drone, wisp, stalker, prowler,
  marauder), and a relocated stalker spawn that no longer wins the nearest-actor check.
- Playtest harness now exposes `window.__raycast.debug()` with render stats and sprite
  silhouette bounds; grew from 16 to 24 checks covering airborne walls, close walls,
  look-down, overhead centring/silhouette, edge actors, wall landing, and step-off.
- Added unit tests for 4-pitch quantization, height/support/collision queries, and the
  map-edge block (27 tests total).

### 2026-11-11 — Jetpack, aerial camera, playtest, 16-way multi-character atlases

- Replaced Y-shear pitch with a true camera rotation (`projectY`, exact per-pixel 3D
  floor/roof rays) so the camera can look steeply down from altitude.
- Fixed the floor-anchoring defect: the per-pixel floor step omitted `rowDistance`
  scaling, which made the floor appear to slide with the camera.
- Added wall-top/roof plane rendering above wall height and skip wall faces there, so the
  aerial view is a solid diorama instead of floating wall slivers. Filled wall-body gaps
  where an overhead ray grazes a wall top and lands on a farther solid cell.
- Added jetpack flight: thrust, 5 s fuel, ground refuel, terminal fall, max 18 m,
  altitude-widened FOV (70°→100°), exhaust HUD, and an aerial top-down shot.
- Built `tools/playtest` (CDP harness) with 16 checks and 12 screenshots; added
  `npm run playtest` and `.qoder/agents/playtester.md`.
- Parameterized the Blender turntable for three chassis and rendered 864 frames at 16
  yaws / 3 pitches / 6 poses. Stylizer and packer now take character names, detect
  direction counts, and emit per-character atlases.
- Engine now loads guardian/scout/brute atlases and assigns a chassis, tint, and scale per
  actor; added ranger and tinker for a total of eight actors.
- Fixed standing-actor facing (camera-relative yaw sign) and verified front/back indices.
- Added the GitHub → Vercel integration; pushes to `main` now auto-deploy.

### 2026-11-11 — Vercel deployment

- Deployed the production build with `vercel --prod` under the `holy-script` account.
- Production alias: https://raycast-rosy.vercel.app
- Vercel auto-detected Vite and ran `npm run build` successfully.
- Verified the deployed page and all asset URLs; no browser console errors.
- `.vercel/` is gitignored. The GitHub repository is now connected to the Vercel project,
  so pushes to `main` deploy automatically; `vercel --prod` remains a manual fallback.

### 2026-11-11 — Initial build

- Extracted the PDF spec and translated it into engine + pipeline scope.
- Chose TypeScript/Vite/Canvas (see [DECISIONS.md](DECISIONS.md)).
- Implemented DDA raycaster, floor casting, fog, 2D depth buffer, Y-shear pitch,
  jump/gravity/fly, billboards, 8-way yaw + 3 pitch selection, tinting, shadows.
- Built the 24×24 courtyard demo with five actors (watch, idle, patrol behaviors).
- Authored Blender headless turntable renderer and generated 144 frames at 384².
- Added deterministic stylizer (4× downsample, palette quantization, outline) and atlas
  packer (768×1728, 96² frames, JSON manifest).
- Fixed: Blender sun directions, muddy palette, high-angle foot clipping
  (`frameAnchorZ`), sprite lateral sign, and outline flood-fill (immutable alpha mask).
- Added screenshot mode (`?screenshot`), docs, Git history, and a CI workflow.
- Pushed `main` to `https://github.com/holy-script/raycast.git`. The CI workflow is not
  on the remote yet: GitHub rejected it because the authenticated token lacks the
  `workflow` scope. The file is ready locally at `.github/workflows/ci.yml`.
- Verified all tests, typecheck, build, and the browser checks above.

## Known issues / limitations

- Heights are blocks grown from `z = 0`; there are no sunken floors/pits, overhangs, or
  ceilings. A full floor/ceiling sector model is deferred (not needed for this game).
- No ceiling geometry: sky is visible above the outer walls from ground level.
- Actors have no collision with the player or each other and no combat loop; chase actors
  pursue but cannot damage or be damaged.
- Actor shadows fade out above 2.5 m, so high hover actors have no visible shadow.
- Pointer lock must be entered by clicking; automated screenshots use `?screenshot`.
- The intro overlay can require a reload on a cold Vite dev start if assets race HMR.
- The playtest verifies mechanics, render statistics, and atlas wiring, not art quality;
  the playtester agent reviews the screenshots for visual regressions.
- The ComfyUI path is implemented and covered against a mock server, but no real
  checkpoint/ControlNet generation has run in this repo; start ComfyUI and supply
  `--checkpoint`/`--controlnet` to validate art quality. AutoSprite/Gamelabs is not
  implemented.
- Sprites are still masked to the Blender silhouette, so AI cannot invent limbs outside
  the render; a reference-image lock for costume details is also not implemented.

## Immediate next steps

1. Playtest the current M6 build and collect bug/feel feedback (owner).
2. Add attack/hurt/death states and a simple interaction or combat loop (`M7`).
3. Add a second map exercising the vertical layouts (M7).
4. Run a real ComfyUI pass once a server and models are available, then tune
   `--max-drift` from `artifacts/style-report.json`.
5. Optional: AutoSprite/Gamelabs adapter behind the same CLI/workflow boundary.
