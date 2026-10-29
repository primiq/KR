import { Color3, Mesh, type Scene, Texture, VertexBuffer, VertexData } from "@babylonjs/core";
import { PBRCustomMaterial } from "@babylonjs/materials";
import grassJpg from "@eztree/app/public/grass.jpg?url";
import { Assets } from "../../config";
import { resolveAsset } from "../../environment";
import { lerp, smoothstep } from "../core/noise";
import type { Quality } from "../core/quality";
import { heightAt, rockiness, TERRAIN_SIZE } from "./island";

/** Tiles per side: a building site only rebuilds the few tiles it touches, and tiles off-screen are culled. */
const TILES = 8;
const HALF = TERRAIN_SIZE / 2;

/** Ground height with the border skirt pulled down, so the edge of the map never shows through the sea. */
function skirtH(x: number, z: number): number {
    const e = Math.max(Math.abs(x), Math.abs(z)) / HALF;
    return lerp(heightAt(x, z), -90, smoothstep(0.94, 1.0, e));
}

/**
 * The island ground: Castaway's analytic height field meshed into tiles, shaded with real sand, grass and rock
 * textures blended by height, slope and Castaway's "rockiness" field, with wet sand at the waterline, a jungle
 * tint up the hills, light absorption under the water and animated caustics on the sea floor.
 */
export class Terrain {
    readonly tiles: Mesh[] = [];
    readonly material: PBRCustomMaterial;
    private readonly seg: number;
    private readonly step: number;
    private time = 0;

    constructor(
        private readonly scene: Scene,
        q: Quality,
        sunDir: { x: number; y: number; z: number },
    ) {
        this.seg = Math.round(q.terrainSegments / TILES);
        this.step = TERRAIN_SIZE / (this.seg * TILES);
        this.material = this.makeMaterial(sunDir);
        for (let tj = 0; tj < TILES; tj++) {
            for (let ti = 0; ti < TILES; ti++) {
                const m = new Mesh(`terrain${ti}_${tj}`, scene);
                this.build(m, ti, tj, true);
                m.material = this.material;
                m.receiveShadows = q.shadows;
                m.isPickable = false;
                m.freezeWorldMatrix();
                m.metadata = { ti, tj };
                this.tiles.push(m);
            }
        }
        scene.onBeforeRenderObservable.add(() => (this.time += scene.getEngine().getDeltaTime() / 1000));
    }

