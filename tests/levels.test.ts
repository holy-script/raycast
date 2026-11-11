import { describe, expect, it } from "vitest";
import { LEVELS, levelIndexById } from "../src/content/levels";
import { createWorld, isSolidAt, supportHeight, tileAt } from "../src/engine/world";

const SPRITES = new Set(["guardian", "scout", "brute"]);

describe("level definitions", () => {
  it("indexes levels by id and rejects unknown ids", () => {
    expect(levelIndexById("courtyard")).toBe(0);
    expect(levelIndexById("reactor")).toBe(1);
    expect(() => levelIndexById("vault")).toThrow(/Unknown level id/);
  });

  it("keeps every map square", () => {
    for (const level of LEVELS) {
      expect(level.rows.length).toBe(24);
      for (const row of level.rows) expect(row.length).toBe(24);
    }
  });

  it("spawns the player on walkable floor", () => {
    for (const level of LEVELS) {
      const world = createWorld(level.rows, level.spawn);
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
      const world = createWorld(level.rows, level.spawn);
      for (const door of level.doors) {
        expect(tileAt(world, door.x + 0.5, door.y + 0.5), `${level.id}:${door.id}`).toBe(3);
        if (door.requires === "keycard") {
          expect(level.pickups.some((pickup) => pickup.kind === "keycard"), level.id).toBe(true);
        }
      }
    }
  });

  it("places pickups and exits on walkable floor", () => {
    for (const level of LEVELS) {
      const world = createWorld(level.rows, level.spawn);
      for (const spot of [...level.pickups, ...level.exits]) {
        expect(isSolidAt(world, spot.x, spot.y), `${level.id}:${spot.x},${spot.y}`).toBe(false);
        expect(supportHeight(world, spot.x, spot.y), `${level.id}:${spot.x},${spot.y}`).toBe(0);
      }
    }
  });

  it("places actors inside the map with known sprites", () => {
    for (const level of LEVELS) {
      const world = createWorld(level.rows, level.spawn);
      expect(level.actors.length).toBeGreaterThan(0);
      for (const actor of level.actors) {
        expect(SPRITES.has(actor.sprite), actor.name).toBe(true);
        expect(actor.x, actor.name).toBeGreaterThan(0);
        expect(actor.x, actor.name).toBeLessThan(24);
        expect(actor.y, actor.name).toBeGreaterThan(0);
        expect(actor.y, actor.name).toBeLessThan(24);
        expect(isSolidAt(world, actor.x, actor.y), actor.name).toBe(false);
        if (actor.hostile) {
          expect(actor.hp, actor.name).toBeGreaterThan(0);
          expect(actor.attack, actor.name).toBeDefined();
        }
      }
    }
  });
});
