import { castRay } from "./dda";
import { clamp, fract } from "./math";
import { WALL_HEIGHT, type World } from "./world";

export { WALL_HEIGHT };

const FOG_R = 16;
const FOG_G = 18;
const FOG_B = 30;
const NEAR_PLANE = 0.01;

export interface Texture {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface FrameRect {
  texture: Texture;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export interface CameraState {
  x: number;
  y: number;
  eyeZ: number;
  yaw: number;
  pitch: number;
  dirX: number;
  dirY: number;
  planeX: number;
  planeY: number;
  tanHalf: number;
  focal: number;
  /** Multiplies fog density; lower values reveal more of the map from altitude. */
  fogScale?: number;
}

export interface SpriteDraw {
  x: number;
  y: number;
  z: number;
  facing: number;
  frame: FrameRect;
  worldSize: number;
  /** Offset of the frame's bottom edge relative to the actor's feet. */
  anchorZ?: number;
  alpha?: number;
  /** RGB multiplier, 1 = unchanged. Cheap per-actor recolors from one atlas. */
  tint?: [number, number, number];
  /** Debug/tests only: ties a projected rect back to an actor. */
  id?: string;
}

export interface SpriteScreenRect {
  id: string;
  /** Projected center in framebuffer pixels. */
  x: number;
  y: number;
  /** Projected size in framebuffer pixels. */
  w: number;
  h: number;
  visible: boolean;
  /** Opaque pixels actually written (after alpha and depth tests). */
  pixels: number;
  /** Bounding box of the written pixels, 0 when nothing was drawn. */
  contentW: number;
  contentH: number;
}

export interface RenderStats {
  wallColumns: number;
  wallPixels: number;
  spriteRects: SpriteScreenRect[];
}

export class Renderer {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8ClampedArray;
  readonly depth: Float32Array;
  readonly stats: RenderStats = {
    wallColumns: 0,
    wallPixels: 0,
    spriteRects: [],
  };
  private readonly image: ImageData;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly skyRows: Uint8Array;
  private readonly centerY: number;

  constructor(canvas: HTMLCanvasElement, width = 384, height = 240) {
    this.width = width;
    this.height = height;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2D canvas context unavailable");
    ctx.imageSmoothingEnabled = false;
    this.ctx = ctx;
    this.image = ctx.createImageData(width, height);
    this.pixels = this.image.data;
    this.depth = new Float32Array(width * height);
    this.skyRows = this.buildSky();
    this.centerY = height / 2;
  }

  /**
   * Projects a point `forward` units ahead of the camera at height `dz` relative
   * to the eye. Uses a true pitch rotation so the view can look straight down.
   * Points at or behind the near plane project far off-screen instead of
   * returning NaN, so a wall that crosses the near plane stays solid.
   */
  private projectYClipped(cam: CameraState, forward: number, dz: number): number {
    const cos = Math.cos(cam.pitch);
    const sin = Math.sin(cam.pitch);
    const zCam = forward * cos + dz * sin;
    const yCam = -forward * sin + dz * cos;
    if (zCam > NEAR_PLANE) {
      return this.centerY - (cam.focal * yCam) / zCam;
    }
    return yCam >= 0 ? -1e6 : 1e6;
  }

  private buildSky(): Uint8Array {
    const { height } = this;
    const rows = new Uint8Array(height * 3);
    for (let y = 0; y < height; y += 1) {
      const t = y / height;
      const top = [10, 12, 22];
      const mid = [30, 27, 46];
      const horizon = [84, 58, 63];
      const warm = clamp(1 - Math.abs(t - 0.62) * 5, 0, 1);
      const a = clamp(t / 0.72, 0, 1);
      const r = top[0] + (mid[0] - top[0]) * a + horizon[0] * warm * 0.55;
      const g = top[1] + (mid[1] - top[1]) * a + horizon[1] * warm * 0.45;
      const b = top[2] + (mid[2] - top[2]) * a + horizon[2] * warm * 0.35;
      rows[y * 3] = clamp(r, 0, 255);
      rows[y * 3 + 1] = clamp(g, 0, 255);
      rows[y * 3 + 2] = clamp(b, 0, 255);
    }
    return rows;
  }

