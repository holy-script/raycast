import { describe, expect, it } from "vitest";
import { LEVELS, levelIndexById } from "../src/content/levels";
import { createWorld, isSolidAt, supportHeight, tileAt } from "../src/engine/world";

const SPRITES = new Set(["guardian"]);

function worldOf(level: (typeof LEVELS)[number]) {
  return createWorld(level.rows, level.spawn, { heights: level.heights });
}

describe("level definitions", () => {
  it("indexes levels by id and rejects unknown ids", () => {
    expect(levelIndexById("courtyard")).toBe(0);
    expect(levelIndexById("reactor")).toBe(1);
    expect(levelIndexById("district")).toBe(2);
    expect(() => levelIndexById("vault")).toThrow(/Unknown level id/);
  });

  it("keeps every map square", () => {
    for (const level of LEVELS) {
      const size = level.rows.length;
      expect(size, level.id).toBeGreaterThan(0);
      for (const row of level.rows) expect(row.length, level.id).toBe(size);
    }
  });

  it("spawns the player on walkable floor", () => {
    for (const level of LEVELS) {
      const world = worldOf(level);
      expect(isSolidAt(world, level.spawn.x, level.spawn.y), level.id).toBe(false);
      expect(supportHeight(world, level.spawn.x, level.spawn.y), level.id).toBe(0);
    }
  });

  it("points every exit at an existing level", () => {
    for (const level of LEVELS) {
      for (const exit of level.exits) {
        expect(() => levelIndexById(exit.target)).not.toThrow();
        expect(exit.target).not.toBe(level.id);
      }
    }
  });

  it("matches each door spec to a D cell and keycard availability", () => {
    for (const level of LEVELS) {
      const world = worldOf(level);
      for (const door of level.doors) {
        expect(tileAt(world, door.x + 0.5, door.y + 0.5), `${level.id}:${door.id}`).toBe(3);
        if (door.requires === "keycard") {
          expect(level.pickups.some((pickup) => pickup.kind === "keycard"), level.id).toBe(true);
        }
      }
    }
  });

  it("places pickups and exits on the surface they sit on", () => {
    for (const level of LEVELS) {
      const world = worldOf(level);
      for (const spot of [...level.pickups, ...level.exits]) {
        const label = `${level.id}:${spot.x},${spot.y}`;
        const z = spot.z ?? 0;
        if (z > 0) {
          expect(isSolidAt(world, spot.x, spot.y), label).toBe(true);
          expect(supportHeight(world, spot.x, spot.y), label).toBeCloseTo(z);
        } else {
          expect(isSolidAt(world, spot.x, spot.y), label).toBe(false);
          expect(supportHeight(world, spot.x, spot.y), label).toBe(0);
        }
      }
    }
  });

  it("places actors inside the map with known sprites", () => {
    for (const level of LEVELS) {
      const world = worldOf(level);
      expect(level.actors.length).toBeGreaterThan(0);
      for (const actor of level.actors) {
        expect(SPRITES.has(actor.sprite), actor.name).toBe(true);
        expect(actor.x, actor.name).toBeGreaterThan(0);
        expect(actor.x, actor.name).toBeLessThan(level.rows[0].length);
        expect(actor.y, actor.name).toBeGreaterThan(0);
        expect(actor.y, actor.name).toBeLessThan(level.rows.length);
        if ((actor.z ?? 0) > 0) {
          // Rooftop soldiers stand on the tower top under their feet.
          expect(supportHeight(world, actor.x, actor.y), actor.name).toBeCloseTo(
            actor.z ?? 0,
          );
        } else {
          expect(isSolidAt(world, actor.x, actor.y), actor.name).toBe(false);
        }
        if (actor.hostile) {
          expect(actor.hp, actor.name).toBeGreaterThan(0);
          expect(actor.attack ?? actor.gun, actor.name).toBeDefined();
        }
      }
    }
  });

  it("gates the district extraction on exactly its hostile roster", () => {
    const district = LEVELS[levelIndexById("district")];
    const hostiles = district.actors.filter((actor) => actor.hostile);
    expect(district.huntTargets).toBe(7);
    expect(hostiles.length).toBe(district.huntTargets);
    expect(district.title).toBe("ROOFTOP DISTRICT");
  });

  it("builds the district towers from its legend heights", () => {
    const district = LEVELS[levelIndexById("district")];
    const world = worldOf(district);
    expect(district.rows.length).toBe(64);
    expect(world.width).toBe(64);
    expect(district.heights).toEqual({ a: 4, b: 6, c: 8, d: 10, e: 12 });
    // NW low-rise, NE high-rise, and the flanking mid-rise strips.
    expect(supportHeight(world, 2.5, 2.5)).toBe(4);
    expect(supportHeight(world, 44.5, 17.5)).toBe(12);
    expect(supportHeight(world, 25.5, 10.5)).toBe(6);
  });
});
