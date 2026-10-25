import {
  DEFS, ENT_STRIDE, TILE, TYPE_IDS, getMap, unpackBits, X_MOVING,
  type EntityDef, type GameEvent, type MapDef, type MatchResult, type MeView, type PlayerInfo, type Snapshot,
} from '@iron/shared';

export interface ViewEntity {
  id: number;
  type: string;
  def: EntityDef;
  owner: number;
  isBuilding: boolean;
  x: number;
  y: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  angle: number;
  fromA: number;
  toA: number;
  turret: number;
  fromT: number;
  toT: number;
  hp: number;
  maxHp: number;
  extra: number;
  /** Building footprint (tiles). */
  tx: number;
  ty: number;
  w: number;
  h: number;
  /** Accumulated travel distance, drives walk/track animation. */
  travel: number;
  /** Time (ms) this entity first appeared, for spawn effects. */
  born: number;
  lastFire: number;
}

export interface Ghost {
  id: number;
  type: string;
  owner: number;
  tx: number;
  ty: number;
}

function lerpAngle(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** Client-side model of the match, built purely from (fog-filtered) snapshots. */
export class ClientWorld {
  readonly map: MapDef;
  readonly w: number;
  readonly h: number;
  readonly ore: Uint16Array;
  readonly visible: Uint8Array;
  readonly explored: Uint8Array;
  ents = new Map<number, ViewEntity>();
  ghosts: Ghost[] = [];
  me: MeView | null = null;
  players: PlayerInfo[] = [];
  result: MatchResult | null = null;
  tick = 0;
  events: GameEvent[] = [];
  fogVersion = 0;
  oreVersion = 0;
  private lastSnap = 0;
  private interval = 50;
  private snapAt = 0;

  constructor(mapId: string, readonly playerId: number) {
    const m = getMap(mapId);
    if (!m) throw new Error(`Unknown map ${mapId}`);
    this.map = m;
    this.w = m.width;
    this.h = m.height;
    this.ore = m.ore.slice();
    this.visible = new Uint8Array(m.width * m.height);
    this.explored = new Uint8Array(m.width * m.height);
  }

  playerColor(owner: number): string {
    if (owner < 0) return '#b8b8a8';
    return this.players[owner]?.color ?? '#888';
  }
  playerFaction(owner: number) {
    return this.players[owner]?.faction ?? 'cdc';
  }

  applySnapshot(s: Snapshot) {
    const now = performance.now();
    if (this.lastSnap) {
      const dt = Math.min(250, Math.max(16, now - this.lastSnap));
      this.interval = this.interval * 0.8 + dt * 0.2;
    }
    // Lock in current interpolated positions (relative to the previous snapshot) as the new starting points.
    this.update(now, true);
    this.lastSnap = now;
    this.snapAt = now;
    this.tick = s.tick;
    const seen = new Set<number>();
    const ents = s.ents;
    for (let i = 0; i < ents.length; i += ENT_STRIDE) {
      const id = ents[i];
      seen.add(id);
      const type = TYPE_IDS[ents[i + 1]];
      const x = ents[i + 3], y = ents[i + 4];
      const angle = ents[i + 7] / 100, turret = ents[i + 8] / 100;
      let e = this.ents.get(id);
      if (!e || e.type !== type) {
        const def = DEFS[type];
        e = {
          id, type, def, owner: ents[i + 2], isBuilding: def.kind === 'building',
          x, y, fromX: x, fromY: y, toX: x, toY: y,
          angle, fromA: angle, toA: angle, turret, fromT: turret, toT: turret,
          hp: ents[i + 5], maxHp: ents[i + 6], extra: ents[i + 9],
          tx: 0, ty: 0, w: 0, h: 0, travel: 0, born: now, lastFire: 0,
        };
        if (def.kind === 'building') {
          e.w = def.w; e.h = def.h;
          e.tx = Math.round(x / TILE - def.w / 2);
          e.ty = Math.round(y / TILE - def.h / 2);
        }
        this.ents.set(id, e);
      } else {
        e.fromX = e.x; e.fromY = e.y; e.toX = x; e.toY = y;
        e.fromA = e.angle; e.toA = angle;
        e.fromT = e.turret; e.toT = turret;
      }
      e.owner = ents[i + 2];
      e.hp = ents[i + 5];
      e.maxHp = ents[i + 6];
      e.extra = ents[i + 9];
    }
    for (const id of this.ents.keys()) if (!seen.has(id)) this.ents.delete(id);

    this.ghosts = [];
    for (let i = 0; i < s.ghosts.length; i += 5) {
      this.ghosts.push({ id: s.ghosts[i], type: TYPE_IDS[s.ghosts[i + 1]], owner: s.ghosts[i + 2], tx: s.ghosts[i + 3], ty: s.ghosts[i + 4] });
    }
    const n = this.w * this.h;
    // Over the network binary payloads may arrive as ArrayBuffer.
    const bytes = (b: Uint8Array | ArrayBuffer) => (b instanceof Uint8Array ? b : new Uint8Array(b));
    if (s.explored) {
      const ex = unpackBits(bytes(s.explored), n);
      for (let i = 0; i < n; i++) if (ex[i]) this.explored[i] = 1;
      this.fogVersion++;
    }
    if (s.vis) {
      unpackBits(bytes(s.vis), n, this.visible);
      for (let i = 0; i < n; i++) if (this.visible[i]) this.explored[i] = 1;
      this.fogVersion++;
    }
    if (s.ore) {
      for (let i = 0; i < s.ore.length; i += 2) this.ore[s.ore[i]] = s.ore[i + 1];
      this.oreVersion++;
    }
    if (s.players) this.players = s.players;
    this.me = s.me;
    if (s.events.length) this.events.push(...s.events);
    if (s.result) this.result = s.result;
  }

  /** Interpolates render positions between the last two snapshots. */
  update(now: number, lock = false) {
    const t = Math.min(1, (now - this.snapAt) / (this.interval * 1.05));
    for (const e of this.ents.values()) {
      const nx = e.fromX + (e.toX - e.fromX) * t;
      const ny = e.fromY + (e.toY - e.fromY) * t;
      if (!lock) e.travel += Math.hypot(nx - e.x, ny - e.y);
      e.x = nx;
      e.y = ny;
      e.angle = lerpAngle(e.fromA, e.toA, t);
      e.turret = lerpAngle(e.fromT, e.toT, t);
    }
  }

  isVisibleWorld(x: number, y: number) {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return false;
    return this.visible[ty * this.w + tx] === 1;
  }
  isExploredWorld(x: number, y: number) {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return false;
    return this.explored[ty * this.w + tx] === 1;
  }
  oreAtWorld(x: number, y: number) {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return 0;
    return this.explored[ty * this.w + tx] ? this.ore[ty * this.w + tx] : 0;
  }
  isMoving(e: ViewEntity) {
    return (e.extra & X_MOVING) !== 0;
  }

  /** Topmost entity under a world point (units preferred over buildings). */
  pick(x: number, y: number, radiusBonus = 0): ViewEntity | null {
    let best: ViewEntity | null = null, bd = Infinity;
    for (const e of this.ents.values()) {
      if (e.isBuilding) continue;
      const r = (e.def.kind === 'unit' ? e.def.radius : 10) + 4 + radiusBonus;
      // Units have height: their bodies appear slightly north of their ground position.
      const d = Math.min(Math.hypot(e.x - x, e.y - y), Math.hypot(e.x - x, e.y - 7 - y));
      if (d < r && d < bd) { bd = d; best = e; }
    }
    if (best) return best;
    for (const e of this.ents.values()) {
      if (!e.isBuilding) continue;
      const x0 = e.tx * TILE, y0 = e.ty * TILE;
      if (x >= x0 && x < x0 + e.w * TILE && y >= y0 - 26 && y < y0 + e.h * TILE) return e;
    }
    return null;
  }
  pickGhost(x: number, y: number): Ghost | null {
    for (const g of this.ghosts) {
      const d = DEFS[g.type];
      if (d.kind !== 'building') continue;
      if (x >= g.tx * TILE && x < (g.tx + d.w) * TILE && y >= g.ty * TILE && y < (g.ty + d.h) * TILE) return g;
    }
    return null;
  }
}
