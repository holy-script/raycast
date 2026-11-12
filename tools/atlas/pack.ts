import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PNG } from "pngjs";

const DEFAULT_CHARACTERS = ["guardian"];
const FRAME_WORLD_SIZE = 1.15;
const FRAME_ANCHOR_Z = -0.075;
// Matches PITCH_SCALES in render_turntable.py. The near-overhead frame is
// rendered with a tighter ortho frame, so its billboard must cover less world
// space or characters visibly grow while the camera rises.
const PITCH_ORTHO_SCALES = [1.15, 1.15, 1.15, 0.78];
// Prone corpses lie across the whole cell, so the death state is rendered with
// a wider ortho frame at every pitch. The manifest carries the matching world
// size and anchor so corpses still land on the ground plane.
const DEATH_ORTHO_SCALE = 1.40;
const DEATH_ANCHOR_Z = 0.5 - DEATH_ORTHO_SCALE / 2;

/**
 * Stacked depth-slice contract. The Blender depth pass maps 3.2 m to white and
 * 5.0 m to black (configure_depth in render_turntable.py); we split the body's
 * opaque depth range into four bands and give each band a small camera-space
 * offset so walls occlude the far slices and keep the near ones.
 */
export const SLICE_BANDS = 4;
export const SLICE_DEPTH_NEAR = 3.2;
export const SLICE_DEPTH_FAR = 5.0;
/** Metres of camera-space depth per band, ordered farthest → nearest. */
export const SLICE_OFFSETS = [0.15, 0.05, -0.05, -0.15];
const MIN_BAND_SAMPLE = 16;

const STATES = [
  { name: "idle", fps: 2, frames: 2 },
  { name: "walk", fps: 8, frames: 4 },
  { name: "attack", fps: 10, frames: 4 },
  { name: "hurt", fps: 8, frames: 2 },
  { name: "death", fps: 6, frames: 4 },
  { name: "talk", fps: 4, frames: 3 },
];

const FRAME_PATTERN = /^([a-z]+)_f(\d+)_p(\d+)_y(\d+)\.png$/;

interface AtlasFrame {
  state: string;
  pitch: number;
  yaw: number;
  frame: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface CharacterDirs {
  name: string;
  frames: string;
  depth: string;
  out: string;
}

function characterDirs(name: string): CharacterDirs {
  return {
    name,
    frames: resolve(`public/assets/sprites/${name}/frames`),
    depth: resolve(`assets-src/characters/${name}/control/depth`),
    out: resolve(`public/assets/sprites/${name}`),
  };
}

interface Scan {
  directions: number;
  pitches: number;
  frames: Map<string, string>;
}

function scanFrames(dir: CharacterDirs): Scan {
  const files = readdirSync(dir.frames).filter((file) => file.endsWith(".png"));
  let directions = 0;
  let pitches = 0;
  const frames = new Map<string, string>();
  for (const file of files) {
    const match = FRAME_PATTERN.exec(file);
    if (!match) continue;
    const [, state, frame, pitch, yaw] = match;
    directions = Math.max(directions, Number(yaw) + 1);
    pitches = Math.max(pitches, Number(pitch) + 1);
    frames.set(`${state}_f${frame}_p${pitch}_y${yaw}`, join(dir.frames, file));
  }
  if (directions === 0 || pitches === 0) {
    throw new Error(`No turntable frames found in ${dir.frames}. Run npm run assets:stylize first.`);
  }
  return { directions, pitches, frames };
}

interface PixelSource {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

/**
 * Collapses the 4×-resolution depth pass to frame resolution. Max (nearest)
 * sampling keeps a silhouette texel's depth instead of blending it with the
 * far background, which would otherwise drag the outline into the far band.
 */
export function downsampleDepthMax(
  depth: PixelSource,
  width: number,
  height: number,
): Uint8Array {
  if (depth.width % width !== 0 || depth.height % height !== 0) {
    throw new Error(
      `Depth pass ${depth.width}x${depth.height} is not a multiple of frame ${width}x${height}`,
    );
  }
  const scaleX = depth.width / width;
  const scaleY = depth.height / height;
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let nearest = 0;
      for (let sy = 0; sy < scaleY; sy += 1) {
        const row = y * scaleY + sy;
        for (let sx = 0; sx < scaleX; sx += 1) {
          const value = depth.data[(row * depth.width + x * scaleX + sx) * 4];
          if (value > nearest) nearest = value;
        }
      }
      out[y * width + x] = nearest;
    }
  }
  return out;
}

