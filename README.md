# Raycast — Vertical 2.5D Sprite Lab

A from-scratch software raycaster in TypeScript with true vertical movement and a
reproducible pipeline for multi-angle character sprites, based on
[the project spec](docs/spec/AI-Sprites-In-Raycasting-Games.pdf).

**Live demo:** https://raycast-rosy.vercel.app

![Courtyard demo](docs/screenshots/courtyard.png)

The engine renders a 384×240 framebuffer to Canvas 2D: DDA grid traversal, textured
walls and floors, a true rotational pitch camera, wall-top/roof planes, per-pixel depth,
and jetpack flight up to 18 m. Three Blender chassis (guardian, scout, brute) are each
rendered from 16 yaw angles × 3 pitch angles × 6 animation poses (288 frames), stylized
to 96×96 pixel art, and packed into one atlas per character. Height and pitch drive
frame selection, so looking down from altitude picks the correct view for every actor.

**Status:** playable M4+ build with a browser playtest harness. Core renderer, jetpack
physics, aerial camera, 16-way/3-pitch sprites, and the full Blender → stylizer → atlas
pipeline work end-to-end. Variable-height sectors and the AI stylization stage are the
next milestones — see the [roadmap](docs/ROADMAP.md) and
[progress log](docs/PROGRESS.md).

## Quick start

Requirements: Node.js 20+ (tested on 24). Blender is only needed to regenerate sprites.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests
npm run typecheck
npm run build      # static build in dist/
npm run playtest   # headless Chrome: input, physics, atlas + screenshot checks
```

## Controls

| Input | Action |
| --- | --- |
| Click canvas | Lock pointer / enter the demo |
| Mouse | Look (yaw + pitch) |
| `W A S D` | Move |
| `Shift` | Sprint |
| `Space` | Ignite/hold jetpack (ground jump or sustained lift) |
| `F2` | Toggle freefly debug mode (`Space` up, `Ctrl`/`C` down) |
| `M` / `Tab` | Toggle minimap |
| `F3` | Toggle detailed HUD |
| `R` | Respawn |
| `Esc` | Release pointer |

Append `?screenshot` to the URL to hide the intro overlay for automated captures.

## Asset pipeline

The full pipeline regenerates every visual asset:

```bash
npm run assets            # textures → Blender renders → stylize → atlas
```

Individual stages, requirements, frame naming, and atlas schema are documented in
[docs/PIPELINE.md](docs/PIPELINE.md). Raw Blender renders and intermediate stylized
frames are reproducible and gitignored; the packed atlas is committed.

| Command | Output |
| --- | --- |
| `npm run assets:textures` | `public/assets/textures/{brick,panel,floor}.png` |
| `npm run assets:blender` | 864 RGBA renders in `assets-src/characters/<id>/raw/` |
| `npm run assets:stylize` | 96×96 pixel-art frames per character |
| `npm run assets:atlas` | three `atlas.png` (1536×1728) + `atlas.json` pairs |

Both `assets:stylize` and `assets:atlas` accept character names
(`npm run assets:atlas -- guardian`) and default to guardian, scout, and brute.

## Repository map

```
src/engine/      DDA, world/collision, renderer, atlas loader, input, math
src/content/      demo map + actor placements
src/game.ts       player physics, jetpack, camera, animation, minimap, HUD
src/main.ts       asset boot, render loop, pointer lock, debug API
tools/assets/     deterministic wall/floor texture generator
tools/blender/    headless turntable renderer for three character chassis
tools/stylize/    downsample + palette quantizer + outline pass
tools/atlas/      atlas packer + manifest generator
tools/playtest/   CDP browser harness, screenshots, and JSON report
.qoder/agents/    playtester subagent definition
tests/            Vitest coverage for DDA, math, world, atlas
docs/             spec, roadmap, progress, architecture, pipeline, handoff, ADRs
```

## Documentation

- [Roadmap](docs/ROADMAP.md) — milestones, checkboxes, acceptance criteria
- [Progress](docs/PROGRESS.md) — current status, verification evidence, session log
- [Architecture](docs/ARCHITECTURE.md) — rendering math and module map
- [Pipeline](docs/PIPELINE.md) — asset generation and atlas schema
- [Handoff](docs/HANDOFF.md) — commands, debug API, invariants, next steps
- [Decisions](docs/DECISIONS.md) — architecture decision records
- [Original spec](docs/spec/AI-Sprites-In-Raycasting-Games.pdf)

## License

No license has been chosen yet. Treat the repository as all-rights-reserved until one
is added.
