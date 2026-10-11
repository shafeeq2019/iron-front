import { TILE } from '../constants';
import { TERRAIN_BUILDABLE, TERRAIN_PASSABLE, type MapDef } from '../maps/maps';
import type { Entity, Vec } from './types';

/** Static terrain + dynamic building occupancy. */
export class Grid {
  readonly w: number;
  readonly h: number;
  readonly terrainPass: Uint8Array;
  readonly terrainBuild: Uint8Array;
  /** Entity id of the building occupying each tile (0 = none). */
  readonly building: Int32Array;

  constructor(public map: MapDef) {
    this.w = map.width;
    this.h = map.height;
    const n = this.w * this.h;
    this.terrainPass = new Uint8Array(n);
    this.terrainBuild = new Uint8Array(n);
    this.building = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      this.terrainPass[i] = TERRAIN_PASSABLE[map.terrain[i]] ? 1 : 0;
      this.terrainBuild[i] = TERRAIN_BUILDABLE[map.terrain[i]] ? 1 : 0;
    }
  }
  inBounds(tx: number, ty: number) {
    return tx >= 0 && ty >= 0 && tx < this.w && ty < this.h;
  }
  idx(tx: number, ty: number) {
    return ty * this.w + tx;
  }
  passable(tx: number, ty: number): boolean {
    if (!this.inBounds(tx, ty)) return false;
    const i = ty * this.w + tx;
    return this.terrainPass[i] === 1 && this.building[i] === 0;
  }
  passableIdx(i: number): boolean {
    return this.terrainPass[i] === 1 && this.building[i] === 0;
  }
  passableWorld(x: number, y: number): boolean {
    return this.passable(Math.floor(x / TILE), Math.floor(y / TILE));
  }
  occupy(b: Entity, id: number) {
    for (let y = b.ty; y < b.ty + b.h; y++)
      for (let x = b.tx; x < b.tx + b.w; x++) if (this.inBounds(x, y)) this.building[this.idx(x, y)] = id;
  }
  /** Nearest passable tile to (tx,ty) by ring search, or null. */
  nearestPassable(tx: number, ty: number, maxR = 8): Vec | null {
    if (this.passable(tx, ty)) return { x: tx, y: ty };
    for (let r = 1; r <= maxR; r++) {
      let best: Vec | null = null, bd = Infinity;
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = tx + dx, y = ty + dy;
          if (!this.passable(x, y)) continue;
          const d = dx * dx + dy * dy;
          if (d < bd) { bd = d; best = { x, y }; }
        }
      if (best) return best;
    }
    return null;
  }
  /** True if a straight segment between world points crosses only passable tiles. */
  lineClear(x0: number, y0: number, x1: number, y1: number, pad = 0): boolean {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    const steps = Math.ceil(len / (TILE / 4));
    const nx = len > 0 ? -dy / len : 0, ny = len > 0 ? dx / len : 0;
    for (let s = 1; s <= steps; s++) {
      const f = s / steps;
      const x = x0 + dx * f, y = y0 + dy * f;
      if (!this.passableWorld(x, y)) return false;
      if (pad > 0 && (!this.passableWorld(x + nx * pad, y + ny * pad) || !this.passableWorld(x - nx * pad, y - ny * pad))) return false;
    }
    return true;
  }
}

/** Uniform spatial hash for fast proximity queries. Rebuilt every tick. */
export class SpatialHash {
  readonly cell: number;
  readonly cw: number;
  readonly ch: number;
  private cells: Entity[][];
  constructor(worldW: number, worldH: number, cell = TILE * 2) {
    this.cell = cell;
    this.cw = Math.ceil(worldW / cell) + 1;
    this.ch = Math.ceil(worldH / cell) + 1;
    this.cells = Array.from({ length: this.cw * this.ch }, () => []);
  }
  clear() {
    for (const c of this.cells) c.length = 0;
  }
  insert(e: Entity) {
    if (e.kind === 'building') {
      // Buildings are inserted into every cell they overlap.
      const x0 = Math.floor((e.tx * TILE) / this.cell), y0 = Math.floor((e.ty * TILE) / this.cell);
      const x1 = Math.floor(((e.tx + e.w) * TILE - 1) / this.cell), y1 = Math.floor(((e.ty + e.h) * TILE - 1) / this.cell);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.cells[this.ci(x, y)].push(e);
      return;
    }
    this.cells[this.ci(Math.floor(e.x / this.cell), Math.floor(e.y / this.cell))].push(e);
  }
  private ci(x: number, y: number) {
    x = x < 0 ? 0 : x >= this.cw ? this.cw - 1 : x;
    y = y < 0 ? 0 : y >= this.ch ? this.ch - 1 : y;
    return y * this.cw + x;
  }
  /** Calls fn for every entity whose cell overlaps the radius (caller does exact distance check). */
  query(x: number, y: number, r: number, fn: (e: Entity) => void) {
    const x0 = Math.floor((x - r) / this.cell), x1 = Math.floor((x + r) / this.cell);
    const y0 = Math.floor((y - r) / this.cell), y1 = Math.floor((y + r) / this.cell);
    let seen: Set<number> | null = null;
    for (let cy = Math.max(0, y0); cy <= Math.min(this.ch - 1, y1); cy++)
      for (let cx = Math.max(0, x0); cx <= Math.min(this.cw - 1, x1); cx++) {
        for (const e of this.cells[cy * this.cw + cx]) {
          if (e.kind === 'building') {
            seen ??= new Set();
            if (seen.has(e.id)) continue;
            seen.add(e.id);
          }
          fn(e);
        }
      }
  }
}

/** Distance from a point to an entity's edge (buildings) or centre (units), in px. */
export function distToEntity(x: number, y: number, e: Entity): number {
  if (e.kind === 'building') {
    const bx0 = e.tx * TILE, by0 = e.ty * TILE, bx1 = (e.tx + e.w) * TILE, by1 = (e.ty + e.h) * TILE;
    const dx = Math.max(bx0 - x, 0, x - bx1), dy = Math.max(by0 - y, 0, y - by1);
    return Math.hypot(dx, dy);
  }
  return Math.max(0, Math.hypot(e.x - x, e.y - y) - e.radius * 0.5);
}
