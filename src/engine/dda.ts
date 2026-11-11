import type { World } from "./world";

export interface RayHit {
  /** Perpendicular distance to the camera plane, used for projection. */
  distance: number;
  side: 0 | 1;
  mapX: number;
  mapY: number;
  tile: number;
  /** Horizontal texture coordinate in [0, 1). */
  wallU: number;
}

/** Grid traversal using the Digital Differential Analyzer algorithm. */
export function castRay(
  world: World,
  originX: number,
  originY: number,
  dirX: number,
  dirY: number,
  maxDistance = 64,
): RayHit | null {
  let mapX = Math.floor(originX);
  let mapY = Math.floor(originY);

  const deltaX = dirX === 0 ? Infinity : Math.abs(1 / dirX);
  const deltaY = dirY === 0 ? Infinity : Math.abs(1 / dirY);

  const stepX = dirX < 0 ? -1 : 1;
  const stepY = dirY < 0 ? -1 : 1;

  let sideDistX = dirX < 0 ? (originX - mapX) * deltaX : (mapX + 1 - originX) * deltaX;
  let sideDistY = dirY < 0 ? (originY - mapY) * deltaY : (mapY + 1 - originY) * deltaY;

  let side: 0 | 1 = 0;

  for (let step = 0; step < 4096; step += 1) {
    if (sideDistX < sideDistY) {
      sideDistX += deltaX;
      mapX += stepX;
      side = 0;
    } else {
      sideDistY += deltaY;
      mapY += stepY;
      side = 1;
    }

    if (mapX < 0 || mapY < 0 || mapX >= world.width || mapY >= world.height) {
      return null;
    }

    const tile = world.tiles[mapY * world.width + mapX];
    if (tile !== 0) {
      const distance =
        side === 0 ? sideDistX - deltaX : sideDistY - deltaY;
      if (distance > maxDistance) return null;

      let wallU =
        side === 0
          ? originY + distance * dirY
          : originX + distance * dirX;
      wallU -= Math.floor(wallU);
      if (side === 0 && dirX > 0) wallU = 1 - wallU;
      if (side === 1 && dirY < 0) wallU = 1 - wallU;

      return { distance, side, mapX, mapY, tile, wallU };
    }
  }

  return null;
}
