# Progress

Last updated: **2026-11-11**

## Status at a glance

| Area | Milestone | Status |
| --- | --- | --- |
| Toolchain, tests, CI, docs | M0 | ✅ Complete |
| DDA renderer, textures, HUD, minimap | M1 | ✅ Complete |
| Jump/gravity/fly, Y-shear pitch, depth buffer | M2 | ✅ Complete |
| 8-way × 3-pitch billboard sprites | M3 | ✅ Complete |
| Blender → stylize → atlas pipeline | M4 | ✅ Complete |
| Variable-height sectors and stairs | M5 | 🚧 Next |
| ComfyUI / MCP AI stylization | M6 | ⬜ Planned |
| 16-way, combat, more content | M7 | ⬜ Planned |
| Audio, menus, deployment | M8 | ⬜ Planned |

## Verification snapshot

Run from a clean checkout:

```bash
npm ci
npm run typecheck   # passes
npm test            # 4 files, 21 tests pass
npm run build       # tsc + vite build
```

Browser verification (2026-11-11, Chrome, `http://localhost:5173/?screenshot`):

- Scene renders brick corridor, panel walls, slate floor, fog, shadow, HUD and minimap.
- Guard sprite is correctly grounded, transparent at the edges, and depth-tested.
- Orbiting a stationary actor produced 8 distinct atlas source rects:
  `sx = 0, 96, 192, 288, 384, 480, 576, 672` in the walk/level row (`sy = 1536`).
- Eye heights 0.55 / 1.35 / 2.35 at ~4 units resolved to pitch indices 1, 2, 2 and
  produced distinct renders. Low-pitch (index 0) requires the camera to be below the
  actor's center, which needs a raised sector — tracked in M5.
- No console errors during the checked session.

## Session log

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
- Added screenshot mode (`?screenshot`), docs, CI, and Git history.
- Verified all tests, typecheck, build, and the browser checks above.

## Known issues / limitations

- World floor is a single height; low-angle sprite frames cannot occur until sectors land.
- No ceiling geometry: the sky gradient is visible above walls in open areas.
- Flying above wall height reveals the unclipped top edges of sprites and walls
  correctly, but the flat ground plane limits what there is to see.
- Pointer lock must be entered by clicking; automated screenshots use `?screenshot`.
- The intro overlay can require a reload on a cold Vite dev start if assets race HMR.

## Immediate next steps

1. Design the sector height map format and collision (`M5`).
2. Render walls against per-cell floor/ceiling heights; add risers and stairs.
3. Add a raised platform + crate to the demo map; assert sprite occlusion and shadow height.
4. Build the depth/normal export for the AI stylization stage (`M6`).
5. Add 16-way support behind a manifest flag and a second character.
