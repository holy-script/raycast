import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { PNG } from "pngjs";
import { Browser, sleep } from "./cdp";
import type { HudState, RenderDebug } from "../../src/game";

const root = resolve(import.meta.dirname, "../..");
const outDir = resolve(
  process.env.MATRIX_OUT ?? join(root, "docs/screenshots/matrix"),
);
const port = 5201;
const args = process.argv.slice(2);
const argValue = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const remoteUrl = argValue("--url");
const updateGolden = args.includes("--update-golden");
const pageUrl = remoteUrl
  ? remoteUrl.includes("?")
    ? remoteUrl
    : `${remoteUrl}?screenshot`
  : `http://127.0.0.1:${port}/?screenshot`;

interface Check {
  scenario: string;
  group: string;
  name: string;
  ok: boolean;
  detail: string;
}

interface CaptureRecord {
  name: string;
  kind: "canvas" | "page";
  diff?: number;
  baseline: "created" | "compared" | "updated" | "skipped";
}

interface Scenario {
  id: string;
  group: string;
  run: () => Promise<void>;
  /** Live-time scenarios produce different frames each run. */
  volatile?: boolean;
}

const checks: Check[] = [];
const captures: CaptureRecord[] = [];
const consoleErrors: string[] = [];
const scenarios: Scenario[] = [];
let currentScenario = "";
let currentGroup = "";

