import { TILE } from '../constants';
import type { BuildingDef } from '../data/defs';
import type { Game } from './game';
import { distToEntity } from './grid';
import { issueMove } from './movement';
import type { Entity } from './types';
import { HARVESTER_CAPACITY, nearestPerimeterPoint } from './util';

const MINE_INTERVAL = 8;
const MINE_AMOUNT = 25;
const UNLOAD_RATE = 35;

function tileCenter(game: Game, i: number) {
  const w = game.map.width;
  return { x: (i % w) * TILE + TILE / 2, y: Math.floor(i / w) * TILE + TILE / 2 };
}

/** Finds the closest unclaimed ore tile, searching outward from `from`. */
export function findOre(game: Game, u: Entity, from: number, maxR = 45): number {
  const w = game.map.width, h = game.map.height;
  const fx = from % w, fy = Math.floor(from / w);
  const claimed = new Set<number>();
  for (const o of game.list) {
    if (o.dead || o === u || o.owner !== u.owner || o.def.kind !== 'unit' || !o.def.harvester) continue;
    if (o.hState === 'toOre' || o.hState === 'mining') claimed.add(o.oreTile);
  }
  let best = -1, bs = Infinity;
  for (let r = 0; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = fx + dx, y = fy + dy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const i = y * w + x;
        if (game.ore[i] <= 0 || !game.grid.passableIdx(i)) continue;
        const c = tileCenter(game, i);
        const s = Math.hypot(c.x - u.x, c.y - u.y) * 0.5 + r * TILE + (claimed.has(i) ? TILE * 6 : 0);
        if (s < bs) { bs = s; best = i; }
      }
    // Once something is found, look one more ring for a better option then stop.
    if (best >= 0 && r > 0 && bs < (r + 1) * TILE * 1.6) break;
  }
  return best;
}

function nearestRefinery(game: Game, u: Entity): Entity | undefined {
  let best: Entity | undefined, bd = Infinity;
  for (const e of game.list) {
    if (e.dead || e.owner !== u.owner || e.kind !== 'building' || !(e.def as BuildingDef).refinery || e.built < 1) continue;
    const d = Math.hypot(e.x - u.x, e.y - u.y);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

function dockPoint(game: Game, r: Entity) {
  return nearestPerimeterPoint(game, r, r.x, (r.ty + r.h) * TILE + TILE / 2);
}

export function updateHarvester(game: Game, u: Entity) {
  if (u.timer > 0) u.timer--;
  switch (u.hState) {
    case 'idle':
      return;
    case 'seek': {
      if (u.timer > 0) return;
      if (u.cargo >= HARVESTER_CAPACITY) { u.hState = 'toRefinery'; return; }
      const from = u.oreTile >= 0 ? u.oreTile : Math.floor(u.y / TILE) * game.map.width + Math.floor(u.x / TILE);
      const t = findOre(game, u, from);
      if (t < 0) {
        if (u.cargo > 0) u.hState = 'toRefinery';
        else u.timer = 60;
        return;
      }
      u.oreTile = t;
      u.hState = 'toOre';
      const c = tileCenter(game, t);
      issueMove(game, u, c.x, c.y);
      return;
    }
    case 'toOre': {
      if (game.ore[u.oreTile] <= 0) { u.hState = 'seek'; return; }
      const c = tileCenter(game, u.oreTile);
      const d = Math.hypot(c.x - u.x, c.y - u.y);
      if (d < 14 || (!u.moving && !u.needsPath && d < TILE * 1.3)) {
        u.hState = 'mining';
        u.path = []; u.moving = false; u.needsPath = false;
        u.timer = MINE_INTERVAL;
        return;
      }
      if (!u.moving && !u.needsPath) {
        // Could not reach the tile (crowded/blocked): choose another one nearby.
        const t = findOre(game, u, Math.floor(u.y / TILE) * game.map.width + Math.floor(u.x / TILE));
        if (t < 0 || t === u.oreTile) { u.hState = 'seek'; u.oreTile = -1; u.timer = 20; return; }
        u.oreTile = t;
        const n = tileCenter(game, t);
        issueMove(game, u, n.x, n.y);
      }
      return;
    }
    case 'mining': {
      if (u.timer > 0) return;
      u.timer = MINE_INTERVAL;
      const i = u.oreTile;
      if (game.ore[i] <= 0) {
        u.hState = 'seek';
        return;
      }
      const take = Math.min(MINE_AMOUNT, game.ore[i], HARVESTER_CAPACITY - u.cargo);
      game.ore[i] -= take;
      u.cargo += take;
      game.oreChanged.push(i);
      u.angle += 0.08; // gentle sweeping animation
      if (u.cargo >= HARVESTER_CAPACITY) u.hState = 'toRefinery';
      else if (game.ore[i] <= 0) u.hState = 'seek';
      return;
    }
    case 'toRefinery': {
      let r = u.dockId ? game.get(u.dockId) : undefined;
      if (!r || r.owner !== u.owner || !(r.def as BuildingDef).refinery) r = nearestRefinery(game, u);
      if (!r) { u.timer = 40; u.dockId = 0; return; }
      u.dockId = r.id;
      const d = distToEntity(u.x, u.y, r);
      if (d < 22) {
        const lock = r.targetId ? game.get(r.targetId) : undefined;
        if (lock && lock !== u && lock.hState === 'unloading' && lock.dockId === r.id) {
          u.hState = 'waitDock';
          u.path = []; u.moving = false;
          return;
        }
        r.targetId = u.id;
        u.hState = 'unloading';
        u.path = []; u.moving = false; u.needsPath = false;
        return;
      }
      if (!u.moving && !u.needsPath) {
        if (u.timer > 0) return;
        const p = dockPoint(game, r);
        issueMove(game, u, p.x, p.y);
        u.timer = 10;
      }
      return;
    }
    case 'waitDock': {
      const r = game.get(u.dockId);
      if (!r) { u.hState = 'toRefinery'; u.dockId = 0; return; }
      const lock = r.targetId ? game.get(r.targetId) : undefined;
      if (!lock || lock.hState !== 'unloading' || lock.dockId !== r.id) u.hState = 'toRefinery';
      return;
    }
    case 'unloading': {
      const r = game.get(u.dockId);
      if (!r || r.owner !== u.owner) { u.hState = 'toRefinery'; u.dockId = 0; return; }
      const amt = Math.min(u.cargo, UNLOAD_RATE);
      u.cargo -= amt;
      const pl = game.players[u.owner];
      pl.credits += amt;
      pl.stats.creditsEarned += amt;
      if (u.cargo <= 0) {
        u.cargo = 0;
        if (r.targetId === u.id) r.targetId = 0;
        u.hState = 'seek';
      }
      return;
    }
  }
}
