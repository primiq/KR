import type { Material, Mesh, Scene } from "@babylonjs/core";
import type * as THREE from "three";
import { meshFromThree } from "./geometry";
import { shadowCasters } from "./inst";

interface Bucket { mesh: Mesh; data: Float32Array; cap: number; n: number }

/**
 * Draws a three.js scene graph (Castaway's animal rigs, animated by its own code) with Babylon: every frame the
 * visible three meshes' world matrices are written into one thin-instanced Babylon mesh per geometry, so a whole
 * herd of animated, jointed creatures costs a handful of draw calls. three's matrix layout is Babylon's.
 */
export class ThreeMirror {
    private buckets = new Map<THREE.BufferGeometry, Bucket>();

    constructor(
        private readonly scene: Scene,
        private readonly root: THREE.Object3D,
        private readonly material: Material,
        private readonly shadows: boolean,
    ) {}

    private bucket(g: THREE.BufferGeometry): Bucket {
        let b = this.buckets.get(g);
        if (!b) {
            const mesh = meshFromThree("mirror", g, this.scene);
            mesh.material = this.material;
            mesh.isPickable = false;
            mesh.receiveShadows = true;
            mesh.alwaysSelectAsActiveMesh = true;
            if (this.shadows) shadowCasters.add(mesh);
            const cap = 8;
            const data = new Float32Array(cap * 16);
            mesh.thinInstanceSetBuffer("matrix", data, 16, false);
            mesh.thinInstanceCount = 0;
            mesh.setEnabled(false);
            b = { mesh, data, cap, n: 0 };
            this.buckets.set(g, b);
        }
        return b;
    }

    sync() {
        this.root.updateMatrixWorld(true);
        for (const b of this.buckets.values()) b.n = 0;
        const walk = (o: THREE.Object3D) => {
            if (!o.visible) return;
            const m = o as THREE.Mesh;
            if (m.isMesh) {
                const b = this.bucket(m.geometry);
                if (b.n >= b.cap) {
                    b.cap *= 2;
                    const d = new Float32Array(b.cap * 16);
                    d.set(b.data);
                    b.data = d;
                    b.mesh.thinInstanceSetBuffer("matrix", d, 16, false);
                }
                b.data.set(m.matrixWorld.elements, b.n * 16);
                b.n++;
            }
            for (const c of o.children) walk(c);
        };
        walk(this.root);
        for (const b of this.buckets.values()) {
            b.mesh.thinInstanceCount = b.n;
            b.mesh.setEnabled(b.n > 0);
            if (b.n) b.mesh.thinInstanceBufferUpdated("matrix");
        }
    }
}
