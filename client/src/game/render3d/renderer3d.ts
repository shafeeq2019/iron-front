import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { BUILDINGS, TILE, X_HARVESTING, X_LOWPOWER, type BuildingDef, type FactionId, type UnitDef } from '@iron/shared';
import { CAMERA_PITCH, type Camera } from '../camera';
import type { Effects } from '../render/effects';
import type { Overlay } from '../render/renderer';
import { getSettings } from '../settings';
import type { ClientWorld, ViewEntity } from '../world';
import { Effects3D } from './effects3d';
import { Entities3D, makeState } from './entities3d';
import { fogUniforms, materials } from './materials';
import { getModel, type ModelDef } from './models';
import { OverlayLayer } from './overlay';
import { Terrain3D } from './terrain3d';

const SUN_OFFSET = new THREE.Vector3(-520, 900, -380);

/** Team colour toned toward military paint, per faction. */
function teamColor(hex: string, faction: FactionId | null): THREE.Color {
  const c = new THREE.Color(hex);
  if (!faction) return new THREE.Color(0x9a978e);
  return c.lerp(new THREE.Color(faction === 'cdc' ? 0x9aa4ad : 0x6e6050), faction === 'cdc' ? 0.22 : 0.28);
}

/**
 * WebGL battlefield renderer (Three.js): lit, shadowed 3D terrain and models,
 * fog-of-war shading, particle effects and bloom, plus a 2D overlay for UI.
 */
export class Renderer3D {
  readonly gl: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly cam3: THREE.OrthographicCamera;
  readonly terrain: { minimapImage(): HTMLCanvasElement };
  private t3: Terrain3D;
  private entities: Entities3D;
  private fx3: Effects3D;
  private overlay: OverlayLayer;
  private sun: THREE.DirectionalLight;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private fogTex: THREE.DataTexture;
  private fogData: Uint8Array;
  private fogBase: Float32Array;
  private fogVersion = -1;
  private FOG_RES = 4;
  private rings: THREE.InstancedMesh;
  private frames: THREE.InstancedMesh;
  private ghost: { type: string; group: THREE.Group; ok: boolean; tiles: THREE.InstancedMesh } | null = null;
  private smokeTimers = new Map<number, number>();
  private state = makeState();
  private colorCache = new Map<string, THREE.Color>();
  private quality: 'low' | 'high';
  private start = performance.now();
  private w = 1;
  private h = 1;
  private dpr = 1;
  drawnUnits = 0;
  /** Resolves once all shader programs are compiled and the first frame can be drawn without stalls. */
  readonly ready: Promise<void>;
  private isReady = false;

