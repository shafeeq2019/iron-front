import { io, type Socket } from 'socket.io-client';
import { PROTOCOL_VERSION, type GameStartInfo, type LobbyState } from '@iron/shared';
import { Store } from '../game/store';

export interface NetState {
  status: 'idle' | 'connecting' | 'connected' | 'error';
  lobby: LobbyState | null;
  game: GameStartInfo | null;
  error: string | null;
  notice: string | null;
  ping: number;
}

export const net = new Store<NetState>({ status: 'idle', lobby: null, game: null, error: null, notice: null, ping: 0 });

const TOKEN_KEY = 'ironfront.token';
let socket: Socket | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;

export function serverUrl(): string | undefined {
  const env = import.meta.env.VITE_SERVER_URL as string | undefined;
  return env && env.length ? env : undefined;
}

function token(): string | undefined {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Connects (once) and performs the hello handshake, rejoining a room if the token is known. */
export function connect(): Promise<Socket> {
  if (socket?.connected) return Promise.resolve(socket);
  if (!socket) {
    net.patch({ status: 'connecting', error: null });
    socket = io(serverUrl() ?? '/', { transports: ['websocket', 'polling'], reconnectionDelayMax: 4000, timeout: 8000 });
    socket.on('connect', () => {
      socket!.emit('hello', { token: token(), version: PROTOCOL_VERSION }, (res: { ok: boolean; token?: string; error?: string }) => {
        if (res.ok && res.token) {
          try { sessionStorage.setItem(TOKEN_KEY, res.token); } catch { /* ignore */ }
          net.patch({ status: 'connected', error: null });
        } else net.patch({ status: 'error', error: res.error ?? 'Handshake failed' });
      });
    });
    socket.on('disconnect', (reason) => {
      net.patch({ status: 'connecting', notice: reason === 'io server disconnect' ? 'Disconnected by server' : 'Connection lost — reconnecting…' });
    });
    socket.on('connect_error', () => net.patch({ status: 'error', error: 'Cannot reach the multiplayer server' }));
    socket.on('room:state', (lobby: LobbyState) => net.patch({ lobby }));
    socket.on('game:start', (game: GameStartInfo) => net.patch({ game, notice: null }));
    socket.on('game:notice', (notice: string) => net.patch({ notice }));
    socket.on('room:closed', (reason: string) => net.patch({ lobby: null, game: null, error: reason }));
    pingTimer = setInterval(() => {
      const t = performance.now();
      socket?.emit('game:ping', t, () => net.patch({ ping: Math.round(performance.now() - t) }));
    }, 3000);
  }
  return new Promise((resolve, reject) => {
    const s = socket!;
    if (s.connected && net.get().status === 'connected') return resolve(s);
    const done = () => {
      const st = net.get();
      if (st.status === 'connected') { unsub(); clearTimeout(timer); resolve(s); }
      else if (st.status === 'error') { unsub(); clearTimeout(timer); reject(new Error(st.error ?? 'Connection failed')); }
    };
    const unsub = net.subscribe(done);
    const timer = setTimeout(() => { unsub(); reject(new Error('Connection timed out')); }, 10000);
    done();
  });
}

export function getSocket(): Socket | null {
  return socket;
}

export function emitAck<T = object>(event: string, data?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!socket) return reject(new Error('Not connected'));
    const cb = (res: { ok: boolean; error?: string } & T) => (res.ok ? resolve(res) : reject(new Error(res.error ?? 'Request failed')));
    if (data === undefined) socket.timeout(8000).emit(event, (err: unknown, res: { ok: boolean; error?: string } & T) => (err ? reject(new Error('Server did not respond')) : cb(res)));
    else socket.timeout(8000).emit(event, data, (err: unknown, res: { ok: boolean; error?: string } & T) => (err ? reject(new Error('Server did not respond')) : cb(res)));
  });
}

export function emit(event: string, data?: unknown) {
  socket?.emit(event, data);
}

export function leaveRoom() {
  socket?.emit('room:leave');
  net.patch({ lobby: null, game: null });
}

export function disconnect() {
  if (pingTimer) clearInterval(pingTimer);
  socket?.disconnect();
  socket = null;
  net.set({ status: 'idle', lobby: null, game: null, error: null, notice: null, ping: 0 });
}
