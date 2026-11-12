# Roadmap

Milestones are ordered. A milestone is complete only when every acceptance criterion
is checked and the verification command passes. Update this file and
[PROGRESS.md](PROGRESS.md) whenever a milestone starts or finishes.

Current position: **M0–M13 complete and deployed.** Ranged combat, interaction, doors/pickups,
level transitions, the reactor map, and the Rooftop District are playable and covered by
766 deterministic matrix checks (114 scenarios), a 40-check happy-path run, a 109-check
flight sweep, and a 42-check paused-state gallery. The guardian is the only shipped
chassis, with all six states in a 16×4×19 atlas; the scout and brute prototypes were
removed until their art pass exists. M8 delivered procedural audio, a pause/settings menu
(sensitivity, FOV, mute) with persisted settings, a profiled render loop, and a clean
five-minute production session. M9 added the first-person viewmodel and the
visual-stability pass. M10 made the plasma projector fire straight projectiles, added a
marauder gunner with line of sight, and rendered depth-tested glow impacts. The playtest
follow-up re-authored the death animation as a flat backward topple, gave the corpse its
own pitch-static frame, and removed the near-wall double silhouette. M11 takes the same
movement and combat into a 64×64 city: legend-height towers, jetpack rooftop traversal,
elevated sentries, and a hunt-gated extraction. M11 shipped on 2026-11-12. M12 adds combat
depth (muzzle-aligned bolts, destructible crates, a district boss), enterable tower
interiors with ceilings and roofs, and stacked-slice sprite impostors. M13 turns the
district into a staged mission: hunt, boss, extraction, and a victory overlay, with a
three-bolt overseer volley and rooftop cover. M13 is complete locally.

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

## M11 — Rooftop District ✅

Goal: take the jetpack and the plasma projector out of corridor mazes and into a
city-scale arena where height is part of the map.

- [x] Heightmap legend: map characters `a`–`e` author solid towers at 4/6/8/10/12 m;
  legend cells render through the facade texture, stay solid from the street, and become
  walkable surfaces on their roof (`createWorld(rows, spawn, { heights })`)
- [x] 64×64 district map: four tower quadrants with 2-cell alleys, two mid-rise strips, an
  8-wide north-south avenue, an open central plaza, and five 1.4 m street crates
- [x] New facade, asphalt, and roof textures selected per level through
  `floorTexture`/`topTexture`; facade sampling repeats every 3 m of height
- [x] Elevation-aware content: `z` on actor, pickup, and exit specs; 3D pickup collection;
  landing and walking support on tower tops
- [x] Four rooftop sentries posted on outer roof cells (their sight line must clear the
  parapet), two street gunners, and one plaza bruiser; gun-only hostiles supported
- [x] Hunt gating: `huntTargets` keeps extraction locked and reports the remaining hunters
  until every hostile dies
- [x] Courtyard → district gate beacon and district → courtyard extraction; the HUD
  objective shows the live `killed/targets` count
- [x] Deterministic coverage: tower-legend unit tests, per-level size/elevation tests, and
  matrix scenarios `l06`–`l11` for arrival, posed and jetpack rooftop landings, sentry
  fire from above, the hunt gate, and the courtyard gate

**Acceptance:** `npm run typecheck`, 76 unit tests, `npm run build`, `npm run playtest`
(40/40), `npm run playtest:matrix` (691/691 across 105 scenarios, 123 captures),
`npm run playtest:flight` (109/109), and `npm run playtest:states` (42/42) pass with zero
page errors; captures show the avenue canyon, a rooftop perch, a sentry firing down from a
roof edge, and the locked extraction toast. Verified 2026-11-12. Deployed the same day to
https://raycast-rosy.vercel.app (`index-BBOtZrv_.js`); the production playtest passes
40/40 against the live build.

Deferred: indoor tower floors, rooftop cover props, destructible crates, and a district
boss. The district is an outdoor arena; tower interiors remain future work.

## M12 — Combat depth, tower interiors, stacked slices ✅

Goal: make the city fight read spatially — shots leave the gun, cover can be broken,
buildings can be entered, and sprites gain real volume at close range.

**Combat depth**

- [x] Player bolts spawn at the viewmodel muzzle (right 0.18 m, up −0.08 m, forward
  0.35 m) with an eye fallback when the muzzle would sit inside solid geometry
- [x] Destructible crates (`X`, 1.4 m): two player bolts clear the cell, impacts emit
  debris, and the HUD toasts `CRATE DESTROYED`; crates reset with the level
- [x] Rooftop cover props (`3`): seven 0.6 m cover risers on support surfaces, walk-over
  height, usable as shooting cover
- [x] District boss `overseer` at 12 m: 260 HP with a 1.4 rad/s turn rate; the hunt
  requires seven non-boss hostiles (M13 extends the gun into a three-bolt volley)
- [x] Muzzle spawn (`f11`) and crate destruction (`f12`) matrix scenarios

**Tower interiors**

- [x] `rooms: RoomSpec[]` in `createWorld` stamps per-cell `ceilings` and `roofs`; room
  bounds, ordering, and overlap are validated