function depthQuantile(histogram: Uint32Array, total: number, q: number): number {
  const target = total * q;
  let cumulative = 0;
  for (let value = 0; value < histogram.length; value += 1) {
    cumulative += histogram[value];
    if (cumulative >= target) return value;
  }
  return histogram.length - 1;
}

/**
 * Atlas-wide band cuts in source red-channel units (0 = far/black,
 * 255 = near/white). The 1–99 percentile body window is split into equal
 * bands; outline texels with no depth fall into band 0. Using one global
 * window keeps animation from shimmering as per-frame ranges change.
 */
export function depthBandCuts(
  planes: ReadonlyArray<Uint8Array>,
  bands = SLICE_BANDS,
): number[] {
  const histogram = new Uint32Array(256);
  let total = 0;
  for (const plane of planes) {
    for (const value of plane) {
      if (value < MIN_BAND_SAMPLE) continue;
      histogram[value] += 1;
      total += 1;
    }
  }
  let low = 0;
  let high = 255;
  if (total > 0) {
    low = depthQuantile(histogram, total, 0.01);
    high = depthQuantile(histogram, total, 0.99);
    // Keep all bands usable when a depth range is too narrow to split.
    const minimumSpan = bands * 4;
    if (high - low < minimumSpan) {
      low = Math.max(0, low - minimumSpan);
      high = Math.min(255, high + minimumSpan);
    }
    if (high <= low) {
      low = 0;
      high = 255;
    }
  }
  const cuts: number[] = [];
  for (let band = 0; band <= bands; band += 1) {
    cuts.push(low + ((high - low) * band) / bands);
  }
  return cuts;
}

/** Band index for a depth value; band 0 is farthest, `cuts.length - 2` nearest. */
export function bandForDepth(value: number, cuts: readonly number[]): number {
  const bands = cuts.length - 1;
  if (bands <= 0) return 0;
  for (let band = 1; band < cuts.length; band += 1) {
    if (value < cuts[band]) return band - 1;
  }
  return bands - 1;
}

/** Encodes a band index as the grayscale value stored in the band atlas. */
export function bandToChannel(band: number, bands = SLICE_BANDS): number {
  if (bands <= 1) return 0;
  return Math.round((Math.max(0, Math.min(bands - 1, band)) / (bands - 1)) * 255);
}

/**
 * Pure per-frame quantizer: maps one downsampled depth plane onto band indices
 * using the shared cuts. Transparent colour texels stay in band 0 and are left
 * out of the written atlas.
 */
export function quantizeFrameBands(
  depthPlane: Uint8Array,
  color: PixelSource,
  cuts: readonly number[],
  bands = SLICE_BANDS,
): Uint8Array {
  const out = new Uint8Array(color.width * color.height);
  for (let index = 0; index < out.length; index += 1) {
    if (color.data[index * 4 + 3] === 0) continue;
    out[index] = bandForDepth(depthPlane[index], cuts) % bands;
  }
  return out;
}

