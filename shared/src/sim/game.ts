import { BUILD_RADIUS, NEUTRAL, ORE_REGROW_INTERVAL, PATH_BUDGET, STARTING_CREDITS, TICK_RATE, TILE, FOG_INTERVAL } from '../constants';
import { BUILDINGS, DEFS, UNITS, isKnownType, type BuildingDef, type QueueCategory, type UnitDef } from '../data/defs';
import { FACTIONS, SWEEP_COOLDOWN_TICKS, SWEEP_DURATION_TICKS } from '../data/factions';
import { getMap, type MapDef } from '../maps/maps';
import { Rng } from '../rng';
import { updateCombatEntity, updateProjectiles, killEntity, type Projectile } from './combat';
import { updateHarvester } from './economy';
import { updateFog, isTileVisible } from './fog';
import { Grid, SpatialHash, distToEntity } from './grid';
import { PathFinder } from './pathfinding';
import { updateProduction, recomputePower, completeBuildingConstruction } from './production';
import type { Command, CommandResult, Entity, GameEvent, MatchResult, PlayerSetup, PlayerState, Queue, Vec } from './types';
import { applySeparation, moveUnit, issueMove, formationSlots } from './movement';
import { HARVESTER_CAPACITY, MAX_QUEUE_ITEMS, nearestPerimeterPoint } from './util';
export { HARVESTER_CAPACITY, MAX_QUEUE_ITEMS, nearestPerimeterPoint };

export interface GameOptions {
  mapId: string;
  players: PlayerSetup[];
  seed?: number;
  startingCredits?: number;
}

function makeQueue(category: QueueCategory): Queue {
  return { category, items: [], ready: null };
}

export class Game {
  readonly map: MapDef;
  readonly grid: Grid;
  readonly pf: PathFinder;
  readonly hash: SpatialHash;
  readonly rng: Rng;
  readonly worldW: number;
  readonly worldH: number;
  tick = 0;
  players: PlayerState[] = [];
  entities = new Map<number, Entity>();
  /** Insertion-ordered list for deterministic iteration; compacted when entities die. */
  list: Entity[] = [];
  nextId = 1;
  ore: Uint16Array;
  oreTiles: number[] = [];
  /** Tiles whose ore amount changed during the current tick. */
  oreChanged: number[] = [];
  events: GameEvent[] = [];
  projectiles: Projectile[] = [];
  result: MatchResult | null = null;
  pathQueue: Entity[] = [];
  fogVersion = 0;
  powerDirty = true;
  /** Disable for sandbox/tests where players have no base. */
  victoryEnabled = true;
  /** Optional hook called when a player is defeated. */
  onDefeat?: (p: PlayerState) => void;

