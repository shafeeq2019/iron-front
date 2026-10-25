import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { BUILDINGS, TILE, type FactionId } from '@iron/shared';

/**
 * Procedural 3D models. Coordinates are world pixels; models face +X, Y is up,
 * Z is the lateral axis. Each model is split into animated nodes (turret,
 * barrel, legs, dish...) and, per node, into material groups, so every
 * (node, material) pair becomes one InstancedMesh.
 */

export type MatKey =
  | 'paint' | 'paintDark' | 'metal' | 'dark' | 'rubber' | 'glass' | 'concrete' | 'hazard' | 'glow' | 'glowRed'
  | 'skin' | 'uniform' | 'sand' | 'copper' | 'ore' | 'wood' | 'white' | 'lightGlow'
  | 'cladA' | 'cladB' | 'roof' | 'window' | 'grate';

export type NodeKey = 'body' | 'turret' | 'barrel' | 'legL' | 'legR' | 'dish' | 'arm' | 'orb' | 'cargo' | 'crane';

export interface ModelDef {
  key: string;
  /** Geometry per node per material (node-local coordinates). */
  parts: { node: NodeKey; mat: MatKey; geo: THREE.BufferGeometry }[];
  /** Node pivots relative to the parent node. */
  pivots: Partial<Record<NodeKey, THREE.Vector3>>;
  parent: Partial<Record<NodeKey, NodeKey>>;
  /** Approximate height, used for health bars and effects. */
  height: number;
  /** Uniform visual scale. */
  scale?: number;
  /** Muzzle (barrel-local) position for effects. */
  muzzle?: THREE.Vector3;
  /** Smoke emission points (body-local). */
  smoke?: THREE.Vector3[];
}

class Builder {
  private groups = new Map<string, THREE.BufferGeometry[]>();
  pivots: ModelDef['pivots'] = { body: new THREE.Vector3() };
  parent: ModelDef['parent'] = {};
  add(node: NodeKey, mat: MatKey, geo: THREE.BufferGeometry) {
    const k = `${node}|${mat}`;
    // Normalise attributes so geometries can be merged.
    let g = geo.index ? geo.toNonIndexed() : geo;
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    if (!g.attributes.normal) g.computeVertexNormals();
    g = g as THREE.BufferGeometry;
    (this.groups.get(k) ?? this.groups.set(k, []).get(k)!).push(g);
    return this;
  }
  pivot(node: NodeKey, x: number, y: number, z: number, parent: NodeKey = 'body') {
    this.pivots[node] = new THREE.Vector3(x, y, z);
    this.parent[node] = parent;
    return this;
  }
  build(key: string, height: number, extra: Partial<ModelDef> = {}): ModelDef {
    const parts: ModelDef['parts'] = [];
    for (const [k, list] of this.groups) {
      const [node, mat] = k.split('|') as [NodeKey, MatKey];
      const geo = mergeGeometries(list, false)!;
      geo.computeBoundingSphere();
      parts.push({ node, mat, geo });
    }
    return { key, parts, pivots: this.pivots, parent: this.parent, height, ...extra };
  }
}

// ------------------------------------------------------------------ primitives

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();

function place(g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  tmpE.set(rx, ry, rz);
  tmpQ.setFromEuler(tmpE);
  tmpM.compose(new THREE.Vector3(x, y, z), tmpQ, new THREE.Vector3(sx, sy, sz));
  g.applyMatrix4(tmpM);
  return g;
}
/** Box with its base at y (not centred). */
const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0, ry = 0) => place(new THREE.BoxGeometry(w, h, d), x, y + h / 2, z, 0, ry);
const rbox = (w: number, h: number, d: number, x = 0, y = 0, z = 0, r = 1.2, ry = 0) =>
  place(new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2 - 0.01, h / 2 - 0.01, d / 2 - 0.01)), x, y + h / 2, z, 0, ry);
/** Cylinder standing on y, along Y. */
const cyl = (rt: number, rb: number, h: number, x = 0, y = 0, z = 0, seg = 16) => place(new THREE.CylinderGeometry(rt, rb, h, seg), x, y + h / 2, z);
/** Cylinder lying along X, starting at x. */
const cylX = (r: number, len: number, x = 0, y = 0, z = 0, seg = 12, tilt = 0) => {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.rotateZ(-Math.PI / 2);
  g.translate(len / 2, 0, 0);
  g.rotateZ(tilt);
  g.translate(x, y, z);
  return g;
};
/** Cylinder lying along Z (wheels). */
const cylZ = (r: number, w: number, x = 0, y = 0, z = 0, seg = 14) => place(new THREE.CylinderGeometry(r, r, w, seg), x, y, z, Math.PI / 2);
const sphere = (r: number, x = 0, y = 0, z = 0, seg = 12, sy = 1) => place(new THREE.SphereGeometry(r, seg, Math.max(6, seg * 0.6)), x, y, z, 0, 0, 0, 1, sy, 1);
const dome = (r: number, x = 0, y = 0, z = 0, seg = 18) => place(new THREE.SphereGeometry(r, seg, 10, 0, Math.PI * 2, 0, Math.PI / 2), x, y, z);
/** Side-profile polygon (x,y pairs) extruded across Z with a small bevel. */
function profile(pts: number[], width: number, z = 0, bevel = 0.8) {
  const s = new THREE.Shape();
  s.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) s.lineTo(pts[i], pts[i + 1]);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: width - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.7, bevelSegments: 1 });
  g.translate(0, 0, z - width / 2 + bevel);
  return g;
}
/** Top-view polygon (x,z pairs) extruded upward from y with height h. */
function prism(pts: number[], h: number, y = 0, bevel = 0.6) {
  const s = new THREE.Shape();
  s.moveTo(pts[0], -pts[1]);
  for (let i = 2; i < pts.length; i += 2) s.lineTo(pts[i], -pts[i + 1]);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: h - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.7, bevelSegments: 1 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y + bevel, 0);
  return g;
}
const lathe = (pts: [number, number][], x = 0, y = 0, z = 0, seg = 20) => place(new THREE.LatheGeometry(pts.map(([r, h]) => new THREE.Vector2(r, h)), seg), x, y, z);

/** Pair of tank tracks with road wheels. */
function tracks(b: Builder, len: number, width: number, gap: number, h: number) {
  for (const s of [-1, 1]) {
    const z = s * (gap / 2 + width / 2);
    b.add('body', 'rubber', rbox(len, h, width, 0, 0.3, z, 2.2));
    for (let i = 0; i < 5; i++) b.add('body', 'dark', cylZ(h * 0.32, width + 0.4, -len / 2 + 3 + (i * (len - 6)) / 4, h * 0.45, z));
  }
}
function wheels(b: Builder, xs: number[], r: number, w: number, zOff: number) {
  for (const x of xs) for (const s of [-1, 1]) {
    b.add('body', 'rubber', cylZ(r, w, x, r, s * zOff));
    b.add('body', 'metal', cylZ(r * 0.45, w + 0.3, x, r, s * zOff));
  }
}

// ------------------------------------------------------------------ units

