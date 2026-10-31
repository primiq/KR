// The Desert (through the sand-coloured door in the secret room): an oasis in the middle of endless dunes, after Noniv's
// SNOWFLOW demo (WebGPU snow) done again for this game's WebGL2 renderer and in sand.
//   The ground is the baked dune field (desertField.ts), drawn by two meshes that follow you and are displaced on the GPU:
//   a fine grid round your feet (12.5 cm apart) and a coarse one, its rows spaced wider and wider, out to the horizon
//   (which has a hole where the fine one is). Nothing is rebuilt on the CPU as you move.
//   The sand remembers: a 48 m window of it round you (512 x 512, toroidal: it scrolls with you without ever being
//   copied) holds how deep it has been pushed down and how much has been heaped up at the sides. Every footstep (yours
//   and other players') presses in a print with a little ridge of sand round it; the window is relaxed every frame, so
//   prints slump and soften and slowly fill in. The fine grid is displaced by it, and the sand is shaded darker and
//   smoother where it has been trodden.
//   The sand itself: warm grains in a few tones, windward ripples in the light, darker steep slip faces, and grains that
//   catch the sun and glint as you move. The oasis: a pond (you can swim in it), wet sand round it, a ring of green with
//   palms, bushes and grass. Building, crafting, placing, the day and night: all as on the island.
import {
    Color3, Constants, DynamicTexture, EffectRenderer, EffectWrapper, Mesh, ParticleSystem, PBRMaterial, RawTexture,
    RenderTargetTexture, type Scene, Texture, Vector3, VertexData, Color4,
} from "@babylonjs/core";
import { PBRCustomMaterial } from "@babylonjs/materials";
import * as THREE from "three";
import { NOISE_GLSL, foliageMaterial } from "../render/materials";
import { Inst } from "../render/inst";
import { buildBush, buildGrassTuft, buildPalm } from "./plants";
import { bake, DESERT_X, DESERT_Z, desertHeight, FIELD_CELL, FIELD_N, inDesert, OASIS_R, OASIS_WATER } from "./desertField";
import { mulberry32 } from "../core/noise";
import type { ColliderGrid } from "./vegetation";

/** the trodden-sand window (m), its texture size, the fine grid's size (m) and spacing (m) */
const WIN = 32, DEF_N = 512, FINE = 20, FINE_STEP = 0.125;
/** where you arrive (just off the pond's edge, facing it), and the arch that takes you back */
export const DESERT_SPAWN = { x: DESERT_X, z: DESERT_Z + OASIS_R + 9, yaw: 0 };
const ARCH = { x: DESERT_X, z: DESERT_Z + OASIS_R + 15 };

const DEFORM_FS = `
precision highp float;
varying vec2 vUV;
uniform sampler2D prevTex;
uniform vec2 curO;
uniform vec2 prevO;
uniform float size;
uniform float texel;
uniform float relax;
uniform float keep;
uniform vec4 brush[8];
uniform vec4 brushD[8];
uniform float nBrush;
void main(void) {
    // the world point this texel stands for in the window as it is now (toroidal: uv = fract(world / size))
    vec2 w = curO + fract(vUV - curO / size) * size;
    vec4 s = texture2D(prevTex, vUV);
    // a texel that has just come into the window (it was out of the old one) starts as untouched sand
    if (w.x < prevO.x || w.y < prevO.y || w.x >= prevO.x + size || w.y >= prevO.y + size) s = vec4(0.0);
    // the sand slumps (a little blur), the ridges faster than the prints, and slowly fills back in
    vec4 n = (texture2D(prevTex, vUV + vec2(texel, 0.0)) + texture2D(prevTex, vUV - vec2(texel, 0.0)) + texture2D(prevTex, vUV + vec2(0.0, texel)) + texture2D(prevTex, vUV - vec2(0.0, texel))) * 0.25;
    s.r = mix(s.r, n.r, relax);
    s.g = mix(s.g, n.g, relax * 3.0);
    s.rg *= keep;
    // footprints: pressed in, with sand pushed up in a low ridge round each one
    for (int i = 0; i < 8; i++) {
        if (float(i) >= nBrush) break;
        vec4 b = brush[i];
        vec2 r = w - b.xy, fd = brushD[i].xy;
        float d = length(vec2(dot(r, fd) / (b.z * 1.35), dot(r, vec2(-fd.y, fd.x)) / (b.z * 0.62)));
        float press = b.w * (1.0 - smoothstep(0.55, 1.0, d));
        float ridge = b.w * 0.45 * exp(-pow((d - 1.25) / 0.3, 2.0));
        s.r = max(s.r, press);
        s.g = max(s.g * (1.0 - press * 4.0), ridge);
        s.b = max(s.b, step(d, 1.0));
    }
    s.b *= keep;
    gl_FragColor = s;
}`;

