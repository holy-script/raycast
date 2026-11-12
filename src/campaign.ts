/**
 * Persistent campaign record: which levels the player has reached, their best
 * clear time and kill count, and lifetime deaths per level. The record is
 * versioned so a future shape can migrate instead of silently discarding a
 * player's progress.
 */
export interface LevelRecord {
  cleared: boolean;
  /** Fastest completed run in seconds; null until the level is cleared. */
  bestTime: number | null;
  /** Most hostiles killed in a completed run. */
  bestKills: number;
  deaths: number;
}

export interface CampaignRecord {
  version: 1;
  reached: string[];
  levels: Record<string, LevelRecord>;
  lastLevel: string;
}

export interface MissionClear {
  levelId: string;
  time: number;
  kills: number;
  deaths: number;
}

export interface ClearOutcome {
  record: CampaignRecord;
  improved: boolean;
  level: LevelRecord;
}

export const CAMPAIGN_KEY = "raycast.campaign.v1";

/** Level ids the record understands; unknown ids are ignored on load. */
export const CAMPAIGN_LEVELS = ["courtyard", "reactor", "district", "foundry"] as const;

export const DEFAULT_LEVEL_RECORD: LevelRecord = {
  cleared: false,
  bestTime: null,
  bestKills: 0,
  deaths: 0,
};

export function defaultCampaign(): CampaignRecord {
  return {
    version: 1,
    reached: ["courtyard"],
    levels: Object.fromEntries(
      CAMPAIGN_LEVELS.map((id) => [id, { ...DEFAULT_LEVEL_RECORD }]),
    ),
    lastLevel: "courtyard",
  };
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sanitizeLevel(raw: unknown): LevelRecord {
  const source = (raw ?? {}) as Partial<LevelRecord>;
  const bestTime = finiteNumber(source.bestTime);
  return {
    cleared: source.cleared === true,
    bestTime: bestTime !== null && bestTime > 0 ? bestTime : null,
    bestKills: Math.max(0, Math.floor(finiteNumber(source.bestKills) ?? 0)),
    deaths: Math.max(0, Math.floor(finiteNumber(source.deaths) ?? 0)),
  };
}

/** Validates arbitrary parsed JSON into a usable record without throwing. */
export function sanitizeCampaign(raw: unknown): CampaignRecord {
  const fallback = defaultCampaign();
  const source = (raw ?? {}) as Partial<CampaignRecord>;
  if (source.version !== 1) return fallback;

  const levels = Object.fromEntries(
    CAMPAIGN_LEVELS.map((id) => [id, sanitizeLevel(source.levels?.[id])]),
  ) as Record<string, LevelRecord>;

  const reached = Array.isArray(source.reached)
    ? source.reached.filter(
        (id): id is string =>
          typeof id === "string" && (CAMPAIGN_LEVELS as readonly string[]).includes(id),
      )
    : [];
  if (!reached.includes("courtyard")) reached.unshift("courtyard");

  return {
    version: 1,
    reached,
    levels,
    lastLevel: reached.includes(source.lastLevel ?? "")
      ? (source.lastLevel as string)
      : "courtyard",
  };
}

export function loadCampaign(): CampaignRecord {
  try {
    const raw = localStorage.getItem(CAMPAIGN_KEY);
    if (!raw) return defaultCampaign();
    return sanitizeCampaign(JSON.parse(raw));
  } catch {
    return defaultCampaign();
  }
}

export function saveCampaign(record: CampaignRecord): void {
  try {
    localStorage.setItem(CAMPAIGN_KEY, JSON.stringify(record));
  } catch {
    // Private browsing or blocked storage: progress stays in memory this session.
  }
}

export function markReached(record: CampaignRecord, levelId: string): CampaignRecord {
  if (!(CAMPAIGN_LEVELS as readonly string[]).includes(levelId)) return record;
  return {
    ...record,
    reached: record.reached.includes(levelId)
      ? record.reached
      : [...record.reached, levelId],
    lastLevel: levelId,
  };
}

export function isLevelUnlocked(record: CampaignRecord, levelId: string): boolean {
  return levelId === "courtyard" || record.reached.includes(levelId);
}

/**
 * Folds a completed run into the record. A run only counts once the player
 * leaves the level through an exit or the victory overlay; the best time is the
 * minimum and the best kill count the maximum, while deaths accumulate.
 */
export function recordMission(record: CampaignRecord, clear: MissionClear): ClearOutcome {
  const previous = record.levels[clear.levelId] ?? DEFAULT_LEVEL_RECORD;
  const time = Number.isFinite(clear.time) && clear.time > 0 ? clear.time : null;
  const kills = Math.max(0, Math.floor(clear.kills));
  const deaths = Math.max(0, Math.floor(clear.deaths));

  const improved =
    !previous.cleared ||
    (time !== null && (previous.bestTime === null || time < previous.bestTime)) ||
    kills > previous.bestKills;

  const level: LevelRecord = {
    cleared: true,
    bestTime:
      time === null
        ? previous.bestTime
        : previous.bestTime === null
          ? time
          : Math.min(previous.bestTime, time),
    bestKills: Math.max(previous.bestKills, kills),
    deaths: previous.deaths + deaths,
  };

  const base = markReached(record, clear.levelId);
  return {
    record: { ...base, levels: { ...base.levels, [clear.levelId]: level } },
    improved,
    level,
  };
}

/** `mm:ss` clock used by the campaign menu and the victory summary. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(
    total % 60,
  ).padStart(2, "0")}`;
}
