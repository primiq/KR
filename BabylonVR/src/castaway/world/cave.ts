// The caves under the island. They live in their own space far below the surface: a network of tunnels and chambers
// described by capsules (a signed distance field), meshed on demand with marching cubes in 16 m chunks around the
// player. Ores, crystals and chests are generated per chunk from fixed seeds, so every visit (and every player) sees
// the same caves; only what has been mined / opened is remembered.
// Babylon port: generation is Castaway's, unchanged; the materials are named stand-ins that render/mirror.ts swaps for
// Babylon ones (see caveMaterial in game/underground.ts), and the point lights are copied onto Babylon lights each frame.
import * as THREE from 'three';
import { edgeTable, triTable } from 'three/examples/jsm/objects/MarchingCubes.js';
import { mulberry32 } from '../core/noise';
import { baseHeightAt, slopeAt, rockiness } from './island';

export const CAVE_Y = -58;            // the usual depth of the main level
const YS = 1.45;                        // tunnels are wider than tall
const BIN = 16;
const CS = 16, CELL = 0.8, NC = CS / CELL; // chunk size, cell size, cells per side
const SAMP = NC + 3;                    // samples per side (one border cell each side for normals)

export interface Seg { ax: number; ay: number; az: number; bx: number; by: number; bz: number; ra: number; rb: number }
export interface Site { id: string; kind: 'chest'; x: number; y: number; z: number; rich: number }
export interface Entrance { x: number; z: number; sy: number; cy: number }

// ------------------------------------------------------------------ small helpers
function hash3(ix: number, iy: number, iz: number): number {
  let n = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(iz, 1274126177);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
  const a = hash3(ix, iy, iz), b = hash3(ix + 1, iy, iz), c = hash3(ix, iy + 1, iz), d = hash3(ix + 1, iy + 1, iz);
  const e = hash3(ix, iy, iz + 1), f = hash3(ix + 1, iy, iz + 1), g = hash3(ix, iy + 1, iz + 1), h = hash3(ix + 1, iy + 1, iz + 1);
  const x0 = a + (b - a) * sx, x1 = c + (d - c) * sx, x2 = e + (f - e) * sx, x3 = g + (h - g) * sx;
  const y0 = x0 + (x1 - x0) * sy, y1 = x2 + (x3 - x2) * sy;
  return y0 + (y1 - y0) * sz;
}
const smin = (a: number, b: number, k: number) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const binKey = (ix: number, iy: number, iz: number) => ((ix + 64) * 128 + (iz + 64)) * 64 + (iy + 32);

/** Where the cave shafts open on the surface (shared so the surface buildings can keep clear of them). */
function pickEntrancePoints(rnd: () => number): Entrance[] {
  const want = 9, out: Entrance[] = [];
  for (let tries = 0; tries < 6000 && out.length < want; tries++) {
    const r = 30 + rnd() * 165, a = rnd() * Math.PI * 2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r, h = baseHeightAt(x, z);
    if (h < 3.6 || h > 20) continue;
    if (slopeAt(x, z, 2) > 0.45 || rockiness(x, z) > 0.2 || h > 40) continue;
    if (out.some((e) => Math.hypot(e.x - x, e.z - z) < 70)) continue;
    out.push({ x, z, sy: h, cy: CAVE_Y + (rnd() - 0.5) * 8 });
  }
  return out;
}
export const caveEntranceXZ = (seed = 7777) => pickEntrancePoints(mulberry32(seed)).map((e) => ({ x: e.x, z: e.z }));

// ------------------------------------------------------------------ the network
export class CaveNet {
  readonly segs: Seg[] = [];
  readonly bins = new Map<number, Seg[]>();
  readonly sites: Site[] = [];
  readonly entrances: Entrance[] = [];
  private rnd: () => number;
  private siteN = 0;

  constructor(readonly seed: number) {
    this.rnd = mulberry32(seed);
    this.pickEntrances();
    for (const e of this.entrances) {
      this.sphere(e.x, e.cy, e.z, 5.2);
      const a0 = this.rnd() * Math.PI * 2;
      this.worm(e.x, e.cy, e.z, a0, 0, 40, 2.7, 0);
      this.worm(e.x, e.cy, e.z, a0 + Math.PI * (0.7 + this.rnd() * 0.6), 0, 26, 2.6, 0);
    }
    // connect every entrance to its two nearest neighbours so the whole system is one place
    this.entrances.forEach((a, i) => {
      const others = this.entrances.map((b, j) => ({ j, d: Math.hypot(a.x - b.x, a.z - b.z) })).filter((o) => o.j !== i).sort((p, q) => p.d - q.d).slice(0, 2);
      for (const o of others) this.link(a, this.entrances[o.j]);
    });
  }

  private pickEntrances() { this.entrances.push(...pickEntrancePoints(this.rnd)); }

  private inland(x: number, z: number) { return baseHeightAt(x, z) > 2.2 && Math.hypot(x, z) < 235; }

  private add(s: Seg) {
    this.segs.push(s);
    const pad = Math.max(s.ra, s.rb) + 3.5;
    const x0 = Math.min(s.ax, s.bx) - pad, x1 = Math.max(s.ax, s.bx) + pad;
    const y0 = Math.min(s.ay, s.by) - pad, y1 = Math.max(s.ay, s.by) + pad;
    const z0 = Math.min(s.az, s.bz) - pad, z1 = Math.max(s.az, s.bz) + pad;
    for (let ix = Math.floor(x0 / BIN); ix <= Math.floor(x1 / BIN); ix++)
      for (let iy = Math.floor(y0 / BIN); iy <= Math.floor(y1 / BIN); iy++)
        for (let iz = Math.floor(z0 / BIN); iz <= Math.floor(z1 / BIN); iz++) {
          const k = binKey(ix, iy, iz);
          let l = this.bins.get(k);
          if (!l) { l = []; this.bins.set(k, l); }
          l.push(s);
        }
  }
  private sphere(x: number, y: number, z: number, r: number) { this.add({ ax: x, ay: y, az: z, bx: x, by: y, bz: z, ra: r, rb: r }); }

