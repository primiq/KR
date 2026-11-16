// The far sea: rings round the island, the same whichever way you sail, colder the further you go:
//  - past the islets (seafeatures.ts), from ICE_R0: drift ice, little floes, thicker and bigger as you go;
//  - from BERG_R0: icebergs, pinnacles (a small peak above the water and a huge white bulk under it, as real ones are) and
//    tabular bergs (flat-topped cliffs taller than a two-storey house), more and bigger further out; a second storm
//    blows among them (`ringStorm`);
//  - from about LAND_R: the Arctic, a ring of ice land all the way round (its coast wanders in and out): ice cliffs at its
//    shore, a snowy plateau rising inland, crevices cut deep into it, freshwater melt pools, and penguin colonies along
//    its shore every few hundred metres;
//  - at OUTER the sea ends: a current turns you back.
// About 7 km from the island to the ice cliffs: a long sail (a quarter of an hour by boat, twice that on a raft). The
// other levels (3 km and more away) are only ever drawn while you are in them, so the open sea passes over them freely.
// Pure maths, no drawing (see arcticView.ts): island.ts folds `arcticHeight` into heightAt, so floes, bergs (their bulges
// under the water too) and the land are solid ground for walking and for boats running aground. Everything follows from
// cell numbers alone: the same for every player, nothing sent.
import { Noise2D } from "../core/noise";

/** where the drift ice starts, the bergs start, the land's coast (on average), the end of the sea (m from the middle) */
export const ICE_R0 = 2100, BERG_R0 = 3300, LAND_R = 7600, OUTER = 10700;

const FLOE_CELL = 46, BERG_CELL = 230, CREV_CELL = 400, POOL_CELL = 300, COLONY_ARC = 600;
const N1 = new Noise2D(3131), N2 = new Noise2D(8484);

