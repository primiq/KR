import type { Material, Mesh, Scene } from "@babylonjs/core";
import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Noise2D, mulberry32, smoothstep as sstep } from "../core/noise";
import type { Quality } from "../core/quality";
import type { ResNode } from "../game/nodes";
import { meshFromThree } from "../render/geometry";
import { Inst } from "../render/inst";
import { foliageMaterial, rockMaterial } from "../render/materials";
import { hash3 } from "./geo";
import { heightAt, inCut, riverDist, rockiness, slopeAt } from "./island";
import { buildBush, buildDryFrond, buildGrassTuft, buildJungleTree, buildPalm, buildStump } from "./plants";

/** gameplay objects: identical for every player, whatever their graphics setting */
const CANON = { palms: 200, trees: 130, rocks: 150, berries: 22 };
const CULL_TILE = 90;

export interface Collider { x: number; z: number; r: number }

/** Spatial hash of trunk/rock circles for the player controller. */
export class ColliderGrid {
    private cells = new Map<number, Collider[]>();
    private cell = 8;
    private key(i: number, j: number) { return (i * 73856093) ^ (j * 19349663); }
    add(c: Collider) {
        const k = this.key(Math.floor(c.x / this.cell), Math.floor(c.z / this.cell));
        let a = this.cells.get(k);
        if (!a) this.cells.set(k, (a = []));
        a.push(c);
    }
    remove(c: Collider) {
        const a = this.cells.get(this.key(Math.floor(c.x / this.cell), Math.floor(c.z / this.cell)));
        if (!a) return;
        const i = a.indexOf(c);
        if (i >= 0) a.splice(i, 1);
    }
    /** True if any collider circle overlaps the axis-aligned box. */
    anyIn(x0: number, z0: number, x1: number, z1: number, pad = 0): boolean {
        for (let i = Math.floor((x0 - 4) / this.cell); i <= Math.floor((x1 + 4) / this.cell); i++) {
            for (let j = Math.floor((z0 - 4) / this.cell); j <= Math.floor((z1 + 4) / this.cell); j++) {
                const a = this.cells.get(this.key(i, j));
                if (!a) continue;
                for (const c of a) {
                    const cx = Math.max(x0, Math.min(c.x, x1)), cz = Math.max(z0, Math.min(c.z, z1));
                    const r = c.r + pad;
                    if ((c.x - cx) ** 2 + (c.z - cz) ** 2 < r * r) return true;
                }
            }
        }
        return false;
    }
    near(x: number, z: number, rad: number, out: Collider[]) {
        const r2 = rad * rad;
        for (let i = Math.floor((x - rad) / this.cell); i <= Math.floor((x + rad) / this.cell); i++) {
            for (let j = Math.floor((z - rad) / this.cell); j <= Math.floor((z + rad) / this.cell); j++) {
                const a = this.cells.get(this.key(i, j));
                if (!a) continue;
                for (const c of a) if ((c.x - x) ** 2 + (c.z - z) ** 2 < r2) out.push(c);
            }
        }
        return out;
    }
    /** Push (x, z) out of any collider; returns the corrected position in `out`. */
    resolve(x: number, z: number, pr: number, out: { x: number; z: number }) {
        const ci = Math.floor(x / this.cell), cj = Math.floor(z / this.cell);
        for (let i = ci - 1; i <= ci + 1; i++) {
            for (let j = cj - 1; j <= cj + 1; j++) {
                const a = this.cells.get(this.key(i, j));
                if (!a) continue;
                for (const c of a) {
                    const dx = x - c.x, dz = z - c.z;
                    const min = c.r + pr;
                    const d2 = dx * dx + dz * dz;
                    if (d2 < min * min) {
                        const d = Math.sqrt(d2) || 1e-4;
                        x = c.x + (dx / d) * min;
                        z = c.z + (dz / d) * min;
                    }
                }
            }
        }
        out.x = x;
        out.z = z;
    }
}

export interface Placement { x: number; z: number; y: number; rot: number; scale: number; squash?: [number, number, number] }
export interface Zone { x: number; z: number; r: number }
type InstRef = { mesh: Inst; index: number; base: THREE.Matrix4 };

