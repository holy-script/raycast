import type { SpriteAtlas } from "./engine/atlas";
import { InputController } from "./engine/input";
import {
  clamp,
  elevationAngle,
  lerp,
  quantizePitch,
  shortestAngleDelta,
  spriteYawIndex,
  wrapAngle,
} from "./engine/math";
import {
  Renderer,
  type CameraState,
  type SpriteDraw,
  type Texture,
} from "./engine/renderer";
import { canOccupy, createWorld, type World } from "./engine/world";
import { DEMO_ACTORS, type ActorSpec } from "./content/actors";
import { DEMO_MAP, DEMO_SPAWN } from "./content/demo-map";

export const FOV = (70 * Math.PI) / 180;
const HIGH_ALTITUDE_FOV = (100 * Math.PI) / 180;
const EYE_HEIGHT = 0.55;
const PLAYER_RADIUS = 0.19;
const WALK_SPEED = 3.0;
const SPRINT_SPEED = 4.6;
const FLY_SPEED = 4.0;
const GRAVITY = 18;
const JUMP_SPEED = 3.0;
const JET_THRUST = 34;
const JET_MAX_UP = 5.6;
const TERMINAL_FALL = 15;
const JET_FUEL_SECONDS = 5.0;
const JET_REFUEL_RATE = 0.5;
const MOUSE_SENSITIVITY = 0.0022;
const GROUND_PITCH_LIMIT = 1.1;
const AIR_PITCH_LIMIT = 0.92;
const MAX_ALTITUDE = 18;

export interface GameAssets {
  atlases: Record<string, SpriteAtlas>;
  textures: Record<number, Texture>;
  floor: Texture;
}

interface Player {
  x: number;
  y: number;
  z: number;
  vz: number;
  yaw: number;
  pitch: number;
  onGround: boolean;
  bobPhase: number;
  eyeBob: number;
  fuel: number;
  thrusting: boolean;
}

interface Actor {
  spec: ActorSpec;
  x: number;
  y: number;
  z: number;
  facing: number;
  state: "idle" | "walk";
  animTime: number;
  patrolT: number;
}

export interface HudState {
  x: number;
  y: number;
  z: number;
  vz: number;
  yawDeg: number;
  pitchDeg: number;
  flying: boolean;
  airborne: boolean;
  thrusting: boolean;
  fuel: number;
  nearestName: string;
  nearestSprite: string;
  nearestDistance: number;
  nearestYaw: number;
  nearestPitch: number;
}

const PITCH_LABELS = ["LOW", "LEVEL", "HIGH"];

export class Game {
  readonly world: World;
  readonly input: InputController;
  minimapVisible = true;
  hudDetailVisible = true;
  flying = false;

  private readonly player: Player;
  private readonly actors: Actor[];
  private readonly renderer: Renderer;
  private readonly assets: GameAssets;

  constructor(renderer: Renderer, assets: GameAssets, canvas: HTMLCanvasElement) {
    this.renderer = renderer;
    this.assets = assets;
    this.world = createWorld(DEMO_MAP, DEMO_SPAWN);
    this.input = new InputController(canvas);

    this.player = {
      x: DEMO_SPAWN.x,
      y: DEMO_SPAWN.y,
      z: 0,
      vz: 0,
      yaw: 0,
      pitch: 0,
      onGround: true,
      bobPhase: 0,
      eyeBob: 0,
      fuel: 1,
      thrusting: false,
    };

    this.actors = DEMO_ACTORS.map((spec) => ({
      spec,
      x: spec.x,
      y: spec.y,
      z: 0,
      facing: spec.facing,
      state: spec.behavior === "patrol" ? "walk" : "idle",
      animTime: Math.random() * 4,
      patrolT: 0,
    }));

    this.input.onAction = (action) => {
      if (action === "toggle-map") this.minimapVisible = !this.minimapVisible;
      if (action === "toggle-debug") this.hudDetailVisible = !this.hudDetailVisible;
      if (action === "toggle-fly") this.flying = !this.flying;
      if (action === "respawn") this.respawn();
    };
  }

