import {
    type AbstractMesh,
    type BaseTexture,
    CascadedShadowGenerator,
    Color3,
    DirectionalLight,
    Mesh,
    MeshBuilder,
    ReflectionProbe,
    type Scene,
    StandardMaterial,
    Vector3,
} from "@babylonjs/core";
import type { Props } from "./props";

/**
 * Device class the scene is built for: "high" (desktop GPU), "medium" (standalone VR headsets,
 * which render every frame twice) and "mobile" (phones). Lower tiers trim shadow maps, probes
 * and vegetation density.
 */
export type Quality = "high" | "medium" | "mobile";

/** Picks a value per quality tier. */
export function tier<T>(quality: Quality, high: T, medium: T, mobile: T): T {
    return quality === "high" ? high : quality === "medium" ? medium : mobile;
}

export type LocationId = "atrium" | "forest";

export const LOCATIONS: Array<{ id: LocationId; label: string }> = [
    { id: "atrium", label: "Sponza Atrium" },
    { id: "forest", label: "Deep Forest" },
];

export interface Environment {
    id: LocationId;
    sun: DirectionalLight;
    sunMesh: Mesh;
    shadows: CascadedShadowGenerator;
    probe: ReflectionProbe;
    skybox: Mesh | null;
    floorY: number;
    /** Tone-mapping exposure suited to the location's lighting. */
    exposure: number;
    /** Optional looping ambient soundtrack. */
    ambience?: string;
    spawn: Vector3;
    lookAt: Vector3;
    /** Optional location-specific feature toggled from the graphics menu. */
    water?: { setEnabled(on: boolean): void };
    /** Places the physics playground for this location. */
    populate(props: Props): void;
    addShadowCaster(mesh: AbstractMesh): void;
}

export type ProgressFn = (fraction: number, label: string) => void;

/** Prefer the locally fetched copy of an asset, falling back to the remote URL. */
export async function resolveAsset(local: string, remote: string): Promise<string> {
    try {
        const res = await fetch(local, { method: "HEAD" });
        const type = res.headers.get("content-type") ?? "";
        // Dev servers answer unknown paths with index.html, so reject HTML.
        if (res.ok && !type.includes("text/html")) return local;
    } catch {
        // Fall through to remote.
    }
    return remote;
}

/** Directional sun with cascaded PCF shadows and an emissive disc for volumetric light shafts. */
export function createSun(scene: Scene, direction: Vector3, intensity: number, quality: Quality, shadowMaxZ: number) {
    const sun = new DirectionalLight("sun", direction.normalize(), scene);
    sun.position = sun.direction.scale(-40);
    sun.intensity = intensity;
    sun.diffuse = new Color3(1, 0.93, 0.82);
    sun.shadowMinZ = 1;
    sun.shadowMaxZ = 150;

    const shadows = new CascadedShadowGenerator(quality === "mobile" ? 1024 : 2048, sun);
    shadows.numCascades = tier(quality, 4, 3, 2);
    shadows.lambda = 0.85;
    shadows.shadowMaxZ = shadowMaxZ;
    shadows.stabilizeCascades = true;
    shadows.cascadeBlendPercentage = 0.08;
    shadows.usePercentageCloserFiltering = true;
    shadows.filteringQuality = quality === "mobile" ? CascadedShadowGenerator.QUALITY_LOW : CascadedShadowGenerator.QUALITY_HIGH;
    shadows.bias = 0.004;
    shadows.normalBias = 0.02;
    shadows.depthClamp = true;
    shadows.transparencyShadow = true;
    shadows.enableSoftTransparentShadow = true;

    const sunMesh = MeshBuilder.CreateDisc("sunDisc", { radius: 4, tessellation: 32 }, scene);
    const sunMat = new StandardMaterial("sunDiscMat", scene);
    sunMat.emissiveColor = new Color3(1, 0.92, 0.75);
    sunMat.disableLighting = true;
    sunMat.fogEnabled = false;
    sunMesh.material = sunMat;
    sunMesh.position = sun.direction.scale(-120);
    sunMesh.lookAt(Vector3.Zero());
    sunMesh.isPickable = false;
    sunMesh.infiniteDistance = true;

    return { sun, shadows, sunMesh };
}

export function createSkybox(scene: Scene, env: BaseTexture, blur: number): Mesh | null {
    const skybox = scene.createDefaultSkybox(env, true, 1000, blur, false);
    if (skybox) {
        skybox.isPickable = false;
        skybox.infiniteDistance = true;
        skybox.applyFog = false;
    }
    return skybox;
}

export function createProbe(scene: Scene, position: Vector3, quality: Quality, meshes: AbstractMesh[]): ReflectionProbe {
    const probe = new ReflectionProbe("probe", quality === "mobile" ? 128 : 256, scene, true, true);
    probe.position = position;
    probe.refreshRate = quality === "mobile" ? 0 : 2;
    probe.renderList!.push(...meshes);
    return probe;
}

export function addShadowCasterFn(shadows: CascadedShadowGenerator) {
    return (mesh: AbstractMesh) => {
        shadows.addShadowCaster(mesh);
        mesh.receiveShadows = true;
    };
}

export async function loadLocation(id: LocationId, scene: Scene, quality: Quality, onProgress: ProgressFn): Promise<Environment> {
    if (id === "forest") {
        const { createForest } = await import("./locations/forest");
        return createForest(scene, quality, onProgress);
    }
    const { createAtrium } = await import("./locations/atrium");
    return createAtrium(scene, quality, onProgress);
}
