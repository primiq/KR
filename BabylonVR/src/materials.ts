import {
    Color3,
    DynamicTexture,
    type Material,
    PBRMaterial,
    type ReflectionProbe,
    type Scene,
    Texture,
    Vector2,
} from "@babylonjs/core";

/**
 * A library of showcase materials built on Babylon's physically based shading:
 * refraction + dispersion, translucency, clear coat, iridescence, sheen,
 * anisotropy and emissive neon.
 */
export class MaterialLibrary {
    readonly glass: PBRMaterial;
    readonly amberGlass: PBRMaterial;
    readonly frostedGlass: PBRMaterial;
    readonly diamond: PBRMaterial;
    readonly jade: PBRMaterial;
    readonly wax: PBRMaterial;
    readonly carPaint: PBRMaterial;
    readonly iridescent: PBRMaterial;
    readonly velvet: PBRMaterial;
    readonly brushedSteel: PBRMaterial;
    readonly gold: PBRMaterial;
    readonly chrome: PBRMaterial;
    readonly neonCyan: PBRMaterial;
    readonly neonMagenta: PBRMaterial;
    readonly neonAmber: PBRMaterial;
    readonly crate: PBRMaterial;
    readonly marble: PBRMaterial;
    readonly darkStone: PBRMaterial;
    readonly pearlCoat: PBRMaterial;
    readonly thinFilm: PBRMaterial;

    /** Materials suitable for the randomly assigned physics blocks. */
    readonly blockPalette: Material[];

