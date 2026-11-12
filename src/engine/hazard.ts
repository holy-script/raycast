/** Seconds per full slag cycle: two hot, two safe. */
export const HAZARD_CYCLE = 4;
export const HAZARD_HOT_SECONDS = 2;
/** Damage per second while standing on a hot channel. */
export const HAZARD_DPS = 12;

/**
 * Pure phase test so the cycle can be asserted without the simulation. `phase`
 * shifts a channel onto its own clock, which is what lets neighbouring channels
 * alternate. Negative times and phases wrap, keeping replays well defined.
 */
export function hazardHotAt(time: number, phase = 0): boolean {
  const offset = ((time + phase) % HAZARD_CYCLE + HAZARD_CYCLE) % HAZARD_CYCLE;
  return offset < HAZARD_HOT_SECONDS;
}
