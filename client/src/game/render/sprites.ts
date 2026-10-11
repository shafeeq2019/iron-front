import { BUILDINGS, TILE, UNITS, type FactionId } from '@iron/shared';
import { hexToRgb, mix, rgb, shade, type RGB } from './color';

/** Internal supersampling so sprites stay crisp when zoomed in. */
export const SS = 2;

export interface Sprite {
  canvas: HTMLCanvasElement;
  /** Anchor offset in logical px (draw at x - ax, y - ay). */
  ax: number;
  ay: number;
  w: number;
  h: number;
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * SS);
  c.height = Math.ceil(h * SS);
  const ctx = c.getContext('2d')!;
  ctx.scale(SS, SS);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  return [c, ctx];
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
}
function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}
function poly(ctx: CanvasRenderingContext2D, pts: number[]) {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath();
}
function fillStroke(ctx: CanvasRenderingContext2D, fill: string | CanvasGradient, stroke = 'rgba(0,0,0,0.55)', lw = 0.8) {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lw;
  ctx.stroke();
}
/** Vertical metallic gradient across the local y axis. */
function metal(ctx: CanvasRenderingContext2D, base: RGB, y0: number, y1: number) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, rgb(shade(base, 1.25)));
  g.addColorStop(0.45, rgb(base));
  g.addColorStop(1, rgb(shade(base, 0.6)));
  return g;
}

const DARK: RGB = [38, 40, 36];
const STEEL: RGB = [118, 122, 118];
const OLIVE: RGB = [86, 92, 60];

/** Team colour toned down to a military paint. */
function paint(color: string, faction: FactionId): RGB {
  const c = hexToRgb(color);
  return faction === 'cdc' ? mix(c, [150, 160, 170], 0.25) : mix(c, [90, 80, 70], 0.3);
}

// ---------------------------------------------------------------- units

function tracks(ctx: CanvasRenderingContext2D, len: number, y: number, h: number, frame: number) {
  rr(ctx, -len / 2, y, len, h, 2);
  fillStroke(ctx, rgb(DARK), 'rgba(0,0,0,0.8)');
  ctx.strokeStyle = 'rgba(120,120,110,0.55)';
  ctx.lineWidth = 0.9;
  for (let x = -len / 2 + 1.5 + (frame % 2) * 1.5; x < len / 2 - 1; x += 3) {
    ctx.beginPath();
    ctx.moveTo(x, y + 0.6);
    ctx.lineTo(x, y + h - 0.6);
    ctx.stroke();
  }
}
function wheel(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  rr(ctx, x - r * 1.2, y - r * 0.7, r * 2.4, r * 1.4, 1.5);
  fillStroke(ctx, 'rgb(28,28,26)', 'rgba(0,0,0,0.9)');
}

