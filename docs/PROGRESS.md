# Progress

Last updated: **2026-11-12**

## Status at a glance

| Area | Milestone | Status |
| --- | --- | --- |
| Toolchain, tests, docs, playtest | M0 | ✅ Complete (CI intentionally deferred) |
| DDA renderer, textures, HUD, minimap | M1 | ✅ Complete |
| Jetpack, rotational pitch, roof plane, depth | M2 | ✅ Complete |
| 16-way × 4-pitch billboard sprites | M3 | ✅ Complete |
| Blender → stylize → atlas, 3 chassis | M4 | ✅ Complete |
| Heightmap blocks: stairs, platforms, crates | M5 | ✅ Complete |
| ComfyUI / MCP AI stylization | M6 | ✅ Complete; atlases AI-stylized |
| Combat, interaction, doors, reactor map | M7 | ✅ Guardian six-state atlas shipped; scout/brute prototypes retired |
| Audio, menus, deployment | M8 | ✅ Audio, pause/settings, profiled render loop, README capture, auto-deploy; public-session check clean |
| Viewmodel and visual stability | M9 | ✅ Blender viewmodel, fixed FOV, pitch-scale compensation, wall-side depenetration, hardened playtests |
| Ranged plasma combat | M10 | ✅ Camera-aimed projectiles, marauder gunner with line of sight, impact flash, depth-tested glow billboards |
| Rooftop District | M11 | ✅ 64×64 city, 4–12 m legend towers, jetpack roof traversal, elevated sentries, hunt-gated extraction |
| Combat depth, interiors, slices | M12 | ✅ Muzzle-aligned bolts, 5 destructible crates, 7 cover props, overseer boss; office + vault sectors with ceilings/roofs and indoor flight cap; 4-band stacked-slice billboards on a separate depth atlas |
| District mission and boss | M13 | ✅ Hunt → boss → extract → clear stages, three-bolt overseer volley, rooftop cover, boss HP bar, mission-complete overlay with `E` continue; panel-clad interior walls and ceilings |
| Enemy roster and AI | M14 | ✅ Rusher, charged lancer with muzzle telegraph, frontal-armor bulwark; 117 unit tests, 784 matrix checks, all browser suites green; deployed |
| Campaign and progression | M15 | ✅ Versioned `raycast.campaign.v1` record, unlock/best-time/kills persistence, keyboard level select with briefings, `NEW BEST` victory summary; 125 unit tests |
| Audio and game feel | M16 | ✅ Pure audio mix director, per-level ambience beds, stage-driven bass/pad/percussion, boss/extract/victory cues, low-health heartbeat, `audioDebug()` hook; 133 unit tests |
| Foundry biome | M17 | ✅ SLAGWORKS 48×48 foundry, cycling slag channels, coolant collection gate, foreman boss, foundry palette; stage audio extended; 145 unit tests, 879 matrix checks |

## Verification snapshot

Run from a clean checkout:

```bash
npm ci
npm run typecheck   # passes
npm test            # 14 files, 145 tests pass
npm run build       # tsc + vite build (85.17 kB JS / 28.30 kB gzip)
npm run playtest    # 40/40 browser checks pass
npm run playtest:matrix  # 127 scenarios, 879/879 checks (743 assertions + 136 goldens), 156 captures, 0 console errors
npm run playtest:flight  # 18 poses + live jetpack, 109/109 checks, 30 captures
npm run playtest:states  # 42/42 state checks, 21 captures, 0 console errors
npm run assets:verify -- --min-iou 0.4  # 1,216-frame guardian atlas; min IoU 0.43, mean 0.90
```

The guardian's six-state atlas (1,216 frames) is the only shipped atlas; scout/brute
packed assets and tooling defaults were removed. `assets:verify` now defaults to guardian.

Asset-side verification (2026-11-11, after the M9 pass):

- Blender exports 1,216 raw frames per character (16 yaws × 4 pitches × 19 poses), each
  with depth and normal control passes; `assets:comfy --dry-run` reports no missing
  controls.
- The guardian atlas is the only shipped atlas (1536×7296, 1,216 frames, six states).
  Scout and brute packed assets, frames, and tooling defaults were removed: ~13.5 MB of
  tracked sprites and every stale frame directory is gone.
- `npm run assets:verify` compares the guardian AI frames against raw renders: mean IoU
  0.90 with a lowest frame of 0.43 in the near-overhead hurt row (the depth model
  straightens steep foreshortening), and mean neighbour-yaw palette drift 5.9 (threshold
  is mean ≤ 12). AI frames cannot meet the palette-era 0.98 per-frame floor, so the
  verification snapshot runs the tool with `--min-iou 0.4` as a regression gate.
- `tests/comfy-cli.test.ts` runs the real CLI against a mock ComfyUI HTTP server and
  verifies both uploads, the queued graph (seed 1337, SaveImage prefix), history polling,
  download, silhouette masking, and 96×96 output.
- MCP smoke test: `initialize`, `tools/list`, and a dry-run `generate_character_atlas`
  call return valid JSON-RPC with only stdout framing.

Browser verification (2026-11-11, headless Chrome over CDP):

- One atlas loads: guardian, 16 directions × 4 pitches × 1,216 frames (1536×7296), with
  no missing state frames and no retired atlas fetched.
- Movement, strafing, mouse yaw, and wall collision match screen direction.
- Jetpack lifts to 4.85 m and burns fuel, lands and refuels, holds an 18 m ceiling; pitch
  clamps at -63° on the ground and unlocks past it airborne.
- Front/back yaw selection and the 8 camera sectors verified on the guardian.
- Aerial views show a solid courtyard with wall tops, straight floor grid, visible actors,
  and sky only outside the map boundary. FOV is fixed at 70° from floor to ceiling.
- Airborne wall faces stay opaque: 384 columns / 35,120 wall pixels at altitude.
- Pressed against a wall the view stays solid (384 columns / 92,160 pixels) and survives a
  steep look-down (55,680 pixels), with no fisheye or vanishing geometry.
