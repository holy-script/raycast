# Architecture

The engine is a CPU renderer writing into an `ImageData` framebuffer and blitting it to
a 384×240 Canvas 2D. All spatial reasoning happens in a top-down 2D plane; verticality is
added with an eye height, a true rotational pitch camera, and a per-pixel depth buffer.
Walls are solid `WALL_HEIGHT` blocks with walked-on tops, so the courtyard reads as a
solid diorama from jetpack altitude and the player can land on a wall to look down.

## Coordinate system

- Map cell `(x, y)` covers `[x, x+1) × [y, y+1)`. Rows increase downward (`+y` is
  "south" on the minimap).
- Yaw `0` points east (`+x`); `yaw = π/2` points south (`+y`), so yaw increases
  clockwise on screen.
- `z` is height in world units. The floor is `z = 0`; the player eye is at
  `z + EYE_HEIGHT`.
- Actor `facing` uses the same angle convention. Frame index 0 is the actor seen from
  the front.

## Module map

| File | Responsibility |
| --- | --- |
| `src/engine/dda.ts` | Grid traversal helpers used by tests and editors; the renderer walks DDA inline per pixel |
| `src/engine/world.ts` | ASCII map parsing, legend heights, room sectors (`ceilings`/`roofs`), solid lookup, wall height / support height, height-aware collision |
| `src/engine/crates.ts` | Destructible crate cells, hit counting, debris rules, cell clearing |
| `src/engine/math.ts` | Angle wrap, yaw/pitch quantization, elevation angle |
| `src/engine/renderer.ts` | Sky, per-pixel floors/faces/tops, roof/lintel/ceiling planes, facade storey sampling, sprites with depth slices, shadows, depth buffer |
| `src/engine/atlas.ts` | Manifest parsing, frame lookup with fallback, slice atlas loading, image loading |
| `src/engine/input.ts` | Pointer lock, key state, one-shot actions, scripted playtest input |
| `src/game.ts` | Player physics, jetpack, combat/interaction, level loading, actor behavior, sprite selection, HUD |
| `src/content/` | Level definitions (rows, heights, surfaces, spawn, actors, pickups, doors, exits) and actor specs |
| `src/content/district-map.ts` | 64×64 Rooftop District rows and legend |
| `src/main.ts` | Asset boot, render loop, DOM/HUD wiring, debug API |
| `tools/blender/` | Headless turntable: raw RGBA, depth, and normal passes |
| `tools/stylize/` | Palette stylizer, shared premultiplied downsample, ComfyUI CLI |
| `tools/comfy/` | API-format workflow, placeholder filling/validation, HTTP client |
| `tools/verify/` | Silhouette IoU and neighbour-yaw palette-drift report |
| `tools/mcp/` | Dependency-free stdio MCP server for atlas generation/repair |
| `tools/playtest/` | CDP browser harness, screenshots, JSON report |

## Camera

```ts
const tanHalf = Math.tan(fov / 2);        // 70° default, configurable 55–90°
dir       = (cos(yaw), sin(yaw));
plane     = (-dirY, dirX) * tanHalf;      // screen-right vector
focal     = (width / 2) / tanHalf;
eyeZ      = player.z + EYE_HEIGHT + eyeBob;
```

Pitch is a real rotation of the camera basis, never a horizon shear. Every screen pixel
builds one 3D ray from the pitched basis:

```ts
yCam       = (centerY - (y + 0.5)) / focal;
xCam       = (x + 0.5 - width / 2) / focal;
rayZ       = sinP + cosP * yCam;
horizontal = cosP - sinP * yCam;          // forward component after pitch
rayX       = dirX * horizontal - dirY * xCam;
rayY       = dirY * horizontal + dirX * xCam;
```

`horizontal` depends on the screen row: pitch changes the horizontal component of each
ray, not only its vertical target. The ray parameter `t` is the camera-space depth along
the pitched forward axis, and floors, wall faces, wall tops, and sprites all use it. Pitch
is clamped to 1.1 rad (~63°) on the ground and 1.45 rad (~83°) airborne. FOV is fixed at
every altitude; only the settings menu can change it (55–90°).

