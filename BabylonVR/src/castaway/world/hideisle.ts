// Hideaway Isle: a small island far out at sea (reached through the green door in the secret room) built for hide and seek.
// Ring the bell to start a round: one player is the seeker and counts inside the hut while everybody else hides - behind
// hedges, rocks, palms, haystacks, in sheds, or INSIDE crates and barrels. The seeker opens boxes (E) and tags players they can see (E).
// Alone on the island? Three little bots hide in boxes so you can still play. Same cave-style "ground" interface as the airstrip.
// Babylon port: Castaway's code, drawn by render/mirror.ts.
import * as THREE from 'three';
import { Mesher, bodyMaterial } from '../net/playerModel';
import { mulberry32 } from '../core/noise';

export const HX = -3000, HZ = 0;
const A = 52, FLAT = 2.2;
const HIDE_T = 30, SEEK_T = 180, OVER_T = 9;
const sm = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** > 0 inside the island, 0 at its irregular coast */
function mask(x: number, z: number) {
  const th = Math.atan2(z, x);
  const k = 1 + 0.06 * Math.sin(3 * th + 0.6) + 0.04 * Math.sin(5 * th + 2.1);
  return 1 - (Math.hypot(x, z) / A) * k;
}
const baseH = (x: number, z: number) => { const m = mask(x, z); return m > 0.12 ? FLAT : lerp(-6, FLAT, sm(-0.12, 0.12, m)); };
/** everything stands on the flat part of the island, never on the sloping shore */
const onLand = (x: number, z: number, pad = 0) => mask(x, z) > 0.16 + pad;

type Solid = { k: 'circ'; x: number; z: number; r: number; h: number; gate?: boolean } | { k: 'box'; x0: number; x1: number; z0: number; z1: number; h: number; gate?: boolean };
interface HideBox { x: number; z: number; kind: 'crate' | 'barrel'; g: THREE.Group }
interface Bot { name: string; box: number; found: boolean; fig: THREE.Group; t: number }

export type HideTarget = { w: 'exit' } | { w: 'bell' } | { w: 'box'; i: number } | { w: 'out' } | { w: 'tag'; id: number; name: string };
export interface IsleOther { id: number; name: string; x: number; y: number; z: number; flags: number }

const BOXES: [number, number, 'crate' | 'barrel'][] = [
  [-18, 26, 'crate'], [15, 30, 'barrel'], [-30, 8, 'barrel'], [28, 10, 'crate'], [-12, -14, 'crate'],
  [10, -20, 'barrel'], [30, -14, 'barrel'], [-28, -22, 'crate'], [2, -33, 'crate'], [-6, 18, 'barrel'],
  [22, -30, 'crate'], [-22, -3, 'barrel'], [34, -2, 'crate'], [-34, -8, 'barrel'], [18, 15, 'crate'],
];
const HEDGES: [number, number, number, number][] = [
  [-26, -14, 19.5, 20.5], [-14, -13, 13, 20.5], [20, 34, 22, 23], [33, 34, 10, 23], [-9, 9, -9, -8],
  [-36, -22, -14, -13], [-22, -21, -24, -14], [14, 28, -30, -29], [14, 15, -30, -21], [-38, -30, 2, 3],
  // two U-shaped nooks (a crate sits in the middle of each)
  [-26, -18, -8, -7], [-26, -25, -8, -2], [-19, -18, -8, -2],
  [14, 22, 12, 13], [14, 15, 12, 18], [21, 22, 12, 18],
];
const ROCKS: [number, number, number][] = [[-36, -4, 1.8], [36, 2, 1.5], [-20, -34, 1.6], [24, -38, 1.2], [20, 16, 1.3], [-27, 33, 1.4], [38, -24, 1.7], [-40, 14, 1.5], [6, 26, 1.5], [-14, 36, 1.8]];
const PALMS: [number, number][] = [[-8, 36], [8, 24], [-34, 18], [-24, 0], [24, 4], [34, 20], [30, -30], [-4, -26], [-14, -36], [8, -38], [-38, -12], [38, -8], [20, -12], [-16, 6], [14, 8], [-2, 42]];
const HAY: [number, number][] = [[-30, -2], [22, -6], [6, -14], [-8, 28], [32, 30]];
const SHEDS: [number, number][] = [[30, -2], [-24, -28], [22, -24], [-26, 12]];
/** A-frame tents (open to the south) */
const TENTS: [number, number][] = [[-10, 32], [26, 22], [-29, 18], [30, -22], [-10, -26]];
/** round bushes you can crouch behind */
const BUSHES: [number, number][] = [[-12, 0], [12, 4], [-18, 10], [24, -12], [-16, -24], [6, -30], [-4, 28], [10, 36], [34, 12], [-38, -2], [0, -18], [-30, 28], [26, 34], [-22, 20]];
/** a ruined stone room */
const RUIN: [number, number, number, number][] = [[11, 19, -12, -11.6], [11, 11.4, -12, -7], [18.6, 19, -12, -9]];
const PILLARS: [number, number][] = [[19, -7], [15, -6.2]];
const BOT_NAMES = ['Pip', 'Moss', 'Tilly', 'Juno', 'Bo'];
const BOT_COL = ['#d9534f', '#3f8fd2', '#e0a33a', '#9b6ad0', '#59a869'];

