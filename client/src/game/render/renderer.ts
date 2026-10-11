import { BUILDINGS, TILE, WEAPONS, X_LOWPOWER, X_REPAIR, X_HARVESTING, hash2, type BuildingDef, type FactionId, type UnitDef } from '@iron/shared';
import type { Camera } from '../camera';
import type { ClientWorld, ViewEntity } from '../world';
import type { Effects } from './effects';
import { BUILDING_META, SS, buildingSprite, drawBuildingGun, unitBodySprite, unitTurretSprite } from './sprites';
import { oreSprite, TerrainRenderer } from './terrain';

export interface Overlay {
  selected: Set<number>;
  hoverId: number;
  dragBox: { x0: number; y0: number; x1: number; y1: number } | null;
  placement: { type: string; tx: number; ty: number; tiles: Uint8Array } | null;
  markers: { x: number; y: number; t: number; kind: 'move' | 'attack' | 'rally' }[];
  attackMode: boolean;
  sweepMode: boolean;
  pointer: { x: number; y: number } | null;
}

export class Renderer {
  readonly ctx: CanvasRenderingContext2D;
  readonly terrain: TerrainRenderer;
  private fogCanvas: HTMLCanvasElement;
  private fogCtx: CanvasRenderingContext2D;
  private fogImg: ImageData;
  private fogVersion = -1;
  /** Blurred 4px-per-tile fog for smooth edges when zoomed in. */
  private fogHi: HTMLCanvasElement;
  dpr = 1;
  private smokeTimers = new Map<number, number>();
  /** Stats for the debug overlay. */
  drawnUnits = 0;

