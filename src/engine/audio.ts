import type { Game, GameEvent, HudState } from "../game";
import { computeAudioMix, type AudioMix } from "./audio-mix";

const MASTER_LEVEL = 0.5;
const STEP_INTERVAL_WALK = 0.4;
const STEP_INTERVAL_SPRINT = 0.28;

interface BedSettings {
  /** Lowpass cutoff of the looping wind/noise layer, in Hz. */
  cutoff: number;
  wind: number;
  hum: number;
  low: number;
  mid: number;
}

/** Each place gets its own drone: the foundry rumbles, the courtyard breathes. */
const BED_SETTINGS: Record<string, BedSettings> = {
  courtyard: { cutoff: 320, wind: 0.045, hum: 0.018, low: 54, mid: 81 },
  reactor: { cutoff: 180, wind: 0.055, hum: 0.032, low: 44, mid: 66 },
  district: { cutoff: 420, wind: 0.04, hum: 0.014, low: 62, mid: 93 },
  foundry: { cutoff: 120, wind: 0.065, hum: 0.038, low: 38, mid: 57 },
  indoor: { cutoff: 140, wind: 0.016, hum: 0.026, low: 48, mid: 72 },
};

export interface AudioDebug {
  bed: string;
  intensity: number;
  bass: number;
  pad: number;
  percussion: number;
  lowHealth: boolean;
  muted: boolean;
  running: boolean;
}

/**
 * Fully procedural WebAudio soundscape: no audio files, deterministic after the
 * first user gesture. Continuous layers (ambience bed, music bed, jet) run from
 * persistent nodes retuned by the mix; percussion, footsteps, and event cues
 * are short synthesized envelopes.
 */
export class Soundscape {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private jetGain: GainNode | null = null;
  private ambienceFilter: BiquadFilterNode | null = null;
  private ambienceGain: GainNode | null = null;
  private humGain: GainNode | null = null;
  private humLow: OscillatorNode | null = null;
  private humMid: OscillatorNode | null = null;
  private bassGain: GainNode | null = null;
  private padGain: GainNode | null = null;
  private bed = "";
  private mix: AudioMix = {
    bed: "courtyard",
    intensity: 0,
    bass: 0.18,
    pad: 0.12,
    percussion: 0.05,
    lowHealth: false,
  };
  private stepTimer = 0;
  private beatTimer = 0;
  private heartbeatTimer = 0;
  private lastX = 0;
  private lastY = 0;
  private hasPosition = false;
  private muted: boolean;

  constructor(muted: boolean) {
    this.muted = muted;
  }

  get running(): boolean {
    return this.ctx !== null && this.ctx.state === "running";
  }

