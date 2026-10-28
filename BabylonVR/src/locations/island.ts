import {
    type AbstractMesh,
    Color3,
    DynamicTexture,
    ImportMeshAsync,
    Matrix,
    Mesh,
    MeshBuilder,
    PBRMaterial,
    PhysicsAggregate,
    PhysicsBody,
    PhysicsMotionType,
    PhysicsShapeCapsule,
    PhysicsShapeType,
    Quaternion,
    type Scene,
    Texture,
    TransformNode,
    Vector3,
    VertexData,
} from "@babylonjs/core";
import { PBRCustomMaterial } from "@babylonjs/materials";
import "@babylonjs/loaders/glTF";
import { ALL_LAYERS, Assets, Layer } from "../config";
import { addShadowCasterFn, createProbe, createSun, type Environment, type ProgressFn, type Quality, resolveAsset, tier } from "../environment";
import { WindPlugin } from "../forest/wind";
import { Ocean } from "../island/ocean";
import { buildPalm } from "../island/palm";
import { createSky } from "../island/sky";

import pineColor from "@eztree/lib/assets/bark/pine_color_1k.jpg?url";
import pineNormal from "@eztree/lib/assets/bark/pine_normal_1k.jpg?url";
import grassJpg from "@eztree/app/public/grass.jpg?url";
import grassGlb from "@eztree/app/public/grass.glb?url";
import rock1 from "@eztree/app/public/rock1.glb?url";
import rock2 from "@eztree/app/public/rock2.glb?url";
import rock3 from "@eztree/app/public/rock3.glb?url";

const HILL = { x: 0, z: -22 };
const PLATEAU = { x: 0, z: 12, r: 13, y: 1.6 };
const PIER = { x: 3.5, z0: 22, z1: 58, y: 1.35, w: 2.4 };
const SUN_DIR = new Vector3(-0.3, -0.62, -1).normalize();

// ---- Height field (water level is y = 0) ---------------------------------------------

function hash(x: number, y: number): number {
    const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return h - Math.floor(h);
}
function noise(x: number, y: number): number {
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
function fbm(x: number, y: number): number {
    let s = 0;
    let a = 0.5;
    for (let i = 0; i < 4; i++) {
        s += a * (noise(x, y) * 2 - 1);
        x *= 2.03;
        y *= 2.03;
        a *= 0.5;
    }
    return s;
}
const smoothstep = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
};

/** Island terrain: volcanic hill, flat beach terrace for the playground, sloping sea floor. */
export function islandHeight(x: number, z: number): number {
    const dx = x - HILL.x;
    const dz = z - HILL.z;
    const d = Math.hypot(dx, dz);
    const theta = Math.atan2(dz, dx);
    const coast = 58 + 7 * Math.sin(theta * 3 + 1) + 6 * fbm(Math.cos(theta) * 2 + 5, Math.sin(theta) * 2);
    const s = d / coast;
    const land = 1.6 + 8.5 * Math.pow(1 - smoothstep(0, 0.62, s), 1.6) + 0.5 * fbm(x * 0.06, z * 0.06) * (1 - smoothstep(0.6, 0.8, s));
    let h: number;
    if (s < 1) {
        h = land * (1 - smoothstep(0.72, 1.0, s)) + 0.0 * smoothstep(0.72, 1.0, s);
        h -= 0.25 * smoothstep(0.92, 1.0, s);
    } else {
        const out = (s - 1) * coast;
        h = -0.25 - out * 0.16 - Math.pow(out, 1.35) * 0.025 + 0.25 * fbm(x * 0.15, z * 0.15);
        h = Math.max(h, -28);
    }
    // Flat terrace for the playground.
    const pd = Math.hypot(x - PLATEAU.x, z - PLATEAU.z);
    const flat = 1 - smoothstep(PLATEAU.r, PLATEAU.r + 6, pd);
    return h * (1 - flat) + PLATEAU.y * flat;
}

// ---- Location -------------------------------------------------------------------------

