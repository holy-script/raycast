export type ActorBehavior = "idle" | "watcher" | "patrol";

export interface ActorSpec {
  name: string;
  x: number;
  y: number;
  facing: number;
  behavior: ActorBehavior;
  tint: [number, number, number];
  scale?: number;
  patrol?: { ax: number; ay: number; bx: number; by: number; speed: number };
}

const NORTH = Math.PI * 0.5;
const WEST = Math.PI;

export const DEMO_ACTORS: ActorSpec[] = [
  {
    name: "sentinel",
    x: 18.5,
    y: 9.5,
    facing: WEST,
    behavior: "watcher",
    tint: [0.72, 1.08, 1.22],
  },
  {
    name: "guard",
    x: 7.5,
    y: 1.5,
    facing: WEST,
    behavior: "idle",
    tint: [1.18, 0.86, 0.65],
  },
  {
    name: "patrol",
    x: 10.5,
    y: 14.5,
    facing: 0,
    behavior: "patrol",
    tint: [1.05, 1.0, 0.86],
    patrol: { ax: 10.5, ay: 14.5, bx: 16.5, by: 14.5, speed: 1.1 },
  },
  {
    name: "scholar",
    x: 4.5,
    y: 12.5,
    facing: NORTH,
    behavior: "idle",
    tint: [1.0, 0.84, 1.18],
  },
  {
    name: "warden",
    x: 12.5,
    y: 22.5,
    facing: -NORTH,
    behavior: "idle",
    tint: [0.85, 1.15, 0.9],
  },
];
