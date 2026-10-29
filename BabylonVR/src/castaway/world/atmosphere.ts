import { type BaseTexture, Color3, HemisphericLight, Scene, CubeMapToSphericalPolynomialTools, DirectionalLight, HDRFiltering, Mesh, MeshBuilder, StandardMaterial, VertexData, type RenderTargetTexture, type ShaderMaterial, Vector3 } from "@babylonjs/core";
import type { SkyMaterial } from "@babylonjs/materials";
import { lerp, smoothstep } from "../core/noise";
import { SPAWN_THETA } from "./island";
import { SkyDeco } from "./skyDeco";

/**
 * Castaway's day: a 25-minute cycle (nights pass faster), the sun's path turned so it rises over the sea ahead of
 * the spawn beach, a cool moon opposite. The physically based sky follows the sun; the image-based lighting it
 * produces is re-captured whenever the sun has moved noticeably, so everything lit by the sky darkens at dusk.
 */
export class Atmosphere {
    hour = 7;
    dayLength = 1500;
    /** towards the sun */
    readonly sunDir = new Vector3();
    /** the direction sunlight travels (what the lights and the ocean shader want) */
    readonly lightDir = new Vector3();
    day = 1;
    /** in the caves: no sun, moon or sky light, a dim cool fill and dark fog (set by world/caveView) */
    get underground() { return this.ug; }
    set underground(on: boolean) { if (on === this.ug) return; this.ug = on; this.apply(!on); }
    private ug = false;
    private caveFill: HemisphericLight;
    /** weather (world/weather): 0..1 how grey the sky is, a lightning flash, how wet the ground is */
    overcast = 0;
    flash = 0;
    /** 0..1: the sky bleeds dark pink while Mario is being summoned (world/druids) */
    curse = 0;
    /** 0..1: the alien invasion's burning sunrise, whatever the hour (world/invaders) */
    dawn = 0;
    wet = 0;
    private lastOvercast = 0;
    private clouds: Mesh;
    private cloudMat: StandardMaterial;
    private flashLight: HemisphericLight;
    readonly moon: DirectionalLight;
    private lastCapture = -1e9;
    private stars: Mesh;
    private moonDisc: Mesh;
    private capturing = false;
    /** the clouds, the night sky with its stars and the Milky Way, and the moon */
    readonly deco: SkyDeco;
    private low = 0;

