import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import type { MapTheme } from '@iron/shared';
import { fogUniforms, withFog } from './materials';

/** CC0 textures from Poly Haven (see public/assets/CREDITS.md). */
const BASE = `${import.meta.env.BASE_URL}assets/tex/`;

export interface TerrainLayers {
  base: string;
  dirt: string;
  rock: string;
  road: string;
  /** World px per texture repeat. */
  baseScale: number;
  rockScale: number;
  /** Multipliers applied to each layer's colour. */
  baseTint: [number, number, number];
  rockTint: [number, number, number];
  bedTint: [number, number, number];
}

export const THEME_LAYERS: Record<MapTheme, TerrainLayers> = {
  temperate: { base: 'forrest_ground_01', dirt: 'coast_sand_01', rock: 'aerial_rocks_02', road: 'aerial_asphalt_01', baseScale: 240, rockScale: 300, baseTint: [0.78, 0.92, 0.6], rockTint: [0.95, 0.95, 0.92], bedTint: [0.35, 0.34, 0.3] },
  desert: { base: 'aerial_sand', dirt: 'dry_ground_01', rock: 'cliff_side', road: 'concrete_floor_02', baseScale: 300, rockScale: 260, baseTint: [1.05, 0.98, 0.88], rockTint: [1, 0.95, 0.9], bedTint: [0.45, 0.4, 0.35] },
  arctic: { base: 'snow_02', dirt: 'snow_field_aerial', rock: 'aerial_rocks_02', road: 'concrete_floor_02', baseScale: 320, rockScale: 300, baseTint: [0.98, 1.0, 1.04], rockTint: [0.78, 0.82, 0.9], bedTint: [0.4, 0.45, 0.5] },
};

const loader = new THREE.TextureLoader();
const cache = new Map<string, Promise<THREE.Texture>>();

/** Loads (and caches) a texture; colour textures are sRGB, normal maps linear. */
export function loadTexture(name: string, color = true, anisotropy = 8): Promise<THREE.Texture> {
  const key = `${name}|${color}`;
  let p = cache.get(key);
  if (!p) {
    p = new Promise((resolve, reject) => {
      loader.load(`${BASE}${name}.jpg`, (t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.anisotropy = anisotropy;
        t.needsUpdate = true;
        resolve(t);
      }, undefined, reject);
    });
    cache.set(key, p);
  }
  return p;
}

export function loadSky(): Promise<THREE.DataTexture> {
  return new RGBELoader().loadAsync(`${BASE}sky.hdr`);
}

export interface TerrainTextures {
  layers: TerrainLayers;
  base: THREE.Texture; dirt: THREE.Texture; rock: THREE.Texture; road: THREE.Texture;
  baseN: THREE.Texture; rockN: THREE.Texture;
}

export async function loadTerrainTextures(theme: MapTheme, anisotropy: number): Promise<TerrainTextures> {
  const L = THEME_LAYERS[theme];
  const normalFor = (n: string) => (['forrest_ground_01', 'aerial_rocks_02', 'cliff_side', 'aerial_sand', 'snow_02', 'coast_sand_01'].includes(n) ? `${n}_n` : 'aerial_sand_n');
  const [base, dirt, rock, road, baseN, rockN] = await Promise.all([
    loadTexture(L.base, true, anisotropy), loadTexture(L.dirt, true, anisotropy), loadTexture(L.rock, true, anisotropy), loadTexture(L.road, true, anisotropy),
    loadTexture(normalFor(L.base), false, anisotropy), loadTexture(normalFor(L.rock), false, anisotropy),
  ]);
  return { layers: L, base, dirt, rock, road, baseN, rockN };
}

const v3 = (c: [number, number, number]) => new THREE.Vector3(...c);

/**
 * Splat-mapped PBR ground: blends base/dirt/road by a splat texture, applies
 * triplanar rock on cliff tops and steep faces, perturbs normals with the
 * layer normal maps and darkens wet riverbeds. Also receives fog of war.
 */
