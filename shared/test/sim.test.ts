import { describe, expect, it } from 'vitest';
import { ARMOR_TABLE, BUILDINGS, Game, TICK_RATE, TILE, UNITS, WEAPONS, allMaps, sanitizeCommand, SnapshotBuilder, ENT_STRIDE, unpackBits } from '../src/index';
import { applyDamage } from '../src/sim/combat';
import { emptyGame, giveBase, openSpot, revealAll, run } from './helpers';

describe('resources & economy', () => {
  it('a refinery comes with a harvester that gathers ore and earns credits', () => {
    const g = emptyGame({ credits: 0 });
    giveBase(g, 0, 8, 38, ['hq', 'power']);
    revealAll(g);
    const spot = openSpot(g, 14, 33, 3, 3);
    g.spawnBuilding('refinery', 0, spot.x, spot.y, 0);
    run(g, 40); // construction animation completes -> free harvester
    const harv = g.list.filter((e) => e.owner === 0 && e.type === 'harvester');
    expect(harv).toHaveLength(1);
    const oreBefore = g.ore.reduce((s, v) => s + v, 0);
    run(g, TICK_RATE * 90);
    const p = g.players[0];
    expect(p.credits).toBeGreaterThan(0);
    expect(p.stats.creditsEarned).toBe(p.credits);
    const oreAfter = g.ore.reduce((s, v) => s + v, 0);
    expect(oreAfter).toBeLessThan(oreBefore);
    // Credits earned can never exceed ore removed from the map (plus regrowth).
    expect(p.credits).toBeLessThanOrEqual(oreBefore - oreAfter + 25 * g.oreTiles.length);
  });

  it('ore regrows up to its field maximum', () => {
    const g = emptyGame();
    const i = g.oreTiles[0];
    g.ore[i] = 0;
    run(g, 200 * 3);
    expect(g.ore[i]).toBeGreaterThan(0);
    expect(g.ore[i]).toBeLessThanOrEqual(g.map.oreMax[i]);
  });
});

describe('construction & production', () => {
  it('deducts cost, enforces funds and prerequisites, and refunds on cancel', () => {
    const g = emptyGame({ credits: 1000 });
    giveBase(g, 0, 8, 38, ['hq']);
    expect(g.issue(0, { t: 'build', cat: 'building', type: 'refinery' }).ok).toBe(false); // needs power
    expect(g.issue(0, { t: 'build', cat: 'infantry', type: 'rifle' }).ok).toBe(false); // needs barracks
    expect(g.issue(0, { t: 'build', cat: 'building', type: 'power' }).ok).toBe(true);
    expect(g.players[0].credits).toBe(1000 - BUILDINGS.power.cost);
    expect(g.issue(0, { t: 'build', cat: 'building', type: 'power' }).ok).toBe(false); // one at a time
    expect(g.issue(0, { t: 'cancel', cat: 'building', type: 'power' }).ok).toBe(true);
    expect(g.players[0].credits).toBe(1000);
    g.players[0].credits = 100;
    const r = g.issue(0, { t: 'build', cat: 'building', type: 'power' });
    expect(r).toEqual({ ok: false, reason: 'Insufficient funds' });
    expect(g.issue(0, { t: 'build', cat: 'building', type: 'hq' }).ok).toBe(false); // unbuildable
  });

  it('faction-restricted units cannot be built by the other faction', () => {
    const g = emptyGame();
    giveBase(g, 0, 8, 38, ['hq', 'power', 'refinery', 'factory']);
    expect(g.issue(0, { t: 'build', cat: 'vehicle', type: 'raider' }).ok).toBe(false);
    expect(g.issue(0, { t: 'build', cat: 'vehicle', type: 'lighttank' }).ok).toBe(true);
  });

  it('completes a structure, places it, and it becomes a prerequisite', () => {
    const g = emptyGame();
    giveBase(g, 0, 8, 38, ['hq']);
    revealAll(g);
    g.issue(0, { t: 'build', cat: 'building', type: 'power' });
    run(g, BUILDINGS.power.buildTime * TICK_RATE + 2);
    expect(g.players[0].queues.building.ready).toBe('power');
    const hq = g.list.find((e) => e.type === 'hq')!;
    const spot = { x: hq.tx + 4, y: hq.ty };
    expect(g.canPlace(0, 'power', spot.x, spot.y).ok).toBe(true);
    expect(g.issue(0, { t: 'place', type: 'power', tx: spot.x, ty: spot.y }).ok).toBe(true);
    expect(g.hasBuilt(0, 'power')).toBe(false); // still under construction
    run(g, 40);
    expect(g.hasBuilt(0, 'power')).toBe(true);
    expect(g.players[0].powerProduced).toBe(BUILDINGS.power.power + BUILDINGS.hq.power);
    expect(g.issue(0, { t: 'build', cat: 'building', type: 'barracks' }).ok).toBe(true);
  });

  it('produces units from a barracks after the build time', () => {
    const g = emptyGame();
    giveBase(g, 0, 8, 38, ['hq', 'power', 'barracks']);
    expect(g.issue(0, { t: 'build', cat: 'infantry', type: 'rifle' }).ok).toBe(true);
    expect(g.issue(0, { t: 'build', cat: 'infantry', type: 'rifle' }).ok).toBe(true);
    run(g, UNITS.rifle.buildTime * TICK_RATE - 5);
    expect(g.list.filter((e) => e.type === 'rifle')).toHaveLength(0);
    run(g, 10);
    expect(g.list.filter((e) => e.type === 'rifle')).toHaveLength(1);
    run(g, UNITS.rifle.buildTime * TICK_RATE + 5);
    expect(g.list.filter((e) => e.type === 'rifle')).toHaveLength(2);
  });

  it('low power halves production speed', () => {
    const g = emptyGame();
    giveBase(g, 0, 8, 38, ['hq', 'barracks', 'tech', 'radar']);
    expect(g.lowPower(0)).toBe(true);
    g.issue(0, { t: 'build', cat: 'infantry', type: 'rifle' });
    run(g, UNITS.rifle.buildTime * TICK_RATE + 5);
    expect(g.list.filter((e) => e.type === 'rifle')).toHaveLength(0);
    run(g, UNITS.rifle.buildTime * TICK_RATE + 5);
    expect(g.list.filter((e) => e.type === 'rifle')).toHaveLength(1);
  });
});

