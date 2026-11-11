export type ActorBehavior = "idle" | "watcher" | "patrol";
export type SpriteId = "guardian" | "scout" | "brute";

export interface ActorSpec {
  name: string;
  sprite: SpriteId;
  x: number;
  y: number;
  facing: number;
  behavior: ActorBehavior;
  tint: [number, number, number];
  scale?: number;
  patrol?: { ax: number; ay: number; bx: number; by: number; speed: number };
}

const EAST = 0;
const SOUTH = Math.PI * 0.5;
const WEST = Math.PI;
const NORTH = -Math.PI * 0.5;

export const DEMO_ACTORS: ActorSpec[] = [
  {
    name: "sentinel",
    sprite: "scout",
    x: 18.5,
    y: 9.5,
    facing: WEST,
    behavior: "watcher",
    tint: [0.72, 1.08, 1.22],
    scale: 0.94,
  },
  {
    name: "guard",
    sprite: "guardian",
    x: 7.5,
    y: 1.5,
    facing: WEST,
    behavior: "idle",
    tint: [1.18, 0.86, 0.65],
  },
  {
    name: "patrol",
    sprite: "guardian",
    x: 10.5,
    y: 14.5,
    facing: EAST,
    behavior: "patrol",
    tint: [1.05, 1.0, 0.86],
    patrol: { ax: 10.5, ay: 14.5, bx: 16.5, by: 14.5, speed: 1.1 },
  },
  {
    name: "scholar",
    sprite: "scout",
    x: 4.5,
    y: 12.5,
    facing: NORTH,
    behavior: "idle",
    tint: [1.0, 0.84, 1.18],
    scale: 0.9,
  },
  {
    name: "warden",
    sprite: "brute",
    x: 12.5,
    y: 22.5,
    facing: NORTH,
    behavior: "idle",
    tint: [0.85, 1.15, 0.9],
    scale: 1.16,
  },
  {
    name: "ranger",
    sprite: "scout",
    x: 1.5,
    y: 3.5,
    facing: SOUTH,
    behavior: "patrol",
    tint: [1.1, 0.95, 0.7],
    scale: 0.92,
    patrol: { ax: 1.5, ay: 3.5, bx: 1.5, by: 9.5, speed: 0.9 },
  },
  {
    name: "tinker",
    sprite: "brute",
    x: 21.5,
    y: 4.5,
    facing: WEST,
    behavior: "idle",
    tint: [1.2, 0.9, 1.05],
    scale: 1.12,
  },
  {
    name: "watcher",
    sprite: "guardian",
    x: 20.5,
    y: 16.5,
    facing: WEST,
    behavior: "watcher",
    tint: [0.82, 1.0, 1.3],
  },
];
