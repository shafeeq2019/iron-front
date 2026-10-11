import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioc, type Socket } from 'socket.io-client';
import { ENT_STRIDE, PROTOCOL_VERSION, TYPE_INDEX, type GameStartInfo, type LobbyState, type MatchResult, type Snapshot } from '@iron/shared';
import { startServer } from '../src/server';

let server: ReturnType<typeof startServer>;
let url = '';
const sockets: Socket[] = [];

beforeAll(async () => {
  server = startServer({ port: 0, staticDir: null, dataDir: null, disconnectGraceMs: 600, lobbyGraceMs: 300, log: () => undefined });
  const port = await server.ready;
  url = `http://localhost:${port}`;
});
afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await server.close();
});

function once<T>(s: Socket, ev: string, pred: (v: T) => boolean = () => true, ms = 5000): Promise<T> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => { s.off(ev, h); rej(new Error(`timeout waiting for ${ev}`)); }, ms);
    const h = (v: T) => { if (pred(v)) { clearTimeout(t); s.off(ev, h); res(v); } };
    s.on(ev, h);
  });
}
function ack<T>(s: Socket, ev: string, data?: unknown): Promise<T> {
  return new Promise((res) => (data === undefined ? s.emit(ev, res) : s.emit(ev, data, res)));
}
async function client(token?: string): Promise<{ s: Socket; token: string }> {
  const s = ioc(url, { transports: ['websocket'], forceNew: true });
  sockets.push(s);
  await once(s, 'connect');
  const r = await ack<{ ok: boolean; token: string }>(s, 'hello', { token, version: PROTOCOL_VERSION });
  expect(r.ok).toBe(true);
  return { s, token: r.token };
}
function entIds(snap: Snapshot) {
  const out = new Map<number, { type: number; owner: number; x: number; y: number }>();
  for (let i = 0; i < snap.ents.length; i += ENT_STRIDE) out.set(snap.ents[i], { type: snap.ents[i + 1], owner: snap.ents[i + 2], x: snap.ents[i + 3], y: snap.ents[i + 4] });
  return out;
}

/** Creates a room with two humans and starts a match. */
async function startPair(mapId = 'twin-rivers') {
  const a = await client();
  const b = await client();
  const created = await ack<{ ok: boolean; code: string }>(a.s, 'room:create', { name: 'Alice' });
  expect(created.ok).toBe(true);
  a.s.emit('room:map', { mapId });
  const joined = await ack<{ ok: boolean }>(b.s, 'room:join', { code: created.code.toLowerCase(), name: 'Bob' });
  expect(joined.ok).toBe(true);
  const lobbyB = await once<LobbyState>(b.s, 'room:state', (st) => st.slots.length === 2);
  expect(lobbyB.you).not.toBe(lobbyB.hostSlot);
  const notReady = await ack<{ ok: boolean; error?: string }>(a.s, 'room:start');
  expect(notReady.ok).toBe(false);
  b.s.emit('room:update', { ready: true, faction: 'esd' });
  await once<LobbyState>(a.s, 'room:state', (st) => st.slots.every((x) => x.ready || x.slotId === st.hostSlot));
  const startA = once<GameStartInfo>(a.s, 'game:start');
  const startB = once<GameStartInfo>(b.s, 'game:start');
  const r = await ack<{ ok: boolean }>(a.s, 'room:start');
  expect(r.ok).toBe(true);
  const [ia, ib] = await Promise.all([startA, startB]);
  return { a, b, ia, ib, code: created.code };
}

