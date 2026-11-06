// Floris Lava (the volcano door in the secret room): a volcano standing alone in the sea, far off at z = -14 km. You
// start on the floor of its caldera. The only way out is a jumping course up the caldera's walls: ledges, basalt
// columns, thin beams and a few pistons that rise and sink, spiralling all the way up to the rim. Fall and you land on
// whatever is below you, or right back at the bottom.
//   On the caldera floor a big red button starts a run. The clock starts, and after a short head start the caldera
// begins to fill with lava: slowly at first, then lava geysers burst up from it, and it keeps rising until it reaches
// the rim. You can swim in it and the geysers only throw lava about: neither hurts you (only the eruption does). At the top a research station shows the clock (a big screen over its door, seen from
// the whole caldera); in it, the STOP button records your time for everyone to see. The clock runs on while anybody is
// still on the course. You can walk the whole rim and watch the others struggle.
//   By the station a helicopter waits. Board it, and press to say you are ready: once everybody on board is ready it
// takes off (whoever is not on board is left behind), climbs over the crater and hovers there while the lava surges up
// and the volcano erupts. Then everybody is back in the secret room, where a board shows the times, who got away and
// who burned. If the lava reaches the rim first, it erupts anyway.
//   Multiplayer: everybody in the level runs the same course and the same lava (it all follows from the time since the
// start). Whoever presses START tells everybody, the lowest id in the level ("the controller") then keeps everyone in
// step and decides when the helicopter goes; finishing, burning and boarding are each player's own word.
import {
    Color3, Color4, DynamicTexture, Effect, Mesh, MeshBuilder, ParticleSystem, PBRMaterial, type Scene, ShaderMaterial,
    StandardMaterial, Texture, TransformNode, Vector2, Vector3, VertexData,
} from "@babylonjs/core";
import { PBRCustomMaterial } from "@babylonjs/materials";
import { getPref, setPref } from "../core/prefs";
import { NOISE_GLSL } from "../render/materials";

/** where it is: the caldera's middle, and the caldera floor's height (the rim is TOP above that) */
export const VX = 0, VZ = -14000, BASE = 20;
const TOP = 52;
/** the caldera: its wall's radius at the floor and how much it widens per metre up; the rim's outer edge */
const R0 = 30, FLARE = 0.12, RIM_OUT = 50;
const rIn = (y: number) => R0 + Math.max(0, Math.min(TOP, y)) * FLARE;
/** a step you can walk up without jumping (the player's own) */
const STEP = 0.8;
/** the lava: a head start (s), then how long it takes to reach the rim (s) */
const GRACE = 40, RISE = 300;
/** the helicopter: how long after take-off the volcano blows, and how long the eruption lasts before everybody goes home */
const ERUPT_AFTER = 16, ERUPT_LEN = 17;
/** the fade to black at the end (s before the end it starts, how long the fade back in takes) */
const FADE_OUT = 2.2, FADE_IN = 1.6;
const SEATS = 6;
const CENTRE = new Vector2(VX, VZ);
/** where the course starts (angle round the caldera) */
const START_ANG = Math.PI * 0.5;

interface V3 { x: number; y: number; z: number }
type Kind = "slab" | "beam" | "pillar";
/** a platform: a footprint (a circle, or a rectangle hl x hw turned by `rot`) with its top and bottom; pistons bob */
interface Plat { /** a shelf to fall onto, not a step of the course */ extra?: boolean; kind: Kind; x: number; z: number; top: number; bottom: number; hl: number; hw: number; rot: number; bob: { amp: number; per: number; ph: number } | null; mesh?: Mesh }
/** a wall to bump into (an oriented box between y0 and y1) */
interface Wall { x: number; z: number; hl: number; hw: number; rot: number; y0: number; y1: number }
export type LavaTarget = { w: "start" } | { w: "exit" } | { w: "stop" } | { w: "heli" };
export interface LavaOther { id: number; name: string; x: number; y: number; z: number; flags: number }
export interface LavaSfx { press(): void; geyser(d: number): void; blub(v: number): void; rumble(d: number, v: number): void; eruption(): void; rotor(v: number, rate: number): void; burn(): void; win(): void; tick(): void }
type Phase = "idle" | "run";
interface Result { name: string; ms: number | null; dead: boolean; heli: boolean }

