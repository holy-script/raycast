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
 * Projects a world-space heading onto a minimap drawn with y-up
 * (`screenY = mapHeight - worldY`). World yaw grows from +x toward +y, so the
 * screen y component is negated; using `sin` directly mirrors the arrow
 * vertically while positions stay correct.
 */
export function minimapHeading(angle: number): { x: number; y: number } {
  return { x: Math.cos(angle), y: -Math.sin(angle) };
}

/**
 * Maps a relative viewing angle to a quantized directional frame index.
 * Frame 0 is directly in front of the entity, increasing counter-clockwise.
 */
export function quantizeDirection(relativeAngle: number, directions: number): number {
  const step = TAU / directions;
  return ((Math.round(relativeAngle / step) % directions) + directions) % directions;
}

/**
 * Selects an atlas yaw frame for a camera at `angleToCamera` viewing an actor
 * facing `facing`. Atlas yaw frames orbit opposite the world angle because the
 * map is y-down, so the camera-to-actor angle is negated before quantization.
 */
export function spriteYawIndex(
  angleToCamera: number,
  facing: number,
  directions: number,
): number {
  return quantizeDirection(facing - angleToCamera, directions);
}

export type PitchIndex = 0 | 1 | 2 | 3;

export interface PitchSample {
  index: PitchIndex;
  next: PitchIndex;
  /** 0 = fully `index`, 1 = fully `next`. */
  mix: number;
}

const PITCH_BOUNDARIES = [-0.155, 0.245, 0.87];
const PITCH_FADE = 0.12;

/**
 * 0 = camera below the entity (low), 1 = level, 2 = above (high),
 * 3 = near-overhead (top). Thresholds sit between the atlas elevations
 * [-0.31, 0, 0.49, 1.25] rad so each frame covers its full band.
 */
export function quantizePitch(elevation: number, pitches = 4): PitchIndex {
  if (pitches <= 1) return 0;
  if (pitches === 2) return elevation > 0 ? 1 : 0;
  if (pitches === 3) {
    if (elevation > 0.1) return 2;
    if (elevation < -0.1) return 0;
    return 1;
  }
  if (elevation >= 0.87) return 3;
  if (elevation >= 0.245) return 2;
  if (elevation >= -0.155) return 1;
  return 0;
}

/**
 * Adds a narrow crossfade band around each pitch threshold so actors do not pop
 * between atlas angles while the player rises or looks down.
 */
export function samplePitch(elevation: number, pitches = 4): PitchSample {
  const index = quantizePitch(elevation, pitches);
  if (pitches !== 4) return { index, next: index, mix: 0 };

  for (let band = 0; band < PITCH_BOUNDARIES.length; band += 1) {
    const delta = elevation - PITCH_BOUNDARIES[band];
    if (Math.abs(delta) > PITCH_FADE) continue;
    const mix = clamp(0.5 + delta / (2 * PITCH_FADE), 0, 1);
    return { index: band as PitchIndex, next: (band + 1) as PitchIndex, mix };
  }

  return { index, next: index, mix: 0 };
}

/**
 * Static sprites (corpses) must not blend two baked pitch views: the crossfade
 * reads as a second, larger translucent silhouette. They snap to one row.
 */
export function sampleStaticPitch(elevation: number, pitches = 4): PitchSample {
  const index = quantizePitch(elevation, pitches);
  return { index, next: index, mix: 0 };
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
