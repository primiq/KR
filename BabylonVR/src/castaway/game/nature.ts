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
type FlState = 'wade' | 'feed' | 'rest' | 'preen' | 'stretch' | 'fly';
interface Flamingo {
  x: number; y: number; z: number; yaw: number; st: FlState;
  t: number; tx: number; tz: number; flock: number; fx: number; fy: number; fz: number; ty: number; dur: number; flap: number; s: number;
  /** the pose, eased towards each state's: neck (lower, upper, turn), legs (hip, knee: left, right), wings open 0..1, step phase */
  n1: number; n2: number; ny: number; hip: [number, number]; knee: [number, number]; wing: number; phase: number; side: number; moving: number;
}
const FL_CAP = 30;

/** a flamingo in parts, each drawn as one instanced mesh for the whole flock (pivots at their joints) */
function flamingoParts() {
  const pink = '#f48aa8', deep = '#e0607e', pale = '#fbc2cf', leg = '#e8728c';
  // the body, its pivot in the middle (head towards -z); a paler breast and a dark-tipped tail
  const torso = new Mesher();
  torso.sph(0.2, pink, 0, 0, 0, 0.75, 0.62, 1.15, 12);
  torso.sph(0.13, pale, 0, -0.02, -0.12, 0.85, 0.7, 0.8, 9);
  torso.sph(0.12, deep, 0, 0.03, 0.2, 0.7, 0.5, 0.9, 8);
  torso.sph(0.06, '#2a1d22', 0, 0.02, 0.29, 0.8, 0.4, 0.8, 6);
  // the lower neck, from the chest up; the upper neck with the head on it, from the bend
  const neck1 = new Mesher();
  neck1.cyl(0.028, 0.038, 0.3, pink, 0, 0.15, 0, 1, 1, 7);
  neck1.sph(0.03, pink, 0, 0.3, 0, 1, 1, 1, 6);
  const neck2 = new Mesher();
  neck2.cyl(0.025, 0.029, 0.26, pink, 0, 0.13, 0, 1, 1, 7);
  neck2.sph(0.055, pale, 0, 0.27, -0.03, 0.9, 0.9, 1.2, 8);                          // head
  neck2.cyl(0.018, 0.026, 0.12, '#f3e6dc', 0, 0.23, -0.1, 1, 1, 6, 1.9);            // the bent beak
  neck2.cyl(0.012, 0.018, 0.05, '#1a1a1a', 0, 0.19, -0.16, 1, 1, 5, 2.6);           // its black tip
  for (const sd of [-1, 1]) neck2.sph(0.011, '#1a1a1a', sd * 0.04, 0.29, -0.06, 1, 1, 1, 5);
  // a leg: the thigh from the hip to the backward "knee" (the ankle), and the shin and foot below it
  const legU = new Mesher();
  legU.cyl(0.014, 0.016, 0.44, leg, 0, -0.22, 0, 1, 1, 6);
  legU.sph(0.022, deep, 0, -0.44, 0, 1, 1, 1, 6);
  const legL = new Mesher();
  legL.cyl(0.011, 0.013, 0.42, leg, 0, -0.21, 0, 1, 1, 6);
  legL.box(0.075, 0.014, 0.11, deep, 0, -0.42, -0.04);
  // a wing: feathered outline, pink coverts and black flight feathers at the tip and trailing edge (span along +x)
  const wingM = new Mesher();
  const shape = (pts: number[][]) => { const sh = new THREE.Shape(); sh.moveTo(pts[0][0], pts[0][1]); for (const q of pts.slice(1)) sh.lineTo(q[0], q[1]); return new THREE.ShapeGeometry(sh).rotateX(Math.PI / 2); };
  wingM.add(shape([[0, -0.07], [0.16, -0.1], [0.36, -0.07], [0.48, -0.02], [0.44, 0.04], [0.32, 0.07], [0.2, 0.11], [0.06, 0.12], [0, 0.1]]), pink);
  wingM.add(shape([[0.34, -0.065], [0.5, -0.04], [0.62, 0.0], [0.6, 0.03], [0.5, 0.05], [0.44, 0.06], [0.4, 0.04]]).translate(0, 0.002, 0), '#1e1418');
  wingM.add(shape([[0.06, 0.1], [0.2, 0.1], [0.34, 0.06], [0.44, 0.05], [0.4, 0.1], [0.24, 0.15], [0.08, 0.15]]).translate(0, -0.002, 0), '#2a1d22');
  const built = { torso: torso.build(false), neck1: neck1.build(false), neck2: neck2.build(false), legU: legU.build(false), legL: legL.build(false), wing: wingM.build(false) };
  (built.wing.material as THREE.Material).side = THREE.DoubleSide;
  return built;
}

