// The "Customise character" screen: a turntable preview of your castaway with a pair of arrows for each part. Ported from
// Castaway. It has its own small Babylon engine so it can be used from the front menu, before the island exists; the engine
// is created when the screen opens and thrown away when it closes. The rig is Castaway's three.js model, drawn by a ThreeMirror.
import { Color3, Color4, DirectionalLight, Engine, HemisphericLight, MeshBuilder, PBRMaterial, Scene, UniversalCamera, Vector3 } from "@babylonjs/core";
import * as THREE from "three";
import { setPref } from "../core/prefs";
import { cycleSlot, getOutfit, lookFromOutfit, myDisplayName, onOutfitChange, randomOutfit, SLOTS } from "../net/outfit";
import { buildPlayer, makeNamePlate } from "../net/playerModel";
import { ThreeMirror } from "../render/mirror";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

class Preview {
    private engine: Engine;
    private scene: Scene;
    private camera: UniversalCamera;
    private holder = new THREE.Scene();
    private turn = new THREE.Group();
    private rig: THREE.Group | null = null;
    private mirror: ThreeMirror;
    private spin = 0; private drag = 0; private t = 0;
    private dragging = false; private lastX = 0;
    private ro: ResizeObserver;

    constructor(private canvas: HTMLCanvasElement) {
        this.engine = new Engine(canvas, true, { alpha: true, premultipliedAlpha: false }, true);
        const s = (this.scene = new Scene(this.engine));
        s.useRightHandedSystem = true;
        s.clearColor = new Color4(0, 0, 0, 0);
        s.imageProcessingConfiguration.toneMappingEnabled = true;
        s.imageProcessingConfiguration.toneMappingType = 1; // ACES
        s.imageProcessingConfiguration.exposure = 0.9;
        const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), s);
        hemi.intensity = 1.5;
        hemi.groundColor = Color3.FromHexString("#4a6a5a");
        const sun = new DirectionalLight("sun", new Vector3(-2.5, -3.5, -4).normalize(), s);
        sun.diffuse = Color3.FromHexString("#fff0dc");
        sun.intensity = 2.4;
        const disc = MeshBuilder.CreateCylinder("disc", { diameterTop: 1.24, diameterBottom: 1.32, height: 0.05, tessellation: 40 }, s);
        disc.position.y = -0.025;
        const dm = new PBRMaterial("disc", s);
        dm.albedoColor = Color3.FromHexString("#16424f").toLinearSpace();
        dm.roughness = 0.9; dm.metallic = 0;
        disc.material = dm;
        this.camera = new UniversalCamera("cam", new Vector3(0, 1.05, 3.5), s);
        this.camera.setTarget(new Vector3(0, 0.9, 0));
        this.camera.minZ = 0.1;
        this.holder.add(this.turn);
        this.mirror = new ThreeMirror(s, this.holder, null, false);
        canvas.addEventListener("pointerdown", (e) => { this.dragging = true; this.lastX = e.clientX; canvas.setPointerCapture(e.pointerId); });
        canvas.addEventListener("pointermove", (e) => { if (this.dragging) { this.drag += (e.clientX - this.lastX) * 0.012; this.lastX = e.clientX; } });
        const up = () => { this.dragging = false; };
        canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up);
        this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(canvas);
        this.resize(); this.rebuild();
        this.engine.runRenderLoop(() => this.frame());
    }

    private resize() {
        this.engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 2));
        this.engine.resize();
        const w = this.canvas.clientWidth || 300, h = this.canvas.clientHeight || 400;
        // a short, wide view still has to fit a whole person
        this.camera.fov = (32 * Math.max(1, 0.72 / (w / h)) * Math.PI) / 180;
    }

    /** build the character again from the current choice */
    rebuild() {
        this.disposeRig();
        const R = buildPlayer(lookFromOutfit(getOutfit(), 0), false);
        R.thighs.forEach((t) => t.scale.set(1.14, 1, 1.14)); R.shoulders.forEach((t) => t.scale.set(1.1, 1, 1.1));
        R.head.scale.setScalar(1.1); R.body.scale.set(1.05, 1, 1.07);
        R.body.add(makeNamePlate(myDisplayName()));
        // a relaxed stance
        R.shoulders.forEach((s, i) => { s.rotation.z = (i ? 1 : -1) * 0.1; });
        R.elbows.forEach((e) => { e.rotation.x = 0.18; });
        this.rig = R.rig; this.turn.add(R.rig);
    }

    private disposeRig() {
        if (!this.rig) return;
        this.turn.remove(this.rig); this.rig = null;
    }

    private frame() {
        const dt = Math.min(0.05, this.engine.getDeltaTime() / 1000);
        this.t += dt;
        if (!this.dragging) this.drag *= Math.pow(0.35, dt);             // settles back to facing you
        this.spin = Math.PI + Math.sin(this.t * 0.6) * 0.45 + this.drag;     // the character faces -Z, the camera is on +Z
        this.turn.rotation.y = this.spin;
        if (this.rig) this.rig.position.y = Math.sin(this.t * 1.6) * 0.004;
        this.holder.updateMatrixWorld();
        this.mirror.sync();
        this.scene.render();
    }

    dispose() {
        this.ro.disconnect(); this.disposeRig();
        this.engine.stopRenderLoop();
        this.scene.dispose();
        this.engine.dispose();
    }
}

