import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

interface MockState {
  uploads: string[];
  prompt: Record<string, unknown> | null;
}

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function testImage(): Buffer {
  const image = new PNG({ width: 384, height: 384 });
  for (let y = 0; y < 384; y += 1) {
    for (let x = 0; x < 384; x += 1) {
      const index = (y * 384 + x) * 4;
      const inside = x > 96 && x < 288 && y > 48 && y < 336;
      image.data[index] = 210;
      image.data[index + 1] = 60;
      image.data[index + 2] = 140;
      image.data[index + 3] = inside ? 255 : 0;
    }
  }
  return PNG.sync.write(image);
}

describe("ComfyUI CLI", () => {
  let server: Server;
  let endpoint: string;
  let workdir: string;
  const state: MockState = { uploads: [], prompt: null };

  beforeAll(async () => {
    server = createServer(async (request, response) => {
      const url = request.url ?? "/";
      if (request.method === "GET" && url === "/system_stats") {
        response.end(JSON.stringify({ system: { os: "mock" } }));
        return;
      }
      if (request.method === "POST" && url === "/upload/image") {
        const body = await readBody(request);
        const name = /name="name"\r\n\r\n([^\r\n]+)/.exec(body.toString("latin1"))?.[1];
        if (name) state.uploads.push(name);
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ name: name ?? "upload.png", subfolder: "", type: "input" }));
        return;
      }
      if (request.method === "POST" && url === "/prompt") {
        const body = await readBody(request);
        const parsed = JSON.parse(body.toString("utf8")) as { prompt: Record<string, unknown> };
        state.prompt = parsed.prompt;
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ prompt_id: "mock-prompt" }));
        return;
      }
      if (request.method === "GET" && url === "/history/mock-prompt") {
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            "mock-prompt": {
              status: { completed: true, status_str: "success" },
              outputs: {
                "11": {
                  images: [{ filename: "generated.png", subfolder: "", type: "output" }],
                },
              },
            },
          }),
        );
        return;
      }
      if (request.method === "GET" && url.startsWith("/view?")) {
        response.setHeader("content-type", "image/png");
        response.end(testImage());
        return;
      }
      response.statusCode = 404;
      response.end("not found");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("mock server has no port");
    endpoint = `http://127.0.0.1:${address.port}`;
    workdir = mkdtempSync(join(tmpdir(), "raycast-comfy-"));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(workdir, { recursive: true, force: true });
  });

  it("uploads source and control, queues the graph, and writes a 96px frame", async () => {
    const child = spawn(      process.execPath,
      [
        "node_modules/tsx/dist/cli.mjs",
        "tools/stylize/comfy.ts",
        "guardian",
        "--endpoint",
        endpoint,
        "--checkpoint",
        "mock.safetensors",
        "--controlnet",
        "mock-depth.safetensors",
        "--only",
        "idle:0:1:0",
        "--out",
        workdir,
      ],
      { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const code = await new Promise<number>((resolve) => child.on("close", (value) => resolve(value ?? 1)));

    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(stdout).toContain("guardian: 1 generated, 0 palette fallback");

    const file = join(workdir, "guardian", "idle_f0_p1_y0.png");
    expect(existsSync(file)).toBe(true);
    const frame = PNG.sync.read(readFileSync(file));
    expect(frame.width).toBe(96);
    expect(frame.height).toBe(96);

    let opaque = 0;
    for (let i = 0; i < frame.data.length; i += 4) {
      if (frame.data[i + 3] > 0) opaque += 1;
    }
    expect(opaque).toBeGreaterThan(500);

    expect(state.uploads).toHaveLength(2);
    expect(state.uploads.join(" ")).toContain("guardian_raw_idle_f0_p1_y0");
    expect(state.uploads.join(" ")).toContain("guardian_depth_idle_f0_p1_y0");

    const prompt = state.prompt as Record<string, { inputs: Record<string, unknown> }>;
    expect(prompt["11"].inputs.filename_prefix).toBe("raycast_guardian_idle_f0_p1_y0");
    expect(prompt["9"].inputs.seed).toBe(1337);
    expect(String(prompt["4"].inputs.text)).toContain("guardian");
  }, 30_000);
});
