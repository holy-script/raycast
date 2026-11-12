import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PNG } from "pngjs";
import { Browser, sleep } from "./cdp";
import {
  composeSheet,
  imageMetrics,
  ratioDiff,
  startDevServer,
  waitForHttp,
} from "./support";
import type { HudState, RenderDebug } from "../../src/game";
import type { AudioDebug } from "../../src/engine/audio";
import { CAMPAIGN_LEVELS } from "../../src/campaign";
import { LEVELS } from "../../src/content/levels";

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

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true });

  const devServer = remoteUrl ? undefined : startDevServer(root, port);
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
      evaluate<Record<string, string>>(`(() => {        const text = (id) => (document.getElementById(id)?.textContent ?? "").trim();
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
          objective: text("hud-objective"),
          bossName: text("hud-boss-name"),
          boss: text("hud-boss"),
          victory:
            document.getElementById("victory")?.classList.contains("hidden") === false
              ? "shown"
              : "",
          victoryStats: text("victory-stats"),
          prompt: text("prompt"),
          toast: text("toast"),
        };
      })()`);

    const audioMix = (): Promise<AudioDebug> =>
      evaluate<AudioDebug>("window.__raycast.audioDebug()");

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
      // Every scenario starts from the courtyard so level and campaign state
      // cannot leak between runs.
      await evaluate("window.__raycast.campaign.reset()");
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

    define("ui", "u08-campaign-menu", async () => {
      type CampaignView = {
        open: boolean;
        selected: string | null;
        cards: Array<{ id: string; locked: boolean; selected: boolean; stats: string }>;
        briefing: {
          hidden: boolean;
          title: string;
          stats: string;
          deployDisabled: boolean;
        };
      };
      const view = (): Promise<CampaignView> =>
        evaluate<CampaignView>("window.__raycast.campaign.view()");
      const expectedCards = CAMPAIGN_LEVELS.filter((id) =>
        LEVELS.some((level) => level.id === id),
      ).length;

      await evaluate("window.__raycast.campaign.reset()");
      await evaluate("window.__raycast.campaign.open()");
      await step(0);
      let menu = await view();
      const card = (id: string) => menu.cards.find((entry) => entry.id === id);
      check(
        "a fresh campaign unlocks only the courtyard",
        menu.open &&
          menu.cards.length === expectedCards &&
          card("courtyard")?.locked === false &&
          menu.cards
            .filter((entry) => entry.id !== "courtyard")
            .every((entry) => entry.locked) &&
          card("courtyard")?.stats === "NO CLEAR",
        menu.cards.map((entry) => `${entry.id}:${entry.locked ? "locked" : "open"}`).join(" "),
      );
      await evaluate('window.__raycast.campaign.select("district")');
      menu = await view();
      check(
        "a locked card opens its briefing with deploy disabled",
        !menu.briefing.hidden &&
          menu.briefing.deployDisabled &&
          menu.briefing.title === "ROOFTOP DISTRICT" &&
          menu.briefing.stats.includes("LOCKED"),
        `${menu.briefing.title} · ${menu.briefing.stats}`,
      );
      await capturePage("u08-campaign-menu");

      const lockedDeploy = await evaluate<boolean>(
        'window.__raycast.campaign.deploy("district")',
      );
      check(
        "a locked level cannot be deployed",
        lockedDeploy === false,
        `deploy district returned ${lockedDeploy}`,
      );

      const deployed = await evaluate<boolean>(
        'window.__raycast.campaign.deploy("courtyard")',
      );
      await step(0);
      menu = await view();
      const dbg = await debug();
      check(
        "deploying an unlocked level closes the menu and loads it",
        deployed && !menu.open && dbg.level === "courtyard",
        `deployed=${deployed} · open=${menu.open} · level=${dbg.level}`,
      );

      await loadLevel("district");
      await evaluate("window.__raycast.campaign.open()");
      await step(0);
      menu = await view();
      const stored = await evaluate<{ reached: string[]; lastLevel: string }>(
        'JSON.parse(localStorage.getItem("raycast.campaign.v1"))',
      );
      check(
        "reaching a level unlocks its card and persists it",
        card("district")?.locked === false &&
          card("district")?.stats === "NO CLEAR" &&
          stored.reached.includes("district") &&
          stored.lastLevel === "district",
        `${card("district")?.stats ?? "missing"} · reached ${stored.reached.join(",")}`,
      );
      await evaluate("window.__raycast.campaign.close()");
      await step(0);
      check(
        "closing the menu returns to the frozen simulation",
        (await view()).open === false,
        "menu closed",
      );
    });

    // ----------------------------------------------------------------- audio
    define("audio", "n01-courtyard-mix", async () => {
      await step(0.5);
      const values = await audioMix();
      check(
        "the courtyard runs its outdoor ambience bed",
        values.bed === "courtyard",
        values.bed,
      );
      check(
        "the music stays calm before any hunting",
        values.intensity > 0.05 && values.intensity < 0.4,
        values.intensity.toFixed(3),
      );
      check(
        "every layer scales from the intensity",
        near(values.bass, 0.18 + values.intensity * 0.3, 1e-6) &&
          near(values.pad, 0.12 + values.intensity * 0.28, 1e-6) &&
          near(values.percussion, 0.05 + values.intensity * 0.4, 1e-6),
        `bass ${values.bass.toFixed(3)} · pad ${values.pad.toFixed(3)} · perc ${values.percussion.toFixed(3)}`,
      );
    });

    define("audio", "n02-reactor-bed", async () => {
      await loadLevel("reactor");
      await step(0);
      const values = await audioMix();
      check(
        "the reactor deck retunes to its industrial bed",
        values.bed === "reactor",
        values.bed,
      );
    });

    define("audio", "n03-indoor-bed", async () => {
      await loadLevel("district");
      await pose(6.5, 6.5, 0, 0, 0);
      await step(0);
      const current = await state();
      const values = await audioMix();
      check(
        "standing under a ceiling switches to the indoor bed",
        current.ceiling > 0 && values.bed === "indoor",
        `ceiling ${current.ceiling.toFixed(2)} · ${values.bed}`,
      );
    });

    define("audio", "n04-boss-swings-music", async () => {
      await loadLevel("district");
      await step(0.2);
      const hunt = await audioMix();
      await evaluate(`(() => {
        const game = window.__raycast.game;
        for (const actor of game.actors) {
          if (actor.spec.hostile && !actor.spec.boss) game.damageActor(actor, 999);
        }
      })()`);
      await step(0);
      const dbg = await debug();
      const boss = await audioMix();
      check(
        "the boss stage drives the mix harder than the hunt",
        dbg.mission.stage === "boss" && boss.intensity > hunt.intensity,
        `${dbg.mission.stage} · ${hunt.intensity.toFixed(2)} → ${boss.intensity.toFixed(2)}`,
      );
    });

    define("audio", "n05-low-health-heartbeat", async () => {
      await loadLevel("district");
      await setHealth(20);
      await step(0);
      const weak = await audioMix();
      check("low health starts the heartbeat", weak.lowHealth, String(weak.lowHealth));
      await setHealth(90);
      await step(0);
      const healthy = await audioMix();
      check(
        "healing above a third stops the heartbeat",
        !healthy.lowHealth,
        String(healthy.lowHealth),
      );
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
    define("combat", "f01-player-shot", async () => {
      await pose(17.0, 14.5, 0, 0, 0);
      await step(0.05);
      const hit = await attack();
      await step(0.1);
      const stalker = (await debug()).actors.find((actor) => actor.name === "stalker");
      check(
        "a plasma bolt damages the stalker",
        hit && stalker?.hp === 25,
        `fired=${hit} · hp=${stalker?.hp}`,
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
        "the second bolt kills the stalker",
        hit && stalker?.state === "death" && stalker.hp === 0,
        `fired=${hit} · ${stalker?.state} · hp=${stalker?.hp}`,
      );
      const values = await hud();
      check("kill toast names the target", values.toast.includes("STALKER DOWN"), values.toast);
      await step(0.3);
      const midDeath = (await debug()).actors.find(
        (actor) => actor.name === "stalker",
      );
      await evaluate(`(() => {
        const game = window.__raycast.game;
        const actor = game.actors.find((entry) => entry.spec.name === "stalker");
        if (actor) game.damageActor(actor, 999);
      })()`);
      await step(0);
      const afterDeath = (await debug()).actors.find(
        (actor) => actor.name === "stalker",
      );
      check(
        "re-hitting a dying enemy does not restart the death animation",
        (midDeath?.frameIndex ?? 0) > 0 &&
          afterDeath?.state === "death" &&
          afterDeath?.frameIndex === midDeath?.frameIndex,
        `frame ${midDeath?.frameIndex} → ${afterDeath?.frameIndex}`,
      );
      await step(0.7);
      dbg = await debug();
      stalker = dbg.actors.find((actor) => actor.name === "stalker");
      const corpse = dbg.stats.spriteRects.find((rect) => rect.id === "stalker");
      check(
        "the corpse drops out of targeting but stays rendered",
        stalker?.alive === false &&
          near(stalker.worldSize, 1.33, 0.02) &&
          Boolean(corpse && corpse.pixels > 0),
        `alive=${stalker?.alive} · size=${stalker?.worldSize.toFixed(2) ?? "?"} m · ${corpse?.pixels ?? 0} corpse px`,
      );
      await saveCanvas("f02-enemy-corpse", true);
    });

    define("combat", "f03-bolt-miss", async () => {
      await pose(17.0, 14.5, 0, Math.PI, 0);
      const fired = await attack();
      await step(0.2);
      const stalker = (await debug()).actors.find((actor) => actor.name === "stalker");
      check(
        "firing away from the target misses",
        fired === true && stalker?.hp === 70,
        `fired=${fired} · hp=${stalker?.hp}`,
      );
    });

    define("combat", "f04-bolt-travel", async () => {
      await pose(14.5, 14.5, 0, 0, 0);
      const fired = await attack();
      await step(0.25);
      const stalker = (await debug()).actors.find((actor) => actor.name === "stalker");
      check(
        "bolts cross four metres in flight time",
        fired === true && stalker?.hp === 25,
        `fired=${fired} · hp=${stalker?.hp}`,
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

    define("combat", "f07-fire-cooldown", async () => {
      await pose(17.0, 14.5, 0, 0, 0);
      const first = await attack();
      const second = await attack();
      await step(0.1);
      const stalker = (await debug()).actors.find((actor) => actor.name === "stalker");
      check(
        "the fire cooldown blocks immediate repeats",
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

    define("combat", "f09-bolt-blocked", async () => {
      await pose(11.5, 4.5, 0, -Math.PI / 2, 0);
      const fired = await attack();
      await step(0.25);
      const dbg = await debug();
      check(
        "a bolt fired into the wall is absorbed",
        fired && dbg.bolts.length === 0,
        `fired=${fired} · ${dbg.bolts.length} bolts in flight`,
      );
      await saveCanvas("f09-bolt-wall", true);
    });

    define("combat", "f10-enemy-gun", async () => {
      await pose(17.0, 22.5, 0, 0, 0);
      await setHealth(100);
      await step(0.5);
      const firing = await debug();
      const shotInFlight = firing.bolts.some((bolt) => !bolt.fromPlayer);
      check(
        "the marauder winds up and fires a bolt",
        shotInFlight,
        `${firing.bolts.length} bolts in flight`,
      );
      await saveCanvas("f10-enemy-bolt", true);
      await step(0.4);
      const current = await state();
      check(
        "the hostile bolt damages the player",
        current.health < 100 && current.damageFlash > 0,
        `hp=${current.health} · flash=${current.damageFlash.toFixed(2)}`,
      );
      await capturePage("f10-enemy-shot");
    });

    define("combat", "f11-muzzle-spawn", async () => {
      await pose(5.5, 4.5, 0, 0, 0);
      const fired = await attack();
      await step(0);
      const bolt = (await debug()).bolts.find((entry) => entry.fromPlayer);
      check(
        "the bolt leaves the projector, not the eye",
        fired &&
          Boolean(
            bolt &&
              near(bolt.x, 5.85, 0.01) &&
              near(bolt.y, 4.68, 0.01) &&
              near(bolt.z, 0.47, 0.01),
          ),
        bolt
          ? `${bolt.x.toFixed(2)}, ${bolt.y.toFixed(2)}, ${bolt.z.toFixed(2)}`
          : "no bolt",
      );
    });

    define("combat", "f12-crate-destroy", async () => {
      await loadLevel("district");
      // Stand in the open lane south of the crate at cell (34, 9).
      await pose(34.5, 13.5, 0, -Math.PI / 2, 0);
      const cell = (): Promise<{ tile: number; height: number; solid: boolean }> =>
        evaluate<{ tile: number; height: number; solid: boolean }>(
          "window.__raycast.automation.cell(34, 9)",
        );
      const before = await cell();
      check(
        "the district crate starts solid",
        before.solid && near(before.height, 1.4, 0.001),
        `tile ${before.tile} · height ${before.height.toFixed(2)}`,
      );
      const first = await attack();
      await step(0.5);
      const afterOne = await cell();
      check(
        "one bolt does not destroy the crate",
        first && afterOne.solid,
        `fired=${first} · solid=${afterOne.solid}`,
      );
      const chipped = await hud();
      check(
        "the first bolt reports a crack toast",
        chipped.toast.includes("CRATE CRACKED"),
        chipped.toast,
      );
      const second = await attack();
      await step(0.25);
      const afterTwo = await cell();
      const values = await hud();
      check(
        "the second bolt clears the crate cell",
        second &&
          !afterTwo.solid &&
          afterTwo.tile === 0 &&
          afterTwo.height === 0,
        `fired=${second} · tile ${afterTwo.tile} · height ${afterTwo.height}`,
      );
      check(
        "crate destruction reports a toast",
        values.toast.includes("CRATE DESTROYED"),
        values.toast,
      );
    });

    // ------------------------------------------------------- mission boss
    define("combat", "f13-boss-encounter", async () => {
      await loadLevel("district");
      // Stand on the overseer's 12 m roof, well inside its 18 m envelope, and
      // face the boss so the capture frames the encounter.
      await pose(54.5, 46.5, 12, Math.atan2(41.5 - 46.5, 51.5 - 54.5), 0);
      await step(0.45);
      const dbg = await debug();
      const current = await state();
      const values = await hud();
      const volley = dbg.bolts.filter((bolt) => !bolt.fromPlayer && bolt.z > 11);
      check(
        "the overseer fires a three-bolt volley",
        volley.length >= 3,
        `${volley.length} inbound bolts`,
      );
      check(
        "the boss bar reports the overseer",
        current.boss?.name === "OVERSEER" &&
          current.boss.maxHp === 260 &&
          current.boss.hp <= 260 &&
          current.boss.hp > 0 &&
          values.bossName === "OVERSEER" &&
          values.boss.includes("/ 260"),
        current.boss
          ? `${values.bossName} ${values.boss} · ${current.boss.distance.toFixed(1)} m`
          : "no boss in range",
      );
      const coverA = await evaluate<{ solid: boolean; height: number }>(
        "window.__raycast.automation.cell(54, 42)",
      );
      const coverB = await evaluate<{ solid: boolean; height: number }>(
        "window.__raycast.automation.cell(56, 44)",
      );
      check(
        "two cover risers flank the overseer's roof",
        coverA.solid &&
          coverB.solid &&
          near(coverA.height, 12.6, 0.01) &&
          near(coverB.height, 12.6, 0.01),
        `${coverA.height.toFixed(2)} m · ${coverB.height.toFixed(2)} m`,
      );
      await capturePage("f13-boss-encounter");
      await evaluate(`(() => {
        const game = window.__raycast.game;
        for (const actor of game.actors) {
          if (actor.spec.hostile && !actor.spec.boss) game.damageActor(actor, 999);
        }
      })()`);
      await step(0);
      const staged = await debug();
      const stagedHud = await hud();
      check(
        "clearing the hunt exposes the boss stage",
        staged.mission.stage === "boss" &&
          staged.hunt.kills === 7 &&
          stagedHud.objective.includes("overseer"),
        `${staged.mission.stage} · ${staged.hunt.kills}/${staged.hunt.targets} · ${stagedHud.objective}`,
      );
    });

    define("combat", "f14-lancer-charge", async () => {
      await loadLevel("district");
      // Isolate the lancer so its charged shot is the only inbound threat.
      await evaluate(`(() => {
        const game = window.__raycast.game;
        for (const actor of game.actors) {
          if (actor.spec.hostile && actor.spec.name !== "spire-se") {
            game.damageActor(actor, 999);
          }
        }
      })()`);
      // Stand on the lancer's own roof so the charge glow reads at close range;
      // the level south of its north-edge perch keeps the sight line clear.
      await pose(55.5, 47.5, 12, -Math.PI / 2, 0);
      await setHealth(100);
      await step(0.5);
      const winding = (await debug()).actors.find(
        (actor) => actor.name === "spire-se",
      );
      const charge = winding?.charge ?? 0;
      check(
        "the lancer telegraphs a charged shot",
        winding?.state === "attack" && charge > 0.2 && charge < 1,
        `state=${winding?.state ?? "missing"} · charge=${charge.toFixed(2)}`,
      );
      await saveCanvas("f14-lancer-charge", true);
      await step(0.45);
      const beforeShot = await debug();
      check(
        "the bolt is held until the telegraph completes",
        beforeShot.bolts.every((bolt) => bolt.fromPlayer),
        `${beforeShot.bolts.length} bolts before release`,
      );
      await step(0.25);
      const firing = await debug();
      check(
        "the bolt releases after the telegraph",
        firing.bolts.some((bolt) => !bolt.fromPlayer),
        `${firing.bolts.filter((bolt) => !bolt.fromPlayer).length} inbound bolts`,
      );
      await step(1);
      const current = await state();
      check(
        "the charged bolt lands for heavy damage",
        near(current.health, 80, 1),
        `hp=${current.health}`,
      );
      await capturePage("f14-lancer-shot");
    });

    define("combat", "f15-bulwark-armor", async () => {
      await loadLevel("district");
      const result = await evaluate<{
        facing: number;
        afterFront: number;
        afterBack: number;
      } | null>(`(() => {
        const game = window.__raycast.game;
        const actor = game.actors.find((entry) => entry.spec.name === "bulwark");
        if (!actor) return null;
        const ahead = {
          x: actor.x + Math.cos(actor.facing) * 2,
          y: actor.y + Math.sin(actor.facing) * 2,
        };
        const behind = {
          x: actor.x - Math.cos(actor.facing) * 2,
          y: actor.y - Math.sin(actor.facing) * 2,
        };
        game.damageActor(actor, 80, ahead);
        const afterFront = actor.hp;
        game.damageActor(actor, 80, behind);
        return { facing: actor.facing, afterFront, afterBack: actor.hp };
      })()`);
      check(
        "frontal plating halves incoming damage",
        result !== null && near(result.afterFront, 140, 0.01),
        `hp ${result?.afterFront ?? "?"} after a frontal 80`,
      );
      check(
        "flank hits bypass the plating",
        result !== null && near(result.afterBack, 60, 0.01),
        `hp ${result?.afterBack ?? "?"} after a rear 80`,
      );
      await step(0);
      const values = await hud();
      check(
        "the HUD explains the deflection",
        values.toast.includes("PLATING DEFLECTED"),
        values.toast,
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

    define("levels", "l06-district-arrival", async () => {
      await loadLevel("district");
      const current = await state();
      const values = await hud();
      const dbg = await debug();
      check(
        "the courtyard gate loads the rooftop district",
        dbg.level === "district" && values.level === "ROOFTOP DISTRICT",
        `${dbg.level} · ${values.level}`,
      );
      check(
        "the district spawns on the south avenue",
        near(current.x, 32.5, 0.01) &&
          near(current.y, 58.5, 0.01) &&
          current.support === 0,
        `${current.x.toFixed(2)}, ${current.y.toFixed(2)} · support ${current.support}`,
      );
      check(
        "the hunt objective starts empty",
        current.objective.includes("0/7"),
        current.objective,
      );
      const elevated = dbg.actors.filter((actor) => actor.z > 3);
      const sentries = elevated.filter((actor) =>
        actor.name.startsWith("spire"),
      );
      const overseer = dbg.actors.find((actor) => actor.name === "overseer");
      check(
        "four sentries and the overseer hold the rooftops",
        elevated.length === 5 &&
          sentries.length === 4 &&
          elevated.every((actor) => actor.z === 8 || actor.z === 12) &&
          Boolean(overseer && overseer.z === 12 && overseer.hostile),
        elevated.map((actor) => `${actor.name}@${actor.z}`).join(", "),
      );
      await saveCanvas("l06-district-spawn", true);
    });

    define("levels", "l07-rooftop-landing", async () => {
      await loadLevel("district");
      await pose(6.5, 6.5, 6.4, -Math.PI / 2, -0.55);
      await step(0.6);
      const current = await state();
      const values = await hud();
      check(
        "the player lands on the 4 m rooftop",
        current.onGround &&
          near(current.z, 4, 0.02) &&
          near(current.support, 4, 0.01),
        `alt ${current.z.toFixed(2)} m · support ${current.support}`,
      );
      check("the HUD reports a rooftop perch", values.mode.startsWith("PERCH"), values.mode);
      await saveCanvas("l07-rooftop-perch", true);
    });

    define("levels", "l08-sentry-los", async () => {
      await loadLevel("district");
      await pose(6.5, 30.5, 0, -Math.PI / 2, 0.35);
      await step(0.4);
      const dbg = await debug();
      const sentry = dbg.actors.find((actor) => actor.name === "spire-nw");
      const incoming = dbg.bolts.filter(
        (bolt) => !bolt.fromPlayer && bolt.z > 6.5,
      );
      check(
        "the rooftop sentry fires down into the plaza",
        incoming.length > 0 && sentry?.hostile === true,
        `${incoming.length} high bolts · sentry ${sentry?.state ?? "missing"}`,
      );
      await saveCanvas("l08-sentry-fire", true);
    });

    define("levels", "l09-hunt-gate", async () => {
      await loadLevel("district");
      await pose(32.5, 32.5, 0, 0, 0);
      await step(0.1);
      let dbg = await debug();
      let values = await hud();
      check(
        "the beacon refuses extraction before the hunt",
        dbg.level === "district" && values.toast.includes("EXTRACTION LOCKED"),
        `${dbg.level} · ${values.toast}`,
      );
      await evaluate(`(() => {
        const game = window.__raycast.game;
        for (const actor of game.actors) {
          if (actor.spec.hostile) game.damageActor(actor, 999);
        }
      })()`);
      await step(0);
      dbg = await debug();
      check(
        "killing the sentries fills the hunt counter",
        dbg.hunt.kills === 7 && dbg.hunt.targets === 7,
        `${dbg.hunt.kills}/${dbg.hunt.targets}`,
      );
      await step(0.8);
      dbg = await debug();
      values = await hud();
      check(
        "the cleared beacon raises the victory overlay instead of leaving",
        dbg.level === "district" &&
          dbg.mission.stage === "clear" &&
          values.victory === "shown",
        `${dbg.level} · ${dbg.mission.stage} · victory ${values.victory}`,
      );
      const victoryStats = await evaluate<string>(
        'document.getElementById("victory-stats")?.textContent ?? ""',
      );
      check(
        "the victory overlay reports the mission clock, kills, and deaths",
        /TIME \d\d:\d\d/.test(victoryStats) &&
          victoryStats.includes("7 HOSTILES DOWN") &&
          victoryStats.includes("0 DEATHS"),
        victoryStats,
      );
      const victoryBest = await evaluate<string>(
        'document.getElementById("victory-best")?.textContent ?? ""',
      );
      check(
        "a first clear shows the new-best summary",
        victoryBest.startsWith("NEW BEST ·") && victoryBest.includes("7 KILLS"),
        victoryBest,
      );
      const saved = await evaluate<{
        lastLevel: string;
        levels: { district: { cleared: boolean; bestKills: number; bestTime: number } };
      }>('JSON.parse(localStorage.getItem("raycast.campaign.v1"))');
      check(
        "the clear is persisted to the campaign record",
        saved.levels.district.cleared &&
          saved.levels.district.bestKills === 7 &&
          saved.levels.district.bestTime > 0,
        `district best ${saved.levels.district.bestKills} kills · ${saved.levels.district.bestTime.toFixed(1)} s`,
      );
      await capturePage("l09-victory");
      const result = await interact();
      await step(0);
      const after = await debug();
      check(
        "E on the victory overlay returns to the courtyard",
        result === "continue" && after.level === "courtyard",
        `${result} · ${after.level}`,
      );
    });

    define("levels", "l10-jetpack-roof", async () => {
      await loadLevel("district");
      // Stand in the alley west of the 4 m NW tower and burn onto its roof.
      await pose(11.5, 6.5, 0, Math.PI, 0);
      await press("Space");
      await step(0.8);
      await press("KeyW");
      await step(0.35);
      await release("KeyW");
      await release("Space");
      await step(1.3);
      const current = await state();
      const values = await hud();
      check(
        "the jetpack climbs from the alley onto the 4 m roof",
        current.onGround &&
          near(current.z, 4, 0.05) &&
          near(current.support, 4, 0.01) &&
          current.x < 10.8,
        `x=${current.x.toFixed(2)} · alt ${current.z.toFixed(2)} m`,
      );
      check("the climb ends in a perch", values.mode.startsWith("PERCH"), values.mode);
      await saveCanvas("l10-jetpack-roof", true);
    });

    define("levels", "l11-district-gate-entry", async () => {
      await pose(2.5, 22.5, 0, 0, 0);
      await step(0.1);
      const dbg = await debug();
      const values = await hud();
      check(
        "the courtyard gate loads the rooftop district",
        dbg.level === "district" && values.level === "ROOFTOP DISTRICT",
        `${dbg.level} · ${values.level}`,
      );
    });

    // ------------------------------------------------------- tower interiors
    define("levels", "l12-office-entry", async () => {
      await loadLevel("district");
      // West street, straight through the 3 m doorway at (2,6).
      await pose(1.5, 6.5, 0, 0, 0);
      await press("KeyW");
      await step(1.6);
      await release("KeyW");
      const current = await state();
      const dbg = await debug();
      check(
        "walking through the doorway reaches the security office floor",
        current.x > 3.2 &&
          current.x < 8.2 &&
          current.onGround &&
          current.support === 0,
        `x=${current.x.toFixed(2)}, y=${current.y.toFixed(2)} · support ${current.support}`,
      );
      check(
        "the office is covered by a 3 m ceiling under a 4 m roof",
        dbg.player.ceiling === 3 && dbg.player.roof === 4,
        `ceiling ${dbg.player.ceiling} · roof ${dbg.player.roof}`,
      );
      await pose(current.x, current.y, 0, 0, 1.0);
      await step(0);
      const pixels = (await debug()).stats.ceilingPixels;
      check(
        "looking up indoors paints the ceiling slab",
        pixels > 12000,
        `${pixels} ceiling pixels`,
      );
      await saveCanvas("l12-office-interior", true);

      // Face the office's north wall from two and a half metres out. Interior
      // partitions must sample the panel material, never the lit-window
      // facade that the exterior shell uses.
      await pose(5.5, 6.5, 0, Math.PI / 2, 0);
      await step(0);
      const wall = (await debug()).stats;
      check(
        "indoor partition walls paint the panel material",
        wall.interiorPixels > 20000 && wall.wallPixels === 0,
        `${wall.interiorPixels} interior px · ${wall.wallPixels} exterior wall px`,
      );
      check(
        "the indoor wall pass still records ceiling and top stats",
        wall.ceilingPixels === 0 && wall.topPixels === 0,
        `${wall.ceilingPixels} ceiling px · ${wall.topPixels} top px`,
      );
      await saveCanvas("l12-office-wall", true);
    });

    define("levels", "l13-office-medkit", async () => {
      await loadLevel("district");
      await setHealth(50);
      await pose(6.5, 4.5, 0, 0, 0);
      await step(0.15);
      const dbg = await debug();
      const medkit = dbg.pickups.find(
        (pickup) =>
          pickup.kind === "medkit" && pickup.x === 6.5 && pickup.y === 4.5,
      );
      check(
        "the indoor medkit is collected inside the office",
        medkit?.taken === true && dbg.health > 50,
        `taken=${medkit?.taken} · health ${dbg.health}`,
      );
    });

    define("levels", "l14-vault-entry", async () => {
      await loadLevel("district");
      // South avenue pavement, north through the vault doorway at (55,60).
      await pose(55.5, 61.5, 0, -Math.PI / 2, 0);
      await press("KeyW");
      await step(0.9);
      await release("KeyW");
      const current = await state();
      const dbg = await debug();
      check(
        "walking north enters the vault under its 3 m ceiling",
        current.y < 59.4 &&
          current.y > 57.8 &&
          current.onGround &&
          dbg.player.ceiling === 3 &&
          dbg.player.roof === 12,
        `y=${current.y.toFixed(2)} · ceiling ${dbg.player.ceiling} · roof ${dbg.player.roof}`,
      );
      await saveCanvas("l14-vault-interior", true);
    });

    define("levels", "l15-vault-fuel", async () => {
      await loadLevel("district");
      await setFuel(0.2);
      await pose(54.5, 55.5, 0, 0, 0);
      await step(0.15);
      const dbg = await debug();
      const fuel = dbg.pickups.find(
        (pickup) => pickup.kind === "fuel" && pickup.x === 54.5,
      );
      check(
        "the vault fuel cache refills the jetpack",
        fuel?.taken === true && near((await state()).fuel, 1, 0.001),
        `taken=${fuel?.taken} · fuel ${(await state()).fuel.toFixed(2)}`,
      );
    });

    define("levels", "l16-ceiling-jet-cap", async () => {
      await loadLevel("district");
      await pose(5.5, 6.5, 0, -Math.PI / 2, 0);
      await press("Space");
      await step(1.4);
      const burning = await state();
      check(
        "the jetpack is capped below the 3 m office ceiling",
        burning.z > 1.2 &&
          burning.z <= 1.61 &&
          burning.z < 3 - 0.55,
        `alt ${burning.z.toFixed(2)} m (cap 1.60)`,
      );
      await release("Space");
      await step(1.2);
      const landed = await state();
      check(
        "releasing the jetpack lands back on the interior floor",
        landed.onGround && landed.z === 0 && landed.support === 0,
        `alt ${landed.z.toFixed(2)} m · onGround ${landed.onGround}`,
      );
      await saveCanvas("l16-ceiling-cap", true);
    });

    define("levels", "l17-roof-over-vault", async () => {
      await loadLevel("district");
      await pose(55.5, 56.5, 14, -Math.PI / 2, -0.9);
      await step(1.2);
      const current = await state();
      const dbg = await debug();
      check(
        "the vault roof still closes from above",
        current.onGround &&
          near(current.z, 12, 0.02) &&
          near(current.support, 12, 0.01),
        `alt ${current.z.toFixed(2)} m · support ${current.support}`,
      );
      check(
        "looking down shows the roof slab instead of sky",
        dbg.stats.topPixels > 6000 && dbg.stats.ceilingPixels === 0,
        `${dbg.stats.topPixels} top px · ${dbg.stats.ceilingPixels} ceiling px`,
      );
      await saveCanvas("l17-roof-over-vault", true);
    });

    // ------------------------------------------------------- slagworks foundry
    define("levels", "l18-foundry-arrival", async () => {
      // The courtyard's third beacon loads SLAGWORKS without hunting or cards.
      await pose(21.5, 22.5, 0, 0, 0);
      await step(0.15);
      const current = await state();
      const values = await hud();
      const dbg = await debug();
      check(
        "the courtyard beacon loads the slagworks hall",
        dbg.level === "foundry" && values.level === "SLAGWORKS",
        `${dbg.level} · ${values.level}`,
      );
      check(
        "the foundry spawns on the south loading floor",
        near(current.x, 24.5, 0.01) &&
          near(current.y, 44.5, 0.01) &&
          current.support === 0 &&
          current.onGround,
        `${current.x.toFixed(2)}, ${current.y.toFixed(2)} · support ${current.support}`,
      );
      check(
        "the hunt objective counts the furnace crew",
        current.objective.includes("0/6"),
        current.objective,
      );
      const foreman = dbg.actors.find((actor) => actor.name === "foreman");
      const elevated = dbg.actors.filter((actor) => actor.z > 0);
      check(
        "the foreman and the catwalk crew hold the hall",
        foreman?.hostile === true &&
          foreman.maxHp === 320 &&
          elevated.length === 2 &&
          elevated.every((actor) => actor.z === 3 || actor.z === 6),
        `${foreman?.maxHp ?? "missing"} hp · elevated ${elevated
          .map((actor) => `${actor.name}@${actor.z}`)
          .join(", ")}`,
      );
      check(
        "the hazard grid exposes the slag cycle",
        dbg.hazard.hotNow === true &&
          dbg.hazard.standing === false &&
          dbg.hazard.coolant?.target === 3,
        `hot ${dbg.hazard.hotNow} · standing ${dbg.hazard.standing} · coolant ${dbg.hazard.coolant?.got}/${dbg.hazard.coolant?.target}`,
      );
      await saveCanvas("l18-foundry-arrival", true);
    });

    define("levels", "l19-hot-channel-burns", async () => {
      await loadLevel("foundry");
      // Clear the crew so only the slag can move the health bar.
      await evaluate(`(() => {
        const game = window.__raycast.game;
        for (const actor of game.actors) {
          if (actor.spec.hostile) game.damageActor(actor, 999);
        }
      })()`);
      await step(0);
      await pose(24.5, 31.5, 0, -Math.PI / 2, -0.75);
      await step(1.2);
      const current = await state();
      const values = await hud();
      check(
        "standing on a hot channel burns the player",
        current.hazardHot &&
          current.health < 95 &&
          current.health > 70 &&
          values.toast.includes("SLAG BURN"),
        `health ${current.health.toFixed(1)} · hot ${current.hazardHot} · ${values.toast}`,
      );
      await saveCanvas("l19-hot-channel", true);
    });

    define("levels", "l20-cold-channel-safe", async () => {
      await loadLevel("foundry");
      await evaluate(`(() => {
        const game = window.__raycast.game;
        for (const actor of game.actors) {
          if (actor.spec.hostile) game.damageActor(actor, 999);
        }
      })()`);
      await step(0);
      // Wait out the first hot phase on dry floor, then stand in the channel.
      await pose(24.5, 32.5, 0, -Math.PI / 2, -0.75);
      await step(2.1);
      await pose(24.5, 31.5, 0, -Math.PI / 2, -0.75);
      await step(0.8);
      const cold = await state();
      check(
        "the same channel is safe through the cold phase",
        cold.health === 100 && !cold.hazardHot,
        `health ${cold.health} · hot ${cold.hazardHot}`,
      );
      await saveCanvas("l20-cold-channel", true);
      // The cycle wraps: the channel burns again four seconds after load.
      await step(1.6);
      const hot = await state();
      check(
        "the channel reignites on the next cycle",
        hot.health < 100 && hot.hazardHot,
        `health ${hot.health.toFixed(1)} · hot ${hot.hazardHot}`,
      );
      // End on the cold phase so the scenario capture documents the safe floor.
      await step(1.6);
      const cooled = await state();
      check(
        "the channel cools again after the hot window",
        !cooled.hazardHot,
        `hot ${cooled.hazardHot}`,
      );
    });

    define("levels", "l21-coolant-cell", async () => {
      await loadLevel("foundry");
      await evaluate(`(() => {
        const game = window.__raycast.game;
        for (const actor of game.actors) {
          if (actor.spec.hostile) game.damageActor(actor, 999);
        }
      })()`);
      await step(0);
      // Stand back so the canister is in frame before it is collected.
      await pose(6.6, 24.5, 0, 0, 0);
      await step(0);
      await saveCanvas("l21-coolant-canister", true);
      await pose(8.5, 24.5, 0, 0, 0);
      const result = await interact();
      await step(0.05);
      const current = await state();
      const values = await hud();
      const dbg = await debug();
      const pickup = dbg.pickups.find(
        (entry) => entry.kind === "coolant" && entry.x === 8.5,
      );
      check(
        "the coolant cell is collected on E",
        result === "pickup" &&
          current.coolantGot === 1 &&
          current.coolantTargets === 3 &&
          pickup?.taken === true &&
          values.toast.includes("COOLANT CELL 1/3"),
        `${result} · ${current.coolantGot}/${current.coolantTargets} · ${values.toast}`,
      );
      await saveCanvas("l21-coolant-cell", true);
    });

    define("levels", "l22-foundry-clear", async () => {
      await loadLevel("foundry");
      await pose(6.5, 34.5, 0, 0, 0);
      const card = await interact();
      await pose(32.5, 11.2, 0, Math.PI, 0);
      const door = await interact();
      await step(0.05);
      let dbg = await debug();
      check(
        "the keycard opens the control-room door",
        card === "pickup" &&
          door === "door" &&
          dbg.doors.some((entry) => entry.id === "control" && entry.open),
        `card ${card} · door ${door} · ${dbg.doors
          .map((entry) => `${entry.id}:${entry.open ? "open" : "sealed"}`)
          .join(" ")}`,
      );
      for (const [x, y] of [
        [8.5, 24.5],
        [24.5, 16.5],
        [42.5, 26.5],
      ] as const) {
        await pose(x, y, 0, 0, 0);
        await interact();
      }
      await step(0.05);
      let current = await state();
      check(
        "all three coolant cells gate the foreman",
        current.coolantGot === 3 && current.mission?.coolant?.got === 3,
        `${current.coolantGot}/${current.coolantTargets} · stage ${current.mission?.stage}`,
      );
      await evaluate(`(() => {
        const game = window.__raycast.game;
        for (const actor of game.actors) {
          if (actor.spec.hostile && !actor.spec.boss) game.damageActor(actor, 999);
        }
      })()`);
      await step(0);
      current = await state();
      check(
        "clearing the crew exposes the foreman",
        current.huntKills === 6 && current.mission?.stage === "boss",
        `${current.huntKills}/${current.huntTargets} · stage ${current.mission?.stage}`,
      );
      await evaluate(`(() => {
        const game = window.__raycast.game;
        const boss = game.actors.find((actor) => actor.spec.boss);
        if (boss) game.damageActor(boss, 999);
      })()`);
      // The death topple holds `alive` for 0.67 s before the boss clears.
      await step(0.8);
      const extracted = await state();
      check(
        "killing the foreman unlocks extraction",
        extracted.mission?.stage === "extract" &&
          extracted.huntKills === 6,
        `stage ${extracted.mission?.stage} · kills ${extracted.huntKills}`,
      );
      await pose(32.5, 6.5, 0, -Math.PI / 2, 0);
      await step(0.2);
      const values = await hud();
      dbg = await debug();
      check(
        "the control-room beacon ends the mission",
        dbg.mission.stage === "clear" && values.victory === "shown",
        `${dbg.mission.stage} · victory ${values.victory}`,
      );
      const title = await evaluate<string>(
        'document.getElementById("victory-title")?.textContent ?? ""',
      );
      check(
        "the overlay names the foundry instead of the district",
        title === "Foundry cleared",
        title,
      );
      const saved = await evaluate<{
        reached: string[];
        levels: {
          foundry: { cleared: boolean; bestKills: number; bestTime: number };
        };
      }>('JSON.parse(localStorage.getItem("raycast.campaign.v1"))');
      check(
        "the foundry clear is persisted with its furnace record",
        saved.reached.includes("foundry") &&
          saved.levels.foundry.cleared &&
          saved.levels.foundry.bestKills === 6 &&
          (saved.levels.foundry.bestTime ?? 0) > 0,
        `reached ${saved.reached.join(",")} · best ${saved.levels.foundry.bestKills} kills · ${(saved.levels.foundry.bestTime ?? 0).toFixed(1)} s`,
      );
      await capturePage("l22-foundry-victory");
      await pose(32.5, 8.4, 0, -Math.PI / 2, -0.3);
      await step(0);
      await saveCanvas("l22-foundry-extract", true);
      const result = await interact();
      await step(0);
      const after = await debug();
      check(
        "E on the foundry victory returns to the courtyard",
        result === "continue" && after.level === "courtyard",
        `${result} · ${after.level}`,
      );
    });

    define("levels", "l23-staggered-channels", async () => {
      await loadLevel("foundry");
      await evaluate(`(() => {
        const game = window.__raycast.game;
        for (const actor of game.actors) {
          if (actor.spec.hostile) game.damageActor(actor, 999);
        }
      })()`);
      await step(0);
      // The south channel opens on the hot window while the middle one is cold.
      await pose(24.5, 31.5, 0, -Math.PI / 2, -0.75);
      await step(0.6);
      const south = await state();
      let dbg = await debug();
      check(
        "the south channel opens on the hot window",
        south.hazardHot && dbg.hazard.phase === 0 && south.health < 100,
        `hot ${south.hazardHot} · phase ${dbg.hazard.phase} · health ${south.health.toFixed(1)}`,
      );
      await pose(24.5, 20.5, 0, -Math.PI / 2, -0.75);
      await step(0.6);
      const midCold = await state();
      dbg = await debug();
      check(
        "the middle channel runs the opposite window",
        !midCold.hazardHot && dbg.hazard.phase === 2 && midCold.health === south.health,
        `hot ${midCold.hazardHot} · phase ${dbg.hazard.phase} · health ${midCold.health.toFixed(1)}`,
      );
      // Two seconds in, the middle channel ignites while the south cools.
      await step(1.2);
      const midHot = await state();
      check(
        "the middle channel ignites as the south cools",
        midHot.hazardHot && midHot.health < midCold.health,
        `hot ${midHot.hazardHot} · health ${midHot.health.toFixed(1)}`,
      );
      // Frame both channels: the middle one is hot while the south one is cold,
      // the mirror image of the l21 load captures.
      await pose(6.6, 24.5, 0, 0, 0);
      await step(0);
      await saveCanvas("l23-staggered-channels", true);
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
      captures
        .filter((capture) => capture.kind === "canvas")
        .map((capture) => ({
          name: capture.name,
          file: join(outDir, `${capture.name}.png`),
        })),
      join(outDir, "contact-sheet.png"),
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
