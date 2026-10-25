import * as THREE from 'three';
import { fbm, hash2, TILE, type MapDef } from '@iron/shared';
import { CHUNK, PALETTES, TerrainRenderer } from '../render/terrain';
import { withFog } from './materials';

let detailTex: THREE.Texture | null = null;
/** Tileable fine-grain detail texture (grass blades, grit) modulating the ground colour. */
function detailTexture(): THREE.Texture {
  if (detailTex) return detailTex;
  const N = 256, c = document.createElement('canvas');
  c.width = c.height = N;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(N, N);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const big = fbm((x / N) * 8, (y / N) * 8, 77, 3);
      const fine = hash2(x, y, 5);
      const blade = hash2(x >> 1, y, 9) > 0.86 ? 0.18 : 0;
      const v = 0.5 + (big - 0.5) * 0.35 + (fine - 0.5) * 0.22 + blade;
      const i = (y * N + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.max(0, Math.min(255, v * 255));
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  // Make it tile seamlessly by blending mirrored edges.
  detailTex = new THREE.CanvasTexture(c);
  detailTex.wrapS = detailTex.wrapT = THREE.MirroredRepeatWrapping;
  detailTex.colorSpace = THREE.NoColorSpace;
  return detailTex;
}

/** Adds the detail texture to a ground material (world-space UVs from the fog varying). */
function withDetail(m: THREE.MeshStandardMaterial) {
  m.userData.detail = true;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.detailTex = { value: detailTexture() };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D detailTex;')
      .replace('#include <map_fragment>', '#include <map_fragment>\n  vec3 dt = texture2D(detailTex, vFogXZ / 70.0).rgb * texture2D(detailTex, vFogXZ / 23.0 + 0.37).rgb * 4.0;\n  diffuseColor.rgb *= mix(vec3(1.0), dt, 0.55);');
  };
  return m;
}

const enum T { Grass = 0, Dirt = 1, Rock = 2, Water = 3, Trees = 4, Road = 5 }

/** Heightfield resolution in world px (two samples per tile). */
const STEP = TILE / 2;
export const WATER_LEVEL = -3;

/**
 * 3D battlefield ground: textured heightfield chunks (cliffs raised, riverbeds
 * sunk), an animated water surface, instanced trees, boulders and ore crystals.
 */
export class Terrain3D {
  readonly group = new THREE.Group();
  readonly painter: TerrainRenderer;
  private hw: number;
  private hh: number;
  private heights: Float32Array;
  private chunks: { mesh: THREE.Mesh; c: number; r: number; done: boolean }[] = [];
  private water: THREE.Mesh | null = null;
  private waterNormal: THREE.Texture | null = null;
  private ore: THREE.InstancedMesh;
  private oreSlots: { tile: number; k: number }[] = [];
  private oreVersion = -1;

  constructor(readonly map: MapDef, quality: 'low' | 'high') {
    this.painter = new TerrainRenderer(map, { trees: false, cliffShadows: false });
    this.hw = map.width * 2 + 1;
    this.hh = map.height * 2 + 1;
    this.heights = this.buildHeights();
    this.buildChunks();
    this.buildWater();
    this.buildTrees(quality);
    this.buildRocks();
    this.ore = this.buildOre();
  }

  private tile(tx: number, ty: number): number {
    const m = this.map;
    tx = Math.max(0, Math.min(m.width - 1, tx));
    ty = Math.max(0, Math.min(m.height - 1, ty));
    return m.terrain[ty * m.width + tx];
  }

