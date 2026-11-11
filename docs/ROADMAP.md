# Roadmap

Milestones are ordered. A milestone is complete only when every acceptance criterion
is checked and the verification command passes. Update this file and
[PROGRESS.md](PROGRESS.md) whenever a milestone starts or finishes.

Current position: **M0–M10 complete locally.** Ranged combat, interaction, doors/pickups,
level transitions, and the reactor map are playable and covered by 642 deterministic
matrix checks (99 scenarios), a 40-check happy-path run, a 109-check flight sweep, and a
42-check paused-state gallery. The guardian is the only shipped chassis, with all six
states in a 16×4×19 atlas; the scout and brute prototypes were removed until their art
pass exists. M8 delivered procedural audio, a pause/settings menu (sensitivity, FOV,
mute) with persisted settings, a profiled render loop, and a clean five-minute production
session. M9 added the first-person viewmodel and the visual-stability pass. M10 makes the
plasma projector fire straight projectiles, adds a marauder gunner with line of sight, and
renders depth-tested glow impacts. The playtest follow-up re-authored the death animation
as a flat backward topple, gave the corpse its own pitch-static frame, and removed the
near-wall double silhouette. M10 is complete and deployed.

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
- [x] Wall-top/roof plane rendering (the altitude FOV boost was removed in M9: it caused
  edge stretching/fisheye, so projection FOV now stays fixed at every altitude)
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
- [x] Verified front/back (yaw 0 / 8) selection on the guardian atlas

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
- [x] Additional states: attack, hurt, death, talk — timeline, state constants, packer
  entries, engine selection, and the AI-stylized repack for the guardian atlas.
- [x] Actor interaction (use/talk) and a simple combat loop (strike arc, damage, hit
  flash, knockback, death, corpse, redeploy)
- [x] Doors, pickups (keycard, medkit, fuel), and a level transition
- [x] Second map (`reactor`) with terraces, a locked vault, and a hover actor

**Acceptance:** a short playable loop with at least two enemy types and one interactive
object, all assets generated by the pipeline.

Status: the loop courtyard → keycard → locked door → reactor terraces → vault → beacon
return is playable with F/click plasma bolts, hostile melee and gunfire, player
death/redeploy, and E interaction. It is covered by the 99-scenario / 642-check matrix. Three hostile
specs (stalker, prowler, marauder) and four prop types are in. All actors render through
the guardian atlas; the scout/brute prototypes were removed from shipping assets until a
future art pass.

## M8 — Polish and deployment ✅

- [x] Audio (procedural footsteps, ambience, jet, combat, UI; mute)
- [x] Pause/settings menu, sensitivity and FOV controls, persisted settings
- [x] Performance pass — profiled instead of guessed: `render()` peaks at 1.9 ms and
  p99 frame interval is 10.3 ms on a 120 Hz display, so no resolution scale is needed
  (numbers in [ARCHITECTURE.md](ARCHITECTURE.md#performance-notes))
- [x] Static hosting on Vercel — https://raycast-rosy.vercel.app
- [x] GitHub → Vercel auto-deploy on `main` (Git integration connected; CI deferred)
- [x] Final README with gameplay capture

**Acceptance:** public URL runs the demo; every push to `main` auto-deploys; no console
errors during a five-minute play session.

## M9 — First-person viewmodel and visual stability ✅

Goal: close the gap between a raycasting tech demo and a readable first-person game,
using only the existing 2.5D renderer.

- [x] Blender-authored viewmodel: both gauntlets plus a plasma projector, rendered with a
  perspective 35 mm camera to 256×208 RGBA frames
- [x] Pose set (idle ×2, wind-up, strike, recovery) driven by the attack cooldown, with
  walk bob and integer-pixel overlay compositing after all world sprites
- [x] Fixed projection FOV at every altitude (the old +30° boost caused edge stretching)
- [x] Per-pitch billboard scale so the near-overhead turntable frame keeps a stable
  apparent actor size (`pitchWorldScale` in the manifest)
- [x] Wall-side and corner landing depenetration plus map-edge clamping
- [x] Retire scout/brute shipping assets; every actor renders through the guardian atlas
- [x] Playtests assert the viewmodel pose/coverage, fixed FOV, top-down scale, atlas
  completeness, and wall-side escape
- [x] Refreshed gameplay/aerial captures and guardian-only state gallery

**Acceptance:** `npm run typecheck`, 57 unit tests, `npm run playtest` (40/40),
`npm run playtest:matrix` (625/625), and `npm run playtest:states` (42/42) pass with no
page errors; the README captures show the viewmodel and clean wall tops. Verified
2026-11-11.

Deferred: true stacked-slice sprite rendering. The four-pitch turntable atlas plus
crossfade is the current approximation; it keeps one billboard per actor and stable
depth, while sprite stacking would trade that for many thin layers per actor.

## M10 — Ranged plasma combat ✅

Goal: make the plasma projector the viewmodel promised actually fire, and give the
existing enemies a ranged threat that respects walls.

- [x] Projectile simulation (`src/engine/projectile.ts`): straight 3D segments stepped in
  ≤0.08 m slices against the heightmap, cylinder hit tests for actors and the player,
  expiry, and 3D-sampled line of sight
- [x] Player bolt: 22 m/s, 0.9 s life, 45 damage, fired from the camera along yaw/pitch
  on the shared 0.45 s cooldown
- [x] Marauder gunner: 11-damage bolt, 9 m range, 1.7 s cooldown, 9 m/s, fires only with
  line of sight; melee remains the close-range fallback
- [x] Glow rendering: procedural radial texture, camera-space additive-looking billboards,
  cyan/orange tint, `noShadow`, and an impact flash backed out of the struck cell
- [x] Deterministic coverage: `f09` wall absorption, `f10` gunner wind-up and damage,
  plus 12 projectile unit tests
- [x] Corpse pass from playtest feedback: backward-topple death at a dedicated 1.40 m
  frame, static pitch band for bodies, flat grounded pose, single silhouette at walls
- [x] Audio cues for player and enemy shots; pause/intro copy updated

**Acceptance:** `npm run typecheck`, 71 unit tests, `npm run build`, `npm run playtest`
(40/40), `npm run playtest:matrix` (642/642 across 99 scenarios), `npm run playtest:flight`
(109/109), and `npm run playtest:states` (42/42) pass with zero page errors; captured
frames show the player impact flash, a blockable wall hit, and a visible enemy bolt.
Verified 2026-11-11.

Deferred: muzzle-aligned spawn, projectile gravity/drop, penetration, and destructible
projectiles. Bolts are intentionally straight so aim and travel stay readable.
