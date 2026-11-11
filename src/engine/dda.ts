import { tileHeightAt, type World } from "./world";

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

export interface RayCellHit extends RayHit {
  /** Top surface height of the hit cell. */
  height: number;
  /** Distance at which the ray leaves the cell. */
  exitDistance: number;
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

/**
 * Traverses until the map edge and returns every solid cell the ray enters,
 * near to far. Low platforms must not hide taller geometry behind them, so the
 * renderer needs all hits rather than just the first.
 */
export function castRayHits(
  world: World,
  originX: number,
  originY: number,
  dirX: number,
  dirY: number,
  maxDistance = 64,
): RayCellHit[] {
  const hits: RayCellHit[] = [];
  let mapX = Math.floor(originX);
  let mapY = Math.floor(originY);

  const deltaX = dirX === 0 ? Infinity : Math.abs(1 / dirX);
  const deltaY = dirY === 0 ? Infinity : Math.abs(1 / dirY);

  const stepX = dirX < 0 ? -1 : 1;
  const stepY = dirY < 0 ? -1 : 1;

  let sideDistX = dirX < 0 ? (originX - mapX) * deltaX : (mapX + 1 - originX) * deltaX;
  let sideDistY = dirY < 0 ? (originY - mapY) * deltaY : (mapY + 1 - originY) * deltaY;

  let pending: RayCellHit | null = null;

  // When the camera stands on a solid cell (a wall top, crate or platform), its
  // own top is never entered by the DDA. Emit it at distance 0 so steep
  // downward rays still have a surface to land on instead of showing sky.
  if (
    mapX >= 0 &&
    mapY >= 0 &&
    mapX < world.width &&
    mapY < world.height
  ) {
    const originTile = world.tiles[mapY * world.width + mapX];
    if (originTile !== 0) {
      const originHit: RayCellHit = {
        distance: 0,
        side: 0,
        mapX,
        mapY,
        tile: originTile,
        wallU: originX - Math.floor(originX),
        height: tileHeightAt(world, mapX + 0.5, mapY + 0.5),
        exitDistance: 0,
      };
      hits.push(originHit);
      pending = originHit;
    }
  }

  for (let step = 0; step < 4096; step += 1) {
    let distance: number;
    let side: 0 | 1;
    if (sideDistX < sideDistY) {
      distance = sideDistX;
      sideDistX += deltaX;
      mapX += stepX;
      side = 0;
    } else {
      distance = sideDistY;
      sideDistY += deltaY;
      mapY += stepY;
      side = 1;
    }

    if (pending) {
      pending.exitDistance = distance;
      pending = null;
    }
    if (distance > maxDistance) break;
    if (mapX < 0 || mapY < 0 || mapX >= world.width || mapY >= world.height) {
      break;
    }

    const tile = world.tiles[mapY * world.width + mapX];
    if (tile === 0) continue;

    let wallU =
      side === 0
        ? originY + distance * dirY
        : originX + distance * dirX;
    wallU -= Math.floor(wallU);
    if (side === 0 && dirX > 0) wallU = 1 - wallU;
    if (side === 1 && dirY < 0) wallU = 1 - wallU;

    const hit: RayCellHit = {
      distance,
      side,
      mapX,
      mapY,
      tile,
      wallU,
      height: tileHeightAt(world, mapX + 0.5, mapY + 0.5),
      exitDistance: distance,
    };
    hits.push(hit);
    pending = hit;
  }

  if (pending) pending.exitDistance = Math.min(maxDistance, pending.distance + 1);
  return hits;
}
