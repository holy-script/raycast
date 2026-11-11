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
1536×2304). Superseded in scope by M9: scout and brute were retired from shipping assets,
so the guardian is the only chassis until a new art pass exists.

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

## ADR-013 — AI stylization behind the atlas contract, with raw-silhouette masking

**Context:** M6 needs a generative style pass without changing the renderer or atlas
format. ComfyUI outputs RGB, geometry can drift, and edge alpha is either missing or
fringed. The palette stylizer must remain available on machines without a GPU server or
when the server is down.

**Decision:** Keep the stage contract at `384×384 RGBA + depth control → 96×96 RGBA` with
the same filenames. Render a normalized depth pass (and a normal pass for future use) in
Blender through the 5.2 compositor node group. Drive an API-format img2img + depth
ControlNet graph from a wrapper (fixed seed, character-aware prompt, configurable models).
After generation, box-downsample both the result and the raw render, take alpha from the
raw mask, then apply the same optional 1 px outline. Add `--palette`/`--fallback` and a
mock-server integration test so the pipeline works without ComfyUI. Put the same CLI
behind a dependency-free stdio MCP server. Verify IoU with a one-pixel outline tolerance
and measure palette drift against adjacent yaw views.

**Consequences:** The renderer and packer stay untouched, AI output cannot exceed the
Blender silhouette, and background fringing is eliminated. Masking means the pass cannot
invent new geometry outside the render; new costume details only affect colour inside the
silhouette. Palette drift is measured for view-to-view consistency, not fidelity to the
raw colours, so a deliberate global restyle is allowed. A real ComfyUI generation still
needs a checkpoint and ControlNet supplied by the operator; the repo only guarantees the
HTTP flow and the fallback. `artifacts/style-report.json` is the tuning input.

## ADR-014 — Reloadable level definitions and cone-strike combat

**Context:** M7 needs dialogue, doors, pickups, combat, and a second map without turning
the demo into a persistent-state RPG or a full entity system. The deterministic matrix
also needs every scenario to start from a byte-identical world.

**Decision:** Describe each level as one `LevelSpec` object (rows, spawn, actors, pickups,
doors, exits) and rebuild the world from it on every load or transition. Reset time,
player state, keycard, pickups, doors, and actor animation phase in `loadLevel`. Combat
is a player cone test (nearest hostile within 2.3 m and 0.7 rad of yaw, 45 damage, 0.45 s
cooldown) plus a small hostile state machine with fixed wind-up/impact/hurt/death timings.
One-shot actor states use their own clock; death holds the final frame and leaves the
actor in the array as a corpse.

**Consequences:** State is always explainable from the current level definition, which
makes the matrix reproducible and level authoring cheap. Transitions reset progress (the
keycard and opened doors do not persist), which is acceptable for a two-level demo but
would need a session/inventory layer for a longer campaign. Actors do not collide with the
player or each other, keeping combat readable at this scale; both would need real work
before larger maps. The cone-strike portion is superseded by ADR-017; the level-reload and
reset rules remain the contract.

## ADR-015 — Procedural WebAudio and persisted local settings

**Context:** M8 needs audio and a pause/settings menu without adding binary assets, a
build step, or state that breaks deterministic playtests. Pointer-lock release already
provided a natural pause point, but the simulation kept running behind the overlay.

**Decision:** Synthesize every sound in WebAudio (oscillator and filtered-noise
envelopes) in `src/engine/audio.ts`; create the AudioContext on the first real gesture,
drop queued events, and let the game emit a small `GameEvent` list that the soundscape
drains each frame. Pointer-lock release now actually pauses the simulation when not in
scripted automation, and the pause overlay became a settings panel (sensitivity
0.4–2.0×, FOV 55–90°, mute). Settings persist in `localStorage` under
`raycast.settings.v1` and are clamped on load.

**Consequences:** No audio files, no network, and no new dependencies; headless runs stay
silent because no gesture creates a context. Game logic remains audio-free and
deterministic, at the cost of a small event-name coupling. LocalStorage may be blocked
(private browsing) and fails open. Settings apply immediately; FOV also widens the
minimap wedge. Projection FOV is fixed at every altitude (ADR-016 supersedes the old
altitude boost).

## ADR-016 — Per-pixel pitched rays replace the column shear

**Context:** Rotational pitch (ADR-008) still cast one ray per column in the horizontal
plane and projected walls vertically. Under pitch, a wall's screen x then depended on its
height, so straight wall tops bowed (up to ~142 px incorrectly, and 49 px of silhouette
residual in the top-pitch captures) while steep look-down views left sky holes between
wall tops and floors. The manual jetpack flight exposed both.