  constructor(opts: GameOptions) {
    const map = getMap(opts.mapId);
    if (!map) throw new Error(`Unknown map ${opts.mapId}`);
    if (opts.players.length < 1 || opts.players.length > map.maxPlayers) throw new Error('Invalid player count for map');
    this.map = map;
    this.grid = new Grid(map);
    this.pf = new PathFinder(this.grid);
    this.worldW = map.width * TILE;
    this.worldH = map.height * TILE;
    this.hash = new SpatialHash(this.worldW, this.worldH);
    this.rng = new Rng(opts.seed ?? 12345);
    this.ore = map.ore.slice();
    for (let i = 0; i < this.ore.length; i++) if (map.oreMax[i] > 0) this.oreTiles.push(i);
    const n = map.width * map.height;
    const credits = opts.startingCredits ?? STARTING_CREDITS;

    opts.players.forEach((s, i) => {
      this.players.push({
        id: i,
        name: s.name,
        faction: s.faction,
        color: s.color,
        team: s.team,
        isAI: s.isAI,
        credits,
        powerProduced: 0,
        powerUsed: 0,
        defeated: false,
        queues: { building: makeQueue('building'), defense: makeQueue('defense'), infantry: makeQueue('infantry'), vehicle: makeQueue('vehicle') },
        stats: { unitsBuilt: 0, unitsLost: 0, buildingsBuilt: 0, buildingsLost: 0, kills: 0, creditsEarned: 0, creditsSpent: 0 },
        visible: new Uint8Array(n),
        explored: new Uint8Array(n),
        known: new Map(),
        sweepCooldown: SWEEP_COOLDOWN_TICKS / 2,
        sweeps: [],
        lastAttackNotice: -9999,
        lastLowPowerNotice: -9999,
      });
    });

    // Neutral extractors.
    for (const d of map.derricks) {
      for (let y = d.y; y < d.y + 2; y++) for (let x = d.x; x < d.x + 2; x++) {
        const i = y * map.width + x;
        this.grid.terrainPass[i] = 1;
        this.grid.terrainBuild[i] = 1;
        this.ore[i] = 0;
      }
      this.spawnBuilding('derrick', NEUTRAL, d.x, d.y, 1);
    }

    // Each player starts with an MCV, a few infantry and a light vehicle.
    // Start slots are shuffled deterministically so positions vary between matches.
    const slots = map.starts.map((_, i) => i);
    for (let i = slots.length - 1; i > 0; i--) {
      const j = this.rng.int(0, i);
      [slots[i], slots[j]] = [slots[j], slots[i]];
    }
    this.players.forEach((p, i) => {
      const s = map.starts[slots[i]];
      const cx = s.x * TILE + TILE / 2, cy = s.y * TILE + TILE / 2;
      this.spawnUnit('mcv', p.id, cx, cy);
      const tank = p.faction === 'cdc' ? 'lighttank' : 'raider';
      const toCenter = Math.atan2(this.worldH / 2 - cy, this.worldW / 2 - cx);
      const fx = Math.cos(toCenter), fy = Math.sin(toCenter);
      this.spawnUnit(tank, p.id, cx + fx * 3 * TILE, cy + fy * 3 * TILE);
      for (let k = 0; k < 4; k++) {
        const a = toCenter + (k - 1.5) * 0.35;
        this.spawnUnit(k === 3 ? 'rocket' : 'rifle', p.id, cx + Math.cos(a) * 4.5 * TILE, cy + Math.sin(a) * 4.5 * TILE);
      }
    });
    this.rebuildHash();
    updateFog(this);
  }

  startPositionOf(playerId: number): Vec {
    const p = this.players[playerId];
    const own = this.list.find((e) => e.owner === p.id && (e.type === 'hq' || e.type === 'mcv'));
    return own ? { x: own.x, y: own.y } : { x: this.worldW / 2, y: this.worldH / 2 };
  }

  // ---------------------------------------------------------------- entities

  private baseEntity(def: UnitDef | BuildingDef, owner: number, x: number, y: number): Entity {
    return {
      id: this.nextId++, kind: def.kind, type: def.id, def, owner, x, y,
      hp: def.hp, maxHp: def.hp, dead: false, lastHit: -9999, lastAttacker: -1,
      angle: Math.PI / 2, turretAngle: Math.PI / 2, cooldown: 0, burstLeft: 0, burstTimer: 0, targetId: 0,
      order: { type: 'idle' }, path: [], pathIdx: 0, needsPath: false, pathGoal: null, repathTimer: 0,
      stuckTicks: 0, stuckCount: 0, lastProgressX: x, lastProgressY: y, moving: false,
      guardX: x, guardY: y, speed: 0, radius: 0,
      cargo: 0, hState: 'idle', oreTile: -1, dockId: 0, timer: 0,
      tx: 0, ty: 0, w: 0, h: 0, built: 1, repairing: false, rallyX: 0, rallyY: 0, hasRally: false,
    };
  }

  spawnUnit(type: string, owner: number, x: number, y: number): Entity {
    const def = UNITS[type];
    if (!def) throw new Error(`Unknown unit ${type}`);
    const e = this.baseEntity(def, owner, x, y);
    const fac = owner >= 0 ? FACTIONS[this.players[owner].faction] : null;
    e.speed = (def.speed * TILE) / TICK_RATE * (def.category === 'vehicle' && fac ? fac.vehicleSpeed : 1);
    e.radius = def.radius;
    // Never spawn inside an obstacle.
    if (!this.grid.passableWorld(x, y)) {
      const t = this.grid.nearestPassable(Math.floor(x / TILE), Math.floor(y / TILE), 12);
      if (t) { e.x = t.x * TILE + TILE / 2; e.y = t.y * TILE + TILE / 2; }
    }
    e.guardX = e.x; e.guardY = e.y;
    if (def.harvester) e.hState = 'seek';
    this.add(e);
    if (owner >= 0) this.players[owner].stats.unitsBuilt++;
    return e;
  }

