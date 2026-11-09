// Drawing the far north (the layout is arctic.ts): drift ice, icebergs and the Arctic landmass, with its melt pools.
// Built only near you, in chunks, a piece at a time (so nothing stalls), and dropped again as you sail on; nothing of it
// exists while you are on the island.
// The ice material: Babylon's PBR (so the sun, the shadows and the fog all work as anywhere else) with a plugin that
// paints it: soft blue-white snow on the flat, glassy blue ice on the slopes, the walls of the crevices and under the water
// (darker the deeper), faint strata in the ice, a cold glow round its edges where the light comes through it, and sparkles
// that glint in the snow as you move. All worked out per pixel from the position and the normal: no textures, cheap enough
// for a headset.
import { Color3, Effect, type Material, MaterialPluginBase, type MaterialDefines, Mesh, MeshBuilder, PBRMaterial, type Scene, ShaderLanguage, ShaderMaterial, StandardMaterial, type UniformBuffer, Vector3, VertexBuffer, VertexData } from "@babylonjs/core";
import { NOISE_GLSL } from "../render/materials";
import { type Ice, ICE_Z0, iceNear, iceWobble, inland, LAND, landHeight, creviceAt, POOLS, ARC_W } from "./arctic";

interface Bind { sun: () => { x: number; y: number; z: number }; day: () => number; cut: () => [number, number, number, number] }

class IcePlugin extends MaterialPluginBase {
    constructor(material: Material, private readonly bind: Bind) {
        super(material, "ArcticIce", 230, { ICEMAT: false });
        this._enable(true);
    }
    override prepareDefines(defines: MaterialDefines): void { defines["ICEMAT"] = true; }
    override getClassName(): string { return "IcePlugin"; }
    override isCompatible(shaderLanguage: ShaderLanguage): boolean { return shaderLanguage === ShaderLanguage.GLSL; }
    override getUniforms() {
        return {
            ubo: [{ name: "icCut", size: 4, type: "vec4" }, { name: "icSun", size: 3, type: "vec3" }, { name: "icDay", size: 1, type: "float" }],
            fragment: "#ifdef ICEMAT\nuniform vec4 icCut;\nuniform vec3 icSun;\nuniform float icDay;\n#endif\n",
        };
    }
    override bindForSubMesh(ub: UniformBuffer): void {
        const c = this.bind.cut(), s = this.bind.sun();
        ub.updateFloat4("icCut", c[0], c[1], c[2], c[3]);
        ub.updateFloat3("icSun", s.x, s.y, s.z);
        ub.updateFloat("icDay", this.bind.day());
    }
    override getCustomCode(shaderType: string): { [point: string]: string } | null {
        if (shaderType !== "fragment") return null;
        return {
            CUSTOM_FRAGMENT_DEFINITIONS: `#ifdef ICEMAT
${NOISE_GLSL}
float icHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
// how deep in the ice this is (a crevice's walls, under the water): 0..1
float icDeepK() {
    float k = clamp(-vPositionW.y * 0.055, 0.0, 1.0);
#ifdef VERTEXCOLOR
    k = max(k, vColor.r);
#endif
    return k;
}
// snow (flat, out in the open) rather than bare ice: 0..1
float icSnowK() { return smoothstep(0.6, 0.86, normalize(vNormalW).y) * (1.0 - icDeepK()) * smoothstep(-0.4, 0.4, vPositionW.y); }
#endif
`,
            CUSTOM_FRAGMENT_MAIN_BEGIN: `#ifdef ICEMAT
if (icCut.w > 0.5 && distance(vPositionW.xz, icCut.xy) < icCut.z) discard;
#endif
`,
            CUSTOM_FRAGMENT_UPDATE_ALBEDO: `#ifdef ICEMAT
{
    vec3 P = vPositionW;
    float deep = icDeepK(), snowK = icSnowK();
    float n1 = cNoise(P * 0.22), n2 = cNoise(P * vec3(0.45, 2.4, 0.45)), n3 = cNoise(P * 1.7);
    // snow: white with the faintest blue, wind-rippled
    // (bluer where it faces away from the sky: the hollows and lee slopes)
    vec3 snow = mix(vec3(0.62, 0.72, 0.86), vec3(0.86, 0.9, 0.97), smoothstep(0.75, 1.0, normalize(vNormalW).y)) * (0.93 + 0.07 * n1 + 0.04 * n3);
    // ice: pale glassy blue at the surface, deep blue in the crevices and under the sea, banded by old layers of snow
    vec3 ice = mix(vec3(0.56, 0.82, 0.95), vec3(0.06, 0.30, 0.58), deep);
    ice *= 0.86 + 0.16 * n2;
    ice = mix(ice, vec3(0.80, 0.92, 0.98), smoothstep(0.55, 0.9, n2) * 0.35 * (1.0 - deep));
    surfaceAlbedo = mix(ice, snow, snowK);
}
#endif
`,
            CUSTOM_FRAGMENT_UPDATE_MICROSURFACE: `#ifdef ICEMAT
microSurface = mix(0.86, 0.12, icSnowK());
#endif
`,
            CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: `#ifdef ICEMAT
{
    vec3 N = normalize(vNormalW), V = normalize(vEyePosition.xyz - vPositionW);
    float snowK = icSnowK(), deep = icDeepK(), dist = length(vEyePosition.xyz - vPositionW);
    // light through the ice: a cold glow at the edges (fresnel) and in its thin parts, more by day
    float fr = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
    vec3 glow = vec3(0.10, 0.36, 0.55) * (fr * 0.9 + 0.25 * (1.0 - deep)) * (1.0 - snowK) * (0.15 + 0.85 * icDay);
    // sparkle: a few cells of the snow catch the sun just so, and wink as you move
    vec3 cell = floor(vPositionW * 7.0);
    float h = icHash(cell);
    float wink = step(0.86, fract(h * 37.0 + dot(V, vec3(3.1, 4.7, 2.3)) * 1.6));
    float sp = step(0.985, h) * wink * snowK * icDay * smoothstep(45.0, 8.0, dist) * clamp(dot(N, icSun) * 2.0, 0.0, 1.0);
    finalEmissive += glow + vec3(1.6, 1.7, 1.8) * sp;
}
#endif
`,
        };
    }
}

