// Ice grottos (the layout is arctic.ts: grottoOf). Out among the bergs, some of the big ones have a hole in their foot,
// 3 m under the sea, with a cold blue glow coming up out of it (a shimmer on the surface over it shows where). Swim down
// into the hole and you come up in a pool inside the ice: a domed grotto of glowing blue ice, icicles hanging from its
// roof, and on a ledge a treasure chest (looted, saved and shared like the deep sea's chests, one per berg). Dive back
// down through the pool to swim out again.
// The grotto itself is one place far off (x = -16 km, up in the air where nothing else is), dressed for whichever berg
// you came in by; the mouths are built only near you.
import { Color3, type Material, Mesh, MeshBuilder, PointLight, Quaternion, type Scene, StandardMaterial, TransformNode, Vector3, VertexData } from "@babylonjs/core";
import * as THREE from "three";
import { glow, solid } from "../render/materials";
import { type Camp, campsNear, type Grotto, grottosNear, iceHeight, iceNear } from "./arctic";
import { chestModel, type DeepChest, type DeepSea } from "./deepsea";

/** where the grotto is, its floor's height, the dome's radius and height, the pool (where you come in and go out) */
export const GX = -16000, GZ = 0, GY = 30;
const DOME_R = 13, DOME_H = 9, POOL = { x: -7, z: 0, r: 4.2, deep: 3.2 };
const MOUTH_R = 380;

