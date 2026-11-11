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

brickTexture();
panelTexture();
floorTexture();
