import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PNG } from "pngjs";
import { ComfyClient, normalizeEndpoint } from "../comfy/client";
import { fillWorkflow, validateWorkflow, type WorkflowTemplate } from "../comfy/workflow";
import { downsample } from "./image";
import { stylize as paletteStylize } from "./pixel-art";

const FRAME_SIZE = 96;
const FRAME_PATTERN = /^([a-z]+)_f(\d+)_p(\d+)_y(\d+)\.png$/;
const DEFAULT_CHARACTERS = ["guardian"];

const DESCRIPTORS: Record<string, string> = {
  guardian: "bulky guardian robot with a rust jacket, teal trousers and a bright teal visor",
};

const DEFAULT_STYLE =
  "pixel art, limited teal and orange palette, flat shading, crisp one pixel dark outline, transparent background, no ground shadow";

const DEFAULT_NEGATIVE =
  "blurry, photorealistic, 3d render, background scenery, text, watermark, extra limbs, cropped, motion blur, low contrast, jpeg artifacts";

interface FrameRef {
  key: string;
  state: string;
  frame: number;
  pitch: number;
  yaw: number;
}

interface Options {
  characters: string[];
  endpoint: string;
  checkpoint: string;
  controlnet: string;
  workflow: string;
  prompt: string | null;
  style: string;
  negative: string;
  seed: number;
  steps: number;
  cfg: number;
  denoise: number;
  strength: number;
  startPercent: number;
  endPercent: number;
  timeoutSeconds: number;
  only: string[];
  limit: number;
  resume: boolean;
  concurrency: number;
  dryRun: boolean;
  palette: boolean;
  fallback: boolean;
  outline: boolean;
  rawDir: string | null;
  controlDir: string | null;
  outDir: string | null;
}

interface CharacterDirs {
  name: string;
  raw: string;
  control: string;
  out: string;
}