  spawnBuilding(type: string, owner: number, tx: number, ty: number, built = 0): Entity {
    const def = BUILDINGS[type];
    if (!def) throw new Error(`Unknown building ${type}`);
    const e = this.baseEntity(def, owner, (tx + def.w / 2) * TILE, (ty + def.h / 2) * TILE);
    e.tx = tx; e.ty = ty; e.w = def.w; e.h = def.h;
    e.built = built;
    const fac = owner >= 0 ? FACTIONS[this.players[owner].faction] : null;
    if (fac) { e.maxHp = Math.round(def.hp * fac.buildingHp); e.hp = e.maxHp; }
    e.angle = Math.PI / 2;
    this.add(e);
    this.grid.occupy(e, e.id);
    this.powerDirty = true;
    if (owner >= 0) this.players[owner].stats.buildingsBuilt++;
    if (built >= 1) completeBuildingConstruction(this, e);
    return e;
  }

  private add(e: Entity) {
    this.entities.set(e.id, e);
    this.list.push(e);
  }

  /** Removes an entity without death effects (sell, deploy, enter). */
  removeEntity(e: Entity) {
    if (e.dead) return;
    e.dead = true;
    if (e.kind === 'building') {
      this.grid.occupy(e, 0);
      this.powerDirty = true;
    }
  }

  get(id: number): Entity | undefined {
    const e = this.entities.get(id);
    return e && !e.dead ? e : undefined;
  }

  areEnemies(a: number, b: number): boolean {
    if (a === b) return false;
    if (a === NEUTRAL || b === NEUTRAL) return false;
    return this.players[a].team !== this.players[b].team;
  }
  isAllied(a: number, b: number): boolean {
    if (a === b) return true;
    if (a === NEUTRAL || b === NEUTRAL) return false;
    return this.players[a].team === this.players[b].team;
  }

  emit(ev: GameEvent) {
    this.events.push(ev);
  }
  notice(p: number, msg: Extract<GameEvent, { e: 'notice' }>['msg'], extra: Partial<Extract<GameEvent, { e: 'notice' }>> = {}) {
    if (p < 0) return;
    this.events.push({ e: 'notice', p, msg, ...extra });
  }

  /** Is the given entity visible to player p? */
  visibleTo(p: number, e: Entity): boolean {
    if (this.isAllied(p, e.owner)) return true;
    const pl = this.players[p];
    if (e.kind === 'building') {
      for (let y = e.ty; y < e.ty + e.h; y++) for (let x = e.tx; x < e.tx + e.w; x++) if (pl.visible[y * this.map.width + x] > 0) return true;
      return false;
    }
    return isTileVisible(this, p, e.x, e.y);
  }

  hasBuilt(p: number, type: string): boolean {
    for (const e of this.list) if (!e.dead && e.owner === p && e.type === type && e.built >= 1) return true;
    return false;
  }
  countOwned(p: number, type: string): number {
    let n = 0;
    for (const e of this.list) if (!e.dead && e.owner === p && e.type === type) n++;
    return n;
  }
  lowPower(p: number): boolean {
    const pl = this.players[p];
    return pl.powerUsed > pl.powerProduced;
  }

  prereqsMet(p: number, def: UnitDef | BuildingDef): boolean {
    return def.prereqs.every((r) => this.hasBuilt(p, r));
  }
  canProduce(p: number, type: string): boolean {
    if (!isKnownType(type)) return false;
    const def = DEFS[type];
    if (def.kind === 'building' && def.unbuildable) return false;
    if (def.factions && !def.factions.includes(this.players[p].faction)) return false;
    return this.prereqsMet(p, def);
  }

  // ---------------------------------------------------------------- placement

