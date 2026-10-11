import {
  BUILDINGS, BUILD_RADIUS, DEFS, FACTIONS, TERRAIN_BUILDABLE, TICK_RATE, TILE, UNITS, displayName,
  type BuildingDef, type Command, type FactionId, type GameEvent, type MatchResult, type PlayerInfo, type QueueCategory, type UnitDef,
} from '@iron/shared';
import { audio } from './audio';
import { Camera } from './camera';
import type { GameConnection } from './connection';
import { Effects } from './render/effects';
import { Minimap } from './render/minimap';
import { Renderer, type Overlay } from './render/renderer';
import { getSettings, IS_TOUCH, onSettings } from './settings';
import { Store } from './store';
import { ClientWorld, type ViewEntity } from './world';

export type Mode = 'normal' | 'attack' | 'sweep' | 'place';
export const CATEGORIES: QueueCategory[] = ['building', 'defense', 'infantry', 'vehicle'];

export interface BuildOption {
  type: string;
  name: string;
  cost: number;
  available: boolean;
  hotkey?: string;
  description: string;
  missing: string[];
}

export interface SelectionInfo {
  count: number;
  groups: { type: string; name: string; count: number }[];
  primary: {
    id: number; type: string; name: string; hp: number; maxHp: number; owner: number; ownerName: string;
    isBuilding: boolean; mine: boolean; repairing: boolean; producer: boolean; cargo: number; description: string;
  } | null;
  canDeploy: boolean;
  hasUnits: boolean;
}

export interface HudMessage { id: number; text: string; kind: 'info' | 'warn' | 'good'; t: number }

export interface HudState {
  credits: number;
  power: [number, number];
  time: number;
  queues: Record<QueueCategory, { items: [string, number][]; ready: string | null; onHold: boolean }>;
  options: Record<QueueCategory, BuildOption[]>;
  selection: SelectionInfo;
  sweep: number;
  messages: HudMessage[];
  mode: Mode;
  placement: string | null;
  placementValid: boolean;
  result: MatchResult | null;
  defeated: boolean;
  players: PlayerInfo[];
  faction: FactionId;
  color: string;
  paused: boolean;
  fps: number;
  simInfo: string;
  boxSelect: boolean;
  connected: boolean;
}

const emptyQueues = () => Object.fromEntries(CATEGORIES.map((c) => [c, { items: [], ready: null, onHold: false }])) as unknown as HudState['queues'];
const emptyOptions = () => Object.fromEntries(CATEGORIES.map((c) => [c, []])) as unknown as HudState['options'];

const NOTICE_TEXT: Record<string, [string, HudMessage['kind'], string | null]> = {
  constructionComplete: ['Construction complete', 'good', 'Construction complete'],
  unitReady: ['Unit ready', 'good', 'Unit ready'],
  insufficientFunds: ['Insufficient funds', 'warn', 'Insufficient funds'],
  lowPower: ['Low power — production slowed, defenses weakened', 'warn', 'Low power'],
  baseAttack: ['Our base is under attack!', 'warn', 'Our base is under attack'],
  unitLost: ['Unit lost', 'warn', null],
  buildingLost: ['Structure lost', 'warn', 'Structure lost'],
  cannotDeploy: ['Cannot deploy here — find open ground', 'warn', 'Cannot deploy here'],
  buildingCaptured: ['Structure captured', 'good', 'Structure captured'],
  playerDefeated: ['Player defeated', 'info', null],
  cannotPlace: ['Cannot place structure there', 'warn', null],
  queueFull: ['Queue is full', 'warn', null],
  sweepReady: ['Recon Sweep ready', 'good', 'Recon sweep ready'],
};

interface PointerInfo { id: number; x: number; y: number; sx: number; sy: number; t: number; type: string; button: number; moved: boolean }

/**
 * Owns the client side of a match: world model, renderer, effects, audio hooks,
 * input (mouse/keyboard/touch), selection and the HUD store.
 */
export class GameController {
  readonly world: ClientWorld;
  readonly camera: Camera;
  readonly effects = new Effects();
  readonly hud: Store<HudState>;
  renderer!: Renderer;
  minimap!: Minimap;
  private canvas!: HTMLCanvasElement;
  private minimapCanvas: HTMLCanvasElement | null = null;
  private raf = 0;
  private lastFrame = 0;
  private lastHud = 0;
  private lastMinimap = 0;
  private fpsAcc = { frames: 0, t: 0, fps: 0 };
  selected = new Set<number>();
  private groups = new Map<number, number[]>();
  private lastGroupKey = { key: -1, t: 0 };
  mode: Mode = 'normal';
  placement: string | null = null;
  private placeTile: { x: number; y: number } | null = null;
  private placeTiles = new Uint8Array(9);
  private placeValid = false;
  private pointers = new Map<number, PointerInfo>();
  private pinch: { d: number; mx: number; my: number } | null = null;
  private dragBox: Overlay['dragBox'] = null;
  private boxSelectArmed = false;
  private longPress: ReturnType<typeof setTimeout> | null = null;
  private lastTap = { t: 0, id: -1 };
  private keys = new Set<string>();
  private mouse: { x: number; y: number; inside: boolean; moved: boolean } = { x: 0, y: 0, inside: false, moved: false };
  private hoverId = 0;
  private markers: Overlay['markers'] = [];
  private messages: HudMessage[] = [];
  private msgId = 0;
  private paused = false;
  private cleanup: (() => void)[] = [];
  private resultHandled = false;
  private started = false;
  private multiSelect = false;
  onExit?: () => void;