  private buildHeights(): Float32Array {
    const h = new Float32Array(this.hw * this.hh);
    const tileH = (t: number, x: number, y: number) => {
      if (t === T.Rock) return 20 + fbm(x * 0.012, y * 0.012, 7, 3) * 26;
      if (t === T.Water) return -16;
      return 0;
    };
    for (let j = 0; j < this.hh; j++)
      for (let i = 0; i < this.hw; i++) {
        const x = i * STEP, y = j * STEP;
        // Average the tiles touching this sample; walkable tiles pull towards 0 so units stay on flat ground.
        let sum = 0, wsum = 0;
        for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const tx = Math.floor((x + dx * 0.5) / TILE), ty = Math.floor((y + dy * 0.5) / TILE);
          const t = this.tile(tx, ty);
          const w = t === T.Rock || t === T.Water ? 1 : 1.6;
          sum += tileH(t, x, y) * w;
          wsum += w;
        }
        h[j * this.hw + i] = sum / wsum;
      }
    return h;
  }

  /** Ground height at a world point (bilinear). */
  heightAt(x: number, y: number): number {
    const fx = Math.max(0, Math.min(this.hw - 1.001, x / STEP)), fy = Math.max(0, Math.min(this.hh - 1.001, y / STEP));
    const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
    const H = this.heights, w = this.hw;
    const a = H[j * w + i], b = H[j * w + i + 1], c = H[(j + 1) * w + i], d = H[(j + 1) * w + i + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  private buildChunks() {
    const cols = Math.ceil((this.map.width * TILE) / CHUNK), rows = Math.ceil((this.map.height * TILE) / CHUNK);
    const n = CHUNK / STEP;
    const pal = PALETTES[this.map.theme];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const ox = c * CHUNK, oy = r * CHUNK;
        const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
        for (let j = 0; j <= n; j++)
          for (let i = 0; i <= n; i++) {
            const x = ox + i * STEP, y = oy + j * STEP;
            const hc = this.heightAt(x, y);
            pos.push(x, hc, y);
            const dx = this.heightAt(x + STEP, y) - this.heightAt(x - STEP, y);
            const dz = this.heightAt(x, y + STEP) - this.heightAt(x, y - STEP);
            const v = new THREE.Vector3(-dx, STEP * 2, -dz).normalize();
            nor.push(v.x, v.y, v.z);
            // Half-texel inset avoids filtering seams between chunk textures.
            uv.push((0.5 + (i / n) * (CHUNK - 1)) / CHUNK, 1 - (0.5 + (j / n) * (CHUNK - 1)) / CHUNK);
          }
        for (let j = 0; j < n; j++)
          for (let i = 0; i < n; i++) {
            const a = j * (n + 1) + i, b = a + 1, d = a + n + 1, e = d + 1;
            idx.push(a, d, b, b, d, e);
          }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geo.setIndex(idx);
        geo.computeBoundingSphere();
        // Start with a flat placeholder texture so swapping in the painted one never changes the shader.
        const mat = withFog(withDetail(new THREE.MeshStandardMaterial({ map: placeholder(pal.grass), roughness: 0.95, metalness: 0 })));
        const mesh = new THREE.Mesh(geo, mat);
        mesh.receiveShadow = true;
        this.group.add(mesh);
        this.chunks.push({ mesh, c, r, done: false });
      }
  }

  /** Paints pending chunk textures, at most `budget` per call, nearest to (x,y) first. Returns remaining count. */
  paint(budget: number, x: number, y: number, anisotropy: number): number {
    const pending = this.chunks.filter((k) => !k.done);
    pending.sort((a, b) => Math.hypot((a.c + 0.5) * CHUNK - x, (a.r + 0.5) * CHUNK - y) - Math.hypot((b.c + 0.5) * CHUNK - x, (b.r + 0.5) * CHUNK - y));
    for (const k of pending.slice(0, budget)) {
      const canvas = this.painter.renderChunk(k.c, k.r);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = anisotropy;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      const m = k.mesh.material as THREE.MeshStandardMaterial;
      m.map = tex;
      k.done = true;
    }
    return pending.length - Math.min(budget, pending.length);
  }

  private buildWater() {
    const m = this.map;
    if (!m.terrain.some((t) => t === T.Water)) return;
    // Procedural ripple normal map.
    const size = 128, c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(size, size);
    const hgt = (x: number, y: number) => fbm((x / size) * 8, (y / size) * 8, 21, 3);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const dx = hgt((x + 1) % size, y) - hgt((x - 1 + size) % size, y);
        const dy = hgt(x, (y + 1) % size) - hgt(x, (y - 1 + size) % size);
        const n = new THREE.Vector3(-dx * 6, -dy * 6, 1).normalize();
        const i = (y * size + x) * 4;
        img.data[i] = (n.x * 0.5 + 0.5) * 255; img.data[i + 1] = (n.y * 0.5 + 0.5) * 255; img.data[i + 2] = (n.z * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(m.width / 4, m.height / 4);
    this.waterNormal = tex;
    const pal = PALETTES[m.theme];
    const geo = new THREE.PlaneGeometry(m.width * TILE, m.height * TILE);
    geo.rotateX(-Math.PI / 2);
    geo.translate((m.width * TILE) / 2, WATER_LEVEL, (m.height * TILE) / 2);
    const mat = withFog(new THREE.MeshStandardMaterial({
      color: new THREE.Color(`rgb(${pal.water.map((v) => Math.round(v * 0.8)).join(',')})`),
      roughness: 0.32, metalness: 0.1, transparent: true, opacity: 0.88, normalMap: tex, normalScale: new THREE.Vector2(0.3, 0.3),
    }));
    this.water = new THREE.Mesh(geo, mat);
    this.water.receiveShadow = true;
    this.group.add(this.water);
  }

  private buildTrees(quality: 'low' | 'high') {
    const m = this.map;
    const pts: { x: number; y: number; s: number; r: number; c: number }[] = [];
    for (let ty = 0; ty < m.height; ty++)
      for (let tx = 0; tx < m.width; tx++) {
        if (m.terrain[ty * m.width + tx] !== T.Trees) continue;
        const n = (quality === 'low' ? 1 : 2) + Math.floor(hash2(tx, ty, 5) * 2);
        for (let k = 0; k < n; k++) {
          pts.push({
            x: tx * TILE + 5 + hash2(tx, ty, 11 + k) * 22, y: ty * TILE + 5 + hash2(tx, ty, 23 + k) * 22,
            s: 0.75 + hash2(tx, ty, 31 + k) * 0.6, r: hash2(tx, ty, 41 + k) * Math.PI * 2, c: hash2(tx, ty, 51 + k),
          });
        }
      }
    if (!pts.length) return;
    const theme = m.theme;
    const trunkGeo = new THREE.CylinderGeometry(1, 1.6, 8, 6).translate(0, 4, 0);
    let crownGeo: THREE.BufferGeometry, capGeo: THREE.BufferGeometry | null = null;
    let crownColor: THREE.Color;
    if (theme === 'arctic') {
      crownGeo = new THREE.ConeGeometry(7, 20, 7).translate(0, 16, 0);
      capGeo = new THREE.ConeGeometry(4.2, 9, 7).translate(0, 23, 0);
      crownColor = new THREE.Color(0x2c4a3a);
    } else if (theme === 'desert') {
      crownGeo = new THREE.IcosahedronGeometry(6, 0).scale(1.2, 0.7, 1.2).translate(0, 7, 0);
      crownColor = new THREE.Color(0x7a7a3a);
    } else {
      const a = new THREE.IcosahedronGeometry(8, 1).translate(0, 14, 0);
      const b = new THREE.IcosahedronGeometry(5.5, 1).translate(2, 21, 1);
      crownGeo = mergeSimple([a, b]);
      crownColor = new THREE.Color(0x3c6a2c);
    }
    const trunk = new THREE.InstancedMesh(trunkGeo, withFog(new THREE.MeshStandardMaterial({ color: 0x5a4130, roughness: 0.9 })), pts.length);
    const crown = new THREE.InstancedMesh(crownGeo, withFog(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true })), pts.length);
    const cap = capGeo ? new THREE.InstancedMesh(capGeo, withFog(new THREE.MeshStandardMaterial({ color: 0xf0f4f8, roughness: 0.7, flatShading: true })), pts.length) : null;
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
    pts.forEach((p, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.r);
      mtx.compose(new THREE.Vector3(p.x, this.heightAt(p.x, p.y), p.y), q, new THREE.Vector3(p.s, p.s * (0.9 + p.c * 0.3), p.s));
      trunk.setMatrixAt(i, mtx);
      crown.setMatrixAt(i, mtx);
      cap?.setMatrixAt(i, mtx);
      col.copy(crownColor).offsetHSL((p.c - 0.5) * 0.06, 0, (p.c - 0.5) * 0.12);
      crown.setColorAt(i, col);
    });
    for (const im of [trunk, crown, cap]) {
      if (!im) continue;
      im.castShadow = true;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      this.group.add(im);
    }
  }

  private buildRocks() {
    const m = this.map;
    const pts: [number, number, number, number][] = [];
    for (let ty = 0; ty < m.height; ty++)
      for (let tx = 0; tx < m.width; tx++) {
        if (m.terrain[ty * m.width + tx] !== T.Rock) continue;
        if (hash2(tx, ty, 61) > 0.3) continue;
        const x = tx * TILE + 6 + hash2(tx, ty, 62) * 20, y = ty * TILE + 6 + hash2(tx, ty, 63) * 20;
        pts.push([x, y, 3 + hash2(tx, ty, 64) * 6, hash2(tx, ty, 65)]);
      }
    if (!pts.length) return;
    const pal = PALETTES[m.theme];
    const geo = new THREE.DodecahedronGeometry(1, 0);
    const im = new THREE.InstancedMesh(geo, withFog(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true })), pts.length);
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color(`rgb(${pal.rock.join(',')})`), c2 = new THREE.Color();
    pts.forEach(([x, y, s, r], i) => {
      q.setFromEuler(new THREE.Euler(r * 3, r * 7, r * 5));
      mtx.compose(new THREE.Vector3(x, this.heightAt(x, y) + s * 0.3, y), q, new THREE.Vector3(s * 1.3, s * 0.8, s));
      im.setMatrixAt(i, mtx);
      im.setColorAt(i, c2.copy(col).offsetHSL(0, 0, (r - 0.5) * 0.15));
    });
    im.castShadow = true;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    this.group.add(im);
  }

  private buildOre(): THREE.InstancedMesh {
    const m = this.map;
    for (let i = 0; i < m.oreMax.length; i++) if (m.oreMax[i] > 0) for (let k = 0; k < 6; k++) this.oreSlots.push({ tile: i, k });
    const geo = new THREE.OctahedronGeometry(3.8, 0).scale(0.8, 1.9, 0.8);
    const mat = withFog(new THREE.MeshStandardMaterial({ color: 0xffc040, roughness: 0.2, metalness: 0.55, emissive: 0x6a3c00, emissiveIntensity: 0.5, flatShading: true }));
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, this.oreSlots.length));
    im.castShadow = true;
    im.count = 0;
    this.group.add(im);
    return im;
  }

  /** Rebuilds ore crystal instances when amounts change. */
  updateOre(ore: Uint16Array, version: number) {
    if (version === this.oreVersion) return;
    this.oreVersion = version;
    const m = this.map, im = this.ore;
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
    let n = 0;
    for (const { tile, k } of this.oreSlots) {
      const amt = ore[tile];
      if (amt <= 0 || k >= Math.min(6, Math.ceil(amt / 80))) continue;
      const tx = tile % m.width, ty = Math.floor(tile / m.width);
      const x = tx * TILE + 5 + hash2(tx, ty, 100 + k) * 22, y = ty * TILE + 5 + hash2(tx, ty, 120 + k) * 22;
      const s = 0.6 + hash2(tx, ty, 140 + k) * 0.6 + Math.min(0.4, amt / 1500);
      q.setFromEuler(new THREE.Euler((hash2(tx, ty, 160 + k) - 0.5) * 0.7, hash2(tx, ty, 180 + k) * 6, (hash2(tx, ty, 200 + k) - 0.5) * 0.7));
      mtx.compose(new THREE.Vector3(x, s * 3.6, y), q, new THREE.Vector3(s, s, s));
      im.setMatrixAt(n, mtx);
      im.setColorAt(n, col.setHSL(0.11 + hash2(tx, ty, 220 + k) * 0.03, 0.85, 0.5 + hash2(tx, ty, 240 + k) * 0.15));
      n++;
    }
    im.count = n;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
  }

  animate(t: number) {
    if (this.waterNormal) {
      this.waterNormal.offset.set(t * 0.012, t * 0.007);
    }
  }
}

let placeholderTex: THREE.Texture | null = null;
function placeholder(rgb: [number, number, number]): THREE.Texture {
  if (placeholderTex) return placeholderTex;
  const c = document.createElement('canvas');
  c.width = c.height = 4;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = `rgb(${rgb.join(',')})`;
  ctx.fillRect(0, 0, 4, 4);
  placeholderTex = new THREE.CanvasTexture(c);
  placeholderTex.colorSpace = THREE.SRGBColorSpace;
  return placeholderTex;
}

function mergeSimple(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const list = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const pos: number[] = [], nor: number[] = [];
  for (const g of list) {
    g.computeVertexNormals();
    pos.push(...(g.attributes.position.array as Float32Array));
    nor.push(...(g.attributes.normal.array as Float32Array));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return out;
}