function drawInfantry(ctx: CanvasRenderingContext2D, type: string, color: string, faction: FactionId, frame: number) {
  const team = hexToRgb(color);
  const uni = faction === 'cdc' ? mix(OLIVE, [70, 90, 110], 0.35) : mix(OLIVE, [110, 90, 70], 0.3);
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(1.5, 1.8, 6, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();
  // legs
  const l = frame === 0 ? 2.6 : frame === 1 ? -2.6 : 0;
  ctx.fillStyle = rgb(shade(uni, 0.6));
  rr(ctx, -2 + Math.min(0, l), -3.6, 4 + Math.abs(l), 2.4, 1.2); ctx.fill();
  rr(ctx, -2 + Math.min(0, -l), 1.2, 4 + Math.abs(l), 2.4, 1.2); ctx.fill();
  // backpack
  rr(ctx, -5.2, -2.6, 3, 5.2, 1);
  fillStroke(ctx, rgb(shade(uni, 0.7)));
  // body with team-coloured shoulder pads
  ctx.beginPath();
  ctx.ellipse(0, 0, 3.4, 4.9, 0, 0, Math.PI * 2);
  fillStroke(ctx, rgb(uni));
  ctx.fillStyle = rgb(team);
  circle(ctx, 0.2, -3.9, 1.5); ctx.fill();
  circle(ctx, 0.2, 3.9, 1.5); ctx.fill();
  // weapon
  ctx.lineCap = 'butt';
  if (type === 'rifle') {
    ctx.strokeStyle = 'rgb(30,30,30)'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(-0.5, 2); ctx.lineTo(9, 1.6); ctx.stroke();
  } else if (type === 'rocket') {
    ctx.strokeStyle = rgb(shade(OLIVE, 0.9)); ctx.lineWidth = 3.4;
    ctx.beginPath(); ctx.moveTo(-6, -2.6); ctx.lineTo(8.5, -2.6); ctx.stroke();
    ctx.strokeStyle = 'rgb(25,25,25)'; ctx.lineWidth = 3.6;
    ctx.beginPath(); ctx.moveTo(8, -2.6); ctx.lineTo(9.5, -2.6); ctx.stroke();
  } else if (type === 'scout') {
    ctx.strokeStyle = 'rgb(30,30,30)'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(1, 2.2); ctx.lineTo(5.5, 2.2); ctx.stroke();
  } else if (type === 'engineer') {
    rr(ctx, 1.5, 2.2, 4.5, 3, 0.6);
    fillStroke(ctx, 'rgb(200,60,40)');
  }
  ctx.lineCap = 'round';
  // arms
  ctx.fillStyle = rgb(shade(uni, 1.1));
  circle(ctx, 2.6, 2.2, 1.2); ctx.fill();
  circle(ctx, 2.2, -2, 1.2); ctx.fill();
  // head
  const helmet = type === 'engineer' ? [232, 190, 48] as RGB : type === 'scout' ? shade(team, 0.55) : shade(uni, 0.85);
  circle(ctx, 0.6, 0, 2.6);
  fillStroke(ctx, rgb(helmet), 'rgba(0,0,0,0.7)', 0.7);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  circle(ctx, 0, -0.8, 1); ctx.fill();
}

type BodyFn = (ctx: CanvasRenderingContext2D, c: RGB, frame: number, faction: FactionId) => void;
type TurretFn = (ctx: CanvasRenderingContext2D, c: RGB, faction: FactionId) => void;

const VEHICLES: Record<string, { size: number; body: BodyFn; turret?: TurretFn }> = {
  lighttank: {
    size: 36,
    body: (ctx, c, f) => {
      rr(ctx, -12, -8, 26, 18, 3); ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.translate(2, 2.5); ctx.fill(); ctx.translate(-2, -2.5);
      tracks(ctx, 27, -11, 6, f); tracks(ctx, 27, 5, 6, f);
      rr(ctx, -12.5, -7, 25, 14, 3); fillStroke(ctx, metal(ctx, c, -7, 7));
      ctx.fillStyle = rgb(shade(c, 0.7)); rr(ctx, -12, -5, 4, 10, 1); ctx.fill();
      ctx.strokeStyle = rgb(shade(c, 0.5)); ctx.lineWidth = 0.7;
      for (let y = -4; y <= 4; y += 2) { ctx.beginPath(); ctx.moveTo(-11.5, y); ctx.lineTo(-8.5, y); ctx.stroke(); }
      ctx.fillStyle = rgb(shade(c, 1.2)); poly(ctx, [9, -6, 12.5, -4, 12.5, 4, 9, 6]); ctx.fill();
    },
    turret: (ctx, c) => {
      ctx.fillStyle = 'rgb(40,40,38)'; rr(ctx, 4, -1.6, 15, 3.2, 1); ctx.fill();
      rr(ctx, 17, -2.1, 3, 4.2, 1); ctx.fill();
      circle(ctx, 0, 0, 6.2); fillStroke(ctx, metal(ctx, shade(c, 1.08), -6, 6));
      rr(ctx, 3.5, -2.6, 3, 5.2, 1); fillStroke(ctx, rgb(shade(c, 0.8)));
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; circle(ctx, -2, -2, 1.6); ctx.fill();
    },
  },
  heavytank: {
    size: 44,
    body: (ctx, c, f) => {
      rr(ctx, -16, -11, 34, 24, 3); ctx.fillStyle = 'rgba(0,0,0,0.32)'; ctx.translate(2.5, 3); ctx.fill(); ctx.translate(-2.5, -3);
      tracks(ctx, 34, -14.5, 8, f); tracks(ctx, 34, 6.5, 8, f);
      rr(ctx, -16, -9, 32, 18, 3); fillStroke(ctx, metal(ctx, c, -9, 9));
      ctx.fillStyle = rgb(shade(c, 0.65)); rr(ctx, -15.5, -7, 6, 14, 1.5); ctx.fill();
      ctx.fillStyle = rgb(shade(c, 1.25)); poly(ctx, [12, -8.5, 16, -6, 16, 6, 12, 8.5]); ctx.fill();
      ctx.strokeStyle = rgb(shade(c, 0.5)); ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(-8, -8.5); ctx.lineTo(-8, 8.5); ctx.stroke();
    },
    turret: (ctx, c) => {
      ctx.fillStyle = 'rgb(38,38,36)';
      rr(ctx, 4, -4.4, 18, 3, 1); ctx.fill();
      rr(ctx, 4, 1.4, 18, 3, 1); ctx.fill();
      rr(ctx, 20, -5, 3.5, 4.2, 1); ctx.fill(); rr(ctx, 20, 0.8, 3.5, 4.2, 1); ctx.fill();
      rr(ctx, -8, -8, 15, 16, 4); fillStroke(ctx, metal(ctx, shade(c, 1.1), -8, 8));
      ctx.fillStyle = rgb(shade(c, 0.75)); rr(ctx, -6, -5, 5, 10, 1.5); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.4)'; circle(ctx, -4, 3.5, 1.6); ctx.fill();
    },
  },
  raider: {
    size: 32,
    body: (ctx, c) => {
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; rr(ctx, -10, -8, 22, 18, 4); ctx.fill();
      wheel(ctx, -7, -8, 3); wheel(ctx, 7, -8, 3); wheel(ctx, -7, 8, 3); wheel(ctx, 7, 8, 3);
      poly(ctx, [-11, -6, 6, -6.5, 13, -2, 13, 2, 6, 6.5, -11, 6]);
      fillStroke(ctx, metal(ctx, c, -6, 6));
      ctx.strokeStyle = 'rgb(30,30,30)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(-6, -6); ctx.lineTo(-2, -3); ctx.lineTo(-2, 3); ctx.lineTo(-6, 6); ctx.stroke();
      ctx.fillStyle = rgb(shade(c, 0.6)); poly(ctx, [6, -4, 11, -1.5, 11, 1.5, 6, 4]); ctx.fill();
    },
    turret: (ctx, c) => {
      ctx.fillStyle = 'rgb(35,35,33)';
      rr(ctx, 2, -2.6, 11, 1.8, 0.8); ctx.fill();
      rr(ctx, 2, 0.8, 11, 1.8, 0.8); ctx.fill();
      rr(ctx, -4, -3.6, 8, 7.2, 1.5); fillStroke(ctx, rgb(shade(c, 0.85)));
      ctx.fillStyle = 'rgba(255,255,255,0.2)'; rr(ctx, -3, -3, 3, 2, 1); ctx.fill();
    },
  },
  mauler: {
    size: 42,
    body: (ctx, c, f) => {
      ctx.fillStyle = 'rgba(0,0,0,0.32)'; poly(ctx, [-14, -11, 16, -11, 20, -6, 20, 8, 16, 13, -14, 13]); ctx.fill();
      tracks(ctx, 32, -13.5, 7.5, f); tracks(ctx, 32, 6, 7.5, f);
      poly(ctx, [-15, -8, 11, -8, 16, -4, 16, 4, 11, 8, -15, 8]);
      fillStroke(ctx, metal(ctx, c, -8, 8));
      ctx.fillStyle = rgb(shade(c, 0.6)); poly(ctx, [-15, -6, -10, -6, -10, 6, -15, 6]); ctx.fill();
      ctx.strokeStyle = rgb(shade(c, 1.3)); ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(11, -8); ctx.lineTo(16, -4); ctx.stroke();
    },
    turret: (ctx, c) => {
      ctx.fillStyle = 'rgb(38,38,36)';
      rr(ctx, 4, -2, 20, 4, 1); ctx.fill();
      rr(ctx, 21, -3.2, 4.5, 6.4, 1); ctx.fill();
      poly(ctx, [-7, -7, 4, -7, 8, -3, 8, 3, 4, 7, -7, 7]);
      fillStroke(ctx, metal(ctx, shade(c, 1.05), -7, 7));
      ctx.fillStyle = rgb(shade(c, 0.7)); poly(ctx, [-5, -4, 0, -4, 0, 4, -5, 4]); ctx.fill();
    },
  },
  artillery: {
    size: 40,
    body: (ctx, c, f) => {
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; rr(ctx, -12, -8, 26, 19, 3); ctx.fill();
      tracks(ctx, 25, -10.5, 5.5, f); tracks(ctx, 25, 5, 5.5, f);
      rr(ctx, -12, -6, 24, 12, 2); fillStroke(ctx, metal(ctx, c, -6, 6));
      ctx.strokeStyle = 'rgb(40,40,40)'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(-12, -4); ctx.lineTo(-16, -6); ctx.moveTo(-12, 4); ctx.lineTo(-16, 6); ctx.stroke();
    },
    turret: (ctx, c) => {
      ctx.fillStyle = 'rgb(40,40,38)';
      rr(ctx, 2, -1.3, 23, 2.6, 1); ctx.fill();
      rr(ctx, 22, -2, 4, 4, 1); ctx.fill();
      rr(ctx, -6, -5, 11, 10, 2); fillStroke(ctx, metal(ctx, shade(c, 1.1), -5, 5));
      ctx.fillStyle = rgb(shade(c, 0.7)); rr(ctx, -5, -3.5, 3, 7, 1); ctx.fill();
    },
  },
  hailstorm: {
    size: 40,
    body: (ctx, c) => {
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; rr(ctx, -13, -8, 30, 18, 3); ctx.fill();
      for (const x of [-9, -2, 9]) { wheel(ctx, x, -8, 3); wheel(ctx, x, 8, 3); }
      rr(ctx, -14, -6.5, 22, 13, 2); fillStroke(ctx, metal(ctx, shade(c, 0.85), -6, 6));
      rr(ctx, 8, -6, 7, 12, 2.5); fillStroke(ctx, metal(ctx, c, -6, 6));
      ctx.fillStyle = 'rgba(160,200,230,0.7)'; rr(ctx, 12, -4.5, 2.2, 9, 1); ctx.fill();
    },
    turret: (ctx, c) => {
      rr(ctx, -9, -6, 15, 12, 1.5); fillStroke(ctx, metal(ctx, shade(c, 1.05), -6, 6));
      ctx.fillStyle = 'rgb(25,25,25)';
      for (const y of [-3, 3]) for (const x of [3, -1]) { circle(ctx, x + 2, y, 1.9); ctx.fill(); }
      ctx.fillStyle = rgb(shade(c, 0.6)); rr(ctx, -8, -5, 3, 10, 1); ctx.fill();
    },
  },
  harvester: {
    size: 44,
    body: (ctx, c, f) => {
      ctx.fillStyle = 'rgba(0,0,0,0.32)'; rr(ctx, -15, -11, 34, 25, 3); ctx.fill();
      tracks(ctx, 30, -13, 7, f); tracks(ctx, 30, 6, 7, f);
      // scoop
      ctx.fillStyle = 'rgb(70,70,66)'; poly(ctx, [13, -11, 19, -9, 19, 9, 13, 11]); ctx.fill();
      ctx.strokeStyle = 'rgb(30,30,30)'; ctx.lineWidth = 1;
      for (let y = -8; y <= 8; y += 3.2) { ctx.beginPath(); ctx.moveTo(17, y); ctx.lineTo(20.5, y); ctx.stroke(); }
      rr(ctx, -15, -9, 29, 18, 2.5); fillStroke(ctx, metal(ctx, [150, 145, 120], -9, 9));
      // hopper
      rr(ctx, -13, -7, 17, 14, 1.5); fillStroke(ctx, 'rgb(60,58,50)');
      ctx.fillStyle = rgb(c); rr(ctx, -15, -9, 29, 2.4, 1); ctx.fill(); rr(ctx, -15, 6.6, 29, 2.4, 1); ctx.fill();
      rr(ctx, 6, -6, 7, 12, 1.5); fillStroke(ctx, metal(ctx, c, -6, 6));
      ctx.fillStyle = 'rgba(160,200,230,0.7)'; rr(ctx, 10.5, -4.5, 2, 9, 0.8); ctx.fill();
    },
  },
  mcv: {
    size: 50,
    body: (ctx, c, f) => {
      ctx.fillStyle = 'rgba(0,0,0,0.32)'; rr(ctx, -19, -11, 42, 25, 3); ctx.fill();
      tracks(ctx, 38, -13, 7, f); tracks(ctx, 38, 6, 7, f);
      rr(ctx, -20, -9, 40, 18, 2.5); fillStroke(ctx, metal(ctx, c, -9, 9));
      rr(ctx, 11, -8, 9, 16, 2.5); fillStroke(ctx, metal(ctx, shade(c, 1.1), -8, 8));
      ctx.fillStyle = 'rgba(160,200,230,0.75)'; rr(ctx, 16.5, -6, 2.4, 12, 1); ctx.fill();
      rr(ctx, -17, -6, 12, 12, 1); fillStroke(ctx, 'rgb(140,138,128)');
      rr(ctx, -3, -7, 12, 14, 1); fillStroke(ctx, rgb(shade(c, 0.75)));
      ctx.strokeStyle = 'rgb(220,180,40)'; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(6, -4); ctx.stroke();
      ctx.fillStyle = 'rgb(220,180,40)'; circle(ctx, -12, 0, 2); ctx.fill();
    },
  },
};

