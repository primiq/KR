import { type Material, type Node, type Scene, TransformNode } from "@babylonjs/core";
import * as THREE from "three";
import { bakeGroup, disposeBaked, tok } from "../render/bake";
import { glow, solid } from "../render/materials";
import { ITEMS, type ItemId } from "./items";

const T = {
    handle: tok("handle"), steel: tok("steel"), stone: tok("stoneTool"), diamond: tok("diamond"), skin: tok("skin"), sleeve: tok("sleeve"),
    guitar: tok("guitarBody"), rope: tok("rope"), paper: tok("paper"), soot: tok("soot"), flame: tok("flame"), item: tok("item"),
};
let viewSkin = "#d9a07a";
/** your skin tone, for the first-person hands (takes effect when the held model is next built) */
export function setViewSkin(hex: string) { viewSkin = hex; }
function mat(scene: Scene, key: string, itemColor: string): Material {
    switch (key) {
        case "handle": return solid(scene, "#8b5e34", 0.85);
        case "steel": return solid(scene, "#aeb6bd", 0.3, 0.9);
        case "stoneTool": return solid(scene, "#8e8a82", 0.9);
        case "diamond": return solid(scene, "#7ff4ff", 0.08, 0.2);
        case "skin": return solid(scene, viewSkin, 0.6);
        case "sleeve": return solid(scene, "#3f6f8a", 0.9);
        case "rope": return solid(scene, "#b8a470", 1);
        case "guitarBody": return solid(scene, "#c98a43", 0.55);
        case "paper": return solid(scene, "#3b73a8", 0.8);
        case "soot": return solid(scene, "#0d0b0a", 1);
        case "flame": return glow(scene, "#ffb14a");
        default: return solid(scene, itemColor, 0.85);
    }
}

const m = (g: THREE.BufferGeometry, t: THREE.Material, x = 0, y = 0, z = 0) => {
    const o = new THREE.Mesh(g, t);
    o.position.set(x, y, z);
    return o;
};

/** A hand-held model for an item, in grip space: the grip at the origin, the business end along +y. */
export function heldModel(id: ItemId): THREE.Group {
    const g = new THREE.Group();
    const def = ITEMS[id];
    const head = id.startsWith("diamond") ? T.diamond : id.startsWith("metal") ? T.steel : T.stone;
    const model = def.tool?.model;
    if (model === "rock") g.add(m(new THREE.IcosahedronGeometry(0.075, 1).scale(1, 0.8, 1), T.stone, 0, 0.04, 0));
    else if (model === "hatchet") {
        g.add(m(new THREE.CylinderGeometry(0.016, 0.02, 0.5, 7), T.handle, 0, 0.18, 0));
        g.add(m(new THREE.BoxGeometry(0.03, 0.09, 0.15).translate(0, 0, 0.06), head, 0, 0.38, 0));
        g.add(m(new THREE.CylinderGeometry(0.024, 0.024, 0.05, 7), T.rope, 0, 0.36, 0));
    } else if (model === "pickaxe") {
        g.add(m(new THREE.CylinderGeometry(0.016, 0.02, 0.56, 7), T.handle, 0, 0.2, 0));
        const pick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.03, 0.42, 6).rotateX(Math.PI / 2), head);
        pick.position.set(0, 0.44, 0);
        g.add(pick);
    } else if (model === "spear") {
        g.add(m(new THREE.CylinderGeometry(0.014, 0.016, 1.5, 6), T.handle, 0, 0.3, 0));
        g.add(m(new THREE.ConeGeometry(0.03, 0.14, 5), T.stone, 0, 1.12, 0));
    } else if (model === "rod") {
        g.add(m(new THREE.CylinderGeometry(0.008, 0.016, 1.4, 6), T.handle, 0, 0.6, 0));
    } else if (id === "torch") {
        g.add(m(new THREE.CylinderGeometry(0.022, 0.03, 0.55, 7), T.handle, 0, 0.18, 0));
        g.add(m(new THREE.CylinderGeometry(0.045, 0.035, 0.1, 8), T.soot, 0, 0.47, 0));
        const f = m(new THREE.ConeGeometry(0.05, 0.16, 8), T.flame, 0, 0.6, 0);
        g.add(f);
    } else if (id === "guitar") {
        // neck along +y (held at the nut end), the top facing -z, the body hanging below: two bouts, a sound hole, strings
        const bout = (r: number, y: number) => m(new THREE.CylinderGeometry(r, r, 0.07, 20).rotateX(Math.PI / 2), T.guitar, 0, y, 0);
        g.add(bout(0.165, -0.68), bout(0.125, -0.45));
        g.add(m(new THREE.CylinderGeometry(0.042, 0.042, 0.004, 16).rotateX(Math.PI / 2), T.soot, 0, -0.5, -0.037));
        g.add(m(new THREE.BoxGeometry(0.046, 0.5, 0.026), T.handle, 0, -0.1, -0.022));
        g.add(m(new THREE.BoxGeometry(0.06, 0.13, 0.016), T.soot, 0, 0.215, -0.02));
        g.add(m(new THREE.BoxGeometry(0.04, 0.88, 0.003), T.steel, 0, -0.29, -0.047));
    } else if (id === "building_plan") {
        g.add(m(new THREE.CylinderGeometry(0.035, 0.035, 0.3, 10).rotateZ(Math.PI / 2), T.paper, 0, 0.02, 0));
    } else {
        // anything else: a small lump in the item's colour
        g.add(m(new THREE.IcosahedronGeometry(0.06, 1), T.item, 0, 0.05, 0));
    }
    return g;
}

