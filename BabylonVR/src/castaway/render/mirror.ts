import { Color3, Constants, DynamicTexture, type Material, Mesh, MeshBuilder, PBRMaterial, type Scene, StandardMaterial } from "@babylonjs/core";
import * as THREE from "three";
import { meshFromThree } from "./geometry";
import { shadowCasters } from "./inst";

export interface MirrorOptions {
    /** a Babylon material for a three material (null: the default translation) */
    custom?: (m: THREE.Material) => Material | null;
    /** merged into every Babylon mesh's metadata (e.g. { keepUnderground: true }) */
    tag?: Record<string, unknown>;
}

/** a soft round glow, for sprites that have no texture (cave crystal halos) */
const haloCanvas = new Map<string, HTMLCanvasElement>();
function softDot(col: THREE.Color) {
    const key = col.getHexString();
    let c = haloCanvas.get(key);
    if (c) return c;
    c = document.createElement("canvas"); c.width = c.height = 64;
    const g = c.getContext("2d")!;
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    const r = Math.round(col.r * 255), gg = Math.round(col.g * 255), b = Math.round(col.b * 255);
    for (let i = 0; i <= 8; i++) { const t = i / 8, a = Math.pow(Math.max(0, 1 - t), 2); gr.addColorStop(t, `rgba(${r},${gg},${b},${a.toFixed(3)})`); }
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    haloCanvas.set(key, c);
    return c;
}

interface Bucket { mesh: Mesh; data: Float32Array; cap: number; n: number }
interface SpriteView { plane: Mesh; mat: StandardMaterial; tex: DynamicTexture; version: number; seen: number }

/**
 * Draws a three.js scene graph (Castaway's animal and player rigs, animated by its own code) with Babylon. Every frame
 * the visible three meshes' world matrices are written into one thin-instanced Babylon mesh per geometry + material,
 * so a whole herd of jointed creatures costs a handful of draw calls (three's matrix layout is Babylon's). Materials
 * are translated once: vertex-coloured bodies, flat-coloured / additive basics, canvas-textured plates. three.js
 * sprites (name tags, health bars, chat bubbles) become billboard planes that follow their canvases.
 */
export class ThreeMirror {
    private buckets = new Map<string, Bucket>();
    private mats = new Map<THREE.Material, Material>();
    private sprites = new Map<THREE.Sprite, SpriteView>();
    private frame = 0;
    private ids = new WeakMap<object, number>();
    private nextId = 1;

    constructor(
        private readonly scene: Scene,
        private readonly root: THREE.Object3D,
        private readonly fallback: Material | null,
        private readonly shadows: boolean,
        private readonly opts: MirrorOptions = {},
    ) {}

    private id(o: object) {
        let i = this.ids.get(o);
        if (!i) { i = this.nextId++; this.ids.set(o, i); }
        return i;
    }

    private material(m: THREE.Material): Material {
        let b = this.mats.get(m);
        if (b) return b;
        const c0 = this.opts.custom?.(m);
        if (c0) { this.mats.set(m, c0); return c0; }
        const anyM = m as THREE.MeshBasicMaterial & THREE.MeshStandardMaterial;
        const map = anyM.map as THREE.CanvasTexture | null | undefined;
        if (m.name === "body" || m.name === "animal" || (!map && m.type === "MeshBasicMaterial" && anyM.vertexColors)) {
            b = this.fallback ?? (() => {
                const p = new PBRMaterial(`mirror_${m.name}`, this.scene);
                p.albedoColor = Color3.White();
                p.roughness = 0.84;
                p.metallic = 0;
                return p;
            })();
        } else if (map && (map as THREE.CanvasTexture).image) {
            const p = new PBRMaterial(`mirror_tex${this.id(m)}`, this.scene);
            const t = new DynamicTexture("mirrorCanvas", map.image as HTMLCanvasElement, { scene: this.scene });
            t.update();
            p.albedoTexture = t;
            p.emissiveTexture = t;
            p.emissiveColor = new Color3(0.3, 0.3, 0.3);
            p.roughness = 0.8;
            p.metallic = 0;
            b = p;
        } else if (m.type === "MeshStandardMaterial" && !m.transparent) {
            const p = new PBRMaterial(`mirror_std${this.id(m)}`, this.scene);
            const c = anyM.color, e = anyM.emissive;
            p.albedoColor = new Color3(c.r, c.g, c.b);
            p.emissiveColor = new Color3(e.r, e.g, e.b);
            p.roughness = anyM.roughness;
            p.metallic = anyM.metalness;
            p.backFaceCulling = m.side !== THREE.DoubleSide;
            b = p;
        } else {
            const s = new StandardMaterial(`mirror_basic${this.id(m)}`, this.scene);
            s.disableLighting = true;
            const c = anyM.color ?? new THREE.Color(1, 1, 1);
            s.emissiveColor = new Color3(c.r, c.g, c.b).toGammaSpace();
            s.backFaceCulling = m.side !== THREE.DoubleSide;
            if (m.transparent || m.opacity < 1) {
                s.alpha = m.opacity;
                s.disableDepthWrite = true;
                if (m.blending === THREE.AdditiveBlending) s.alphaMode = Constants.ALPHA_ADD;
            }
            b = s;
        }
        this.mats.set(m, b);
        return b;
    }