/** Side skirts with bolts, headlights, exhausts, tow hooks and stowage for tracked hulls. */
function hullKit(b: Builder, len: number, halfW: number, skirtY: number, deckY: number, opts: { antenna?: boolean } = {}) {
  const front = len / 2;
  for (const s of [-1, 1]) {
    const z = s * (halfW + 0.4);
    b.add('body', 'paintDark', box(len * 0.86, 3, 0.7, 0, skirtY, z));
    for (let x = -len * 0.38; x <= len * 0.38; x += len / 7) b.add('body', 'metal', cylZ(0.35, 0.4, x, skirtY + 1.5, z + s * 0.4, 6));
    b.add('body', 'lightGlow', box(0.6, 1, 1.4, front + 0.3, deckY - 2.6, s * (halfW - 1.6)));
    b.add('body', 'dark', box(1.2, 1.4, 2, front - 0.2, deckY - 2.8, s * (halfW - 1.6)));
    b.add('body', 'metal', box(1.6, 1, 0.8, front + 0.6, skirtY - 0.6, s * (halfW - 3)));
    b.add('body', 'dark', cylX(0.8, 2.2, -front - 1.4, deckY - 1.6, s * (halfW - 2.4), 8));
  }
  b.add('body', 'wood', rbox(5, 1.8, 3.2, -front + 4, deckY, halfW - 2.2, 0.4));
  b.add('body', 'dark', rbox(4, 1.6, 2.8, -front + 4, deckY, -halfW + 2.2, 0.4));
  if (opts.antenna) b.add('body', 'metal', cyl(0.18, 0.3, 11, -front + 3, deckY, -halfW + 5, 5));
}


function lightTank(): ModelDef {
  const b = new Builder();
  tracks(b, 29, 5.5, 13, 7);
  b.add('body', 'paint', profile([-14, 4, 12, 4, 15.5, 7.5, 11, 11, -11, 11, -14.5, 9], 15));
  b.add('body', 'paintDark', box(26, 1.2, 6, -1, 6.6, 9.3)).add('body', 'paintDark', box(26, 1.2, 6, -1, 6.6, -9.3));
  b.add('body', 'dark', box(6, 1, 9, -9.5, 11, 0));
  hullKit(b, 28, 7.5, 3.4, 11, { antenna: true });
  b.pivot('turret', -1, 11, 0);
  b.add('turret', 'paint', place(new THREE.CylinderGeometry(5.6, 6.8, 4.6, 10), 0, 2.3, 0));
  b.add('turret', 'paintDark', box(4, 3.2, 6, 4.6, 0.6, 0));
  b.add('turret', 'metal', cyl(1.5, 1.5, 1.2, -2.2, 4.6, 1.8, 10));
  b.add('turret', 'dark', box(2, 1.6, 1.2, -5, 4.2, -3.4));
  b.add('turret', 'paintDark', cyl(1.8, 2, 1.4, -2.2, 4.6, 1.8, 10)).add('turret', 'glass', box(0.4, 0.6, 1.8, -0.4, 5.4, 1.8));
  b.add('turret', 'dark', box(4, 1.6, 7, -6.4, 1.4, 0));
  b.pivot('barrel', 6, 2.4, 0, 'turret');
  b.add('barrel', 'metal', cylX(1.05, 14));
  b.add('barrel', 'dark', cylX(1.6, 2.4, 12.5));
  return b.build('lighttank', 16, { muzzle: new THREE.Vector3(15, 0, 0) });
}

function heavyTank(): ModelDef {
  const b = new Builder();
  tracks(b, 36, 7, 17, 8.5);
  b.add('body', 'paint', profile([-17, 4.5, 15, 4.5, 19, 8.5, 14, 13, -14, 13, -17.5, 10.5], 19));
  b.add('body', 'paintDark', box(32, 1.4, 8, -1, 8, 12.2)).add('body', 'paintDark', box(32, 1.4, 8, -1, 8, -12.2));
  b.add('body', 'dark', box(8, 1, 12, -11, 13, 0));
  b.add('body', 'metal', cyl(1, 1, 3, -15, 13, 6, 8)).add('body', 'metal', cyl(1, 1, 3, -15, 13, -6, 8));
  hullKit(b, 35, 9.8, 4, 13, { antenna: true });
  b.pivot('turret', -2, 13, 0);
  b.add('turret', 'paint', prism([-9, -8, 5, -8, 9, -4, 9, 4, 5, 8, -9, 8], 6.5, 0, 1));
  b.add('turret', 'paintDark', box(5, 4, 10, 8, 1, 0));
  b.add('turret', 'metal', cyl(2, 2, 1.6, -4, 6.5, -3, 10));
  b.add('turret', 'dark', box(3, 2, 2, -7, 6.5, 4));
  b.add('turret', 'paintDark', cyl(2.2, 2.4, 2, -4, 6.5, -3, 10)).add('turret', 'dark', cylX(0.35, 5, -4, 9, -3, 6));
  b.add('turret', 'dark', box(5, 2.4, 14, -9.6, 2, 0));
  for (const z of [-7, 7]) b.add('turret', 'dark', cylX(0.7, 1.4, 0, 5.2, z, 6)).add('turret', 'dark', cylX(0.7, 1.4, 0, 3.6, z, 6));
  b.pivot('barrel', 10, 3.4, 0, 'turret');
  b.add('barrel', 'metal', cylX(1.2, 17, 0, 0, 2.6)).add('barrel', 'metal', cylX(1.2, 17, 0, 0, -2.6));
  b.add('barrel', 'dark', cylX(1.8, 2.6, 15, 0, 2.6)).add('barrel', 'dark', cylX(1.8, 2.6, 15, 0, -2.6));
  return b.build('heavytank', 20, { muzzle: new THREE.Vector3(18, 0, 0) });
}

function raider(): ModelDef {
  const b = new Builder();
  wheels(b, [-8, 8], 4, 3, 9);
  b.add('body', 'paint', profile([-12, 3.5, 7, 3.5, 14, 6, 13, 8, 4, 8.5, -10, 8.5, -12.5, 6.5], 12, 0, 0.6));
  b.add('body', 'paintDark', box(8, 1.2, 18, -8, 6.5, 0)).add('body', 'paintDark', box(8, 1.2, 18, 8, 6.5, 0));
  b.add('body', 'glass', profile([4, 8.5, 9, 8.5, 7, 11, 4, 11], 9, 0, 0.3));
  for (const z of [-4.5, 4.5]) {
    b.add('body', 'dark', box(1, 7, 1, -2, 8.5, z));
    b.add('body', 'dark', box(1, 7, 1, -9, 8.5, z));
  }
  b.add('body', 'dark', box(8, 1, 10, -5.5, 15, 0));
  for (const z of [-4, 4]) b.add('body', 'lightGlow', box(0.6, 1, 1.6, 13.6, 6.6, z));
  b.add('body', 'dark', box(1.4, 2, 11, 14.4, 3.6, 0));
  b.add('body', 'wood', rbox(4, 1.6, 4, -10, 8.5, 3, 0.3));
  b.pivot('turret', -5, 16, 0);
  b.add('turret', 'paint', rbox(6, 3, 6, 0, 0, 0, 1));
  b.pivot('barrel', 2.5, 1.6, 0, 'turret');
  b.add('barrel', 'metal', cylX(0.6, 10, 0, 0, 1.2, 8)).add('barrel', 'metal', cylX(0.6, 10, 0, 0, -1.2, 8));
  return b.build('raider', 19, { muzzle: new THREE.Vector3(10, 0, 0) });
}

