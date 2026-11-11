import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { PNG } from "pngjs";
import type { HudState, RenderDebug } from "../../src/game";
import { Browser, sleep } from "./cdp";

/**
 * State gallery: pauses the simulation at a representative frame of every player
 * and actor state, captures a canvas (or page) screenshot, and asserts what the
 * debug API reports. The playtester agent reviews the PNGs for visual regressions.
 */

const root = resolve(import.meta.dirname, "../..");
const outDir = resolve(
  process.env.STATES_OUT ?? join(root, "docs/screenshots/states"),
);
const port = 5204;

interface Check {
  state: string;
  name: string;
  ok: boolean;
  detail: string;
}

interface ShotRecord {
  name: string;
  kind: "canvas" | "page";
  actor?: string;
  expected?: string;
  observed?: string;
  colors?: number;
  meanLuma?: number;
}

const checks: Check[] = [];
const shots: ShotRecord[] = [];
const canvasShots: string[] = [];
let currentState = "";

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
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
  "-": ["000", "000", "111", "000", "000"],
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

function drawLabel(target: PNG, text: string, x: number, y: number): void {
  const color: [number, number, number] = [255, 210, 138];
  let cursor = x;
  for (const character of text) {
    const glyph = GLYPHS[character] ?? GLYPHS["-"];
    for (let row = 0; row < glyph.length; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        if (glyph[row][col] === "1") {
          fillRect(target, cursor + col * 2, y + row * 2, 2, 2, color);
        }
      }
    }
    cursor += 8;
  }
}

function composeSheet(names: string[], file: string): void {
  const cols = 5;
  const gap = 6;
  const labelHeight = 16;
  const cellW = 384 + gap;
  const cellH = 240 + labelHeight + gap;
  const rows = Math.ceil(names.length / cols);
  const sheet = new PNG({ width: cols * cellW + gap, height: rows * cellH + gap });
  fillRect(sheet, 0, 0, sheet.width, sheet.height, [10, 11, 16]);
  names.forEach((name, index) => {
    const x = gap + (index % cols) * cellW;
    const y = gap + Math.floor(index / cols) * cellH;
    drawLabel(sheet, name.toUpperCase(), x, y + 2);
    const image = PNG.sync.read(readFileSync(join(outDir, `${name}.png`)));
    for (let row = 0; row < image.height; row += 1) {
      for (let col = 0; col < image.width; col += 1) {
        const from = (row * image.width + col) * 4;
        const to = ((y + labelHeight + row) * sheet.width + x + col) * 4;
        sheet.data[to] = image.data[from];
        sheet.data[to + 1] = image.data[from + 1];
        sheet.data[to + 2] = image.data[from + 2];
        sheet.data[to + 3] = 255;
      }
    }
  });
  writeFileSync(file, PNG.sync.write(sheet));
  console.log(`contact sheet: ${file}`);
}