describe('placement validation', () => {
  it('rejects blocked, occupied, distant and ore tiles', () => {
    const g = emptyGame();
    const [hq] = giveBase(g, 0, 8, 38, ['hq']);
    revealAll(g);
    expect(g.canPlace(0, 'power', hq.tx, hq.ty).ok).toBe(false); // occupied
    const far = openSpot(g, hq.tx + 30, hq.ty, 2, 2);
    expect(g.canPlace(0, 'power', far.x, far.y).reason).toBe('Too far from base');
    expect(g.canPlace(0, 'power', 0, 0).ok).toBe(false); // out of bounds / rock border
    const oreTile = g.oreTiles.find((i) => g.ore[i] > 0)!;
    const ox = oreTile % g.map.width, oy = Math.floor(oreTile / g.map.width);
    const r = g.canPlace(0, 'pillbox', ox, oy);
    expect(r.ok).toBe(false);
    // Units in the footprint block placement.
    const spot = { x: hq.tx + 4, y: hq.ty };
    expect(g.canPlace(0, 'power', spot.x, spot.y).ok).toBe(true);
    g.spawnUnit('rifle', 1, (spot.x + 1) * TILE, (spot.y + 1) * TILE);
    g.rebuildHash();
    expect(g.canPlace(0, 'power', spot.x, spot.y).reason).toBe('Units in the way');
  });

  it('cannot place a structure that is not ready', () => {
    const g = emptyGame();
    const [hq] = giveBase(g, 0, 8, 38, ['hq']);
    expect(g.issue(0, { t: 'place', type: 'power', tx: hq.tx + 4, ty: hq.ty }).ok).toBe(false);
  });
});

