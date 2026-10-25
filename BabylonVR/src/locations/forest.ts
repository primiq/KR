import {
    type AbstractMesh,
    Color3,
    Color4,
    DynamicTexture,
    GPUParticleSystem,
    HDRCubeTexture,
    ImportMeshAsync,
    Matrix,
    Mesh,
    MeshBuilder,
    NoiseProceduralTexture,
    ParticleSystem,
    PBRMaterial,
    PhysicsAggregate,
    PhysicsBody,
    PhysicsMotionType,
    PhysicsShapeCylinder,
    PhysicsShapeType,
    Quaternion,
    Scene,
    Texture,
    TransformNode,
    Vector2,
    Vector3,
    VertexData,
} from "@babylonjs/core";
import { PBRCustomMaterial, WaterMaterial } from "@babylonjs/materials";
import "@babylonjs/loaders/glTF";
import { ALL_LAYERS, Assets, Layer } from "../config";
import { addShadowCasterFn, createProbe, createSkybox, createSun, type Environment, type ProgressFn, type Quality, resolveAsset, tier } from "../environment";
import { generateTree, toBabylon, type TreePreset } from "../forest/treeGen";
import { WindPlugin } from "../forest/wind";

import oakLarge from "@eztree/lib/presets/oak_large.json";
import ashLarge from "@eztree/lib/presets/ash_large.json";
import pineLarge from "@eztree/lib/presets/pine_large.json";
import aspenMedium from "@eztree/lib/presets/aspen_medium.json";
import bush1 from "@eztree/lib/presets/bush_1.json";
import bush2 from "@eztree/lib/presets/bush_2.json";

import oakColor from "@eztree/lib/assets/bark/oak_color_1k.jpg?url";
import oakNormal from "@eztree/lib/assets/bark/oak_normal_1k.jpg?url";
import oakRough from "@eztree/lib/assets/bark/oak_roughness_1k.jpg?url";
import oakAo from "@eztree/lib/assets/bark/oak_ao_1k.jpg?url";
import pineColor from "@eztree/lib/assets/bark/pine_color_1k.jpg?url";
import pineNormal from "@eztree/lib/assets/bark/pine_normal_1k.jpg?url";
import pineRough from "@eztree/lib/assets/bark/pine_roughness_1k.jpg?url";
import pineAo from "@eztree/lib/assets/bark/pine_ao_1k.jpg?url";
import birchColor from "@eztree/lib/assets/bark/birch_color_1k.jpg?url";
import birchNormal from "@eztree/lib/assets/bark/birch_normal_1k.jpg?url";
import birchRough from "@eztree/lib/assets/bark/birch_roughness_1k.jpg?url";
import birchAo from "@eztree/lib/assets/bark/birch_ao_1k.jpg?url";
import oakLeaves from "@eztree/lib/assets/leaves/oak_color.png?url";
import ashLeaves from "@eztree/lib/assets/leaves/ash_color.png?url";
import aspenLeaves from "@eztree/lib/assets/leaves/aspen_color.png?url";
import pineLeaves from "@eztree/lib/assets/leaves/pine_color.png?url";
import grassJpg from "@eztree/app/public/grass.jpg?url";
import dirtColor from "@eztree/app/public/dirt_color.jpg?url";
import dirtNormal from "@eztree/app/public/dirt_normal.jpg?url";
import grassGlb from "@eztree/app/public/grass.glb?url";
import flowerWhite from "@eztree/app/public/flower_white.glb?url";
import flowerBlue from "@eztree/app/public/flower_blue.glb?url";
import flowerYellow from "@eztree/app/public/flower_yellow.glb?url";
import rock1 from "@eztree/app/public/rock1.glb?url";
import rock2 from "@eztree/app/public/rock2.glb?url";
import rock3 from "@eztree/app/public/rock3.glb?url";
import ambience from "@eztree/app/public/ambience.mp3?url";

