import { TYPE_INDEX, type QueueCategory } from '../data/defs';
import type { FactionId } from '../data/defs';
import type { Game } from './game';
import type { GameEvent, MatchResult } from './types';

/** Fields per entity in Snapshot.ents. */
export const ENT_STRIDE = 10;
/** Offsets within an entity record. */
export const E = { id: 0, type: 1, owner: 2, x: 3, y: 4, hp: 5, maxHp: 6, angle: 7, turret: 8, extra: 9 } as const;
/** extra bitfield: low 7 bits percent (construction or cargo), then flags. */
export const X_REPAIR = 128;
export const X_MOVING = 256;
export const X_HARVESTING = 512;
export const X_LOWPOWER = 1024;

export interface QueueView {
  cat: QueueCategory;
  items: [type: string, progress: number][];
  ready: string | null;
  onHold: boolean;
}

export interface MeView {
  id: number;
  credits: number;
  power: [number, number];
  queues: QueueView[];
  /** Ticks until Recon Sweep is ready; -1 if unavailable. */
  sweep: number;
  defeated: boolean;
  /** Rally points of own production buildings: [id, x, y, ...]. */
  rallies: number[];
  /** Repairing own buildings ids. */
}

export interface PlayerInfo {
  id: number;
  name: string;
  faction: FactionId;
  color: string;
  team: number;
  defeated: boolean;
  isAI: boolean;
}

export interface Snapshot {
  tick: number;
  me: MeView;
  /** Flat entity records, ENT_STRIDE numbers each. */
  ents: number[];
  /** Remembered enemy structures not currently visible: [id, typeIdx, owner, tx, ty]. */
  ghosts: number[];
  /** Visibility bitset (row-major tiles), present when fog changed. */
  vis?: Uint8Array;
  /** Explored bitset; only sent on (re)join. */
  explored?: Uint8Array;
  /** Ore updates: [tileIndex, amount, ...]. */
  ore?: number[];
  events: GameEvent[];
  players?: PlayerInfo[];
  result?: MatchResult;
}

export function packBits(src: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.ceil(src.length / 8));
  for (let i = 0; i < src.length; i++) if (src[i]) out[i >> 3] |= 1 << (i & 7);
  return out;
}
export function unpackBits(bits: Uint8Array, n: number, out: Uint8Array = new Uint8Array(n)): Uint8Array {
  for (let i = 0; i < n; i++) out[i] = (bits[i >> 3] >> (i & 7)) & 1;
  return out;
}

const round2 = (a: number) => Math.round(a * 100);

/**
 * Builds fog-filtered snapshots for one player. Holds per-player pending state
 * (events and ore changes since the last snapshot).
 */
export class SnapshotBuilder {
  private events: GameEvent[] = [];
  private pendingOre = new Set<number>();
  private lastFog = -1;
  private sentExplored = false;
  private lastPlayersKey = '';

  constructor(public readonly game: Game, public readonly player: number) {}

  /** Call after every simulation tick. */
  collect() {
    const g = this.game, p = this.player;
    for (const ev of g.events) if (this.eventVisible(ev)) this.events.push(ev);
    if (this.events.length > 400) this.events.splice(0, this.events.length - 400);
    for (const i of g.oreChanged) this.pendingOre.add(i);
    void p;
  }

  /** Forces the next snapshot to include full fog/explored/player info (e.g. after reconnect). */
  reset() {
    this.lastFog = -1;
    this.sentExplored = false;
    this.lastPlayersKey = '';
    for (const i of this.game.oreTiles) this.pendingOre.add(i);
  }

