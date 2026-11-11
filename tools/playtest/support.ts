import { readFileSync, writeFileSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { PNG } from "pngjs";
import { sleep } from "./cdp";

// 3x5 glyphs scaled 2x, so sheets stay readable without a canvas dependency.
export const GLYPHS: Record<string, string[]> = {
  A: ["010", "101", "111", "101", "101"],
  B: ["110", "101", "110", "101", "110"],
  C: ["011", "100", "100", "100", "011"],
  D: ["110", "101", "101", "101", "110"],
  E: ["111", "100", "110", "100", "111"],
  F: ["111", "100", "110", "100", "100"],
  G: ["011", "100", "101", "101", "011"],
  H: ["101", "101", "111", "101", "101"],
  I: ["111", "010", "010", "010", "111"],
  J: ["001", "001", "001", "101", "010"],
  K: ["101", "101", "110", "101", "101"],
  L: ["100", "100", "100", "100", "111"],
  M: ["101", "111", "111", "101", "101"],
  N: ["101", "111", "101", "101", "101"],
  O: ["010", "101", "101", "101", "010"],
  P: ["110", "101", "110", "100", "100"],
  Q: ["010", "101", "101", "111", "011"],
  R: ["110", "101", "110", "101", "101"],
  S: ["011", "100", "010", "001", "110"],
  T: ["111", "010", "010", "010", "010"],
  U: ["101", "101", "101", "101", "111"],
  V: ["101", "101", "101", "101", "010"],
  W: ["101", "101", "111", "111", "101"],
  X: ["101", "101", "010", "101", "101"],
  Y: ["101", "101", "010", "010", "010"],
  Z: ["111", "001", "010", "100", "111"],
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["110", "001", "010", "100", "111"],
  "3": ["110", "001", "010", "001", "110"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "110", "001", "110"],
  "6": ["011", "100", "111", "101", "111"],
  "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "110"],
  "-": ["000", "000", "111", "000", "000"],
  ".": ["000", "000", "000", "000", "010"],
  "/": ["001", "001", "010", "100", "100"],
};

export function fillRect(
  target: PNG,
  x: number,
  y: number,
  width: number,
  height: number,
  color: [number, number, number],
): void {
  for (let row = y; row < y + height; row += 1) {
    for (let col = x; col < x + width; col += 1) {
      if (row < 0 || col < 0 || row >= target.height || col >= target.width) continue;
      const offset = (row * target.width + col) * 4;
      target.data[offset] = color[0];
      target.data[offset + 1] = color[1];
      target.data[offset + 2] = color[2];
      target.data[offset + 3] = 255;
    }
  }
}

export function drawLabel(
  target: PNG,
  text: string,
  x: number,
  y: number,
  scale: number,
): void {
  const color: [number, number, number] = [255, 210, 138];
  let cursor = x;
  for (const character of text) {
    const glyph = GLYPHS[character] ?? GLYPHS["-"];
    for (let row = 0; row < glyph.length; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        if (glyph[row][col] !== "1") continue;
        fillRect(target, cursor + col * scale, y + row * scale, scale, scale, color);
      }
    }
    cursor += 3 * scale + scale;
  }
}

/** Writes a contact sheet, scaling sources down to the cell size. */
export function composeSheet(
  shots: Array<{ name: string; file: string }>,
  file: string,
  cellW = 384,
  cellH = 240,
  cols = 5,
): void {
  const gap = 6;
  const labelHeight = 16;
  const rows = Math.ceil(shots.length / cols);
  const sheet = new PNG({
    width: cols * (cellW + gap) + gap,
    height: rows * (cellH + labelHeight + gap) + gap,
  });
  fillRect(sheet, 0, 0, sheet.width, sheet.height, [10, 11, 16]);
  shots.forEach((shot, index) => {
    const x = gap + (index % cols) * (cellW + gap);
    const y = gap + Math.floor(index / cols) * (cellH + labelHeight + gap);
    drawLabel(sheet, shot.name.toUpperCase(), x, y + 2, 2);
    const source = PNG.sync.read(readFileSync(shot.file));
    for (let row = 0; row < cellH; row += 1) {
      const srcRow = Math.min(
        source.height - 1,
        Math.floor((row * source.height) / cellH),
      );
      for (let col = 0; col < cellW; col += 1) {
        const srcCol = Math.min(
          source.width - 1,
          Math.floor((col * source.width) / cellW),
        );
        const from = (srcRow * source.width + srcCol) * 4;
        const to = ((y + labelHeight + row) * sheet.width + (x + col)) * 4;
        sheet.data[to] = source.data[from];
        sheet.data[to + 1] = source.data[from + 1];
        sheet.data[to + 2] = source.data[from + 2];
        sheet.data[to + 3] = 255;
      }
    }
  });
  writeFileSync(file, PNG.sync.write(sheet));
}

export function ratioDiff(a: PNG, b: PNG): number {
  if (a.width !== b.width || a.height !== b.height) return 1;
  let changed = 0;
  for (let index = 0; index < a.data.length; index += 4) {
    if (
      Math.abs(a.data[index] - b.data[index]) > 4 ||
      Math.abs(a.data[index + 1] - b.data[index + 1]) > 4 ||
      Math.abs(a.data[index + 2] - b.data[index + 2]) > 4
    ) {
      changed += 1;
    }
  }
  return changed / (a.width * a.height);
}