function textPlane(text: string[], w: number, h: number, bg: string, fg: string) {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = Math.round(512 * (h / w));
  const g = cv.getContext('2d')!;
  g.fillStyle = bg; g.fillRect(0, 0, cv.width, cv.height);
  g.strokeStyle = fg; g.lineWidth = 10; g.strokeRect(8, 8, cv.width - 16, cv.height - 16);
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  const lh = cv.height / (text.length + 0.6);
  text.forEach((t, i) => { g.font = `700 ${Math.round(lh * 0.62)}px system-ui, sans-serif`; g.fillText(t, cv.width / 2, lh * (i + 0.8)); });
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
}

export class HideIsle {
  readonly group = new THREE.Group();
  active = false;
  /** wired by main */
  send: (e: any) => void = () => {};
  myId = () => 0;
  others: () => IsleOther[] = () => [];
  say: (t: string) => void = () => {};
  /** the box I am hiding in (-1: none) */
  hiddenMe = -1;
  // ---- round state (identical on every client, driven by events)
  phase: 'idle' | 'hide' | 'seek' | 'over' = 'idle';
  private rid = 0;
  private seeker = -1;
  private hiders: number[] = [];
  private found = new Set<number>();
  private bots: Bot[] = [];
  private t = 0;
  private occ = new Map<number, number>();
  foundMe = false;
  private resultLine = '';
  private solids: Solid[] = [];
  private boxes: HideBox[] = [];
  private gate: THREE.Object3D | null = null;
  private bell: THREE.Object3D | null = null;
  private bellT = 0;
  private hud: HTMLDivElement;
  private shadows: boolean;

