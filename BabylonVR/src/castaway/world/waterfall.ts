// The mountain stream and its waterfall: a flowing ribbon laid along the carved gully (it simply follows the ground, so where the
// land drops away at the sea cliff it becomes a falling sheet), a churning plunge pool at the foot and drifting mist.
// Babylon port: the ribbon and the foam are Babylon shader materials (Castaway's are TSL node materials); the mist is
// three.js sprites, drawn by render/mirror.ts.
import { Effect, Mesh, MeshBuilder, type Scene, ShaderMaterial, VertexBuffer, VertexData } from "@babylonjs/core";
import * as THREE from "three";
import { NOISE_GLSL } from "../render/materials";
import type { Atmosphere } from "./atmosphere";
import { RIVER, heightAt } from "./island";

const WIDTH = 3.4;

Effect.ShadersStore["castawayFallsVertexShader"] = `
precision highp float;
attribute vec3 position;
attribute vec3 flow;
uniform mat4 viewProjection;
varying vec3 vFlow;
void main() { vFlow = flow; gl_Position = viewProjection * vec4(position, 1.0); }`;
Effect.ShadersStore["castawayFallsFragmentShader"] = `
precision highp float;
uniform float time;
uniform float day;
uniform float lean;
varying vec3 vFlow;
${NOISE_GLSL}
void main() {
    // flow = (across 0..1, metres along the stream, how steep: 0 a stream .. 1 a falling sheet)
    float across = vFlow.x, along = vFlow.y, fk = vFlow.z;
    float sp = 1.1 + fk * 7.5;
    float u = across - 0.5;
    float n1 = cNoise(vec3(across * 7.0, along * 0.55 - time * sp, time * 0.15));
    float n2 = lean > 0.5 ? n1 : cNoise(vec3(across * 17.0 + 3.0, along * 1.6 - time * sp * 1.4, 1.7));
    float streak = clamp(n1 * 0.6 + n2 * 0.35 + 0.35 + fk * 0.4, 0.0, 1.0);
    vec3 body = mix(vec3(0.16, 0.55, 0.66), vec3(0.62, 0.9, 0.96), clamp(fk * 0.5 + 0.15, 0.0, 1.0));
    vec3 col = mix(body, vec3(1.0), smoothstep(0.55, 0.95, streak) * (0.4 + fk * 0.6)) * (day * 0.65 + 0.35);
    float edge = 1.0 - smoothstep(0.32, 0.5, abs(u));
    gl_FragColor = vec4(pow(col, vec3(1.0 / 2.2)), edge * (0.72 + fk * 0.22));
}`;

Effect.ShadersStore["castawayPoolVertexShader"] = `
precision highp float;
attribute vec3 position;
uniform mat4 world;
uniform mat4 viewProjection;
varying vec3 vW;
void main() { vec4 w = world * vec4(position, 1.0); vW = w.xyz; gl_Position = viewProjection * w; }`;
Effect.ShadersStore["castawayPoolFragmentShader"] = `
precision highp float;
uniform float time;
uniform float day;
uniform vec2 foot;
varying vec3 vW;
${NOISE_GLSL}
void main() {
    float r = length(vW.xz - foot);
    float ring = cNoise(vec3(vW.x * 1.3, vW.z * 1.3, time * 1.1)) * 0.5 + 0.5;
    float a = (1.0 - smoothstep(1.5, 6.5, r)) * smoothstep(0.25, 0.7, ring + (1.0 - smoothstep(0.0, 4.0, r)) * 0.5) * 0.9;
    gl_FragColor = vec4(pow(vec3(0.93, 0.98, 1.0) * (day * 0.8 + 0.2), vec3(1.0 / 2.2)), a);
}`;

function buildRibbon(): { pos: number[]; flow: number[]; idx: number[]; foot: { x: number; z: number } } | null {
    // resample the polyline finely (every 0.5 m) so the sheet follows steep ground closely
    const pts: { x: number; z: number }[] = [];
    for (let i = 0; i < RIVER.length - 1; i++) {
        const a = RIVER[i], b = RIVER[i + 1], L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(L / 0.5));
        for (let k = 0; k < n; k++) pts.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
    }
    if (pts.length < 2) return null;
    // stop where the water meets the sea
    let end = pts.length;
    const ys = pts.map((p) => heightAt(p.x, p.z));
    for (let i = 0; i < pts.length; i++) if (ys[i] < 0.15) { end = i + 1; break; }
    const P = pts.slice(0, end), Y = ys.slice(0, end);
    const pos: number[] = [], flow: number[] = [], idx: number[] = [];
    let d = 0;
    for (let i = 0; i < P.length; i++) {
        const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
        let tx = b.x - a.x, tz = b.z - a.z; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
        const nx = -tz, nz = tx;
        if (i > 0) d += Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z);
        const dy = Y[Math.min(P.length - 1, i + 1)] - Y[Math.max(0, i - 1)];
        const slope = Math.min(1, Math.abs(dy) / (tl || 1) / 1.6);
        const w = WIDTH * (0.55 + 0.45 * Math.min(1, i / 30)) * (1 + 0.25 * slope);
        const y = Y[i] + 0.42;
        for (const sg of [-1, 1]) {
            pos.push(P[i].x + nx * w * 0.5 * sg, y, P[i].z + nz * w * 0.5 * sg);
            flow.push(sg < 0 ? 0 : 1, d, slope);
        }
        if (i > 0) { const k = (i - 1) * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    const last = P[P.length - 1];
    return { pos, flow, idx, foot: { x: last.x, z: last.z } };
}