  render(
    cam: CameraState,
    world: World,
    textures: Record<number, Texture>,
    floorTexture: Texture,
    sprites: SpriteDraw[],
  ): void {
    this.stats.wallColumns = 0;
    this.stats.wallPixels = 0;
    this.stats.spriteRects = [];
    this.drawSky();
    this.depth.fill(Infinity);
    this.drawWalls(cam, world, textures);
    this.drawFloor(cam, world, floorTexture, textures);
    this.drawSprites(cam, sprites);
    this.ctx.putImageData(this.image, 0, 0);
  }

  private drawSky(): void {
    const { width, height, pixels, skyRows } = this;
    for (let y = 0; y < height; y += 1) {
      const r = skyRows[y * 3];
      const g = skyRows[y * 3 + 1];
      const b = skyRows[y * 3 + 2];
      let idx = y * width * 4;
      for (let x = 0; x < width; x += 1) {
        pixels[idx] = r;
        pixels[idx + 1] = g;
        pixels[idx + 2] = b;
        pixels[idx + 3] = 255;
        idx += 4;
      }
    }
  }

  private drawWalls(
    cam: CameraState,
    world: World,
    textures: Record<number, Texture>,
  ): void {
    const { width, height, pixels, depth } = this;
    const cosP = Math.cos(cam.pitch);
    const sinP = Math.sin(cam.pitch);
    let columns = 0;
    let painted = 0;

    for (let x = 0; x < width; x += 1) {
      const cameraX = (2 * x) / width - 1;
      const rayX = cam.dirX + cam.planeX * cameraX;
      const rayY = cam.dirY + cam.planeY * cameraX;
      const hit = castRay(world, cam.x, cam.y, rayX, rayY);
      if (!hit) continue;

      const texture = textures[hit.tile] ?? textures[1];
      if (!texture) continue;

      const distance = hit.distance;
      const zTop = distance * cosP + (WALL_HEIGHT - cam.eyeZ) * sinP;
      const zBottom = distance * cosP - cam.eyeZ * sinP;
      // The whole face is behind the near plane.
      if (zTop <= NEAR_PLANE && zBottom <= NEAR_PLANE) continue;

      const yTopF = this.projectYClipped(cam, distance, WALL_HEIGHT - cam.eyeZ);
      const yBottomF = this.projectYClipped(cam, distance, -cam.eyeZ);
      const yStart = Math.max(0, Math.ceil(yTopF));
      const yEnd = Math.min(height - 1, Math.floor(yBottomF));
      if (yStart > yEnd) continue;

      const texX = Math.min(
        texture.width - 1,
        Math.floor(clamp(hit.wallU, 0.0001, 0.9999) * texture.width),
      );
      const sideShade = hit.side === 0 ? 1 : 0.76;
      const shade =
        clamp(1 / (1 + distance * 0.085 * (cam.fogScale ?? 1)), 0.08, 1) *
        sideShade;
      const fog = 1 - shade;

      columns += 1;
      for (let y = yStart; y <= yEnd; y += 1) {
        // Invert the pitch projection for this scanline: `s` is the camera-space
        // slope (up/forward) at the pixel. This keeps texture V correct even
        // when the face crosses the near plane and `yTopF` is clipped.
        const s = (this.centerY - (y + 0.5)) / cam.focal;
        const denominator = cosP - s * sinP;
        if (Math.abs(denominator) < 1e-6) continue;
        const dz = (distance * (sinP + s * cosP)) / denominator;
        const t = (dz + cam.eyeZ) / WALL_HEIGHT;
        if (t < 0 || t > 1) continue;

        const texY = clamp(
          Math.floor((1 - t) * texture.height),
          0,
          texture.height - 1,
        );
        const src = (texY * texture.width + texX) * 4;
        const dst = (y * width + x) * 4;
        const idx = y * width + x;
        pixels[dst] = texture.data[src] * shade + FOG_R * fog;
        pixels[dst + 1] = texture.data[src + 1] * shade + FOG_G * fog;
        pixels[dst + 2] = texture.data[src + 2] * shade + FOG_B * fog;
        pixels[dst + 3] = 255;
        depth[idx] = distance;
        painted += 1;
      }
    }

    this.stats.wallColumns = columns;
    this.stats.wallPixels = painted;
  }

