// The cat house: a model of a real living room (reached through a door in the secret room) where everybody is a cat.
// Everything is at cat scale: a sofa is a hill, the dining table is a roof. There is a scratching tree and wall shelves to climb,
// a ball pit to dive into, an exercise ball to shove around, and a mouse that runs from you and is yours to pounce on.
// Like the caves it is a "cave-style" ground for the player: floor(x, z, y) + resolve(...), but with real heights (things you can jump on).
// Babylon port: Castaway's code, drawn by render/mirror.ts.
import * as THREE from 'three';
import { Mesher } from '../net/playerModel';
import { mulberry32 } from '../core/noise';

export const CX = 6000, CZ = 0, CY = 12;
const X0 = -5.4, X1 = 4.2, Z0 = -2.1, Z1 = 2.8, H = 2.8;
const MOUSE_Z = Z1 - 0.15;
const BX = 5.5, BZ0 = -1.9, BZ1 = 1.5;                 // balcony
const DOOR = { x: -3.0, z: Z0 };
// the real kitchen, west of the living room: through a doorway in the west wall, or through the hole above the climbing shelves
const KX0 = -10.0, KZ0 = -0.4, KZ1 = 3.2;                         // the kitchen door: the way back

interface Box { x0: number; x1: number; z0: number; z1: number; y0: number; y1: number; soft?: boolean; perch?: boolean }

const COL = {
  wall: '#fff3da', skirt: '#fff1d8', ceil: '#ffffff', wood: '#bf8b52', woodLine: '#a8763f', frame: '#6d4526', frameD: '#4d2f18',
  sofa: '#3d6b82', sofaL: '#4a7c95', sofaD: '#2f566a', rug: '#b99690', rugL: '#c7a8a1', walnut: '#6b3f26', white: '#f4f2ee', black: '#17171a',
  oak: '#7a5233', chair: '#8a5a34', chairBack: '#704526', shelf: '#b88652', slat: '#9a6a3e', cream: '#e9dcc0', green: '#4c7d3d', greenD: '#37622e', pot: '#c8bfae',
  steel: '#b9bec4', iron: '#1c1c20', brick: '#a5523a', render: '#e6e1d6', roof: '#3d3f46', grass: '#6f8a55', pave: '#8a8a8c',
};
const K = 1.45;
const tone = (hex: string, k = K) => '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();

export class CatHome {
  readonly group = new THREE.Group();
  active = false;
  private boxes: Box[] = [];
  private climbs: { x0: number; x1: number; z0: number; z1: number; y0: number; top: number }[] = [];
  private mesh: Mesher;
  /** somebody is clinging to a post: the perches they climb through are ghosts for the moment */
  ghost = false;
  /** the kitchen door, centre in world coordinates */
  readonly doorAt = new THREE.Vector3(CX + DOOR.x, CY + 1.0, CZ + DOOR.z);

  // ---------------------------------------------------------------- toys
  readonly mouse = { x: -1.0, z: MOUSE_Z, yaw: -Math.PI / 2, speed: 0, hide: 0, t: 1, tx: 0, tz: 0, stuck: 0, phase: 0, localHide: 0, sx: -1, sz: MOUSE_Z, fresh: false, y: 0, vx: 0, vy: 0, vz: 0, mode: 0, rt: 0, ry: 0, spin: 0, bonk: 0 };
  readonly ball = { x: 2.15, z: 1.55, vx: 0, vz: 0, spin: new THREE.Quaternion() };
  private mouseG = new THREE.Group();
  private mouseTail!: THREE.Object3D;
  private ballG = new THREE.Group();
  private ballM!: THREE.Object3D;
  caught = 0;
  /** somebody (this player) pounced the mouse */
  onCatch: (() => void) | null = null;
  onSqueak: (() => void) | null = null;
  /** mouse held / thrown by this player (mode 1 = in the paw, 2 = flying); 3 = somebody else has it */
  onBonk: ((id: number | null) => void) | null = null;
  get mouseMine() { return this.mouse.mode === 1 || this.mouse.mode === 2; }
  /** the mouse is within reach of a paw at world position (x, y, z)? */
  canGrab(x: number, y: number, z: number, reach = 0.5) {
    const m = this.mouse;
    if (m.mode === 1 || m.hide > 0 || m.localHide > 0) return false;
    return Math.hypot(CX + m.x - x, CY + m.y + 0.03 - y, CZ + m.z - z) < reach;
  }
  grabMouse() {
    const m = this.mouse; m.mode = 1; m.vx = m.vy = m.vz = 0; m.speed = 0; this.onSqueak?.();
  }
  /** move the held mouse to a paw (world coordinates) */
  holdMouse(x: number, y: number, z: number) {
    const m = this.mouse; if (m.mode !== 1) return;
    m.x = x - CX; m.y = y - CY - 0.02; m.z = z - CZ;
  }
  /** let go with this world velocity */
  throwMouse(vx: number, vy: number, vz: number) {
    const m = this.mouse; if (m.mode !== 1) return;
    const sp = Math.hypot(vx, vy, vz), k = sp > 9 ? 9 / sp : 1;
    m.mode = 2; m.vx = vx * k; m.vy = vy * k; m.vz = vz * k; m.bonk = 0;
    if (Math.hypot(vx, vy, vz) > 1.2) m.yaw = Math.atan2(vx, vz);
  }
  /** somebody else is holding / flinging the mouse: [x, y, z, yaw, mode] in room coordinates */
  importThrow(a: number[]) {
    const m = this.mouse;
    if (m.mode === 1 || m.mode === 2) return;
    if (a[4] === 0) { m.mode = 0; m.x = a[0]; m.z = a[2]; m.y = 0; m.hide = 0; m.localHide = 0; m.t = 0.5; return; }
    m.mode = 3; m.rt = 0.8; m.sx = a[0]; m.ry = a[1]; m.sz = a[2]; m.yaw = a[3];
  }
  exportThrow() {
    const m = this.mouse, r = (v: number) => Math.round(v * 100) / 100;
    return [r(m.x), r(m.y), r(m.z), r(m.yaw), m.mode === 0 ? 0 : 1];
  }
  private lastPos = new Map<number, { x: number; z: number }>();

  constructor(scene: THREE.Scene, private shadows: boolean, private camera: THREE.PerspectiveCamera) {
    this.mesh = new Mesher();
    this.build();
    const m = this.mesh.build(shadows);
    this.group.add(m);
    this.buildToys();
    this.group.position.set(CX, CY, CZ);
    this.group.visible = false;
    scene.add(this.group);
  }