/** the ice material (`cut`: the far land's, with a hole round you where the close-up pieces are) */
function iceMaterial(scene: Scene, name: string, bind: Bind, zOffset = 0): PBRMaterial {
    const m = new PBRMaterial(name, scene);
    m.metallic = 0; m.roughness = 0.4; m.albedoColor = new Color3(1, 1, 1);
    m.environmentIntensity = 0.9;
    if (zOffset) m.zOffset = zOffset;
    new IcePlugin(m, bind);
    return m;
}

const BERG_CH = 256, BERG_R = 1400, FLOE_R = 700, NEAR_T = 96, NEAR_STEP = 3, NEAR_R = 300, FAR_STEP = 28;

interface Chunk { mesh: Mesh | null; key: string }

export class ArcticView {
    private iceMat: PBRMaterial;
    private landMat: PBRMaterial;
    private farMat: PBRMaterial;
    private poolMat: StandardMaterial;
    private bergs = new Map<string, Chunk>();
    private floes = new Map<string, Chunk>();
    private tiles = new Map<string, Chunk>();
    private pools = new Map<number, Mesh>();
    private far: Mesh | null = null;
    private cut: [number, number, number, number] = [0, 0, NEAR_R, 0];
    private tmp: Ice[] = [];
    private t = 0;
    private flip = false;
    /** how far (m) bergs are built: less in a headset */
    private bergR: number;

    constructor(private readonly scene: Scene, sun: () => { x: number; y: number; z: number }, day: () => number, lean: boolean) {
        this.bergR = lean ? 900 : BERG_R;
        const bind: Bind = { sun, day, cut: () => [0, 0, 0, 0] };
        this.iceMat = iceMaterial(scene, "arcticIce", bind);
        this.landMat = iceMaterial(scene, "arcticLand", bind);
        this.farMat = iceMaterial(scene, "arcticFar", { ...bind, cut: () => this.cut }, 2);
        const pm = new StandardMaterial("arcticPool", scene);
        pm.diffuseColor = new Color3(0.08, 0.32, 0.38); pm.specularColor = new Color3(0.9, 0.95, 1); pm.specularPower = 180;
        pm.emissiveColor = new Color3(0.02, 0.12, 0.16); pm.alpha = 0.82;
        this.poolMat = pm;
    }

