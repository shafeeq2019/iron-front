import { DEFS, TILE, WEAPONS, type GameEvent } from '@iron/shared';
import { audio, type Sfx } from '../audio';
import type { ClientWorld } from '../world';

type PKind = 'smoke' | 'fire' | 'spark' | 'flash' | 'debris' | 'dust' | 'ring' | 'glow';

interface Particle {
  kind: PKind;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; max: number;
  size: number; grow: number;
  color: string;
}
interface ProjVis { x0: number; y0: number; x1: number; y1: number; t: number; dur: number; kind: string; arc: number; trail: boolean }
interface Bolt { pts: number[]; life: number }
interface Tracer { x0: number; y0: number; x1: number; y1: number; life: number; color: string }
interface Decal { x: number; y: number; r: number; life: number; max: number; kind: 'scorch' | 'crater' | 'rubble'; rot: number }
interface Emitter { x: number; y: number; life: number; rate: number; acc: number; kind: PKind }

function softSprite(inner: string, outer: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return c;
}

const WEAPON_SFX: Record<string, Sfx> = {
  rifle: 'rifle', pistol: 'pistol', mg: 'mg', autocannon: 'autocannon', rocket: 'rocket', cannon: 'cannon', turretgun: 'cannon',
  heavycannon: 'heavy', maulercannon: 'heavy', sentinelgun: 'heavy', howitzer: 'artillery', rocketpod: 'rocket', arc: 'arc',
};

export class Effects {
  particles: Particle[] = [];
  projectiles: ProjVis[] = [];
  bolts: Bolt[] = [];
  tracers: Tracer[] = [];
  decals: Decal[] = [];
  emitters: Emitter[] = [];
  maxParticles = 1400;
  private sprites: Record<string, HTMLCanvasElement>;
  /** Shake intensity in px, decays over time. */
  shake = 0;
  /** Sweep pulses (world coords) for radar ring animation. */
  pulses: { x: number; y: number; t: number }[] = [];
  /** Short-lived light flashes from explosions (used by the 3D renderer). */
  lights: { x: number; y: number; z: number; power: number; life: number }[] = [];

  constructor() {
    this.sprites = {
      smoke: softSprite('rgba(70,70,68,0.85)', 'rgba(70,70,68,0)'),
      dust: softSprite('rgba(150,130,100,0.7)', 'rgba(150,130,100,0)'),
      fire: softSprite('rgba(255,210,110,1)', 'rgba(255,90,20,0)'),
      flash: softSprite('rgba(255,255,230,1)', 'rgba(255,220,120,0)'),
      glow: softSprite('rgba(150,200,255,1)', 'rgba(80,140,255,0)'),
      scorch: softSprite('rgba(20,16,12,0.65)', 'rgba(20,16,12,0)'),
    };
  }

  setQuality(q: 'low' | 'high') {
    this.maxParticles = q === 'low' ? 450 : 1400;
  }

  private add(kind: PKind, x: number, y: number, o: Partial<Particle> = {}) {
    if (this.particles.length >= this.maxParticles) {
      if (kind === 'smoke' || kind === 'dust' || kind === 'spark') return;
      this.particles.shift();
    }
    this.particles.push({ kind, x, y, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 8, grow: 0, color: '', ...o });
  }

  muzzle(x: number, y: number, size: number, z = 9) {
    this.add('flash', x, y, { z, max: 0.07, size, grow: -size * 4 });
  }

