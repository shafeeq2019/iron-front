/**
 * Headless AI-vs-AI simulation: exercises economy, construction, production,
 * combat and victory, and reports simulation performance.
 * Usage: npx tsx scripts/bench.ts [mapId] [diffA] [diffB] [minutes]
 */
import { AIController, Game, TICK_RATE, type Difficulty } from '../shared/src/index';

const mapId = process.argv[2] ?? 'twin-rivers';
const da = (process.argv[3] ?? 'hard') as Difficulty;
const db = (process.argv[4] ?? 'normal') as Difficulty;
const minutes = Number(process.argv[5] ?? 30);
const seed = Number(process.argv[6] ?? 7);

const game = new Game({
  mapId, seed,
  players: [
    { name: 'Alpha', faction: 'cdc', color: '#3d8bff', team: 0, isAI: true },
    { name: 'Bravo', faction: 'esd', color: '#e8423a', team: 1, isAI: true },
  ],
});
const ais = [new AIController(game, 0, da), new AIController(game, 1, db)];
const t0 = performance.now();
let maxTick = 0;
const total = minutes * 60 * TICK_RATE;
for (let i = 0; i < total && !game.result; i++) {
  const a = performance.now();
  for (const ai of ais) ai.update();
  game.step();
  maxTick = Math.max(maxTick, performance.now() - a);
  if (game.tick % (TICK_RATE * 60) === 0) {
    const line = game.players.map((p) => {
      const own = game.list.filter((e) => e.owner === p.id);
      return `${p.name}: $${Math.floor(p.credits)} pw ${p.powerProduced}/${p.powerUsed} bld ${own.filter((e) => e.kind === 'building').length} units ${own.filter((e) => e.kind === 'unit').length} kills ${p.stats.kills} earned ${p.stats.creditsEarned}`;
    });
    console.log(`[${game.tick / TICK_RATE / 60}m] ${line.join(' | ')}`);
  }
}
const ms = performance.now() - t0;
console.log(`ticks=${game.tick} wall=${ms.toFixed(0)}ms avg=${(ms / game.tick).toFixed(3)}ms/tick max=${maxTick.toFixed(1)}ms entities=${game.list.length} paths=${game.pf.searches}`);
console.log('result', game.result ? { winners: game.result.winners, minute: (game.result.tick / TICK_RATE / 60).toFixed(1) } : 'none');
