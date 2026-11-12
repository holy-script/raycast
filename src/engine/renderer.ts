import { hazardHotAt } from "./hazard";
import { clamp, fract } from "./math";
import { TOWER_TILE, WALL_HEIGHT, type World } from "./world";

export { WALL_HEIGHT };

const FOG_R = 16;
const FOG_G = 18;
const FOG_B = 30;
const NEAR_PLANE = 0.01;
/** World height of one facade window row before the texture repeats. */
const FACADE_STOREY = 3;
/** Interior cladding repeats on a 1.5 m grid so close walls keep detail. */
const INTERIOR_PANEL = 1.5;

/** Stacked depth slices are only worth their extra sampling cost up close. */
export const SLICE_LOD_DISTANCE = 8;

export interface Texture {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/**
 * Grayscale depth-band map that mirrors a colour frame's rect. Band 0 is the
 * farthest slice and `bands - 1` the nearest; the red channel is the index.
 */
export interface FrameSlice {
  texture: Texture;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  bands: number;
  /** Camera-space depth offsets in metres, indexed by band (far → near). */
  offsets: readonly number[];
}

export interface FrameRect {
  texture: Texture;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** Present when this frame has a stacked depth-slice band map. */
  slice?: FrameSlice;
}

/**
 * Decodes a packed band index from the slice atlas red channel. Bands are
 * stored at even 0–255 steps, so this also tolerates any channel quantization.
 */
export function sliceBandFromChannel(red: number, bands: number): number {
  if (bands <= 1) return 0;
  return Math.min(bands - 1, Math.max(0, Math.round((red / 255) * (bands - 1))));
}

/** Band draw order: farthest slice first, so nearer slices depth-test over it. */
export function sliceDrawOrder(offsets: readonly number[]): number[] {
  return offsets
    .map((offset, band) => ({ offset, band }))
    .sort((a, b) => b.offset - a.offset)
    .map((entry) => entry.band);
}

/** Slices only apply within the close-range LOD; farther actors use one quad. */
export function wantsSlices(distance: number): boolean {
  return distance <= SLICE_LOD_DISTANCE;
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
  /** Projectiles and muzzle flashes must not drop a ground shadow. */
  noShadow?: boolean;
  /** Scales the contact shadow; prone corpses need a wider soft patch. */
  shadowScale?: number;
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

/**
 * Slag surfaces drawn over hazard cells. The game passes the simulation clock so
 * each cell can resolve its own phase inside the floor loop; the renderer stays
 * a pure function of its arguments.
 */
export interface FloorHazards {
  hot: Texture;
  cold: Texture;
  time: number;
}

export interface RenderStats {
  wallColumns: number;
  wallPixels: number;
  topPixels: number;
  /** Pixels of interior slab undersides, drawn only below a ceiling plane. */
  ceilingPixels: number;
  /** Interior wall and ceiling pixels sampled from the panel texture. */
  interiorPixels: number;
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
    ceilingPixels: 0,
    interiorPixels: 0,
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
    floorHazards?: FloorHazards,
  ): void {
    this.stats.wallColumns = 0;
    this.stats.wallPixels = 0;
    this.stats.topPixels = 0;
    this.stats.ceilingPixels = 0;
    this.stats.interiorPixels = 0;
    this.stats.viewmodelPixels = 0;
    this.stats.spriteRects = [];
    this.drawSky();
    this.depth.fill(Infinity);
    this.drawGeometry(cam, world, textures, floorTexture, topTexture, floorHazards);
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
   * Rasterizes floors, wall faces, wall tops, interior ceilings and roofs with
   * one camera-correct ray per pixel. Wall columns used to be cast in the
   * horizontal plane and then sheared vertically for pitch, which moved a
   * wall's screen x with its height and bent straight walls into curves while
   * looking down. Deriving the horizontal ray from the pitched basis as well
   * keeps every surface on the same perspective, and the ray parameter is the
   * true camera-space depth for every occluder.
   *
   * Interior sectors add two more horizontal planes per cell: the slab
   * underside (`ceilings`) below the camera and the slab top (`roofs`) above it.
   * Both are solved with `t = (z - eyeZ) / rayZ` inside the DDA cell span, so
   * they share the pitched basis, the depth metric, and the fog/shade rules
   * instead of introducing a second projection.
   */
  private drawGeometry(
    cam: CameraState,
    world: World,
    textures: Record<number, Texture>,
    floorTexture: Texture,
    topTexture: Texture,
    floorHazards?: FloorHazards,
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
    let ceilingPixels = 0;
    let interiorPixels = 0;
    const cameraCell =
      Math.floor(cam.y) * world.width + Math.floor(cam.x);
    // A ray that starts inside a sector must not treat the camera's own cell as
    // an exterior boundary (that would paint a lintel across the room).
    const cameraInterior =
      cam.x >= 0 &&
      cam.y >= 0 &&
      cam.x < world.width &&
      cam.y < world.height &&
      world.ceilings[cameraCell] > 0;

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
        let hitKind: 0 | 1 | 2 | 3 = 0;
        let hitSide: 0 | 1 = 0;
        let hitU = 0;
        let hitHeight = 0;
        let hitTile = 0;
        // A face reached through interior cells is the room's own wall; it
        // samples the panel texture instead of the exterior facade.
        let hitInterior = false;

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
        let interiorBefore = cameraInterior;

        for (let step = 0; step < 4096; step += 1) {
          if (entry > floorPlaneT + 1e-6) break;
          if (mapX < 0 || mapY < 0 || mapX >= world.width || mapY >= world.height) {
            break;
          }

          const cell = mapY * world.width + mapX;
          const tile = world.tiles[cell];
          const ceiling = world.ceilings[cell];
          const roof = world.roofs[cell];
          const zEntry = cam.eyeZ + entry * rayZ;

          // The slab top is nearer than anything under it, so a camera above a
          // sector sees its roof even when a partition stands inside the room.
          if (roof > 0 && cam.eyeZ > roof + 1e-3 && rayZ < -1e-6) {
            const roofT = (roof - cam.eyeZ) / rayZ;
            if (
              roofT > NEAR_PLANE &&
              roofT >= entry - 1e-4 &&
              roofT <= nextEntry + 1e-4
            ) {
              const roofX = cam.x + roofT * rayX;
              const roofY = cam.y + roofT * rayY;
              if (Math.floor(roofX) === mapX && Math.floor(roofY) === mapY) {
                hitT = roofT;
                hitKind = 2;
                hitTile = tile !== 0 ? tile : TOWER_TILE;
                break;
              }
            }
          }

          // Entering a sector from outdoors through a carved cell: the band
          // between the ceiling and the roof is solid tower mass, so paint the
          // facade there. Without it a full-height doorway would read as a slot
          // cut through the building to the sky.
          if (
            ceiling > 0 &&
            tile === 0 &&
            !interiorBefore &&
            entry > NEAR_PLANE &&
            zEntry >= ceiling - 1e-4 &&
            zEntry <= roof + 1e-4
          ) {
            hitT = entry;
            hitKind = 1;
            hitSide = side;
            hitU = side === 0 ? cam.y + entry * rayY : cam.x + entry * rayX;
            hitU -= Math.floor(hitU);
            if (side === 0 && rayX > 0) hitU = 1 - hitU;
            if (side === 1 && rayY < 0) hitU = 1 - hitU;
            hitHeight = roof;
            hitTile = TOWER_TILE;
            break;
          }

          // Slab underside: the ceiling plane closes the room above the player.
          if (ceiling > 0 && rayZ > 1e-6 && cam.eyeZ < ceiling) {
            const ceilingT = (ceiling - cam.eyeZ) / rayZ;
            if (
              ceilingT > NEAR_PLANE &&
              ceilingT >= entry - 1e-4 &&
              ceilingT <= nextEntry + 1e-4
            ) {
              const ceilX = cam.x + ceilingT * rayX;
              const ceilY = cam.y + ceilingT * rayY;
              if (Math.floor(ceilX) === mapX && Math.floor(ceilY) === mapY) {
                hitT = ceilingT;
                hitKind = 3;
                hitTile = tile !== 0 ? tile : TOWER_TILE;
                break;
              }
            }
          }

          if (tile !== 0) {
            const cellHeight = world.heights[cell];
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
              hitInterior = interiorBefore;
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
          interiorBefore = ceiling > 0;

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
          const interior = hitKind === 1 && hitInterior;
          const panelTexture = textures[2];
          const wallTexture =
            interior && panelTexture ? panelTexture : textures[hitTile] ?? textures[1];
          const texture = hitKind === 1 ? wallTexture : topTexture;
          if (texture) {
            let src: number;
            const dst = idx * 4;
            if (hitKind === 1) {
              const facade = !interior && hitTile === TOWER_TILE;
              const wallZ = cam.eyeZ + hitT * rayZ;
              let column: number;
              let texY: number;
              if (interior) {
                // World-space u keeps the 1.5 m cladding grid continuous across
                // partition cells; hitU's per-cell flip would break the seams.
                const wallU =
                  hitSide === 0 ? cam.y + hitT * rayY : cam.x + hitT * rayX;
                column = Math.min(
                  texture.width - 1,
                  Math.floor(fract(wallU / INTERIOR_PANEL) * texture.width),
                );
                texY = clamp(
                  Math.floor((1 - fract(wallZ / INTERIOR_PANEL)) * texture.height),
                  0,
                  texture.height - 1,
                );
              } else {
                const texX = Math.min(
                  texture.width - 1,
                  Math.floor(clamp(hitU, 0.0001, 0.9999) * texture.width),
                );
                column = facade
                  ? (texX + mapX * 37 + mapY * 59) % texture.width
                  : texX;
                const v = facade
                  ? fract(wallZ / FACADE_STOREY)
                  : hitHeight > 0
                    ? clamp(wallZ / hitHeight, 0, 1)
                    : 0;
                texY = clamp(
                  Math.floor((1 - v) * texture.height),
                  0,
                  texture.height - 1,
                );
              }
              // Facades repeat one texture every 3 m of tower height, so a 12 m
              // tower reads as four storeys instead of one stretched pane. The
              // per-cell column shift keeps neighbouring buildings from sharing
              // an identical window pattern. Interiors use the panel cladding
              // instead: a partition is not a storey stack, and indoors there
              // must be no lit windows.
              src = (texY * texture.width + column) * 4;
              const sideShade = hitSide === 0 ? 1 : 0.76;
              const shade =
                clamp(1 / (1 + hitT * 0.085 * fogScale), 0.08, 1) *
                sideShade *
                (interior ? 1.15 : 1);
              const fog = 1 - shade;
              pixels[dst] = texture.data[src] * shade + FOG_R * fog;
              pixels[dst + 1] = texture.data[src + 1] * shade + FOG_G * fog;
              pixels[dst + 2] = texture.data[src + 2] * shade + FOG_B * fog;
              pixels[dst + 3] = 255;
              if (interior) interiorPixels += 1;
              else wallPixels += 1;
            } else {
              const worldX = cam.x + hitT * rayX;
              const worldY = cam.y + hitT * rayY;
              const scaled = hitKind === 3 ? 0.5 : 1;
              const fx = fract(worldX * scaled);
              const fy = fract(worldY * scaled);
              const texX = Math.min(
                texture.width - 1,
                Math.floor(fx * texture.width),
              );
              const texY = Math.min(
                texture.height - 1,
                Math.floor(fy * texture.height),
              );
              src = (texY * texture.width + texX) * 4;
              const edgeDistance = Math.min(fx, 1 - fx, fy, 1 - fy);
              const bevel = 0.9 + clamp(edgeDistance / 0.06, 0, 1) * 0.1;
              // Roofs keep the slab bevel. Ceilings are the panel material
              // seen from underneath: an even, darker interior light with the
              // larger grid so the surface reads as a ceiling, not a roof.
              const shade =
                clamp(1 / (1 + hitT * 0.075 * fogScale), 0.06, 1) *
                (hitKind === 3 ? 0.78 : 0.95 * bevel);
              const fog = 1 - shade;
              pixels[dst] = texture.data[src] * shade + FOG_R * fog;
              pixels[dst + 1] = texture.data[src + 1] * shade + FOG_G * fog;
              pixels[dst + 2] = texture.data[src + 2] * shade + FOG_B * fog;
              pixels[dst + 3] = 255;
              if (hitKind === 3) {
                ceilingPixels += 1;
                interiorPixels += 1;
              } else topPixels += 1;
            }
            depth[idx] = hitT;
            paintedColumns[x] = 1;
          }
        } else if (floorT < Infinity) {
          const hazardCell =
            floorHazards !== undefined &&
            world.hazards[
              Math.floor(floorWorldY) * world.width + Math.floor(floorWorldX)
            ] !== 0;
          const hotNow =
            hazardCell && floorHazards !== undefined
              ? hazardHotAt(
                  floorHazards.time,
                  world.hazardPhases[
                    Math.floor(floorWorldY) * world.width + Math.floor(floorWorldX)
                  ],
                )
              : false;
          const surface =
            hazardCell && floorHazards
              ? hotNow
                ? floorHazards.hot
                : floorHazards.cold
              : floorTexture;
          const texX = Math.floor(fract(floorWorldX) * surface.width);
          const texY = Math.floor(fract(floorWorldY) * surface.height);
          const src = (texY * surface.width + texX) * 4;
          const dst = idx * 4;
          // Hot slag keeps a small additive ember glow on top of the distance
          // falloff so a burning channel reads at range.
          const shade = clamp(1 / (1 + floorT * 0.075 * fogScale), 0.06, 1);
          const ember = hotNow ? 1 : 0;
          const fog = 1 - shade;
          pixels[dst] = surface.data[src] * shade + FOG_R * fog + ember * 30;
          pixels[dst + 1] = surface.data[src + 1] * shade + FOG_G * fog + ember * 9;
          pixels[dst + 2] = surface.data[src + 2] * shade + FOG_B * fog;
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
    this.stats.ceilingPixels = ceilingPixels;
    this.stats.interiorPixels = interiorPixels;
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
        distance: Math.hypot(dx, dy, dz),
      });
    }

    prepared.sort((a, b) => b.zCam - a.zCam);
    for (const entry of prepared) {
      this.drawSprite(cam, entry);
    }
  }

  private drawSprite(cam: CameraState, entry: PreparedSprite): void {
    const { sprite, zCam, xCam, yCam, distance } = entry;
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

    if (!sprite.noShadow && sprite.z < 2.5) {
      this.drawShadow(cam, entry);
    }

    const data = texture.data;
    const spriteAlpha = sprite.alpha ?? 1;
    const tint = sprite.tint ?? [1, 1, 1];
    const frameB =
      sprite.frameB && sprite.frameB.texture === texture ? sprite.frameB : undefined;
    const blend = frameB ? clamp(sprite.blend ?? 0, 0, 1) : 0;
    // Shade from the base depth for every slice so banding does not tint the
    // body; only the depth test and depth write move per band.
    const shade = clamp(
      1 / (1 + zCam * 0.05 * (cam.fogScale ?? 1)),
      0.1,
      1,
    );
    const fog = 1 - shade;
    const uScale = 1 / widthPx;
    const vScale = 1 / heightPx;
    // Stacked slices: a close actor is painted band by band, farthest first.
    // Each band writes its own camera-space depth, so a wall edge occludes the
    // far slices while the near slices survive, giving per-band silhouette
    // parallax without re-projecting the billboard (which would seam).
    const sliced =
      wantsSlices(distance) &&
      sprite.frame.slice !== undefined &&
      sprite.frame.slice.bands >= 2 &&
      sprite.frame.slice.offsets.length === sprite.frame.slice.bands
        ? sprite.frame.slice
        : undefined;
    const sliceTexture = sliced?.texture;
    const sliceData = sliceTexture?.data;
    const sliceBands = sliced?.bands ?? 0;
    const sliceSx = sliced?.sx ?? 0;
    const sliceSy = sliced?.sy ?? 0;
    const sliceSw = sliced?.sw ?? 1;
    const sliceSh = sliced?.sh ?? 1;
    const frameBSlice = frameB?.slice;
    // -1 is the unsliced single pass and keeps the original draw path.
    const passes = sliced ? sliceDrawOrder(sliced.offsets) : [-1];
    let drawn = 0;
    let occluded = 0;
    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;

    for (const band of passes) {
      const viewZ =
        band >= 0 && sliced ? zCam + sliced.offsets[band] : zCam;
      if (viewZ <= 0.12) continue;
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

          if (band >= 0 && sliceData) {
            const bandX = sliceSx + Math.min(sliceSw - 1, Math.floor(u * sliceSw));
            const bandY = sliceSy + Math.min(sliceSh - 1, Math.floor(v * sliceSh));
            let bandValue = sliceBandFromChannel(
              sliceData[(bandY * sliceTexture!.width + bandX) * 4],
              sliceBands,
            );
            // Crossfades keep their colour blend; the band mask follows the
            // dominant pitch row so a texel is never painted twice.
            if (frameBSlice && blend >= 0.5) {
              const bxB =
                frameBSlice.sx +
                Math.min(frameBSlice.sw - 1, Math.floor(u * frameBSlice.sw));
              const byB =
                frameBSlice.sy +
                Math.min(frameBSlice.sh - 1, Math.floor(v * frameBSlice.sh));
              bandValue = sliceBandFromChannel(
                frameBSlice.texture.data[
                  (byB * frameBSlice.texture.width + bxB) * 4
                ],
                frameBSlice.bands,
              );
            }
            if (bandValue !== band) continue;
          }

          const idx = y * width + x;
          // Geometry depth is camera-space depth now, matching this billboard's
          // zCam under any pitch. Comparing the old horizontal forward distance
          // clipped actors behind walls that were below the camera.
          if (viewZ >= depth[idx]) {
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
          if (alpha > 0.4) depth[idx] = viewZ;
          drawn += 1;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
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
      (cam.focal * sprite.worldSize * 0.36 * (sprite.shadowScale ?? 1)) / zCam,
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
  /** 3D distance from the eye to the billboard centre; drives slice LOD. */
  distance: number;
}
