// The Christmas village: through the great ice gate in the Arctic wall (northgate.ts) lies a hidden garden walled with
// ice, and in it a snowy village. Cute little houses in bright colours round a ring road, every one of them open to walk
// into (a fire in the hearth, a rug, a table); lanterns along the paths; Christmas trees hung with coloured lights, a
// star on top and presents underneath; a great tree in the village square; and the main path, lined with lanterns and
// candy canes, leading up to the biggest house of all: Santa's. (Elves and Santa himself come later.)
// It stands on its own far off at x = 16 km (nothing else is there), drawn only while you are in it: the island and the
// sea are hidden as in the towns. Walk back out through the gate behind you to return to the Arctic.
// Babylon meshes, built once on the first visit; everything static is merged into one mesh per material.
import { Color3, type Material, Mesh, MeshBuilder, PointLight, type Scene, TransformNode, Vector3, VertexData } from "@babylonjs/core";
import { glow, solid } from "../render/materials";

/** where it is (the middle of the village square's way) and its ground's height */
export const XX = 16000, XZ = 0, XBASE = 60;
/** the garden's ice wall (radius), the gate in it (local +z: the way you came in), where you arrive */
const WALL = 120, GATE_Z = 117, ARRIVE_Z = 106;

interface Box { x: number; z: number; hx: number; hz: number; rot: number }
interface Circ { x: number; z: number; r: number }

