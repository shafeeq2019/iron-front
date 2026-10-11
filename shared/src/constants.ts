/** World units (pixels at zoom 1) per map tile. */
export const TILE = 32;
/** Simulation ticks per second. */
export const TICK_RATE = 20;
export const DT = 1 / TICK_RATE;
/** How often (in ticks) the fog of war is recomputed. */
export const FOG_INTERVAL = 4;
/** How often (in ticks) idle units look for targets. */
export const SCAN_INTERVAL = 5;
/** Server snapshot interval in ticks (10 Hz). */
export const NET_SNAPSHOT_INTERVAL = 2;
export const STARTING_CREDITS = 5000;
/** Max tiles between a new structure and an existing friendly structure. */
export const BUILD_RADIUS = 6;
export const MAX_QUEUE = 9;
export const NEUTRAL = -1;
/** Max A* searches per tick across the whole sim. */
export const PATH_BUDGET = 24;
/** Max A* node expansions per tick across the whole sim. */
export const PATH_NODE_BUDGET = 25_000;
export const ORE_REGROW_INTERVAL = 200;
export const DISCONNECT_GRACE_MS = 60_000;