function parseNumber(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${flag} expects a number, got "${value}"`);
  return parsed;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    characters: [],
    endpoint: process.env.COMFY_ENDPOINT ?? "http://127.0.0.1:8188",
    checkpoint: process.env.COMFY_CHECKPOINT ?? "",
    controlnet: process.env.COMFY_CONTROLNET ?? "",
    workflow: resolve("tools/comfy/workflow_api.json"),
    prompt: null,
    style: DEFAULT_STYLE,
    negative: DEFAULT_NEGATIVE,
    seed: 1337,
    steps: 20,
    cfg: 5.5,
    denoise: 0.55,
    strength: 0.85,
    startPercent: 0,
    endPercent: 1,
    timeoutSeconds: 300,
    only: [],
    limit: 0,
    resume: false,
    concurrency: 1,
    dryRun: false,
    palette: false,
    fallback: false,
    outline: true,
    rawDir: null,
    controlDir: null,
    outDir: null,
  };

  const takeValue = (flag: string, index: number): [string, number] => {
    const inline = argv[index].match(/^--[a-z-]+=(.*)$/);
    if (inline) return [inline[1], index];
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      throw new Error(`${flag} expects a value`);
    }
    return [next, index + 1];
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      options.characters.push(arg);
      continue;
    }
    const flag = arg.split("=")[0];
    switch (flag) {
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--palette":
        options.palette = true;
        break;
      case "--fallback":
        options.fallback = true;
        break;
      case "--resume":
        options.resume = true;
        break;
      case "--no-outline":
        options.outline = false;
        break;
      case "--endpoint": {
        [options.endpoint, i] = takeValue(flag, i);
        break;
      }
      case "--checkpoint": {
        [options.checkpoint, i] = takeValue(flag, i);
        break;
      }
      case "--controlnet": {
        [options.controlnet, i] = takeValue(flag, i);
        break;
      }
      case "--workflow": {
        let value: string;
        [value, i] = takeValue(flag, i);
        options.workflow = resolve(value);
        break;
      }
      case "--prompt": {
        let value: string;
        [value, i] = takeValue(flag, i);
        options.prompt = value;
        break;
      }
      case "--style": {
        [options.style, i] = takeValue(flag, i);
        break;
      }
      case "--negative": {
        [options.negative, i] = takeValue(flag, i);
        break;
      }
      case "--seed": {
        let value: string;
        [value, i] = takeValue(flag, i);
        options.seed = parseNumber(value, flag);
        break;
      }
      case "--steps": {
        let value: string;
        [value, i] = takeValue(flag, i);
        options.steps = parseNumber(value, flag);
        break;
      }
      case "--cfg": {
        let value: string;
        [value, i] = takeValue(flag, i);
        options.cfg = parseNumber(value, flag);
        break;
      }
      case "--denoise": {
        let value: string;
        [value, i] = takeValue(flag, i);
        options.denoise = parseNumber(value, flag);
        break;
      }
      case "--strength": {
        let value: string;
        [value, i] = takeValue(flag, i);
        options.strength = parseNumber(value, flag);
        break;
      }
      case "--start": {
        let value: string;
        [value, i] = takeValue(flag, i);
        options.startPercent = parseNumber(value, flag);
        break;
      }
      case "--end": {
        let value: string;
        [value, i] = takeValue(flag, i);
        options.endPercent = parseNumber(value, flag);
        break;
      }
      case "--timeout": {
        let value: string;
        [value, i] = takeValue(flag, i);
        options.timeoutSeconds = parseNumber(value, flag);
        break;
      }
      case "--limit": {
        let value: string;
        [value, i] = takeValue(flag, i);
        options.limit = parseNumber(value, flag);
        break;
      }
      case "--concurrency": {
        let value: string;
        [value, i] = takeValue(flag, i);
        options.concurrency = parseNumber(value, flag);
        break;
      }
      case "--only": {
        let value: string;
        [value, i] = takeValue(flag, i);
        options.only.push(...value.split(",").filter(Boolean));
        break;
      }
      case "--raw": {
        let value: string;
        [value, i] = takeValue(flag, i);
        options.rawDir = resolve(value);
        break;
      }
      case "--control": {
        let value: string;
        [value, i] = takeValue(flag, i);
        options.controlDir = resolve(value);
        break;
      }
      case "--out": {
        let value: string;
        [value, i] = takeValue(flag, i);
        options.outDir = resolve(value);
        break;
      }
      default:
        throw new Error(`Unknown flag ${flag}. Run with --dry-run to see the plan.`);
    }
  }

  if (options.characters.length === 0) options.characters = [...DEFAULT_CHARACTERS];
  if (options.concurrency < 1) throw new Error("--concurrency must be at least 1");
  return options;
}

function characterDirs(name: string, options: Options): CharacterDirs {
  return {
    name,
    raw: options.rawDir ?? resolve(`assets-src/characters/${name}/raw`),
    control: options.controlDir ?? resolve(`assets-src/characters/${name}/control/depth`),
    out: options.outDir ? resolve(options.outDir, name) : resolve(`public/assets/sprites/${name}/frames`),
  };
}

function matchesOnly(frame: FrameRef, only: string[]): boolean {
  if (only.length === 0) return true;
  return only.some((selector) => {
    const parts = selector.split(":");
    const actual = [frame.state, String(frame.frame), String(frame.pitch), String(frame.yaw)];
    return parts.every((part, index) => part === "" || part === "*" || part === actual[index]);
  });
}

function listFrames(dirs: CharacterDirs, options: Options): FrameRef[] {
  let files: string[];
  try {
    files = readdirSync(dirs.raw).filter((file) => file.endsWith(".png"));
  } catch {
    throw new Error(
      `No raw renders in ${dirs.raw}. Run "npm run assets:blender" before "npm run assets:comfy".`,
    );
  }
  const frames: FrameRef[] = [];
  for (const file of files.sort()) {
    const match = FRAME_PATTERN.exec(file);
    if (!match) continue;
    const [, state, frame, pitch, yaw] = match;
    const ref: FrameRef = {
      key: file.replace(/\.png$/, ""),
      state,
      frame: Number(frame),
      pitch: Number(pitch),
      yaw: Number(yaw),
    };
    if (matchesOnly(ref, options.only)) frames.push(ref);
  }
  const selected = options.resume
    ? frames.filter((frame) => !existsSync(join(dirs.out, `${frame.key}.png`)))
    : frames;
  const limited = options.limit > 0 ? selected.slice(0, options.limit) : selected;
  if (limited.length === 0) {
    const suffix = options.resume ? " (all matching outputs already exist)" : "";
    throw new Error(`No frames matched in ${dirs.raw}${suffix}`);
  }
  return limited;
}

function buildPrompt(character: string, options: Options): string {
  if (options.prompt) return options.prompt;
  const descriptor = DESCRIPTORS[character] ?? `${character} sci-fi robot`;
  return `pixel art game sprite of a ${descriptor}, full body, centered, orthographic, ${options.style}`;
}

function applyOutline(png: PNG): void {
  const width = png.width;
  const height = png.height;
  const solid = new Uint8Array(width * height);
  for (let i = 0; i < solid.length; i += 1) {
    solid[i] = png.data[i * 4 + 3] >= 128 ? 1 : 0;
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
      png.data[idx] = 7;
      png.data[idx + 1] = 9;
      png.data[idx + 2] = 13;
      png.data[idx + 3] = 255;
    }
  }
}

/**
 * The generated frame shares the Blender silhouette, so the raw alpha mask is
 * the authority for cutout. That removes black/white fringes around the sprite
 * and keeps every generated angle inside the same bounds as the source render.
 */
function finalizeFrame(generated: PNG, raw: PNG, outline: boolean): PNG {
  if (generated.width < FRAME_SIZE || generated.height < FRAME_SIZE) {
    throw new Error(
      `Generated image is ${generated.width}x${generated.height}; need at least ${FRAME_SIZE}x${FRAME_SIZE}`,
    );
  }
  const art = downsample(generated, FRAME_SIZE, FRAME_SIZE);
  const mask = downsample(raw, FRAME_SIZE, FRAME_SIZE);
  const out = new PNG({ width: FRAME_SIZE, height: FRAME_SIZE });
  for (let i = 0; i < FRAME_SIZE * FRAME_SIZE; i += 1) {
    const dst = i * 4;
    if (mask.data[dst + 3] < 128) {
      out.data[dst] = 0;
      out.data[dst + 1] = 0;
      out.data[dst + 2] = 0;
      out.data[dst + 3] = 0;
      continue;
    }
    out.data[dst] = art.data[dst];
    out.data[dst + 1] = art.data[dst + 1];
    out.data[dst + 2] = art.data[dst + 2];
    out.data[dst + 3] = 255;
  }
  if (outline) applyOutline(out);
  return out;
}

async function mapLimit<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

function writePaletteFrame(rawPath: string, outPath: string): void {
  const raw = PNG.sync.read(readFileSync(rawPath));
  writeFileSync(outPath, PNG.sync.write(paletteStylize(raw)));
}

function loadWorkflow(path: string): WorkflowTemplate {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Workflow ${path} is not an API-format object`);
  }
  const problems = validateWorkflow(parsed as WorkflowTemplate);
  if (problems.length > 0) {
    throw new Error(`Invalid workflow ${path}:\n- ${problems.join("\n- ")}`);
  }
  return parsed as WorkflowTemplate;
}

