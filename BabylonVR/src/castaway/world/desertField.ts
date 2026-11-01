// The desert's ground: a field of wind-shaped dunes around an oasis, far off from the island (z ~ 20 km). It is worked out
// into a grid (`bake`, a tile at a time as it is first needed), and both the game (heightAt: walking, building, placing) and
// the GPU (the dunes' vertex shader reads the very same grid as a texture) sample it bilinearly, so what you walk on is
// exactly what is drawn.
//   Dunes after a prevailing wind: transverse ridges with a long gentle windward slope and a short steep lee face, their
//   lines bent by a slow warp, the ridges taller in some places than others, over a long low swell and small drifts.
//   Round the oasis the sand can be dug and heaped (`dig`, 25 cm cells), water runs from the pond into whatever has been dug
//   below its level (`wet`), and ground near water turns green night by night (`green`, 1 m cells). These grids are the
//   world's state (saved, shared with the other players); world/sandworks.ts changes them.
import { Noise2D, smoothstep } from "../core/noise";

/** the middle of the desert (the oasis), and where the desert begins (z beyond this) */
export const DESERT_X = 0, DESERT_Z = 20000, DESERT_FROM_Z = 15000;
/** the oasis pond's water level and radius (m); how far you may wander from the oasis (m) */
export const OASIS_WATER = 10, OASIS_R = 22, DESERT_LIMIT = 1400;
/** where you arrive: on a dune crest 120 m out, the oasis in sight below (you walk over to it) */
const SPAWN_A = 1.55, SPAWN_R = 120;
export const DESERT_SPAWN = { x: DESERT_X + Math.cos(SPAWN_A) * SPAWN_R, z: DESERT_Z + Math.sin(SPAWN_A) * SPAWN_R, yaw: Math.atan2(Math.cos(SPAWN_A), Math.sin(SPAWN_A)) };
/** the stone arch back to the secret room, just behind where you arrive */
export const DESERT_ARCH = { x: DESERT_X + Math.cos(SPAWN_A) * (SPAWN_R + 6), z: DESERT_Z + Math.sin(SPAWN_A) * (SPAWN_R + 6) };
/** the grid: N x N samples, CELL metres apart, centred on the oasis */
export const FIELD_N = 1024, FIELD_CELL = 4;
const HALF = (FIELD_N * FIELD_CELL) / 2;
/** where the sand can be dug: a square EDIT_HALF either side of the oasis, in EDIT_CELL cells */
export const EDIT_HALF = 128, EDIT_CELL = 0.25, EDIT_N = (EDIT_HALF * 2) / EDIT_CELL;
/** the green: 1 m cells over the same square */
export const GREEN_CELL = 1, GREEN_N = (EDIT_HALF * 2) / GREEN_CELL;
/** the natural green round the pond (m from the middle): full inside the first, none past the second */
export const OASIS_GREEN0 = 40, OASIS_GREEN1 = 58;

const N1 = new Noise2D(9001), N2 = new Noise2D(4242), N3 = new Noise2D(77);
const WIND = 0.35, WC = Math.cos(WIND), WS = Math.sin(WIND);

/** the ground at a point (local to the oasis), straight from the noise (the grid holds these) */
function raw(x: number, z: number): number {
    const along = WC * x + WS * z, across = -WS * x + WC * z;
    const warp = N1.fbm(x * 0.0035, z * 0.0035, 3) * 45;
    const u = (along + warp) / 105 + 0.22 * N2.get(across * 0.006, 3.1);
    const f = u - Math.floor(u);
    // the dune profile: a long windward rise, a short steep slip face down the lee side
    const prof = f < 0.74 ? smoothstep(0, 1, f / 0.74) : 1 - smoothstep(0, 1, (f - 0.74) / 0.26);
    const amp = 5 + 6 * (N3.fbm(x * 0.0018 + 10, z * 0.0018, 2) * 0.5 + 0.5);
    let h = 15 + prof * amp + N1.fbm(x * 0.0011 + 40, z * 0.0011, 3) * 8 + N2.fbm(x * 0.018 + 5, z * 0.018, 2) * 0.7;
    const d = Math.hypot(x, z);
    // (no hollow out in the dunes dips below the pond: water only goes where somebody digs a way for it)
    const floor = OASIS_WATER + 0.7;
    if (h < floor + 1) h = floor + Math.exp(h - floor - 1);
    // the oasis: a green hollow round a pond, the dunes rising all round it
    const inner = d < OASIS_R ? OASIS_WATER - 0.5 - 2.2 * (1 - (d / OASIS_R) ** 2) : OASIS_WATER + 0.35 + (d - OASIS_R) * 0.035;
    const k = smoothstep(58, 120, d);
    h = inner + (h - inner) * k;
    return h;
}

