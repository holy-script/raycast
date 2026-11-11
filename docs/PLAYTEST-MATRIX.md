# Playtest matrix

`npm run playtest:matrix` drives the same headless-Chrome/CDP harness as
`npm run playtest`, but instead of one happy path it walks the game through 90
deterministic state, interaction, combat, level, and route scenarios: 490 checks plus 100
captures (92 canvas frames and 8 full-page UI overlays).

The point is coverage the owner should not have to repeat by hand — every movement axis,
vertical state, camera pitch band, collision surface, actor behavior, NPC/pickup/door
interaction, combat outcome, level transition, UI toggle, and combined route. Each
scenario asserts on live state and on what the renderer actually drew, then captures a
frame for visual review.

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
| `attack()` | Run one strike; returns true if an actor was hit. |
| `interact()` | Run one interaction; returns `none`, `talk`, `door`, `locked`, or `pickup`. |
| `loadLevel(id)` | Swap to `courtyard` or `reactor` through the deterministic loader. |
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
| Aim & sprites | `a01`–`a17` | Ground/air pitch clamps, mouse yaw/pitch, 8 camera sectors around the brute, 4 sprite pitch bands (low/level/high/top). |
| Surfaces | `s01`–`s11` | Stairs up/down, platform stand, crate block/perch, wall land/step-off/perch look-down, near-wall and near-wall look-down. |
| Actors | `c01`–`c11` | Watcher tracking, patrol advance/reverse, chase approach, hover bob, idle animation, crate/wall occlusion, overhead guard, edge actor, multi-actor aerial. |
| UI | `u01`–`u07` | Minimap toggle, HUD minimal mode, pause freeze, pause/resume, HUD values, fuel readout. |
| Routes | `r01`–`r05` | Jet over a wall, jet forward climb, aerial look-down, mid-air respawn, sprint route. |
| Interaction | `i01`–`i07` | Keycard pickup + toast, locked door refusal, door unlock (tile cleared), talk-line cycle, medkit heal, fuel refill, empty interact. |
| Combat | `f01`–`f08` | Strike hit, kill → corpse, cone rejection, range rejection, hostile damage overlay, player death → redeploy, cooldown gate, enemy wind-up timing. |
| Levels | `l01`–`l05` | Courtyard → reactor transition, vault return with reloaded state, terrace climb, reactor hover actor, beacon loop. |

Every scenario also runs universal checks: finite player/render state, sane projected
sprite rectangles, populated HUD, a non-blank rendered frame, and (for canvas captures) a
golden-pixel comparison against the previous run and zero console/page errors.

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
scenario starts from a full courtyard reload. The combat screenshots still show idle
silhouettes until the new-state atlases are repacked; that is expected and documented in
[PROGRESS.md](PROGRESS.md).

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
