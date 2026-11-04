// The Desert (through the sand-coloured door in the secret room): an oasis in the middle of endless dunes, after Noniv's
// SNOWFLOW demo (WebGPU snow) done again for this game's WebGL2 renderer and in sand.
//   The ground is the baked dune field (desertField.ts), drawn by two meshes that follow you and are displaced on the GPU:
//   a fine grid round your feet (12.5 cm apart) and a coarse one, its rows spaced wider and wider, out to the horizon
//   (which has a hole where the fine one is). Nothing is rebuilt on the CPU as you move.
//   The sand remembers footsteps: a 32 m window of it round you (512 x 512, toroidal: it scrolls with you without ever being
//   copied) holds how deep it has been pushed down and how much has been heaped up at the sides. Every footstep (yours
//   and other players') presses in a print with a little ridge round it; prints slump, soften and slowly fill in.
//   Round the oasis the sand can be dug and heaped for good (with your hands in a headset, a rock, a pickaxe...: see
//   sandworks.ts), and the pond's water runs into whatever is dug below its level. The pond and every channel are drawn
//   with the sea's own shader (island/ocean.ts makeLake), and the ground near water greens night by night.
//   The sand itself: warm grains in a few tones, windward ripples, darker slip faces, darker where freshly dug or wet, and
//   grains that catch the sun and glint. The oasis's palms, bushes and rocks are the island's (world/vegetation.ts): fell
//   them, pick them, mine them.
import type { SandWorm } from "./sandworm";
import {
    Color3, Color4, Constants, DynamicTexture, type Effect, EffectRenderer, EffectWrapper, Mesh, ParticleSystem, PBRMaterial, RawTexture,
    RenderTargetTexture, type Scene, ShaderMaterial, Texture, ToHalfFloat, Vector3, VertexData,
} from "@babylonjs/core";
import { PBRCustomMaterial } from "@babylonjs/materials";
import grassJpg from "@eztree/app/public/grass.jpg?url";
import * as THREE from "three";
import { NOISE_GLSL, foliageMaterial } from "../render/materials";
import { Inst } from "../render/inst";
import { buildGrassTuft } from "./plants";
import {
    bake, DESERT_ARCH, DESERT_SPAWN, DESERT_X, DESERT_Z, desertHeight, dig, EDIT_HALF, EDIT_N, EDIT_X0, EDIT_Z0, FIELD_CELL, FIELD_N,
    digAt, green, GREEN_CELL, GREEN_N, groundAt, inDesert, OASIS_GREEN0, OASIS_GREEN1, OASIS_R, OASIS_WATER, wet, wetAt,
} from "./desertField";
import { type SandOp, SandWorks } from "./sandworks";
import type { Sandstorm } from "./sandstorm";
import { mulberry32, Noise2D, smoothstep as sstep } from "../core/noise";
import type { ColliderGrid } from "./vegetation";
import type { Ocean } from "../../island/ocean";
import { heightAt, inCut } from "./island";
import { POOL_GLSL, POOL_RECTS, poolRectsTexture } from "../game/building";

/** the trodden-sand window (m), its texture size, the fine grid's size (m) and spacing (m) */
const WIN = 32, DEF_N = 512, FINE = 20, FINE_STEP = 0.125;
/** the grass map's size (cells across the oasis square) */
const MASK_N = 512;
const GN1 = new Noise2D(5151), GN2 = new Noise2D(6262), GN4 = new Noise2D(7373);
export { DESERT_SPAWN };
const ARCH = DESERT_ARCH;

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

/** the pond and the channels: their surface, seabed (the dunes and the digging) and the small waves the wind raises */
const LAKE_VS = `
precision highp float;
attribute vec3 position;
uniform mat4 world;
uniform mat4 viewProjection;
uniform float time;
uniform sampler2D dField;
uniform sampler2D dDig;
uniform vec4 dInfo;
uniform vec4 lakeRect;
uniform float level;
varying vec3 vPos;
varying vec3 vNormal;
varying float vSeabed;
varying float vCrest;
varying vec2 vRippleUV;
float fieldAt(vec2 w) {
    vec2 g = (w - dInfo.xy + vec2(dInfo.z)) / dInfo.w - 0.5;
    g = clamp(g, vec2(0.0), vec2(${(FIELD_N - 1.001).toFixed(3)}));
    ivec2 i = ivec2(floor(g)); vec2 t = g - vec2(i);
    float a = texelFetch(dField, i, 0).r, b = texelFetch(dField, i + ivec2(1, 0), 0).r;
    float c = texelFetch(dField, i + ivec2(0, 1), 0).r, d = texelFetch(dField, i + ivec2(1, 1), 0).r;
    return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
}
void main(void) {
    vec4 wp = world * vec4(position, 1.0);
    vec2 xz = wp.xz;
    float sb = fieldAt(xz) + texture2D(dDig, clamp((xz - lakeRect.xy) / lakeRect.z, 0.0, 1.0)).r;
    float att = smoothstep(0.0, 0.8, level - sb);
    vec3 p = vec3(xz.x, level, xz.y), n = vec3(0.0, 1.0, 0.0);
    float crest = 0.0;
    // a breath of wind on still water: three small trains of ripples
    for (int i = 0; i < 3; i++) {
        float fi = float(i);
        float L = 2.6 / (1.0 + fi * 0.9), k = 6.2832 / L, A = (0.022 / (1.0 + fi * 1.4)) * att;
        vec2 d = vec2(cos(0.4 + fi * 1.9), sin(0.4 + fi * 1.9));
        float ph = k * dot(d, xz) - sqrt(9.81 * k) * time + fi * 1.7;
        p.y += A * sin(ph);
        n.xz -= d * k * A * cos(ph);
        crest += k * A * sin(ph);
    }
    vPos = p; vNormal = n; vSeabed = sb; vCrest = crest; vRippleUV = vec2(-1.0);
    gl_Position = viewProjection * vec4(p, 1.0);
}`;

