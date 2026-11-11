import type { SpriteAtlas } from "./engine/atlas";
import { createGlowTexture } from "./engine/glow";
import { InputController } from "./engine/input";
import {
  clamp,
  elevationAngle,
  lerp,
  quantizePitch,
  samplePitch,
  sampleStaticPitch,
  shortestAngleDelta,
  spriteYawIndex,
  wrapAngle,
  type PitchIndex,
} from "./engine/math";
import {
  Renderer,
  type CameraState,
  type RenderStats,
  type SpriteDraw,
  type Texture,
  type ViewmodelDraw,
} from "./engine/renderer";
import {
  canOccupy,
  createWorld,
  resolveFootprint,
  STEP_UP,
  supportHeight,
  type World,
} from "./engine/world";
import type { ActorSpec } from "./content/actors";
import {
  hasLineOfSight,
  projectileHitsActor,
  projectileHitsPlayer,
  spawnProjectile,
  stepProjectile,
  type Projectile,
} from "./engine/projectile";
import {
  LEVELS,
  levelIndexById,
  type DoorSpec,
  type ExitSpec,
  type LevelSpec,
  type PickupKind,
  type PickupSpec,
} from "./content/levels";

const DEFAULT_FOV = (70 * Math.PI) / 180;
const MAX_FOV_DEGREES = 90;
const MIN_FOV_DEGREES = 55;
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
const AIR_PITCH_LIMIT = 1.45;
const MAX_ALTITUDE = 18;

const PLAYER_MAX_HEALTH = 100;
const PLAYER_ATTACK_DAMAGE = 45;
const PLAYER_ATTACK_COOLDOWN = 0.45;
const PLAYER_BOLT_SPEED = 22;
const PLAYER_BOLT_LIFE = 0.9;
const BOLT_IMPACT_LIFE = 0.14;
const RESPAWN_DELAY = 1.4;
const DAMAGE_FLASH_TIME = 0.45;
const INTERACT_RANGE = 2.4;
const TALK_RANGE = 2.4;
const PICKUP_RADIUS = 0.5;
const EXIT_RADIUS = 0.6;

const ATTACK_IMPACT = 0.2;
const ATTACK_STATE_TIME = 0.4;
const HURT_STATE_TIME = 0.25;
const DEATH_STATE_TIME = 0.67;

const PITCH_LABELS = ["LOW", "LEVEL", "HIGH", "TOP"];

type ActorState = "idle" | "walk" | "attack" | "hurt" | "death" | "talk";
export type ViewmodelPose = "idle0" | "idle1" | "windup" | "strike" | "recover";

export type GameEvent =
  | "shot"
  | "enemy-shot"
  | "hit"
  | "kill"
  | "hurt"
  | "death"
  | "pickup"
  | "door"
  | "locked"
  | "talk"
  | "redeploy"
  | "level";

interface Impact {
  x: number;
  y: number;
  z: number;
  age: number;
  fromPlayer: boolean;
}

export interface GameAssets {
  atlases: Record<string, SpriteAtlas>;
  textures: Record<number, Texture>;
  floor: Texture;
  wallTop: Texture;
  props: Record<PickupKind | "beacon", Texture>;
  viewmodel: Record<ViewmodelPose, Texture>;
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
  moving: boolean;
  fuel: number;
  thrusting: boolean;
  health: number;
  dead: boolean;
  deathT: number;
  hitFlash: number;
  attackCooldown: number;
}

interface Actor {
  spec: ActorSpec;
  x: number;
  y: number;
  z: number;
  facing: number;
  state: ActorState;
  animTime: number;
  stateT: number;
  patrolT: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  attackCooldown: number;
  hitLanded: boolean;
  talkIndex: number;
}

interface WorldPickup extends PickupSpec {
  taken: boolean;
  seed: number;
}

interface WorldDoor extends DoorSpec {
  open: boolean;
}

export interface HudState {
  x: number;
  y: number;
  z: number;
  vz: number;
  support: number;
  onGround: boolean;
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
  health: number;
  maxHealth: number;
  dead: boolean;
  damageFlash: number;
  levelTitle: string;
  objective: string;
  prompt: string;
  toast: string;
  keycard: boolean;
}

export interface RenderDebug {
  camera: {
    x: number;
    y: number;
    eyeZ: number;
    yaw: number;
    pitch: number;
    forwardX: number;
    forwardY: number;
    fovDegrees: number;
    tanHalf: number;
  };
  player: {
    x: number;
    y: number;
    z: number;
    support: number;
    onGround: boolean;
  };
  level: string;
  viewmodel: { pose: string; dx: number; dy: number };
  actors: Array<{
    name: string;
    x: number;
    y: number;
    z: number;
    facing: number;
    state: string;
    sprite: string;
    yawIndex: number;
    pitchIndex: number;
    frameIndex: number;
    worldSize: number;
    hp: number;
    maxHp: number;
    alive: boolean;
    hostile: boolean;
  }>;
  pickups: Array<{ kind: string; x: number; y: number; taken: boolean }>;
  doors: Array<{ id: string; x: number; y: number; open: boolean }>;
  bolts: Array<{ x: number; y: number; z: number; fromPlayer: boolean }>;
  health: number;
  keycard: boolean;
  stats: RenderStats;
}

