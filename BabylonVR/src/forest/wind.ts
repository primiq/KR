import { type Material, MaterialPluginBase, type MaterialDefines, type Scene, ShaderLanguage, type UniformBuffer } from "@babylonjs/core";

/**
 * Material plugin that sways vegetation in the wind. Displacement grows with height above the
 * instance origin, and the phase is taken from each (thin) instance's position so neighbouring
 * plants don't move in lockstep. Works for regular meshes and thin instances alike.
 */
export class WindPlugin extends MaterialPluginBase {
    private static time = 0;
    private static registered = new WeakSet<Scene>();

    /** Advances the shared wind clock once per frame for the given scene. */
    static drive(scene: Scene): void {
        if (WindPlugin.registered.has(scene)) return;
        WindPlugin.registered.add(scene);
        scene.onBeforeRenderObservable.add(() => (WindPlugin.time += scene.deltaTime / 1000));
    }

    constructor(
        material: Material,
        private readonly strength: number,
        private readonly heightScale: number,
    ) {
        super(material, "Wind", 200, { WIND: false });
        this._enable(true);
        WindPlugin.drive(material.getScene());
    }

    override prepareDefines(defines: MaterialDefines): void {
        defines["WIND"] = true;
    }

    override getClassName(): string {
        return "WindPlugin";
    }

    override isCompatible(shaderLanguage: ShaderLanguage): boolean {
        return shaderLanguage === ShaderLanguage.GLSL;
    }

    override getUniforms() {
        return {
            ubo: [{ name: "windParams", size: 4, type: "vec4" }],
            vertex: "#ifdef WIND\nuniform vec4 windParams;\n#endif\n",
        };
    }

    override bindForSubMesh(uniformBuffer: UniformBuffer): void {
        uniformBuffer.updateFloat4("windParams", WindPlugin.time, this.strength, this.heightScale, 0);
    }

    override getCustomCode(shaderType: string) {
        if (shaderType !== "vertex") return null;
        return {
            CUSTOM_VERTEX_UPDATE_WORLDPOS: `
#ifdef WIND
{
    vec3 windBase = finalWorld[3].xyz;
    float windH = clamp((worldPos.y - windBase.y) / windParams.z, 0.0, 1.0);
    float windPhase = dot(windBase.xz, vec2(0.37, 0.21)) + windParams.x;
    float sway = sin(windPhase * 1.3) * 0.6 + sin(windPhase * 2.9 + worldPos.x * 0.5) * 0.3
               + sin(windParams.x * 7.0 + worldPos.x * 3.1 + worldPos.z * 2.7) * 0.1;
    worldPos.xz += vec2(sway, sway * 0.6) * windParams.y * windH * windH;
    vPositionW = worldPos.xyz;
}
#endif
`,
        };
    }
}
