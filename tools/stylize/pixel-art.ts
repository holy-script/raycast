import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { PNG } from "pngjs";

const RAW_DIR = resolve("assets-src/character/raw");
const OUT_DIR = resolve("public/assets/sprites/character/frames");
const SCALE = 4;
const ALPHA_CUTOFF = 0.5;

const PALETTE: Array<[number, number, number]> = [
  [7, 9, 13],
  [16, 19, 26],
  [26, 31, 41],
  [38, 45, 58],
  [52, 61, 77],
  [74, 85, 104],
  [102, 116, 140],
  [139, 154, 179],
  [185, 199, 220],
  [223, 232, 242],
  [58, 28, 20],
  [92, 42, 28],
  [127, 60, 38],
  [168, 85, 47],
  [204, 116, 66],
  [230, 152, 99],
  [242, 189, 138],
  [42, 25, 18],
  [58, 34, 22],
  [74, 42, 25],
  [96, 54, 30],
  [122, 70, 38],
  [14, 43, 46],
  [23, 68, 71],
  [33, 95, 99],
  [46, 125, 128],
  [69, 163, 164],
  [108, 199, 195],
  [152, 224, 215],
  [11, 58, 69],
  [18, 96, 112],
  [29, 140, 162],
  [47, 184, 207],
  [110, 224, 239],
  [18, 32, 43],
  [29, 53, 71],
  [43, 77, 99],
  [63, 111, 136],
  [91, 147, 173],
  [141, 191, 210],
  [91, 60, 31],
  [138, 90, 43],
  [183, 127, 58],
  [217, 164, 90],
  [240, 201, 135],
  [30, 44, 54],
  [43, 60, 72],
  [91, 81, 65],
  [138, 122, 95],
  [181, 161, 124],
  [220, 201, 162],
  [240, 228, 200],
];

const OUTLINE: [number, number, number] = [7, 9, 13];

function punchColor(r: number, g: number, b: number): [number, number, number] {
  const gray = 0.299 * r + 0.587 * g + 0.114 * b;
  const saturate = (channel: number): number =>
    ((gray + (channel - gray) * 1.35) - 128) * 1.08 + 128;
  return [saturate(r), saturate(g), saturate(b)];
}

function nearestColor(r: number, g: number, b: number): [number, number, number] {
  let best = PALETTE[0];
  let bestDistance = Infinity;
  for (const color of PALETTE) {
    const dr = (r - color[0]) * 0.3;
    const dg = (g - color[1]) * 0.59;
    const db = (b - color[2]) * 0.11;
    const distance = dr * dr + dg * dg + db * db;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = color;
    }
  }
  return best;
}

function stylize(raw: PNG): PNG {
  const width = Math.floor(raw.width / SCALE);
  const height = Math.floor(raw.height / SCALE);
  const out = new PNG({ width, height });

  // Premultiplied box downsample avoids dark halos around the silhouette.
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SCALE; sy += 1) {
        for (let sx = 0; sx < SCALE; sx += 1) {
          const srcX = x * SCALE + sx;
          const srcY = y * SCALE + sy;
          const idx = (srcY * raw.width + srcX) * 4;
          const alpha = raw.data[idx + 3] / 255;
          r += raw.data[idx] * alpha;
          g += raw.data[idx + 1] * alpha;
          b += raw.data[idx + 2] * alpha;
          a += alpha;
        }
      }
      const samples = SCALE * SCALE;
      const alpha = a / samples;
      const dst = (y * width + x) * 4;
      if (alpha < ALPHA_CUTOFF || a === 0) {
        out.data[dst] = 0;
        out.data[dst + 1] = 0;
        out.data[dst + 2] = 0;
        out.data[dst + 3] = 0;
        continue;
      }
      const [pr, pg, pb] = punchColor(r / a, g / a, b / a);
      const [cr, cg, cb] = nearestColor(pr, pg, pb);
      out.data[dst] = cr;
      out.data[dst + 1] = cg;
      out.data[dst + 2] = cb;
      out.data[dst + 3] = 255;
    }
  }

  // 1px dark contour read from an immutable mask so the outline cannot flood-fill.
  const solid = new Uint8Array(width * height);
  for (let i = 0; i < solid.length; i += 1) {
    solid[i] = out.data[i * 4 + 3] !== 0 ? 1 : 0;
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (solid[y * width + x]) continue;
      const touchesSolid =
        (x > 0 && solid[y * width + x - 1]) ||
        (x < width - 1 && solid[y * width + x + 1]) ||
        (y > 0 && solid[(y - 1) * width + x]) ||
        (y < height - 1 && solid[(y + 1) * width + x]);
      if (!touchesSolid) continue;
      const idx = (y * width + x) * 4;
      out.data[idx] = OUTLINE[0];
      out.data[idx + 1] = OUTLINE[1];
      out.data[idx + 2] = OUTLINE[2];
      out.data[idx + 3] = 255;
    }
  }

  return out;
}

function main(): void {
  mkdirSync(OUT_DIR, { recursive: true });
  const files = readdirSync(RAW_DIR).filter((file) => file.endsWith(".png"));
  if (files.length === 0) {
    throw new Error(`No raw renders found in ${RAW_DIR}. Run npm run assets:blender first.`);
  }

  for (const file of files) {
    const raw = PNG.sync.read(readFileSync(join(RAW_DIR, file)));
    const stylized = stylize(raw);
    writeFileSync(join(OUT_DIR, basename(file)), PNG.sync.write(stylized));
    console.log(`stylized ${file} -> ${stylized.width}x${stylized.height}`);
  }
}

main();
