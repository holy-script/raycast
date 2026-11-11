import { tileHeightAt, type World } from "./world";

/**
 * Plasma bolts travel in straight lines through the same heightmap blocks the
 * renderer draws, so a crate or wall occludes a shot exactly where it occludes
 * geometry. They are integrated in fixed substeps because a 22 m/s bolt covers
 * 0.37 m per 60 Hz frame, which is wide enough to skip a crate edge.
 */
export interface Projectile {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Seconds of flight left; the bolt expires when it reaches zero. */
  life: number;
  damage: number;
  fromPlayer: boolean;
}

export type ProjectileOutcome = "fly" | "wall" | "floor" | "expired";

export const BOLT_SUBSTEP = 0.08;

export function spawnProjectile(
  x: number,
  y: number,
  z: number,
  dirX: number,
  dirY: number,
  dirZ: number,
  speed: number,
  damage: number,
  life: number,
  fromPlayer: boolean,
): Projectile {
  const length = Math.hypot(dirX, dirY, dirZ) || 1;
  return {
    x,
    y,
    z,
    vx: (dirX / length) * speed,
    vy: (dirY / length) * speed,
    vz: (dirZ / length) * speed,
    life,
    damage,
    fromPlayer,
  };
}

export function stepProjectile(
  projectile: Projectile,
  world: World,
  dt: number,
): ProjectileOutcome {
  const speed = Math.hypot(projectile.vx, projectile.vy, projectile.vz);
  const steps = Math.max(1, Math.ceil((speed * dt) / BOLT_SUBSTEP));
  const stepDt = dt / steps;

  for (let step = 0; step < steps; step += 1) {
    projectile.x += projectile.vx * stepDt;
    projectile.y += projectile.vy * stepDt;
    projectile.z += projectile.vz * stepDt;
    projectile.life -= stepDt;

    if (projectile.z <= 0) return "floor";

    const cellX = Math.floor(projectile.x);
    const cellY = Math.floor(projectile.y);
    if (
      cellX < 0 ||
      cellY < 0 ||
      cellX >= world.width ||
      cellY >= world.height
    ) {
      return "wall";
    }
    const cell = cellY * world.width + cellX;
    if (
      world.tiles[cell] !== 0 &&
      projectile.z <= world.heights[cell] + 1e-4
    ) {
      return "wall";
    }
    if (projectile.life <= 0) return "expired";
  }

  return "fly";
}

interface CylinderTarget {
  x: number;
  y: number;
  z: number;
  centerZ: number;
  radius: number;
  halfHeight: number;
}

export function projectileHitsCylinder(
  projectile: Projectile,
  target: CylinderTarget,
): boolean {
  const horizontal = Math.hypot(
    projectile.x - target.x,
    projectile.y - target.y,
  );
  return (
    horizontal <= target.radius &&
    Math.abs(projectile.z - (target.z + target.centerZ)) <= target.halfHeight
  );
}

/** Actor bodies use one shared capsule profile; callers scale it if needed. */
export function projectileHitsActor(
  projectile: Projectile,
  actor: { x: number; y: number; z: number },
  scale = 1,
): boolean {
  return projectileHitsCylinder(projectile, {
    x: actor.x,
    y: actor.y,
    z: actor.z,
    centerZ: 0.62 * scale,
    radius: 0.34 * scale,
    halfHeight: 0.6 * scale,
  });
}

export function projectileHitsPlayer(
  projectile: Projectile,
  player: { x: number; y: number; z: number },
): boolean {
  return projectileHitsCylinder(projectile, {
    x: player.x,
    y: player.y,
    z: player.z,
    centerZ: 0.5,
    radius: 0.26,
    halfHeight: 0.5,
  });
}

/**
 * Samples the 3D segment at chest height. Sampling the heightmap instead of a
 * 2D DDA keeps low crates in the test: a 0.6 block stops a 0.55-height shot but
 * not a bolt pitched upward over it.
 */
export function hasLineOfSight(
  world: World,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  maxDistance = 64,
): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dz = z1 - z0;
  const horizontal = Math.hypot(dx, dy);
  if (horizontal > maxDistance) return false;
  if (horizontal < 1e-6) return true;

  const steps = Math.max(1, Math.ceil(horizontal / 0.1));
  for (let step = 1; step < steps; step += 1) {
    const t = step / steps;
    const x = x0 + dx * t;
    const y = y0 + dy * t;
    const z = z0 + dz * t;
    const cellX = Math.floor(x);
    const cellY = Math.floor(y);
    if (
      cellX < 0 ||
      cellY < 0 ||
      cellX >= world.width ||
      cellY >= world.height
    ) {
      return false;
    }
    if (tileHeightAt(world, x, y) > z) return false;
  }
  return true;
}
