# Handoff

Everything needed to resume work cold. For status, read [PROGRESS.md](PROGRESS.md); for
the plan, read [ROADMAP.md](ROADMAP.md).

## Verify the current state

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run playtest   # headless Chrome, 40 checks + screenshots
npm run playtest:matrix  # 99 deterministic scenarios, 642 checks
npm run playtest:flight  # 18 airborne poses + live jetpack, 109 checks
npm run playtest:states  # 42 state checks, 21 paused-state captures
npm run dev        # http://localhost:5173
```

Expected: typecheck clean, 71 tests passing across 9 files, Vite build succeeds, playtest
40/40, matrix 642/642, flight 109/109, state gallery 42/42 with zero console errors.
Click the canvas,
move with WASD, hold Space to jetpack up to 18 m, and look down to see the top-pitch
sprite rows and the diorama. Walk up the panel stairs (x=10–13, y=18–21) onto the 0.4
platform, jump the 0.6 crate at (4.5, 13.5), or land on a wall to perch; walk off to fall
back. The plasma projector in the lower-right idles and swings when you fire; bolts
travel straight from the camera and bloom on impact.

M7 loop: pick up the keycard near the courtyard spawn, open the door at (9, 11), step on
the beacon to reach the reactor map, climb the terraces, unlock/open the vault door at
(13, 9), and use the vault beacon to return. `E` talks to NPCs and interacts; `F` or left
click fires a plasma bolt at whatever is under the crosshair. Medkits and fuel canisters
are picked up by walking over them.

Asset pipeline after a fresh clone (raw renders are gitignored):

```bash
BLENDER_BIN=/Applications/Blender.app/Contents/MacOS/Blender npm run assets:blender
npm run assets:stylize            # deterministic palette stylizer
npm run assets:verify             # IoU + palette drift report
npm run assets:atlas              # commit the regenerated atlases

# AI pass (ComfyUI on 127.0.0.1:8188), one character at a time:
npm run assets:comfy -- guardian \
  --checkpoint v1-5-pruned-emaonly.safetensors \
  --controlnet control_v11f1p_sd15_depth.safetensors \
  --only attack,hurt,death,talk --resume --fallback --timeout 600
npm run assets:comfy -- --dry-run # plan/missing-control check, writes nothing
npm run assets:comfy -- guardian --palette --only idle:0:1:0 --out /tmp/frames
```

The committed atlases are AI-stylized (SD1.5 + depth ControlNet, 0 fallbacks; ~55 min
for a 384-frame pass, ~2–2.5 h for the 832 new-state frames per character). `assets:blender` renders raw + depth + normal passes (`--no-controls` skips the
latter). Setup and timings are in
[PIPELINE.md](PIPELINE.md#local-setup-apple-silicon-verified). `assets:comfy` falls back to
the palette stylizer with `--fallback`; without a server use `--palette` or `--fallback`.
The MCP server (`npm run mcp:studio`) exposes `generate_character_atlas` and
`regenerate_view` over stdio; see
[PIPELINE.md](PIPELINE.md#mcp-studio-server-toolsmcpstudiots) for the client config.

## Debug API

Available in the browser console after boot:

```ts
window.__raycast.game;                       // full Game instance
window.__raycast.setPose(x, y, z, yaw, pitch);
window.__raycast.setFlying(true);
window.__raycast.dismissIntro();
window.__raycast.automation.enable();         // scripted input, no pointer lock
window.__raycast.automation.press("KeyW");
window.__raycast.automation.look(120, 0);
window.__raycast.automation.state();          // HudState
window.__raycast.debug();                     // camera, player, actor rects, render stats
window.__raycast.audioRunning();               // AudioContext is running (after a gesture)

