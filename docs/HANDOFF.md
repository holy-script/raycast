# Handoff

Everything needed to resume work cold. For status, read [PROGRESS.md](PROGRESS.md); for
the plan, read [ROADMAP.md](ROADMAP.md).

## Verify the current state

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run playtest   # headless Chrome, 24 checks + screenshots
npm run dev        # http://localhost:5173
```

Expected: typecheck clean, 27 tests passing across 4 files, Vite build succeeds, playtest
24/24. Click the canvas, move with WASD, hold Space to jetpack up to 18 m, and look down
to see the top-pitch sprite rows and the wall-top diorama. Land on a wall to perch; walk
off to fall back.

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
verified. `debug()` exposes `renderer.stats.wallColumns`, `wallPixels`, and per-sprite
`contentW/contentH/pixels` so the harness can assert on what was actually drawn.

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
- **Depth metric:** walls, floor, wall tops, and sprites all compare horizontal forward
  distance. Sprite size and screen position use `zCam` instead, but the occlusion value
  stays forward. Any new geometry must use the same depth metric or occlusion breaks.
- **No altitude skip for walls:** wall faces render at every eye height. The floor pass
  draws wall tops when `eyeZ > WALL_HEIGHT`; keep the `roofT < floorT` ordering and the
  solid-cell fill.
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

- The floor is flat at `z = 0`; walls are solid, walkable 1.4-unit blocks. Per-cell floor
  and ceiling heights, stairs, and ledges are still M5.
- No ceiling geometry; sky is visible above the outer walls from ground level.
- Wall tops are a constant-height plane; variable wall heights arrive with M5.
- Actors have no collision with the player or each other and no combat loop. Chase actors
  pursue but do not damage; hover actors bob and spin.
- Intro overlay can stick on a cold Vite start if HMR interrupts boot; reload fixes it.
- No license file yet.

## Next task: M5 variable-height sectors

Wall-top support already exists (`supportHeight`, z-aware `canOccupy`, grounded landing),
so M5 generalizes that path to per-cell heights.

Recommended order:

1. Add `floorHeight(tile)` and `ceilingHeight(tile)` (start with a `heights` array or map
   string annotations). Keep the existing ASCII map valid with default height 0.
2. Feed that into `supportHeight` and allow step-up ≤ 0.3 with grounded snapping; gravity
   still applies when stepping off a ledge.
3. Render walls with per-cell base/top through `projectYClipped(cam, d, height − eyeZ)`,
   clamped to the framebuffer. Add riser faces between adjacent sectors and extend the
   roof pass to per-cell floor/ceiling heights.
4. Use the actor's sector floor for sprite `z`, shadow height, and selection distance.
5. Add stairs and a raised platform to `src/content/demo-map.ts`, plus a waist-high crate
   to test partial sprite occlusion.
6. Add tests for height lookup, step limits, and grounded snapping.
7. Update PROGRESS/ROADMAP, screenshot, commit, push.

If a design choice could go either way, record it in [DECISIONS.md](DECISIONS.md) with the
tradeoff, then proceed.
