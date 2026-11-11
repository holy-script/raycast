import { castRayHits, type RayCellHit } from "./dda";
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
  /** Optional second atlas angle/frame; blended by `blend`. */
  frameB?: FrameRect;
  blend?: number;
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
  /** Opaque texels rejected because a nearer surface already filled the pixel. */
  occluded: number;
  /** Bounding box of the written pixels, 0 when nothing was drawn. */
  contentW: number;
  contentH: number;
}

export interface ViewmodelDraw {
  texture: Texture;
  /** Top-left corner in framebuffer pixels. */
  x: number;
  y: number;
}

export interface RenderStats {
  wallColumns: number;
  wallPixels: number;
  topPixels: number;
  viewmodelPixels: number;
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
    topPixels: 0,
    viewmodelPixels: 0,
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
    topTexture: Texture,
    sprites: SpriteDraw[],
    viewmodel?: ViewmodelDraw,
  ): void {
    this.stats.wallColumns = 0;
    this.stats.wallPixels = 0;
    this.stats.topPixels = 0;
    this.stats.viewmodelPixels = 0;
    this.stats.spriteRects = [];
    this.drawSky();
    this.depth.fill(Infinity);
    this.drawWalls(cam, world, textures, topTexture);
    this.drawFloor(cam, world, floorTexture);
    this.drawSprites(cam, sprites);
    if (viewmodel) this.drawViewmodel(viewmodel);
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
    topTexture: Texture,
  ): void {
    const { width, height, pixels, depth } = this;
    const cosP = Math.cos(cam.pitch);
    const sinP = Math.sin(cam.pitch);
    const fogScale = cam.fogScale ?? 1;
    let columns = 0;
    let painted = 0;
    let topPainted = 0;

    for (let x = 0; x < width; x += 1) {
      const cameraX = (2 * x) / width - 1;
      const rayX = cam.dirX + cam.planeX * cameraX;
      const rayY = cam.dirY + cam.planeY * cameraX;
      const hits = castRayHits(world, cam.x, cam.y, rayX, rayY);
      let columnPainted = false;

      for (const hit of hits) {
        const texture = textures[hit.tile] ?? textures[1];
        if (!texture) continue;
        const wallHeight = hit.height;
        const distance = hit.distance;
        const zTop = distance * cosP + (wallHeight - cam.eyeZ) * sinP;
        const zBottom = distance * cosP - cam.eyeZ * sinP;
        // Distance 0 is the cell under the camera: only its top is visible.
        // The whole face is behind the near plane.
        if (distance > 0 && !(zTop <= NEAR_PLANE && zBottom <= NEAR_PLANE)) {
          const yTopF = this.projectYClipped(cam, distance, wallHeight - cam.eyeZ);
          const yBottomF = this.projectYClipped(cam, distance, -cam.eyeZ);
          const yStart = Math.max(0, Math.ceil(yTopF));
          const yEnd = Math.min(height - 1, Math.floor(yBottomF));
          if (yStart <= yEnd) {
            const texX = Math.min(
              texture.width - 1,
              Math.floor(clamp(hit.wallU, 0.0001, 0.9999) * texture.width),
            );
            const sideShade = hit.side === 0 ? 1 : 0.76;
            const shade =
              clamp(1 / (1 + distance * 0.085 * fogScale), 0.08, 1) * sideShade;
            const fog = 1 - shade;
            columnPainted = true;

            for (let y = yStart; y <= yEnd; y += 1) {
              // Invert the pitch projection for this scanline: `s` is the
              // camera-space slope (up/forward) at the pixel. This keeps
              // texture V correct even when the face crosses the near plane.
              const s = (this.centerY - (y + 0.5)) / cam.focal;
              const denominator = cosP - s * sinP;
              if (Math.abs(denominator) < 1e-6) continue;
              const dz = (distance * (sinP + s * cosP)) / denominator;
              const t = (dz + cam.eyeZ) / wallHeight;
              if (t < 0 || t > 1) continue;

              const idx = y * width + x;
              if (distance >= depth[idx]) continue;

              const texY = clamp(
                Math.floor((1 - t) * texture.height),
                0,
                texture.height - 1,
              );
              const src = (texY * texture.width + texX) * 4;
              const dst = idx * 4;
              pixels[dst] = texture.data[src] * shade + FOG_R * fog;
              pixels[dst + 1] = texture.data[src + 1] * shade + FOG_G * fog;
              pixels[dst + 2] = texture.data[src + 2] * shade + FOG_B * fog;
              pixels[dst + 3] = 255;
              depth[idx] = distance;
              painted += 1;
            }
          }
        }

        if (cam.eyeZ > wallHeight + 0.001) {
          const tops = this.drawCellTop(
            cam,
            topTexture,
            hit,
            x,
            rayX,
            rayY,
            cosP,
            sinP,
            fogScale,
          );
          topPainted += tops;
          if (tops > 0) columnPainted = true;
        }
      }

      if (columnPainted) columns += 1;
    }

    this.stats.wallColumns = columns;
    this.stats.wallPixels = painted;
    this.stats.topPixels = topPainted;
  }

  /**
   * Fills the horizontal top of one solid cell. Instead of intersecting a
   * single global roof plane, this inverts the projection for every screen row
   * and keeps only samples that fall inside the hit cell, so each platform and
   * stair tread gets its own top at its own height.
   */
  private drawCellTop(
    cam: CameraState,
    texture: Texture,
    hit: RayCellHit,
    x: number,
    rayX: number,
    rayY: number,
    cosP: number,
    sinP: number,
    fogScale: number,
  ): number {    const { width, height, pixels, depth } = this;
    const dz = hit.height - cam.eyeZ;
    if (dz >= -0.001) return 0;

    const yNear = this.projectYClipped(cam, Math.max(hit.distance, NEAR_PLANE), dz);
    const yFar = this.projectYClipped(cam, hit.exitDistance, dz);
    const yStart = Math.max(0, Math.ceil(Math.min(yNear, yFar)));
    const yEnd = Math.min(height - 1, Math.floor(Math.max(yNear, yFar)));
    if (yStart > yEnd) return 0;

    let painted = 0;
    for (let y = yStart; y <= yEnd; y += 1) {
      const s = (this.centerY - (y + 0.5)) / cam.focal;
      const denominator = s * cosP + sinP;
      if (Math.abs(denominator) < 1e-6) continue;
      const rawDistance = (dz * (cosP - s * sinP)) / denominator;
      if (rawDistance <= NEAR_PLANE) continue;
      // Clamp rows that land a hair outside the cell back onto its edge. This
      // fills the one-pixel cracks that appeared where tops met wall faces.
      const nearEdge = hit.distance + 1e-4;
      const farEdge = Math.max(nearEdge, hit.exitDistance - 1e-4);
      if (rawDistance < nearEdge - 0.03 || rawDistance > farEdge + 0.03) continue;
      const distance =
        rawDistance < nearEdge
          ? nearEdge
          : rawDistance > farEdge
            ? farEdge
            : rawDistance;

      const worldX = cam.x + distance * rayX;
      const worldY = cam.y + distance * rayY;
      if (Math.floor(worldX) !== hit.mapX || Math.floor(worldY) !== hit.mapY) {
        continue;
      }

      const idx = y * width + x;
      if (distance >= depth[idx]) continue;

      const fx = fract(worldX);
      const fy = fract(worldY);
      const texX = Math.min(
        texture.width - 1,
        Math.floor(fx * texture.width),
      );
      const texY = Math.min(
        texture.height - 1,
        Math.floor(fy * texture.height),
      );
      const src = (texY * texture.width + texX) * 4;
      const dst = idx * 4;
      const edgeDistance = Math.min(fx, 1 - fx, fy, 1 - fy);
      const bevel = 0.9 + clamp(edgeDistance / 0.06, 0, 1) * 0.1;
      const shade =
        clamp(1 / (1 + distance * 0.075 * fogScale), 0.06, 1) * 0.95 * bevel;
      const fog = 1 - shade;
      pixels[dst] = texture.data[src] * shade + FOG_R * fog;
      pixels[dst + 1] = texture.data[src + 1] * shade + FOG_G * fog;
      pixels[dst + 2] = texture.data[src + 2] * shade + FOG_B * fog;
      pixels[dst + 3] = 255;
      depth[idx] = distance;
      painted += 1;
    }
    return painted;
  }

  private drawFloor(
    cam: CameraState,
    world: World,
    texture: Texture,
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
        if (!inBounds) continue;

        const tile = world.tiles[cellY * world.width + cellX];
        if (tile !== 0) continue;

        const forward =
          cam.dirX * (floorT * rayX) + cam.dirY * (floorT * rayY);
        if (forward >= depth[idx]) continue;

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
      occluded: 0,
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
    const frameB =
      sprite.frameB && sprite.frameB.texture === texture ? sprite.frameB : undefined;
    const blend = frameB ? clamp(sprite.blend ?? 0, 0, 1) : 0;
    const shade = clamp(
      1 / (1 + zCam * 0.05 * (cam.fogScale ?? 1)),
      0.1,
      1,
    );
    const fog = 1 - shade;
    const uScale = 1 / widthPx;
    const vScale = 1 / heightPx;
    let drawn = 0;
    let occluded = 0;
    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;

    for (let x = xStart; x <= xEnd; x += 1) {
      const u = (x + 0.5 - left) * uScale;
      if (u < 0 || u >= 1) continue;
      const texX = sx + Math.min(sw - 1, Math.floor(u * sw));
      const texXB = frameB
        ? frameB.sx + Math.min(frameB.sw - 1, Math.floor(u * frameB.sw))
        : texX;
      for (let y = yStart; y <= yEnd; y += 1) {
        const v = (y + 0.5 - top) * vScale;
        if (v < 0 || v >= 1) continue;

        const texY = sy + Math.min(sh - 1, Math.floor(v * sh));
        const src = (texY * texture.width + texX) * 4;
        let alpha = data[src + 3] / 255;
        let r = data[src];
        let g = data[src + 1];
        let b = data[src + 2];

        if (frameB) {
          const texYB = frameB.sy + Math.min(frameB.sh - 1, Math.floor(v * frameB.sh));
          const srcB = (texYB * texture.width + texXB) * 4;
          const alphaB = data[srcB + 3] / 255;
          const blendedAlpha = alpha * (1 - blend) + alphaB * blend;
          if (blendedAlpha > 1e-4) {
            // Blend premultiplied colour so transparent texels do not darken edges.
            r = (r * alpha * (1 - blend) + data[srcB] * alphaB * blend) / blendedAlpha;
            g =
              (g * alpha * (1 - blend) + data[srcB + 1] * alphaB * blend) /
              blendedAlpha;
            b =
              (b * alpha * (1 - blend) + data[srcB + 2] * alphaB * blend) /
              blendedAlpha;
          }
          alpha = blendedAlpha;
        }

        alpha *= spriteAlpha;
        if (alpha <= 0.02) continue;

        const idx = y * width + x;
        if (forward >= depth[idx]) {
          occluded += 1;
          continue;
        }

        const dst = idx * 4;
        const shadedR = r * tint[0] * shade + FOG_R * fog;
        const shadedG = g * tint[1] * shade + FOG_G * fog;
        const shadedB = b * tint[2] * shade + FOG_B * fog;
        pixels[dst] = shadedR * alpha + pixels[dst] * (1 - alpha);
        pixels[dst + 1] = shadedG * alpha + pixels[dst + 1] * (1 - alpha);
        pixels[dst + 2] = shadedB * alpha + pixels[dst + 2] * (1 - alpha);
        pixels[dst + 3] = 255;
        if (alpha > 0.4) depth[idx] = forward;
        drawn += 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }

    rect.pixels = drawn;
    rect.occluded = occluded;
    rect.contentW = maxX >= minX ? maxX - minX + 1 : 0;
    rect.contentH = maxY >= minY ? maxY - minY + 1 : 0;
  }

  /**
   * Composites the first-person hands/weapon over the finished framebuffer.
   * The viewmodel is drawn last and ignores depth so it never clips into walls.
   */
  private drawViewmodel(viewmodel: ViewmodelDraw): void {
    const { width, height, pixels } = this;
    const { texture } = viewmodel;
    const data = texture.data;
    // Snap to whole pixels: typed-array writes at fractional indices are
    // silently dropped, which made the viewmodel invisible at bob offsets.
    const originX = Math.round(viewmodel.x);
    const originY = Math.round(viewmodel.y);
    let drawn = 0;

    for (let ty = 0; ty < texture.height; ty += 1) {
      const y = originY + ty;
      if (y < 0 || y >= height) continue;
      for (let tx = 0; tx < texture.width; tx += 1) {
        const x = originX + tx;
        if (x < 0 || x >= width) continue;
        const src = (ty * texture.width + tx) * 4;
        const alpha = data[src + 3] / 255;
        if (alpha <= 0.01) continue;
        const dst = (y * width + x) * 4;
        pixels[dst] = data[src] * alpha + pixels[dst] * (1 - alpha);
        pixels[dst + 1] = data[src + 1] * alpha + pixels[dst + 1] * (1 - alpha);
        pixels[dst + 2] = data[src + 2] * alpha + pixels[dst + 2] * (1 - alpha);
        pixels[dst + 3] = 255;
        drawn += 1;
      }
    }

    this.stats.viewmodelPixels = drawn;
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
