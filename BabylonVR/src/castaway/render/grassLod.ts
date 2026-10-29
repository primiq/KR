import { type Material, MaterialPluginBase, type MaterialDefines, ShaderLanguage, type UniformBuffer } from "@babylonjs/core";

/**
 * The grass rings' level of detail, worked out per frame on the GPU from the camera's real distance to each tuft: how big it
 * is (far tufts are drawn bigger, so the sparser far rings still read as a meadow) and whether it shows yet (each ring thins
 * out into the next, and every tuft has its own threshold, so it grows in and shrinks away instead of popping).
 * The rings are only rebuilt every few metres; with this baked in on the CPU (as Castaway does) a tuft kept the size it had
 * at the last rebuild, then jumped as you walked towards it.
 */
export class GrassLodPlugin extends MaterialPluginBase {
    /** r0: where this ring starts (0: at your feet); r1: where it ends; rf: the outer edge of the last ring */
    constructor(material: Material, private readonly r0: number, private readonly r1: number, private readonly rf: number) {
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
        ub.updateFloat4("grassRing", this.r0, this.r1, this.rf, this.r1 >= this.rf ? 1 : 0);
    }
    override getCustomCode(shaderType: string): { [point: string]: string } | null {
        if (shaderType !== "vertex") return null;
        return {
            CUSTOM_VERTEX_UPDATE_WORLDPOS: `
#ifdef GRASSLOD
{
    vec3 gO = finalWorld[3].xyz;
    float gD = distance(gO.xz, vEyePosition.xz);
    float r0 = grassRing.x, r1 = grassRing.y, rf = grassRing.z;
    float fadeIn = r0 > 0.0 ? smoothstep(r0 * 0.65, r0, gD) : 1.0;
    float fadeOut = grassRing.w > 0.5 ? 1.0 - smoothstep(r1 * 0.8, r1, gD) : 1.0 - smoothstep(r1 * 0.65, r1, gD);
    float share = fadeIn * fadeOut;
    // this tuft's own threshold (from where it stands): it is in while the ring's share is above it
    float gH = fract(sin(dot(floor(gO.xz * 8.0), vec2(12.9898, 78.233))) * 43758.5453) * 0.9 + 0.05;
    float k = smoothstep(gH - 0.06, gH + 0.06, share) * (1.0 + 1.6 * smoothstep(8.0, rf, gD));
    worldPos.xyz = gO + (worldPos.xyz - gO) * k;
}
#endif
`,
        };
    }
}