const _fq = new THREE.Quaternion(), _fq2 = new THREE.Quaternion(), _fe = new THREE.Euler(), _fm = new THREE.Matrix4(), _fm2 = new THREE.Matrix4(), _fv = new THREE.Vector3(), _fs = new THREE.Vector3(1, 1, 1);
const _fz = new THREE.Vector3(0, 0, 1);
const _foldQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(1.35, -1.4, 0, 'YXZ'));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

export class Flamingos {
  readonly group = new THREE.Group();
  private list: Flamingo[] = [];
  private parts: Record<'torso' | 'neck1' | 'neck2' | 'legU' | 'legL' | 'wing', THREE.InstancedMesh>;
  private spawnT = 3;
  private flocks = 0;
  sound: ((kind: 'honk' | 'flap', vol: number) => void) | null = null;

  constructor() {
    const b = flamingoParts();
    const inst = (m: THREE.Mesh, n: number) => { const im = new THREE.InstancedMesh(m.geometry, m.material as THREE.Material, n); im.count = 0; im.frustumCulled = false; this.group.add(im); return im; };
    this.parts = { torso: inst(b.torso, FL_CAP), neck1: inst(b.neck1, FL_CAP), neck2: inst(b.neck2, FL_CAP), legU: inst(b.legU, FL_CAP * 2), legL: inst(b.legL, FL_CAP * 2), wing: inst(b.wing, FL_CAP * 2) };
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
        this.list.push({ x, y: h, z, yaw: Math.random() * 6.28, st: 'wade', t: Math.random() * 4, tx: x, tz: z, flock: f, fx: x, fy: h, fz: z, ty: h, dur: 1, flap: Math.random() * 6, s: 0.92 + Math.random() * 0.16,
          n1: 0.12, n2: -0.25, ny: 0, hip: [0, 0], knee: [0, 0], wing: 0, phase: Math.random() * 6, side: Math.random() < 0.5 ? -1 : 1, moving: 0 });
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

  /** a few steps somewhere nearby in the shallows */
  private stroll(b: Flamingo, far = 1) {
    for (let k = 0; k < 6; k++) {
      const a = b.yaw + (Math.random() - 0.5) * 2.6, l = (1 + Math.random() * 3) * far, x = b.x - Math.sin(a) * l, z = b.z - Math.cos(a) * l;
      if (this.shallow(x, z) !== null) { b.tx = x; b.tz = z; return; }
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
        b.t += sdt;
        if (b.t >= 0) {
          const k = Math.min(1, b.t / b.dur), e = k * k * (3 - 2 * k);
          const nx = b.fx + (b.tx - b.fx) * e, nz = b.fz + (b.tz - b.fz) * e;
          if (Math.hypot(nx - b.x, nz - b.z) > 1e-4) b.yaw = Math.atan2(-(nx - b.x), -(nz - b.z));
          b.x = nx; b.z = nz; b.y = b.fy + (b.ty - b.fy) * e + Math.sin(k * Math.PI) * Math.min(14, 3 + b.dur * 1.4);
          if (k >= 1) { b.st = 'wade'; b.y = b.ty; b.t = 2 + Math.random() * 3; b.tx = b.x; b.tz = b.z; }
        }
        this.pose(b, sdt);
        continue;
      }
      for (const q of threats) {
        if (Math.hypot(q.x - b.x, q.z - b.z) < (q.fast ? 16 : 9)) {
          const v = Math.max(0, 1 - Math.hypot(b.x - me.x, b.z - me.z) / 50);
          this.sound?.('honk', v * 0.6); this.sound?.('flap', v);
          this.flyOff(b, q.x, q.z); break;
        }
      }
      if ((b.st as string) === 'fly') { this.pose(b, sdt); continue; }
      b.t -= sdt;
      if (b.t <= 0) {
        // left alone: mostly strolling about the shallows and feeding as it goes, now and then a rest on one leg, a preen,
        // a good stretch of the wings
        const r = Math.random();
        if (r < 0.42) { this.stroll(b); b.st = 'wade'; b.t = 3 + Math.random() * 5; }
        else if (r < 0.72) { this.stroll(b, 0.5); b.st = 'feed'; b.t = 4 + Math.random() * 6; }
        else if (r < 0.84) { b.st = 'rest'; b.t = 7 + Math.random() * 10; b.side = Math.random() < 0.5 ? -1 : 1; b.tx = b.x; b.tz = b.z; }
        else if (r < 0.94) { b.st = 'preen'; b.t = 2.5 + Math.random() * 3; b.side = Math.random() < 0.5 ? -1 : 1; b.tx = b.x; b.tz = b.z; }
        else { b.st = 'stretch'; b.t = 2.2; b.flap = 0; b.tx = b.x; b.tz = b.z; }
        if (Math.random() < 0.08) this.sound?.('honk', Math.max(0, 1 - Math.hypot(b.x - me.x, b.z - me.z) / 45) * 0.35);
      }
      // walking (wading at a stately pace, slower while feeding)
      const dx = b.tx - b.x, dz = b.tz - b.z, l = Math.hypot(dx, dz);
      const speed = b.st === 'wade' ? 0.42 : b.st === 'feed' ? 0.14 : 0;
      if (l > 0.05 && speed > 0) {
        const s = Math.min(l, speed * sdt);
        b.x += (dx / l) * s; b.z += (dz / l) * s;
        let dy = Math.atan2(-dx, -dz) - b.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        b.yaw += dy * Math.min(1, sdt * 3);
        b.phase += (s / 0.3) * Math.PI;
        b.moving = Math.min(1, b.moving + sdt * 4);
      } else b.moving = Math.max(0, b.moving - sdt * 4);
      b.y = this.shallow(b.x, b.z) ?? b.y;
      this.pose(b, sdt);
    }
    this.draw();
  }

