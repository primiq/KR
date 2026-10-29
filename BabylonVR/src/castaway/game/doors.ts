// Doors that hang in doorways. Hold a door and click a doorway to fit it; press E to open or close it (it swings away from
// you); hold E to take it out again. A closed door is solid. Doors are saved with the world and shared in multiplayer.
// Ported from Castaway: the same logic, drawn with Babylon.
import { type Mesh, MeshBuilder, type Scene, TransformNode, type Vector3 } from "@babylonjs/core";
import * as THREE from "three";
import { meshFromThree } from "../render/geometry";
import { shadowCasters } from "../render/inst";
import { ghostMaterial, solid, woodMaterials } from "../render/materials";
import type { Box, BuildingSystem, Piece } from "./building";

const W = 1.16, H = 2.27, T = 0.06; // the leaf: fits the 1.2 x 2.3 m opening

export interface Door {
    key: string; // the doorway piece
    open: boolean;
    /** which way it swings (+1 / -1) */
    sign: number;
    ang: number;
    pivot: TransformNode;
    group: TransformNode;
    box: Box;
}

let LEAF: THREE.BufferGeometry | null = null;
function leafGeometry() {
    if (LEAF) return LEAF;
    // planks with two ledges across each side
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 6; i++) parts.push(new THREE.BoxGeometry(W / 6 - 0.006, H, T).translate(-W / 2 + (i + 0.5) * (W / 6), 0, 0));
    for (const y of [-0.75, 0.75]) parts.push(new THREE.BoxGeometry(W - 0.06, 0.12, 0.03).translate(0, y, -T / 2 - 0.015));
    for (const y of [-0.75, 0.75]) parts.push(new THREE.BoxGeometry(W - 0.06, 0.12, 0.03).translate(0, y, T / 2 + 0.015));
    const pos: number[] = [], nor: number[] = [], idx: number[] = [];
    for (const g of parts) {
        const base = pos.length / 3, P = g.getAttribute("position"), N = g.getAttribute("normal");
        for (let i = 0; i < P.count; i++) { pos.push(P.getX(i), P.getY(i), P.getZ(i)); nor.push(N.getX(i), N.getY(i), N.getZ(i)); }
        const I = g.getIndex()!;
        for (let i = 0; i < I.count; i++) idx.push(base + I.getX(i));
    }
    LEAF = new THREE.BufferGeometry();
    LEAF.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    LEAF.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    LEAF.setIndex(idx);
    return LEAF;
}

export class Doors {
    readonly list: Door[] = [];
    onHang: ((d: Door) => void) | null = null;
    onToggle: ((d: Door) => void) | null = null;
    onRemove: ((d: Door) => void) | null = null;

    private ghost: TransformNode;
    constructor(private readonly scene: Scene, private building: BuildingSystem, private shadows: boolean) {
        // the placing preview: a see-through green door standing closed in the doorway you aim at
        this.ghost = new TransformNode("doorGhost", scene);
        const leaf = meshFromThree("doorGhostLeaf", leafGeometry(), scene);
        leaf.material = ghostMaterial(scene, "doorGhostMat");
        leaf.position.set(W / 2 + 0.02 - 0.6, H / 2 + 0.01, 0);
        leaf.isPickable = false;
        leaf.parent = this.ghost;
        this.ghost.setEnabled(false);
    }

    /** show where a door would hang (null hides it) */
    showGhost(p: Piece | null) {
        this.ghost.setEnabled(!!p);
        if (p) { this.ghost.position.copyFrom(p.group.position); this.ghost.rotation.copyFrom(p.group.rotation); }
    }

    at(key: string) { return this.list.find((d) => d.key === key); }

    /** the doorway under the crosshair, and its door if it has one */
    target(eye: Vector3, dir: Vector3, reach: number): { piece: Piece; door: Door | undefined; dist: number } | null {
        const h = this.building.findPiece(eye, dir, reach);
        if (!h || h.piece.kind !== "doorway") return null;
        return { piece: h.piece, door: this.at(h.piece.key), dist: h.dist };
    }

