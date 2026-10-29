import { Color3, DynamicTexture, Mesh, MeshBuilder, Quaternion, type Scene, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";
import { heldModel, ITEM_COLOR } from "../game/viewmodel";
import { ITEMS, type ItemId } from "../game/items";
import { bakeGroup, disposeBaked } from "../render/bake";
import { shadowCasters } from "../render/inst";
import { glow, solid } from "../render/materials";
import { heightAt } from "../world/island";
import type { PlayerInfo, PState } from "./session";

const SHIRTS = ["#e85d4a", "#3c8dde", "#f2c14e", "#5ac36a", "#b46ad8", "#ff8a3d", "#3fc4c4", "#e86aa8"];
/** each player's colour (shirt, name plate, map dot, ping) */
export const playerColor = (id: number) => SHIRTS[((id % SHIRTS.length) + SHIRTS.length) % SHIRTS.length];

const SKIN = "#d9a07a", PANTS = "#3b4a5a", HAIR = "#3a2618";

interface Av {
    id: number;
    name: string;
    root: TransformNode;
    hips: TransformNode;
    torso: TransformNode;
    head: TransformNode;
    arm: [TransformNode, TransformNode];
    fore: [TransformNode, TransformNode];
    leg: [TransformNode, TransformNode];
    hand: TransformNode;
    vrHands: [Mesh, Mesh];
    plate: Mesh;
    bubble: Mesh | null;
    bubbleT: number;
    held: TransformNode | null;
    heldId: string;
    x: number; y: number; z: number; yaw: number;
    phase: number;
    swing: number;
    swingT: number;
    lastSwing: number;
    stepAcc: number;
    meshes: Mesh[];
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const angLerp = (a: number, b: number, t: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

/**
 * The other players: a simple jointed castaway in their shirt colour, walking, running, swimming and swinging the
 * tool they hold, with a floating name. Players in a headset show their real head and hand movement.
 */
export class Avatars {
    readonly positions: { id: number; name: string; x: number; y: number; z: number }[] = [];
    private avs = new Map<number, Av>();
    private pings: { mesh: Mesh; t: number }[] = [];
    onStep: ((x: number, y: number, z: number) => void) | null = null;
    /** sea surface for swimmers */
    surfaceAt: (x: number, z: number) => number = () => 0;

    constructor(private readonly scene: Scene, private readonly shadows: boolean) {}

    private limb(name: string, parent: TransformNode, len: number, r: number, color: string, meshes: Mesh[]): TransformNode {
        const pivot = new TransformNode(name, this.scene);
        pivot.parent = parent;
        const m = MeshBuilder.CreateCapsule(`${name}M`, { height: len, radius: r, tessellation: 8, subdivisions: 1 }, this.scene);
        m.parent = pivot;
        m.position.y = -len / 2;
        m.material = solid(this.scene, color, 0.85);
        meshes.push(m);
        return pivot;
    }

    private build(id: number, name: string): Av {
        const s = this.scene, meshes: Mesh[] = [];
        const root = new TransformNode(`av${id}`, s);
        const hips = new TransformNode("hips", s);
        hips.parent = root;
        hips.position.y = 0.95;
        const torso = new TransformNode("torso", s);
        torso.parent = hips;
        const body = MeshBuilder.CreateCapsule("body", { height: 0.68, radius: 0.19, tessellation: 10 }, s);
        body.parent = torso;
        body.position.y = 0.3;
        body.scaling.set(1.1, 1, 0.75);
        body.material = solid(s, playerColor(id), 0.8);
        meshes.push(body);
        const head = new TransformNode("head", s);
        head.parent = torso;
        head.position.y = 0.72;
        const skull = MeshBuilder.CreateSphere("skull", { diameter: 0.27, segments: 12 }, s);
        skull.parent = head;
        skull.position.y = 0.06;
        skull.material = solid(s, SKIN, 0.6);
        const hair = MeshBuilder.CreateSphere("hair", { diameter: 0.285, segments: 10, slice: 0.55 }, s);
        hair.parent = head;
        hair.position.set(0, 0.075, 0.01);
        hair.material = solid(s, HAIR, 0.9);
        for (const sx of [-1, 1]) {
            const eye = MeshBuilder.CreateSphere("eye", { diameter: 0.035, segments: 6 }, s);
            eye.parent = head;
            eye.position.set(sx * 0.05, 0.08, -0.125);
            eye.material = solid(s, "#1a1a1a", 0.3);
            meshes.push(eye);
        }
        meshes.push(skull, hair);
        const arm: [TransformNode, TransformNode] = [null!, null!], fore: [TransformNode, TransformNode] = [null!, null!], leg: [TransformNode, TransformNode] = [null!, null!];
        for (const i of [0, 1]) {
            const sx = i === 0 ? -1 : 1;
            arm[i] = this.limb("arm", torso, 0.3, 0.06, playerColor(id), meshes);
            arm[i].position.set(sx * 0.26, 0.58, 0);
            fore[i] = this.limb("fore", arm[i], 0.28, 0.05, SKIN, meshes);
            fore[i].position.y = -0.3;
            leg[i] = this.limb("leg", hips, 0.85, 0.075, PANTS, meshes);
            leg[i].position.set(sx * 0.11, 0, 0);
        }
        const hand = new TransformNode("hand", s);
        hand.parent = fore[1];
        hand.position.y = -0.3;
        const vrHands = [0, 1].map(() => {
            const m = MeshBuilder.CreateBox("vrHand", { width: 0.07, height: 0.04, depth: 0.12 }, s);
            m.material = solid(s, SKIN, 0.6);
            m.setEnabled(false);
            m.rotationQuaternion = new Quaternion();
            return m;
        }) as [Mesh, Mesh];
        // name plate
        const plate = MeshBuilder.CreatePlane("plate", { width: 0.9, height: 0.22 }, s);
        const tex = new DynamicTexture("plateTex", { width: 512, height: 128 }, s, true);
        const ctx = tex.getContext() as CanvasRenderingContext2D;
        ctx.fillStyle = "rgba(0,0,0,0.45)";
        ctx.beginPath();
        ctx.roundRect(4, 14, 504, 100, 40);
        ctx.fill();
        ctx.font = "bold 64px sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = playerColor(id);
        ctx.fillText(name, 256, 86);
        tex.update();
        tex.hasAlpha = true;
        const pm = new StandardMaterial("plateMat", s);
        pm.diffuseTexture = tex;
        pm.emissiveColor = Color3.White();
        pm.disableLighting = true;
        pm.useAlphaFromDiffuseTexture = true;
        pm.backFaceCulling = false;
        plate.material = pm;
        plate.parent = root;
        plate.position.y = 2.15;
        plate.billboardMode = Mesh.BILLBOARDMODE_ALL;
        plate.isPickable = false;
        for (const m of meshes) {
            m.isPickable = false;
            m.receiveShadows = true;
            if (this.shadows) shadowCasters.add(m);
        }
        return { id, name, root, hips, torso, head, arm, fore, leg, hand, vrHands, plate, bubble: null, bubbleT: 0, held: null, heldId: "", x: 0, y: 0, z: 0, yaw: 0, phase: 0, swing: 0, swingT: -1, lastSwing: -1, stepAcc: 0, meshes };
    }

    private setHeld(a: Av, id: string) {
        if (id === a.heldId) return;
        a.heldId = id;
        if (a.held) disposeBaked(a.held);
        a.held = null;
        if (!id || !(id in ITEMS)) return;
        const color = ITEM_COLOR[id as ItemId] ?? "#cfc6b4";
        const b = bakeGroup(`avHeld_${id}`, heldModel(id as ItemId), this.scene, (k) => {
            if (k === "flame") return glow(this.scene, "#ffb14a");
            const map: Record<string, [string, number, number]> = { handle: ["#8b5e34", 0.85, 0], steel: ["#aeb6bd", 0.3, 0.9], stoneTool: ["#8e8a82", 0.9, 0], diamond: ["#7ff4ff", 0.08, 0.2], rope: ["#b8a470", 1, 0], paper: ["#3b73a8", 0.8, 0], soot: ["#0d0b0a", 1, 0] };
            const m = map[k] ?? [color, 0.85, 0];
            return solid(this.scene, m[0], m[1], m[2]);
        }, false);
        a.held = b.node;
        a.held.parent = a.hand;
        a.held.rotation.set(Math.PI / 2, 0, 0);
    }

    say(id: number, text: string) {
        const a = this.avs.get(id);
        if (!a) return;
        a.bubble?.dispose(false, true);
        const s = this.scene;
        const b = MeshBuilder.CreatePlane("bubble", { width: 1.6, height: 0.5 }, s);
        const tex = new DynamicTexture("bubbleTex", { width: 768, height: 240 }, s, true);
        const ctx = tex.getContext() as CanvasRenderingContext2D;
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.beginPath();
        ctx.roundRect(8, 8, 752, 224, 50);
        ctx.fill();
        ctx.fillStyle = "#1c2a30";
        ctx.font = "bold 52px sans-serif";
        ctx.textAlign = "center";
        const words = text.slice(0, 90).split(" ");
        const lines: string[] = [];
        let line = "";
        for (const w of words) { if (ctx.measureText(`${line} ${w}`).width > 700) { lines.push(line); line = w; } else line = line ? `${line} ${w}` : w; }
        lines.push(line);
        lines.slice(0, 3).forEach((l, i, arr) => ctx.fillText(l, 384, 120 - (arr.length - 1) * 30 + i * 60 + 18));
        tex.update();
        tex.hasAlpha = true;
        const m = new StandardMaterial("bubbleMat", s);
        m.diffuseTexture = tex;
        m.emissiveColor = Color3.White();
        m.disableLighting = true;
        m.useAlphaFromDiffuseTexture = true;
        b.material = m;
        b.parent = a.root;
        b.position.y = 2.6;
        b.billboardMode = Mesh.BILLBOARDMODE_ALL;
        a.bubble = b;
        a.bubbleT = 6 + text.length * 0.05;
    }

    /** a beacon of light where someone pinged */
    addPing(x: number, z: number, color: string) {
        const m = MeshBuilder.CreateCylinder("ping", { height: 40, diameterTop: 0.25, diameterBottom: 0.6, tessellation: 12 }, this.scene);
        m.position.set(x, heightAt(x, z) + 20, z);
        m.material = glow(this.scene, color, 0.45);
        m.isPickable = false;
        this.pings.push({ mesh: m, t: 20 });
    }

    clear() {
        for (const a of this.avs.values()) this.remove(a);
        this.avs.clear();
        this.positions.length = 0;
    }

    private remove(a: Av) {
        for (const m of a.meshes) shadowCasters.delete(m);
        if (a.held) disposeBaked(a.held);
        a.vrHands.forEach((h) => h.dispose());
        a.root.dispose(false, true);
    }

    sync(players: Map<number, PlayerInfo>, states: Map<number, PState>, myId: number, dt: number, _me: Vector3) {
        for (const [id, a] of this.avs) if (!players.has(id) || !states.has(id)) { this.remove(a); this.avs.delete(id); }
        this.positions.length = 0;
        for (const [id, st] of states) {
            if (id === myId) continue;
            const info = players.get(id);
            if (!info) continue;
            let a = this.avs.get(id);
            if (!a) {
                a = this.build(id, info.name);
                a.x = st.x; a.y = st.y; a.z = st.z; a.yaw = st.yaw;
                a.lastSwing = st.swing;
                this.avs.set(id, a);
            }
            this.animate(a, st, dt);
            this.positions.push({ id, name: a.name, x: a.x, y: a.y, z: a.z });
        }
        for (let i = this.pings.length - 1; i >= 0; i--) {
            const p = this.pings[i];
            p.t -= dt;
            p.mesh.visibility = Math.min(1, p.t / 3);
            if (p.t <= 0) { p.mesh.dispose(); this.pings.splice(i, 1); }
        }
    }

    private animate(a: Av, st: PState, dt: number) {
        // smooth toward the latest packet (12 a second), so movement stays fluid between them
        const k = 1 - Math.exp(-dt * 14);
        const jump = Math.hypot(st.x - a.x, st.z - a.z) > 8;
        a.x = jump ? st.x : lerp(a.x, st.x, k);
        a.y = jump ? st.y : lerp(a.y, st.y, k);
        a.z = jump ? st.z : lerp(a.z, st.z, k);
        a.yaw = angLerp(a.yaw, st.yaw, k);
        a.root.position.set(a.x, a.y, a.z);
        a.root.rotation.y = a.yaw;
        const swim = (st.flags & 2) !== 0, dead = (st.flags & 4) !== 0, asleep = (st.flags & 8) !== 0;
        const spd = st.spd;
        a.phase += dt * spd * 2.6;
        if (spd > 0.6 && !swim) {
            a.stepAcc += spd * dt;
            if (a.stepAcc > 1.9) { a.stepAcc = 0; this.onStep?.(a.x, a.y, a.z); }
        }
        if (st.swing !== a.lastSwing) { a.lastSwing = st.swing; a.swingT = 0; }
        this.setHeld(a, st.item);

        const run = Math.min(1, spd / 6), sw = Math.sin(a.phase), amp = Math.min(1, spd / 3) * (0.5 + 0.3 * run);
        let armR = -sw * amp * 0.9, armL = sw * amp * 0.9, foreR = -0.25 - run * 0.4, foreL = -0.25 - run * 0.4;
        let legR = sw * amp, legL = -sw * amp, bodyX = run * 0.12, hipsY = 0.95 + Math.abs(Math.cos(a.phase)) * 0.04 * amp;
        if (a.swingT >= 0) {
            a.swingT += dt;
            const u = a.swingT / 0.42;
            const kk = u < 0.35 ? -Math.sin((u / 0.35) * Math.PI * 0.5) : u < 0.55 ? -1 + ((u - 0.35) / 0.2) * 2.2 : 1.2 * (1 - (u - 0.55) / 0.45);
            armR = -2.0 - kk * 1.1;
            foreR = -0.3;
            if (u >= 1) a.swingT = -1;
        } else if (st.item) {
            armR = Math.min(armR, -0.35);
            foreR = -0.9;
        }
        let rootPitch = 0;
        if (swim) {
            rootPitch = -1.25;
            armR = -2.6 + sw * 0.9;
            armL = -2.6 - sw * 0.9;
            legR = sw * 0.3;
            legL = -sw * 0.3;
            hipsY = 0.2;
            a.root.position.y = Math.max(a.y, this.surfaceAt(a.x, a.z) - 1.25);
        }
        if (dead || asleep) {
            rootPitch = asleep ? 0 : 0;
            a.root.rotation.z = 0;
            a.hips.rotation.x = -Math.PI / 2;
            hipsY = 0.18;
            armR = armL = -0.2;
            legR = legL = 0;
        } else a.hips.rotation.x = rootPitch;
        a.hips.position.y = hipsY;
        a.torso.rotation.x = bodyX;
        a.arm[1].rotation.x = armR;
        a.arm[0].rotation.x = armL;
        a.fore[1].rotation.x = foreR;
        a.fore[0].rotation.x = foreL;
        a.leg[1].rotation.x = legR;
        a.leg[0].rotation.x = legL;
        a.head.rotation.x = -st.pitch * 0.6;
        // VR players: their real head and hands
        const v = st.v;
        if (v && !dead) {
            const h = v.h;
            a.head.rotation.set(-h[4], 0, h[5]);
            a.head.parent = a.torso;
            a.vrHands.forEach((m, i) => {
                const hd = i === 0 ? v.r : v.l;
                m.setEnabled(!!hd);
                if (!hd) return;
                m.position.set(a.x + hd[0], a.y + hd[1], a.z + hd[2]);
                m.rotationQuaternion!.set(hd[3], hd[4], hd[5], hd[6]);
            });
            if (v.r) { a.arm[1].rotation.x = -1.2; a.fore[1].rotation.x = -0.4; }
        } else a.vrHands.forEach((m) => m.setEnabled(false));
        if (a.bubble) {
            a.bubbleT -= dt;
            if (a.bubbleT <= 0) { a.bubble.dispose(false, true); a.bubble = null; }
        }
        void Vector3;
    }
}