  canPlace(p: number, type: string, tx: number, ty: number): { ok: boolean; reason?: string } {
    const def = BUILDINGS[type];
    if (!def) return { ok: false, reason: 'Unknown structure' };
    const g = this.grid;
    if (tx < 1 || ty < 1 || tx + def.w > g.w - 1 || ty + def.h > g.h - 1) return { ok: false, reason: 'Out of bounds' };
    for (let y = ty; y < ty + def.h; y++)
      for (let x = tx; x < tx + def.w; x++) {
        const i = g.idx(x, y);
        if (!g.terrainBuild[i]) return { ok: false, reason: 'Blocked terrain' };
        if (g.building[i]) return { ok: false, reason: 'Occupied' };
        if (this.ore[i] > 0) return { ok: false, reason: 'Cannot build on ore' };
        if (!this.players[p].explored[i]) return { ok: false, reason: 'Unexplored' };
      }
    // Units in the footprint block placement.
    let blockedByUnit = false;
    const x0 = tx * TILE, y0 = ty * TILE, x1 = (tx + def.w) * TILE, y1 = (ty + def.h) * TILE;
    this.hash.query((x0 + x1) / 2, (y0 + y1) / 2, Math.max(def.w, def.h) * TILE, (e) => {
      if (e.kind !== 'unit' || e.dead) return;
      if (e.x + e.radius * 0.6 > x0 && e.x - e.radius * 0.6 < x1 && e.y + e.radius * 0.6 > y0 && e.y - e.radius * 0.6 < y1) blockedByUnit = true;
    });
    if (blockedByUnit) return { ok: false, reason: 'Units in the way' };
    // Must be near an existing friendly structure.
    let near = false;
    for (const e of this.list) {
      if (e.dead || e.kind !== 'building' || e.owner !== p || e.type === 'derrick') continue;
      const dx = Math.max(e.tx - (tx + def.w), tx - (e.tx + e.w), 0);
      const dy = Math.max(e.ty - (ty + def.h), ty - (e.ty + e.h), 0);
      if (Math.max(dx, dy) <= BUILD_RADIUS) { near = true; break; }
    }
    if (!near) return { ok: false, reason: 'Too far from base' };
    return { ok: true };
  }

  // ---------------------------------------------------------------- commands

