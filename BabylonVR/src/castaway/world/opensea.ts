// The open sea's islets and wrecks, built round you as you sail (see world/seafeatures.ts for where they are).
//  - An islet: a low hump of sand (a little grass on top) and maybe a chest half dug into the sand (its palms, boulders and
//    ore are the vegetation's, so they can be felled and mined).
//  - A wreck: an old ship lying over on its side on a reef some metres down, ribs showing where her planks have gone, the
//    stump of her mast sticking up out of the sea to mark the spot, and a chest in her hold.
// Only what is within BUILD of you exists (one more built per step, so nothing stalls); further than DROP it is taken down.
// Drawn by render/mirror.ts (the nature mirror). The chests are the deep sea's (looted the same way, the same for everyone).
import * as THREE from "three";
import { chestModel, type DeepChest, type DeepSea } from "./deepsea";
import { deepFloorAt, heightAt } from "./island";
import { featuresNear, type SeaFeature, shoreR } from "./seafeatures";
import type { Collider, ColliderGrid } from "./vegetation";

const BUILD = 900, DROP = 1150;

interface Built { f: SeaFeature; g: THREE.Group; chest: DeepChest | null; cols: Collider[]; geos: THREE.BufferGeometry[] }

let MATS: { ground: THREE.Material; plank: THREE.Material; rib: THREE.Material; mast: THREE.Material; seabed: THREE.Material } | null = null;
const mats = () => (MATS ??= {
  ground: new THREE.MeshBasicMaterial({ vertexColors: true }),
  plank: new THREE.MeshStandardMaterial({ color: "#4a3a2a", roughness: 1 }),
  rib: new THREE.MeshStandardMaterial({ color: "#3b4a36", roughness: 1 }),
  mast: new THREE.MeshStandardMaterial({ color: "#3e3226", roughness: 1 }),
  seabed: new THREE.MeshStandardMaterial({ color: "#6b604c", roughness: 1, metalness: 0 }),
});

