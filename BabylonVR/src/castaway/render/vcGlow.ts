import { type Material, MaterialPluginBase, type MaterialDefines, ShaderLanguage, type UniformBuffer } from "@babylonjs/core";

/**
 * A little self-light from the vertex colours (three.js's `emissiveNode = vertexColor().mul(k)`): shaded sides of a
 * vertex-coloured mesh never go fully black. Set on a three material as `userData.vcGlow = k`; render/mirror.ts adds this.
 */
export class VColorGlowPlugin extends MaterialPluginBase {
    constructor(material: Material, readonly k: number) {
        super(material, "VColorGlow", 210, { VCGLOW: false });
        this._enable(true);
    }
    override prepareDefines(defines: MaterialDefines): void { defines["VCGLOW"] = true; }
    override getClassName(): string { return "VColorGlowPlugin"; }
    override isCompatible(shaderLanguage: ShaderLanguage): boolean { return shaderLanguage === ShaderLanguage.GLSL; }
    override getUniforms() {
        return { ubo: [{ name: "vcGlowK", size: 1, type: "float" }], fragment: "#ifdef VCGLOW\nuniform float vcGlowK;\n#endif\n" };
    }
    override bindForSubMesh(ub: UniformBuffer): void { ub.updateFloat("vcGlowK", this.k); }
    override getCustomCode(shaderType: string) {
        if (shaderType !== "fragment") return null;
        return {
            CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: `
#if defined(VCGLOW) && defined(VERTEXCOLOR)
finalEmissive += toLinearSpace(vColor.rgb) * vcGlowK;
#endif
`,
        };
    }
}
