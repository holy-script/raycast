# Playtest matrix

`npm run playtest:matrix` drives the same headless-Chrome/CDP harness as
`npm run playtest`, but instead of one happy path it walks the game through 70
deterministic state and route scenarios: 428 checks plus 70 screenshots (67 canvas frames
and 3 full-page UI captures).

The point is coverage the owner should not have to repeat by hand — every movement axis,
vertical state, camera pitch band, collision surface, actor behavior, UI toggle, and
combined route. Each scenario asserts on live state and on what the renderer actually
drew, then captures a frame for visual review.

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
| `reset()` | Respawn the player, restore actors to authored spawns and a shared `animTime = 0`, clear keys, refill fuel. Hover actors return to cruise height, not the floor. |
| `setFuel(value)` | Pin fuel for tank/refuel/empty tests. |
| `frameCount()` | Count real rAF ticks; used to prove the live loop is alive. |
| `press` / `release` / `look` | Scripted input with no pointer lock. |

Two harness details matter when extending it:

- **Headless rAF is driven by the foreground target.** Chrome only emits animation frames
  for a foregrounded target, so the harness calls `Page.bringToFront` at launch and again
  immediately before `resume()`. Without it, real-time checks freeze a few seconds into a
  run even though `isPaused()` is false. This is a Chrome headless quirk, not a game bug.
- **Every scenario starts from `reset()`.** Do not rely on state left by the previous
  scenario; the wrapper resets before each `run()`.

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