    constructor(
        private readonly scene: Scene,
        private readonly sun: DirectionalLight,
        private readonly sky: Mesh,
        private readonly env: RenderTargetTexture,
        private readonly ocean: { mesh: Mesh; daylight: number } | null,
        private readonly sunDisc: Mesh | null,
        lite = false,
    ) {
        this.moon = new DirectionalLight("moon", new Vector3(0, -1, 0), scene);
        this.moon.diffuse = new Color3(0.62, 0.74, 1.0);
        this.moon.specular = new Color3(0.3, 0.35, 0.5);
        this.moon.intensity = 0;
        // stars: a few thousand points on the sky sphere (they come out as the light goes)
        this.stars = new Mesh("stars", scene);
        const n = 2600, pos: number[] = [], col: number[] = [];
        let seed = 7;
        const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
        for (let i = 0; i < n; i++) {
            const u = rnd() * 2 - 1, t = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u);
            pos.push(Math.cos(t) * r * 900, Math.abs(u) * 900 - 40, Math.sin(t) * r * 900);
            const b = 0.35 + rnd() ** 3 * 1.4;
            col.push(b, b, b * (0.9 + rnd() * 0.2), 1);
        }
        const vd = new VertexData();
        vd.positions = pos;
        vd.colors = col;
        vd.indices = Array.from({ length: n }, (_, i) => i);
        vd.applyToMesh(this.stars);
        const sm = new StandardMaterial("starsMat", scene);
        sm.disableLighting = true;
        sm.emissiveColor = Color3.White();
        sm.pointsCloud = true;
        sm.pointSize = 2;
        sm.fogEnabled = false;
        this.stars.material = sm;
        this.stars.infiniteDistance = true;
        this.stars.isPickable = false;
        this.stars.applyFog = false;
        // the moon
        this.moonDisc = MeshBuilder.CreateDisc("moonDisc", { radius: 5, tessellation: 32 }, scene);
        const mm = new StandardMaterial("moonMat", scene);
        mm.disableLighting = true;
        mm.emissiveColor = new Color3(0.85, 0.9, 1.0);
        mm.fogEnabled = false;
        this.moonDisc.material = mm;
        this.moonDisc.infiniteDistance = true;
        this.moonDisc.billboardMode = Mesh.BILLBOARDMODE_ALL;
        this.moonDisc.isPickable = false;
        this.caveFill = new HemisphericLight("caveFill", new Vector3(0, 1, 0), scene);
        this.caveFill.diffuse = new Color3(0.45, 0.55, 0.9);
        this.caveFill.groundColor = new Color3(0.25, 0.22, 0.2);
        this.caveFill.specular = Color3.Black();
        this.caveFill.intensity = 0.3;
        this.caveFill.intensity = 0;
        // the overcast: a grey dome inside the sky that thickens as the weather closes in
        this.clouds = MeshBuilder.CreateSphere("clouds", { diameter: 900, segments: 16, sideOrientation: Mesh.BACKSIDE }, scene);
        this.cloudMat = new StandardMaterial("cloudsMat", scene);
        this.cloudMat.disableLighting = true;
        this.cloudMat.fogEnabled = false;
        this.cloudMat.disableDepthWrite = true;
        this.cloudMat.backFaceCulling = false;
        this.clouds.material = this.cloudMat;
        this.clouds.infiniteDistance = true;
        this.clouds.isPickable = false;
        this.clouds.applyFog = false;
        this.clouds.setEnabled(false);
        this.flashLight = new HemisphericLight("flash", new Vector3(0, 1, 0), scene);
        this.flashLight.diffuse = new Color3(0.8, 0.86, 1);
        this.flashLight.groundColor = new Color3(0.3, 0.32, 0.4);
        this.flashLight.specular = Color3.Black();
        this.flashLight.intensity = 0;
        // (the old point stars and flat moon disc stay built but hidden: SkyDeco draws the night sky now)
        this.stars.setEnabled(false);
        this.moonDisc.setEnabled(false);
        this.deco = new SkyDeco(scene, lite);
        this.apply(true);
        this.deco.update(0, this.hour, this.sunDir, this.day, this.low, this.overcast);
    }

    addHours(h: number) { this.hour = (this.hour + h + 24) % 24; this.apply(true); }

    update(dt: number) {
        const night = this.hour >= 19.5 || this.hour < 5.5;
        this.hour = (this.hour + (dt * 24 * (night ? 1.7 : 0.93)) / this.dayLength) % 24;
        this.apply(false);
        if (!this.ug) this.deco.update(dt, this.hour, this.sunDir, this.day, this.low, this.overcast);
    }

    private apply(force: boolean) {
        const a = (this.hour / 24) * Math.PI * 2 - Math.PI / 2;
        const sx = Math.cos(a), sz = -0.3 * Math.sin(a), tc = Math.cos(SPAWN_THETA), ts = Math.sin(SPAWN_THETA);
        this.sunDir.set(sx * tc - sz * ts, Math.sin(a), sx * ts + sz * tc).normalize();
        const sy = this.sunDir.y;
        const day = smoothstep(-0.1, 0.2, sy), low = 1 - smoothstep(0.02, 0.5, sy);
        this.day = day;
        this.low = low;
        // the light comes from the sun by day and from the moon by night (keeps shadows pointing the right way)
        this.lightDir.copyFrom(this.sunDir).scaleInPlace(-1);
        this.sun.direction.copyFrom(sy > -0.02 ? this.lightDir : this.lightDir.scale(-1));
        const warm = new Color3(1.0, 0.42, 0.14), white = new Color3(1.0, 0.9, 0.76);
        this.sun.diffuse = Color3.Lerp(white, warm, low * 0.9);
        this.sun.intensity = 6.5 * day;
        const my = -sy, up = smoothstep(-0.06, 0.22, my);
        this.moon.direction.copyFrom(this.sunDir);
        this.moon.intensity = 0.55 * (1 - day) * (0.25 + 0.75 * up);
        // (the moon and the lightning stay switched on, at intensity 0 when idle: toggling a light recompiles every lit shader)
        this.scene.environmentIntensity = lerp(0.12, 1, day);
        const night = 1 - smoothstep(-0.2, 0.05, sy);
        void night;
        const sm = this.sky.material as SkyMaterial;
        sm.sunPosition = this.sunDir.scale(100);
        if (this.sunDisc) {
            this.sunDisc.position = this.sunDir.scale(120);
            this.sunDisc.setEnabled(sy > -0.05);
        }
        const om = this.ocean?.mesh.material as ShaderMaterial | undefined;
        if (this.ocean) this.ocean.daylight = 0.05 + 0.95 * day;
        if (om) {
            om.setVector3("sunDir", this.lightDir);
            om.setColor3("sunColor", Color3.Lerp(new Color3(1, 0.86, 0.68), warm, low * 0.8).scale((5 * day + 0.3 * (1 - day) * up) * (1 - 0.85 * this.overcast)));
        }
        if (this.ug) {
            this.sun.intensity = 0;
            this.sun.setEnabled(false);
            this.moon.intensity = 0;
            this.scene.environmentIntensity = 0;
            this.caveFill.intensity = 0.3;
            this.scene.fogMode = Scene.FOGMODE_EXP2;
            this.scene.fogDensity = 0.013;
            this.scene.fogColor = new Color3(0.012, 0.016, 0.03);
            return;
        }
        this.sun.setEnabled(true);
        this.caveFill.intensity = 0;
        // ---- the weather: a grey sky lets less sun and sky light through; lightning lights everything up for a moment
        const ov = this.overcast;
        this.sun.intensity *= 1 - 0.85 * ov;
        this.moon.intensity *= 1 - ov;
        this.scene.environmentIntensity *= 1 - 0.5 * ov;
        const cu = this.curse;
        this.clouds.setEnabled(ov > 0.01 || cu > 0.01);
        if (ov > 0.01 || cu > 0.01) {
            const g = (0.08 + 0.55 * day) * (1 - 0.35 * ov) + this.flash * 0.9;
            // grey cloud, or a cursed dark pink
            const pr = 0.55 * (0.35 + 0.65 * day), pg = 0.1 * (0.35 + 0.65 * day), pb = 0.32 * (0.35 + 0.65 * day);
            const k = cu / Math.max(1e-3, cu + ov);
            this.cloudMat.emissiveColor.set(g * 0.92 * (1 - k) + pr * k, g * 0.95 * (1 - k) + pg * k, g * 1.02 * (1 - k) + pb * k);
            this.cloudMat.alpha = Math.min(0.94, Math.max(ov * 1.05, cu * 0.8));
            this.sun.intensity *= 1 - 0.5 * cu;
        }
        // the alien invasion: a burning orange sky and a low warm light, whatever the hour
        const dw = this.dawn;
        if (dw > 0.001) {
            this.clouds.setEnabled(true);
            const ce = this.cloudMat.emissiveColor;
            ce.set(ce.r + (1.0 * 0.85 - ce.r) * dw, ce.g + (0.32 * 0.85 - ce.g) * dw, ce.b + (0.14 * 0.85 - ce.b) * dw);
            this.cloudMat.alpha = Math.max(this.cloudMat.alpha * (ov > 0.01 || cu > 0.01 ? 1 : 0), dw * 0.9);
            this.sun.setEnabled(true);
            this.sun.diffuse = Color3.Lerp(this.sun.diffuse, new Color3(1.0, 0.55, 0.28), dw * 0.8);
            this.sun.intensity += (2.2 - this.sun.intensity) * dw;
            this.scene.environmentIntensity += (0.6 - this.scene.environmentIntensity) * dw;
        }
        this.flashLight.intensity = this.flash * 1.6;
        if (ov > 0.02) {
            this.scene.fogMode = Scene.FOGMODE_EXP2;
            this.scene.fogDensity = 0.004 * ov;
            const g = 0.08 + 0.5 * day;
            this.scene.fogColor = new Color3(g * 0.9, g * 0.93, g);
        } else this.scene.fogMode = Scene.FOGMODE_NONE;
        if (Math.abs(ov - this.lastOvercast) > 0.15) { this.lastOvercast = ov; force = true; }
        // re-capture the sky lighting every ~20 game minutes (or straight away when time jumps)
        const step = Math.abs(this.hour - this.lastCapture);
        if ((force || step > 0.33) && !this.capturing) void this.capture();
    }

    private async capture() {
        this.capturing = true;
        this.lastCapture = this.hour;
        try {
            const cube = this.env;
            cube.render();
            cube.sphericalPolynomial = await CubeMapToSphericalPolynomialTools.ConvertCubeMapTextureToSphericalPolynomial(cube as unknown as BaseTexture);
            await new HDRFiltering(this.scene.getEngine()).prefilter(cube as unknown as BaseTexture);
        } catch (e) {
            console.warn("sky capture failed", e);
        }
        this.capturing = false;
    }

    /** "14:05" */
    get clockText() {
        const h = Math.floor(this.hour), m = Math.floor((this.hour - h) * 60);
        return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    }
}
