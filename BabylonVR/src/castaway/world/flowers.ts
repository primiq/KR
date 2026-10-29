// Wild flowers, and the gardens players make with them.
// Eight kinds grow in patches round the island (daisies and poppies in the meadows, hibiscus and birds of paradise by the jungle edge,
// bluebells and orchids up in the shade). Pick one (E) and it goes in your bag; a picked wild flower grows back after about a day.
// Hold a flower and click the ground to plant it: planted flowers stay where you put them (saved, and shared in multiplayer) and can
// be picked up again. Drawing: one instanced mesh per kind, filled only with the flowers near the player (refilled every few metres
// walked), using the grass material so they sway in the wind and part round your legs.
// Babylon port: the field is drawn with Babylon thin instances (render/inst.ts) in the wind-blown foliage material.
import * as THREE from 'three';
import type { Scene } from '@babylonjs/core';
import { Inst } from '../render/inst';
import { foliageMaterial } from '../render/materials';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { heightAt, slopeAt, rockiness, riverDist, inCut } from './island';
import { mulberry32 } from '../core/noise';

import { FLOWERS } from './flowerKinds';
export { FLOWERS };

// ---------------------------------------------------------------- shapes
type Part = THREE.BufferGeometry;
const col = new THREE.Color(), _e = new THREE.Euler(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
function part(g: THREE.BufferGeometry, c: string, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0): Part {
  const n = g.index ? g.toNonIndexed() : g;
  _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e);
  n.applyMatrix4(_m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz)));
  col.set(c);
  const k = n.getAttribute('position').count, a = new Float32Array(k * 3);
  for (let i = 0; i < k; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; }
  n.setAttribute('color', new THREE.BufferAttribute(a, 3));
  n.deleteAttribute('uv');
  return n;
}
const ball = (r = 1) => new THREE.SphereGeometry(r, 5, 4);
const stem = (h: number, c: string, x = 0, z = 0, lean = 0, ry = 0) => part(new THREE.CylinderGeometry(0.006, 0.009, h, 4), c, x + Math.sin(lean) * h * 0.5 * Math.cos(ry), h / 2, z + Math.sin(lean) * h * 0.5 * Math.sin(ry), 1, 1, 1, 0, -ry, lean);
const leaf = (c: string, y: number, ry: number, L = 0.07) => part(ball(), c, Math.cos(ry) * L * 0.8, y, -Math.sin(ry) * L * 0.8, L, 0.008, L * 0.35, 0, ry, -0.5);
function ring(out: Part[], n: number, c: string, x: number, y: number, z: number, len: number, wid: number, tilt: number, cup = 0) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push(part(ball(), c, x + Math.cos(a) * len * 0.9, y + cup * len * 0.6, z - Math.sin(a) * len * 0.9, len, 0.006 + cup * 0.01, wid, 0, a, -tilt - cup));
  }
}

