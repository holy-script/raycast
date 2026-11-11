import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { PNG } from "pngjs";
import { downsample } from "../stylize/image";
import {
  alphaMask,
  colorDistance,
  dilateMask,
  intersectionOverUnion,
  meanOpaqueColor,
  medianColor,
  type Rgb,
} from "./metrics";

const DEFAULT_CHARACTERS = ["guardian"];
const DEFAULT_MIN_IOU = 0.98;
const DEFAULT_MAX_DRIFT = 12;
const FRAME_PATTERN = /^([a-z]+)_f(\d+)_p(\d+)_y(\d+)\.png$/;

interface Options {
  characters: string[];
  minIou: number;
  maxDrift: number;
  tolerance: number;
  jsonPath: string;
  quiet: boolean;
}

interface FrameData {
  key: string;
  state: string;
  frame: number;
  pitch: number;
  yaw: number;
  color: Rgb;
}

interface FrameReport {
  key: string;
  iou: number;
  drift: number;
}

interface CharacterReport {
  character: string;
  frames: number;
  compared: number;
  missing: string[];
  meanIou: number;
  minIou: number;
  meanDrift: number;
  maxDrift: number;
  medianColor: Rgb | null;
  worstIou: { key: string; value: number } | null;
  worstDrift: { key: string; value: number } | null;
  failures: string[];
}

interface StyleReport {
  version: 2;
  generatedAt: string;
  thresholds: { minIou: number; maxDrift: number; tolerance: number };
  characters: CharacterReport[];
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    characters: [],
    minIou: DEFAULT_MIN_IOU,
    maxDrift: DEFAULT_MAX_DRIFT,
    tolerance: 1,
    jsonPath: resolve("artifacts/style-report.json"),
    quiet: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      options.characters.push(arg);
      continue;
    }
    const inline = arg.match(/^--[a-z-]+=(.*)$/);
    const flag = arg.split("=")[0];
    const value = (): string => {
      if (inline) return inline[1];
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new Error(`${flag} expects a value`);
      }
      i += 1;
      return next;
    };
    switch (flag) {
      case "--min-iou":
        options.minIou = Number(value());
        break;
      case "--max-drift":
        options.maxDrift = Number(value());
        break;
      case "--tolerance":
        options.tolerance = Number.parseInt(value(), 10);
        break;
      case "--json":
        options.jsonPath = resolve(value());
        break;
      case "--quiet":
        options.quiet = true;
        break;
      default:
        throw new Error(`Unknown flag ${flag}`);
    }
  }
  if (options.characters.length === 0) options.characters = [...DEFAULT_CHARACTERS];
  if (!Number.isInteger(options.tolerance) || options.tolerance < 0 || options.tolerance > 3) {
    throw new Error("--tolerance must be 0, 1, 2, or 3");
  }
  return options;
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Palette drift compares each frame's mean colour with the average of its two
 * yaw neighbours. Neighbouring views show almost the same surfaces, so a jump
 * means the generator changed costume colours between angles. Comparing every
 * frame to one atlas-wide average would wrongly flag legitimate front/back and
 * top-down differences.
 */
function attachDrift(frames: FrameData[]): FrameReport[] {
  const groups = new Map<string, FrameData[]>();
  for (const frame of frames) {
    const group = `${frame.state}_f${frame.frame}_p${frame.pitch}`;
    const list = groups.get(group) ?? [];
    list.push(frame);
    groups.set(group, list);
  }
  const reports: FrameReport[] = [];
  for (const group of groups.values()) {
    group.sort((left, right) => left.yaw - right.yaw);
    group.forEach((frame, index) => {
      const neighbours = [
        group[(index - 1 + group.length) % group.length],
        group[(index + 1) % group.length],
      ].filter((neighbour) => neighbour !== frame);
      if (neighbours.length === 0) {
        reports.push({ key: frame.key, iou: 0, drift: 0 });
        return;
      }
      const average: Rgb = {
        r: mean(neighbours.map((neighbour) => neighbour.color.r)),
        g: mean(neighbours.map((neighbour) => neighbour.color.g)),
        b: mean(neighbours.map((neighbour) => neighbour.color.b)),
      };
      reports.push({
        key: frame.key,
        iou: 0,
        drift: colorDistance(frame.color, average),
      });
    });
  }
  return reports;
}