export async function createIsland(scene: Scene, quality: Quality, onProgress: ProgressFn): Promise<Environment> {
    const random = (() => {
        let seed = 9001;
        return () => {
            seed = (seed * 1664525 + 1013904223) >>> 0;
            return seed / 4294967296;
        };
    })();

    onProgress(0.05, "Painting the sky…");
    const { skybox, env } = await createSky(scene, SUN_DIR, quality);
    scene.environmentIntensity = 1;

    const { sun, shadows, sunMesh } = createSun(scene, SUN_DIR.clone(), 6.5, quality, 60);
    sun.diffuse = new Color3(1, 0.88, 0.72);
    const addShadowCaster = addShadowCasterFn(shadows);

    // ---- Terrain -------------------------------------------------------------------
    onProgress(0.15, "Raising the island…");
    const SIZE = 260;
    const terrain = MeshBuilder.CreateGround("island", { width: SIZE, height: SIZE, subdivisions: tier(quality, 260, 200, 150), updatable: true }, scene);
    const pos = terrain.getVerticesData("position")!;
    for (let i = 0; i < pos.length; i += 3) pos[i + 1] = islandHeight(pos[i], pos[i + 2]);
    terrain.updateVerticesData("position", pos);
    const normals: number[] = [];
    VertexData.ComputeNormals(pos, terrain.getIndices()!, normals);
    terrain.updateVerticesData("normal", normals);
    terrain.refreshBoundingInfo();
    terrain.receiveShadows = true;
    terrain.freezeWorldMatrix();

    const tex = (url: string, scale: number, srgb = true) => {
        const t = new Texture(url, scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
        t.uScale = t.vScale = scale;
        t.anisotropicFilteringLevel = 8;
        if (!srgb) t.gammaSpace = false;
        return t;
    };
    const [sandUrl, rockUrl, rockNUrl] = await Promise.all([
        resolveAsset(Assets.sand.local, Assets.sand.remote),
        resolveAsset(Assets.rockColor.local, Assets.rockColor.remote),
        resolveAsset(Assets.rockNormal.local, Assets.rockNormal.remote),
    ]);
    // Sand / grass / rock blend with a wet line, and animated caustics under the water.
    const ground = new PBRCustomMaterial("islandMat", scene);
    ground.albedoTexture = tex(sandUrl, SIZE / 3);
    ground.bumpTexture = tex(rockNUrl, SIZE / 6, false);
    ground.bumpTexture.level = 0.35;
    ground.metallic = 0;
    ground.roughness = 0.9;
    ground.AddUniform("grassSampler", "sampler2D", tex(grassJpg, SIZE / 3.5));
    ground.AddUniform("rockSampler", "sampler2D", tex(rockUrl, SIZE / 8));
    ground.AddUniform("time", "float", 0);
    ground.AddUniform("sunDirW", "vec3", SUN_DIR);
    ground.Fragment_Custom_Albedo(`
        vec2 tuv = vAlbedoUV;
        float hgt = vPositionW.y;
        float slope = 1.0 - normalize(vNormalW).y;
        vec3 grassCol = toLinearSpace(texture2D(grassSampler, tuv * 1.17).rgb) * vec3(0.9, 1.0, 0.75);
        vec3 rockCol = toLinearSpace(texture2D(rockSampler, tuv * 0.42).rgb);
        float patchy = texture2D(rockSampler, vPositionW.xz * 0.011).g;
        float grassMask = smoothstep(2.2, 3.2, hgt + patchy * 1.5) * (1.0 - smoothstep(0.3, 0.5, slope));
        float rockMask = smoothstep(0.38, 0.6, slope);
        vec3 col = surfaceAlbedo;
        col = mix(col, grassCol, grassMask);
        col = mix(col, rockCol, rockMask);
        // Wet sand along the waterline, darker and more saturated.
        float wet = 1.0 - smoothstep(0.05, 0.45, hgt);
        col *= mix(vec3(1.0), vec3(0.62, 0.58, 0.52), wet);
        surfaceAlbedo = col;
    `);
    ground.Fragment_Before_FragColor(`
        if (vPositionW.y < 0.05) {
            float d = clamp(-vPositionW.y, 0.0, 30.0);
            vec2 p = vPositionW.xz * 0.55;
            float c = 0.0;
            vec2 q = p;
            for (int i = 0; i < 3; i++) {
                q += vec2(sin(q.y * 1.7 + time * 0.9 + float(i)), cos(q.x * 1.3 - time * 0.7 + float(i) * 1.7)) * 0.45;
                c += abs(sin(q.x + q.y));
            }
            float caustic = pow(1.0 - c / 3.0, 5.0) * 3.5;
            float sunAmt = max(-sunDirW.y, 0.0);
            vec3 absorb = exp(-d * vec3(0.45, 0.09, 0.07));
            finalColor.rgb = finalColor.rgb * mix(vec3(1.0), absorb * vec3(0.75, 1.0, 1.0), smoothstep(0.0, 0.4, d))
                           + vec3(0.7, 0.95, 1.0) * caustic * sunAmt * exp(-d * 0.18) * smoothstep(0.0, 0.25, d);
        }
    `);
    let causticTime = 0;
    scene.onBeforeRenderObservable.add(() => (causticTime += scene.deltaTime / 1000));
    ground.onBindObservable.add(() => ground.getEffect()?.setFloat("time", causticTime));
    terrain.material = ground;
    const tAgg = new PhysicsAggregate(terrain, PhysicsShapeType.MESH, { mass: 0, friction: 0.9, restitution: 0.05 }, scene);
    tAgg.shape.filterMembershipMask = Layer.STATIC;
    tAgg.shape.filterCollideMask = ALL_LAYERS;

    // ---- Ocean -----------------------------------------------------------------------------
    onProgress(0.3, "Filling the ocean…");
    const ocean = new Ocean(scene, {
        quality,
        seabedAt: islandHeight,
        seabed: { minX: -SIZE / 2, minZ: -SIZE / 2, size: SIZE },
        sunDirection: SUN_DIR,
        sunColor: new Color3(1, 0.86, 0.68).scale(5),
        env,
    });

    // ---- Palms ---------------------------------------------------------------------------------
    onProgress(0.45, "Planting palm trees…");
    const barkMat = new PBRMaterial("palmBark", scene);
    barkMat.albedoTexture = tex(pineColor, 1);
    (barkMat.albedoTexture as Texture).uScale = 2;
    barkMat.bumpTexture = tex(pineNormal, 1, false);
    (barkMat.bumpTexture as Texture).uScale = 2;
    barkMat.albedoColor = new Color3(0.95, 0.82, 0.66);
    barkMat.roughness = 0.9;
    barkMat.metallic = 0;
    const frondMat = new PBRMaterial("palmFronds", scene);
    frondMat.metallic = 0;
    frondMat.roughness = 0.55;
    frondMat.backFaceCulling = false;
    frondMat.twoSidedLighting = true;
    frondMat.subSurface.isTranslucencyEnabled = true;
    frondMat.subSurface.translucencyIntensity = 0.9;
    frondMat.subSurface.tintColor = new Color3(0.6, 0.9, 0.2);
    new WindPlugin(frondMat, 0.22, 9);
    const nutMat = new PBRMaterial("coconutMat", scene);
    nutMat.metallic = 0;
    nutMat.roughness = 0.75;

    const detail = tier(quality, 1, 0.7, 0.5);
    const variants = [0, 1, 2, 3].map((i) => buildPalm(scene, `palm${i}`, 17 + i * 31, 7 + i * 1.2, detail));
    const palmMatrices: number[][] = variants.map(() => []);
    const palmSpots: Array<{ x: number; z: number }> = [];
    const palmCount = tier(quality, 46, 34, 22);
    for (let n = 0, tries = 0; n < palmCount && tries < 2000; tries++) {
        const a = random() * Math.PI * 2;
        const dist = 18 + random() * 44;
        const x = HILL.x + Math.cos(a) * dist;
        const z = HILL.z + Math.sin(a) * dist;
        const h = islandHeight(x, z);
        if (h < 0.5 || h > 7) continue;
        if (Math.hypot(x - PLATEAU.x, z - PLATEAU.z) < PLATEAU.r + 1.5) continue;
        if (Math.abs(x - PIER.x) < 4 && z > PIER.z0 - 4) continue;
        if (palmSpots.some((p) => Math.hypot(p.x - x, p.z - z) < 4.5)) continue;
        palmSpots.push({ x, z });
        const vi = Math.floor(random() * variants.length);
        const s = 0.85 + random() * 0.3;
        const yaw = random() * Math.PI * 2;
        Matrix.Compose(new Vector3(s, s, s), Quaternion.RotationAxis(Vector3.Up(), yaw), new Vector3(x, h - 0.1, z)).copyToArray(palmMatrices[vi], palmMatrices[vi].length);
        n++;
        // Trunk collider (capsule up the lower trunk).
        const v = variants[vi];
        const top = Vector3.TransformCoordinates(v.crown.scale(0.45), Matrix.RotationY(yaw)).scaleInPlace(s);
        const body = new PhysicsBody(new TransformNode(`palmBody${n}`, scene), PhysicsMotionType.STATIC, false, scene);
        body.transformNode.position.set(x, h, z);
        const shape = new PhysicsShapeCapsule(new Vector3(0, 0.3, 0), top, v.trunkRadius * s * 1.1, scene);
        shape.filterMembershipMask = Layer.STATIC;
        shape.filterCollideMask = ALL_LAYERS;
        body.shape = shape;
    }
    variants.forEach((v, i) => {
        v.trunk.material = barkMat;
        v.fronds.material = frondMat;
        v.coconuts.material = nutMat;
        for (const mesh of [v.trunk, v.fronds, v.coconuts]) {
            mesh.thinInstanceSetBuffer("matrix", new Float32Array(palmMatrices[i]), 16, true);
            mesh.thinInstanceRefreshBoundingInfo(false);
            mesh.isPickable = false;
            mesh.receiveShadows = true;
            shadows.addShadowCaster(mesh);
        }
    });

    // ---- Grass tufts on the hill and rocks along the shore ---------------------------------
    onProgress(0.55, "Scattering rocks and grass…");
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
    grassMat.albedoColor = new Color3(0.62, 0.66, 0.3);
    new WindPlugin(grassMat, 0.12, 0.6);
    const gm: number[] = [];
    for (let i = 0, n = tier(quality, 3500, 2200, 1100); i < n; i++) {
        const x = HILL.x + (random() * 2 - 1) * 55;
        const z = HILL.z + (random() * 2 - 1) * 55;
        const h = islandHeight(x, z);
        if (h < 2.0 + random() * 1.5 || Math.hypot(x - PLATEAU.x, z - PLATEAU.z) < PLATEAU.r + 2) continue;
        const s = 0.3 + random() * 0.3;
        Matrix.Compose(new Vector3(s, s, s), Quaternion.RotationAxis(Vector3.Up(), random() * 6.28), new Vector3(x, h - 0.02, z)).copyToArray(gm, gm.length);
    }
    grass.thinInstanceSetBuffer("matrix", new Float32Array(gm), 16, true);
    grass.thinInstanceRefreshBoundingInfo(false);
    grass.isPickable = false;

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
    const rocks: AbstractMesh[] = [];
    for (let i = 0, tries = 0; i < tier(quality, 22, 16, 10) && tries < 500; tries++) {
        const a = random() * Math.PI * 2;
        const dist = 52 + random() * 18;
        const x = HILL.x + Math.cos(a) * dist;
        const z = HILL.z + Math.sin(a) * dist;
        const h = islandHeight(x, z);
        // Keep the beach in front of the playground and the pier clear.
        if (h > 1 || h < -2.5 || (Math.abs(x - PIER.x) < 6 && z > PIER.z0 - 4) || Math.hypot(x - PLATEAU.x, z - PLATEAU.z) < PLATEAU.r + 14) continue;
        const src = rockSources[i % rockSources.length];
        const rock = src.clone(`shoreRock${i}`)!;
        rock.setEnabled(true);
        rock.makeGeometryUnique();
        const ext = src.getBoundingInfo().boundingBox.extendSize;
        const size = 0.8 + random() * 1.8;
        rock.scaling.setAll(size / (2 * Math.max(ext.x, ext.z)));
        rock.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), random() * 6.28);
        rock.computeWorldMatrix(true);
        rock.position.set(x, h - rock.getBoundingInfo().boundingBox.minimumWorld.y - size * 0.15, z);
        rock.bakeCurrentTransformIntoVertices();
        addShadowCaster(rock);
        const agg = new PhysicsAggregate(rock, PhysicsShapeType.CONVEX_HULL, { mass: 0 }, scene);
        agg.shape.filterMembershipMask = Layer.STATIC;
        agg.shape.filterCollideMask = ALL_LAYERS;
        rock.freezeWorldMatrix();
        rocks.push(rock);
        i++;
    }

    // ---- Wooden pier ------------------------------------------------------------------------
    onProgress(0.65, "Building the pier…");
    const planks = woodTexture(scene);
    const woodMat = new PBRMaterial("pierWood", scene);
    woodMat.albedoTexture = planks;
    woodMat.metallic = 0;
    woodMat.roughness = 0.8;
    const deckLen = PIER.z1 - PIER.z0;
    const deck = MeshBuilder.CreateBox("pierDeck", { width: PIER.w, height: 0.14, depth: deckLen }, scene);
    deck.position.set(PIER.x, PIER.y, (PIER.z0 + PIER.z1) / 2);
    planks.uScale = 1;
    planks.vScale = deckLen / 2.4;
    deck.material = woodMat;
    addShadowCaster(deck);
    const deckAgg = new PhysicsAggregate(deck, PhysicsShapeType.BOX, { mass: 0, friction: 0.9 }, scene);
    deckAgg.shape.filterMembershipMask = Layer.STATIC;
    deckAgg.shape.filterCollideMask = ALL_LAYERS;
    const postMat = new PBRMaterial("pierPosts", scene);
    postMat.albedoColor = new Color3(0.22, 0.15, 0.09);
    postMat.roughness = 0.9;
    postMat.metallic = 0;
    for (let z = PIER.z0 + 2; z <= PIER.z1; z += 4) {
        for (const side of [-1, 1]) {
            const x = PIER.x + side * (PIER.w / 2 - 0.1);
            const bottom = islandHeight(x, z) - 0.5;
            const h = PIER.y - bottom + 0.4;
            const post = MeshBuilder.CreateCylinder("pierPost", { height: h, diameter: 0.22, tessellation: 10 }, scene);
            post.position.set(x, bottom + h / 2, z);
            post.material = postMat;
            addShadowCaster(post);
            const agg = new PhysicsAggregate(post, PhysicsShapeType.CYLINDER, { mass: 0 }, scene);
            agg.shape.filterMembershipMask = Layer.STATIC;
            agg.shape.filterCollideMask = ALL_LAYERS;
        }
    }

    const probe = createProbe(scene, new Vector3(0, PLATEAU.y + 1.4, PLATEAU.z), quality, [skybox, terrain, ocean.mesh, ...rocks.slice(0, 6)]);

    onProgress(0.75, "Arranging the playground…");
    return {
        id: "island",
        sun,
        sunMesh,
        shadows,
        probe,
        skybox,
        floorY: PLATEAU.y,
        exposure: 0.95,
        spawn: new Vector3(-5, PLATEAU.y, 21),
        lookAt: new Vector3(9, 0, 50),
        addShadowCaster,
        water: { setEnabled: (on) => ocean.setInteractive(on) },
        attachPlayer: (player) => ocean.bindPlayer(player),
        populate(props) {
            const at = (x: number, z: number, hx: number, hz: number) => props.groundAt(x, z, hx, hz);
            props.buildShowcase(at(-4.5, 5, 1.6, 0.25));
            props.buildBlockTower(at(4, 7, 0.65, 0.65), 4, 0.32);
            props.buildBlockTower(at(7, 11.5, 0.6, 0.6), 3, 0.4);
            props.buildBrickWall(at(-8.5, 13, 0.15, 1.3), 6, 5);
            props.buildDominoes(at(-6, 18, 0.1, 0.3), 15);
            props.buildHeavyCrates(at(1, 16.5, 0.9, 0.35));
            props.buildParkour(at(-3, 0, 0.5, 0.5));
            props.buildCrouchTunnel(at(8.5, 4, 1.2, 0.8));

            // Floating toys around the pier: everything here obeys buoyancy and drifts on the swell.
            const ballMat = new PBRMaterial("beachBall", scene);
            ballMat.albedoTexture = beachBallTexture(scene);
            ballMat.roughness = 0.35;
            ballMat.metallic = 0;
            ballMat.clearCoat.isEnabled = true;
            const ball = MeshBuilder.CreateSphere("beachBall", { diameter: 0.6, segments: 32 }, scene);
            ball.position.set(PIER.x - 3, 0.5, 34);
            props.dynamic(ball, PhysicsShapeType.SPHERE, 0.4, ballMat, { restitution: 0.7, friction: 0.4 });

            const ringMat = new PBRMaterial("ringMat", scene);
            ringMat.albedoColor = new Color3(0.95, 0.25, 0.1);
            ringMat.roughness = 0.3;
            ringMat.metallic = 0;
            ringMat.clearCoat.isEnabled = true;
            const ring = MeshBuilder.CreateTorus("swimRing", { diameter: 0.9, thickness: 0.22, tessellation: 40 }, scene);
            ring.position.set(PIER.x + 3, 0.4, 42);
            props.dynamic(ring, PhysicsShapeType.CONVEX_HULL, 0.8, ringMat, { restitution: 0.3 });

            const crateMat = new PBRMaterial("driftwood", scene);
            crateMat.albedoTexture = woodTexture(scene);
            crateMat.roughness = 0.85;
            crateMat.metallic = 0;
            for (let i = 0; i < 4; i++) {
                const c = MeshBuilder.CreateBox("driftCrate", { size: 0.5 }, scene);
                c.position.set(PIER.x - 4 + i * 2.6, 0.4, 46 + (i % 2) * 3);
                props.dynamic(c, PhysicsShapeType.BOX, 6, crateMat, { friction: 0.7 });
            }

            // Coconuts to pick up and throw (they float, like real ones).
            for (let i = 0; i < 8; i++) {
                const spot = palmSpots[i % palmSpots.length];
                const nut = MeshBuilder.CreateSphere("coconut", { diameter: 0.26, segments: 16 }, scene);
                nut.position.set(spot.x + 0.8 + random(), islandHeight(spot.x + 0.8, spot.z) + 0.3, spot.z + random());
                props.dynamic(nut, PhysicsShapeType.SPHERE, 1.2, coconutMaterial(scene), { restitution: 0.3 });
            }

            ocean.bindProps(props.grabbables);
        },
    };
}

