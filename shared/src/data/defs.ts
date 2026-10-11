import type { ArmorClass } from './weapons';

export type FactionId = 'cdc' | 'esd';
export type QueueCategory = 'building' | 'defense' | 'infantry' | 'vehicle';

interface BaseDef {
  id: string;
  name: string;
  /** Faction-specific display names; falls back to `name`. */
  names?: Partial<Record<FactionId, string>>;
  description: string;
  hp: number;
  armor: ArmorClass;
  cost: number;
  /** Production/construction time in seconds. */
  buildTime: number;
  /** Building types required to produce this. */
  prereqs: string[];
  /** If set, only these factions can build it. */
  factions?: FactionId[];
  vision: number;
  weapon?: string;
  /** Hotkey hint shown in the build menu. */
  hotkey?: string;
}

export interface UnitDef extends BaseDef {
  kind: 'unit';
  category: 'infantry' | 'vehicle';
  /** Movement speed in tiles per second. */
  speed: number;
  /** Collision radius in px. */
  radius: number;
  /** Turn rate in radians per tick (vehicles). */
  turnRate: number;
  hasTurret?: boolean;
  /** Can be consumed to capture/repair buildings. */
  engineer?: boolean;
  harvester?: boolean;
  deploysTo?: string;
  /** Regenerates hp up to this fraction of max. */
  selfRepairTo?: number;
  /** AI role tag. */
  role: 'infantry' | 'antitank' | 'support' | 'tank' | 'heavy' | 'artillery' | 'eco' | 'scout' | 'mcv' | 'raider';
}

export interface BuildingDef extends BaseDef {
  kind: 'building';
  category: 'building' | 'defense';
  w: number;
  h: number;
  /** Positive produces power, negative consumes it. */
  power: number;
  /** Production category this building enables. */
  produces?: 'infantry' | 'vehicle';
  refinery?: boolean;
  /** Not constructible by players (deployed or neutral). */
  unbuildable?: boolean;
  /** Neutral tech building: credits granted every 2s to its owner. */
  income?: number;
  /** Turreted defense. */
  hasTurret?: boolean;
}

export type EntityDef = UnitDef | BuildingDef;

const U = (d: Omit<UnitDef, 'kind'>): UnitDef => ({ kind: 'unit', ...d });
const B = (d: Omit<BuildingDef, 'kind'>): BuildingDef => ({ kind: 'building', ...d });