function scatter(count: number, rnd: () => number, minDist: number, radius: number, prob: (x: number, z: number, h: number, slope: number) => number, avoid?: Zone | Zone[]): Placement[] {
    const zones = avoid ? (Array.isArray(avoid) ? avoid : [avoid]) : [];
    const out: Placement[] = [];
    const cell = Math.max(minDist, 1);
    const grid = new Map<string, Placement[]>();
    const key = (i: number, j: number) => `${i},${j}`;
    let attempts = 0;
    while (out.length < count && attempts < count * 60) {
        attempts++;
        const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * radius;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (zones.some((q) => Math.hypot(x - q.x, z - q.z) < q.r)) continue;
        const h = heightAt(x, z);
        const s = slopeAt(x, z);
        if (rnd() > prob(x, z, h, s)) continue;
        const ci = Math.floor(x / cell), cj = Math.floor(z / cell);
        let ok = true;
        for (let i = ci - 1; i <= ci + 1 && ok; i++) for (let j = cj - 1; j <= cj + 1 && ok; j++) {
            const g = grid.get(key(i, j));
            if (!g) continue;
            for (const p of g) if ((p.x - x) ** 2 + (p.z - z) ** 2 < minDist * minDist) { ok = false; break; }
        }
        if (!ok) continue;
        const p: Placement = { x, z, y: h, rot: rnd() * Math.PI * 2, scale: 1 };
        out.push(p);
        const k = key(ci, cj);
        const g = grid.get(k);
        if (g) g.push(p);
        else grid.set(k, [p]);
    }
    return out;
}

/** Lowest ground under a circular footprint, so trunks and rocks sit on the downhill side instead of floating. */
function groundLow(x: number, z: number, r: number): number {
    let h = heightAt(x, z);
    for (let k = 0; k < 6; k++) {
        const a = k * (Math.PI / 3);
        h = Math.min(h, heightAt(x + Math.cos(a) * r, z + Math.sin(a) * r));
    }
    return h;
}

const _A = new THREE.Matrix4(), _R = new THREE.Matrix4(), _S = new THREE.Matrix4(), _T = new THREE.Matrix4();
const _Q = new THREE.Quaternion(), _V = new THREE.Vector3();

/** `detail` 2 = 180 triangles (close up), 1 = 80 (far away: the same shape), 0 = pebbles */
export function buildRockGeometry(seed: number, detail = 2): THREE.BufferGeometry {
    const g = new THREE.IcosahedronGeometry(1, detail);
    g.deleteAttribute("uv");
    g.deleteAttribute("normal");
    const pos = g.attributes.position as THREE.BufferAttribute;
    const s = seed * 1.37;
    for (let i = 0; i < pos.count; i++) {
        let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const l = Math.hypot(x, y, z);
        x /= l; y /= l; z /= l;
        const lobe = 0.2 * Math.sin(3.1 * x + s) * Math.cos(2.9 * y + 0.4 * s) * Math.sin(3.3 * z + 2.1);
        const r = 1 + lobe + 0.1 * hash3(x * 2 + s, y * 2, z * 2);
        y = y < -0.25 ? y * 0.45 : y;
        pos.setXYZ(i, x * r, y * r, z * r);
    }
    const merged = mergeVertices(g, 1e-4);
    merged.computeVertexNormals();
    merged.computeBoundingSphere();
    return merged;
}

interface GrassMemo { idx: Map<number, number>; data: Float64Array; n: number }

/**
 * Castaway's vegetation, rebuilt on Babylon thin instances: the same seeds, counts and placement rules (so node
 * indices match for multiplayer and saves), the same procedural palms, jungle trees, bushes and boulders, plus
 * distance LOD and tile culling. Every harvestable tree / rock / bush is a ResNode.
 */
export class Vegetation {
    readonly colliders = new ColliderGrid();
    private grassNoise = new Noise2D(77);
    private tiers: { mesh: Inst; cap: number; cell: number; r0: number; r1: number; seed: number; at: { x: number; z: number }; step: number; memo?: GrassMemo }[] = [];
    private grassR = 1;
    readonly nodes: ResNode[] = [];
    readonly palmPlacements: Placement[] = [];
    readonly perches: { x: number; y: number; z: number; node: ResNode; palm: boolean }[] = [];
    private seat: { m: Inst; i: number; mat: THREE.Matrix4; x: number; z: number; g0: number; y0: number; decor: boolean; hidden: boolean }[] = [];
    private cullable: { mesh: Inst; c: THREE.Vector3; r: number; far: boolean; lod: number }[] = [];
    private cullAt = { x: 1e9, z: 1e9 };
    private drawScale = 1;
    /** template meshes (no instances) for felled trees to clone */
    private templates = new Map<THREE.BufferGeometry, Mesh>();

    private track(m: Inst, i: number, mat: THREE.Matrix4, x: number, z: number, decor: boolean) {
        this.seat.push({ m, i, mat, x, z, g0: heightAt(x, z), y0: mat.elements[13], decor, hidden: false });
    }

