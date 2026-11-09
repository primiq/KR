// The far north: past the islets (SEA_R), the open sea only goes on northwards (north = -z), up a corridor ARC_W either
// side of the island's meridian, and it gets colder the further you go:
//  - drift ice: little floes, thicker and bigger as you go, from ICE_Z0;
//  - icebergs from BERG_Z0: pinnacles (a small peak above the water and a huge white bulk under it, as real ones are) and
//    tabular bergs (flat-topped cliffs taller than a two-storey house), more and bigger towards the land;
//  - the Arctic itself: a landmass of ice round LAND, ice cliffs at its shore, a snowy plateau rising inland, crevices
//    cut deep into it, little freshwater melt pools and penguin colonies along its southern shore.
// About 6 km from the island to the ice cliffs: a long sail (a quarter of an hour by boat, twice that on a raft).
// Pure maths, no drawing (see arcticView.ts for that): island.ts folds `arcticHeight` into heightAt, so floes, bergs
// (and their bulges under the water) and the land are solid ground for walking and for boats running aground. The layout
// follows from the cell numbers alone: the same for every player, nothing sent.
import { Noise2D } from "../core/noise";

/** half the width of the northern corridor (m), where the drift ice starts, where the bergs start */
export const ARC_W = 1600, ICE_Z0 = -2100, BERG_Z0 = -3300;
/** the landmass: its middle, its rough radius; the corridor's far end */
export const LAND = { x: 0, z: -9050, r: 1450 }, ARC_END = -10700;

const FLOE_CELL = 46, BERG_CELL = 230;
const N1 = new Noise2D(3131), N2 = new Noise2D(8484);