function workflowValues(
  dirs: CharacterDirs,
  frame: FrameRef,
  options: Options,
  rawName: string,
  controlName: string,
): Record<string, string | number> {
  return {
    __CHECKPOINT__: options.checkpoint,
    __CONTROLNET__: options.controlnet,
    __INPUT_IMAGE__: rawName,
    __CONTROL_IMAGE__: controlName,
    __POSITIVE__: buildPrompt(dirs.name, options),
    __NEGATIVE__: options.negative,
    __SEED__: options.seed,
    __STEPS__: options.steps,
    __CFG__: options.cfg,
    __DENOISE__: options.denoise,
    __STRENGTH__: options.strength,
    __START_PERCENT__: options.startPercent,
    __END_PERCENT__: options.endPercent,
    __FILENAME_PREFIX__: `raycast_${dirs.name}_${frame.key}`,
  };
}

function printPlan(
  dirs: CharacterDirs,
  frames: FrameRef[],
  options: Options,
  missingControls: string[],
): void {
  const endpoint = normalizeEndpoint(options.endpoint);
  console.log(`character: ${dirs.name}`);
  console.log(`  raw:     ${dirs.raw}`);
  console.log(`  control: ${dirs.control}`);
  console.log(`  out:     ${dirs.out}`);
  console.log(`  frames:  ${frames.length}${options.resume ? " (remaining; resume skips existing outputs)" : ""}`);
  console.log(`  workflow: ${options.workflow}`);
  console.log(`  endpoint: ${endpoint}`);
  console.log(`  checkpoint: ${options.checkpoint || "<not set>"}`);
  console.log(`  controlnet: ${options.controlnet || "<not set>"}`);
  console.log(`  seed: ${options.seed}, steps: ${options.steps}, cfg: ${options.cfg}`);
  console.log(`  denoise: ${options.denoise}, control strength: ${options.strength}`);
  console.log(`  prompt: ${buildPrompt(dirs.name, options)}`);
  console.log(`  negative: ${options.negative}`);
  if (missingControls.length > 0) {
    console.warn(
      `  missing ${missingControls.length} depth control image(s), e.g. ${missingControls[0]}`,
    );
  }
  const sample = frames.slice(0, 5).map((frame) => frame.key);
  console.log(`  sample: ${sample.join(", ")}${frames.length > sample.length ? ", …" : ""}`);
}

