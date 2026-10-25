import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { Server, type Socket } from 'socket.io';
import { PROTOCOL_VERSION, TICK_RATE, normalizeCode, normalizeName, type Difficulty, type PlayerSetup } from '@iron/shared';
import { Match } from './match';
import { Room, RoomManager, type Session } from './rooms';
import { StatsStore } from './stats';

export interface ServerOptions {
  port?: number;
  host?: string;
  corsOrigin?: string | string[];
  staticDir?: string | null;
  dataDir?: string | null;
  /** Grace period before a disconnected player forfeits (ms). */
  disconnectGraceMs?: number;
  lobbyGraceMs?: number;
  maxRooms?: number;
  log?: (...a: unknown[]) => void;
}

/** Token bucket rate limiter per socket. */
class Bucket {
  private tokens: number;
  private last = Date.now();
  strikes = 0;
  constructor(private capacity: number, private perSec: number) {
    this.tokens = capacity;
  }
  take(): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.perSec);
    this.last = now;
    if (this.tokens >= 1) { this.tokens--; return true; }
    this.strikes++;
    return false;
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

export function startServer(opts: ServerOptions = {}) {
  const log = opts.log ?? ((...a: unknown[]) => console.log(new Date().toISOString(), ...a));
  const graceMs = opts.disconnectGraceMs ?? 60_000;
  const lobbyGraceMs = opts.lobbyGraceMs ?? 20_000;
  const rooms = new RoomManager(opts.maxRooms ?? 500);
  const stats = new StatsStore(opts.dataDir ?? null);
  const staticDir = opts.staticDir && existsSync(opts.staticDir) ? resolve(opts.staticDir) : null;

  const http = createServer((req, res) => handleHttp(req, res));
  function handleHttp(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, rooms: rooms.rooms.size, matches: [...rooms.rooms.values()].filter((r) => r.match && !r.match.finished).length }));
      return;
    }
    if (url.pathname === '/api/stats') {
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify(stats.summary()));
      return;
    }
    if (!staticDir) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('IRON FRONT multiplayer server. Client not bundled here.');
      return;
    }
    // Static files with SPA fallback; prevent path traversal.
    let p = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    let file = join(staticDir, p);
    if (!file.startsWith(staticDir)) { res.writeHead(403); res.end(); return; }
    if (!existsSync(file) || statSync(file).isDirectory()) { p = 'index.html'; file = join(staticDir, p); }
    const ext = extname(file);
    res.writeHead(200, {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'cache-control': p.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(readFileSync(file));
  }

  const io = new Server(http, {
    cors: { origin: opts.corsOrigin ?? '*' },
    maxHttpBufferSize: 32 * 1024,
    perMessageDeflate: { threshold: 2048 },
    pingInterval: 10_000,
    // Generous: a client's tab can stall for a while (first-load shader compilation, background throttling).
    pingTimeout: 30_000,
  });

  const sessionsBySocket = new Map<string, Session>();

  function broadcastRoom(room: Room) {
    for (const s of room.slots) {
      if (s.isAI || !s.token) continue;
      const sess = rooms.sessions.get(s.token);
      if (sess?.socketId) io.to(sess.socketId).emit('room:state', room.state(s.slotId));
    }
  }

  function senderFor(session: Session) {
    return (event: string, data: unknown) => {
      if (session.socketId) io.to(session.socketId).emit(event, data);
    };
  }

  function leaveRoom(session: Session, reason: 'left' | 'dropped') {
    const room = session.roomCode ? rooms.rooms.get(session.roomCode) : undefined;
    if (session.dropTimer) { clearTimeout(session.dropTimer); session.dropTimer = null; }
    if (room && session.slotId !== null) {
      if (room.phase === 'playing' && room.match) {
        room.match.forfeit(session.slotId);
        room.match.setSender(session.slotId, null);
      }
      room.remove(session.slotId);
      log(`room ${room.code}: ${session.name} ${reason}`);
      if (room.humans().length === 0) {
        rooms.deleteRoom(room.code);
        log(`room ${room.code} closed`);
      } else broadcastRoom(room);
    }
    session.roomCode = null;
    session.slotId = null;
  }

  function startMatch(room: Room): string | null {
    const err = room.canStart();
    if (err) return err;
    const players = room.slots.map((s) => {
      const setup: PlayerSetup = { name: s.name, faction: s.faction, color: s.color, team: s.team, isAI: s.isAI, difficulty: s.difficulty };
      const sess = s.token ? rooms.sessions.get(s.token) : undefined;
      return { slotId: s.slotId, setup, send: sess ? senderFor(sess) : null };
    });
    const match = new Match(room.mapId, players);
    room.match = match;
    room.phase = 'playing';
    match.onEnd = (result) => {
      stats.record(room.mapId, result);
      room.lastResult = result;
      log(`room ${room.code}: match ended, winners ${result.winners.join(',')} after ${(result.tick / TICK_RATE).toFixed(0)}s`);
      setTimeout(() => {
        if (!rooms.rooms.has(room.code)) return;
        room.phase = 'lobby';
        room.match = null;
        for (const s of room.slots) if (!s.isAI) s.ready = false;
        // Drop players who never came back.
        for (const s of [...room.slots]) if (!s.isAI && !s.connected) room.remove(s.slotId);
        if (room.humans().length === 0) rooms.deleteRoom(room.code);
        else broadcastRoom(room);
      }, 1500);
    };
    for (const p of players) {
      const slot = room.slot(p.slotId)!;
      if (slot.isAI || !slot.token) continue;
      const sess = rooms.sessions.get(slot.token);
      if (sess?.socketId) io.to(sess.socketId).emit('game:start', { mapId: room.mapId, you: match.playerIndex(slot.slotId)!, seed: match.seed, tickRate: TICK_RATE });
    }
    match.start();
    broadcastRoom(room);
    log(`room ${room.code}: match started on ${room.mapId} with ${players.length} players`);
    return null;
  }

  io.on('connection', (socket: Socket) => {
    const bucket = new Bucket(60, 30);
    let session: Session | null = null;

    // Every inbound event is rate limited; abusive clients are disconnected.
    socket.use((_packet, next) => {
      if (bucket.take()) return next();
      if (bucket.strikes > 300) socket.disconnect(true);
    });

    const ack = (fn: unknown) => (typeof fn === 'function' ? (fn as (r: unknown) => void) : () => undefined);
    const currentRoom = () => (session?.roomCode ? rooms.rooms.get(session.roomCode) : undefined);
    const mySlot = () => {
      const r = currentRoom();
      return r && session?.slotId != null ? r.slot(session.slotId) : undefined;
    };

    socket.on('hello', (data: unknown, cb: unknown) => {
      const reply = ack(cb);
      const d = (data && typeof data === 'object' ? data : {}) as { token?: unknown; version?: unknown };
      if (d.version !== PROTOCOL_VERSION) return reply({ ok: false, error: 'Client version mismatch — please reload the page' });
      if (session) return reply({ ok: true, token: session.token, rejoined: false });
      const { s, rejoined } = rooms.session(typeof d.token === 'string' ? d.token : undefined, socket.id);
      // Kick a stale socket still bound to this session.
      for (const [sid, sess] of sessionsBySocket) if (sess === s && sid !== socket.id) { sessionsBySocket.delete(sid); io.sockets.sockets.get(sid)?.disconnect(true); }
      session = s;
      s.socketId = socket.id;
      sessionsBySocket.set(socket.id, s);
      if (s.dropTimer) { clearTimeout(s.dropTimer); s.dropTimer = null; }
      reply({ ok: true, token: s.token, rejoined });
      const room = currentRoom();
      const slot = mySlot();
      if (room && slot) {
        slot.connected = true;
        log(`room ${room.code}: ${s.name} reconnected`);
        if (room.phase === 'playing' && room.match) {
          room.match.setSender(slot.slotId, senderFor(s));
          socket.emit('game:start', { mapId: room.mapId, you: room.match.playerIndex(slot.slotId)!, seed: room.match.seed, tickRate: TICK_RATE });
          for (const o of room.humans()) if (o !== slot && o.token) { const os = rooms.sessions.get(o.token); if (os?.socketId) io.to(os.socketId).emit('game:notice', `${slot.name} reconnected`); }
        }
        broadcastRoom(room);
      }
    });

    socket.on('room:create', (data: unknown, cb: unknown) => {
      const reply = ack(cb);
      if (!session) return reply({ ok: false, error: 'Say hello first' });
      leaveRoom(session, 'left');
      session.name = normalizeName((data as { name?: unknown })?.name);
      const room = rooms.createRoom();
      if (!room) return reply({ ok: false, error: 'Server is full, try again later' });
      const slot = room.addHuman(session);
      if (typeof slot === 'string') return reply({ ok: false, error: slot });
      session.roomCode = room.code;
      session.slotId = slot.slotId;
      log(`room ${room.code} created by ${session.name}`);
      reply({ ok: true, code: room.code });
      broadcastRoom(room);
    });

    socket.on('room:join', (data: unknown, cb: unknown) => {
      const reply = ack(cb);
      if (!session) return reply({ ok: false, error: 'Say hello first' });
      const d = (data ?? {}) as { code?: unknown; name?: unknown };
      const code = normalizeCode(d.code);
      const room = rooms.rooms.get(code);
      if (!room) return reply({ ok: false, error: 'Room not found' });
      if (session.roomCode === code) return reply({ ok: true, code });
      leaveRoom(session, 'left');
      session.name = normalizeName(d.name);
      const slot = room.addHuman(session);
      if (typeof slot === 'string') return reply({ ok: false, error: slot });
      session.roomCode = room.code;
      session.slotId = slot.slotId;
      log(`room ${room.code}: ${session.name} joined`);
      reply({ ok: true, code: room.code });
      broadcastRoom(room);
    });

    socket.on('room:leave', () => {
      if (session) leaveRoom(session, 'left');
    });

    socket.on('room:update', (data: unknown) => {
      const room = currentRoom(), slot = mySlot();
      if (!room || !slot || !data || typeof data !== 'object') return;
      room.update(slot, data as Record<string, unknown>);
      broadcastRoom(room);
    });

    socket.on('room:map', (data: unknown) => {
      const room = currentRoom();
      if (!room || session?.slotId !== room.hostSlot) return;
      const mapId = (data as { mapId?: unknown })?.mapId;
      if (typeof mapId === 'string') room.setMap(mapId);
      broadcastRoom(room);
    });

    socket.on('room:addAI', (data: unknown) => {
      const room = currentRoom();
      if (!room || session?.slotId !== room.hostSlot) return;
      const diff = (data as { difficulty?: unknown })?.difficulty;
      room.addAI(diff === 'easy' || diff === 'hard' ? (diff as Difficulty) : 'normal');
      broadcastRoom(room);
    });

    socket.on('room:aiUpdate', (data: unknown) => {
      const room = currentRoom();
      if (!room || session?.slotId !== room.hostSlot || !data || typeof data !== 'object') return;
      const slot = room.slot(Number((data as { slotId?: unknown }).slotId));
      if (!slot?.isAI) return;
      room.update(slot, data as Record<string, unknown>);
      broadcastRoom(room);
    });

    socket.on('room:kick', (data: unknown) => {
      const room = currentRoom();
      if (!room || session?.slotId !== room.hostSlot || room.phase !== 'lobby') return;
      const id = Number((data as { slotId?: unknown })?.slotId);
      const slot = room.slot(id);
      if (!slot || id === room.hostSlot) return;
      if (slot.token) {
        const ks = rooms.sessions.get(slot.token);
        if (ks) {
          ks.roomCode = null;
          ks.slotId = null;
          if (ks.socketId) io.to(ks.socketId).emit('room:closed', 'You were removed from the room by the host');
        }
      }
      room.remove(id);
      broadcastRoom(room);
    });

    socket.on('room:start', (cb: unknown) => {
      const reply = ack(cb);
      const room = currentRoom();
      if (!room) return reply({ ok: false, error: 'Not in a room' });
      if (session?.slotId !== room.hostSlot) return reply({ ok: false, error: 'Only the host can start' });
      const err = startMatch(room);
      reply(err ? { ok: false, error: err } : { ok: true });
    });

    socket.on('game:cmd', (cmd: unknown) => {
      const room = currentRoom();
      if (!room?.match || session?.slotId == null) return;
      room.match.command(session.slotId, cmd);
    });

    socket.on('game:sync', () => {
      const room = currentRoom();
      if (!room?.match || session?.slotId == null || !session) return;
      room.match.setSender(session.slotId, senderFor(session));
    });

    socket.on('game:ping', (t: unknown, cb: unknown) => {
      if (typeof cb === 'function') (cb as (t: unknown) => void)(typeof t === 'number' ? t : 0);
    });

    socket.on('disconnect', () => {
      sessionsBySocket.delete(socket.id);
      if (!session || session.socketId !== socket.id) return;
      const s = session;
      s.socketId = null;
      const room = currentRoom();
      const slot = mySlot();
      if (!room || !slot) return;
      slot.connected = false;
      if (room.phase === 'playing' && room.match) {
        room.match.setSender(slot.slotId, null);
        for (const o of room.humans()) if (o !== slot && o.token) { const os = rooms.sessions.get(o.token); if (os?.socketId) io.to(os.socketId).emit('game:notice', `${slot.name} disconnected — waiting ${Math.round(graceMs / 1000)}s for them to return`); }
        s.dropTimer = setTimeout(() => {
          s.dropTimer = null;
          if (!s.socketId) leaveRoom(s, 'dropped');
        }, graceMs);
      } else {
        s.dropTimer = setTimeout(() => {
          s.dropTimer = null;
          if (!s.socketId) leaveRoom(s, 'dropped');
        }, lobbyGraceMs);
      }
      broadcastRoom(room);
    });
  });

  // Forget idle sessions that are not in any room.
  const gc = setInterval(() => {
    for (const [t, s] of rooms.sessions) if (!s.socketId && !s.roomCode && !s.dropTimer) rooms.sessions.delete(t);
  }, 60_000);

  const port = opts.port ?? 3001;
  const ready = new Promise<number>((res) => {
    http.listen(port, opts.host ?? '0.0.0.0', () => {
      const addr = http.address();
      res(typeof addr === 'object' && addr ? addr.port : port);
    });
  });

  return {
    io, http, rooms, stats, ready,
    async close() {
      clearInterval(gc);
      for (const r of rooms.rooms.values()) r.match?.stop();
      for (const s of rooms.sessions.values()) if (s.dropTimer) clearTimeout(s.dropTimer);
      stats.flush();
      await new Promise<void>((res) => io.close(() => res()));
    },
  };
}