/** a small seeded random: the course is the same for everybody, every time */
function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const fmt = (ms: number) => { const s = Math.max(0, ms) / 1000, m = Math.floor(s / 60); return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`; };

// ---------------------------------------------------------------- the course
function buildCourse(): { plats: Plat[]; arrive: number } {
    const R = rng(4242), plats: Plat[] = [];
    const ext = (p: Plat, dx: number, dz: number) => {
        // how far the platform reaches along direction (dx, dz)
        if (p.kind === "pillar") return p.hl;
        const c = Math.cos(p.rot), s = Math.sin(p.rot);
        return Math.abs(dx * c + dz * s) * p.hl + Math.abs(-dx * s + dz * c) * p.hw;
    };
    const slab = (ang: number, top: number, hl: number, hw: number, kind: Kind = "slab", inset = hw + 0.02): Plat => {
        const r = rIn(top) - inset;
        return { kind, x: Math.cos(ang) * r, z: Math.sin(ang) * r, top, bottom: top - (kind === "beam" ? 0.35 : 0.8), hl, hw, rot: ang + Math.PI / 2, bob: null };
    };
    let ang = START_ANG, top = 0.7;
    let prev = slab(ang, top, 2.4, 1.1);
    plats.push(prev);
    for (let n = 1; n < 400; n++) {
        const hard = R() < 0.2, rest = n % 9 === 0;
        let rise = rest ? 0.3 : hard ? 0.72 + R() * 0.12 : 0.4 + R() * 0.38;
        const gap = rest ? 1.1 : hard ? 2.2 + R() * 0.5 : 1.1 + R() * 1.15;
        if (top + rise > TOP - 0.45) break;
        const k = R();
        let p: Plat;
        const tNew = top + rise;
        if (rest) p = slab(0, tNew, 2.5, 1.15);
        else if (k < 0.4) p = slab(0, tNew, 1.35 + R() * 0.9, 0.85 + R() * 0.3);
        else if (k < 0.55) { p = slab(0, tNew, 1.8 + R() * 0.9, 0.45, "beam", 2.2 + R() * 1.6); p.rot += (R() - 0.5) * 0.9; }
        else {
            const rad = 0.75 + R() * 0.6, inset = 1.6 + R() * 3.2;
            const r = rIn(tNew) - inset;
            p = { kind: "pillar", x: 0, z: r, top: tNew, bottom: -6, hl: rad, hw: rad, rot: 0, bob: null };
            // a few pistons that rise and sink: time the jump
            if (n > 10 && !hard && R() < 0.16) { p.bob = { amp: 0.55, per: 3 + R() * 1.6, ph: R() * Math.PI * 2 }; rise = 0.35; p.top = top + rise; }
        }
        // (round the wall by just the right angle for the gap; slabs and beams lie along the wall, beams a little skew)
        const twist = p.kind === "pillar" ? 0 : p.rot - Math.PI / 2;
        const r = Math.hypot(p.x, p.z);
        let dA = (ext(prev, 0, 1) + gap + p.hl) / r;
        for (let it = 0; it < 3; it++) {
            const a = ang + dA, px = Math.cos(a) * r, pz = Math.sin(a) * r;
            const dx = px - prev.x, dz = pz - prev.z, D = Math.hypot(dx, dz) || 1;
            const want = ext(prev, dx / D, dz / D) + gap + ext({ ...p, x: px, z: pz, rot: a + Math.PI / 2 + twist }, dx / D, dz / D);
            dA *= want / D;
        }
        ang += dA;
        p.x = Math.cos(ang) * r; p.z = Math.sin(ang) * r;
        if (p.kind !== "pillar") p.rot = ang + Math.PI / 2 + twist;
        plats.push(p); prev = p; top = p.top;
    }
    // the last ledge, hard against the wall just under the rim: step up onto it from there
    const lastTop = TOP - 0.5;
    ang += (ext(prev, 0, 1) + 1.6 + 1.6) / (rIn(lastTop) - 1);
    const last = slab(ang, lastTop, 2.0, 1.0);
    if (lastTop - top > 0.9) { const mid = slab(ang - 0.06, (top + lastTop) / 2, 1.0, 0.8); plats.push(mid); }
    plats.push(last);
    // shelves to fall onto: from each resting ledge, a wide shelf runs along the wall under the next stretch of the course,
    // so a slip costs a few metres, not the whole climb (walk back along it and go again)
    const route = plats.length;
    for (let i = 0; i < route; i++) {
        const r0 = plats[i];
        if (r0.kind !== "slab" || r0.hl < 2.4 || i + 2 >= route) continue;
        const a0 = Math.atan2(r0.z, r0.x), j = Math.min(route - 1, i + 8);
        let a1 = Math.atan2(plats[j].z, plats[j].x);
        while (a1 < a0) a1 += Math.PI * 2;
        const rr = rIn(r0.top) - 1.7, segs = Math.max(1, Math.ceil(((a1 - a0) * rr) / 3.6));
        for (let k = 0; k < segs; k++) {
            const a = a0 + ((k + 0.5) / segs) * (a1 - a0), half = ((a1 - a0) * rr) / segs / 2 + 0.15;
            const sh = slab(a, r0.top, half, 1.7);
            sh.extra = true;
            plats.push(sh);
        }
    }
    // a column stands on the floor, unless that would put it across the route lower down: then it ends well above
    // the heads of whoever comes by under it (it juts out of the wall up there)
    const segDist = (px: number, pz: number, a: Plat, b: Plat) => {
        const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / l2));
        return Math.hypot(px - (a.x + dx * t), pz - (a.z + dz * t));
    };
    for (let i = 0; i < route; i++) {
        const c = plats[i];
        if (c.kind !== "pillar") continue;
        for (let j = 1; j < i; j++) {
            const a = plats[j - 1], b = plats[j];
            if (Math.max(a.top, b.top) > c.top - 3) continue;
            if (segDist(c.x, c.z, a, b) < c.hl + Math.max(a.hw, b.hw, 0.6) + 1.2) c.bottom = Math.max(c.bottom, Math.max(a.top, b.top) + 3.2);
        }
    }
    return { plats, arrive: ang };
}

// ---------------------------------------------------------------- shaders
const LAVA_VS = `precision highp float;
attribute vec3 position;
uniform mat4 world; uniform mat4 viewProjection;
varying vec3 vW;
void main() { vec4 w = world * vec4(position, 1.0); vW = w.xyz; gl_Position = viewProjection * w; }`;
const LAVA_FS = `precision highp float;
varying vec3 vW;
uniform float time; uniform float flowR; uniform vec2 centre; uniform float bright;
${NOISE_GLSL}
float fbm(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * cNoise(p); p *= 2.07; a *= 0.5; } return s; }
void main() {
    float d = length(vW.xz - centre);
    if (d > flowR) discard;
    vec2 p = vW.xz * 0.12;
    // slow churning: crust plates drift over a molten glow, bright seams between them
    float n = fbm(vec3(p + vec2(time * 0.03, -time * 0.02), time * 0.05));
    float m = fbm(vec3(p * 2.3 - vec2(time * 0.05, time * 0.04), time * 0.11 + 4.0));
    float crust = smoothstep(-0.08, 0.22, n + m * 0.35);
    float seam = 1.0 - smoothstep(0.0, 0.06, abs(n + m * 0.35 + 0.05));
    vec3 hot = mix(vec3(1.0, 0.36, 0.04), vec3(1.0, 0.78, 0.25), smoothstep(-0.4, 0.1, m));
    vec3 col = mix(hot * 1.35, vec3(0.14, 0.045, 0.03), crust * 0.92);
    col += vec3(1.0, 0.5, 0.1) * seam * 2.0;
    // the flowing edge of an overflow glows brightest
    col += vec3(1.0, 0.45, 0.08) * smoothstep(flowR - 3.0, flowR, d) * 2.0;
    gl_FragColor = vec4(col * bright, 1.0);
}`;

export class Volcano {
    readonly root: TransformNode;
    active = false;
    /** wired by main */
    send: (e: Record<string, unknown>) => void = () => {};
    myId = () => 0;
    myName = () => "You";
    others: () => LavaOther[] = () => [];
    say: (t: string) => void = () => {};
    sfx: LavaSfx | null = null;
    /** back to the secret room (main: the sky room puts you in front of this door) */
    goHome: (() => void) | null = null;
    /** a red flash on the screen (main) */
    flash: ((k: number) => void) | null = null;
    shake: ((k: number) => void) | null = null;

    private plats: Plat[];
    private walls: Wall[] = [];
    private arrive: number;
    private scene: Scene;
    private rockMat: PBRCustomMaterial;
    private lavaMat: ShaderMaterial;
    private flowMat: ShaderMaterial;
    private lavaDisc: Mesh;
    private flow: Mesh;
    private bobbers: Plat[] = [];
    private time = 0;
    // the run
    phase: Phase = "idle";
    private t0 = 0;
    private runners = new Map<number, string>();
    private results = new Map<number, Result>();
    private seats = new Map<number, { id: number; ready: boolean; name: string }>();
    private heliT0 = -1;
    private ended = false;
    private stateBeat = 0;
    private mySeat = -1;
    private dead = false;
    private finished = false;
    /** the last run's outcome, for the board in the secret room */
    lastRun: Result[] = [];
    private best: { n: string; ms: number }[] = [];
    // places
    private stationAng: number;
    private padAng: number;
    private spawn = { x: 0, z: 0, yaw: 0 };
    private startBtn = new Vector3();
    private exitFloor = new Vector3();
    private exitStation = new Vector3();
    private stopBtn = new Vector3();
    private heli: TransformNode;
    private rotor: TransformNode;
    private tailRotor: TransformNode;
    private heliAt = new Vector3();
    private heliYaw = 0;
    private padPos = new Vector3();
    private padYaw = 0;
    private rotorSpin = 0;
    // screens
    private bigTex: DynamicTexture;
    private inTex: DynamicTexture;
    private boardTex: DynamicTexture;
    readonly board: Mesh;
    private screenKey = "";
    private boardKey = "";
    private hud: HTMLDivElement;
    // fire
    private geysers: { ps: ParticleSystem; until: number; x: number; z: number; top: number }[] = [];
    private lastGeyser = -1;
    private fountain: ParticleSystem;
    private bombs: ParticleSystem;
    private smoke: ParticleSystem;
    private embers: ParticleSystem;
    private erupted = false;
    // the big blast: a fireball, a column of ash, the mushroom cap that spreads on top of it, a ring rolling out over the rim
    private fireball!: Mesh;
    private stem!: ParticleSystem;
    private cap!: ParticleSystem;
    private surge!: ParticleSystem;
    /** 0..1 how dark it has gone (the end), and whether it is coming back up (home again) */
    private fadeK = 0;
    private fadeIn = false;
    private fadeSphere!: Mesh;
    private heliPitch = 0;
    private rotorDisc!: Mesh;
    private blades: Mesh[] = [];
    private rumbled = false;
    private blubT = 0;
    private lastSec = -1;

    constructor(scene: Scene) {
        this.scene = scene;
        this.root = new TransformNode("volcano", scene);
        this.root.position.set(VX, BASE, VZ);
        const course = buildCourse();
        this.plats = course.plats; this.arrive = course.arrive;
        this.stationAng = this.arrive; this.padAng = this.arrive + 0.46;

        // ---- materials: basalt that glows orange just above the lava
        const rock = new PBRCustomMaterial("volcRock", scene);
        rock.metallic = 0; rock.roughness = 0.93; rock.backFaceCulling = false;
        rock.AddUniform("lavaY", "float", 0);
        rock.AddUniform("heat", "float", 0);
        rock.Fragment_Definitions(NOISE_GLSL);
        rock.Fragment_Custom_Albedo(`
            vec3 wp = vPositionW;
            float g1 = cNoise(wp * 0.35) * 0.5 + 0.5, g2 = cNoise(wp * 2.1) * 0.5 + 0.5;
            float strata = cNoise(vec3(wp.x * 0.08, wp.y * 1.3, wp.z * 0.08)) * 0.5 + 0.5;
            vec3 basalt = mix(vec3(0.028, 0.026, 0.026), vec3(0.075, 0.065, 0.06), g1);
            basalt = mix(basalt, vec3(0.13, 0.055, 0.035), smoothstep(0.66, 0.82, strata) * 0.6);
            vec3 nW = normalize(vNormalW);
            basalt = mix(basalt, vec3(0.16, 0.15, 0.14), smoothstep(0.75, 0.95, abs(nW.y)) * 0.45 * g2);
            surfaceAlbedo = basalt * (0.85 + g2 * 0.3);
        `);
        rock.Fragment_Before_FinalColorComposition(`
            // (rock just above the lava glows, its cracks brightest; none of it before a run)
            float above = vPositionW.y - lavaY;
            float glow = exp(-max(0.0, above) / 4.0) * step(-1.0, above);
            float crack = smoothstep(0.06, 0.0, abs(cNoise(vPositionW * 0.9)));
            finalEmissive += vec3(1.0, 0.3, 0.05) * (glow * (0.25 + crack * 1.4) * heat);
            finalEmissive += vec3(0.012, 0.011, 0.011);
        `);
        rock.onBindObservable.add(() => {
            const e = rock.getEffect(); if (!e) return;
            e.setFloat("lavaY", BASE + this.lavaY());
            e.setFloat("heat", this.phase === "run" && this.lavaY() > -1.4 ? 1 : 0);
        });
        this.rockMat = rock;
        Effect.ShadersStore["volcLavaVertexShader"] = LAVA_VS;
        Effect.ShadersStore["volcLavaFragmentShader"] = LAVA_FS;
        const lavaMat = (name: string) => {
            const m = new ShaderMaterial(name, scene, { vertex: "volcLava", fragment: "volcLava" }, { attributes: ["position"], uniforms: ["world", "viewProjection", "time", "flowR", "centre", "bright"] });
            m.backFaceCulling = false;
            m.onBindObservable.add(() => { const e = m.getEffect(); if (!e) return; e.setFloat("time", this.time); e.setVector2("centre", CENTRE); });
            m.setFloat("flowR", 1e6); m.setFloat("bright", 1);
            return m;
        };
        this.lavaMat = lavaMat("volcLavaMat"); this.flowMat = lavaMat("volcFlowMat");
        this.flowMat.setFloat("flowR", 0);

        // (the screens' pictures first: the station's screens are made with them)
        this.bigTex = new DynamicTexture("volcBig", { width: 1024, height: 384 }, scene, true);
        this.inTex = new DynamicTexture("volcIn", { width: 1024, height: 640 }, scene, true);
        // ---- the mountain
        this.buildMountain();
        // ---- the course
        const statics: Mesh[] = [];
        for (const p of this.plats) {
            let m: Mesh;
            if (p.kind === "pillar") {
                m = MeshBuilder.CreateCylinder("vp", { height: p.top - p.bottom, diameter: p.hl * 2, tessellation: 6 }, scene);
                m.position.set(p.x, (p.top + p.bottom) / 2, p.z);
            } else {
                m = MeshBuilder.CreateBox("vs", { width: p.hl * 2, height: p.top - p.bottom, depth: p.hw * 2 }, scene);
                m.position.set(p.x, (p.top + p.bottom) / 2, p.z);
                m.rotation.y = -p.rot;
            }
            if (p.bob) { m.material = rock; m.parent = this.root; p.mesh = m; this.bobbers.push(p); }
            else statics.push(m);
        }
        const courseMesh = Mesh.MergeMeshes(statics, true, true)!;
        courseMesh.name = "volcCourse"; courseMesh.material = rock; courseMesh.parent = this.root;

        // ---- the lava: a pool that fills the caldera, and a sheet that pours over the rim at the end
        this.lavaDisc = MeshBuilder.CreateDisc("volcLava", { radius: 1, tessellation: 64 }, scene);
        this.lavaDisc.rotation.x = Math.PI / 2; this.lavaDisc.material = this.lavaMat; this.lavaDisc.parent = this.root;
        this.flow = this.polar("volcFlow", 96, 18, (a, k) => { const r = rIn(TOP) - 1 + k * (150 - rIn(TOP) + 1); return [Math.cos(a) * r, this.outerY(a, r) + 0.35, Math.sin(a) * r]; }, false);
        this.flow.material = this.flowMat;

        // ---- the start: a red button on a stone pedestal, a way home, and where you arrive
        const sa = START_ANG - 0.32, sr = 19;
        this.spawn = { x: Math.cos(sa) * sr, z: Math.sin(sa) * sr, yaw: 0 };
        const first = this.plats[0];
        this.spawn.yaw = Math.atan2(-(first.x - this.spawn.x), -(first.z - this.spawn.z));
        const bx = Math.cos(sa + 0.14) * (sr - 2.5), bz = Math.sin(sa + 0.14) * (sr - 2.5);
        this.startBtn.set(bx, 1.15, bz);
        this.buildButton(bx, 0, bz, "#d42a1a", "START", "the lava will come", this.spawn);
        const ex = Math.cos(sa - 0.22) * (sr + 3), ez = Math.sin(sa - 0.22) * (sr + 3);
        this.exitFloor.set(ex, 1.2, ez);
        this.buildArch(ex, 0, ez, Math.atan2(ex, ez));
        // ---- the research station on the rim, and the helipad
        this.buildStation();
        this.heli = new TransformNode("volcHeli", scene); this.heli.parent = this.root;
        this.rotor = new TransformNode("volcRotor", scene); this.tailRotor = new TransformNode("volcTail", scene);
        this.buildHeli();
        // ---- fire
        const puff = new DynamicTexture("volcPuff", { width: 64, height: 64 }, scene, false);
        { const c = puff.getContext() as CanvasRenderingContext2D; const g = c.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.45, "rgba(255,255,255,0.55)"); g.addColorStop(1, "rgba(255,255,255,0)"); c.fillStyle = g; c.fillRect(0, 0, 64, 64); puff.update(); puff.hasAlpha = true; }
        for (let i = 0; i < 4; i++) {
            const ps = new ParticleSystem("volcGeyser", 500, scene);
            ps.particleTexture = puff; ps.emitter = new Vector3(0, -1000, 0);
            ps.minEmitBox = new Vector3(-0.6, 0, -0.6); ps.maxEmitBox = new Vector3(0.6, 0, 0.6);
            ps.direction1 = new Vector3(-1.2, 14, -1.2); ps.direction2 = new Vector3(1.2, 20, 1.2);
            ps.minEmitPower = 0.9; ps.maxEmitPower = 1.1; ps.minLifeTime = 0.8; ps.maxLifeTime = 1.4;
            ps.minSize = 0.5; ps.maxSize = 1.4; ps.gravity = new Vector3(0, -16, 0);
            ps.color1 = new Color4(1, 0.6, 0.15, 1); ps.color2 = new Color4(1, 0.3, 0.05, 1); ps.colorDead = new Color4(0.3, 0.05, 0, 0);
            ps.blendMode = ParticleSystem.BLENDMODE_ADD; ps.emitRate = 0; ps.start();
            this.geysers.push({ ps, until: -1, x: 0, z: 0, top: 0 });
        }
        const sys = (n: string, cap: number) => { const ps = new ParticleSystem(n, cap, scene); ps.particleTexture = puff; ps.emitter = new Vector3(VX, BASE + TOP, VZ); ps.emitRate = 0; ps.start(); return ps; };
        this.fountain = sys("volcFountain", 3000);
        Object.assign(this.fountain, { minEmitBox: new Vector3(-8, 0, -8), maxEmitBox: new Vector3(8, 2, 8), direction1: new Vector3(-6, 8, -6), direction2: new Vector3(6, 38, 6), minLifeTime: 1.4, maxLifeTime: 3.6, minSize: 3.5, maxSize: 8, gravity: new Vector3(0, -18, 0), blendMode: ParticleSystem.BLENDMODE_STANDARD });
        // (solid molten blobs, not a glow: they must read against the bright lava as well as the sky)
        this.fountain.color1 = new Color4(1, 0.42, 0.06, 0.95); this.fountain.color2 = new Color4(0.85, 0.16, 0.03, 0.95); this.fountain.colorDead = new Color4(0.9, 0.22, 0.04, 0);
        this.bombs = sys("volcBombs", 600);
        Object.assign(this.bombs, { minEmitBox: new Vector3(-6, 0, -6), maxEmitBox: new Vector3(6, 2, 6), direction1: new Vector3(-26, 22, -26), direction2: new Vector3(26, 40, 26), minLifeTime: 3, maxLifeTime: 5, minSize: 1.4, maxSize: 3, gravity: new Vector3(0, -20, 0), blendMode: ParticleSystem.BLENDMODE_ADD });
        this.bombs.color1 = new Color4(1, 0.5, 0.1, 1); this.bombs.color2 = new Color4(0.9, 0.25, 0.05, 1); this.bombs.colorDead = new Color4(0.15, 0.04, 0.02, 0.3);
        this.smoke = sys("volcSmoke", 500);
        // (the ash cloud billows up over the fountain, not in front of it)
        Object.assign(this.smoke, { minEmitBox: new Vector3(-12, 34, -12), maxEmitBox: new Vector3(12, 46, 12), direction1: new Vector3(-4, 6, -4), direction2: new Vector3(4, 11, 4), minLifeTime: 9, maxLifeTime: 15, minSize: 12, maxSize: 26, gravity: new Vector3(0, 0.6, 0), blendMode: ParticleSystem.BLENDMODE_STANDARD, minAngularSpeed: -0.4, maxAngularSpeed: 0.4 });
        this.smoke.color1 = new Color4(0.28, 0.26, 0.25, 0.6); this.smoke.color2 = new Color4(0.42, 0.39, 0.37, 0.5); this.smoke.colorDead = new Color4(0.35, 0.33, 0.32, 0);
        // embers rising off the lava all through a run
        this.embers = sys("volcEmbers", 400);
        Object.assign(this.embers, { minEmitBox: new Vector3(-R0, 0, -R0), maxEmitBox: new Vector3(R0, 0.4, R0), direction1: new Vector3(-0.6, 2, -0.6), direction2: new Vector3(0.6, 5, 0.6), minLifeTime: 2.5, maxLifeTime: 5, minSize: 0.08, maxSize: 0.22, gravity: new Vector3(0, 0.3, 0), blendMode: ParticleSystem.BLENDMODE_ADD });
        this.embers.color1 = new Color4(1, 0.6, 0.2, 1); this.embers.color2 = new Color4(1, 0.35, 0.08, 1); this.embers.colorDead = new Color4(0.4, 0.1, 0, 0);
        // ---- the blast: a fireball that swells and fades
        this.fireball = MeshBuilder.CreateSphere("volcFireball", { diameter: 2, segments: 20 }, scene);
        const fbm = new StandardMaterial("volcFireballM", scene); fbm.disableLighting = true; fbm.emissiveColor = new Color3(1, 0.55, 0.15); fbm.alpha = 1; fbm.backFaceCulling = false;
        this.fireball.material = fbm; this.fireball.parent = this.root; this.fireball.position.set(0, TOP + 6, 0); this.fireball.isPickable = false; this.fireball.setEnabled(false);
        // the column: ash pouring straight up out of the crater, glowing at its root
        this.stem = sys("volcStem", 1600);
        Object.assign(this.stem, { minEmitBox: new Vector3(-11, 0, -11), maxEmitBox: new Vector3(11, 4, 11), direction1: new Vector3(-2.5, 34, -2.5), direction2: new Vector3(2.5, 46, 2.5), minLifeTime: 3.6, maxLifeTime: 4.6, minSize: 14, maxSize: 22, gravity: new Vector3(0, -2, 0), blendMode: ParticleSystem.BLENDMODE_STANDARD, minAngularSpeed: -0.5, maxAngularSpeed: 0.5 });
        // (dark, warm ash, lit orange from below: it has to stand out against a pale sky and the haze over the sea)
        this.stem.addColorGradient(0, new Color4(1, 0.5, 0.15, 1)); this.stem.addColorGradient(0.15, new Color4(0.45, 0.2, 0.1, 0.97)); this.stem.addColorGradient(0.5, new Color4(0.2, 0.15, 0.12, 0.95)); this.stem.addColorGradient(1, new Color4(0.24, 0.2, 0.18, 0));
        this.stem.addSizeGradient(0, 10); this.stem.addSizeGradient(1, 26);
        // the cap: billows that pour outward from the top of the column and roll over, a doughnut of ash that keeps rising
        this.cap = sys("volcCap", 1600);
        Object.assign(this.cap, { minLifeTime: 7, maxLifeTime: 11, gravity: new Vector3(0, 0, 0), blendMode: ParticleSystem.BLENDMODE_STANDARD, minAngularSpeed: -0.3, maxAngularSpeed: 0.3, minEmitPower: 1, maxEmitPower: 1 });
        this.cap.addColorGradient(0, new Color4(0.55, 0.28, 0.14, 0.95)); this.cap.addColorGradient(0.3, new Color4(0.3, 0.25, 0.22, 0.92)); this.cap.addColorGradient(1, new Color4(0.36, 0.33, 0.31, 0));
        this.cap.addSizeGradient(0, 22); this.cap.addSizeGradient(1, 55);
        this.cap.startPositionFunction = (_wm, pos) => { const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 14; pos.set(VX + Math.cos(a) * r, this.capY + (Math.random() - 0.5) * 8, VZ + Math.sin(a) * r); };
        this.cap.startDirectionFunction = (_wm, dir, pt) => { const dx = pt.position.x - VX, dz = pt.position.z - VZ, l = Math.hypot(dx, dz) || 1, sp = 9 + Math.random() * 7; dir.set((dx / l) * sp, 2 + Math.random() * 4, (dz / l) * sp); };
        // the base surge: a ring of ash racing out over the rim and down the mountain
        this.surge = sys("volcSurge", 900);
        Object.assign(this.surge, { minLifeTime: 3, maxLifeTime: 5, minSize: 10, maxSize: 18, gravity: new Vector3(0, -3, 0), blendMode: ParticleSystem.BLENDMODE_STANDARD, minEmitPower: 1, maxEmitPower: 1 });
        this.surge.addColorGradient(0, new Color4(0.32, 0.25, 0.2, 0.9)); this.surge.addColorGradient(1, new Color4(0.4, 0.36, 0.33, 0));
        this.surge.startPositionFunction = (_wm, pos) => { const a = Math.random() * Math.PI * 2, r = rIn(TOP) + Math.random() * 4; pos.set(VX + Math.cos(a) * r, BASE + TOP + 2 + Math.random() * 3, VZ + Math.sin(a) * r); };
        this.surge.startDirectionFunction = (_wm, dir, pt) => { const dx = pt.position.x - VX, dz = pt.position.z - VZ, l = Math.hypot(dx, dz) || 1, sp = 22 + Math.random() * 10; dir.set((dx / l) * sp, -3 + Math.random() * 5, (dz / l) * sp); };
        // (the eruption draws after the horizon haze, which would otherwise paint over it wherever the sky is behind,
        //  but keeps the depth, so the mountain still hides what is behind it)
        scene.setRenderingAutoClearDepthStencil(2, false, false, false);
        for (const ps of [this.stem, this.cap, this.surge, this.fountain, this.bombs, this.smoke]) ps.renderingGroupId = 2;
        // ---- the fade to black at the very end: a dark bubble round the eyes, drawn over everything (works in a headset too)
        this.fadeSphere = MeshBuilder.CreateSphere("volcFade", { diameter: 1, segments: 8, sideOrientation: Mesh.BACKSIDE }, scene);
        const fm = new StandardMaterial("volcFadeM", scene); fm.disableLighting = true; fm.emissiveColor = Color3.Black(); fm.diffuseColor = Color3.Black(); fm.backFaceCulling = false; fm.disableDepthWrite = true; fm.alpha = 0;
        this.fadeSphere.material = fm; this.fadeSphere.renderingGroupId = 3; this.fadeSphere.isPickable = false; this.fadeSphere.alwaysSelectAsActiveMesh = true;
        this.fadeSphere.metadata = { keepUnderground: true }; this.fadeSphere.setEnabled(false);

        // ---- screens: the big clock over the station door, the one inside, and the board back in the secret room
        this.boardTex = new DynamicTexture("volcBoard", { width: 1024, height: 768 }, scene, true);
        this.board = MeshBuilder.CreatePlane("lavaBoard", { width: 2.2, height: 1.65 }, scene);
        const bm = new StandardMaterial("lavaBoardMat", scene); bm.disableLighting = true; bm.emissiveTexture = this.boardTex; bm.diffuseColor = Color3.Black(); bm.backFaceCulling = false;
        this.board.material = bm; this.board.isPickable = false;
        this.board.metadata = { skyroom: true };
        this.best = (() => { try { return JSON.parse(getPref("lavaBest") || "[]"); } catch { return []; } })();
        this.drawBoard();

        this.hud = document.createElement("div");
        this.hud.style.cssText = "position:fixed;left:50%;top:70px;transform:translateX(-50%);z-index:5;display:none;color:#ffd9a0;font:700 22px system-ui,sans-serif;text-align:center;text-shadow:0 1px 6px rgba(0,0,0,.9);pointer-events:none;letter-spacing:.03em";
        document.body.appendChild(this.hud);
        // (draw the screens once now: an empty texture never counts as ready, and the loading screen would wait on it)
        this.drawScreens(0);
        this.setVisible(false);
    }

    // ---------------------------------------------------------------- building
    /** the outside of the mountain at angle a, radius r (local y): down from the rim to the sea, ridged */
    private outerY(a: number, r: number) {
        const k = Math.max(0, (r - RIM_OUT) / (150 - RIM_OUT));
        const ridges = Math.sin(a * 23 + Math.sin(a * 5) * 2) * 1.6 + Math.sin(a * 9 + 1.3) * 2.2;
        return TOP - (TOP + BASE + 3) * Math.pow(k, 0.85) + ridges * Math.sin(k * Math.PI);
    }
    private wallBump(a: number, y: number) { return 0.35 + 0.9 * (0.5 + 0.5 * Math.sin(a * 37 + y * 0.31 + Math.sin(a * 11) * 2)) * (0.5 + 0.5 * Math.sin(y * 0.9 + a * 7)); }
    /** a mesh on a polar grid: f(angle, 0..1) gives each vertex */
    private polar(name: string, na: number, nk: number, f: (a: number, k: number) => [number, number, number], rock = true) {
        const pos: number[] = [], idx: number[] = [];
        for (let j = 0; j <= nk; j++) for (let i = 0; i <= na; i++) pos.push(...f((i / na) * Math.PI * 2, j / nk));
        for (let j = 0; j < nk; j++) for (let i = 0; i < na; i++) { const a = j * (na + 1) + i, b = a + na + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
        const vd = new VertexData(); vd.positions = pos; vd.indices = idx;
        const nrm: number[] = []; VertexData.ComputeNormals(pos, idx, nrm); vd.normals = nrm;
        const m = new Mesh(name, this.scene); vd.applyToMesh(m); m.parent = this.root; m.isPickable = false;
        if (rock) m.material = this.rockMat;
        return m;
    }
    private buildMountain() {
        // the caldera wall, from the floor up to the rim (pushed back a little here and there: never into where you climb)
        // (it starts below the floor, and the floor runs on under it: no gap at the foot of the wall to see out through)
        this.polar("volcWall", 144, 31, (a, k) => { const y = -2 + k * (TOP + 2), r = rIn(y) + this.wallBump(a, Math.max(0, y)); return [Math.cos(a) * r, y, Math.sin(a) * r]; });
        // the floor
        this.polar("volcFloor", 72, 8, (a, k) => { const r = k * (R0 + 2.5); return [Math.cos(a) * r, 0.0, Math.sin(a) * r]; });
        // the rim: a broad flat walk all the way round
        this.polar("volcRim", 144, 4, (a, k) => { const r0 = rIn(TOP) + this.wallBump(a, TOP), r = r0 + k * (RIM_OUT - r0); return [Math.cos(a) * r, TOP + (k > 0 && k < 1 ? Math.sin(a * 13 + k * 5) * 0.03 : 0), Math.sin(a) * r]; });
        // and the mountain's flanks, down into the sea
        this.polar("volcFlank", 144, 26, (a, k) => { const r = RIM_OUT + k * (150 - RIM_OUT); return [Math.cos(a) * r, this.outerY(a, r), Math.sin(a) * r]; });
    }
    private mat(name: string, c: string, o: { e?: number; alpha?: number; rough?: number; metal?: number } = {}) {
        const m = new PBRMaterial(name, this.scene);
        m.albedoColor = Color3.FromHexString(c).toLinearSpace(); m.metallic = o.metal ?? 0; m.roughness = o.rough ?? 0.7;
        if (o.e) m.emissiveColor = Color3.FromHexString(c).toLinearSpace().scale(o.e);
        if (o.alpha !== undefined) { m.alpha = o.alpha; m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND; }
        return m;
    }
    private box(name: string, w: number, h: number, d: number, x: number, y: number, z: number, m: PBRMaterial, parent: TransformNode, ry = 0) {
        const b = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, this.scene);
        b.position.set(x, y, z); b.rotation.y = ry; b.material = m; b.parent = parent; b.isPickable = false;
        return b;
    }
    /** a text sign (canvas lines) on a plane `w` x `h`, its front toward -z of `parent` */
    private sign(lines: [string, string, number][], w: number, h: number, bg: string, parent: TransformNode, x: number, y: number, z: number, ry: number) {
        const tex = new DynamicTexture("volcSign", { width: 512, height: Math.round(512 * h / w) }, this.scene, true);
        const g = tex.getContext() as CanvasRenderingContext2D, H = tex.getSize().height;
        g.fillStyle = bg; g.fillRect(0, 0, 512, H); g.strokeStyle = "#ffcf6a"; g.lineWidth = 8; g.strokeRect(5, 5, 502, H - 10);
        g.textAlign = "center"; g.textBaseline = "middle";
        lines.forEach(([t, c, fs], i) => { g.fillStyle = c; g.font = `800 ${fs}px system-ui, sans-serif`; g.fillText(t, 256, (H / (lines.length + 0.4)) * (i + 0.7)); });
        tex.update();
        // (drawn mirror-wise on this side of the plane: flip it back)
        tex.wrapU = Texture.WRAP_ADDRESSMODE; tex.uScale = -1;
        const p = MeshBuilder.CreatePlane("volcSignP", { width: w, height: h }, this.scene);
        // (one-sided: from behind, a sign would read backwards)
        const m = new StandardMaterial("volcSignM", this.scene); m.disableLighting = true; m.emissiveTexture = tex; m.diffuseColor = Color3.Black(); m.backFaceCulling = true;
        // (a plane's front faces +z here: `ry` says which way the sign's reader looks at it)
        p.material = m; p.parent = parent; p.position.set(x, y, z); p.rotation.y = ry + Math.PI; p.isPickable = false;
        return p;
    }
    private buildButton(x: number, y: number, z: number, col: string, title: string, sub: string, face: { x: number; z: number }) {
        const n = new TransformNode("volcBtn", this.scene); n.parent = this.root; n.position.set(x, y, z);
        n.rotation.y = Math.atan2(face.x - x, face.z - z);
        const stone = this.mat("volcBtnStone", "#3b3533", { rough: 0.9 });
        const c = MeshBuilder.CreateCylinder("volcBtnBase", { height: 1.0, diameterTop: 0.9, diameterBottom: 1.2, tessellation: 8 }, this.scene); c.parent = n; c.position.y = 0.5; c.material = stone;
        const cap = MeshBuilder.CreateCylinder("volcBtnCap", { height: 0.2, diameter: 0.6, tessellation: 20 }, this.scene); cap.parent = n; cap.position.y = 1.08; cap.material = this.mat("volcBtnRed", col, { e: 0.6 });
        const rim = MeshBuilder.CreateCylinder("volcBtnRim", { height: 0.06, diameter: 0.78, tessellation: 20 }, this.scene); rim.parent = n; rim.position.y = 1.01; rim.material = this.mat("volcBtnBrass", "#c9a24a", { metal: 0.8, rough: 0.35 });
        // (its sign faces you as you come from the start)
        this.sign([[title, "#ffdf8a", 110], [sub, "#ffffff", 46]], 1.4, 0.6, "#2a1410", n, 0, 1.75, 0, Math.PI);
    }
    private buildArch(x: number, y: number, z: number, ry: number) {
        const n = new TransformNode("volcArch", this.scene); n.parent = this.root; n.position.set(x, y, z); n.rotation.y = ry;
        const st = this.mat("volcArchStone", "#5a4a40", { rough: 0.9 });
        this.box("volcArchL", 0.5, 3, 0.6, -1, 1.5, 0, st, n); this.box("volcArchR", 0.5, 3, 0.6, 1, 1.5, 0, st, n); this.box("volcArchT", 2.6, 0.5, 0.6, 0, 3.2, 0, st, n);
        this.box("volcArchGlow", 1.5, 2.9, 0.1, 0, 1.45, 0, this.mat("volcArchG", "#6fd6ff", { e: 1.2, alpha: 0.7 }), n);
        this.sign([["SECRET ROOM", "#ffdf8a", 64], ["the way home", "#ffffff", 40]], 1.6, 0.5, "#18222a", n, 0, 3.75, 0.32, Math.PI);
        this.sign([["SECRET ROOM", "#ffdf8a", 64], ["the way home", "#ffffff", 40]], 1.6, 0.5, "#18222a", n, 0, 3.75, -0.32, 0);
        this.walls.push({ x: x + Math.cos(ry) * -1, z: z - Math.sin(ry) * -1, hl: 0.35, hw: 0.4, rot: 0, y0: -1, y1: 4 }, { x: x + Math.cos(ry) * 1, z: z - Math.sin(ry) * 1, hl: 0.35, hw: 0.4, rot: 0, y0: -1, y1: 4 });
    }
    private buildStation() {
        const a = this.stationAng, rc = rIn(TOP) + 0.9 + 3.2;
        const n = new TransformNode("volcStation", this.scene); n.parent = this.root;
        n.position.set(Math.cos(a) * rc, TOP, Math.sin(a) * rc);
        // its local z points out of the caldera, x along the rim
        const ry = Math.atan2(Math.cos(a), Math.sin(a));
        n.rotation.y = ry;
        const W = 8.4, D = 6.4, H = 3.3, T = 0.22;
        const wall = this.mat("volcStWall", "#d9dcd6", { rough: 0.55, metal: 0.25 }), stripe = this.mat("volcStStripe", "#e8641e", { rough: 0.5 });
        const glass = this.mat("volcStGlass", "#5f8fa8", { alpha: 0.35, rough: 0.05, metal: 0.4 }), dark = this.mat("volcStDark", "#2d3338", { rough: 0.6 });
        const floor = this.mat("volcStFloor", "#6d6a64", { rough: 0.8 });
        this.box("volcStFloor", W, 0.12, D, 0, 0.06, 0, floor, n);
        this.box("volcStRoof", W + 0.6, 0.25, D + 0.6, 0, H + 0.12, 0, wall, n);
        this.box("volcStRoofStripe", W + 0.62, 0.2, D + 0.62, 0, H - 0.05, 0, stripe, n);
        // the front (toward the caldera): a doorway in the middle, windows either side, and the big clock above
        const fz = -D / 2;
        for (const s of [-1, 1]) {
            this.box("volcStFront", (W - 1.8) / 2, H, T, s * (0.9 + (W - 1.8) / 4), H / 2, fz, wall, n);
            this.box("volcStWin", 2, 1.1, T + 0.04, s * 2.6, 1.7, fz, glass, n);
        }
        this.box("volcStLintel", 1.8, H - 2.4, T, 0, 2.4 + (H - 2.4) / 2, fz, wall, n);
        // the back: a wide window over the sea; the side toward the helipad: another doorway
        this.box("volcStBack", W, H, T, 0, H / 2, D / 2, wall, n);
        this.box("volcStBackWin", 5, 1.2, T + 0.04, 0, 1.9, D / 2, glass, n);
        const pd = this.padAng > a ? 1 : -1;
        this.box("volcStSideA", T, H, D, -pd * W / 2, H / 2, 0, wall, n);
        for (const s of [-1, 1]) this.box("volcStSideB", T, H, (D - 1.8) / 2, pd * W / 2, H / 2, s * (0.9 + (D - 1.8) / 4), wall, n);
        this.box("volcStSideL", T, H - 2.4, 1.8, pd * W / 2, 2.4 + (H - 2.4) / 2, 0, wall, n);
        // gear: a dish on the roof, an antenna, crates
        const dish = MeshBuilder.CreateSphere("volcDish", { diameter: 2.2, slice: 0.4, segments: 12 }, this.scene); dish.parent = n; dish.position.set(-2.5, H + 1.3, 1.5); dish.rotation.x = -1.0; dish.material = wall;
        this.box("volcDishPole", 0.15, 1.2, 0.15, -2.5, H + 0.7, 1.5, dark, n);
        this.box("volcAntenna", 0.08, 3.5, 0.08, 3.2, H + 1.9, 2.2, dark, n);
        for (const [cx, cz] of [[-3.4, 2.3], [-2.6, 2.4]]) this.box("volcCrate", 0.7, 0.7, 0.7, cx, 0.47, cz, this.mat("volcCrateM", "#7a6648"), n);
        // the console with the STOP button, and the screen behind it
        this.box("volcConsole", 2.4, 1.0, 0.8, 0, 0.5, 1.0, dark, n);
        const cap = MeshBuilder.CreateCylinder("volcStop", { height: 0.12, diameter: 0.5, tessellation: 20 }, this.scene); cap.parent = n; cap.position.set(0, 1.06, 1.0); cap.material = this.mat("volcStopM", "#e0261a", { e: 0.8 });
        const lp = (lx: number, ly: number, lz: number) => new Vector3(n.position.x + Math.cos(ry) * lx + Math.sin(ry) * lz, ly + TOP, n.position.z - Math.sin(ry) * lx + Math.cos(ry) * lz);
        this.stopBtn.copyFrom(lp(0, 1.1, 1.0));
        this.sign([["STOP", "#ffffff", 120], ["the clock", "#ffd9a0", 54]], 0.9, 0.42, "#7a1410", n, 0, 1.5, 0.58, 0);
        const scr = MeshBuilder.CreatePlane("volcInScreen", { width: 4.2, height: 2.6 }, this.scene);
        const sm = new StandardMaterial("volcInM", this.scene); sm.disableLighting = true; sm.emissiveTexture = this.inTex; sm.diffuseColor = Color3.Black(); sm.backFaceCulling = false;
        scr.material = sm; scr.parent = n; scr.position.set(0, 1.95, D / 2 - 0.16); scr.rotation.y = Math.PI; scr.isPickable = false;
        // the big clock over the doorway, facing the caldera, seen from all the way down
        const big = MeshBuilder.CreatePlane("volcBigScreen", { width: 6.6, height: 2.48 }, this.scene);
        const bm = new StandardMaterial("volcBigM", this.scene); bm.disableLighting = true; bm.emissiveTexture = this.bigTex; bm.diffuseColor = Color3.Black(); bm.backFaceCulling = false;
        big.material = bm; big.parent = n; big.position.set(0, H + 1.55, fz - 0.3); big.rotation.y = Math.PI; big.isPickable = false;
        this.box("volcBigFrame", 6.9, 2.75, 0.2, 0, H + 1.55, fz - 0.15, dark, n);
        // the way home, inside
        const exit = lp(-pd * (W / 2 - 1.3), 0, 1.6);
        this.exitStation.set(exit.x, TOP + 1.2, exit.z);
        const door = this.box("volcStExit", 1.3, 2.3, 0.12, -pd * (W / 2 - 0.15), 1.15, 1.6, this.mat("volcStExitM", "#2d6f7a", { e: 0.25 }), n, Math.PI / 2);
        void door;
        this.sign([["SECRET ROOM", "#ffdf8a", 64], ["the way home", "#ffffff", 40]], 1.3, 0.42, "#18222a", n, -pd * (W / 2 - 0.25), 2.65, 1.6, -pd * Math.PI / 2);
        // walls to bump into (in caldera-local terms)
        const wallBox = (lx: number, lz: number, w: number, d: number) => { const c = lp(lx, 0, lz); this.walls.push({ x: c.x, z: c.z, hl: w / 2, hw: d / 2, rot: -ry, y0: TOP - 1, y1: TOP + H }); };
        for (const s of [-1, 1]) wallBox(s * (0.9 + (W - 1.8) / 4), fz, (W - 1.8) / 2, T + 0.1);
        wallBox(0, D / 2, W, T + 0.1);
        wallBox(-pd * W / 2, 0, T + 0.1, D);
        for (const s of [-1, 1]) wallBox(pd * W / 2, s * (0.9 + (D - 1.8) / 4), T + 0.1, (D - 1.8) / 2);
        wallBox(0, 1.0, 2.4, 0.8);
        // the helipad
        const pr = 43, pa = this.padAng;
        this.padPos.set(Math.cos(pa) * pr, TOP + 0.25, Math.sin(pa) * pr);
        this.padYaw = Math.atan2(Math.cos(pa + Math.PI / 2), Math.sin(pa + Math.PI / 2));
        const pad = MeshBuilder.CreateCylinder("volcPad", { height: 0.25, diameter: 10, tessellation: 40 }, this.scene);
        pad.parent = this.root; pad.position.set(this.padPos.x, TOP + 0.125, this.padPos.z); pad.material = this.mat("volcPadM", "#3c4045", { rough: 0.8 });
        const ring = MeshBuilder.CreateTorus("volcPadRing", { diameter: 8.4, thickness: 0.25, tessellation: 40 }, this.scene);
        ring.parent = this.root; ring.position.set(this.padPos.x, TOP + 0.26, this.padPos.z); ring.scaling.y = 0.05; ring.material = this.mat("volcPadY", "#f2c23a", { e: 0.2 });
        const hp = this.sign([["H", "#f2f2f2", 300]], 3.2, 3.2, "#3c4045", this.root, this.padPos.x, TOP + 0.27, this.padPos.z, 0);
        hp.rotation.x = Math.PI / 2; hp.rotation.y = this.padYaw;
        // a low railing round the rim's inner edge (open where the course comes up)
        const rail = this.mat("volcRail", "#c8a24a", { metal: 0.7, rough: 0.4 });
        const posts: Mesh[] = [];
        const rr = rIn(TOP) + 0.55;
        for (let i = 0; i < 160; i++) {
            const t = (i / 160) * Math.PI * 2;
            if (this.inGap(t)) continue;
            const p = MeshBuilder.CreateBox("volcPost", { width: 0.08, height: 1.0, depth: 0.08 }, this.scene); p.position.set(Math.cos(t) * rr, TOP + 0.5, Math.sin(t) * rr); posts.push(p);
            const t2 = ((i + 1) / 160) * Math.PI * 2;
            if (!this.inGap(t2)) {
                const len = 2 * rr * Math.sin(Math.PI / 160) + 0.04;
                const b = MeshBuilder.CreateBox("volcBar", { width: len, height: 0.07, depth: 0.07 }, this.scene);
                const mid = (t + t2) / 2; b.position.set(Math.cos(mid) * rr, TOP + 1.0, Math.sin(mid) * rr); b.rotation.y = -(mid + Math.PI / 2); posts.push(b);
            }
        }
        const rails = Mesh.MergeMeshes(posts, true, true)!; rails.name = "volcRails"; rails.material = rail; rails.parent = this.root;
    }
    /** the opening in the railing where the course arrives */
    private inGap(t: number) { let d = (t - this.arrive) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return Math.abs(d) < 0.055; }
    private beacon!: Mesh;
    private buildHeli() {
        const h = this.heli, sc = this.scene;
        const red = this.mat("volcHeliRed", "#c42a1c", { rough: 0.35, metal: 0.35 }), white = this.mat("volcHeliWhite", "#f0f0ec", { rough: 0.35, metal: 0.3 });
        const dark = this.mat("volcHeliDark", "#22272b", { rough: 0.5, metal: 0.55 }), glass = this.mat("volcHeliGlass", "#86c2e2", { alpha: 0.28, rough: 0.04, metal: 0.5 });
        const steel = this.mat("volcHeliSteel", "#9aa3aa", { rough: 0.3, metal: 0.85 }), seat = this.mat("volcHeliSeat", "#33414f", { rough: 0.8 });
        const glow = (n: string, c: string) => { const m = new StandardMaterial(n, sc); m.disableLighting = true; m.emissiveColor = Color3.FromHexString(c); return m; };
        const put = (m: Mesh, mat: PBRMaterial | StandardMaterial, x: number, y: number, z: number, parent: TransformNode = h) => { m.material = mat; m.parent = parent; m.position.set(x, y, z); m.isPickable = false; return m; };
        // ---- the hull: a rounded red belly and chin round an open cabin (floor at 0.6), a white stripe down each side
        put(MeshBuilder.CreateSphere("hHull", { diameterX: 2.8, diameterY: 1.3, diameterZ: 6.0, segments: 20 }, sc), red, 0, 0.3, -0.3);
        put(MeshBuilder.CreateSphere("hChin", { diameterX: 2.5, diameterY: 1.2, diameterZ: 2.2, segments: 16 }, sc), red, 0, 0.75, 1.5);
        this.box("hFloor", 2.5, 0.16, 3.8, 0, 0.55, -0.4, dark, h);
        for (const sd of [-1, 1]) this.box("hStripe", 0.04, 0.16, 5.0, sd * 1.38, 0.62, -0.4, white, h);
        // the roof and the engine on top of it
        put(MeshBuilder.CreateSphere("hRoof", { diameterX: 2.75, diameterY: 0.7, diameterZ: 4.4, segments: 18 }, sc), white, 0, 2.62, -0.35);
        const cowl = put(MeshBuilder.CreateCapsule("hCowl", { radius: 0.55, height: 2.9, tessellation: 14, subdivisions: 2 }, sc), white, 0, 3.0, -0.7); cowl.rotation.x = Math.PI / 2;
        this.box("hCowlStripe", 1.12, 0.12, 2.2, 0, 2.95, -0.7, red, h);
        for (const sd of [-1, 1]) { const ex = put(MeshBuilder.CreateCylinder("hExhaust", { height: 0.5, diameter: 0.26, tessellation: 10 }, sc), dark, sd * 0.32, 3.05, -2.2); ex.rotation.x = Math.PI / 2 + 0.3; }
        for (const sd of [-1, 1]) this.box("hIntake", 0.04, 0.26, 0.6, sd * 0.56, 3.05, 0.2, dark, h);
        // the back wall with a round window, the door frames, and the sliding doors pushed back along the sides
        this.box("hBack", 2.5, 2.0, 0.14, 0, 1.6, -2.3, white, h);
        put(MeshBuilder.CreateDisc("hPort", { radius: 0.28, tessellation: 18 }, sc), dark, 0, 1.75, -2.38).rotation.y = Math.PI;
        for (const sd of [-1, 1]) {
            for (const z of [-2.25, 0.95]) this.box("hPillar", 0.12, 2.05, 0.14, sd * 1.25, 1.6, z, white, h);
            const door = this.box("hDoor", 0.07, 1.85, 1.6, sd * 1.43, 1.55, -2.85, red, h);
            void door;
            this.box("hDoorWin", 0.08, 0.6, 0.9, sd * 1.43, 1.95, -2.85, dark, h);
            this.box("hRail", 0.05, 0.05, 2.6, sd * 1.4, 2.5, -1.2, steel, h);
            // (RESCUE on the doors, read from outside)
            this.sign([["RESCUE", "#ffffff", 120]], 1.3, 0.34, "#c42a1c", h, sd * 1.475, 1.25, -2.85, sd > 0 ? Math.PI / 2 : -Math.PI / 2);
        }
        // the nose: a glass bubble over the cockpit, the instrument panel glowing behind it
        const nose = put(MeshBuilder.CreateSphere("hNose", { diameterX: 2.55, diameterY: 2.1, diameterZ: 2.5, segments: 18, slice: 0.5 }, sc), glass, 0, 1.45, 1.0); nose.rotation.x = Math.PI / 2;
        this.box("hDash", 2.0, 0.5, 0.45, 0, 1.05, 1.55, dark, h);
        for (const x of [-0.55, 0, 0.55]) put(MeshBuilder.CreatePlane("hScreen", { width: 0.4, height: 0.24 }, sc), glow("hScreenM", x === 0 ? "#3fe0a0" : "#58b4ff"), x, 1.33, 1.32).rotation.x = -0.5;
        this.box("hStick", 0.05, 0.5, 0.05, 0, 0.85, 1.1, dark, h);
        // the benches, with backs
        for (const sd of [-1, 1]) { this.box("hBench", 0.55, 0.12, 2.6, sd * 0.92, 0.95, -0.85, seat, h); this.box("hBenchBack", 0.1, 0.6, 2.6, sd * 1.17, 1.3, -0.85, seat, h); }
        // ---- the tail: a tapered boom with a band, a swept fin, a tailplane with end plates, a two-blade rotor and a skid
        const boom = put(MeshBuilder.CreateCylinder("hBoom", { height: 6.6, diameterTop: 0.32, diameterBottom: 0.95, tessellation: 14 }, sc), red, 0, 2.15, -5.3); boom.rotation.x = -Math.PI / 2 - 0.05;
        const band = put(MeshBuilder.CreateCylinder("hBand", { height: 0.5, diameterTop: 0.62, diameterBottom: 0.7, tessellation: 14 }, sc), white, 0, 2.18, -4.6); band.rotation.x = -Math.PI / 2 - 0.05;
        const fin = this.box("hFin", 0.1, 1.7, 0.95, 0, 2.95, -8.35, red, h); fin.rotation.x = -0.4;
        this.box("hStab", 2.1, 0.08, 0.55, 0, 2.3, -7.6, white, h);
        for (const sd of [-1, 1]) this.box("hEnd", 0.06, 0.45, 0.5, sd * 1.05, 2.35, -7.6, red, h);
        this.box("hTailSkid", 0.05, 0.6, 0.05, 0, 1.75, -8.4, steel, h).rotation.x = 0.4;
        this.tailRotor.parent = h; this.tailRotor.position.set(0.16, 3.1, -8.55);
        put(MeshBuilder.CreateCylinder("hTailHub", { height: 0.12, diameter: 0.16, tessellation: 10 }, sc), dark, 0, 0, 0, this.tailRotor).rotation.z = Math.PI / 2;
        for (const r of [0, Math.PI / 2]) { const bl = this.box("hTailBlade", 0.03, 1.5, 0.11, 0.04, 0, 0, dark, this.tailRotor); bl.rotation.x = r; }
        // ---- skids: two long tubes turned up at the front, on curved legs
        for (const sd of [-1, 1]) {
            const sk = put(MeshBuilder.CreateCylinder("hSkid", { height: 4.0, diameter: 0.11, tessellation: 10 }, sc), steel, sd * 1.3, 0.06, -0.4); sk.rotation.x = Math.PI / 2;
            const tip = put(MeshBuilder.CreateCylinder("hSkidTip", { height: 0.5, diameter: 0.11, tessellation: 10 }, sc), steel, sd * 1.3, 0.2, 1.75); tip.rotation.x = Math.PI / 2 - 0.6;
            for (const z of [-1.5, 0.8]) { const leg = this.box("hLeg", 0.07, 0.75, 0.07, sd * 1.15, 0.38, z, steel, h); leg.rotation.z = sd * 0.35; }
        }
        // ---- lights: a red beacon on top (it blinks), red and green on the tailplane, a searchlight under the nose
        this.beacon = put(MeshBuilder.CreateSphere("hBeacon", { diameter: 0.18, segments: 8 }, sc), glow("hBeaconM", "#ff2a1a"), 0, 3.55, -1.6);
        put(MeshBuilder.CreateSphere("hNavR", { diameter: 0.12, segments: 6 }, sc), glow("hNavRM", "#ff2a1a"), -1.1, 2.32, -7.6);
        put(MeshBuilder.CreateSphere("hNavG", { diameter: 0.12, segments: 6 }, sc), glow("hNavGM", "#2aff5a"), 1.1, 2.32, -7.6);
        put(MeshBuilder.CreateCylinder("hSearch", { height: 0.2, diameterTop: 0.34, diameterBottom: 0.24, tessellation: 14 }, sc), glow("hSearchM", "#fff6d8"), 0, 0.12, 1.7);
        // ---- the main rotor: a hub, four blades with a little droop, and the blur disc they turn into at speed
        this.rotor.parent = h; this.rotor.position.set(0, 3.55, -0.5);
        put(MeshBuilder.CreateCylinder("hMast", { height: 0.5, diameter: 0.2, tessellation: 10 }, sc), steel, 0, -0.2, 0, this.rotor);
        put(MeshBuilder.CreateCylinder("hHub", { height: 0.18, diameter: 0.55, tessellation: 12 }, sc), dark, 0, 0.05, 0, this.rotor);
        for (let i = 0; i < 4; i++) {
            const arm = new TransformNode("hBladeArm", sc); arm.parent = this.rotor; arm.rotation.y = (i * Math.PI) / 2;
            const bl = MeshBuilder.CreateBox("hBlade", { width: 0.34, height: 0.05, depth: 6.0 }, sc);
            bl.material = dark; bl.parent = arm; bl.position.set(0, 0.0, 3.1); bl.rotation.x = 0.025; bl.isPickable = false;
            this.blades.push(bl);
        }
        this.rotorDisc = MeshBuilder.CreateDisc("hRotorDisc", { radius: 6.2, tessellation: 40 }, sc);
        const dm = new StandardMaterial("hRotorDiscM", sc); dm.disableLighting = true; dm.emissiveColor = new Color3(0.12, 0.13, 0.14); dm.alpha = 0.5; dm.backFaceCulling = false; dm.disableDepthWrite = true;
        put(this.rotorDisc, dm, 0, 0.06, 0, this.rotor).rotation.x = Math.PI / 2;
        this.rotorDisc.visibility = 0;
        for (const m of h.getChildMeshes()) m.isPickable = false;
        this.heliAt.copyFrom(this.padPos); this.heliYaw = this.padYaw;
    }
    /** a seat in the cabin, in caldera-local terms */
    private seatPos(i: number, out: Vector3) {
        const lx = (i % 2 ? 1 : -1) * 0.55, lz0 = 0.6 - Math.floor(i / 2) * 1.0, c = Math.cos(this.heliYaw), s = Math.sin(this.heliYaw);
        // (the cabin's tilt too: nose down as it speeds away)
        const pt = this.heliT0 >= 0 ? this.heliPitch + Math.sin((this.now() - this.heliT0) * 0.9) * 0.02 : 0;
        const ly = 0.63 * Math.cos(pt) - lz0 * Math.sin(pt), lz = 0.63 * Math.sin(pt) + lz0 * Math.cos(pt);
        out.set(this.heliAt.x + c * lx + s * lz, this.heliAt.y + ly, this.heliAt.z - s * lx + c * lz);
        return out;
    }

    // ---------------------------------------------------------------- the run's clock and the lava
    private now() { return performance.now() / 1000; }
    /** seconds since START (0 when idle) */
    private el() { return this.phase === "run" ? this.now() - this.t0 : 0; }
    /** when the volcano blows (seconds since START): the helicopter's departure decides, or the lava reaching the rim */
    private eruptAt() { const natural = GRACE + RISE; return this.heliT0 >= 0 ? Math.min(natural, this.heliT0 - this.t0 + ERUPT_AFTER) : natural; }
    /** the lava's height (local) */
    lavaY() {
        if (this.phase !== "run") return -1.5;
        const t = this.el(), base = t < GRACE ? -1.5 : -1.5 + (TOP + 1.5) * Math.min(1, (t - GRACE) / RISE);
        const er = this.eruptAt();
        // (brim-full when it blows: it goes up, not over the sides)
        if (t >= er) return TOP - 0.25;
        if (this.heliT0 >= 0) {
            const h0 = this.heliT0 - this.t0 + 3;
            if (t > h0) { const k = Math.min(1, (t - h0) / Math.max(1, er - h0)); return Math.max(base, base + (TOP - 0.6 - base) * k * k * (3 - 2 * k)); }
        }
        return base;
    }
    /** geyser `k` (they come every 2.4 s once the lava is up): where, how high; the same everywhere */
    private geyser(k: number) {
        const R = rng(9000 + k * 7919), a = R() * Math.PI * 2;
        return { a, r: 6 + R() * (R0 - 9), h: 7 + R() * 9 };
    }

    // ---------------------------------------------------------------- the player's ground
    /** the level (wide enough for the helicopter's flight out over the sea) */
    contains(x: number, z: number) { return Math.hypot(x - VX, z - VZ) < 600; }
    private bobTop(p: Plat) { return p.bob ? p.top + Math.sin((Date.now() / 1000 / p.bob.per) * Math.PI * 2 + p.bob.ph) * p.bob.amp : p.top; }
    private inPlat(p: Plat, lx: number, lz: number, pad: number) {
        if (p.kind === "pillar") return Math.hypot(lx - p.x, lz - p.z) <= p.hl + pad;
        const dx = lx - p.x, dz = lz - p.z, c = Math.cos(p.rot), s = Math.sin(p.rot);
        return Math.abs(dx * c + dz * s) <= p.hl + pad && Math.abs(-dx * s + dz * c) <= p.hw + pad;
    }
    /** the lava's surface to swim in (world y), inside the caldera while a run is on */
    liquidAt(x: number, z: number): number | null {
        if (this.phase !== "run") return null;
        const L = this.lavaY();
        if (L < 0.2) return null;
        return Math.hypot(x - VX, z - VZ) < rIn(Math.min(TOP, Math.max(0, L))) + 0.5 ? BASE + L : null;
    }
    /** 0..1: the warm glow while you swim in the lava (it does not hurt) */
    heat = 0;
    /** your head is under the lava (main tints the view orange) */
    get submerged() { const p = this.player; if (!p || !this.active) return false; const s = this.liquidAt(p.pos.x, p.pos.z); return s !== null && p.pos.y + 1.6 < s; }
    floor(x: number, z: number, y: number) {
        const lx = x - VX, lz = z - VZ, ly = y - BASE, r = Math.hypot(lx, lz);
        let best = -200;
        if (r < rIn(TOP)) best = 0;
        if (r >= rIn(TOP) - 0.05 && TOP <= ly + STEP) best = TOP;
        if (r > RIM_OUT) best = Math.max(best, TOP);
        if (Math.hypot(lx - this.padPos.x, lz - this.padPos.z) < 5 && TOP + 0.25 <= ly + STEP) best = Math.max(best, TOP + 0.25);
        for (const p of this.plats) {
            const top = this.bobTop(p);
            if (top > best && top <= ly + STEP && this.inPlat(p, lx, lz, 0.05)) best = top;
        }
        return BASE + best;
    }
    resolve(x: number, z: number, rad: number, feetY: number, out: { x: number; z: number }) {
        let lx = x - VX, lz = z - VZ;
        const ly = feetY - BASE;
        let r = Math.hypot(lx, lz);
        // up on the rim: stay on it; down in the caldera: its wall holds you in (unless the rim is a step up from here: then
        // you can walk out onto it)
        if (ly < TOP - STEP && r <= rIn(TOP) + 0.2) {
            const max = rIn(Math.max(0, ly)) - rad * 0.9;
            if (r > max) { lx *= max / r; lz *= max / r; r = max; }
        } else {
            const max = RIM_OUT - 0.6;
            if (r > max) { lx *= max / r; lz *= max / r; r = max; }
            // the railing on the rim's inner edge
            if (ly > TOP - 0.15 && r < rIn(TOP) + 0.55 + rad && !this.inGap(Math.atan2(lz, lx))) { const want = rIn(TOP) + 0.55 + rad; lx *= want / r; lz *= want / r; r = want; }
        }
        // platforms too high to step onto are walls
        for (const p of this.plats) {
            const top = this.bobTop(p);
            if (top <= ly + STEP || p.bottom >= ly + 1.7) continue;
            if (!this.inPlat(p, lx, lz, rad)) continue;
            if (p.kind === "pillar") {
                const dx = lx - p.x, dz = lz - p.z, d = Math.hypot(dx, dz) || 1e-3, want = p.hl + rad;
                lx = p.x + (dx / d) * want; lz = p.z + (dz / d) * want;
            } else this.pushOut(lx, lz, rad, p.x, p.z, p.hl, p.hw, p.rot, (a, b) => { lx = a; lz = b; });
        }
        for (const w of this.walls) {
            if (w.y1 <= ly || w.y0 >= ly + 1.7) continue;
            this.pushOut(lx, lz, rad, w.x, w.z, w.hl, w.hw, w.rot, (a, b) => { lx = a; lz = b; });
        }
        // the helicopter on its pad
        if (this.heliT0 < 0 && ly > TOP - 1) this.pushOut(lx, lz, rad, this.heliAt.x, this.heliAt.z, 2.2, 1.4, Math.PI / 2 - this.heliYaw, (a, b) => { lx = a; lz = b; });
        out.x = lx + VX; out.z = lz + VZ;
    }
    /** push a circle out of an oriented rectangle */
    private pushOut(px: number, pz: number, rad: number, cx: number, cz: number, hl: number, hw: number, rot: number, set: (x: number, z: number) => void) {
        const c = Math.cos(rot), s = Math.sin(rot), dx = px - cx, dz = pz - cz;
        const u = dx * c + dz * s, v = -dx * s + dz * c, eu = hl + rad, ev = hw + rad;
        if (Math.abs(u) >= eu || Math.abs(v) >= ev) return;
        let nu = u, nv = v;
        if (eu - Math.abs(u) < ev - Math.abs(v)) nu = Math.sign(u || 1) * eu; else nv = Math.sign(v || 1) * ev;
        set(cx + nu * c - nv * s, cz + nu * s + nv * c);
    }

    // ---------------------------------------------------------------- coming and going
    private setVisible(on: boolean) {
        this.root.setEnabled(on);
        for (const g of this.geysers) g.ps.emitRate = 0;
        if (!on) { this.fountain.emitRate = this.bombs.emitRate = this.smoke.emitRate = this.embers.emitRate = 0; if (this.stem) this.stem.emitRate = this.cap.emitRate = this.surge.emitRate = 0; this.sfx?.rotor(0, 0); }
    }
    enter(p: { teleport(x: number, y: number, z: number, yaw: number): void; cave: unknown }) {
        this.active = true; this.setVisible(true); p.cave = this;
        this.dead = false; this.finished = false; this.mySeat = -1;
        if (this.phase === "run") {
            // (a run is on: watch it from the rim)
            const a = this.stationAng - 0.2, r = rIn(TOP) + 2;
            p.teleport(VX + Math.cos(a) * r, BASE + TOP, VZ + Math.sin(a) * r, Math.atan2(Math.cos(a), Math.sin(a)));
            this.say("A run is on! Watch from the rim, or wait for the next one.");
        } else {
            p.teleport(VX + this.spawn.x, BASE, VZ + this.spawn.z, this.spawn.yaw);
            this.say("Floris Lava: climb the caldera walls to the research station at the top. Press START when you are ready.");
        }
    }
    leave(p: { cave: unknown; ride: unknown }) {
        if (this.mySeat >= 0) { this.mySeat = -1; this.send({ k: "vh", s: -1, r: 0 }); }
        p.ride = null;
        this.active = false; this.setVisible(false); p.cave = null; this.hud.style.display = "none";
    }

    // ---------------------------------------------------------------- aiming and pressing
    private rayHit(eye: V3, dir: V3, c: V3, rad: number, reach: number) {
        const dx = c.x - eye.x, dy = c.y - eye.y, dz = c.z - eye.z, t = dx * dir.x + dy * dir.y + dz * dir.z;
        if (t < 0 || t > reach) return null;
        const px = dx - dir.x * t, py = dy - dir.y * t, pz = dz - dir.z * t;
        return px * px + py * py + pz * pz <= rad * rad ? t : null;
    }
    pick(eye: V3, dir: V3, reach: number, assist = 1): { t: LavaTarget; dist: number } | null {
        if (!this.active) return null;
        reach = Math.max(reach, 3.4);
        const w = (v: Vector3) => ({ x: v.x + VX, y: v.y + BASE, z: v.z + VZ });
        let best: { t: LavaTarget; dist: number } | null = null;
        const tryIt = (t: LavaTarget, c: V3, rad: number, rch = reach) => { const d = this.rayHit(eye, dir, c, rad * assist, rch); if (d != null && (!best || d < best.dist)) best = { t, dist: d }; };
        tryIt({ w: "start" }, w(this.startBtn), 0.6);
        tryIt({ w: "exit" }, w(this.exitFloor), 1.3);
        tryIt({ w: "exit" }, w(this.exitStation), 1.0);
        tryIt({ w: "stop" }, w(this.stopBtn), 0.5);
        if (this.heliT0 < 0) tryIt({ w: "heli" }, { x: this.heliAt.x + VX, y: this.heliAt.y + BASE + 1.4, z: this.heliAt.z + VZ }, 2.4, reach + 2.5);
        return best;
    }
    prompt(t: LavaTarget): { name: string; hint: string; ok: boolean } {
        switch (t.w) {
            case "exit": return { name: "Way home", hint: "<b>E</b> back to the secret room", ok: true };
            case "start":
                return this.phase === "idle" ? { name: "START", hint: "<b>E</b> start the clock · the lava comes after a head start", ok: true } : { name: "START", hint: "A run is on!", ok: false };
            case "stop": {
                if (this.phase !== "run") return { name: "STOP", hint: "Start a run at the bottom first", ok: false };
                if (!this.runners.has(this.myId())) return { name: "STOP", hint: "You were not in this run", ok: false };
                if (this.finished) return { name: "STOP", hint: "Your time is in!", ok: false };
                return { name: "STOP", hint: "<b>E</b> stop your clock", ok: true };
            }
            case "heli": {
                const n = this.seats.size, rdy = [...this.seats.values()].filter((s) => s.ready).length;
                if (this.phase !== "run") return { name: "Rescue helicopter", hint: "It flies once a run is on", ok: false };
                if (this.dead) return { name: "Rescue helicopter", hint: "Too late for you", ok: false };
                if (this.mySeat >= 0) return { name: "Rescue helicopter", hint: `${this.seats.get(this.mySeat)?.ready ? "<b>E</b> not ready yet" : "<b>E</b> I'm ready!"} · ${rdy}/${n} ready · it goes when everybody on board is ready · <b>jump</b> to get out`, ok: true };
                return n >= SEATS ? { name: "Rescue helicopter", hint: "Full!", ok: false } : { name: "Rescue helicopter", hint: `<b>E</b> climb aboard · ${n}/${SEATS} on board`, ok: true };
            }
        }
    }
    interact(t: LavaTarget): "exit" | null {
        switch (t.w) {
            case "exit": return "exit";
            case "start": if (this.phase === "idle") this.startRun(); break;
            case "stop": if (this.phase === "run" && this.runners.has(this.myId()) && !this.finished && !this.dead) this.finish(); break;
            case "heli":
                if (this.phase !== "run" || this.dead || this.heliT0 >= 0) break;
                if (this.mySeat >= 0) { const s = this.seats.get(this.mySeat)!; s.ready = !s.ready; this.send({ k: "vh", s: this.mySeat, r: s.ready ? 1 : 0, n: this.myName() }); this.sfx?.press(); }
                else this.board_();
                break;
        }
        return null;
    }
    /** the player whose ride this is (set by enter, for boarding) */
    player: { pos: Vector3; ride: ((dt: number) => boolean) | null; vel: Vector3; teleport(x: number, y: number, z: number, yaw: number): void; yaw: number } | null = null;
    private board_() {
        let s = -1; for (let i = 0; i < SEATS; i++) if (!this.seats.has(i)) { s = i; break; }
        if (s < 0) return;
        this.mySeat = s; this.seats.set(s, { id: this.myId(), ready: false, name: this.myName() });
        this.send({ k: "vh", s, r: 0, n: this.myName() });
        this.sfx?.press();
        const p = this.player; if (!p) return;
        const sp = new Vector3();
        p.ride = () => {
            if (this.mySeat < 0) return false;
            this.heliPose();
            this.seatPos(this.mySeat, sp);
            p.pos.set(sp.x + VX, sp.y + BASE, sp.z + VZ);
            return true;
        };
        this.say("You're aboard. Press to say you are ready - it takes off once everybody on board is ready.");
    }
    /** jump while seated: get out again (before take-off) */
    getOut() {
        if (this.mySeat < 0 || this.heliT0 >= 0) return false;
        this.seats.delete(this.mySeat); this.mySeat = -1; this.send({ k: "vh", s: -1, r: 0 });
        const p = this.player; if (p) { p.ride = null; const c = Math.cos(this.heliYaw), s = Math.sin(this.heliYaw); p.teleport(VX + this.heliAt.x + c * 2.6, BASE + TOP + 0.25, VZ + this.heliAt.z - s * 2.6, p.yaw); }
        return true;
    }
    get seated() { return this.mySeat >= 0; }

    // ---------------------------------------------------------------- the run
    private inLevelIds() {
        const ids = this.active ? [this.myId()] : [];
        for (const o of this.others()) if (this.contains(o.x, o.z)) ids.push(o.id);
        return ids.sort((a, b) => a - b);
    }
    private names() { const m = new Map<number, string>([[this.myId(), this.myName()]]); for (const o of this.others()) m.set(o.id, o.name); return m; }
    private isCtl() { const ids = this.inLevelIds(); return ids.length > 0 && ids[0] === this.myId(); }
    private startRun() {
        const names = this.names();
        this.applyState({ ph: "run", el: 0, ids: this.inLevelIds().map((i) => [i, names.get(i) ?? "Someone"]), fin: [], dead: [], seats: [], hg: -1 }, true);
        this.sfx?.press();
        this.say("GO! The clock is running - climb! The lava comes in 40 seconds.");
    }
    private finish() {
        const ms = Math.round(this.el() * 1000);
        this.finished = true;
        this.record(this.myId(), this.myName(), { ms });
        this.send({ k: "vf", ms, n: this.myName() });
        this.sfx?.win();
        this.say(`Your time: ${fmt(ms)}! Get to the helicopter before the volcano blows.`);
    }
    private die(why: string) {
        if (this.dead) return;
        this.dead = true;
        const ms = Math.round(this.el() * 1000);
        this.record(this.myId(), this.myName(), { dead: true });
        this.send({ k: "vd", ms, n: this.myName() });
        this.sfx?.burn(); this.flash?.(1); this.shake?.(0.8);
        this.say(why);
    }
    private record(id: number, name: string, r: { ms?: number; dead?: boolean; heli?: boolean }) {
        const cur = this.results.get(id) ?? { name, ms: null, dead: false, heli: false };
        if (r.ms !== undefined && cur.ms === null) cur.ms = r.ms;
        if (r.dead) cur.dead = true;
        if (r.heli) cur.heli = true;
        cur.name = name || cur.name;
        this.results.set(id, cur);
        this.screenKey = "";
    }
    private stateMsg() {
        return {
            k: "vs", ph: this.phase, el: +this.el().toFixed(2),
            ids: [...this.runners].map(([i, n]) => [i, n]),
            fin: [...this.results].filter(([, r]) => r.ms !== null).map(([i, r]) => [i, r.ms, r.name]),
            dead: [...this.results].filter(([, r]) => r.dead).map(([i, r]) => [i, r.name]),
            seats: [...this.seats].map(([s, o]) => [s, o.id, o.ready ? 1 : 0, o.name]),
            hg: this.heliT0 >= 0 ? +(this.now() - this.heliT0).toFixed(2) : -1,
        };
    }
    private endedAt = -99;
    private applyState(e: any, mine: boolean) {
        // (a word from just before the end, arriving late, must not start the run over again)
        if (!mine && e.ph === "run" && this.now() - this.endedAt < 12 && (+e.el || 0) > 3) return;
        if (e.ph === "run" && (this.phase !== "run" || this.ended)) {
            // a new run
            this.phase = "run"; this.ended = false; this.erupted = false; this.fadeK = 0; this.fadeIn = false; this.heat = 0; this.rumbled = false; this.heliT0 = -1; this.lastGeyser = -1;
            this.results.clear(); this.seats.clear(); this.runners.clear(); this.finished = false; this.dead = false;
            if (this.mySeat >= 0) { this.mySeat = -1; if (this.player) this.player.ride = null; }
        }
        if (e.ph !== "run") return;
        const t0 = this.now() - (+e.el || 0);
        if (Math.abs(t0 - this.t0) > 0.3) this.t0 = t0;
        if (Array.isArray(e.ids)) for (const [i, n] of e.ids) if (typeof i === "number") this.runners.set(i, String(n ?? "Someone").slice(0, 24));
        if (Array.isArray(e.fin)) for (const [i, ms, n] of e.fin) if (typeof i === "number" && typeof ms === "number") this.record(i, String(n ?? this.runners.get(i) ?? "Someone"), { ms });
        if (Array.isArray(e.dead)) for (const [i, n] of e.dead) if (typeof i === "number") this.record(i, String(n ?? this.runners.get(i) ?? "Someone"), { dead: true });
        if (Array.isArray(e.seats) && !mine) {
            const mine2 = this.mySeat >= 0 ? this.seats.get(this.mySeat) : undefined;
            this.seats.clear();
            for (const [s, i, r, n] of e.seats) if (typeof s === "number" && s >= 0 && s < SEATS && i !== this.myId()) this.seats.set(s, { id: i, ready: !!r, name: String(n ?? "Someone") });
            if (mine2) { if (this.seats.has(this.mySeat)) { /* (somebody else holds my seat: move along) */ const free = [...Array(SEATS).keys()].find((k) => !this.seats.has(k)); if (free !== undefined) this.mySeat = free; } this.seats.set(this.mySeat, mine2); }
        }
        if (typeof e.hg === "number" && e.hg >= 0 && this.heliT0 < 0) this.takeOff(this.now() - e.hg);
        if (mine) this.send(this.stateMsg());
        this.screenKey = "";
    }
    private takeOff(at: number) {
        this.heliT0 = at;
        for (const s of this.seats.values()) this.record(s.id, s.name, { heli: true });
        this.say(this.mySeat >= 0 ? "Lift-off! Hold on - and look down." : "The helicopter is leaving without you!");
    }
    net(e: any, from: number) {
        switch (e.k) {
            case "vs": this.applyState(e, false); break;
            case "vf": if (typeof e.ms === "number") { this.record(from, String(e.n ?? "Someone"), { ms: e.ms }); if (this.active) this.say(`${e.n ?? "Somebody"} made it to the top in ${fmt(e.ms)}!`); } break;
            case "vd": this.record(from, String(e.n ?? "Someone"), { dead: true }); if (this.active) this.say(`${e.n ?? "Somebody"} was caught by the lava!`); break;
            case "vh": {
                for (const [s, o] of this.seats) if (o.id === from && s !== e.s) this.seats.delete(s);
                if (typeof e.s === "number" && e.s >= 0 && e.s < SEATS) {
                    if (e.s === this.mySeat) { const free = [...Array(SEATS).keys()].find((k) => !this.seats.has(k) && k !== this.mySeat); if (free !== undefined) { const me = this.seats.get(this.mySeat)!; this.seats.delete(this.mySeat); this.mySeat = free; this.seats.set(free, me); } }
                    this.seats.set(e.s, { id: from, ready: !!e.r, name: String(e.n ?? "Someone") });
                }
                this.screenKey = "";
                break;
            }
        }
    }

    // ---------------------------------------------------------------- every frame
    update(dt: number, p: { pos: Vector3; vel: Vector3; yaw: number; teleport(x: number, y: number, z: number, yaw: number): void; ride: ((dt: number) => boolean) | null }, sunUp: number) {
        this.player = p;
        this.time += dt;
        this.fade(dt);
        if (!this.active) return;
        const el = this.el();
        // pistons
        for (const b of this.bobbers) { const t = this.bobTop(b); b.mesh!.position.y = (t + b.bottom) / 2; }
        // the lava
        const L = this.lavaY();
        this.lavaDisc.position.y = L;
        this.lavaDisc.scaling.setAll(rIn(Math.max(0, L)) + 1.6);
        this.lavaDisc.setEnabled(L > -1.4);
        this.embers.emitRate = this.phase === "run" && L > -1 ? 60 : 0;
        (this.embers.emitter as Vector3).set(VX, BASE + L + 0.2, VZ);
        const lx = p.pos.x - VX, lz = p.pos.z - VZ, ly = p.pos.y - BASE, pr = Math.hypot(lx, lz);
        // heat: a lava blub now and then while it is near
        if (this.phase === "run" && L > -1) { this.blubT -= dt; if (this.blubT <= 0) { this.blubT = 0.5 + Math.random() * 1.5; this.sfx?.blub(Math.max(0, 1 - (ly - L) / 25)); } }
        // geysers
        if (this.phase === "run" && el > GRACE + 4 && el < this.eruptAt()) {
            const k = Math.floor((el - GRACE - 4) / 2.4);
            if (k !== this.lastGeyser) {
                this.lastGeyser = k;
                const gs = this.geyser(k), slot = this.geysers[k % this.geysers.length];
                const rr = Math.min(gs.r, rIn(L) - 3);
                slot.x = Math.cos(gs.a) * rr; slot.z = Math.sin(gs.a) * rr; slot.top = gs.h; slot.until = el + 2.6;
                (slot.ps.emitter as Vector3).set(VX + slot.x, BASE + L, VZ + slot.z);
                slot.ps.direction1.set(-1.2, gs.h * 1.25, -1.2); slot.ps.direction2.set(1.2, gs.h * 1.6, 1.2);
                this.sfx?.geyser(Math.hypot(lx - slot.x, lz - slot.z, ly - L));
            }
        }
        for (const g of this.geysers) {
            const on = this.phase === "run" && el < g.until;
            g.ps.emitRate = on ? 260 : 0;
        }
        // the lava itself
        // the lava: you can swim in it (it does not hurt you); just a glow while you are in it
        const inLava = this.phase === "run" && !this.dead && this.mySeat < 0 && L > 0.2 && ly <= L + 0.05 && pr < rIn(Math.max(0, L)) + 0.5;
        this.heat += ((inLava ? 0.6 : 0) - this.heat) * Math.min(1, dt * 2);
        // the controller keeps everybody in step and lets the helicopter go
        if (this.phase === "run" && this.isCtl()) {
            this.stateBeat -= dt;
            if (this.stateBeat <= 0) { this.stateBeat = 2.5; this.send(this.stateMsg()); }
            if (this.heliT0 < 0 && this.seats.size > 0 && [...this.seats.values()].every((s) => s.ready) && el < this.eruptAt() - 2) { this.takeOff(this.now()); this.send(this.stateMsg()); }
        }
        // the helicopter
        this.flyHeli(dt);
        // the eruption
        const er = this.eruptAt();
        if (this.phase === "run") {
            if (!this.rumbled && el > er - 6) { this.rumbled = true; this.sfx?.rumble(7, 0.6); this.say("The ground is shaking - it's going to blow!"); }
            if (!this.erupted && el >= er) {
                this.erupted = true; this.sfx?.eruption(); this.shake?.(1.4); this.flash?.(0.6);
                this.fireball.setEnabled(true); this.fireball.scaling.setAll(1);
            }
            if (this.erupted) {
                const k = el - er;
                this.blow(k);
                if (!this.dead && this.mySeat < 0 && k > 1.5) this.die("The volcano erupted - you didn't get away!");
                // far enough away: everything goes dark, and you are home
                this.fadeK = Math.max(this.fadeK, Math.min(1, Math.max(0, (k - (ERUPT_LEN - FADE_OUT)) / FADE_OUT)));
                if (k > ERUPT_LEN && !this.ended) this.endRun();
            }
        }
        this.flow.setEnabled(false);
        // the screens and the readout
        this.drawScreens(el);
        let txt = "";
        if (this.phase === "run" && !this.ended) {
            txt = `⏱ ${fmt(this.clockMs())}`;
            if (el < GRACE) txt += ` · lava in ${Math.ceil(GRACE - el)}`;
            else if (!this.erupted) txt += ` · lava rising`;
            if (this.dead) txt += " · burned";
            else if (this.finished) txt += this.mySeat >= 0 ? " · aboard the helicopter" : " · get to the helicopter!";
        }
        this.hud.textContent = txt; this.hud.style.display = txt ? "block" : "none";
        // a countdown tick for the last seconds of the head start
        const sec = Math.ceil(GRACE - el);
        if (this.phase === "run" && sec !== this.lastSec && sec >= 1 && sec <= 5) this.sfx?.tick();
        this.lastSec = sec;
        void sunUp;
    }
    /** the mushroom cloud's top (world y), rising as it grows */
    private capY = BASE + TOP + 40;
    /** the eruption, `k` seconds in: fireball, fountain, column, cap and surge */
    private blow(k: number) {
        const fb = this.fireball, fm = fb.material as StandardMaterial;
        if (k < 3.5) { fb.setEnabled(true); fb.scaling.setAll(6 + k * 24); fb.position.y = TOP + 6 + k * 10; fm.alpha = Math.max(0, 1 - k / 3.5); fm.emissiveColor.set(1, 0.55 - k * 0.08, 0.15); }
        else fb.setEnabled(false);
        this.fountain.emitRate = k < 6 ? 900 : Math.max(0, 900 - (k - 6) * 300);
        this.bombs.emitRate = k < 7 ? 140 : 0;
        this.smoke.emitRate = 0;
        this.stem.emitRate = k < 11 ? 380 : Math.max(0, 380 - (k - 11) * 90);
        // (the cap forms once the column has climbed: it sits on the column's top and keeps rising)
        this.capY = BASE + TOP + Math.min(150, 25 + k * 16);
        this.cap.emitRate = k > 2.2 ? Math.min(260, (k - 2.2) * 140) : 0;
        this.surge.emitRate = k < 2.5 ? 600 : 0;
    }
    /** the dark bubble round your eyes: going dark at the end, coming back up at home */
    private fade(dt: number) {
        if (this.fadeIn) { this.fadeK -= dt / FADE_IN; if (this.fadeK <= 0) { this.fadeK = 0; this.fadeIn = false; } }
        const on = this.fadeK > 0.002;
        this.fadeSphere.setEnabled(on);
        if (!on) return;
        const cam = this.scene.activeCamera;
        if (cam) this.fadeSphere.position.copyFrom(cam.globalPosition);
        (this.fadeSphere.material as StandardMaterial).alpha = this.fadeK;
    }
    /** the clock: it runs while anybody is still on the course, then stops at the last time in */
    private clockMs() {
        const el = this.el();
        const on = [...this.runners.keys()].some((i) => { const r = this.results.get(i); return !r || (r.ms === null && !r.dead); });
        if (on && !this.erupted) return el * 1000;
        let last = 0; for (const r of this.results.values()) if (r.ms !== null) last = Math.max(last, r.ms);
        return last || el * 1000;
    }
    /**
     * Where the helicopter is right now (and how fast its rotor turns): worked out from the clock alone, so the seat you ride
     * in and the helicopter you see are always in the very same place, frame after frame (no shaking).
     */
    private heliPose(): number {
        let spin = 0;
        if (this.heliT0 < 0) {
            this.heliAt.copyFrom(this.padPos); this.heliAt.y = TOP + 0.25; this.heliYaw = this.padYaw;
            spin = this.seats.size > 0 ? 0.35 : 0;
        } else {
            const h = this.now() - this.heliT0;
            spin = Math.min(1, 0.35 + h * 0.4);
            // up off the pad and away, nose first, out over the sea; then it turns round to face the volcano and backs off
            // slowly while it blows, so everybody aboard has it right in front of them
            const out = new Vector3(Math.cos(this.stationAng), 0, Math.sin(this.stationAng));
            const lift = Math.min(1, Math.max(0, h - 1.2) / 2.8);
            const go = Math.max(0, Math.min(1, (h - 3.5) / 9)), e = go * go * (3 - 2 * go);
            const back = Math.max(0, h - 13) * 6;
            const dist = 43 + e * 190 + back, alt = TOP + 0.25 + lift * 8 + e * 40 + Math.min(20, back * 0.25);
            this.heliAt.set(out.x * dist, alt + Math.sin(h * 1.3) * 0.3 * go, out.z * dist);
            // (blend from the pad, which is a little round the rim from the station)
            const fromPad = 1 - Math.min(1, Math.max(0, h - 2) / 3);
            if (fromPad > 0) { this.heliAt.x += (this.padPos.x - out.x * 43) * fromPad; this.heliAt.z += (this.padPos.z - out.z * 43) * fromPad; }
            const awayYaw = Math.atan2(out.x, out.z), faceYaw = awayYaw + Math.PI;
            const turnK = Math.max(0, Math.min(1, (h - 10.5) / 3.5)), t2 = turnK * turnK * (3 - 2 * turnK);
            const start = h < 4 ? this.padYaw + (awayYaw - this.padYaw) * Math.max(0, Math.min(1, (h - 2) / 2)) : awayYaw;
            let dy = faceYaw - start; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
            this.heliYaw = start + dy * t2;
            // (nose down while it speeds away, level once it turns)
            this.heliPitch = 0.16 * go * (1 - go) * 4 * (1 - t2);
        }
        return spin;
    }
    private flyHeli(dt: number) {
        const spin = this.heliPose();
        this.heli.position.copyFrom(this.heliAt);
        this.heli.rotation.y = this.heliYaw;
        this.heli.rotation.x = this.heliT0 >= 0 ? this.heliPitch + Math.sin((this.now() - this.heliT0) * 0.9) * 0.02 : 0;
        this.rotorSpin += dt * spin * 28;
        this.rotor.rotation.y = this.rotorSpin; this.tailRotor.rotation.x = this.rotorSpin * 1.6;
        const p = this.player;
        const d = p ? Math.hypot(p.pos.x - VX - this.heliAt.x, p.pos.y - BASE - this.heliAt.y, p.pos.z - VZ - this.heliAt.z) : 99;
        this.sfx?.rotor(spin > 0 ? Math.max(0.15, 1 - d / 120) * spin : 0, spin);
        this.beacon.visibility = Math.sin(this.time * 7) > 0.55 ? 1 : 0.15;
        // (a blur where the blades are, once they turn fast)
        this.rotorDisc.visibility = Math.max(0, spin - 0.45) * 0.55;
        for (const b of this.blades) b.visibility = 1 - Math.max(0, spin - 0.55) * 1.4;
    }
    private endRun() {
        this.ended = true; this.endedAt = this.now();
        // everybody in the run: their time, and whether they got away
        const list: Result[] = [];
        for (const [i, n] of this.runners) { const r = this.results.get(i) ?? { name: n, ms: null, dead: true, heli: false }; list.push({ ...r, name: r.name || n, dead: r.heli ? false : true }); }
        for (const [i, r] of this.results) if (!this.runners.has(i) && r.heli) list.push({ ...r, dead: false });
        list.sort((a, b) => (a.ms ?? 1e12) - (b.ms ?? 1e12));
        this.lastRun = list;
        for (const r of list) if (r.ms !== null) this.best.push({ n: r.name, ms: r.ms });
        this.best.sort((a, b) => a.ms - b.ms); this.best = this.best.slice(0, 6);
        try { setPref("lavaBest", JSON.stringify(this.best)); } catch { /* no storage */ }
        this.boardKey = ""; this.drawBoard();
        // back to the secret room
        const p = this.player; if (p) p.ride = null;
        this.mySeat = -1;
        const summary = list.map((r) => `${r.name}: ${r.ms !== null ? fmt(r.ms) : "no time"} · ${r.heli ? "escaped" : "burned"}`).join(" | ");
        this.phase = "idle"; this.seats.clear(); this.heliT0 = -1; this.erupted = false;
        this.fountain.emitRate = this.bombs.emitRate = this.smoke.emitRate = this.stem.emitRate = this.cap.emitRate = this.surge.emitRate = 0;
        this.fireball.setEnabled(false);
        this.goHome?.();
        this.fadeK = 1; this.fadeIn = true;
        this.say(summary ? `Floris Lava - ${summary}` : "Floris Lava: the volcano has blown.");
    }

    // ---------------------------------------------------------------- screens
    private drawScreens(el: number) {
        const ms = this.clockMs();
        const key = `${this.phase}|${Math.floor(ms / 200)}|${this.results.size}|${[...this.results.values()].map((r) => `${r.ms}${r.dead}${r.heli}`).join()}|${this.seats.size}|${this.erupted}`;
        if (key === this.screenKey) return;
        this.screenKey = key;
        // the big one over the door
        {
            const g = this.bigTex.getContext() as CanvasRenderingContext2D, W = 1024, H = 384;
            g.fillStyle = "#0b0f12"; g.fillRect(0, 0, W, H);
            g.textAlign = "center"; g.textBaseline = "middle";
            if (this.phase === "run") {
                const hot = el > GRACE;
                g.fillStyle = hot ? "#ff6a2a" : "#7dffb0"; g.shadowColor = g.fillStyle; g.shadowBlur = 30;
                g.font = "800 220px ui-monospace, Menlo, monospace"; g.fillText(fmt(ms), W / 2, 170); g.shadowBlur = 0;
                g.fillStyle = "#ffd9a0"; g.font = "700 52px system-ui, sans-serif";
                const fin = [...this.results.values()].filter((r) => r.ms !== null).length;
                g.fillText(this.erupted ? "ERUPTION!" : el < GRACE ? `LAVA IN ${Math.ceil(GRACE - el)}` : `LAVA RISING · ${fin}/${this.runners.size} AT THE TOP`, W / 2, 330);
            } else {
                g.fillStyle = "#ffcf6a"; g.font = "800 110px system-ui, sans-serif"; g.fillText("FLORIS LAVA", W / 2, 140);
                g.fillStyle = "#ffffff"; g.font = "600 52px system-ui, sans-serif"; g.fillText("press START at the bottom", W / 2, 270);
            }
            this.bigTex.update();
        }
        // the one inside: times
        {
            const g = this.inTex.getContext() as CanvasRenderingContext2D, W = 1024, H = 640;
            g.fillStyle = "#0d1416"; g.fillRect(0, 0, W, H);
            g.fillStyle = "#ffcf6a"; g.font = "800 64px system-ui, sans-serif"; g.textAlign = "left"; g.textBaseline = "middle";
            g.fillText("RESEARCH STATION", 40, 60);
            g.textAlign = "right"; g.fillStyle = this.phase === "run" ? "#ff8a4a" : "#7dffb0"; g.font = "800 64px ui-monospace, Menlo, monospace";
            g.fillText(this.phase === "run" ? fmt(ms) : "--:--", W - 40, 60);
            g.textAlign = "left"; g.font = "600 44px system-ui, sans-serif";
            let y = 150;
            const rows = this.phase === "run" ? [...this.runners].map(([i, n]) => ({ n, r: this.results.get(i) })) : [];
            for (const { n, r } of rows.slice(0, 6)) {
                g.fillStyle = "#ffffff"; g.fillText(n, 40, y);
                g.textAlign = "right";
                g.fillStyle = r?.dead ? "#ff5a3a" : r?.ms != null ? "#7dffb0" : "#aab4b8";
                g.fillText(r?.dead ? "burned" : r?.ms != null ? fmt(r.ms) + (r.heli ? "  ✈" : "") : "climbing…", W - 40, y);
                g.textAlign = "left"; y += 62;
            }
            if (!rows.length) {
                g.fillStyle = "#aab4b8"; g.fillText("Best times", 40, y); y += 62;
                for (const b of this.best.slice(0, 5)) { g.fillStyle = "#ffffff"; g.fillText(b.n, 40, y); g.textAlign = "right"; g.fillStyle = "#7dffb0"; g.fillText(fmt(b.ms), W - 40, y); g.textAlign = "left"; y += 62; }
            }
            g.fillStyle = "#ffd9a0"; g.font = "600 36px system-ui, sans-serif";
            g.fillText(this.phase === "run" ? `Helicopter: ${this.seats.size} aboard, ${[...this.seats.values()].filter((s) => s.ready).length} ready` : "Press STOP when you get here", 40, H - 40);
            this.inTex.update();
        }
    }
    /** the board in the secret room: the last run, and the best times */
    drawBoard() {
        const key = JSON.stringify([this.lastRun, this.best]);
        if (key === this.boardKey) return;
        this.boardKey = key;
        const g = this.boardTex.getContext() as CanvasRenderingContext2D, W = 1024, H = 768;
        g.fillStyle = "#1b1612"; g.fillRect(0, 0, W, H);
        g.strokeStyle = "#d4a944"; g.lineWidth = 12; g.strokeRect(8, 8, W - 16, H - 16);
        g.textAlign = "center"; g.textBaseline = "middle";
        g.fillStyle = "#ff8a3a"; g.font = "800 104px Georgia, serif"; g.fillText("FLORIS LAVA", W / 2, 90);
        g.textAlign = "left"; g.font = "700 56px system-ui, sans-serif";
        let y = 200;
        g.fillStyle = "#f6e7bd"; g.fillText(this.lastRun.length ? "Last run" : "No runs yet - be the first!", 50, y); y += 74;
        for (const r of this.lastRun.slice(0, 5)) {
            g.font = "600 50px system-ui, sans-serif";
            g.fillStyle = "#ffffff"; g.fillText(r.name, 60, y);
            g.textAlign = "right"; g.fillStyle = r.ms !== null ? "#9ff5c8" : "#aab4b8"; g.fillText(r.ms !== null ? fmt(r.ms) : "no time", W - 290, y);
            g.fillStyle = r.heli ? "#9ff5c8" : "#ff6a4a"; g.fillText(r.heli ? "escaped" : "burned", W - 50, y); g.textAlign = "left"; y += 64;
        }
        y = Math.max(y + 20, 560);
        g.fillStyle = "#f6e7bd"; g.fillText("Best times", 50, y); y += 70;
        g.font = "600 44px system-ui, sans-serif";
        const b = this.best.slice(0, 3);
        g.fillStyle = "#ffffff"; g.fillText(b.length ? b.map((x, i) => `${i + 1}. ${x.n} ${fmt(x.ms)}`).join("   ") : "-", 60, y);
        this.boardTex.update();
    }
    /** where the board hangs in the secret room (main / the sky room) */
    placeBoard(x: number, y: number, z: number, ry: number) { this.board.position.set(x, y, z); this.board.rotation.y = ry; }
}
