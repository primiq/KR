// Painting in VR. The picture on the wall is the canvas: point the right controller at it and pull the trigger to paint
// (squeeze harder for a thicker line). The palette rides above the right hand, clear of the hand and of the wrist panel: point
// the LEFT controller at it and pull the left trigger to pick a tool, a colour (16 swatches, plus a rainbow bar and a shade bar
// for any colour), the brush size, undo, clear, cancel or save. (One controller only: the palette hangs beside the picture.)
// Right stick up / down: brush size. B: undo. A: brush <-> eraser.
// Babylon port of Castaway's vr/paintvr.ts: the palette is a plane with a DynamicTexture over its canvas.
import { Color3, Constants, DynamicTexture, Matrix, type Mesh, MeshBuilder, type LinesMesh, type Scene, StandardMaterial, type TransformNode, Vector3 } from "@babylonjs/core";
import * as THREE from "three";
import { floodFill, strokeLine } from "../game/brush";
import { CANVAS_H, CANVAS_W, PAPER, type Painting, Paintings } from "../game/paintings";
import { SWATCHES, type Tool } from "../ui/painter";

const PW = 512, PH = 400;                // palette texture
const PAL_W = 0.3, PAL_H = PAL_W * PH / PW;
const SIZE_MIN = 1, SIZE_MAX = 48;

interface Btn { x: number; y: number; w: number; h: number; act: (u: number, v: number) => void }
type V3 = { x: number; y: number; z: number };
export interface PaintInput {
    /** the right controller's pointing ray (world): the brush */
    o: V3; d: V3;
    /** the left controller's ray and trigger: picks from the palette (null with one controller: the brush ray does it) */
    po: V3 | null; pd: V3 | null; pickDown: boolean;
    /** trigger 0..1, and whether it was just pulled */
    trig: number; trigDown: boolean;
    undo: boolean; swap: boolean;
    stick: number;
    dt: number;
    haptic: (s: number) => void;
}

const hsl = (h: number, s: number, l: number) => "#" + new THREE.Color().setHSL(h, s, l).getHexString();

export class VRPaint {
    active = false;
    private p: Painting | null = null;
    private paintings: Paintings | null = null;
    private done: ((data: string | null) => void) | null = null;
    private tool: Tool = "brush";
    private size = 8;
    private color = "#111111";
    private hue = 0.6;
    private undo: ImageData[] = [];
    private last: [number, number] | null = null;
    private dirty = false;
    private buzz = 0;
    private flash = "";
    private flashT = 0;
    // the palette
    private pal: Mesh;
    private palCanvas = document.createElement("canvas");
    private palTex: DynamicTexture;
    private btns: Btn[] = [];
    private palDirty = true;
    // the brush cursor on the canvas, and the pointer lines
    private ring: Mesh;
    private ringMat: StandardMaterial;
    private line: LinesMesh;
    private pickLine: LinesMesh;
    private hover = -1;

    constructor(scene: Scene) {
        this.palCanvas.width = PW; this.palCanvas.height = PH;
        this.palTex = new DynamicTexture("vrPalette", this.palCanvas, scene, true);
        const m = new StandardMaterial("vrPaletteMat", scene);
        m.disableLighting = true;
        m.emissiveTexture = this.palTex;
        m.backFaceCulling = false;
        // (drawn on top, like the wrist panel: the hands never hide it)
        m.depthFunction = Constants.ALWAYS;
        this.pal = MeshBuilder.CreatePlane("vrPalette", { width: PAL_W, height: PAL_H }, scene);
        this.pal.material = m;
        this.pal.renderingGroupId = 1;
        this.pal.isPickable = false;
        this.pal.setEnabled(false);
        this.ringMat = new StandardMaterial("vrBrushRing", scene);
        this.ringMat.disableLighting = true;
        this.ringMat.alpha = 0.9;
        this.ringMat.depthFunction = Constants.ALWAYS;
        this.ringMat.backFaceCulling = false;
        this.ring = MeshBuilder.CreateTorus("vrBrushRing", { diameter: 1.82, thickness: 0.18, tessellation: 24 }, scene);
        this.ring.scaling.y = 0.05;
        this.ring.material = this.ringMat;
        this.ring.renderingGroupId = 1;
        this.ring.isPickable = false;
        this.ring.setEnabled(false);
        const mk = (name: string, c: Color3) => {
            const l = MeshBuilder.CreateLines(name, { points: [Vector3.Zero(), new Vector3(0, 0, -1)], updatable: true }, scene);
            l.color = c; l.alpha = 0.65; l.isPickable = false; l.setEnabled(false);
            return l;
        };
        this.line = mk("vrBrushLine", new Color3(1, 1, 1));
        this.pickLine = mk("vrPickLine", Color3.FromHexString("#ffd23f"));
    }