    /** Textures are fetched in the background; the ground shows plain colours until they arrive. */
    async loadTextures(): Promise<void> {
        const [sandUrl, rockUrl, rockNUrl] = await Promise.all([
            resolveAsset(Assets.sand.local, Assets.sand.remote),
            resolveAsset(Assets.rockColor.local, Assets.rockColor.remote),
            resolveAsset(Assets.rockNormal.local, Assets.rockNormal.remote),
        ]);
        const tex = (url: string, srgb = true) => {
            const t = new Texture(url, this.scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
            t.anisotropicFilteringLevel = 8;
            if (!srgb) t.gammaSpace = false;
            return t;
        };
        const m = this.material;
        const sand = tex(sandUrl);
        sand.uScale = sand.vScale = TERRAIN_SIZE / 3;
        m.albedoTexture = sand;
        const bump = tex(rockNUrl, false);
        bump.uScale = bump.vScale = TERRAIN_SIZE / 5;
        bump.level = 0.3;
        m.bumpTexture = bump;
        m.getEffect(); // samplers below are bound in onBind
        this.grass = tex(grassJpg);
        this.rock = tex(rockUrl);
    }
    private grass: Texture | null = null;
    private rock: Texture | null = null;

    private makeMaterial(sun: { x: number; y: number; z: number }): PBRCustomMaterial {
        const m = new PBRCustomMaterial("castawayGround", this.scene);
        m.metallic = 0;
        m.roughness = 0.92;
        m.albedoColor = new Color3(1, 1, 1);
        m.AddAttribute("rocky");
        m.Vertex_Definitions("attribute float rocky; varying float vRocky;");
        m.Vertex_MainEnd("vRocky = rocky;");
        m.Fragment_Definitions("varying float vRocky;");
        m.AddUniform("grassSampler", "sampler2D", null as never);
        m.AddUniform("rockSampler", "sampler2D", null as never);
        m.AddUniform("texReady", "float", 0);
        m.AddUniform("time", "float", 0);
        m.AddUniform("sunDirW", "vec3", null as never);
        m.Fragment_Custom_Albedo(`
            vec2 wxz = vPositionW.xz;
            float hgt = vPositionW.y;
            vec3 nW = normalize(vNormalW);
            float slope = 1.0 - nW.y;
            // big soft variation so nothing reads as tiled
            float nA = sin(wxz.x * 0.045 + sin(wxz.y * 0.031) * 2.0) * 0.5 + sin(wxz.y * 0.052 + 1.7) * 0.5;
            float nB = sin(wxz.x * 0.21 + 0.6 * sin(wxz.y * 0.17)) * sin(wxz.y * 0.19 + 0.4);
            vec3 sandC = mix(vec3(0.92, 0.74, 0.42), vec3(0.84, 0.62, 0.32), nB * 0.5 + 0.5);
            vec3 grassC = mix(vec3(0.22, 0.38, 0.03), vec3(0.11, 0.25, 0.02), nB * 0.5 + 0.5);
            vec3 jungleC = vec3(0.035, 0.1, 0.012);
            vec3 rockC = mix(vec3(0.34, 0.29, 0.21), vec3(0.15, 0.11, 0.07), nB * 0.5 + 0.5);
            if (texReady > 0.5) {
                sandC = surfaceAlbedo * mix(vec3(1.08, 0.98, 0.86), vec3(0.95, 0.86, 0.72), nB * 0.5 + 0.5);
                vec3 g = toLinearSpace(texture2D(grassSampler, wxz * 0.29).rgb);
                grassC = g * mix(vec3(0.95, 1.05, 0.55), vec3(0.75, 0.95, 0.5), nB * 0.5 + 0.5);
                jungleC = g * vec3(0.36, 0.55, 0.3);
                vec3 rk = toLinearSpace(texture2D(rockSampler, wxz * 0.11 + vec2(nW.x, nW.z) * 0.6).rgb);
                rockC = rk * vec3(1.0, 0.94, 0.85);
            }
            float wet = 1.0 - smoothstep(0.2, 1.2, hgt + nA * 0.3);
            vec3 sand = mix(sandC, sandC * vec3(0.55, 0.5, 0.42), wet);
            float grassMask = smoothstep(2.4 + nA, 4.6 + nA, hgt + nB * 0.5);
            float jungleMask = smoothstep(10.0, 24.0, hgt + nA * 6.0);
            vec3 green = mix(grassC, jungleC, jungleMask * 0.75);
            vec3 col = mix(sand, green, grassMask);
            float rockMask = max(smoothstep(0.26, 0.46, slope + nB * 0.05), clamp(vRocky + nB * 0.12, 0.0, 1.0));
            col = mix(col, rockC, rockMask);
            // underwater: red is absorbed first, then green, so the shelf fades to turquoise and blue
            float below = max(-hgt, 0.0);
            col *= exp(-vec3(0.5, 0.16, 0.08) * below);
            surfaceAlbedo = col;
        `);
        m.Fragment_Custom_MetallicRoughness(`
            float wetR = 1.0 - smoothstep(0.2, 1.2, vPositionW.y);
            metallicRoughness.g = mix(metallicRoughness.g, 0.45, wetR);
        `);
        m.Fragment_Before_FragColor(`
            if (vPositionW.y < 0.05 && vPositionW.y > -10.0) {
                float d = -vPositionW.y;
                vec2 q = vPositionW.xz * 0.62;
                float c = 0.0;
                for (int i = 0; i < 3; i++) {
                    q += vec2(sin(q.y * 1.7 + time * 0.9 + float(i)), cos(q.x * 1.3 - time * 0.7 + float(i) * 1.7)) * 0.45;
                    c += abs(sin(q.x + q.y));
                }
                float caustic = pow(1.0 - c / 3.0, 5.0) * 3.2;
                float sunAmt = max(-sunDirW.y, 0.0);
                finalColor.rgb += vec3(0.7, 0.95, 1.0) * caustic * sunAmt * exp(-d * 0.22) * smoothstep(0.0, 0.3, d);
            }
        `);
        m.onBindObservable.add(() => {
            const e = m.getEffect();
            if (!e) return;
            e.setFloat("time", this.time);
            e.setFloat3("sunDirW", sun.x, sun.y, sun.z);
            const ready = !!(this.grass?.isReady() && this.rock?.isReady() && m.albedoTexture?.isReady());
            e.setFloat("texReady", ready ? 1 : 0);
            if (this.grass) e.setTexture("grassSampler", this.grass);
            if (this.rock) e.setTexture("rockSampler", this.rock);
        });
        return m;
    }

    /** (Re)builds one tile from the height field. */
    private build(m: Mesh, ti: number, tj: number, first: boolean): void {
        const n1 = this.seg + 1;
        const pos = new Float32Array(n1 * n1 * 3);
        const nrm = new Float32Array(n1 * n1 * 3);
        const uv = new Float32Array(n1 * n1 * 2);
        const rocky = new Float32Array(n1 * n1);
        const s = this.step;
        const x0 = -HALF + ti * this.seg * s;
        const z0 = -HALF + tj * this.seg * s;
        for (let j = 0; j < n1; j++) {
            for (let i = 0; i < n1; i++) {
                const k = j * n1 + i;
                const x = x0 + i * s;
                const z = z0 + j * s;
                const h = skirtH(x, z);
                pos[k * 3] = x;
                pos[k * 3 + 1] = h;
                pos[k * 3 + 2] = z;
                // normals from the height field itself, so neighbouring tiles agree exactly at their seams
                const nx = skirtH(x - s, z) - skirtH(x + s, z);
                const nz = skirtH(x, z - s) - skirtH(x, z + s);
                const l = Math.hypot(nx, 2 * s, nz);
                nrm[k * 3] = nx / l;
                nrm[k * 3 + 1] = (2 * s) / l;
                nrm[k * 3 + 2] = nz / l;
                uv[k * 2] = (x + HALF) / TERRAIN_SIZE;
                uv[k * 2 + 1] = (z + HALF) / TERRAIN_SIZE;
                if (first) rocky[k] = rockiness(x, z);
            }
        }
        if (first) {
            const idx = new Uint32Array(this.seg * this.seg * 6);
            let o = 0;
            for (let j = 0; j < this.seg; j++) {
                for (let i = 0; i < this.seg; i++) {
                    const a = j * n1 + i;
                    // Babylon (right-handed mode) faces: clockwise seen from above
                    idx[o++] = a;
                    idx[o++] = a + 1;
                    idx[o++] = a + n1;
                    idx[o++] = a + 1;
                    idx[o++] = a + n1 + 1;
                    idx[o++] = a + n1;
                }
            }
            const vd = new VertexData();
            vd.positions = pos;
            vd.normals = nrm;
            vd.uvs = uv;
            vd.indices = idx;
            vd.applyToMesh(m, true);
            m.setVerticesData("rocky", rocky, false, 1);
        } else {
            m.updateVerticesData(VertexBuffer.PositionKind, pos);
            m.updateVerticesData(VertexBuffer.NormalKind, nrm);
            m.refreshBoundingInfo();
        }
    }

    /** The ground inside this world rectangle changed (a building site was cut or restored). */
    refresh(x0: number, z0: number, x1: number, z1: number): void {
        const span = this.seg * this.step;
        for (const m of this.tiles) {
            const { ti, tj } = m.metadata as { ti: number; tj: number };
            const tx0 = -HALF + ti * span - this.step;
            const tz0 = -HALF + tj * span - this.step;
            if (x1 < tx0 || x0 > tx0 + span + 2 * this.step || z1 < tz0 || z0 > tz0 + span + 2 * this.step) continue;
            this.build(m, ti, tj, false);
        }
    }
}
