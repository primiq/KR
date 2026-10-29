// The island height field. Pure functions so terrain mesh, vegetation placement,
// player physics and the water shader's depth texture all agree on the same ground.
import { Noise2D, clamp, smoothstep } from '../core/noise';

/**
 * TEST SWITCH: the "classic" landscape is the island as it was before the sea cliffs, rocky coves, the peak and the waterfall.
 * It is the default for now (to rule the new terrain in or out as the cause of mobile lag); open the page with `#new` (or `?new`)
 * to get the new landscape. The two are different worlds, so saves and multiplayer keep them apart (LAYOUT / PROTOCOL).
 */
export const CLASSIC = !(typeof location !== 'undefined' && /(^|[?&#])new\b/.test(location.search + location.hash));

/** Bearing (radians, atan2(z, x)) of the beach the player spawns on. The sun is turned so it rises over the sea straight ahead of this spot. */
export const SPAWN_THETA = -2.25;

export const SEA_LEVEL = 0;
export const TERRAIN_SIZE = 760; // metres, centred on the origin
export const WORLD_RADIUS = 340; // soft limit for the player

const N = new Noise2D(1337);
const N2 = new Noise2D(9001);

const ISLAND_R = 215;

/** Underwater profile: wide turquoise shelf, then a drop into the deep. */
function underwater(u: number): number {
  const shelf = -Math.min(u, 64) * 0.062;
  const drop = -smoothstep(48, 165, u) * 34;
  return shelf + drop;
}

/** Distance-to-shore field: positive on land. The same function everything else (coves, cliffs, rivers) is placed from. */
function shoreS(x: number, z: number): number {
  const d = Math.hypot(x, z);
  const warp = N.fbm(x * 0.0045 + 11, z * 0.0045 + 7, 4) * 78 + N.fbm(x * 0.02, z * 0.02, 2) * 7;
  // a sheltered cove on the south side
  const cove = 78 * Math.exp(-((x - 15) ** 2 + (z - 205) ** 2) / (2 * 58 * 58));
  return ISLAND_R - d + warp - cove;
}

// ---------------------------------------------------------------- landmarks
const DEG = Math.PI / 180;
const angDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
/** where the shore lies along a bearing */
function coastR(t: number): number {
  for (let r = 335; r > 20; r -= 0.5) if (shoreS(Math.cos(t) * r, Math.sin(t) * r) > 0) return r;
  return 200;
}

/** Sea cliffs: the coast rises straight out of deep water. One broad face on the south-east, one narrow one where the waterfall lands. */
const CLIFFS = [{ a: 40 * DEG, hw: 0.5, top: 16.5 }, { a: -75 * DEG, hw: 0.3, top: 17.5 }];
function cliffW(x: number, z: number): { w: number; top: number } {
  if (CLASSIC) return { w: 0, top: 0 };
  const t = Math.atan2(z, x);
  let best = 0, top = 16.5;
  for (const c of CLIFFS) {
    const d = Math.abs(angDiff(t, c.a));
    const w = smoothstep(c.hw, c.hw * 0.45, d);
    if (w > best) { best = w; top = c.top; }
  }
  return { w: best, top };
}

/** Rocky coves: a ring of jagged rock round a deep tidal pool that the sea reaches through a narrow channel. */
interface Cove { cx: number; cz: number; dx: number; dz: number; s: number }
/** The full landscape has three big coves; the default island has one smaller cove a short walk along the beach from the spawn. */
const COVES: Cove[] = (CLASSIC ? [[-148, 0.75]] : [[-5, 1], [118, 1], [-165, 1]]).map(([deg, sc]) => {
  const t = deg * DEG, dx = Math.cos(t), dz = Math.sin(t), r = coastR(t) - 17 * sc;
  return { cx: dx * r, cz: dz * r, dx, dz, s: sc };
});

/** The mountain: steep on every side except a broad ramp on the south, with a spring high up feeding the waterfall. */
const HILL_ANG = -75 * DEG;
const HILL = { x: Math.cos(HILL_ANG) * 128, z: Math.sin(HILL_ANG) * 128, R: 60, H: 46, ramp: Math.PI * 0.62 /* bearing from the summit to the gentle side */ };

function mountH(x: number, z: number): number {
  if (CLASSIC) return 0;
  const hx = x - HILL.x, hz = z - HILL.z, hd = Math.hypot(hx, hz);
  if (hd > 120) return 0;
  const a = Math.atan2(hz, hx);
  const wedge = smoothstep(0.75, 0.1, Math.abs(angDiff(a, HILL.ramp)));
  const R = HILL.R * (1 + 0.75 * wedge);
  const t = Math.min(1, Math.max(0, 1 - hd / R));
  if (t <= 0) return 0;
  let m = HILL.H * Math.pow(t, 1.12);
  // ledges and gullies: the climb is a scramble, not a staircase
  const g = N.fbm(x * 0.055 + 70, z * 0.055 - 30, 3);
  m += (g * 4 + Math.sin(hd * 0.33 + g * 3) * 1.2) * Math.min(1, t * 2.5) * (1 - 0.6 * wedge);
  return Math.max(0, m);
}

/** Terrain before the river is carved. */
function terrainH(x: number, z: number): number {
  // ---- main island ----------------------------------------------------
  const s = shoreS(x, z);
  const { w: wc, top: ctop } = cliffW(x, z);

  let h: number;
  if (s < 0) {
    h = underwater(-s) + N2.get(x * 0.09, z * 0.09) * 0.07;
    // below a cliff the sea is deep right at the foot
    if (wc > 0) h += (-smoothstep(0, 9, -s) * 22 - Math.min(-s, 60) * 0.03 - underwater(-s)) * wc;
  } else {
    let beach = Math.min(s, 26) * 0.092; // gentle sandy slope up to ~2.4 m
    if (wc > 0) {
      const face = smoothstep(0, 9, s) * (ctop + 2.2 * N.fbm(x * 0.05 + 5, z * 0.05, 2));
      // jagged rock on the face and a chewed lip along the top
      const crag = (N2.get(x * 0.33, z * 0.33) * 0.9 + N2.get(x * 0.11 + 4, z * 0.11) * 1.4) * smoothstep(0, 4, s) * (1 - 0.5 * smoothstep(9, 20, s));
      beach += (face + crag - beach) * wc;
    }
    const hillNoise = N.fbm(x * 0.0065 + 40, z * 0.0065 - 20, 4) * 0.5 + 0.5;
    const hills = smoothstep(20, 150, s) * (9 + 24 * hillNoise);
    const peak = 26 * Math.exp(-((x * 0.9) ** 2 + (z * 1.1 + 15) ** 2) / (2 * 62 * 62));
    const detail = N.fbm(x * 0.03, z * 0.03, 3) * 1.4 * smoothstep(8, 40, s);
    const ripples = N2.get(x * 0.22, z * 0.22) * 0.09 * (1 - smoothstep(10, 30, s));
    h = beach + hills + peak * smoothstep(30, 110, s) + detail + ripples;
    h += mountH(x, z) * smoothstep(10, 30, s);
  }

  // ---- rocky coves with tidal pools ----------------------------------
  for (const c of COVES) {
    const k = c.s, px = x - c.cx, pz = z - c.cz, d = Math.hypot(px, pz);
    if (d > 48 * k) continue;
    const along = px * c.dx + pz * c.dz, perp = -px * c.dz + pz * c.dx;
    const rough = N.fbm(x * 0.12 + c.cx, z * 0.12 + c.cz, 3) * 0.9 + N2.get(x * 0.45, z * 0.45) * 0.35;
    // radial profile: deep bowl, a raised jagged rim, then a rock shelf stepping down to the shore
    const bowl = -2.7 + 5.4 * smoothstep(4.5 * k, 12.5 * k, d);
    const T = d < 12.5 * k ? bowl : 2.7 + (1.5 - 2.7) * smoothstep(12.5 * k, 26 * k, d);
    const w = smoothstep(48 * k, 30 * k, d);
    let hh = h + (T + rough * (0.5 + 0.5 * smoothstep(5 * k, 14 * k, d)) - h) * w;
    // the sea gets in through a narrow channel
    if (along > 2 * k) {
      const m = Math.exp(-((perp / (2.2 * k)) ** 2)) * smoothstep(2 * k, 8 * k, along) * smoothstep(52 * k, 30 * k, along);
      const bed = -1.3 - 0.01 * along;
      if (hh > bed) hh -= (hh - bed) * m;
    }
    h = hh;
  }
  return h;
}

// ---------------------------------------------------------------- the stream and its waterfall
export interface RiverPt { x: number; z: number }
/** The stream, from its spring high on the mountain to where it leaves the land. Built once by walking downhill. */
export const RIVER: RiverPt[] = [];
export let RIVER_SPRING: { x: number; z: number } | null = null;
export let RIVER_MOUTH = { x: 0, z: 0 };
(function buildRiver() {
  if (CLASSIC) { RIVER_MOUTH = { x: 1e6, z: 1e6 }; return; } // no stream on the classic island
  const t = HILL_ANG;
  const outX = Math.cos(t), outZ = Math.sin(t);
  let x = HILL.x + outX * HILL.R * 0.42, z = HILL.z + outZ * HILL.R * 0.42;
  RIVER.push({ x, z });
  for (let i = 0; i < 420; i++) {
    const e = 1.6;
    let dx: number, dz: number;
    const bl = Math.hypot(x, z) || 1, bx = x / bl, bz = z / bl;
    if (mountH(x, z) > 3) {
      // on the mountain the stream follows the fall line
      const gx = (terrainH(x + e, z) - terrainH(x - e, z)) / (2 * e), gz = (terrainH(x, z + e) - terrainH(x, z - e)) / (2 * e);
      dx = -gx; dz = -gz;
      const gl = Math.hypot(dx, dz) || 1; dx /= gl; dz /= gl;
      dx = dx * 0.7 + bx * 0.5; dz = dz * 0.7 + bz * 0.5;
    } else { dx = bx; dz = bz; } // across the plateau it simply runs for the sea
    const l = Math.hypot(dx, dz) || 1;
    x += (dx / l) * 2.2; z += (dz / l) * 2.2;
    RIVER.push({ x, z });
    if (terrainH(x, z) < -0.4) break;
  }
  RIVER_MOUTH = RIVER[RIVER.length - 1];
  // a drinkable pool where the stream first runs level
  for (let i = 8; i < RIVER.length - 10; i++) {
    const p = RIVER[i];
    const hs = terrainH(p.x, p.z), h2 = terrainH(RIVER[i + 4].x, RIVER[i + 4].z);
    if (Math.abs(hs - h2) < 0.9 && hs > 6) { RIVER_SPRING = { x: p.x, z: p.z }; break; }
  }
})();
const RB = (() => {
  let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
  for (const p of RIVER) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
  return { x0: x0 - 6, z0: z0 - 6, x1: x1 + 6, z1: z1 + 6 };
})();
/** Distance to the stream's centre line (large when far). */
export function riverDist(x: number, z: number): number {
  if (x < RB.x0 || x > RB.x1 || z < RB.z0 || z > RB.z1) return 1e9;
  let best = 1e9;
  for (let i = 0; i < RIVER.length - 1; i++) {
    const a = RIVER[i], b = RIVER[i + 1];
    const vx = b.x - a.x, vz = b.z - a.z, wx = x - a.x, wz = z - a.z;
    const t = Math.min(1, Math.max(0, (wx * vx + wz * vz) / (vx * vx + vz * vz)));
    const d = Math.hypot(wx - vx * t, wz - vz * t);
    if (d < best) best = d;
  }
  return best;
}

export function baseHeightAt(x: number, z: number): number {
  let h = terrainH(x, z);
  const rd = riverDist(x, z);
  if (rd < 5) h -= 1.35 * Math.exp(-((rd / 1.9) ** 2));
  // ---- little islet ---------------------------------------------------
  const ix = x + 275, iz = z - 135;
  const id = Math.hypot(ix, iz);
  const s2 = 46 - id + N.fbm(x * 0.03 + 3, z * 0.03 + 9, 3) * 16;
  let h2: number;
  if (s2 < 0) h2 = underwater(-s2);
  else h2 = Math.min(s2, 10) * 0.14 + smoothstep(6, 38, s2) * 7;
  return Math.max(h, h2);
}

/** 0..1: bare rock rather than sand or grass (cliff faces, cove shelves, the mountain's crown). Slope-based rock is added by the shader. */
export function rockiness(x: number, z: number): number {
  let r = 0;
  if (!CLASSIC) {
    const { w: wc } = cliffW(x, z);
    if (wc > 0) { const s = shoreS(x, z); r = Math.max(r, wc * smoothstep(0.5, 5, s) * (1 - smoothstep(26, 60, s)) ); }
  }
  for (const c of COVES) {
    const d = Math.hypot(x - c.cx, z - c.cz), k = c.s;
    if (d < 46 * k) r = Math.max(r, smoothstep(46 * k, 24 * k, d) * (d < 7 * k ? 0.35 : 1));
  }
  if (!CLASSIC) { const m = mountH(x, z); if (m > 0) r = Math.max(r, smoothstep(34, 50, m) * 0.9); }
  return r;
}

export function slopeAt(x: number, z: number, e = 0.75): number {
  const dx = heightAt(x + e, z) - heightAt(x - e, z);
  const dz = heightAt(x, z + e) - heightAt(x, z - e);
  return Math.hypot(dx, dz) / (2 * e); // rise/run
}

export function normalAt(x: number, z: number, out: [number, number, number], e = 0.6) {
  const hx = heightAt(x + e, z) - heightAt(x - e, z);
  const hz = heightAt(x, z + e) - heightAt(x, z - e);
  const nx = -hx, ny = 2 * e, nz = -hz;
  const l = Math.hypot(nx, ny, nz);
  out[0] = nx / l; out[1] = ny / l; out[2] = nz / l;
}

/** A nice beach spot to start, facing the sea. */
export function findSpawn(): { x: number; z: number; yaw: number } {
  const theta = SPAWN_THETA;
  const dx = Math.cos(theta), dz = Math.sin(theta);
  for (let r = 330; r > 0; r -= 1) {
    const x = dx * r, z = dz * r;
    if (heightAt(x, z) > 1.1) {
      const px = dx * (r - 3), pz = dz * (r - 3);
      return { x: px, z: pz, yaw: Math.atan2(-dx, -dz) };
    }
  }
  return { x: 0, z: 0, yaw: 0 };
}

export { clamp };


// ---------------------------------------------------------------- building-site cuts
/** Flat building sites carved into the ground: under each foundation the terrain is lowered to just under the floor. */
export interface Cut { x0: number; z0: number; x1: number; z1: number; y: number }
const CUT_FLAT = 1.0;   // ground stays level this far past the slab...
const CUT_BLEND = 3.0;  // ...then eases back into the natural hillside over this distance
const CUT_HASH = 8;
const cutCells = new Map<string, Cut[]>();
let cutCount = 0;
const ck = (i: number, j: number) => i + ',' + j;
function cutRange(c: Cut, fn: (k: string) => void) {
  const m = CUT_FLAT + CUT_BLEND;
  for (let i = Math.floor((c.x0 - m) / CUT_HASH); i <= Math.floor((c.x1 + m) / CUT_HASH); i++)
    for (let j = Math.floor((c.z0 - m) / CUT_HASH); j <= Math.floor((c.z1 + m) / CUT_HASH); j++) fn(ck(i, j));
}
export function addCut(c: Cut) {
  cutRange(c, (k) => { let l = cutCells.get(k); if (!l) cutCells.set(k, (l = [])); l.push(c); });
  cutCount++;
}
export function removeCut(c: Cut) {
  cutRange(c, (k) => { const l = cutCells.get(k); if (l) { const i = l.indexOf(c); if (i >= 0) l.splice(i, 1); } });
  cutCount--;
}
/** World rectangle a cut can change (for refreshing the terrain mesh). */
export function cutBounds(c: Cut) { const m = CUT_FLAT + CUT_BLEND + 0.1; return { x0: c.x0 - m, z0: c.z0 - m, x1: c.x1 + m, z1: c.z1 + m }; }
/** True when (x, z) lies on a building slab (plus `margin`): no grass etc. should grow there. */
export function inCut(x: number, z: number, margin = 0): boolean {
  if (!cutCount) return false;
  const l = cutCells.get(ck(Math.floor(x / CUT_HASH), Math.floor(z / CUT_HASH)));
  if (!l) return false;
  for (const c of l) if (x > c.x0 - margin && x < c.x1 + margin && z > c.z0 - margin && z < c.z1 + margin) return true;
  return false;
}

export function heightAt(x: number, z: number): number {
  let h = baseHeightAt(x, z);
  if (!cutCount) return h;
  const l = cutCells.get(ck(Math.floor(x / CUT_HASH), Math.floor(z / CUT_HASH)));
  if (!l) return h;
  for (const c of l) {
    const dx = Math.max(c.x0 - x, 0, x - c.x1), dz = Math.max(c.z0 - z, 0, z - c.z1);
    const d = Math.hypot(dx, dz);
    if (d >= CUT_FLAT + CUT_BLEND) continue;
    const target = c.y - 0.2;
    if (h <= target) continue;
    const t = Math.min(Math.max((d - CUT_FLAT) / CUT_BLEND, 0), 1);
    const w = 1 - t * t * (3 - 2 * t);
    h -= (h - target) * w;
  }
  return h;
}
