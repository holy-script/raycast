import type { HazardArea, RoomSpec } from "../engine/world";

/**
 * 48×48 SLAGWORKS furnace hall. The perimeter is a 6 m foundry wall (`b`);
 * interior `a` blocks are 3 m machinery and `b` blocks are catwalk towers.
 * Two full-width slag channels split the hall into south, middle, and north
 * zones, and the control room sits behind a keycard door in the north wall.
 */
const WIDTH = 48;
const HEIGHT = 48;

function buildRows(): string[] {
  const grid = Array.from({ length: HEIGHT }, () => Array<string>(WIDTH).fill("."));
  const fill = (x: number, y: number, width: number, height: number, char: string) => {
    for (let row = y; row < y + height; row += 1) {
      for (let col = x; col < x + width; col += 1) grid[row][col] = char;
    }
  };

  fill(0, 0, WIDTH, 1, "b");
  fill(0, HEIGHT - 1, WIDTH, 1, "b");
  fill(0, 0, 1, HEIGHT, "b");
  fill(WIDTH - 1, 0, 1, HEIGHT, "b");

  // Control room: a 6 m block hollowed to a 3 m ceiling, keycard door south.
  fill(30, 5, 6, 6, "b");
  fill(31, 6, 4, 4, ".");
  grid[10][32] = "D";

  // Furnace machinery and catwalk towers.
  fill(6, 6, 4, 4, "a");
  fill(18, 3, 4, 4, "a");
  fill(40, 6, 4, 4, "a");
  fill(25, 7, 3, 3, "b");
  fill(8, 14, 4, 4, "a");
  fill(36, 14, 4, 4, "a");
  fill(14, 34, 4, 4, "a");
  fill(30, 38, 4, 4, "a");

  return grid.map((row) => row.join(""));
}

export const FOUNDRY_MAP = buildRows();
export const FOUNDRY_SPAWN = { x: 24.5, y: 44.5 };

export const FOUNDRY_HEIGHTS: Record<string, number> = { a: 3, b: 6 };

export const FOUNDRY_ROOMS: RoomSpec[] = [
  {
    // Control room: door at (32,10), interior x31..34 y6..9.
    id: "control-room",
    x: 30,
    y: 5,
    width: 6,
    height: 6,
    ceilingZ: 3,
    roofZ: 6,
  },
];

/** Two full-width channels plus steam vents flanking the control-room door. */
export const FOUNDRY_HAZARDS: HazardArea[] = [
  { id: "slag-south", x: 1, y: 31, width: 46, height: 1 },
  { id: "slag-mid", x: 1, y: 20, width: 46, height: 1 },
  { id: "vent-west", x: 30, y: 11, width: 1, height: 1 },
  { id: "vent-east", x: 34, y: 11, width: 1, height: 1 },
];
