import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { Browser, sleep } from "./cdp";
import type { HudState } from "../../src/game";

const root = resolve(import.meta.dirname, "../..");
const outDir = join(root, "docs/screenshots/playtest");
const port = 5199;

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const checks: Check[] = [];
const consoleErrors: string[] = [];
const screenshots: string[] = [];

function check(name: string, ok: boolean, detail: string): void {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
}

function near(value: number, target: number, tolerance: number): boolean {
  return Math.abs(value - target) <= tolerance;
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

async function waitForGame(browser: Browser): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const ready = await browser.evaluate<boolean>(
        "Boolean(window.__raycast) && document.getElementById('loading').classList.contains('hidden')",
      );
      if (ready) return;
    } catch {
      // Page is still evaluating modules.
    }
    await sleep(150);
  }
  throw new Error("The game did not finish booting");
}

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true });

  const devServer = startDevServer();
  let browser: Browser | undefined;
  try {
    const url = `http://127.0.0.1:${port}/?screenshot`;
    await waitForHttp(url);
    browser = await Browser.launch(9400 + Math.floor(Math.random() * 400), url);
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

    await waitForGame(browser);
    const atlases = await browser.evaluate<Array<{ name: string; directions: number; pitches: number; frames: number }>>(
      `Promise.all(["guardian", "scout", "brute"].map(async (name) => {
        const response = await fetch("/assets/sprites/" + name + "/atlas.json");
        const manifest = await response.json();
        return { name: manifest.name, directions: manifest.directions, pitches: manifest.pitches, frames: manifest.frames.length };
      }))`,
    );
    check(
      "three 16-way character atlases load",
      atlases.length === 3 &&
        atlases.every(
          (atlas) => atlas.directions === 16 && atlas.pitches === 3 && atlas.frames === 288,
        ),
      atlases.map((atlas) => `${atlas.name}:${atlas.directions}x${atlas.pitches}/${atlas.frames}`).join(", "),
    );

    await browser.evaluate("window.__raycast.automation.enable()");
    await sleep(250);

    const state = (): Promise<HudState> =>
      browser!.evaluate<HudState>("window.__raycast.automation.state()");
    const pose = async (
      x: number,
      y: number,
      z: number,
      yaw: number,
      pitch: number,
    ): Promise<void> => {
      await browser!.evaluate(
        `window.__raycast.setPose(${x}, ${y}, ${z}, ${yaw}, ${pitch})`,
      );
      await sleep(180);
    };
    const press = async (code: string): Promise<void> => {
      await browser!.evaluate(`window.__raycast.automation.press(${JSON.stringify(code)})`);
    };
    const release = async (code: string): Promise<void> => {
      await browser!.evaluate(`window.__raycast.automation.release(${JSON.stringify(code)})`);
    };
    const shot = async (name: string): Promise<void> => {
      const path = join(outDir, `${name}.png`);
      await browser!.screenshot(path);
      screenshots.push(path);
      console.log(`SHOT  ${name}`);
    };

    await pose(3.5, 1.5, 0, 0, 0);
    await shot("01-ground-spawn");

    await pose(11.5, 4.5, 0, 0, 0);
    await shot("02-ground-open");

    await pose(3.5, 1.5, 0, 0, 0);
    await press("KeyW");
    await sleep(600);
    await release("KeyW");
    let current = await state();
    check(
      "forward input follows camera yaw",
      current.x > 4.7 && near(current.y, 1.5, 0.05),
      `moved to ${current.x.toFixed(2)}, ${current.y.toFixed(2)}`,
    );

    await pose(5.5, 4.5, 0, 0, 0);
    await press("KeyD");
    await sleep(400);
    await release("KeyD");
    current = await state();
    check(
      "strafe right maps to screen-right",
      current.y > 5.4 && near(current.x, 5.5, 0.15),
      `moved to ${current.x.toFixed(2)}, ${current.y.toFixed(2)}`,
    );

    await pose(5.5, 4.5, 0, 0, 0);
    await browser.evaluate("window.__raycast.automation.look(200, 0)");
    await sleep(160);
    current = await state();
    check(
      "mouse-right turns camera clockwise",
      current.yawDeg >= 18 && current.yawDeg <= 32,
      `yaw is ${current.yawDeg} deg`,
    );

    await pose(1.5, 1.5, 0, Math.PI, 0);
    await press("KeyW");
    await sleep(900);
    await release("KeyW");
    current = await state();
    check(
      "wall collision stops the player",
      current.x > 1.02 && current.x < 1.32,
      `stopped at x=${current.x.toFixed(2)}`,
    );

    await pose(5.5, 4.5, 0, 0, 0);
    await press("Space");
    await sleep(900);
    current = await state();
    await shot("03-jetpack-burn");
    check(
      "jetpack produces sustained lift",
      current.thrusting && current.z > 2 && current.fuel < 0.95,
      `alt ${current.z.toFixed(2)} m, fuel ${current.fuel.toFixed(2)}`,
    );
    const burnFuel = current.fuel;
    await release("Space");
    await sleep(2600);
    current = await state();
    check(
      "player lands and refuels",
      current.z <= 0.001 && !current.thrusting && current.fuel > burnFuel,
      `alt ${current.z.toFixed(2)} m, fuel ${current.fuel.toFixed(2)}`,
    );

    await pose(5.5, 4.5, 17.9, 0, -0.2);
    await press("Space");
    await sleep(600);
    current = await state();
    await release("Space");
    check(
      "altitude ceiling holds",
      near(current.z, 18, 0.02),
      `alt ${current.z.toFixed(2)} m`,
    );

    await pose(5.5, 4.5, 0, 0, -1.2);
    current = await state();
    check(
      "ground pitch is clamped",
      near(current.pitchDeg, -63, 2),
      `pitch ${current.pitchDeg} deg`,
    );

    await pose(5.5, 4.5, 8, 0, -1.0);
    current = await state();
    check(
      "airborne pitch unlocks",
      current.pitchDeg < -48,
      `pitch ${current.pitchDeg} deg`,
    );

    await pose(5.5, 1.5, 0, 0, 0);
    await sleep(120);
    current = await state();
    await shot("04-guard-front");
    check(
      "camera in front selects yaw frame 0",
      current.nearestName === "guard" && current.nearestYaw === 0,
      `${current.nearestName} yaw ${current.nearestYaw}`,
    );

    await pose(9.5, 1.5, 0, Math.PI, 0);
    await sleep(120);
    current = await state();
    await shot("05-guard-back");
    check(
      "camera behind selects yaw frame 8",
      current.nearestName === "guard" && current.nearestYaw === 8,
      `${current.nearestName} yaw ${current.nearestYaw}`,
    );

    await pose(15.5, 9.5, 0, 0, 0);
    await sleep(900); // watcher lerps toward the player before it settles on yaw 0
    current = await state();
    await shot("11-scout-front");
    check(
      "scout chassis renders at yaw 0",
      current.nearestName === "sentinel" &&
        current.nearestSprite === "scout" &&
        current.nearestYaw === 0,
      `${current.nearestName}/${current.nearestSprite} yaw ${current.nearestYaw}`,
    );

    await pose(12.5, 19.5, 0, Math.PI / 2, 0);
    await sleep(120);
    current = await state();
    await shot("12-brute-front");
    check(
      "brute chassis renders at yaw 0",
      current.nearestName === "warden" &&
        current.nearestSprite === "brute" &&
        current.nearestYaw === 0,
      `${current.nearestName}/${current.nearestSprite} yaw ${current.nearestYaw}`,
    );

    await pose(11.5, 12.5, 8, 0, -0.5);
    await shot("06-midair");
    current = await state();
    check(
      "midair altitude registers",
      current.z > 6.8 && current.z <= 8 && current.nearestPitch === 2,
      `alt ${current.z.toFixed(2)} m, sprite pitch ${current.nearestPitch}`,
    );

    await pose(11.5, 12.5, 16, 0, -1.0);
    await shot("07-aerial-down");
    await pose(11.5, 12.5, 16, Math.PI / 2, 0);
    await shot("08-aerial-level");
    await pose(11.5, 9.5, 11, 0, -0.75);
    await shot("09-overview");
    await pose(11.5, 12.5, 17.5, 0, -0.9);
    await shot("10-aerial-topdown");

    check("no page errors", consoleErrors.length === 0, `${consoleErrors.length} errors`);
  } finally {
    if (browser) await browser.close();
    devServer.kill("SIGTERM");
  }

  const failed = checks.filter((entry) => !entry.ok);
  const report = {
    generatedAt: new Date().toISOString(),
    url: `http://127.0.0.1:${port}/?screenshot`,
    passed: checks.length - failed.length,
    failed: failed.length,
    checks,
    consoleErrors,
    screenshots,
  };
  writeFileSync(
    join(outDir, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  console.log(
    `\n${failed.length === 0 ? "PLAYTEST PASSED" : "PLAYTEST FAILED"} — ${checks.length - failed.length}/${checks.length} checks`,
  );
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