  /** Applies a (structurally validated) command for player p. All rules are enforced here. */
  issue(p: number, cmd: Command): CommandResult {
    const pl = this.players[p];
    if (!pl || pl.defeated || this.result) return { ok: false, reason: 'Not active' };
    const ownUnits = (ids: number[]) => {
      const out: Entity[] = [];
      const seen = new Set<number>();
      for (const id of ids) {
        if (seen.has(id)) continue;
        seen.add(id);
        const e = this.get(id);
        if (e && e.owner === p && e.kind === 'unit') out.push(e);
      }
      return out;
    };
    const inWorld = (x: number, y: number) => x >= 0 && y >= 0 && x < this.worldW && y < this.worldH;

    switch (cmd.t) {
      case 'move':
      case 'attackMove': {
        if (!inWorld(cmd.x, cmd.y)) return { ok: false, reason: 'Out of bounds' };
        const us = ownUnits(cmd.ids);
        if (!us.length) return { ok: false, reason: 'No units' };
        const slots = formationSlots(this, us, cmd.x, cmd.y);
        us.forEach((u, i) => {
          u.order = { type: cmd.t, x: slots[i].x, y: slots[i].y };
          u.targetId = 0;
          if (u.def.kind === 'unit' && u.def.harvester) u.hState = 'idle';
          issueMove(this, u, slots[i].x, slots[i].y);
        });
        return { ok: true };
      }
      case 'stop': {
        for (const u of ownUnits(cmd.ids)) {
          u.order = { type: 'idle' };
          u.targetId = 0;
          u.path = []; u.needsPath = false; u.moving = false;
          u.guardX = u.x; u.guardY = u.y;
          if (u.def.kind === 'unit' && u.def.harvester) u.hState = 'idle';
        }
        return { ok: true };
      }
      case 'attack': {
        const t = this.get(cmd.target);
        if (!t) return { ok: false, reason: 'Invalid target' };
        if (this.isAllied(p, t.owner)) return { ok: false, reason: 'Cannot attack allies' };
        const knownGhost = t.kind === 'building' && pl.known.has(t.id);
        if (!this.visibleTo(p, t) && !knownGhost) return { ok: false, reason: 'Target not visible' };
        const us = ownUnits(cmd.ids).filter((u) => u.def.weapon);
        if (!us.length) return { ok: false, reason: 'No armed units' };
        for (const u of us) {
          u.order = { type: 'attack', targetId: t.id };
          u.targetId = t.id;
          u.path = []; u.needsPath = false; u.pathGoal = null; u.repathTimer = 0;
        }
        return { ok: true };
      }
      case 'deploy': {
        let any = false;
        for (const u of ownUnits(cmd.ids)) {
          if (u.def.kind !== 'unit' || !u.def.deploysTo) continue;
          u.order = { type: 'deploy' };
          u.path = []; u.moving = false;
          any = true;
        }
        return any ? { ok: true } : { ok: false, reason: 'Nothing to deploy' };
      }
      case 'harvest': {
        if (!inWorld(cmd.x, cmd.y)) return { ok: false, reason: 'Out of bounds' };
        const tile = Math.floor(cmd.y / TILE) * this.map.width + Math.floor(cmd.x / TILE);
        const us = ownUnits(cmd.ids).filter((u) => u.def.kind === 'unit' && u.def.harvester);
        if (!us.length) return { ok: false, reason: 'No harvesters' };
        for (const u of us) {
          u.order = { type: 'harvest' };
          u.oreTile = tile;
          u.hState = u.cargo >= HARVESTER_CAPACITY ? 'toRefinery' : 'seek';
          u.path = []; u.needsPath = false; u.moving = false;
        }
        return { ok: true };
      }
      case 'enter': {
        const t = this.get(cmd.target);
        if (!t || t.kind !== 'building') return { ok: false, reason: 'Invalid target' };
        let any = false;
        for (const u of ownUnits(cmd.ids)) {
          const d = u.def as UnitDef;
          if (d.engineer) {
            const ok = t.owner !== p || t.hp < t.maxHp;
            if (!ok) continue;
            if (!this.visibleTo(p, t) && !pl.known.has(t.id)) continue;
          } else if (d.harvester) {
            if (t.owner !== p || !(t.def as BuildingDef).refinery) continue;
            u.hState = 'toRefinery';
            u.dockId = t.id;
            u.order = { type: 'harvest' };
            u.path = []; u.needsPath = false;
            any = true;
            continue;
          } else continue;
          u.order = { type: 'enter', targetId: t.id };
          u.path = []; u.needsPath = false; u.pathGoal = null;
          any = true;
        }
        return any ? { ok: true } : { ok: false, reason: 'No valid units' };
      }
      case 'build': {
        if (!isKnownType(cmd.type)) return { ok: false, reason: 'Unknown type' };
        const def = DEFS[cmd.type];
        if (def.category !== cmd.cat) return { ok: false, reason: 'Wrong category' };
        if (!this.canProduce(p, cmd.type)) return { ok: false, reason: 'Requirements not met' };
        const q = pl.queues[cmd.cat];
        const structure = cmd.cat === 'building' || cmd.cat === 'defense';
        if (structure && (q.items.length >= 1 || q.ready)) { this.notice(p, 'queueFull'); return { ok: false, reason: 'Already constructing' }; }
        if (q.items.length >= MAX_QUEUE_ITEMS) { this.notice(p, 'queueFull'); return { ok: false, reason: 'Queue full' }; }
        if (pl.credits < def.cost) { this.notice(p, 'insufficientFunds'); return { ok: false, reason: 'Insufficient funds' }; }
        pl.credits -= def.cost;
        pl.stats.creditsSpent += def.cost;
        const fac = FACTIONS[pl.faction];
        const mult = def.kind === 'unit' ? fac.unitBuildTime : 1;
        q.items.push({ type: def.id, progress: 0, total: Math.round(def.buildTime * TICK_RATE * mult), paid: def.cost });
        return { ok: true };
      }
      case 'cancel': {
        if (!Object.prototype.hasOwnProperty.call(pl.queues, cmd.cat)) return { ok: false, reason: 'Bad queue' };
        const q = pl.queues[cmd.cat];
        if (q.ready === cmd.type && q.items.length === 0) {
          q.ready = null;
          const cost = DEFS[cmd.type]?.cost ?? 0;
          pl.credits += cost;
          pl.stats.creditsSpent -= cost;
          return { ok: true };
        }
        for (let i = q.items.length - 1; i >= 0; i--) {
          if (q.items[i].type === cmd.type) {
            pl.credits += q.items[i].paid;
            pl.stats.creditsSpent -= q.items[i].paid;
            q.items.splice(i, 1);
            return { ok: true };
          }
        }
        return { ok: false, reason: 'Not queued' };
      }
      case 'place': {
        if (!isKnownType(cmd.type) || DEFS[cmd.type].kind !== 'building') return { ok: false, reason: 'Unknown type' };
        const def = BUILDINGS[cmd.type];
        const q = pl.queues[def.category];
        if (q.ready !== cmd.type) return { ok: false, reason: 'Not ready' };
        const chk = this.canPlace(p, cmd.type, cmd.tx, cmd.ty);
        if (!chk.ok) { this.notice(p, 'cannotPlace'); return { ok: false, reason: chk.reason ?? 'Invalid' }; }
        q.ready = null;
        const b = this.spawnBuilding(cmd.type, p, cmd.tx, cmd.ty, 0);
        this.emit({ e: 'placed', id: b.id, type: b.type, x: b.x, y: b.y, o: p });
        return { ok: true };
      }
      case 'sell': {
        const b = this.get(cmd.id);
        if (!b || b.owner !== p || b.kind !== 'building') return { ok: false, reason: 'Invalid' };
        const refund = Math.floor((b.def.cost * 0.5 * b.hp) / b.maxHp);
        pl.credits += refund;
        this.emit({ e: 'death', id: b.id, type: b.type, x: b.x, y: b.y, o: b.owner });
        this.removeEntity(b);
        return { ok: true };
      }
      case 'repair': {
        const b = this.get(cmd.id);
        if (!b || b.owner !== p || b.kind !== 'building') return { ok: false, reason: 'Invalid' };
        b.repairing = !b.repairing && b.hp < b.maxHp;
        return { ok: true };
      }
      case 'rally': {
        const b = this.get(cmd.id);
        if (!b || b.owner !== p || b.kind !== 'building' || !(b.def as BuildingDef).produces) return { ok: false, reason: 'Invalid' };
        if (!inWorld(cmd.x, cmd.y)) return { ok: false, reason: 'Out of bounds' };
        b.rallyX = cmd.x; b.rallyY = cmd.y; b.hasRally = true;
        return { ok: true };
      }
      case 'sweep': {
        if (!FACTIONS[pl.faction].sweep) return { ok: false, reason: 'Faction lacks Recon Sweep' };
        if (!this.hasBuilt(p, 'radar') || this.lowPower(p)) return { ok: false, reason: 'Requires powered Recon Center' };
        if (pl.sweepCooldown > 0) return { ok: false, reason: 'Recharging' };
        if (!inWorld(cmd.x, cmd.y)) return { ok: false, reason: 'Out of bounds' };
        pl.sweepCooldown = SWEEP_COOLDOWN_TICKS;
        pl.sweeps.push({ x: cmd.x, y: cmd.y, until: this.tick + SWEEP_DURATION_TICKS });
        this.emit({ e: 'sweep', p, x: cmd.x, y: cmd.y });
        updateFog(this);
        return { ok: true };
      }
      case 'surrender': {
        this.defeat(pl);
        this.checkVictory();
        return { ok: true };
      }
    }
    return { ok: false, reason: 'Unknown command' };
  }

