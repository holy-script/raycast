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
npm run dev        # http://localhost:5173
```

Expected: typecheck clean, 32 tests passing across 4 files, Vite build succeeds, playtest
29/29. Click the canvas, move with WASD, hold Space to jetpack up to 18 m, and look down
to see the top-pitch sprite rows and the diorama. Walk up the panel stairs (x=10–13,
y=18–21) onto the 0.4 platform, jump the 0.6 crate at (4.5, 13.5), or land on a wall to
perch; walk off to fall back.

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
```

Useful for deterministic captures and tests. `game.getHudState()` returns the nearest
actor's resolved yaw, pitch index, and sprite id, which is how directional selection was
verified. `debug()` exposes `renderer.stats.wallColumns`, `wallPixels`, `topPixels`, and
per-sprite `contentW/contentH/pixels/occluded` so the harness can assert on what was
actually drawn.

`?screenshot` hides the intro overlay for headless captures. Prefer the harness:
`npm run playtest` starts Vite, drives Chrome over CDP, writes screenshots plus
`report.json`, and exits non-zero on failure. To verify a deployed build instead of the
local server:

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
- **Raw assets are disposable:** `assets-src/characters/*/raw/` and stylized frames are
  reproducible. The committed atlases are the source of truth for the running game.

## Conventions

- TypeScript strict mode; `noUnusedLocals` and `noUnusedParameters` are on.
- Runtime code has no dependencies; tooling uses `pngjs` and `tsx` only.
- Comments explain non-obvious math or a bug workaround, not every line.
- Unit tests cover pure math/data code. Browser behavior is verified by
  `npm run playtest`; the playtester agent (`.qoder/agents/playtester.md`) also reviews
  the captured screenshots for visual regressions.
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

## Next task: M6 AI stylization pipeline

M5 is complete. The runtime pipeline is still the deterministic Blender render plus palette
stylizer; there is no ComfyUI dependency yet.

Recommended order:

1. Export depth and normal control images alongside each raw render in the Blender pass.
2. Build a ComfyUI img2img + ControlNet workflow, driven by a fixed seed/style preset, and
   a CLI wrapper that consumes raw RGBA + control images and emits stylized RGBA.
3. Keep the atlas contract unchanged (384 frames per character, same filenames/manifest) so
   the renderer needs no changes.
4. Add consistency checks (silhouette IoU against the raw render, palette drift) and an
   optional MCP server exposing `generate_character_atlas` / `regenerate_view`.
5. Then resume M7: attack/hurt/death states, a simple combat loop, and a second map.

If a design choice could go either way, record it in [DECISIONS.md](DECISIONS.md) with the
tradeoff, then proceed.