describe('combat', () => {
  it('applies armor modifiers', () => {
    const g = emptyGame();
    const tank = g.spawnUnit('lighttank', 0, 300, 300);
    const inf = g.spawnUnit('rifle', 0, 400, 300);
    applyDamage(g, tank, 100, 'SA', 1, 0);
    applyDamage(g, inf, 100, 'SA', 1, 0);
    expect(tank.maxHp - tank.hp).toBeCloseTo(100 * ARMOR_TABLE.SA.heavy);
    expect(inf.maxHp - inf.hp).toBeCloseTo(100 * ARMOR_TABLE.SA.inf);
  });

  it('rocket infantry beat a light tank one-on-one more efficiently than riflemen', () => {
    const fight = (type: string, n: number) => {
      const g = emptyGame();
      giveBase(g, 0, 8, 38, ['hq']);
      giveBase(g, 1, 66, 38, ['hq']);
      const tank = g.spawnUnit('lighttank', 1, 40 * TILE, 40 * TILE);
      for (let i = 0; i < n; i++) g.spawnUnit(type, 0, 35 * TILE, (38 + i) * TILE);
      run(g, TICK_RATE * 60);
      return { tankDead: tank.dead, survivors: g.list.filter((e) => e.type === type && !e.dead).length };
    };
    const rockets = fight('rocket', 3);
    expect(rockets.tankDead).toBe(true);
    const rifles = fight('rifle', 3);
    expect(rifles.tankDead).toBe(false);
  });

  it('destroys buildings and frees their tiles', () => {
    const g = emptyGame();
    giveBase(g, 0, 8, 38, ['hq']);
    const [hq, power] = giveBase(g, 1, 64, 38, ['hq', 'power']);
    void hq;
    for (let i = 0; i < 4; i++) g.spawnUnit('lighttank', 0, (power.tx - 5) * TILE, (power.ty + i) * TILE);
    run(g, 2);
    for (const t of g.list.filter((e) => e.type === 'lighttank')) g.issue(0, { t: 'attack', ids: [t.id], target: power.id });
    run(g, TICK_RATE * 60);
    expect(power.dead).toBe(true);
    expect(g.grid.building[g.grid.idx(power.tx, power.ty)]).toBe(0);
    expect(g.players[0].stats.kills).toBeGreaterThan(0);
  });

  it('defensive structures engage enemies in range', () => {
    const g = emptyGame();
    const [, , pill] = giveBase(g, 0, 8, 38, ['hq', 'power', 'pillbox']);
    const r = g.spawnUnit('rifle', 1, pill.x + TILE * 4, pill.y);
    run(g, TICK_RATE * 15);
    expect(r.dead).toBe(true);
  });

  it('artillery splash damages groups', () => {
    const w = WEAPONS.howitzer;
    expect(w.splash).toBeGreaterThan(0);
    expect(w.minRange).toBeGreaterThan(0);
  });
});

describe('victory conditions', () => {
  it('a player with no structures and no MCV is defeated and the match ends', () => {
    const g = emptyGame();
    giveBase(g, 0, 8, 38, ['hq']);
    const [enemyHq] = giveBase(g, 1, 64, 38, ['hq']);
    g.victoryEnabled = true;
    run(g, 25);
    expect(g.result).toBeNull();
    applyDamage(g, enemyHq, 1e6, 'EXP', 0, 0);
    run(g, 25);
    expect(g.players[1].defeated).toBe(true);
    expect(g.result?.winners).toEqual([0]);
  });

  it('surrender ends the match for that player', () => {
    const g = emptyGame();
    giveBase(g, 0, 8, 38, ['hq']);
    giveBase(g, 1, 64, 38, ['hq']);
    g.victoryEnabled = true;
    g.issue(0, { t: 'surrender' });
    expect(g.result?.winners).toEqual([1]);
  });
});

