import { Color3, Constants, PBRMaterial, type Scene, StandardMaterial, Texture } from "@babylonjs/core";
import { PBRCustomMaterial } from "@babylonjs/materials";
import { Assets } from "../../config";
import { resolveAsset } from "../../environment";
import { FoliagePlugin } from "./foliage";

/** GLSL value noise in [-1, 1] (stands in for three's mx_noise_float in Castaway's node materials). */
export const NOISE_GLSL = `
float cHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float cNoise(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    float n = mix(mix(mix(cHash(i), cHash(i + vec3(1,0,0)), f.x), mix(cHash(i + vec3(0,1,0)), cHash(i + vec3(1,1,0)), f.x), f.y),
                  mix(mix(cHash(i + vec3(0,0,1)), cHash(i + vec3(1,0,1)), f.x), mix(cHash(i + vec3(0,1,1)), cHash(i + vec3(1,1,1)), f.x), f.y), f.z);
    return n * 2.0 - 1.0;
}
float cHash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
`;

const cache = new Map<string, unknown>();
function once<T>(key: string, make: () => T): T {
    if (!cache.has(key)) cache.set(key, make());
    return cache.get(key) as T;
}

/** Vertex-coloured, double-sided, wind-blown plant material. */
export function foliageMaterial(scene: Scene, name: string, amp: number, push = false, storm = 1): PBRMaterial {
    return once(`fol:${name}`, () => {
        const m = new PBRMaterial(name, scene);
        m.metallic = 0;
        m.roughness = 0.82;
        m.backFaceCulling = amp <= 0;
        m.twoSidedLighting = true;
        m.albedoColor = new Color3(1, 1, 1);
        if (amp > 0) {
            // (no translucency: Babylon's adds the same light to every surface whatever its colour, so it greened the palm trunks
            //  and washed out the leaves; Castaway's foliage has none either)
            new FoliagePlugin(m, amp, push, storm);
        }
        return m;
    });
}

