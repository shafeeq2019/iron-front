import { AIController, Game, TICK_RATE, type Difficulty } from '../shared/src/index';
const game = new Game({ mapId: process.argv[2] ?? 'twin-rivers', seed: Number(process.argv[5] ?? 7), players: [
  { name: 'Alpha', faction: 'cdc', color: '#3d8bff', team: 0, isAI: true },
  { name: 'Bravo', faction: 'esd', color: '#e8423a', team: 1, isAI: true }] });
const ais = [new AIController(game, 0, (process.argv[3] ?? 'hard') as Difficulty), new AIController(game, 1, (process.argv[4] ?? 'normal') as Difficulty)];
const origIssue = game.issue.bind(game);
const fails = new Map<string, number>();
game.issue = (p, c) => { const r = origIssue(p, c); if (!r.ok) { const k = `${p}:${c.t}:${(c as { type?: string }).type ?? ''}:${r.reason}`; fails.set(k, (fails.get(k) ?? 0) + 1); } return r; };
const mins = Number(process.argv[6] ?? 6);
for (let i = 0; i < TICK_RATE * 60 * mins && !game.result; i++) {
  for (const a of ais) a.update();
  game.step();
  if (game.tick % (TICK_RATE * 60) === 0) for (const p of game.players) {
    const b = game.list.filter((e) => e.owner === p.id && e.kind === 'building').map((e) => e.type).join(',');
    const u: Record<string, number> = {};
    for (const e of game.list) if (e.owner === p.id && e.kind === 'unit') u[e.type] = (u[e.type] ?? 0) + 1;
    console.log(game.tick / 1200, p.name, Math.floor(p.credits), 'B:', b, 'U:', JSON.stringify(u), 'Q:', JSON.stringify(Object.values(p.queues).map((q) => [q.category, q.items.map((it) => it.type), q.ready])), 'K', p.stats.kills);
  }
}
console.log(fails, game.result?.winners, game.tick / 1200);
