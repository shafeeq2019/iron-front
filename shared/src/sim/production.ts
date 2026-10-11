import { TILE } from '../constants';
import { BUILDINGS, UNITS, type BuildingDef, type QueueCategory } from '../data/defs';
import type { Game } from './game';
import { issueMove } from './movement';
import type { Entity } from './types';

const PRODUCER: Record<QueueCategory, string> = { building: 'hq', defense: 'hq', infantry: 'barracks', vehicle: 'factory' };

export function recomputePower(game: Game) {
  game.powerDirty = false;
  for (const p of game.players) {
    p.powerProduced = 0;
    p.powerUsed = 0;
  }
  for (const e of game.list) {
    if (e.dead || e.kind !== 'building' || e.owner < 0 || e.built < 1) continue;
    const pw = (e.def as BuildingDef).power;
    const pl = game.players[e.owner];
    if (pw > 0) pl.powerProduced += pw;
    else pl.powerUsed -= pw;
  }
  for (const p of game.players) {
    if (p.powerUsed > p.powerProduced && game.tick - p.lastLowPowerNotice > 20 * 20) {
      p.lastLowPowerNotice = game.tick;
      game.notice(p.id, 'lowPower');
    }
  }
}

/** Called when a structure finishes its construction animation. */
export function completeBuildingConstruction(game: Game, b: Entity) {
  game.powerDirty = true;
  const def = b.def as BuildingDef;
  if (def.refinery && b.owner >= 0 && game.tick > 0) {
    const p = (b.ty + b.h) * TILE + TILE / 2;
    const h = game.spawnUnit('harvester', b.owner, b.x, p);
    h.order = { type: 'harvest' };
    h.hState = 'seek';
    h.dockId = b.id;
    game.players[b.owner].stats.unitsBuilt--; // free unit, not "built"
  }
}

function producers(game: Game, p: number, type: string): Entity[] {
  const out: Entity[] = [];
  for (const e of game.list) if (!e.dead && e.owner === p && e.type === type && e.built >= 1) out.push(e);
  return out;
}

export function updateProduction(game: Game) {
  for (const pl of game.players) {
    if (pl.defeated) continue;
    const low = pl.powerUsed > pl.powerProduced;
    for (const cat of ['building', 'defense', 'infantry', 'vehicle'] as QueueCategory[]) {
      const q = pl.queues[cat];
      const item = q.items[0];
      if (!item) continue;
      const prods = producers(game, pl.id, PRODUCER[cat]);
      if (!prods.length) continue; // on hold
      const rate = (low ? 0.5 : 1) * Math.min(2, 1 + 0.25 * (prods.length - 1));
      item.progress += rate;
      if (item.progress < item.total) continue;
      if (cat === 'building' || cat === 'defense') {
        q.items.shift();
        q.ready = item.type;
        game.notice(pl.id, 'constructionComplete', { type: item.type });
        continue;
      }
      // Unit: spawn at the producer closest to its rally point (or the first one).
      const def = UNITS[item.type];
      const src = prods.find((b) => b.hasRally) ?? prods[0];
      const ex = src.x;
      const ey = (src.ty + src.h) * TILE + (def.category === 'vehicle' ? TILE * 0.6 : TILE * 0.4);
      const u = game.spawnUnit(item.type, pl.id, ex, ey);
      u.angle = Math.PI / 2;
      u.turretAngle = Math.PI / 2;
      q.items.shift();
      game.notice(pl.id, 'unitReady', { type: item.type });
      if (def.harvester) {
        u.order = { type: 'harvest' };
        u.hState = 'seek';
      } else if (src.hasRally) {
        u.order = { type: def.weapon ? 'attackMove' : 'move', x: src.rallyX, y: src.rallyY };
        issueMove(game, u, src.rallyX + (game.rng.next() - 0.5) * TILE * 2, src.rallyY + (game.rng.next() - 0.5) * TILE * 2);
      } else {
        const ox = (game.rng.next() - 0.5) * TILE * 3;
        u.order = { type: 'move', x: ex + ox, y: ey + TILE * 1.8 };
        issueMove(game, u, ex + ox, ey + TILE * 1.8);
      }
    }
  }
}

/** Static info used by UIs: what a player could build right now. */
export function buildOptions(game: Game, p: number, cat: QueueCategory) {
  const fac = game.players[p].faction;
  const defs = cat === 'building' || cat === 'defense'
    ? Object.values(BUILDINGS).filter((d) => d.category === cat && !d.unbuildable)
    : Object.values(UNITS).filter((d) => d.category === cat);
  return defs.filter((d) => !d.factions || d.factions.includes(fac)).map((d) => ({ def: d, available: game.prereqsMet(p, d) }));
}
