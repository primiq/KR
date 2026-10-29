// The Chamber of Tiles: a steampunk metal hallway (reached through the copper door in the secret room) that ends in a big room
// floored with a 6x6 grid of metal tiles over a bottomless pit. When everybody is inside, the gate seals behind them. A screen
// on the far wall shows a symbol, the tiles light up with symbols, and after a countdown every tile that does NOT match drops
// into the pit - with anybody standing on it. Survivors get a fresh set of tiles. A button by the gate (everybody must press it)
// opens the way out again. All timing is driven by events from one "controller" (the lowest player id in here), everyone else follows.
// Babylon port: Castaway's code, drawn by render/mirror.ts.
import * as THREE from 'three';
import { Mesher } from '../net/playerModel';

export const TX = -6000, TZ = 0, BASE = 40;
const HALL_W = 2.2, HALL_END = 0.5, GATE_Z = -36;
const LEDGE_END = -37.5, ROOM_W = 9, ROOM_END = -55.5, TILE = 3, N = 6;
const WIN_ROUNDS = 10;
const SYMBOLS = ['●', '▲', '■', '◆', '★', '✚'];
const SYM_NAMES = ['Circle', 'Triangle', 'Square', 'Diamond', 'Star', 'Cross'];
const SYM_COL = ['#ff6b4a', '#ffd23f', '#3fd6ff', '#7dff6b', '#e86bff', '#ffffff'];

export type TrialTarget = { w: 'exit' } | { w: 'button' };
export interface TrialOther { id: number; name: string; x: number; y: number; z: number; flags: number }
export interface TrialSfx { tick(final: boolean): void; go(): void; seal(): void; drop(): void; fall(): void; win(): void; lose(): void; press(): void; crack(): void }

type Phase = 'idle' | 'seal' | 'rest' | 'pick' | 'drop';

const L = new THREE.Vector3(0.35, 0.85, 0.4).normalize();
/** paint a little directional shading into the vertex colours and use an unlit material: the room looks lit the same day or night */
function bake(m: THREE.Mesh) {
  const g = m.geometry, n = g.attributes.normal, c = g.attributes.color as THREE.BufferAttribute;
  for (let i = 0; i < c.count; i++) {
    const d = n.getX(i) * L.x + n.getY(i) * L.y + n.getZ(i) * L.z, k = 0.55 + 0.45 * (0.5 + 0.5 * d);
    c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
  }
  m.material = new THREE.MeshBasicMaterial({ vertexColors: true });
  m.frustumCulled = false;
  return m;
}
const bm = (M: Mesher) => bake(M.build(false));

function gearMesh(r: number, teeth: number, col: string, hub: string, thick = 0.3) {
  const M = new Mesher();
  M.cyl(r, r, thick, col, 0, 0, 0, 1, 1, 24, Math.PI / 2);
  M.cyl(r * 0.35, r * 0.35, thick * 1.6, hub, 0, 0, 0, 1, 1, 12, Math.PI / 2);
  for (let i = 0; i < teeth; i++) { const a = (i / teeth) * Math.PI * 2; M.box(r * 0.28, r * 0.22, thick, col, Math.cos(a) * r * 1.02, Math.sin(a) * r * 1.02, 0, 0, 0, a); }
  for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI; M.box(r * 1.7, r * 0.12, thick * 1.2, hub, 0, 0, 0, 0, 0, a); }
  return bm(M);
}

