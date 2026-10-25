import { AIController, Game, SnapshotBuilder, sanitizeCommand, TICK_RATE, type Command, type PlayerSetup, type Snapshot } from '@iron/shared';
import type { Socket } from 'socket.io-client';

export interface GameConnection {
  readonly local: boolean;
  readonly playerId: number;
  readonly mapId: string;
  onSnapshot: (s: Snapshot) => void;
  send(cmd: Command): void;
  start(): void;
  stop(): void;
  setPaused(p: boolean): void;
  setSpeed(n: number): void;
}

/** Runs the authoritative simulation in the browser for single-player skirmish. */
export class LocalConnection implements GameConnection {
  readonly local = true;
  readonly playerId = 0;
  readonly game: Game;
  private ais: AIController[] = [];
  private builder: SnapshotBuilder;
  private timer: ReturnType<typeof setInterval> | null = null;
  private last = 0;
  private acc = 0;
  private paused = false;
  private speed = 1;
  onSnapshot: (s: Snapshot) => void = () => {};
  /** Average milliseconds spent per simulation tick (for the perf overlay). */
  simMs = 0;

  constructor(readonly mapId: string, players: PlayerSetup[], seed = Math.floor(Math.random() * 1e9)) {
    this.game = new Game({ mapId, players, seed });
    players.forEach((p, i) => {
      if (p.isAI) this.ais.push(new AIController(this.game, i, p.difficulty ?? 'normal'));
    });
    this.builder = new SnapshotBuilder(this.game, 0);
  }

  send(cmd: Command) {
    const clean = sanitizeCommand(cmd);
    if (clean) this.game.issue(this.playerId, clean);
  }

  start() {
    this.last = performance.now();
    this.onSnapshot(this.builder.build());
    this.timer = setInterval(() => this.pump(), 1000 / 60);
  }

  private pump() {
    const now = performance.now();
    const dt = Math.min(250, now - this.last);
    this.last = now;
    if (this.paused) return;
    this.acc += dt * this.speed;
    const stepMs = 1000 / TICK_RATE;
    let steps = 0;
    const t0 = performance.now();
    // Catch up within a time budget so slow rendering never starves the simulation.
    if (this.acc > stepMs * 200) this.acc = stepMs * 200;
    while (this.acc >= stepMs && performance.now() - t0 < 14) {
      this.acc -= stepMs;
      for (const ai of this.ais) ai.update();
      this.game.step();
      this.builder.collect();
      steps++;
      if (this.game.result) break;
    }
    if (steps) {
      this.simMs = this.simMs * 0.9 + ((performance.now() - t0) / steps) * 0.1;
      this.onSnapshot(this.builder.build());
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  setPaused(p: boolean) {
    this.paused = p;
  }
  setSpeed(n: number) {
    this.speed = n;
  }
}

/** Online match: the server simulates; we send commands and receive filtered snapshots. */
export class RemoteConnection implements GameConnection {
  readonly local = false;
  onSnapshot: (s: Snapshot) => void = () => {};
  private handler = (s: Snapshot) => this.onSnapshot(s);

  constructor(private socket: Socket, readonly playerId: number, readonly mapId: string) {}

  send(cmd: Command) {
    this.socket.emit('game:cmd', cmd);
  }
  start() {
    this.socket.on('game:snap', this.handler);
    // Ask for a full resync: anything sent before this screen mounted was missed.
    this.socket.emit('game:sync');
  }
  stop() {
    this.socket.off('game:snap', this.handler);
  }
  setPaused() {
    /* online matches cannot be paused */
  }
  setSpeed() {
    /* fixed speed online */
  }
}