## Walls

Every solid cell is a block from `z = 0` to its own surface height: `WALL_HEIGHT = 1.4`
for `#`/`X`, `0.2 × digit` for map digits `1`–`9` (stairs, ledges, crates), and an explicit
legend height for characters listed in a level's `heights` map. The Rooftop District uses
`a`–`e` at 4/6/8/10/12 m; legend cells map to the facade tile and sample the facade texture
with `v = fract(wallZ / 3)` so window rows repeat every storey. Each pixel walks the grid
with DDA along its horizontal ray, starting at the camera cell and bounded by the world
edge and the floor-plane intersection. The first solid cell produces at most one surface
for that pixel:

```ts
zEntry = eyeZ + entry * rayZ;
faceHit = entry > NEAR_PLANE && zEntry >= 0 && zEntry <= cellHeight;
topHit  = eyeZ > cellHeight && rayZ < 0 &&
          topT = (cellHeight - eyeZ) / rayZ ∈ [entry, nextEntry];
```

A face is painted at its entry distance with texture V derived from the hit height
(`v = (eyeZ + entry·rayZ) / cellHeight`) and texture U from the side coordinate. A top is
painted where the ray crosses `z = cellHeight` inside that cell, sampled by world-space
fractional coordinates. Because the test is per pixel, a face crossing the near plane is
still painted where `entry > NEAR_PLANE`; there is no altitude skip, so walls stay opaque
from every eye height.

Depth is the ray parameter `entry`/`topT`, so a top nearer than the floor plane wins and a
closer wall hides everything behind it. The renderer used to cast one ray per column in
the horizontal plane and shear the vertical spans for pitch; that moved a wall's screen x
with its height and bent straight walls into curves while looking down. The flight suite
(`npm run playtest:flight`) fits the projected wall-top line and fails above 1.5 px of
residual to keep that regression out.

Shade falls off with distance (`1 / (1 + t·0.085)`, scaled by `fogScale` above eye height),
with vertical faces at 76%, and is blended toward the fog color `(16, 18, 30)`.

## Floor and cell tops

For every pixel whose ray points below the horizon (`rayZ < 0`), the walkable floor is the
plane `z = 0` at `floorT = -eyeZ / rayZ`. The sample is textured only when it lands in an
in-bounds walkable cell (`tile === 0`); solid cells are covered by their own tops, which
are the per-cell `topT` hit described above. This is why stairs, platforms, crates, and
wall tops each render at their own height with no global roof plane.

Tops use the world-space fractional coordinate for texture U/V, a bevel from the distance
to the cell edge, and a darker shade than faces. Both floor and tops compare their `t`
against the current pixel depth, so geometry never paints through a nearer wall.

Sky remains only where a pixel has no floor, face, or top candidate. Looking down from
altitude at the map border therefore shows the void beyond the floating island, not a
hole: the analyzer in the flight suite ignores sky runs that reach the bottom of the
frame and flags only enclosed holes between geometry.

## Room sectors

A level can declare `rooms: RoomSpec[]` (`{ x0, y0, x1, y1, ceilingZ, roofZ }`).
`createWorld` validates bounds, ordering (`0 < ceilingZ < roofZ`), and overlap, then stamps
two per-cell floats: `ceilings[cell] = ceilingZ` and `roofs[cell] = roofZ`. The tile stays
solid above the room, so the exterior wall still rises to its legend height while the
carved volume becomes walkable. A room's doorway is an ordinary gap in its tile ring.

The renderer treats a room as a slab between `ceilingZ` and `roofZ` and adds three
candidate surfaces to the per-pixel DDA walk:

- **Roof plane** — when the eye is above `roofZ`, the ray crosses it downward:
  `roofT = (roofZ − eyeZ) / rayZ`, accepted inside the sector cell. Sampled with the top
  texture, so from the air the vault reads as a solid roof.
