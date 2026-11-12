import { describe, expect, it } from "vitest";
import {
  SpriteAtlas,
  readSliceConfig,
  type AtlasFrameEntry,
  type AtlasManifest,
} from "../src/engine/atlas";
import {
  sliceBandFromChannel,
  sliceDrawOrder,
  wantsSlices,
  type Texture,
} from "../src/engine/renderer";
import {
  bandForDepth,
  bandToChannel,
  depthBandCuts,
  downsampleDepthMax,
  quantizeFrameBands,
} from "../tools/atlas/pack";

function texture(width: number, height: number, fill: number): Texture {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = fill;
    data[index * 4 + 1] = fill;
    data[index * 4 + 2] = fill;
    data[index * 4 + 3] = 255;
  }
  return { width, height, data };
}

function manifest(slices?: AtlasManifest["slices"]): AtlasManifest {
  const frames: AtlasFrameEntry[] = [
    { state: "idle", pitch: 1, yaw: 0, frame: 0, x: 0, y: 16, w: 16, h: 16 },
  ];
  return {
    version: slices ? 2 : 1,
    image: "atlas.png",
    frameWidth: 16,
    frameHeight: 16,
    frameWorldSize: 1.15,
    slices,
    directions: 8,
    pitches: 3,
    pitchOrder: ["low", "level", "high"],
    states: { idle: { fps: 2, frames: 1 } },
    frames,
  };
}

const SLICES = {
  image: "slices.png",
  bands: 4,
  offsets: [0.15, 0.05, -0.05, -0.15],
  depthNear: 3.2,
  depthFar: 5,
  depthCuts: [85, 114, 142, 170, 199],
};

describe("depth band quantization", () => {
  it("collapses a depth pass with nearest (max) sampling", () => {
    const depth = { width: 4, height: 4, data: new Uint8ClampedArray(4 * 4 * 4) };
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        depth.data[(y * 4 + x) * 4] = x < 2 && y < 2 ? 200 : 50;
      }
    }
    expect([...downsampleDepthMax(depth, 2, 2)]).toEqual([200, 50, 50, 50]);
  });

  it("derives ascending cuts from the opaque body window", () => {
    const values = new Uint8Array(1000);
    for (let index = 0; index < values.length; index += 1) {
      values[index] = 60 + (index % 120);
    }
    const cuts = depthBandCuts([values], 4);
    expect(cuts).toHaveLength(5);
    for (let index = 1; index < cuts.length; index += 1) {
      expect(cuts[index]).toBeGreaterThan(cuts[index - 1]);
    }
    // Background/outline texels below the sample floor still land in band 0.
    expect(bandForDepth(0, cuts)).toBe(0);
    expect(bandForDepth(255, cuts)).toBe(3);
  });

  it("assigns a synthetic frame+depth pair across all four bands", () => {
    const cuts = [0, 80, 140, 200, 255];
    const depth = new Uint8Array([0, 100, 150, 250]);
    const color = {
      width: 2,
      height: 2,
      data: new Uint8ClampedArray([
        10, 10, 10, 255,
        20, 20, 20, 255,
        30, 30, 30, 255,
        40, 40, 40, 255,
      ]),
    };
    expect([...quantizeFrameBands(depth, color, cuts)]).toEqual([0, 1, 2, 3]);
  });

  it("leaves transparent texels out of the band map", () => {
    const cuts = [0, 80, 140, 200, 255];
    const depth = new Uint8Array([250, 250]);
    const color = {
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([9, 9, 9, 0, 9, 9, 9, 255]),
    };
    expect([...quantizeFrameBands(depth, color, cuts)]).toEqual([0, 3]);
  });

  it("round-trips a band index through the grayscale channel", () => {
    for (let band = 0; band < 4; band += 1) {
      expect(sliceBandFromChannel(bandToChannel(band, 4), 4)).toBe(band);
    }
    expect(sliceBandFromChannel(255, 4)).toBe(3);
    expect(sliceBandFromChannel(-10, 4)).toBe(0);
  });
});

describe("slice renderer helpers", () => {
  it("orders bands farthest first", () => {
    expect(sliceDrawOrder([0.15, 0.05, -0.05, -0.15])).toEqual([0, 1, 2, 3]);
    expect(sliceDrawOrder([-0.15, 0.15, -0.05, 0.05])).toEqual([1, 3, 2, 0]);
  });

  it("only enables slices inside the close-range LOD", () => {
    expect(wantsSlices(7.99)).toBe(true);
    expect(wantsSlices(8)).toBe(true);
    expect(wantsSlices(8.01)).toBe(false);
  });
});

describe("slice manifest parsing", () => {
  it("accepts a valid slice block", () => {
    expect(readSliceConfig(manifest(SLICES))).toEqual(SLICES);
  });

  it("ignores missing, partial, or out-of-range slice blocks", () => {
    expect(readSliceConfig(manifest())).toBeUndefined();
    expect(
      readSliceConfig(manifest({ ...SLICES, bands: 1 })),
    ).toBeUndefined();
    expect(
      readSliceConfig(manifest({ ...SLICES, offsets: [0.1, -0.1] })),
    ).toBeUndefined();
    expect(
      readSliceConfig(manifest({ ...SLICES, image: "" })),
    ).toBeUndefined();
  });

  it("clamps oversized per-band offsets", () => {
    const config = readSliceConfig(
      manifest({ ...SLICES, offsets: [9, 0.05, -0.05, -9] }),
    );
    expect(config?.offsets).toEqual([0.5, 0.05, -0.05, -0.5]);
  });

  it("attaches a mirrored slice rect only when a band atlas is supplied", () => {
    const color = texture(32, 16, 200);
    const bands = texture(32, 16, 85);
    const sliced = new SpriteAtlas(manifest(SLICES), color, bands);
    const frame = sliced.getFrame("idle", 1, 0, 0);
    expect(frame?.slice).toBeDefined();
    expect(frame?.slice?.texture).toBe(bands);
    expect(frame?.slice).toMatchObject({ sx: 0, sy: 16, sw: 16, sh: 16, bands: 4 });

    const plain = new SpriteAtlas(manifest(), color);
    expect(plain.getFrame("idle", 1, 0, 0)?.slice).toBeUndefined();
  });

  it("rejects a band atlas that does not mirror the colour size", () => {
    const atlas = new SpriteAtlas(
      manifest(SLICES),
      texture(32, 16, 200),
      texture(16, 16, 85),
    );
    expect(atlas.getFrame("idle", 1, 0, 0)?.slice).toBeUndefined();
  });
});
