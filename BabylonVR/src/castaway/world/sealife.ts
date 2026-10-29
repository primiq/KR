// Life in the water near the player: schools of fish, and on some nights glowing plankton.
//  - Fish swim in loose schools that wander through water deep enough for them, keep off the bottom and the surface, and dart
//    away when you come close. Several kinds (silver sardines, yellow-striped grunts, blue tangs, orange clownfish near the shore).
//    Only near the player and only near the sea; local to each player (nothing is sent).
//  - Bioluminescence: on some nights (the host decides; everybody sees the same) the sea glows blue where it is stirred up:
//    the breaking swells and foam (in the water shader, see BIO), and glowing trails behind fish, swimmers and anyone wading.
// Babylon port: drawn by render/mirror.ts. The fish are named 'fish<kind>' so the Babylon side gives them the tail beat
// (render/materials fishMaterial: the tail weight rides in the vertex colour's alpha, as the plants' sway does).
import * as THREE from 'three';
import { heightAt } from './island';
import { Mesher } from '../net/playerModel';

/** 0..1: how much the sea glows tonight (the water shader reads it) */
export const BIO = { value: 0 };
/** the tail beat's amplitude for each kind (metres) */
export const FISH_WIGGLE = [0.28, 0.34, 0.3, 0.16].map((len) => len * 0.32);

interface Fish { ox: number; oy: number; oz: number; x: number; y: number; z: number; yaw: number; pitch: number; trail: number }
interface School { x: number; y: number; z: number; vx: number; vz: number; tx: number; tz: number; kind: number; fish: Fish[]; scare: number; size: number }

const KINDS = [
  { body: '#c8d4dc', back: '#5a7a90', belly: '#eef3f6', len: 0.28, n: [14, 24] },   // sardines: big tight schools
  { body: '#e8d24a', back: '#3a5a8a', belly: '#f6efc8', len: 0.34, n: [6, 12] },    // yellow-striped grunts
  { body: '#2f6fd2', back: '#1a3a7a', belly: '#f2d24a', len: 0.3, n: [5, 9] },     // blue tangs (yellow tail)
  { body: '#f08a24', back: '#ffffff', belly: '#f08a24', len: 0.16, n: [3, 6] },    // clownfish
];

function fishGeometry(k: number) {
  const K = KINDS[k], m = new Mesher();
  m.sph(0.5, K.body, 0, 0, 0, 0.42, 0.62, 1, 8);               // body, along -z (head first)
  m.sph(0.46, K.back, 0, 0.08, 0.02, 0.3, 0.42, 0.9, 6);         // darker back
  m.sph(0.44, K.belly, 0, -0.1, 0, 0.32, 0.36, 0.86, 6);         // pale belly
  if (k === 1) for (const y of [-0.06, 0.08]) m.box(0.44, 0.03, 0.7, '#3a5a8a', 0, y, 0);   // stripes
  if (k === 3) for (const z of [-0.2, 0.15]) m.box(0.44, 0.6, 0.06, '#ffffff', 0, 0, z);   // white bands
  m.box(0.02, 0.5, 0.36, k === 2 ? '#f2d24a' : K.body, 0, 0, 0.62);              // tail fin
  m.box(0.02, 0.22, 0.3, K.back, 0, 0.3, 0.05);                                    // dorsal fin
  for (const s of [-1, 1]) m.sph(0.05, '#111111', s * 0.17, 0.08, -0.36, 1, 1, 1, 5);
  const mesh = m.build(false), g = mesh.geometry;
  g.scale(K.len, K.len, K.len);
  // tail weight for the swimming wiggle: nothing at the head, most at the tail
  const P = g.getAttribute('position'), w = new Float32Array(P.count);
  for (let i = 0; i < P.count; i++) w[i] = Math.max(0, P.getZ(i) / K.len + 0.15) ** 1.5;
  // (packed as 'flutter', 0..0.99, which render/geometry carries in the colour alpha: wig = flutter / 0.66)
  for (let i = 0; i < w.length; i++) w[i] = Math.min(0.99, w[i] * 0.66);
  g.setAttribute('flutter', new THREE.BufferAttribute(w, 1));
  return { geo: g, mat: mesh.material as THREE.Material };
}

export class SeaLife {
  readonly group = new THREE.Group();
  private schools: School[] = [];
  private meshes: THREE.InstancedMesh[] = [];
  private d = new THREE.Object3D();
  private spawnT = 0;
  private maxSchools: number;
  // glowing trails
  private N = 1400;
  private tPos: Float32Array;
  private tCol: Float32Array;
  private tLife: Float32Array;
  private tNext = 0;
  private trails: THREE.InstancedMesh;
  private tm = new THREE.Matrix4();
  private tc = new THREE.Color();
  private live = 0;
  private bio = 0;
  /** the host's choice for tonight (0 or 1); the glow fades towards it */
  bioTarget = 0;

