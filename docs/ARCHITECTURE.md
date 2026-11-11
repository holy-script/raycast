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
| `src/engine/dda.ts` | Grid traversal; returns perpendicular distance, side, tile, `wallU` |
| `src/engine/world.ts` | ASCII map parsing, solid lookup, wall height / support height, height-aware collision |
| `src/engine/math.ts` | Angle wrap, yaw/pitch quantization, elevation angle |
| `src/engine/renderer.ts` | Sky, walls, floor, wall tops, sprites, shadows, depth buffer |
| `src/engine/atlas.ts` | Manifest parsing, frame lookup with fallback, image loading |
| `src/engine/input.ts` | Pointer lock, key state, one-shot actions, scripted playtest input |
| `src/game.ts` | Player physics, jetpack, camera state, actor behavior, sprite selection, HUD |
| `src/content/` | ASCII map, spawn, actor specs (sprite id, behavior, tint, scale) |
| `src/main.ts` | Asset boot, render loop, DOM/HUD wiring, debug API |
| `tools/playtest/` | CDP browser harness, screenshots, JSON report |

## Camera

```ts
const tanHalf = Math.tan(fov / 2);        // 70° on the ground, up to 100° at altitude
dir       = (cos(yaw), sin(yaw));
plane     = (-dirY, dirX) * tanHalf;      // screen-right vector
focal     = (width / 2) / tanHalf;
eyeZ      = player.z + EYE_HEIGHT + eyeBob;
```

Pitch is a real camera rotation, not a horizon shear. Floor and roof pixels are cast with
a full 3D ray per screen pixel:

```ts
forward = (dirX * cosP, dirY * cosP, sinP);
right   = (-dirY, dirX, 0);
up      = (-dirX * sinP, -dirY * sinP, cosP);
ray     = forward + right * xCam + up * yCam;
```

Walls use the matching pinhole projection (sprites share the camera-space transform but
are drawn screen-aligned):

```ts
projectYClipped(cam, forward, dz):
  zCam = forward * cosP + dz * sinP;
  yCam = -forward * sinP + dz * cosP;
  if (zCam > 0.01) return H / 2 - focal * yCam / zCam;
  return yCam >= 0 ? -1e6 : 1e6;
```

`forward` is the horizontal camera-space distance and `dz` is height relative to the eye.
This supports looking steeply down without the vertical compression of a shear. Pitch is
clamped to 1.1 rad (~63°) on the ground and 1.45 rad (~83°) airborne, keeping every ray
pointing downward.

## Walls

Every solid cell is a block from `z = 0` to its own surface height: `WALL_HEIGHT = 1.4`
for `#`/`X`, and `0.2 × digit` for map digits `1`–`9` (stairs, ledges, crates). For each
screen column `castRayHits` traverses the grid and returns *every* solid cell the ray
enters, near to far, each with its `height` and `exitDistance`. Drawing all hits means a
low step never hides a taller wall behind it.

```ts
for (const hit of hits) {
  yTop    = projectYClipped(cam, hit.distance, hit.height - eyeZ);
  yBottom = projectYClipped(cam, hit.distance, -eyeZ);
  texX    = floor(hit.wallU * texture.width);
}
```

When the camera stands on a solid cell, `castRayHits` also emits that cell at distance 0
with its exit distance. The renderer skips its face (there is none facing the camera) but
draws its top, so steep downward rays have a surface instead of leaving sky holes below
the player.

`projectYClipped` rotates the point into camera space and handles the near plane:
`zCam = d·cosP + dz·sinP`. When `zCam` is at or behind `NEAR_PLANE = 0.01` it returns a
sentinel far off-screen instead of dividing by zero. A face whose top and bottom are both
behind the near plane is skipped; a face that merely crosses it is still painted, so a
wall stays solid while the player is pressed against it. There is no altitude skip: wall
faces render at every eye height, which is what prevents the "transparent walls" look from
above.

Texture V is not interpolated from the clipped screen span, because that breaks when the
face crosses the near plane. Instead each scanline inverts the projection exactly:

```ts
s  = (centerY - (y + 0.5)) / focal;            // camera-space up/forward slope
dz = d * (sinP + s·cosP) / (cosP - s·sinP);    // height relative to the eye
t  = (dz + eyeZ) / hit.height;                 // 0 at the floor, 1 at the top
```

Shade falls off with distance (`1 / (1 + d·0.085)`), with vertical faces at 76%, and is
blended toward the fog color `(16, 18, 30)`.

## Floor and cell tops

The walkable floor is one plane at `z = 0`. Every pixel below the horizon casts an exact
3D ray and intersects it (`floorT = -eyeZ / rayZ`); the sample is textured only when it
lands in an in-bounds walkable cell (`tile === 0`). Out-of-bounds and solid-cell hits
stay sky here, because solid cells get their own tops.

Tops are drawn per DDA hit, not from a single global roof plane. For a cell of height
`h`, the screen rows between the projections of its near and far boundaries are scanned,
and each row inverts the pitch projection to find where the view ray crosses `z = h`:

```ts
s        = (centerY - (y + 0.5)) / focal;
distance = dz·(cosP - s·sinP) / (s·cosP + sinP);   // dz = h - eyeZ
```

The sample is kept only when it falls inside `[mapX, mapX+1) × [mapY, mapY+1)`, so each
stair tread, platform, crate and wall gets its own top at its own height. Tops use a
bright edge highlight (`×1.32`) and a darker interior (`×0.82`).

