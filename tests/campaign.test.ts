import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_KEY,
  defaultCampaign,
  formatClock,
  isLevelUnlocked,
  loadCampaign,
  markReached,
  recordMission,
  sanitizeCampaign,
  saveCampaign,
  type CampaignRecord,
} from "../src/campaign";

function clear(overrides: Partial<Parameters<typeof recordMission>[1]> = {}) {
  return { levelId: "district", time: 120, kills: 7, deaths: 0, ...overrides };
}

describe("campaign record", () => {
  it("starts with only the courtyard unlocked", () => {
    const record = defaultCampaign();
    expect(isLevelUnlocked(record, "courtyard")).toBe(true);
    expect(isLevelUnlocked(record, "district")).toBe(false);
    expect(record.levels.district.cleared).toBe(false);
  });

  it("unlocks a level when it is reached", () => {
    const record = markReached(defaultCampaign(), "district");
    expect(isLevelUnlocked(record, "district")).toBe(true);
    expect(record.lastLevel).toBe("district");
    expect(markReached(record, "district").reached).toEqual(["courtyard", "district"]);
  });

  it("records the first clear as an improvement and keeps the best values", () => {
    const first = recordMission(defaultCampaign(), clear({ time: 140, kills: 7 }));
    expect(first.improved).toBe(true);
    expect(first.level).toEqual({ cleared: true, bestTime: 140, bestKills: 7, deaths: 0 });

    const slower = recordMission(first.record, clear({ time: 200, kills: 6 }));
    expect(slower.improved).toBe(false);
    expect(slower.level.bestTime).toBe(140);
    expect(slower.level.bestKills).toBe(7);

    const faster = recordMission(slower.record, clear({ time: 90, kills: 8 }));
    expect(faster.improved).toBe(true);
    expect(faster.level.bestTime).toBe(90);
    expect(faster.level.bestKills).toBe(8);
  });

  it("accumulates deaths across clears", () => {
    const first = recordMission(defaultCampaign(), clear({ deaths: 2 }));
    const second = recordMission(first.record, clear({ deaths: 1 }));
    expect(second.level.deaths).toBe(3);
  });

  it("ignores a zero or invalid time", () => {
    const outcome = recordMission(defaultCampaign(), clear({ time: 0 }));
    expect(outcome.level.bestTime).toBe(null);
  });

  it("sanitizes corrupt and unknown input", () => {
    const fallback = sanitizeCampaign(null);
    expect(fallback).toEqual(defaultCampaign());
    expect(sanitizeCampaign({ version: 99 }).version).toBe(1);

    const dirty = sanitizeCampaign({
      version: 1,
      reached: ["district", "moon", 42],
      lastLevel: "moon",
      levels: {
        district: { cleared: "yes", bestTime: -4, bestKills: 3.7, deaths: -2 },
      },
    });
    expect(dirty.reached).toEqual(["courtyard", "district"]);
    expect(dirty.lastLevel).toBe("courtyard");
    expect(dirty.levels.district).toEqual({
      cleared: false,
      bestTime: null,
      bestKills: 3,
      deaths: 0,
    });
    expect(dirty.levels.foundry).toEqual(defaultCampaign().levels.foundry);
  });

  it("round-trips through storage and survives malformed JSON", () => {
    const store = new Map<string, string>();
    const mock = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", { value: mock, configurable: true });
    try {
      const record: CampaignRecord = recordMission(
        defaultCampaign(),
        clear({ time: 75.5 }),
      ).record;
      saveCampaign(record);
      expect(store.has(CAMPAIGN_KEY)).toBe(true);
      expect(loadCampaign()).toEqual(record);
      store.set(CAMPAIGN_KEY, "{not json");
      expect(loadCampaign()).toEqual(defaultCampaign());
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        value: original,
        configurable: true,
      });
    }
  });

  it("formats the mission clock", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(75.9)).toBe("01:15");
    expect(formatClock(600)).toBe("10:00");
  });
});
