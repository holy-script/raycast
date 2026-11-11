import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PNG } from "pngjs";

const FRAME_DIR = resolve("public/assets/sprites/character/frames");
const OUT_DIR = resolve("public/assets/sprites/character");
const DIRECTIONS = 8;
const PITCHES = 3;
const FRAME_WORLD_SIZE = 1.15;
const FRAME_ANCHOR_Z = -0.075;

const STATES = [
  { name: "idle", fps: 2, frames: 2 },
  { name: "walk", fps: 8, frames: 4 },
];

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

function framePath(state: string, frame: number, pitch: number, yaw: number): string {
  return join(FRAME_DIR, `${state}_f${frame}_p${pitch}_y${yaw}.png`);
}

function main(): void {
  const rows = STATES.reduce((total, state) => total + state.frames * PITCHES, 0);

  const first = PNG.sync.read(
    readFileSync(framePath(STATES[0].name, 0, 1, 0)),
  );
  const frameWidth = first.width;
  const frameHeight = first.height;

  const atlas = new PNG({
    width: frameWidth * DIRECTIONS,
    height: frameHeight * rows,
  });
  atlas.data.fill(0);

  const frames: AtlasFrame[] = [];
  let row = 0;

  for (const state of STATES) {
    for (let frameIndex = 0; frameIndex < state.frames; frameIndex += 1) {
      for (let pitch = 0; pitch < PITCHES; pitch += 1) {
        for (let yaw = 0; yaw < DIRECTIONS; yaw += 1) {
          const source = PNG.sync.read(
            readFileSync(framePath(state.name, frameIndex, pitch, yaw)),
          );
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
    image: "atlas.png",
    frameWidth,
    frameHeight,
    frameWorldSize: FRAME_WORLD_SIZE,
    frameAnchorZ: FRAME_ANCHOR_Z,
    directions: DIRECTIONS,
    pitches: PITCHES,
    pitchOrder: ["low", "level", "high"],
    states: Object.fromEntries(
      STATES.map((state) => [state.name, { fps: state.fps, frames: state.frames }]),
    ),
    frames,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "atlas.png"), PNG.sync.write(atlas));
  writeFileSync(join(OUT_DIR, "atlas.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(
    `packed ${frames.length} frames into ${atlas.width}x${atlas.height} atlas`,
  );
  console.log(`wrote ${join(OUT_DIR, "atlas.png")}`);
  console.log(`wrote ${join(OUT_DIR, "atlas.json")}`);
}

main();
