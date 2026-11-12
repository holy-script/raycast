import type { World } from "./world";

/** Map character for a concrete crate cell. */
export const CRATE_CHAR = "X";
/** Crate blocks are full wall height. */
export const CRATE_HEIGHT = 1.4;
/** Player bolts needed to destroy a crate. */
export const CRATE_HITS = 2;

/** Collects the cell indices of every concrete crate in a level's rows. */
export function crateCells(rows: readonly string[]): Set<number> {
  const cells = new Set<number>();
  for (let y = 0; y < rows.length; y += 1) {
    const row = rows[y];
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] === CRATE_CHAR) cells.add(y * row.length + x);
    }
  }
  return cells;
}

export interface CrateDamage {
  hits: number;
  destroyed: boolean;
}

/**
 * Accumulates bolt hits and reports when the crate breaks. Kept pure so the
 * two-hit threshold is unit-tested without a renderer or a game loop.
 */
export function applyCrateDamage(hits: number, amount = 1): CrateDamage {
  const total = Math.max(0, hits) + Math.max(0, Math.trunc(amount));
  return { hits: total, destroyed: total >= CRATE_HITS };
}

/** Clears a destroyed crate so the cell becomes walkable and invisible. */
export function clearCrate(world: World, cell: number): void {
  world.tiles[cell] = 0;
  world.heights[cell] = 0;
}