const unitCache = new Map<string, Sprite>();

export function unitBodySprite(type: string, color: string, faction: FactionId, frame: number): Sprite {
  const key = `${type}|${color}|${faction}|${frame}`;
  let s = unitCache.get(key);
  if (s) return s;
  const def = UNITS[type];
  if (def.category === 'infantry') {
    const size = 28;
    const [c, ctx] = makeCanvas(size, size);
    ctx.translate(size / 2, size / 2);
    ctx.scale(1.25, 1.25);
    drawInfantry(ctx, type, color, faction, frame);
    s = { canvas: c, ax: size / 2, ay: size / 2, w: size, h: size };
  } else {
    const v = VEHICLES[type];
    const size = v.size + 8;
    const [c, ctx] = makeCanvas(size, size);
    ctx.translate(size / 2, size / 2);
    v.body(ctx, paint(color, faction), frame, faction);
    s = { canvas: c, ax: size / 2, ay: size / 2, w: size, h: size };
  }
  unitCache.set(key, s);
  return s;
}

export function unitTurretSprite(type: string, color: string, faction: FactionId): Sprite | null {
  const v = VEHICLES[type];
  if (!v?.turret) return null;
  const key = `${type}|${color}|${faction}|turret`;
  let s = unitCache.get(key);
  if (s) return s;
  const size = v.size + 12;
  const [c, ctx] = makeCanvas(size, size);
  ctx.translate(size / 2, size / 2);
  v.turret(ctx, paint(color, faction), faction);
  s = { canvas: c, ax: size / 2, ay: size / 2, w: size, h: size };
  unitCache.set(key, s);
  return s;
}