/** One flower of the given kind, base at the origin, with the grass shader's sway / flutter weights. */
export function flowerGeometry(k: number): THREE.BufferGeometry {
  const f = FLOWERS[k], H = f.h, P: Part[] = [];
  switch (k) {
    case 0: // daisy: a few stems, white rays round a yellow eye
      for (const [x, z, l] of [[0, 0, 0], [0.05, 0.03, 0.2], [-0.04, 0.04, -0.25]]) {
        const h = H * (1 - Math.abs(l)), hx = x + Math.sin(l) * h * 0.5, hz = z;
        P.push(stem(h, f.leaf, x, z, l));
        ring(P, 9, f.head, hx * 1.9 - x, h, hz, 0.024, 0.008, 0.15);
        P.push(part(ball(), f.mid, hx * 1.9 - x, h + 0.004, hz, 0.011, 0.007, 0.011));
      }
      P.push(leaf(f.leaf, 0.02, 0.4), leaf(f.leaf, 0.02, 2.5), leaf(f.leaf, 0.02, 4.4));
      break;
    case 1: // poppy: a red cup of four petals on a hairy stem, nodding a little
      P.push(stem(H, f.leaf, 0, 0, 0.12));
      ring(P, 4, f.head, 0.025, H, 0, 0.032, 0.03, 0, 0.5);
      P.push(part(ball(), f.mid, 0.025, H + 0.006, 0, 0.012, 0.012, 0.012));
      P.push(stem(H * 0.7, f.leaf, 0.04, 0.02, -0.2), part(ball(), '#6f9a3a', 0.04 - 0.05, H * 0.7, 0.02, 0.012, 0.018, 0.012));   // a bud
      P.push(leaf(f.leaf, 0.03, 0.8, 0.09), leaf(f.leaf, 0.03, 3.6, 0.09));
      break;
    case 2: // bluebell: an arching stem hung with little bells
      P.push(stem(H, f.leaf, 0, 0, 0.25));
      for (let i = 0; i < 5; i++) {
        const t = 0.55 + i * 0.1, x = Math.sin(0.25 + t * 0.6) * H * t * 0.6, y = H * t;
        P.push(part(new THREE.ConeGeometry(0.014, 0.03, 6, 1, true), i % 2 ? f.head : f.mid, x + 0.012, y - 0.02, (i % 2 ? 1 : -1) * 0.008, 1, 1, 1, 0, 0, 0.2));
      }
      for (const a of [0.3, 1.9, 3.4, 4.9]) P.push(part(ball(), f.leaf, Math.cos(a) * 0.06, 0.03, -Math.sin(a) * 0.06, 0.09, 0.006, 0.014, 0, a, -0.8));
      break;
    case 3: // sunflower: a tall stalk, broad leaves, a big face turned to the sun
      P.push(part(new THREE.CylinderGeometry(0.016, 0.026, H, 6), f.leaf, 0, H / 2, 0));
      for (const [y, a] of [[0.25, 0.5], [0.42, 2.6], [0.58, 4.4], [0.74, 1.4]]) P.push(part(ball(), f.leaf, Math.cos(a) * 0.14, H * y, -Math.sin(a) * 0.14, 0.17, 0.01, 0.11, 0, a, -0.3));
      {
        // a big face (about 30 cm across), built looking straight up, then tipped over to look sideways and up
        const face: Part[] = [part(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 14), f.mid, 0, 0, 0), part(new THREE.CylinderGeometry(0.11, 0.08, 0.04, 14), '#3f6a2a', 0, -0.04, 0)];
        // petals all round the rim of the disc (not hidden under it)
        for (let i = 0; i < 18; i++) { const an = (i / 18) * Math.PI * 2; face.push(part(ball(), f.head, Math.cos(an) * 0.15, 0.004, -Math.sin(an) * 0.15, 0.065, 0.007, 0.026, 0, an, 0)); }
        const tip = new THREE.Matrix4().compose(new THREE.Vector3(0.05, H, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -1.1)), new THREE.Vector3(1, 1, 1));
        for (const q of face) P.push(q.applyMatrix4(tip));
      }
      break;
    case 4: // hibiscus: a leafy little shrub with a couple of big open trumpets
      for (const [x, z, a] of [[0, 0, 0], [0.08, 0.05, 2.1], [-0.07, 0.06, 4.2], [0.02, -0.08, 5.5]]) P.push(part(ball(), f.leaf, x, H * 0.45, z, 0.1, 0.07, 0.08, 0, a, 0.3));
      for (const [x, z, y] of [[0.06, 0.02, H], [-0.06, -0.04, H * 0.85]]) {
        ring(P, 5, f.head, x, y, z, 0.05, 0.035, -0.1, 0.25);
        P.push(part(new THREE.CylinderGeometry(0.003, 0.003, 0.06, 3), f.mid, x, y + 0.035, z, 1, 1, 1, 0, 0, 0.3));
      }
      break;
    case 5: // lavender: a tuft of grey-green spikes topped with purple beads
      for (let j = 0; j < 5; j++) {
        const a = j * 1.26, l = 0.12 + (j % 2) * 0.08, x = Math.cos(a) * 0.02, z = Math.sin(a) * 0.02, h = H * (0.8 + (j % 3) * 0.1);
        P.push(stem(h, f.leaf, x, z, l, a));
        const tx = x + Math.sin(l) * h * Math.cos(a), tz = z + Math.sin(l) * h * Math.sin(a);
        for (let i = 0; i < 4; i++) P.push(part(ball(), i % 2 ? f.head : f.mid, tx - Math.sin(l) * Math.cos(a) * i * 0.022, h - i * 0.022, tz - Math.sin(l) * Math.sin(a) * i * 0.022, 0.011, 0.016, 0.011));
      }
      break;
    case 6: // orchid: broad leaves at the foot, an arching spray of white and magenta blooms
      P.push(part(ball(), f.leaf, 0.05, 0.02, 0, 0.09, 0.01, 0.035, 0, 0.2, 0), part(ball(), f.leaf, -0.05, 0.02, 0.01, 0.09, 0.01, 0.035, 0, 2.9, 0));
      P.push(stem(H, '#4a6a2a', 0, 0, 0.3));
      for (let i = 0; i < 3; i++) {
        const t = 0.7 + i * 0.13, x = Math.sin(0.3) * H * t + i * 0.02, y = H * t;
        ring(P, 5, f.head, x, y, 0, 0.022, 0.016, -1.2);
        P.push(part(ball(), f.mid, x + 0.008, y, 0, 0.01, 0.012, 0.01));
      }
      break;
    case 7: // bird of paradise: stiff paddle leaves, an orange crest and a blue tongue on a beak-shaped bract
      for (const a of [0.4, 1.9, 3.3, 4.8]) P.push(part(ball(), f.leaf, Math.cos(a) * 0.05, H * 0.45, -Math.sin(a) * 0.05, 0.035, 0.22, 0.012, 0, a, 0.25));
      P.push(part(new THREE.CylinderGeometry(0.008, 0.011, H, 4), f.leaf, 0, H / 2, 0));
      P.push(part(ball(), '#3f6a3a', 0.04, H, 0, 0.07, 0.014, 0.016, 0, 0, 0.25));
      for (let i = 0; i < 3; i++) P.push(part(new THREE.ConeGeometry(0.01, 0.1, 4), f.head, 0.03 + i * 0.012, H + 0.05, (i - 1) * 0.012, 1, 1, 1, 0, 0, -0.6 + i * 0.25));
      P.push(part(new THREE.ConeGeometry(0.008, 0.07, 4), f.mid, 0.06, H + 0.03, 0, 1, 1, 1, 0, 0, -1.0));
      break;
  }
  const g = mergeGeometries(P)!;
  // sway: nothing at the root, most at the head; flutter for the petals
  const pos = g.getAttribute('position'), n = pos.count, sw = new Float32Array(n), fl = new Float32Array(n), top = H * 1.1;
  for (let i = 0; i < n; i++) { const t = Math.max(0, Math.min(1, pos.getY(i) / top)); sw[i] = t * t * 0.9; fl[i] = t * 0.35; }
  g.setAttribute('sway', new THREE.BufferAttribute(sw, 1));
  g.setAttribute('flutter', new THREE.BufferAttribute(fl, 1));
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------- the field
export interface Wild { x: number; y: number; z: number; k: number; rot: number; s: number }
export interface Planted { nid: string; k: number; x: number; y: number; z: number; rot: number }
export type FlowerHit = { wild: number; planted?: undefined; k: number; x: number; y: number; z: number } | { wild?: undefined; planted: Planted; k: number; x: number; y: number; z: number };

