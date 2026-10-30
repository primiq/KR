import { type Material, MaterialPluginBase, type MaterialDefines, ShaderLanguage, type UniformBuffer } from "@babylonjs/core";

/**
 * The grass rings' level of detail, worked out per frame on the GPU from the camera's real distance to each tuft.
 * The rings are nested: every tuft of a farther ring is also a tuft of the ring inside it (the same spot, size and turn),
 * so where one ring hands over to the next nothing new appears: the shared tufts ("keepers") just carry on, drawn by the
 * outer ring from the exact distance the inner one stops drawing them. The inner ring's other tufts thin out ahead of
 * that line, each shrinking away slowly at its own distance, and the keepers are drawn bigger with distance so the
 * sparser far rings still read as a meadow.
 * The rings are only rebuilt every few metres; all of this is per frame, so nothing jumps when they are.
 */
export const GrassMode = { Thin: 0, Keep: 1, Last: 2 } as const;

export class GrassLodPlugin extends MaterialPluginBase {
    /** r0: where this ring starts (0: at your feet); r1: where it ends; rf: the outer edge of the last ring */
    constructor(material: Material, private readonly r0: number, private readonly r1: number, private readonly rf: number, private readonly mode: number) {
        super(material, "GrassLod", 150, { GRASSLOD: false });
        this._enable(true);
    }
    override prepareDefines(defines: MaterialDefines): void { defines["GRASSLOD"] = true; }
    override getClassName(): string { return "GrassLodPlugin"; }
    override isCompatible(shaderLanguage: ShaderLanguage): boolean { return shaderLanguage === ShaderLanguage.GLSL; }
    override getUniforms() {
        return { ubo: [{ name: "grassRing", size: 4, type: "vec4" }], vertex: "#ifdef GRASSLOD\nuniform vec4 grassRing;\n#endif\n" };
    }
    override bindForSubMesh(ub: UniformBuffer): void {
        ub.updateFloat4("grassRing", this.r0, this.r1, this.rf, this.mode);
    }
    override getCustomCode(shaderType: string): { [point: string]: string } | null {
        if (shaderType !== "vertex") return null;
        return {
            CUSTOM_VERTEX_UPDATE_WORLDPOS: `
#ifdef GRASSLOD
{
    vec3 gO = finalWorld[3].xyz;
    float gD = distance(gO.xz, vEyePosition.xz);
    float r0 = grassRing.x, r1 = grassRing.y, rf = grassRing.z, mode = grassRing.w;
    // this ring takes over exactly where the ring inside it lets go (the same sum on the same tuft, so never a gap or a double)
    float k = gD >= r0 ? 1.0 : 0.0;
    if (mode < 0.5 || mode > 1.5) {
        // thinning out: each tuft has its own point in the band where it shrinks away, over a good stretch of the band
        float share = 1.0 - smoothstep(mode > 1.5 ? r1 * 0.75 : r1 * 0.6, r1, gD);
        float gH = fract(sin(dot(floor(gO.xz * 8.0), vec2(12.9898, 78.233))) * 43758.5453) * 0.6 + 0.2;
        k *= smoothstep(gH - 0.2, gH + 0.2, share);
    } else {
        k *= gD < r1 ? 1.0 : 0.0;
    }
    k *= 1.0 + 1.6 * smoothstep(8.0, rf, gD);
    worldPos.xyz = gO + (worldPos.xyz - gO) * k;
}
#endif
`,
        };
    }
}
