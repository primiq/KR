import {
    type AbstractMesh,
    type BaseTexture,
    MirrorTexture,
    Plane,
    Color3,
    Color4,
    Constants,
    DynamicTexture,
    Effect,
    Mesh,
    ParticleSystem,
    PhysicsMotionType,
    RawTexture,
    Scene,
    ShaderMaterial,
    Texture,
    ToHalfFloat,
    type TransformNode,
    Vector3,
    VertexData,
} from "@babylonjs/core";
import type { Quality } from "../environment";
import type { Grabbable } from "../props";
import { waterProbes } from "../waterProbes";
import { RippleSimulation } from "./ripples";

/** One Gerstner wave: direction (radians), wavelength (m), amplitude (m), steepness (0..1). */
interface Wave {
    dir: number;
    length: number;
    amp: number;
    steep: number;
}

const WAVES: Wave[] = [
    { dir: -1.75, length: 34, amp: 0.32, steep: 0.55 },
    { dir: -1.45, length: 21, amp: 0.2, steep: 0.6 },
    { dir: -2.05, length: 13, amp: 0.12, steep: 0.6 },
    { dir: -1.2, length: 8.5, amp: 0.07, steep: 0.55 },
    { dir: -2.4, length: 5.2, amp: 0.04, steep: 0.5 },
    { dir: -0.9, length: 3.1, amp: 0.022, steep: 0.45 },
];

/** Anything that wades and swims: the playground's physics player or Castaway's kinematic one. */
export interface WaterBody {
    readonly position: Vector3;
    readonly waterDepth: number;
    readonly linearVelocity: Vector3;
    water: { surfaceAt(x: number, z: number): number } | null;
}

export interface OceanOptions {
    quality: Quality;
    /** Seabed height (water level is y = 0). */
    seabedAt(x: number, z: number): number;
    /** Square of the world covered by the seabed texture. */
    seabed: { minX: number; minZ: number; size: number };
    sunDirection: Vector3;
    sunColor: Color3;
    env: BaseTexture;
}

const VERTEX = `
precision highp float;
attribute vec3 position;
uniform mat4 world;
uniform mat4 viewProjection;
uniform float time;
uniform vec4 waveA[NUM_WAVES];
uniform vec4 waveB[NUM_WAVES];
uniform sampler2D seabed;
uniform vec4 seabedRect;
uniform sampler2D ripples;
uniform vec4 rippleRect;
uniform vec3 cameraPos;
varying vec3 vPos;
varying vec3 vNormal;
varying float vSeabed;
varying float vCrest;
varying vec2 vRippleUV;

float seabedHeight(vec2 xz) {
    vec2 uv = (xz - seabedRect.xy) / seabedRect.z;
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return -40.0;
    return texture2D(seabed, uv).r;
}

void main(void) {
    vec4 wp = world * vec4(position, 1.0);
    vec2 xz = wp.xz;
    float sb = seabedHeight(xz);
    float depth = -sb;
    // Waves calm in the shallows and fade towards the horizon (they'd alias anyway).
    float att = 0.12 + 0.88 * smoothstep(0.0, 6.0, depth);
    att *= 1.0 - smoothstep(220.0, 650.0, distance(xz, cameraPos.xz));
    vec3 p = vec3(xz.x, 0.0, xz.y);
    vec3 n = vec3(0.0, 1.0, 0.0);
    float crest = 0.0;
    for (int i = 0; i < NUM_WAVES; i++) {
        vec4 a = waveA[i]; // dir.x, dir.y, k, amp
        vec4 b = waveB[i]; // omega, Q, phase, 0
        float A = a.w * att;
        float ph = a.z * dot(a.xy, xz) - b.x * time + b.z;
        float c = cos(ph);
        float s = sin(ph);
        p.x += b.y * A * a.x * c;
        p.z += b.y * A * a.y * c;
        p.y += A * s;
        n.x -= a.x * a.z * A * c;
        n.z -= a.y * a.z * A * c;
        n.y -= b.y * a.z * A * s;
        crest += b.y * a.z * A * s;
    }
    vec2 ruv = (xz - rippleRect.xy) / rippleRect.z;
    if (ruv.x > 0.0 && ruv.y > 0.0 && ruv.x < 1.0 && ruv.y < 1.0) p.y += texture2D(ripples, ruv).r * rippleRect.w;
    vPos = p;
    vNormal = n;
    vSeabed = sb;
    vCrest = crest;
    vRippleUV = ruv;
    gl_Position = viewProjection * vec4(p, 1.0);
}`;