export const UNIT_DEFS: UnitDef[] = [
  U({ id: 'rifle', name: 'Rifleman', names: { cdc: 'Ranger', esd: 'Trooper' }, description: 'Cheap, versatile infantry. Strong vs infantry.', category: 'infantry', role: 'infantry', hp: 100, armor: 'inf', cost: 100, buildTime: 5, prereqs: ['barracks'], vision: 6, speed: 1.6, radius: 6, turnRate: 1, weapon: 'rifle', hotkey: 'Q' }),
  U({ id: 'rocket', name: 'Rocket Soldier', names: { cdc: 'Lancer', esd: 'Spiker' }, description: 'Anti-armor rocket infantry. Weak vs infantry.', category: 'infantry', role: 'antitank', hp: 90, armor: 'inf', cost: 250, buildTime: 8, prereqs: ['barracks'], vision: 6.5, speed: 1.4, radius: 6, turnRate: 1, weapon: 'rocket', hotkey: 'W' }),
  U({ id: 'engineer', name: 'Engineer', names: { cdc: 'Field Engineer', esd: 'Technician' }, description: 'Captures enemy/neutral structures or fully repairs your own. Consumed on use.', category: 'infantry', role: 'support', hp: 80, armor: 'inf', cost: 450, buildTime: 8, prereqs: ['barracks'], vision: 5, speed: 1.6, radius: 6, turnRate: 1, engineer: true, hotkey: 'E' }),
  U({ id: 'scout', name: 'Scout', names: { cdc: 'Pathfinder', esd: 'Outrider' }, description: 'Very fast recon infantry with wide vision.', category: 'infantry', role: 'scout', hp: 70, armor: 'inf', cost: 150, buildTime: 5, prereqs: ['barracks'], vision: 10, speed: 2.9, radius: 6, turnRate: 1, weapon: 'pistol', hotkey: 'R' }),
  U({ id: 'lighttank', name: 'Guardian Tank', description: 'Reliable main battle tank.', category: 'vehicle', role: 'tank', factions: ['cdc'], hp: 420, armor: 'heavy', cost: 700, buildTime: 12, prereqs: ['factory'], vision: 7, speed: 2.1, radius: 12, turnRate: 0.12, hasTurret: true, weapon: 'cannon', hotkey: 'Q' }),
  U({ id: 'raider', name: 'Ripper Raider', description: 'Fast, lightly armored assault buggy with a rapid autocannon.', category: 'vehicle', role: 'raider', factions: ['esd'], hp: 280, armor: 'light', cost: 550, buildTime: 9, prereqs: ['factory'], vision: 8, speed: 3.6, radius: 11, turnRate: 0.18, hasTurret: true, weapon: 'autocannon', hotkey: 'Q' }),
  U({ id: 'heavytank', name: 'Bastion Heavy Tank', description: 'Twin-cannon fortress on treads. Self-repairs to half health.', category: 'vehicle', role: 'heavy', factions: ['cdc'], hp: 1150, armor: 'heavy', cost: 1600, buildTime: 22, prereqs: ['factory', 'tech'], vision: 7, speed: 1.35, radius: 15, turnRate: 0.08, hasTurret: true, weapon: 'heavycannon', selfRepairTo: 0.5, hotkey: 'W' }),
  U({ id: 'mauler', name: 'Mauler Assault Tank', description: 'Hard-hitting heavy tank with splash damage.', category: 'vehicle', role: 'heavy', factions: ['esd'], hp: 820, armor: 'heavy', cost: 1300, buildTime: 18, prereqs: ['factory', 'tech'], vision: 7, speed: 1.9, radius: 14, turnRate: 0.1, hasTurret: true, weapon: 'maulercannon', hotkey: 'W' }),
  U({ id: 'artillery', name: 'Longbow Howitzer', description: 'Long-range artillery. Devastating vs infantry and structures; cannot fire up close.', category: 'vehicle', role: 'artillery', factions: ['cdc'], hp: 260, armor: 'light', cost: 1000, buildTime: 16, prereqs: ['factory', 'radar'], vision: 6, speed: 1.5, radius: 12, turnRate: 0.1, hasTurret: true, weapon: 'howitzer', hotkey: 'E' }),
  U({ id: 'hailstorm', name: 'Hailstorm Launcher', description: 'Rocket artillery firing a four-rocket salvo.', category: 'vehicle', role: 'artillery', factions: ['esd'], hp: 240, armor: 'light', cost: 950, buildTime: 15, prereqs: ['factory', 'radar'], vision: 6, speed: 2.0, radius: 12, turnRate: 0.12, hasTurret: true, weapon: 'rocketpod', hotkey: 'E' }),
  U({ id: 'harvester', name: 'Harvester', description: 'Gathers ferrite ore and delivers it to a refinery.', category: 'vehicle', role: 'eco', hp: 900, armor: 'heavy', cost: 1400, buildTime: 14, prereqs: ['factory', 'refinery'], vision: 5, speed: 1.7, radius: 14, turnRate: 0.1, harvester: true, hotkey: 'R' }),
  U({ id: 'mcv', name: 'Mobile HQ Vehicle', description: 'Deploys into a Command Center.', category: 'vehicle', role: 'mcv', hp: 1000, armor: 'heavy', cost: 3000, buildTime: 30, prereqs: ['factory', 'radar'], vision: 6, speed: 1.3, radius: 16, turnRate: 0.06, deploysTo: 'hq', hotkey: 'T' }),
];