const CELL = 16;
const REGROW = 1200;      // seconds of play before a picked wild flower is back (about a game day)
const MAX_PLANTED = 900;

export class Flowers {
  readonly wild: Wild[] = [];
  readonly planted: Planted[] = [];
  /** picked wild flowers: index -> seconds until it grows back */
  readonly picked = new Map<number, number>();
  onPickWild: ((i: number) => void) | null = null;
  onPlant: ((p: Planted) => void) | null = null;
  onUnplant: ((p: Planted) => void) | null = null;
  idPrefix = 'f';
  private ids = 0;
  private cells = new Map<string, number[]>();
  private meshes: Inst[] = [];
  private caps: number[] = [];
  /** what is drawn right now (the targets for picking): wild indices and planted flowers */
  private near: number[] = [];
  private nearP: Planted[] = [];
  private at = { x: 1e9, z: 1e9 };
  private dirty = true;
  private d = new THREE.Object3D();
  private radius: number;

  constructor(scene: Scene, radius: number, shadows: boolean, count: number) {
    this.radius = radius;
    const mat = foliageMaterial(scene, 'flower', 0.5, true, 0.35);
    FLOWERS.forEach((_, k) => {
      const cap = k === 3 ? 160 : 700;
      const m = new Inst(`flower${k}`, flowerGeometry(k), mat, cap, scene);
      m.count = 0; m.mesh.alwaysSelectAsActiveMesh = true; m.mesh.receiveShadows = shadows;
      this.meshes.push(m); this.caps.push(cap);
    });
    this.scatter(count);
  }