const FRAGMENT = `
precision highp float;
uniform samplerCube envMap;
uniform sampler2D ripples;
uniform sampler2D reflTex;
uniform float useRefl;
uniform vec2 screenSize;
uniform vec4 rippleRect;
uniform vec2 rippleTexel;
uniform vec3 cameraPos;
uniform vec3 sunDir;
uniform vec3 sunColor;
uniform vec3 shallowColor;
uniform vec3 deepColor;
uniform float daylight;
uniform float bio;
uniform float time;
uniform float flash;
uniform float rough;
uniform vec3 hzAway;
uniform vec3 hzSun;
uniform vec3 hzSunXZ;
varying vec3 vPos;
varying vec3 vNormal;
varying float vSeabed;
varying float vCrest;
varying vec2 vRippleUV;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float s = 0.0; float a = 0.5; for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.07; a *= 0.5; } return s; }

void main(void) {
    vec3 N = normalize(vNormal);
    // Interactive ripples: normal from the simulated height gradient.
    vec2 ruv = vRippleUV;
    if (ruv.x > 0.0 && ruv.y > 0.0 && ruv.x < 1.0 && ruv.y < 1.0) {
        float hl = texture2D(ripples, ruv - vec2(rippleTexel.x, 0.0)).r;
        float hr = texture2D(ripples, ruv + vec2(rippleTexel.x, 0.0)).r;
        float hd = texture2D(ripples, ruv - vec2(0.0, rippleTexel.y)).r;
        float hu = texture2D(ripples, ruv + vec2(0.0, rippleTexel.y)).r;
        float cell = rippleRect.z * rippleTexel.x;
        N = normalize(N + vec3(-(hr - hl), 0.0, -(hu - hd)) * rippleRect.w * 2.5 / (2.0 * cell));
    }
    // Fine wind ripples on top of the swell.
    vec2 q = vPos.xz;
    float dn = 0.08;
    float n0 = fbm(q * 0.9 + vec2(time * 0.35, time * 0.2));
    float nx = fbm((q + vec2(dn, 0.0)) * 0.9 + vec2(time * 0.35, time * 0.2));
    float nz = fbm((q + vec2(0.0, dn)) * 0.9 + vec2(time * 0.35, time * 0.2));
    N = normalize(N + vec3(n0 - nx, 0.0, n0 - nz) * 1.4);

    vec3 toCam = cameraPos - vPos;
    float dist = length(toCam);
    vec3 V = toCam / dist;
    bool under = cameraPos.y < vPos.y;
    if (under) N = -N;

    float NdV = max(dot(N, V), 0.0);
    float fresnel = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
    vec3 R = reflect(-V, N);
    R.y = abs(R.y);
    vec3 refl = textureCube(envMap, R).rgb;
    // the planar reflection (the island, the trees, the clouds, the moon and stars), when it is on: sampled where this point
    // is on screen, nudged by the waves (less far away, where the ripples are smaller than a pixel)
    if (useRefl > 0.5 && !under) {
        vec2 suv = gl_FragCoord.xy / screenSize + N.xz * (0.035 / (1.0 + dist * 0.02));
        vec2 edge = smoothstep(vec2(0.0), vec2(0.04), suv) * smoothstep(vec2(1.0), vec2(0.96), suv);
        vec3 pr = texture2D(reflTex, clamp(suv, 0.002, 0.998)).rgb;
        refl = mix(refl, pr, edge.x * edge.y);
        // calm water a little more mirror-like than Fresnel alone, even looking straight down (where it is otherwise ~2%),
        // so you can see yourself (and the palms) in it; not in the shallows, where you see the sand
        fresnel = max(fresnel, 0.13 * smoothstep(0.05, 0.7, max(vPos.y - vSeabed, 0.0)) * edge.x * edge.y);
    }

    // Sun glitter: a sharp core plus a broad sheen.
    vec3 L = -sunDir;
    vec3 H = normalize(L + V);
    float NdH = max(dot(N, H), 0.0);
    vec3 spec = sunColor * (pow(NdH, 900.0) * 40.0 + pow(NdH, 120.0) * 0.8);

    // Water body: absorption by depth, plus light scattered through wave crests.
    float depth = max(vPos.y - vSeabed, 0.0);
    vec3 body = mix(shallowColor, deepColor, 1.0 - exp(-depth * 0.22));
    float sss = pow(max(dot(V, normalize(vec3(-L.x, 0.25, -L.z))), 0.0), 3.0) * clamp(vCrest * 2.5 + 0.2, 0.0, 1.0);
    body += shallowColor * sss * 0.6 * length(sunColor) * 0.2;
    body *= 0.4 * daylight + 0.6 * max(dot(N, L), 0.0) * length(sunColor) * 0.18;

    vec3 col = under ? mix(body * 0.6, refl * 0.3, fresnel) : mix(body, refl, fresnel) + spec;
    // a storm: under a grey sky the sea reflects one flat grey and the swell vanishes into it. Shade it by its own shape
    // instead (the tops lighter, the steep sides dark, the crests lighter still), so you can see how big the waves are
    float storm = clamp((rough - 0.3) / 1.1, 0.0, 1.0);
    if (!under && storm > 0.0) {
        vec3 Ng = normalize(vNormal);
        vec3 gloom = mix(vec3(0.012, 0.035, 0.045), vec3(0.12, 0.18, 0.2), smoothstep(0.6, 0.98, Ng.y));
        gloom += vec3(0.05, 0.09, 0.1) * clamp(vCrest * 1.6, 0.0, 1.0);
        gloom *= 0.25 + 0.75 * daylight;
        col = mix(col, gloom + spec * 0.3, 0.65 * storm);
    }

    // Foam: along the shoreline and on steep crests.
    // Lacy foam right at the waterline, pulsing with the swell, plus streaks on the steepest crests.
    float shore = 1.0 - smoothstep(0.0, 0.35 + 0.2 * sin(time * 0.8 + vPos.x * 0.15), depth);
    float foamNoise = fbm(vPos.xz * 2.2 + vec2(time * 0.12, -time * 0.08));
    float lace = smoothstep(0.45, 0.65, foamNoise);
    // (a storm whips the sea white: whitecaps on every big crest, and they still show at night)
    float foam = clamp(shore * lace * 1.2 + smoothstep(0.7 - 0.4 * storm, 1.0, vCrest) * lace * (0.8 + 0.7 * storm), 0.0, 1.0);
    col = mix(col, vec3(0.9, 0.93, 0.95) * max(0.35 * daylight + 0.65 * length(sunColor) * 0.2, 0.2 * storm), foam * 0.75);
    // the swell readable in the gloom: crests a shade lighter than the troughs
    col += vec3(0.03, 0.07, 0.075) * storm * clamp(vCrest * 1.4 + 0.35, 0.0, 1.2);
    // lightning lights the sea up for a moment (the surface, the foam, and the sky in it)
    col += vec3(0.55, 0.62, 0.78) * flash * (0.12 + fresnel * 1.2 + foam * 0.7);
    // Bioluminescence (Castaway's glowing nights): the breaking water and foam light up blue
    col += vec3(0.12, 0.62, 1.0) * bio * (foam * 1.6 + smoothstep(0.45, 1.0, vCrest) * 0.5 + shore * 0.4) * (0.7 + 0.3 * sin(time * 2.3 + vPos.x * 0.7 + vPos.z * 0.5));

    // Shallow water is clear; deep water is opaque.
    float alpha = clamp(1.0 - exp(-depth * 1.6) + fresnel * 0.6 + foam, 0.0, 1.0);
    if (under) alpha = 0.92;
    else alpha = max(alpha, storm);

    // Blend into the sky at the horizon.
    vec3 horizon = textureCube(envMap, normalize(vec3(-V.x, 0.02, -V.z))).rgb;
    // (given a horizon colour, the same one the sky's horizon haze and the fog use, so there is no seam where the sea ends)
    if (hzSunXZ.z > 0.5) horizon = mix(hzAway, hzSun, pow(max(dot(normalize(-V.xz + vec2(1e-5)), hzSunXZ.xy), 0.0), 2.0));
    float haze = smoothstep(150.0, 680.0, dist);
    col = mix(col, horizon, haze);
    alpha = mix(alpha, 1.0, haze);

    gl_FragColor = vec4(col, alpha);
}`;