    hang(key: string, opts: { open?: boolean; sign?: number; remote?: boolean } = {}): Door | null {
        const p = this.building.pieceByKey(key);
        if (!p || p.kind !== "doorway" || this.at(key)) return null;
        const s = this.scene;
        // the doorway's local frame: x along the wall, origin at the middle of its base
        const group = new TransformNode("door", s);
        group.position.copyFrom(p.group.position);
        group.rotation.copyFrom(p.group.rotation);
        const pivot = new TransformNode("doorPivot", s);
        pivot.parent = group;
        pivot.position.set(-0.6, 0, 0); // hinges on the left post
        const leaf: Mesh = meshFromThree("doorLeaf", leafGeometry(), s);
        leaf.material = woodMaterials(s).slab;
        leaf.parent = pivot;
        leaf.position.set(W / 2 + 0.02, H / 2 + 0.01, 0);
        leaf.receiveShadows = this.shadows;
        if (this.shadows) shadowCasters.add(leaf);
        for (const z of [T / 2 + 0.04, -T / 2 - 0.04]) {
            const h = MeshBuilder.CreateSphere("doorHandle", { diameter: 0.07, segments: 6 }, s);
            h.material = solid(s, "#d8b26a", 0.4, 0.6);
            h.parent = leaf;
            h.position.set(W / 2 - 0.1, 0, z);
            h.isPickable = false;
        }
        // the closed door's collision: the opening itself
        const b = p.hit, ax = p.axis === "x";
        const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
        const box: Box = ax
            ? { x0: cx - 0.6, x1: cx + 0.6, z0: cz - 0.08, z1: cz + 0.08, y0: p.H, y1: p.H + 2.3 }
            : { x0: cx - 0.08, x1: cx + 0.08, z0: cz - 0.6, z1: cz + 0.6, y0: p.H, y1: p.H + 2.3 };
        const d: Door = { key, open: !!opts.open, sign: opts.sign ?? 1, ang: 0, pivot, group, box };
        d.ang = d.open ? (d.sign * Math.PI) / 2 * 0.92 : 0;
        pivot.rotation.y = d.ang;
        if (!d.open) this.building.addBox(box);
        this.list.push(d);
        if (!opts.remote) this.onHang?.(d);
        return d;
    }

    /** open or close; `sign` = which way it swings (away from whoever opens it) */
    set(d: Door, open: boolean, sign: number, remote = false) {
        if (d.open === open) return;
        d.open = open;
        if (open) d.sign = sign;
        if (open) this.building.removeBox(d.box);
        else this.building.addBox(d.box);
        if (!remote) this.onToggle?.(d);
    }

    /** which way a door should swing to open away from someone standing at (x, z) */
    swingFrom(d: Door, x: number, z: number) {
        const p = this.building.pieceByKey(d.key);
        if (!p) return 1;
        const side = p.axis === "x" ? Math.sign(z - p.group.position.z) : Math.sign(x - p.group.position.x);
        return side >= 0 ? 1 : -1;
    }

    remove(d: Door, remote = false) {
        const i = this.list.indexOf(d);
        if (i < 0) return;
        this.list.splice(i, 1);
        this.building.removeBox(d.box);
        for (const m of d.group.getChildMeshes()) shadowCasters.delete(m as Mesh);
        d.group.dispose(false, false);
        if (!remote) this.onRemove?.(d);
    }

    /** the doorway came down */
    wallGone(key: string): Door | null {
        const d = this.at(key);
        if (d) this.remove(d, true);
        return d ?? null;
    }

    update(dt: number) {
        for (const d of this.list) {
            const target = d.open ? (d.sign * Math.PI) / 2 * 0.92 : 0;
            if (Math.abs(target - d.ang) < 1e-3) continue;
            d.ang += Math.sign(target - d.ang) * Math.min(Math.abs(target - d.ang), dt * 3.2);
            d.pivot.rotation.y = d.ang;
        }
    }

    capture() { return this.list.map((d) => [d.key, d.open ? 1 : 0, d.sign]); }
    restore(rows: unknown[] | undefined) {
        for (const d of [...this.list]) this.remove(d, true);
        for (const [key, open, sign] of (rows ?? []) as [string, number, number][]) this.hang(key, { open: !!open, sign, remote: true });
    }
}