function symbolTex(sym: number | null) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#3b3f45'; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#8a6a3a'; g.lineWidth = 10; g.strokeRect(5, 5, 246, 246);
  g.fillStyle = '#6b7078'; for (const [x, y] of [[20, 20], [236, 20], [20, 236], [236, 236]]) { g.beginPath(); g.arc(x, y, 7, 0, 7); g.fill(); }
  if (sym !== null) {
    g.fillStyle = '#16181b'; g.fillRect(34, 34, 188, 188);
    g.shadowColor = SYM_COL[sym]; g.shadowBlur = 24; g.fillStyle = SYM_COL[sym];
    g.font = '700 150px system-ui, "Segoe UI Symbol", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(SYMBOLS[sym], 128, 136);
  } else {
    g.strokeStyle = '#555b63'; g.lineWidth = 3; g.beginPath(); g.moveTo(40, 128); g.lineTo(216, 128); g.moveTo(128, 40); g.lineTo(128, 216); g.stroke();
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

interface Tile { mesh: THREE.Mesh; sym: number; state: 'up' | 'shake' | 'fall' | 'gone'; ft: number; delay: number; vy: number; pop: number }

export class TileTrial {
  readonly group = new THREE.Group();
  active = false;
  /** wired by main */
  send: (e: any) => void = () => {};
  myId = () => 0;
  myName = () => 'You';
  others: () => TrialOther[] = () => [];
  say: (t: string) => void = () => {};
  /** hurt the player badly; returns true when they are really dead (god mode survives) */
  die: () => boolean = () => false;
  sfx: TrialSfx | null = null;

  phase: Phase = 'idle';
  private t = 0; private dur = 0; private round = 0; private target = 0;
  private grid: number[] = [];
  private tiles: Tile[] = [];
  private mats: THREE.Material[][] = [];
  private gateMesh: THREE.Group = new THREE.Group();
  private gateT = 0;
  private gears: { m: THREE.Mesh; s: number }[] = [];
  private screenTex: THREE.CanvasTexture;
  private screenCv: HTMLCanvasElement;
  private screenKey = '';
  private btnTex: THREE.CanvasTexture; private btnCv: HTMLCanvasElement; private btnKey = '';
  private btn: THREE.Mesh;
  private btnLamp: THREE.Mesh;
  private hud: HTMLDivElement;
  private pressed = new Set<number>();
  private died = new Set<number>();
  private fallen = false;
  private deadNames: string[] = [];
  private atDrop: number[] = [];
  private resolved = false;
  private outcome: 'next' | 'dead' | 'win' = 'next';
  private idleT = 0;
  private status = ''; private statusT = 0;
  private lastTick = -1;
  private reported = false;
  inRoom = false;

  constructor(scene: THREE.Scene) {
    // ------------------------------------------------------------ colours
    const steel = '#59606a', dark = '#2e3238', brass = '#b88a3c', copper = '#a8582c', rust = '#6b4a34', lamp = '#ffcf7a';
    const M = new Mesher();
    const W = HALL_W + 0.2, HL = HALL_END - GATE_Z;                      // hall length ~36.5
    // ---- hallway
    M.box(HALL_W * 2 + 0.6, 0.3, HL + 0.6, dark, 0, -0.15, (HALL_END + GATE_Z) / 2);
    for (let z = HALL_END - 1; z > GATE_Z; z -= 2) M.box(HALL_W * 2, 0.02, 0.06, '#1b1d20', 0, 0.005, z);
    for (const s of [-1, 1]) {
      M.box(0.3, 4.4, HL + 0.6, steel, s * W, 2.0, (HALL_END + GATE_Z) / 2);
      M.box(0.12, 0.3, HL, brass, s * (W - 0.2), 0.3, (HALL_END + GATE_Z) / 2);
      for (const y of [0.9, 2.9]) M.cyl(0.13, 0.13, HL, copper, s * (W - 0.3), y, (HALL_END + GATE_Z) / 2, 1, 1, 10, Math.PI / 2);
      M.cyl(0.2, 0.2, HL, rust, s * (W - 0.35), 3.4, (HALL_END + GATE_Z) / 2, 1, 1, 10, Math.PI / 2);
    }
    M.box(HALL_W * 2 + 0.6, 0.3, HL + 0.6, dark, 0, 4.0, (HALL_END + GATE_Z) / 2);
    for (let z = HALL_END - 2; z > GATE_Z; z -= 4) {                      // ribs, rivets, hanging lamps
      for (const s of [-1, 1]) M.box(0.3, 3.9, 0.35, brass, s * (W - 0.15), 1.95, z);
      M.box(HALL_W * 2, 0.35, 0.35, brass, 0, 3.75, z);
      for (const s of [-1, 1]) for (const y of [0.5, 1.6, 2.7]) M.sph(0.07, '#d9b25a', s * (W - 0.32), y, z + 0.2, 1, 1, 1, 5);
      M.box(0.06, 0.5, 0.06, dark, 0, 3.4, z + 2); M.sph(0.22, lamp, 0, 3.12, z + 2, 1, 1.3, 1, 8);
    }
    for (let z = HALL_END - 6; z > GATE_Z + 2; z -= 8) for (const s of [-1, 1]) {   // pressure gauges
      M.cyl(0.3, 0.3, 0.08, brass, s * (W - 0.34), 2.0, z, 1, 1, 14, 0, 0, Math.PI / 2 * s);
      M.cyl(0.24, 0.24, 0.09, '#e9e2c8', s * (W - 0.4), 2.0, z, 1, 1, 14, 0, 0, Math.PI / 2 * s);
      M.box(0.02, 0.2, 0.03, '#b01818', s * (W - 0.46), 2.06, z, 0, 0, 0.6);
    }
    // the start wall with the way home
    M.box(HALL_W * 2 + 0.6, 4.4, 0.4, steel, 0, 2.0, HALL_END + 0.2);
    M.box(1.5, 0.2, 0.3, brass, 0, 2.55, HALL_END - 0.05); for (const s of [-1, 1]) M.box(0.2, 2.6, 0.3, brass, s * 0.8, 1.3, HALL_END - 0.05);
    M.box(1.3, 2.4, 0.12, copper, 0, 1.2, HALL_END - 0.08); M.sph(0.1, '#e0c070', 0.45, 1.1, HALL_END - 0.2, 1, 1, 1, 8);
    // ---- the room
    const RW = ROOM_W + 0.3, RL = GATE_Z - ROOM_END, RZ = (GATE_Z + ROOM_END) / 2, RH = 11;
    M.box(ROOM_W * 2, 0.3, GATE_Z - LEDGE_END, '#4a5058', 0, -0.15, (GATE_Z + LEDGE_END) / 2);
    for (const s of [-1, 1]) M.box(0.4, RH + 40, RL + 0.6, steel, s * RW, (RH - 40) / 2, RZ);             // side walls, going all the way down the pit
    M.box(RW * 2 + 0.8, RH + 40, 0.4, steel, 0, (RH - 40) / 2, ROOM_END - 0.2);                           // far wall
    M.box(RW - HALL_W, RH + 40, 0.4, steel, -(HALL_W + (RW - HALL_W) / 2), (RH - 40) / 2, GATE_Z + 0.0);   // front wall either side of the doorway
    M.box(RW - HALL_W, RH + 40, 0.4, steel, HALL_W + (RW - HALL_W) / 2, (RH - 40) / 2, GATE_Z + 0.0);
    M.box(HALL_W * 2, RH - 4.2, 0.4, steel, 0, 4.2 + (RH - 4.2) / 2, GATE_Z);
    M.box(RW * 2 + 0.6, 0.4, RL + 0.8, dark, 0, RH, RZ);                                                    // ceiling
    for (let z = ROOM_END + 2; z < GATE_Z; z += 4) M.box(RW * 2, 0.5, 0.5, brass, 0, RH - 0.45, z);          // girders
    for (let x = -6; x <= 6; x += 6) M.box(0.5, 0.5, RL, '#8a6a30', x, RH - 0.9, RZ);
    for (const s of [-1, 1]) for (let z = ROOM_END + 3; z < GATE_Z; z += 6) M.box(0.45, RH, 0.5, brass, s * (RW - 0.2), RH / 2, z);
    for (const s of [-1, 1]) for (const z of [GATE_Z - 3, ROOM_END + 3]) {                                  // boilers in the corners (up on the wall ledges)
      M.cyl(1.0, 1.0, 5, copper, s * (RW - 1.0), 5.5, z, 1, 1, 16);
      for (const y of [3.4, 5.5, 7.6]) M.cyl(1.08, 1.08, 0.18, brass, s * (RW - 1.0), y, z, 1, 1, 16);
      M.sph(1.0, copper, s * (RW - 1.0), 8, z, 1, 0.6, 1, 14);
      M.cyl(0.35, 0.35, 3, rust, s * (RW - 1.0), 9.9, z, 1, 1, 10);
      M.box(2.2, 3.0, 2.2, dark, s * (RW - 1.0), 1.5, z);
    }
    // the pit: a lining of rivets down the walls and a furnace far below
    const pit = new Mesher();
    pit.box(ROOM_W * 2, 0.4, RL, '#201410', 0, -39, RZ);
    for (let i = 0; i < 16; i++) { const x = -8 + (i % 4) * 5.3, z = ROOM_END + 3 + Math.floor(i / 4) * 4.4; pit.cyl(0.0, 0.5, 2.4 + (i % 3), '#3a2a22', x, -37.6, z, 1, 1, 6); }
    for (const s of [-1, 1]) for (let y = -6; y > -38; y -= 6) pit.box(0.2, 0.3, RL, '#6a4a30', s * (ROOM_W - 0.05), y, RZ);
    const pitM = bm(pit);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W * 2, RL), new THREE.MeshBasicMaterial({ color: '#ff5a1c', transparent: true, opacity: 0.8 }));
    glow.rotation.x = -Math.PI / 2; glow.position.set(0, -38.7, RZ); glow.frustumCulled = false;
    this.group.add(bm(M), pitM, glow);

    // ---- gears, turning slowly on the walls
    const gearSpecs: [number, number, number, number, number, string][] = [
      [-RW + 0.3, 6.5, -42, 2.6, 0.12, brass], [-RW + 0.3, 5.5, -48.2, 1.8, -0.18, copper], [-RW + 0.3, 7.5, -51.5, 1.3, 0.25, brass],
      [RW - 0.3, 6.5, -45, 2.6, -0.12, copper], [RW - 0.3, 6.0, -51, 2.0, 0.17, brass], [RW - 0.3, 8.2, -39.5, 1.2, -0.3, copper],
    ];
    for (const [x, y, z, r, s, c] of gearSpecs) {
      const g = gearMesh(r, Math.round(r * 5), c, '#3b2c1e'); g.rotation.y = Math.PI / 2; g.position.set(x, y, z); this.group.add(g); this.gears.push({ m: g, s });
    }
    for (const [x, y, z, r, s] of [[-3, 3, -2.2, 0.5, 0.6], [3.4, 3.1, -9, 0.6, -0.5], [-3.3, 2.8, -20, 0.55, 0.7], [3.3, 3.2, -30, 0.5, -0.6]] as const) {
      const g = gearMesh(r * 1.4, 9, brass, '#3b2c1e', 0.15); g.rotation.y = Math.PI / 2; g.position.set(x, y, z); this.group.add(g); this.gears.push({ m: g, s });
    }

    // ---- the tiles
    for (let k = 0; k < 6; k++) this.mats.push(this.tileMats(symbolTex(k)));
    this.mats.push(this.tileMats(symbolTex(null)));
    const geo = new THREE.BoxGeometry(TILE - 0.08, 0.35, TILE - 0.08);
    for (let i = 0; i < N * N; i++) {
      const mesh = new THREE.Mesh(geo, this.mats[6] as any);
      const c = i % N, r = Math.floor(i / N);
      mesh.position.set(-ROOM_W + TILE * (c + 0.5), -0.175, LEDGE_END - TILE * (r + 0.5)); mesh.frustumCulled = false;
      this.group.add(mesh);
      this.tiles.push({ mesh, sym: -1, state: 'up', ft: 0, delay: 0, vy: 0, pop: 1 });
    }

    // ---- the gate (a big slab that drops into the doorway)
    const gm = new Mesher();
    gm.box(HALL_W * 2, 4.2, 0.35, '#4a5058', 0, 2.1, 0);
    for (const y of [0.3, 1.5, 2.7, 3.9]) gm.box(HALL_W * 2 + 0.1, 0.22, 0.45, brass, 0, y, 0);
    for (const x of [-1.6, 0, 1.6]) gm.box(0.2, 4.2, 0.45, '#3c4046', x, 2.1, 0);
    for (const x of [-1.2, 1.2]) for (const y of [0.9, 2.1, 3.3]) gm.sph(0.1, '#d9b25a', x, y, 0.25, 1, 1, 1, 6);
    gm.cyl(0.0, 0.0, 0.01, brass, 0, 0, 0);
    this.gateMesh.add(bm(gm));
    const gg = gearMesh(0.7, 10, brass, '#3b2c1e', 0.2); gg.position.set(0, 2.1, 0.3); this.gateMesh.add(gg); this.gears.push({ m: gg, s: 0.4 });
    this.gateMesh.position.set(0, 4.5, GATE_Z); this.group.add(this.gateMesh);

    // ---- the screen on the far wall
    this.screenCv = document.createElement('canvas'); this.screenCv.width = 1024; this.screenCv.height = 576;
    this.screenTex = new THREE.CanvasTexture(this.screenCv); this.screenTex.colorSpace = THREE.SRGBColorSpace;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(11, 6.2), new THREE.MeshBasicMaterial({ map: this.screenTex }));
    screen.position.set(0, 6.4, ROOM_END + 0.05); screen.frustumCulled = false; this.group.add(screen);
    const fm = new Mesher();
    fm.box(11.8, 0.4, 0.3, brass, 0, 9.7, ROOM_END + 0.1); fm.box(11.8, 0.4, 0.3, brass, 0, 3.1, ROOM_END + 0.1);
    for (const s of [-1, 1]) fm.box(0.4, 6.6, 0.3, brass, s * 5.8, 6.4, ROOM_END + 0.1);
    for (const s of [-1, 1]) for (const y of [3.4, 9.4]) fm.sph(0.14, '#e9d28a', s * 5.4, y, ROOM_END + 0.3, 1, 1, 1, 6);
    this.group.add(bm(fm));

    // ---- the exit button beside the gate (room side)
    const bx = new Mesher();
    bx.box(0.9, 1.3, 0.2, '#3c4046', 3.8, 1.5, GATE_Z - 0.3); bx.box(1.0, 1.4, 0.1, brass, 3.8, 1.5, GATE_Z - 0.22);
    bx.cyl(0.26, 0.3, 0.2, '#6a4a30', 3.8, 1.2, GATE_Z - 0.45, 1, 1, 14, Math.PI / 2);
    this.group.add(bm(bx));
    this.btn = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.18, 16), new THREE.MeshBasicMaterial({ color: '#c0392b' }));
    this.btn.rotation.x = Math.PI / 2; this.btn.position.set(3.8, 1.2, GATE_Z - 0.58); this.btn.frustumCulled = false; this.group.add(this.btn);
    this.btnLamp = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshBasicMaterial({ color: '#552211' }));
    this.btnLamp.position.set(3.8, 1.85, GATE_Z - 0.4); this.group.add(this.btnLamp);
    this.btnCv = document.createElement('canvas'); this.btnCv.width = 256; this.btnCv.height = 96;
    this.btnTex = new THREE.CanvasTexture(this.btnCv); this.btnTex.colorSpace = THREE.SRGBColorSpace;
    const bp = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.34), new THREE.MeshBasicMaterial({ map: this.btnTex })); bp.position.set(3.8, 1.55, GATE_Z - 0.4); bp.rotation.y = Math.PI; this.group.add(bp);
    const sign = this.plate(['THE CHAMBER OF TILES', 'stand on the symbol'], 4.2, 1.0, '#2b1e15', '#e0c070'); sign.position.set(0, 2.9, HALL_END - 0.3); sign.rotation.y = 0; this.group.add(sign);
    const sign2 = this.plate(['ALL CHALLENGERS', 'must enter the chamber'], 3.2, 0.9, '#2b1e15', '#e0c070'); sign2.position.set(0, 3.0, GATE_Z + 0.25); this.group.add(sign2);
    const home = this.plate(['← home'], 1.2, 0.4, '#2b1e15', '#e0c070'); home.position.set(0, 2.85, HALL_END - 0.25); this.group.add(home);

    this.group.position.set(TX, BASE, TZ);
    this.group.visible = false;
    scene.add(this.group);
    this.hud = document.createElement('div');
    this.hud.style.cssText = 'position:fixed;left:50%;top:70px;transform:translateX(-50%);z-index:5;display:none;color:#ffe9b0;font:700 20px system-ui,sans-serif;text-align:center;text-shadow:0 1px 6px rgba(0,0,0,.9);pointer-events:none;letter-spacing:.03em;max-width:90vw';
    document.body.appendChild(this.hud);
    this.drawScreen(); this.drawBtn();
  }

  private plate(text: string[], w: number, h: number, bg: string, fg: string) {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = Math.round(512 * (h / w));
    const g = cv.getContext('2d')!;
    g.fillStyle = bg; g.fillRect(0, 0, cv.width, cv.height); g.strokeStyle = fg; g.lineWidth = 8; g.strokeRect(6, 6, cv.width - 12, cv.height - 12);
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    const lh = cv.height / (text.length + 0.5);
    text.forEach((t, i) => { g.font = `700 ${Math.round(lh * 0.6)}px system-ui, sans-serif`; g.fillText(t, cv.width / 2, lh * (i + 0.75)); });
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })); m.frustumCulled = false; return m;
  }
  private tileMats(top: THREE.Texture): THREE.Material[] {
    const side = new THREE.MeshBasicMaterial({ color: '#4b5159' }), bottom = new THREE.MeshBasicMaterial({ color: '#25282c' });
    return [side, side, new THREE.MeshBasicMaterial({ map: top }), bottom, side, side];
  }

  // ------------------------------------------------------------ the player's cave-style ground
  contains(x: number, z: number) { return Math.abs(x - TX) < 80 && z - TZ > -110 && z - TZ < 40; }
  private tileAt(lx: number, lz: number) {
    if (lz > LEDGE_END || lz < ROOM_END || Math.abs(lx) >= ROOM_W) return -1;
    return Math.floor((lz - LEDGE_END) / -TILE) * N + Math.floor((lx + ROOM_W) / TILE);
  }
  private gateClosed() { return this.gateT > 0.5; }
  floor(x: number, z: number, _y: number) {
    const lx = x - TX, lz = z - TZ;
    if (lz > LEDGE_END) return BASE;                                     // hall and the ledge inside the gate
    const t = this.tileAt(lx, lz);
    if (t < 0) return BASE - 90;
    const s = this.tiles[t].state;
    return s === 'up' || s === 'shake' ? BASE : BASE - 90;
  }
  resolve(x: number, z: number, r: number, _feetY: number, out: { x: number; z: number }) {
    const lx = x - TX, lz = z - TZ, k = r * 0.5, closed = this.gateClosed();
    const rects = [
      { x0: -HALL_W + k, x1: HALL_W - k, z0: (closed ? GATE_Z + 0.5 : GATE_Z - 0.3) + k, z1: HALL_END - k },
      { x0: -ROOM_W + k, x1: ROOM_W - k, z0: ROOM_END + k, z1: (closed ? GATE_Z - 0.4 : GATE_Z + 0.3) - k },
    ];
    let bx = lx, bz = lz, bd = 1e9;
    for (const q of rects) {
      const cx = Math.max(q.x0, Math.min(lx, q.x1)), cz = Math.max(q.z0, Math.min(lz, q.z1)), d = (cx - lx) ** 2 + (cz - lz) ** 2;
      if (d < bd) { bd = d; bx = cx; bz = cz; }
    }
    out.x = bx + TX; out.z = bz + TZ;
  }

  // ------------------------------------------------------------ roster and flow control
  enter(p: { teleport(x: number, y: number, z: number, yaw: number): void; cave: any }) {
    this.active = true; this.group.visible = true; p.cave = this;
    p.teleport(TX, BASE, TZ - 2.6, 0);
    this.reported = false;
    this.say(this.phase === 'idle' ? 'A long hallway... walk to the end. Everybody has to go in together.' : 'A game is in progress - the gate is sealed. Wait for it to finish.');
  }
  leave(p: { cave: any }) { this.active = false; this.group.visible = false; p.cave = null; this.hud.style.display = 'none'; this.inRoom = false; this.fallen = false; this.send({ k: 'tb', on: 0, all: 1 }); }
  exitSpot() { return { x: TX, z: TZ - 2.6 }; }
  private roster() {
    const ids = [this.myId()];
    for (const o of this.others()) if (o.flags & 512) ids.push(o.id);
    return ids.sort((a, b) => a - b);
  }
  private inRoomIds() {
    const ids: number[] = this.inRoom ? [this.myId()] : [];
    for (const o of this.others()) if ((o.flags & 512) && (o.flags & 1024)) ids.push(o.id);
    return ids.sort((a, b) => a - b);
  }
  private isCtl() { return this.roster()[0] === this.myId(); }

  // ------------------------------------------------------------ aiming
  private rayHit(eye: THREE.Vector3, dir: THREE.Vector3, cx: number, cy: number, cz: number, rad: number, reach: number, assist: number): number | null {
    const dx = cx - eye.x, dy = cy - eye.y, dz = cz - eye.z, t = dx * dir.x + dy * dir.y + dz * dir.z;
    if (t < 0 || t > reach) return null;
    const px = dx - dir.x * t, py = dy - dir.y * t, pz = dz - dir.z * t, r = rad * assist;
    return px * px + py * py + pz * pz <= r * r ? t : null;
  }
  pick(eye0: { x: number; y: number; z: number }, dir0: { x: number; y: number; z: number }, reach: number, assist = 1): { t: TrialTarget; dist: number } | null {
    const eye = _pe.set(eye0.x, eye0.y, eye0.z), dir = _pd.set(dir0.x, dir0.y, dir0.z);
    if (!this.active) return null;
    reach = Math.max(reach, 3.2);
    let best: { t: TrialTarget; dist: number } | null = null;
    const home = this.rayHit(eye, dir, TX, BASE + 1.2, TZ + HALL_END - 0.2, 1.3, reach + 1, assist);
    if (home != null) best = { t: { w: 'exit' }, dist: home };
    const b = this.rayHit(eye, dir, TX + 3.8, BASE + 1.4, TZ + GATE_Z - 0.5, 0.9, reach + 1, assist);
    if (b != null && (!best || b < best.dist)) best = { t: { w: 'button' }, dist: b };
    return best;
  }
  prompt(t: TrialTarget): { name: string; hint: string; ok: boolean } {
    if (t.w === 'exit') return { name: 'Copper door', hint: '<b>E</b> back to the secret room', ok: true };
    if (!this.inRoom) return { name: 'Exit button', hint: 'It is on the other side of the gate', ok: false };
    if (this.phase === 'idle') return { name: 'Exit button', hint: 'The gate is already open', ok: false };
    const need = this.inRoomIds().length, have = this.inRoomIds().filter((i) => this.pressed.has(i)).length;
    return this.pressed.has(this.myId())
      ? { name: 'Exit button', hint: `Pressed · waiting for everybody (${have}/${need}) · <b>E</b> cancel`, ok: true }
      : { name: 'Exit button', hint: `<b>E</b> press · everybody must press it (${have}/${need}) to open the gate`, ok: true };
  }
  interact(t: TrialTarget): 'exit' | null {
    if (t.w === 'exit') return 'exit';
    if (!this.inRoom || this.phase === 'idle') return null;
    const on = !this.pressed.has(this.myId());
    this.setPressed(this.myId(), on); this.send({ k: 'tb', on: on ? 1 : 0 }); this.sfx?.press();
    return null;
  }
  private setPressed(id: number, on: boolean) { if (on) this.pressed.add(id); else this.pressed.delete(id); }

  // ------------------------------------------------------------ events
  net(e: any, from: number) {
    switch (e.k) {
      case 'tp': this.apply(e); break;
      case 'td': if (e.n === this.round) { this.died.add(from); this.deadNames.push(e.name ?? 'Somebody'); } break;
      case 'tx': this.setStatus(e.text, 7); break;
      case 'tb': if (e.all) { this.pressed.delete(from); } else this.setPressed(from, !!e.on); this.btnKey = ''; break;
    }
  }
  private setStatus(t: string, secs: number) { this.status = t; this.statusT = secs; if (this.active) this.say(t); this.screenKey = ''; }
  private broadcast(e: any) { this.send(e); this.apply(e); }

  private apply(e: { ph: Phase | 'open'; n?: number; dur?: number; sym?: number; grid?: number[] }) {
    if (e.ph === 'open') { this.phase = 'idle'; this.t = 0; this.pressed.clear(); this.resetTiles(); this.resetRound(); this.sfx?.seal(); return; }
    this.phase = e.ph; this.dur = e.dur ?? 0; this.t = this.dur; this.lastTick = -1; this.screenKey = '';
    if (e.n !== undefined && e.n !== this.round) { this.round = e.n; this.died.clear(); this.deadNames = []; this.resolved = false; this.reported = false; }
    switch (e.ph) {
      case 'seal': this.round = 0; this.pressed.clear(); this.resetTiles(); this.sfx?.seal(); this.setStatus('The gate seals behind you!', 4); break;
      case 'rest': this.sfx?.go(); break;
      case 'pick':
        this.target = e.sym ?? 0; this.grid = e.grid ?? [];
        this.tiles.forEach((t, i) => { t.sym = this.grid[i] ?? 0; t.state = 'up'; t.mesh.visible = true; t.mesh.position.y = -0.175; t.mesh.rotation.set(0, 0, 0); t.pop = 0; t.mesh.material = this.mats[t.sym] as any; });
        this.sfx?.go(); break;
      case 'drop':
        this.atDrop = this.inRoomIds(); this.resolved = false;
        this.tiles.forEach((t) => { if (t.sym !== this.target) { t.state = 'shake'; t.ft = 0; t.delay = 1.3 + Math.random() * 0.7; } });
        this.sfx?.drop(); break;
    }
  }
  private resetTiles() { this.tiles.forEach((t) => { t.sym = -1; t.state = 'up'; t.mesh.visible = true; t.mesh.position.set(t.mesh.position.x, -0.175, t.mesh.position.z); t.mesh.rotation.set(0, 0, 0); t.mesh.material = this.mats[6] as any; t.pop = 1; }); }
  private resetRound() { this.round = 0; this.died.clear(); this.deadNames = []; this.resolved = false; }

  // ------------------------------------------------------------ the controller's moves
  private newGrid(n: number) {
    const target = Math.floor(Math.random() * 6), k = Math.max(3, 8 - n), grid: number[] = [];
    const idx = Array.from({ length: N * N }, (_, i) => i).sort(() => Math.random() - 0.5), others = [0, 1, 2, 3, 4, 5].filter((s) => s !== target);
    idx.forEach((tile, j) => { grid[tile] = j < k ? target : others[Math.floor(Math.random() * others.length)]; });
    return { target, grid };
  }
  private nextRound(n: number) { this.broadcast({ k: 'tp', ph: 'rest', n, dur: n === 1 ? 6 : 5 }); }

  update(dt: number, p: { pos: { x: number; y: number; z: number; set(x: number, y: number, z: number): unknown }; vel: { x: number; y: number; z: number; set(x: number, y: number, z: number): unknown }; yaw: number; teleport(x: number, y: number, z: number, yaw: number): void }, time: number) {
    if (!this.active) return;
    const lz = p.pos.z - TZ;
    this.inRoom = lz < GATE_Z - 0.9 && Math.abs(p.pos.x - TX) < ROOM_W;
    // gears and the gate
    for (const g of this.gears) g.m.rotation.z += g.s * dt;
    const goal = this.phase === 'idle' ? 0 : 1;
    this.gateT += Math.sign(goal - this.gateT) * Math.min(Math.abs(goal - this.gateT), dt * 0.7);
    this.gateMesh.position.y = 4.5 - this.gateT * 4.5;
    // tiles
    for (const t of this.tiles) {
      if (t.pop < 1) { t.pop = Math.min(1, t.pop + dt * 3); t.mesh.scale.setScalar(0.4 + 0.6 * t.pop); } else if (t.mesh.scale.x !== 1) t.mesh.scale.setScalar(1);
      if (t.state === 'shake') {
        t.ft += dt; t.mesh.position.y = -0.175 + Math.sin(time * 70) * 0.025; t.mesh.rotation.z = Math.sin(time * 55) * 0.012;
        if (t.ft >= t.delay) { t.state = 'fall'; t.vy = 0; this.sfx?.crack(); }
      } else if (t.state === 'fall') {
        t.vy -= 14 * dt; t.mesh.position.y += t.vy * dt; t.mesh.rotation.x += dt * 1.6; t.mesh.rotation.z += dt * 0.9;
        if (t.mesh.position.y < -42) { t.state = 'gone'; t.mesh.visible = false; }
      }
    }
    // my own fate: off the edge of the world means the pit
    if (this.inRoom || p.pos.y < BASE - 1) {
      if (p.pos.y < BASE - 7 && !this.reported) {
        this.reported = true; this.sfx?.fall();
        this.send({ k: 'td', n: this.round, name: this.myName() }); this.died.add(this.myId()); this.deadNames.push(this.myName());
        // nobody dies here: whoever falls waits on the ledge and is put back on the tiles when the next round is ready
        p.teleport(TX, BASE, TZ + GATE_Z - 0.8, Math.PI); p.vel.set(0, 0, 0); this.fallen = true;
        this.say('You fell! You will be back on the tiles when the next round is ready.');
      }
    }
    if (this.fallen && this.phase === 'pick' && this.t > 0.5) {
      const up = this.tiles.filter((t) => t.state === 'up'), t = up[Math.floor(Math.random() * up.length)];
      if (t) { p.teleport(TX + t.mesh.position.x, BASE, TZ + t.mesh.position.z, Math.PI); p.vel.set(0, 0, 0); this.reported = false; this.fallen = false; this.sfx?.go(); }
    }
    if (this.fallen && this.phase === 'idle') this.fallen = false;
    // countdown clicks
    if (this.phase !== 'idle') {
      this.t -= dt;
      const c = Math.ceil(this.t);
      if (c !== this.lastTick && c >= 1 && c <= (this.phase === 'pick' ? 5 : this.phase === 'rest' || this.phase === 'seal' ? 3 : 0)) { this.lastTick = c; this.sfx?.tick(c === 1); }
    }
    if (this.statusT > 0) { this.statusT -= dt; if (this.statusT <= 0) { this.status = ''; this.screenKey = ''; } }
    // ---- the controller drives the rounds
    if (this.isCtl()) {
      const inIds = this.inRoomIds(), all = this.roster();
      if (this.phase === 'idle') {
        if (this.inRoom && all.every((i) => inIds.includes(i)) && lz < GATE_Z - 2.4) { this.idleT += dt; if (this.idleT > 1.5) { this.idleT = 0; this.broadcast({ k: 'tp', ph: 'seal', dur: 3 }); } } else this.idleT = 0;
      } else {
        if (inIds.length > 0 && inIds.every((i) => this.pressed.has(i))) { this.broadcast({ k: 'tp', ph: 'open' }); this.setStatusAll('The gate grinds open.'); return this.updateUi(); }
        if (this.t <= 0 && this.phase === 'seal') this.nextRound(1);
        else if (this.t <= 0 && this.phase === 'rest') { const { target, grid } = this.newGrid(this.round); this.broadcast({ k: 'tp', ph: 'pick', n: this.round, sym: target, grid, dur: Math.max(5, 10 - (this.round - 1) * 0.5) }); }
        else if (this.t <= 0 && this.phase === 'pick') this.broadcast({ k: 'tp', ph: 'drop', n: this.round, dur: 5 });
        else if (this.phase === 'drop') {
          if (!this.resolved && this.t <= this.dur - 3.6) this.settleRound();
          if (this.t <= 0) {
            if (this.outcome === 'next') this.nextRound(this.round + 1);
            else { this.broadcast({ k: 'tp', ph: 'open' }); }
          }
        }
      }
    }
    this.updateUi();
  }
  private setStatusAll(t: string) { this.send({ k: 'tx', text: t }); this.setStatus(t, 6); }
  private settleRound() {
    this.resolved = true;
    const alive = this.atDrop.filter((i) => !this.died.has(i)), names = [...new Set(this.deadNames)];
    let text: string;
    if (names.length === 0) text = `Round ${this.round}: everybody survived!`;
    else text = `Round ${this.round}: ${names.join(' and ')} fell into the pit - they are back next round!`;
    if (alive.length === 0 && this.round >= WIN_ROUNDS) { text += ' Nobody is left standing.'; this.outcome = 'dead'; this.sfx?.lose(); }
    else if (alive.length === 0) { text += ' Nobody is left standing - everybody gets another go!'; this.outcome = 'next'; this.sfx?.lose(); }
    else if (this.round >= WIN_ROUNDS) { text += ` The chamber is conquered after ${WIN_ROUNDS} rounds!`; this.outcome = 'win'; this.sfx?.win(); }
    else { this.outcome = 'next'; if (names.length) this.sfx?.lose(); else this.sfx?.win(); }
    this.setStatusAll(text);
  }

  // ------------------------------------------------------------ the screen, the button and the readout
  private updateUi() {
    const key = `${this.phase}|${Math.ceil(this.t)}|${this.round}|${this.target}|${this.status}|${this.roster().length}|${this.inRoomIds().length}`;
    if (key !== this.screenKey) { this.screenKey = key; this.drawScreen(); }
    const bk = `${this.pressed.size}|${this.inRoomIds().length}|${this.phase}`;
    if (bk !== this.btnKey) { this.btnKey = bk; this.drawBtn(); }
    let txt = this.status;
    if (!txt) {
      if (this.phase === 'pick') txt = `Round ${this.round} · stand on ${SYMBOLS[this.target]} ${SYM_NAMES[this.target]} · ${Math.ceil(this.t)}`;
      else if (this.phase === 'rest') txt = `Round ${this.round} starts in ${Math.ceil(this.t)}`;
      else if (this.phase === 'idle' && this.inRoom) txt = 'Waiting for everybody to enter the chamber…';
    }
    this.hud.textContent = txt; this.hud.style.display = txt ? 'block' : 'none';
  }
  private drawBtn() {
    const g = this.btnCv.getContext('2d')!, need = this.inRoomIds().length;
    g.fillStyle = '#2b1e15'; g.fillRect(0, 0, 256, 96); g.strokeStyle = '#e0c070'; g.lineWidth = 6; g.strokeRect(4, 4, 248, 88);
    g.fillStyle = '#e0c070'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '700 38px system-ui, sans-serif';
    g.fillText(this.phase === 'idle' ? 'EXIT · OPEN' : `EXIT ${this.inRoomIds().filter((i) => this.pressed.has(i)).length}/${Math.max(need, 1)}`, 128, 50);
    this.btnTex.needsUpdate = true;
    (this.btnLamp.material as THREE.MeshBasicMaterial).color.set(this.pressed.size > 0 ? '#7dff6b' : '#552211');
  }
  private drawScreen() {
    const g = this.screenCv.getContext('2d')!, W = 1024, H = 576;
    g.fillStyle = '#0d1410'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#2a6a3a'; g.lineWidth = 3; for (let y = 0; y < H; y += 8) { g.globalAlpha = 0.08; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); } g.globalAlpha = 1;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const big = (t: string, y: number, col: string, size = 64) => { g.fillStyle = col; g.shadowColor = col; g.shadowBlur = 18; g.font = `700 ${size}px system-ui, "Segoe UI Symbol", sans-serif`; g.fillText(t, W / 2, y); g.shadowBlur = 0; };
    if (this.phase === 'pick' || this.phase === 'drop') {
      big(SYMBOLS[this.target], 230, SYM_COL[this.target], 280);
      big(`${SYM_NAMES[this.target].toUpperCase()}`, 400, SYM_COL[this.target], 54);
      if (this.phase === 'pick') big(String(Math.max(0, Math.ceil(this.t))), 70, this.t <= 3 ? '#ff5a3a' : '#ffe9b0', 80);
      else big('!!!', 70, '#ff5a3a', 80);
      g.fillStyle = '#8fd7a0'; g.font = '600 30px system-ui, sans-serif'; g.fillText(`ROUND ${this.round}`, 110, 40);
    } else if (this.phase === 'rest') { big(`ROUND ${this.round}`, 190, '#ffe9b0', 110); big(`in ${Math.max(0, Math.ceil(this.t))}`, 340, '#8fd7a0', 120); }
    else if (this.phase === 'seal') { big('SEALING', 220, '#ff9a3a', 120); big('the gate closes behind you', 350, '#ffe9b0', 44); }
    else { big('CHAMBER OF TILES', 190, '#ffe9b0', 84); big(`${this.inRoomIds().length} of ${this.roster().length} challengers inside`, 320, '#8fd7a0', 46); big('everyone must enter', 390, '#8fd7a0', 36); }
    if (this.status) {
      g.fillStyle = 'rgba(0,0,0,0.65)'; g.fillRect(0, H - 150, W, 150);
      g.fillStyle = '#ffd27a'; g.font = '700 38px system-ui, sans-serif'; g.textBaseline = 'top';
      const words = this.status.split(' '); let line = '', y = H - 140;
      for (const w of words) { const t = line ? line + ' ' + w : w; if (g.measureText(t).width > W - 80 && line) { g.fillText(line, W / 2, y); y += 46; line = w; } else line = t; }
      g.fillText(line, W / 2, y);
    }
    this.screenTex.needsUpdate = true;
  }
}

const _pe = new THREE.Vector3(), _pd = new THREE.Vector3();
