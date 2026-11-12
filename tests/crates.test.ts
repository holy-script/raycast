import { describe, expect, it } from "vitest";
import {
  applyCrateDamage,
  clearCrate,
  CRATE_CHAR,
  CRATE_HITS,
  crateCells,
} from "../src/engine/crates";
import { createWorld } from "../src/engine/world";

describe("destructible crates", () => {
  it("breaks after exactly two hits", () => {
    expect(CRATE_HITS).toBe(2);
    const first = applyCrateDamage(0);
    expect(first).toEqual({ hits: 1, destroyed: false });
    const second = applyCrateDamage(first.hits);
    expect(second).toEqual({ hits: 2, destroyed: true });
  });

  it("ignores extra damage on an already broken crate", () => {
    expect(applyCrateDamage(2).destroyed).toBe(true);
    expect(applyCrateDamage(3).destroyed).toBe(true);
  });

  it("finds only X cells and clears them to walkable floor", () => {
    const rows = ["###", `#${CRATE_CHAR}#`, "###"];
    const cells = crateCells(rows);
    expect([...cells]).toEqual([4]);

    const world = createWorld(rows);
    expect(world.tiles[4]).not.toBe(0);
    expect(world.heights[4]).toBeCloseTo(1.4);
    clearCrate(world, 4);
    expect(world.tiles[4]).toBe(0);
    expect(world.heights[4]).toBe(0);
  });

  it("does not treat rooftop cover digits as crates", () => {
    expect(crateCells(["333", "3X3", "333"])).toEqual(new Set([4]));
  });
});