  private drawFloor(
    cam: CameraState,
    world: World,
    texture: Texture,
    wallTextures: Record<number, Texture>,
  ): void {
    const { width, height, pixels, depth } = this;
    const cosP = Math.cos(cam.pitch);
    const sinP = Math.sin(cam.pitch);
    const forwardX = cam.dirX * cosP;
    const forwardY = cam.dirY * cosP;
    const forwardZ = sinP;
    const rightX = -cam.dirY;
    const rightY = cam.dirX;
    const upX = -cam.dirX * sinP;
    const upY = -cam.dirY * sinP;
    const upZ = cosP;
    const aboveWalls = cam.eyeZ > WALL_HEIGHT + 0.02;
    const fogScale = cam.fogScale ?? 1;

    const rayBaseX = new Float32Array(width);
    const rayBaseY = new Float32Array(width);
    for (let x = 0; x < width; x += 1) {
      const xCam = (x + 0.5 - width / 2) / cam.focal;
      rayBaseX[x] = rightX * xCam + forwardX;
      rayBaseY[x] = rightY * xCam + forwardY;
    }

    for (let y = 0; y < height; y += 1) {
      const yCam = (this.centerY - (y + 0.5)) / cam.focal;
      const rowBase = y * width;

      for (let x = 0; x < width; x += 1) {
        const rayX = rayBaseX[x] + upX * yCam;
        const rayY = rayBaseY[x] + upY * yCam;
        const rayZ = forwardZ + upZ * yCam;
        if (rayZ >= -0.0001) continue;

        const idx = rowBase + x;
        let drawn = false;

        if (aboveWalls) {
          const roofT = (WALL_HEIGHT - cam.eyeZ) / rayZ;
          if (roofT > 0) {
            const worldX = cam.x + roofT * rayX;
            const worldY = cam.y + roofT * rayY;
            const cellX = Math.floor(worldX);
            const cellY = Math.floor(worldY);
            const tile =
              cellX >= 0 &&
              cellY >= 0 &&
              cellX < world.width &&
              cellY < world.height
                ? world.tiles[cellY * world.width + cellX]
                : 0;
            const forward =
              cam.dirX * (roofT * rayX) + cam.dirY * (roofT * rayY);
            if (tile !== 0 && forward < depth[idx]) {
              const wallTexture = wallTextures[tile] ?? wallTextures[1];
              if (wallTexture) {
                const fx = fract(worldX);
                const fy = fract(worldY);
                const texX = Math.floor(fx * wallTexture.width);
                const texY = Math.floor(fy * wallTexture.height);
                const src = (texY * wallTexture.width + texX) * 4;
                const dst = idx * 4;
                const edge = fx < 0.06 || fx > 0.94 || fy < 0.06 || fy > 0.94;
                const shade =
                  clamp(1 / (1 + forward * 0.075 * fogScale), 0.06, 1) *
                  (edge ? 1.32 : 0.82);
                const fog = 1 - shade;
                pixels[dst] = wallTexture.data[src] * shade + FOG_R * fog;
                pixels[dst + 1] =
                  wallTexture.data[src + 1] * shade + FOG_G * fog;
                pixels[dst + 2] =
                  wallTexture.data[src + 2] * shade + FOG_B * fog;
                pixels[dst + 3] = 255;
                depth[idx] = forward;
                drawn = true;
              }
            }
          }
        }

        if (!drawn) {
          const floorT = -cam.eyeZ / rayZ;
          const worldX = cam.x + floorT * rayX;
          const worldY = cam.y + floorT * rayY;
          const cellX = Math.floor(worldX);
          const cellY = Math.floor(worldY);
          const inBounds =
            cellX >= 0 &&
            cellY >= 0 &&
            cellX < world.width &&
            cellY < world.height;
          const tile = inBounds ? world.tiles[cellY * world.width + cellX] : 0;
          const forward =
            cam.dirX * (floorT * rayX) + cam.dirY * (floorT * rayY);
          if (inBounds && forward < depth[idx]) {
            if (tile === 0) {
              const texX = Math.floor(fract(worldX) * texture.width);
              const texY = Math.floor(fract(worldY) * texture.height);
              const src = (texY * texture.width + texX) * 4;
              const dst = idx * 4;
              const shade = clamp(
                1 / (1 + forward * 0.075 * fogScale),
                0.06,
                1,
              );
              const fog = 1 - shade;
              pixels[dst] = texture.data[src] * shade + FOG_R * fog;
              pixels[dst + 1] = texture.data[src + 1] * shade + FOG_G * fog;
              pixels[dst + 2] = texture.data[src + 2] * shade + FOG_B * fog;
              pixels[dst + 3] = 255;
              depth[idx] = forward;
            } else if (aboveWalls) {
              // The sightline clears a wall top, then lands on a wall cell farther
              // along. Paint the block body so the overhead view has no sky gaps.
              const wallTexture = wallTextures[tile] ?? wallTextures[1];
              if (wallTexture) {
                const fx = fract(worldX);
                const fy = fract(worldY);
                const texX = Math.floor(fx * wallTexture.width);
                const texY = Math.floor(fy * wallTexture.height);
                const src = (texY * wallTexture.width + texX) * 4;
                const dst = idx * 4;
                const edge = fx < 0.06 || fx > 0.94 || fy < 0.06 || fy > 0.94;
                const shade =
                  clamp(1 / (1 + forward * 0.075 * fogScale), 0.06, 1) *
                  (edge ? 1.05 : 0.68);
                const fog = 1 - shade;
                pixels[dst] = wallTexture.data[src] * shade + FOG_R * fog;
                pixels[dst + 1] =
                  wallTexture.data[src + 1] * shade + FOG_G * fog;
                pixels[dst + 2] =
                  wallTexture.data[src + 2] * shade + FOG_B * fog;
                pixels[dst + 3] = 255;
                depth[idx] = forward;
              }
            }
          }
        }
      }
    }
  }

