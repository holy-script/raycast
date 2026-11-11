import { describe, expect, it } from "vitest";
import { createWorld } from "../src/engine/world";
import {
  hasLineOfSight,
  projectileHitsActor,
  projectileHitsPlayer,
  spawnProjectile,
  stepProjectile,
  type Projectile,
  type ProjectileOutcome,
} from "../src/engine/projectile";

const OPEN = createWorld([
  "#######",
  "#.....#",
  "#.....#",
  "#.....#",
  "#######",
]);

const LEDGE = createWorld([
  "#######",
  "#..2..#",
  "#.....#",
  "#######",
]);

const DIVIDED = createWorld([
  "#######",
  "#..#..#",
  "#.....#",
  "#######",
]);

function advance(
  projectile: Projectile,
  world = OPEN,
  dt = 0.02,
  limit = 400,
): ProjectileOutcome {
  let outcome: ProjectileOutcome = "fly";
  for (let step = 0; step < limit && outcome === "fly"; step += 1) {
    outcome = stepProjectile(projectile, world, dt);
  }
  return outcome;
}

describe("spawnProjectile", () => {
  it("normalizes the direction and keeps the requested speed", () => {
    const bolt = spawnProjectile(1, 2, 3, 3, 4, 0, 10, 45, 0.9, true);
    expect(Math.hypot(bolt.vx, bolt.vy, bolt.vz)).toBeCloseTo(10, 6);
    expect(bolt.vx).toBeCloseTo(6, 6);
    expect(bolt.vy).toBeCloseTo(8, 6);
    expect(bolt.damage).toBe(45);
    expect(bolt.fromPlayer).toBe(true);
  });
});

describe("stepProjectile", () => {
  it("stops at a full-height wall", () => {
    const bolt = spawnProjectile(1.5, 2.5, 0.55, 1, 0, 0, 10, 45, 1, true);
    expect(advance(bolt)).toBe("wall");
    expect(bolt.x).toBeLessThan(6.2);
    expect(bolt.x).toBeGreaterThan(5.9);
  });

  it("drops to the floor when pitched down", () => {
    const bolt = spawnProjectile(2.5, 2.5, 1.2, 0, 0, -1, 6, 45, 2, true);
    expect(advance(bolt)).toBe("floor");
    expect(bolt.z).toBeLessThanOrEqual(0.001);
  });

  it("expires after its lifetime instead of flying forever", () => {
    const bolt = spawnProjectile(1.5, 2.5, 0.55, 1, 0, 0, 2, 45, 0.3, true);
    expect(advance(bolt)).toBe("expired");
    expect(bolt.x).toBeCloseTo(2.1, 1);
  });

  it("clears a low ledge when the bolt is above its top", () => {
    const bolt = spawnProjectile(1.5, 1.5, 0.55, 1, 0, 0, 10, 45, 2, true);
    expect(advance(bolt, LEDGE)).toBe("wall");
    expect(bolt.x).toBeGreaterThan(4.5);
  });

  it("is blocked by a ledge taller than the bolt", () => {
    const bolt = spawnProjectile(1.5, 1.5, 0.2, 1, 0, 0, 10, 45, 2, true);
    expect(advance(bolt, LEDGE)).toBe("wall");
    expect(bolt.x).toBeLessThan(4);
  });
});

describe("projectileHitsActor", () => {
  it("hits a body at chest height", () => {
    const bolt = spawnProjectile(2, 2, 0.62, 1, 0, 0, 10, 45, 1, true);
    expect(projectileHitsActor(bolt, { x: 2, y: 2, z: 0 })).toBe(true);
  });

  it("misses beside or above the body", () => {
    const bolt = spawnProjectile(2, 2, 0.62, 1, 0, 0, 10, 45, 1, true);
    expect(projectileHitsActor(bolt, { x: 2.6, y: 2, z: 0 })).toBe(false);
    expect(projectileHitsActor(bolt, { x: 2, y: 2, z: 1.4 })).toBe(false);
  });

  it("hits the player capsule at eye level", () => {
    const bolt = spawnProjectile(3, 3, 0.52, 1, 0, 0, 10, 45, 1, false);
    expect(projectileHitsPlayer(bolt, { x: 3, y: 3, z: 0 })).toBe(true);
    expect(projectileHitsPlayer(bolt, { x: 3, y: 3.8, z: 0 })).toBe(false);
  });
});

describe("hasLineOfSight", () => {
  it("sees over a low ledge but not through its body", () => {
    expect(hasLineOfSight(LEDGE, 1.5, 1.5, 0.55, 5.5, 1.5, 0.55)).toBe(true);
    expect(hasLineOfSight(LEDGE, 1.5, 1.5, 0.2, 5.5, 1.5, 0.2)).toBe(false);
  });

  it("is blocked by a full wall", () => {
    expect(hasLineOfSight(DIVIDED, 1.5, 1.5, 0.55, 5.5, 1.5, 0.55)).toBe(false);
    expect(hasLineOfSight(DIVIDED, 1.5, 2.5, 0.55, 5.5, 2.5, 0.55)).toBe(true);
  });

  it("rejects targets beyond its maximum range", () => {
    expect(hasLineOfSight(OPEN, 1.5, 2.5, 0.55, 5.5, 2.5, 0.55, 2)).toBe(false);
  });
});
