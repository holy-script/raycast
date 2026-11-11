import "./style.css";
import { loadAtlas, loadTexture } from "./engine/atlas";
import { Renderer } from "./engine/renderer";
import { Game, type HudState, type RenderDebug } from "./game";

const BASE = import.meta.env.BASE_URL;
const MINIMAP_SIZE = 168;

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}

async function boot(): Promise<void> {
  const view = byId<HTMLCanvasElement>("view");
  const minimap = byId<HTMLCanvasElement>("minimap");
  const loading = byId<HTMLDivElement>("loading");
  const intro = byId<HTMLDivElement>("intro");
  const resume = byId<HTMLDivElement>("resume");
  const enter = byId<HTMLButtonElement>("enter");
  const hud = byId<HTMLDivElement>("hud");

  const hudFps = byId<HTMLSpanElement>("hud-fps");
  const hudPos = byId<HTMLSpanElement>("hud-pos");
  const hudAlt = byId<HTMLSpanElement>("hud-alt");
  const hudLook = byId<HTMLSpanElement>("hud-look");
  const hudMode = byId<HTMLSpanElement>("hud-mode");
  const hudFuel = byId<HTMLSpanElement>("hud-fuel");
  const hudFuelFill = byId<HTMLSpanElement>("hud-fuel-fill");
  const hudSprite = byId<HTMLSpanElement>("hud-sprite");
  const thrust = byId<HTMLDivElement>("thrust");

  let assets;
  try {
    const [brick, panel, floor, guardian, scout, brute] = await Promise.all([
      loadTexture(`${BASE}assets/textures/brick.png`),
      loadTexture(`${BASE}assets/textures/panel.png`),
      loadTexture(`${BASE}assets/textures/floor.png`),
      loadAtlas(`${BASE}assets/sprites/guardian/atlas.json`),
      loadAtlas(`${BASE}assets/sprites/scout/atlas.json`),
      loadAtlas(`${BASE}assets/sprites/brute/atlas.json`),
    ]);
    assets = {
      textures: { 1: brick, 2: panel },
      floor,
      atlases: { guardian, scout, brute },
    };
  } catch (error) {
    loading.textContent = `ASSET LOAD FAILED — ${String(error)}`;
    console.error(error);
    return;
  }

  const renderer = new Renderer(view, 384, 240);
  const game = new Game(renderer, assets, view);
  loading.classList.add("hidden");
  if (new URLSearchParams(window.location.search).has("screenshot")) {
    intro.classList.add("hidden");
    resume.classList.add("hidden");
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  minimap.width = MINIMAP_SIZE * dpr;
  minimap.height = MINIMAP_SIZE * dpr;
  minimap.style.width = `${MINIMAP_SIZE}px`;
  minimap.style.height = `${MINIMAP_SIZE}px`;
  const mapCtx = minimap.getContext("2d");
  if (!mapCtx) throw new Error("Minimap canvas unavailable");
  mapCtx.scale(dpr, dpr);

  let started = false;
  const announceLock = (locked: boolean): void => {
    if (locked) {
      started = true;
      intro.classList.add("hidden");
      resume.classList.add("hidden");
    } else if (started) {
      resume.classList.remove("hidden");
    }
  };
  game.input.onLockChange = announceLock;

  const requestLock = (): void => {
    try {
      view.requestPointerLock();
    } catch (error) {
      console.warn("Pointer lock unavailable", error);
    }
  };
  enter.addEventListener("click", requestLock);

  let last = performance.now();
  let smoothedFps = 60;
  let hudClock = 0;

  const frame = (now: number): void => {
    const elapsed = (now - last) / 1000;
    last = now;
    const dt = Math.min(0.05, elapsed);

    game.update(dt);
    game.render();
    game.drawMinimap(mapCtx, MINIMAP_SIZE);
    thrust.classList.toggle("active", game.isThrusting());

    if (elapsed > 0) smoothedFps = smoothedFps * 0.9 + (1 / elapsed) * 0.1;

    hudClock += elapsed;
    if (hudClock > 0.1) {
      hudClock = 0;
      const state = game.getHudState();
      hudFps.textContent = String(Math.round(smoothedFps));
      hudPos.textContent =
        `${state.x.toFixed(1)} ${state.y.toFixed(1)}`;
      hudAlt.textContent = `${state.z.toFixed(2)} m · vz ${state.vz.toFixed(1)}`;
      hudLook.textContent = `yaw ${state.yawDeg} · pitch ${state.pitchDeg}`;
      hudMode.textContent = state.flying
        ? "FREEFLY · DEBUG"
        : state.thrusting
          ? "JETPACK · BURN"
          : state.support > 0.01 && state.onGround
            ? `PERCH · ${state.support.toFixed(1)} m`
            : state.airborne
              ? "AIRBORNE · FALL"
              : `WALK · ${started ? "LIVE" : "ATTRACT"}`;
      hudFuel.textContent = `${Math.round(state.fuel * 100)}%`;
      hudFuelFill.style.width = `${state.fuel * 100}%`;
      hudSprite.textContent =
        state.nearestYaw < 0
          ? "none"
          : `${state.nearestName} · ${state.nearestSprite} · yaw ${state.nearestYaw} · ${game.getPitchLabel(state.nearestPitch)}`;
      hud.classList.toggle("minimal", !game.hudDetailVisible);
    }

    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  window.__raycast = {
    game,
    setPose: (x, y, z, yaw, pitch) => game.setPose(x, y, z, yaw, pitch),
    setFlying: (value) => game.setFlying(value),
    debug: () => game.getRenderDebug(),
    dismissIntro: () => {
      intro.classList.add("hidden");
      resume.classList.add("hidden");
    },
    automation: {
      enable: () => {
        game.input.scripted = true;
      },
      disable: () => {
        game.input.scripted = false;
        game.input.clearKeys();
      },
      press: (code) => game.input.setKey(code, true),
      release: (code) => game.input.setKey(code, false),
      look: (dx, dy) => game.input.addLook(dx, dy),
      state: () => game.getHudState(),
    },
  };
}

declare global {
  interface Window {
    __raycast?: {
      game: Game;
      setPose: (x: number, y: number, z: number, yaw: number, pitch: number) => void;
      setFlying: (value: boolean) => void;
      debug: () => RenderDebug;
      dismissIntro: () => void;
      automation: {
        enable: () => void;
        disable: () => void;
        press: (code: string) => void;
        release: (code: string) => void;
        look: (dx: number, dy: number) => void;
        state: () => HudState;
      };
    };
  }
}

void boot();