- Overhead sprites keep a readable silhouette and scale: the top pitch billboard is
  0.78 m through `pitchWorldScale`, so actors do not balloon as the camera rises.
- The first-person viewmodel renders over the scene in idle, strike, and recovery poses.
- The player lands beside and on walls without wedging (x ≥ 1.18 after a capsule-overlap
  drop) and can walk away freely.
- Screenshots: `docs/screenshots/playtest/01-…`; machine-readable results in
  `docs/screenshots/playtest/report.json`.
- No console errors during the checked session.
- Production deployment: https://raycast-rosy.vercel.app — HTML, atlas JSON/PNG, and
  textures all return 200; the scene renders with no console errors in headless Chrome.
- Production run (2026-11-12, M13): the live site serves `index-ClYdKduO.js` /
  `index-ifEVNW8L.css`; the happy-path playtest passes 40/40 and the external matrix run
  passes 646/646 assertions across 114 scenarios, including the boss volley, boss HUD,
  victory overlay, and `E` continue.
- Production run (2026-11-12, M14): the live site serves `index-C6EDvFgC.js` /
  `index-ifEVNW8L.css`; the deployed build reached Ready in 16 s and the happy-path
  playtest passes 40/40 with zero console errors.
- Production run (2026-11-12, M17): the live site serves `index-B1q8EU2d.js` /
  `index-BAHy215h.css`; Vercel deployment `raycast-rmj7ew67s` reached Ready in 16 s. The
  external matrix passes 743/743 assertions across 127 scenarios (including all five
  foundry scenarios) and the happy-path playtest passes 40/40, both with zero console
  errors.
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
- Production harness run (2026-11-11, after the M7 gameplay deploy): playtest 29/29 and
  matrix 490/490 against https://raycast-rosy.vercel.app/ (external-URL runs report the
  490 assertions and skip local golden comparisons). The deployed bundle hash changed to
  `index-uLO0AW2V.js`, confirming the GitHub → Vercel auto-deploy.

State-matrix verification (2026-11-11, `npm run playtest:matrix`):

- 70 deterministic scenarios / 428 checks / 70 captures pass in ~5 s, twice in a row
  with zero golden-pixel diffs and zero console errors.
- Coverage: movement axes and diagonals, wall block/slide, jump/jet/ceil/empty/fall/
  refuel/freefly, ground and air pitch clamps, mouse look, 8 sprite sectors, 4 pitch
  bands, stairs/platform/crate/wall landings, all five actor behaviors, occlusion,
  overhead/edge actors, minimap/HUD/pause/resume, and five combined routes.
