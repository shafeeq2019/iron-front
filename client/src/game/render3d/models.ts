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
  | 'skin' | 'uniform' | 'sand' | 'copper' | 'ore' | 'wood' | 'white' | 'lightGlow';

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

function lightTank(): ModelDef {
  const b = new Builder();
  tracks(b, 29, 5.5, 13, 7);
  b.add('body', 'paint', profile([-14, 4, 12, 4, 15.5, 7.5, 11, 11, -11, 11, -14.5, 9], 15));
  b.add('body', 'paintDark', box(26, 1.2, 6, -1, 6.6, 9.3)).add('body', 'paintDark', box(26, 1.2, 6, -1, 6.6, -9.3));
  b.add('body', 'dark', box(6, 1, 9, -9.5, 11, 0));
  b.pivot('turret', -1, 11, 0);
  b.add('turret', 'paint', place(new THREE.CylinderGeometry(5.6, 6.8, 4.6, 10), 0, 2.3, 0));
  b.add('turret', 'paintDark', box(4, 3.2, 6, 4.6, 0.6, 0));
  b.add('turret', 'metal', cyl(1.5, 1.5, 1.2, -2.2, 4.6, 1.8, 10));
  b.add('turret', 'dark', box(2, 1.6, 1.2, -5, 4.2, -3.4));
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
  b.pivot('turret', -2, 13, 0);
  b.add('turret', 'paint', prism([-9, -8, 5, -8, 9, -4, 9, 4, 5, 8, -9, 8], 6.5, 0, 1));
  b.add('turret', 'paintDark', box(5, 4, 10, 8, 1, 0));
  b.add('turret', 'metal', cyl(2, 2, 1.6, -4, 6.5, -3, 10));
  b.add('turret', 'dark', box(3, 2, 2, -7, 6.5, 4));
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
  b.pivot('turret', -2, 12.5, 0);
  b.add('turret', 'paint', prism([-8, -6, 3, -7, 8, -3, 8, 3, 3, 7, -8, 6], 6, 0, 0.8));
  b.add('turret', 'dark', box(3, 1.4, 3, -5, 6, 2));
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
  b.pivot('turret', -3, 9.5, 0);
  b.add('turret', 'paint', rbox(13, 6, 11, -1, 0, 0, 1.4));
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

function slab(b: Builder, w: number, h: number) {
  b.add('body', 'concrete', rbox(w - 3, 2.4, h - 3, 0, 0, 0, 1));
  b.add('body', 'dark', box(w - 1, 0.6, h - 1, 0, 0, 0));
}

function hq(f: FactionId | null): ModelDef {
  const b = new Builder();
  slab(b, 96, 96);
  b.add('body', 'paint', rbox(74, 20, 54, -2, 2.4, -6, 2.5));
  b.add('body', 'paintDark', rbox(76, 2.5, 56, -2, 22, -6, 1));
  b.add('body', 'concrete', rbox(32, 12, 26, -18, 24, -10, 1.5));
  b.add('body', 'dark', box(30, 1, 24, -18, 36, -10));
  if (f === 'esd') {
    b.add('body', 'paint', prism([16, -24, 34, -24, 34, 4, 16, 4], 34, 22, 1));
    b.add('body', 'glowRed', box(16, 1.2, 1, 25, 46, 4.6));
    b.add('body', 'metal', cyl(0.7, 0.7, 18, 25, 56, -10, 6)).add('body', 'glowRed', sphere(1.2, 25, 74, -10, 8));
  } else {
    b.add('body', 'glass', dome(13, 22, 24, -8, 20));
    b.add('body', 'metal', cyl(13.5, 13.5, 2, 22, 22.5, -8, 20));
    b.add('body', 'metal', cyl(0.6, 0.6, 16, -30, 36, -24, 6)).add('body', 'glowRed', sphere(1.1, -30, 52, -24, 8));
  }
  // Helipad
  b.add('body', 'dark', cyl(12, 12, 0.6, 28, 2.4, 30, 24)).add('body', 'white', cyl(10, 10, 0.7, 28, 2.4, 30, 24)).add('body', 'dark', cyl(8.6, 8.6, 0.8, 28, 2.4, 30, 24));
  b.add('body', 'hazard', box(60, 0.8, 5, -12, 2.4, 40));
  b.pivot('crane', -40, 22, 20);
  b.add('crane', 'hazard', cyl(2.5, 3, 30, 0, -20, 0, 8));
  b.add('crane', 'hazard', cylX(1.4, 34, 0, 10, 0, 6, -0.05));
  b.add('crane', 'dark', box(1, 9, 1, 32, 0, 0));
  return b.build(`hq-${f}`, 46, { smoke: [] });
}

function power(f: FactionId | null): ModelDef {
  const b = new Builder();
  slab(b, 64, 64);
  b.add('body', 'concrete', rbox(54, 12, 22, 0, 2.4, 14, 1.4));
  b.add('body', 'paint', box(54.5, 2, 22.5, 0, 9, 14));
  b.add('body', 'glow', box(6, 6, 1, -12, 4.5, 25.2)).add('body', 'glow', box(6, 6, 1, 12, 4.5, 25.2));
  let smoke: THREE.Vector3[];
  if (f === 'esd') {
    for (const x of [-14, 14]) {
      b.add('body', 'metal', cyl(5, 6, 34, x, 2.4, -10, 14));
      b.add('body', 'paint', cyl(5.2, 5.4, 3, x, 26, -10, 14)).add('body', 'white', cyl(5.15, 5.5, 3, x, 18, -10, 14));
      b.add('body', 'dark', cyl(3.6, 3.6, 0.5, x, 36.2, -10, 12));
    }
    smoke = [new THREE.Vector3(-14, 38, -10), new THREE.Vector3(14, 38, -10)];
  } else {
    for (const x of [-14, 14]) {
      b.add('body', 'concrete', lathe([[11, 0], [9.5, 8], [7, 18], [7.5, 24], [8.5, 28], [7.6, 28], [6.4, 24], [6, 18], [0.1, 18]], x, 2.4, -10, 22));
    }
    smoke = [new THREE.Vector3(-14, 31, -10), new THREE.Vector3(14, 31, -10)];
  }
  b.add('body', 'metal', cylX(1.4, 20, -10, 8, 3, 8));
  return b.build(`power-${f}`, f === 'esd' ? 38 : 31, { smoke });
}

function refinery(): ModelDef {
  const b = new Builder();
  slab(b, 96, 96);
  for (const z of [-24, 4]) {
    b.add('body', 'white', cyl(12, 12, 26, -26, 2.4, z, 20));
    b.add('body', 'paint', cyl(12.2, 12.2, 3, -26, 18, z, 20));
    b.add('body', 'metal', dome(12, -26, 28.4, z, 20));
  }
  b.add('body', 'paint', rbox(46, 20, 42, 18, 2.4, -14, 2));
  b.add('body', 'paintDark', rbox(47, 2, 43, 18, 21, -14, 1));
  b.add('body', 'dark', box(18, 10, 1, 18, 2.4, 7.4));
  b.add('body', 'metal', cyl(3.4, 4, 30, 32, 22, -28, 12));
  b.add('body', 'metal', cylX(2, 22, -14, 14, -10, 10));
  b.add('body', 'hazard', box(40, 0.8, 24, 0, 2.4, 32));
  b.add('body', 'dark', box(30, 1, 16, 0, 2.6, 32));
  b.add('body', 'ore', box(12, 3, 8, 26, 22.8, -14));
  return b.build('refinery', 32, { smoke: [new THREE.Vector3(32, 53, -28)] });
}

function barracks(f: FactionId | null): ModelDef {
  const b = new Builder();
  slab(b, 64, 64);
  if (f === 'esd') {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      b.add('body', 'sand', rbox(9, 4, 5, Math.cos(a) * 25, 2.4, Math.sin(a) * 25, 1.8, -a + Math.PI / 2));
    }
    b.add('body', 'paint', profile([-20, 0, 20, 0, 20, 12, 12, 18, -20, 18], 34, 0, 1.2));
  } else {
    b.add('body', 'uniform', rbox(44, 12, 34, 0, 2.4, -2, 1));
    b.add('body', 'paint', place(profile([-23, 0, 23, 0, 0, 12], 36, 0, 0.6), 0, 14.4, -2, 0, Math.PI / 2, 0));
  }
  b.add('body', 'dark', box(10, 8, 1, 0, 2.4, 16));
  b.add('body', 'metal', cyl(0.6, 0.6, 30, 24, 2.4, -22, 6));
  b.add('body', 'paint', box(10, 6, 0.6, 29, 26, -22));
  return b.build(`barracks-${f}`, 26);
}