  private chamber(x: number, y: number, z: number, r: number, chest: number, rich: number) {
    this.sphere(x, y, z, r);
    const k = 1 + Math.floor(this.rnd() * 2);
    for (let i = 0; i < k; i++) {
      const a = this.rnd() * Math.PI * 2, d = r * (0.6 + this.rnd() * 0.5);
      this.sphere(x + Math.cos(a) * d, y + (this.rnd() - 0.5) * 1.5, z + Math.sin(a) * d, r * (0.55 + this.rnd() * 0.3));
    }
    if (this.rnd() < chest && !this.sites.some((q) => Math.hypot(q.x - x, q.z - z) < 22 && Math.abs(q.y - y) < 14)) this.sites.push({ id: `c${this.siteN++}`, kind: 'chest', x, y: y - r / YS * 0.5, z, rich });
  }

  private worm(x: number, y: number, z: number, ang: number, pitch: number, steps: number, r: number, depth: number) {
    for (let i = 0; i < steps; i++) {
      const L = 5.5 + this.rnd() * 3;
      ang += (this.rnd() - 0.5) * 0.85;
      const base = CAVE_Y + (vnoise(x * 0.01, 3.3, z * 0.01) - 0.5) * 24;
      const want = clamp((base - y) * 0.04, -0.35, 0.35);
      pitch = clamp(pitch + (want - pitch) * 0.5 + (this.rnd() - 0.5) * 0.14, -0.4, 0.4);
      let nx = 0, ny = 0, nz = 0, ok = false;
      for (let t = 0; t < 7; t++) {
        nx = x + Math.cos(ang) * Math.cos(pitch) * L; ny = y + Math.sin(pitch) * L; nz = z + Math.sin(ang) * Math.cos(pitch) * L;
        if (this.inland(nx, nz)) { ok = true; break; }
        ang = Math.atan2(-z, -x) + (this.rnd() - 0.5) * 1.3;
      }
      if (!ok) break;
      const nr = clamp(r + (this.rnd() - 0.5) * 0.55, 2.3, 3.5);
      this.add({ ax: x, ay: y, az: z, bx: nx, by: ny, bz: nz, ra: r, rb: nr });
      x = nx; y = ny; z = nz; r = nr;
      if (this.rnd() < 0.075 && depth < 2) this.worm(x, y, z, ang + (this.rnd() < 0.5 ? 1 : -1) * (0.9 + this.rnd() * 0.8), pitch * 0.4, Math.floor(steps * (0.3 + this.rnd() * 0.25)) + 5, r * 0.95, depth + 1);
      if (this.rnd() < 0.065) this.chamber(x, y, z, 5.2 + this.rnd() * 3.4, 0.3, 0.5);
    }
    this.chamber(x, y, z, 5 + this.rnd() * 2.6, 0.7, 1); // every dead end opens into a chamber, usually with a chest
  }

  private link(a: Entrance, b: Entrance) {
    let x = a.x, y = a.cy, z = a.z, pitch = 0;
    for (let i = 0; i < 90; i++) {
      const dx = b.x - x, dz = b.z - z, d = Math.hypot(dx, dz);
      if (d < 9) { this.add({ ax: x, ay: y, az: z, bx: b.x, by: b.cy, bz: b.z, ra: 2.6, rb: 2.8 }); return; }
      const ang = Math.atan2(dz, dx) + (this.rnd() - 0.5) * 0.9;
      pitch = clamp(pitch + (clamp((b.cy - y) * 0.05, -0.3, 0.3) - pitch) * 0.5, -0.35, 0.35);
      const L = 6 + this.rnd() * 2.5;
      const nx = x + Math.cos(ang) * Math.cos(pitch) * L, ny = y + Math.sin(pitch) * L, nz = z + Math.sin(ang) * Math.cos(pitch) * L;
      if (!this.inland(nx, nz)) { x = x + dx * 0.1; z = z + dz * 0.1; continue; }
      this.add({ ax: x, ay: y, az: z, bx: nx, by: ny, bz: nz, ra: 2.5, rb: 2.7 });
      x = nx; y = ny; z = nz;
      if (i === 40) this.chamber(x, y, z, 5.5, 0.5, 0.6);
    }
  }

  /** Negative = open air. */
  sdf(x: number, y: number, z: number): number {
    const bin = this.bins.get(binKey(Math.floor(x / BIN), Math.floor(y / BIN), Math.floor(z / BIN)));
    if (!bin) return 6;
    let d = 1e9;
    for (let i = 0; i < bin.length; i++) {
      const s = bin[i];
      const aby = (s.by - s.ay) * YS, abx = s.bx - s.ax, abz = s.bz - s.az;
      const pax = x - s.ax, pay = (y - s.ay) * YS, paz = z - s.az;
      const l2 = abx * abx + aby * aby + abz * abz;
      const t = l2 > 1e-6 ? clamp((pax * abx + pay * aby + paz * abz) / l2, 0, 1) : 0;
      const dx = pax - abx * t, dy = pay - aby * t, dz = paz - abz * t;
      const di = Math.sqrt(dx * dx + dy * dy + dz * dz) - (s.ra + (s.rb - s.ra) * t);
      d = smin(d, di, 1.1);
    }
    const rock = (vnoise(x * 0.28, y * 0.28, z * 0.28) - 0.5) * 1.0 + (vnoise(x * 0.8 + 9, y * 0.8, z * 0.8) - 0.5) * 0.32;
    return d + rock * 0.62;
  }

