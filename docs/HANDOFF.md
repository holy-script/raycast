# Handoff

Everything needed to resume work cold. For status, read [PROGRESS.md](PROGRESS.md); for
the plan, read [ROADMAP.md](ROADMAP.md).

## Verify the current state

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run playtest   # headless Chrome, 29 checks + screenshots
npm run playtest:matrix  # 70 deterministic state/route scenarios, 428 checks
npm run dev        # http://localhost:5173
```

Expected: typecheck clean, 43 tests passing across 6 files, Vite build succeeds, playtest
29/29, matrix 428/428 with zero console errors. Click the canvas, move with WASD, hold Space to jetpack up to 18 m, and look down
to see the top-pitch sprite rows and the diorama. Walk up the panel stairs (x=10–13,
y=18–21) onto the 0.4 platform, jump the 0.6 crate at (4.5, 13.5), or land on a wall to
perch; walk off to fall back.

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
  --fallback --timeout 600
npm run assets:comfy -- --dry-run # plan/missing-control check, writes nothing
npm run assets:comfy -- guardian --palette --only idle:0:1:0 --out /tmp/frames
```

The committed atlases are AI-stylized (SD1.5 + depth ControlNet, 0 fallbacks, ~55 min per
character). `assets:blender` renders raw + depth + normal passes (`--no-controls` skips the
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

window.__raycast.automation.pause();          // freeze the live frame loop
window.__raycast.automation.step(0.5);        // fixed-dt ticks while paused, then render
window.__raycast.automation.resume();
window.__raycast.automation.reset();          // respawn + actor spawns + fuel
window.__raycast.automation.setFuel(0.3);
window.__raycast.automation.frameCount();     // real rAF ticks (harness liveness)
```

Useful for deterministic captures and tests. `game.getHudState()` returns the nearest
actor's resolved yaw, pitch index, and sprite id, which is how directional selection was
verified. `debug()` exposes `renderer.stats.wallColumns`, `wallPixels`, `topPixels`, and
per-sprite `contentW/contentH/pixels/occluded` so the harness can assert on what was
actually drawn.

`?screenshot` hides the intro overlay for headless captures. Prefer the harnesses:
`npm run playtest` is the happy-path browser check, and `npm run playtest:matrix` walks
70 deterministic state/route scenarios (428 checks, labelled contact sheet, golden
frames). Both start Vite, drive Chrome over CDP, write screenshots plus `report.json`,
and exit non-zero on failure; see [PLAYTEST-MATRIX.md](PLAYTEST-MATRIX.md). To verify a
deployed build instead of the local server:

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

## Conventions

- TypeScript strict mode; `noUnusedLocals` and `noUnusedParameters` are on.
- Runtime code has no dependencies; tooling uses `pngjs` and `tsx` only.
- Comments explain non-obvious math or a bug workaround, not every line.
- Unit tests cover pure math/data code. Browser behavior is verified by
  `npm run playtest` plus the state matrix (`npm run playtest:matrix`); the playtester
  agent (`.qoder/agents/playtester.md`) reviews the captured screenshots for visual
  regressions.
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
- Actors have no collision with the player or each other and no combat loop. Chase actors
  pursue but do not damage; hover actors bob and spin.
- Intro overlay can stick on a cold Vite start if HMR interrupts boot; reload fixes it.
- No license file yet.

## Next task: playtest feedback, then M7 gameplay

M6 is complete: Blender controls, the ComfyUI workflow/CLI, style verification, and the
MCP studio server are in place. The owner is playtesting the current build next; treat
their bug/feel report as the first input before starting new content.

After that, resume M7. The matrix gives each new feature a place to land: add a scenario
group for combat damage, interaction, doors/pickups, and the second map.

1. Add attack/hurt/death/talk states to the Blender timeline, state constants, atlas
   manifests, and frame selection.
2. Add actor interaction (use/talk) and a simple combat loop with damage, hit feedback,
   and enemy removal.
3. Add doors, pickups, and a level transition.
4. Add a second map that exercises the heightmap sectors and vertical camera.
5. When ComfyUI + models are available, run a real `assets:comfy` pass, inspect
   `artifacts/style-report.json`, and tune the drift threshold/style preset.

If a design choice could go either way, record it in [DECISIONS.md](DECISIONS.md) with the
tradeoff, then proceed.
