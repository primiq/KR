import {
    type Camera,
    Constants,
    DefaultRenderingPipeline,
    DepthOfFieldEffectBlurLevel,
    GlowLayer,
    ImageProcessingConfiguration,
    type Mesh,
    type PhysicsEngineV2,
    PhysicsRaycastResult,
    SSAO2RenderingPipeline,
    SSRRenderingPipeline,
    type Scene,
    Texture,
    Vector3,
    VolumetricLightScatteringPostProcess,
} from "@babylonjs/core";
import { Layer } from "./config";
import type { Environment } from "./environment";

export type SettingKey = "bloom" | "dof" | "ssao" | "ssr" | "godRays" | "glow" | "shadows" | "probe" | "lensFx" | "sharpen";

export interface Setting {
    key: SettingKey;
    label: string;
    value: boolean;
}

type Profile = Record<SettingKey, boolean>;

/** Desktop: everything on. VR: the expensive screen-space passes default off (each eye pays for them). */
const PROFILES: Record<"desktop" | "xr", Profile> = {
    desktop: { bloom: true, dof: true, ssao: true, ssr: true, godRays: true, glow: true, shadows: true, probe: true, lensFx: true, sharpen: true },
    xr: { bloom: true, dof: false, ssao: false, ssr: false, godRays: false, glow: true, shadows: true, probe: true, lensFx: false, sharpen: false },
};

const LABELS: Record<SettingKey, string> = {
    bloom: "Bloom (HDR)",
    dof: "Depth of field (autofocus)",
    ssao: "SSAO2 ambient occlusion",
    ssr: "Screen-space reflections",
    godRays: "Volumetric light shafts",
    glow: "Emissive glow layer",
    shadows: "Cascaded PCF shadows",
    probe: "Live reflection probe",
    lensFx: "Lens FX (CA, grain, vignette)",
    sharpen: "Sharpen",
};

/** Owns every post-process / rendering feature and rebuilds them when the active camera changes. */
export class Graphics {
    readonly settings: Setting[];
    readonly onChanged: Array<() => void> = [];
    private pipeline: DefaultRenderingPipeline | null = null;
    private ssao: SSAO2RenderingPipeline | null = null;
    private ssr: SSRRenderingPipeline | null = null;
    private godRays: VolumetricLightScatteringPostProcess | null = null;
    private readonly glow: GlowLayer;
    private camera: Camera | null = null;
    private builtStructure = "";
    private godRaysCamera: Camera | null = null;
    private focus = 3000;
    private readonly ray = new PhysicsRaycastResult();
    private readonly probeRefresh: number;

    constructor(
        private readonly scene: Scene,
        private readonly env: Environment,
    ) {
        this.settings = (Object.keys(LABELS) as SettingKey[]).map((key) => ({ key, label: LABELS[key], value: PROFILES.desktop[key] }));
        this.probeRefresh = env.probe.refreshRate;

        this.glow = new GlowLayer("glow", scene, { mainTextureSamples: 4, blurKernelSize: 48 });
        this.glow.intensity = 0.65;
        // Only emissive props glow – keeps Sponza out of the glow pass.
        this.glow.customEmissiveColorSelector = (mesh, _sub, material, result) => {
            const m = material as { emissiveColor?: { r: number; g: number; b: number }; emissiveTexture?: unknown };
            if (m.emissiveColor && !m.emissiveTexture && mesh.name !== "sunDisc") result.set(m.emissiveColor.r, m.emissiveColor.g, m.emissiveColor.b, 1);
            else result.set(0, 0, 0, 0);
        };

        const ip = scene.imageProcessingConfiguration;
        ip.toneMappingEnabled = true;
        ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
        ip.exposure = 1.5;
        ip.contrast = 1.18;

        scene.onBeforeRenderObservable.add(() => this.autofocus());
    }

    get(key: SettingKey): boolean {
        return this.settings.find((s) => s.key === key)!.value;
    }

    set(key: SettingKey, value: boolean): void {
        const s = this.settings.find((x) => x.key === key)!;
        if (s.value === value) return;
        s.value = value;
        this.apply();
    }

    toggle(key: SettingKey): void {
        this.set(key, !this.get(key));
    }

    useProfile(profile: "desktop" | "xr"): void {
        for (const s of this.settings) s.value = PROFILES[profile][s.key];
    }

    /** (Re)create camera-bound pipelines for `camera`. */
    attach(camera: Camera): void {
        this.camera = camera;
        this.rebuild();
    }

    apply(): void {
        // Screen-space passes only exist while enabled (they cost a geometry buffer per eye), and
        // must sit before the default pipeline's tone mapping, so toggling them rebuilds the chain.
        const structure = `${this.get("ssao")}|${this.get("ssr")}|${this.get("godRays")}`;
        if (this.camera && structure !== this.builtStructure) {
            this.rebuild();
            return;
        }
        const p = this.pipeline;
        if (p) {
            p.bloomEnabled = this.get("bloom");
            p.depthOfFieldEnabled = this.get("dof");
            p.chromaticAberrationEnabled = this.get("lensFx");
            p.grainEnabled = this.get("lensFx");
            p.imageProcessing.vignetteEnabled = this.get("lensFx");
            p.sharpenEnabled = this.get("sharpen");
        }
        this.glow.isEnabled = this.get("glow");
        this.env.sun.shadowEnabled = this.get("shadows");
        // refreshRate 0 = render once: the probe keeps its last capture when paused.
        this.env.probe.refreshRate = this.get("probe") ? this.probeRefresh : 0;
        for (const cb of this.onChanged) cb();
    }