export class Desert {
    active = false;
    /** the sandstorms (main makes it) */
    storm: Sandstorm | null = null;
    /** the sand worms far out in the dunes (world/sandworm.ts) */
    worm: SandWorm | null = null;
    /** 0 by day .. 1 at night (main sets it): the sand is darker by moonlight */
    night = 0;
    /** digging and heaping, the water and the green (the world's state: saved and shared) */
    readonly works = new SandWorks();
    /** multiplayer: a dig or a heap I made, for the others; the dawn's greening (the host decides when) */
    onEvent: ((e: { k: string; x?: number; z?: number; r?: number; d?: number }) => void) | null = null;
    /** a new dawn (main: the host greens the ground and tells everybody) */
    onDawn: (() => void) | null = null;
    private built = false;
    private coarse!: Mesh;
    private fine!: Mesh;
    private lake!: Mesh;
    private fieldTex!: RawTexture;
    private digTex!: RawTexture;
    private wetTex!: RawTexture;
    private greenTex!: RawTexture;
    private maskTex!: RawTexture;
    /** where grass grows (0..255, 50 cm cells over the oasis square): the ground's green and the grass blades both read it */
    private mask = new Uint8Array(MASK_N * MASK_N);
    private grassTex!: Texture;
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
    private lastHour = -1;
    private things: { setEnabled(v: boolean): void }[] = [];
    readonly arch = ARCH;

    constructor(private readonly scene: Scene, private readonly lite: boolean, private readonly colliders: ColliderGrid, private readonly sunDir: () => Vector3, private readonly ocean: Ocean) {}

