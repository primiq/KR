// Mission 1: The Odd Shopping List, at Bootle's Chemist (a big, bright, slightly odd high-street chemist).
// Find five silly items, put them on the till belt, then find five $1 coins and drop them on the till tray.
// Every hiding place is built for one animal or for both together:
//   sardines   - at the back of the meal deal fridge: a gorilla hauls the heavy door open, a cat crawls in under the shelves
//   bubble bath- on top of the tall pharmacy cabinet: a gorilla reaches up (or tosses a cat up)
//   glitter    - in a box in the stockroom taped shut: a gorilla rips it open
//   mouthwash  - under the raised toiletries shelf: only a cat fits
//   fluffy sock- deep in the air duct: a gorilla pulls the grille off, a cat climbs in (tossed, or from a crate the gorilla carried over)
//   coins: shake the vending machine (gorilla), under a pallet-blocked cupboard (gorilla moves the pallet, cat crawls in),
//          under the photo booth seat (cat), in the bottom box of a stack (gorilla lifts the top boxes off, cat goes in the flap),
//          in the pick'n'mix (anybody).
// Alone, or with only one kind of animal? The helper rules (types.ts Ctx.helper) let you do the missing animal's jobs.
import * as THREE from 'three';
import { Mesher } from '../net/playerModel';
import { Space, bake, Board, sign, rayHit } from './space';
import { Grabs, type Grab } from './grab';
import type { Ctx, Mission, MTarget } from './types';
import { missionX } from './campaign';
import { door } from './rooms';

const OX = missionX(0), OY = 40, OZ = 0;
const ITEMS = [
  { key: 'sardines', name: 'Tin of sardines', icon: '🐟' },
  { key: 'bubble', name: 'Bubble bath', icon: '🛁' },
  { key: 'glitter', name: 'Jar of glitter', icon: '✨' },
  { key: 'mouthwash', name: 'Travel mouthwash', icon: '🧴' },
  { key: 'sock', name: 'One fluffy sock', icon: '🧦' },
];
const BELT = { x0: -9.7, x1: -6.4, z0: 6.35, z1: 7.65, y0: 0.85, y1: 1.9 };
const TRAY = { x0: -6.25, x1: -5.15, z0: 6.45, z1: 7.55, y0: 0.85, y1: 1.9 };
/** where the cashier will take a coin from once you owe the money: anywhere on the counter (tray, belt, by the till) or on the
 *  floor right in front of it. Only an E-drop snaps onto the tray; a throw or a VR hand letting go can stop just beside it. */
const PAYABLE = { x0: -10.2, x1: -4.3, z0: 5.5, z1: 8.0, y0: -0.2, y1: 1.9 };
const FRIDGE = { x0: -12, x1: -10.8, z0: -6, z1: -2 };
const HINT_EVERY = 70;

type Prop = 'fridge' | 'tape' | 'grille' | 'stack' | 'vend';

function itemMesh(kind: string): THREE.Group {
  const M = new Mesher();
  switch (kind) {
    case 'sardines': M.cyl(0.11, 0.11, 0.05, '#9fb4c8', 0, 0.025, 0, 1.4, 0.8, 14); M.cyl(0.1, 0.1, 0.052, '#2f5f8a', 0, 0.026, 0, 1.38, 0.78, 14); M.box(0.06, 0.012, 0.02, '#d8d8d8', 0.1, 0.055, 0); break;
    case 'bubble': M.cyl(0.07, 0.08, 0.24, '#ff7fc8', 0, 0.12, 0, 1, 0.7, 12); M.cyl(0.03, 0.03, 0.06, '#fff', 0, 0.27, 0, 1, 1, 8); M.sph(0.035, '#ffd6f0', 0.05, 0.32, 0.03); M.sph(0.025, '#ffe6f6', -0.04, 0.35, 0); break;
    case 'glitter': M.cyl(0.07, 0.07, 0.14, '#c86bff', 0, 0.07, 0, 1, 1, 12); M.cyl(0.075, 0.075, 0.04, '#ffd23f', 0, 0.16, 0, 1, 1, 12); for (let i = 0; i < 6; i++) M.sph(0.012, '#fff7b0', Math.cos(i) * 0.072, 0.03 + i * 0.018, Math.sin(i) * 0.072, 1, 1, 1, 5); break;
    case 'mouthwash': M.box(0.06, 0.12, 0.04, '#2fd1c4', 0, 0.06, 0); M.cyl(0.018, 0.018, 0.03, '#fff', 0, 0.135, 0, 1, 1, 8); break;
    case 'sock': M.box(0.08, 0.2, 0.06, '#f4f4f4', 0, 0.1, 0); M.box(0.08, 0.06, 0.15, '#f4f4f4', 0, 0.03, 0.05); for (const y of [0.06, 0.12, 0.18]) M.box(0.085, 0.025, 0.065, '#e85d8a', 0, y, 0); break;
    case 'coin': M.cyl(0.06, 0.06, 0.016, '#e8b923', 0, 0.008, 0, 1, 1, 14); M.cyl(0.045, 0.045, 0.018, '#ffd65a', 0, 0.009, 0, 1, 1, 14); break;
    case 'crate': M.box(0.8, 0.8, 0.8, '#b8884a', 0, 0.4, 0); for (const y of [0.05, 0.4, 0.75]) M.box(0.82, 0.08, 0.82, '#8a5a2a', 0, y, 0); break;
    case 'heavybox': M.box(0.9, 0.6, 0.9, '#c09a62', 0, 0.3, 0); M.box(0.92, 0.04, 0.12, '#d8c890', 0, 0.6, 0); M.box(0.3, 0.2, 0.01, '#fff', 0, 0.35, 0.455); break;
    case 'pallet': M.box(1.2, 0.14, 1.4, '#a0784a', 0, 0.07, 0); M.box(1.1, 0.75, 1.3, '#6b7a5a', 0, 0.52, 0); M.box(1.12, 0.06, 1.32, '#4e5c40', 0, 0.9, 0); break;
  }
  const g = new THREE.Group(); g.add(bake(M, 1.05)); return g;
}

export class Shop implements Mission {
  readonly index = 0;
  readonly space = new Space(OX, OY, OZ, 80);
  readonly group = new THREE.Group();
  readonly outro = 'm1_outro';
  readonly grabs: Grabs;
  private ctx!: Ctx;
  private items: Grab[] = [];
  private coins: Grab[] = [];
  private props = { fridge: 0, tape: 0, grille: 0, stack: 0, vend: 0 };
  private fridgeBy = -1; private fridgeAway = 0;
  private shakes = 0;
  private scanned: number[] = [];
  private paid: number[] = [];
  private totalAsked = false;
  private hintT = 0; private hintI = 0;
  private won = false;
  private doorL!: THREE.Group; private grilleM!: THREE.Group; private tapeM!: THREE.Group; private flapM!: THREE.Group; private vendM!: THREE.Group;
  private fridgeBox: ReturnType<Space['add']>; private grilleBox: ReturnType<Space['add']>;
  private cashier!: { head: THREE.Group; arm: THREE.Group };
  private talkT = 0;
  /** the cashier says hello the first time somebody walks up to the counter */
  private greeted = false;
  private greet() { if (this.greeted) return; this.greeted = true; this.ctx.narrate('m1_hello', { priority: 1 }); this.talkT = 6; }
  private list: Board;
  private belt!: THREE.Mesh;
  private hud: HTMLDivElement;
  private t = 0;