    constructor(
        private readonly scene: Scene,
        probe: ReflectionProbe,
    ) {
        const live = probe.cubeTexture;

        this.glass = this.refractive("glass", new Color3(0.94, 0.98, 1), 1.5, 0.02, live);
        this.glass.subSurface.isDispersionEnabled = true;
        this.glass.subSurface.dispersion = 0.25;

        this.amberGlass = this.refractive("amberGlass", new Color3(1, 0.62, 0.18), 1.52, 0.04, live);
        this.amberGlass.subSurface.tintColorAtDistance = 0.25;

        this.frostedGlass = this.refractive("frostedGlass", new Color3(0.8, 0.92, 1), 1.45, 0.32, live);

        this.diamond = this.refractive("diamond", new Color3(1, 1, 1), 2.42, 0.0, live);
        this.diamond.subSurface.isDispersionEnabled = true;
        this.diamond.subSurface.dispersion = 1.2;

        this.jade = this.pbr("jade", new Color3(0.18, 0.62, 0.38), 0, 0.28);
        this.jade.subSurface.isTranslucencyEnabled = true;
        this.jade.subSurface.translucencyIntensity = 0.85;
        this.jade.subSurface.tintColor = new Color3(0.25, 0.85, 0.5);
        this.jade.subSurface.minimumThickness = 0.1;
        this.jade.subSurface.maximumThickness = 1.5;
        this.jade.clearCoat.isEnabled = true;
        this.jade.clearCoat.intensity = 0.6;
        this.jade.clearCoat.roughness = 0.08;

        this.wax = this.pbr("wax", new Color3(0.95, 0.82, 0.68), 0, 0.45);
        this.wax.subSurface.isTranslucencyEnabled = true;
        this.wax.subSurface.translucencyIntensity = 1;
        this.wax.subSurface.tintColor = new Color3(1, 0.5, 0.3);

        this.carPaint = this.pbr("carPaint", new Color3(0.55, 0.02, 0.04), 0.65, 0.42);
        this.carPaint.clearCoat.isEnabled = true;
        this.carPaint.clearCoat.intensity = 1;
        this.carPaint.clearCoat.roughness = 0.03;
        this.carPaint.clearCoat.isTintEnabled = true;
        this.carPaint.clearCoat.tintColor = new Color3(1, 0.85, 0.85);
        this.carPaint.clearCoat.tintThickness = 0.2;

        this.iridescent = this.pbr("iridescent", new Color3(0.06, 0.06, 0.08), 1, 0.12);
        this.iridescent.iridescence.isEnabled = true;
        this.iridescent.iridescence.intensity = 1;
        this.iridescent.iridescence.indexOfRefraction = 1.6;
        this.iridescent.iridescence.minimumThickness = 250;
        this.iridescent.iridescence.maximumThickness = 650;

        this.velvet = this.pbr("velvet", new Color3(0.22, 0.03, 0.32), 0, 0.85);
        this.velvet.sheen.isEnabled = true;
        this.velvet.sheen.intensity = 1;
        this.velvet.sheen.color = new Color3(1, 0.55, 1);
        this.velvet.sheen.roughness = 0.35;

        this.brushedSteel = this.pbr("brushedSteel", new Color3(0.78, 0.79, 0.82), 1, 0.32);
        this.brushedSteel.anisotropy.isEnabled = true;
        this.brushedSteel.anisotropy.intensity = 0.9;
        this.brushedSteel.anisotropy.direction = new Vector2(1, 0);

        this.gold = this.pbr("gold", new Color3(1.0, 0.71, 0.29), 1, 0.12);
        this.gold.clearCoat.isEnabled = true;
        this.gold.clearCoat.intensity = 0.35;
        this.gold.clearCoat.roughness = 0.0;

        this.chrome = this.pbr("chrome", new Color3(0.98, 0.98, 1), 1, 0.0);
        this.chrome.reflectionTexture = live;

        this.neonCyan = this.neon("neonCyan", new Color3(0.1, 0.9, 1));
        this.neonMagenta = this.neon("neonMagenta", new Color3(1, 0.15, 0.75));
        this.neonAmber = this.neon("neonAmber", new Color3(1, 0.55, 0.08));

        this.crate = this.sciFiCrate();
        this.marble = this.marbleMaterial();
        this.darkStone = this.pbr("darkStone", new Color3(0.09, 0.09, 0.1), 0, 0.55);
        this.darkStone.clearCoat.isEnabled = true;
        this.darkStone.clearCoat.intensity = 0.5;
        this.darkStone.clearCoat.roughness = 0.12;

        // Two-layer "pearl" paint: metallic flake base + tinted clear coat.
        this.pearlCoat = this.pbr("pearlCoat", new Color3(0.02, 0.18, 0.55), 0.4, 0.35);
        this.pearlCoat.clearCoat.isEnabled = true;
        this.pearlCoat.clearCoat.intensity = 1;
        this.pearlCoat.clearCoat.roughness = 0.02;
        this.pearlCoat.clearCoat.indexOfRefraction = 1.6;
        this.pearlCoat.iridescence.isEnabled = true;
        this.pearlCoat.iridescence.intensity = 0.35;

        // Thin-film coated chrome (soap-bubble interference on metal).
        this.thinFilm = this.pbr("thinFilm", new Color3(0.9, 0.9, 0.92), 1, 0.18);
        this.thinFilm.iridescence.isEnabled = true;
        this.thinFilm.iridescence.intensity = 1;
        this.thinFilm.iridescence.indexOfRefraction = 1.45;
        this.thinFilm.iridescence.minimumThickness = 400;
        this.thinFilm.iridescence.maximumThickness = 700;

        this.blockPalette = [
            this.glass,
            this.amberGlass,
            this.frostedGlass,
            this.jade,
            this.carPaint,
            this.iridescent,
            this.velvet,
            this.brushedSteel,
            this.gold,
            this.crate,
            this.crate,
            this.marble,
            this.pearlCoat,
            this.thinFilm,
            this.wax,
        ];
    }

    private pbr(name: string, albedo: Color3, metallic: number, roughness: number): PBRMaterial {
        const m = new PBRMaterial(name, this.scene);
        m.albedoColor = albedo;
        m.metallic = metallic;
        m.roughness = roughness;
        return m;
    }

    private refractive(name: string, tint: Color3, ior: number, roughness: number, live: PBRMaterial["reflectionTexture"]): PBRMaterial {
        const m = this.pbr(name, new Color3(1, 1, 1), 0, roughness);
        m.indexOfRefraction = ior;
        m.subSurface.isRefractionEnabled = true;
        m.subSurface.refractionIntensity = 1;
        m.subSurface.indexOfRefraction = ior;
        m.subSurface.tintColor = tint;
        m.subSurface.tintColorAtDistance = 1.5;
        m.subSurface.minimumThickness = 0.05;
        m.subSurface.maximumThickness = 0.6;
        m.subSurface.useThicknessAsDepth = true;
        // Refract the live reflection probe so the actual scene shows through (works in VR too).
        m.subSurface.refractionTexture = live;
        m.subSurface.volumeIndexOfRefraction = ior;
        m.environmentIntensity = 1.1;
        return m;
    }

