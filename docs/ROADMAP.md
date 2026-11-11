# Roadmap

Milestones are ordered. A milestone is complete only when every acceptance criterion
is checked and the verification command passes. Update this file and
[PROGRESS.md](PROGRESS.md) whenever a milestone starts or finishes.

Current position: **M4 complete — M5 next.** Jetpack flight, aerial camera, wall landing,
the browser playtest harness, 16-way sprites, and three character chassis landed early
from M7. Wall-top support (constant height) is in; variable sector heights are M5.

## M0 — Foundation

- [x] TypeScript + Vite project with strict typechecking
- [x] Vitest harness, `npm test`, `npm run build`
- [x] Repo docs, handoff format, Git remote and initial push
- [ ] GitHub Actions CI — intentionally deferred by owner decision; Vercel builds each
  push. `.github/workflows/ci.yml` exists but activation needs the `workflow` token scope.
- [x] Deterministic wall/floor texture generator
- [x] Headless browser playtest harness (`npm run playtest`)

**Acceptance:** clean clone runs `npm ci && npm run typecheck && npm test && npm run build`.

## M1 — Core raycasting renderer ✅

- [x] 24×24 ASCII world parser and solid-tile lookup
- [x] DDA traversal with perpendicular distance and `wallU`
- [x] Camera plane projection (70° FOV), textured wall strips
- [x] Floor casting with per-row texture perspective
- [x] Distance fog and side shading
- [x] 384×240 framebuffer, nearest-neighbor CSS upscale
- [x] Minimap and HUD

**Acceptance:** textured corridor renders at 60+ FPS in the browser; DDA unit tests pass.

## M2 — Vertical camera and physics ✅

- [x] Player `z` position, `vz` velocity, gravity, jump
- [x] Eye height and camera bob
- [x] True rotational pitch camera with 63° ground / 53° airborne limits
- [x] Jetpack thrust, fuel burn/refuel, terminal fall, 18-unit altitude ceiling
- [x] Altitude-widened FOV (70° → 100°) and wall-top/roof plane rendering
- [x] Fly debug mode with height clamp
- [x] Per-pixel depth buffer for walls, floor, and wall tops
- [x] Respawn and pose debug API

**Acceptance:** jump and jetpack lift/land/refuel work; mouse pitch reaches ~63° without
perspective warping; sprites remain grounded at every altitude. Verified 2026-11-11 by
`npm run playtest` (suite has since grown to 24 checks).

## M3 — Directional sprites ✅

- [x] Billboard transform into camera space
- [x] 16-way yaw quantization from `actor.facing − atan2(camera − actor)`
- [x] 4 pitch buckets (low / level / high / top) from elevation angle
- [x] Screen-aligned billboards with camera-space depth (no 1D collapse overhead)
- [x] Per-pixel sprite depth test + alpha blending
- [x] Ground shadows and per-actor RGB tint
- [x] Atlas manifest lookup with pitch/state fallbacks
- [x] Animated idle and walk states
- [x] Verified front/back (yaw 0 / 8) selection for guardian, scout, and brute

**Acceptance:** orbiting a stationary actor cycles 16 visually distinct views; raising
the camera switches to the high-angle row, and looking straight down selects the top row
with a readable silhouette. Verified 2026-11-11.

## M4 — Blender → atlas asset pipeline ✅

- [x] Headless Blender proxy rig, orthographic turntable camera
- [x] Three chassis (guardian, scout, brute) with distinct palette and proportions
- [x] 16 yaw × 4 pitch × idle(2) + walk(4) = 384 renders per character (1152 total)
- [x] Premultiplied 4× downsample to 96×96
- [x] Saturation/contrast punch, palette quantization, 1 px outline
- [x] Atlas packer auto-detects direction/pitch counts; emits per-character manifests
- [x] Engine loads and selects from multiple atlases per actor
- [x] Pipeline documented and reproducible via `npm run assets`

**Acceptance:** `npm run assets` regenerates three 1536×2304 atlases; the game loads them
without console errors and assigns chassis per actor. Verified 2026-11-11.

## M5 — Variable-height world 🚧

Goal: replace the flat floor with sectors so stairs, ledges, pits and crates have real
collision and render heights.

Landed early (2026-11-11): walls are walkable `WALL_HEIGHT` blocks with support-height
landing, z-aware collision, `PERCH` HUD, and step-off falling. That is the constant-height
half of this milestone; per-cell heights remain.

- [ ] Sector data model (floor height, ceiling height, tile kind)
- [ ] Step-up/step-down collision and grounded height from sector
- [ ] Render wall spans relative to sector floor/ceiling
- [ ] Variable-height risers and connected stairs
- [x] Sprites and shadows use the actor's ground height
- [ ] Demo map with a raised platform, stairs, and a waist-high ledge
- [x] Tests for height lookup and step limits (constant-height baseline)

**Acceptance:** walk up and down stairs smoothly; stand on a 0.4-unit ledge; a sprite
behind a waist-high crate is correctly partially occluded; no regression in FPS.

## M6 — AI stylization and MCP integration 🚧

Goal: swap the palette stylizer for a generative pass while keeping the atlas contract.

- [ ] Export depth/normal control images alongside each raw render
- [ ] ComfyUI workflow (img2img + ControlNet depth/normal) for consistent characters
- [ ] CLI wrapper: raw RGBA → stylized RGBA with fixed seed/style preset
- [ ] MCP server exposing `generate_character_atlas` and `regenerate_view`
- [ ] Style consistency checks (silhouette IoU, palette drift) in CI or a report
- [ ] Optional AutoSprite/Gamelabs Studio adapter behind the same interface

**Acceptance:** one command regenerates a stylized per-character atlas (384 frames); the
renderer needs no code changes; costume edits remain consistent across all view/pitch cells.

## M7 — Content and gameplay 🚧

- [x] 16-way direction mode (manifest-driven, engine index-agnostic)
- [x] Multiple characters from one pipeline with shared rig and per-spec materials
- [x] Five behaviors (idle, watcher, patrol, chase, hover) and 13 actors
- [ ] Additional states: attack, hurt, death, talk
- [ ] Actor interaction (use/talk), simple combat loop
- [ ] Doors, pickups, level transitions
- [ ] Second map demonstrating vertical sectors

**Acceptance:** a short playable loop with at least two enemy types and one interactive
object, all assets generated by the pipeline.

## M8 — Polish and deployment ⬜

- [ ] Audio (footsteps, ambience, UI)
- [ ] Pause/settings menu, sensitivity and FOV controls
- [ ] Performance pass (typed-array batching, optional resolution scale)
- [x] Static hosting on Vercel — https://raycast-rosy.vercel.app
- [x] GitHub → Vercel auto-deploy on `main` (Git integration connected)
- [ ] Final README with gameplay capture

**Acceptance:** public URL runs the demo; CI deploys on tagged releases; no console
errors during a five-minute play session.
