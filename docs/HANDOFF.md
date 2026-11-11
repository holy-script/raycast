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
npm run playtest:matrix  # 97 deterministic scenarios, 625 checks
npm run playtest:states  # 42 state checks, 21 paused-state captures
npm run dev        # http://localhost:5173
```

Expected: typecheck clean, 57 tests passing across 8 files, Vite build succeeds, playtest
40/40, matrix 625/625, state gallery 42/42 with zero console errors. Click the canvas,
move with WASD, hold Space to jetpack up to 18 m, and look down to see the top-pitch
sprite rows and the diorama. Walk up the panel stairs (x=10–13, y=18–21) onto the 0.4
platform, jump the 0.6 crate at (4.5, 13.5), or land on a wall to perch; walk off to fall
back. The plasma projector in the lower-right idles and swings when you strike.

M7 loop: pick up the keycard near the courtyard spawn, open the door at (9, 11), step on
the beacon to reach the reactor map, climb the terraces, unlock/open the vault door at
(13, 9), and use the vault beacon to return. `E` talks to NPCs and interacts; `F` or left
click strikes a hostile in front of you. Medkits and fuel canisters are picked up by
walking over them.

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
window.__raycast.automation.attack();         // one strike, true if it connected
window.__raycast.automation.interact();       // "none" | "talk" | "door" | "locked" | "pickup"
window.__raycast.automation.loadLevel("reactor");  // levelIndexById, deterministic reload
window.__raycast.automation.frameCount();     // real rAF ticks (harness liveness)
```

Useful for deterministic captures and tests. `game.getHudState()` returns the nearest
actor's resolved yaw, pitch index, and sprite id, which is how directional selection was
verified. `debug()` exposes `renderer.stats.wallColumns`, `wallPixels`, `topPixels`, and
per-sprite `contentW/contentH/pixels/occluded` so the harness can assert on what was
actually drawn.

`?screenshot` hides the intro overlay for headless captures. Prefer the harnesses:
`npm run playtest` is the happy-path browser check, `npm run playtest:matrix` walks
97 deterministic state/route scenarios (625 checks, labelled contact sheet, golden
frames), and `npm run playtest:states` pauses the sim in every player/guardian body state
for 21 gallery captures (42 checks). All start Vite, drive Chrome over CDP, write
screenshots plus `report.json`, and exit non-zero on failure; see
[PLAYTEST-MATRIX.md](PLAYTEST-MATRIX.md). To verify a deployed build instead of the local
server:

```bash
PLAYTEST_OUT=/tmp/rc-prod-check npm run playtest -- --url https://raycast-rosy.vercel.app/
```

`PLAYTEST_OUT` keeps the production screenshots out of the repo. If you need a one-off
capture, drive Chrome through CDP and wait for the HUD; `--virtual-time-budget` alone can
leave HUD values at `--`.

## Invariants to preserve

- **Yaw convention:** `0 = +x`, increasing toward `+y`. Actor `facing` uses the same.
- **Camera plane:** `(dirY, -dirX) × tanHalf` (screen-right). Sprite `lateral` must stay
  `(dx·dirY − dy·dirX)`. Flipping either independently mirrors sprites.
- **Perpendicular distance:** DDA returns perpendicular distance, not Euclidean. All wall
  and sprite scaling assumes it.
- **Pitch is rotation, not shear:** `projectY` / `projectYClipped` rotate the camera basis.
  Floor/roof and wall/sprite projections must use the same basis or geometry separates.
- **Near plane:** walls are clipped with `zCam > 0.01`; never divide by it. A face crossing
  the plane must still paint, and wall texture V must come from the per-pixel inverse
  projection, not the clipped span.
- **Depth metric:** walls, floor, cell tops, and sprites all compare horizontal forward
  distance. Sprite size and screen position use `zCam` instead, but the occlusion value
  stays forward. Any new geometry must use the same depth metric or occlusion breaks.
- **No altitude skip for walls:** wall faces render at every eye height. Tops are drawn per
  `castRayHits` hit, not from a global roof plane; keep them tied to each cell's height
  and exit distance.
- **Origin cell:** when the camera stands on a solid cell, `castRayHits` emits it at
  distance 0. The renderer skips its face but must draw its top, or steep rays show sky
  beneath the player.
- **Support heights:** surfaces are blocks grown from `z = 0`. `supportHeight` samples the
  centre cell only; collision passes `STEP_UP = 0.3` to `canOccupy`, while actors use the
  default 0.02 so they stay on the floor.
- **Sprite billboards:** screen-aligned, sized by `zCam`, never feet/head projected. This
  is what keeps overhead actors readable; changing it reintroduces the 1D collapse.
- **Sprite anchor:** frame bottoms sit at `actor.z + frameAnchorZ`; shadows use `actor.z`,
  not the frame bottom.
- **Pitch-scale compensation:** `manifest.pitchWorldScale` scales the billboard only, not
  `centerZ`, the shadow, or the actor position. Dropping it makes top-down actors look
  oversized; applying it to `centerZ` shifts their pitch band.
- **Fixed FOV:** projection FOV is constant at every altitude. Do not reintroduce an
  altitude boost; it stretches geometry near the screen edges.
- **Viewmodel overlay:** drawn last, no depth test, with integer draw coordinates.
  Fractional write offsets silently drop pixels from a `Uint8ClampedArray`.
- **Wall depenetration:** `resolveFootprint` pushes out with a `radius + 1e-4` gap and
  clamps to the map edge on every iteration; an exact wall-plane result re-wedges the
  capsule on the next landing.
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
- **Strike contract:** one cone/range target per press, 45 damage, 0.45 s cooldown, and
  the cooldown resets in `placeAtSpawn()`/`loadLevel()` — a leaked cooldown silently
  swallows the first strike of the next scenario (this was a real matrix failure).
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
- Actors are non-blocking (no player/actor or actor/actor collision). Hostiles deal
  contact damage and can be killed; the strike cone has no wall-occlusion check.
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

## Next task: M9 owner playtest and optional polish

M9 is complete and deployed: the first-person viewmodel, fixed FOV, pitch-scale
compensation, wall-side depenetration, and guardian-only content are covered by
`playtest` (40), `playtest:matrix` (625), and `playtest:states` (42). The owner should
playtest the viewmodel and M7 loop and report feel/balance issues.

1. If the weapon swing or muzzle flash needs another pass, edit the poses in
   `tools/blender/render_viewmodel.py` and regenerate with `npm run assets:blender`
   (or run only that script); the game reads the five committed pose PNGs directly.
2. If a new visual change lands, rerun `npm run playtest:matrix -- --update-golden`,
   inspect the first mismatching run before committing, then run typecheck/tests/build,
   both playtests, and check Vercel.
3. Optional deferred work: true stacked-slice actor rendering behind a feature flag,
   keeping the turntable atlas as the fallback; additional chassis art only if the
   guardian look and gameplay are confirmed.
4. Audio/pause/settings and the profiled renderer are complete; a five-minute production
   session ran with no application errors (a favicon 404 was fixed and re-verified).

If a design choice could go either way, record it in [DECISIONS.md](DECISIONS.md) with the
tradeoff, then proceed.