/** a seeded random number source */
function rng(seed: number) { let s = Math.floor(seed * 1e5) >>> 0 || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

export class OpenSea {
  readonly group = new THREE.Group();
  private built = new Map<number, Built>();
  private near: SeaFeature[] = [];
  private t = 0;

  constructor(scene: THREE.Object3D, private readonly deep: DeepSea, private readonly colliders: ColliderGrid | null) {
    scene.add(this.group);
  }

  /** `me`: where you are; `away`: in a cave, a level, a room (nothing out here is needed) */
  update(dt: number, me: { x: number; z: number }, away: boolean) {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.4;
    if (away) { for (const b of [...this.built.values()]) this.drop(b); for (const [k, m] of this.floor) { this.group.remove(m); m.geometry.dispose(); this.floor.delete(k); } return; }
    this.stepFloor(me);
    // take down what is far behind; build the nearest one not built yet (one per step)
    for (const b of [...this.built.values()]) if (Math.hypot(b.f.x - me.x, b.f.z - me.z) > DROP) this.drop(b);
    // (from the island itself only the nearer ones: a few on the horizon, nothing more to draw over the island)
    featuresNear(me.x, me.z, Math.hypot(me.x, me.z) < 450 ? 650 : BUILD, this.near);
    let best: SeaFeature | null = null, bd = Infinity;
    for (const f of this.near) { if (this.built.has(f.id)) continue; const d = Math.hypot(f.x - me.x, f.z - me.z); if (d < bd) { bd = d; best = f; } }
    if (best) this.build(best);
  }

  /** the nearest islet within 300 m (where the gulls wheel) */
  nearest(me: { x: number; z: number }): { x: number; z: number } | null {
    let best: SeaFeature | null = null, bd = 300;
    for (const b of this.built.values()) { if (b.f.kind !== "islet") continue; const d = Math.hypot(b.f.x - me.x, b.f.z - me.z); if (d < bd) { bd = d; best = b.f; } }
    return best;
  }
  /** (tests, debugging) the nearest islet or wreck of a kind to (x, z), wherever it is */
  find(kind: SeaFeature["kind"], x: number, z: number): SeaFeature | null {
    let best: SeaFeature | null = null, bd = Infinity;
    for (const f of featuresNear(x, z, 2600)) { if (f.kind !== kind) continue; const d = Math.hypot(f.x - x, f.z - z); if (d < bd) { bd = d; best = f; } }
    return best;
  }
  // ------------------------------------------------------------------ the bare sea floor out here
  /** squares of the deep floor round you (the deep sea's own floor covers the middle; this the rest, wherever you sail) */
  private floor = new Map<string, THREE.Mesh>();
  private stepFloor(me: { x: number; z: number }) {
    const T = 400, R = 1100, STEP = 20, N = T / STEP;
    for (const [k, m] of this.floor) {
      const [i, j] = k.split(",").map(Number);
      if (Math.hypot((i + 0.5) * T - me.x, (j + 0.5) * T - me.z) > R + T) { this.group.remove(m); m.geometry.dispose(); this.floor.delete(k); }
    }
    let best: [number, number] | null = null, bd = Infinity;
    for (let i = Math.floor((me.x - R) / T); i <= Math.floor((me.x + R) / T); i++) for (let j = Math.floor((me.z - R) / T); j <= Math.floor((me.z + R) / T); j++) {
      const cx = (i + 0.5) * T, cz = (j + 0.5) * T, d = Math.hypot(cx - me.x, cz - me.z);
      // (not where the deep sea's own floor already is: the square within 700 m of the middle)
      if (d > R || d >= bd || this.floor.has(`${i},${j}`) || (Math.abs(cx) + T / 2 <= 700 && Math.abs(cz) + T / 2 <= 700)) continue;
      bd = d; best = [i, j];
    }
    if (!best) return;
    const [i, j] = best, pos: number[] = [], idx: number[] = [];
    for (let b = 0; b <= N; b++) for (let a = 0; a <= N; a++) { const x = i * T + a * STEP, z = j * T + b * STEP; pos.push(x, deepFloorAt(x, z), z); }
    for (let b = 0; b < N; b++) for (let a = 0; a < N; a++) {
      const x = i * T + a * STEP, z = j * T + b * STEP;
      // (not inside the deep sea's floor, nor under the island's own ground)
      if (Math.abs(x + STEP / 2) < 700 && Math.abs(z + STEP / 2) < 700) continue;
      const v = (aa: number, bb: number) => bb * (N + 1) + aa;
      idx.push(v(a, b), v(a, b + 1), v(a + 1, b), v(a + 1, b), v(a, b + 1), v(a + 1, b + 1));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mats().seabed); m.frustumCulled = false;
    this.group.add(m);
    this.floor.set(`${i},${j}`, m);
  }

  /** how many are built just now (for tests) */
  get count() { return this.built.size; }

  private drop(b: Built) {
    this.group.remove(b.g);
    if (b.chest) this.deep.dropChest(b.chest);
    for (const c of b.cols) this.colliders?.remove(c);
    for (const g of b.geos) g.dispose();
    this.built.delete(b.f.id);
  }

  private build(f: SeaFeature) {
    const g = new THREE.Group(), b: Built = { f, g, chest: null, cols: [], geos: [] };
    if (f.kind === "islet") this.islet(f, b); else this.wreck(f, b);
    this.group.add(g);
    this.built.set(f.id, b);
  }

  // ------------------------------------------------------------------ an islet
  private islet(f: SeaFeature, b: Built) {
    const M = mats(), r = rng(f.seed), g = b.g;
    // the ground: rings out from the middle (close together round the shore), coloured by height
    const RINGS = [0, 0.2, 0.4, 0.55, 0.7, 0.8, 0.88, 0.95, 1.0, 1.05, 1.12, 1.22, 1.35, 1.55, 1.8, 2.1, 2.5, 3.0, 3.6, 4.4], SEG = 44;
    const pos: number[] = [], col: number[] = [], idx: number[] = [];
    const sand = new THREE.Color("#e2cf9c"), wet = new THREE.Color("#b9a479"), grass = new THREE.Color("#7aa04a"), deep = new THREE.Color("#5f6a58"), c = new THREE.Color();
    for (let ri = 0; ri < RINGS.length; ri++) for (let s = 0; s < SEG; s++) {
      const a = (s / SEG) * Math.PI * 2, R = RINGS[ri] * shoreR(f, a), x = f.x + Math.cos(a) * R, z = f.z + Math.sin(a) * R, y = heightAt(x, z);
      pos.push(x, y, z);
      if (y > 1.1) c.copy(sand).lerp(grass, Math.min(1, (y - 1.1) / 0.5) * (f.top > 2.4 ? 1 : 0.35));
      else if (y > 0.15) c.copy(sand);
      else c.copy(wet).lerp(deep, Math.min(1, -y / 12));
      col.push(c.r, c.g, c.b);
      if (ri < RINGS.length - 1) { const o = ri * SEG + s, n = ri * SEG + ((s + 1) % SEG); idx.push(o, n, o + SEG, n, n + SEG, o + SEG); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3)); geo.setIndex(idx); geo.computeVertexNormals();
    b.geos.push(geo);
    const ground = new THREE.Mesh(geo, M.ground); ground.frustumCulled = false; g.add(ground);
    // (the palms, boulders and ore on the islets are real ones, made with the island's: see vegetation.ts planIslets)
    // a chest, half dug into the sand
    if (f.chest) {
      const a = r() * Math.PI * 2, d = f.r * (0.2 + r() * 0.3), x = f.x + Math.cos(a) * d, z = f.z + Math.sin(a) * d;
      this.chest(b, x, heightAt(x, z) - 0.12, z, r() * Math.PI * 2, true);
    }
  }

  // ------------------------------------------------------------------ a wreck
  private wreck(f: SeaFeature, b: Built) {
    const M = mats(), r = rng(f.seed), g = b.g;
    const floor = heightAt(f.x, f.z);
    // the reef she lies on: a shallow, sandy shelf, pale on top, darker down its sides into the deep
    {
      const RINGS = [0, 0.25, 0.5, 0.7, 0.85, 1.0, 1.15, 1.35, 1.6, 1.9, 2.3, 2.8, 3.4, 4.2], SEG = 40;
      const pos: number[] = [], col: number[] = [], idx: number[] = [], top = new THREE.Color("#c9b58c"), side = new THREE.Color("#6e6656"), c = new THREE.Color();
      for (let ri = 0; ri < RINGS.length; ri++) for (let s = 0; s < SEG; s++) {
        const a = (s / SEG) * Math.PI * 2, R = RINGS[ri] * f.r, x = f.x + Math.cos(a) * R, z = f.z + Math.sin(a) * R, y = heightAt(x, z);
        pos.push(x, y, z);
        c.copy(top).lerp(side, Math.min(1, Math.max(0, (f.top - y) / 12))); col.push(c.r, c.g, c.b);
        if (ri < RINGS.length - 1) { const o = ri * SEG + s, n = ri * SEG + ((s + 1) % SEG); idx.push(o, n, o + SEG, n, n + SEG, o + SEG); }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3)); geo.setIndex(idx); geo.computeVertexNormals();
      b.geos.push(geo);
      const reef = new THREE.Mesh(geo, M.ground); reef.frustumCulled = false; g.add(reef);
    }
    // the ship, in her own space (bow at -z), then laid over on the reef
    const ship = new THREE.Group();
    const L = 17, add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
      const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); ship.add(o); b.geos.push(geo); return o;
    };
    // the keel, and the ribs standing up from it all along (the bow and stern narrower)
    add(new THREE.BoxGeometry(0.35, 0.45, L), M.rib, 0, 0.2, 0);
    const half = (z: number) => 2.4 * Math.sqrt(Math.max(0.05, 1 - (z / (L / 2)) ** 2));
    for (let i = 0; i <= 12; i++) {
      const z = -L / 2 + 0.8 + i * ((L - 1.6) / 12), w = half(z);
      add(new THREE.TorusGeometry(w, 0.1, 5, 12, Math.PI), M.rib, 0, 2.6, z, 0, 0, Math.PI);
    }
    // the planks: whole along the port side, broken away in the middle of the starboard side (where she struck)
    for (let row = 0; row < 7; row++) {
      const ang = (row / 7) * (Math.PI / 2) * 0.95;
      for (const side of [-1, 1]) for (let seg = 0; seg < 6; seg++) {
        if (side > 0 && seg >= 2 && seg <= 3 && row < 6) continue;
        if (r() < 0.12) continue;
        const z0 = -L / 2 + 0.6 + seg * ((L - 1.2) / 6), z1 = z0 + (L - 1.2) / 6, zc = (z0 + z1) / 2, w = half(zc);
        const x = side * Math.sin(ang) * w, y = 2.6 - Math.cos(ang) * w;
        add(new THREE.BoxGeometry(0.08, 0.42, z1 - z0 - 0.05), M.plank, x, y, zc, 0, 0, side * -ang + (r() - 0.5) * 0.06);
      }
    }
    // a bit of her deck left at the stern, and the mast: snapped, leaning, its top out of the water
    add(new THREE.BoxGeometry(4.2, 0.12, 4.5), M.plank, 0, 2.55, L / 2 - 3.2);
    add(new THREE.CylinderGeometry(0.17, 0.22, 12, 8), M.mast, 0, 6.5, -1.5, 0.12, 0, -0.35);
    add(new THREE.BoxGeometry(5.5, 0.16, 0.16), M.mast, -1.5, 9.3, -1.2, 0, 0.3, 0.45);
    ship.position.set(f.x, floor + 0.2, f.z);
    ship.rotation.set(0.05, f.yaw, 0.38, "YXZ");
    g.add(ship);
    // the chest in her hold, on the reef inside the hull
    const cx = f.x + Math.cos(f.yaw) * 0.6, cz = f.z - Math.sin(f.yaw) * 0.6;
    this.chest(b, cx, heightAt(cx, cz) + 0.05, cz, f.yaw + 0.4, false);
  }

  private chest(b: Built, x: number, y: number, z: number, yaw: number, small: boolean) {
    const c = chestModel();
    c.g.position.set(x, y, z); c.g.rotation.y = yaw;
    b.g.add(c.g);
    b.chest = { id: b.f.id, x, y, z, yaw, lid: c.lid, glow: c.glow, looted: 0, small };
    this.deep.addChest(b.chest);
  }
}
