import { TILE } from '../constants';
import type { Grid } from './grid';
import type { Vec } from './types';

const SQRT2 = Math.SQRT2;
const DIRS: [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
];

/**
 * Grid A* with octile heuristic, no diagonal corner cutting, generation-stamped
 * buffers (no per-search allocation of node arrays) and a binary heap.
 * If the goal is unreachable it returns a path to the closest reachable tile.
 */
export class PathFinder {
  private g: Float32Array;
  private parent: Int32Array;
  private stamp: Uint32Array;
  private closed: Uint32Array;
  private gen = 0;
  private heap: Int32Array;
  private heapF: Float32Array;
  private heapLen = 0;
  searches = 0;

  constructor(private grid: Grid) {
    const n = grid.w * grid.h;
    this.g = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.heap = new Int32Array(n * 4);
    this.heapF = new Float32Array(n * 4);
  }

  private push(i: number, f: number) {
    let k = this.heapLen++;
    const h = this.heap, hf = this.heapF;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (hf[p] <= f) break;
      h[k] = h[p]; hf[k] = hf[p];
      k = p;
    }
    h[k] = i; hf[k] = f;
  }
  private pop(): number {
    const h = this.heap, hf = this.heapF;
    const top = h[0];
    const n = --this.heapLen;
    if (n > 0) {
      const li = h[n], lf = hf[n];
      let k = 0;
      for (;;) {
        let c = 2 * k + 1;
        if (c >= n) break;
        if (c + 1 < n && hf[c + 1] < hf[c]) c++;
        if (hf[c] >= lf) break;
        h[k] = h[c]; hf[k] = hf[c];
        k = c;
      }
      h[k] = li; hf[k] = lf;
    }
    return top;
  }

  /** Returns tile path from start to goal (excluding start), or null if start is invalid. */
  findTiles(sx: number, sy: number, gx: number, gy: number, maxNodes = 12000): number[] | null {
    const grid = this.grid;
    const W = grid.w;
    if (!grid.inBounds(sx, sy)) return null;
    if (!grid.inBounds(gx, gy)) return null;
    this.searches++;
    // If goal is blocked, aim for the nearest open tile instead.
    if (!grid.passable(gx, gy)) {
      const alt = grid.nearestPassable(gx, gy, 10);
      if (!alt) return null;
      gx = alt.x; gy = alt.y;
    }
    const start = sy * W + sx, goal = gy * W + gx;
    if (start === goal) return [];
    if (++this.gen >= 0xffffffff) { this.gen = 1; this.stamp.fill(0); this.closed.fill(0); }
    const gen = this.gen;
    this.heapLen = 0;
    const hfn = (i: number) => {
      const dx = Math.abs((i % W) - gx), dy = Math.abs(((i / W) | 0) - gy);
      return dx + dy + (SQRT2 - 2) * Math.min(dx, dy);
    };
    this.g[start] = 0;
    this.stamp[start] = gen;
    this.parent[start] = -1;
    this.push(start, hfn(start));
    let best = start, bestH = hfn(start);
    let expanded = 0;
    while (this.heapLen > 0) {
      const cur = this.pop();
      if (this.closed[cur] === gen) continue;
      this.closed[cur] = gen;
      if (cur === goal) { best = cur; break; }
      const hh = hfn(cur);
      if (hh < bestH) { bestH = hh; best = cur; }
      if (++expanded > maxNodes) break;
      const cx = cur % W, cy = (cur / W) | 0;
      const cg = this.g[cur];
      for (const [dx, dy, cost] of DIRS) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= grid.h) continue;
        const ni = ny * W + nx;
        // Allow leaving the start tile even if it is blocked (unit pushed into a building).
        if (!grid.passableIdx(ni)) continue;
        if (dx !== 0 && dy !== 0) {
          if (!grid.passableIdx(cy * W + nx) || !grid.passableIdx(ny * W + cx)) continue;
        }
        if (this.closed[ni] === gen) continue;
        const ng = cg + cost;
        if (this.stamp[ni] !== gen || ng < this.g[ni]) {
          this.stamp[ni] = gen;
          this.g[ni] = ng;
          this.parent[ni] = cur;
          this.push(ni, ng + hfn(ni) * 1.001);
        }
      }
    }
    const out: number[] = [];
    let c = best;
    while (c !== start && c !== -1) {
      out.push(c);
      c = this.parent[c];
    }
    out.reverse();
    return out;
  }

  /** World-space smoothed path (tile centres with line-of-sight string pulling). */
  findPath(from: Vec, to: Vec, pad = 6): Vec[] | null {
    const W = this.grid.w;
    const sx = Math.floor(from.x / TILE), sy = Math.floor(from.y / TILE);
    const gx = Math.floor(to.x / TILE), gy = Math.floor(to.y / TILE);
    const tiles = this.findTiles(sx, sy, gx, gy);
    if (!tiles) return null;
    const pts: Vec[] = tiles.map((i) => ({ x: (i % W) * TILE + TILE / 2, y: Math.floor(i / W) * TILE + TILE / 2 }));
    // Replace final tile centre with the exact destination if it lies in that tile.
    const reachedGoal = tiles.length > 0 && tiles[tiles.length - 1] === gy * W + gx;
    if (reachedGoal) pts[pts.length - 1] = { x: to.x, y: to.y };
    if (pts.length === 0) {
      if (sx === gx && sy === gy) return [{ x: to.x, y: to.y }];
      return [];
    }
    return smooth(this.grid, from, pts, pad);
  }
}

function smooth(grid: Grid, from: Vec, pts: Vec[], pad: number): Vec[] {
  const out: Vec[] = [];
  let anchor = from;
  let i = 0;
  while (i < pts.length) {
    let j = pts.length - 1;
    // Furthest point visible from the anchor (limited look-ahead for cost).
    const limit = Math.min(pts.length - 1, i + 12);
    j = i;
    for (let k = limit; k > i; k--) {
      if (grid.lineClear(anchor.x, anchor.y, pts[k].x, pts[k].y, pad)) { j = k; break; }
    }
    out.push(pts[j]);
    anchor = pts[j];
    i = j + 1;
  }
  return out;
}
