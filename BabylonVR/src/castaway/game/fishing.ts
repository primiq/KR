import { Color3, type Camera, type LinesMesh, Mesh, MeshBuilder, type Scene, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";
import { heightAt } from "../world/island";

export type FishState = "idle" | "cast" | "wait" | "bite";

export interface FishEvents {
    message: (m: string) => void;
    splash: (x: number, y: number, z: number, n: number) => void;
    sound: (what: "cast" | "plop" | "bite" | "reel" | "lost") => void;
    caught: (n: number) => void;
    prompt: (text: string | null) => void;
}

const N = 14;
/** Castaway's fishing, ported: cast / wait / bite / reel. The float and line live in the world; the rod is the held item. */
export class Fishing {
    state: FishState = "idle";
    private t = 0;
    private biteAt = 0;
    private window = 0;
    private from = new Vector3();
    private to = new Vector3();
    private pos = new Vector3();
    private bobber: TransformNode;
    /** the sea's height under the float (the Gerstner swell): it rides the waves instead of sitting at sea level */
    surface: (x: number, z: number) => number = () => 0;
    private line: LinesMesh;
    private pts: Vector3[] = Array.from({ length: N }, () => new Vector3());
    private tip = new Vector3();
    private clock = 0;
    private reel = 0;
    /** VR: where the rod tip is in the world (replaces the point in front of the camera) */
    tipOverride: Vector3 | null = null;

    constructor(private readonly scene: Scene, private readonly camera: () => Camera, private ev: FishEvents) {
        const flat = (hex: string) => {
            const m = new StandardMaterial(`bob${hex}`, scene);
            m.disableLighting = true;
            m.emissiveColor = Color3.FromHexString(hex);
            return m;
        };
        this.bobber = new TransformNode("bobber", scene);
        this.bobber.metadata = { keepUnderground: true };
        const top = MeshBuilder.CreateSphere("bobTop", { diameter: 0.09, segments: 8, slice: 0.5 }, scene);
        top.material = flat("#ff3b3b");
        const bot = MeshBuilder.CreateSphere("bobBot", { diameter: 0.09, segments: 8, slice: 0.5 }, scene);
        bot.rotation.x = Math.PI;
        bot.material = flat("#fffaf0");
        const stem = MeshBuilder.CreateCylinder("bobStem", { diameter: 0.012, height: 0.1, tessellation: 5 }, scene);
        stem.position.y = 0.09;
        stem.material = flat("#ffffff");
        for (const m of [top, bot, stem]) { m.parent = this.bobber; m.isPickable = false; }
        this.bobber.setEnabled(false);
        this.line = MeshBuilder.CreateLines("fishLine", { points: this.pts, updatable: true }, scene);
        this.line.color = Color3.FromHexString("#f4f1e6");
        this.line.alpha = 0.85;
        this.line.isPickable = false;
        this.line.alwaysSelectAsActiveMesh = true;
        this.line.setEnabled(false);
        void Mesh;
    }

    get active() { return this.state !== "idle"; }
    get distanceFrom() { return this.pos; }

    /** The player pressed the action button with the rod. Returns false if nothing happened. */
    click(eye: Vector3, dir: Vector3): boolean {
        switch (this.state) {
            case "idle": return this.cast(eye, dir);
            case "cast": return false;
            case "wait":
                this.ev.message("Too early. Nothing is biting yet.");
                this.retract();
                return true;
            case "bite": {
                const lucky = Math.random() < 0.18;
                this.ev.caught(lucky ? 2 : 1);
                this.ev.sound("reel");
                this.ev.splash(this.pos.x, 0.05, this.pos.z, 10);
                this.retract();
                return true;
            }
        }
    }

    cancel(silent = false) {
        if (this.state === "idle") return;
        if (!silent) this.ev.message("You reel in your line.");
        this.state = "idle";
        this.bobber.setEnabled(false);
        this.line.setEnabled(false);
        this.ev.prompt(null);
    }

    private retract() { this.state = "idle"; this.reel = 0.35; this.ev.prompt(null); }

    private cast(eye: Vector3, dir: Vector3): boolean {
        if (dir.y > -0.04) { this.ev.message("Aim lower, at the water."); return false; }
        let t = -eye.y / dir.y;
        t = Math.min(t, 26);
        if (t < 3) { this.ev.message("Too close. Cast further out."); return false; }
        const x = eye.x + dir.x * t, z = eye.z + dir.z * t, h = heightAt(x, z);
        if (h > -0.32) { this.ev.message(h > 0 ? "That’s land. Aim at open water." : "Too shallow. Cast further out."); return false; }
        this.handPoint(this.from);
        this.to.set(x, 0, z);
        this.pos.copyFrom(this.from);
        this.state = "cast";
        this.t = 0;
        this.bobber.setEnabled(true);
        this.line.setEnabled(true);
        this.biteAt = (3.5 + Math.random() * 6.5) * (h < -2 ? 0.8 : 1);
        this.ev.sound("cast");
        return true;
    }

    private handPoint(out: Vector3) {
        if (this.tipOverride) return out.copyFrom(this.tipOverride);
        // just in front of the camera, low and to the right (Babylon's right-handed camera looks down -z)
        Vector3.TransformCoordinatesFromFloatsToRef(0.2, -0.04, -0.62, this.camera().getWorldMatrix(), out);
        return out;
    }

    update(dt: number) {
        this.clock += dt;
        if (this.reel > 0) {
            this.reel -= dt;
            this.handPoint(this.tip);
            Vector3.LerpToRef(this.pos, this.tip, 1 - Math.exp(-dt * 14), this.pos);
            this.bobber.position.copyFrom(this.pos);
            this.drawLine(0);
            if (this.reel <= 0) { this.bobber.setEnabled(false); this.line.setEnabled(false); }
            return;
        }
        if (this.state === "idle") return;
        this.t += dt;
        if (this.state === "cast") {
            const k = Math.min(1, this.t / 0.7);
            Vector3.LerpToRef(this.from, this.to, k, this.pos);
            this.pos.y += Math.sin(k * Math.PI) * 3.2 * Math.min(1, Vector3.Distance(this.from, this.to) / 10);
            if (k >= 1) {
                this.state = "wait";
                this.t = 0;
                this.pos.y = this.surface(this.pos.x, this.pos.z);
                this.ev.sound("plop");
                this.ev.splash(this.pos.x, 0.03, this.pos.z, 8);
                this.ev.prompt("Waiting for a bite…");
            }
        } else if (this.state === "wait") {
            this.pos.y = this.surface(this.pos.x, this.pos.z) + Math.sin(this.clock * 2.1) * 0.012;
            this.pos.x += Math.sin(this.clock * 0.7) * 0.0006;
            this.pos.z += Math.cos(this.clock * 0.6) * 0.0006;
            if (this.t > this.biteAt) {
                this.state = "bite";
                this.t = 0;
                this.window = 1.15;
                this.ev.sound("bite");
                this.ev.splash(this.pos.x, 0.03, this.pos.z, 6);
                this.ev.prompt("Bite! Click now!");
            }
        } else if (this.state === "bite") {
            this.pos.y = this.surface(this.pos.x, this.pos.z) - 0.07 + Math.sin(this.clock * 38) * 0.02;
            this.pos.x += Math.sin(this.clock * 31) * 0.004;
            if (this.t > this.window) {
                this.ev.message("The fish got away.");
                this.ev.sound("lost");
                this.retract();
            }
        }
        this.bobber.position.copyFrom(this.pos);
        this.drawLine(this.state === "cast" ? 0.2 : 0.08);
    }

    private drawLine(slack: number) {
        this.handPoint(this.tip);
        const d = Vector3.Distance(this.tip, this.pos);
        for (let i = 0; i < N; i++) {
            const u = i / (N - 1);
            const sag = Math.sin(u * Math.PI) * slack * d;
            this.pts[i].set(this.tip.x + (this.pos.x - this.tip.x) * u, this.tip.y + (this.pos.y - this.tip.y) * u - sag, this.tip.z + (this.pos.z - this.tip.z) * u);
        }
        MeshBuilder.CreateLines("fishLine", { points: this.pts, instance: this.line }, this.scene);
    }
}