  constructor(scene: THREE.Scene, shadows: boolean) {
    this.shadows = shadows;
    const land = new THREE.Group(); land.position.set(HX, 0, HZ); this.group.add(land);
    const mat = bodyMaterial();
    const terrain = new THREE.Mesh(this.terrain(), mat); terrain.receiveShadow = shadows; terrain.frustumCulled = false; land.add(terrain);
    const M = new Mesher(), rnd = mulberry32(4242);
    const solid = (s: Solid) => { this.solids.push(s); return s; };

    // ---- the way home: a door frame on the south beach
    M.box(0.3, 2.6, 0.2, '#3b2a1c', -0.65, FLAT + 1.3, 44); M.box(0.3, 2.6, 0.2, '#3b2a1c', 0.65, FLAT + 1.3, 44); M.box(1.6, 0.3, 0.2, '#3b2a1c', 0, FLAT + 2.65, 44);
    M.box(1.0, 2.3, 0.1, '#2f9e5c', 0, FLAT + 1.2, 44.02); M.box(0.25, 0.25, 0.12, '#e0b341', 0.35, FLAT + 1.1, 44.1);
    solid({ k: 'box', x0: -0.9, x1: 0.9, z0: 43.8, z1: 44.3, h: 3 });
    const back = textPlane(['← door home'], 1.8, 0.5, '#3b2a1c', '#f4e3b8'); back.position.set(0, FLAT + 2.95, 43.88); back.rotation.y = Math.PI; land.add(back);

    // ---- the seeker's hut in the middle: the seeker counts in here with the gate shut (they cannot see out)
    const hw = '#8a6a44', hd = '#6a4d2e';
    const wall = (x0: number, x1: number, z0: number, z1: number, h = 2.8) => {
      M.box(x1 - x0, h, z1 - z0, hw, (x0 + x1) / 2, FLAT + h / 2, (z0 + z1) / 2);
      solid({ k: 'box', x0, x1, z0, z1, h: FLAT + h });
    };
    wall(-2.4, 2.4, -2.4, -2.1); wall(-2.4, -2.1, -2.4, 2.4); wall(2.1, 2.4, -2.4, 2.4);
    wall(-2.4, -0.8, 2.1, 2.4); wall(0.8, 2.4, 2.1, 2.4);
    M.box(5.2, 0.25, 5.2, hd, 0, FLAT + 2.9, 0); M.box(5.6, 0.12, 5.6, '#b5533c', 0, FLAT + 3.1, 0);
    M.box(0.2, 2.9, 0.42, '#5c3a1c', -0.86, FLAT + 1.45, 2.25); M.box(0.2, 2.9, 0.42, '#5c3a1c', 0.86, FLAT + 1.45, 2.25);   // door posts: bigger than the wall so no faces sit on top of each other
    M.box(3.6, 0.5, 0.8, hd, 0, FLAT + 0.25, -1.6);                       // a bench inside
    const gateM = new Mesher(); gateM.box(1.6, 2.6, 0.2, '#a0522d', 0, FLAT + 1.3, 2.25);
    for (let k = -1; k <= 1; k++) gateM.box(0.08, 2.6, 0.24, '#5c3a1c', k * 0.5, FLAT + 1.3, 2.25);
    const gm = gateM.build(shadows); land.add(gm); this.gate = gm; gm.visible = false;
    solid({ k: 'box', x0: -0.8, x1: 0.8, z0: 2.1, z1: 2.4, h: FLAT + 2.8, gate: true });
    const sg = textPlane(["SEEKER'S HUT", 'count to thirty'], 3.4, 1.0, '#2b1e15', '#f4e3b8'); sg.position.set(0, FLAT + 3.8, 2.7); land.add(sg);

    // ---- the bell that starts a round
    M.box(0.2, 2.2, 0.2, hd, 4, FLAT + 1.1, 14); M.box(1.0, 0.16, 0.16, hd, 4.4, FLAT + 2.15, 14);
    solid({ k: 'circ', x: 4, z: 14, r: 0.3, h: FLAT + 2.2 });
    const bellM = new Mesher(); bellM.cyl(0.1, 0.3, 0.42, '#e0b341', 0, 0, 0, 1, 1, 12); bellM.sph(0.07, '#7a5a1a', 0, -0.24, 0);
    const bm = bellM.build(false); bm.position.set(4.7, FLAT + 1.85, 14); land.add(bm); this.bell = bm;
    const rg = textPlane(['RING THE BELL', 'to play hide & seek'], 2.6, 0.9, '#2f9e5c', '#ffffff'); rg.position.set(4, FLAT + 2.9, 14.15); land.add(rg);
    const rg2 = rg.clone(); rg2.rotation.y = Math.PI; rg2.position.z = 13.85; land.add(rg2);

    // ---- hedges, rocks, palms, haystacks, sheds
    for (const [x0, x1, z0, z1] of HEDGES) {
      if (!onLand(x0, z0) || !onLand(x1, z1) || !onLand(x0, z1) || !onLand(x1, z0)) continue;
      const w = x1 - x0, d = z1 - z0, n = Math.max(2, Math.round(Math.max(w, d) / 1.6));
      for (let k = 0; k < n; k++) {
        const f = (k + 0.5) / n, x = w > d ? x0 + w * f : (x0 + x1) / 2, z = w > d ? (z0 + z1) / 2 : z0 + d * f;
        M.sph(0.95, rnd() < 0.5 ? '#3e7a34' : '#4a8a3a', x, FLAT + 1.1, z, w > d ? 1.0 : 0.65, 1.2, w > d ? 0.65 : 1.0, 8);
        M.sph(0.9, '#356b2e', x + (rnd() - 0.5) * 0.5, FLAT + 1.8, z + (rnd() - 0.5) * 0.5, 0.9, 0.7, 0.9, 7);
      }
      solid({ k: 'box', x0: x0 - 0.1, x1: x1 + 0.1, z0: z0 - 0.1, z1: z1 + 0.1, h: FLAT + 2.2 });
    }
    for (const [x, z, r] of ROCKS) {
      if (!onLand(x, z)) continue;
      M.add(new THREE.IcosahedronGeometry(r, 1), '#8a857b', x, FLAT + r * 0.35, z, rnd() * 3, rnd() * 3, 0, 1, 0.8, 1);
      M.add(new THREE.IcosahedronGeometry(r * 0.6, 0), '#777269', x + r * 0.7, FLAT + r * 0.15, z + r * 0.3, rnd(), rnd(), 0);
      solid({ k: 'circ', x, z, r: r * 0.95, h: FLAT + r * 1.2 });
    }
    for (const [x, z] of PALMS) {
      if (!onLand(x, z)) continue;
      const lean = (rnd() - 0.5) * 0.3, hgt = 7 + rnd() * 2.5;
      for (let s = 0; s < 4; s++) M.cyl(0.2 - s * 0.02, 0.24 - s * 0.02, hgt / 4, '#8a6a44', x + Math.sin(lean) * (s + 0.5) * hgt / 4, FLAT + (s + 0.5) * hgt / 4, z, 1, 1, 7);
      const tx = x + Math.sin(lean) * hgt, ty = FLAT + hgt;
      for (let f = 0; f < 7; f++) { const a = (f / 7) * Math.PI * 2; M.box(0.45, 0.06, 3.0, f % 2 ? '#3e8a3a' : '#4a9a40', tx + Math.sin(a) * 1.25, ty - 0.35, z + Math.cos(a) * 1.25, 0.45, a, 0); }
      M.sph(0.22, '#6b4a22', tx, ty - 0.25, z + 0.15, 1, 1, 1, 6);
      solid({ k: 'circ', x, z, r: 0.38, h: FLAT + hgt });
    }
    for (const [x, z] of HAY) {
      if (!onLand(x, z)) continue;
      M.cyl(0.0, 1.55, 2.2, '#d9b84f', x, FLAT + 1.1, z, 1, 1, 10);
      M.cyl(1.45, 1.5, 0.5, '#c9a63f', x, FLAT + 0.25, z, 1, 1, 10);
      solid({ k: 'circ', x, z, r: 1.25, h: FLAT + 2.0 });
    }
    for (const [x, z] of SHEDS) {                                       // a lean-to: three walls and a roof, open to the south
      if (!onLand(x, z, 0.04)) continue;
      const w = 3.2, d = 2.6, c = '#9a7a52';
      wall2(M, solid, x - w / 2, x + w / 2, z - d / 2 - 0.1, z - d / 2 + 0.1, c);
      wall2(M, solid, x - w / 2 - 0.1, x - w / 2 + 0.1, z - d / 2, z + d / 2, c);
      wall2(M, solid, x + w / 2 - 0.1, x + w / 2 + 0.1, z - d / 2, z + d / 2, c);
      M.box(w + 0.6, 0.12, d + 0.6, '#b5533c', x, FLAT + 2.6, z + 0.1, -0.08, 0, 0);
    }

    for (const [x, z] of TENTS) {
      if (!onLand(x, z, 0.04)) continue;
      M.box(0.06, 1.95, 2.7, '#d8c9a3', x + 0.6, FLAT + 0.77, z, 0, 0, 0.66);
      M.box(0.06, 1.95, 2.7, '#c0643a', x - 0.6, FLAT + 0.77, z, 0, 0, -0.66);
      M.box(2.3, 1.0, 0.06, '#b9a77f', x, FLAT + 0.55, z - 1.33);                         // the back
      M.box(0.1, 0.1, 2.9, '#5c3a1c', x, FLAT + 1.55, z);                                 // the ridge pole
      solid({ k: 'box', x0: x - 1.25, x1: x - 0.85, z0: z - 1.35, z1: z + 1.35, h: FLAT + 1.5 });
      solid({ k: 'box', x0: x + 0.85, x1: x + 1.25, z0: z - 1.35, z1: z + 1.35, h: FLAT + 1.5 });
      solid({ k: 'box', x0: x - 0.9, x1: x + 0.9, z0: z - 1.4, z1: z - 1.25, h: FLAT + 1.5 });
    }
    for (const [x, z] of BUSHES) {
      if (!onLand(x, z)) continue;
      M.sph(1.0, '#3e7a34', x, FLAT + 0.85, z, 1.15, 0.95, 1.15, 9);
      M.sph(0.8, '#4a8a3a', x + 0.5, FLAT + 1.2, z - 0.3, 1, 0.9, 1, 8);
      M.sph(0.75, '#356b2e', x - 0.5, FLAT + 1.05, z + 0.35, 1, 0.9, 1, 8);
      solid({ k: 'circ', x, z, r: 1.15, h: FLAT + 1.9 });
    }
    for (const [x0, x1, z0, z1] of RUIN) { if (onLand(x0, z0) && onLand(x1, z1)) wall2(M, solid, x0, x1, z0, z1, '#9a948a'); }
    for (const [x, z] of PILLARS) {
      if (!onLand(x, z)) continue;
      M.cyl(0.5, 0.55, 3.0, '#aaa497', x, FLAT + 1.5, z, 1, 1, 10); M.cyl(0.62, 0.62, 0.2, '#8a847a', x, FLAT + 3.05, z, 1, 1, 10);
      solid({ k: 'circ', x, z, r: 0.55, h: FLAT + 3.1 });
    }

    // ---- the hiding boxes: tall crates and barrels you can climb into
    const BC = ['#b8884a', '#a0522d', '#7a9a5a', '#5a7fa0', '#c9a050', '#8a5a8a'];
    BOXES.forEach(([x, z, kind], i) => {
      const g = new THREE.Group(); g.position.set(x, 0, z);
      const bm2 = new Mesher(), c = BC[i % BC.length], dk = '#3a2a1a';
      if (kind === 'crate') {
        bm2.box(1.3, 2.1, 1.3, c, 0, FLAT + 1.05, 0);
        bm2.box(1.4, 0.12, 1.4, dk, 0, FLAT + 2.15, 0);
        for (const y of [0.45, 1.05, 1.65]) bm2.box(1.34, 0.08, 1.34, dk, 0, FLAT + y, 0);
        bm2.box(0.5, 0.06, 0.04, '#1a120a', 0, FLAT + 1.5, 0.66);
        solid({ k: 'box', x0: x - 0.65, x1: x + 0.65, z0: z - 0.65, z1: z + 0.65, h: FLAT + 2.15 });
      } else {
        bm2.cyl(0.7, 0.7, 2.0, c, 0, FLAT + 1.0, 0, 1, 1, 14);
        for (const y of [0.25, 1.0, 1.75]) bm2.cyl(0.74, 0.74, 0.1, '#3a3a3a', 0, FLAT + y, 0, 1, 1, 14);
        bm2.cyl(0.72, 0.72, 0.08, dk, 0, FLAT + 2.02, 0, 1, 1, 14);
        solid({ k: 'circ', x, z, r: 0.72, h: FLAT + 2.05 });
      }
      const m = bm2.build(shadows); g.add(m); land.add(g);
      this.boxes.push({ x, z, kind, g });
    });
    const body = M.build(shadows); body.receiveShadow = shadows; land.add(body);

    this.group.visible = false;
    scene.add(this.group);
    this.hud = document.createElement('div');
    this.hud.style.cssText = 'position:fixed;left:50%;top:70px;transform:translateX(-50%);z-index:5;display:none;color:#fff;font:700 18px system-ui,sans-serif;text-align:center;text-shadow:0 1px 5px rgba(0,0,0,.8);pointer-events:none;letter-spacing:.03em';
    document.body.appendChild(this.hud);
  }

