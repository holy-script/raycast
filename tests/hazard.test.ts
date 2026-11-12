import { describe, expect, it } from "vitest";
import {
  HAZARD_CYCLE,
  HAZARD_DPS,
  HAZARD_HOT_SECONDS,
  hazardHotAt,
} from "../src/engine/hazard";

describe("hazard cycle", () => {
  it("burns for the first half of each cycle", () => {
    expect(HAZARD_CYCLE).toBe(4);
    expect(HAZARD_HOT_SECONDS).toBe(2);
    expect(hazardHotAt(0)).toBe(true);
    expect(hazardHotAt(1.99)).toBe(true);
    expect(hazardHotAt(2)).toBe(false);
    expect(hazardHotAt(3.99)).toBe(false);
    expect(hazardHotAt(4)).toBe(true);
    expect(hazardHotAt(5.5)).toBe(true);
    expect(hazardHotAt(6.2)).toBe(false);
  });

  it("wraps negative time instead of inverting the phase", () => {
    expect(hazardHotAt(-1)).toBe(false);
    expect(hazardHotAt(-2)).toBe(false);
    expect(hazardHotAt(-3)).toBe(true);
    expect(hazardHotAt(-4.5)).toBe(false);
  });

  it("shifts a channel by its own clock offset", () => {
    // A half-cycle offset is cold exactly when the default channel burns.
    expect(hazardHotAt(0, 2)).toBe(false);
    expect(hazardHotAt(2, 2)).toBe(true);
    expect(hazardHotAt(3.9, 2)).toBe(true);
    expect(hazardHotAt(1.5, 2)).toBe(false);
    // Quarter offsets land inside the hot window at load.
    expect(hazardHotAt(1.5, 3)).toBe(true);
    // Negative offsets wrap onto the same cycle.
    expect(hazardHotAt(0, -2)).toBe(false);
    expect(hazardHotAt(0, -6)).toBe(false);
  });

  it("deals a sustained twelve damage per second while hot", () => {
    expect(HAZARD_DPS).toBe(12);
  });
});