  constructor(readonly canvas: HTMLCanvasElement, readonly world: ClientWorld) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.terrain = new TerrainRenderer(world.map);
    this.fogCanvas = document.createElement('canvas');
    this.fogCanvas.width = world.w;
    this.fogCanvas.height = world.h;
    this.fogCtx = this.fogCanvas.getContext('2d')!;
    this.fogImg = this.fogCtx.createImageData(world.w, world.h);
    this.fogHi = document.createElement('canvas');
    this.fogHi.width = world.w * 4;
    this.fogHi.height = world.h * 4;
  }

  resize(cssW: number, cssH: number, dpr: number) {
    this.dpr = dpr;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
  }

  private updateFog() {
    const w = this.world;
    if (w.fogVersion === this.fogVersion) return;
    this.fogVersion = w.fogVersion;
    const d = this.fogImg.data;
    for (let i = 0; i < w.visible.length; i++) {
      d[i * 4 + 3] = w.visible[i] ? 0 : w.explored[i] ? 125 : 255;
    }
    this.fogCtx.putImageData(this.fogImg, 0, 0);
    const hc = this.fogHi.getContext('2d')!;
    hc.clearRect(0, 0, this.fogHi.width, this.fogHi.height);
    hc.imageSmoothingEnabled = true;
    hc.filter = 'blur(3px)';
    hc.drawImage(this.fogCanvas, 0, 0, this.fogHi.width, this.fogHi.height);
    hc.filter = 'none';
  }

  draw(cam: Camera, fx: Effects, ov: Overlay, now: number) {
    const ctx = this.ctx, world = this.world;
    const z = cam.zoom * this.dpr;
    const shakeX = fx.shake ? (Math.random() - 0.5) * fx.shake : 0;
    const shakeY = fx.shake ? (Math.random() - 0.5) * fx.shake : 0;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(z, 0, 0, z, (-cam.x * cam.zoom + shakeX) * this.dpr, (-cam.y * cam.zoom + shakeY) * this.dpr);
    ctx.imageSmoothingEnabled = true;
    const x0 = cam.x, y0 = cam.y, x1 = cam.x + cam.viewW, y1 = cam.y + cam.viewH;
    this.terrain.draw(ctx, x0, y0, x1, y1);

    // Ore
    const tx0 = Math.max(0, Math.floor(x0 / TILE)), ty0 = Math.max(0, Math.floor(y0 / TILE));
    const tx1 = Math.min(world.w - 1, Math.floor(x1 / TILE)), ty1 = Math.min(world.h - 1, Math.floor(y1 / TILE));
    for (let ty = ty0; ty <= ty1; ty++)
      for (let tx = tx0; tx <= tx1; tx++) {
        const i = ty * world.w + tx;
        const amt = world.ore[i];
        if (amt <= 0 || !world.explored[i]) continue;
        const dens = Math.min(4, Math.floor(amt / 110));
        ctx.drawImage(oreSprite(Math.floor(hash2(tx, ty, 9) * 4), dens), tx * TILE, ty * TILE, TILE, TILE);
      }

    fx.drawGround(ctx);

    const inView = (x: number, y: number, m: number) => x > x0 - m && x < x1 + m && y > y0 - m && y < y1 + m;

    // Remembered structures under the fog.
    for (const g of world.ghosts) {
      const def = BUILDINGS[g.type];
      if (!def || !inView((g.tx + def.w / 2) * TILE, (g.ty + def.h / 2) * TILE, 140)) continue;
      const spr = buildingSprite(g.type, world.playerColor(g.owner), g.owner >= 0 ? world.playerFaction(g.owner) : null);
      ctx.globalAlpha = 0.85;
      ctx.drawImage(spr.canvas, g.tx * TILE - spr.ax, g.ty * TILE - spr.ay, spr.w, spr.h);
      ctx.globalAlpha = 1;
    }

    const buildings: ViewEntity[] = [];
    const units: ViewEntity[] = [];
    for (const e of world.ents.values()) {
      if (!inView(e.x, e.y, 120)) continue;
      (e.isBuilding ? buildings : units).push(e);
    }
    buildings.sort((a, b) => a.ty + a.h - (b.ty + b.h));
    for (const b of buildings) this.drawBuilding(b, fx, ov, now);

    // Selection rings under units
    for (const u of units) {
      if (!ov.selected.has(u.id) && ov.hoverId !== u.id) continue;
      const r = (u.def as UnitDef).radius;
      ctx.strokeStyle = u.owner === world.playerId ? (ov.selected.has(u.id) ? '#7dff7a' : 'rgba(125,255,122,0.5)') : 'rgba(255,90,80,0.9)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.ellipse(u.x, u.y + 2, r + 3, (r + 3) * 0.75, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    units.sort((a, b) => a.y - b.y);
    this.drawnUnits = units.length;
    for (const u of units) this.drawUnit(u, fx, now);

    fx.drawAir(ctx);

    // Fog of war (soft edges via bilinear upscaling of a 1px-per-tile mask).
    this.updateFog();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.fogHi, 0, 0, world.w * TILE, world.h * TILE);

    // Overlays above the fog
    for (const e of [...buildings, ...units]) {
      const sel = ov.selected.has(e.id);
      const own = e.owner === world.playerId;
      if (sel || ov.hoverId === e.id || (own && e.hp < e.maxHp && !e.isBuilding && cam.zoom > 0.7)) this.drawHealth(e, sel || ov.hoverId === e.id);
      if (sel && e.isBuilding) this.drawBrackets(e);
    }
    this.drawRallies(ov);
    this.drawMarkers(ov, now);
    if (ov.placement) this.drawPlacement(ov.placement);
    if (ov.pointer && (ov.attackMode || ov.sweepMode)) {
      const p = ov.pointer;
      ctx.strokeStyle = ov.sweepMode ? 'rgba(120,255,160,0.9)' : 'rgba(255,80,60,0.9)';
      ctx.lineWidth = 2 / cam.zoom;
      ctx.beginPath(); ctx.arc(p.x, p.y, ov.sweepMode ? 9 * TILE : 14 / cam.zoom, 0, Math.PI * 2); ctx.stroke();
    }

    // Screen-space drag box
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (ov.dragBox) {
      const b = ov.dragBox;
      ctx.strokeStyle = '#8dff8a';
      ctx.lineWidth = 1;
      ctx.fillStyle = 'rgba(120,255,120,0.08)';
      const x = Math.min(b.x0, b.x1), y = Math.min(b.y0, b.y1), w = Math.abs(b.x1 - b.x0), h = Math.abs(b.y1 - b.y0);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    }
  }

  private drawBuilding(b: ViewEntity, fx: Effects, ov: Overlay, now: number) {
    const ctx = this.ctx, world = this.world;
    const def = b.def as BuildingDef;
    const faction: FactionId | null = b.owner >= 0 ? world.playerFaction(b.owner) : null;
    const color = world.playerColor(b.owner);
    const spr = buildingSprite(b.type, color, faction);
    const px = b.tx * TILE, py = b.ty * TILE;
    const built = (b.extra & 127) / 100;
    const meta = BUILDING_META[b.type] ?? {};
    if (built < 1) {
      // Construction: reveal from the bottom up with scaffolding.
      const h = spr.h * built;
      ctx.drawImage(spr.canvas, 0, (spr.h - h) * SS, spr.w * SS, h * SS, px - spr.ax, py - spr.ay + spr.h - h, spr.w, h);
      ctx.strokeStyle = 'rgba(240,200,60,0.75)';
      ctx.lineWidth = 1;
      const top = py - spr.ay + spr.h - h;
      for (let x = px; x <= px + def.w * TILE; x += 8) { ctx.beginPath(); ctx.moveTo(x, py); ctx.lineTo(x, top); ctx.stroke(); }
      for (let y = top; y > py; y -= 8) { ctx.beginPath(); ctx.moveTo(px, y); ctx.lineTo(px + def.w * TILE, y); ctx.stroke(); }
      ctx.strokeRect(px + 0.5, py + 0.5, def.w * TILE - 1, def.h * TILE - 1);
      if (Math.random() < 0.15) fx.dustRing(b.x, py + def.h * TILE, 6);
      return;
    }
    ctx.drawImage(spr.canvas, px - spr.ax, py - spr.ay, spr.w, spr.h);
    const lowPower = (b.extra & X_LOWPOWER) !== 0 && def.power < 0;
    if (meta.dish) {
      const [dx, dy, r] = meta.dish;
      const a = lowPower ? 0.6 : now * 0.0015 + b.id;
      ctx.save();
      ctx.translate(px + dx, py + dy);
      ctx.rotate(a);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath(); ctx.ellipse(3, 4, r, r * 0.45, 0, 0, Math.PI * 2); ctx.fill();
      const g = ctx.createLinearGradient(0, -r, 0, r);
      g.addColorStop(0, '#e8ece8'); g.addColorStop(1, '#8a908a');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.45, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 0.8; ctx.stroke();
      ctx.strokeStyle = '#555'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(r * 0.9, 0); ctx.stroke();
      ctx.restore();
    }
    if (meta.gun) {
      ctx.save();
      ctx.translate(px + meta.gun.x, py + meta.gun.y);
      drawBuildingGun(ctx, meta.gun, color, faction ?? 'cdc', b.turret);
      ctx.restore();
    }
    if (meta.glow) {
      const [gx, gy, gr] = meta.glow;
      const fired = now - b.lastFire < 300;
      const pulse = lowPower ? 0.2 : 0.55 + Math.sin(now * 0.004 + b.id) * 0.25 + (fired ? 0.5 : 0);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(px + gx, py + gy, 1, px + gx, py + gy, gr * 2.2);
      g.addColorStop(0, `rgba(170,215,255,${Math.min(1, pulse)})`);
      g.addColorStop(1, 'rgba(60,120,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(px + gx - gr * 2.2, py + gy - gr * 2.2, gr * 4.4, gr * 4.4);
      ctx.restore();
    }
    if (meta.pump) {
      const [qx, qy] = meta.pump;
      const a = Math.sin(now * 0.002 + b.id) * 0.35;
      ctx.save();
      ctx.translate(px + qx, py + qy);
      ctx.rotate(a);
      ctx.fillStyle = '#2d2d2a'; ctx.fillRect(-14, -2, 28, 4);
      ctx.fillStyle = '#d8a62a'; ctx.fillRect(10, -4, 6, 8);
      ctx.restore();
    }
    if (meta.lights && Math.floor(now / 600 + b.id) % 2 === 0) {
      ctx.fillStyle = lowPower ? '#552' : '#ff4a3a';
      for (const [lx, ly] of meta.lights) { ctx.beginPath(); ctx.arc(px + lx, py + ly, 1.6, 0, Math.PI * 2); ctx.fill(); }
    }
    // Ambient smoke from chimneys.
    if (meta.smoke && !lowPower) {
      const t = this.smokeTimers.get(b.id) ?? 0;
      if (now > t) {
        this.smokeTimers.set(b.id, now + 350 + Math.random() * 300);
        const [sx, sy] = meta.smoke[Math.floor(Math.random() * meta.smoke.length)];
        fx.smokePuff(px + sx, py + sy);
      }
    }
    // Damage smoke & fire
    const hpf = b.hp / b.maxHp;
    if (hpf < 0.5 && Math.random() < (hpf < 0.25 ? 0.3 : 0.12)) {
      const rx = px + 6 + Math.random() * (def.w * TILE - 12), ry = py + 6 + Math.random() * (def.h * TILE - 18);
      fx.smokePuff(rx, ry, true);
      if (hpf < 0.25) fx.fireLick(rx, ry);
    }
    if (lowPower) {
      ctx.fillStyle = 'rgba(0,0,20,0.28)';
      ctx.fillRect(px, py, def.w * TILE, def.h * TILE);
    }
    if (b.extra & X_REPAIR) {
      const s = 1 + Math.sin(now * 0.008) * 0.12;
      ctx.save();
      ctx.translate(b.x, b.y - 8);
      ctx.scale(s, s);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#7dff7a'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(-4, 4); ctx.lineTo(4, -4); ctx.stroke();
      ctx.beginPath(); ctx.arc(4.5, -4.5, 2.5, 0, Math.PI * 1.5); ctx.stroke();
      ctx.restore();
    }
    void ov;
  }

  private drawUnit(u: ViewEntity, fx: Effects, now: number) {
    const ctx = this.ctx, world = this.world;
    const def = u.def as UnitDef;
    const faction = world.playerFaction(u.owner);
    const color = world.playerColor(u.owner);
    const moving = world.isMoving(u);
    let frame = 2;
    if (def.category === 'infantry') frame = moving ? Math.floor(u.travel / 5) % 2 : 2;
    else frame = Math.floor(u.travel / 3) % 2;
    const body = unitBodySprite(u.type, color, faction, frame);
    ctx.save();
    ctx.translate(u.x, u.y);
    ctx.rotate(u.angle);
    ctx.drawImage(body.canvas, -body.ax, -body.ay, body.w, body.h);
    ctx.restore();
    const tur = unitTurretSprite(u.type, color, faction);
    if (tur) {
      const recoil = now - u.lastFire < 120 ? -2 : 0;
      ctx.save();
      ctx.translate(u.x, u.y);
      ctx.rotate(u.turret);
      ctx.translate(recoil, 0);
      ctx.drawImage(tur.canvas, -tur.ax, -tur.ay, tur.w, tur.h);
      ctx.restore();
    }
    if (def.harvester) {
      const cargo = (u.extra & 127) / 100;
      if (cargo > 0.05) {
        ctx.save();
        ctx.translate(u.x, u.y);
        ctx.rotate(u.angle);
        ctx.fillStyle = '#e0a526';
        for (let i = 0; i < Math.ceil(cargo * 6); i++) ctx.fillRect(-12 + (i % 3) * 5, -5 + Math.floor(i / 3) * 5, 4, 4);
        ctx.restore();
      }
      if (u.extra & X_HARVESTING && Math.random() < 0.2) fx.dustRing(u.x + Math.cos(u.angle) * 18, u.y + Math.sin(u.angle) * 18, 2);
    }
    if (def.category === 'vehicle') {
      if (moving && Math.random() < 0.08) fx.smokePuff(u.x - Math.cos(u.angle) * def.radius, u.y - Math.sin(u.angle) * def.radius);
      if (u.hp / u.maxHp < 0.35 && Math.random() < 0.12) fx.smokePuff(u.x, u.y, true);
    }
  }

  private drawHealth(e: ViewEntity, full: boolean) {
    const ctx = this.ctx;
    const f = Math.max(0, e.hp / e.maxHp);
    let w: number, x: number, y: number;
    if (e.isBuilding) {
      w = e.w * TILE - 8; x = e.tx * TILE + 4; y = e.ty * TILE - 12;
    } else {
      const r = (e.def as UnitDef).radius;
      w = Math.max(16, r * 2.2); x = e.x - w / 2; y = e.y - r - 9;
    }
    const h = full ? 4 : 3;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = f > 0.6 ? '#4ee24a' : f > 0.3 ? '#f2d230' : '#f04a3a';
    ctx.fillRect(x, y, w * f, h);
    if (e.isBuilding && full) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      for (let i = 1; i < 10; i++) ctx.fillRect(x + (w * i) / 10, y, 1, h);
    }
    const def = e.def;
    if (def.kind === 'unit' && def.harvester && full) {
      ctx.fillStyle = '#e0a526';
      ctx.fillRect(x, y + h + 1, w * ((e.extra & 127) / 100), 2);
    }
  }

  private drawBrackets(e: ViewEntity) {
    const ctx = this.ctx;
    const x = e.tx * TILE - 2, y = e.ty * TILE - 2, w = e.w * TILE + 4, h = e.h * TILE + 4, l = 8;
    ctx.strokeStyle = e.owner === this.world.playerId ? '#c8ffc6' : '#ffb0a8';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x, y + l); ctx.lineTo(x, y); ctx.lineTo(x + l, y);
    ctx.moveTo(x + w - l, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + l);
    ctx.moveTo(x + w, y + h - l); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - l, y + h);
    ctx.moveTo(x + l, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - l);
    ctx.stroke();
  }

  private drawRallies(ov: Overlay) {
    const me = this.world.me;
    if (!me) return;
    const ctx = this.ctx;
    for (let i = 0; i < me.rallies.length; i += 3) {
      const id = me.rallies[i];
      if (!ov.selected.has(id)) continue;
      const b = this.world.ents.get(id);
      if (!b) continue;
      const rx = me.rallies[i + 1], ry = me.rallies[i + 2];
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = 'rgba(160,255,160,0.8)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(rx, ry); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#7dff7a';
      ctx.fillRect(rx - 1, ry - 16, 2, 16);
      ctx.beginPath(); ctx.moveTo(rx + 1, ry - 16); ctx.lineTo(rx + 11, ry - 12); ctx.lineTo(rx + 1, ry - 8); ctx.fill();
    }
  }

  private drawMarkers(ov: Overlay, now: number) {
    const ctx = this.ctx;
    for (const m of ov.markers) {
      const t = (now - m.t) / 500;
      if (t > 1) continue;
      const r = 14 * (1 - t) + 3;
      ctx.strokeStyle = m.kind === 'attack' ? `rgba(255,80,60,${1 - t})` : `rgba(120,255,120,${1 - t})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(m.x, m.y, r, r * 0.7, 0, 0, Math.PI * 2); ctx.stroke();
    }
  }

  private drawPlacement(p: NonNullable<Overlay['placement']>) {
    const ctx = this.ctx, world = this.world;
    const def = BUILDINGS[p.type];
    const spr = buildingSprite(p.type, world.playerColor(world.playerId), world.playerFaction(world.playerId));
    ctx.globalAlpha = 0.6;
    ctx.drawImage(spr.canvas, p.tx * TILE - spr.ax, p.ty * TILE - spr.ay, spr.w, spr.h);
    ctx.globalAlpha = 1;
    for (let j = 0; j < def.h; j++)
      for (let i = 0; i < def.w; i++) {
        const ok = p.tiles[j * def.w + i] === 1;
        ctx.fillStyle = ok ? 'rgba(80,255,90,0.32)' : 'rgba(255,60,50,0.45)';
        ctx.fillRect((p.tx + i) * TILE + 1, (p.ty + j) * TILE + 1, TILE - 2, TILE - 2);
      }
    // Weapon range preview for defenses
    const w = def.weapon ? WEAPONS[def.weapon] : null;
    if (w) {
      ctx.strokeStyle = 'rgba(255,220,120,0.5)';
      ctx.setLineDash([5, 6]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc((p.tx + def.w / 2) * TILE, (p.ty + def.h / 2) * TILE, w.range * TILE + (def.w * TILE) / 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}
