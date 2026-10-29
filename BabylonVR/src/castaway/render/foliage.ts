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
    ) {
        super(material, "Foliage", 200, { FOLIAGE: false, FOLIAGE_PUSH: false });
        this._enable(true);
        driveWind(material.getScene());
    }

    override prepareDefines(defines: MaterialDefines): void {
        defines["FOLIAGE"] = true;
        defines["FOLIAGE_PUSH"] = this.push;
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

    override getCustomCode(shaderType: string) {
        if (shaderType !== "vertex") return null;
        return {
            CUSTOM_VERTEX_DEFINITIONS: `
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
