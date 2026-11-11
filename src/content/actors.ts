export type ActorBehavior =
  | "idle"
  | "watcher"
  | "sentry"
  | "patrol"
  | "chase"
  | "hover";
export type SpriteId = "guardian";

export interface ActorSpec {
  name: string;
  sprite: SpriteId;
  x: number;
  y: number;
  /** Base elevation for actors that stand on a tower roof. */
  z?: number;
  facing: number;
  behavior: ActorBehavior;
  tint: [number, number, number];
  scale?: number;
  patrol?: { ax: number; ay: number; bx: number; by: number; speed: number };
  chase?: { speed: number; range: number };
  hover?: { height: number; bob: number; speed: number };
  /** Hostile actors take and deal damage; friendly actors only talk. */
  hostile?: boolean;
  hp?: number;
  attack?: { damage: number; range: number; cooldown: number };
  /** Ranged attack fired from the wind-up pose when the player is in sight. */
  gun?: { damage: number; range: number; cooldown: number; speed: number };
  /** Looping dialogue shown when the player uses E nearby. */
  talk?: string[];
}

const EAST = 0;
const SOUTH = Math.PI * 0.5;
const WEST = Math.PI;
const NORTH = -Math.PI * 0.5;

export const COURTYARD_ACTORS: ActorSpec[] = [
  {
    name: "sentinel",
    sprite: "guardian",
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
    talk: [
      "Gate's been sealed since the vent blew. Keycard's east of here.",
      "That lift chamber drops straight to the reactor deck.",
    ],
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
    sprite: "guardian",
    x: 4.5,
    y: 12.5,
    facing: NORTH,
    behavior: "idle",
    tint: [1.0, 0.84, 1.18],
    scale: 0.9,
    talk: ["Three chassis, sixteen views each. The reactor deck is worse."],
  },
  {
    name: "warden",
    sprite: "guardian",
    x: 12.5,
    y: 22.5,
    facing: NORTH,
    behavior: "idle",
    tint: [0.85, 1.15, 0.9],
    scale: 1.16,
  },
  {
    name: "ranger",
    sprite: "guardian",
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
    sprite: "guardian",
    x: 21.5,
    y: 4.5,
    facing: WEST,
    behavior: "idle",
    tint: [1.2, 0.9, 1.05],
    scale: 1.12,
    talk: [
      "I keep the lift honest. You keep the drones off me.",
      "Card readers are fussy. Walk up and press E.",
    ],
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
  {
    name: "drone",
    sprite: "guardian",
    x: 11.5,
    y: 9.5,
    facing: EAST,
    behavior: "hover",
    tint: [0.7, 1.1, 1.25],
    scale: 0.82,
    hover: { height: 1.1, bob: 0.28, speed: 1.7 },
  },
  {
    name: "wisp",
    sprite: "guardian",
    x: 2.5,
    y: 14.5,
    facing: SOUTH,
    behavior: "hover",
    tint: [0.85, 1.2, 1.0],
    scale: 0.72,
    hover: { height: 1.8, bob: 0.35, speed: 2.1 },
  },
  {
    name: "stalker",
    sprite: "guardian",
    x: 18.5,
    y: 14.5,
    facing: WEST,
    behavior: "chase",
    tint: [1.1, 0.9, 1.25],
    scale: 0.95,
    chase: { speed: 1.5, range: 10 },
    hostile: true,
    hp: 70,
    attack: { damage: 8, range: 1.5, cooldown: 1.2 },
  },
  {
    name: "prowler",
    sprite: "guardian",
    x: 6.5,
    y: 20.5,
    facing: WEST,
    behavior: "chase",
    tint: [1.25, 0.8, 0.85],
    scale: 1.12,
    chase: { speed: 1.05, range: 9 },
    hostile: true,
    hp: 140,
    attack: { damage: 14, range: 1.6, cooldown: 1.5 },
  },
  {
    name: "marauder",
    sprite: "guardian",
    x: 20.5,
    y: 22.5,
    facing: NORTH,
    behavior: "chase",
    tint: [1.2, 0.95, 0.8],
    scale: 1.04,
    chase: { speed: 0.9, range: 8 },
    hostile: true,
    hp: 110,
    attack: { damage: 11, range: 1.5, cooldown: 1.35 },
    gun: { damage: 11, range: 9, cooldown: 1.7, speed: 9 },
  },
];

export const ROOFTOP_ACTORS: ActorSpec[] = [
  {
    name: "spire-nw",
    sprite: "guardian",
    x: 6.5,
    y: 21.5,
    z: 8,
    facing: SOUTH,
    behavior: "sentry",
    tint: [1.25, 0.85, 0.8],
    scale: 1.02,
    hostile: true,
    hp: 80,
    gun: { damage: 9, range: 18, cooldown: 1.9, speed: 10 },
  },
  {
    name: "spire-ne",
    sprite: "guardian",
    x: 40.5,
    y: 21.5,
    z: 12,
    facing: SOUTH,
    behavior: "sentry",
    tint: [1.3, 0.8, 0.75],
    scale: 1.04,
    hostile: true,
    hp: 85,
    gun: { damage: 10, range: 20, cooldown: 2.0, speed: 10 },
  },
  {
    name: "spire-sw",
    sprite: "guardian",
    x: 10.5,
    y: 52.5,
    z: 12,
    facing: NORTH,
    behavior: "sentry",
    tint: [1.22, 0.86, 0.9],
    scale: 1.04,
    hostile: true,
    hp: 85,
    gun: { damage: 10, range: 20, cooldown: 2.0, speed: 10 },
  },
  {
    name: "spire-se",
    sprite: "guardian",
    x: 55.5,
    y: 41.5,
    z: 12,
    facing: WEST,
    behavior: "sentry",
    tint: [1.28, 0.82, 0.85],
    scale: 1.04,
    hostile: true,
    hp: 85,
    gun: { damage: 10, range: 20, cooldown: 2.0, speed: 10 },
  },
  {
    name: "gunner-north",
    sprite: "guardian",
    x: 32.5,
    y: 19.5,
    facing: SOUTH,
    behavior: "sentry",
    tint: [1.2, 0.9, 0.78],
    scale: 0.98,
    hostile: true,
    hp: 80,
    gun: { damage: 8, range: 13, cooldown: 1.7, speed: 9 },
  },
  {
    name: "gunner-south",
    sprite: "guardian",
    x: 32.5,
    y: 43.5,
    facing: SOUTH,
    behavior: "sentry",
    tint: [1.2, 0.92, 0.8],
    scale: 0.98,
    hostile: true,
    hp: 80,
    gun: { damage: 8, range: 13, cooldown: 1.7, speed: 9 },
  },
  {
    name: "bruiser",
    sprite: "guardian",
    x: 32.5,
    y: 37.5,
    facing: SOUTH,
    behavior: "chase",
    tint: [1.32, 0.72, 0.68],
    scale: 1.16,
    chase: { speed: 1.35, range: 12 },
    hostile: true,
    hp: 150,
    attack: { damage: 16, range: 1.7, cooldown: 1.5 },
  },
];

export const REACTOR_ACTORS: ActorSpec[] = [
  {
    name: "engineer",
    sprite: "guardian",
    x: 15.5,
    y: 12.5,
    facing: SOUTH,
    behavior: "idle",
    tint: [0.95, 1.15, 1.2],
    scale: 0.94,
    talk: [
      "Vault's on the west face. No card reader on this deck, just press E.",
      "Beacon inside the vault lifts you back to the courtyard.",
    ],
  },
  {
    name: "reactor-scout",
    sprite: "guardian",
    x: 2.5,
    y: 12.5,
    facing: EAST,
    behavior: "chase",
    tint: [1.15, 0.85, 0.95],
    scale: 0.96,
    chase: { speed: 1.6, range: 12 },
    hostile: true,
    hp: 70,
    attack: { damage: 9, range: 1.5, cooldown: 1.1 },
  },
  {
    name: "reactor-brute",
    sprite: "guardian",
    x: 19.5,
    y: 6.5,
    facing: WEST,
    behavior: "chase",
    tint: [1.3, 0.78, 0.7],
    scale: 1.14,
    chase: { speed: 1.0, range: 10 },
    hostile: true,
    hp: 140,
    attack: { damage: 15, range: 1.6, cooldown: 1.6 },
  },
  {
    name: "spark",
    sprite: "guardian",
    x: 11.5,
    y: 15.5,
    facing: NORTH,
    behavior: "hover",
    tint: [0.75, 1.2, 1.3],
    scale: 0.8,
    hover: { height: 1.9, bob: 0.32, speed: 1.9 },
  },
];
