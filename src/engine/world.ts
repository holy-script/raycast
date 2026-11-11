export interface World {
  width: number;
  height: number;
  /** Tile id per cell. 0 is empty, every other value maps to a wall texture. */
  tiles: Uint8Array;
  spawn: { x: number; y: number };
}

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

export function tileAt(world: World, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return 1;
  return world.tiles[Math.floor(y) * world.width + Math.floor(x)];
}

export function canOccupy(world: World, x: number, y: number, radius: number): boolean {
  for (let oy = -1; oy <= 1; oy += 1) {
    for (let ox = -1; ox <= 1; ox += 1) {
      if (isSolidAt(world, x + ox * radius, y + oy * radius)) return false;
    }
  }
  return true;
}