  explosion(x: number, y: number, scale: number, scorch = true) {
    this.add('flash', x, y, { z: 8 * scale, max: 0.18, size: 26 * scale, grow: 40 * scale });
    this.lights.push({ x, y, z: 14 * scale, power: 1.6 * scale, life: 0.35 });
    for (let i = 0; i < 6 * scale + 2; i++) {
      const a = Math.random() * Math.PI * 2, s = (20 + Math.random() * 40) * scale;
      this.add('fire', x + Math.cos(a) * 4 * scale, y + Math.sin(a) * 4 * scale, { z: 3 + Math.random() * 8 * scale, vz: (15 + Math.random() * 30) * scale, vx: Math.cos(a) * s, vy: Math.sin(a) * s, max: 0.35 + Math.random() * 0.3, size: (8 + Math.random() * 8) * scale, grow: 10 * scale });
    }
    for (let i = 0; i < 5 * scale + 2; i++) {
      const a = Math.random() * Math.PI * 2, s = (8 + Math.random() * 20) * scale;
      this.add('smoke', x, y, { z: 4 * scale, vz: 18 + Math.random() * 22, vx: Math.cos(a) * s, vy: Math.sin(a) * s, max: 1.2 + Math.random() * 1.2, size: (10 + Math.random() * 8) * scale, grow: 14 * scale });
    }
    for (let i = 0; i < 8 * scale; i++) {
      const a = Math.random() * Math.PI * 2, s = 60 + Math.random() * 120 * scale;
      this.add('spark', x, y, { vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: 40 + Math.random() * 80, max: 0.3 + Math.random() * 0.4, size: 1.5, color: '#ffd27a' });
    }
    if (scale >= 1) {
      for (let i = 0; i < 4 * scale; i++) {
        const a = Math.random() * Math.PI * 2, s = 30 + Math.random() * 60;
        this.add('debris', x, y, { vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: 60 + Math.random() * 120, max: 0.8 + Math.random() * 0.6, size: 2 + Math.random() * 2.5, color: '#2a2a26' });
      }
      this.add('ring', x, y, { z: 1, max: 0.35, size: 6, grow: 140 * scale, color: 'rgba(255,230,180,' });
    }
    if (scorch) this.decals.push({ x, y, r: 14 * scale, life: 0, max: 40, kind: 'scorch', rot: Math.random() * 6 });
    if (this.decals.length > 220) this.decals.shift();
  }

