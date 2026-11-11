import { COURTYARD_ACTORS, REACTOR_ACTORS, type ActorSpec } from "./actors";
import { DEMO_MAP, DEMO_SPAWN } from "./demo-map";

export type PickupKind = "keycard" | "medkit" | "fuel";

export interface PickupSpec {
  kind: PickupKind;
  x: number;
  y: number;
}

export interface DoorSpec {
  id: string;
  x: number;
  y: number;
  requires?: "keycard";
}

export interface ExitSpec {
  id: string;
  x: number;
  y: number;
  target: string;
}

export interface LevelSpec {
  id: string;
  title: string;
  objective: string;
  rows: string[];
  spawn: { x: number; y: number; yaw: number };
  actors: ActorSpec[];
  pickups: PickupSpec[];
  doors: DoorSpec[];
  exits: ExitSpec[];
}

// Reactor deck: a stepped pyramid, a vault, and terrace platforms at 0.2–1.8 m.
const REACTOR_MAP = [
  "########################",
  "#......................#",
  "#..111111........2222..#",
  "#..1....1........2..2..#",
  "#..1....1........2..2..#",
  "#..111111........2222..#",
  "#......................#",
  "#....3333..............#",
  "#....3..3....######....#",
  "#....3..3....D....#....#",
  "#....3333....#....#....#",
  "#............######....#",
  "#...55555..............#",
  "#...5...5......6666....#",
  "#...5...5......6..6....#",
  "#...55555......6666....#",
  "#......................#",
  "#.......6666...........#",
  "#.......5555...........#",
  "#.......4444...........#",
  "#.......3333...........#",
  "#.......2222...........#",
  "#.......1111...........#",
  "########################",
];

export const LEVELS: LevelSpec[] = [
  {
    id: "courtyard",
    title: "COURTYARD",
    objective: "Grab the keycard, unlock the lift chamber, step onto the pad.",
    rows: DEMO_MAP,
    spawn: { x: DEMO_SPAWN.x, y: DEMO_SPAWN.y, yaw: 0 },
    actors: COURTYARD_ACTORS,
    pickups: [
      { kind: "keycard", x: 17.5, y: 9.5 },
      { kind: "medkit", x: 1.5, y: 21.5 },
      { kind: "fuel", x: 21.5, y: 12.5 },
    ],
    doors: [{ id: "lift", x: 9, y: 11, requires: "keycard" }],
    exits: [{ id: "lift", x: 11.5, y: 11.5, target: "reactor" }],
  },
  {
    id: "reactor",
    title: "REACTOR DECK",
    objective: "Cross the terrace, open the vault, reach the extraction beacon.",
    rows: REACTOR_MAP,
    spawn: { x: 2.5, y: 20.5, yaw: -Math.PI * 0.5 },
    actors: REACTOR_ACTORS,
    pickups: [
      { kind: "medkit", x: 2.5, y: 12.5 },
      { kind: "fuel", x: 11.5, y: 16.5 },
    ],
    doors: [{ id: "vault", x: 13, y: 9 }],
    exits: [{ id: "extraction", x: 15.5, y: 9.5, target: "courtyard" }],
  },
];

export function levelIndexById(id: string): number {
  const index = LEVELS.findIndex((level) => level.id === id);
  if (index < 0) throw new Error(`Unknown level id: ${id}`);
  return index;
}
