import { Color3, CubeTexture, ImportMeshAsync, Mesh, PBRMaterial, PhysicsAggregate, PhysicsShapeType, PointLight, type Scene, Vector3 } from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import { ALL_LAYERS, Assets, Layer } from "../config";
import { addShadowCasterFn, createProbe, createSkybox, createSun, type Environment, type ProgressFn, type Quality, resolveAsset } from "../environment";

/** The Crytek Sponza atrium: glTF architecture with PBR textures, warm torches and a sunlit courtyard. */
export async function createAtrium(scene: Scene, quality: Quality, onProgress: ProgressFn): Promise<Environment> {
    onProgress(0.05, "Loading HDR environment…");
    const envUrl = await resolveAsset(Assets.environment.local, Assets.environment.remote);
    const env = CubeTexture.CreateFromPrefilteredData(envUrl, scene);
    env.name = "sanGiuseppeBridge";
    scene.environmentTexture = env;
    scene.environmentIntensity = 1;
    const skybox = createSkybox(scene, env, 0.05);

    const { sun, shadows, sunMesh } = createSun(scene, new Vector3(0.32, -1, 0.18), 9, quality, 45);

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
    const hit = scene.getPhysicsEngine()!.raycast(new Vector3(0, 1.5, -0.3), new Vector3(0, -3, -0.3));
    const floorY = hit.hasHit ? hit.hitPointWorld.y : 0;

    // Flickering torches + a cool fill light.
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

    const probe = createProbe(scene, new Vector3(1.5, floorY + 1.4, -0.3), quality, skybox ? [...sponzaMeshes, skybox] : sponzaMeshes);

    return {
        id: "atrium",
        sun,
        sunMesh,
        shadows,
        probe,
        skybox,
        floorY,
        exposure: 1.5,
        spawn: new Vector3(-0.9, floorY, -0.35),
        lookAt: new Vector3(8, floorY, -0.6),
        addShadowCaster: addShadowCasterFn(shadows),
        populate(props) {
            // Sponza's central corridor runs along X, between the curtain lines at z ≈ -2.1 and 1.5.
            // The floor isn't perfectly flat, so each structure sits on the highest point under its footprint.
            const z0 = -0.3;
            const at = (x: number, z: number, hx: number, hz: number) => props.groundAt(x, z, hx, hz);
            props.buildCrouchTunnel(at(-7.4, z0, 1.2, 0.8));
            props.buildBrickWall(at(-3.0, z0, 0.15, 1.3), 6, 5);
            props.buildHeavyCrates(at(-1.9, z0 - 1.05, 0.9, 0.35));
            props.buildDominoes(at(-2.0, z0 + 0.75, 0.1, 0.3), 15);
            props.buildShowcase(at(2.6, z0 - 1.3, 1.6, 0.25));
            props.buildBlockTower(at(2.4, z0 + 0.45, 0.65, 0.65), 4, 0.32);
            props.buildBlockTower(at(4.3, z0 + 0.2, 0.6, 0.6), 3, 0.4);
            props.buildParkour(at(6.6, z0, 0.5, 0.5));
        },
    };
}
