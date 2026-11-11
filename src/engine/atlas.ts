import type { PitchIndex } from "./math";
import type { FrameRect, Texture } from "./renderer";

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

export class SpriteAtlas {
  readonly manifest: AtlasManifest;
  readonly texture: Texture;
  private readonly frames = new Map<string, AtlasFrameEntry>();

  constructor(manifest: AtlasManifest, texture: Texture) {
    this.manifest = manifest;
    this.texture = texture;
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
    return {
      texture: this.texture,
      sx: entry.x,
      sy: entry.y,
      sw: entry.w,
      sh: entry.h,
    };
  }
}

export async function loadAtlas(manifestUrl: string): Promise<SpriteAtlas> {
  const response = await fetch(manifestUrl);
  if (!response.ok) {
    throw new Error(`Failed to load atlas manifest: ${response.status}`);
  }
  const manifest = (await response.json()) as AtlasManifest;
  const imageUrl = new URL(manifest.image, new URL(manifestUrl, window.location.href));
  const texture = await loadTexture(imageUrl.href);
  return new SpriteAtlas(manifest, texture);
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