  update(dt: number): void {
    this.updateActors(dt);
    if (!this.input.active) return;

    const look = this.input.consumeLook();
    this.player.yaw = wrapAngle(this.player.yaw + look.x * MOUSE_SENSITIVITY);
    this.player.pitch -= look.y * MOUSE_SENSITIVITY;
    this.settlePitch(dt);

    const forward =
      (this.input.isDown("KeyW") ? 1 : 0) - (this.input.isDown("KeyS") ? 1 : 0);
    const strafe =
      (this.input.isDown("KeyD") ? 1 : 0) - (this.input.isDown("KeyA") ? 1 : 0);

    const dirX = Math.cos(this.player.yaw);
    const dirY = Math.sin(this.player.yaw);
    let moveX = dirX * forward - dirY * strafe;
    let moveY = dirY * forward + dirX * strafe;
    const length = Math.hypot(moveX, moveY);
    if (length > 0) {
      moveX /= length;
      moveY /= length;
    }

    const sprint =
      this.input.isDown("ShiftLeft") || this.input.isDown("ShiftRight");
    const speed = this.flying
      ? FLY_SPEED
      : sprint
        ? SPRINT_SPEED
        : WALK_SPEED;
    const stepDistance = speed * dt;

    if (moveX !== 0 || moveY !== 0) {
      const nextX = this.player.x + moveX * stepDistance;
      if (canOccupy(this.world, nextX, this.player.y, PLAYER_RADIUS)) {
        this.player.x = nextX;
      }
      const nextY = this.player.y + moveY * stepDistance;
      if (canOccupy(this.world, this.player.x, nextY, PLAYER_RADIUS)) {
        this.player.y = nextY;
      }
    }

    if (this.flying) {
      const vertical =
        (this.input.isDown("Space") ? 1 : 0) -
        (this.input.isDown("ControlLeft") ||
        this.input.isDown("ControlRight") ||
        this.input.isDown("KeyC")
          ? 1
          : 0);
      this.player.z = clamp(
        this.player.z + vertical * FLY_SPEED * dt,
        0,
        MAX_ALTITUDE,
      );
      this.player.vz = 0;
      this.player.onGround = this.player.z <= 0.001;
      this.player.thrusting = false;
    } else {
      const wantsThrust =
        this.input.isDown("Space") && this.player.fuel > 0.001;
      this.player.thrusting = wantsThrust;

      if (wantsThrust) {
        if (this.player.onGround) {
          this.player.vz = Math.max(this.player.vz, JUMP_SPEED);
        }
        this.player.vz += JET_THRUST * dt;
        this.player.fuel = Math.max(0, this.player.fuel - dt / JET_FUEL_SECONDS);
        this.player.onGround = false;
      }

      this.player.vz = clamp(
        this.player.vz - GRAVITY * dt,
        -TERMINAL_FALL,
        JET_MAX_UP,
      );
      this.player.z += this.player.vz * dt;

      if (this.player.z >= MAX_ALTITUDE) {
        this.player.z = MAX_ALTITUDE;
        this.player.vz = this.player.thrusting ? 0 : Math.min(this.player.vz, 0);
      }

      if (this.player.z <= 0) {
        this.player.z = 0;
        this.player.vz = 0;
        this.player.onGround = true;
        this.player.fuel = Math.min(1, this.player.fuel + JET_REFUEL_RATE * dt);
      } else {
        this.player.onGround = false;
      }
    }

    const moving = length > 0;
    const bobTarget =
      moving && this.player.onGround ? Math.sin(this.player.bobPhase) * 0.015 : 0;
    if (moving && this.player.onGround) {
      this.player.bobPhase += dt * (sprint ? 13 : 9.5);
    }
    this.player.eyeBob = lerp(this.player.eyeBob, bobTarget, Math.min(1, dt * 12));
  }

  private pitchLimit(): number {
    return this.player.z > 0.04 || this.flying
      ? AIR_PITCH_LIMIT
      : GROUND_PITCH_LIMIT;
  }

  private settlePitch(dt: number): void {
    const limit = this.pitchLimit();
    const excess = Math.abs(this.player.pitch) - limit;
    if (excess <= 0) return;
    const decay = Math.max(0, 1 - dt * 5);
    this.player.pitch =
      Math.sign(this.player.pitch) * (limit + excess * decay);
  }