export class Game {
  world: World;
  readonly input: InputController;
  minimapVisible = true;
  hudDetailVisible = true;
  viewmodelVisible = true;
  flying = false;
  sensitivity = 1;
  fovDegrees = (DEFAULT_FOV * 180) / Math.PI;

  private readonly player: Player;
  private actors: Actor[] = [];
  private readonly renderer: Renderer;
  private readonly assets: GameAssets;
  private level: LevelSpec = LEVELS[0];
  private levelIndex = 0;
  private pickups: WorldPickup[] = [];
  private doors: WorldDoor[] = [];
  private exits: ExitSpec[] = [];
  private keycard = false;
  private time = 0;
  private toastText = "";
  private toastT = 0;
  private events: GameEvent[] = [];
  private bolts: Projectile[] = [];
  private impacts: Impact[] = [];
  private readonly glowTexture = createGlowTexture(32);

  constructor(renderer: Renderer, assets: GameAssets, canvas: HTMLCanvasElement) {
    this.renderer = renderer;
    this.assets = assets;
    this.world = createWorld(LEVELS[0].rows);
    this.input = new InputController(canvas);

    this.player = {
      x: 0,
      y: 0,
      z: 0,
      vz: 0,
      yaw: 0,
      pitch: 0,
      onGround: true,
      bobPhase: 0,
      eyeBob: 0,
      moving: false,
      fuel: 1,
      thrusting: false,
      health: PLAYER_MAX_HEALTH,
      dead: false,
      deathT: 0,
      hitFlash: 0,
      attackCooldown: 0,
    };

    this.input.onAction = (action) => {
      if (action === "toggle-map") this.minimapVisible = !this.minimapVisible;
      if (action === "toggle-debug") this.hudDetailVisible = !this.hudDetailVisible;
      if (action === "toggle-fly") this.flying = !this.flying;
      if (action === "respawn") this.respawn();
      if (action === "attack") this.attack();
      if (action === "interact") this.interact();
    };

    this.loadLevel(0);
  }

  get currentLevelId(): string {
    return this.level.id;
  }

  update(dt: number): void {
    this.time += dt;
    this.toastT = Math.max(0, this.toastT - dt);
    this.player.hitFlash = Math.max(0, this.player.hitFlash - dt);
    this.player.attackCooldown = Math.max(0, this.player.attackCooldown - dt);
    this.updateActors(dt);
    this.updateProjectiles(dt);

    if (this.player.dead) {
      this.player.deathT += dt;
      if (this.player.deathT >= RESPAWN_DELAY) this.redeploy();
      return;
    }

    if (!this.input.active) return;

    const look = this.input.consumeLook();
    const lookRate = MOUSE_SENSITIVITY * this.sensitivity;
    this.player.yaw = wrapAngle(this.player.yaw + look.x * lookRate);
    this.player.pitch -= look.y * lookRate;
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
      const step = resolveFootprint(
        this.world,
        this.player.x + moveX * stepDistance,
        this.player.y + moveY * stepDistance,
        PLAYER_RADIUS,
        this.player.z,
        STEP_UP,
      );
      this.player.x = step.x;
      this.player.y = step.y;
    }