function hash(i: number, j: number, k: number) {
  let h = (i * 374761393 + j * 668265263 + k * 1274126177) ^ 0x27d4eb2d;
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (a: number, b: number, v: number) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

/** on the reachable sea (anywhere short of the end of it) */
export const inSeaWorld = (x: number, z: number) => Math.hypot(x, z) < OUTER;
/** the open sea's current: past the islets a strong current sweeps the long, empty way out to the ice (and back), so a
 *  boat or a raft covers it up to three times as fast; it eases off near the islets and dies away before the coast */
export function seaCurrent(x: number, z: number): number {
  const r = Math.hypot(x, z);
  if (r < 800) return 1;
  return 1 + (0.6 * smooth(800, 1200, r) + 1.4 * smooth(1900, 2500, r)) * (1 - smooth(-450, -150, inland(x, z)));
}
/** past the end of the sea: the nearest point back inside */
export function keepInSea(x: number, z: number): [number, number] | null {
  const r = Math.hypot(x, z);
  return r < OUTER ? null : [x * (OUTER - 1) / r, z * (OUTER - 1) / r];
}
/** 0..1: how far into the cold you are (0 by the islets, 1 at the ice cliffs) */
export const coldAt = (x: number, z: number) => smooth(ICE_R0 + 300, LAND_R - 200, Math.hypot(x, z));
/** 0..1: the second storm, among the big icebergs: it blows up as the snow and the bigger bergs begin and clears again
 *  well before the Arctic (on the way home the same, the other way round) */
export const ringStorm = (x: number, z: number) => { const r = Math.hypot(x, z); return smooth(BERG_R0 + 250, BERG_R0 + 650, r) * (1 - smooth(BERG_R0 + 1500, BERG_R0 + 2100, r)); };

// ------------------------------------------------------------------ ice (floes and bergs): profiles of revolution
/** an ice body: where it is, its profile (r, y) from the middle of its top out to its widest point under the water
 *  (index `widest`), and on down to its bottom; its own wobble so it is not round */
export interface Ice {
  id: number; kind: "floe" | "pinnacle" | "tabular";
  x: number; z: number; yaw: number; seed: number;
  prof: [number, number][]; widest: number;
  /** the widest it gets (m, before wobble) */
  reach: number;
  /** a flat-topped berg's ramp: a slope of ice down one side into the sea, to walk up from the water. Bearing `a`, width
   *  `w`; it leaves the top (height `top`) at `r0` from the middle and runs `len` out to just under the sea */
  ramp?: { a: number; w: number; r0: number; len: number; top: number };
}

/** the ramp's slope (rise over run: an easy walk) and how far under the sea it ends */
const RAMP_SLOPE = 0.3, RAMP_FOOT = -1.2;
function addRamp(f: Ice) {
  if (f.kind !== "tabular") return;
  const R = f.prof[2][0] / 0.9, top = f.prof[0][1], r0 = R * 0.82, len = (top - RAMP_FOOT) / RAMP_SLOPE;
  f.ramp = { a: hash(f.id % 100000, 7, 93) * Math.PI * 2, w: 5.5, r0, len, top };
  f.reach = Math.max(f.reach, r0 + len + 3);
}
/** the ramp's surface at (x, z), or -Infinity off it */
function rampHeight(f: Ice, x: number, z: number) {
  const m = f.ramp!;
  const dx = x - f.x, dz = z - f.z, c = Math.cos(m.a), s = Math.sin(m.a);
  const u = dx * c + dz * s, v = -dx * s + dz * c;
  if (Math.abs(v) > m.w / 2 || u < m.r0 - 2 || u > m.r0 + m.len) return -Infinity;
  return m.top - Math.max(0, u - m.r0) * RAMP_SLOPE;
}

/** how much wider or narrower it is in the direction `a` (radius multiplier) */
export function iceWobble(f: Ice, a: number) {
  return 1 + 0.16 * Math.sin(3 * a + f.seed) + 0.09 * Math.sin(5 * a + f.seed * 1.7) + 0.05 * Math.sin(9 * a + f.seed * 2.9);
}

function makeIce(kind: Ice["kind"], id: number, x: number, z: number, size: number, h: number, r: () => number): Ice {
  let prof: [number, number][];
  if (kind === "floe") {
    // a flat pan of ice, a hand's breadth above the water, a metre and a half under it
    prof = [[0, 0.32], [size * 0.85, 0.3], [size, 0.12], [size * 1.06, -0.9], [size * 1.05, -1.4], [size * 0.7, -1.6], [0, -1.7]];
    return { id, kind, x, z, yaw: r() * 6.28, seed: r() * 100, prof, widest: 3, reach: size * 1.06 };
  }
  if (kind === "pinnacle") {
    // a small sharp peak above the water... and the bulk of it below, far wider
    const R = size;
    prof = [[0, h], [R * 0.12, h * 0.94], [R * 0.3, h * 0.72], [R * 0.52, h * 0.42], [R * 0.75, h * 0.14], [R * 0.95, 0.5], [R * 1.05, -0.6], [R * 1.45, -4], [R * 1.85, -10],
      [R * 1.7, -19], [R * 1.1, -27], [R * 0.4, -31], [0, -32]];
    return { id, kind, x, z, yaw: r() * 6.28, seed: r() * 100, prof, widest: 8, reach: R * 1.85 };
  }
  // tabular: a flat top, sheer walls, a wide foot under the water
  const R = size;
  prof = [[0, h], [R * 0.6, h + 0.3], [R * 0.9, h], [R * 0.98, h - 1.2], [R * 1.0, h * 0.5], [R * 1.02, 0.4], [R * 1.08, -1.2], [R * 1.4, -5], [R * 1.65, -12],
    [R * 1.5, -22], [R * 0.9, -30], [0, -33]];
  return { id, kind, x, z, yaw: r() * 6.28, seed: r() * 100, prof, widest: 8, reach: R * 1.65 };
}

const cache = new Map<number, Ice | null>();
const key = (k: number, i: number, j: number) => k * 1e8 + (i + 5000) * 10000 + (j + 5000);

/** the land's coast radius in the direction `a` (it wanders in and out) */
export function landShore(a: number) {
  return LAND_R + 230 * Math.sin(3 * a + 1.3) + 150 * Math.sin(7 * a + 0.4) + 80 * Math.sin(17 * a + 2.2) + 35 * Math.sin(41 * a + 0.9);
}
/** how far inland of the coast (x, z) is (m; negative out at sea) */
export function inland(x: number, z: number) {
  return Math.hypot(x, z) - landShore(Math.atan2(z, x));
}

/** the floe in floe cell (i, j), if any */
function floeIn(i: number, j: number): Ice | null {
  const k = key(1, i, j);
  const c = cache.get(k);
  if (c !== undefined) return c;
  let f: Ice | null = null;
  const x = (i + 0.2 + 0.6 * hash(i, j, 1)) * FLOE_CELL, z = (j + 0.2 + 0.6 * hash(i, j, 2)) * FLOE_CELL, d = Math.hypot(x, z);
  if (d > ICE_R0 && inland(x, z) < -30) {
    const out = smooth(ICE_R0, BERG_R0 + 600, d);
    if (hash(i, j, 3) < 0.07 + 0.3 * out) {
      let s = 10; const r = () => hash(i, j, s += 7);
      f = makeIce("floe", k, x, z, 1.4 + hash(i, j, 4) * (2 + 3.5 * out), 0, r);
    }
  }
  cache.set(k, f);
  return f;
}
/** the iceberg in berg cell (i, j), if any */
function bergIn(i: number, j: number): Ice | null {
  const k = key(2, i, j);
  const c = cache.get(k);
  if (c !== undefined) return c;
  let f: Ice | null = null;
  // (well inside the cell: its foot under the water must not reach the next cell)
  const x = (i + 0.4 + 0.2 * hash(i, j, 1)) * BERG_CELL, z = (j + 0.4 + 0.2 * hash(i, j, 2)) * BERG_CELL, d = Math.hypot(x, z);
  if (d > BERG_R0 && inland(x, z) < -120) {
    const out = smooth(BERG_R0, LAND_R, d);
    if (hash(i, j, 3) < 0.18 + 0.32 * out) {
      let s = 10; const r = () => hash(i, j, s += 7);
      const t = hash(i, j, 4), early = d < BERG_R0 + 500;
      // (the first ones are small: bergy bits; then pinnacles and tabular bergs, bigger the further out)
      if (early) f = makeIce("pinnacle", k, x, z, 3 + t * 3, 2.5 + t * 3, r);
      else if (hash(i, j, 5) < 0.6) f = makeIce("pinnacle", k, x, z, 6 + t * 7 * (0.5 + out), 7 + t * 13 * (0.5 + out * 0.6), r);
      else { f = makeIce("tabular", k, x, z, 14 + t * 16 * (0.5 + out * 0.5), 8.5 + t * 7, r); addRamp(f); }
    }
  }
  cache.set(k, f);
  return f;
}

/** the height of the top of an ice body's surface at (x, z), -Infinity off it */
export function iceHeight(f: Ice, x: number, z: number): number {
  const body = iceBody(f, x, z);
  return f.ramp ? Math.max(body, rampHeight(f, x, z)) : body;
}
function iceBody(f: Ice, x: number, z: number): number {
  const dx = x - f.x, dz = z - f.z;
  const d = Math.hypot(dx, dz) / iceWobble(f, Math.atan2(dz, dx) - f.yaw);
  const P = f.prof;
  if (d >= P[f.widest][0]) return -Infinity;
  for (let k = 1; k <= f.widest; k++) {
    if (d <= P[k][0]) { const [r0, y0] = P[k - 1], [r1, y1] = P[k]; return y0 + (y1 - y0) * ((d - r0) / Math.max(1e-6, r1 - r0)); }
  }
  return -Infinity;
}

/** every floe and berg within `rad` of (x, z) */
export function iceNear(x: number, z: number, rad: number, out: Ice[] = [], floes = true, bergs = true): Ice[] {
  out.length = 0;
  if (Math.hypot(x, z) + rad < ICE_R0) return out;
  const each = (cell: number, get: (i: number, j: number) => Ice | null) => {
    const i0 = Math.floor((x - rad) / cell), i1 = Math.floor((x + rad) / cell), j0 = Math.floor((z - rad) / cell), j1 = Math.floor((z + rad) / cell);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const f = get(i, j); if (f && Math.hypot(f.x - x, f.z - z) < rad) out.push(f); }
  };
  if (floes) each(FLOE_CELL, floeIn);
  if (bergs) each(BERG_CELL, bergIn);
  return out;
}

