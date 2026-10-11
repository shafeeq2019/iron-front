import { BUILDINGS, Game, TILE, type FactionId } from '../src/index';

/** Creates a 2-player game and removes all starting units (keeps neutral structures). */
export function emptyGame(opts: { mapId?: string; factions?: [FactionId, FactionId]; credits?: number } = {}) {
  const [fa, fb] = opts.factions ?? ['cdc', 'esd'];
  const g = new Game({
    mapId: opts.mapId ?? 'frostbite',
    seed: 1,
    startingCredits: opts.credits ?? 10000,
    players: [
      { name: 'A', faction: fa, color: '#00f', team: 0, isAI: false },
      { name: 'B', faction: fb, color: '#f00', team: 1, isAI: false },
    ],
  });
  g.victoryEnabled = false;
  for (const e of g.list) if (e.owner >= 0) g.removeEntity(e);
  g.list = g.list.filter((e) => !e.dead);
  g.rebuildHash();
  return g;
}

/** Finds an open buildable top-left tile for a w×h footprint near (cx,cy) tiles. */
export function openSpot(g: Game, cx: number, cy: number, w: number, h: number): { x: number; y: number } {
  for (let r = 0; r < 30; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx, y = cy + dy;
        let ok = true;
        for (let j = -1; j <= h && ok; j++)
          for (let i = -1; i <= w && ok; i++) {
            const tx = x + i, ty = y + j;
            if (!g.grid.inBounds(tx, ty)) { ok = false; break; }
            const k = g.grid.idx(tx, ty);
            if (!g.grid.terrainBuild[k] || g.grid.building[k] || g.ore[k] > 0) ok = false;
          }
        if (ok) return { x, y };
      }
  throw new Error('no spot');
}

/** Builds a complete base for player p around tile (cx, cy). Returns the HQ. */
export function giveBase(g: Game, p: number, cx: number, cy: number, types: string[] = ['hq']) {
  const out = [];
  let ox = cx;
  for (const t of types) {
    const def = BUILDINGS[t];
    const spot = openSpot(g, ox, cy, def.w, def.h);
    out.push(g.spawnBuilding(t, p, spot.x, spot.y, 1));
    ox = spot.x + def.w + 1;
  }
  g.rebuildHash();
  g.step();
  return out;
}

export function run(g: Game, ticks: number, each?: () => void) {
  for (let i = 0; i < ticks && !g.result; i++) {
    each?.();
    g.step();
  }
}

export function revealAll(g: Game) {
  for (const p of g.players) p.explored.fill(1);
}

export const T = TILE;
