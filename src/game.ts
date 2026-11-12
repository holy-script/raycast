import type { SpriteAtlas } from "./engine/atlas";
import { createGlowTexture } from "./engine/glow";
import { InputController } from "./engine/input";
import {
  clamp,
  elevationAngle,
  lerp,
  minimapHeading,
  minimapPoint,
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
  ceilingAt,
  createWorld,
  resolveFootprint,
  roofAt,
  STEP_UP,
  supportHeight,
  type World,
} from "./engine/world";
import type { ActorSpec } from "./content/actors";
import {
  applyCrateDamage,
  clearCrate,
  crateCells as findCrateCells,
} from "./engine/crates";
import {
  hasLineOfSight,
  projectileHitsActor,
  projectileHitsPlayer,
  spawnProjectile,
  stepProjectile,
  volleyAngles,
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
/** Body height used to keep the head under an interior ceiling. */
const PLAYER_HEIGHT = 1.4;

const PLAYER_MAX_HEALTH = 100;
const PLAYER_ATTACK_DAMAGE = 45;
const PLAYER_ATTACK_COOLDOWN = 0.45;
const PLAYER_BOLT_SPEED = 22;
const PLAYER_BOLT_LIFE = 0.9;
// Camera-space muzzle offset so bolts leave the plasma projector instead of
// the eye. The spawn falls back to the eye when this point is inside geometry.
const MUZZLE_RIGHT = 0.18;
const MUZZLE_UP = -0.08;
const MUZZLE_FORWARD = 0.35;
const BOLT_IMPACT_LIFE = 0.14;
const RESPAWN_DELAY = 1.4;
const DAMAGE_FLASH_TIME = 0.45;
const INTERACT_RANGE = 2.4;
const TALK_RANGE = 2.4;
const PICKUP_RADIUS = 0.5;
const EXIT_RADIUS = 0.6;
/** Distance at which the overseer's health bar stays on screen. */
const BOSS_HUD_RANGE = 24;

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
  floors: Record<string, Texture>;
  tops: Record<string, Texture>;
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

export type MissionStage = "hunt" | "boss" | "extract" | "clear";

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
  /** Live boss encounter data; null when no boss is in range. */
  boss: { name: string; hp: number; maxHp: number; distance: number } | null;
  /** Gated missions expose their stage and clock; other levels report null. */
  mission: {
    stage: MissionStage;
    time: number;
    kills: number;
    targets: number;
  } | null;
  victory: boolean;
  huntKills: number;
  huntTargets: number;
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
    /** Interior slab underside over the player; 0 when under open sky. */
    ceiling: number;
    /** Roof surface over the player's cell; 0 outside a sector. */
    roof: number;
    onGround: boolean;
  };
  level: string;
  hunt: { kills: number; targets: number };
  mission: { stage: MissionStage; time: number; victory: boolean };
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
  private crates = new Set<number>();
  private crateHits = new Map<number, number>();
  private keycard = false;
  private huntKills = 0;
  private time = 0;
  private victory = false;
  private victoryTime = 0;
  private toastText = "";
  private toastT = 0;
  private events: GameEvent[] = [];
  private bolts: Projectile[] = [];
  private impacts: Impact[] = [];
  private readonly glowTexture = createGlowTexture(32);

  constructor(renderer: Renderer, assets: GameAssets, canvas: HTMLCanvasElement) {
    this.renderer = renderer;
    this.assets = assets;
    this.world = createWorld(LEVELS[0].rows, undefined, {
      heights: LEVELS[0].heights,
      rooms: LEVELS[0].rooms,
    });
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

  get victoryShown(): boolean {
    return this.victory;
  }

  update(dt: number): void {
    // The victory overlay freezes the mission clock and all simulation.
    if (this.victory) return;
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
      this.player.z,
    );
    // Feet altitude limit. Indoors this is the slab, so the jetpack cannot push
    // the head through the ceiling; standing on the roof disables the clamp.
    const maxAltitude = this.maxAltitude(support);
    // Walking into a room while flying can put the head inside the slab; push
    // the feet back down instead of letting the next frame tunnel upward.
    if (this.player.z > maxAltitude) {
      this.player.z = maxAltitude;
      this.player.vz = Math.min(this.player.vz, 0);
      this.player.onGround = false;
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
        support,
        maxAltitude,
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

      if (this.player.z >= maxAltitude) {
        this.player.z = maxAltitude;
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
      const settled = supportHeight(
        this.world,
        separated.x,
        separated.y,
        this.player.z,
      );
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

  /**
   * Highest foot altitude the player may reach. Indoors the slab caps it one
   * body height below the ceiling, which also stops landing/hover from passing
   * through the slab. A player standing on the roof is above the sector, so the
   * global ceiling applies there.
   */
  private maxAltitude(support: number): number {
    const ceiling = ceilingAt(this.world, this.player.x, this.player.y);
    if (ceiling <= 0) return MAX_ALTITUDE;
    const roof = roofAt(this.world, this.player.x, this.player.y);
    if (this.player.z >= roof - 1e-3) return MAX_ALTITUDE;
    return Math.min(MAX_ALTITUDE, Math.max(support, ceiling - PLAYER_HEIGHT));
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
        this.faceTowards(
          actor,
          this.player.x,
          this.player.y,
          dt * (actor.spec.turnRate ?? 5),
        );
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

      if (actor.spec.behavior === "sentry" && actor.spec.gun) {
        const gun = actor.spec.gun;
        this.faceTowards(
          actor,
          this.player.x,
          this.player.y,
          dt * (actor.spec.turnRate ?? 3),
        );
        const distance = Math.hypot(
          this.player.x - actor.x,
          this.player.y - actor.y,
        );
        const ready = Boolean(
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
        if (ready) {
          actor.state = "attack";
          actor.stateT = 0;
          actor.hitLanded = false;
          actor.attackCooldown = gun.cooldown;
        } else {
          actor.state = "idle";
        }
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
    const origin = this.muzzleOrigin(camera);
    const horizontal = Math.cos(camera.pitch);
    this.bolts.push(
      spawnProjectile(
        origin.x,
        origin.y,
        origin.z,
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

  /**
   * Projects the camera-space muzzle offset (right / up / forward) into world
   * space. The camera's up vector tilts with pitch, so a raised or lowered aim
   * still leaves the barrel at the same point on screen. If the offset lands
   * inside a solid cell we fire from the eye so point-blank wall shots keep the
   * old absorbed-bolt behaviour.
   */
  private muzzleOrigin(camera: CameraState): { x: number; y: number; z: number } {
    const cosP = Math.cos(camera.pitch);
    const sinP = Math.sin(camera.pitch);
    const forwardX = camera.dirX * cosP;
    const forwardY = camera.dirY * cosP;
    const forwardZ = sinP;
    const rightX = -camera.dirY;
    const rightY = camera.dirX;
    const upX = -camera.dirX * sinP;
    const upY = -camera.dirY * sinP;
    const upZ = cosP;
    const x =
      camera.x +
      rightX * MUZZLE_RIGHT +
      upX * MUZZLE_UP +
      forwardX * MUZZLE_FORWARD;
    const y =
      camera.y +
      rightY * MUZZLE_RIGHT +
      upY * MUZZLE_UP +
      forwardY * MUZZLE_FORWARD;
    const z =
      camera.eyeZ + upZ * MUZZLE_UP + forwardZ * MUZZLE_FORWARD;
    if (this.insideSolid(x, y, z)) {
      return { x: camera.x, y: camera.y, z: camera.eyeZ };
    }
    return { x, y, z };
  }

  private insideSolid(x: number, y: number, z: number): boolean {
    if (z <= 0.02) return true;
    const cellX = Math.floor(x);
    const cellY = Math.floor(y);
    if (
      cellX < 0 ||
      cellY < 0 ||
      cellX >= this.world.width ||
      cellY >= this.world.height
    ) {
      return true;
    }
    const cell = cellY * this.world.width + cellX;
    return (
      this.world.tiles[cell] !== 0 &&
      z <= this.world.heights[cell] + 1e-4
    );
  }

  private fireActorBolt(actor: Actor): void {
    const gun = actor.spec.gun;
    if (!gun) return;
    const muzzleZ = actor.z + 0.9;
    const targetZ = this.player.z + 0.5;
    const aim = Math.atan2(this.player.y - actor.y, this.player.x - actor.x);
    // Horizontal dir components are unit length, so the vertical slope has to
    // be expressed per metre travelled to keep the bolt aimed at the player.
    const aimDistance =
      Math.hypot(this.player.x - actor.x, this.player.y - actor.y) || 1;
    const slope = (targetZ - muzzleZ) / aimDistance;
    // A volley fans horizontally so the boss covers a dodge lane, but every
    // bolt still aims at the player's height.
    for (const angle of volleyAngles(aim, gun.volley ?? 1, gun.spread ?? 0)) {
      this.bolts.push(
        spawnProjectile(
          actor.x,
          actor.y,
          muzzleZ,
          Math.cos(angle),
          Math.sin(angle),
          slope,
          gun.speed,
          gun.damage,
          gun.range / gun.speed + 0.25,
          false,
        ),
      );
    }
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
        // Only player bolts chip concrete crates; enemy fire leaves cover intact.
        if (outcome === "wall" && bolt.fromPlayer) {
          this.damageCrateAt(bolt.x, bolt.y);
        }
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
    // Bolts can still reach a body while it plays the 0.67 s death topple;
    // extra hits must not restart the animation or count another kill.
    if (actor.state === "death") return;
    actor.hp = Math.max(0, actor.hp - amount);
    actor.stateT = 0;
    this.emit("hit");
    if (actor.hp <= 0) {
      actor.state = "death";
      if (actor.spec.hostile && !actor.spec.boss) this.huntKills += 1;
      if (actor.spec.boss) {
        this.setToast("OVERSEER DOWN · EXTRACTION UNLOCKED", 3);
      } else if (
        this.level.huntTargets !== undefined &&
        this.huntKills === this.level.huntTargets &&
        this.bossActor()
      ) {
        this.setToast("HUNT COMPLETE · OVERSEER EXPOSED", 2.4);
      } else {
        this.setToast(`${actor.spec.name.toUpperCase()} DOWN`, 1.6);
      }
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

  private damageCrateAt(x: number, y: number): void {
    const cellX = Math.floor(x);
    const cellY = Math.floor(y);
    if (
      cellX < 0 ||
      cellY < 0 ||
      cellX >= this.world.width ||
      cellY >= this.world.height
    ) {
      return;
    }
    const cell = cellY * this.world.width + cellX;
    if (!this.crates.has(cell)) return;
    const result = applyCrateDamage(this.crateHits.get(cell) ?? 0);
    this.crateHits.set(cell, result.hits);
    if (!result.destroyed) {
      // The first chip must read as progress: a small dust burst and a toast
      // distinguish "hit but intact" from a bolt that missed entirely.
      for (const [ox, oy, oz] of [
        [-0.16, 0.1, 0.82],
        [0.13, -0.1, 0.58],
      ] as const) {
        this.addImpact(cellX + 0.5 + ox, cellY + 0.5 + oy, oz, true);
      }
      this.setToast("CRATE CRACKED", 1.1);
      this.emit("hit");
      return;
    }
    this.crates.delete(cell);
    this.crateHits.delete(cell);
    clearCrate(this.world, cell);
    // Deterministic debris burst around the block, reusing the impact glow.
    for (const [ox, oy, oz] of [
      [-0.24, -0.12, 0.75],
      [0.22, 0.16, 1.0],
      [0.06, -0.26, 0.45],
    ] as const) {
      this.addImpact(cellX + 0.5 + ox, cellY + 0.5 + oy, oz, true);
    }
    this.setToast("CRATE DESTROYED", 1.6);
    this.emit("hit");
  }

  interact(): "none" | "talk" | "door" | "locked" | "pickup" | "continue" {
    if (this.victory) {
      this.loadLevel(levelIndexById("courtyard"), "ENTERING COURTYARD");
      return "continue";
    }
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
        this.player.z - (pickup.z ?? 0),
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

  private bossActor(): Actor | null {
    return this.actors.find((actor) => actor.alive && actor.spec.boss) ?? null;
  }

  private missionStage(): MissionStage {
    if (this.victory) return "clear";
    if (this.huntKills < (this.level.huntTargets ?? 0)) return "hunt";
    return this.bossActor() ? "boss" : "extract";
  }

  private exitsUnlocked(): boolean {
    if (this.level.huntTargets === undefined) return true;
    return this.huntKills >= this.level.huntTargets && !this.bossActor();
  }

  private checkExits(): void {
    for (const exit of this.exits) {
      const horizontal = Math.hypot(
        this.player.x - exit.x,
        this.player.y - exit.y,
      );
      if (
        horizontal > EXIT_RADIUS ||
        Math.abs(this.player.z - (exit.z ?? 0)) > 1.2
      ) {
        continue;
      }
      if (!this.exitsUnlocked()) {
        if (this.toastT <= 0) {
          const left = (this.level.huntTargets ?? 0) - this.huntKills;
          this.setToast(
            left > 0
              ? `EXTRACTION LOCKED · ${left} HUNTER${left === 1 ? "" : "S"} REMAIN`
              : "EXTRACTION LOCKED · OVERSEER ACTIVE",
            2,
          );
        }
        continue;
      }
      if (this.level.huntTargets !== undefined) {
        // The mission ends on the pad: the overlay reports the clock and the
        // player leaves on E instead of being cut straight back to the city.
        this.victory = true;
        this.victoryTime = this.time;
        this.emit("level");
        return;
      }
      const index = levelIndexById(exit.target);
      this.emit("level");
      this.loadLevel(index, `ENTERING ${LEVELS[index].title}`);
      return;
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
    this.world = createWorld(
      level.rows,
      {
        x: level.spawn.x,
        y: level.spawn.y,
      },
      { heights: level.heights, rooms: level.rooms },
    );
    this.actors = level.actors.map((spec, i) => this.createActor(spec, i));
    this.pickups = level.pickups.map((pickup, i) => ({
      ...pickup,
      taken: false,
      seed: i * 1.7,
    }));
    this.doors = level.doors.map((door) => ({ ...door, open: false }));
    this.exits = level.exits;
    this.crates = findCrateCells(level.rows);
    this.crateHits.clear();
    this.bolts = [];
    this.impacts = [];
    this.keycard = false;
    this.huntKills = 0;
    this.victory = false;
    this.victoryTime = 0;
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
      z:
        (spec.z ?? 0) +
        (spec.hover?.height ?? 0) +
        Math.sin(animTime * (spec.hover?.speed ?? 1)) * (spec.hover?.bob ?? 0),
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
    const floor =
      this.assets.floors[this.level.floorTexture ?? "floor"] ??
      this.assets.floors.floor;
    const top =
      this.assets.tops[this.level.topTexture ?? "top"] ??
      this.assets.tops.top;
    this.renderer.render(
      camera,
      this.world,
      this.assets.textures,
      floor,
      top,
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
        z: (pickup.z ?? 0) + 0.3 + bob,
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
        z: exit.z ?? 0,
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
      this.player.z,
    );

    let boss: HudState["boss"] = null;
    const bossActor = this.actors.find(
      (actor) => actor.alive && actor.spec.name === "overseer",
    );
    if (bossActor) {
      const distance = Math.hypot(camera.x - bossActor.x, camera.y - bossActor.y);
      if (distance <= BOSS_HUD_RANGE) {
        boss = {
          name: bossActor.spec.name.toUpperCase(),
          hp: Math.max(0, bossActor.hp),
          maxHp: bossActor.maxHp,
          distance,
        };
      }
    }

    const stage = this.missionStage();
    const objective =
      this.level.huntTargets === undefined
        ? this.level.objective
        : stage === "hunt"
          ? `${this.level.objective} · ${this.huntKills}/${this.level.huntTargets}`
          : stage === "boss"
            ? "Defeat the overseer on the 12 m rooftop."
            : stage === "extract"
              ? "Reach the extraction beacon."
              : this.level.objective;

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
      objective,
      boss,
      mission:
        this.level.huntTargets !== undefined
          ? {
              stage,
              time: this.victory ? this.victoryTime : this.time,
              kills: this.huntKills,
              targets: this.level.huntTargets,
            }
          : null,
      victory: this.victory,
      huntKills: this.huntKills,
      huntTargets: this.level.huntTargets ?? 0,
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
      this.player.z,
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
        ceiling: ceilingAt(this.world, this.player.x, this.player.y),
        roof: roofAt(this.world, this.player.x, this.player.y),
        onGround: this.player.onGround,
      },
      level: this.level.id,
      hunt: { kills: this.huntKills, targets: this.level.huntTargets ?? 0 },
      mission: {
        stage: this.missionStage(),
        time: this.victory ? this.victoryTime : this.time,
        victory: this.victory,
      },
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
        ctx.fillRect(
          (world.width - 1 - x) * scale,
          (world.height - 1 - y) * scale,
          scale - 0.5,
          scale - 0.5,
        );
      }
    }

    for (const pickup of this.pickups) {
      if (pickup.taken) continue;
      const at = minimapPoint(
        pickup.x,
        pickup.y,
        world.width,
        world.height,
        scale,
      );
      ctx.fillStyle =
        pickup.kind === "keycard"
          ? "#6ce0ef"
          : pickup.kind === "medkit"
            ? "#f0e4c8"
            : "#8fb7d0";
      ctx.fillRect(at.x - 1.2, at.y - 1.2, 2.4, 2.4);
    }

    for (const exit of this.exits) {
      const at = minimapPoint(exit.x, exit.y, world.width, world.height, scale);
      ctx.strokeStyle = "#6ce0ef";
      ctx.beginPath();
      ctx.arc(at.x, at.y, 2.6, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (const actor of this.actors) {
      if (!actor.alive) continue;
      const at = minimapPoint(actor.x, actor.y, world.width, world.height, scale);
      const heading = minimapHeading(actor.facing);
      ctx.fillStyle = actor.spec.hostile ? "#e08a7a" : "#66c7cd";
      ctx.fillRect(at.x - 1.5, at.y - 1.5, 3, 3);
      ctx.strokeStyle = ctx.fillStyle;
      ctx.beginPath();
      ctx.moveTo(at.x, at.y);
      ctx.lineTo(at.x + heading.x * 5, at.y + heading.y * 5);
      ctx.stroke();
    }

    const at = minimapPoint(
      this.player.x,
      this.player.y,
      world.width,
      world.height,
      scale,
    );
    const px = at.x;
    const py = at.y;

    const halfFov = this.baseFov() / 2;
    const leftEdge = minimapHeading(this.player.yaw - halfFov);
    const rightEdge = minimapHeading(this.player.yaw + halfFov);
    ctx.strokeStyle = "rgba(255, 210, 138, 0.24)";
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + leftEdge.x * 26, py + leftEdge.y * 26);
    ctx.moveTo(px, py);
    ctx.lineTo(px + rightEdge.x * 26, py + rightEdge.y * 26);
    ctx.stroke();

    const facing = minimapHeading(this.player.yaw);
    ctx.fillStyle = "#ffd28a";
    ctx.beginPath();
    ctx.arc(px, py, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ffd28a";
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + facing.x * 7, py + facing.y * 7);
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
    const support = supportHeight(this.world, x, y, z);
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
