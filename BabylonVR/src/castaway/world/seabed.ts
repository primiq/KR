// The sea floor: rocks, kelp and seagrass that sway in the current, corals, sea urchins, starfish and shells.
// Nothing of it exists far from the player: the sea is cut into 20 m tiles, each tile's contents are made from its own seed the
// first time the player comes near (so they are the same every time, and the same for everybody) and kept in a small cache;
// every few metres the instances within reach are copied into one instanced mesh per kind (about 9 draw calls in all).
// While the player is under water there are also a few slanting shafts of sunlight and specks drifting in the water.
// Babylon port: the shapes are Castaway's three.js geometry, drawn as Babylon thin instances with PBR custom materials
// (the current's sway, the depth tint and the caustics are Castaway's node-material code as GLSL).
import { type Color3, Constants, Effect, Mesh, type Scene, ShaderMaterial, VertexBuffer, VertexData } from "@babylonjs/core";
import { PBRCustomMaterial } from "@babylonjs/materials";
import * as THREE from "three";
import { meshFromThree } from "../render/geometry";
import { NOISE_GLSL } from "../render/materials";
import type { Atmosphere } from "./atmosphere";
import { heightAt, slopeAt } from "./island";
import { mulberry32 } from "../core/noise";

const TILE = 20;
type Kind = "rock" | "boulder" | "kelp" | "grass" | "coral" | "fan" | "brain" | "urchin" | "star" | "shell";
interface Inst { k: number; m: THREE.Matrix4; c?: THREE.Color }
const KINDS: Kind[] = ["rock", "boulder", "kelp", "grass", "coral", "fan", "brain", "urchin", "star", "shell"];