  // ---------------------------------------------------------------- tick

  rebuildHash() {
    this.hash.clear();
    for (const e of this.list) if (!e.dead) this.hash.insert(e);
  }

  step() {
    if (this.result) return;
    this.tick++;
    this.events.length = 0;
    this.oreChanged.length = 0;
    this.rebuildHash();
    if (this.powerDirty) recomputePower(this);

    updateProduction(this);

    for (const e of this.list) {
      if (e.dead) continue;
      if (e.kind === 'building') this.updateBuilding(e);
      else this.updateUnit(e);
    }

    // Pathfinding requests, limited per tick.
    let budget = PATH_BUDGET;
    while (budget > 0 && this.pathQueue.length) {
      const u = this.pathQueue.shift()!;
      if (u.dead || !u.needsPath || !u.pathGoal) continue;
      budget--;
      const path = this.pf.findPath({ x: u.x, y: u.y }, u.pathGoal, Math.min(u.radius, 10));
      u.needsPath = false;
      if (path && path.length) {
        u.path = path; u.pathIdx = 0; u.moving = true;
      } else {
        u.path = []; u.moving = false;
      }
    }

    applySeparation(this);
    updateProjectiles(this);

    // Compact dead entities.
    if (this.tick % 10 === 0 || this.list.some((e) => e.dead)) {
      const alive: Entity[] = [];
      for (const e of this.list) {
        if (e.dead) this.entities.delete(e.id);
        else alive.push(e);
      }
      this.list = alive;
    }

    for (const p of this.players) {
      if (p.sweepCooldown > 0) {
        p.sweepCooldown--;
        if (p.sweepCooldown === 0 && FACTIONS[p.faction].sweep && this.hasBuilt(p.id, 'radar')) this.notice(p.id, 'sweepReady');
      }
      if (p.sweeps.length) p.sweeps = p.sweeps.filter((s) => s.until > this.tick);
    }

    if (this.tick % FOG_INTERVAL === 0) updateFog(this);
    if (this.tick % ORE_REGROW_INTERVAL === 0) this.regrowOre();
    if (this.tick % 20 === 0) this.checkVictory();
  }