function factory(): ModelDef {
  const b = new Builder();
  slab(b, 96, 96);
  // Arched hangar roof running along Z (front door faces +Z, the exit side).
  const arch = new THREE.CylinderGeometry(30, 30, 64, 24, 1, false, Math.PI / 2, Math.PI);
  arch.rotateX(Math.PI / 2);
  b.add('body', 'paint', place(arch, -6, 16, -6, 0, 0, 0, 1, 0.7, 1));
  for (let z = -34; z <= 22; z += 8) b.add('body', 'paintDark', place(new THREE.TorusGeometry(30.3, 0.7, 4, 24, Math.PI), -6, 16, z + 4, 0, 0, 0, 1, 0.7, 1));
  b.add('body', 'concrete', box(60, 14, 64, -6, 2.4, -6));
  b.add('body', 'dark', box(34, 18, 1.2, -6, 2.4, 26.2));
  b.add('body', 'hazard', box(38, 2, 1.4, -6, 20, 26.3));
  b.add('body', 'concrete', rbox(18, 34, 18, 34, 2.4, -24, 1.4));
  b.add('body', 'glass', box(18.4, 4, 14, 34, 28, -24));
  b.add('body', 'hazard', box(30, 0.8, 18, -6, 2.4, 38));
  b.add('body', 'glowRed', sphere(1.2, 34, 37, -24, 8));
  return b.build('factory', 38);
}