  // ------------------------------------------------------------ geometry
  /** visual only */
  /** offsets for a block of furniture that was laid out against a wall (the room grew, the furniture keeps its wall) */
  private ox = 0; private oz = 0;
  private vb(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: string, k = K) {
    x0 += this.ox; x1 += this.ox; z0 += this.oz; z1 += this.oz;
    this.mesh.box(x1 - x0, y1 - y0, z1 - z0, tone(color, k), (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  }
  /** visual + solid (blocks you below its top, a surface to stand on at its top) */
  private sb(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: string, soft = false, perch = false) {
    this.vb(x0, x1, y0, y1, z0, z1, color);
    this.boxes.push({ x0: x0 + this.ox, x1: x1 + this.ox, y0, y1, z0: z0 + this.oz, z1: z1 + this.oz, soft, perch });
  }
  /** a perch: drawn as a top slab and a darker underside, but solid from the underside up so a cat's head never goes into it */
  private perch(x0: number, x1: number, yTop0: number, yTop1: number, z0: number, z1: number, top: string, under: string, ySolid0: number) {
    this.vb(x0, x1, yTop0, yTop1, z0, z1, top);
    this.vb(x0, x1, ySolid0, yTop0, z0, z1, under);
    this.boxes.push({ x0: x0 + this.ox, x1: x1 + this.ox, y0: ySolid0, y1: yTop1, z0: z0 + this.oz, z1: z1 + this.oz, perch: true });
  }
  /** collision only (glass, invisible walls) */
  private ib(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) { this.boxes.push({ x0: x0 + this.ox, x1: x1 + this.ox, y0, y1, z0: z0 + this.oz, z1: z1 + this.oz }); }

  private build() {
    const M = this.mesh, vb = this.vb.bind(this), sb = this.sb.bind(this), ib = this.ib.bind(this);
    const rnd = mulberry32(2024);
    // ---- floor, ceiling, walls
    sb(X0 - 0.2, X1, -0.1, 0, Z0 - 0.2, Z1 + 0.2, COL.wood);
    for (let z = Z0 + 0.19; z < Z1; z += 0.19) vb(X0, X1, 0, 0.004, z - 0.003, z + 0.003, COL.woodLine);
    for (let z = Z0; z < Z1; z += 0.19) for (let x = X0 + rnd() * 1.1; x < X1; x += 0.9 + rnd() * 0.8) vb(x - 0.003, x + 0.003, 0, 0.004, z, z + 0.19, COL.woodLine);
    vb(X0 - 0.2, X1 + 0.2, H, H + 0.1, Z0 - 0.2, Z1 + 0.2, COL.ceil);
    // west wall (plain, with a socket), north wall (kitchen door), south wall (window), east wall (balcony doors)
    sb(X0 - 0.15, X0, 0, H, Z0 - 0.15, 0.7, COL.wall);
    sb(X0 - 0.15, X0, 0, 1.98, 0.7, 1.15, COL.wall); sb(X0 - 0.15, X0, 2.5, H, 0.7, 1.15, COL.wall);          // the hole above the top shelf
    sb(X0 - 0.15, X0, 0, H, 1.15, 1.8, COL.wall);
    sb(X0 - 0.15, X0, 2.1, H, 1.8, 2.6, COL.wall);                                                             // the kitchen doorway
    sb(X0 - 0.15, X0, 0, H, 2.6, 3.35, COL.wall);
    for (const z of [1.8, 2.56]) vb(X0 - 0.17, X0 + 0.04, 0, 2.1, z, z + 0.04, COL.frame); vb(X0 - 0.17, X0 + 0.04, 2.06, 2.1, 1.8, 2.6, COL.frame);
    vb(X0 - 0.17, X0 + 0.04, 1.98, 2.0, 0.66, 1.19, COL.frame); vb(X0 - 0.17, X0 + 0.04, 2.5, 2.54, 0.66, 1.19, COL.frame);
    for (const z of [0.66, 1.15]) vb(X0 - 0.17, X0 + 0.04, 1.98, 2.54, z, z + 0.04, COL.frame);
    sb(X0, -3.4, 0, H, Z0 - 0.15, Z0, COL.wall); sb(-2.6, X1 + 0.15, 0, H, Z0 - 0.15, Z0, COL.wall); vb(-3.4, -2.6, 2.05, H, Z0 - 0.15, Z0, COL.wall);
    sb(X0, -3.4, 0, H, Z1, Z1 + 0.15, COL.wall); sb(-2.4, X1 + 0.15, 0, H, Z1, Z1 + 0.15, COL.wall);
    vb(-3.4, -2.4, 0, 0.9, Z1, Z1 + 0.15, COL.wall); vb(-3.4, -2.4, 2.1, H, Z1, Z1 + 0.15, COL.wall);
    sb(X1, X1 + 0.15, 0, H, Z0 - 0.15, -1.7, COL.wall); sb(X1, X1 + 0.15, 0, H, 1.1, Z1 + 0.15, COL.wall); vb(X1, X1 + 0.15, 2.2, H, -1.7, 1.1, COL.wall);
    // skirting boards
    vb(X0, X1, 0, 0.1, Z0, Z0 + 0.015, COL.skirt); vb(X0, X1, 0, 0.1, Z1 - 0.015, Z1, COL.skirt); vb(X0, X0 + 0.015, 0, 0.1, Z0, Z1, COL.skirt);
    vb(X1 - 0.015, X1, 0, 0.1, Z0, -1.7, COL.skirt); vb(X1 - 0.015, X1, 0, 0.1, 1.1, Z1, COL.skirt);
    // cornice
    vb(X0, X1, H - 0.07, H, Z0, Z0 + 0.07, COL.skirt); vb(X0, X1, H - 0.07, H, Z1 - 0.07, Z1, COL.skirt);
    // socket and light switch
    vb(X0, X0 + 0.02, 0.28, 0.4, 0.55, 0.69, '#ffffff'); vb(-3.95, -3.9, 1.1, 1.2, Z0, Z0 + 0.02, '#ffffff');

    // ---- the kitchen door (frosted glass in a wooden frame): the way back
    for (const x of [-3.4, -2.64]) vb(x, x + 0.06, 0, 2.08, Z0 - 0.05, Z0 + 0.05, COL.frame);
    vb(-3.4, -2.58, 2.02, 2.1, Z0 - 0.05, Z0 + 0.05, COL.frame);
    vb(-3.34, -2.64, 0, 2.02, Z0, Z0 + 0.03, COL.frame);
    vb(-3.25, -2.75, 0.55, 1.85, Z0 + 0.03, Z0 + 0.045, '#d5e0dd');          // frosted glass
    vb(-2.82, -2.76, 0.95, 1.07, Z0 + 0.045, Z0 + 0.1, '#d7ad54');            // handle
    ib(-3.4, -2.6, 0, 2.1, Z0, Z0 + 0.1);

    // ---- the balcony doors: brown frames, cream blinds, one pane slid open
    for (const z of [-1.7, -0.55, 0.55, 1.1]) vb(X1 - 0.04, X1 + 0.06, 0, 2.2, z - 0.035, z + 0.035, COL.frame);
    vb(X1 - 0.04, X1 + 0.06, 2.12, 2.2, -1.7, 1.1, COL.frame); vb(X1 - 0.04, X1 + 0.06, 0, 0.06, -1.7, 1.1, COL.frame);
    vb(X1 - 0.12, X1 - 0.05, 1.7, 2.12, -1.7, 1.1, '#efe6cd');
    for (const y of [1.78, 1.9, 2.02]) vb(X1 - 0.13, X1 - 0.05, y, y + 0.018, -1.7, 1.1, '#cfc3a4');
    vb(X1 + 0.03, X1 + 0.05, 0.93, 1.07, -1.67, -0.58, '#dfe3e6'); vb(X1 + 0.03, X1 + 0.05, 0.93, 1.07, 0.58, 1.07, '#dfe3e6');   // etched band: this is glass
    ib(X1 - 0.05, X1 + 0.05, 0, 2.2, -1.7, -0.55); ib(X1 - 0.05, X1 + 0.05, 0, 2.2, 0.55, 1.1);
    // balcony: deck, iron railing with a scrolled top, nothing to fall off
    sb(X1, BX, -0.12, 0, BZ0 - 0.05, BZ1 + 0.05, '#8a7157');
    for (let x = X1 + 0.12; x < BX; x += 0.12) vb(x - 0.004, x + 0.004, 0, 0.004, BZ0, BZ1, '#6d5944');
    const rail = (x0: number, x1: number, z0: number, z1: number) => {
      vb(x0 - 0.02, x1 + 0.02, 1.0, 1.05, z0 - 0.02, z1 + 0.02, COL.iron, 1); vb(x0 - 0.012, x1 + 0.012, 0.08, 0.11, z0 - 0.012, z1 + 0.012, COL.iron, 1);
      const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / 0.12));
      for (let i = 0; i <= n; i++) { const t = i / n; vb(x0 + (x1 - x0) * t - 0.01, x0 + (x1 - x0) * t + 0.01, 0.11, 1.0, z0 + (z1 - z0) * t - 0.01, z0 + (z1 - z0) * t + 0.01, COL.iron, 1); }
      for (let i = 0; i < n; i++) { const t = (i + 0.5) / n; vb(x0 + (x1 - x0) * t - 0.03, x0 + (x1 - x0) * t + 0.03, 0.78, 0.96, z0 + (z1 - z0) * t - 0.006, z0 + (z1 - z0) * t + 0.006, COL.iron, 1); }
    };
    rail(BX, BX, BZ0, BZ1); rail(X1, BX, BZ0, BZ0); rail(X1, BX, BZ1, BZ1);
    ib(BX - 0.05, BX + 0.05, 0, 4, BZ0 - 0.1, BZ1 + 0.1); ib(X1, BX + 0.05, 0, 4, BZ0 - 0.1, BZ0 + 0.0); ib(X1, BX + 0.05, 0, 4, BZ1, BZ1 + 0.1);
    vb(X1, BX, 0, 0.5, BZ0 - 0.02, BZ0, '#c9c1b2');                     // a pot plant out there
    sb(5.0, 5.3, 0, 0.3, 1.0, 1.3, '#a7683f'); for (let i = 0; i < 6; i++) { const a = i * 1.05; vb(5.15 + Math.cos(a) * 0.07 - 0.03, 5.15 + Math.cos(a) * 0.07 + 0.03, 0.3, 0.62, 1.15 + Math.sin(a) * 0.07 - 0.03, 1.15 + Math.sin(a) * 0.07 + 0.03, COL.green); }

    // ---- outside: a terrace of houses across the way (backdrop only)
    vb(X1 - 3, 90, -3.5, -3.3, -70, 70, COL.grass); vb(X1 + 14, X1 + 16.5, -3.3, -3.28, -70, 70, '#6e6e72');
    const house = (x: number, z: number, w: number, d: number, h: number, wall: string, roof: string) => {
      vb(x, x + d, -3.3, -3.3 + h, z, z + w, wall); vb(x - 0.15, x + 0.05, -3.3 + 1.3, -3.3 + 2.1, z + 0.6, z + 1.6, '#3b4650');
      vb(x - 0.15, x + 0.05, -3.3 + 1.3, -3.3 + 2.1, z + w - 1.6, z + w - 0.6, '#3b4650'); vb(x - 0.15, x + 0.05, -3.3 + 0.1, -3.3 + 2.0, z + w / 2 - 0.5, z + w / 2 + 0.5, '#e8e8e8');
      for (const s of [-1, 1]) M.box(w + 0.6, 0.22, d * 0.62, tone(roof), x + d / 2 + s * d * 0.25, -3.3 + h + d * 0.2, z + w / 2, 0, 0, -s * 0.55);
    };
    house(X1 + 11, -9.5, 8, 7.5, 5.4, COL.brick, COL.roof);
    house(X1 + 11, 0.3, 8, 7.5, 5.4, COL.render, '#7b4638');
    house(X1 + 27, -22, 9, 8, 6.2, '#d9d3c4', COL.roof); house(X1 + 22, 11, 9, 8, 5.6, COL.brick, '#5a4a45');
    house(-14, 24, 10, 8, 5.4, COL.render, '#7b4638');
    for (let z = -9; z <= 9; z += 0.25) vb(X1 + 7, X1 + 7.12, -3.3, -3.3 + 1.25 + ((z * 7) % 2 > 1 ? 0.08 : 0), z, z + 0.18, '#4a3a2c');
    for (const [tx, tz] of [[X1 + 9, -3], [X1 + 6, 6], [X1 + 18, -12]]) { M.cyl(0.12, 0.16, 2.2, tone('#5b4330'), tx, -3.3 + 1.1, tz, 1, 1, 6); M.sph(1.5, tone('#58803f'), tx, -3.3 + 3.2, tz, 1, 1.1, 1, 8); }
    vb(-14, X0 - 3, -3.5, -3.3, -30, 40, COL.grass); vb(-14, X1, -3.5, -3.3, Z1, 40, COL.grass); vb(-3.4, -2.4, -3.3, -1.0, Z1 + 3, Z1 + 3.4, '#5e7a47');

    // ---- the window (south wall) with a sill: daffodils and a pot of roses
    for (const x of [-3.4, -2.4]) vb(x - 0.04, x + 0.04, 0.9, 2.1, Z1 - 0.05, Z1 + 0.04, COL.frame);
    vb(-3.4, -2.4, 0.9, 0.97, Z1 - 0.05, Z1 + 0.04, COL.frame); vb(-3.4, -2.4, 2.04, 2.1, Z1 - 0.05, Z1 + 0.04, COL.frame); vb(-2.93, -2.87, 0.9, 2.1, Z1 - 0.04, Z1 + 0.03, COL.frame);
    sb(-3.45, -2.35, 0.84, 0.9, Z1 - 0.22, Z1 + 0.05, COL.chairBack); ib(-3.4, -2.4, 0.9, 2.1, Z1 - 0.06, Z1 + 0.05);
    sb(-3.28, -3.1, 0.9, 1.0, Z1 - 0.2, Z1 - 0.1, COL.pot); for (const dx of [0, 0.04, 0.08]) { vb(-3.2 + dx, -3.19 + dx, 1.0, 1.25, Z1 - 0.16, Z1 - 0.15, COL.green); vb(-3.23 + dx, -3.16 + dx, 1.25, 1.31, Z1 - 0.18, Z1 - 0.12, '#f1d54b'); }
    vb(-2.8, -2.6, 0.9, 1.0, Z1 - 0.2, Z1 - 0.1, '#d6d1c4'); vb(-2.78, -2.62, 1.0, 1.15, Z1 - 0.19, Z1 - 0.11, '#d96a86');

    // ---- the sofa (north wall): teal, with legs, arms, a back and three cushions
    sb(0.5, 2.7, 0, 0.5, Z0 + 0.0, -1.18, COL.sofa); vb(0.78, 2.42, 0.5, 0.58, Z0 + 0.3, -1.2, COL.sofaL);
    sb(0.5, 2.7, 0.5, 0.88, Z0, -1.8, COL.sofa); sb(0.5, 0.78, 0.5, 0.66, -1.8, -1.18, COL.sofaL); sb(2.42, 2.7, 0.5, 0.66, -1.8, -1.18, COL.sofaL);
    for (let i = 0; i < 2; i++) { const x = 0.78 + i * 0.82; vb(x + 0.02, x + 0.8, 0.5, 0.62, -1.78, -1.22, COL.sofaL); }
    for (const [x, z] of [[0.55, -1.25], [2.62, -1.25], [0.55, -2.0], [2.62, -2.0]]) vb(x - 0.03, x + 0.03, -0.0, 0.0, z - 0.03, z + 0.03, COL.frameD);
    M.box(0.42, 0.42, 0.1, tone(COL.cream), 0.98, 0.78, -1.72, -0.28, 0.3, 0.1);                 // the black-and-white cushion
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) M.box(0.06, 0.06, 0.012, tone('#1d1d20'), 0.86 + i * 0.1, 0.65 + j * 0.1, -1.665 - i * 0.0, -0.28, 0.3, 0.1);
    M.box(0.42, 0.4, 0.12, tone('#8da8b4'), 1.62, 0.75, -1.73, -0.1, -0.2, 0);                     // a blue-grey cushion
    M.box(0.4, 0.42, 0.12, tone('#f3eadb'), 2.28, 0.74, -1.72, -0.1, -0.25, 0); M.box(0.26, 0.24, 0.02, tone('#b8a98b'), 2.28, 0.74, -1.655, -0.1, -0.25, 0);
    // radiator (tall, white, slatted)
    sb(3.1, 3.7, 0.12, 1.9, Z0, Z0 + 0.09, COL.white); for (let i = 0; i < 9; i++) vb(3.1 + 0.06 * i + 0.01, 3.1 + 0.06 * i + 0.04, 0.14, 1.88, Z0 + 0.09, Z0 + 0.11, '#e0dfdc');