async function runComfy(
  dirs: CharacterDirs,
  frames: FrameRef[],
  options: Options,
  template: WorkflowTemplate,
): Promise<void> {
  if (!options.checkpoint) {
    throw new Error("Set --checkpoint (or COMFY_CHECKPOINT) to a checkpoint filename");
  }
  if (!options.controlnet) {
    throw new Error("Set --controlnet (or COMFY_CONTROLNET) to a depth ControlNet filename");
  }
  const missingControls = frames
    .map((frame) => join(dirs.control, `${frame.key}.png`))
    .filter((path) => !existsSync(path));
  if (missingControls.length > 0) {
    throw new Error(
      `Missing ${missingControls.length} depth control image(s), e.g. ${missingControls[0]}. ` +
        'Run "npm run assets:blender" with control passes enabled (the default).',
    );
  }

  const client = new ComfyClient({
    endpoint: options.endpoint,
    timeoutMs: options.timeoutSeconds * 1000,
  });
  if (!(await client.isReachable())) {
    throw new Error(
      `ComfyUI is not reachable at ${normalizeEndpoint(options.endpoint)}. ` +
        "Start ComfyUI, or rerun with --palette or --fallback.",
    );
  }

  mkdirSync(dirs.out, { recursive: true });
  const clientId = `raycast-${process.pid}`;
  let done = 0;
  let failed = 0;

  await mapLimit(frames, options.concurrency, async (frame) => {
    const rawPath = join(dirs.raw, `${frame.key}.png`);
    const controlPath = join(dirs.control, `${frame.key}.png`);
    const outPath = join(dirs.out, `${frame.key}.png`);
    const label = `${dirs.name} ${frame.key}`;

    try {
      const rawName = `raycast_${dirs.name}_raw_${frame.key}.png`;
      const controlName = `raycast_${dirs.name}_depth_${frame.key}.png`;
      const [rawUpload, controlUpload] = await Promise.all([
        client.uploadImage(rawPath, rawName),
        client.uploadImage(controlPath, controlName),
      ]);
      const joinUpload = (upload: { filename: string; subfolder: string }): string =>
        upload.subfolder ? `${upload.subfolder}/${upload.filename}` : upload.filename;

      const workflow = fillWorkflow(
        template,
        workflowValues(
          dirs,
          frame,
          options,
          joinUpload(rawUpload),
          joinUpload(controlUpload),
        ),
      );
      const promptId = await client.queue(workflow, clientId);
      const [image] = await client.waitForImages(promptId);
      const generated = PNG.sync.read(await client.downloadImage(image));
      const raw = PNG.sync.read(readFileSync(rawPath));
      writeFileSync(outPath, PNG.sync.write(finalizeFrame(generated, raw, options.outline)));
    } catch (error) {
      failed += 1;
      if (!options.fallback) throw error;
      console.warn(`  fallback ${label}: ${(error as Error).message}`);
      writePaletteFrame(rawPath, outPath);
    }
    done += 1;
    console.log(`[${done}/${frames.length}] ${label}${failed > 0 ? ` (${failed} fallback)` : ""}`);
  });

  console.log(
    `${dirs.name}: ${done - failed} generated, ${failed} palette fallback -> ${dirs.out}`,
  );
  if (failed > 0 && !options.fallback) process.exitCode = 1;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const template = loadWorkflow(options.workflow);
  let total = 0;

  if (options.dryRun) {
    for (const name of options.characters) {
      const dirs = characterDirs(name, options);
      const frames = listFrames(dirs, options);
      const missingControls = frames
        .map((frame) => join(dirs.control, `${frame.key}.png`))
        .filter((path) => {
          try {
            readFileSync(path);
            return false;
          } catch {
            return true;
          }
        });
      printPlan(dirs, frames, options, missingControls);
      total += frames.length;
    }
    console.log(`dry run: ${total} frame(s); no ComfyUI calls, no files written`);
    return;
  }

  if (options.palette) {
    for (const name of options.characters) {
      const dirs = characterDirs(name, options);
      const frames = listFrames(dirs, options);
      mkdirSync(dirs.out, { recursive: true });
      for (const frame of frames) {
        writePaletteFrame(join(dirs.raw, `${frame.key}.png`), join(dirs.out, `${frame.key}.png`));
      }
      console.log(`${dirs.name}: palette stylized ${frames.length} frame(s) -> ${dirs.out}`);
      total += frames.length;
    }
    console.log(`done: ${total} palette frame(s)`);
    return;
  }

  for (const name of options.characters) {
    const dirs = characterDirs(name, options);
    const frames = listFrames(dirs, options);
    try {
      await runComfy(dirs, frames, options, template);
    } catch (error) {
      if (!options.fallback) throw error;
      console.warn(`${(error as Error).message}`);
      console.warn(`${dirs.name}: falling back to the palette stylizer`);
      mkdirSync(dirs.out, { recursive: true });
      for (const frame of frames) {
        writePaletteFrame(join(dirs.raw, `${frame.key}.png`), join(dirs.out, `${frame.key}.png`));
      }
      total += frames.length;
    }
  }
  console.log(`done: ComfyUI pass finished`);
}

main().catch((error: unknown) => {
  console.error(`error: ${(error as Error).message}`);
  process.exitCode = 1;
});