- **Lintel band** — when a ray enters a carved cell whose `ceilingZ < zEntry < roofZ`,
  the slab edge is painted as a face. This closes the wall band above the doorway; without
  it the doorway would show sky through the building.
- **Ceiling plane** — when the eye is below `ceilingZ` and `rayZ > 0`, the ray crosses the
  underside: `ceilingT = (ceilingZ − eyeZ) / rayZ`, accepted inside the cell. Sampled with
  the facade texture and reported in `stats.ceilingPixels`.

All three share the pixel depth test, so a nearer wall still wins. Indoor flight clamps
`maxAltitude` to `ceilingZ − PLAYER_HEIGHT`, and `stepProjectile` plus `hasLineOfSight`
treat the slab as solid: a bolt fired upward indoors hits the ceiling and stops.

## Depth buffer

`depth: Float32Array(width × height)` stores the camera-space ray parameter `t` of the
nearest opaque surface per pixel:

1. Fill with `Infinity`.
2. Floor, wall face, and wall top write their hit `t` (nearest wins).
3. Sprites compute `zCam` with the same pitched basis and test against the current value,
   skipping pixels where `zCam >= depth[idx]`, and writing where alpha > 0.4.

This is a true 2D depth map, not the 1D column buffer used by Wolfenstein-style engines,
so sprites correctly occlude and are occluded behind partial geometry and at different
heights.

## Sprites

Rendering order: sky → clear depth → floors/wall faces/wall tops (one per-pixel pass) →
shadows and sprites (far to near).

A sprite is centered on `(x, y)`, has `worldSize` world units of height, and its frame
bottom is offset by `anchorZ` (`-0.075` for most states; the prone `death` frames use a
1.40 world frame anchored at `-0.20`). Sprites are screen-aligned billboards:
the atlas already supplies the correct pitch view, so the quad is not tilted in 3D.

```ts
forward  = dx·dirX + dy·dirY;                       // horizontal depth
centerZ  = sprite.z + anchorZ + worldSize / 2;
zCam     = forward·cosP + (centerZ − eyeZ)·sinP;    // camera-space depth
xCam     = −dx·dirY + dy·dirX;
yCam     = −forward·sinP + (centerZ − eyeZ)·cosP;
screenX  = width/2 + focal·xCam/zCam;
screenY  = centerY − focal·yCam/zCam;
heightPx = max(2, focal·worldSize/zCam);
widthPx  = heightPx · frameW/frameH;
```

`zCam` stays positive for actors below an overhead camera even while `forward ≈ 0`. The
old code divided by the horizontal distance, which shrank overhead sprites to a line and
then flung them off-screen. Sprites at `zCam ≤ 0.12` are rejected. Occlusion compares the
same `zCam` against the geometry pass's per-pixel `t`, so sprite depth and wall/floor
depth share one metric under pitch.

Per pixel: sample the atlas rect, multiply RGB by the actor tint and distance shade,
blend by alpha, and update depth for opaque pixels. A soft elliptical shadow fades out at
the actor's ground position when `z < 2.5`; `SpriteDraw.shadowScale` widens it for prone
corpses. `SpriteDraw.noShadow` skips the shadow for glowing projectiles and impact
flashes; their translucent pixels do not write depth, so the glow blends over the wall it
struck instead of clipping against it.

### Depth slices

A flat billboard cannot intersect a wall: the whole sprite is either in front or behind.
The atlas packer now condenses each frame's four depth-control views into a gray
`slices.png` that mirrors the color atlas layout, with four bands per frame and per-band
camera-space offsets. Manifest v2 carries
`slices { image, bands, offsets, depthNear, depthFar, depthCuts }`; manifests without it
keep the single-quad path.

`drawSprite` draws the same quad once per band, far→near, with `viewZ = zCam + offset[band]`
and the band's own depth test. The color atlas is unchanged; the slice atlas only supplies
which band a pixel belongs to, so a wall that cuts through an actor's feet occludes the
lower bands while the torso still draws. Bands are pixel-masked against `depthCuts`; the
base quad is used beyond `SLICE_LOD_DISTANCE = 8 m`, where the offsets are sub-pixel.