function radar(): ModelDef {
  const b = new Builder();
  slab(b, 64, 64);
  b.add('body', 'concrete', rbox(44, 12, 30, 0, 2.4, 8, 1.4));
  b.add('body', 'paint', box(44.5, 2, 30.5, 0, 11, 8));
  b.add('body', 'metal', cyl(2.2, 3.4, 20, 0, 13, -6, 10));
  b.pivot('dish', 0, 34, -6);
  const d = new THREE.SphereGeometry(15, 20, 8, 0, Math.PI * 2, 0, 0.9);
  d.scale(1, 0.5, 1);
  d.rotateZ(Math.PI / 2 + 0.5);
  b.add('dish', 'white', d);
  b.add('dish', 'metal', cylX(0.6, 11, 0, 0, 0, 6, 0.5));
  b.add('dish', 'glowRed', sphere(1, 9.4, 4.6, 0, 6));
  return b.build('radar', 44);
}

function tech(): ModelDef {
  const b = new Builder();
  slab(b, 96, 96);
  b.add('body', 'paint', rbox(78, 14, 72, 0, 2.4, 0, 3));
  b.add('body', 'concrete', rbox(64, 6, 58, 0, 16, -2, 2));
  b.add('body', 'glass', dome(22, 0, 22, -4, 28));
  for (const [x, z] of [[-30, -28], [30, -28], [-30, 26], [30, 26]]) {
    b.add('body', 'metal', cyl(0.8, 1.6, 22, x, 16, z, 8));
    b.add('body', 'lightGlow', sphere(1.6, x, 39, z, 8));
  }
  return b.build('tech', 46);
}

function pillbox(): ModelDef {
  const b = new Builder();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.add('body', 'sand', rbox(7, 3.4, 4, Math.cos(a) * 13, 0, Math.sin(a) * 13, 1.5, -a + Math.PI / 2));
  }
  b.add('body', 'concrete', lathe([[11, 0], [10.5, 6], [8, 10], [0.1, 11]], 0, 0, 0, 8));
  b.add('body', 'dark', box(12, 1.6, 4, 0, 6, 6.6));
  b.pivot('turret', 0, 0, 0);
  return b.build('pillbox', 12);
}

