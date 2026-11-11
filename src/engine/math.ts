export const TAU = Math.PI * 2;

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function wrapAngle(angle: number): number {
  const wrapped = angle % TAU;
  return wrapped < 0 ? wrapped + TAU : wrapped;
}

/**
 * Maps a relative viewing angle to a quantized directional frame index.
 * Frame 0 is directly in front of the entity, increasing counter-clockwise.
 */
export function quantizeDirection(relativeAngle: number, directions: number): number {
  const step = TAU / directions;
  return ((Math.round(relativeAngle / step) % directions) + directions) % directions;
}

export type PitchIndex = 0 | 1 | 2;

/**
 * 0 = camera below the entity (low angle), 1 = level, 2 = camera above (high angle).
 */
export function quantizePitch(elevation: number, threshold = 0.1): PitchIndex {
  if (elevation > threshold) return 2;
  if (elevation < -threshold) return 0;
  return 1;
}

export function elevationAngle(
  cameraZ: number,
  targetCenterZ: number,
  horizontalDistance: number,
): number {
  return Math.atan2(cameraZ - targetCenterZ, Math.max(horizontalDistance, 0.0001));
}

export function fract(value: number): number {
  return value - Math.floor(value);
}

export function shortestAngleDelta(from: number, to: number): number {
  return wrapAngle(to - from + Math.PI) - Math.PI;
}