const rnd = (() => { let a = 77123; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();

export class IceGrottos {
  active = false;
  /** the grotto you are in (its berg's mouth, for the way back out) */
  cur: Grotto | null = null;
  private room: TransformNode;
  private built = false;
  private mouths = new Map<number, TransformNode>();
  private near: Grotto[] = [];
  private nearAt = { x: 1e9, z: 1e9 };
  private chestG: THREE.Group | null = null;
  private chest: DeepChest | null = null;
  private lights: PointLight[] = [];
  private coolT = 0;
  private seaMask: number | null = null;
  private holeM: StandardMaterial;
  private shimmerM: Material;
  say: (t: string) => void = () => {};
  private told = false;

  constructor(private readonly scene: Scene, private readonly ice: Material, private readonly three: THREE.Object3D, private readonly deep: DeepSea) {
    this.room = new TransformNode("iceGrotto", scene);
    this.room.position.set(GX, GY, GZ);
    this.room.setEnabled(false);
    this.holeM = new StandardMaterial("grottoHole", scene);
    this.holeM.diffuseColor = Color3.Black(); this.holeM.specularColor = Color3.Black(); this.holeM.emissiveColor = new Color3(0.02, 0.12, 0.2);
    this.shimmerM = glow(scene, "#5fdcff", 0.22);
  }

  /** the grottos within `rad` of (x, z) (for tests and the map) */
  around(x: number, z: number, rad: number) { return grottosNear(x, z, rad, []); }
  campsAround(x: number, z: number, rad: number) { return campsNear(x, z, rad, []); }
  contains(x: number, z: number) { return Math.hypot(x - GX, z - GZ) < 80; }

  // ---------------------------------------------------------------- out at sea: the mouths
  /** builds the mouths near you; the berg whose mouth a swimmer at `me` is in (to go in), or null */
  update(dt: number, me: { x: number; y: number; z: number }, swimming: boolean, away: boolean): Grotto | null {
    this.coolT -= dt;
    if (this.active) { for (const l of this.lights) l.intensity = l.metadata.k * (0.9 + 0.1 * Math.sin(performance.now() / 300 + l.metadata.k)); return null; }
    if (away) { this.dropMouths(); return null; }
    if (Math.hypot(me.x - this.nearAt.x, me.z - this.nearAt.z) > 60) {
      this.nearAt.x = me.x; this.nearAt.z = me.z;
      grottosNear(me.x, me.z, MOUTH_R, this.near);
      const keep = new Set(this.near.map((g) => g.id));
      for (const [id, n] of this.mouths) if (!keep.has(id)) { n.dispose(); this.mouths.delete(id); }
      for (const g of this.near) if (!this.mouths.has(g.id)) this.mouths.set(g.id, this.mouth(g));
      // and the explorers' camps on top of the flat bergs
      const camps = campsNear(me.x, me.z, MOUTH_R, []), keepC = new Set(camps.map((c) => c.id));
      for (const [id, c] of this.camps) if (!keepC.has(id)) { this.dropCamp(c); this.camps.delete(id); }
      for (const c of camps) if (!this.camps.has(c.id)) this.camps.set(c.id, this.camp(c));
      for (const c of camps) if (!this.campTold && Math.hypot(me.x - c.x, me.z - c.z) < 120 && me.y > c.y - 2) { this.campTold = true; this.say("Somebody camped up here once... a tent, a flag, and something left behind."); }
    }
    let hit: Grotto | null = null;
    for (const g of this.near) {
      const d = Math.hypot(me.x - g.x, me.z - g.z);
      if (!this.told && d < 45) { this.told = true; this.say("A blue glow shines up out of the water at the foot of that iceberg..."); }
      if (swimming && this.coolT <= 0 && d < 2.6 && Math.abs(me.y - (g.y + 0.8)) < 2.4) hit = g;
    }
    return hit;
  }

  private dropMouths() {
    for (const n of this.mouths.values()) n.dispose(); this.mouths.clear(); this.near.length = 0; this.nearAt.x = 1e9;
    for (const c of this.camps.values()) this.dropCamp(c); this.camps.clear();
  }

  // ---------------------------------------------------------------- explorers' camps on the flat bergs
  private camps = new Map<number, { node: TransformNode; chestG: THREE.Group; chest: DeepChest }>();
  private campTold = false;
  private dropCamp(c: { node: TransformNode; chestG: THREE.Group; chest: DeepChest }) {
    c.node.dispose(); this.deep.dropChest(c.chest); this.three.remove(c.chestG);
    c.chestG.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  }
  /** a camp: an orange ridge tent, a pole with a faded red flag, a ring of stones round a dead fire, a sled with crates,
   *  snow drifted against it all, and the chest */
  private camp(c: Camp) {
    const S = this.scene, node = new TransformNode("bergCamp", S);
    node.position.set(c.x, c.y, c.z); node.rotation.y = c.yaw;
    const parts = new Map<Material, Mesh[]>();
    const put = (m: Mesh, mat: Material, x: number, y: number, z: number) => { m.position.set(x, y, z); let a = parts.get(mat); if (!a) parts.set(mat, (a = [])); a.push(m); return m; };
    const canvas = solid(S, "#e8742a", 0.8), wood = solid(S, "#6b4a2c", 0.9), snow = solid(S, "#f2f7fc", 0.95), stone = solid(S, "#55595e", 0.95), red = solid(S, "#b8322a", 0.85), crate = solid(S, "#a07848", 0.9), char = solid(S, "#1c1917", 1);
    // the tent: an orange ridge tent side-on to the ramp (its ridge along x), both ends closed
    for (const sz of [-1, 1]) { const t = MeshBuilder.CreateBox("tent", { width: 2.8, height: 0.05, depth: 1.7 }, S); t.rotation.x = sz * 0.95; put(t, canvas, 0, 0.68, -2 + sz * 0.55); }
    for (const ex of [-1.4, 1.4]) {
      const e = new Mesh("tentEnd", S), vd = new VertexData();
      vd.positions = [0, 0, -1.0, 0, 0, 1.0, 0, 1.36, 0]; vd.indices = [0, 1, 2, 0, 2, 1]; vd.normals = [1, 0, 0, 1, 0, 0, 1, 0, 0]; vd.uvs = [0, 0, 1, 0, 0.5, 1];
      vd.applyToMesh(e); put(e, canvas, ex, 0, -2);
    }
    put(MeshBuilder.CreateBox("ridge", { width: 3.0, height: 0.07, depth: 0.07 }, S), wood, 0, 1.36, -2);
    put(MeshBuilder.CreateBox("drift", { width: 3.2, height: 0.25, depth: 0.9 }, S), snow, 0, 0.1, -3.2);
    // the flag
    put(MeshBuilder.CreateCylinder("pole", { diameter: 0.07, height: 3.4, tessellation: 6 }, S), wood, 2.2, 1.7, -2.6);
    const flag = MeshBuilder.CreatePlane("flag", { width: 1.1, height: 0.7, sideOrientation: Mesh.DOUBLESIDE }, S); flag.rotation.y = Math.PI / 2; put(flag, red, 2.2, 3.0, -2.05);
    // the dead campfire
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; put(MeshBuilder.CreateSphere("st", { diameter: 0.26, segments: 4 }, S), stone, 2.0 + Math.cos(a) * 0.45, 0.08, 0.6 + Math.sin(a) * 0.45); }
    put(MeshBuilder.CreateCylinder("ash", { diameter: 0.7, height: 0.04, tessellation: 12 }, S), char, 2.0, 0.03, 0.6);
    for (const r of [0.3, -0.5]) { const l = MeshBuilder.CreateCylinder("log", { diameter: 0.1, height: 0.7, tessellation: 6 }, S); l.rotation.set(Math.PI / 2, r, 0); put(l, char, 2.0, 0.08, 0.6); }
    // the sled with its crates
    for (const sx of [-1, 1]) { const run = MeshBuilder.CreateBox("runner", { width: 0.06, height: 0.08, depth: 2.2 }, S); put(run, wood, -2.2 + sx * 0.4, 0.05, 0.2); }
    put(MeshBuilder.CreateBox("deck", { width: 0.95, height: 0.06, depth: 1.9 }, S), wood, -2.2, 0.22, 0.2);
    put(MeshBuilder.CreateBox("crate", { width: 0.7, height: 0.5, depth: 0.7 }, S), crate, -2.2, 0.5, 0.6);
    put(MeshBuilder.CreateBox("crate2", { width: 0.55, height: 0.4, depth: 0.55 }, S), crate, -2.2, 0.45, -0.25).rotation.y = 0.3;
    put(MeshBuilder.CreateBox("sledSnow", { width: 0.9, height: 0.1, depth: 0.7 }, S), snow, -2.2, 0.8, 0.6);
    for (const [m, list] of parts) {
      const merged = Mesh.MergeMeshes(list, true, true, undefined, false, false);
      if (merged) { merged.material = m; merged.parent = node; merged.isPickable = false; merged.receiveShadows = true; }
    }
    // the chest, by the tent's door (the deep sea's kind: looted, saved and shared the same way)
    const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw), lx = 0.9, lz = -0.4;
    const wx = c.x + lx * cs + lz * sn, wz = c.z - lx * sn + lz * cs;
    const chestG = new THREE.Group(); chestG.position.set(wx, c.y, wz); chestG.rotation.y = c.yaw;
    const cm = chestModel(); chestG.add(cm.g); this.three.add(chestG);
    const chest: DeepChest = { id: c.id, x: wx, y: c.y, z: wz, yaw: c.yaw, lid: cm.lid, glow: cm.glow, looted: 0, small: false };
    this.deep.addChest(chest);
    return { node, chestG, chest };
  }

  /** a mouth: a dark hole lying in the slope of the berg's foot, a glowing rim round it, a shimmer up to the surface */
  private mouth(g: Grotto): TransformNode {
    const root = new TransformNode("grottoMouth", this.scene);
    root.position.set(g.x, g.y + 0.05, g.z);
    // (lie in the slope: its normal from the ice's height round about)
    const f = iceNear(g.x, g.z, 2, [], false, true).find((q) => q.id === g.id);
    const h = (x: number, z: number) => { const v = f ? iceHeight(f, x, z) : g.y; return Number.isFinite(v) ? v : g.y - 1; };
    const n = new Vector3(-(h(g.x + 0.6, g.z) - h(g.x - 0.6, g.z)) / 1.2, 1, -(h(g.x, g.z + 0.6) - h(g.x, g.z - 0.6)) / 1.2).normalize();
    root.rotationQuaternion = new Quaternion();
    Quaternion.FromUnitVectorsToRef(Vector3.Up(), n, root.rotationQuaternion);
    const hole = MeshBuilder.CreateSphere("grottoHole", { diameter: 1, segments: 12 }, this.scene);
    hole.scaling.set(4.2, 0.9, 3.2); hole.material = this.holeM; hole.parent = root; hole.isPickable = false;
    const rim = MeshBuilder.CreateTorus("grottoRim", { diameter: 4.0, thickness: 0.35, tessellation: 28 }, this.scene);
    rim.scaling.z = 0.78; rim.material = glow(this.scene, "#7fe6ff", 0.55); rim.parent = root; rim.position.y = 0.12; rim.isPickable = false;
    // the shimmer: a faint column of light up to the surface (a pale patch on the water over it)
    const col = MeshBuilder.CreateCylinder("grottoShimmer", { diameterTop: 3.4, diameterBottom: 2.4, height: -g.y + 0.3, tessellation: 16, cap: Mesh.NO_CAP }, this.scene);
    col.material = this.shimmerM; col.position.set(g.x, (g.y + 0.3) / 2, g.z); col.isPickable = false;
    col.parent = null;
    const holder = new TransformNode("grottoMouthAll", this.scene);
    root.parent = holder; col.parent = holder;
    // (root's world position was set before parenting to an identity holder: unchanged)
    return holder;
  }

  // ---------------------------------------------------------------- the grotto
  floor(x: number, z: number, _y: number) {
    const d = Math.hypot(x - GX - POOL.x, z - GZ - POOL.z);
    if (d < POOL.r - 1.6) return GY - POOL.deep;
    if (d < POOL.r) return GY - POOL.deep + (POOL.deep - 0.1) * ((d - (POOL.r - 1.6)) / 1.6);
    return GY;
  }
  liquidAt(x: number, z: number) { return Math.hypot(x - GX - POOL.x, z - GZ - POOL.z) < POOL.r + 0.3 ? GY - 0.05 : null; }
  ceiling(x: number, z: number, _y: number) { const d = Math.hypot(x - GX, z - GZ) / DOME_R; return GY + DOME_H * Math.sqrt(Math.max(0.05, 1 - d * d)); }
  resolve(x: number, z: number, r: number, _y: number, out: { x: number; z: number }) {
    let lx = x - GX, lz = z - GZ;
    const d = Math.hypot(lx, lz), lim = DOME_R - 1.4 - r;
    if (d > lim) { lx *= lim / d; lz *= lim / d; }
    // (the chest's ledge)
    const cx = lx - 8.2, cz = lz;
    if (Math.abs(cx) < 0.9 + r && Math.abs(cz) < 1.3 + r) { if (cx < 0) lx = 8.2 - 0.9 - r; }
    out.x = lx + GX; out.z = lz + GZ;
  }
  /** below the pool's surface, far enough down: swimming back out */
  wantsOut(x: number, y: number, z: number) {
    return this.active && this.coolT <= 0 && Math.hypot(x - GX - POOL.x, z - GZ - POOL.z) < POOL.r - 1.4 && y < GY - POOL.deep + 0.9;
  }

  enter(g: Grotto, p: { teleport(x: number, y: number, z: number, yaw: number): void; cave: unknown }) {
    if (!this.built) this.build();
    this.active = true; this.cur = g; this.room.setEnabled(true); p.cave = this;
    // (the sea is drawn round wherever you are: not in here)
    const sea = this.scene.getMeshByName("ocean");
    if (sea) { this.seaMask = sea.layerMask; sea.layerMask = 0; }
    for (const l of this.lights) l.setEnabled(true);
    this.dropMouths();
    // the chest: this berg's (its own id: looted once, then it fills again in time, as the deep's do)
    this.chestG = new THREE.Group(); this.chestG.position.set(GX + 8.2, GY + 0.62, GZ); this.chestG.rotation.y = -Math.PI / 2;
    const c = chestModel(); this.chestG.add(c.g); this.three.add(this.chestG);
    this.chest = { id: g.id, x: GX + 8.2, y: GY + 0.62, z: GZ, yaw: -Math.PI / 2, lid: c.lid, glow: c.glow, looted: 0, small: false };
    this.deep.addChest(this.chest);
    this.coolT = 2.5;
    p.teleport(GX + POOL.x, GY - POOL.deep + 0.6, GZ + POOL.z, Math.PI / 2);
    this.say("You come up in a grotto inside the iceberg! Something glints on the ledge... Dive back down through the pool to swim out.");
  }

  leave(p: { teleport(x: number, y: number, z: number, yaw: number): void; cave: unknown }) {
    const g = this.cur;
    this.active = false; this.cur = null; this.room.setEnabled(false); p.cave = null;
    const sea = this.scene.getMeshByName("ocean");
    if (sea && this.seaMask !== null) sea.layerMask = this.seaMask;
    this.seaMask = null;
    for (const l of this.lights) l.setEnabled(false);
    if (this.chest) this.deep.dropChest(this.chest);
    if (this.chestG) { this.three.remove(this.chestG); this.chestG.traverse((o) => (o as THREE.Mesh).geometry?.dispose()); }
    this.chest = null; this.chestG = null;
    this.coolT = 3;
    if (g) {
      // (out of the mouth, a few metres away from the ice, under the water)
      const x = g.x + Math.cos(g.ang) * 3.5, z = g.z + Math.sin(g.ang) * 3.5;
      p.teleport(x, Math.min(-1.2, g.y + 1.2), z, Math.atan2(Math.cos(g.ang), Math.sin(g.ang)) + Math.PI);
    }
  }

  /** the room: a pool to come up in, an ice floor, a dome of glowing blue ice, icicles, a ledge for the chest */
  private build() {
    this.built = true;
    const S = this.scene, parts = new Map<Material, Mesh[]>();
    const put = (m: Mesh, mat: Material) => { let a = parts.get(mat); if (!a) parts.set(mat, (a = [])); a.push(m); return m; };
    const dome = MeshBuilder.CreateSphere("gDome", { diameter: DOME_R * 2, segments: 18, slice: 0.5, sideOrientation: Mesh.BACKSIDE }, S);
    dome.scaling.y = DOME_H / DOME_R;
    put(dome, this.ice);
    const floorM = solid(S, "#cfe9f6", 0.35);
    // (the floor: rings round the middle, leaving the pool open)
    {
      const pos: number[] = [], idx: number[] = [], NA = 64, NR = 14;
      for (let i = 0; i <= NR; i++) for (let j = 0; j < NA; j++) { const r = (i / NR) * DOME_R, a = (j / NA) * Math.PI * 2; pos.push(Math.cos(a) * r, 0.01, Math.sin(a) * r); }
      for (let i = 0; i < NR; i++) for (let j = 0; j < NA; j++) {
        const a = i * NA + j, b = i * NA + ((j + 1) % NA), c = a + NA, d = b + NA;
        const cx = (pos[a * 3] + pos[d * 3]) / 2, cz = (pos[a * 3 + 2] + pos[d * 3 + 2]) / 2;
        if (Math.hypot(cx - POOL.x, cz - POOL.z) < POOL.r + 0.1) continue;
        idx.push(a, c, b, b, c, d);
      }
      const fl = new Mesh("gFloor", S), vd = new VertexData();
      vd.positions = pos; vd.indices = idx; vd.normals = pos.map((_, k) => (k % 3 === 1 ? 1 : 0)); vd.uvs = new Array((pos.length / 3) * 2).fill(0);
      vd.applyToMesh(fl);
      put(fl, floorM);
    }
    // the pool: a hole in the floor (a dark blue bowl) with water across it
    const bowl = MeshBuilder.CreateSphere("gBowl", { diameter: POOL.r * 2, segments: 16, slice: 0.5, sideOrientation: Mesh.BACKSIDE }, S);
    bowl.rotation.x = Math.PI; bowl.scaling.y = (POOL.deep + 0.4) / POOL.r; bowl.position.set(POOL.x, 0.02, POOL.z);
    put(bowl, solid(S, "#0c3f6e", 0.2));
    const water = MeshBuilder.CreateDisc("gWater", { radius: POOL.r + 0.05, tessellation: 40 }, S); water.rotation.x = Math.PI / 2; water.position.set(POOL.x, -0.05, POOL.z);
    const wm = new StandardMaterial("gWaterM", S); wm.diffuseColor = new Color3(0.05, 0.3, 0.45); wm.emissiveColor = new Color3(0.05, 0.32, 0.5); wm.alpha = 0.72; wm.specularColor = new Color3(0.8, 0.9, 1); wm.backFaceCulling = false;
    water.material = wm; water.parent = this.room; water.isPickable = false;
    // (the floor over the pool would cover it: a ring of floor instead of the disc there, so cut it out with the bowl's rim)
    const rimM = solid(S, "#b9def0", 0.3);
    const rim = MeshBuilder.CreateTorus("gRim", { diameter: POOL.r * 2 + 0.4, thickness: 0.5, tessellation: 40 }, S); rim.position.set(POOL.x, 0.05, POOL.z); rim.scaling.y = 0.4;
    put(rim, rimM);
    // icicles hanging from the roof, a few glowing crystals on the floor
    const icicle = glow(S, "#bff2ff", 0.85);
    for (let k = 0; k < 46; k++) {
      const a = rnd() * Math.PI * 2, rr = 2 + rnd() * (DOME_R - 4), top = DOME_H * Math.sqrt(Math.max(0.05, 1 - (rr / DOME_R) ** 2)), L = 0.6 + rnd() * 2.2;
      const ic = MeshBuilder.CreateCylinder("gIcicle", { diameterTop: 0.22 + rnd() * 0.2, diameterBottom: 0, height: L, tessellation: 6 }, S);
      ic.position.set(Math.cos(a) * rr, top - L / 2 + 0.1, Math.sin(a) * rr);
      put(ic, rnd() < 0.3 ? icicle : this.ice);
    }
    const crystal = glow(S, "#6fe0ff");
    for (let k = 0; k < 14; k++) {
      const a = rnd() * Math.PI * 2, rr = DOME_R - 2.2 - rnd() * 1.5;
      const cr = MeshBuilder.CreateCylinder("gCrystal", { diameterTop: 0, diameterBottom: 0.35 + rnd() * 0.3, height: 0.8 + rnd() * 1.4, tessellation: 5 }, S);
      cr.position.set(Math.cos(a) * rr, 0.5, Math.sin(a) * rr); cr.rotation.set((rnd() - 0.5) * 0.6, 0, (rnd() - 0.5) * 0.6);
      put(cr, crystal);
    }
    // the ledge the chest sits on
    const ledge = MeshBuilder.CreateBox("gLedge", { width: 1.8, height: 0.6, depth: 2.6 }, S); ledge.position.set(8.2, 0.3, 0);
    put(ledge, rimM);
    for (const [m, list] of parts) {
      const merged = Mesh.MergeMeshes(list, true, true, undefined, false, false);
      if (merged) { merged.material = m; merged.parent = this.room; merged.isPickable = false; merged.receiveShadows = true; }
    }
    // the light: cold blue from everywhere, warm from the chest
    for (const [x, y, z, r, col, k] of [[0, 5, 0, 26, new Color3(0.45, 0.8, 1), 1.4], [7.6, 1.6, 0, 7, new Color3(1, 0.8, 0.4), 1.1], [POOL.x, -1.5, POOL.z, 9, new Color3(0.3, 0.75, 1), 1.0]] as const) {
      const l = new PointLight("gLight", new Vector3(x, y, z), S);
      l.parent = this.room; l.diffuse = col as Color3; l.range = r; l.metadata = { k }; l.setEnabled(false);
      l.includedOnlyMeshes = this.room.getChildMeshes(true);
      this.lights.push(l);
    }
  }
}