let nameLocked = false;
/** once a game is running a name can no longer change (it is part of the room), but the look still can */
export function setNameLocked(on: boolean) {
    nameLocked = on;
    $<HTMLInputElement>("cz-name").disabled = on; $("cz-note").classList.toggle("hidden", !on);
}

export function setupCustomise() {
    const rows = $("cz-rows");
    const vals: HTMLElement[] = [];
    SLOTS.forEach((s, i) => {
        const row = document.createElement("div"); row.className = "cz-row";
        const label = document.createElement("span"); label.textContent = s.label;
        const prev = document.createElement("button"); prev.type = "button"; prev.textContent = "◀"; prev.setAttribute("aria-label", `Previous ${s.label}`);
        const next = document.createElement("button"); next.type = "button"; next.textContent = "▶"; next.setAttribute("aria-label", `Next ${s.label}`);
        const val = document.createElement("div"); val.className = "cz-val"; vals.push(val);
        prev.addEventListener("click", () => cycleSlot(i, -1)); next.addEventListener("click", () => cycleSlot(i, 1));
        row.append(label, prev, val, next); rows.append(row);
    });
    const refresh = () => {
        const o = getOutfit();
        SLOTS.forEach((s, i) => {
            const v = vals[i]; v.textContent = "";
            if (s.colors) { const sw = document.createElement("i"); sw.style.background = s.colors[o[i]]; v.append(sw); } else v.textContent = s.names![o[i]];
        });
    };
    let preview: Preview | null = null;
    onOutfitChange(() => { refresh(); preview?.rebuild(); });
    refresh();

    const nameEl = $<HTMLInputElement>("cz-name"), mpName = $<HTMLInputElement>("mp-name");
    nameEl.value = mpName.value;
    nameEl.addEventListener("input", () => { if (nameLocked) return; mpName.value = nameEl.value; setPref("name", nameEl.value.trim()); preview?.rebuild(); });
    mpName.addEventListener("input", () => { nameEl.value = mpName.value; });

    $("customise").addEventListener("click", () => {
        nameEl.value = mpName.value;
        $("menu").classList.add("hidden"); $("custom").classList.remove("hidden");
        // a fresh canvas each time: a disposed engine leaves its GL context behind
        const old = $<HTMLCanvasElement>("cz-canvas"), fresh = old.cloneNode(false) as HTMLCanvasElement; old.replaceWith(fresh);
        try { preview = new Preview(fresh); } catch (e) { console.warn("character preview unavailable", e); }
    });
    $("cz-random").addEventListener("click", () => randomOutfit());
    $("cz-done").addEventListener("click", () => {
        preview?.dispose(); preview = null;
        $("custom").classList.add("hidden"); $("menu").classList.remove("hidden");
    });
}