### Directional frame selection

```ts
relative   = actor.facing - atan2(camY - actorY, camX - actorX);  // wrapped
yawIndex   = round(relative / (2π / directions)) mod directions;
centerZ    = actor.z + anchorZ + worldSize / 2;
elevation  = atan2(camEyeZ - centerZ, distance);
pitchIndex = quantizePitch(elevation, manifest.pitches);
frameIndex = floor(stateClock * state.fps) % state.frames;
```

`stateClock` is the per-actor `animTime` for looping `idle`/`walk` and the time since the
state began for `attack`/`hurt`/`death`/`talk`. `death` clamps to its final frame.

`quantizePitch` uses bands centred between the atlas elevations. With four pitches
(`[-0.31, 0, 0.49, 1.25]` rad) the thresholds are `0.87 → top`, `0.245 → high`,
`-0.155 → level`, otherwise low. A three-pitch atlas keeps the earlier ±0.1 bands, so
manifest-driven atlases of either size work.

Moving actors crossfade between adjacent pitch rows inside ±0.12 rad bands of a
threshold. Static corpses snap to the nearest row instead (`sampleStaticPitch`):
blending two baked views of a still body reads as a second, larger translucent
silhouette, which is especially visible when the player stands over a corpse pinned
against a wall.

`ActorSpec.sprite` selects the loaded atlas (`guardian` is the only shipped chassis).
`SpriteAtlas.getFrame(state, pitch, yaw, frame)` resolves exact entries, falls back to the
level row, then to `idle/level/yaw/0`, so partially generated atlases still render.

The near-overhead row is rendered through a tighter 0.78 orthographic frame, and the
manifest's `pitchWorldScale` (`[1, 1, 1, 0.678]`) shrinks that billboard so actors do not
grow as the camera rises. The death state is the exception: a prone body spans the whole
cell length, so every pitch row is rendered with a 1.40 ortho scale, its manifest entry
carries `frameWorldSize: 1.40` / `frameAnchorZ: -0.20`, and `spriteSelection` skips the
pitch compensation for corpses. `spriteSelection` and `buildSprites` read that per-state
frame size and anchor, keeping the corpse's ground contact on the floor at every pitch.
Corpses also widen the soft contact shadow (`shadowScale 1.25`) so the low body reads
against the floor.

Tint is an RGB multiplier; one atlas can therefore serve several color variants without
new renders.

## Player physics

| Constant | Value |
| --- | --- |
| Eye height | 0.55 |
| Collision radius | 0.19 |
| Walk / sprint | 3.0 / 4.6 units·s⁻¹ |
| Fly speed (F2 debug) | 4.0 |
| Gravity | 18 units·s⁻² |
| Jump impulse | 3.0 |
| Jet thrust / max climb | 34 units·s⁻² / 5.6 units·s⁻¹ |
| Jet fuel / refuel | 5 s of burn / 0.5 per second on the ground |
| Terminal fall | 15 units·s⁻¹ |
| Max altitude | 18 outdoors; indoors `ceilingZ − 1.4` |
| Mouse sensitivity | 0.0022 rad·px⁻¹ |
| Pitch limit | 1.1 rad ground, 1.45 rad airborne |

Horizontal movement is resolved per axis so sliding along walls works. Collision samples
nine points on the player circle; `canOccupy(..., z, maxStep)` rejects a destination whose
tile height is above `z + maxStep`, so a wall blocks at ground level, a 0.2/0.4 stair
tread is walkable (`STEP_UP = 0.3`), and a 0.6 crate needs a jump. Destinations above a
surface are allowed, so the player can also fly onto it. The map edge stays blocked at
every altitude. `supportHeight` samples the cell under the player's centre (a footprint
sample would lift the player onto any wall they stand next to) and returns that cell's
surface height.

