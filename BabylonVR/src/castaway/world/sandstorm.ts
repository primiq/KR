// The desert's sandstorms. Every couple of days or so (never sooner than a day and a half after the last, then more likely
// every hour) a storm blows up over the whole desert for about half a minute. Out in it you can see five or six metres:
// the air is thick with sand, the wind roars, streaks of sand blow past, and you wade against it at half speed. The only
// shelter is a building: stand where walls (and a roof) are round you and the dust stops at them, the wind drops to a
// moan outside, and you can see and move freely again.
// The host decides when a storm comes and goes and tells everybody (main.ts); each player works out their own shelter.
import { Color4, DynamicTexture, Mesh, MeshBuilder, ParticleSystem, type Scene, StandardMaterial, Vector3 } from "@babylonjs/core";

/** the wind the dunes were shaped by: the storm blows the same way */
const WIND = 0.35;
const SINCE_MIN = 36, CHANCE = 0.12;
/** how long a storm blows at full strength (s): with its few seconds of building up and dying down, about half a minute */
const STORM_SECONDS = 22;

export class Sandstorm {
    /** is a storm blowing (as the host says) */
    on = false;
    /** seconds of it left (host) */
    left = 0;
    /** 0..1: how hard it blows now (eases in and out) */
    k = 0;
    /** 0..1: how sheltered you are (eases as you step in and out of a building) */
    shelter = 0;
    /** the host started or ended one: tell everybody */
    onChange: ((on: boolean, left: number) => void) | null = null;
    private since = 30;
    private lastHour = -1;
    private beat = 0;
    private shell: Mesh;
    private shellMat: StandardMaterial;
    private dust: ParticleSystem;

    constructor(private readonly scene: Scene, lite: boolean) {
        // a shell of dust round the eyes, the fog's own colour: nothing past it shows, not even the sky
        this.shell = MeshBuilder.CreateSphere("dustShell", { diameter: 2, segments: 12, sideOrientation: Mesh.BACKSIDE }, scene);
        const sm = new StandardMaterial("dustShellMat", scene);
        sm.disableLighting = true; sm.fogEnabled = false; sm.backFaceCulling = false;
        this.shell.material = sm; this.shell.isPickable = false; this.shell.alwaysSelectAsActiveMesh = true;
        this.shell.metadata = { keepUnderground: true };
        this.shell.setEnabled(false);
        this.shellMat = sm;
        // streaks of sand blowing past
        const dot = new DynamicTexture("dustStreak", { width: 32, height: 32 }, scene, false);
        const ctx = dot.getContext(); const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
        g.addColorStop(0, "rgba(235,205,160,0.9)"); g.addColorStop(1, "rgba(220,190,150,0)"); ctx.fillStyle = g; ctx.fillRect(0, 0, 32, 32); dot.update(); dot.hasAlpha = true;
        const ps = new ParticleSystem("sandstorm", lite ? 700 : 1800, scene);
        ps.particleTexture = dot;
        ps.emitter = new Vector3(0, -1000, 0);
        const wx = Math.cos(WIND), wz = Math.sin(WIND);
        ps.minEmitBox = new Vector3(-10, -1.5, -10); ps.maxEmitBox = new Vector3(10, 4, 10);
        ps.direction1 = new Vector3(wx * 0.9 - 0.1, -0.15, wz * 0.9 - 0.1); ps.direction2 = new Vector3(wx * 1.1 + 0.1, 0.2, wz * 1.1 + 0.1);
        ps.minEmitPower = 9; ps.maxEmitPower = 16;
        ps.minLifeTime = 0.5; ps.maxLifeTime = 1.3;
        ps.minSize = 0.03; ps.maxSize = 0.09;
        ps.minScaleX = 4; ps.maxScaleX = 9;
        ps.billboardMode = ParticleSystem.BILLBOARDMODE_STRETCHED;
        ps.color1 = new Color4(0.85, 0.7, 0.5, 0.55); ps.color2 = new Color4(0.75, 0.6, 0.42, 0.4); ps.colorDead = new Color4(0.7, 0.58, 0.42, 0);
        ps.gravity = new Vector3(0, -0.5, 0);
        ps.emitRate = 0;
        ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
        ps.start();
        this.dust = ps;
    }

    /** another player (the host) says a storm is on or over */
    remote(on: boolean, left: number) {
        if (on !== this.on) { this.on = on; this.onTurn?.(on); }
        this.left = left;
    }
    /** a storm began or ended here (for the messages) */
    onTurn: ((on: boolean) => void) | null = null;

    /**
     * Every frame. `hour`: the time of day (storms are timed in game hours); `host`: this player decides when storms come;
     * `inDesert`: you are out there (the storm shows); `sheltered`: walls round you; `eye`: the camera; `light` 0..1 daylight.
     * Returns how much the storm is on you (0..1), for the fog, the speed and the wind.
     */
    update(dt: number, hour: number, host: boolean, inDesert: boolean, sheltered: boolean, eye: Vector3, light: number): number {
        if (this.lastHour >= 0) {
            let dh = hour - this.lastHour; if (dh < 0) dh += 24;
            if (dh > 0 && dh < 6 && host) {
                const before = Math.floor(this.since);
                this.since += dh;
                if (!this.on && this.since >= SINCE_MIN && Math.floor(this.since) !== before && Math.random() < CHANCE) {
                    this.on = true; this.left = STORM_SECONDS; this.onChange?.(true, this.left); this.onTurn?.(true);
                }
            }
        }
        this.lastHour = hour;
        // (it blows for real seconds, not game hours: about half a minute with its rise and fall)
        if (host && this.on) {
            this.left -= dt;
            if (this.left <= 0) { this.on = false; this.since = 0; this.left = 0; this.onChange?.(false, 0); this.onTurn?.(false); }
        }
        // (the host says so again now and then, for anybody who joined meanwhile)
        this.beat -= dt;
        if (host && this.on && this.beat <= 0) { this.beat = 10; this.onChange?.(true, this.left); }
        this.k += ((this.on ? 1 : 0) - this.k) * Math.min(1, dt / (this.on ? 3 : 2.5));
        if (!this.on && this.k < 0.002) this.k = 0;
        this.shelter += ((sheltered ? 1 : 0) - this.shelter) * Math.min(1, dt * 2.5);
        const k = inDesert ? this.k : 0;
        // the dust: right round you out in it, further off (the haze through the windows) when sheltered
        this.shell.setEnabled(k > 0.02);
        if (k > 0.02) {
            const r = 6 + 2 / Math.max(0.15, k) + this.shelter * 22;
            this.shell.position.copyFrom(eye); this.shell.scaling.setAll(r);
            this.shellMat.emissiveColor.copyFrom(this.scene.fogColor);
        }
        (this.dust.emitter as Vector3).copyFrom(eye);
        this.dust.emitRate = k * (1 - this.shelter) * 1400;
        const lit = 0.25 + 0.75 * light;
        this.dust.color1.set(0.85 * lit, 0.7 * lit, 0.5 * lit, 0.55); this.dust.color2.set(0.75 * lit, 0.6 * lit, 0.42 * lit, 0.4);
        return k;
    }
}