export function terrainMaterial(tx: TerrainTextures, splat: THREE.Texture, mapSizePx: THREE.Vector2): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
  const L = tx.layers;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, {
      tSplat: { value: splat }, tBase: { value: tx.base }, tDirt: { value: tx.dirt }, tRock: { value: tx.rock }, tRoad: { value: tx.road },
      tBaseN: { value: tx.baseN }, tRockN: { value: tx.rockN }, uMapSize: { value: mapSizePx },
      uBaseScale: { value: L.baseScale }, uRockScale: { value: L.rockScale },
      uBaseTint: { value: v3(L.baseTint) }, uRockTint: { value: v3(L.rockTint) }, uBedTint: { value: v3(L.bedTint) },
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTWP;\nvarying vec3 vTWN;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvTWP = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvTWN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vTWP; varying vec3 vTWN;
        uniform sampler2D tSplat, tBase, tDirt, tRock, tRoad, tBaseN, tRockN;
        uniform vec2 uMapSize; uniform float uBaseScale, uRockScale;
        uniform vec3 uBaseTint, uRockTint, uBedTint;
        vec3 sampleTiled(sampler2D t, vec2 uv) {
          // Two rotated scales hide visible repetition.
          vec3 a = texture2D(t, uv).rgb;
          vec2 r = vec2(uv.x * 0.8 - uv.y * 0.6, uv.x * 0.6 + uv.y * 0.8) * 0.37 + 0.21;
          vec3 b = texture2D(t, r).rgb;
          return mix(a, b, 0.38);
        }
        vec3 triplanar(sampler2D t, vec3 p, vec3 n, float s) {
          vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z);
          return texture2D(t, p.zy / s).rgb * w.x + texture2D(t, p.xz / s).rgb * w.y + texture2D(t, p.xy / s).rgb * w.z;
        }
        float gTerrRock; vec4 gTerrSplat;`)
      .replace('#include <map_fragment>', `
        vec2 wuv = vTWP.xz;
        gTerrSplat = texture2D(tSplat, wuv / uMapSize);
        vec3 tn = normalize(vTWN);
        float slope = 1.0 - tn.y;
        vec3 cBase = sampleTiled(tBase, wuv / uBaseScale) * uBaseTint;
        vec3 cDirt = sampleTiled(tDirt, wuv / (uBaseScale * 0.9));
        vec3 cRoad = texture2D(tRoad, wuv / 220.0).rgb;
        vec3 cRock = triplanar(tRock, vTWP, tn, uRockScale) * uRockTint;
        gTerrRock = clamp(max(gTerrSplat.g, smoothstep(0.18, 0.5, slope)), 0.0, 1.0);
        vec3 col = mix(cBase, cDirt, gTerrSplat.r);
        col = mix(col, cRoad, gTerrSplat.b);
        col = mix(col, cRock, gTerrRock);
        // Wet, dark riverbeds below the waterline; slight darkening at cliff bases (fake AO).
        col = mix(col, col * uBedTint, clamp(gTerrSplat.a, 0.0, 1.0));
        diffuseColor.rgb *= col;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 nb = texture2D(tBaseN, wuv / uBaseScale).xyz * 2.0 - 1.0;
          vec3 nr = texture2D(tRockN, wuv / uRockScale).xyz * 2.0 - 1.0;
          vec3 nt = normalize(mix(nb, nr, gTerrRock));
          // Tangent frame of a mostly horizontal surface: x -> +X, y -> -Z, z -> up.
          vec3 T = normalize(vec3(1.0, 0.0, 0.0) - tn * tn.x);
          vec3 B = normalize(cross(tn, T));
          vec3 wn = normalize(T * nt.x * 0.9 + B * nt.y * 0.9 + tn * nt.z);
          normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
        }`);
  };
  m.customProgramCacheKey = () => 'terrain-splat';
  return withFog(m);
}

/**
 * Adds object-space triplanar detail (grime, plates, concrete grain) to a model
 * material. The detail is normalised around 1 so base colours are preserved.
 */
export function withTriplanarDetail<T extends THREE.MeshStandardMaterial>(m: T, tex: THREE.Texture, scale: number, strength: number): T {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    sh.uniforms.tDetail = { value: tex };
    sh.uniforms.uDetailScale = { value: scale };
    sh.uniforms.uDetailStrength = { value: strength };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOP;\nvarying vec3 vON;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvOP = transformed;\nvON = objectNormal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOP;\nvarying vec3 vON;\nuniform sampler2D tDetail;\nuniform float uDetailScale, uDetailStrength;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec3 n = normalize(vON);
          vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z);
          vec3 d = texture2D(tDetail, vOP.zy / uDetailScale).rgb * w.x + texture2D(tDetail, vOP.xz / uDetailScale).rgb * w.y + texture2D(tDetail, vOP.xy / uDetailScale).rgb * w.z;
          float lum = dot(d, vec3(0.299, 0.587, 0.114));
          // Texture mean is ~0.27 in linear space; normalise so average brightness is preserved.
          diffuseColor.rgb *= mix(1.0, lum * 3.6, uDetailStrength);
        }`);
    prev?.call(m, sh, r);
  };
  const prevKey = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => `tri-${prevKey()}`;
  m.userData.detail = true;
  return m;
}