function mauler(): ModelDef {
  const b = new Builder();
  tracks(b, 33, 7, 15, 8);
  b.add('body', 'paint', profile([-16, 4, 12, 4, 18, 7, 12, 12.5, -13, 12.5, -16.5, 9], 17));
  b.add('body', 'paintDark', prism([-16, -12, 14, -12, 18, -9, -16, -9], 1.4, 7.5, 0.3));
  b.add('body', 'paintDark', prism([-16, 9, 18, 9, 14, 12, -16, 12], 1.4, 7.5, 0.3));
  b.add('body', 'dark', box(7, 1, 10, -10, 12.5, 0));
  hullKit(b, 32, 9, 3.8, 12.5);
  b.pivot('turret', -2, 12.5, 0);
  b.add('turret', 'paint', prism([-8, -6, 3, -7, 8, -3, 8, 3, 3, 7, -8, 6], 6, 0, 0.8));
  b.add('turret', 'dark', box(3, 1.4, 3, -5, 6, 2));
  b.add('turret', 'paintDark', prism([-8.4, -4, -6, -4, -6, 4, -8.4, 4], 4, 0.8, 0.3));
  b.add('turret', 'metal', cyl(0.2, 0.3, 10, -6, 6, -4, 5));
  b.pivot('barrel', 8, 3, 0, 'turret');
  b.add('barrel', 'metal', cylX(1.6, 20));
  b.add('barrel', 'dark', cylX(2.4, 3.4, 18));
  return b.build('mauler', 19, { muzzle: new THREE.Vector3(21, 0, 0) });
}

function artillery(): ModelDef {
  const b = new Builder();
  tracks(b, 27, 5.5, 13, 6.5);
  b.add('body', 'paint', profile([-13, 4, 12, 4, 14, 7, 11, 9.5, -12, 9.5], 14));
  b.add('body', 'metal', cylX(0.8, 7, -20, 3, 4.5, 8, 0.2)).add('body', 'metal', cylX(0.8, 7, -20, 3, -4.5, 8, 0.2));
  hullKit(b, 26, 7.5, 3.2, 9.5, { antenna: true });
  b.pivot('turret', -3, 9.5, 0);
  b.add('turret', 'paint', rbox(13, 6, 11, -1, 0, 0, 1.4));
  b.add('turret', 'dark', box(3, 1.4, 3, -4, 6, 3));
  b.add('turret', 'paintDark', box(4, 4.5, 8, 6, 0.5, 0));
  b.pivot('barrel', 6, 3.5, 0, 'turret');
  b.add('barrel', 'metal', cylX(1.15, 24, 0, 0, 0, 12, 0.32));
  b.add('barrel', 'dark', cylX(1.8, 3, 21.5, 0, 0, 12, 0.32));
  b.add('barrel', 'dark', cylX(2.3, 4, 0, 0, 0, 12, 0.32));
  return b.build('artillery', 18, { muzzle: new THREE.Vector3(23, 7.5, 0) });
}

function hailstorm(): ModelDef {
  const b = new Builder();
  wheels(b, [-10, -3, 9], 3.4, 2.6, 8);
  b.add('body', 'paintDark', rbox(26, 3, 14, -2, 3, 0, 0.8));
  b.add('body', 'paint', rbox(8, 8, 13, 10, 5, 0, 1.6));
  b.add('body', 'glass', box(1, 3, 10, 14.3, 8.5, 0));
  for (const z of [-5, 5]) b.add('body', 'lightGlow', box(0.6, 1, 1.4, 14.4, 6, z));
  b.add('body', 'metal', cyl(0.18, 0.3, 10, 7, 13, -5, 5));
  b.pivot('turret', -5, 6, 0);
  b.add('turret', 'metal', cyl(3, 3.6, 2, 0, 0, 0, 10));
  b.add('turret', 'paint', place(rbox(14, 7, 12, 0, 0, 0, 1), 0, 2.5, 0, 0, 0, 0.28));
  for (const y of [-1.6, 1.6]) for (const z of [-3, 0, 3]) b.add('turret', 'dark', cylX(1.1, 1, 6.7, 2 + 3.5 + y + 1.8, z, 10, 0.28));
  return b.build('hailstorm', 17, { muzzle: new THREE.Vector3(7, 7, 0) });
}

function harvester(): ModelDef {
  const b = new Builder();
  tracks(b, 31, 7, 15, 8);
  b.add('body', 'white', rbox(28, 6, 21, -2, 5, 0, 1.4));
  b.add('body', 'paint', box(28.4, 1.6, 21.4, -2, 6.5, 0));
  b.add('body', 'dark', profile([14, 2, 19, 1, 21, 4, 19, 10, 14, 10], 22, 0, 0.4));
  for (let z = -9; z <= 9; z += 3) b.add('body', 'metal', box(3, 1.2, 1, 21, 1.2, z));
  // Hopper (open bin) behind the cab.
  b.add('body', 'paintDark', box(18, 7, 1.2, -6, 11, 8.5)).add('body', 'paintDark', box(18, 7, 1.2, -6, 11, -8.5));
  b.add('body', 'paintDark', box(1.2, 7, 17, -14.5, 11, 0)).add('body', 'paintDark', box(1.2, 7, 17, 2.5, 11, 0));
  b.add('body', 'dark', box(16, 0.8, 16, -6, 11, 0));
  b.add('body', 'paint', rbox(8, 8, 13, 8, 11, 0, 1.4));
  b.add('body', 'glass', box(1, 3, 10, 12.2, 14.5, 0));
  b.add('body', 'hazard', box(8.4, 1, 13.4, 8, 19, 0)).add('body', 'glowRed', sphere(0.8, 8, 20.6, 4, 6));
  b.add('body', 'metal', cyl(0.8, 0.8, 9, 4, 11, -7, 8)).add('body', 'dark', cyl(1, 1, 1, 4, 20, -7, 8));
  b.add('body', 'paintDark', box(26, 3, 0.7, -2, 3.6, 11.2)).add('body', 'paintDark', box(26, 3, 0.7, -2, 3.6, -11.2));
  b.add('body', 'glowRed', box(0.6, 0.8, 0.8, -15, 9, 9)).add('body', 'glowRed', box(0.6, 0.8, 0.8, -15, 9, -9));
  b.pivot('cargo', -6, 11.5, 0);
  b.add('cargo', 'ore', box(15, 6, 15, 0, 0, 0));
  return b.build('harvester', 20);
}

