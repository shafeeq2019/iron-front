import type { FactionId } from './defs';

export interface FactionDef {
  id: FactionId;
  name: string;
  short: string;
  tagline: string;
  doctrine: string;
  /** Bullet list of mechanics shown in faction select. */
  traits: string[];
  /** Multiplier on building max hp. */
  buildingHp: number;
  /** Multiplier on vehicle speed. */
  vehicleSpeed: number;
  /** Multiplier on production time for units. */
  unitBuildTime: number;
  /** Buildings regenerate this fraction of max hp per second when not recently hit. */
  fortify: number;
  /** Has the Recon Sweep support power (requires Recon Center). */
  sweep: boolean;
  defaultColor: string;
}

export const FACTIONS: Record<FactionId, FactionDef> = {
  cdc: {
    id: 'cdc',
    name: 'Continental Defense Coalition',
    short: 'Coalition',
    tagline: 'Hold the line. Then push it forward.',
    doctrine: 'Fortification Doctrine',
    traits: [
      'Structures have +20% health',
      'Fortification: structures slowly self-repair when not under fire',
      'Bastion heavy tanks repair themselves up to half health',
      'Unique: Guardian Tank, Bastion, Longbow Howitzer, Sentinel Cannon',
    ],
    buildingHp: 1.2,
    vehicleSpeed: 1,
    unitBuildTime: 1,
    fortify: 0.006,
    sweep: false,
    defaultColor: '#3d8bff',
  },
  esd: {
    id: 'esd',
    name: 'Eastern Strategic Directorate',
    short: 'Directorate',
    tagline: 'Strike first. Strike everywhere.',
    doctrine: 'Blitz Doctrine',
    traits: [
      'Vehicles move 15% faster',
      'Units are produced 15% faster',
      'Recon Sweep: the Recon Center can reveal any area of the map',
      'Unique: Ripper Raider, Mauler, Hailstorm Launcher, Arc Pylon',
    ],
    buildingHp: 1,
    vehicleSpeed: 1.15,
    unitBuildTime: 0.85,
    fortify: 0,
    sweep: true,
    defaultColor: '#e8423a',
  },
};

export const FACTION_IDS: FactionId[] = ['cdc', 'esd'];

export const PLAYER_COLORS = ['#3d8bff', '#e8423a', '#41c463', '#f2c230', '#b45cf0', '#22c7c7'];

export const SWEEP_COOLDOWN_TICKS = 20 * 100;
export const SWEEP_DURATION_TICKS = 20 * 12;
export const SWEEP_RADIUS = 9;
