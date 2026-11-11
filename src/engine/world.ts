export interface World {
  width: number;
  height: number;
  /** Tile id per cell. 0 is empty, every other value maps to a wall texture. */
  tiles: Uint8Array;
  /** Top surface height per cell. 0 is floor; every solid cell is above it. */
  heights: Float32Array;
  spawn: { x: number; y: number };
}

/** Default full-height block for now; digit cells are lower platforms/steps. */
export const WALL_HEIGHT = 1.4;
export const STEP_UP = 0.3;
/** Tile id for legend-defined tower cells; renders with the facade texture. */
export const TOWER_TILE = 4;

const TILE_CHARS: Record<string, number> = {
  "#": 1,
  X: 2,
  D: 3,
};

export interface WorldOptions {
  /**
   * Map characters that describe solid towers at an explicit height in world
   * units. A legend lets a level author 64×64 districts with 4–12 m towers
   * without overloading the digit platform scale.
   */
  heights?: Record<string, number>;
}

/** A digit 1-9 is a solid panel platform at 0.2 × digit world units. */
function charHeight(char: string, heights?: Record<string, number>): number {
  if (heights && char in heights) return heights[char];
  if (char === ".") return 0;
  const digit = Number(char);
  if (digit >= 1 && digit <= 9) return digit * 0.2;
  return WALL_HEIGHT;
}

function charTile(char: string, heights?: Record<string, number>): number {
  if (heights && char in heights) return TOWER_TILE;
  if (char === ".") return 0;
  const digit = Number(char);
  if (digit >= 1 && digit <= 9) return 2;
  return TILE_CHARS[char] ?? 0;
}

export function createWorld(
  rows: string[],
  spawn = { x: 1.5, y: 1.5 },
  options: WorldOptions = {},
): World {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const tiles = new Uint8Array(width * height);
  const heights = new Float32Array(width * height);

  for (let y = 0; y < height; y += 1) {
    const row = rows[y];
    if (row.length !== width) {
      throw new Error(`Map row ${y} has width ${row.length}, expected ${width}`);
    }
    for (let x = 0; x < width; x += 1) {
      const char = row[x];
      const cell = y * width + x;
      tiles[cell] = charTile(char, options.heights);
      heights[cell] = charHeight(char, options.heights);
    }
  }

  return { width, height, tiles, heights, spawn };
}

export function isSolidAt(world: World, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return true;
  return world.tiles[Math.floor(y) * world.width + Math.floor(x)] !== 0;
}

/** Top surface height of a cell. Out-of-bounds is treated as wall height. */
export function tileHeightAt(world: World, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return WALL_HEIGHT;
  return world.heights[Math.floor(y) * world.width + Math.floor(x)];
}

/**
 * Surface height directly under the player's centre. Sampling the footprint would
 * lift the player onto a wall merely by standing next to it; M5 sectors can extend
 * this to step-ups once per-cell heights exist.
 */
export function supportHeight(world: World, x: number, y: number): number {
  return tileHeightAt(world, x, y);
}

export function tileAt(world: World, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return 1;
  return world.tiles[Math.floor(y) * world.width + Math.floor(x)];
}

export interface Footprint {
  x: number;
  y: number;
}

/**
 * Pushes a circular footprint out of every solid cell taller than `z + maxStep`.
 * A landing can leave the capsule overlapping a wall even though the centre cell
 * is valid; without this, every candidate position is rejected and the player
 * wedges in place. Out-of-bounds cells are treated as full walls so the map edge
 * also pushes inward.
 */
export function resolveFootprint(
  world: World,
  x: number,
  y: number,
  radius: number,
  z = 0,
  maxStep = 0.02,
): Footprint {
  let px = x;
  let py = y;

  for (let iteration = 0; iteration < 4; iteration += 1) {
    let pushed = false;
    const minX = Math.floor(px - radius);
    const maxX = Math.floor(px + radius);
    const minY = Math.floor(py - radius);
    const maxY = Math.floor(py + radius);

    for (let cellY = minY; cellY <= maxY; cellY += 1) {
      for (let cellX = minX; cellX <= maxX; cellX += 1) {
        const height = tileHeightAt(world, cellX + 0.5, cellY + 0.5);
        if (height <= z + maxStep) continue;

        const nearestX = Math.max(cellX, Math.min(px, cellX + 1));
        const nearestY = Math.max(cellY, Math.min(py, cellY + 1));
        const dx = px - nearestX;
        const dy = py - nearestY;
        const distanceSq = dx * dx + dy * dy;
        if (distanceSq >= radius * radius - 1e-9) continue;

        if (distanceSq > 1e-12) {
          const distance = Math.sqrt(distanceSq);
          const push = radius - distance + 1e-4;
          px += (dx / distance) * push;
          py += (dy / distance) * push;
        } else {
          // The centre is inside the cell; leave through the closest face.
          const toLeft = px - cellX;
          const toRight = cellX + 1 - px;
          const toTop = py - cellY;
          const toBottom = cellY + 1 - py;
          const nearest = Math.min(toLeft, toRight, toTop, toBottom);
          const gap = radius + 1e-4;
          if (nearest === toLeft) px = cellX - gap;
          else if (nearest === toRight) px = cellX + 1 + gap;
          else if (nearest === toTop) py = cellY - gap;
          else py = cellY + 1 + gap;
        }
        pushed = true;
      }
    }
    // Out-of-bounds cells push away from the map; keep the capsule inside it.
    const edgeMinX = radius + 1e-4;
    const edgeMaxX = Math.max(edgeMinX, world.width - radius - 1e-4);
    const edgeMinY = radius + 1e-4;
    const edgeMaxY = Math.max(edgeMinY, world.height - radius - 1e-4);
    const clampedX = px < edgeMinX ? edgeMinX : px > edgeMaxX ? edgeMaxX : px;
    const clampedY = py < edgeMinY ? edgeMinY : py > edgeMaxY ? edgeMaxY : py;
    if (clampedX !== px || clampedY !== py) pushed = true;
    px = clampedX;
    py = clampedY;

    if (!pushed) break;
  }

  return { x: px, y: py };
}

/**
 * A footprint is blocked by a solid tile only when its top is more than
 * `maxStep` above the feet. Once above a wall, the same cells become walkable
 * surfaces. Actors pass the default tiny step so they stay on the ground.
 */
export function canOccupy(
  world: World,
  x: number,
  y: number,
  radius: number,
  z = 0,
  maxStep = 0.02,
): boolean {
  for (let oy = -1; oy <= 1; oy += 1) {
    for (let ox = -1; ox <= 1; ox += 1) {
      const sampleX = x + ox * radius;
      const sampleY = y + oy * radius;
      // The map edge blocks at every altitude; only in-bounds walls become walkable.
      if (
        sampleX < 0 ||
        sampleY < 0 ||
        sampleX >= world.width ||
        sampleY >= world.height
      ) {
        return false;
      }
      if (tileHeightAt(world, sampleX, sampleY) > z + maxStep) {
        return false;
      }
    }
  }
  return true;
}