- [x] Two enterable sectors in the district: the NW security office (ceiling 3 m, roof
  4 m) and the SE vault (ceiling 3 m, roof 12 m), each with a doorway, indoor pickup,
  and interior walls
- [x] Renderer draws the roof slab from above, a lintel band when a ray enters a carved
  cell between ceiling and roof, the ceiling plane from below, then the normal block face
- [x] Indoor flight cap: `maxAltitude` is clamped to `ceiling − PLAYER_HEIGHT`; bolts,
  actor fire, and line-of-sight treat the slab as solid
- [x] Matrix scenarios `l12`–`l17` for doorway entry, ceilings, indoor pickups, the
  jetpack cap, and the roof closing from above

**Stacked-slice sprites**

- [x] Four depth bands packed from the 1,216 existing 384×384 depth-control maps into a
  separate gray `slices.png` atlas that mirrors the color atlas layout
- [x] Manifest v2 adds `slices { image, bands, offsets, depthNear, depthFar, depthCuts }`;
  manifests without slices keep the single-quad path
- [x] Billboards draw bands far→near on the same quad with per-band camera-space depth
  offsets and depth testing, so near walls cut through the correct layer; LOD keeps the
  base quad beyond 8 m
- [x] Color atlas and frames are byte-identical to M11; only the slice atlas is new

**Acceptance:** `npm run typecheck`, 108 unit tests, `npm run build` (64.01 kB JS),
`npm run playtest` (40/40), `npm run playtest:matrix` (752/752 across 113 scenarios, 134
captures), `npm run playtest:flight` (109/109), and `npm run playtest:states` (42/42)
pass with zero page errors. Captures show the office ceiling and floor, the capped indoor
jetpack, the roof over the vault, a destroyed crate, the muzzle-aligned bolt, and clean
guardian close-ups without slice seams. Verified 2026-11-12. Deployed the same day to
https://raycast-rosy.vercel.app (`index-C8-wHYwk.js`); the production playtest passes 40/40
against the live build and serves manifest v2 with `slices.png`.

Deferred: interior-specific wall/ceiling art beyond the shared panel cladding, stairs
between floors, multi-room buildings, projectile drop/penetration, and per-band slice
lighting.

## M13 — District mission and boss encounter ✅

Goal: give the district a beginning, a climax, and a clean exit instead of a single hunt
counter.

**Mission stages**

- [x] `MissionStage = "hunt" | "boss" | "extract" | "clear"` derived from the non-boss
  kill count, the live overseer, and the victory flag
- [x] The HUD objective follows the stage: live `killed/targets` during the hunt, a boss
  directive once the hunt clears, the extraction objective after the overseer falls, and
  the level objective when the mission is complete
- [x] A refused exit names the blocker (`N HUNTERS REMAIN` or `OVERSEER ACTIVE`)
- [x] Exits unlock only when the hunt is complete **and** the overseer is no longer alive
- [x] Reaching the unlocked beacon raises a mission-complete overlay (clock and hostile
  count) instead of instantly leaving; `E` continues to the courtyard
- [x] The victory overlay freezes simulation, mission clock, and input so the result
  cannot be lost to a stray enemy bolt

**Boss encounter**

- [x] The overseer fires a three-bolt horizontal volley (5 dmg, 18 m range, 1.7 s
  cooldown, 11 m/s, ±0.12 rad fan) aimed at the player's chest
- [x] `volleyAngles` fans shots symmetrically around the aim angle and is unit tested
- [x] Two 12.6 m cover risers flank the overseer's 12 m roof; the district carries nine
  cover cells in total
- [x] A boss HUD row shows name, HP, and distance within 24 m
- [x] The overseer is excluded from `huntKills`, so the boss stage cannot be skipped
- [x] First crate hit emits debris and toasts `CRATE CRACKED` before the destroying shot

**Verification**

- [x] `tests/levels.test.ts` locks the mission gate (7 hunt targets, 8 hostiles, 1 boss),
  the volley gun spec, and the nine cover cells; `tests/projectile.test.ts` covers the
  volley fan
- [x] Matrix `f13-boss-encounter` asserts the volley, boss HUD, cover heights, and the
  hunt→boss stage transition; `l09-hunt-gate` asserts the victory overlay, its stats,
  and `E` returning to the courtyard
- [x] Enemy bolts keep their shallow trajectory after the volley refactor: the vertical
  slope is computed per horizontal metre so shots no longer nose into the floor

**Acceptance:** `npm run typecheck`, 112 unit tests, `npm run build` (66.86 kB JS),
`npm run playtest` (40/40), `npm run playtest:matrix` (766/766 across 114 scenarios, 137
captures), `npm run playtest:flight` (109/109), and `npm run playtest:states` (42/42)
pass with zero page errors. Captures show the overseer and its boss bar, the mission
overlay, the panel-clad office walls and ceiling, and the victor overlay. Verified
2026-11-12 and deployed to https://raycast-rosy.vercel.app.

Deferred: dedicated boss art (the overseer reuses the guardian chassis with a red tint),
phase changes or telegraphed attacks, a mission-select screen, and persistent campaign
progress.
