import { fbm, hash2, TILE, type MapDef, type MapTheme } from '@iron/shared';
import type { RGB } from './color';

const enum T { Grass = 0, Dirt = 1, Rock = 2, Water = 3, Trees = 4, Road = 5 }

interface Palette {
  grass: RGB; grass2: RGB; dirt: RGB; rock: RGB; rockHi: RGB; water: RGB; shallow: RGB; road: RGB; tree: RGB; treeHi: RGB; snowTrees?: boolean;
}

export const PALETTES: Record<MapTheme, Palette> = {
  temperate: { grass: [86, 116, 58], grass2: [64, 94, 44], dirt: [128, 104, 72], rock: [116, 110, 100], rockHi: [176, 170, 156], water: [34, 68, 102], shallow: [62, 114, 128], road: [106, 100, 88], tree: [36, 72, 34], treeHi: [84, 128, 56] },
  desert: { grass: [204, 174, 122], grass2: [188, 156, 104], dirt: [170, 128, 86], rock: [146, 110, 80], rockHi: [206, 170, 128], water: [42, 98, 118], shallow: [86, 150, 150], road: [146, 126, 100], tree: [104, 112, 58], treeHi: [150, 156, 90] },
  arctic: { grass: [222, 228, 234], grass2: [196, 206, 218], dirt: [146, 150, 156], rock: [108, 114, 128], rockHi: [190, 198, 214], water: [58, 94, 126], shallow: [120, 160, 186], road: [154, 154, 158], tree: [40, 68, 58], treeHi: [90, 120, 104], snowTrees: true },
};

