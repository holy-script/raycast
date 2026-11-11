import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PNG } from "pngjs";
import { Browser, sleep } from "./cdp";
import {
  analyzeSilhouette,
  analyzeSkyHoles,
  composeSheet,
  imageMetrics,
  skyRowsForHeight,
  startDevServer,
  waitForHttp,
} from "./support";
import type { HudState, RenderDebug } from "../../src/game";

const root = resolve(import.meta.dirname, "../..");
const outDir = resolve(
  process.env.FLIGHT_OUT ?? join(root, "docs/screenshots/flight"),
);
const port = 5202;
const args = process.argv.slice(2);
const argValue = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const remoteUrl = argValue("--url");
const pageUrl = remoteUrl
  ? remoteUrl.includes("?")
    ? remoteUrl
    : `${remoteUrl}?screenshot`
  : `http://127.0.0.1:${port}/?screenshot`;

interface Check {
  scenario: string;
  name: string;
  ok: boolean;
  detail: string;
}

interface CaptureRecord {
  name: string;
  kind: "canvas" | "page";
  holes?: number;
  silhouette?: number;
}

interface SweepPose {
  id: string;
  note: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  /** Asserts the projected wall-top silhouette is straight. */
  straight?: boolean;
  /** Asserts this sprite survives the overhead projection intact. */
  sprite?: string;
}

const SKY_HEIGHT = 240;
const SKY = skyRowsForHeight(SKY_HEIGHT);

const poses: SweepPose[] = [
  { id: "f01-ground-level", note: "ground, level look", x: 5.5, y: 4.5, z: 0, yaw: 0, pitch: 0 },
  { id: "f02-ground-lookdown", note: "ground, steep look-down", x: 5.5, y: 4.5, z: 0, yaw: -Math.PI / 2, pitch: -0.7 },
  { id: "f03-hover-4m-level", note: "4 m hover, level look", x: 11.5, y: 12.5, z: 4, yaw: 0, pitch: 0 },
  { id: "f04-hover-4m-down", note: "4 m hover, 26 deg down", x: 11.5, y: 12.5, z: 4, yaw: 0.8, pitch: -0.45 },
  { id: "f05-climb-8m-down", note: "8 m climb, 49 deg down", x: 11.5, y: 12.5, z: 8, yaw: 2.2, pitch: -0.85 },
  { id: "f06-climb-8m-uptilt", note: "8 m climb, up-tilt", x: 11.5, y: 12.5, z: 8, yaw: -2.4, pitch: 0.5 },
  { id: "f07-altitude-12m-down", note: "12 m altitude, 37 deg down", x: 11.5, y: 12.5, z: 12, yaw: Math.PI, pitch: -0.65 },
  { id: "f08-altitude-12m-down", note: "12 m altitude, 57 deg down", x: 11.5, y: 12.5, z: 12, yaw: -Math.PI / 2, pitch: -1.0 },
  { id: "f09-altitude-16m-top", note: "16 m altitude, top band", x: 11.5, y: 12.5, z: 16, yaw: 0, pitch: -1.45 },
  { id: "f10-ceiling-18m-down", note: "18 m ceiling, 63 deg down", x: 5.5, y: 4.5, z: 18, yaw: Math.PI / 4, pitch: -1.1 },
  { id: "f11-ceiling-18m-level", note: "18 m ceiling, level look", x: 5.5, y: 4.5, z: 18, yaw: 0, pitch: 0 },
  { id: "f12-map-edge", note: "inside the map edge, 52 deg down", x: 2.5, y: 2.5, z: 10, yaw: Math.PI / 4, pitch: -0.9 },
  { id: "f13-corner-overshoot", note: "corner, 52 deg down", x: 22.4, y: 22.4, z: 14, yaw: -Math.PI * 0.75, pitch: -0.9 },
  { id: "f14-wall-line-a", note: "straight wall, 46 deg down", x: 11.5, y: 4.5, z: 4, yaw: -Math.PI / 2, pitch: -0.8, straight: true },
  { id: "f15-wall-line-b", note: "straight wall, 34 deg down", x: 11.5, y: 4.5, z: 4, yaw: -Math.PI / 2, pitch: -0.6, straight: true },
  { id: "f16-wall-line-c", note: "south wall, 40 deg down", x: 11.5, y: 20.5, z: 4, yaw: Math.PI / 2, pitch: -0.7, straight: true },
  { id: "f17-overhead-scholar", note: "overhead sprite completeness", x: 4.5, y: 11.3, z: 3.5, yaw: Math.PI / 2, pitch: -1.25, sprite: "scholar" },
  { id: "f18-wall-top-hover", note: "hovering over a wall top", x: 3.5, y: 2.5, z: 2.6, yaw: Math.PI, pitch: -1.2 },
];

