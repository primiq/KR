// The airstrip island: a flat island far out at sea (reached through the secret room) with a runway, a playground of ramps
// and bumps, a fenced arena full of giant balloons and four cars to drive. Everything here uses its own coordinates
// (lx, lz = world minus the island's centre) and stands in for the "ground" of the player through the cave-style interface.
// Babylon port: Castaway's code, drawn by render/mirror.ts.
import * as THREE from 'three';
import { Mesher, bodyMaterial } from '../net/playerModel';
import { mulberry32 } from '../core/noise';
import { Car, CAR_SPECS, type Env } from '../game/cars';
import { Balloons } from './balloons';
import { towerSurf, towerPush, towerRoadGeometry, towerDecorMesher, TW } from './airtower';

/** a position or a direction (Babylon's Vector3 here) */
interface PV { x: number; y: number; z: number; set(x: number, y: number, z: number): unknown }

export const AX = 3000, AZ = 0;
const A = 330, B = 160, FLAT = 3.2;
const sm = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** > 0 inside the island, 0 at its irregular coast */
export function mask(x: number, z: number) {
  const th = Math.atan2(z, x);
  const k = 1 + 0.07 * Math.sin(3 * th + 0.6) + 0.05 * Math.sin(5 * th + 2.1) + 0.03 * Math.sin(9 * th + 4.0);
  return 1 - Math.hypot(x / A, z / B) * k;
}
export function baseH(x: number, z: number) { const m = mask(x, z); return m > 0.2 ? FLAT : lerp(-6, FLAT, sm(-0.12, 0.2, m)); }

interface Ramp { cx: number; cz: number; yaw: number; len: number; wid: number; h: number }
interface Dome { cx: number; cz: number; rx: number; rz: number; h: number }
const RUNWAY_Z = -50;
export const RAMPS: Ramp[] = [
  { cx: -70, cz: 45, yaw: 0, len: 14, wid: 7, h: 2.4 },
  { cx: -30, cz: 45, yaw: Math.PI, len: 14, wid: 7, h: 2.4 },
  { cx: 30, cz: 40, yaw: 0, len: 24, wid: 10, h: 4.6 },
  { cx: 75, cz: 125, yaw: -Math.PI / 2, len: 16, wid: 8, h: 3.0 },
  { cx: 75, cz: 85, yaw: Math.PI / 2, len: 16, wid: 8, h: 3.0 },
  { cx: -100, cz: 20, yaw: Math.PI / 2, len: 12, wid: 6, h: 1.8 },
];
export const DOMES: Dome[] = [
  { cx: -190, cz: 50, rx: 34, rz: 30, h: 8 },                 // the hill
  ...Array.from({ length: 8 }, (_, i) => ({ cx: -135 + i * 14, cz: 100, rx: 7, rz: 13, h: 1.3 })),   // whoops
  { cx: 0, cz: 100, rx: 18, rz: 14, h: 2.6 },
];
function rampH(r: Ramp, x: number, z: number) {
  const hx = Math.cos(r.yaw), hz = Math.sin(r.yaw), dx = x - r.cx, dz = z - r.cz;
  const u = dx * hx + dz * hz + r.len / 2, v = -dx * hz + dz * hx;
  return u >= 0 && u <= r.len && Math.abs(v) <= r.wid / 2 ? (r.h * u) / r.len : 0;
}
function domeH(d: Dome, x: number, z: number) { const q = ((x - d.cx) / d.rx) ** 2 + ((z - d.cz) / d.rz) ** 2; return q < 1 ? d.h * (1 - q) : 0; }
function featureH(x: number, z: number) {
  let h = 0;
  for (const r of RAMPS) { if (Math.abs(x - r.cx) < 30 && Math.abs(z - r.cz) < 30) h = Math.max(h, rampH(r, x, z)); }
  for (const d of DOMES) { if (Math.abs(x - d.cx) < d.rx && Math.abs(z - d.cz) < d.rz) h = Math.max(h, domeH(d, x, z)); }
  return h;
}
const terrainH = (x: number, z: number) => baseH(x, z) + DOMES.reduce((h, d) => (Math.abs(x - d.cx) < d.rx && Math.abs(z - d.cz) < d.rz ? Math.max(h, domeH(d, x, z)) : h), 0);
/** ground height (local coordinates) */
export const airH = (x: number, z: number) => baseH(x, z) + featureH(x, z);
/** the ground you stand on: the island, or a road of the sky spiral if you are on (or just above) one */
export const airG = (x: number, z: number, y = -Infinity) => { const g = airH(x, z); if (y === -Infinity) return g; const s = towerSurf(x, z, y); return s.h > g ? s.h : g; };
const walkable = (x: number, z: number) => mask(x, z) > 0.1;

// ------------------------------------------------------------------ obstacles
type Solid = { k: 'box'; x0: number; x1: number; z0: number; z1: number } | { k: 'circ'; x: number; z: number; r: number };
const FENCE = { x: 110, z: 55, R: 55, gapAng: -Math.PI / 2, gapHalf: 0.21 };
const solids: Solid[] = [];

