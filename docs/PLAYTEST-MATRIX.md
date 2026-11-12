# Playtest matrix

`npm run playtest:matrix` drives the same headless-Chrome/CDP harness as
`npm run playtest`, but instead of one happy path it walks the game through 114
deterministic state, interaction, combat, level, district, interior, route, and viewmodel
scenarios: 767 checks (assertions plus golden-frame comparisons) and 137 captures
(canvas frames plus full-page UI overlays).

The point is coverage the owner should not have to repeat by hand — every movement axis,
vertical state, camera pitch band, collision surface, actor behavior, NPC/pickup/door
interaction, combat outcome, level transition, UI toggle, and combined route. Each
scenario asserts on live state and on what the renderer actually drew, then captures a
frame for visual review.

The companion `npm run playtest:flight` suite covers what a static matrix cannot: an
18-pose sweep from the ground to the 18 m ceiling plus a live jetpack burn, with
analyzers for enclosed sky holes, wall-top straightness, and overhead sprite clipping.
See [Flight suite](#flight-suite).

## Run

```bash
npm run playtest:matrix                 # local dev server on :5201
npm run playtest:matrix -- --url https://raycast-rosy.vercel.app/
npm run playtest:matrix -- --update-golden
MATRIX_OUT=/tmp/rc-matrix npm run playtest:matrix
```

Artifacts land in `docs/screenshots/matrix/`:

- `<scenario>.png` — one frame per scenario (full window for `u01`–`u03`).
- `contact-sheet.png` — 5-column sheet, labelled, composed in Node with `pngjs`.
- `report.json` — checks, captures, golden diffs, console errors, duration.

The command exits non-zero when any check fails. Use `MATRIX_OUT` (or `--url` plus
`MATRIX_OUT`) to keep production captures out of the repo.

## Determinism

The in-page automation API makes runs reproducible instead of timing-dependent:

| Hook | Purpose |
| --- | --- |
| `pause()` / `resume()` | Freeze or restore the live frame loop. |
| `step(seconds, dt=1/60)` | Advance an exact fixed number of simulation ticks while paused, then render and refresh the HUD. |
| `reset()` | Reload the courtyard, respawn the player, restore actors to authored spawns with `animTime = index × 0.37`, clear keys, refill fuel and health, reset the attack cooldown. |
| `setFuel(value)` | Pin fuel for tank/refuel/empty tests. |
| `setHealth(value)` | Pin health for hit/death overlay tests. |
| `attack()` | Fire one plasma bolt; returns false while dead or cooling down, otherwise true even if the bolt eventually misses. |
| `interact()` | Run one interaction; returns `none`, `talk`, `door`, `locked`, or `pickup`. |
| `loadLevel(id)` | Swap to `courtyard`, `reactor`, or `district` through the deterministic loader. |
| `frameCount()` | Count real rAF ticks; used to prove the live loop is alive. |
| `press` / `release` / `look` | Scripted input with no pointer lock. |

Two harness details matter when extending it:

- **Headless rAF is driven by the foreground target.** Chrome only emits animation frames
  for a foregrounded target, so the harness calls `Page.bringToFront` at launch and again
  immediately before `resume()`. Without it, real-time checks freeze a few seconds into a
  run even though `isPaused()` is false. This is a Chrome headless quirk, not a game bug.
- **Every scenario starts from `reset()`**, which reloads the courtyard and clears health,
  fuel, cooldowns, pickups, and doors. Scenarios that need the reactor call
  `loadLevel("reactor")` themselves; do not rely on state left by the previous scenario.

## Scenario catalog

| Group | IDs | Covers |
| --- | --- | --- |
| Ground movement | `g01`–`g10` | Spawn, forward/back/strafe speeds, sprint, normalized diagonal, wall block/slide, `R` respawn. |
| Vertical | `v01`–`v09` | Jump burst, jet burn + fuel drain + exhaust glow, 18 m ceiling, empty tank, fall/land, ground refuel, freefly up/down/off-fall. |
| Aim & sprites | `a01`–`a19` | Ground/air pitch clamps, mouse yaw/pitch, 8 camera sectors, 4 sprite pitch bands (low/level/high/top), fixed FOV from ground to ceiling, top-down billboard scale. |
| Surfaces | `s01`–`s13` | Stairs up/down, platform stand, crate block/perch, wall land/step-off/perch look-down, near-wall and near-wall look-down, wall-side and corner landing depenetration. |
| Actors | `c01`–`c11` | Watcher tracking, patrol advance/reverse, chase approach, hover bob, idle animation, crate/wall occlusion, overhead guard, edge actor, multi-actor aerial. |
| Viewmodel | `w01`–`w03` | Overlay coverage and idle pose, strike pose during the swing, idle recovery after cooldown. |
| UI | `u01`–`u07` | Minimap toggle, HUD minimal mode, pause freeze, pause/resume, HUD values, fuel readout. |
| Routes | `r01`–`r05` | Jet over a wall, jet forward climb, aerial look-down, mid-air respawn, sprint route. |
| Interaction | `i01`–`i07` | Keycard pickup + toast, locked door refusal, door unlock (tile cleared), talk-line cycle, medkit heal, fuel refill, empty interact. |
| Combat | `f01`–`f13` | Bolt hit, kill → corpse, fired-away miss, 4 m bolt travel, hostile melee damage overlay, player death → redeploy, cooldown gate, enemy wind-up timing, wall absorption, marauder gunner shot + damage, muzzle-aligned spawn, two-bolt crate destruction, and the overseer volley/boss HUD/cover/stage transition. |
| Levels | `l01`–`l17` | Courtyard → reactor transition, vault return with reloaded state, terrace climb, reactor hover actor, beacon loop, district arrival/landing/sentry/hunt gate with victory overlay/gate entry, and office/vault interiors with ceilings, panel walls, and roofs. |

Every scenario also runs universal checks: finite player/render state, sane projected
sprite rectangles, populated HUD, a non-blank rendered frame, and (for canvas captures) a
golden-pixel comparison against the previous run and zero console/page errors.

## State gallery

`npm run playtest:states` is the companion to the matrix: instead of one frame per
scenario, it holds the game still in every body state and captures each one. It walks
the player through idle, walk, jump, jetpack, aerial, hurt, death, and redeploy, then
walks the guardian chassis through talk early/late, walk, attack wind-up/impact, hurt,
death early/mid, and corpse. 42 checks, 21 captures (including full-page HUD/TALK/PAUSED
overlays) land in `docs/screenshots/states/` with a labelled `contact-sheet.png` and
`report.json`.

```bash
npm run playtest:states                 # local dev server on :5204
STATES_OUT=/tmp/rc-states npm run playtest:states
```

The harness asserts, per state, that the actor reports the expected animation state,
that the sprite actually drew more than ~200 pixels, and that the corpse leaves a body
on the floor. A missing state in the atlas fails loudly instead of silently falling
back to idle. It also serves as the visual-critique gallery: pass the captures to the
playtester agent and review silhouette, grounding, pose readability, attachment of
limbs/antenna, and framing.

## Flight suite

`npm run playtest:flight` is the perspective-correctness gate. It sweeps 18 poses from
ground level to the 18 m ceiling — level, shallow, steep look-down, look-up, map edge,
interior corner, wall-top hover, and straight-wall views — then flies the jetpack live:
liftoff, a 1 s burn, ceiling arrival with a look-down, release/fall, landing, and a
real-time burn. 109 checks and 30 captures land in `docs/screenshots/flight/` with
`contact-sheet.png` (geometry canvases), `page-sheet.png` (HUD + viewmodel), and
`report.json`.

```bash
npm run playtest:flight                 # local dev server on :5202
FLIGHT_OUT=/tmp/rc-flight npm run playtest:flight
npm run playtest:flight -- --url https://raycast-rosy.vercel.app/
```

Canvas captures hide the viewmodel so only world geometry is analyzed; full-page captures
keep the HUD, minimap, and weapon for composition review. The harness classifies every
pixel against a replica of `buildSky` and fails when an enclosed sky run appears below
geometry (the old column-shear renderer produced 258 bad columns and 4,470 hole pixels in
the top-pitch frame). It also fits the first non-sky row across 264 columns of a straight
wall top and fails above 1.5 px residual (old renderer: 49.4 px; per-pixel renderer: 0.00),
asserts the overhead scholar keeps `contentW > 18`, `contentH > 16`, and >250 opaque
pixels inside the frame, and requires the live loop to sustain at least 45 FPS with no
page errors. Sky runs that reach the bottom of the frame are ignored because they are the
void beyond the floating map, not holes.

Flight captures are intentionally not golden-compared: actors move between scenarios and
page overlays are volatile. The structural analyzers catch the geometry regressions while
the sheets are there for visual review.

## Golden frames

Canvas captures are compared to the existing PNG in `docs/screenshots/matrix/` with a
0.2% pixel tolerance (channel tolerance 4). A mismatch is reported before the new frame
replaces the old one, so the first run after a visual change flags every affected
scenario. Re-running after review accepts the new frames; pass `--update-golden` to accept
them explicitly in one pass. Live-time scenarios (`pause/resume`, UI captures) are marked
volatile and skip comparison.

## First-pass audit (2026-11-11)

The initial 70-scenario run surfaced six failures. Five were test-expectation defects,
one was an engine state-reset defect:

| Scenario | Symptom | Cause | Fix |
| --- | --- | --- | --- |
| `g07` | Diagonal moved `dx 1.06, dy 0.28` | Start cell put the southeast vector into the row-5 wall; collision blocked `y`. | Start at `(5.5, 3.5)`, an open 1.5 m diagonal run. |
| `v04` | Fuel `0.00` but `fuel === 0` false | Three floating-point fuel ticks left +1.7e-18. | Assert `fuel < 0.005` and HUD `0%`. |
| `a14` | Nearest actor was `patrol`, pitch 1 | Patrol at y=14.5 was closer than the drone from the old camera. | Camera at `(11.5, 7.5)`, 2 m from the drone. |
| `a16` | Nearest actor was `ranger`, pitch 3 | Ranger at 2 m was closer than the guard at 6 m. | Camera at `(4.5, 1.5, 3)`, guard 3 m away. |
| `a17` | Same | Same | Altitude 12 m from the same guard-side camera. |
| `u05` | 0 frames after resume | Headless target lost foreground; rAF stopped. | `Page.bringToFront` in the launcher and before `resume()`. |
| `a14` pitch | Drone reported pitch 1 at 2 m | `resetActors()` zeroed hover height, so the drone sat on the floor until the first tick. | Reset hover actors to `spec.hover.height`. |

The visual audit of the 70 frames found no renderer regressions: stairs, wall tops,
occlusion, 16-way facing, pitch bands, and aerial silhouettes all match the existing
playtest behavior. Several frames are intentionally close-up walls (`g04`, `s04`, `s10`)
because the scenario is testing collision or a surface, not composition.

## M7 extension audit (2026-11-11)

Growing the matrix from 70 to 90 scenarios surfaced one real engine bug plus three
capture/test defects:

| Scenario | Symptom | Cause | Fix |
| --- | --- | --- | --- |
| `f02` | Second strike left the enemy at 25 hp | `placeAtSpawn()` reset health but not `player.attackCooldown`, so `f01`'s cooldown leaked into `f02` and the first strike was swallowed. | Reset `attackCooldown` (and `hitFlash`) in `placeAtSpawn()`; `loadLevel` uses it. |
| `i02` | Door capture had only 6 colours (flat fill) | Camera looked straight at the door tile, so no wall/floor context entered the frame. | Yaw offset `0.35` to keep wall geometry beside the door. |
| `f05` | Damage overlay read `0.00` | Computed opacity was still mid-transition; the inline value is the source of truth. | Read `element.style.opacity` instead of `getComputedStyle`. |
| `i04` | TypeScript `noUnusedLocals` failure | Captured `second` line but never asserted on it. | Include `second === "talk"` in the check. |

Two determinism fixes were required before goldens could be trusted: level loads now set
`time = 0` and per-actor `animTime = index × 0.37` (instead of `Math.random()`), and every
scenario starts from a full courtyard reload. A later M9 pass retired the scout/brute
chassis, and the guardian's six-state atlas now backs every combat and talk capture.

## M10 ranged combat extension (2026-11-11)

Moving from a melee cone to projectiles grew the matrix to 99 scenarios / 642 checks and
rewrote the combat group. The bolt scenarios are deterministic because time only advances
through `step()` and damage resolves on the first substep that overlaps a target:

| Scenario | Assertion |
| --- | --- |
| `f01-player-shot` | A fired bolt reduces the stalker from 70 to 25 hp and switches it to `hurt`. |
| `f02-player-kill` | A second bolt after 0.5 s kills it (death + `STALKER DOWN`); the corpse stays rendered but drops out of targeting, keeping the 1.40-prone-frame world size (1.33 m for the 0.95-scale stalker). |
| `f03-bolt-miss` | Firing 180° away still returns `true` but leaves hp at 70. `attack()` reports firing, not hitting. |
| `f04-bolt-travel` | A 4 m lane hit at 0.25 s proves travel time, not hitscan. |
| `f07-fire-cooldown` | Two immediate calls return `true` then `false`; only one bolt lands. |
| `f09-bolt-blocked` | From `(11.5, 4.5)` facing `−π/2` into the boundary wall, the bolt is absorbed and `debug().bolts` is empty. |
| `f10-enemy-gun` | A marauder at 9 m fires within 0.5 s (`bolts` includes `fromPlayer: false`), then the bolt lands for damage (`hp < 100`, flash > 0). |

Capture notes from the first pass: a point-blank wall hit bloomed into a large blocky
orb, so `f09` now fires from an open lane 3.5 m from the boundary wall and steps 0.25 s;
the glow texture was raised to
32 px, impact growth capped at 0.55 m, and alpha squared. The enemy bolt initially merged
with the orange marauder silhouette, so `f10` captures at 0.5 s (bolt ~0.95 m from the
camera) before stepping another 0.4 s to assert the damage.

## M11 Rooftop District extension (2026-11-12)

The district added six level scenarios (matrix now 105 scenarios / 691 checks). They cover
verticality and the hunt gate without relying on live combat:

| Scenario | Assertion |
| --- | --- |
| `l06-district-arrival` | The loader reports `district` / `ROOFTOP DISTRICT`, spawn is `(32.5, 58.5)` on support 0, the objective reads `0/8`, and five elevated actors sit at 8/12 m (including the overseer). |
| `l07-rooftop-landing` | Dropped above the 4 m NW tower, the player settles at `z ≈ 4`, `support ≈ 4`, and the HUD reads `PERCH · 4.0 m`. |
| `l08-sentry-los` | From the plaza at `(6.5, 30.5)`, the NW sentry fires a bolt whose origin is above 6.5 m — sight lines work from roof edge to street. |
| `l09-hunt-gate` | Standing on the beacon before the hunt toasts `EXTRACTION LOCKED · 8 HUNTERS REMAIN` and stays in the district; after eight hostile deaths, the same step extracts to the courtyard. |
| `l10-jetpack-roof` | Holding Space for 0.8 s then W for 0.35 s from the alley climbs onto the 4 m roof and ends in a perch. |
| `l11-district-gate-entry` | The courtyard gate at `(2.5, 22.5)` loads the district. |

The first run caught a real placement bug: a sentry one cell inside its tower roof had its
downward sight line clipped by its own parapet, so `l08` saw zero bolts. Sentry specs now
sit on outer roof cells. The courtyard gate originally sat at `(22.5, 22.5)`, on the state
gallery's marauder pose, and silently hijacked the combat captures — it moved to
`(2.5, 22.5)`.

## M12 combat depth, interiors, and slices extension (2026-11-12)

M12 added eight scenarios (matrix now 113 scenarios / 752 checks / 134 captures). Two
cover the combat-depth track, six cover interiors from the street, the air, and the roof:

| Scenario | Assertion |
| --- | --- |
| `f11-muzzle-spawn` | Firing from `(5.5, 4.5)` spawns the player bolt at `(5.85, 4.68, 0.47)` — the viewmodel muzzle, not the eye at 0.55 m. |
| `f12-crate-destroy` | The district crate at `(34, 9)` starts solid at 1.4 m; one bolt leaves it standing, the second clears tile and height and toasts `CRATE DESTROYED`. |
| `l12-office-entry` | Walking west through the `(2, 6)` doorway lands on the office floor; the player reports ceiling 3 m / roof 4 m; looking up paints >12,000 ceiling pixels. |
| `l13-office-medkit` | The office medkit at `(6.5, 4.5)` is collected indoors and heals 50 → 90. |
| `l14-vault-entry` | Walking north through `(55, 60)` enters the vault (`y` 57.8–59.4) under a 3 m ceiling with the 12 m roof above. |
| `l15-vault-fuel` | The vault fuel cache at `(54.5, 55.5)` refills an empty jetpack to 1.0. |
| `l16-ceiling-jet-cap` | Holding Space indoors caps altitude at 1.60 m (`ceiling − 1.4`), and releasing lands back on the interior floor. |
| `l17-roof-over-vault` | Standing on the vault roof at 12 m and looking down shows the roof slab (`topPixels > 6000`, zero ceiling pixels). |

The first M12 run caught a duplicate-medkit lookup: `l13` matched the rooftop medkit at the
same `x = 6.5`, so the check now matches both `x` and `y`. Interior captures also confirmed
that the sky visible through a room is the open doorway sightline, not an enclosed hole.

## M13 mission and boss extension (2026-11-12)

M13 adds `f13-boss-encounter` and extends existing scenarios (matrix now 114 scenarios /
767 checks / 137 captures):

| Scenario | Assertion |
| --- | --- |
| `f13-boss-encounter` | Standing on the overseer's 12 m roof facing it yields ≥3 inbound bolts above the roof, the boss row reads `OVERSEER` at ≤260 HP within 24 m, both cover risers are solid at 12.6 m, and killing the seven non-boss hostiles flips the stage to `boss` with an overseer objective. |
| `l09-hunt-gate` | The locked beacon names the seven remaining hunters; killing them raises the victory overlay (`TIME mm:ss · 7 HOSTILES DOWN`); `E` returns `"continue"` and loads the courtyard. |
| `l12-office-entry` | Adds an interior wall pose: 73k+ panel pixels, zero exterior-facing wall pixels, zero ceiling/top pixels. |
| `f12-crate-destroy` | Adds a first-hit check: one bolt leaves the crate standing, toasts `CRATE CRACKED`, and emits two impact puffs. |
| `f10` / `l08` | Re-assert enemy bolt flight after the volley change: the marauder's bolt and the rooftop sentry's high bolt both survive long enough to be observed. |

The first M13 run caught a real trajectory regression. The volley refactor passed a unit
horizontal direction with the unscaled vertical delta, so `spawnProjectile` normalized the
steep component and every enemy bolt nosed into the floor within ~0.5 s. `f10`, `f13`, and
`l08` all reported zero/near-zero bolts in flight; a scratch CDP probe showed bolt `z`
dropping `0.73 → 0.12` while the player stayed at 100 HP. `fireActorBolt` now divides the
vertical delta by the horizontal distance, restoring the shallow aim. Two test defects
were fixed at the same time: the `f13` kill loop read `actor.hostile` instead of
`actor.spec.hostile`, and `l09` checked the victory overlay before the 0.67 s boss death
animation finished.

Owner follow-up (2026-11-12, matrix now 114 scenarios / 767 checks): the minimap still
mirrored strafing because only the heading had been flipped in the previous fix; the map
now mirrors world x for tiles, pickups, exits, actors, and the player, and
`tests/math.test.ts` locks both the heading and point projection. `f02-player-kill` also
asserts that re-hitting a dying enemy does not restart its death animation: after
0.3 s the death frame is 2, an extra 999-damage hit leaves it at frame 2 instead of
resetting to 0.

## Extending it

```ts
define("group", "x01-short-name", async () => {
  await pose(5.5, 4.5, 0, 0, 0);
  await press("KeyW");
  await step(0.5);
  await release("KeyW");
  const current = await state();
  check("what must be true", near(current.x, 5, 0.06), `x=${current.x.toFixed(2)}`);
});
```

Guidelines:

- Start from open floor and check the map for walls between start and end; a clipped
  movement axis looks like a physics bug.
- For actor-facing assertions use `debug().actors` (resolved `yawIndex`/`pitchIndex` for
  every actor) or `state().nearest*`, and confirm which actor is actually nearest.
- Prefer state assertions (`state()`, `debug()`) over pixel diffs for physics; use pixel
  diffs to prove that a live or animated frame changed.
- Mark real-time scenarios `volatile` and give them a visible moving actor; a static wall
  cannot prove that the simulation advanced.
- Aim cameras at the actor or surface under test so the screenshot is auditable.
