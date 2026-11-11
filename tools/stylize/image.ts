import { PNG } from "pngjs";

/**
 * Box-filter resize in premultiplied alpha space. Averaging straight RGBA would
 * pull the colour of transparent pixels (usually black) into sprite edges.
 */
export function downsample(source: PNG, width: number, height: number): PNG {
  const out = new PNG({ width, height });
  const scaleX = source.width / width;
  const scaleY = source.height / height;
  const totalWeight = scaleX * scaleY;

  for (let y = 0; y < height; y += 1) {
    const yStart = y * scaleY;
    const yEnd = (y + 1) * scaleY;
    for (let x = 0; x < width; x += 1) {
      const xStart = x * scaleX;
      const xEnd = (x + 1) * scaleX;
      let r = 0;
      let g = 0;
      let b = 0;
      let alpha = 0;
      for (let sy = Math.floor(yStart); sy < Math.ceil(yEnd); sy += 1) {
        const wy = Math.min(yEnd, sy + 1) - Math.max(yStart, sy);
        if (wy <= 0) continue;
        const srcY = Math.min(sy, source.height - 1);
        for (let sx = Math.floor(xStart); sx < Math.ceil(xEnd); sx += 1) {
          const wx = Math.min(xEnd, sx + 1) - Math.max(xStart, sx);
          if (wx <= 0) continue;
          const srcX = Math.min(sx, source.width - 1);
          const idx = (srcY * source.width + srcX) * 4;
          const weight = wx * wy;
          const a = source.data[idx + 3] / 255;
          r += source.data[idx] * a * weight;
          g += source.data[idx + 1] * a * weight;
          b += source.data[idx + 2] * a * weight;
          alpha += a * weight;
        }
      }
      const dst = (y * width + x) * 4;
      if (alpha <= 0) {
        out.data[dst] = 0;
        out.data[dst + 1] = 0;
        out.data[dst + 2] = 0;
        out.data[dst + 3] = 0;
        continue;
      }
      out.data[dst] = Math.round(r / alpha);
      out.data[dst + 1] = Math.round(g / alpha);
      out.data[dst + 2] = Math.round(b / alpha);
      out.data[dst + 3] = Math.round((alpha / totalWeight) * 255);
    }
  }
  return out;
}
