// Drawing the ice wall, its gate and the signs (the layout is in arctic.ts: wallR, GATE, signsNear). Only near you: the
// wall is one ribbon of ice a few kilometres long either side of you, rebuilt as you go along it; the gate and the signs
// are built when you come within sight of them. Everything uses the icebergs' material (see arcticView.ts).
import { Color3, DynamicTexture, type Material, Mesh, MeshBuilder, type Scene, StandardMaterial, TransformNode, VertexData } from "@babylonjs/core";
import { glow, solid } from "../render/materials";
import { GATE, GATE_A, landHeight, LAND_R, type Sign, signsNear, wallR } from "./arctic";

/** the wall: how far either side of you it is drawn (m), its step along the way, how tall it stands over the land */
const WALL_SPAN = 3600, WALL_STEP = 9, WALL_H = 46;
const SIGN_R = 700;

const hashA = (k: number) => { const s = Math.sin(k * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

export class NorthGate {
  private wall: Mesh | null = null;
  private wallAt = { a: 1e9 };
  private gate: TransformNode | null = null;
  private signs: Mesh | null = null;
  private signsAt = { x: 1e9, z: 1e9 };
  private signTmp: Sign[] = [];
  private woodM: Material;
  private signM: StandardMaterial;

  private doorIce: Material;

  constructor(private readonly scene: Scene, private readonly ice: Material) {
    this.woodM = solid(scene, "#7a5230", 0.9);
    this.doorIce = solid(scene, "#2c64a8", 0.2);
    // the signs' board: "ICE GATE" and an arrow, painted on weathered planks (one texture for all of them)
    const W = 512, H = 160, t = new DynamicTexture("gateSignTex", { width: W, height: H }, scene, true), c = t.getContext() as CanvasRenderingContext2D;
    c.fillStyle = "#a8743f"; c.fillRect(0, 0, W, H);
    c.strokeStyle = "rgba(60,35,15,.45)"; c.lineWidth = 3;
    for (const y of [52, 106]) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
    c.fillStyle = "#f6f3ea"; c.font = "bold 74px system-ui, sans-serif"; c.textBaseline = "middle"; c.fillText("ICE GATE", 26, H / 2 + 4);
    c.beginPath(); c.moveTo(398, 52); c.lineTo(462, 52); c.lineTo(462, 28); c.lineTo(500, 80); c.lineTo(462, 132); c.lineTo(462, 108); c.lineTo(398, 108); c.closePath(); c.fill();
    t.update();
    this.signM = new StandardMaterial("gateSign", scene);
    this.signM.diffuseTexture = t; this.signM.specularColor = Color3.Black(); this.signM.backFaceCulling = true;
  }

  /** `cam`: where you are; `away`: in a level, a cave... (then nothing of it is kept) */
  update(cam: { x: number; z: number }, away: boolean) {
    const r = Math.hypot(cam.x, cam.z);
    if (away || r < LAND_R - 1500) { this.clear(); return; }
    const a = Math.atan2(cam.z, cam.x);
    let da = a - this.wallAt.a; da = Math.atan2(Math.sin(da), Math.cos(da));
    if (!this.wall || Math.abs(da) * r > 500) this.buildWall(a);
    // the gate, within sight
    const gd = Math.hypot(cam.x - GATE.x, cam.z - GATE.z);
    if (gd < 5000 && !this.gate) this.buildGate();
    else if (gd > 5600 && this.gate) { this.gate.dispose(); this.gate = null; }
    // the signs near you
    if (Math.hypot(cam.x - this.signsAt.x, cam.z - this.signsAt.z) > 150) this.buildSigns(cam.x, cam.z);
  }

  private clear() {
    this.wall?.dispose(); this.wall = null; this.wallAt.a = 1e9;
    this.gate?.dispose(); this.gate = null;
    this.signs?.dispose(); this.signs = null; this.signsAt.x = 1e9;
  }

  /** the wall: a jagged cliff of ice along wallR, its foot sunk into the land, a broken top, a little thickness */
  private buildWall(a0: number) {
    this.wall?.dispose();
    this.wallAt.a = a0;
    const R0 = wallR(a0), span = WALL_SPAN / R0, n = Math.ceil((2 * span * R0) / WALL_STEP);
    const pos: number[] = [], idx: number[] = [];
    for (let i = 0; i <= n; i++) {
      const k = Math.round((a0 - span) * R0 / WALL_STEP) + i, a = (k * WALL_STEP) / R0;
      const R = wallR(a), c = Math.cos(a), s = Math.sin(a);
      // (the face juts in and out a little, never past the line you are kept behind)
      const jag = 0.3 + 1.2 * hashA(k), Ri = R + jag, Ro = R + 9;
      const g = landHeight(c * (R - 4), s * (R - 4));
      const base = Number.isFinite(g) ? g : 0;
      const top = base + WALL_H * (0.82 + 0.3 * hashA(k * 3.1 + 7)) + 6 * Math.sin(k * 0.21);
      pos.push(c * Ri, base - 8, s * Ri, c * (Ri + 0.4), top - 2.5, s * (Ri + 0.4), c * (Ri + 2.2), top, s * (Ri + 2.2), c * Ro, top - 1.5, s * Ro);
      if (i < n) {
        const b = i * 4, d = b + 4;
        for (let q = 0; q < 3; q++) idx.push(b + q, b + q + 1, d + q, b + q + 1, d + q + 1, d + q);
      }
    }
    const m = new Mesh("iceWall", this.scene);
    const vd = new VertexData(); vd.positions = pos; vd.indices = idx;
    const nor: number[] = []; VertexData.ComputeNormals(pos, idx, nor); vd.normals = nor;
    vd.applyToMesh(m);
    m.convertToFlatShadedMesh();
    m.material = this.ice; m.isPickable = false; m.receiveShadows = true;
    this.wall = m;
  }

  /** the gate: two great pillars of deep blue ice and a round arch of carved blocks standing out of the wall, two tall
   *  doors of pale ice between them banded in blue, and a glowing snowflake where they meet */
  private buildGate() {
    const root = new TransformNode("iceGate", this.scene);
    const gy = landHeight(GATE.x, GATE.z);
    // (local +z runs into the wall, the doors face -z: the way you come)
    root.position.set(GATE.x, Number.isFinite(gy) ? gy : 0, GATE.z);
    root.rotation.y = GATE.yaw;
    const part = (m: Mesh, mat: Material, x: number, y: number, z: number, parent: TransformNode = root) => { m.material = mat; m.parent = parent; m.position.set(x, y, z); m.isPickable = false; m.receiveShadows = true; return m; };
    const D = 3, PH = 24, AR = 11.5, frame = this.doorIce;
    const pale = solid(this.scene, "#d8eef8", 0.3);
    for (const sx of [-1, 1]) {
      part(MeshBuilder.CreateBox("gatePillar", { width: 4.6, height: PH, depth: 6 }, this.scene), frame, sx * AR, PH / 2, D);
      part(MeshBuilder.CreateBox("gatePlinth", { width: 6.4, height: 2.4, depth: 7.6 }, this.scene), this.ice, sx * AR, 1.2, D - 0.4);
      part(MeshBuilder.CreateBox("gateCap", { width: 6.0, height: 1.6, depth: 7.2 }, this.scene), this.ice, sx * AR, PH, D - 0.3);
    }
    // the arch: carved blocks round a half circle, a keystone at the top
    const N = 11;
    for (let k = 0; k < N; k++) {
      const a = Math.PI * (k + 0.5) / N, x = Math.cos(a) * AR, y = PH + Math.sin(a) * AR;
      const b = part(MeshBuilder.CreateBox("gateVoussoir", { width: 3.1, height: k === (N - 1) / 2 ? 5.6 : 4.6, depth: 6 }, this.scene), k === (N - 1) / 2 ? this.ice : frame, x, y, D);
      b.rotation.z = a - Math.PI / 2;
    }
    // the doors: two tall leaves of pale ice, rounded at the top to fill the arch, banded in deep blue
    const inner = AR - 2.3;
    for (const sx of [-1, 1]) {
      const leaf = new TransformNode("gateLeaf", this.scene); leaf.parent = root; leaf.position.set(sx * inner / 2, 0, D + 1.6);
      part(MeshBuilder.CreateBox("gateDoor", { width: inner, height: PH, depth: 1.2 }, this.scene), pale, 0, PH / 2, 0, leaf);
      const top = part(MeshBuilder.CreateCylinder("gateDoorTop", { diameter: inner * 2, height: 1.2, tessellation: 32, arc: 0.25 }, this.scene), pale, -sx * inner / 2, PH, 0, leaf);
      top.rotation.set(-Math.PI / 2, 0, sx > 0 ? Math.PI / 2 : 0);
      for (const y of [3, 9, 15, 21]) part(MeshBuilder.CreateBox("gateBand", { width: inner, height: 0.6, depth: 0.4 }, this.scene), frame, 0, y, -0.7, leaf);
      part(MeshBuilder.CreateBox("gateStile", { width: 0.6, height: PH, depth: 0.4 }, this.scene), frame, sx * (inner / 2 - 0.3), PH / 2, -0.7, leaf);
      // a big ring handle on each leaf
      const ring = part(MeshBuilder.CreateTorus("gateRing", { diameter: 1.4, thickness: 0.22, tessellation: 20 }, this.scene), frame, -sx * (inner / 2 - 1.4), 11, -0.85, leaf);
      ring.rotation.x = Math.PI / 2;
    }
    // the snowflake where the doors meet: six glowing spokes with twigs
    const flake = new TransformNode("gateFlake", this.scene); flake.parent = root; flake.position.set(0, 17, D + 0.85);
    const gm = glow(this.scene, "#38c8ff");
    for (let k = 0; k < 6; k++) {
      const sp = MeshBuilder.CreateBox("gateFlakeSpoke", { width: 0.45, height: 6.4, depth: 0.2 }, this.scene);
      sp.material = gm; sp.parent = flake; sp.rotation.z = (k * Math.PI) / 3; sp.isPickable = false;
      for (const t of [-1.8, 1.8]) for (const tw of [0.7, -0.7]) {
        const m = MeshBuilder.CreateBox("gateFlakeTwig", { width: 0.3, height: 1.5, depth: 0.2 }, this.scene);
        m.material = gm; m.parent = sp; m.position.y = t; m.rotation.z = tw; m.isPickable = false;
      }
    }
    // a path of trodden snow up to the doors
    const path = MeshBuilder.CreateGround("gatePath", { width: 8, height: 60 }, this.scene);
    path.material = solid(this.scene, "#c9d6e2", 0.95); path.parent = root; path.position.set(0, 0.06, -28); path.isPickable = false; path.receiveShadows = true;
    this.gate = root;
  }

  /** the signs near you: a post, a board each side (so the arrow reads the right way from both sides) */
  private buildSigns(x: number, z: number) {
    this.signs?.dispose(); this.signs = null;
    this.signsAt.x = x; this.signsAt.z = z;
    const list = signsNear(x, z, SIGN_R, this.signTmp);
    if (!list.length) return;
    const parts: Mesh[] = [], boards: Mesh[] = [];
    for (const s of list) {
      const g = landHeight(s.x, s.z), y = Number.isFinite(g) ? g : 0;
      const post = MeshBuilder.CreateCylinder("signPost", { diameter: 0.16, height: 2.9, tessellation: 6 }, this.scene);
      post.position.set(s.x, y + 1.3, s.z);
      parts.push(post);
      // the board: its local +z along the arrow (towards the gate), read from either side
      for (const side of [1, -1]) {
        const b = MeshBuilder.CreatePlane("signBoard", { width: 2.2, height: 0.69, sideOrientation: Mesh.FRONTSIDE }, this.scene);
        b.position.set(s.x + Math.cos(s.yaw) * 0.04 * side, y + 2.4, s.z - Math.sin(s.yaw) * 0.04 * side);
        b.rotation.y = s.yaw + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
        b.bakeCurrentTransformIntoVertices();
        boards.push(b);
      }
      const back = MeshBuilder.CreateBox("signBack", { width: 0.06, height: 0.75, depth: 2.26 }, this.scene);
      back.position.set(s.x, y + 2.4, s.z); back.rotation.y = s.yaw;
      parts.push(back);
    }
    const wood = Mesh.MergeMeshes(parts, true, true);
    const brd = Mesh.MergeMeshes(boards, true, true);
    if (wood) { wood.material = this.woodM; wood.isPickable = false; wood.receiveShadows = true; }
    if (brd) { brd.material = this.signM; brd.isPickable = false; brd.receiveShadows = true; }
    const holder = new Mesh("gateSigns", this.scene);
    for (const m of [wood, brd]) if (m) m.parent = holder;
    this.signs = holder;
  }
}

/** how far (m) the gate's trigger is from (x, z): walking right up to the doors takes you through */
export const gateDist = (x: number, z: number) => Math.hypot(x - GATE.x, z - GATE.z);
export { GATE, GATE_A };
