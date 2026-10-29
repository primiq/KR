// Castaway's wave helpers, answered by the Babylon ocean: main points SEA.surface at Ocean.surfaceAt (the same Gerstner
// swell the water shader draws, rough seas included), so things floating far out bob with the water you see.

/** the sea state: 0 calm .. 1 storm (the ocean's roughness), and the water surface height */
export const SEA = { rough: 0, surface: null as ((x: number, z: number) => number) | null };

/** Vertical wave displacement at world (x, z) (the time is the ocean's own). */
export function waveHeight(x: number, z: number, _t: number): number {
    return SEA.surface ? SEA.surface(x, z) : 0;
}

export const SHORE_DAMP_DEPTH = 4.0; // waves fade to nothing where water is shallower than this
