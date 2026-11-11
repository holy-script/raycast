# Architecture

The engine is a CPU renderer writing into an `ImageData` framebuffer and blitting it to
a 384×240 Canvas 2D. All spatial reasoning happens in a top-down 2D plane; verticality is
added with an eye height, a true rotational pitch camera, and a per-pixel depth buffer.
Above wall height the renderer also draws wall tops, so the courtyard reads as a solid
diorama from jetpack altitude.

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
| `src/engine/world.ts` | ASCII map parsing, solid lookup, circular collision via 9 samples |
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

Walls and sprites use the matching pinhole projection:

```ts
projectY(cam, forward, dz):
  zCam = forward * cosP + dz * sinP;
  yCam = -forward * sinP + dz * cosP;
  return H / 2 - focal * yCam / zCam;
```

`forward` is the horizontal camera-space distance and `dz` is height relative to the eye.
This supports looking steeply down without the vertical compression of a shear. Pitch is
clamped to 1.1 rad (~63°) on the ground and 0.92 rad (~53°) airborne, keeping every ray
pointing downward.

## Walls

For each screen column, a DDA ray is cast and the perpendicular distance `d` is used:

```ts
yTop    = projectY(cam, d, WALL_HEIGHT - eyeZ);  // WALL_HEIGHT = 1.4
yBottom = projectY(cam, d, -eyeZ);
texX    = floor(wallU * texture.width);
```

Vertical texture coordinate advances by `texture.height / (yBottom - yTop)` per pixel.
Shade falls off with distance (`1 / (1 + d·0.085)`), with vertical faces at 76%, and is
blended toward the fog color `(16, 18, 30)`.

When the eye is above `WALL_HEIGHT + 0.02`, wall faces are skipped: the camera is looking
down on the tops, not at the sides.

## Floor and wall tops

Every pixel below the horizon casts an exact 3D ray. Two plane intersections are
computed:

```ts
roofT  = (WALL_HEIGHT - eyeZ) / rayZ;   // only while the eye is above the walls
floorT = -eyeZ / rayZ;
```

`roofT` is nearer than `floorT`. If the roof sample lands in a solid cell, the wall-top
texture is drawn with a bright edge highlight (`×1.32`) and a darker interior (`×0.82`).
Otherwise the floor sample is drawn if it lands in a walkable, in-bounds cell. If the
floor sample lands in a solid cell while the roof sample did not, the ray grazed over a
wall top and hit the block's far body; the block texture is filled at `floorT` so the
aerial view has no sky holes. Out-of-bounds floor hits stay sky.

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
bottom is offset by `anchorZ` (currently `-0.075`).

```ts
distance = (sprite.x - cam.x) * dirX + (sprite.y - cam.y) * dirY;
yFeet    = projectY(cam, distance, sprite.z + anchorZ - eyeZ);
yHead    = projectY(cam, distance, sprite.z + anchorZ + worldSize - eyeZ);
halfW    = focal * worldSize / (2 * distance);
```

Per pixel: sample the atlas rect, multiply RGB by the actor tint and distance shade,
blend by alpha, and update depth for opaque pixels. A soft elliptical shadow is drawn at
the actor's ground position when `z < 0.25`.

### Directional frame selection

```ts
relative   = actor.facing - atan2(camY - actorY, camX - actorX);  // wrapped
yawIndex   = round(relative / (2π / directions)) mod directions;
centerZ    = actor.z + anchorZ + worldSize / 2;
elevation  = atan2(camEyeZ - centerZ, distance);
pitchIndex = elevation > 0.08 ? 2 : elevation < -0.08 ? 0 : 1;   // high / low / level
frameIndex = floor(animTime * state.fps) % state.frames;
```

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
| Pitch limit | 1.1 rad ground, 0.92 rad airborne |

Horizontal movement is resolved per axis so sliding along walls works. Collision samples
nine points on the player circle against solid tiles. Gravity integrates `vz`; the floor
clamps `z` to 0.

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
lock). It asserts movement, collision, jetpack lift/landing/refuel, altitude ceiling,
pitch clamps, front/back frame indices for all three chassis, atlas dimensions, and page
errors. Screenshots and a JSON report land in `docs/screenshots/playtest/`.

## Performance notes

At 384×240 the framebuffer has ~92k pixels. Wall and floor drawing is per-pixel but
bounded; sprites are bounded by their screen rect. The depth array and per-column ray
base arrays are reused. The renderer runs at 60 FPS in Chrome on Apple Silicon; resolution
scaling and typed-array batching remain future options.