// ---------------------------------------------------------------- buildings

export interface BuildingMeta {
  /** Chimney/smoke points in local px (relative to footprint top-left). */
  smoke?: [number, number][];
  dish?: [number, number, number];
  gun?: { x: number; y: number; len: number; twin?: boolean; r: number };
  glow?: [number, number, number];
  pump?: [number, number];
  door?: [number, number, number, number];
  lights?: [number, number][];
}

export const BUILDING_META: Record<string, BuildingMeta> = {
  hq: { lights: [[14, 14], [82, 14]] },
  power: { smoke: [[18, 14], [44, 14]] },
  refinery: { smoke: [[72, 18]], lights: [[48, 84]] },
  barracks: {},
  factory: { door: [30, 70, 36, 22], lights: [[12, 12], [84, 12]] },
  radar: { dish: [32, 24, 13] },
  tech: { glow: [48, 34, 12], lights: [[16, 16], [80, 16]] },
  pillbox: {},
  turret: { gun: { x: 16, y: 14, len: 15, r: 6 } },
  sentinel: { gun: { x: 32, y: 26, len: 24, twin: true, r: 11 } },
  arcpylon: { glow: [32, 12, 8] },
  derrick: { pump: [38, 26], smoke: [[16, 12]] },
};

const bCache = new Map<string, Sprite>();
const PAD = 8;