  constructor(readonly conn: GameConnection) {
    this.world = new ClientWorld(conn.mapId, conn.playerId);
    this.camera = new Camera(this.world.w * TILE, this.world.h * TILE);
    this.hud = new Store<HudState>({
      credits: 0, power: [0, 0], time: 0, queues: emptyQueues(), options: emptyOptions(),
      selection: { count: 0, groups: [], primary: null, canDeploy: false, hasUnits: false },
      sweep: -1, messages: [], mode: 'normal', placement: null, placementValid: false, result: null, defeated: false,
      players: [], faction: 'cdc', color: '#888', paused: false, fps: 0, simInfo: '', boxSelect: false, connected: true,
    });
    conn.onSnapshot = (s) => this.world.applySnapshot(s);
    this.effects.setQuality(getSettings().quality);
    this.cleanup.push(onSettings((s) => this.effects.setQuality(s.quality)));
  }

  // ---------------------------------------------------------------- lifecycle

  attach(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new Renderer(canvas, this.world);
    this.minimap = new Minimap(this.world, this.renderer.terrain.minimapImage());
    this.resize();
    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement | Window, ev: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(ev, fn as EventListener, opts);
      this.cleanup.push(() => el.removeEventListener(ev, fn as EventListener, opts));
    };
    on(canvas, 'pointerdown', (e) => this.onPointerDown(e));
    on(canvas, 'pointermove', (e) => this.onPointerMove(e));
    on(canvas, 'pointerup', (e) => this.onPointerUp(e));
    on(canvas, 'pointercancel', (e) => this.onPointerCancel(e));
    on(canvas, 'pointerleave', () => { this.mouse.inside = false; });
    on(canvas, 'pointerenter', (e) => {
      if (e.pointerType !== 'mouse') return;
      const r = canvas.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left;
      this.mouse.y = e.clientY - r.top;
      this.mouse.inside = true;
    });
    on(canvas, 'wheel', (e) => this.onWheel(e), { passive: false });
    on(canvas, 'contextmenu', (e) => e.preventDefault());
    on(window, 'keydown', (e) => this.onKeyDown(e));
    on(window, 'keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    on(window, 'blur', () => this.keys.clear());
    on(window, 'resize', () => this.resize());
    this.conn.start();
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  setMinimapCanvas(c: HTMLCanvasElement | null) {
    this.minimapCanvas = c;
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.conn.stop();
    for (const c of this.cleanup) c();
    this.cleanup = [];
    audio.stopMusic();
  }

  resize() {
    if (!this.canvas) return;
    const w = window.innerWidth, h = window.innerHeight;
    const cap = getSettings().quality === 'low' ? 1.25 : 2;
    const dpr = Math.min(cap, window.devicePixelRatio || 1);
    this.renderer.resize(w, h, dpr);
    this.camera.vw = w;
    this.camera.vh = h;
    this.camera.clamp();
  }

  /** Space reserved by HUD panels so the whole map stays reachable. */
  setInsets(right: number, bottom: number, top = 0) {
    this.camera.padRight = right;
    this.camera.padBottom = bottom;
    this.camera.padTop = top;
    this.camera.clamp();
  }

  setPaused(p: boolean) {
    this.paused = p;
    this.conn.setPaused(p);
    this.hud.patch({ paused: p });
  }

  // ---------------------------------------------------------------- frame

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.fpsAcc.frames++;
    this.fpsAcc.t += dt;
    if (this.fpsAcc.t >= 1) { this.fpsAcc.fps = Math.round(this.fpsAcc.frames / this.fpsAcc.t); this.fpsAcc.frames = 0; this.fpsAcc.t = 0; }

    const w = this.world;
    if (!this.started && w.me) {
      const mine = [...w.ents.values()].find((e) => e.owner === w.playerId && (e.type === 'mcv' || e.type === 'hq'))
        ?? [...w.ents.values()].find((e) => e.owner === w.playerId);
      if (mine || w.me.defeated) {
        this.started = true;
        this.camera.zoom = IS_TOUCH ? 1 : 1.25;
        if (mine) this.camera.centerOn(mine.x, mine.y);
        audio.startMusic();
      }
    }
    w.update(now);
    this.processEvents();
    this.scrollCamera(dt);
    this.effects.update(this.paused ? 0 : dt);
    for (const id of this.selected) {
      const e = w.ents.get(id);
      if (!e || e.owner !== w.playerId) this.selected.delete(id);
    }
    this.markers = this.markers.filter((m) => now - m.t < 600);
    if (this.placement) this.updatePlacement();
    audio.listener.x = this.camera.x + this.camera.viewW / 2;
    audio.listener.y = this.camera.y + this.camera.viewH / 2;
    audio.listener.r = Math.max(this.camera.viewW, this.camera.viewH) * 0.7;

    const pointerWorld = this.mouse.inside ? this.camera.screenToWorld(this.mouse.x, this.mouse.y) : null;
    this.renderer.draw(this.camera, this.effects, {
      selected: this.selected, hoverId: this.hoverId, dragBox: this.dragBox,
      placement: this.placement && this.placeTile ? { type: this.placement, tx: this.placeTile.x, ty: this.placeTile.y, tiles: this.placeTiles } : null,
      markers: this.markers, attackMode: this.mode === 'attack', sweepMode: this.mode === 'sweep', pointer: pointerWorld,
    }, now);
    if (this.minimapCanvas && now - this.lastMinimap > 150) {
      this.lastMinimap = now;
      this.minimap.draw(this.minimapCanvas, this.camera);
    }
    if (now - this.lastHud > 150) {
      this.lastHud = now;
      this.updateHud();
    }
  };

