// Pictures in frames, hung on the walls players build. A new one is a blank canvas; open it (E) to paint on it.
// The picture is kept as a small PNG (data URL): that is what is saved with the world and sent to the other players.
// Ported from Castaway: the same logic, drawn with Babylon (the picture is a DynamicTexture over the canvas).
import { Color3, DynamicTexture, Matrix, type Mesh, MeshBuilder, PBRMaterial, type Scene, TransformNode, Vector3 } from "@babylonjs/core";
import * as THREE from "three";
import { meshFromThree } from "../render/geometry";
import { shadowCasters } from "../render/inst";
import { ghostMaterial, setGhostOk, solid } from "../render/materials";
import type { Piece } from "./building";

export const CANVAS_W = 256, CANVAS_H = 192; // pixels (4:3)
export const PAPER = "#f3eee2"; // the colour of an empty canvas (and of the eraser)
const FW = 1.0, FH = 0.78, BORDER = 0.07, DEPTH = 0.045; // frame size in metres
const MAX_DATA = 160_000; // a sanity limit on one picture (PNG, or JPEG for very busy ones)

interface V3 { x: number; y: number; z: number }

export interface Painting {
    nid: string;
    /** the wall piece it hangs on (its key) */
    wall: string;
    x: number; y: number; z: number; yaw: number;
    data: string;
    group: TransformNode;
    canvas: HTMLCanvasElement;
    tex: DynamicTexture;
}
export interface FrameAim { ok: boolean; reason: string; x: number; y: number; z: number; yaw: number; wall: string }

let FRAME_GEO: THREE.BufferGeometry | null = null;
function frameGeometry() {
    if (FRAME_GEO) return FRAME_GEO;
    const parts = [
        new THREE.BoxGeometry(FW, BORDER, DEPTH).translate(0, (FH - BORDER) / 2, DEPTH / 2),
        new THREE.BoxGeometry(FW, BORDER, DEPTH).translate(0, -(FH - BORDER) / 2, DEPTH / 2),
        new THREE.BoxGeometry(BORDER, FH - BORDER * 2, DEPTH).translate((FW - BORDER) / 2, 0, DEPTH / 2),
        new THREE.BoxGeometry(BORDER, FH - BORDER * 2, DEPTH).translate(-(FW - BORDER) / 2, 0, DEPTH / 2),
        new THREE.BoxGeometry(FW - BORDER, FH - BORDER, 0.01).translate(0, 0, 0.005), // the backing board
    ];
    const pos: number[] = [], nor: number[] = [], idx: number[] = [];
    for (const g of parts) {
        const base = pos.length / 3, P = g.getAttribute("position"), N = g.getAttribute("normal");
        for (let i = 0; i < P.count; i++) { pos.push(P.getX(i), P.getY(i), P.getZ(i)); nor.push(N.getX(i), N.getY(i), N.getZ(i)); }
        const I = g.getIndex()!;
        for (let i = 0; i < I.count; i++) idx.push(base + I.getX(i));
    }
    FRAME_GEO = new THREE.BufferGeometry();
    FRAME_GEO.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    FRAME_GEO.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    FRAME_GEO.setIndex(idx);
    return FRAME_GEO;
}

export function blankCanvas() {
    const c = document.createElement("canvas");
    c.width = CANVAS_W;
    c.height = CANVAS_H;
    const x = c.getContext("2d")!;
    x.fillStyle = PAPER;
    x.fillRect(0, 0, CANVAS_W, CANVAS_H);
    return c;
}

export class Paintings {
    readonly list: Painting[] = [];
    idPrefix = "pt";
    private ids = 0;
    private ghost: Mesh;
    private ghostMat;
    onPlace: ((p: Painting) => void) | null = null;
    onRemove: ((p: Painting) => void) | null = null;
    onPaint: ((p: Painting) => void) | null = null;

    constructor(private readonly scene: Scene, private shadows: boolean) {
        this.ghostMat = ghostMaterial(scene, "frameGhost");
        this.ghost = MeshBuilder.CreateBox("frameGhost", { width: FW, height: FH, depth: DEPTH }, scene);
        this.ghost.bakeTransformIntoVertices(Matrix.Translation(0, 0, DEPTH / 2));
        this.ghost.material = this.ghostMat;
        this.ghost.isPickable = false;
        this.ghost.setEnabled(false);
    }

