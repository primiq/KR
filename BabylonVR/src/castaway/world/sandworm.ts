// The sand worm. Far out in the dunes (never near the oasis) the ground now and then starts to churn: sand swirls round
// a spot some way ahead of you, the ground rumbles, and a huge ringed worm bursts out, arcs high over the dunes with its
// jaws open, and dives back into the sand further on, its body pouring in after it. Then the sand settles again.
// Whoever's player is out there starts one (main.ts) and tells everybody, so the others out there see the same worm.
import { Color3, Color4, DynamicTexture, Matrix, Mesh, MeshBuilder, ParticleSystem, PBRMaterial, Quaternion, type Scene, Texture, TransformNode, Vector3 } from "@babylonjs/core";
import { DESERT_X, DESERT_Z, desertHeight } from "./desertField";

/** how far from the oasis the worms live (m), and how long between them out there (s) */
export const WORM_FROM = 320;
const GAP_MIN = 70, GAP_MAX = 160;
/** the worm: segments, their spacing (m), its girth (m), how fast it moves along its arc (m/s) */
const SEGS = 44, SPACING = 1.7, R = 3.5, SPEED = 19;
/** the swirl comes this long before the worm breaks out (s) */
const LEAD = 3.4;
/** the arc runs on under the sand from u = U0 to 1 - U0 (0 and 1 are the two holes) */
const U0 = -0.14;

export interface WormStart { ax: number; az: number; bx: number; bz: number; h: number }

export class SandWorm {
    /** a worm started here: tell the others (main.ts) */
    onStart: ((w: WormStart) => void) | null = null;
    /** sounds and a shake, by how close it is (0..1) */
    sfx: { rumble(dur: number, v: number): void; roar(v: number): void; dive(v: number): void } | null = null;
    shake: ((k: number) => void) | null = null;
    private next = GAP_MIN * 0.6 + Math.random() * 40;
    private t = -1;
    private w: WormStart | null = null;
    /** the arc, sampled: positions and the distance along it of each sample */
    private pts: Vector3[] = [];
    private len: number[] = [];
    private total = 0;
    private body: Mesh;
    private head: TransformNode;
    private jaws: TransformNode[] = [];
    private mats: Float32Array;
    private swirlA: ParticleSystem;
    private swirlB: ParticleSystem;
    private sprayA: ParticleSystem;
    private sprayB: ParticleSystem;
    private roared = false;
    private dived = false;