    const support = supportHeight(
      this.world,
      this.player.x,
      this.player.y,
    );

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
        support,
        MAX_ALTITUDE,
      );
      this.player.vz = 0;
      this.player.onGround = this.player.z <= support + 0.001;
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

      if (this.player.z <= support) {
        this.player.z = support;
        this.player.vz = 0;
        this.player.onGround = true;
      } else if (
        this.player.onGround &&
        this.player.vz <= 0 &&
        this.player.z - support <= STEP_UP + 0.001
      ) {
        // Walking down a stair snaps to the next tread instead of free-falling.
        this.player.z = support;
        this.player.vz = 0;
        this.player.onGround = true;
      } else {
        this.player.onGround = false;
      }

      if (this.player.onGround) {
        this.player.fuel = Math.min(1, this.player.fuel + JET_REFUEL_RATE * dt);
      }
    }

    // Landing or stepping down can leave the capsule overlapping a wall even
    // though the centre cell is walkable. Separate every frame so the player
    // never starts a frame wedged against a wall they cannot walk out of.
    const separated = resolveFootprint(
      this.world,
      this.player.x,
      this.player.y,
      PLAYER_RADIUS,
      this.player.z,
      STEP_UP,
    );
    if (separated.x !== this.player.x || separated.y !== this.player.y) {
      this.player.x = separated.x;
      this.player.y = separated.y;
      const settled = supportHeight(this.world, separated.x, separated.y);
      if (
        this.player.onGround &&
        settled > this.player.z &&
        settled - this.player.z <= STEP_UP + 0.001
      ) {
        this.player.z = settled;
        this.player.vz = 0;
      }
    }

    const moving = length > 0;
    this.player.moving = moving;
    const bobTarget =
      moving && this.player.onGround ? Math.sin(this.player.bobPhase) * 0.015 : 0;
    if (moving && this.player.onGround) {
      this.player.bobPhase += dt * (sprint ? 13 : 9.5);
    }
    this.player.eyeBob = lerp(this.player.eyeBob, bobTarget, Math.min(1, dt * 12));

    this.collectPickups();
    this.checkExits();
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

  private faceTowards(actor: Actor, x: number, y: number, rate: number): void {
    const target = Math.atan2(y - actor.y, x - actor.x);
    actor.facing = wrapAngle(
      actor.facing + shortestAngleDelta(actor.facing, target) * Math.min(1, rate),
    );
  }

  private updateActors(dt: number): void {
    for (const actor of this.actors) {
      if (!actor.alive) continue;
      actor.animTime += dt;
      actor.attackCooldown = Math.max(0, actor.attackCooldown - dt);

      if (actor.state === "death") {
        actor.stateT += dt;
        if (actor.stateT >= DEATH_STATE_TIME) actor.alive = false;
        continue;
      }

      if (actor.state === "hurt") {
        actor.stateT += dt;
        if (actor.stateT >= HURT_STATE_TIME) {
          actor.state = "idle";
          actor.stateT = 0;
        }
        continue;
      }

      if (actor.state === "talk") {
        this.faceTowards(actor, this.player.x, this.player.y, dt * 5);
        actor.stateT += dt;
        const distance = Math.hypot(
          this.player.x - actor.x,
          this.player.y - actor.y,
        );
        if (distance > TALK_RANGE + 0.6) {
          actor.state = "idle";
          actor.stateT = 0;
        }
        continue;
      }

      if (actor.state === "attack") {
        actor.stateT += dt;
        this.faceTowards(actor, this.player.x, this.player.y, dt * 5);
        const attack = actor.spec.attack;
        const gun = actor.spec.gun;
        if (!actor.hitLanded && actor.stateT >= ATTACK_IMPACT) {
          actor.hitLanded = true;
          if (gun) {
            this.fireActorBolt(actor);
          } else if (attack) {
            const distance = Math.hypot(
              this.player.x - actor.x,
              this.player.y - actor.y,
            );
            if (distance <= attack.range + 0.25) {
              this.damagePlayer(attack.damage);
            }
          }
        }
        if (actor.stateT >= ATTACK_STATE_TIME) {
          actor.state = "idle";
          actor.stateT = 0;
        }
        continue;
      }

      if (actor.spec.behavior === "watcher") {
        this.faceTowards(actor, this.player.x, this.player.y, dt * 2.4);
      }

      if (actor.spec.behavior === "hover" && actor.spec.hover) {
        const { height, bob, speed } = actor.spec.hover;
        actor.z = height + Math.sin(actor.animTime * speed) * bob;
        actor.facing = wrapAngle(actor.facing + dt * 0.7);
        actor.state = "idle";
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

      if (actor.spec.behavior === "chase" && actor.spec.chase) {
        const dx = this.player.x - actor.x;
        const dy = this.player.y - actor.y;
        const distance = Math.hypot(dx, dy);
        const target = Math.atan2(dy, dx);
        actor.facing = wrapAngle(
          actor.facing +
            shortestAngleDelta(actor.facing, target) * Math.min(1, dt * 4),
        );
        const { speed, range } = actor.spec.chase;
        const attack = actor.spec.attack;
        const gun = actor.spec.gun;
        const gunReady = Boolean(
          gun &&
            !this.player.dead &&
            distance <= gun.range &&
            actor.attackCooldown <= 0 &&
            hasLineOfSight(
              this.world,
              actor.x,
              actor.y,
              actor.z + 0.9,
              this.player.x,
              this.player.y,
              this.player.z + 0.5,
              gun.range,
            ),
        );

        if (gunReady && gun) {
          actor.state = "attack";
          actor.stateT = 0;
          actor.hitLanded = false;
          actor.attackCooldown = gun.cooldown;
        } else if (
          attack &&
          !this.player.dead &&
          distance <= attack.range &&
          actor.attackCooldown <= 0
        ) {
          actor.state = "attack";
          actor.stateT = 0;
          actor.hitLanded = false;
          actor.attackCooldown = attack.cooldown;
        } else if (distance > 1.5 && distance < range) {
          const step = Math.min(speed * dt, distance - 1.4);
          const nextX = actor.x + Math.cos(target) * step;
          if (canOccupy(this.world, nextX, actor.y, 0.16, actor.z)) {
            actor.x = nextX;
          }
          const nextY = actor.y + Math.sin(target) * step;
          if (canOccupy(this.world, actor.x, nextY, 0.16, actor.z)) {
            actor.y = nextY;
          }
          actor.state = "walk";
        } else {
          actor.state = "idle";
        }
      }

      if (actor.spec.behavior === "idle" && actor.state === "walk") {
        actor.state = "idle";
      }
    }
  }

  private damagePlayer(amount: number): void {
    if (this.player.dead) return;
    this.player.health = Math.max(0, this.player.health - amount);
    this.player.hitFlash = DAMAGE_FLASH_TIME;
    this.emit("hurt");
    if (this.player.health <= 0) {
      this.player.dead = true;
      this.player.deathT = 0;
      this.player.thrusting = false;
      this.setToast("SYSTEMS OFFLINE · redeploying", 3);
      this.emit("death");
    }
  }

  private redeploy(): void {
    this.placeAtSpawn();
    this.setToast(`REDEPLOYED · ${this.level.title}`, 2.4);
    this.emit("redeploy");
  }

  private placeAtSpawn(): void {
    const { spawn } = this.level;
    this.player.x = spawn.x;
    this.player.y = spawn.y;
    this.player.z = 0;
    this.player.vz = 0;
    this.player.yaw = wrapAngle(spawn.yaw);
    this.player.pitch = 0;
    this.player.fuel = 1;
    this.player.thrusting = false;
    this.player.onGround = true;
    this.player.health = PLAYER_MAX_HEALTH;
    this.player.dead = false;
    this.player.deathT = 0;
    this.player.hitFlash = 0;
    this.player.attackCooldown = 0;
    this.flying = false;
  }

  attack(): boolean {
    if (this.player.dead || this.player.attackCooldown > 0) return false;
    this.player.attackCooldown = PLAYER_ATTACK_COOLDOWN;
    const camera = this.cameraState();
    const horizontal = Math.cos(camera.pitch);
    this.bolts.push(
      spawnProjectile(
        camera.x,
        camera.y,
        camera.eyeZ,
        camera.dirX * horizontal,
        camera.dirY * horizontal,
        Math.sin(camera.pitch),
        PLAYER_BOLT_SPEED,
        PLAYER_ATTACK_DAMAGE,
        PLAYER_BOLT_LIFE,
        true,
      ),
    );
    this.emit("shot");
    return true;
  }

  private fireActorBolt(actor: Actor): void {
    const gun = actor.spec.gun;
    if (!gun) return;
    const muzzleZ = actor.z + 0.9;
    const targetZ = this.player.z + 0.5;
    this.bolts.push(
      spawnProjectile(
        actor.x,
        actor.y,
        muzzleZ,
        this.player.x - actor.x,
        this.player.y - actor.y,
        targetZ - muzzleZ,
        gun.speed,
        gun.damage,
        gun.range / gun.speed + 0.25,
        false,
      ),
    );
    this.emit("enemy-shot");
  }

  private updateProjectiles(dt: number): void {
    for (const impact of this.impacts) impact.age += dt;
    this.impacts = this.impacts.filter((impact) => impact.age < BOLT_IMPACT_LIFE);
    if (this.bolts.length === 0) return;

    const survivors: Projectile[] = [];
    for (const bolt of this.bolts) {
      const outcome = stepProjectile(bolt, this.world, dt);
      if (outcome !== "fly") {
        // Back the flash out of the cell the substep entered so the wall face
        // does not depth-cull it.
        const speed = Math.hypot(bolt.vx, bolt.vy, bolt.vz) || 1;
        const back = Math.min(0.06, speed * dt);
        this.addImpact(
          bolt.x - (bolt.vx / speed) * back,
          bolt.y - (bolt.vy / speed) * back,
          Math.max(0.03, bolt.z - (bolt.vz / speed) * back),
          bolt.fromPlayer,
        );
        continue;
      }

      if (bolt.fromPlayer) {
        const target = this.actorHitBy(bolt);
        if (target) {
          this.damageActor(target, bolt.damage);
          this.addImpact(bolt.x, bolt.y, bolt.z, true);
          continue;
        }
      } else if (
        !this.player.dead &&
        projectileHitsPlayer(bolt, this.player)
      ) {
        this.damagePlayer(bolt.damage);
        this.addImpact(bolt.x, bolt.y, bolt.z, false);
        continue;
      }
      survivors.push(bolt);
    }
    this.bolts = survivors;
  }

  private actorHitBy(bolt: Projectile): Actor | null {
    for (const actor of this.actors) {
      if (!actor.alive || !actor.spec.hostile) continue;
      if (projectileHitsActor(bolt, actor, actor.spec.scale ?? 1)) {
        return actor;
      }
    }
    return null;
  }

  private damageActor(actor: Actor, amount: number): void {
    actor.hp = Math.max(0, actor.hp - amount);
    actor.stateT = 0;
    this.emit("hit");
    if (actor.hp <= 0) {
      actor.state = "death";
      this.setToast(`${actor.spec.name.toUpperCase()} DOWN`, 1.6);
      this.emit("kill");
      return;
    }
    actor.state = "hurt";
    const dx = actor.x - this.player.x;
    const dy = actor.y - this.player.y;
    const length = Math.hypot(dx, dy) || 1;
    const nextX = actor.x + (dx / length) * 0.18;
    const nextY = actor.y + (dy / length) * 0.18;
    if (canOccupy(this.world, nextX, nextY, 0.16, actor.z)) {
      actor.x = nextX;
      actor.y = nextY;
    }
  }

  private addImpact(x: number, y: number, z: number, fromPlayer: boolean): void {
    if (this.impacts.length >= 24) this.impacts.shift();
    this.impacts.push({ x, y, z, age: 0, fromPlayer });
  }

  interact(): "none" | "talk" | "door" | "locked" | "pickup" {
    if (this.player.dead) return "none";

    const npc = this.nearestTalkable();
    if (npc) {
      npc.state = "talk";
      npc.stateT = 0;
      this.faceTowards(npc, this.player.x, this.player.y, 1);
      const lines = npc.spec.talk ?? [];
      const line = lines[npc.talkIndex % Math.max(1, lines.length)] ?? "";
      npc.talkIndex += 1;
      this.setToast(`${npc.spec.name.toUpperCase()} · ${line}`, 4);
      this.emit("talk");
      return "talk";
    }

    const door = this.nearestDoor();
    if (door) {
      if (door.requires === "keycard" && !this.keycard) {
        this.setToast("SEALED · keycard required", 2);
        this.emit("locked");
        return "locked";
      }
      this.openDoor(door);
      return "door";
    }

    const pickup = this.nearestPickup(1.4);
    if (pickup) {
      this.collectPickup(pickup);
      return "pickup";
    }

    this.setToast("NOTHING IN REACH", 1.2);
    return "none";
  }

  private nearestTalkable(): Actor | null {
    let best = Infinity;
    let found: Actor | null = null;
    for (const actor of this.actors) {
      if (!actor.alive || !actor.spec.talk) continue;
      const distance = Math.hypot(
        this.player.x - actor.x,
        this.player.y - actor.y,
      );
      if (distance <= INTERACT_RANGE && distance < best) {
        best = distance;
        found = actor;
      }
    }
    return found;
  }

  private nearestDoor(): WorldDoor | null {
    let best = Infinity;
    let found: WorldDoor | null = null;
    for (const door of this.doors) {
      if (door.open) continue;
      const distance = Math.hypot(
        this.player.x - (door.x + 0.5),
        this.player.y - (door.y + 0.5),
      );
      if (distance <= INTERACT_RANGE && distance < best) {
        best = distance;
        found = door;
      }
    }
    return found;
  }

  private nearestPickup(radius: number): WorldPickup | null {
    let best = Infinity;
    let found: WorldPickup | null = null;
    for (const pickup of this.pickups) {
      if (pickup.taken) continue;
      const distance = Math.hypot(
        this.player.x - pickup.x,
        this.player.y - pickup.y,
      );
      if (distance <= radius && distance < best) {
        best = distance;
        found = pickup;
      }
    }
    return found;
  }

  private openDoor(door: WorldDoor): void {
    door.open = true;
    const cell = door.y * this.world.width + door.x;
    this.world.tiles[cell] = 0;
    this.world.heights[cell] = 0;
    this.setToast("DOOR UNLOCKED", 1.8);
    this.emit("door");
  }

  private collectPickups(): void {
    if (this.player.z > 0.8) return;
    const pickup = this.nearestPickup(PICKUP_RADIUS);
    if (pickup) this.collectPickup(pickup);
  }

  private collectPickup(pickup: WorldPickup): void {
    if (pickup.taken) return;
    pickup.taken = true;
    this.emit("pickup");
    if (pickup.kind === "keycard") {
      this.keycard = true;
      this.setToast("KEYCARD ACQUIRED · lift chamber unlocked", 3);
    } else if (pickup.kind === "medkit") {
      this.player.health = Math.min(PLAYER_MAX_HEALTH, this.player.health + 40);
      this.setToast("MEDKIT · +40 HP", 2);
    } else {
      this.player.fuel = 1;
      this.setToast("JET FUEL REPLENISHED", 2);
    }
  }

  private checkExits(): void {
    for (const exit of this.exits) {
      if (
        Math.hypot(this.player.x - exit.x, this.player.y - exit.y) <=
        EXIT_RADIUS
      ) {
        const index = levelIndexById(exit.target);
        this.emit("level");
        this.loadLevel(index, `ENTERING ${LEVELS[index].title}`);
        return;
      }
    }
  }

  private setToast(text: string, seconds = 2.5): void {
    this.toastText = text;
    this.toastT = seconds;
  }

  loadLevel(index: number, message?: string): void {
    const level = LEVELS[index];
    if (!level) throw new Error(`Unknown level index: ${index}`);
    this.level = level;
    this.levelIndex = index;
    this.time = 0;
    this.world = createWorld(level.rows, {
      x: level.spawn.x,
      y: level.spawn.y,
    });
    this.actors = level.actors.map((spec, i) => this.createActor(spec, i));
    this.pickups = level.pickups.map((pickup, i) => ({
      ...pickup,
      taken: false,
      seed: i * 1.7,
    }));
    this.doors = level.doors.map((door) => ({ ...door, open: false }));
    this.exits = level.exits;
    this.bolts = [];
    this.impacts = [];
    this.keycard = false;
    this.placeAtSpawn();
    this.toastText = "";
    this.toastT = 0;
    if (message) this.setToast(message, 3);
  }

  private createActor(spec: ActorSpec, index: number): Actor {
    const maxHp = spec.hp ?? 80;
    const animTime = index * 0.37;
    return {
      spec,
      x: spec.x,
      y: spec.y,
      z: (spec.hover?.height ?? 0) + Math.sin(animTime * (spec.hover?.speed ?? 1)) * (spec.hover?.bob ?? 0),
      facing: spec.facing,
      state:
        spec.behavior === "patrol" || spec.behavior === "chase"
          ? "walk"
          : "idle",
      animTime,
      stateT: 0,
      patrolT: 0,
      hp: maxHp,
      maxHp,
      alive: true,
      attackCooldown: 0,
      hitLanded: false,
      talkIndex: 0,
    };
  }

  render(): void {
    const camera = this.cameraState();
    this.renderer.render(
      camera,
      this.world,
      this.assets.textures,
      this.assets.floor,
      this.assets.wallTop,
      [...this.buildSprites(camera), ...this.buildPropSprites(), ...this.buildBoltSprites()],
      this.viewmodelVisible ? this.buildViewmodel() : undefined,
    );
  }

  /**
   * Attack poses advance on the cooldown clock, so a swing is visible even when
   * no enemy is in range. Walking sway and idle breathing use the camera bob
   * phase to keep the hands anchored to the player's motion.
   */
  private viewmodelState(): {
    pose: ViewmodelPose;
    dx: number;
    dy: number;
  } {
    const cooldown = this.player.attackCooldown;
    const elapsed = PLAYER_ATTACK_COOLDOWN - cooldown;
    let pose: ViewmodelPose;
    if (cooldown > 0 && elapsed < 0.09) pose = "windup";
    else if (cooldown > 0 && elapsed < 0.22) pose = "strike";
    else if (cooldown > 0 && elapsed < 0.36) pose = "recover";
    else pose = Math.floor(this.time / 0.9) % 2 === 0 ? "idle0" : "idle1";

    const walking = this.player.moving && this.player.onGround;
    const swing = Math.sin(this.player.bobPhase);
    let dx = walking ? swing * 5 : Math.sin(this.time * 1.6) * 1.5;
    let dy = walking
      ? Math.abs(swing) * 4
      : Math.sin(this.time * 1.6) * 1.2;
    if (pose === "windup") {
      dx += 7;
      dy += 12;
    } else if (pose === "strike") {
      dx -= 9;
      dy -= 14;
    } else if (pose === "recover") {
      dx -= 2;
      dy -= 3;
    }
    if (this.player.dead) dy += 26;
    return { pose, dx, dy };
  }

  private buildViewmodel(): ViewmodelDraw {
    const state = this.viewmodelState();
    const texture = this.assets.viewmodel[state.pose];
    return {
      texture,
      x: this.renderer.width - texture.width + 10 + state.dx,
      y: this.renderer.height - texture.height + 22 + state.dy,
    };
  }

  setSensitivity(value: number): void {
    this.sensitivity = clamp(value, 0.4, 2);
  }

  setFovDegrees(value: number): void {
    this.fovDegrees = clamp(value, MIN_FOV_DEGREES, MAX_FOV_DEGREES);
  }

  private baseFov(): number {
    return (this.fovDegrees * Math.PI) / 180;
  }

  private cameraState(): CameraState {
    // A fixed FOV keeps scale and straight lines stable at every altitude. The
    // old altitude boost stacked up to +30 degrees on a 100 degree base and made
    // everything near the screen edges stretch while rising.
    const tanHalf = Math.tan(this.baseFov() / 2);
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

  private spriteSelection(actor: Actor, camera: CameraState): {
    yawIndex: number;
    pitchIndex: PitchIndex;
    pitchNext: PitchIndex;
    pitchMix: number;
    frameIndex: number;
    worldSize: number;
  } {
    const manifest = this.atlasFor(actor.spec).manifest;
    const dx = camera.x - actor.x;
    const dy = camera.y - actor.y;
    const distance = Math.hypot(dx, dy);
    const yawIndex = spriteYawIndex(
      Math.atan2(dy, dx),
      actor.facing,
      manifest.directions,
    );
    const stateDef = manifest.states[actor.state] ?? manifest.states.idle;
    const frameWorldSize =
      (stateDef?.frameWorldSize ?? manifest.frameWorldSize) *
      (actor.spec.scale ?? 1);
    const frameAnchorZ = stateDef?.frameAnchorZ ?? manifest.frameAnchorZ ?? 0;
    const centerZ = actor.z + frameAnchorZ + frameWorldSize / 2;
    const elevation = elevationAngle(camera.eyeZ, centerZ, distance);
    const pitch =
      actor.state === "death"
        ? sampleStaticPitch(elevation, manifest.pitches)
        : samplePitch(elevation, manifest.pitches);
    const pitchIndex = pitch.index;
    const pitchNext = pitch.next;
    const pitchMix = pitch.mix;
    // Death frames are rendered with one ortho frame for every pitch, so their
    // world size is already uniform and must not shrink with the living atlas
    // compensation.
    const pitchScaleA =
      actor.state === "death" ? 1 : manifest.pitchWorldScale?.[pitchIndex] ?? 1;
    const pitchScaleB =
      actor.state === "death" ? 1 : manifest.pitchWorldScale?.[pitchNext] ?? pitchScaleA;
    const billboardSize = frameWorldSize * lerp(pitchScaleA, pitchScaleB, pitchMix);
    const clock =
      actor.state === "idle" || actor.state === "walk"
        ? actor.animTime
        : actor.stateT;
    let frameIndex = stateDef
      ? Math.floor(clock * stateDef.fps) % stateDef.frames
      : 0;
    if (actor.state === "death" && stateDef) {
      frameIndex = Math.min(
        stateDef.frames - 1,
        Math.floor(clock * stateDef.fps),
      );
    }
    return {
      yawIndex,
      pitchIndex,
      pitchNext,
      pitchMix,
      frameIndex,
      worldSize: billboardSize,
    };
  }

  private buildSprites(camera: CameraState): SpriteDraw[] {
    const draws: SpriteDraw[] = [];

    for (const actor of this.actors) {
      // Corpses keep the final death frame until the level reloads.
      if (!actor.alive && actor.state !== "death") continue;
      const atlas = this.atlasFor(actor.spec);
      const manifest = atlas.manifest;
      const dx = camera.x - actor.x;
      const dy = camera.y - actor.y;
      const distance = Math.hypot(dx, dy);
      if (distance < 0.001) continue;

      const {
        yawIndex,
        pitchIndex,
        pitchNext,
        pitchMix,
        frameIndex,
        worldSize,
      } = this.spriteSelection(actor, camera);
      const frame = atlas.getFrame(actor.state, pitchIndex, yawIndex, frameIndex);
      if (!frame) continue;
      const frameB =
        pitchNext !== pitchIndex
          ? atlas.getFrame(actor.state, pitchNext, yawIndex, frameIndex)
          : undefined;

      const stateDef = manifest.states[actor.state] ?? manifest.states.idle;
      draws.push({
        x: actor.x,
        y: actor.y,
        z: actor.z,
        facing: actor.facing,
        frame,
        frameB: frameB ?? undefined,
        blend: pitchMix,
        worldSize,
        anchorZ: stateDef?.frameAnchorZ ?? manifest.frameAnchorZ ?? 0,
        shadowScale: actor.state === "death" ? 1.25 : undefined,
        tint: actor.spec.tint,
        id: actor.spec.name,
      });
    }

    return draws;
  }

  private buildPropSprites(): SpriteDraw[] {
    const draws: SpriteDraw[] = [];

    for (const pickup of this.pickups) {
      if (pickup.taken) continue;
      const texture = this.assets.props[pickup.kind];
      const bob = Math.sin(this.time * 2.2 + pickup.seed) * 0.05;
      draws.push({
        x: pickup.x,
        y: pickup.y,
        z: 0.3 + bob,
        facing: 0,
        frame: { texture, sx: 0, sy: 0, sw: texture.width, sh: texture.height },
        worldSize: 0.42,
        id: `pickup:${pickup.kind}`,
      });
    }

    for (const exit of this.exits) {
      const texture = this.assets.props.beacon;
      draws.push({
        x: exit.x,
        y: exit.y,
        z: 0,
        facing: 0,
        frame: { texture, sx: 0, sy: 0, sw: texture.width, sh: texture.height },
        worldSize: 1.1,
        id: `exit:${exit.id}`,
      });
    }

    return draws;
  }

  private buildBoltSprites(): SpriteDraw[] {
    const draws: SpriteDraw[] = [];
    const playerTint: [number, number, number] = [0.55, 1.15, 1.35];
    const enemyTint: [number, number, number] = [1.35, 0.72, 0.42];

    for (const bolt of this.bolts) {
      draws.push(
        this.glowSprite(
          bolt.x,
          bolt.y,
          bolt.z,
          0.24,
          bolt.fromPlayer ? playerTint : enemyTint,
          1,
          bolt.fromPlayer ? "bolt:player" : "bolt:enemy",
        ),
      );
    }

    for (const impact of this.impacts) {
      const t = clamp(impact.age / BOLT_IMPACT_LIFE, 0, 1);
      draws.push(
        this.glowSprite(
          impact.x,
          impact.y,
          impact.z,
          0.3 + t * 0.55,
          impact.fromPlayer ? playerTint : enemyTint,
          (1 - t) * (1 - t),
          "impact",
        ),
      );
    }

    return draws;
  }

  private glowSprite(
    x: number,
    y: number,
    z: number,
    worldSize: number,
    tint: [number, number, number],
    alpha: number,
    id: string,
  ): SpriteDraw {
    const texture = this.glowTexture;
    return {
      x,
      y,
      z: z - worldSize / 2,
      facing: 0,
      frame: {
        texture,
        sx: 0,
        sy: 0,
        sw: texture.width,
        sh: texture.height,
      },
      worldSize,
      tint,
      alpha,
      noShadow: true,
      id,
    };
  }

  getHudState(): HudState {
    const camera = this.cameraState();
    let nearest: Actor | null = null;
    let best = Infinity;
    for (const actor of this.actors) {
      if (!actor.alive) continue;
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
        manifest.pitches,
      );
    }

    const support = supportHeight(
      this.world,
      this.player.x,
      this.player.y,
    );

    return {
      x: this.player.x,
      y: this.player.y,
      z: this.player.z,
      vz: this.player.vz,
      support,
      onGround: this.player.onGround,
      yawDeg: Math.round((wrapAngle(this.player.yaw) * 180) / Math.PI),
      pitchDeg: Math.round((this.player.pitch * 180) / Math.PI),
      flying: this.flying,
      airborne: !this.player.onGround,
      thrusting: this.player.thrusting,
      fuel: this.player.fuel,
      nearestName: nearest?.spec.name ?? "none",
      nearestSprite: nearest?.spec.sprite ?? "none",
      nearestDistance: best,
      nearestYaw,
      nearestPitch,
      health: this.player.health,
      maxHealth: PLAYER_MAX_HEALTH,
      dead: this.player.dead,
      damageFlash: this.player.hitFlash / DAMAGE_FLASH_TIME,
      levelTitle: this.level.title,
      objective: this.level.objective,
      prompt: this.interactionPrompt(),
      toast: this.toastT > 0 ? this.toastText : "",
      keycard: this.keycard,
    };
  }

  private interactionPrompt(): string {
    if (this.player.dead) return "";
    const npc = this.nearestTalkable();
    if (npc) return `E · talk to ${npc.spec.name}`;
    const door = this.nearestDoor();
    if (door) {
      if (door.requires === "keycard" && !this.keycard) {
        return "E · sealed — keycard required";
      }
      return "E · unlock door";
    }
    const pickup = this.nearestPickup(1.4);
    if (pickup) return `E · collect ${pickup.kind}`;
    return "";
  }

  getRenderDebug(): RenderDebug {
    const camera = this.cameraState();
    const support = supportHeight(
      this.world,
      this.player.x,
      this.player.y,
    );
    return {
      camera: {
        x: camera.x,
        y: camera.y,
        eyeZ: camera.eyeZ,
        yaw: camera.yaw,
        pitch: camera.pitch,
        forwardX: camera.dirX,
        forwardY: camera.dirY,
        fovDegrees: this.fovDegrees,
        tanHalf: camera.tanHalf,
      },
      player: {
        x: this.player.x,
        y: this.player.y,
        z: this.player.z,
        support,
        onGround: this.player.onGround,
      },
      level: this.level.id,
      viewmodel: this.viewmodelState(),
      actors: this.actors.map((actor) => {
        const selection = this.spriteSelection(actor, camera);
        return {
          name: actor.spec.name,
          x: actor.x,
          y: actor.y,
          z: actor.z,
          facing: actor.facing,
          state: actor.state,
          sprite: actor.spec.sprite,
          yawIndex: selection.yawIndex,
          pitchIndex: selection.pitchIndex,
          frameIndex: selection.frameIndex,
          worldSize: selection.worldSize,
          hp: actor.hp,
          maxHp: actor.maxHp,
          alive: actor.alive,
          hostile: actor.spec.hostile ?? false,
        };
      }),
      pickups: this.pickups.map((pickup) => ({
        kind: pickup.kind,
        x: pickup.x,
        y: pickup.y,
        taken: pickup.taken,
      })),
      doors: this.doors.map((door) => ({
        id: door.id,
        x: door.x,
        y: door.y,
        open: door.open,
      })),
      bolts: this.bolts.map((bolt) => ({
        x: bolt.x,
        y: bolt.y,
        z: bolt.z,
        fromPlayer: bolt.fromPlayer,
      })),
      health: this.player.health,
      keycard: this.keycard,
      stats: this.renderer.stats,
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
        ctx.fillStyle = tile === 2 ? "#39434f" : tile === 3 ? "#8a6b3a" : "#2a2f3c";
        ctx.fillRect(x * scale, (world.height - 1 - y) * scale, scale - 0.5, scale - 0.5);
      }
    }

    for (const pickup of this.pickups) {
      if (pickup.taken) continue;
      const px = pickup.x * scale;
      const py = (world.height - pickup.y) * scale;
      ctx.fillStyle =
        pickup.kind === "keycard"
          ? "#6ce0ef"
          : pickup.kind === "medkit"
            ? "#f0e4c8"
            : "#8fb7d0";
      ctx.fillRect(px - 1.2, py - 1.2, 2.4, 2.4);
    }

    for (const exit of this.exits) {
      const ex = exit.x * scale;
      const ey = (world.height - exit.y) * scale;
      ctx.strokeStyle = "#6ce0ef";
      ctx.beginPath();
      ctx.arc(ex, ey, 2.6, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (const actor of this.actors) {
      if (!actor.alive) continue;
      const ax = actor.x * scale;
      const ay = (world.height - actor.y) * scale;
      ctx.fillStyle = actor.spec.hostile ? "#e08a7a" : "#66c7cd";
      ctx.fillRect(ax - 1.5, ay - 1.5, 3, 3);
      ctx.strokeStyle = ctx.fillStyle;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax + Math.cos(actor.facing) * 5, ay + Math.sin(actor.facing) * 5);
      ctx.stroke();
    }

    const px = this.player.x * scale;
    const py = (world.height - this.player.y) * scale;

    const halfFov = this.baseFov() / 2;
    ctx.strokeStyle = "rgba(255, 210, 138, 0.24)";
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(
      px + Math.cos(this.player.yaw - halfFov) * 26,
      py + Math.sin(this.player.yaw - halfFov) * 26,
    );
    ctx.moveTo(px, py);
    ctx.lineTo(
      px + Math.cos(this.player.yaw + halfFov) * 26,
      py + Math.sin(this.player.yaw + halfFov) * 26,
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
    this.placeAtSpawn();
  }

  resetLevel(): void {
    this.loadLevel(this.levelIndex);
  }

  setPose(x: number, y: number, z: number, yaw: number, pitch: number): void {
    this.player.x = x;
    this.player.y = y;
    this.player.z = z;
    this.player.vz = 0;
    const support = supportHeight(this.world, x, y);
    this.player.onGround = z <= support + 0.001;
    this.player.yaw = wrapAngle(yaw);
    const limit = this.pitchLimit();
    this.player.pitch = clamp(pitch, -limit, limit);
  }

  setFlying(value: boolean): void {
    this.flying = value;
  }

  setFuel(value: number): void {
    this.player.fuel = clamp(value, 0, 1);
  }

  setHealth(value: number): void {
    this.player.health = clamp(value, 0, PLAYER_MAX_HEALTH);
    if (this.player.health > 0) this.player.dead = false;
  }

  isThrusting(): boolean {
    return this.player.thrusting;
  }

  consumeEvents(): GameEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }

  private emit(event: GameEvent): void {
    if (this.events.length < 32) this.events.push(event);
  }

  get damageFlash(): number {
    return this.player.hitFlash / DAMAGE_FLASH_TIME;
  }

  get isDead(): boolean {
    return this.player.dead;
  }

  loadLevelById(id: string): void {
    this.loadLevel(levelIndexById(id));
  }
}