  /** ease the bird's joints towards what it is doing */
  private pose(b: Flamingo, dt: number) {
    const t = b.flap, k = Math.min(1, dt * 5), mv = b.moving, ph = b.phase;
    let n1 = 0.12 + 0.03 * Math.sin(t * 0.7), n2 = -0.25, ny = 0.15 * Math.sin(t * 0.31), wing = 0;
    const hip: [number, number] = [0, 0], knee: [number, number] = [0, 0];
    // a stride: one leg forward as the other goes back, the lifted one's knee bending back; the neck bobs with each step
    const stepL = Math.sin(ph), stepR = Math.sin(ph + Math.PI);
    hip[0] = 0.42 * stepL * mv; hip[1] = 0.42 * stepR * mv;
    knee[0] = -0.9 * Math.max(0, -Math.cos(ph)) * mv; knee[1] = -0.9 * Math.max(0, Math.cos(ph)) * mv;
    n1 += 0.1 * Math.sin(ph * 2) * mv;
    switch (b.st) {
      case 'feed':
        // head right down in the water, sweeping side to side (the body stays level on its legs)
        n1 = -2.15; n2 = -0.75 + 0.1 * Math.sin(t * 2.3); ny = 0.35 * Math.sin(t * 1.6);
        break;
      case 'rest': {
        // on one leg, the other tucked up under the body; the head laid back along it
        const i = b.side < 0 ? 0 : 1;
        hip[i] = -0.55; knee[i] = 2.6; hip[1 - i] = 0; knee[1 - i] = 0;
        n1 = 0.7 + 0.03 * Math.sin(t * 0.9); n2 = 2.25; ny = 0;
        break;
      }
      case 'preen':
        n1 = 0.45; n2 = 1.5; ny = b.side * 1.3 + 0.2 * Math.sin(t * 6); wing = 0.15;
        break;
      case 'stretch':
        // wings spread wide and beat slowly a couple of times, neck up
        wing = Math.min(1, b.flap * 2.5) * Math.min(1, Math.max(0, (2.2 - b.flap) * 2.5)); n1 = 0.35; n2 = 0.1;
        break;
      case 'fly':
        if (b.t >= 0) { n1 = -1.45; n2 = 0.05; ny = 0; wing = 1; hip[0] = hip[1] = -1.45; knee[0] = knee[1] = 0; }
        break;
    }
    b.n1 = lerp(b.n1, n1, k); b.n2 = lerp(b.n2, n2, k); b.ny = lerp(b.ny, ny, k);
    for (let i = 0; i < 2; i++) { b.hip[i] = lerp(b.hip[i], hip[i], b.st === 'wade' || b.st === 'feed' ? Math.min(1, dt * 12) : k); b.knee[i] = lerp(b.knee[i], knee[i], b.st === 'wade' || b.st === 'feed' ? Math.min(1, dt * 12) : k); }
    b.wing = lerp(b.wing, wing, Math.min(1, dt * 4));
  }