    constructor(private readonly scene: Scene) {
        // ---- the skin: sandy hide in rings, darker grooves between them
        const tex = new DynamicTexture("wormSkin", { width: 64, height: 256 }, scene, true);
        const g = tex.getContext() as CanvasRenderingContext2D;
        const grd = g.createLinearGradient(0, 0, 0, 256);
        grd.addColorStop(0, "#5b4229"); grd.addColorStop(0.12, "#a07a4c"); grd.addColorStop(0.5, "#c49a62"); grd.addColorStop(0.88, "#a07a4c"); grd.addColorStop(1, "#5b4229");
        g.fillStyle = grd; g.fillRect(0, 0, 64, 256);
        for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(${60 + Math.random() * 40},${40 + Math.random() * 30},20,${0.12 + Math.random() * 0.15})`; g.fillRect(Math.random() * 64, Math.random() * 256, 2 + Math.random() * 4, 1 + Math.random() * 3); }
        tex.update();
        tex.wrapU = Texture.WRAP_ADDRESSMODE; tex.wrapV = Texture.WRAP_ADDRESSMODE;
        const skin = new PBRMaterial("wormSkinMat", scene);
        skin.albedoTexture = tex; skin.metallic = 0; skin.roughness = 0.75; skin.albedoColor = new Color3(1, 1, 1);
        // ---- the body: one ringed segment drawn many times (thin instances), each placed along the arc every frame
        const seg = MeshBuilder.CreateCylinder("wormSeg", { height: SPACING * 1.08, diameterTop: 1.92, diameterBottom: 2, tessellation: 18, subdivisions: 1 }, scene);
        seg.material = skin; seg.isPickable = false; seg.alwaysSelectAsActiveMesh = true;
        this.mats = new Float32Array(16 * SEGS);
        for (let i = 0; i < SEGS; i++) for (const k of [0, 5, 10, 15]) this.mats[i * 16 + k] = 1;
        seg.thinInstanceSetBuffer("matrix", this.mats, 16, false);
        seg.setEnabled(false);
        this.body = seg;
        // ---- the head: a blunt armoured collar and three jaw plates that open like petals round a dark, toothed maw
        this.head = new TransformNode("wormHead", scene);
        const collar = MeshBuilder.CreateCylinder("wormCollar", { height: 1.6, diameterTop: 2.15 * R, diameterBottom: 2 * R, tessellation: 20 }, scene);
        collar.material = skin; collar.parent = this.head; collar.isPickable = false;
        const maw = MeshBuilder.CreateDisc("wormMaw", { radius: R * 0.95, tessellation: 20 }, scene);
        const mawM = new PBRMaterial("wormMawMat", scene); mawM.albedoColor = new Color3(0.12, 0.02, 0.03); mawM.metallic = 0; mawM.roughness = 0.6;
        mawM.emissiveColor = new Color3(0.08, 0.01, 0.01);
        maw.material = mawM; maw.parent = this.head; maw.rotation.x = -Math.PI / 2; maw.position.y = 0.78; maw.isPickable = false;
        const toothM = new PBRMaterial("wormToothMat", scene); toothM.albedoColor = new Color3(0.92, 0.88, 0.76); toothM.metallic = 0; toothM.roughness = 0.4;
        const tooth = MeshBuilder.CreateCylinder("wormTooth", { height: 0.9, diameterTop: 0, diameterBottom: 0.3, tessellation: 6 }, scene);
        tooth.material = toothM; tooth.isPickable = false; tooth.parent = this.head;
        const tm: number[] = [];
        for (let ring = 0; ring < 3; ring++) {
            const n = 14 - ring * 3, rr = R * (0.85 - ring * 0.22);
            for (let i = 0; i < n; i++) {
                const a = (i / n) * Math.PI * 2 + ring * 0.3;
                // (the teeth point inward and down the throat)
                const m = Matrix.Compose(new Vector3(1, 1, 1), Quaternion.RotationYawPitchRoll(-a, 0, 0).multiply(Quaternion.RotationAxis(new Vector3(1, 0, 0), Math.PI / 2 + 0.6)), new Vector3(Math.cos(a) * rr, 0.6 - ring * 0.25, Math.sin(a) * rr));
                tm.push(...m.toArray());
            }
        }
        tooth.thinInstanceSetBuffer("matrix", new Float32Array(tm), 16, true);
        for (let k = 0; k < 3; k++) {
            const hinge = new TransformNode(`wormJawH${k}`, scene); hinge.parent = this.head;
            const a = (k / 3) * Math.PI * 2;
            hinge.position.set(Math.cos(a) * R * 0.98, 0.75, Math.sin(a) * R * 0.98);
            hinge.rotation.y = -a;
            const plate = MeshBuilder.CreateCylinder(`wormJaw${k}`, { height: R * 1.9, diameterTop: 0.15, diameterBottom: R * 1.55, tessellation: 3, arc: 1 }, scene);
            plate.scaling.set(1, 1, 0.32);
            plate.material = skin; plate.parent = hinge; plate.position.set(-R * 0.25, R * 0.9, 0); plate.isPickable = false;
            // (a long fang on the tip of each plate, curving in)
            const spike = MeshBuilder.CreateCylinder(`wormJawT${k}`, { height: 1.4, diameterTop: 0, diameterBottom: 0.42, tessellation: 6 }, scene);
            spike.material = toothM; spike.parent = hinge; spike.position.set(-R * 0.5, R * 1.7, 0); spike.rotation.z = 0.9; spike.isPickable = false;
            this.jaws.push(hinge);
        }
        for (const m of this.head.getChildMeshes()) { m.alwaysSelectAsActiveMesh = true; }
        this.head.setEnabled(false);
        // ---- sand: a swirl round each hole before and after, and a spray where the body breaks the surface
        const puff = new DynamicTexture("wormPuff", { width: 64, height: 64 }, scene, false);
        { const c = puff.getContext() as CanvasRenderingContext2D; const rg = c.createRadialGradient(32, 32, 0, 32, 32, 32); rg.addColorStop(0, "rgba(255,255,255,0.95)"); rg.addColorStop(0.5, "rgba(255,255,255,0.5)"); rg.addColorStop(1, "rgba(255,255,255,0)"); c.fillStyle = rg; c.fillRect(0, 0, 64, 64); puff.update(); puff.hasAlpha = true; }
        this.swirlA = this.swirl(puff); this.swirlB = this.swirl(puff);
        this.sprayA = this.spray(puff); this.sprayB = this.spray(puff);
    }

    /** sand spiralling in round a hole and lifting off it */
    private swirl(tex: Texture) {
        const ps = new ParticleSystem("wormSwirl", 900, this.scene);
        ps.particleTexture = tex; ps.emitter = new Vector3(0, -1000, 0);
        ps.minLifeTime = 1.6; ps.maxLifeTime = 2.8; ps.minSize = 1.2; ps.maxSize = 3.4;
        ps.minEmitPower = 1; ps.maxEmitPower = 1; ps.emitRate = 0;
        ps.color1 = new Color4(0.86, 0.72, 0.52, 0.55); ps.color2 = new Color4(0.78, 0.64, 0.45, 0.45); ps.colorDead = new Color4(0.75, 0.62, 0.45, 0);
        ps.minAngularSpeed = -2; ps.maxAngularSpeed = 2;
        ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
        // (born on a ring, moving round it and a little in and up: a whirlpool of sand)
        ps.startPositionFunction = (wm, pos) => {
            const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 6.5;
            Vector3.TransformCoordinatesFromFloatsToRef(Math.cos(a) * r, Math.random() * 0.6, Math.sin(a) * r, wm, pos);
        };
        ps.startDirectionFunction = (_wm, dir, p) => {
            const e = ps.emitter as Vector3, dx = p.position.x - e.x, dz = p.position.z - e.z, r = Math.hypot(dx, dz) || 1;
            const sp = 7 + Math.random() * 4;
            dir.set((-dz / r) * sp - (dx / r) * 2.2, 1.2 + Math.random() * 2.8, (dx / r) * sp - (dz / r) * 2.2);
        };
        ps.gravity = new Vector3(0, -0.6, 0);
        ps.start();
        return ps;
    }
    /** sand thrown up where the body breaks through */
    private spray(tex: Texture) {
        const ps = new ParticleSystem("wormSpray", 1200, this.scene);
        ps.particleTexture = tex; ps.emitter = new Vector3(0, -1000, 0);
        ps.minEmitBox = new Vector3(-R * 1.4, 0, -R * 1.4); ps.maxEmitBox = new Vector3(R * 1.4, 0.5, R * 1.4);
        ps.direction1 = new Vector3(-5, 9, -5); ps.direction2 = new Vector3(5, 17, 5);
        ps.minEmitPower = 1; ps.maxEmitPower = 1.4;
        ps.minLifeTime = 1.2; ps.maxLifeTime = 2.6; ps.minSize = 1.0; ps.maxSize = 3.2;
        ps.color1 = new Color4(0.88, 0.74, 0.54, 0.75); ps.color2 = new Color4(0.8, 0.66, 0.47, 0.6); ps.colorDead = new Color4(0.78, 0.64, 0.46, 0);
        ps.gravity = new Vector3(0, -9, 0); ps.emitRate = 0;
        ps.minAngularSpeed = -1.5; ps.maxAngularSpeed = 1.5;
        ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
        ps.start();
        return ps;
    }

    /** is a worm out now */
    get busy() { return this.t >= 0; }

    /** start one (from here or another player): sand churns at A, the worm leaps from A to B */
    begin(w: WormStart) {
        this.w = w; this.t = 0; this.roared = false; this.dived = false;
        // the arc: out of the ground at A, `h` metres up at the top, back in at B; it carries on under the sand both ends
        // (so the whole body comes out of the hole and goes back into the other one)
        const N = 160, gA = desertHeight(w.ax, w.az), gB = desertHeight(w.bx, w.bz);
        this.pts = []; this.len = [];
        let tot = 0;
        for (let i = 0; i <= N; i++) {
            const u = U0 + ((1 - 2 * U0) * i) / N;
            const x = w.ax + (w.bx - w.ax) * u, z = w.az + (w.bz - w.az) * u;
            const base = gA + (gB - gA) * Math.max(0, Math.min(1, u));
            const p = new Vector3(x, base + w.h * 4 * u * (1 - u), z);
            if (i) tot += Vector3.Distance(p, this.pts[i - 1]);
            this.pts.push(p); this.len.push(tot);
        }
        this.total = tot;
        (this.swirlA.emitter as Vector3).set(w.ax, gA, w.az);
        (this.swirlB.emitter as Vector3).set(w.bx, gB, w.bz);
        (this.sprayA.emitter as Vector3).set(w.ax, gA, w.az);
        (this.sprayB.emitter as Vector3).set(w.bx, gB, w.bz);
        this.body.setEnabled(true); this.head.setEnabled(true);
    }

    /** a point on the arc `s` metres along, and which way it heads */
    private at(s: number, pos: Vector3, dir: Vector3) {
        const L = this.len, n = L.length;
        if (s <= 0) { pos.copyFrom(this.pts[0]); this.pts[1].subtractToRef(this.pts[0], dir); dir.normalize(); return; }
        if (s >= this.total) { pos.copyFrom(this.pts[n - 1]); this.pts[n - 1].subtractToRef(this.pts[n - 2], dir); dir.normalize(); return; }
        let lo = 0, hi = n - 1;
        while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L[m] < s) lo = m; else hi = m; }
        const k = (s - L[lo]) / (L[hi] - L[lo] || 1);
        Vector3.LerpToRef(this.pts[lo], this.pts[hi], k, pos);
        this.pts[hi].subtractToRef(this.pts[lo], dir); dir.normalize();
    }

    /**
     * Every frame. `me`: where you are; `out`: you are out in the open desert (not in a cave); `look`: which way you face.
     * Starts a worm now and then while you are far from the oasis.
     */
    update(dt: number, me: Vector3, out: boolean, look: Vector3) {
        const far = out && Math.hypot(me.x - DESERT_X, me.z - DESERT_Z) > WORM_FROM;
        if (!this.busy && far) {
            this.next -= dt;
            if (this.next <= 0) {
                this.next = GAP_MIN + Math.random() * (GAP_MAX - GAP_MIN);
                // somewhere ahead of you (give or take), across your view, so you see it side on
                let fx = look.x, fz = look.z; const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
                const turn = (Math.random() - 0.5) * 1.3, c = Math.cos(turn), s = Math.sin(turn);
                [fx, fz] = [fx * c - fz * s, fx * s + fz * c];
                const d = 42 + Math.random() * 22, half = 22 + Math.random() * 10, side = Math.random() < 0.5 ? -1 : 1;
                const mx = me.x + fx * d, mz = me.z + fz * d;
                const w: WormStart = { ax: mx - fz * half * side, az: mz + fx * half * side, bx: mx + fz * half * side, bz: mz - fx * half * side, h: 20 + Math.random() * 10 };
                this.begin(w);
                this.onStart?.(w);
            }
        }
        if (!this.busy || !this.w) { this.swirlA.emitRate = this.swirlB.emitRate = this.sprayA.emitRate = this.sprayB.emitRate = 0; return; }
        const w = this.w;
        this.t += dt;
        const dA = Math.hypot(me.x - w.ax, me.z - w.az), near = Math.max(0, 1 - dA / 160);
        if (this.t - dt <= 0) { this.sfx?.rumble(LEAD + 1.5, 0.5 * near); }
        // the swirls: A churns up before the worm, B as it dives and a while after
        const run = this.t - LEAD; // seconds since the head broke out
        const headS = run * SPEED, uA = this.len[Math.round((-U0 / (1 - 2 * U0)) * 160)], uB = this.len[Math.round(((1 - U0) / (1 - 2 * U0)) * 160)];
        const tailS = headS - SEGS * SPACING;
        this.swirlA.emitRate = (this.t < LEAD + 0.6 ? Math.min(1, this.t / 1.2) : tailS < uA ? 0.6 : Math.max(0, 0.6 - (tailS - uA) / 20)) * 260;
        const intoB = headS > uB - 25;
        this.swirlB.emitRate = intoB ? (tailS < uB + 6 ? 220 : Math.max(0, 220 - (tailS - uB) * 12)) : 0;
        // the sprays: wherever the body crosses the surface
        this.sprayA.emitRate = headS > uA && tailS < uA ? 420 : 0;
        this.sprayB.emitRate = headS > uB && tailS < uB ? 420 : 0;
        if (!this.roared && headS > uA) { this.roared = true; this.sfx?.roar(near); this.shake?.(0.6 * near); }
        if (!this.dived && headS > uB) { this.dived = true; const nb = Math.max(0, 1 - Math.hypot(me.x - w.bx, me.z - w.bz) / 160); this.sfx?.dive(nb); this.shake?.(0.45 * nb); }
        // the body: every segment trails the head along the arc
        const pos = _p, dir = _d, q = _q, sc = _s;
        for (let i = 0; i < SEGS; i++) {
            const s = headS - (i + 1) * SPACING;
            this.at(s, pos, dir);
            const k = i / (SEGS - 1), taper = i < 3 ? 0.98 : 1 - 0.62 * k * k;
            Quaternion.FromUnitVectorsToRef(Vector3.UpReadOnly, dir, q);
            sc.set(R * taper, 1, R * taper);
            Matrix.ComposeToRef(sc, q, pos, _m);
            _m.copyToArray(this.mats, i * 16);
        }
        this.body.thinInstanceBufferUpdated("matrix");
        this.at(headS, pos, dir);
        this.head.position.copyFrom(pos);
        if (!this.head.rotationQuaternion) this.head.rotationQuaternion = new Quaternion();
        Quaternion.FromUnitVectorsToRef(Vector3.UpReadOnly, dir, this.head.rotationQuaternion);
        // the jaws gape while it flies, and snap shut as it dives
        const open = headS < uA ? 0.25 : headS > uB - 4 ? Math.max(0, 0.9 - (headS - (uB - 4)) * 0.25) : 0.9 + Math.sin(this.t * 3) * 0.08;
        for (const j of this.jaws) j.rotation.z = 0.45 - open * 1.25;
        // all of it back under the sand, and the sand settled: done
        if (tailS > this.total - 2 && this.t > LEAD + 2) {
            this.t = -1; this.w = null;
            this.body.setEnabled(false); this.head.setEnabled(false);
        }
    }
}

const _p = new Vector3(), _d = new Vector3(), _q = new Quaternion(), _s = new Vector3(), _m = new Matrix();
