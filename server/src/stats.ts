import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MatchResult } from '@iron/shared';

interface StatsData {
  matches: number;
  factionWins: Record<string, number>;
  mapPlays: Record<string, number>;
  players: Record<string, { wins: number; losses: number }>;
  recent: { at: string; map: string; winners: string[]; players: string[]; seconds: number }[];
}

/** Small file-backed statistics store (JSON, written atomically and debounced). */
export class StatsStore {
  private data: StatsData = { matches: 0, factionWins: {}, mapPlays: {}, players: {}, recent: [] };
  private file: string | null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(dir: string | null) {
    this.file = dir ? join(dir, 'stats.json') : null;
    if (this.file && existsSync(this.file)) {
      try {
        this.data = { ...this.data, ...JSON.parse(readFileSync(this.file, 'utf8')) };
      } catch {
        /* corrupt file: start fresh */
      }
    }
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  record(map: string, r: MatchResult) {
    const d = this.data;
    d.matches++;
    d.mapPlays[map] = (d.mapPlays[map] ?? 0) + 1;
    for (const p of r.stats) {
      const rec = (d.players[p.name] ??= { wins: 0, losses: 0 });
      if (r.winners.includes(p.id)) {
        rec.wins++;
        d.factionWins[p.faction] = (d.factionWins[p.faction] ?? 0) + 1;
      } else rec.losses++;
    }
    d.recent.unshift({
      at: new Date().toISOString(), map,
      winners: r.stats.filter((p) => r.winners.includes(p.id)).map((p) => p.name),
      players: r.stats.map((p) => p.name), seconds: Math.round(r.tick / 20),
    });
    d.recent = d.recent.slice(0, 25);
    // Keep the player table bounded.
    const names = Object.keys(d.players);
    if (names.length > 2000) for (const n of names.slice(0, names.length - 2000)) delete d.players[n];
    this.schedule();
  }

  summary() {
    const top = Object.entries(this.data.players).sort((a, b) => b[1].wins - a[1].wins).slice(0, 10).map(([name, v]) => ({ name, ...v }));
    return { matches: this.data.matches, factionWins: this.data.factionWins, mapPlays: this.data.mapPlays, top, recent: this.data.recent.slice(0, 10) };
  }

  private schedule() {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => this.flush(), 2000);
  }

  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.file) return;
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data));
    renameSync(tmp, this.file);
  }
}
