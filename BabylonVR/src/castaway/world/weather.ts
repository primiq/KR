// Weather: clear spells, rain showers and (rarely) a heavy storm. Ported from Castaway: the same clock and the same handful
// of shared numbers. The host (or the solo player) decides when the weather turns and tells everybody (event 'we'), so all
// players get wet together. The sky greys over (Atmosphere.overcast), the plants bend (Wind.strength), the sea heaves
// (Ocean.roughness), rain streaks fall round the camera and, in a storm, lightning flashes and thunder rolls. After a
// shower on a sunny day a rainbow stands opposite the sun for a while.
import { Color3, Constants, Effect, Mesh, MeshBuilder, type Scene, ShaderMaterial, StandardMaterial, Vector2, Vector3, VertexBuffer, VertexData } from "@babylonjs/core";
import { Wind } from "../render/foliage";
import type { Atmosphere } from "./atmosphere";

export type WeatherKind = 0 | 1 | 2; // clear, rain, storm
export const WEATHER_NAMES = ["clear", "rain", "storm"] as const;

/** what each kind of weather looks like once it has fully set in */
const LOOK = [
    { rain: 0, overcast: 0, wind: 1, rough: 0 },
    { rain: 0.55, overcast: 0.72, wind: 1.9, rough: 0.25 },
    { rain: 1, overcast: 1, wind: 4.2, rough: 1 },
];

const S = 34, H = 24; // the box of rain round the camera (m)
const FALL = 13; // m/s

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

Effect.ShadersStore["castawayRainVertexShader"] = `
precision highp float;
attribute vec3 position;
attribute vec4 drop;
uniform mat4 viewProjection;
uniform vec3 cam;
uniform float fall;
uniform vec2 drift;
uniform vec2 slant;
uniform float shown;
varying float vA;
float wrap(float v, float m) { return v - m * floor(v / m); }
void main() {
    // world-anchored drops: each wraps round inside the box centred on the camera, so walking through the rain feels right
    float x = cam.x + wrap(drop.x + drift.x - cam.x, ${S.toFixed(1)}) - ${(S / 2).toFixed(1)};
    float z = cam.z + wrap(drop.z + drift.y - cam.z, ${S.toFixed(1)}) - ${(S / 2).toFixed(1)};
    float y = cam.y - ${(H * 0.4).toFixed(1)} + wrap(drop.y - fall - cam.y, ${H.toFixed(1)});
    float len = (0.5 + drop.w * 0.45) * (1.0 + shown * 0.5);
    // the streak trails up-wind of the drop (it falls with the wind)
    vec3 tail = vec3(-slant.x, 1.0, -slant.y);
    vec3 p = vec3(x, y, z) + vec3(position.x, 0.0, position.z) + tail * position.y * len;
    // fade out right in front of the eye and towards the edges of the box
    float near = length(vec2(x - cam.x, z - cam.z));
    vA = 0.55 * (1.0 - position.y * 0.75) * smoothstep(0.6, 2.2, near) * (1.0 - smoothstep(${(S * 0.3).toFixed(1)}, ${(S * 0.5).toFixed(1)}, near)) * clamp(shown * 3.0, 0.0, 1.0);
    gl_Position = viewProjection * vec4(p, 1.0);
}`;
Effect.ShadersStore["castawayRainFragmentShader"] = `
precision highp float;
uniform float day;
varying float vA;
void main() { gl_FragColor = vec4(vec3(0.8, 0.85, 0.92) * (day * 0.75 + 0.25), vA); }`;