  constructor(scene: THREE.Object3D, low: boolean) {
    this.maxSchools = low ? 4 : 7;
    KINDS.forEach((_, k) => {
      const { geo } = fishGeometry(k);
      const mat = new THREE.MeshStandardMaterial({ name: `fish${k}`, roughness: 0.4, metalness: 0.15, vertexColors: true });
      const m = new THREE.InstancedMesh(geo, mat, 160);
      m.count = 0; m.frustumCulled = false;
      this.meshes.push(m); this.group.add(m);
    });
    scene.add(this.group);
    this.tPos = new Float32Array(this.N * 3).fill(-9999); this.tCol = new Float32Array(this.N * 3); this.tLife = new Float32Array(this.N);
    // (tiny glowing beads, not GL points: WebGPU draws points one pixel wide whatever their size)
    const pm = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    pm.fog = false;
    this.trails = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.07, 0), pm, this.N);
    this.trails.instanceColor = new THREE.InstancedBufferAttribute(this.tCol, 3);
    this.trails.count = 0; this.trails.frustumCulled = false; this.trails.renderOrder = 4;
    scene.add(this.trails);
  }

  private depth(x: number, z: number) { return -heightAt(x, z); }

  private spawnSchool(px: number, pz: number) {
    for (let k = 0; k < 14; k++) {
      const a = Math.random() * Math.PI * 2, r = 18 + Math.random() * 40, x = px + Math.cos(a) * r, z = pz + Math.sin(a) * r, dd = this.depth(x, z);
      if (dd < 1.4) continue;
      const kind = dd < 4 ? (Math.random() < 0.45 ? 3 : Math.random() < 0.5 ? 2 : 1) : Math.random() < 0.55 ? 0 : Math.random() < 0.6 ? 1 : 2;
      const K = KINDS[kind], n = K.n[0] + Math.floor(Math.random() * (K.n[1] - K.n[0] + 1)), size = 0.6 + n * 0.08;
      const y = -Math.min(dd - 0.5, 0.6 + Math.random() * (dd - 1.1));
      const fish: Fish[] = [];
      for (let i = 0; i < n; i++) {
        const ox = (Math.random() - 0.5) * 2 * size, oy = (Math.random() - 0.5) * size * 0.5, oz = (Math.random() - 0.5) * 2 * size;
        fish.push({ ox, oy, oz, x: x + ox, y: y + oy, z: z + oz, yaw: 0, pitch: 0, trail: Math.random() * 0.2 });
      }
      this.schools.push({ x, y, z, vx: 0, vz: 0, tx: x, tz: z, kind, fish, scare: 0, size });
      return;
    }
  }

  /** threats: you and anything else in the water (swimmers scare fish) */
  update(dt: number, me: { x: number; y: number; z: number }, threats: { x: number; y: number; z: number }[], waders: { x: number; y: number; z: number; moving: boolean }[], active: boolean) {
    const sdt = Math.min(dt, 0.1);
    // ---- the glow tonight
    this.bio += (this.bioTarget - this.bio) * Math.min(1, sdt * 0.25);
    BIO.value = this.bio;
    this.group.visible = active;
    if (!active) { this.schools.length = 0; this.updateTrails(sdt); return; }
    // ---- keep a few schools about
    this.spawnT -= sdt;
    if (this.spawnT <= 0) {
      this.spawnT = 1.5;
      this.schools = this.schools.filter((s) => Math.hypot(s.x - me.x, s.z - me.z) < 85);
      if (this.schools.length < this.maxSchools) this.spawnSchool(me.x, me.z);
    }
    const counts = this.meshes.map(() => 0), d = this.d, glow = this.bio > 0.05;
    for (const s of this.schools) {
      // wander: a new goal now and then, always over water deep enough
      if (Math.hypot(s.tx - s.x, s.tz - s.z) < 2 || Math.random() < sdt * 0.08) {
        for (let k = 0; k < 6; k++) { const a = Math.random() * Math.PI * 2, r = 8 + Math.random() * 16, x = s.x + Math.cos(a) * r, z = s.z + Math.sin(a) * r; if (this.depth(x, z) > 1.3) { s.tx = x; s.tz = z; break; } }
      }
      // dart away from anyone close
      s.scare = Math.max(0, s.scare - sdt);
      for (const q of threats) { const dx = s.x - q.x, dz = s.z - q.z, dd = Math.hypot(dx, dz); if (dd < 4.5 && Math.abs(s.y - q.y) < 3) { s.scare = 1.5; const l = dd || 1; s.tx = s.x + (dx / l) * 10; s.tz = s.z + (dz / l) * 10; } }
      const sp = s.scare > 0 ? 3.2 : 0.7, dx = s.tx - s.x, dz = s.tz - s.z, l = Math.hypot(dx, dz) || 1;
      s.vx += ((dx / l) * sp - s.vx) * Math.min(1, sdt * 2); s.vz += ((dz / l) * sp - s.vz) * Math.min(1, sdt * 2);
      const nx = s.x + s.vx * sdt, nz = s.z + s.vz * sdt;
      if (this.depth(nx, nz) > 1.1) { s.x = nx; s.z = nz; } else { s.tx = s.x - s.vx * 4; s.tz = s.z - s.vz * 4; s.vx *= -0.5; s.vz *= -0.5; }
      const floor = heightAt(s.x, s.z) + 0.5; s.y = Math.min(-0.45, Math.max(floor, s.y));
      const yaw = Math.atan2(-s.vx, -s.vz), m = this.meshes[s.kind];
      for (const f of s.fish) {
        // each fish follows its place in the school, a little lazily, with its own wobble
        const t = performance.now() / 1000 + f.ox * 3;
        const gx = s.x + f.ox + Math.sin(t * 0.7) * 0.3, gy = s.y + f.oy + Math.sin(t * 0.9) * 0.12, gz = s.z + f.oz + Math.cos(t * 0.6) * 0.3;
        const k = Math.min(1, sdt * (s.scare > 0 ? 4 : 1.6));
        const mx = (gx - f.x) * k, my = (gy - f.y) * k, mz = (gz - f.z) * k;
        f.x += mx; f.y = Math.min(-0.25, Math.max(heightAt(f.x, f.z) + 0.2, f.y + my)); f.z += mz;
        const v = Math.hypot(mx, mz);
        f.yaw = v > 2e-3 ? Math.atan2(-mx, -mz) : yaw;
        if (counts[s.kind] < 160) {
          d.position.set(f.x, f.y, f.z); d.rotation.set(Math.max(-0.5, Math.min(0.5, my * 8)), f.yaw, 0, 'YXZ'); d.scale.setScalar(1); d.updateMatrix();
          m.setMatrixAt(counts[s.kind]++, d.matrix);
        }
        // glowing wake
        if (glow) { f.trail -= sdt * (s.scare > 0 ? 3 : 1); if (f.trail <= 0 && Math.hypot(f.x - me.x, f.z - me.z) < 40) { f.trail = 0.25; this.emit(f.x, f.y, f.z, 0.5); } }
      }
    }
    this.meshes.forEach((m, k) => { m.count = counts[k]; m.instanceMatrix.needsUpdate = true; });
    // people in the water stir up light too
    if (glow) for (const w of waders) {
      const dd = this.depth(w.x, w.z); if (dd < 0.05) continue;
      // a swirl round your legs, near the top of the water where it shows
      const n = w.moving ? 5 : Math.random() < 0.25 ? 1 : 0;
      for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, r = 0.25 + Math.random() * 0.7; this.emit(w.x + Math.cos(a) * r, Math.max(-dd + 0.05, -0.04 - Math.random() * 0.3), w.z + Math.sin(a) * r, 1.0); }
    }
    this.updateTrails(sdt);
  }

  private emit(x: number, y: number, z: number, k: number) {
    const i = this.tNext; this.tNext = (this.tNext + 1) % this.N;
    this.tPos[i * 3] = x; this.tPos[i * 3 + 1] = Math.min(-0.02, y); this.tPos[i * 3 + 2] = z;
    this.tLife[i] = 2.2 * (0.6 + Math.random() * 0.6) * k + 0.6;
    this.live = Math.min(this.N, this.live + 1);
  }
  private updateTrails(dt: number) {
    if (!this.live) { this.trails.visible = false; return; }
    this.trails.visible = true;
    let n = 0, k = 0;
    const b = this.bio, T = this.trails, m = this.tm, c = this.tc;
    for (let i = 0; i < this.N; i++) {
      if (this.tLife[i] <= 0) continue;
      this.tLife[i] -= dt; n++;
      if (this.tLife[i] <= 0) continue;
      const f = Math.max(0, Math.min(1, this.tLife[i] / 1.4)) * b * 1.6;
      this.tPos[i * 3 + 1] += dt * 0.02;
      const s = 0.6 + 0.6 * Math.min(1, this.tLife[i] / 1.4);
      m.makeScale(s, s, s).setPosition(this.tPos[i * 3], this.tPos[i * 3 + 1], this.tPos[i * 3 + 2]);
      T.setMatrixAt(k, m); T.setColorAt(k, c.setRGB(0.15 * f, 0.8 * f, 1.0 * f)); k++;
    }
    this.live = n;
    T.count = k; T.instanceMatrix.needsUpdate = true; if (T.instanceColor) T.instanceColor.needsUpdate = true;
  }

  get fishCount() { return this.meshes.reduce((a, m) => a + m.count, 0); }
}