function mcv(): ModelDef {
  const b = new Builder();
  tracks(b, 38, 7, 17, 8);
  b.add('body', 'paint', rbox(38, 6, 22, -1, 5, 0, 1.4));
  b.add('body', 'concrete', rbox(17, 9, 19, -9, 11, 0, 1));
  b.add('body', 'paintDark', rbox(10, 7, 19, 4, 11, 0, 1));
  b.add('body', 'paint', rbox(8, 9, 20, 14, 11, 0, 1.6));
  b.add('body', 'glass', box(1, 3.5, 15, 18.2, 15, 0));
  b.add('body', 'hazard', box(38.4, 1.4, 22.4, -1, 9, 0));
  hullKit(b, 37, 11.4, 4, 11);
  for (const z of [-6, 0, 6]) b.add('body', 'grate', box(15, 0.6, 3.6, -9, 20, z));
  b.add('body', 'metal', cyl(1, 1.2, 8, 4, 18, -6, 8));
  b.add('body', 'glowRed', sphere(0.8, 14, 20.2, -7, 6));
  b.pivot('crane', -14, 20, 6);
  b.add('crane', 'hazard', cylX(1.2, 24, 0, 0, 0, 8, 0.12));
  b.add('crane', 'hazard', cyl(2, 2, 2.5, 0, -2.5, 0, 10));
  b.add('crane', 'dark', box(1, 6, 1, 23, -4, 0));
  return b.build('mcv', 24);
}

function infantry(kind: string): ModelDef {
  const b = new Builder();
  b.pivot('legL', 0, 6, 1.4).pivot('legR', 0, 6, -1.4);
  b.add('legL', 'uniform', rbox(2, 6, 1.9, 0, -6, 0, 0.6)).add('legL', 'dark', box(2.6, 1, 2.1, 0.4, -6, 0));
  b.add('legR', 'uniform', rbox(2, 6, 1.9, 0, -6, 0, 0.6)).add('legR', 'dark', box(2.6, 1, 2.1, 0.4, -6, 0));
  b.add('body', 'uniform', rbox(3.4, 5.6, 5.2, 0, 5.6, 0, 1.2));
  b.add('body', 'paint', rbox(3.8, 1.8, 5.6, 0, 9.2, 0, 0.8));
  b.add('body', 'dark', rbox(2.4, 4, 4, -2.6, 6.4, 0, 0.8));
  b.add('body', 'skin', sphere(1.5, 0.4, 12.8, 0, 10));
  const helmetMat: MatKey = kind === 'engineer' ? 'hazard' : kind === 'scout' ? 'paintDark' : 'paint';
  b.add('body', helmetMat, dome(1.9, 0.2, 13.1, 0, 12));
  b.add('body', 'uniform', box(1.4, 3.6, 1.4, 1.8, 7.4, 2.6)).add('body', 'uniform', box(1.4, 3.6, 1.4, 1.8, 7.4, -2.6));
  if (kind === 'rifle') b.add('body', 'dark', cylX(0.6, 8, 0.5, 8.4, -1.6, 8)).add('body', 'dark', box(3, 1.6, 1, 2.5, 7.4, -1.6));
  if (kind === 'rocket') b.add('body', 'uniform', cylX(1.3, 11, -4, 11.3, -2.4, 10)).add('body', 'dark', cylX(1.5, 1.5, 6.5, 11.3, -2.4, 10));
  if (kind === 'scout') b.add('body', 'dark', cylX(0.5, 4, 2, 8, -1.5, 8)).add('body', 'dark', box(1.4, 1, 2.4, 2, 12.6, 0));
  if (kind === 'engineer') b.add('body', 'glowRed', rbox(3, 2.4, 1.6, 2.4, 5.6, 3.2, 0.4)).add('body', 'metal', cylX(0.4, 4, 1.5, 8, -2.6, 6));
  return b.build(kind, 19, { muzzle: new THREE.Vector3(8, 8.4, -1.6), scale: 1.3 });
}

// ------------------------------------------------------------------ buildings
// Buildings face the camera's south (+Z) and east (+X) sides: doors, windows and
// signage go there. Main masses use neutral faction cladding; team colour is
// reserved for trims, roof bands and flags (as in classic RTS art).

type Clad = 'cladA' | 'cladB';
const cladOf = (f: FactionId | null): Clad => (f === 'esd' ? 'cladB' : 'cladA');

/** Concrete pad with a raised kerb, painted lines and corner bollards. */
function slab(b: Builder, w: number, h: number) {
  b.add('body', 'concrete', rbox(w - 2, 2.2, h - 2, 0, 0, 0, 0.8));
  b.add('body', 'concrete', box(w - 1, 3.2, 1.6, 0, 0, h / 2 - 1.3)).add('body', 'concrete', box(w - 1, 3.2, 1.6, 0, 0, -h / 2 + 1.3));
  b.add('body', 'concrete', box(1.6, 3.2, h - 1, w / 2 - 1.3, 0, 0)).add('body', 'concrete', box(1.6, 3.2, h - 1, -w / 2 + 1.3, 0, 0));
  b.add('body', 'white', box(w - 10, 0.4, 0.9, 0, 2.2, h / 2 - 5));
  for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) b.add('body', 'hazard', cyl(1.1, 1.1, 5, x * (w / 2 - 3), 0, z * (h / 2 - 3), 8));
}
/** Row of lit windows along the south (+Z) face of a block. */
function windowsZ(b: Builder, x0: number, x1: number, y: number, z: number, h = 3, step = 6, node: NodeKey = 'body') {
  for (let x = x0; x <= x1; x += step) {
    b.add(node, 'dark', box(step * 0.62, h + 0.8, 0.5, x, y - 0.4, z + 0.05));
    b.add(node, 'window', box(step * 0.5, h, 0.6, x, y, z + 0.2));
  }
}
/** Row of windows along the east (+X) face. */
function windowsX(b: Builder, z0: number, z1: number, y: number, x: number, h = 3, step = 6, node: NodeKey = 'body') {
  for (let z = z0; z <= z1; z += step) {
    b.add(node, 'dark', box(0.5, h + 0.8, step * 0.62, x + 0.05, y - 0.4, z));
    b.add(node, 'window', box(0.6, h, step * 0.5, x + 0.2, y, z));
  }
}
/** Rooftop air-handling unit. */
function vent(b: Builder, x: number, y: number, z: number, s = 1, clad: Clad = 'cladA') {
  b.add('body', clad, rbox(8 * s, 4 * s, 6 * s, x, y, z, 0.6));
  b.add('body', 'grate', cyl(2.2 * s, 2.2 * s, 0.6, x - 1.6 * s, y + 4 * s, z, 12));
  b.add('body', 'dark', box(2.4 * s, 0.6, 4.6 * s, x + 2.4 * s, y + 4 * s, z));
}
/** Thin railing around a roof rectangle. */
function railing(b: Builder, x0: number, z0: number, x1: number, z1: number, y: number) {
  const post = (x: number, z: number) => b.add('body', 'metal', box(0.5, 3, 0.5, x, y, z));
  for (let x = x0; x <= x1; x += 6) { post(x, z0); post(x, z1); }
  for (let z = z0; z <= z1; z += 6) { post(x0, z); post(x1, z); }
  b.add('body', 'metal', box(x1 - x0, 0.45, 0.45, (x0 + x1) / 2, y + 3, z0)).add('body', 'metal', box(x1 - x0, 0.45, 0.45, (x0 + x1) / 2, y + 3, z1));
  b.add('body', 'metal', box(0.45, 0.45, z1 - z0, x0, y + 3, (z0 + z1) / 2)).add('body', 'metal', box(0.45, 0.45, z1 - z0, x1, y + 3, (z0 + z1) / 2));
}
function antenna(b: Builder, x: number, y: number, z: number, h: number) {
  b.add('body', 'metal', cyl(0.35, 0.6, h, x, y, z, 6));
  b.add('body', 'metal', box(4, 0.3, 0.3, x, y + h * 0.75, z)).add('body', 'metal', box(0.3, 0.3, 4, x, y + h * 0.6, z));
  b.add('body', 'glowRed', sphere(0.9, x, y + h + 0.6, z, 6));
}
function ladder(b: Builder, x: number, y0: number, y1: number, z: number) {
  b.add('body', 'metal', box(0.4, y1 - y0, 0.4, x - 1.2, y0, z)).add('body', 'metal', box(0.4, y1 - y0, 0.4, x + 1.2, y0, z));
  for (let y = y0 + 1.5; y < y1; y += 2.5) b.add('body', 'metal', box(2.4, 0.3, 0.3, x, y, z));
}
/** Alternating hazard stripes along X. */
function hazardBand(b: Builder, x0: number, x1: number, y: number, z: number, h = 1.6) {
  let k = 0;
  for (let x = x0; x < x1; x += 3, k++) b.add('body', k % 2 ? 'dark' : 'hazard', box(Math.min(3, x1 - x), h, 0.7, x + 1.5, y, z));
}
function pipeRun(b: Builder, pts: [number, number, number][], r = 1.1) {
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay, az] = pts[i - 1], [bx, by, bz] = pts[i];
    const len = Math.hypot(bx - ax, by - ay, bz - az);
    const g = new THREE.CylinderGeometry(r, r, len, 8);
    g.translate(0, len / 2, 0);
    const dir = new THREE.Vector3(bx - ax, by - ay, bz - az).normalize();
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
    g.translate(ax, ay, az);
    b.add('body', 'metal', g);
    b.add('body', 'dark', sphere(r * 1.25, bx, by, bz, 8));
  }
}
function floodlight(b: Builder, x: number, z: number, h: number) {
  b.add('body', 'metal', cyl(0.4, 0.6, h, x, 0, z, 6));
  b.add('body', 'dark', box(2.4, 1.6, 1.6, x, h, z));
  b.add('body', 'lightGlow', box(1.8, 1, 0.4, x, h + 0.3, z + 0.9));
}
function emblemBox(b: Builder, x: number, y: number, z: number, s: number, f: FactionId | null) {
  b.add('body', 'paint', box(s, s, 0.5, x, y, z));
  if (f === 'esd') b.add('body', 'hazard', prism([-s * 0.3, 0, 0, -s * 0.35, s * 0.3, 0, 0, s * 0.35], 0.6, 0, 0).rotateX(Math.PI / 2).translate(x, y + s / 2, z + 0.3));
  else b.add('body', 'white', box(s * 0.5, s * 0.14, 0.6, x, y + s * 0.43, z + 0.1)).add('body', 'white', box(s * 0.14, s * 0.5, 0.6, x, y + s * 0.25, z + 0.1));
}

