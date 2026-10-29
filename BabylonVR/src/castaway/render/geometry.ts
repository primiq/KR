import { Mesh, type Scene, VertexData } from "@babylonjs/core";
import type * as THREE from "three";

/**
 * Turns a three.js BufferGeometry (Castaway's procedural plants, rocks and props are generated with three's maths)
 * into a Babylon mesh: positions, normals, vertex colours, plus the `sway` / `flutter` wind weights as extra attributes.
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
    if (col) {
        const c = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) {
            c[i * 4] = col.getX(i);
            c[i * 4 + 1] = col.getY(i);
            c[i * 4 + 2] = col.getZ(i);
            c[i * 4 + 3] = 1;
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
    for (const k of ["sway", "flutter"]) {
        const a = g.getAttribute(k);
        m.setVerticesData(k, a ? new Float32Array(a.array as ArrayLike<number>) : new Float32Array(n), false, 1);
    }
    return m;
}
