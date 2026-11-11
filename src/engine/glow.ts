import type { Texture } from "./renderer";

/**
 * White radial falloff used for plasma bolts and impact flashes. The colour
 * comes from the sprite tint, so one small texture serves both the player's
 * cyan bolts and hostile orange ones.
 */
export function createGlowTexture(size = 16): Texture {
  const data = new Uint8ClampedArray(size * size * 4);
  const center = (size - 1) / 2;
  const radius = size / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const distance = Math.hypot(x - center, y - center) / radius;
      const alpha = Math.max(0, 1 - distance);
      const index = (y * size + x) * 4;
      data[index] = 255;
      data[index + 1] = 255;
      data[index + 2] = 255;
      data[index + 3] = 255 * alpha * alpha;
    }
  }
  return { width: size, height: size, data };
}