    // ---- rug, coffee table (walnut, hairpin legs) and the things on it
    vb(0.0, 2.3, 0, 0.022, -0.45, 1.0, COL.rug); for (let i = 0; i < 18; i++) vb(0.1 + rnd() * 2.0, 0.17 + rnd() * 2.0, 0.022, 0.026, -0.4 + rnd() * 1.35, -0.38 + rnd() * 1.35, COL.rugL);
    sb(0.7, 1.7, 0.36, 0.43, -0.2, 0.46, COL.walnut); vb(0.76, 1.64, 0.32, 0.36, -0.14, 0.4, '#5a3320');
    for (const [x, z] of [[0.78, -0.12], [1.62, -0.12], [0.78, 0.38], [1.62, 0.38]]) sb(x - 0.012, x + 0.012, 0, 0.36, z - 0.012, z + 0.012, COL.iron);
    vb(0.86, 1.14, 0.43, 0.457, 0.0, 0.1, '#1f1f22'); vb(0.9, 1.0, 0.43, 0.445, 0.22, 0.36, '#2a2a30'); vb(1.3, 1.45, 0.43, 0.447, 0.1, 0.34, '#2c2c30');

    // ---- the TV unit (cube shelves) with books, and the telly on it
    this.oz = Z1 - 2.1;
    sb(3.8, 4.19, 0, 0.77, 1.2, 2.0, COL.shelf);
    for (const [y0, z0] of [[0.04, 1.23], [0.04, 1.62], [0.41, 1.23], [0.41, 1.62]]) vb(3.9, 4.18, y0, y0 + 0.32, z0, z0 + 0.34, '#8d6238', 0.92);
    for (let i = 0; i < 7; i++) vb(3.93, 4.16, 0.41 + i * 0.045, 0.41 + i * 0.045 + 0.04, 1.26, 1.52, ['#c0392b', '#2a3b52', '#e7c14a', '#274e3d', '#6b2f4f', '#d9d4c3', '#3f6b8a'][i]);
    for (let i = 0; i < 4; i++) vb(3.93, 4.16, 0.04 + i * 0.05, 0.04 + i * 0.05 + 0.045, 1.26, 1.52, ['#8b3a2f', '#d6c9a3', '#2f4a63', '#b6603a'][i]);
    sb(3.92, 4.1, 0.77, 0.82, 1.35, 1.85, COL.black); sb(4.0, 4.06, 0.82, 1.4, 1.05, 2.0, COL.black);
    vb(4.0, 4.0 + 0.005, 0.85, 1.37, 1.08, 1.97, '#dbe9f1', 1.5);                                   // the screen is on
    for (let i = 0; i < 4; i++) { vb(3.995, 4.0, 0.9, 1.25, 1.2 + i * 0.18, 1.3 + i * 0.18, ['#8e6f5c', '#4a3a36', '#c49a7a', '#2c2f3c'][i], 1.2); vb(3.995, 4.0, 1.25, 1.33, 1.21 + i * 0.18, 1.29 + i * 0.18, '#d8b894', 1.2); }
    vb(3.995, 4.0, 0.86, 0.9, 1.7, 1.78, '#d33', 1.2);
    sb(3.75, 3.95, 0, 0.18, 0.7, 0.9, COL.pot); for (let i = 0; i < 9; i++) { const a = i * 0.7; M.box(0.025, 0.7, 0.025, tone(i % 2 ? COL.green : COL.greenD), 3.85 + Math.cos(a) * 0.05, 0.5, 0.8 + this.oz + Math.sin(a) * 0.05, Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25); }
    this.oz = 0;
    // two hanging plants trailing down the wall
    for (const [x, z, y0] of [[4.15, 0.75, 1.9], [X1 - 0.05, Z1 - 0.12, 2.65]] as const) for (let i = 0; i < 8; i++) { const w = 0.3 + rnd() * 0.5; vb(x - 0.03 - rnd() * 0.12, x - 0.01, y0 - w, y0, z - 0.12 + i * 0.03, z - 0.1 + i * 0.03, i % 2 ? COL.green : COL.greenD); }

    // ---- the abstract painting on the south wall
    vb(1.95, 3.25, 0.95, 2.25, Z1 - 0.04, Z1, '#f4efe4'); vb(2.0, 3.2, 1.0, 2.2, Z1 - 0.05, Z1 - 0.04, '#d9552f');
    for (let i = 0; i < 16; i++) { const x = 2.0 + rnd() * 0.95, y = 1.0 + rnd() * 0.95, w = 0.1 + rnd() * 0.3, h = 0.1 + rnd() * 0.3; vb(x, Math.min(3.2, x + w), y, Math.min(2.2, y + h), Z1 - 0.058 - i * 0.001, Z1 - 0.05, ['#2f6f86', '#f0d9b5', '#1e2d4d', '#e0a53a', '#b6402b', '#8bb7c4', '#f4efe4'][i % 7]); }
    for (let k = 0; k < 3; k++) vb(0.2 + k * 0.22, 0.3 + k * 0.22, 1.7 - k * 0.5, 2.5 - k * 0.3, Z1 - 0.1, Z1 - 0.06, k % 2 ? COL.green : COL.greenD);

