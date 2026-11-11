export interface World {
  width: number;
  height: number;
  /** Tile id per cell. 0 is empty, every other value maps to a wall texture. */
  tiles: Uint8Array;
  spawn: { x: number; y: number };
}

/** Every solid tile is a full-height block for now (M5 will add sectors). */
export const WALL_HEIGHT = 1.4;

const TILE_CHARS: Record<string, number> = {
  "#": 1,
  X: 2,
};

export function createWorld(
  rows: string[],
  spawn = { x: 1.5, y: 1.5 },
): World {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const tiles = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    const row = rows[y];
    if (row.length !== width) {
      throw new Error(`Map row ${y} has width ${row.length}, expected ${width}`);
    }
    for (let x = 0; x < width; x += 1) {
      const char = row[x];
      tiles[y * width + x] = char === "." ? 0 : (TILE_CHARS[char] ?? 0);
    }
  }

  return { width, height, tiles, spawn };
}

export function isSolidAt(world: World, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return true;
  return world.tiles[Math.floor(y) * world.width + Math.floor(x)] !== 0;
}

/** Top surface height of a cell. Out-of-bounds is treated as wall height. */
export function tileHeightAt(world: World, x: number, y: number): number {
  return isSolidAt(world, x, y) ? WALL_HEIGHT : 0;
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

/**
 * A footprint is blocked by a solid tile only when the feet are below its top.
 * Once above a wall, the same cells become walkable surfaces.
 */
export function canOccupy(
  world: World,
  x: number,
  y: number,
  radius: number,
  z = 0,
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
      if (tileHeightAt(world, sampleX, sampleY) > z + 0.02) {
        return false;
      }
    }
  }
  return true;
}
