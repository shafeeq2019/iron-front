import { fbm, Rng } from '../rng';

export const enum Terrain {
  Grass = 0,
  Dirt = 1,
  Rock = 2,
  Water = 3,
  Trees = 4,
  Road = 5,
}

export const TERRAIN_PASSABLE = [true, true, false, false, false, true];
export const TERRAIN_BUILDABLE = [true, true, false, false, false, true];

export type MapTheme = 'temperate' | 'desert' | 'arctic';
export type Symmetry = 'none' | 'point' | 'quad' | 'mirrorY';

export interface MapDef {
  id: string;
  name: string;
  description: string;
  width: number;
  height: number;
  maxPlayers: number;
  theme: MapTheme;
  terrain: Uint8Array;
  /** Initial ore amount per tile (credits). */
  ore: Uint16Array;
  /** Regrowth cap per tile. */
  oreMax: Uint16Array;
  /** Start positions in tile coords (centre of HQ). */
  starts: { x: number; y: number }[];
  /** Neutral extractor positions (top-left tile). */
  derricks: { x: number; y: number }[];
}

class MapBuilder {
  terrain: Uint8Array;
  ore: Uint16Array;
  rng: Rng;
  constructor(
    public w: number,
    public h: number,
    public seed: number,
    public sym: Symmetry,
  ) {
    this.terrain = new Uint8Array(w * h);
    this.ore = new Uint16Array(w * h);
    this.rng = new Rng(seed);
  }
  /** Returns the symmetric images of a point (including itself). */
  images(x: number, y: number): [number, number][] {
    const W = this.w - 1, H = this.h - 1;
    switch (this.sym) {
      case 'point': return [[x, y], [W - x, H - y]];
      case 'mirrorY': return [[x, y], [x, H - y]];
      case 'quad': return [[x, y], [W - x, y], [x, H - y], [W - x, H - y]];
      default: return [[x, y]];
    }
  }
  inb(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  fill(t: Terrain) {
    this.terrain.fill(t);
  }
  private setRaw(x: number, y: number, t: Terrain) {
    if (!this.inb(x, y)) return;
    const i = y * this.w + x;
    this.terrain[i] = t;
    if (t !== Terrain.Grass && t !== Terrain.Dirt) this.ore[i] = 0;
  }
  blob(cx: number, cy: number, r: number, t: Terrain, rough = 0.35) {
    for (const [x0, y0] of this.images(cx, cy)) {
      for (let y = Math.floor(y0 - r * 1.5); y <= y0 + r * 1.5; y++)
        for (let x = Math.floor(x0 - r * 1.5); x <= x0 + r * 1.5; x++) {
          const d = Math.hypot(x - x0, y - y0);
          const n = fbm(x * 0.25, y * 0.25, this.seed) - 0.5;
          if (d <= r * (1 + n * rough * 2)) this.setRaw(x, y, t);
        }
    }
  }
  rect(x: number, y: number, w: number, h: number, t: Terrain) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      for (const [a, b] of this.images(x + i, y + j)) this.setRaw(a, b, t);
    }
  }
  line(x0: number, y0: number, x1: number, y1: number, width: number, t: Terrain, rough = 0.3) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.ceil(len * 2);
    for (let s = 0; s <= steps; s++) {
      const f = s / steps;
      const x = x0 + (x1 - x0) * f, y = y0 + (y1 - y0) * f;
      const wob = (fbm(x * 0.15, y * 0.15, this.seed + 5) - 0.5) * rough * width * 2;
      this.disc(x, y, width / 2 + wob, t);
    }
  }
  private disc(cx: number, cy: number, r: number, t: Terrain) {
    for (const [x0, y0] of this.images(cx, cy)) {
      for (let y = Math.floor(y0 - r); y <= y0 + r; y++)
        for (let x = Math.floor(x0 - r); x <= x0 + r; x++) {
          if (Math.hypot(x + 0.5 - x0 - 0.5, y + 0.5 - y0 - 0.5) <= r) this.setRaw(x, y, t);
        }
    }
  }
  /** Ore field: denser at the centre. Only placed on grass/dirt. */
  oreField(cx: number, cy: number, r: number, amount: number) {
    for (const [x0, y0] of this.images(cx, cy)) {
      for (let y = Math.floor(y0 - r - 1); y <= y0 + r + 1; y++)
        for (let x = Math.floor(x0 - r - 1); x <= x0 + r + 1; x++) {
          if (!this.inb(x, y)) continue;
          const d = Math.hypot(x - x0, y - y0);
          const n = fbm(x * 0.4, y * 0.4, this.seed + 9);
          if (d > r * (0.75 + n * 0.5)) continue;
          const i = y * this.w + x;
          if (this.terrain[i] !== Terrain.Grass && this.terrain[i] !== Terrain.Dirt) continue;
          const v = Math.round(amount * (1 - (d / (r + 1)) * 0.6) / 25) * 25;
          this.ore[i] = Math.max(this.ore[i], Math.max(50, v));
        }
    }
  }
  clear(cx: number, cy: number, r: number, t: Terrain = Terrain.Grass) {
    for (const [x0, y0] of this.images(cx, cy)) {
      for (let y = Math.floor(y0 - r); y <= y0 + r; y++)
        for (let x = Math.floor(x0 - r); x <= x0 + r; x++) {
          if (!this.inb(x, y)) continue;
          if (Math.hypot(x - x0, y - y0) <= r) {
            const i = y * this.w + x;
            this.terrain[i] = t;
            this.ore[i] = 0;
          }
        }
    }
  }
  /** Sprinkle small obstacle clusters, avoiding the given protected circles. */
  scatter(t: Terrain, count: number, rmin: number, rmax: number, avoid: { x: number; y: number; r: number }[]) {
    let placed = 0, tries = 0;
    while (placed < count && tries++ < count * 30) {
      const x = this.rng.int(2, this.w - 3), y = this.rng.int(2, this.h - 3);
      const r = this.rng.range(rmin, rmax);
      let ok = true;
      for (const [ix, iy] of this.images(x, y))
        for (const a of avoid) if (Math.hypot(ix - a.x, iy - a.y) < a.r + r) ok = false;
      if (!ok) continue;
      this.blob(x, y, r, t, 0.5);
      placed++;
    }
  }
  /** Dirt patches for visual variety. */
  dirtPatches(count: number) {
    for (let k = 0; k < count; k++) {
      const x = this.rng.int(0, this.w - 1), y = this.rng.int(0, this.h - 1);
      const r = this.rng.range(2, 5);
      for (const [x0, y0] of this.images(x, y))
        for (let j = Math.floor(y0 - r); j <= y0 + r; j++)
          for (let i = Math.floor(x0 - r); i <= x0 + r; i++) {
            if (!this.inb(i, j)) continue;
            const idx = j * this.w + i;
            if (this.terrain[idx] === Terrain.Grass && Math.hypot(i - x0, j - y0) < r * (0.7 + fbm(i * 0.3, j * 0.3, this.seed + 3) * 0.6))
              this.terrain[idx] = Terrain.Dirt;
          }
    }
  }
  /** Border of rock so units never leave the map. */
  border() {
    for (let x = 0; x < this.w; x++) {
      this.terrain[x] = Terrain.Rock;
      this.terrain[(this.h - 1) * this.w + x] = Terrain.Rock;
    }
    for (let y = 0; y < this.h; y++) {
      this.terrain[y * this.w] = Terrain.Rock;
      this.terrain[y * this.w + this.w - 1] = Terrain.Rock;
    }
  }
  finish(meta: Omit<MapDef, 'terrain' | 'ore' | 'oreMax' | 'width' | 'height'>): MapDef {
    this.border();
    for (let i = 0; i < this.ore.length; i++) if (this.terrain[i] !== Terrain.Grass && this.terrain[i] !== Terrain.Dirt) this.ore[i] = 0;
    return { ...meta, width: this.w, height: this.h, terrain: this.terrain, ore: this.ore, oreMax: this.ore.slice() };
  }
}