const rnd = (() => { let a = 20251225; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();

const WALLS = ["#c0392b", "#2e7d4f", "#f3e3c3", "#3b6fb6", "#e89aae", "#f0c050", "#8e5bb5", "#e07a3a"];
const BULBS = ["#ff3b3b", "#ffd23a", "#3bd1ff", "#5bff7a", "#ff6fe0", "#ffffff"];
const GIFTS = ["#d83a3a", "#2f8f4f", "#2f6fd6", "#f2c41c", "#9b59b6", "#ffffff"];

export class XmasVillage {
  readonly root: TransformNode;
  active = false;
  private built = false;
  private boxes: Box[] = [];
  private circs: Circ[] = [];
  private bins = new Map<Material, Mesh[]>();
  private t = 0;
  private star: Mesh | null = null;
  private lights: PointLight[] = [];
  private meshes: Mesh[] = [];
  say: (t: string) => void = () => {};
  /** how dark it is (0 day .. 1 night): the village's lamps light up */
  night = () => 0;

  /** `ice`: the garden wall's material (the icebergs' own) */
  constructor(private readonly scene: Scene, private readonly ice: Material) {
    this.root = new TransformNode("xmasVillage", scene);
    // (kept when the island is hidden: see caveView hideWorld)
    this.root.metadata = { keepUnderground: true };
    this.root.position.set(XX, XBASE, XZ);
    this.root.setEnabled(false);
  }

  contains(x: number, z: number) { return Math.hypot(x - XX, z - XZ) < WALL + 60; }
  /** where the gate is, for walking out through it (local z) */
  atExitGate(x: number, z: number) { const lx = x - XX, lz = z - XZ; return lz > GATE_Z - 2.5 && Math.abs(lx) < 4.5; }

  enter(p: { teleport(x: number, y: number, z: number, yaw: number): void; cave: unknown }) {
    if (!this.built) this.build();
    this.active = true; this.root.setEnabled(true); p.cave = this;
    p.teleport(XX, XBASE, XZ + ARRIVE_Z, 0);
    this.say("Through the ice gate: a hidden Christmas village! Follow the lantern path to the biggest house.");
  }
  leave(p: { cave: unknown }) {
    this.active = false; this.root.setEnabled(false); p.cave = null;
    for (const l of this.lights) l.setEnabled(false);
  }

  update(dt: number) {
    if (!this.active) return;
    this.t += dt;
    // (the star on the great tree turns slowly)
    if (this.star) this.star.rotation.y = this.t * 0.6;
    const n = this.night();
    for (const l of this.lights) { l.setEnabled(n > 0.05); l.intensity = l.metadata.k * n * (0.93 + 0.07 * Math.sin(this.t * 3 + l.metadata.k)); }
  }

  // ---------------------------------------------------------------- what the player stands on and bumps into
  floor(_x: number, _z: number, _y: number) { return XBASE; }
  resolve(x: number, z: number, r: number, _feetY: number, out: { x: number; z: number }) {
    let lx = x - XX, lz = z - XZ;
    // the garden's wall
    const d = Math.hypot(lx, lz), lim = WALL - 3 - r;
    if (d > lim) { lx *= lim / d; lz *= lim / d; }
    for (const b of this.boxes) {
      const dx = lx - b.x, dz = lz - b.z;
      if (Math.abs(dx) > b.hx + b.hz + r + 1 || Math.abs(dz) > b.hx + b.hz + r + 1) continue;
      const c = Math.cos(b.rot), s = Math.sin(b.rot);
      const u = dx * c - dz * s, v = dx * s + dz * c, ex = b.hx + r, ez = b.hz + r;
      if (Math.abs(u) >= ex || Math.abs(v) >= ez) continue;
      const pu = ex - Math.abs(u), pv = ez - Math.abs(v);
      let nu = u, nv = v;
      if (pu < pv) nu = Math.sign(u || 1) * ex; else nv = Math.sign(v || 1) * ez;
      lx = b.x + nu * c + nv * s; lz = b.z - nu * s + nv * c;
    }
    for (const q of this.circs) {
      const dx = lx - q.x, dz = lz - q.z, dd = Math.hypot(dx, dz), m = q.r + r;
      if (dd < m && dd > 1e-4) { lx = q.x + (dx / dd) * m; lz = q.z + (dz / dd) * m; }
    }
    out.x = lx + XX; out.z = lz + XZ;
  }

  // ---------------------------------------------------------------- building it
  private put(m: Mesh, mat: Material) { let a = this.bins.get(mat); if (!a) this.bins.set(mat, (a = [])); a.push(m); return m; }
  private box(w: number, h: number, d: number, x: number, y: number, z: number, mat: Material, rot = 0, parent?: TransformNode) {
    const m = MeshBuilder.CreateBox("x", { width: w, height: h, depth: d }, this.scene);
    m.position.set(x, y, z); m.rotation.y = rot;
    if (parent) { m.parent = parent; }
    return this.put(m, mat);
  }
  /** a solid wall to bump into (local, axis-aligned in a frame turned by rot about the house's centre) */
  private solidBox(x: number, z: number, hx: number, hz: number, rot: number) { this.boxes.push({ x, z, hx, hz, rot }); }

  private build() {
    this.built = true;
    const S = this.scene;
    const M = {
      snow: solid(S, "#eef4fa", 0.95), path: solid(S, "#b9aa9a", 0.9), pathEdge: solid(S, "#8f8172", 0.9),
      trim: solid(S, "#fbf7ee", 0.8), roof: solid(S, "#7a2e24", 0.8), roofSnow: solid(S, "#f7fbff", 0.9),
      wood: solid(S, "#8a5a30", 0.85), floor: solid(S, "#a8743f", 0.8), stone: solid(S, "#8b8580", 0.95),
      iron: solid(S, "#2a2d31", 0.6, 0.6), pine: solid(S, "#1f5a33", 0.9), trunk: solid(S, "#5a3b22", 0.95),
      gold: solid(S, "#e8b33a", 0.3, 0.9), red: solid(S, "#c62828", 0.6), green: solid(S, "#2e7d32", 0.7),
      window: glow(S, "#ffd889"), lamp: glow(S, "#ffcf70"), fire: glow(S, "#ff8a2a"), star: glow(S, "#ffe066"),
      rug: solid(S, "#a23a3a", 0.95), white: solid(S, "#ffffff", 0.7), ice: solid(S, "#bfe3f5", 0.25),
    };
    // ---- the ground: a snowy disc, a few drifts against the wall
    const g = MeshBuilder.CreateDisc("xmasGround", { radius: WALL + 4, tessellation: 72 }, S);
    g.rotation.x = Math.PI / 2; g.position.y = 0;
    this.put(g, M.snow);
    for (let k = 0; k < 40; k++) {
      const a = rnd() * Math.PI * 2, rr = WALL - 6 - rnd() * 6, s = 4 + rnd() * 6;
      const m = MeshBuilder.CreateSphere("drift", { diameter: s, segments: 8 }, S);
      m.scaling.y = 0.35; m.position.set(Math.cos(a) * rr, 0, Math.sin(a) * rr);
      this.put(m, M.snow);
    }
    // ---- the ice wall round the garden and the gate behind you
    {
      // (one ribbon of ice: a jagged face, a broken top, like the great wall outside)
      const pos: number[] = [], idx: number[] = [], N = 240;
      for (let k = 0; k <= N; k++) {
        const a = (k / N) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a), j = 0.5 + 1.5 * rnd();
        const top = 24 + 7 * Math.sin(k * 0.37) + 4 * Math.sin(k * 1.9) + 3 * rnd();
        const Ri = WALL + j;
        pos.push(c * Ri, -3, sn * Ri, c * (Ri + 0.5), top - 2, sn * (Ri + 0.5), c * (Ri + 2.5), top, sn * (Ri + 2.5), c * (Ri + 9), top - 1, sn * (Ri + 9));
        if (k < N) { const b = k * 4, d = b + 4; for (let q = 0; q < 3; q++) idx.push(b + q, b + q + 1, d + q, b + q + 1, d + q + 1, d + q); }
      }
      const m = new Mesh("xmasWall", this.scene), vd = new VertexData();
      vd.positions = pos; vd.indices = idx; const nor: number[] = []; VertexData.ComputeNormals(pos, idx, nor); vd.normals = nor;
      vd.applyToMesh(m); m.convertToFlatShadedMesh();
      m.material = this.ice; m.parent = this.root; m.isPickable = false; m.receiveShadows = true;
    }
    // (the gate behind you, from this side: blue pillars and lintel, the doors)
    const deep = solid(S, "#2c64a8", 0.2);
    for (const sx of [-1, 1]) {
      this.box(3, 20, 4, sx * 6, 9, GATE_Z + 1, deep);
      this.box(4, 1.5, 5, sx * 6, 19.6, GATE_Z + 1, M.ice);
    }
    this.box(15, 3, 4, 0, 18, GATE_Z + 1, deep);
    this.box(9, 16, 0.6, 0, 8, GATE_Z + 2.6, solid(S, "#d8eef8", 0.3));
    for (const y of [3, 8, 13]) this.box(9, 0.5, 0.3, 0, y, GATE_Z + 2.2, deep);
    // ---- the paths: the main one from the gate to Santa's door, the ring road, the village square
    this.box(6, 0.08, GATE_Z - 4 + 60, 0, 0.04, (GATE_Z - 4 - 60) / 2, M.path);
    for (const sx of [-1, 1]) this.box(0.35, 0.14, GATE_Z - 4 + 60, sx * 3.1, 0.07, (GATE_Z - 4 - 60) / 2, M.pathEdge);
    const ring = MeshBuilder.CreateTorus("ringRoad", { diameter: 110, thickness: 4.5, tessellation: 96 }, S);
    ring.scaling.y = 0.02; ring.position.y = 0.03;
    this.put(ring, M.path);
    const sq = MeshBuilder.CreateCylinder("square", { diameter: 30, height: 0.1, tessellation: 48 }, S);
    sq.position.set(0, 0.05, 25);
    this.put(sq, M.path);
    // ---- the great tree in the square
    this.tree(0, 25, 13, M, true);
    this.circs.push({ x: 0, z: 25, r: 3.2 });
    // ---- the little houses round the ring road, doors facing the middle
    let n = 0;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2 + Math.PI / 12;
      const off = (q: number) => Math.abs(Math.atan2(Math.sin(a - q), Math.cos(a - q)));
      if (off(Math.PI / 2) < 0.4 || off(-Math.PI / 2) < 0.5) continue;   // (the main path and Santa's house)
      const R = 73, x = Math.cos(a) * R, z = Math.sin(a) * R;
      // (local -z is a house's front: turned so it faces the square)
      this.house(x, z, Math.atan2(x, z), WALLS[n++ % WALLS.length], M);
    }
    for (const deg of [0, 45, 135, 180, 225, 315]) {
      const a = (deg * Math.PI) / 180, R = 36, x = Math.cos(a) * R, z = Math.sin(a) * R;
      this.house(x, z, Math.atan2(x, z), WALLS[n++ % WALLS.length], M, 6.5, 5.5, 3.1);
    }
    // ---- Santa's house at the end of the main path
    this.santa(0, -76, M);
    // ---- Christmas trees about the village, lanterns along the paths, candy canes by the main path
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2 + 0.2, R = k % 2 ? 46 : 96;
      const x = Math.cos(a) * R, z = Math.sin(a) * R;
      if (Math.abs(x) < 8 && z > -60) continue;
      if (z < -55 && Math.abs(x) < 20) continue;
      const h = 5 + rnd() * 3;
      this.tree(x, z, h, M, false);
      this.circs.push({ x, z, r: h * 0.2 });
    }
    // more trees out by the wall, and snowmen here and there
    for (let k = 0; k < 22; k++) {
      const a = rnd() * Math.PI * 2, R = 100 + rnd() * 10, x = Math.cos(a) * R, z = Math.sin(a) * R;
      if (Math.abs(x) < 10 && z > 0) continue;
      const h = 4 + rnd() * 4;
      this.tree(x, z, h, M, false);
      this.circs.push({ x, z, r: h * 0.2 });
    }
    for (const [x, z, yaw] of [[-12, 70, 0.4], [14, 84, -0.5], [-20, 12, 1.2], [22, -18, -2.2], [-44, -40, 2.4], [62, 12, -1.6], [10, -48, 3.0]]) this.snowman(x, z, yaw, M);
    for (let z = GATE_Z - 10; z > -56; z -= 9) {
      if (z > 8 && z < 42) continue;
      for (const sx of [-1, 1]) this.lantern(sx * 4.2, z, M);
      if (Math.round(z) % 2 === 0) for (const sx of [-1, 1]) this.cane(sx * 3.9, z - 4.5, M);
    }
    for (let k = 0; k < 28; k++) {
      const a = (k / 28) * Math.PI * 2;
      const off = (q: number) => Math.abs(Math.atan2(Math.sin(a - q), Math.cos(a - q)));
      if (off(Math.PI / 2) < 0.08 || off(-Math.PI / 2) < 0.08) continue;
      this.lantern(Math.cos(a) * 58.5, Math.sin(a) * 58.5, M);
    }
    // ---- merge everything static: one mesh per material
    const nodes = new Set<TransformNode>();
    for (const list of this.bins.values()) for (const m of list) if (m.parent) nodes.add(m.parent as TransformNode);
    for (const [mat, list] of this.bins) {
      const merged = Mesh.MergeMeshes(list, true, true, undefined, false, false);
      if (!merged) continue;
      merged.material = mat; merged.parent = this.root; merged.isPickable = false; merged.receiveShadows = true;
      merged.name = "xmas_" + mat.name;
    }
    this.bins.clear();
    for (const n of nodes) n.dispose();
    this.meshes = this.root.getChildMeshes(true) as Mesh[];
    // warm lights for the night: the square, Santa's door, the path by the gate (only the village's meshes take them)
    for (const [x, y, z, r, k] of [[0, 5, 25, 34, 1.6], [0, 4, -64, 26, 1.4], [0, 4, 86, 26, 1.0], [-36, 4, 0, 22, 0.9], [36, 4, 0, 22, 0.9]] as const) {
      const l = new PointLight("xmasLamp", new Vector3(x, y, z), this.scene);
      l.parent = this.root; l.diffuse = new Color3(1, 0.78, 0.48); l.specular = new Color3(0.4, 0.3, 0.2); l.range = r; l.metadata = { k };
      l.includedOnlyMeshes = this.meshes; l.setEnabled(false);
      this.lights.push(l);
    }
  }

  /** a snowman: three balls of snow, coal eyes and buttons, a carrot nose, a scarf and a hat */
  private snowman(x: number, z: number, yaw: number, M: Record<string, Material>) {
    const node = new TransformNode("snowman", this.scene); node.position.set(x, 0, z); node.rotation.y = yaw;
    const ball = (d: number, y: number) => { const b = MeshBuilder.CreateSphere("sm", { diameter: d, segments: 10 }, this.scene); b.parent = node; b.position.y = y; this.put(b, M.snow); };
    ball(1.3, 0.55); ball(0.95, 1.4); ball(0.66, 2.05);
    const coal = solid(this.scene, "#151515", 0.9);
    for (const sx of [-1, 1]) { const e = MeshBuilder.CreateSphere("eye", { diameter: 0.08, segments: 4 }, this.scene); e.parent = node; e.position.set(sx * 0.11, 2.12, -0.3); this.put(e, coal); }
    for (const y of [1.25, 1.45, 1.65]) { const b = MeshBuilder.CreateSphere("btn", { diameter: 0.09, segments: 4 }, this.scene); b.parent = node; b.position.set(0, y, -0.47); this.put(b, coal); }
    const nose = MeshBuilder.CreateCylinder("nose", { diameterTop: 0, diameterBottom: 0.1, height: 0.3, tessellation: 6 }, this.scene);
    nose.parent = node; nose.rotation.x = -Math.PI / 2; nose.position.set(0, 2.04, -0.45); this.put(nose, solid(this.scene, "#f07a1a", 0.7));
    const scarf = MeshBuilder.CreateTorus("scarf", { diameter: 0.62, thickness: 0.12, tessellation: 16 }, this.scene);
    scarf.parent = node; scarf.position.y = 1.77; this.put(scarf, M.red);
    const brim = MeshBuilder.CreateCylinder("brim", { diameter: 0.6, height: 0.05, tessellation: 16 }, this.scene); brim.parent = node; brim.position.y = 2.33; this.put(brim, coal);
    const hat = MeshBuilder.CreateCylinder("hat", { diameter: 0.4, height: 0.42, tessellation: 16 }, this.scene); hat.parent = node; hat.position.y = 2.55; this.put(hat, coal);
    this.circs.push({ x, z, r: 0.65 });
  }

  /** a gable end: a flat triangle (both faces) between the eaves and the ridge, in local x-y at depth z */
  private gable(node: TransformNode, half: number, y0: number, rise: number, z: number, mat: Material) {
    const m = new Mesh("gable", this.scene), vd = new VertexData();
    vd.positions = [-half, y0, z, half, y0, z, 0, y0 + rise, z];
    vd.indices = [0, 1, 2, 0, 2, 1];
    vd.normals = [0, 0, 1, 0, 0, 1, 0, 0, 1];
    vd.uvs = [0, 0, 1, 0, 0.5, 1];
    vd.applyToMesh(m);
    m.parent = node;
    this.put(m, mat);
  }

  /** a Christmas tree: three tiers of pine dusted with snow, coloured lights, a star, presents underneath */
  private tree(x: number, z: number, h: number, M: Record<string, Material>, great: boolean) {
    this.box(0.5 * h / 6, h * 0.16, 0.5 * h / 6, x, h * 0.08, z, M.trunk);
    const tiers = [[0.15, 0.48, 0.42], [0.42, 0.38, 0.33], [0.66, 0.27, 0.34]];
    for (const [y0, rad, th] of tiers) {
      const c = MeshBuilder.CreateCylinder("tier", { diameterTop: 0, diameterBottom: rad * h, height: th * h, tessellation: 14 }, this.scene);
      c.position.set(x, y0 * h + (th * h) / 2, z);
      this.put(c, M.pine);
      // (a dusting of snow on each tier's top)
      const sn = MeshBuilder.CreateCylinder("tierSnow", { diameterTop: 0, diameterBottom: rad * h * 0.55, height: th * h * 0.45, tessellation: 14 }, this.scene);
      sn.position.set(x, y0 * h + th * h * 0.78, z);
      this.put(sn, M.roofSnow);
      // the lights: a spiral round the tier
      const bulbs = great ? 26 : 12;
      for (let b = 0; b < bulbs; b++) {
        const t = b / bulbs, yy = y0 * h + th * h * (0.1 + 0.75 * t), rr = (rad * h / 2) * (1 - 0.1 - 0.75 * t) + 0.04;
        const ang = t * Math.PI * 4 + y0 * 9;
        const s = MeshBuilder.CreateSphere("bulb", { diameter: great ? 0.32 : 0.17, segments: 4 }, this.scene);
        s.position.set(x + Math.cos(ang) * rr, yy, z + Math.sin(ang) * rr);
        this.put(s, glow(this.scene, BULBS[(b + Math.round(y0 * 10)) % BULBS.length]));
      }
    }
    // the star
    const st = MeshBuilder.CreatePolyhedron("star", { type: 1, size: great ? 0.7 : 0.28 }, this.scene);
    st.position.set(x, h * 0.98, z); st.scaling.set(1, 1.3, 0.45);
    if (great) { st.material = M.star; st.parent = this.root; st.isPickable = false; this.star = st; }
    else this.put(st, M.star);
    // presents
    const nG = great ? 9 : 3 + Math.floor(rnd() * 3);
    for (let k = 0; k < nG; k++) {
      const a = rnd() * Math.PI * 2, rr = (great ? 3.6 : 1.1) + rnd() * (great ? 1.6 : 0.6), s = (great ? 0.6 : 0.4) + rnd() * 0.35;
      const px = x + Math.cos(a) * rr, pz = z + Math.sin(a) * rr, rot = rnd() * 3;
      const col = GIFTS[k % GIFTS.length], rib = GIFTS[(k + 3) % GIFTS.length];
      this.box(s, s * 0.8, s, px, s * 0.4, pz, solid(this.scene, col, 0.6), rot);
      this.box(s + 0.02, s * 0.8 + 0.02, s * 0.16, px, s * 0.4, pz, solid(this.scene, rib, 0.5), rot);
      this.box(s * 0.16, s * 0.8 + 0.02, s + 0.02, px, s * 0.4, pz, solid(this.scene, rib, 0.5), rot);
    }
  }

  private lantern(x: number, z: number, M: Record<string, Material>) {
    const p = MeshBuilder.CreateCylinder("lampPost", { diameter: 0.12, height: 2.6, tessellation: 6 }, this.scene);
    p.position.set(x, 1.3, z); this.put(p, M.iron);
    this.box(0.36, 0.42, 0.36, x, 2.75, z, M.lamp);
    const cap = MeshBuilder.CreateCylinder("lampCap", { diameterTop: 0, diameterBottom: 0.56, height: 0.26, tessellation: 4 }, this.scene);
    cap.position.set(x, 3.08, z); cap.rotation.y = Math.PI / 4; this.put(cap, M.iron);
    this.circs.push({ x, z, r: 0.12 });
  }

  /** a candy cane: a white crook with red stripes */
  private cane(x: number, z: number, M: Record<string, Material>) {
    for (let k = 0; k < 6; k++) this.box(0.16, 0.25, 0.16, x, 0.13 + k * 0.25, z, k % 2 ? M.red : M.white);
    const hook = MeshBuilder.CreateTorus("caneHook", { diameter: 0.4, thickness: 0.15, tessellation: 16 }, this.scene);
    hook.rotation.set(Math.PI / 2, 0, 0); hook.position.set(x + 0.2 * Math.sign(x), 1.55, z);
    this.put(hook, M.red);
  }

  /** a little house (w x d, door in the middle of its front, facing yaw: local -z is the front), walk-in */
  private house(x: number, z: number, yaw: number, wall: string, M: Record<string, Material>, w = 7.5, d = 6.5, h = 3.4) {
    const node = new TransformNode("house", this.scene); node.position.set(x, 0, z); node.rotation.y = yaw;
    const W = solid(this.scene, wall, 0.85), T = 0.25, door = 1.6, dh = 2.4;
    const B = (bw: number, bh: number, bd: number, bx: number, by: number, bz: number, m: Material) => this.box(bw, bh, bd, bx, by, bz, m, 0, node);
    // the walls: back, sides, the front either side of the door and above it
    B(w, h, T, 0, h / 2, d / 2, W);
    for (const sx of [-1, 1]) B(T, h, d, sx * w / 2, h / 2, 0, W);
    const side = (w - door) / 2;
    for (const sx of [-1, 1]) B(side, h, T, sx * (door / 2 + side / 2), h / 2, -d / 2, W);
    B(door, h - dh, T, 0, dh + (h - dh) / 2, -d / 2, W);
    // trim on the corners and round the door, a wreath on the wall above it
    for (const [cx, cz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]]) B(0.32, h, 0.32, cx, h / 2, cz, M.trim);
    for (const sx of [-1, 1]) B(0.16, dh, 0.34, sx * (door / 2 + 0.08), dh / 2, -d / 2, M.trim);
    B(door + 0.32, 0.16, 0.34, 0, dh + 0.08, -d / 2, M.trim);
    const wr = MeshBuilder.CreateTorus("wreath", { diameter: 0.6, thickness: 0.16, tessellation: 16 }, this.scene);
    wr.parent = node; wr.rotation.x = Math.PI / 2; wr.position.set(0, dh + 0.55, -d / 2 - 0.2); this.put(wr, M.green);
    B(0.18, 0.18, 0.06, 0, dh + 0.3, -d / 2 - 0.24, M.red);
    // windows: lit panes on the front and the sides (outside and in), with a white cross
    const win = (wx: number, wz: number, rot: number) => {
      for (const io of [-1, 1]) {
        const p = MeshBuilder.CreatePlane("win", { width: 1.0, height: 1.0, sideOrientation: Mesh.DOUBLESIDE }, this.scene);
        p.parent = node; p.rotation.y = rot; p.position.set(wx + Math.sin(rot) * io * (T / 2 + 0.01), 1.75, wz + Math.cos(rot) * io * (T / 2 + 0.01));
        this.put(p, M.window);
      }
      for (const [bw, bh] of [[1.1, 0.1], [0.1, 1.1]]) {
        const c = MeshBuilder.CreateBox("winX", { width: bw, height: bh, depth: T + 0.06 }, this.scene);
        c.parent = node; c.rotation.y = rot; c.position.set(wx, 1.75, wz); this.put(c, M.trim);
      }
    };
    for (const sx of [-1, 1]) win(sx * (door / 2 + side / 2), -d / 2, 0);
    for (const sx of [-1, 1]) win(sx * w / 2, 0, Math.PI / 2);
    // the roof: a pitched roof (two slabs) with snow on it, gable ends, a chimney
    const rise = 2.4, half = w / 2 + 0.5, slope = Math.hypot(half, rise), ang = Math.atan2(rise, half);
    for (const sx of [-1, 1]) {
      const r = MeshBuilder.CreateBox("roof", { width: slope, height: 0.22, depth: d + 1.0 }, this.scene);
      r.parent = node; r.position.set(sx * half / 2, h + rise / 2, 0); r.rotation.z = sx * -ang; this.put(r, M.roof);
      const s = MeshBuilder.CreateBox("roofSnow", { width: slope - 0.2, height: 0.16, depth: d + 0.8 }, this.scene);
      s.parent = node; s.position.set(sx * half / 2 + sx * Math.sin(ang) * 0.17, h + rise / 2 + Math.cos(ang) * 0.17, 0); s.rotation.z = sx * -ang; this.put(s, M.roofSnow);
    }
    for (const sz of [-1, 1]) for (const f of [-1, 1]) this.gable(node, w / 2, h, rise - 0.1, sz * d / 2 + f * T / 2, W);
    B(0.7, 2.2, 0.7, w * 0.25, h + rise * 0.7, d * 0.2, M.stone);
    // inside: a wooden floor, a hearth with a fire at the back, a rug, a table
    B(w - 0.3, 0.06, d - 0.3, 0, 0.03, 0, M.floor);
    B(1.8, 1.3, 0.6, 0, 0.65, d / 2 - 0.45, M.stone);
    B(1.0, 0.6, 0.2, 0, 0.45, d / 2 - 0.76, M.fire);
    B(2.4, 0.03, 1.6, 0, 0.08, 0, M.rug);
    B(1.1, 0.06, 0.8, -w / 2 + 1.1, 0.78, 0.6, M.wood);
    for (const [lx, lz] of [[-0.45, -0.3], [0.45, -0.3], [-0.45, 0.3], [0.45, 0.3]]) B(0.08, 0.76, 0.08, -w / 2 + 1.1 + lx, 0.38, 0.6 + lz, M.wood);
    // what you bump into: the walls (the door is open), the hearth, the table
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const solidAt = (lx: number, lz: number, hx: number, hz: number) => this.solidBox(x + lx * c + lz * s, z - lx * s + lz * c, hx, hz, yaw);
    solidAt(0, d / 2, w / 2, T / 2);
    for (const sx of [-1, 1]) solidAt(sx * w / 2, 0, T / 2, d / 2);
    for (const sx of [-1, 1]) solidAt(sx * (door / 2 + side / 2), -d / 2, side / 2, T / 2);
    solidAt(0, d / 2 - 0.45, 0.9, 0.3);
    solidAt(-w / 2 + 1.1, 0.6, 0.55, 0.4);
  }

  /** Santa's house: the biggest of them all, red with white trim, two storeys of windows, candy-cane pillars at the door;
   *  inside, a great hearth, his armchair, milk and cookies, sacks of presents and a tree of his own */
  private santa(x: number, z: number, M: Record<string, Material>) {
    const node = new TransformNode("santa", this.scene); node.position.set(x, 0, z);
    const w = 22, d = 15, h = 8, T = 0.4, door = 3.2, dh = 4.2, W = solid(this.scene, "#b3261e", 0.85);
    const B = (bw: number, bh: number, bd: number, bx: number, by: number, bz: number, m: Material) => this.box(bw, bh, bd, bx, by, bz, m, 0, node);
    // (its front faces +z: down the main path)
    B(w, h, T, 0, h / 2, -d / 2, W);
    for (const sx of [-1, 1]) B(T, h, d, sx * w / 2, h / 2, 0, W);
    const side = (w - door) / 2;
    for (const sx of [-1, 1]) B(side, h, T, sx * (door / 2 + side / 2), h / 2, d / 2, W);
    B(door, h - dh, T, 0, dh + (h - dh) / 2, d / 2, W);
    for (const [cx, cz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]]) B(0.6, h + 0.2, 0.6, cx, h / 2, cz, M.trim);
    B(w + 0.4, 0.35, 0.6, 0, h / 2, d / 2, M.trim);   // (the band between the floors)
    B(door + 0.6, 0.4, 0.6, 0, dh + 0.2, d / 2, M.gold);
    // the windows, two rows across the front and down the sides
    const win = (wx: number, wy: number, wz: number, rot: number) => {
      const p = MeshBuilder.CreatePlane("win", { width: 1.4, height: 1.8, sideOrientation: Mesh.DOUBLESIDE }, this.scene);
      p.parent = node; p.rotation.y = rot; p.position.set(wx, wy, wz); this.put(p, M.window);
      const f = MeshBuilder.CreateBox("winF", { width: 1.7, height: 0.16, depth: 0.3 }, this.scene);
      f.parent = node; f.rotation.y = rot; f.position.set(wx, wy - 1.0, wz); this.put(f, M.trim);
    };
    for (const wx of [-8, -4.5, 4.5, 8]) for (const wy of [2.2, 6.0]) win(wx, wy, d / 2 + T / 2 + 0.02, 0);
    for (const wx of [-2, 2]) win(wx, 6.0, d / 2 + T / 2 + 0.02, 0);
    for (const sx of [-1, 1]) for (const wz of [-4, 0, 4]) for (const wy of [2.2, 6.0]) win(sx * (w / 2 + T / 2 + 0.02), wy, wz, Math.PI / 2);
    // candy-cane pillars and a little porch roof over the door
    for (const sx of [-1, 1]) {
      for (let k = 0; k < 9; k++) {
        const c = MeshBuilder.CreateCylinder("pillar", { diameter: 0.5, height: 0.5, tessellation: 12 }, this.scene);
        c.parent = node; c.position.set(sx * 2.6, 0.25 + k * 0.5, d / 2 + 2.6); this.put(c, k % 2 ? M.red : M.white);
      }
    }
    B(6.4, 0.3, 3.2, 0, 4.6, d / 2 + 1.5, M.roof);
    B(6.2, 0.2, 3.0, 0, 4.82, d / 2 + 1.5, M.roofSnow);
    // the roof: steep, snow-covered, a big chimney and a lit window in the gable
    const rise = 5.5, half = w / 2 + 0.8, slope = Math.hypot(half, rise), ang = Math.atan2(rise, half);
    for (const sx of [-1, 1]) {
      const r = MeshBuilder.CreateBox("roof", { width: slope, height: 0.35, depth: d + 1.6 }, this.scene);
      r.parent = node; r.position.set(sx * half / 2, h + rise / 2, 0); r.rotation.z = sx * -ang; this.put(r, M.roof);
      const s = MeshBuilder.CreateBox("roofSnow", { width: slope - 0.3, height: 0.25, depth: d + 1.3 }, this.scene);
      s.parent = node; s.position.set(sx * half / 2 + sx * Math.sin(ang) * 0.28, h + rise / 2 + Math.cos(ang) * 0.28, 0); s.rotation.z = sx * -ang; this.put(s, M.roofSnow);
    }
    for (const sz of [-1, 1]) for (const f of [-1, 1]) this.gable(node, w / 2, h, rise - 0.1, sz * d / 2 + f * T / 2, W);
    win(0, h + 1.6, d / 2 + T / 2 + 0.02, 0);
    B(1.6, 4, 1.6, -w * 0.28, h + rise * 0.75, -2, M.stone);
    // a sign over the door: a gold plate
    B(4.2, 0.9, 0.12, 0, dh + 1.1, d / 2 + 0.26, M.gold);
    // inside: floor, a great hearth on the back wall, a rug, the armchair, a table with milk and cookies, sacks, a tree
    B(w - 0.6, 0.08, d - 0.6, 0, 0.04, 0, M.floor);
    B(5, 3.4, 1.2, 0, 1.7, -d / 2 + 0.8, M.stone);
    B(3.0, 1.6, 0.3, 0, 1.0, -d / 2 + 1.45, M.fire);
    B(6, 0.03, 4, 0, 0.1, -2, M.rug);
    B(1.6, 0.5, 1.4, 3.2, 0.45, -2.6, M.red);         // the armchair: seat, back, arms
    B(1.6, 1.6, 0.35, 3.2, 1.0, -3.3, M.red);
    for (const sx of [-1, 1]) B(0.3, 0.9, 1.4, 3.2 + sx * 0.8, 0.65, -2.6, M.red);
    B(1.0, 0.08, 1.0, 1.5, 0.75, -1.4, M.wood);
    B(0.12, 0.7, 0.12, 1.5, 0.37, -1.4, M.wood);
    const milk = MeshBuilder.CreateCylinder("milk", { diameter: 0.12, height: 0.18, tessellation: 10 }, this.scene);
    milk.parent = node; milk.position.set(1.35, 0.88, -1.35); this.put(milk, M.white);
    for (let k = 0; k < 3; k++) { const ck = MeshBuilder.CreateCylinder("cookie", { diameter: 0.14, height: 0.03, tessellation: 10 }, this.scene); ck.parent = node; ck.position.set(1.6 + k * 0.05, 0.8 + k * 0.03, -1.5); this.put(ck, M.floor); }
    for (const [sx, sz] of [[-7, -4], [-8.2, -2.6], [-6.4, -2.2]]) {
      const sack = MeshBuilder.CreateSphere("sack", { diameter: 1.4, segments: 8 }, this.scene);
      sack.parent = node; sack.scaling.set(1, 1.2, 1); sack.position.set(sx, 0.75, sz); this.put(sack, solid(this.scene, "#8a5a30", 0.95));
    }
    // (the tree inside and the presents round it go in world space: the tree helper places by x, z)
    this.tree(x + 7, z + 3, 5.5, M, false);
    // what you bump into
    this.solidBox(x, z - d / 2, w / 2, T / 2, 0);
    for (const sx of [-1, 1]) this.solidBox(x + sx * w / 2, z, T / 2, d / 2, 0);
    for (const sx of [-1, 1]) this.solidBox(x + sx * (door / 2 + side / 2), z + d / 2, side / 2, T / 2, 0);
    this.solidBox(x, z - d / 2 + 0.8, 2.5, 0.6, 0);
    this.solidBox(x + 3.2, z - 2.7, 0.9, 0.8, 0);
    for (const sx of [-1, 1]) this.circs.push({ x: x + sx * 2.6, z: z + d / 2 + 2.6, r: 0.3 });
    this.circs.push({ x: x + 7, z: z + 3, r: 1.1 }, { x: x - 7.2, z: z - 3, r: 1.4 });
  }
}