  grad(x: number, y: number, z: number, out: THREE.Vector3, e = 0.2) {
    out.set(this.sdf(x + e, y, z) - this.sdf(x - e, y, z), this.sdf(x, y + e, z) - this.sdf(x, y - e, z), this.sdf(x, y, z + e) - this.sdf(x, y, z - e));
    const l = out.length() || 1; return out.divideScalar(l);
  }

  /** Walkable floor below (x, y): where the air ends. `null` when there is no air at the starting height. */
  floor(x: number, z: number, y: number): number {
    const y0 = y + 0.85;
    if (this.sdf(x, y0, z) >= -0.02) return y0; // inside rock: behaves like a wall
    let yy = y0;
    for (let k = 0; k < 40; k++) { // 0.1 m steps for the first 4 m
      yy -= 0.1;
      if (this.sdf(x, yy, z) >= -0.02) { // refine, so the floor height does not depend on where the search started (that made you twitch)
        let lo = yy, hi = yy + 0.1; for (let i = 0; i < 6; i++) { const m = (lo + hi) / 2; if (this.sdf(x, m, z) >= -0.02) lo = m; else hi = m; } return lo;
      }
    }
    for (let k = 0; k < 90; k++) { // then 0.5 m steps
      yy -= 0.5;
      if (this.sdf(x, yy, z) >= -0.02) { let lo = yy, hi = yy + 0.5; for (let i = 0; i < 5; i++) { const m = (lo + hi) / 2; if (this.sdf(x, m, z) >= -0.02) lo = m; else hi = m; } return lo; }
    }
    return y - 80; // a bottomless drop: the void guard catches it
  }

  private g = new THREE.Vector3();
  /** Push a walking circle out of the walls. */
  resolve(x: number, z: number, r: number, feetY: number, out: { x: number; z: number }) {
    for (let it = 0; it < 3; it++) {
      let moved = false;
      for (const h of [0.45, 1.05, 1.6]) {
        const d = -this.sdf(x, feetY + h, z);
        if (d < r) {
          this.grad(x, feetY + h, z, this.g);
          const hl = Math.hypot(this.g.x, this.g.z);
          if (hl > 0.05) { const k = (r - d) / hl * 0.9; x -= this.g.x * k; z -= this.g.z * k; moved = true; }
        }
      }
      if (!moved) break;
    }
    out.x = x; out.z = z;
  }
}

// ------------------------------------------------------------------ meshing helpers
class Soup {
  pos: number[] = []; nor: number[] = []; col: number[] = [];
  private c = new THREE.Color();
  get empty() { return this.pos.length === 0; }
  add(g: THREE.BufferGeometry, hex: THREE.ColorRepresentation, m: THREE.Matrix4) {
    const geo = g.index ? g.toNonIndexed() : g;
    geo.applyMatrix4(m);
    geo.computeVertexNormals();
    const P = geo.attributes.position, N = geo.attributes.normal;
    this.c.set(hex);
    for (let i = 0; i < P.count; i++) { this.pos.push(P.getX(i), P.getY(i), P.getZ(i)); this.nor.push(N.getX(i), N.getY(i), N.getZ(i)); this.col.push(this.c.r, this.c.g, this.c.b); }
    if (geo !== g) geo.dispose();
    g.dispose();
  }
  build(mat: THREE.Material): THREE.Mesh {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return new THREE.Mesh(g, mat);
  }
}

const EDGE: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
const CORNER = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];

// ------------------------------------------------------------------ the world made of chunks
export type OreKind = 'iron' | 'coal' | 'diamond';
export interface Ore { id: string; kind: OreKind; x: number; y: number; z: number; nx: number; ny: number; nz: number; left: number }
export interface Chest { id: string; x: number; y: number; z: number; yaw: number; rich: number; group: THREE.Group; lid: THREE.Group; open: number; opened: boolean }
export interface Glow { x: number; y: number; z: number; col: THREE.Color; k: number; warm?: boolean }
interface Chunk { key: string; cx: number; cy: number; cz: number; group: THREE.Group; ores: Ore[]; soups: THREE.Mesh[]; glows: Glow[]; chests: Chest[]; oreGroup: THREE.Group }

const CRYSTAL_COLS = ['#37e6ff', '#c35cff', '#58ff8a', '#ffb23c', '#ff5c8a'];
const ORE_HP: Record<OreKind, number> = { iron: 14, coal: 10, diamond: 3 };

let MATS: { rock: THREE.Material; ore: THREE.Material; glow: THREE.Material; wood: THREE.Material } | null = null;
function materials() {
  if (!MATS) {
    const mk = (name: string) => new THREE.MeshStandardMaterial({ name, vertexColors: true });
    MATS = { rock: mk('caveRock'), ore: mk('caveOre'), glow: mk('caveGlow'), wood: mk('caveWood') };
  }
  return MATS;
}