    /** build it all (the first time the desert is visited: a second or so) */
    private build() {
        this.built = true;
        const scene = this.scene, engine = scene.getEngine();
        // ---- the dune field, as a float texture the vertex shader reads (exactly the grid the game walks on)
        const field = bake();
        this.fieldTex = RawTexture.CreateRTexture(field, FIELD_N, FIELD_N, scene, false, false, Texture.NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT);
        this.fieldTex.wrapU = this.fieldTex.wrapV = Texture.CLAMP_ADDRESSMODE;
        // ---- the oasis's state: the digging (half floats), the water and the green
        const d16 = new Uint16Array(EDIT_N * EDIT_N);
        for (let k = 0; k < d16.length; k++) d16[k] = ToHalfFloat(this.offsetAt(k));
        this.digTex = RawTexture.CreateRTexture(d16, EDIT_N, EDIT_N, scene, false, false, Texture.BILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_HALF_FLOAT);
        this.wetTex = new RawTexture(wet.map((v) => v * 255), EDIT_N, EDIT_N, Constants.TEXTUREFORMAT_R, scene, false, false, Texture.BILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_UNSIGNED_BYTE);
        this.greenTex = new RawTexture(green.slice(), GREEN_N, GREEN_N, Constants.TEXTUREFORMAT_R, scene, false, false, Texture.BILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_UNSIGNED_BYTE);
        this.maskTex = new RawTexture(this.mask, MASK_N, MASK_N, Constants.TEXTUREFORMAT_R, scene, false, false, Texture.BILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_UNSIGNED_BYTE);
        for (const t of [this.digTex, this.wetTex, this.greenTex, this.maskTex]) t.wrapU = t.wrapV = Texture.CLAMP_ADDRESSMODE;
        this.remask(EDIT_X0, EDIT_Z0, EDIT_X0 + EDIT_HALF * 2, EDIT_Z0 + EDIT_HALF * 2);
        this.works.digDirty = this.works.wetDirty = null; this.works.greenDirty = false;

        // ---- the grass texture (the island's)
        this.grassTex = new Texture(grassJpg, scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
        this.grassTex.anisotropicFilteringLevel = this.lite ? 2 : 8;
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
        m.metallic = 0; m.roughness = 0.9; m.albedoColor = new Color3(1, 1, 1);
        m.AddUniform("dField", "sampler2D", null as never);
        m.AddUniform("dDef", "sampler2D", null as never);
        m.AddUniform("dDig", "sampler2D", null as never);
        m.AddUniform("dWet", "sampler2D", null as never);
        m.AddUniform("dGreen", "sampler2D", null as never);
        m.AddUniform("dMask", "sampler2D", null as never);
        m.AddUniform("dGrassTex", "sampler2D", null as never);
        m.AddUniform("poolTex", "sampler2D", null as never);
        m.AddUniform("poolN", "float", 0);
        m.AddUniform("dInfo", "vec4", null as never);      // field centre x, z; half size; cell
        m.AddUniform("dWin", "vec4", null as never);       // window origin x, z; size; fine (1) or coarse (0)
        m.AddUniform("dFine", "vec4", null as never);      // fine grid centre x, z; half size; time
        m.AddUniform("dEdit", "vec4", null as never);      // the dug square: x0, z0, size; night 0..1
        m.AddUniform("dSun", "vec3", null as never);
        m.AddUniform("dOff", "vec2", null as never);       // this grid's position (its vertices are offsets from it)
        const FIELD_GLSL = `
float dFieldAt(vec2 w) {
    vec2 g = (w - dInfo.xy + vec2(dInfo.z)) / dInfo.w - 0.5;
    g = clamp(g, vec2(0.0), vec2(${(FIELD_N - 1.001).toFixed(3)}));
    ivec2 i = ivec2(floor(g)); vec2 t = g - vec2(i);
    float a = texelFetch(dField, i, 0).r, b = texelFetch(dField, i + ivec2(1, 0), 0).r;
    float c = texelFetch(dField, i + ivec2(0, 1), 0).r, d = texelFetch(dField, i + ivec2(1, 1), 0).r;
    return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
}
vec2 dEditUV(vec2 w) { return (w - dEdit.xy) / dEdit.z; }
bool dInEdit(vec2 u) { return u.x > 0.0 && u.y > 0.0 && u.x < 1.0 && u.y < 1.0; }
float dDigAt(vec2 w) { vec2 u = dEditUV(w); return dInEdit(u) ? texture2D(dDig, u).r : 0.0; }
float dWetAt(vec2 w) { vec2 u = dEditUV(w); return dInEdit(u) ? texture2D(dWet, u).r : 0.0; }
float dGreenAt(vec2 w) { vec2 u = dEditUV(w); return dInEdit(u) ? texture2D(dGreen, u).r : 0.0; }
float dMaskAt(vec2 w) { vec2 u = dEditUV(w); return dInEdit(u) ? texture2D(dMask, u).r : 0.0; }
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
            positionUpdated.y = dFieldAt(dW) + dDigAt(dW) + (dWin.w > 0.5 ? dOffset(dW) : 0.0);
        `);
        m.Vertex_Before_NormalUpdated(`
            {
                vec2 w = positionUpdated.xz + dOff;
                float e = 2.0;
                float hx = dFieldAt(w + vec2(e, 0.0)) - dFieldAt(w - vec2(e, 0.0)), hz = dFieldAt(w + vec2(0.0, e)) - dFieldAt(w - vec2(0.0, e));
                vec3 nn = vec3(-hx / (2.0 * e), 1.0, -hz / (2.0 * e));
                normalUpdated = normalize(nn);
            }
        `);
        m.Fragment_Definitions(NOISE_GLSL + FIELD_GLSL + POOL_GLSL);
        m.Fragment_Custom_Albedo(`
            vec3 wp = vPositionW;
            // (no sand inside a pool's basin)
            if (poolN > 0.5 && inPool(wp.xz)) discard;
            // the coarse grid leaves a hole where the fine one is
            if (dWin.w < 0.5 && all(lessThan(abs(wp.xz - dFine.xy), vec2(dFine.z - 0.15)))) discard;
            // the dug and heaped sand and the footprints, shaped per pixel (sharper than either grid can show)
            vec2 eu = dEditUV(wp.xz);
            if (dInEdit(eu)) {
                float f = 0.13;
                float gx = (dDigAt(wp.xz + vec2(f, 0.0)) - dDigAt(wp.xz - vec2(f, 0.0))) / (2.0 * f);
                float gz = (dDigAt(wp.xz + vec2(0.0, f)) - dDigAt(wp.xz - vec2(0.0, f))) / (2.0 * f);
                normalW = normalize(normalW - vec3(gx, 0.0, gz));
            }
            if (dWin.w > 0.5) {
                float f = 0.04;
                float gx = (dOffset(wp.xz + vec2(f, 0.0)) - dOffset(wp.xz - vec2(f, 0.0))) / (2.0 * f);
                float gz = (dOffset(wp.xz + vec2(0.0, f)) - dOffset(wp.xz - vec2(0.0, f))) / (2.0 * f);
                normalW = normalize(normalW - vec3(gx, 0.0, gz) * 0.8);
            }
            vec3 nW = normalW;
            float dO = length(wp.xz - dInfo.xy);
            float n1 = cNoise(vec3(wp.xz * 0.045, 0.0)), n2 = cNoise(vec3(wp.xz * 0.6, 3.0)), n3 = cNoise(vec3(wp.xz * 3.1, 7.0)), n4 = cNoise(vec3(wp.xz * 0.21, 11.0));
            // real sand reflects about half the light: warm ochre in a few tones (by moonlight it greys and darkens)
            vec3 sand = mix(vec3(0.60, 0.43, 0.27), vec3(0.72, 0.56, 0.37), n1 * 0.5 + 0.5) * (0.93 + 0.07 * n2) * (0.97 + 0.03 * n3);
            float slope = 1.0 - nW.y;
            sand = mix(sand, sand * vec3(0.86, 0.76, 0.66), smoothstep(0.12, 0.42, slope));
            // trodden sand: darker in the prints, a little lighter on the ridges
            vec4 tr = dDefAt(wp.xz);
            sand *= 1.0 - 2.4 * tr.r + 0.8 * tr.g;
            // freshly dug sand is damp and darker underneath
            float dg = dDigAt(wp.xz);
            sand *= 1.0 - 0.28 * smoothstep(0.02, 0.45, -dg);
            // water: wet sand beside it (the pond's shore and every channel's banks)
            float wetN = max(max(dWetAt(wp.xz + vec2(0.55, 0.0)), dWetAt(wp.xz - vec2(0.55, 0.0))), max(dWetAt(wp.xz + vec2(0.0, 0.55)), dWetAt(wp.xz - vec2(0.0, 0.55))));
${this.lite ? "" : `            wetN = max(wetN, 0.6 * max(max(dWetAt(wp.xz + vec2(1.3, 0.0)), dWetAt(wp.xz - vec2(1.3, 0.0))), max(dWetAt(wp.xz + vec2(0.0, 1.3)), dWetAt(wp.xz - vec2(0.0, 1.3)))));`}
            float wetK = max(wetN, 1.0 - smoothstep(${OASIS_R.toFixed(1)} - 0.5, ${OASIS_R.toFixed(1)} + 3.0, dO + n2 * 0.8));
            // the green: the oasis's own ring and whatever water has greened since; patchy, sand showing through, olive and
            // dusty rather than lawn-green
            // (where grass grows: the same map the grass blades grow from, so the two always agree)
            float grass = dMaskAt(wp.xz);
            vec3 green = mix(vec3(0.30, 0.37, 0.13), vec3(0.18, 0.27, 0.08), n2 * 0.5 + 0.5);
            // (drier, yellower patches here and there, and darker lusher ones where it is greenest)
            green = mix(green, vec3(0.42, 0.38, 0.19), smoothstep(0.35, 0.9, n4 * 0.5 + 0.5) * 0.5);
            green = mix(green, vec3(0.14, 0.24, 0.07), smoothstep(0.55, 0.95, n1 * 0.5 + 0.5) * 0.4);
            // the grass itself: the island's grass texture at two scales (so it never reads as tiled), tinted to the
            // oasis's dusty olive and its patches, with its blades roughening the light a little
            vec3 gt = toLinearSpace(texture2D(dGrassTex, wp.xz * 0.29).rgb);
            vec3 gt2 = toLinearSpace(texture2D(dGrassTex, wp.xz * 0.071 + vec2(0.37, 0.61)).rgb);
            vec3 gtex = mix(gt, gt2, 0.35);
            float gl = dot(gtex, vec3(0.333));
            // (the texture's detail, its greens pulled towards the oasis's olive and a little desaturated)
            vec3 tinted = gtex * vec3(0.86, 0.96, 0.56);
            tinted = mix(vec3(dot(tinted, vec3(0.3, 0.59, 0.11))), tinted, 0.85);
            green = mix(green * clamp(gl * 4.0, 0.6, 1.3), tinted, 0.6) * 1.4;
            green = clamp(green, vec3(0.0), vec3(0.5));
            if (grass > 0.05) {
                float gx = dot(toLinearSpace(texture2D(dGrassTex, wp.xz * 0.29 + vec2(0.004, 0.0)).rgb), vec3(0.333)) - dot(gt, vec3(0.333));
                float gz = dot(toLinearSpace(texture2D(dGrassTex, wp.xz * 0.29 + vec2(0.0, 0.004)).rgb), vec3(0.333)) - dot(gt, vec3(0.333));
                normalW = normalize(normalW - vec3(gx, 0.0, gz) * 6.0 * grass);
            }
            vec3 col = mix(sand, green, grass);
            col = mix(col, col * vec3(0.62, 0.56, 0.5), wetK * 0.8);
            // under water: darker and greener with depth (only where water really stands)
            float under = max(${OASIS_WATER.toFixed(1)} - wp.y, 0.0) * max(dWetAt(wp.xz), step(dO, ${OASIS_R.toFixed(1)}));
            col *= exp(-vec3(0.4, 0.14, 0.12) * under);
            col *= mix(1.0, 0.6, dEdit.w);
            surfaceAlbedo = col;
            // ripples on the bare sand, across the wind, flattened where it has been trodden, dug, watered or grown over
            float ripK = (1.0 - grass) * (1.0 - wetK) * (1.0 - min(1.0, tr.b * 1.5)) * (1.0 - smoothstep(0.02, 0.1, abs(dg))) * (1.0 - smoothstep(0.3, 0.6, slope)) * (1.0 - smoothstep(10.0, 45.0, length(wp - vEyePosition.xyz)));
            normalW = normalize(normalW + vec3(0.94, 0.0, 0.34) * cos(dot(wp.xz, vec2(0.94, 0.34)) * 7.0 + n1 * 4.0 + n2 * 1.2) * 0.13 * ripK);
        `);
        m.Fragment_Custom_MetallicRoughness(`
            metallicRoughness.g = mix(metallicRoughness.g, 0.45, 1.0 - smoothstep(${OASIS_R.toFixed(1)}, ${OASIS_R.toFixed(1)} + 3.0, length(vPositionW.xz - dInfo.xy)));
        `);
        // (the glinting grains: not in a headset, where every fragment counts)
        if (!this.lite) m.Fragment_Before_FragColor(`
            {
                // grains that catch the sun: a pin-prick of light that comes and goes as you move, mostly facing the sun
                vec3 cp = floor(vPositionW * 26.0);
                float h = fract(sin(dot(cp, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
                vec3 vd = normalize(vEyePosition.xyz - vPositionW);
                float tw = pow(max(0.0, sin(dot(vd, vec3(19.0, 23.0, 17.0)) + h * 40.0)), 30.0);
                float lit = max(0.0, dot(normalize(vNormalW), -dSun)) * smoothstep(-0.05, 0.15, -dSun.y) * (1.0 - dEdit.w);
                float near = 1.0 - smoothstep(4.0, 22.0, length(vPositionW - vEyePosition.xyz));
                float sandK = smoothstep(${OASIS_GREEN1.toFixed(1)}, ${(OASIS_GREEN1 + 10).toFixed(1)}, length(vPositionW.xz - dInfo.xy)) * (1.0 - dGreenAt(vPositionW.xz));
                finalColor.rgb += vec3(1.0, 0.93, 0.8) * tw * step(0.965, h) * lit * near * sandK * 1.6;
            }
        `);
        m.onBindObservable.add((mesh) => {
            const e = m.getEffect(); if (!e) return;
            const fine = mesh === this.fine;
            this.bindField(e);
            e.setTexture("dDef", this.def[this.cur]);
            e.setTexture("dWet", this.wetTex);
            e.setTexture("dGreen", this.greenTex);
            e.setTexture("dMask", this.maskTex);
            e.setTexture("dGrassTex", this.grassTex);
            e.setTexture("poolTex", poolRectsTexture(this.scene));
            e.setFloat("poolN", POOL_RECTS.n);
            e.setFloat4("dWin", this.origin.x, this.origin.z, WIN, fine ? 1 : 0);
            e.setFloat4("dFine", this.fine.position.x, this.fine.position.z, FINE / 2, this.time);
            e.setFloat4("dEdit", EDIT_X0, EDIT_Z0, EDIT_HALF * 2, this.night);
            const s = this.sunDir(); e.setFloat3("dSun", s.x, s.y, s.z);
            const g = fine ? this.fine : this.coarse; e.setFloat2("dOff", g.position.x, g.position.z);
        });

        // the coarse grid: rows spaced wider and wider out to ~1.5 km (positions are offsets from where you are)
        const G = this.lite ? 150 : 200, R = 1500;
        const warp = (u: number) => Math.sign(u) * R * u * u;
        this.coarse = this.grid("desertCoarse", G, (i) => warp(i / G * 2 - 1));
        // the fine grid round your feet
        const F = Math.round(FINE / FINE_STEP);
        this.fine = this.grid("desertFine", F, (i) => -FINE / 2 + i * FINE_STEP);
        for (const g of [this.coarse, this.fine]) { g.material = m; g.receiveShadows = true; g.isPickable = false; g.alwaysSelectAsActiveMesh = true; g.metadata = { keepUnderground: true, desert: true }; }
        // ---- the lawn: a dense field of tiny grass blades, all placed on the GPU
        this.lawn(FIELD_GLSL);

        // ---- the pond and the channels: the sea's own water, wherever water stands (rows closer together near you)
        const lm: ShaderMaterial = this.ocean.makeLake("oasisLake", LAKE_VS, ["dInfo", "level"], ["dField", "dDig"], (e) => {
            this.bindField(e);
            e.setTexture("lakeMask", this.wetTex);
            e.setFloat4("lakeRect", EDIT_X0, EDIT_Z0, EDIT_HALF * 2, 0);
            e.setFloat("level", OASIS_WATER);
            e.setColor3("shallowColor", new Color3(0.07, 0.5, 0.46));
            e.setColor3("deepColor", new Color3(0.01, 0.07, 0.07));
        });
        const LW = this.lite ? 120 : 180, LR = EDIT_HALF * 1.2;
        this.lake = this.grid("oasisLake", LW, (i) => { const u = i / LW * 2 - 1; return Math.sign(u) * LR * (0.08 * Math.abs(u) + 0.92 * u * u); });
        this.lake.material = lm; this.lake.isPickable = false; this.lake.alwaysSelectAsActiveMesh = true;
        this.lake.alphaIndex = 5; this.lake.metadata = { keepUnderground: true, desert: true };

        // ---- grass: tufts in the oasis's own green, reeds round the pond, and tufts wherever water has greened the sand
        this.grass();
        // ---- the arch back to the secret room: two sandstone pillars, a lintel, and a shimmering doorway
        this.buildArch();
        // ---- sand kicked up by footsteps and thrown up by digging
        const dot = new DynamicTexture("sandPuff", 32, scene, false);
        const ctx = dot.getContext(); const gr = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
        gr.addColorStop(0, "rgba(255,240,215,0.85)"); gr.addColorStop(1, "rgba(230,200,160,0)"); ctx.fillStyle = gr; ctx.fillRect(0, 0, 32, 32); dot.update(); dot.hasAlpha = true;
        const ps = new ParticleSystem("sandPuffs", 400, scene);
        ps.particleTexture = dot; ps.emitter = new Vector3(0, -1000, 0);
        ps.createSphereEmitter(0.12, 0.6);
        ps.color1 = new Color4(0.78, 0.64, 0.46, 0.6); ps.color2 = new Color4(0.7, 0.56, 0.4, 0.45); ps.colorDead = new Color4(0.7, 0.58, 0.44, 0);
        ps.minSize = 0.05; ps.maxSize = 0.16; ps.minLifeTime = 0.35; ps.maxLifeTime = 0.8; ps.minEmitPower = 0.3; ps.maxEmitPower = 0.9;
        ps.gravity = new Vector3(0, -2.5, 0); ps.emitRate = 0; ps.manualEmitCount = 0; ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
        ps.start();
        this.puffs = ps;
        this.things.push(this.coarse, this.fine, this.lake);
        this.setVisible(false);
    }