export class Ocean {
    readonly mesh: Mesh;
    readonly ripples: RippleSimulation;
    private readonly waves: Wave[];
    private readonly waveA: Float32Array;
    private readonly waveB: Float32Array;
    private time = 0;
    private readonly gridStep: number;
    private props: Grabbable[] = [];
    private player: WaterBody | null = null;
    private readonly splash: ParticleSystem;
    private readonly wasWet = new Map<Grabbable, boolean>();
    private readonly probeLast = new Map<TransformNode, Vector3>();
    private playerWasWet = false;
    private underwater = false;
    /** 1 by day; lower at night so the water's own glow fades with the light (Castaway's day / night) */
    daylight = 1;
    /** 0..1: the sea glows where it breaks (Castaway's bioluminescent nights) */
    bio = 0;
    /** the planar reflection, when turned on (enableReflection) */
    private reflection: MirrorTexture | null = null;
    /** a lightning flash (0..1): the sea lights up with the sky */
    flash = 0;
    /** the colour the far sea fades into (looking away from the sun, towards it, and where the sun is): null, the sky's own */
    horizon: { away: Color3; toSun: Color3; sunX: number; sunZ: number } | null = null;
    /** the reflection can be paused (in a headset, underground...) without throwing it away */
    reflectOn = true;

