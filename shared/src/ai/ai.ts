import { TICK_RATE, TILE } from '../constants';
import { BUILDINGS, UNITS, type BuildingDef, type QueueCategory, type UnitDef } from '../data/defs';
import { Rng } from '../rng';
import type { Game } from '../sim/game';
import type { Difficulty, Entity, Vec } from '../sim/types';

interface AIConfig {
  /** Ticks between decisions. */
  interval: number;
  harvestersPerRefinery: number;
  maxRefineries: number;
  waveBase: number;
  waveGrowth: number;
  firstAttack: number;
  scout: boolean;
  defenses: number;
  /** Retreat when a wave drops below this fraction (0 = never). */
  retreatAt: number;
  /** Adapt unit mix to observed enemy composition. */
  counter: boolean;
  /** Gather the wave before launching. */
  gather: boolean;
  engineers: boolean;
  /** Minimum credits kept before queueing army. */
  reserve: number;
  maxQueued: number;
}

const CONFIGS: Record<Difficulty, AIConfig> = {
  easy: { interval: 40, harvestersPerRefinery: 1, maxRefineries: 1, waveBase: 5, waveGrowth: 1, firstAttack: TICK_RATE * 60 * 7, scout: false, defenses: 1, retreatAt: 0, counter: false, gather: false, engineers: false, reserve: 400, maxQueued: 1 },
  normal: { interval: 20, harvestersPerRefinery: 2, maxRefineries: 2, waveBase: 8, waveGrowth: 2, firstAttack: TICK_RATE * 60 * 4.5, scout: true, defenses: 2, retreatAt: 0.25, counter: true, gather: true, engineers: false, reserve: 150, maxQueued: 2 },
  hard: { interval: 8, harvestersPerRefinery: 2, maxRefineries: 3, waveBase: 10, waveGrowth: 3, firstAttack: TICK_RATE * 60 * 3.5, scout: true, defenses: 4, retreatAt: 0.3, counter: true, gather: true, engineers: true, reserve: 0, maxQueued: 3 },
};

type Role = 'army' | 'wave' | 'defend' | 'scout' | 'engineer';

/**
 * Computer opponent. Plays strictly through Game.issue() with the same rules as
 * humans and only reads information visible to its player (own entities, fogged
 * vision, remembered structures, and public map info such as start positions).
 */
export class AIController {
  readonly cfg: AIConfig;
  private rng: Rng;
  private roles = new Map<number, Role>();
  private waves = 0;
  private attacking = false;
  private waveTarget: Vec | null = null;
  private waveStartSize = 0;
  private scoutTargets: Vec[] = [];
  private lastBuildTick = -9999;
  private deployTries = 0;
  readonly offset: number;

  constructor(private game: Game, readonly player: number, readonly difficulty: Difficulty) {
    this.cfg = CONFIGS[difficulty];
    this.rng = new Rng(1000 + player * 7919);
    this.offset = player * 3;
  }

  private get me() {
    return this.game.players[this.player];
  }

  update() {
    const g = this.game;
    if (this.me.defeated || g.result) return;
    if ((g.tick + this.offset) % this.cfg.interval !== 0) return;
    const own = g.list.filter((e) => !e.dead && e.owner === this.player);
    const buildings = own.filter((e) => e.kind === 'building');
    const units = own.filter((e) => e.kind === 'unit');
    for (const id of [...this.roles.keys()]) if (!g.get(id)) this.roles.delete(id);

    this.handleMCV(units, buildings);
    const hq = buildings.find((b) => b.type === 'hq');
    if (!hq && !buildings.length) return;
    const base = hq ? { x: hq.x, y: hq.y } : { x: buildings[0].x, y: buildings[0].y };

    this.placeReady(base);
    this.construct(buildings);
    this.economy(units, buildings);
    this.produce(units, buildings);
    this.repair(buildings);
    this.manageArmy(units, buildings, base);
    this.scouting(units, base);
    this.engineers(units);
    this.sweep();
  }

  // ------------------------------------------------------------- base building