  private regrowOre() {
    for (const i of this.oreTiles) {
      const max = this.map.oreMax[i];
      if (this.ore[i] < max && this.grid.building[i] === 0) {
        this.ore[i] = Math.min(max, this.ore[i] + 25);
        this.oreChanged.push(i);
      }
    }
  }

  private updateBuilding(b: Entity) {
    const def = b.def as BuildingDef;
    if (b.built < 1) {
      b.built = Math.min(1, b.built + 1 / (TICK_RATE * 1.5));
      if (b.built >= 1) completeBuildingConstruction(this, b);
      return;
    }
    if (b.owner === NEUTRAL) return;
    const pl = this.players[b.owner];
    if (b.repairing) {
      if (b.hp >= b.maxHp) b.repairing = false;
      else {
        const heal = (b.maxHp * 0.04) / TICK_RATE;
        const cost = (heal * def.cost * 0.35) / b.maxHp;
        if (pl.credits >= cost) {
          pl.credits -= cost;
          b.hp = Math.min(b.maxHp, b.hp + heal);
        } else b.repairing = false;
      }
    }
    const fort = FACTIONS[pl.faction].fortify;
    if (fort > 0 && b.hp < b.maxHp && this.tick - b.lastHit > TICK_RATE * 8) {
      b.hp = Math.min(b.maxHp, b.hp + (b.maxHp * fort) / TICK_RATE);
    }
    if (def.income && this.tick % (TICK_RATE * 2) === 0) {
      pl.credits += def.income;
      pl.stats.creditsEarned += def.income;
    }
    if (def.weapon) updateCombatEntity(this, b);
  }

  private updateUnit(u: Entity) {
    const def = u.def as UnitDef;
    if (def.selfRepairTo && u.hp < u.maxHp * def.selfRepairTo && this.tick - u.lastHit > TICK_RATE * 5) {
      u.hp = Math.min(u.maxHp * def.selfRepairTo, u.hp + (u.maxHp * 0.01) / TICK_RATE);
    }
    switch (u.order.type) {
      case 'deploy':
        this.tryDeploy(u);
        return;
      case 'enter':
        this.updateEnter(u);
        break;
      case 'harvest':
        updateHarvester(this, u);
        break;
      default:
        if (def.harvester && u.order.type === 'idle' && u.hState !== 'idle') updateHarvester(this, u);
        else if (def.weapon) updateCombatEntity(this, u);
        else if (u.order.type === 'move' && !u.moving && !u.needsPath) u.order = { type: 'idle' };
    }
    moveUnit(this, u);
  }

  private deployOrigin(u: Entity) {
    const bdef = BUILDINGS[(u.def as UnitDef).deploysTo!];
    return { bdef, tx: Math.round(u.x / TILE - bdef.w / 2), ty: Math.round(u.y / TILE - bdef.h / 2) };
  }

  /** Whether a deployable unit could deploy where it stands. */
  canDeploy(p: number, u: Entity, nudge = false): boolean {
    if (u.def.kind !== 'unit' || !u.def.deploysTo) return false;
    const { bdef, tx, ty } = this.deployOrigin(u);
    // Temporarily ignore the deploying unit itself for the unit-overlap check.
    u.dead = true;
    this.rebuildHash();
    const ok = this.canPlaceDeploy(p, bdef.id, tx, ty, nudge);
    u.dead = false;
    this.rebuildHash();
    return ok;
  }

  private tryDeploy(u: Entity) {
    if (!this.canDeploy(u.owner, u, true)) {
      this.notice(u.owner, 'cannotDeploy', { x: u.x, y: u.y });
      u.order = { type: 'idle' };
      return;
    }
    const { bdef, tx, ty } = this.deployOrigin(u);
    this.removeEntity(u);
    const b = this.spawnBuilding(bdef.id, u.owner, tx, ty, 0);
    b.hp = Math.max(1, Math.round((u.hp / u.maxHp) * b.maxHp));
    this.emit({ e: 'placed', id: b.id, type: b.type, x: b.x, y: b.y, o: u.owner });
  }