function hash(i: number, j: number, k: number) {
  let h = (i * 374761393 + j * 668265263 + k * 1274126177) ^ 0x27d4eb2d;
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (a: number, b: number, v: number) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

/** inside the northern corridor (the only way on past the islets) */
export const inCorridor = (x: number, z: number) => Math.abs(x) < ARC_W && z < -400 && z > ARC_END;
/** 0..1: the second storm, up among the big icebergs: it blows up as you come into the snow and the bigger bergs, and
 *  clears again well before the Arctic (on the way home the same, the other way round) */
export const northStorm = (x: number, z: number) => (Math.abs(x) < ARC_W + 300 ? smooth(BERG_Z0 - 250, BERG_Z0 - 650, z) * (1 - smooth(BERG_Z0 - 1500, BERG_Z0 - 2100, z)) : 0);
/** 0..1: how far into the cold you are (0 by the islets, 1 at the ice cliffs) */
export const coldAt = (x: number, z: number) => (Math.abs(x) < ARC_W + 600 ? smooth(ICE_Z0 + 300, LAND.z + LAND.r + 200, z) : 0);

// ------------------------------------------------------------------ ice (floes and bergs): profiles of revolution
/** an ice body: where it is, its profile (r, y) from the middle of its top out to its widest point under the water,
 *  and on down to its bottom; its own wobble so it is not round */
export interface Ice {
  id: number; kind: "floe" | "pinnacle" | "tabular";
  x: number; z: number; yaw: number; seed: number;
  /** from the top's middle out to the widest point (r rises), then back in to the bottom (`top` ends at index `widest`) */
  prof: [number, number][]; widest: number;
  /** the widest it gets (m, before wobble) */
  reach: number;
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

/** the land's own shore radius in the direction `a` */
export function landShore(a: number) {
  return LAND.r * (1 + 0.1 * Math.sin(2 * a + 1.3) + 0.07 * Math.sin(5 * a + 0.4) + 0.035 * Math.sin(11 * a + 2.2));
}
/** how far inland of the shore (x, z) is (m; negative out at sea) */
export function inland(x: number, z: number) {
  const dx = x - LAND.x, dz = z - LAND.z;
  return landShore(Math.atan2(dz, dx)) - Math.hypot(dx, dz);
}

/** the floe in floe cell (i, j), if any */
function floeIn(i: number, j: number): Ice | null {
  const k = key(1, i, j);
  const c = cache.get(k);
  if (c !== undefined) return c;
  let f: Ice | null = null;
  const x = (i + 0.2 + 0.6 * hash(i, j, 1)) * FLOE_CELL, z = (j + 0.2 + 0.6 * hash(i, j, 2)) * FLOE_CELL;
  if (Math.abs(x) < ARC_W - 40 && z < ICE_Z0 && z > LAND.z && inland(x, z) < -30) {
    const north = smooth(ICE_Z0, BERG_Z0 - 600, z);
    if (hash(i, j, 3) < 0.07 + 0.3 * north) {
      const r = (s: number) => () => hash(i, j, s += 7);
      f = makeIce("floe", k, x, z, 1.4 + hash(i, j, 4) * (2 + 3.5 * north), 0, r(10));
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
  const x = (i + 0.4 + 0.2 * hash(i, j, 1)) * BERG_CELL, z = (j + 0.4 + 0.2 * hash(i, j, 2)) * BERG_CELL;
  if (Math.abs(x) < ARC_W - 120 && z < BERG_Z0 && inland(x, z) < -120) {
    const north = smooth(BERG_Z0, LAND.z + LAND.r, z);
    if (hash(i, j, 3) < 0.18 + 0.32 * north) {
      const r = (s: number) => () => hash(i, j, s += 7);
      const t = hash(i, j, 4), early = z > BERG_Z0 - 500;
      // (the first ones are small: bergy bits; then pinnacles and tabular bergs, bigger the further north)
      if (early) f = makeIce("pinnacle", k, x, z, 3 + t * 3, 2.5 + t * 3, r(10));
      else if (hash(i, j, 5) < 0.6) f = makeIce("pinnacle", k, x, z, 6 + t * 7 * (0.5 + north), 7 + t * 13 * (0.5 + north * 0.6), r(10));
      else f = makeIce("tabular", k, x, z, 14 + t * 16 * (0.5 + north * 0.5), 8.5 + t * 7, r(10));
    }
  }
  cache.set(k, f);
  return f;
}

/** the height of the top of an ice body's surface at (x, z), -Infinity off it */
export function iceHeight(f: Ice, x: number, z: number): number {
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
  if (z - rad > ICE_Z0 || Math.abs(x) - rad > ARC_W) return out;
  const each = (cell: number, get: (i: number, j: number) => Ice | null) => {
    const i0 = Math.floor((x - rad) / cell), i1 = Math.floor((x + rad) / cell), j0 = Math.floor((z - rad) / cell), j1 = Math.floor((z + rad) / cell);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const f = get(i, j); if (f && Math.hypot(f.x - x, f.z - z) < rad) out.push(f); }
  };
  if (floes) each(FLOE_CELL, floeIn);
  if (bergs) each(BERG_CELL, bergIn);
  return out;
}

// ------------------------------------------------------------------ the land
/** the crevices: long cracks across the plateau (segments, land space), the melt pools, the penguins' colonies */
export const CREVICES: { ax: number; az: number; bx: number; bz: number; w: number; d: number }[] = [];
export const POOLS: { x: number; z: number; r: number; level: number }[] = [];
export const COLONIES: { x: number; z: number; n: number }[] = [];
{
  let s = 1;
  const rnd = () => hash(s++, 77, 5);
  for (let k = 0; k < 16; k++) {
    // (inland, away from the colonies' shore)
    const a = rnd() * Math.PI * 2, d = 250 + rnd() * 900, x = LAND.x + Math.cos(a) * d, z = LAND.z + Math.sin(a) * d, dir = rnd() * Math.PI, L = 60 + rnd() * 140;
    CREVICES.push({ ax: x - Math.cos(dir) * L / 2, az: z - Math.sin(dir) * L / 2, bx: x + Math.cos(dir) * L / 2, bz: z + Math.sin(dir) * L / 2, w: 3.5 + rnd() * 3, d: 7 + rnd() * 6 });
  }
  // the colonies: along the southern shore, where you land (the land's middle is north, -z, of them)
  for (let k = 0; k < 5; k++) {
    const a = Math.PI / 2 + (k - 2) * 0.32 + (rnd() - 0.5) * 0.12, d = landShore(a) - 45 - rnd() * 60;
    COLONIES.push({ x: LAND.x + Math.cos(a) * d, z: LAND.z + Math.sin(a) * d, n: 12 + Math.floor(rnd() * 10) });
  }
  for (let k = 0; k < 22; k++) {
    // (a few close to where you come ashore, the rest scattered inland)
    const a = k < 6 ? Math.PI / 2 + (rnd() - 0.5) * 1.4 : rnd() * Math.PI * 2, d = k < 6 ? landShore(a) - 90 - rnd() * 140 : 200 + rnd() * 1000;
    const x = LAND.x + Math.cos(a) * d, z = LAND.z + Math.sin(a) * d, r = 5 + rnd() * 9;
    if (COLONIES.some((c) => Math.hypot(c.x - x, c.z - z) < 40)) continue;
    POOLS.push({ x, z, r, level: 0 });
  }
}

/** the plateau's height without the crevices and pools (m) */
function plateau(x: number, z: number, s: number) {
  // the ice cliff at the shore, then the snow rising gently inland, in long wind-carved swells
  const cliff = -1.6 + 7.6 * smooth(0, 4, s);
  const rise = 6 + 16 * smooth(0, 900, s) + 3.5 * N1.get(x * 0.004, z * 0.004) * smooth(0, 100, s) + 0.9 * N2.get(x * 0.03, z * 0.03) * smooth(5, 40, s);
  return s < 4 ? cliff : Math.max(cliff, rise);
}
for (const p of POOLS) p.level = plateau(p.x, p.z, inland(p.x, p.z)) - 0.3;

function segDist(px: number, pz: number, c: (typeof CREVICES)[number]) {
  const vx = c.bx - c.ax, vz = c.bz - c.az, t = clamp01(((px - c.ax) * vx + (pz - c.az) * vz) / (vx * vx + vz * vz));
  return { d: Math.hypot(px - c.ax - vx * t, pz - c.az - vz * t), t };
}

/** 0..1: how deep into a crevice (x, z) is (for the ice's deep blue) */
export function creviceAt(x: number, z: number): number {
  let k = 0;
  for (const c of CREVICES) {
    if (Math.abs(x - (c.ax + c.bx) / 2) > 120 || Math.abs(z - (c.az + c.bz) / 2) > 120) continue;
    const { d, t } = segDist(x, z, c), w = c.w * (0.35 + 0.65 * Math.sin(Math.PI * t));
    k = Math.max(k, smooth(w, w * 0.45, d));
  }
  return k;
}

/** the land's height at (x, z), -Infinity well away from it */
export function landHeight(x: number, z: number): number {
  const s = inland(x, z);
  if (s < -420) return -Infinity;
  // out from the cliffs: the shelf drops away under the sea
  if (s < 0) return Math.max(-70, -1.6 + s * 0.16);
  let h = plateau(x, z, s);
  for (const c of CREVICES) {
    if (Math.abs(x - (c.ax + c.bx) / 2) > 120 || Math.abs(z - (c.az + c.bz) / 2) > 120) continue;
    const { d, t } = segDist(x, z, c), w = c.w * (0.35 + 0.65 * Math.sin(Math.PI * t));
    if (d < w) h -= c.d * Math.sin(Math.PI * t) ** 0.5 * smooth(w, w * 0.45, d);
  }
  for (const p of POOLS) {
    const q = Math.hypot(x - p.x, z - p.z) / p.r;
    if (q < 1.25) h = Math.min(h, p.level - 0.9 * (1 - q * q) + (q > 1 ? (q - 1) * 4 : 0));
  }
  return h;
}

/** the melt pool whose water (x, z) is in, if any */
export function poolAt(x: number, z: number) {
  for (const p of POOLS) if (Math.hypot(x - p.x, z - p.z) < p.r * 1.02) return p;
  return null;
}

/** everything the north adds to the ground at (x, z): the land, the bergs, the floes (-Infinity: nothing) */
export function arcticHeight(x: number, z: number): number {
  if (z > ICE_Z0 + 60 || Math.abs(x) > ARC_W + 500 || z < ARC_END - 500) return -Infinity;
  let h = landHeight(x, z);
  const b = bergIn(Math.floor(x / BERG_CELL), Math.floor(z / BERG_CELL));
  if (b) h = Math.max(h, iceHeight(b, x, z));
  const f = floeIn(Math.floor(x / FLOE_CELL), Math.floor(z / FLOE_CELL));
  if (f) h = Math.max(h, iceHeight(f, x, z));
  return h;
}

/** is (x, z) on the reachable sea: round the island out to `seaR`, or up the northern corridor */
export const inSeaWorld = (x: number, z: number, seaR: number) => Math.hypot(x, z) < seaR || inCorridor(x, z);
/** if (x, z) is past the edge (round the island, or the corridor's sides and far end), the nearest point back inside */
export function keepInSea(x: number, z: number, seaR: number): [number, number] | null {
  if (inSeaWorld(x, z, seaR)) return null;
  // (beside the corridor's mouth or along it: back in from the side; past its far end: back south)
  if (z < -400) {
    const nx = Math.max(-ARC_W + 1, Math.min(ARC_W - 1, x)), nz = Math.max(ARC_END + 1, z);
    if (inCorridor(nx, nz)) {
      const r = Math.hypot(x, z);
      // (whichever is nearer: the corridor or the ring round the island)
      if (Math.hypot(nx - x, nz - z) < r - seaR) return [nx, nz];
    }
  }
  const r = Math.hypot(x, z);
  return [x * (seaR - 1) / r, z * (seaR - 1) / r];
}