  constructor(scene: THREE.Scene) {
    const M = new Mesher(), sp = this.space;
    this.grabs = new Grabs(sp, 0);
    this.group.add(this.grabs.group);
    // ---- the shell: shop floor (x -12..12, z -12..12), stockroom behind (z -20..-12)
    const H = 4, W0 = -12, W1 = 12, Z0 = -20, Z1 = 12;
    M.box(W1 - W0, 0.1, Z1 - Z0, '#e9e4da', 0, -0.05, (Z0 + Z1) / 2);
    for (let x = W0 + 1; x < W1; x += 2) M.box(0.03, 0.012, Z1 - Z0, '#cfc8bb', x, 0.006, (Z0 + Z1) / 2);
    for (let z = Z0 + 1; z < Z1; z += 2) M.box(W1 - W0, 0.012, 0.03, '#cfc8bb', 0, 0.006, z);
    M.box(W1 - W0, 0.1, Z1 - Z0, '#f5f5f2', 0, H + 0.05, (Z0 + Z1) / 2);
    const wall = (x0: number, x1: number, z0: number, z1: number, c = '#f0ece2') => { M.box(x1 - x0, H, z1 - z0, c, (x0 + x1) / 2, H / 2, (z0 + z1) / 2); sp.add(x0, x1, -1, H + 1, z0, z1); };
    wall(W0 - 0.3, W0, Z0, Z1, '#e6dccb'); wall(W1, W1 + 0.3, Z0, Z1, '#e6dccb');
    wall(W0, W1, Z0 - 0.3, Z0, '#d9cfbd'); wall(W0, W1, Z1, Z1 + 0.3, '#2a5d8a');
    sp.add(W0 - 1, W1 + 1, H, H + 2, Z0 - 1, Z1 + 1);
    // stockroom wall with a wide doorway (plastic strip curtain)
    wall(W0, -1.6, -12.15, -11.85, '#c9bfae'); wall(1.6, W1, -12.15, -11.85, '#c9bfae');
    M.box(3.2, H - 2.6, 0.3, '#c9bfae', 0, 2.6 + (H - 2.6) / 2, -12); sp.add(-1.6, 1.6, 2.6, H, -12.15, -11.85);
    for (let i = 0; i < 11; i++) M.box(0.26, 2.5, 0.01, '#bfe0ff', -1.45 + i * 0.29, 1.3, -12 + (i % 2) * 0.02);
    const st = sign(['STAFF ONLY', '(and gorillas)'], 1.8, 0.5, '#7a2c33', '#fff'); st.position.set(0, 3.1, -11.83); this.group.add(st);
    // ceiling strip lights
    for (let x = -9; x <= 9; x += 4.5) for (let z = -18; z <= 10; z += 4) M.box(0.3, 0.05, 2.4, '#ffffff', x, H - 0.03, z);
    // shop front: blue sign band, glass, the door back out (= back to the cosy room)
    door(M, this.group, 0, 11.92, -1, '#3b7fb8', 'Back to the cosy room');
    for (const x of [-6, 6]) M.box(5, 2.6, 0.04, '#bde4f5', x, 1.4, 11.95);
    // ---- the till counter (cashier sits behind it, customers come from the aisles)
    M.box(5, 0.95, 1.0, '#2a5d8a', -7.5, 0.475, 7); sp.add(-10, -5, 0, 0.95, 6.5, 7.5);
    M.box(5.1, 0.05, 1.1, '#f2f2f2', -7.5, 0.97, 7);
    this.belt = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.02, 0.8), new THREE.MeshBasicMaterial({ color: '#202226' }));
    this.belt.position.set(-8.05, 1.0, 7); this.group.add(this.belt);
    for (let i = 0; i < 8; i++) M.box(0.04, 0.025, 0.8, '#3a3d44', -9.5 + i * 0.4, 1.0, 7);
    M.box(1.0, 0.04, 0.9, '#c8ccd2', -5.7, 1.0, 7); M.box(1.0, 0.08, 0.03, '#9aa0a8', -5.7, 1.04, 6.55);         // the coin tray
    // the signs hang from the ceiling over the counter, well clear of the belt and the tray
    const tl = sign(['PAY HERE', '$ coins on the tray'], 1.0, 0.36, '#ffd23f', '#2a1a05'); tl.position.set(-5.7, 2.55, 6.9); tl.rotation.y = Math.PI; this.group.add(tl);
    const bl = sign(['PUT YOUR SHOPPING', 'ON THE BELT'], 1.8, 0.4, '#2a5d8a', '#fff'); bl.position.set(-8.05, 2.55, 6.9); bl.rotation.y = Math.PI; this.group.add(bl);
    for (const x of [-8.85, -7.25, -6.1, -5.3]) M.box(0.02, H - 2.75, 0.02, '#888', x, 2.75 + (H - 2.75) / 2, 6.9);
    M.box(0.5, 0.35, 0.4, '#3a3d44', -5.2, 1.2, 7.6); M.box(0.45, 0.3, 0.02, '#9fe0ff', -5.2, 1.22, 7.39);    // the till itself
    // the cashier: seated behind the counter, facing the customers
    this.cashier = this.buildCashier();
    // the shopping list on a stand by the counter
    this.list = new Board(1.1, 1.4, 512); this.list.mesh.position.set(-4.3, 1.55, 6.9); this.list.mesh.rotation.y = Math.PI; this.group.add(this.list.mesh);
    M.box(0.06, 1.0, 0.06, '#555', -4.3, 0.5, 6.95); M.box(1.2, 1.5, 0.04, '#7a5a3a', -4.3, 1.55, 6.93);
    // ---- the aisles: four shelf units, with signs hanging over the aisles
    const prodCols = ['#e85d5d', '#5d9be8', '#f2c14e', '#6fd36f', '#c86bff', '#ff9f43', '#ffffff', '#2fd1c4', '#ff7fc8', '#8a6a44'];
    let pc = 0;
    const unit = (x: number, z0: number, z1: number, raised?: [number, number]) => {
      // uprights + 4 shelves; the "raised" stretch has no bottom shelf (a gap a cat can crawl under)
      // the centre divider stops at the bottom shelf over a raised stretch, so the gap underneath is open all the way through
      if (raised) { M.box(0.06, 2.0, raised[0] - z0, '#b9bec4', x, 1.0, (z0 + raised[0]) / 2); M.box(0.06, 2.0, z1 - raised[1], '#b9bec4', x, 1.0, (raised[1] + z1) / 2); M.box(0.06, 1.58, raised[1] - raised[0], '#b9bec4', x, 1.21, (raised[0] + raised[1]) / 2); }
      else M.box(0.06, 2.0, z1 - z0, '#b9bec4', x, 1.0, (z0 + z1) / 2);
      for (const y of [0.42, 0.9, 1.4, 1.9]) M.box(1.0, 0.04, z1 - z0, '#d0d4d8', x, y, (z0 + z1) / 2);
      const base = (a: number, b: number) => M.box(1.0, 0.42, b - a, '#9aa0a8', x, 0.21, (a + b) / 2);
      if (raised) { base(z0, raised[0]); base(raised[1], z1); M.box(0.9, 0.01, raised[1] - raised[0], '#2a2622', x, 0.006, (raised[0] + raised[1]) / 2); }
      else base(z0, z1);
      for (const zz of [z0, z1]) M.box(1.0, 2.0, 0.05, '#b9bec4', x, 1.0, zz);
      for (const y of [0.44, 0.92, 1.42]) for (let z = z0 + 0.15; z < z1 - 0.1; z += 0.27) for (const s of [-1, 1]) {
        if (pc++ % 7 === 3) continue;
        const h = 0.14 + ((pc * 37) % 5) * 0.04, c = prodCols[(pc * 13) % prodCols.length];
        M.box(0.18, h, 0.2, c, x + s * 0.3, y + h / 2, z);
      }
      if (raised) {
        sp.add(x - 0.5, x + 0.5, 0, 2.0, z0, raised[0]); sp.add(x - 0.5, x + 0.5, 0.42, 2.0, raised[0], raised[1]); sp.add(x - 0.5, x + 0.5, 0, 2.0, raised[1], z1);
      } else sp.add(x - 0.5, x + 0.5, 0, 2.0, z0, z1);
    };
    unit(-7.5, -9, 3); unit(-3.5, -9, 3); unit(0.5, -9, 3, [-3, 1]); unit(4.5, -9, 3);
    const aisle = (x: number, name: string, c: string) => { const s = sign([name], 2.4, 0.5, c, '#fff'); s.position.set(x, 3.2, -3); this.group.add(s); const s2 = s.clone(); s2.rotation.y = Math.PI; s2.position.z = -3.02; this.group.add(s2); };
    aisle(-9.75, 'Meal Deal', '#2a7a4a'); aisle(-5.5, 'Health & Beauty', '#b84a8a'); aisle(-1.5, 'Toiletries', '#2a8a9a'); aisle(2.5, 'Sweets', '#d9822b'); aisle(6.5, 'Seasonal', '#8a3a3a');
    // ---- the meal deal fridge on the west wall (a heavy glass door, shelves inside with a cat-sized gap under the bottom one)
    // a hollow cabinet (back, top, two ends, a light strip): you see the shelves and what is on them through the glass door
    M.box(0.08, 2.3, 4.2, '#e8eef2', -11.96, 1.15, -4); M.box(1.2, 0.1, 4.2, '#d8dde2', -11.4, 2.25, -4);
    for (const z of [-6.06, -1.94]) M.box(1.2, 2.3, 0.08, '#d8dde2', -11.4, 1.15, z);
    M.box(1.0, 0.05, 3.9, '#9ad0ff', -11.45, 2.17, -4); M.box(1.1, 0.02, 4.0, '#c9d2d8', -11.4, 0.01, -4);
    sp.add(FRIDGE.x0, FRIDGE.x1, 2.2, 2.4, FRIDGE.z0, FRIDGE.z1);
    sp.add(FRIDGE.x0, FRIDGE.x1, 0, 2.4, FRIDGE.z0 - 0.1, FRIDGE.z0); sp.add(FRIDGE.x0, FRIDGE.x1, 0, 2.4, FRIDGE.z1, FRIDGE.z1 + 0.1);
    for (const y of [0.5, 1.05, 1.6]) { M.box(1.0, 0.04, 3.9, '#eef4f8', -11.4, y, -4); sp.add(FRIDGE.x0, FRIDGE.x1, y - 0.04, y + 0.02, FRIDGE.z0, FRIDGE.z1); }
    for (const y of [0.52, 1.07, 1.62]) for (let z = -5.7; z < -2.2; z += 0.35) M.box(0.25, 0.12, 0.28, prodCols[(pc++ * 7) % prodCols.length], -11.0, y + 0.06, z);
    const fs = sign(['MEAL DEAL', 'sandwich + snack + drink'], 2.2, 0.45, '#2a7a4a', '#fff'); fs.position.set(-10.75, 2.6, -4); fs.rotation.y = Math.PI / 2; this.group.add(fs);
    this.fridgeBox = sp.add(-10.85, -10.75, 0, 2.2, FRIDGE.z0, FRIDGE.z1, 'fridgedoor');
    const dm = new Mesher(); dm.box(0.06, 2.2, 4.0, '#bfe6ff', 0, 1.1, -2.0); dm.box(0.08, 2.24, 0.06, '#9aa0a8', 0, 1.1, -0.03); dm.box(0.08, 2.24, 0.06, '#9aa0a8', 0, 1.1, -3.97); dm.box(0.06, 0.6, 0.06, '#666', 0.06, 1.1, -3.7);
    const dmesh = bake(dm); dmesh.material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false });
    this.doorL = new THREE.Group(); this.doorL.add(dmesh); this.doorL.position.set(-10.8, 0, -2); this.group.add(this.doorL);
    // ---- the pharmacy: a tall glass-fronted cabinet on the east side (nothing to climb on)
    // hollow too: back, ends, top and plinth, three shelves of medicine boxes behind a glass front
    M.box(0.08, 2.5, 2.0, '#f2f2f2', 11.46, 1.25, -5); M.box(2.0, 0.1, 2.0, '#f2f2f2', 10.5, 2.45, -5); M.box(2.0, 0.3, 2.0, '#e2e2e2', 10.5, 0.15, -5);
    for (const z of [-5.96, -4.04]) M.box(2.0, 2.5, 0.08, '#f2f2f2', 10.5, 1.25, z);
    for (const y of [0.9, 1.5]) M.box(1.9, 0.04, 1.84, '#dfe6ea', 10.5, y, -5);
    sp.add(9.5, 11.5, 0, 2.5, -6, -4);
    { // the glass front is real glass (see-through), not part of the solid room mesh
      const gl = new THREE.Mesh(new THREE.BoxGeometry(0.03, 2.1, 1.84), new THREE.MeshBasicMaterial({ color: '#bfe6ff', transparent: true, opacity: 0.28, depthWrite: false }));
      gl.position.set(9.48, 1.2, -5); this.group.add(gl);
      M.box(0.06, 0.06, 1.9, '#d0d6da', 9.47, 2.27, -5);   // the frame along the top
    }
    const meds = ['#ffffff', '#e85d5d', '#5d9be8', '#6fd36f', '#f2c14e'];
    for (const y of [0.3, 0.92, 1.52]) for (let z = -5.75; z < -4.3; z += 0.24) for (const x of [9.75, 10.3, 10.9]) M.box(0.16, 0.22, 0.14, meds[Math.round((z + y * 3 + x) * 7) % meds.length >= 0 ? Math.abs(Math.round((z + y * 3 + x) * 7)) % meds.length : 0], x, y + 0.11, z);
    const ph = sign(['PHARMACY', '+'], 1.6, 0.6, '#2a9a5a', '#fff'); ph.position.set(9.46, 3.0, -5); ph.rotation.y = -Math.PI / 2; this.group.add(ph);
    M.box(1.0, 1.05, 3.0, '#2a9a5a', 10.6, 0.52, -0.5); sp.add(10.1, 11.1, 0, 1.05, -2, 1);         // the pharmacy counter
    // ---- the photo booth (east wall): a curtain, a seat with a gap under it
    M.box(2.0, 0.1, 2.2, '#3a3a5a', 11, 2.25, 4); M.box(2.0, 2.3, 0.1, '#5a4a8a', 11, 1.15, 2.9); M.box(2.0, 2.3, 0.1, '#5a4a8a', 11, 1.15, 5.1);
    sp.add(10, 12, 0, 2.3, 2.85, 2.95); sp.add(10, 12, 0, 2.3, 5.05, 5.15); sp.add(10, 12, 2.2, 2.4, 2.9, 5.1);
    M.box(0.05, 1.7, 0.6, '#c8343a', 10.02, 1.4, 3.25); M.box(0.05, 1.7, 0.6, '#c8343a', 10.02, 1.4, 4.75);
    M.box(1.0, 0.1, 1.2, '#2a2a33', 11.1, 0.44, 4); sp.add(10.6, 11.6, 0.39, 0.49, 3.4, 4.6);
    for (const [dx, dz] of [[-0.45, -0.55], [0.45, -0.55], [-0.45, 0.55], [0.45, 0.55]]) M.box(0.05, 0.4, 0.05, '#555', 11.1 + dx, 0.2, 4 + dz);
    const pb = sign(['PHOTO BOOTH', '4 snaps $1'], 1.6, 0.5, '#5a4a8a', '#fff'); pb.position.set(9.98, 2.6, 4); pb.rotation.y = -Math.PI / 2; this.group.add(pb);
    // ---- the vending machine (front, east)
    this.vendM = new THREE.Group();
    const vm = new Mesher(); vm.box(0.9, 1.9, 0.9, '#c8343a', 0, 0.95, 0); vm.box(0.04, 1.2, 0.6, '#bfe6ff', -0.45, 1.15, -0.05);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) vm.box(0.1, 0.14, 0.12, prodCols[(r * 3 + c) % prodCols.length], -0.38, 0.7 + r * 0.28, -0.25 + c * 0.2);
    vm.box(0.06, 0.18, 0.4, '#222', -0.44, 0.25, 0);
    this.vendM.add(bake(vm)); this.vendM.position.set(10.9, 0, 9); this.group.add(this.vendM); sp.add(10.45, 11.35, 0, 1.9, 8.55, 9.45);
    // ---- pick'n'mix stand (sweets): coloured bins
    M.box(2.0, 1.25, 1.0, '#d9822b', 2.5, 0.62, 5.5); sp.add(1.5, 3.5, 0, 1.25, 5, 6);
    for (let i = 0; i < 6; i++) M.box(0.3, 0.1, 0.4, prodCols[i], 1.75 + (i % 3) * 0.5, 1.3, 5.25 + Math.floor(i / 3) * 0.5);
    const pm = sign(["PICK 'N' MIX"], 1.6, 0.35, '#ff9f43', '#fff'); pm.position.set(2.5, 1.7, 4.98); pm.rotation.y = Math.PI; this.group.add(pm);
    // ---- the stockroom: shelving, the taped box, the air duct, the pallet and its low cupboard, the stacked boxes
    M.box(5, 2.6, 0.8, '#7a8a9a', 4.5, 1.3, -19.4); M.box(5, 2.6, 0.8, '#7a8a9a', 6.5, 1.3, -14.5);
    sp.add(2, 7, 0, 2.6, -19.8, -19.0); sp.add(4, 9, 0, 2.6, -14.9, -14.1);
    for (let i = 0; i < 10; i++) M.box(0.6, 0.45, 0.5, '#c09a62', 2.5 + (i % 5) * 1.0, 0.25 + Math.floor(i / 5) * 1.3, -19.4);
    // taped box
    this.tapeM = new THREE.Group();
    const tb = new Mesher(); tb.box(1.0, 0.8, 1.0, '#c09a62', 0, 0.4, 0); tb.box(1.02, 0.06, 0.2, '#d8c890', 0, 0.8, 0); tb.box(0.2, 0.06, 1.02, '#d8c890', 0, 0.8, 0); tb.box(0.2, 0.82, 1.02, '#d8c890', 0, 0.41, 0);
    this.tapeM.add(bake(tb)); this.tapeM.position.set(8, 0, -17); this.group.add(this.tapeM); sp.add(7.5, 8.5, 0, 0.8, -17.5, -16.5);
    const fr = sign(['FRAGILE', 'do not open'], 0.8, 0.3, '#c09a62', '#a01010'); fr.position.set(8, 0.5, -16.49); this.group.add(fr);
    // the air duct along the north wall, high up: a cat-sized tunnel with a grille at its east end
    const DY = 2.2, DZ0 = -19.95, DZ1 = -19.45;
    M.box(6.2, 0.1, 0.62, '#9aa4ad', -9, DY - 0.05, -19.7); M.box(6.2, 0.1, 0.62, '#9aa4ad', -9, DY + 0.55, -19.7); M.box(6.2, 0.6, 0.06, '#8a949d', -9, DY + 0.25, DZ1 + 0.03);
    sp.add(-12, -5.9, DY - 0.1, DY, DZ0, DZ1 + 0.06); sp.add(-12, -5.9, DY + 0.5, DY + 0.6, DZ0, DZ1 + 0.06); sp.add(-12, -5.9, DY, DY + 0.5, DZ1, DZ1 + 0.06); sp.add(-12, -5.9, DY, DY + 0.5, DZ0 - 0.06, DZ0 + 0.02);
    this.grilleBox = sp.add(-5.95, -5.85, DY, DY + 0.5, DZ0, DZ1, 'grille');
    this.grilleM = new THREE.Group();
    const gm = new Mesher(); gm.box(0.04, 0.5, 0.5, '#c8ccd2', 0, 0.25, 0); for (let i = 0; i < 5; i++) gm.box(0.05, 0.03, 0.46, '#7a8088', 0.01, 0.06 + i * 0.09, 0);
    this.grilleM.add(bake(gm)); this.grilleM.position.set(-5.88, DY, -19.7); this.group.add(this.grilleM);
    const vs = sign(['AIR VENT'], 0.8, 0.22, '#9aa4ad', '#222'); vs.position.set(-5.84, DY + 0.75, -19.7); vs.rotation.y = Math.PI / 2; this.group.add(vs);
    // the low cupboard on the east wall (a gap under it) and the loaded pallet shoved in front of it
    M.box(0.8, 0.55, 2.0, '#6b5a4a', 11.6, 0.62, -14); sp.add(11.2, 12, 0.35, 0.9, -15, -13);
    for (const z of [-15.05, -12.95]) { M.box(0.8, 0.9, 0.08, '#5a4a3a', 11.6, 0.45, z); sp.add(11.2, 12, 0, 0.9, z - 0.05, z + 0.05); }
    // (no dark panel across the gap: you can see the coin under there, you just can't get at it past the pallet)
    // the stack: a bottom box with a cat flap (static) with heavy boxes piled on top
    this.flapM = new THREE.Group();
    const sb = new Mesher(); sb.box(1.0, 0.8, 1.0, '#b08a52', 0, 0.4, 0); sb.box(0.36, 0.3, 0.02, '#5a4020', 0, 0.16, 0.51);
    this.flapM.add(bake(sb)); this.flapM.position.set(-3, 0, -17); this.group.add(this.flapM); sp.add(-3.5, -2.5, 0, 0.8, -17.5, -16.5);
    const cf = sign(['CAT FLAP'], 0.5, 0.14, '#b08a52', '#3a2a10'); cf.position.set(-3, 0.42, -16.48); this.group.add(cf);

    this.group.add(bake(M, 1.05));

    // ---- things to pick up
    const add = (kind: string, name: string, k: 'item' | 'coin' | 'heavy', x: number, y: number, z: number, o: Partial<Grab> = {}) =>
      this.grabs.add({ name, kind: k, mesh: itemMesh(kind), x, y, z, r: k === 'heavy' ? 0.55 : 0.16, ...o });
    this.items = [
      add('sardines', ITEMS[0].name, 'item', -11.55, 0, -4.2, { catOnly: true }),
      add('bubble', ITEMS[1].name, 'item', 10.5, 2.5, -5),
      add('glitter', ITEMS[2].name, 'item', 8, 0, -16.2, { hidden: true }),
      add('mouthwash', ITEMS[3].name, 'item', 0.78, 0, -1, { catOnly: true }),   // beside the centre divider, not inside it
      add('sock', ITEMS[4].name, 'item', -11.4, DY, -19.7, { catOnly: true }),
    ];
    this.coins = [
      add('coin', 'A dollar coin', 'coin', 9.9, 0, 9, { hidden: true }),
      add('coin', 'A dollar coin', 'coin', 11.6, 0, -14, { catOnly: true }),
      add('coin', 'A dollar coin', 'coin', 11.1, 0, 4, { catOnly: true }),
      add('coin', 'A dollar coin', 'coin', -3, 0, -16.2, { hidden: true }),
      add('coin', 'A dollar coin', 'coin', 2.5, 1.35, 5.5),
    ];
    add('crate', 'Wooden crate', 'heavy', -1.5, 0, -15, { w: 0.8, d: 0.8, h: 0.8 });
    add('pallet', 'Loaded pallet', 'heavy', 10.5, 0, -14, { w: 1.2, d: 1.4, h: 0.95, r: 0.8 });
    add('heavybox', 'Heavy box', 'heavy', -3, 0.8, -17, { w: 0.9, d: 0.9, h: 0.6 });
    add('heavybox', 'Heavy box', 'heavy', -3, 1.4, -17, { w: 0.9, d: 0.9, h: 0.6 });

    this.group.position.set(OX, OY, OZ); this.group.visible = false;
    scene.add(this.group);
    this.hud = document.createElement('div');
    this.hud.style.cssText = 'position:fixed;left:50%;top:70px;transform:translateX(-50%);z-index:5;display:none;color:#fff;font:700 17px system-ui,sans-serif;text-align:center;text-shadow:0 1px 5px rgba(0,0,0,.85);pointer-events:none;letter-spacing:.02em';
    document.body.appendChild(this.hud);
  }

  private buildCashier() {
    const g = new THREE.Group(); g.position.set(-7.5, 0, 8.25); g.rotation.y = Math.PI; this.group.add(g);
    const B = new Mesher();
    B.box(0.5, 0.1, 0.5, '#444', 0, 0.55, 0); B.cyl(0.04, 0.04, 0.5, '#666', 0, 0.28, 0, 1, 1, 6);              // the stool
    B.box(0.42, 0.55, 0.26, '#2a9a5a', 0, 0.95, 0); B.box(0.44, 0.12, 0.28, '#1f7a46', 0, 0.68, 0);              // uniform tunic
    B.box(0.16, 0.5, 0.18, '#3b4a58', -0.1, 0.55, 0.2, -1.2); B.box(0.16, 0.5, 0.18, '#3b4a58', 0.1, 0.55, 0.2, -1.2);
    B.box(0.12, 0.45, 0.12, '#2a9a5a', -0.27, 0.95, 0.05); B.box(0.12, 0.12, 0.12, '#e8b88c', -0.27, 0.7, 0.08);
    B.box(0.12, 0.06, 0.03, '#fff', 0.1, 1.12, 0.135);                                                             // name badge
    g.add(bake(B));
    const head = new THREE.Group(); head.position.set(0, 1.3, 0); g.add(head);
    const Hm = new Mesher(); Hm.sph(0.16, '#e8b88c', 0, 0.05, 0); Hm.cap(0.17, '#7a3a1a', 0, 0.08, -0.01, 1, 1, 1, Math.PI * 0.6);
    Hm.sph(0.022, '#222', -0.06, 0.07, 0.14); Hm.sph(0.022, '#222', 0.06, 0.07, 0.14); Hm.box(0.08, 0.02, 0.02, '#a0402a', 0, -0.03, 0.15);
    Hm.box(0.14, 0.04, 0.02, '#333', 0, 0.08, 0.16);                                                               // glasses
    head.add(bake(Hm));
    const arm = new THREE.Group(); arm.position.set(0.27, 1.17, 0.02); g.add(arm);
    const Am = new Mesher(); Am.box(0.12, 0.42, 0.12, '#2a9a5a', 0, -0.2, 0); Am.box(0.12, 0.12, 0.12, '#e8b88c', 0, -0.44, 0); arm.add(bake(Am));
    return { head, arm };
  }

  // ------------------------------------------------------------ a run
  begin(rid: number, ctx: Ctx) {
    this.ctx = ctx; void rid;
    this.grabs.reset();
    this.props = { fridge: 0, tape: 0, grille: 0, stack: 0, vend: 0 };
    this.fridgeBy = -1; this.shakes = 0; this.scanned = []; this.paid = []; this.totalAsked = false; this.won = false;
    this.hintT = 0; this.hintI = 0; this.applyProps();
    ctx.narrate('m1_intro', { interrupt: true, priority: 2 }); ctx.narrate('m1_list', { priority: 2 });
    this.greeted = false;
  }
  enter() { this.group.visible = true; const a = (this.ctx.me() % 4) - 1.5; this.ctx.player.teleport(OX + a * 0.8, OY, OZ + 10, 0); }
  leave() { const g = this.grabs.mine; if (g) this.grabs.drop(g, this.ctx.me(), (e) => this.ctx.send(e), 0, 0, 0); this.hud.style.display = 'none'; }

  private applyProps() {
    const p = this.props;
    this.fridgeBox.off = !!p.fridge;
    this.grilleBox.off = !!p.grille;
    this.grilleM.visible = !p.grille;
    this.tapeM.scale.y = p.tape ? 0.55 : 1;
    if (p.tape) this.grabs.reveal(this.items[2]); else if (!this.items[2].moved) { this.items[2].hid = true; this.items[2].mesh.visible = false; }
    if (p.vend) this.grabs.reveal(this.coins[0]);
    if (p.stack) this.grabs.reveal(this.coins[3]);
  }
  private setProp(p: Prop, s: number, by = -1) {
    if (this.props[p] === s) return;
    this.props[p] = s;
    if (p === 'fridge') this.fridgeBy = s ? by : -1;
    this.applyProps(); this.progress();
    this.ctx.send({ k: 'qb', m: 0, p, s, o: by });
  }
  private progress() { this.hintT = 0; }

  // ------------------------------------------------------------ aiming
  private L(v: THREE.Vector3) { return this._l.set(v.x - OX, v.y - OY, v.z - OZ); }
  private _l = new THREE.Vector3();
  /** can this be reached right now (doors and grilles in the way)? */
  private reachable(g: Grab) {
    if (g === this.items[0]) return !!this.props.fridge;
    if (g === this.items[4]) return !!this.props.grille || g.moved;
    return true;
  }
  pick(eye: THREE.Vector3, dir: THREE.Vector3, reach: number, assist: number): { t: MTarget; dist: number } | null {
    if (this.grabs.mine) return { t: { w: 'held' }, dist: 0 };
    const le = this.L(eye), sp = this.ctx.species();
    const r = Math.max(reach, sp === 'g' ? 2.6 : 1.6);
    let best: { t: MTarget; dist: number } | null = null;
    const take = (t: MTarget, d: number | null) => { if (d != null && (!best || d < best.dist)) best = { t, dist: d }; };
    const gp = this.grabs.pick(le, dir, r, assist);
    if (gp && this.reachable(gp.g)) take({ w: 'grab', i: gp.g.i }, gp.dist);
    take({ w: 'exit' }, rayHit(le, dir, 0, 1.2, 11.9, 1.0, Math.max(reach, 3.2), assist));
    take({ w: 'prop', p: 'fridge' }, rayHit(le, dir, -10.8, 1.1, -4, 1.0, 3.2, assist));
    if (!this.props.tape) take({ w: 'prop', p: 'tape' }, rayHit(le, dir, 8, 0.5, -17, 0.7, 3.2, assist));
    if (!this.props.grille) take({ w: 'prop', p: 'grille' }, rayHit(le, dir, -5.88, 2.45, -19.7, 0.45, 3.2, assist));
    if (!this.props.stack) take({ w: 'prop', p: 'stack' }, rayHit(le, dir, -3, 0.25, -16.55, 0.35, 2.6, assist));
    if (!this.props.vend) take({ w: 'prop', p: 'vend' }, rayHit(le, dir, 10.5, 1.0, 9, 0.8, 3.2, assist));
    take({ w: 'list' }, rayHit(le, dir, -4.3, 1.55, 6.9, 0.6, 6, assist));
    return best;
  }
  private stackCovered() { return this.grabs.list.some((g) => g.kind === 'heavy' && !g.hid && g.mode === 0 && Math.abs(g.x + 3) < 0.6 && Math.abs(g.z + 17) < 0.6 && g.y > 0.5); }
  prompt(t: MTarget): { name: string; hint: string; ok: boolean } {
    const sp = this.ctx.species(), cat = sp === 'c' || this.ctx.helper('c'), gor = sp === 'g' || this.ctx.helper('g');
    switch (t.w) {
      case 'held': { const g = this.grabs.mine!; return { name: `Carrying: ${g.name}`, hint: this.ctx.inVR() ? 'Let go of the trigger to drop · swing to throw' : '<b>E</b> put down · <b>Click</b> throw', ok: true }; }
      case 'exit': return { name: 'Shop door', hint: '<b>E</b> give up and go back to the cosy room', ok: true };
      case 'list': return { name: 'The shopping list', hint: `${this.scanned.length} of 5 on the belt · $${this.paid.length} of $5 paid`, ok: true };
      case 'grab': {
        const g = this.grabs.list[t.i], why = this.grabs.why(g, sp, sp === 'g' ? this.ctx.helper('c') : this.ctx.helper('g'));
        if (why === 'heavy') return { name: g.name, hint: 'Too heavy for a cat', ok: false };
        if (why === 'cat') return { name: g.name, hint: 'Too far in for gorilla hands', ok: false };
        return { name: g.name, hint: this.ctx.inVR() ? 'Squeeze the trigger on it, or <b>E</b> pick up' : '<b>E</b> / <b>Click</b> pick up', ok: true };
      }
      case 'prop': switch (t.p as Prop) {
        case 'fridge': return this.props.fridge ? { name: 'Fridge door (open)', hint: this.fridgeBy === this.ctx.me() ? 'It stays open while you are close' : 'Crawl in under the shelves', ok: true } : gor ? { name: 'Heavy fridge door', hint: '<b>E</b> haul it open', ok: true } : { name: 'Heavy fridge door', hint: 'Too heavy for a cat', ok: false };
        case 'tape': return gor ? { name: 'Taped box', hint: '<b>E</b> rip the tape off', ok: true } : { name: 'Taped box', hint: 'Taped shut. Paws are no good at tape.', ok: false };
        case 'grille': return gor ? { name: 'Vent grille', hint: '<b>E</b> pull it off', ok: true } : { name: 'Vent grille', hint: 'Screwed on tight', ok: false };
        case 'stack': return this.stackCovered() ? { name: 'Box with a cat flap', hint: 'The heavy boxes on top squash the flap shut', ok: false } : cat ? { name: 'Box with a cat flap', hint: '<b>E</b> crawl in', ok: true } : { name: 'Box with a cat flap', hint: 'Far too small for a gorilla', ok: false };
        case 'vend': return { name: 'Vending machine', hint: gor ? `<b>E</b> give it a good shake${this.shakes ? ` (${this.shakes})` : ''}` : 'Too heavy for a cat to shake', ok: gor };
      }
    }
    return { name: '', hint: '', ok: false };
  }
  interact(t: MTarget): 'exit' | null {
    const sp = this.ctx.species(), me = this.ctx.me(), send = (e: any) => this.ctx.send(e);
    const cat = sp === 'c' || this.ctx.helper('c'), gor = sp === 'g' || this.ctx.helper('g');
    switch (t.w) {
      case 'exit': return 'exit';
      case 'held': {
        const g = this.grabs.mine!; this.carryPos(this._c);
        g.x = this._c.x; g.y = Math.max(this._c.y - 0.3, this.space.floorL(this._c.x, this._c.z, this._c.y)); g.z = this._c.z;
        // put down at the till: shopping goes onto the belt, coins onto the tray (from anywhere along the front of the counter)
        const c = this._c, atCounter = c.z > 5.2 && c.z < 7.9;
        if (atCounter && g.kind === 'coin' && c.x > -6.9 && c.x < -4.6) { g.x = Math.max(TRAY.x0 + 0.15, Math.min(TRAY.x1 - 0.15, c.x)); g.z = 7.0; g.y = 1.03; }
        else if (atCounter && g.kind !== 'coin' && c.x > BELT.x0 - 0.5 && c.x < BELT.x1 + 0.5) { g.x = Math.max(BELT.x0 + 0.2, Math.min(BELT.x1 - 0.2, c.x)); g.z = 7.0; g.y = 1.03; }
        this.grabs.drop(g, me, send, 0, 0, 0); this.ctx.sfx.place(); return null;
      }
      case 'list': this.ctx.narrate('m1_list', { interrupt: true }); return null;
      case 'grab': this.tryGrab(this.grabs.list[t.i]); return null;
      case 'prop': switch (t.p as Prop) {
        case 'fridge': if (!this.props.fridge) { if (gor) { this.setProp('fridge', 1, me); this.ctx.sfx.creak(); } else { this.ctx.narrate('too_heavy', { interrupt: true }); this.ctx.sfx.denied(); } } return null;
        case 'tape': if (gor) { this.setProp('tape', 1, me); this.ctx.sfx.rip(); this.ctx.say('Rrrrip! Something sparkly inside...'); } else { this.ctx.narrate('too_heavy'); this.ctx.sfx.denied(); } return null;
        case 'grille': if (gor) { this.setProp('grille', 1, me); this.ctx.sfx.clang(); this.ctx.say('The grille comes off. It is a long way in - cat sized.'); } else { this.ctx.sfx.denied(); this.ctx.say('Screwed on tight. A gorilla could pull it off.'); } return null;
        case 'stack':
          if (this.stackCovered()) { this.ctx.sfx.denied(); this.ctx.say('Squashed shut. Somebody strong needs to lift the boxes off first.'); return null; }
          if (!cat) { this.ctx.narrate('need_cat', { interrupt: true }); this.ctx.sfx.denied(); return null; }
          this.setProp('stack', 1, me); this.ctx.sfx.pickup(); this.ctx.say('You wriggle in... and out comes a coin!'); return null;
        case 'vend':
          if (!gor) { this.ctx.narrate('too_heavy'); this.ctx.sfx.denied(); return null; }
          this.shakes++; this.ctx.sfx.thump(0.6); this.ctx.player.shake(0.4); this.vendT = 0.5; this.ctx.send({ k: 'qb', m: 0, p: 'shake' });
          if (this.shakes >= (sp === 'g' ? 3 : 6)) { this.setProp('vend', 1, me); this.ctx.sfx.coin(); this.ctx.say('Clunk! A coin drops out.'); }
          return null;
      }
    }
    return null;
  }
  private vendT = 0;
  private tryGrab(g: Grab) {
    const sp = this.ctx.species();
    const why = this.grabs.why(g, sp, sp === 'g' ? this.ctx.helper('c') : this.ctx.helper('g'));
    if (why === 'heavy') { this.ctx.narrate('too_heavy', { interrupt: true }); this.ctx.sfx.denied(); return false; }
    if (why === 'cat') { this.ctx.narrate('need_cat', { interrupt: true }); this.ctx.sfx.denied(); return false; }
    this.grabs.grab(g, this.ctx.me(), (e) => this.ctx.send(e));
    this.ctx.sfx.pickup(); this.ctx.haptic(0.4); this.progress();
    return true;
  }
  click(t: MTarget | null): boolean {
    const me = this.ctx.me(), g = this.grabs.mine;
    if (g) {
      // throw it where you are looking
      const d = this._d; this.ctx.player.eye && d.set(-Math.sin(this.ctx.player.yaw) * Math.cos(this.ctx.player.pitch), Math.sin(this.ctx.player.pitch), -Math.cos(this.ctx.player.yaw) * Math.cos(this.ctx.player.pitch));
      const sp = this.ctx.species() === 'g' ? (g.kind === 'heavy' ? 4 : 7.5) : 3.6;
      this.grabs.drop(g, me, (e) => this.ctx.send(e), d.x * sp, d.y * sp + 1.6, d.z * sp);
      this.ctx.sfx.swing(); return true;
    }
    if (t && (t.w === 'grab' || t.w === 'prop' || t.w === 'list')) { this.interact(t); return true; }
    return false;
  }
  private _d = new THREE.Vector3(); private _c = new THREE.Vector3();
  vrGrab(pos: THREE.Vector3, down: boolean, vel: THREE.Vector3): boolean {
    const me = this.ctx.me(), lp = this.L(pos);
    if (!down) {
      const g = this.grabs.mine; if (!g) return false;
      this.grabs.drop(g, me, (e) => this.ctx.send(e), vel.x * 1.6, vel.y * 1.6, vel.z * 1.6); return true;
    }
    const reach = this.ctx.species() === 'g' ? 0.55 : 0.3;
    let best: Grab | null = null, bd = reach;
    for (const g of this.grabs.list) {
      if (g.hid || g.done || g.mode === 1 || !this.reachable(g)) continue;
      const d = Math.hypot(g.x - lp.x, g.y + (g.h ? g.h / 2 : 0.08) - lp.y, g.z - lp.z) - (g.w ? g.w / 2 : 0);
      if (d < bd) { bd = d; best = g; }
    }
    return best ? this.tryGrab(best) : false;
  }
  /** where my carried thing goes (local) */
  private carryPos(out: THREE.Vector3) {
    this.ctx.carry(out); out.x -= OX; out.y -= OY; out.z -= OZ;
    return out;
  }

  // ------------------------------------------------------------ the till
  private inBox(g: Grab, b: typeof BELT) { return g.x > b.x0 && g.x < b.x1 && g.z > b.z0 && g.z < b.z1 && g.y > b.y0 && g.y < b.y1 && g.mode !== 1; }
  private scan(i: number) {
    if (this.scanned.includes(i)) return;
    this.scanned.push(i);
    const g = this.items[i], k = this.scanned.length - 1;
    this.grabs.consume(g, -9.4 + k * 0.6, 1.01, 7);
    this.ctx.sfx.scan(); this.progress();
    if (this.scanned.length < 5) this.ctx.narrate('m1_scan', { priority: 1 });
    else { this.ctx.narrate('m1_scan_last', { priority: 2 }); this.ctx.narrate('m1_total', { priority: 2 }); this.ctx.narrate('m1_money', { priority: 2 }); this.talkT = 9; this.totalAsked = true; }
  }
  private pay(i: number) {
    if (this.paid.includes(i)) return;
    this.paid.push(i);
    const g = this.coins[i], k = this.paid.length - 1;
    this.grabs.consume(g, -5.95 + (k % 3) * 0.17, 1.03 + Math.floor(k / 3) * 0.02, 6.85 + Math.floor(k / 3) * 0.2);
    this.ctx.sfx.coin(); this.progress();
    if (this.paid.length < 5) { this.ctx.narrate('m1_coin', { priority: 1 }); this.talkT = 2; }
    else { this.ctx.narrate('m1_paid', { interrupt: true, priority: 3 }); this.talkT = 6; }
  }

  net(e: any, from: number) {
    if (e.k === 'qi') { this.grabs.net(e, from); return; }
    if (e.k === 'qb') {
      if (e.p === 'shake') { this.vendT = 0.5; this.ctx?.sfx.thump(0.3); return; }
      if (e.p === 'hello') { this.greet(); return; }
      if (this.props[e.p as Prop] === e.s) return;
      this.props[e.p as Prop] = e.s; if (e.p === 'fridge') this.fridgeBy = e.s ? e.o : -1;
      this.applyProps(); this.progress();
      if (e.p === 'tape' || e.p === 'grille') this.ctx?.sfx.clang();
      return;
    }
    if (e.k === 'qt') { if (e.s === 'i') this.scan(e.i); else if (e.s === 'c') this.pay(e.i); }
  }

  // ------------------------------------------------------------ per frame
  update(dt: number, time: number) {
    const ctx = this.ctx; if (!ctx) return;
    this.t += dt;
    const me = ctx.me(), send = (e: any) => ctx.send(e);
    // carried things follow their holder's hands
    this.grabs.update(dt, (id) => {
      if (id === me) { this.carryPos(this._c); return { x: this._c.x, y: this._c.y, z: this._c.z, yaw: ctx.player.yaw }; }
      const o = ctx.others().find((p) => p.id === id); if (!o) return null;
      if (o.hand) return { x: o.hand.x - OX, y: o.hand.y - OY, z: o.hand.z - OZ, yaw: o.yaw };
      const g = (o.flags & 16384) !== 0, f = g ? 0.75 : 0.22;
      return { x: o.x - OX - Math.sin(o.yaw) * f, y: o.y - OY + (g ? 1.15 : 0.22), z: o.z - OZ - Math.cos(o.yaw) * f, yaw: o.yaw };
    }, me, send);
    // somebody walks up to the counter: the cashier says hello (once, to everybody)
    if (!this.greeted) {
      const p = ctx.player.pos, lx = p.x - OX, lz = p.z - OZ;
      if (lx > -10.5 && lx < -4.5 && lz > 3.6 && lz < 6.6) { this.greet(); send({ k: 'qb', m: 0, p: 'hello' }); }
    }
    // the controller watches the belt and the tray
    if (ctx.controller()) {
      this.items.forEach((g, i) => { if (!g.done && !g.hid && this.inBox(g, BELT)) { send({ k: 'qt', m: 0, s: 'i', i }); this.scan(i); } });
      if (this.totalAsked) this.coins.forEach((g, i) => { if (!g.done && !g.hid && this.inBox(g, PAYABLE)) { send({ k: 'qt', m: 0, s: 'c', i }); this.pay(i); } });
      // hints, when nothing has happened for a while
      this.hintT += dt;
      if (this.hintT > HINT_EVERY && !this.won) { this.hintT = 0; const h = this.nextHint(); if (h) ctx.narrateAll(h, { priority: 1 }); }
    }
    if (this.paid.length >= 5 && !this.won) { this.won = true; if (ctx.controller()) setTimeout(() => ctx.complete(0), 5000); }
    // the fridge door: stays open while whoever opened it is close; then it swings shut (it never shuts on a cat inside)
    if (this.props.fridge && this.fridgeBy === me) {
      const p = ctx.player.pos, lx = p.x - OX, lz = p.z - OZ;
      const near = Math.hypot(lx + 10.8, lz + 4) < 3.2;
      const catInside = [...ctx.others(), { id: me, x: p.x, z: p.z } as any].some((o) => o.x - OX < -10.7 && Math.abs(o.z - OZ + 4) < 2.1);
      this.fridgeAway = near || catInside ? 0 : this.fridgeAway + dt;
      if (this.fridgeAway > 6) { this.fridgeAway = 0; this.setProp('fridge', 0, me); ctx.sfx.thump(0.4); }
    }
    this.doorL.rotation.y += ((this.props.fridge ? -1.6 : 0) - this.doorL.rotation.y) * Math.min(1, dt * 5);
    this.vendT = Math.max(0, this.vendT - dt); this.vendM.rotation.z = Math.sin(time * 40) * 0.05 * this.vendT * 2;
    (this.belt.material as THREE.MeshBasicMaterial).color.setHSL(0, 0, 0.12 + 0.02 * Math.sin(time * 6));
    // the cashier bobs her head, and talks with her hands
    this.talkT = Math.max(0, this.talkT - dt);
    const talk = this.talkT > 0 ? 1 : 0;
    this.cashier.head.rotation.set(Math.sin(time * 1.3) * 0.05 + talk * Math.sin(time * 9) * 0.06, Math.sin(time * 0.7) * 0.25, 0);
    this.cashier.arm.rotation.set(-0.3 - talk * (0.6 + Math.sin(time * 5) * 0.4), 0, 0.15);
    // the list on its stand, and the line at the top of the screen
    this.list.draw(`${this.scanned.join(',')}|${this.paid.length}|${this.totalAsked}`, (g, W, H) => {
      g.fillStyle = '#fbf6e6'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#b02a2a'; g.fillRect(0, 0, W, 70); g.fillStyle = '#fff'; g.font = '800 40px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('SHOPPING LIST', W / 2, 50);
      g.textAlign = 'left';
      ITEMS.forEach((it, i) => {
        const y = 130 + i * 78, done = this.scanned.includes(i);
        g.fillStyle = done ? '#2a8a3a' : '#222'; g.font = '700 36px system-ui, sans-serif';
        g.fillText(`${done ? '☑' : '☐'}  ${it.icon} ${it.name}`, 26, y);
        if (done) { g.strokeStyle = '#2a8a3a'; g.lineWidth = 4; g.beginPath(); g.moveTo(90, y - 12); g.lineTo(W - 30, y - 12); g.stroke(); }
      });
      g.fillStyle = this.totalAsked ? '#b02a2a' : '#888'; g.font = '800 34px system-ui, sans-serif';
      g.fillText(this.totalAsked ? `Total $5 · paid $${this.paid.length}` : 'Then pay at the till', 26, H - 40);
    });
    const txt = `🧾 ${this.scanned.length}/5 on the belt · 💲 ${this.paid.length}/5 paid${this.grabs.mine ? ` · carrying ${this.grabs.mine.name}` : ''}`;
    if (this.hud.textContent !== txt) this.hud.textContent = txt;
    this.hud.style.display = 'block';
  }
  private nextHint(): string | null {
    const order: [string, () => boolean][] = [
      ['m1_hint_shelf', () => this.items[3].moved || this.items[3].done],
      ['m1_hint_cabinet', () => this.items[1].moved || this.items[1].done],
      ['m1_hint_fridge', () => this.items[0].moved || this.items[0].done],
      ['m1_hint_tape', () => !!this.props.tape],
      ['m1_hint_vent', () => this.items[4].moved || this.items[4].done],
      ['m1_hint_sweets', () => this.coins[4].moved || this.coins[4].done],
      ['m1_hint_vending', () => !!this.props.vend],
      ['m1_hint_booth', () => this.coins[2].moved || this.coins[2].done],
      ['m1_hint_pallet', () => this.coins[1].moved || this.coins[1].done],
      ['m1_hint_boxes', () => !!this.props.stack],
    ];
    const left = order.filter(([, ok]) => !ok());
    if (!left.length) return null;
    return left[this.hintI++ % left.length][0];
  }
}