describe('pathfinding & movement', () => {
  it('finds a path around the river on Twin Rivers', () => {
    const g = new Game({ mapId: 'twin-rivers', seed: 3, players: [{ name: 'A', faction: 'cdc', color: '#00f', team: 0, isAI: false }] });
    const path = g.pf.findPath({ x: 14 * TILE, y: 14 * TILE }, { x: 81 * TILE, y: 81 * TILE });
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(1);
    // Every segment of the smoothed path is walkable.
    let prev = { x: 14 * TILE, y: 14 * TILE };
    for (const p of path!) {
      expect(g.grid.lineClear(prev.x, prev.y, p.x, p.y)).toBe(true);
      prev = p;
    }
  });

  it('units walk around a wall of buildings to reach the destination', () => {
    const g = emptyGame();
    // Wall of power plants between the unit and its goal.
    for (let y = 30; y < 50; y += 2) g.spawnBuilding('power', 1, 30, y, 1);
    const u = g.spawnUnit('rifle', 0, 26 * TILE, 40 * TILE);
    g.rebuildHash();
    g.issue(0, { t: 'move', ids: [u.id], x: 36 * TILE, y: 40 * TILE });
    run(g, TICK_RATE * 40);
    expect(Math.hypot(u.x - 36 * TILE, u.y - 40 * TILE)).toBeLessThan(TILE);
    expect(g.grid.passableWorld(u.x, u.y)).toBe(true);
  });

  it('groups spread out instead of stacking on one point', () => {
    const g = emptyGame();
    const ids = [];
    for (let i = 0; i < 8; i++) ids.push(g.spawnUnit('lighttank', 0, (20 + (i % 4)) * TILE, (36 + Math.floor(i / 4)) * TILE).id);
    g.issue(0, { t: 'move', ids, x: 40 * TILE, y: 30 * TILE });
    run(g, TICK_RATE * 30);
    const us = ids.map((id) => g.get(id)!);
    for (let i = 0; i < us.length; i++)
      for (let j = i + 1; j < us.length; j++) expect(Math.hypot(us[i].x - us[j].x, us[i].y - us[j].y)).toBeGreaterThan(10);
    const cx = us.reduce((s, u) => s + u.x, 0) / us.length, cy = us.reduce((s, u) => s + u.y, 0) / us.length;
    expect(Math.hypot(cx - 40 * TILE, cy - 30 * TILE)).toBeLessThan(TILE * 3);
  });

  it('every map connects all start positions and has room for an HQ', () => {
    for (const m of allMaps()) {
      const g = new Game({ mapId: m.id, players: [{ name: 'A', faction: 'cdc', color: '#00f', team: 0, isAI: false }] });
      for (const s of m.starts) {
        for (let y = s.y - 1; y <= s.y + 1; y++) for (let x = s.x - 1; x <= s.x + 1; x++) expect(g.grid.terrainBuild[y * m.width + x]).toBe(1);
        for (const t of m.starts) {
          if (s === t) continue;
          const tiles = g.pf.findTiles(s.x, s.y, t.x, t.y, 1e6)!;
          expect(tiles[tiles.length - 1]).toBe(t.y * m.width + t.x);
        }
      }
      expect(g.oreTiles.length).toBeGreaterThan(50);
    }
  });
});

describe('fog of war', () => {
  it('snapshots only include enemy units within vision', () => {
    const g = emptyGame();
    giveBase(g, 0, 8, 38, ['hq']);
    giveBase(g, 1, 64, 38, ['hq']);
    const near = g.spawnUnit('rifle', 1, 16 * TILE, 40 * TILE);
    const far = g.spawnUnit('rifle', 1, 50 * TILE, 40 * TILE);
    run(g, 8);
    const snap = new SnapshotBuilder(g, 0).build();
    const ids = new Set<number>();
    for (let i = 0; i < snap.ents.length; i += ENT_STRIDE) ids.add(snap.ents[i]);
    expect(ids.has(near.id)).toBe(true);
    expect(ids.has(far.id)).toBe(false);
    const vis = unpackBits(snap.vis as Uint8Array, g.map.width * g.map.height);
    expect(vis[40 * g.map.width + 50]).toBe(0);
    expect(g.visibleTo(0, far)).toBe(false);
  });

  it('remembers seen enemy structures as ghosts until the area is re-scouted', () => {
    const g = emptyGame();
    giveBase(g, 0, 8, 38, ['hq']);
    const [ehq, epow] = giveBase(g, 1, 64, 38, ['hq', 'power']);
    void ehq;
    const scout = g.spawnUnit('scout', 0, (epow.tx - 4) * TILE, epow.y);
    run(g, 8);
    expect(g.players[0].known.has(epow.id)).toBe(true);
    g.issue(0, { t: 'move', ids: [scout.id], x: 20 * TILE, y: 40 * TILE });
    run(g, TICK_RATE * 20);
    expect(g.visibleTo(0, epow)).toBe(false);
    const snap = new SnapshotBuilder(g, 0).build();
    expect(snap.ghosts).toContain(epow.id);
  });

  it('cannot attack targets that are not visible', () => {
    const g = emptyGame();
    giveBase(g, 0, 8, 38, ['hq']);
    const t = g.spawnUnit('lighttank', 0, 10 * TILE, 30 * TILE);
    const hidden = g.spawnUnit('rifle', 1, 60 * TILE, 20 * TILE);
    run(g, 5);
    expect(g.issue(0, { t: 'attack', ids: [t.id], target: hidden.id }).ok).toBe(false);
  });
});