export const BUILDING_DEFS: BuildingDef[] = [
  B({ id: 'hq', name: 'Command Center', description: 'Base core. Enables construction.', category: 'building', unbuildable: true, w: 3, h: 3, hp: 3000, armor: 'bld', cost: 3000, buildTime: 30, prereqs: [], vision: 8, power: 10 }),
  B({ id: 'power', name: 'Power Plant', description: 'Generates 100 power.', category: 'building', w: 2, h: 2, hp: 750, armor: 'bld', cost: 800, buildTime: 10, prereqs: ['hq'], vision: 4, power: 100, hotkey: 'Q' }),
  B({ id: 'refinery', name: 'Ore Refinery', description: 'Processes ore into credits. Comes with a free Harvester.', category: 'building', refinery: true, w: 3, h: 3, hp: 1000, armor: 'bld', cost: 2000, buildTime: 18, prereqs: ['power'], vision: 5, power: -30, hotkey: 'W' }),
  B({ id: 'barracks', name: 'Barracks', description: 'Trains infantry.', category: 'building', produces: 'infantry', w: 2, h: 2, hp: 800, armor: 'bld', cost: 500, buildTime: 8, prereqs: ['power'], vision: 5, power: -10, hotkey: 'E' }),
  B({ id: 'factory', name: 'War Factory', description: 'Builds vehicles.', category: 'building', produces: 'vehicle', w: 3, h: 3, hp: 1500, armor: 'bld', cost: 2000, buildTime: 20, prereqs: ['refinery'], vision: 5, power: -25, hotkey: 'R' }),
  B({ id: 'radar', name: 'Recon Center', description: 'Reveals a wide area. Unlocks artillery and advanced tech.', category: 'building', w: 2, h: 2, hp: 1000, armor: 'bld', cost: 1000, buildTime: 12, prereqs: ['refinery'], vision: 14, power: -50, hotkey: 'T' }),
  B({ id: 'tech', name: 'Tech Center', description: 'Unlocks heavy armor and advanced defenses.', category: 'building', w: 3, h: 3, hp: 1200, armor: 'bld', cost: 1800, buildTime: 20, prereqs: ['radar', 'factory'], vision: 5, power: -100, hotkey: 'Y' }),
  B({ id: 'pillbox', name: 'MG Pillbox', description: 'Machine-gun bunker. Shreds infantry.', category: 'defense', w: 1, h: 1, hp: 600, armor: 'bld', cost: 400, buildTime: 7, prereqs: ['barracks'], vision: 7, power: -5, weapon: 'mg', hotkey: 'Q' }),
  B({ id: 'turret', name: 'Gun Turret', description: 'Anti-armor cannon emplacement.', category: 'defense', hasTurret: true, w: 1, h: 1, hp: 800, armor: 'bld', cost: 650, buildTime: 9, prereqs: ['factory'], vision: 7.5, power: -15, weapon: 'turretgun', hotkey: 'W' }),
  B({ id: 'sentinel', name: 'Sentinel Cannon', description: 'Coalition long-range twin cannon fortification.', category: 'defense', factions: ['cdc'], hasTurret: true, w: 2, h: 2, hp: 1600, armor: 'bld', cost: 1500, buildTime: 16, prereqs: ['tech'], vision: 9.5, power: -60, weapon: 'sentinelgun', hotkey: 'E' }),
  B({ id: 'arcpylon', name: 'Arc Pylon', description: 'Directorate tesla-coil defense. Lightning chains between targets.', category: 'defense', factions: ['esd'], w: 2, h: 2, hp: 1000, armor: 'bld', cost: 1400, buildTime: 15, prereqs: ['tech'], vision: 8, power: -75, weapon: 'arc', hotkey: 'E' }),
  B({ id: 'derrick', name: 'Ferrite Extractor', description: 'Neutral tech structure. Capture with an Engineer for steady income.', category: 'building', unbuildable: true, w: 2, h: 2, hp: 1200, armor: 'bld', cost: 0, buildTime: 1, prereqs: [], vision: 4, power: 0, income: 18 }),
];

export const DEFS: Record<string, EntityDef> = Object.fromEntries(
  [...UNIT_DEFS, ...BUILDING_DEFS].map((d) => [d.id, d]),
);
export const UNITS: Record<string, UnitDef> = Object.fromEntries(UNIT_DEFS.map((d) => [d.id, d]));
export const BUILDINGS: Record<string, BuildingDef> = Object.fromEntries(BUILDING_DEFS.map((d) => [d.id, d]));
/** Stable index of every type, used by the compact network encoding. */
export const TYPE_IDS: string[] = [...UNIT_DEFS, ...BUILDING_DEFS].map((d) => d.id);
export const TYPE_INDEX: Record<string, number> = Object.fromEntries(TYPE_IDS.map((id, i) => [id, i]));

/** Own-property lookup safe against prototype keys like `__proto__`. */
export function isKnownType(type: unknown): type is string {
  return typeof type === 'string' && Object.prototype.hasOwnProperty.call(DEFS, type);
}

export function displayName(def: EntityDef, faction?: FactionId): string {
  return (faction && def.names?.[faction]) || def.name;
}

export function categoryOf(def: EntityDef): QueueCategory {
  return def.category;
}