  private handleMCV(units: Entity[], buildings: Entity[]) {
    const mcv = units.find((u) => u.type === 'mcv');
    if (!mcv || mcv.order.type === 'deploy') return;
    if (buildings.some((b) => b.type === 'hq') && buildings.length > 2 && !this.lostHQ(buildings)) return;
    if (mcv.moving || mcv.needsPath) return;
    if (this.game.canDeploy(this.player, mcv)) {
      this.game.issue(this.player, { t: 'deploy', ids: [mcv.id] });
      this.deployTries = 0;
    } else {
      // Find open ground nearby.
      this.deployTries++;
      const r = 3 + this.deployTries * 2;
      const a = this.rng.next() * Math.PI * 2;
      this.game.issue(this.player, { t: 'move', ids: [mcv.id], x: mcv.x + Math.cos(a) * r * TILE, y: mcv.y + Math.sin(a) * r * TILE });
    }
  }
  private lostHQ(buildings: Entity[]) {
    return !buildings.some((b) => b.type === 'hq');
  }

  private desiredBuildOrder(): [string, number][] {
    const f = this.me.faction;
    const special = f === 'cdc' ? 'sentinel' : 'arcpylon';
    const c = this.cfg;
    const order: [string, number][] = [
      ['power', 1], ['refinery', 1], ['barracks', 1], ['factory', 1], ['power', 2],
    ];
    if (c.maxRefineries >= 2) order.push(['refinery', 2]);
    order.push(['radar', 1], ['pillbox', 1]);
    if (c.defenses >= 2) order.push(['turret', 1]);
    order.push(['power', 3]);
    if (this.difficulty !== 'easy') order.push(['tech', 1], ['power', 4]);
    if (c.defenses >= 2 && this.difficulty !== 'easy') order.push([special, 1]);
    if (c.maxRefineries >= 3) order.push(['refinery', 3], ['factory', 2]);
    if (c.defenses >= 3) order.push(['turret', 2], ['pillbox', 2]);
    if (c.defenses >= 4) order.push(['power', 5], [special, 2]);
    if (this.difficulty === 'easy' && this.game.tick > TICK_RATE * 60 * 10) order.push(['tech', 1], ['power', 4]);
    return order;
  }

  private construct(buildings: Entity[]) {
    const g = this.game, p = this.player, me = this.me;
    if (!buildings.some((b) => b.type === 'hq')) return;
    if (this.difficulty === 'easy' && g.tick - this.lastBuildTick < TICK_RATE * 12) return;
    for (const cat of ['building', 'defense'] as QueueCategory[]) {
      const q = me.queues[cat];
      if (q.items.length || q.ready) continue;
      const next = this.nextBuilding(cat);
      if (!next) continue;
      const def = BUILDINGS[next];
      if (me.credits < def.cost) continue;
      // Defenses wait until the core economy is running.
      if (cat === 'defense' && !g.hasBuilt(p, 'factory') && g.tick < TICK_RATE * 60 * 6) continue;
      if (g.issue(p, { t: 'build', cat, type: next }).ok) this.lastBuildTick = g.tick;
    }
  }

  private nextBuilding(cat: QueueCategory): string | null {
    const g = this.game, p = this.player, me = this.me;
    const counts = new Map<string, number>();
    for (const e of g.list) if (!e.dead && e.owner === p && e.kind === 'building') counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
    for (const [type, n] of this.desiredBuildOrder()) {
      if ((counts.get(type) ?? 0) >= n) continue;
      const def = BUILDINGS[type];
      if (!g.canProduce(p, type)) continue;
      if (def.category !== cat) {
        if (cat === 'defense') continue;
        // building queue: skip defenses, keep scanning
        continue;
      }
      // Power planning: build a plant first if this would brown us out.
      if (cat === 'building' && type !== 'power' && def.power < 0 && me.powerProduced - me.powerUsed + def.power < 0 && g.canProduce(p, 'power')) return 'power';
      return type;
    }
    if (cat === 'building' && me.powerUsed > me.powerProduced - 10 && g.canProduce(p, 'power')) return 'power';
    return null;
  }

  private placeReady(base: Vec) {
    const g = this.game, p = this.player;
    for (const cat of ['building', 'defense'] as QueueCategory[]) {
      const type = this.me.queues[cat].ready;
      if (!type) continue;
      const spot = this.findSpot(type, base);
      if (spot) g.issue(p, { t: 'place', type, tx: spot.x, ty: spot.y });
      else g.issue(p, { t: 'cancel', cat, type });
    }
  }

