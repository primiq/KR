// Ported from Castaway unchanged in behaviour: the rigs are three.js objects animated here and drawn by render/mirror.ts.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { heightAt, slopeAt } from '../world/island';
import { mulberry32 } from '../core/noise';
import type { ColliderGrid } from '../world/vegetation';
import type { ItemId } from './items';

export type AnimalKind = 'crab' | 'boar' | 'jaguar';
export type AnimalSound = 'click' | 'snort' | 'squeal' | 'grunt' | 'growl' | 'roar' | 'gull' | 'die' | 'creep' | 'hiss' | 'sing';

interface Def {
  name: string; hp: number; radius: number; hitR: number; hitY: number; hitSpread: number;
  loot: [ItemId, number, number]; respawn: number; minH: number;
  /** a second drop: hides for armor */
  extra?: [ItemId, number, number];
}
const DEFS: Record<AnimalKind, Def> = {
  crab: { name: 'Beach Crab', hp: 12, radius: 0.22, hitR: 0.3, hitY: 0.12, hitSpread: 0, loot: ['raw_meat', 1, 1], respawn: 150, minH: -0.35 },
  boar: { name: 'Wild Boar', hp: 80, radius: 0.5, hitR: 0.55, hitY: 0.55, hitSpread: 0.3, loot: ['raw_meat', 3, 4], extra: ['leather', 1, 2], respawn: 300, minH: 1.2 },
  jaguar: { name: 'Jaguar', hp: 170, radius: 0.45, hitR: 0.5, hitY: 0.62, hitSpread: 0.35, loot: ['raw_meat', 3, 5], extra: ['leather', 2, 3], respawn: 480, minH: 1.2 },
};