  /** the same patches on every client (seeded), so wild flowers can be referred to by index */
  private scatter(count: number) {
    const rnd = mulberry32(4242);
    let tries = 0;
    while (this.wild.length < count && tries++ < 40000) {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 330, cx = Math.cos(a) * r, cz = Math.sin(a) * r;
      const h = heightAt(cx, cz);
      if (h < 2.6 || h > 34 || slopeAt(cx, cz) > 0.45 || rockiness(cx, cz) > 0.25 || riverDist(cx, cz) < 2.5) continue;
      // what grows here: meadows low down, the jungle-edge flowers higher up, the shade lovers higher still
      const u = rnd();
      const k = h < 5 ? (u < 0.4 ? 0 : u < 0.6 ? 4 : u < 0.8 ? 5 : u < 0.9 ? 1 : 3)
        : h < 11 ? (u < 0.28 ? 1 : u < 0.5 ? 0 : u < 0.65 ? 3 : u < 0.8 ? 7 : u < 0.9 ? 5 : 4)
          : (u < 0.35 ? 2 : u < 0.6 ? 6 : u < 0.8 ? 7 : u < 0.9 ? 1 : 0);
      const n = k === 3 ? 2 + Math.floor(rnd() * 3) : 5 + Math.floor(rnd() * 10), spread = k === 3 ? 1.6 : 1.2 + rnd() * 2.4;
      for (let i = 0; i < n && this.wild.length < count; i++) {
        const b = rnd() * Math.PI * 2, q = Math.sqrt(rnd()) * spread, x = cx + Math.cos(b) * q, z = cz + Math.sin(b) * q;
        const y = heightAt(x, z);
        if (y < 2.4 || slopeAt(x, z) > 0.5) continue;
        const kk = rnd() < 0.08 ? Math.floor(rnd() * 8) : k;   // the odd stray
        const w: Wild = { x, y, z, k: kk, rot: rnd() * 6.28, s: 1.1 + rnd() * 0.55 };
        const key = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
        let l = this.cells.get(key); if (!l) this.cells.set(key, (l = [])); l.push(this.wild.length);
        this.wild.push(w);
      }
    }
  }

  update(dt: number, px: number, pz: number, active: boolean) {
    for (const [i, t] of this.picked) { const r = t - dt; if (r <= 0) { this.picked.delete(i); this.dirty = true; } else this.picked.set(i, r); }
    for (const m of this.meshes) m.visible = active;
    if (!active) return;
    if (!this.dirty && Math.hypot(px - this.at.x, pz - this.at.z) < 5) return;
    this.dirty = false; this.at.x = px; this.at.z = pz;
    const R = this.radius, R2 = R * R, counts = this.meshes.map(() => 0), d = this.d;
    this.near.length = 0; this.nearP.length = 0;
    const put = (k: number, x: number, y: number, z: number, rot: number, s: number) => {
      if (counts[k] >= this.caps[k]) return false;
      d.position.set(x, y - 0.02, z); d.rotation.set(0, rot, 0); d.scale.setScalar(s); d.updateMatrix();
      this.meshes[k].setMatrixAt(counts[k]++, d.matrix);
      return true;
    };
    // your own garden first, so it is never crowded out
    for (const p of this.planted) {
      const dx = p.x - px, dz = p.z - pz;
      if (dx * dx + dz * dz > R2) continue;
      if (put(p.k, p.x, p.y, p.z, p.rot, 1.35)) this.nearP.push(p);
    }
    const c0 = Math.floor((px - R) / CELL), c1 = Math.floor((px + R) / CELL), r0 = Math.floor((pz - R) / CELL), r1 = Math.floor((pz + R) / CELL);
    for (let i = c0; i <= c1; i++) for (let j = r0; j <= r1; j++) {
      const l = this.cells.get(`${i},${j}`);
      if (!l) continue;
      for (const wi of l) {
        if (this.picked.has(wi)) continue;
        const w = this.wild[wi], dx = w.x - px, dz = w.z - pz;
        if (dx * dx + dz * dz > R2 || inCut(w.x, w.z, 0.3)) continue;
        if (put(w.k, w.x, w.y, w.z, w.rot, w.s)) this.near.push(wi);
      }
    }
    this.meshes.forEach((m, k) => { m.count = counts[k]; m.instanceMatrix.needsUpdate = true; });
  }

