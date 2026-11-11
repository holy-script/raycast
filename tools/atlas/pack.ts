import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PNG } from "pngjs";

const DEFAULT_CHARACTERS = ["guardian", "scout", "brute"];
const FRAME_WORLD_SIZE = 1.15;
const FRAME_ANCHOR_Z = -0.075;

const STATES = [
  { name: "idle", fps: 2, frames: 2 },
  { name: "walk", fps: 8, frames: 4 },
];

const FRAME_PATTERN = /^(idle|walk)_f(\d+)_p(\d+)_y(\d+)\.png$/;

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
  out: string;
}

function characterDirs(name: string): CharacterDirs {
  return {
    name,
    frames: resolve(`public/assets/sprites/${name}/frames`),
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

function packCharacter(dir: CharacterDirs): number {
  const { directions, pitches, frames: sources } = scanFrames(dir);
  const rows = STATES.reduce((total, state) => total + state.frames * pitches, 0);

  const firstPath = sources.get("idle_f0_p1_y0");
  if (!firstPath) {
    throw new Error(`Missing base frame idle_f0_p1_y0 in ${dir.frames}`);
  }
  const first = PNG.sync.read(readFileSync(firstPath));
  const frameWidth = first.width;
  const frameHeight = first.height;

  const atlas = new PNG({
    width: frameWidth * directions,
    height: frameHeight * rows,
  });
  atlas.data.fill(0);

  const frames: AtlasFrame[] = [];
  let row = 0;

  for (const state of STATES) {
    for (let frameIndex = 0; frameIndex < state.frames; frameIndex += 1) {
      for (let pitch = 0; pitch < pitches; pitch += 1) {
        for (let yaw = 0; yaw < directions; yaw += 1) {
          const path = sources.get(`${state.name}_f${frameIndex}_p${pitch}_y${yaw}`);
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
    version: 1,
    name: dir.name,
    image: "atlas.png",
    frameWidth,
    frameHeight,
    frameWorldSize: FRAME_WORLD_SIZE,
    frameAnchorZ: FRAME_ANCHOR_Z,
    directions,
    pitches,
    pitchOrder: ["low", "level", "high"].slice(0, pitches),
    states: Object.fromEntries(
      STATES.map((state) => [state.name, { fps: state.fps, frames: state.frames }]),
    ),
    frames,
  };

  mkdirSync(dir.out, { recursive: true });
  writeFileSync(join(dir.out, "atlas.png"), PNG.sync.write(atlas));
  writeFileSync(join(dir.out, "atlas.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(
    `${dir.name}: ${frames.length} frames, ${directions} dirs x ${pitches} pitch -> ` +
      `${atlas.width}x${atlas.height} atlas`,
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

main();