  private onScreen = (x: number, y: number) => {
    const c = this.camera;
    return x > c.x - 64 && x < c.x + c.viewW + 64 && y > c.y - 64 && y < c.y + c.viewH + 64;
  };

  private processEvents() {
    const w = this.world;
    if (!w.events.length) return;
    const evs = w.events;
    w.events = [];
    for (const ev of evs) {
      if (ev.e === 'notice') this.notice(ev);
      else this.effects.handle(ev, w, this.onScreen);
    }
  }

  private notice(ev: Extract<GameEvent, { e: 'notice' }>) {
    const info = NOTICE_TEXT[ev.msg];
    if (!info) return;
    let [text, kind, speech] = info;
    if (ev.msg === 'playerDefeated' && ev.type) { text = `${ev.type} has been defeated`; speech = text; }
    if ((ev.msg === 'constructionComplete' || ev.msg === 'unitReady') && ev.type && DEFS[ev.type]) {
      text = `${displayName(DEFS[ev.type], this.world.playerFaction(this.world.playerId))} ${ev.msg === 'unitReady' ? 'ready' : 'complete'}`;
    }
    this.message(text, kind);
    const sfx = { constructionComplete: 'complete', unitReady: 'ready', baseAttack: 'alert', insufficientFunds: 'error', lowPower: 'alert', cannotDeploy: 'error', cannotPlace: 'error', queueFull: 'error', buildingCaptured: 'complete', sweepReady: 'ready' } as const;
    const s = sfx[ev.msg as keyof typeof sfx];
    if (s) audio.play(s);
    if (speech) audio.say(speech);
  }

  message(text: string, kind: HudMessage['kind'] = 'info') {
    const now = performance.now();
    const last = this.messages[this.messages.length - 1];
    if (last && last.text === text && now - last.t < 1500) return;
    this.messages = [...this.messages.filter((m) => now - m.t < 6000), { id: ++this.msgId, text, kind, t: now }].slice(-5);
    this.hud.patch({ messages: this.messages });
  }

  // ---------------------------------------------------------------- HUD

  private builtTypes(): Set<string> {
    const s = new Set<string>();
    for (const e of this.world.ents.values()) if (e.owner === this.world.playerId && e.isBuilding && (e.extra & 127) >= 100) s.add(e.type);
    return s;
  }

  buildOptions(): HudState['options'] {
    const fac = this.world.playerFaction(this.world.playerId);
    const built = this.builtTypes();
    const out = emptyOptions();
    for (const def of Object.values(DEFS)) {
      if (def.kind === 'building' && def.unbuildable) continue;
      if (def.factions && !def.factions.includes(fac)) continue;
      const missing = def.prereqs.filter((p) => !built.has(p));
      out[def.category].push({ type: def.id, name: displayName(def, fac), cost: def.cost, available: missing.length === 0, hotkey: def.hotkey, description: def.description, missing: missing.map((m) => BUILDINGS[m].name) });
    }
    return out;
  }

  private selectionInfo(): SelectionInfo {
    const w = this.world;
    const ents = [...this.selected].map((id) => w.ents.get(id)).filter(Boolean) as ViewEntity[];
    const groupsMap = new Map<string, number>();
    for (const e of ents) groupsMap.set(e.type, (groupsMap.get(e.type) ?? 0) + 1);
    const fac = w.playerFaction(w.playerId);
    const groups = [...groupsMap.entries()].map(([type, count]) => ({ type, count, name: displayName(DEFS[type], fac) }));
    let primary: SelectionInfo['primary'] = null;
    const p = ents[0] ?? (this.hoverId ? w.ents.get(this.hoverId) : undefined);
    const inspect = ents.length ? ents[0] : this.inspectId ? w.ents.get(this.inspectId) : undefined;
    const e = inspect ?? undefined;
    void p;
    if (e) {
      const def = e.def;
      primary = {
        id: e.id, type: e.type, name: displayName(def, e.owner >= 0 ? w.playerFaction(e.owner) : undefined), hp: Math.ceil(e.hp), maxHp: e.maxHp,
        owner: e.owner, ownerName: e.owner < 0 ? 'Neutral' : w.players[e.owner]?.name ?? '', isBuilding: e.isBuilding, mine: e.owner === w.playerId,
        repairing: (e.extra & 128) !== 0, producer: def.kind === 'building' && !!def.produces, cargo: def.kind === 'unit' && def.harvester ? (e.extra & 127) : -1,
        description: def.description,
      };
    }
    return {
      count: ents.length,
      groups,
      primary,
      canDeploy: ents.some((e) => e.def.kind === 'unit' && !!e.def.deploysTo),
      hasUnits: ents.some((e) => !e.isBuilding),
    };
  }
  private inspectId = 0;