function hq(f: FactionId | null): ModelDef {
  const b = new Builder();
  const C = cladOf(f);
  slab(b, 96, 96);
  // Lower hall
  b.add('body', C, rbox(70, 18, 52, -4, 2.2, -8, 1.5));
  b.add('body', 'roof', box(70.4, 1.2, 52.4, -4, 20.2, -8));
  b.add('body', 'paint', box(70.8, 2.4, 52.8, -4, 16.5, -8));
  windowsZ(b, -34, 26, 9, 18.1, 3.4, 7);
  windowsX(b, -30, 14, 9, 31.1, 3.4, 7);
  // Entrance with canopy
  b.add('body', 'dark', box(14, 10, 1, -14, 2.2, 18.3));
  b.add('body', 'window', box(11, 7.5, 1.2, -14, 2.4, 18.5));
  b.add('body', C, box(20, 1.2, 7, -14, 12.5, 21));
  b.add('body', 'metal', cyl(0.5, 0.5, 10.5, -23, 2.2, 24, 6)).add('body', 'metal', cyl(0.5, 0.5, 10.5, -5, 2.2, 24, 6));
  // Upper command block
  b.add('body', C, rbox(36, 13, 28, -16, 21.4, -14, 1.2));
  b.add('body', 'roof', box(36.4, 1, 28.4, -16, 34.4, -14));
  windowsZ(b, -31, -1, 26, 0.1, 4, 6);
  windowsX(b, -24, -4, 26, 2.1, 4, 6);
  railing(b, -33, -27, 1, -1, 35.4);
  vent(b, -24, 35.4, -20, 1, C);
  vent(b, 22, 21.4, -24, 1.2, C);
  vent(b, 10, 21.4, -26, 0.9, C);
  if (f === 'esd') {
    b.add('body', C, prism([14, -30, 30, -30, 30, -6, 14, -6], 40, 21.4, 1));
    b.add('body', 'paint', prism([13.6, -30.4, 30.4, -30.4, 30.4, -5.6, 13.6, -5.6], 3, 52, 0.4));
    windowsZ(b, 16, 28, 44, -5.9, 3, 6);
    antenna(b, 22, 61.4, -18, 16);
  } else {
    b.add('body', C, cyl(13, 14, 8, 16, 21.4, -16, 20));
    b.add('body', 'paint', cyl(13.3, 13.3, 1.6, 16, 28.8, -16, 20));
    b.add('body', 'glass', dome(12.5, 16, 29.4, -16, 22));
    antenna(b, -30, 35.4, -24, 18);
  }
  emblemBox(b, -38.5, 11, 6, 8, f);
  // Helipad
  b.add('body', 'dark', cyl(12, 12, 0.6, 30, 2.2, 32, 24)).add('body', 'white', cyl(10.5, 10.5, 0.7, 30, 2.2, 32, 24)).add('body', 'dark', cyl(9.2, 9.2, 0.8, 30, 2.2, 32, 24));
  b.add('body', 'white', box(1.6, 0.9, 9, 26.5, 2.2, 32)).add('body', 'white', box(1.6, 0.9, 9, 33.5, 2.2, 32)).add('body', 'white', box(7, 0.9, 1.6, 30, 2.2, 32));
  hazardBand(b, -42, 12, 2.2, 38, 0.8);
  floodlight(b, -42, 40, 14); floodlight(b, 42, -42, 14);
  b.pivot('crane', -40, 22, 22);
  b.add('crane', 'hazard', cyl(2.5, 3, 30, 0, -20, 0, 8));
  b.add('crane', 'hazard', cylX(1.4, 34, 0, 10, 0, 6, -0.05));
  b.add('crane', 'dark', box(1, 9, 1, 32, 0, 0));
  return b.build(`hq-${f}`, 46);
}