function twinRivers(): MapDef {
  const b = new MapBuilder(96, 96, 1101, 'point');
  b.fill(Terrain.Grass);
  b.dirtPatches(14);
  // River along the anti-diagonal with three fords.
  b.line(95, 0, 47.5, 47.5, 4.2, Terrain.Water, 0.25);
  const fords = [{ x: 47, y: 47 }, { x: 72, y: 23 }];
  for (const f of fords) b.blob(f.x, f.y, 3.2, Terrain.Dirt, 0.15);
  b.rect(46, 44, 3, 8, Terrain.Road);
  const starts = [{ x: 14, y: 14 }, { x: 81, y: 81 }];
  const avoid = [...starts.map((s) => ({ ...s, r: 13 })), ...fords.map((f) => ({ ...f, r: 6 })), { x: 23, y: 72, r: 6 }, { x: 48, y: 48, r: 7 }];
  b.scatter(Terrain.Trees, 22, 1.2, 2.8, avoid);
  b.scatter(Terrain.Rock, 8, 1.5, 2.6, avoid);
  // Tree lines that create flanking lanes.
  b.line(30, 6, 36, 26, 2.4, Terrain.Trees, 0.5);
  b.line(6, 32, 24, 36, 2.4, Terrain.Trees, 0.5);
  b.clear(14, 14, 10);
  b.oreField(26, 10, 3.5, 400);
  b.oreField(9, 27, 3, 350);
  b.oreField(37, 37, 3.2, 600);
  b.oreField(56, 12, 3, 450);
  b.rect(12, 24, 2, 3, Terrain.Road);
  return b.finish({
    id: 'twin-rivers', name: 'Twin Rivers', maxPlayers: 2, theme: 'temperate',
    description: 'A wide river splits the valley. Fight for the three fords and the rich central fields.',
    starts, derricks: [{ x: 60, y: 30 }, { x: 34, y: 64 }],
  });
}