  dustRing(x: number, y: number, r: number) {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      this.add('dust', x + Math.cos(a) * r, y + Math.sin(a) * r, { z: 2, vz: 6, vx: Math.cos(a) * 30, vy: Math.sin(a) * 30, max: 1.1, size: 12, grow: 16 });
    }
  }

  smokePuff(x: number, y: number, dark = false, z = 6) {
    this.add('smoke', x + (Math.random() - 0.5) * 6, y + (Math.random() - 0.5) * 4, { z, vz: 20 + Math.random() * 14, vx: 6 + Math.random() * 6, vy: -2, max: 1.6 + Math.random(), size: 6, grow: 14, color: dark ? 'd' : '' });
  }
  fireLick(x: number, y: number, z = 6) {
    this.add('fire', x + (Math.random() - 0.5) * 8, y + (Math.random() - 0.5) * 8, { z, vz: 22, max: 0.4 + Math.random() * 0.3, size: 7 + Math.random() * 5, grow: -4 });
  }

  /** Converts simulation events into visuals and sound. */
  handle(ev: GameEvent, world: ClientWorld, onScreen: (x: number, y: number) => boolean) {
    switch (ev.e) {
      case 'fire': {
        const w = WEAPONS[ev.w];
        if (!w) return;
        const shooter = world.ents.get(ev.id);
        if (shooter) shooter.lastFire = performance.now();
        const vis = onScreen(ev.x, ev.y) || onScreen(ev.tx, ev.ty);
        if (vis) audio.play(WEAPON_SFX[ev.w] ?? 'rifle', ev.x, ev.y, 0.8);
        if (!vis) return;
        const big = w.projectile === 'artillery' || w.damage > 60;
        this.muzzle(ev.x, ev.y, big ? 16 : w.projectile === 'bullet' ? 6 : 11);
        if (w.projectile === 'bullet') {
          const jx = (Math.random() - 0.5) * 6, jy = (Math.random() - 0.5) * 6;
          this.tracers.push({ x0: ev.x, y0: ev.y, x1: ev.tx + jx, y1: ev.ty + jy, life: 0.07, color: w.id === 'autocannon' ? '255,200,120' : '255,240,180' });
          for (let i = 0; i < 2; i++) this.add('spark', ev.tx + jx, ev.ty + jy, { vx: (Math.random() - 0.5) * 80, vy: (Math.random() - 0.5) * 80, vz: 30, max: 0.15, size: 1.2, color: '#ffe9a0' });
          if (w.id === 'autocannon') this.add('dust', ev.tx + jx, ev.ty + jy, { max: 0.4, size: 4, grow: 10 });
        } else {
          const dur = Math.max(0.05, ev.travel / 20);
          const arc = w.projectile === 'artillery' ? Math.min(140, Math.hypot(ev.tx - ev.x, ev.ty - ev.y) * 0.35) : 0;
          this.projectiles.push({ x0: ev.x, y0: ev.y, x1: ev.tx, y1: ev.ty, t: 0, dur, kind: w.projectile === 'artillery' && ev.w === 'rocketpod' ? 'rocket' : w.projectile, arc, trail: w.projectile === 'rocket' || ev.w === 'rocketpod' });
          if (big) this.shake = Math.min(6, this.shake + 0.6);
        }
        return;
      }
      case 'hit': {
        if (!onScreen(ev.x, ev.y)) return;
        const w = WEAPONS[ev.w];
        const scale = w ? (w.splash > 35 ? 1.4 : w.splash > 0 ? 1 : w.damage > 40 ? 0.6 : 0.45) : 0.5;
        this.explosion(ev.x, ev.y, scale, scale >= 1);
        audio.play(scale >= 1 ? 'explosion' : 'hitSmall', ev.x, ev.y, 0.7);
        if (scale >= 1) this.shake = Math.min(8, this.shake + 1.2);
        return;
      }
      case 'arc': {
        this.bolts.push({ pts: ev.pts, life: 0.28 });
        for (let i = 2; i < ev.pts.length; i += 2) {
          for (let k = 0; k < 6; k++) this.add('spark', ev.pts[i], ev.pts[i + 1], { vx: (Math.random() - 0.5) * 140, vy: (Math.random() - 0.5) * 140, vz: 40, max: 0.3, size: 1.5, color: '#bfe0ff' });
          this.add('glow', ev.pts[i], ev.pts[i + 1], { max: 0.3, size: 24, grow: 10 });
        }
        audio.play('arc', ev.pts[0], ev.pts[1]);
        return;
      }
      case 'death': {
        const def = DEFS[ev.type];
        if (!def) return;
        const vis = onScreen(ev.x, ev.y);
        if (def.kind === 'building') {
          const n = def.w * def.h;
          for (let i = 0; i < Math.min(6, n + 1); i++) {
            const ox = (Math.random() - 0.5) * def.w * TILE * 0.8, oy = (Math.random() - 0.5) * def.h * TILE * 0.8;
            setTimeout(() => this.explosion(ev.x + ox, ev.y + oy, 1.2 + Math.random() * 0.6), i * 140);
          }
          this.decals.push({ x: ev.x, y: ev.y, r: def.w * TILE * 0.6, life: 0, max: 120, kind: 'rubble', rot: Math.random() * 6 });
          this.emitters.push({ x: ev.x, y: ev.y, life: 6, rate: 10, acc: 0, kind: 'smoke' });
          if (vis) { audio.play('bigExplosion', ev.x, ev.y); this.shake = Math.min(12, this.shake + 5); }
        } else if (def.category === 'infantry') {
          this.add('dust', ev.x, ev.y, { max: 0.6, size: 6, grow: 12 });
          for (let i = 0; i < 3; i++) this.add('debris', ev.x, ev.y, { vx: (Math.random() - 0.5) * 50, vy: (Math.random() - 0.5) * 50, vz: 50, max: 0.5, size: 1.6, color: '#3b3f2e' });
          if (vis) audio.play('infantryDown', ev.x, ev.y, 0.6);
        } else {
          this.explosion(ev.x, ev.y, 1.5);
          this.emitters.push({ x: ev.x, y: ev.y, life: 4, rate: 8, acc: 0, kind: 'smoke' });
          this.decals.push({ x: ev.x, y: ev.y, r: 16, life: 0, max: 60, kind: 'crater', rot: Math.random() * 6 });
          if (vis) { audio.play('explosion', ev.x, ev.y); this.shake = Math.min(10, this.shake + 2.5); }
        }
        return;
      }
      case 'placed': {
        const def = DEFS[ev.type];
        if (def?.kind === 'building') this.dustRing(ev.x, ev.y, def.w * TILE * 0.5);
        if (onScreen(ev.x, ev.y)) audio.play('place', ev.x, ev.y);
        return;
      }
      case 'capture':
        this.add('ring', ev.x, ev.y, { max: 0.6, size: 10, grow: 160, color: 'rgba(120,220,255,' });
        return;
      case 'sweep':
        this.pulses.push({ x: ev.x, y: ev.y, t: 0 });
        audio.play('sweep');
        return;
    }
  }

  update(dt: number) {
    this.shake = Math.max(0, this.shake - dt * 18);
    for (const em of this.emitters) {
      em.life -= dt;
      em.acc += em.rate * dt;
      while (em.acc >= 1) { em.acc--; this.smokePuff(em.x + (Math.random() - 0.5) * 16, em.y, true); if (Math.random() < 0.3) this.fireLick(em.x, em.y); }
    }
    this.emitters = this.emitters.filter((e) => e.life > 0);
    const ps = this.particles;
    let w = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.life += dt;
      if (p.life >= p.max) continue;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.kind === 'spark' || p.kind === 'debris') {
        p.z += p.vz * dt; p.vz -= 260 * dt;
        if (p.z < 0) { p.z = 0; p.vz *= -0.3; p.vx *= 0.5; p.vy *= 0.5; }
      } else {
        p.vx *= 1 - dt * 1.5; p.vy *= 1 - dt * 1.5;
        p.z += p.vz * dt; p.vz *= 1 - dt * 0.7;
      }
      p.size = Math.max(0.5, p.size + p.grow * dt);
      ps[w++] = p;
    }
    ps.length = w;
    for (const pr of this.projectiles) {
      pr.t += dt;
      if (pr.trail) {
        const f = Math.min(1, pr.t / pr.dur);
        const x = pr.x0 + (pr.x1 - pr.x0) * f;
        this.add('smoke', x, pr.y0 + (pr.y1 - pr.y0) * f, { z: Math.sin(f * Math.PI) * pr.arc + 8, max: 0.6, size: 3, grow: 10, vz: 4 });
      }
    }
    this.projectiles = this.projectiles.filter((p) => p.t < p.dur);
    for (const b of this.bolts) b.life -= dt;
    this.bolts = this.bolts.filter((b) => b.life > 0);
    for (const t of this.tracers) t.life -= dt;
    this.tracers = this.tracers.filter((t) => t.life > 0);
    for (const d of this.decals) d.life += dt;
    this.decals = this.decals.filter((d) => d.life < d.max);
    for (const p of this.pulses) p.t += dt;
    for (const l of this.lights) l.life -= dt;
    this.lights = this.lights.filter((l) => l.life > 0);
    this.pulses = this.pulses.filter((p) => p.t < 2);
  }

  drawGround(ctx: CanvasRenderingContext2D) {
    for (const d of this.decals) {
      const a = Math.min(1, (d.max - d.life) / 6);
      ctx.globalAlpha = a * (d.kind === 'rubble' ? 0.9 : 0.75);
      const r = d.r * (d.kind === 'rubble' ? 1.3 : 1);
      ctx.drawImage(this.sprites.scorch, d.x - r, d.y - r, r * 2, r * 2);
      if (d.kind === 'rubble') {
        ctx.fillStyle = '#4a463e';
        for (let i = 0; i < 9; i++) {
          const ang = d.rot + i * 2.1, rr = (i % 3 + 1) * d.r * 0.25;
          ctx.fillRect(d.x + Math.cos(ang) * rr - 2, d.y + Math.sin(ang) * rr - 2, 3 + (i % 3), 3 + (i % 2));
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  drawAir(ctx: CanvasRenderingContext2D) {
    // Projectiles
    for (const p of this.projectiles) {
      const f = Math.min(1, p.t / p.dur);
      const x = p.x0 + (p.x1 - p.x0) * f, y = p.y0 + (p.y1 - p.y0) * f;
      const h = Math.sin(f * Math.PI) * p.arc;
      if (p.arc > 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath(); ctx.ellipse(x, y, 3, 2, 0, 0, Math.PI * 2); ctx.fill();
      }
      const ang = Math.atan2(p.y1 - p.y0 - (p.arc ? Math.cos(f * Math.PI) * p.arc * Math.PI : 0), p.x1 - p.x0);
      ctx.save();
      ctx.translate(x, y - h);
      ctx.rotate(ang);
      if (p.kind === 'rocket') {
        ctx.fillStyle = '#ddd'; ctx.fillRect(-4, -1.2, 7, 2.4);
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(this.sprites.fire, -12, -5, 10, 10);
      } else {
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(this.sprites.flash, -6, -3, 12, 6);
        ctx.fillStyle = 'rgba(255,230,150,0.5)'; ctx.fillRect(-14, -0.8, 12, 1.6);
      }
      ctx.restore();
    }
    // Tracers
    ctx.lineCap = 'round';
    for (const t of this.tracers) {
      ctx.strokeStyle = `rgba(${t.color},${Math.min(1, t.life / 0.05)})`;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      const k = 0.35;
      ctx.moveTo(t.x0 + (t.x1 - t.x0) * k, t.y0 + (t.y1 - t.y0) * k);
      ctx.lineTo(t.x1, t.y1);
      ctx.stroke();
    }
    // Lightning
    for (const b of this.bolts) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let pass = 0; pass < 2; pass++) {
        ctx.strokeStyle = pass === 0 ? `rgba(90,150,255,${b.life * 2})` : `rgba(230,245,255,${b.life * 3.5})`;
        ctx.lineWidth = pass === 0 ? 5 : 1.6;
        ctx.beginPath();
        ctx.moveTo(b.pts[0], b.pts[1]);
        for (let i = 2; i < b.pts.length; i += 2) {
          const x0 = b.pts[i - 2], y0 = b.pts[i - 1], x1 = b.pts[i], y1 = b.pts[i + 1];
          const segs = 6;
          for (let s = 1; s <= segs; s++) {
            const f = s / segs;
            const j = s === segs ? 0 : (Math.random() - 0.5) * 16;
            ctx.lineTo(x0 + (x1 - x0) * f + j, y0 + (y1 - y0) * f + j);
          }
        }
        ctx.stroke();
      }
      ctx.restore();
    }
    // Particles
    for (const p of this.particles) {
      const f = p.life / p.max;
      switch (p.kind) {
        case 'smoke':
        case 'dust': {
          ctx.globalAlpha = (1 - f) * (p.kind === 'dust' ? 0.55 : p.color === 'd' ? 0.6 : 0.45);
          const spr = this.sprites[p.kind];
          ctx.drawImage(spr, p.x - p.size, p.y - p.z * 0.6 - p.size, p.size * 2, p.size * 2);
          break;
        }
        case 'fire':
        case 'flash':
        case 'glow': {
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 1 - f;
          ctx.drawImage(this.sprites[p.kind], p.x - p.size, p.y - p.z * 0.6 - p.size, p.size * 2, p.size * 2);
          ctx.globalCompositeOperation = 'source-over';
          break;
        }
        case 'spark':
        case 'debris':
          ctx.globalAlpha = 1 - f * 0.6;
          ctx.fillStyle = p.color;
          ctx.fillRect(p.x - p.size / 2, p.y - p.z - p.size / 2, p.size, p.size);
          break;
        case 'ring':
          ctx.globalAlpha = 1;
          ctx.strokeStyle = `${p.color}${(1 - f) * 0.6})`;
          ctx.lineWidth = 3 * (1 - f) + 0.5;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.stroke();
          break;
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    // Recon sweep pulses
    for (const p of this.pulses) {
      const r = p.t * 200;
      ctx.strokeStyle = `rgba(120,255,160,${Math.max(0, 1 - p.t / 2) * 0.8})`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
    }
  }
}
