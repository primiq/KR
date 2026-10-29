// Small touches that make the island feel lived in. All of it is local to each player (nothing goes over the network: every
// client sees its own footprints and birds, made from the same shared positions).
//  - Footprints: anything walking on the beach leaves prints in the sand (people, boars, jaguars, turtles' flipper tracks).
//    They fade after a minute or so; down by the water the waves wash them away much sooner.
//  - Birds: little birds hop and peck about on the ground and sit up in the palms and jungle trees. Walk up to them (or run, or
//    chop their tree) and they burst up with a rattle of wings and settle somewhere else a little way off.
// Babylon port: Castaway's code, drawn by render/mirror.ts (which reads the instanced meshes' matrices and colours, and the
// footprints' fade from userData.instanceAlpha).
import * as THREE from 'three';
import { Mesher } from '../net/playerModel';
import { heightAt, slopeAt, normalAt, SEA_LEVEL } from '../world/island';
import type { Vegetation } from '../world/vegetation';

export interface Walker { key: string; x: number; y: number; z: number; kind: 'foot' | 'hoof' | 'paw' | 'flipper'; fast?: boolean }

const PRINT = { foot: [0.055, 0.125, 0.72, 0.11], hoof: [0.03, 0.04, 0.42, 0.09], paw: [0.045, 0.05, 0.6, 0.1], flipper: [0.07, 0.2, 0.32, 0.36] } as const;
const SAND_TOP = 2.2;   // above this the ground is grass

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0), _n = new THREE.Vector3(), _nn: [number, number, number] = [0, 1, 0];
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

/** the footprints' per-print fade (Castaway's instanced attribute), mirrored into the alpha the Babylon side draws */
class Fade {
  readonly array: Float32Array; readonly alpha: Float32Array;
  constructor(n: number) { this.array = new Float32Array(n); this.alpha = new Float32Array(n); }
  set needsUpdate(_v: boolean) { /* read every frame */ }
  setX(i: number, v: number) { this.array[i] = v; this.alpha[i] = v * 0.68; }
  getX(i: number) { return this.array[i]; }
  clear() { this.array.fill(0); this.alpha.fill(0); }
}

export class Footprints {
  readonly mesh: THREE.InstancedMesh;
  private readonly N = 420;
  private fade: Fade;
  private life = new Float32Array(this.N);
  private max = new Float32Array(this.N);
  private next = 0;
  private live = 0;
  private track = new Map<string, { x: number; z: number; side: number; seen: number }>();
  private frame = 0;

