export type Warhead = 'SA' | 'AP' | 'HE' | 'EXP' | 'ELEC';
export type ArmorClass = 'inf' | 'light' | 'heavy' | 'bld';
/** Visual/behavioral projectile class. 'instant' weapons hit on the firing tick. */
export type ProjectileKind = 'bullet' | 'shell' | 'rocket' | 'artillery' | 'arc';

export interface WeaponDef {
  id: string;
  damage: number;
  /** Range in tiles. */
  range: number;
  /** Minimum range in tiles (artillery). */
  minRange?: number;
  /** Ticks between shots (or bursts). */
  cooldown: number;
  warhead: Warhead;
  projectile: ProjectileKind;
  /** Projectile speed in world px per tick; 0 = hits instantly. */
  speed: number;
  /** Splash radius in px; 0 = single target. */
  splash: number;
  /** Shots per burst and ticks between them. */
  burst?: number;
  burstDelay?: number;
  /** Arc weapons jump to this many extra targets. */
  chain?: number;
  /** Max inaccuracy for artillery in px. */
  scatter?: number;
}

/** Damage multipliers: warhead vs armor class. */
export const ARMOR_TABLE: Record<Warhead, Record<ArmorClass, number>> = {
  SA: { inf: 1.0, light: 0.45, heavy: 0.2, bld: 0.15 },
  AP: { inf: 0.3, light: 1.0, heavy: 0.85, bld: 0.55 },
  HE: { inf: 0.35, light: 1.0, heavy: 1.1, bld: 0.7 },
  EXP: { inf: 1.0, light: 0.6, heavy: 0.45, bld: 1.0 },
  ELEC: { inf: 1.25, light: 0.9, heavy: 0.7, bld: 0.35 },
};

const W: WeaponDef[] = [
  { id: 'rifle', damage: 14, range: 4.5, cooldown: 18, warhead: 'SA', projectile: 'bullet', speed: 0, splash: 0 },
  { id: 'pistol', damage: 7, range: 4, cooldown: 14, warhead: 'SA', projectile: 'bullet', speed: 0, splash: 0 },
  { id: 'rocket', damage: 50, range: 6, cooldown: 40, warhead: 'HE', projectile: 'rocket', speed: 11, splash: 0 },
  { id: 'cannon', damage: 42, range: 5.5, cooldown: 30, warhead: 'AP', projectile: 'shell', speed: 16, splash: 0 },
  { id: 'autocannon', damage: 15, range: 5, cooldown: 9, warhead: 'AP', projectile: 'bullet', speed: 0, splash: 0 },
  { id: 'heavycannon', damage: 48, range: 6, cooldown: 42, warhead: 'AP', projectile: 'shell', speed: 16, splash: 0, burst: 2, burstDelay: 5 },
  { id: 'maulercannon', damage: 90, range: 6, cooldown: 46, warhead: 'AP', projectile: 'shell', speed: 16, splash: 12 },
  { id: 'howitzer', damage: 95, range: 11, minRange: 3, cooldown: 90, warhead: 'EXP', projectile: 'artillery', speed: 9, splash: 44, scatter: 18 },
  { id: 'rocketpod', damage: 34, range: 10, minRange: 3, cooldown: 110, warhead: 'EXP', projectile: 'artillery', speed: 11, splash: 30, burst: 4, burstDelay: 4, scatter: 26 },
  { id: 'mg', damage: 12, range: 6, cooldown: 7, warhead: 'SA', projectile: 'bullet', speed: 0, splash: 0 },
  { id: 'turretgun', damage: 45, range: 6.5, cooldown: 30, warhead: 'AP', projectile: 'shell', speed: 18, splash: 0 },
  { id: 'sentinelgun', damage: 70, range: 8.5, cooldown: 40, warhead: 'AP', projectile: 'shell', speed: 20, splash: 8, burst: 2, burstDelay: 6 },
  { id: 'arc', damage: 120, range: 7, cooldown: 60, warhead: 'ELEC', projectile: 'arc', speed: 0, splash: 0, chain: 2 },
];

export const WEAPONS: Record<string, WeaponDef> = Object.fromEntries(W.map((w) => [w.id, w]));
export const WEAPON_IDS = W.map((w) => w.id);
