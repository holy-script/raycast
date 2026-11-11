import { describe, expect, it } from "vitest";
import {
  elevationAngle,
  quantizeDirection,
  quantizePitch,
  shortestAngleDelta,
  TAU,
  wrapAngle,
} from "../src/engine/math";

describe("directional quantization", () => {
  it("maps the front-facing view to frame zero", () => {
    expect(quantizeDirection(0, 8)).toBe(0);
    expect(quantizeDirection(Math.PI / 4, 8)).toBe(1);
    expect(quantizeDirection(Math.PI / 2, 8)).toBe(2);
    expect(quantizeDirection(Math.PI, 8)).toBe(4);
    expect(quantizeDirection((3 * Math.PI) / 2, 8)).toBe(6);
    expect(quantizeDirection(TAU - 0.01, 8)).toBe(0);
  });

  it("wraps negative angles into the frame ring", () => {
    expect(quantizeDirection(-Math.PI / 4, 8)).toBe(7);
    expect(quantizeDirection(-Math.PI / 2, 8)).toBe(6);
    expect(quantizeDirection(-TAU, 8)).toBe(0);
  });

  it("supports 16-way indexing", () => {
    expect(quantizeDirection(TAU / 16, 16)).toBe(1);
    expect(quantizeDirection(-TAU / 16, 16)).toBe(15);
  });
});

describe("pitch selection", () => {
  it("classifies level, high and low camera elevations", () => {
    expect(quantizePitch(0)).toBe(1);
    expect(quantizePitch(0.2)).toBe(2);
    expect(quantizePitch(-0.2)).toBe(0);
    expect(quantizePitch(0.05)).toBe(1);
  });

  it("computes elevation from eye and target heights", () => {
    const level = elevationAngle(0.5, 0.5, 2);
    const above = elevationAngle(1.5, 0.5, 2);
    const below = elevationAngle(0.2, 0.5, 2);
    expect(level).toBeCloseTo(0);
    expect(above).toBeGreaterThan(0);
    expect(below).toBeLessThan(0);
  });
});

describe("angle helpers", () => {
  it("wraps angles into [0, 2pi)", () => {
    expect(wrapAngle(-Math.PI / 2)).toBeCloseTo((3 * Math.PI) / 2);
    expect(wrapAngle(TAU + 0.5)).toBeCloseTo(0.5);
  });

  it("finds the shortest turn across the wrap boundary", () => {
    expect(shortestAngleDelta(0.1, -0.1)).toBeCloseTo(-0.2);
    expect(shortestAngleDelta((3 * Math.PI) / 2, Math.PI / 2)).toBeCloseTo(
      -Math.PI,
    );
  });
});