// ------------------------------------------------------------------ the land
/** the plateau's height without the crevices and pools (m); `s`: how far inland */
/** the ice beach: its foot's height (just under the sea) and how far inland it takes to climb to the snowfield (m) */
const SHORE_Y = -0.6, BEACH = 32;
function plateau(x: number, z: number, s: number) {
  // a sloping beach of ice at the shore (from just under the water, so a raft runs up on it and you step off and walk
  //  up), then the snow rising gently inland, in long wind-carved swells
  const rise = 6 + 16 * smooth(0, 900, s) + 3.5 * N1.get(x * 0.004, z * 0.004) * smooth(0, 100, s) + 0.9 * N2.get(x * 0.03, z * 0.03) * smooth(5, 40, s);
  return SHORE_Y + (rise - SHORE_Y) * smooth(0, BEACH, s);
}

export interface Crevice { ax: number; az: number; bx: number; bz: number; w: number; d: number }
export interface Pool { id: number; x: number; z: number; r: number; level: number }
export interface Colony { id: number; x: number; z: number; n: number }

const crevCache = new Map<number, Crevice[]>(), poolCache = new Map<number, Pool | null>();
/** the crevices whose middle is in crevice cell (i, j): long cracks across the plateau, well inland */
function crevicesIn(i: number, j: number): Crevice[] {
  const k = key(3, i, j);
  let c = crevCache.get(k);
  if (c) return c;
  c = [];
  const n = hash(i, j, 1) < 0.55 ? 1 + (hash(i, j, 2) < 0.3 ? 1 : 0) : 0;
  for (let q = 0; q < n; q++) {
    const x = (i + 0.25 + 0.5 * hash(i, j, 3 + q)) * CREV_CELL, z = (j + 0.25 + 0.5 * hash(i, j, 5 + q)) * CREV_CELL;
    if (inland(x, z) < 220) continue;
    const dir = hash(i, j, 7 + q) * Math.PI, L = 60 + hash(i, j, 9 + q) * 140;
    c.push({ ax: x - Math.cos(dir) * L / 2, az: z - Math.sin(dir) * L / 2, bx: x + Math.cos(dir) * L / 2, bz: z + Math.sin(dir) * L / 2, w: 3.5 + hash(i, j, 11 + q) * 3, d: 7 + hash(i, j, 13 + q) * 6 });
  }
  crevCache.set(k, c);
  return c;
}
/** the colony in shore sector `k` (one every COLONY_ARC metres along the coast) */
function colonyAt(k: number): Colony {
  const N = Math.round((2 * Math.PI * LAND_R) / COLONY_ARC), kk = ((k % N) + N) % N;
  const a = ((kk + 0.5 + (hash(kk, 3, 7) - 0.5) * 0.4) / N) * Math.PI * 2, d = landShore(a) + 45 + hash(kk, 4, 7) * 60;
  return { id: kk, x: Math.cos(a) * d, z: Math.sin(a) * d, n: 12 + Math.floor(hash(kk, 5, 7) * 10) };
}
/** the pool in pool cell (i, j), if any: a hollow of clear meltwater */
function poolIn(i: number, j: number): Pool | null {
  const k = key(4, i, j);
  const c = poolCache.get(k);
  if (c !== undefined) return c;
  let p: Pool | null = null;
  const x = (i + 0.2 + 0.6 * hash(i, j, 1)) * POOL_CELL, z = (j + 0.2 + 0.6 * hash(i, j, 2)) * POOL_CELL, s = inland(x, z);
  // (often near the coast, where you come ashore; never in a colony)
  const want = s > 70 && hash(i, j, 3) < (s < 400 ? 0.7 : 0.35);
  if (want && !coloniesNear(x, z, 60).length) {
    const r = 5 + hash(i, j, 4) * 9;
    p = { id: k, x, z, r, level: plateau(x, z, s) - 0.3 };
  }
  poolCache.set(k, p);
  return p;
}