Gravity integrates `vz`; the player lands on the support height rather than always `z = 0`.
While grounded, a step down within `STEP_UP` snaps to the lower tread instead of
free-falling. Jetpack thrust, refuelling, and the grounded flag all key off that support,
so the player can climb the demo stairs onto a 0.4 platform, fly onto a wall top, perch
there (`PERCH · 1.4 m` in the HUD), look down at the courtyard, and step off to fall back
to the floor. Freefly clamps `z` to `[support, MAX_ALTITUDE]`. Inside a room (`ceilingAt`
above the player) `maxAltitude()` returns `min(MAX_ALTITUDE, ceilingZ − PLAYER_HEIGHT)`, so
the jetpack caps about 0.2 m below a 3 m ceiling and the player never pokes through the slab.

Holding `Space` burns fuel and thrusts upward from the ground or midair. At `MAX_ALTITUDE`
the clamp zeroes upward velocity while thrusting, so the player can hover and look down
without chattering. Landing refuels. `F2` toggles a fuel-free freefly debug mode.

Projection FOV is fixed at every altitude (55–90° from settings, 70° default), so scale
and straight lines stay stable while flying. Only fog attenuation scales down at altitude
(`fogScale = clamp(1 − (eyeZ − 1.5)/24, 0.35, 1)`) so the whole courtyard stays readable.

## Levels, combat, and interaction

`src/content/levels.ts` defines each level as `{ id, title, objective, rows, heights?,
rooms?, floorTexture?, topTexture?, spawn, actors, pickups, doors, exits, huntTargets? }`.
`Game.loadLevel(index)` rebuilds the `World` from the rows, then deterministically resets
time, player pose/health/fuel/cooldown, keycard, hunt progress, crate hits, and actor
animation phase (`index × 0.37`). Exits target another level id; the beacon prop marks the
pad. Because the world is rebuilt, pickups, opened doors, crates, and the keycard reset on
every transition — the demo loop is one-way per visit.

Three levels ship: the 24×24 courtyard, the 24×24 reactor deck, and the 64×64 Rooftop
District. The district declares legend heights, asphalt floors, roof tops,
`rooms: DISTRICT_ROOMS`, and `huntTargets: 8`; its actors, pickups, and exits can carry a
`z` altitude. Two rooms are carved: the NW security office (x 2–8, y 4–8, ceiling 3 m
under a 4 m roof) and the SE vault (x 51–57, y 54–59, ceiling 3 m under the 12 m tower),
each with a doorway and an indoor pickup. Grounded content validates against open floor,
while elevated content must sit on a solid cell whose surface matches its `z`. The
courtyard gate beacon at (2.5, 22.5) enters the district, and the plaza beacon returns.

Actor states are `idle | walk | attack | hurt | death | talk`. Hostiles (`hostile: true`)
either stalk the player (`chase`) or hold a position and shoot when they have line of
sight (`sentry`). Sentries must stand on the outer roof cell of their tower: one cell
inward, the parapet clips their own downward sight line. Once within reach, chasers enter
`attack`:

| Timing | Value |
| --- | --- |
| Enemy attack impact / total | 0.20 s / 0.40 s |
| Hurt / death state time | 0.25 s / 0.67 s |
| Player bolt | 45 dmg, 22 m/s, 0.9 s life, 0.45 s cooldown |
| Player max health / redeploy | 100 / 1.4 s |
| Hostile melee (wind-up) | 8–14 per hit |
| Marauder gun | 11 dmg, 9 m range, 1.7 s cooldown, 9 m/s bolt |
| District street gunner | 8 dmg, 13 m range, 1.7 s cooldown, 9 m/s bolt |
| District roof sentry | 9–10 dmg, 18–20 m range, 1.9–2.0 s cooldown, 10 m/s bolt |
| District overseer (boss) | 260 HP, 7 dmg, 16 m range, 1.3 s cooldown, 11 m/s bolt, 1.4 rad/s turn |
| Destructible crate | 1.4 m tall, 2 player bolts, `CRATE DESTROYED` toast |
| Interaction radius | talk/door 2.4 m, pickup 0.5 m, exit pad 0.6 m |

