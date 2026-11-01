import { type Material, MaterialPluginBase, type MaterialDefines, type Scene, ShaderLanguage, type UniformBuffer, Vector4 } from "@babylonjs/core";

/** Shared clock and inputs for every foliage material. */
export const Wind = {
    time: 0,
    /** weather wind: 1 = a breeze; 2-4 = storm (bends further, thrashes) */
    strength: 1,
    /** up to four things pushing through the plants: (x, feet y, z, radius); radius 0 = unused */
    push: [0, 1, 2, 3].map(() => new Vector4(0, -1e4, 0, 0.01)),
    /** the last tree hit: (x, z, time, strength) */
    shake: new Vector4(0, 0, -100, 0),
};
let driven: Scene | null = null;
export function driveWind(scene: Scene) {
    if (driven === scene) return;
    driven = scene;
    scene.onBeforeRenderObservable.add(() => (Wind.time += scene.getEngine().getDeltaTime() / 1000));
}
/** A tree being chopped: its leaves shiver for a moment. */
export function shakeFoliage(x: number, z: number, strength = 1) {
    Wind.shake.set(x, z, Wind.time, strength);
}

/**
 * Castaway's foliage wind as a Babylon material plugin: per-vertex `sway` (how far that part bends) and `flutter`
 * (both packed into the vertex colour's alpha by meshFromThree)
 * (leaf flicker) weights from the plant generators, gusts travelling across the island, leaves shivering on a tree
 * that was just hit, and grass / bushes bending away from people walking through them. Runs in world space after
 * (thin-)instancing, so every copy moves differently.
 */
export class FoliagePlugin extends MaterialPluginBase {
    constructor(
        material: Material,
        private readonly amp: number,
        private readonly push = false,
        private readonly storm = 1,
        private readonly bark = false,
        private readonly jungle = false,
    ) {
        super(material, "Foliage", 200, { FOLIAGE: false, FOLIAGE_PUSH: false, FOLIAGE_BARK: false, FOLIAGE_JUNGLE: false });
        this._enable(true);
        driveWind(material.getScene());
    }

    override prepareDefines(defines: MaterialDefines): void {
        defines["FOLIAGE"] = true;
        defines["FOLIAGE_PUSH"] = this.push;
        defines["FOLIAGE_BARK"] = this.bark;
        defines["FOLIAGE_JUNGLE"] = this.jungle;
    }

    override getClassName(): string {
        return "FoliagePlugin";
    }

    override isCompatible(shaderLanguage: ShaderLanguage): boolean {
        return shaderLanguage === ShaderLanguage.GLSL;
    }

    override getUniforms() {
        return {
            ubo: [
                { name: "folA", size: 4, type: "vec4" },
                { name: "folShake", size: 4, type: "vec4" },
                { name: "folPush0", size: 4, type: "vec4" },
                { name: "folPush1", size: 4, type: "vec4" },
                { name: "folPush2", size: 4, type: "vec4" },
                { name: "folPush3", size: 4, type: "vec4" },
            ],
            vertex: "#ifdef FOLIAGE\nuniform vec4 folA;\nuniform vec4 folShake;\nuniform vec4 folPush0;\nuniform vec4 folPush1;\nuniform vec4 folPush2;\nuniform vec4 folPush3;\n#endif\n",
        };
    }

    override bindForSubMesh(ub: UniformBuffer): void {
        ub.updateFloat4("folA", Wind.time, this.amp, (Wind.strength - 1) * this.storm, 0);
        const s = Wind.shake;
        ub.updateFloat4("folShake", s.x, s.y, s.z, s.w);
        const p = Wind.push;
        ub.updateFloat4("folPush0", p[0].x, p[0].y, p[0].z, p[0].w);
        ub.updateFloat4("folPush1", p[1].x, p[1].y, p[1].z, p[1].w);
        ub.updateFloat4("folPush2", p[2].x, p[2].y, p[2].z, p[2].w);
        ub.updateFloat4("folPush3", p[3].x, p[3].y, p[3].z, p[3].w);
    }