    /** `cam`: where you look from; `away`: in a cave, a level... */
    update(dt: number, cam: { x: number; y: number; z: number }, away: boolean) {
        const near = !away && cam.z < ICE_Z0 + BERG_R && Math.abs(cam.x) < ARC_W + 1500;
        if (!near) { if (this.bergs.size || this.floes.size || this.tiles.size || this.far || this.pools.size) this.clear(); return; }
        this.cut[0] = cam.x; this.cut[1] = cam.z; this.cut[3] = 1;
        this.t -= dt;
        if (this.t > 0) return;
        this.t = 0.15;
        // one piece of work per step, nearest first: the land close up, the bergs, the floes, the far land
        if (this.stepTiles(cam)) return;
        // (the floes and the bergs take turns; chunks with nothing in them cost nothing, so several go at once)
        this.flip = !this.flip;
        for (let k = 0; k < 8; k++) {
            const r = this.flip ? this.stepIce(cam, this.floes, FLOE_R, true) || this.stepIce(cam, this.bergs, this.bergR, false) : this.stepIce(cam, this.bergs, this.bergR, false) || this.stepIce(cam, this.floes, FLOE_R, true);
            if (r === "built") return;
            if (!r) break;
        }
        this.stepFar(cam);
    }

    private clear() {
        for (const m of [this.bergs, this.floes, this.tiles]) { for (const c of m.values()) c.mesh?.dispose(); m.clear(); }
        for (const p of this.pools.values()) p.dispose();
        this.pools.clear();
        this.far?.dispose(); this.far = null;
    }