    start(p: Painting, paintings: Paintings, hold: TransformNode | null, done: (data: string | null) => void) {
        this.p = p; this.paintings = paintings; this.done = done; this.active = true;
        this.undo = []; this.last = null; this.palDirty = true;
        // the palette floats well above the back of the right hand (so the hand never covers it), tilted towards the eyes; with
        // only one controller it hangs beside the picture instead
        if (hold) {
            this.pal.parent = hold;
            this.pal.position.set(0, 0.2, -0.04);
            this.pal.rotation.set(-Math.PI / 2 + 0.55, 0, 0);
            this.pal.scaling.setAll(1);
        } else {
            this.pal.parent = p.group;
            this.pal.position.set(-0.85, 0, 0.05);
            this.pal.rotation.set(0, 0, 0);
            this.pal.scaling.setAll(1.6);
        }
        this.pal.setEnabled(true);
    }

    private finish(save: boolean) {
        if (!this.active || !this.p) return;
        const p = this.p;
        let data: string | null = null;
        if (save) { data = p.canvas.toDataURL("image/png"); if (data.length > 120_000) data = p.canvas.toDataURL("image/jpeg", 0.85); }
        this.active = false; this.p = null;
        this.pal.parent = null; this.pal.setEnabled(false);
        this.ring.setEnabled(false); this.line.setEnabled(false); this.pickLine.setEnabled(false);
        const d = this.done; this.done = null;
        d?.(data);
    }
    /** closed from outside (the picture went away, the headset came off): nothing is saved */
    cancel() { this.finish(false); }

    private ctx() { return this.p!.canvas.getContext("2d", { willReadFrequently: true })!; }
    private snap() { this.undo.push(this.ctx().getImageData(0, 0, CANVAS_W, CANVAS_H)); if (this.undo.length > 20) this.undo.shift(); }
    private doUndo() { const d = this.undo.pop(); if (d) { this.ctx().putImageData(d, 0, 0); this.dirty = true; this.say("Undone"); } }
    private say(t: string) { this.flash = t; this.flashT = 1.2; this.palDirty = true; }

    /** where a ray meets the palette, in palette pixels (null: it misses) */
    private palHit(o: V3, d: V3): { u: number; v: number; point: Vector3 } | null {
        if (!this.pal.isEnabled()) return null;
        const wm = this.pal.computeWorldMatrix(true), inv = Matrix.Invert(wm);
        const lo = Vector3.TransformCoordinates(new Vector3(o.x, o.y, o.z), inv);
        const ld = Vector3.TransformNormal(new Vector3(d.x, d.y, d.z), inv);
        if (Math.abs(ld.z) < 1e-6) return null;
        const t = -lo.z / ld.z;
        if (t < 0) return null;
        const lx = lo.x + ld.x * t, ly = lo.y + ld.y * t;
        if (Math.abs(lx) > PAL_W / 2 || Math.abs(ly) > PAL_H / 2) return null;
        // the world distance: the palette's scale is in the matrix, so measure it there
        const point = Vector3.TransformCoordinates(new Vector3(lx, ly, 0), wm);
        if (Vector3.Distance(point, new Vector3(o.x, o.y, o.z)) > 3) return null;
        return { u: (lx / PAL_W + 0.5) * PW, v: (0.5 - ly / PAL_H) * PH, point };
    }

