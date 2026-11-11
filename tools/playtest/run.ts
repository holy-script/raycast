import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { Browser, sleep } from "./cdp";
import type { HudState, RenderDebug } from "../../src/game";

const root = resolve(import.meta.dirname, "../..");
const outDir = process.env.PLAYTEST_OUT
  ? resolve(process.env.PLAYTEST_OUT)
  : join(root, "docs/screenshots/playtest");
const port = 5199;

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const remoteUrl = argValue("--url");
const pageUrl = remoteUrl
  ? remoteUrl.includes("?")
    ? remoteUrl
    : `${remoteUrl}?screenshot`
  : `http://127.0.0.1:${port}/?screenshot`;

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

  const devServer = remoteUrl ? undefined : startDevServer();
  let browser: Browser | undefined;
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
          (atlas) => atlas.directions === 16 && atlas.pitches === 4 && atlas.frames === 384,
        ),
      atlases.map((atlas) => `${atlas.name}:${atlas.directions}x${atlas.pitches}/${atlas.frames}`).join(", "),
    );

    await browser.evaluate("window.__raycast.automation.enable()");
    await sleep(250);

    const state = (): Promise<HudState> =>
      browser!.evaluate<HudState>("window.__raycast.automation.state()");
    const debug = (): Promise<RenderDebug> =>
      browser!.evaluate<RenderDebug>("window.__raycast.debug()");
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
      current.z > 6.8 && current.z <= 8 && current.nearestPitch === 3,
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

    // Regression: wall faces used to be skipped entirely once the eye rose above
    // the wall height, leaving only tops and floor visible ("transparent" walls).
    await pose(11.5, 6.5, 2, Math.PI / 2, -0.3);
    let dbg = await debug();
    await shot("13-airborne-walls");
    check(
      "wall faces stay opaque while airborne",
      dbg.stats.wallColumns > 200 && dbg.stats.wallPixels > 8000,
      `${dbg.stats.wallColumns} cols, ${dbg.stats.wallPixels} wall px`,
    );

    // Regression: a wall crossing the near plane returned NaN and the whole
    // column was dropped, so walls vanished when standing against them.
    await pose(1.22, 1.5, 0, Math.PI, 0);
    dbg = await debug();
    await shot("14-close-wall");
    check(
      "close wall fills the screen instead of vanishing",
      dbg.stats.wallColumns === 384 && dbg.stats.wallPixels > 85_000,
      `${dbg.stats.wallColumns} cols, ${dbg.stats.wallPixels} wall px`,
    );

    await pose(1.22, 1.5, 0, Math.PI, -1.1);
    dbg = await debug();
    await shot("15-close-wall-lookdown");
    check(
      "near wall survives a steep look-down",
      dbg.stats.wallColumns === 384 && dbg.stats.wallPixels > 20_000,
      `${dbg.stats.wallColumns} cols, ${dbg.stats.wallPixels} wall px`,
    );

    // Regression: vertical billboards collapsed to 1 px and their horizontal
    // projection divided by a near-zero distance when looking straight down.
    await pose(7.5, 1.58, 14, 0, -1.45);
    dbg = await debug();
    await shot("16-overhead-sprite");
    const guardRect = dbg.stats.spriteRects.find((rect) => rect.id === "guard");
    check(
      "overhead sprite keeps a readable 2D silhouette",
      Boolean(
        guardRect &&
          guardRect.visible &&
          guardRect.contentW >= 4 &&
          guardRect.contentH >= 6 &&
          guardRect.pixels >= 24,
      ),
      guardRect
        ? `silhouette ${guardRect.contentW}x${guardRect.contentH} px, ${guardRect.pixels} opaque px in a ${guardRect.w.toFixed(1)}px frame`
        : "guard not projected",
    );
    check(
      "overhead sprite stays centred instead of sliding off-screen",
      Boolean(guardRect && Math.abs(guardRect.x - 192) < 48),
      guardRect ? `x=${guardRect.x.toFixed(1)}` : "guard not projected",
    );

    await pose(21.5, 4.58, 14, 0, -1.45);
    dbg = await debug();
    const tinkerRect = dbg.stats.spriteRects.find((rect) => rect.id === "tinker");
    await shot("17-overhead-edge-actor");
    check(
      "overhead actor near the map edge stays in view",
      Boolean(tinkerRect && tinkerRect.visible && Math.abs(tinkerRect.x - 192) < 48),
      tinkerRect ? `x=${tinkerRect.x.toFixed(1)}, visible=${tinkerRect.visible}` : "tinker not projected",
    );

    // Wall-top landing: solid cells support the player at WALL_HEIGHT.
    await pose(3.5, 2.5, 3, 0, -0.4);
    await sleep(900);
    current = await state();
    await shot("18-wall-landing");
    check(
      "player lands on a wall top",
      near(current.z, 1.4, 0.03) && current.onGround && near(current.support, 1.4, 0.01),
      `alt ${current.z.toFixed(2)} m, support ${current.support.toFixed(2)}, grounded ${current.onGround}`,
    );

    await press("KeyS");
    await sleep(700);
    await release("KeyS");
    await sleep(800);
    current = await state();
    await shot("19-wall-stepoff");
    check(
      "stepping off a wall drops back to the floor",
      current.z <= 0.001 && current.support <= 0.001,
      `alt ${current.z.toFixed(2)} m, support ${current.support.toFixed(2)}`,
    );

    // M5: per-cell heights. Digits 1-9 build steps and platforms the player can
    // walk onto; the ground floor stays the zero plane.
    await pose(11.5, 22.5, 0, -Math.PI / 2, 0);
    await shot("20-stairs-approach");
    await press("KeyW");
    await sleep(1050);
    await release("KeyW");
    current = await state();
    await shot("21-stairs-climbed");
    check(
      "walking up two steps lands on the 0.4 platform",
      near(current.support, 0.4, 0.01) &&
        near(current.z, 0.4, 0.01) &&
        current.onGround &&
        current.y < 20.6,
      `alt ${current.z.toFixed(2)} m, support ${current.support.toFixed(2)}, y=${current.y.toFixed(2)}`,
    );

    await pose(11.5, 22.5, 0, -Math.PI / 2, -0.25);
    dbg = await debug();
    await shot("22-stairs-from-ground");
    await pose(11.5, 22.5, 3.5, -Math.PI / 2, -0.65);
    await shot("26-stairs-overhead");
    check(
      "stepped blocks render their top surfaces",
      dbg.stats.topPixels > 500,
      `${dbg.stats.topPixels} top px, ${dbg.stats.wallPixels} wall px`,
    );

    // A 0.6 crate is taller than STEP_UP but low enough to land on.
    await pose(4.5, 15.5, 0, -Math.PI / 2, 0);
    await press("KeyW");
    await sleep(700);
    await release("KeyW");
    current = await state();
    await shot("23-crate-block");
    check(
      "a 0.6 crate blocks walking without a jump",
      current.y > 14.1 && near(current.support, 0, 0.01),
      `stopped at y=${current.y.toFixed(2)}, support ${current.support.toFixed(2)}`,
    );

    await pose(4.5, 15.5, 0, -Math.PI / 2, 0);
    dbg = await debug();
    const blockedScholar = dbg.stats.spriteRects.find(
      (rect) => rect.id === "scholar",
    );
    await shot("24-crate-occlusion");
    check(
      "the crate occludes the scholar behind it",
      Boolean(
        blockedScholar &&
          blockedScholar.visible &&
          blockedScholar.pixels > 0 &&
          blockedScholar.occluded > 100,
      ),
      blockedScholar
        ? `${blockedScholar.pixels} drawn, ${blockedScholar.occluded} occluded px`
        : "scholar not projected",
    );

    await pose(4.5, 13.5, 3, 0, -1.2);
    await sleep(900);
    current = await state();
    await shot("25-crate-perch");
    check(
      "landing on the crate stops at its 0.6 surface",
      near(current.z, 0.6, 0.02) &&
        near(current.support, 0.6, 0.01) &&
        current.onGround,
      `alt ${current.z.toFixed(2)} m, support ${current.support.toFixed(2)}, grounded ${current.onGround}`,
    );

    check("no page errors", consoleErrors.length === 0, `${consoleErrors.length} errors`);
  } finally {
    if (browser) await browser.close();
    devServer?.kill("SIGTERM");
  }

  const failed = checks.filter((entry) => !entry.ok);
  const report = {
    generatedAt: new Date().toISOString(),
    url: pageUrl,
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