const SIZE = 180;
const CLEARING = 15;
const POND = new Vector2(2, 25);
const POND_RADIUS = 8;
const WATER_Y = -0.45;

// ---- Terrain height field -------------------------------------------------------

function hash(x: number, y: number): number {
    const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return h - Math.floor(h);
}

function valueNoise(x: number, y: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi);
    const b = hash(xi + 1, yi);
    const c = hash(xi, yi + 1);
    const d = hash(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x: number, y: number, octaves = 5): number {
    let sum = 0;
    let amp = 0.5;
    let f = 1;
    for (let i = 0; i < octaves; i++) {
        sum += amp * (valueNoise(x * f, y * f) * 2 - 1);
        amp *= 0.5;
        f *= 2.03;
    }
    return sum;
}

const smoothstep = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
};

/** Rolling hills, a perfectly flat clearing at the origin, and a pond basin. */
export function terrainHeight(x: number, z: number): number {
    const hills = fbm(x * 0.022, z * 0.022) * 9 + fbm(x * 0.09 + 7, z * 0.09) * 0.8;
    const d = Math.hypot(x, z);
    let h = hills * smoothstep(CLEARING, CLEARING + 14, d);
    // Rise towards the edges so the world feels enclosed.
    h += smoothstep(55, 88, d) * 14;
    const dp = Math.hypot(x - POND.x, z - POND.y);
    const basin = 1 - smoothstep(POND_RADIUS * 0.45, POND_RADIUS * 1.25, dp);
    return h * (1 - basin) + -1.4 * basin;
}

// ---- Helpers ---------------------------------------------------------------------