    /**
     * Mirror the scene in the sea: a reduced-size HDR render of what `include` picks, reflected about sea level, refreshed
     * every `refreshRate` frames. Without it the sea reflects only the sky's cube map.
     */
    enableReflection(ratio: number, refreshRate: number, include: (m: AbstractMesh) => boolean) {
        const mt = new MirrorTexture("oceanReflection", { ratio }, this.scene, false, Constants.TEXTURETYPE_HALF_FLOAT);
        mt.mirrorPlane = new Plane(0, -1, 0, -0.05);
        mt.refreshRate = refreshRate;
        mt.renderListPredicate = (m) => m !== this.mesh && m.isEnabled() && include(m);
        mt.clearColor = new Color4(0, 0, 0, 1);
        this.reflection = mt;
        this.scene.customRenderTargets.push(mt);
        return mt;
    }

    constructor(
        private readonly scene: Scene,
        private readonly opts: OceanOptions,
    ) {
        const q = opts.quality;
        this.waves = WAVES.slice(0, q === "high" ? 6 : q === "medium" ? 5 : 4);
        const n = this.waves.length;
        this.waveA = new Float32Array(n * 4);
        this.waveB = new Float32Array(n * 4);
        this.setWaves(0);

        // Grid denser near the centre (which follows the camera) and sparse towards the horizon.
        const res = q === "high" ? 256 : q === "medium" ? 192 : 128;
        const inner = 34;
        const outer = 700;
        const map = (u: number) => u * inner + Math.sign(u) * Math.abs(u) ** 3 * (outer - inner);
        const positions: number[] = [];
        const indices: number[] = [];
        for (let j = 0; j <= res; j++) {
            for (let i = 0; i <= res; i++) positions.push(map((i / res) * 2 - 1), 0, map((j / res) * 2 - 1));
        }
        for (let j = 0; j < res; j++) {
            for (let i = 0; i < res; i++) {
                const a = j * (res + 1) + i;
                indices.push(a, a + res + 1, a + 1, a + 1, a + res + 1, a + res + 2);
            }
        }
        this.gridStep = (2 * inner) / res;
        const vd = new VertexData();
        vd.positions = positions;
        vd.indices = indices;
        this.mesh = new Mesh("ocean", scene);
        vd.applyToMesh(this.mesh);
        this.mesh.alwaysSelectAsActiveMesh = true;
        this.mesh.isPickable = false;

        this.ripples = new RippleSimulation(scene, q === "mobile" ? 128 : 256, q === "mobile" ? 24 : 32);

        Effect.ShadersStore["oceanVertexShader"] = VERTEX;
        Effect.ShadersStore["oceanFragmentShader"] = FRAGMENT;
        const mat = new ShaderMaterial(
            "oceanMat",
            scene,
            { vertex: "ocean", fragment: "ocean" },
            {
                attributes: ["position"],
                uniforms: ["world", "viewProjection", "time", "waveA", "waveB", "seabedRect", "rippleRect", "rippleTexel", "cameraPos", "sunDir", "sunColor", "shallowColor", "deepColor", "daylight", "bio", "useRefl", "screenSize", "hzAway", "hzSun", "hzSunXZ", "flash", "rough"],
                samplers: ["seabed", "ripples", "envMap", "reflTex"],
                defines: [`#define NUM_WAVES ${n}`],
                needAlphaBlending: true,
            },
        );
        mat.backFaceCulling = false;
        mat.setTexture("seabed", this.createSeabedTexture());
        mat.setTexture("envMap", opts.env);
        mat.setColor3("sunColor", opts.sunColor);
        mat.setVector3("sunDir", opts.sunDirection.normalizeToNew());
        mat.setColor3("shallowColor", new Color3(0.07, 0.62, 0.62));
        mat.setColor3("deepColor", new Color3(0.004, 0.05, 0.12));
        mat.onBindObservable.add(() => {
            const cam = scene.activeCamera!;
            const e = mat.getEffect()!;
            e.setFloat("time", this.time);
            e.setFloat("daylight", this.daylight);
            e.setFloat("bio", this.bio);
            e.setFloat("flash", this.flash);
            e.setFloat("rough", this.rough);
            const hz = this.horizon;
            if (hz) { e.setColor3("hzAway", hz.away); e.setColor3("hzSun", hz.toSun); }
            e.setFloat3("hzSunXZ", hz?.sunX ?? 0, hz?.sunZ ?? 0, hz ? 1 : 0);
            e.setArray4("waveA", this.waveA as unknown as number[]);
            e.setArray4("waveB", this.waveB as unknown as number[]);
            e.setVector3("cameraPos", cam.globalPosition);
            e.setFloat4("seabedRect", opts.seabed.minX, opts.seabed.minZ, opts.seabed.size, 0);
            const r = this.ripples;
            e.setFloat4("rippleRect", r.origin.x, r.origin.y, r.worldSize, r.enabled ? 1 : 0);
            e.setFloat2("rippleTexel", 1 / r.size, 1 / r.size);
            e.setTexture("ripples", r.texture);
            const rf = this.reflection;
            const on = !!rf && this.reflectOn;
            e.setFloat("useRefl", on ? 1 : 0);
            e.setTexture("reflTex", rf ?? r.texture);
            const eng = scene.getEngine();
            e.setFloat2("screenSize", eng.getRenderWidth(), eng.getRenderHeight());
        });
        this.mesh.material = mat;

        this.splash = this.createSplashSystem();
        // (Castaway has no physics engine: the observable only exists once Havok is set up)
        scene.onBeforePhysicsObservable?.add(() => this.physicsStep());
        scene.onBeforeRenderObservable.add(() => this.frame());
    }

