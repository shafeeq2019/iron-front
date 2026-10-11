import {
  AIController, Game, NET_SNAPSHOT_INTERVAL, SnapshotBuilder, TICK_RATE, sanitizeCommand,
  type MatchResult, type PlayerSetup,
} from '@iron/shared';

export interface MatchPlayer {
  slotId: number;
  setup: PlayerSetup;
  /** Emits a snapshot to this player's socket (null while disconnected). */
  send: ((event: string, data: unknown) => void) | null;
}

/**
 * Server-authoritative match. Runs the shared simulation at a fixed tick rate,
 * applies validated commands, drives AI players, and sends each human a
 * fog-of-war filtered snapshot.
 */
export class Match {
  readonly game: Game;
  readonly seed: number;
  private ais: AIController[] = [];
  private builders = new Map<number, SnapshotBuilder>();
  private slotToPlayer = new Map<number, number>();
  private players: MatchPlayer[];
  private timer: ReturnType<typeof setInterval> | null = null;
  private acc = 0;
  private last = 0;
  private ended = false;
  /** Total time spent simulating, for diagnostics. */
  simMs = 0;
  onEnd?: (r: MatchResult) => void;

  constructor(readonly mapId: string, players: MatchPlayer[], seed = Math.floor(Math.random() * 2 ** 31)) {
    this.seed = seed;
    this.players = players;
    this.game = new Game({ mapId, players: players.map((p) => p.setup), seed });
    players.forEach((p, i) => {
      this.slotToPlayer.set(p.slotId, i);
      if (p.setup.isAI) this.ais.push(new AIController(this.game, i, p.setup.difficulty ?? 'normal'));
      else this.builders.set(i, new SnapshotBuilder(this.game, i));
    });
  }

  playerIndex(slotId: number): number | undefined {
    return this.slotToPlayer.get(slotId);
  }

  start() {
    this.last = performance.now();
    this.timer = setInterval(() => this.pump(), 1000 / TICK_RATE / 2);
    this.broadcast();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private pump() {
    const now = performance.now();
    this.acc += Math.min(500, now - this.last);
    this.last = now;
    const step = 1000 / TICK_RATE;
    let n = 0;
    while (this.acc >= step && n < 5) {
      this.acc -= step;
      n++;
      this.tick();
      if (this.ended) return;
    }
  }

  /** Advances one simulation tick (exposed for tests). */
  tick() {
    const t0 = performance.now();
    for (const ai of this.ais) ai.update();
    this.game.step();
    for (const b of this.builders.values()) b.collect();
    this.simMs += performance.now() - t0;
    if (this.game.tick % NET_SNAPSHOT_INTERVAL === 0 || this.game.result) this.broadcast();
    if (this.game.result && !this.ended) {
      this.ended = true;
      this.stop();
      for (const p of this.players) p.send?.('game:over', this.game.result);
      this.onEnd?.(this.game.result);
    }
  }

  private broadcast() {
    for (const p of this.players) {
      if (!p.send) continue;
      const idx = this.slotToPlayer.get(p.slotId)!;
      const b = this.builders.get(idx);
      if (b) p.send('game:snap', b.build());
    }
  }

  /** Applies an untrusted command from a player's socket. Returns false if rejected. */
  command(slotId: number, raw: unknown): boolean {
    const idx = this.slotToPlayer.get(slotId);
    if (idx === undefined || this.ended) return false;
    const cmd = sanitizeCommand(raw);
    if (!cmd) return false;
    return this.game.issue(idx, cmd).ok;
  }

  /** Rebinds a player's output after (re)connecting and forces a full snapshot. */
  setSender(slotId: number, send: MatchPlayer['send']) {
    const p = this.players.find((x) => x.slotId === slotId);
    if (!p) return;
    p.send = send;
    const idx = this.slotToPlayer.get(slotId)!;
    if (send) this.builders.get(idx)?.reset();
  }

  forfeit(slotId: number) {
    const idx = this.slotToPlayer.get(slotId);
    if (idx === undefined || this.ended) return;
    this.game.issue(idx, { t: 'surrender' });
  }

  get finished() {
    return this.ended;
  }
}
