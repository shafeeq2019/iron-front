import { TILE } from '../constants';
import type { UnitDef } from '../data/defs';
import type { Game } from './game';
import type { Entity, Vec } from './types';

/** True if a unit of radius r can stand at (x,y). */
export function freeAt(game: Game, x: number, y: number, r: number): boolean {
  const g = game.grid;
  if (!g.passableWorld(x, y)) return false;
  const k = r * 0.6;
  return g.passableWorld(x + k, y) && g.passableWorld(x - k, y) && g.passableWorld(x, y + k) && g.passableWorld(x, y - k);
}

/** Requests movement to a world point. Uses a straight line when clear, otherwise queues an A* search. */
export function issueMove(game: Game, u: Entity, x: number, y: number) {
  x = Math.max(TILE, Math.min(game.worldW - TILE, x));
  y = Math.max(TILE, Math.min(game.worldH - TILE, y));
  u.pathGoal = { x, y };
  u.stuckCount = 0;
  u.stuckTicks = 0;
  u.lastProgressX = u.x;
  u.lastProgressY = u.y;
  const dist = Math.hypot(x - u.x, y - u.y);
  if (dist < 1) {
    u.path = []; u.moving = false; u.needsPath = false;
    return;
  }
  if (freeAt(game, x, y, u.radius) && game.grid.lineClear(u.x, u.y, x, y, Math.min(u.radius, 10))) {
    u.path = [{ x, y }];
    u.pathIdx = 0;
    u.moving = true;
    u.needsPath = false;
    return;
  }
  u.path = [];
  u.moving = true;
  if (!u.needsPath) {
    u.needsPath = true;
    game.pathQueue.push(u);
  }
}