function ironcladPass(): MapDef {
  const b = new MapBuilder(96, 96, 2202, 'mirrorY');
  b.fill(Terrain.Dirt);
  // A massive ridge across the centre with a narrow pass and two long flanking passes.
  b.rect(1, 44, 94, 8, Terrain.Rock);
  b.blob(20, 47, 5, Terrain.Rock, 0.4);
  b.blob(76, 47, 5, Terrain.Rock, 0.4);
  b.rect(45, 44, 6, 8, Terrain.Road);
  b.rect(5, 44, 5, 8, Terrain.Dirt);
  b.rect(86, 44, 5, 8, Terrain.Dirt);
  const starts = [{ x: 48, y: 11 }, { x: 48, y: 84 }];
  const avoid = [...starts.map((s) => ({ ...s, r: 13 })), { x: 48, y: 48, r: 8 }, { x: 7, y: 48, r: 7 }, { x: 88, y: 48, r: 7 }];
  b.scatter(Terrain.Rock, 16, 1.5, 3, avoid);
  b.scatter(Terrain.Trees, 10, 1, 2, avoid);
  b.line(48, 20, 48, 44, 3, Terrain.Road, 0);
  b.clear(48, 11, 10, Terrain.Dirt);
  b.oreField(34, 10, 3.5, 400);
  b.oreField(62, 10, 3.5, 400);
  b.oreField(12, 32, 4, 650);
  b.oreField(84, 32, 4, 650);
  b.oreField(48, 36, 2.5, 300);
  return b.finish({
    id: 'ironclad-pass', name: 'Ironclad Pass', maxPlayers: 2, theme: 'desert',
    description: 'A great ridge divides the desert. Hold the central pass or flank through the long canyons.',
    starts, derricks: [{ x: 4, y: 38 }, { x: 4, y: 56 }, { x: 90, y: 38 }, { x: 90, y: 56 }],
  });
}

function fourCorners(): MapDef {
  const b = new MapBuilder(112, 112, 3303, 'quad');
  b.fill(Terrain.Grass);
  b.dirtPatches(10);
  b.blob(55.5, 55.5, 9, Terrain.Water, 0.3);
  // Forest belts between neighbours form chokepoints.
  b.line(56, 4, 56, 30, 3, Terrain.Trees, 0.6);
  b.line(4, 56, 30, 56, 3, Terrain.Trees, 0.6);
  b.blob(56, 18, 2, Terrain.Grass, 0);
  b.blob(18, 56, 2, Terrain.Grass, 0);
  const starts = [{ x: 14, y: 14 }, { x: 97, y: 97 }, { x: 97, y: 14 }, { x: 14, y: 97 }];
  const avoid = [{ x: 14, y: 14, r: 13 }, { x: 56, y: 18, r: 5 }, { x: 18, y: 56, r: 5 }, { x: 38, y: 38, r: 6 }];
  b.scatter(Terrain.Trees, 14, 1.2, 2.5, avoid);
  b.scatter(Terrain.Rock, 6, 1.5, 2.5, avoid);
  b.clear(14, 14, 10);
  b.oreField(27, 9, 3.2, 400);
  b.oreField(9, 27, 3.2, 400);
  b.oreField(38, 38, 3.5, 650);
  b.rect(22, 22, 12, 2, Terrain.Road);
  return b.finish({
    id: 'four-corners', name: 'Four Corners', maxPlayers: 4, theme: 'temperate',
    description: 'Four bases surround a central lake. Forest belts funnel armies into deadly chokepoints.',
    starts, derricks: [{ x: 44, y: 26 }, { x: 66, y: 26 }, { x: 44, y: 84 }, { x: 66, y: 84 }],
  });
}

function frostbite(): MapDef {
  const b = new MapBuilder(80, 80, 4404, 'point');
  b.fill(Terrain.Grass);
  b.dirtPatches(10);
  const starts = [{ x: 12, y: 40 }, { x: 67, y: 39 }];
  b.blob(40, 20, 6, Terrain.Water, 0.4);
  b.blob(30, 30, 3, Terrain.Rock, 0.4);
  const avoid = [{ x: 12, y: 40, r: 12 }, { x: 40, y: 40, r: 6 }];
  b.scatter(Terrain.Trees, 12, 1, 2.2, avoid);
  b.scatter(Terrain.Rock, 6, 1, 2, avoid);
  b.clear(12, 40, 9);
  b.oreField(12, 28, 3, 400);
  b.oreField(24, 48, 3, 450);
  b.oreField(40, 40, 3.5, 650);
  return b.finish({
    id: 'frostbite', name: 'Frostbite Flats', maxPlayers: 2, theme: 'arctic',
    description: 'A compact frozen battlefield. Short distances mean early fights.',
    starts, derricks: [{ x: 20, y: 62 }, { x: 58, y: 16 }],
  });
}

let cache: MapDef[] | null = null;
export function allMaps(): MapDef[] {
  if (!cache) cache = [twinRivers(), ironcladPass(), fourCorners(), frostbite()];
  return cache;
}
export function getMap(id: string): MapDef | undefined {
  return allMaps().find((m) => m.id === id);
}
export const MAP_IDS = ['twin-rivers', 'ironclad-pass', 'four-corners', 'frostbite'];