const checks: Check[] = [];
const captures: CaptureRecord[] = [];
const consoleErrors: string[] = [];
let currentScenario = "boot";

function check(name: string, ok: boolean, detail: string): void {
  checks.push({ scenario: currentScenario, name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${currentScenario} · ${name} — ${detail}`);
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
    const step = (seconds: number, dt = 1 / 60): Promise<void> =>
      evaluate(`window.__raycast.automation.step(${seconds}, ${dt})`);
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
    const pause = (): Promise<void> => evaluate("window.__raycast.automation.pause()");
    const resume = async (): Promise<void> => {
      // Headless only produces frames for a foregrounded target.
      await browser!.send("Page.bringToFront");
      await evaluate("window.__raycast.automation.resume()");
    };
    const reset = async (): Promise<void> => {
      await evaluate('window.__raycast.automation.loadLevel("courtyard")');
      await pause();
      await step(0);
    };
    const setViewmodel = async (visible: boolean): Promise<void> => {
      await evaluate(`window.__raycast.automation.setViewmodelVisible(${visible})`);
      await step(0);
    };
    const hud = (): Promise<Record<string, string>> =>
      evaluate<Record<string, string>>(`(() => {
        const text = (id) => (document.getElementById(id)?.textContent ?? "").trim();
        return {
          mode: text("hud-mode"),
          alt: text("hud-alt"),
          fuel: text("hud-fuel"),
          level: text("hud-level"),
        };
      })()`);

    const readCanvas = async (): Promise<PNG> => {
      const url = await evaluate<string>(
        'document.getElementById("view").toDataURL("image/png")',
      );
      return PNG.sync.read(Buffer.from(url.split(",")[1], "base64"));
    };
    const captureCanvas = async (name: string): Promise<PNG> => {
      const image = await readCanvas();
      writeFileSync(join(outDir, `${name}.png`), PNG.sync.write(image));
      captures.push({ name, kind: "canvas" });
      return image;
    };
    const capturePage = async (name: string): Promise<void> => {
      await browser!.screenshot(join(outDir, `${name}.png`));
      captures.push({ name, kind: "page" });
      console.log(`SHOT  ${name} (page)`);
    };
    /** Canvas captures hide the viewmodel: it is an overlay, not world geometry. */
    const captureFlight = async (name: string): Promise<void> => {
      await setViewmodel(false);
      await geometryChecks(`${name} canvas`, await captureCanvas(`${name}-canvas`));
      await setViewmodel(true);
      await capturePage(name);
    };

    const geometryChecks = async (name: string, image?: PNG): Promise<void> => {
      const frame = image ?? (await readCanvas());
      const holes = analyzeSkyHoles(frame, SKY);
      const metrics = imageMetrics(frame);
      check(
        `${name} has no sky holes`,
        holes.holeColumns === 0,
        `${holes.holePixels} hole px in ${holes.holeColumns} columns (max run ${holes.maxRun})`,
      );
      check(
        `${name} renders content`,
        metrics.colors >= 8 && metrics.meanLuma >= 4,
        `${metrics.colors} colors, mean luma ${metrics.meanLuma.toFixed(1)}`,
      );
    };

    await evaluate("window.__raycast.automation.enable()");
    await pause();

    // ------------------------------------------------------- geometry sweep
    // Viewmodel off so the canvas is pure world geometry for the analyzers.
    await setViewmodel(false);
    for (const entry of poses) {
      currentScenario = entry.id;
      await reset();
      await pose(entry.x, entry.y, entry.z, entry.yaw, entry.pitch);
      const image = await captureCanvas(entry.id);
      await geometryChecks(entry.id, image);

      const dbg = await debug();
      const stats = dbg.stats;
      const numbers = [
        stats.wallColumns,
        stats.wallPixels,
        stats.topPixels,
        ...stats.spriteRects.flatMap((rect) => [rect.x, rect.y, rect.w, rect.h]),
      ];
      check(
        "projections stay finite",
        numbers.every(Number.isFinite),
        `${stats.wallColumns} cols, ${stats.wallPixels} wall px, ${stats.topPixels} top px`,
      );
      const current = await state();
      const values = await hud();
      check(
        "paused state and HUD are coherent",
        Number.isFinite(current.x) &&
          Number.isFinite(current.z) &&
          values.mode.length > 0 &&
          values.mode !== "--" &&
          /^\d+%$/.test(values.fuel),
        `${current.x.toFixed(1)},${current.y.toFixed(1)} at ${current.z.toFixed(1)} m · ${values.mode} · fuel ${values.fuel}`,
      );

      if (entry.pitch <= -0.6 && entry.z >= 3) {
        check(
          "looking down from altitude shows ground geometry",
          stats.wallPixels + stats.topPixels > 2_000,
          `${stats.wallPixels} wall px + ${stats.topPixels} top px`,
        );
      }

      if (entry.straight) {
        const silhouette = analyzeSilhouette(image, 60, 323, SKY);
        captures[captures.length - 1].silhouette = silhouette.maxResidual;
        check(
          "wall top projects as a straight line",
          silhouette.columns >= 200 && silhouette.maxResidual <= 1.5,
          `${silhouette.columns} columns, max residual ${silhouette.maxResidual.toFixed(2)} px, slope ${silhouette.slope.toFixed(3)}`,
        );
      }

      if (entry.sprite) {
        const rect = stats.spriteRects.find((item) => item.id === entry.sprite);
        check(
          "overhead sprite is complete and unclipped",
          Boolean(
            rect &&
              rect.visible &&
              rect.contentW > 18 &&
              rect.contentH > 16 &&
              rect.pixels > 250 &&
              rect.x - rect.w / 2 >= -0.5 &&
              rect.x + rect.w / 2 <= 384.5 &&
              rect.y - rect.h / 2 >= -0.5 &&
              rect.y + rect.h / 2 <= 240.5,
          ),
          rect
            ? `${rect.contentW}x${rect.contentH} content, ${rect.pixels} px, ${rect.occluded} occluded, rect ${rect.w.toFixed(1)}x${rect.h.toFixed(1)} at ${rect.x.toFixed(1)},${rect.y.toFixed(1)}`
            : "not projected",
        );
        captures[captures.length - 1].holes = analyzeSkyHoles(image, SKY).holeColumns;
      }
    }

    // ------------------------------------------------------- live jet flight
    currentScenario = "flight-live";
    await reset();
    await pose(3.5, 1.5, 0, 0, 0);
    await press("Space");

    await step(0.35);
    await captureFlight("flight-live-liftoff");

    await step(0.65);
    let current = await state();
    let values = await hud();
    await captureFlight("flight-live-climb");
    check(
      "jetpack climbs after one second",
      current.thrusting && current.z > 2.5 && current.airborne,
      `alt ${current.z.toFixed(2)} m, vz ${current.vz.toFixed(2)}, fuel ${current.fuel.toFixed(2)} · ${values.mode}`,
    );

    await step(3.2);
    current = await state();
    const climbAlt = current.z;
    check(
      "burn reaches the 18 m ceiling",
      climbAlt >= 17.9 && climbAlt <= 18.001,
      `alt ${climbAlt.toFixed(2)} m, fuel ${current.fuel.toFixed(2)}`,
    );
    check(
      "jetpack fuel was spent by the climb",
      current.fuel < 0.3,
      `fuel ${current.fuel.toFixed(2)}`,
    );
    await look(0, 620);
    await step(1 / 60);
    current = await state();
    check(
      "ceiling look-down reaches the top pitch band",
      current.pitchDeg < -70,
      `pitch ${current.pitchDeg.toFixed(0)} deg · sprite band ${current.nearestPitch}`,
    );
    await captureFlight("flight-live-apex");
    check(
      "ceiling view shows the ground",
      (await debug()).stats.topPixels > 2_000,
      `${(await debug()).stats.topPixels} top px`,
    );

    await release("Space");
    await step(0.35);
    current = await state();
    await captureFlight("flight-live-fall");
    check(
      "releasing thrust starts the fall",
      current.vz < 0 && current.airborne,
      `alt ${current.z.toFixed(2)} m, vz ${current.vz.toFixed(2)}`,
    );

    await step(3.0);
    current = await state();
    values = await hud();
    await captureFlight("flight-live-landed");
    check(
      "the flight lands back on the courtyard floor",
      current.onGround && current.z === 0 && near(current.x, 3.5, 0.05),
      `alt ${current.z.toFixed(2)} m at ${current.x.toFixed(2)},${current.y.toFixed(2)} · ${values.mode}`,
    );

    // --------------------------------------------------------- realtime probe
    currentScenario = "flight-realtime";
    await reset();
    await pose(5.5, 4.5, 0, 0, 0);
    const framesBefore = await evaluate<number>(
      "window.__raycast.automation.frameCount()",
    );
    const startedProbe = Date.now();
    await resume();
    await press("Space");
    await sleep(1_500);
    await pause();
    await step(0);
    const framesAfter = await evaluate<number>(
      "window.__raycast.automation.frameCount()",
    );
    const seconds = (Date.now() - startedProbe) / 1_000;
    const fps = (framesAfter - framesBefore) / seconds;
    current = await state();
    await captureFlight("flight-realtime-burn");
    check(
      "the live loop sustains interactive frame rate",
      fps >= 45,
      `${fps.toFixed(1)} fps over ${seconds.toFixed(2)} s`,
    );
    check(
      "a real-time burn climbs without the scripted stepper",
      current.z > 1 && current.thrusting,
      `alt ${current.z.toFixed(2)} m, ${framesAfter - framesBefore} frames`,
    );
    await release("Space");

    currentScenario = "page";
    check("no page errors", consoleErrors.length === 0, `${consoleErrors.length} errors`);

    const failed = checks.filter((entry) => !entry.ok);
    const canvasCaptures = captures.filter((capture) => capture.kind === "canvas");
    const pageCaptures = captures.filter((capture) => capture.kind === "page");
    composeSheet(
      canvasCaptures.map((capture) => ({
        name: capture.name,
        file: join(outDir, `${capture.name}.png`),
      })),
      join(outDir, "contact-sheet.png"),
    );
    composeSheet(
      pageCaptures.map((capture) => ({
        name: capture.name,
        file: join(outDir, `${capture.name}.png`),
      })),
      join(outDir, "page-sheet.png"),
      384,
      258,
    );

    const report = {
      generatedAt: new Date().toISOString(),
      url: pageUrl,
      durationMs: Date.now() - startedAt,
      poses: poses.map((entry) => ({
        id: entry.id,
        note: entry.note,
        x: entry.x,
        y: entry.y,
        z: entry.z,
        yaw: entry.yaw,
        pitch: entry.pitch,
      })),
      fps,
      passed: checks.length - failed.length,
      failed: failed.length,
      checks,
      captures,
      consoleErrors,
      sheets: {
        canvas: join(outDir, "contact-sheet.png"),
        pages: join(outDir, "page-sheet.png"),
      },
    };
    writeFileSync(join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);

    console.log(
      `\nFLIGHT ${failed.length === 0 ? "PASSED" : "FAILED"} — ${checks.length - failed.length}/${checks.length} checks across ${poses.length} poses + live flight`,
    );
    console.log(`contact sheet: ${join(outDir, "contact-sheet.png")}`);
    console.log(`page sheet: ${join(outDir, "page-sheet.png")}`);
    if (failed.length > 0) process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    devServer?.kill("SIGTERM");
  }
}

function near(value: number, target: number, tolerance: number): boolean {
  return Math.abs(value - target) <= tolerance;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