export function imageMetrics(image: PNG): { meanLuma: number; colors: number } {
  const seen = new Set<number>();
  let luma = 0;
  for (let index = 0; index < image.data.length; index += 4) {
    const r = image.data[index];
    const g = image.data[index + 1];
    const b = image.data[index + 2];
    luma += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (seen.size < 512) seen.add(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3));
  }
  return { meanLuma: luma / (image.width * image.height), colors: seen.size };
}

export async function waitForHttp(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Server is still booting.
    }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

export function startDevServer(root: string, port: number): ChildProcess {
  const child = spawn(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["run", "dev", "--", "--port", String(port), "--strictPort", "--host", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stdout?.on("data", (data: Buffer) => {
    const text = data.toString();
    if (/error/i.test(text)) process.stderr.write(text);
  });
  child.stderr?.on("data", (data: Buffer) => process.stderr.write(data));
  return child;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Replicates Renderer.buildSky so captured frames can be classified per pixel.
 * A palette change in the renderer must be mirrored here.
 */
export function skyRowsForHeight(height: number): Uint8Array {
  const rows = new Uint8Array(height * 3);
  for (let y = 0; y < height; y += 1) {
    const t = y / height;
    const top = [10, 12, 22];
    const mid = [30, 27, 46];
    const horizon = [84, 58, 63];
    const warm = clamp(1 - Math.abs(t - 0.62) * 5, 0, 1);
    const a = clamp(t / 0.72, 0, 1);
    const r = top[0] + (mid[0] - top[0]) * a + horizon[0] * warm * 0.55;
    const g = top[1] + (mid[1] - top[1]) * a + horizon[1] * warm * 0.45;
    const b = top[2] + (mid[2] - top[2]) * a + horizon[2] * warm * 0.35;
    rows[y * 3] = clamp(r, 0, 255);
    rows[y * 3 + 1] = clamp(g, 0, 255);
    rows[y * 3 + 2] = clamp(b, 0, 255);
  }
  return rows;
}

function isSkyPixel(image: PNG, sky: Uint8Array, x: number, y: number): boolean {
  const offset = (y * image.width + x) * 4;
  return (
    image.data[offset] === sky[y * 3] &&
    image.data[offset + 1] === sky[y * 3 + 1] &&
    image.data[offset + 2] === sky[y * 3 + 2]
  );
}

export interface SkyHoleReport {
  skyPixels: number;
  holePixels: number;
  holeColumns: number;
  maxRun: number;
}

/**
 * Sky may only be a prefix of a column: once a column draws geometry it can
 * never show background again. A run of 2+ sky pixels below geometry that is
 * later closed by more geometry is a hole through the floor, a missing wall
 * face, or a bad vertical span. Sky running to the bottom edge is the void
 * beyond the floating map and is ignored.
 */
export function analyzeSkyHoles(image: PNG, sky = skyRowsForHeight(image.height)): SkyHoleReport {
  const report: SkyHoleReport = {
    skyPixels: 0,
    holePixels: 0,
    holeColumns: 0,
    maxRun: 0,
  };
  for (let x = 0; x < image.width; x += 1) {
    let sawGeometry = false;
    let run = 0;
    for (let y = 0; y < image.height; y += 1) {
      if (isSkyPixel(image, sky, x, y)) {
        report.skyPixels += 1;
        if (sawGeometry) run += 1;
        continue;
      }
      if (run >= 2) {
        report.holePixels += run;
        report.holeColumns += 1;
        report.maxRun = Math.max(report.maxRun, run);
      }
      run = 0;
      sawGeometry = true;
    }
  }
  return report;
}

export interface SilhouetteReport {
  columns: number;
  skipped: number;
  maxResidual: number;
  slope: number;
  topRowMin: number;
  topRowMax: number;
}

/**
 * Fits the first non-sky row across a column band. A straight wall top under
 * pitch must project to a straight line; shear-based projection bends it.
 */
export function analyzeSilhouette(
  image: PNG,
  x0: number,
  x1: number,
  sky = skyRowsForHeight(image.height),
): SilhouetteReport {
  const xs: number[] = [];
  const ys: number[] = [];
  let skipped = 0;
  for (let x = x0; x <= x1; x += 1) {
    let top = -1;
    for (let y = 0; y < image.height; y += 1) {
      if (!isSkyPixel(image, sky, x, y)) {
        top = y;
        break;
      }
    }
    if (top <= 0 || top >= image.height - 1) {
      skipped += 1;
      continue;
    }
    xs.push(x);
    ys.push(top);
  }
  if (xs.length < 2) {
    return {
      columns: 0,
      skipped,
      maxResidual: Infinity,
      slope: 0,
      topRowMin: 0,
      topRowMax: 0,
    };
  }
  const meanX = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const meanY = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < xs.length; index += 1) {
    numerator += (xs[index] - meanX) * (ys[index] - meanY);
    denominator += (xs[index] - meanX) ** 2;
  }
  const slope = denominator === 0 ? 0 : numerator / denominator;
  const intercept = meanY - slope * meanX;
  let maxResidual = 0;
  for (let index = 0; index < xs.length; index += 1) {
    const fitted = intercept + slope * xs[index];
    maxResidual = Math.max(maxResidual, Math.abs(ys[index] - fitted));
  }
  return {
    columns: xs.length,
    skipped,
    maxResidual,
    slope,
    topRowMin: Math.min(...ys),
    topRowMax: Math.max(...ys),
  };
}
