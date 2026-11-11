import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { PNG } from "pngjs";

const SIZE = 64;
const OUT = resolve("public/assets/textures");

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp255(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : Math.round(value);
}

function writePng(name: string, data: (x: number, y: number) => [number, number, number]): void {
  const png = new PNG({ width: SIZE, height: SIZE });
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const [r, g, b] = data(x, y);
      const idx = (y * SIZE + x) * 4;
      png.data[idx] = clamp255(r);
      png.data[idx + 1] = clamp255(g);
      png.data[idx + 2] = clamp255(b);
      png.data[idx + 3] = 255;
    }
  }
  const target = resolve(OUT, name);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, PNG.sync.write(png));
  console.log(`wrote ${target}`);
}

function brickTexture(): void {
  const rng = mulberry32(1337);
  const tint = new Map<string, number>();
  const brickHeight = 16;
  const brickWidth = 32;
  const mortar = 2;

  writePng("brick.png", (x, y) => {
    const row = Math.floor(y / brickHeight);
    const offset = row % 2 === 0 ? 0 : brickWidth / 2;
    const localX = (x + offset) % brickWidth;
    const localY = y % brickHeight;
    const isMortar = localX < mortar || localY < mortar;
    const noise = (rng() - 0.5) * 18;

    if (isMortar) {
      return [40 + noise, 33 + noise, 36 + noise];
    }

    const col = Math.floor((x + offset) / brickWidth);
    const key = `${row}:${col}`;
    if (!tint.has(key)) tint.set(key, (rng() - 0.5) * 26);
    const variation = tint.get(key)!;

    const bevel =
      localY < mortar + 2 ? 18 : localY > brickHeight - 3 ? -16 : 0;

    return [
      104 + variation + noise + bevel,
      72 + variation * 0.8 + noise + bevel,
      64 + variation * 0.6 + noise + bevel,
    ];
  });
}

function panelTexture(): void {
  const rng = mulberry32(4242);
  const rivets = [
    [6, 6],
    [57, 6],
    [6, 57],
    [57, 57],
    [32, 32],
  ];

  writePng("panel.png", (x, y) => {
    const seam = x < 2 || y < 2 || x > 61 || y > 61;
    const brushed = (rng() - 0.5) * 10;
    const gradient = 10 - (y / SIZE) * 18;

    let r = 46 + brushed + gradient;
    let g = 72 + brushed + gradient;
    let b = 80 + brushed + gradient;

    if (seam) {
      r -= 26;
      g -= 30;
      b -= 30;
    }

    for (const [rx, ry] of rivets) {
      const d = Math.hypot(x - rx, y - ry);
      if (d < 1.6) {
        r += 26;
        g += 30;
        b += 30;
      } else if (d < 2.6) {
        r -= 18;
        g -= 18;
        b -= 18;
      }
    }

    return [r, g, b];
  });
}

function floorTexture(): void {
  const rng = mulberry32(9001);
  const tile = 32;
  const grout = 2;

  writePng("floor.png", (x, y) => {
    const localX = x % tile;
    const localY = y % tile;
    const isGrout = localX < grout || localY < grout;
    const noise = (rng() - 0.5) * 14;

    if (isGrout) {
      return [26 + noise, 27 + noise, 32 + noise];
    }

    const checker = (Math.floor(x / tile) + Math.floor(y / tile)) % 2;
    const base = checker === 0 ? 64 : 56;
    const speckle = rng() > 0.94 ? 18 : 0;
    const crack =
      Math.abs(localX - localY * 0.6 - 12) < 0.7 && localX > 6 ? -22 : 0;

    return [
      base + noise + speckle + crack,
      base + 2 + noise + speckle + crack,
      base + 6 + noise + speckle + crack,
    ];
  });
}

const PROP_SIZE = 32;

function writePropPng(
  name: string,
  data: (x: number, y: number) => [number, number, number, number],
): void {
  const png = new PNG({ width: PROP_SIZE, height: PROP_SIZE });
  for (let y = 0; y < PROP_SIZE; y += 1) {
    for (let x = 0; x < PROP_SIZE; x += 1) {
      const [r, g, b, a] = data(x, y);
      const idx = (y * PROP_SIZE + x) * 4;
      png.data[idx] = clamp255(r);
      png.data[idx + 1] = clamp255(g);
      png.data[idx + 2] = clamp255(b);
      png.data[idx + 3] = clamp255(a);
    }
  }
  const target = resolve(OUT, name);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, PNG.sync.write(png));
  console.log(`wrote ${target}`);
}

