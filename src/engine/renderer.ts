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
    this.drawGeometry(cam, world, textures, floorTexture, topTexture);
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

  /**
   * Rasterizes floors, wall faces and wall tops with one camera-correct ray per
   * pixel. Wall columns used to be cast in the horizontal plane and then sheared
   * vertically for pitch, which moved a wall's screen x with its height and bent
   * straight walls into curves while looking down. Deriving the horizontal ray
   * from the pitched basis as well keeps every surface on the same perspective,
   * and the ray parameter is the true camera-space depth for every occluder.
   */
  private drawGeometry(
    cam: CameraState,
    world: World,
    textures: Record<number, Texture>,
    floorTexture: Texture,
    topTexture: Texture,
  ): void {
    const { width, height, pixels, depth } = this;
    const cosP = Math.cos(cam.pitch);
    const sinP = Math.sin(cam.pitch);
    const fogScale = cam.fogScale ?? 1;
    const rightX = -cam.dirY;
    const rightY = cam.dirX;
    const colRayX = new Float32Array(width);
    const colRayY = new Float32Array(width);
    for (let x = 0; x < width; x += 1) {
      const xCam = (x + 0.5 - width / 2) / cam.focal;
      colRayX[x] = rightX * xCam;
      colRayY[x] = rightY * xCam;
    }
    const paintedColumns = new Uint8Array(width);
    const centerY = this.centerY;
    let wallPixels = 0;
    let topPixels = 0;

    for (let y = 0; y < height; y += 1) {
      const yCam = (centerY - (y + 0.5)) / cam.focal;
      const rayZ = sinP + cosP * yCam;
      // Pitch rotates the forward axis, so the horizontal component changes
      // with the screen row as well as the column.
      const horizontal = cosP - sinP * yCam;
      const baseX = cam.dirX * horizontal;
      const baseY = cam.dirY * horizontal;
      const rowOffset = y * width;
      const floorPlaneT = rayZ < -1e-6 ? -cam.eyeZ / rayZ : Infinity;

      for (let x = 0; x < width; x += 1) {
        const rayX = baseX + colRayX[x];
        const rayY = baseY + colRayY[x];
        const idx = rowOffset + x;

        let floorT = Infinity;
        let floorWorldX = 0;
        let floorWorldY = 0;
        if (floorPlaneT > NEAR_PLANE && floorPlaneT < Infinity) {
          const worldX = cam.x + floorPlaneT * rayX;
          const worldY = cam.y + floorPlaneT * rayY;
          const cellX = Math.floor(worldX);
          const cellY = Math.floor(worldY);
          if (
            cellX >= 0 &&
            cellY >= 0 &&
            cellX < world.width &&
            cellY < world.height &&
            world.tiles[cellY * world.width + cellX] === 0
          ) {
            floorT = floorPlaneT;
            floorWorldX = worldX;
            floorWorldY = worldY;
          }
        }

        let hitT = Infinity;
        let hitKind: 0 | 1 | 2 = 0;
        let hitSide: 0 | 1 = 0;
        let hitU = 0;
        let hitHeight = 0;
        let hitTile = 0;

        let mapX = Math.floor(cam.x);
        let mapY = Math.floor(cam.y);
        const deltaX = rayX === 0 ? Infinity : Math.abs(1 / rayX);
        const deltaY = rayY === 0 ? Infinity : Math.abs(1 / rayY);
        const stepX = rayX < 0 ? -1 : 1;
        const stepY = rayY < 0 ? -1 : 1;
        let sideDistX =
          rayX < 0 ? (cam.x - mapX) * deltaX : (mapX + 1 - cam.x) * deltaX;
        let sideDistY =
          rayY < 0 ? (cam.y - mapY) * deltaY : (mapY + 1 - cam.y) * deltaY;
        let entry = 0;
        let nextEntry = Math.min(sideDistX, sideDistY);
        let side: 0 | 1 = 0;

        for (let step = 0; step < 4096; step += 1) {
          if (entry > floorPlaneT + 1e-6) break;
          if (mapX < 0 || mapY < 0 || mapX >= world.width || mapY >= world.height) {
            break;
          }

          const cell = mapY * world.width + mapX;
          const tile = world.tiles[cell];
          if (tile !== 0) {
            const cellHeight = world.heights[cell];
            const zEntry = cam.eyeZ + entry * rayZ;
            if (entry > NEAR_PLANE && zEntry >= -1e-4 && zEntry <= cellHeight + 1e-4) {
              hitT = entry;
              hitKind = 1;
              hitSide = side;
              hitU = side === 0 ? cam.y + entry * rayY : cam.x + entry * rayX;
              hitU -= Math.floor(hitU);
              if (side === 0 && rayX > 0) hitU = 1 - hitU;
              if (side === 1 && rayY < 0) hitU = 1 - hitU;
              hitHeight = cellHeight;
              hitTile = tile;
              break;
            }
            if (cam.eyeZ > cellHeight + 1e-3 && rayZ < -1e-6) {
              const topT = (cellHeight - cam.eyeZ) / rayZ;
              if (
                topT > NEAR_PLANE &&
                topT >= entry - 1e-4 &&
                topT <= nextEntry + 1e-4
              ) {
                const topX = cam.x + topT * rayX;
                const topY = cam.y + topT * rayY;
                if (Math.floor(topX) === mapX && Math.floor(topY) === mapY) {
                  hitT = topT;
                  hitKind = 2;
                  hitTile = tile;
                  break;
                }
              }
            }
          }

          if (nextEntry > floorPlaneT + 1e-6) break;
          if (sideDistX < sideDistY) {
            sideDistX += deltaX;
            mapX += stepX;
            side = 0;
          } else {
            sideDistY += deltaY;
            mapY += stepY;
            side = 1;
          }
          entry = nextEntry;
          nextEntry = Math.min(sideDistX, sideDistY);
        }

        if (hitT < Infinity) {
          const texture = textures[hitTile] ?? textures[1];
          if (texture) {
            let src: number;
            let dst = idx * 4;
            if (hitKind === 1) {
              const texX = Math.min(
                texture.width - 1,
                Math.floor(clamp(hitU, 0.0001, 0.9999) * texture.width),
              );
              const v =
                hitHeight > 0
                  ? clamp((cam.eyeZ + hitT * rayZ) / hitHeight, 0, 1)
                  : 0;
              const texY = clamp(
                Math.floor((1 - v) * texture.height),
                0,
                texture.height - 1,
              );
              src = (texY * texture.width + texX) * 4;
              const sideShade = hitSide === 0 ? 1 : 0.76;
              const shade =
                clamp(1 / (1 + hitT * 0.085 * fogScale), 0.08, 1) * sideShade;
              const fog = 1 - shade;
              pixels[dst] = texture.data[src] * shade + FOG_R * fog;
              pixels[dst + 1] = texture.data[src + 1] * shade + FOG_G * fog;
              pixels[dst + 2] = texture.data[src + 2] * shade + FOG_B * fog;
              pixels[dst + 3] = 255;
              wallPixels += 1;
            } else {
              const worldX = cam.x + hitT * rayX;
              const worldY = cam.y + hitT * rayY;
              const fx = fract(worldX);
              const fy = fract(worldY);
              const texX = Math.min(
                topTexture.width - 1,
                Math.floor(fx * topTexture.width),
              );
              const texY = Math.min(
                topTexture.height - 1,
                Math.floor(fy * topTexture.height),
              );
              src = (texY * topTexture.width + texX) * 4;
              const edgeDistance = Math.min(fx, 1 - fx, fy, 1 - fy);
              const bevel = 0.9 + clamp(edgeDistance / 0.06, 0, 1) * 0.1;
              const shade =
                clamp(1 / (1 + hitT * 0.075 * fogScale), 0.06, 1) * 0.95 * bevel;
              const fog = 1 - shade;
              pixels[dst] = topTexture.data[src] * shade + FOG_R * fog;
              pixels[dst + 1] = topTexture.data[src + 1] * shade + FOG_G * fog;
              pixels[dst + 2] = topTexture.data[src + 2] * shade + FOG_B * fog;
              pixels[dst + 3] = 255;
              topPixels += 1;
            }
            depth[idx] = hitT;
            paintedColumns[x] = 1;
          }
        } else if (floorT < Infinity) {
          const texX = Math.floor(fract(floorWorldX) * floorTexture.width);
          const texY = Math.floor(fract(floorWorldY) * floorTexture.height);
          const src = (texY * floorTexture.width + texX) * 4;
          const dst = idx * 4;
          const shade = clamp(1 / (1 + floorT * 0.075 * fogScale), 0.06, 1);
          const fog = 1 - shade;
          pixels[dst] = floorTexture.data[src] * shade + FOG_R * fog;
          pixels[dst + 1] = floorTexture.data[src + 1] * shade + FOG_G * fog;
          pixels[dst + 2] = floorTexture.data[src + 2] * shade + FOG_B * fog;
          pixels[dst + 3] = 255;
          depth[idx] = floorT;
        }
      }
    }

    let columns = 0;
    for (let x = 0; x < width; x += 1) if (paintedColumns[x]) columns += 1;
    this.stats.wallColumns = columns;
    this.stats.wallPixels = wallPixels;
    this.stats.topPixels = topPixels;
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
    const { sprite, zCam, xCam, yCam } = entry;
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
        // Geometry depth is camera-space depth now, matching this billboard's
        // zCam under any pitch. Comparing the old horizontal forward distance
        // clipped actors behind walls that were below the camera.
        if (zCam >= depth[idx]) {
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
        if (alpha > 0.4) depth[idx] = zCam;
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
        if (!Number.isFinite(floorDepth) || floorDepth < zCam - 0.2) continue;
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
