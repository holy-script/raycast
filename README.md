# Raycast — Vertical 2.5D Sprite Lab

A from-scratch software raycaster in TypeScript with true vertical movement and a
reproducible pipeline for multi-angle character sprites, based on
[the project spec](docs/spec/AI-Sprites-In-Raycasting-Games.pdf).

**Live demo:** https://raycast-rosy.vercel.app

> **Status:** combat, interaction, doors, and transitions are live, M8 polish has landed
> procedural audio plus a pause/settings menu (mouse sensitivity, FOV, mute), M9 adds a
> first-person viewmodel with attack animation, M12 adds muzzle-aligned bolts,
> destructible crates, a district boss, enterable tower interiors, and stacked-slice
> impostors, and M13 turns the district into a staged mission with a three-bolt overseer
> volley, boss HP bar, and a mission-complete overlay. M14 gives the district a roster: a
> fast rusher, a charged-shot lancer with a visible muzzle telegraph, and a frontal-armor
> bulwark that must be flanked. M15 adds a persistent campaign with keyboard level select,
> mission briefings, best time/kills, and a `NEW BEST` badge. M16 adds a procedural music
> director, per-level ambience, and stage-driven cues. M17 adds SLAGWORKS, a 48×48 foundry
> with cycling slag channels, a coolant collection gate, and the foreman boss. The guardian
> is the only shipped chassis, so every actor renders through its six-state atlas
> (idle/walk/attack/hurt/death/talk).

![Courtyard gameplay](docs/screenshots/gameplay.png)

*A guardian at close range, with the plasma projector viewmodel in the lower-right. The
same courtyard from jetpack altitude, where wall tops and the full actor set are visible,
is in [docs/screenshots/courtyard.png](docs/screenshots/courtyard.png).*

The engine renders a 384×240 framebuffer to Canvas 2D: DDA grid traversal, textured
walls, floors and per-cell tops, a true rotational pitch camera, per-pixel depth, and
jetpack flight up to 18 m. Walls are solid 1.4-unit blocks you can land on; map digits
build walkable 0.2/0.4 stairs and a 0.6 crate. The guardian Blender chassis is rendered
from 16 yaw angles × 4 pitch angles × 19 poses (1,216 frames across idle, walk, attack,
hurt, death, and talk), stylized to 96×96 pixel art by SD1.5 + depth ControlNet
(deterministic palette stylizer as fallback), and packed into one atlas. Height and pitch
drive frame selection, including a dedicated near-overhead row with a compensating
billboard scale, so actors keep a stable apparent size from the floor to the ceiling. A
Blender-rendered first-person viewmodel (both gauntlets plus a plasma projector) animates
through idle, wind-up, strike, and recovery, and bob follows the walk cycle. F/click
launches a plasma bolt along the camera aim from the projector muzzle; marauder gunners
answer with orange bolts that respect walls, and impacts bloom as depth-tested glow
billboards. Five crates break after two bolts, seven risers provide cover, and the 260 HP
overseer guards the district roof with three-bolt volleys. A 64×64 Rooftop District
extends the same movement and combat onto 4–12 m towers, with jetpack traversal, rooftop
sentries, enterable office and vault interiors under 3 m ceilings, and a staged mission:
clear seven hostiles, defeat the overseer, then reach the extraction beacon for the
mission-complete screen. The district fields three distinct roles: a fast low-HP rusher, a
lancer whose orange muzzle glow telegraphs a 20-damage charged bolt, and a slow bulwark
whose frontal plating halves damage until the player flanks it. Actor billboards carry four
depth bands from a separate slice atlas, so near walls cut through the correct part of a
sprite. A fourth level, SLAGWORKS, is a 48×48 foundry: two slag channels burn for 2 s of
every 4 s cycle, three coolant cells and six hostiles gate the 320 HP foreman, and only the
control-room beacon extracts. Campaign progress, best times, and settings persist in
localStorage, and the synthesized audio director follows the mission stage.

**Status:** playable build with four levels, ranged and melee combat with hurt/death
states, NPC dialogue, doors, keycard/medkit/fuel/coolant pickups, level transitions, a
64×64 Rooftop District with 4–12 m towers, enterable interiors, and a boss-gated
extraction, a 48×48 foundry with cycling hazards and a collection gate, a persistent
campaign with level select, synthesized audio with a stage-driven music director, and a
pause/settings menu. Verification runs a 127-scenario deterministic matrix (874 checks,
740 assertions), a 40-check happy-path browser run, an 18-pose airborne flight sweep with
a live jetpack sequence (109 checks), and a 42-check paused-state gallery capturing every
body state.
The M6 AI stylization infrastructure (Blender depth/normal controls, ComfyUI
img2img + ControlNet, silhouette/palette verification, MCP studio server) remains the
asset path. See the [roadmap](docs/ROADMAP.md), [pipeline](docs/PIPELINE.md), and
[progress log](docs/PROGRESS.md).