const NOISE = 256;
let noiseTex: Float32Array | null = null;
/** Periodic noise texture (NOISE×NOISE) so per-pixel shading is just a lookup. */
function noise(): Float32Array {
  if (noiseTex) return noiseTex;
  noiseTex = new Float32Array(NOISE * NOISE);
  const P = 16; // lattice period
  const per = (x: number, y: number, s: number) => {
    // tileable value noise on a P×P lattice
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const h = (a: number, b: number) => hash2(((a % P) + P) % P, ((b % P) + P) % P, s);
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  for (let y = 0; y < NOISE; y++)
    for (let x = 0; x < NOISE; x++) {
      const fx = (x / NOISE) * P, fy = (y / NOISE) * P;
      noiseTex[y * NOISE + x] = per(fx, fy, 1) * 0.55 + per(fx * 2, fy * 2, 2) * 0.3 + per(fx * 4, fy * 4, 3) * 0.15;
    }
  return noiseTex;
}

export const CHUNK = 512;

/** Lazily renders and caches static terrain in 512px chunks. */
export class TerrainRenderer {
  private chunks = new Map<number, HTMLCanvasElement>();
  readonly cols: number;
  readonly rows: number;
  readonly pal: Palette;

  constructor(readonly map: MapDef, readonly opts: { trees?: boolean; cliffShadows?: boolean } = {}) {
    this.cols = Math.ceil((map.width * TILE) / CHUNK);
    this.rows = Math.ceil((map.height * TILE) / CHUNK);
    this.pal = PALETTES[map.theme];
    noise();
  }

  private tAt(tx: number, ty: number): number {
    const m = this.map;
    if (tx < 0) tx = 0; else if (tx >= m.width) tx = m.width - 1;
    if (ty < 0) ty = 0; else if (ty >= m.height) ty = m.height - 1;
    return m.terrain[ty * m.width + tx];
  }

  /** Draws visible chunks; generates at most `budget` new chunks per call. */
  draw(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, budget = 2) {
    const c0 = Math.max(0, Math.floor(x0 / CHUNK)), c1 = Math.min(this.cols - 1, Math.floor(x1 / CHUNK));
    const r0 = Math.max(0, Math.floor(y0 / CHUNK)), r1 = Math.min(this.rows - 1, Math.floor(y1 / CHUNK));
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const key = r * this.cols + c;
        let cv = this.chunks.get(key);
        if (!cv) {
          if (budget <= 0) {
            ctx.fillStyle = `rgb(${this.pal.grass.join(',')})`;
            ctx.fillRect(c * CHUNK, r * CHUNK, CHUNK, CHUNK);
            continue;
          }
          budget--;
          cv = this.renderChunk(c, r);
          this.chunks.set(key, cv);
        }
        ctx.drawImage(cv, c * CHUNK, r * CHUNK, CHUNK + 0.5, CHUNK + 0.5);
      }
    return budget;
  }

  pregenerate(count: number) {
    for (let r = 0; r < this.rows && count > 0; r++)
      for (let c = 0; c < this.cols && count > 0; c++) {
        const key = r * this.cols + c;
        if (!this.chunks.has(key)) { this.chunks.set(key, this.renderChunk(c, r)); count--; }
      }
  }

  /** Bilinear "dirtiness" of the ground at a world point (1 = dirt tile, 0 = grass). */
  private dirtWeight(x: number, y: number): number {
    const fx = x / TILE - 0.5, fy = y / TILE - 0.5;
    const tx = Math.floor(fx), ty = Math.floor(fy), u = fx - tx, v = fy - ty;
    const d = (i: number, j: number) => (this.tAt(i, j) === T.Dirt ? 1 : 0);
    const a = d(tx, ty), b = d(tx + 1, ty), c = d(tx, ty + 1), e = d(tx + 1, ty + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + e) * u * v;
  }

  /** Renders one CHUNK×CHUNK ground texture (also used as a 3D terrain texture). */
  renderChunk(cx: number, cy: number): HTMLCanvasElement {
    const cv = document.createElement('canvas');
    cv.width = CHUNK;
    cv.height = CHUNK;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(CHUNK, CHUNK);
    const d = img.data;
    const N = noise();
    const pal = this.pal;
    const ox = cx * CHUNK, oy = cy * CHUNK;
    const nAt = (x: number, y: number) => N[((y & (NOISE - 1)) * NOISE) + (x & (NOISE - 1))];
    for (let py = 0; py < CHUNK; py++) {
      const wy = oy + py;
      for (let px = 0; px < CHUNK; px++) {
        const wx = ox + px;
        const n = nAt(wx, wy);
        const n2 = nAt(wx * 3 + 91, wy * 3 + 17);
        const warpX = (nAt(wx + 137, wy + 71) - 0.5) * 18;
        const warpY = (nAt(wx + 311, wy + 199) - 0.5) * 18;
        const sx = wx + warpX, sy = wy + warpY;
        const t = this.tAt(Math.floor(sx / TILE), Math.floor(sy / TILE));
        let r: number, g: number, b: number;
        switch (t) {
          case T.Rock: {
            const up = this.tAt(Math.floor((sx - 5) / TILE), Math.floor((sy - 5) / TILE)) !== T.Rock;
            const dn = this.tAt(Math.floor((sx + 5) / TILE), Math.floor((sy + 6) / TILE)) !== T.Rock;
            const k = 0.78 + n * 0.4 + (n2 - 0.5) * 0.18;
            const base = up ? pal.rockHi : pal.rock;
            r = base[0] * k; g = base[1] * k; b = base[2] * k;
            if (dn) { r *= 0.55; g *= 0.55; b *= 0.55; }
            if (n2 > 0.72) { r *= 0.8; g *= 0.8; b *= 0.8; }
            break;
          }
          case T.Water: {
            let shore = false;
            for (const [dx, dy] of [[-6, 0], [6, 0], [0, -6], [0, 6]]) if (this.tAt(Math.floor((sx + dx) / TILE), Math.floor((sy + dy) / TILE)) !== T.Water) shore = true;
            const base = shore ? pal.shallow : pal.water;
            const k = 0.85 + n * 0.3;
            r = base[0] * k; g = base[1] * k; b = base[2] * k;
            if (n2 > 0.8 && !shore) { r += 18; g += 22; b += 26; }
            break;
          }
          case T.Road: {
            const k = 0.9 + n2 * 0.15;
            r = pal.road[0] * k; g = pal.road[1] * k; b = pal.road[2] * k;
            const lx = wx % TILE, ly = wy % TILE;
            if ((lx < 1 || ly < 1) && n2 > 0.4) { r *= 0.88; g *= 0.88; b *= 0.88; }
            break;
          }
          default: {
            // Grass and dirt blend smoothly using an interpolated, noise-perturbed dirt weight.
            const mixT = Math.min(1, Math.max(0, (n - 0.35) * 2.2));
            const a = pal.grass, c2 = pal.grass2;
            const k = 0.9 + (n2 - 0.5) * 0.22;
            r = (a[0] + (c2[0] - a[0]) * mixT) * k;
            g = (a[1] + (c2[1] - a[1]) * mixT) * k;
            b = (a[2] + (c2[2] - a[2]) * mixT) * k;
            const dw = this.dirtWeight(wx, wy) + (n - 0.5) * 0.6 + (n2 - 0.5) * 0.3;
            const f = Math.min(1, Math.max(0, (dw - 0.38) / 0.24));
            if (f > 0) {
              const kd = 0.82 + n * 0.32 + (n2 - 0.5) * 0.12;
              r += (pal.dirt[0] * kd - r) * f; g += (pal.dirt[1] * kd - g) * f; b += (pal.dirt[2] * kd - b) * f;
            }
            if (t === T.Trees) { r *= 0.72; g *= 0.78; b *= 0.72; }
          }
        }
        // Cliffs cast soft shadows to the lower-right.
        if (t !== T.Rock && this.opts.cliffShadows !== false) {
          if (this.tAt(Math.floor((sx - 7) / TILE), Math.floor((sy - 8) / TILE)) === T.Rock) { r *= 0.7; g *= 0.7; b *= 0.7; }
          // Map edge vignette handled by the rock border.
        }
        const i = (py * CHUNK + px) * 4;
        d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    if (this.opts.trees !== false) this.drawTrees(ctx, ox, oy);
    this.drawDetails(ctx, ox, oy);
    return cv;
  }

  private drawTrees(ctx: CanvasRenderingContext2D, ox: number, oy: number) {
    const m = this.map, pal = this.pal;
    const t0x = Math.floor(ox / TILE) - 1, t0y = Math.floor(oy / TILE) - 1;
    const t1x = Math.floor((ox + CHUNK) / TILE) + 1, t1y = Math.floor((oy + CHUNK) / TILE) + 1;
    const canopies: [number, number, number][] = [];
    for (let ty = t0y; ty <= t1y; ty++)
      for (let tx = t0x; tx <= t1x; tx++) {
        if (tx < 0 || ty < 0 || tx >= m.width || ty >= m.height) continue;
        if (m.terrain[ty * m.width + tx] !== T.Trees) continue;
        const count = 2 + Math.floor(hash2(tx, ty, 5) * 2);
        for (let k = 0; k < count; k++) {
          const x = tx * TILE + 6 + hash2(tx, ty, 11 + k) * 20 - ox;
          const y = ty * TILE + 6 + hash2(tx, ty, 23 + k) * 20 - oy;
          const r = 8 + hash2(tx, ty, 31 + k) * 6;
          canopies.push([x, y, r]);
        }
      }
    canopies.sort((a, b) => a[1] - b[1]);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    for (const [x, y, r] of canopies) { ctx.beginPath(); ctx.ellipse(x + 4, y + 5, r, r * 0.85, 0, 0, Math.PI * 2); ctx.fill(); }
    for (const [x, y, r] of canopies) {
      const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.15, x, y, r);
      g.addColorStop(0, `rgb(${pal.treeHi.join(',')})`);
      g.addColorStop(1, `rgb(${pal.tree.map((v) => v * 0.8).join(',')})`);
      ctx.fillStyle = g;
      if (this.pal === PALETTES.arctic) {
        // Pines: star-shaped canopies with snow.
        ctx.beginPath();
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2, rr = i % 2 ? r * 0.55 : r;
          ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        }
        ctx.fill();
        ctx.fillStyle = 'rgba(240,245,250,0.85)';
        ctx.beginPath(); ctx.arc(x - r * 0.2, y - r * 0.25, r * 0.35, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1; ctx.stroke();
      }
    }
  }

  /** Small decorative details: pebbles, grass tufts. */
  private drawDetails(ctx: CanvasRenderingContext2D, ox: number, oy: number) {
    const m = this.map;
    const tx0 = Math.floor(ox / TILE), ty0 = Math.floor(oy / TILE);
    for (let ty = ty0; ty < ty0 + CHUNK / TILE; ty++)
      for (let tx = tx0; tx < tx0 + CHUNK / TILE; tx++) {
        if (tx >= m.width || ty >= m.height) continue;
        const t = m.terrain[ty * m.width + tx];
        if (t !== T.Grass && t !== T.Dirt) continue;
        const h = hash2(tx, ty, 77);
        if (h > 0.22) continue;
        const x = tx * TILE + hash2(tx, ty, 78) * TILE - ox, y = ty * TILE + hash2(tx, ty, 79) * TILE - oy;
        ctx.fillStyle = t === T.Dirt ? 'rgba(60,50,40,0.35)' : 'rgba(30,50,20,0.25)';
        ctx.beginPath(); ctx.ellipse(x, y, 2 + h * 6, 1.5 + h * 4, h * 6, 0, Math.PI * 2); ctx.fill();
        if (h < 0.07) { ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.beginPath(); ctx.arc(x - 1, y - 1, 1.2, 0, Math.PI * 2); ctx.fill(); }
      }
  }

  /** 1px-per-tile colour image used for the minimap. */
  minimapImage(): HTMLCanvasElement {
    const m = this.map, pal = this.pal;
    const cv = document.createElement('canvas');
    cv.width = m.width; cv.height = m.height;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(m.width, m.height);
    for (let i = 0; i < m.width * m.height; i++) {
      const t = m.terrain[i];
      const c = t === T.Rock ? pal.rock : t === T.Water ? pal.water : t === T.Trees ? pal.tree : t === T.Dirt ? pal.dirt : t === T.Road ? pal.road : pal.grass;
      const k = 0.9 + fbm(i % m.width, Math.floor(i / m.width), 3, 1) * 0.2;
      img.data[i * 4] = c[0] * k; img.data[i * 4 + 1] = c[1] * k; img.data[i * 4 + 2] = c[2] * k; img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  }
}

// ---------------------------------------------------------------- ore

const oreSprites: HTMLCanvasElement[][] = [];
/** Crystal clusters: [variant][density 0..4], 32×32 logical px at 2× resolution. */
export function oreSprite(variant: number, density: number): HTMLCanvasElement {
  if (!oreSprites.length) {
    for (let v = 0; v < 4; v++) {
      const row: HTMLCanvasElement[] = [];
      for (let dn = 0; dn < 5; dn++) {
        const c = document.createElement('canvas');
        c.width = 64; c.height = 64;
        const ctx = c.getContext('2d')!;
        ctx.scale(2, 2);
        const count = 2 + dn * 2;
        for (let k = 0; k < count; k++) {
          const x = 4 + hash2(v, k, 3) * 24, y = 4 + hash2(v, k, 4) * 24;
          const s = 2.2 + hash2(v, k, 5) * (2 + dn * 0.6);
          ctx.fillStyle = 'rgba(0,0,0,0.3)';
          ctx.beginPath(); ctx.ellipse(x + 1.5, y + 1.8, s, s * 0.6, 0, 0, Math.PI * 2); ctx.fill();
          const g = ctx.createLinearGradient(x - s, y - s, x + s, y + s);
          g.addColorStop(0, '#ffe58a'); g.addColorStop(0.5, '#e0a526'); g.addColorStop(1, '#8a5a12');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.moveTo(x, y - s * 1.3); ctx.lineTo(x + s * 0.8, y - s * 0.1); ctx.lineTo(x + s * 0.3, y + s * 0.8);
          ctx.lineTo(x - s * 0.6, y + s * 0.6); ctx.lineTo(x - s * 0.8, y - s * 0.3);
          ctx.closePath(); ctx.fill();
          ctx.strokeStyle = 'rgba(80,50,10,0.6)'; ctx.lineWidth = 0.5; ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,230,0.8)';
          ctx.fillRect(x - s * 0.3, y - s * 0.7, 0.9, 0.9);
        }
        row.push(c);
      }
      oreSprites.push(row);
    }
  }
  return oreSprites[variant & 3][Math.max(0, Math.min(4, density))];
}