/** the penguin colonies within `rad` of (x, z) */
export function coloniesNear(x: number, z: number, rad: number, out: Colony[] = []): Colony[] {
  out.length = 0;
  const r = Math.hypot(x, z);
  if (Math.abs(r - LAND_R) > 500 + rad) return out;
  const N = Math.round((2 * Math.PI * LAND_R) / COLONY_ARC), k0 = Math.floor(((Math.atan2(z, x) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * N);
  const span = Math.ceil(rad / COLONY_ARC) + 1;
  for (let k = k0 - span; k <= k0 + span; k++) { const c = colonyAt(k); if (Math.hypot(c.x - x, c.z - z) < rad) out.push(c); }
  return out;
}
/** the melt pools within `rad` of (x, z) */
export function poolsNear(x: number, z: number, rad: number, out: Pool[] = []): Pool[] {
  out.length = 0;
  if (inland(x, z) < -rad) return out;
  const i0 = Math.floor((x - rad) / POOL_CELL), i1 = Math.floor((x + rad) / POOL_CELL), j0 = Math.floor((z - rad) / POOL_CELL), j1 = Math.floor((z + rad) / POOL_CELL);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const p = poolIn(i, j); if (p && Math.hypot(p.x - x, p.z - z) < rad) out.push(p); }
  return out;
}

function segDist(px: number, pz: number, c: Crevice) {
  const vx = c.bx - c.ax, vz = c.bz - c.az, t = clamp01(((px - c.ax) * vx + (pz - c.az) * vz) / (vx * vx + vz * vz));
  return { d: Math.hypot(px - c.ax - vx * t, pz - c.az - vz * t), t };
}
/** (calls fn for every crevice that might reach (x, z)) */
function eachCrevice(x: number, z: number, fn: (c: Crevice) => void) {
  const i = Math.floor(x / CREV_CELL), j = Math.floor(z / CREV_CELL);
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const c of crevicesIn(i + a, j + b)) fn(c);
}