function pad(ctx: CanvasRenderingContext2D, w: number, h: number, faction: FactionId | null) {
  const base: RGB = faction === 'esd' ? [104, 100, 92] : faction === 'cdc' ? [118, 120, 120] : [110, 106, 96];
  rr(ctx, 1, 1, w - 2, h - 2, 3);
  ctx.fillStyle = rgb(base);
  ctx.fill();
  ctx.strokeStyle = rgb(shade(base, 0.6));
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.strokeStyle = rgb(shade(base, 0.85));
  ctx.lineWidth = 0.6;
  for (let x = TILE; x < w; x += TILE) { ctx.beginPath(); ctx.moveTo(x, 2); ctx.lineTo(x, h - 2); ctx.stroke(); }
  for (let y = TILE; y < h; y += TILE) { ctx.beginPath(); ctx.moveTo(2, y); ctx.lineTo(w - 2, y); ctx.stroke(); }
}

/** Oblique "3/4" box: roof on top, darker front wall below, cast shadow. */
function block(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, elev: number, roof: RGB, r = 2) {
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  rr(ctx, x + elev * 0.5, y + elev * 0.4, w, h, r);
  ctx.fill();
  rr(ctx, x, y + h - elev, w, elev, r);
  ctx.fillStyle = rgb(shade(roof, 0.55));
  ctx.fill();
  rr(ctx, x, y - elev * 0.15, w, h - elev, r);
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, rgb(shade(roof, 1.18)));
  g.addColorStop(1, rgb(shade(roof, 0.82)));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 0.8;
  ctx.stroke();
}
function cylinder(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, h: number, col: RGB) {
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  circle(ctx, x + h * 0.4, y + h * 0.5, r); ctx.fill();
  ctx.fillStyle = rgb(shade(col, 0.6));
  rr(ctx, x - r, y, r * 2, h, r * 0.3); ctx.fill();
  circle(ctx, x, y + h, r); ctx.fill();
  const g = ctx.createRadialGradient(x - r * 0.4, y - r * 0.4, r * 0.1, x, y, r);
  g.addColorStop(0, rgb(shade(col, 1.3)));
  g.addColorStop(1, rgb(shade(col, 0.8)));
  circle(ctx, x, y, r);
  fillStroke(ctx, g);
}
function stripes(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.save();
  rr(ctx, x, y, w, h, 1); ctx.clip();
  ctx.fillStyle = 'rgb(220,175,40)'; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgb(30,30,30)'; ctx.lineWidth = 2.2;
  for (let i = -h; i < w; i += 6) { ctx.beginPath(); ctx.moveTo(x + i, y + h); ctx.lineTo(x + i + h, y); ctx.stroke(); }
  ctx.restore();
}
function emblem(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, team: RGB, faction: FactionId | null) {
  circle(ctx, x, y, r);
  fillStroke(ctx, rgb(shade(team, 0.7)), 'rgba(0,0,0,0.6)', 0.8);
  ctx.fillStyle = 'rgb(235,225,200)';
  if (faction === 'esd') poly(ctx, [x - r * 0.6, y + r * 0.35, x, y - r * 0.55, x + r * 0.6, y + r * 0.35, x, y]);
  else poly(ctx, [x, y - r * 0.6, x + r * 0.55, y, x, y + r * 0.6, x - r * 0.55, y]);
  ctx.fill();
}

