import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { FactionId } from '@iron/shared';
import { plainMaterials } from './materials';
import { getModel } from './models';
import { Store } from '../store';

/** Bumped whenever a new 3D icon finishes rendering (UI subscribes to refresh). */
export const iconVersion = new Store(0);
const queue: [string, string, FactionId | null][] = [];
let pumping = false;

/** Returns the 3D icon if ready; otherwise schedules it and returns null. */
export function icon3dLazy(type: string, color: string, faction: FactionId | null): string | null {
  const key = `${type}|${color}|${faction}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (failed) return null;
  if (!queue.some((q) => `${q[0]}|${q[1]}|${q[2]}` === key)) queue.push([type, color, faction]);
  if (!pumping) {
    pumping = true;
    const step = () => {
      const job = queue.shift();
      if (!job) { pumping = false; iconVersion.set(iconVersion.get() + 1); return; }
      icon3d(job[0], job[1], job[2]);
      if (queue.length % 4 === 0) iconVersion.set(iconVersion.get() + 1);
      setTimeout(step, 16);
    };
    setTimeout(step, 400);
  }
  return null;
}

const W = 192, H = 144;
let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene;
let camera: THREE.OrthographicCamera;
let failed = false;
const cache = new Map<string, string>();

function init(): boolean {
  if (renderer) return true;
  if (failed) return false;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(W, H, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.45;
    scene.add(new THREE.HemisphereLight(0xe6eeff, 0x40402f, 1.6));
    const sun = new THREE.DirectionalLight(0xfff2dc, 2.6);
    sun.position.set(-1, 2, 1.2);
    scene.add(sun);
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);
    return true;
  } catch {
    failed = true;
    return false;
  }
}

/** Renders a 3D model of the given type to a data URL (cached), or null if WebGL is unavailable. */
export function icon3d(type: string, color: string, faction: FactionId | null): string | null {
  const key = `${type}|${color}|${faction}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (!init() || !renderer) return null;
  const model = getModel(type, faction);
  const mats = plainMaterials();
  const tint = new THREE.Color(color).lerp(new THREE.Color(faction === 'esd' ? 0x6e6050 : 0x9aa4ad), 0.22);
  const group = new THREE.Group();
  const owned: THREE.Material[] = [];
  const nodeOffset = (node: string): THREE.Vector3 => {
    const piv = model.pivots[node as keyof typeof model.pivots];
    if (!piv || node === 'body') return new THREE.Vector3();
    const parent = model.parent[node as keyof typeof model.parent];
    return piv.clone().add(parent && parent !== 'body' ? nodeOffset(parent) : new THREE.Vector3());
  };
  for (const part of model.parts) {
    let mat = mats[part.mat];
    if (part.mat === 'paint' || part.mat === 'paintDark') {
      mat = (mat as THREE.MeshStandardMaterial).clone();
      (mat as THREE.MeshStandardMaterial).color.multiply(tint);
      owned.push(mat);
    }
    const mesh = new THREE.Mesh(part.geo, mat);
    mesh.position.copy(nodeOffset(part.node));
    if (part.node === 'cargo') mesh.scale.y = 0.7;
    group.add(mesh);
  }
  // Ground plate for context.
  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  group.rotation.y = -0.6;
  scene.add(group);
  const span = Math.max(size.x, size.z, size.y * 1.2) * 0.75;
  camera.left = -span * (W / H); camera.right = span * (W / H); camera.top = span; camera.bottom = -span;
  camera.updateProjectionMatrix();
  camera.position.set(center.x + 300, center.y + 260, center.z + 300);
  camera.lookAt(center.x, center.y * 0.8, center.z);
  renderer.setClearColor(0x1c231a, 1);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL();
  scene.remove(group);
  for (const m of owned) m.dispose();
  cache.set(key, url);
  return url;
}
