// The desert's ground: a field of wind-shaped dunes around an oasis, far off from the island (z ~ 20 km). It is worked out
// once into a grid (`bake`), and both the game (heightAt: walking, building, placing) and the GPU (the dunes' vertex shader
// reads the very same grid as a texture) sample it bilinearly, so what you walk on is exactly what is drawn.
//   Dunes after a prevailing wind: transverse ridges with a long gentle windward slope and a short steep lee face, their
//   lines bent by a slow warp, the ridges taller in some places than others, over a long low swell and small drifts.
import { Noise2D, smoothstep } from "../core/noise";

/** the middle of the desert (the oasis), and where the desert begins (z beyond this) */
export const DESERT_X = 0, DESERT_Z = 20000, DESERT_FROM_Z = 15000;
/** the oasis pond's water level and radius (m); how far you may wander from the oasis (m) */
export const OASIS_WATER = 10, OASIS_R = 22, DESERT_LIMIT = 1400;
/** the grid: N x N samples, CELL metres apart, centred on the oasis */
export const FIELD_N = 1024, FIELD_CELL = 4;
const HALF = (FIELD_N * FIELD_CELL) / 2;

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
    // the oasis: a green hollow round a pond, the dunes rising all round it
    const d = Math.hypot(x, z);
    const inner = d < OASIS_R ? OASIS_WATER - 0.5 - 2.2 * (1 - (d / OASIS_R) ** 2) : OASIS_WATER + 0.35 + (d - OASIS_R) * 0.035;
    const k = smoothstep(58, 120, d);
    h = inner + (h - inner) * k;
    return h;
}

let field: Float32Array | null = null;
/** work the grid out (a fraction of a second; done when the desert is first visited) */
export function bake(): Float32Array {
    if (field) return field;
    const f = new Float32Array(FIELD_N * FIELD_N);
    for (let j = 0; j < FIELD_N; j++) {
        const z = -HALF + (j + 0.5) * FIELD_CELL;
        for (let i = 0; i < FIELD_N; i++) f[j * FIELD_N + i] = raw(-HALF + (i + 0.5) * FIELD_CELL, z);
    }
    field = f;
    return f;
}
export const baked = () => !!field;

/** is (x, z) in the desert? */
export const inDesert = (x: number, z: number) => z > DESERT_FROM_Z && Math.abs(x - DESERT_X) < 6000;

/** the desert's ground height at a world point (the grid, bilinear: the same as the GPU draws) */
export function desertHeight(wx: number, wz: number): number {
    const f = field ?? bake();
    const gx = (wx - DESERT_X + HALF) / FIELD_CELL - 0.5, gz = (wz - DESERT_Z + HALF) / FIELD_CELL - 0.5;
    const cx = Math.max(0, Math.min(FIELD_N - 1.001, gx)), cz = Math.max(0, Math.min(FIELD_N - 1.001, gz));
    const i = Math.floor(cx), j = Math.floor(cz), tx = cx - i, tz = cz - j;
    const a = f[j * FIELD_N + i], b = f[j * FIELD_N + i + 1], c = f[(j + 1) * FIELD_N + i], d = f[(j + 1) * FIELD_N + i + 1];
    return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * tz;
}
