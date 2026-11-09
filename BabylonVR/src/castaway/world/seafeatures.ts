// The open sea's layout: past the reef, out to SEA_R, the sea is cut into cells and some cells hold something: a little
// islet (sand, a palm or two, maybe a rock, maybe a chest) or the reef a ship was wrecked on. Everything follows from the
// cell's number (no randomness at run time), so every player has the same sea without anything being sent.
// Pure maths, no drawing: island.ts folds the heights in (so walking, wading, boats running aground, all just work), and
// world/opensea.ts builds the meshes for the ones near you.

/** cell size (m); the open sea starts here and ends at `SEA_END` (m from the middle) */
export const SEA_CELL = 280, SEA_START = 720, SEA_END = 2120;

export interface SeaFeature {
  kind: "islet" | "wreck";
  /** a number of its own (chests, seeds) */
  id: number;
  x: number; z: number;
  /** islet: radius of the dry land and the height of its top; wreck: radius of the reef's flat top */
  r: number; top: number;
  /** its own random numbers, and which way it lies */
  seed: number; yaw: number;
  /** islet: how many palms (1-2), a rock, a chest */
  palms: number; rock: boolean; chest: boolean;
}

function hash(i: number, j: number) {
  let h = (i * 374761393 + j * 668265263) ^ 0x5bd1e995;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const rand = (i: number, j: number, k: number) => hash(i * 31 + k * 7919, j * 17 - k * 104729);

const cache = new Map<number, SeaFeature | null>();
const key = (i: number, j: number) => (i + 512) * 1024 + (j + 512);

/** what is in cell (i, j), if anything */
export function featureIn(i: number, j: number): SeaFeature | null {
  const k = key(i, j);
  const c = cache.get(k);
  if (c !== undefined) return c;
  let f: SeaFeature | null = null;
  // (somewhere in the middle part of the cell, well clear of its neighbours)
  const x = (i + 0.3 + 0.4 * rand(i, j, 1)) * SEA_CELL, z = (j + 0.3 + 0.4 * rand(i, j, 2)) * SEA_CELL, d = Math.hypot(x, z);
  const roll = rand(i, j, 3);
  if (d > SEA_START && d < SEA_END && roll < 0.3) {
    const wreck = roll < 0.075, s = rand(i, j, 4);
    f = {
      kind: wreck ? "wreck" : "islet", id: 1000 + k, x, z,
      r: wreck ? 30 : 12 + s * 12, top: wreck ? -7.5 : 1.7 + rand(i, j, 5) * 1.6,
      seed: rand(i, j, 6) * 100, yaw: rand(i, j, 7) * Math.PI * 2,
      palms: 1 + (rand(i, j, 8) < 0.5 ? 1 : 0), rock: rand(i, j, 9) < 0.6, chest: wreck || rand(i, j, 10) < 0.45,
    };
  }
  cache.set(k, f);
  return f;
}

/** the feature whose cell (x, z) is in */
export function featureAt(x: number, z: number): SeaFeature | null {
  return featureIn(Math.floor(x / SEA_CELL), Math.floor(z / SEA_CELL));
}

/** every feature within `rad` of (x, z) */
export function featuresNear(x: number, z: number, rad: number, out: SeaFeature[] = []): SeaFeature[] {
  out.length = 0;
  const i0 = Math.floor((x - rad) / SEA_CELL), i1 = Math.floor((x + rad) / SEA_CELL), j0 = Math.floor((z - rad) / SEA_CELL), j1 = Math.floor((z + rad) / SEA_CELL);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    const f = featureIn(i, j);
    if (f && Math.hypot(f.x - x, f.z - z) < rad) out.push(f);
  }
  return out;
}

/** an islet's shore radius in the direction `a` (a little wobbly, not a circle) */
export function shoreR(f: SeaFeature, a: number) {
  return f.r * (1 + 0.16 * Math.sin(3 * a + f.seed) + 0.08 * Math.sin(5 * a + f.seed * 2.3));
}

/** how high the feature raises the sea floor at (x, z) (-Infinity where it has no say) */
export function featureHeight(f: SeaFeature, x: number, z: number): number {
  const dx = x - f.x, dz = z - f.z, d = Math.hypot(dx, dz);
  if (f.kind === "islet") {
    // a low dome of sand, sloping gently down the beach and then off into the deep
    const q = d / shoreR(f, Math.atan2(dz, dx));
    if (q > 4.5) return -Infinity;
    // (in the water it falls away faster and faster: a beach to wade off, then the drop into the deep)
    return q < 1 ? f.top * (1 - q * q) + 0.25 * Math.sin(dx * 0.4 + f.seed) * Math.sin(dz * 0.37) * (1 - q) : f.top * (1 - q * q) * q;
  }
  // the reef: a wide, nearly flat top some metres down, then a steep drop
  const q = d / f.r;
  if (q > 3.5) return -Infinity;
  return q < 1 ? f.top - 0.6 * q * q + 0.4 * Math.sin(dx * 0.3 + f.seed) * Math.sin(dz * 0.27) : f.top - 0.6 - (d - f.r) * 1.1;
}

/** the open sea's own ground at (x, z), -Infinity where there is nothing but the deep */
export function seaFeatureHeight(x: number, z: number): number {
  const f = featureAt(x, z);
  return f ? featureHeight(f, x, z) : -Infinity;
}