describe('multiplayer server', () => {
  it('rejects mismatched client versions', async () => {
    const s = ioc(url, { transports: ['websocket'], forceNew: true });
    sockets.push(s);
    await once(s, 'connect');
    const r = await ack<{ ok: boolean }>(s, 'hello', { version: 999 });
    expect(r.ok).toBe(false);
  });

  it('runs a lobby → match flow with per-player fog-filtered snapshots', async () => {
    const { a, b, ia, ib } = await startPair();
    expect(ia.mapId).toBe('twin-rivers');
    expect(new Set([ia.you, ib.you]).size).toBe(2);
    const sa = await once<Snapshot>(a.s, 'game:snap', (s) => s.tick > 2);
    const sb = await once<Snapshot>(b.s, 'game:snap', (s) => s.tick > 2);
    const ea = entIds(sa), eb = entIds(sb);
    // Each player sees their own MCV but not the enemy's (bases are far apart).
    const mcv = TYPE_INDEX.mcv;
    expect([...ea.values()].filter((e) => e.type === mcv && e.owner === ia.you)).toHaveLength(1);
    expect([...ea.values()].filter((e) => e.type === mcv && e.owner === ib.you)).toHaveLength(0);
    expect([...eb.values()].filter((e) => e.type === mcv && e.owner === ia.you)).toHaveLength(0);
    expect(sa.me.id).toBe(ia.you);
    expect(sa.me.credits).toBeGreaterThan(0);
  });

  it('validates commands: cannot move enemy units, malformed input is ignored', async () => {
    const { a, b, ia, ib } = await startPair();
    const sb = await once<Snapshot>(b.s, 'game:snap', (s) => s.tick > 2);
    const bobUnit = [...entIds(sb).entries()].find(([, e]) => e.owner === ib.you && e.type === TYPE_INDEX.rifle)!;
    // Alice tries to steer Bob's rifleman and to send garbage.
    a.s.emit('game:cmd', { t: 'move', ids: [bobUnit[0]], x: 100, y: 100 });
    a.s.emit('game:cmd', { t: 'build', cat: 'building', type: '__proto__' });
    a.s.emit('game:cmd', 'not a command');
    a.s.emit('game:cmd', { t: 'move', ids: 'x' });
    a.s.emit('game:cmd', null);
    const later = await once<Snapshot>(b.s, 'game:snap', (s) => s.tick > sb.tick + 30);
    const after = entIds(later).get(bobUnit[0])!;
    expect(Math.hypot(after.x - bobUnit[1].x, after.y - bobUnit[1].y)).toBeLessThan(40);
    // Alice's own legitimate command still works.
    const sa = await once<Snapshot>(a.s, 'game:snap');
    const aliceMcv = [...entIds(sa).entries()].find(([, e]) => e.owner === ia.you && e.type === TYPE_INDEX.mcv)!;
    a.s.emit('game:cmd', { t: 'deploy', ids: [aliceMcv[0]] });
    const deployed = await once<Snapshot>(a.s, 'game:snap', (s) => [...entIds(s).values()].some((e) => e.type === TYPE_INDEX.hq && e.owner === ia.you));
    expect(deployed).toBeTruthy();
  });

  it('isolates rooms from each other', async () => {
    const r1 = await startPair();
    const r2 = await startPair();
    expect(r1.code).not.toBe(r2.code);
    const s2 = await once<Snapshot>(r2.a.s, 'game:snap', (s) => s.tick > 2);
    const unit = [...entIds(s2).entries()].find(([, e]) => e.owner === r2.ia.you && e.type === TYPE_INDEX.rifle)!;
    // A player in room 1 issues a command with an id that exists in room 2.
    r1.a.s.emit('game:cmd', { t: 'move', ids: [unit[0]], x: 50, y: 50 });
    const later = await once<Snapshot>(r2.a.s, 'game:snap', (s) => s.tick > s2.tick + 30);
    const after = entIds(later).get(unit[0])!;
    expect(Math.hypot(after.x - unit[1].x, after.y - unit[1].y)).toBeLessThan(40);
    expect(server.rooms.rooms.get(r1.code)!.match!.game).not.toBe(server.rooms.rooms.get(r2.code)!.match!.game);
  });

  it('lets a player reconnect to a running match with their token', async () => {
    const { b } = await startPair();
    b.s.disconnect();
    await new Promise((r) => setTimeout(r, 100));
    const s = ioc(url, { transports: ['websocket'], forceNew: true });
    sockets.push(s);
    await once(s, 'connect');
    const startP = once<GameStartInfo>(s, 'game:start');
    const r = await ack<{ ok: boolean; rejoined: boolean }>(s, 'hello', { token: b.token, version: PROTOCOL_VERSION });
    expect(r.rejoined).toBe(true);
    await startP;
    const snap = await once<Snapshot>(s, 'game:snap');
    expect(snap.explored).toBeDefined();
  });

  it('forfeits a player who stays disconnected and ends the match', async () => {
    const { a, b, ia } = await startPair();
    const over = once<MatchResult>(a.s, 'game:over', () => true, 8000);
    b.s.disconnect();
    const result = await over;
    expect(result.winners).toEqual([ia.you]);
    // The room returns to the lobby for a rematch.
    const st = await once<LobbyState>(a.s, 'room:state', (x) => x.phase === 'lobby', 6000);
    expect(st.lastResult).toBeDefined();
  });

  it('rate-limits and disconnects flooding clients', async () => {
    const c = await client();
    const gone = once(c.s, 'disconnect', () => true, 8000);
    for (let i = 0; i < 1000; i++) c.s.emit('game:cmd', { t: 'stop', ids: [1] });
    await gone;
  });

  it('serves health and stats endpoints', async () => {
    const h = (await (await fetch(`${url}/health`)).json()) as { ok: boolean };
    expect(h.ok).toBe(true);
    const st = (await (await fetch(`${url}/api/stats`)).json()) as { matches: number };
    expect(st.matches).toBeGreaterThanOrEqual(1);
  });
});