let rockTex: { color: Texture; normal: Texture } | null = null;
async function rockTextures(scene: Scene) {
    if (rockTex) return rockTex;
    const [c, n] = await Promise.all([resolveAsset(Assets.rockColor.local, Assets.rockColor.remote), resolveAsset(Assets.rockNormal.local, Assets.rockNormal.remote)]);
    const color = new Texture(c, scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
    const normal = new Texture(n, scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
    normal.gammaSpace = false;
    rockTex = { color, normal };
    return rockTex;
}

/**
 * The island's rocks, two quite different stones. Boulders (stone): pale grey granite, flecked dark and white with a few
 * glinting quartz grains, weathered darker in patches, moss on the tops and a dark wet band at the waterline, over a real
 * photographed rock texture (for its detail only) sampled tri-planar in world space.
 * `ore`: a near-black iron-rich rock threaded with veins of polished metal (brassy, silvery, with a tarnished rainbow sheen)
 * that mirror the sky, and tiny crystals in them that glint as you move.
 */
export function rockMaterial(scene: Scene, ore = false): PBRCustomMaterial {
    return once(`rock:${ore}`, () => {
        const m = new PBRCustomMaterial(ore ? "oreRock" : "rock", scene);
        m.metallic = 0;
        m.roughness = ore ? 0.6 : 0.82;
        m.AddUniform("rockTex", "sampler2D", null as never);
        m.AddUniform("rockReady", "float", 0);
        m.Fragment_Definitions(NOISE_GLSL + `
float rockVein(vec3 wp) {
    // seams running through the rock, and nuggets where they swell
    float v = abs(cNoise(wp * 1.7 + 7.0) + cNoise(wp * 5.0) * 0.18);
    float seam = 1.0 - smoothstep(0.05, 0.16, v);
    float nug = smoothstep(0.66, 0.8, cNoise(wp * 2.2 + 13.0) * 0.5 + 0.5);
    return max(seam, nug);
}
`);
        m.Fragment_Custom_Albedo(`
            vec3 wp = vPositionW;
            vec3 nW = normalize(vNormalW);
            float n1 = cNoise(wp * 0.7), n2 = cNoise(wp * 4.0), n3 = cNoise(wp * 14.0), n4 = cNoise(wp * 1.9 + 5.0);
            // the photographed rock, for its grain and pits only (its colour is the stone's own)
            float det = 1.0;
            if (rockReady > 0.5) {
                vec3 bw = pow(abs(nW), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
                vec3 t = toLinearSpace(texture2D(rockTex, wp.zy * 0.35).rgb) * bw.x + toLinearSpace(texture2D(rockTex, wp.xz * 0.35).rgb) * bw.y + toLinearSpace(texture2D(rockTex, wp.xy * 0.35).rgb) * bw.z;
                det = 0.55 + 1.6 * dot(t, vec3(0.3, 0.5, 0.2));
            }
            ${ore ? `
            // dark host rock, blue-black with rusty stains
            vec3 col = mix(vec3(0.055, 0.058, 0.066), vec3(0.11, 0.1, 0.1), n1 * 0.5 + 0.5) * det;
            col = mix(col, vec3(0.26, 0.11, 0.04), smoothstep(0.35, 0.8, n4) * 0.5);
            // the veins: brass to silver, with a thin-film rainbow where the metal has tarnished
            float vein = rockVein(wp);
            float hue = n2 * 0.5 + 0.5;
            vec3 metal = mix(vec3(0.95, 0.74, 0.38), vec3(0.86, 0.87, 0.9), smoothstep(0.3, 0.8, n1 * 0.5 + 0.5));
            vec3 film = 0.5 + 0.5 * cos(6.2832 * (vec3(0.0, 0.33, 0.67) + hue * 1.7 + dot(nW, vec3(0.3, 0.6, 0.2))));
            metal = mix(metal, metal * film * 1.3, smoothstep(0.55, 0.9, cNoise(wp * 6.0 + 3.0) * 0.5 + 0.5) * 0.6);
            col = mix(col, metal, vein);` : `
            // granite: pale grey, flecked
            vec3 col = mix(vec3(0.34, 0.335, 0.325), vec3(0.22, 0.215, 0.21), n1 * 0.5 + 0.5) * det;
            float fleck = cNoise(wp * 38.0), fleck2 = cNoise(wp * 31.0 + 11.0);
            col = mix(col, vec3(0.06, 0.06, 0.065), smoothstep(0.45, 0.65, fleck) * 0.85);
            col = mix(col, vec3(0.7, 0.68, 0.66), smoothstep(0.5, 0.7, fleck2) * 0.5);
            col = mix(col, vec3(0.62, 0.48, 0.44), smoothstep(0.55, 0.75, cNoise(wp * 23.0 + 4.0)) * 0.35);
            // weathering: darker, browner patches and streaks running down from the top
            col *= 0.8 + 0.25 * smoothstep(-0.5, 0.6, n4);
            col = mix(col, col * vec3(0.78, 0.72, 0.62), smoothstep(0.2, 0.8, cNoise(vec3(wp.x * 3.0, wp.y * 0.4, wp.z * 3.0))) * 0.45);
            float crack = smoothstep(0.9, 0.975, 1.0 - abs(n4));
            col = mix(col, vec3(0.03, 0.03, 0.03), crack * 0.7);
            float lichen = smoothstep(0.55, 0.8, n3 + n2 * 0.5) * smoothstep(0.2, 0.8, nW.y);
            col = mix(col, vec3(0.62, 0.64, 0.42) * (0.8 + n2 * 0.3), lichen * 0.4);`}
            float moss = smoothstep(0.7, 0.96, nW.y) * smoothstep(-0.2, 0.5, n1 + wp.y * 0.05);
            col = mix(col, vec3(0.11, 0.2, 0.024) * (0.8 + n2 * 0.3), moss * ${ore ? "0.4" : "0.75"});
            // dark and wet where the sea reaches
            col *= 0.55 + smoothstep(0.0, 1.0, wp.y) * 0.45;
            surfaceAlbedo = col;
        `);
        m.Fragment_Custom_MetallicRoughness(ore ? `
            float veinM = rockVein(vPositionW);
            metallicRoughness.r = veinM * 0.85;
            metallicRoughness.g = mix(0.78, 0.2 + 0.12 * (cNoise(vPositionW * 9.0) * 0.5 + 0.5), veinM);
        ` : `
            // quartz grains glint, the wet foot of the rock shines; the rest is matt
            float q = smoothstep(0.55, 0.72, cNoise(vPositionW * 31.0 + 11.0));
            float wetR = 1.0 - smoothstep(0.0, 1.0, vPositionW.y);
            metallicRoughness.g = mix(mix(0.82, 0.32, q), 0.3, wetR);
        `);
        if (ore) {
            // tiny crystals in the veins: a pin-prick of light that comes and goes as you move
            m.Fragment_Before_FragColor(`
                {
                    vec3 cp = floor(vPositionW * 22.0);
                    float h = fract(sin(dot(cp, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
                    vec3 vd = normalize(vEyePosition.xyz - vPositionW);
                    float tw = pow(max(0.0, sin(dot(vd, vec3(17.0, 23.0, 19.0)) + h * 40.0)), 24.0);
                    finalColor.rgb += vec3(1.0, 0.92, 0.75) * tw * step(0.93, h) * rockVein(vPositionW) * 1.4;
                }
            `);
        }
        m.onBindObservable.add(() => {
            const e = m.getEffect();
            if (!e) return;
            e.setFloat("rockReady", rockTex?.color.isReady() ? 1 : 0);
            if (rockTex) e.setTexture("rockTex", rockTex.color);
        });
        void rockTextures(scene).then((t) => {
            m.bumpTexture = t.normal;
            t.normal.uScale = t.normal.vScale = 1;
            m.bumpTexture.level = ore ? 0.45 : 0.75;
        });
        return m;
    });
}

/**
 * Timber: boards with dark gaps and grain, worked out on whichever plane each face lies in (walls stand boards up,
 * slabs lay them along the floor) so pieces line up whichever way they are turned.
 */
function plankMaterial(scene: Scene, name: string, base: Color3, alt: Color3, wall: boolean): PBRCustomMaterial {
    const m = new PBRCustomMaterial(name, scene);
    m.metallic = 0;
    m.roughness = 0.9;
    m.Fragment_Definitions(NOISE_GLSL);
    m.Fragment_Custom_Albedo(`
        vec3 wp = vPositionW; vec3 nW = normalize(vNormalW);
        float ax = abs(nW.x), ay = abs(nW.y);
        // board direction: across a wall face, along x on floors
        float u = ay > 0.6 ? wp.x * ${wall ? "3.3" : "2.2"} : (ax > 0.6 ? wp.z : wp.x) * ${wall ? "3.3" : "2.2"};
        float along = ay > 0.6 ? wp.z : wp.y;
        float id = floor(u);
        float rnd = fract(sin(id * 12.9898) * 43758.5453);
        float f = fract(u);
        float gap = smoothstep(0.0, 0.05, f) * smoothstep(1.0, 0.95, f);
        float grain = cNoise(vec3(u * 8.0, along * 2.5, id));
        float knot = smoothstep(0.82, 0.95, cNoise(vec3(u * 2.0, along * 1.4, id * 3.0)));
        vec3 col = mix(vec3(${base.r}, ${base.g}, ${base.b}), vec3(${alt.r}, ${alt.g}, ${alt.b}), rnd) * (0.9 + grain * 0.12) * (0.5 + gap * 0.5) * (1.0 - knot * 0.35);
        surfaceAlbedo = col;
    `);
    return m;
}

export interface WoodMats { wall: PBRCustomMaterial; slab: PBRCustomMaterial; beam: PBRMaterial; pile: PBRMaterial }
export function woodMaterials(scene: Scene): WoodMats {
    return once("wood", () => {
        const lin = (h: string) => Color3.FromHexString(h).toLinearSpace();
        const beam = new PBRMaterial("beam", scene);
        beam.albedoColor = lin("#7d5530");
        beam.roughness = 0.9;
        beam.metallic = 0;
        const pile = new PBRMaterial("pile", scene);
        pile.albedoColor = lin("#5c4128");
        pile.roughness = 1;
        pile.metallic = 0;
        return {
            wall: plankMaterial(scene, "planksWall", lin("#d2a06a"), lin("#bd8b56"), true),
            slab: plankMaterial(scene, "planksSlab", lin("#c08c58"), lin("#a87a48"), false),
            beam,
            pile,
        };
    });
}

/** Dressed stone laid in courses with recessed lime mortar, worked out in world space so courses run on between pieces. */
function masonryMaterial(scene: Scene, paving: boolean): PBRCustomMaterial {
    const m = new PBRCustomMaterial(paving ? "paving" : "masonry", scene);
    m.metallic = 0;
    m.roughness = 0.93;
    m.Fragment_Definitions(NOISE_GLSL);
    m.Fragment_Custom_Albedo(`
        vec3 wp = vPositionW; vec3 nW = normalize(vNormalW);
        float ax = abs(nW.x), ay = abs(nW.y);
        vec2 uv0 = ay > 0.6 ? wp.xz : (ax > 0.6 ? wp.zy : wp.xy);
        float rowH = ${paving ? "0.62" : "0.34"};
        float row = floor(uv0.y / rowH);
        float len = ${paving ? "0.75" : "0.42"} + cHash2(vec2(row, 3.1)) * ${paving ? "0.35" : "0.3"};
        float u = uv0.x / len + cHash2(vec2(row, 7.7));
        float colI = floor(u);
        float fx = fract(u), fy = fract(uv0.y / rowH);
        float wob = cNoise(vec3(uv0 * 9.0, 2.0)) * 0.012;
        float edge = min(min(fx, 1.0 - fx) * len, min(fy, 1.0 - fy) * rowH) + wob;
        float joint = 1.0 - smoothstep(0.008, 0.022, edge);
        float dome = smoothstep(0.0, 0.09, edge);
        float id = cHash2(vec2(colI, row));
        float grit = cNoise(vec3(uv0 * 22.0, id * 9.0));
        float mott = cNoise(vec3(uv0 * 3.2, id * 4.0));
        float pick = id * 3.0;
        vec3 stone = mix(vec3(0.36, 0.32, 0.25), vec3(0.23, 0.2, 0.16), smoothstep(0.0, 1.0, pick));
        stone = mix(stone, vec3(0.45, 0.41, 0.31), smoothstep(2.0, 3.0, pick));
        stone = mix(stone, vec3(0.31, 0.25, 0.17), cHash2(vec2(row, colI + 17.0)) * 0.35);
        stone *= (0.88 + mott * 0.12) * (0.93 + grit * 0.09);
        float lichen = smoothstep(0.55, 0.85, mott + grit * 0.3) * smoothstep(0.2, 0.9, nW.y + 0.4);
        stone = mix(stone, vec3(0.2, 0.23, 0.08), lichen * 0.25);
        stone *= 0.78 + dome * 0.22;
        vec3 mortar = vec3(0.48, 0.44, 0.33) * (0.62 + grit * 0.1);
        surfaceAlbedo = mix(stone, mortar, joint);
    `);
    return m;
}
export function stoneMaterials(scene: Scene) {
    return once("stone", () => ({ wall: masonryMaterial(scene, false), slab: masonryMaterial(scene, true) }));
}

/** Window glass: clear straight on, catching the sky at a slant. */
export function glassMaterial(scene: Scene): PBRMaterial {
    return once("glass", () => {
        const m = new PBRMaterial("glass", scene);
        m.albedoColor = new Color3(0.85, 0.95, 0.96);
        m.metallic = 0;
        m.roughness = 0.04;
        m.alpha = 0.18;
        m.backFaceCulling = false;
        m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
        m.indexOfRefraction = 1.5;
        return m;
    });
}

/** The green / red see-through preview of something about to be placed. */
export function ghostMaterial(scene: Scene, name: string): StandardMaterial {
    const m = new StandardMaterial(name, scene);
    m.disableLighting = true;
    m.emissiveColor = new Color3(0.3, 1, 0.54);
    m.alpha = 0.42;
    m.backFaceCulling = false;
    m.zOffset = -2;
    m.disableDepthWrite = true;
    m.alphaMode = Constants.ALPHA_COMBINE;
    return m;
}
export function setGhostOk(m: StandardMaterial, ok: boolean) {
    m.emissiveColor.set(ok ? 0.3 : 1, ok ? 1 : 0.35, ok ? 0.54 : 0.3);
}

/** Plain PBR colour (sRGB hex). */
export function solid(scene: Scene, hex: string, roughness = 0.9, metallic = 0): PBRMaterial {
    return once(`solid:${hex}:${roughness}:${metallic}`, () => {
        const m = new PBRMaterial(`c${hex}`, scene);
        m.albedoColor = Color3.FromHexString(hex).toLinearSpace();
        m.roughness = roughness;
        m.metallic = metallic;
        return m;
    });
}

/** Unlit glowing colour (flames, embers, lamps). */
export function glow(scene: Scene, hex: string, alpha = 1): StandardMaterial {
    return once(`glow:${hex}:${alpha}`, () => {
        const m = new StandardMaterial(`g${hex}`, scene);
        m.disableLighting = true;
        m.emissiveColor = Color3.FromHexString(hex);
        m.alpha = alpha;
        if (alpha < 1) {
            m.alphaMode = Constants.ALPHA_ADD;
            m.disableDepthWrite = true;
        }
        m.backFaceCulling = false;
        return m;
    });
}

/** Castaway's fish: vertex-coloured, with a side-to-side tail beat (the tail weight rides in the colour alpha, see sealife). */
export function fishMaterial(scene: Scene, amp: number): PBRCustomMaterial {
    return once(`fish:${amp.toFixed(3)}`, () => {
        const m = new PBRCustomMaterial(`fish${amp.toFixed(2)}`, scene);
        m.metallic = 0.15;
        m.roughness = 0.4;
        m.AddUniform("fishTime", "float", 0);
        m.Vertex_Before_PositionUpdated(`
            #ifdef VERTEXCOLOR
            float wig = fract(color.a) / 0.66;
            positionUpdated.x += sin(fishTime * 11.0 + positionUpdated.x * 3.1 + positionUpdated.z * 2.3) * wig * ${amp.toFixed(4)};
            #endif
        `);
        m.onBindObservable.add(() => m.getEffect()?.setFloat("fishTime", performance.now() / 1000));
        return m;
    });
}
