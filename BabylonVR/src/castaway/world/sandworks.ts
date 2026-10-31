// Working the sand round the oasis (the state lives in desertField.ts):
//   dig / heap: a soft round scoop taken out of (or sand poured onto) the ground, 25 cm cells. Hands take a little, a rock or a
//     pickaxe more; what comes out is sand in your pockets, and sand poured back makes mounds and dams.
//   water: the pond's level is the water table. Any dug ground below it that joins the pond, cell by cell, fills: the water
//     runs along a channel as you dig it (a couple of metres a second), and drains away again if the channel is dammed or
//     filled in. Where it can reach is worked out exactly (`reach`); the running water is only how it looks getting there.
//   green: every dawn the ground within a couple of metres of water turns green, and green ground near water spreads a
//     metre or so further, up to 8 m out. Saplings only take on green ground.
// Everything here is deterministic from the dig grid, so every player in a room works out the same water and the same green.
import { DESERT_X, DESERT_Z, EDIT_CELL, EDIT_N, GREEN_CELL, GREEN_N, OASIS_R, OASIS_WATER, desertHeight, dig, editX, editZ, green, wet, EDIT_X0, EDIT_Z0 } from "./desertField";

export interface SandOp { x: number; z: number; r: number; d: number }
export interface Rect { i0: number; j0: number; i1: number; j1: number }
const MAX_DIG = -3, MAX_HEAP = 2.5;
/** how fast the water runs along a channel: one cell per this many seconds */
const RUN = 0.05;

const grow = (r: Rect | null, i0: number, j0: number, i1: number, j1: number): Rect =>
    r ? { i0: Math.min(r.i0, i0), j0: Math.min(r.j0, j0), i1: Math.max(r.i1, i1), j1: Math.max(r.j1, j1) } : { i0, j0, i1, j1 };

function toB64(u: Uint8Array) { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); }
function fromB64(s: string) { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }

export class SandWorks {
    /** the cells changed since the GPU last copied them */
    digDirty: Rect | null = null;
    wetDirty: Rect | null = null;
    greenDirty = false;
    /** the ground changed in this rectangle (world units): things standing on it are lifted or sunk */
    onGround: ((x0: number, z0: number, x1: number, z1: number) => void) | null = null;
    private base = new Float32Array(EDIT_N * EDIT_N).fill(NaN);
    private reach = new Uint8Array(EDIT_N * EDIT_N);
    private queued = new Uint8Array(EDIT_N * EDIT_N);
    private front: number[] = [];
    private reachDirty = true;
    private reachT = 0;
    private runT = 0;
    private settled = false;

    private ground(k: number) {
        let b = this.base[k];
        if (b !== b) { const i = k % EDIT_N, j = (k - i) / EDIT_N; b = this.base[k] = desertHeight(editX(i), editZ(j)); }
        return b + dig[k];
    }

