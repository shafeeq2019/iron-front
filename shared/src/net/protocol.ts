import type { FactionId } from '../data/defs';
import type { Command, Difficulty, MatchResult } from '../sim/types';
import type { Snapshot } from '../sim/snapshot';

export const PROTOCOL_VERSION = 1;

export interface LobbySlot {
  /** Stable slot id within the room. */
  slotId: number;
  name: string;
  faction: FactionId;
  color: string;
  team: number;
  ready: boolean;
  isAI: boolean;
  difficulty?: Difficulty;
  isHost: boolean;
  connected: boolean;
}

export interface LobbyState {
  code: string;
  mapId: string;
  hostSlot: number;
  slots: LobbySlot[];
  phase: 'lobby' | 'playing' | 'finished';
  maxPlayers: number;
  lastResult?: MatchResult;
  /** Slot id of the receiving client (states are tailored per recipient). */
  you: number;
}

export interface GameStartInfo {
  mapId: string;
  /** This client's player index in the match. */
  you: number;
  seed: number;
  tickRate: number;
}

export type Ack<T = object> = (res: ({ ok: true } & T) | { ok: false; error: string }) => void;

export interface ClientToServer {
  hello: (data: { token?: string; version: number }, ack: Ack<{ token: string; rejoined: boolean }>) => void;
  'room:create': (data: { name: string }, ack: Ack<{ code: string }>) => void;
  'room:join': (data: { code: string; name: string }, ack: Ack<{ code: string }>) => void;
  'room:leave': () => void;
  'room:update': (data: Partial<Pick<LobbySlot, 'faction' | 'color' | 'team' | 'ready' | 'name'>>) => void;
  'room:map': (data: { mapId: string }) => void;
  'room:addAI': (data: { difficulty: Difficulty }) => void;
  'room:kick': (data: { slotId: number }) => void;
  'room:aiUpdate': (data: { slotId: number; faction?: FactionId; difficulty?: Difficulty; team?: number; color?: string }) => void;
  'room:start': (ack: Ack) => void;
  'game:cmd': (cmd: Command) => void;
  'game:ping': (t: number, ack: (t: number) => void) => void;
}

export interface ServerToClient {
  'room:state': (state: LobbyState) => void;
  'game:start': (info: GameStartInfo) => void;
  'game:snap': (snap: Snapshot) => void;
  'game:over': (result: MatchResult) => void;
  'game:notice': (msg: string) => void;
  'room:closed': (reason: string) => void;
}

export function normalizeName(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : '';
  const clean = s.replace(/[^\p{L}\p{N} _.\-]/gu, '').trim().slice(0, 16);
  return clean || 'Commander';
}

export function normalizeCode(raw: unknown): string {
  return (typeof raw === 'string' ? raw : '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}