    update(i: PaintInput) {
        const p = this.p;
        if (!this.active || !p) return;
        if (!this.paintings!.list.includes(p)) { this.finish(false); return; }
        // right stick: brush size
        if (Math.abs(i.stick) > 0.3) { const ns = Math.max(SIZE_MIN, Math.min(SIZE_MAX, this.size - i.stick * i.dt * 30)); if (Math.round(ns) !== Math.round(this.size)) this.palDirty = true; this.size = ns; }
        if (i.undo) this.doUndo();
        if (i.swap) { this.tool = this.tool === "eraser" ? "brush" : "eraser"; this.palDirty = true; i.haptic(0.15); }
        if (this.flashT > 0) { this.flashT -= i.dt; if (this.flashT <= 0) { this.flash = ""; this.palDirty = true; } }

        // the palette: picked with the left hand's ray (or, with one controller, with the brush ray, which then doesn't paint)
        const two = !!(i.po && i.pd);
        const ph = this.palHit(two ? i.po! : i.o, two ? i.pd! : i.d);
        let hov = -1;
        if (ph) {
            hov = this.btns.findIndex((b) => ph.u >= b.x && ph.u <= b.x + b.w && ph.v >= b.y && ph.v <= b.y + b.h);
            if ((two ? i.pickDown : i.trigDown) && hov >= 0) { const b = this.btns[hov]; b.act((ph.u - b.x) / b.w, (ph.v - b.y) / b.h); i.haptic(0.3); this.palDirty = true; }
            this.showLine(two ? i.po! : i.o, ph.point, two ? this.pickLine : this.line);
            if (!two) { this.ring.setEnabled(false); this.last = null; }
        } else this.pickLine.setEnabled(false);
        if (hov !== this.hover) { this.hover = hov; this.palDirty = true; }
        if (this.active && (two || !ph)) {
            const h = this.paintings!.canvasHit(p, i.o, i.d);
            if (h && h.t < 4 && h.px > -20 && h.py > -20 && h.px < CANVAS_W + 20 && h.py < CANVAS_H + 20) {
                this.showLine(i.o, h.point);
                // the cursor: a ring the size of the brush, in its colour
                const r = Math.max(0.006, (this.size * (this.tool === "bucket" ? 0.3 : 0.5)) * Paintings.PX);
                this.ring.setEnabled(true);
                this.ring.position.set(h.point.x + Math.sin(p.yaw) * 0.004, h.point.y, h.point.z + Math.cos(p.yaw) * 0.004);
                this.ring.rotation.set(Math.PI / 2, p.yaw, 0);
                this.ring.scaling.set(r, r * 0.05, r);
                this.ringMat.emissiveColor = Color3.FromHexString(this.tool === "eraser" ? "#888888" : this.color);
                if (this.tool === "bucket") { if (i.trigDown && h.inside) { this.snap(); floodFill(this.ctx(), h.px, h.py, this.color); this.dirty = true; i.haptic(0.4); } }
                else if (i.trig > 0.12) {
                    if (!this.last) this.snap();
                    const w = this.size * (0.35 + 0.65 * Math.min(1, i.trig));
                    const [x0, y0] = this.last ?? [h.px, h.py];
                    strokeLine(this.ctx(), x0, y0, h.px, h.py, this.tool === "eraser" ? PAPER : this.color, w);
                    this.last = [h.px, h.py]; this.dirty = true;
                    this.buzz -= i.dt; if (this.buzz <= 0) { this.buzz = 0.09; i.haptic(0.06 + 0.1 * i.trig); }
                } else this.last = null;
            } else { this.ring.setEnabled(false); this.line.setEnabled(false); this.last = null; }
        }
        if (this.dirty && this.p) { this.paintings!.refresh(this.p); this.dirty = false; }
        if (this.palDirty && this.active) this.drawPalette();
    }

    private showLine(o: V3, to: V3, line = this.line) {
        MeshBuilder.CreateLines(line.name, { points: [new Vector3(o.x, o.y, o.z), new Vector3(to.x, to.y, to.z)], instance: line });
        line.setEnabled(true);
    }