function turret(): ModelDef {
  const b = new Builder();
  b.add('body', 'concrete', prism([-14, -6, -6, -14, 6, -14, 14, -6, 14, 6, 6, 14, -6, 14, -14, 6], 5, 0, 0.8));
  b.add('body', 'metal', cyl(7, 8, 3, 0, 5, 0, 12));
  b.pivot('turret', 0, 8, 0);
  b.add('turret', 'paint', rbox(13, 6, 11, -1, 0, 0, 1.6));
  b.add('turret', 'paintDark', box(4, 4, 8, 4, 1, 0));
  b.pivot('barrel', 5, 3.2, 0, 'turret');
  b.add('barrel', 'metal', cylX(1.2, 13));
  b.add('barrel', 'dark', cylX(1.8, 2.5, 11));
  return b.build('turret', 15, { muzzle: new THREE.Vector3(14, 0, 0) });
}

function sentinel(): ModelDef {
  const b = new Builder();
  slab(b, 64, 64);
  b.add('body', 'concrete', prism([-26, -14, -14, -26, 14, -26, 26, -14, 26, 14, 14, 26, -14, 26, -26, 14], 10, 2.4, 1.2));
  b.add('body', 'paintDark', box(40, 1.2, 4, 0, 12.4, 22));
  b.pivot('turret', 0, 12.4, 0);
  b.add('turret', 'metal', cyl(13, 14, 3, 0, 0, 0, 16));
  b.add('turret', 'paint', prism([-14, -10, 6, -11, 14, -5, 14, 5, 6, 11, -14, 10], 10, 3, 1.2));
  b.pivot('barrel', 13, 8, 0, 'turret');
  b.add('barrel', 'metal', cylX(1.7, 26, 0, 0, 4)).add('barrel', 'metal', cylX(1.7, 26, 0, 0, -4));
  b.add('barrel', 'dark', cylX(2.5, 3.5, 23, 0, 4)).add('barrel', 'dark', cylX(2.5, 3.5, 23, 0, -4));
  return b.build('sentinel', 22, { muzzle: new THREE.Vector3(27, 0, 0) });
}

function arcPylon(): ModelDef {
  const b = new Builder();
  slab(b, 64, 64);
  b.add('body', 'metal', lathe([[16, 0], [12, 6], [7, 14], [5, 40], [6.5, 44], [0.1, 44]], 0, 2.4, 0, 8));
  for (let y = 14; y < 42; y += 5) b.add('body', 'copper', place(new THREE.TorusGeometry(7 - (y - 14) * 0.05, 1.1, 6, 16), 0, y, 0, Math.PI / 2));
  b.add('body', 'paint', box(30, 2, 30, 0, 2.4, 0));
  b.pivot('orb', 0, 52, 0);
  b.add('orb', 'lightGlow', sphere(6, 0, 0, 0, 16));
  return b.build('arcpylon', 58);
}

function derrick(): ModelDef {
  const b = new Builder();
  slab(b, 64, 64);
  for (const [x, z] of [[-16, -14], [-16, 12]]) {
    b.add('body', 'paint', cyl(9, 9, 16, x, 2.4, z, 18));
    b.add('body', 'metal', dome(9, x, 18.4, z, 18));
  }
  b.add('body', 'dark', box(26, 3, 12, 10, 2.4, 0));
  b.add('body', 'metal', box(2, 24, 2, 6, 5, 3)).add('body', 'metal', box(2, 24, 2, 6, 5, -3));
  b.pivot('arm', 6, 28, 0);
  b.add('arm', 'hazard', box(34, 3, 3, 0, -1.5, 0));
  b.add('arm', 'dark', place(new THREE.CylinderGeometry(4, 4, 4, 12, 1, false, 0, Math.PI), 17, 0, 0, Math.PI / 2, 0, Math.PI / 2));
  return b.build('derrick', 32, { smoke: [new THREE.Vector3(-16, 21, -14)] });
}

// ------------------------------------------------------------------ registry

const cache = new Map<string, ModelDef>();

/** Model key for an entity type (some structures differ by faction). */
export function modelKey(type: string, faction: FactionId | null): string {
  if (type === 'hq' || type === 'power' || type === 'barracks') return `${type}-${faction}`;
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
    case 'refinery': m = refinery(); break;
    case 'barracks': m = barracks(faction); break;
    case 'factory': m = factory(); break;
    case 'radar': m = radar(); break;
    case 'tech': m = tech(); break;
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