    override getCustomCode(shaderType: string): { [pointName: string]: string } | null {
        if (shaderType === "fragment") {
            // (always the same code, switched by defines: the injection points are read once, before this plugin's fields are set)
            // bark on the trunks (the brown parts: vertex colours redder than green), in the tree's own coordinates so it
            // stays put on a felled trunk: a palm's ring scars round it, fissures running up a jungle tree's, darker and
            // weathered at the foot where it meets the ground
            return {
                CUSTOM_FRAGMENT_DEFINITIONS: `
#ifdef FOLIAGE_BARK
#ifdef FOLIAGE_JUNGLE
#define FOL_JK 1.0
#else
#define FOL_JK 0.0
#endif
varying vec3 vFolLoc;
float folH(vec2 p) { p = fract(p * vec2(0.1031, 0.103)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
float folN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(folH(i), folH(i + vec2(1.0, 0.0)), f.x), mix(folH(i + vec2(0.0, 1.0)), folH(i + vec2(1.0, 1.0)), f.x), f.y); }
#endif
`,
                CUSTOM_FRAGMENT_UPDATE_ALBEDO: `
#if defined(FOLIAGE_BARK) && defined(VERTEXCOLOR)
{
    float barkK = smoothstep(0.0, 0.05, vColor.r - vColor.g);
    if (barkK > 0.0) {
        vec3 lp = vFolLoc;
        float ang = atan(lp.z, lp.x) * 1.59;
        // palm scars: rings every ~16 cm, wavy, a little uneven; jungle fissures: dark grooves running up
        float rings = fract(lp.y * 6.2 + folN(vec2(ang * 2.0, lp.y * 3.0)) * 0.6);
        float scar = smoothstep(0.0, 0.18, rings) * smoothstep(1.0, 0.7, rings);
        float fis = folN(vec2(ang * 9.0, lp.y * 1.4));
        float groove = smoothstep(0.35, 0.15, abs(fis - 0.5));
        float fine = folN(vec2(ang * 30.0, lp.y * 22.0));
        float bk = mix(0.62 + 0.38 * scar, 1.0 - 0.45 * groove, FOL_JK) * (0.86 + 0.24 * fine);
        // the foot of the trunk: darker, damp, a little greener (moss) where it meets the ground
        float foot = 1.0 - smoothstep(0.0, 0.75, lp.y);
        vec3 bc = surfaceAlbedo * bk;
        bc = mix(bc, bc * vec3(0.55, 0.6, 0.45), foot * 0.85);
        surfaceAlbedo = mix(surfaceAlbedo, bc, barkK);
    }
}
#endif
`,
            };
        }
        if (shaderType !== "vertex") return null;
        return {
            CUSTOM_VERTEX_MAIN_END: `
#ifdef FOLIAGE_BARK
    vFolLoc = position;
#endif
`,
            CUSTOM_VERTEX_DEFINITIONS: `
#ifdef FOLIAGE_BARK
varying vec3 vFolLoc;
#endif
#ifdef FOLIAGE
vec3 folPushOne(vec3 p, vec4 u, float give) {
    // (an unused slot has a tiny radius: smoothstep with its edges the wrong way round is undefined in GLSL)
    if (u.w <= 0.2) return vec3(0.0);
    vec2 v = p.xz - u.xz;
    float d = max(length(v), 0.05);
    float nearF = 1.0 - smoothstep(0.12, u.w, d);
    float legs = 1.0 - smoothstep(0.3, 1.7, p.y - u.y);
    float w = nearF * legs * give * smoothstep(-0.4, 0.1, p.y - u.y);
    return vec3(v.x / d * w * 0.32, -w * 0.12, v.y / d * w * 0.32);
}
#endif
`,
            CUSTOM_VERTEX_UPDATE_WORLDPOS: `
#ifdef FOLIAGE
{
    float t = folA.x, amp = folA.y, wk = folA.z;
#ifdef VERTEXCOLOR
    float sway = floor(color.a) / 100.0, flutter = fract(color.a);
#else
    float sway = 0.0, flutter = 0.0;
#endif
    vec3 p = worldPos.xyz;
    float gust = (sin(t * 0.8 + p.x * 0.04 + p.z * 0.03) * 0.5 + 0.5) * 0.7 + 0.3;
    float osc = sin(t * 1.7 + p.x * 0.3 + p.z * 0.2);
    float bend = gust * sway * amp * (wk + 1.0);
    float thrash = sin(t * 2.9 + p.x * 0.5 + p.z * 0.37) * (sin(t * 0.53 + p.z * 0.05) * 0.4 + 0.6) * sway * wk * 0.16 * amp;
    float fl = sin(t * 4.2 + p.x * 1.3 + p.z * 1.1) * flutter * (wk * 0.6 + 1.0) * 0.18 * amp;
    vec3 o = p + vec3(bend + osc * sway * 0.04 * amp + fl + thrash, fl * 0.5 - bend * wk * 0.04, bend * 0.35 + fl + thrash * 0.5);
    float age = t - folShake.z;
    float env = exp(-age * 3.2) * step(0.0, age) * folShake.w;
    float sh = env * (1.0 - smoothstep(2.0, 6.0, length(p.xz - folShake.xy))) * sway;
    o += vec3(sin(t * 31.0 + p.y * 2.0) * sh * 0.14, 0.0, sin(t * 27.0 + p.x) * sh * 0.12);
#ifdef FOLIAGE_PUSH
    float give = min(sway * 2.0, 1.0);
    o += folPushOne(p, folPush0, give) + folPushOne(p, folPush1, give) + folPushOne(p, folPush2, give) + folPushOne(p, folPush3, give);
#endif
    worldPos.xyz = o;
    vPositionW = o;
}
#endif
`,
        };
    }
}
