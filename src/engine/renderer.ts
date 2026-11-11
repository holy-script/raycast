import { castRay } from "./dda";
import { clamp, fract } from "./math";
import type { World } from "./world";

export const WALL_HEIGHT = 1.4;

const FOG_R = 16;
const FOG_G = 18;
const FOG_B = 30;

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
  horizon: number;
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
}

export class Renderer {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8ClampedArray;
  readonly depth: Float32Array;
  private readonly image: ImageData;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly skyRows: Uint8Array;

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
    this.drawSky();
    this.depth.fill(Infinity);
    this.drawWalls(cam, world, textures);
    this.drawFloor(cam, world, floorTexture);
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

    for (let x = 0; x < width; x += 1) {
      const cameraX = (2 * x) / width - 1;
      const rayX = cam.dirX + cam.planeX * cameraX;
      const rayY = cam.dirY + cam.planeY * cameraX;
      const hit = castRay(world, cam.x, cam.y, rayX, rayY);
      if (!hit) continue;

      const texture = textures[hit.tile] ?? textures[1];
      if (!texture) continue;

      const distance = hit.distance;
      const invDist = cam.focal / distance;
      const yTopF = cam.horizon - (WALL_HEIGHT - cam.eyeZ) * invDist;
      const yBottomF = cam.horizon + cam.eyeZ * invDist;
      const yStart = Math.max(0, Math.ceil(yTopF));
      const yEnd = Math.min(height - 1, Math.floor(yBottomF));
      if (yStart > yEnd) continue;

      const texX = Math.min(
        texture.width - 1,
        Math.floor(clamp(hit.wallU, 0.0001, 0.9999) * texture.width),
      );
      const vStep = texture.height / (yBottomF - yTopF);
      let v = (yStart - yTopF) * vStep;

      const shade =
        clamp(1 / (1 + distance * 0.085), 0.08, 1) * (hit.side === 0 ? 1 : 0.76);
      const fog = 1 - shade;

      for (let y = yStart; y <= yEnd; y += 1) {
        const texY = clamp(Math.floor(v), 0, texture.height - 1);
        const src = (texY * texture.width + texX) * 4;
        const dst = (y * width + x) * 4;
        const idx = y * width + x;
        pixels[dst] = texture.data[src] * shade + FOG_R * fog;
        pixels[dst + 1] = texture.data[src + 1] * shade + FOG_G * fog;
        pixels[dst + 2] = texture.data[src + 2] * shade + FOG_B * fog;
        pixels[dst + 3] = 255;
        depth[idx] = distance;
        v += vStep;
      }
    }
  }

  private drawFloor(cam: CameraState, world: World, texture: Texture): void {
    const { width, height, pixels, depth } = this;
    const rayLeftX = cam.dirX - cam.planeX;
    const rayLeftY = cam.dirY - cam.planeY;
    const stepX = (2 * cam.planeX) / width;
    const stepY = (2 * cam.planeY) / width;

    const startY = Math.max(0, Math.ceil(cam.horizon));
    for (let y = startY; y < height; y += 1) {
      const p = y + 0.5 - cam.horizon;
      if (p <= 0.0001) continue;
      const rowDistance = (cam.eyeZ * cam.focal) / p;
      if (!Number.isFinite(rowDistance)) continue;

      let floorX = cam.x + rowDistance * rayLeftX;
      let floorY = cam.y + rowDistance * rayLeftY;
      const shade = clamp(1 / (1 + rowDistance * 0.075), 0.06, 1);
      const fog = 1 - shade;
      const rowBase = y * width;

      for (let x = 0; x < width; x += 1) {
        const idx = rowBase + x;
        if (rowDistance < depth[idx]) {
          const cellX = Math.floor(floorX);
          const cellY = Math.floor(floorY);
          if (
            cellX >= 0 &&
            cellY >= 0 &&
            cellX < world.width &&
            cellY < world.height &&
            world.tiles[cellY * world.width + cellX] === 0
          ) {
            const texX = Math.floor(fract(floorX) * texture.width);
            const texY = Math.floor(fract(floorY) * texture.height);
            const src = (texY * texture.width + texX) * 4;
            const dst = idx * 4;
            pixels[dst] = texture.data[src] * shade + FOG_R * fog;
            pixels[dst + 1] = texture.data[src + 1] * shade + FOG_G * fog;
            pixels[dst + 2] = texture.data[src + 2] * shade + FOG_B * fog;
            pixels[dst + 3] = 255;
            depth[idx] = rowDistance;
          }
        }
        floorX += stepX;
        floorY += stepY;
      }
    }
  }

  private drawSprites(cam: CameraState, sprites: SpriteDraw[]): void {
    const prepared = sprites
      .map((sprite) => ({
        sprite,
        depth: (sprite.x - cam.x) * cam.dirX + (sprite.y - cam.y) * cam.dirY,
      }))
      .filter((entry) => entry.depth > 0.08)
      .sort((a, b) => b.depth - a.depth);

    for (const entry of prepared) {
      this.drawSprite(cam, entry.sprite, entry.depth);
    }
  }

  private drawSprite(cam: CameraState, sprite: SpriteDraw, distance: number): void {
    const { width, height, pixels, depth } = this;
    const dx = sprite.x - cam.x;
    const dy = sprite.y - cam.y;
    const lateral = (dx * cam.dirY - dy * cam.dirX) / (distance * cam.tanHalf);
    const screenX = (width / 2) * (1 + lateral);

    const worldSize = sprite.worldSize;
    const anchorZ = sprite.anchorZ ?? 0;
    const halfWidth = (cam.focal * worldSize) / (2 * distance);
    const xStart = Math.max(0, Math.ceil(screenX - halfWidth));
    const xEnd = Math.min(width - 1, Math.floor(screenX + halfWidth));
    if (xStart > xEnd) return;

    const yFeet =
      cam.horizon + ((cam.eyeZ - (sprite.z + anchorZ)) * cam.focal) / distance;
    const yHead =
      cam.horizon +
      ((cam.eyeZ - (sprite.z + anchorZ + worldSize)) * cam.focal) / distance;
    if (yHead > height || yFeet < 0) return;

    const yStart = Math.max(0, Math.ceil(yHead));
    const yEnd = Math.min(height - 1, Math.floor(yFeet));

    if (sprite.z < 0.25) {
      const groundY =
        cam.horizon + ((cam.eyeZ - sprite.z) * cam.focal) / distance;
      this.drawShadow(screenX, groundY, halfWidth, distance);
    }

    const { texture, sx, sy, sw, sh } = sprite.frame;
    const data = texture.data;
    const spriteAlpha = sprite.alpha ?? 1;
    const tint = sprite.tint ?? [1, 1, 1];
    const shade = clamp(1 / (1 + distance * 0.05), 0.1, 1);
    const fog = 1 - shade;
    const uScale = 1 / (2 * halfWidth);
    const vScale = 1 / (yFeet - yHead);

    for (let x = xStart; x <= xEnd; x += 1) {
      const u = (x + 0.5 - (screenX - halfWidth)) * uScale;
      if (u < 0 || u >= 1) continue;
      const texX = sx + Math.min(sw - 1, Math.floor(u * sw));
      for (let y = yStart; y <= yEnd; y += 1) {
        const v = (y + 0.5 - yHead) * vScale;
        if (v < 0 || v >= 1) continue;
        const idx = y * width + x;
        if (distance >= depth[idx]) continue;

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
        if (alpha > 0.6) depth[idx] = distance;
      }
    }
  }

  private drawShadow(
    screenX: number,
    yFeet: number,
    halfWidth: number,
    distance: number,
  ): void {
    const { width, height, pixels, depth } = this;
    const radiusX = Math.max(1, halfWidth * 0.72);
    const radiusY = Math.max(1, radiusX * 0.32);
    const xStart = Math.max(0, Math.floor(screenX - radiusX));
    const xEnd = Math.min(width - 1, Math.ceil(screenX + radiusX));
    const yStart = Math.max(0, Math.floor(yFeet - radiusY));
    const yEnd = Math.min(height - 1, Math.ceil(yFeet + radiusY));

    for (let y = yStart; y <= yEnd; y += 1) {
      const ny = (y - yFeet) / radiusY;
      for (let x = xStart; x <= xEnd; x += 1) {
        const nx = (x - screenX) / radiusX;
        const d2 = nx * nx + ny * ny;
        if (d2 >= 1) continue;
        const idx = y * width + x;
        const floorDepth = depth[idx];
        if (!Number.isFinite(floorDepth) || floorDepth < distance * 0.85) continue;
        const alpha = 0.32 * (1 - d2) * (1 - d2);
        const dst = idx * 4;
        pixels[dst] = pixels[dst] * (1 - alpha);
        pixels[dst + 1] = pixels[dst + 1] * (1 - alpha);
        pixels[dst + 2] = pixels[dst + 2] * (1 - alpha);
      }
    }
  }
}