    /** The ground inside this rectangle changed (foundation cut / restored): lift or sink what stands on it, hide loose scenery under slabs. */
    reseat(x0: number, z0: number, x1: number, z1: number) {
        const T = new THREE.Matrix4();
        const zero = new THREE.Matrix4().makeScale(0, 0, 0);
        const dirty = new Set<Inst>();
        for (const e of this.seat) {
            if (e.x < x0 || e.x > x1 || e.z < z0 || e.z > z1) continue;
            e.mat.elements[13] = e.y0 + (heightAt(e.x, e.z) - e.g0);
            if (e.decor) {
                const hide = inCut(e.x, e.z, 0.6);
                e.m.setMatrixAt(e.i, hide ? zero : e.mat);
                e.hidden = hide;
            } else {
                e.m.getMatrixAt(e.i, T);
                if (T.elements[0] === 0 && T.elements[5] === 0) continue;
                e.m.setMatrixAt(e.i, e.mat);
            }
            dirty.add(e.m);
        }
        for (const m of dirty) m.instanceMatrix.needsUpdate = true;
    }

    setDrawScale(k: number) {
        if (k !== this.drawScale) { this.drawScale = k; this.cullAt.x = 1e9; }
    }

    /** drop whole tiles of trees / rocks / bushes beyond the draw distance; swap to the light copies past the LOD distance */
    private cull(px: number, pz: number) {
        if (Math.hypot(px - this.cullAt.x, pz - this.cullAt.z) < 6) return;
        this.cullAt.x = px;
        this.cullAt.z = pz;
        const lim = this.q.treeCull * this.drawScale, hi = (this.q.name === "high" ? 1.5 : 1) * this.drawScale;
        for (const t of this.cullable) {
            const d = Math.hypot(t.c.x - px, t.c.z - pz) - t.r;
            if (!t.far) { t.mesh.visible = d < lim; continue; }
            const lod = Math.min(lim, t.lod * hi);
            t.mesh.visible = d < lod;
            t.mesh.farVisible = d >= lod && d < lim;
        }
    }

    /** a plain copy of a tree's geometry (for the felling animation) */
    template(geo: THREE.BufferGeometry): Mesh {
        let m = this.templates.get(geo);
        if (!m) {
            m = meshFromThree("fellTemplate", geo, this.scene);
            m.setEnabled(false);
            this.templates.set(geo, m);
        }
        return m;
    }

