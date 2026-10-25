import { BUILDINGS, TILE, WEAPONS, type UnitDef } from '@iron/shared';
import type { Camera } from '../camera';
import type { Overlay } from '../render/renderer';
import type { ClientWorld, ViewEntity } from '../world';

/** Screen-space HUD layer drawn over the 3D view: health bars, rally lines, markers, drag box. */
export class OverlayLayer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;

  constructor(after: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'game-overlay';
    Object.assign(this.canvas.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    after.parentElement?.insertBefore(this.canvas, after.nextSibling);
    this.ctx = this.canvas.getContext('2d')!;
  }

  resize(w: number, h: number, dpr: number) {
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  draw(world: ClientWorld, cam: Camera, ov: Overlay, heightOf: (e: ViewEntity) => number, now: number) {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const z = cam.zoom;
    const onScreen = (p: { x: number; y: number }) => p.x > -60 && p.y > -60 && p.x < cam.vw + 60 && p.y < cam.vh + 60;

    // Health bars
    for (const e of world.ents.values()) {
      const sel = ov.selected.has(e.id), hov = ov.hoverId === e.id;
      const own = e.owner === world.playerId;
      if (!sel && !hov && !(own && e.hp < e.maxHp && !e.isBuilding && z > 0.8)) continue;
      const p = cam.worldToScreen(e.x, e.y, heightOf(e) + (e.isBuilding ? 10 : 6));
      if (!onScreen(p)) continue;
      const f = Math.max(0, e.hp / e.maxHp);
      const w = e.isBuilding ? e.w * TILE * z * 0.7 : Math.max(18, (e.def as UnitDef).radius * 2.3 * z);
      const h = sel || hov ? 5 : 3.5;
      const x = p.x - w / 2, y = p.y - h;
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
      ctx.fillStyle = f > 0.6 ? '#4ee24a' : f > 0.3 ? '#f2d230' : '#f04a3a';
      ctx.fillRect(x, y, w * f, h);
      if (e.isBuilding && (sel || hov)) {
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        for (let i = 1; i < 10; i++) ctx.fillRect(x + (w * i) / 10, y, 1, h);
      }
      const def = e.def;
      if (def.kind === 'unit' && def.harvester && (sel || hov)) {
        ctx.fillStyle = '#e0a526';
        ctx.fillRect(x, y + h + 1, w * ((e.extra & 127) / 100), 2.5);
      }
      if (e.isBuilding && e.extra & 128) {
        const s = 1 + Math.sin(now * 0.008) * 0.12;
        ctx.save();
        ctx.translate(p.x, y - 14);
        ctx.scale(s, s);
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#7dff7a'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(-4, 4); ctx.lineTo(4, -4); ctx.stroke();
        ctx.beginPath(); ctx.arc(4.5, -4.5, 2.5, 0, Math.PI * 1.5); ctx.stroke();
        ctx.restore();
      }
    }

    // Rally points of selected production buildings
    const me = world.me;
    if (me) {
      for (let i = 0; i < me.rallies.length; i += 3) {
        if (!ov.selected.has(me.rallies[i])) continue;
        const b = world.ents.get(me.rallies[i]);
        if (!b) continue;
        const a = cam.worldToScreen(b.x, b.y), r = cam.worldToScreen(me.rallies[i + 1], me.rallies[i + 2]);
        ctx.setLineDash([6, 5]);
        ctx.strokeStyle = 'rgba(160,255,160,0.85)';
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(r.x, r.y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#7dff7a';
        ctx.fillRect(r.x - 1, r.y - 18, 2, 18);
        ctx.beginPath(); ctx.moveTo(r.x + 1, r.y - 18); ctx.lineTo(r.x + 12, r.y - 14); ctx.lineTo(r.x + 1, r.y - 10); ctx.fill();
      }
    }

    // Command markers (ground ellipses)
    for (const m of ov.markers) {
      const t = (now - m.t) / 500;
      if (t > 1) continue;
      const p = cam.worldToScreen(m.x, m.y);
      const r = (14 * (1 - t) + 4) * z;
      ctx.strokeStyle = m.kind === 'attack' ? `rgba(255,80,60,${1 - t})` : `rgba(120,255,120,${1 - t})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, r, r * cam.tilt, 0, 0, Math.PI * 2); ctx.stroke();
    }

    // Defense range preview while placing
    if (ov.placement) {
      const def = BUILDINGS[ov.placement.type];
      const w = def.weapon ? WEAPONS[def.weapon] : null;
      if (w) {
        const c = cam.worldToScreen((ov.placement.tx + def.w / 2) * TILE, (ov.placement.ty + def.h / 2) * TILE);
        const r = (w.range * TILE + (def.w * TILE) / 2) * z;
        ctx.strokeStyle = 'rgba(255,220,120,0.6)';
        ctx.setLineDash([6, 6]);
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.ellipse(c.x, c.y, r, r * cam.tilt, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    if (ov.pointer && (ov.attackMode || ov.sweepMode)) {
      const p = cam.worldToScreen(ov.pointer.x, ov.pointer.y);
      const r = ov.sweepMode ? 9 * TILE * z : 14;
      ctx.strokeStyle = ov.sweepMode ? 'rgba(120,255,160,0.9)' : 'rgba(255,80,60,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, r, r * cam.tilt, 0, 0, Math.PI * 2); ctx.stroke();
    }

    if (ov.dragBox) {
      const b = ov.dragBox;
      const x = Math.min(b.x0, b.x1), y = Math.min(b.y0, b.y1), w = Math.abs(b.x1 - b.x0), h = Math.abs(b.y1 - b.y0);
      ctx.fillStyle = 'rgba(120,255,120,0.08)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#8dff8a';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    }
  }

  dispose() {
    this.canvas.remove();
  }
}
