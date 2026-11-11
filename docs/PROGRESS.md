# Progress

Last updated: **2026-11-11**

## Status at a glance

| Area | Milestone | Status |
| --- | --- | --- |
| Toolchain, tests, docs, playtest | M0 | ✅ Complete (CI intentionally deferred) |
| DDA renderer, textures, HUD, minimap | M1 | ✅ Complete |
| Jetpack, rotational pitch, roof plane, depth | M2 | ✅ Complete |
| 16-way × 3-pitch billboard sprites | M3 | ✅ Complete |
| Blender → stylize → atlas, 3 chassis | M4 | ✅ Complete |
| Variable-height sectors and stairs | M5 | 🚧 Next |
| ComfyUI / MCP AI stylization | M6 | ⬜ Planned |
| 16-way and multi-character content | M7 | 🚧 Chassis + directions done; combat pending |
| Audio, menus, deployment | M8 | 🚧 Live + auto-deploy; audio/menus pending |

## Verification snapshot

Run from a clean checkout:

```bash
npm ci
npm run typecheck   # passes
npm test            # 4 files, 22 tests pass
npm run build       # tsc + vite build
npm run playtest    # 16/16 browser checks pass
```

Browser verification (2026-11-11, headless Chrome over CDP, `http://127.0.0.1:5199/?screenshot`):

- Three atlases load: guardian / scout / brute, each 16 directions × 3 pitches × 288 frames.
- Movement, strafing, mouse yaw, and wall collision match screen direction.
- Jetpack lifts to 4.85 m and burns fuel, lands and refuels, holds an 18 m ceiling; pitch
  clamps at -63° on the ground and unlocks to -53° airborne.
- Front/back yaw selection verified at yaw 0 / 8 for all three chassis.
- Aerial views show a solid courtyard with wall tops, straight floor grid, visible actors,
  and sky only outside the map boundary.
- Screenshots: `docs/screenshots/playtest/01-…12-…`; machine-readable results in
  `docs/screenshots/playtest/report.json`.
- No console errors during the checked session.
- Production deployment: https://raycast-rosy.vercel.app — HTML, atlas JSON/PNG, and
  textures all return 200; the scene renders with no console errors in headless Chrome.

## Session log

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

- World floor is a single height; low-angle sprite frames cannot occur until sectors land.
- No ceiling geometry: sky is visible above the outer walls from ground level.
- Wall-top rendering is a constant-height plane; variable wall heights arrive with M5.
- Pointer lock must be entered by clicking; automated screenshots use `?screenshot`.
- The intro overlay can require a reload on a cold Vite dev start if assets race HMR.
- The playtest verifies mechanics and atlas wiring, not art quality; the playtester agent
  reviews the screenshots for visual regressions.

## Immediate next steps

1. Design the sector height map format and collision (`M5`).
2. Render walls against per-cell floor/ceiling heights; add risers and stairs.
3. Add a raised platform + crate to the demo map; assert sprite occlusion and shadow height.
4. Build the depth/normal export for the AI stylization stage (`M6`).
5. Add attack/hurt/death states and a simple interaction or combat loop (`M7`).