**Decision:** `drawGeometry` traces one camera ray per screen pixel from the pitched basis
(`rayZ = sinP + cosP·yCam`, `horizontal = cosP − sinP·yCam`) and runs DDA along its
horizontal projection. Floor, wall face, and wall top candidates all use the ray
parameter `t` as camera-space depth; sprites compute `zCam` from the same basis and compare
against it. `npm run playtest:flight` locks this in with exact sky-hole classification, a
wall-top straightness fit (264 columns, ≤1.5 px residual), overhead sprite completeness,
and a live-flight FPS floor.

**Consequences:** Straight walls stay straight at every pitch and altitude, and sprite
occlusion shares one depth metric. Render cost rises to 3.4 ms at ground level and 6.8 ms
at 16 m looking down (384×240), still inside a 60 FPS frame. ADR-008's per-column ray and
horizontal-forward depth metric are superseded, as is ADR-015's altitude FOV boost: FOV is
fixed at every altitude and clamped 55–90° from settings.

## ADR-017 — Hitscan-free straight projectiles with heightmap collision

**Context:** M10 needed the plasma projector to fire. A pure hitscan would be cheap and
deterministic but invisible: no travel to read, no dodge or lead, and no impact location
on a wall. A full physics projectile with gravity and bounce would add simulation surface
and make deterministic tests fussier than the 2.5D world warrants. The renderer also has
no 3D depth pass for point lights, so impacts must be billboards.

**Decision:** Projectiles are straight 3D segments integrated in fixed ≤0.08 m substeps
against the same heightmap blocks the renderer draws (`src/engine/projectile.ts`). The
player fires from the camera eye along yaw/pitch; hostiles fire from chest height at the
player's chest after a 3D `hasLineOfSight` check. Collision uses a shared cylinder profile
for actors (radius 0.34, half-height 0.6) and the player (0.26, 0.5). Bolts stop at the
first wall, floor, or target and are removed. Visuals are camera-space billboards from a
procedural radial texture, tinted per faction, with `noShadow`; the impact billboard is
backed out of the struck cell along the bolt vector so the per-pixel depth test does not
cull it. Translucent pixels skip the depth write, so the glow blends over the wall.

**Consequences:** Aim, travel, wall cover, and dodging are all legible, and the whole
simulation is unit-testable without a browser (12 new tests). Bolts do not drop, lead,
penetrate, bounce, or spawn at the viewmodel muzzle; they also cannot be shot down.
Impact flashes near the camera can still read large. Tuning lives in constants:
`PLAYER_BOLT_SPEED/LIFE`, `BOLT_IMPACT_LIFE` in `src/game.ts`, and each actor's `gun` spec
in `src/content/actors.ts`.

## ADR-018 — Snap the death row and give the corpse its own frame

**Context:** The owner killed an enemy and stood against a nearby wall. The corpse showed
two outlines: a larger translucent ghost and a crisp copy. Close-range elevation lands the
corpse's frame centre inside the ±0.12 rad pitch crossfade band, so the billboard blended
the level and high atlas rows; those rows have different baked framing, and the blend
painted both silhouettes. The authored death pose also folded downward into the floor and
read awkwardly from every yaw/pitch.

**Decision:** Static actors (`state === "death"`) resolve pitch with `sampleStaticPitch`,
which quantizes to a single row with `mix = 0`; moving actors keep the crossfade. The death
animation is re-authored as a backward topple around the feet, with the root translated so
the supine body is centred and rests on the ground plane. Prone frames span the cell, so
the death state alone is rendered at a 1.40 ortho scale at every pitch; the manifest's
per-state `frameWorldSize: 1.40` / `frameAnchorZ: -0.20` feed `spriteSelection` and
`buildSprites`, and the engine skips `pitchWorldScale` for corpses. Living rows keep the
0.78 near-overhead render plus 0.678 billboard compensation, so top-down actors do not
grow. Corpse contact shadows widen 1.25×.

**Consequences:** A corpse is one crisp, grounded silhouette at every distance and camera
angle, while living sprite scale and the top-down compensation are unchanged. The atlas
manifest now supports per-state frame overrides (only `death` uses one today). The
`f02-player-kill` matrix check asserts the corpse world size (1.33 m for the 0.95-scale
stalker), and `tests/math.test.ts` locks the static-snap side of each pitch threshold.
