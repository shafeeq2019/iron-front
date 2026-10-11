import { SCAN_INTERVAL, TICK_RATE, TILE } from '../constants';
import type { UnitDef } from '../data/defs';
import { ARMOR_TABLE, WEAPONS, type Warhead, type WeaponDef } from '../data/weapons';
import type { Game } from './game';
import { nearestPerimeterPoint } from './util';
import { distToEntity } from './grid';
import { issueMove, turnToward } from './movement';
import type { Entity } from './types';

export interface Projectile {
  owner: number;
  sourceId: number;
  w: WeaponDef;
  x: number;
  y: number;
  tx: number;
  ty: number;
  targetId: number;
  ticks: number;
}

const LEASH = TILE * 7;

function canSee(game: Game, owner: number, t: Entity, forced: boolean): boolean {
  if (game.visibleTo(owner, t)) return true;
  return forced && t.kind === 'building' && game.players[owner].known.has(t.id);
}

function validTarget(game: Game, e: Entity, t: Entity | undefined, forced: boolean): t is Entity {
  if (!t || t.dead) return false;
  if (game.isAllied(e.owner, t.owner)) return false;
  if (!forced && !game.areEnemies(e.owner, t.owner)) return false;
  return canSee(game, e.owner, t, forced);
}

/** Finds the best enemy target within radius px. */
export function acquireTarget(game: Game, e: Entity, radius: number, w: WeaponDef): Entity | undefined {
  let best: Entity | undefined, bs = Infinity;
  const minR = (w.minRange ?? 0) * TILE;
  game.hash.query(e.x, e.y, radius + 48, (t) => {
    if (t.dead || !game.areEnemies(e.owner, t.owner)) return;
    const d = distToEntity(e.x, e.y, t);
    if (d > radius) return;
    if (minR && Math.hypot(t.x - e.x, t.y - e.y) < minR) return;
    if (!game.visibleTo(e.owner, t)) return;
    let score = d;
    if (t.kind === 'building') score += t.def.weapon ? 60 : 220;
    else if (!t.def.weapon) score += 90;
    if (ARMOR_TABLE[w.warhead][t.def.armor] < 0.5) score += 160;
    if (score < bs) { bs = score; best = t; }
  });
  return best;
}

/** Combat behaviour for armed units and defensive structures. */
export function updateCombatEntity(game: Game, e: Entity) {
  const w = WEAPONS[e.def.weapon!];
  if (!w) return;
  const isBuilding = e.kind === 'building';
  const slow = isBuilding && e.owner >= 0 && game.lowPower(e.owner);
  if (e.cooldown > 0) e.cooldown -= slow ? 0.5 : 1;
  const order = e.order.type;
  const forced = order === 'attack';
  let target = e.targetId ? game.get(e.targetId) : undefined;
  if (target && !validTarget(game, e, target, forced)) {
    target = undefined;
    e.targetId = 0;
  }

  // Remaining shots of a burst.
  if (e.burstLeft > 0 && --e.burstTimer <= 0) {
    e.burstLeft--;
    e.burstTimer = w.burstDelay ?? 4;
    if (target && distToEntity(e.x, e.y, target) <= w.range * TILE + 8) shoot(game, e, target, w);
  }

  if (!isBuilding && forced && !target) {
    e.order = { type: 'idle' };
    e.guardX = e.x; e.guardY = e.y;
    e.path = []; e.moving = false; e.needsPath = false;
    return;
  }

  const range = w.range * TILE;
  const def = e.def as UnitDef;
  if (!target && (game.tick + e.id) % SCAN_INTERVAL === 0) {
    let r = 0;
    if (isBuilding) r = range;
    else if (order === 'idle' || order === 'guard') r = Math.max(range, def.vision * TILE * 0.8);
    else if (order === 'attackMove') r = Math.max(range, def.vision * TILE);
    else if (order === 'move' && def.hasTurret) r = range;
    if (r > 0) {
      target = acquireTarget(game, e, r, w);
      if (target) { e.targetId = target.id; e.repathTimer = 0; }
    }
  }

  if (!target) {
    if (!isBuilding) {
      if (order === 'attackMove' && !e.moving && !e.needsPath && e.order.x !== undefined) {
        if (Math.hypot(e.order.x - e.x, e.order.y! - e.y) > TILE) issueMove(game, e, e.order.x, e.order.y!);
        else { e.order = { type: 'idle' }; e.guardX = e.x; e.guardY = e.y; }
      } else if (order === 'idle' && !e.moving && !e.needsPath && Math.hypot(e.guardX - e.x, e.guardY - e.y) > TILE * 2.5) {
        issueMove(game, e, e.guardX, e.guardY);
      }
    }
    return;
  }

  const d = distToEntity(e.x, e.y, target);
  const centerD = Math.hypot(target.x - e.x, target.y - e.y);
  const minR = (w.minRange ?? 0) * TILE;
  const inRange = d <= range && centerD >= minR;
  if (inRange) {
    if (!isBuilding && order !== 'move') {
      e.path = []; e.moving = false; e.needsPath = false;
    }
    aimAndFire(game, e, target, w);
    return;
  }
  if (isBuilding) { e.targetId = 0; return; }
  if (order === 'move') { e.targetId = 0; return; }
  if (centerD < minR) {
    // Too close for artillery: back off along the line away from the target.
    if (!e.moving && !e.needsPath) {
      const a = Math.atan2(e.y - target.y, e.x - target.x);
      issueMove(game, e, e.x + Math.cos(a) * (minR + TILE), e.y + Math.sin(a) * (minR + TILE));
    }
    return;
  }
  if (order === 'idle' || order === 'guard') {
    if (Math.hypot(e.x - e.guardX, e.y - e.guardY) > LEASH) {
      e.targetId = 0;
      issueMove(game, e, e.guardX, e.guardY);
      return;
    }
  }
  // Chase.
  if (--e.repathTimer <= 0 || (!e.moving && !e.needsPath)) {
    e.repathTimer = 15;
    const goal = target.kind === 'building' ? nearestPerimeterPoint(game, target, e.x, e.y) : { x: target.x, y: target.y };
    const pg = e.pathGoal;
    if (!pg || Math.hypot(pg.x - goal.x, pg.y - goal.y) > TILE || !e.moving) issueMove(game, e, goal.x, goal.y);
  }
}

