import * as THREE from 'three';
import type { MatKey } from './models';

/** Shared fog-of-war uniforms: a per-tile visibility texture sampled in every material. */
export const fogUniforms = {
  fogTex: { value: null as THREE.Texture | null },
  fogSize: { value: new THREE.Vector2(1, 1) },
};

/**
 * Injects fog-of-war darkening into a built-in material: fully visible tiles
 * are unchanged, explored tiles are dimmed and unexplored tiles go black.
 */
export function withFog<T extends THREE.Material>(m: T): T {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, r) => {
    prev?.call(m, shader, r);
    shader.uniforms.fogTex = fogUniforms.fogTex;
    shader.uniforms.fogSize = fogUniforms.fogSize;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFogXZ;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 fogWP = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          fogWP = instanceMatrix * fogWP;
        #endif
        fogWP = modelMatrix * fogWP;
        vFogXZ = fogWP.xz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFogXZ;\nuniform sampler2D fogTex;\nuniform vec2 fogSize;')
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        float fogV = texture2D(fogTex, vFogXZ / fogSize).r;
        gl_FragColor.rgb *= smoothstep(0.0, 1.0, fogV);`,
      );
  };
  const prevKey = m.customProgramCacheKey?.bind(m);
  m.customProgramCacheKey = () => `fog-${m.userData.detail ? 'd' : ''}-${prevKey ? prevKey().length : 0}`;
  return m;
}

type MatSpec = { basic?: boolean } & THREE.MeshStandardMaterialParameters;

const SPECS: Record<MatKey, MatSpec> = {
  paint: { color: 0xffffff, roughness: 0.55, metalness: 0.35 },
  paintDark: { color: 0x8a8a8a, roughness: 0.6, metalness: 0.35 },
  metal: { color: 0x8c9294, roughness: 0.35, metalness: 0.85 },
  dark: { color: 0x2c2f2c, roughness: 0.7, metalness: 0.5 },
  rubber: { color: 0x1b1c1a, roughness: 0.95, metalness: 0.05 },
  glass: { color: 0x6aa6c8, roughness: 0.08, metalness: 0.6, emissive: 0x0c2a3c, emissiveIntensity: 1 },
  concrete: { color: 0xa39f94, roughness: 0.92, metalness: 0.02 },
  hazard: { color: 0xe0a623, roughness: 0.6, metalness: 0.2 },
  glow: { basic: true, color: new THREE.Color(2.2, 1.7, 0.6) },
  glowRed: { basic: true, color: new THREE.Color(2.4, 0.3, 0.2) },
  lightGlow: { basic: true, color: new THREE.Color(1.2, 2.0, 3.2) },
  skin: { color: 0xc6976d, roughness: 0.8 },
  uniform: { color: 0x5d6342, roughness: 0.85 },
  sand: { color: 0xa79470, roughness: 1 },
  copper: { color: 0xc0743a, roughness: 0.3, metalness: 0.9 },
  ore: { color: 0xf0b030, roughness: 0.25, metalness: 0.6, emissive: 0x5a3500, emissiveIntensity: 1 },
  wood: { color: 0x5b4330, roughness: 0.9 },
  white: { color: 0xd8d8d2, roughness: 0.55, metalness: 0.2 },
};

function makeSet(fog: boolean): Record<MatKey, THREE.Material> {
  const out = {} as Record<MatKey, THREE.Material>;
  for (const [k, spec] of Object.entries(SPECS) as [MatKey, MatSpec][]) {
    const { basic, ...p } = spec;
    const m: THREE.Material = basic
      ? new THREE.MeshBasicMaterial({ color: p.color as THREE.Color, toneMapped: false })
      : new THREE.MeshStandardMaterial(p);
    out[k] = fog ? withFog(m) : m;
  }
  return out;
}

let mats: Record<MatKey, THREE.Material> | null = null;
let plain: Record<MatKey, THREE.Material> | null = null;

/** Materials shared by every model; 'paint' parts are tinted per instance with the team colour. */
export function materials(): Record<MatKey, THREE.Material> {
  return (mats ??= makeSet(true));
}
/** Same materials without fog-of-war (icons, previews). */
export function plainMaterials(): Record<MatKey, THREE.Material> {
  return (plain ??= makeSet(false));
}

/** Ghost (placement preview) material. */
export function ghostMaterial(ok: boolean) {
  return new THREE.MeshBasicMaterial({ color: ok ? 0x66ff77 : 0xff5544, transparent: true, opacity: 0.45, depthWrite: false });
}