type BDraw = (ctx: CanvasRenderingContext2D, team: RGB, faction: FactionId | null) => void;

const BDRAW: Record<string, BDraw> = {
  hq: (ctx, t, f) => {
    pad(ctx, 96, 96, f);
    block(ctx, 8, 10, 80, 66, 14, shade(t, 0.9), 4);
    block(ctx, 18, 16, 36, 30, 8, [150, 150, 145], 3);
    if (f === 'esd') { block(ctx, 60, 14, 20, 40, 18, shade(t, 0.7), 2); }
    else { circle(ctx, 70, 32, 13); fillStroke(ctx, 'rgb(170,190,205)'); ctx.fillStyle = 'rgba(255,255,255,0.35)'; circle(ctx, 66, 28, 5); ctx.fill(); }
    emblem(ctx, 36, 30, 8, t, f);
    stripes(ctx, 8, 80, 80, 6);
    ctx.strokeStyle = 'rgb(220,180,40)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(14, 70); ctx.lineTo(14, 52); ctx.lineTo(40, 58); ctx.stroke();
  },
  power: (ctx, t, f) => {
    pad(ctx, 64, 64, f);
    block(ctx, 4, 22, 56, 36, 9, [128, 132, 126], 3);
    ctx.fillStyle = rgb(t); rr(ctx, 6, 42, 52, 4, 1); ctx.fill();
    if (f === 'esd') { cylinder(ctx, 18, 10, 6, 16, [90, 88, 84]); cylinder(ctx, 44, 10, 6, 16, [90, 88, 84]); }
    else { cylinder(ctx, 18, 12, 10, 12, [170, 172, 168]); cylinder(ctx, 44, 12, 10, 12, [170, 172, 168]);
      ctx.fillStyle = 'rgb(50,52,50)'; circle(ctx, 18, 12, 6); ctx.fill(); circle(ctx, 44, 12, 6); ctx.fill(); }
    ctx.fillStyle = 'rgb(255,220,90)'; poly(ctx, [30, 26, 26, 34, 31, 34, 28, 40, 36, 30, 31, 30, 34, 26]); ctx.fill();
  },
  refinery: (ctx, t, f) => {
    pad(ctx, 96, 96, f);
    cylinder(ctx, 20, 18, 12, 14, [176, 170, 150]);
    cylinder(ctx, 20, 46, 12, 14, [176, 170, 150]);
    block(ctx, 40, 10, 50, 50, 12, shade(t, 0.85), 3);
    ctx.fillStyle = 'rgb(60,60,58)'; rr(ctx, 46, 16, 20, 18, 2); ctx.fill();
    cylinder(ctx, 72, 18, 5, 10, [80, 80, 78]);
    stripes(ctx, 26, 72, 44, 18);
    ctx.fillStyle = 'rgb(55,55,52)'; rr(ctx, 32, 76, 32, 10, 2); ctx.fill();
    ctx.fillStyle = 'rgb(230,170,40)'; circle(ctx, 20, 18, 5); ctx.fill();
  },
  barracks: (ctx, t, f) => {
    pad(ctx, 64, 64, f);
    if (f === 'esd') {
      ctx.fillStyle = 'rgb(140,120,80)';
      for (let i = 0; i < 9; i++) { rr(ctx, 4 + i * 6.5, 50, 7, 6, 2.5); ctx.fill(); }
      block(ctx, 8, 10, 48, 40, 12, [104, 98, 84], 6);
    } else {
      block(ctx, 6, 12, 52, 40, 12, [120, 128, 104], 2);
      ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(6, 24, 52, 2);
    }
    ctx.fillStyle = rgb(t); rr(ctx, 12, 18, 40, 5, 1); ctx.fill();
    ctx.fillStyle = 'rgb(40,40,40)'; rr(ctx, 26, 42, 12, 8, 1); ctx.fill();
    ctx.strokeStyle = 'rgb(60,60,60)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(54, 6); ctx.lineTo(54, 28); ctx.stroke();
    ctx.fillStyle = rgb(t); poly(ctx, [54, 6, 62, 9, 54, 12]); ctx.fill();
  },
  factory: (ctx, t, f) => {
    pad(ctx, 96, 96, f);
    block(ctx, 6, 8, 84, 66, 16, [130, 132, 126], 3);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1;
    for (let x = 12; x < 88; x += 6) { ctx.beginPath(); ctx.moveTo(x, 8); ctx.lineTo(x, 56); ctx.stroke(); }
    ctx.fillStyle = rgb(t); rr(ctx, 6, 26, 84, 6, 1); ctx.fill();
    emblem(ctx, 76, 16, 7, t, f);
    stripes(ctx, 26, 66, 44, 26);
  },
  radar: (ctx, t, f) => {
    pad(ctx, 64, 64, f);
    block(ctx, 8, 30, 48, 28, 10, [128, 130, 124], 3);
    ctx.fillStyle = rgb(t); rr(ctx, 10, 46, 44, 4, 1); ctx.fill();
    ctx.fillStyle = 'rgb(70,70,68)'; circle(ctx, 32, 24, 6); ctx.fill();
    ctx.strokeStyle = 'rgb(70,70,68)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(32, 24); ctx.lineTo(32, 40); ctx.stroke();
  },
  tech: (ctx, t, f) => {
    pad(ctx, 96, 96, f);
    block(ctx, 6, 14, 84, 70, 14, [120, 124, 130], 4);
    const g = ctx.createRadialGradient(42, 28, 3, 48, 34, 22);
    g.addColorStop(0, 'rgb(220,240,255)'); g.addColorStop(1, 'rgb(60,110,150)');
    circle(ctx, 48, 34, 20); fillStroke(ctx, g);
    ctx.fillStyle = rgb(t); rr(ctx, 10, 64, 76, 5, 1); ctx.fill();
    emblem(ctx, 18, 26, 6, t, f);
  },
  pillbox: (ctx, t) => {
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; circle(ctx, 18, 19, 13); ctx.fill();
    circle(ctx, 16, 16, 13); fillStroke(ctx, 'rgb(150,145,130)');
    circle(ctx, 16, 15, 9); fillStroke(ctx, 'rgb(170,165,150)');
    ctx.fillStyle = 'rgb(30,30,30)'; rr(ctx, 9, 20, 14, 3, 1); ctx.fill();
    ctx.fillStyle = rgb(t); circle(ctx, 16, 13, 3); ctx.fill();
  },
  turret: (ctx, t) => {
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; poly(ctx, [10, 4, 26, 4, 32, 12, 32, 26, 26, 32, 10, 32, 4, 26, 4, 12]); ctx.fill();
    poly(ctx, [8, 2, 24, 2, 30, 8, 30, 24, 24, 30, 8, 30, 2, 24, 2, 8]); fillStroke(ctx, 'rgb(140,140,134)');
    ctx.fillStyle = rgb(shade(t, 0.8)); rr(ctx, 6, 26, 20, 3, 1); ctx.fill();
  },
  sentinel: (ctx, t, f) => {
    pad(ctx, 64, 64, f);
    poly(ctx, [10, 6, 54, 6, 60, 14, 60, 54, 54, 60, 10, 60, 4, 54, 4, 14]);
    fillStroke(ctx, 'rgb(130,132,128)');
    ctx.fillStyle = rgb(shade(t, 0.8)); rr(ctx, 8, 52, 48, 4, 1); ctx.fill();
  },
  arcpylon: (ctx, t, f) => {
    pad(ctx, 64, 64, f);
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; poly(ctx, [20, 60, 44, 60, 40, 22, 24, 22]); ctx.translate(6, 0); ctx.fill(); ctx.translate(-6, 0);
    poly(ctx, [18, 58, 46, 58, 38, 18, 26, 18]); fillStroke(ctx, metal(ctx, [100, 100, 104], 18, 58));
    ctx.strokeStyle = 'rgb(190,120,50)'; ctx.lineWidth = 2.5;
    for (let y = 24; y < 54; y += 6) { ctx.beginPath(); ctx.moveTo(26 - (y - 18) * 0.2, y); ctx.lineTo(38 + (y - 18) * 0.2, y); ctx.stroke(); }
    ctx.fillStyle = rgb(t); rr(ctx, 16, 56, 32, 4, 1); ctx.fill();
    circle(ctx, 32, 12, 7); fillStroke(ctx, 'rgb(150,170,200)');
  },
  derrick: (ctx) => {
    pad(ctx, 64, 64, null);
    cylinder(ctx, 16, 14, 9, 12, [150, 120, 70]);
    cylinder(ctx, 16, 40, 8, 10, [150, 120, 70]);
    block(ctx, 30, 30, 28, 24, 6, [110, 105, 95], 2);
    ctx.fillStyle = 'rgb(240,190,40)'; rr(ctx, 34, 48, 20, 3, 1); ctx.fill();
  },
};