  /** Deployment ignores the "near base" requirement. */
  private canPlaceDeploy(p: number, type: string, tx: number, ty: number, nudge: boolean): boolean {
    const def = BUILDINGS[type];
    const g = this.grid;
    if (tx < 1 || ty < 1 || tx + def.w > g.w - 1 || ty + def.h > g.h - 1) return false;
    for (let y = ty; y < ty + def.h; y++)
      for (let x = tx; x < tx + def.w; x++) {
        const i = g.idx(x, y);
        if (!g.terrainBuild[i] || g.building[i] || this.ore[i] > 0) return false;
      }
    let blocked = false;
    const x0 = tx * TILE, y0 = ty * TILE, x1 = (tx + def.w) * TILE, y1 = (ty + def.h) * TILE;
    this.hash.query((x0 + x1) / 2, (y0 + y1) / 2, def.w * TILE, (e) => {
      if (e.kind !== 'unit' || e.dead || e.owner !== p) {
        if (e.kind === 'unit' && !e.dead && e.x > x0 && e.x < x1 && e.y > y0 && e.y < y1) blocked = true;
        return;
      }
      // Own units get nudged out of the way instead of blocking.
      if (nudge && e.x > x0 - 4 && e.x < x1 + 4 && e.y > y0 - 4 && e.y < y1 + 4) {
        const ang = Math.atan2(e.y - (y0 + y1) / 2, e.x - (x0 + x1) / 2);
        const d = def.w * TILE * 0.85;
        issueMove(this, e, (x0 + x1) / 2 + Math.cos(ang) * d, (y0 + y1) / 2 + Math.sin(ang) * d);
        e.x += Math.cos(ang) * 2; // small immediate push
      }
    });
    return !blocked;
  }

  private updateEnter(u: Entity) {
    const t = this.get(u.order.targetId ?? 0);
    if (!t) { u.order = { type: 'idle' }; u.path = []; u.moving = false; return; }
    const d = distToEntity(u.x, u.y, t);
    if (d < 22) {
      const def = u.def as UnitDef;
      if (def.engineer) {
        if (t.owner === u.owner) {
          t.hp = t.maxHp;
        } else {
          const prev = t.owner;
          if (prev >= 0) {
            this.players[prev].stats.buildingsLost++;
            this.notice(prev, 'buildingLost', { x: t.x, y: t.y, type: t.type });
          }
          t.owner = u.owner;
          t.repairing = false;
          t.targetId = 0;
          t.hasRally = false;
          this.powerDirty = true;
          this.notice(u.owner, 'buildingCaptured', { x: t.x, y: t.y, type: t.type });
          this.emit({ e: 'capture', id: t.id, o: u.owner, x: t.x, y: t.y });
          // Captured production buildings lose their queued work implicitly (queues are per player).
        }
        this.removeEntity(u);
      }
      return;
    }
    if (!u.moving && !u.needsPath) {
      const p = nearestPerimeterPoint(this, t, u.x, u.y);
      issueMove(this, u, p.x, p.y);
      if (u.stuckCount > 6) { u.order = { type: 'idle' }; }
    }
  }

  // ---------------------------------------------------------------- victory

  defeat(pl: PlayerState) {
    if (pl.defeated) return;
    pl.defeated = true;
    for (const q of Object.values(pl.queues)) { q.items = []; q.ready = null; }
    for (const e of this.list) {
      if (e.dead || e.owner !== pl.id) continue;
      if (e.type === 'derrick') {
        e.owner = NEUTRAL;
        continue;
      }
      killEntity(this, e, -1);
    }
    for (const other of this.players) this.notice(other.id, 'playerDefeated', { type: pl.name });
    this.onDefeat?.(pl);
  }

  checkVictory() {
    if (this.result || !this.victoryEnabled) return;
    const alive = new Set<number>();
    for (const e of this.list) {
      if (e.dead || e.owner < 0) continue;
      if ((e.kind === 'building' && e.type !== 'derrick') || e.type === 'mcv') alive.add(e.owner);
    }
    for (const p of this.players) if (!p.defeated && !alive.has(p.id)) this.defeat(p);
    const teams = new Set(this.players.filter((p) => !p.defeated).map((p) => p.team));
    if (teams.size <= 1 && this.players.length > 1) {
      const winnerTeam = teams.size === 1 ? [...teams][0] : null;
      this.result = {
        winnerTeam,
        winners: this.players.filter((p) => p.team === winnerTeam && winnerTeam !== null).map((p) => p.id),
        tick: this.tick,
        stats: this.players.map((p) => ({ id: p.id, name: p.name, faction: p.faction, color: p.color, defeated: p.defeated, stats: { ...p.stats } })),
      };
    } else if (this.players.length === 1 && teams.size === 0) {
      this.result = { winnerTeam: null, winners: [], tick: this.tick, stats: this.players.map((p) => ({ id: p.id, name: p.name, faction: p.faction, color: p.color, defeated: p.defeated, stats: { ...p.stats } })) };
    }
  }
}