function power(f: FactionId | null): ModelDef {
  const b = new Builder();
  const C = cladOf(f);
  slab(b, 64, 64);
  // Generator hall
  b.add('body', C, rbox(52, 12, 20, 0, 2.2, 15, 1.2));
  b.add('body', 'roof', box(52.4, 1, 20.4, 0, 14.2, 15));
  b.add('body', 'paint', box(52.8, 1.8, 20.8, 0, 11.4, 15));
  windowsZ(b, -21, 21, 6.5, 25.1, 2.6, 6);
  vent(b, -12, 15.2, 15, 0.8, C); vent(b, 12, 15.2, 15, 0.8, C);
  // Transformers with glowing insulators
  for (const x of [-22, -12]) {
    b.add('body', 'grate', box(7, 7, 6, x, 2.2, -24));
    for (const dx of [-2, 0, 2]) { b.add('body', 'white', cyl(0.5, 0.7, 4, x + dx, 9.2, -24, 6)); b.add('body', 'glow', sphere(0.6, x + dx, 13.4, -24, 6)); }
  }
  let smoke: THREE.Vector3[];
  if (f === 'esd') {
    for (const x of [-12, 12]) {
      b.add('body', 'concrete', cyl(5, 6.4, 36, x, 2.2, -8, 14));
      b.add('body', 'paint', cyl(5.2, 5.4, 3, x, 28, -8, 14)).add('body', 'white', cyl(5.15, 5.5, 3, x, 20, -8, 14));
      b.add('body', 'dark', cyl(3.8, 3.8, 0.6, x, 38.2, -8, 12));
      ladder(b, x + 6, 3, 34, -8);
    }
    pipeRun(b, [[-12, 8, -2], [-12, 8, 5], [12, 8, 5], [12, 8, -2]]);
    smoke = [new THREE.Vector3(-12, 40, -8), new THREE.Vector3(12, 40, -8)];
  } else {
    for (const x of [-13, 13]) {
      b.add('body', 'concrete', lathe([[11, 0], [9.5, 8], [7, 18], [7.5, 24], [8.5, 28], [7.6, 28], [6.4, 24], [6, 18], [0.1, 18]], x, 2.2, -8, 24));
      b.add('body', 'paint', place(new THREE.TorusGeometry(7.3, 0.7, 6, 24), x, 23, -8, Math.PI / 2));
    }
    smoke = [new THREE.Vector3(-13, 31, -8), new THREE.Vector3(13, 31, -8)];
  }
  floodlight(b, 28, 28, 12);
  return b.build(`power-${f}`, f === 'esd' ? 40 : 31, { smoke });
}

function refinery(f: FactionId | null): ModelDef {
  const b = new Builder();
  const C = cladOf(f);
  slab(b, 96, 96);
  for (const z of [-26, 2]) {
    b.add('body', C, cyl(12, 12, 26, -28, 2.2, z, 22));
    for (const y of [9, 17]) b.add('body', 'dark', cyl(12.25, 12.25, 0.8, -28, 2.2 + y, z, 22));
    b.add('body', 'paint', cyl(12.3, 12.3, 2.4, -28, 24, z, 22));
    b.add('body', 'metal', dome(12, -28, 28.2, z, 22));
    ladder(b, -15.6, 3, 28, z);
  }
  // Processing hall
  b.add('body', C, rbox(46, 22, 42, 16, 2.2, -14, 1.5));
  b.add('body', 'roof', box(46.4, 1.2, 42.4, 16, 24.2, -14));
  b.add('body', 'paint', box(46.8, 2.2, 42.8, 16, 20, -14));
  windowsZ(b, -2, 34, 13, 7.1, 3, 7);
  windowsX(b, -30, 2, 13, 39.1, 3, 7);
  b.add('body', 'dark', box(18, 12, 1, 18, 2.2, 7.3));
  hazardBand(b, 9, 27, 14.2, 7.6, 1.2);
  vent(b, 6, 25.4, -26, 1, C); vent(b, 26, 25.4, -28, 1, C);
  b.add('body', 'metal', cyl(3.4, 4.2, 30, 34, 25.4, -30, 12));
  b.add('body', 'dark', cyl(3.6, 3.6, 2, 34, 50, -30, 12));
  pipeRun(b, [[-16, 20, -12], [-6, 20, -12], [-6, 14, -6], [-7, 14, 6]]);
  // Ore conveyor from the dock to the hall
  b.add('body', 'grate', place(new THREE.BoxGeometry(8, 2, 30), 0, 9, 24, -0.45, 0, 0));
  b.add('body', 'ore', place(new THREE.BoxGeometry(5, 1.2, 28), 0, 10.4, 24, -0.45, 0, 0));
  // Dock pad
  b.add('body', 'dark', box(34, 0.8, 18, 0, 2.2, 34));
  hazardBand(b, -17, 17, 2.4, 43, 0.6);
  hazardBand(b, -17, 17, 2.4, 25, 0.6);
  floodlight(b, -40, 40, 14); floodlight(b, 40, 40, 14);
  return b.build(`refinery-${f}`, 34, { smoke: [new THREE.Vector3(34, 53, -30)] });
}

function barracks(f: FactionId | null): ModelDef {
  const b = new Builder();
  const C = cladOf(f);
  slab(b, 64, 64);
  if (f === 'esd') {
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      b.add('body', 'sand', rbox(8, 4, 5, Math.cos(a) * 26, 2.2, Math.sin(a) * 26, 1.8, -a + Math.PI / 2));
    }
    b.add('body', 'concrete', profile([-20, 0, 20, 0, 20, 12, 12, 17, -20, 17], 34, 0, 1.2).translate(0, 2.2, -2));
    b.add('body', 'paint', box(41, 1.6, 35, 0, 13, -2));
    b.add('body', 'dark', box(12, 3, 1, -6, 7, 15.2));
    b.add('body', 'dark', box(10, 8, 1, 10, 2.2, 15.2));
    // Watchtower
    for (const [x, z] of [[18, -20], [24, -20], [18, -14], [24, -14]]) b.add('body', 'wood', box(1, 20, 1, x, 2.2, z));
    b.add('body', C, box(9, 1, 9, 21, 22, -17)).add('body', 'roof', profile([-5, 0, 5, 0, 0, 4], 9, 0, 0.2).translate(21, 26, -17));
    b.add('body', 'sand', box(9, 2.5, 1, 21, 23, -12.6));
  } else {
    b.add('body', C, rbox(44, 13, 30, -2, 2.2, -4, 1));
    b.add('body', 'roof', place(profile([-23, 0, 23, 0, 0, 10], 32, 0, 0.6), -2, 15.2, -4, 0, Math.PI / 2, 0));
    b.add('body', 'paint', box(46, 1.4, 32, -2, 14.6, -4));
    windowsZ(b, -20, 16, 8, 11.1, 2.6, 6);
    windowsX(b, -14, 6, 8, 20.1, 2.6, 6);
    b.add('body', 'dark', box(8, 8, 1, -2, 2.2, 11.3));
    for (let i = 0; i < 7; i++) b.add('body', 'sand', rbox(6, 3.4, 4, -20 + i * 6.4, 2.2, 22, 1.4));
  }
  b.add('body', 'metal', cyl(0.6, 0.6, 32, 26, 2.2, 24, 6));
  b.add('body', 'paint', box(11, 6.5, 0.4, 31.5, 27, 24));
  floodlight(b, -26, 26, 11);
  return b.build(`barracks-${f}`, 26);
}