    private rebuild(): void {
        const camera = this.camera!;
        const scene = this.scene;
        const cams = [camera];
        this.disposePipelines();
        this.builtStructure = `${this.get("ssao")}|${this.get("ssr")}|${this.get("godRays")}`;

        if (this.get("ssao") && SSAO2RenderingPipeline.IsSupported) {
            this.ssao = new SSAO2RenderingPipeline("ssao", scene, { ssaoRatio: 0.5, blurRatio: 1 }, cams, false, Constants.TEXTURETYPE_HALF_FLOAT);
            this.ssao.radius = 1.2;
            this.ssao.totalStrength = 1.3;
            this.ssao.base = 0.12;
            this.ssao.samples = 16;
            this.ssao.maxZ = 60;
            this.ssao.expensiveBlur = true;
        }

        if (this.get("ssr")) {
            this.ssr = new SSRRenderingPipeline("ssr", scene, cams, false, Constants.TEXTURETYPE_HALF_FLOAT);
            this.ssr.thickness = 0.2;
            this.ssr.step = 1;
            this.ssr.maxSteps = 120;
            this.ssr.maxDistance = 30;
            this.ssr.strength = 0.9;
            this.ssr.reflectionSpecularFalloffExponent = 2.2;
            this.ssr.blurDispersionStrength = 0.03;
            this.ssr.roughnessFactor = 0.15;
            this.ssr.ssrDownsample = 1;
            this.ssr.blurDownsample = 1;
            this.ssr.enableSmoothReflections = true;
            this.ssr.attenuateFacingCamera = true;
            this.ssr.attenuateScreenBorders = true;
            this.ssr.environmentTexture = this.env.probe.cubeTexture as never;
            this.ssr.environmentTextureIsProbe = true;
        }

        if (this.get("godRays")) {
            this.godRays = new VolumetricLightScatteringPostProcess("godRays", 0.5, camera, this.env.sunMesh as Mesh, 80, Texture.BILINEAR_SAMPLINGMODE, scene.getEngine(), false, scene);
            this.godRays.exposure = 0.22;
            this.godRays.decay = 0.965;
            this.godRays.weight = 0.6;
            this.godRays.density = 0.92;
            this.godRaysCamera = camera;
        }

        const p = new DefaultRenderingPipeline("default", true, scene, cams);
        p.samples = 4;
        p.fxaaEnabled = true;
        p.imageProcessingEnabled = true;
        p.imageProcessing.toneMappingEnabled = true;
        p.imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
        p.imageProcessing.exposure = 1.5;
        p.imageProcessing.contrast = 1.18;
        p.bloomThreshold = 0.85;
        p.bloomWeight = 0.35;
        p.bloomKernel = 64;
        p.bloomScale = 0.5;
        p.depthOfFieldBlurLevel = DepthOfFieldEffectBlurLevel.Medium;
        p.depthOfField.fStop = 4;
        p.depthOfField.focalLength = 55;
        p.depthOfField.lensSize = 30;
        p.chromaticAberration.aberrationAmount = 8;
        p.chromaticAberration.radialIntensity = 0.6;
        p.grain.intensity = 3;
        p.grain.animated = true;
        p.imageProcessing.vignetteWeight = 1.2;
        p.imageProcessing.vignetteStretch = 0.4;
        p.sharpen.edgeAmount = 0.25;
        this.pipeline = p;

        this.apply();
    }

    private disposePipelines(): void {
        this.pipeline?.dispose();
        this.ssao?.dispose(true);
        this.ssr?.dispose(true);
        if (this.godRays && this.godRaysCamera) this.godRays.dispose(this.godRaysCamera);
        this.pipeline = this.ssao = this.ssr = this.godRays = null;
        this.godRaysCamera = null;
    }

    /** Physics raycast (fast BVH) from the view centre drives the DoF focus distance. */
    private autofocus(): void {
        const p = this.pipeline;
        const cam = this.camera;
        if (!p || !cam || !p.depthOfFieldEnabled) return;
        const from = cam.globalPosition;
        const dir = cam.getDirection(Vector3.Forward());
        (this.scene.getPhysicsEngine() as PhysicsEngineV2 | null)?.raycastToRef(from, from.add(dir.scale(80)), this.ray, { collideWith: Layer.STATIC | Layer.DYNAMIC | Layer.HELD });
        const dist = this.ray.hasHit ? Vector3.Distance(from, this.ray.hitPointWorld) : 40;
        const target = Math.max(0.25, dist) * 1000;
        this.focus += (target - this.focus) * 0.12;
        p.depthOfField.focusDistance = this.focus;
    }
}