  private updateHud() {
    const w = this.world;
    const me = w.me;
    const queues = emptyQueues();
    if (me) for (const q of me.queues) queues[q.cat] = { items: q.items, ready: q.ready, onHold: q.onHold };
    const conn = this.conn as { simMs?: number };
    this.hud.set({
      ...this.hud.get(),
      credits: me?.credits ?? 0,
      power: me?.power ?? [0, 0],
      time: w.tick / TICK_RATE,
      queues,
      options: this.buildOptions(),
      selection: this.selectionInfo(),
      sweep: me ? me.sweep : -1,
      messages: this.messages.filter((m) => performance.now() - m.t < 6000),
      mode: this.mode,
      placement: this.placement,
      placementValid: this.placeValid,
      result: w.result,
      defeated: me?.defeated ?? false,
      players: w.players,
      faction: w.playerFaction(w.playerId),
      color: w.playerColor(w.playerId),
      fps: this.fpsAcc.fps,
      simInfo: conn.simMs !== undefined ? `sim ${conn.simMs.toFixed(2)}ms · ${this.renderer.drawnUnits} units drawn` : `${this.renderer.drawnUnits} units drawn`,
      boxSelect: this.boxSelectArmed,
    });
    if (w.result && !this.resultHandled) {
      this.resultHandled = true;
      const won = w.result.winners.includes(w.playerId);
      audio.stopMusic();
      audio.play(won ? 'victory' : 'defeat');
      audio.say(won ? 'Mission accomplished' : 'Mission failed');
    }
  }

  // ---------------------------------------------------------------- commands

  send(cmd: Command) {
    this.conn.send(cmd);
  }

  private ownSelectedUnits(): ViewEntity[] {
    const out: ViewEntity[] = [];
    for (const id of this.selected) {
      const e = this.world.ents.get(id);
      if (e && !e.isBuilding && e.owner === this.world.playerId) out.push(e);
    }
    return out;
  }

  /** Right-click / tap command resolution based on what is under the cursor. */
  contextCommand(wx: number, wy: number) {
    const w = this.world;
    const units = this.ownSelectedUnits();
    const target = w.pick(wx, wy);
    const ghost = target ? null : w.pickGhost(wx, wy);
    if (!units.length) {
      // Rally point for selected production buildings.
      const prods = [...this.selected].map((id) => w.ents.get(id)).filter((e) => e && e.isBuilding && (e.def as BuildingDef).produces) as ViewEntity[];
      for (const b of prods) this.send({ t: 'rally', id: b.id, x: wx, y: wy });
      if (prods.length) { audio.play('ack'); this.markers.push({ x: wx, y: wy, t: performance.now(), kind: 'rally' }); }
      return;
    }
    const me = w.playerId;
    const allied = (o: number) => o >= 0 && (o === me || w.players[o]?.team === w.players[me]?.team);
    const ids = (f: (u: ViewEntity) => boolean) => units.filter(f).map((u) => u.id);
    const isEng = (u: ViewEntity) => u.def.kind === 'unit' && !!u.def.engineer;
    const isHarv = (u: ViewEntity) => u.def.kind === 'unit' && !!u.def.harvester;
    const armed = (u: ViewEntity) => !!u.def.weapon;
    let rest = units.map((u) => u.id);
    const done = (list: number[]) => { rest = rest.filter((id) => !list.includes(id)); };
    const tgtId = target?.id ?? ghost?.id ?? 0;
    const tgtOwner = target?.owner ?? ghost?.owner ?? -2;
    const tgtIsBuilding = target ? target.isBuilding : !!ghost;
    let kind: 'move' | 'attack' = 'move';
    if (tgtId && tgtOwner !== -2 && !allied(tgtOwner)) {
      if (tgtIsBuilding) {
        const engs = ids(isEng);
        if (engs.length) { this.send({ t: 'enter', ids: engs, target: tgtId }); done(engs); }
      }
      if (tgtOwner >= 0) {
        const att = ids((u) => armed(u) && rest.includes(u.id));
        if (att.length) { this.send({ t: 'attack', ids: att, target: tgtId }); done(att); kind = 'attack'; }
      }
    } else if (target && target.owner === me && target.isBuilding) {
      const def = target.def as BuildingDef;
      if (def.refinery) {
        const hv = ids(isHarv);
        if (hv.length) { this.send({ t: 'enter', ids: hv, target: target.id }); done(hv); }
      }
      if (target.hp < target.maxHp) {
        const engs = ids(isEng);
        if (engs.length) { this.send({ t: 'enter', ids: engs, target: target.id }); done(engs); }
      }
    }
    if (w.oreAtWorld(wx, wy) > 0) {
      const hv = ids((u) => isHarv(u) && rest.includes(u.id));
      if (hv.length) { this.send({ t: 'harvest', ids: hv, x: wx, y: wy }); done(hv); }
    }
    if (rest.length) this.send({ t: 'move', ids: rest, x: wx, y: wy });
    this.markers.push({ x: wx, y: wy, t: performance.now(), kind });
    audio.play('ack');
  }

