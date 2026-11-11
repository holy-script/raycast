import { existsSync, readdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const TSX = join(ROOT, "node_modules/tsx/dist/cli.mjs");
const COMFY = join(ROOT, "tools/stylize/comfy.ts");
const PACK = join(ROOT, "tools/atlas/pack.ts");
const VERIFY = join(ROOT, "tools/verify/style.ts");
const CHARACTERS = ["guardian", "scout", "brute"] as const;
const FRAME_KEY = /^[a-z]+_f\d+_p\d+_y\d+$/;
const ONLY_SELECTOR = /^[a-z*]*(:\d*){0,3}$/;

type Character = (typeof CHARACTERS)[number];

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

const TOOLS = [
  {
    name: "generate_character_atlas",
    description:
      "Stylize every rendered turntable frame for one character (ComfyUI img2img + depth " +
      "ControlNet, or the deterministic palette stylizer), then repack its atlas. Falls back " +
      "to the palette stylizer when ComfyUI is unreachable unless fallback is disabled.",
    inputSchema: {
      type: "object",
      properties: {
        character: { type: "string", enum: CHARACTERS, description: "Character atlas to build." },
        style: {
          type: "string",
          description: "Style preset appended to the positive prompt, e.g. 'SNES RPG, muted palette'.",
        },
        seed: { type: "integer", description: "Fixed diffusion seed shared by every view." },
        mode: {
          type: "string",
          enum: ["comfy", "palette"],
          description: "Generation backend. Palette needs no ComfyUI server and is fully deterministic.",
        },
        fallback: {
          type: "boolean",
          description: "Use the palette stylizer when ComfyUI is unavailable or a frame fails.",
        },
        only: {
          type: "string",
          description: "Optional frame selector such as idle:0:1:* to regenerate a subset.",
        },
        pack: { type: "boolean", description: "Repack the atlas after stylizing (default true)." },
        verify: {
          type: "boolean",
          description: "Run silhouette IoU and palette drift checks when raw renders exist (default true).",
        },
        dryRun: {
          type: "boolean",
          description: "Print the resolved plan without calling ComfyUI or writing frames.",
        },
      },
      required: ["character"],
    },
  },
  {
    name: "regenerate_view",
    description:
      "Regenerate a single turntable cell (e.g. idle_f0_p1_y0) through the same pipeline and " +
      "repack the character atlas, for fixing one angle without redoing all frames.",
    inputSchema: {
      type: "object",
      properties: {
        character: { type: "string", enum: CHARACTERS },
        frame: {
          type: "string",
          description: "Frame key: {state}_f{frame}_p{pitch}_y{yaw}, e.g. walk_f2_p3_y11.",
        },
        style: { type: "string", description: "Style preset appended to the positive prompt." },
        seed: { type: "integer", description: "Fixed diffusion seed." },
        mode: { type: "string", enum: ["comfy", "palette"] },
        fallback: { type: "boolean", description: "Fall back to the palette stylizer on failure." },
        pack: { type: "boolean", description: "Repack the atlas afterwards (default true)." },
      },
      required: ["character", "frame"],
    },
  },
] as const;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function boolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function integer(value: unknown, flag: string): number | null {
  if (value === undefined) return null;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${flag} must be an integer`);
  }
  return value;
}

function character(value: unknown): Character {
  const name = text(value);
  if (!(CHARACTERS as readonly string[]).includes(name)) {
    throw new Error(`character must be one of ${CHARACTERS.join(", ")}`);
  }
  return name as Character;
}

function styleValue(value: unknown): string | null {
  if (value === undefined) return null;
  const style = text(value).trim();
  if (style.length === 0) return null;
  if (style.length > 300) throw new Error("style must be 300 characters or fewer");
  return style;
}

function run(command: string, args: string[], timeoutMs = 30 * 60 * 1000): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: { ...process.env, FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`command timed out after ${Math.round(timeoutMs / 1000)}s: ${args[1]}`));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function ensureTools(): void {
  if (!existsSync(TSX)) {
    throw new Error("tsx is not installed. Run npm install in the project root.");
  }
}

function formatter(result: RunResult): string {
  return [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
}

async function runComfy(
  characterName: Character,
  params: Record<string, unknown>,
  only: string | null,
  timeoutMs?: number,
): Promise<RunResult> {
  ensureTools();
  const args = [TSX, COMFY, characterName];
  const style = styleValue(params.style);
  if (style) args.push("--style", style);
  const seed = integer(params.seed, "seed");
  if (seed !== null) args.push("--seed", String(seed));
  if (text(params.mode) === "palette") {
    args.push("--palette");
  } else if (boolean(params.fallback, true)) {
    args.push("--fallback");
  }
  if (only) args.push("--only", only);
  if (boolean(params.dryRun, false) && only === null) args.push("--dry-run");
  return run(process.execPath, args, timeoutMs);
}

function rawFramesExist(characterName: Character): boolean {
  const raw = join(ROOT, "assets-src/characters", characterName, "raw");
  try {
    return readdirSync(raw).some((file) => file.endsWith(".png"));
  } catch {
    return false;
  }
}

async function generateAtlas(params: Record<string, unknown>): Promise<ToolResult> {
  const characterName = character(params.character);
  const only = params.only === undefined ? null : text(params.only);
  if (only !== null && !ONLY_SELECTOR.test(only)) {
    throw new Error(`only must look like "idle:0:1:*", got "${only}"`);
  }
  const dryRun = boolean(params.dryRun, false);
  const result = await runComfy(characterName, params, only);
  const parts = [formatter(result)];
  if (result.code !== 0) {
    return {
      content: [{ type: "text", text: parts.join("\n") }],
      isError: true,
    };
  }
  if (dryRun) {
    return { content: [{ type: "text", text: parts.join("\n") }] };
  }

  if (boolean(params.pack, true)) {
    const packed = await run(process.execPath, [TSX, PACK, characterName]);
    parts.push(formatter(packed));
    if (packed.code !== 0) {
      return { content: [{ type: "text", text: parts.join("\n") }], isError: true };
    }
  }

  if (boolean(params.verify, true) && rawFramesExist(characterName)) {
    const verified = await run(process.execPath, [TSX, VERIFY, characterName], 5 * 60 * 1000);
    parts.push(formatter(verified));
    if (verified.code !== 0) {
      return { content: [{ type: "text", text: parts.join("\n") }], isError: true };
    }
  } else if (boolean(params.verify, true)) {
    parts.push("style verification skipped: no raw renders on disk");
  }

  return { content: [{ type: "text", text: parts.join("\n") }] };
}

async function regenerateView(params: Record<string, unknown>): Promise<ToolResult> {
  const characterName = character(params.character);
  const frame = text(params.frame);
  if (!FRAME_KEY.test(frame)) {
    throw new Error(`frame must look like walk_f2_p3_y11, got "${frame}"`);
  }
  const result = await runComfy(characterName, params, frame, 5 * 60 * 1000);
  const parts = [formatter(result)];
  if (result.code !== 0) {
    return { content: [{ type: "text", text: parts.join("\n") }], isError: true };
  }
  if (boolean(params.pack, true)) {
    const packed = await run(process.execPath, [TSX, PACK, characterName]);
    parts.push(formatter(packed));
    if (packed.code !== 0) {
      return { content: [{ type: "text", text: parts.join("\n") }], isError: true };
    }
  }
  return { content: [{ type: "text", text: parts.join("\n") }] };
}

async function callTool(name: string, params: Record<string, unknown>): Promise<ToolResult> {
  switch (name) {
    case "generate_character_atlas":
      return generateAtlas(params);
    case "regenerate_view":
      return regenerateView(params);
    default:
      throw new Error(`unknown tool ${name}`);
  }
}

function send(response: unknown): void {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

function reply(id: string | number | null | undefined, result: unknown): void {
  if (id === undefined) return;
  send({ jsonrpc: "2.0", id, result });
}

function sendError(
  id: string | number | null | undefined,
  code: number,
  message: string,
): void {
  if (id === undefined) return;
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handle(message: JsonRpcRequest): Promise<void> {
  const { id, method, params } = message;
  if (id === undefined || id === null) {
    return;
  }
  switch (method) {
    case "initialize":
      reply(id, {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "raycast-studio", version: "0.1.0" },
        instructions:
          "Generate and repair multi-angle sprite atlases for the raycasting project. " +
          "Use generate_character_atlas for a full 384-frame pass, regenerate_view for one cell.",
      });
      return;
    case "ping":
      reply(id, {});
      return;
    case "tools/list":
      reply(id, { tools: TOOLS });
      return;
    case "tools/call": {
      const name = text(params?.name);
      const args =
        params?.arguments && typeof params.arguments === "object"
          ? (params.arguments as Record<string, unknown>)
          : {};
      try {
        reply(id, await callTool(name, args));
      } catch (error) {
        sendError(id, -32602, (error as Error).message);
      }
      return;
    }
    default:
      sendError(id, -32601, `method not found: ${method}`);
  }
}

function main(): void {
  const lines = createInterface({ input: process.stdin, terminal: false });
  let pending = 0;
  let closed = false;
  const finish = (): void => {
    if (closed && pending === 0) process.exit(0);
  };
  lines.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let message: JsonRpcRequest;
    try {
      message = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      sendError(null, -32700, "parse error");
      return;
    }
    if (message.method === "exit") {
      process.exit(0);
    }
    pending += 1;
    void handle(message)
      .catch((error: unknown) => {
        sendError(message.id, -32603, (error as Error).message);
      })
      .finally(() => {
        pending -= 1;
        finish();
      });
  });
  lines.on("close", () => {
    closed = true;
    finish();
  });
}

main();