    /** Height of the water surface at (x, z) (Gerstner swell; ripples are cosmetic). */
    private rough = 0;
    /** weather: 0 = a calm day, 1 = a storm (the long swells grow most), more out in a gale at sea */
    get roughness() { return this.rough; }
    set roughness(r: number) {
        if (Math.abs(r - this.rough) < 0.004) return;
        this.rough = r;
        this.setWaves(r);
    }
    private setWaves(r: number) {
        const n = this.waves.length;
        this.waves.forEach((w, i) => {
            const k = (2 * Math.PI) / w.length;
            const omega = Math.sqrt(9.81 * k);
            const amp = w.amp * (1 + r * (2.6 - i * 0.3));
            this.waveA.set([Math.cos(w.dir), Math.sin(w.dir), k, amp], i * 4);
            this.waveB.set([omega, Math.min(1, w.steep * (1 + r * 0.4)) / (k * amp * n), i * 1.7, 0], i * 4);
        });
    }

    surfaceAt(x: number, z: number): number {
        const depth = -this.opts.seabedAt(x, z);
        const att = 0.12 + 0.88 * smoothstep(0, 6, depth);
        // Gerstner waves move points horizontally, so solve for the point that ends up above (x, z).
        let px = x;
        let pz = z;
        for (let iter = 0; iter < 3; iter++) {
            let dx = 0;
            let dz = 0;
            for (let i = 0; i < this.waves.length; i++) {
                const a = this.waveA;
                const b = this.waveB;
                const A = a[i * 4 + 3] * att;
                const ph = a[i * 4 + 2] * (a[i * 4] * px + a[i * 4 + 1] * pz) - b[i * 4] * this.time + b[i * 4 + 2];
                const c = Math.cos(ph);
                dx += b[i * 4 + 1] * A * a[i * 4] * c;
                dz += b[i * 4 + 1] * A * a[i * 4 + 1] * c;
            }
            px = x - dx;
            pz = z - dz;
        }
        let y = 0;
        for (let i = 0; i < this.waves.length; i++) {
            const a = this.waveA;
            const b = this.waveB;
            const ph = a[i * 4 + 2] * (a[i * 4] * px + a[i * 4 + 1] * pz) - b[i * 4] * this.time + b[i * 4 + 2];
            y += a[i * 4 + 3] * att * Math.sin(ph);
        }
        return y;
    }