function factory(f: FactionId | null): ModelDef {
  const b = new Builder();
  const C = cladOf(f);
  slab(b, 96, 96);
  // Hangar walls and arched roof (doors face +Z).
  b.add('body', C, box(60, 16, 62, -8, 2.2, -8));
  const arch = new THREE.CylinderGeometry(30, 30, 62, 28, 1, false, Math.PI / 2, Math.PI);
  arch.rotateX(Math.PI / 2);
  b.add('body', 'roof', place(arch, -8, 18, -8, 0, 0, 0, 1, 0.62, 1));
  for (let z = -36; z <= 20; z += 8) b.add('body', 'paint', place(new THREE.TorusGeometry(30.3, 0.8, 4, 28, Math.PI), -8, 18, z + 3, 0, 0, 0, 1, 0.62, 1));
  // Front wall (gable) with large door
  b.add('body', C, place(new THREE.CircleGeometry(30, 28, 0, Math.PI), -8, 18, 23.1, 0, 0, 0, 1, 0.62, 1));
  b.add('body', 'dark', box(36, 20, 1, -8, 2.2, 23.4));
  for (let y = 4; y < 22; y += 2.5) b.add('body', 'grate', box(35, 0.5, 1.3, -8, 2.2 + y, 23.6));
  hazardBand(b, -27, 11, 22.4, 23.8, 1.6);
  emblemBox(b, 13, 12, 23.4, 7, f);
  windowsX(b, -34, 16, 11, 22.1, 3, 7);
  // Control tower
  b.add('body', C, rbox(16, 34, 16, 36, 2.2, -26, 1.2));
  b.add('body', 'window', box(16.4, 4.5, 16.4, 36, 28, -26));
  b.add('body', 'roof', box(17, 1.2, 17, 36, 36.2, -26));
  antenna(b, 38, 37.4, -28, 12);
  windowsZ(b, 31, 41, 12, -17.9, 3, 5);
  // Exhaust stacks and gantry over the yard
  b.add('body', 'metal', cyl(2, 2.4, 14, 20, 30, -34, 10)).add('body', 'metal', cyl(2, 2.4, 14, 12, 30, -34, 10));
  b.add('body', 'hazard', box(2, 18, 2, -32, 2.2, 40)).add('body', 'hazard', box(2, 18, 2, 16, 2.2, 40)).add('body', 'hazard', box(50, 2.5, 2.5, -8, 20, 40));
  b.add('body', 'dark', box(30, 0.8, 16, -8, 2.2, 32));
  floodlight(b, 42, 42, 14);
  return b.build(`factory-${f}`, 38);
}

function radar(f: FactionId | null): ModelDef {
  const b = new Builder();
  const C = cladOf(f);
  slab(b, 64, 64);
  b.add('body', C, rbox(44, 12, 26, 0, 2.2, 12, 1.2));
  b.add('body', 'roof', box(44.4, 1, 26.4, 0, 14.2, 12));
  b.add('body', 'paint', box(44.8, 1.6, 26.8, 0, 11.6, 12));
  windowsZ(b, -18, 18, 7, 25.1, 2.6, 6);
  windowsX(b, 2, 22, 7, 22.1, 2.6, 6);
  vent(b, 12, 15.2, 12, 0.8, C);
  // Lattice mast
  for (const [x, z] of [[-4, -12], [4, -12], [-4, -4], [4, -4]]) b.add('body', 'metal', box(1, 28, 1, x, 2.2, z));
  for (let y = 6; y < 30; y += 6) {
    b.add('body', 'metal', box(9, 0.6, 0.6, 0, y, -12)).add('body', 'metal', box(9, 0.6, 0.6, 0, y, -4));
    b.add('body', 'metal', box(0.6, 0.6, 9, -4, y, -8)).add('body', 'metal', box(0.6, 0.6, 9, 4, y, -8));
  }
  b.add('body', C, box(11, 3, 11, 0, 30, -8));
  b.pivot('dish', 0, 37, -8);
  const d = new THREE.SphereGeometry(15, 22, 8, 0, Math.PI * 2, 0, 0.9);
  d.scale(1, 0.5, 1);
  d.rotateZ(Math.PI / 2 + 0.5);
  b.add('dish', 'white', d);
  b.add('dish', 'metal', cylX(0.6, 11, 0, 0, 0, 6, 0.5));
  b.add('dish', 'glowRed', sphere(1, 9.4, 4.6, 0, 6));
  b.add('dish', 'metal', cyl(2, 2, 3, 0, -3, 0, 10));
  return b.build(`radar-${f}`, 46);
}

function tech(f: FactionId | null): ModelDef {
  const b = new Builder();
  const C = cladOf(f);
  slab(b, 96, 96);
  b.add('body', C, rbox(78, 14, 70, 0, 2.2, 0, 2.5));
  b.add('body', 'paint', box(78.6, 2, 70.6, 0, 12, 0));
  b.add('body', 'roof', box(78.4, 1, 70.4, 0, 16.2, 0));
  windowsZ(b, -34, 34, 7, 35.1, 2.8, 6);
  windowsX(b, -30, 30, 7, 39.1, 2.8, 6);
  b.add('body', 'concrete', rbox(62, 6, 54, 0, 17.2, -2, 2));
  b.add('body', 'metal', cyl(24, 24, 2, 0, 23.2, -4, 32));
  b.add('body', 'glass', dome(23, 0, 25, -4, 32));
  for (const [x, z] of [[-32, -30], [32, -30], [-32, 28], [32, 28]]) {
    b.add('body', 'metal', cyl(0.8, 1.6, 22, x, 17.2, z, 8));
    b.add('body', 'lightGlow', sphere(1.6, x, 40, z, 8));
  }
  for (const z of [-20, -8]) { b.add('body', 'white', cyl(4, 4, 10, 36, 17.2, z, 14)); b.add('body', 'metal', dome(4, 36, 27.2, z, 14)); }
  vent(b, -26, 23.2, 20, 1, C);
  emblemBox(b, -26, 6, 35.4, 7, f);
  return b.build(`tech-${f}`, 48);
}

function pillbox(): ModelDef {
  const b = new Builder();
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    b.add('body', 'sand', rbox(7, 3.6, 4, Math.cos(a) * 13, 0, Math.sin(a) * 13, 1.5, -a + Math.PI / 2));
  }
  b.add('body', 'concrete', lathe([[11, 0], [10.5, 6], [8, 10], [0.1, 11]], 0, 0, 0, 8));
  b.add('body', 'dark', box(12, 1.6, 4, 0, 6, 6.6)).add('body', 'dark', box(4, 1.6, 12, 6.6, 6, 0));
  b.add('body', 'paint', cyl(3, 3, 1, 0, 10.4, 0, 8));
  antenna(b, -4, 10, -4, 8);
  b.pivot('turret', 0, 0, 0);
  return b.build('pillbox', 12);
}