  attackMove(wx: number, wy: number) {
    const ids = this.ownSelectedUnits().map((u) => u.id);
    if (!ids.length) return;
    this.send({ t: 'attackMove', ids, x: wx, y: wy });
    this.markers.push({ x: wx, y: wy, t: performance.now(), kind: 'attack' });
    audio.play('ack');
  }

  stop() {
    const ids = this.ownSelectedUnits().map((u) => u.id);
    if (ids.length) { this.send({ t: 'stop', ids }); audio.play('ack'); }
  }
  deploy() {
    const ids = this.ownSelectedUnits().filter((u) => u.def.kind === 'unit' && u.def.deploysTo).map((u) => u.id);
    if (ids.length) { this.send({ t: 'deploy', ids }); audio.play('ack'); }
  }
  sellSelected() {
    for (const id of this.selected) {
      const e = this.world.ents.get(id);
      if (e?.isBuilding && e.owner === this.world.playerId) this.send({ t: 'sell', id });
    }
    this.selected.clear();
  }
  repairSelected() {
    for (const id of this.selected) {
      const e = this.world.ents.get(id);
      if (e?.isBuilding && e.owner === this.world.playerId) this.send({ t: 'repair', id });
    }
    audio.play('click');
  }
  surrender() {
    this.send({ t: 'surrender' });
  }

  setMode(m: Mode) {
    this.mode = m;
    if (m !== 'place') { this.placement = null; this.placeTile = null; }
    this.hud.patch({ mode: m, placement: this.placement });
  }

  /** Clicked a build button. */
  buildClick(cat: QueueCategory, type: string) {
    audio.unlock();
    const q = this.world.me?.queues.find((x) => x.cat === cat);
    if (q?.ready === type) {
      this.startPlacement(type);
      return;
    }
    this.send({ t: 'build', cat, type });
    audio.play('click');
  }
  buildCancel(cat: QueueCategory, type: string) {
    this.send({ t: 'cancel', cat, type });
    if (this.placement === type) this.setMode('normal');
    audio.play('click');
  }

  startPlacement(type: string) {
    this.placement = type;
    this.mode = 'place';
    const def = BUILDINGS[type];
    this.placeTiles = new Uint8Array(def.w * def.h);
    // Start the ghost at the screen centre on touch devices.
    const c = this.camera.screenToWorld(this.camera.vw / 2 - this.camera.padRight / 2, this.camera.vh / 2 - this.camera.padBottom / 2);
    this.placeTile = { x: Math.floor(c.x / TILE - def.w / 2 + 0.5), y: Math.floor(c.y / TILE - def.h / 2 + 0.5) };
    if (!IS_TOUCH && this.mouse.inside) this.movePlacement(this.mouse.x, this.mouse.y);
    this.hud.patch({ mode: 'place', placement: type });
  }

  private movePlacement(sx: number, sy: number) {
    if (!this.placement) return;
    const def = BUILDINGS[this.placement];
    const p = this.camera.screenToWorld(sx, sy);
    this.placeTile = { x: Math.floor(p.x / TILE - def.w / 2 + 0.5), y: Math.floor(p.y / TILE - def.h / 2 + 0.5) };
  }

  /** Client-side placement preview (the server re-validates authoritatively). */
  private updatePlacement() {
    const w = this.world;
    if (!this.placement || !this.placeTile) return;
    const def = BUILDINGS[this.placement];
    const occ = new Set<number>();
    const mine: ViewEntity[] = [];
    for (const e of w.ents.values()) {
      if (e.isBuilding) {
        for (let y = e.ty; y < e.ty + e.h; y++) for (let x = e.tx; x < e.tx + e.w; x++) occ.add(y * w.w + x);
        if (e.owner === w.playerId && e.type !== 'derrick') mine.push(e);
      }
    }
    for (const g of w.ghosts) { const d = BUILDINGS[g.type]; for (let y = g.ty; y < g.ty + d.h; y++) for (let x = g.tx; x < g.tx + d.w; x++) occ.add(y * w.w + x); }
    const { x: tx, y: ty } = this.placeTile;
    let near = false;
    for (const e of mine) {
      const dx = Math.max(e.tx - (tx + def.w), tx - (e.tx + e.w), 0);
      const dy = Math.max(e.ty - (ty + def.h), ty - (e.ty + e.h), 0);
      if (Math.max(dx, dy) <= BUILD_RADIUS) { near = true; break; }
    }
    let all = near;
    for (let j = 0; j < def.h; j++)
      for (let i = 0; i < def.w; i++) {
        const x = tx + i, y = ty + j;
        let ok = near && x >= 1 && y >= 1 && x < w.w - 1 && y < w.h - 1;
        if (ok) {
          const k = y * w.w + x;
          ok = TERRAIN_BUILDABLE[w.map.terrain[k]] && !occ.has(k) && w.ore[k] === 0 && w.explored[k] === 1;
          if (ok) for (const e of w.ents.values()) {
            if (e.isBuilding) continue;
            if (Math.floor(e.x / TILE) === x && Math.floor(e.y / TILE) === y) { ok = false; break; }
          }
        }
        this.placeTiles[j * def.w + i] = ok ? 1 : 0;
        if (!ok) all = false;
      }
    this.placeValid = all;
  }