    bindProps(props: Grabbable[]): void {
        this.props = props;
    }

    bindPlayer(player: WaterBody): void {
        this.player = player;
        player.water = this;
    }

    setInteractive(on: boolean): void {
        this.ripples.enabled = on;
    }

    // ---------------------------------------------------------------------------

    private createSeabedTexture(): RawTexture {
        const size = 256;
        const { minX, minZ, size: world } = this.opts.seabed;
        const data = new Uint16Array(size * size * 4);
        for (let j = 0; j < size; j++) {
            for (let i = 0; i < size; i++) {
                const h = this.opts.seabedAt(minX + ((i + 0.5) / size) * world, minZ + ((j + 0.5) / size) * world);
                data[(j * size + i) * 4] = ToHalfFloat(h);
                data[(j * size + i) * 4 + 3] = ToHalfFloat(1);
            }
        }
        const t = RawTexture.CreateRGBATexture(data, size, size, this.scene, false, false, Texture.BILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_HALF_FLOAT);
        t.wrapU = t.wrapV = Texture.CLAMP_ADDRESSMODE;
        return t;
    }

    private createSplashSystem(): ParticleSystem {
        const dot = new DynamicTexture("splashDot", 32, this.scene, false);
        const ctx = dot.getContext();
        const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
        g.addColorStop(0, "rgba(255,255,255,1)");
        g.addColorStop(0.5, "rgba(230,245,255,0.6)");
        g.addColorStop(1, "rgba(220,240,255,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 32, 32);
        dot.update();
        dot.hasAlpha = true;
        const ps = new ParticleSystem("splash", this.opts.quality === "mobile" ? 300 : 900, this.scene);
        ps.particleTexture = dot;
        ps.emitter = Vector3.Zero();
        ps.createSphereEmitter(0.25, 0.3);
        ps.color1 = new Color4(0.95, 0.98, 1, 0.9);
        ps.color2 = new Color4(0.75, 0.9, 1, 0.7);
        ps.colorDead = new Color4(0.8, 0.9, 1, 0);
        ps.minSize = 0.03;
        ps.maxSize = 0.11;
        ps.minLifeTime = 0.5;
        ps.maxLifeTime = 1.1;
        ps.minEmitPower = 1.5;
        ps.maxEmitPower = 4;
        ps.gravity = new Vector3(0, -9.81, 0);
        ps.emitRate = 0;
        ps.manualEmitCount = 0;
        ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
        ps.start();
        return ps;
    }

    /** Throw up spray at a point; `energy` ~ impact speed in m/s. */
    splashAt(p: Vector3, energy: number): void {
        this.splash.emitter = p.clone();
        this.splash.minEmitPower = 0.8 + energy * 0.25;
        this.splash.maxEmitPower = 1.5 + energy * 0.6;
        this.splash.manualEmitCount = Math.min(220, Math.round(15 + energy * 25));
        this.ripples.addDrop(p.x, p.z, 0.25 + energy * 0.08, -0.05 * Math.min(energy, 8));
    }

    private physicsStep(): void {
        const dt = Math.min(0.1, (this.scene.deltaTime ?? 16) / 1000) || 1 / 60;
        for (const g of this.props) {
            const body = g.aggregate.body;
            // Held props are ANIMATED, so this also skips anything in a hand.
            if (body.getMotionType() !== PhysicsMotionType.DYNAMIC) {
                this.wasWet.set(g, false);
                continue;
            }
            const c = body.getObjectCenterWorld();
            const ext = g.mesh.getBoundingInfo().boundingBox.extendSizeWorld;
            const surface = this.surfaceAt(c.x, c.z);
            const half = Math.max(0.02, ext.y);
            const submerged = Math.min(1, Math.max(0, (surface - (c.y - half)) / (2 * half)));
            const wet = submerged > 0;
            const vel = body.getLinearVelocity();
            if (wet && !this.wasWet.get(g) && vel.y < -2.5) this.splashAt(new Vector3(c.x, surface, c.z), -vel.y);
            this.wasWet.set(g, wet);
            if (!wet) continue;

            const mass = body.getMassProperties().mass ?? 1;
            const volume = 8 * ext.x * ext.y * ext.z * 0.75;
            const matName = g.mesh.material?.name ?? "";
            // Metals and gems sink; everything else floats (buoyancy capped so light props don't rocket up).
            const sinks = matName === "gold" || matName === "chrome" || g.mesh.name === "diamond";
            const lift = sinks ? mass * 9.81 * 0.35 * submerged : Math.min(1000 * volume * submerged * 9.81, mass * 9.81 * 2.4 * submerged + mass * 9.81 * 0.2);
            const drag = vel.scale(-mass * 2.2 * submerged);
            // Gentle drift with the dominant swell.
            const drift = new Vector3(this.waveA[0], 0, this.waveA[1]).scaleInPlace(mass * 0.25 * submerged);
            body.applyForce(new Vector3(drag.x + drift.x, lift + drag.y, drag.z + drift.z), c);
            body.setAngularVelocity(body.getAngularVelocity().scaleInPlace(1 - Math.min(0.5, dt * 2.5 * submerged)));

            // Wake.
            const speed = Math.hypot(vel.x, vel.z) + Math.abs(vel.y) * 0.5;
            if (speed > 0.25 && Math.abs(c.y - surface) < half + 0.1) this.ripples.addDrop(c.x, c.z, Math.max(ext.x, ext.z) * 1.3, -0.015 * Math.min(speed, 5));
        }
    }

    private frame(): void {
        const dt = Math.min(0.1, (this.scene.deltaTime ?? 16) / 1000) || 1 / 60;
        this.time += dt;
        const cam = this.scene.activeCamera;
        if (!cam) return;
        const cp = cam.globalPosition;
        // The grid follows the camera in whole grid steps so it doesn't swim.
        this.mesh.position.x = Math.round(cp.x / this.gridStep) * this.gridStep;
        this.mesh.position.z = Math.round(cp.z / this.gridStep) * this.gridStep;

        // Player wading and splashing.
        const player = this.player;
        if (player) {
            const p = player.position;
            this.ripples.follow(p.x, p.z);
            const depth = player.waterDepth;
            const wet = depth > 0.02;
            const v = player.linearVelocity;
            if (wet && !this.playerWasWet && v.y < -2.5) this.splashAt(new Vector3(p.x, this.surfaceAt(p.x, p.z), p.z), -v.y * 1.4);
            this.playerWasWet = wet;
            if (wet && depth < 2.4) {
                const speed = Math.hypot(v.x, v.z);
                this.ripples.addDrop(p.x, p.z, 0.45, -0.012 - 0.03 * Math.min(speed, 4));
                if (speed > 3.5 && Math.random() < 0.3) this.splashAt(new Vector3(p.x, this.surfaceAt(p.x, p.z), p.z), speed * 0.4);
            }
        }

        // Hands and controllers.
        for (const probe of waterProbes) {
            const pos = probe.node.absolutePosition;
            const last = this.probeLast.get(probe.node) ?? pos.clone();
            const surface = this.surfaceAt(pos.x, pos.z);
            const vel = pos.subtract(last).scaleInPlace(1 / dt);
            const crossed = (last.y - surface) * (pos.y - surface) < 0;
            if (Math.abs(pos.y - surface) < probe.radius + 0.06 || crossed) {
                const speed = vel.length();
                this.ripples.addDrop(pos.x, pos.z, probe.radius * 2.5 + 0.05, -0.025 * Math.min(speed, 4) - 0.004);
                if (crossed && Math.abs(vel.y) > 2) this.splashAt(new Vector3(pos.x, surface, pos.z), Math.abs(vel.y) * 0.6);
            }
            this.probeLast.set(probe.node, pos.clone());
        }

        this.ripples.step();

        // Underwater: thick blue fog.
        const under = cp.y < this.surfaceAt(cp.x, cp.z) - 0.03;
        if (under !== this.underwater) {
            this.underwater = under;
            const s = this.scene;
            s.fogMode = under ? Scene.FOGMODE_EXP2 : Scene.FOGMODE_NONE;
            s.fogDensity = 0.11;
            s.fogColor = new Color3(0.03, 0.22, 0.28);
        }
    }
}

function smoothstep(a: number, b: number, x: number): number {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
}
