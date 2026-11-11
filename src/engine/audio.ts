import type { Game, GameEvent } from "../game";

const MASTER_LEVEL = 0.5;
const STEP_INTERVAL_WALK = 0.4;
const STEP_INTERVAL_SPRINT = 0.28;

/**
 * Fully procedural WebAudio soundscape: no audio files, deterministic after the
 * first user gesture. Continuous layers (ambience, jet) run from persistent
 * nodes; everything else is a short synthesized envelope per game event.
 */
export class Soundscape {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private jetGain: GainNode | null = null;
  private stepTimer = 0;
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

  update(dt: number, game: Game): void {
    const ctx = this.ctx;
    if (!ctx) return;

    for (const event of game.consumeEvents()) this.play(event);

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
    const speed = dt > 0 ? distance / dt : 0;

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
      case "hit":
        this.tone("square", 160, 70, 0.12, 0.12);
        this.burst(0.08, 0.1, 700, 1);
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
    if (!ctx || !this.master) return;
    const carrier = ctx.createGain();
    carrier.gain.value = 0.035;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 220;
    filter.connect(carrier).connect(this.master);

    const low = ctx.createOscillator();
    low.type = "sine";
    low.frequency.value = 54;
    low.connect(filter);
    low.start();

    const mid = ctx.createOscillator();
    mid.type = "triangle";
    mid.frequency.value = 81;
    mid.connect(filter);
    mid.start();

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.016;
    lfo.connect(lfoGain).connect(carrier.gain);
    lfo.start();
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