  confirmPlacement() {
    if (!this.placement || !this.placeTile) return;
    if (!this.placeValid) { audio.play('error'); this.message('Cannot place structure there', 'warn'); return; }
    this.send({ t: 'place', type: this.placement, tx: this.placeTile.x, ty: this.placeTile.y });
    this.setMode('normal');
  }

  sweepAt(wx: number, wy: number) {
    this.send({ t: 'sweep', x: wx, y: wy });
    this.setMode('normal');
  }

  // ---------------------------------------------------------------- selection

  selectIds(ids: number[], add = false) {
    if (!add) this.selected.clear();
    for (const id of ids) this.selected.add(id);
    this.inspectId = 0;
    if (ids.length) audio.play('select');
    this.updateHud();
  }

  private selectBox(x0: number, y0: number, x1: number, y1: number, add: boolean) {
    const a = this.camera.screenToWorld(Math.min(x0, x1), Math.min(y0, y1));
    const b = this.camera.screenToWorld(Math.max(x0, x1), Math.max(y0, y1));
    const ids: number[] = [];
    for (const e of this.world.ents.values()) {
      if (e.isBuilding || e.owner !== this.world.playerId) continue;
      if (e.x >= a.x && e.x <= b.x && e.y >= a.y && e.y <= b.y) ids.push(e.id);
    }
    // Prefer combat units over harvesters when mixed.
    const combat = ids.filter((id) => { const d = this.world.ents.get(id)!.def as UnitDef; return !d.harvester; });
    this.selectIds(combat.length ? combat : ids, add);
  }

  selectSameTypeOnScreen(type: string) {
    const c = this.camera;
    const ids: number[] = [];
    for (const e of this.world.ents.values()) {
      if (e.owner !== this.world.playerId || e.type !== type) continue;
      if (e.x >= c.x && e.x <= c.x + c.viewW && e.y >= c.y && e.y <= c.y + c.viewH) ids.push(e.id);
    }
    this.selectIds(ids);
  }

  selectAllArmy() {
    const ids: number[] = [];
    for (const e of this.world.ents.values()) {
      if (e.isBuilding || e.owner !== this.world.playerId || !e.def.weapon) continue;
      ids.push(e.id);
    }
    this.selectIds(ids);
  }

  deselect() {
    this.selected.clear();
    this.inspectId = 0;
    this.updateHud();
  }

  private clickSelect(sx: number, sy: number, add: boolean) {
    const p = this.camera.screenToWorld(sx, sy);
    const e = this.world.pick(p.x, p.y, IS_TOUCH ? 8 : 0);
    if (!e) {
      if (!add) this.deselect();
      return;
    }
    const now = performance.now();
    if (e.owner === this.world.playerId) {
      if (!e.isBuilding && now - this.lastTap.t < 350 && this.lastTap.id === e.id) {
        this.selectSameTypeOnScreen(e.type);
      } else if (add && this.selected.has(e.id)) {
        this.selected.delete(e.id);
        this.updateHud();
      } else {
        this.selectIds([e.id], add && !e.isBuilding);
      }
    } else {
      this.selected.clear();
      this.inspectId = e.id;
      this.updateHud();
    }
    this.lastTap = { t: now, id: e.id };
  }

  centerOnSelection() {
    const ents = [...this.selected].map((id) => this.world.ents.get(id)).filter(Boolean) as ViewEntity[];
    if (ents.length) {
      this.camera.centerOn(ents.reduce((s, e) => s + e.x, 0) / ents.length, ents.reduce((s, e) => s + e.y, 0) / ents.length);
      return;
    }
    const hq = [...this.world.ents.values()].find((e) => e.owner === this.world.playerId && (e.type === 'hq' || e.type === 'mcv'));
    if (hq) this.camera.centerOn(hq.x, hq.y);
  }

  minimapNavigate(cssX: number, cssY: number, command: boolean) {
    if (!this.minimapCanvas) return;
    const p = this.minimap.toWorld(this.minimapCanvas, cssX, cssY);
    if (command && this.selected.size) this.contextCommand(p.x, p.y);
    else this.camera.centerOn(p.x, p.y);
  }

