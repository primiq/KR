import { BoundingInfo, Color3, Constants, DynamicTexture, type Material, Matrix, Mesh, MeshBuilder, PBRMaterial, Quaternion, type Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
import * as THREE from "three";
import { meshFromThree } from "./geometry";
import { VColorGlowPlugin } from "./vcGlow";
import { shadowCasters } from "./inst";

/** how many lights every lit material makes room for (8; 5 in a headset, where each one is a cost on every pixel) */
export const lightRoom = { n: 8 };

export interface MirrorOptions {
    /** a Babylon material for a three material (null: the default translation) */
    custom?: (m: THREE.Material) => Material | null;
    /** merged into every Babylon mesh's metadata (e.g. { keepUnderground: true }) */
    tag?: Record<string, unknown>;
    /** draw into this Babylon rendering group (1: over the world, with its own depth: the first-person hands) */
    group?: number;
    /** a Babylon layer mask for every mesh (e.g. one no camera sees, for a copy only a mirror draws) */
    layerMask?: number;
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

/** `bones`: the bone matrices it was last skinned with */
interface SkinView { mesh: Mesh; pos: Float32Array; seen: number; bones: Float32Array | null }

/** `last`: how many instances it drew last frame; `dirty`: something moved, appeared or changed colour since */
interface Bucket { key: string; sphere: [number, number, number, number]; mesh: Mesh; data: Float32Array; cap: number; n: number; col: Float32Array | null; last: number; dirty: boolean }

/** a matrix into a bucket's buffer, noting whether it changed (most of the world stands still: no upload then) */
function putMatrix(b: Bucket, src: ArrayLike<number>) {
    const d = b.data, o = b.n * 16;
    // (three's matrices are doubles, the buffer floats: compare what would be stored)
    if (!b.dirty) for (let k = 0; k < 16; k++) if (d[o + k] !== Math.fround(src[k])) { b.dirty = true; break; }
    if (b.dirty) d.set(src as Float32Array, o);
}
function putColour(b: Bucket, r: number, g: number, bl: number, a: number) {
    const c = b.col!, o = b.n * 4;
    if (c[o] !== Math.fround(r) || c[o + 1] !== Math.fround(g) || c[o + 2] !== Math.fround(bl) || c[o + 3] !== Math.fround(a)) { b.dirty = true; c[o] = r; c[o + 1] = g; c[o + 2] = bl; c[o + 3] = a; }
}

const _im = new THREE.Matrix4(), _wm = new THREE.Matrix4();
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
    private skins = new Map<THREE.SkinnedMesh, SkinView>();
    private memo = new WeakMap<THREE.Object3D, { g: THREE.BufferGeometry; m: THREE.Material; b: Bucket }>();
    private liveMats: { m: THREE.MeshStandardMaterial; p: PBRMaterial }[] = [];
    private live: { map: THREE.Texture; tex: DynamicTexture; version: number }[] = [];
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
                const p = new PBRMaterial(`mirror_${m.name}`, this.scene); p.maxSimultaneousLights = lightRoom.n;
                p.albedoColor = Color3.White();
                p.roughness = 0.84;
                p.metallic = 0;
                return p;
            })();
        } else if (map && (map as THREE.CanvasTexture).image) {
            const p = new PBRMaterial(`mirror_tex${this.id(m)}`, this.scene); p.maxSimultaneousLights = lightRoom.n;
            const img = map.image as HTMLCanvasElement | ImageBitmap | HTMLImageElement;
            const isCanvas = typeof HTMLCanvasElement !== "undefined" && img instanceof HTMLCanvasElement;
            // (a decoded image, e.g. from a .glb: copied onto a canvas once)
            let cv: HTMLCanvasElement;
            if (isCanvas) cv = img as HTMLCanvasElement;
            else {
                cv = document.createElement("canvas");
                const el = img as HTMLImageElement;
                const loading = typeof HTMLImageElement !== "undefined" && el instanceof HTMLImageElement && !el.complete;
                cv.width = loading ? 2 : img.width; cv.height = loading ? 2 : img.height;
                if (!loading) cv.getContext("2d")!.drawImage(img as CanvasImageSource, 0, 0);
                // (a texture still loading, a photo say: drawn and uploaded once it arrives)
                else el.addEventListener("load", () => { cv.width = el.width; cv.height = el.height; cv.getContext("2d")!.drawImage(el, 0, 0); this.mats.get(m)?.getActiveTextures().forEach((tx) => (tx as DynamicTexture).update?.(map.flipY !== false)); }, { once: true });
            }
            const t = new DynamicTexture("mirrorCanvas", cv, { scene: this.scene, invertY: map.flipY !== false } as never);
            t.update(map.flipY !== false);
            t.wrapU = t.wrapV = 1;
            // a canvas that keeps changing (the warp level's screen, a picture): re-uploaded when three's version moves on
            if (isCanvas) this.live.push({ map, tex: t, version: map.version });
            if (m.type === "MeshBasicMaterial") {
                // unlit: the canvas as it is
                const u = new StandardMaterial(`mirror_screen${this.id(m)}`, this.scene); u.maxSimultaneousLights = lightRoom.n;
                u.disableLighting = true;
                u.emissiveTexture = t;
                u.backFaceCulling = m.side !== THREE.DoubleSide;
                if (!m.depthTest) { u.depthFunction = Constants.ALWAYS; u.disableDepthWrite = true; }
                if (map.magFilter === THREE.NearestFilter) t.updateSamplingMode(1);
                p.dispose();
                this.mats.set(m, u);
                return u;
            }
            p.albedoTexture = t;
            if (isCanvas) { p.emissiveTexture = t; p.emissiveColor = new Color3(0.3, 0.3, 0.3); }
            p.roughness = (anyM as THREE.MeshStandardMaterial).roughness ?? 0.8;
            p.metallic = 0;
            p.backFaceCulling = m.side !== THREE.DoubleSide;
            if (m.alphaTest > 0) { t.hasAlpha = true; p.useAlphaFromAlbedoTexture = true; p.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST; p.alphaCutOff = m.alphaTest; }
            b = p;
        } else if (m.type === "MeshStandardMaterial" || m.type === "MeshPhysicalMaterial") {
            const p = new PBRMaterial(`mirror_std${this.id(m)}`, this.scene); p.maxSimultaneousLights = lightRoom.n;
            const c = anyM.color, e = anyM.emissive;
            p.albedoColor = new Color3(c.r, c.g, c.b);
            p.emissiveColor = new Color3(e.r, e.g, e.b);
            p.roughness = anyM.roughness;
            p.metallic = anyM.metalness;
            p.backFaceCulling = m.side !== THREE.DoubleSide;
            if (m.side === THREE.DoubleSide) p.twoSidedLighting = true;
            if (m.transparent || m.opacity < 1) {
                p.alpha = m.opacity;
                p.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
                if (!m.depthWrite) p.disableDepthWrite = true;
            }
            if (m.polygonOffset) p.zOffset = m.polygonOffsetFactor;
            // glow from the vertex colours; emissive / opacity that the game changes over time (a town's windows at night)
            if (m.userData.vcGlow) new VColorGlowPlugin(p, m.userData.vcGlow);
            if (m.userData.liveEmissive) this.liveMats.push({ m: anyM, p });
            b = p;
        } else {
            const s = new StandardMaterial(`mirror_basic${this.id(m)}`, this.scene); s.maxSimultaneousLights = lightRoom.n;
            s.disableLighting = true;
            const c = anyM.color ?? new THREE.Color(1, 1, 1);
            s.emissiveColor = new Color3(c.r, c.g, c.b).toGammaSpace();
            s.backFaceCulling = m.side !== THREE.DoubleSide;
            // depth only (a boat's hull lid keeps the sea out of it): drawn with the opaque world, before the water
            if (!m.colorWrite) { s.disableColorWrite = true; s.backFaceCulling = false; }
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

    private bucket(g: THREE.BufferGeometry, m: THREE.Material, src?: THREE.Object3D): Bucket {
        // (remembered per three mesh: building the key string for every mesh every frame added up. Not in its userData:
        //  three copies that through JSON when an object is cloned)
        const memo = src ? this.memo.get(src) : undefined;
        if (memo && memo.g === g && memo.m === m && this.buckets.get(memo.b.key) === memo.b) return memo.b;
        const key = `${this.id(g)}:${this.id(m)}`;
        let b = this.buckets.get(key);
        if (b && src) this.memo.set(src, { g, m, b });
        if (!b) {
            const mesh = meshFromThree("mirror", g, this.scene);
            mesh.material = this.material(m);
            mesh.isPickable = false;
            mesh.receiveShadows = true;
            if (this.opts.tag) mesh.metadata = { ...this.opts.tag };
            if (this.opts.group) mesh.renderingGroupId = this.opts.group;
            if (this.opts.layerMask !== undefined) mesh.layerMask = this.opts.layerMask;
            // a three.js group can tag the Babylon meshes drawn for it (userData.babylonTag): the sky room's mirror uses this
            for (let o: THREE.Object3D | null = src ?? null; o; o = o.parent) if (o.userData.babylonTag) { mesh.metadata = { ...(mesh.metadata ?? {}), ...o.userData.babylonTag }; break; }
            // (culled like any other mesh: its bounds are worked out from its instances whenever they change, in sync())
            const lit = !(mesh.material instanceof StandardMaterial);
            if (this.shadows && lit) shadowCasters.add(mesh);
            const cap = 8;
            const data = new Float32Array(cap * 16);
            mesh.thinInstanceSetBuffer("matrix", data, 16, false);
            mesh.thinInstanceCount = 0;
            mesh.setEnabled(false);
            // (its geometry's bounding sphere, for culling: the Babylon mesh's own is computed from its instances)
            if (!g.boundingSphere) g.computeBoundingSphere();
            const gs = g.boundingSphere!;
            const sphere: [number, number, number, number] = [gs.center.x, gs.center.y, gs.center.z, Number.isFinite(gs.radius) ? gs.radius : 1];
            b = { key, sphere, mesh, data, cap, n: 0, col: null, last: -1, dirty: true };
            mesh.doNotSyncBoundingInfo = true;
            this.buckets.set(key, b);
            // the three geometry went away (a cave chunk dropped, a rig rebuilt): free its Babylon copy too
            g.addEventListener("dispose", () => { const q = this.buckets.get(key); if (!q) return; shadowCasters.delete(q.mesh); q.mesh.dispose(false, false); this.buckets.delete(key); });
        }
        if (src) this.memo.set(src, { g, m, b });
        return b;
    }

    /** a skinned mesh (Mario): skinned on the CPU every frame into its own Babylon mesh, in world space */
    private skin(m: THREE.SkinnedMesh) {
        let v = this.skins.get(m);
        const P = m.geometry.getAttribute("position");
        if (!v) {
            const mesh = meshFromThree("mirrorSkin", m.geometry, this.scene);
            mesh.material = this.material(Array.isArray(m.material) ? m.material[0] : m.material);
            mesh.isPickable = false;
            mesh.receiveShadows = true;
            mesh.alwaysSelectAsActiveMesh = true;
            if (this.opts.tag) mesh.metadata = { ...this.opts.tag };
            if (this.opts.group) mesh.renderingGroupId = this.opts.group;
            if (this.opts.layerMask !== undefined) mesh.layerMask = this.opts.layerMask;
            if (this.shadows) shadowCasters.add(mesh);
            mesh.rotationQuaternion = new Quaternion();
            v = { mesh, pos: new Float32Array(P.count * 3), seen: 0, bones: null };
            mesh.setVerticesData("position", v.pos, true);
            this.skins.set(m, v);
        }
        m.skeleton.update();
        // skinned straight from the bone matrices (what three's applyBoneTransform does, a vertex at a time, many times
        // slower); and not at all while the bones are still
        const bm = m.skeleton.boneMatrices!;
        if (!v.bones || v.bones.length !== bm.length) v.bones = new Float32Array(bm.length).fill(NaN);
        let moved = false;
        for (let k = 0; k < bm.length; k++) if (bm[k] !== v.bones[k]) { moved = true; break; }
        if (moved) {
            v.bones.set(bm);
            const src = P.array as ArrayLike<number>, si = m.geometry.getAttribute("skinIndex").array as ArrayLike<number>, sw = m.geometry.getAttribute("skinWeight").array as ArrayLike<number>;
            const B = m.bindMatrix.elements, BI = m.bindMatrixInverse.elements, out = v.pos;
            const ident = (e: ArrayLike<number>) => e[0] === 1 && e[5] === 1 && e[10] === 1 && e[15] === 1 && e[1] === 0 && e[2] === 0 && e[4] === 0 && e[6] === 0 && e[8] === 0 && e[9] === 0 && e[12] === 0 && e[13] === 0 && e[14] === 0;
            const bindI = ident(B) && ident(BI);
            for (let i = 0; i < P.count; i++) {
                let x = src[i * 3], y = src[i * 3 + 1], z = src[i * 3 + 2];
                if (!bindI) { const X = B[0] * x + B[4] * y + B[8] * z + B[12], Y = B[1] * x + B[5] * y + B[9] * z + B[13], Z = B[2] * x + B[6] * y + B[10] * z + B[14]; x = X; y = Y; z = Z; }
                let ox = 0, oy = 0, oz = 0;
                for (let j = 0; j < 4; j++) {
                    const w = sw[i * 4 + j];
                    if (w === 0) continue;
                    const o = si[i * 4 + j] * 16;
                    ox += w * (bm[o] * x + bm[o + 4] * y + bm[o + 8] * z + bm[o + 12]);
                    oy += w * (bm[o + 1] * x + bm[o + 5] * y + bm[o + 9] * z + bm[o + 13]);
                    oz += w * (bm[o + 2] * x + bm[o + 6] * y + bm[o + 10] * z + bm[o + 14]);
                }
                if (!bindI) { const X = BI[0] * ox + BI[4] * oy + BI[8] * oz + BI[12], Y = BI[1] * ox + BI[5] * oy + BI[9] * oz + BI[13], Z = BI[2] * ox + BI[6] * oy + BI[10] * oz + BI[14]; ox = X; oy = Y; oz = Z; }
                out[i * 3] = ox; out[i * 3 + 1] = oy; out[i * 3 + 2] = oz;
            }
            v.mesh.updateVerticesData("position", out, false, false);
        }
        Matrix.FromArray(m.matrixWorld.elements).decompose(v.mesh.scaling, v.mesh.rotationQuaternion!, v.mesh.position);
        v.mesh.setEnabled(true);
        v.seen = this.frame;
    }

    /**
     * The box round all of a bucket's instances (its geometry's bounding sphere, moved and scaled by each one), so it is
     * culled like any other mesh. (Babylon's own thinInstanceRefreshBoundingInfo upset the rest of the scene here.)
     */
    private bound(b: Bucket) {
        const [cx, cy, cz, r] = b.sphere, d = b.data;
        let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
        for (let i = 0; i < b.n; i++) {
            const o = i * 16;
            const wx = d[o] * cx + d[o + 4] * cy + d[o + 8] * cz + d[o + 12], wy = d[o + 1] * cx + d[o + 5] * cy + d[o + 9] * cz + d[o + 13], wz = d[o + 2] * cx + d[o + 6] * cy + d[o + 10] * cz + d[o + 14];
            const sc = Math.sqrt(Math.max(d[o] ** 2 + d[o + 1] ** 2 + d[o + 2] ** 2, d[o + 4] ** 2 + d[o + 5] ** 2 + d[o + 6] ** 2, d[o + 8] ** 2 + d[o + 9] ** 2 + d[o + 10] ** 2));
            const rr = r * sc + 0.05;
            if (wx - rr < x0) x0 = wx - rr; if (wy - rr < y0) y0 = wy - rr; if (wz - rr < z0) z0 = wz - rr;
            if (wx + rr > x1) x1 = wx + rr; if (wy + rr > y1) y1 = wy + rr; if (wz + rr > z1) z1 = wz + rr;
        }
        b.mesh.setBoundingInfo(new BoundingInfo(new Vector3(x0, y0, z0), new Vector3(x1, y1, z1)));
    }

    private grow(b: Bucket) {
        if (b.n < b.cap) return;
        b.cap *= 2;
        const d = new Float32Array(b.cap * 16);
        d.set(b.data);
        b.data = d;
        b.mesh.thinInstanceSetBuffer("matrix", d, 16, false);
        if (b.col) { const c = new Float32Array(b.cap * 4); c.set(b.col); b.col = c; b.mesh.thinInstanceSetBuffer("color", c, 4, false); }
        // (a new buffer resets the instance count to its size: set it again)
        b.last = -1; b.dirty = true;
    }

    /** this bucket draws an instanced mesh with colours or a fade: give it a per-instance colour buffer */
    private colours(b: Bucket) {
        b.col = new Float32Array(b.cap * 4).fill(1);
        b.mesh.thinInstanceSetBuffer("color", b.col, 4, false);
        b.last = -1; b.dirty = true;
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
            if (this.opts.group) plane.renderingGroupId = this.opts.group;
            if (this.opts.layerMask !== undefined) plane.layerMask = this.opts.layerMask;
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
            if ((m as THREE.SkinnedMesh).isSkinnedMesh) this.skin(m as THREE.SkinnedMesh);
            else if (m.isMesh && !(o as THREE.Sprite).isSprite) {
                const mt = Array.isArray(m.material) ? m.material[0] : m.material;
                const b = this.bucket(m.geometry, mt, m);
                // basic materials can fade (beacons): follow the three material's opacity
                const bm = b.mesh.material;
                if (bm instanceof StandardMaterial && (mt.transparent || mt.opacity < 1)) bm.alpha = mt.opacity;
                const im = m as THREE.InstancedMesh;
                if (im.isInstancedMesh) {
                    // every instance: the mesh's world matrix times the instance matrix; colours (and a fade, footprints) per instance
                    const ia = im.instanceMatrix.array as Float32Array, ic = im.instanceColor?.array as Float32Array | undefined;
                    const alpha = im.userData.instanceAlpha as Float32Array | undefined;
                    if ((ic || alpha) && !b.col) this.colours(b);
                    for (let i = 0; i < im.count; i++) {
                        const o16 = i * 16;
                        if (ia[o16] === 0 && ia[o16 + 1] === 0 && ia[o16 + 2] === 0 && ia[o16 + 5] === 0) continue; // a hidden (zero-scaled) slot
                        if (alpha && alpha[i] <= 0.003) continue;
                        this.grow(b);
                        _im.fromArray(ia, o16);
                        _wm.multiplyMatrices(im.matrixWorld, _im);
                        putMatrix(b, _wm.elements);
                        if (b.col) {
                            if (ic) putColour(b, ic[i * 3], ic[i * 3 + 1], ic[i * 3 + 2], alpha ? alpha[i] : 1);
                            else putColour(b, 1, 1, 1, alpha ? alpha[i] : 1);
                        }
                        b.n++;
                    }
                } else {
                    this.grow(b);
                    putMatrix(b, m.matrixWorld.elements);
                    if (b.col) putColour(b, 1, 1, 1, 1);
                    b.n++;
                }
            }
            for (const c of o.children) walk(c);
        };
        walk(this.root);
        // only what changed goes to the GPU, and gets its bounds worked out again (for culling)
        for (const b of this.buckets.values()) {
            if (b.n !== b.last) { b.dirty = true; b.last = b.n; b.mesh.thinInstanceCount = b.n; b.mesh.setEnabled(b.n > 0); }
            if (!b.dirty) continue;
            b.dirty = false;
            if (b.n) {
                b.mesh.thinInstanceBufferUpdated("matrix");
                if (b.col) b.mesh.thinInstanceBufferUpdated("color");
                this.bound(b);
            }
        }
        for (const v of this.skins.values()) if (v.seen !== this.frame) v.mesh.setEnabled(false);
        for (const { m, p } of this.liveMats) { const k = m.emissiveIntensity; p.emissiveColor.set(m.emissive.r * k, m.emissive.g * k, m.emissive.b * k); p.albedoColor.set(m.color.r, m.color.g, m.color.b); if (m.transparent) p.alpha = m.opacity; }
        for (const l of this.live) if (l.map.version !== l.version) { l.version = l.map.version; l.tex.update(l.map.flipY !== false); }
        for (const [s, v] of this.sprites) {
            if (v.seen === this.frame) continue;
            v.plane.setEnabled(false);
            // gone for good (a removed name tag or bubble): free it
            if (this.frame - v.seen > 300) { v.plane.dispose(); v.tex.dispose(); v.mat.dispose(); this.sprites.delete(s); }
        }
    }
}