window.__raycast.automation.pause();          // freeze the live frame loop
window.__raycast.automation.step(0.5);        // fixed-dt ticks while paused, then render
window.__raycast.automation.resume();
window.__raycast.automation.reset();          // reload courtyard + respawn state
window.__raycast.automation.setFuel(0.3);
window.__raycast.automation.setHealth(40);
window.__raycast.automation.attack();         // fire one bolt, false while dead/cooling
window.__raycast.automation.interact();       // "none" | "talk" | "door" | "locked" | "pickup"
window.__raycast.automation.loadLevel("reactor");  // levelIndexById, deterministic reload
window.__raycast.automation.frameCount();     // real rAF ticks (harness liveness)
```

Useful for deterministic captures and tests. `game.getHudState()` returns the nearest
actor's resolved yaw, pitch index, and sprite id, which is how directional selection was
verified. `debug()` exposes `renderer.stats.wallColumns`, `wallPixels`, `topPixels`,
per-sprite `contentW/contentH/pixels/occluded`, and the live `bolts` array
(`x, y, z, fromPlayer`) so the harness can assert on what was actually drawn and in
flight.

`?screenshot` hides the intro overlay for headless captures. Prefer the harnesses:
`npm run playtest` is the happy-path browser check, `npm run playtest:matrix` walks
99 deterministic state/route scenarios (642 checks, labelled contact sheet, golden
frames), `npm run playtest:states` pauses the sim in every player/guardian body state
for 21 gallery captures (42 checks), and `npm run playtest:flight` sweeps 18
altitude/pitch poses plus a live jetpack flight (109 checks) while asserting no sky
holes, straight wall-top projection, unclipped overhead sprites, and ≥45 FPS. All start
Vite, drive Chrome over CDP, write screenshots plus `report.json`, and exit non-zero on
failure; see [PLAYTEST-MATRIX.md](PLAYTEST-MATRIX.md). To verify a deployed build instead
of the local server:

```bash
PLAYTEST_OUT=/tmp/rc-prod-check npm run playtest -- --url https://raycast-rosy.vercel.app/
```

`PLAYTEST_OUT` keeps the production screenshots out of the repo (`MATRIX_OUT`,
`STATES_OUT`, and `FLIGHT_OUT` do the same for the other harnesses). If you need a
one-off capture, drive Chrome through CDP and wait for the HUD; `--virtual-time-budget`
alone can leave HUD values at `--`.

## Invariants to preserve

- **Yaw convention:** `0 = +x`, increasing toward `+y`. Actor `facing` uses the same.
- **Camera plane:** `(dirY, -dirX) × tanHalf` (screen-right). Sprite `lateral` must stay
  `(dx·dirY − dy·dirX)`. Flipping either independently mirrors sprites.
- **Perpendicular distance:** DDA returns perpendicular distance, not Euclidean. All wall
  and sprite scaling assumes it.
- **Per-pixel pitch basis:** every pixel derives both its vertical ray (`rayZ = sinP +
  cosP·yCam`) and its horizontal ray (`horizontal = cosP − sinP·yCam`). A wall's screen x
  depends on height only through this shared perspective. The old per-column horizontal
  ray plus vertical shear moved screen x with height and bent straight walls into curves;
  do not reintroduce a column-only ray.
- **Surface tests:** a wall face paints where `entry > NEAR_PLANE` and
  `eyeZ + entry·rayZ ∈ [0, cellHeight]`; a top paints where
  `topT = (cellHeight − eyeZ)/rayZ` lands inside that cell's entry/exit span. Face
  texture V must come from the hit height, not a projected screen span.
- **Depth metric:** `t` is the camera-space depth along the pitched ray for floor, wall
  faces, and wall tops. Sprites compute `zCam` with the same basis and compare against it.
  Do not mix in horizontal forward distance; that reintroduces occlusion drift under
  pitch.
- **Sky is a column prefix:** a column may show sky above geometry but never an enclosed
  sky run below it. Runs that reach the bottom edge are the void beyond the map and are
  ignored. `npm run playtest:flight` classifies pixels against `buildSky` output.
- **Wall-top straightness:** under pitch, a straight wall top must project to a straight
  line. The flight suite fits it over 264 columns and fails above 1.5 px residual; this is
  the regression gate for perspective-correct geometry.
- **No altitude skip:** faces and tops are tested at every eye height, per pixel. A wall
  crossing the near plane still paints; when the camera is above a solid cell its top is
  hit inside the cell span, so steep rays do not leave sky beneath the player.
- **Support heights:** surfaces are blocks grown from `z = 0`. `supportHeight` samples the
  centre cell only; collision passes `STEP_UP = 0.3` to `canOccupy`, while actors use the
  default 0.02 so they stay on the floor.
- **Sprite billboards:** screen-aligned, sized by `zCam`, never feet/head projected. This
  is what keeps overhead actors readable; changing it reintroduces the 1D collapse.
- **Sprite anchor:** frame bottoms sit at `actor.z + frameAnchorZ`; shadows use `actor.z`,
  not the frame bottom.
- **Pitch-scale compensation:** `manifest.pitchWorldScale` scales the billboard only, not
  `centerZ`, the shadow, or the actor position. Dropping it makes top-down actors look
  oversized; applying it to `centerZ` shifts their pitch band. The `death` state is exempt:
  its rows are all rendered through the 1.40 prone frame, so `spriteSelection` forces the
  pitch scale to 1 and uses the manifest's per-state `frameWorldSize`/`frameAnchorZ`.
- **Static corpse pitch:** `death` uses `sampleStaticPitch` (single row, no crossfade).
  Blending the level/high rows at close range produced a larger translucent ghost plus a
  crisp copy; moving actors keep the crossfade.
- **Fixed FOV:** projection FOV is constant at every altitude. Do not reintroduce an
  altitude boost; it stretches geometry near the screen edges.
- **Viewmodel overlay:** drawn last, no depth test, with integer draw coordinates.
  Fractional write offsets silently drop pixels from a `Uint8ClampedArray`.
- **Wall depenetration:** `resolveFootprint` pushes out with a `radius + 1e-4` gap and
  clamps to the map edge on every iteration; an exact wall-plane result re-wedges the
  capsule on the next landing.
- **Projectile substep:** `BOLT_SUBSTEP` is 0.08 m, well under the 0.2 m stair tread. A
  22 m/s bolt covers 0.37 m per 60 Hz frame, so removing subdivision lets shots tunnel
  through ledges and crate corners.
- **Projectile collision order:** wall/floor collision runs before actor/player cylinders,
  and a hit removes the bolt. Do not let a bolt pass through geometry to reach a target
  behind it.
- **Impact depth:** the impact billboard must be backed out of the struck cell along the
  bolt vector; placed at the hit point, the per-pixel depth test culls it entirely.
  Glow/impact pixels are translucent and must not write depth.
- **Thin projectiles:** bolts use `noShadow`; drawing a ground shadow under a glow sprite
  breaks the floating-light read.
- **Outline pass:** read from an immutable alpha mask. Never mutate the output during the
  neighbor scan.
- **Atlas fallback:** exact pitch → level pitch → idle level. Keep this so partial
  atlases remain renderable.
- **Per-actor atlas:** `ActorSpec.sprite` selects the atlas; frame size and direction count
  come from that atlas's manifest, not global constants.
- **Raw assets are disposable:** `assets-src/characters/*/raw/`, `control/`, and stylized
  frames are reproducible. The committed atlases are the source of truth for the running
  game.
- **AI frame masking:** the ComfyUI wrapper cuts generated art with the raw render's alpha
  mask before writing a frame. Do not replace this with luminance keying or the model's
  background; black/white fringes and silhouette growth return.
- **Style verification tolerance:** the default IoU dilates the raw mask by one pixel
  because the mandated outline lives outside the silhouette. `--tolerance 0` is the strict
  comparison; a mean palette-drift threshold of 12 passed both the palette baseline (4.6–5.1)
  and the SD1.5 pass (5.4–6.2).
- **MCP framing:** `tools/mcp/studio.ts` must write only JSON-RPC lines to stdout; logs
  belong on stderr. Tool calls spawn `tsx` with an argv array, never a shell string.
- **Actor reset:** `Game.resetActors()` must restore hover actors to `spec.hover.height`;
  zeroing `z` leaves them on the floor until the next update and corrupts pitch-band tests.
- **Headless frames:** Chrome only emits rAF for a foregrounded target. The CDP launcher
  calls `Page.bringToFront`, and the matrix re-fronts before `resume()`; removing either
  silently freezes real-time checks while `isPaused()` still reads false.
- **Level determinism:** `loadLevel` must reset `time`, actor `animTime` to
  `index × 0.37`, player pose/health/fuel/cooldown, input, and rebuild the world. The
  matrix compares golden pixels, so any new level or actor field that affects visuals
  needs an explicit reset here.
- **State clocks:** `idle`/`walk` animate from `animTime`; `attack`/`hurt`/`death`/`talk`
  read `stateT` so their timing is independent of walk phase. `death` clamps to its last
  frame and the actor stays in the array (`alive = false`) so the corpse still draws.
- **Corpses:** skip only dead actors whose state is not `death`; filtering all dead actors
  removes the corpse mid-frame, and updating them after death restarts animation.
- **Fire contract:** one bolt per press, 45 damage, 0.45 s cooldown. `attack()` returns
  true when a bolt spawns, not when it hits; the projectile step owns damage. The cooldown
  resets in `placeAtSpawn()`/`loadLevel()` — a leaked cooldown silently swallows the first
  shot of the next scenario (this was a real matrix failure).
- **Combat reset:** `loadLevel()` clears `bolts` and `impacts`; carrying them across a
  transition leaves stray projectiles and flashes in the new map.
- **Doors and exits:** opening a door clears both its tile id and height so movement and
  raycasts agree; exits and pickups are radius checks in `update`, not tile triggers.

## Conventions

- TypeScript strict mode; `noUnusedLocals` and `noUnusedParameters` are on.
- Runtime code has no dependencies; tooling uses `pngjs` and `tsx` only.
- Comments explain non-obvious math or a bug workaround, not every line.
- Unit tests cover pure math/data code. Browser behavior is verified by
  `npm run playtest`, the state matrix (`npm run playtest:matrix`), and the paused-state
  gallery (`npm run playtest:states`); the playtester agent
  (`.qoder/agents/playtester.md`) reviews the captured screenshots for visual regressions.
- Keep documentation current in the same commit as the change it describes.

## Git workflow

- Remote: `https://github.com/holy-script/raycast.git`
- Default branch: `main`
- Pushing user is pinned locally to `holy-script`:
  `git config credential.https://github.com.username holy-script`
- Commit in logical slices, e.g. engine, pipeline, docs/CI. Do not commit secrets,
  `node_modules`, `dist`, raw renders, or intermediate frames.
- CI is intentionally deferred by the owner. `.github/workflows/ci.yml` exists locally
  but is not on the remote (the `holy-script` token lacks the `workflow` scope). If it is
  activated later, run install, typecheck, tests, build, and optionally the playtest.

## Deployment

- Production URL: **https://raycast-rosy.vercel.app**
- Vercel project: `raycast` under the `holy-script` account, linked in `.vercel/`
  (gitignored; created by the CLI).
- The GitHub repository `holy-script/raycast` is connected to the Vercel project, so every
  push to `main` builds and deploys automatically. `vercel --prod` is a manual fallback.
- Vite is auto-detected; Vercel runs `npm run build` and serves `dist/`.

## Known constraints

- Heights are blocks grown from `z = 0`; there are no sunken floors/pits, overhangs, or
  ceilings. The walkable floor is one plane at 0.
- No ceiling geometry; sky is visible above the outer walls from ground level.
- Actors are non-blocking (no player/actor or actor/actor collision). Hostiles deal melee
  contact damage and marauders fire bolts; both can be killed. Bolts are straight,
  gravity-free, and do not penetrate or bounce. The player bolt spawns at the eye, not
  the viewmodel muzzle.
- Levels reload from their definitions on every transition, which resets pickups, doors,
  and the keycard. The demo loop is therefore one-way per visit: after the courtyard
  beacon return you can re-collect the keycard and run it again.
- The guardian six-state atlas is the only shipped atlas (1,216 frames, 1536×7296).
  Scout/brute packed assets and tooling defaults were removed; every actor renders through
  the guardian atlas with per-actor tint and scale.
- The viewmodel is a flat 256×208 overlay with no depth test and no per-altitude or
  per-FOV variants. Muzzle-flash frames can cover part of the weapon receiver.
- Intro overlay can stick on a cold Vite start if HMR interrupts boot; reload fixes it.
- Pointer-lock release now pauses the simulation and opens the settings panel. Scripted
  automation bypasses that path, so matrix timing is unaffected.
- Audio is fully procedural and needs a user gesture; there is no music, no external
  audio asset, and no audio assertion in the harness. Settings live in localStorage
  (`raycast.settings.v1`) and fail open when storage is blocked.
- No license file yet.

## Next task: M10 owner playtest and combat tuning

M10 is complete locally (not yet deployed): ranged plasma bolts, the marauder gunner,
and glow impacts are covered by `playtest` (40), `playtest:matrix` (642 across 99
scenarios), `playtest:flight` (109), and `playtest:states` (42), plus 71 unit tests. The
owner should playtest the shot feel and balance before any push to `main`.

1. Tune `PLAYER_BOLT_SPEED/LIFE` and `PLAYER_ATTACK_DAMAGE/COOLDOWN` in `src/game.ts`,
   and each actor's `gun` spec in `src/content/actors.ts`. Keep the matrix's ranged
   assertions in sync if damage or timing changes.
2. If the eye-spawned bolt should align with the viewmodel, add a camera-space muzzle
   offset in `attack()` and review the `f09`/`f10` captures for parallax.
3. If a new visual change lands, rerun `npm run playtest:matrix -- --update-golden`,
   inspect the first mismatching run before committing, then run typecheck/tests/build,
   both playtests, and check Vercel.
4. Optional deferred work: true stacked-slice actor rendering; muzzle-aligned spawns,
   projectile drop/penetration, or destructible bolts.

If a design choice could go either way, record it in [DECISIONS.md](DECISIONS.md) with the
tradeoff, then proceed.
