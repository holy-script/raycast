/** Seconds per full slag cycle: two hot, two safe. */
export const HAZARD_CYCLE = 4;
export const HAZARD_HOT_SECONDS = 2;
/** Damage per second while standing on a hot channel. */
export const HAZARD_DPS = 12;

/**
 * Pure phase test so the cycle can be asserted without the simulation. Negative
 * times wrap, keeping replays and rewinds well defined.
 */
export function hazardHotAt(time: number): boolean {
  const phase = ((time % HAZARD_CYCLE) + HAZARD_CYCLE) % HAZARD_CYCLE;
  return phase < HAZARD_HOT_SECONDS;
}