`attack()` spawns a player bolt at the viewmodel muzzle rather than the eye: the camera-space
offset is right 0.18 m, up −0.08 m, forward 0.35 m, rotated into world space. If that point
sits inside solid geometry or outside the room, the eye is used instead. Damage, travel,
and hit resolution are owned by the projectile step. A hit applies damage plus 0.18
knockback and switches the actor to `hurt` or `death`. Dead actors stay in the actor array
with `alive = false` so the final death frame still draws as a corpse; they no longer
update, attack, or accept further hits.

`src/engine/crates.ts` marks cells containing `X` at 1.4 m. Player bolts call
`damageCrateAt(x, y)` when they stop on a crate; each hit is counted per cell and, on the
second hit, `clearCrate` zeroes the tile and height so movement and raycasts agree. The
kill emits debris from the hit point and toasts `CRATE DESTROYED`. Crates are part of the
level grid, so they reset on reload like doors.

Hostiles with a `gun` spec (the courtyard marauder, the district gunners, and the rooftop
sentries) check distance, cooldown, and a 3D-sampled `hasLineOfSight` before entering
`attack`; at `ATTACK_IMPACT` (0.20 s) they fire a bolt aimed at the player's chest. A
`sentry` holds position and faces the player; a `chase` hostile with a gun keeps closing
in and falls back to melee inside `attack.range`. Gun-only hostiles omit `attack` entirely.
Enemy bolts do not lead the target.

`interact()` returns `none | talk | door | locked | pickup`. Doors are grid cells marked
`D` with a `DoorSpec`; opening one clears both the tile id and its height so movement and
raycasts agree, and a door with `requires: "keycard"` refuses until the player has one.
Pickups are billboards collected within a 0.5 m 3D radius: keycard sets the flag, medkit
heals, fuel refills. Exits compare horizontal distance and the player's altitude to the
pad's `z`, so a beacon on a roof cannot be triggered from the street. A level with
`huntTargets` keeps every exit locked until that many hostiles die; the HUD objective
appends the live `killed/targets` count and a refused exit toasts the remaining hunters.
The HUD surfaces the current prompt (`E · talk`, `E · sealed — keycard required`, …) and a
transient toast for outcomes.

Prop billboards (pickups, beacon) share the sprite renderer with `worldSize` and a surface
`z` from the level spec; the beacon pulses and the pickups bob so they read as interactive
objects.

## Projectiles and impacts

`src/engine/projectile.ts` owns the simulation. A projectile is a straight segment
`{x, y, z, vx, vy, vz, life, damage, fromPlayer}`. `stepProjectile` splits each frame's
travel into slices of at most `BOLT_SUBSTEP = 0.08` m so a 22 m/s bolt cannot tunnel
through a 0.2 m stair tread, and reports `fly | wall | ceiling | floor | expired`:

- `floor` when the segment reaches `z ≤ 0`.
- `wall` on an out-of-bounds cell or when `z ≤ height + 1e-4` for a solid cell.
- `ceiling` when the segment rises through a room's `ceilingZ` inside that sector.
- `expired` when `life` runs out; the bolt is discarded.

Wall/floor hits and actor hits are checked only on surviving slices. Player bolts test
hostile actors with `projectileHitsActor` (center `z + 0.62`, radius 0.34, half-height
0.6); enemy bolts test the player with `projectileHitsPlayer` (center `z + 0.5`, radius
0.26, half-height 0.5). A bolt damages only the first target and is removed.

`hasLineOfSight` walks the same world in 0.1 m samples in 3D, returning false when a
solid cell is above the sample height or the sample crosses a room ceiling. The marauder
samples from `actor.z + 0.9` to `player.z + 0.5`; the player's own shots need no LOS check
because the bolt collides.

