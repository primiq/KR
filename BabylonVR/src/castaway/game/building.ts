import { Mesh, type Material, type Scene, TransformNode } from "@babylonjs/core";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { PBRCustomMaterial } from "@babylonjs/materials";
import { meshFromThree } from "../render/geometry";
import { shadowCasters } from "../render/inst";
import { ghostMaterial, glassMaterial, NOISE_GLSL, setGhostOk, stoneMaterials, woodMaterials } from "../render/materials";
import { addCut, baseHeightAt, cutBounds, heightAt, removeCut, type Cut } from "../world/island";
import type { ColliderGrid } from "../world/vegetation";

/** Snap-together building on a world-aligned 3 m grid. Foundations sit on cells, walls on cell edges, roofs on top. */
export type PieceKind = "foundation" | "wall" | "doorway" | "window" | "railing" | "roof" | "floor" | "stairs" | "pool";
export const CELL = 3;
export const WALL_H = 3;
const THICK = 0.2;
/** a railing's height, and how far its end posts stand above the rail (a torch stands on one) */
export const RAIL_H = 1.05;
const RAIL_POST = 0.14;

export const PIECES: { kind: PieceKind; name: string; cost: number; desc: string }[] = [
    { kind: "foundation", name: "Foundation", cost: 25, desc: "The base of every building. Works on slopes too (stilts reach the low side). Next to an existing foundation it may stick out over a drop or the water, up to 4 blocks from solid ground, and stands on stilts in shallow water." },
    { kind: "pool", name: "Pool", cost: 30, desc: "A foundation with a pool in it: crystal clear water, waist deep, with a wooden deck round the edge. Pools built side by side join into one bigger pool." },
    { kind: "wall", name: "Wall", cost: 15, desc: "Goes on the edge of a foundation." },
    { kind: "doorway", name: "Doorway", cost: 12, desc: "A wall with an opening to walk through." },
    { kind: "window", name: "Window", cost: 14, desc: "A wall with a window opening." },
    { kind: "railing", name: "Railing", cost: 8, desc: "A waist-high railing along the edge of a foundation or floor: posts, a handrail and balusters. Hold a torch and aim at one of its end posts to stand the torch on it." },
    { kind: "floor", name: "Floor / Roof", cost: 20, desc: "An upper floor that is also your roof: one storey up, walkable on top. Goes on top of a foundation or floor, or sticks out from one: at most 4 blocks away from a block that stands on something solid." },
    { kind: "stairs", name: "Staircase", cost: 30, desc: "Climbs one storey in the direction you face. Leave the floor above it open, and put a floor next to its top." },
];
export const PIECE_INFO: { kind: PieceKind; name: string; cost: number }[] = [...PIECES, { kind: "roof", name: "Roof", cost: 20 }];
export const MAX_LEVEL = 3;
/** how many blocks a platform can stick out from one that stands on something; how deep the water can be under a block on stilts (m) */
const MAX_OUT = 4, SHALLOW = -1.2;
/** which way a staircase climbs, by direction index (x, z) */
export const STAIR_DIRS: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const STEPS = 12;
/** what each piece costs to turn to stone (plus what it already cost in wood) */
export const STONE_COST: Record<PieceKind, number> = { foundation: 20, wall: 12, doorway: 10, window: 10, railing: 6, floor: 15, roof: 15, stairs: 18, pool: 0 };

type V3 = { x: number; y: number; z: number };
export interface Box { x0: number; x1: number; z0: number; z1: number; y0: number; y1: number; /** how far below the top a walker may still step onto it */ step?: number }
export interface Piece {
    kind: PieceKind;
    i: number; j: number;
    axis: "x" | "z";
    H: number;
    L: number; dir: number; span: number;
    cut?: Cut;
    mask?: number;
    group: TransformNode;
    solid: Box[];
    hit: Box;
    key: string;
}
export interface Aim {
    kind: PieceKind;
    ok: boolean;
    show: boolean;
    reason: string;
    i: number; j: number; axis: "x" | "z";
    H: number;
    L: number; dir: number;
    x: number; y: number; z: number;
}

const cellKey = (i: number, j: number, L = 0) => (L ? `${i},${j},${L}` : `${i},${j}`);
const edgeKey = (axis: "x" | "z", i: number, j: number, L = 0) => (L ? `${axis}${i},${j},${L}` : `${axis}${i},${j}`);

// ---------------------------------------------------------------- pools
export const POOL_RIM = 0.45, POOL_WATER = 0.1, POOL_DEPTH = 0.8;
let POOLW: PBRCustomMaterial | null = null;
/** Pool water: pale tiles with grout seen through rippling water, caustics dancing over them, sky caught at a slant. */
function poolMaterial(scene: Scene) {
    if (POOLW) return POOLW;
    const m = new PBRCustomMaterial("poolWater", scene);
    m.metallic = 0;
    m.roughness = 0.06;
    m.AddUniform("time", "float", 0);
    m.Fragment_Definitions(NOISE_GLSL);
    m.Fragment_Custom_Albedo(`
        vec3 wp = vPositionW;
        vec2 rip = vec2(cNoise(vec3(wp.xz * 1.3, time * 0.45)), cNoise(vec3(wp.xz * 1.3 + 7.1, time * 0.45)));
        vec2 p = wp.xz + rip * 0.05;
        vec2 g = abs(fract(p / 0.3) - 0.5) * 2.0;
        float grout = smoothstep(0.86, 0.95, max(g.x, g.y));
        vec3 tiles = mix(vec3(0.67, 0.93, 0.9), vec3(0.27, 0.64, 0.7), grout);
        float c1 = cNoise(vec3(p * 2.3, time * 0.6)), c2 = cNoise(vec3(p * 2.9 + 3.3, time * 0.75 + 5.0));
        float caus = pow(1.0 - abs(c1 - c2), 6.0) * 0.5;
        surfaceAlbedo = mix(tiles, vec3(0.009, 0.45, 0.62), 0.55) + caus;
    `);
    let t = 0;
    scene.onBeforeRenderObservable.add(() => (t += scene.getEngine().getDeltaTime() / 1000));
    m.onBindObservable.add(() => m.getEffect()?.setFloat("time", t));
    return (POOLW = m);
}
const bit = (mask: number, k: number) => (mask >> k) & 1;
function inPoolRim(mask: number, lx: number, lz: number) {
    const h = CELL / 2, r = POOL_RIM;
    const W = lx < -h + r, E = lx > h - r, N = lz < -h + r, S = lz > h - r;
    if ((W && !bit(mask, 0)) || (E && !bit(mask, 1)) || (N && !bit(mask, 2)) || (S && !bit(mask, 3))) return true;
    return (W && N && !bit(mask, 4)) || (E && N && !bit(mask, 5)) || (W && S && !bit(mask, 6)) || (E && S && !bit(mask, 7));
}

// ---------------------------------------------------------------- models
type MatKey = "wall" | "slab" | "beam" | "pile" | "glass" | "pool" | "swall" | "sslab";
/** A piece's model while it is put together: boxes in local space, bucketed by material (one Babylon mesh per material). */
class Kit {
    readonly parts = new Map<MatKey, THREE.BufferGeometry[]>();
    /** the window casements: separate meshes on hinges */
    sashes: { side: number; geos: Map<MatKey, THREE.BufferGeometry[]> }[] = [];
    add(k: MatKey, g: THREE.BufferGeometry) {
        let a = this.parts.get(k);
        if (!a) this.parts.set(k, (a = []));
        a.push(g);
    }
    box(w: number, h: number, d: number, x: number, y: number, z: number, k: MatKey) {
        this.add(k, new THREE.BoxGeometry(w, h, d).translate(x, y, z));
    }
}