  toggleBoxSelect() {
    this.boxSelectArmed = !this.boxSelectArmed;
    this.hud.patch({ boxSelect: this.boxSelectArmed });
  }
  toggleMultiSelect() {
    this.multiSelect = !this.multiSelect;
  }

  // ---------------------------------------------------------------- input

  private onPointerDown(e: PointerEvent) {
    audio.unlock();
    this.canvas.setPointerCapture?.(e.pointerId);
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const info: PointerInfo = { id: e.pointerId, x, y, sx: x, sy: y, t: performance.now(), type: e.pointerType, button: e.button, moved: false };
    this.pointers.set(e.pointerId, info);
    if (e.pointerType === 'touch') {
      e.preventDefault();
      if (this.pointers.size === 2) {
        this.cancelLongPress();
        this.dragBox = null;
        const [a, b] = [...this.pointers.values()];
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
        for (const p of this.pointers.values()) p.moved = true;
      } else if (this.pointers.size === 1) {
        if (this.boxSelectArmed) this.dragBox = { x0: x, y0: y, x1: x, y1: y };
        else if (this.mode === 'normal') {
          this.longPress = setTimeout(() => {
            const p = this.pointers.get(e.pointerId);
            if (p && !p.moved) {
              this.dragBox = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
              navigator.vibrate?.(20);
            }
          }, 420);
        }
      }
      return;
    }
    if (e.button === 2) {
      if (this.mode !== 'normal') { this.setMode('normal'); return; }
      const p = this.camera.screenToWorld(x, y);
      this.contextCommand(p.x, p.y);
    }
  }

  private cancelLongPress() {
    if (this.longPress) clearTimeout(this.longPress);
    this.longPress = null;
  }

