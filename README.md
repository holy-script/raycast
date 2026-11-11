# Raycast — Vertical 2.5D Sprite Lab

A from-scratch software raycaster in TypeScript with true vertical movement and a
reproducible pipeline for multi-angle character sprites, based on
[the project spec](docs/spec/AI-Sprites-In-Raycasting-Games.pdf).

**Live demo:** https://raycast-rosy.vercel.app

![Courtyard demo](docs/screenshots/courtyard.png)

The engine renders a 384×240 framebuffer to Canvas 2D: DDA grid traversal, textured
walls, floors and per-cell tops, a true rotational pitch camera, per-pixel depth, and
jetpack flight up to 18 m. Walls are solid 1.4-unit blocks you can land on; map digits
build walkable 0.2/0.4 stairs and a 0.6 crate. Three Blender chassis (guardian, scout, brute) are each rendered from
16 yaw angles × 4 pitch angles × 6 animation poses (384 frames), stylized to 96×96 pixel
art by SD1.5 + depth ControlNet (deterministic palette stylizer as fallback), and packed
into one atlas per character. Height and pitch drive frame selection,
including a dedicated near-overhead row, so looking down from altitude picks the correct
view for every actor.

**Status:** playable M6 build with a browser playtest harness. Core renderer, jetpack
physics, aerial camera, heightmap stairs/platforms, 16-way/4-pitch sprites, five actor
behaviors, and the full Blender → stylizer → atlas pipeline work end-to-end. M6 adds
Blender depth/normal control passes, a ComfyUI img2img + ControlNet style stage (run for
all 1,152 frames, 0 fallbacks), silhouette/palette verification, and an MCP studio server
for atlas generation. The renderer still consumes the same committed atlases; see the
[roadmap](docs/ROADMAP.md), [pipeline](docs/PIPELINE.md), and
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
npm run assets            # textures → Blender renders → palette stylize → atlas

# AI style pass (ComfyUI running locally with a checkpoint + depth ControlNet):
npm run assets:comfy -- guardian --checkpoint sd15.safetensors \
  --controlnet control_v11f1p_sd15_depth.pth --style "SNES RPG, muted palette"
npm run assets:comfy -- guardian --palette   # deterministic fallback, no server
npm run assets:verify                        # silhouette IoU + palette drift report
```

Individual stages, ComfyUI setup, frame naming, and atlas schema are documented in
[docs/PIPELINE.md](docs/PIPELINE.md). Raw Blender renders, control passes, and intermediate
stylized frames are reproducible and gitignored; the packed atlas is committed.

| Command | Output |
| --- | --- |
| `npm run assets:textures` | `public/assets/textures/{brick,panel,floor}.png` |
| `npm run assets:blender` | 1,152 raw + 2,304 control PNGs in `assets-src/characters/<id>/` |
| `npm run assets:stylize` | 96×96 palette frames per character |
| `npm run assets:comfy` | 96×96 AI frames (or `--fallback`/`--palette`) |
| `npm run assets:verify` | `artifacts/style-report.json` (gitignored) |
| `npm run assets:atlas` | three `atlas.png` (1536×2304) + `atlas.json` pairs |
| `npm run mcp:studio` | stdio MCP tools for atlas generation/repair |

Both `assets:stylize`, `assets:comfy`, `assets:verify`, and `assets:atlas` accept character
names (`npm run assets:atlas -- guardian`) and default to guardian, scout, and brute.

## Repository map

```
src/engine/      DDA, world/collision, renderer, atlas loader, input, math
src/content/      demo map + actor placements
src/game.ts       player physics, jetpack, camera, animation, minimap, HUD
src/main.ts       asset boot, render loop, pointer lock, debug API
tools/assets/     deterministic wall/floor texture generator
tools/blender/    headless turntable: raw, depth, and normal passes for three chassis
tools/stylize/    palette stylizer, shared downsample, ComfyUI CLI wrapper
tools/comfy/      API-format workflow + placeholder validation + HTTP client
tools/verify/     silhouette IoU and palette-drift metrics/report
tools/atlas/      atlas packer + manifest generator
tools/mcp/        stdio MCP server for atlas generation and single-view repair
tools/playtest/   CDP browser harness, screenshots, and JSON report
.qoder/agents/    playtester subagent definition
tests/            Vitest coverage for DDA, math, world, atlas, Comfy workflow, style metrics
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