  private draw() {
    let n = 0;
    const P = this.parts, M = new THREE.Matrix4(), part = (mesh: THREE.InstancedMesh, i: number, local: THREE.Matrix4) => { _fm2.multiplyMatrices(M, local); mesh.setMatrixAt(i, _fm2); };
    for (const b of this.list) {
      if (b.t < -50) continue;
      const flying = b.st === 'fly' && b.t >= 0;
      // the bird: its feet at (x, y, z), facing yaw; flying, a little higher (legs trailing behind it)
      _fq.setFromAxisAngle(_up, b.yaw);
      M.compose(_fv.set(b.x, b.y + (flying ? 0.5 : 0), b.z), _fq, _fs.set(b.s, b.s, b.s));
      // the body bobs a little with each step, and breathes
      const bob = 0.012 * Math.abs(Math.sin(b.phase)) * b.moving + 0.004 * Math.sin(b.flap * 1.3);
      part(P.torso, n, _fm.makeTranslation(0, 0.95 + bob, 0));
      // the neck: from the chest, turned, bent; the upper neck and head from the bend
      _fe.set(b.n1, b.ny, 0, 'YXZ'); _fq2.setFromEuler(_fe);
      const n1m = new THREE.Matrix4().compose(_fv.set(0, 1.06 + bob, -0.17), _fq2, _fs.set(1, 1, 1));
      part(P.neck1, n, n1m);
      _fe.set(b.n2, 0, 0); _fq2.setFromEuler(_fe);
      const n2m = n1m.clone().multiply(new THREE.Matrix4().compose(_fv.set(0, 0.3, 0), _fq2, _fs.set(1, 1, 1)));
      part(P.neck2, n, n2m);
      // the legs: thigh from the hip, shin from the knee
      for (let i = 0; i < 2; i++) {
        const sd = i === 0 ? -1 : 1;
        _fe.set(b.hip[i], 0, 0); _fq2.setFromEuler(_fe);
        const up = new THREE.Matrix4().compose(_fv.set(sd * 0.06, 0.86 + bob, 0.02), _fq2, _fs.set(1, 1, 1));
        part(P.legU, n * 2 + i, up);
        _fe.set(b.knee[i], 0, 0); _fq2.setFromEuler(_fe);
        part(P.legL, n * 2 + i, up.clone().multiply(new THREE.Matrix4().compose(_fv.set(0, -0.44, 0), _fq2, _fs.set(1, 1, 1))));
      }
      // the wings: folded flat along the sides, or spread and beating (the left one the right one mirrored)
      const flapA = flying ? Math.sin(b.flap * 7) * 0.8 : b.st === 'stretch' ? Math.sin(b.flap * 3) * 0.45 + 0.2 : 0;
      _fq2.setFromAxisAngle(_fz, flapA);
      const q = _foldQ.clone().slerp(_fq2, b.wing);
      for (let i = 0; i < 2; i++) {
        const sd = i === 0 ? -1 : 1;
        const wm = new THREE.Matrix4().compose(_fv.set(sd * 0.11, 1.0 + bob, -0.06), new THREE.Quaternion(), _fs.set(1, 1, 1));
        if (sd < 0) wm.multiply(new THREE.Matrix4().makeScale(-1, 1, 1));
        wm.multiply(new THREE.Matrix4().makeRotationFromQuaternion(q));
        part(P.wing, n * 2 + i, wm);
      }
      n++;
    }
    P.torso.count = P.neck1.count = P.neck2.count = n;
    P.legU.count = P.legL.count = P.wing.count = n * 2;
    for (const m of Object.values(P)) m.instanceMatrix.needsUpdate = true;
  }
}