function aimAndFire(game: Game, e: Entity, t: Entity, w: WeaponDef) {
  const desired = Math.atan2(t.y - e.y, t.x - e.x);
  let aligned = true;
  if (e.kind === 'building') {
    if (e.def.kind === 'building' && e.def.hasTurret) {
      e.turretAngle = turnToward(e.turretAngle, desired, 0.14);
      aligned = Math.abs(normAngle(e.turretAngle - desired)) < 0.12;
    } else e.turretAngle = desired;
  } else {
    const def = e.def as UnitDef;
    if (def.hasTurret) {
      e.turretAngle = turnToward(e.turretAngle, desired, 0.16);
      aligned = Math.abs(normAngle(e.turretAngle - desired)) < 0.15;
    } else if (def.category === 'vehicle') {
      e.angle = turnToward(e.angle, desired, def.turnRate);
      e.turretAngle = e.angle;
      aligned = Math.abs(normAngle(e.angle - desired)) < 0.15;
    } else {
      e.angle = desired;
      e.turretAngle = desired;
    }
  }
  if (aligned && e.cooldown <= 0 && e.burstLeft <= 0) {
    shoot(game, e, t, w);
    e.cooldown = w.cooldown;
    if (w.burst && w.burst > 1) {
      e.burstLeft = w.burst - 1;
      e.burstTimer = w.burstDelay ?? 4;
    }
  }
}