  /** the flower under the crosshair */
  find(eye: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, reach: number, assist = 1): { hit: FlowerHit; dist: number } | null {
    let best: FlowerHit | null = null, bt = reach;
    const test = (x: number, y: number, z: number, k: number, s: number) => {
      const ex = x - eye.x, ez = z - eye.z;
      if (ex * ex + ez * ez > (reach + 1) * (reach + 1)) return -1;
      const cy = y + FLOWERS[k].h * s * 0.7, r = Math.max(0.16, FLOWERS[k].h * s * 0.45) * assist;
      const lx = x - eye.x, ly = cy - eye.y, lz = z - eye.z, tca = lx * dir.x + ly * dir.y + lz * dir.z;
      const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
      if (tca < 0 || d2 > r * r) return -1;
      return tca - Math.sqrt(r * r - d2);
    };
    for (const wi of this.near) {
      const w = this.wild[wi], t = test(w.x, w.y, w.z, w.k, w.s);
      if (t >= 0 && t < bt) { bt = t; best = { wild: wi, k: w.k, x: w.x, y: w.y, z: w.z }; }
    }
    for (const p of this.nearP) {
      const t = test(p.x, p.y, p.z, p.k, 1.35);
      if (t >= 0 && t < bt) { bt = t; best = { planted: p, k: p.k, x: p.x, y: p.y, z: p.z }; }
    }
    return best ? { hit: best, dist: bt } : null;
  }

  pickWild(i: number, remote = false) {
    if (!this.wild[i] || this.picked.has(i)) return false;
    this.picked.set(i, REGROW * (0.8 + Math.random() * 0.4)); this.dirty = true;
    if (!remote) this.onPickWild?.(i);
    return true;
  }

  /** can a flower go here? '' when yes, or the reason */
  check(x: number, z: number): string {
    const h = heightAt(x, z);
    if (h < 0.3) return 'Too close to the water';
    if (slopeAt(x, z) > 0.75) return 'Too steep';
    if (this.planted.length >= MAX_PLANTED) return 'The island has enough planted flowers';
    for (const p of this.planted) if (Math.abs(p.x - x) < 0.14 && Math.abs(p.z - z) < 0.14) return 'Too close to another flower';
    return '';
  }

  plant(k: number, x: number, y: number, z: number, opts: { nid?: string; rot?: number; remote?: boolean } = {}): Planted | null {
    if (opts.nid && this.planted.some((p) => p.nid === opts.nid)) return null;
    const p: Planted = { nid: opts.nid ?? `${this.idPrefix}${Date.now().toString(36)}-${this.ids++}`, k, x, y, z, rot: opts.rot ?? Math.random() * 6.28 };
    this.planted.push(p); this.dirty = true;
    if (!opts.remote) this.onPlant?.(p);
    return p;
  }

  unplant(nid: string, remote = false) {
    const i = this.planted.findIndex((p) => p.nid === nid);
    if (i < 0) return null;
    const [p] = this.planted.splice(i, 1); this.dirty = true;
    if (!remote) this.onUnplant?.(p);
    return p;
  }

  // ---------------------------------------------------------------- save / join snapshot
  capture() {
    return {
      w: [...this.picked].map(([i, t]) => [i, Math.round(t)]),
      p: this.planted.map((p) => [p.nid, p.k, +p.x.toFixed(2), +p.y.toFixed(3), +p.z.toFixed(2), +p.rot.toFixed(2)]),
    };
  }
  restore(s: any) {
    if (!s) return;
    this.picked.clear(); this.planted.length = 0;
    for (const [i, t] of s.w ?? []) this.picked.set(i, t);
    for (const [nid, k, x, y, z, rot] of s.p ?? []) this.planted.push({ nid, k, x, y, z, rot });
    this.dirty = true;
  }
}
