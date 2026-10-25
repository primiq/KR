import {
    type AbstractMesh,
    CascadedShadowGenerator,
    Color3,
    CubeTexture,
    DirectionalLight,
    ImportMeshAsync,
    Mesh,
    MeshBuilder,
    PBRMaterial,
    PhysicsAggregate,
    PhysicsShapeType,
    PointLight,
    ReflectionProbe,
    type Scene,
    StandardMaterial,
    Vector3,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import { ALL_LAYERS, Assets, Layer } from "./config";

export interface Environment {
    sponzaMeshes: AbstractMesh[];
    sun: DirectionalLight;
    sunMesh: Mesh;
    shadows: CascadedShadowGenerator;
    probe: ReflectionProbe;
    torches: PointLight[];
    skybox: Mesh | null;
    floorY: number;
    addShadowCaster(mesh: AbstractMesh): void;
}

/** Prefer the locally fetched copy of an asset, falling back to the remote URL. */
async function resolveAsset(local: string, remote: string): Promise<string> {
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

export async function createEnvironment(scene: Scene, onProgress: (fraction: number, label: string) => void): Promise<Environment> {
    // ---- Image based lighting -------------------------------------------------
    onProgress(0.05, "Loading HDR environment…");
    const envUrl = await resolveAsset(Assets.environment.local, Assets.environment.remote);
    const env = CubeTexture.CreateFromPrefilteredData(envUrl, scene);
    env.name = "sanGiuseppeBridge";
    scene.environmentTexture = env;
    scene.environmentIntensity = 1;
    const skybox = scene.createDefaultSkybox(env, true, 1000, 0.05, false);
    if (skybox) {
        skybox.isPickable = false;
        skybox.infiniteDistance = true;
    }

    // ---- Sun + cascaded shadows -------------------------------------------------
    const sun = new DirectionalLight("sun", new Vector3(0.32, -1, 0.18).normalize(), scene);
    sun.position = sun.direction.scale(-40);
    sun.intensity = 9;
    sun.diffuse = new Color3(1, 0.93, 0.82);
    sun.shadowMinZ = 1;
    sun.shadowMaxZ = 90;

    const shadows = new CascadedShadowGenerator(2048, sun);
    shadows.numCascades = 4;
    shadows.lambda = 0.85;
    shadows.shadowMaxZ = 45;
    shadows.stabilizeCascades = true;
    shadows.cascadeBlendPercentage = 0.08;
    shadows.usePercentageCloserFiltering = true;
    shadows.filteringQuality = CascadedShadowGenerator.QUALITY_HIGH;
    shadows.bias = 0.004;
    shadows.normalBias = 0.02;
    shadows.depthClamp = true;
    shadows.transparencyShadow = true;
    shadows.enableSoftTransparentShadow = true;

    // A small emissive disc used as the source for volumetric light shafts.
    const sunMesh = MeshBuilder.CreateDisc("sunDisc", { radius: 4, tessellation: 32 }, scene);
    const sunMat = new StandardMaterial("sunDiscMat", scene);
    sunMat.emissiveColor = new Color3(1, 0.92, 0.75);
    sunMat.disableLighting = true;
    sunMesh.material = sunMat;
    sunMesh.position = sun.direction.scale(-120);
    sunMesh.lookAt(Vector3.Zero());
    sunMesh.isPickable = false;
    sunMesh.applyFog = false;

    // ---- Sponza ---------------------------------------------------------------
    onProgress(0.1, "Loading Sponza atrium…");
    const sponzaRoot = await resolveAsset(Assets.sponza.local + Assets.sponza.file, Assets.sponza.remote + Assets.sponza.file);
    const result = await ImportMeshAsync(sponzaRoot, scene, {
        onProgress: (e) => {
            if (e.lengthComputable && e.total > 0) onProgress(0.1 + 0.5 * (e.loaded / e.total), "Loading Sponza atrium…");
        },
    });
    onProgress(0.6, "Building collision meshes…");

    const sponzaMeshes = result.meshes.filter((m) => m.getTotalVertices() > 0);
    for (const mesh of sponzaMeshes) {
        mesh.receiveShadows = true;
        mesh.isPickable = true;
        shadows.addShadowCaster(mesh, false);
        const mat = mesh.material;
        if (mat instanceof PBRMaterial) {
            // The IBL can't be occluded indoors, so keep it subtle and let the sun + AO do the work.
            mat.environmentIntensity = 0.7;
            mat.useHorizonOcclusion = true;
            mat.useRadianceOcclusion = true;
        }
        mesh.freezeWorldMatrix();
        mesh.doNotSyncBoundingInfo = true;

        // Alpha-tested foliage/chains are decorative only; everything else becomes static collision.
        const alphaTested = mat instanceof PBRMaterial && mat.transparencyMode === PBRMaterial.PBRMATERIAL_ALPHATEST;
        if (!alphaTested && mesh instanceof Mesh) {
            const agg = new PhysicsAggregate(mesh, PhysicsShapeType.MESH, { mass: 0, friction: 0.8, restitution: 0.1 }, scene);
            agg.shape.filterMembershipMask = Layer.STATIC;
            agg.shape.filterCollideMask = ALL_LAYERS;
        }
    }

    // Probe the floor height at the courtyard centre.
    const physics = scene.getPhysicsEngine()!;
    const hit = physics.raycast(new Vector3(0, 1.5, -0.3), new Vector3(0, -3, -0.3));
    const floorY = hit.hasHit ? hit.hitPointWorld.y : 0;

    // ---- Torches / fill ---------------------------------------------------------
    const torches: PointLight[] = [];
    for (const [x, z, c] of [
        [-6, 1.2, new Color3(1, 0.55, 0.22)],
        [6, -1.8, new Color3(1, 0.55, 0.22)],
        [0.5, -0.3, new Color3(0.35, 0.75, 1)],
    ] as const) {
        const light = new PointLight("torch", new Vector3(x, floorY + 2.2, z), scene);
        light.diffuse = c;
        light.intensity = 8;
        light.range = 10;
        torches.push(light);
    }
    let t = 0;
    scene.onBeforeRenderObservable.add(() => {
        t += scene.deltaTime / 1000;
        torches.forEach((l, i) => {
            if (i < 2) l.intensity = 5.2 + Math.sin(t * 13 + i) * 0.5 + Math.sin(t * 29 + i * 3) * 0.35;
        });
    });

    // ---- Live reflection probe -------------------------------------------------------
    const probe = new ReflectionProbe("probe", 256, scene, true, true);
    probe.position = new Vector3(1.5, floorY + 1.4, -0.3);
    probe.refreshRate = 2;
    probe.renderList!.push(...sponzaMeshes);
    if (skybox) probe.renderList!.push(skybox);

    return {
        sponzaMeshes,
        sun,
        sunMesh,
        shadows,
        probe,
        torches,
        skybox,
        floorY,
        addShadowCaster: (mesh) => {
            shadows.addShadowCaster(mesh);
            mesh.receiveShadows = true;
        },
    };
}