let panelTex: THREE.Texture | null = null;
/**
 * Procedural tileable panel/grime texture: riveted plate seams with bevel
 * highlights, scratches, rain streaks and stains. Used as triplanar detail on
 * vehicle armour and building cladding.
 */
export function panelTexture(): THREE.Texture {
  if (panelTex) return panelTex;
  const N = 512, c = document.createElement('canvas');
  c.width = c.height = N;
  const ctx = c.getContext('2d')!;
  let seed = 1337;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  ctx.fillStyle = 'rgb(140,140,140)';
  ctx.fillRect(0, 0, N, N);
  // Low-frequency grime blotches (drawn wrapped so the texture tiles).
  const wrap = (fn: (ox: number, oy: number) => void) => { for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) fn(ox, oy); };
  for (let i = 0; i < 70; i++) {
    const x = rnd() * N, y = rnd() * N, r = 20 + rnd() * 90, a = 0.04 + rnd() * 0.08, dark = rnd() < 0.7;
    wrap((ox, oy) => {
      const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      g.addColorStop(0, dark ? `rgba(40,36,30,${a})` : `rgba(230,230,225,${a})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
    });
  }
  // Panel grid with random subdivisions.
  const cells = 3, cs = N / cells;
  const seam = (x0: number, y0: number, x1: number, y1: number) => {
    ctx.strokeStyle = 'rgba(25,25,25,0.9)'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.strokeStyle = 'rgba(240,240,235,0.6)'; ctx.lineWidth = 2.5;
    const dx = y1 - y0 ? 4 : 0, dy = x1 - x0 ? 4 : 0;
    ctx.beginPath(); ctx.moveTo(x0 + dx, y0 + dy); ctx.lineTo(x1 + dx, y1 + dy); ctx.stroke();
  };
  for (let cy = 0; cy < cells; cy++)
    for (let cx = 0; cx < cells; cx++) {
      const x = cx * cs, y = cy * cs;
      seam(x, y, x + cs, y);
      seam(x, y, x, y + cs);
      if (rnd() < 0.6) { const sx = x + cs * (0.3 + rnd() * 0.4); seam(sx, y, sx, y + cs); }
      if (rnd() < 0.4) { const sy = y + cs * (0.3 + rnd() * 0.4); seam(x, sy, x + cs, sy); }
      // Rivets along the top seam.
      if (rnd() < 0.7) for (let k = 10; k < cs; k += 18) {
        ctx.fillStyle = 'rgba(25,25,25,0.8)'; ctx.beginPath(); ctx.arc(x + k, y + 10, 3.2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(240,240,235,0.65)'; ctx.beginPath(); ctx.arc(x + k - 1, y + 9, 1.4, 0, Math.PI * 2); ctx.fill();
      }
      // Occasional vent/hatch.
      if (rnd() < 0.18) {
        const hx = x + 12 + rnd() * (cs - 50), hy = y + 14 + rnd() * (cs - 50);
        ctx.strokeStyle = 'rgba(30,30,30,0.85)'; ctx.lineWidth = 3; ctx.strokeRect(hx, hy, 46, 32);
        for (let k = 7; k < 32; k += 7) { ctx.beginPath(); ctx.moveTo(hx + 5, hy + k); ctx.lineTo(hx + 41, hy + k); ctx.stroke(); }
      }
    }
  // Scratches and rain streaks.
  for (let i = 0; i < 160; i++) {
    const x = rnd() * N, y = rnd() * N, len = 4 + rnd() * 18, a = rnd() * Math.PI;
    ctx.strokeStyle = `rgba(220,220,215,${0.08 + rnd() * 0.2})`; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); ctx.stroke();
  }
  for (let i = 0; i < 60; i++) {
    const x = rnd() * N, y = rnd() * N, len = 20 + rnd() * 70;
    const g = ctx.createLinearGradient(x, y, x, y + len);
    g.addColorStop(0, 'rgba(40,35,28,0.22)'); g.addColorStop(1, 'rgba(40,35,28,0)');
    ctx.fillStyle = g; ctx.fillRect(x, y, 2 + rnd() * 3, len);
  }
  // Fine noise.
  const img = ctx.getImageData(0, 0, N, N);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * 16;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  panelTex = new THREE.CanvasTexture(c);
  panelTex.wrapS = panelTex.wrapT = THREE.RepeatWrapping;
  panelTex.colorSpace = THREE.SRGBColorSpace;
  panelTex.anisotropy = 8;
  return panelTex;
}

export { fogUniforms };