    private lawnNear!: Mesh;
    private lawnFar!: Mesh;
    private lawnSpec = { near: { s: 1 / 13, half: 11 }, far: { s: 1 / 6, half: 34 } };
    /**
     * The grass: tens of thousands of tiny blades in two fixed lattices (a dense one round you and a sparser, wider-bladed
     * one out to ~35 m, cross-fading between them), each lattice one mesh that follows the camera in whole metres. Nothing
     * is placed on the CPU: the vertex shader puts every blade on the ground (the same dunes and digging the sand is drawn
     * from), jitters, turns, sizes and sways it from its own world position, and shrinks it to nothing wherever the grass
     * map says there is no grass. Two draw calls for the lot.
     */
    private lawn(FIELD_GLSL: string) {
        if (this.lite) { this.lawnSpec.near = { s: 1 / 9, half: 8 }; this.lawnSpec.far = { s: 1 / 4, half: 24 }; }
        const blades = (name: string, s: number, half: number) => {
            const n = Math.round((half * 2) / s), cnt = (n + 1) * (n + 1);
            const pos = new Float32Array(cnt * 9), nrm = new Float32Array(cnt * 9), idx = new Uint32Array(cnt * 3);
            let v = 0;
            for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
                const x = (i - n / 2) * s, z = (j - n / 2) * s;
                // (y says which corner: -4 the base's left, 4 its right, 1 the tip)
                for (const y of [-4, 4, 1]) { pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z; nrm[v * 3 + 1] = 1; idx[v] = v; v++; }
            }
            const mesh = new Mesh(name, this.scene), vd = new VertexData();
            vd.positions = pos; vd.normals = nrm; vd.indices = idx; vd.applyToMesh(mesh);
            return mesh;
        };
        const g = new PBRCustomMaterial("oasisLawn", this.scene);
        g.metallic = 0; g.roughness = 0.85; g.albedoColor = new Color3(1, 1, 1); g.backFaceCulling = false; g.twoSidedLighting = true;
        g.AddUniform("dField", "sampler2D", null as never);
        g.AddUniform("dDig", "sampler2D", null as never);
        g.AddUniform("dMask", "sampler2D", null as never);
        g.AddUniform("dInfo", "vec4", null as never);
        g.AddUniform("dEdit", "vec4", null as never);
        g.AddUniform("gLat", "vec4", null as never);     // lattice spacing, blade width, far (1) or near (0), time
        g.AddUniform("gOff", "vec4", null as never);     // this mesh's offset from the oasis (x, z); the near lattice's middle (x, z) from the oasis
        g.AddUniform("gFade", "vec4", null as never);    // near half size, far half size, eye x, z from the oasis
        const defs = `
float dFieldAt(vec2 w) {
    vec2 g = (w - dInfo.xy + vec2(dInfo.z)) / dInfo.w - 0.5;
    g = clamp(g, vec2(0.0), vec2(${(FIELD_N - 1.001).toFixed(3)}));
    ivec2 i = ivec2(floor(g)); vec2 t = g - vec2(i);
    float a = texelFetch(dField, i, 0).r, b = texelFetch(dField, i + ivec2(1, 0), 0).r;
    float c = texelFetch(dField, i + ivec2(0, 1), 0).r, d = texelFetch(dField, i + ivec2(1, 1), 0).r;
    return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
}
vec2 dEditUV(vec2 w) { return (w - dEdit.xy) / dEdit.z; }
bool dInEdit(vec2 u) { return u.x > 0.0 && u.y > 0.0 && u.x < 1.0 && u.y < 1.0; }
float dDigAt(vec2 w) { vec2 u = dEditUV(w); return dInEdit(u) ? texture2D(dDig, u).r : 0.0; }
float dMaskAt(vec2 w) { vec2 u = dEditUV(w); return dInEdit(u) ? texture2D(dMask, u).r : 0.0; }
float gHash(vec2 p) { p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
varying float vGT;
varying float vGV;
`;
        void FIELD_GLSL;
        g.Vertex_Definitions(defs);
        g.Vertex_Before_PositionUpdated(`
            {
                vec3 lp = positionUpdated;
                float corner = lp.y;
                // this blade's lattice point, in metres from the oasis (small numbers: exact enough to hash)
                vec2 rel = lp.xz + gOff.xy;
                vec2 cid = floor(rel / gLat.x + 0.5);
                float h1 = gHash(cid), h2 = gHash(cid + 17.31), h3 = gHash(cid + 5.17), h4 = gHash(cid + 9.73);
                rel = cid * gLat.x + (vec2(h1, h2) - 0.5) * gLat.x * 0.95;
                vec2 w = rel + dInfo.xy;
                float cov = dMaskAt(w);
                // the two lattices cross-fade over the last 3 m of the near one
                vec2 dn = abs(rel - gOff.zw);
                float cheb = max(dn.x, dn.y);
                float k = gLat.z > 0.5 ? smoothstep(gFade.x - 3.0, gFade.x, cheb) * (1.0 - smoothstep(gFade.y * 0.7, gFade.y, length(rel - gFade.zw)))
                                       : 1.0 - smoothstep(gFade.x - 3.0, gFade.x, cheb);
                float H = (0.08 + 0.14 * h3) * smoothstep(0.1, 0.5, cov) * k * (gLat.z > 0.5 ? 1.25 : 1.0);
                float Wd = gLat.y * (0.7 + 0.6 * h4) * step(0.004, H);
                float a = h1 * 6.2832;
                vec2 across = vec2(cos(a), sin(a));
                // leaning a little its own way, and swaying in the wind
                float sway = sin(gLat.w * 1.9 + w.x * 0.55 + w.y * 0.38) * 0.5 + sin(gLat.w * 3.1 + w.x * 1.3) * 0.25;
                vec2 lean = (vec2(cos(h2 * 6.2832), sin(h2 * 6.2832)) * 0.35 + vec2(0.94, 0.34) * sway * 0.45) * H;
                float t = abs(corner) < 2.0 ? 1.0 : 0.0, side = corner < -2.0 ? -1.0 : (corner > 2.0 ? 1.0 : 0.0);
                vec2 p = rel + across * side * Wd * 0.5 + lean * t;
                float y = dFieldAt(w) + dDigAt(w) + t * H - 0.01;
                positionUpdated = vec3(p.x - gOff.x, y, p.y - gOff.y);
                vGT = t; vGV = h3 * 0.6 + h4 * 0.4;
            }
        `);
        g.Vertex_Before_NormalUpdated(`normalUpdated = vec3(0.0, 1.0, 0.0);`);
        g.Fragment_Definitions("varying float vGT;\nvarying float vGV;\n");
        g.Fragment_Custom_Albedo(`
            // dark and lush at the root, lighter and a little sun-bleached at the tips
            vec3 base = vec3(0.07, 0.15, 0.035), tip = vec3(0.30, 0.46, 0.13);
            vec3 c = mix(base, tip, vGT) * (0.78 + 0.44 * vGV);
            c = mix(c, vec3(0.44, 0.42, 0.2), smoothstep(0.7, 1.0, vGV) * 0.45 * vGT);
            surfaceAlbedo = c * mix(1.0, 0.6, dEdit.w);
        `);
        g.onBindObservable.add((mesh) => {
            const e = g.getEffect(); if (!e) return;
            const far = mesh === this.lawnFar, sp = far ? this.lawnSpec.far : this.lawnSpec.near;
            this.bindField(e);
            e.setTexture("dMask", this.maskTex);
            e.setFloat4("dEdit", EDIT_X0, EDIT_Z0, EDIT_HALF * 2, this.night);
            e.setFloat4("gLat", sp.s, far ? 0.07 : 0.045, far ? 1 : 0, this.time);
            const M = far ? this.lawnFar : this.lawnNear;
            e.setFloat4("gOff", M.position.x - DESERT_X, M.position.z - DESERT_Z, this.lawnNear.position.x - DESERT_X, this.lawnNear.position.z - DESERT_Z);
            e.setFloat4("gFade", this.lawnSpec.near.half, this.lawnSpec.far.half, this.lawnEye.x - DESERT_X, this.lawnEye.z - DESERT_Z);
        });
        this.lawnNear = blades("oasisLawnNear", this.lawnSpec.near.s, this.lawnSpec.near.half);
        this.lawnFar = blades("oasisLawnFar", this.lawnSpec.far.s, this.lawnSpec.far.half);
        for (const l of [this.lawnNear, this.lawnFar]) { l.material = g; l.isPickable = false; l.alwaysSelectAsActiveMesh = true; l.receiveShadows = !this.lite; l.metadata = { keepUnderground: true, desert: true }; this.things.push(l); }
    }
    private lawnEye = new Vector3();

    private bindField(e: Effect) {
        e.setTexture("dField", this.fieldTex);
        e.setTexture("dDig", this.digTex);
        e.setFloat4("dInfo", DESERT_X, DESERT_Z, (FIELD_N * FIELD_CELL) / 2, FIELD_CELL);
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

    private grass() {
        const rnd = mulberry32(777);
        const mat = foliageMaterial(this.scene, "oasisGrass", 0.5, true, 0.35);
        // (dusty olive grass, a little sun-bleached at the tips: an oasis, not a lawn)
        const tuft = buildGrassTuft(false, "#55602a", "#a49a5c"), reed = buildGrassTuft(false, "#3f4f22", "#8a8a4c");
        const put = (inst: Inst, k: number, x: number, z: number, sx: number, sy: number) => {
            const t = { inst, k, x, z, sx, sy, rx: (rnd() - 0.5) * 0.15, ry: rnd() * 6.28, rz: (rnd() - 0.5) * 0.15 };
            this.tufts.push(t); this.setTuft(t);
        };
        const nr = this.lite ? 260 : 520, reeds = new Inst("oasisReeds", reed, mat, nr, this.scene);
        for (let i = 0; i < nr; i++) {
            const a = rnd() * 6.28, r = OASIS_R - 1.2 + rnd() * 2.6, x = DESERT_X + Math.cos(a) * r, z = DESERT_Z + Math.sin(a) * r;
            if (Math.sin(a * 5.3) + Math.sin(a * 2.1) < -0.6) { put(reeds, i, x, z, 0, 0); continue; }   // (gaps, so it is clumps)
            put(reeds, i, x, z, 0.8 + rnd() * 0.4, 2.2 + rnd() * 1.4);
        }
        for (const g of [reeds]) { g.instanceMatrix.needsUpdate = true; g.mesh.alwaysSelectAsActiveMesh = true; g.mesh.metadata = { keepUnderground: true, desert: true }; this.things.push(g.mesh); }
        void tuft;
    }

    private tufts: { inst: Inst; k: number; x: number; z: number; sx: number; sy: number; rx: number; ry: number; rz: number }[] = [];
    private tuftDummy = new THREE.Object3D();
    /** a tuft stands on the ground as it is (and is not there at all under a building, or where its sand was dug away) */
    private setTuft(t: Desert["tufts"][number]) {
        const d = this.tuftDummy, gone = inCut(t.x, t.z, 0.35) || t.sx === 0 || digAt(t.x, t.z) < -0.12 || wetAt(t.x, t.z) && digAt(t.x, t.z) < 0;
        d.position.set(t.x, heightAt(t.x, t.z) - 0.03, t.z); d.rotation.set(t.rx, t.ry, t.rz);
        d.scale.set(gone ? 0 : t.sx, gone ? 0 : t.sy, gone ? 0 : t.sx); d.updateMatrix(); t.inst.setMatrixAt(t.k, d.matrix);
    }
    /** the sand's height offset in cell k (dug, heaped, or levelled under a building), for the GPU */
    private offsetAt(k: number) {
        const i = k % EDIT_N, j = (k - i) / EDIT_N, x = EDIT_X0 + (i + 0.5) * (EDIT_HALF * 2 / EDIT_N), z = EDIT_Z0 + (j + 0.5) * (EDIT_HALF * 2 / EDIT_N);
        return inCut(x, z, 4.2) ? heightAt(x, z) - desertHeight(x, z) : dig[k];
    }
    /** the sand was dug or filled here: the reeds on it go with it (or come back when it is filled in again) */
    groundDug(x0: number, z0: number, x1: number, z1: number) {
        const touched = new Set<Inst>();
        for (const t of this.tufts) if (t.x > x0 && t.x < x1 && t.z > z0 && t.z < z1) { this.setTuft(t); touched.add(t.inst); }
        for (const inst of touched) inst.instanceMatrix.needsUpdate = true;
    }
    /** a building went up or came down here: the sand under it is levelled (or comes back), grass under it goes */
    terrainChanged(x0: number, z0: number, x1: number, z1: number) {
        const c = EDIT_HALF * 2 / EDIT_N, i0 = Math.max(0, Math.floor((x0 - EDIT_X0) / c)), i1 = Math.min(EDIT_N - 1, Math.ceil((x1 - EDIT_X0) / c));
        const j0 = Math.max(0, Math.floor((z0 - EDIT_Z0) / c)), j1 = Math.min(EDIT_N - 1, Math.ceil((z1 - EDIT_Z0) / c));
        if (i0 > i1 || j0 > j1) return;
        const w = this.works, r = w.digDirty;
        w.digDirty = r ? { i0: Math.min(r.i0, i0), j0: Math.min(r.j0, j0), i1: Math.max(r.i1, i1), j1: Math.max(r.j1, j1) } : { i0, j0, i1, j1 };
        if (!this.built) return;
        const touched = new Set<Inst>();
        for (const t of this.tufts) if (t.x > x0 && t.x < x1 && t.z > z0 && t.z < z1) { this.setTuft(t); touched.add(t.inst); }
        for (const inst of touched) inst.instanceMatrix.needsUpdate = true;
        this.remask(x0, z0, x1, z1);
    }

    /** how thick the grass is at a point (0..1): the oasis's own green ring and whatever water has greened, in patches,
     *  none in water, at the water's very edge, or under a building */
    private coverAt(x: number, z: number): number {
        const d = Math.hypot(x - DESERT_X, z - DESERT_Z);
        if (d < OASIS_R - 0.3 || wetAt(x, z) || inCut(x, z, 0.15)) return 0;
        // (freshly dug ground is bare sand)
        if (digAt(x, z) < -0.12) return 0;
        if (wetAt(x + 0.5, z) || wetAt(x - 0.5, z) || wetAt(x, z + 0.5) || wetAt(x, z - 0.5)) return 0;
        const n1 = GN1.get(x * 0.045, z * 0.045), n2 = GN2.get(x * 0.6, z * 0.6), n4 = GN4.get(x * 0.21, z * 0.21);
        const g0 = 1 - sstep(OASIS_GREEN0, OASIS_GREEN1, d + n1 * 7);
        const gi = Math.floor((x - EDIT_X0) / GREEN_CELL), gj = Math.floor((z - EDIT_Z0) / GREEN_CELL);
        const gg = gi >= 0 && gj >= 0 && gi < GREEN_N && gj < GREEN_N ? green[gj * GREEN_N + gi] / 255 : 0;
        const gr = Math.max(g0, gg);
        return sstep(0.4, 0.8, gr * (0.72 + 0.5 * (n4 * 0.5 + 0.5)) + n2 * 0.12);
    }
    /** work the grass map out again here (and send it to the GPU) */
    private remask(x0: number, z0: number, x1: number, z1: number) {
        const c = (EDIT_HALF * 2) / MASK_N;
        const i0 = Math.max(0, Math.floor((x0 - EDIT_X0) / c) & ~3), i1 = Math.min(MASK_N - 1, Math.ceil((x1 - EDIT_X0) / c) | 3);
        const j0 = Math.max(0, Math.floor((z0 - EDIT_Z0) / c)), j1 = Math.min(MASK_N - 1, Math.ceil((z1 - EDIT_Z0) / c));
        if (i0 > i1 || j0 > j1) return;
        const W = i1 - i0 + 1, H = j1 - j0 + 1, sub = new Uint8Array(W * H);
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
            const v = Math.round(this.coverAt(EDIT_X0 + (i + 0.5) * c, EDIT_Z0 + (j + 0.5) * c) * 255);
            this.mask[j * MASK_N + i] = v; sub[(j - j0) * W + (i - i0)] = v;
        }
        const it = this.maskTex?.getInternalTexture();
        if (it) (this.scene.getEngine() as unknown as { updateTextureData(t: unknown, d: ArrayBufferView, x: number, y: number, w: number, h: number): void }).updateTextureData(it, sub, i0, j0, W, H);
    }

    private buildArch() {
        const stone = new PBRMaterial("archStone", this.scene); stone.albedoColor = new Color3(0.6, 0.46, 0.32); stone.metallic = 0; stone.roughness = 0.9;
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

    // ---------------------------------------------------------------- digging
    /** can the sand here be dug (round the oasis, not under the water)? */
    diggable(x: number, z: number) {
        return Math.abs(x - DESERT_X) < EDIT_HALF - 1 && Math.abs(z - DESERT_Z) < EDIT_HALF - 1;
    }
    /** where a look along `dir` meets the sand (within `reach`), or null */
    ray(eye: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, reach: number): { x: number; y: number; z: number; t: number } | null {
        if (!this.active) return null;
        let prev = 0;
        for (let t = 0.3; t <= reach; t += 0.08) {
            const x = eye.x + dir.x * t, y = eye.y + dir.y * t, z = eye.z + dir.z * t;
            if (y <= groundAt(x, z)) {
                // (a few halvings back towards the last point above the sand)
                let a = prev, b = t;
                for (let k = 0; k < 5; k++) { const m = (a + b) / 2; if (eye.y + dir.y * m <= groundAt(eye.x + dir.x * m, eye.z + dir.z * m)) b = m; else a = m; }
                const xx = eye.x + dir.x * b, zz = eye.z + dir.z * b;
                return { x: xx, y: groundAt(xx, zz), z: zz, t: b };
            }
            prev = t;
        }
        return null;
    }
    /** dig (d < 0) or heap (d > 0) here; `mine`: I did it (tell the others). Returns the sand moved (m³). */
    dig(op: SandOp, mine = true): number {
        if (!this.diggable(op.x, op.z)) return 0;
        const v = this.works.apply(op);
        if (v > 0 && mine) this.onEvent?.({ k: "sd", x: +op.x.toFixed(3), z: +op.z.toFixed(3), r: +op.r.toFixed(3), d: +op.d.toFixed(3) });
        if (v > 0 && this.puffs && this.active) {
            (this.puffs.emitter as Vector3).set(op.x, groundAt(op.x, op.z) + 0.08, op.z);
            this.puffs.manualEmitCount = Math.min(60, 8 + Math.round(v * 400));
        }
        return v;
    }
    /** another player dug or heaped */
    remote(e: { x: number; z: number; r: number; d: number }) { this.dig(e, false); }
    /** the dawn's greening (every player runs it, the host says when): metres greened */
    green(): number { const n = this.works.dawn(); if (n > 0) this.onGreened?.(n); return n; }
    /** the ground greened overnight (m²) */
    onGreened: ((m2: number) => void) | null = null;
    capture() { return this.works.capture(); }
    restore(s: Parameters<SandWorks["restore"]>[0]) { this.works.restore(s); }

    /**
     * Every frame. `me`: where you are (the desert shows when you are in it); `walkers`: everybody's feet to leave prints
     * for (you and the other players here); `cam`: the camera (the grids follow it); `hour`: the time of day (dawn greens).
     */
    update(dt: number, me: { x: number; z: number }, walkers: { id: number | string; x: number; y: number; z: number; run: boolean }[], cam: Vector3, hour: number) {
        // the water runs and the green grows wherever you are
        this.works.update(dt);
        if (this.lastHour >= 0 && this.lastHour < 6 && hour >= 6 && hour - this.lastHour < 3) this.onDawn?.();
        this.lastHour = hour;
        const want = inDesert(me.x, me.z);
        if (want && !this.built) this.build();
        if (want !== this.active) { this.active = want; if (this.built) this.setVisible(want); }
        if (!this.built) return;
        this.upload();
        if (!this.active) return;
        this.time += dt;
        // the grids follow the camera (snapped, so the ground does not swim)
        const cs = 8, fs = FINE_STEP * 2;
        this.coarse.position.set(Math.round(cam.x / cs) * cs, 0, Math.round(cam.z / cs) * cs);
        this.fine.position.set(Math.round(cam.x / fs) * fs, 0, Math.round(cam.z / fs) * fs);
        const ls = 1;
        this.lake.position.set(Math.round(cam.x / ls) * ls, 0, Math.round(cam.z / ls) * ls);
        // (the lawns follow you in whole metres: their blades stay put on the ground; none when far from the oasis)
        this.lawnEye.copyFrom(cam);
        const nearOasis = Math.abs(cam.x - DESERT_X) < EDIT_HALF + 40 && Math.abs(cam.z - DESERT_Z) < EDIT_HALF + 40;
        for (const l of [this.lawnNear, this.lawnFar]) { l.position.set(Math.round(cam.x), 0, Math.round(cam.z)); l.setEnabled(nearOasis); }
        this.lake.setEnabled(Math.abs(cam.x - DESERT_X) < EDIT_HALF + 250 && Math.abs(cam.z - DESERT_Z) < EDIT_HALF + 250);
        // footprints: a print every stride, left and right in turn
        this.brushes.length = 0; this.brushDirs.length = 0;
        for (const w of walkers) {
            let s = this.walkers.get(w.id);
            if (!s) { s = { x: w.x, z: w.z, acc: 0, foot: 1 }; this.walkers.set(w.id, s); }
            const dx = w.x - s.x, dz = w.z - s.z, d = Math.hypot(dx, dz);
            s.x = w.x; s.z = w.z;
            if (d > 3) { s.acc = 0; continue; }                          // a jump in position (teleport): no trail
            if (w.y > groundAt(w.x, w.z) + 0.25 || wetAt(w.x, w.z)) continue;   // in the air, or wading
            s.acc += d;
            const stride = w.run ? 0.95 : 0.7;
            if (s.acc >= stride && d > 1e-4 && this.brushes.length < 32) {
                s.acc = 0; s.foot = -s.foot;
                const sx = -dz / d, sz = dx / d;                          // sideways
                const fx = w.x + sx * 0.15 * s.foot, fz = w.z + sz * 0.15 * s.foot;
                this.brushes.push(fx, fz, w.run ? 0.2 : 0.17, w.run ? 0.1 : 0.075); this.brushDirs.push(dx / d, dz / d, 0, 0);
                if (Math.hypot(fx - me.x, fz - me.z) < 30) {
                    (this.puffs.emitter as Vector3).set(fx, groundAt(fx, fz) + 0.05, fz);
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

    /** copy what changed (digging, water, green) to the GPU: only the changed rectangle */
    private upload() {
        const w = this.works, eng = this.scene.getEngine() as unknown as { updateTextureData(t: unknown, d: ArrayBufferView, x: number, y: number, w: number, h: number): void };
        const sub = (t: RawTexture, r: { i0: number; j0: number; i1: number; j1: number }, fill: (k: number) => number, half: boolean) => {
            const it = t.getInternalTexture(); if (!it) return;
            // (rows a multiple of 4 wide: no row-alignment trouble)
            const i0 = Math.max(0, r.i0 & ~3), i1 = Math.min(EDIT_N - 1, (r.i1 | 3)), j0 = Math.max(0, r.j0), j1 = Math.min(EDIT_N - 1, r.j1);
            const W = i1 - i0 + 1, H = j1 - j0 + 1, data = half ? new Uint16Array(W * H) : new Uint8Array(W * H);
            for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) data[j * W + i] = fill((j0 + j) * EDIT_N + i0 + i);
            eng.updateTextureData(it, data, i0, j0, W, H);
        };
        if (w.digDirty) {
            const r = w.digDirty, c = EDIT_HALF * 2 / EDIT_N;
            sub(this.digTex, r, (k) => ToHalfFloat(this.offsetAt(k)), true); w.digDirty = null;
            this.remask(EDIT_X0 + r.i0 * c - 0.5, EDIT_Z0 + r.j0 * c - 0.5, EDIT_X0 + (r.i1 + 1) * c + 0.5, EDIT_Z0 + (r.j1 + 1) * c + 0.5);
        }
        if (w.wetDirty) {
            const r = w.wetDirty, c = EDIT_HALF * 2 / EDIT_N;
            sub(this.wetTex, r, (k) => wet[k] * 255, false); w.wetDirty = null;
            this.remask(EDIT_X0 + r.i0 * c - 1, EDIT_Z0 + r.j0 * c - 1, EDIT_X0 + (r.i1 + 1) * c + 1, EDIT_Z0 + (r.j1 + 1) * c + 1);
        }
        if (w.greenDirty) { this.greenTex.update(green); w.greenDirty = false; this.remask(EDIT_X0, EDIT_Z0, EDIT_X0 + EDIT_HALF * 2, EDIT_Z0 + EDIT_HALF * 2); }
    }

    /** the water's surface here (the pond and the channels), or null (no water) */
    surface(x: number, z: number): number | null {
        return wetAt(x, z) || Math.hypot(x - DESERT_X, z - DESERT_Z) < OASIS_R - 1 ? OASIS_WATER : null;
    }
}