  private eventVisible(ev: GameEvent): boolean {
    const g = this.game, p = this.player;
    const pl = g.players[p];
    const vis = (x: number, y: number) => {
      const tx = Math.floor(x / 32), ty = Math.floor(y / 32);
      if (tx < 0 || ty < 0 || tx >= g.map.width || ty >= g.map.height) return false;
      return pl.visible[ty * g.map.width + tx] > 0;
    };
    switch (ev.e) {
      case 'notice':
      case 'sweep':
        return ev.p === p;
      case 'fire':
        return g.isAllied(p, ev.o) || vis(ev.x, ev.y) || vis(ev.tx, ev.ty);
      case 'arc':
        return vis(ev.pts[0], ev.pts[1]) || vis(ev.pts[2], ev.pts[3]);
      case 'death':
      case 'placed':
      case 'capture':
        return g.isAllied(p, ev.o) || vis(ev.x, ev.y);
      case 'hit':
        return vis(ev.x, ev.y);
    }
  }

  build(): Snapshot {
    const g = this.game, p = this.player;
    const pl = g.players[p];
    const ents: number[] = [];
    const seen = new Set<number>();
    for (const e of g.list) {
      if (e.dead) continue;
      if (!g.isAllied(p, e.owner) && !g.visibleTo(p, e)) continue;
      seen.add(e.id);
      let extra = 0;
      if (e.kind === 'building') {
        extra = Math.round(e.built * 100);
        if (e.repairing) extra |= X_REPAIR;
        if (e.owner >= 0 && g.lowPower(e.owner) && g.isAllied(p, e.owner)) extra |= X_LOWPOWER;
      } else {
        if (e.def.kind === 'unit' && e.def.harvester) {
          extra = Math.round((e.cargo / 700) * 100);
          if (e.hState === 'mining') extra |= X_HARVESTING;
        }
        if (e.moving) extra |= X_MOVING;
      }
      ents.push(e.id, TYPE_INDEX[e.type], e.owner, Math.round(e.x), Math.round(e.y), Math.ceil(e.hp), e.maxHp, round2(e.angle), round2(e.turretAngle), extra);
    }
    const ghosts: number[] = [];
    for (const k of pl.known.values()) {
      if (seen.has(k.id)) continue;
      ghosts.push(k.id, TYPE_INDEX[k.type], k.owner, k.tx, k.ty);
    }
    const rallies: number[] = [];
    for (const e of g.list) if (!e.dead && e.owner === p && e.hasRally) rallies.push(e.id, Math.round(e.rallyX), Math.round(e.rallyY));

    const queues: QueueView[] = (Object.keys(pl.queues) as QueueCategory[]).map((cat) => {
      const q = pl.queues[cat];
      const prodType = cat === 'infantry' ? 'barracks' : cat === 'vehicle' ? 'factory' : 'hq';
      return {
        cat,
        items: q.items.map((it) => [it.type, Math.min(1, it.progress / it.total)] as [string, number]),
        ready: q.ready,
        onHold: q.items.length > 0 && !g.hasBuilt(p, prodType),
      };
    });

    const snap: Snapshot = {
      tick: g.tick,
      me: {
        id: p,
        credits: Math.floor(pl.credits),
        power: [pl.powerProduced, pl.powerUsed],
        queues,
        sweep: pl.faction === 'esd' && g.hasBuilt(p, 'radar') ? pl.sweepCooldown : -1,
        defeated: pl.defeated,
        rallies,
      },
      ents,
      ghosts,
      events: this.events,
    };
    this.events = [];

    if (this.lastFog !== g.fogVersion) {
      this.lastFog = g.fogVersion;
      snap.vis = packBits(pl.visible);
    }
    if (!this.sentExplored) {
      this.sentExplored = true;
      snap.explored = packBits(pl.explored);
    }
    if (this.pendingOre.size) {
      const ore: number[] = [];
      for (const i of this.pendingOre) {
        if (pl.visible[i]) {
          ore.push(i, g.ore[i]);
          this.pendingOre.delete(i);
        }
      }
      if (ore.length) snap.ore = ore;
    }
    const players: PlayerInfo[] = g.players.map((x) => ({ id: x.id, name: x.name, faction: x.faction, color: x.color, team: x.team, defeated: x.defeated, isAI: x.isAI }));
    const key = JSON.stringify(players);
    if (key !== this.lastPlayersKey) {
      this.lastPlayersKey = key;
      snap.players = players;
    }
    if (g.result) snap.result = g.result;
    return snap;
  }
}