    /** where a frame would hang: on the face of a plain wall (not a doorway or a window), clear of other pictures */
    aim(eye: V3, dir: V3, hit: { piece: Piece; dist: number } | null): FrameAim {
        const no = (reason: string): FrameAim => ({ ok: false, reason, x: 0, y: 0, z: 0, yaw: 0, wall: "" });
        if (!hit) return no("Aim at a wall");
        const p = hit.piece, b = p.hit;
        if (p.kind === "doorway" || p.kind === "window") return no("Not on a doorway or a window: pick a plain wall");
        if (p.kind !== "wall") return no("Pictures hang on walls");
        // the wall's thin direction is its normal; hang on the side you are looking from
        const alongX = b.x1 - b.x0 > b.z1 - b.z0;
        const t = hit.dist;
        let x = eye.x + dir.x * t, y = eye.y + dir.y * t, z = eye.z + dir.z * t, yaw: number;
        if (alongX) {
            const front = eye.z > (b.z0 + b.z1) / 2;
            z = front ? b.z1 : b.z0;
            yaw = front ? 0 : Math.PI;
            x = Math.max(b.x0 + FW / 2 + 0.05, Math.min(b.x1 - FW / 2 - 0.05, x));
        } else {
            const front = eye.x > (b.x0 + b.x1) / 2;
            x = front ? b.x1 : b.x0;
            yaw = front ? Math.PI / 2 : -Math.PI / 2;
            z = Math.max(b.z0 + FW / 2 + 0.05, Math.min(b.z1 - FW / 2 - 0.05, z));
        }
        y = Math.max(b.y0 + FH / 2 + 0.25, Math.min(b.y1 - FH / 2 - 0.1, y));
        for (const q of this.list) {
            if (Math.abs(q.yaw - yaw) > 0.1 && Math.abs(Math.abs(q.yaw - yaw) - Math.PI * 2) > 0.1) continue;
            if (Math.hypot(q.x - x, q.z - z) < FW + 0.02 && Math.abs(q.y - y) < FH + 0.02) return { ok: false, reason: "There is a picture there already", x, y, z, yaw, wall: p.key };
        }
        return { ok: true, reason: "", x, y, z, yaw, wall: p.key };
    }

    showGhost(a: FrameAim | null) {
        if (!a || (!a.ok && !a.wall)) { this.ghost.setEnabled(false); return; }
        this.ghost.setEnabled(true);
        this.ghost.position.set(a.x, a.y, a.z);
        this.ghost.rotation.set(0, a.yaw, 0);
        setGhostOk(this.ghostMat, a.ok);
    }

    place(a: { x: number; y: number; z: number; yaw: number; wall: string }, opts: { nid?: string; data?: string; remote?: boolean } = {}): Painting | null {
        if (opts.nid && this.list.some((q) => q.nid === opts.nid)) return null;
        const s = this.scene;
        const canvas = blankCanvas();
        const tex = new DynamicTexture("painting", canvas, s, true);
        tex.anisotropicFilteringLevel = 4;
        tex.update();
        const g = new TransformNode("painting", s);
        const frame = meshFromThree("frame", frameGeometry(), s);
        frame.material = solid(s, "#7a5230", 0.7);
        frame.parent = g;
        frame.receiveShadows = this.shadows;
        if (this.shadows) shadowCasters.add(frame);
        const pic = MeshBuilder.CreatePlane("picture", { width: FW - BORDER * 2 + 0.01, height: FH - BORDER * 2 + 0.01, sideOrientation: 0 }, s);
        pic.parent = g;
        pic.position.z = 0.012;
        const m = new PBRMaterial("pictureMat", s);
        m.albedoTexture = tex;
        m.emissiveTexture = tex;
        m.emissiveColor = new Color3(0.45, 0.45, 0.45);
        m.roughness = 0.9;
        m.metallic = 0;
        m.backFaceCulling = false;
        pic.material = m;
        pic.receiveShadows = this.shadows;
        g.position.set(a.x, a.y, a.z);
        g.rotation.y = a.yaw;
        const p: Painting = { nid: opts.nid ?? `${this.idPrefix}${Date.now().toString(36)}-${this.ids++}`, wall: a.wall, x: a.x, y: a.y, z: a.z, yaw: a.yaw, data: "", group: g, canvas, tex };
        this.list.push(p);
        if (opts.data) this.setData(p, opts.data, true);
        if (!opts.remote) this.onPlace?.(p);
        return p;
    }