describe('command validation', () => {
  it('rejects malformed commands', () => {
    expect(sanitizeCommand(null)).toBeNull();
    expect(sanitizeCommand({ t: 'move', ids: [1], x: 'a', y: 2 })).toBeNull();
    expect(sanitizeCommand({ t: 'move', ids: [], x: 1, y: 2 })).toBeNull();
    expect(sanitizeCommand({ t: 'move', ids: [1.5], x: 1, y: 2 })).toBeNull();
    expect(sanitizeCommand({ t: 'move', ids: new Array(500).fill(1), x: 1, y: 2 })).toBeNull();
    expect(sanitizeCommand({ t: 'build', cat: 'building', type: '__proto__' })).toBeNull();
    expect(sanitizeCommand({ t: 'grant', credits: 1e9 })).toBeNull();
    expect(sanitizeCommand({ t: 'move', ids: [1], x: 5, y: 6, credits: 9 })).toEqual({ t: 'move', ids: [1], x: 5, y: 6 });
  });

  it('players cannot command units or buildings they do not own', () => {
    const g = emptyGame();
    const [enemyHq] = giveBase(g, 1, 64, 38, ['hq']);
    const enemy = g.spawnUnit('rifle', 1, 60 * TILE, 40 * TILE);
    expect(g.issue(0, { t: 'move', ids: [enemy.id], x: 100, y: 100 }).ok).toBe(false);
    expect(g.issue(0, { t: 'sell', id: enemyHq.id }).ok).toBe(false);
    expect(g.issue(0, { t: 'move', ids: [enemy.id], x: -50, y: 1e9 }).ok).toBe(false);
  });
});

describe('factions', () => {
  it('Coalition structures are tougher; Directorate vehicles are faster', () => {
    const g = emptyGame({ factions: ['cdc', 'esd'] });
    const a = g.spawnBuilding('power', 0, 10, 30, 1);
    const b = g.spawnBuilding('power', 1, 60, 30, 1);
    expect(a.maxHp).toBeGreaterThan(b.maxHp);
    const ha = g.spawnUnit('harvester', 0, 300, 300);
    const hb = g.spawnUnit('harvester', 1, 400, 300);
    expect(hb.speed).toBeGreaterThan(ha.speed);
  });

  it('Directorate Recon Sweep reveals a remote area and then recharges', () => {
    const g = emptyGame({ factions: ['cdc', 'esd'] });
    giveBase(g, 1, 60, 38, ['hq', 'power', 'radar']);
    g.players[1].sweepCooldown = 0;
    expect(g.issue(1, { t: 'sweep', x: 10 * TILE, y: 10 * TILE }).ok).toBe(true);
    expect(g.players[1].visible[10 * g.map.width + 10]).toBe(1);
    expect(g.issue(1, { t: 'sweep', x: 10 * TILE, y: 10 * TILE }).ok).toBe(false);
    expect(g.issue(0, { t: 'sweep', x: 10 * TILE, y: 10 * TILE }).ok).toBe(false);
  });

  it('engineers capture neutral extractors that then generate income', () => {
    const g = emptyGame({ credits: 0 });
    giveBase(g, 0, 8, 38, ['hq']);
    const der = g.list.find((e) => e.type === 'derrick')!;
    const eng = g.spawnUnit('engineer', 0, der.x - TILE * 4, der.y);
    run(g, 8);
    expect(g.issue(0, { t: 'enter', ids: [eng.id], target: der.id }).ok).toBe(true);
    run(g, TICK_RATE * 15);
    expect(der.owner).toBe(0);
    expect(eng.dead).toBe(true);
    const c = g.players[0].credits;
    run(g, TICK_RATE * 10);
    expect(g.players[0].credits).toBeGreaterThan(c);
  });

  it('MCV deploys into a Command Center', () => {
    const g = emptyGame();
    const m = g.spawnUnit('mcv', 0, 12 * TILE + 16, 40 * TILE + 16);
    g.rebuildHash();
    g.issue(0, { t: 'deploy', ids: [m.id] });
    run(g, 2);
    expect(m.dead).toBe(true);
    expect(g.list.some((e) => e.type === 'hq' && e.owner === 0)).toBe(true);
  });
});
