import { PNG } from "pngjs";

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function alphaMask(png: PNG, cutoff = 0.5): Uint8Array {
  const mask = new Uint8Array(png.width * png.height);
  const threshold = cutoff * 255;
  for (let i = 0; i < mask.length; i += 1) {
    mask[i] = png.data[i * 4 + 3] >= threshold ? 1 : 0;
  }
  return mask;
}

export function intersectionOverUnion(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) {
    throw new Error(`Mask sizes differ: ${a.length} vs ${b.length}`);
  }
  let intersection = 0;
  let union = 0;
  for (let i = 0; i < a.length; i += 1) {
    const inA = a[i] === 1;
    const inB = b[i] === 1;
    if (inA && inB) intersection += 1;
    if (inA || inB) union += 1;
  }
  return union === 0 ? 1 : intersection / union;
}

/** 4-neighbour dilation; used to allow the mandated 1 px sprite outline. */
export function dilateMask(
  mask: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!mask[index]) continue;
      out[index] = 1;
      if (x > 0) out[index - 1] = 1;
      if (x < width - 1) out[index + 1] = 1;
      if (y > 0) out[index - width] = 1;
      if (y < height - 1) out[index + width] = 1;
    }
  }
  return out;
}

export function meanOpaqueColor(png: PNG): Rgb | null {
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let i = 0; i < png.width * png.height; i += 1) {
    const idx = i * 4;
    if (png.data[idx + 3] < 128) continue;
    r += png.data[idx];
    g += png.data[idx + 1];
    b += png.data[idx + 2];
    count += 1;
  }
  if (count === 0) return null;
  return { r: r / count, g: g / count, b: b / count };
}

export function medianColor(colors: Rgb[]): Rgb | null {
  if (colors.length === 0) return null;
  const median = (values: number[]): number => {
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle];
  };
  return {
    r: median(colors.map((color) => color.r)),
    g: median(colors.map((color) => color.g)),
    b: median(colors.map((color) => color.b)),
  };
}

export function colorDistance(a: Rgb, b: Rgb): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}
