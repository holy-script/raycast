# Architecture

The engine is a CPU renderer writing into an `ImageData` framebuffer and blitting it to
a 384×240 Canvas 2D. All spatial reasoning happens in a top-down 2D plane; verticality is
added with an eye height, a pitch-sheared horizon, and per-pixel depth.

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
| `src/engine/renderer.ts` | Sky, walls, floor, sprites, shadows, depth buffer |
| `src/engine/atlas.ts` | Manifest parsing, frame lookup with fallback, image loading |
| `src/engine/input.ts` | Pointer lock, key state, one-shot actions |
| `src/game.ts` | Player physics, camera state, actor behavior, sprite selection, HUD |
| `src/content/` | ASCII map, spawn, actor specs |
| `src/main.ts` | Asset boot, render loop, DOM/HUD wiring, debug API |

## Camera

```ts
const tanHalf = Math.tan(FOV / 2);              // FOV = 70°
dir       = (cos(yaw), sin(yaw));
plane     = (dirY, -dirX) * tanHalf;            // screen-right vector
focal     = (width / 2) / tanHalf;
horizon   = height / 2 + Math.tan(pitch) * focal;
eyeZ      = player.z + EYE_HEIGHT + eyeBob;
```

The horizon is shifted instead of rotating the camera, which is Y-shearing. Positive
pitch moves the horizon down (look up). Pitch is clamped to ±0.45 rad (~26°) to avoid
visible stretching. The camera plane is oriented so that increasing screen `x` is camera
right; the sprite lateral term uses the matching cross product:

```ts
lateral = (dx * dirY - dy * dirX) / (distance * tanHalf);
screenX = (width / 2) * (1 + lateral);
```

## Walls

For each screen column, a DDA ray is cast and the perpendicular distance `d` is used:

```ts
invDist  = focal / d;
yTop     = horizon - (WALL_HEIGHT - eyeZ) * invDist;  // WALL_HEIGHT = 1.4
yBottom  = horizon + eyeZ * invDist;
texX     = floor(wallU * texture.width);
```

Vertical texture coordinate advances by `texture.height / (yBottom - yTop)` per pixel.
Shade falls off with distance (`1 / (1 + d·0.085)`), with vertical faces at 76%, and is
blended toward the fog color `(16, 18, 30)`. The world is a flat floor today, so every
wall shares the same height and base.

## Floor

Floor casting walks rows below the horizon:

```ts
rowDistance = (eyeZ * focal) / (y + 0.5 - horizon);
floorX      = camX + rowDistance * (dirX - planeX);   // left ray
stepX       = 2 * planeX / width;
```

Only pixels with `rowDistance < depth[idx]` are drawn, so floor pixels behind walls are
rejected. Non-walkable cells are skipped (the background sky shows through gaps).

## Depth buffer

`depth: Float32Array(width × height)` stores the perpendicular camera distance of the
nearest opaque surface per pixel:

1. Fill with `Infinity`.
2. Walls write `distance` for each covered pixel.
3. Floor writes `rowDistance` where nearer than the current value.
4. Sprites test `distance >= depth[idx]`, skip, and write `distance` where alpha > 0.6.

This is a true 2D depth map, not the 1D column buffer used by Wolfenstein-style engines,
so sprites correctly occlude and are occluded behind partial geometry and at different
heights.

## Sprites

Rendering order: sky → clear depth → walls → floor → shadows and sprites (far to near).

A sprite is centered on `(x, y)`, has `worldSize` world units of height, and its frame
bottom is offset by `anchorZ` (currently `-0.075`, preventing high-angle frames from
clipping at the feet).

```ts
depth   = (sprite.x - cam.x) * dirX + (sprite.y - cam.y) * dirY;  // camera-space forward
yFeet   = horizon + (eyeZ - (z + anchorZ)) * focal / distance;
yHead   = horizon + (eyeZ - (z + anchorZ + worldSize)) * focal / distance;
halfW   = focal * worldSize / (2 * distance);
```

Per pixel: sample the atlas rect, multiply RGB by the actor tint and distance shade,
blend by alpha over the framebuffer, and update depth for opaque pixels. A soft elliptical
shadow is drawn at the actor's ground position when `z < 0.25`.

### Directional frame selection

```ts
relative   = wrapAngle(atan2(camY - actorY, camX - actorX) - actor.facing);
yawIndex   = round(relative / (2π / directions)) mod directions;
centerZ    = actor.z + anchorZ + worldSize / 2;
elevation  = atan2(camEyeZ - centerZ, distance);
pitchIndex = elevation > 0.08 ? 2 : elevation < -0.08 ? 0 : 1;   // high / low / level
frameIndex = floor(animTime * state.fps) % state.frames;
```

`SpriteAtlas.getFrame(state, pitch, yaw, frame)` resolves exact entries, falls back to
the level row, then to `idle/level/yaw/0`, so partially generated atlases still render.

Tint is an RGB multiplier; one atlas can therefore serve several color variants without
new renders.

## Player physics

| Constant | Value |
| --- | --- |
| Eye height | 0.55 |
| Collision radius | 0.19 |
| Walk / sprint | 3.0 / 4.6 units·s⁻¹ |
| Fly speed | 4.0 |
| Gravity | 18 units·s⁻² |
| Jump velocity | 3.0 |
| Max fly height | 3.2 |
| Mouse sensitivity | 0.0022 rad·px⁻¹ |
| Max pitch | 0.45 rad |

Horizontal movement is resolved per axis so sliding along walls works. Collision samples
nine points on the player circle against solid tiles. Gravity integrates `vz`; the floor
clamps `z` to 0. Fly mode replaces gravity and ignores jump.

## Render loop

`main.ts` runs `game.update(dt)` → `game.render()` → `game.drawMinimap(...)` inside
`requestAnimationFrame`. `dt` is clamped to 50 ms. HUD values update at ~10 Hz; FPS is
smoothed with a 90/10 exponential average. The framebuffer is scaled with CSS
`image-rendering: pixelated`.

## Performance notes

At 384×240 the framebuffer has ~92k pixels. Wall and floor drawing is per-pixel but
bounded; sprites are bounded by their screen rect. The depth array is reused. The
renderer currently runs at 120 FPS in Chrome on Apple Silicon; resolution scaling and
typed-array batching are future options, not current bottlenecks.