    // ------------------------------------------------------------------ bergs and floes, in chunks
    private stepIce(cam: { x: number; z: number }, set: Map<string, Chunk>, R: number, floes: boolean): "built" | "empty" | false {
        for (const [k, c] of set) {
            const [i, j] = k.split(",").map(Number), cx = (i + 0.5) * BERG_CH, cz = (j + 0.5) * BERG_CH;
            if (Math.hypot(cx - cam.x, cz - cam.z) > R + BERG_CH) { c.mesh?.dispose(); set.delete(k); }
        }
        let best: [number, number] | null = null, bd = Infinity;
        const i0 = Math.floor((cam.x - R) / BERG_CH), i1 = Math.floor((cam.x + R) / BERG_CH), j0 = Math.floor((cam.z - R) / BERG_CH), j1 = Math.floor((cam.z + R) / BERG_CH);
        for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
            const cz = (j + 0.5) * BERG_CH, cx = (i + 0.5) * BERG_CH;
            if (cz - BERG_CH > ICE_Z0 || Math.abs(cx) - BERG_CH > ARC_W) continue;
            const d = Math.hypot(cx - cam.x, cz - cam.z);
            if (d > R || set.has(`${i},${j}`) || d >= bd) continue;
            bd = d; best = [i, j];
        }
        if (!best) return false;
        const [i, j] = best;
        // (the ice whose middle is in this chunk)
        const all = iceNear((i + 0.5) * BERG_CH, (j + 0.5) * BERG_CH, BERG_CH * 0.75, this.tmp, floes, !floes)
            .filter((f) => Math.floor(f.x / BERG_CH) === i && Math.floor(f.z / BERG_CH) === j);
        set.set(`${i},${j}`, { mesh: all.length ? this.iceMesh(all, floes) : null, key: `${i},${j}` });
        return all.length ? "built" : "empty";
    }

    /** the floes or bergs of a chunk as one mesh: each a body of revolution, wobbled as the layout says, faceted */
    private iceMesh(list: Ice[], floes: boolean): Mesh {
        const pos: number[] = [], idx: number[] = [];
        for (const f of list) {
            const SEG = floes ? 12 : 26, P = f.prof, base = pos.length / 3;
            for (let k = 0; k < P.length; k++) for (let s = 0; s < SEG; s++) {
                const a = (s / SEG) * Math.PI * 2, w = iceWobble(f, a - f.yaw);
                // (below its widest point the ice is rougher: nobody walks there)
                const rough = k > f.widest ? 1 + 0.12 * Math.sin(s * 2.7 + k * 1.3 + f.seed) : 1;
                const R = P[k][0] * w * rough;
                pos.push(f.x + Math.cos(a) * R, P[k][1] + (k > f.widest ? 0.8 * Math.sin(s * 1.9 + f.seed) : 0), f.z + Math.sin(a) * R);
            }
            for (let k = 0; k < P.length - 1; k++) for (let s = 0; s < SEG; s++) {
                const a = base + k * SEG + s, b = base + k * SEG + ((s + 1) % SEG), c = a + SEG, d = b + SEG;
                // (Babylon's right-handed front face: the other way round from three.js)
                idx.push(a, c, b, b, c, d);
            }
        }
        const m = new Mesh(floes ? "arcticFloes" : "arcticBergs", this.scene);
        const vd = new VertexData(); vd.positions = pos; vd.indices = idx;
        const nor: number[] = []; VertexData.ComputeNormals(pos, idx, nor); vd.normals = nor;
        vd.applyToMesh(m);
        m.convertToFlatShadedMesh();
        m.material = this.iceMat; m.isPickable = false; m.receiveShadows = true;
        return m;
    }

    // ------------------------------------------------------------------ the land close up: tiles with the crevices, and its pools
    private stepTiles(cam: { x: number; z: number }): boolean {
        const landNear = Math.hypot(cam.x - LAND.x, cam.z - LAND.z) < LAND.r * 1.3 + NEAR_R + 200;
        for (const [k, c] of this.tiles) {
            const [i, j] = k.split(",").map(Number);
            if (!landNear || Math.hypot((i + 0.5) * NEAR_T - cam.x, (j + 0.5) * NEAR_T - cam.z) > NEAR_R + NEAR_T * 1.6) { c.mesh?.dispose(); this.tiles.delete(k); }
        }
        for (const [k, p] of this.pools) if (!landNear || Math.hypot(POOLS[k].x - cam.x, POOLS[k].z - cam.z) > 700) { p.dispose(); this.pools.delete(k); }
        if (!landNear) return false;
        // (the pools: a sheet of still, clear meltwater in each hollow)
        for (let k = 0; k < POOLS.length; k++) {
            const p = POOLS[k];
            if (this.pools.has(k) || Math.hypot(p.x - cam.x, p.z - cam.z) > 600) continue;
            const d = MeshBuilder.CreateDisc("arcticPool", { radius: p.r * 1.04, tessellation: 28 }, this.scene);
            d.rotation.x = Math.PI / 2; d.position.set(p.x, p.level, p.z); d.material = this.poolMat; d.isPickable = false;
            this.pools.set(k, d);
            return true;
        }
        let best: [number, number] | null = null, bd = Infinity;
        const R = NEAR_R + NEAR_T * 0.75;
        const i0 = Math.floor((cam.x - R) / NEAR_T), i1 = Math.floor((cam.x + R) / NEAR_T), j0 = Math.floor((cam.z - R) / NEAR_T), j1 = Math.floor((cam.z + R) / NEAR_T);
        for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
            const cx = (i + 0.5) * NEAR_T, cz = (j + 0.5) * NEAR_T, d = Math.hypot(cx - cam.x, cz - cam.z);
            if (d > R || d >= bd || this.tiles.has(`${i},${j}`)) continue;
            bd = d; best = [i, j];
        }
        if (!best) return false;
        const [i, j] = best;
        this.tiles.set(`${i},${j}`, { mesh: this.landMesh(i * NEAR_T, j * NEAR_T, NEAR_T, NEAR_STEP, this.landMat, true), key: `${i},${j}` });
        return true;
    }

    /** a square of the land's ground (null when it is all deep sea); `crev`: colour the crevices' walls for the shader */
    private landMesh(x0: number, z0: number, size: number, step: number, mat: Material, crev: boolean, name = "arcticLand"): Mesh | null {
        const n = Math.round(size / step), pos: number[] = [], col: number[] = [], idx: number[] = [];
        const keep: boolean[] = [];
        for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
            const x = x0 + i * step, z = z0 + j * step, h = landHeight(x, z);
            pos.push(x, Number.isFinite(h) ? h : -70, z);
            keep.push(inland(x, z) > -90);
            const c = crev ? creviceAt(x, z) : 0;
            col.push(c, c, c, 1);
        }
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
            const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
            if (!keep[a] && !keep[b] && !keep[c] && !keep[d]) continue;
            idx.push(a, b, c, b, d, c);
        }
        if (!idx.length) return null;
        const m = new Mesh(name, this.scene);
        const vd = new VertexData(); vd.positions = pos; vd.indices = idx; vd.colors = col;
        const nor: number[] = []; VertexData.ComputeNormals(pos, idx, nor); vd.normals = nor;
        vd.applyToMesh(m);
        m.material = mat; m.isPickable = false; m.receiveShadows = true;
        return m;
    }

    // ------------------------------------------------------------------ the land from afar: one coarse mesh, with a hole round you
    private stepFar(cam: { x: number; z: number }) {
        const want = Math.hypot(cam.x - LAND.x, cam.z - LAND.z) < LAND.r * 1.3 + 3500;
        if (!want) { this.far?.dispose(); this.far = null; return; }
        if (this.far) return;
        const S = LAND.r * 1.35 + 420;
        this.far = this.landMesh(LAND.x - S, LAND.z - S, S * 2, FAR_STEP, this.farMat, false, "arcticFar");
    }
}

