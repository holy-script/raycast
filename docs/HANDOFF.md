# Handoff

Everything needed to resume work cold. For status, read [PROGRESS.md](PROGRESS.md); for
the plan, read [ROADMAP.md](ROADMAP.md).

## Verify the current state

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run dev    # http://localhost:5173
```

Expected: typecheck clean, 21 tests passing across 4 files, Vite build succeeds. Click the
canvas, move with WASD, jump with Space, look around, press F2 and fly up to see the
pitch-dependent sprite rows.

## Debug API

Available in the browser console after boot:

```ts
window.__raycast.game;                       // full Game instance
window.__raycast.setPose(x, y, z, yaw, pitch);
window.__raycast.setFlying(true);
window.__raycast.dismissIntro();
```

Useful for deterministic captures and tests. `game.getHudState()` returns the nearest
actor's resolved yaw and pitch index, which is how directional selection was verified.

`?screenshot` hides the intro overlay for headless captures. Chrome headless example:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --hide-scrollbars --window-size=1200,900 \
  --virtual-time-budget=6000 \
  --screenshot=docs/screenshots/courtyard.png \
  "http://localhost:5173/?screenshot"
```

For HUD values to be populated in a capture, drive Chrome through CDP and wait a second
before `Page.captureScreenshot`; `--virtual-time-budget` alone can leave the HUD at `--`.

## Invariants to preserve

- **Yaw convention:** `0 = +x`, increasing toward `+y`. Actor `facing` uses the same.
- **Camera plane:** `(dirY, -dirX) × tanHalf` (screen-right). Sprite `lateral` must stay
  `(dx·dirY − dy·dirX)`. Flipping either independently mirrors sprites.
- **Perpendicular distance:** DDA returns perpendicular distance, not Euclidean. All wall,
  floor and sprite scaling assumes it.
- **Horizon:** `H/2 + tan(pitch)·focal`. Pitch is applied by shearing, never by rotating
  the direction vector.
- **Depth:** walls/floor write per-pixel depth; sprites compare before blending. Any new
  world geometry must write the same metric or occlusion breaks.
- **Sprite anchor:** frame bottoms sit at `actor.z + frameAnchorZ`; shadows use `actor.z`,
  not the frame bottom.
- **Outline pass:** read from an immutable alpha mask. Never mutate the output during the
  neighbor scan.
- **Atlas fallback:** exact pitch → level pitch → idle level. Keep this so partial
  atlases remain renderable.
- **Raw assets are disposable:** `assets-src/character/raw/` and stylized frames are
  reproducible. The committed atlas is the source of truth for the running game.

## Conventions

- TypeScript strict mode; `noUnusedLocals` and `noUnusedParameters` are on.
- Runtime code has no dependencies; tooling uses `pngjs` and `tsx` only.
- Comments explain non-obvious math or a bug workaround, not every line.
- Unit tests cover pure math/data code. Browser behavior is verified manually with the
  debug API and screenshots.
- Keep documentation current in the same commit as the change it describes.

## Git workflow

- Remote: `https://github.com/holy-script/raycast.git`
- Default branch: `main`
- Pushing user is pinned locally to `holy-script`:
  `git config credential.https://github.com.username holy-script`
- Commit in logical slices, e.g. engine, pipeline, docs/CI. Do not commit secrets,
  `node_modules`, `dist`, raw renders, or intermediate frames.
- CI (`.github/workflows/ci.yml`) runs install, typecheck, tests, and build on every push
  and PR. The workflow is authored locally but is not on the remote yet: the stored
  `holy-script` token lacks the `workflow` scope, so GitHub rejected that file. Add the
  scope (classic PAT: `repo` + `workflow`; fine-grained PAT: repository **Workflows**
  read/write) and update the credential helper, then commit and push the file.

## Known constraints

- Floor and walls are single-height. Low-angle sprite frames exist in the atlas but cannot
  be selected yet because the camera eye is always above an actor's center on flat ground.
- No ceiling geometry; sky gradient appears above walls.
- One character rig, hardcoded output paths in the stylizer/packer.
- Intro overlay can stick on a cold Vite start if HMR interrupts boot; reload fixes it.
- No license file yet.

## Next task: M5 variable-height sectors

Recommended order:

1. Add `floorHeight(tile)` and `ceilingHeight(tile)` (start with a `heights` array or map
   string annotations). Keep the existing ASCII map valid with default height 0.
2. Give the player a `groundZ` derived from the cell underfoot; allow step-up ≤ 0.3 and
   snap `z` when grounded. Gravity still applies when stepping off a ledge.
3. Render walls with per-cell base/top: `yTop = horizon − (ceil − eyeZ)·invDist`,
   `yBottom = horizon + (eyeZ − floor)·invDist`, clamped to 0..height. Add riser faces
   between adjacent sectors.
4. Use the actor's sector floor for sprite `z`, shadow height, and selection distance.
5. Add stairs and a raised platform to `src/content/demo-map.ts`, plus a waist-high crate
   to test partial sprite occlusion.
6. Add tests for height lookup, step limits, and grounded snapping.
7. Update PROGRESS/ROADMAP, screenshot, commit, push.

If a design choice could go either way, record it in [DECISIONS.md](DECISIONS.md) with the
tradeoff, then proceed.
