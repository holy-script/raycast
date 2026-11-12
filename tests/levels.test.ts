import { describe, expect, it } from "vitest";
import { LEVELS, levelIndexById } from "../src/content/levels";
import { hasLineOfSight } from "../src/engine/projectile";
import {
  canOccupy,
  ceilingAt,
  COVER_CHAR,
  createWorld,
  hazardAt,
  isSolidAt,
  roofAt,
  supportHeight,
  tileAt,
  tileHeightAt,
  type RoomSpec,
  type World,
} from "../src/engine/world";

const SPRITES = new Set(["guardian"]);

function worldOf(level: (typeof LEVELS)[number]) {
  return createWorld(level.rows, level.spawn, {
    heights: level.heights,
    rooms: level.rooms,
    hazards: level.hazards,
  });
}

/**
 * Ground-reachable cells from the spawn. Doors count as passable because the
 * mission expects the player to open them; every other solid tile blocks.
 */
function reachableCells(level: (typeof LEVELS)[number], world: World) {
  const width = world.width;
  const start = Math.floor(level.spawn.y) * width + Math.floor(level.spawn.x);
  const seen = new Set<number>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const cell = queue.pop() as number;
    const x = cell % width;
    const y = Math.floor(cell / width);
    for (const [nx, ny] of [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ]) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= world.height) continue;
      const next = ny * width + nx;
      if (seen.has(next)) continue;
      const tile = world.tiles[next];
      if (tile !== 0 && tile !== 3) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return (x: number, y: number): boolean =>
    seen.has(Math.floor(y) * width + Math.floor(x));
}

/** Open cells of a room reachable from its doorway over 4-neighbours. */
function reachableFromDoor(world: World, room: RoomSpec) {
  const inside = (x: number, y: number): boolean =>
    x >= room.x &&
    y >= room.y &&
    x < room.x + room.width &&
    y < room.y + room.height;
  const open = (x: number, y: number): boolean =>
    inside(x, y) && tileAt(world, x + 0.5, y + 0.5) === 0;

  const doors: Array<[number, number]> = [];
  for (let y = room.y; y < room.y + room.height; y += 1) {
    for (let x = room.x; x < room.x + room.width; x += 1) {
      if (!open(x, y)) continue;
      const onEdge =
        x === room.x || y === room.y || x === room.x + room.width - 1 || y === room.y + room.height - 1;
      if (!onEdge) continue;
      const outsideNeighbour = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ].some(([nx, ny]) => !inside(nx, ny) && !isSolidAt(world, nx + 0.5, ny + 0.5));
      if (outsideNeighbour) doors.push([x, y]);
    }
  }

  const visited = new Set<string>();
  const queue = [...doors];
  for (const [x, y] of queue) visited.add(`${x},${y}`);
  while (queue.length > 0) {
    const [x, y] = queue.pop() as [number, number];
    for (const [nx, ny] of [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ]) {
      const key = `${nx},${ny}`;
      if (visited.has(key) || !open(nx, ny)) continue;
      visited.add(key);
      queue.push([nx, ny]);
    }
  }
  return { doors, visited };
}