function fillKit(kit: Kit, kind: PieceKind, depth = 0.6, pile?: (lx: number, lz: number) => number, stone = false, mask = 0) {
    const WALL: MatKey = stone ? "swall" : "wall";
    const SLAB: MatKey = stone ? (kind === "foundation" ? "swall" : "sslab") : "slab";
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, k: MatKey) => kit.box(w, h, d, x, y, z, k);
    const post = (x: number) => box(0.22, WALL_H + 0.05, 0.3, x, WALL_H / 2 + 0.025 - 0.02, 0, "beam");
    switch (kind) {
        case "pool": {
            const h = CELL / 2, r = POOL_RIM, rimH = 0.3;
            const W = !bit(mask, 0), E = !bit(mask, 1), N = !bit(mask, 2), S = !bit(mask, 3);
            if (N) box(CELL, rimH, r, 0, -rimH / 2, -h + r / 2, "slab");
            if (S) box(CELL, rimH, r, 0, -rimH / 2, h - r / 2, "slab");
            for (const [open, x] of [[W, -h + r / 2], [E, h - r / 2]] as [boolean, number][]) {
                if (!open) continue;
                const len = CELL - (N ? r : 0) - (S ? r : 0);
                box(r, rimH, len, x, -rimH / 2, ((N ? r : 0) - (S ? r : 0)) / 2, "slab");
            }
            for (const [k, sx, sz, a, b2] of [[4, -1, -1, 0, 2], [5, 1, -1, 1, 2], [6, -1, 1, 0, 3], [7, 1, 1, 1, 3]] as number[][]) {
                if (!bit(mask, a) || !bit(mask, b2) || bit(mask, k)) continue;
                box(r, rimH, r, sx * (h - r / 2), -rimH / 2, sz * (h - r / 2), "slab");
            }
            if (N) box(CELL + 0.03, 0.14, 0.2, 0, -rimH - 0.02, -h + 0.09, "beam");
            if (S) box(CELL + 0.03, 0.14, 0.2, 0, -rimH - 0.02, h - 0.09, "beam");
            if (W) box(0.2, 0.14, CELL - 0.4, -h + 0.09, -rimH - 0.02, 0, "beam");
            if (E) box(0.2, 0.14, CELL - 0.4, h - 0.09, -rimH - 0.02, 0, "beam");
            for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
                const lx = x * (h - 0.2), lz = z * (h - 0.2), dd = pile ? pile(lx, lz) : 0.6;
                box(0.28, dd, 0.28, lx, -0.3 - dd / 2, lz, "pile");
            }
            const x0 = -h + (W ? r : 0), x1 = h - (E ? r : 0), z0 = -h + (N ? r : 0), z1 = h - (S ? r : 0);
            kit.add("pool", new THREE.PlaneGeometry(x1 - x0, z1 - z0, 1, 1).rotateX(-Math.PI / 2).translate((x0 + x1) / 2, -POOL_WATER, (z0 + z1) / 2));
            box(CELL - 0.02, 0.06, CELL - 0.02, 0, -rimH + 0.01, 0, "beam");
            break;
        }
        case "foundation": {
            box(CELL, 0.3, CELL, 0, -0.15, 0, SLAB);
            for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) {
                const lx = x * (CELL / 2 - 0.2), lz = z * (CELL / 2 - 0.2), dd = pile ? pile(lx, lz) : depth;
                box(0.28, dd, 0.28, lx, -0.3 - dd / 2, lz, "pile");
            }
            for (const s of [-1, 1]) {
                box(CELL + 0.03, 0.14, 0.2, 0, -0.05, s * (CELL / 2 - 0.09), "beam");
                box(0.2, 0.15, CELL - 0.4, s * (CELL / 2 - 0.09), -0.052, 0, "beam");
            }
            break;
        }
        case "floor":
            box(CELL, 0.16, CELL, 0, -0.08, 0, SLAB);
            for (const x of [-1, 0, 1]) box(0.16, 0.2, CELL - 0.06, x * 1.2, -0.26, 0, "beam");
            break;
        case "stairs": {
            for (let k = 0; k < STEPS; k++) {
                const h = ((k + 1) * WALL_H) / STEPS, d = CELL / STEPS;
                box(CELL - 0.3, h, d, 0, h / 2, -CELL / 2 + (k + 0.5) * d, SLAB);
            }
            for (const sx of [-1, 1]) {
                const len = Math.hypot(CELL, WALL_H), ang = Math.atan2(WALL_H, CELL);
                kit.add(SLAB, new THREE.BoxGeometry(0.15, 0.22, len).rotateX(-ang).translate(sx * (CELL / 2 - 0.075), WALL_H / 2 - 0.02, 0));
            }
            break;
        }
        case "wall":
            box(CELL - 0.03, WALL_H, THICK, 0, WALL_H / 2, 0, WALL);
            post(-CELL / 2 + 0.11);
            post(CELL / 2 - 0.11);
            box(CELL + 0.02, 0.2, 0.31, 0, WALL_H - 0.085, 0, "beam");
            if (stone) { box(CELL - 0.2, 0.16, 0.26, 0, 1.45, 0, "beam"); box(CELL + 0.02, 0.14, 0.26, 0, 0.07, 0, "beam"); }
            break;
        case "doorway": {
            const sw = (CELL - 1.2) / 2;
            box(sw - 0.015, WALL_H, THICK, -CELL / 2 + 0.015 + (sw - 0.015) / 2, WALL_H / 2, 0, WALL);
            box(sw - 0.015, WALL_H, THICK, CELL / 2 - 0.015 - (sw - 0.015) / 2, WALL_H / 2, 0, WALL);
            box(1.2, WALL_H - 2.3, THICK, 0, (WALL_H + 2.3) / 2, 0, WALL);
            post(-CELL / 2 + 0.11); post(CELL / 2 - 0.11); post(-0.62); post(0.62);
            box(1.34, 0.16, 0.3, 0, 2.3, 0, "beam");
            box(CELL + 0.02, 0.2, 0.31, 0, WALL_H - 0.085, 0, "beam");
            if (stone) for (const s of [-1, 1]) { box(0.9, 0.14, 0.26, s * 1.05, 0.07, 0, "beam"); box(0.9, 0.14, 0.26, s * 1.05, 1.45, 0, "beam"); }
            break;
        }
        case "window": {
            const sw = (CELL - 1.3) / 2;
            box(sw - 0.015, WALL_H, THICK, -CELL / 2 + 0.015 + (sw - 0.015) / 2, WALL_H / 2, 0, WALL);
            box(sw - 0.015, WALL_H, THICK, CELL / 2 - 0.015 - (sw - 0.015) / 2, WALL_H / 2, 0, WALL);
            box(1.3, 1.0, THICK, 0, 0.5, 0, WALL);
            box(1.3, WALL_H - 2.0, THICK, 0, (WALL_H + 2.0) / 2, 0, WALL);
            post(-CELL / 2 + 0.11); post(CELL / 2 - 0.11);
            box(1.46, 0.12, 0.3, 0, 1.0, 0, "beam"); box(1.46, 0.12, 0.3, 0, 2.0, 0, "beam");
            box(0.1, 1.0, 0.26, -0.7, 1.5, 0, "beam"); box(0.1, 1.0, 0.26, 0.7, 1.5, 0, "beam");
            box(CELL + 0.02, 0.2, 0.31, 0, WALL_H - 0.085, 0, "beam");
            if (stone) box(CELL + 0.02, 0.14, 0.26, 0, 0.07, 0, "beam");
            // the two glazed casements, each hinged on its outer side
            const Wd = 0.65, Hh = 0.88, y0 = 1.06, F = 0.05;
            for (const s of [-1, 1]) {
                const geos = new Map<MatKey, THREE.BufferGeometry[]>();
                const put = (k: MatKey, g: THREE.BufferGeometry) => { let a = geos.get(k); if (!a) geos.set(k, (a = [])); a.push(g.translate(-s * Wd / 2, 0, 0)); };
                const fr = (w: number, h: number, x: number, y: number) => put("beam", new THREE.BoxGeometry(w, h, 0.045).translate(x, y, 0));
                fr(Wd, F, 0, y0 + F / 2); fr(Wd, F, 0, y0 + Hh - F / 2); fr(F, Hh, -Wd / 2 + F / 2, y0 + Hh / 2); fr(F, Hh, Wd / 2 - F / 2, y0 + Hh / 2);
                fr(Wd - 2 * F, 0.03, 0, y0 + Hh / 2);
                put("glass", new THREE.PlaneGeometry(Wd - 2 * F, Hh - 2 * F).translate(0, y0 + Hh / 2, 0));
                put("beam", new THREE.BoxGeometry(0.03, 0.06, 0.05).translate(-s * (Wd / 2 - 0.06), y0 + Hh / 2, 0.035));
                kit.sashes.push({ side: s, geos });
            }
            break;
        }
        case "railing": {
            // an end post at each end (shared with the railing round the corner), a handrail, a bottom rail, balusters between
            const P: MatKey = stone ? "swall" : "beam";
            for (const s of [-1, 1]) {
                box(RAIL_POST, RAIL_H + 0.06, RAIL_POST, s * CELL / 2, (RAIL_H + 0.06) / 2, 0, P);
                box(RAIL_POST + 0.04, 0.05, RAIL_POST + 0.04, s * CELL / 2, RAIL_H + 0.085, 0, P);
            }
            box(CELL - RAIL_POST, 0.07, 0.12, 0, RAIL_H - 0.035, 0, "beam");
            box(CELL - RAIL_POST, 0.06, 0.07, 0, 0.12, 0, "beam");
            const n = 11;
            for (let k = 1; k < n; k++) box(0.045, RAIL_H - 0.22, 0.045, -CELL / 2 + (k * CELL) / n, 0.12 + (RAIL_H - 0.22) / 2, 0, stone ? "swall" : "slab");
            break;
        }
        case "roof":
            box(CELL, 0.16, CELL, 0, 0.08, 0, SLAB);
            for (const x of [-1, 0, 1]) box(0.16, 0.2, CELL - 0.06, x * 1.2, -0.1, 0, "beam");
            break;
    }
}

