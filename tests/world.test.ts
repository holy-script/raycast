import { describe, expect, it } from "vitest";
import {
  canOccupy,
  createWorld,
  isSolidAt,
  STEP_UP,
  supportHeight,
  tileAt,
  tileHeightAt,
  WALL_HEIGHT,
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

  it("treats wall tops as surfaces above the block", () => {
    expect(tileHeightAt(world, 1.5, 1.5)).toBe(0);
    expect(tileHeightAt(world, 2.5, 2.5)).toBeCloseTo(WALL_HEIGHT);
    expect(tileHeightAt(world, -1, 2)).toBe(WALL_HEIGHT);
    expect(supportHeight(world, 1.5, 1.5)).toBe(0);
    expect(supportHeight(world, 2.5, 2.5)).toBeCloseTo(WALL_HEIGHT);
  });

  it("does not lift a player standing next to a wall", () => {
    expect(supportHeight(world, 1.7, 2.5)).toBe(0);
    expect(supportHeight(world, 1.8, 2.5)).toBe(0);
  });

  it("only lets the player occupy a wall cell from above it", () => {
    expect(canOccupy(world, 2.5, 2.5, 0.2, 0)).toBe(false);
    expect(canOccupy(world, 2.5, 2.5, 0.2, 0.8)).toBe(false);
    expect(canOccupy(world, 2.5, 2.5, 0.2, 1.3)).toBe(false);
    expect(canOccupy(world, 2.5, 2.5, 0.2, WALL_HEIGHT)).toBe(true);
    expect(canOccupy(world, 2.5, 2.5, 0.2, 2.2)).toBe(true);
  });

  it("keeps the map edge blocked at any altitude", () => {
    expect(canOccupy(world, 0.05, 2.5, 0.2, 10)).toBe(false);
    expect(canOccupy(world, 4.95, 2.5, 0.2, 10)).toBe(false);
    expect(canOccupy(world, 2.5, 0.05, 0.2, 10)).toBe(false);
  });

  it("rejects maps with inconsistent row widths", () => {
    expect(() => createWorld(["####", "###"])).toThrow(/width/);
  });
});

describe("sector heights", () => {
  const world = createWorld([
    "######",
    "#.12.#",
    "#.3..#",
    "######",
  ]);

  it("parses digit cells as solid 0.2-unit steps", () => {
    expect(tileAt(world, 2.5, 1.5)).toBe(2);
    expect(tileHeightAt(world, 2.5, 1.5)).toBeCloseTo(0.2);
    expect(tileHeightAt(world, 3.5, 1.5)).toBeCloseTo(0.4);
    expect(tileHeightAt(world, 2.5, 2.5)).toBeCloseTo(0.6);
  });

  it("only steps up when the rise is within the limit", () => {
    expect(canOccupy(world, 2.5, 1.5, 0.19, 0)).toBe(false);
    expect(canOccupy(world, 2.5, 1.5, 0.19, 0, STEP_UP)).toBe(true);
    expect(canOccupy(world, 2.5, 2.5, 0.19, 0, STEP_UP)).toBe(false);
    expect(canOccupy(world, 2.5, 2.5, 0.19, 0.4, STEP_UP)).toBe(true);
  });

  it("supports the player at the cell height", () => {
    expect(supportHeight(world, 2.5, 1.5)).toBeCloseTo(0.2);
    expect(supportHeight(world, 2.5, 2.5)).toBeCloseTo(0.6);
    expect(supportHeight(world, 1.5, 1.5)).toBe(0);
  });
});