    // ---- rocking chair (bent wood, blue cushion, a star blanket) with a plush cow
    this.oz = 0.5;
    sb(2.6, 3.25, 0, 0.3, 0.95, 1.6, COL.slat); vb(2.62, 3.23, 0.3, 0.42, 0.98, 1.58, '#3c5b78'); sb(2.6, 3.25, 0.42, 0.95, 1.5, 1.6, '#3c5b78');
    for (const z of [0.95, 1.6]) vb(2.58, 3.27, 0.0, 0.05, z - 0.03, z + 0.03, COL.slat);
    M.box(0.64, 0.05, 0.62, tone('#c9a07a'), 2.92, 0.45, 1.5 + this.oz, 0.15, 0, 0.05);
    M.box(0.58, 0.02, 0.5, tone('#f3efe6'), 2.92, 0.46, 1.2 + this.oz, 0, 0.05, 0); for (let i = 0; i < 7; i++) vb(2.66 + (i % 4) * 0.14, 2.7 + (i % 4) * 0.14, 0.47, 0.472, 1.0 + (i % 3) * 0.17, 1.04 + (i % 3) * 0.17, '#2a2a30');
    M.sph(1, tone('#f6f4ef'), 2.7, 0.55, 1.1 + this.oz, 0.1, 0.08, 0.14, 8); M.sph(1, tone('#f6f4ef'), 2.7, 0.66, 1.0 + this.oz, 0.06, 0.06, 0.06, 8); M.box(0.12, 0.012, 0.02, tone('#f6f4ef'), 2.7, 0.72, 1.0 + this.oz);
    this.oz = 0;

    // ---- ball pit: grey fabric tub, full of white / blue / pink / grey balls
    const P = { x0: 0.1, x1: 1.4, z0: Z1 - 0.95, z1: Z1 - 0.05 };
    sb(P.x0, P.x1, 0, 0.4, P.z0, P.z0 + 0.06, '#8d8d94'); sb(P.x0, P.x1, 0, 0.4, P.z1 - 0.06, P.z1, '#8d8d94');
    sb(P.x0, P.x0 + 0.06, 0, 0.4, P.z0, P.z1, '#8d8d94'); sb(P.x1 - 0.06, P.x1, 0, 0.4, P.z0, P.z1, '#8d8d94');
    this.boxes.push({ x0: P.x0 + 0.06, x1: P.x1 - 0.06, z0: P.z0 + 0.06, z1: P.z1 - 0.06, y0: 0, y1: 0.17, soft: true });
    vb(P.x0 + 0.06, P.x1 - 0.06, 0, 0.012, P.z0 + 0.06, P.z1 - 0.06, '#6f6f76');
    for (let k = 0; k < 6; k++) vb(P.x0 + 0.1 + k * 0.2, P.x0 + 0.14 + k * 0.2, 0.22, 0.28, P.z0 - 0.004, P.z0, '#e9e9ee');
    const bc = ['#f3f3f5', '#f3f3f5', '#2d8fd0', '#2d8fd0', '#2aa6b3', '#e0508c', '#55575e'];
    for (let layer = 0; layer < 2; layer++) for (let x = P.x0 + 0.1; x < P.x1 - 0.08; x += 0.075) for (let z = P.z0 + 0.1; z < P.z1 - 0.08; z += 0.075)
      M.sph(0.037, tone(bc[Math.floor(rnd() * bc.length)], 1.05), x + (rnd() - 0.5) * 0.02 + layer * 0.035, 0.07 + layer * 0.06 + rnd() * 0.025, z + (rnd() - 0.5) * 0.02 + layer * 0.035, 1, 1, 1, 6);

    // ---- the dining end: oak table, four white chairs, flowers; a wooden recliner with a coat over it
    sb(-3.35, -1.85, 0.69, 0.75, -0.33, 0.53, COL.oak); for (const [x, z] of [[-3.3, -0.28], [-1.9, -0.28], [-3.3, 0.48], [-1.9, 0.48]]) sb(x - 0.04, x + 0.04, 0, 0.69, z - 0.04, z + 0.04, '#6a4529');
    vb(-3.3, -1.9, 0.3, 0.36, -0.03, 0.03, '#6a4529');
    sb(-2.75, -2.5, 0.75, 0.82, 0.05, 0.3, '#8d5a36'); for (let i = 0; i < 6; i++) { vb(-2.65 + i * 0.02 - 0.012, -2.65 + i * 0.02 + 0.012, 0.82, 1.0, 0.17 - 0.012, 0.17 + 0.012, COL.green); vb(-2.67 + i * 0.02, -2.63 + i * 0.02, 1.0, 1.05, 0.15, 0.2, i % 2 ? '#f08aa0' : '#f2dc57'); }
    vb(-2.2, -2.05, 0.75, 0.765, 0.3, 0.45, '#222');                                                  // sunglasses
    const chair = (cx: number, cz: number, s: number) => {
      sb(cx - 0.24, cx + 0.24, 0.4, 0.46, cz - 0.23, cz + 0.23, COL.chair); sb(cx - 0.24, cx + 0.24, 0.46, 0.92, cz - 0.23 * s - 0.03, cz - 0.23 * s + 0.03, COL.chairBack);
      for (const [dx, dz] of [[-0.2, -0.19], [0.2, -0.19], [-0.2, 0.19], [0.2, 0.19]]) sb(cx + dx - 0.015, cx + dx + 0.015, 0, 0.4, cz + dz - 0.015, cz + dz + 0.015, COL.oak);
    };
    chair(-3.0, -0.8, -1); chair(-2.2, -0.8, -1); chair(-3.0, 1.0, 1); chair(-2.2, 1.0, 1);
    this.ox = -1.2;
    sb(-4.05, -3.45, 0, 0.34, 0.95, 1.65, COL.slat); for (let i = 0; i < 6; i++) M.box(0.5, 0.05, 0.06, tone('#8d5f36'), -3.75 + this.ox, 0.45 + i * 0.1, 1.55 + i * 0.0 + 0.0, -0.5, 0, 0);
    sb(-4.05, -3.45, 0.34, 0.9, 1.58, 1.68, COL.slat);
    M.box(0.45, 0.04, 0.5, tone('#262a33'), -3.75 + this.ox, 0.36, 1.35, 0, 0, 0); M.box(0.5, 0.3, 0.1, tone('#16161a'), -3.4 + this.ox, 0.2, 1.1, 0, 0.2, 0.3);
    this.ox = 0;
    // pendant lamps (cream drum shades)
    for (const x of [-2.6, 0.9]) { M.cyl(0.005, 0.005, 0.5, tone('#222'), x, 2.55, 0.1, 1, 1, 4); M.cyl(0.17, 0.17, 0.22, tone('#d7cdb6', 1.2), x, 2.25, 0.1, 1, 1, 14); }

    // ---- the cat tree (sisal post, two perches and a top bed) and a second scratching post
    this.ox = -1.2;
    sb(-4.05, -3.45, 0, 0.07, -1.9, -1.3, '#8c7a63');
    sb(-3.82, -3.68, 0.07, 1.5, -1.67, -1.53, '#c9b07f');
    for (let y = 0.15; y < 1.5; y += 0.06) vb(-3.835, -3.665, y, y + 0.012, -1.685, -1.515, '#a8905f');
    this.perch(-4.1, -3.45, 0.51, 0.56, -1.95, -1.35, '#8c7a63', '#6f6050', 0.46);
    this.perch(-4.08, -3.5, 0.93, 0.98, -1.88, -1.4, '#8c7a63', '#6f6050', 0.88);
    this.perch(-4.1, -3.4, 1.43, 1.48, -1.95, -1.4, '#d8ccb6', '#b9ad96', 1.38); vb(-4.1, -4.05, 1.48, 1.62, -1.95, -1.4, '#d8ccb6'); vb(-3.45, -3.4, 1.48, 1.62, -1.95, -1.4, '#d8ccb6'); vb(-4.1, -3.4, 1.48, 1.62, -1.95, -1.9, '#d8ccb6');
    this.climbs.push({ x0: -4.05 + this.ox, x1: -3.42 + this.ox, z0: -1.9, z1: -1.3, y0: 0.0, top: 1.5 });
    this.ox = 0;
    sb(3.84, 3.98, 0, 1.7, -0.95, -0.81, '#c9b07f'); this.perch(3.7, 4.12, 1.7, 1.75, -1.02, -0.74, '#8c7a63', '#6f6050', 1.65); sb(3.7, 4.12, 0, 0.05, -1.02, -0.74, '#8c7a63');
    for (let y = 0.1; y < 1.7; y += 0.07) vb(3.835, 3.985, y, y + 0.012, -0.955, -0.805, '#a8905f');
    this.climbs.push({ x0: 3.6, x1: 4.2, z0: -1.14, z1: -0.62, y0: 0.0, top: 1.74 });
    // wall shelves zig-zagging up the west wall
    for (const [y, z0] of [[0.55, -0.9], [1.0, -0.38], [1.45, 0.14], [1.9, 0.66]] as const) { sb(X0, X0 + 0.5, y - 0.04, y, z0, z0 + 0.5, '#9a6a3e'); vb(X0, X0 + 0.5, y - 0.07, y - 0.04, z0 + 0.04, z0 + 0.46, '#7a512d'); }
    sb(X0, X0 + 0.25, 1.9, 1.98, 0.66, 1.16, '#9a6a3e');

