# Roadmap

Milestones are ordered. A milestone is complete only when every acceptance criterion
is checked and the verification command passes. Update this file and
[PROGRESS.md](PROGRESS.md) whenever a milestone starts or finishes.

Current position: **M7 sprite-state atlas pass running; M8 polish in progress.** Combat,
interaction, doors/pickups, level transitions, and the reactor map are playable and
covered by 581 deterministic matrix checks plus a 98-check paused-state gallery. Guardian
ships all six states; scout and brute are mid-pass and fall back to idle for the new
states. M8 now has procedural audio and a real pause/settings menu (sensitivity, FOV,
mute) with persisted settings; performance profiling and the final README capture remain.

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
`npm run playtest` (suite has since grown to 29 checks).

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

## M5 — Variable-height world ✅

Goal: replace the flat floor with sectors so stairs, ledges and crates have real
collision and render heights.

Implemented as **heightmap blocks** rather than Doom-style floor/ceiling sectors: every
solid cell has its own surface height, grown from `z = 0`, and the walkable floor stays at
0. This covers stairs, platforms, crates and walls without ceilings or pits.

- [x] Height-map data model: `World.heights`, `tileHeightAt`, map digits `1`–`9`
- [x] Step-up/step-down collision (`STEP_UP = 0.3`) and grounded descent snapping
- [x] Render every hit's face at its own height with near-plane clipping
- [x] Per-cell top surfaces; origin cell emitted so steep rays under the camera stay solid
- [x] Sprites and shadows use the actor's ground height
- [x] Demo map with a 0.4 platform, 0.2 steps, and a 0.6 crate
- [x] Tests for height lookup, step limits, all-hit traversal, and origin cells

**Acceptance:** walk up and down stairs smoothly; stand on a 0.4-unit ledge; a sprite
behind a waist-high crate is correctly partially occluded; no regression in FPS. Verified
2026-11-11 by 32 unit tests and 29/29 browser checks.

Deferred: full floor/ceiling sectors (pits, overhangs, ceilings) remain out of scope; the
heightmap-block model is sufficient for this game and the second-map work in M7.

## M6 — AI stylization and MCP integration ✅

Goal: swap the palette stylizer for a generative pass while keeping the atlas contract.

- [x] Export depth/normal control images alongside each raw render
- [x] ComfyUI workflow (img2img + ControlNet depth) for consistent characters
- [x] CLI wrapper: raw RGBA → stylized RGBA with fixed seed/style preset
- [x] MCP server exposing `generate_character_atlas` and `regenerate_view`
- [x] Style consistency checks (silhouette IoU, palette drift) in a report
- [ ] Optional AutoSprite/Gamelabs Studio adapter behind the same interface — deferred;
  the ComfyUI workflow/CLI boundary is the adapter point

**Acceptance:** one command regenerates a stylized per-character atlas (384 frames); the
renderer needs no code changes; costume edits remain consistent across all view/pitch cells.

Status: `npm run assets:comfy` drives all 384 frames through `/upload/image`, `/prompt`,
`/history`, and `/view`, masks each result to the raw silhouette, downsamples to 96², and
the existing packer runs unchanged. `--palette` and `--fallback` keep the pipeline usable
without a server. `npm run assets:verify` reports IoU and neighbour-yaw palette drift.
The mock-server integration test covers the HTTP flow. The real pass has since been run
locally on Apple Silicon for all three characters (1,152 frames, 0 fallbacks, IoU 1.000,
mean drift 5.4–6.2) and the committed atlases are the AI-stylized output; see
[PIPELINE.md](PIPELINE.md#local-setup-apple-silicon-verified).

## M7 — Content and gameplay 🚧

- [x] 16-way direction mode (manifest-driven, engine index-agnostic)
- [x] Multiple characters from one pipeline with shared rig and per-spec materials
- [x] Five behaviors (idle, watcher, patrol, chase, hover) and 13 actors
- [ ] Additional states: attack, hurt, death, talk — timeline, state constants, packer
  entries, and engine selection are done; the 832 new AI frames per character and the
  repacked atlases are the remaining asset step (palette fallback works meanwhile).
- [x] Actor interaction (use/talk) and a simple combat loop (strike arc, damage, hit
  flash, knockback, death, corpse, redeploy)
- [x] Doors, pickups (keycard, medkit, fuel), and a level transition
- [x] Second map (`reactor`) with terraces, a locked vault, and a hover actor

**Acceptance:** a short playable loop with at least two enemy types and one interactive
object, all assets generated by the pipeline.

Status: the loop courtyard → keycard → locked door → reactor terraces → vault → beacon
return is playable with F/click strikes, hostile contact damage, player death/redeploy,
and E interaction. It is covered by the 90-scenario / 581-check matrix. Three hostile
specs (stalker, prowler, marauder) and four prop types are in. The remaining M7
deliverable is the AI-stylized attack/hurt/death/talk atlas repack described above.

## M8 — Polish and deployment 🚧

- [x] Audio (procedural footsteps, ambience, jet, combat, UI; mute)
- [x] Pause/settings menu, sensitivity and FOV controls, persisted settings
- [ ] Performance pass (typed-array batching, optional resolution scale)
- [x] Static hosting on Vercel — https://raycast-rosy.vercel.app
- [x] GitHub → Vercel auto-deploy on `main` (Git integration connected; CI deferred)
- [ ] Final README with gameplay capture

**Acceptance:** public URL runs the demo; every push to `main` auto-deploys; no console
errors during a five-minute play session.