function rng(seed: number): () => number {
    return () => {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function tex(url: string, scene: Scene, scale = 1, srgb = true): Texture {
    const t = new Texture(url, scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
    t.uScale = t.vScale = scale;
    t.anisotropicFilteringLevel = 8;
    if (!srgb) t.gammaSpace = false;
    return t;
}

const hexColor = (hex: number) => Color3.FromHexString("#" + hex.toString(16).padStart(6, "0")).toLinearSpace();

function staticBody(scene: Scene, mesh: Mesh, type: PhysicsShapeType): void {
    const agg = new PhysicsAggregate(mesh, type, { mass: 0, friction: 0.9, restitution: 0.05 }, scene);
    agg.shape.filterMembershipMask = Layer.STATIC;
    agg.shape.filterCollideMask = ALL_LAYERS;
}

// ---- Trees -------------------------------------------------------------------------

interface Species {
    name: string;
    preset: TreePreset;
    bark: { color: string; normal: string; rough: string; ao: string };
    leaves: string;
    height: [number, number];
    /** Share of placed trees using this species. */
    weight: number;
    bush?: boolean;
}

const SPECIES: Species[] = [
    { name: "oak", preset: oakLarge as TreePreset, bark: { color: oakColor, normal: oakNormal, rough: oakRough, ao: oakAo }, leaves: oakLeaves, height: [13, 19], weight: 3 },
    { name: "ash", preset: ashLarge as TreePreset, bark: { color: oakColor, normal: oakNormal, rough: oakRough, ao: oakAo }, leaves: ashLeaves, height: [14, 21], weight: 2 },
    { name: "pine", preset: pineLarge as TreePreset, bark: { color: pineColor, normal: pineNormal, rough: pineRough, ao: pineAo }, leaves: pineLeaves, height: [18, 27], weight: 3 },
    { name: "aspen", preset: aspenMedium as TreePreset, bark: { color: birchColor, normal: birchNormal, rough: birchRough, ao: birchAo }, leaves: aspenLeaves, height: [10, 15], weight: 2 },
    { name: "bush1", preset: bush1 as TreePreset, bark: { color: oakColor, normal: oakNormal, rough: oakRough, ao: oakAo }, leaves: ashLeaves, height: [1.4, 2.4], weight: 3, bush: true },
    { name: "bush2", preset: bush2 as TreePreset, bark: { color: oakColor, normal: oakNormal, rough: oakRough, ao: oakAo }, leaves: aspenLeaves, height: [1.2, 2.0], weight: 2, bush: true },
];

interface TreeMeshes {
    bark: Mesh;
    leaves: Mesh;
    height: number;
    trunkRadius: number;
}

function buildTreeMeshes(scene: Scene, s: Species, detail: number, suffix: string): TreeMeshes {
    const geo = generateTree(s.preset, detail);
    const bark = new Mesh(`${s.name}Bark${suffix}`, scene);
    const b = toBabylon(geo.branches);
    const vb = new VertexData();
    vb.positions = b.positions;
    vb.normals = b.normals;
    vb.uvs = b.uvs;
    vb.indices = b.indices;
    vb.applyToMesh(bark);

    const leaves = new Mesh(`${s.name}Leaves${suffix}`, scene);
    const l = toBabylon(geo.leaves);
    const vl = new VertexData();
    vl.positions = l.positions;
    vl.normals = l.normals;
    vl.uvs = l.uvs;
    vl.indices = l.indices;
    vl.applyToMesh(leaves);

    const bb = bark.getBoundingInfo().boundingBox;
    const lb = leaves.getBoundingInfo().boundingBox;
    const height = Math.max(bb.maximum.y, lb.maximum.y) - Math.min(bb.minimum.y, 0);
    return { bark, leaves, height, trunkRadius: geo.trunkRadius };
}

function barkMaterial(scene: Scene, s: Species): PBRMaterial {
    const { x, y } = s.preset.bark.textureScale;
    const m = new PBRMaterial(`${s.name}BarkMat`, scene);
    m.albedoTexture = tex(s.bark.color, scene);
    m.bumpTexture = tex(s.bark.normal, scene, 1, false);
    m.metallicTexture = tex(s.bark.rough, scene, 1, false);
    m.ambientTexture = tex(s.bark.ao, scene, 1, false);
    for (const t of [m.albedoTexture, m.bumpTexture, m.metallicTexture, m.ambientTexture] as Texture[]) {
        t.uScale = x;
        t.vScale = y;
    }
    m.useRoughnessFromMetallicTextureGreen = true;
    m.useMetallnessFromMetallicTextureBlue = false;
    m.useRoughnessFromMetallicTextureAlpha = false;
    m.metallic = 0;
    m.roughness = 1;
    m.albedoColor = hexColor(s.preset.bark.tint);
    return m;
}

function leafMaterial(scene: Scene, s: Species): PBRMaterial {
    const m = new PBRMaterial(`${s.name}LeafMat`, scene);
    const t = tex(s.leaves, scene);
    t.hasAlpha = true;
    m.albedoTexture = t;
    m.useAlphaFromAlbedoTexture = true;
    m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST;
    m.alphaCutOff = s.preset.leaves.alphaTest;
    m.albedoColor = hexColor(s.preset.leaves.tint);
    m.metallic = 0;
    m.roughness = 0.65;
    m.backFaceCulling = false;
    m.twoSidedLighting = true;
    // Sunlight glowing through the leaves.
    m.subSurface.isTranslucencyEnabled = true;
    m.subSurface.translucencyIntensity = 0.8;
    m.subSurface.tintColor = new Color3(0.55, 0.85, 0.25);
    m.environmentIntensity = 0.8;
    new WindPlugin(m, s.bush ? 0.06 : 0.35, s.bush ? 2 : 18);
    return m;
}

// ---- Location ------------------------------------------------------------------------

export async function createForest(scene: Scene, quality: Quality, onProgress: ProgressFn): Promise<Environment> {
    const mobile = quality === "mobile";
    const random = rng(4242);

    onProgress(0.05, "Loading forest sky…");
    const hdrUrl = await resolveAsset(Assets.forestHdr.local, Assets.forestHdr.remote);
    const env = await new Promise<HDRCubeTexture>((resolve, reject) => {
        const t: HDRCubeTexture = new HDRCubeTexture(hdrUrl, scene, tier(quality, 512, 256, 256), false, true, false, true, () => resolve(t), (m) => reject(new Error(m)));
    });
    env.rotationY = Math.PI * 0.6;
    scene.environmentTexture = env;
    scene.environmentIntensity = 0.85;
    const skybox = createSkybox(scene, env, 0.0);

    // Atmospheric depth: exponential fog tinted to the sky.
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogDensity = 0.011;
    scene.fogColor = new Color3(0.56, 0.64, 0.6);

    const { sun, shadows, sunMesh } = createSun(scene, new Vector3(-0.42, -0.72, 0.55), 7.5, quality, 70);
    shadows.lambda = 0.9;
    const addShadowCaster = addShadowCasterFn(shadows);

    // ---- Terrain ----------------------------------------------------------------
    onProgress(0.15, "Sculpting terrain…");
    const terrain = MeshBuilder.CreateGround("terrain", { width: SIZE, height: SIZE, subdivisions: tier(quality, 220, 160, 120), updatable: true }, scene);
    const pos = terrain.getVerticesData("position")!;
    for (let i = 0; i < pos.length; i += 3) pos[i + 1] = terrainHeight(pos[i], pos[i + 2]);
    terrain.updateVerticesData("position", pos);
    const normals: number[] = [];
    VertexData.ComputeNormals(pos, terrain.getIndices()!, normals);
    terrain.updateVerticesData("normal", normals);
    terrain.refreshBoundingInfo();
    terrain.receiveShadows = true;
    terrain.freezeWorldMatrix();

    // Grass/dirt blend in the shader: steep slopes and the muddy pond shore turn to dirt.
    const ground = new PBRCustomMaterial("terrainMat", scene);
    ground.albedoTexture = tex(grassJpg, scene, SIZE / 3.5);
    ground.bumpTexture = tex(dirtNormal, scene, SIZE / 4, false);
    ground.bumpTexture.level = 0.6;
    ground.metallic = 0;
    ground.roughness = 0.92;
    ground.environmentIntensity = 0.7;
    const dirt = tex(dirtColor, scene, SIZE / 4);
    ground.AddUniform("dirtSampler", "sampler2D", dirt);
    ground.AddUniform("pondInfo", "vec4", new Vector3(POND.x, POND.y, POND_RADIUS));
    ground.Fragment_Custom_Albedo(`
        vec3 dirtCol = toLinearSpace(texture2D(dirtSampler, vAlbedoUV * 1.14).rgb);
        float slope = 1.0 - normalize(vNormalW).y;
        float shore = 1.0 - smoothstep(pondInfo.z * 0.9, pondInfo.z * 1.35, distance(vPositionW.xz, pondInfo.xy));
        float patches = smoothstep(0.55, 0.75, texture2D(dirtSampler, vPositionW.xz * 0.013).g);
        float dirtMask = clamp(smoothstep(0.12, 0.3, slope) + shore + patches * 0.5, 0.0, 1.0);
        surfaceAlbedo = mix(surfaceAlbedo, dirtCol, dirtMask);
    `);
    terrain.material = ground;
    staticBody(scene, terrain, PhysicsShapeType.MESH);

    // ---- Water ------------------------------------------------------------------
    const pond = MeshBuilder.CreateGround("pond", { width: POND_RADIUS * 3, height: POND_RADIUS * 3, subdivisions: 32 }, scene);
    pond.position.set(POND.x, WATER_Y, POND.y);
    const water = new WaterMaterial("water", scene, new Vector2(mobile ? 256 : 512, mobile ? 256 : 512));
    water.bumpTexture = new Texture(await resolveAsset(Assets.waterBump.local, Assets.waterBump.remote), scene);
    water.windForce = -2;
    water.waveHeight = 0.02;
    water.bumpHeight = 0.06;
    water.waveLength = 0.1;
    water.waveSpeed = 20;
    water.windDirection = new Vector2(1, 0.6);
    water.waterColor = new Color3(0.05, 0.16, 0.13);
    water.colorBlendFactor = 0.3;
    water.backFaceCulling = true;
    pond.material = water;
    pond.isPickable = false;
    if (skybox) water.addToRenderList(skybox);
    water.addToRenderList(terrain);

    // ---- Trees ------------------------------------------------------------------
    onProgress(0.25, "Growing trees…");
    const placed: Array<{ x: number; z: number; r: number }> = [];
    const free = (x: number, z: number, r: number) => {
        if (Math.hypot(x, z) < CLEARING + r) return false;
        if (Math.hypot(x - POND.x, z - POND.y) < POND_RADIUS + 1.5 + r) return false;
        return placed.every((p) => Math.hypot(p.x - x, p.z - z) > (p.r + r) * 0.9);
    };
    const totalWeight = SPECIES.reduce((a, s) => a + s.weight, 0);
    const treeCount = tier(quality, 150, 95, 55);
    const nearRadius = 34;
    const trunkBodies = new TransformNode("trunkBodies", scene);

    for (let si = 0; si < SPECIES.length; si++) {
        const s = SPECIES[si];
        onProgress(0.25 + (0.3 * si) / SPECIES.length, `Growing ${s.name} trees…`);
        const barkMat = barkMaterial(scene, s);
        const leafMat = leafMaterial(scene, s);
        // Two detail levels: full geometry near the clearing, a lighter variant further out.
        // Bushes are dense in branches, so they get less geometry at every tier.
        const near = tier(quality, 1, 0.55, 0.4) * (s.bush ? 0.55 : 1);
        const far = tier(quality, 0.3, 0.2, 0.16) * (s.bush ? 0.7 : 1);
        const variants = [buildTreeMeshes(scene, s, near, "Near"), buildTreeMeshes(scene, s, far, "Far")];
        const matrices: [number[], number[]] = [[], []];
        const count = Math.round((treeCount * s.weight) / totalWeight) * (s.bush ? 1.4 : 1);
        for (let n = 0, tries = 0; n < count && tries < count * 40; tries++) {
            const angle = random() * Math.PI * 2;
            const dist = (s.bush ? CLEARING - 1.5 : CLEARING + 2) + Math.pow(random(), 0.8) * (s.bush ? 40 : 66);
            const x = Math.cos(angle) * dist;
            const z = Math.sin(angle) * dist;
            const h = s.height[0] + random() * (s.height[1] - s.height[0]);
            const scale = h / variants[0].height;
            const r = s.bush ? 1 : Math.max(1.6, variants[0].trunkRadius * scale * 3);
            if (!s.bush && !free(x, z, r)) continue;
            if (s.bush && (Math.hypot(x, z) < CLEARING - 2 || Math.hypot(x - POND.x, z - POND.y) < POND_RADIUS + 1)) continue;
            placed.push({ x, z, r });
            n++;
            const y = terrainHeight(x, z) - 0.15 * scale;
            const m = Matrix.Compose(new Vector3(scale, scale, scale), Quaternion.RotationAxis(Vector3.Up(), random() * Math.PI * 2), new Vector3(x, y, z));
            const lod = Math.hypot(x, z) < nearRadius ? 0 : 1;
            m.copyToArray(matrices[lod], matrices[lod].length);

            if (!s.bush) {
                // Static trunk collider.
                const node = new TransformNode("trunk", scene);
                node.parent = trunkBodies;
                node.position.set(x, y, z);
                const trunkR = variants[0].trunkRadius * scale * 0.85;
                const body = new PhysicsBody(node, PhysicsMotionType.STATIC, false, scene);
                const shape = new PhysicsShapeCylinder(new Vector3(0, 0, 0), new Vector3(0, Math.min(h * 0.6, 8), 0), trunkR, scene);
                shape.filterMembershipMask = Layer.STATIC;
                shape.filterCollideMask = ALL_LAYERS;
                body.shape = shape;
            }
        }
        variants.forEach((v, lod) => {
            v.bark.material = barkMat;
            v.leaves.material = leafMat;
            if (matrices[lod].length === 0) {
                v.bark.dispose();
                v.leaves.dispose();
                return;
            }
            for (const mesh of [v.bark, v.leaves]) {
                mesh.thinInstanceSetBuffer("matrix", new Float32Array(matrices[lod]), 16, true);
                mesh.thinInstanceRefreshBoundingInfo(false);
                mesh.isPickable = false;
                mesh.receiveShadows = true;
                mesh.alwaysSelectAsActiveMesh = false;
                // Far trees don't need to cast into the (near-focused) shadow cascades.
                if (lod === 0 || quality === "high") shadows.addShadowCaster(mesh);
            }
            if (lod === 0 && !s.bush) {
                water.addToRenderList(v.bark);
                water.addToRenderList(v.leaves);
            }
        });
    }

    // ---- Ground cover: grass clumps and flowers (thin instances) -------------------------
    onProgress(0.6, "Planting grass and flowers…");
    const grassRes = await ImportMeshAsync(grassGlb, scene);
    const grass = grassRes.meshes.find((m) => m.getTotalVertices() > 0) as Mesh;
    grass.setParent(null);
    grass.bakeCurrentTransformIntoVertices();
    grassRes.meshes[0].dispose(false, false);
    const grassMat = grass.material as PBRMaterial;
    grassMat.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST;
    grassMat.alphaCutOff = 0.4;
    grassMat.useAlphaFromAlbedoTexture = true;
    grassMat.backFaceCulling = false;
    grassMat.twoSidedLighting = true;
    grassMat.albedoColor = new Color3(0.5, 0.68, 0.32);
    grassMat.environmentIntensity = 0.6;
    new WindPlugin(grassMat, 0.12, 0.6);
    const grassMatrices: number[] = [];
    const grassCount = tier(quality, 9000, 5000, 2500);
    for (let i = 0; i < grassCount; i++) {
        const angle = random() * Math.PI * 2;
        const dist = Math.sqrt(random()) * 48;
        const x = Math.cos(angle) * dist;
        const z = Math.sin(angle) * dist;
        // Sparse in the play area, dense around it, none in the pond.
        if (dist < CLEARING - 3 && random() > 0.18) continue;
        if (Math.hypot(x - POND.x, z - POND.y) < POND_RADIUS * 0.85) continue;
        const s = 0.22 + random() * 0.22;
        Matrix.Compose(new Vector3(s, s * (0.8 + random() * 0.5), s), Quaternion.RotationAxis(Vector3.Up(), random() * 6.28), new Vector3(x, terrainHeight(x, z) - 0.02, z)).copyToArray(
            grassMatrices,
            grassMatrices.length,
        );
    }
    grass.thinInstanceSetBuffer("matrix", new Float32Array(grassMatrices), 16, true);
    grass.thinInstanceRefreshBoundingInfo(false);
    grass.isPickable = false;
    grass.receiveShadows = true;

    for (const [url, n] of [
        [flowerWhite, tier(quality, 140, 80, 40)],
        [flowerBlue, tier(quality, 140, 80, 40)],
        [flowerYellow, tier(quality, 140, 80, 40)],
    ] as const) {
        const res = await ImportMeshAsync(url, scene);
        const parts = res.meshes.filter((m) => m.getTotalVertices() > 0) as Mesh[];
        const flower = Mesh.MergeMeshes(parts, true, true, undefined, false, true)!;
        res.meshes[0].dispose();
        const { minimum: min, maximum: max } = flower.getBoundingInfo().boundingBox;
        const base = 0.35 / (max.y - min.y);
        const fm: number[] = [];
        for (let i = 0; i < n; i++) {
            const angle = random() * Math.PI * 2;
            const dist = CLEARING - 4 + random() * 30;
            const x = Math.cos(angle) * dist;
            const z = Math.sin(angle) * dist;
            if (Math.hypot(x - POND.x, z - POND.y) < POND_RADIUS) continue;
            const s = base * (0.7 + random() * 0.6);
            Matrix.Compose(new Vector3(s, s, s), Quaternion.RotationAxis(Vector3.Up(), random() * 6.28), new Vector3(x, terrainHeight(x, z) - min.y * s, z)).copyToArray(fm, fm.length);
        }
        flower.thinInstanceSetBuffer("matrix", new Float32Array(fm), 16, true);
        flower.thinInstanceRefreshBoundingInfo(false);
        flower.isPickable = false;
        flower.receiveShadows = true;
    }

    // ---- Rocks & boulders ---------------------------------------------------------------
    onProgress(0.7, "Placing boulders…");
    const rockSources: Mesh[] = [];
    for (const url of [rock1, rock2, rock3]) {
        const res = await ImportMeshAsync(url, scene);
        const rock = res.meshes.find((m) => m.getTotalVertices() > 0) as Mesh;
        rock.setParent(null);
        rock.bakeCurrentTransformIntoVertices();
        res.meshes[0].dispose(false, false);
        rock.setEnabled(false);
        rockSources.push(rock);
    }
    const rocks: Mesh[] = [];
    /** `size` is the rock's approximate diameter in metres. */
    const placeRock = (x: number, z: number, size: number, sink = 0.25) => {
        const src = rockSources[Math.floor(random() * rockSources.length)];
        const rock = src.clone(`rock${rocks.length}`)!;
        rock.setEnabled(true);
        rock.makeGeometryUnique();
        const ext = src.getBoundingInfo().boundingBox.extendSize;
        rock.scaling.setAll(size / (2 * Math.max(ext.x, ext.z)));
        rock.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), random() * 6.28);
        rock.computeWorldMatrix(true);
        const minY = rock.getBoundingInfo().boundingBox.minimumWorld.y;
        rock.position.set(x, terrainHeight(x, z) - minY - (rock.getBoundingInfo().boundingBox.extendSizeWorld.y * 2) * sink, z);
        rock.bakeCurrentTransformIntoVertices();
        rock.receiveShadows = true;
        addShadowCaster(rock);
        staticBody(scene, rock, PhysicsShapeType.CONVEX_HULL);
        rock.freezeWorldMatrix();
        rocks.push(rock);
    };
    // Climbable boulders at the clearing edge, then scattered rocks through the woods.
    placeRock(11.5, -6, 2.6, 0.3);
    placeRock(12.8, -3.4, 1.6, 0.3);
    placeRock(-11.5, 8.5, 3.0, 0.35);
    placeRock(-6.5, -12.5, 1.8, 0.3);
    for (let i = 0, tries = 0; i < tier(quality, 30, 20, 14) && tries < 400; tries++) {
        const angle = random() * Math.PI * 2;
        const dist = CLEARING + 2 + random() * 55;
        const x = Math.cos(angle) * dist;
        const z = Math.sin(angle) * dist;
        if (!free(x, z, 1.2)) continue;
        placed.push({ x, z, r: 1.2 });
        placeRock(x, z, 0.8 + random() * 3);
        i++;
    }
    rocks.slice(0, 6).forEach((r) => water.addToRenderList(r));

    // ---- Fireflies & floating pollen ------------------------------------------------------
    const dot = new DynamicTexture("glowDot", 64, scene, false);
    const ctx = dot.getContext();
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.25, "rgba(255,255,220,0.8)");
    grad.addColorStop(1, "rgba(255,255,200,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    dot.update();
    dot.hasAlpha = true;

    const useGpu = GPUParticleSystem.IsSupported && quality === "high";
    const fireflies = useGpu ? new GPUParticleSystem("fireflies", { capacity: 900 }, scene) : new ParticleSystem("fireflies", mobile ? 250 : 600, scene);
    fireflies.particleTexture = dot;
    fireflies.emitter = new Vector3(0, 1.2, 0);
    fireflies.minEmitBox = new Vector3(-28, -0.8, -28);
    fireflies.maxEmitBox = new Vector3(28, 2.5, 28);
    fireflies.color1 = new Color4(0.85, 1, 0.45, 1);
    fireflies.color2 = new Color4(1, 0.85, 0.35, 1);
    fireflies.colorDead = new Color4(0.3, 0.5, 0.1, 0);
    fireflies.minSize = 0.03;
    fireflies.maxSize = 0.08;
    fireflies.minLifeTime = 4;
    fireflies.maxLifeTime = 9;
    fireflies.emitRate = useGpu ? 120 : 50;
    fireflies.blendMode = ParticleSystem.BLENDMODE_ADD;
    fireflies.gravity = new Vector3(0, 0.02, 0);
    fireflies.direction1 = new Vector3(-0.15, -0.05, -0.15);
    fireflies.direction2 = new Vector3(0.15, 0.1, 0.15);
    fireflies.minEmitPower = 0.2;
    fireflies.maxEmitPower = 0.5;
    const noise = new NoiseProceduralTexture("fireflyNoise", 128, scene);
    noise.animationSpeedFactor = 2;
    noise.brightness = 0.5;
    noise.octaves = 3;
    fireflies.noiseTexture = noise;
    fireflies.noiseStrength = new Vector3(0.6, 0.3, 0.6);
    fireflies.preWarmCycles = 200;
    fireflies.start();

    // ---- Reflection probe: what glass props refract and reflect -------------------------
    const probeMeshes: AbstractMesh[] = [terrain, ...rocks.slice(0, 8)];
    if (skybox) probeMeshes.push(skybox);
    const probe = createProbe(scene, new Vector3(0, 1.4, -2), quality, probeMeshes);

    onProgress(0.75, "Arranging the playground…");
    return {
        id: "forest",
        sun,
        sunMesh,
        shadows,
        probe,
        skybox,
        floorY: 0,
        exposure: 1.05,
        ambience,
        spawn: new Vector3(0, 0, -10),
        lookAt: new Vector3(0, 0, 10),
        addShadowCaster,
        water: {
            setEnabled(on) {
                for (const rtt of [water.reflectionTexture, water.refractionTexture]) if (rtt) rtt.refreshRate = on ? 1 : 0;
            },
        },
        populate(props) {
            const at = (x: number, z: number, hx: number, hz: number) => props.groundAt(x, z, hx, hz);
            props.buildShowcase(at(-3.5, -4.5, 1.6, 0.25));
            props.buildBlockTower(at(2.5, -3, 0.65, 0.65), 4, 0.32);
            props.buildBlockTower(at(4.6, 0.6, 0.6, 0.6), 3, 0.4);
            props.buildBrickWall(at(-6.5, 3, 0.15, 1.3), 6, 5);
            props.buildDominoes(at(-4.5, 7, 0.1, 0.3), 15);
            props.buildHeavyCrates(at(-1.5, 2.2, 0.9, 0.35));
            props.buildParkour(at(3.5, 6, 0.5, 0.5));
            props.buildCrouchTunnel(at(-9.5, -3, 1.2, 0.8));
            props.buildLog(at(1.5, -7.5, 1.6, 0.3), barkLog(scene));
        },
    };
}

/** Oak-bark material reused for the pushable fallen log. */
function barkLog(scene: Scene): PBRMaterial {
    return barkMaterial(scene, { ...SPECIES[0], preset: { ...SPECIES[0].preset, bark: { ...SPECIES[0].preset.bark, textureScale: { x: 2, y: 3 } } } });
}