    this.buildKitchen();

    // ---- the mouse hole (south wall) where the mouse lives
    vb(-1.15, -0.85, 0, 0.14, Z1 - 0.012, Z1, '#2a1c14'); vb(-1.2, -0.8, 0.14, 0.17, Z1 - 0.014, Z1, '#6d4526'); vb(-1.2, -1.17, 0, 0.14, Z1 - 0.014, Z1, '#6d4526'); vb(-0.83, -0.8, 0, 0.14, Z1 - 0.014, Z1, '#6d4526');
  }


  /** the kitchen: a copy of a real one (dark teal walls, oak worktop, white bar-handle units, steel fridge, grey tiles) at human size */
  private buildKitchen() {
    const M = this.mesh, EW = X0 - 0.15;            // west wall inner face x = KX0, east wall x = EW
    const k = 1.0;
    const v = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c: string, kk = k) => this.vb(x0, x1, y0, y1, z0, z1, c, kk);
    const s = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c: string, kk = k) => { v(x0, x1, y0, y1, z0, z1, c, kk); this.boxes.push({ x0, x1, y0, y1, z0, z1 }); };
    const rnd = mulberry32(77);
    const TEAL = '#35657a', WHITE = '#ececea', OAK = '#b98748', OAKL = '#a8763b', STEEL = '#b4babf', STEELD = '#8f969c', GREY = '#8c9096', GROUT = '#6c7075', METRO = '#93aaa4';
    // floor of big stone-effect grey tiles, ceiling, walls
    s(KX0 - 0.15, EW, -0.1, 0, KZ0 - 0.15, KZ1 + 0.15, GREY);
    for (let x = KX0 + 0.5; x < EW; x += 0.5) v(x - 0.006, x + 0.006, 0, 0.004, KZ0, KZ1, GROUT);
    for (let z = KZ0 + 0.5; z < KZ1; z += 0.5) v(KX0, EW, 0, 0.004, z - 0.006, z + 0.006, GROUT);
    for (let i = 0; i < 40; i++) { const x = KX0 + rnd() * (EW - KX0 - 0.4), z = KZ0 + rnd() * (KZ1 - KZ0 - 0.4); v(x, x + 0.25, 0.004, 0.006, z, z + 0.25, rnd() > 0.5 ? '#9a9ea4' : '#7f8389'); }
    v(KX0 - 0.15, EW, H, H + 0.1, KZ0 - 0.15, KZ1 + 0.15, COL.ceil);
    s(KX0 - 0.15, KX0, 0, H, KZ0 - 0.15, KZ1 + 0.15, TEAL);                    // west (window) wall
    s(KX0 - 0.15, EW, 0, H, KZ0 - 0.15, KZ0, TEAL);                              // north
    s(KX0 - 0.15, EW + 0.15, 0, H, KZ1, KZ1 + 0.15, TEAL);                      // south
    for (const [a, b, c2, d] of [[KX0, KX0 + 0.015, KZ0, KZ1], [KX0, EW, KZ0, KZ0 + 0.015], [KX0, EW, KZ1 - 0.015, KZ1]] as const) v(a, b, 0, 0.1, c2, d, '#e4e4e0');
    // ---- west wall run: tall fridge-freezer, dishwasher, double-bowl sink under the window, corner cupboards
    const FX1 = KX0 + 0.62;
    s(KX0, FX1 + 0.03, 0, 1.85, KZ0, 0.25, STEEL);
    for (const y of [0.55, 1.05]) v(FX1 + 0.03, FX1 + 0.04, y, y + 0.012, KZ0 + 0.02, 0.23, '#4a4f55');          // drawer gaps (3 drawers below)
    v(FX1 + 0.03, FX1 + 0.04, 1.08, 1.5, KZ0 + 0.09, KZ0 + 0.13, '#555b61'); v(FX1 + 0.03, FX1 + 0.05, 1.45, 1.65, KZ0 + 0.28, KZ0 + 0.34, '#2b2f34');
    v(FX1 + 0.03, FX1 + 0.05, 0.62, 0.66, KZ0 + 0.1, KZ0 + 0.5, '#4a4f55'); v(FX1 + 0.03, FX1 + 0.05, 1.12, 1.16, KZ0 + 0.1, KZ0 + 0.5, '#4a4f55');
    // magnets on its flank
    const mags = ['#e0503c', '#2d8fd0', '#f0c940', '#f3f3f0', '#6ac07a', '#c05ca0', '#2a2a30', '#d9873a'];
    for (let i = 0; i < 9; i++) v(KX0 + 0.05 + (i % 3) * 0.14, KX0 + 0.16 + (i % 3) * 0.14, 1.15 + Math.floor(i / 3) * 0.17 + (i % 2) * 0.03, 1.27 + Math.floor(i / 3) * 0.17 + (i % 2) * 0.03, 0.25, 0.262, mags[i % mags.length]);
    s(KX0, FX1, 0, 0.84, 0.25, 0.85, STEELD);                                               // dishwasher
    v(FX1, FX1 + 0.02, 0.0, 0.84, 0.25, 0.85, STEEL); v(FX1, FX1 + 0.03, 0.72, 0.82, 0.3, 0.8, '#2b2f34'); v(FX1, FX1 + 0.04, 0.6, 0.64, 0.32, 0.78, '#d0d4d8');
    s(KX0, FX1, 0, 0.86, 0.85, 2.6, WHITE);                                                 // base units (sink + corner cupboards)
    for (const z of [1.45, 2.05]) v(FX1, FX1 + 0.012, 0.04, 0.84, z, z + 0.012, '#9a9a96');
    for (const z of [0.95, 1.5, 2.1, 2.5]) v(FX1 + 0.012, FX1 + 0.045, 0.2, 0.72, z, z + 0.022, STEEL);       // long bar handles
    s(KX0, FX1, 0.86, 0.9, 0.25, 3.2, OAK);                                                 // oak worktop
    for (let z = 0.3; z < 3.2; z += 0.3) v(KX0, FX1, 0.9, 0.902, z, z + 0.004, OAKL);
    v(KX0 + 0.05, KX0 + 0.5, 0.9, 0.915, 1.0, 2.05, STEEL);                                 // the sink: two bowls and a drainer
    v(KX0 + 0.1, KX0 + 0.45, 0.905, 0.925, 1.05, 1.35, STEELD); v(KX0 + 0.1, KX0 + 0.45, 0.905, 0.925, 1.4, 1.62, STEELD);
    for (let i = 0; i < 6; i++) v(KX0 + 0.1, KX0 + 0.45, 0.915, 0.92, 1.7 + i * 0.05, 1.72 + i * 0.05, STEELD);
    v(KX0 + 0.04, KX0 + 0.08, 0.9, 1.15, 1.4, 1.44, STEEL); v(KX0 + 0.04, KX0 + 0.2, 1.12, 1.16, 1.4, 1.44, STEEL);    // mixer tap
    // splashback of grey-green metro tiles, window with a white venetian blind, clock, postcards
    v(KX0, KX0 + 0.012, 0.9, 1.45, 0.25, 3.2, METRO);
    for (let y = 0.9; y < 1.45; y += 0.1) v(KX0, KX0 + 0.014, y - 0.004, y + 0.004, 0.25, 3.2, '#7e918c');
    for (let r = 0; r < 6; r++) for (let z = 0.3 + (r % 2) * 0.15; z < 3.2; z += 0.3) v(KX0, KX0 + 0.014, 0.9 + r * 0.1, 1.0 + r * 0.1, z - 0.003, z + 0.003, '#7e918c');
    v(KX0, KX0 + 0.02, 1.02, 1.82, 1.0, 2.1, '#f2f2f0');                                   // window frame
    v(KX0, KX0 + 0.03, 1.07, 1.77, 1.05, 2.05, '#b4cde0', 1.3); v(KX0, KX0 + 0.04, 1.07, 1.77, 1.53, 1.57, '#f2f2f0'); v(KX0, KX0 + 0.04, 1.4, 1.43, 1.05, 2.05, '#f2f2f0');
    v(KX0, KX0 + 0.06, 0.9, 0.93, 0.98, 2.12, '#f2f2f0');                                   // sill
    v(KX0 + 0.04, KX0 + 0.1, 0.93, 1.03, 1.45, 1.52, '#7fb8c8'); v(KX0 + 0.04, KX0 + 0.1, 0.93, 1.06, 1.12, 1.2, '#d94b8e'); v(KX0 + 0.04, KX0 + 0.1, 0.93, 1.05, 1.28, 1.35, '#6ac07a');   // bottles on the sill
    v(KX0, KX0 + 0.1, 1.85, 2.4, 0.95, 2.15, '#efe7cf'); for (let y = 1.87; y < 2.4; y += 0.055) v(KX0 + 0.1, KX0 + 0.115, y, y + 0.012, 0.95, 2.15, '#cfc6aa');   // blind
    v(KX0, KX0 + 0.1, 2.38, 2.42, 0.93, 2.17, '#f2f2f0');
    M.cyl(0.15, 0.15, 0.04, '#d9d9d6', KX0 + 0.04, 1.85, 0.6, 1, 1, 18, 0, 0, Math.PI / 2); M.cyl(0.13, 0.13, 0.05, '#f2f2f0', KX0 + 0.06, 1.85, 0.6, 1, 1, 18, 0, 0, Math.PI / 2);
    v(KX0 + 0.08, KX0 + 0.1, 1.85, 2.0, 0.598, 0.602, '#222'); v(KX0 + 0.08, KX0 + 0.1, 1.85, 1.9, 0.6, 0.66, '#222');
    for (let i = 0; i < 6; i++) v(KX0, KX0 + 0.015, 1.55 + (i % 2) * 0.05, 1.68 + (i % 2) * 0.05, 2.3 + i * 0.1, 2.38 + i * 0.1, ['#e0503c', '#f3f3f0', '#7fb8c8', '#6a8f4e', '#c8a060', '#3a4a6a'][i]);   // postcards and the I♥NY magnet row
    v(KX0, KX0 + 0.02, 1.58, 1.7, 2.3, 2.48, '#f3f3f0'); v(KX0, KX0 + 0.025, 1.6, 1.66, 2.34, 2.42, '#d02a2a');
    M.sph(1, '#6a2c9a', KX0 + 0.3, 2.3, 3.05, 0.17, 0.21, 0.17, 10); M.box(0.01, 0.2, 0.01, '#d8d0e0', KX0 + 0.3, 2.0, 3.05);   // the purple "2" balloon
    // things on the worktop: toaster, knife block, two kettles
    M.box(0.2, 0.17, 0.3, '#efe3c8', KX0 + 0.3, 1.0, 2.95); for (const dz of [-0.08, 0.08]) M.box(0.12, 0.012, 0.05, '#2a2a2e', KX0 + 0.3, 1.09, 2.95 + dz); for (let i = 0; i < 4; i++) M.sph(1, '#8d3a2c', KX0 + 0.18, 1.0 + 0.01, 2.8 + i * 0.07, 0.02, 0.02, 0.02, 5);
    M.box(0.12, 0.2, 0.1, '#262628', KX0 + 0.2, 1.0, 2.55); for (let i = 0; i < 3; i++) M.box(0.016, 0.1, 0.018, '#111', KX0 + 0.2, 1.14, 2.52 + i * 0.03);
    M.cyl(0.07, 0.085, 0.2, '#b9bec4', KX0 + 0.25, 1.0, 2.3, 1, 1, 12); M.cyl(0.08, 0.09, 0.22, '#efe6c8', KX0 + 0.28, 1.01, 2.1, 1, 1, 12);
    // ---- south wall run: hob + built-in ovens, wall cupboards
    const SZ0 = 2.6, SX1 = KX0 + 2.1;
    s(FX1, SX1, 0, 0.86, SZ0, KZ1, WHITE); s(FX1, SX1, 0.86, 0.9, SZ0, KZ1, OAK);
    v(FX1 + 0.4, FX1 + 1.0, 0.9, 0.915, SZ0 + 0.05, KZ1 - 0.05, '#111114');                 // glass hob
    for (let i = 0; i < 4; i++) v(FX1 + 0.5 + (i % 2) * 0.3, FX1 + 0.68 + (i % 2) * 0.3, 0.915, 0.92, SZ0 + 0.12 + Math.floor(i / 2) * 0.22, SZ0 + 0.3 + Math.floor(i / 2) * 0.22, '#2c2c32');
    v(FX1 + 0.4, FX1 + 1.0, 0.12, 0.84, SZ0 - 0.015, SZ0, '#17171b');                        // double oven fronts
    v(FX1 + 0.4, FX1 + 1.0, 0.7, 0.84, SZ0 - 0.02, SZ0, STEELD); v(FX1 + 0.42, FX1 + 0.6, 0.72, 0.8, SZ0 - 0.03, SZ0 - 0.02, '#3a8fd0'); v(FX1 + 0.4, FX1 + 1.0, 0.36, 0.4, SZ0 - 0.03, SZ0 - 0.02, '#c9cdd2');
    for (const x of [FX1 + 0.4, FX1 + 1.0]) v(x - 0.01, x + 0.01, 0.12, 0.84, SZ0 - 0.03, SZ0 - 0.015, STEEL);
    v(FX1 + 0.06, FX1 + 0.09, 0.1, 0.8, SZ0 - 0.04, SZ0 - 0.015, STEEL);
    v(FX1, SX1, 0.9, 1.45, KZ1 - 0.012, KZ1, METRO);
    for (let y = 0.9; y < 1.45; y += 0.1) v(FX1, SX1, y - 0.004, y + 0.004, KZ1 - 0.014, KZ1, '#7e918c');
    s(KX0, KX0 + 1.3, 1.5, 2.3, KZ1 - 0.32, KZ1, WHITE);                                    // wall cupboards with long steel handles
    for (const x of [KX0 + 0.6, KX0 + 0.75]) v(x, x + 0.02, 1.55, 2.2, KZ1 - 0.36, KZ1 - 0.32, STEEL);
    v(KX0 + 0.65, KX0 + 0.67, 1.5, 2.3, KZ1 - 0.33, KZ1 - 0.32, '#c9c9c4');
    // ---- the utility corner (north wall): washing machine under a dark green worktop
    s(KX0 + 1.0, KX0 + 3.0, 0, 0.86, KZ0, KZ0 + 0.6, WHITE); s(KX0 + 1.0, KX0 + 3.0, 0.86, 0.9, KZ0, KZ0 + 0.6, '#34524a');
    v(KX0 + 1.6, KX0 + 2.25, 0.0, 0.86, KZ0 + 0.58, KZ0 + 0.62, '#40464d'); M.cyl(0.21, 0.21, 0.05, '#22262b', KX0 + 1.92, 0.45, KZ0 + 0.62, 1, 1, 18, Math.PI / 2, 0, 0); M.cyl(0.16, 0.16, 0.05, '#6f8fa6', KX0 + 1.92, 0.45, KZ0 + 0.645, 1, 1, 16, Math.PI / 2, 0, 0);
    v(KX0 + 1.6, KX0 + 2.25, 0.74, 0.8, KZ0 + 0.62, KZ0 + 0.64, '#1f2328');
    v(KX0 + 1.0, KX0 + 1.55, 0.12, 0.84, KZ0 + 0.6, KZ0 + 0.62, WHITE); v(KX0 + 1.5, KX0 + 1.53, 0.2, 0.7, KZ0 + 0.62, KZ0 + 0.65, STEEL);
    v(KX0 + 1.0, KX0 + 3.0, 0.9, 1.4, KZ0, KZ0 + 0.012, '#d8d8d2');
    s(KX0 + 2.2, KX0 + 3.0, 1.5, 2.2, KZ0, KZ0 + 0.3, '#d8c8a0'); for (let i = 0; i < 4; i++) v(KX0 + 2.25 + i * 0.18, KX0 + 2.4 + i * 0.18, 1.55, 1.95, KZ0 + 0.3, KZ0 + 0.31, ['#2d8fd0', '#2d8fd0', '#e0503c', '#f3f3f0'][i]);   // sodastream boxes on a shelf
    v(KX0 + 3.3, KX0 + 4.2, 0.0, 0.01, 1.4, 2.2, '#2aa6b3');                                   // teal doormat by the doorway
    // ---- jumping about: a larder next to the hole in the wall, a stool-high table, two stools
    s(EW - 0.75, EW, 0, 1.98, 0.5, 1.4, WHITE); v(EW - 0.76, EW - 0.75, 0.05, 1.93, 0.52, 1.38, '#d6d6d1'); v(EW - 0.76, EW - 0.74, 0.8, 1.2, 0.9, 0.93, STEEL);
    v(EW - 0.76, EW - 0.74, 0.9, 1.4, 0.45, 0.5, '#e6e6e2');
    s(KX0 + 2.2, KX0 + 3.2, 0.72, 0.78, 1.0, 2.0, OAK); for (const [x, z] of [[KX0 + 2.25, 1.05], [KX0 + 3.15, 1.05], [KX0 + 2.25, 1.95], [KX0 + 3.15, 1.95]]) s(x - 0.03, x + 0.03, 0, 0.72, z - 0.03, z + 0.03, '#dcdcd6');
    for (const z of [0.75, 2.25]) { s(KX0 + 2.5, KX0 + 2.85, 0.4, 0.46, z - 0.17, z + 0.17, '#2f6f86'); s(KX0 + 2.6, KX0 + 2.75, 0, 0.4, z - 0.04, z + 0.04, STEEL); }
    // a round clock-radio and a fruit bowl for the table
    M.cyl(0.14, 0.1, 0.07, '#d8c27a', KX0 + 2.7, 0.8, 1.5, 1, 1, 12); for (let i = 0; i < 5; i++) M.sph(1, ['#d93a2a', '#f0c030', '#7ab648', '#e8892a', '#d93a2a'][i], KX0 + 2.7 + Math.cos(i * 1.3) * 0.05, 0.9, 1.5 + Math.sin(i * 1.3) * 0.05, 0.045, 0.045, 0.045, 6);
  }

  private buildToys() {
    const m = new Mesher();
    m.sph(1, '#9a9aa2', 0, 0.035, 0, 0.032, 0.03, 0.06, 9); m.sph(1, '#8a8a92', 0, 0.04, 0.055, 0.022, 0.022, 0.03, 8);
    m.sph(1, '#e2a0a8', 0, 0.036, 0.085, 0.006, 0.006, 0.006, 5);
    for (const s of [-1, 1]) { m.sph(1, '#d8a0a8', s * 0.022, 0.065, 0.045, 0.017, 0.017, 0.004, 7); m.sph(1, '#101010', s * 0.012, 0.045, 0.075, 0.004, 0.004, 0.004, 4); }
    for (const [lx, lz] of [[-0.02, 0.03], [0.02, 0.03], [-0.02, -0.03], [0.02, -0.03]]) m.sph(1, '#d8a0a8', lx, 0.008, lz, 0.009, 0.008, 0.014, 5);
    this.mouseG.add(m.build(false));
    const t = new Mesher(); t.cyl(0.004, 0.006, 0.14, '#e6a6ad', 0, 0, 0, 1, 1, 5, Math.PI / 2);
    const tg = new THREE.Group(); tg.position.set(0, 0.03, -0.055); tg.rotation.x = 0.1; const tm = t.build(false); tm.position.z = -0.07; tg.add(tm);
    this.mouseG.add(tg); this.mouseTail = tg;
    this.group.add(this.mouseG);
    // the exercise ball: matt black, with a paler stripe
    // flush paler patches (no parts sticking out) so you can see it roll
    const b = new Mesher(); b.sph(0.34, '#25252b', 0, 0, 0, 1, 1, 1, 18);
    for (const [rx, rz] of [[0, 0], [0, Math.PI / 2], [Math.PI / 2, 0], [0, -Math.PI / 2], [-Math.PI / 2, 0], [Math.PI, 0]] as const) b.add(new THREE.SphereGeometry(0.3404, 14, 6, 0, Math.PI * 2, 0, 0.3), '#3d3d46', 0, 0, 0, rx, 0, rz);
    this.ballM = b.build(this.shadows); this.ballG.add(this.ballM); this.ballG.position.y = 0.34;
    this.group.add(this.ballG);
    this.placeToys();
  }

  // ------------------------------------------------------------ the world as the player's ground
  /** (world coordinates) is this spot anywhere in the cat house (including the balcony)? */
  contains(x: number, z: number) { return Math.abs(x - CX) < 30 && Math.abs(z - CZ) < 30; }

  floor(x: number, z: number, y: number): number {
    const lx = x - CX, lz = z - CZ, ly = y - CY;
    let g = 0;
    for (const b of this.boxes) if (b.y1 > g && b.y1 <= ly + 0.2 && lx >= b.x0 && lx <= b.x1 && lz >= b.z0 && lz <= b.z1) g = b.y1;
    return CY + g;
  }
  ceiling(x: number, z: number, y: number): number {
    const lx = x - CX, lz = z - CZ, ly = y - CY;
    let c = H;
    for (const b of this.boxes) if (!b.soft && !(this.ghost && b.perch) && b.y0 > ly + 0.02 && b.y0 < c && lx >= b.x0 - 0.04 && lx <= b.x1 + 0.04 && lz >= b.z0 - 0.04 && lz <= b.z1 + 0.04) c = b.y0;
    return CY + c;
  }
  climbAt(x: number, z: number, y: number): { top: number; cx: number; cz: number } | null {
    const lx = x - CX, lz = z - CZ, ly = y - CY;
    for (const c of this.climbs) if (lx >= c.x0 && lx <= c.x1 && lz >= c.z0 && lz <= c.z1 && ly >= c.y0 - 0.05 && ly <= c.top + 0.1) return { top: CY + c.top, cx: CX + (c.x0 + c.x1) / 2, cz: CZ + (c.z0 + c.z1) / 2 };
    return null;
  }

  /** push a circle (radius r, standing at feetY, h tall) out of the walls and furniture; returns the strongest push normal */
  private push(lx: number, lz: number, r: number, ly: number, h: number, out: { x: number; z: number; nx: number; nz: number }): boolean {
    let hit = false; out.nx = out.nz = 0;
    // the outer envelope: the room, plus the balcony when you are at the doors
    const inK = lz > KZ0 && lz < KZ1;
    const minX = inK ? KX0 + r * 0.5 : X0 + r * 0.5, maxX = lx > X1 - 0.3 ? BX - r * 0.5 : X1 - r * 0.5;
    if (lx < minX) { lx = minX; out.nx += 1; hit = true; }
    if (lx > maxX) { lx = maxX; out.nx -= 1; hit = true; }
    const west = lx < X0 - 0.01;
    const zMin = lx > X1 ? BZ0 + r * 0.5 : (west ? KZ0 : Z0) + r * 0.5, zMax = lx > X1 ? BZ1 - r * 0.5 : (west ? KZ1 : Z1) - r * 0.5;
    if (lz < zMin) { lz = zMin; out.nz += 1; hit = true; }
    if (lz > zMax) { lz = zMax; out.nz -= 1; hit = true; }
    for (let pass = 0; pass < 2; pass++) for (const b of this.boxes) {
      if (b.soft || (this.ghost && b.perch) || !(ly < b.y1 - 0.16 && ly + h > b.y0 + 0.02)) continue;
      const cx = Math.max(b.x0, Math.min(lx, b.x1)), cz = Math.max(b.z0, Math.min(lz, b.z1));
      const dx = lx - cx, dz = lz - cz, d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) { const d = Math.sqrt(d2); lx = cx + (dx / d) * r; lz = cz + (dz / d) * r; out.nx += dx / d; out.nz += dz / d; }
      else {
        const l = lx - b.x0, rr = b.x1 - lx, t = lz - b.z0, bt = b.z1 - lz, m = Math.min(l, rr, t, bt);
        if (m === l) { lx = b.x0 - r; out.nx -= 1; } else if (m === rr) { lx = b.x1 + r; out.nx += 1; } else if (m === t) { lz = b.z0 - r; out.nz -= 1; } else { lz = b.z1 + r; out.nz += 1; }
      }
      hit = true;
    }
    out.x = lx; out.z = lz;
    return hit;
  }
  private _o = { x: 0, z: 0, nx: 0, nz: 0 };
  resolve(x: number, z: number, r: number, feetY: number, out: { x: number; z: number }) {
    this.push(x - CX, z - CZ, r, feetY - CY, 0.36, this._o);
    out.x = this._o.x + CX; out.z = this._o.z + CZ;
  }

  // ------------------------------------------------------------ doors and entering
  pickDoor(eye: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, reach: number, assist = 1): number | null {
    if (!this.active) return null;
    const dx = this.doorAt.x - eye.x, dy = this.doorAt.y - eye.y, dz = this.doorAt.z - eye.z;
    const t = dx * dir.x + dy * dir.y + dz * dir.z;
    if (t < 0 || t > reach + 1.5) return null;
    const px = dx - dir.x * t, py = dy - dir.y * t, pz = dz - dir.z * t, r = 1.0 * assist;
    return px * px + py * py + pz * pz <= r * r ? t : null;
  }

  arrival() { return { x: CX - 3.0, z: CZ - 1.45, yaw: -Math.PI / 2 }; }

  enter(p: { teleport(x: number, y: number, z: number, yaw: number): void; cave: any; body: any }, catBody: any) {
    this.active = true; this.group.visible = true;
    p.cave = this; p.body = catBody;
    const a = this.arrival();
    p.teleport(a.x, CY, a.z, a.yaw);
    this.camera.near = 0.04; this.camera.updateProjectionMatrix();
    this.placeToys();
  }
  leave(p: { cave: any; body: any; climbing: boolean }, humanBody: any) {
    this.mouse.mode = 0; this.mouse.y = 0;
    this.active = false; this.group.visible = false; p.cave = null; p.body = humanBody; p.climbing = false;
    this.camera.near = 0.1; this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------ the mouse and the ball
  private placeToys() {
    const m = this.mouse; m.x = -1.0; m.z = MOUSE_Z; m.hide = 0; m.speed = 0; m.t = 1;
    const b = this.ball; b.x = 2.15; b.z = 1.55; b.vx = b.vz = 0;
  }
  /** a pounce: is the mouse close enough in front of (x, z) facing yaw? Returns true when caught */
  swat(x: number, z: number, yaw: number): boolean {
    const m = this.mouse;
    if (m.hide > 0 || m.localHide > 0) return false;
    const dx = CX + m.x - x, dz = CZ + m.z - z, d = Math.hypot(dx, dz);
    if (d > 0.62) return false;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    if (d > 0.2 && (dx * fx + dz * fz) / d < 0.2) return false;
    this.mouseCaught(true);
    return true;
  }
  /** the mouse was caught (here, or by somebody else: everybody hides it for a moment) */
  mouseCaught(mine: boolean) {
    this.mouse.hide = 3.2; this.mouse.localHide = 3.2; this.mouse.speed = 0;
    this.onSqueak?.();
    if (mine) { this.caught++; this.onCatch?.(); }
  }

  /** other cats' velocity, from where they were last frame */
  private velOf(id: number, x: number, z: number, dt: number) {
    const p = this.lastPos.get(id);
    const v = p && dt > 0 ? { x: (x - p.x) / dt, z: (z - p.z) / dt } : { x: 0, z: 0 };
    this.lastPos.set(id, { x, z });
    return v;
  }

  update(dt: number, cats: { id: number; x: number; z: number; y: number }[], host: boolean) {
    if (!this.active) return;
    dt = Math.min(dt, 0.05);
    const list = cats.map((c) => ({ ...c, lx: c.x - CX, lz: c.z - CZ, ly: c.y - CY, ...this.velOf(c.id, c.x, c.z, dt) }));
    this.updateBall(dt, list);
    this.updateMouse(dt, list, host);
  }
  /** set after the last throw lands so the owner can announce the final resting place once */
  landed = false;

  private updateBall(dt: number, cats: { lx: number; lz: number; ly: number; x: number; z: number }[]) {
    const b = this.ball, R = 0.34;
    for (const c of cats) {
      if (c.ly > 0.55) continue;
      const dx = b.x - c.lx, dz = b.z - c.lz, d = Math.hypot(dx, dz), min = R + 0.16;
      if (d < min && d > 1e-4) {
        const nx = dx / d, nz = dz / d;
        const vn = (b.vx - c.x) * nx + (b.vz - c.z) * nz;       // (c.x/c.z are the cat's velocity here)
        b.x = c.lx + nx * min; b.z = c.lz + nz * min;
        if (vn < 0) { b.vx -= 1.25 * vn * nx; b.vz -= 1.25 * vn * nz; }
      }
    }
    b.x += b.vx * dt; b.z += b.vz * dt;
    const o = this._o;
    if (this.push(b.x, b.z, R, 0, 0.68, o)) {
      const l = Math.hypot(o.nx, o.nz);
      if (l > 1e-4) { const nx = o.nx / l, nz = o.nz / l, vn = b.vx * nx + b.vz * nz; if (vn < 0) { b.vx -= 1.6 * vn * nx; b.vz -= 1.6 * vn * nz; } }
      b.x = o.x; b.z = o.z;
    }
    const f = Math.exp(-0.55 * dt); b.vx *= f; b.vz *= f;
    const sp = Math.hypot(b.vx, b.vz); if (sp < 0.02) { b.vx = b.vz = 0; } else if (sp > 9) { b.vx *= 9 / sp; b.vz *= 9 / sp; }
    this.ballG.position.set(b.x, 0.34, b.z);
    if (sp > 0.01) {
      const axis = new THREE.Vector3(b.vz, 0, -b.vx).normalize(), q = new THREE.Quaternion().setFromAxisAngle(axis, (sp * dt) / R);
      this.ballM.quaternion.premultiply(q);
    }
  }

  private updateMouse(dt: number, cats: { lx: number; lz: number; ly: number }[], host: boolean) {
    const m = this.mouse;
    if (m.localHide > 0) m.localHide -= dt;
    if (m.mode === 2) {
      // flying: gravity, bounce off the floor and furniture, slide to a stop (then the host takes over again)
      m.vy -= 9.8 * dt;
      let nx = m.x + m.vx * dt, nz = m.z + m.vz * dt;
      const o = this._o;
      if (this.push(nx, nz, 0.05, m.y, 0.06, o)) {
        const l = Math.hypot(o.nx, o.nz);
        if (l > 1e-4) { const wx = o.nx / l, wz = o.nz / l, vn = m.vx * wx + m.vz * wz; if (vn < 0) { m.vx -= 1.6 * vn * wx; m.vz -= 1.6 * vn * wz; } }
        nx = o.x; nz = o.z;
      }
      m.x = nx; m.z = nz; m.y += m.vy * dt;
      const fl = this.floor(CX + m.x, CZ + m.z, CY + m.y + 0.1) - CY;
      if (m.y <= fl) {
        m.y = fl;
        if (m.vy < -1.2) { m.vy *= -0.35; m.vx *= 0.7; m.vz *= 0.7; }
        else { m.vy = 0; const f = Math.exp(-5 * dt); m.vx *= f; m.vz *= f; }
      }
      m.spin += dt * 14;
      // bonk any cat it hits
      if (m.bonk <= 0 && Math.hypot(m.vx, m.vy, m.vz) > 1.8) for (const c of cats as any[]) {
        if (c.ly > m.y + 0.8 || Math.hypot(c.lx - m.x, c.lz - m.z) > 0.28 || m.y > c.ly + 0.6) continue;
        m.bonk = 0.6; m.vx *= -0.3; m.vz *= -0.3; this.onBonk?.(c.id); break;
      }
      if (m.bonk > 0) m.bonk -= dt;
      if (m.y <= fl + 0.001 && Math.hypot(m.vx, m.vz) < 0.15 && Math.abs(m.vy) < 0.1) { m.mode = 0; m.y = 0; m.speed = 0; m.t = 0.6; this.landed = true; }
    } else if (m.mode === 1) {
      m.speed = 0; m.spin += dt * 6;
    } else if (m.mode === 3) {
      m.rt -= dt;
      m.x += (m.sx - m.x) * Math.min(1, dt * 14); m.z += (m.sz - m.z) * Math.min(1, dt * 14); m.y += (m.ry - m.y) * Math.min(1, dt * 14);
      m.spin += dt * 10;
      if (m.rt <= 0) { m.mode = 0; m.y = 0; }
    } else if (!host) {
      // follow the host's mouse: dead-reckon along its heading between updates, and slide toward the last known spot
      if (m.fresh) { m.x += (m.sx - m.x) * Math.min(1, dt * 9); m.z += (m.sz - m.z) * Math.min(1, dt * 9); }
      m.phase += m.speed * dt * 16;
    } else if (m.hide > 0) {
      m.hide -= dt;
      if (m.hide <= 0) { m.x = -1.0; m.z = MOUSE_Z; m.speed = 0; m.t = 0.3; m.yaw = -Math.PI / 2 + (Math.random() - 0.5) * 0.8; }
    } else {
      // scurry: flee from any cat on the floor close by, otherwise sniff around between short dashes
      let near: { lx: number; lz: number } | null = null, nd = 1.9;
      for (const c of cats) { if (c.ly > 0.7) continue; const d = Math.hypot(c.lx - m.x, c.lz - m.z); if (d < nd) { nd = d; near = c; } }
      m.t -= dt;
      if (near) {
        const want = Math.atan2(m.x - near.lx, m.z - near.lz) + (Math.random() - 0.5) * 0.7;
        if (m.t <= 0 || m.stuck > 0.25) { m.yaw = want; m.t = 0.25 + Math.random() * 0.25; m.stuck = 0; }
        m.speed += (2.7 - m.speed) * Math.min(1, dt * 10);
      } else if (m.t <= 0) {
        if (m.speed > 0.2) { m.speed = 0; m.t = 0.7 + Math.random() * 1.8; }
        else { m.yaw = Math.random() * Math.PI * 2; m.speed = 0.6 + Math.random() * 1.0; m.t = 0.8 + Math.random() * 1.6; }
      } else if (m.speed > 0.2 && m.stuck > 0.3) { m.t = 0; m.speed = 0; m.stuck = 0; }
      const nx = m.x + Math.sin(m.yaw) * m.speed * dt, nz = m.z + Math.cos(m.yaw) * m.speed * dt;
      const o = this._o; this.push(nx, nz, 0.045, 0, 0.07, o);
      const moved = Math.hypot(o.x - m.x, o.z - m.z);
      m.stuck = m.speed > 0.3 && moved < m.speed * dt * 0.5 ? m.stuck + dt : 0;
      m.x = o.x; m.z = o.z; m.phase += m.speed * dt * 16;
    }
    const vis = m.mode !== 0 || (m.hide <= 0 && m.localHide <= 0);
    this.mouseG.visible = vis;
    this.mouseG.position.set(m.x, m.y, m.z); this.mouseG.rotation.y = m.yaw;
    this.mouseG.rotation.x = m.mode ? Math.sin(m.spin) * 0.6 : 0;
    this.mouseG.position.y = m.y + Math.abs(Math.sin(m.phase)) * 0.008 * Math.min(1, m.speed);
    this.mouseTail.rotation.y = Math.sin(m.phase * 0.5) * 0.4 * Math.min(1, 0.3 + m.speed);
  }

  exportState() {
    const m = this.mouse, b = this.ball, r = (v: number, k = 100) => Math.round(v * k) / k;
    return { m: [r(m.x), r(m.z), r(m.yaw, 100), r(m.speed, 10), m.hide > 0 ? 1 : 0], b: [r(b.x), r(b.z), r(b.vx, 10), r(b.vz, 10)] };
  }
  importState(s: { m: number[]; b: number[] }) {
    const m = this.mouse, b = this.ball;
    if (!m.mode) {
      m.sx = s.m[0]; m.sz = s.m[1]; m.yaw = s.m[2]; m.speed = s.m[3]; m.fresh = true;
      if (s.m[4]) { m.hide = Math.max(m.hide, 0.2); } else if (m.hide > 0 && m.localHide <= 0) m.hide = 0;
      if (!s.m[4] && m.localHide <= 0) m.hide = 0;
    }
    const d = Math.hypot(s.b[0] - b.x, s.b[1] - b.z);
    if (d > 1.2) { b.x = s.b[0]; b.z = s.b[1]; } else { b.x += (s.b[0] - b.x) * 0.5; b.z += (s.b[1] - b.z) * 0.5; }
    b.vx += (s.b[2] - b.vx) * 0.5; b.vz += (s.b[3] - b.vz) * 0.5;
  }
}
