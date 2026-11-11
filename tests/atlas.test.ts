import { describe, expect, it } from "vitest";
import { SpriteAtlas, type AtlasFrameEntry, type AtlasManifest } from "../src/engine/atlas";
import type { Texture } from "../src/engine/renderer";

const texture: Texture = {
  width: 1,
  height: 1,
  data: new Uint8ClampedArray([255, 0, 0, 255]),
};

function manifest(frames: AtlasFrameEntry[]): AtlasManifest {
  return {
    version: 1,
    image: "atlas.png",
    frameWidth: 16,
    frameHeight: 16,
    frameWorldSize: 1.15,
    frameAnchorZ: -0.075,
    directions: 8,
    pitches: 3,
    pitchOrder: ["low", "level", "high"],
    states: {
      idle: { fps: 2, frames: 2 },
      walk: { fps: 8, frames: 4 },
    },
    frames,
  };
}

const entry = (
  state: string,
  pitch: number,
  yaw: number,
  frame: number,
): AtlasFrameEntry => ({
  state,
  pitch,
  yaw,
  frame,
  x: yaw * 16,
  y: (pitch * 8 + frame) * 16,
  w: 16,
  h: 16,
});

describe("sprite atlas lookup", () => {
  const atlas = new SpriteAtlas(
    manifest([
      entry("idle", 0, 0, 0),
      entry("idle", 1, 0, 0),
      entry("idle", 2, 0, 0),
      entry("idle", 1, 3, 1),
      entry("walk", 1, 3, 2),
    ]),
    texture,
  );

  it("returns the exact frame rect for a yaw/pitch/frame triple", () => {
    const frame = atlas.getFrame("idle", 1, 3, 1);
    expect(frame).toBeDefined();
    expect(frame!.sx).toBe(48);
    expect(frame!.texture).toBe(texture);
  });

  it("wraps yaw and frame indices", () => {
    const frame = atlas.getFrame("idle", 1, 11, 3);
    expect(frame).toBeDefined();
    expect(frame!.sx).toBe(48);
  });

  it("falls back to the level pitch when a pitch row is missing", () => {
    const frame = atlas.getFrame("walk", 2, 3, 2);
    expect(frame).toBeDefined();
    expect(frame!.sy).toBe((1 * 8 + 2) * 16);
  });

  it("falls back to the idle level frame when the state is unknown", () => {
    const frame = atlas.getFrame("attack", 1, 0, 0);
    expect(frame).toBeDefined();
    expect(frame!.sx).toBe(0);
  });

  it("returns undefined when nothing can be resolved", () => {
    const empty = new SpriteAtlas(manifest([]), texture);
    expect(empty.getFrame("idle", 1, 0, 0)).toBeUndefined();
  });
});