function check(name: string, ok: boolean, detail: string): void {
  checks.push({ state: currentState, name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${currentState} · ${name} — ${detail}`);
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
  return spawn(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["run", "dev", "--", "--port", String(port), "--strictPort", "--host", "127.0.0.1"],
    { cwd: root, stdio: "ignore" },
  );
}

interface ChassisProfile {
  id: "guardian";
  talk: { actor: string; level: string; x: number; y: number; yaw: number };
  combat: { actor: string; level: string; x: number; y: number; yaw: number; hp: number };
}

// Only the guardian chassis is authored; every actor renders through its atlas.
const PROFILES: ChassisProfile[] = [
  {
    id: "guardian",
    talk: { actor: "guard", level: "courtyard", x: 9.8, y: 1.5, yaw: Math.PI },
    combat: { actor: "marauder", level: "courtyard", x: 22.7, y: 22.5, yaw: Math.PI, hp: 110 },
  },
];

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const server = startDevServer();
  const url = `http://127.0.0.1:${port}/?screenshot`;
  let browser: Browser | undefined;
  const startedAt = Date.now();
  try {
    await waitForHttp(`http://127.0.0.1:${port}/`);
    browser = await Browser.launch(9351, url);
    const readyBy = Date.now() + 30_000;
    while (Date.now() < readyBy) {
      const ready = await browser.evaluate<boolean>(
        "Boolean(window.__raycast) && document.getElementById('loading')?.classList.contains('hidden')",
      );
      if (ready) break;
      await sleep(150);
    }
    if (!(await browser.evaluate<boolean>("Boolean(window.__raycast)"))) {
      throw new Error("The game did not finish booting");
    }

    const evaluate = <T>(expression: string): Promise<T> => browser!.evaluate<T>(expression);
    const step = (seconds: number): Promise<void> =>
      evaluate(`window.__raycast.automation.step(${seconds})`);
    const pose = (
      x: number,
      y: number,
      z: number,
      yaw: number,
      pitch: number,
    ): Promise<void> =>
      evaluate(`window.__raycast.setPose(${x}, ${y}, ${z}, ${yaw}, ${pitch})`);
    const attack = (): Promise<boolean> =>
      evaluate<boolean>("window.__raycast.automation.attack()");
    const interact = (): Promise<string> =>
      evaluate<string>("window.__raycast.automation.interact()");
    const setHealth = (value: number): Promise<void> =>
      evaluate(`window.__raycast.automation.setHealth(${value})`);
    const press = (code: string): Promise<void> =>
      evaluate(`window.__raycast.automation.press(${JSON.stringify(code)})`);
    const release = (code: string): Promise<void> =>
      evaluate(`window.__raycast.automation.release(${JSON.stringify(code)})`);
    const hud = (): Promise<HudState> =>
      evaluate<HudState>("window.__raycast.automation.state()");
    const debug = (): Promise<RenderDebug> => evaluate<RenderDebug>("window.__raycast.debug()");
    const actor = async (name: string) =>
      (await debug()).actors.find((entry) => entry.name === name);
    const loadLevel = async (id: string): Promise<void> => {
      await evaluate(`window.__raycast.automation.loadLevel(${JSON.stringify(id)})`);
      await step(0);
    };

    const shot = async (
      name: string,
      actorName?: string,
      expected?: string,
    ): Promise<void> => {
      const dataUrl = await evaluate<string>(
        'document.getElementById("view").toDataURL("image/png")',
      );
      const image = PNG.sync.read(Buffer.from(dataUrl.split(",")[1], "base64"));
      writeFileSync(join(outDir, `${name}.png`), PNG.sync.write(image));
      const metrics = imageMetrics(image);
      const observed = actorName ? (await actor(actorName))?.state : undefined;
      shots.push({
        name,
        kind: "canvas",
        actor: actorName,
        expected,
        observed,
        colors: metrics.colors,
        meanLuma: Number(metrics.meanLuma.toFixed(1)),
      });
      canvasShots.push(name);
      check(
        `${name} renders content`,
        metrics.colors >= 8 && metrics.meanLuma >= 4,
        `${metrics.colors} colors, mean luma ${metrics.meanLuma.toFixed(1)}`,
      );
      if (actorName) {
        const rect = (await debug()).stats.spriteRects.find(
          (entry) => entry.id === actorName,
        );
        check(
          `${name} shows ${actorName}`,
          Boolean(rect && rect.visible && rect.pixels > 200),
          `${rect?.pixels ?? 0} px`,
        );
      }
      console.log(`SHOT  ${name}${actorName ? ` (${observed})` : ""}`);
    };

    const pageShot = async (name: string): Promise<void> => {
      await browser!.screenshot(join(outDir, `${name}.png`));
      shots.push({ name, kind: "page" });
      console.log(`SHOT  ${name} (page)`);
    };

    const visible = async (actorName: string): Promise<number> => {
      const rect = (await debug()).stats.spriteRects.find(
        (entry) => entry.id === actorName,
      );
      return rect?.visible ? rect.pixels : 0;
    };

    await evaluate("window.__raycast.automation.enable()");
    await evaluate("window.__raycast.automation.pause()");
    await loadLevel("courtyard");

    // ------------------------------------------------------------- player states
    currentState = "player";
    await step(0.3);
    const idleState = await hud();
    check(
      "spawn is grounded and idle",
      idleState.onGround && idleState.z === 0,
      `z=${idleState.z.toFixed(2)} support=${idleState.support.toFixed(2)}`,
    );
    await shot("player-idle");

    await press("KeyW");
    await step(0.3);
    await shot("player-walk");
    const walkState = await hud();
    await release("KeyW");
    check(
      "walking moves the player",
      Math.hypot(walkState.x - idleState.x, walkState.y - idleState.y) > 0.2,
      `${walkState.x.toFixed(2)}, ${walkState.y.toFixed(2)}`,
    );

    await step(0.4);
    await press("Space");
    await step(0.15);
    await shot("player-jump");
    const jumpState = await hud();
    await release("Space");
    check("jump lifts the player", jumpState.z > 0.2, `z=${jumpState.z.toFixed(2)}`);
    await pageShot("player-jump-page");
    await step(1.4);

    await press("Space");
    await step(0.55);
    const jetState = await hud();
    await release("Space");
    check(
      "jetpack burn gains altitude",
      jetState.z > 1.5 && jetState.fuel < 100,
      `z=${jetState.z.toFixed(2)} fuel=${jetState.fuel.toFixed(0)}`,
    );
    await pose(jetState.x, jetState.y, jetState.z, 0, -0.55);
    await step(0);
    await shot("player-jet");
    await pageShot("player-jet-page");
    await step(4);

    await pose(3.5, 1.5, 8, 0, -1.0);
    await step(0.05);
    await shot("player-aerial");
    const aerialState = await hud();
    check(
      "aerial pose holds altitude",
      aerialState.z > 7,
      `z=${aerialState.z.toFixed(2)}`,
    );

    await loadLevel("courtyard");
    await pose(17.6, 14.5, 0, 0, 0);
    await setHealth(100);
    await step(0.25);
    const hurtState = await hud();
    check("a hostile hit damages the player", hurtState.health < 100, `hp=${hurtState.health}`);
    await pageShot("player-hurt-page");

    await loadLevel("courtyard");
    await pose(17.6, 14.5, 0, 0, 0);
    await setHealth(1);
    await step(0.6);
    const deadState = await hud();
    check("a lethal hit downs the player", deadState.dead && deadState.health === 0, `dead=${deadState.dead}`);
    await pageShot("player-dead-page");
    await step(1.6);
    const revived = await hud();
    check(
      "death redeploys at full health",
      !revived.dead && revived.health === revived.maxHealth,
      `hp=${revived.health}`,
    );
    await shot("player-redeployed");

    // ---------------------------------------------------------- chassis state gallery
    for (const profile of PROFILES) {
      currentState = profile.id;

      // Talk NPC: idle front view, then the talk cycle.
      await loadLevel(profile.talk.level);
      await pose(
        profile.talk.x,
        profile.talk.y,
        0,
        profile.talk.yaw,
        0,
      );
      await step(0.2);
      await shot(`${profile.id}-idle`, profile.talk.actor, "idle");
      const idleActor = await actor(profile.talk.actor);
      check(
        `${profile.id} NPC is idle`,
        idleActor?.state === "idle",
        idleActor?.state ?? "missing",
      );

      const result = await interact();
      await step(0.15);
      const talking = await actor(profile.talk.actor);
      check(
        `${profile.id} interaction starts talk`,
        result === "talk" && talking?.state === "talk",
        `result=${result} state=${talking?.state}`,
      );
      await shot(`${profile.id}-talk-early`, profile.talk.actor, "talk");
      await step(0.35);
      await shot(`${profile.id}-talk-late`, profile.talk.actor, "talk");
      await pageShot(`${profile.id}-talk-page`);
      const talkHud = await hud();
      check(
        `${profile.id} talk shows a subtitle`,
        talkHud.toast.length > 0,
        talkHud.toast.slice(0, 48),
      );

      // Hostile: walk, windup, impact, hurt, death, corpse.
      await loadLevel(profile.combat.level);
      await pose(
        profile.combat.x,
        profile.combat.y,
        0,
        profile.combat.yaw,
        0,
      );
      await step(0.1);
      const walking = await actor(profile.combat.actor);
      check(
        `${profile.id} hostile closes in`,
        walking?.state === "walk" || walking?.state === "attack",
        walking?.state ?? "missing",
      );
      await shot(`${profile.id}-walk`, profile.combat.actor, "walk");

      let windup: string | undefined;
      for (let tick = 0; tick < 40; tick += 1) {
        await setHealth(100);
        await step(0.05);
        windup = (await actor(profile.combat.actor))?.state;
        if (windup === "attack") break;
      }
      check(`${profile.id} hostile winds up`, windup === "attack", windup ?? "missing");
      await shot(`${profile.id}-attack-windup`, profile.combat.actor, "attack");
      await step(0.18);
      await shot(`${profile.id}-attack-impact`, profile.combat.actor, "attack");

      await loadLevel(profile.combat.level);
      await pose(
        profile.combat.x,
        profile.combat.y,
        0,
        profile.combat.yaw,
        0,
      );
      await step(0.05);
      await setHealth(100);
      const struck = await attack();
      await step(0.12);
      const hurtActor = await actor(profile.combat.actor);
      check(
        `${profile.id} strike lands and staggers`,
        struck && hurtActor?.state === "hurt",
        `hit=${struck} state=${hurtActor?.state}`,
      );
      await shot(`${profile.id}-hurt`, profile.combat.actor, "hurt");

      await step(0.4);
      let strikes = 1;
      let dead = false;
      while (strikes < 8) {
        await setHealth(100);
        await attack();
        await step(0.1);
        const current = await actor(profile.combat.actor);
        strikes += 1;
        if (!current) break;
        if (current.hp <= 0) {
          dead = true;
          break;
        }
        await step(0.4);
      }
      check(
        `${profile.id} dies after repeated strikes`,
        dead,
        `${strikes} strikes, ${(await actor(profile.combat.actor))?.hp ?? "missing"} hp left`,
      );
      await step(0.08);
      await shot(`${profile.id}-death-early`, profile.combat.actor, "death");
      await step(0.25);
      await shot(`${profile.id}-death-mid`, profile.combat.actor, "death");
      await step(0.35);
      await shot(`${profile.id}-corpse`, profile.combat.actor, "death");
      const corpse = await actor(profile.combat.actor);
      check(
        `${profile.id} corpse remains rendered`,
        corpse?.alive === false && (await visible(profile.combat.actor)) > 200,
        `alive=${corpse?.alive} px=${await visible(profile.combat.actor)}`,
      );
    }

    const failed = checks.filter((entry) => !entry.ok);
    const report = {
      generatedAt: new Date().toISOString(),
      url,
      durationMs: Date.now() - startedAt,
      passed: checks.length - failed.length,
      failed: failed.length,
      checks,
      shots,
      sheet: join(outDir, "contact-sheet.png"),
    };
    writeFileSync(join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    composeSheet(canvasShots, join(outDir, "contact-sheet.png"));
    console.log(
      `\nSTATE GALLERY ${failed.length === 0 ? "PASSED" : "FAILED"} — ` +
        `${checks.length - failed.length}/${checks.length} checks, ${shots.length} captures`,
    );
    if (failed.length > 0) process.exitCode = 1;
  } finally {
    await browser?.close();
    server.kill("SIGTERM");
  }
}
