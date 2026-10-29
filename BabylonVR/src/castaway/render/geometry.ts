import { Mesh, type Scene, VertexData } from "@babylonjs/core";
import type * as THREE from "three";

/**
 * Turns a three.js BufferGeometry (Castaway's procedural plants, rocks and props are generated with three's maths)
 * into a Babylon mesh: positions, normals and vertex colours, with the `sway` / `flutter` wind weights packed into the colour alpha.
 * Both engines run right-handed here, so axes carry over untouched; only the triangle winding is reversed.
 */
export function meshFromThree(name: string, g: THREE.BufferGeometry, scene: Scene): Mesh {
    const m = new Mesh(name, scene);
    const vd = new VertexData();
    const pos = g.getAttribute("position");
    vd.positions = new Float32Array(pos.array as ArrayLike<number>);
    const nrm = g.getAttribute("normal");
    if (nrm) vd.normals = new Float32Array(nrm.array as ArrayLike<number>);
    const n = pos.count;
    const idx = g.index ? new Uint32Array(g.index.array as ArrayLike<number>) : Uint32Array.from({ length: n }, (_, i) => i);
    // three.js treats counter-clockwise as the front face; Babylon's right-handed mode the opposite way round
    for (let i = 0; i + 2 < idx.length; i += 3) {
        const t = idx[i + 1];
        idx[i + 1] = idx[i + 2];
        idx[i + 2] = t;
    }
    vd.indices = idx;
    const col = g.getAttribute("color");
    const sway = g.getAttribute("sway"), flut = g.getAttribute("flutter"), pat = g.getAttribute("pat");
    if (col || sway || pat) {
        // the wind weights ride in the colour's alpha (Babylon ignores vertex alpha unless asked): whole part = sway x 100, fraction = flutter
        const c = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) {
            let k = 1;
            // Castaway's jaguar rosettes (a node-material pattern there): dark rings and spots from 3D noise of the local position
            if (pat && pat.getX(i) > 0) {
                const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
                const n1 = vnoise(x * 15 + 3.1, y * 15 + 1.7, z * 15 + 5.3), n2 = vnoise(x * 28 + 8.2, y * 28 + 4.4, z * 28 + 1.1);
                const ring = 1 - sstep(0.06, 0.12, Math.abs(n1 - 0.22));
                const dots = sstep(0.42, 0.52, n2);
                k = 1 - Math.min(1, ring + dots * 0.8) * 0.87 * pat.getX(i);
            }
            c[i * 4] = (col ? col.getX(i) : 1) * k;
            c[i * 4 + 1] = (col ? col.getY(i) : 1) * k;
            c[i * 4 + 2] = (col ? col.getZ(i) : 1) * k;
            c[i * 4 + 3] = Math.round(Math.max(0, sway ? sway.getX(i) : 0) * 100) + Math.min(0.99, Math.max(0, flut ? flut.getX(i) : 0));
        }
        vd.colors = c;
    }
    const uv = g.getAttribute("uv");
    if (uv) vd.uvs = new Float32Array(uv.array as ArrayLike<number>);
    if (!vd.normals) {
        const nn: number[] = [];
        VertexData.ComputeNormals(vd.positions, vd.indices, nn, { useRightHandedSystem: true });
        vd.normals = nn;
    }
    vd.applyToMesh(m, false);
    m.hasVertexAlpha = false;
    return m;
}

const sstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hsh = (x: number, y: number, z: number) => { const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return h - Math.floor(h); };
/** value noise in [-1, 1] */
function vnoise(x: number, y: number, z: number): number {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const fx = x - xi, fy = y - yi, fz = z - zi;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
    const L = (a: number, b: number, t: number) => a + (b - a) * t;
    const c = (dx: number, dy: number, dz: number) => hsh(xi + dx, yi + dy, zi + dz);
    return L(L(L(c(0, 0, 0), c(1, 0, 0), u), L(c(0, 1, 0), c(1, 1, 0), u), v), L(L(c(0, 0, 1), c(1, 0, 1), u), L(c(0, 1, 1), c(1, 1, 1), u), v), w) * 2 - 1;
}