Glow billboards make the shots readable. `createGlowTexture(32)` builds a white radial
alpha ramp; `Game.buildBoltSprites()` projects bolts as `worldSize 0.24` sprites tinted
cyan (`[0.55, 1.15, 1.35]`) for the player and orange (`[1.35, 0.72, 0.42]`) for
hostiles. Impacts are `0.3 + t·0.55` m, fade with `(1 − t)²` over `BOLT_IMPACT_LIFE =
0.14` s, and skip shadows. Because the depth test would cull a billboard sitting inside
the struck cell, `updateProjectiles` backs the impact out by `min(0.06, speed·dt)` along
the bolt direction (minimum `z = 0.03`). Translucent glow pixels do not write depth, so
they blend over wall faces.

## First-person viewmodel

`Renderer.render(...)` accepts an optional `ViewmodelDraw` and composites it after all
world sprites, before `putImageData`. The overlay has no depth test by design: it is the
player's own weapon, so world geometry must not clip it. `public/assets/sprites/player/`
holds five 256×208 RGBA frames rendered in Blender with a perspective 35 mm camera
(`tools/blender/render_viewmodel.py`): `idle0`, `idle1`, `windup`, `strike`, `recover`.

`Game.viewmodelState()` maps the attack cooldown to a pose and returns a bob offset:

| Elapsed since strike | Pose |
| --- | --- |
| < 0.09 s | `windup` |
| < 0.22 s | `strike` (muzzle flash) |
| < 0.36 s | `recover` |
| otherwise | `idle0` / `idle1`, alternating every 0.9 s |

Walking adds a sine bob from `player.bobPhase`; a dead player pushes the overlay down.
The draw origin is rounded to whole pixels because fractional indices on a
`Uint8ClampedArray` are silently ignored — the overlay rendered nothing at bob offsets
until this was fixed.

## Render loop

`main.ts` runs `game.update(dt)` → `game.render()` → `game.drawMinimap(...)` inside
`requestAnimationFrame`. `dt` is clamped to 50 ms. HUD values update at ~10 Hz; FPS is
smoothed with a 90/10 exponential average. The framebuffer is scaled with CSS
`image-rendering: pixelated`.

## Asset generation and AI stylization

The runtime consumes `public/assets/sprites/guardian/atlas.{png,json}` and the committed
viewmodel frames; every stage before that is offline tooling, so the renderer has no
ComfyUI dependency. Tool defaults are guardian-only.

1. `tools/blender/render_turntable.py` renders each pose/yaw/pitch cell three times:
   RGBA colour, normalized depth (3.2–5.0 → white–black), and encoded normals (black
   background). Controls use the Blender 5.2 compositor node group and few samples.
2. `tools/stylize/pixel-art.ts` is the deterministic fallback: premultiplied 4× downsample,
   alpha cutoff, saturation/contrast punch, fixed-palette quantization, 1 px outline.
3. `tools/stylize/comfy.ts` fills `tools/comfy/workflow_api.json` (img2img + depth
   ControlNet + fixed seed), uploads raw/control pairs, polls the ComfyUI history, and
   downloads results. Its `finalizeFrame` downsamples to 96², **takes alpha from the raw
   mask** (the silhouette authority), optionally adds the outline, and writes the frame.
   `--palette` and `--fallback` keep the pipeline usable offline.
4. `tools/atlas/pack.ts` packs frames row-major and emits the manifest; direction/pitch
   counts come from filenames, so the renderer is unchanged.
5. `tools/verify/style.ts` checks silhouette IoU (one-pixel tolerance for the outline) and
   mean colour drift between adjacent yaw views; the report lands in `artifacts/`.
6. `tools/mcp/studio.ts` wraps steps 3–5 in an MCP stdio server with
   `generate_character_atlas` and `regenerate_view`; stdout is JSON-RPC only.

The pipeline contract and every flag are documented in [PIPELINE.md](PIPELINE.md).

## Playtest harness

`tools/playtest/run.ts` starts Vite on a fixed port, launches headless Chrome, and drives
the game through `window.__raycast.automation` (scripted keys and look deltas, no pointer
lock). It also reads `window.__raycast.debug()`, which returns the camera, player, actor
screen rects, and renderer stats (`wallColumns`, `wallPixels`, per-sprite opaque `pixels`
and width/height of the visible silhouette).