    private bucket(g: THREE.BufferGeometry, m: THREE.Material): Bucket {
        const key = `${this.id(g)}:${this.id(m)}`;
        let b = this.buckets.get(key);
        if (!b) {
            const mesh = meshFromThree("mirror", g, this.scene);
            mesh.material = this.material(m);
            mesh.isPickable = false;
            mesh.receiveShadows = true;
            if (this.opts.tag) mesh.metadata = { ...this.opts.tag };
            mesh.alwaysSelectAsActiveMesh = true;
            const lit = !(mesh.material instanceof StandardMaterial);
            if (this.shadows && lit) shadowCasters.add(mesh);
            const cap = 8;
            const data = new Float32Array(cap * 16);
            mesh.thinInstanceSetBuffer("matrix", data, 16, false);
            mesh.thinInstanceCount = 0;
            mesh.setEnabled(false);
            b = { mesh, data, cap, n: 0 };
            this.buckets.set(key, b);
            // the three geometry went away (a cave chunk dropped, a rig rebuilt): free its Babylon copy too
            g.addEventListener("dispose", () => { const q = this.buckets.get(key); if (!q) return; shadowCasters.delete(q.mesh); q.mesh.dispose(false, false); this.buckets.delete(key); });
        }
        return b;
    }

    private sprite(s: THREE.Sprite) {
        let v = this.sprites.get(s);
        const mat = s.material as THREE.SpriteMaterial;
        const map = mat.map as THREE.CanvasTexture | null;
        if (!v) {
            const img = (map?.image as HTMLCanvasElement | undefined) ?? softDot(mat.color ?? new THREE.Color(1, 1, 1));
            const plane = MeshBuilder.CreatePlane("mirrorSprite", { size: 1 }, this.scene);
            plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
            plane.isPickable = false;
            plane.renderingGroupId = 1;
            if (this.opts.tag) plane.metadata = { ...this.opts.tag };
            const tex = new DynamicTexture("mirrorSpriteTex", img, { scene: this.scene });
            tex.hasAlpha = true;
            tex.update();
            const sm = new StandardMaterial("mirrorSpriteMat", this.scene);
            sm.disableLighting = true;
            sm.emissiveTexture = tex;
            sm.opacityTexture = tex;
            sm.disableDepthWrite = true;
            sm.backFaceCulling = false;
            if (mat.blending === THREE.AdditiveBlending) sm.alphaMode = Constants.ALPHA_ADD;
            plane.material = sm;
            v = { plane, mat: sm, tex, version: map?.version ?? 0, seen: 0 };
            this.sprites.set(s, v);
        }
        if (map && map.version !== v.version) { v.version = map.version; v.tex.update(); }
        const e = s.matrixWorld.elements;
        v.plane.position.set(e[12], e[13], e[14]);
        v.plane.scaling.set(Math.hypot(e[0], e[1], e[2]), Math.hypot(e[4], e[5], e[6]), 1);
        v.mat.alpha = mat.opacity;
        v.plane.setEnabled(true);
        v.seen = this.frame;
    }

    sync() {
        this.frame++;
        this.root.updateMatrixWorld(true);
        for (const b of this.buckets.values()) b.n = 0;
        const walk = (o: THREE.Object3D) => {
            if (!o.visible) return;
            if ((o as THREE.Sprite).isSprite) this.sprite(o as THREE.Sprite);
            const m = o as THREE.Mesh;
            if (m.isMesh && !(o as THREE.Sprite).isSprite) {
                const mt = Array.isArray(m.material) ? m.material[0] : m.material;
                const b = this.bucket(m.geometry, mt);
                // basic materials can fade (beacons): follow the three material's opacity
                const bm = b.mesh.material;
                if (bm instanceof StandardMaterial && (mt.transparent || mt.opacity < 1)) bm.alpha = mt.opacity;
                if (b.n >= b.cap) {
                    b.cap *= 2;
                    const d = new Float32Array(b.cap * 16);
                    d.set(b.data);
                    b.data = d;
                    b.mesh.thinInstanceSetBuffer("matrix", d, 16, false);
                }
                b.data.set(m.matrixWorld.elements, b.n * 16);
                b.n++;
            }
            for (const c of o.children) walk(c);
        };
        walk(this.root);
        for (const b of this.buckets.values()) {
            b.mesh.thinInstanceCount = b.n;
            b.mesh.setEnabled(b.n > 0);
            if (b.n) b.mesh.thinInstanceBufferUpdated("matrix");
        }
        for (const [s, v] of this.sprites) {
            if (v.seen === this.frame) continue;
            v.plane.setEnabled(false);
            // gone for good (a removed name tag or bubble): free it
            if (this.frame - v.seen > 300) { v.plane.dispose(); v.tex.dispose(); v.mat.dispose(); this.sprites.delete(s); }
        }
    }
}