let SCENE: Scene | null = null;
function matFor(k: MatKey): Material {
    const s = SCENE!;
    const W = woodMaterials(s);
    switch (k) {
        case "wall": return W.wall;
        case "slab": return W.slab;
        case "beam": return W.beam;
        case "pile": return W.pile;
        case "glass": return glassMaterial(s);
        case "pool": return poolMaterial(s);
        case "swall": return stoneMaterials(s).wall;
        case "sslab": return stoneMaterials(s).slab;
    }
}

/** Builds a piece's meshes (one per material) under `node`, or a single ghost mesh when `ghost` is given. */
function buildInto(node: TransformNode, kind: PieceKind, shadows: boolean, depth = 0.6, pile?: (lx: number, lz: number) => number, stone = false, mask = 0, ghost?: Material) {
    const kit = new Kit();
    fillKit(kit, kind, depth, pile, stone, mask);
    const make = (parent: TransformNode, geos: Map<MatKey, THREE.BufferGeometry[]>) => {
        if (ghost) {
            const all = [...geos.values()].flat().map((g) => (g.index ? g.toNonIndexed() : g));
            for (const g of all) { g.deleteAttribute("uv"); }
            if (!all.length) return;
            const m = meshFromThree(`${kind}Ghost`, mergeGeometries(all)!, SCENE!);
            m.material = ghost;
            m.parent = parent;
            m.isPickable = false;
            return;
        }
        for (const [k, list] of geos) {
            const merged = mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)))!;
            const m = meshFromThree(`${kind}_${k}`, merged, SCENE!);
            m.material = matFor(k);
            m.parent = parent;
            m.isPickable = false;
            m.receiveShadows = true;
            if (shadows && k !== "glass" && k !== "pool") shadowCasters.add(m);
        }
    };
    make(node, kit.parts);
    if (kit.sashes.length) {
        const pivots: TransformNode[] = [];
        for (const s of kit.sashes) {
            const pv = new TransformNode("sash", SCENE!);
            pv.parent = node;
            pv.position.set(s.side * 0.65, 0, 0.02);
            make(pv, s.geos);
            pivots.push(pv);
        }
        node.metadata = { ...(node.metadata ?? {}), sash: pivots };
    }
}

function clearNode(node: TransformNode) {
    for (const c of node.getChildMeshes()) shadowCasters.delete(c as Mesh);
    for (const c of node.getChildren()) c.dispose();
}

function buildMesh(kind: PieceKind, shadows: boolean, depth = 0.6, pile?: (lx: number, lz: number) => number, stone = false, mask = 0): TransformNode {
    const g = new TransformNode(`piece_${kind}`, SCENE!);
    buildInto(g, kind, shadows, depth, pile, stone, mask);
    return g;
}

/** Marches a ray until it dips below `ground`. Returns the hit (or the far end of the ray). */
export function rayGround(
  eye: V3, dir: V3, max: number, ground: (x: number, z: number, y?: number) => number,
): { x: number; y: number; z: number; hit: boolean; t: number } {
  let prev = 0;
  for (let t = 0.25; t <= max + 0.001; t += 0.25) {
    const x = eye.x + dir.x * t, y = eye.y + dir.y * t, z = eye.z + dir.z * t;
    if (y <= ground(x, z, y)) {
      let lo = prev, hi = t;
      for (let k = 0; k < 7; k++) {
        const m = (lo + hi) / 2;
        if (eye.y + dir.y * m <= ground(eye.x + dir.x * m, eye.z + dir.z * m, eye.y + dir.y * m)) hi = m; else lo = m;
      }
      const hx = eye.x + dir.x * hi, hz = eye.z + dir.z * hi;
      return { x: hx, y: ground(hx, hz, eye.y + dir.y * hi), z: hz, hit: true, t: hi };
    }
    prev = t;
  }
  return { x: eye.x + dir.x * max, y: eye.y + dir.y * max, z: eye.z + dir.z * max, hit: false, t: max };
}

export class BuildingSystem {
  readonly pieces = new Set<Piece>();
  private cells = new Map<string, Piece>();   // foundations and upper floors
  private roofs = new Map<string, Piece>();
  private edges = new Map<string, Piece>();   // walls, doorways, windows
  private stairs = new Map<string, Piece>();
  /** everything you can stand on, by cell column "i,j" */
  private colAt = new Map<string, Piece[]>();
  private boxCells = new Map<string, Box[]>();
  private ghosts = new Map<PieceKind, TransformNode>();
  private ghostMat: ReturnType<typeof ghostMaterial>;
  /** the last aim worked out (for the VR wrist panel / tests) */
  aim: Aim | null = null;
  /** network hooks: the local player placed / removed a piece */
  onPlace: ((p: Piece) => void) | null = null;
  onRemove: ((p: Piece) => void) | null = null;

  // ---- stone: pieces turned to stone (key `kind:key`, since a staircase and a foundation can share a cell key)
  readonly stone = new Set<string>();
  onUpgrade: ((p: Piece) => void) | null = null;
  static sid(p: Piece) { return `${p.kind}:${p.key}`; }
  isStone(p: Piece) { return this.stone.has(BuildingSystem.sid(p)); }
  /** turn a piece to stone (the caller has checked and taken the cost) */
  upgrade(p: Piece, remote = false): boolean {
    const id = BuildingSystem.sid(p);
    if (this.stone.has(id) || !this.pieces.has(p)) return false;
    this.stone.add(id);
    this.rebuild(p);
    if (!remote) this.onUpgrade?.(p);
    return true;
  }
  /** rebuild a piece's model in place (same group, so doors, pictures and anything else holding on to it stay put) */
  private rebuild(p: Piece) {
    const st = this.isStone(p);
    clearNode(p.group);
    if (p.group.metadata) p.group.metadata.sash = undefined;
    if (p.kind === 'foundation' || p.kind === 'pool') {
      const cx = p.i * CELL + CELL / 2, cz = p.j * CELL + CELL / 2, H = p.H;
      buildInto(p.group, p.kind, this.shadows, 0.6, (lx, lz) => Math.min(30, Math.max(0.4, H - 0.3 - baseHeightAt(cx + lx, cz + lz) + 0.35)), st && p.kind === 'foundation', p.mask ?? 0);
    } else buildInto(p.group, p.kind, this.shadows, 0.6, undefined, st);
    const w = this.windows.get(p.key); if (w) this.poseWindow(p, w.ang);
  }

