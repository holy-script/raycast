# Architecture decisions

One entry per decision that would be expensive or confusing to reverse. Newest at the
bottom.

## ADR-001 — TypeScript, Vite, and a software framebuffer

**Context:** The project owner is a JS/TS developer new to engines; the goal is a runnable,
inspectable 2.5D demo with a fast edit loop and no native build chain.

**Decision:** Implement the renderer in TypeScript and write pixels into a 384×240
`ImageData`, upscaled by CSS. Use Vite for dev/build and Vitest for tests.

**Consequences:** The full render path is debuggable in the browser, with no shader or
WebGL abstractions. Resolution is fixed and low, which is appropriate for the pixel-art
look. WebGL/GPU work remains an option later behind the Renderer boundary.

## ADR-002 — Flat grid first, sectors second

**Context:** The spec calls for variable sector heights, BSP trees, and true 3D collision.
Implementing BSP and sector rendering before the sprite and pipeline work would delay the
project's end goal (move vertically, generate multi-angle sprites).

**Decision:** Start with a uniform grid and constant wall height (`WALL_HEIGHT = 1.4`).
Keep z-axis physics, pitch and occlusion height-aware from day one. Add variable-height
sectors in M5 without changing the camera or sprite contracts.

**Consequences:** Vertical movement and pitch work now; stairs and ledges do not. The
depth buffer and sprite math already account for height, so sectors should not require a
renderer rewrite. Low-angle sprite frames cannot be exercised until a raised floor exists.

## ADR-003 — Per-pixel depth buffer instead of a 1D wall buffer

**Context:** Classic raycasters clip sprites with a per-column wall distance, which fails
when walls have different heights or when sprites are partially occluded by low geometry.

**Decision:** Use `Float32Array(width × height)` and test every wall, floor and sprite pixel
against it.

**Consequences:** Partial occlusion and height-aware sprites work naturally. The cost is
one array write per opaque pixel, which is negligible at 384×240. Transparent sprite pixels
do not write depth (alpha threshold 0.6), so particles/glass need a separate policy later.

## ADR-004 — Blender proxy plus deterministic palette stylizer

**Context:** AI generators (ComfyUI, Gamelabs, AutoSprite) can produce frames, but early
integration needs reproducibility and consistent geometry across 144 views.

**Decision:** Render a rigged proxy in Blender headless, then stylize with a deterministic
downsample + palette quantizer + outline. Treat the AI pass as a swappable stage 3 behind
the same filename/format contract.

**Consequences:** The atlas can be regenerated exactly and the renderer can be developed
without API keys or GPU dependence. The visual style is limited but coherent. M6 can
replace the stylizer without touching the engine or atlas format.

## ADR-005 — One atlas, one manifest, per-actor tint

**Context:** The demo needs five visually distinct NPCs. Rendering each separately would
multiply the pipeline cost.

**Decision:** Generate one character atlas and recolor actors with an RGB multiplier in
`SpriteDraw.tint`. Pack frames into a uniform grid and describe them in `atlas.json`.

**Consequences:** Five variants cost one atlas. Tinting cannot recolor details independently
(e.g. a different jacket and pants scheme), so genuinely different characters need their own
atlas later. The manifest makes that a data change, not an engine change.

## ADR-006 — Procedural textures committed as PNGs

**Context:** The renderer needs wall/floor textures immediately and they should be
regenerable without external art tools.

**Decision:** Generate 64×64 textures in TypeScript and commit the PNGs.

**Consequences:** A clean clone runs without a build step for assets. The generator doubles
as documentation for the visual language. Committed PNGs avoid CI needing to run the
generator, but must be regenerated manually if the generator changes.

## ADR-007 — 8-way yaw, 3 pitch, manifest-driven direction count

**Context:** The spec describes 8- or 16-way yaw, plus three pitch states. Asset cost grows
multiplicatively.

**Decision:** Ship 8-way × 3 pitch. Keep `directions` in the manifest and make the engine
read it, so a 16-way atlas is a data upgrade. Provide level-pitch fallback for missing rows.

**Consequences:** 144 frames per character is manageable. A 16-way character requires 288
frames and a new Blender yaw count (`--yaws 16`). The engine already supports it.
Superseded by ADR-009 for the shipped build.

## ADR-008 — Rotational pitch and a wall-top plane

**Context:** Y-shear pitch cannot look straight down: geometry compresses into a band and
sprites disappear, which blocks the aerial view the jetpack made possible.