function packCharacter(dir: CharacterDirs): number {
  if (!existsSync(dir.depth)) {
    throw new Error(
      `No depth passes found in ${dir.depth}. Run npm run assets:blender first.`,
    );
  }
  const { directions, pitches, frames: sources } = scanFrames(dir);
  const rows = STATES.reduce((total, state) => total + state.frames * pitches, 0);

  const firstPath = sources.get("idle_f0_p1_y0");
  if (!firstPath) {
    throw new Error(`Missing base frame idle_f0_p1_y0 in ${dir.frames}`);
  }
  const first = PNG.sync.read(readFileSync(firstPath));
  const frameWidth = first.width;
  const frameHeight = first.height;

  // Pass 1: collapse every depth pass and derive one atlas-wide band window.
  const depthPlanes = new Map<string, Uint8Array>();
  const allPlanes: Uint8Array[] = [];
  for (const key of sources.keys()) {
    const depthPath = join(dir.depth, `${key}.png`);
    if (!existsSync(depthPath)) {
      throw new Error(`Missing depth pass for ${key} in ${dir.depth}`);
    }
    const depth = PNG.sync.read(readFileSync(depthPath));
    const plane = downsampleDepthMax(depth, frameWidth, frameHeight);
    depthPlanes.set(key, plane);
    allPlanes.push(plane);
  }
  const cuts = depthBandCuts(allPlanes, SLICE_BANDS);

  const atlas = new PNG({
    width: frameWidth * directions,
    height: frameHeight * rows,
  });
  atlas.data.fill(0);
  // The band atlas mirrors the colour layout; only the red channel carries
  // the band index, so it stays a compact grayscale map on disk.
  const slices = new PNG({ width: atlas.width, height: atlas.height });
  slices.data.fill(0);

  const frames: AtlasFrame[] = [];
  let row = 0;

  for (const state of STATES) {
    for (let frameIndex = 0; frameIndex < state.frames; frameIndex += 1) {
      for (let pitch = 0; pitch < pitches; pitch += 1) {
        for (let yaw = 0; yaw < directions; yaw += 1) {
          const key = `${state.name}_f${frameIndex}_p${pitch}_y${yaw}`;
          const path = sources.get(key);
          if (!path) {
            throw new Error(`Missing frame ${state.name} f${frameIndex} p${pitch} y${yaw} in ${dir.frames}`);
          }
          const source = PNG.sync.read(readFileSync(path));
          if (source.width !== frameWidth || source.height !== frameHeight) {
            throw new Error(
              `Frame size mismatch for ${state.name} f${frameIndex} p${pitch} y${yaw}`,
            );
          }
          const dx = yaw * frameWidth;
          const dy = row * frameHeight;
          PNG.bitblt(source, atlas, 0, 0, frameWidth, frameHeight, dx, dy);

          const plane = depthPlanes.get(key);
          if (!plane) {
            throw new Error(`Missing depth plane for ${key}`);
          }
          const bands = quantizeFrameBands(plane, source, cuts, SLICE_BANDS);
          for (let ty = 0; ty < frameHeight; ty += 1) {
            for (let tx = 0; tx < frameWidth; tx += 1) {
              const index = ty * frameWidth + tx;
              // Transparent texels stay fully clear so the band atlas packs
              // tightly and costs nothing to sample.
              if (source.data[index * 4 + 3] === 0) continue;
              const value = bandToChannel(bands[index], SLICE_BANDS);
              const dst = ((dy + ty) * slices.width + dx + tx) * 4;
              slices.data[dst] = value;
              slices.data[dst + 1] = value;
              slices.data[dst + 2] = value;
              slices.data[dst + 3] = 255;
            }
          }

          frames.push({
            state: state.name,
            pitch,
            yaw,
            frame: frameIndex,
            x: dx,
            y: dy,
            w: frameWidth,
            h: frameHeight,
          });
        }
        row += 1;
      }
    }
  }

  const manifest = {
    version: 2,
    name: dir.name,
    image: "atlas.png",
    frameWidth,
    frameHeight,
    frameWorldSize: FRAME_WORLD_SIZE,
    frameAnchorZ: FRAME_ANCHOR_Z,
    pitchWorldScale: PITCH_ORTHO_SCALES.slice(0, pitches).map(
      (scale) => scale / FRAME_WORLD_SIZE,
    ),
    slices: {
      image: "slices.png",
      bands: SLICE_BANDS,
      offsets: SLICE_OFFSETS,
      depthNear: SLICE_DEPTH_NEAR,
      depthFar: SLICE_DEPTH_FAR,
      depthCuts: cuts.map((cut) => Number(cut.toFixed(3))),
    },
    directions,
    pitches,
    pitchOrder: ["low", "level", "high", "top"].slice(0, pitches),
    states: Object.fromEntries(
      STATES.map((state) => {
        const entry: {
          fps: number;
          frames: number;
          frameWorldSize?: number;
          frameAnchorZ?: number;
        } = { fps: state.fps, frames: state.frames };
        if (state.name === "death") {
          entry.frameWorldSize = DEATH_ORTHO_SCALE;
          entry.frameAnchorZ = DEATH_ANCHOR_Z;
        }
        return [state.name, entry];
      }),
    ),
    frames,
  };

  mkdirSync(dir.out, { recursive: true });
  writeFileSync(join(dir.out, "atlas.png"), PNG.sync.write(atlas));
  writeFileSync(join(dir.out, "slices.png"), PNG.sync.write(slices));
  writeFileSync(join(dir.out, "atlas.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(
    `${dir.name}: ${frames.length} frames, ${directions} dirs x ${pitches} pitch -> ` +
      `${atlas.width}x${atlas.height} atlas + ${slices.width}x${slices.height} band atlas ` +
      `(${SLICE_BANDS} bands, cuts ${cuts.map((cut) => cut.toFixed(1)).join("/")})`,
  );
  return frames.length;
}

function main(): void {
  const characters = process.argv.slice(2);
  const names = characters.length > 0 ? characters : DEFAULT_CHARACTERS;
  let total = 0;
  for (const name of names) {
    total += packCharacter(characterDirs(name));
  }
  console.log(`packed ${total} frames across ${names.length} character(s)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
