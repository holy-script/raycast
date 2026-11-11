import "./style.css";
import { loadAtlas, loadTexture } from "./engine/atlas";
import { Soundscape } from "./engine/audio";
import { Renderer } from "./engine/renderer";
import { Game, type HudState, type RenderDebug } from "./game";
import { loadSettings, saveSettings } from "./settings";

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
  const pausePanel = byId<HTMLDivElement>("pause");
  const enter = byId<HTMLButtonElement>("enter");
  const pauseResume = byId<HTMLButtonElement>("pause-resume");
  const sensitivityInput = byId<HTMLInputElement>("set-sensitivity");
  const sensitivityValue = byId<HTMLOutputElement>("set-sensitivity-value");
  const fovInput = byId<HTMLInputElement>("set-fov");
  const fovValue = byId<HTMLOutputElement>("set-fov-value");
  const muteInput = byId<HTMLInputElement>("set-mute");
  const muteValue = byId<HTMLOutputElement>("set-mute-value");
  const hud = byId<HTMLDivElement>("hud");

  const hudFps = byId<HTMLSpanElement>("hud-fps");
  const hudPos = byId<HTMLSpanElement>("hud-pos");
  const hudAlt = byId<HTMLSpanElement>("hud-alt");
  const hudLook = byId<HTMLSpanElement>("hud-look");
  const hudMode = byId<HTMLSpanElement>("hud-mode");
  const hudFuel = byId<HTMLSpanElement>("hud-fuel");
  const hudFuelFill = byId<HTMLSpanElement>("hud-fuel-fill");
  const hudSprite = byId<HTMLSpanElement>("hud-sprite");
  const hudHealth = byId<HTMLSpanElement>("hud-health");
  const hudHealthFill = byId<HTMLSpanElement>("hud-health-fill");
  const hudLevel = byId<HTMLSpanElement>("hud-level");
  const hudObjective = byId<HTMLDivElement>("hud-objective");
  const hudKeycard = byId<HTMLSpanElement>("hud-keycard");
  const prompt = byId<HTMLDivElement>("prompt");
  const toast = byId<HTMLDivElement>("toast");
  const damage = byId<HTMLDivElement>("damage");
  const thrust = byId<HTMLDivElement>("thrust");

  let assets;
  try {
    const [
      brick,
      panel,
      door,
      floor,
      wallTop,
      keycard,
      medkit,
      fuel,
      beacon,
      guardian,
      vmIdle0,
      vmIdle1,
      vmWindup,
      vmStrike,
      vmRecover,
    ] = await Promise.all([
      loadTexture(`${BASE}assets/textures/brick.png`),
      loadTexture(`${BASE}assets/textures/panel.png`),
      loadTexture(`${BASE}assets/textures/door.png`),
      loadTexture(`${BASE}assets/textures/floor.png`),
      loadTexture(`${BASE}assets/textures/top.png`),
      loadTexture(`${BASE}assets/textures/keycard.png`),
      loadTexture(`${BASE}assets/textures/medkit.png`),
      loadTexture(`${BASE}assets/textures/fuel.png`),
      loadTexture(`${BASE}assets/textures/beacon.png`),
      loadAtlas(`${BASE}assets/sprites/guardian/atlas.json`),
      loadTexture(`${BASE}assets/sprites/player/idle0.png`),
      loadTexture(`${BASE}assets/sprites/player/idle1.png`),
      loadTexture(`${BASE}assets/sprites/player/windup.png`),
      loadTexture(`${BASE}assets/sprites/player/strike.png`),
      loadTexture(`${BASE}assets/sprites/player/recover.png`),
    ]);
    assets = {
      textures: { 1: brick, 2: panel, 3: door },
      floor,
      wallTop,
      props: { keycard, medkit, fuel, beacon },
      atlases: { guardian },
      viewmodel: {
        idle0: vmIdle0,
        idle1: vmIdle1,
        windup: vmWindup,
        strike: vmStrike,
        recover: vmRecover,
      },
    };
  } catch (error) {
    loading.textContent = `ASSET LOAD FAILED — ${String(error)}`;
    console.error(error);
    return;
  }

  const renderer = new Renderer(view, 384, 240);
  const game = new Game(renderer, assets, view);
  loading.classList.add("hidden");

  const settings = loadSettings();
  const audio = new Soundscape(settings.muted);
  const unlockAudio = (): void => {
    audio.unlock();
    // Drop anything queued before the first gesture so it does not replay at once.
    game.consumeEvents();
  };
  const syncSettingsUi = (): void => {
    game.setSensitivity(settings.sensitivity);
    game.setFovDegrees(settings.fov);
    sensitivityInput.value = String(Math.round(settings.sensitivity * 100));
    sensitivityValue.textContent = `${settings.sensitivity.toFixed(2)}\u00d7`;
    fovInput.value = String(Math.round(settings.fov));
    fovValue.textContent = `${Math.round(settings.fov)}\u00b0`;
    muteInput.checked = !settings.muted;
    muteValue.textContent = settings.muted ? "OFF" : "ON";
    audio.setMuted(settings.muted);
  };
  sensitivityInput.addEventListener("input", () => {
    settings.sensitivity = Number(sensitivityInput.value) / 100;
    syncSettingsUi();
    saveSettings(settings);
  });
  fovInput.addEventListener("input", () => {
    settings.fov = Number(fovInput.value);
    syncSettingsUi();
    saveSettings(settings);
  });
  muteInput.addEventListener("change", () => {
    settings.muted = !muteInput.checked;
    syncSettingsUi();
    saveSettings(settings);
    if (!settings.muted) unlockAudio();
  });
  syncSettingsUi();

  if (new URLSearchParams(window.location.search).has("screenshot")) {
    intro.classList.add("hidden");
    pausePanel.classList.add("hidden");
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
  let last = performance.now();
  let smoothedFps = 60;
  let hudClock = 0;
  let paused = false;
  let frameCount = 0;

  const announceLock = (locked: boolean): void => {
    if (locked) {
      started = true;
      paused = false;
      last = performance.now();
      intro.classList.add("hidden");
      pausePanel.classList.add("hidden");
    } else if (started && !game.input.scripted) {
      paused = true;
      pausePanel.classList.remove("hidden");
    }
  };
  game.input.onLockChange = announceLock;

  const requestLock = (): void => {
    unlockAudio();
    try {
      view.requestPointerLock();
    } catch (error) {
      console.warn("Pointer lock unavailable", error);
    }
  };
  enter.addEventListener("click", requestLock);
  pauseResume.addEventListener("click", requestLock);
  view.addEventListener("pointerdown", unlockAudio);

  const syncFrame = (): void => {
    game.render();
    game.drawMinimap(mapCtx, MINIMAP_SIZE);
    thrust.classList.toggle("active", game.isThrusting());
    damage.classList.toggle("dead", game.isDead);
    damage.style.opacity = game.isDead ? "1" : String(game.damageFlash * 0.72);
  };

  const syncHud = (): void => {
    const state = game.getHudState();
    hudFps.textContent = String(Math.round(smoothedFps));
    hudPos.textContent = `${state.x.toFixed(1)} ${state.y.toFixed(1)}`;
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
    hudHealth.textContent = `${Math.round(state.health)} / ${state.maxHealth}`;
    hudHealthFill.style.width = `${(state.health / state.maxHealth) * 100}%`;
    hudHealthFill.classList.toggle("critical", state.health <= 34);
    hudLevel.textContent = state.levelTitle;
    hudObjective.textContent = state.objective;
    hudKeycard.textContent = state.keycard ? "ACQUIRED" : "--";
    hudKeycard.classList.toggle("owned", state.keycard);
    prompt.textContent = state.prompt;
    prompt.classList.toggle("visible", state.prompt !== "");
    toast.textContent = state.toast;
    toast.classList.toggle("visible", state.toast !== "");
    hud.classList.toggle("minimal", !game.hudDetailVisible);
  };

  const frame = (now: number): void => {
    frameCount += 1;
    const elapsed = (now - last) / 1000;
    last = now;
    const dt = Math.min(0.05, elapsed);

    if (!paused) game.update(dt);
    audio.update(paused ? 0 : dt, game);
    syncFrame();

    if (elapsed > 0) smoothedFps = smoothedFps * 0.9 + (1 / elapsed) * 0.1;

    hudClock += elapsed;
    if (hudClock > 0.1) {
      hudClock = 0;
      syncHud();
    }

    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  window.__raycast = {
    game,
    setPose: (x, y, z, yaw, pitch) => game.setPose(x, y, z, yaw, pitch),
    setFlying: (value) => game.setFlying(value),
    debug: () => game.getRenderDebug(),
    atlasReport: () =>
      Object.fromEntries(
        Object.entries(assets.atlases).map(([name, atlas]) => [
          name,
          {
            states: Object.keys(atlas.manifest.states),
            missing: atlas.missingFrames(),
          },
        ]),
      ),
    audioRunning: () => audio.running,
    dismissIntro: () => {
      intro.classList.add("hidden");
      pausePanel.classList.add("hidden");
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
      pause: () => {
        paused = true;
      },
      resume: () => {
        paused = false;
        last = performance.now();
      },
      isPaused: () => paused,
      frameCount: () => frameCount,
      /**
       * Advances the simulation with a fixed timestep while paused, then renders
       * and refreshes the HUD so captures are deterministic.
       */
      step: (seconds, dt = 1 / 60) => {
        const timestep = Math.max(1 / 240, Math.min(0.05, dt));
        const steps = Math.max(0, Math.round(seconds / timestep));
        for (let index = 0; index < steps; index += 1) game.update(timestep);
        syncFrame();
        syncHud();
      },
      reset: () => {
        game.resetLevel();
        game.input.clearKeys();
        game.input.consumeLook();
        syncFrame();
        syncHud();
      },
      setFuel: (value) => {
        game.setFuel(value);
        syncHud();
      },
      setHealth: (value) => {
        game.setHealth(value);
        syncHud();
      },
      attack: () => {
        const hit = game.attack();
        syncFrame();
        syncHud();
        return hit;
      },
      interact: () => {
        const result = game.interact();
        syncFrame();
        syncHud();
        return result;
      },
      loadLevel: (id) => {
        game.loadLevelById(id);
        syncFrame();
        syncHud();
      },
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
      atlasReport: () => Record<string, { states: string[]; missing: string[] }>;
      audioRunning: () => boolean;
      dismissIntro: () => void;
      automation: {
        enable: () => void;
        disable: () => void;
        press: (code: string) => void;
        release: (code: string) => void;
        look: (dx: number, dy: number) => void;
        state: () => HudState;
        pause: () => void;
        resume: () => void;
        isPaused: () => boolean;
        frameCount: () => number;
        step: (seconds: number, dt?: number) => void;
        reset: () => void;
        setFuel: (value: number) => void;
        setHealth: (value: number) => void;
        attack: () => boolean;
        interact: () => "none" | "talk" | "door" | "locked" | "pickup";
        loadLevel: (id: string) => void;
      };
    };
  }
}

void boot();