    constructor(
        private readonly scene: Scene,
        readonly q: Quality,
        avoids: Zone[],
    ) {
        let rnd = mulberry32(2024);
        const reseed = (n: number) => { rnd = mulberry32(n); };
        const cluster = new Noise2D(31);
        const shadows = q.shadows;
        const dummy = new THREE.Object3D();
        const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
        const spawn = avoids[0];
        const extra = avoids.slice(1);
        const leaflets = q.name === "high" ? 16 : q.name === "medium" ? 12 : 9;
        const palmMat = foliageMaterial(scene, "palm", 0.55);
        const treeMat = foliageMaterial(scene, "jungle", 0.28, false, 1.6);
        const bushMat = foliageMaterial(scene, "bush", 0.35, true, 0.7);
        const stumpMat = foliageMaterial(scene, "stump", 0);

        /** Instances a list of placements across geometry variants; returns one ref per placement. */
        const instanced = (name: string, geos: THREE.BufferGeometry[], mat: Material, list: Placement[], baseYOffset: number, scaleRange: [number, number], castShadow: boolean, footR = 0, decor = false, farGeos?: THREE.BufferGeometry[], lod = 85): InstRef[] => {
            const refs: InstRef[] = new Array(list.length);
            const buckets: number[][] = [], bucketGeo: number[] = [], tileOf = new Map<string, number>();
            list.forEach((p, i) => {
                if (scaleRange[1] > 0) p.scale = scaleRange[0] + rnd() * (scaleRange[1] - scaleRange[0]);
                if (footR > 0) p.y = groundLow(p.x, p.z, footR * p.scale * (p.squash ? (p.squash[0] + p.squash[2]) * 0.5 : 1));
                const gi = i % geos.length, k = `${gi}:${Math.floor(p.x / CULL_TILE)},${Math.floor(p.z / CULL_TILE)}`;
                let b = tileOf.get(k);
                if (b === undefined) { b = buckets.length; tileOf.set(k, b); buckets.push([]); bucketGeo.push(gi); }
                buckets[b].push(i);
            });
            // one Babylon mesh per geometry variant, copied per tile
            const src = geos.map((g, gi) => meshFromThree(`${name}${gi}`, g, scene));
            const farSrc = farGeos?.map((g, gi) => meshFromThree(`${name}${gi}_far`, g, scene));
            src.forEach((m) => m.setEnabled(false));
            farSrc?.forEach((m) => m.setEnabled(false));
            buckets.forEach((items, bi) => {
                if (!items.length) return;
                const gi = bucketGeo[bi];
                // each tile gets its own copy of the geometry: Babylon caches the vertex-array state (thin-instance buffer bindings
                // included) on the geometry, so tiles sharing one would draw each other's instance buffers
                const own = src[gi].clone(`${name}${gi}_${bi}`)!;
                own.makeGeometryUnique();
                const mesh = new Inst(name, own, mat, items.length, scene, castShadow && shadows);
                const c = new THREE.Vector3();
                items.forEach((li, k) => {
                    const p = list[li];
                    const sq = p.squash;
                    dummy.position.set(p.x, p.y + baseYOffset, p.z);
                    dummy.rotation.set(0, p.rot, 0);
                    dummy.scale.set(p.scale * (sq ? sq[0] : 1), p.scale * (sq ? sq[1] : 1), p.scale * (sq ? sq[2] : 1));
                    dummy.updateMatrix();
                    mesh.setMatrixAt(k, dummy.matrix);
                    refs[li] = { mesh, index: k, base: dummy.matrix.clone() };
                    this.track(mesh, k, refs[li].base, p.x, p.z, decor);
                    c.x += p.x / items.length;
                    c.z += p.z / items.length;
                });
                let r = 0;
                for (const li of items) r = Math.max(r, Math.hypot(list[li].x - c.x, list[li].z - c.z));
                mesh.instanceMatrix.needsUpdate = true;
                if (farSrc) {
                    const fm = farSrc[gi].clone(`${name}${gi}_${bi}_far`)!;
                    fm.makeGeometryUnique();
                    fm.material = mat;
                    fm.isPickable = false;
                    fm.receiveShadows = shadows;
                    fm.thinInstanceSetBuffer("matrix", mesh.array, 16, false);
                    fm.thinInstanceCount = items.length;
                    fm.setEnabled(false);
                    mesh.far = fm;
                }
                mesh.refreshBounds();
                this.cullable.push({ mesh, c, r: r + 12, far: !!farSrc, lod });
            });
            return refs;
        };
        /** Shake / shrink an instance about its footing (hit reactions, rocks wearing down). */
        const poser = (ref: InstRef, x: number, y: number, z: number) => (ang: number, ax: number, az: number, k: number) => {
            _A.makeTranslation(x, y, z);
            if (ang !== 0) { _Q.setFromAxisAngle(_V.set(ax, 0, az), ang); _A.multiply(_R.makeRotationFromQuaternion(_Q)); }
            if (k !== 1) _A.multiply(_S.makeScale(k, k, k));
            _A.multiply(_T.makeTranslation(-x, -y, -z)).multiply(ref.base);
            ref.mesh.setMatrixAt(ref.index, _A);
            ref.mesh.instanceMatrix.needsUpdate = true;
        };
        const hide = (r: InstRef) => { r.mesh.setMatrixAt(r.index, ZERO); r.mesh.instanceMatrix.needsUpdate = true; };
        const show = (r: InstRef, d: boolean) => { r.mesh.setMatrixAt(r.index, d ? ZERO : r.base); r.mesh.instanceMatrix.needsUpdate = true; };

        // ---- palms
        const palmGeos = [11, 23, 37].map((s) => buildPalm(s, leaflets));
        reseed(101);
        const palms = scatter(CANON.palms, rnd, 4.5, 300, (x, z, h, s) => {
            if (h < 1.6 || h > 13 || s > 0.5 || rockiness(x, z) > 0.3 || riverDist(x, z) < 4) return 0;
            const c = cluster.fbm(x * 0.02, z * 0.02, 2) * 0.5 + 0.5;
            return sstep(1.6, 3.2, h) * (1 - sstep(9, 14, h)) * (0.25 + 0.75 * c) + 0.05;
        }, avoids);
        const palmRefs = instanced("palm", palmGeos, palmMat, palms, -0.15, [0.85, 1.25], true, 0.3, false, [11, 23, 37].map((s) => buildPalm(s, leaflets, true)));

        // ---- jungle trees
        const treeGeos = [5, 17].map((s) => buildJungleTree(s));
        reseed(202);
        const trees = scatter(CANON.trees, rnd, 6.5, 300, (x, z, h, s) => {
            if (h < 6 || h > 36 || s > 0.62 || rockiness(x, z) > 0.3 || riverDist(x, z) < 4) return 0;
            const c = cluster.fbm(x * 0.015 + 9, z * 0.015 - 4, 2) * 0.5 + 0.5;
            return sstep(6, 15, h) * (0.3 + 0.7 * c);
        }, avoids);
        const treeRefs = instanced("jungle", treeGeos, treeMat, trees, -0.25, [0.9, 1.4], true, 0.45, false, [5, 17].map((s) => buildJungleTree(s, true)));
        this.palmPlacements.push(...palms);

        // ---- stumps (one slot per tree, shown when it is felled)
        const stumpMesh = new Inst("stump", buildStump(), stumpMat, palms.length + trees.length, scene, shadows);
        for (let i = 0; i < stumpMesh.cap; i++) stumpMesh.setMatrixAt(i, ZERO);
        stumpMesh.instanceMatrix.needsUpdate = true;
        let stumpIdx = 0;
        const stumpOn = new Uint8Array(stumpMesh.cap);
        const stumpCount = () => {
            let n = stumpOn.length;
            while (n > 0 && !stumpOn[n - 1]) n--;
            stumpMesh.count = n;
        };
        stumpCount();
        stumpMesh.mesh.alwaysSelectAsActiveMesh = true;

        const addTree = (kind: "palm" | "tree", p: Placement, ref: InstRef, colR: number, geo: THREE.BufferGeometry) => {
            const col: Collider = { x: p.x, z: p.z, r: colR };
            this.colliders.add(col);
            const sIdx = stumpIdx++;
            dummy.position.set(p.x, p.y - 0.05, p.z);
            dummy.rotation.set(0, p.rot, 0);
            dummy.scale.setScalar(p.scale);
            dummy.updateMatrix();
            const stumpBase = dummy.matrix.clone();
            this.track(stumpMesh, sIdx, stumpBase, p.x, p.z, false);
            const total = (kind === "palm" ? 55 : 95) * (0.8 + 0.2 * p.scale);
            this.nodes.push({
                kind, name: kind === "palm" ? "Palm Tree" : "Tree", gather: "wood",
                x: p.x, y: p.y, z: p.z, r: 0.55 * p.scale, offs: [0.9, 1.8, 2.7],
                total, left: total, depleted: false, respawnAt: 0, respawnTime: kind === "palm" ? 1500 : 2000,
                setDepleted: (d) => {
                    show(ref, d);
                    stumpMesh.setMatrixAt(sIdx, d ? stumpBase : ZERO);
                    stumpMesh.instanceMatrix.needsUpdate = true;
                    stumpOn[sIdx] = d ? 1 : 0;
                    stumpCount();
                    if (d) this.colliders.remove(col);
                    else this.colliders.add(col);
                },
                fall: { geo, mat: ref.mesh.mesh.material!, base: ref.base },
                pose: poser(ref, p.x, p.y, p.z),
            });
        };
        const tops = (geos: THREE.BufferGeometry[]) => geos.map((g) => {
            const P = g.getAttribute("position");
            let best = 0;
            for (let i = 1; i < P.count; i++) if (P.getY(i) > P.getY(best)) best = i;
            return new THREE.Vector3(P.getX(best), P.getY(best) - 0.25, P.getZ(best));
        });
        const palmTop = tops(palmGeos), treeTop = tops(treeGeos);
        const perch = (ref: InstRef, top: THREE.Vector3, palm: boolean) => {
            const v = top.clone().applyMatrix4(ref.base);
            this.perches.push({ x: v.x, y: v.y, z: v.z, node: this.nodes[this.nodes.length - 1], palm });
        };
        palms.forEach((p, i) => { addTree("palm", p, palmRefs[i], 0.32 * p.scale, palmGeos[i % palmGeos.length]); perch(palmRefs[i], palmTop[i % palmGeos.length], true); });
        trees.forEach((p, i) => { addTree("tree", p, treeRefs[i], 0.42 * p.scale, treeGeos[i % treeGeos.length]); perch(treeRefs[i], treeTop[i % treeGeos.length], false); });

        // ---- bushes (scenery)
        const bushGeos = [3, 8, 14].map((s) => buildBush(s));
        reseed(303);
        const bushes = scatter(q.bushes, rnd, 1.8, 300, (x, z, h, s) => {
            if (h < 2.5 || h > 32 || s > 0.62 || rockiness(x, z) > 0.3 || riverDist(x, z) < 3) return 0;
            const c = cluster.fbm(x * 0.03 + 3, z * 0.03 + 5, 2) * 0.5 + 0.5;
            return sstep(2.5, 6, h) * (0.3 + 0.7 * c);
        }, [{ x: spawn.x, z: spawn.z, r: 4 }, ...extra]);
        instanced("bush", bushGeos, bushMat, bushes, -0.05, [0.8, 1.5], false, 0.5, true, [3, 8, 14].map((s) => buildBush(s, "plain", true)), 40);

        // ---- berry bushes (harvestable): a full and a picked-bare copy of each
        reseed(404);
        const berries = scatter(CANON.berries, rnd, 6, 300, (x, z, h, s) => {
            if (h < 2.5 || h > 24 || s > 0.5 || rockiness(x, z) > 0.3 || riverDist(x, z) < 4) return 0;
            return sstep(2.5, 5, h) * 0.6;
        }, [{ x: spawn.x, z: spawn.z, r: 6 }, ...extra]);
        const berryFull = instanced("berry", [buildBush(21, "berry"), buildBush(22, "berry")], bushMat, berries, -0.05, [1.0, 1.4], false, 0, false, [21, 22].map((s) => buildBush(s, "berry", true)), 40);
        const berryBare = instanced("berryBare", [buildBush(21, "bare"), buildBush(22, "bare")], bushMat, berries.map((p) => ({ ...p })), -0.05, [0, 0], false, 0, false, [21, 22].map((s) => buildBush(s, "bare", true)), 40);
        berries.forEach((p, i) => {
            berryBare[i].base.copy(berryFull[i].base);
            hide(berryBare[i]);
            const full = berryFull[i], bare = berryBare[i];
            this.nodes.push({
                kind: "berry", name: "Berry Bush", gather: "berries",
                x: p.x, y: p.y, z: p.z, r: 0.95 * p.scale, offs: [0.6 * p.scale],
                total: 3, left: 3, depleted: false, respawnAt: 0, respawnTime: 300,
                setDepleted: (d) => { show(full, d); show(bare, !d); },
            });
        });

        // ---- rocks: stone boulders and metal-ore rocks, all harvestable
        const rockGeos = [1, 2, 3].map((s) => buildRockGeometry(s));
        const oreGeos = [4, 5].map((s) => buildRockGeometry(s));
        reseed(505);
        const rocks = scatter(CANON.rocks, rnd, 3, 300, (x, z, h, s) => {
            if (h < -2.2 || h > 70 || riverDist(x, z) < 3) return 0;
            let pr = rockiness(x, z) * 0.22;
            if (s > 0.3) pr += 0.8;
            else if (h > -1.5 && h < 2.5) pr += 0.12;
            else if (h > 2.5) pr += 0.04;
            return pr;
        }, [{ x: spawn.x, z: spawn.z, r: 8 }, ...extra]);
        rocks.forEach((p) => {
            p.squash = [1.0 + hash3(p.x, 1, 2) * 0.3, 0.62 + 0.25 * Math.abs(hash3(p.x, 5, 7)), 1.0 + hash3(p.z, 9, 4) * 0.3];
        });
        const isOre = rocks.map((p) => p.y > 1.0 && rnd() < 0.2);
        const stoneList = rocks.filter((_, i) => !isOre[i]);
        const oreList = rocks.filter((_, i) => isOre[i]);
        const stoneRefs = instanced("boulder", rockGeos, rockMaterial(scene), stoneList, -0.2, [0.9, 2.4], true, 0.75, false, [1, 2, 3].map((s) => buildRockGeometry(s, 1)), 55);
        const oreRefs = instanced("ore", oreGeos, rockMaterial(scene, true), oreList, -0.2, [0.8, 1.9], true, 0.75, false, [4, 5].map((s) => buildRockGeometry(s, 1)), 55);
        const addRock = (kind: "stone" | "ore", p: Placement, ref: InstRef) => {
            const sq = p.squash!;
            const col: Collider = { x: p.x, z: p.z, r: 0.8 * p.scale * (sq[0] + sq[2]) * 0.5 };
            this.colliders.add(col);
            const total = kind === "stone" ? 170 + 70 * p.scale : 40 + 20 * p.scale;
            this.nodes.push({
                kind, name: kind === "stone" ? "Boulder" : "Metal Ore", gather: kind === "stone" ? "stone" : "ore",
                x: p.x, y: p.y, z: p.z, r: 0.95 * p.scale * (sq[0] + sq[2]) * 0.5, offs: [0.45 * p.scale * sq[1]],
                total, left: total, depleted: false, respawnAt: 0, respawnTime: kind === "stone" ? 1500 : 3000,
                setDepleted: (d) => {
                    show(ref, d);
                    if (d) this.colliders.remove(col);
                    else this.colliders.add(col);
                },
                pose: poser(ref, p.x, p.y, p.z),
            });
        };
        stoneList.forEach((p, i) => addRock("stone", p, stoneRefs[i]));
        oreList.forEach((p, i) => addRock("ore", p, oreRefs[i]));

        // ---- ground detail: pebbles round boulders, dry fronds under the palms
        reseed(606);
        {
            const pebGeos = [7, 8].map((sd) => buildRockGeometry(sd, 0));
            const pebs: { x: number; y: number; z: number; s: number; r: number }[] = [];
            for (const p of rocks) {
                const n = 2 + Math.floor((hash3(p.x, p.z, 3) + 1) * 2.2);
                for (let k = 0; k < n; k++) {
                    const a = rnd() * Math.PI * 2, d = (0.95 + rnd() * 1.1) * p.scale;
                    const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d, h = heightAt(x, z);
                    if (h < 0.15) continue;
                    pebs.push({ x, y: h, z, s: 0.07 + rnd() * 0.16, r: rnd() * 6.28 });
                }
            }
            pebGeos.forEach((geo, gi) => {
                const items = pebs.filter((_, i) => i % pebGeos.length === gi);
                if (!items.length) return;
                const mesh = new Inst("pebbles", geo, rockMaterial(scene), items.length, scene);
                items.forEach((o, i) => {
                    dummy.position.set(o.x, o.y - o.s * 0.2, o.z);
                    dummy.rotation.set(rnd() * 0.5, o.r, rnd() * 0.5);
                    dummy.scale.set(o.s * 1.2, o.s * 0.8, o.s);
                    dummy.updateMatrix();
                    mesh.setMatrixAt(i, dummy.matrix);
                    this.track(mesh, i, dummy.matrix.clone(), o.x, o.z, true);
                });
                mesh.instanceMatrix.needsUpdate = true;
                mesh.refreshBounds();
            });
            const fronds: { x: number; y: number; z: number; yaw: number; pitch: number; s: number }[] = [];
            for (const p of palms) {
                const n = 1 + Math.floor(rnd() * 3);
                for (let k = 0; k < n; k++) {
                    const a = rnd() * Math.PI * 2, d = 0.7 + rnd() * 2.4;
                    const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d, yaw = rnd() * Math.PI * 2, s = 0.7 + rnd() * 0.7;
                    const x2 = x - Math.sin(yaw) * 1.8 * s, z2 = z - Math.cos(yaw) * 1.8 * s;
                    const h1 = heightAt(x, z), h2 = heightAt(x2, z2);
                    if (h1 < 0.8 || h2 < 0.8) continue;
                    fronds.push({ x, y: Math.min(h1, h2) + 0.03, z, yaw, pitch: Math.atan2(h2 - h1, 1.8 * s), s });
                }
            }
            if (fronds.length) {
                const mesh = new Inst("dryFronds", buildDryFrond(), foliageMaterial(scene, "dryFrond", 0.0001), fronds.length, scene);
                mesh.mesh.material!.backFaceCulling = false;
                fronds.forEach((o, i) => {
                    dummy.position.set(o.x, o.y, o.z);
                    dummy.rotation.set(o.pitch, o.yaw, 0, "YXZ");
                    dummy.scale.setScalar(o.s);
                    dummy.updateMatrix();
                    mesh.setMatrixAt(i, dummy.matrix);
                    this.track(mesh, i, dummy.matrix.clone(), o.x, o.z, true);
                });
                dummy.rotation.order = "XYZ";
                mesh.instanceMatrix.needsUpdate = true;
                mesh.refreshBounds();
            }
        }

        // ---- grass: three rings round the player, each thinning into the next
        const grassMat = foliageMaterial(scene, "grass", 0.5, true, 0.35);
        const R = q.name === "high" ? [16, 40, 70] : q.name === "medium" ? [12, 30, 50] : [10, 22, 36];
        const C = q.name === "high" ? [0.55, 1.1, 2.0] : q.name === "medium" ? [0.7, 1.4, 2.4] : [0.85, 1.7, 2.8];
        const spec = [
            { r0: 0, r1: R[0], cell: C[0], seed: 0, step: 3, far: false },
            { r0: R[0], r1: R[1], cell: C[1], seed: 1, step: 6, far: true },
            { r0: R[1], r1: R[2], cell: C[2], seed: 2, step: 10, far: true },
        ];
        this.grassR = R[2];
        for (const t of spec) {
            const inner = t.r0 * 0.65;
            const cap = Math.min(Math.ceil((Math.PI * (t.r1 ** 2 - inner ** 2)) / t.cell ** 2), 30000);
            const mesh = new Inst("grass", buildGrassTuft(t.far), grassMat, cap, scene);
            mesh.count = 0;
            mesh.mesh.alwaysSelectAsActiveMesh = true;
            this.tiers.push({ mesh, cap, cell: t.cell, r0: t.r0, r1: t.r1, seed: t.seed, at: { x: 1e9, z: 1e9 }, step: t.step });
        }
    }