    private neon(name: string, color: Color3): PBRMaterial {
        const m = this.pbr(name, color.scale(0.2), 0, 0.3);
        m.emissiveColor = color;
        m.emissiveIntensity = 4;
        return m;
    }

    private sciFiCrate(): PBRMaterial {
        const size = 512;
        const albedo = new DynamicTexture("crateAlbedo", size, this.scene, true);
        const emissive = new DynamicTexture("crateEmissive", size, this.scene, true);
        const a = albedo.getContext() as CanvasRenderingContext2D;
        const e = emissive.getContext() as CanvasRenderingContext2D;

        const g = a.createLinearGradient(0, 0, size, size);
        g.addColorStop(0, "#2b2f38");
        g.addColorStop(1, "#1a1d24");
        a.fillStyle = g;
        a.fillRect(0, 0, size, size);
        e.fillStyle = "#000";
        e.fillRect(0, 0, size, size);

        // Panel seams and bevels.
        a.strokeStyle = "#0c0e12";
        a.lineWidth = 10;
        a.strokeRect(24, 24, size - 48, size - 48);
        a.strokeStyle = "#454b58";
        a.lineWidth = 3;
        a.strokeRect(40, 40, size - 80, size - 80);
        // Hazard chevrons along the bottom.
        for (let x = -size; x < size * 2; x += 48) {
            a.fillStyle = "#e0a400";
            a.beginPath();
            a.moveTo(x, size - 40);
            a.lineTo(x + 24, size - 40);
            a.lineTo(x + 48, size - 16);
            a.lineTo(x + 24, size - 16);
            a.fill();
        }
        // Glowing circuit lines.
        e.strokeStyle = "#39e6ff";
        e.lineWidth = 6;
        e.beginPath();
        e.moveTo(70, 120);
        e.lineTo(200, 120);
        e.lineTo(240, 160);
        e.lineTo(440, 160);
        e.moveTo(70, 340);
        e.lineTo(300, 340);
        e.lineTo(340, 300);
        e.lineTo(440, 300);
        e.stroke();
        e.fillStyle = "#39e6ff";
        for (const [x, y] of [
            [70, 120],
            [440, 160],
            [70, 340],
            [440, 300],
        ]) {
            e.beginPath();
            e.arc(x, y, 12, 0, Math.PI * 2);
            e.fill();
        }
        a.drawImage(e.canvas, 0, 0);
        albedo.update();
        emissive.update();

        const m = this.pbr("sciFiCrate", Color3.White(), 0.7, 0.38);
        m.albedoTexture = albedo;
        m.emissiveTexture = emissive;
        m.emissiveColor = Color3.White();
        m.emissiveIntensity = 2.5;
        m.clearCoat.isEnabled = true;
        m.clearCoat.intensity = 0.4;
        m.clearCoat.roughness = 0.15;
        return m;
    }

    private marbleMaterial(): PBRMaterial {
        const size = 512;
        const tex = new DynamicTexture("marbleAlbedo", size, this.scene, true);
        const ctx = tex.getContext() as CanvasRenderingContext2D;
        const img = ctx.createImageData(size, size);
        // Cheap turbulence marble from layered sines.
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const u = x / size;
                const v = y / size;
                let t = 0;
                let amp = 1;
                let freq = 3;
                for (let o = 0; o < 5; o++) {
                    t += Math.sin((u * 1.7 + v) * freq + Math.sin(v * freq * 1.3 + o) * 2.2) * amp;
                    amp *= 0.5;
                    freq *= 2.1;
                }
                const vein = Math.pow(Math.abs(Math.sin(u * 6 + v * 3 + t * 1.5)), 0.22);
                const c = 0.72 + 0.28 * vein;
                const i = (y * size + x) * 4;
                img.data[i] = 255 * c;
                img.data[i + 1] = 252 * c;
                img.data[i + 2] = 246 * c;
                img.data[i + 3] = 255;
            }
        }
        ctx.putImageData(img, 0, 0);
        tex.update();
        tex.wrapU = tex.wrapV = Texture.WRAP_ADDRESSMODE;

        const m = this.pbr("marble", Color3.White(), 0, 0.18);
        m.albedoTexture = tex;
        m.clearCoat.isEnabled = true;
        m.clearCoat.intensity = 0.8;
        m.clearCoat.roughness = 0.02;
        m.subSurface.isTranslucencyEnabled = true;
        m.subSurface.translucencyIntensity = 0.25;
        return m;
    }
}