**Decision:** Rotate the camera basis (forward/right/up) and project every wall, floor,
roof, and sprite pixel through the same pinhole. Above wall height, skip wall faces and
draw wall tops with a second plane intersection (`roofT`). Fill wall bodies where an
overhead ray grazes a top and lands on a farther solid cell.

**Consequences:** Steep downward pitch and true aerial framing work, at the cost of a
per-pixel 3D ray in the floor pass and a few extra branches. Pitch must stay short of
vertical so `rayZ < 0`; the limits enforce that. Any future geometry must use the same
scene depth metric (horizontal forward distance). The wall-face skip was removed in
ADR-010; wall tops are still drawn by this plane pass.

## ADR-009 — Three character atlases at 16 directions

**Context:** ADR-005's single tinted atlas made all actors read as recolors, and ADR-007's
8-way atlas showed visible angular stepping when orbiting.

**Decision:** Render three chassis (guardian, scout, brute) with shared rig geometry but
distinct palette/proportions, at 16 yaws × 3 pitches × 6 poses. Emit one 1536×1728 atlas
per character, load all three, and let `ActorSpec.sprite` select. Tints and per-actor scale
still provide variants within a chassis.

**Consequences:** 864 Blender frames and roughly 1.7 MB per atlas, but actors are
unmistakably distinct and 22.5° yaw steps look smooth. The packer detects direction counts
from filenames, so smaller atlases remain valid. Adding a character is a data + spec
change, not an engine change. Superseded in counts by ADR-010 (4 pitches, 1152 frames,
1536×2304).

## ADR-010 — Camera-space billboards, wall faces at altitude, and a top pitch

**Context:** Flying over actors collapsed them from 2D to 1D and then showed their backs;
actors also drifted far outside the map as altitude rose. Meanwhile walls vanished when
the eye rose above them ("transparent" walls) and a wall pressed against the camera
fisheye-stretched and disappeared.

**Decision:** Project sprite centers into full 3D camera space and draw them as
screen-aligned quads sized by camera-space depth `zCam`, while keeping horizontal
`forward` only for occlusion. Render wall faces at every eye height, clip them at
`zCam = 0.01`, and compute wall texture V per scanline by inverting the pitch projection.
Add a fourth atlas pitch (top, 1.25 rad) with a tighter 0.78 ortho scale and raise the
airborne pitch limit to 1.45 rad.

**Consequences:** Overhead actors stay readable and centred, and walls remain solid from
any altitude or distance. Sprite screen size now depends on the vertical camera angle,
which is expected for billboards; a true 3D sprite volume would need a different approach.
The atlas is 33% larger (384 frames, 1536×2304). The playtest asserts wall-column counts
and sprite silhouette bounds so these defects cannot silently return.

## ADR-011 — Walls as walkable constant-height blocks

**Context:** The aerial view is only useful if the player can land somewhere and inspect
actors from above. Before sectors exist, walls are the only raised surfaces.

**Decision:** Treat solid cells as `WALL_HEIGHT = 1.4` platforms. Add `tileHeightAt`,
`supportHeight`, and a z argument to `canOccupy`; land on support height, track grounded
state, and clamp freefly to `[support, MAX_ALTITUDE]`. Generalize the same path to
per-cell heights in M5.

**Consequences:** The player can perch on walls and step off to fall, with no new geometry
format. Collision now depends on the player's feet height, so a wall blocks at ground
level but not from above. Constant height means all walls are equal; M5 replaces
`tileHeightAt` with a sector lookup and adds risers/stairs.

## ADR-012 — Heightmap blocks instead of Doom-style sectors

**Context:** M5 needs stairs, a raised platform, and a waist-high crate with correct
collision and rendering. A full sector model (per-cell floor and ceiling heights, BSP,
portals) is the textbook raycaster answer but is much larger than this demo requires.

**Decision:** Store one surface height per solid cell in `World.heights` and grow every
block from `z = 0`. Map digits `1`–`9` are solid panel platforms at `0.2 × digit`; `#`/`X`
stay at `WALL_HEIGHT = 1.4`; the walkable floor remains the zero plane. `castRayHits`
returns all solid cells with height/exit distance, and the renderer draws each face and
per-cell top independently. Step-up is limited by `STEP_UP = 0.3`.

**Consequences:** Stairs, platforms, crates, and walls share one representation and one
collision path, and low geometry never hides taller geometry behind it. Pits, overhangs,
doors, and ceilings are not representable; adding them would require the sector model.
Because `Float32Array` stores heights imprecisely (0.2 becomes 0.20000000298),
height assertions in tests use `toBeCloseTo`.