    /** frame-time governor (headset): 0 = everything, 1 = no far grass, 2 = near grass only, 3 = no grass */
    setGrassDetail(level: number) {
        this.tiers.forEach((t, i) => { t.mesh.visible = level <= 0 || (level === 1 ? i < 2 : level === 2 ? i < 1 : false); });
    }

    update(px: number, pz: number, force = false) {
        if (force) for (const t of this.tiers) t.memo = undefined;
        this.cull(px, pz);
        for (const t of this.tiers) this.updateTier(t, px, pz, force);
    }

    private updateTier(t: (typeof this.tiers)[number], px: number, pz: number, force: boolean) {
        if (!force && Math.hypot(px - t.at.x, pz - t.at.z) < t.step) return;
        t.at.x = px;
        t.at.z = pz;
        const { cell, r0, r1, seed } = t;
        const Rf = this.grassR, inner = r0 * 0.65;
        const arr = t.mesh.array;
        let n = 0;
        const i0 = Math.floor((px - r1) / cell), i1 = Math.floor((px + r1) / cell);
        const j0 = Math.floor((pz - r1) / cell), j1 = Math.floor((pz + r1) / cell);
        const o1 = seed * 1.7;
        let memo = t.memo;
        if (!memo || memo.idx.size > 160000) memo = t.memo = { idx: new Map(), data: new Float64Array(5 * 4096), n: 0 };
        for (let j = j0; j <= j1; j++) {
            for (let i = i0; i <= i1; i++) {
                if (n >= t.cap) break;
                const key = (i + 32768) * 65536 + (j + 32768);
                let at = memo.idx.get(key);
                if (at === undefined) {
                    at = -1;
                    const ra = (hash3(i, j, 1.3 + o1) + 1) * 0.5, rb = (hash3(i, j, 7.1 + o1) + 1) * 0.5;
                    const r3 = (hash3(i, j, 3.9 + o1) + 1) * 0.5, r4 = (hash3(i, j, 11.7 + o1) + 1) * 0.5, r5 = (hash3(i, j, 5.3 + o1) + 1) * 0.5;
                    const x = (i + ra) * cell, z = (j + rb) * cell;
                    const h = heightAt(x, z);
                    if (!(h < 2.2 || inCut(x, z, 0.6) || rockiness(x, z) > 0.35 || riverDist(x, z) < 1.6)) {
                        const patch = this.grassNoise.fbm(x * 0.05, z * 0.05, 2) * 0.5 + 0.5;
                        const mask = sstep(2.3, 4.2, h) * (0.55 + 0.45 * patch);
                        if (!(r4 > mask) && !(slopeAt(x, z, 0.5) > 0.7)) {
                            if ((memo.n + 1) * 5 > memo.data.length) { const g = new Float64Array(memo.data.length * 2); g.set(memo.data); memo.data = g; }
                            at = memo.n++;
                            const D = memo.data, b = at * 5;
                            D[b] = x; D[b + 1] = z; D[b + 2] = h; D[b + 3] = r3; D[b + 4] = r5;
                        }
                    }
                    memo.idx.set(key, at);
                }
                if (at < 0) continue;
                const D = memo.data, b = at * 5, x = D[b], z = D[b + 1], h = D[b + 2], r3 = D[b + 3], r5 = D[b + 4];
                const d = Math.hypot(x - px, z - pz);
                if (d > r1 || d < inner) continue;
                const fadeIn = r0 > 0 ? sstep(r0 * 0.65, r0, d) : 1;
                const fadeOut = r1 < Rf ? 1 - sstep(r1 * 0.65, r1, d) : 1 - sstep(r1 * 0.8, r1, d);
                const share = fadeIn * fadeOut;
                if (share <= 0 || r5 > share) continue;
                const sc = (0.7 + 0.7 * r3) * (1 + 1.6 * sstep(8, Rf, d));
                const rot = r3 * Math.PI * 2, c = Math.cos(rot) * sc, s = Math.sin(rot) * sc;
                const o = n * 16;
                arr[o] = c; arr[o + 1] = 0; arr[o + 2] = -s; arr[o + 3] = 0;
                arr[o + 4] = 0; arr[o + 5] = sc; arr[o + 6] = 0; arr[o + 7] = 0;
                arr[o + 8] = s; arr[o + 9] = 0; arr[o + 10] = c; arr[o + 11] = 0;
                arr[o + 12] = x; arr[o + 13] = h - 0.03; arr[o + 14] = z; arr[o + 15] = 1;
                n++;
            }
        }
        t.mesh.count = n;
        t.mesh.instanceMatrix.needsUpdate = true;
    }
}
