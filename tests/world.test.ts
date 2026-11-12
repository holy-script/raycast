import { describe, expect, it } from "vitest";
import {
  canOccupy,
  ceilingAt,
  createWorld,
  hazardAt,
  hazardPhaseAt,
  isSolidAt,
  resolveFootprint,
  roofAt,
  STEP_UP,
  supportHeight,
  tileAt,
  tileHeightAt,
  TOWER_TILE,
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

  it("separates a footprint that overlaps a wall", () => {
    const resolved = resolveFootprint(world, 1.9, 2.5, 0.2, 0);
    expect(resolved.x).toBeLessThan(1.81);
    expect(resolved.y).toBeCloseTo(2.5, 5);
    expect(canOccupy(world, resolved.x, resolved.y, 0.2)).toBe(true);
  });

  it("separates a footprint whose centre is inside a wall", () => {
    const resolved = resolveFootprint(world, 2.5, 2.5, 0.2, 0);
    expect(canOccupy(world, resolved.x, resolved.y, 0.2)).toBe(true);
  });

  it("does not push a player standing on the wall top", () => {
    const resolved = resolveFootprint(world, 1.9, 2.5, 0.2, WALL_HEIGHT);
    expect(resolved.x).toBeCloseTo(1.9, 5);
    expect(resolved.y).toBeCloseTo(2.5, 5);
  });

  it("pushes the player inward at the map edge", () => {
    const resolved = resolveFootprint(world, 0.05, 2.5, 0.2, 0);
    expect(resolved.x).toBeGreaterThanOrEqual(0.2);
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

describe("tower legend", () => {
  const world = createWorld(
    [
      "######",
      "#.a..#",
      "#.b..#",
      "######",
    ],
    { x: 1.5, y: 1.5 },
    { heights: { a: 4, b: 12 } },
  );

  it("uses legend heights instead of the default wall height", () => {
    expect(tileHeightAt(world, 2.5, 1.5)).toBe(4);
    expect(tileHeightAt(world, 2.5, 2.5)).toBe(12);
  });

  it("maps legend cells to the facade tile", () => {
    expect(tileAt(world, 2.5, 1.5)).toBe(TOWER_TILE);
    expect(tileAt(world, 0.5, 0.5)).toBe(1);
  });

  it("keeps towers solid from the street and walkable from the roof", () => {
    expect(canOccupy(world, 2.5, 1.5, 0.2, 0)).toBe(false);
    expect(canOccupy(world, 2.5, 1.5, 0.2, 4)).toBe(true);
    expect(canOccupy(world, 2.5, 1.5, 0.2, 3.9)).toBe(false);
    expect(supportHeight(world, 2.5, 2.5)).toBe(12);
  });
});

describe("interior sectors", () => {
  const MAP = [
    "########",
    "#.aaaa.#",
    "#.a.a..#",
    "#.a....#",
    "#.aaaa.#",
    "#......#",
    "########",
  ];
  const ROOM = {
    id: "office",
    x: 3,
    y: 2,
    width: 3,
    height: 3,
    ceilingZ: 3,
    roofZ: 8,
  };
  const world = createWorld(MAP, { x: 1.5, y: 1.5 }, {
    heights: { a: 8 },
    rooms: [ROOM],
  });

  it("stamps a ceiling and a roof over the whole rectangle", () => {
    expect(ceilingAt(world, 4.5, 3.5)).toBe(3);
    expect(roofAt(world, 4.5, 3.5)).toBe(8);
    // The solid cell inside the rectangle keeps its tower mass but still gets a
    // roof, so the tower reads as one block from above.
    expect(tileAt(world, 4.5, 2.5)).toBe(TOWER_TILE);
    expect(tileHeightAt(world, 4.5, 2.5)).toBe(8);
    expect(roofAt(world, 4.5, 2.5)).toBe(8);
  });

  it("leaves every cell outside the rectangle open to the sky", () => {
    expect(ceilingAt(world, 1.5, 1.5)).toBe(0);
    expect(roofAt(world, 1.5, 1.5)).toBe(0);
    expect(ceilingAt(world, 6.5, 3.5)).toBe(0);
    expect(ceilingAt(world, -1, 1)).toBe(0);
    expect(roofAt(world, 99, 1)).toBe(0);
  });

  it("is floor from inside and roof from above", () => {
    expect(supportHeight(world, 4.5, 3.5, 0)).toBe(0);
    expect(supportHeight(world, 4.5, 3.5, 8)).toBe(8);
    expect(supportHeight(world, 4.5, 3.5, 12)).toBe(8);
    // The solid cell inside the sector stays a block below the roof.
    expect(supportHeight(world, 4.5, 2.5, 0)).toBe(8);
    expect(supportHeight(world, 4.5, 2.5, 8)).toBe(8);
  });

  it("walks the interior floor and the roof at their own altitude", () => {
    expect(canOccupy(world, 4.5, 3.5, 0.19, 0)).toBe(true);
    expect(canOccupy(world, 4.5, 3.5, 0.19, 8)).toBe(true);
    // The tower cell inside the sector still blocks ground movement.
    expect(canOccupy(world, 4.5, 2.5, 0.19, 0)).toBe(false);
    expect(resolveFootprint(world, 4.5, 3.5, 0.19, 0)).toEqual({
      x: 4.5,
      y: 3.5,
    });
  });

  it("rejects malformed sectors", () => {
    expect(() =>
      createWorld(MAP, undefined, {
        rooms: [{ ...ROOM, ceilingZ: 8, roofZ: 3 }],
      }),
    ).toThrow(/ceilingZ/);
    expect(() =>
      createWorld(MAP, undefined, {
        rooms: [{ ...ROOM, x: 6, width: 4 }],
      }),
    ).toThrow(/bounds/);
    expect(() =>
      createWorld(MAP, undefined, {
        rooms: [ROOM, { ...ROOM, id: "clash" }],
      }),
    ).toThrow(/overlaps/);
  });

  it("keeps levels without sectors at zero ceiling and roof", () => {
    const plain = createWorld(MAP, undefined, { heights: { a: 8 } });
    expect(plain.ceilings.every((value) => value === 0)).toBe(true);
    expect(plain.roofs.every((value) => value === 0)).toBe(true);
    expect(plain.rooms).toEqual([]);
  });
});

describe("hazard cells", () => {
  const MAP = [
    "########",
    "#......#",
    "#..a...#",
    "#......#",
    "########",
  ];

  it("stamps walkable cells inside each area", () => {
    const world = createWorld(MAP, undefined, {
      heights: { a: 8 },
      hazards: [{ id: "channel", x: 1, y: 2, width: 2, height: 1 }],
    });
    expect(hazardAt(world, 1.5, 2.5)).toBe(true);
    expect(hazardAt(world, 2.5, 2.5)).toBe(true);
    expect(hazardAt(world, 3.5, 2.5)).toBe(false);
    expect(hazardAt(world, 1.5, 1.5)).toBe(false);
    expect(hazardAt(world, -1, 2)).toBe(false);
    expect(hazardAt(world, 99, 2)).toBe(false);
  });

  it("keeps levels without hazards at an empty grid", () => {
    const plain = createWorld(MAP, undefined, { heights: { a: 8 } });
    expect(plain.hazards.every((value) => value === 0)).toBe(true);
    expect(plain.hazardPhases.every((value) => value === 0)).toBe(true);
  });

  it("stamps each area's clock offset onto its cells", () => {
    const world = createWorld(MAP, undefined, {
      heights: { a: 8 },
      hazards: [
        { id: "staggered", x: 1, y: 1, width: 2, height: 1, phase: 2 },
        { id: "default", x: 4, y: 3, width: 2, height: 1 },
      ],
    });
    expect(hazardPhaseAt(world, 1.5, 1.5)).toBe(2);
    expect(hazardPhaseAt(world, 2.5, 1.5)).toBe(2);
    expect(hazardPhaseAt(world, 4.5, 3.5)).toBe(0);
    expect(hazardPhaseAt(world, 20, 20)).toBe(0);
  });

  it("rejects areas that leave the map or cover solid cells", () => {
    expect(() =>
      createWorld(MAP, undefined, {
        heights: { a: 8 },
        hazards: [{ x: 7, y: 1, width: 2, height: 1 }],
      }),
    ).toThrow(/bounds/);
    expect(() =>
      createWorld(MAP, undefined, {
        heights: { a: 8 },
        hazards: [{ x: 3, y: 2, width: 1, height: 1 }],
      }),
    ).toThrow(/solid cell/);
    expect(() =>
      createWorld(MAP, undefined, {
        heights: { a: 8 },
        hazards: [{ x: 1, y: 1, width: 1, height: 1, phase: Number.NaN }],
      }),
    ).toThrow(/finite phase/);
  });
});