function pushOut(x: number, z: number, r: number, out: { x: number; z: number; nx: number; nz: number }, clear = 0, yy = -1e9): boolean {
  let hit = false, px = x, pz = z, nx = 0, nz = 0;
  const add = (ax: number, az: number, ox: number, oz: number) => { px = ox; pz = oz; nx += ax; nz += az; hit = true; };
  // the sea: step back inland along the slope of the island mask
  if (mask(px, pz) < 0.1) {
    for (let k = 0; k < 40 && mask(px, pz) < 0.1; k++) {
      const gx = mask(px + 1, pz) - mask(px - 1, pz), gz = mask(px, pz + 1) - mask(px, pz - 1), l = Math.hypot(gx, gz) || 1;
      px += (gx / l) * 0.5; pz += (gz / l) * 0.5;
    }
    const l = Math.hypot(px - x, pz - z) || 1; add((px - x) / l, (pz - z) / l, px, pz);
  }
  // the arena fence (a ring with a gap toward the runway)
  {
    const dx = px - FENCE.x, dz = pz - FENCE.z, d = Math.hypot(dx, dz), a = Math.atan2(dz, dx);
    const gd = Math.atan2(Math.sin(a - FENCE.gapAng), Math.cos(a - FENCE.gapAng));
    if (clear < 1.7 && Math.abs(d - FENCE.R) < r + 0.25 && Math.abs(gd) > FENCE.gapHalf) {
      const s = d < FENCE.R ? -1 : 1, nd = FENCE.R + s * (r + 0.25);
      add((dx / d) * s, (dz / d) * s, FENCE.x + (dx / d) * nd, FENCE.z + (dz / d) * nd);
    }
  }
  { const st = { x: px, z: pz }; towerPush(st, r, yy, (ax, az) => add(ax, az, st.x, st.z)); }
  for (const s of solids) {
    if (s.k === 'circ') {
      const dx = px - s.x, dz = pz - s.z, d = Math.hypot(dx, dz), rr = r + s.r;
      if (d < rr) { const ux = d > 1e-4 ? dx / d : 1, uz = d > 1e-4 ? dz / d : 0; add(ux, uz, s.x + ux * rr, s.z + uz * rr); }
    } else {
      const cx = Math.max(s.x0, Math.min(px, s.x1)), cz = Math.max(s.z0, Math.min(pz, s.z1));
      const dx = px - cx, dz = pz - cz, d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        if (d2 > 1e-8) { const d = Math.sqrt(d2); add(dx / d, dz / d, cx + (dx / d) * r, cz + (dz / d) * r); }
        else { const l = px - s.x0, rr2 = s.x1 - px, t = pz - s.z0, bt = s.z1 - pz, m = Math.min(l, rr2, t, bt); if (m === l) add(-1, 0, s.x0 - r, pz); else if (m === rr2) add(1, 0, s.x1 + r, pz); else if (m === t) add(0, -1, px, s.z0 - r); else add(0, 1, px, s.z1 + r); }
      }
    }
  }
  if (hit) { out.x = px; out.z = pz; const l = Math.hypot(nx, nz) || 1; out.nx = nx / l; out.nz = nz / l; }
  return hit;
}

// ------------------------------------------------------------------ geometry
const hash = (x: number, z: number) => { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); };
const vnoise = (x: number, z: number) => {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi, u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  return lerp(lerp(hash(xi, zi), hash(xi + 1, zi), u), lerp(hash(xi, zi + 1), hash(xi + 1, zi + 1), u), v);
};
const inRunway = (x: number, z: number) => Math.abs(x) < 196 && Math.abs(z - RUNWAY_Z) < 14;
const inRoad = (x: number, z: number) => (Math.abs(x - 110) < 6 && z > RUNWAY_Z && z < 2) || (Math.abs(x + 118) < 6 && z > RUNWAY_Z && z < 20) || (Math.abs(z + 15) < 5 && x > -222 && x < -196);
const inApron = (x: number, z: number) => x > -172 && x < -128 && z > -90 && z < -62;
const C = (hex: string) => new THREE.Color(hex);
const ASPHALT = C('#3d4046'), SAND = C('#e9d6a4'), SAND_WET = C('#bda878'), GRASS1 = C('#6fa046'), GRASS2 = C('#5d8f3b'), DIRT = C('#a07c4e');

function terrainMesh(spacing: number) {
  const x0 = -A - 36, x1 = A + 36, z0 = -B - 36, z1 = B + 36;
  const nx = Math.round((x1 - x0) / spacing), nz = Math.round((z1 - z0) / spacing);
  const pos = new Float32Array((nx + 1) * (nz + 1) * 3), col = new Float32Array((nx + 1) * (nz + 1) * 3);
  const c = new THREE.Color();
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const x = x0 + i * spacing, z = z0 + j * spacing, h = terrainH(x, z), k = (j * (nx + 1) + i) * 3, m = mask(x, z);
    pos[k] = x; pos[k + 1] = h; pos[k + 2] = z;
    const patch = vnoise(x * 0.05, z * 0.05), fine = vnoise(x * 0.4, z * 0.4);
    if (h < 0.05) c.copy(SAND_WET).multiplyScalar(0.8 + h * 0.03); else c.copy(SAND_WET).lerp(SAND, sm(0.0, 0.5, h));
    c.lerp(GRASS1.clone().lerp(GRASS2, patch), sm(0.17, 0.3, m) * 0.95);
    if (inRunway(x, z) || inApron(x, z) || inRoad(x, z)) c.copy(ASPHALT).multiplyScalar(0.92 + fine * 0.14);
    else {
      for (const r of RAMPS) if (Math.hypot(x - r.cx, z - r.cz) < r.len * 0.9) c.lerp(DIRT, 0.55);
      c.multiplyScalar(0.92 + fine * 0.14);
    }
    col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
  }
  const idx: number[] = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, b = a + 1, d = a + nx + 1, e = d + 1; idx.push(a, d, b, b, d, e); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere();
  return g;
}