  private updateActors(dt: number): void {
    for (const actor of this.actors) {
      actor.animTime += dt;

      if (actor.spec.behavior === "watcher") {
        const target = Math.atan2(
          this.player.y - actor.y,
          this.player.x - actor.x,
        );
        actor.facing +=
          shortestAngleDelta(actor.facing, target) * Math.min(1, dt * 2.4);
      }

      if (actor.spec.behavior === "patrol" && actor.spec.patrol) {
        const p = actor.spec.patrol;
        const length = Math.hypot(p.bx - p.ax, p.by - p.ay);
        if (length > 0.001) {
          actor.patrolT += (dt * p.speed) / length;
          const cycle = ((actor.patrolT % 2) + 2) % 2;
          const u = cycle <= 1 ? cycle : 2 - cycle;
          const direction = cycle <= 1 ? 1 : -1;
          actor.x = lerp(p.ax, p.bx, u);
          actor.y = lerp(p.ay, p.by, u);
          actor.facing = Math.atan2((p.by - p.ay) * direction, (p.bx - p.ax) * direction);
        }
        actor.state = "walk";
      }
    }
  }

  render(): void {
    const camera = this.cameraState();
    this.renderer.render(
      camera,
      this.world,
      this.assets.textures,
      this.assets.floor,
      this.buildSprites(camera),
    );
  }

  private cameraState(): CameraState {
    const altitudeT = clamp((this.player.z - 1) / 10, 0, 1);
    const fov = FOV + (HIGH_ALTITUDE_FOV - FOV) * altitudeT;
    const tanHalf = Math.tan(fov / 2);
    const dirX = Math.cos(this.player.yaw);
    const dirY = Math.sin(this.player.yaw);
    const focal = this.renderer.width / 2 / tanHalf;
    const eyeZ = this.player.z + EYE_HEIGHT + this.player.eyeBob;
    return {
      x: this.player.x,
      y: this.player.y,
      eyeZ,
      yaw: this.player.yaw,
      pitch: this.player.pitch,
      dirX,
      dirY,
      planeX: -dirY * tanHalf,
      planeY: dirX * tanHalf,
      tanHalf,
      focal,
      fogScale: clamp(1 - (eyeZ - 1.5) / 24, 0.35, 1),
    };
  }

  private atlasFor(spec: ActorSpec): SpriteAtlas {
    return this.assets.atlases[spec.sprite] ?? this.assets.atlases.guardian;
  }

  private buildSprites(camera: CameraState): SpriteDraw[] {
    const draws: SpriteDraw[] = [];

    for (const actor of this.actors) {
      const atlas = this.atlasFor(actor.spec);
      const manifest = atlas.manifest;
      const dx = camera.x - actor.x;
      const dy = camera.y - actor.y;
      const distance = Math.hypot(dx, dy);
      if (distance < 0.001) continue;

      const yawIndex = spriteYawIndex(
        Math.atan2(dy, dx),
        actor.facing,
        manifest.directions,
      );
      const worldSize = manifest.frameWorldSize * (actor.spec.scale ?? 1);
      const centerZ =
        actor.z +
        (manifest.frameAnchorZ ?? 0) +
        (manifest.frameWorldSize * (actor.spec.scale ?? 1)) / 2;
      const pitchIndex = quantizePitch(
        elevationAngle(camera.eyeZ, centerZ, distance),
        0.08,
      );
      const stateDef = manifest.states[actor.state] ?? manifest.states.idle;
      const frameIndex = stateDef
        ? Math.floor(actor.animTime * stateDef.fps) % stateDef.frames
        : 0;
      const frame = atlas.getFrame(actor.state, pitchIndex, yawIndex, frameIndex);
      if (!frame) continue;

      draws.push({
        x: actor.x,
        y: actor.y,
        z: actor.z,
        facing: actor.facing,
        frame,
        worldSize,
        anchorZ: manifest.frameAnchorZ ?? 0,
        tint: actor.spec.tint,
      });
    }

    return draws;
  }

