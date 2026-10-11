import type { BuildingDef, FactionId, QueueCategory, UnitDef } from '../data/defs';

export interface Vec { x: number; y: number }

export type OrderType = 'idle' | 'move' | 'attack' | 'attackMove' | 'harvest' | 'enter' | 'deploy' | 'guard';

export interface Order {
  type: OrderType;
  /** Destination in world px. */
  x?: number;
  y?: number;
  targetId?: number;
}

export type HarvestState = 'seek' | 'toOre' | 'mining' | 'toRefinery' | 'waitDock' | 'unloading' | 'idle';

export interface Entity {
  id: number;
  kind: 'unit' | 'building';
  type: string;
  def: UnitDef | BuildingDef;
  owner: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  dead: boolean;
  /** Last tick this entity took damage. */
  lastHit: number;
  /** Who last damaged it (for kill credit). */
  lastAttacker: number;

  // ---- combat (units and defenses)
  angle: number;
  turretAngle: number;
  cooldown: number;
  burstLeft: number;
  burstTimer: number;
  targetId: number;

  // ---- units
  order: Order;
  path: Vec[];
  pathIdx: number;
  /** Tick when a path was requested and is pending. */
  needsPath: boolean;
  pathGoal: Vec | null;
  repathTimer: number;
  stuckTicks: number;
  stuckCount: number;
  lastProgressX: number;
  lastProgressY: number;
  moving: boolean;
  /** Point the unit guards / returns to when idle-chasing. */
  guardX: number;
  guardY: number;
  speed: number;
  radius: number;
  // harvester
  cargo: number;
  hState: HarvestState;
  oreTile: number;
  dockId: number;
  timer: number;

  // ---- buildings
  tx: number;
  ty: number;
  w: number;
  h: number;
  /** 0..1 construction animation progress; buildings are inactive until 1. */
  built: number;
  repairing: boolean;
  rallyX: number;
  rallyY: number;
  hasRally: boolean;
}

export interface QueueItem {
  type: string;
  /** Ticks of progress made. */
  progress: number;
  /** Ticks required (base, before power/faction modifiers). */
  total: number;
  paid: number;
}

export interface Queue {
  category: QueueCategory;
  items: QueueItem[];
  /** For building/defense queues: completed structure waiting to be placed. */
  ready: string | null;
}

export interface PlayerStats {
  unitsBuilt: number;
  unitsLost: number;
  buildingsBuilt: number;
  buildingsLost: number;
  kills: number;
  creditsEarned: number;
  creditsSpent: number;
}

export interface PlayerState {
  id: number;
  name: string;
  faction: FactionId;
  color: string;
  team: number;
  isAI: boolean;
  credits: number;
  powerProduced: number;
  powerUsed: number;
  defeated: boolean;
  queues: Record<QueueCategory, Queue>;
  stats: PlayerStats;
  /** Visibility reference counts per tile (>0 = visible). */
  visible: Uint8Array;
  explored: Uint8Array;
  /** Enemy structures this player has seen, last known state. */
  known: Map<number, KnownBuilding>;
  sweepCooldown: number;
  sweeps: { x: number; y: number; until: number }[];
  /** Notification throttles. */
  lastAttackNotice: number;
  lastLowPowerNotice: number;
}

export interface KnownBuilding {
  id: number;
  type: string;
  owner: number;
  tx: number;
  ty: number;
  hp: number;
}

// ------------------------------------------------------------------ Commands

export type Command =
  | { t: 'move'; ids: number[]; x: number; y: number }
  | { t: 'attack'; ids: number[]; target: number }
  | { t: 'attackMove'; ids: number[]; x: number; y: number }
  | { t: 'stop'; ids: number[] }
  | { t: 'deploy'; ids: number[] }
  | { t: 'harvest'; ids: number[]; x: number; y: number }
  | { t: 'enter'; ids: number[]; target: number }
  | { t: 'build'; cat: QueueCategory; type: string }
  | { t: 'cancel'; cat: QueueCategory; type: string }
  | { t: 'place'; type: string; tx: number; ty: number }
  | { t: 'sell'; id: number }
  | { t: 'repair'; id: number }
  | { t: 'rally'; id: number; x: number; y: number }
  | { t: 'sweep'; x: number; y: number }
  | { t: 'surrender' };

export type CommandResult = { ok: true } | { ok: false; reason: string };

// ------------------------------------------------------------------ Events

/** Events emitted during a tick. Used for effects, audio and notifications. */
export type GameEvent =
  | { e: 'fire'; id: number; w: string; x: number; y: number; tx: number; ty: number; travel: number; o: number }
  | { e: 'hit'; x: number; y: number; w: string }
  | { e: 'arc'; pts: number[] }
  | { e: 'death'; id: number; type: string; x: number; y: number; o: number }
  | { e: 'placed'; id: number; type: string; x: number; y: number; o: number }
  | { e: 'notice'; p: number; msg: NoticeKind; x?: number; y?: number; type?: string }
  | { e: 'sweep'; p: number; x: number; y: number }
  | { e: 'capture'; id: number; o: number; x: number; y: number };

export type NoticeKind =
  | 'constructionComplete'
  | 'unitReady'
  | 'insufficientFunds'
  | 'lowPower'
  | 'baseAttack'
  | 'unitLost'
  | 'buildingLost'
  | 'cannotDeploy'
  | 'buildingCaptured'
  | 'playerDefeated'
  | 'cannotPlace'
  | 'queueFull'
  | 'sweepReady';

export interface MatchResult {
  winnerTeam: number | null;
  winners: number[];
  tick: number;
  stats: { id: number; name: string; faction: FactionId; color: string; defeated: boolean; stats: PlayerStats }[];
}

export interface PlayerSetup {
  name: string;
  faction: FactionId;
  color: string;
  team: number;
  isAI: boolean;
  difficulty?: Difficulty;
}

export type Difficulty = 'easy' | 'normal' | 'hard';
