import { describe, expect, it } from "vitest";
import { clampSettings, DEFAULT_SETTINGS } from "../src/settings";

describe("settings", () => {
  it("keeps the defaults inside the slider ranges", () => {
    expect(DEFAULT_SETTINGS.sensitivity).toBe(1);
    expect(DEFAULT_SETTINGS.fov).toBe(70);
    expect(DEFAULT_SETTINGS.muted).toBe(false);
  });

  it("clamps sensitivity and fov to the supported ranges", () => {
    const low = clampSettings({ sensitivity: 0.1, fov: 10, muted: true });
    expect(low.sensitivity).toBe(0.4);
    expect(low.fov).toBe(55);
    expect(low.muted).toBe(true);

    const high = clampSettings({ sensitivity: 9, fov: 400, muted: false });
    expect(high.sensitivity).toBe(2);
    expect(high.fov).toBe(90);
  });
});