## Quick start

Requirements: Node.js 20+ (tested on 24). Blender is only needed to regenerate sprites.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests
npm run typecheck
npm run build      # static build in dist/
npm run playtest   # headless Chrome: input, physics, atlas, viewmodel, screenshot checks
npm run playtest:matrix  # 127 deterministic state/interaction/combat/level/foundry scenarios
npm run playtest:flight  # 18 airborne poses + live jetpack sweep, wall/sky/sprite analysis
npm run playtest:states  # paused-state gallery: 42 checks, 21 captures
```

## Controls

| Input | Action |
| --- | --- |
| Click canvas | Lock pointer / enter the demo |
| Mouse | Look (yaw + pitch) |
| `W A S D` | Move |
| `Shift` | Sprint |
| `Space` | Ignite/hold jetpack (ground jump or sustained lift) |
| `F` / left click | Fire plasma bolt (45 damage, 22 m/s, 0.9 s life, 0.45 s cooldown) |
| `E` | Interact: talk, open doors, collect pickups |
| `L` | Open level select from the victory overlay (also in the pause menu) |
| `F2` | Toggle freefly debug mode (`Space` up, `Ctrl`/`C` down) |
| `M` / `Tab` | Toggle minimap |
| `F3` | Toggle detailed HUD |
| `R` | Respawn |
| `Esc` | Release pointer and pause (opens settings) |

The pause panel adjusts mouse sensitivity, field of view, and audio mute; settings and
campaign progress persist locally. Audio is synthesized with WebAudio (a procedural music
director plus per-level ambience) and starts on the first click. Append `?screenshot` to
the URL to hide the overlays for automated captures.

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
| `npm run assets:textures` | `public/assets/textures/*.png` (walls, floors, tops, hazards, props) |
| `npm run assets:blender` | 1,216 raw + 2,432 control PNGs in `assets-src/characters/<id>/` |
| `npm run assets:stylize` | 96×96 palette frames per character |
| `npm run assets:comfy` | 96×96 AI frames (or `--fallback`/`--palette`) |
| `npm run assets:verify` | `artifacts/style-report.json` (gitignored) |
| `npm run assets:atlas` | `atlas.png` (1536×7296) + `atlas.json` |
| `npm run mcp:studio` | stdio MCP tools for atlas generation/repair |

The character commands default to guardian; pass a name only if another chassis has raw
renders and a stylized frame set.

## Repository map

```
src/engine/      DDA, world/collision, renderer, projectiles, glow, atlas loader, input, hazards, audio, math
src/content/      courtyard, reactor, district, and foundry level definitions, actors, props
src/campaign.ts   versioned localStorage campaign record
src/game.ts       player physics, jetpack, camera, animation, minimap, HUD, mission stages
src/main.ts       asset boot, render loop, pointer lock, level select, debug API
tools/assets/     deterministic wall/floor texture generator
tools/blender/    headless turntable + viewmodel: raw, depth, and normal passes
tools/stylize/    palette stylizer, shared downsample, ComfyUI CLI wrapper
tools/comfy/      API-format workflow + placeholder validation + HTTP client
tools/verify/     silhouette IoU and palette-drift metrics/report
tools/atlas/      atlas packer + manifest generator
tools/mcp/        stdio MCP server for atlas generation and single-view repair
tools/playtest/   CDP harness: happy-path run, state matrix, flight sweep, state gallery
.qoder/agents/    playtester subagent definition
tests/            Vitest coverage for DDA, math, world, projectiles, atlas, settings, Comfy workflow, style metrics
docs/             spec, roadmap, progress, architecture, pipeline, handoff, ADRs
```

## Documentation

- [Roadmap](docs/ROADMAP.md) — milestones, checkboxes, acceptance criteria
- [Progress](docs/PROGRESS.md) — current status, verification evidence, session log
- [Architecture](docs/ARCHITECTURE.md) — rendering math and module map
- [Pipeline](docs/PIPELINE.md) — asset generation and atlas schema
- [Playtest matrix](docs/PLAYTEST-MATRIX.md) — scenario catalog, determinism, audit
- [Handoff](docs/HANDOFF.md) — commands, debug API, invariants, next steps
- [Decisions](docs/DECISIONS.md) — architecture decision records
- [Original spec](docs/spec/AI-Sprites-In-Raycasting-Games.pdf)

## License

No license has been chosen yet. Treat the repository as all-rights-reserved until one
is added.