  private terrain() {
    const R = A + 22, sp = 1.6, n = Math.round((2 * R) / sp);
    const pos = new Float32Array((n + 1) * (n + 1) * 3), col = new Float32Array((n + 1) * (n + 1) * 3);
    const c = new THREE.Color(), sand = new THREE.Color('#e9d6a4'), wet = new THREE.Color('#bda878'), g1 = new THREE.Color('#6fa046'), g2 = new THREE.Color('#5d8f3b');
    const hash = (x: number, z: number) => { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); };
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      const x = -R + i * sp, z = -R + j * sp, h = baseH(x, z), m = mask(x, z), k = (j * (n + 1) + i) * 3;
      pos[k] = x; pos[k + 1] = h; pos[k + 2] = z;
      if (h < 0.05) c.copy(wet).multiplyScalar(0.8 + h * 0.03); else c.copy(wet).lerp(sand, sm(0, 0.5, h));
      c.lerp(g1.clone().lerp(g2, hash(Math.floor(x / 4), Math.floor(z / 4))), sm(0.17, 0.3, m) * 0.95);
      // a worn path from the beach door to the hut
      if (Math.abs(x) < 1.4 && z > 2 && z < 44) c.lerp(new THREE.Color('#b99c68'), 0.55);
      c.multiplyScalar(0.94 + hash(x, z) * 0.1);
      col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
    }
    const idx: number[] = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i, b = a + 1, d = a + n + 1, e = d + 1; idx.push(a, d, b, b, d, e); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere();
    return g;
  }

  // ------------------------------------------------------------ the player's cave-style ground
  contains(x: number, z: number, margin = 120) { return Math.abs(x - HX) < margin && Math.abs(z - HZ) < margin; }
  private boxCentre(i: number) { const b = this.boxes[i]; return { x: HX + b.x, z: HZ + b.z }; }
  floor(x: number, z: number, y: number) {
    const lx = x - HX, lz = z - HZ;
    let g = baseH(lx, lz);
    for (const s of this.solids) {
      if (s.gate || s.h - FLAT > 0.95) continue;
      const inside = s.k === 'circ' ? Math.hypot(lx - s.x, lz - s.z) < s.r : lx > s.x0 && lx < s.x1 && lz > s.z0 && lz < s.z1;
      if (inside && s.h <= y + 0.5 && s.h > g) g = s.h;
    }
    return g;
  }
  resolve(x: number, z: number, r: number, feetY: number, out: { x: number; z: number }) {
    if (this.hiddenMe >= 0) { const c = this.boxCentre(this.hiddenMe); out.x = c.x; out.z = c.z; return; }
    let px = x - HX, pz = z - HZ;
    if (mask(px, pz) < 0.1) {                                            // the sea: step back inland
      for (let k = 0; k < 40 && mask(px, pz) < 0.1; k++) {
        const gx = mask(px + 1, pz) - mask(px - 1, pz), gz = mask(px, pz + 1) - mask(px, pz - 1), l = Math.hypot(gx, gz) || 1;
        px += (gx / l) * 0.5; pz += (gz / l) * 0.5;
      }
    }
    for (let pass = 0; pass < 2; pass++) for (const s of this.solids) {
      if (s.gate && !(this.phase === 'hide')) continue;
      if (feetY >= s.h - 0.15) continue;
      if (s.k === 'circ') {
        const dx = px - s.x, dz = pz - s.z, d = Math.hypot(dx, dz), rr = r + s.r;
        if (d < rr) { const ux = d > 1e-4 ? dx / d : 1, uz = d > 1e-4 ? dz / d : 0; px = s.x + ux * rr; pz = s.z + uz * rr; }
      } else {
        const cx = Math.max(s.x0, Math.min(px, s.x1)), cz = Math.max(s.z0, Math.min(pz, s.z1)), dx = px - cx, dz = pz - cz, d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-8) { const d = Math.sqrt(d2); px = cx + (dx / d) * r; pz = cz + (dz / d) * r; }
        else {
          const l = px - s.x0, rr = s.x1 - px, t = pz - s.z0, bt = s.z1 - pz, m = Math.min(l, rr, t, bt);
          if (m === l) px = s.x0 - r; else if (m === rr) px = s.x1 + r; else if (m === t) pz = s.z0 - r; else pz = s.z1 + r;
        }
      }
    }
    out.x = px + HX; out.z = pz + HZ;
  }

  // ------------------------------------------------------------ coming and going
  enter(p: { teleport(x: number, y: number, z: number, yaw: number): void; cave: any }) {
    this.active = true; this.group.visible = true; p.cave = this;
    this.hiddenMe = -1;
    p.teleport(HX, FLAT, HZ + 39.5, 0);
    this.say(this.phase === 'idle' || this.phase === 'over' ? 'Hideaway Isle! Ring the bell by the path to start a round of hide and seek.' : 'A round is on! Hide... or if you are late, wait for the next one.');
  }
  leave(p: { cave: any }) {
    if (this.hiddenMe >= 0) this.setOcc(this.hiddenMe, false);
    this.hiddenMe = -1; this.active = false; this.group.visible = false; p.cave = null; this.hud.style.display = 'none';
    if (this.phase === 'hide' || this.phase === 'seek') this.foundMe = true;
  }
  exitSpot(): { x: number; z: number } { return { x: HX, z: HZ + 40 }; }

  // ------------------------------------------------------------ aiming
  private rayHit(eye: THREE.Vector3, dir: THREE.Vector3, cx: number, cy: number, cz: number, rad: number, reach: number, assist: number): number | null {
    const dx = cx - eye.x, dy = cy - eye.y, dz = cz - eye.z, t = dx * dir.x + dy * dir.y + dz * dir.z;
    if (t < 0 || t > reach) return null;
    const px = dx - dir.x * t, py = dy - dir.y * t, pz = dz - dir.z * t, r = rad * assist;
    return px * px + py * py + pz * pz <= r * r ? t : null;
  }
  private amSeeker() { return this.seeker === this.myId() && (this.phase === 'seek' || this.phase === 'hide'); }
  pick(eye0: { x: number; y: number; z: number }, dir0: { x: number; y: number; z: number }, reach: number, assist = 1): { t: HideTarget; dist: number } | null {
    const eye = _pe.set(eye0.x, eye0.y, eye0.z), dir = _pd.set(dir0.x, dir0.y, dir0.z);
    if (!this.active) return null;
    if (this.hiddenMe >= 0) return { t: { w: 'out' }, dist: 0 };
    if (this.phase === 'hide' && this.seeker === this.myId()) return null;          // counting in the hut
    reach = Math.max(reach, 3.2);
    let best: { t: HideTarget; dist: number } | null = null;
    const take = (t: HideTarget, d: number | null) => { if (d != null && (!best || d < best.dist)) best = { t, dist: d }; };
    take({ w: 'exit' }, this.rayHit(eye, dir, HX, FLAT + 1.2, HZ + 44, 1.2, reach + 1, assist));
    take({ w: 'bell' }, this.rayHit(eye, dir, HX + 4.3, FLAT + 1.6, HZ + 14, 1.0, reach + 1, assist));
    this.boxes.forEach((b, i) => take({ w: 'box', i }, this.rayHit(eye, dir, HX + b.x, FLAT + 1.0, HZ + b.z, 1.05, reach + 0.6, assist)));
    if (this.phase === 'seek' && this.seeker === this.myId()) {
      for (const o of this.others()) {
        if (!(o.flags & 128) || (o.flags & 256) || this.found.has(o.id) || !this.hiders.includes(o.id)) continue;
        take({ w: 'tag', id: o.id, name: o.name }, this.rayHit(eye, dir, o.x, o.y + 0.9, o.z, 0.95, reach, assist));
      }
    }
    return best;
  }
  prompt(t: HideTarget): { name: string; hint: string; ok: boolean } {
    switch (t.w) {
      case 'exit': return { name: 'Door home', hint: '<b>E</b> go back to the secret room', ok: true };
      case 'bell': return this.phase === 'hide' || this.phase === 'seek' ? { name: 'The bell', hint: 'A round is already going', ok: false } : { name: 'The bell', hint: '<b>E</b> ring it · start a round of hide & seek', ok: true };
      case 'out': return { name: 'Hiding spot', hint: '<b>E</b> climb out', ok: true };
      case 'tag': return { name: 'Player', hint: '<b>E</b> / click · tag - found you!', ok: true };
      case 'box': {
        const b = this.boxes[t.i], what = b.kind === 'crate' ? 'Tall crate' : 'Big barrel';
        if (this.amSeeker()) return this.phase === 'seek' ? { name: what, hint: '<b>E</b> open it and look inside', ok: true } : { name: what, hint: '', ok: false };
        if (this.occ.has(t.i)) return { name: what, hint: 'Somebody is hiding in there!', ok: false };
        if (this.foundMe && (this.phase === 'seek' || this.phase === 'hide')) return { name: what, hint: 'You were found - wait for the next round', ok: false };
        return { name: what, hint: '<b>E</b> climb inside and hide', ok: true };
      }
    }
  }
  interact(t: HideTarget, p: { teleport(x: number, y: number, z: number, yaw: number): void; yaw: number }): 'exit' | null {
    const me = this.myId();
    switch (t.w) {
      case 'exit': return 'exit';
      case 'bell': this.ring(); break;
      case 'out': this.climbOut(p); break;
      case 'tag': this.markFound(t.id, me, true); break;
      case 'box': {
        if (this.amSeeker()) {
          if (this.phase !== 'seek') break;
          const who = this.occ.get(t.i);
          const bot = this.bots.find((b) => b.box === t.i && !b.found);
          if (who !== undefined && !this.found.has(who)) this.markFound(who, me, true);
          else if (bot) this.botFound(bot);
          else this.say('Nobody in there.');
          break;
        }
        if (this.occ.has(t.i) || (this.foundMe && (this.phase === 'seek' || this.phase === 'hide'))) break;
        const c = this.boxCentre(t.i);
        this.hiddenMe = t.i; this.setOcc(t.i, true);
        p.teleport(c.x, FLAT, c.z, p.yaw);
        this.say('Hidden! Stay quiet. E to climb out.');
        break;
      }
    }
    return null;
  }
  private climbOut(p: { teleport(x: number, y: number, z: number, yaw: number): void; yaw: number }) {
    const i = this.hiddenMe; if (i < 0) return;
    this.hiddenMe = -1; this.setOcc(i, false);
    const c = this.boxCentre(i);
    p.teleport(c.x, FLAT, c.z + 1.6, p.yaw);
  }
  private setOcc(i: number, on: boolean) {
    if (on) this.occ.set(i, this.myId()); else this.occ.delete(i);
    this.send({ k: 'hb', i, on: on ? 1 : 0 });
  }

  // ------------------------------------------------------------ a round
  private ring() {
    if (this.phase === 'hide' || this.phase === 'seek') { this.say('A round is already going.'); return; }
    const me = this.myId();
    const ids = [me, ...this.others().filter((o) => o.flags & 128).map((o) => o.id)];
    const seeker = ids[Math.floor(Math.random() * ids.length)];
    const hiders = ids.filter((i) => i !== seeker);
    const bots: number[] = [];
    if (ids.length < 2) {                                                       // alone: three little bots hide in boxes
      const pool = this.boxes.map((_, i) => i).sort(() => Math.random() - 0.5);
      for (let k = 0; k < 3; k++) bots.push(pool[k]);
    }
    const e = { k: 'hs', n: Math.floor(Math.random() * 1e6) + 1, s: seeker, h: hiders, b: bots };
    this.bellT = 1; this.send(e); this.begin(e);
  }
  private begin(e: { n: number; s: number; h: number[]; b: number[] }) {
    this.rid = e.n; this.seeker = e.s; this.hiders = e.h.slice(); this.found.clear(); this.foundMe = false;
    for (const b of this.bots) b.fig.removeFromParent();
    this.bots = e.b.map((box, k) => {
      const fig = this.figure(BOT_COL[k % BOT_COL.length]), c = this.boxes[box];
      fig.position.set(c.x, 0, c.z); fig.visible = false; this.group.children[0].add(fig);
      return { name: BOT_NAMES[k % BOT_NAMES.length], box, found: false, fig, t: 0 };
    });
    this.phase = 'hide'; this.t = HIDE_T;
    this.setGate(true);
    const me = this.myId();
    if (this.seeker === me) {
      if (this.hiddenMe >= 0) { this.setOcc(this.hiddenMe, false); this.hiddenMe = -1; }
      this.pendingTeleport = true;
      this.say(`You are the seeker! Count to ${HIDE_T} in the hut while everybody hides.`);
    } else this.say(this.hiders.includes(me) ? `Hide! You have ${HIDE_T} seconds. Behind things, in sheds, or inside crates and barrels (E).` : 'A round started - you are watching.');
    if (!this.hiders.includes(me) && this.seeker !== me) this.foundMe = true;
  }
  /** the seeker's client moves them into the hut on the next frame */
  private pendingTeleport = false;
  private setGate(closed: boolean) { if (this.gate) this.gate.visible = closed; }

  markFound(id: number, by: number, announce: boolean) {
    if (this.found.has(id) || this.phase !== 'seek') return;
    this.found.add(id);
    if (announce) this.send({ k: 'hf', n: this.rid, t: id, by });
    
    if (id === this.myId()) { this.foundMe = true; this.pendingOut = true; this.say('The seeker found you!'); }
    else this.say(by === this.myId() ? 'You found a hider!' : 'The seeker found a hider.');
  }
  private pendingOut = false;
  private botFound(b: Bot) {
    b.found = true; b.fig.visible = true; b.fig.position.set(this.boxes[b.box].x, 0, this.boxes[b.box].z + 1.5); b.t = 0;
    this.say('You found a hider!');
  }
  private end(w: 's' | 'h') {
    if (this.phase === 'over' || this.phase === 'idle') return;
    this.phase = 'over'; this.t = OVER_T; this.setGate(false);
        this.resultLine = w === 's' ? `${this.seeker === this.myId() ? 'You found' : 'The seeker found'} everybody!` : 'Time is up - the hiders win!';
    this.say(this.resultLine);
    for (const b of this.bots) { b.fig.visible = true; b.fig.position.set(this.boxes[b.box].x, 0, this.boxes[b.box].z + 1.5); }
  }
  private remaining() {
    const alive = new Set(this.others().filter((o) => o.flags & 128).map((o) => o.id)); alive.add(this.myId());
    return this.hiders.filter((i) => alive.has(i) && !this.found.has(i)).length + this.bots.filter((b) => !b.found).length;
  }

  /** world events from the other players */
  net(e: any) {
    switch (e.k) {
      case 'hs': this.bellT = 1; if (this.active && (this.phase === 'idle' || this.phase === 'over')) this.begin(e); break;
      case 'hf': if (e.n === this.rid) this.markFound(e.t, e.by, false); break;
      case 'he': if (e.n === this.rid) this.end(e.w); break;
      case 'hb': if (e.on) this.occ.set(e.i, e.from ?? -1); else this.occ.delete(e.i); break;
    }
  }

  private figure(col: string) {
    const M = new Mesher();
    M.box(0.26, 0.7, 0.26, '#3b4a58', -0.12, 0.35, 0); M.box(0.26, 0.7, 0.26, '#3b4a58', 0.12, 0.35, 0);
    M.box(0.5, 0.65, 0.3, col, 0, 1.0, 0); M.sph(0.19, '#e8b88c', 0, 1.5, 0); M.box(0.14, 0.5, 0.14, col, -0.34, 1.05, 0); M.box(0.14, 0.5, 0.14, col, 0.34, 1.15, 0, 0, 0, 0.5);
    const g = new THREE.Group(); const m = M.build(this.shadows); g.add(m); g.position.y = FLAT; return g;
  }

  update(dt: number, p: { pos: { x: number; y: number; z: number; set(x: number, y: number, z: number): unknown }; vel: { x: number; y: number; z: number; set(x: number, y: number, z: number): unknown }; yaw: number; teleport(x: number, y: number, z: number, yaw: number): void }, time: number) {
    if (!this.active) return;
    if (this.bell) { this.bellT = Math.max(0, this.bellT - dt); this.bell.rotation.z = Math.sin(time * 18) * 0.3 * this.bellT; }
    if (this.hiddenMe >= 0) { const c = this.boxCentre(this.hiddenMe); p.pos.x = c.x; p.pos.z = c.z; p.vel.x = p.vel.z = 0; }
    if (this.pendingTeleport) { this.pendingTeleport = false; p.teleport(HX, FLAT, HZ, Math.PI); }
    if (this.pendingOut) { this.pendingOut = false; if (this.hiddenMe >= 0) this.climbOut(p as any); }
    for (const b of this.bots) if (b.found) { b.t += dt; b.fig.position.y = FLAT + Math.abs(Math.sin(b.t * 5)) * 0.18; b.fig.rotation.y = Math.PI + Math.sin(b.t * 2) * 0.3; }
    const mine = this.seeker === this.myId();
    if (this.phase === 'hide') {
      this.t -= dt;
      if (this.t <= 0) { this.phase = 'seek'; this.t = SEEK_T; this.setGate(false); this.say(mine ? 'Ready or not, here you come! Open crates and barrels with E, tag anyone you see.' : 'Here comes the seeker!'); }
    } else if (this.phase === 'seek') {
      this.t -= dt;
      if (this.remaining() <= 0 && (this.hiders.length + this.bots.length) > 0) { if (mine) this.send({ k: 'he', n: this.rid, w: 's' }); this.end('s'); }
      else if (this.t <= 0) this.end('h');
    } else if (this.phase === 'over') { this.t -= dt; if (this.t <= 0) { this.phase = 'idle'; } }
    // the little readout at the top of the screen
    const mm = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
    let txt = '';
    if (this.phase === 'hide') txt = mine ? `Counting… ${Math.ceil(this.t)}` : `Hide! ${Math.ceil(this.t)}`;
    else if (this.phase === 'seek') {
      const total = this.hiders.length + this.bots.length, left = this.remaining();
      txt = `${mine ? 'Seek' : this.foundMe ? 'Found' : 'Hide'} · ${total - left} of ${total} found · ${mm(this.t)}`;
    } else if (this.phase === 'over') txt = this.resultLine;
    this.hud.textContent = txt; this.hud.style.display = txt ? 'block' : 'none';
  }
  /** the seeker hears nothing while counting in the hut */
  get deaf() { return this.active && this.phase === 'hide' && this.seeker === this.myId(); }
  ringBell() { this.bellT = 1; }
  get seekerId() { return this.seeker; }
}

function wall2(M: Mesher, solid: (s: Solid) => Solid, x0: number, x1: number, z0: number, z1: number, c: string) {
  M.box(x1 - x0, 2.5, z1 - z0, c, (x0 + x1) / 2, FLAT + 1.25, (z0 + z1) / 2);
  solid({ k: 'box', x0, x1, z0, z1, h: FLAT + 2.5 });
}

const _pe = new THREE.Vector3(), _pd = new THREE.Vector3();