export const ITEM_COLOR: Partial<Record<ItemId, string>> = {
    coconut: "#5b3c22", berries: "#c9253d", wood: "#8a5a30", stone: "#9b9a94", metal_ore: "#b5703c", fiber: "#b4c46a", metal: "#bcc4cb",
    roasted_coconut: "#9a6030", raw_meat: "#b8434d", cooked_meat: "#7a4422", raw_fish: "#7fb0cc", cooked_fish: "#c58a4e", coal: "#1c1d21", diamond: "#7ff4ff",
};

/**
 * First-person hands: the held item at the bottom right of the screen, swinging when you use a tool. The swing's
 * contact moment fires `onHit` (that is when the tree / rock takes the blow), as in Castaway.
 */
export class ViewModel {
    readonly root: TransformNode;
    private pivot: TransformNode;
    private held: TransformNode | null = null;
    private heldId: ItemId | null = null;
    private swingT = -1;
    private hitDone = false;
    private reachT = -1;
    private eatT = -1;
    private bob = 0;
    onHit: (() => void) | null = null;
    get swinging() { return this.swingT >= 0; }

    constructor(private readonly scene: Scene, parent: Node) {
        this.root = new TransformNode("viewmodel", scene);
        this.root.parent = parent;
        this.root.position.set(0.28, -0.3, -0.5);
        this.pivot = new TransformNode("vmPivot", scene);
        this.pivot.parent = this.root;
        // forearm
        const arm = new THREE.Group();
        arm.add(m(new THREE.BoxGeometry(0.07, 0.07, 0.34).translate(0, 0, 0.2), T.sleeve, 0, -0.02, 0));
        arm.add(m(new THREE.BoxGeometry(0.06, 0.06, 0.09).translate(0, 0, 0.03), T.skin, 0, 0, 0));
        const a = bakeGroup("arm", arm, scene, (k) => mat(scene, k, "#ffffff"), false).node;
        a.parent = this.pivot;
        for (const mm of a.getChildMeshes()) mm.renderingGroupId = 1;
    }

    setItem(id: ItemId | null) {
        if (id === this.heldId) return;
        this.heldId = id;
        if (this.held) disposeBaked(this.held);
        this.held = null;
        if (!id) return;
        const color = ITEM_COLOR[id] ?? "#cfc6b4";
        const b = bakeGroup(`held_${id}`, heldModel(id), this.scene, (k) => mat(this.scene, k, color), false);
        this.held = b.node;
        this.held.parent = this.pivot;
        this.held.rotation.set(-0.35, 0, -0.15);
        for (const mm of this.held.getChildMeshes()) mm.renderingGroupId = 1;
    }

    swing() { this.swingT = 0; this.hitDone = false; }
    reach() { this.reachT = 0; }
    place() { this.reachT = 0; }
    eat() { this.eatT = 0; }
    visible(v: boolean) { this.root.setEnabled(v); }

    update(dt: number, speed: number) {
        this.bob += dt * speed * 2.2;
        let rx = 0, ry = 0, rz = 0, px = 0, py = Math.sin(this.bob * 2) * 0.012 * Math.min(1, speed / 4), pz = 0;
        if (this.swingT >= 0) {
            this.swingT += dt;
            const D = 0.42, u = this.swingT / D;
            // wind up, chop down, recover
            const k = u < 0.35 ? -Math.sin((u / 0.35) * Math.PI * 0.5) * 0.9 : u < 0.55 ? -0.9 + ((u - 0.35) / 0.2) * 2.3 : 1.4 * (1 - (u - 0.55) / 0.45);
            rx = -k * 0.9;
            ry = k * 0.25;
            pz = -Math.max(0, k) * 0.08;
            if (!this.hitDone && u >= 0.52) { this.hitDone = true; this.onHit?.(); }
            if (u >= 1) this.swingT = -1;
        }
        if (this.reachT >= 0) {
            this.reachT += dt;
            const u = this.reachT / 0.35;
            pz -= Math.sin(Math.min(1, u) * Math.PI) * 0.18;
            py -= Math.sin(Math.min(1, u) * Math.PI) * 0.05;
            if (u >= 1) this.reachT = -1;
        }
        if (this.eatT >= 0) {
            this.eatT += dt;
            const u = this.eatT / 0.8;
            px -= Math.sin(Math.min(1, u) * Math.PI) * 0.2;
            py += Math.sin(Math.min(1, u) * Math.PI) * 0.18;
            rz += Math.sin(Math.min(1, u) * Math.PI) * 0.6;
            if (u >= 1) this.eatT = -1;
        }
        this.pivot.position.set(px, py, pz);
        this.pivot.rotation.set(rx, ry, rz);
    }
}