// ------------------------------------------------------------------ geometry kit (everything is vertex-coloured and merged)
const _c = new THREE.Color();
function part(g: THREE.BufferGeometry, hex: string | number, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g.clone();
  geo.deleteAttribute('uv');
  geo.scale(sx, sy, sz);
  if (rx) geo.rotateX(rx);
  if (ry) geo.rotateY(ry);
  if (rz) geo.rotateZ(rz);
  geo.translate(x, y, z);
  const n = geo.attributes.position.count, c = new Float32Array(n * 3);
  _c.set(hex);
  for (let i = 0; i < n; i++) { c[i * 3] = _c.r; c[i * 3 + 1] = _c.g; c[i * 3 + 2] = _c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  geo.setAttribute('pat', new THREE.BufferAttribute(new Float32Array(n), 1));
  return geo;
}
const merge = (p: THREE.BufferGeometry[]) => { const g = mergeGeometries(p)!; g.computeBoundingSphere(); return g; };
const SPH = new THREE.IcosahedronGeometry(1, 2);
const SPH1 = new THREE.IcosahedronGeometry(1, 1);
const cyl = (r0: number, r1: number, h: number, seg = 7) => new THREE.CylinderGeometry(r0, r1, h, seg);
const cone = (r: number, h: number, seg = 6) => new THREE.ConeGeometry(r, h, seg);

/** stand-in: the Babylon side draws every animal with one vertex-coloured fur material (see render/mirror.ts) */
const MAT = new THREE.MeshBasicMaterial({ name: 'animal' });
const animalMat = () => MAT;

/** a leg that hangs from y=0 down to y=-len */
export function legGeo(len: number, r0: number, r1: number, hex: string, foot: string, footS = 1) {
  return merge([
    part(cyl(r0, r1, len, 6), hex, 0, -len / 2, 0),
    part(SPH1, foot, 0, -len, r1 * 0.6, r1 * 1.5 * footS, r1 * 0.9, r1 * 2.1 * footS),
  ]);
}

interface Leg { m: THREE.Mesh; ph: number; amp: number; lower?: THREE.Mesh; u0?: number; l0?: number }
interface Rig { root: THREE.Group; body: THREE.Mesh; legs: Leg[]; head?: THREE.Mesh; tail?: THREE.Mesh; wingL?: THREE.Mesh; wingR?: THREE.Mesh; scale: number }

function mk(g: THREE.BufferGeometry, shadows: boolean, cast = true) {
  const m = new THREE.Mesh(g, animalMat());
  // (frustum culling on: an animal behind you is not drawn; its parts are small rigid meshes, so their bounds are cheap and exact)
  m.castShadow = shadows && cast; m.receiveShadow = shadows;
  return m;
}

// ---- lofted bodies: smooth tubes through elliptical cross-sections (so necks, bellies and snouts flow into each other)
interface Sec { z: number; y: number; rx: number; ry: number; x?: number }
type ColFn = (x: number, y: number, z: number, up: number) => THREE.Color;
const cr = (a: number, b: number, c: number, d: number, t: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
const spow = (v: number, p: number) => Math.sign(v) * Math.pow(Math.abs(v), p);
function loft(secs: Sec[], color: ColFn, pat = 0, seg = 14, sub = 4, pw = 0.85): THREE.BufferGeometry {
  const n = secs.length, rings: Sec[] = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = secs[Math.max(i - 1, 0)], p1 = secs[i], p2 = secs[i + 1], p3 = secs[Math.min(i + 2, n - 1)];
    for (let k = 0; k < sub; k++) {
      const t = k / sub;
      rings.push({
        z: p1.z + (p2.z - p1.z) * t,
        y: cr(p0.y, p1.y, p2.y, p3.y, t),
        rx: Math.max(0.004, cr(p0.rx, p1.rx, p2.rx, p3.rx, t)),
        ry: Math.max(0.004, cr(p0.ry, p1.ry, p2.ry, p3.ry, t)),
        x: cr(p0.x ?? 0, p1.x ?? 0, p2.x ?? 0, p3.x ?? 0, t),
      });
    }
  }
  rings.push({ ...secs[n - 1], x: secs[n - 1].x ?? 0 });
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  for (const r of rings) {
    for (let k = 0; k < seg; k++) {
      const th = (k / seg) * Math.PI * 2, c = Math.cos(th), sn = Math.sin(th);
      const x = (r.x ?? 0) + r.rx * spow(c, pw), y = r.y + r.ry * spow(sn, pw);
      pos.push(x, y, r.z);
      const cc = color(x, y, r.z, sn);
      col.push(cc.r, cc.g, cc.b);
    }
  }
  for (let i = 0; i < rings.length - 1; i++) {
    for (let k = 0; k < seg; k++) {
      const a = i * seg + k, b = i * seg + ((k + 1) % seg), c = (i + 1) * seg + k, d = (i + 1) * seg + ((k + 1) % seg);
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const ng = g.toNonIndexed();
  ng.setAttribute('pat', new THREE.BufferAttribute(new Float32Array(ng.attributes.position.count).fill(pat), 1));
  return ng;
}
const withPat = (g: THREE.BufferGeometry, v: number) => { g.setAttribute('pat', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(v), 1)); return g; };
const topAt = (secs: Sec[], z: number) => {
  for (let i = 0; i < secs.length - 1; i++) {
    const a = secs[i], b = secs[i + 1];
    if (z >= a.z && z <= b.z) { const t = (z - a.z) / (b.z - a.z || 1); return a.y + a.ry + (b.y + b.ry - a.y - a.ry) * t; }
  }
  return secs[0].y;
};
/** a coat colour that is lighter underneath and darker along the spine */
const coat = (top: string | number, mid: string | number, belly: string | number, tint?: (x: number, y: number, z: number) => THREE.Color | null): ColFn => {
  const T = new THREE.Color(top), M = new THREE.Color(mid), B = new THREE.Color(belly), out = new THREE.Color();
  return (x, y, z, up) => {
    const t = tint?.(x, y, z); if (t) return t;
    if (up > 0.35) return out.copy(M).lerp(T, Math.min(1, (up - 0.35) / 0.65));
    if (up < -0.2) return out.copy(M).lerp(B, Math.min(1, (-up - 0.2) / 0.6));
    return out.copy(M);
  };
};

/** two-piece leg: `m` swings from the hip, `lower` (child) bends at the knee/hock */
function makeLeg(shadows: boolean, o: { up: number; lo: number; r0: number; r1: number; r2: number; hex: string; foot: string; footLen: number; footW: number; pat?: number; hoof?: boolean }): { m: THREE.Mesh; lower: THREE.Mesh } {
  const U = merge([
    part(cyl(o.r0, o.r1, o.up, 8), o.hex, 0, -o.up / 2, 0),
    part(SPH1, o.hex, 0, 0, 0, o.r0 * 1.06, o.r0 * 1.06, o.r0 * 1.06),
    part(SPH1, o.hex, 0, -o.up, 0, o.r1 * 1.12, o.r1 * 1.12, o.r1 * 1.12),
  ]);
  withPat(U, o.pat ?? 0);
  const parts = [
    part(cyl(o.r1, o.r2, o.lo, 8), o.hex, 0, -o.lo / 2, 0),
    o.hoof
      ? part(cyl(o.r2 * 1.1, o.r2 * 1.3, o.footLen, 8), o.foot, 0, -o.lo - o.footLen * 0.35, 0.01)
      : part(SPH1, o.foot, 0, -o.lo - o.footW * 0.2, o.footLen * 0.28, o.footW, o.footW * 0.62, o.footLen),
  ];
  const L = merge(parts); withPat(L, o.pat ?? 0);
  // a leg is long: re-centre nothing, pivots are the origins
  const m = mk(U, shadows, false), lower = mk(L, shadows, false);
  lower.position.y = -o.up; m.add(lower);
  return { m, lower };
}

function buildBoar(shadows: boolean, rnd: () => number): Rig {
  const k = 0.88 + rnd() * 0.3, dark = rnd() < 0.5;
  const mid = dark ? '#4e3b2c' : '#6d5239', furD = dark ? '#2b2018' : '#40301f', belly = '#8a6e55', snoutC = '#a98474';
  const root = new THREE.Group();
  const secs: Sec[] = [
    { z: -0.62, y: 0.52, rx: 0.03, ry: 0.03 }, { z: -0.55, y: 0.55, rx: 0.12, ry: 0.13 }, { z: -0.4, y: 0.58, rx: 0.22, ry: 0.24 },
    { z: -0.12, y: 0.58, rx: 0.25, ry: 0.25 }, { z: 0.12, y: 0.61, rx: 0.26, ry: 0.27 }, { z: 0.3, y: 0.66, rx: 0.26, ry: 0.31 },
    { z: 0.46, y: 0.62, rx: 0.22, ry: 0.26 },
  ];
  const bodyCol = coat(furD, mid, belly);
  const P: THREE.BufferGeometry[] = [loft(secs, bodyCol)];
  // bristly mane down the spine + a stubby curled tail
  for (let i = 0; i < 9; i++) {
    const z = 0.38 - i * 0.12;
    P.push(withPat(part(cone(0.03, 0.12 + (i < 4 ? 0.04 : 0), 5), furD, 0, topAt(secs, z) - 0.02, z, 1, 1, 1, -0.25), 0));
  }
  P.push(withPat(part(cyl(0.014, 0.02, 0.2, 6), furD, 0, 0.62, -0.68, 1, 1, 1, 0.95), 0));
  P.push(withPat(part(SPH1, furD, 0, 0.7, -0.75, 0.035, 0.035, 0.05), 0));
  const body = mk(merge(P), shadows);
  root.add(body);

  // head: its own pivot at the neck so it can sniff / lunge
  const hs: Sec[] = [
    { z: -0.06, y: 0.02, rx: 0.17, ry: 0.19 }, { z: 0.08, y: -0.01, rx: 0.16, ry: 0.17 }, { z: 0.22, y: -0.06, rx: 0.12, ry: 0.12 },
    { z: 0.36, y: -0.09, rx: 0.085, ry: 0.085 }, { z: 0.47, y: -0.1, rx: 0.07, ry: 0.07 }, { z: 0.52, y: -0.1, rx: 0.062, ry: 0.062 },
  ];
  const H: THREE.BufferGeometry[] = [loft(hs, coat(furD, mid, belly, (_x, _y, z) => (z > 0.36 ? new THREE.Color(snoutC).lerp(new THREE.Color(mid), 0.4) : null)))];
  H.push(withPat(part(cyl(0.072, 0.078, 0.04, 10), snoutC, 0, -0.1, 0.535, 1, 1, 1, Math.PI / 2), 0));
  H.push(withPat(part(SPH1, '#1b1412', 0.026, -0.098, 0.56, 0.014, 0.018, 0.01), 0), withPat(part(SPH1, '#1b1412', -0.026, -0.098, 0.56, 0.014, 0.018, 0.01), 0));
  for (const sd of [1, -1]) {
    H.push(withPat(part(cone(0.017, 0.15, 6), '#efe6d2', sd * 0.075, -0.1, 0.42, 1, 1, 1, -0.55, 0, -sd * 0.55), 0));      // tusks curve up and out
    H.push(withPat(part(cone(0.062, 0.17, 6), furD, sd * 0.115, 0.17, -0.02, 1, 1, 1, -0.3, 0, -sd * 0.45), 0));            // ears
    H.push(withPat(part(cone(0.036, 0.1, 6), '#6b4a42', sd * 0.115, 0.165, 0.0, 1, 1, 1, -0.3, 0, -sd * 0.45), 0));
    H.push(withPat(part(SPH1, '#0d0a09', sd * 0.118, 0.0, 0.17, 0.021, 0.024, 0.021), 0));                                  // eyes
    H.push(withPat(part(SPH1, '#d9c9a8', sd * 0.124, 0.006, 0.18, 0.006, 0.007, 0.006), 0));
  }
  const head = mk(merge(H), shadows);
  head.position.set(0, 0.6, 0.4);
  root.add(head);

  const legs: Leg[] = [];
  const mkLeg = (x: number, y: number, z: number, ph: number, front: boolean) => {
    const L = makeLeg(shadows, { up: 0.24, lo: 0.21, r0: front ? 0.105 : 0.12, r1: 0.068, r2: 0.05, hex: furD, foot: '#17110d', footLen: 0.07, footW: 0.05, hoof: true });
    L.m.position.set(x, y, z); root.add(L.m); legs.push({ m: L.m, lower: L.lower, ph, amp: 0.62 });
  };
  mkLeg(0.17, 0.5, 0.26, 0, true); mkLeg(-0.17, 0.5, 0.26, Math.PI, true);
  mkLeg(0.17, 0.5, -0.36, Math.PI, false); mkLeg(-0.17, 0.5, -0.36, 0, false);
  root.scale.setScalar(k);
  return { root, body, head, legs, scale: k };
}

function buildJaguar(shadows: boolean, rnd: () => number): Rig {
  const k = 0.95 + rnd() * 0.12;
  const top = '#bf8a38', mid = '#d6a04a', belly = '#f1e3c6', muzzle = '#f0dcb5';
  const root = new THREE.Group();
  const secs: Sec[] = [
    { z: -0.56, y: 0.64, rx: 0.03, ry: 0.03 }, { z: -0.48, y: 0.67, rx: 0.09, ry: 0.11 }, { z: -0.32, y: 0.7, rx: 0.16, ry: 0.2 },
    { z: -0.08, y: 0.66, rx: 0.145, ry: 0.17 }, { z: 0.18, y: 0.7, rx: 0.17, ry: 0.2 }, { z: 0.36, y: 0.72, rx: 0.185, ry: 0.23 },
    { z: 0.5, y: 0.7, rx: 0.15, ry: 0.19 },
  ];
  const body = mk(loft(secs, coat(top, mid, belly), 1, 16, 4), shadows);
  root.add(body);

  const hs: Sec[] = [
    { z: -0.04, y: 0.0, rx: 0.105, ry: 0.12 }, { z: 0.07, y: 0.0, rx: 0.128, ry: 0.128 }, { z: 0.18, y: -0.01, rx: 0.115, ry: 0.105 },
    { z: 0.27, y: -0.04, rx: 0.082, ry: 0.07 }, { z: 0.34, y: -0.05, rx: 0.066, ry: 0.056 }, { z: 0.385, y: -0.052, rx: 0.05, ry: 0.044 },
  ];
  const mz = new THREE.Color(muzzle), cm = new THREE.Color(mid), tmp = new THREE.Color();
  const H: THREE.BufferGeometry[] = [loft(hs, (_x, _y, z, up) => {
    if (z > 0.2) return tmp.copy(cm).lerp(mz, Math.min(1, (z - 0.2) / 0.08 + (up < 0 ? 0.4 : 0)));
    return up < -0.3 ? tmp.copy(cm).lerp(mz, 0.5) : tmp.copy(up > 0.5 ? new THREE.Color(top) : cm);
  }, 0.6, 14, 4)];
  H.push(withPat(part(SPH1, '#3c2a2c', 0, -0.036, 0.4, 0.03, 0.022, 0.018), 0));                                // nose
  H.push(withPat(part(SPH1, '#e9d8b6', 0, -0.09, 0.3, 0.04, 0.025, 0.06), 0));                                  // chin
  for (const sd of [1, -1]) {
    H.push(withPat(part(SPH1, mid, sd * 0.088, 0.125, -0.02, 0.046, 0.05, 0.026, 0.15, 0, -sd * 0.25), 0.6));    // ears
    H.push(withPat(part(SPH1, '#2e1d17', sd * 0.088, 0.12, 0.0, 0.03, 0.034, 0.012, 0.15, 0, -sd * 0.25), 0));
    H.push(withPat(part(SPH1, '#d9e04a', sd * 0.088, 0.038, 0.165, 0.03, 0.022, 0.018, 0, sd * 0.4, 0), 0));      // eyes
    H.push(withPat(part(SPH1, '#0b0807', sd * 0.093, 0.038, 0.175, 0.008, 0.019, 0.008, 0, sd * 0.4, 0), 0));
    H.push(withPat(part(SPH1, '#2e1d17', sd * 0.075, -0.075, 0.3, 0.012, 0.009, 0.05, 0, 0, 0), 0));               // mouth line
  }
  const head = mk(merge(H), shadows);
  head.position.set(0, 0.76, 0.46);
  root.add(head);

  const legs: Leg[] = [];
  const mkLeg = (x: number, y: number, z: number, ph: number, front: boolean) => {
    const L = makeLeg(shadows, { up: front ? 0.27 : 0.29, lo: 0.25, r0: front ? 0.082 : 0.105, r1: front ? 0.056 : 0.064, r2: 0.045, hex: mid, foot: '#e9d3a8', footLen: 0.11, footW: 0.06, pat: 1 });
    L.m.position.set(x, y, z); root.add(L.m);
    legs.push({ m: L.m, lower: L.lower, ph, amp: 0.8, u0: front ? 0 : -0.22, l0: front ? 0 : 0.42 });
  };
  mkLeg(0.12, 0.6, 0.32, 0, true); mkLeg(-0.12, 0.6, 0.32, Math.PI, true);
  mkLeg(0.13, 0.575, -0.34, Math.PI, false); mkLeg(-0.13, 0.575, -0.34, 0, false);

  // long tail curling up at the end, tip dark
  const ts: Sec[] = [
    { z: 0.0, y: 0.0, rx: 0.034, ry: 0.034 }, { z: 0.15, y: 0.01, rx: 0.032, ry: 0.032 }, { z: 0.32, y: -0.03, rx: 0.03, ry: 0.03 },
    { z: 0.5, y: -0.1, rx: 0.028, ry: 0.028 }, { z: 0.64, y: -0.13, rx: 0.027, ry: 0.027 }, { z: 0.76, y: -0.1, rx: 0.026, ry: 0.026 },
    { z: 0.82, y: -0.05, rx: 0.02, ry: 0.02 },
  ];
  const tg = loft(ts, (_x, _y, z, up) => (z > 0.66 ? new THREE.Color('#3b2716') : up < -0.4 ? new THREE.Color(belly) : new THREE.Color(mid)), 1, 8, 3);
  tg.rotateY(Math.PI);
  const tail = mk(tg, shadows, false);
  tail.position.set(0, 0.68, -0.5);
  root.add(tail);
  root.scale.setScalar(k);
  return { root, body, head, legs, tail, scale: k };
}

function buildCrab(shadows: boolean, rnd: () => number): Rig {
  const k = 0.8 + rnd() * 0.5, shell = rnd() < 0.5 ? '#d4542c' : '#c9622f', lite = '#ea7b4c';
  const root = new THREE.Group();
  const P: THREE.BufferGeometry[] = [
    part(SPH, shell, 0, 0.1, 0, 0.17, 0.075, 0.125),
    part(SPH, lite, 0, 0.135, -0.01, 0.13, 0.045, 0.095),
    part(cyl(0.007, 0.007, 0.05, 5), shell, 0.05, 0.19, 0.1), part(cyl(0.007, 0.007, 0.05, 5), shell, -0.05, 0.19, 0.1),
    part(SPH1, '#111', 0.05, 0.225, 0.1, 0.014, 0.014, 0.014), part(SPH1, '#111', -0.05, 0.225, 0.1, 0.014, 0.014, 0.014),
  ];
  for (const sd of [1, -1]) {
    P.push(part(cyl(0.012, 0.014, 0.12, 5), shell, sd * 0.17, 0.11, 0.1, 1, 1, 1, Math.PI / 2 - 0.2, 0, sd * 0.4));
    P.push(part(SPH, shell, sd * 0.2, 0.11, 0.2, 0.05, 0.035, 0.065));
    P.push(part(cone(0.02, 0.07, 5), lite, sd * 0.215, 0.11, 0.27, 1, 1, 1, Math.PI / 2, 0, 0));
    P.push(part(cone(0.016, 0.06, 5), lite, sd * 0.185, 0.11, 0.265, 1, 1, 1, Math.PI / 2, 0, 0));
  }
  const body = mk(merge(P), shadows, false);
  root.add(body);
  const legs: Leg[] = [];
  for (const sd of [1, -1]) {
    const L: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 3; i++) L.push(part(cyl(0.008, 0.006, 0.17, 4), shell, sd * 0.19, 0.06, -0.07 + i * 0.065, 1, 1, 1, 0, 0, sd * 1.15));
    const m = mk(merge(L), shadows, false); m.position.set(0, 0, 0); root.add(m); legs.push({ m, ph: sd > 0 ? 0 : Math.PI, amp: 0.25 });
  }
  root.scale.setScalar(k);
  return { root, body, legs, scale: k };
}

function buildGull(shadows: boolean): Rig {
  const root = new THREE.Group();
  const body = mk(merge([
    part(SPH, '#f6f5ef', 0, 0, 0, 0.07, 0.07, 0.22),
    part(SPH, '#f6f5ef', 0, 0.02, 0.21, 0.05, 0.05, 0.06),
    part(cone(0.015, 0.08, 5), '#f0a52e', 0, 0.01, 0.31, 1, 1, 1, Math.PI / 2),
    part(SPH1, '#111', 0.02, 0.04, 0.25, 0.008, 0.008, 0.008), part(SPH1, '#111', -0.02, 0.04, 0.25, 0.008, 0.008, 0.008),
    part(SPH, '#dcdcd6', 0, 0.0, -0.26, 0.05, 0.012, 0.1),
  ]), shadows, false);
  root.add(body);
  const wing = (sd: number) => merge([
    part(SPH, '#f3f3ee', sd * 0.22, 0, 0, 0.24, 0.012, 0.09),
    part(SPH, '#c9cac6', sd * 0.4, 0, -0.02, 0.2, 0.01, 0.07),
    part(SPH, '#2a2a2a', sd * 0.6, 0, -0.03, 0.12, 0.009, 0.05),
  ]);
  const wingR = mk(wing(1), shadows, false), wingL = mk(wing(-1), shadows, false);
  wingR.position.set(0.05, 0.04, 0); wingL.position.set(-0.05, 0.04, 0);
  root.add(wingR, wingL);
  return { root, body, legs: [], wingL, wingR, scale: 1 };
}

// ------------------------------------------------------------------ animals
type State = 'idle' | 'wander' | 'flee' | 'chase' | 'stalk' | 'lunge' | 'retreat' | 'dead';

export interface Animal {
  kind: AnimalKind; def: Def; rig: Rig;
  x: number; y: number; z: number; yaw: number; pitch: number; roll: number;
  hx: number; hz: number;
  hp: number; state: State; t: number; tx: number; tz: number; cd: number; aggro: number; fear: number;
  phase: number; speed: number; deadT: number; respawnAt: number; hurtT: number; windup: number; sndCd: number;
  lungeX: number; lungeZ: number;
  /** jaguar: which way it circles (+1/-1), a creep/freeze timer, how many times it has lunged, enraged by wounds */
  circ: number; beat: number; lunges: number;
  /** multiplayer client: last state the host told us about */
  net?: { x: number; z: number; yaw: number; st: number; hp: number; seen: number };
}

export interface FaunaTarget { id: number; x: number; y: number; z: number; sprint: boolean; yaw?: number }
const STATE_CODES: State[] = ['idle', 'wander', 'flee', 'chase', 'stalk', 'lunge', 'retreat', 'dead'];

interface Gull { rig: Rig; cx: number; cz: number; r: number; alt: number; th: number; w: number; dir: number; ph: number; cry: number }

const turn = (cur: number, want: number, max: number) => {
  let d = want - cur; d = Math.atan2(Math.sin(d), Math.cos(d));
  return cur + Math.max(-max, Math.min(max, d));
};

export class Fauna {
  readonly group = new THREE.Group();
  readonly animals: Animal[] = [];
  private gulls: Gull[] = [];
  private clock = 0;
  private out = { x: 0, z: 0 };
  /** hooks */
  onHurtPlayer: ((dmg: number, fx: number, fz: number, by: string, target: number) => void) | null = null;
  onKill: ((a: Animal) => void) | null = null;
  /** multiplayer client: animals are puppets driven by snapshots from the host */
  remote = false;
  onDrop: ((id: ItemId, n: number, x: number, y: number, z: number) => void) | null = null;
  onSound: ((s: AnimalSound, x: number, z: number) => void) | null = null;
  onBlood: ((x: number, y: number, z: number, n: number) => void) | null = null;
  nearFire: ((x: number, z: number, r: number) => boolean) | null = null;
  /** walls and foundations */
  blocked: ((x: number, z: number, r: number, y: number) => boolean) | null = null;

  constructor(scene: THREE.Scene, private colliders: ColliderGrid, private shadows: boolean, spawn: { x: number; z: number }, scale = 1) {
    scene.add(this.group);
    const rnd = mulberry32(8080);
    const spots = (n: number, ok: (x: number, z: number, h: number, s: number) => boolean, minSep: number, tries = 9000) => {
      const out: { x: number; z: number }[] = [];
      for (let i = 0; i < tries && out.length < n; i++) {
        const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 235;
        const x = Math.cos(a) * r, z = Math.sin(a) * r, h = heightAt(x, z);
        if (!ok(x, z, h, slopeAt(x, z))) continue;
        if (this.colliders.anyIn(x - 0.6, z - 0.6, x + 0.6, z + 0.6)) continue;
        if (out.some((p) => Math.hypot(p.x - x, p.z - z) < minSep)) continue;
        out.push({ x, z });
      }
      return out;
    };
    const far = (x: number, z: number, d: number) => Math.hypot(x - spawn.x, z - spawn.z) > d;
    for (const p of spots(Math.round(26 * scale), (x, z, h, s) => h > 0.3 && h < 1.5 && s < 0.25 && far(x, z, 12), 5)) this.spawn('crab', p.x, p.z, rnd);
    for (const p of spots(Math.round(14 * scale), (x, z, h, s) => h > 3 && h < 24 && s < 0.4 && far(x, z, 70), 30)) this.spawn('boar', p.x, p.z, rnd);
    for (const p of spots(Math.round(8 * scale), (x, z, h, s) => h > 8 && h < 38 && s < 0.5 && far(x, z, 130), 70)) this.spawn('jaguar', p.x, p.z, rnd);

    // gulls wheeling over the coast
    const nG = Math.round(10 * scale);
    for (let i = 0; i < nG; i++) {
      const th = rnd() * Math.PI * 2;
      let r = 330;
      while (r > 0 && heightAt(Math.cos(th) * r, Math.sin(th) * r) < 0.2) r -= 2;
      const cx = Math.cos(th) * (r - 6), cz = Math.sin(th) * (r - 6);
      const rig = buildGull(shadows);
      this.group.add(rig.root);
      this.gulls.push({ rig, cx, cz, r: 22 + rnd() * 36, alt: 20 + rnd() * 20, th: rnd() * 6.28, w: 0.16 + rnd() * 0.12, dir: rnd() < 0.5 ? 1 : -1, ph: rnd() * 6, cry: 4 + rnd() * 20 });
    }
  }

  private spawn(kind: AnimalKind, x: number, z: number, rnd: () => number) {
    const rig = kind === 'boar' ? buildBoar(this.shadows, rnd) : kind === 'jaguar' ? buildJaguar(this.shadows, rnd) : buildCrab(this.shadows, rnd);
    rig.root.rotation.order = 'YXZ';
    this.group.add(rig.root);
    const def = DEFS[kind];
    const a: Animal = {
      kind, def, rig, x, z, y: heightAt(x, z), yaw: rnd() * 6.28, pitch: 0, roll: 0, hx: x, hz: z,
      hp: def.hp, state: 'idle', t: rnd() * 4, tx: x, tz: z, cd: 0, aggro: 0, fear: 0, phase: rnd() * 6, speed: 0,
      deadT: 0, respawnAt: 0, hurtT: 0, windup: 0, sndCd: 3 + rnd() * 10, lungeX: 0, lungeZ: 0, circ: rnd() < 0.5 ? -1 : 1, beat: 0, lunges: 0,
    };
    this.animals.push(a);
    this.place(a);
  }

  private place(a: Animal) {
    const r = a.rig.root;
    r.position.set(a.x, a.y, a.z);
    r.rotation.set(a.pitch, a.yaw + (a.kind === 'crab' ? Math.PI / 2 : 0), a.roll);
  }

  // ------------------------------------------------------------ targeting
  raycast(eye: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, reach: number, assist = 1): { a: Animal; dist: number; point: THREE.Vector3 } | null {
    let best: { a: Animal; dist: number; point: THREE.Vector3 } | null = null;
    let bt = reach;
    for (const a of this.animals) {
      if (a.state === 'dead') continue;
      const ex = a.x - eye.x, ez = a.z - eye.z;
      if (ex * ex + ez * ez > (reach + 2.5) ** 2) continue;
      const d = a.def, sc = a.rig.scale;
      const fx = Math.sin(a.yaw) * d.hitSpread * sc, fz = Math.cos(a.yaw) * d.hitSpread * sc;
      const offs = d.hitSpread > 0 ? [-1, 1] : [0];
      for (const o of offs) {
        const cx = a.x + fx * o, cy = a.y + d.hitY * sc, cz = a.z + fz * o;
        const lx = cx - eye.x, ly = cy - eye.y, lz = cz - eye.z;
        const tca = lx * dir.x + ly * dir.y + lz * dir.z;
        const r = d.hitR * sc * assist;
        const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
        if (d2 > r * r) continue;
        const t = tca - Math.sqrt(r * r - d2);
        if (t >= 0 && t < bt) { bt = t; best = { a, dist: t, point: new THREE.Vector3(eye.x + dir.x * t, eye.y + dir.y * t, eye.z + dir.z * t) }; }
      }
    }
    return best;
  }

  /** Returns true if it killed the animal. */
  damage(a: Animal, dmg: number, px: number, pz: number): boolean {
    if (a.state === 'dead') return false;
    a.hp -= dmg;
    a.hurtT = 0.22;
    this.onBlood?.(a.x, a.y + a.def.hitY * a.rig.scale, a.z, 7);
    // knock back a touch
    const dx = a.x - px, dz = a.z - pz, l = Math.hypot(dx, dz) || 1;
    a.x += (dx / l) * 0.25; a.z += (dz / l) * 0.25;
    if (a.hp <= 0) { this.kill(a); return true; }
    if (a.kind === 'crab') { a.state = 'flee'; a.t = 3; this.onSound?.('click', a.x, a.z); }
    else if (a.kind === 'boar') {
      a.aggro = 25; a.state = a.hp < a.def.hp * 0.28 ? 'flee' : 'chase'; a.fear = a.state === 'flee' ? 7 : 0;
      this.onSound?.('squeal', a.x, a.z);
    } else { a.state = 'retreat'; a.t = 5; this.onSound?.('growl', a.x, a.z); }
    return false;
  }

  private kill(a: Animal) {
    a.state = 'dead'; a.deadT = 0; a.hp = 0;
    a.respawnAt = this.clock + a.def.respawn;
    const [id, lo, hi] = a.def.loot;
    const n = lo + Math.floor(Math.random() * (hi - lo + 1));
    const drops: ItemId[] = Array(n).fill(id);
    if (a.def.extra) { const [xid, xl, xh] = a.def.extra; for (let i = xl + Math.floor(Math.random() * (xh - xl + 1)); i > 0; i--) drops.push(xid); }
    for (const did of drops) {
      const ang = Math.random() * 6.28, r = 0.4 + Math.random() * 0.6;
      const x = a.x + Math.cos(ang) * r, z = a.z + Math.sin(ang) * r;
      this.onDrop?.(did, 1, x, Math.max(0.02, heightAt(x, z)), z);
    }
    this.onBlood?.(a.x, a.y + 0.3, a.z, 12);
    this.onSound?.('die', a.x, a.z);
    this.onKill?.(a);
  }

  // ------------------------------------------------------------ simulation
  private walk(a: Animal, tx: number, tz: number, speed: number, dt: number, turnRate = 5): boolean {
    const dx = tx - a.x, dz = tz - a.z, dist = Math.hypot(dx, dz);
    if (dist < 0.05) return true;
    a.yaw = turn(a.yaw, Math.atan2(dx, dz), turnRate * dt);
    const want = Math.atan2(dx, dz);
    const align = Math.max(0, Math.cos(want - a.yaw));
    const step = Math.min(dist, speed * dt) * (0.25 + 0.75 * align);
    let nx = a.x + Math.sin(a.yaw) * step, nz = a.z + Math.cos(a.yaw) * step;
    const nh = heightAt(nx, nz);
    if (nh < a.def.minH || nh - a.y > 0.7 || (a.kind !== 'crab' && nh > 40)) return false; // water / cliff: caller picks something else
    this.colliders.resolve(nx, nz, a.def.radius, this.out);
    nx = this.out.x; nz = this.out.z;
    if (this.blocked?.(nx, nz, a.def.radius, nh)) return false;
    a.speed = step / Math.max(dt, 1e-4);
    a.x = nx; a.z = nz;
    return false;
  }

  private pickWander(a: Animal, radius: number) {
    for (let k = 0; k < 8; k++) {
      const ang = Math.random() * 6.28, r = 2 + Math.random() * radius;
      const x = a.hx + Math.cos(ang) * r, z = a.hz + Math.sin(ang) * r;
      if (heightAt(x, z) >= a.def.minH + 0.15) { a.tx = x; a.tz = z; return; }
    }
    a.tx = a.hx; a.tz = a.hz;
  }

  /** Ground-following, slope lean, walk cycle: shared by the simulated and the puppet animals. */
  private animate(a: Animal, sdt: number, crouch: number) {
    const root = a.rig.root;
    // follow the ground, lean with the slope
    const gy = heightAt(a.x, a.z);
    a.y += (gy - a.y) * Math.min(1, sdt * 14);
    const L = a.kind === 'crab' ? 0.18 : 0.55, W = a.kind === 'crab' ? 0.15 : 0.3;
    const sx = Math.sin(a.yaw), cz = Math.cos(a.yaw);
    const hf = heightAt(a.x + sx * L, a.z + cz * L), hb = heightAt(a.x - sx * L, a.z - cz * L);
    const hr = heightAt(a.x + cz * W, a.z - sx * W), hl = heightAt(a.x - cz * W, a.z + sx * W);
    const tp = -Math.atan2(hf - hb, 2 * L) * (a.kind === 'crab' ? 0.7 : 1), tr = Math.atan2(hr - hl, 2 * W) * 0.8;
    const k = Math.min(1, sdt * 8);
    a.pitch += (tp + crouch * 0.1 - a.pitch) * k; a.roll += (tr - a.roll) * k;
    if (a.kind === 'crab') { a.pitch = 0; a.roll *= 0.5; }

    // animate
    const sp = a.speed;
    a.phase += sp * sdt * (a.kind === 'crab' ? 14 : a.kind === 'jaguar' ? 2.6 : 3.4);
    const mov = Math.min(1, sp / (a.kind === 'crab' ? 1.2 : 2.5));
    for (const l of a.rig.legs) {
      if (a.kind === 'crab') l.m.rotation.z = Math.sin(a.phase + l.ph) * l.amp * mov * (l.ph > 0 ? -1 : 1) * 0.5;
      else {
        const ang = a.phase + l.ph;
        l.m.rotation.x = (l.u0 ?? 0) * (1 - mov * 0.6) + Math.sin(ang) * l.amp * mov;
        // the foot trails and lifts while the leg swings forward
        if (l.lower) l.lower.rotation.x = (l.l0 ?? 0) * (1 - mov * 0.5) + Math.max(0, -Math.cos(ang)) * l.amp * 1.25 * mov;
      }
    }
    const hd = a.rig.head;
    if (hd) {
      const stalk = a.state === 'stalk' || a.state === 'lunge' || a.state === 'chase';
      const calm = a.state === 'idle' || a.state === 'wander';
      const want = a.kind === 'boar'
        ? (calm ? 0.32 + Math.sin(this.clock * 1.7 + a.phase) * 0.14 * (1 - mov) : stalk ? -0.05 : 0.1) + Math.sin(a.phase * 2) * 0.05 * mov
        : (stalk ? 0.28 : 0.05) + Math.sin(a.phase * 2) * 0.05 * mov + (calm ? Math.sin(this.clock * 0.9 + a.phase) * 0.05 : 0);
      hd.rotation.x += (want - hd.rotation.x) * Math.min(1, sdt * 6);
      hd.rotation.y = Math.sin(this.clock * 0.6 + a.phase) * (calm ? 0.25 : 0.04);
    }
    if (a.rig.tail) { a.rig.tail.rotation.y = Math.sin(this.clock * (a.state === 'stalk' ? 3 : 1.4) + a.phase) * 0.35; a.rig.tail.rotation.x = -0.15 + Math.sin(a.phase) * 0.06 * mov; }
    this.place(a);
    root.position.y = a.y - crouch * 0.07;
    const squash = a.hurtT > 0 ? 1 + Math.sin(a.hurtT * 40) * 0.07 : 1;
    root.scale.setScalar(a.rig.scale * squash);
    if (a.kind !== 'crab') a.rig.body.scale.y = 1 + Math.sin(this.clock * 2 + a.phase) * 0.012;
  }

  /** Client side: move an animal toward what the host last said. */
  private puppet(a: Animal, sdt: number, dl: number) {
    const n = a.net, root = a.rig.root;
    a.hurtT = Math.max(0, a.hurtT - sdt);
    if (!n || this.clock - n.seen > 1.5) { root.visible = false; return; }
    if (n.st === 7) {
      if (a.state !== 'dead') { a.state = 'dead'; a.deadT = 0; a.hp = 0; }
      a.deadT += sdt;
      const fade = a.deadT > 22 ? Math.max(0, 1 - (a.deadT - 22) / 2) : 1;
      root.visible = fade > 0 && dl < 140;
      a.roll = Math.min(1.45, a.roll + sdt * 4);
      a.y += (heightAt(a.x, a.z) - a.y) * Math.min(1, sdt * 8);
      this.place(a);
      root.position.y = a.y - 0.05 * Math.min(1, a.deadT * 2);
      root.scale.setScalar(a.rig.scale * fade);
      return;
    }
    if (a.state === 'dead') { a.roll = 0; a.deadT = 0; a.x = n.x; a.z = n.z; a.y = heightAt(a.x, a.z); root.scale.setScalar(a.rig.scale); }
    const ox = a.x, oz = a.z;
    if (Math.hypot(n.x - a.x, n.z - a.z) > 8) { a.x = n.x; a.z = n.z; }
    else { const k = 1 - Math.exp(-sdt * 10); a.x += (n.x - a.x) * k; a.z += (n.z - a.z) * k; }
    a.yaw = turn(a.yaw, n.yaw, 14 * sdt);
    a.speed = Math.min(8, Math.hypot(a.x - ox, a.z - oz) / Math.max(sdt, 1e-3));
    a.state = STATE_CODES[n.st] ?? 'idle'; a.hp = n.hp;
    root.visible = dl < 120;
    if (!root.visible) return;
    this.animate(a, sdt, a.state === 'stalk' ? 1 : 0);
  }

  // ------------------------------------------------------------ networking
  indexOf(a: Animal) { return this.animals.indexOf(a); }

  /** Host: the animals worth sending (anywhere near a player). */
  exportState(near: (x: number, z: number) => boolean): number[][] {
    const rows: number[][] = [];
    this.animals.forEach((a, i) => {
      if (a.state === 'dead' && a.deadT > 25) return;
      if (!near(a.x, a.z)) return;
      rows.push([i, +a.x.toFixed(2), +a.z.toFixed(2), +a.yaw.toFixed(2), a.state === 'dead' ? 7 : Math.max(0, STATE_CODES.indexOf(a.state)), Math.max(0, Math.ceil(a.hp))]);
    });
    return rows;
  }

  /** Client: remember what the host reported. */
  importState(rows: number[][]) {
    for (const [i, x, z, yaw, st, hp] of rows) {
      const a = this.animals[i];
      if (!a) continue;
      if (!a.net) { a.x = x; a.z = z; a.yaw = yaw; a.y = heightAt(x, z); }
      a.net = { x, z, yaw, st, hp, seen: this.clock };
    }
  }

  hurtFx(a: Animal) { a.hurtT = 0.22; }

  /** This client just became the host: carry on simulating the animals from where the puppets stand. */
  promote() {
    this.remote = false;
    for (const a of this.animals) {
      a.aggro = 0; a.fear = 0; a.windup = 0; a.cd = 0; a.t = 1 + Math.random() * 3; a.hx = a.hx || a.x; a.hz = a.hz || a.z;
      if (a.state === 'dead') a.respawnAt = this.clock + 60 + Math.random() * 60;
      else { a.state = 'idle'; if (a.hp <= 0) a.hp = a.def.hp; }
    }
  }

  update(dt: number, targets: FaunaTarget[], _night: boolean) {
    this.clock += dt;
    const sdt = Math.min(dt, 0.1);
    const L = targets[0], gpx = L.x, gpz = L.z;

    for (const a of this.animals) {
      // the nearest player is who this animal reacts to
      let T = L, d = Math.hypot(a.x - L.x, a.z - L.z);
      for (let k = 1; k < targets.length; k++) { const q = targets[k], dq = Math.hypot(a.x - q.x, a.z - q.z); if (dq < d) { d = dq; T = q; } }
      const px = T.x, pz = T.z, sprinting = T.sprint;
      const dl = T === L ? d : Math.hypot(a.x - L.x, a.z - L.z);
      const root = a.rig.root;
      if (this.remote) { this.puppet(a, sdt, dl); continue; }
      if (a.state === 'dead') {
        a.deadT += sdt;
        if (a.deadT > 26 && this.clock >= a.respawnAt - a.def.respawn + 26) { /* fading */ }
        const fade = a.deadT > 22 ? Math.max(0, 1 - (a.deadT - 22) / 2) : 1;
        root.visible = fade > 0 && dl < 140;
        a.roll = Math.min(1.45, a.roll + sdt * 4);
        a.y += (heightAt(a.x, a.z) - a.y) * Math.min(1, sdt * 8);
        this.place(a);
        root.position.y = a.y - 0.05 * Math.min(1, a.deadT * 2);
        root.scale.setScalar(a.rig.scale * fade);
        if (this.clock >= a.respawnAt && d > 70) {
          a.hp = a.def.hp; a.state = 'idle'; a.x = a.hx; a.z = a.hz; a.roll = 0; a.aggro = 0; a.fear = 0; a.t = 2; a.deadT = 0;
          a.y = heightAt(a.x, a.z); root.scale.setScalar(a.rig.scale);
        }
        continue;
      }
      if (d > 120) { root.visible = false; continue; }
      root.visible = dl < 120;

      a.t -= sdt; a.cd -= sdt; a.aggro = Math.max(0, a.aggro - sdt); a.fear = Math.max(0, a.fear - sdt); a.hurtT = Math.max(0, a.hurtT - sdt); a.sndCd -= sdt;
      a.speed = 0;
      let crouch = 0;

      if (a.kind === 'crab') {
        const scare = sprinting ? 8 : 5;
        if (d < scare && a.state !== 'flee') { a.state = 'flee'; a.t = 2.2 + Math.random(); this.onSound?.('click', a.x, a.z); }
        if (a.state === 'flee') {
          const ang = Math.atan2(a.x - px, a.z - pz) + Math.sin(this.clock * 3 + a.phase) * 0.6;
          if (this.walk(a, a.x + Math.sin(ang) * 3, a.z + Math.cos(ang) * 3, 3.1, sdt, 9)) { /* arrived */ }
          if (a.t <= 0 && d > scare) { a.state = 'idle'; a.t = 2 + Math.random() * 4; }
        } else if (a.state === 'idle') {
          if (a.t <= 0) { this.pickWander(a, 4); a.state = 'wander'; a.t = 3 + Math.random() * 3; }
        } else if (a.state === 'wander') {
          const arrived = this.walk(a, a.tx, a.tz, 0.9, sdt, 4);
          if (arrived || a.t <= 0) { a.state = 'idle'; a.t = 2 + Math.random() * 5; }
        }
      } else if (a.kind === 'boar') {
        const hostile = a.aggro > 0;
        if (a.state === 'idle') {
          if (a.t <= 0) { this.pickWander(a, 12); a.state = 'wander'; a.t = 5 + Math.random() * 6; }
          if (a.sndCd <= 0 && d < 25) { this.onSound?.('snort', a.x, a.z); a.sndCd = 9 + Math.random() * 14; }
        } else if (a.state === 'wander') {
          const arrived = this.walk(a, a.tx, a.tz, 1.3, sdt, 3);
          if (arrived || a.t <= 0) { a.state = 'idle'; a.t = 2 + Math.random() * 6; }
        } else if (a.state === 'flee') {
          const ang = Math.atan2(a.x - px, a.z - pz);
          if (!this.walk(a, a.x + Math.sin(ang) * 5, a.z + Math.cos(ang) * 5, 6.4, sdt, 7)) { /* run */ }
          if (a.fear <= 0) { a.state = 'idle'; a.t = 3; }
        } else if (a.state === 'chase') {
          if (!hostile || d > 38) { a.state = 'idle'; a.t = 2; }
          else if (d > 1.55) this.walk(a, px, pz, 6.0, sdt, 7);
          else {
            a.yaw = turn(a.yaw, Math.atan2(px - a.x, pz - a.z), 9 * sdt);
            if (a.cd <= 0) {
              a.windup += sdt;
              crouch = a.windup;
              if (a.windup > 0.38) {
                a.windup = 0; a.cd = 1.5;
                this.onHurtPlayer?.(14, a.x, a.z, 'boar', T.id);
                this.onSound?.('grunt', a.x, a.z);
              }
            }
          }
        }
      } else { // jaguar: a shy wanderer. It never hunts or attacks; hit it and it bounds away.
        if (a.state === 'idle') {
          if (a.t <= 0) { this.pickWander(a, 18); a.state = 'wander'; a.t = 6 + Math.random() * 6; }
        } else if (a.state === 'wander') {
          const arrived = this.walk(a, a.tx, a.tz, 1.9, sdt, 3);
          if (arrived || a.t <= 0) { a.state = 'idle'; a.t = 2 + Math.random() * 5; }
        } else if (a.state === 'retreat') {
          const ra = Math.atan2(a.x - px, a.z - pz);
          this.walk(a, a.x + Math.sin(ra) * 6, a.z + Math.cos(ra) * 6, 6.5, sdt, 8);
          if (a.t <= 0) { a.state = 'idle'; a.t = 3; }
        } else { a.state = 'wander'; a.t = 4; }        // (old hunting states from a save or an older host)
        a.windup = 0;
      }

      this.animate(a, sdt, crouch);
    }

    // gulls
    for (const g of this.gulls) {
      g.th += g.w * g.dir * dt;
      g.ph += dt * (7 + Math.sin(g.th * 0.7) * 1.5);
      const x = g.cx + Math.cos(g.th) * g.r, z = g.cz + Math.sin(g.th) * g.r;
      const y = Math.max(heightAt(x, z), 0) + g.alt + Math.sin(g.th * 3.1) * 2.5;
      const r = g.rig.root;
      const dd = Math.hypot(x - gpx, z - gpz);
      r.visible = dd < 230;
      if (!r.visible) continue;
      r.position.set(x, y, z);
      r.rotation.order = 'YXZ';
      r.rotation.set(Math.sin(g.ph * 0.5) * 0.04, Math.atan2(-Math.sin(g.th) * g.dir, Math.cos(g.th) * g.dir), -0.35 * g.dir);
      const flap = Math.sin(g.ph) * 0.55 * (Math.sin(g.th * 2.3) > -0.4 ? 1 : 0.15);
      g.rig.wingR!.rotation.z = flap; g.rig.wingL!.rotation.z = -flap;
      g.cry -= dt;
      if (g.cry <= 0) { g.cry = 9 + Math.random() * 25; if (dd < 90) this.onSound?.('gull', x, z); }
    }
  }
}