// 3x5 glyphs scaled 2x, so sheets stay readable without a canvas dependency.
const GLYPHS: Record<string, string[]> = {
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

function fillRect(
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

function drawLabel(
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

function blit(target: PNG, source: PNG, x: number, y: number): void {
  for (let row = 0; row < source.height; row += 1) {
    for (let col = 0; col < source.width; col += 1) {
      if (y + row >= target.height || x + col >= target.width) continue;
      const from = (row * source.width + col) * 4;
      const to = ((y + row) * target.width + (x + col)) * 4;
      target.data[to] = source.data[from];
      target.data[to + 1] = source.data[from + 1];
      target.data[to + 2] = source.data[from + 2];
      target.data[to + 3] = 255;
    }
  }
}

function composeSheet(
  shots: Array<{ name: string }>,
  file: string,
  shotDir: string,
): void {
  const cols = 5;
  const gap = 6;
  const labelHeight = 16;
  const cellW = 384 + gap;
  const cellH = 240 + labelHeight + gap;
  const rows = Math.ceil(shots.length / cols);
  const sheet = new PNG({ width: cols * cellW + gap, height: rows * cellH + gap });
  fillRect(sheet, 0, 0, sheet.width, sheet.height, [10, 11, 16]);
  shots.forEach((shot, index) => {
    const x = gap + (index % cols) * cellW;
    const y = gap + Math.floor(index / cols) * cellH;
    drawLabel(sheet, shot.name.toUpperCase(), x, y + 2, 2);
    blit(
      sheet,
      PNG.sync.read(readFileSync(join(shotDir, `${shot.name}.png`))),
      x,
      y + labelHeight,
    );
  });
  writeFileSync(file, PNG.sync.write(sheet));
}

function check(name: string, ok: boolean, detail: string): void {
  checks.push({ scenario: currentScenario, group: currentGroup, name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${currentScenario} · ${name} — ${detail}`);
}

function near(value: number, target: number, tolerance: number): boolean {
  return Math.abs(value - target) <= tolerance;
}

function angleNear(value: number, target: number, tolerance: number): boolean {
  const delta = Math.atan2(Math.sin(value - target), Math.cos(value - target));
  return Math.abs(delta) <= tolerance;
}

function ratioDiff(a: PNG, b: PNG): number {
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

function imageMetrics(image: PNG): { meanLuma: number; colors: number } {
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

async function waitForHttp(url: string, timeoutMs = 30_000): Promise<void> {
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

function startDevServer(): ChildProcess {
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

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true });

  const devServer = remoteUrl ? undefined : startDevServer();
  let browser: Browser | undefined;
  const startedAt = Date.now();
  try {
    await waitForHttp(pageUrl);
    browser = await Browser.launch(9400 + Math.floor(Math.random() * 400), pageUrl);
    await browser.send("Page.enable");
    await browser.send("Runtime.enable");
    await browser.send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 860,
      deviceScaleFactor: 1,
      mobile: false,
    });
    browser.onMessage((message) => {
      if (message.method === "Runtime.exceptionThrown") {
        const details = message.params?.exceptionDetails as
          | { text?: string; exception?: { description?: string } }
          | undefined;
        consoleErrors.push(
          details?.exception?.description ?? details?.text ?? "unknown exception",
        );
      }
      if (message.method === "Runtime.consoleAPICalled") {
        const params = message.params as
          | { type?: string; args?: Array<{ value?: unknown; description?: string }> }
          | undefined;
        if (params?.type !== "error") return;
        consoleErrors.push(
          (params.args ?? [])
            .map((arg) => String(arg.value ?? arg.description ?? ""))
            .join(" "),
        );
      }
    });

    const readyBy = Date.now() + 30_000;
    for (;;) {
      try {
        const ready = await browser.evaluate<boolean>(
          "Boolean(window.__raycast) && document.getElementById('loading').classList.contains('hidden')",
        );
        if (ready) break;
      } catch {
        // Page is still evaluating modules.
      }
      if (Date.now() > readyBy) throw new Error("The game did not finish booting");
      await sleep(150);
    }

    const evaluate = <T>(expression: string): Promise<T> =>
      browser!.evaluate<T>(expression);
    const state = (): Promise<HudState> =>
      evaluate<HudState>("window.__raycast.automation.state()");
    const debug = (): Promise<RenderDebug> =>
      evaluate<RenderDebug>("window.__raycast.debug()");
    const hud = (): Promise<Record<string, string>> =>
      evaluate<Record<string, string>>(`(() => {
        const text = (id) => (document.getElementById(id)?.textContent ?? "").trim();
        return {
          mode: text("hud-mode"),
          pos: text("hud-pos"),
          alt: text("hud-alt"),
          look: text("hud-look"),
          fuel: text("hud-fuel"),
          sprite: text("hud-sprite"),
          health: text("hud-health"),
          level: text("hud-level"),
          keycard: text("hud-keycard"),
          prompt: text("prompt"),
          toast: text("toast"),
        };
      })()`);

    const step = async (seconds: number, dt = 1 / 60): Promise<void> => {
      await evaluate(`window.__raycast.automation.step(${seconds}, ${dt})`);
    };
    const pose = async (
      x: number,
      y: number,
      z: number,
      yaw: number,
      pitch: number,
    ): Promise<void> => {
      await evaluate(`window.__raycast.setPose(${x}, ${y}, ${z}, ${yaw}, ${pitch})`);
      await step(0);
    };
    const press = (code: string): Promise<void> =>
      evaluate(`window.__raycast.automation.press(${JSON.stringify(code)})`);
    const release = (code: string): Promise<void> =>
      evaluate(`window.__raycast.automation.release(${JSON.stringify(code)})`);
    const look = (dx: number, dy: number): Promise<void> =>
      evaluate(`window.__raycast.automation.look(${dx}, ${dy})`);
    const setFuel = (value: number): Promise<void> =>
      evaluate(`window.__raycast.automation.setFuel(${value})`);
    const setFlying = (value: boolean): Promise<void> =>
      evaluate(`window.__raycast.setFlying(${value})`);
    const setHealth = (value: number): Promise<void> =>
      evaluate(`window.__raycast.automation.setHealth(${value})`);
    const attack = (): Promise<boolean> =>
      evaluate<boolean>("window.__raycast.automation.attack()");
    const interact = (): Promise<string> =>
      evaluate<string>("window.__raycast.automation.interact()");
    const pause = (): Promise<void> =>
      evaluate("window.__raycast.automation.pause()");
    const resume = async (): Promise<void> => {
      // Headless only produces frames for a foregrounded target.
      await browser!.send("Page.bringToFront");
      await evaluate("window.__raycast.automation.resume()");
    };
    const loadLevel = async (id: string): Promise<void> => {
      await evaluate(`window.__raycast.automation.loadLevel(${JSON.stringify(id)})`);
      await pause();
      await step(0);
    };
    const reset = async (): Promise<void> => {
      // Every scenario starts from the courtyard so level state cannot leak.
      await loadLevel("courtyard");
    };
    const tapKey = async (code: string, key: string, virtualKey: number): Promise<void> => {
      const payload = {
        code,
        key,
        windowsVirtualKeyCode: virtualKey,
        nativeVirtualKeyCode: virtualKey,
      };
      await browser!.send("Input.dispatchKeyEvent", { type: "keyDown", ...payload });
      await browser!.send("Input.dispatchKeyEvent", { type: "keyUp", ...payload });
      await step(0);
    };
    const canvasUrl = (): Promise<string> =>
      evaluate<string>('document.getElementById("view").toDataURL("image/png")');
    const readCanvas = async (): Promise<PNG> =>
      PNG.sync.read(Buffer.from((await canvasUrl()).split(",")[1], "base64"));

    const saveCanvas = async (
      name: string,
      compare: boolean,
    ): Promise<PNG> => {
      const url = await evaluate<string>(
        'document.getElementById("view").toDataURL("image/png")',
      );
      const image = PNG.sync.read(Buffer.from(url.split(",")[1], "base64"));
      const file = join(outDir, `${name}.png`);
      let diff: number | undefined;
      let baseline: CaptureRecord["baseline"] = "skipped";
      if (compare && !updateGolden && existsSync(file)) {
        diff = ratioDiff(image, PNG.sync.read(readFileSync(file)));
        baseline = "compared";
        check(
          `${name} matches baseline`,
          diff <= 0.002,
          `${(diff * 100).toFixed(2)}% of pixels differ`,
        );
      } else if (compare) {
        baseline = updateGolden ? "updated" : "created";
      }
      writeFileSync(file, PNG.sync.write(image));
      const metrics = imageMetrics(image);
      check(
        `${name} renders content`,
        metrics.colors >= 8 && metrics.meanLuma >= 4,
        `${metrics.colors} colors, mean luma ${metrics.meanLuma.toFixed(1)}`,
      );
      captures.push({ name, kind: "canvas", diff, baseline });
      return image;
    };

    const capturePage = async (name: string): Promise<void> => {
      await browser!.screenshot(join(outDir, `${name}.png`));
      captures.push({ name, kind: "page", baseline: "skipped" });
      console.log(`SHOT  ${name} (page)`);
    };

    const universalChecks = async (): Promise<void> => {
      const current = await state();
      const dbg = await debug();
      const numbers = [
        current.x,
        current.y,
        current.z,
        current.fuel,
        dbg.stats.wallColumns,
        dbg.stats.wallPixels,
        dbg.stats.topPixels,
      ];
      check(
        "state and geometry stay finite",
        numbers.every(Number.isFinite),
        numbers.map((value) => value.toFixed(2)).join(", "),
      );
      const badRect = dbg.stats.spriteRects.find(
        (rect) =>
          !Number.isFinite(rect.x) ||
          !Number.isFinite(rect.y) ||
          !Number.isFinite(rect.w) ||
          !Number.isFinite(rect.h) ||
          rect.w < 0 ||
          rect.h < 0 ||
          rect.w > 4096 ||
          rect.h > 4096,
      );
      check(
        "sprite projections are sane",
        !badRect,
        badRect ? JSON.stringify(badRect) : `${dbg.stats.spriteRects.length} rects`,
      );
      const values = await hud();
      check(
        "HUD is populated",
        values.mode.length > 0 &&
          values.mode !== "--" &&
          /^\d+%$/.test(values.fuel),
        `${values.mode} · fuel ${values.fuel}`,
      );
    };

    const define = (
      group: string,
      id: string,
      run: () => Promise<void>,
      volatile = false,
    ): void => {
      scenarios.push({ group, id, run, volatile });
    };

    await evaluate("window.__raycast.automation.enable()");
    await pause();
    await reset();

    // ---------------------------------------------------------------- ground
    define("ground", "g01-spawn-idle", async () => {
      await step(0.5);
      const current = await state();
      check(
        "spawn is on the courtyard floor",
        near(current.x, 3.5, 0.01) &&
          near(current.y, 1.5, 0.01) &&
          current.onGround &&
          current.support === 0,
        `${current.x.toFixed(2)}, ${current.y.toFixed(2)} · support ${current.support}`,
      );
      const values = await hud();
      check("grounded HUD shows walk mode", values.mode.startsWith("WALK"), values.mode);
    });

    define("ground", "g02-walk-forward", async () => {
      await press("KeyW");
      await step(0.5);
      await release("KeyW");
      const current = await state();
      check(
        "forward moves along +x at walk speed",
        near(current.x, 5.0, 0.06) && near(current.y, 1.5, 0.01),
        `x=${current.x.toFixed(2)}, y=${current.y.toFixed(2)}`,
      );
    });

    define("ground", "g03-walk-backward", async () => {
      await press("KeyS");
      await step(0.5);
      await release("KeyS");
      const current = await state();
      check(
        "backward moves along -x",
        near(current.x, 2.0, 0.06) && near(current.y, 1.5, 0.01),
        `x=${current.x.toFixed(2)}, y=${current.y.toFixed(2)}`,
      );
    });

    define("ground", "g04-strafe-right", async () => {
      await pose(5.5, 4.5, 0, 0, 0);
      await press("KeyD");
      await step(0.5);
      await release("KeyD");
      const current = await state();
      check(
        "strafe right moves along +y",
        near(current.y, 6.0, 0.06) && near(current.x, 5.5, 0.01),
        `x=${current.x.toFixed(2)}, y=${current.y.toFixed(2)}`,
      );
    });

    define("ground", "g05-strafe-left", async () => {
      await pose(5.5, 4.5, 0, 0, 0);
      await press("KeyA");
      await step(0.5);
      await release("KeyA");
      const current = await state();
      check(
        "strafe left moves along -y",
        near(current.y, 3.0, 0.06) && near(current.x, 5.5, 0.01),
        `x=${current.x.toFixed(2)}, y=${current.y.toFixed(2)}`,
      );
    });

    define("ground", "g06-sprint-forward", async () => {
      await pose(5.5, 4.5, 0, 0, 0);
      await press("ShiftLeft");
      await press("KeyW");
      await step(0.5);
      await release("KeyW");
      await release("ShiftLeft");
      const current = await state();
      check(
        "sprint covers more ground than walking",
        current.x - 5.5 > 2.1,
        `dx=${(current.x - 5.5).toFixed(2)} (walk was 1.50)`,
      );
    });

    define("ground", "g07-diagonal-walk", async () => {
      await pose(5.5, 3.5, 0, 0, 0);
      await press("KeyW");
      await press("KeyD");
      await step(0.5);
      await release("KeyW");
      await release("KeyD");
      const current = await state();
      check(
        "diagonal input is normalized",
        near(current.x - 5.5, 1.06, 0.05) && near(current.y - 3.5, 1.06, 0.05),
        `dx=${(current.x - 5.5).toFixed(2)}, dy=${(current.y - 3.5).toFixed(2)}`,
      );
    });

    define("ground", "g08-wall-block", async () => {
      await pose(1.5, 1.5, 0, Math.PI, 0);
      await press("KeyW");
      await step(0.9);
      await release("KeyW");
      const current = await state();
      check(
        "walking into a wall stops at the radius",
        current.x > 1.0 && current.x < 1.35,
        `stopped at x=${current.x.toFixed(2)}`,
      );
      check(
        "wall contact keeps the camera opaque",
        (await debug()).stats.wallColumns === 384,
        `${(await debug()).stats.wallColumns} wall columns`,
      );
    });

    define("ground", "g09-north-wall-slide", async () => {
      await pose(5.5, 1.5, 0, -Math.PI / 2, 0);
      await press("KeyW");
      await step(0.8);
      await release("KeyW");
      const current = await state();
      check(
        "north wall blocks without leaving the map",
        current.y > 1.0 && current.y < 1.35 && near(current.x, 5.5, 0.01),
        `x=${current.x.toFixed(2)}, y=${current.y.toFixed(2)}`,
      );
    });

    define("ground", "g10-respawn-key", async () => {
      await pose(11.5, 4.5, 0, 0, 0);
      await tapKey("KeyR", "r", 82);
      const current = await state();
      check(
        "R respawns at the spawn pad",
        near(current.x, 3.5, 0.01) && near(current.y, 1.5, 0.01) && current.fuel === 1,
        `${current.x.toFixed(2)}, ${current.y.toFixed(2)} · fuel ${current.fuel}`,
      );
    });

    // -------------------------------------------------------------- vertical
    define("vertical", "v01-jump-burst", async () => {
      await pose(5.5, 4.5, 0, 0, 0);
      await press("Space");
      await step(0.12);
      await release("Space");
      await step(0.08);
      const current = await state();
      check(
        "a short hop leaves the ground",
        current.z > 0.25 && current.airborne && !current.thrusting,
        `alt ${current.z.toFixed(2)} m, vz ${current.vz.toFixed(2)}`,
      );
      check("airborne HUD switches mode", (await hud()).mode.startsWith("AIRBORNE"), (await hud()).mode);
    });

    define("vertical", "v02-jet-burn", async () => {
      await pose(5.5, 4.5, 0, 0, 0);
      await press("Space");
      await step(1.0);
      const current = await state();
      const values = await hud();
      const glow = await evaluate<boolean>(
        'document.getElementById("thrust").classList.contains("active")',
      );
      check(
        "jetpack burns fuel and climbs",
        current.thrusting && current.z > 2.5 && near(current.fuel, 0.8, 0.02),
        `alt ${current.z.toFixed(2)} m, fuel ${current.fuel.toFixed(2)}`,
      );
      check("jet HUD and exhaust glow are active", values.mode === "JETPACK · BURN" && glow, `${values.mode} · glow ${glow}`);
      await saveCanvas("v02-jet-burn", true);
      await release("Space");
      await step(0.2);
      const after = await evaluate<boolean>(
        'document.getElementById("thrust").classList.contains("active")',
      );
      check("exhaust glow clears after release", !after, `glow ${after}`);
    });

    define("vertical", "v03-jet-ceiling", async () => {
      await pose(5.5, 4.5, 17.5, 0, 0);
      await press("Space");
      await step(1.0);
      await release("Space");
      const current = await state();
      check(
        "altitude ceiling holds at 18 m",
        near(current.z, 18, 0.02),
        `alt ${current.z.toFixed(2)} m`,
      );
    });

    define("vertical", "v04-jet-empty-fuel", async () => {
      await pose(5.5, 4.5, 0, 0, 0);
      await setFuel(0.01);
      await press("Space");
      await step(0.4);
      const current = await state();
      await release("Space");
      check(
        "empty tank stops thrust",
        current.fuel < 0.005 && !current.thrusting,
        `fuel ${current.fuel.toExponential(2)}, thrust ${current.thrusting}`,
      );
      check("empty tank HUD reads 0%", (await hud()).fuel === "0%", (await hud()).fuel);
    });

    define("vertical", "v05-fall-land", async () => {
      await pose(5.5, 4.5, 6, 0, -0.5);
      await step(1.2);
      const current = await state();
      check(
        "free fall lands back on the floor",
        current.z === 0 && current.onGround && current.vz === 0,
        `alt ${current.z.toFixed(2)} m, grounded ${current.onGround}`,
      );
    });

    define("vertical", "v06-ground-refuel", async () => {
      await pose(5.5, 4.5, 0, 0, 0);
      await setFuel(0.2);
      await step(1.0);
      const current = await state();
      check(
        "ground contact refuels over time",
        near(current.fuel, 0.7, 0.05),
        `fuel ${current.fuel.toFixed(2)} after 1 s`,
      );
    });

    define("vertical", "v07-freefly-up", async () => {
      await pose(5.5, 4.5, 0, 0, 0);
      await setFlying(true);
      await press("Space");
      await step(1.0);
      await release("Space");
      const current = await state();
      check(
        "freefly ascends without fuel",
        near(current.z, 4, 0.05) && current.fuel === 1,
        `alt ${current.z.toFixed(2)} m, fuel ${current.fuel}`,
      );
      check("freefly HUD switches mode", (await hud()).mode === "FREEFLY · DEBUG", (await hud()).mode);
    });

    define("vertical", "v08-freefly-descend-crate", async () => {
      await pose(4.5, 13.5, 3, 0, 0);
      await setFlying(true);
      await press("ControlLeft");
      await step(1.0);
      await release("ControlLeft");
      const current = await state();
      check(
        "freefly descent stops on the crate",
        near(current.z, 0.6, 0.02) && current.onGround,
        `alt ${current.z.toFixed(2)} m, support ${current.support.toFixed(2)}`,
      );
    });

    define("vertical", "v09-freefly-off-fall", async () => {
      await pose(5.5, 4.5, 6, 0, 0);
      await setFlying(true);
      await setFlying(false);
      await step(0.3);
      const current = await state();
      check(
        "leaving freefly resumes gravity",
        current.vz < 0 && current.airborne,
        `vz ${current.vz.toFixed(2)}, airborne ${current.airborne}`,
      );
    });

    // ------------------------------------------------------------------ aim
    define("aim", "a01-ground-pitch-clamp-down", async () => {
      await pose(5.5, 4.5, 0, 0, -1.4);
      const current = await state();
      check(
        "ground look-down clamps at 63 degrees",
        near(current.pitchDeg, -63, 1),
        `pitch ${current.pitchDeg} deg`,
      );
    });

    define("aim", "a02-ground-pitch-clamp-up", async () => {
      await pose(5.5, 4.5, 0, 0, 1.4);
      const current = await state();
      check(
        "ground look-up clamps at 63 degrees",
        near(current.pitchDeg, 63, 1),
        `pitch ${current.pitchDeg} deg`,
      );
    });

    define("aim", "a03-air-pitch-top", async () => {
      await pose(7.5, 1.58, 14, 0, -1.45);
      const current = await state();
      check(
        "airborne pitch reaches the top band",
        near(current.pitchDeg, -83, 1) && current.nearestPitch === 3,
        `pitch ${current.pitchDeg} deg, sprite pitch ${current.nearestPitch}`,
      );
    });

    define("aim", "a04-mouse-yaw", async () => {
      await pose(5.5, 4.5, 0, 0, 0);
      await look(714, 0);
      await step(1 / 60);
      const current = await state();
      check(
        "mouse-right turns 90 degrees",
        near(current.yawDeg, 90, 2),
        `yaw ${current.yawDeg} deg`,
      );
    });

    define("aim", "a05-mouse-pitch", async () => {
      await pose(5.5, 4.5, 0, 0, 0);
      await look(0, -300);
      await step(1 / 60);
      const current = await state();
      check(
        "mouse-up tilts the camera up",
        near(current.pitchDeg, 38, 3),
        `pitch ${current.pitchDeg} deg`,
      );
    });

    const sectors: Array<{ id: string; x: number; y: number; yaw: number; expected: number }> = [
      { id: "a06-sector-front", x: 16.5, y: 4.5, yaw: 0, expected: 0 },
      { id: "a07-sector-back", x: 22.5, y: 4.5, yaw: Math.PI, expected: 8 },
      { id: "a08-sector-south", x: 21.5, y: 7.5, yaw: -Math.PI / 2, expected: 4 },
      { id: "a09-sector-north", x: 21.5, y: 2.5, yaw: Math.PI / 2, expected: 12 },
      { id: "a10-sector-ne", x: 17.5, y: 2.5, yaw: Math.atan2(2, 4), expected: 15 },
      { id: "a11-sector-sw", x: 17.5, y: 6.5, yaw: Math.atan2(-2, 4), expected: 1 },
      { id: "a12-sector-se", x: 22.5, y: 6.5, yaw: Math.atan2(-2, -1), expected: 5 },
      { id: "a13-sector-nw", x: 22.5, y: 2.5, yaw: Math.atan2(2, -1), expected: 11 },
    ];
    for (const sector of sectors) {
      define("aim", sector.id, async () => {
        await pose(sector.x, sector.y, 0, sector.yaw, 0);
        await step(0.2);
        const dbg = await debug();
        const tinker = dbg.actors.find((actor) => actor.name === "tinker");
        check(
          `camera selects tinker yaw ${sector.expected}`,
          Boolean(
            tinker &&
              tinker.sprite === "guardian" &&
              tinker.yawIndex === sector.expected,
          ),
          tinker
            ? `${tinker.sprite} yaw ${tinker.yawIndex} pitch ${tinker.pitchIndex}`
            : "tinker missing",
        );
      });
    }

    define("aim", "a14-pitch-band-low", async () => {
      await pose(11.5, 7.5, 0, Math.PI / 2, 0);
      const current = await state();
      check(
        "a hovering actor selects the low pitch band",
        current.nearestName === "drone" && current.nearestPitch === 0,
        `${current.nearestName} pitch ${current.nearestPitch}`,
      );
    });

    define("aim", "a15-pitch-band-level", async () => {
      await pose(5.5, 1.5, 0, 0, 0);
      const current = await state();
      check(
        "a level actor selects the level pitch band",
        current.nearestName === "guard" && current.nearestPitch === 1,
        `${current.nearestName} pitch ${current.nearestPitch}`,
      );
    });

    define("aim", "a16-pitch-band-high", async () => {
      await pose(4.5, 1.5, 3, 0, 0);
      const current = await state();
      check(
        "viewing from 3 m selects the high pitch band",
        current.nearestName === "guard" && current.nearestPitch === 2,
        `${current.nearestName} pitch ${current.nearestPitch}`,
      );
    });

    define("aim", "a17-pitch-band-top", async () => {
      await pose(4.5, 1.5, 12, 0, -1.0);
      const current = await state();
      check(
        "viewing from 12 m selects the top pitch band",
        current.nearestName === "guard" && current.nearestPitch === 3,
        `${current.nearestName} pitch ${current.nearestPitch}`,
      );
    });

    define("aim", "a18-fov-stable-altitude", async () => {
      await pose(5.5, 4.5, 0, 0, 0);
      const ground = (await debug()).camera;
      await pose(5.5, 4.5, 16, 0, -1.0);
      const high = (await debug()).camera;
      check(
        "projection FOV does not widen while climbing",
        near(high.fovDegrees, ground.fovDegrees, 0.001) &&
          near(high.tanHalf, ground.tanHalf, 1e-9),
        `${ground.fovDegrees.toFixed(1)} deg ground, ${high.fovDegrees.toFixed(1)} deg at 16 m`,
      );
    });

    define("aim", "a19-topdown-scale", async () => {
      await pose(7.5, 1.58, 14, 0, -1.45);
      const guard = (await debug()).actors.find((actor) => actor.name === "guard");
      check(
        "top-down billboards shrink by the ortho compensation factor",
        Boolean(
          guard &&
            guard.pitchIndex === 3 &&
            near(guard.worldSize, 0.78, 0.02),
        ),
        guard ? `pitch ${guard.pitchIndex} · size ${guard.worldSize.toFixed(3)} m` : "missing",
      );
    });

    // -------------------------------------------------------------- surfaces
    define("surfaces", "s01-stairs-approach", async () => {
      await pose(11.5, 22.5, 0, -Math.PI / 2, 0);
      const current = await state();
      check(
        "stairs approach sits on the floor",
        current.support === 0 && current.onGround,
        `support ${current.support}, y=${current.y.toFixed(2)}`,
      );
    });

    define("surfaces", "s02-stairs-climb", async () => {
      await pose(11.5, 22.5, 0, -Math.PI / 2, 0);
      await press("KeyW");
      await step(1.05);
      await release("KeyW");
      const current = await state();
      check(
        "walking up the treads reaches the platform",
        near(current.support, 0.4, 0.01) &&
          near(current.z, 0.4, 0.01) &&
          current.onGround &&
          current.y < 20.6,
        `alt ${current.z.toFixed(2)} m, support ${current.support}, y=${current.y.toFixed(2)}`,
      );
      check("platform HUD shows a perch", (await hud()).mode.startsWith("PERCH · 0.4"), (await hud()).mode);
    });

    define("surfaces", "s03-stairs-descend", async () => {
      await pose(11.5, 19.5, 0.4, Math.PI / 2, 0);
      await press("KeyW");
      await step(1.05);
      await release("KeyW");
      const current = await state();
      check(
        "walking down the treads returns to the floor",
        current.z === 0 && current.support === 0 && current.y > 21.5,
        `alt ${current.z.toFixed(2)} m, y=${current.y.toFixed(2)}`,
      );
    });

    define("surfaces", "s04-platform-stand", async () => {
      await pose(11.5, 19.5, 0.4, 0, 0);
      await step(0.2);
      const current = await state();
      check(
        "the platform supports a standing player",
        near(current.z, 0.4, 0.01) && current.onGround,
        `alt ${current.z.toFixed(2)} m, support ${current.support}`,
      );
    });

    define("surfaces", "s05-crate-block", async () => {
      await pose(4.5, 15.5, 0, -Math.PI / 2, 0);
      await press("KeyW");
      await step(0.7);
      await release("KeyW");
      const current = await state();
      check(
        "a 0.6 crate blocks walking",
        current.y > 14.1 && near(current.support, 0, 0.01),
        `stopped at y=${current.y.toFixed(2)}, support ${current.support}`,
      );
    });

    define("surfaces", "s06-crate-perch", async () => {
      await pose(4.5, 13.5, 3, 0, -1.2);
      await step(1.0);
      const current = await state();
      check(
        "falling onto the crate stops at 0.6 m",
        near(current.z, 0.6, 0.02) && current.onGround,
        `alt ${current.z.toFixed(2)} m, support ${current.support}`,
      );
    });

    define("surfaces", "s07-wall-land", async () => {
      await pose(3.5, 2.5, 3, 0, -0.4);
      await step(1.0);
      const current = await state();
      check(
        "falling onto a wall stops at 1.4 m",
        near(current.z, 1.4, 0.02) && current.onGround,
        `alt ${current.z.toFixed(2)} m, support ${current.support}`,
      );
      check("wall perch HUD reports 1.4 m", (await hud()).mode === "PERCH · 1.4 m", (await hud()).mode);
    });

    define("surfaces", "s08-wall-stepoff", async () => {
      await pose(3.5, 2.5, 1.4, 0, 0);
      await press("KeyW");
      await step(1.1);
      await release("KeyW");
      const current = await state();
      check(
        "stepping off a wall falls to the floor",
        current.z === 0 && current.support === 0 && current.x > 4.2,
        `x=${current.x.toFixed(2)}, alt ${current.z.toFixed(2)} m`,
      );
    });

    define("surfaces", "s09-wall-perch-down", async () => {
      await pose(3.5, 2.5, 1.4, 0, -1.45);
      const dbg = await debug();
      check(
        "perched overhead view renders tops",
        dbg.stats.topPixels > 500 && dbg.stats.wallColumns > 0,
        `${dbg.stats.topPixels} top px, ${dbg.stats.wallColumns} columns`,
      );
    });

    define("surfaces", "s10-near-wall", async () => {
      await pose(1.22, 1.5, 0, Math.PI, 0);
      const dbg = await debug();
      check(
        "a near wall fills the frame without vanishing",
        dbg.stats.wallColumns === 384 && dbg.stats.wallPixels > 85_000,
        `${dbg.stats.wallColumns} cols, ${dbg.stats.wallPixels} wall px`,
      );
    });

    define("surfaces", "s11-near-wall-lookdown", async () => {
      await pose(1.22, 1.5, 0, Math.PI, -1.1);
      const dbg = await debug();
      check(
        "a near wall survives a steep look-down",
        dbg.stats.wallColumns === 384 && dbg.stats.wallPixels > 20_000,
        `${dbg.stats.wallColumns} cols, ${dbg.stats.wallPixels} wall px`,
      );
    });

    define("surfaces", "s12-wall-side-landing", async () => {
      await pose(1.05, 1.5, 3, 0, -0.4);
      await step(1.0);
      const current = await state();
      check(
        "landing with the capsule overlapping a wall pushes clear",
        current.onGround && current.z === 0 && current.x >= 1.18,
        `x=${current.x.toFixed(3)}, alt ${current.z.toFixed(2)} m`,
      );
      await press("KeyW");
      await step(0.6);
      await release("KeyW");
      const moved = await state();
      check(
        "movement stays free after a wall-side landing",
        moved.x > 1.9,
        `x=${moved.x.toFixed(2)}`,
      );
    });

    define("surfaces", "s13-corner-landing", async () => {
      await pose(1.05, 1.05, 3, 0, -0.4);
      await step(1.0);
      const current = await state();
      check(
        "a wall-corner landing ejects inward on both axes",
        current.onGround && current.x >= 1.18 && current.y >= 1.18,
        `x=${current.x.toFixed(3)}, y=${current.y.toFixed(3)}`,
      );
      await press("KeyD");
      await step(0.6);
      await release("KeyD");
      const moved = await state();
      check(
        "strafing out of the corner is not blocked",
        moved.y > 1.8,
        `y=${moved.y.toFixed(2)}`,
      );
    });

    // ---------------------------------------------------------------- actors
    define("actors", "c01-watcher-tracks", async () => {
      await pose(21.5, 9.5, 0, Math.PI, 0);
      await step(2.0);
      let current = await state();
      let dbg = await debug();
      let sentinel = dbg.actors.find((actor) => actor.name === "sentinel");
      check(
        "watcher turns toward the player from the east",
        Boolean(sentinel && angleNear(sentinel.facing, 0, 0.15)) && current.nearestYaw === 0,
        sentinel ? `facing ${sentinel.facing.toFixed(2)}, yaw ${current.nearestYaw}` : "missing",
      );
      await pose(14.5, 9.5, 0, 0, 0);
      await step(2.0);
      current = await state();
      dbg = await debug();
      sentinel = dbg.actors.find((actor) => actor.name === "sentinel");
      check(
        "watcher reverses when the player crosses it",
        Boolean(sentinel && angleNear(sentinel.facing, Math.PI, 0.15)),
        sentinel ? `facing ${sentinel.facing.toFixed(2)}` : "missing",
      );
    });

    define("actors", "c02-patrol-advance", async () => {
      await pose(11.5, 12.5, 0, 0, 0);
      let dbg = await debug();
      const start = dbg.actors.find((actor) => actor.name === "patrol");
      await step(2.0);
      dbg = await debug();
      const end = dbg.actors.find((actor) => actor.name === "patrol");
      check(
        "patrol actor walks along its line",
        Boolean(start && end && end.x > start.x + 1.8 && end.state === "walk"),
        start && end ? `x ${start.x.toFixed(2)} -> ${end.x.toFixed(2)} · ${end.state}` : "missing",
      );
    });

    define("actors", "c03-patrol-reverse", async () => {
      await pose(11.5, 12.5, 0, 0, 0);
      await step(6.0);
      const dbg = await debug();
      const patrol = dbg.actors.find((actor) => actor.name === "patrol");
      check(
        "patrol reverses at the end of the line",
        Boolean(patrol && angleNear(patrol.facing, Math.PI, 0.2)),
        patrol ? `facing ${patrol.facing.toFixed(2)}, x=${patrol.x.toFixed(2)}` : "missing",
      );
    });

    define("actors", "c04-chase-approach", async () => {
      await pose(16.5, 12.5, 0, 0, 0);
      let dbg = await debug();
      const start = dbg.actors.find((actor) => actor.name === "stalker");
      await step(0.6);
      dbg = await debug();
      const end = dbg.actors.find((actor) => actor.name === "stalker");
      const distance = end
        ? Math.hypot(16.5 - end.x, 12.5 - end.y)
        : Infinity;
      check(
        "chase actor closes distance and walks",
        Boolean(
          start &&
            end &&
            distance < Math.hypot(16.5 - start.x, 12.5 - start.y) - 0.4 &&
            end.state === "walk",
        ),
        start && end
          ? `distance ${Math.hypot(16.5 - start.x, 12.5 - start.y).toFixed(2)} -> ${distance.toFixed(2)} · ${end.state}`
          : "missing",
      );
    });

    define("actors", "c05-hover-bob", async () => {
      await pose(11.5, 12.5, 0, Math.PI / 2, 0);
      let dbg = await debug();
      const start = dbg.actors.find((actor) => actor.name === "drone")?.z ?? 0;
      await step(1.0);
      dbg = await debug();
      const end = dbg.actors.find((actor) => actor.name === "drone")?.z ?? 0;
      check(
        "hover actor bobs vertically",
        Math.abs(end - start) > 0.15 && end > 0.75 && end < 1.45,
        `z ${start.toFixed(2)} -> ${end.toFixed(2)}`,
      );
    });

    define("actors", "c06-idle-animation", async () => {
      await pose(5.5, 1.5, 0, 0, 0);
      const before = await readCanvas();
      await step(0.6);
      const after = await readCanvas();
      const diff = ratioDiff(before, after);
      check(
        "idle actor animates between two frames",
        diff > 0.002,
        `${(diff * 100).toFixed(2)}% of pixels changed`,
      );
    });

    define("actors", "c07-occlusion-crate", async () => {
      await pose(4.5, 15.5, 0, -Math.PI / 2, 0);
      const dbg = await debug();
      const scholar = dbg.stats.spriteRects.find((rect) => rect.id === "scholar");
      check(
        "the crate occludes the scholar behind it",
        Boolean(scholar && scholar.visible && scholar.pixels > 0 && scholar.occluded > 100),
        scholar ? `${scholar.pixels} drawn, ${scholar.occluded} occluded px` : "not projected",
      );
    });

    define("actors", "c08-occlusion-wall", async () => {
      await pose(7.5, 9.5, 0, -Math.PI / 2, 0);
      const dbg = await debug();
      const guard = dbg.stats.spriteRects.find((rect) => rect.id === "guard");
      check(
        "a full wall hides the actor behind it",
        Boolean(guard && guard.w > 0 && guard.pixels === 0),
        guard ? `${guard.pixels} drawn, ${guard.occluded} occluded px, w=${guard.w.toFixed(1)}` : "not projected",
      );
    });

    define("actors", "c09-overhead-guard", async () => {
      await pose(7.5, 1.58, 14, 0, -1.45);
      const dbg = await debug();
      const guard = dbg.stats.spriteRects.find((rect) => rect.id === "guard");
      check(
        "overhead actor keeps a readable silhouette",
        Boolean(
          guard &&
            guard.visible &&
            guard.contentW >= 4 &&
            guard.contentH >= 6 &&
            guard.pixels >= 24 &&
            Math.abs(guard.x - 192) < 48,
        ),
        guard
          ? `${guard.contentW}x${guard.contentH} px, ${guard.pixels} opaque px, x=${guard.x.toFixed(1)}`
          : "not projected",
      );
    });

    define("actors", "c10-overhead-edge-actor", async () => {
      await pose(21.5, 4.58, 14, 0, -1.45);
      const dbg = await debug();
      const tinker = dbg.stats.spriteRects.find((rect) => rect.id === "tinker");
      check(
        "an overhead actor near the map edge stays in view",
        Boolean(tinker && tinker.visible && Math.abs(tinker.x - 192) < 48),
        tinker ? `x=${tinker.x.toFixed(1)}, visible=${tinker.visible}` : "not projected",
      );
    });

    define("actors", "c11-multi-actor-aerial", async () => {
      await pose(11.5, 12.5, 14, 0, -1.45);
      const dbg = await debug();
      const visible = dbg.stats.spriteRects.filter((rect) => rect.visible && rect.pixels > 0);
      check(
        "aerial view projects several actors",
        visible.length >= 3,
        `${visible.length} visible: ${visible.map((rect) => rect.id).join(", ")}`,
      );
    });

    // ------------------------------------------------------------- viewmodel
    define("viewmodel", "w01-idle-overlay", async () => {
      await pose(5.5, 4.5, 0, 0, 0);
      const dbg = await debug();
      check(
        "the first-person viewmodel covers the lower-right frame",
        dbg.stats.viewmodelPixels > 2_000,
        `${dbg.stats.viewmodelPixels} px`,
      );
      check(
        "the viewmodel idles when standing still",
        dbg.viewmodel.pose === "idle0" || dbg.viewmodel.pose === "idle1",
        dbg.viewmodel.pose,
      );
      await saveCanvas("w01-idle-viewmodel", false);
    }, true);

    define("viewmodel", "w02-attack-swing", async () => {
      await pose(5.5, 4.5, 0, 0, 0);
      await attack();
      await step(0.12);
      const dbg = await debug();
      check(
        "the attack drives the viewmodel into its strike pose",
        dbg.viewmodel.pose === "strike" && dbg.stats.viewmodelPixels > 2_000,
        `${dbg.viewmodel.pose} · ${dbg.stats.viewmodelPixels} px`,
      );
      await saveCanvas("w02-strike-viewmodel", false);
    }, true);

    define("viewmodel", "w03-swing-recovery", async () => {
      await pose(5.5, 4.5, 0, 0, 0);
      await attack();
      await step(0.55);
      const dbg = await debug();
      check(
        "the viewmodel settles back to idle after the cooldown",
        dbg.viewmodel.pose === "idle0" || dbg.viewmodel.pose === "idle1",
        dbg.viewmodel.pose,
      );
    }, true);

    // -------------------------------------------------------------------- ui
    define("ui", "u01-minimap-visible", async () => {
      const visible = await evaluate<boolean>("window.__raycast.game.minimapVisible");
      check("minimap starts visible", visible, `minimapVisible=${visible}`);
      await capturePage("u01-minimap-visible");
    }, true);

    define("ui", "u02-minimap-hidden", async () => {
      await tapKey("KeyM", "m", 77);
      const visible = await evaluate<boolean>("window.__raycast.game.minimapVisible");
      check("M hides the minimap", !visible, `minimapVisible=${visible}`);
      await capturePage("u02-minimap-hidden");
      await tapKey("KeyM", "m", 77);
      const restored = await evaluate<boolean>("window.__raycast.game.minimapVisible");
      check("M restores the minimap", restored, `minimapVisible=${restored}`);
    }, true);

    define("ui", "u03-hud-minimal", async () => {
      await tapKey("F3", "F3", 114);
      const minimal = await evaluate<boolean>(
        'document.getElementById("hud").classList.contains("minimal")',
      );
      check("F3 collapses the HUD detail", minimal, `minimal=${minimal}`);
      await capturePage("u03-hud-minimal");
      await tapKey("F3", "F3", 114);
      const restored = await evaluate<boolean>(
        'document.getElementById("hud").classList.contains("minimal")',
      );
      check("F3 restores HUD detail", !restored, `minimal=${restored}`);
    }, true);

    define("ui", "u04-pause-freeze", async () => {
      await pose(5.5, 4.5, 0, 0, 0);
      const before = await readCanvas();
      await sleep(350);
      const after = await readCanvas();
      const diff = ratioDiff(before, after);
      const paused = await evaluate<boolean>("window.__raycast.automation.isPaused()");
      check("pause freezes the world", paused && diff === 0, `${(diff * 100).toFixed(2)}% pixels differ while paused`);
      const first = await state();
      await sleep(200);
      const second = await state();
      check(
        "paused state is stable",
        first.x === second.x && first.z === second.z && first.fuel === second.fuel,
        `pos ${second.x.toFixed(1)},${second.y.toFixed(1)} · fuel ${second.fuel}`,
      );
    });

    define("ui", "u05-pause-resume", async () => {
      await pose(7.5, 14.5, 0, 0, 0);
      const patrolBefore = (await debug()).actors.find(
        (actor) => actor.name === "patrol",
      )?.x;
      const framesBefore = await evaluate<number>(
        "window.__raycast.automation.frameCount()",
      );
      const before = await readCanvas();
      await resume();
      const resumedPaused = await evaluate<boolean>(
        "window.__raycast.automation.isPaused()",
      );
      await sleep(350);
      await pause();
      await step(0);
      const frames = await evaluate<number>("window.__raycast.automation.frameCount()");
      const patrolAfter = (await debug()).actors.find(
        (actor) => actor.name === "patrol",
      )?.x;
      const moved = (patrolAfter ?? 0) - (patrolBefore ?? 0);
      const after = await readCanvas();
      const diff = ratioDiff(before, after);
      check(
        "resuming advances the simulation",
        moved > 0.05 && diff > 0.0005,
        `patrol dx ${moved.toFixed(2)}, ${frames - framesBefore} frames, paused=${resumedPaused}, ${(diff * 100).toFixed(2)}% pixels changed`,
      );
    }, true);

    define("ui", "u06-hud-values", async () => {
      await pose(11.5, 12.5, 8, 0, -0.5);
      const values = await hud();
      check(
        "HUD position and altitude follow the player",
        values.pos === "11.5 12.5" && values.alt.startsWith("8.00 m"),
        `pos "${values.pos}" · alt "${values.alt}"`,
      );
      check(
        "HUD look angles reflect pitch",
        values.look === "yaw 0 · pitch -29",
        `look "${values.look}"`,
      );
    });

    define("ui", "u07-fuel-readout", async () => {
      await setFuel(0.37);
      await step(0);
      const values = await hud();
      check("fuel readout formats the tank", values.fuel === "37%", values.fuel);
    });

    // ---------------------------------------------------------------- routes
    define("routes", "r01-jet-over-wall", async () => {
      await pose(2.5, 2.5, 0, 0, 0);
      await press("Space");
      await step(0.35);
      await release("Space");
      await press("KeyW");
      await step(0.35);
      await release("KeyW");
      await step(1.1);
      const current = await state();
      check(
        "jetpack clears a wall and lands on top",
        current.x > 3.1 && near(current.z, 1.4, 0.02) && current.onGround,
        `x=${current.x.toFixed(2)}, alt ${current.z.toFixed(2)} m, support ${current.support}`,
      );
    });

    define("routes", "r02-jet-forward-climb", async () => {
      await pose(11.5, 12.5, 0, 0, 0);
      await press("Space");
      await press("KeyW");
      await step(1.0);
      await release("KeyW");
      await release("Space");
      const current = await state();
      check(
        "jetpack plus forward crosses the courtyard airborne",
        current.z > 2 && current.x > 13.5,
        `x=${current.x.toFixed(2)}, alt ${current.z.toFixed(2)} m`,
      );
    });

    define("routes", "r03-aerial-lookdown", async () => {
      await setFlying(true);
      await pose(11.5, 12.5, 16, 0, -1.45);
      const current = await state();
      check(
        "aerial look-down selects the top sprite band",
        current.nearestPitch === 3 && current.pitchDeg < -80,
        `pitch ${current.pitchDeg} deg, sprite pitch ${current.nearestPitch}`,
      );
    });

    define("routes", "r04-respawn-midair", async () => {
      await pose(5.5, 4.5, 10, 0, -1.0);
      await tapKey("KeyR", "r", 82);
      const current = await state();
      check(
        "respawning from altitude resets the pose",
        current.z === 0 && current.yawDeg === 0 && current.fuel === 1,
        `alt ${current.z.toFixed(2)} m, yaw ${current.yawDeg}, fuel ${current.fuel}`,
      );
    });

    define("routes", "r05-sprint-route", async () => {
      await press("ShiftLeft");
      await press("KeyW");
      await step(1.0);
      await release("KeyW");
      await release("ShiftLeft");
      const current = await state();
      check(
        "sprint route traverses the corridor",
        current.x - 3.5 > 4.4,
        `dx=${(current.x - 3.5).toFixed(2)} in 1 s`,
      );
    });

    // ----------------------------------------------------------- interaction
    define("interaction", "i01-keycard-pickup", async () => {
      await pose(17.5, 9.5, 0, 0, 0);
      await step(0.1);
      const current = await state();
      const dbg = await debug();
      const card = dbg.pickups.find((pickup) => pickup.kind === "keycard");
      const values = await hud();
      check(
        "walking onto the keycard collects it",
        current.keycard && card?.taken === true,
        `keycard=${current.keycard} taken=${card?.taken}`,
      );
      check("keycard toast appears", values.toast.includes("KEYCARD"), values.toast);
      check("HUD keycard reads acquired", values.keycard === "ACQUIRED", values.keycard);
      await capturePage("i01-keycard-toast");
    });

    define("interaction", "i02-door-locked", async () => {
      await pose(8.4, 11.5, 0, 0.35, 0);
      await step(0.1);
      const result = await interact();
      const dbg = await debug();
      const values = await hud();
      check(
        "the lift door stays sealed without a keycard",
        result === "locked" && dbg.doors[0].open === false,
        `${result} · open=${dbg.doors[0].open}`,
      );
      check("locked prompt explains the keycard", values.prompt.includes("keycard"), values.prompt);
      check("sealed toast appears", values.toast.includes("SEALED"), values.toast);
    });

    define("interaction", "i03-door-unlock", async () => {
      await pose(17.5, 9.5, 0, 0, 0);
      await step(0.1);
      await pose(8.4, 11.5, 0, 0, 0);
      await step(0.1);
      const values = await hud();
      check("unlock prompt appears at the door", values.prompt.includes("unlock door"), values.prompt);
      const result = await interact();
      const dbg = await debug();
      const tile = await evaluate<number>(
        "window.__raycast.game.world.tiles[11 * 24 + 9]",
      );
      check(
        "the keycard clears the door tile",
        result === "door" && dbg.doors[0].open === true && tile === 0,
        `${result} · open=${dbg.doors[0].open} · tile=${tile}`,
      );
      await saveCanvas("i03-door-open", true);
    });

    define("interaction", "i04-talk-cycle", async () => {
      await pose(8.5, 1.5, 0, Math.PI, 0);
      await step(0.1);
      const values = await hud();
      check("talk prompt appears near the guard", values.prompt.includes("talk to guard"), values.prompt);
      const first = await interact();
      await step(0.1);
      let guard = (await debug()).actors.find((actor) => actor.name === "guard");
      const firstToast = (await hud()).toast;
      const second = await interact();
      await step(0.1);
      guard = (await debug()).actors.find((actor) => actor.name === "guard");
      const secondToast = (await hud()).toast;
      check(
        "E puts the guard into the talk state",
        first === "talk" && second === "talk" && guard?.state === "talk",
        `${first}/${second} · ${guard?.state}`,
      );
      check(
        "talk lines advance on repeat use",
        firstToast.includes("GUARD") &&
          secondToast.includes("GUARD") &&
          firstToast !== secondToast,
        `"${firstToast}" -> "${secondToast}"`,
      );
      await capturePage("i04-talk");
    });

    define("interaction", "i05-medkit-heal", async () => {
      await setHealth(40);
      await pose(1.5, 21.5, 0, 0, 0);
      await step(0.1);
      const current = await state();
      const values = await hud();
      const medkit = (await debug()).pickups.find((pickup) => pickup.kind === "medkit");
      check(
        "the medkit restores 40 health",
        current.health === 80 && medkit?.taken === true,
        `health ${current.health} · taken=${medkit?.taken}`,
      );
      check("HUD health follows the pickup", values.health === "80 / 100", values.health);
    });

    define("interaction", "i06-fuel-refill", async () => {
      await setFuel(0.1);
      await pose(21.5, 12.5, 0, 0, 0);
      await step(0.1);
      const current = await state();
      const fuel = (await debug()).pickups.find((pickup) => pickup.kind === "fuel");
      check(
        "the fuel cell tops up the jetpack",
        current.fuel === 1 && fuel?.taken === true,
        `fuel ${current.fuel} · taken=${fuel?.taken}`,
      );
      check("HUD fuel reads full", (await hud()).fuel === "100%", (await hud()).fuel);
    });

    define("interaction", "i07-empty-interact", async () => {
      await pose(5.5, 4.5, 0, 0, 0);
      await step(0.1);
      const result = await interact();
      const values = await hud();
      check(
        "using E with nothing in reach reports nothing",
        result === "none" && values.toast.includes("NOTHING"),
        `${result} · "${values.toast}"`,
      );
      check("no prompt away from interactables", values.prompt === "", `"${values.prompt}"`);
    });

    // ---------------------------------------------------------------- combat
    define("combat", "f01-player-strike", async () => {
      await pose(17.0, 14.5, 0, 0, 0);
      await step(0.05);
      const hit = await attack();
      await step(0.1);
      const stalker = (await debug()).actors.find((actor) => actor.name === "stalker");
      check(
        "a forward strike damages the stalker",
        hit && stalker?.hp === 25,
        `hit=${hit} · hp=${stalker?.hp}`,
      );
      check("the hit puts the actor in hurt state", stalker?.state === "hurt", stalker?.state ?? "missing");
      await saveCanvas("f01-enemy-hurt", true);
    });

    define("combat", "f02-player-kill", async () => {
      await pose(17.0, 14.5, 0, 0, 0);
      await step(0.05);
      await attack();
      await step(0.5);
      const hit = await attack();
      await step(0.1);
      let dbg = await debug();
      let stalker = dbg.actors.find((actor) => actor.name === "stalker");
      check(
        "the second strike kills the stalker",
        hit && stalker?.state === "death" && stalker.hp === 0,
        `hit=${hit} · ${stalker?.state} · hp=${stalker?.hp}`,
      );
      const values = await hud();
      check("kill toast names the target", values.toast.includes("STALKER DOWN"), values.toast);
      await step(0.7);
      dbg = await debug();
      stalker = dbg.actors.find((actor) => actor.name === "stalker");
      const corpse = dbg.stats.spriteRects.find((rect) => rect.id === "stalker");
      check(
        "the corpse drops out of targeting but stays rendered",
        stalker?.alive === false && Boolean(corpse && corpse.pixels > 0),
        `alive=${stalker?.alive} · ${corpse?.pixels ?? 0} corpse px`,
      );
      await saveCanvas("f02-enemy-corpse", true);
    });

    define("combat", "f03-attack-arc", async () => {
      await pose(17.0, 14.5, 0, Math.PI, 0);
      const hit = await attack();
      const stalker = (await debug()).actors.find((actor) => actor.name === "stalker");
      check(
        "striking away from the target misses",
        hit === false && stalker?.hp === 70,
        `hit=${hit} · hp=${stalker?.hp}`,
      );
    });

    define("combat", "f04-attack-range", async () => {
      await pose(14.5, 14.5, 0, 0, 0);
      const hit = await attack();
      const stalker = (await debug()).actors.find((actor) => actor.name === "stalker");
      check(
        "targets beyond 2.3 m are out of reach",
        hit === false && stalker?.hp === 70,
        `hit=${hit} · hp=${stalker?.hp}`,
      );
    });

    define("combat", "f05-hostile-damage", async () => {
      await pose(17.6, 14.5, 0, 0, 0);
      await setHealth(100);
      await step(0.25);
      const current = await state();
      const values = await hud();
      const overlay = await evaluate<number>(
        'Number(document.getElementById("damage").style.opacity || 0)',
      );
      check(
        "the hostile strike damages the player",
        current.health < 100 && current.damageFlash > 0.5,
        `hp=${current.health} · flash=${current.damageFlash.toFixed(2)}`,
      );
      check("HUD health and damage vignette react", values.health !== "100 / 100" && overlay > 0.2, `${values.health} · overlay=${overlay.toFixed(2)}`);
      await capturePage("f05-player-hit");
    });

    define("combat", "f06-death-redeploy", async () => {
      await pose(17.6, 14.5, 0, 0, 0);
      await setHealth(1);
      await step(0.6);
      let current = await state();
      let values = await hud();
      const deadClass = await evaluate<boolean>(
        'document.getElementById("damage").classList.contains("dead")',
      );
      check(
        "a lethal hit downs the player",
        current.dead && current.health === 0,
        `dead=${current.dead} · hp=${current.health}`,
      );
      check("death HUD and overlay engage", values.health === "0 / 100" && deadClass, `${values.health} · deadOverlay=${deadClass}`);
      await capturePage("f06-player-dead");
      await step(1.4);
      current = await state();
      values = await hud();
      check(
        "redeploy restores spawn health",
        !current.dead &&
          current.health === 100 &&
          near(current.x, 3.5, 0.01) &&
          near(current.y, 1.5, 0.01),
        `hp=${current.health} at ${current.x.toFixed(2)},${current.y.toFixed(2)}`,
      );
      check("redeploy toast appears", values.toast.includes("REDEPLOYED"), values.toast);
      await capturePage("f06-redeployed");
    });

    define("combat", "f07-attack-cooldown", async () => {
      await pose(17.0, 14.5, 0, 0, 0);
      const first = await attack();
      const second = await attack();
      const stalker = (await debug()).actors.find((actor) => actor.name === "stalker");
      check(
        "the strike cooldown blocks immediate repeats",
        first === true && second === false && stalker?.hp === 25,
        `first=${first} second=${second} hp=${stalker?.hp}`,
      );
    });

    define("combat", "f08-enemy-windup", async () => {
      await pose(17.6, 14.5, 0, 0, 0);
      await step(0.05);
      const stalker = (await debug()).actors.find((actor) => actor.name === "stalker");
      check(
        "a hostile in range starts its attack animation",
        stalker?.state === "attack",
        stalker?.state ?? "missing",
      );
    });

    // ---------------------------------------------------------------- levels
    define("levels", "l01-transition-reactor", async () => {
      await pose(17.5, 9.5, 0, 0, 0);
      await step(0.1);
      await pose(8.4, 11.5, 0, 0, 0);
      await step(0.1);
      await interact();
      await pose(11.5, 11.5, 0, 0, 0);
      await step(0.05);
      const dbg = await debug();
      const values = await hud();
      check(
        "the lift pad loads the reactor deck",
        dbg.level === "reactor" && values.level === "REACTOR DECK",
        `${dbg.level} · ${values.level}`,
      );
      check(
        "the reactor spawn faces the terraces",
        near(dbg.player.x, 2.5, 0.01) && near(dbg.player.y, 20.5, 0.01),
        `${dbg.player.x.toFixed(2)}, ${dbg.player.y.toFixed(2)}`,
      );
      check("reactor objective updates", values.toast.includes("REACTOR DECK"), values.toast);
      await saveCanvas("l01-reactor-spawn", true);
    });

    define("levels", "l02-vault-return", async () => {
      await loadLevel("reactor");
      await pose(12.4, 9.5, 0, 0, 0);
      await step(0.1);
      const result = await interact();
      const opened = (await debug()).doors[0];
      check("the vault opens without a keycard", result === "door" && opened.open, `${result} · open=${opened.open}`);
      await pose(15.5, 9.5, 0, 0, 0);
      await step(0.05);
      const dbg = await debug();
      check("the beacon returns to the courtyard", dbg.level === "courtyard", dbg.level);
      check(
        "returning reloads the courtyard state",
        dbg.doors[0].open === false &&
          dbg.keycard === false &&
          dbg.pickups.every((pickup) => !pickup.taken),
        `door=${dbg.doors[0].open} keycard=${dbg.keycard}`,
      );
      await saveCanvas("l02-vault-return", true);
    });

    define("levels", "l03-terrace-climb", async () => {
      await loadLevel("reactor");
      await pose(9.5, 22.5, 0, -Math.PI / 2, 0);
      await press("KeyW");
      await step(0.8);
      let current = await state();
      const perch = (await hud()).mode;
      check(
        "walking up the stepped pyramid raises the player",
        current.z > 0.3 && current.onGround,
        `alt ${current.z.toFixed(2)} m · ${perch}`,
      );
      await saveCanvas("l03-terrace", true);
      await step(1.4);
      await release("KeyW");
      current = await state();
      check(
        "the terrace tops out and returns to floor level",
        current.y < 17 && current.z === 0,
        `y=${current.y.toFixed(2)} · alt ${current.z.toFixed(2)} m`,
      );
    });

    define("levels", "l04-reactor-hover", async () => {
      await loadLevel("reactor");
      await pose(2.5, 20.5, 0, 0, 0);
      let spark = (await debug()).actors.find((actor) => actor.name === "spark");
      const start = spark?.z ?? 0;
      await step(1.2);
      spark = (await debug()).actors.find((actor) => actor.name === "spark");
      const end = spark?.z ?? 0;
      check(
        "the reactor hover actor patrols its altitude",
        Math.abs(end - start) > 0.15 && end > 1.5 && end < 2.3,
        `z ${start.toFixed(2)} -> ${end.toFixed(2)}`,
      );
    });

    define("levels", "l05-beacon-loop", async () => {
      await loadLevel("reactor");
      await pose(15.5, 9.5, 0, 0, 0);
      await step(0.05);
      const dbg = await debug();
      const values = await hud();
      check(
        "the reactor beacon closes the loop",
        dbg.level === "courtyard" && values.level === "COURTYARD",
        `${dbg.level} · ${values.level}`,
      );
      check(
        "the courtyard objective is restored",
        values.toast.includes("COURTYARD"),
        values.toast,
      );
    });

    // ------------------------------------------------------------------ run
    for (const scenario of scenarios) {
      currentScenario = scenario.id;
      currentGroup = scenario.group;
      await reset();
      await scenario.run();
      await step(0);
      if (!captures.some((capture) => capture.name === scenario.id)) {
        await saveCanvas(scenario.id, !scenario.volatile);
      }
      await universalChecks();
    }

    check("no page errors", consoleErrors.length === 0, `${consoleErrors.length} errors`);

    const failed = checks.filter((entry) => !entry.ok);
    const report = {
      generatedAt: new Date().toISOString(),
      url: pageUrl,
      durationMs: Date.now() - startedAt,
      scenarios: scenarios.map((scenario) => scenario.id),
      passed: checks.length - failed.length,
      failed: failed.length,
      checks,
      captures,
      consoleErrors,
      sheet: join(outDir, "contact-sheet.png"),
    };
    writeFileSync(
      join(outDir, "report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    composeSheet(
      captures.filter((capture) => capture.kind === "canvas"),
      join(outDir, "contact-sheet.png"),
      outDir,
    );

    console.log(
      `\nMATRIX ${failed.length === 0 ? "PASSED" : "FAILED"} — ${checks.length - failed.length}/${checks.length} checks across ${scenarios.length} scenarios`,
    );
    console.log(`contact sheet: ${join(outDir, "contact-sheet.png")}`);
    if (failed.length > 0) process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    devServer?.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
