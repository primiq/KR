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
    const sway = g.getAttribute("sway"), flut = g.getAttribute("flutter");
    if (col || sway) {
        // the wind weights ride in the colour's alpha (Babylon ignores vertex alpha unless asked): whole part = sway x 100, fraction = flutter
        const c = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) {
            c[i * 4] = col ? col.getX(i) : 1;
            c[i * 4 + 1] = col ? col.getY(i) : 1;
            c[i * 4 + 2] = col ? col.getZ(i) : 1;
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
