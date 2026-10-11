import { TILE } from '../constants';
import { SWEEP_RADIUS } from '../data/factions';
import type { Game } from './game';

const circleCache = new Map<number, Int16Array>();
/** Precomputed (dx,dy) offsets inside a circle of radius r tiles. */
function circle(r: number): Int16Array {
  const key = Math.round(r * 2);
  let c = circleCache.get(key);
  if (c) return c;
  const rr = key / 2;
  const pts: number[] = [];
  const R = Math.ceil(rr);
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (dx * dx + dy * dy <= rr * rr + 0.5) pts.push(dx, dy);
  c = Int16Array.from(pts);
  circleCache.set(key, c);
  return c;
}

function stamp(vis: Uint8Array, w: number, h: number, cx: number, cy: number, r: number) {
  const c = circle(r);
  for (let k = 0; k < c.length; k += 2) {
    const x = cx + c[k], y = cy + c[k + 1];
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    vis[y * w + x] = 1;
  }
}

/** Recomputes visibility for all players and updates their memory of enemy structures. */
export function updateFog(game: Game) {
  const w = game.map.width, h = game.map.height;
  game.fogVersion++;
  for (const p of game.players) {
    p.visible.fill(0);
    if (p.defeated) {
      // Defeated players spectate with full vision.
      p.visible.fill(1);
      p.explored.fill(1);
      continue;
    }
  }
  for (const e of game.list) {
    if (e.dead || e.owner < 0) continue;
    const r = e.def.vision;
    const cx = Math.floor(e.x / TILE), cy = Math.floor(e.y / TILE);
    for (const p of game.players) {
      if (p.defeated || !game.isAllied(p.id, e.owner)) continue;
      stamp(p.visible, w, h, cx, cy, e.kind === 'building' ? r + Math.max(e.w, e.h) / 2 : r);
    }
  }
  for (const p of game.players) {
    if (p.defeated) continue;
    for (const s of p.sweeps) stamp(p.visible, w, h, Math.floor(s.x / TILE), Math.floor(s.y / TILE), SWEEP_RADIUS);
    const vis = p.visible, exp = p.explored;
    for (let i = 0; i < vis.length; i++) if (vis[i]) exp[i] = 1;
  }
  // Remember enemy/neutral structures; forget them once the spot is seen empty.
  for (const p of game.players) {
    for (const e of game.list) {
      if (e.dead || e.kind !== 'building' || game.isAllied(p.id, e.owner)) continue;
      if (game.visibleTo(p.id, e)) p.known.set(e.id, { id: e.id, type: e.type, owner: e.owner, tx: e.tx, ty: e.ty, hp: e.hp });
    }
    for (const [id, k] of p.known) {
      const e = game.entities.get(id);
      const stale = !e || e.dead || game.isAllied(p.id, e.owner);
      if (!stale && e) { if (e.owner !== k.owner && game.visibleTo(p.id, e)) k.owner = e.owner; continue; }
      // Only forget when the player can actually see the location.
      let seen = false;
      for (let y = k.ty; y < k.ty + 2 && !seen; y++) for (let x = k.tx; x < k.tx + 2; x++) if (p.visible[y * w + x]) { seen = true; break; }
      if (seen || (e && game.isAllied(p.id, e.owner))) p.known.delete(id);
    }
  }
}

export function isTileVisible(game: Game, p: number, x: number, y: number): boolean {
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  if (tx < 0 || ty < 0 || tx >= game.map.width || ty >= game.map.height) return false;
  return game.players[p].visible[ty * game.map.width + tx] > 0;
}
