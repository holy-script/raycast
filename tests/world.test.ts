import { describe, expect, it } from "vitest";
import {
  canOccupy,
  createWorld,
  isSolidAt,
  tileAt,
} from "../src/engine/world";

const MAP = [
  "#####",
  "#...#",
  "#.#.#",
  "#...#",
  "#####",
];

describe("world grid", () => {
  const world = createWorld(MAP, { x: 1.5, y: 1.5 });

  it("parses solid tile ids", () => {
    expect(tileAt(world, 0.5, 0.5)).toBe(1);
    expect(tileAt(world, 1.5, 1.5)).toBe(0);
    expect(tileAt(world, 2.5, 2.5)).toBe(1);
  });

  it("treats out-of-bounds cells as solid", () => {
    expect(isSolidAt(world, -1, 2)).toBe(true);
    expect(isSolidAt(world, 2, 9)).toBe(true);
  });

  it("blocks movement into walls and allows open floor", () => {
    expect(canOccupy(world, 1.5, 1.5, 0.2)).toBe(true);
    expect(canOccupy(world, 1.5, 2.5, 0.2)).toBe(true);
    expect(canOccupy(world, 1.9, 2.5, 0.2)).toBe(false);
    expect(canOccupy(world, 2.5, 2.5, 0.2)).toBe(false);
  });

  it("rejects maps with inconsistent row widths", () => {
    expect(() => createWorld(["####", "###"])).toThrow(/width/);
  });
});