  private drawSprites(cam: CameraState, sprites: SpriteDraw[]): void {
    const cosP = Math.cos(cam.pitch);
    const sinP = Math.sin(cam.pitch);
    const prepared: PreparedSprite[] = [];

    for (const sprite of sprites) {
      const dx = sprite.x - cam.x;
      const dy = sprite.y - cam.y;
      const forward = dx * cam.dirX + dy * cam.dirY;
      const side = -dx * cam.dirY + dy * cam.dirX;
      const centerZ =
        sprite.z + (sprite.anchorZ ?? 0) + sprite.worldSize / 2;
      const dz = centerZ - cam.eyeZ;
      // Camera-space depth. This stays positive for actors below the camera even
      // when their horizontal forward distance is near zero (looking straight
      // down), which is what used to make overhead sprites vanish off-screen.
      const zCam = forward * cosP + dz * sinP;
      if (zCam <= 0.12) continue;
      prepared.push({
        sprite,
        forward,
        zCam,
        xCam: side,
        yCam: -forward * sinP + dz * cosP,
      });
    }

    prepared.sort((a, b) => b.zCam - a.zCam);
    for (const entry of prepared) {
      this.drawSprite(cam, entry);
    }
  }

  private drawSprite(cam: CameraState, entry: PreparedSprite): void {
    const { sprite, forward, zCam, xCam, yCam } = entry;
    const { width, height, pixels, depth } = this;
    const screenX = width / 2 + (cam.focal * xCam) / zCam;
    const screenY = this.centerY - (cam.focal * yCam) / zCam;

    // Screen-aligned billboard: the atlas already supplies the correct pitch
    // view, so keep a readable angular size instead of projecting a vertical
    // quad that collapses to a line when viewed from above.
    const worldSize = Math.max(0.2, sprite.worldSize);
    const heightPx = Math.max(2, (cam.focal * worldSize) / zCam);
    const { texture, sx, sy, sw, sh } = sprite.frame;
    const widthPx = Math.max(2, heightPx * (sw / sh));
    const left = screenX - widthPx / 2;
    const top = screenY - heightPx / 2;

    const xStart = Math.max(0, Math.ceil(left));
    const xEnd = Math.min(width - 1, Math.floor(left + widthPx));
    const yStart = Math.max(0, Math.ceil(top));
    const yEnd = Math.min(height - 1, Math.floor(top + heightPx));
    const visible = xStart <= xEnd && yStart <= yEnd;
    const rect: SpriteScreenRect = {
      id: sprite.id ?? "",
      x: screenX,
      y: screenY,
      w: widthPx,
      h: heightPx,
      visible,
      pixels: 0,
      contentW: 0,
      contentH: 0,
    };
    this.stats.spriteRects.push(rect);
    if (!visible) return;

    if (sprite.z < 2.5) {
      this.drawShadow(cam, entry);
    }

    const data = texture.data;
    const spriteAlpha = sprite.alpha ?? 1;
    const tint = sprite.tint ?? [1, 1, 1];
    const shade = clamp(
      1 / (1 + zCam * 0.05 * (cam.fogScale ?? 1)),
      0.1,
      1,
    );
    const fog = 1 - shade;
    const uScale = 1 / widthPx;
    const vScale = 1 / heightPx;
    let drawn = 0;
    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;

    for (let x = xStart; x <= xEnd; x += 1) {
      const u = (x + 0.5 - left) * uScale;
      if (u < 0 || u >= 1) continue;
      const texX = sx + Math.min(sw - 1, Math.floor(u * sw));
      for (let y = yStart; y <= yEnd; y += 1) {
        const v = (y + 0.5 - top) * vScale;
        if (v < 0 || v >= 1) continue;
        const idx = y * width + x;
        if (forward >= depth[idx]) continue;

        const texY = sy + Math.min(sh - 1, Math.floor(v * sh));
        const src = (texY * texture.width + texX) * 4;
        const alpha = (data[src + 3] / 255) * spriteAlpha;
        if (alpha <= 0.02) continue;

        const dst = idx * 4;
        const r = data[src] * tint[0] * shade + FOG_R * fog;
        const g = data[src + 1] * tint[1] * shade + FOG_G * fog;
        const b = data[src + 2] * tint[2] * shade + FOG_B * fog;
        pixels[dst] = r * alpha + pixels[dst] * (1 - alpha);
        pixels[dst + 1] = g * alpha + pixels[dst + 1] * (1 - alpha);
        pixels[dst + 2] = b * alpha + pixels[dst + 2] * (1 - alpha);
        pixels[dst + 3] = 255;
        if (alpha > 0.6) depth[idx] = forward;
        drawn += 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }

    rect.pixels = drawn;
    rect.contentW = maxX >= minX ? maxX - minX + 1 : 0;
    rect.contentH = maxY >= minY ? maxY - minY + 1 : 0;
  }

  private drawShadow(cam: CameraState, entry: PreparedSprite): void {
    const { sprite, forward, xCam } = entry;
    const { width, height, pixels, depth } = this;
    const cosP = Math.cos(cam.pitch);
    const sinP = Math.sin(cam.pitch);
    const dz = -cam.eyeZ;
    const zCam = forward * cosP + dz * sinP;
    if (zCam <= 0.12) return;

    const groundX = width / 2 + (cam.focal * xCam) / zCam;
    const groundY =
      this.centerY - (cam.focal * (-forward * sinP + dz * cosP)) / zCam;
    const radiusX = Math.max(
      1,
      (cam.focal * sprite.worldSize * 0.36) / zCam,
    );
    // A ground disc becomes rounder on screen the steeper the view.
    const tilt = Math.abs(sinP);
    const radiusY = Math.max(1, radiusX * (0.32 + 0.68 * tilt));
    const fade = clamp(1 - sprite.z / 2.5, 0, 1);

    const xStart = Math.max(0, Math.floor(groundX - radiusX));
    const xEnd = Math.min(width - 1, Math.ceil(groundX + radiusX));
    const yStart = Math.max(0, Math.floor(groundY - radiusY));
    const yEnd = Math.min(height - 1, Math.ceil(groundY + radiusY));

    for (let y = yStart; y <= yEnd; y += 1) {
      const ny = (y - groundY) / radiusY;
      for (let x = xStart; x <= xEnd; x += 1) {
        const nx = (x - groundX) / radiusX;
        const d2 = nx * nx + ny * ny;
        if (d2 >= 1) continue;
        const idx = y * width + x;
        const floorDepth = depth[idx];
        if (!Number.isFinite(floorDepth) || floorDepth < forward - 0.2) continue;
        const alpha = 0.32 * fade * (1 - d2) * (1 - d2);
        const dst = idx * 4;
        pixels[dst] = pixels[dst] * (1 - alpha);
        pixels[dst + 1] = pixels[dst + 1] * (1 - alpha);
        pixels[dst + 2] = pixels[dst + 2] * (1 - alpha);
      }
    }
  }
}

interface PreparedSprite {
  sprite: SpriteDraw;
  forward: number;
  zCam: number;
  xCam: number;
  yCam: number;
}