function halo(col: THREE.Color): THREE.SpriteMaterial {
  return new THREE.SpriteMaterial({ color: col, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
}
const haloCache = new Map<string, THREE.SpriteMaterial>();

export class CaveWorld {
  readonly net: CaveNet;
  readonly group = new THREE.Group();
  readonly chunks = new Map<string, Chunk>();
  private empty = new Set<string>();
  private queue: { cx: number; cy: number; cz: number; d: number }[] = [];
  readonly lights: THREE.PointLight[] = Array.from({ length: 5 }, () => new THREE.PointLight(0xffffff, 0, 17, 2));
  private lightFor: (Glow | null)[] = [null, null, null, null, null];
  private lightFade = [0, 0, 0, 0, 0];
  /** mined ores and opened chests, by id */
  readonly mined = new Set<string>();
  readonly opened = new Set<string>();
  /** ores that have been hit but are not spent yet: id -> hits left (shared between players) */
  readonly partial = new Map<string, number>();
  private t = 0;
  private M = materials();

  constructor(seed = 7777) {
    this.net = new CaveNet(seed);
    this.group.visible = false;
    this.lights.forEach((l) => { l.castShadow = false; this.group.add(l); });
  }

  // ---- player collision API
  floor(x: number, z: number, y: number) { return this.net.floor(x, z, y); }
  resolve(x: number, z: number, r: number, feetY: number, out: { x: number; z: number }) { this.net.resolve(x, z, r, feetY, out); }
  /** where to stand when arriving by the rope of entrance i */
  landing(i: number) { const e = this.net.entrances[i]; return { x: e.x, z: e.z, y: this.net.floor(e.x, e.z, e.cy + 1.5) }; }

  // ---- streaming
  update(dt: number, px: number, py: number, pz: number, budgetMs = 5) {
    this.t += dt;
    const pcx = Math.floor(px / CS), pcy = Math.floor(py / CS), pcz = Math.floor(pz / CS);
    const R = 4;
    for (let dx = -R; dx <= R; dx++) for (let dy = -2; dy <= 2; dy++) for (let dz = -R; dz <= R; dz++) {
      const key = `${pcx + dx},${pcy + dy},${pcz + dz}`;
      if (this.chunks.has(key) || this.empty.has(key)) continue;
      if (this.queue.some((q) => q.cx === pcx + dx && q.cy === pcy + dy && q.cz === pcz + dz)) continue;
      this.queue.push({ cx: pcx + dx, cy: pcy + dy, cz: pcz + dz, d: dx * dx + dy * dy * 2 + dz * dz });
    }
    this.queue.sort((a, b) => a.d - b.d);
    const t0 = performance.now();
    while (this.queue.length && performance.now() - t0 < budgetMs) {
      const q = this.queue.shift()!;
      if (Math.abs(q.cx - pcx) > R + 1 || Math.abs(q.cz - pcz) > R + 1) continue;
      this.buildChunk(q.cx, q.cy, q.cz);
    }
    for (const [k, c] of this.chunks) {
      if (Math.abs(c.cx - pcx) > R + 1 || Math.abs(c.cz - pcz) > R + 1 || Math.abs(c.cy - pcy) > 3) this.dropChunk(k, c);
    }
    // the five nearest glowing things light the passage
    const cands: { g: Glow; d: number }[] = [];
    for (const c of this.chunks.values()) for (const g of c.glows) {
      const d = Math.hypot(g.x - px, g.y - py, g.z - pz);
      if (d < 34) cands.push({ g, d });
    }
    cands.sort((a, b) => a.d - b.d);
    const top = cands.slice(0, 5).map((c) => c.g);
    for (let i = 0; i < 5; i++) { const cur = this.lightFor[i]; if (cur && !top.includes(cur) && this.lightFade[i] < 0.05) this.lightFor[i] = null; }
    for (const g of top) {
      if (this.lightFor.includes(g)) continue;
      const i = this.lightFor.findIndex((c, k) => !c || (!top.includes(c) && this.lightFade[k] < 0.05));
      if (i >= 0) { this.lightFor[i] = g; this.lightFade[i] = 0; this.lights[i].color.copy(g.col); }
    }
    for (let i = 0; i < 5; i++) {
      const g = this.lightFor[i], L = this.lights[i];
      let tgt = 0;
      if (g && top.includes(g)) { L.position.set(g.x, g.y, g.z); tgt = g.k * (0.92 + 0.08 * Math.sin(this.t * 3 + g.x)); }
      this.lightFade[i] += (tgt - this.lightFade[i]) * Math.min(1, dt * 5);
      L.intensity = this.lightFade[i];
    }
    for (const c of this.chunks.values()) for (const ch of c.chests) {
      const want = ch.opened ? 1 : 0;
      ch.open += (want - ch.open) * Math.min(1, dt * 6);
      ch.lid.rotation.x = -ch.open * 1.9;
    }
  }

  /** Build everything within 1 chunk of the player right now (arriving from the surface). */
  prewarm(px: number, py: number, pz: number) {
    const pcx = Math.floor(px / CS), pcy = Math.floor(py / CS), pcz = Math.floor(pz / CS);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const key = `${pcx + dx},${pcy + dy},${pcz + dz}`;
      if (!this.chunks.has(key) && !this.empty.has(key)) this.buildChunk(pcx + dx, pcy + dy, pcz + dz);
    }
  }

  private dropChunk(key: string, c: Chunk) {
    this.group.remove(c.group);
    c.group.traverse((o: any) => { if (o.geometry && !o.isSprite) o.geometry.dispose(); });
    this.chunks.delete(key);
  }

  clear() { for (const [k, c] of [...this.chunks]) this.dropChunk(k, c); this.queue.length = 0; this.empty.clear(); }

  // ---- one chunk
  private buildChunk(cx: number, cy: number, cz: number) {
    const key = `${cx},${cy},${cz}`;
    if (!this.net.bins.get(binKey(cx, cy, cz))) { this.empty.add(key); return; }
    const ox = cx * CS, oy = cy * CS, oz = cz * CS;
    const F = new Float32Array(SAMP * SAMP * SAMP);
    const idx = (i: number, j: number, k: number) => i + SAMP * (j + SAMP * k);
    let anyNeg = false, anyPos = false;
    for (let k = 0; k < SAMP; k++) for (let j = 0; j < SAMP; j++) for (let i = 0; i < SAMP; i++) {
      const v = this.net.sdf(ox + (i - 1) * CELL, oy + (j - 1) * CELL, oz + (k - 1) * CELL);
      F[idx(i, j, k)] = v; if (v < 0) anyNeg = true; else anyPos = true;
    }
    if (!(anyNeg && anyPos)) { this.empty.add(key); return; }

    const pos: number[] = [], nor: number[] = [], col: number[] = [];
    const vp = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], vn = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const cn = (i: number, j: number, k: number, out: THREE.Vector3) => {
      out.set(F[idx(i - 1, j, k)] - F[idx(i + 1, j, k)], F[idx(i, j - 1, k)] - F[idx(i, j + 1, k)], F[idx(i, j, k - 1)] - F[idx(i, j, k + 1)]);
    }; // points toward the air (-grad)
    const na = new THREE.Vector3(), nb = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), fn = new THREE.Vector3();
    const cv = new Float32Array(8), ev: THREE.Vector3[] = Array.from({ length: 12 }, () => new THREE.Vector3()), en: THREE.Vector3[] = Array.from({ length: 12 }, () => new THREE.Vector3());
    const rockA = new THREE.Color('#a69a8a'), rockB = new THREE.Color('#5d554c'), moss = new THREE.Color('#3f5237'), warm = new THREE.Color('#7a5a3c'), tmp = new THREE.Color();
    for (let k = 0; k < NC; k++) for (let j = 0; j < NC; j++) for (let i = 0; i < NC; i++) {
      let ci = 0;
      for (let c = 0; c < 8; c++) { const cc = CORNER[c]; const v = F[idx(i + 1 + cc[0], j + 1 + cc[1], k + 1 + cc[2])]; cv[c] = v; if (v < 0) ci |= 1 << c; }
      const et = edgeTable[ci];
      if (et === 0) continue;
      for (let e = 0; e < 12; e++) {
        if (!(et & (1 << e))) continue;
        const [a, b] = EDGE[e], ca = CORNER[a], cb = CORNER[b];
        const fa = cv[a], fb = cv[b];
        const t = Math.abs(fb - fa) < 1e-6 ? 0.5 : clamp(-fa / (fb - fa), 0, 1);
        ev[e].set(ox + (i + ca[0] + (cb[0] - ca[0]) * t) * CELL, oy + (j + ca[1] + (cb[1] - ca[1]) * t) * CELL, oz + (k + ca[2] + (cb[2] - ca[2]) * t) * CELL);
        cn(i + 1 + ca[0], j + 1 + ca[1], k + 1 + ca[2], na); cn(i + 1 + cb[0], j + 1 + cb[1], k + 1 + cb[2], nb);
        en[e].copy(na).lerp(nb, t).normalize();
      }
      for (let n = 0; triTable[ci * 16 + n] !== -1 && n < 15; n += 3) {
        for (let v = 0; v < 3; v++) { vp[v].copy(ev[triTable[ci * 16 + n + v]]); vn[v].copy(en[triTable[ci * 16 + n + v]]); }
        e1.subVectors(vp[1], vp[0]); e2.subVectors(vp[2], vp[0]); fn.crossVectors(e1, e2);
        if (fn.lengthSq() < 1e-8) continue;
        const flip = fn.dot(na.copy(vn[0]).add(vn[1]).add(vn[2])) < 0;
        const order = flip ? [0, 2, 1] : [0, 1, 2];
        for (const v of order) {
          const p = vp[v], nn = vn[v];
          pos.push(p.x, p.y, p.z); nor.push(nn.x, nn.y, nn.z);
          const n1 = vnoise(p.x * 0.11, p.y * 0.11, p.z * 0.11), n2 = vnoise(p.x * 0.45 + 4, p.y * 0.9, p.z * 0.45);
          tmp.copy(rockA).lerp(rockB, n1).lerp(warm, smoothS(0.55, 0.85, n2) * 0.35);
          const up = clamp(nn.y, 0, 1); // floors gather a little moss
          tmp.lerp(moss, smoothS(0.5, 0.95, up) * 0.45 * smoothS(0.35, 0.7, n1));
          col.push(tmp.r, tmp.g, tmp.b);
        }
      }
    }
    if (!pos.length) { this.empty.add(key); return; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, this.M.rock);
    const chunk: Chunk = { key, cx, cy, cz, group: new THREE.Group(), ores: [], soups: [], glows: [], chests: [], oreGroup: new THREE.Group() };
    chunk.group.add(mesh, chunk.oreGroup);
    this.chunks.set(key, chunk);
    this.group.add(chunk.group);
    this.decorate(chunk, ox, oy, oz);
  }

  /** ores, crystals, chests and the rope for this chunk (deterministic) */
  private decorate(c: Chunk, ox: number, oy: number, oz: number) {
    const rnd = mulberry32((Math.imul(c.cx, 73856093) ^ Math.imul(c.cy, 19349663) ^ Math.imul(c.cz, 83492791) ^ this.net.seed) >>> 0);
    const v = new THREE.Vector3(), n = new THREE.Vector3();
    const wall = (maxD: number): { p: THREE.Vector3; n: THREE.Vector3 } | null => {
      const px = ox + rnd() * CS, py = oy + rnd() * CS, pz = oz + rnd() * CS;
      const a = rnd() * Math.PI * 2, el = (rnd() - 0.5) * 1.4;
      const dx = Math.cos(a) * Math.cos(el), dy = Math.sin(el), dz = Math.sin(a) * Math.cos(el);
      if (this.net.sdf(px, py, pz) > -0.8) return null;
      let lo = 0, hi = -1;
      for (let t = 0.5; t <= maxD; t += 0.5) if (this.net.sdf(px + dx * t, py + dy * t, pz + dz * t) > 0) { hi = t; lo = t - 0.5; break; }
      if (hi < 0) return null;
      for (let i = 0; i < 6; i++) { const m = (lo + hi) / 2; if (this.net.sdf(px + dx * m, py + dy * m, pz + dz * m) > 0) hi = m; else lo = m; }
      const p = new THREE.Vector3(px + dx * hi, py + dy * hi, pz + dz * hi);
      this.net.grad(p.x, p.y, p.z, n); const nn = n.clone().negate();
      return { p, n: nn };
    };
    void v;
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
    const ores = new Soup(), glow = new Soup(), cry = new Soup();

    // ---- ores
    for (let k = 0; k < 14; k++) {
      const roll = rnd(), w = wall(11), lr = rnd();
      if (!w) continue;
      const id = `${c.cx},${c.cy},${c.cz}:${k}`;
      if (this.mined.has(id)) continue;
      const kind: OreKind = roll < 0.6 ? 'iron' : roll < 0.975 ? 'coal' : 'diamond';
      c.ores.push({ id, kind, x: w.p.x - w.n.x * 0.1, y: w.p.y - w.n.y * 0.1, z: w.p.z - w.n.z * 0.1, nx: w.n.x, ny: w.n.y, nz: w.n.z, left: this.partial.get(id) ?? Math.max(1, Math.round(ORE_HP[kind] * (0.7 + lr * 0.6))) });
    }
    this.fillOres(c, ores, glow, rnd);

    // ---- crystals: whole corridors share a colour and a glow
    const zone = (x: number, y: number, z: number) => vnoise(x * 0.018 + 31, y * 0.03, z * 0.018 - 7);
    for (let k = 0; k < 9; k++) {
      const w = wall(9), pr = rnd(), cr = rnd(), jr = rnd();
      if (!w) continue;
      const z0 = zone(w.p.x, w.p.y, w.p.z);
      const chance = z0 > 0.56 ? 0.85 : z0 > 0.5 ? 0.25 : 0.035;
      if (pr > chance) continue;
      const ci = Math.floor(vnoise(w.p.x * 0.012, 5.5, w.p.z * 0.012) * CRYSTAL_COLS.length * 0.999);
      const baseCol = new THREE.Color(CRYSTAL_COLS[clamp(ci, 0, CRYSTAL_COLS.length - 1)]);
      const cnt = 3 + Math.floor(cr * 5);
      for (let i = 0; i < cnt; i++) {
        const h = 0.45 + rnd() * (i === 0 ? 1.3 : 0.8), r = 0.06 + rnd() * 0.1;
        const dir = new THREE.Vector3(w.n.x + (rnd() - 0.5) * 1.1, w.n.y + (rnd() - 0.5) * 1.1, w.n.z + (rnd() - 0.5) * 1.1).normalize();
        Q.setFromUnitVectors(UP, dir);
        P.set(w.p.x + (rnd() - 0.5) * 0.45, w.p.y + (rnd() - 0.5) * 0.45, w.p.z + (rnd() - 0.5) * 0.45).addScaledVector(dir, h * 0.42 - 0.08);
        M.compose(P, Q, S.set(1, 1, 1));
        const tint = baseCol.clone().multiplyScalar(0.75 + rnd() * 0.5);
        cry.add(new THREE.CylinderGeometry(0.012, r, h, 6, 1), tint, M);
      }
      void jr;
      c.glows.push({ x: w.p.x + w.n.x * 0.7, y: w.p.y + w.n.y * 0.7, z: w.p.z + w.n.z * 0.7, col: baseCol, k: 7 });
      const hs = new THREE.Sprite(this.haloFor(baseCol));
      hs.position.set(w.p.x + w.n.x * 0.6, w.p.y + w.n.y * 0.6, w.p.z + w.n.z * 0.6); hs.scale.setScalar(3.2 + cr * 1.5); hs.renderOrder = 6;
      c.group.add(hs);
    }
    if (!cry.empty) c.group.add(cry.build(this.M.glow));
    this.attachSoups(c, ores, glow);

    // ---- chests and the rope
    for (const s of this.net.sites) {
      if (s.x < ox || s.x >= ox + CS || s.y < oy - 6 || s.y >= oy + CS + 6 || s.z < oz || s.z >= oz + CS) continue;
      if (Math.floor(s.y / CS) !== c.cy) continue;
      const fy = this.net.floor(s.x, s.z, s.y + 2);
      const yaw = hash3(Math.floor(s.x), 3, Math.floor(s.z)) * Math.PI * 2;
      c.chests.push(this.makeChest(s, fy, yaw, c));
    }
    this.net.entrances.forEach((e, i) => {
      if (e.x < ox || e.x >= ox + CS || e.z < oz || e.z >= oz + CS || Math.floor(e.cy / CS) !== c.cy) return;
      this.makeRope(e, i, c);
    });
  }

  private haloFor(col: THREE.Color) {
    const k = col.getHexString();
    let m = haloCache.get(k);
    if (!m) { m = halo(col); haloCache.set(k, m); }
    return m;
  }

  private fillOres(c: Chunk, ores: Soup, glow: Soup, rnd: () => number) {
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), P = new THREE.Vector3(), S = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
    for (const o of c.ores) {
      const h = (n: number) => hash3(Math.floor(o.x * 7) + n, Math.floor(o.y * 7), Math.floor(o.z * 7));
      const lumps = o.kind === 'diamond' ? 3 : 5;
      for (let i = 0; i < lumps; i++) {
        const r = 0.2 + h(i) * 0.2;
        P.set(o.x + (h(i + 9) - 0.5) * 0.7 + o.nx * 0.1, o.y + (h(i + 17) - 0.5) * 0.7 + o.ny * 0.1, o.z + (h(i + 23) - 0.5) * 0.7 + o.nz * 0.1);
        E.set(h(i + 3) * 6, h(i + 5) * 6, h(i + 7) * 6); Q.setFromEuler(E);
        M.compose(P, Q, S.set(1, 0.85 + h(i + 11) * 0.3, 1));
        ores.add(new THREE.IcosahedronGeometry(r, 0), o.kind === 'coal' ? (i % 2 ? '#151518' : '#24262b') : o.kind === 'diamond' ? '#3a3d45' : (i % 2 ? '#4f4842' : '#3d3834'), M);
        if (o.kind === 'iron') { // rusty flecks
          const fp = P.clone().addScaledVector(new THREE.Vector3(o.nx, o.ny, o.nz), r * 0.8);
          M.compose(fp, Q, S.set(1, 1, 1));
          ores.add(new THREE.BoxGeometry(0.11, 0.07, 0.09), i % 2 ? '#e0813a' : '#b8582b', M);
          M.compose(fp.clone().add(new THREE.Vector3(0.1, 0.06, -0.05)), Q, S.set(1, 1, 1));
          ores.add(new THREE.BoxGeometry(0.07, 0.06, 0.07), '#f0a05a', M);
        } else if (o.kind === 'coal') {
          M.compose(P.clone().addScaledVector(new THREE.Vector3(o.nx, o.ny, o.nz), r * 0.7), Q, S.set(1, 1, 1));
          ores.add(new THREE.BoxGeometry(0.1, 0.05, 0.1), '#3b3f48', M);
        }
      }
      if (o.kind === 'diamond') {
        for (let i = 0; i < 4; i++) {
          const dir = new THREE.Vector3(o.nx + (h(i + 31) - 0.5) * 1.2, o.ny + (h(i + 37) - 0.5) * 1.2, o.nz + (h(i + 41) - 0.5) * 1.2).normalize();
          Q.setFromUnitVectors(UP, dir);
          P.set(o.x + (h(i + 43) - 0.5) * 0.4, o.y + (h(i + 47) - 0.5) * 0.4, o.z + (h(i + 53) - 0.5) * 0.4).addScaledVector(dir, 0.2);
          M.compose(P, Q, S.set(1, 1.9, 1));
          glow.add(new THREE.OctahedronGeometry(0.11 + h(i + 59) * 0.08, 0), i % 2 ? '#aef8ff' : '#6feeff', M);
        }
      }
    }
    void rnd;
  }

  private attachSoups(c: Chunk, ores: Soup, glow: Soup) {
    c.oreGroup.clear();
    if (!ores.empty) c.oreGroup.add(ores.build(this.M.ore));
    if (!glow.empty) c.oreGroup.add(glow.build(this.M.glow));
  }

  /** rebuild only the ore meshes of a chunk (after mining) */
  private refreshOres(c: Chunk) {
    c.oreGroup.children.forEach((o: any) => o.geometry?.dispose());
    const ores = new Soup(), glow = new Soup();
    this.fillOres(c, ores, glow, () => 0);
    c.oreGroup.clear();
    if (!ores.empty) c.oreGroup.add(ores.build(this.M.ore));
    if (!glow.empty) c.oreGroup.add(glow.build(this.M.glow));
  }

  // ---- props
  private makeChest(s: Site, y: number, yaw: number, c: Chunk): Chest {
    const g = new THREE.Group(); g.position.set(s.x, y, s.z); g.rotation.y = yaw;
    const so = new Soup(), M = new THREE.Matrix4();
    const at = (x: number, yy: number, z: number) => M.makeTranslation(x, yy, z);
    const wood = '#8a5a2b', wood2 = '#6e4521', brass = '#d2a93f', dark = '#3b2a1c';
    so.add(new THREE.BoxGeometry(0.92, 0.46, 0.58), wood, at(0, 0.23, 0));
    so.add(new THREE.BoxGeometry(0.96, 0.08, 0.62), wood2, at(0, 0.04, 0));
    for (const x of [-0.34, 0.34]) so.add(new THREE.BoxGeometry(0.08, 0.5, 0.62), brass, at(x, 0.25, 0));
    so.add(new THREE.BoxGeometry(0.94, 0.05, 0.6), dark, at(0, 0.46, 0));
    g.add(so.build(this.M.wood));
    const lid = new THREE.Group(); lid.position.set(0, 0.47, 0.29); // hinge at the back
    const ls = new Soup();
    const cyl = new THREE.CylinderGeometry(0.29, 0.29, 0.92, 10, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(0);
    ls.add(cyl, wood, new THREE.Matrix4().makeTranslation(0, 0.0, -0.29));
    for (const x of [-0.34, 0.34]) ls.add(new THREE.CylinderGeometry(0.31, 0.31, 0.08, 10, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), brass, new THREE.Matrix4().makeTranslation(x, 0, -0.29));
    ls.add(new THREE.BoxGeometry(0.11, 0.13, 0.05), brass, new THREE.Matrix4().makeTranslation(0, 0.02, -0.6));
    lid.add(ls.build(this.M.wood));
    g.add(lid);
    const ch: Chest = { id: s.id, x: s.x, y: y + 0.3, z: s.z, yaw, rich: s.rich, group: g, lid, open: this.opened.has(s.id) ? 1 : 0, opened: this.opened.has(s.id) };
    lid.rotation.x = -ch.open * 1.9;
    c.group.add(g);
    // a faint warm glint so chests catch the eye in the dark
    c.glows.push({ x: s.x, y: y + 1.0, z: s.z, col: new THREE.Color('#ffc46b'), k: 2.2, warm: true });
    return ch;
  }

  private makeRope(e: Entrance, i: number, c: Chunk) {
    const y0 = this.net.floor(e.x, e.z, e.cy + 1.5);
    const so = new Soup(), glow = new Soup(), M = new THREE.Matrix4();
    const H = 5.2;
    const at = (x: number, y: number, z: number) => M.makeTranslation(x, y, z);
    for (const x of [-0.28, 0.28]) so.add(new THREE.BoxGeometry(0.07, H, 0.07), '#7b5530', at(x, H / 2, 0));
    for (let k = 0; k < 11; k++) so.add(new THREE.BoxGeometry(0.6, 0.05, 0.06), '#9a6c3a', at(0, 0.3 + k * 0.45, 0));
    glow.add(new THREE.SphereGeometry(0.07, 8, 6), '#ff8a2a', at(0.55, 1.7, 0));
    const g = new THREE.Group(); g.position.set(e.x, y0, e.z);
    g.add(so.build(this.M.wood), glow.build(this.M.glow));
    const hs = new THREE.Sprite(this.haloFor(new THREE.Color('#ffb04a'))); hs.position.set(0.55, 1.7, 0); hs.scale.setScalar(1.5); hs.renderOrder = 6; g.add(hs);
    g.userData.entrance = i;
    c.group.add(g);
    c.glows.push({ x: e.x + 0.55, y: y0 + 1.9, z: e.z, col: new THREE.Color('#ffb04a'), k: 4.5, warm: true });
  }

  // ---- interaction
  /** closest ore / chest / rope along the aim ray */
  pick(eye: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, reach: number, assist = 1): { type: 'ore'; ore: Ore; chunk: Chunk; dist: number } | { type: 'chest'; chest: Chest; dist: number } | { type: 'rope'; index: number; dist: number } | null {
    let best: any = null, bd = reach + 0.001;
    const test = (x: number, y: number, z: number, r: number) => {
      const dx = x - eye.x, dy = y - eye.y, dz = z - eye.z;
      const t = dx * dir.x + dy * dir.y + dz * dir.z;
      if (t < 0 || t > reach + r) return -1;
      const px = dx - dir.x * t, py = dy - dir.y * t, pz = dz - dir.z * t;
      return px * px + py * py + pz * pz <= r * r ? t : -1;
    };
    for (const c of this.chunks.values()) {
      if (Math.abs(c.cx * CS + 8 - eye.x) > 40 || Math.abs(c.cz * CS + 8 - eye.z) > 40) continue;
      for (const o of c.ores) { const t = test(o.x, o.y, o.z, 0.7 * assist); if (t >= 0 && t < bd) { bd = t; best = { type: 'ore', ore: o, chunk: c, dist: t }; } }
      for (const ch of c.chests) { const t = test(ch.x, ch.y, ch.z, 0.75 * assist); if (t >= 0 && t < bd) { bd = t; best = { type: 'chest', chest: ch, dist: t }; } }
      for (const o of c.group.children) {
        if (o.userData.entrance === undefined) continue;
        const t = test(o.position.x, o.position.y + 1.4, o.position.z, 1.2 * assist);
        if (t >= 0 && t < bd) { bd = t; best = { type: 'rope', index: o.userData.entrance, dist: t }; }
      }
    }
    return best;
  }

  /** knock one unit off an ore vein; true when the vein is gone */
  mineOre(chunk: Chunk, o: Ore): boolean {
    o.left--;
    if (o.left > 0) { this.partial.set(o.id, o.left); return false; }
    this.partial.delete(o.id);
    chunk.ores.splice(chunk.ores.indexOf(o), 1);
    this.mined.add(o.id);
    this.refreshOres(chunk);
    return true;
  }

  openChest(ch: Chest) { ch.opened = true; this.opened.add(ch.id); }

  /** another player hit (or finished) an ore vein */
  applyOre(id: string, left: number) {
    if (this.mined.has(id)) return;
    const chunk = this.chunks.get(id.split(':')[0]);
    const o = chunk?.ores.find((q) => q.id === id);
    if (left > 0) { this.partial.set(id, left); if (o) o.left = left; return; }
    this.partial.delete(id); this.mined.add(id);
    if (chunk && o) { chunk.ores.splice(chunk.ores.indexOf(o), 1); this.refreshOres(chunk); }
  }
  /** another player opened a chest */
  applyChest(id: string) {
    this.opened.add(id);
    for (const c of this.chunks.values()) for (const ch of c.chests) if (ch.id === id) ch.opened = true;
  }
}

function smoothS(a: number, b: number, x: number) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