  // ---- windows: the glazed casements open and shut (E); open ones are remembered by the window's key
  readonly windows = new Map<string, { open: boolean; sign: number; ang: number }>();
  onWindow: ((p: Piece, open: boolean, sign: number) => void) | null = null;
  windowOpen(p: Piece) { return !!this.windows.get(p.key)?.open; }
  /** which way the casements swing to open away from someone standing at (x, z) */
  swingFrom(p: Piece, x: number, z: number) {
    const side = p.axis === 'x' ? Math.sign(z - p.group.position.z) : Math.sign(x - p.group.position.x);
    return side >= 0 ? 1 : -1;
  }
  setWindow(p: Piece, open: boolean, sign: number, remote = false) {
    if (p.kind !== 'window') return;
    const w = this.windows.get(p.key) ?? { open: false, sign, ang: 0 };
    if (w.open === open && this.windows.has(p.key)) return;
    w.open = open; if (open) w.sign = sign;
    this.windows.set(p.key, w);
    if (!remote) this.onWindow?.(p, open, w.sign);
  }
  private poseWindow(p: Piece, ang: number) {
    const sh = p.group.metadata?.sash as TransformNode[] | undefined; if (!sh) return;
    sh[0].rotation.y = ang; sh[1].rotation.y = -ang;
  }
  /** per frame: swing the casements */
  update(dt: number) {
    for (const [key, w] of this.windows) {
      const to = w.open ? w.sign * 1.35 : 0;
      if (Math.abs(to - w.ang) < 1e-3) { if (!w.open) this.windows.delete(key); continue; }
      w.ang += Math.sign(to - w.ang) * Math.min(Math.abs(to - w.ang), dt * 2.6);
      const p = this.edges.get(key); if (p) this.poseWindow(p, w.ang);
    }
  }
  captureExtras() { return { stone: [...this.stone], windows: [...this.windows].filter(([, w]) => w.open).map(([k, w]) => [k, w.sign]) }; }
  restoreExtras(x: { stone?: string[]; windows?: [string, number][] } | undefined) {
    for (const id of x?.stone ?? []) { const [kind, key] = [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)]; const p = this.mapFor(kind as PieceKind).get(key); if (p) this.upgrade(p, true); }
    for (const [key, sign] of x?.windows ?? []) { const p = this.edges.get(key); if (p && p.kind === 'window') { this.windows.set(key, { open: true, sign, ang: sign * 1.35 }); this.poseWindow(p, sign * 1.35); } }
  }
  /** the ground under a foundation was cut / restored: refresh the terrain mesh + grass in this rectangle */
  onTerrain: ((x0: number, z0: number, x1: number, z1: number) => void) | null = null;
  /** set by the structure manager so foundations don't swallow campfires etc. */
  blockedByStructures: ((x0: number, z0: number, x1: number, z1: number) => boolean) | null = null;

  constructor(scene: Scene, private colliders: ColliderGrid, private shadows: boolean) {
    SCENE = scene;
    this.ghostMat = ghostMaterial(scene, 'buildGhost');
    for (const p of PIECES) {
      const gh = new TransformNode(`ghost_${p.kind}`, scene);
      buildInto(gh, p.kind, false, 0.6, undefined, false, 0, this.ghostMat);
      gh.setEnabled(false); gh.scaling.setAll(1.006); // keep the ghost's faces off the real pieces' faces
      this.ghosts.set(p.kind, gh);
    }
  }

  private mapFor(kind: PieceKind) {
    return kind === 'foundation' || kind === 'floor' || kind === 'pool' ? this.cells : kind === 'roof' ? this.roofs : kind === 'stairs' ? this.stairs : this.edges;
  }

  // ------------------------------------------------------------ queries used by the player and placement
  /** height of a staircase's treads at (x, z) */
  private rampH(p: Piece, x: number, z: number) {
    const [dx, dz] = STAIR_DIRS[p.dir], cx = p.i * CELL + CELL / 2, cz = p.j * CELL + CELL / 2;
    const u = Math.max(0, Math.min(1, ((x - cx) * dx + (z - cz) * dz) / CELL + 0.5));
    return p.H + u * WALL_H;
  }

  /** the tops of railings' end posts (where a torch can stand): each corner once */
  railPosts(except?: Piece): V3[] {
    const out: V3[] = [];
    for (const p of this.edges.values()) {
      if (p.kind !== 'railing' || p === except) continue;
      const x0 = p.i * CELL, z0 = p.j * CELL;
      const ends: [number, number][] = p.axis === 'x' ? [[x0, z0], [x0 + CELL, z0]] : [[x0, z0], [x0, z0 + CELL]];
      const y = p.H + RAIL_H + 0.11;
      for (const [x, z] of ends) if (!out.some((o) => Math.abs(o.x - x) < 0.01 && Math.abs(o.z - z) < 0.01 && Math.abs(o.y - y) < 0.05)) out.push({ x, y, z });
    }
    return out;
  }
  /** is there a railing post top at (x, z), height y (within a few cm)? (`except`: not counting that railing) */
  railPostAt(x: number, z: number, y: number, except?: Piece): boolean {
    return this.railPosts(except).some((o) => Math.abs(o.x - x) < 0.03 && Math.abs(o.z - z) < 0.03 && Math.abs(o.y - y) < 0.06);
  }

  /** Top of the foundation under (x, z), or -Infinity (ground level only). */
  floorAt(x: number, z: number): number {
    const f = this.cells.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
    return f ? f.H : -Infinity;
  }
  /** Is (x, z) in the water of a pool, for something with its feet at y? (splashy footsteps) */
  inPool(x: number, z: number, y: number): boolean {
    const p = this.cells.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
    return !!p && p.kind === 'pool' && y < p.H - 0.3 && y > p.H - 1.2 && !inPoolRim(p.mask ?? 0, x - p.i * CELL - CELL / 2, z - p.j * CELL - CELL / 2);
  }
  /** What a walker at height `y` stands on at (x, z): the terrain, or the highest floor / stair tread it can step up to. */
  ground = (x: number, z: number, y = 1e9): number => {
    let g = heightAt(x, z);
    const l = this.colAt.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`);
    if (l) for (const p of l) {
      const h = p.kind === 'stairs' ? this.rampH(p, x, z) : p.kind === 'roof' ? p.H + WALL_H + 0.16
        : p.kind === 'pool' && !inPoolRim(p.mask ?? 0, x - p.i * CELL - CELL / 2, z - p.j * CELL - CELL / 2) ? p.H - POOL_DEPTH : p.H;
      if (h > g && h <= y + (p.kind === "stairs" ? 1.3 : 0.9)) g = h;
    }
    return g;
  };

  private boxList(x: number, z: number): Box[][] {
    const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL), out: Box[][] = [];
    for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) { const b = this.boxCells.get(cellKey(i, j)); if (b) out.push(b); }
    return out;
  }

  /** Pushes a walking circle out of foundations and walls (taking its feet height into account). */
  resolve(x: number, z: number, r: number, feetY: number, out: { x: number; z: number }) {
    for (const list of this.boxList(x, z)) {
      for (const b of list) {
        if (feetY + 1.7 < b.y0 || feetY > b.y1 - (b.step ?? 0.3)) continue;
        const cx = Math.max(b.x0, Math.min(x, b.x1)), cz = Math.max(b.z0, Math.min(z, b.z1));
        const dx = x - cx, dz = z - cz, d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-8) { const d = Math.sqrt(d2); x = cx + (dx / d) * r; z = cz + (dz / d) * r; }
        else {
          // centre inside the box: leave through the nearest face
          const l = x - b.x0, rr = b.x1 - x, t = z - b.z0, bt = b.z1 - z, m = Math.min(l, rr, t, bt);
          if (m === l) x = b.x0 - r; else if (m === rr) x = b.x1 + r; else if (m === t) z = b.z0 - r; else z = b.z1 + r;
        }
      }
    }
    out.x = x; out.z = z;
  }

  /** True if a circle at height y would touch building geometry. */
  touches(x: number, z: number, r: number, y: number): boolean {
    for (const list of this.boxList(x, z)) {
      for (const b of list) {
        if (y + 1.0 < b.y0 || y > b.y1 - 0.05) continue;
        const cx = Math.max(b.x0, Math.min(x, b.x1)), cz = Math.max(b.z0, Math.min(z, b.z1));
        if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) return true;
      }
    }
    return false;
  }

  // ------------------------------------------------------------ support rules
  /** blocks from solid support: 0 = fully supported, 1-MAX_OUT = sticking out from a supported block, -1 = cannot stand here */
  private slabSpan(i: number, j: number, L: number, terrainOk: boolean): number {
    if (L === 0 && terrainOk) return 0;
    if (L > 0) { const b = this.cells.get(cellKey(i, j, L - 1)); if (b) return b.span; }
    let best = 99;
    for (const [a, c] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]) { const n = this.cells.get(cellKey(a, c, L)); if (n) best = Math.min(best, n.span + 1); }
    return best <= MAX_OUT ? best : -1;
  }
  private groundRange(i: number, j: number) {
    let hMax = -1e9, hMin = 1e9;
    for (let u = 0; u <= 2; u++) for (let v = 0; v <= 2; v++) {
      const h = heightAt(i * CELL + (u * CELL) / 2, j * CELL + (v * CELL) / 2);
      hMax = Math.max(hMax, h); hMin = Math.min(hMin, h);
    }
    return { hMax, hMin };
  }
  private terrainOk(i: number, j: number, H: number, hasNb: boolean) {
    const { hMin } = this.groundRange(i, j);
    return hMin <= H + 0.1 && hMin >= (hasNb ? SHALLOW : SHALLOW + 0.25) && H - hMin <= (hasNb ? 3.6 : 3.6);
  }

  // ------------------------------------------------------------ aiming / ghost
  private neighbours(i: number, j: number): Piece[] {
    return [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]].map(([a, b]) => this.cells.get(cellKey(a, b))).filter(Boolean) as Piece[];
  }

  private blank(kind: PieceKind, reason: string): Aim {
    return { kind, ok: false, show: false, reason, i: 0, j: 0, axis: 'x', H: 0, L: 0, dir: 0, x: 0, y: 0, z: 0 };
  }

  /** the candidate cell whose plane (at the height of its floor) the view ray passes through nearest to its middle */
  private planeCell(eye: V3, dir: V3, cands: { i: number; j: number; L: number; H: number }[], reach = 9) {
    let best: { i: number; j: number; L: number; H: number } | null = null, bs = 1e9;
    for (const c of cands) {
      if (Math.abs(dir.y) < 1e-4) continue;
      const t = (c.H - eye.y) / dir.y;
      if (t < 0.3 || t > reach) continue;
      const px = eye.x + dir.x * t, pz = eye.z + dir.z * t;
      const d = Math.max(Math.abs(px - (c.i * CELL + CELL / 2)), Math.abs(pz - (c.j * CELL + CELL / 2)));
      if (d > CELL / 2 + 0.35) continue;
      const sc = d + t * 0.02;
      if (sc < bs) { bs = sc; best = c; }
    }
    return best;
  }
  /** cells next to / above existing slabs near the player */
  private slabCandidates(eye: V3, level: 'ground' | 'upper' | 'stack') {
    const out: { i: number; j: number; L: number; H: number }[] = [], seen = new Set<string>();
    for (const s of this.cells.values()) {
      if (Math.hypot(s.i * CELL + CELL / 2 - eye.x, s.j * CELL + CELL / 2 - eye.z) > 14) continue;
      const add = (i: number, j: number, L: number, H: number) => { const k = cellKey(i, j, L); if (seen.has(k) || this.cells.has(k)) return; seen.add(k); out.push({ i, j, L, H }); };
      if (level === 'ground' && s.L === 0) for (const [a, b] of [[s.i - 1, s.j], [s.i + 1, s.j], [s.i, s.j - 1], [s.i, s.j + 1]]) add(a, b, 0, s.H);
      if (level === 'upper') {
        if (s.L > 0) for (const [a, b] of [[s.i - 1, s.j], [s.i + 1, s.j], [s.i, s.j - 1], [s.i, s.j + 1]]) add(a, b, s.L, s.H);
        if (s.L < MAX_LEVEL) add(s.i, s.j, s.L + 1, s.H + WALL_H);
      }
    }
    return out;
  }

  private aimFoundation(i: number, j: number, eye: V3, kind: PieceKind = 'foundation'): Aim {
    const x0 = i * CELL, z0 = j * CELL;
    const a = { ...this.blank(kind, ''), ok: true, show: true, i, j, x: x0 + CELL / 2, z: z0 + CELL / 2 } as Aim;
    if (this.cells.has(cellKey(i, j))) { a.ok = false; a.reason = 'Already built'; a.H = this.cells.get(cellKey(i, j))!.H; a.y = a.H; return a; }
    const { hMax, hMin } = this.groundRange(i, j);
    const nb = this.neighbours(i, j);
    let soft = '';                                   // a problem a slab sticking out from solid ground gets around
    if (nb.length) {
      // Snap to the neighbour nearest the player; uneven ground is fine as long as part of the slab stays visible.
      let ref = nb[0], bd = 1e9;
      for (const n of nb) { const d = Math.hypot(n.i * CELL + CELL / 2 - eye.x, n.j * CELL + CELL / 2 - eye.z); if (d < bd) { bd = d; ref = n; } }
      a.H = ref.H;
      if (hMin > a.H + 0.1) { a.ok = false; a.reason = 'Ground is too high here (slab fully buried)'; }
      else if (a.H - hMin > 3.6) soft = 'Ground drops away too far';
      else if (hMin < SHALLOW) soft = 'The water is too deep';
    } else {
      // Level ground: sit just above the highest corner. Slopes: sink the uphill side into the hill (up to half a metre)
      // and let the pilings reach down to the low side, like a real stilt house. Only truly steep ground is refused.
      const spread = hMax - hMin;
      a.H = spread <= 0.7 ? hMax + 0.12 : Math.max(hMax - 0.5, hMin + 0.3);
      // (in the shallows the pilings stand on the sea floor: the slab sits just above the water)
      if (hMin < 0.3) a.H = Math.max(a.H, 0.45);
      if (a.H - hMin > 3.6) { a.ok = false; a.reason = 'Ground is too steep'; }
      else if (hMin < SHALLOW + 0.25) { a.ok = false; a.reason = 'The water is too deep here: build out from the shore'; }
    }
    a.y = a.H;
    if (a.ok && soft && this.slabSpan(i, j, 0, false) < 0) { a.ok = false; a.reason = `${soft}: a block can only stick out ${MAX_OUT} blocks from solid ground`; }
    if (a.ok && Math.hypot(a.x - eye.x, a.z - eye.z) > 9) { a.ok = false; a.reason = 'Too far away'; }
    if (a.ok && !soft && (this.colliders.anyIn(x0, z0, x0 + CELL, z0 + CELL, 0.12) || this.blockedByStructures?.(x0, z0, x0 + CELL, z0 + CELL))) {
      a.ok = false; a.reason = 'Something is in the way';
    }
    return a;
  }

  private aimFloor(eye: V3, dir: V3): Aim {
    const a = this.blank('floor', 'Aim at the edge of a foundation or floor, or up at the space above one');
    const c = this.planeCell(eye, dir, this.slabCandidates(eye, 'upper'));
    if (!c) return a;
    a.show = true; a.i = c.i; a.j = c.j; a.L = c.L; a.H = c.H; a.x = c.i * CELL + CELL / 2; a.z = c.j * CELL + CELL / 2; a.y = c.H;
    const below = c.L > 0 ? cellKey(c.i, c.j, c.L - 1) : '';
    if (this.roofs.has(below)) { a.reason = 'Remove the roof first'; return a; }
    if (this.stairs.has(below)) { a.reason = 'The staircase needs this opening'; return a; }
    if (c.L > MAX_LEVEL) { a.reason = 'That is as high as you can build'; return a; }
    if (this.slabSpan(c.i, c.j, c.L, false) < 0) { a.reason = `Needs support: at most ${MAX_OUT} blocks out from a block that stands on something solid`; return a; }
    if (Math.hypot(a.x - eye.x, a.z - eye.z) > 10) { a.reason = 'Too far away'; return a; }
    a.ok = true; a.reason = '';
    return a;
  }

  private aimStairs(eye: V3, dir: V3): Aim {
    const a = this.blank('stairs', 'Aim at a foundation or floor');
    const cands: { i: number; j: number; L: number; H: number }[] = [];
    for (const s of this.cells.values()) if (Math.hypot(s.i * CELL + CELL / 2 - eye.x, s.j * CELL + CELL / 2 - eye.z) < 12) cands.push({ i: s.i, j: s.j, L: s.L, H: s.H });
    const c = this.planeCell(eye, dir, cands);
    if (!c) return a;
    // climbs the way you are facing
    const dd = Math.abs(dir.x) > Math.abs(dir.z) ? (dir.x > 0 ? 1 : 3) : (dir.z > 0 ? 2 : 0);
    a.show = true; a.i = c.i; a.j = c.j; a.L = c.L; a.H = c.H; a.dir = dd; a.x = c.i * CELL + CELL / 2; a.z = c.j * CELL + CELL / 2; a.y = c.H;
    const k = cellKey(c.i, c.j, c.L);
    if (this.stairs.has(k)) { a.reason = 'Already built'; return a; }
    if (this.roofs.has(k)) { a.reason = 'Remove the roof first'; return a; }
    if (this.cells.has(cellKey(c.i, c.j, c.L + 1))) { a.reason = 'There is a floor above: remove it first'; return a; }
    if (c.L >= MAX_LEVEL) { a.reason = 'That is as high as you can build'; return a; }
    if (Math.hypot(a.x - eye.x, a.z - eye.z) > 10) { a.reason = 'Too far away'; return a; }
    a.ok = true; a.reason = '';
    return a;
  }

  private aimEdge(kind: PieceKind, eye: V3, dir: V3): Aim {
    const a = this.blank(kind, 'Aim at the edge of a foundation or floor');
    let best = 1.7, found: { axis: 'x' | 'z'; i: number; j: number; L: number; H: number } | null = null;
    for (const s of this.cells.values()) {
      if (Math.hypot(s.i * CELL + CELL / 2 - eye.x, s.j * CELL + CELL / 2 - eye.z) > 13) continue;
      for (const [axis, ei, ej] of [['x', s.i, s.j], ['x', s.i, s.j + 1], ['z', s.i, s.j], ['z', s.i + 1, s.j]] as ['x' | 'z', number, number][]) {
        const mx = axis === 'x' ? ei * CELL + CELL / 2 : ei * CELL, mz = axis === 'x' ? ej * CELL : ej * CELL + CELL / 2;
        const vx = mx - eye.x, vy = s.H + 0.8 - eye.y, vz = mz - eye.z, t = vx * dir.x + vy * dir.y + vz * dir.z;
        if (t < 0.3 || t > 10) continue;
        const d = Math.hypot(vx - dir.x * t, vy - dir.y * t, vz - dir.z * t);
        if (d < best) { best = d; found = { axis, i: ei, j: ej, L: s.L, H: s.H }; }
      }
    }
    if (!found) return a;
    const { axis, i, j, L } = found;
    a.show = true;
    const adj = axis === 'x' ? [this.cells.get(cellKey(i, j - 1, L)), this.cells.get(cellKey(i, j, L))] : [this.cells.get(cellKey(i - 1, j, L)), this.cells.get(cellKey(i, j, L))];
    a.axis = axis; a.i = i; a.j = j; a.L = L;
    a.H = Math.max(...adj.map((p) => (p ? p.H : -1e9)));
    a.x = axis === 'x' ? i * CELL + CELL / 2 : i * CELL;
    a.z = axis === 'x' ? j * CELL : j * CELL + CELL / 2;
    a.y = a.H;
    if (this.edges.has(edgeKey(axis, i, j, L))) { a.reason = 'Already built'; return a; }
    a.ok = true; a.reason = '';
    return a;
  }

  private aimRoof(eye: V3, dir: V3): Aim {
    const a = this.blank('roof', 'Aim at a foundation or floor');
    let best = 3.4, found: Piece | null = null;
    for (const f of this.cells.values()) {
      const cx = f.i * CELL + CELL / 2, cz = f.j * CELL + CELL / 2;
      if (Math.hypot(cx - eye.x, cz - eye.z) > 13) continue;
      const vx = cx - eye.x, vy = f.H + WALL_H * 0.6 - eye.y, vz = cz - eye.z, t = vx * dir.x + vy * dir.y + vz * dir.z;
      if (t < 0.3 || t > 11) continue;
      const d = Math.hypot(vx - dir.x * t, vy - dir.y * t, vz - dir.z * t);
      if (d < best) { best = d; found = f; }
    }
    if (!found) return a;
    a.i = found.i; a.j = found.j; a.L = found.L; a.H = found.H; a.show = true;
    a.x = found.i * CELL + CELL / 2; a.z = found.j * CELL + CELL / 2; a.y = found.H + WALL_H;
    if (this.roofs.has(cellKey(a.i, a.j, a.L))) { a.reason = 'Already built'; return a; }
    if (this.cells.has(cellKey(a.i, a.j, a.L + 1))) { a.reason = 'There is a floor here already'; return a; }
    if (this.stairs.has(cellKey(a.i, a.j, a.L))) { a.reason = 'The staircase needs this opening'; return a; }
    if (Math.hypot(a.x - eye.x, a.z - eye.z) > 10) { a.reason = 'Too far away'; return a; }
    a.ok = true; a.reason = '';
    return a;
  }

  /** Positions the ghost for `kind` where the player is looking. Call every frame while the plan is equipped. */
  updateGhost(kind: PieceKind, eye: V3, dir: V3): Aim {
    let a: Aim;
    if (kind === 'foundation' || kind === 'pool') {
      const r = rayGround(eye, dir, 7, this.ground);
      a = this.aimFoundation(Math.floor(r.x / CELL), Math.floor(r.z / CELL), eye, kind);
      if (!a.ok) {
        // sticking out over a drop or the water: aim at the space beside the platform instead of the ground far below
        const c = this.planeCell(eye, dir, this.slabCandidates(eye, 'ground'));
        if (c) { const b = this.aimFoundation(c.i, c.j, eye, kind); if (b.ok) a = b; }
      }
    } else if (kind === 'floor') a = this.aimFloor(eye, dir);
    else if (kind === 'stairs') a = this.aimStairs(eye, dir);
    else if (kind === 'roof') a = this.aimRoof(eye, dir);
    else a = this.aimEdge(kind, eye, dir);
    this.aim = a;
    for (const [k, g] of this.ghosts) g.setEnabled(k === kind && a.show);
    const g = this.ghosts.get(kind)!;
    g.position.set(a.x, a.y, a.z);
    g.rotation.y = kind === 'stairs' ? Math.atan2(STAIR_DIRS[a.dir][0], STAIR_DIRS[a.dir][1])
      : a.axis === 'z' && kind !== 'foundation' && kind !== 'pool' && kind !== 'roof' && kind !== 'floor' ? Math.PI / 2 : 0;
    setGhostOk(this.ghostMat, a.ok);
    return a;
  }

  hideGhost() { for (const g of this.ghosts.values()) g.setEnabled(false); this.aim = null; }

  // ------------------------------------------------------------ build / remove
  /** extra solid boxes that are not pieces (closed doors) */
  addBox(b: Box) {
    for (let i = Math.floor(b.x0 / CELL); i <= Math.floor((b.x1 - 1e-4) / CELL); i++) for (let j = Math.floor(b.z0 / CELL); j <= Math.floor((b.z1 - 1e-4) / CELL); j++) {
      const k = cellKey(i, j); let l = this.boxCells.get(k); if (!l) this.boxCells.set(k, (l = [])); if (!l.includes(b)) l.push(b);
    }
  }
  removeBox(b: Box) { for (const l of this.boxCells.values()) { const k = l.indexOf(b); if (k >= 0) l.splice(k, 1); } }
  pieceByKey(key: string): Piece | undefined { for (const p of this.pieces) if (p.key === key) return p; return undefined; }

  private register(p: Piece) {
    this.pieces.add(p);
    if (p.kind === 'foundation' || p.kind === 'pool' || p.kind === 'floor' || p.kind === 'stairs' || p.kind === 'roof') {
      const k = `${p.i},${p.j}`; let l = this.colAt.get(k); if (!l) this.colAt.set(k, (l = []));
      l.push(p);
    }
    for (const b of p.solid) {
      for (let i = Math.floor(b.x0 / CELL); i <= Math.floor((b.x1 - 1e-4) / CELL); i++) {
        for (let j = Math.floor(b.z0 / CELL); j <= Math.floor((b.z1 - 1e-4) / CELL); j++) {
          const k = cellKey(i, j);
          let l = this.boxCells.get(k); if (!l) this.boxCells.set(k, (l = []));
          l.push(b);
        }
      }
    }
  }

  place(a: Aim): Piece | null {
    if (!a.ok) return null;
    const { kind, i, j, axis, H } = a, L = a.L ?? 0;
    let group: TransformNode, solid: Box[] = [], hit: Box, key: string, cut: Cut | undefined, span = 0;
    const x0 = i * CELL, z0 = j * CELL;
    if (kind === 'pool') {
      const nb = this.neighbours(i, j).length > 0;
      span = Math.max(0, this.slabSpan(i, j, 0, this.terrainOk(i, j, H, nb)));
      const cx = x0 + CELL / 2, cz = z0 + CELL / 2;
      const mask = this.poolMask(i, j);
      group = buildMesh(kind, this.shadows, 0.6, (lx, lz) => Math.min(30, Math.max(0.4, H - 0.3 - baseHeightAt(cx + lx, cz + lz) + 0.35)), false, mask);
      group.position.set(cx, H, cz);
      solid = this.poolSolid(i, j, H, mask);
      hit = { x0, x1: x0 + CELL, z0, z1: z0 + CELL, y0: H - 0.4, y1: H + 0.05 };
      key = cellKey(i, j);
      cut = { x0, x1: x0 + CELL, z0, z1: z0 + CELL, y: H };
      const p: Piece = { kind, i, j, axis, H, L: 0, dir: 0, span, group, solid, hit, key, cut, mask };
      this.cells.set(key, p);
      this.register(p);
      addCut(cut); { const cb = cutBounds(cut); this.onTerrain?.(cb.x0, cb.z0, cb.x1, cb.z1); }
      this.refreshPools(i, j);
      this.onPlace?.(p);
      return p;
    } else if (kind === 'foundation') {
      const { hMin } = this.groundRange(i, j);
      const nb = this.neighbours(i, j).length > 0;
      span = Math.max(0, this.slabSpan(i, j, 0, this.terrainOk(i, j, H, nb)));
      // every stilt reaches down to the ground (or the sea bed) under its own corner, however far that is
      void hMin;
      const cx = x0 + CELL / 2, cz = z0 + CELL / 2;
      group = buildMesh(kind, this.shadows, 0.6, (lx, lz) => Math.min(30, Math.max(0.4, H - 0.3 - baseHeightAt(cx + lx, cz + lz) + 0.35)));
      group.position.set(x0 + CELL / 2, H, z0 + CELL / 2);
      solid = [{ x0, x1: x0 + CELL, z0, z1: z0 + CELL, y0: H - 6, y1: H, step: 0.85 }];
      hit = { x0, x1: x0 + CELL, z0, z1: z0 + CELL, y0: H - 0.4, y1: H + 0.05 };
      key = cellKey(i, j);
      cut = { x0, x1: x0 + CELL, z0, z1: z0 + CELL, y: H };
    } else if (kind === 'floor') {
      span = Math.max(0, this.slabSpan(i, j, L, false));
      group = buildMesh(kind, this.shadows);
      group.position.set(x0 + CELL / 2, H, z0 + CELL / 2);
      solid = [{ x0, x1: x0 + CELL, z0, z1: z0 + CELL, y0: H - 0.45, y1: H, step: 0.85 }];
      hit = { x0, x1: x0 + CELL, z0, z1: z0 + CELL, y0: H - 0.4, y1: H + 0.05 };
      key = cellKey(i, j, L);
    } else if (kind === 'stairs') {
      group = buildMesh(kind, this.shadows);
      group.position.set(x0 + CELL / 2, H, z0 + CELL / 2);
      const [dx, dz] = STAIR_DIRS[a.dir]; group.rotation.y = Math.atan2(dx, dz);
      const n = STEPS, d = CELL / n;
      for (let k = 0; k < n; k++) {
        const t0 = k * d, t1 = (k + 1) * d;           // distance along the climb from the cell's low edge
        const h = ((k + 1) * WALL_H) / n;
        const u0 = -CELL / 2 + t0, u1 = -CELL / 2 + t1;
        const cx = x0 + CELL / 2, cz = z0 + CELL / 2;
        const bx0 = dx !== 0 ? cx + Math.min(dx * u0, dx * u1) : x0 + 0.15, bx1 = dx !== 0 ? cx + Math.max(dx * u0, dx * u1) : x0 + CELL - 0.15;
        const bz0 = dz !== 0 ? cz + Math.min(dz * u0, dz * u1) : z0 + 0.15, bz1 = dz !== 0 ? cz + Math.max(dz * u0, dz * u1) : z0 + CELL - 0.15;
        solid.push({ x0: bx0, x1: bx1, z0: bz0, z1: bz1, y0: H - 0.1, y1: H + h, step: 1.0 });
      }
      hit = { x0, x1: x0 + CELL, z0, z1: z0 + CELL, y0: H, y1: H + WALL_H };
      key = cellKey(i, j, L);
    } else if (kind === 'roof') {
      group = buildMesh(kind, this.shadows);
      group.position.set(x0 + CELL / 2, H + WALL_H, z0 + CELL / 2);
      solid = [{ x0: x0 - 0.2, x1: x0 + CELL + 0.2, z0: z0 - 0.2, z1: z0 + CELL + 0.2, y0: H + WALL_H - 0.3, y1: H + WALL_H + 0.16, step: 0.85 }];
      hit = { x0: x0 - 0.2, x1: x0 + CELL + 0.2, z0: z0 - 0.2, z1: z0 + CELL + 0.2, y0: H + WALL_H - 0.25, y1: H + WALL_H + 0.2 };
      key = cellKey(i, j, L);
    } else {
      group = buildMesh(kind, this.shadows);
      group.position.set(a.x, H, a.z);
      if (axis === 'z') group.rotation.y = Math.PI / 2;
      // (a railing round a corner shares its end post with the next one: a hair bigger one way, so they never z-fight)
      if (kind === 'railing' && axis === 'z') group.scaling.set(1.03, 1.006, 1.06);
      const h = kind === 'railing' ? 0.08 : THICK / 2, top = kind === 'railing' ? RAIL_H + 0.1 : WALL_H;
      const mk = (u0: number, u1: number): Box => axis === 'x'
        ? { x0: a.x + u0, x1: a.x + u1, z0: a.z - h, z1: a.z + h, y0: H, y1: H + top }
        : { x0: a.x - h, x1: a.x + h, z0: a.z + u0, z1: a.z + u1, y0: H, y1: H + top };
      if (kind === 'doorway') { const sw = (CELL - 1.2) / 2; solid = [mk(-CELL / 2, -CELL / 2 + sw), mk(CELL / 2 - sw, CELL / 2)]; }
      else solid = [mk(-CELL / 2, CELL / 2)];
      const hb = mk(-CELL / 2, CELL / 2);
      hit = { ...hb, x0: hb.x0 - (axis === 'z' ? 0.1 : 0), x1: hb.x1 + (axis === 'z' ? 0.1 : 0), z0: hb.z0 - (axis === 'x' ? 0.1 : 0), z1: hb.z1 + (axis === 'x' ? 0.1 : 0) };
      key = edgeKey(axis, i, j, L);
    }
    const p: Piece = { kind, i, j, axis, H, L, dir: a.dir ?? 0, span, group, solid, hit, key, cut };
    this.mapFor(kind).set(key, p);
    this.register(p);
    if (cut) { addCut(cut); const cb = cutBounds(cut); this.onTerrain?.(cb.x0, cb.z0, cb.x1, cb.z1); }
    this.onPlace?.(p);
    return p;
  }

  /** Network: build a piece another player placed (no cost, no checks). */
  placeRemote(kind: PieceKind, i: number, j: number, axis: 'x' | 'z', H: number, L = 0, dir = 0): Piece | null {
    const key = (kind === 'foundation' || kind === 'pool' || kind === 'floor' || kind === 'roof' || kind === 'stairs') ? cellKey(i, j, L) : edgeKey(axis, i, j, L);
    if (this.mapFor(kind).has(key)) return null;
    const x = axis === 'x' ? i * CELL + CELL / 2 : i * CELL, z = axis === 'x' ? j * CELL : j * CELL + CELL / 2;
    const prev = this.onPlace; this.onPlace = null;
    const p = this.place({ kind, ok: true, show: true, reason: '', i, j, axis, H, L, dir, x, y: H, z });
    this.onPlace = prev;
    return p;
  }

  find(kind: PieceKind, i: number, j: number, axis: 'x' | 'z', L = 0): Piece | undefined {
    return this.mapFor(kind).get(kind === 'foundation' || kind === 'pool' || kind === 'floor' || kind === 'roof' || kind === 'stairs' ? cellKey(i, j, L) : edgeKey(axis, i, j, L));
  }

  /** Why a piece can't be removed right now, or null. */
  canRemove(p: Piece): string | null {
    if (p.kind !== 'foundation' && p.kind !== 'floor' && p.kind !== 'pool') return null;
    const { i, j, L } = p;
    if (this.roofs.has(cellKey(i, j, L))) return 'Remove the roof first';
    for (const [axis, ei, ej] of [['x', i, j], ['x', i, j + 1], ['z', i, j], ['z', i + 1, j]] as ['x' | 'z', number, number][]) {
      if (this.edges.has(edgeKey(axis, ei, ej, L))) return 'Remove the walls first';
    }
    if (this.stairs.has(cellKey(i, j, L))) return 'Remove the staircase first';
    if (this.cells.has(cellKey(i, j, L + 1))) return 'Remove the floor above first';
    // anything that only holds up because of this block?
    this.cells.delete(p.key);
    let blocked = false;
    for (const [a, c] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]) {
      const n = this.cells.get(cellKey(a, c, L));
      if (n && n.span > 0 && this.slabSpan(n.i, n.j, n.L, false) < 0) blocked = true;
    }
    this.cells.set(p.key, p);
    return blocked ? 'Other blocks are held up by this one' : null;
  }

  /** after any piece comes down (yours or someone else's): pictures fall off walls */
  afterRemove: ((p: Piece, silent: boolean) => void) | null = null;

  remove(p: Piece, silent = false) {
    this.stone.delete(BuildingSystem.sid(p)); if (p.kind === 'window') this.windows.delete(p.key);
    if (!silent) this.onRemove?.(p);
    this.afterRemove?.(p, silent);
    this.pieces.delete(p);
    this.mapFor(p.kind).delete(p.key);
    const col = this.colAt.get(`${p.i},${p.j}`);
    if (col) { const k = col.indexOf(p); if (k >= 0) col.splice(k, 1); }
    if (p.cut) { removeCut(p.cut); const b = cutBounds(p.cut); this.onTerrain?.(b.x0, b.z0, b.x1, b.z1); }
    clearNode(p.group); p.group.dispose();
    for (const b of p.solid) {
      for (const l of this.boxCells.values()) { const k = l.indexOf(b); if (k >= 0) l.splice(k, 1); }
    }
    if (p.kind === 'pool') this.refreshPools(p.i, p.j);
  }

  // ------------------------------------------------------------ pools join up
  private isPool(i: number, j: number) { return this.cells.get(cellKey(i, j))?.kind === 'pool'; }
  private poolMask(i: number, j: number) {
    const n = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
    return n.reduce((m, [a, b], k) => m | (this.isPool(i + a, j + b) ? 1 << k : 0), 0);
  }
  /** what you bump into round a pool: the deck all round its open sides, and the pool floor (you can step down into it and back up) */
  private poolSolid(i: number, j: number, H: number, mask: number): Box[] {
    const x0 = i * CELL, z0 = j * CELL, r = POOL_RIM, out: Box[] = [{ x0, x1: x0 + CELL, z0, z1: z0 + CELL, y0: H - 6, y1: H - POOL_DEPTH, step: 0.85 }];
    const deck = (bx0: number, bx1: number, bz0: number, bz1: number) => out.push({ x0: bx0, x1: bx1, z0: bz0, z1: bz1, y0: H - 6, y1: H, step: 0.85 });
    if (!bit(mask, 0)) deck(x0, x0 + r, z0, z0 + CELL);
    if (!bit(mask, 1)) deck(x0 + CELL - r, x0 + CELL, z0, z0 + CELL);
    if (!bit(mask, 2)) deck(x0, x0 + CELL, z0, z0 + r);
    if (!bit(mask, 3)) deck(x0, x0 + CELL, z0 + CELL - r, z0 + CELL);
    if (bit(mask, 0) && bit(mask, 2) && !bit(mask, 4)) deck(x0, x0 + r, z0, z0 + r);
    if (bit(mask, 1) && bit(mask, 2) && !bit(mask, 5)) deck(x0 + CELL - r, x0 + CELL, z0, z0 + r);
    if (bit(mask, 0) && bit(mask, 3) && !bit(mask, 6)) deck(x0, x0 + r, z0 + CELL - r, z0 + CELL);
    if (bit(mask, 1) && bit(mask, 3) && !bit(mask, 7)) deck(x0 + CELL - r, x0 + CELL, z0 + CELL - r, z0 + CELL);
    return out;
  }
  /** a pool came or went at (i, j): the pools round it reshape (decks where they no longer join, open water where they now do) */
  private refreshPools(i: number, j: number) {
    for (let a = i - 1; a <= i + 1; a++) for (let b = j - 1; b <= j + 1; b++) {
      const p = this.cells.get(cellKey(a, b));
      if (!p || p.kind !== 'pool' || !this.pieces.has(p)) continue;
      const m = this.poolMask(a, b);
      if (m === p.mask) continue;
      p.mask = m;
      this.rebuild(p);
      for (const bx of p.solid) this.removeBox(bx);
      p.solid = this.poolSolid(a, b, p.H, m);
      for (const bx of p.solid) this.addBox(bx);
    }
  }

  /** Nearest piece along the view ray (slab test against each piece's hit box). */
  findPiece(eye: V3, dir: V3, reach: number): { piece: Piece; dist: number } | null {
    let best: { piece: Piece; dist: number } | null = null;
    for (const p of this.pieces) {
      const b = p.hit;
      if (Math.abs((b.x0 + b.x1) / 2 - eye.x) > reach + 3 || Math.abs((b.z0 + b.z1) / 2 - eye.z) > reach + 3) continue;
      let t0 = 0, t1 = reach;
      const slab = (o: number, d: number, lo: number, hi: number) => {
        if (Math.abs(d) < 1e-8) return o >= lo && o <= hi;
        let a = (lo - o) / d, c = (hi - o) / d;
        if (a > c) { const s = a; a = c; c = s; }
        t0 = Math.max(t0, a); t1 = Math.min(t1, c);
        return t0 <= t1;
      };
      if (slab(eye.x, dir.x, b.x0, b.x1) && slab(eye.y, dir.y, b.y0, b.y1) && slab(eye.z, dir.z, b.z0, b.z1)) {
        if (!best || t0 < best.dist) best = { piece: p, dist: t0 };
      }
    }
    return best;
  }
}