describe("level definitions", () => {
  it("indexes levels by id and rejects unknown ids", () => {
    expect(levelIndexById("courtyard")).toBe(0);
    expect(levelIndexById("reactor")).toBe(1);
    expect(levelIndexById("district")).toBe(2);
    expect(levelIndexById("foundry")).toBe(3);
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

  it("gates the district extraction on the hunt plus the boss", () => {
    const district = LEVELS[levelIndexById("district")];
    const hostiles = district.actors.filter((actor) => actor.hostile);
    const bosses = hostiles.filter((actor) => actor.boss);
    expect(district.huntTargets).toBe(7);
    expect(hostiles.length).toBe(8);
    expect(bosses.length).toBe(1);
    expect(bosses[0].name).toBe("overseer");
    expect(district.title).toBe("ROOFTOP DISTRICT");
  });

  it("fields a rusher, a charged lancer, and an armored bulwark", () => {
    const district = LEVELS[levelIndexById("district")];
    const spec = (name: string) =>
      district.actors.find((actor) => actor.name === name);
    const rusher = spec("rusher-north");
    expect(rusher?.behavior).toBe("chase");
    expect(rusher?.hostile).toBe(true);
    expect(rusher?.gun).toBeUndefined();
    expect(rusher?.chase?.speed).toBeGreaterThan(2);
    expect(rusher?.hp).toBeLessThan(70);
    const lancer = spec("spire-se");
    expect(lancer?.behavior).toBe("sentry");
    expect(lancer?.gun?.charge).toBeCloseTo(0.9);
    expect(lancer?.gun?.damage).toBeGreaterThan(15);
    const bulwark = spec("bulwark");
    expect(bulwark?.armor).toEqual({ front: 0.5 });
    expect(bulwark?.hp).toBeGreaterThan(150);
    expect(bulwark?.attack?.damage).toBeGreaterThan(15);
  });

  it("places the overseer on an outer edge of a 12 m tower", () => {
    const district = LEVELS[levelIndexById("district")];
    const world = worldOf(district);
    const boss = district.actors.find((actor) => actor.name === "overseer");
    expect(boss).toBeDefined();
    expect(boss?.hostile).toBe(true);
    expect(boss?.boss).toBe(true);
    expect(boss?.behavior).toBe("sentry");
    expect(boss?.hp).toBe(260);
    expect(boss?.attack).toBeUndefined();
    expect(boss?.gun).toMatchObject({
      damage: 5,
      range: 18,
      cooldown: 1.7,
      volley: 3,
      spread: 0.12,
    });
    expect(boss?.z).toBe(12);
    expect(supportHeight(world, boss!.x, boss!.y)).toBeCloseTo(12);
    const bx = Math.floor(boss!.x);
    const by = Math.floor(boss!.y);
    const onEdge = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ].some(([dx, dy]) => !isSolidAt(world, bx + dx + 0.5, by + dy + 0.5));
    expect(onEdge, "boss cell must be on the tower edge").toBe(true);
  });

  it("stacks 0.6 m cover on the district roofs", () => {
    const district = LEVELS[levelIndexById("district")];
    const world = worldOf(district);
    const heights: number[] = [];
    for (let y = 0; y < district.rows.length; y += 1) {
      for (let x = 0; x < district.rows[y].length; x += 1) {
        if (district.rows[y][x] === COVER_CHAR) {
          heights.push(supportHeight(world, x + 0.5, y + 0.5));
        }
      }
    }
    expect(heights.length).toBe(9);
    const near = (value: number, target: number): boolean =>
      Math.abs(value - target) < 0.001;
    const low = heights.filter((height) => near(height, 8.6));
    const high = heights.filter((height) => near(height, 12.6));
    const mid = heights.filter((height) => near(height, 6.6));
    expect(low.length, "two 8 m spire covers").toBeGreaterThanOrEqual(2);
    expect(high.length, "three covers on the 12 m roofs").toBe(6);
    expect(mid.length, "one mid-rise belt-high cover").toBe(1);
  });

  it("keeps rooftop cover clear of every sentry sight line", () => {
    const district = LEVELS[levelIndexById("district")];
    const world = worldOf(district);
    const targets: Record<string, { x: number; y: number }> = {
      "spire-nw": { x: 6.5, y: 25.5 },
      "spire-ne": { x: 30.5, y: 4.5 },
      "spire-sw": { x: 11.5, y: 33.5 },
      "spire-se": { x: 49.5, y: 22.5 },
      overseer: { x: 40.5, y: 30.5 },
    };
    for (const actor of district.actors) {
      if (
        actor.behavior !== "sentry" ||
        !actor.gun ||
        !actor.hostile ||
        (actor.z ?? 0) <= 0
      ) {
        continue;
      }
      const target = targets[actor.name];
      expect(target, actor.name).toBeDefined();
      if (!target) continue;
      const visible = hasLineOfSight(
        world,
        actor.x,
        actor.y,
        (actor.z ?? 0) + 0.9,
        target.x,
        target.y,
        0.5,
        actor.gun.range,
      );
      expect(visible, actor.name).toBe(true);
    }
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

describe("district tower interiors", () => {
  const district = LEVELS[levelIndexById("district")];
  const rooms = district.rooms ?? [];
  const world = worldOf(district);

  it("declares sectors only for the district", () => {
    expect(rooms.length).toBe(2);
    for (const level of LEVELS) {
      const built = worldOf(level);
      if (level.id === "district" || (level.rooms?.length ?? 0) > 0) continue;
      expect(built.ceilings.every((value) => value === 0), level.id).toBe(true);
      expect(built.roofs.every((value) => value === 0), level.id).toBe(true);
    }
  });

  it("keeps every room inside the map with a valid slab", () => {
    for (const room of rooms) {
      const label = room.id;
      expect(room.x, label).toBeGreaterThanOrEqual(0);
      expect(room.y, label).toBeGreaterThanOrEqual(0);
      expect(room.x + room.width, label).toBeLessThanOrEqual(world.width);
      expect(room.y + room.height, label).toBeLessThanOrEqual(world.height);
      expect(room.ceilingZ, label).toBe(3);
      expect(room.roofZ, label).toBeGreaterThan(room.ceilingZ);
      // The carved rectangle must contain open floor and at least one doorway.
      expect(reachableFromDoor(world, room).doors.length, label).toBe(1);
    }
  });

  it("caps every cell of a room with the same ceiling and roof", () => {
    for (const room of rooms) {
      for (let y = room.y; y < room.y + room.height; y += 1) {
        for (let x = room.x; x < room.x + room.width; x += 1) {
          const label = `${room.id}:${x},${y}`;
          expect(ceilingAt(world, x + 0.5, y + 0.5), label).toBe(room.ceilingZ);
          expect(roofAt(world, x + 0.5, y + 0.5), label).toBe(room.roofZ);
        }
      }
    }
  });

  it("keeps the roof flush with the surrounding tower walls", () => {
    for (const room of rooms) {
      const neighbours: Array<[number, number]> = [];
      for (let x = room.x; x < room.x + room.width; x += 1) {
        neighbours.push([x, room.y - 1], [x, room.y + room.height]);
      }
      for (let y = room.y; y < room.y + room.height; y += 1) {
        neighbours.push([room.x - 1, y], [room.x + room.width, y]);
      }
      let walls = 0;
      for (const [x, y] of neighbours) {
        if (!isSolidAt(world, x + 0.5, y + 0.5)) continue;
        // Rooftop cover deliberately rises above the roof line.
        if (district.rows[y]?.[x] === COVER_CHAR) continue;
        walls += 1;
        expect(tileHeightAt(world, x + 0.5, y + 0.5), `${room.id}:${x},${y}`).toBe(
          room.roofZ,
        );
      }
      expect(walls, room.id).toBeGreaterThan(8);
    }
  });

  it("walks every interior cell from its doorway", () => {
    for (const room of rooms) {
      const { visited } = reachableFromDoor(world, room);
      let open = 0;
      for (let y = room.y; y < room.y + room.height; y += 1) {
        for (let x = room.x; x < room.x + room.width; x += 1) {
          if (tileAt(world, x + 0.5, y + 0.5) !== 0) continue;
          open += 1;
          expect(visited.has(`${x},${y}`), `${room.id}:${x},${y}`).toBe(true);
          expect(ceilingAt(world, x + 0.5, y + 0.5), `${room.id}:${x},${y}`).toBe(
            room.ceilingZ,
          );
        }
      }
      expect(open, room.id).toBeGreaterThan(12);
    }
  });

  it("stands on the interior floor and on the roof above it", () => {
    for (const room of rooms) {
      // First open cell of the room: a carved floor, not an interior prop.
      let cx = 0;
      let cy = 0;
      for (let y = room.y; y < room.y + room.height && cx === 0; y += 1) {
        for (let x = room.x; x < room.x + room.width; x += 1) {
          if (tileAt(world, x + 0.5, y + 0.5) !== 0) continue;
          cx = x + 0.5;
          cy = y + 0.5;
          break;
        }
      }
      expect(canOccupy(world, cx, cy, 0.19, 0), room.id).toBe(true);
      expect(supportHeight(world, cx, cy, 0), room.id).toBe(0);
      expect(supportHeight(world, cx, cy, room.roofZ), room.id).toBe(room.roofZ);
      expect(canOccupy(world, cx, cy, 0.19, room.roofZ), room.id).toBe(true);
    }
  });

  it("stocks each interior with one ground pickup", () => {
    for (const room of rooms) {
      const caches = district.pickups.filter(
        (pickup) =>
          pickup.x >= room.x &&
          pickup.y >= room.y &&
          pickup.x < room.x + room.width &&
          pickup.y < room.y + room.height,
      );
      expect(caches.length, room.id).toBe(1);
      const cache = caches[0];
      expect(cache.z ?? 0, room.id).toBe(0);
      expect(isSolidAt(world, cache.x, cache.y), room.id).toBe(false);
      expect(supportHeight(world, cache.x, cache.y, 0), room.id).toBe(0);
      expect(
        reachableFromDoor(world, room).visited.has(
          `${Math.floor(cache.x)},${Math.floor(cache.y)}`,
        ),
        room.id,
      ).toBe(true);
    }
  });
});

describe("slagworks foundry", () => {
  const foundry = LEVELS[levelIndexById("foundry")];
  const world = worldOf(foundry);
  const hazardCells: Array<[number, number]> = [];
  for (let y = 0; y < world.height; y += 1) {
    for (let x = 0; x < world.width; x += 1) {
      if (hazardAt(world, x + 0.5, y + 0.5)) hazardCells.push([x, y]);
    }
  }

  it("authors a 48 m furnace hall with its own surfaces", () => {
    expect(foundry.title).toBe("SLAGWORKS");
    expect(foundry.rows.length).toBe(48);
    expect(world.width).toBe(48);
    expect(foundry.floorTexture).toBe("foundry-floor");
    expect(foundry.topTexture).toBe("foundry-top");
    expect(foundry.wallTexture).toBe("foundry-wall");
  });

  it("stamps two slag channels and two vents as walkable hazards", () => {
    expect(foundry.hazards?.length).toBe(4);
    // 46 cells per full-width channel plus two single-cell vents.
    expect(hazardCells.length).toBe(94);
    for (const [x, y] of hazardCells) {
      expect(tileAt(world, x + 0.5, y + 0.5), `${x},${y}`).toBe(0);
      expect(supportHeight(world, x + 0.5, y + 0.5), `${x},${y}`).toBe(0);
    }
    expect(hazardAt(world, 1.5, 31.5)).toBe(true);
    expect(hazardAt(world, 46.5, 31.5)).toBe(true);
    expect(hazardAt(world, 30.5, 11.5)).toBe(true);
    expect(hazardAt(world, 34.5, 11.5)).toBe(true);
    expect(hazardAt(world, 20.5, 25.5)).toBe(false);
  });

  it("gates extraction on the hunt, three coolant cells, and the foreman", () => {
    expect(foundry.huntTargets).toBe(6);
    expect(foundry.coolantTargets).toBe(3);
    const hostiles = foundry.actors.filter((actor) => actor.hostile);
    const bosses = hostiles.filter((actor) => actor.boss);
    expect(hostiles.length).toBe(7);
    expect(bosses.length).toBe(1);
    expect(bosses[0].name).toBe("foreman");
    expect(bosses[0].hp).toBe(320);
    expect(bosses[0].gun?.volley).toBe(3);
    expect(foundry.bossObjective).toMatch(/foreman/i);
    const coolants = foundry.pickups.filter((pickup) => pickup.kind === "coolant");
    expect(coolants.length).toBe(foundry.coolantTargets);
  });

  it("mixes the furnace roster roles", () => {
    const spec = (name: string) =>
      foundry.actors.find((actor) => actor.name === name);
    expect(spec("slag-bulwark")?.armor).toEqual({ front: 0.5 });
    expect(spec("cinder-lancer")?.gun?.charge).toBeCloseTo(0.9);
    expect(spec("slag-rusher")?.gun).toBeUndefined();
    expect(spec("slag-rusher")?.chase?.speed).toBeGreaterThan(2);
    expect(spec("engineer")?.talk?.length).toBeGreaterThan(0);
  });

  it("keeps the keycard, coolant, and beacon reachable on foot", () => {
    const reachable = reachableCells(foundry, world);
    for (const pickup of foundry.pickups) {
      expect(reachable(pickup.x, pickup.y), `${pickup.kind}:${pickup.x},${pickup.y}`).toBe(
        true,
      );
    }
    for (const exit of foundry.exits) {
      expect(reachable(exit.x, exit.y), `exit:${exit.id}`).toBe(true);
    }
    for (const actor of foundry.actors) {
      if ((actor.z ?? 0) > 0 || actor.hostile) continue;
      expect(reachable(actor.x, actor.y), actor.name).toBe(true);
    }
  });

  it("places the control-room beacon behind the keycard door", () => {
    const door = foundry.doors.find((entry) => entry.requires === "keycard");
    expect(door).toBeDefined();
    const exit = foundry.exits[0];
    // Without the door the beacon is enclosed: the door is its only aperture.
    const sealed = (() => {
      const width = world.width;
      const seen = new Set<number>();
      const start =
        Math.floor(exit.y) * width + Math.floor(exit.x);
      seen.add(start);
      const queue = [start];
      while (queue.length > 0) {
        const cell = queue.pop() as number;
        const x = cell % width;
        const y = Math.floor(cell / width);
        for (const [nx, ny] of [
          [x - 1, y],
          [x + 1, y],
          [x, y - 1],
          [x, y + 1],
        ]) {
          const next = ny * width + nx;
          if (seen.has(next)) continue;
          if (world.tiles[next] !== 0) continue;
          seen.add(next);
          queue.push(next);
        }
      }
      const reach = Math.floor(foundry.spawn.y) * width + Math.floor(foundry.spawn.x);
      return !seen.has(reach);
    })();
    expect(sealed, "beacon must not be reachable without opening the door").toBe(
      true,
    );
  });
});
