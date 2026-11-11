import { describe, expect, it } from "vitest";
import { castRay, castRayHits } from "../src/engine/dda";
import { createWorld } from "../src/engine/world";

const MAP = [
  "######",
  "#....#",
  "#..X.#",
  "#....#",
  "######",
];

describe("DDA raycasting", () => {
  const world = createWorld(MAP);

  it("hits the nearest wall to the east with a perpendicular distance", () => {
    const hit = castRay(world, 2.5, 2.5, 1, 0);
    expect(hit).not.toBeNull();
    expect(hit!.distance).toBeCloseTo(0.5);
    expect(hit!.side).toBe(0);
    expect(hit!.tile).toBe(2);
    expect(hit!.wallU).toBeCloseTo(0.5);
    expect(hit!.mapX).toBe(3);
  });

  it("keeps the wall distance constant for off-centre columns", () => {
    const open = createWorld([
      "######",
      "#....#",
      "#....#",
      "#....#",
      "#....#",
      "######",
    ]);
    const center = castRay(open, 2.5, 2.5, 1, 0);
    const offCentre = castRay(open, 2.5, 1.5, 1, 0);
    expect(center!.distance).toBeCloseTo(2.5);
    expect(offCentre!.distance).toBeCloseTo(2.5);
  });

  it("returns the west outer wall from the map centre", () => {
    const hit = castRay(world, 2.5, 2.5, -1, 0);
    expect(hit).not.toBeNull();
    expect(hit!.distance).toBeCloseTo(1.5);
    expect(hit!.mapX).toBe(0);
    expect(hit!.wallU).toBeCloseTo(0.5);
  });

  it("respects the max distance", () => {
    expect(castRay(world, 2.5, 2.5, 1, 0, 0.25)).toBeNull();
  });

  it("returns null when a ray escapes an open map", () => {
    const open = createWorld([".....", ".....", "....."]);
    expect(castRay(open, 1.5, 1.5, 0, -1)).toBeNull();
  });

  it("collects every hit at its own height and exit distance", () => {
    const steps = createWorld([
      "######",
      "#.12.#",
      "#.3..#",
      "######",
    ]);
    const hits = castRayHits(steps, 1.5, 1.5, 1, 0);
    expect(hits).toHaveLength(3);
    expect(hits[0].height).toBeCloseTo(0.2);
    expect(hits[1].height).toBeCloseTo(0.4);
    expect(hits[2].height).toBeCloseTo(1.4);
    expect(hits.map((hit) => hit.distance)).toEqual([0.5, 1.5, 3.5]);
    expect(hits[0].exitDistance).toBeCloseTo(1.5);
    expect(hits[1].exitDistance).toBeCloseTo(2.5);
  });

  it("includes the solid cell under the camera at distance zero", () => {
    const crate = createWorld(["######", "#.2..#", "#....#", "######"]);
    const hits = castRayHits(crate, 2.5, 1.5, 1, 0);
    expect(hits).toHaveLength(2);
    expect(hits[0].distance).toBe(0);
    expect(hits[0].mapX).toBe(2);
    expect(hits[0].height).toBeCloseTo(0.4);
    expect(hits[0].exitDistance).toBeCloseTo(0.5);
    expect(hits[1].mapX).toBe(5);
  });
});
