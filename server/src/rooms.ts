import { randomBytes, randomInt } from 'node:crypto';
import {
  FACTION_IDS, MAP_IDS, PLAYER_COLORS, getMap, normalizeName,
  type Difficulty, type FactionId, type LobbySlot, type LobbyState, type MatchResult,
} from '@iron/shared';
import { Match } from './match';

export interface Session {
  token: string;
  socketId: string | null;
  name: string;
  roomCode: string | null;
  slotId: number | null;
  /** Pending removal timer while disconnected. */
  dropTimer: ReturnType<typeof setTimeout> | null;
}

interface Slot extends LobbySlot {
  token: string | null;
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const AI_NAMES = ['Gen. Volkov', 'Col. Hargreave', 'Cmdr. Anika', 'Maj. Tessaro', 'Adm. Kerrigan'];

export class Room {
  slots: Slot[] = [];
  hostSlot = 0;
  mapId = MAP_IDS[0];
  phase: LobbyState['phase'] = 'lobby';
  match: Match | null = null;
  lastResult?: MatchResult;
  private nextSlot = 1;

  constructor(readonly code: string) {}

  get maxPlayers() {
    return getMap(this.mapId)!.maxPlayers;
  }
  humans() {
    return this.slots.filter((s) => !s.isAI);
  }
  slot(id: number) {
    return this.slots.find((s) => s.slotId === id);
  }

  private freeColor(): string {
    const used = new Set(this.slots.map((s) => s.color));
    return PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[0];
  }
  private freeTeam(): number {
    const used = new Set(this.slots.map((s) => s.team));
    for (let t = 1; t <= 4; t++) if (!used.has(t)) return t;
    return 1;
  }

  addHuman(session: Session): Slot | string {
    if (this.phase !== 'lobby') return 'Match already in progress';
    if (this.slots.length >= this.maxPlayers) return 'Room is full';
    const slot: Slot = {
      slotId: this.nextSlot++, name: session.name, faction: this.slots.length % 2 === 0 ? 'cdc' : 'esd', color: this.freeColor(),
      team: this.freeTeam(), ready: false, isAI: false, isHost: this.slots.length === 0, connected: true, token: session.token,
    };
    if (this.slots.length === 0) this.hostSlot = slot.slotId;
    this.slots.push(slot);
    return slot;
  }

  addAI(difficulty: Difficulty): Slot | string {
    if (this.phase !== 'lobby') return 'Match already in progress';
    if (this.slots.length >= this.maxPlayers) return 'Room is full';
    const n = this.slots.filter((s) => s.isAI).length;
    const slot: Slot = {
      slotId: this.nextSlot++, name: AI_NAMES[n % AI_NAMES.length], faction: randomInt(2) ? 'cdc' : 'esd', color: this.freeColor(),
      team: this.freeTeam(), ready: true, isAI: true, difficulty, isHost: false, connected: true, token: null,
    };
    this.slots.push(slot);
    return slot;
  }

  remove(slotId: number) {
    this.slots = this.slots.filter((s) => s.slotId !== slotId);
    if (slotId === this.hostSlot) {
      const next = this.humans().find((s) => s.connected) ?? this.humans()[0];
      if (next) this.hostSlot = next.slotId;
    }
    for (const s of this.slots) s.isHost = s.slotId === this.hostSlot;
  }

  setMap(mapId: string) {
    if (!MAP_IDS.includes(mapId) || this.phase !== 'lobby') return;
    this.mapId = mapId;
    // Drop AI slots that no longer fit.
    while (this.slots.length > this.maxPlayers) {
      const ai = [...this.slots].reverse().find((s) => s.isAI);
      if (!ai) break;
      this.remove(ai.slotId);
    }
    for (const s of this.slots) if (!s.isAI) s.ready = false;
  }

  /** Applies a validated lobby update to a slot. */
  update(slot: Slot, data: Record<string, unknown>) {
    if (this.phase !== 'lobby') return;
    if (typeof data.faction === 'string' && (FACTION_IDS as string[]).includes(data.faction)) slot.faction = data.faction as FactionId;
    if (typeof data.color === 'string' && PLAYER_COLORS.includes(data.color) && !this.slots.some((s) => s !== slot && s.color === data.color)) slot.color = data.color;
    if (typeof data.team === 'number' && Number.isInteger(data.team) && data.team >= 1 && data.team <= 4) slot.team = data.team;
    if (typeof data.ready === 'boolean' && !slot.isAI) slot.ready = data.ready;
    if (typeof data.name === 'string' && !slot.isAI) slot.name = normalizeName(data.name);
    if (slot.isAI && (data.difficulty === 'easy' || data.difficulty === 'normal' || data.difficulty === 'hard')) slot.difficulty = data.difficulty;
  }

  canStart(): string | null {
    if (this.phase !== 'lobby') return 'Already started';
    if (this.slots.length < 2) return 'Need at least two players';
    if (this.slots.length > this.maxPlayers) return 'Too many players for this map';
    if (new Set(this.slots.map((s) => s.team)).size < 2) return 'Players must be on at least two teams';
    const notReady = this.humans().filter((s) => s.slotId !== this.hostSlot && (!s.ready || !s.connected));
    if (notReady.length) return 'Not all players are ready';
    return null;
  }

  state(forSlot: number): LobbyState {
    return {
      code: this.code,
      mapId: this.mapId,
      hostSlot: this.hostSlot,
      slots: this.slots.map(({ token: _t, ...s }) => ({ ...s, isHost: s.slotId === this.hostSlot })),
      phase: this.phase,
      maxPlayers: this.maxPlayers,
      lastResult: this.lastResult,
      you: forSlot,
    };
  }
}

export class RoomManager {
  rooms = new Map<string, Room>();
  sessions = new Map<string, Session>();

  constructor(readonly maxRooms = 500) {}

  newToken(): string {
    return randomBytes(18).toString('base64url');
  }

  session(token: string | undefined, socketId: string): { s: Session; rejoined: boolean } {
    if (token && typeof token === 'string' && token.length <= 64) {
      const s = this.sessions.get(token);
      if (s) {
        s.socketId = socketId;
        return { s, rejoined: true };
      }
    }
    const s: Session = { token: this.newToken(), socketId, name: 'Commander', roomCode: null, slotId: null, dropTimer: null };
    this.sessions.set(s.token, s);
    return { s, rejoined: false };
  }

  createRoom(): Room | null {
    if (this.rooms.size >= this.maxRooms) return null;
    let code = '';
    do {
      code = Array.from({ length: 5 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('');
    } while (this.rooms.has(code));
    const r = new Room(code);
    this.rooms.set(code, r);
    return r;
  }

  deleteRoom(code: string) {
    const r = this.rooms.get(code);
    r?.match?.stop();
    this.rooms.delete(code);
  }
}
