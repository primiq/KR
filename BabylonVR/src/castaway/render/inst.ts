import { type Material, type Mesh, type Scene } from "@babylonjs/core";
import type * as THREE from "three";
import { meshFromThree } from "./geometry";

const dirty = new Set<Inst>();
let hooked: Scene | null = null;

/** Every mesh that should cast shadows registers here; the sun's shadow generator picks them up. */
export const shadowCasters = new Set<Mesh>();

/**
 * A Babylon mesh drawn with thin instances, behind the same small API as three's InstancedMesh (setMatrixAt /
 * getMatrixAt / count / visible / instanceMatrix.needsUpdate), so Castaway's vegetation and pickup code ports
 * line for line. three's Matrix4 elements and Babylon's matrix buffers share one memory layout.
 * A `far` mesh (a lighter copy of the geometry) can share the same instance buffer for distance LOD.
 */
export class Inst {
    readonly mesh: Mesh;
    readonly array: Float32Array;
    far: Mesh | null = null;
    private n: number;
    private shown = true;
    private farShown = false;
    readonly instanceMatrix = { set needsUpdate(_v: boolean) { /* replaced in constructor */ } };

    constructor(
        name: string,
        geo: THREE.BufferGeometry | Mesh,
        mat: Material,
        readonly cap: number,
        scene: Scene,
        castShadow = false,
    ) {
        this.mesh = "getScene" in geo ? geo : meshFromThree(name, geo, scene);
        this.mesh.material = mat;
        this.mesh.isPickable = false;
        this.mesh.receiveShadows = true;
        this.array = new Float32Array(Math.max(1, cap) * 16);
        this.mesh.thinInstanceSetBuffer("matrix", this.array, 16, false);
        this.n = cap;
        this.mesh.thinInstanceCount = cap;
        this.mesh.setEnabled(cap > 0);
        if (castShadow) shadowCasters.add(this.mesh);
        Object.defineProperty(this.instanceMatrix, "needsUpdate", { set: () => dirty.add(this) });
        if (hooked !== scene) {
            hooked = scene;
            scene.onBeforeRenderObservable.add(() => {
                for (const d of dirty) d.flush();
                dirty.clear();
            });
        }
    }

    /** A lighter copy of the geometry drawn instead beyond the LOD distance (same instances). */
    addFar(geo: THREE.BufferGeometry, scene: Scene): void {
        const f = meshFromThree(`${this.mesh.name}_far`, geo, scene);
        f.material = this.mesh.material;
        f.isPickable = false;
        f.receiveShadows = true;
        f.thinInstanceSetBuffer("matrix", this.array, 16, false);
        f.thinInstanceCount = this.n;
        f.setEnabled(false);
        this.far = f;
    }

    get count() { return this.n; }
    set count(v: number) {
        this.n = v;
        this.mesh.thinInstanceCount = v;
        // (a thin-instanced mesh with no instances would draw its bare geometry at the origin)
        this.mesh.setEnabled(this.shown && v > 0);
        if (this.far) {
            this.far.thinInstanceCount = v;
            this.far.setEnabled(this.farShown && v > 0);
        }
    }
    get visible() { return this.shown; }
    set visible(v: boolean) {
        if (v === this.shown) return;
        this.shown = v;
        this.mesh.setEnabled(v && this.n > 0);
    }
    get farVisible() { return this.farShown; }
    set farVisible(v: boolean) {
        if (!this.far || v === this.farShown) return;
        this.farShown = v;
        this.far.setEnabled(v && this.n > 0);
    }

    setMatrixAt(i: number, m: THREE.Matrix4): void {
        this.array.set(m.elements, i * 16);
    }
    getMatrixAt(i: number, m: THREE.Matrix4): void {
        m.fromArray(this.array, i * 16);
    }
    /** bounding info for frustum culling, from the instances as they are now */
    refreshBounds(): void {
        this.mesh.thinInstanceRefreshBoundingInfo(false);
        if (this.far) this.far.thinInstanceRefreshBoundingInfo(false);
    }
    private flush(): void {
        this.mesh.thinInstanceBufferUpdated("matrix");
        if (this.far) this.far.thinInstanceBufferUpdated("matrix");
    }
}
