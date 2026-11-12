import type { PitchIndex } from "./math";
import type { FrameRect, FrameSlice, Texture } from "./renderer";

export interface AtlasFrameEntry {
  state: string;
  pitch: number;
  yaw: number;
  frame: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Stacked depth-slice metadata. The band atlas is a separate grayscale image
 * with the same frame layout as `image`, so every existing frame rect is
 * unchanged. Band 0 is farthest from the camera and `bands - 1` nearest.
 */
export interface SliceManifest {
  image: string;
  bands: number;
  /** Camera-space depth offsets in metres, indexed by band (far → near). */
  offsets: number[];
  /** Source depth pass range in metres (3.2 near/white, 5.0 far/black). */
  depthNear?: number;
  depthFar?: number;
  /** Quantizer cut points in source red-channel units (far → near). */
  depthCuts?: number[];
}

export interface AtlasManifest {
  version: number;
  name?: string;
  image: string;
  frameWidth: number;
  frameHeight: number;
  frameWorldSize: number;
  frameAnchorZ?: number;
  /** Per-pitch billboard scale, compensating the tighter near-overhead frame. */
  pitchWorldScale?: number[];
  /** Optional stacked depth-slice atlas; absent manifests render one billboard. */
  slices?: SliceManifest;
  directions: number;
  pitches: number;
  pitchOrder: string[];
  states: Record<
    string,
    {
      fps: number;
      frames: number;
      /** Wider world frame for states whose silhouette spans the whole cell. */
      frameWorldSize?: number;
      frameAnchorZ?: number;
    }
  >;
  frames: AtlasFrameEntry[];
}

const MAX_SLICE_BANDS = 8;

/**
 * Validates the optional slice block. A malformed or partial declaration falls
 * back to the unsliced billboard path instead of failing asset boot.
 */
export function readSliceConfig(
  manifest: AtlasManifest,
): SliceManifest | undefined {
  const slices = manifest.slices;
  if (!slices || typeof slices.image !== "string" || slices.image.length === 0) {
    return undefined;
  }
  const bands = Math.floor(slices.bands);
  if (!Number.isFinite(bands) || bands < 2 || bands > MAX_SLICE_BANDS) {
    return undefined;
  }
  if (
    !Array.isArray(slices.offsets) ||
    slices.offsets.length !== bands ||
    !slices.offsets.every((offset) => Number.isFinite(offset))
  ) {
    return undefined;
  }
  return {
    image: slices.image,
    bands,
    // Keep the per-band offsets small; a bad manifest must not teleport slices.
    offsets: slices.offsets.map((offset) => Math.max(-0.5, Math.min(0.5, offset))),
    depthNear: slices.depthNear,
    depthFar: slices.depthFar,
    depthCuts: Array.isArray(slices.depthCuts)
      ? slices.depthCuts.filter((cut) => Number.isFinite(cut))
      : undefined,
  };
}

export class SpriteAtlas {
  readonly manifest: AtlasManifest;
  readonly texture: Texture;
  private readonly frames = new Map<string, AtlasFrameEntry>();
  private readonly slices: SliceManifest | undefined;
  private readonly sliceTexture: Texture | undefined;

  constructor(manifest: AtlasManifest, texture: Texture, sliceTexture?: Texture) {
    this.manifest = manifest;
    this.texture = texture;
    this.slices = readSliceConfig(manifest);
    // A band atlas without an image cannot be sampled; keep the base path.
    this.sliceTexture =
      this.slices && sliceTexture && sliceTexture.width === texture.width &&
      sliceTexture.height === texture.height
        ? sliceTexture
        : undefined;
    for (const frame of manifest.frames) {
      this.frames.set(this.key(frame.state, frame.pitch, frame.yaw, frame.frame), frame);
    }
  }

  private key(state: string, pitch: number, yaw: number, frame: number): string {
    return `${state}|${pitch}|${yaw}|${frame}`;
  }

  /**
   * Every state/pitch/yaw/frame the manifest advertises must exist. Rendering
   * silently falls back to idle, so a missing combat frame otherwise looks like
   * an actor that refuses to attack.
   */
  missingFrames(): string[] {
    const missing: string[] = [];
    for (const [state, definition] of Object.entries(this.manifest.states)) {
      for (let pitch = 0; pitch < this.manifest.pitches; pitch += 1) {
        for (let yaw = 0; yaw < this.manifest.directions; yaw += 1) {
          for (let frame = 0; frame < definition.frames; frame += 1) {
            if (!this.frames.has(this.key(state, pitch, yaw, frame))) {
              missing.push(`${state} f${frame} p${pitch} y${yaw}`);
            }
          }
        }
      }
    }
    return missing;
  }

  getFrame(
    state: string,
    pitch: PitchIndex,
    yaw: number,
    frame: number,
  ): FrameRect | undefined {
    const stateDef = this.manifest.states[state] ?? this.manifest.states.idle;
    if (!stateDef) return undefined;
    const yawIndex = ((yaw % this.manifest.directions) + this.manifest.directions) %
      this.manifest.directions;
    const frameIndex = ((frame % stateDef.frames) + stateDef.frames) % stateDef.frames;
    const entry =
      this.frames.get(this.key(state, pitch, yawIndex, frameIndex)) ??
      this.frames.get(this.key(state, 1, yawIndex, frameIndex)) ??
      this.frames.get(this.key("idle", 1, yawIndex, 0));
    if (!entry) return undefined;
    const result: FrameRect = {
      texture: this.texture,
      sx: entry.x,
      sy: entry.y,
      sw: entry.w,
      sh: entry.h,
    };
    if (this.slices && this.sliceTexture) {
      // The band atlas mirrors the colour layout exactly, so the same rect
      // addresses the band indices for this frame.
      const slice: FrameSlice = {
        texture: this.sliceTexture,
        sx: entry.x,
        sy: entry.y,
        sw: entry.w,
        sh: entry.h,
        bands: this.slices.bands,
        offsets: this.slices.offsets,
      };
      result.slice = slice;
    }
    return result;
  }
}

export async function loadAtlas(manifestUrl: string): Promise<SpriteAtlas> {
  const response = await fetch(manifestUrl);
  if (!response.ok) {
    throw new Error(`Failed to load atlas manifest: ${response.status}`);
  }
  const manifest = (await response.json()) as AtlasManifest;
  const baseUrl = new URL(manifestUrl, window.location.href);
  const imageUrl = new URL(manifest.image, baseUrl);
  const texture = await loadTexture(imageUrl.href);
  const slices = readSliceConfig(manifest);
  if (!slices) {
    // Manifests without slices keep the original single-billboard path.
    return new SpriteAtlas(manifest, texture);
  }
  const sliceUrl = new URL(slices.image, baseUrl);
  const sliceTexture = await loadTexture(sliceUrl.href);
  if (
    sliceTexture.width !== texture.width ||
    sliceTexture.height !== texture.height
  ) {
    throw new Error(
      `Slice atlas ${slices.image} must match ${manifest.image}: ` +
        `${sliceTexture.width}x${sliceTexture.height} vs ` +
        `${texture.width}x${texture.height}`,
    );
  }
  return new SpriteAtlas(manifest, texture, sliceTexture);
}

export async function loadTexture(url: string): Promise<Texture> {
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  await image.decode();

  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D canvas unavailable while decoding texture");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, image.width, image.height).data;

  return { width: image.width, height: image.height, data };
}