/** 0..1: how deep into a crevice (x, z) is (for the ice's deep blue) */
export function creviceAt(x: number, z: number): number {
  if (inland(x, z) < 150) return 0;
  let k = 0;
  eachCrevice(x, z, (c) => { const { d, t } = segDist(x, z, c), w = c.w * (0.35 + 0.65 * Math.sin(Math.PI * t)); k = Math.max(k, smooth(w, w * 0.45, d)); });
  return k;
}

/** the land's height at (x, z), -Infinity well away from it */
export function landHeight(x: number, z: number): number {
  const s = inland(x, z);
  if (s < -420) return -Infinity;
  // out from the cliffs: the shelf drops away under the sea
  if (s < 0) return Math.max(-70, SHORE_Y + s * 0.16);
  let h = plateau(x, z, s);
  if (s > 150) eachCrevice(x, z, (c) => { const { d, t } = segDist(x, z, c), w = c.w * (0.35 + 0.65 * Math.sin(Math.PI * t)); if (d < w) h -= c.d * Math.sin(Math.PI * t) ** 0.5 * smooth(w, w * 0.45, d); });
  const p = poolIn(Math.floor(x / POOL_CELL), Math.floor(z / POOL_CELL));
  if (p) { const q = Math.hypot(x - p.x, z - p.z) / p.r; if (q < 1.25) h = Math.min(h, p.level - 0.9 * (1 - q * q) + (q > 1 ? (q - 1) * 4 : 0)); }
  return h;
}

/** the melt pool whose water (x, z) is in, if any */
export function poolAt(x: number, z: number) {
  const p = poolIn(Math.floor(x / POOL_CELL), Math.floor(z / POOL_CELL));
  return p && Math.hypot(x - p.x, z - p.z) < p.r * 1.02 ? p : null;
}

/** everything the far sea adds to the ground at (x, z): the land, the bergs, the floes (-Infinity: nothing) */
export function arcticHeight(x: number, z: number): number {
  const r2 = x * x + z * z;
  if (r2 < (ICE_R0 - 60) ** 2 || r2 > (OUTER + 600) ** 2) return -Infinity;
  let h = landHeight(x, z);
  const b = bergIn(Math.floor(x / BERG_CELL), Math.floor(z / BERG_CELL));
  if (b) h = Math.max(h, iceHeight(b, x, z));
  const f = floeIn(Math.floor(x / FLOE_CELL), Math.floor(z / FLOE_CELL));
  if (f) h = Math.max(h, iceHeight(f, x, z));
  return h;
}

// ------------------------------------------------------------------ the ice wall and its gate
// Some way inland of the coast, all the way round, a wall of ice taller than the biggest bergs: nobody goes past it. Due
// north (the way you sail from the island) a great gate is carved into it, and on the land in front of it, here and
// there, wooden signs point the way. The gate leads to the Christmas village (xmas.ts).
/** the gate's angle round the world (north: -z) and how far inland of the coast the wall stands */
export const GATE_A = -Math.PI / 2, WALL_IN = 650;
/** the wall's inner face (m from the middle) at angle a */
export const wallR = (a: number) => landShore(a) + WALL_IN;
/** the gate: the point in front of its doors (where walking in takes you through); `yaw`: its local +z runs out into the
 *  wall, and it is also the player's yaw facing away from the gate, back towards the sea */
