import { type AbstractMesh, Color3, Color4, type Material, PBRMaterial, PointLight, type Scene, Vector3 } from "@babylonjs/core";
import { PBRCustomMaterial } from "@babylonjs/materials";
import * as THREE from "three";
import type { Game } from "../game/game";
import { NOISE_GLSL } from "../render/materials";
import { ThreeMirror } from "../render/mirror";
import type { Atmosphere } from "./atmosphere";

const KEEP = { keepUnderground: true };

/**
 * Draws the caves under the island (and the huts, wrecks and shaft marks above it) and switches the presentation
 * between the two places. Castaway hides every scene child that is not marked `keepUnderground`; here every mesh that
 * exists when you climb down is masked out of the cameras (its layer mask is zeroed, and put back when you climb out),
 * except meshes tagged `keepUnderground` (or parented under one): the cave itself, the other players, your hands, pickups.
 */
export class CaveView {
    private mirror: ThreeMirror;
    private lights: PointLight[];
    private stashed = new Map<AbstractMesh, number>();
    private wasAutoClear = false;
    private clear0 = new Color4();

    constructor(private readonly scene: Scene, private readonly game: Game, private readonly clock: Atmosphere, shadows: boolean) {
        const mats = new Map<string, Material>();
        const custom = (m: THREE.Material): Material | null => {
            const name = m.name;
            if (!name.startsWith("cave") && !name.startsWith("ug")) return null;
            if (name === "ug") return null; // flat-coloured marks: the default translation (PBR from the colour)
            const key = name === "ugEarth" || name === "ugHole" ? `${name}:${(m as THREE.MeshStandardMaterial).color.getHexString()}` : name;
            let b = mats.get(key);
            if (!b) { b = this.material(name, m); mats.set(key, b); }
            return b;
        };
        this.mirror = new ThreeMirror(scene, game.ugRoot, null, shadows, { custom, tag: KEEP });
        // the cave's glow lights (crystals, chest glints, the lantern by each rope)
        this.lights = game.under.world.lights.map((_, i) => {
            const l = new PointLight(`cave${i}`, Vector3.Zero(), scene);
            l.range = 17;
            l.intensity = 0;
            l.setEnabled(false);
            return l;
        });
        game.onUnderground = (on) => this.present(on);
    }

    private material(name: string, src: THREE.Material): Material {
        const s = this.scene;
        if (name === "caveRock") {
            // Castaway's cave rock: vertex colours broken up by world-space noise, strata and dark cracks; never pure black
            const m = new PBRCustomMaterial("caveRock", s);
            m.metallic = 0;
            m.roughness = 0.96;
            m.maxSimultaneousLights = 8;
            m.Fragment_Definitions(NOISE_GLSL);
            m.Fragment_Custom_Albedo(`
                vec3 wp = vPositionW;
                float g1 = cNoise(wp * 2.3) * 0.5 + 0.5, g2 = cNoise(wp * 9.0) * 0.5 + 0.5;
                float strata = cNoise(vec3(wp.x * 0.5, wp.y * 3.4, wp.z * 0.5)) * 0.5 + 0.5;
                float ridge = abs(cNoise(wp * 1.1 + g1 * 0.7));
                float crack = smoothstep(0.07, 0.0, ridge);
                surfaceAlbedo *= (0.72 + g1 * 0.42) * (0.86 + g2 * 0.3) * (0.84 + strata * 0.34) * (1.0 - crack * 0.55);
            `);
            m.Fragment_Before_FinalColorComposition(`
                #ifdef VERTEXCOLOR
                finalEmissive += vColor.rgb * 0.06;
                #endif
            `);
            return m;
        }
        if (name === "caveGlow") {
            // crystals, diamonds and lanterns: they light themselves (and the bloom picks them up)
            const m = new PBRMaterial("caveGlow", s);
            m.unlit = true;
            m.albedoColor = new Color3(1.7, 1.7, 1.7);
            return m;
        }
        if (name === "ugEarth") {
            // the soft-edged earth tint round a hollow spot
            const m = new PBRMaterial("ugEarth", s);
            const c = (src as THREE.MeshStandardMaterial).color;
            m.albedoColor = new Color3(c.r, c.g, c.b);
            m.metallic = 0;
            m.roughness = 1;
            m.zOffset = -2;
            m.alpha = 0.62;
            m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
            return m;
        }
        if (name === "ugHole") {
            const m = new PBRMaterial("ugHole", s);
            m.unlit = true;
            m.albedoColor = Color3.Black();
            m.zOffset = -3;
            return m;
        }
        // ore lumps and wood: vertex-coloured, a touch of self light so they read in the gloom
        const ore = name === "caveOre";
        const m = new PBRMaterial(name, s);
        m.albedoColor = Color3.White();
        m.metallic = ore ? 0.25 : 0;
        m.roughness = ore ? 0.55 : 0.85;
        m.maxSimultaneousLights = 8;
        m.emissiveColor = new Color3(0.06, 0.06, 0.06);
        return m;
    }

