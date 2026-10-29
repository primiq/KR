import { Color3, Mesh, MeshBuilder, PBRMaterial, Quaternion, type Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
import type { Flowers, FlowerHit } from "../world/flowers";
import * as THREE from "three";
import { clamp, mulberry32 } from "../core/noise";
import { shakeFoliage } from "../render/foliage";
import { Inst, shadowCasters } from "../render/inst";
import { rockMaterial, solid } from "../render/materials";
import { heightAt, RIVER_SPRING, slopeAt } from "../world/island";
import type { Vegetation, Zone } from "../world/vegetation";
import { type ItemId } from "./items";
import type { ResNode } from "./nodes";

export type HitFx = "wood" | "stone" | "ore" | "leaf" | "ember" | "flesh" | "water" | "sand";

const _c = new THREE.Color(), _fv = new Vector3();
const _n = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _qy = new THREE.Quaternion();

// ---------------------------------------------------------------- particles
/** Debris: chunks, splinters, leaves and embers that fall, bounce on the real terrain and settle. Plus soft dust puffs. */
class Particles {
    private readonly N = 420;
    private mesh: Mesh;
    private mat = new Float32Array(420 * 16);
    private col = new Float32Array(420 * 4);
    private pos = new Float32Array(420 * 3);
    private vel = new Float32Array(420 * 3);
    private rot = new Float32Array(420 * 3);
    private spin = new Float32Array(420 * 3);
    private scl = new Float32Array(420 * 3);
    private life = new Float32Array(420);
    private max = new Float32Array(420);
    private grav = new Float32Array(420);
    private drag = new Float32Array(420);
    private bounce = new Float32Array(420);
    private flutter = new Float32Array(420);
    private next = 0;
    private dummy = new THREE.Object3D();
    private any = false;
    private clock = 0;
    private colorsDirty = false;

    private readonly D = 48;
    private dust: Mesh;
    private dmat = new Float32Array(48 * 16);
    private dpos = new Float32Array(48 * 3);
    private dvel = new Float32Array(48 * 3);
    private dlife = new Float32Array(48);
    private dmax = new Float32Array(48);
    private dsize = new Float32Array(48);
    private dnext = 0;
    private dany = false;

    /** a hidden instance: scale 0, but w = 1 (an all-zero matrix would throw its vertices to infinity) */
    private hide(a: Float32Array, i: number) {
        a.fill(0, i * 16, i * 16 + 16);
        a[i * 16 + 15] = 1;
    }

    constructor(scene: Scene) {
        for (let i = 0; i < this.N; i++) this.hide(this.mat, i);
        for (let i = 0; i < this.D; i++) this.hide(this.dmat, i);
        this.mesh = MeshBuilder.CreateBox("debris", { size: 1 }, scene);
        const m = new PBRMaterial("debrisMat", scene);
        m.metallic = 0;
        m.roughness = 0.9;
        m.albedoColor = Color3.White();
        this.mesh.material = m;
        this.mesh.isPickable = false;
        this.col.fill(1);
        this.mesh.thinInstanceSetBuffer("matrix", this.mat, 16, false);
        this.mesh.thinInstanceSetBuffer("color", this.col, 4, false);
        this.mesh.alwaysSelectAsActiveMesh = true;
        this.mesh.metadata = { keepUnderground: true };

        this.dust = MeshBuilder.CreateIcoSphere("dust", { radius: 1, subdivisions: 1 }, scene);
        const dm = new StandardMaterial("dustMat", scene);
        dm.disableLighting = true;
        dm.emissiveColor = Color3.FromHexString("#e2d2ae").toLinearSpace();
        dm.alpha = 0.32;
        dm.disableDepthWrite = true;
        this.dust.material = dm;
        this.dust.isPickable = false;
        this.dust.metadata = { keepUnderground: true };
        this.dust.thinInstanceSetBuffer("matrix", this.dmat, 16, false);
        this.dust.alwaysSelectAsActiveMesh = true;
    }

    private add(x: number, y: number, z: number, vx: number, vy: number, vz: number, hex: number, sx: number, sy: number, sz: number, life: number, grav = 9, drag = 0.4, bounce = 0.35, flutter = 0) {
        const i = this.next;
        this.next = (this.next + 1) % this.N;
        const o = i * 3;
        this.pos[o] = x; this.pos[o + 1] = y; this.pos[o + 2] = z;
        this.vel[o] = vx; this.vel[o + 1] = vy; this.vel[o + 2] = vz;
        this.rot[o] = Math.random() * 6.28; this.rot[o + 1] = Math.random() * 6.28; this.rot[o + 2] = Math.random() * 6.28;
        const sp = 6 + Math.random() * 9;
        this.spin[o] = (Math.random() - 0.5) * sp; this.spin[o + 1] = (Math.random() - 0.5) * sp; this.spin[o + 2] = (Math.random() - 0.5) * sp;
        this.scl[o] = sx; this.scl[o + 1] = sy; this.scl[o + 2] = sz;
        this.life[i] = this.max[i] = life;
        this.grav[i] = grav; this.drag[i] = drag; this.bounce[i] = bounce; this.flutter[i] = flutter;
        _c.setHex(hex);
        const k = 0.85 + Math.random() * 0.3;
        this.col.set([_c.r * k, _c.g * k, _c.b * k, 1], i * 4);
        this.colorsDirty = true;
        this.any = true;
    }

    /** Material chips from a hit. */
    burst(p: Vector3, colors: number[], kind: HitFx, n: number, speed: number) {
        const pick = () => colors[Math.floor(Math.random() * colors.length)];
        for (let k = 0; k < n; k++) {
            const a = Math.random() * 6.283, sp = speed * (0.35 + Math.random() * 0.75);
            const vx = Math.cos(a) * sp, vz = Math.sin(a) * sp, vy = 1.2 + Math.random() * speed * 0.8;
            if (kind === "wood") {
                if (Math.random() < 0.55) this.add(p.x, p.y, p.z, vx, vy, vz, pick(), 0.018, 0.018, 0.1 + Math.random() * 0.1, 1.1 + Math.random() * 0.8);
                else this.add(p.x, p.y, p.z, vx, vy, vz, pick(), 0.05 + Math.random() * 0.04, 0.025, 0.06 + Math.random() * 0.04, 1.2 + Math.random() * 0.8);
            } else if (kind === "leaf") this.add(p.x, p.y, p.z, vx * 0.5, vy * 0.3, vz * 0.5, pick(), 0.1, 0.012, 0.06, 1.6 + Math.random() * 1.2, 1.4, 1.6, 0.0, 1);
            else if (kind === "ember") this.add(p.x, p.y, p.z, vx * 0.4, vy * 0.9, vz * 0.4, pick(), 0.028, 0.028, 0.028, 0.5 + Math.random() * 0.5, 2.5, 0.8, 0, 0);
            else if (kind === "water") {
                const s = 0.02 + Math.random() * 0.03;
                this.add(p.x, p.y, p.z, vx * 0.5, 1.5 + Math.random() * speed * 0.9, vz * 0.5, pick(), s, s * 1.6, s, 0.5 + Math.random() * 0.5, 9, 0.2, -1);
            } else if (kind === "sand") {
                const s = 0.015 + Math.random() * 0.025;
                this.add(p.x, p.y, p.z, vx * 0.6, vy * 0.7, vz * 0.6, pick(), s, s * 0.8, s, 0.6 + Math.random() * 0.5, 9, 0.3, 0.1);
            } else if (kind === "flesh") {
                const s = 0.025 + Math.random() * 0.03;
                this.add(p.x, p.y, p.z, vx * 0.8, vy * 0.8, vz * 0.8, pick(), s, s, s, 0.7 + Math.random() * 0.6, 9, 0.3, 0.2);
            } else {
                const s = 0.035 + Math.random() * 0.06;
                const ore = kind === "ore" && Math.random() < 0.35;
                this.add(p.x, p.y, p.z, vx, vy, vz, pick(), s * (0.8 + Math.random() * 0.6), s * (0.6 + Math.random() * 0.6), s * (0.8 + Math.random() * 0.6), (ore ? 0.9 : 1.4) + Math.random() * 1.0, 10, 0.3, 0.38);
            }
        }
        if (kind === "stone" || kind === "ore") this.puff(p, 0.28, 2, 0.6);
    }

    scatterLeaves(c: Vector3, colors: number[], n: number, spread: number) {
        for (let k = 0; k < n; k++) {
            const a = Math.random() * 6.283, d = Math.random() * spread;
            this.add(c.x + Math.cos(a) * d, c.y + Math.random() * 0.8, c.z + Math.sin(a) * d, (Math.random() - 0.5) * 2, 1 + Math.random() * 2.5, (Math.random() - 0.5) * 2, colors[Math.floor(Math.random() * colors.length)], 0.18, 0.015, 0.1, 2.2 + Math.random() * 1.6, 1.8, 1.2, 0, 1);
        }
    }

    puff(p: Vector3, size: number, n: number, rise: number) {
        for (let k = 0; k < n; k++) {
            const i = this.dnext;
            this.dnext = (this.dnext + 1) % this.D;
            const a = Math.random() * 6.283, o = i * 3;
            this.dpos[o] = p.x + Math.cos(a) * size * 0.3; this.dpos[o + 1] = p.y + 0.05; this.dpos[o + 2] = p.z + Math.sin(a) * size * 0.3;
            this.dvel[o] = Math.cos(a) * (0.4 + Math.random() * 0.8); this.dvel[o + 1] = rise * (0.5 + Math.random() * 0.8); this.dvel[o + 2] = Math.sin(a) * (0.4 + Math.random() * 0.8);
            this.dlife[i] = this.dmax[i] = 0.7 + Math.random() * 0.6;
            this.dsize[i] = size * (0.7 + Math.random() * 0.7);
        }
        this.dany = true;
    }

    update(dt: number) {
        this.clock += dt;
        const d = this.dummy;
        if (this.any) {
            let alive = false;
            for (let i = 0; i < this.N; i++) {
                if (this.life[i] <= 0) continue;
                this.life[i] -= dt;
                const o = i * 3;
                if (this.life[i] <= 0) { this.hide(this.mat, i); continue; }
                alive = true;
                const dg = Math.exp(-this.drag[i] * dt);
                this.vel[o] *= dg;
                this.vel[o + 2] *= dg;
                this.vel[o + 1] -= this.grav[i] * dt;
                if (this.flutter[i]) {
                    this.vel[o] += Math.sin(this.clock * 5 + i) * 1.6 * dt;
                    this.vel[o + 2] += Math.cos(this.clock * 4.3 + i * 1.7) * 1.6 * dt;
                    if (this.vel[o + 1] < -1.1) this.vel[o + 1] = -1.1;
                }
                this.pos[o] += this.vel[o] * dt; this.pos[o + 1] += this.vel[o + 1] * dt; this.pos[o + 2] += this.vel[o + 2] * dt;
                const rest = Math.max(this.scl[o], this.scl[o + 1], this.scl[o + 2]) * 0.4;
                const g = heightAt(this.pos[o], this.pos[o + 2]);
                let moving = true;
                if (this.bounce[i] < 0) { if (this.pos[o + 1] < 0.03) this.life[i] = Math.min(this.life[i], 0.04); }
                else if (g < -0.05) this.life[i] = Math.min(this.life[i], 0.08);
                else if (this.pos[o + 1] < g + rest) {
                    this.pos[o + 1] = g + rest;
                    if (this.vel[o + 1] < -0.8 && this.bounce[i] > 0) this.vel[o + 1] = -this.vel[o + 1] * this.bounce[i];
                    else this.vel[o + 1] = 0;
                    this.vel[o] *= 0.55; this.vel[o + 2] *= 0.55;
                    this.spin[o] *= 0.5; this.spin[o + 1] *= 0.5; this.spin[o + 2] *= 0.5;
                    moving = Math.abs(this.vel[o + 1]) > 0.01 || Math.hypot(this.vel[o], this.vel[o + 2]) > 0.05;
                }
                if (moving) { this.rot[o] += this.spin[o] * dt; this.rot[o + 1] += this.spin[o + 1] * dt; this.rot[o + 2] += this.spin[o + 2] * dt; }
                d.position.set(this.pos[o], this.pos[o + 1], this.pos[o + 2]);
                d.rotation.set(this.rot[o], this.rot[o + 1], this.rot[o + 2]);
                const f = Math.min(1, (this.life[i] / this.max[i]) * 5);
                d.scale.set(this.scl[o] * f, this.scl[o + 1] * f, this.scl[o + 2] * f);
                d.updateMatrix();
                this.mat.set(d.matrix.elements, i * 16);
            }
            this.mesh.thinInstanceBufferUpdated("matrix");
            if (this.colorsDirty) { this.mesh.thinInstanceBufferUpdated("color"); this.colorsDirty = false; }
            this.any = alive;
        }
        if (this.dany) {
            let alive = false;
            d.rotation.set(0, 0, 0);
            for (let i = 0; i < this.D; i++) {
                if (this.dlife[i] <= 0) continue;
                this.dlife[i] -= dt;
                const o = i * 3;
                if (this.dlife[i] <= 0) { this.hide(this.dmat, i); continue; }
                alive = true;
                const u = 1 - this.dlife[i] / this.dmax[i];
                const dg = Math.exp(-2.2 * dt);
                this.dvel[o] *= dg; this.dvel[o + 1] *= dg; this.dvel[o + 2] *= dg;
                this.dpos[o] += this.dvel[o] * dt; this.dpos[o + 1] += this.dvel[o + 1] * dt; this.dpos[o + 2] += this.dvel[o + 2] * dt;
                d.position.set(this.dpos[o], this.dpos[o + 1], this.dpos[o + 2]);
                d.scale.setScalar(this.dsize[i] * (0.35 + 1.5 * Math.sqrt(u)) * (1 - u * u * u));
                d.updateMatrix();
                this.dmat.set(d.matrix.elements, i * 16);
            }
            this.dust.thinInstanceBufferUpdated("matrix");
            this.dany = alive;
        }
    }
}

const FX_COLORS: Record<HitFx, number[]> = {
    wood: [0xcfa468, 0xe2c08a, 0x8a5e34, 0x6b4426],
    leaf: [0x5f9a2e, 0x8cc43c, 0x3f7a22, 0xb5c94a],
    stone: [0xb8b4aa, 0x8f8b84, 0xd0ccc2, 0x6f6b64],
    ore: [0xe0893f, 0x8f8b84, 0xf0b070, 0x5b5249],
    ember: [0xff9a2e, 0xffd25a, 0xff6a1a],
    flesh: [0xb02a35, 0x7a1a22, 0xd04050],
    water: [0xcfeaf5, 0xffffff, 0x8fd0e6],
    sand: [0xf0d9a0, 0xe2c48a, 0xc9ab72, 0xa08358],
};
const DRY_LEAF = [0x6f9a2a, 0x8fb83a, 0xa8b84a, 0x7a6a2a, 0x5a8a24];

// ---------------------------------------------------------------- ground pickups
export interface Pickup { nid: string; id: ItemId; count: number; dur?: number; x: number; y: number; z: number; mesh: Inst; index: number }

type GeoFn = () => THREE.BufferGeometry;
const box = (w: number, h: number, d: number, y: number): GeoFn => () => new THREE.BoxGeometry(w, h, d).translate(0, y, 0);
const ico = (r: number, det: number, sx: number, sy: number, sz: number, y: number): GeoFn => () => new THREE.IcosahedronGeometry(r, det).scale(sx, sy, sz).translate(0, y, 0);
const rod = (r0: number, r1: number, len: number, seg: number, y: number, rz = Math.PI / 2): GeoFn => () => new THREE.CylinderGeometry(r0, r1, len, seg).rotateZ(rz).translate(0, y, 0);
const dome = (y: number): GeoFn => () => new THREE.SphereGeometry(0.14, 8, 5, 0, 6.283, 0, 1.6).translate(0, y, 0);
const PICKUP_STYLE: Partial<Record<ItemId, { color: string; geo: GeoFn }>> = {
    fiber: { color: "#b4c46a", geo: () => new THREE.ConeGeometry(0.11, 0.3, 5).translate(0, 0.15, 0) },
    metal: { color: "#bcc4cb", geo: box(0.2, 0.07, 0.11, 0.04) },
    roasted_coconut: { color: "#9a6030", geo: ico(0.11, 2, 1, 1, 1, 0.11) },
    metal_hatchet: { color: "#aeb6bd", geo: box(0.34, 0.06, 0.1, 0.04) },
    metal_pickaxe: { color: "#aeb6bd", geo: box(0.4, 0.06, 0.1, 0.04) },
    diamond_pickaxe: { color: "#6feeff", geo: box(0.4, 0.06, 0.1, 0.04) },
    coal: { color: "#1c1d21", geo: ico(0.1, 0, 1, 1, 1, 0.09) },
    diamond: { color: "#7ff4ff", geo: () => new THREE.OctahedronGeometry(0.1, 0).translate(0, 0.12, 0) },
    campfire: { color: "#7a5230", geo: rod(0.1, 0.1, 0.5, 6, 0.1) },
    furnace: { color: "#8b8982", geo: box(0.36, 0.3, 0.36, 0.15) },
    workbench: { color: "#b98a52", geo: box(0.5, 0.2, 0.3, 0.1) },
    sleeping_bag: { color: "#4f8f7a", geo: rod(0.1, 0.1, 0.55, 10, 0.1) },
    bed: { color: "#e9e3cf", geo: box(0.5, 0.14, 0.3, 0.07) },
    box: { color: "#a47a46", geo: box(0.36, 0.26, 0.26, 0.13) },
    building_plan: { color: "#3b73a8", geo: rod(0.06, 0.06, 0.34, 8, 0.06) },
    spear: { color: "#8b6a44", geo: rod(0.02, 0.02, 1.5, 5, 0.03) },
    fishing_rod: { color: "#8b6a44", geo: rod(0.015, 0.025, 1.3, 5, 0.03) },
    meat_stick: { color: "#b8434d", geo: rod(0.05, 0.02, 0.6, 6, 0.05) },
    roast_stick: { color: "#6e3618", geo: rod(0.05, 0.02, 0.6, 6, 0.05) },
    guitar: { color: "#c98a43", geo: () => new THREE.CylinderGeometry(0.17, 0.17, 0.09, 12).scale(1, 1, 1.5).translate(0, 0.045, 0) },
    raw_meat: { color: "#b8434d", geo: ico(0.13, 1, 1.2, 0.6, 0.9, 0.08) },
    cooked_meat: { color: "#7a4422", geo: ico(0.13, 1, 1.2, 0.6, 0.9, 0.08) },
    raw_fish: { color: "#7fb0cc", geo: ico(0.14, 1, 1.9, 0.5, 0.7, 0.06) },
    cooked_fish: { color: "#c58a4e", geo: ico(0.14, 1, 1.9, 0.5, 0.7, 0.06) },
    wood: { color: "#8a5a30", geo: rod(0.06, 0.07, 0.75, 6, 0.07) },
    stone: { color: "#9b9a94", geo: ico(0.14, 1, 1, 0.65, 1, 0.09) },
    metal_ore: { color: "#b5703c", geo: ico(0.14, 1, 1, 0.7, 1, 0.09) },
    coconut: { color: "#5b3c22", geo: ico(0.125, 2, 1, 1, 1, 0.125) },
    flower_daisy: { color: "#f7f5ee", geo: ico(0.05, 1, 1, 0.4, 1, 0.03) },
    flower_poppy: { color: "#d8261d", geo: ico(0.05, 1, 1, 0.6, 1, 0.03) },
    flower_bluebell: { color: "#4f63d8", geo: ico(0.045, 1, 1, 0.6, 1.4, 0.03) },
    flower_sunflower: { color: "#f6c21a", geo: () => new THREE.CylinderGeometry(0.09, 0.09, 0.03, 10).translate(0, 0.02, 0) },
    flower_hibiscus: { color: "#ec3f86", geo: ico(0.07, 1, 1, 0.45, 1, 0.03) },
    flower_lavender: { color: "#9a6bd6", geo: rod(0.02, 0.02, 0.3, 5, 0.02) },
    flower_orchid: { color: "#f2d9f0", geo: ico(0.05, 1, 1, 0.5, 1, 0.03) },
    flower_paradise: { color: "#ff8a1a", geo: () => new THREE.ConeGeometry(0.04, 0.2, 5).rotateZ(Math.PI / 2).translate(0, 0.03, 0) },
    flower_pot: { color: "#b5653a", geo: () => new THREE.CylinderGeometry(0.12, 0.09, 0.18, 10).translate(0, 0.09, 0) },
    rug: { color: "#8a2f2a", geo: rod(0.08, 0.08, 0.6, 8, 0.08) },
    table: { color: "#a8743f", geo: () => new THREE.CylinderGeometry(0.3, 0.3, 0.06, 12).translate(0, 0.03, 0) },
    cat_bed: { color: "#c4634f", geo: () => new THREE.TorusGeometry(0.2, 0.07, 6, 12).rotateX(Math.PI / 2).translate(0, 0.07, 0) },
    lantern: { color: "#3d4348", geo: box(0.14, 0.2, 0.14, 0.1) },
    door: { color: "#8a5a30", geo: box(0.5, 0.06, 1.0, 0.03) },
    picture_frame: { color: "#8a5a30", geo: box(0.5, 0.04, 0.4, 0.02) },
    turtle_egg: { color: "#f2ede0", geo: ico(0.045, 2, 1, 1, 1, 0.04) },
    berries: { color: "#c9253d", geo: ico(0.075, 1, 1, 1, 1, 0.075) },
    sapling: { color: "#5fae45", geo: () => new THREE.ConeGeometry(0.1, 0.34, 6).translate(0, 0.17, 0) },
    torch: { color: "#8b5e34", geo: rod(0.03, 0.035, 0.5, 6, 0.05, 1.2) },
    rock: { color: "#8e8a82", geo: ico(0.12, 1, 1, 0.75, 1, 0.09) },
    hatchet: { color: "#8b6a44", geo: box(0.34, 0.06, 0.1, 0.04) },
    pickaxe: { color: "#8b6a44", geo: box(0.4, 0.06, 0.1, 0.04) },
    leather: { color: "#a8693a", geo: box(0.3, 0.035, 0.24, 0.02) },
    leather_cap: { color: "#a8693a", geo: dome(0.02) },
    leather_vest: { color: "#a8693a", geo: box(0.34, 0.06, 0.28, 0.03) },
    leather_pants: { color: "#a8693a", geo: box(0.3, 0.06, 0.34, 0.03) },
    metal_helmet: { color: "#b9c2c9", geo: dome(0.02) },
    metal_chestplate: { color: "#b9c2c9", geo: box(0.34, 0.06, 0.28, 0.03) },
    metal_greaves: { color: "#b9c2c9", geo: box(0.3, 0.06, 0.34, 0.03) },
    diamond_helmet: { color: "#58dff0", geo: dome(0.02) },
    diamond_chestplate: { color: "#58dff0", geo: box(0.34, 0.06, 0.28, 0.03) },
    diamond_greaves: { color: "#58dff0", geo: box(0.3, 0.06, 0.34, 0.03) },
};

/** Items lying on the ground: one thin-instanced mesh per item kind, created the first time one is dropped. */
export class PickupField {
    readonly items = new Set<Pickup>();
    private meshes = new Map<ItemId, Inst>();
    private free = new Map<ItemId, number[]>();
    private used = new Map<ItemId, Uint8Array>();
    private dummy = new THREE.Object3D();
    private readonly CAP = 140;
    readonly byId = new Map<string, Pickup>();
    /** network ids: scattered items are 'i<n>' on every client, later ones carry their creator's prefix */
    idPrefix = "i";
    private idCount = 0;
    onSpawn: ((p: Pickup) => void) | null = null;
    onRemove: ((p: Pickup) => void) | null = null;
    onCount: ((p: Pickup) => void) | null = null;
    private zero = new THREE.Matrix4().makeScale(0, 0, 0);

    constructor(private readonly scene: Scene) {}

    private meshFor(id: ItemId): Inst {
        let m = this.meshes.get(id);
        if (m) return m;
        const st = PICKUP_STYLE[id] ?? { color: "#cccccc", geo: box(0.2, 0.2, 0.2, 0.1) };
        const roughness = id.startsWith("metal") || id.startsWith("diamond") ? 0.35 : 0.85;
        const metallic = id === "metal" || id.startsWith("metal_") ? 0.8 : 0;
        m = new Inst(`pickup_${id}`, st.geo(), solid(this.scene, st.color, roughness, metallic), this.CAP, this.scene);
        for (let i = 0; i < this.CAP; i++) m.setMatrixAt(i, this.zero);
        m.instanceMatrix.needsUpdate = true;
        m.count = 0;
        m.mesh.alwaysSelectAsActiveMesh = true;
        m.mesh.metadata = { keepUnderground: true };
        this.meshes.set(id, m);
        this.free.set(id, Array.from({ length: this.CAP }, (_, i) => this.CAP - 1 - i));
        this.used.set(id, new Uint8Array(this.CAP));
        return m;
    }

    spawn(id: ItemId, count: number, x: number, y: number, z: number, dur?: number, nid?: string, silent = false): Pickup | null {
        const m = this.meshFor(id), f = this.free.get(id)!;
        const index = f.pop();
        if (index === undefined) return null;
        const d = this.dummy;
        // lie flat on the slope instead of standing level on it
        const gx = heightAt(x + 0.25, z) - heightAt(x - 0.25, z), gz = heightAt(x, z + 0.25) - heightAt(x, z - 0.25);
        _n.set(-gx, 0.5, -gz).normalize();
        d.position.set(x, y - 0.01, z);
        d.quaternion.setFromUnitVectors(_up, _n).multiply(_qy.setFromAxisAngle(_up, Math.random() * Math.PI * 2));
        d.scale.setScalar(1);
        d.updateMatrix();
        m.setMatrixAt(index, d.matrix);
        m.instanceMatrix.needsUpdate = true;
        this.used.get(id)![index] = 1;
        if (index + 1 > m.count) m.count = index + 1;
        const p: Pickup = { nid: nid ?? `${this.idPrefix}${this.idCount++}`, id, count, x, y, z, mesh: m, index, dur };
        this.items.add(p);
        this.byId.set(p.nid, p);
        if (!silent) this.onSpawn?.(p);
        return p;
    }

    setCount(p: Pickup, n: number) { p.count = n; this.onCount?.(p); }

    /** Ground changed under a building site: settle loose items onto the new surface. */
    reseat(x0: number, z0: number, x1: number, z1: number, ground: (x: number, z: number, y?: number) => number) {
        const m4 = new THREE.Matrix4();
        for (const p of this.items) {
            if (p.x < x0 || p.x > x1 || p.z < z0 || p.z > z1) continue;
            const g = ground(p.x, p.z, p.y + 0.5), dy = g - p.y;
            if (Math.abs(dy) < 0.02) continue;
            p.mesh.getMatrixAt(p.index, m4);
            m4.elements[13] += dy;
            p.mesh.setMatrixAt(p.index, m4);
            p.mesh.instanceMatrix.needsUpdate = true;
            p.y = g;
        }
    }

    clear() { for (const p of [...this.items]) this.remove(p, true); }

    remove(p: Pickup, silent = false) {
        if (!this.items.delete(p)) return;
        this.byId.delete(p.nid);
        if (!silent) this.onRemove?.(p);
        p.mesh.setMatrixAt(p.index, this.zero);
        p.mesh.instanceMatrix.needsUpdate = true;
        const u = this.used.get(p.id)!;
        u[p.index] = 0;
        const f = this.free.get(p.id)!;
        f.push(p.index);
        f.sort((a, b) => b - a);
        let c = p.mesh.count;
        while (c > 0 && !u[c - 1]) c--;
        p.mesh.count = c;
    }
}

// ---------------------------------------------------------------- springs (fresh drinking water)
export interface Spring { x: number; y: number; z: number }

/** Picks flat spots in the hills for freshwater springs. Pure function so vegetation can keep clear of them. */
export function planSprings(spawn: { x: number; z: number }, want = 4): Zone[] {
    const rnd = mulberry32(555);
    const out: Zone[] = [];
    for (let tries = 0; tries < 6000 && out.length < want; tries++) {
        const a = rnd() * Math.PI * 2, r = 25 + rnd() * 165;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        const h = heightAt(x, z);
        if (h < 4 || h > 24) continue;
        if (Math.hypot(x - spawn.x, z - spawn.z) < 70) continue;
        if (out.some((s) => Math.hypot(s.x - x, s.z - z) < 85)) continue;
        let flat = true, hmax = -1e9, hmin = 1e9;
        for (let k = 0; k < 8 && flat; k++) {
            const hh = heightAt(x + Math.cos(k * 0.785) * 2, z + Math.sin(k * 0.785) * 2);
            hmax = Math.max(hmax, hh);
            hmin = Math.min(hmin, hh);
            if (hmax - hmin > 0.45) flat = false;
        }
        if (flat) out.push({ x, z, r: 4.5 });
    }
    if (RIVER_SPRING) out.push({ x: RIVER_SPRING.x, z: RIVER_SPRING.z, r: 4.5 });
    return out;
}

class SpringField {
    readonly springs: Spring[] = [];
    constructor(scene: Scene, spots: Zone[], shadows: boolean) {
        const water = new PBRMaterial("springWater", scene);
        water.albedoColor = Color3.FromHexString("#237f9c").toLinearSpace();
        water.metallic = 0;
        water.roughness = 0.05;
        water.clearCoat.isEnabled = true;
        water.emissiveColor = Color3.FromHexString("#0b3a48").toLinearSpace();
        for (const s of spots) {
            let top = -1e9;
            for (let k = 0; k < 8; k++) top = Math.max(top, heightAt(s.x + Math.cos(k * 0.785) * 1.8, s.z + Math.sin(k * 0.785) * 1.8));
            top = Math.max(top, heightAt(s.x, s.z));
            const rim = MeshBuilder.CreateTorus("springRim", { diameter: 2.8, thickness: 0.6, tessellation: 16 }, scene);
            rim.material = rockMaterial(scene);
            rim.position.set(s.x, top + 0.04, s.z);
            rim.scaling.y = 0.8;
            if (shadows) shadowCasters.add(rim);
            rim.receiveShadows = true;
            const disc = MeshBuilder.CreateDisc("springWater", { radius: 1.45, tessellation: 24 }, scene);
            disc.rotation.x = Math.PI / 2;
            disc.position.set(s.x, top + 0.17, s.z);
            disc.material = water;
            this.springs.push({ x: s.x, y: top, z: s.z });
        }
    }
}

// ---------------------------------------------------------------- targeting + gathering
export type Target =
    | { type: "node"; node: ResNode; dist: number; point: Vector3 }
    | { type: "pickup"; pickup: Pickup; dist: number; point: Vector3 }
    | { type: "spring"; spring: Spring; dist: number; point: Vector3 }
    | { type: "sea"; dist: number; point: Vector3 }
    | { type: "flower"; hit: FlowerHit; dist: number; point: Vector3 };

export function raySphere(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, cx: number, cy: number, cz: number, r: number): number {
    const lx = cx - ox, ly = cy - oy, lz = cz - oz;
    const tca = lx * dx + ly * dy + lz * dz;
    const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
    const r2 = r * r;
    if (d2 > r2) return -1;
    const thc = Math.sqrt(r2 - d2);
    const t = tca - thc;
    if (t >= 0) return t;
    const t2 = tca + thc;
    return t2 >= 0 ? t2 : -1;
}

interface Faller {
    mesh: Mesh; t: number; base: THREE.Quaternion; scale: THREE.Vector3;
    axis: THREE.Vector3; dx: number; dz: number; x: number; y: number; z: number;
    H: number; final: number; fall: number; impacted: boolean; leafT: number; palm: boolean;
}
interface Wobble { node: ResNode; t: number; ax: number; az: number; k: number; amp: number }
const _fq = new THREE.Quaternion();

/** Harvesting: what you are aiming at, taking from trees / rocks, felling, crumbling, regrowth, pickups and springs. */
export class Resources {
    readonly pickups: PickupField;
    readonly springs: SpringField;
    private fx: Particles;
    private fallers: Faller[] = [];
    private wobbles = new Map<ResNode, Wobble>();
    onImpact: ((x: number, y: number, z: number, strength: number) => void) | null = null;
    onCrumble: ((x: number, y: number, z: number, kind: "stone" | "ore") => void) | null = null;
    private depleted = new Set<ResNode>();
    /** network: a node was hit or emptied by the local player */
    onNode: ((node: ResNode, hitter: { x: number; z: number }) => void) | null = null;
    private tmp = new Vector3();

    constructor(scene: Scene, private readonly veg: Vegetation, springSpots: Zone[], shadows: boolean) {
        this.fx = new Particles(scene);
        this.pickups = new PickupField(scene);
        this.springs = new SpringField(scene, springSpots, shadows);
        this.scatterPickups();
    }

    private scatterPickups() {
        const rnd = mulberry32(4242);
        let coconuts = 0;
        for (const p of this.veg.palmPlacements) {
            if (coconuts >= 130) break;
            if (rnd() > 0.45) continue;
            for (let k = 0; k < 1 + (rnd() < 0.4 ? 1 : 0); k++) {
                const a = rnd() * Math.PI * 2, r = 0.8 + rnd() * 2.2;
                const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r, h = heightAt(x, z);
                if (h < 0.9 || h > 14) continue;
                if (this.pickups.spawn("coconut", 1, x, h, z)) coconuts++;
            }
        }
        let stones = 0, sticks = 0, fibers = 0;
        for (let i = 0; i < 6000 && (stones < 50 || sticks < 50 || fibers < 60); i++) {
            const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 215;
            const x = Math.cos(a) * r, z = Math.sin(a) * r, h = heightAt(x, z);
            if (h < 1.2 || h > 22 || slopeAt(x, z) > 0.45) continue;
            const k = rnd();
            if (k < 0.3) { if (stones < 50 && this.pickups.spawn("stone", 2, x, h, z)) stones++; }
            else if (k < 0.6) { if (sticks < 50 && this.pickups.spawn("wood", 3, x, h, z)) sticks++; }
            else if (fibers < 60 && this.pickups.spawn("fiber", 3, x, h, z)) fibers++;
        }
    }

    /** Nearest thing along the view ray within `reach`. `assist` widens hit spheres (touch and VR aiming). */
    findTarget(eye: Vector3, dir: Vector3, reach: number, assist = 1): Target | null {
        const ox = eye.x, oy = eye.y, oz = eye.z, dx = dir.x, dy = dir.y, dz = dir.z;
        let best: Target | null = null;
        let bt = reach;
        for (const n of this.veg.nodes) {
            if (n.depleted) continue;
            const ex = n.x - ox, ez = n.z - oz, lim = reach + n.r * assist + 0.5;
            if (ex * ex + ez * ez > lim * lim) continue;
            for (const off of n.offs) {
                const t = raySphere(ox, oy, oz, dx, dy, dz, n.x, n.y + off, n.z, n.r * assist);
                if (t >= 0 && t < bt) { bt = t; best = { type: "node", node: n, dist: t, point: new Vector3(ox + dx * t, oy + dy * t, oz + dz * t) }; }
            }
        }
        for (const p of this.pickups.items) {
            const ex = p.x - ox, ez = p.z - oz;
            if (ex * ex + ez * ez > (reach + 1) * (reach + 1)) continue;
            const t = raySphere(ox, oy, oz, dx, dy, dz, p.x, p.y + 0.12, p.z, 0.42 * assist);
            if (t >= 0 && t < bt) { bt = t; best = { type: "pickup", pickup: p, dist: t, point: new Vector3(ox + dx * t, oy + dy * t, oz + dz * t) }; }
        }
        if (this.flowers) {
            const f = this.flowers.find(eye, dir, Math.min(bt, reach), assist);
            if (f && f.dist < bt) { bt = f.dist; best = { type: "flower", hit: f.hit, dist: f.dist, point: new Vector3(ox + dx * f.dist, oy + dy * f.dist, oz + dz * f.dist) }; }
        }
        for (const s of this.springs.springs) {
            const t = raySphere(ox, oy, oz, dx, dy, dz, s.x, s.y + 0.15, s.z, 1.7);
            if (t >= 0 && t < bt) { bt = t; best = { type: "spring", spring: s, dist: t, point: new Vector3(ox + dx * t, oy + dy * t, oz + dz * t) }; }
        }
        if (!best && dy < -0.03) {
            const t = -oy / dy;
            if (t > 0 && t <= reach + 0.6) {
                const hx = ox + dx * t, hz = oz + dz * t;
                if (heightAt(hx, hz) < -0.12) best = { type: "sea", dist: t, point: new Vector3(hx, 0, hz) };
            }
        }
        return best;
    }

    burst(point: Vector3, kind: HitFx, n = 9, speed?: number) { this.fx.burst(point, FX_COLORS[kind], kind, n, speed ?? (kind === "ore" ? 4.5 : 3.5)); }

    /** Takes `amount` from a node. Returns true if that emptied it. */
    take(node: ResNode, amount: number, playerX: number, playerZ: number, remote = false): boolean {
        node.left -= amount;
        let dx = node.x - playerX, dz = node.z - playerZ;
        const l = Math.hypot(dx, dz) || 1;
        dx /= l;
        dz /= l;
        if (node.left > 0) {
            // the thing you hit flinches; boulders visibly wear down
            const worn = node.kind === "stone" || node.kind === "ore";
            const k = worn ? 0.58 + 0.42 * (node.left / node.total) : 1;
            this.wobbles.set(node, { node, t: 0, ax: dz, az: -dx, k, amp: worn ? 0.035 : 0.03 });
            if (node.kind === "palm" || node.kind === "tree") {
                shakeFoliage(node.x, node.z, 1);
                if (Math.random() < 0.7) {
                    _fv.set(node.x + (Math.random() - 0.5) * 2, node.y + (node.kind === "palm" ? 5.5 : 7) * (0.8 + Math.random() * 0.3), node.z + (Math.random() - 0.5) * 2);
                    this.burst(_fv, "leaf", 3 + Math.floor(Math.random() * 3), 1.2);
                }
                this.onTreeHit?.(node.x, node.z);
            }
            if (!remote) this.onNode?.(node, { x: playerX, z: playerZ });
            return false;
        }
        node.left = 0;
        node.depleted = true;
        node.respawnAt = this.grow + node.respawnTime;
        this.wobbles.delete(node);
        node.setDepleted(true);
        this.depleted.add(node);
        if (node.fall) this.fell(node, playerX, playerZ, !remote);
        else if (node.kind === "stone" || node.kind === "ore") this.crumble(node);
        if (!remote) this.onNode?.(node, { x: playerX, z: playerZ });
        return true;
    }

    /** A boulder gives way: a shower of chunks and a cloud of dust. */
    private crumble(node: ResNode) {
        const c = new Vector3(node.x, node.y + (node.offs[0] ?? 0.4), node.z);
        const kind: HitFx = node.kind === "ore" ? "ore" : "stone";
        this.fx.burst(c, FX_COLORS[kind], kind, 26, 4.2);
        this.fx.burst(c, FX_COLORS.stone, "stone", 12, 2.6);
        this.fx.puff(new Vector3(node.x, node.y, node.z), Math.max(0.5, node.r * 0.7), 5, 0.9);
        this.onCrumble?.(node.x, node.y, node.z, node.kind === "ore" ? "ore" : "stone");
    }

    /** Berries and similar: empties a node in one go. */
    pick(node: ResNode, remote = false) {
        node.left = 0;
        node.depleted = true;
        node.respawnAt = this.grow + node.respawnTime;
        node.setDepleted(true);
        this.depleted.add(node);
        if (!remote) this.onNode?.(node, { x: node.x, z: node.z });
    }

    /** Network: put a node into the state another player left it in. */
    applyNode(node: ResNode, left: number, hx: number, hz: number, respawnIn = node.respawnTime) {
        if (left <= 0) {
            if (node.depleted) return;
            if (node.gather === "berries") this.pick(node, true);
            else this.take(node, Math.max(0, node.left), hx, hz, true);
            node.respawnAt = this.grow + respawnIn;
        } else if (left < node.left) this.take(node, node.left - left, hx, hz, true);
    }

    private nodeIdx: Map<ResNode, number> | null = null;
    nodeId(n: ResNode): number {
        if (!this.nodeIdx) {
            this.nodeIdx = new Map();
            this.veg.nodes.forEach((q, i) => this.nodeIdx!.set(q, i));
        }
        return this.nodeIdx.get(n) ?? -1;
    }
    nodeAt(i: number): ResNode | undefined { return this.veg.nodes[i]; }
    get nodeList() { return this.veg.nodes; }

    /** Network snapshot: put a node straight into a state, no effects. */
    restoreNode(node: ResNode, left: number, respawnIn: number) {
        node.left = Math.max(0, left);
        if (left <= 0) {
            node.depleted = true;
            node.respawnAt = this.grow + respawnIn;
            node.setDepleted(true);
            this.depleted.add(node);
        } else if (node.kind === "stone" || node.kind === "ore") node.pose?.(0, 0, 0, 0.58 + 0.42 * (node.left / node.total));
    }

    respawnIn(node: ResNode) { return Math.max(1, node.respawnAt - this.grow); }

    private fell(node: ResNode, px: number, pz: number, local = true) {
        const f = node.fall!;
        const mesh = this.veg.template(f.geo).clone("felled")!;
        mesh.setEnabled(true);
        mesh.material = f.mat;
        const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
        f.base.decompose(pos, quat, scl);
        mesh.position.set(pos.x, pos.y, pos.z);
        mesh.rotationQuaternion = new Quaternion(quat.x, quat.y, quat.z, quat.w);
        mesh.scaling.set(scl.x, scl.y, scl.z);
        shadowCasters.add(mesh);
        let dx = node.x - px, dz = node.z - pz;
        const l = Math.hypot(dx, dz) || 1;
        dx /= l;
        dz /= l;
        if (!f.geo.boundingBox) f.geo.computeBoundingBox();
        const H = Math.max(3, (f.geo.boundingBox?.max.y ?? 8) * scl.y);
        // topple until the crown rests on the actual ground there (steeper downhill, shallower uphill)
        const crown = H * 0.82;
        const gy = heightAt(node.x + dx * crown, node.z + dz * crown);
        const final = clamp(Math.acos(clamp((gy - node.y + 0.25) / H, -1, 1)), 1.05, 1.62);
        this.fallers.push({
            mesh, t: 0, base: quat.clone(), scale: scl.clone(), axis: new THREE.Vector3(dz, 0, -dx), dx, dz,
            x: node.x, y: node.y, z: node.z, H, final, fall: 1.25 + H * 0.045, impacted: false, leafT: 0, palm: node.kind === "palm" && local,
        });
    }

    /** regrowth time only counts while you are on the main island */
    private grow = 0;
    regrowing: () => boolean = () => true;
    update(dt: number, px: number, pz: number) {
        if (this.regrowing()) this.grow += dt;
        this.fx.update(dt);

        for (const [n, w] of this.wobbles) {
            w.t += dt;
            const ang = w.amp * Math.exp(-8 * w.t) * Math.sin(w.t * 36);
            const kk = w.k * (1 + 0.035 * Math.exp(-9 * w.t) * Math.sin(w.t * 42));
            if (w.t > 0.7) { n.pose?.(0, w.ax, w.az, w.k); this.wobbles.delete(n); continue; }
            n.pose?.(ang, w.ax, w.az, kk);
        }

        for (let i = this.fallers.length - 1; i >= 0; i--) {
            const f = this.fallers[i];
            f.t += dt;
            let ang: number;
            if (f.t < f.fall) {
                const k = f.t / f.fall;
                ang = f.final * Math.pow(k, 2.3);
                f.leafT -= dt;
                if (f.leafT <= 0 && k > 0.12) {
                    f.leafT = 0.06;
                    const cx = f.x + f.dx * f.H * Math.sin(ang) * 0.9, cy = f.y + f.H * Math.cos(ang) * 0.9, cz = f.z + f.dz * f.H * Math.sin(ang) * 0.9;
                    this.fx.scatterLeaves(this.tmp.set(cx, cy, cz), DRY_LEAF, 2, 1.2);
                }
            } else {
                const u = f.t - f.fall;
                if (!f.impacted) {
                    f.impacted = true;
                    const sn = Math.sin(f.final);
                    const ix = f.x + f.dx * f.H * sn * 0.85, iz = f.z + f.dz * f.H * sn * 0.85, iy = heightAt(ix, iz);
                    const p = new Vector3(ix, iy, iz);
                    this.fx.puff(p, 1.3 + f.H * 0.06, 7, 1.4);
                    this.fx.puff(new Vector3(f.x + f.dx * f.H * sn * 0.5, f.y + 0.1, f.z + f.dz * f.H * sn * 0.5), 0.9, 3, 0.8);
                    this.fx.scatterLeaves(new Vector3(ix, iy + 1.2, iz), DRY_LEAF, 30, 2.6);
                    this.fx.burst(new Vector3(ix, iy + 0.3, iz), [0x8a5e34, 0x6b4426], "wood", 10, 3.2);
                    // a palm sheds its coconuts when it hits the ground
                    if (f.palm) {
                        for (let k = 0; k < 1 + Math.floor(Math.random() * 3); k++) {
                            const a = Math.random() * 6.283, d = 0.6 + Math.random() * 1.6;
                            const cx = ix + Math.cos(a) * d, cz = iz + Math.sin(a) * d, ch = heightAt(cx, cz);
                            if (ch > 0.5) this.pickups.spawn("coconut", 1, cx, ch, cz);
                        }
                    }
                    this.onImpact?.(ix, iy, iz, Math.min(1.6, 0.55 + f.H * 0.06));
                }
                ang = f.final - 0.085 * Math.exp(-6 * u) * Math.abs(Math.sin(u * 13));
            }
            _fq.setFromAxisAngle(f.axis, ang).multiply(f.base);
            f.mesh.rotationQuaternion!.set(_fq.x, _fq.y, _fq.z, _fq.w);
            if (f.t > f.fall + 6) {
                const s = Math.max(0, 1 - (f.t - f.fall - 6) / 0.9);
                f.mesh.scaling.set(f.scale.x * s, f.scale.y * s, f.scale.z * s);
                if (s <= 0) {
                    shadowCasters.delete(f.mesh);
                    f.mesh.dispose();
                    this.fallers.splice(i, 1);
                }
            }
        }

        if (this.autoRespawn) for (const n of this.depleted) {
            if (this.grow < n.respawnAt) continue;
            if (Math.hypot(n.x - px, n.z - pz) < 14) continue; // never pop back in under the player's nose
            if (this.others().some((o) => Math.hypot(n.x - o.x, n.z - o.z) < 14)) continue; // nor anyone else's
            this.respawnNode(n);
            this.onRespawn?.(n);
        }
    }

    /** Multiplayer: only the host decides when things grow back; guests wait for its word. */
    autoRespawn = true;
    others: () => { x: number; z: number }[] = () => [];
    onTreeHit: ((x: number, z: number) => void) | null = null;
    flowers: Flowers | null = null;
    onRespawn: ((n: ResNode) => void) | null = null;

    respawnNode(n: ResNode) {
        if (!n.depleted) return;
        n.depleted = false;
        n.left = n.total;
        n.setDepleted(false);
        this.depleted.delete(n);
    }

    /** Every node's state, for saves and for players joining (depleted / worn ones only). */
    get depletedList() { return this.depleted; }
}