function angleDiff(a: number, b: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function turnToward(cur: number, target: number, rate: number): number {
  const d = angleDiff(cur, target);
  if (Math.abs(d) <= rate) return target;
  return cur + Math.sign(d) * rate;
}

/** Advances a unit along its path for one tick. */
export function moveUnit(game: Game, u: Entity) {
  if (u.needsPath) return;
  if (!u.path.length || u.pathIdx >= u.path.length) {
    u.moving = false;
    return;
  }
  const def = u.def as UnitDef;
  const wp = u.path[u.pathIdx];
  const final = u.pathIdx === u.path.length - 1;
  const dx = wp.x - u.x, dy = wp.y - u.y;
  const dist = Math.hypot(dx, dy);
  const arriveR = final ? Math.max(2, u.speed * 0.6) : Math.max(10, u.speed * 1.5);
  if (dist <= arriveR) {
    u.pathIdx++;
    if (u.pathIdx >= u.path.length) {
      u.moving = false;
      u.path = [];
      onArrive(u);
    }
    return;
  }
  const heading = Math.atan2(dy, dx);
  let speed = u.speed;
  if (def.category === 'vehicle') {
    u.angle = turnToward(u.angle, heading, def.turnRate);
    const off = Math.abs(angleDiff(u.angle, heading));
    if (off > 1.0) speed = 0;
    else speed *= Math.cos(off);
    if (!def.hasTurret) u.turretAngle = u.angle;
  } else {
    u.angle = heading;
  }
  const step = Math.min(speed, dist);
  if (step > 0) {
    const mx = Math.cos(def.category === 'vehicle' ? u.angle : heading) * step;
    const my = Math.sin(def.category === 'vehicle' ? u.angle : heading) * step;
    if (freeAt(game, u.x + mx, u.y + my, u.radius)) { u.x += mx; u.y += my; }
    else if (freeAt(game, u.x + mx, u.y, u.radius)) u.x += mx;
    else if (freeAt(game, u.x, u.y + my, u.radius)) u.y += my;
  }
  // Stuck detection: check progress every 20 ticks.
  if (++u.stuckTicks >= 20) {
    u.stuckTicks = 0;
    const moved = Math.hypot(u.x - u.lastProgressX, u.y - u.lastProgressY);
    u.lastProgressX = u.x;
    u.lastProgressY = u.y;
    if (moved < u.speed * 4) {
      u.stuckCount++;
      const goal = u.pathGoal ?? u.path[u.path.length - 1];
      const gd = goal ? Math.hypot(goal.x - u.x, goal.y - u.y) : 0;
      // Close enough (crowded destination): accept arrival.
      if (gd < TILE * 1.5 + u.stuckCount * TILE * 0.5 || u.stuckCount > 6) {
        u.path = [];
        u.moving = false;
        u.stuckCount = 0;
        onArrive(u);
        return;
      }
      if (goal && u.stuckCount % 2 === 0) {
        const keep = u.stuckCount;
        issueMove(game, u, goal.x, goal.y);
        u.stuckCount = keep;
      }
    } else if (u.stuckCount > 0 && moved > u.speed * 10) {
      u.stuckCount = 0;
    }
  }
}

function onArrive(u: Entity) {
  if (u.order.type === 'move' || u.order.type === 'attackMove') {
    u.order = { type: 'idle' };
    u.guardX = u.x;
    u.guardY = u.y;
  }
}

/** Pushes overlapping units apart and nudges units out of blocked tiles. */
export function applySeparation(game: Game) {
  for (const u of game.list) {
    if (u.dead || u.kind !== 'unit') continue;
    if (!game.grid.passableWorld(u.x, u.y)) {
      const t = game.grid.nearestPassable(Math.floor(u.x / TILE), Math.floor(u.y / TILE), 6);
      if (t) {
        const tx = t.x * TILE + TILE / 2, ty = t.y * TILE + TILE / 2;
        const d = Math.hypot(tx - u.x, ty - u.y) || 1;
        const s = Math.min(d, 3);
        u.x += ((tx - u.x) / d) * s;
        u.y += ((ty - u.y) / d) * s;
      }
      continue;
    }
    game.hash.query(u.x, u.y, u.radius + 16, (o) => {
      if (o.id <= u.id || o.dead || o.kind !== 'unit') return;
      const min = (u.radius + o.radius) * 0.8;
      let dx = o.x - u.x, dy = o.y - u.y;
      let d = Math.hypot(dx, dy);
      if (d >= min) return;
      if (d < 0.01) {
        const a = ((u.id * 7919 + o.id * 104729) % 628) / 100;
        dx = Math.cos(a); dy = Math.sin(a); d = 1;
      }
      const overlap = (min - d) * 0.5;
      const nx = dx / d, ny = dy / d;
      // Moving units shoulder idle ones aside; idle units yield more.
      let wu = 0.5, wo = 0.5;
      if (u.moving && !o.moving) { wu = 0.25; wo = 0.75; }
      else if (!u.moving && o.moving) { wu = 0.75; wo = 0.25; }
      const ux = u.x - nx * overlap * wu * 2, uy = u.y - ny * overlap * wu * 2;
      const ox = o.x + nx * overlap * wo * 2, oy = o.y + ny * overlap * wo * 2;
      if (freeAt(game, ux, uy, u.radius)) { u.x = ux; u.y = uy; }
      if (freeAt(game, ox, oy, o.radius)) { o.x = ox; o.y = oy; }
    });
  }
}

/** Spreads a group's destination into nearby free slots so units don't pile on one point. */
export function formationSlots(game: Game, units: Entity[], x: number, y: number): Vec[] {
  if (units.length === 1) return [{ x, y }];
  const avgR = units.reduce((s, u) => s + u.radius, 0) / units.length;
  const spacing = Math.max(16, avgR * 2.1);
  const slots: Vec[] = [];
  const need = units.length;
  for (let ring = 0; slots.length < need && ring < 40; ring++) {
    if (ring === 0) {
      if (freeAt(game, x, y, avgR)) slots.push({ x, y });
      continue;
    }
    const count = Math.max(6, Math.round(2 * Math.PI * ring));
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + ring * 0.5;
      const px = x + Math.cos(a) * ring * spacing, py = y + Math.sin(a) * ring * spacing;
      if (px < TILE || py < TILE || px > game.worldW - TILE || py > game.worldH - TILE) continue;
      if (!freeAt(game, px, py, avgR)) continue;
      slots.push({ x: px, y: py });
    }
  }
  while (slots.length < need) slots.push({ x, y });
  // Greedy assignment: units closest to the target pick first, each takes its nearest free slot.
  const order = units.map((u, i) => ({ u, i, d: Math.hypot(u.x - x, u.y - y) })).sort((a, b) => a.d - b.d);
  const taken = new Uint8Array(slots.length);
  const out: Vec[] = new Array(units.length);
  const usable = Math.min(slots.length, need + 4);
  for (const { u, i } of order) {
    let best = -1, bd = Infinity;
    for (let s = 0; s < usable; s++) {
      if (taken[s]) continue;
      const d = Math.hypot(slots[s].x - u.x, slots[s].y - u.y) + Math.hypot(slots[s].x - x, slots[s].y - y) * 1.5;
      if (d < bd) { bd = d; best = s; }
    }
    if (best < 0) best = 0;
    taken[best] = 1;
    out[i] = slots[best];
  }
  return out;
}