- Audit fixed one engine state bug (`resetActors()` left hover actors on the floor until
  the next tick) and five scenario-expectation bugs (wall clipping the diagonal start,
  strict float fuel equality, two pitch cases selecting a nearer actor, and an rAF
  liveness failure in headless Chrome). Details in
  [PLAYTEST-MATRIX.md](PLAYTEST-MATRIX.md#first-pass-audit-2026-11-11).
- Artifacts: `docs/screenshots/matrix/contact-sheet.png`, per-scenario PNGs, and
  `report.json`.

M7 gameplay verification (2026-11-11):

- Matrix grown to **90 scenarios / 581 checks (490 assertions + 91 goldens) / 100
  captures**, all passing with zero
  console errors; three consecutive runs were identical after the deterministic level
  load (level time reset, per-actor `animTime = index × 0.37`).
- Interaction group: keycard pickup with toast, locked-door refusal, unlock (`D` cell
  cleared from the tile grid), talk-line cycle, medkit heal, fuel refill, and a no-op
  interact. Combat group: strike connects for 45, enemy hurt frame, kill → corpse still
  rendered, cone and range rejection, hostile contact damage with the red overlay,
  player death → redeploy, attack cooldown, and enemy wind-up timing.
- Level group: courtyard → reactor transition, vault return with reloaded state, terrace
  climb, reactor hover actor, and the beacon exit loop. Captures `i01`–`i07`,
  `f01`–`f08`, and `l01`–`l05` are in the contact sheet.
- Matrix extension surfaced a real state bug: `placeAtSpawn()` did not reset
  `player.attackCooldown`, so a strike queued in the previous scenario blocked the next
  one. Fixed alongside deterministic actor animation.
- Happy-path playtest still 29/29; typecheck and 50 unit tests pass; `npm run build`
  succeeds (37.6 kB JS, 13.8 kB gzip).
- Added `tests/levels.test.ts` (7 checks): square maps, walkable spawns, resolvable exit
  targets, door cells matching `D` + keycard availability, and pickups/actors on open
  floor. It caught `reactor-scout` spawning inside a terrace block at (4.5, 12.5); moved
  to the open lane at (2.5, 12.5).
- Sprite states: guardian's atlas now holds all six states; scout and brute still hold
  idle/walk until their AI passes finish, so their combat screenshots fall back to idle.
  The engine's state fallback keeps the loop working either way.

State-gallery verification (2026-11-11, `npm run playtest:states`):

- 98 checks / 43 captures pass in ~6 s with zero console errors. The gallery pauses and
  fixed-steps the player through idle, walk, jump, jet, aerial, hurt, death, and redeploy,
  and each chassis through talk early/late, walk, attack wind-up/impact, hurt, death
  early/mid, and corpse.
- Per-state checks assert the actor's resolved animation state, sprite pixel coverage
  (>200 px), and a rendered corpse; missing atlas states fail instead of silently
  falling back. This is how the scout/brute gap is tracked.
- The playtester agent critiqued the gallery: guardian states are readable and distinct.
  It flagged a detached antenna block on the attack wind-up; the resolved cell is
  `attack_f0_p1_y0`, and the raw Blender frame is clean, so this is a stylization
  artifact queued for `--only attack:0:1:0`. The earlier talk-0 concern did not
  reproduce: all talk frame-0 cells measure mean luma 47–53 and the talk captures read
  correctly, so no talk cell is queued.
- Artifacts: `docs/screenshots/states/contact-sheet.png`, 43 PNGs, `report.json`.

## Session log

### 2026-11-12 — M17 SLAGWORKS foundry biome

- `src/content/foundry-map.ts` builds a 48×48 map with perimeter walls, machinery at six
  spots, a catwalk block, and a sealed control room (`fill(30,5,6,6,"b")` shell around a
  4×4 interior, keycard door at 32,10). Spawn is the south loading bay at (24.5,44.5);
  the control-room beacon is the only extraction. `FOUNDRY_HEIGHTS` keeps the catwalk at
  6 m, and `FOUNDRY_ROOMS` gives the control room a 3 m ceiling under a 6 m roof.
- `src/engine/hazard.ts` is a pure cycle: 4 s period, 2 s hot, negative time wraps.
  `World` gains a `hazards: Uint8Array` stamped from `HazardArea[]` at creation with
  bounds and solid-cell validation; `hazardAt()` reads it. Levels declare three rows of
  slag (south channel y=31, mid channel y=20, both 46 cells wide) plus two 1×1 vents.
- `Game.tickHazards()` only damages a grounded, living player; it batches
  `HAZARD_DPS (12) × elapsed` every ≥0.25 s, toasts `SLAG BURN · CLEAR THE CHANNEL` at
  most every 1.6 s, and clears the accumulator the moment the player leaves. Jetpack
  clears channels by construction, so the route is never gated on a hazard phase.
- Renderer: `FloorHazards { hot, cold, hotNow }` swaps hazard floors between `slag-hot`
  and `slag-cold` and adds an ember tint (+30/+9/0) while hot. Each 1×1 vent grows
  stacked glow plumes that tint ember during the hot phase. The minimap paints channels
  by phase and coolant pickups in mint.
- Mission stages extend to `hunt → collect → boss → extract → clear`; `gateToast()` names
  the remaining hunters, coolant cells, then the foreman. The beacon refuses extraction
  through the same `exitsUnlocked()` gate. The boss search now uses `spec.boss`, so the
  foundry runs the foreman while the district keeps the overseer; the boss name flows
  through toasts, objectives, and the HUD.
- Victory heading is data-driven (`victory-title` + `CLEAR_LABELS`), so the foundry says
  "Foundry cleared" instead of the old hardcoded district label.
- Level surfaces are data-driven via `LevelSpec.wallTexture` and `GameAssets.walls`;
  `main.ts` loads `foundry-wall/floor/top`, `slag-hot/cold`, and `coolant`. Audio stage
  levels add `collect` at 0.45, so the coolant hunt sounds like the hunt stage.
- Tests: new `tests/hazard.test.ts` covers the cycle and negative wrap; `world.test.ts`
  covers stamping, the empty default, bounds, and solid-cell rejection; `levels.test.ts`
  covers the 48×48 surfaces, 94 walkable hazard cells, 6 hunt targets, 3 coolant cells,
  the seven-hostile-plus-foreman roster, reachability of every pickup/exit/ground actor,
  and the sealed beacon. Matrix adds `l18`–`l22`: arrival, hot-channel burn, cold-channel
  wait and reignition, coolant pickup, and the full keycard → coolant → foreman → beacon
  clear with campaign-record assertions.
- The visual review flagged three capture-timing gaps, not rendering defects: `l20` ended
  after the channel reignited, `l21` captured after the pickup, and `l22` captured after
  returning to the courtyard. `l20` now ends on the cold phase, `l21` saves
  `l21-coolant-canister` from two metres before collecting, and `l22` saves
  `l22-foundry-extract` at the beacon before `E`.
- Verification: typecheck clean, **145 unit tests**, matrix 743/743 assertions (879 checks
  with goldens) across 127 scenarios (156 captures, zero console errors), `playtest`
  40/40, `flight` 109/109, `states` 42/42, build 85.17 kB JS / 28.30 kB gzip. Goldens
  regenerated for every changed harness.
- Deployment: pushed `main` (`cc05433`, `e3ce16b`); Vercel built `raycast-rmj7ew67s` in
  16 s. Production serves `index-B1q8EU2d.js` / `index-BAHy215h.css`; the external matrix
  passes 743/743 assertions and the production happy path 40/40, zero console errors.

### 2026-11-12 — M16 audio director and game feel

- `src/engine/audio-mix.ts` is a pure `computeAudioMix(input)` over level id, indoor flag,
  mission stage, kills/targets, boss distance, health, and death. It returns the bed,
  0–1 intensity, bass/pad/percussion gains, and the low-health flag. Stage weights are
  hunt 0.45, boss 0.68, extract 0.30, clear 0.20, plus up to 0.2 for hunt progress and
  0.18 when the boss is within 24 m; death multiplies intensity by 0.4. Layer gains are
  linear in intensity (`bass 0.18 + 0.3i`, `pad 0.12 + 0.28i`, `percussion 0.05 + 0.4i`),
  and the heartbeat runs while alive at ≤34% health.
- `Soundscape` was rewritten around persistent buses: one looping noise wind into a
  lowpass carrier, a two-oscillator hum, and a bass/pad music bed. Each level has bed
  settings (cutoff, wind, hum, oscillator pair) and `applyBed` retunes them on change;
  `applyMix` crossfades the music gains. Percussion schedules from a beat timer
  (`0.62 − 0.28i` s, min 0.28 s) with a kick every beat and a hat above 0.3 intensity;
  the heartbeat fires a lub-dub every 0.9 s. All nodes are still created inside
  `unlock()`, so autoplay rules are unchanged.
- New cues: `boss` (sawtooth/square swell), `extract` (rising triangle pair), and
  `victory` (262/330/392 Hz chord plus shimmer). `Game` emits `boss`/`extract` from
  `trackMissionStage()` when the stage changes and `victory` when the beacon closes.
  Blocked plating, charged release, and kill confirms keep distinct cues from M14.
- `getDebug()` reports bed/intensity/gains/low-health/muted/running through
  `window.__raycast.audioDebug()`; automation `step`, `reset`, and `loadLevel` refresh the
  mix with `audio.update(0, game)` so headless checks never depend on frame timing.
  Without an AudioContext the director still drains events, so a later gesture cannot
  replay a backlog.
- Tests: 8 new `tests/audio-mix.test.ts` cases cover bed fallback, indoor override, stage
  ordering, hunt progress and boss proximity, intensity clamping, death damping, and the
  low-health threshold (133 unit tests total). Matrix adds `n01`–`n05`: courtyard bed,
  reactor bed, indoor bed inside the security office, boss stage lifting intensity
  0.45 → 0.88, and the heartbeat starting at 20 HP and stopping at 90.
- Verification: typecheck clean, **133 unit tests**, matrix 701/701 across 122 scenarios
  in a scratch capture dir, `playtest` 40/40, `flight` 109/109, `states` 42/42, zero
  console errors, build 78.17 kB JS / 26.45 kB gzip; goldens were regenerated with M17.

### 2026-11-12 — M15 campaign and level select

- `src/campaign.ts` owns the versioned record `raycast.campaign.v1`: `reached` ids,
  per-level `{ cleared, bestTime, bestKills, deaths }`, and `lastLevel`. `sanitizeCampaign`
  rejects unknown versions, filters unknown level ids, always keeps the courtyard
  reachable, and falls back to defaults for malformed JSON. `recordMission` only runs on a
  clear/victory report: first/slower/faster times and higher kill counts set `improved`,
  bests are min/max, and deaths accumulate per level.
- `Game` reports `onMissionClear({ levelId, time, kills, deaths })` from `checkExits` and
  `onLevelLoad(levelId)` after every `loadLevel`, so the shell never infers records from
  HUD text. `levelDeaths` resets on load and increments in `damagePlayer`.
- `main.ts` adds the campaign panel: three level cards (title, objective, stats), locked
  state, arrow/Tab/Enter/Escape flow, and a briefing with a deploy button. The intro and
  pause menus open it; `L` opens it from the victory overlay. Deploying hides overlays,
  marks the level reached, loads it, and does not un-pause scripted automation.
- The victory overlay now shows `TIME · HOSTILES DOWN · DEATHS` plus best kills/time and a
  `NEW BEST` badge when the run improved. `window.__raycast.campaign` exposes
  `load/reset/open/close/select/deploy/view` for the headless suite.
- Tests: 8 `tests/campaign.test.ts` cases cover unlock gating, reach marking, first/slower/
  faster clears, death accumulation, sanitisation of corrupt/unknown data, the mocked
  localStorage round-trip, and clock formatting (125 unit tests at that point). Matrix adds
  `u08-campaign-menu` (fresh gating, locked briefing, refused deploy, courtyard deploy,
  district unlock + persistence, close) and extends `l09-hunt-gate` with the death count,
  best badge, and persisted district record.

### 2026-11-12 — M14 enemy roster and AI

- Roster: `ActorSpec` gained `gun.charge` and `armor.front`. The district's
  `gunner-north` became `rusher-north` (45 HP, 2.6 m/s, 6-damage melee, no gun),
  `spire-se` became a lancer (95 HP, 0.9 s charged shot, 20 damage, 24 m range, 18 m/s),
  and `bruiser` became `bulwark` (180 HP, 0.85 m/s, 18-damage melee, 50% frontal
  reduction). The hunt gate is still seven non-boss hostiles plus the overseer.
- Charged wind-up: a gun's `charge` is added to `ATTACK_IMPACT` for the fire beat and to
  the attack-state minimum, so the lancer holds its pose for 1.1 s before release. The
  attack start emits a `charge` event (rising synth cue), `chargeProgress` drives a
  swelling orange muzzle glow, and `getRenderDebug().actors[].charge` exposes 0–1.
- Frontal armor: `frontalArmorScale` compares the actor facing with the hit source
  (dot > 0.34, roughly a 140° cone). Blocked hits round to at least 1, emit `blocked`
  (metallic ping), and toast `PLATING DEFLECTED · FLANK IT` at most once per 2.5 s.
  `damageActor` takes an optional source position; player bolts pass the player position,
  while automation kills omit it and stay full damage.
- Tests: `tests/math.test.ts` covers front/side/rear/zero-length/over-armored armor cases
  and `tests/levels.test.ts` locks the three role specs (117 unit tests total). Matrix adds
  `f14-lancer-charge` and `f15-bulwark-armor`.

### 2026-11-12 — M12 combat depth, tower interiors, stacked slices

- Combat depth: player bolts now leave the viewmodel muzzle at a camera-space offset
  (right 0.18 m, up −0.08 m, forward 0.35 m) instead of the eye, with an eye fallback when
  the muzzle would spawn inside solid geometry. `src/engine/crates.ts` adds 1.4 m
  destructible crates (`X`): two player bolts clear the cell, the hit count is tracked per
  cell, impacts emit debris, and the HUD toasts `CRATE DESTROYED`. Levels reset crates.
  The district now has 5 destructible crates and 7 elevated cover risers (`3`, +0.6 m on
  the tallest neighbour). A district boss `overseer` (12 m, 260 HP, 7-damage gun, 16 m
  range, 1.3 s cooldown, 1.4 rad/s turn rate) raises the hunt to 8 targets.
- Tower interiors: `createWorld` accepts `rooms: RoomSpec[]` and stamps per-cell
  `ceilings` and `roofs` after the heightmap pass, rejecting invalid or overlapping
  sectors. Two enterable sectors landed in the district: the NW security office (ceiling
  3 m under a 4 m roof) and the SE vault (ceiling 3 m under the 12 m tower), each with a
  doorway and an indoor pickup. The renderer gained a roof plane (camera above the roof),
  a lintel band on sector entry, and a ceiling plane (camera below the ceiling), reported
  through `ceilingPixels`. Indoors, `maxAltitude` is clamped to `ceiling − 1.4 m`; bolts,
  actor fire, and line-of-sight treat the slab as solid.
- Stacked slices: `tools/atlas/pack.ts` condenses the existing 1,216 384×384 depth maps
  into four depth bands, writes a separate gray `slices.png` atlas matching the color
  atlas layout, and bumps the manifest to v2 with `slices { image, bands, offsets,
  depthNear, depthFar, depthCuts }`. `drawSprite` draws the bands far→near on the same
  quad with per-band camera-space depth offsets and depth testing, so near walls cut
  through the correct layer; the base quad is used beyond 8 m. The color atlas and every
  frame stayed byte-identical.
- Verification: typecheck clean, **108 unit tests** (11 files), `playtest` 40/40,
  `playtest:matrix` 752/752 across 113 scenarios (134 captures, including `l12`–`l17`
  interiors and `f11`/`f12` combat), `playtest:flight` 109/109, `playtest:states` 42/42,
  zero console errors. `npm run build` succeeds (64.01 kB JS / 21.66 kB gzip). Visual
  review: the office shows a closed ceiling and floor, the jetpack caps below it, the
  vault roof closes from above, the crate clears after two bolts, the bolt leaves the
  projector, and close-up guardian frames show no slice seams.
- Known approximations: interior wall faces reuse the exterior facade texture (lit
  windows appear indoors), and the vault entry captures face a nearby partition. Deferred:
  interior-specific art, stairs between floors, projectile drop/penetration.
- Shipped to https://raycast-rosy.vercel.app: the production bundle is
  `assets/index-C8-wHYwk.js` (matches the local build), manifest v2 with `slices.png` is
  served, and `npm run playtest -- --url https://raycast-rosy.vercel.app` passed 40/40 with
  zero page errors. Production captures went to `/tmp/rc-prod-check`, not the repo.

### 2026-11-12 — M11 Rooftop District

- New heightmap legend in `src/engine/world.ts`: `createWorld(rows, spawn, { heights })`
  maps `a`–`e` to 4/6/8/10/12 m towers and to the facade tile (`TOWER_TILE`). Legend
  cells stay solid from the street and become walkable surfaces at their roof height;
  `canOccupy`, `supportHeight`, and `resolveFootprint` already handled the altitude.
- Added `src/content/district-map.ts`: a 64×64 city of four tower quadrants with 2-cell
  alleys, two mid-rise strips, an 8-wide north-south avenue, an open central plaza, and
  five 1.4 m crates. Authored from a deterministic rectangle generator so the layout is
  reproducible.
- Procedural `facade.png`, `asphalt.png`, and `roof.png` textures. Facade sampling repeats
  every 3 m of height so towers keep window rows at any legend height; floors and wall
  tops are now chosen per level through `floorTexture`/`topTexture`.
- Level content gained `z`: actors stand on rooftops, pickups collect in 3D, exits check
  altitude, and prop billboards render at their surface height. Pickups placed above open
  floor still validate against the surface under them.
- Four rooftop sentries, two street gunners, and one plaza bruiser (seven hostiles). The
  sentries are posted on their tower's outer roof cell; a sentry one cell inward had its
  sight line clipped by its own parapet, which the first matrix run caught.
- Hunt gating: the district declares `huntTargets: 7`; the extraction beacon refuses with
  `EXTRACTION LOCKED · n HUNTERS REMAIN` until every hostile dies, and the HUD objective
  shows the live kill count. A new courtyard gate beacon at (2.5, 22.5) enters the district;
  the district beacon at the plaza centre returns to the courtyard.
- Verification: typecheck clean, **76 unit tests** (tower legend, per-level sizes and
  elevated placement, hunt-roster consistency), `playtest` 40/40, `playtest:matrix`
  691/691 across 105 scenarios (123 captures, including `l06`–`l11` district arrival,
  posed landing, jetpack climb, sentry fire, hunt gate, and courtyard gate),
  `playtest:flight` 109/109, `playtest:states` 42/42, zero console errors.
  `npm run build` succeeds (57.4 kB JS, 19.3 kB gzip).
- Shipped to https://raycast-rosy.vercel.app: the production bundle is
  `assets/index-BBOtZrv_.js` (matches the local build), `facade.png` and `asphalt.png`
  return 200, and `npm run playtest -- --url https://raycast-rosy.vercel.app` passed
  40/40 with zero page errors. The playtest's refreshed volatile captures were reverted so
  the committed gallery reflects the local deterministic run.
- Known approximations: towers have no interiors, rooftop cover is sparse, and the crates
  are indestructible. Deferred to a later milestone.

### 2026-11-11 — Corpse outline fix, flat death pose, AI death frames

- Owner playtest: standing against a wall beside a kill showed two outlines (one large and
  translucent, one crisp), and the death pose folded downward into the floor. Diagnosis:
  close-range elevation put the corpse's frame centre inside the ±0.12 rad pitch crossfade
  band, so the billboard blended the level and high atlas rows whose baked framing differs.
- `sampleStaticPitch` now quantizes static actors to a single row (`next === index`,
  `mix === 0`); moving actors keep the crossfade. `tests/math.test.ts` locks both sides of
  every threshold.
- Re-authored `death_pose` in `render_turntable.py` as a stagger → buckle → backward topple
  ending flat. The root rotates around the feet and translates the final supine body to the
  ground plane. Prone frames need the cell width, so every pitch row renders death at a
  1.40 ortho scale; the manifest gained per-state `frameWorldSize`/`frameAnchorZ` (1.40 /
  -0.20) that `spriteSelection` and `buildSprites` read. Corpses skip `pitchWorldScale`
  (all death rows share one frame) so the body does not shrink in the top band, while living
  rows keep the 0.78 / 0.678 near-overhead compensation. Corpse contact shadows widen 1.25×.
- All 256 death frames were re-rendered with depth/normal controls and AI-stylized through
  the local SD1.5 + depth-ControlNet server to match the committed atlas. Five states were
  restored from the committed `atlas.png` rather than re-stylized with the palette fallback,
  so living-actor art is unchanged; `f02` now asserts the corpse world size (1.33 m).
- Verified from eye level, angled, wall-pinned, wall-top, and hover poses: flat, grounded,
  single silhouette, mix 0 in every band.
- Verification: typecheck clean, **71 unit tests**, `playtest` 40/40, `playtest:matrix`
  642/642 across 99 scenarios, `playtest:flight` 109/109, `playtest:states` 42/42, zero
  console errors.

### 2026-11-11 — M10 ranged plasma combat

- `F`/click now fires a plasma bolt instead of running a 2.3 m melee cone. The bolt
  spawns at the camera eye along yaw and pitch, travels 22 m/s for 0.9 s, deals 45
  damage on the first actor hit, and shares the 0.45 s attack cooldown and viewmodel
  animation with the old strike. Walking the aim across a room connects; firing at a
  wall or the floor stops the bolt there.
- New `src/engine/projectile.ts`: straight 3D segments integrated in ≤0.08 m substeps
  against the heightmap, cylinder hit tests for actors (r 0.34, h 1.2) and the player
  (r 0.26, h 1.0), and a 3D-sampled `hasLineOfSight`. `tests/projectile.test.ts` adds 12
  unit tests (wall stop, floor drop, expiry, ledge clear/block, actor/player hits, LOS).
- Marauders gained a `gun` spec: an 11-damage orange bolt, 9 m range, 1.7 s cooldown,
  9 m/s, fired only with line of sight. Melee remains the fallback at closer range; the
  existing enemy wind-up timing now also covers the shot.
- Bolts and impacts render as camera-space glow billboards using a procedural radial
  texture (`src/engine/glow.ts`), tinted cyan for the player and orange for hostiles.
  Sprites gained `noShadow` so glowing projectiles do not draw ground shadows. Impact
  flashes are backed out of the wall cell so the depth test does not cull them, and fade
  with a squared alpha over 0.14 s.
- Matrix combat rewritten around ranged mechanics: `f01` hit, `f02` kill, `f03`
  fired-away miss, `f04` 4 m travel, `f07` cooldown, `f09` wall absorption, `f10` enemy
  gunner firing and damaging the player. Retired the four melee-only goldens.
- Verification: typecheck clean, **71 unit tests**, `playtest` 40/40, `playtest:matrix`
  642/642 across 99 scenarios (114 captures), `playtest:flight` 109/109, `playtest:states`
  42/42, zero console errors. `npm run build` succeeds (49.6 kB JS, 18.1 kB gzip).
- Known approximations: bolts are gravity-free straight segments, spawn at the eye rather
  than the viewmodel muzzle, and do not penetrate or bounce.

### 2026-11-11 — M9 first-person viewmodel and visual stabilization

- Added a Blender-authored first-person viewmodel (`tools/blender/render_viewmodel.py`):
  both armored gauntlets plus a plasma projector, rendered through a perspective 35 mm
  camera to 256×208 RGBA. Five poses (idle ×2, wind-up, strike, recovery) are tracked in
  `public/assets/sprites/player/`; `render-all.sh` renders and copies them with the atlas.
- The game picks a pose from the attack cooldown (wind-up < 0.09 s, strike < 0.22 s,
  recovery < 0.36 s), adds walk bob, and composites the overlay after all world sprites.
  Draw coordinates are rounded to whole pixels because fractional writes to a
  `Uint8ClampedArray` are silently dropped (the viewmodel was invisible until fixed).
- Removed the altitude FOV boost. Projection FOV now stays 70° from the floor to the
  ceiling; the matrix asserts identical `fovDegrees`/`tanHalf` at 0 m and 16 m.
- Added `pitchWorldScale` to the atlas manifest: the near-overhead row was rendered
  through a tighter ortho frame, so its billboard shrinks to 0.678× (0.78 m) and
  crossfades with the high row. Actors now keep a stable apparent size as the camera
  rises; the matrix checks the top-pitch size.
- Hardened wall-footprint depenetration with an epsilon gap and per-iteration map-edge
  clamp. New browser regressions drop the player at x=1.05 (capsule overlapping the
  wall) and at the corner (1.05, 1.05); both eject to ≥1.18 and can walk/strafe away.
- Retired the scout/brute shipping assets and stale sprite directories; the packer,
  stylizer, verifier, MCP server, and Blender rig now default to guardian. Every actor
  still renders through the guardian six-state atlas. The state gallery and matrix were
  collapsed to guardian and their goldens regenerated.
- Verification: typecheck clean, 57 unit tests, `playtest` 40/40, `playtest:matrix`
  625/625 across 97 scenarios (stable on a second run), `playtest:states` 42/42 across
  21 captures, zero console errors. Refreshed `gameplay.png`/`courtyard.png` with
  guardian-only captures that include the viewmodel.
- Remaining approximation: the four-pitch turntable atlas plus pitch crossfade is not
  true sprite stacking. It keeps one billboard and stable depth per actor; stacked slices
  remain a deferred renderer change.

### 2026-11-11 — M8 performance, README capture, and public-session check

- Profiled the live build in headless Chrome instead of changing the renderer on a
  hunch. With all 17 courtyard actors visible: `render()` 1.9 ms (courtyard), 1.2 ms
  (reactor), 1.4 ms (15 m overhead), `drawMinimap()` 0.04 ms, `update()` under 0.01 ms.
  Over a 4.5 s idle sample the frame interval was p50 8.3 ms / p99 10.3 ms / max 10.4 ms
  on a 120 Hz display, so resolution scaling and typed-array batching were not added.
- Replaced the README hero with a ground-level courtyard capture (guardian in the
  foreground, scout down the corridor, live HUD) and refreshed the aerial courtyard shot
  used as the secondary image. Numbers are recorded in
  [ARCHITECTURE.md](ARCHITECTURE.md#performance-notes).
- Ran a five-minute scripted session against the production URL (52 play cycles, 18,267
  frames, both levels, movement/look/attack/jetpack/interact): steady 60 fps in every
  one-second sample, 0 slow samples, 0 application errors. The only console entry was a
  `/favicon.ico` 404, fixed with an inline SVG favicon in `index.html`; after the Vercel
  deploy a 45 s rerun logged zero errors (`errors: []`).
- Added `playtest:states` to the playtester agent's command list.

### 2026-11-11 — M8 procedural audio and pause/settings menu

- Added `src/engine/audio.ts`: a dependency-free WebAudio soundscape (ambience drone,
  footsteps with walk/sprint cadence, jet noise loop, strike/hit/kill/hurt/death,
  pickup/door/locked/talk/redeploy/level cues, mute). The game emits a small
  `GameEvent` queue that the soundscape drains each frame; audio stays out of game logic
  and headless runs stay silent because no gesture creates a context.
- Replaced the passive pause hint with a real pause/settings panel: mouse sensitivity
  (0.4–2.0×), FOV (55–100°), and audio mute. Settings persist in localStorage, clamp on
  load, and apply live; the minimap wedge follows the FOV.
- Pointer-lock release now actually freezes the simulation (previously actors kept
  animating behind the overlay); scripted automation is exempt so matrix timing is
  unchanged.
- Added `--resume` to `assets:comfy`: it skips frames whose output exists, so the
  interrupted 1,519-frame scout/brute pass continues instead of restarting. Combined with
  `--only state:frame:pitch:yaw`, a single pose can be regenerated for repair.
- Added `tests/settings.test.ts` (2 tests) and the `audioRunning()` debug hook. Verified
  in the browser: the panel renders, sliders update labels and persisted JSON, FOV 55 vs
  100 visibly changes the corridor and minimap wedge, and a trusted click brings the
  AudioContext to `running`.
- `playtest` 28/29 (expected atlas check), `playtest:matrix` 581/581, state gallery
  98/98, typecheck/tests/build clean.

### 2026-11-11 — State-gallery playtest harness

- Added `tools/playtest/states.ts` (`npm run playtest:states`): deterministic pause/step
  gallery that captures every player and chassis body state, composes a labelled contact
  sheet, and fails on missing states or blank sprites. 98 checks, 43 captures.
- Documented the gallery in [PLAYTEST-MATRIX.md](PLAYTEST-MATRIX.md#state-gallery) and in
  the playtester agent workflow; the agent now critiques each chassis state-by-state.
- The gallery empirically caught two guardian stylization artifacts (detached antenna in
  the attack wind-up, dark talk frame 0); the raw renders are clean.

### 2026-11-11 — Guardian six-state atlas, one-character verification

- Completed guardian's 832 new-state frames (attack/hurt/death/talk) with 0 palette
  fallbacks and packed the first 1,216-frame six-state atlas (1536×7296, 76 rows,
  6.4 MB PNG). States: idle 2, walk 4, attack 4, hurt 2, death 4, talk 3.
- In-browser checks: guardian talk NPC renders the talk cycle with dialogue; marauder
  shows hurt recoil and the four-frame death collapse with the "MARAUDER DOWN" toast;
  frame and pitch lookup resolve for all six states.
- `playtest:matrix --update-golden`: 490/490 checks across 90 scenarios. Standard
  playtest: 28/29 — the atlas-completeness check still expects 1,216 frames on scout
  and brute, which are deferred until the guardian look is confirmed.
- Owner asked to test one character before spending ~4 h on the remaining passes;
  ComfyUI and the stylizer chain were stopped after guardian. Scout stopped at
  529/1,216 and will restart from frame 1 (the stylizer has no resume flag); brute
  remains at 384.
- The machine rebooted mid-run; ComfyUI was restarted and the chain re-run until the
  owner's stop request.

### 2026-11-11 — M7 combat, interaction, doors, and reactor map

- Rebuilt the game on level definitions (`src/content/levels.ts`): `loadLevel(id)`,
  mutable world, per-level actors/spawn, pickups, exits, and title/objective copy.
  Deterministic reload resets `time`, actor animation phase, health, and cooldowns.
- Added player combat: `F`/left click strikes a 70° cone at 2.3 m for 45 damage on a
  0.45 s cooldown; actors gain HP, hurt/death states, knockback, and a corpse that holds
  the final death frame. Hostiles damage the player on contact (8–14) with a red vignette,
  death, and a 1.4 s redeploy.
- Added `E` interaction: talk lines for guard/scholar/tinker/engineer, locked-door
  refusal, door opening (clears tile + height, unlocks the vault), and auto-collected
  keycard/medkit/fuel pickups with HUD prompts and toasts.
- Added props and textures (`door`, `keycard`, `medkit`, `fuel`, `beacon`), a beacon exit
  pad, and the second 24×24 reactor map with a stepped pyramid, vault, and hover actor.
- HUD: health bar, level title, objective line, keycard status, prompt, toast, and a
  damage/death overlay. Minimap now marks doors, pickups, exits, and hostiles.
- Blender rig gained attack(4)/hurt(2)/death(4)/talk(3) poses; the packer emits all six
  states and the engine uses state-specific frame clocks (death clamps to its last frame).
- Added `tests/levels.test.ts` for level invariants; it caught `reactor-scout` spawning
  inside a terrace block in the reactor map (now at 2.5, 12.5).
- Added `tools/playtest/m7-check.ts` as a temporary end-to-end probe (27 checks, deleted
  after the matrix absorbed its coverage).

### 2026-11-11 — Deterministic state-matrix playtesting

- Added automation hooks for pause, fixed-step simulation, actor reset, fuel pinning, and
  a rAF frame counter; extracted sprite selection so `debug()` can report resolved yaw /
  pitch / frame per actor.
- Built `tools/playtest/matrix.ts` (`npm run playtest:matrix`): 70 scenarios across
  movement, vertical, aim, surfaces, actors, UI, and routes; universal state/HUD/sprite
  checks; golden frame comparison; Node-side labelled contact sheet.
- Fixed `Game.resetActors()` to spawn hover actors at cruise height, and `Browser.launch`
  to foreground the headless target so rAF keeps running; matrix re-fronts before resume.
- First-pass audit found no renderer regressions in the 70 captured frames; all failures
  were test-expectation defects except the hover reset.

### 2026-11-11 — Full AI sprite pass with ComfyUI

- Ran `assets:comfy` for guardian, scout, and brute against the local ComfyUI server:
  all 1,152 frames generated by SD1.5 + depth ControlNet, **0 palette fallbacks**, ~55 min
  per character (~2.7 h total including verification).
- `assets:verify` passes for all three: silhouette IoU 1.000 (min, with 1 px outline
  tolerance), mean neighbour-yaw drift 6.2 / 6.1 / 5.4 against the 12 limit.
- Repacked all three atlases (1536×2304); `atlas.json` manifests are unchanged, so the
  renderer needed no changes. Playtest 29/29, screenshots 01–26 regenerated.
- Committed atlases + screenshots; the AI frames themselves stay gitignored.

### 2026-11-11 — Local ComfyUI environment

- Installed ComfyUI 0.45.0 outside the repo at `~/Desktop/projects/ComfyUI` with a Python
  3.12 venv and PyTorch 2.15 (MPS). Downloaded the SD1.5 `v1-5-pruned-emaonly` checkpoint
  and the fp16 `control_v11f1p_sd15_depth` ControlNet.
- Started the server on `127.0.0.1:8188`; `/system_stats` reports MPS and 36 GB unified
  memory, and `/object_info` confirms the workflow's node classes and both model files.
- Smoke-tested `assets:comfy` twice through the real pipeline: `guardian idle:0:1:0` in
  22.1 s (cold, model load) and `idle:0:1:1` in 9.4 s (warm), both 0 palette fallbacks.
  Output frames read as consistent pixel-art guardians with the raw silhouette intact.
- Extrapolated full-pass cost: ~1 hour per 384-frame character. The full pass is **not**
  run yet; committed atlases are still palette-stylized.

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

- Heights are blocks grown from `z = 0` alongside carved room sectors. There are still no
  sunken floors/pits, overhangs, or multi-storey interior stairs; rooms are single-volume
  sectors with a ceiling and a separate roof slab.
- Interiors exist only where a level declares `rooms` (the district office and vault, and
  the foundry control room). Interior faces reuse the level's facade texture, so lit
  windows can appear on interior walls.
- Actors are non-blocking (no player/actor or actor/actor collision). Hostiles deal melee
  contact damage; marauders and sentries also fire bolts with line of sight. Actors still
  cannot push each other or the player.
- Projectiles are straight, gravity-free segments stepped in ≤0.08 m slices. They stop at
  the first wall/floor/ceiling or actor, do not penetrate, and cannot be shot down. Player
  bolts spawn at the viewmodel muzzle with an eye fallback when the muzzle is inside solid
  geometry.
- Impact flashes are glow billboards backed out of the struck cell; a point-blank hit can
  still put a large translucent orb near the screen edge.
- Actor shadows fade out above 2.5 m, so high hover actors have no visible shadow.
- Pointer lock must be entered by clicking; automated screenshots use `?screenshot`.
- The intro overlay can require a reload on a cold Vite dev start if assets race HMR.
- The playtests verify mechanics, render statistics, and atlas wiring, not art quality;
  the state gallery catches missing states and blank sprites, and the playtester agent
  reviews the captures for silhouette/pose/framing regressions.
- Guardian's AI attack wind-up had a detached antenna block in an older stylized pass;
  the current atlas frames are clean in the state-gallery captures.
- Headless Chrome only emits rAF for a foregrounded target; all harnesses front the page,
  and the matrix does so again before resume. Without it, real-time checks freeze while
  `isPaused()` still returns false.
- Matrix golden PNGs are replaced after a mismatch is reported, so the first run after a
  visual change flags every affected scenario. Review that run before committing.
- The committed atlas comes from a real SD1.5 + depth-ControlNet pass (mock-tested CLI,
  0 fallbacks). Guardian's attack/hurt/death/talk frames are complete and packed;
  scout/brute are retired. AutoSprite/Gamelabs is not implemented.
- The viewmodel is a flat 256×208 overlay drawn without depth, so it always covers world
  geometry; muzzle-flash frames can briefly cover the weapon receiver. Its Blender pose
  frames are committed, but the viewmodel has no per-altitude or per-FOV variants.
- Sprites are still masked to the Blender silhouette, so AI cannot invent limbs outside
  the render; a reference-image lock for costume details is also not implemented.
- Slag channels only damage while the player is grounded; jetpacking over them is always
  safe, and the hazard state is global (every channel is hot at the same time), so no
  per-channel phase offset exists yet.
- Foundry floor damage is batched at ≥0.25 s, so a scripted crossing can lose
  12–13 HP per batch rather than an exact 12 dps total.
- Audio is synthesized (a procedural director, no music or sample assets) and starts only
  after a user gesture; the mute state, sensitivity, and FOV persist in localStorage.
  Headless playtests never create an AudioContext, so sound is reviewed by code and
  manual play, not the harness.
- The six-state guardian atlas is 1536×7296 (~45 MB decoded); the five viewmodel frames
  add ~1 MB. Splitting the atlas per state (or per state/pitch) is the obvious
  optimization if load time or mobile memory becomes a problem.

## Immediate next steps

1. Owner playtest of M15–M17: open the level select, deploy into SLAGWORKS, and confirm
   the slag channels read hot/cold without the HUD, the coolant cells are findable, the
   foreman stage is clear, and extraction only opens after both gates. Listen for the
   per-level ambience and stage intensity lift. Confirm campaign bests persist after a
   reload. The M14 roster check (rush the rusher, read the lancer's glow, flank the
   bulwark) still applies in the district.
2. Tune the foundry in `src/content/foundry-map.ts` and `src/content/actors.ts`:
   hazard dps/period, coolant placement, foreman HP, and the vent chokepoints. Keep
   `huntTargets` at 6 and `coolantTargets` at 3.
3. Optional: per-channel hazard phase offsets, a visible channel-edge lip, and a
   dedicated foreman chassis instead of the tinted sentry.
4. Optional: stairs between interior floors and a second room per building; extend
   `RoomSpec` with an entry side and a per-room floor texture.
5. Optional: AutoSprite/Gamelabs adapter behind the same CLI/workflow boundary.