function normAngle(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function shoot(game: Game, e: Entity, t: Entity, w: WeaponDef) {
  const aim = e.turretAngle;
  const muzzle = e.kind === 'building' ? e.w * TILE * 0.35 : e.radius * 0.9;
  const sx = e.x + Math.cos(aim) * muzzle, sy = e.y + Math.sin(aim) * muzzle;
  if (w.projectile === 'arc') {
    const pts = [sx, sy - 10, t.x, t.y];
    applyDamage(game, t, w.damage, w.warhead, e.owner, e.id);
    const hit = new Set([t.id]);
    let last = t;
    let dmg = w.damage;
    for (let c = 0; c < (w.chain ?? 0); c++) {
      dmg *= 0.6;
      let next: Entity | undefined, nd = Infinity;
      game.hash.query(last.x, last.y, TILE * 3, (o) => {
        if (o.dead || hit.has(o.id) || !game.areEnemies(e.owner, o.owner) || o.kind !== 'unit') return;
        const d = Math.hypot(o.x - last.x, o.y - last.y);
        if (d < TILE * 3 && d < nd) { nd = d; next = o; }
      });
      if (!next) break;
      const n: Entity = next;
      hit.add(n.id);
      pts.push(n.x, n.y);
      applyDamage(game, n, dmg, w.warhead, e.owner, e.id);
      last = n;
    }
    game.emit({ e: 'arc', pts: pts.map(Math.round) });
    return;
  }
  let tx = t.x, ty = t.y;
  if (w.scatter) {
    const a = game.rng.next() * Math.PI * 2, r = game.rng.next() * w.scatter;
    tx += Math.cos(a) * r; ty += Math.sin(a) * r;
  }
  if (w.speed === 0) {
    applyDamage(game, t, w.damage, w.warhead, e.owner, e.id);
    game.emit({ e: 'fire', id: e.id, w: w.id, x: Math.round(sx), y: Math.round(sy), tx: Math.round(tx), ty: Math.round(ty), travel: 0, o: e.owner });
    return;
  }
  const dist = Math.hypot(tx - sx, ty - sy);
  const ticks = Math.max(1, Math.ceil(dist / w.speed));
  game.projectiles.push({ owner: e.owner, sourceId: e.id, w, x: sx, y: sy, tx, ty, targetId: w.projectile === 'artillery' ? 0 : t.id, ticks });
  game.emit({ e: 'fire', id: e.id, w: w.id, x: Math.round(sx), y: Math.round(sy), tx: Math.round(tx), ty: Math.round(ty), travel: ticks, o: e.owner });
}

export function updateProjectiles(game: Game) {
  const keep: Projectile[] = [];
  for (const p of game.projectiles) {
    if (p.targetId) {
      const t = game.get(p.targetId);
      if (t) { p.tx = t.x; p.ty = t.y; }
    }
    if (--p.ticks > 0) { keep.push(p); continue; }
    if (p.w.splash > 0) {
      splash(game, p.tx, p.ty, p.w, p.owner, p.sourceId);
    } else if (p.targetId) {
      const t = game.get(p.targetId);
      if (t) applyDamage(game, t, p.w.damage, p.w.warhead, p.owner, p.sourceId);
    }
    game.emit({ e: 'hit', x: Math.round(p.tx), y: Math.round(p.ty), w: p.w.id });
  }
  game.projectiles = keep;
}

function splash(game: Game, x: number, y: number, w: WeaponDef, owner: number, sourceId: number) {
  const victims: [Entity, number][] = [];
  game.hash.query(x, y, w.splash + TILE * 2, (e) => {
    if (e.dead || game.isAllied(owner, e.owner) || e.owner < 0) return;
    const d = distToEntity(x, y, e);
    if (d <= w.splash) victims.push([e, d]);
  });
  for (const [e, d] of victims) applyDamage(game, e, w.damage * (1 - (0.5 * d) / w.splash), w.warhead, owner, sourceId);
}

export function applyDamage(game: Game, t: Entity, amount: number, warhead: Warhead, attackerOwner: number, sourceId: number) {
  if (t.dead) return;
  const dmg = amount * ARMOR_TABLE[warhead][t.def.armor];
  t.hp -= dmg;
  t.lastHit = game.tick;
  t.lastAttacker = attackerOwner;
  if (t.owner >= 0 && attackerOwner >= 0 && game.areEnemies(t.owner, attackerOwner)) {
    const pl = game.players[t.owner];
    if (game.tick - pl.lastAttackNotice > TICK_RATE * 15) {
      pl.lastAttackNotice = game.tick;
      game.notice(t.owner, 'baseAttack', { x: Math.round(t.x), y: Math.round(t.y) });
    }
    // Idle armed units retaliate.
    if (t.kind === 'unit' && t.def.weapon && !t.targetId && (t.order.type === 'idle' || t.order.type === 'guard')) {
      const src = game.get(sourceId);
      if (src && game.visibleTo(t.owner, src)) t.targetId = src.id;
    }
  }
  if (t.hp <= 0) killEntity(game, t, attackerOwner);
}

export function killEntity(game: Game, e: Entity, killer: number) {
  if (e.dead) return;
  e.hp = 0;
  game.removeEntity(e);
  game.emit({ e: 'death', id: e.id, type: e.type, x: Math.round(e.x), y: Math.round(e.y), o: e.owner });
  if (e.owner >= 0) {
    const pl = game.players[e.owner];
    if (e.kind === 'unit') {
      pl.stats.unitsLost++;
      game.notice(e.owner, 'unitLost', { x: Math.round(e.x), y: Math.round(e.y), type: e.type });
    } else {
      pl.stats.buildingsLost++;
      game.notice(e.owner, 'buildingLost', { x: Math.round(e.x), y: Math.round(e.y), type: e.type });
    }
  }
  if (killer >= 0 && killer !== e.owner) game.players[killer].stats.kills++;
}

export const TICKS_PER_SECOND = TICK_RATE;