export class Desert {
    active = false;
    private built = false;
    private coarse!: Mesh;
    private fine!: Mesh;
    private water!: Mesh;
    private fieldTex!: RawTexture;
    private def: RenderTargetTexture[] = [];
    private cur = 0;
    private fx!: EffectRenderer;
    private fxw!: EffectWrapper;
    private origin = { x: 0, z: 0 };
    private prevOrigin = { x: 1e9, z: 1e9 };
    private brushes: number[] = [];
    private brushDirs: number[] = [];
    private pass = { src: null as RenderTargetTexture | null, nB: 0, relax: 0, keep: 1, brush: new Array<number>(32).fill(0), dir: new Array<number>(32).fill(0) };
    private walkers = new Map<number | string, { x: number; z: number; acc: number; foot: number }>();
    private puffs!: ParticleSystem;
    private time = 0;
    private things: { setEnabled(v: boolean): void }[] = [];
    readonly arch = ARCH;

    constructor(private readonly scene: Scene, private readonly lite: boolean, private readonly colliders: ColliderGrid, private readonly sunDir: () => Vector3) {}

    /** build it all (the first time the desert is visited: a second or so) */
    private build() {
        this.built = true;
        const scene = this.scene, engine = scene.getEngine();
        // ---- the dune field, as a float texture the vertex shader reads (exactly the grid the game walks on)
        const field = bake();
        this.fieldTex = RawTexture.CreateRTexture(field, FIELD_N, FIELD_N, scene, false, false, Texture.NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT);
        this.fieldTex.wrapU = this.fieldTex.wrapV = Texture.CLAMP_ADDRESSMODE;

        // ---- the trodden-sand window (two textures, ping-ponged)
        for (let k = 0; k < 2; k++) {
            const rt = new RenderTargetTexture(`sandDeform${k}`, DEF_N, scene, { generateMipMaps: false, type: Constants.TEXTURETYPE_HALF_FLOAT, format: Constants.TEXTUREFORMAT_RGBA, samplingMode: Texture.BILINEAR_SAMPLINGMODE });
            rt.wrapU = rt.wrapV = Texture.WRAP_ADDRESSMODE;
            this.def.push(rt);
        }
        this.fx = new EffectRenderer(engine);
        this.fxw = new EffectWrapper({ engine, name: "sandDeform", fragmentShader: DEFORM_FS, uniformNames: ["curO", "prevO", "size", "texel", "relax", "keep", "brush", "brushD", "nBrush"], samplerNames: ["prevTex"] });
        // (added to, never cleared: the wrapper's own observer sets the full-screen quad's scale)
        this.fxw.onApplyObservable.add(() => {
            const e = this.fxw.effect, P = this.pass;
            e.setTexture("prevTex", P.src);
            e.setFloat2("curO", this.origin.x, this.origin.z);
            e.setFloat2("prevO", this.prevOrigin.x, this.prevOrigin.z);
            e.setFloat("size", WIN); e.setFloat("texel", 1 / DEF_N);
            e.setFloat("relax", P.relax); e.setFloat("keep", P.keep);
            e.setArray4("brush", P.brush); e.setArray4("brushD", P.dir); e.setFloat("nBrush", P.nB);
        });

        // ---- the sand
        const m = new PBRCustomMaterial("desertSand", scene);
        m.metallic = 0; m.roughness = 0.88; m.albedoColor = new Color3(1, 1, 1);
        m.AddUniform("dField", "sampler2D", null as never);
        m.AddUniform("dDef", "sampler2D", null as never);
        m.AddUniform("dInfo", "vec4", null as never);      // field centre x, z; half size; cell
        m.AddUniform("dWin", "vec4", null as never);       // window origin x, z; size; fine (1) or coarse (0)
        m.AddUniform("dFine", "vec4", null as never);      // fine grid centre x, z; half size; time
        m.AddUniform("dSun", "vec3", null as never);
        m.AddUniform("dOff", "vec2", null as never);      // this grid's position (its vertices are offsets from it)
        const FIELD_GLSL = `
float dFieldAt(vec2 w) {
    vec2 g = (w - dInfo.xy + vec2(dInfo.z)) / dInfo.w - 0.5;
    g = clamp(g, vec2(0.0), vec2(${(FIELD_N - 1.001).toFixed(3)}));
    ivec2 i = ivec2(floor(g)); vec2 t = g - vec2(i);
    float a = texelFetch(dField, i, 0).r, b = texelFetch(dField, i + ivec2(1, 0), 0).r;
    float c = texelFetch(dField, i + ivec2(0, 1), 0).r, d = texelFetch(dField, i + ivec2(1, 1), 0).r;
    return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
}
vec4 dDefAt(vec2 w) {
    vec2 r = (w - dWin.xy) / dWin.z;
    if (r.x < 0.0 || r.y < 0.0 || r.x > 1.0 || r.y > 1.0) return vec4(0.0);
    float edge = smoothstep(0.0, 0.08, min(min(r.x, r.y), min(1.0 - r.x, 1.0 - r.y)));
    return texture2D(dDef, fract(w / dWin.z)) * edge;
}
float dOffset(vec2 w) { vec4 s = dDefAt(w); return s.g - s.r; }
`;
        m.Vertex_Definitions(FIELD_GLSL);
        m.Vertex_Before_PositionUpdated(`
            vec2 dW = positionUpdated.xz + dOff;
            positionUpdated.y = dFieldAt(dW) + (dWin.w > 0.5 ? dOffset(dW) : 0.0);
        `);
        m.Vertex_Before_NormalUpdated(`
            {
                vec2 w = positionUpdated.xz + dOff;
                float e = 2.0;
                float hx = dFieldAt(w + vec2(e, 0.0)) - dFieldAt(w - vec2(e, 0.0)), hz = dFieldAt(w + vec2(0.0, e)) - dFieldAt(w - vec2(0.0, e));
                vec3 nn = vec3(-hx / (2.0 * e), 1.0, -hz / (2.0 * e));
                if (dWin.w > 0.5) {
                    float f = 0.1;
                    nn.x -= (dOffset(w + vec2(f, 0.0)) - dOffset(w - vec2(f, 0.0))) / (2.0 * f);
                    nn.z -= (dOffset(w + vec2(0.0, f)) - dOffset(w - vec2(0.0, f))) / (2.0 * f);
                }
                normalUpdated = normalize(nn);
            }
        `);
        m.Fragment_Definitions(NOISE_GLSL + FIELD_GLSL);
        m.Fragment_Custom_Albedo(`
            vec3 wp = vPositionW;
            // the coarse grid leaves a hole where the fine one is
            if (dWin.w < 0.5 && all(lessThan(abs(wp.xz - dFine.xy), vec2(dFine.z - 0.15)))) discard;
            vec3 nW = normalize(vNormalW);
            float dO = length(wp.xz - dInfo.xy);
            float n1 = cNoise(vec3(wp.xz * 0.045, 0.0)), n2 = cNoise(vec3(wp.xz * 0.6, 3.0)), n3 = cNoise(vec3(wp.xz * 3.1, 7.0));
            vec3 sand = mix(vec3(0.80, 0.56, 0.33), vec3(0.93, 0.74, 0.49), n1 * 0.5 + 0.5) * (0.93 + 0.07 * n2) * (0.97 + 0.03 * n3);
            // steep slip faces a shade darker and redder
            float slope = 1.0 - nW.y;
            sand = mix(sand, sand * vec3(0.86, 0.74, 0.62), smoothstep(0.12, 0.42, slope));
            // trodden sand: darker in the prints, a little lighter on the ridges
            vec4 tr = dDefAt(wp.xz);
            sand *= 1.0 - 2.4 * tr.r + 0.8 * tr.g;
            // the prints' shape, per pixel (sharper than the grid can show)
            if (dWin.w > 0.5) {
                float f = 0.04;
                float gx = (dOffset(wp.xz + vec2(f, 0.0)) - dOffset(wp.xz - vec2(f, 0.0))) / (2.0 * f);
                float gz = (dOffset(wp.xz + vec2(0.0, f)) - dOffset(wp.xz - vec2(0.0, f))) / (2.0 * f);
                normalW = normalize(normalW - vec3(gx, 0.0, gz) * 0.8);
            }
            // the oasis: wet sand round the pond, then a green ring
            float grass = 1.0 - smoothstep(46.0, 66.0, dO + n1 * 9.0);
            vec3 green = mix(vec3(0.20, 0.36, 0.06), vec3(0.11, 0.25, 0.04), n2 * 0.5 + 0.5);
            float wet = 1.0 - smoothstep(${OASIS_R.toFixed(1)} - 0.5, ${OASIS_R.toFixed(1)} + 3.5, dO + n2 * 0.8);
            vec3 col = mix(sand, green, grass * (1.0 - wet));
            col = mix(col, vec3(0.42, 0.33, 0.22), wet * 0.85);
            col *= exp(-vec3(0.5, 0.16, 0.08) * max(${OASIS_WATER.toFixed(1)} - wp.y, 0.0));
            surfaceAlbedo = col;
            // ripples on the bare sand, across the wind, flattened where it has been trodden and on the green
            float rip = sin(dot(wp.xz, vec2(0.94, 0.34)) * 7.0 + n1 * 4.0 + n2 * 1.2);
            float ripK = (1.0 - grass) * (1.0 - wet) * (1.0 - min(1.0, tr.b * 1.5)) * (1.0 - smoothstep(0.3, 0.6, slope)) * (1.0 - smoothstep(10.0, 45.0, length(wp - vEyePosition.xyz)));
            normalW = normalize(normalW + vec3(0.94, 0.0, 0.34) * cos(dot(wp.xz, vec2(0.94, 0.34)) * 7.0 + n1 * 4.0 + n2 * 1.2) * 0.13 * ripK);
            void(rip);
        `.replace("void(rip);", ""));
        m.Fragment_Custom_MetallicRoughness(`
            metallicRoughness.g = mix(metallicRoughness.g, 0.35, 1.0 - smoothstep(${OASIS_R.toFixed(1)}, ${OASIS_R.toFixed(1)} + 3.0, length(vPositionW.xz - dInfo.xy)));
        `);
        m.Fragment_Before_FragColor(`
            {
                // grains that catch the sun: a pin-prick of light that comes and goes as you move, mostly facing the sun
                vec3 cp = floor(vPositionW * 26.0);
                float h = fract(sin(dot(cp, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
                vec3 vd = normalize(vEyePosition.xyz - vPositionW);
                float tw = pow(max(0.0, sin(dot(vd, vec3(19.0, 23.0, 17.0)) + h * 40.0)), 30.0);
                float lit = max(0.0, dot(normalize(vNormalW), -dSun)) * smoothstep(-0.05, 0.15, -dSun.y);
                float near = 1.0 - smoothstep(4.0, 22.0, length(vPositionW - vEyePosition.xyz));
                float sandK = smoothstep(60.0, 70.0, length(vPositionW.xz - dInfo.xy));
                finalColor.rgb += vec3(1.0, 0.93, 0.8) * tw * step(0.965, h) * lit * near * sandK * 2.2;
            }
        `);
        m.onBindObservable.add((mesh) => {
            const e = m.getEffect(); if (!e) return;
            const fine = mesh === this.fine;
            e.setTexture("dField", this.fieldTex);
            e.setTexture("dDef", this.def[this.cur]);
            e.setFloat4("dInfo", DESERT_X, DESERT_Z, (FIELD_N * FIELD_CELL) / 2, FIELD_CELL);
            e.setFloat4("dWin", this.origin.x, this.origin.z, WIN, fine ? 1 : 0);
            e.setFloat4("dFine", this.fine.position.x, this.fine.position.z, FINE / 2, this.time);
            const s = this.sunDir(); e.setFloat3("dSun", s.x, s.y, s.z);
            const g = fine ? this.fine : this.coarse; e.setFloat2("dOff", g.position.x, g.position.z);
        });

        // the coarse grid: rows spaced wider and wider out to ~1.6 km (positions are offsets from where you are)
        const G = this.lite ? 150 : 200, R = 1500;
        const warp = (u: number) => Math.sign(u) * R * u * u;
        this.coarse = this.grid("desertCoarse", G, (i) => warp(i / G * 2 - 1));
        // the fine grid round your feet
        const F = Math.round(FINE / FINE_STEP);
        this.fine = this.grid("desertFine", F, (i) => -FINE / 2 + i * FINE_STEP);
        for (const g of [this.coarse, this.fine]) { g.material = m; g.receiveShadows = true; g.isPickable = false; g.alwaysSelectAsActiveMesh = true; g.metadata = { keepUnderground: true, desert: true }; }

        // ---- the pond
        const wm = new PBRCustomMaterial("oasisWater", scene);
        wm.albedoColor = new Color3(0.05, 0.22, 0.2); wm.metallic = 0; wm.roughness = 0.06; wm.alpha = 0.82;
        wm.AddUniform("wT", "float", 0);
        wm.Fragment_Definitions(NOISE_GLSL);
        wm.Fragment_Custom_Albedo(`
            vec2 q = vPositionW.xz * 1.3;
            float a = cNoise(vec3(q, wT * 0.6)), b = cNoise(vec3(q * 1.9 + 4.0, wT * 0.8));
            normalW = normalize(normalW + vec3(a, 0.0, b) * 0.12);
        `);
        wm.onBindObservable.add(() => wm.getEffect()?.setFloat("wT", this.time));
        const disc = new Mesh("oasisPond", scene);
        const vd = new VertexData(), pos: number[] = [0, 0, 0], idx: number[] = [], nrm: number[] = [0, 1, 0], segs = 64;
        for (let k = 0; k <= segs; k++) { const a = (k / segs) * Math.PI * 2; pos.push(Math.cos(a) * (OASIS_R + 1.2), 0, Math.sin(a) * (OASIS_R + 1.2)); nrm.push(0, 1, 0); }
        for (let k = 1; k <= segs; k++) idx.push(0, k + 1, k);
        vd.positions = pos; vd.indices = idx; vd.normals = nrm; vd.applyToMesh(disc);
        disc.position.set(DESERT_X, OASIS_WATER, DESERT_Z);
        disc.material = wm; disc.isPickable = false; disc.metadata = { keepUnderground: true, desert: true };
        this.water = disc;

        // ---- the oasis: palms round the pond, bushes, and grass
        this.plants();
        // ---- the arch back to the secret room: two sandstone pillars, a lintel, and a shimmering doorway
        this.buildArch();
        // ---- sand kicked up by footsteps
        const dot = new DynamicTexture("sandPuff", 32, scene, false);
        const ctx = dot.getContext(); const gr = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
        gr.addColorStop(0, "rgba(255,240,215,0.85)"); gr.addColorStop(1, "rgba(230,200,160,0)"); ctx.fillStyle = gr; ctx.fillRect(0, 0, 32, 32); dot.update(); dot.hasAlpha = true;
        const ps = new ParticleSystem("sandPuffs", 300, scene);
        ps.particleTexture = dot; ps.emitter = new Vector3(0, -1000, 0);
        ps.createSphereEmitter(0.12, 0.6);
        ps.color1 = new Color4(0.92, 0.8, 0.62, 0.55); ps.color2 = new Color4(0.85, 0.7, 0.5, 0.4); ps.colorDead = new Color4(0.85, 0.72, 0.55, 0);
        ps.minSize = 0.05; ps.maxSize = 0.16; ps.minLifeTime = 0.35; ps.maxLifeTime = 0.8; ps.minEmitPower = 0.3; ps.maxEmitPower = 0.9;
        ps.gravity = new Vector3(0, -2.5, 0); ps.emitRate = 0; ps.manualEmitCount = 0; ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
        ps.start();
        this.puffs = ps;
        this.things.push(this.coarse, this.fine, this.water);
        this.setVisible(false);
    }