function flatGeometry(tris: [number[], number[], number[], THREE.Color][]) {
  const pos: number[] = [], nor: number[] = [], col: number[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (const [p, q, r, k] of tris) {
    a.fromArray(p); b.fromArray(q); c.fromArray(r);
    n.copy(b).sub(a).cross(c.clone().sub(a)).normalize();
    for (const v of [p, q, r]) { pos.push(...v); nor.push(n.x, n.y, n.z); col.push(k.r, k.g, k.b); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

function rampsGeometry() {
  const tris: [number[], number[], number[], THREE.Color][] = [];
  const Y = C('#f2c21b'), K = C('#2a2a2a'), SIDE = C('#b8481c'), BACK = C('#8a3a18');
  for (const r of RAMPS) {
    const hx = Math.cos(r.yaw), hz = Math.sin(r.yaw), w = r.wid / 2;
    const P = (u: number, v: number, h: number): number[] => [r.cx + (u - r.len / 2) * hx - v * hz, FLAT + h, r.cz + (u - r.len / 2) * hz + v * hx];
    // every face is wound so that it looks outwards (the old winding left the road surface facing down, i.e. invisible)
    const tri = (a: number[], b: number[], c: number[], k: THREE.Color, want: number[]) => {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const d = (uy * vz - uz * vy) * want[0] + (uz * vx - ux * vz) * want[1] + (ux * vy - uy * vx) * want[2];
      tris.push(d >= 0 ? [a, b, c, k] : [a, c, b, k]);
    };
    const quad = (a: number[], b: number[], c: number[], d: number[], k: THREE.Color, want: number[]) => { tri(a, b, c, k, want); tri(a, c, d, k, want); };
    const N = 6;
    for (let s = 0; s < N; s++) {
      const u0 = (s / N) * r.len, u1 = ((s + 1) / N) * r.len, k = s % 2 ? K : Y;
      quad(P(u0, -w, (r.h * u0) / r.len + 0.02), P(u1, -w, (r.h * u1) / r.len + 0.02), P(u1, w, (r.h * u1) / r.len + 0.02), P(u0, w, (r.h * u0) / r.len + 0.02), k, [0, 1, 0]);
    }
    quad(P(r.len, w, r.h), P(r.len, -w, r.h), P(r.len, -w, 0), P(r.len, w, 0), BACK, [hx, 0, hz]);
    quad(P(0, -w, 0.02), P(r.len, -w, 0), P(r.len, w, 0), P(0, w, 0.02), BACK, [0, -1, 0]);
    for (const s of [-1, 1]) {
      const t = [P(0, s * w, 0), P(r.len, s * w, 0), P(r.len, s * w, r.h)];
      tri(t[0], t[1], t[2], SIDE, [-hz * s, 0, hx * s]);
    }
  }
  return flatGeometry(tris);
}

// ------------------------------------------------------------------ decor
function palm(m: Mesher, x: number, y: number, z: number, rnd: () => number) {
  const h = 6 + rnd() * 3.5, lean = (rnd() - 0.5) * 0.5, dir = rnd() * Math.PI * 2;
  let px = x, py = y, pz = z;
  const seg = 5, sh = h / seg;
  for (let i = 0; i < seg; i++) {
    const t = i / seg, bend = lean * (0.3 + t);
    const dx = Math.cos(dir) * Math.sin(bend) * sh, dz = Math.sin(dir) * Math.sin(bend) * sh;
    m.cyl(0.2 - t * 0.07, 0.24 - t * 0.07, sh * 1.02, i % 2 ? '#7a5a38' : '#6b4d2e', px + dx / 2, py + sh / 2, pz + dz / 2, 1, 1, 7);
    px += dx; py += sh * Math.cos(bend); pz += dz;
  }
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + rnd() * 0.3, cs = Math.cos(a), sn = Math.sin(a);
    m.box(2.6, 0.06, 0.55, k % 2 ? '#3f8a3a' : '#4c9a42', px + cs * 1.2, py - 0.25, pz + sn * 1.2, 0, -a, -0.45);
    m.box(1.2, 0.05, 0.4, '#3a7d36', px + cs * 2.7, py - 1.0, pz + sn * 2.7, 0, -a, -0.9);
  }
  m.sph(0.22, '#5b3a1e', px, py - 0.25, pz, 1, 1, 1, 6); m.sph(0.2, '#5b3a1e', px + 0.3, py - 0.4, pz + 0.1, 1, 1, 1, 6);
}

function buildDecor(shadows: boolean) {
  const m = new Mesher(), rnd = mulberry32(2024);
  const Y = FLAT + 0.035;
  const W = '#f1f1ee', YEL = '#f0c419';
  // runway markings
  for (let x = -176; x <= 176; x += 18) m.box(9, 0.05, 0.7, W, x, Y, RUNWAY_Z);
  for (const s of [-1, 1]) m.box(392, 0.05, 0.5, W, 0, Y, RUNWAY_Z + s * 12.6);
  for (const s of [-1, 1]) for (let i = 0; i < 8; i++) m.box(7, 0.05, 1.2, W, s * 186, Y, RUNWAY_Z + (i - 3.5) * 3.1);
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) m.box(10, 0.05, 1.8, W, s * 158 - s * i * 0, Y, RUNWAY_Z + (i - 1) * 6);
  // taxi lines
  m.box(0.4, 0.05, 36, YEL, 110, Y, RUNWAY_Z + 24); m.box(0.4, 0.05, 66, YEL, -118, Y, RUNWAY_Z + 33);
  // runway lights
  for (let x = -190; x <= 190; x += 20) for (const s of [-1, 1]) { m.cyl(0.12, 0.12, 0.25, '#e8e8e8', x, FLAT + 0.12, RUNWAY_Z + s * 14.6, 1, 1, 6); m.box(0.2, 0.08, 0.2, s > 0 ? '#ff6a3c' : '#6ad0ff', x, FLAT + 0.3, RUNWAY_Z + s * 14.6); }
  // ---- hangar
  const hx = -150, hz = -95;
  m.box(36, 0.3, 22, '#7d8086', hx, FLAT + 0.1, hz);
  m.box(36.8, 11, 0.8, '#6f7f8f', hx, FLAT + 5.5, hz - 11);
  for (const s of [-1, 1]) m.box(0.8, 11, 22, '#6f7f8f', hx + s * 18, FLAT + 5.5, hz);
  m.box(38, 0.7, 24, '#52606d', hx, FLAT + 11.4, hz);
  for (let k = -3; k <= 3; k++) m.box(0.5, 0.5, 22, '#3f4a55', hx + k * 5.4, FLAT + 10.8, hz);
  m.box(36, 0.5, 0.8, '#d6322d', hx, FLAT + 9.4, hz + 11.4);
  solids.push({ k: 'box', x0: hx - 18.4, x1: hx + 18.4, z0: hz - 11.4, z1: hz - 10.6 }, { k: 'box', x0: hx - 18.4, x1: hx - 17.6, z0: hz - 11, z1: hz + 11 }, { k: 'box', x0: hx + 17.6, x1: hx + 18.4, z0: hz - 11, z1: hz + 11 });
  for (let i = 0; i < 5; i++) { m.cyl(0.45, 0.45, 1.1, i % 2 ? '#c84a2a' : '#2f62b8', hx - 12 + i * 1.2, FLAT + 0.65, hz - 9, 1, 1, 12); solids.push({ k: 'circ', x: hx - 12 + i * 1.2, z: hz - 9, r: 0.5 }); }
  // ---- control tower
  const tx = -100, tz = -82;
  m.box(6, 12, 6, '#d9d6cc', tx, FLAT + 6, tz); m.box(6.2, 0.6, 6.2, '#9aa0a8', tx, FLAT + 12.2, tz);
  m.box(9, 3.2, 9, '#9fd0e8', tx, FLAT + 14.1, tz); m.box(10, 0.5, 10, '#c0392b', tx, FLAT + 16.0, tz);
  for (const [a, b] of [[-4.4, -4.4], [4.4, -4.4], [-4.4, 4.4], [4.4, 4.4]]) m.box(0.3, 3.2, 0.3, '#3a3f45', tx + a, FLAT + 14.1, tz + b);
  m.cyl(0.06, 0.06, 4, '#444', tx, FLAT + 18, tz); m.box(0.9, 0.5, 0.05, '#ff8c1a', tx + 0.5, FLAT + 19.5, tz);
  solids.push({ k: 'box', x0: tx - 3.2, x1: tx + 3.2, z0: tz - 3.2, z1: tz + 3.2 });
  // ---- fuel tanks
  for (const [x, z] of [[150, -100], [167, -100], [158.5, -116]]) { m.cyl(5, 5, 6.5, '#e8e8e8', x, FLAT + 3.25, z, 1, 1, 18); m.cyl(5.1, 5.1, 0.6, '#d6322d', x, FLAT + 6.7, z, 1, 1, 18); m.cyl(5.1, 5.1, 0.5, '#d6322d', x, FLAT + 1.0, z, 1, 1, 18); solids.push({ k: 'circ', x, z, r: 5 }); }
  // ---- wind sock
  m.cyl(0.12, 0.16, 9, '#e8e8e8', 120, FLAT + 4.5, -78);
  for (let k = 0; k < 4; k++) m.cyl(0.9 - k * 0.15, 0.75 - k * 0.15, 1.0, k % 2 ? '#ffffff' : '#ff6a1a', 120 + 0.5 + k * 0.95, FLAT + 9.1 - k * 0.1, -78, 1, 1, 10, 0, 0, Math.PI / 2 + 0.05 * k);
  // ---- arena fence
  const n = 100;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2, am = (a0 + a1) / 2;
    const gd = Math.atan2(Math.sin(am - FENCE.gapAng), Math.cos(am - FENCE.gapAng));
    if (Math.abs(gd) < FENCE.gapHalf + 0.02) continue;
    const x = FENCE.x + Math.cos(a0) * FENCE.R, z = FENCE.z + Math.sin(a0) * FENCE.R;
    m.cyl(0.14, 0.14, 1.7, '#d33232', x, FLAT + 0.85, z, 1, 1, 6);
    const mx = FENCE.x + Math.cos(am) * FENCE.R, mz = FENCE.z + Math.sin(am) * FENCE.R, len = 2 * FENCE.R * Math.sin(Math.PI / n);
    for (const hgt of [0.5, 1.2]) m.box(len, 0.16, 0.12, i % 2 ? '#f2f2f2' : '#d33232', mx, FLAT + hgt, mz, 0, -(am + Math.PI / 2), 0);
  }
  // ---- playground props: slalom cones, tyre stacks, a row of barrels
  for (let i = 0; i < 12; i++) { const x = -110 + i * 12, z = 70 + (i % 2 ? 5 : -5) + 0; m.cyl(0.02, 0.32, 0.8, '#f26b1d', x, FLAT + 0.4, z, 1, 1, 8); m.cyl(0.25, 0.28, 0.1, '#ffffff', x, FLAT + 0.45, z, 1, 1, 8); }
  for (const [x, z] of [[-10, 125], [-4, 128], [2, 125], [-170, 100], [-166, 106]]) {
    for (let k = 0; k < 3; k++) m.cyl(0.9, 0.9, 0.4, '#1f2124', x, FLAT + 0.2 + k * 0.4, z, 1, 1, 14);
    solids.push({ k: 'circ', x, z, r: 0.95 });
  }
  // ---- arrival: sign and the door back to the secret room
  m.box(0.3, 4.5, 0.3, '#5a4128', -216, FLAT + 2.2, -4); m.box(0.3, 4.5, 0.3, '#5a4128', -216, FLAT + 2.2, 12);
  // palms around the beach
  let placed = 0;
  const pts: [number, number][] = [];
  for (let tries = 0; tries < 4000 && placed < 46; tries++) {
    const a = rnd() * Math.PI * 2, r = 0.55 + rnd() * 0.5, x = Math.cos(a) * A * r, z = Math.sin(a) * B * r, mk = mask(x, z);
    if (mk < 0.1 || mk > 0.24 || baseH(x, z) < 0.25) continue;
    if (inRunway(x, z) || inRoad(x, z) || pts.some((p) => Math.hypot(p[0] - x, p[1] - z) < 14)) continue;
    if (Math.hypot(x - FENCE.x, z - FENCE.z) < FENCE.R + 6 || Math.hypot(x + 224, z + 14) < 14) continue;
    pts.push([x, z]); palm(m, x, baseH(x, z) - 0.1, z, rnd); solids.push({ k: 'circ', x, z, r: 0.6 }); placed++;
  }
  const mesh = m.build(shadows);
  mesh.frustumCulled = false;
  return mesh;
}

function textPlane(text: string[], w: number, h: number, bg: string, fg: string) {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = Math.round(512 * (h / w));
  const g = cv.getContext('2d')!;
  g.fillStyle = bg; g.fillRect(0, 0, cv.width, cv.height);
  g.strokeStyle = fg; g.lineWidth = 10; g.strokeRect(8, 8, cv.width - 16, cv.height - 16);
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  const lh = cv.height / (text.length + 0.6);
  text.forEach((t, i) => { g.font = `700 ${Math.round(lh * 0.62)}px system-ui, sans-serif`; g.fillText(t, cv.width / 2, lh * (i + 0.8)); });
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
  return mesh;
}

// ------------------------------------------------------------------ the island
export interface DriveInput { gas: number; steer: number; hand: boolean; boost: boolean }
export interface AirSfx { engine(v: number | null): void; boing(v: number): void; crash(v: number): void }

export class Airstrip implements Env {
  readonly group = new THREE.Group();
  active = false;
  readonly cars: Car[] = [];
  readonly balloons: Balloons;
  /** the car the local player drives */
  driving: Car | null = null;
  /** the door back to the secret room: where it stands and the spot just in front of it */
  readonly door = { x: -222, z: -18, yaw: Math.PI / 2 };
  sfx: AirSfx | null = null;
  myId = 0;
  private camYaw = 0; private camPitch = 0; private lookIdle = 0;
  private dashT = 0; private dashCtx: CanvasRenderingContext2D | null = null; private dashTex: THREE.CanvasTexture | null = null;
  private speedo: HTMLElement;
  private v = new THREE.Vector3();
  private lastPlayer = new THREE.Vector3(); private plVel = { x: 0, z: 0 };
  /** multiplayer: cars somebody else is driving, by car index -> remote driver id */
  remote = new Map<number, number>();
  private idle = new Map<number, number>();
  private rtgt = new Map<number, { x: number; y: number; z: number; yaw: number; vx: number; vz: number; pitch: number; roll: number; age: number }>();
  /** what I broadcast while driving (airstrip-local), or null */
  driveState(): number[] | null {
    const c = this.driving; if (!c) return null;
    return [c.index, +c.x.toFixed(2), +c.y.toFixed(2), +c.z.toFixed(2), +c.yaw.toFixed(3), +c.vx.toFixed(2), +c.vz.toFixed(2), +c.pitch.toFixed(3), +c.roll.toFixed(3)];
  }
  /** somebody else's car state arrived */
  remoteDrive(from: number, r: number[]) {
    const c = this.cars[r[0]]; if (!c || c === this.driving) return;
    this.remote.set(c.index, from); c.driver = from;
    const t = this.rtgt.get(c.index);
    const n = { x: r[1], y: r[2], z: r[3], yaw: r[4], vx: r[5], vz: r[6], pitch: r[7] ?? 0, roll: r[8] ?? 0, age: 0 };
    this.rtgt.set(c.index, n);
    if (!t) { c.x = n.x; c.y = n.y; c.z = n.z; c.yaw = n.yaw; }
  }
  remoteLeave(i: number) {
    const c = this.cars[i]; this.remote.delete(i); this.rtgt.delete(i);
    if (c && c !== this.driving) c.driver = null;
  }
  /** where another player's seat is right now (world coordinates), from the car they drive, so their avatar rides it instead of lagging behind */
  seatOf(id: number, out: { x: number; y: number; z: number; yaw: number }): boolean {
    for (const [i, d] of this.remote) if (d === id) { const c = this.cars[i]; c.seatPos(this.v); out.x = AX + this.v.x; out.y = this.v.y; out.z = AZ + this.v.z; out.yaw = c.yaw + Math.PI; return true; }
    return false;
  }
  remoteGone(id: number) { for (const [i, d] of [...this.remote]) if (d === id) this.remoteLeave(i); }
  private puppets(dt: number) {
    const k = Math.min(1, dt * 12);
    for (const [i, t] of this.rtgt) {
      const c = this.cars[i]; t.age += dt;
      if (t.age > 2.5) { this.remoteLeave(i); continue; }
      t.x += t.vx * dt; t.z += t.vz * dt;
      c.x += (t.x - c.x) * k; c.y += (t.y - c.y) * k; c.z += (t.z - c.z) * k;
      let dy = t.yaw - c.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); c.yaw += dy * k;
      c.vx = t.vx; c.vz = t.vz; c.pitch += (t.pitch - c.pitch) * k; c.roll += (t.roll - c.roll) * k;
    }
  }

  constructor(scene: THREE.Scene, shadows: boolean, quality: number) {
    const mat = bodyMaterial();
    // everything static is built in local coordinates and carried to the island's place in the sea by this group
    const land = new THREE.Group(); land.position.set(AX, 0, AZ); this.group.add(land);
    const decor = buildDecor(shadows); land.add(decor);
    const terrain = new THREE.Mesh(terrainMesh(quality < 1 ? 4 : 3), mat); terrain.receiveShadow = shadows; terrain.frustumCulled = false; land.add(terrain);
    const spiral = new THREE.Mesh(towerRoadGeometry(), mat); spiral.castShadow = shadows; spiral.receiveShadow = shadows; spiral.frustumCulled = false; land.add(spiral);
    const towerDecor = towerDecorMesher().build(shadows); towerDecor.frustumCulled = false; land.add(towerDecor);
    const ramps = new THREE.Mesh(rampsGeometry(), mat); ramps.castShadow = shadows; ramps.receiveShadow = shadows; ramps.frustumCulled = false; land.add(ramps);
    // arrival door and signs
    const door = new Mesher();
    door.box(0.2, 2.6, 0.3, '#3b2a1c', 0, 1.3, -0.65); door.box(0.2, 2.6, 0.3, '#3b2a1c', 0, 1.3, 0.65); door.box(0.2, 0.3, 1.6, '#3b2a1c', 0, 2.65, 0);
    door.box(0.1, 2.3, 1.0, '#c8431b', 0.02, 1.2, 0); door.box(0.12, 0.25, 0.25, '#e0b341', 0.08, 1.1, 0.35);
    const dm = door.build(shadows); dm.position.set(this.door.x, FLAT, this.door.z); land.add(dm);
    const sign = textPlane(["PETR'S", 'AIRSTRIP'], 6, 2.4, '#1d3a5c', '#ffffff'); sign.position.set(-216, FLAT + 5, 4); sign.rotation.y = Math.PI / 2; land.add(sign);
    const sp = textPlane(['SKY SPIRAL', 'drive to the top'], 7, 2.4, '#1d3a5c', '#ffffff'); sp.position.set(TW.x - 32, FLAT + 4, TW.z - 12); sp.rotation.y = -Math.PI / 2; land.add(sp);
    const back = textPlane(['← door home'], 1.8, 0.5, '#3b2a1c', '#f4e3b8'); back.position.set(this.door.x + 0.05, FLAT + 2.9, this.door.z); back.rotation.y = Math.PI / 2; land.add(back);
    // cars along the start line
    CAR_SPECS.forEach((s, i) => {
      const c = new Car(s, i, { x: -205, z: -30 + i * 6.5 - 10, yaw: Math.PI / 2 }, shadows);
      this.cars.push(c); this.group.add(c.root); c.place(AX, AZ);
    });
    this.balloons = new Balloons(this.group, this, { x: FENCE.x, z: FENCE.z }, AX, AZ, shadows);
    this.balloons.onHit = (s, x, z) => { if (Math.hypot(AX + x - this.lastPlayer.x, AZ + z - this.lastPlayer.z) < 60) this.sfx?.boing(Math.min(1, s / 12)); };
    this.group.visible = false;
    scene.add(this.group);
    // speed readout (flat screen) for the desktop view
    this.speedo = document.createElement('div');
    this.speedo.style.cssText = 'position:fixed;right:22px;bottom:96px;z-index:5;display:none;color:#fff;font:700 15px system-ui,sans-serif;text-align:right;text-shadow:0 1px 4px rgba(0,0,0,.7);pointer-events:none;letter-spacing:.04em';
    document.body.appendChild(this.speedo);
  }

  // ------------------------------------------------------------ Env (cars and balloons) and the player's cave-style ground
  ground = (x: number, z: number, y?: number) => airG(x, z, y);
  obstacle(x: number, z: number, r: number, out: { x: number; z: number; nx: number; nz: number }, clear = 0, y = -1e9) { return pushOut(x, z, r, out, clear, y); }
  /** the player's ground, world coordinates */
  floor(x: number, z: number, y: number) { return airG(x - AX, z - AZ, y); }
  resolve(x: number, z: number, r: number, feetY: number, out: { x: number; z: number }) {
    const o = { x: x - AX, z: z - AZ, nx: 0, nz: 0 };
    if (!pushOut(o.x, o.z, r, o, 0, feetY)) { out.x = x; out.z = z; return; }
    out.x = o.x + AX; out.z = o.z + AZ;
  }

  /** world position (player feet) of the arrival spot, in front of the door */
  arrival() { return { x: AX + this.door.x + 3, z: AZ + this.door.z, yaw: -Math.PI / 2 }; }

  enter(p: { teleport(x: number, y: number, z: number, yaw: number): void; cave: any }) {
    this.active = true; this.group.visible = true; p.cave = this;
    const a = this.arrival();
    p.teleport(a.x, airH(a.x - AX, a.z - AZ), a.z, a.yaw);
  }
  leave(p: { teleport(x: number, y: number, z: number, yaw: number): void; cave: any; seated?: boolean }) {
    if (this.driving) this.exitCar(p as any, true);
    this.active = false; this.group.visible = false; p.cave = null;
  }

  // ------------------------------------------------------------ picking
  pickCar(eye: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, reach: number, assist = 1): { car: Car; dist: number } | null {
    if (!this.active || this.driving) return null;
    let best: { car: Car; dist: number } | null = null;
    for (const c of this.cars) {
      const cx = AX + c.x, cz = AZ + c.z;
      const vx = cx - eye.x, vy = c.y + 0.9 - eye.y, vz = cz - eye.z;
      if (vx * vx + vz * vz > (reach + 4) ** 2) continue;
      const t = vx * dir.x + vy * dir.y + vz * dir.z;
      if (t < 0 || t > reach + 3) continue;
      const px = vx - dir.x * t, py = vy - dir.y * t, pz = vz - dir.z * t, r = (c.spec.hl * 0.55 + 0.6) * assist;
      if (px * px + py * py + pz * pz <= r * r && (!best || t < best.dist)) best = { car: c, dist: t };
    }
    return best;
  }
  pickDoor(eye: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, reach: number, assist = 1): number | null {
    if (!this.active || this.driving) return null;
    const vx = AX + this.door.x - eye.x, vy = FLAT + 1.2 - eye.y, vz = AZ + this.door.z - eye.z;
    const t = vx * dir.x + vy * dir.y + vz * dir.z;
    if (t < 0 || t > reach + 1) return null;
    const px = vx - dir.x * t, py = vy - dir.y * t, pz = vz - dir.z * t, r = 1.2 * assist;
    return px * px + py * py + pz * pz <= r * r ? t : null;
  }

  // ------------------------------------------------------------ driving
  enterCar(car: Car, p: { seated: boolean; yaw: number }): boolean {
    if (this.driving || car.driver !== null || this.remote.has(car.index)) return false;
    this.driving = car; car.driver = this.myId; p.seated = true;
    this.camYaw = 0; this.camPitch = 0; this.lookIdle = 0;
    if (!this.dashCtx) {
      const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128; this.dashCtx = cv.getContext('2d')!;
      this.dashTex = new THREE.CanvasTexture(cv); this.dashTex.colorSpace = THREE.SRGBColorSpace;
    }
    if (!car.dash) {
      const d = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.23), new THREE.MeshBasicMaterial({ map: this.dashTex!, side: THREE.DoubleSide }));
      d.position.set(car.spec.seat[0], car.spec.eye - 0.3, car.spec.seat[2] + 0.92); d.rotation.set(-0.5, Math.PI, 0);
      car.root.children[0].add(d); car.dash = d;
    }
    this.speedo.style.display = 'block';
    return true;
  }
  exitCar(p: { pos: PV; yaw: number; pitch: number; seated: boolean; teleport(x: number, y: number, z: number, yaw: number): void }, quiet = false) {
    const c = this.driving; if (!c) return;
    this.driving = null; c.driver = null; p.seated = false; this.sfx?.engine(null); this.speedo.style.display = 'none';
    // step out on the left side, onto solid ground
    const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
    let ex = c.x + cs * (c.spec.hw + 1.1), ez = c.z - sn * (c.spec.hw + 1.1);
    if (!walkable(ex, ez) || pushOut(ex, ez, 0.4, { x: 0, z: 0, nx: 0, nz: 0 })) { ex = c.x - cs * (c.spec.hw + 1.1); ez = c.z + sn * (c.spec.hw + 1.1); }
    let ey = airG(ex, ez, c.y);
    if (Math.abs(ey - c.y) > 1.2) { ex = c.x; ez = c.z; ey = Math.max(airG(ex, ez, c.y), c.y); }   // on a road with no room beside the car: get out on the spot
    p.teleport(AX + ex, ey, AZ + ez, c.yaw + Math.PI);
    void quiet;
  }

  /** read at the start of a frame: car physics, balloons, and moving the seated player along */
  pre(dt: number, ctl: DriveInput, player: { pos: PV; vel: PV; yaw: number; pitch: number; seated: boolean }, vr: boolean) {
    if (!this.active) return;
    this.lastPlayer.copy(player.pos);
    const people = [{ x: player.pos.x - AX, y: player.pos.y, z: player.pos.z - AZ, vx: player.vel.x, vz: player.vel.z }];
    if (this.driving) people.length = 0;
    this.puppets(dt);
    // a car nobody has touched for a while (say, up on the tower) drives itself home
    for (const c of this.cars) {
      const away = Math.hypot(c.x - c.home.x, c.z - c.home.z) > 3 || c.y > 6.5;
      if (c.driver !== null || this.remote.has(c.index) || !away || Math.hypot(AX + c.x - player.pos.x, AZ + c.z - player.pos.z) < 25) { this.idle.set(c.index, 0); continue; }
      const t = (this.idle.get(c.index) ?? 0) + dt; this.idle.set(c.index, t);
      if (t > 120) { c.reset(); this.idle.set(c.index, 0); }
    }
    const steps = Math.max(1, Math.ceil(dt / (1 / 90))), h = dt / steps;
    for (let s = 0; s < steps; s++) {
      for (const c of this.cars) {
        if (c.driver === this.myId && c === this.driving) c.step(h, this, ctl.gas, ctl.steer, ctl.hand, ctl.boost);
        else if (!this.remote.has(c.index)) c.step(h, this, 0, 0, true, false);          // parked cars roll to a stop
      }
      this.carCollisions();
      this.balloons.step(h, this.cars, people);
    }
    for (const c of this.cars) c.place(AX, AZ);
    // crash sounds
    for (const c of this.cars) { if (c.bump > 3 && (c === this.driving)) this.sfx?.crash(Math.min(1, c.bump / 18)); c.bump = 0; }
    const car = this.driving;
    if (car) {
      if (car.dash) car.dash.visible = vr;                       // the cockpit readout is for VR; on a flat screen the HUD has the speedo
      car.seatPos(this.v);
      player.pos.set(AX + this.v.x, this.v.y, AZ + this.v.z);
      player.vel.set(car.vx, 0, car.vz);
      if (vr) { player.yaw = car.yaw + Math.PI; player.pitch = 0; }
      else { player.yaw = car.yaw + Math.PI + this.camYaw; player.pitch = this.camPitch; }
      this.sfx?.engine(Math.min(1, 0.12 + Math.abs(car.fwdSpeed) / car.spec.maxSpeed * 0.85 + Math.abs(ctl.gas) * 0.15 + (ctl.boost ? 0.1 : 0)));
      // dash + speedo
      this.dashT -= dt;
      const kmh = Math.round(Math.abs(car.fwdSpeed) * 3.6);
      this.speedo.innerHTML = `<div style="font-size:30px;line-height:1">${kmh}<span style="font-size:13px;opacity:.8"> km/h</span></div><div style="opacity:.85">${car.spec.name}</div><div style="opacity:.6;font-weight:500;font-size:12px">E exit · Space handbrake · Shift boost</div>`;
      if (this.dashT <= 0 && this.dashCtx && this.dashTex) {
        this.dashT = 0.12;
        const g = this.dashCtx; g.fillStyle = '#0b1a24'; g.fillRect(0, 0, 256, 128);
        g.fillStyle = '#7fffd4'; g.textAlign = 'center'; g.font = '700 74px system-ui,sans-serif'; g.fillText(String(kmh), 128, 78);
        g.font = '600 22px system-ui,sans-serif'; g.fillStyle = '#9fc2cf'; g.fillText('KM/H · ' + car.spec.name.toUpperCase(), 128, 112);
        this.dashTex.needsUpdate = true;
      }
    } else this.sfx?.engine(null);
    this.plVel.x = player.vel.x; this.plVel.z = player.vel.z;
  }

  /** after the player update: the third-person chase camera on desktop and touch */
  post(dt: number, camera: THREE.PerspectiveCamera, player: { yaw: number; pitch: number }) {
    const car = this.driving; if (!car) return;
    // first person in the driver's seat: the mouse looks around relative to the car (and drifts back to straight ahead)
    const base = car.yaw + Math.PI;
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    let ly = wrap(player.yaw - base), lp = player.pitch;
    const moved = Math.abs(ly - this.camYaw) > 1e-4 || Math.abs(lp - this.camPitch) > 1e-4;
    this.lookIdle = moved ? 0 : this.lookIdle + dt;
    ly = Math.max(-2.5, Math.min(2.5, ly)); lp = Math.max(-0.8, Math.min(0.7, lp));
    if (this.lookIdle > 1.5) { const k = Math.min(1, dt * 1.5); ly -= ly * k; lp -= (lp - 0.02) * k; }
    this.camYaw = ly; this.camPitch = lp;
    const [sx, , sz] = car.spec.seat;
    car.root.updateMatrixWorld(true);
    camera.position.set(sx, car.spec.eye, sz); car.root.localToWorld(camera.position);
    this.q1.setFromEuler(this.e1.set(lp, ly + Math.PI, 0, 'YXZ'));     // look offset; the car's own forward is local +z, the camera looks down -z
    camera.quaternion.copy(car.root.quaternion).multiply(this.q1);
  }
  private q1 = new THREE.Quaternion(); private e1 = new THREE.Euler();

  private carCollisions() {
    for (let i = 0; i < this.cars.length; i++) for (let j = i + 1; j < this.cars.length; j++) {
      const a = this.cars[i], b = this.cars[j];
      const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz), rr = a.spec.crash + b.spec.crash;
      if (d >= rr || d < 1e-4 || Math.abs(a.y - b.y) > 1.5) continue;
      const nx = dx / d, nz = dz / d, push = (rr - d) / 2;
      a.x -= nx * push; a.z -= nz * push; b.x += nx * push; b.z += nz * push;
      const vn = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
      if (vn < 0) {
        const ma = a.spec.mass, mb = b.spec.mass, j2 = (-(1 + 0.4) * vn) / (1 / ma + 1 / mb);
        a.vx -= (j2 / ma) * nx; a.vz -= (j2 / ma) * nz; b.vx += (j2 / mb) * nx; b.vz += (j2 / mb) * nz;
        a.bump = Math.max(a.bump, -vn); b.bump = Math.max(b.bump, -vn);
      }
    }
  }

  /** keep the player from being left in the airstrip by accident (a save, a respawn): returns true if they are in the region */
  contains(x: number, z: number, margin = 520) { return Math.abs(x - AX) < margin && Math.abs(z - AZ) < margin; }
}
