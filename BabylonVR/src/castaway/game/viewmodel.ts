import type { Scene } from "@babylonjs/core";
import * as THREE from "three";
import { tok } from "../render/bake";
import { ThreeMirror } from "../render/mirror";
import { ViewModel as Hands, type ViewState, VM_LIGHT, tickViewMaterials, setViewSkin as setHandSkin } from "./hands";
import { ITEMS, type ItemId } from "./items";

const T = {
    handle: tok("handle"), steel: tok("steel"), stone: tok("stoneTool"), diamond: tok("diamond"), skin: tok("skin"), sleeve: tok("sleeve"),
    guitar: tok("guitarBody"), rope: tok("rope"), paper: tok("paper"), soot: tok("soot"), flame: tok("flame"), item: tok("item"),
};
/** your skin tone, for the first-person hands */
export function setViewSkin(hex: string) { setHandSkin(hex); }

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
 * First-person hands: Castaway's own two-handed view model (game/hands.ts: skinned hands that grip each tool, elbow-to-wrist
 * arms, the chop, eat, reach, place, drink and swim animations), a three.js rig that follows the Babylon camera and is drawn
 * by a mirror in rendering group 1, so it always shows over the world. The swing's contact moment fires `onHit` (that is
 * when the tree / rock takes the blow), as in Castaway.
 */
export class ViewModel {
    private holder = new THREE.Scene();
    /** a stand-in for the Babylon camera (the hands hang off it in its own space) */
    private cam3 = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 10);
    private vm: Hands;
    private mirror: ThreeMirror;
    private vs: ViewState = { speed: 0, sprinting: false, swimming: false, underwater: false, onGround: true, vy: 0, yawRate: 0, pitchRate: 0, time: 0 };
    private lastYaw = 0;
    private lastPitch = 0;
    private t = 0;
    onHit: (() => void) | null = null;
    get swinging() { return this.vm.swinging; }

    constructor(private readonly scene: Scene, private readonly camera: { getWorldMatrix(): { m: ArrayLike<number> } }) {
        this.cam3.matrixAutoUpdate = false;
        this.holder.add(this.cam3);
        this.vm = new Hands(this.cam3);
        this.vm.onHit = () => this.onHit?.();
        this.mirror = new ThreeMirror(scene, this.holder, null, false, { tag: { keepUnderground: true, viewModel: true }, group: 1 });
    }

    setItem(id: ItemId | null) { this.vm.setItem(id); }
    swing() { this.vm.swing(); }
    reach() { this.vm.reach(); }
    place() { this.vm.place(); }
    eat() { this.vm.eat(); }
    drink(on: boolean) { this.vm.drink(on); }
    visible(v: boolean) { this.vm.visible(v); }

    /** once a frame, after the camera has moved */
    update(dt: number, p: { vel: { x: number; y: number; z: number }; sprinting: boolean; mode: string; underwater: boolean; onGround: boolean; yaw: number; pitch: number }, daylight: number) {
        this.t += dt;
        let dy = p.yaw - this.lastYaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        const vs = this.vs;
        vs.yawRate = dt > 0 ? dy / dt : 0; vs.pitchRate = dt > 0 ? (p.pitch - this.lastPitch) / dt : 0;
        this.lastYaw = p.yaw; this.lastPitch = p.pitch;
        vs.speed = Math.hypot(p.vel.x, p.vel.z); vs.sprinting = p.sprinting;
        vs.swimming = p.mode === "swim"; vs.underwater = p.underwater;
        vs.onGround = p.onGround; vs.vy = p.vel.y; vs.time = this.t;
        VM_LIGHT.value = daylight;
        tickViewMaterials();
        const eng = this.scene.getEngine();
        this.cam3.aspect = eng.getRenderWidth() / Math.max(1, eng.getRenderHeight());
        this.vm.update(dt, vs);
        this.cam3.matrix.fromArray(this.camera.getWorldMatrix().m as unknown as number[]);
        this.cam3.matrixWorldNeedsUpdate = true;
        this.holder.updateMatrixWorld();
        this.mirror.sync();
    }
}