export function buildingSprite(type: string, color: string, faction: FactionId | null): Sprite {
  const key = `${type}|${color}|${faction}`;
  let s = bCache.get(key);
  if (s) return s;
  const def = BUILDINGS[type];
  const w = def.w * TILE, h = def.h * TILE;
  const [c, ctx] = makeCanvas(w + PAD * 2, h + PAD * 2);
  ctx.translate(PAD, PAD);
  const team = faction ? paint(color, faction) : hexToRgb('#a8a49a');
  (BDRAW[type] ?? BDRAW.power)(ctx, team, faction);
  s = { canvas: c, ax: PAD, ay: PAD, w: w + PAD * 2, h: h + PAD * 2 };
  bCache.set(key, s);
  return s;
}

/** Turret barrel for defensive structures (drawn rotated at runtime). */
export function drawBuildingGun(ctx: CanvasRenderingContext2D, meta: NonNullable<BuildingMeta['gun']>, color: string, faction: FactionId, angle: number) {
  const team = paint(color, faction);
  ctx.save();
  ctx.rotate(angle);
  ctx.fillStyle = 'rgb(40,40,38)';
  if (meta.twin) {
    rr(ctx, 4, -5, meta.len, 3.4, 1); ctx.fill();
    rr(ctx, 4, 1.6, meta.len, 3.4, 1); ctx.fill();
  } else {
    rr(ctx, 3, -1.8, meta.len, 3.6, 1); ctx.fill();
  }
  circle(ctx, 0, 0, meta.r);
  fillStroke(ctx, metal(ctx, shade(team, 1.05), -meta.r, meta.r));
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; circle(ctx, -meta.r * 0.3, -meta.r * 0.3, meta.r * 0.3); ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------- icons

const iconCache = new Map<string, string>();
/** Data-URL icon for build buttons and selection portraits. */
export function iconFor(type: string, color: string, faction: FactionId): string {
  const key = `${type}|${color}|${faction}`;
  const hit = iconCache.get(key);
  if (hit) return hit;
  const W = 96, H = 72;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#2c3529'); g.addColorStop(1, '#141912');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  for (let x = 0; x < W; x += 12) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  const b = BUILDINGS[type];
  if (b) {
    const s = buildingSprite(type, color, faction);
    const scale = Math.min((W - 8) / s.w, (H - 6) / s.h) * 1.05;
    ctx.drawImage(s.canvas, (W - s.w * scale) / 2, (H - s.h * scale) / 2, s.w * scale, s.h * scale);
    const meta = BUILDING_META[type];
    if (meta?.gun) {
      ctx.save();
      ctx.translate((W - s.w * scale) / 2 + (meta.gun.x + PAD) * scale, (H - s.h * scale) / 2 + (meta.gun.y + PAD) * scale);
      ctx.scale(scale, scale);
      drawBuildingGun(ctx, meta.gun, color, faction, -0.6);
      ctx.restore();
    }
  } else {
    const body = unitBodySprite(type, color, faction, 2);
    const tur = unitTurretSprite(type, color, faction);
    const isInf = UNITS[type].category === 'infantry';
    const scale = isInf ? 2.6 : Math.min(1.8, 64 / body.w);
    ctx.save();
    ctx.translate(W / 2, H / 2 + 2);
    ctx.rotate(-0.55);
    ctx.scale(scale, scale);
    ctx.drawImage(body.canvas, -body.ax, -body.ay, body.w, body.h);
    if (tur) ctx.drawImage(tur.canvas, -tur.ax, -tur.ay, tur.w, tur.h);
    ctx.restore();
  }
  const url = c.toDataURL();
  iconCache.set(key, url);
  return url;
}

export function clearSpriteCaches() {
  unitCache.clear();
  bCache.clear();
  iconCache.clear();
}