  private enemyDirection(base: Vec): Vec {
    const g = this.game;
    let tx = g.worldW / 2, ty = g.worldH / 2;
    const known = [...this.me.known.values()].filter((k) => k.owner >= 0);
    if (known.length) { tx = known[0].tx * TILE; ty = known[0].ty * TILE; }
    const d = Math.hypot(tx - base.x, ty - base.y) || 1;
    return { x: (tx - base.x) / d, y: (ty - base.y) / d };
  }

  /** Finds a valid placement near the base, keeping a 1-tile gap so units can path around. */
  findSpot(type: string, base: Vec): Vec | null {
    const g = this.game, p = this.player;
    const def = BUILDINGS[type];
    const bx = Math.floor(base.x / TILE), by = Math.floor(base.y / TILE);
    const dir = this.enemyDirection(base);
    let best: Vec | null = null, bs = Infinity;
    const isDefense = def.category === 'defense';
    for (let r = 2; r <= 13; r++) {
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const tx = bx + dx - Math.floor(def.w / 2), ty = by + dy - Math.floor(def.h / 2);
          if (!this.hasMargin(tx, ty, def)) continue;
          if (!g.canPlace(p, type, tx, ty).ok) continue;
          const cx = (tx + def.w / 2) * TILE, cy = (ty + def.h / 2) * TILE;
          let score = r * 10 + this.rng.next() * 6;
          if (def.refinery) score = this.oreDistance(cx, cy) + r * 2;
          if (isDefense) {
            const along = ((cx - base.x) * dir.x + (cy - base.y) * dir.y) / TILE;
            score = Math.abs(along - 7) * 6 + Math.abs((cx - base.x) * -dir.y + (cy - base.y) * dir.x) / TILE * 2 + this.rng.next() * 8;
          }
          if (score < bs) { bs = score; best = { x: tx, y: ty }; }
        }
      if (best && !def.refinery && !isDefense && r > 3) break;
    }
    return best;
  }

  private hasMargin(tx: number, ty: number, def: BuildingDef): boolean {
    const g = this.game.grid;
    const m = def.category === 'defense' ? 0 : 1;
    for (let y = ty - m; y < ty + def.h + m; y++)
      for (let x = tx - m; x < tx + def.w + m; x++) {
        if (!g.inBounds(x, y)) return false;
        if (g.building[g.idx(x, y)]) return false;
      }
    // Keep the row below production buildings clear for exits.
    if (def.produces || def.refinery) {
      for (let x = tx; x < tx + def.w; x++) if (!g.passable(x, ty + def.h + 1)) return false;
    }
    return true;
  }

  private oreDistance(x: number, y: number): number {
    const g = this.game;
    let best = Infinity;
    const w = g.map.width;
    for (const i of g.oreTiles) {
      if (g.ore[i] <= 0) continue;
      const d = Math.hypot((i % w) * TILE - x, Math.floor(i / w) * TILE - y);
      if (d < best) best = d;
    }
    return best;
  }

  // ------------------------------------------------------------- economy

  private economy(units: Entity[], buildings: Entity[]) {
    const g = this.game, p = this.player;
    for (const h of units) {
      if (!(h.def as UnitDef).harvester) continue;
      if (h.hState === 'idle' && !h.moving) g.issue(p, { t: 'harvest', ids: [h.id], x: h.x, y: h.y });
    }
    void buildings;
  }

  private produce(units: Entity[], buildings: Entity[]) {
    const g = this.game, p = this.player, me = this.me, c = this.cfg;
    const refineries = buildings.filter((b) => b.type === 'refinery').length;
    const harvesters = units.filter((u) => (u.def as UnitDef).harvester).length;
    const vq = me.queues.vehicle, iq = me.queues.infantry;
    const queuedHarv = vq.items.filter((i) => i.type === 'harvester').length;
    const wantHarv = Math.min(6, refineries * c.harvestersPerRefinery);
    if (refineries && harvesters + queuedHarv < wantHarv && g.canProduce(p, 'harvester')) {
      if (me.credits >= UNITS.harvester.cost) g.issue(p, { t: 'build', cat: 'vehicle', type: 'harvester' });
      return;
    }
    // Lost the command center: rebuild via a new MCV.
    if (!buildings.some((b) => b.type === 'hq') && !units.some((u) => u.type === 'mcv') && !vq.items.some((i) => i.type === 'mcv')) {
      if (g.canProduce(p, 'mcv') && me.credits >= UNITS.mcv.cost) g.issue(p, { t: 'build', cat: 'vehicle', type: 'mcv' });
      return;
    }
    // Save up for the next structure early on.
    const nextB = me.queues.building.items.length || me.queues.building.ready ? null : this.nextBuilding('building');
    // Key economy/production structures take priority over army spending.
    const critical = nextB && ['refinery', 'factory', 'power', 'barracks', 'radar'].includes(nextB);
    const reserve = c.reserve + (nextB ? BUILDINGS[nextB].cost * (critical ? 1 : 0.5) : 0);
    // Keep at least a trickle of defenders early so we are never completely empty.
    const armySize = units.filter((u) => u.def.weapon).length;
    if (me.credits < reserve && armySize >= 4) return;

    if (iq.items.length < c.maxQueued && g.hasBuilt(p, 'barracks')) {
      const t = this.pickInfantry();
      if (t && me.credits >= UNITS[t].cost) g.issue(p, { t: 'build', cat: 'infantry', type: t });
    }
    if (vq.items.length < c.maxQueued && g.hasBuilt(p, 'factory')) {
      const t = this.pickVehicle(units);
      if (t && me.credits >= UNITS[t].cost) g.issue(p, { t: 'build', cat: 'vehicle', type: t });
    }
  }

  /** Observed enemy composition (only what this player can currently see). */
  private enemyMix() {
    const g = this.game;
    let inf = 0, veh = 0;
    for (const e of g.list) {
      if (e.dead || e.kind !== 'unit' || !g.areEnemies(this.player, e.owner) || !g.visibleTo(this.player, e)) continue;
      if ((e.def as UnitDef).category === 'infantry') inf++;
      else veh++;
    }
    return { inf, veh };
  }

  private pickInfantry(): string | null {
    const g = this.game, p = this.player;
    const opts: [string, number][] = [['rifle', 5], ['rocket', 3]];
    if (this.cfg.counter) {
      const mix = this.enemyMix();
      if (mix.veh > mix.inf) opts[1][1] += 4;
      else if (mix.inf > mix.veh) opts[0][1] += 3;
    }
    return this.weighted(opts.filter(([t]) => g.canProduce(p, t)));
  }

  private pickVehicle(units: Entity[]): string | null {
    const g = this.game, p = this.player;
    const f = this.me.faction;
    const tank = f === 'cdc' ? 'lighttank' : 'raider';
    const heavy = f === 'cdc' ? 'heavytank' : 'mauler';
    const arty = f === 'cdc' ? 'artillery' : 'hailstorm';
    const artyCount = units.filter((u) => u.type === arty).length;
    const army = units.filter((u) => u.def.weapon).length;
    const opts: [string, number][] = [[tank, 6], [heavy, this.difficulty === 'easy' ? 1 : 4]];
    if (artyCount < Math.max(1, army / 6)) opts.push([arty, this.difficulty === 'hard' ? 3 : 2]);
    if (this.cfg.counter) {
      const mix = this.enemyMix();
      if (mix.inf > mix.veh + 3) { const a = opts.find((o) => o[0] === arty); if (a) a[1] += 3; }
    }
    return this.weighted(opts.filter(([t]) => g.canProduce(p, t)));
  }

  private weighted(opts: [string, number][]): string | null {
    const total = opts.reduce((s, o) => s + o[1], 0);
    if (!total) return null;
    let r = this.rng.next() * total;
    for (const [t, w] of opts) if ((r -= w) <= 0) return t;
    return opts[opts.length - 1][0];
  }

  private repair(buildings: Entity[]) {
    if (this.difficulty === 'easy') return;
    for (const b of buildings) {
      if (!b.repairing && b.built >= 1 && b.hp < b.maxHp * 0.7 && this.me.credits > 400 && this.game.tick - b.lastHit > TICK_RATE * 3)
        this.game.issue(this.player, { t: 'repair', id: b.id });
    }
  }

  // ------------------------------------------------------------- army

  private manageArmy(units: Entity[], buildings: Entity[], base: Vec) {
    const g = this.game, p = this.player, c = this.cfg;
    const combat = units.filter((u) => u.def.weapon && !(u.def as UnitDef).harvester && u.type !== 'scout' && this.roles.get(u.id) !== 'scout');
    for (const u of combat) if (!this.roles.has(u.id)) this.roles.set(u.id, 'army');

    const dir = this.enemyDirection(base);
    const rally = { x: base.x + dir.x * TILE * 7, y: base.y + dir.y * TILE * 7 };

    // 1) Defend the base against visible intruders.
    const threats: Entity[] = [];
    for (const e of g.list) {
      if (e.dead || e.kind !== 'unit' || !g.areEnemies(p, e.owner) || !g.visibleTo(p, e)) continue;
      for (const b of buildings) {
        if (Math.hypot(b.x - e.x, b.y - e.y) < TILE * 14) { threats.push(e); break; }
      }
    }
    if (threats.length) {
      const cx = threats.reduce((s, t) => s + t.x, 0) / threats.length;
      const cy = threats.reduce((s, t) => s + t.y, 0) / threats.length;
      const defenders = combat.filter((u) => this.roles.get(u.id) !== 'wave' || threats.length > 4);
      const ids = defenders.filter((u) => u.order.type !== 'attack' && (u.order.type !== 'attackMove' || this.roles.get(u.id) !== 'defend')).map((u) => u.id);
      if (ids.length) g.issue(p, { t: 'attackMove', ids, x: cx, y: cy });
      for (const u of defenders) this.roles.set(u.id, 'defend');
      return;
    }
    for (const u of combat) if (this.roles.get(u.id) === 'defend' && u.order.type === 'idle') this.roles.set(u.id, 'army');

    // 2) Ongoing attack wave.
    const wave = combat.filter((u) => this.roles.get(u.id) === 'wave');
    if (this.attacking) {
      if (wave.length === 0 || (c.retreatAt > 0 && wave.length < this.waveStartSize * c.retreatAt)) {
        this.attacking = false;
        for (const u of wave) this.roles.set(u.id, 'army');
        if (wave.length) g.issue(p, { t: 'move', ids: wave.map((u) => u.id), x: rally.x, y: rally.y });
      } else {
        const idle = wave.filter((u) => u.order.type === 'idle');
        if (idle.length) {
          const tgt = this.pickAttackTarget(base);
          if (tgt) {
            this.waveTarget = tgt;
            g.issue(p, { t: 'attackMove', ids: idle.map((u) => u.id), x: tgt.x, y: tgt.y });
          }
        }
        // Reinforce the wave with fresh units on hard.
        if (this.difficulty === 'hard' && this.waveTarget) {
          const fresh = combat.filter((u) => this.roles.get(u.id) === 'army' && u.order.type === 'idle');
          if (fresh.length >= 4) {
            for (const u of fresh) this.roles.set(u.id, 'wave');
            g.issue(p, { t: 'attackMove', ids: fresh.map((u) => u.id), x: this.waveTarget.x, y: this.waveTarget.y });
          }
        }
      }
    }

    // 3) Gather idle units at the rally point.
    const army = combat.filter((u) => this.roles.get(u.id) === 'army');
    const strays = army.filter((u) => u.order.type === 'idle' && !u.moving && Math.hypot(u.x - rally.x, u.y - rally.y) > TILE * 5);
    if (strays.length) g.issue(p, { t: 'attackMove', ids: strays.map((u) => u.id), x: rally.x, y: rally.y });

    // 4) Launch a new wave.
    if (!this.attacking && g.tick >= c.firstAttack) {
      const size = Math.min(26, c.waveBase + this.waves * c.waveGrowth);
      const ready = c.gather ? army.filter((u) => Math.hypot(u.x - rally.x, u.y - rally.y) < TILE * 8) : army;
      if (ready.length >= size) {
        const tgt = this.pickAttackTarget(base);
        if (tgt) {
          this.attacking = true;
          this.waves++;
          this.waveStartSize = ready.length;
          this.waveTarget = tgt;
          for (const u of ready) this.roles.set(u.id, 'wave');
          g.issue(p, { t: 'attackMove', ids: ready.map((u) => u.id), x: tgt.x, y: tgt.y });
        }
      }
    }
  }

  /** Chooses where to attack using only remembered/visible information. */
  private pickAttackTarget(base: Vec): Vec | null {
    const g = this.game, p = this.player;
    const known = [...this.me.known.values()].filter((k) => k.owner >= 0 && g.areEnemies(p, k.owner));
    if (known.length) {
      const prio = (t: string) => (this.difficulty === 'hard' ? ({ refinery: 0, factory: 1, hq: 2, barracks: 3 } as Record<string, number>)[t] ?? 5 : 0);
      known.sort((a, b) => prio(a.type) - prio(b.type) || Math.hypot(a.tx * TILE - base.x, a.ty * TILE - base.y) - Math.hypot(b.tx * TILE - base.x, b.ty * TILE - base.y));
      const k = known[0];
      const def = BUILDINGS[k.type];
      return { x: (k.tx + def.w / 2) * TILE, y: (k.ty + def.h / 2) * TILE };
    }
    for (const e of g.list) {
      if (!e.dead && g.areEnemies(p, e.owner) && g.visibleTo(p, e)) return { x: e.x, y: e.y };
    }
    // Unknown: search plausible start positions not yet explored.
    const cands = this.unexploredStarts(base);
    return cands[0] ?? null;
  }

  private unexploredStarts(base: Vec): Vec[] {
    const g = this.game;
    const w = g.map.width;
    return g.map.starts
      .map((s) => ({ x: s.x * TILE + TILE / 2, y: s.y * TILE + TILE / 2, i: s.y * w + s.x }))
      .filter((s) => Math.hypot(s.x - base.x, s.y - base.y) > TILE * 10 && !this.me.explored[s.i])
      .sort((a, b) => Math.hypot(a.x - base.x, a.y - base.y) - Math.hypot(b.x - base.x, b.y - base.y));
  }

  private scouting(units: Entity[], base: Vec) {
    const g = this.game, p = this.player;
    if (!this.cfg.scout || this.me.known.size > 0) return;
    let scout = units.find((u) => this.roles.get(u.id) === 'scout');
    if (!scout) {
      scout = units.find((u) => u.type === 'scout');
      if (!scout && g.tick > TICK_RATE * 45 && g.hasBuilt(p, 'barracks') && !this.me.queues.infantry.items.some((i) => i.type === 'scout') && this.me.credits > 300) {
        g.issue(p, { t: 'build', cat: 'infantry', type: 'scout' });
      }
      if (!scout) return;
      this.roles.set(scout.id, 'scout');
      this.scoutTargets = this.unexploredStarts(base);
    }
    if (scout.order.type === 'idle' && !scout.moving) {
      const next = this.scoutTargets.shift() ?? this.unexploredStarts(base)[0];
      if (next) g.issue(p, { t: 'move', ids: [scout.id], x: next.x, y: next.y });
      else {
        const x = this.rng.range(TILE * 4, g.worldW - TILE * 4), y = this.rng.range(TILE * 4, g.worldH - TILE * 4);
        g.issue(p, { t: 'move', ids: [scout.id], x, y });
      }
    }
  }

  private engineers(units: Entity[]) {
    const g = this.game, p = this.player;
    if (!this.cfg.engineers || g.tick < TICK_RATE * 60 * 3) return;
    const derricks = [...this.me.known.values()].filter((k) => k.type === 'derrick' && k.owner < 0);
    const engs = units.filter((u) => (u.def as UnitDef).engineer);
    for (const e of engs) {
      if (e.order.type !== 'idle') continue;
      const d = derricks.sort((a, b) => Math.hypot(a.tx * TILE - e.x, a.ty * TILE - e.y) - Math.hypot(b.tx * TILE - e.x, b.ty * TILE - e.y))[0];
      if (d) g.issue(p, { t: 'enter', ids: [e.id], target: d.id });
    }
    if (derricks.length && engs.length === 0 && this.me.credits > 1200 && g.hasBuilt(p, 'barracks') && !this.me.queues.infantry.items.some((i) => i.type === 'engineer'))
      g.issue(p, { t: 'build', cat: 'infantry', type: 'engineer' });
  }

  private sweep() {
    const me = this.me;
    if (me.faction !== 'esd' || me.sweepCooldown > 0 || !this.game.hasBuilt(this.player, 'radar')) return;
    const known = [...me.known.values()].some((k) => k.owner >= 0 && this.game.areEnemies(this.player, k.owner));
    const base = this.game.startPositionOf(this.player);
    const target = known && this.waveTarget ? this.waveTarget : this.unexploredStarts(base)[0];
    if (target) this.game.issue(this.player, { t: 'sweep', x: target.x, y: target.y });
  }
}
