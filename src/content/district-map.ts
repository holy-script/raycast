import type { RoomSpec } from "../engine/world";

// 64x64 rooftop district. Legend towers: a=4 m, b=6 m, c=8 m, d=10 m, e=12 m.
// '#' is a street wall, 'X' a 1.4 m destructible crate, '.' walkable asphalt.
// Digit '3' is a 0.6 m cover block resting on the roof beneath it (parapet
// corners and a belt-high block on a mid-rise strip). The 8-wide avenue runs
// north-south through the open plaza band and four tower quadrants with 2-cell
// alleys offer jetpack routes onto the rooftops.
//
// Two towers are hollow. The NW 4 m block holds a security office and the SE
// 12 m block holds a vault; the carved cells are interior floor under a 3 m
// ceiling (see DISTRICT_ROOMS) while their roofs stay at the tower height, so
// the skyline does not change from outside or above. The open cell on each
// tower face is the doorway, and it keeps the room's ceiling: the opening is
// 3 m tall with the facade continuing above it. A full-height gap was chosen
// over a DoorSpec because the door system only clears a 1.4 m block; a 1.4 m
// hole in a 4–12 m tower wall would leave a slot to the sky above the lintel,
// and the slab over the opening has no leaf to animate.
export const DISTRICT_HEIGHTS: Record<string, number> = {
  a: 4,
  b: 6,
  c: 8,
  d: 10,
  e: 12,
};

/**
 * Interior sectors. Rectangles include the tower cells that stay solid (they
 * keep their block and are capped by the same roof) and the carved doorway
 * cell on the street face.
 */
export const DISTRICT_ROOMS: RoomSpec[] = [
  {
    // NW security office: door at (2,6) on the west face, room x3..8 y4..8.
    id: "security-office",
    x: 2,
    y: 4,
    width: 7,
    height: 5,
    ceilingZ: 3,
    roofZ: 4,
  },
  {
    // SE vault: door at (55,60) on the south face, room x52..57 y54..59.
    id: "vault",
    x: 51,
    y: 54,
    width: 7,
    height: 7,
    ceilingZ: 3,
    roofZ: 12,
  },
];

export const DISTRICT_MAP: string[] = [
  "################################################################",
  "#..............................................................#",
  "#.aaaaaaaaa..bbbbbbbbb...3bb........bbb.aaaaaaaaa..ccccccc3c...#",
  "#.aaaaaaaaa..bbbbbbbbb...bbb........bbb.aaaaaaaaa..ccccccccc...#",
  "#.a....11aa..bbbbbbbbb...bbb........bbb.aaaaaaaaa..ccccccccc...#",
  "#.a......aa..bbbbbbbbb...bbb........bbb.aaaaaaaaa..ccccccccc...#",
  "#........aa..bbbbbbbbb...bbb........bbb.aaaaaaaaa..ccccccccc...#",
  "#.a......aa..bbbbbbbbb...bbb........bbb.aaaaaaaaa..ccccccccc...#",
  "#.a##....aa..bbbbbbbbb...bbb........bbb.aaaaaaaaa..ccccccccc...#",
  "#.aaaaaaaaa..bbbbbbbbb...bbb......X.bbb.aaaaaaaaa..ccccccccc...#",
  "#.aaaaaaaaa..bbbbbbbbb...bbb........bbb.aaaaaaaaa..ccccccccc...#",
  "#........................bbb........bbb........................#",
  "#........................bbb.X......bbb........................#",
  "#.ccccccc3c..aaaaaaaaa...bbb........bbb.eeeeeee3e..bbbbbbbbb...#",
  "#.ccccccccc..aaaaaaaaa...bbb........bbb.eeeeeeeee..bbbbbbbbb...#",
  "#.ccccccccc..aaaaaaaaa...bbb........bbb.eeeeeeeee..bbbbbbbbb...#",
  "#.ccccccccc..aaaaaaaaa...bbb........bbb.eeeeeeeee..bbbbbbbbb...#",
  "#.ccccccccc..aaaaaaaaa...bbb........bbb.eeeeeeeee..bbbbbbbbb...#",
  "#.ccccccccc..aaaaaaaaa...bbb........bbb.eeeeeeeee..bbbbbbbbb...#",
  "#.ccccccccc..aaaaaaaaa...bbb........bbb.eeeeeeeee..bbbbbbbbb...#",
  "#.ccccccccc..aaaaaaaaa...bbb........bbb.eeeeeeeee..bbbbbbbbb...#",
  "#.ccccccccc..aaaaaaaaa...bbb........bbb.eeeeeeeee..bbbbbbbbb...#",
  "#..............................................................#",
  "#..............................................................#",
  "#..............................................................#",
  "#..............................................................#",
  "#..............................................................#",
  "#..............................................................#",
  "#..............................................................#",
  "#..............................................................#",
  "#.............................X................................#",
  "#..............................................................#",
  "#..............................................................#",
  "#..............................................................#",
  "#..............................................................#",
  "#..............................................................#",
  "#..............................................................#",
  "#..............................................................#",
  "#..............................................................#",
  "#..............................................................#",
  "#..............................................................#",
  "#.bbbbbbbbb..ddddddddd...bbb........bbb.ccccccccc..eeeeeeeee...#",
  "#.bbbbbbbbb..ddddddddd...bbb........bbb.ccccccccc..eee3eeeee...#",
  "#.bbbbbbbbb..ddddddddd...bbb........bbb.ccccccccc..eeeeeeeee...#",
  "#.bbbbbbbbb..ddddddddd...bbb........bbb.ccccccccc..eeeee3eee...#",
  "#.bbbbbbbbb..ddddddddd...bbb........bbb.ccccccccc..eeeeeeeee...#",
  "#.bbbbbbbbb..ddddddddd...bbb........bbb.ccccccccc..eeeeeeeee...#",
  "#.bbbbbbbbb..ddddddddd...bbb........bbb.ccccccccc..eeeeeeeee...#",
  "#.bbbbbbbbb..ddddddddd...bbb........bbb.ccccccccc..eeeeeee3e...#",
  "#.bbbbbbbbb..ddddddddd...bbb........bbb.ccccccccc..eeeeeeeee...#",
  "#........................bbb........bbb........................#",
  "#........................bbbX.......bbb........................#",
  "#.eeeeeeeee..ccccccccc...bbb........bbb.aaaaaaaaa..eeeeeeeee...#",
  "#.eeeeeeeee..ccccccccc...bbb........bbb.aaaaaaaaa..eeeeeeeee...#",
  "#.eeeeeeeee..ccccccccc...bbb........bbb.aaaaaaaaa..e11....ee...#",
  "#.eeeeeeeee..ccccccccc...bbb........bbb.aaaaaaaaa..e......ee...#",
  "#.eeeeeeeee..ccccccccc...bbb........bbb.aaaaaaaaa..e......ee...#",
  "#.eeeeeeeee..ccccccccc...bbb......X.bbb.aaaaaaaaa..e..###.ee...#",
  "#.eeeeeeeee..ccccccccc...bbb........bbb.aaaaaaaaa..e......ee...#",
  "#.3eeeeeeee..ccccccccc...bbb........bbb.aaaaaaaaa..e......3e...#",
  "#.eeeeeeeee..ccccccccc...bbb........bbb.aaaaaaaaa..eeee.eeee...#",
  "#..............................................................#",
  "#..............................................................#",
  "################################################################",
];

export const DISTRICT_SPAWN = { x: 32.5, y: 58.5 };