// ---------------------------------------------------------------- geometry
function withAttrs(g: THREE.BufferGeometry, sway: (y: number, x: number, z: number) => number, col?: (y: number) => [number, number, number]) {
  const n = g.index ? g.toNonIndexed() : g;
  const P = n.getAttribute("position"), sw = new Float32Array(P.count), c = new Float32Array(P.count * 3);
  for (let i = 0; i < P.count; i++) {
    sw[i] = sway(P.getY(i), P.getX(i), P.getZ(i));
    const cc = col ? col(P.getY(i)) : [1, 1, 1]; c[i * 3] = cc[0]; c[i * 3 + 1] = cc[1]; c[i * 3 + 2] = cc[2];
  }
  n.setAttribute("sway", new THREE.BufferAttribute(sw, 1));
  n.setAttribute("color", new THREE.BufferAttribute(c, 3));
  n.deleteAttribute("uv");
  n.computeVertexNormals();
  return n;
}
function lumpy(r: number, seed: number, detail = 1, sq = 0.7) {
  const g = new THREE.IcosahedronGeometry(r, detail), P = g.getAttribute("position"), rnd = mulberry32(seed);
  const map = new Map<string, number>();
  for (let i = 0; i < P.count; i++) {
    const key = `${P.getX(i).toFixed(3)},${P.getY(i).toFixed(3)},${P.getZ(i).toFixed(3)}`;
    let k = map.get(key); if (k === undefined) { k = 0.78 + rnd() * 0.42; map.set(key, k); }
    P.setXYZ(i, P.getX(i) * k, P.getY(i) * k * sq, P.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}
/** a kelp frond: a twisting ribbon, 1 m tall (scaled per instance), swaying more towards the tip */
function kelpGeometry() {
  const seg = 10, pos: number[] = [], idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg, w = 0.07 * (0.4 + Math.sin(t * Math.PI) * 0.9), tw = t * 2.4, ox = Math.sin(t * 3) * 0.05;
    pos.push(ox - Math.cos(tw) * w, t, -Math.sin(tw) * w, ox + Math.cos(tw) * w, t, Math.sin(tw) * w);
    if (i < seg) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  const parts = [0, 1.7, 3.6].map((a, k) => g.clone().rotateY(a).translate(Math.cos(a) * 0.06 * k, 0, Math.sin(a) * 0.06 * k).scale(1, 0.75 + k * 0.15, 1));
  const merged = mergeAll(parts);
  return withAttrs(merged, (y) => y * y, (y) => [0.32 + y * 0.25, 0.42 + y * 0.18, 0.12]);
}
function seagrassGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const a = i * 0.9, h = 0.35 + (i % 3) * 0.12;
    const b = new THREE.PlaneGeometry(0.025, h, 1, 3).translate(0, h / 2, 0).rotateY(a).translate(Math.cos(a) * 0.05, 0, Math.sin(a) * 0.05);
    parts.push(b);
  }
  return withAttrs(mergeAll(parts), (y) => Math.min(1, y * 2.5) ** 2, (y) => [0.25 + y * 0.4, 0.5 + y * 0.3, 0.18]);
}
function coralGeometry() {
  // a branching staghorn: white base colour, tinted per instance
  const parts: THREE.BufferGeometry[] = [], rnd = mulberry32(7);
  const branch = (x: number, y: number, z: number, ax: number, az: number, len: number, r: number, depth: number) => {
    // open-ended: each end is buried in a tip ball (or the sea floor), so the caps were never seen
    const g = new THREE.CylinderGeometry(r * 0.7, r, len, 5, 1, true).translate(0, len / 2, 0);
    g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(ax, 0, az))).translate(x, y, z);
    parts.push(g);
    const tip = new THREE.Vector3(0, len, 0).applyEuler(new THREE.Euler(ax, 0, az)).add(new THREE.Vector3(x, y, z));
    parts.push(new THREE.SphereGeometry(r * 0.8, 5, 3).translate(tip.x, tip.y, tip.z));
    if (depth > 0) for (let k = 0; k < 2; k++) branch(tip.x, tip.y, tip.z, ax + (rnd() - 0.5) * 1.1, az + (rnd() - 0.5) * 1.1, len * 0.7, r * 0.7, depth - 1);
  };
  for (let k = 0; k < 4; k++) branch(0, 0, 0, (rnd() - 0.5) * 0.9, (rnd() - 0.5) * 0.9, 0.18, 0.025, 2);
  return withAttrs(mergeAll(parts), () => 0.05);
}
function fanGeometry() {
  const g = new THREE.CircleGeometry(0.3, 14, 0, Math.PI).translate(0, 0.05, 0);
  const stalk = new THREE.CylinderGeometry(0.012, 0.02, 0.1, 4).translate(0, 0.05, 0);
  return withAttrs(mergeAll([g, stalk]), (y) => y * 0.6);
}
function brainGeometry() { return withAttrs(lumpy(0.22, 3, 2, 0.6).translate(0, 0.06, 0), () => 0); }
function urchinGeometry() {
  const parts: THREE.BufferGeometry[] = [new THREE.SphereGeometry(0.05, 6, 4)];
  for (let i = 0; i < 18; i++) {
    const v = new THREE.Vector3().randomDirection(); if (v.y < -0.2) v.y = -v.y;
    const s = new THREE.ConeGeometry(0.006, 0.11, 3).translate(0, 0.08, 0);
    s.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v)));
    parts.push(s);
  }
  return withAttrs(mergeAll(parts).translate(0, 0.03, 0), () => 0);
}
function starGeometry() {
  const s = new THREE.Shape(); for (let i = 0; i <= 10; i++) { const a = (i / 10) * Math.PI * 2, r = i % 2 ? 0.035 : 0.1; if (i) s.lineTo(Math.cos(a) * r, Math.sin(a) * r); else s.moveTo(r, 0); }
  return withAttrs(new THREE.ExtrudeGeometry(s, { depth: 0.015, bevelEnabled: false }).rotateX(-Math.PI / 2), () => 0);
}
function shellGeometry() { return withAttrs(new THREE.SphereGeometry(0.06, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.5, 1.3), () => 0, (y) => [0.95 - y * 2, 0.88 - y * 2, 0.8 - y * 2]); }
function mergeAll(parts: THREE.BufferGeometry[]) {
  const pos: number[] = [];
  for (const p of parts) { const n = p.index ? p.toNonIndexed() : p; const P = n.getAttribute("position"); for (let i = 0; i < P.count; i++) pos.push(P.getX(i), P.getY(i), P.getZ(i)); }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

// ---------------------------------------------------------------- materials
/** depth tint and caustics shared by everything down there (applied to the albedo, as Castaway's colorNode did) */
const SEA_LIGHT = `
vec3 seaLight(vec3 base, vec3 wp, vec3 nw) {
    float depth = max(-wp.y, 0.0);
    vec3 absorb = exp(-vec3(0.42, 0.13, 0.06) * depth);
    float c1 = 1.0 - abs(cNoise(vec3(wp.x * 0.62 + sbTime * 0.25, wp.z * 0.62 - sbTime * 0.18, sbTime * 0.3)));
    float caustic = pow(c1, 7.0) * smoothstep(-0.2, 0.9, nw.y) * (1.0 - smoothstep(2.0, 12.0, depth)) * sbDay;
    return base * absorb + sbSun * caustic * 0.6;
}`;

type Bind = { time: () => number; day: () => number; sun: () => Color3 };
function seaMaterial(scene: Scene, name: string, rough: number, bind: Bind, opts: { amp?: number; rock?: boolean; double?: boolean } = {}) {
    const m = new PBRCustomMaterial(name, scene);
    m.metallic = 0;
    m.roughness = rough;
    m.backFaceCulling = !opts.double;
    if (opts.double) m.twoSidedLighting = true;
    m.AddUniform("sbTime", "float", 0);
    m.AddUniform("sbDay", "float", 1);
    m.AddUniform("sbSun", "vec3", null as never);
    if (opts.amp) {
        // the current: the whole part of the colour's alpha is the sway weight (render/geometry.ts packs it there)
        m.Vertex_After_WorldPosComputed(`
            #ifdef VERTEXCOLOR
            float sbW = floor(color.a) / 100.0;
            #else
            float sbW = 0.0;
            #endif
            float sbPh = worldPos.x * 0.35 + worldPos.z * 0.27;
            float sbS = sin(sbTime * 0.9 + sbPh) * 0.7 + sin(sbTime * 1.7 + sbPh * 1.9) * 0.3;
            worldPos.xyz += vec3(sbS * sbW * ${opts.amp.toFixed(3)}, 0.0, sin(sbTime * 1.1 + sbPh * 1.3) * sbW * ${(opts.amp * 0.7).toFixed(3)});
        `);
    }
    m.Fragment_Definitions(NOISE_GLSL + SEA_LIGHT);
    if (opts.rock) {
        m.Fragment_Custom_Albedo(`
            vec3 sbP = vPositionW;
            float n1 = cNoise(sbP * 1.3), n2 = cNoise(sbP * 6.0);
            vec3 c = mix(vec3(0.110, 0.122, 0.112), vec3(0.044, 0.052, 0.050), n1 * 0.5 + 0.5) * (0.85 + n2 * 0.25);
            // green and red algae on the tops, barnacle-pale specks
            c = mix(c, mix(vec3(0.078, 0.144, 0.023), vec3(0.195, 0.042, 0.042), smoothstep(0.2, 0.6, n1)), smoothstep(0.4, 0.9, normalW.y) * smoothstep(-0.3, 0.4, n2) * 0.75);
            c = mix(c, vec3(0.687, 0.644, 0.527), smoothstep(0.55, 0.75, n2) * 0.35);
            surfaceAlbedo = seaLight(c, vPositionW, normalW);
        `);
    } else m.Fragment_Custom_Albedo("surfaceAlbedo = seaLight(surfaceAlbedo, vPositionW, normalW);");
    m.onBindObservable.add(() => {
        const e = m.getEffect(); if (!e) return;
        e.setFloat("sbTime", bind.time());
        e.setFloat("sbDay", bind.day());
        const s = bind.sun(); e.setFloat3("sbSun", s.r, s.g, s.b);
    });
    return m;
}

Effect.ShadersStore["castawayShaftVertexShader"] = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 world;
uniform mat4 viewProjection;
varying vec2 vUV;
varying float vX;
void main() { vec4 w = world * vec4(position, 1.0); vUV = uv; vX = w.x; gl_Position = viewProjection * w; }`;
Effect.ShadersStore["castawayShaftFragmentShader"] = `
precision highp float;
uniform float shaft;
uniform float time;
varying vec2 vUV;
varying float vX;
void main() {
    float a = smoothstep(0.0, 0.5, vUV.x) * smoothstep(1.0, 0.5, vUV.x) * smoothstep(0.0, 0.8, vUV.y) * shaft * 0.075 * (sin(time * 0.6 + vX * 0.4) * 0.3 + 0.7);
    gl_FragColor = vec4(vec3(0.77, 0.93, 1.0) * a, 1.0);
}`;
Effect.ShadersStore["castawaySnowVertexShader"] = `
precision highp float;
attribute vec3 position;
uniform mat4 world;
uniform mat4 viewProjection;
uniform float px;
void main() { gl_Position = viewProjection * (world * vec4(position, 1.0)); gl_PointSize = max(1.0, 0.035 * px / gl_Position.w); }`;
Effect.ShadersStore["castawaySnowFragmentShader"] = `
precision highp float;
void main() { gl_FragColor = vec4(vec3(0.81, 0.94, 1.0) * 0.55, 1.0); }`;

// ---------------------------------------------------------------- the field
export class Seabed {
    private meshes: Mesh[] = [];
    private bufs: { m: Float32Array; c: Float32Array | null }[] = [];
    private counts: number[] = [];
    private caps: number[];
    private cache = new Map<string, Inst[]>();
    private at = { x: 1e9, z: 1e9 };
    private dummy = new THREE.Object3D();
    private radius: number;
    private density: number;
    private time = 0;
    private shown = true;
    // under-water extras
    private shafts: Mesh;
    private shaftMat: ShaderMaterial;
    private snow: Mesh;
    private snowMat: ShaderMaterial;
    private snowPos: Float32Array;

    constructor(private readonly scene: Scene, private readonly atmo: Atmosphere, sun: () => Color3, q: { name: string; lean?: boolean }) {
        const low = q.name === "low" || !!q.lean;
        this.radius = low ? 46 : 64;
        this.density = low ? 0.6 : 1;
        const bind: Bind = { time: () => this.time, day: () => atmo.day, sun };
        const geos = [lumpy(0.5, 1, 1, 0.65), lumpy(1.0, 2, 1, 0.75), kelpGeometry(), seagrassGeometry(), coralGeometry(), fanGeometry(), brainGeometry(), urchinGeometry(), starGeometry(), shellGeometry()];
        for (const g of geos.slice(0, 2)) { const n = g.getAttribute("position").count; g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3)); }
        const rock = seaMaterial(scene, "seaRock", 0.95, bind, { rock: true }), sway = seaMaterial(scene, "seaSway", 0.85, bind, { amp: 0.18, double: true }), still = seaMaterial(scene, "seaStill", 0.7, bind);
        const mats = [rock, rock, seaMaterial(scene, "seaKelp", 0.8, bind, { amp: 0.28, double: true }), sway, still, seaMaterial(scene, "seaFan", 0.8, bind, { amp: 0.08, double: true }), still, still, still, still];
        this.caps = [700, 160, 900, 1600, 500, 260, 220, 300, 260, 300].map((c) => Math.round(c * (low ? 0.65 : 1)));
        KINDS.forEach((name, k) => {
            const mesh = meshFromThree(`sea_${name}`, geos[k], scene);
            mesh.material = mats[k];
            mesh.isPickable = false;
            mesh.alwaysSelectAsActiveMesh = true;
            const m = new Float32Array(this.caps[k] * 16);
            mesh.thinInstanceSetBuffer("matrix", m, 16, false);
            let c: Float32Array | null = null;
            if (k === 4 || k === 5 || k === 6 || k === 8) { c = new Float32Array(this.caps[k] * 4).fill(1); mesh.thinInstanceSetBuffer("color", c, 4, false); }
            mesh.thinInstanceCount = 0;
            this.meshes.push(mesh); this.bufs.push({ m, c }); this.counts.push(0);
        });

        // light shafts: a ring of tall, slanted soft planes round the camera (only while under water)
        const sg: THREE.BufferGeometry[] = [];
        for (let i = 0; i < 9; i++) {
            const a = (i / 9) * Math.PI * 2 + (i % 2) * 0.3, r = 6 + (i % 3) * 4;
            sg.push(new THREE.PlaneGeometry(0.8 + (i % 2) * 0.9, 26, 1, 1).translate(0, -13, 0).rotateZ(0.25).rotateY(a).translate(Math.cos(a) * r, 0, Math.sin(a) * r));
        }
        this.shafts = meshFromThree("seaShafts", mergeUV(sg), scene);
        this.shaftMat = new ShaderMaterial("shaftMat", scene, "castawayShaft", { attributes: [VertexBuffer.PositionKind, VertexBuffer.UVKind], uniforms: ["world", "viewProjection", "shaft", "time"] });
        this.shaftMat.alphaMode = Constants.ALPHA_ADD;
        this.shaftMat.needAlphaBlending = () => true;
        this.shaftMat.disableDepthWrite = true;
        this.shaftMat.backFaceCulling = false;
        this.shafts.material = this.shaftMat;
        this.shafts.isPickable = false; this.shafts.alwaysSelectAsActiveMesh = true; this.shafts.setEnabled(false);
        // drifting specks (marine snow) in a box round the camera
        const N = low ? 260 : 520;
        this.snowPos = new Float32Array(N * 3);
        for (let i = 0; i < N * 3; i++) this.snowPos[i] = (Math.random() - 0.5) * 16;
        this.snow = new Mesh("seaSnow", scene);
        const vd = new VertexData(); vd.positions = this.snowPos; vd.indices = Uint32Array.from({ length: N }, (_, i) => i); vd.applyToMesh(this.snow, true);
        this.snowMat = new ShaderMaterial("snowMat", scene, "castawaySnow", { attributes: [VertexBuffer.PositionKind], uniforms: ["world", "viewProjection", "px"] });
        this.snowMat.pointsCloud = true;
        this.snowMat.alphaMode = Constants.ALPHA_ADD;
        this.snowMat.needAlphaBlending = () => true;
        this.snowMat.disableDepthWrite = true;
        this.snow.material = this.snowMat;
        this.snow.isPickable = false; this.snow.alwaysSelectAsActiveMesh = true; this.snow.setEnabled(false);
    }

    private setMatrixAt(k: number, i: number, m: THREE.Matrix4) { this.bufs[k].m.set(m.elements, i * 16); }
    private setColorAt(k: number, i: number, c: THREE.Color) { const b = this.bufs[k].c; if (b) b.set([c.r, c.g, c.b, 1], i * 4); }

  /** what grows in one tile (seeded by the tile, the same every time) */
  private tile(ti: number, tj: number): Inst[] {
    const key = `${ti},${tj}`;
    const c = this.cache.get(key); if (c) { this.cache.delete(key); this.cache.set(key, c); return c; }
    const out: Inst[] = [], rnd = mulberry32((ti * 73856093) ^ (tj * 19349663) ^ 0x5eaf);
    const d = this.dummy, D = this.density;
    const put = (k: number, x: number, z: number, s: number, opts: { tilt?: boolean; sy?: number; col?: string; y?: number } = {}) => {
      const h = opts.y ?? heightAt(x, z);
      d.position.set(x, h - (k <= 1 ? s * 0.18 : 0.01), z);
      d.rotation.set(opts.tilt ? (rnd() - 0.5) * 0.4 : 0, rnd() * Math.PI * 2, opts.tilt ? (rnd() - 0.5) * 0.4 : 0);
      d.scale.set(s, s * (opts.sy ?? 1), s); d.updateMatrix();
      out.push({ k, m: d.matrix.clone(), c: opts.col ? new THREE.Color(opts.col) : undefined });
    };
    const x0 = ti * TILE, z0 = tj * TILE;
    const depthAt = (x: number, z: number) => -heightAt(x, z);
    // probe the tile: is there sea floor here at all?
    let wet = 0; for (let k = 0; k < 9; k++) if (depthAt(x0 + ((k % 3) + 0.5) * TILE / 3, z0 + (Math.floor(k / 3) + 0.5) * TILE / 3) > 0.5) wet++;
    if (!wet) { this.remember(key, out); return out; }
    const n = (base: number) => Math.round(base * D * (wet / 9) * (0.7 + rnd() * 0.6));
    const spot = (minD: number, maxD = 99) => { for (let k = 0; k < 6; k++) { const x = x0 + rnd() * TILE, z = z0 + rnd() * TILE, dd = depthAt(x, z); if (dd > minD && dd < maxD) return { x, z, dd }; } return null; };
    // rocks: in clusters, bigger ones in deeper water
    for (let c = n(3); c > 0; c--) {
      const s0 = spot(0.6); if (!s0) continue;
      const m = 3 + Math.floor(rnd() * 6);
      for (let i = 0; i < m; i++) { const x = s0.x + (rnd() - 0.5) * 5, z = s0.z + (rnd() - 0.5) * 5; if (depthAt(x, z) > 0.5) put(0, x, z, 0.4 + rnd() * 1.1, { tilt: true }); }
      if (s0.dd > 3 && rnd() < 0.5) put(1, s0.x, s0.z, 0.9 + rnd() * 1.4, { tilt: true });
    }
    // seagrass meadows in the shallows
    for (let c = n(3); c > 0; c--) {
      // (starting a little way out from the beach, and always short enough to stay under the water in a wave trough)
      const s0 = spot(1.5, 7); if (!s0) continue;
      for (let i = 0; i < 14; i++) {
        const x = s0.x + (rnd() - 0.5) * 6, z = s0.z + (rnd() - 0.5) * 6, dd = depthAt(x, z);
        if (dd > 1.4 && slopeAt(x, z) < 0.5) put(3, x, z, Math.min(0.8 + rnd() * 0.9, (dd - 0.7) / 0.62));
      }
    }
    // kelp forests in deeper water: tall fronds, never poking out of the sea
    for (let c = n(2); c > 0; c--) {
      const s0 = spot(2.5); if (!s0) continue;
      for (let i = 0; i < 10; i++) {
        const x = s0.x + (rnd() - 0.5) * 7, z = s0.z + (rnd() - 0.5) * 7, dd = depthAt(x, z);
        if (dd < 2.2) continue;
        const h = Math.min(dd - 0.6, 1.5 + rnd() * 4.5);
        put(2, x, z, 1, { sy: h });
      }
    }
    // corals on the shelf: staghorn, sea fans and brain corals in bright colours
    const CORAL = ['#ff7f6a', '#ff9fd0', '#c58aff', '#ffcf5a', '#7fd8ff', '#ff6a8a', '#9cff8a'];
    for (let c = n(3); c > 0; c--) {
      const s0 = spot(1.8, 9); if (!s0) continue;
      for (let i = 0; i < 6; i++) {
        const x = s0.x + (rnd() - 0.5) * 4, z = s0.z + (rnd() - 0.5) * 4, dd = depthAt(x, z); if (dd < 1.6) continue;
        const r = rnd(), col = CORAL[Math.floor(rnd() * CORAL.length)], cap = (dd - 0.7) / 0.6;   // the tallest corals are ~0.6 m at scale 1
        if (r < 0.5) put(4, x, z, Math.min(0.8 + rnd() * 1.4, cap), { col });
        else if (r < 0.75) put(5, x, z, Math.min(0.7 + rnd() * 1.2, cap), { col });
        else put(6, x, z, Math.min(0.6 + rnd() * 1.3, cap * 2), { col: ['#c9a86a', '#d68a6a', '#a8b86a'][Math.floor(rnd() * 3)] });
      }
    }
    // urchins, starfish and shells scattered about
    for (let i = n(10); i > 0; i--) { const s0 = spot(0.6); if (s0) put(7, s0.x, s0.z, 0.8 + rnd() * 0.6); }
    for (let i = n(7); i > 0; i--) { const s0 = spot(0.4, 10); if (s0) put(8, s0.x, s0.z, 0.8 + rnd() * 0.7, { col: ['#ff8a3a', '#e8503a', '#ffb84a', '#c84a8a'][Math.floor(rnd() * 4)] }); }
    for (let i = n(10); i > 0; i--) { const s0 = spot(0.6, 8); if (s0) put(9, s0.x, s0.z, 0.7 + rnd() * 0.8); }
    this.remember(key, out);
    return out;
  }
  private remember(key: string, v: Inst[]) { this.cache.set(key, v); if (this.cache.size > 160) this.cache.delete(this.cache.keys().next().value!); }

  /** px, pz: where the player is; under: head under water (for the light shafts and specks); eye: the camera */
  update(dt: number, px: number, pz: number, eye: { x: number; y: number; z: number }, under: boolean, active: boolean) {
    this.time += dt;
    if (active !== this.shown) { this.shown = active; for (const m of this.meshes) m.setEnabled(active); }
    this.shafts.setEnabled(active && under);
    this.snow.setEnabled(active && under);
    if (under && active) {
      this.shafts.position.set(eye.x, Math.min(0, eye.y + 12), eye.z);
      this.shaftMat.setFloat("shaft", this.atmo.day * Math.max(0.15, 1 - Math.max(0, -eye.y) / 25));
      this.shaftMat.setFloat("time", this.time);
      this.snowMat.setFloat("px", this.scene.getEngine().getRenderHeight() * 0.5 * (this.scene.activeCamera?.getProjectionMatrix().m[5] ?? 1.7));
      // specks drift and wrap round the camera
      const P = this.snowPos, t = performance.now() / 1000;
      for (let i = 0; i < P.length; i += 3) {
        P[i] += Math.sin(t * 0.3 + i) * 0.01; P[i + 1] += 0.004 + Math.sin(t * 0.5 + i * 0.7) * 0.003;
        for (let a = 0; a < 3; a++) { if (P[i + a] > 8) P[i + a] -= 16; else if (P[i + a] < -8) P[i + a] += 16; }
      }
      this.snow.position.set(eye.x, eye.y, eye.z);
      this.snow.updateVerticesData(VertexBuffer.PositionKind, P, false, false);
    }
    if (!active) return;
    if (Math.hypot(px - this.at.x, pz - this.at.z) < 6) return;
    this.at.x = px; this.at.z = pz;
    const R = this.radius, counts = this.meshes.map(() => 0);
    const t0 = Math.floor((px - R) / TILE), t1 = Math.floor((px + R) / TILE), u0 = Math.floor((pz - R) / TILE), u1 = Math.floor((pz + R) / TILE);
    const R2 = R * R;
    for (let i = t0; i <= t1; i++) for (let j = u0; j <= u1; j++) {
      const cx = (i + 0.5) * TILE - px, cz = (j + 0.5) * TILE - pz;
      if (cx * cx + cz * cz > (R + TILE) * (R + TILE)) continue;
      for (const it of this.tile(i, j)) {
        const e = it.m.elements, dx = e[12] - px, dz = e[14] - pz;
        if (dx * dx + dz * dz > R2) continue;
        const k = it.k; if (counts[k] >= this.caps[k]) continue;
        this.setMatrixAt(k, counts[k], it.m);
        if (it.c) this.setColorAt(k, counts[k], it.c);
        counts[k]++;
      }
    }
    this.meshes.forEach((m, k) => {
      m.thinInstanceCount = counts[k]; this.counts[k] = counts[k];
      m.thinInstanceBufferUpdated("matrix");
      if (this.bufs[k].c) m.thinInstanceBufferUpdated("color");
    });
  }

  /** how many things are drawn right now (for tests) */
  get drawn() { return this.counts.reduce((a, n) => a + n, 0); }
}

function mergeUV(parts: THREE.BufferGeometry[]) {
  const pos: number[] = [], uvs: number[] = [];
  for (const p of parts) { const n = p.index ? p.toNonIndexed() : p; const P = n.getAttribute('position'), U = n.getAttribute('uv'); for (let i = 0; i < P.count; i++) { pos.push(P.getX(i), P.getY(i), P.getZ(i)); uvs.push(U.getX(i), U.getY(i)); } }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return g;
}
