import { TILE } from '../constants';
import type { Game } from './game';
import type { Entity, Vec } from './types';

export const HARVESTER_CAPACITY = 700;
export const MAX_QUEUE_ITEMS = 9;

/** Point just outside a building's footprint, nearest to (x,y), on a passable tile if possible. */
export function nearestPerimeterPoint(game: Game, b: Entity, x: number, y: number): Vec {
  let best: Vec | null = null, bd = Infinity;
  for (let ty = b.ty - 1; ty <= b.ty + b.h; ty++)
    for (let tx = b.tx - 1; tx <= b.tx + b.w; tx++) {
      if (tx >= b.tx && tx < b.tx + b.w && ty >= b.ty && ty < b.ty + b.h) continue;
      if (!game.grid.passable(tx, ty)) continue;
      const px = tx * TILE + TILE / 2, py = ty * TILE + TILE / 2;
      const d = Math.hypot(px - x, py - y);
      if (d < bd) { bd = d; best = { x: px, y: py }; }
    }
  return best ?? { x: b.x, y: (b.ty + b.h) * TILE + TILE / 2 };
}
