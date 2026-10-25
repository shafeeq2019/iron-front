import * as THREE from 'three';
import type { Effects } from '../render/effects';
import { withFog } from './materials';

const MAX_PTS = 2600;

const VERT = /* glsl */ `
  attribute float aSize;
  attribute vec4 aColor;
  uniform float uScale;
  varying vec4 vColor;
  void main() {
    vColor = aColor;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = max(1.0, aSize * uScale);
  }`;
const FRAG = /* glsl */ `
  varying vec4 vColor;
  uniform float uSoft;
  void main() {
    vec2 d = gl_PointCoord * 2.0 - 1.0;
    float r = dot(d, d);
    if (r > 1.0) discard;
    float a = pow(1.0 - r, uSoft);
    gl_FragColor = vec4(vColor.rgb, vColor.a * a);
  }`;

class PointLayer {
  readonly points: THREE.Points;
  private pos = new Float32Array(MAX_PTS * 3);
  private col = new Float32Array(MAX_PTS * 4);
  private size = new Float32Array(MAX_PTS);
  private geo = new THREE.BufferGeometry();
  readonly mat: THREE.ShaderMaterial;
  n = 0;
  constructor(additive: boolean, soft: number) {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { uScale: { value: 1 }, uSoft: { value: soft } },
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 20 : 10;
  }
  push(x: number, y: number, z: number, size: number, r: number, g: number, b: number, a: number) {
    if (this.n >= MAX_PTS) return;
    const i = this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b; this.col[i * 4 + 3] = a;
    this.size[i] = size;
  }
  flush() {
    this.geo.setDrawRange(0, this.n);
    for (const k of ['position', 'aColor', 'aSize']) {
      const at = this.geo.attributes[k] as THREE.BufferAttribute;
      at.needsUpdate = true;
      at.clearUpdateRanges();
      at.addUpdateRange(0, this.n * at.itemSize);
    }
    this.n = 0;
  }
}

function scorchTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, 'rgba(15,12,10,0.85)');
  g.addColorStop(0.6, 'rgba(25,20,15,0.45)');
  g.addColorStop(1, 'rgba(25,20,15,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Draws the shared Effects simulation in 3D. */
export class Effects3D {
  readonly group = new THREE.Group();
  private add = new PointLayer(true, 1.6);
  private norm = new PointLayer(false, 1.2);
  private lines: THREE.LineSegments;
  private linePos = new Float32Array(4000 * 3);
  private lineCol = new Float32Array(4000 * 3);
  private rings: THREE.InstancedMesh;
  private decals: THREE.InstancedMesh;
  private lights: THREE.PointLight[] = [];

  constructor(lightCount: number) {
    this.group.add(this.norm.points, this.add.points);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(this.linePos, 3).setUsage(THREE.DynamicDrawUsage));
    lg.setAttribute('color', new THREE.BufferAttribute(this.lineCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 21;
    this.group.add(this.lines);
    const ringGeo = new THREE.RingGeometry(0.86, 1, 40).rotateX(-Math.PI / 2);
    this.rings = new THREE.InstancedMesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), 128);
    this.rings.setColorAt(0, new THREE.Color());
    this.rings.frustumCulled = false;
    this.rings.renderOrder = 19;
    this.group.add(this.rings);
    const decalGeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    const decalMat = withFog(new THREE.MeshBasicMaterial({ map: scorchTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    this.decals = new THREE.InstancedMesh(decalGeo, decalMat, 256);
    this.decals.frustumCulled = false;
    this.decals.renderOrder = 2;
    this.group.add(this.decals);
    for (let i = 0; i < lightCount; i++) {
      const l = new THREE.PointLight(0xffa040, 0, 170, 1.6);
      this.lights.push(l);
      this.group.add(l);
    }
  }

  draw(fx: Effects, zoomPx: number, now: number) {
    const A = this.add, N = this.norm;
    A.mat.uniforms.uScale.value = zoomPx;
    N.mat.uniforms.uScale.value = zoomPx;
    for (const p of fx.particles) {
      const f = p.life / p.max;
      const s = p.size * 2;
      switch (p.kind) {
        case 'smoke': {
          const g = p.color === 'd' ? 0.16 : 0.34;
          N.push(p.x, p.z, p.y, s, g, g, g * 0.95, (1 - f) * (p.color === 'd' ? 0.62 : 0.42));
          break;
        }
        case 'dust':
          N.push(p.x, p.z, p.y, s, 0.55, 0.47, 0.36, (1 - f) * 0.45);
          break;
        case 'fire': {
          const g = 0.85 - f * 0.55;
          A.push(p.x, p.z, p.y, s, 1.6, g * 1.2, 0.25 * (1 - f), (1 - f) * 0.9);
          break;
        }
        case 'flash':
          A.push(p.x, p.z, p.y, s * 1.2, 2.2, 2.0, 1.4, 1 - f);
          break;
        case 'glow':
          A.push(p.x, p.z, p.y, s, 0.6, 1.0, 2.2, 1 - f);
          break;
        case 'spark':
          A.push(p.x, p.z + 1, p.y, 2.4, 2.2, 1.6, 0.6, 1 - f * 0.5);
          break;
        case 'debris':
          N.push(p.x, p.z + 1, p.y, p.size * 1.6, 0.12, 0.12, 0.1, 1 - f * 0.5);
          break;
      }
    }
    // Projectiles: bright cores along ballistic arcs.
    for (const pr of fx.projectiles) {
      const f = Math.min(1, pr.t / pr.dur);
      const x = pr.x0 + (pr.x1 - pr.x0) * f, y = pr.y0 + (pr.y1 - pr.y0) * f;
      const h = 9 + Math.sin(f * Math.PI) * pr.arc - f * 4;
      if (pr.kind === 'rocket') A.push(x, h, y, 9, 2.4, 1.3, 0.4, 1);
      else A.push(x, h, y, pr.arc ? 7 : 5, 2.2, 1.9, 1.2, 1);
    }
    // Lines: tracers and lightning.
    let ln = 0;
    const seg = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, r: number, g: number, b: number) => {
      if (ln >= 3998) return;
      const i = ln * 3;
      this.linePos.set([x0, y0, z0, x1, y1, z1], i);
      this.lineCol.set([r, g, b, r, g, b], i);
      ln += 2;
    };
    for (const t of fx.tracers) {
      const a = Math.min(1, t.life / 0.05);
      const k = 0.3;
      seg(t.x0 + (t.x1 - t.x0) * k, 9, t.y0 + (t.y1 - t.y0) * k, t.x1, 6, t.y1, 2 * a, 1.7 * a, 0.9 * a);
    }
    for (const b of fx.bolts) {
      const a = Math.min(1, b.life * 4);
      let px = b.pts[0], py = b.pts[1] + 10, ph = 52;
      for (let i = 2; i < b.pts.length; i += 2) {
        const x1 = b.pts[i], y1 = b.pts[i + 1];
        const steps = 7;
        for (let s = 1; s <= steps; s++) {
          const f = s / steps;
          const j = s === steps ? 0 : (Math.random() - 0.5) * 14;
          const nx = px + (x1 - px) * f + j, ny = py + (y1 - py) * f + j * 0.5, nh = ph + (8 - ph) * f + j * 0.6;
          const qx = px + (x1 - px) * ((s - 1) / steps), qy = py + (y1 - py) * ((s - 1) / steps), qh = ph + (8 - ph) * ((s - 1) / steps);
          seg(qx, qh, qy, nx, nh, ny, 1.2 * a, 1.8 * a, 3 * a);
          A.push(nx, nh, ny, 10, 0.4, 0.7, 1.6, a * 0.6);
        }
        px = x1; py = y1; ph = 8;
      }
    }
    this.lines.geometry.setDrawRange(0, ln);
    (this.lines.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.lines.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    A.flush();
    N.flush();

    // Shockwave rings & recon sweep pulses.
    const m = new THREE.Matrix4(), c = new THREE.Color();
    let rn = 0;
    for (const p of fx.particles) {
      if (p.kind !== 'ring' || rn >= 127) continue;
      const f = p.life / p.max;
      m.makeScale(p.size, 1, p.size).setPosition(p.x, 1.5, p.y);
      this.rings.setMatrixAt(rn, m);
      this.rings.setColorAt(rn, c.setRGB(1.6 * (1 - f), 1.2 * (1 - f), 0.7 * (1 - f)));
      rn++;
    }
    for (const p of fx.pulses) {
      if (rn >= 127) break;
      const r = p.t * 200, a = Math.max(0, 1 - p.t / 2);
      m.makeScale(r, 1, r).setPosition(p.x, 2, p.y);
      this.rings.setMatrixAt(rn, m);
      this.rings.setColorAt(rn, c.setRGB(0.3 * a, 1.4 * a, 0.6 * a));
      rn++;
    }
    this.rings.count = rn;
    this.rings.instanceMatrix.needsUpdate = true;
    if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true;

    // Scorch decals
    let dn = 0;
    for (const d of fx.decals) {
      if (dn >= 255) break;
      const fade = Math.min(1, (d.max - d.life) / 6);
      const r = d.r * (d.kind === 'rubble' ? 1.4 : 1.1) * (0.6 + 0.4 * fade);
      m.makeRotationY(d.rot).scale(new THREE.Vector3(r, 1, r)).setPosition(d.x, 0.35, d.y);
      this.decals.setMatrixAt(dn++, m);
    }
    this.decals.count = dn;
    this.decals.instanceMatrix.needsUpdate = true;

    // Explosion lights
    const ls = [...fx.lights].sort((a, b) => b.power * b.life - a.power * a.life);
    this.lights.forEach((l, i) => {
      const s = ls[i];
      if (!s) { l.intensity = 0; return; }
      l.position.set(s.x, s.z + 10, s.y);
      l.intensity = s.power * (s.life / 0.35) * 220 * (0.85 + Math.sin(now * 0.05 + i) * 0.15);
    });
  }
}