  constructor() {
    const geo = new THREE.CircleGeometry(1, 10).rotateX(-Math.PI / 2);
    this.fade = new Fade(this.N);
    const mat = new THREE.MeshStandardMaterial({ color: '#6a5134', roughness: 1, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.mesh = new THREE.InstancedMesh(geo, mat, this.N);
    this.mesh.userData.instanceAlpha = this.fade.alpha;
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 1;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.N; i++) this.mesh.setMatrixAt(i, zero);
  }

  /** a print at (x, z) facing yaw (radians, 0 = north) */
  private stamp(x: number, z: number, yaw: number, sx: number, sz: number) {
    const h = heightAt(x, z);
    if (h > SAND_TOP || h < SEA_LEVEL + 0.02) return;
    const i = this.next; this.next = (this.next + 1) % this.N;
    normalAt(x, z, _nn); _n.set(_nn[0], _nn[1], _nn[2]);
    _q.setFromUnitVectors(_up, _n).multiply(_q2.setFromAxisAngle(_up, yaw));
    _m.compose(_p.set(x, h + 0.012, z), _q, _s.set(sx, 1, sz));
    this.mesh.setMatrixAt(i, _m); this.mesh.instanceMatrix.needsUpdate = true;
    // close to the water the waves soon smooth them over
    this.life[i] = this.max[i] = h < 0.45 ? 10 + Math.random() * 6 : 60 + Math.random() * 30;
    this.fade.setX(i, 1); this.fade.needsUpdate = true;
    this.live = Math.min(this.N, this.live + 1);
  }

  update(dt: number, walkers: Walker[]) {
    this.frame++;
    for (const w of walkers) {
      const t = this.track.get(w.key);
      const ground = heightAt(w.x, w.z);
      if (!t) { this.track.set(w.key, { x: w.x, z: w.z, side: 1, seen: this.frame }); continue; }
      t.seen = this.frame;
      const dx = w.x - t.x, dz = w.z - t.z, d = Math.hypot(dx, dz);
      if (d > 6) { t.x = w.x; t.z = w.z; continue; }           // teleported / respawned
      const P = PRINT[w.kind], stride = P[2] * (w.fast ? 1.3 : 1);
      if (d < stride) continue;
      t.x = w.x; t.z = w.z;
      if (w.y > ground + 0.35 || ground > SAND_TOP) continue;  // in the air, or off the sand
      const yaw = Math.atan2(-dx, -dz), rx = Math.cos(yaw), rz = -Math.sin(yaw);   // right of the direction of travel
      if (w.kind === 'flipper') { for (const s of [-1, 1]) this.stamp(w.x + rx * P[3] * s, w.z + rz * P[3] * s, yaw + s * 0.5, P[0], P[1]); }
      else if (w.kind === 'foot') { t.side = -t.side; this.stamp(w.x + rx * P[3] * t.side, w.z + rz * P[3] * t.side, yaw + t.side * 0.08, P[0], P[1]); }
      else for (const s of [-1, 1]) this.stamp(w.x + rx * P[3] * s + (s > 0 ? dx / d * 0.12 : 0), w.z + rz * P[3] * s + (s > 0 ? dz / d * 0.12 : 0), yaw, P[0], P[1]);
    }
    if (this.frame % 120 === 0) for (const [k, t] of this.track) if (this.frame - t.seen > 120) this.track.delete(k);
    if (!this.live) return;
    let any = false, n = 0;
    for (let i = 0; i < this.N; i++) {
      if (this.life[i] <= 0) continue;
      n++;
      this.life[i] -= dt;
      const f = this.life[i] <= 0 ? 0 : Math.min(1, this.life[i] / (this.max[i] * 0.35));
      if (Math.abs(f - this.fade.getX(i)) > 0.01 || f === 0) { this.fade.setX(i, f); any = true; }
    }
    this.live = n;
    if (any) this.fade.needsUpdate = true;
  }

  clear() { this.life.fill(0); this.fade.clear(); this.live = 0; this.track.clear(); }
}

// ------------------------------------------------------------------------------------------------ birds
type BState = 'ground' | 'perch' | 'fly';
interface Bird {
  x: number; y: number; z: number; yaw: number; st: BState; kind: number; flock: number;
  fx: number; fy: number; fz: number; tx: number; ty: number; tz: number; t: number; dur: number;
  hop: number; peck: number; rest: number; perch: number; flap: number; scale: number;
}
const COLORS = ['#c9b79a', '#8a6440', '#d8b02c', '#d23b2b', '#2fa64a', '#2b6fd2'];   // sandpiper, sparrow, finch, parrots
const CAP = 40;

function birdBody() {
  const m = new Mesher();
  m.sph(0.055, '#ffffff', 0, 0.07, 0, 0.9, 0.85, 1.45, 8);          // body
  m.sph(0.038, '#ffffff', 0, 0.115, -0.07, 1, 1, 1, 8);             // head
  m.add(new THREE.ConeGeometry(0.012, 0.035, 5).rotateX(-Math.PI / 2), '#3a3020', 0, 0.112, -0.115);   // beak
  m.box(0.05, 0.01, 0.07, '#d9d9d9', 0, 0.08, 0.085, -0.25);        // tail
  for (const s of [-1, 1]) { m.box(0.006, 0.05, 0.006, '#4a3a2a', s * 0.02, 0.02, 0); m.sph(0.008, '#111111', s * 0.024, 0.125, -0.085, 1, 1, 1, 4); }
  return m.build(false);
}

export class Birds {
  readonly group = new THREE.Group();
  private list: Bird[] = [];
  private body: THREE.InstancedMesh;
  private wingL: THREE.InstancedMesh;
  private wingR: THREE.InstancedMesh;
  private spawnT = 0;
  private flocks = 0;
  private d = new THREE.Object3D();
  private w = new THREE.Object3D();
  private c = new THREE.Color();
  /** play a sound at a spot (volume already scaled by distance) */
  sound: ((kind: 'chirp' | 'flutter', vol: number) => void) | null = null;

