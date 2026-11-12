import type { MissionStage } from "../game";

export interface AudioMixInput {
  levelId: string;
  indoor: boolean;
  stage: MissionStage | null;
  kills: number;
  targets: number;
  /** Distance to the level boss when its HP row is visible; null otherwise. */
  bossDistance: number | null;
  health: number;
  maxHealth: number;
  dead: boolean;
}

export interface AudioMix {
  /** Continuous ambience bed: a level id, or `indoor` under a ceiling. */
  bed: string;
  /** 0–1 music intensity derived from mission stage, progress, and boss range. */
  intensity: number;
  bass: number;
  pad: number;
  percussion: number;
  lowHealth: boolean;
}

const BEDS = new Set(["courtyard", "reactor", "district", "foundry"]);

const STAGE_LEVEL: Record<MissionStage, number> = {
  hunt: 0.45,
  boss: 0.68,
  extract: 0.3,
  clear: 0.2,
};

/**
 * Pure mix decision so the headless suites can assert the audio director
 * without listening. The music follows the mission: hunt/collect build a
 * pulse, the boss pushes it highest, and extraction settles back down.
 */
export function computeAudioMix(input: AudioMixInput): AudioMix {
  const bed = input.indoor ? "indoor" : BEDS.has(input.levelId) ? input.levelId : "courtyard";
  const stageLevel = input.stage ? STAGE_LEVEL[input.stage] : 0.12;
  const progress =
    input.targets > 0 ? Math.min(1, Math.max(0, input.kills / input.targets)) : 0;
  const bossNear =
    input.bossDistance !== null && input.bossDistance <= 24 ? 0.18 : 0;
  let intensity = Math.min(1, stageLevel + progress * 0.2 + bossNear);
  if (input.dead) intensity *= 0.4;

  return {
    bed,
    intensity,
    bass: 0.18 + intensity * 0.3,
    pad: 0.12 + intensity * 0.28,
    percussion: 0.05 + intensity * 0.4,
    lowHealth:
      !input.dead && input.maxHealth > 0 && input.health / input.maxHealth <= 0.34,
  };
}
