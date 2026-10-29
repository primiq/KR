import { type Material, Mesh, Quaternion, type Scene, TransformNode } from "@babylonjs/core";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { meshFromThree } from "./geometry";
import { shadowCasters } from "./inst";

/** A stand-in material: Castaway's model code is kept as is (three.js groups and meshes) and names its materials by key. */
export const tok = (key: string) => new THREE.MeshBasicMaterial({ name: key });

export interface Baked {
    node: TransformNode;
    /** meshes that were marked `userData.keep` (flames, glow cards, doors): kept separate so they can animate */
    kept: Map<THREE.Object3D, TransformNode>;
}

/**
 * Turns a three.js group (built by Castaway's model code) into Babylon: everything static is baked into one merged
 * mesh per material (a campfire is 3-4 draw calls instead of 30), objects marked `userData.keep` stay their own nodes.
 * `ghost`: everything merged into one see-through preview mesh.
 */
export function bakeGroup(name: string, g: THREE.Group, scene: Scene, mat: (key: string) => Material, shadows: boolean, ghost?: Material): Baked {
    const node = new TransformNode(name, scene);
    const kept = new Map<THREE.Object3D, TransformNode>();
    const buckets = new Map<string, THREE.BufferGeometry[]>();
    g.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
    const keepRoots = new Set<THREE.Object3D>();
    g.traverse((o) => { if (o.userData.keep && o !== g) keepRoots.add(o); });
    const underKeep = (o: THREE.Object3D) => { for (let p: THREE.Object3D | null = o; p && p !== g; p = p.parent) if (keepRoots.has(p)) return p; return null; };
    const toLocal = (m: THREE.Mesh, rel: THREE.Matrix4) => {
        let geo = m.geometry.clone();
        if (geo.index) geo = geo.toNonIndexed();
        geo.deleteAttribute("uv");
        geo.applyMatrix4(rel);
        return geo;
    };
    // the static part
    g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || underKeep(m)) return;
        const key = ghost ? "ghost" : (m.material as THREE.Material).name;
        const rel = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
        let a = buckets.get(key);
        if (!a) buckets.set(key, (a = []));
        a.push(toLocal(m, rel));
    });
    const make = (key: string, geos: THREE.BufferGeometry[], parent: TransformNode) => {
        const merged = mergeGeometries(geos);
        if (!merged) return;
        const bm = meshFromThree(`${name}_${key}`, merged, scene);
        bm.material = ghost ?? mat(key);
        bm.parent = parent;
        bm.isPickable = false;
        bm.receiveShadows = !ghost;
        if (shadows && !ghost && !key.startsWith("flame") && !key.includes("glow") && key !== "lamp") shadowCasters.add(bm);
    };
    for (const [k, geos] of buckets) make(k, geos, node);
    // the kept parts: their own node with their transform relative to the group, children baked inside them
    for (const root of keepRoots) {
        if (ghost) continue;
        const kn = new TransformNode(`${name}_kept`, scene);
        kn.parent = node;
        const rel = new THREE.Matrix4().multiplyMatrices(inv, root.matrixWorld);
        const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
        rel.decompose(p, q, s);
        kn.position.set(p.x, p.y, p.z);
        kn.rotationQuaternion = new Quaternion(q.x, q.y, q.z, q.w);
        kn.scaling.set(s.x, s.y, s.z);
        const rinv = new THREE.Matrix4().copy(root.matrixWorld).invert();
        const kb = new Map<string, THREE.BufferGeometry[]>();
        root.traverse((o) => {
            const m = o as THREE.Mesh;
            if (!m.isMesh) return;
            const key = (m.material as THREE.Material).name;
            let a = kb.get(key);
            if (!a) kb.set(key, (a = []));
            a.push(toLocal(m, new THREE.Matrix4().multiplyMatrices(rinv, m.matrixWorld)));
        });
        for (const [k, geos] of kb) make(k, geos, kn);
        kept.set(root, kn);
    }
    return { node, kept };
}

/** Disposes a baked node and drops its meshes from the shadow list. */
export function disposeBaked(node: TransformNode) {
    for (const m of node.getChildMeshes()) shadowCasters.delete(m as Mesh);
    node.dispose();
}