function turret(): ModelDef {
  const b = new Builder();
  b.add('body', 'concrete', prism([-14, -6, -6, -14, 6, -14, 14, -6, 14, 6, 6, 14, -6, 14, -14, 6], 5, 0, 0.8));
  b.add('body', 'hazard', prism([-12, -5, -5, -12, 5, -12, 12, -5, 12, 5, 5, 12, -5, 12, -12, 5], 0.6, 5, 0));
  b.add('body', 'metal', cyl(7, 8, 3, 0, 5, 0, 12));
  b.pivot('turret', 0, 8, 0);
  b.add('turret', 'paint', rbox(13, 6, 11, -1, 0, 0, 1.6));
  b.add('turret', 'paintDark', box(4, 4, 8, 4, 1, 0));
  b.add('turret', 'dark', box(4, 2, 3, -6, 6, 2));
  b.pivot('barrel', 5, 3.2, 0, 'turret');
  b.add('barrel', 'metal', cylX(1.2, 13));
  b.add('barrel', 'dark', cylX(1.8, 2.5, 11));
  return b.build('turret', 15, { muzzle: new THREE.Vector3(14, 0, 0) });
}

function sentinel(): ModelDef {
  const b = new Builder();
  slab(b, 64, 64);
  b.add('body', 'concrete', prism([-26, -14, -14, -26, 14, -26, 26, -14, 26, 14, 14, 26, -14, 26, -26, 14], 10, 2.2, 1.2));
  b.add('body', 'paint', prism([-25, -13, -13, -25, 13, -25, 25, -13, 25, 13, 13, 25, -13, 25, -25, 13], 1.4, 12.2, 0.2));
  for (const z of [-22, 22]) for (const x of [-10, 0, 10]) b.add('body', 'dark', box(5, 2, 0.8, x, 6, z * 1.08));
  b.pivot('turret', 0, 12.4, 0);
  b.add('turret', 'metal', cyl(13, 14, 3, 0, 0, 0, 16));
  b.add('turret', 'paint', prism([-14, -10, 6, -11, 14, -5, 14, 5, 6, 11, -14, 10], 10, 3, 1.2));
  b.add('turret', 'dark', box(6, 2, 8, -9, 13, 0));
  b.pivot('barrel', 13, 8, 0, 'turret');
  b.add('barrel', 'metal', cylX(1.7, 26, 0, 0, 4)).add('barrel', 'metal', cylX(1.7, 26, 0, 0, -4));
  b.add('barrel', 'dark', cylX(2.5, 3.5, 23, 0, 4)).add('barrel', 'dark', cylX(2.5, 3.5, 23, 0, -4));
  return b.build('sentinel', 22, { muzzle: new THREE.Vector3(27, 0, 0) });
}

function arcPylon(): ModelDef {
  const b = new Builder();
  slab(b, 64, 64);
  b.add('body', 'concrete', prism([-18, -10, -10, -18, 10, -18, 18, -10, 18, 10, 10, 18, -10, 18, -18, 10], 6, 2.2, 1));
  b.add('body', 'metal', lathe([[14, 0], [11, 6], [7, 14], [5, 40], [6.5, 44], [0.1, 44]], 0, 8, 0, 10));
  for (let y = 20; y < 48; y += 5) b.add('body', 'copper', place(new THREE.TorusGeometry(7 - (y - 20) * 0.05, 1.1, 6, 18), 0, y, 0, Math.PI / 2));
  b.add('body', 'paint', box(34, 1.6, 34, 0, 8.2, 0));
  for (const [x, z] of [[-14, 14], [14, 14], [14, -14], [-14, -14]]) b.add('body', 'white', cyl(1, 1.4, 6, x, 8.2, z, 8)).add('body', 'glow', sphere(0.9, x, 14.6, z, 6));
  b.pivot('orb', 0, 58, 0);
  b.add('orb', 'lightGlow', sphere(6, 0, 0, 0, 16));
  return b.build('arcpylon', 64);
}

function derrick(): ModelDef {
  const b = new Builder();
  slab(b, 64, 64);
  for (const [x, z] of [[-16, -14], [-16, 12]]) {
    b.add('body', 'white', cyl(9, 9, 16, x, 2.2, z, 18));
    b.add('body', 'dark', cyl(9.2, 9.2, 0.8, x, 10, z, 18));
    b.add('body', 'metal', dome(9, x, 18.2, z, 18));
    ladder(b, x + 9.4, 3, 18, z);
  }
  b.add('body', 'dark', box(26, 3, 12, 10, 2.2, 0));
  b.add('body', 'metal', box(2, 24, 2, 6, 5, 3)).add('body', 'metal', box(2, 24, 2, 6, 5, -3));
  pipeRun(b, [[-7, 5, -14], [2, 5, -14], [2, 5, 0]]);
  for (let x = -28; x <= 28; x += 7) b.add('body', 'metal', box(0.5, 6, 0.5, x, 2.2, 29));
  b.add('body', 'metal', box(56, 0.4, 0.4, 0, 7.6, 29));
  b.pivot('arm', 6, 28, 0);
  b.add('arm', 'hazard', box(34, 3, 3, 0, -1.5, 0));
  b.add('arm', 'dark', place(new THREE.CylinderGeometry(4, 4, 4, 12, 1, false, 0, Math.PI), 17, 0, 0, Math.PI / 2, 0, Math.PI / 2));
  return b.build('derrick', 32, { smoke: [new THREE.Vector3(-16, 21, -14)] });
}

// ------------------------------------------------------------------ registry

const cache = new Map<string, ModelDef>();

/** Model key for an entity type (some structures differ by faction). */
export function modelKey(type: string, faction: FactionId | null): string {
  if (['hq', 'power', 'barracks', 'refinery', 'factory', 'radar', 'tech'].includes(type)) return `${type}-${faction}`;
  return type;
}

export function getModel(type: string, faction: FactionId | null): ModelDef {
  const key = modelKey(type, faction);
  let m = cache.get(key);
  if (m) return m;
  switch (type) {
    case 'rifle': case 'rocket': case 'engineer': case 'scout': m = infantry(type); break;
    case 'lighttank': m = lightTank(); break;
    case 'heavytank': m = heavyTank(); break;
    case 'raider': m = raider(); break;
    case 'mauler': m = mauler(); break;
    case 'artillery': m = artillery(); break;
    case 'hailstorm': m = hailstorm(); break;
    case 'harvester': m = harvester(); break;
    case 'mcv': m = mcv(); break;
    case 'hq': m = hq(faction); break;
    case 'power': m = power(faction); break;
    case 'refinery': m = refinery(faction); break;
    case 'barracks': m = barracks(faction); break;
    case 'factory': m = factory(faction); break;
    case 'radar': m = radar(faction); break;
    case 'tech': m = tech(faction); break;
    case 'pillbox': m = pillbox(); break;
    case 'turret': m = turret(); break;
    case 'sentinel': m = sentinel(); break;
    case 'arcpylon': m = arcPylon(); break;
    case 'derrick': m = derrick(); break;
    default: m = lightTank();
  }
  m.key = key;
  cache.set(key, m);
  return m;
}

/** Footprint size of a building in px (for effects). */
export function footprint(type: string) {
  const d = BUILDINGS[type];
  return d ? { w: d.w * TILE, h: d.h * TILE } : { w: TILE, h: TILE };
}