    remove(p: Painting, remote = false) {
        const i = this.list.indexOf(p);
        if (i < 0) return;
        this.list.splice(i, 1);
        for (const m of p.group.getChildMeshes()) shadowCasters.delete(m as Mesh);
        const pic = p.group.getChildMeshes().find((m) => m.name === "picture");
        pic?.material?.dispose();
        p.tex.dispose();
        p.group.dispose(false, false);
        if (!remote) this.onRemove?.(p);
    }

    /** a wall came down: whatever hung on it falls off. Returns the pictures that were on it. */
    wallGone(key: string): Painting[] {
        const gone = this.list.filter((q) => q.wall === key);
        for (const q of gone) this.remove(q, true);
        return gone;
    }

    /** a new picture (a PNG data URL, '' = blank) */
    setData(p: Painting, data: string, remote = false) {
        if (data.length > MAX_DATA || (data && !/^data:image\/(png|jpeg);base64,/.test(data))) return;
        p.data = data;
        const x = p.canvas.getContext("2d")!;
        x.fillStyle = PAPER;
        x.fillRect(0, 0, CANVAS_W, CANVAS_H);
        p.tex.update();
        if (data) {
            const img = new Image();
            img.onload = () => { if (p.data !== data) return; x.drawImage(img, 0, 0, CANVAS_W, CANVAS_H); p.tex.update(); };
            img.src = data;
        }
        if (!remote) this.onPaint?.(p);
    }

    /** the picture refreshes from its canvas (painting straight onto it in VR) */
    refresh(p: Painting) { p.tex.update(); }

    /** the picture you are looking at */
    findTarget(eye: V3, dir: V3, reach: number): { p: Painting; dist: number } | null {
        let best: { p: Painting; dist: number } | null = null;
        for (const p of this.list) {
            const nx = Math.sin(p.yaw), nz = Math.cos(p.yaw);
            const den = dir.x * nx + dir.z * nz;
            if (den > -1e-4) continue; // looking at it from behind
            const t = ((p.x + nx * 0.04 - eye.x) * nx + (p.z + nz * 0.04 - eye.z) * nz) / den;
            if (t < 0 || t > reach) continue;
            const hx = eye.x + dir.x * t - p.x, hy = eye.y + dir.y * t - p.y, hz = eye.z + dir.z * t - p.z;
            const along = hx * Math.cos(p.yaw) - hz * Math.sin(p.yaw);
            if (Math.abs(along) > FW / 2 || Math.abs(hy) > FH / 2) continue;
            if (!best || t < best.dist) best = { p, dist: t };
        }
        return best;
    }

    /** where a ray meets a picture's canvas: canvas pixel coordinates (may lie outside it), distance and the world point */
    canvasHit(p: Painting, o: V3, d: V3): { px: number; py: number; t: number; point: Vector3; inside: boolean } | null {
        const nx = Math.sin(p.yaw), nz = Math.cos(p.yaw), den = d.x * nx + d.z * nz;
        if (den > -1e-4) return null;
        const t = ((p.x + nx * 0.012 - o.x) * nx + (p.z + nz * 0.012 - o.z) * nz) / den;
        if (t < 0) return null;
        const point = new Vector3(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t);
        const hx = point.x - p.x, hy = point.y - p.y, hz = point.z - p.z;
        const along = hx * Math.cos(p.yaw) - hz * Math.sin(p.yaw), W = FW - BORDER * 2, H = FH - BORDER * 2;
        const px = (along / W + 0.5) * CANVAS_W, py = (0.5 - hy / H) * CANVAS_H;
        return { px, py, t, point, inside: px >= 0 && py >= 0 && px < CANVAS_W && py < CANVAS_H };
    }
    /** metres per canvas pixel */
    static readonly PX = (FW - BORDER * 2) / CANVAS_W;

    capture() { return this.list.map((p) => [p.nid, p.wall, +p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3), +p.yaw.toFixed(4), p.data]); }
    restore(rows: unknown[] | undefined) {
        for (const p of [...this.list]) this.remove(p, true);
        for (const [nid, wall, x, y, z, yaw, data] of (rows ?? []) as [string, string, number, number, number, number, string][]) this.place({ x, y, z, yaw, wall }, { nid, data, remote: true });
    }
}