    /** a grid of (n+1)^2 points at offsets `at(i)` in x and z (y comes from the shader) */
    private grid(name: string, n: number, at: (i: number) => number) {
        const pos = new Float32Array((n + 1) * (n + 1) * 3), idx = new Uint32Array(n * n * 6), nrm = new Float32Array((n + 1) * (n + 1) * 3);
        for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) { const k = (j * (n + 1) + i) * 3; pos[k] = at(i); pos[k + 2] = at(j); nrm[k + 1] = 1; }
        let o = 0;
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
            const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
            idx[o++] = a; idx[o++] = b; idx[o++] = c; idx[o++] = b; idx[o++] = d; idx[o++] = c;
        }
        const m = new Mesh(name, this.scene), vd = new VertexData();
        vd.positions = pos; vd.indices = idx; vd.normals = nrm; vd.applyToMesh(m);
        return m;
    }

    private plants() {
        const rnd = mulberry32(777), dummy = new THREE.Object3D();
        const place = (inst: Inst, n: number, rad: (k: number) => [number, number], scale: [number, number], sink: number, col: number) => {
            let k = 0;
            for (let i = 0; i < n * 3 && k < n; i++) {
                const [r, a] = rad(i), x = DESERT_X + Math.cos(a) * r, z = DESERT_Z + Math.sin(a) * r;
                const s = scale[0] + rnd() * (scale[1] - scale[0]);
                dummy.position.set(x, desertHeight(x, z) - sink, z); dummy.rotation.set((rnd() - 0.5) * 0.12, rnd() * 6.28, (rnd() - 0.5) * 0.12); dummy.scale.setScalar(s); dummy.updateMatrix();
                inst.setMatrixAt(k++, dummy.matrix);
                if (col) this.colliders.add({ x, z, r: col * s });
            }
            inst.count = k; inst.instanceMatrix.needsUpdate = true;
            inst.mesh.alwaysSelectAsActiveMesh = true;
            inst.mesh.metadata = { keepUnderground: true, desert: true };
            this.things.push(inst.mesh);
        };
        const palmMat = foliageMaterial(this.scene, "palm", 0.55);
        for (const [seed, n] of [[11, 9], [23, 8], [37, 8]] as const) {
            const inst = new Inst(`oasisPalm${seed}`, buildPalm(seed, this.lite ? 9 : 14), palmMat, n, this.scene, !this.lite);
            place(inst, n, () => [OASIS_R + 4 + rnd() * 26, rnd() * Math.PI * 2], [0.9, 1.3], 0.15, 0.3);
        }
        const bushMat = foliageMaterial(this.scene, "bush", 0.35, true, 0.7);
        for (const seed of [3, 8, 14]) {
            const inst = new Inst(`oasisBush${seed}`, buildBush(seed), bushMat, 14, this.scene);
            place(inst, 14, () => [OASIS_R + 3 + rnd() * 34, rnd() * Math.PI * 2], [0.8, 1.4], 0.05, 0);
        }
        const grassMat = foliageMaterial(this.scene, "oasisGrass", 0.5, true, 0.35);
        const gn = this.lite ? 1600 : 3200;
        const grass = new Inst("oasisGrass", buildGrassTuft(false), grassMat, gn, this.scene);
        place(grass, gn, () => [OASIS_R + 1.2 + Math.sqrt(rnd()) * 42, rnd() * Math.PI * 2], [0.8, 1.5], 0.03, 0);
    }

    private buildArch() {
        const stone = new PBRMaterial("archStone", this.scene); stone.albedoColor = new Color3(0.72, 0.55, 0.38); stone.metallic = 0; stone.roughness = 0.9;
        const glow = new PBRMaterial("archGlow", this.scene); glow.albedoColor = new Color3(0, 0, 0); glow.emissiveColor = new Color3(0.4, 0.75, 1.0); glow.alpha = 0.55; glow.disableLighting = true;
        const y = desertHeight(ARCH.x, ARCH.z);
        const box = (w: number, h: number, d: number, x: number, yy: number, m: PBRMaterial, name: string) => {
            const b = Mesh.CreateBox(name, 1, this.scene); b.scaling.set(w, h, d); b.position.set(ARCH.x + x, y + yy, ARCH.z); b.material = m; b.isPickable = false;
            b.metadata = { keepUnderground: true, desert: true }; this.things.push(b); return b;
        };
        box(0.6, 3.4, 0.6, -1.1, 1.5, stone, "archL"); box(0.6, 3.4, 0.6, 1.1, 1.5, stone, "archR"); box(3.0, 0.55, 0.8, 0, 3.35, stone, "archTop");
        box(1.6, 2.9, 0.05, 0, 1.45, glow, "archDoor");
        for (const x of [-1.1, 1.1]) this.colliders.add({ x: ARCH.x + x, z: ARCH.z, r: 0.42 });
    }

    private setVisible(v: boolean) { for (const t of this.things) t.setEnabled(v); if (this.puffs) this.puffs.emitRate = 0; }

    /** looking at the arch (to go back to the secret room)? */
    pickArch(eye: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, reach: number): number | null {
        if (!this.active) return null;
        const dx = ARCH.x - eye.x, dy = desertHeight(ARCH.x, ARCH.z) + 1.4 - eye.y, dz = ARCH.z - eye.z;
        const t = dx * dir.x + dy * dir.y + dz * dir.z;
        if (t < 0 || t > reach + 1.5) return null;
        const px = dx - dir.x * t, py = dy - dir.y * t, pz = dz - dir.z * t;
        return px * px + py * py + pz * pz <= 1.4 * 1.4 ? t : null;
    }

    /**
     * Every frame. `me`: where you are (the desert shows when you are in it); `walkers`: everybody's feet to leave prints
     * for (you and the other players here); `cam`: the camera (the grids follow it).
     */
    update(dt: number, me: { x: number; z: number }, walkers: { id: number | string; x: number; y: number; z: number; run: boolean }[], cam: Vector3) {
        const want = inDesert(me.x, me.z);
        if (want && !this.built) this.build();
        if (want !== this.active) { this.active = want; if (this.built) this.setVisible(want); }
        if (!this.active) return;
        this.time += dt;
        // the grids follow the camera (snapped, so the ground does not swim)
        const cs = 8, fs = FINE_STEP * 2;
        this.coarse.position.set(Math.round(cam.x / cs) * cs, 0, Math.round(cam.z / cs) * cs);
        this.fine.position.set(Math.round(cam.x / fs) * fs, 0, Math.round(cam.z / fs) * fs);
        // footprints: a print every stride, left and right in turn
        this.brushes.length = 0; this.brushDirs.length = 0;
        for (const w of walkers) {
            let s = this.walkers.get(w.id);
            if (!s) { s = { x: w.x, z: w.z, acc: 0, foot: 1 }; this.walkers.set(w.id, s); }
            const dx = w.x - s.x, dz = w.z - s.z, d = Math.hypot(dx, dz);
            s.x = w.x; s.z = w.z;
            if (d > 3) { s.acc = 0; continue; }                          // a jump in position (teleport): no trail
            if (w.y > desertHeight(w.x, w.z) + 0.25) continue;            // in the air
            s.acc += d;
            const stride = w.run ? 0.95 : 0.7;
            if (s.acc >= stride && d > 1e-4 && this.brushes.length < 32) {
                s.acc = 0; s.foot = -s.foot;
                const sx = -dz / d, sz = dx / d;                          // sideways
                const fx = w.x + sx * 0.15 * s.foot, fz = w.z + sz * 0.15 * s.foot;
                this.brushes.push(fx, fz, w.run ? 0.2 : 0.17, w.run ? 0.1 : 0.075); this.brushDirs.push(dx / d, dz / d, 0, 0);
                if (Math.hypot(fx - me.x, fz - me.z) < 30) {
                    (this.puffs.emitter as Vector3).set(fx, desertHeight(fx, fz) + 0.05, fz);
                    this.puffs.manualEmitCount = w.run ? 14 : 6;
                }
            }
        }
        // the trodden-sand window: follow you (snapped to a texel), relax, press in the new prints
        const tx = WIN / DEF_N;
        this.prevOrigin.x = this.origin.x; this.prevOrigin.z = this.origin.z;
        this.origin.x = Math.floor((me.x - WIN / 2) / tx) * tx; this.origin.z = Math.floor((me.z - WIN / 2) / tx) * tx;
        if (!this.fxw.effect.isReady()) return;
        const src = this.def[this.cur], dst = this.def[1 - this.cur];
        const b = this.brushes, nB = Math.min(8, b.length / 4), arr = this.pass.brush;
        arr.fill(0); this.pass.dir.fill(0); for (let i = 0; i < nB * 4; i++) { arr[i] = b[i]; this.pass.dir[i] = this.brushDirs[i]; }
        const k = Math.min(1, dt * 60);
        const P = this.pass;
        P.src = src; P.nB = nB; P.relax = 0.004 * k; P.keep = Math.exp(-dt * 0.003);
        this.fx.render(this.fxw, dst);
        this.cur = 1 - this.cur;
    }

    /** the water's surface here (for swimming in the pond), or null (no water) */
    surface(x: number, z: number): number | null {
        return Math.hypot(x - DESERT_X, z - DESERT_Z) < OASIS_R + 0.6 ? OASIS_WATER : null;
    }
}