    /** take sand out (d < 0) or pour it on (d > 0) in a soft round patch; returns the volume moved (m³) */
    apply(op: SandOp): number {
        const c = EDIT_CELL, r = Math.max(c, op.r);
        const i0 = Math.max(0, Math.floor((op.x - r - EDIT_X0) / c)), i1 = Math.min(EDIT_N - 1, Math.ceil((op.x + r - EDIT_X0) / c));
        const j0 = Math.max(0, Math.floor((op.z - r - EDIT_Z0) / c)), j1 = Math.min(EDIT_N - 1, Math.ceil((op.z + r - EDIT_Z0) / c));
        if (i0 > i1 || j0 > j1) return 0;
        let vol = 0;
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
            const dd = Math.hypot(editX(i) - op.x, editZ(j) - op.z);
            if (dd >= r) continue;
            const k = j * EDIT_N + i, w = 0.5 + 0.5 * Math.cos((Math.PI * dd) / r);
            const old = dig[k], nv = Math.max(MAX_DIG, Math.min(MAX_HEAP, old + op.d * w));
            dig[k] = nv; vol += Math.abs(nv - old) * c * c;
        }
        this.digDirty = grow(this.digDirty, i0, j0, i1, j1);
        this.reachDirty = true;
        this.onGround?.(op.x - r - 0.5, op.z - r - 0.5, op.x + r + 0.5, op.z + r + 0.5);
        return vol;
    }

    /** where the water can get: everything below the pond's level joined to the pond */
    private findReach() {
        this.reachDirty = false;
        const R = this.reach; R.fill(0);
        const q: number[] = [];
        const cx = (DESERT_X - EDIT_X0) / EDIT_CELL, cz = (DESERT_Z - EDIT_Z0) / EDIT_CELL, pr = (OASIS_R - 1) / EDIT_CELL;
        const lim = OASIS_WATER - 0.02;
        for (let j = Math.floor(cz - pr); j <= Math.ceil(cz + pr); j++) for (let i = Math.floor(cx - pr); i <= Math.ceil(cx + pr); i++) {
            if (Math.hypot(i + 0.5 - cx, j + 0.5 - cz) > pr) continue;
            const k = j * EDIT_N + i;
            if (this.ground(k) < lim) { R[k] = 1; q.push(k); }
        }
        for (let h = 0; h < q.length; h++) {
            const k = q[h], i = k % EDIT_N;
            const nb = [i > 0 ? k - 1 : -1, i < EDIT_N - 1 ? k + 1 : -1, k >= EDIT_N ? k - EDIT_N : -1, k < EDIT_N * (EDIT_N - 1) ? k + EDIT_N : -1];
            for (const n of nb) if (n >= 0 && !R[n] && this.ground(n) < lim) { R[n] = 1; q.push(n); }
        }
        return q;
    }

    /** the water as it stands, all at once (after loading, or joining a room) */
    settle() {
        const q = this.findReach();
        wet.fill(0);
        for (const k of q) wet[k] = 1;
        this.front.length = 0; this.queued.fill(0);
        this.wetDirty = { i0: 0, j0: 0, i1: EDIT_N - 1, j1: EDIT_N - 1 };
        this.settled = true;
    }

    /** once a frame: the water runs into newly dug channels (and out of dammed ones) */
    update(dt: number) {
        if (!this.settled) this.settle();
        this.reachT -= dt;
        if (this.reachDirty && this.reachT <= 0) {
            this.reachT = 0.2;
            const q = this.findReach();
            const R = this.reach;
            // dammed or filled in: the water there drains away
            for (let k = 0; k < wet.length; k++) if (wet[k] && !R[k]) { wet[k] = 0; const i = k % EDIT_N, j = (k - i) / EDIT_N; this.wetDirty = grow(this.wetDirty, i, j, i, j); }
            // newly reachable ground next to water: the water starts running in
            for (const k of q) if (!wet[k] && !this.queued[k] && this.wetNeighbour(k)) { this.queued[k] = 1; this.front.push(k); }
        }
        if (!this.front.length) return;
        this.runT += dt;
        while (this.runT >= RUN && this.front.length) {
            this.runT -= RUN;
            const now = this.front; this.front = [];
            for (const k of now) {
                this.queued[k] = 0;
                if (!this.reach[k] || wet[k]) continue;
                wet[k] = 1;
                const i = k % EDIT_N, j = (k - i) / EDIT_N;
                this.wetDirty = grow(this.wetDirty, i, j, i, j);
                for (const n of [i > 0 ? k - 1 : -1, i < EDIT_N - 1 ? k + 1 : -1, j > 0 ? k - EDIT_N : -1, j < EDIT_N - 1 ? k + EDIT_N : -1]) {
                    if (n >= 0 && this.reach[n] && !wet[n] && !this.queued[n]) { this.queued[n] = 1; this.front.push(n); }
                }
            }
        }
        if (!this.front.length) this.runT = 0;
    }
    private wetNeighbour(k: number) {
        const i = k % EDIT_N;
        return (i > 0 && wet[k - 1] === 1) || (i < EDIT_N - 1 && wet[k + 1] === 1) || (k >= EDIT_N && wet[k - EDIT_N] === 1) || (k < EDIT_N * (EDIT_N - 1) && wet[k + EDIT_N] === 1);
    }
    /** is the water still running somewhere? */
    get running() { return this.front.length > 0; }

    /** a new day: the ground near water greens, and green near water spreads a little further. Returns the metres greened. */
    dawn(): number {
        if (this.reachDirty) this.findReach();
        const S = EDIT_N / GREEN_N, G = GREEN_N, W = new Uint8Array(G * G);
        // which 1 m cells hold water (where it can get: the same for every player whatever has visibly run in yet)
        for (let j = 0; j < EDIT_N; j++) for (let i = 0; i < EDIT_N; i++) if (this.reach[j * EDIT_N + i]) W[Math.floor(j / S) * G + Math.floor(i / S)] = 1;
        // distance (m) to water, out to 8 m
        const dist = new Uint8Array(G * G).fill(255), q: number[] = [];
        for (let k = 0; k < G * G; k++) if (W[k]) { dist[k] = 0; q.push(k); }
        for (let h = 0; h < q.length; h++) {
            const k = q[h], i = k % G, j = (k - i) / G, d = dist[k];
            if (d >= 8) continue;
            for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
                const ii = i + di, jj = j + dj;
                if (ii < 0 || jj < 0 || ii >= G || jj >= G) continue;
                const n = jj * G + ii;
                if (dist[n] > d + 1) { dist[n] = d + 1; q.push(n); }
            }
        }
        const was = green.slice();
        let n = 0;
        for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
            const k = j * G + i, d = dist[k];
            if (d > 8 || was[k] === 255) continue;
            let near = d <= 2;
            if (!near) for (let dj = -1; dj <= 1 && !near; dj++) for (let di = -1; di <= 1; di++) {
                const ii = i + di, jj = j + dj;
                if (ii >= 0 && jj >= 0 && ii < G && jj < G && was[jj * G + ii] === 255) { near = true; break; }
            }
            if (near) { green[k] = 255; n++; }
        }
        if (n) this.greenDirty = true;
        return n * GREEN_CELL * GREEN_CELL;
    }

    // ---- saving and joining: only the 32 x 32 blocks anybody has touched
    capture() {
        const B = 32, out: { d: [number, number, string][]; g: [number, number, string][] } = { d: [], g: [] };
        for (let bj = 0; bj < EDIT_N / B; bj++) for (let bi = 0; bi < EDIT_N / B; bi++) {
            const a = new Int16Array(B * B); let any = false;
            for (let j = 0; j < B; j++) for (let i = 0; i < B; i++) { const v = Math.round(dig[(bj * B + j) * EDIT_N + bi * B + i] * 1000); a[j * B + i] = v; if (v) any = true; }
            if (any) out.d.push([bi, bj, toB64(new Uint8Array(a.buffer))]);
        }
        for (let bj = 0; bj < GREEN_N / B; bj++) for (let bi = 0; bi < GREEN_N / B; bi++) {
            const a = new Uint8Array(B * B); let any = false;
            for (let j = 0; j < B; j++) for (let i = 0; i < B; i++) { const v = green[(bj * B + j) * GREEN_N + bi * B + i]; a[j * B + i] = v; if (v) any = true; }
            if (any) out.g.push([bi, bj, toB64(a)]);
        }
        return out.d.length || out.g.length ? out : null;
    }
    restore(s: { d?: [number, number, string][]; g?: [number, number, string][] } | null | undefined) {
        const B = 32;
        dig.fill(0); green.fill(0);
        for (const [bi, bj, b] of s?.d ?? []) {
            const a = new Int16Array(fromB64(b).buffer);
            for (let j = 0; j < B; j++) for (let i = 0; i < B; i++) dig[(bj * B + j) * EDIT_N + bi * B + i] = a[j * B + i] / 1000;
        }
        for (const [bi, bj, b] of s?.g ?? []) {
            const a = fromB64(b);
            for (let j = 0; j < B; j++) for (let i = 0; i < B; i++) green[(bj * B + j) * GREEN_N + bi * B + i] = a[j * B + i];
        }
        this.digDirty = { i0: 0, j0: 0, i1: EDIT_N - 1, j1: EDIT_N - 1 };
        this.greenDirty = true;
        this.reachDirty = true;
        this.settle();
        this.onGround?.(EDIT_X0, EDIT_Z0, EDIT_X0 + EDIT_N * EDIT_CELL, EDIT_Z0 + EDIT_N * EDIT_CELL);
    }
}