  getHudState(): HudState {
    const camera = this.cameraState();
    let nearest: Actor | null = null;
    let best = Infinity;
    for (const actor of this.actors) {
      const distance = Math.hypot(camera.x - actor.x, camera.y - actor.y);
      if (distance < best) {
        best = distance;
        nearest = actor;
      }
    }

    let nearestYaw = -1;
    let nearestPitch = -1;
    if (nearest) {
      const manifest = this.atlasFor(nearest.spec).manifest;
      nearestYaw = spriteYawIndex(
        Math.atan2(camera.y - nearest.y, camera.x - nearest.x),
        nearest.facing,
        manifest.directions,
      );
      nearestPitch = quantizePitch(
        elevationAngle(
          camera.eyeZ,
          nearest.z + (manifest.frameAnchorZ ?? 0) + manifest.frameWorldSize / 2,
          best,
        ),
        0.08,
      );
    }

    return {
      x: this.player.x,
      y: this.player.y,
      z: this.player.z,
      vz: this.player.vz,
      yawDeg: Math.round((wrapAngle(this.player.yaw) * 180) / Math.PI),
      pitchDeg: Math.round((this.player.pitch * 180) / Math.PI),
      flying: this.flying,
      airborne: this.player.z > 0.04,
      thrusting: this.player.thrusting,
      fuel: this.player.fuel,
      nearestName: nearest?.spec.name ?? "none",
      nearestSprite: nearest?.spec.sprite ?? "none",
      nearestDistance: best,
      nearestYaw,
      nearestPitch,
    };
  }

  getPitchLabel(index: number): string {
    return PITCH_LABELS[index] ?? "?";
  }

  drawMinimap(ctx: CanvasRenderingContext2D, size: number): void {
    ctx.clearRect(0, 0, size, size);
    if (!this.minimapVisible) return;

    const { world } = this;
    const scale = size / Math.max(world.width, world.height);

    ctx.fillStyle = "#0a0c12";
    ctx.fillRect(0, 0, size, size);

    for (let y = 0; y < world.height; y += 1) {
      for (let x = 0; x < world.width; x += 1) {
        const tile = world.tiles[y * world.width + x];
        if (tile === 0) continue;
        ctx.fillStyle = tile === 2 ? "#39434f" : "#2a2f3c";
        ctx.fillRect(x * scale, (world.height - 1 - y) * scale, scale - 0.5, scale - 0.5);
      }
    }

    for (const actor of this.actors) {
      const ax = actor.x * scale;
      const ay = (world.height - actor.y) * scale;
      ctx.fillStyle = "#66c7cd";
      ctx.fillRect(ax - 1.5, ay - 1.5, 3, 3);
      ctx.strokeStyle = "#66c7cd";
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax + Math.cos(actor.facing) * 5, ay + Math.sin(actor.facing) * 5);
      ctx.stroke();
    }

    const px = this.player.x * scale;
    const py = (world.height - this.player.y) * scale;

    ctx.strokeStyle = "rgba(255, 210, 138, 0.24)";
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(
      px + Math.cos(this.player.yaw - FOV / 2) * 26,
      py + Math.sin(this.player.yaw - FOV / 2) * 26,
    );
    ctx.moveTo(px, py);
    ctx.lineTo(
      px + Math.cos(this.player.yaw + FOV / 2) * 26,
      py + Math.sin(this.player.yaw + FOV / 2) * 26,
    );
    ctx.stroke();

    ctx.fillStyle = "#ffd28a";
    ctx.beginPath();
    ctx.arc(px, py, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ffd28a";
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + Math.cos(this.player.yaw) * 7, py + Math.sin(this.player.yaw) * 7);
    ctx.stroke();

    ctx.strokeStyle = "#3a4152";
    ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
  }

  respawn(): void {
    this.player.x = DEMO_SPAWN.x;
    this.player.y = DEMO_SPAWN.y;
    this.player.z = 0;
    this.player.vz = 0;
    this.player.yaw = 0;
    this.player.pitch = 0;
    this.player.fuel = 1;
    this.player.thrusting = false;
    this.player.onGround = true;
    this.flying = false;
  }

  setPose(x: number, y: number, z: number, yaw: number, pitch: number): void {
    this.player.x = x;
    this.player.y = y;
    this.player.z = z;
    this.player.vz = 0;
    this.player.onGround = z <= 0.001;
    this.player.yaw = wrapAngle(yaw);
    const limit = this.pitchLimit();
    this.player.pitch = clamp(pitch, -limit, limit);
  }

  setFlying(value: boolean): void {
    this.flying = value;
  }

  isThrusting(): boolean {
    return this.player.thrusting;
  }
}