    // ------------------------------------------------------------------ the palette
    private drawPalette() {
        this.palDirty = false;
        const c = this.palCanvas.getContext("2d")!, B: Btn[] = (this.btns = []);
        const btn = (x: number, y: number, w: number, h: number, act: Btn["act"]) => { B.push({ x, y, w, h, act }); return B.length - 1 === this.hover; };
        c.fillStyle = "#2b2118"; c.fillRect(0, 0, PW, PH);
        c.strokeStyle = "#7a5230"; c.lineWidth = 8; c.strokeRect(4, 4, PW - 8, PH - 8);
        c.textBaseline = "middle"; c.font = "bold 22px system-ui,sans-serif"; c.fillStyle = "#f3eee2";
        c.fillText(this.flash || "Paint with the right trigger", 18, 28);
        // current colour and size
        c.fillStyle = this.tool === "eraser" ? PAPER : this.color; c.beginPath(); c.arc(PW - 40, 28, Math.max(4, Math.min(18, this.size / 2.4)), 0, 7); c.fill();
        c.strokeStyle = "#fff"; c.lineWidth = 2; c.stroke();
        // tools
        const tools: [Tool, string][] = [["brush", "Brush"], ["eraser", "Eraser"], ["bucket", "Bucket"]];
        tools.forEach(([t, label], k) => {
            const x = 14 + k * 162, y = 52, on = this.tool === t, hv = btn(x, y, 154, 46, () => { this.tool = t; });
            c.fillStyle = on ? "#ffd23f" : hv ? "#fff7d6" : "#f3eee2"; c.fillRect(x, y, 154, 46);
            c.fillStyle = "#2b2118"; c.font = "bold 22px system-ui,sans-serif"; c.fillText(label, x + 20, y + 24);
        });
        // swatches
        SWATCHES.forEach((col, k) => {
            const x = 16 + (k % 8) * 61, y = 110 + Math.floor(k / 8) * 52, hv = btn(x, y, 54, 46, () => { this.color = col; if (this.tool === "eraser") this.tool = "brush"; });
            c.fillStyle = col; c.fillRect(x, y, 54, 46);
            if (col === this.color || hv) { c.strokeStyle = col === this.color ? "#ffd23f" : "#fff"; c.lineWidth = 5; c.strokeRect(x + 2, y + 2, 50, 42); }
        });
        // any colour: a rainbow bar (hue) and a shade bar for that hue (dark to light)
        const ry = 216, sy = 252;
        for (let x = 0; x < 480; x += 4) { c.fillStyle = hsl(x / 480, 0.85, 0.5); c.fillRect(16 + x, ry, 4, 28); }
        btn(16, ry, 480, 28, (u) => { this.hue = u; this.color = hsl(u, 0.85, 0.5); if (this.tool === "eraser") this.tool = "brush"; });
        for (let x = 0; x < 480; x += 4) { c.fillStyle = hsl(this.hue, 0.85, 0.06 + (x / 480) * 0.9); c.fillRect(16 + x, sy, 4, 28); }
        btn(16, sy, 480, 28, (u) => { this.color = hsl(this.hue, 0.85, 0.06 + u * 0.9); if (this.tool === "eraser") this.tool = "brush"; });
        // brush size: - [bar] +
        const zy = 290;
        const hm = btn(16, zy, 46, 40, () => { this.size = Math.max(SIZE_MIN, this.size - 3); });
        const hp = btn(450, zy, 46, 40, () => { this.size = Math.min(SIZE_MAX, this.size + 3); });
        btn(70, zy, 372, 40, (u) => { this.size = SIZE_MIN + u * (SIZE_MAX - SIZE_MIN); });
        for (const [x, t, hv] of [[16, "−", hm], [450, "+", hp]] as const) { c.fillStyle = hv ? "#fff7d6" : "#f3eee2"; c.fillRect(x, zy, 46, 40); c.fillStyle = "#2b2118"; c.font = "bold 30px system-ui,sans-serif"; c.fillText(t, x + 14, zy + 21); }
        c.fillStyle = "#4a3a2a"; c.fillRect(70, zy + 14, 372, 12);
        c.fillStyle = "#ffd23f"; c.fillRect(70, zy + 14, 372 * (this.size - SIZE_MIN) / (SIZE_MAX - SIZE_MIN), 12);
        c.fillStyle = "#f3eee2"; c.font = "18px system-ui,sans-serif"; c.fillText(`size ${Math.round(this.size)}`, 220, zy + 2);
        // actions
        const acts: [string, string, () => void][] = [
            ["Undo", "#f3eee2", () => this.doUndo()],
            ["Clear", "#c94a3a", () => { this.snap(); const x = this.ctx(); x.fillStyle = PAPER; x.fillRect(0, 0, CANVAS_W, CANVAS_H); this.dirty = true; this.say("Cleared (Undo brings it back)"); }],
            ["Cancel", "#f3eee2", () => this.finish(false)],
            ["Save", "#4caf3a", () => this.finish(true)],
        ];
        acts.forEach(([label, col, act], k) => {
            const x = 14 + k * 122, y = 342, hv = btn(x, y, 114, 46, act);
            c.fillStyle = hv ? "#fff7d6" : col; c.fillRect(x, y, 114, 46);
            c.fillStyle = col === "#f3eee2" || hv ? "#2b2118" : "#ffffff"; c.font = "bold 22px system-ui,sans-serif"; c.fillText(label, x + 18, y + 24);
        });
        this.palTex.update();
    }
}
