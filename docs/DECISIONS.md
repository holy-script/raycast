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