The 40 checks cover movement, collision, jetpack lift/landing/refuel, altitude ceiling,
pitch clamps, front/back frame indices, guardian atlas completeness, viewmodel pose and
coverage, fixed FOV, and page errors, plus these regressions:

| Check | Assertion |
| --- | --- |
| Wall faces stay opaque while airborne | `wallColumns = 384` and > 8k wall pixels from altitude |
| Close wall fills the screen | 384 columns and > 85k wall pixels pressed against a wall |
| Near wall survives a steep look-down | 384 columns and > 20k wall pixels |
| Overhead sprite keeps a silhouette | visible `contentW ≥ 4`, `contentH ≥ 6`, `pixels ≥ 24` |
| Overhead sprite stays centred | projected centre within 48 px of screen centre |
| Overhead edge actor stays in view | actor near the map edge still visible and centred |
| Top-down actor scale | top pitch uses the 0.78 m compensated billboard |
| FOV stays fixed with altitude | identical `fovDegrees`/`tanHalf` at ground and 16 m |
| Viewmodel renders and animates | > 2,000 overlay px; idle → strike → idle poses |
| Player lands on a wall top | `z ≈ 1.4`, `support ≈ 1.4`, `onGround` |
| Stepping off drops to the floor | `z ≤ 0.001`, `support ≤ 0.001` |
| Wall-side landing does not wedge | dropped at x=1.05, ejected to x ≥ 1.18, walks away |
| Atlas has no missing frames | `atlasReport().guardian.missing.length = 0` |
| Walking up steps reaches the 0.4 platform | `support ≈ 0.4`, `z ≈ 0.4`, `onGround` |
| Stepped blocks render top surfaces | `topPixels > 500` from the stair approach |
| A 0.6 crate blocks walking | stopped at `y > 14.1`, support 0 |
| The crate occludes the scholar | visible sprite with `occluded > 100` pixels |
| Landing on the crate stops at 0.6 | `z ≈ 0.6`, `support ≈ 0.6`, `onGround` |

Screenshots and a JSON report land in `docs/screenshots/playtest/`.

The companion harnesses share `tools/playtest/support.ts` (contact sheets, sky-row
classification, image metrics):

- `playtest:matrix` — 113 deterministic scenarios, 752 checks, golden-frame comparison.
- `playtest:states` — paused player/guardian animation gallery, 42 checks.
- `playtest:flight` — 18 altitude/pitch poses plus a live jetpack flight, 109 checks. It
  classifies every canvas pixel against the sky gradient, flags enclosed sky holes, fits the
  wall-top silhouette (max residual ≤ 1.5 px over 264 columns), asserts overhead sprite
  content is unclipped, and enforces a real-time loop of at least 45 FPS.

The flight suite is the regression gate for perspective-correct geometry: the old
horizontal-ray plus vertical-shear projection produced up to 49 px of wall-top residuals
and hundreds of enclosed sky holes; the per-pixel renderer measures 0.00 px and zero
holes.

## Performance notes

At 384×240 the framebuffer has ~92k pixels. The geometry pass walks the grid once per
pixel (bounded by the floor-plane hit and DDA steps), sprites are bounded by their screen
rect, and the row/column ray bases are reused across the pass. Measured in headless Chrome
on Apple Silicon (M-series) with the courtyard actors by wrapping `renderer.render`:

| Pose | `render()` |
| --- | --- |
| Courtyard, ground level | 3.4 ms |
| Courtyard from 16 m, looking down | 6.8 ms |
| Overhead at 14 m | 3.7 ms |

The worst measured pose still renders in under half of a 60 FPS frame. The live loop runs
at ~60 FPS, and `npm run playtest:flight` fails if the real-time loop drops below 45 FPS
or hits a page error. The dominant memory cost is the decoded six-state guardian atlas
(~45 MB), plus ~1 MB of viewmodel frames; it is documented under known issues in
[PROGRESS.md](PROGRESS.md) and only matters if more characters are added.