Only pixels nearer than `depth[idx]` are drawn, so floor and wall tops are rejected
behind walls. Depth stores horizontal forward distance, matching wall and sprite depth.

## Depth buffer

`depth: Float32Array(width × height)` stores the camera-space forward distance of the
nearest opaque surface per pixel:

1. Fill with `Infinity`.
2. Walls write `distance` for each covered pixel.
3. Floor and wall tops write their forward distance where nearer.
4. Sprites test against the current value, skip, and write where alpha > 0.6.

This is a true 2D depth map, not the 1D column buffer used by Wolfenstein-style engines,
so sprites correctly occlude and are occluded behind partial geometry and at different
heights.

## Sprites

Rendering order: sky → clear depth → walls → floor/wall tops → shadows and sprites (far
to near).

A sprite is centered on `(x, y)`, has `worldSize` world units of height, and its frame
bottom is offset by `anchorZ` (currently `-0.075`). Sprites are screen-aligned billboards:
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
then flung them off-screen. Sprites at `zCam ≤ 0.12` are rejected. The depth test still
compares horizontal `forward`, matching walls and floor, which store horizontal forward
distance.

Per pixel: sample the atlas rect, multiply RGB by the actor tint and distance shade,
blend by alpha, and update depth for opaque pixels. A soft elliptical shadow fades out at
the actor's ground position when `z < 2.5`.

### Directional frame selection

```ts
relative   = actor.facing - atan2(camY - actorY, camX - actorX);  // wrapped
yawIndex   = round(relative / (2π / directions)) mod directions;
centerZ    = actor.z + anchorZ + worldSize / 2;
elevation  = atan2(camEyeZ - centerZ, distance);
pitchIndex = quantizePitch(elevation, manifest.pitches);
frameIndex = floor(animTime * state.fps) % state.frames;
```

`quantizePitch` uses bands centred between the atlas elevations. With four pitches
(`[-0.31, 0, 0.49, 1.25]` rad) the thresholds are `0.87 → top`, `0.245 → high`,
`-0.155 → level`, otherwise low. A three-pitch atlas keeps the earlier ±0.1 bands, so
manifest-driven atlases of either size work.

`ActorSpec.sprite` selects one of the loaded atlases (`guardian`, `scout`, `brute`).
`SpriteAtlas.getFrame(state, pitch, yaw, frame)` resolves exact entries, falls back to the
level row, then to `idle/level/yaw/0`, so partially generated atlases still render.

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
| Max altitude | 18 |
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
to the floor. Freefly clamps `z` to `[support, MAX_ALTITUDE]`.

Holding `Space` burns fuel and thrusts upward from the ground or midair. At `MAX_ALTITUDE`
the clamp zeroes upward velocity while thrusting, so the player can hover and look down
without chattering. Landing refuels. `F2` toggles a fuel-free freefly debug mode.

The field of view widens from 70° to 100° as altitude rises from 1 to 11 units, and fog
attenuation scales down at altitude so the whole courtyard stays readable.

## Render loop

`main.ts` runs `game.update(dt)` → `game.render()` → `game.drawMinimap(...)` inside
`requestAnimationFrame`. `dt` is clamped to 50 ms. HUD values update at ~10 Hz; FPS is
smoothed with a 90/10 exponential average. The framebuffer is scaled with CSS
`image-rendering: pixelated`.

## Playtest harness

`tools/playtest/run.ts` starts Vite on a fixed port, launches headless Chrome, and drives
the game through `window.__raycast.automation` (scripted keys and look deltas, no pointer
lock). It also reads `window.__raycast.debug()`, which returns the camera, player, actor
screen rects, and renderer stats (`wallColumns`, `wallPixels`, per-sprite opaque `pixels`
and width/height of the visible silhouette).

The 29 checks cover movement, collision, jetpack lift/landing/refuel, altitude ceiling,
pitch clamps, front/back frame indices for all three chassis, atlas dimensions, and page
errors, plus these regressions:

| Check | Assertion |
| --- | --- |
| Wall faces stay opaque while airborne | `wallColumns = 384` and > 8k wall pixels from altitude |
| Close wall fills the screen | 384 columns and > 85k wall pixels pressed against a wall |
| Near wall survives a steep look-down | 384 columns and > 20k wall pixels |
| Overhead sprite keeps a silhouette | visible `contentW ≥ 4`, `contentH ≥ 6`, `pixels ≥ 24` |
| Overhead sprite stays centred | projected centre within 48 px of screen centre |
| Overhead edge actor stays in view | actor near the map edge still visible and centred |
| Player lands on a wall top | `z ≈ 1.4`, `support ≈ 1.4`, `onGround` |
| Stepping off drops to the floor | `z ≤ 0.001`, `support ≤ 0.001` |
| Walking up steps reaches the 0.4 platform | `support ≈ 0.4`, `z ≈ 0.4`, `onGround` |
| Stepped blocks render top surfaces | `topPixels > 500` from the stair approach |
| A 0.6 crate blocks walking | stopped at `y > 14.1`, support 0 |
| The crate occludes the scholar | visible sprite with `occluded > 100` pixels |
| Landing on the crate stops at 0.6 | `z ≈ 0.6`, `support ≈ 0.6`, `onGround` |

Screenshots and a JSON report land in `docs/screenshots/playtest/`.

## Performance notes

At 384×240 the framebuffer has ~92k pixels. Wall and floor drawing is per-pixel but
bounded; sprites are bounded by their screen rect. The depth array and per-column ray
base arrays are reused. The renderer runs at 60 FPS in Chrome on Apple Silicon; resolution
scaling and typed-array batching remain future options.
