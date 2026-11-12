import "./style.css";
import { loadAtlas, loadTexture } from "./engine/atlas";
import { Soundscape, type AudioDebug } from "./engine/audio";
import { Renderer } from "./engine/renderer";
import { Game, type HudState, type RenderDebug } from "./game";
import { loadSettings, saveSettings } from "./settings";
import {
  CAMPAIGN_LEVELS,
  defaultCampaign,
  formatClock,
  isLevelUnlocked,
  loadCampaign,
  markReached,
  recordMission,
  saveCampaign,
  type CampaignRecord,
  type LevelRecord,
} from "./campaign";
import { LEVELS } from "./content/levels";

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
  const hudBossRow = byId<HTMLDivElement>("hud-boss-row");
  const hudBossName = byId<HTMLSpanElement>("hud-boss-name");
  const hudBoss = byId<HTMLSpanElement>("hud-boss");
  const hudBossBar = byId<HTMLDivElement>("hud-boss-bar");
  const hudBossFill = byId<HTMLSpanElement>("hud-boss-fill");
  const hudLevel = byId<HTMLSpanElement>("hud-level");
  const hudObjective = byId<HTMLDivElement>("hud-objective");
  const hudKeycard = byId<HTMLSpanElement>("hud-keycard");
  const prompt = byId<HTMLDivElement>("prompt");
  const toast = byId<HTMLDivElement>("toast");
  const victory = byId<HTMLDivElement>("victory");
  const victoryStats = byId<HTMLParagraphElement>("victory-stats");
  const victoryBest = byId<HTMLParagraphElement>("victory-best");
  const campaignPanel = byId<HTMLDivElement>("campaign");
  const campaignCards = byId<HTMLDivElement>("campaign-cards");
  const campaignBriefing = byId<HTMLDivElement>("campaign-briefing");
  const briefingTitle = byId<HTMLHeadingElement>("briefing-title");
  const briefingObjective = byId<HTMLParagraphElement>("briefing-objective");
  const briefingStats = byId<HTMLParagraphElement>("briefing-stats");
  const briefingDeploy = byId<HTMLButtonElement>("briefing-deploy");
  const briefingBack = byId<HTMLButtonElement>("briefing-back");
  const campaignClose = byId<HTMLButtonElement>("campaign-close");
  const openCampaignButton = byId<HTMLButtonElement>("open-campaign");
  const pauseCampaignButton = byId<HTMLButtonElement>("pause-campaign");
  const damage = byId<HTMLDivElement>("damage");
  const thrust = byId<HTMLDivElement>("thrust");

  let assets;
  try {
    const [
      brick,
      panel,
      door,
      facade,
      floor,
      asphalt,
      topSlab,
      roofSlab,
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
      loadTexture(`${BASE}assets/textures/facade.png`),
      loadTexture(`${BASE}assets/textures/floor.png`),
      loadTexture(`${BASE}assets/textures/asphalt.png`),
      loadTexture(`${BASE}assets/textures/top.png`),
      loadTexture(`${BASE}assets/textures/roof.png`),
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
      textures: { 1: brick, 2: panel, 3: door, 4: facade },
      floors: { floor, asphalt },
      tops: { top: topSlab, roof: roofSlab },
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

  let campaign: CampaignRecord = loadCampaign();
  let campaignOutcome: { improved: boolean; level: LevelRecord } | null = null;
  let campaignOpen = false;
  let selectedLevelId: string | null = null;
  let campaignReturnFocus: HTMLElement | null = null;

  const levelById = (id: string) => LEVELS.find((level) => level.id === id);

  const describeRecord = (record: LevelRecord): string => {
    if (!record.cleared) return "NO CLEAR";
    const clock = record.bestTime !== null ? formatClock(record.bestTime) : "--:--";
    return `BEST ${clock} · ${record.bestKills} KILLS · ${record.deaths} DEATHS`;
  };

  const renderBriefing = (): void => {
    const level = selectedLevelId ? levelById(selectedLevelId) : undefined;
    if (!level) {
      campaignBriefing.classList.add("hidden");
      return;
    }
    const record = campaign.levels[level.id];
    const unlocked = isLevelUnlocked(campaign, level.id);
    briefingTitle.textContent = level.title;
    briefingObjective.textContent = level.objective;
    briefingStats.textContent = unlocked
      ? describeRecord(record)
      : "LOCKED · reach this sector in the field to unlock deployment.";
    briefingDeploy.disabled = !unlocked;
    campaignBriefing.classList.remove("hidden");
  };

  const renderCampaign = (): void => {
    campaignCards.replaceChildren();
    for (const id of CAMPAIGN_LEVELS) {
      const level = levelById(id);
      if (!level) continue;
      const unlocked = isLevelUnlocked(campaign, id);
      const card = document.createElement("button");
      card.type = "button";
      card.dataset.level = id;
      card.className = `level-card${unlocked ? "" : " locked"}${
        selectedLevelId === id ? " selected" : ""
      }`;
      card.setAttribute("aria-pressed", selectedLevelId === id ? "true" : "false");
      const title = document.createElement("span");
      title.className = "card-title";
      title.textContent = level.title;
      const objective = document.createElement("span");
      objective.className = "card-objective";
      objective.textContent = level.objective;
      const stats = document.createElement("span");
      stats.className = "card-stats";
      stats.textContent = unlocked
        ? describeRecord(campaign.levels[id])
        : "LOCKED · discover in the field";
      card.append(title, objective, stats);
      card.addEventListener("click", () => selectLevel(id));
      campaignCards.append(card);
    }
    renderBriefing();
  };

  const selectLevel = (id: string): void => {
    selectedLevelId = id;
    renderCampaign();
    campaignCards
      .querySelector<HTMLButtonElement>(`[data-level="${id}"]`)
      ?.focus();
  };

  const deployLevel = (id: string): boolean => {
    if (!isLevelUnlocked(campaign, id) || !levelById(id)) return false;
    campaignOpen = false;
    campaignPanel.classList.add("hidden");
    intro.classList.add("hidden");
    pausePanel.classList.add("hidden");
    started = true;
    // Scripted input drives its own clock; real play resumes immediately.
    if (!game.input.scripted) {
      paused = false;
      last = performance.now();
    }
    game.loadLevelById(id);
    syncFrame();
    syncHud();
    if (!game.input.scripted) requestLock();
    return true;
  };

  const openCampaign = (): void => {
    campaignReturnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    campaignOpen = true;
    selectedLevelId = null;
    renderCampaign();
    campaignPanel.classList.remove("hidden");
    campaignCards.querySelector<HTMLButtonElement>("button.level-card")?.focus();
  };

  const closeCampaign = (): void => {
    campaignOpen = false;
    campaignPanel.classList.add("hidden");
    campaignReturnFocus?.focus();
    campaignReturnFocus = null;
  };

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
  openCampaignButton.addEventListener("click", openCampaign);
  pauseCampaignButton.addEventListener("click", openCampaign);
  campaignClose.addEventListener("click", closeCampaign);
  briefingBack.addEventListener("click", () => {
    selectedLevelId = null;
    renderCampaign();
    campaignCards.querySelector<HTMLButtonElement>("button.level-card")?.focus();
  });
  briefingDeploy.addEventListener("click", () => {
    if (selectedLevelId) deployLevel(selectedLevelId);
  });
  campaignPanel.addEventListener("keydown", (event) => {
    if (event.code === "Escape") {
      event.preventDefault();
      closeCampaign();
      return;
    }
    if (event.code !== "ArrowDown" && event.code !== "ArrowUp") return;
    const cards = [...campaignCards.querySelectorAll<HTMLButtonElement>("button.level-card")];
    if (cards.length === 0) return;
    event.preventDefault();
    const index = cards.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.code === "ArrowDown" ? 1 : -1;
    const next = cards[(index + step + cards.length) % cards.length];
    next.focus();
  });
  window.addEventListener("keydown", (event) => {
    if (event.code === "KeyL" && game.victoryShown && !campaignOpen) {
      event.preventDefault();
      openCampaign();
      return;
    }
    if (event.code === "Escape" && campaignOpen) closeCampaign();
  });

  game.onLevelLoad = (levelId) => {
    campaign = markReached(campaign, levelId);
    campaignOutcome = null;
    saveCampaign(campaign);
    if (campaignOpen) renderCampaign();
  };
  game.onMissionClear = (clear) => {
    const outcome = recordMission(campaign, clear);
    campaign = outcome.record;
    campaignOutcome = { improved: outcome.improved, level: outcome.level };
    saveCampaign(campaign);
  };
  campaign = markReached(campaign, "courtyard");
  saveCampaign(campaign);
  renderCampaign();

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
    hudBossRow.classList.toggle("hidden", !state.boss);
    hudBossBar.classList.toggle("hidden", !state.boss);
    if (state.boss) {
      hudBossName.textContent = state.boss.name;
      hudBoss.textContent = `${Math.round(state.boss.hp)} / ${state.boss.maxHp}`;
      hudBossFill.style.width = `${(state.boss.hp / state.boss.maxHp) * 100}%`;
    }
    hudLevel.textContent = state.levelTitle;
    hudObjective.textContent = state.objective;
    hudKeycard.textContent = state.keycard ? "ACQUIRED" : "--";
    hudKeycard.classList.toggle("owned", state.keycard);
    prompt.textContent = state.prompt;
    prompt.classList.toggle("visible", state.prompt !== "");
    toast.textContent = state.toast;
    toast.classList.toggle("visible", state.toast !== "");
    victory.classList.toggle("hidden", !state.victory);
    if (state.victory && state.mission) {
      const clock = formatClock(state.mission.time);
      const deathLabel = state.deaths === 1 ? "DEATH" : "DEATHS";
      victoryStats.textContent = `TIME ${clock} · ${state.mission.targets} HOSTILES DOWN · ${state.deaths} ${deathLabel}`;
      const record = campaign.levels[state.levelId];
      const best =
        record?.cleared && record.bestTime !== null
          ? `${record.bestKills} KILLS · BEST ${formatClock(record.bestTime)}`
          : "";
      victoryBest.textContent = best ? `${campaignOutcome?.improved ? "NEW BEST · " : ""}${best}` : "";
      victoryBest.classList.toggle("new-best", campaignOutcome?.improved === true);
    }
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
    audioDebug: (): AudioDebug => audio.getDebug(),
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
        audio.update(0, game);
        syncFrame();
        syncHud();
      },
      reset: () => {
        game.resetLevel();
        game.input.clearKeys();
        game.input.consumeLook();
        audio.update(0, game);
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
      cell: (x, y) => {
        const cellX = Math.floor(x);
        const cellY = Math.floor(y);
        if (
          cellX < 0 ||
          cellY < 0 ||
          cellX >= game.world.width ||
          cellY >= game.world.height
        ) {
          return { tile: 1, height: 0, solid: true };
        }
        const cell = cellY * game.world.width + cellX;
        return {
          tile: game.world.tiles[cell],
          height: game.world.heights[cell],
          solid: game.world.tiles[cell] !== 0,
        };
      },
      loadLevel: (id) => {
        game.loadLevelById(id);
        audio.update(0, game);
        syncFrame();
        syncHud();
      },
      setViewmodelVisible: (visible) => {
        game.viewmodelVisible = visible;
        syncFrame();
      },
    },
    campaign: {
      load: () => campaign,
      reset: () => {
        campaign = defaultCampaign();
        campaignOutcome = null;
        saveCampaign(campaign);
        renderCampaign();
      },
      open: () => openCampaign(),
      close: () => closeCampaign(),
      select: (id) => selectLevel(id),
      deploy: (id) => deployLevel(id),
      view: () => ({
        open: campaignOpen,
        selected: selectedLevelId,
        cards: [...campaignCards.querySelectorAll<HTMLButtonElement>("button.level-card")].map(
          (card) => ({
            id: card.dataset.level ?? "",
            locked: card.classList.contains("locked"),
            selected: card.classList.contains("selected"),
            stats: card.querySelector(".card-stats")?.textContent ?? "",
          }),
        ),
        briefing: {
          hidden: campaignBriefing.classList.contains("hidden"),
          title: briefingTitle.textContent ?? "",
          stats: briefingStats.textContent ?? "",
          deployDisabled: briefingDeploy.disabled,
        },
      }),
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
      audioDebug: () => AudioDebug;
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
        interact: () =>
          "none" | "talk" | "door" | "locked" | "pickup" | "continue";
        cell: (x: number, y: number) => {
          tile: number;
          height: number;
          solid: boolean;
        };
        loadLevel: (id: string) => void;
        setViewmodelVisible: (visible: boolean) => void;
      };
      campaign: {
        load: () => CampaignRecord;
        reset: () => void;
        open: () => void;
        close: () => void;
        select: (id: string) => void;
        deploy: (id: string) => boolean;
        view: () => {
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
      };
    };
  }
}

void boot();