export const GATE = (() => {
  const r = wallR(GATE_A) - 3;
  return { x: Math.cos(GATE_A) * r, z: Math.sin(GATE_A) * r, yaw: Math.atan2(Math.cos(GATE_A), Math.sin(GATE_A)) };
})();
/** keeps somebody walking on the land this side of the wall: the clamped position, or null if they are clear of it */
export function wallClamp(x: number, z: number): [number, number] | null {
  const r = Math.hypot(x, z);
  if (r < LAND_R - 600) return null;
  const a = Math.atan2(z, x), lim = wallR(a) - 2;
  return r > lim ? [x * lim / r, z * lim / r] : null;
}
/** the signs: on the land north of the island, every so often, each pointing at the gate (yaw: the way its arrow points) */
export interface Sign { x: number; z: number; yaw: number }
export function signsNear(x: number, z: number, rad: number, out: Sign[] = []): Sign[] {
  out.length = 0;
  const r = Math.hypot(x, z);
  if (r < LAND_R - 900) return out;
  const a0 = Math.atan2(z, x), da = rad / Math.max(r, 1), STEP = 0.028;
  for (let k = Math.floor((a0 - da) / STEP); k <= Math.ceil((a0 + da) / STEP); k++) {
    for (let row = 0; row < 3; row++) {
      let a = k * STEP + (hash(k, row, 71) - 0.5) * STEP * 0.6;
      let off = a - GATE_A; off = Math.atan2(Math.sin(off), Math.cos(off));
      if (Math.abs(off) > 0.5 || hash(k, row, 72) < 0.35) continue;
      const s = 60 + row * 190 + hash(k, row, 73) * 90, R = landShore(a) + s;
      if (R > wallR(a) - 40) continue;
      const sx = Math.cos(a) * R, sz = Math.sin(a) * R;
      if (Math.hypot(sx - x, sz - z) > rad || creviceAt(sx, sz) > 0 || poolAt(sx, sz)) continue;
      out.push({ x: sx, z: sz, yaw: Math.atan2(GATE.x - sx, GATE.z - sz) });
    }
  }
  return out;
}

// ------------------------------------------------------------------ ice grottos
// Some of the big bergs have a hole in their foot under the water: a cave mouth with a glow coming out of it. Swim down
// into it and you come up in a grotto inside the ice, with a treasure chest (grotto.ts). The same bergs for everybody.
export interface Grotto { /** the berg's id (also its chest's id) */ id: number; x: number; y: number; z: number; /** the way out of the ice (radians) */ ang: number }
export function grottoOf(f: Ice): Grotto | null {
  if (f.kind === "floe" || f.prof[0][1] < 9 || hash(f.id % 100000, 7, 91) > 0.55) return null;
  const ang = hash(f.id % 100000, 7, 92) * Math.PI * 2, c = Math.cos(ang), s = Math.sin(ang);
  // (out along that bearing to where the ice's foot is 3 m under the sea)
  for (let d = 2; d < f.reach * 1.3; d += 0.5) {
    const x = f.x + c * d, z = f.z + s * d, h = iceHeight(f, x, z);
    if (h < -3) return Number.isFinite(h) ? { id: f.id, x, y: h, z, ang } : null;
  }
  return null;
}
export function grottosNear(x: number, z: number, rad: number, out: Grotto[] = []): Grotto[] {
  out.length = 0;
  for (const f of iceNear(x, z, rad, [], false, true)) { const g = grottoOf(f); if (g) out.push(g); }
  return out;
}

// ------------------------------------------------------------------ explorers' camps
// On top of about half of the flat-topped bergs (the ones with a ramp up), the camp of an explorer long gone: a tent, a
// flag, a dead campfire, a sled with crates, and a chest they left behind (grotto.ts draws it).
export interface Camp { /** its chest's id */ id: number; x: number; y: number; z: number; /** the way the tent faces */ yaw: number }
export function campOf(f: Ice): Camp | null {
  if (!f.ramp || hash(f.id % 100000, 7, 94) > 0.55) return null;
  // (on the top, across from where the ramp comes up)
  const a = f.ramp.a + Math.PI + (hash(f.id % 100000, 7, 95) - 0.5) * 0.8, R = f.ramp.r0 * 0.45;
  const x = f.x + Math.cos(a) * R, z = f.z + Math.sin(a) * R, y = iceHeight(f, x, z);
  if (!Number.isFinite(y)) return null;
  return { id: 1e9 + f.id, x, y, z, yaw: Math.atan2(Math.cos(f.ramp.a), Math.sin(f.ramp.a)) };
}
export function campsNear(x: number, z: number, rad: number, out: Camp[] = []): Camp[] {
  out.length = 0;
  for (const f of iceNear(x, z, rad, [], false, true)) { const c = campOf(f); if (c) out.push(c); }
  return out;
}
