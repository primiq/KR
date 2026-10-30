// The giant wave that ends a trip too far out to sea, drawn on the Babylon side (world/boat.ts moves it): a wall of dark
// green water, lit through where it is thin near the top, streaked with foam running down its face, a white lip curling
// over, and spray blowing off the crest. It rises out of the storm far off and grows as it comes; the lightning shows it.
import { Color4, DynamicTexture, Effect, Mesh, ParticleSystem, type Scene, ShaderMaterial, Vector3, VertexBuffer, VertexData } from "@babylonjs/core";
import { NOISE_GLSL } from "../render/materials";
import { WAVE_PROFILE } from "./boat";

Effect.ShadersStore["bigWaveVertexShader"] = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute vec3 prof;
uniform mat4 world;
uniform mat4 viewProjection;
uniform float time;
varying vec3 vW;
varying vec3 vN;
varying vec3 vProf;
void main() {
    vec3 p = position;
    // the face heaves and ripples a little as it comes (more up top)
    p.y += sin(prof.y * 31.0 + time * 1.7) * 0.25 * prof.x + sin(prof.y * 11.0 - time * 0.9) * 0.35 * prof.x;
    vec4 w = world * vec4(p, 1.0);
    vW = w.xyz;
    vN = normalize(mat3(world) * normal);
    vProf = prof;
    gl_Position = viewProjection * w;
}`;

Effect.ShadersStore["bigWaveFragmentShader"] = `
precision highp float;
uniform vec3 cameraPos;
uniform float time;
uniform float day;
uniform float flash;
uniform vec3 fogColor;
uniform float fogDensity;
varying vec3 vW;
varying vec3 vN;
varying vec3 vProf;
${NOISE_GLSL}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * (cNoise(vec3(p, 0.0)) * 0.5 + 0.5); p *= 2.03; a *= 0.5; } return s / 0.94; }
void main() {
    vec3 N = normalize(vN);
    vec3 toCam = cameraPos - vW;
    float dist = length(toCam);
    vec3 V = toCam / dist;
    if (dot(N, V) < 0.0) N = -N;
    float h = vProf.x;            // 0 at the foot .. 1 at the crest
    // the water: near black-green at the foot, a glassy green higher up where it is thin enough for light to come through
    vec3 deep = vec3(0.012, 0.06, 0.07), glass = vec3(0.05, 0.36, 0.34);
    vec3 water = mix(deep, glass, smoothstep(0.35, 0.95, h));
    // foam: streaks dragged down the face, thicker near the top and at the foot, and the white lip itself
    vec2 q = vec2(vProf.y * 42.0, vW.y * 0.32 + time * 0.55);
    float streak = smoothstep(0.52, 0.78, fbm(q + vec2(0.0, fbm(q * 0.5) * 2.0)));
    float foam = streak * (0.25 + 0.75 * h) + smoothstep(0.85, 1.0, vProf.z) * (0.65 + 0.35 * fbm(q * 2.3));
    foam += smoothstep(0.12, 0.0, h) * 0.6 * fbm(q * 1.7 + 3.0);
    foam = clamp(foam, 0.0, 1.0);
    // light: what little there is in the storm, the lightning, and a sheen along the edges so its outline reads in the dark
    float amb = 0.16 + 0.84 * day;
    float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    vec3 col = mix(water, vec3(0.86, 0.92, 0.95), foam) * (amb + flash * 1.6);
    col += vec3(0.25, 0.4, 0.42) * rim * (0.35 + 0.65 * h) * (amb * 0.7 + flash);
    // far off it is grey in the rain like everything else
    float f = exp(-pow(fogDensity * dist, 2.0));
    col = mix(fogColor, col, clamp(f, 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
}`;

export class BigWave {
    readonly mesh: Mesh;
    private readonly mat: ShaderMaterial;
    private readonly spray: ParticleSystem;
    private time = 0;

    constructor(private readonly scene: Scene) {
        // the same shape the boats feel (WAVE_PROFILE), finer across, curving back at the ends
        const P = WAVE_PROFILE, W = 130, NW = 72, n = P.length;
        const pos: number[] = [], prof: number[] = [], idx: number[] = [];
        // the crest lip is the profile's points 4..8
        for (let i = 0; i <= NW; i++) {
            const w = (i / NW) * 2 - 1, hk = 1 - Math.pow(Math.abs(w), 4), back = w * w * 34;
            P.forEach(([d, y], j) => {
                pos.push(w * W, y * hk, d - back);
                const lip = j >= 4 && j <= 9 ? 1 - Math.abs(j - 6.5) / 3 : 0;
                prof.push(Math.max(0, y) / 17.5 * hk, w, Math.max(0, lip) * hk);
            });
        }
        for (let i = 0; i < NW; i++) for (let j = 0; j < n - 1; j++) { const a = i * n + j, b = a + n; idx.push(a, b, a + 1, a + 1, b, b + 1); }
        const normals: number[] = [];
        VertexData.ComputeNormals(pos, idx, normals);
        const vd = new VertexData();
        vd.positions = pos; vd.indices = idx; vd.normals = normals;
        this.mesh = new Mesh("bigWave", scene);
        vd.applyToMesh(this.mesh);
        this.mesh.setVerticesData("prof", prof, false, 3);
        this.mat = new ShaderMaterial("bigWaveMat", scene, { vertex: "bigWave", fragment: "bigWave" }, {
            attributes: [VertexBuffer.PositionKind, VertexBuffer.NormalKind, "prof"],
            uniforms: ["world", "viewProjection", "time", "cameraPos", "day", "flash", "fogColor", "fogDensity"],
        });
        this.mat.backFaceCulling = false;
        this.mesh.material = this.mat;
        this.mesh.isPickable = false;
        this.mesh.alwaysSelectAsActiveMesh = true;
        this.mesh.rotationQuaternion = null;
        this.mesh.isVisible = false;

        // spray blown off the crest
        const dot = new DynamicTexture("waveSprayDot", 32, scene, false);
        const ctx = dot.getContext();
        const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
        g.addColorStop(0, "rgba(255,255,255,0.9)");
        g.addColorStop(0.6, "rgba(230,240,245,0.35)");
        g.addColorStop(1, "rgba(220,235,240,0)");
        ctx.fillStyle = g; ctx.fillRect(0, 0, 32, 32);
        dot.update(); dot.hasAlpha = true;
        const ps = new ParticleSystem("waveSpray", 1500, scene);
        ps.particleTexture = dot;
        ps.emitter = new Vector3(0, -1000, 0);
        ps.createBoxEmitter(new Vector3(-1, 0.6, 0.6), new Vector3(1, 1.4, 1.2), new Vector3(-100, 0, 0), new Vector3(100, 0, 0));
        ps.color1 = new Color4(0.85, 0.9, 0.92, 0.32);
        ps.color2 = new Color4(0.7, 0.8, 0.85, 0.2);
        ps.colorDead = new Color4(0.7, 0.8, 0.85, 0);
        ps.minSize = 1.5; ps.maxSize = 4.5;
        ps.minLifeTime = 1.2; ps.maxLifeTime = 2.6;
        ps.minEmitPower = 3; ps.maxEmitPower = 8;
        ps.gravity = new Vector3(0, -4, 0);
        ps.emitRate = 0;
        ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
        ps.isLocal = false;
        ps.start();
        this.spray = ps;
    }

    /**
     * Once a frame. `w`: the wave (its foot, heading, how far it has grown, whether it is out there at all); `day` 0..1;
     * `flash`: lightning 0..1; the fog, so it greys with distance like everything else.
     */
    update(dt: number, w: { active: boolean; x: number; z: number; dx: number; dz: number; grow: number }, day: number, flash: number) {
        this.time += dt;
        this.mesh.isVisible = w.active;
        if (!w.active) { this.spray.emitRate = 0; return; }
        const yaw = Math.atan2(w.dx, w.dz);
        this.mesh.position.set(w.x, -0.6, w.z);
        this.mesh.rotation.set(0, yaw, 0);
        this.mesh.scaling.set(1, w.grow, 1);
        const cam = this.scene.activeCamera;
        const m = this.mat;
        m.setFloat("time", this.time);
        m.setFloat("day", day);
        m.setFloat("flash", flash);
        if (cam) m.setVector3("cameraPos", cam.globalPosition);
        m.setColor3("fogColor", this.scene.fogColor);
        m.setFloat("fogDensity", this.scene.fogMode ? this.scene.fogDensity : 0);
        // the spray comes off the lip (local +z is the way it travels), turned and sized with the wave
        const e = this.spray.emitter as Vector3;
        e.set(w.x + w.dx * 6, -0.6 + 16.5 * w.grow, w.z + w.dz * 6);
        const box = this.spray;
        const c = Math.cos(yaw), s = Math.sin(yaw);
        // across the wave is local x: (c, 0, -s) in the world
        box.minEmitBox = new Vector3(-100 * c, 0, 100 * s);
        box.maxEmitBox = new Vector3(100 * c, 0, -100 * s);
        box.direction1 = new Vector3(w.dx * 0.6 - 0.2 * c, 0.5, w.dz * 0.6 + 0.2 * s);
        box.direction2 = new Vector3(w.dx * 1.2 + 0.2 * c, 1.3, w.dz * 1.2 - 0.2 * s);
        box.minSize = 0.6 + 0.8 * w.grow; box.maxSize = 1.2 + 1.8 * w.grow;
        this.spray.emitRate = 120 + 380 * w.grow;
    }
}