// ---- the dune grid, baked a tile at a time (only round the oasis at first; all of it when the desert is first drawn)
const TILE = 64, TILES = FIELD_N / TILE;
const field = new Float32Array(FIELD_N * FIELD_N);
const tileDone = new Uint8Array(TILES * TILES);
let tilesLeft = TILES * TILES;
function bakeTile(ti: number, tj: number) {
    tileDone[tj * TILES + ti] = 1; tilesLeft--;
    for (let j = tj * TILE; j < (tj + 1) * TILE; j++) {
        const z = -HALF + (j + 0.5) * FIELD_CELL;
        for (let i = ti * TILE; i < (ti + 1) * TILE; i++) field[j * FIELD_N + i] = raw(-HALF + (i + 0.5) * FIELD_CELL, z);
    }
}
/** the whole grid (a fraction of a second; done when the desert is first drawn) */
export function bake(): Float32Array {
    if (tilesLeft) for (let tj = 0; tj < TILES; tj++) for (let ti = 0; ti < TILES; ti++) if (!tileDone[tj * TILES + ti]) bakeTile(ti, tj);
    return field;
}
export const baked = () => tilesLeft === 0;

/** is (x, z) in the desert? */
export const inDesert = (x: number, z: number) => z > DESERT_FROM_Z && Math.abs(x - DESERT_X) < 6000;

/** the dunes' height at a world point (the grid, bilinear: the same as the GPU draws), not counting digging */
export function desertHeight(wx: number, wz: number): number {
    const gx = (wx - DESERT_X + HALF) / FIELD_CELL - 0.5, gz = (wz - DESERT_Z + HALF) / FIELD_CELL - 0.5;
    const cx = Math.max(0, Math.min(FIELD_N - 1.001, gx)), cz = Math.max(0, Math.min(FIELD_N - 1.001, gz));
    const i = Math.floor(cx), j = Math.floor(cz), tx = cx - i, tz = cz - j;
    if (tilesLeft) {
        const ti0 = Math.floor(i / TILE), tj0 = Math.floor(j / TILE), ti1 = Math.floor((i + 1) / TILE), tj1 = Math.floor((j + 1) / TILE);
        for (const [a, b] of [[ti0, tj0], [ti1, tj0], [ti0, tj1], [ti1, tj1]]) if (!tileDone[b * TILES + a]) bakeTile(a, b);
    }
    const f = field;
    const a = f[j * FIELD_N + i], b = f[j * FIELD_N + i + 1], c = f[(j + 1) * FIELD_N + i], d = f[(j + 1) * FIELD_N + i + 1];
    return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * tz;
}

// ---- the oasis's own state: dug sand, water, green
/** metres dug out (negative) or heaped up (positive), per 25 cm cell; cell (i, j) is centred on editX(i), editZ(j) */
export const dig = new Float32Array(EDIT_N * EDIT_N);
/** 1 where water stands (the pond and every dug channel it has run into) */
export const wet = new Uint8Array(EDIT_N * EDIT_N);
/** 0..255: how green the ground has grown (1 m cells) */
export const green = new Uint8Array(GREEN_N * GREEN_N);
export const EDIT_X0 = DESERT_X - EDIT_HALF, EDIT_Z0 = DESERT_Z - EDIT_HALF;
export const editX = (i: number) => EDIT_X0 + (i + 0.5) * EDIT_CELL;
export const editZ = (j: number) => EDIT_Z0 + (j + 0.5) * EDIT_CELL;

/** how much the sand has been dug or heaped here (bilinear, 0 outside the oasis square) */
export function digAt(x: number, z: number): number {
    const gx = (x - EDIT_X0) / EDIT_CELL - 0.5, gz = (z - EDIT_Z0) / EDIT_CELL - 0.5;
    if (gx < 0 || gz < 0 || gx >= EDIT_N - 1 || gz >= EDIT_N - 1) return 0;
    const i = Math.floor(gx), j = Math.floor(gz), tx = gx - i, tz = gz - j, k = j * EDIT_N + i;
    const a = dig[k], b = dig[k + 1], c = dig[k + EDIT_N], d = dig[k + EDIT_N + 1];
    return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * tz;
}
/** the ground as it is now (dunes and digging) */
export const groundAt = (x: number, z: number) => desertHeight(x, z) + digAt(x, z);
/** is there water standing here (the pond, or a channel it has run into)? */
export function wetAt(x: number, z: number): boolean {
    const i = Math.floor((x - EDIT_X0) / EDIT_CELL), j = Math.floor((z - EDIT_Z0) / EDIT_CELL);
    if (i < 0 || j < 0 || i >= EDIT_N || j >= EDIT_N) return false;
    return wet[j * EDIT_N + i] === 1;
}
/** 0..1: how green the ground is here (the oasis's own ring, and what water has greened since) */
export function greenAt(x: number, z: number): number {
    const d = Math.hypot(x - DESERT_X, z - DESERT_Z);
    let g = 1 - smoothstep(OASIS_GREEN0, OASIS_GREEN1, d);
    const i = Math.floor((x - EDIT_X0) / GREEN_CELL), j = Math.floor((z - EDIT_Z0) / GREEN_CELL);
    if (i >= 0 && j >= 0 && i < GREEN_N && j < GREEN_N) g = Math.max(g, green[j * GREEN_N + i] / 255);
    return g;
}