    /** climbing down (true) or out (false) */
    private present(on: boolean) {
        const s = this.scene;
        // the huts, wrecks and shaft marks belong to the surface
        for (const c of this.game.ugRoot.children) if (c !== this.game.under.world.group) c.visible = !on;
        if (on) {
            this.stashed.clear();
            for (const m of s.meshes) {
                if (keep(m)) continue;
                this.stashed.set(m, m.layerMask);
                m.layerMask = 0;
            }
            this.wasAutoClear = s.autoClear;
            this.clear0.copyFrom(s.clearColor);
            s.autoClear = true;
            s.clearColor = new Color4(0.012, 0.016, 0.03, 1);
        } else {
            for (const [m, mask] of this.stashed) if (!m.isDisposed()) m.layerMask = mask;
            this.stashed.clear();
            s.autoClear = this.wasAutoClear;
            s.clearColor = this.clear0.clone();
            for (const l of this.lights) { l.intensity = 0; l.setEnabled(false); }
        }
        this.clock.underground = on;
    }

    private townStash = new Map<AbstractMesh, number>();
    /** in a town (Locations, Locations) everything but the town, the sky and the people is switched off, like in the caves */
    hideWorld(on: boolean) {
        if (on) {
            if (this.townStash.size) return;
            for (const m of this.scene.meshes) {
                if (keep(m) || m.metadata?.town || SKY.has(m.name)) continue;
                this.townStash.set(m, m.layerMask);
                m.layerMask = 0;
            }
        } else {
            for (const [m, mask] of this.townStash) if (!m.isDisposed()) m.layerMask = mask;
            this.townStash.clear();
        }
    }

    /** every frame, after the game has updated */
    update() {
        this.mirror.sync();
        if (!this.game.under.active) return;
        const src = this.game.under.world.lights;
        src.forEach((t, i) => {
            const l = this.lights[i];
            l.position.set(t.position.x, t.position.y, t.position.z);
            l.diffuse.set(t.color.r, t.color.g, t.color.b);
            l.intensity = t.intensity;
            l.setEnabled(t.intensity > 0.02);
        });
    }
}

const SKY = new Set(["skyBox", "stars", "moonDisc", "clouds"]);

function keep(m: AbstractMesh) {
    for (let n: { metadata?: { keepUnderground?: boolean } | null; parent?: unknown; getClassName?: () => string } | null = m; n; n = (n.parent as typeof n) ?? null) {
        if (n.metadata?.keepUnderground) return true;
        if (n.getClassName?.().endsWith("Camera")) return true;
        // the headset's controllers, hands and panels, and the fishing line
        const nm = (n as { name?: string }).name ?? "";
        if (nm.startsWith("vr") || nm.startsWith("xr") || nm.includes("controller") || nm === "fishLine") return true;
    }
    return false;
}