let coconutMat: PBRMaterial | null = null;
function coconutMaterial(scene: Scene): PBRMaterial {
    if (coconutMat) return coconutMat;
    coconutMat = new PBRMaterial("coconut", scene);
    coconutMat.albedoColor = new Color3(0.28, 0.17, 0.08);
    coconutMat.roughness = 0.85;
    coconutMat.metallic = 0;
    coconutMat.sheen.isEnabled = true;
    coconutMat.sheen.color = new Color3(0.6, 0.45, 0.3);
    coconutMat.sheen.intensity = 0.4;
    return coconutMat;
}

/** Weathered deck planks, drawn procedurally. */
function woodTexture(scene: Scene): DynamicTexture {
    const t = new DynamicTexture("planks", { width: 512, height: 512 }, scene, true);
    const ctx = t.getContext() as CanvasRenderingContext2D;
    const plank = 512 / 5;
    for (let i = 0; i < 5; i++) {
        const tone = 120 + Math.floor(Math.random() * 30);
        ctx.fillStyle = `rgb(${tone}, ${Math.floor(tone * 0.78)}, ${Math.floor(tone * 0.58)})`;
        ctx.fillRect(i * plank, 0, plank, 512);
        for (let g = 0; g < 40; g++) {
            ctx.strokeStyle = `rgba(60, 40, 25, ${0.08 + Math.random() * 0.12})`;
            ctx.lineWidth = 1 + Math.random() * 2;
            ctx.beginPath();
            const x = i * plank + Math.random() * plank;
            ctx.moveTo(x, 0);
            ctx.bezierCurveTo(x + 6, 170, x - 6, 340, x + 3, 512);
            ctx.stroke();
        }
        ctx.fillStyle = "rgba(25, 15, 8, 0.9)";
        ctx.fillRect(i * plank, 0, 3, 512);
    }
    t.update();
    t.wrapU = t.wrapV = Texture.WRAP_ADDRESSMODE;
    return t;
}

function beachBallTexture(scene: Scene): DynamicTexture {
    const t = new DynamicTexture("beachBall", { width: 512, height: 256 }, scene, true);
    const ctx = t.getContext() as CanvasRenderingContext2D;
    const colors = ["#e63946", "#ffffff", "#1d78d6", "#ffd60a", "#ffffff", "#2a9d8f"];
    colors.forEach((c, i) => {
        ctx.fillStyle = c;
        ctx.fillRect((i * 512) / colors.length, 0, 512 / colors.length + 1, 256);
    });
    t.update();
    return t;
}
