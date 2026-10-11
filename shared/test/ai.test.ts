import { describe, expect, it } from 'vitest';
import { AIController, Game, TICK_RATE, type Difficulty } from '../src/index';

function aiMatch(a: Difficulty, b: Difficulty, seed: number, minutes: number, mapId = 'twin-rivers') {
  const g = new Game({
    mapId, seed,
    players: [
      { name: 'A', faction: 'cdc', color: '#00f', team: 0, isAI: true },
      { name: 'B', faction: 'esd', color: '#f00', team: 1, isAI: true },
    ],
  });
  const ais = [new AIController(g, 0, a), new AIController(g, 1, b)];
  for (let i = 0; i < minutes * 60 * TICK_RATE && !g.result; i++) {
    for (const ai of ais) ai.update();
    g.step();
  }
  return g;
}

describe('AI', () => {
  it('deploys its MCV and builds an economy within three minutes', () => {
    const g = aiMatch('normal', 'normal', 5, 3);
    for (const p of [0, 1]) {
      expect(g.hasBuilt(p, 'hq')).toBe(true);
      expect(g.hasBuilt(p, 'power')).toBe(true);
      expect(g.hasBuilt(p, 'refinery')).toBe(true);
      expect(g.hasBuilt(p, 'barracks')).toBe(true);
      expect(g.players[p].stats.creditsEarned).toBeGreaterThan(1000);
    }
  });

  it('only issues commands that the rules accept most of the time', () => {
    const g = new Game({ mapId: 'frostbite', seed: 2, players: [
      { name: 'A', faction: 'esd', color: '#00f', team: 0, isAI: true },
      { name: 'B', faction: 'cdc', color: '#f00', team: 1, isAI: true }] });
    const ais = [new AIController(g, 0, 'hard'), new AIController(g, 1, 'easy')];
    let ok = 0, bad = 0;
    const orig = g.issue.bind(g);
    g.issue = (p, c) => { const r = orig(p, c); if (r.ok) ok++; else bad++; return r; };
    for (let i = 0; i < 5 * 60 * TICK_RATE; i++) { for (const a of ais) a.update(); g.step(); }
    expect(ok).toBeGreaterThan(50);
    expect(bad / (ok + bad)).toBeLessThan(0.2);
  });

  it('hard AI defeats easy AI', () => {
    const g = aiMatch('hard', 'easy', 9, 30);
    expect(g.result).not.toBeNull();
    expect(g.result!.winners).toEqual([0]);
  });

  it('normal AI defeats easy AI on another map', () => {
    const g = aiMatch('easy', 'normal', 4, 35, 'ironclad-pass');
    expect(g.result).not.toBeNull();
    expect(g.result!.winners).toEqual([1]);
  });
});
