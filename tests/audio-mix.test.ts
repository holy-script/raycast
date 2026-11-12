import { describe, expect, it } from "vitest";
import { computeAudioMix, type AudioMixInput } from "../src/engine/audio-mix";

function mix(overrides: Partial<AudioMixInput> = {}) {
  return computeAudioMix({
    levelId: "courtyard",
    indoor: false,
    stage: "hunt",
    kills: 0,
    targets: 6,
    bossDistance: null,
    health: 100,
    maxHealth: 100,
    dead: false,
    ...overrides,
  });
}

describe("audio mix", () => {
  it("uses the level as the bed and falls back for unknown levels", () => {
    expect(mix({ levelId: "reactor" }).bed).toBe("reactor");
    expect(mix({ levelId: "unknown" }).bed).toBe("courtyard");
  });

  it("switches to the indoor bed under a ceiling", () => {
    expect(mix({ levelId: "reactor", indoor: true }).bed).toBe("indoor");
  });

  it("pushes intensity from hunt through boss and settles on clear", () => {
    const hunt = mix({ stage: "hunt" }).intensity;
    const boss = mix({ stage: "boss" }).intensity;
    const extract = mix({ stage: "extract" }).intensity;
    const clear = mix({ stage: "clear" }).intensity;
    expect(boss).toBeGreaterThan(hunt);
    expect(hunt).toBeGreaterThan(extract);
    expect(extract).toBeGreaterThan(clear);
  });

  it("adds intensity as the hunt progresses and near the boss", () => {
    const fresh = mix({ kills: 0, targets: 6 }).intensity;
    const half = mix({ kills: 3, targets: 6 }).intensity;
    expect(half).toBeGreaterThan(fresh);
    expect(mix({ bossDistance: 8 }).intensity).toBeGreaterThan(fresh);
    expect(mix({ bossDistance: 60 }).intensity).toBe(fresh);
  });

  it("clamps intensity to one", () => {
    const hot = mix({ stage: "boss", kills: 9, targets: 6, bossDistance: 1 });
    expect(hot.intensity).toBeLessThanOrEqual(1);
    expect(hot.intensity).toBeGreaterThan(0.8);
  });

  it("damps every layer while dead", () => {
    const alive = mix({ stage: "boss" });
    const dead = mix({ stage: "boss", dead: true, health: 0 });
    expect(dead.intensity).toBeCloseTo(alive.intensity * 0.4, 6);
    expect(dead.bass).toBeLessThan(alive.bass);
    expect(dead.percussion).toBeLessThan(alive.percussion);
    expect(dead.lowHealth).toBe(false);
  });

  it("flags low health only while alive and at or below a third", () => {
    expect(mix({ health: 34 }).lowHealth).toBe(true);
    expect(mix({ health: 35 }).lowHealth).toBe(false);
    expect(mix({ health: 10, dead: true }).lowHealth).toBe(false);
  });

  it("keeps the bass above the pad at every intensity", () => {
    for (const stage of ["hunt", "boss", "extract", "clear"] as const) {
      const values = mix({ stage });
      expect(values.bass).toBeGreaterThan(values.pad);
    }
  });
});