function mistTexture(): THREE.CanvasTexture {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const x = c.getContext("2d")!, g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,0.55)"); g.addColorStop(0.5, "rgba(235,248,255,0.22)"); g.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Waterfall {
    /** the mist sprites (three.js, under the nature root) */
    readonly group = new THREE.Group();
    readonly foot = { x: 1e6, z: 1e6 };
    private meshes: Mesh[] = [];
    private mats: ShaderMaterial[] = [];
    private mist: { s: THREE.Sprite; t: number; sp: number; ox: number; oz: number }[] = [];
    private time = 0;

    constructor(scene: Scene, root: THREE.Object3D, private readonly atmo: Atmosphere, lean: boolean) {
        const r = buildRibbon();
        if (!r) return;
        this.foot.x = r.foot.x; this.foot.z = r.foot.z;
        const ribbon = new Mesh("falls", scene);
        const vd = new VertexData();
        vd.positions = r.pos;
        vd.indices = r.idx;
        vd.applyToMesh(ribbon, false);
        ribbon.setVerticesData("flow", r.flow, false, 3);
        const rm = new ShaderMaterial("fallsMat", scene, "castawayFalls", {
            attributes: [VertexBuffer.PositionKind, "flow"],
            uniforms: ["viewProjection", "time", "day", "lean"],
            needAlphaBlending: true,
        });
        rm.backFaceCulling = false;
        rm.disableDepthWrite = true;
        rm.zOffset = -2;
        rm.setFloat("lean", lean ? 1 : 0);
        ribbon.material = rm;
        ribbon.alwaysSelectAsActiveMesh = true;
        ribbon.isPickable = false;

        // churning foam where the fall lands
        const pool = MeshBuilder.CreateDisc("fallsPool", { radius: 7, tessellation: 28 }, scene);
        pool.rotation.x = Math.PI / 2;
        pool.position.set(r.foot.x, 0.06, r.foot.z);
        const pm = new ShaderMaterial("poolMat", scene, "castawayPool", {
            attributes: [VertexBuffer.PositionKind],
            uniforms: ["world", "viewProjection", "time", "day", "foot"],
            needAlphaBlending: true,
        });
        pm.disableDepthWrite = true;
        pm.backFaceCulling = false;
        pm.setVector2("foot", { x: r.foot.x, y: r.foot.z } as never);
        pool.material = pm;
        pool.isPickable = false;
        for (const m of [ribbon, pool]) m.alphaIndex = 3;
        this.meshes = [ribbon, pool];
        this.mats = [rm, pm];

        // mist hanging round the base
        const shared = new THREE.SpriteMaterial({ map: mistTexture(), transparent: true, depthWrite: false });
        shared.opacity = 0.32;
        const N = lean ? 8 : 18;
        for (let i = 0; i < N; i++) {
            const s = new THREE.Sprite(shared);
            s.renderOrder = 4; s.frustumCulled = false;
            this.group.add(s);
            this.mist.push({ s, t: i / N, sp: 0.18 + (i % 5) * 0.03, ox: Math.cos(i * 2.4) * 2.2, oz: Math.sin(i * 2.4) * 2.2 });
        }
        root.add(this.group);
    }

    update(dt: number, px: number, pz: number, hidden = false) {
        const near = !hidden && Math.hypot(px - this.foot.x, pz - this.foot.z) < 260;
        this.group.visible = near;
        for (const m of this.meshes) m.setEnabled(near);
        if (!near) return;
        this.time += dt;
        for (const m of this.mats) { m.setFloat("time", this.time); m.setFloat("day", this.atmo.day); }
        for (const m of this.mist) {
            m.t = (m.t + dt * m.sp) % 1;
            const k = m.t;
            m.s.position.set(this.foot.x + m.ox * (1 + k), 0.8 + k * 9, this.foot.z + m.oz * (1 + k));
            const sc = (5 + k * 9) * Math.sin(k * Math.PI) ** 0.5; // fades by shrinking away at both ends
            m.s.scale.set(sc, sc, 1);
        }
    }
}