  constructor(private veg: Vegetation) {
    const b = birdBody();
    this.body = new THREE.InstancedMesh(b.geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, flatShading: true }), CAP);
    const wg = new THREE.BoxGeometry(0.11, 0.006, 0.07).translate(0.055, 0, 0);
    const wm = new THREE.MeshStandardMaterial({ roughness: 0.85, side: THREE.DoubleSide });
    this.wingL = new THREE.InstancedMesh(wg, wm, CAP); this.wingR = new THREE.InstancedMesh(wg, wm, CAP);
    for (const m of [this.body, this.wingL, this.wingR]) { m.count = 0; m.frustumCulled = false; this.group.add(m); }
  }

  private place(x: number, z: number) {
    const h = heightAt(x, z);
    return h > SEA_LEVEL + 0.15 && slopeAt(x, z) < 0.45 ? h : null;
  }

  private spawnFlock(px: number, pz: number, day: boolean) {
    const perches = this.veg.perches;
    const f = ++this.flocks;
    if (Math.random() < (day ? 0.45 : 1)) {
      // a few up in a tree
      for (let k = 0; k < 12; k++) {
        const p = perches[Math.floor(Math.random() * perches.length)];
        if (!p || p.node.depleted) continue;
        const d = Math.hypot(p.x - px, p.z - pz);
        if (d < 14 || d > 60) continue;
        const n = 1 + Math.floor(Math.random() * 3), kind = p.palm ? 1 + Math.floor(Math.random() * 2) : 3 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n && this.list.length < CAP; i++) {
          const a = Math.random() * 6.28, r = 0.3 + Math.random() * 0.7;
          this.list.push(this.make(p.x + Math.cos(a) * r, p.y + Math.random() * 0.3, p.z + Math.sin(a) * r, 'perch', kind, f, perches.indexOf(p)));
        }
        return;
      }
      return;
    }
    // a little flock on the ground
    for (let k = 0; k < 10; k++) {
      const a = Math.random() * 6.28, r = 18 + Math.random() * 35, x = px + Math.cos(a) * r, z = pz + Math.sin(a) * r, h = this.place(x, z);
      if (h === null) continue;
      const kind = h < SAND_TOP ? 0 : Math.random() < 0.5 ? 1 : 2, n = 3 + Math.floor(Math.random() * 4);
      for (let i = 0; i < n && this.list.length < CAP; i++) {
        const bx = x + (Math.random() - 0.5) * 3, bz = z + (Math.random() - 0.5) * 3, bh = this.place(bx, bz);
        if (bh !== null) this.list.push(this.make(bx, bh, bz, 'ground', kind, f, -1));
      }
      return;
    }
  }

  private make(x: number, y: number, z: number, st: BState, kind: number, flock: number, perch: number): Bird {
    return { x, y, z, yaw: Math.random() * 6.28, st, kind, flock, fx: x, fy: y, fz: z, tx: x, ty: y, tz: z, t: 0, dur: 1, hop: Math.random() * 2, peck: 0, rest: 20 + Math.random() * 40, perch, flap: Math.random() * 6, scale: kind >= 3 ? 1.6 : kind === 0 ? 1.05 : 0.9 };
  }

  /** send a bird (and its flock) flying away from (ax, az) */
  private scare(b: Bird, ax: number, az: number) {
    const flock = this.list.filter((q) => q.flock === b.flock && q.st !== 'fly');
    // somewhere to go: a tree crown away from the trouble, otherwise open ground further off
    let dest: { x: number; y: number; z: number; perch: number } | null = null;
    const away = Math.atan2(b.z - az, b.x - ax);
    const perches = this.veg.perches;
    for (let k = 0; k < 20 && !dest; k++) {
      const i = Math.floor(Math.random() * perches.length), p = perches[i];
      if (!p || p.node.depleted) continue;
      const d = Math.hypot(p.x - b.x, p.z - b.z), da = Math.abs(Math.atan2(Math.sin(Math.atan2(p.z - b.z, p.x - b.x) - away), Math.cos(Math.atan2(p.z - b.z, p.x - b.x) - away)));
      if (d > 18 && d < 70 && da < 1.2 && Math.hypot(p.x - ax, p.z - az) > 16) dest = { x: p.x, y: p.y, z: p.z, perch: i };
    }
    for (let k = 0; k < 12 && !dest; k++) {
      const a = away + (Math.random() - 0.5) * 1.4, r = 22 + Math.random() * 25, x = b.x + Math.cos(a) * r, z = b.z + Math.sin(a) * r, h = this.place(x, z);
      if (h !== null) dest = { x, y: h, z, perch: -1 };
    }
    for (const q of flock) {
      if (!dest) { q.rest = -1; continue; }   // nowhere to go: they just leave (despawned below)
      q.st = 'fly'; q.fx = q.x; q.fy = q.y; q.fz = q.z;
      const a = Math.random() * 6.28, r = dest.perch >= 0 ? Math.random() * 0.7 : Math.random() * 2.5;
      q.tx = dest.x + Math.cos(a) * r; q.tz = dest.z + Math.sin(a) * r;
      q.ty = dest.perch >= 0 ? dest.y + Math.random() * 0.3 : heightAt(q.tx, q.tz);
      q.perch = dest.perch;
      q.t = -Math.random() * 0.25; q.dur = Math.hypot(q.tx - q.x, q.tz - q.z) / (6 + Math.random() * 2) + 0.4;
      q.rest = 25 + Math.random() * 40;
    }
  }

  /** a tree was chopped: anything sitting in it flies off */
  treeHit(x: number, z: number) {
    for (const b of this.list) if (b.st === 'perch' && Math.hypot(b.x - x, b.z - z) < 3) { this.scare(b, x, z); }
  }

  update(dt: number, me: { x: number; y: number; z: number }, threats: { x: number; z: number; fast: boolean }[], hour: number, active: boolean) {
    const day = hour > 5.5 && hour < 19.6;
    if (!active) { if (this.list.length) this.list = []; this.draw(); return; }
    // keep a few birds around the player: more by day, a handful asleep in the trees at night
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 2;
      for (let i = this.list.length - 1; i >= 0; i--) { const b = this.list[i]; if (Math.hypot(b.x - me.x, b.z - me.z) > 95 || b.rest < -0.5) this.list.splice(i, 1); }
      const want = day ? 16 : 4;
      if (this.list.length < want && Math.hypot(me.x, me.z) < 380) this.spawnFlock(me.x, me.z, day);
    }
    let chirpBudget = 1;
    for (const b of this.list) {
      b.flap += dt;
      if (b.st === 'fly') {
        b.t += dt;
        if (b.t < 0) continue;
        const k = Math.min(1, b.t / b.dur), e = k * k * (3 - 2 * k);
        const nx = b.fx + (b.tx - b.fx) * e, nz = b.fz + (b.tz - b.fz) * e;
        const apex = Math.min(9, 2 + b.dur * 1.6);
        const ny = b.fy + (b.ty - b.fy) * e + Math.sin(k * Math.PI) * apex;
        if (Math.hypot(nx - b.x, nz - b.z) > 1e-4) b.yaw = Math.atan2(-(nx - b.x), -(nz - b.z));
        b.x = nx; b.y = ny; b.z = nz;
        if (k >= 1) { b.st = b.perch >= 0 ? 'perch' : 'ground'; b.y = b.ty; b.hop = 0.5 + Math.random(); }
        continue;
      }
      // anyone coming close?
      for (const q of threats) {
        const d = Math.hypot(q.x - b.x, q.z - b.z), R = b.st === 'perch' ? (q.fast ? 4 : 0) : q.fast ? 13 : 7;
        if (d < R) {
          const v = Math.max(0, 1 - Math.hypot(b.x - me.x, b.z - me.z) / 40);
          this.sound?.('flutter', v * 0.9); if (day) this.sound?.('chirp', v * 0.4);
          this.scare(b, q.x, q.z); break;
        }
      }
      if ((b.st as BState) === 'fly') continue;
      b.rest -= dt;
      if (b.st === 'ground') {
        b.hop -= dt; b.peck = Math.max(0, b.peck - dt);
        if (b.hop <= 0) {
          b.hop = 0.4 + Math.random() * 1.8;
          if (Math.random() < 0.4) b.peck = 0.35;
          else {
            const a = b.yaw + (Math.random() - 0.5) * 2.4, r = 0.12 + Math.random() * 0.3, x = b.x - Math.sin(a) * r, z = b.z - Math.cos(a) * r, h = this.place(x, z);
            if (h !== null) { b.yaw = a; b.fx = b.x; b.fz = b.z; b.fy = b.y; b.tx = x; b.tz = z; b.ty = h; b.t = 0; b.dur = 0.18; }
          }
        }
        if (b.dur === 0.18 && b.t < b.dur) {
          b.t += dt; const k = Math.min(1, b.t / b.dur);
          b.x = b.fx + (b.tx - b.fx) * k; b.z = b.fz + (b.tz - b.fz) * k; b.y = b.fy + (b.ty - b.fy) * k + Math.sin(k * Math.PI) * 0.07;
          if (k >= 1) b.dur = 1;
        }
        // after a while a ground flock wanders off into a tree
        if (b.rest < 0) { b.rest = 30 + Math.random() * 40; if (Math.random() < 0.35) this.scare(b, b.x - Math.sin(b.yaw), b.z - Math.cos(b.yaw)); }
      } else {
        if (b.perch >= 0 && this.veg.perches[b.perch]?.node.depleted) { this.scare(b, b.x, b.z); continue; }   // the tree came down
        b.hop -= dt;
        if (b.hop <= 0) { b.hop = 1 + Math.random() * 4; b.yaw += (Math.random() - 0.5) * 2; }
        if (b.rest < 0) { b.rest = 30 + Math.random() * 40; if (Math.random() < 0.5) this.scare(b, b.x - Math.sin(b.yaw), b.z - Math.cos(b.yaw)); }
      }
      // song by day
      if (day && chirpBudget > 0 && Math.random() < dt * (hour < 8 ? 0.5 : 0.12)) {
        const v = Math.max(0, 1 - Math.hypot(b.x - me.x, b.z - me.z, (b.y - me.y) * 0.5) / 45);
        if (v > 0.05) { this.sound?.('chirp', v * (b.kind >= 3 ? 0.55 : 0.35)); chirpBudget--; }
      }
    }
    this.draw();
  }

  private draw() {
    const d = this.d, w = this.w;
    let n = 0;
    for (const b of this.list) {
      if (b.st === 'fly' && b.t < 0) { /* still on the ground, about to go */ }
      d.position.set(b.x, b.y, b.z);
      const pitch = b.peck > 0 ? -0.6 * Math.sin((b.peck / 0.35) * Math.PI) : b.st === 'fly' ? 0.15 : 0;
      d.rotation.set(pitch, b.yaw, 0, 'YXZ');
      d.scale.setScalar(b.scale);
      d.updateMatrix();
      this.body.setMatrixAt(n, d.matrix);
      this.c.set(COLORS[b.kind]); this.body.setColorAt(n, this.c);
      const flying = b.st === 'fly' && b.t >= 0;
      const flap = flying ? Math.sin(b.flap * 34) * 0.9 + 0.2 : -1.25;   // folded along the body when sitting
      for (const [mesh, s] of [[this.wingR, 1], [this.wingL, -1]] as const) {
        w.position.set(s * 0.035, 0.09, -0.01);
        w.rotation.set(0, flying ? 0 : s * 1.35, s * flap * (flying ? 1 : 0.15), 'YXZ');
        w.scale.set(s, 1, 1);
        w.updateMatrix();
        _m.multiplyMatrices(d.matrix, w.matrix);
        mesh.setMatrixAt(n, _m);
        this.c.set(COLORS[b.kind]).multiplyScalar(0.7); mesh.setColorAt(n, this.c);
      }
      n++;
    }
    for (const m of [this.body, this.wingL, this.wingR]) {
      m.count = n; m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
}

// ------------------------------------------------------------------------------------------------ flamingos
// Flocks of flamingos wade in the shallows by day: they stalk slowly through ankle-deep water, stop to feed (head down in the water),
// rest on one leg, and when you come too close the whole flock runs a few steps and takes off on slow wingbeats, legs trailing,
// to settle in other shallows further along the shore. Local to each player, like the small birds.
interface Flamingo {
  x: number; y: number; z: number; yaw: number; st: 'wade' | 'feed' | 'rest' | 'fly';
  t: number; tx: number; tz: number; flock: number; fx: number; fy: number; fz: number; ty: number; dur: number; flap: number; s: number;
}
const FL_CAP = 30;

function flamingoBody() {
  const m = new Mesher(), pink = '#f48aa8', deep = '#e0607e', pale = '#fbc2cf';
  m.sph(0.2, pink, 0, 0.95, 0, 0.75, 0.62, 1.15, 10);                 // body (head towards -z)
  m.sph(0.12, deep, 0, 0.98, 0.18, 0.7, 0.5, 0.9, 7);                 // tail feathers
  // the S-shaped neck: up from the chest, a bend, then the head
  m.cyl(0.03, 0.035, 0.32, pink, 0, 1.13, -0.17, 1, 1, 6, 0.35);
  m.cyl(0.028, 0.03, 0.3, pink, 0, 1.4, -0.16, 1, 1, 6, -0.45);
  m.sph(0.055, pale, 0, 1.57, -0.24, 0.9, 0.9, 1.2, 7);               // head
  m.cyl(0.018, 0.026, 0.12, '#f3e6dc', 0, 1.53, -0.31, 1, 1, 5, 1.9); // beak
  m.cyl(0.012, 0.018, 0.05, '#1a1a1a', 0, 1.49, -0.37, 1, 1, 5, 2.6); // black beak tip
  for (const s of [-1, 1]) m.sph(0.012, '#1a1a1a', s * 0.04, 1.59, -0.27, 1, 1, 1, 4);
  // long pink legs with a backward knee
  for (const s of [-1, 1]) {
    m.cyl(0.012, 0.014, 0.45, deep, s * 0.06, 0.62, 0.02, 1, 1, 5, 0.12);
    m.cyl(0.011, 0.012, 0.42, deep, s * 0.06, 0.22, -0.01, 1, 1, 5, -0.05);
    m.box(0.07, 0.015, 0.1, deep, s * 0.06, 0.01, -0.04);
  }
  return m.build(false);
}

export class Flamingos {
  readonly group = new THREE.Group();
  private list: Flamingo[] = [];
  private body: THREE.InstancedMesh;
  private wingL: THREE.InstancedMesh;
  private wingR: THREE.InstancedMesh;
  private spawnT = 3;
  private flocks = 0;
  private d = new THREE.Object3D();
  private w = new THREE.Object3D();
  sound: ((kind: 'honk' | 'flap', vol: number) => void) | null = null;

  constructor() {
    const b = flamingoBody();
    this.body = new THREE.InstancedMesh(b.geometry, b.material as THREE.Material, FL_CAP);
    const wg = new THREE.BoxGeometry(0.55, 0.012, 0.22).translate(0.27, 0, 0);
    const wm = new THREE.MeshStandardMaterial({ color: '#f06a8a', roughness: 0.8, side: THREE.DoubleSide });
    this.wingL = new THREE.InstancedMesh(wg, wm, FL_CAP); this.wingR = new THREE.InstancedMesh(wg, wm, FL_CAP);
    for (const m of [this.body, this.wingL, this.wingR]) { m.count = 0; m.frustumCulled = false; this.group.add(m); }
  }

  /** ankle-deep water, flat enough to wade in */
  private shallow(x: number, z: number) { const h = heightAt(x, z); return h < -0.12 && h > -0.55 && slopeAt(x, z) < 0.12 ? h : null; }

  private findShallows(cx: number, cz: number, r0: number, r1: number, away?: number) {
    for (let k = 0; k < 40; k++) {
      const a = away !== undefined ? away + (Math.random() - 0.5) * 1.6 : Math.random() * Math.PI * 2, r = r0 + Math.random() * (r1 - r0);
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (this.shallow(x, z) !== null) return { x, z };
    }
    return null;
  }

  private spawnFlock(px: number, pz: number) {
    const c = this.findShallows(px, pz, 25, 80); if (!c) return;
    const f = ++this.flocks, n = 5 + Math.floor(Math.random() * 7);
    for (let i = 0; i < n && this.list.length < FL_CAP; i++) {
      for (let k = 0; k < 8; k++) {
        const x = c.x + (Math.random() - 0.5) * 7, z = c.z + (Math.random() - 0.5) * 7, h = this.shallow(x, z);
        if (h === null) continue;
        this.list.push({ x, y: h, z, yaw: Math.random() * 6.28, st: 'wade', t: Math.random() * 4, tx: x, tz: z, flock: f, fx: x, fy: h, fz: z, ty: h, dur: 1, flap: Math.random() * 6, s: 0.92 + Math.random() * 0.16 });
        break;
      }
    }
  }

  private flyOff(b: Flamingo, ax: number, az: number) {
    const dest = this.findShallows(b.x, b.z, 45, 90, Math.atan2(b.z - az, b.x - ax));
    const flock = this.list.filter((q) => q.flock === b.flock && q.st !== 'fly');
    for (const q of flock) {
      if (!dest) { q.t = -99; continue; }        // nowhere to go: they leave (removed below)
      const tx = dest.x + (Math.random() - 0.5) * 7, tz = dest.z + (Math.random() - 0.5) * 7, h = this.shallow(tx, tz) ?? heightAt(tx, tz);
      q.st = 'fly'; q.fx = q.x; q.fy = q.y; q.fz = q.z; q.tx = tx; q.tz = tz; q.ty = Math.max(h, -0.55);
      q.t = -Math.random() * 0.6; q.dur = Math.hypot(tx - q.x, tz - q.z) / 7 + 1;
    }
  }

  update(dt: number, me: { x: number; z: number }, threats: { x: number; z: number; fast: boolean }[], hour: number, active: boolean) {
    const day = hour > 6 && hour < 19;
    if (!active || !day) { if (this.list.length && (!active || this.list.every((b) => b.st !== 'fly'))) this.list = []; this.draw(); return; }
    const sdt = Math.min(dt, 0.1);
    this.spawnT -= sdt;
    if (this.spawnT <= 0) {
      this.spawnT = 4;
      this.list = this.list.filter((b) => b.t > -50 && Math.hypot(b.x - me.x, b.z - me.z) < 130);
      if (this.list.length < 8) this.spawnFlock(me.x, me.z);
    }
    for (const b of this.list) {
      b.flap += sdt;
      if (b.st === 'fly') {
        b.t += sdt; if (b.t < 0) continue;
        const k = Math.min(1, b.t / b.dur), e = k * k * (3 - 2 * k);
        const nx = b.fx + (b.tx - b.fx) * e, nz = b.fz + (b.tz - b.fz) * e;
        if (Math.hypot(nx - b.x, nz - b.z) > 1e-4) b.yaw = Math.atan2(-(nx - b.x), -(nz - b.z));
        b.x = nx; b.z = nz; b.y = b.fy + (b.ty - b.fy) * e + Math.sin(k * Math.PI) * Math.min(14, 3 + b.dur * 1.4);
        if (k >= 1) { b.st = 'wade'; b.y = b.ty; b.t = 2 + Math.random() * 3; b.tx = b.x; b.tz = b.z; }
        continue;
      }
      for (const q of threats) {
        if (Math.hypot(q.x - b.x, q.z - b.z) < (q.fast ? 16 : 9)) {
          const v = Math.max(0, 1 - Math.hypot(b.x - me.x, b.z - me.z) / 50);
          this.sound?.('honk', v * 0.6); this.sound?.('flap', v);
          this.flyOff(b, q.x, q.z); break;
        }
      }
      if ((b.st as string) === 'fly') continue;
      b.t -= sdt;
      if (b.t <= 0) {
        const r = Math.random();
        if (r < 0.45) {
          // stalk a few steps through the shallows
          for (let k = 0; k < 5; k++) { const a = b.yaw + (Math.random() - 0.5) * 2, l = 1 + Math.random() * 2.5, x = b.x - Math.sin(a) * l, z = b.z - Math.cos(a) * l; if (this.shallow(x, z) !== null) { b.tx = x; b.tz = z; break; } }
          b.st = 'wade'; b.t = 3 + Math.random() * 4;
        } else if (r < 0.8) { b.st = 'feed'; b.t = 3 + Math.random() * 5; }
        else { b.st = 'rest'; b.t = 6 + Math.random() * 10; }
        if (Math.random() < 0.08) this.sound?.('honk', Math.max(0, 1 - Math.hypot(b.x - me.x, b.z - me.z) / 45) * 0.35);
      }
      if (b.st === 'wade') {
        const dx = b.tx - b.x, dz = b.tz - b.z, l = Math.hypot(dx, dz);
        if (l > 0.05) { const s = Math.min(l, 0.45 * sdt); b.x += (dx / l) * s; b.z += (dz / l) * s; b.yaw = Math.atan2(-dx, -dz); }
        b.y = this.shallow(b.x, b.z) ?? b.y;
      }
    }
    this.draw();
  }

  private draw() {
    const d = this.d, w = this.w;
    let n = 0;
    for (const b of this.list) {
      if (b.t < -50) continue;
      const flying = b.st === 'fly' && b.t >= 0;
      d.position.set(b.x, b.y, b.z);
      // feeding: tip forward so the head goes down to the water; flying: stretched out level
      const pitch = flying ? -1.2 : b.st === 'feed' ? -0.75 - 0.1 * Math.sin(b.flap * 3) : b.st === 'rest' ? 0.05 : -0.05 * Math.sin(b.flap * 4);
      d.rotation.set(pitch, b.yaw, 0, 'YXZ');
      d.scale.setScalar(b.s);
      if (flying) d.position.y += 0.9;
      d.updateMatrix();
      this.body.setMatrixAt(n, d.matrix);
      const flap = flying ? Math.sin(b.flap * 7) * 0.8 : -0.1;
      for (const [mesh, s] of [[this.wingR, 1], [this.wingL, -1]] as const) {
        w.position.set(s * 0.12, 1.0, 0.0);
        w.rotation.set(0, flying ? 0 : s * 1.45, s * flap * (flying ? 1 : 0.2), 'YXZ');
        w.scale.set(s, 1, flying ? 1 : 0.55);
        w.updateMatrix();
        _m.multiplyMatrices(d.matrix, w.matrix);
        mesh.setMatrixAt(n, _m);
      }
      n++;
    }
    for (const m of [this.body, this.wingL, this.wingR]) { m.count = n; m.instanceMatrix.needsUpdate = true; }
  }
}