Effect.ShadersStore["castawayBowVertexShader"] = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 world;
uniform mat4 viewProjection;
varying vec2 vUV;
varying float vY;
void main() { vec4 w = world * vec4(position, 1.0); vUV = uv; vY = w.y; gl_Position = viewProjection * w; }`;
Effect.ShadersStore["castawayBowFragmentShader"] = `
precision highp float;
uniform float bow;
varying vec2 vUV;
varying float vY;
void main() {
    // radial position across the band: 0 inner (violet) .. 1 outer (red)
    float r = length(vUV - 0.5) * 2.0;
    float t = clamp((r - 0.9) / 0.1, 0.0, 1.0);
    vec3 c = mix(mix(mix(vec3(0.42, 0.25, 0.82), vec3(0.18, 0.49, 1.0), smoothstep(0.0, 0.25, t)), mix(vec3(0.25, 0.82, 0.35), vec3(1.0, 0.89, 0.23), smoothstep(0.45, 0.7, t)), smoothstep(0.2, 0.5, t)), vec3(1.0, 0.29, 0.16), smoothstep(0.7, 0.95, t));
    float edge = pow(1.0 - abs(t - 0.5) * 2.0, 0.6);
    gl_FragColor = vec4(c * bow * edge * 0.6 * smoothstep(0.0, 25.0, vY), 1.0);
}`;

export class Weather {
    /** what the weather is doing now / how long until it changes (seconds; while clear: until the next shower or storm) */
    kind: WeatherKind = 0;
    left = rnd(420, 900);
    /** the host / solo player runs the clock; clients are told */
    remote = false;
    /** the current (smoothed) look: these ease towards LOOK[kind] */
    rain = 0; overcast = 0; wind = 1; rough = 0; wet = 0;
    /** 0..1: the storm far out at sea round this player (the boat's business, not the host's): it overrides the look */
    sea = 0;
    /** host: tell the others the weather changed */
    onChange: ((kind: WeatherKind, left: number) => void) | null = null;
    /** a lightning strike at this distance (m): the thunder follows by the speed of sound */
    onLightning: ((dist: number) => void) | null = null;

    private rainMesh: Mesh;
    private rainMat: ShaderMaterial;
    private drops: number;
    private fall = 0;
    private drift = new Vector2(0, 0);
    private slant = new Vector2(0, 0);
    private bolt: Mesh;
    private boltMat: StandardMaterial;
    private boltT = 0;
    private nextStrike = 8;
    private flashT = 0;
    private flashPeak = 0;
    private bow: Mesh;
    private bowMat: ShaderMaterial;
    private bowT = 0;
    /** 0..1 how much rain falls where the camera is (0 under a roof, in a cave, under water, away from the island) */
    private shelter = 0;

    constructor(private readonly scene: Scene, quality: "high" | "medium" | "low", private readonly atmo: Atmosphere, private readonly ocean: { roughness: number }) {
        this.drops = quality === "low" ? 1800 : quality === "high" ? 4200 : 3000;
        ({ mesh: this.rainMesh, mat: this.rainMat } = this.makeRain(this.drops));
        this.bolt = new Mesh("bolt", scene);
        this.boltMat = new StandardMaterial("boltMat", scene);
        this.boltMat.disableLighting = true;
        this.boltMat.emissiveColor = new Color3(0.9, 0.93, 1);
        this.boltMat.alphaMode = Constants.ALPHA_ADD;
        this.boltMat.disableDepthWrite = true;
        this.boltMat.backFaceCulling = false;
        this.boltMat.fogEnabled = false;
        this.bolt.material = this.boltMat;
        this.bolt.isPickable = false;
        this.bolt.setEnabled(false);
        ({ mesh: this.bow, mat: this.bowMat } = this.makeRainbow());
    }

    /** a thin cross of two quads per drop, wrapped into a box that follows the camera; the shader does the falling */
    private makeRain(n: number) {
        const pos = new Float32Array(n * 8 * 3), drop = new Float32Array(n * 8 * 4), idx = new Uint32Array(n * 12);
        const w = 0.016;
        const corners = [[-w, 0, 0], [w, 0, 0], [w, 1, 0], [-w, 1, 0], [0, 0, -w], [0, 0, w], [0, 1, w], [0, 1, -w]];
        for (let i = 0; i < n; i++) {
            const ox = Math.random() * S, oy = Math.random() * H, oz = Math.random() * S, r = Math.random();
            for (let k = 0; k < 8; k++) {
                const v = i * 8 + k;
                pos.set(corners[k], v * 3);
                drop.set([ox, oy, oz, r], v * 4);
            }
            const b = i * 8;
            idx.set([b, b + 1, b + 2, b, b + 2, b + 3, b + 4, b + 5, b + 6, b + 4, b + 6, b + 7], i * 12);
        }
        const mesh = new Mesh("rain", this.scene);
        const vd = new VertexData();
        vd.positions = pos;
        vd.indices = idx;
        vd.applyToMesh(mesh, false);
        mesh.setVerticesData("drop", drop, false, 4);
        // only part of the index buffer is drawn (how hard it is raining): the sub-mesh needs bounds of its own
        mesh.subMeshes[0].setBoundingInfo(mesh.getBoundingInfo());
        const mat = new ShaderMaterial("rainMat", this.scene, "castawayRain", {
            attributes: [VertexBuffer.PositionKind, "drop"],
            uniforms: ["viewProjection", "cam", "fall", "drift", "slant", "shown", "day"],
            needAlphaBlending: true,
        });
        mat.backFaceCulling = false;
        mat.disableDepthWrite = true;
        mesh.material = mat;
        mesh.alwaysSelectAsActiveMesh = true;
        mesh.isPickable = false;
        mesh.renderingGroupId = 1;
        mesh.setEnabled(false);
        return { mesh, mat };
    }

    /** a rainbow: a band at 40-42 degrees round the point opposite the sun; it never shows below the sea */
    private makeRainbow() {
        const mesh = MeshBuilder.CreateDisc("rainbow", { radius: 0.735, tessellation: 96, sideOrientation: Mesh.DOUBLESIDE }, this.scene);
        const mat = new ShaderMaterial("bowMat", this.scene, "castawayBow", {
            attributes: [VertexBuffer.PositionKind, VertexBuffer.UVKind],
            uniforms: ["world", "viewProjection", "bow"],
        });
        mat.alphaMode = Constants.ALPHA_ADD;
        mat.needAlphaBlending = () => true;
        mat.disableDepthWrite = true;
        mat.backFaceCulling = false;
        mesh.material = mat;
        mesh.isPickable = false;
        mesh.alwaysSelectAsActiveMesh = true;
        mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
        mesh.setEnabled(false);
        return { mesh, mat };
    }

    /** set the weather (host / solo / debug); tells the others */
    set(kind: WeatherKind, left?: number) {
        const was = this.kind;
        this.kind = kind;
        this.left = left ?? (kind === 2 ? rnd(300, 540) : kind === 1 ? rnd(150, 360) : rnd(600, 1500));
        if (kind === 0 && was !== 0) this.afterRain();
        if (!this.remote) this.onChange?.(this.kind, this.left);
    }
    /** washed up after the wreck: the sky clears at once (and the host is asked to make it so for everybody) */
    calm() {
        this.sea = 0;
        this.rain = 0; this.overcast = 0; this.wind = 1; this.rough = 0;
        this.apply();
        if (!this.remote && this.kind !== 0) this.set(0);
    }
    /** a client hears from the host */
    setRemote(kind: WeatherKind, left: number) {
        if (kind === 0 && this.kind !== 0) this.afterRain();
        this.kind = kind;
        this.left = left;
    }
    private afterRain() {
        const sy = this.atmo.sunDir.y;
        if (sy > 0.04 && sy < 0.7) this.bowT = 150;
    }

    /** `local`: the player is on (or round) the island, out of the caves; `roof`: something overhead; `under`: under water */
    update(dt: number, cam: Vector3, local: boolean, roof: boolean, under: boolean) {
        // ---- the host's clock: clear spells broken by showers, and now and then a storm
        if (!this.remote) {
            this.left -= dt;
            if (this.left <= 0) {
                if (this.kind === 0) this.set(Math.random() < 0.14 ? 2 : 1);
                else this.set(0);
            }
        } else this.left = Math.max(0, this.left - dt);
        // ---- ease towards the look (a storm builds over a minute or two and blows over more slowly)
        const B = LOOK[local ? this.kind : 0], sea = this.sea;
        // out at sea the storm is worse than anything the island gets: black sky, a gale, and waves several metres high
        const L = sea > 0 ? { rain: B.rain + (1 - B.rain) * sea, overcast: B.overcast + (1 - B.overcast) * sea, wind: B.wind + (6 - B.wind) * sea, rough: B.rough + (1.6 - B.rough) * sea } : B;
        const quick = 1 + sea * 5; // ... and it blows up in seconds, not minutes
        const ease = (v: number, to: number, up: number, down: number) => v + (to - v) * Math.min(1, (dt * quick) / (to > v ? up : down));
        this.overcast = ease(this.overcast, L.overcast, 30, 45);
        this.rain = ease(this.rain, this.overcast > L.overcast * 0.6 ? L.rain : 0, 20, 14);
        this.wind = ease(this.wind, L.wind, 35, 40);
        this.rough = ease(this.rough, L.rough, 60, 80);
        this.wet = ease(this.wet, this.rain > 0.15 ? 1 : 0, 70, 260);
        this.apply();

        // ---- rain round the camera
        this.shelter = ease(this.shelter, local && !roof && !under ? 1 : 0, 0.6, 0.4);
        const shown = this.rain * this.shelter;
        this.rainMesh.setEnabled(shown > 0.01);
        if (shown > 0.01) {
            const sub = this.rainMesh.subMeshes[0];
            sub.indexCount = Math.ceil(this.drops * Math.min(1, shown * 1.1)) * 12;
            const sl = (this.wind - 1) * 0.11; // the plants lean the same way (+x, a little +z)
            this.slant.set(sl, sl * 0.35);
            this.fall = (this.fall + FALL * (1 + shown * 0.3) * dt) % H;
            this.drift.set((this.drift.x + sl * FALL * dt) % S, (this.drift.y + sl * 0.35 * FALL * dt) % S);
            const m = this.rainMat;
            m.setVector3("cam", cam);
            m.setFloat("fall", this.fall);
            m.setVector2("drift", this.drift);
            m.setVector2("slant", this.slant);
            m.setFloat("shown", shown);
            m.setFloat("day", this.atmo.day);
        }

        // ---- lightning (storms only)
        this.flashT = Math.max(0, this.flashT - dt);
        // a strike flickers: a bright flash, a dip, a second flash
        const f = this.flashT > 0 ? this.flashPeak * (this.flashT > 0.3 ? (this.flashT - 0.3) / 0.15 : this.flashT > 0.18 ? 0.25 : this.flashT / 0.18 * 0.8) : 0;
        this.atmo.flash = local ? Math.min(1, f) : 0;
        if ((this.kind === 2 || sea > 0.4) && local && this.rough > 0.55) {
            this.nextStrike -= dt;
            if (this.nextStrike <= 0) { this.nextStrike = sea > 0.4 ? rnd(2, 6) : rnd(5, 16); this.strike(cam); }
        }
        this.boltT -= dt;
        this.bolt.setEnabled(this.boltT > 0);
        if (this.boltT > 0) this.boltMat.alpha = Math.min(1, this.boltT / 0.12) * (this.boltT > 0.22 && this.boltT < 0.28 ? 0.3 : 1);

        // ---- rainbow
        this.bowT = Math.max(0, this.bowT - dt);
        const sy = this.atmo.sunDir.y;
        const bowK = local && this.bowT > 0 && sy > 0.02 && !under ? Math.min(1, (150 - this.bowT) / 25, this.bowT / 30) * (1 - this.rain) * (1 - this.overcast * 0.8) : 0;
        this.bow.setEnabled(bowK > 0.01);
        if (bowK > 0.01) {
            const D = 900;
            this.bow.position.copyFrom(cam).addInPlace(this.atmo.sunDir.scale(-D));
            this.bow.scaling.setAll(D * 1.22);
            this.bowMat.setFloat("bow", bowK);
        }
    }

    /** push the current look into the shared systems */
    apply() {
        Wind.strength = this.wind;
        this.ocean.roughness = this.rough;
        this.atmo.overcast = this.overcast;
        this.atmo.wet = this.wet;
    }

    /** a bolt somewhere out there: a jagged line from the clouds down to the sea or the island, drawn for a moment */
    private strike(cam: Vector3) {
        const a = Math.random() * Math.PI * 2, d = rnd(250, 1100);
        const bx = cam.x + Math.cos(a) * d, bz = cam.z + Math.sin(a) * d, top = 420, bottom = 0;
        // a ribbon facing the camera
        const side = new Vector3(-Math.sin(a), 0, Math.cos(a));
        const pts: Vector3[] = [];
        let x = bx, z = bz;
        const n = 18;
        for (let i = 0; i <= n; i++) {
            const y = top + (bottom - top) * (i / n);
            pts.push(new Vector3(x, y, z));
            const j = rnd(-16, 16);
            x += side.x * j; z += side.z * j;
        }
        const pos: number[] = [], idx: number[] = [];
        const seg = (p: Vector3[], wd: number) => {
            const base = pos.length / 3;
            for (const q of p) pos.push(q.x - side.x * wd, q.y, q.z - side.z * wd, q.x + side.x * wd, q.y, q.z + side.z * wd);
            for (let i = 0; i < p.length - 1; i++) { const k = base + i * 2; idx.push(k, k + 1, k + 3, k, k + 3, k + 2); }
        };
        seg(pts, 2.2);
        // a branch or two
        for (let b = 0; b < 2; b++) {
            const from = pts[3 + Math.floor(Math.random() * 8)], br: Vector3[] = [from.clone()];
            const dir = Math.random() < 0.5 ? -1 : 1;
            for (let i = 1; i < 6; i++) br.push(br[i - 1].add(new Vector3(side.x * dir * rnd(8, 22), -rnd(18, 34), side.z * dir * rnd(8, 22))));
            seg(br, 1.1);
        }
        const vd = new VertexData();
        vd.positions = pos;
        vd.indices = idx;
        vd.applyToMesh(this.bolt, false);
        this.boltT = 0.35;
        this.flashT = 0.45;
        this.flashPeak = Math.max(0.35, 1 - d / 1400);
        this.onLightning?.(d);
    }
}