// ------------------------------------------------------------------ snowfall in the far north
Effect.ShadersStore["arcticSnowVertexShader"] = `
precision highp float;
attribute vec3 position;
uniform mat4 viewProjection;
uniform vec3 cam;
uniform float time, px, amt, wind;
varying float vA;
void main() {
    // each flake keeps its place in the world (the box of them wraps round the camera), drifting down and on the wind
    float seed = fract(position.x * 13.17 + position.z * 7.31);
    vec3 q = position + vec3(sin(time * 0.4 + position.y) * 0.6 + time * wind, -time * (0.9 + seed * 0.6), cos(time * 0.33 + position.x) * 0.6);
    vec3 p = cam + mod(q - cam + 20.0, 40.0) - 20.0;
    gl_Position = viewProjection * vec4(p, 1.0);
    float d = distance(p, cam);
    vA = (seed < amt ? 1.0 : 0.0) * smoothstep(20.0, 12.0, d) * smoothstep(0.4, 1.2, d);
    gl_PointSize = vA > 0.0 ? max(1.0, 0.05 * px / gl_Position.w) : 0.0;
}`;
Effect.ShadersStore["arcticSnowFragmentShader"] = `
precision highp float;
uniform float lit;
varying float vA;
void main() {
    vec2 c = gl_PointCoord - 0.5;
    float a = smoothstep(0.5, 0.15, length(c)) * vA;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vec3(lit), a * 0.85);
}`;

export class Snowfall {
    private mesh: Mesh;
    private mat: ShaderMaterial;
    private t = 0;
    constructor(private readonly scene: Scene) {
        const N = 3000, pos = new Float32Array(N * 3);
        for (let i = 0; i < N * 3; i++) pos[i] = Math.random() * 40;
        this.mesh = new Mesh("arcticSnow", scene);
        const vd = new VertexData(); vd.positions = pos; vd.indices = Uint32Array.from({ length: N }, (_, i) => i); vd.applyToMesh(this.mesh);
        this.mat = new ShaderMaterial("arcticSnowMat", scene, "arcticSnow", { attributes: [VertexBuffer.PositionKind], uniforms: ["viewProjection", "cam", "time", "px", "amt", "wind", "lit"] });
        this.mat.pointsCloud = true;
        this.mat.needAlphaBlending = () => true;
        this.mat.disableDepthWrite = true;
        this.mesh.material = this.mat;
        this.mesh.isPickable = false; this.mesh.alwaysSelectAsActiveMesh = true; this.mesh.setEnabled(false);
    }
    /** `amt`: 0..1 how hard it snows; `lit`: how bright the flakes are (the daylight); `wind` m/s */
    update(dt: number, cam: { x: number; y: number; z: number }, amt: number, lit: number, wind: number) {
        const on = amt > 0.02;
        if (this.mesh.isEnabled() !== on) this.mesh.setEnabled(on);
        if (!on) return;
        this.t += dt;
        this.mat.setVector3("cam", new Vector3(cam.x, cam.y, cam.z));
        this.mat.setFloat("time", this.t);
        this.mat.setFloat("amt", amt);
        this.mat.setFloat("wind", wind);
        this.mat.setFloat("lit", lit);
        this.mat.setFloat("px", this.scene.getEngine().getRenderHeight() * 0.5 * (this.scene.activeCamera?.getProjectionMatrix().m[5] ?? 1.7));
    }
}