function insideRoundedRect(
  x: number,
  y: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
  radius: number,
): boolean {
  if (x < left || x > right || y < top || y > bottom) return false;
  const cx = Math.min(Math.max(x, left + radius), right - radius);
  const cy = Math.min(Math.max(y, top + radius), bottom - radius);
  return Math.hypot(x - cx, y - cy) <= radius;
}

function keycardProp(): void {
  writePropPng("keycard.png", (x, y) => {
    const shell = insideRoundedRect(x, y, 3, 7, 28, 24, 3);
    if (!shell) {
      const halo = insideRoundedRect(x, y, 2, 6, 29, 25, 4);
      return halo ? [110, 224, 239, 80] : [0, 0, 0, 0];
    }
    const inner = insideRoundedRect(x, y, 6, 10, 25, 21, 2);
    const stripe = y >= 16 && y <= 18;
    const chip = x >= 10 && x <= 14 && y >= 12 && y <= 15;
    if (chip) return [240, 201, 135, 255];
    if (stripe) return [29, 140, 162, 255];
    if (inner) return [47, 184, 207, 255];
    return [11, 58, 69, 255];
  });
}

function medkitProp(): void {
  writePropPng("medkit.png", (x, y) => {
    const shell = insideRoundedRect(x, y, 4, 6, 27, 27, 3);
    if (!shell) return [0, 0, 0, 0];
    const handle = y >= 4 && y <= 8 && x >= 12 && x <= 19;
    if (handle) return [91, 147, 173, 255];
    const crossV = x >= 14 && x <= 17 && y >= 11 && y <= 23;
    const crossH = y >= 16 && y <= 19 && x >= 9 && x <= 22;
    if (crossV || crossH) return [240, 228, 200, 255];
    return [38, 45, 58, 255];
  });
}

function fuelProp(): void {
  writePropPng("fuel.png", (x, y) => {
    const shell = insideRoundedRect(x, y, 8, 6, 23, 28, 3);
    if (!shell) return [0, 0, 0, 0];
    const cap = y >= 3 && y <= 6 && x >= 12 && x <= 19;
    if (cap) return [74, 85, 104, 255];
    const band = y >= 15 && y <= 20;
    if (band) return [47, 184, 207, 255];
    const highlight = x <= 11 && y <= 22;
    return highlight ? [139, 154, 179, 255] : [63, 111, 136, 255];
  });
}

function beaconProp(): void {
  const beam = [
    [0, 224, 239],
    [108, 199, 195],
    [240, 201, 135],
  ] as const;
  writePropPng("beacon.png", (x, y) => {
    if (y < 24) {
      const center = 15.5;
      const width = 3 + (y / 24) * 6;
      const d = Math.abs(x - center);
      if (d > width) return [0, 0, 0, 0];
      const alpha = Math.round(180 * (1 - d / width) * (1 - y / 30));
      return [beam[0][0], beam[0][1], beam[0][2], alpha];
    }
    const ring = Math.hypot((x - 15.5) / 14, (y - 26) / 4);
    if (ring <= 1 && ring >= 0.55) {
      return [240, 201, 135, 220];
    }
    return [0, 0, 0, 0];
  });
}

function doorTexture(): void {
  const rng = mulberry32(6060);
  writePng("door.png", (x, y) => {
    const frame = x < 4 || x > 59 || y < 4 || y > 59;
    const seam = Math.abs(x - 32) < 1.6;
    const hazard =
      y > 46 && y < 56 && Math.floor((x + y) / 8) % 2 === 0;
    const keypad = x > 46 && x < 56 && y > 12 && y < 28;
    const keyLight = x > 49 && x < 53 && y > 15 && y < 19;
    const noise = (rng() - 0.5) * 8;

    if (frame) return [26 + noise, 31 + noise, 41 + noise];
    if (seam) return [7, 9, 13];
    if (keyLight) return [110, 224, 239];
    if (keypad) return [16, 19, 26];
    if (hazard) return [217, 164, 90];
    return [43 + noise, 77 + noise, 99 + noise];
  });
}

brickTexture();
panelTexture();
floorTexture();
keycardProp();
medkitProp();
fuelProp();
beaconProp();
doorTexture();

