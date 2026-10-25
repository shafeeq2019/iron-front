import * as THREE from 'three';
import { materials } from './materials';
import type { MatKey, ModelDef, NodeKey } from './models';

/** Per-instance animation state for a model. */
export interface InstanceState {
  x: number;
  y: number;
  /** Ground height. */
  h: number;
  angle: number;
  turret: number;
  /** 0..1 construction (vertical scale). */
  built: number;
  recoil: number;
  /** Leg swing (radians) for infantry. */
  swing: number;
  bob: number;
  /** Generic animation clock (seconds) for dishes, pumps, cranes. */
  t: number;
  pulse: number;
  cargo: number;
  color: THREE.Color;
}

const PAINTED: MatKey[] = ['paint', 'paintDark'];

interface Pool {
  model: ModelDef;
  meshes: { node: NodeKey; mat: MatKey; mesh: THREE.InstancedMesh }[];
  count: number;
  capacity: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

/** Renders every model as instanced meshes: one draw call per (model, node, material). */
export class Entities3D {
  readonly group = new THREE.Group();
  private pools = new Map<string, Pool>();
  private nodeM = new Map<NodeKey, THREE.Matrix4>();
  instances = 0;

  constructor(private shadows: boolean) {}

  private pool(model: ModelDef): Pool {
    let p = this.pools.get(model.key);
    if (!p) {
      p = { model, meshes: [], count: 0, capacity: 0 };
      this.pools.set(model.key, p);
      this.grow(p, 16);
    }
    return p;
  }

  private grow(p: Pool, capacity: number) {
    const mats = materials();
    const old = p.meshes;
    for (const m of old) this.group.remove(m.mesh);
    p.meshes = p.model.parts.map(({ node, mat, geo }, k) => {
      const mesh = new THREE.InstancedMesh(geo, mats[mat], capacity);
      const prev = old[k]?.mesh;
      if (prev) {
        mesh.instanceMatrix.array.set(prev.instanceMatrix.array);
        if (prev.instanceColor && PAINTED.includes(mat)) {
          mesh.setColorAt(0, new THREE.Color(1, 1, 1));
          mesh.instanceColor!.array.set(prev.instanceColor.array);
        }
        prev.dispose();
      }
      mesh.castShadow = this.shadows;
      mesh.receiveShadow = this.shadows;
      mesh.frustumCulled = false;
      mesh.count = 0;
      if (PAINTED.includes(mat) && !mesh.instanceColor) mesh.setColorAt(0, new THREE.Color(1, 1, 1));
      this.group.add(mesh);
      return { node, mat, mesh };
    });
    p.capacity = capacity;
  }

  begin() {
    for (const p of this.pools.values()) p.count = 0;
    this.instances = 0;
  }

  add(model: ModelDef, s: InstanceState) {
    const p = this.pool(model);
    if (p.count >= p.capacity) {
      this.grow(p, p.capacity * 2);
    }
    const i = p.count++;
    this.instances++;
    this.computeNodes(model, s);
    for (const m of p.meshes) {
      m.mesh.setMatrixAt(i, this.nodeM.get(m.node) ?? this.nodeM.get('body')!);
      if (PAINTED.includes(m.mat)) m.mesh.setColorAt(i, s.color);
    }
  }

  private computeNodes(model: ModelDef, s: InstanceState) {
    const nm = this.nodeM;
    const body = nm.get('body') ?? new THREE.Matrix4();
    _q.setFromAxisAngle(Y, -s.angle);
    const sc = model.scale ?? 1;
    _s.set(sc, sc * Math.max(0.02, s.built), sc);
    body.compose(_v.set(s.x, s.h + s.bob, s.y), _q, _s);
    nm.set('body', body);
    const order: NodeKey[] = ['turret', 'barrel', 'legL', 'legR', 'dish', 'arm', 'orb', 'cargo', 'crane'];
    for (const node of order) {
      const piv = model.pivots[node];
      if (!piv) continue;
      const parent = nm.get(model.parent[node] ?? 'body')!;
      const local = new THREE.Matrix4();
      switch (node) {
        case 'turret': local.makeRotationY(-(s.turret - s.angle)); break;
        case 'barrel': local.makeTranslation(-s.recoil, 0, 0); break;
        case 'legL': local.makeRotationAxis(Z, s.swing); break;
        case 'legR': local.makeRotationAxis(Z, -s.swing); break;
        case 'dish': local.makeRotationY(s.t * 1.4); break;
        case 'arm': local.makeRotationAxis(Z, Math.sin(s.t * 2) * 0.32); break;
        case 'orb': local.makeScale(s.pulse, s.pulse, s.pulse); break;
        case 'cargo': local.makeScale(1, Math.max(0.01, s.cargo), 1); break;
        case 'crane': local.makeRotationY(Math.sin(s.t * 0.25) * 0.8); break;
      }
      const m = nm.get(node) ?? new THREE.Matrix4();
      m.copy(parent).multiply(_m.makeTranslation(piv.x, piv.y, piv.z)).multiply(local);
      nm.set(node, m);
    }
  }

  end() {
    for (const p of this.pools.values()) {
      for (const m of p.meshes) {
        m.mesh.count = p.count;
        m.mesh.instanceMatrix.needsUpdate = true;
        if (m.mesh.instanceColor) m.mesh.instanceColor.needsUpdate = true;
      }
    }
  }
}

export function makeState(): InstanceState {
  return { x: 0, y: 0, h: 0, angle: 0, turret: 0, built: 1, recoil: 0, swing: 0, bob: 0, t: 0, pulse: 1, cargo: 0, color: new THREE.Color(1, 1, 1) };
}