  private onPointerMove(e: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    if (e.pointerType === 'mouse') { this.mouse.x = x; this.mouse.y = y; this.mouse.inside = true; this.mouse.moved = true; }
    const info = this.pointers.get(e.pointerId);
    if (e.pointerType === 'touch') {
      if (!info) return;
      const dx = x - info.x, dy = y - info.y;
      info.x = x; info.y = y;
      if (this.pointers.size >= 2 && this.pinch) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        if (this.pinch.d > 10) this.camera.zoomAt(mx, my, d / this.pinch.d);
        this.camera.pan(this.pinch.mx - mx, this.pinch.my - my);
        this.pinch = { d, mx, my };
        return;
      }
      if (this.dragBox) { this.dragBox.x1 = x; this.dragBox.y1 = y; info.moved = true; return; }
      if (!info.moved && Math.hypot(x - info.sx, y - info.sy) > 10) { info.moved = true; this.cancelLongPress(); }
      if (info.moved) {
        if (this.mode === 'place' && this.placement) this.movePlacement(x, y);
        else this.camera.pan(-dx, -dy);
      }
      return;
    }
    // Mouse
    if (this.mode === 'place') this.movePlacement(x, y);
    if (info) {
      if (info.button === 1) { this.camera.pan(info.x - x, info.y - y); info.x = x; info.y = y; return; }
      if (info.button === 0 && this.mode === 'normal') {
        if (!info.moved && Math.hypot(x - info.sx, y - info.sy) > 6) { info.moved = true; this.dragBox = { x0: info.sx, y0: info.sy, x1: x, y1: y }; }
        if (this.dragBox) { this.dragBox.x1 = x; this.dragBox.y1 = y; }
      }
      info.x = x; info.y = y;
    }
    const wp = this.camera.screenToWorld(x, y);
    const h = this.world.pick(wp.x, wp.y);
    this.hoverId = h?.id ?? 0;
    this.canvas.style.cursor = this.cursorFor(h, wp.x, wp.y);
  }

  private cursorFor(h: ViewEntity | null, wx: number, wy: number): string {
    if (this.mode === 'attack' || this.mode === 'sweep') return 'crosshair';
    if (this.mode === 'place') return 'copy';
    const hasUnits = this.ownSelectedUnits().length > 0;
    if (h && h.owner !== this.world.playerId && h.owner >= 0 && hasUnits) return 'crosshair';
    if (h && h.owner === this.world.playerId) return 'pointer';
    if (hasUnits && this.world.oreAtWorld(wx, wy) > 0) return 'cell';
    return 'default';
  }

  private onPointerUp(e: PointerEvent) {
    const info = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    this.cancelLongPress();
    if (!info) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    if (e.pointerType === 'touch') {
      if (this.pinch) { if (this.pointers.size < 2) this.pinch = null; return; }
      if (this.dragBox) {
        const b = this.dragBox;
        this.dragBox = null;
        if (Math.hypot(b.x1 - b.x0, b.y1 - b.y0) > 12) this.selectBox(b.x0, b.y0, b.x1, b.y1, this.multiSelect);
        if (this.boxSelectArmed) this.toggleBoxSelect();
        return;
      }
      if (!info.moved) this.tap(x, y);
      return;
    }
    if (info.button !== 0) return;
    if (this.dragBox) {
      const b = this.dragBox;
      this.dragBox = null;
      this.selectBox(b.x0, b.y0, b.x1, b.y1, e.shiftKey);
      return;
    }
    if (info.moved) return;
    const p = this.camera.screenToWorld(x, y);
    if (this.mode === 'place') { this.movePlacement(x, y); this.updatePlacement(); this.confirmPlacement(); return; }
    if (this.mode === 'attack') { this.attackMove(p.x, p.y); if (!e.shiftKey) this.setMode('normal'); return; }
    if (this.mode === 'sweep') { this.sweepAt(p.x, p.y); return; }
    this.clickSelect(x, y, e.shiftKey || e.ctrlKey);
  }

  private onPointerCancel(e: PointerEvent) {
    this.pointers.delete(e.pointerId);
    this.cancelLongPress();
    if (this.pointers.size < 2) this.pinch = null;
    this.dragBox = null;
  }

  /** Touch tap: select, or contextual command when units are selected. */
  private tap(x: number, y: number) {
    const p = this.camera.screenToWorld(x, y);
    if (this.mode === 'place') { this.movePlacement(x, y); return; }
    if (this.mode === 'attack') { this.attackMove(p.x, p.y); this.setMode('normal'); return; }
    if (this.mode === 'sweep') { this.sweepAt(p.x, p.y); return; }
    const hit = this.world.pick(p.x, p.y, 8);
    const units = this.ownSelectedUnits();
    if (hit && hit.owner === this.world.playerId) {
      // Tapping own refinery with harvesters selected, or damaged building with engineers, is a command.
      if (units.length && hit.isBuilding) {
        const def = hit.def as BuildingDef;
        const hasHarv = units.some((u) => (u.def as UnitDef).harvester);
        const hasEng = units.some((u) => (u.def as UnitDef).engineer);
        if ((def.refinery && hasHarv) || (hasEng && hit.hp < hit.maxHp)) { this.contextCommand(p.x, p.y); return; }
      }
      this.clickSelect(x, y, this.multiSelect);
      return;
    }
    if (units.length) { this.contextCommand(p.x, p.y); return; }
    // Production building selected: tap sets rally point.
    const prod = [...this.selected].some((id) => { const e = this.world.ents.get(id); return e?.isBuilding && (e.def as BuildingDef).produces; });
    if (prod && !hit) { this.contextCommand(p.x, p.y); return; }
    this.clickSelect(x, y, false);
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
    this.camera.zoomAt(e.clientX - rect.left, e.clientY - rect.top, f);
  }

  private onKeyDown(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const k = e.key.toLowerCase();
    this.keys.add(k);
    if (/^[0-9]$/.test(k)) {
      const n = Number(k);
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        this.groups.set(n, this.ownSelectedUnits().map((u) => u.id));
        this.message(`Group ${n} assigned`, 'info');
      } else {
        const ids = (this.groups.get(n) ?? []).filter((id) => this.world.ents.has(id));
        const now = performance.now();
        if (this.lastGroupKey.key === n && now - this.lastGroupKey.t < 400) this.centerOnSelection();
        else if (ids.length) this.selectIds(ids, e.shiftKey);
        this.lastGroupKey = { key: n, t: now };
      }
      return;
    }
    switch (k) {
      case 'escape':
        if (this.mode !== 'normal') this.setMode('normal');
        else if (this.selected.size) this.deselect();
        else this.onPauseRequest?.();
        break;
      case 'a': if (this.ownSelectedUnits().length) this.setMode('attack'); break;
      case 's': this.stop(); break;
      case 'd': this.deploy(); break;
      case 'h': case ' ': e.preventDefault(); this.centerOnSelection(); break;
      case 'p': case 'f10': this.onPauseRequest?.(); break;
      case 'delete': this.sellSelected(); break;
      default:
        this.onHotkey?.(k);
    }
  }
  onPauseRequest?: () => void;
  onHotkey?: (key: string) => void;

  private scrollCamera(dt: number) {
    const s = getSettings();
    const speed = 900 * s.scrollSpeed * dt;
    let dx = 0, dy = 0;
    if (this.keys.has('arrowleft')) dx -= speed;
    if (this.keys.has('arrowright')) dx += speed;
    if (this.keys.has('arrowup')) dy -= speed;
    if (this.keys.has('arrowdown')) dy += speed;
    // Only after a real mouse move: a stationary cursor has unknown/stale coordinates.
    if (s.edgeScroll && this.mouse.inside && this.mouse.moved && !this.pointers.size && document.hasFocus()) {
      const m = 10;
      if (this.mouse.x < m) dx -= speed;
      if (this.mouse.x > this.camera.vw - m) dx += speed;
      if (this.mouse.y < m) dy -= speed;
      if (this.mouse.y > this.camera.vh - m) dy += speed;
    }
    if (dx || dy) this.camera.pan(dx, dy);
  }

  factionName() {
    return FACTIONS[this.world.playerFaction(this.world.playerId)].short;
  }
  unitName(type: string) {
    return displayName(DEFS[type] ?? UNITS.rifle, this.world.playerFaction(this.world.playerId));
  }
}