  constructor(readonly canvas: HTMLCanvasElement, readonly world: ClientWorld) {
    this.quality = getSettings().quality;
    const high = this.quality === 'high';
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: high, powerPreference: 'high-performance', alpha: false });
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 0.92;
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFShadowMap;
    this.scene.background = new THREE.Color(0x020302);


    this.cam3 = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 6000);
    const hemi = new THREE.HemisphereLight(0xc4d6ff, 0x3a3428, 0.75);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0xffe6c4, 3.4);
    this.sun.castShadow = true;
    const sm = high ? 2048 : 1024;
    this.sun.shadow.mapSize.set(sm, sm);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.radius = high ? 2.5 : 1;
    this.sun.shadow.normalBias = 0.6;
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 3000;
    this.scene.add(this.sun, this.sun.target);

    // Fog-of-war texture (upsampled and blurred for soft edges).
    const fw = world.w * this.FOG_RES, fh = world.h * this.FOG_RES;
    this.fogData = new Uint8Array(fw * fh);
    this.fogBase = new Float32Array(world.w * world.h);
    this.fogTex = new THREE.DataTexture(this.fogData, fw, fh, THREE.RedFormat, THREE.UnsignedByteType);
    this.fogTex.magFilter = THREE.LinearFilter;
    this.fogTex.minFilter = THREE.LinearFilter;
    this.fogTex.unpackAlignment = 1;
    this.fogTex.needsUpdate = true;
    fogUniforms.fogTex.value = this.fogTex;
    fogUniforms.fogSize.value.set(world.w * TILE, world.h * TILE);

    this.t3 = new Terrain3D(world.map, this.quality);
    this.terrain = this.t3.painter;
    this.scene.add(this.t3.group);
    this.entities = new Entities3D(true);
    this.scene.add(this.entities.group);
    this.fx3 = new Effects3D(high ? 4 : 2);
    this.scene.add(this.fx3.group);

    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false });
    this.rings = new THREE.InstancedMesh(new THREE.RingGeometry(0.82, 1, 36).rotateX(-Math.PI / 2), ringMat, 512);
    this.rings.setColorAt(0, new THREE.Color());
    this.rings.frustumCulled = false;
    this.rings.renderOrder = 5;
    const sq = new THREE.Shape();
    sq.moveTo(-1, -1); sq.lineTo(1, -1); sq.lineTo(1, 1); sq.lineTo(-1, 1); sq.closePath();
    const hole = new THREE.Path();
    hole.moveTo(-0.94, -0.94); hole.lineTo(-0.94, 0.94); hole.lineTo(0.94, 0.94); hole.lineTo(0.94, -0.94); hole.closePath();
    sq.holes.push(hole);
    this.frames = new THREE.InstancedMesh(new THREE.ShapeGeometry(sq).rotateX(-Math.PI / 2), ringMat, 64);
    this.frames.setColorAt(0, new THREE.Color());
    this.frames.frustumCulled = false;
    this.frames.renderOrder = 5;
    this.scene.add(this.rings, this.frames);

    this.overlay = new OverlayLayer(canvas);
    if (high) {
      this.composer = new EffectComposer(this.gl);
      this.composer.addPass(new RenderPass(this.scene, this.cam3));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.4, 1.0);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }
    materials();
    this.ready = new Promise((resolve) => {
      // Let the loading screen paint before the heavy work starts.
      setTimeout(async () => {
        const pmrem = new THREE.PMREMGenerator(this.gl);
        this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        this.scene.environmentIntensity = 0.22;
        pmrem.dispose();
        // Paint every ground texture now (behind the loading screen) so play starts without stutter.
        this.t3.paint(Infinity, 0, 0, this.gl.capabilities.getMaxAnisotropy());
        this.prewarm();
        try {
          await this.gl.compileAsync(this.scene, this.cam3);
          // Also render once off-screen so shadow-depth programs are built.
          this.gl.render(this.scene, this.cam3);
        } catch (e) {
          console.warn('shader precompile failed', e);
        }
        this.entities.begin();
        this.entities.end();
        this.isReady = true;
        resolve();
      }, 60);
    });
  }

  /** Instantiates every model once (far below the map) so all material variants get compiled up front. */
  private prewarm() {
    const types = ['rifle', 'rocket', 'engineer', 'scout', 'lighttank', 'raider', 'heavytank', 'mauler', 'artillery', 'hailstorm', 'harvester', 'mcv',
      'hq', 'power', 'refinery', 'barracks', 'factory', 'radar', 'tech', 'pillbox', 'turret', 'sentinel', 'arcpylon', 'derrick'];
    const s = makeState();
    s.x = -5000; s.y = -5000; s.h = -5000;
    this.entities.begin();
    for (const t of types) for (const f of ['cdc', 'esd'] as FactionId[]) this.entities.add(getModel(t, f), s);
    this.entities.end();
  }

  resize(cssW: number, cssH: number, dpr: number) {
    this.w = cssW; this.h = cssH; this.dpr = dpr;
    this.gl.setPixelRatio(dpr);
    this.gl.setSize(cssW, cssH, false);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.composer?.setPixelRatio(dpr);
    this.composer?.setSize(cssW, cssH);
    this.bloom?.resolution.set(cssW / 2, cssH / 2);
    this.overlay.resize(cssW, cssH, dpr);
  }

  private color(owner: number): THREE.Color {
    const hex = this.world.playerColor(owner);
    const fac = owner >= 0 ? this.world.playerFaction(owner) : null;
    const k = `${hex}|${fac}`;
    let c = this.colorCache.get(k);
    if (!c) { c = teamColor(hex, fac); this.colorCache.set(k, c); }
    return c;
  }

  private modelFor(e: { type: string; owner: number }): ModelDef {
    return getModel(e.type, e.owner >= 0 ? this.world.playerFaction(e.owner) : null);
  }

  heightOf = (e: ViewEntity) => this.modelFor(e).height * (e.isBuilding ? Math.max(0.2, (e.extra & 127) / 100) : 1);

  private updateFog() {
    const w = this.world;
    if (w.fogVersion === this.fogVersion) return;
    this.fogVersion = w.fogVersion;
    const W = w.w, H = w.h, R = this.FOG_RES;
    const base = this.fogBase;
    for (let i = 0; i < base.length; i++) base[i] = w.visible[i] ? 255 : w.explored[i] ? 100 : 0;
    const fw = W * R, fh = H * R, out = this.fogData;
    // Bilinear upsample from tile centres.
    for (let y = 0; y < fh; y++) {
      const gy = (y + 0.5) / R - 0.5, y0 = Math.max(0, Math.floor(gy)), y1 = Math.min(H - 1, y0 + 1), v = Math.min(1, Math.max(0, gy - y0));
      for (let x = 0; x < fw; x++) {
        const gx = (x + 0.5) / R - 0.5, x0 = Math.max(0, Math.floor(gx)), x1 = Math.min(W - 1, x0 + 1), u = Math.min(1, Math.max(0, gx - x0));
        const a = base[y0 * W + x0], b = base[y0 * W + x1], c = base[y1 * W + x0], d = base[y1 * W + x1];
        out[y * fw + x] = a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
      }
    }
    this.fogTex.needsUpdate = true;
  }

  private syncCamera(cam: Camera, shake: number) {
    cam.setPitch(CAMERA_PITCH);
    const z = cam.zoom;
    const gx = cam.x + cam.vw / (2 * z), gz = cam.y + cam.vh / (2 * z * cam.tilt);
    const c = this.cam3;
    c.left = -cam.vw / (2 * z); c.right = cam.vw / (2 * z);
    c.top = cam.vh / (2 * z); c.bottom = -cam.vh / (2 * z);
    c.updateProjectionMatrix();
    const D = 2000;
    const sx = shake ? (Math.random() - 0.5) * shake / z : 0, sy = shake ? (Math.random() - 0.5) * shake / z : 0;
    c.position.set(gx + sx, D * Math.sin(CAMERA_PITCH), gz + D * Math.cos(CAMERA_PITCH) + sy);
    c.lookAt(gx + sx, 0, gz + sy);
    // Shadow frustum follows the view.
    const size = Math.max(cam.viewW, cam.viewH) * 0.62 + 160;
    const sc = this.sun.shadow.camera;
    sc.left = -size; sc.right = size; sc.top = size; sc.bottom = -size;
    sc.updateProjectionMatrix();
    this.sun.target.position.set(gx, 0, gz);
    this.sun.position.set(gx + SUN_OFFSET.x, SUN_OFFSET.y, gz + SUN_OFFSET.z);
    return { gx, gz };
  }

  draw(cam: Camera, fx: Effects, ov: Overlay, now: number) {
    if (!this.isReady) return;
    const t = (now - this.start) / 1000;
    const { gx, gz } = this.syncCamera(cam, fx.shake);
    this.updateFog();
    this.t3.paint(1, gx, gz, this.gl.capabilities.getMaxAnisotropy());
    this.t3.updateOre(this.world.ore, this.world.oreVersion);
    this.t3.animate(t);

    const world = this.world;
    const x0 = cam.x - 200, x1 = cam.x + cam.viewW + 200, y0 = cam.y - 200, y1 = cam.y + cam.viewH + 260;
    const inView = (x: number, y: number) => x > x0 && x < x1 && y > y0 && y < y1;
    const ents = this.entities;
    ents.begin();
    const s = this.state;
    let units = 0, rn = 0, fn = 0;
    const m4 = new THREE.Matrix4();
    const green = new THREE.Color(0.35, 1.6, 0.4), red = new THREE.Color(1.8, 0.35, 0.25), dim = new THREE.Color(0.2, 0.8, 0.25);

    // Remembered enemy structures (fogged by the shader).
    for (const g of world.ghosts) {
      const def = BUILDINGS[g.type];
      if (!def) continue;
      const cx = (g.tx + def.w / 2) * TILE, cy = (g.ty + def.h / 2) * TILE;
      if (!inView(cx, cy)) continue;
      Object.assign(s, { x: cx, y: cy, h: 0, angle: 0, turret: Math.PI / 2, built: 1, recoil: 0, swing: 0, bob: 0, t: 0, pulse: 1, cargo: 0 });
      s.color.copy(this.color(g.owner));
      ents.add(this.modelFor(g), s);
    }

    for (const e of world.ents.values()) {
      if (!inView(e.x, e.y)) continue;
      const model = this.modelFor(e);
      s.x = e.x; s.y = e.y; s.h = 0; s.bob = 0; s.swing = 0; s.cargo = 0; s.pulse = 1;
      s.color.copy(this.color(e.owner));
      s.recoil = now - e.lastFire < 140 ? 2.2 * (1 - (now - e.lastFire) / 140) : 0;
      if (e.isBuilding) {
        const def = e.def as BuildingDef;
        const built = (e.extra & 127) / 100;
        const low = (e.extra & X_LOWPOWER) !== 0 && def.power < 0;
        s.angle = 0;
        s.turret = e.turret;
        s.built = built;
        s.t = low ? 0 : t + e.id;
        s.pulse = low ? 0.6 : 1 + Math.sin(t * 4 + e.id) * 0.1 + (now - e.lastFire < 300 ? 0.45 : 0);
        ents.add(model, s);
        this.buildingFx(e, model, fx, now, built, low);
        if (ov.selected.has(e.id) && fn < 63) {
          m4.makeScale(def.w * TILE * 0.55, 1, def.h * TILE * 0.55).setPosition(e.x, 1.2, e.y);
          this.frames.setMatrixAt(fn, m4);
          this.frames.setColorAt(fn++, e.owner === world.playerId ? green : red);
        }
      } else {
        const def = e.def as UnitDef;
        units++;
        s.angle = e.angle;
        s.turret = def.hasTurret ? e.turret : e.angle;
        s.built = 1;
        s.t = t;
        const moving = world.isMoving(e);
        if (def.category === 'infantry') {
          const ph = e.travel * 0.3;
          s.swing = moving ? Math.sin(ph) * 0.65 : 0;
          s.bob = moving ? Math.abs(Math.cos(ph)) * 0.6 : 0;
        }
        if (def.harvester) s.cargo = (e.extra & 127) / 100;
        ents.add(model, s);
        this.unitFx(e, def, fx, moving);
        if ((ov.selected.has(e.id) || ov.hoverId === e.id) && rn < 511) {
          const r = def.radius + 4;
          m4.makeScale(r, 1, r).setPosition(e.x, 0.8, e.y);
          this.rings.setMatrixAt(rn, m4);
          this.rings.setColorAt(rn++, e.owner === world.playerId ? (ov.selected.has(e.id) ? green : dim) : red);
        }
      }
    }
    ents.end();
    this.drawnUnits = units;
    this.rings.count = rn;
    this.frames.count = fn;
    for (const im of [this.rings, this.frames]) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
    this.updateGhost(ov);

    this.fx3.draw(fx, cam.zoom * this.dpr, now);
    if (this.composer) this.composer.render();
    else this.gl.render(this.scene, this.cam3);
    this.overlay.draw(world, cam, ov, this.heightOf, now);
  }

  private buildingFx(e: ViewEntity, model: ModelDef, fx: Effects, now: number, built: number, low: boolean) {
    const def = e.def as BuildingDef;
    if (built < 1) {
      if (Math.random() < 0.12) fx.dustRing(e.x + (Math.random() - 0.5) * def.w * TILE, e.y + def.h * TILE * 0.45, 4);
      return;
    }
    if (model.smoke?.length && !low) {
      const next = this.smokeTimers.get(e.id) ?? 0;
      if (now > next) {
        this.smokeTimers.set(e.id, now + 300 + Math.random() * 300);
        const p = model.smoke[Math.floor(Math.random() * model.smoke.length)];
        fx.smokePuff(e.x + p.x, e.y + p.z, false, p.y);
      }
    }
    const hpf = e.hp / e.maxHp;
    if (hpf < 0.5 && Math.random() < (hpf < 0.25 ? 0.3 : 0.12)) {
      const rx = e.x + (Math.random() - 0.5) * def.w * TILE * 0.7, ry = e.y + (Math.random() - 0.5) * def.h * TILE * 0.7;
      fx.smokePuff(rx, ry, true, model.height * 0.6);
      if (hpf < 0.25) fx.fireLick(rx, ry, model.height * 0.5);
    }
  }

  private unitFx(e: ViewEntity, def: UnitDef, fx: Effects, moving: boolean) {
    if (def.category !== 'vehicle') return;
    if (moving && Math.random() < 0.1) fx.smokePuff(e.x - Math.cos(e.angle) * def.radius, e.y - Math.sin(e.angle) * def.radius, false, 5);
    if (e.hp / e.maxHp < 0.35 && Math.random() < 0.12) fx.smokePuff(e.x, e.y, true, 10);
    if (def.harvester && e.extra & X_HARVESTING && Math.random() < 0.25) fx.dustRing(e.x + Math.cos(e.angle) * 20, e.y + Math.sin(e.angle) * 20, 2);
  }

  /** Translucent preview of the structure being placed plus per-tile validity. */
  private updateGhost(ov: Overlay) {
    const p = ov.placement;
    if (!p) {
      if (this.ghost) { this.scene.remove(this.ghost.group, this.ghost.tiles); this.ghost = null; }
      return;
    }
    const def = BUILDINGS[p.type];
    const ok = p.tiles.every((v) => v === 1);
    if (!this.ghost || this.ghost.type !== p.type || this.ghost.ok !== ok) {
      if (this.ghost) this.scene.remove(this.ghost.group, this.ghost.tiles);
      const group = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: ok ? 0x9dffb0 : 0xff8070, transparent: true, opacity: 0.55, depthWrite: false, emissive: ok ? 0x1a5a22 : 0x5a1a12 });
      const model = getModel(p.type, this.world.playerFaction(this.world.playerId));
      for (const part of model.parts) {
        const mesh = new THREE.Mesh(part.geo, mat);
        const piv = model.pivots[part.node];
        if (piv && part.node !== 'body') {
          const parent = model.parent[part.node];
          const pp = parent && parent !== 'body' ? model.pivots[parent]! : new THREE.Vector3();
          mesh.position.copy(piv).add(pp);
        }
        group.add(mesh);
      }
      const tiles = new THREE.InstancedMesh(new THREE.PlaneGeometry(TILE - 3, TILE - 3).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false, toneMapped: false }), def.w * def.h);
      tiles.setColorAt(0, new THREE.Color());
      tiles.renderOrder = 6;
      tiles.frustumCulled = false;
      this.ghost = { type: p.type, group, ok, tiles };
      this.scene.add(group, tiles);
    }
    this.ghost.group.position.set((p.tx + def.w / 2) * TILE, 0, (p.ty + def.h / 2) * TILE);
    const m = new THREE.Matrix4(), c = new THREE.Color();
    for (let j = 0; j < def.h; j++)
      for (let i = 0; i < def.w; i++) {
        const k = j * def.w + i;
        m.makeTranslation((p.tx + i + 0.5) * TILE, 1, (p.ty + j + 0.5) * TILE);
        this.ghost.tiles.setMatrixAt(k, m);
        this.ghost.tiles.setColorAt(k, p.tiles[k] ? c.setRGB(0.3, 1.4, 0.4) : c.setRGB(1.6, 0.25, 0.2));
      }
    this.ghost.tiles.instanceMatrix.needsUpdate = true;
    if (this.ghost.tiles.instanceColor) this.ghost.tiles.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.overlay.dispose();
    this.gl.dispose();
  }
}

/** True if WebGL2 can be created in this browser. */
export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}
