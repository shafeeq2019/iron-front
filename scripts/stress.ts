/**
 * Large-battle stress test: N units per side clash in the open.
 * Usage: npx tsx scripts/stress.ts [unitsPerSide=200] [seconds=60]
 */
import { Game, SnapshotBuilder, TICK_RATE, TILE } from '../shared/src/index';

const perSide = Number(process.argv[2] ?? 200);
const seconds = Number(process.argv[3] ?? 60);
const g = new Game({
  mapId: 'four-corners', seed: 3,
  players: [
    { name: 'A', faction: 'cdc', color: '#00f', team: 1, isAI: false },
    { name: 'B', faction: 'esd', color: '#f00', team: 2, isAI: false },
  ],
});
g.victoryEnabled = false;
const typesA = ['rifle', 'rocket', 'lighttank', 'heavytank', 'artillery'];
const typesB = ['rifle', 'rocket', 'raider', 'mauler', 'hailstorm'];
const idsA: number[] = [], idsB: number[] = [];
for (let i = 0; i < perSide; i++) {
  const row = Math.floor(i / 20), col = i % 20;
  idsA.push(g.spawnUnit(typesA[i % 5], 0, (30 + col * 1.2) * TILE, (60 + row * 1.2) * TILE).id);
  idsB.push(g.spawnUnit(typesB[i % 5], 1, (82 - col * 1.2) * TILE, (60 + row * 1.2) * TILE).id);
}
g.rebuildHash();
g.issue(0, { t: 'attackMove', ids: idsA, x: 85 * TILE, y: 64 * TILE });
g.issue(1, { t: 'attackMove', ids: idsB, x: 27 * TILE, y: 64 * TILE });
const snaps = [new SnapshotBuilder(g, 0), new SnapshotBuilder(g, 1)];
let worst = 0, total = 0, snapMs = 0, bytes = 0;
const ticks = seconds * TICK_RATE;
for (let t = 0; t < ticks; t++) {
  const a = performance.now();
  g.step();
  const b = performance.now();
  for (const s of snaps) s.collect();
  if (t % 2 === 0) for (const s of snaps) { const snap = s.build(); if (t % 40 === 0) bytes = JSON.stringify({ ...snap, vis: undefined, explored: undefined }).length; }
  snapMs += performance.now() - b;
  if (b - a > 20) console.log("slow tick", t, (b - a).toFixed(1));
  worst = Math.max(worst, b - a);
  total += b - a;
}
const alive = (p: number) => g.list.filter((e) => e.owner === p && e.kind === 'unit').length;
console.log(`${perSide * 2} units, ${ticks} ticks: avg ${(total / ticks).toFixed(2)} ms/tick, worst ${worst.toFixed(1)} ms, snapshot build avg ${(snapMs / ticks).toFixed(2)} ms/tick, ~${(bytes / 1024).toFixed(1)} KB per snapshot (JSON)`);
console.log(`survivors A=${alive(0)} B=${alive(1)} paths=${g.pf.searches}`);