function verifyCharacter(name: string, options: Options): CharacterReport {
  const framesDir = resolve(`public/assets/sprites/${name}/frames`);
  const rawDir = resolve(`assets-src/characters/${name}/raw`);
  let files: string[];
  try {
    files = readdirSync(framesDir).filter((file) => file.endsWith(".png")).sort();
  } catch {
    throw new Error(
      `No stylized frames in ${framesDir}. Run "npm run assets:stylize" or "npm run assets:comfy" first.`,
    );
  }

  const frames: FrameData[] = [];
  const missing: string[] = [];
  const masks = new Map<string, { stylized: Uint8Array; width: number; height: number }>();

  for (const file of files) {
    const key = file.replace(/\.png$/, "");
    const frame = PNG.sync.read(readFileSync(join(framesDir, file)));
    if (frame.width !== frame.height) {
      throw new Error(`${name} ${key} is not square (${frame.width}x${frame.height})`);
    }
    const color = meanOpaqueColor(frame);
    if (!color) continue;

    const match = FRAME_PATTERN.exec(file);
    if (!match) {
      throw new Error(`${name} has an unrecognized frame name: ${file}`);
    }
    const [, state, frameIndex, pitch, yaw] = match;
    frames.push({
      key,
      state,
      frame: Number(frameIndex),
      pitch: Number(pitch),
      yaw: Number(yaw),
      color,
    });
    masks.set(key, {
      stylized: alphaMask(frame),
      width: frame.width,
      height: frame.height,
    });
  }

  const driftReports = attachDrift(frames);
  const driftByKey = new Map(driftReports.map((report) => [report.key, report.drift]));

  const reports: FrameReport[] = [];
  for (const frame of frames) {
    const mask = masks.get(frame.key);
    if (!mask) continue;
    let raw: PNG;
    try {
      raw = PNG.sync.read(readFileSync(join(rawDir, `${frame.key}.png`)));
    } catch {
      missing.push(frame.key);
      continue;
    }
    const scaledRaw = downsample(raw, mask.width, mask.height);
    let rawMask = alphaMask(scaledRaw);
    for (let step = 0; step < options.tolerance; step += 1) {
      rawMask = dilateMask(rawMask, mask.width, mask.height);
    }
    reports.push({
      key: frame.key,
      iou: intersectionOverUnion(mask.stylized, rawMask),
      drift: driftByKey.get(frame.key) ?? 0,
    });
  }

  const ious = reports.map((report) => report.iou);
  const drifts = [...driftByKey.values()];
  const worstIou = reports.reduce<FrameReport | null>(
    (worst, report) => (!worst || report.iou < worst.iou ? report : worst),
    null,
  );
  const worstDriftReport = driftReports.reduce<FrameReport | null>(
    (worst, report) => (!worst || report.drift > worst.drift ? report : worst),
    null,
  );

  const failures: string[] = [];
  if (files.length === 0) failures.push("no stylized frames");
  if (frames.length === 0) failures.push("no opaque stylized frames");
  if (reports.length === 0) failures.push("no comparable frames with raw renders");
  if (missing.length > 0) {
    failures.push(
      `${missing.length} frame(s) missing raw renders: ${missing.slice(0, 3).join(", ")}`,
    );
  }
  if (worstIou && worstIou.iou < options.minIou) {
    failures.push(
      `silhouette IoU ${worstIou.iou.toFixed(3)} on ${worstIou.key} < ${options.minIou}`,
    );
  }
  if (drifts.length > 0 && mean(drifts) > options.maxDrift) {
    failures.push(
      `mean palette drift ${mean(drifts).toFixed(1)} > ${options.maxDrift} ` +
        `(worst ${worstDriftReport?.key ?? "-"})`,
    );
  }

  return {
    character: name,
    frames: frames.length,
    compared: reports.length,
    missing,
    meanIou: mean(ious),
    minIou: worstIou?.iou ?? 0,
    meanDrift: mean(drifts),
    maxDrift: worstDriftReport?.drift ?? 0,
    medianColor: medianColor(frames.map((frame) => frame.color)),
    worstIou: worstIou ? { key: worstIou.key, value: worstIou.iou } : null,
    worstDrift: worstDriftReport
      ? { key: worstDriftReport.key, value: worstDriftReport.drift }
      : null,
    failures,
  };
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const characters = options.characters.map((name) => verifyCharacter(name, options));
  const report: StyleReport = {
    version: 2,
    generatedAt: new Date().toISOString(),
    thresholds: {
      minIou: options.minIou,
      maxDrift: options.maxDrift,
      tolerance: options.tolerance,
    },
    characters,
  };

  mkdirSync(dirname(options.jsonPath), { recursive: true });
  writeFileSync(options.jsonPath, `${JSON.stringify(report, null, 2)}\n`);

  if (!options.quiet) {
    console.log(
      "character  frames  compared  meanIoU  minIoU  meanDrift  maxDrift  worst IoU / drift",
    );
    for (const character of characters) {
      const worst = [
        character.worstIou
          ? `${character.worstIou.key} ${character.worstIou.value.toFixed(3)}`
          : "-",
        character.worstDrift
          ? `${character.worstDrift.key} ${character.worstDrift.value.toFixed(1)}`
          : "-",
      ].join(" / ");
      console.log(
        `${character.character.padEnd(9)}  ${String(character.frames).padStart(6)}  ` +
          `${String(character.compared).padStart(8)}  ${character.meanIou.toFixed(3)}    ` +
          `${character.minIou.toFixed(3)}   ${character.meanDrift.toFixed(1).padStart(7)}   ` +
          `${character.maxDrift.toFixed(1).padStart(6)}   ${worst}`,
      );
    }
    console.log(`report: ${options.jsonPath}`);
  }

  const failures = characters.flatMap((character) =>
    character.failures.map((failure) => `${character.character}: ${failure}`),
  );
  if (failures.length > 0) {
    console.error(`style verification failed:\n- ${failures.join("\n- ")}`);
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  console.error(`error: ${(error as Error).message}`);
  process.exitCode = 1;
}