  unlock(): void {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return;
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : MASTER_LEVEL;
      this.master.connect(this.ctx.destination);
      this.noise = this.createNoise();
      this.startAmbience();
      this.startMusic();
      this.startJet();
      this.hasPosition = false;
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(
        muted ? 0 : MASTER_LEVEL,
        this.ctx.currentTime,
        0.03,
      );
    }
  }

  /** Mix decision for the current frame, exposed to automation and tests. */
  getDebug(): AudioDebug {
    return {
      bed: this.mix.bed,
      intensity: this.mix.intensity,
      bass: this.mix.bass,
      pad: this.mix.pad,
      percussion: this.mix.percussion,
      lowHealth: this.mix.lowHealth,
      muted: this.muted,
      running: this.running,
    };
  }

  update(dt: number, game: Game): void {
    this.mix = this.computeMix(game.getHudState());
    const ctx = this.ctx;
    if (!ctx) {
      // Drain so the first gesture does not replay a backlog of cues.
      game.consumeEvents();
      return;
    }

    for (const event of game.consumeEvents()) this.play(event);

    this.applyBed(this.mix.bed);
    this.applyMix(this.mix);

    if (dt <= 0) {
      this.jetGain?.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
      return;
    }

    const state = game.getHudState();
    if (!this.hasPosition) {
      this.lastX = state.x;
      this.lastY = state.y;
      this.hasPosition = true;
    }
    const distance = Math.hypot(state.x - this.lastX, state.y - this.lastY);
    this.lastX = state.x;
    this.lastY = state.y;
    const speed = distance / dt;

    if (state.onGround && !state.dead && speed > 0.5) {
      this.stepTimer -= dt;
      if (this.stepTimer <= 0) {
        const sprinting = speed > 3.6;
        this.burst(0.09, sprinting ? 0.08 : 0.055, sprinting ? 150 : 190, 1.4);
        this.stepTimer = sprinting ? STEP_INTERVAL_SPRINT : STEP_INTERVAL_WALK;
      }
    } else {
      this.stepTimer = 0;
    }

    if (this.jetGain) {
      const target = state.thrusting && !state.dead ? 0.2 : 0;
      this.jetGain.gain.setTargetAtTime(target, ctx.currentTime, 0.06);
    }

    this.advanceMusic(dt);
    this.advanceHeartbeat(dt);
  }

  private computeMix(state: HudState): AudioMix {
    return computeAudioMix({
      levelId: state.levelId,
      indoor: state.ceiling > 0,
      stage: state.mission ? state.mission.stage : null,
      kills: state.mission ? state.mission.kills : state.huntKills,
      targets: state.mission ? state.mission.targets : state.huntTargets,
      bossDistance: state.boss ? state.boss.distance : null,
      health: state.health,
      maxHealth: state.maxHealth,
      dead: state.dead,
    });
  }

  private applyBed(bed: string): void {
    if (bed === this.bed) return;
    this.bed = bed;
    const settings = BED_SETTINGS[bed] ?? BED_SETTINGS.courtyard;
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    this.ambienceFilter?.frequency.setTargetAtTime(settings.cutoff, now, 0.4);
    this.ambienceGain?.gain.setTargetAtTime(settings.wind, now, 0.6);
    this.humGain?.gain.setTargetAtTime(settings.hum, now, 0.5);
    this.humLow?.frequency.setTargetAtTime(settings.low, now, 0.8);
    this.humMid?.frequency.setTargetAtTime(settings.mid, now, 0.8);
  }

  private applyMix(mix: AudioMix): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    this.bassGain?.gain.setTargetAtTime(mix.bass * 0.08, now, 0.25);
    this.padGain?.gain.setTargetAtTime(mix.pad * 0.045, now, 0.4);
  }

  private advanceMusic(dt: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.beatTimer -= dt;
    if (this.beatTimer > 0) return;
    const mix = this.mix;
    this.beatTimer = Math.max(0.28, 0.62 - mix.intensity * 0.28);
    this.tone("sine", 96, 46, 0.22, mix.percussion * 0.16);
    if (mix.intensity > 0.3) {
      this.burst(0.045, mix.percussion * 0.08, 6800, 1.2);
    }
  }

  private advanceHeartbeat(dt: number): void {
    if (!this.mix.lowHealth) {
      this.heartbeatTimer = 0;
      return;
    }
    this.heartbeatTimer -= dt;
    if (this.heartbeatTimer > 0) return;
    this.heartbeatTimer = 0.9;
    this.tone("sine", 78, 44, 0.16, 0.11);
    this.tone("sine", 66, 38, 0.14, 0.08, 0.18);
  }

  private play(event: GameEvent): void {
    switch (event) {
      case "shot":
        this.burst(0.1, 0.14, 1400, 0.9);
        this.tone("square", 760, 220, 0.11, 0.06);
        break;
      case "enemy-shot":
        this.tone("sawtooth", 420, 140, 0.16, 0.06);
        this.burst(0.1, 0.05, 800, 1.2);
        break;
      case "charge":
        this.tone("sine", 240, 900, 0.9, 0.05);
        this.tone("sawtooth", 120, 320, 0.9, 0.03);
        break;
      case "hit":
        this.tone("square", 160, 70, 0.12, 0.12);
        this.burst(0.08, 0.1, 700, 1);
        break;
      case "blocked":
        this.tone("square", 760, 520, 0.09, 0.06);
        this.burst(0.07, 0.05, 1600, 0.7);
        break;
      case "kill":
        this.tone("sawtooth", 120, 40, 0.35, 0.14);
        this.burst(0.25, 0.12, 300, 0.8);
        break;
      case "hurt":
        this.tone("sawtooth", 300, 90, 0.28, 0.12);
        break;
      case "death":
        this.tone("sine", 180, 36, 0.9, 0.18);
        this.tone("sawtooth", 90, 30, 0.9, 0.07, 0.05);
        break;
      case "pickup":
        this.tone("sine", 660, 660, 0.08, 0.1);
        this.tone("sine", 990, 990, 0.12, 0.09, 0.08);
        break;
      case "door":
        this.tone("square", 120, 70, 0.2, 0.09);
        this.burst(0.22, 0.09, 240, 2);
        break;
      case "locked":
        this.tone("square", 110, 100, 0.1, 0.07);
        this.tone("square", 110, 100, 0.1, 0.07, 0.14);
        break;
      case "talk":
        this.tone("triangle", 520, 620, 0.07, 0.06);
        break;
      case "redeploy":
        this.tone("sine", 330, 660, 0.35, 0.1);
        this.tone("sine", 495, 990, 0.4, 0.05, 0.1);
        break;
      case "level":
        this.tone("triangle", 220, 760, 0.5, 0.1);
        this.burst(0.5, 0.05, 1200, 0.6);
        break;
      case "boss":
        this.tone("sawtooth", 70, 110, 0.7, 0.13);
        this.tone("square", 55, 82, 0.55, 0.08, 0.05);
        this.burst(0.45, 0.1, 200, 1);
        break;
      case "extract":
        this.tone("triangle", 330, 660, 0.4, 0.08);
        this.tone("triangle", 495, 880, 0.45, 0.05, 0.12);
        break;
      case "victory":
        this.tone("sine", 262, 262, 0.7, 0.12);
        this.tone("sine", 330, 330, 0.7, 0.09, 0.04);
        this.tone("sine", 392, 392, 0.8, 0.07, 0.08);
        this.burst(0.6, 0.05, 3200, 0.8);
        break;
    }
  }

  private tone(
    type: OscillatorType,
    from: number,
    to: number,
    duration: number,
    level: number,
    delay = 0,
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(level, start + Math.min(0.02, duration * 0.2));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain).connect(this.master);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  private burst(
    duration: number,
    level: number,
    frequency: number,
    q: number,
    delay = 0,
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const start = ctx.currentTime + delay;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(frequency, start);
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(start);
    source.stop(start + duration);
  }

  private createNoise(): AudioBuffer {
    const ctx = this.ctx;
    if (!ctx) throw new Error("Audio context missing");
    const length = Math.floor(ctx.sampleRate * 2);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) {
      data[index] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  private startAmbience(): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || !this.noise) return;

    const wind = ctx.createBufferSource();
    wind.buffer = this.noise;
    wind.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = BED_SETTINGS.courtyard.cutoff;
    filter.Q.value = 0.8;
    const carrier = ctx.createGain();
    carrier.gain.value = 0;
    wind.connect(filter).connect(carrier).connect(master);
    wind.start();

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.012;
    lfo.connect(lfoGain).connect(carrier.gain);
    lfo.start();

    const humGain = ctx.createGain();
    humGain.gain.value = 0;
    humGain.connect(master);
    const low = ctx.createOscillator();
    low.type = "sine";
    low.frequency.value = BED_SETTINGS.courtyard.low;
    const mid = ctx.createOscillator();
    mid.type = "triangle";
    mid.frequency.value = BED_SETTINGS.courtyard.mid;
    low.connect(humGain);
    mid.connect(humGain);
    low.start();
    mid.start();

    this.ambienceFilter = filter;
    this.ambienceGain = carrier;
    this.humGain = humGain;
    this.humLow = low;
    this.humMid = mid;
    this.bed = "";
  }

  private startMusic(): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;

    const bassGain = ctx.createGain();
    bassGain.gain.value = 0;
    bassGain.connect(master);
    const bass = ctx.createOscillator();
    bass.type = "sine";
    bass.frequency.value = 55;
    const bassBody = ctx.createOscillator();
    bassBody.type = "triangle";
    bassBody.frequency.value = 110;
    const bodyGain = ctx.createGain();
    bodyGain.gain.value = 0.35;
    bass.connect(bassGain);
    bassBody.connect(bodyGain).connect(bassGain);
    bass.start();
    bassBody.start();

    const padGain = ctx.createGain();
    padGain.gain.value = 0;
    padGain.connect(master);
    for (const [frequency, detune] of [
      [110, 4],
      [164.81, -6],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = frequency;
      osc.detune.value = detune;
      osc.connect(padGain);
      osc.start();
    }

    this.bassGain = bassGain;
    this.padGain = padGain;
  }

  private startJet(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 520;
    filter.Q.value = 0.7;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    source.connect(filter).connect(gain).connect(this.master);
    source.start();
    this.jetGain = gain;
  }
}
