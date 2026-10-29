// Mission 2: Night at the Museum Gift Shop. Locked in after closing time, get the Golden Banana and the Golden Fish back out of
// the vault before the night guard's rounds end at dawn. In order:
//   A  the gallery: sensor beams across the doorway (a cat slips under, a gorilla must not touch) and a paw switch beyond them
//   B  the climbing hall: a gorilla climbs the rope to the catwalk (hold jump at the rope), pulls a lever, a ladder drops for the cat
//   C  the sculpture gallery: the night guard patrols with his torch. Get caught and you are sent back to the start of the room.
//      Distract him: throw the ball or bang the drum. Cats can take the air duct over his head into the next room.
//   D  the vault antechamber: the door from C opens with a lever on this side. Turn the four heavy statues to face the vault
//      (gorilla), read the code hidden in the crawlspace behind the painting (cat), type it on the keypad
//   V  the vault: take a trophy and the alarm goes off. Run through the staff corridor, where falling shelves block the way:
//      a gorilla holds a shelf up while the cat runs under and kicks the prop out on the far side. Both trophies out = done.
// The controller (lowest id in the museum) drives the guard and the alarm clock; everything else is idempotent state events.
import * as THREE from 'three';
import { Mesher } from '../net/playerModel';
import { Space, bake, Board, sign, rayHit } from './space';
import { Grabs, type Grab } from './grab';
import type { Ctx, Mission, MTarget } from './types';
import { missionX } from './campaign';
import { door, bananaMesh, salmonMesh } from './rooms';
import { mulberry32 } from '../core/noise';

const OX = missionX(1), OY = 40, OZ = 0;
const UP = 4.5;                                  // rooms C, D, the vault and the corridor are up at catwalk level
const SYM = ['●', '▲', '■', '◆', '★', '✚'], SYM_COL = ['#ff6b4a', '#ffd23f', '#3fd6ff', '#7dff6b', '#e86bff', '#ffffff'];
const WAYPOINTS: [number, number][] = [[-5, -15], [5, -15], [5, -21], [-1, -21], [-1, -27], [5, -27], [-5, -27], [-5, -21]];
const GUARD_SPEED = 1.25, VIEW = 7.5, FOV = Math.cos(THREE.MathUtils.degToRad(33));
const ALARM_T = 90, HINT_EVERY = 75;
const STATUES: [number, number][] = [[-3, -34], [3, -34], [-3, -40], [3, -40]];
const KEYPAD = { x: 2.6, y: UP + 1.4, z: -43.88 };
const GATES = [14, 24];

type St = { beams: number; ladder: number; door: number; vault: number; alarm: number; painting: number; outGate: number; esc: number };
type Guard = { x: number; z: number; yaw: number; wp: number; mode: 'walk' | 'look' | 'go' | 'search'; t: number; tx: number; tz: number };

export class Museum implements Mission {
  readonly index = 1;
  readonly space = new Space(OX, OY, OZ, 80);
  readonly group = new THREE.Group();
  readonly outro = 'm2_outro';
  readonly dark = true;
  readonly grabs: Grabs;
  private ctx!: Ctx;
  // ---- the level's state (the same on every client)
  private st: St = { beams: 1, ladder: 0, door: 0, vault: 0, alarm: 0, painting: 0, outGate: 0, esc: 0 };
  private statueR = [0, 0, 0, 0];
  private code: number[] = [0, 0, 0, 0];
  private entry: number[] = [];
  private gate = [0, 0];           // 0 down, 1 held up, 2 propped open
  private gateBy = [-1, -1];
  private escaped = new Set<number>();
  private caught = 0;
  private alarmT = 0;
  private guard: Guard = { x: -5, z: -15, yaw: 0, wp: 0, mode: 'walk', t: 0, tx: 0, tz: 0 };
  private gShown = { x: -5, z: -15, yaw: 0 };
  private gSend = 0;
  private seen = 0; private hmmCd = 0;
  private touchCd = 0;
  private hintT = 0; private hintI = 0;
  private said = new Set<string>();
  private won = false;
  private ballNoise = false;
  // ---- scenery that moves
  private beamM: THREE.Group; private beamBox: ReturnType<Space['add']>;
  private ladderM: THREE.Group; private doorM: THREE.Group; private doorBox: ReturnType<Space['add']>;
  private vaultM: THREE.Group; private vaultBox: ReturnType<Space['add']>; private escDoorM: THREE.Group; private escBox: ReturnType<Space['add']>;
  private statueM: THREE.Group[] = [];
  private gateM: THREE.Group[] = []; private gateBox: ReturnType<Space['add']>[] = [];
  private paintM: THREE.Group;
  private codeBoards: Board[] = [];
  private keyBoard: Board;
  private guardM: { root: THREE.Group; legs: THREE.Group[]; cone: THREE.Mesh };
  private alarmLights: THREE.Mesh[] = [];
  private ball!: Grab; private trophies: Grab[] = [];
  private hud: HTMLDivElement;
  private t = 0;

  constructor(scene: THREE.Scene) {
    const M = new Mesher(), sp = this.space;
    this.grabs = new Grabs(sp, 1);
    this.group.add(this.grabs.group);
    const wallC = '#5e5870', wallC2 = '#4c465c', floorC = '#6a5848', trim = '#c9a24a';
    const wall = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c = wallC) => { M.box(x1 - x0, y1 - y0, z1 - z0, c, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); sp.add(x0, x1, y0, y1, z0, z1); };
    const floor = (x0: number, x1: number, z0: number, z1: number, y: number, c = floorC) => { M.box(x1 - x0, 0.1, z1 - z0, c, (x0 + x1) / 2, y - 0.05, (z0 + z1) / 2); if (y > 0) sp.add(x0, x1, y - 0.1, y, z0, z1); };
    const ceil = (x0: number, x1: number, z0: number, z1: number, y: number) => { M.box(x1 - x0, 0.1, z1 - z0, '#2a2632', (x0 + x1) / 2, y + 0.05, (z0 + z1) / 2); sp.add(x0, x1, y, y + 1, z0, z1); };
    // ---- A: the gallery (x -6..6, z 0..12), paintings and a doorway north into B
    floor(-6, 6, 0, 12, 0); ceil(-6, 6, 0, 12, 4.2);
    wall(-6.3, -6, 0, 4.2, 0, 12); wall(6, 6.3, 0, 4.2, 0, 12); wall(-6, 6, 0, 4.2, 12, 12.3);
    wall(-6, -1, 0, 4.2, -0.15, 0.15, wallC2); wall(1, 6, 0, 4.2, -0.15, 0.15, wallC2); wall(-1, 1, 2.6, 4.2, -0.15, 0.15, wallC2);
    for (let i = 0; i < 4; i++) for (const s of [-1, 1]) {
      const z = 2.5 + i * 2.6, c = ['#8a3a3a', '#3a5a8a', '#4a7a3a', '#8a6a2a'][i];
      M.box(0.06, 1.3, 1.6, trim, s * 5.95, 1.9, z); M.box(0.07, 1.1, 1.4, c, s * 5.94, 1.9, z);
      M.box(0.08, 0.5, 0.6, '#e8d9b0', s * 5.93, 1.9 + (i % 2 ? 0.1 : -0.15), z + 0.2);
    }
    door(M, this.group, 0, 11.92, -1, '#5a4a8a', 'Back to the cosy room');
    const gs = sign(['GALLERY ONE', 'Modern Fruit'], 2.2, 0.6, '#2a2632', '#e8d9b0', trim); gs.position.set(0, 3.3, 0.17); this.group.add(gs);
    // the sensor beams across the doorway: a gorilla bumps into them, a cat walks under the lowest one
    this.beamBox = sp.add(-1, 1, 0.42, 2.6, -0.12, 0.12, 'beams');
    this.beamM = new THREE.Group();
    for (let k = 0; k < 8; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.015, 0.015), new THREE.MeshBasicMaterial({ color: '#ff2a2a' })); b.position.set(0, 0.45 + k * 0.28, 0); b.frustumCulled = false; this.beamM.add(b); }
    this.group.add(this.beamM);
    for (const s of [-1, 1]) M.box(0.12, 2.5, 0.12, '#222', s * 1.04, 1.25, 0);
    // the paw switch, on the floor just beyond the beams (in B)
    M.box(0.3, 0.06, 0.3, '#333', -2.5, 0.03, -0.45); M.cyl(0.08, 0.08, 0.05, '#ff3a3a', -2.5, 0.08, -0.45, 1, 1, 12);
    const ps = sign(['PAW SWITCH', 'beams off'], 0.5, 0.18, '#222', '#ffd9d0'); ps.position.set(-2.5, 0.3, -0.17); ps.rotation.y = Math.PI; this.group.add(ps);
    // ---- B: the climbing hall (x -6..6, z -12..0), 8 m tall, catwalk along the north wall at 4.5 m
    floor(-6, 6, -12, 0, 0); ceil(-6, 6, -12, 0, 8);
    wall(-6.3, -6, 0, 8, -12, 0); wall(6, 6.3, 0, 8, -12, 0); wall(-6, 6, 4.2, 8, -0.15, 0.15, wallC2);
    wall(-6, 6, 0, UP, -12.15, -11.85, wallC2); wall(-6, -1, UP, 8, -12.15, -11.85, wallC2); wall(1, 6, UP, 8, -12.15, -11.85, wallC2); wall(-1, 1, UP + 2.6, 8, -12.15, -11.85, wallC2);
    M.box(12, 0.2, 2.1, '#6a6a72', 0, UP - 0.1, -10.95); sp.add(-6, 6, UP - 0.2, UP, -12, -9.9);
    for (let x = -5.5; x <= 5.5; x += 0.5) if (Math.abs(x - 3) > 0.6 && Math.abs(x + 3) > 0.6) M.box(0.04, 1.0, 0.04, '#9a9aa2', x, UP + 0.5, -9.92);
    for (const [a, b] of [[-6, -3.6], [-2.4, 2.4], [3.6, 6]]) M.box(b - a, 0.05, 0.05, '#9a9aa2', (a + b) / 2, UP + 1.0, -9.92);
    sp.add(-6, -3.6, UP, UP + 1.05, -9.97, -9.87); sp.add(-2.4, 2.4, UP, UP + 1.05, -9.97, -9.87); sp.add(3.6, 6, UP, UP + 1.05, -9.97, -9.87);      // railing (gaps at the rope and the ladder)
    // the rope (gorillas climb it: hold jump)
    M.cyl(0.05, 0.05, 8, '#b08a4a', 3, 4, -9.7, 1, 1, 8);
    for (let y = 0.6; y < 8; y += 0.6) M.sph(0.08, '#9a7a3a', 3, y, -9.7, 1, 0.6, 1, 6);
    // (the rope hangs just off the catwalk's edge: you can grab it from anywhere in front of it, however broad you are, and at
    //  the top you are hauled through the gap in the railing onto the catwalk, not left hanging over the drop)
    sp.climbs.push({ x0: 2.4, x1: 3.6, z0: -10.1, z1: -8.9, y0: 0, top: UP, land: { x: 3, z: -10.75 }, ok: () => this.ctx?.species() === 'g' || !!this.ctx?.helper('g') });
    const cs = sign(['CLIMBING HALL', 'great apes of the world'], 2.4, 0.6, '#2a2632', '#e8d9b0', trim); cs.position.set(0, 3.2, -0.17); cs.rotation.y = Math.PI; this.group.add(cs);
    // the lever on the catwalk and the rope ladder it drops (for everybody)
    M.box(0.3, 1.0, 0.2, '#555', -3, UP + 0.5, -11.7); M.cyl(0.03, 0.03, 0.6, '#c22', -3, UP + 1.2, -11.6, 1, 1, 8, -0.5);
    this.ladderM = new THREE.Group();
    const lm = new Mesher(); for (const s of [-1, 1]) lm.cyl(0.03, 0.03, UP, '#b08a4a', s * 0.25, UP / 2, 0, 1, 1, 6); for (let y = 0.3; y < UP; y += 0.35) lm.box(0.55, 0.04, 0.06, '#8a6a3a', 0, y, 0);
    this.ladderM.add(bake(lm, 0.7)); this.ladderM.position.set(-3, 0, -9.75); this.group.add(this.ladderM);
    sp.climbs.push({ x0: -3.6, x1: -2.4, z0: -10.1, z1: -8.9, y0: 0, top: UP, land: { x: -3, z: -10.75 }, ok: () => !!this.st.ladder });
    // ---- C: the sculpture gallery (x -8..8, z -30..-12) at catwalk level, the guard's beat
    floor(-8, 8, -30, -12, UP); ceil(-8, 8, -30, -12, UP + 4);
    wall(-8.3, -8, UP, UP + 4, -30, -12); wall(8, 8.3, UP, UP + 4, -30, -12);
    wall(-8, -1, UP, UP + 4, -12.15, -11.85, wallC2); wall(1, 8, UP, UP + 4, -12.15, -11.85, wallC2);
    // display cases (the guard cannot see through them)
    for (const [x, z] of [[-2, -18], [2.5, -18.5], [-4, -24], [1.8, -24], [5.5, -24.5]] as [number, number][]) {
      M.box(1.2, 1.15, 1.2, '#2a2620', x, UP + 0.57, z); M.box(1.0, 0.7, 1.0, '#9ad0ff', x, UP + 1.5, z);
      M.sph(0.25, ['#d9a93a', '#c86bff', '#3fd6ff', '#ff6b4a', '#7dff6b'][(x * 7 + z) & 3 & 7], x, UP + 1.45, z);
      sp.add(x - 0.6, x + 0.6, UP, UP + 1.9, z - 0.6, z + 0.6);
    }
    // the drum (bang it: the guard comes to look) and steps up to the air duct on the west wall
    M.cyl(0.55, 0.55, 0.8, '#a83a2a', 7.2, UP + 0.4, -21, 1, 1, 16); M.cyl(0.57, 0.57, 0.05, '#e8d9b0', 7.2, UP + 0.82, -21, 1, 1, 16);
    sp.add(6.65, 7.75, UP, UP + 0.85, -21.55, -20.45);
    const ds = sign(['THE GREAT DRUM', 'please do not bang'], 1.4, 0.4, '#2a2632', '#e8d9b0', trim); ds.position.set(7.92, UP + 1.6, -21); ds.rotation.y = -Math.PI / 2; this.group.add(ds);
    M.box(0.8, 0.8, 0.8, '#6a5a4a', -7.5, UP + 0.4, -13); sp.add(-7.9, -7.1, UP, UP + 0.8, -13.4, -12.6);
    M.box(0.8, 1.6, 0.8, '#5a4a3a', -7.5, UP + 0.8, -14.2); sp.add(-7.9, -7.1, UP, UP + 1.6, -14.6, -13.8);
    // the air duct: along the west wall at 2.4 m, from above the steps (z -14.6) into room D (z -32)
    const DY = UP + 2.4, DX0 = -8, DX1 = -7.2;
    M.box(0.9, 0.1, 17.6, '#8a949d', -7.6, DY - 0.05, -23.4); M.box(0.9, 0.1, 17.6, '#8a949d', -7.6, DY + 0.55, -23.4); M.box(0.06, 0.6, 17.6, '#7a848d', DX1 + 0.03, DY + 0.25, -23.4);
    sp.add(DX0, DX1 + 0.06, DY - 0.1, DY, -32.2, -14.6); sp.add(DX0, DX1 + 0.06, DY + 0.5, DY + 0.6, -32.2, -14.6); sp.add(DX1, DX1 + 0.06, DY, DY + 0.5, -32.2, -14.6);
    const vs = sign(['AIR VENT'], 0.8, 0.22, '#8a949d', '#222'); vs.position.set(-7.6, DY + 0.75, -14.55); vs.rotation.y = Math.PI; this.group.add(vs);
    // the door into D (locked: the lever is on the far side)
    wall(-8, -1, UP, UP + 4, -30.15, -29.85, wallC2); wall(1, 8, UP, UP + 4, -30.15, -29.85, wallC2); wall(-1, 1, UP + 2.5, UP + 4, -30.15, -29.85, wallC2);
    this.doorBox = sp.add(-1, 1, UP, UP + 2.5, -30.1, -29.9, 'door');
    this.doorM = new THREE.Group();
    const dm = new Mesher(); for (let k = -4; k <= 4; k++) dm.box(0.06, 2.5, 0.06, '#9a9aa2', k * 0.24, 1.25, 0); dm.box(2.0, 0.1, 0.08, '#9a9aa2', 0, 0.1, 0); dm.box(2.0, 0.1, 0.08, '#9a9aa2', 0, 2.4, 0);
    this.doorM.add(bake(dm, 0.8)); this.doorM.position.set(0, UP, -30); this.group.add(this.doorM);
    M.box(0.25, 0.5, 0.15, '#444', 1.6, UP + 1.2, -30.3); M.cyl(0.03, 0.03, 0.4, '#c22', 1.6, UP + 1.55, -30.35, 1, 1, 8, 0.4);
    // ---- D: the vault antechamber (x -6..6, z -44..-30), four statues, the painting with the crawlspace, the keypad
    floor(-6, 6, -44, -30, UP); ceil(-6, 6, -44, -30, UP + 4);
    wall(6, 6.3, UP, UP + 4, -44, -38); wall(6, 6.3, UP + 2.6, UP + 4, -38, -36); wall(6, 6.3, UP, UP + 4, -36, -30);
    wall(-6.3, -6, UP, UP + 4, -44, -37.4); wall(-6.3, -6, UP, UP + 4, -36.6, -30); wall(-6.3, -6, UP + 0.36, UP + 4, -37.4, -36.6);
    // the crawlspace behind the painting (cat height), its back wall has the code on it
    floor(-7.6, -6.3, -38, -36, UP); M.box(1.4, 0.1, 2.2, '#2a2632', -6.95, UP + 0.65, -37); sp.add(-7.7, -6.2, UP + 0.6, UP + 0.7, -38, -36);
    wall(-7.7, -7.6, UP, UP + 0.7, -38, -36, '#2a2632'); wall(-7.6, -6.3, UP, UP + 0.7, -38.1, -38, '#2a2632'); wall(-7.6, -6.3, UP, UP + 0.7, -36, -35.9, '#2a2632');
    // the vault wall (north) with the round vault door
    wall(-6, -1.3, UP, UP + 4, -44.3, -44); wall(1.3, 6, UP, UP + 4, -44.3, -44); wall(-1.3, 1.3, UP + 2.6, UP + 4, -44.3, -44);
    this.vaultBox = sp.add(-1.3, 1.3, UP, UP + 2.6, -44.2, -44.0, 'vault');
    this.vaultM = new THREE.Group();
    const vm = new Mesher(); vm.cyl(1.25, 1.25, 0.3, '#9aa0a8', 0, 0, 0, 1, 1, 24, Math.PI / 2); vm.cyl(0.35, 0.35, 0.4, '#5a6068', 0, 0, 0.05, 1, 1, 12, Math.PI / 2);
    for (let k = 0; k < 4; k++) vm.box(0.08, 0.9, 0.08, '#5a6068', Math.cos(k * Math.PI / 2) * 0.4, Math.sin(k * Math.PI / 2) * 0.4, 0.2, 0, 0, k * Math.PI / 2);
    this.vaultM.add(bake(vm, 0.9)); this.vaultM.position.set(0, UP + 1.3, -44.0); this.group.add(this.vaultM);
    M.box(0.6, 0.6, 0.06, '#222', KEYPAD.x, KEYPAD.y, -43.97);
    for (let i = 0; i < 6; i++) M.box(0.14, 0.14, 0.04, '#3a3a3a', KEYPAD.x - 0.18 + (i % 3) * 0.18, KEYPAD.y + 0.1 - Math.floor(i / 3) * 0.2, -43.93);
    const vt = sign(['THE VAULT', 'staff only'], 2.0, 0.5, '#2a2632', '#e8d9b0', trim); vt.position.set(0, UP + 3.2, -43.84); this.group.add(vt);
    // statue plinths
    for (const [x, z] of STATUES) { M.cyl(0.6, 0.65, 0.4, '#8a847a', x, UP + 0.2, z, 1, 1, 16); sp.add(x - 0.6, x + 0.6, UP, UP + 2.2, z - 0.6, z + 0.6); }
    const st = sign(['FOUR WISE STATUES', 'they all face what they treasure'], 2.6, 0.6, '#2a2632', '#e8d9b0', trim); st.position.set(0, UP + 3.0, -30.17); st.rotation.y = Math.PI; this.group.add(st);
    // ---- the vault itself (x -3..3, z -50..-44): two pedestals
    floor(-3, 3, -50, -44, UP, '#3a3a40'); ceil(-3, 3, -50, -44, UP + 3);
    wall(-3.3, -3, UP, UP + 3, -50, -44); wall(3, 3.3, UP, UP + 3, -50, -44); wall(-3, 3, UP, UP + 3, -50.3, -50);
    for (const x of [-1.2, 1.2]) { M.cyl(0.35, 0.4, 1.0, '#e8d9b0', x, UP + 0.5, -48, 1, 1, 14); sp.add(x - 0.4, x + 0.4, UP, UP + 1.0, -48.4, -47.6); }
    // ---- E: the staff corridor (x 6..34, z -38..-36), out to the dawn
    floor(6, 34, -38, -36, UP, '#4a4a50'); ceil(6, 34, -38, -36, UP + 2.6);
    wall(6, 34, UP, UP + 2.6, -38.3, -38, wallC2); wall(6, 34, UP, UP + 2.6, -36, -35.7, wallC2); wall(34, 34.3, UP, UP + 2.6, -38, -36);
    this.escBox = sp.add(6.0, 6.3, UP, UP + 2.6, -38, -36, 'esc');
    this.escDoorM = new THREE.Group();
    const em = new Mesher(); em.box(0.12, 2.6, 2.0, '#7a6a5a', 0, 1.3, 0); em.box(0.14, 0.4, 0.8, '#2a8a3a', 0, 2.1, 0);
    this.escDoorM.add(bake(em, 0.8)); this.escDoorM.position.set(6.15, UP, -37); this.group.add(this.escDoorM);
    const ex = sign(['EXIT', 'staff only'], 1.2, 0.4, '#1f7a3a', '#fff'); ex.position.set(5.9, UP + 2.9, -37); ex.rotation.y = -Math.PI / 2; this.group.add(ex);
    M.box(0.1, 2.6, 2.0, '#fff2c8', 33.95, UP + 1.3, -37);   // daylight at the end
    for (const gx of GATES) {
      M.box(0.2, 2.6, 0.2, '#555', gx, UP + 1.3, -37.9); M.box(0.2, 2.6, 0.2, '#555', gx, UP + 1.3, -36.1);
      const g = new THREE.Group(); const sm = new Mesher();
      sm.box(0.5, 2.4, 1.8, '#6b4428', 0, 1.2, 0); for (const y of [0.3, 0.9, 1.5, 2.1]) for (let k = 0; k < 5; k++) sm.box(0.3, 0.3, 0.25, ['#c86bff', '#ffd23f', '#3fd6ff', '#ff6b4a', '#7dff6b'][(k + y * 3) % 5 | 0], 0.12, y + 0.16, -0.7 + k * 0.35);
      g.add(bake(sm, 0.8)); g.position.set(gx, UP, -37); this.group.add(g); this.gateM.push(g);
      this.gateBox.push(sp.add(gx - 0.25, gx + 0.25, UP, UP + 2.6, -38, -36, 'gate'));
      M.box(0.2, 0.5, 0.15, '#444', gx + 1.2, UP + 1.0, -35.9); M.cyl(0.03, 0.03, 0.35, '#2a8a3a', gx + 1.2, UP + 1.3, -35.95, 1, 1, 8, 0.4);   // the prop lever beyond each shelf
    }
    // a few lamps (it is dark in a museum at night)
    for (const [x, y, z] of [[0, 4.1, 6], [0, 7.9, -6], [0, UP + 3.9, -21], [0, UP + 3.9, -37], [20, UP + 2.5, -37]] as [number, number, number][]) M.box(0.6, 0.05, 0.6, '#fff2c8', x, y, z);
    this.group.add(bake(M, 0.9));

    // statues, the painting, code boards, keypad display, the guard, alarm lights, things to grab
    const rnd = mulberry32(7);
    for (const [x, z] of STATUES) {
      const g = new THREE.Group(); const s = new Mesher(), c = '#c8c0b0';
      s.box(0.5, 0.9, 0.35, c, 0, 0.85, 0); s.sph(0.2, c, 0, 1.5, 0); s.box(0.08, 0.1, 0.14, '#b0a898', 0, 1.48, -0.22);   // nose: faces -z
      s.box(0.14, 0.6, 0.14, c, -0.32, 0.9, -0.12, -0.6); s.box(0.14, 0.6, 0.14, c, 0.32, 0.9, -0.12, -0.6);             // arms reaching out front
      s.box(0.18, 0.5, 0.2, c, -0.13, 0.25, 0); s.box(0.18, 0.5, 0.2, c, 0.13, 0.25, 0);
      g.add(bake(s, 0.85 + rnd() * 0.1)); g.position.set(x, UP + 0.4, z); this.group.add(g); this.statueM.push(g);
    }
    this.paintM = new THREE.Group();
    const pm = new Mesher(); pm.box(0.08, 1.4, 1.8, trim, 0, 0, 0); pm.box(0.09, 1.2, 1.6, '#3a5a8a', 0, 0, 0); pm.sph(0.3, '#ffd23f', 0.05, 0.1, 0.2, 0.3, 1, 1); pm.box(0.1, 0.4, 0.8, '#2a4a2a', 0.05, -0.35, -0.2);
    this.paintM.add(bake(pm, 0.9)); this.paintM.position.set(-5.95, UP + 1.6, -37); this.group.add(this.paintM);
    const cb = new Board(1.3, 0.42, 512); cb.mesh.position.set(-7.58, UP + 0.28, -37); cb.mesh.rotation.y = Math.PI / 2; this.group.add(cb.mesh); this.codeBoards.push(cb);
    const cb2 = new Board(1.2, 0.4, 512); cb2.mesh.position.set(-5.94, UP + 1.6, -37); cb2.mesh.rotation.y = Math.PI / 2; cb2.mesh.visible = false; this.group.add(cb2.mesh); this.codeBoards.push(cb2);
    this.keyBoard = new Board(0.9, 0.25, 512); this.keyBoard.mesh.position.set(KEYPAD.x, KEYPAD.y + 0.5, -43.95); this.group.add(this.keyBoard.mesh);
    for (let i = 0; i < 6; i++) {
      const b = sign([SYM[i]], 0.13, 0.13, '#3a3a3a', SYM_COL[i], '#3a3a3a'); b.position.set(KEYPAD.x - 0.18 + (i % 3) * 0.18, KEYPAD.y + 0.1 - Math.floor(i / 3) * 0.2, -43.9); this.group.add(b);
    }
    this.guardM = this.buildGuard();
    for (const [x, z] of [[-5, 10], [5, -6], [-7, -20], [0, -32], [20, -37]] as [number, number][]) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshBasicMaterial({ color: '#400' }));
      m.position.set(x, (z < -12 ? UP + 3.7 : z < 0 ? 7.6 : 3.9), z); m.frustumCulled = false; this.group.add(m); this.alarmLights.push(m);
    }
    const ball = new Mesher(); ball.sph(0.13, '#e8443a', 0, 0.13, 0, 1, 1, 1, 12); ball.box(0.27, 0.03, 0.03, '#fff', 0, 0.13, 0);
    const bg = new THREE.Group(); bg.add(bake(ball, 1.1));
    this.ball = this.grabs.add({ name: 'A bouncy ball', kind: 'light', mesh: bg, x: -5.5, y: UP, z: -13, r: 0.15 });
    const tb = new Mesher(); bananaMesh(tb, 0, 0, 0, 1.0); const tbg = new THREE.Group(); const tbm = bake(tb, 1.0); tbm.material = new THREE.MeshBasicMaterial({ color: '#ffd23f' }); tbg.add(tbm);
    const tf = new Mesher(); salmonMesh(tf, 0, 0, 0, 0.8); const tfg = new THREE.Group(); const tfm = bake(tf, 1.0); tfm.material = new THREE.MeshBasicMaterial({ color: '#ffcc33' }); tfg.add(tfm);
    this.trophies = [
      this.grabs.add({ name: 'The Golden Banana', kind: 'trophy', mesh: tbg, x: -1.2, y: UP + 1.0, z: -48, r: 0.25 }),
      this.grabs.add({ name: 'The Golden Fish', kind: 'trophy', mesh: tfg, x: 1.2, y: UP + 1.0, z: -48, r: 0.25 }),
    ];

    this.group.position.set(OX, OY, OZ); this.group.visible = false;
    scene.add(this.group);
    this.hud = document.createElement('div');
    this.hud.style.cssText = 'position:fixed;left:50%;top:70px;transform:translateX(-50%);z-index:5;display:none;color:#fff;font:700 17px system-ui,sans-serif;text-align:center;text-shadow:0 1px 5px rgba(0,0,0,.85);pointer-events:none;letter-spacing:.02em';
    document.body.appendChild(this.hud);
  }

  private buildGuard() {
    const root = new THREE.Group(); this.group.add(root);
    const B = new Mesher();
    B.box(0.5, 0.65, 0.3, '#23304a', 0, 1.15, 0); B.box(0.52, 0.08, 0.32, '#111', 0, 0.85, 0);
    B.sph(0.17, '#e8b88c', 0, 1.65, 0); B.cyl(0.19, 0.2, 0.1, '#23304a', 0, 1.82, 0, 1, 1, 12); B.box(0.24, 0.03, 0.14, '#111', 0, 1.78, -0.15);
    B.sph(0.02, '#222', -0.06, 1.68, -0.15); B.sph(0.02, '#222', 0.06, 1.68, -0.15); B.box(0.16, 0.03, 0.03, '#7a5a3a', 0, 1.58, -0.16);   // eyes and a moustache
    B.box(0.13, 0.55, 0.13, '#23304a', -0.33, 1.15, 0); B.box(0.13, 0.5, 0.13, '#23304a', 0.33, 1.2, -0.15, -0.8);
    B.cyl(0.04, 0.05, 0.25, '#333', 0.33, 1.32, -0.42, 1, 1, 8, Math.PI / 2); B.box(0.08, 0.06, 0.03, '#ffd23f', 0.15, 1.3, -0.16);
    root.add(bake(B, 0.9));
    const legs: THREE.Group[] = [];
    for (const s of [-1, 1]) { const l = new THREE.Group(); l.position.set(s * 0.13, 0.85, 0); const L = new Mesher(); L.box(0.18, 0.8, 0.2, '#1a2236', 0, -0.4, 0); L.box(0.2, 0.08, 0.3, '#111', 0, -0.82, -0.04); l.add(bake(L, 0.9)); root.add(l); legs.push(l); }
    // the torch beam: a soft cone along -z
    const cone = new THREE.Mesh(new THREE.ConeGeometry(Math.tan(Math.acos(FOV)) * VIEW, VIEW, 24, 1, true), new THREE.MeshBasicMaterial({ color: '#fff3b0', transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }));
    cone.rotation.x = -Math.PI / 2; cone.position.set(0.33, 1.32, -0.42 - VIEW / 2); cone.frustumCulled = false; root.add(cone);
    return { root, legs, cone };
  }

  // ------------------------------------------------------------ a run
  begin(rid: number, ctx: Ctx) {
    this.ctx = ctx; void rid;
    const rnd = mulberry32(rid);
    this.grabs.reset();
    this.st = { beams: 1, ladder: 0, door: 0, vault: 0, alarm: 0, painting: 0, outGate: 0, esc: 0 };
    this.statueR = STATUES.map(() => 1 + Math.floor(rnd() * 3));
    this.code = [0, 1, 2, 3].map(() => Math.floor(rnd() * 6));
    this.entry = []; this.gate = [0, 0]; this.gateBy = [-1, -1]; this.escaped.clear(); this.caught = 0; this.alarmT = 0;
    this.guard = { x: -5, z: -15, yaw: 0, wp: 0, mode: 'walk', t: 0, tx: 0, tz: 0 }; this.gShown = { x: -5, z: -15, yaw: 0 };
    this.seen = 0; this.hintT = 0; this.hintI = 0; this.said.clear(); this.won = false; this.ballNoise = false;
    this.apply();
    this.codeBoards.forEach((b) => b.draw(this.code.join(','), (g, W, H) => {
      g.fillStyle = '#16121e'; g.fillRect(0, 0, W, H);
      g.font = `800 ${Math.round(H * 0.7)}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      this.code.forEach((c, i) => { g.fillStyle = SYM_COL[c]; g.fillText(SYM[c], W * (0.14 + i * 0.24), H * 0.55); });
    }));
    ctx.narrate('m2_intro', { interrupt: true, priority: 2 });
  }
  enter() { this.group.visible = true; const a = (this.ctx.me() % 4) - 1.5; this.ctx.player.teleport(OX + a * 0.8, OY, OZ + 10, 0); }
  leave() { const g = this.grabs.mine; if (g) this.grabs.drop(g, this.ctx.me(), (e) => this.ctx.send(e), 0, 0, 0); this.hud.style.display = 'none'; }

  private apply() {
    const s = this.st;
    this.beamBox.off = !s.beams; this.beamM.visible = !!s.beams;
    this.ladderM.scale.y = s.ladder ? 1 : 0.05; this.ladderM.position.y = s.ladder ? 0 : UP - 0.2;
    this.doorBox.off = !!s.door; this.doorM.position.y = s.door ? UP + 2.45 : UP;
    this.vaultBox.off = !!s.vault; this.vaultM.rotation.y = s.vault ? -1.7 : 0; this.vaultM.position.x = s.vault ? -1.25 : 0;
    this.escBox.off = !!s.alarm; this.escDoorM.visible = !s.alarm;
    this.statueM.forEach((m, i) => { m.rotation.y = -this.statueR[i] * Math.PI / 2; });
    this.paintM.rotation.z = s.painting ? -1.2 : 0; this.paintM.position.y = UP + (s.painting ? 2.3 : 1.6);
    this.codeBoards[1].mesh.visible = !!s.painting;
    this.gate.forEach((v, i) => { this.gateBox[i].off = v === 2; this.gateBox[i].y0 = UP + (v === 1 ? 1.05 : this.soloCat() ? 0.42 : 0); this.gateM[i].position.y = UP + (v === 2 ? 2.3 : v === 1 ? 1.05 : 0); this.gateM[i].visible = !!s.alarm || v === 2; if (!s.alarm) this.gateBox[i].off = true; });
  }
  /** the solo cat squeezes through the gaps in fallen shelves */
  private soloCat() { return !!this.ctx && this.ctx.species() === 'c' && this.ctx.helper('g'); }
  private set(k: keyof St, v: number, quiet = false) {
    if (this.st[k] === v) return;
    this.st[k] = v; this.apply(); this.hintT = 0;
    if (!quiet) this.ctx.send({ k: 'qp', m: 1, s: k, v });
    this.onState(k, v);
  }
  /** lines and sounds when something changes (on every client) */
  private onState(k: string, v: number) {
    const c = this.ctx;
    if (k === 'beams' && !v) { c.narrate('m2_beams_off', { priority: 1 }); c.sfx.zap(); }
    if (k === 'ladder' && v) { c.narrate('m2_ladder', { priority: 1 }); c.sfx.creak(); }
    if (k === 'door' && v) c.sfx.clang();
    if (k === 'vault' && v) { c.narrate('m2_vault', { priority: 2 }); c.sfx.creak(); }
    if (k === 'alarm' && v) { c.narrate('m2_alarm', { interrupt: true, priority: 3 }); c.narrate('m2_shelf', { priority: 2 }); c.sfx.alarm(); this.alarmT = ALARM_T; }
  }
  private once(id: string, o?: { interrupt?: boolean; priority?: number }) { if (this.said.has(id)) return; this.said.add(id); this.ctx.narrate(id, o); }

  // ------------------------------------------------------------ aiming
  private L(v: { x: number; y: number; z: number }) { return this._l.set(v.x - OX, v.y - OY, v.z - OZ); }
  private _l = new THREE.Vector3(); private _c = new THREE.Vector3(); private _d = new THREE.Vector3();
  private gor() { return this.ctx.species() === 'g' || this.ctx.helper('g'); }
  pick(eye: THREE.Vector3, dir: THREE.Vector3, reach: number, assist: number): { t: MTarget; dist: number } | null {
    if (this.grabs.mine) return { t: { w: 'held' }, dist: 0 };
    const le = this.L(eye), sp = this.ctx.species(), r = Math.max(reach, sp === 'g' ? 2.6 : 1.6);
    let best: { t: MTarget; dist: number } | null = null;
    const take = (t: MTarget, d: number | null) => { if (d != null && (!best || d < best.dist)) best = { t, dist: d }; };
    const gp = this.grabs.pick(le, dir, r, assist);
    if (gp && (gp.g.kind !== 'trophy' || this.st.vault)) take({ w: 'grab', i: gp.g.i }, gp.dist);
    take({ w: 'exit' }, rayHit(le, dir, 0, 1.2, 11.9, 1.0, Math.max(reach, 3.2), assist));
    if (this.st.beams) take({ w: 'switch' }, rayHit(le, dir, -2.5, 0.1, -0.45, 0.3, 2.2, assist));
    if (!this.st.ladder) take({ w: 'lever' }, rayHit(le, dir, -3, UP + 1.0, -11.65, 0.45, 2.6, assist));
    if (!this.st.door) take({ w: 'doorlever' }, rayHit(le, dir, 1.6, UP + 1.35, -30.3, 0.4, 2.6, assist));
    take({ w: 'drum' }, rayHit(le, dir, 7.2, UP + 0.6, -21, 0.7, 3.0, assist));
    STATUES.forEach(([x, z], i) => take({ w: 'statue', i }, rayHit(le, dir, x, UP + 1.3, z, 0.7, 3.0, assist)));
    take({ w: 'painting' }, rayHit(le, dir, -5.95, UP + 1.6, -37, 0.8, 3.0, assist));
    if (!this.st.vault) for (let i = 0; i < 6; i++) take({ w: 'key', i }, rayHit(le, dir, KEYPAD.x - 0.18 + (i % 3) * 0.18, KEYPAD.y + 0.1 - Math.floor(i / 3) * 0.2, -43.9, 0.085, 3.0, assist));
    if (this.st.alarm) GATES.forEach((gx, i) => {
      if (this.gate[i] < 2) { take({ w: 'gate', i }, rayHit(le, dir, gx, UP + 1.2, -37, 0.8, 2.4, assist)); take({ w: 'prop', i }, rayHit(le, dir, gx + 1.2, UP + 1.2, -35.95, 0.35, 2.4, assist)); }
    });
    return best;
  }
  prompt(t: MTarget): { name: string; hint: string; ok: boolean } {
    const vr = this.ctx.inVR();
    switch (t.w) {
      case 'held': { const g = this.grabs.mine!; return { name: `Carrying: ${g.name}`, hint: vr ? 'Let go of the trigger to drop · swing to throw' : '<b>E</b> put down · <b>Click</b> throw', ok: true }; }
      case 'exit': return { name: 'Museum door', hint: '<b>E</b> give up and go back to the cosy room', ok: true };
      case 'grab': { const g = this.grabs.list[t.i]; return { name: g.name, hint: g.kind === 'trophy' && !this.st.alarm ? '<b>E</b> take it (careful...)' : '<b>E</b> / <b>Click</b> pick up', ok: true }; }
      case 'switch': { const inB = this.L(this.ctx.player.pos).z < 0; return inB || this.ctx.helper('c') ? { name: 'Paw switch', hint: '<b>E</b> press it · beams off', ok: true } : { name: 'Paw switch', hint: 'Behind the beams. Something small could slip under.', ok: false }; }
      case 'lever': return { name: 'Lever', hint: '<b>E</b> pull it', ok: true };
      case 'doorlever': return this.L(this.ctx.player.pos).z < -30 || this.ctx.helper('c') ? { name: 'Door lever', hint: '<b>E</b> pull it · open the door', ok: true } : { name: 'Locked door', hint: 'The lever is on the other side', ok: false };
      case 'drum': return this.gor() ? { name: 'The Great Drum', hint: '<b>E</b> BANG it · the guard will come and look', ok: true } : { name: 'The Great Drum', hint: 'Too big for paws', ok: false };
      case 'statue': return this.gor() ? { name: 'Heavy statue', hint: `<b>E</b> turn it a quarter${this.statueR[t.i] === 0 ? ' · facing the vault ✓' : ''}`, ok: true } : { name: 'Heavy statue', hint: 'Far too heavy for a cat', ok: false };
      case 'painting': return this.st.painting ? { name: 'Lifted painting', hint: 'The code is on the wall', ok: true } : this.ctx.species() === 'g' && this.ctx.helper('c') ? { name: 'A painting', hint: '<b>E</b> lift it and look behind', ok: true } : { name: 'A painting', hint: 'There is a little gap under it...', ok: false };
      case 'key': return { name: `Keypad ${SYM[t.i]}`, hint: `<b>E</b> / click · press ${SYM[t.i]}  (${this.entry.map((e) => SYM[e]).join(' ') || 'enter 4 symbols'})`, ok: true };
      case 'gate': return this.gate[t.i] === 1 ? { name: 'Fallen shelf (held up)', hint: this.gateBy[t.i] === this.ctx.me() ? '<b>E</b> let go' : 'Run under it!', ok: true } : this.gor() ? { name: 'Fallen shelf', hint: '<b>E</b> hold it up', ok: true } : { name: 'Fallen shelf', hint: 'Too heavy. A gorilla could hold it up.', ok: false };
      case 'prop': return { name: 'Prop lever', hint: '<b>E</b> wedge the shelf open', ok: true };
    }
    return { name: '', hint: '', ok: false };
  }
  interact(t: MTarget): 'exit' | null {
    const c = this.ctx, me = c.me();
    switch (t.w) {
      case 'exit': return 'exit';
      case 'held': { const g = this.grabs.mine!; c.carry(this._c); this._c.x -= OX; this._c.y -= OY; this._c.z -= OZ; g.x = this._c.x; g.y = this._c.y - 0.3; g.z = this._c.z; this.grabs.drop(g, me, (e) => c.send(e), 0, 0, 0); c.sfx.place(); return null; }
      case 'grab': this.tryGrab(this.grabs.list[t.i]); return null;
      case 'switch': if (this.L(c.player.pos).z < 0 || c.helper('c')) this.set('beams', 0); else { c.sfx.denied(); this.once('m2_hint_switch'); } return null;
      case 'lever': this.set('ladder', 1); return null;
      case 'doorlever': if (this.L(c.player.pos).z < -30 || c.helper('c')) this.set('door', 1); else c.sfx.denied(); return null;
      case 'drum': if (this.gor()) { c.sfx.drum(); c.player.shake(0.3); this.noise(7.2, -21); c.send({ k: 'qm', m: 1, n: [7.2, -21] }); } else { c.narrate('too_heavy'); c.sfx.denied(); } return null;
      case 'statue': {
        if (!this.gor()) { c.narrate('too_heavy'); c.sfx.denied(); return null; }
        const r = (this.statueR[t.i] + 1) % 4; this.statue(t.i, r); c.send({ k: 'qp', m: 1, s: 'statue', i: t.i, v: r }); c.sfx.thump(0.5); return null;
      }
      case 'painting': if (!this.st.painting && c.species() === 'g' && c.helper('c')) { this.set('painting', 1); c.sfx.creak(); } else if (!this.st.painting) { c.narrate('need_cat'); } return null;
      case 'key': this.press(t.i, true); return null;
      case 'gate': {
        const i = t.i;
        if (this.gate[i] === 1 && this.gateBy[i] === me) { this.setGate(i, 0, -1); return null; }
        if (!this.gor() || this.gate[i] !== 0) { c.sfx.denied(); return null; }
        // a gorilla on its own wedges it open with a mop; otherwise it holds it up for the cat
        if (c.helper('c')) { this.setGate(i, 2, me); c.say('You wedge a mop under the shelf. It stays up!'); } else this.setGate(i, 1, me);
        c.sfx.thump(0.6); return null;
      }
      case 'prop': this.setGate(t.i, 2, me); c.sfx.clang(); return null;
    }
    return null;
  }
  private setGate(i: number, v: number, by: number, send = true) {
    if (this.gate[i] === v && this.gateBy[i] === by) return;
    this.gate[i] = v; this.gateBy[i] = by; this.apply(); this.hintT = 0;
    if (send) this.ctx.send({ k: 'qp', m: 1, s: 'gate', i, v, b: by });
  }
  private statue(i: number, r: number) {
    this.statueR[i] = r; this.apply(); this.hintT = 0;
    if (this.statueR.every((x) => x === 0) && !this.st.outGate) { this.st.outGate = 1; this.ctx.narrate('m2_statues_done', { priority: 1 }); this.ctx.sfx.thump(1); this.once('m2_code', { priority: 1 }); }
  }
  private press(i: number, mine: boolean) {
    if (this.st.vault) return;
    if (mine && !this.st.outGate) { this.ctx.sfx.denied(); this.ctx.say('Nothing happens. The statues are not all facing the vault yet.'); this.once('m2_statues'); return; }
    this.entry.push(i); this.ctx.sfx.scan();
    if (mine) this.ctx.send({ k: 'qp', m: 1, s: 'key', i });
    if (this.entry.length >= 4) {
      const ok = this.entry.every((e, k) => e === this.code[k]);
      this.entry = [];
      if (ok) { if (mine) this.set('vault', 1); }
      else if (mine) { this.ctx.narrateAll('m2_code_wrong', { interrupt: true }); this.ctx.sfx.denied(); }
    }
  }
  private tryGrab(g: Grab) {
    if (g.kind === 'trophy' && !this.st.vault) return false;
    this.grabs.grab(g, this.ctx.me(), (e) => this.ctx.send(e));
    this.ctx.sfx.pickup(); this.ctx.haptic(0.4); this.hintT = 0;
    if (g.kind === 'trophy' && !this.st.alarm) this.set('alarm', 1);
    if (g === this.ball) this.ballNoise = false;
    return true;
  }
  click(t: MTarget | null): boolean {
    const me = this.ctx.me(), g = this.grabs.mine;
    if (g) {
      const P = this.ctx.player, d = this._d.set(-Math.sin(P.yaw) * Math.cos(P.pitch), Math.sin(P.pitch), -Math.cos(P.yaw) * Math.cos(P.pitch));
      const sp = this.ctx.species() === 'g' ? 8 : 4;
      this.grabs.drop(g, me, (e) => this.ctx.send(e), d.x * sp, d.y * sp + 1.6, d.z * sp);
      this.ctx.sfx.swing(); return true;
    }
    if (t && t.w !== 'exit' && t.w !== 'held') { this.interact(t); return true; }
    return false;
  }
  vrGrab(pos: THREE.Vector3, down: boolean, vel: THREE.Vector3): boolean {
    const me = this.ctx.me(), lp = this.L(pos);
    if (!down) { const g = this.grabs.mine; if (!g) return false; this.grabs.drop(g, me, (e) => this.ctx.send(e), vel.x * 1.6, vel.y * 1.6, vel.z * 1.6); return true; }
    const reach = this.ctx.species() === 'g' ? 0.55 : 0.3;
    let best: Grab | null = null, bd = reach;
    for (const g of this.grabs.list) {
      if (g.hid || g.done || g.mode === 1 || (g.kind === 'trophy' && !this.st.vault)) continue;
      const d = Math.hypot(g.x - lp.x, g.y + 0.1 - lp.y, g.z - lp.z); if (d < bd) { bd = d; best = g; }
    }
    return best ? this.tryGrab(best) : false;
  }

  // ------------------------------------------------------------ the guard
  /** a noise at (x, z): the guard goes to look (the controller decides) */
  private noise(x: number, z: number) {
    if (!this.ctx.controller()) return;
    const g = this.guard; g.mode = 'go'; g.tx = Math.max(-7, Math.min(7, x)); g.tz = Math.max(-29, Math.min(-13, z)); g.t = 0;
    this.ctx.narrateAll('g_noise', { priority: 1 });
  }
  private moveGuard(dt: number) {
    const g = this.guard;
    const go = (tx: number, tz: number) => {
      const dx = tx - g.x, dz = tz - g.z, d = Math.hypot(dx, dz);
      if (d < 0.15) return true;
      const want = Math.atan2(-dx, -dz); let dy = want - g.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      g.yaw += Math.sign(dy) * Math.min(Math.abs(dy), dt * 2.5);
      if (Math.abs(dy) < 0.6) { const s = Math.min(d, GUARD_SPEED * (g.mode === 'go' ? 1.5 : 1) * dt); g.x += (dx / d) * s; g.z += (dz / d) * s; }
      // around the display cases
      const o = this._o; this.space.push(g.x, g.z, 0.35, UP, 1.8, o); g.x = o.x; g.z = o.z;
      return false;
    };
    if (g.mode === 'walk') { const [tx, tz] = WAYPOINTS[g.wp]; if (go(tx, tz)) { g.mode = 'look'; g.t = 2.2; } }
    else if (g.mode === 'look') { g.t -= dt; g.yaw += Math.sin(this.t * 1.5) * dt * 0.8; if (g.t <= 0) { g.wp = (g.wp + 1) % WAYPOINTS.length; g.mode = 'walk'; if (Math.random() < 0.08) this.ctx.narrateAll('g_yawn'); } }
    else if (g.mode === 'go') { g.t += dt; if (go(g.tx, g.tz) || g.t > 14) { g.mode = 'search'; g.t = 4; } }
    else if (g.mode === 'search') { g.t -= dt; g.yaw += dt * 1.6; if (g.t <= 0) { g.mode = 'walk'; this.ctx.narrateAll('g_nothing'); } }
  }
  private _o = { x: 0, z: 0, nx: 0, nz: 0 };
  /** can the guard see me? (each player checks themselves) */
  private seesMe() {
    const p = this.L(this.ctx.player.pos);
    if (p.z > -12 || p.z < -30 || p.y < UP - 0.5) return false;
    const g = this.gShown, dx = p.x - g.x, dz = p.z - g.z, d = Math.hypot(dx, dz);
    if (d > VIEW) return false;
    const fx = -Math.sin(g.yaw), fz = -Math.cos(g.yaw);
    if (d > 0.8 && (dx * fx + dz * fz) / d < FOV) return false;
    const eh = UP + 1.6, ty = p.y + this.ctx.player.body.height * 0.6;
    return !this.space.blocked(g.x, eh, g.z, p.x, ty, p.z);
  }

  // ------------------------------------------------------------ events
  net(e: any, from: number) {
    if (e.k === 'qi') {
      this.grabs.net(e, from);
      if (e.s === 1 && this.trophies.some((t) => t.i === e.i) && !this.st.alarm) { this.st.alarm = 1; this.apply(); this.onState('alarm', 1); }
      return;
    }
    if (e.k === 'qm') {
      if (e.g) { this.guardNet = e.g; return; }
      if (e.n) { this.noise(e.n[0], e.n[1]); return; }
      if (e.c) { this.caught++; return; }
      return;
    }
    if (e.k !== 'qp') return;
    if (e.s === 'statue') { this.statue(e.i, e.v); return; }
    if (e.s === 'key') { this.press(e.i, false); return; }
    if (e.s === 'gate') { this.setGate(e.i, e.v, e.b ?? -1, false); return; }
    if (e.s === 'esc') { this.escaped.add(e.i); return; }
    if (e.s === 'reset') { this.resetEscape(false); return; }
    if (e.s in this.st && this.st[e.s as keyof St] !== e.v) { this.st[e.s as keyof St] = e.v; this.apply(); this.hintT = 0; this.onState(e.s, e.v); }
  }
  private guardNet: number[] | null = null;
  /** the escape failed: trophies back on their pedestals, shelves down, everybody back in the antechamber */
  private resetEscape(mine: boolean) {
    if (mine) this.ctx.send({ k: 'qp', m: 1, s: 'reset' });
    this.st.alarm = 0; this.alarmT = 0; this.gate = [0, 0]; this.gateBy = [-1, -1]; this.escaped.clear(); this.caught++;
    for (const t of this.trophies) { [t.x, t.y, t.z] = t.home; t.mode = 0; t.holder = -1; t.vx = t.vy = t.vz = 0; t.mesh.position.set(t.x, t.y, t.z); if (this.grabs.mine === t) this.grabs.mine = null; }
    this.apply();
    const p = this.L(this.ctx.player.pos);
    if (p.x > 6 || p.z < -44) this.ctx.player.teleport(OX + (this.ctx.me() % 3 - 1) * 0.8, OY + UP, OZ - 41.5, Math.PI);
    this.ctx.narrate('m2_timeout', { interrupt: true, priority: 3 });
  }

  // ------------------------------------------------------------ per frame
  update(dt: number, time: number) {
    const c = this.ctx; if (!c) return;
    this.t += dt;
    const me = c.me(), send = (e: any) => c.send(e), boss = c.controller();
    this.grabs.update(dt, (id) => {
      if (id === me) { c.carry(this._c); return { x: this._c.x - OX, y: this._c.y - OY, z: this._c.z - OZ, yaw: c.player.yaw }; }
      const o = c.others().find((p) => p.id === id); if (!o) return null;
      if (o.hand) return { x: o.hand.x - OX, y: o.hand.y - OY, z: o.hand.z - OZ, yaw: o.yaw };
      const g = (o.flags & 16384) !== 0, f = g ? 0.75 : 0.22;
      return { x: o.x - OX - Math.sin(o.yaw) * f, y: o.y - OY + (g ? 1.15 : 0.22), z: o.z - OZ - Math.cos(o.yaw) * f, yaw: o.yaw };
    }, me, send);
    const p = this.L(c.player.pos);
    // where am I: lines the first time you see each part
    if (p.z < 0.6 && p.z > -0.2 && this.st.beams) this.once('m2_beams', { priority: 1 });
    if (p.z < -1.5 && p.z > -12 && p.y < UP - 1) this.once('m2_climb', { priority: 1 });
    if (p.z < -12.5 && p.z > -30 && p.y > UP - 0.5) this.once('m2_guard', { priority: 1 });
    if (p.z < -30.5 && p.z > -44 && p.y > UP - 0.5) this.once('m2_statues', { priority: 1 });
    // a gorilla walking into the beams
    this.touchCd -= dt;
    if (this.st.beams && c.species() === 'g' && Math.abs(p.x) < 1.2 && p.z > 0.1 && p.z < 0.75 && this.touchCd <= 0) { this.touchCd = 6; c.sfx.zap(); c.narrate('m2_beam_touch', { interrupt: true }); }
    // the ball landing makes a noise the guard hears
    if (this.ball.mode === 1) this.ballNoise = false;
    else if (this.ball.landed && !this.ballNoise && this.ball.moved && this.ball.z < -12 && this.ball.z > -30) { this.ballNoise = true; c.sfx.thump(0.3); this.noise(this.ball.x, this.ball.z); }
    // ---- the guard: the controller walks him and tells everybody; the others glide after
    if (boss) {
      this.moveGuard(dt);
      this.gSend -= dt;
      if (this.gSend <= 0) { this.gSend = 0.2; send({ k: 'qm', m: 1, g: [+this.guard.x.toFixed(2), +this.guard.z.toFixed(2), +this.guard.yaw.toFixed(2)] }); }
      this.gShown.x = this.guard.x; this.gShown.z = this.guard.z; this.gShown.yaw = this.guard.yaw;
    } else if (this.guardNet) {
      const k = Math.min(1, dt * 8), n = this.guardNet;
      this.gShown.x += (n[0] - this.gShown.x) * k; this.gShown.z += (n[1] - this.gShown.z) * k;
      let dy = n[2] - this.gShown.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); this.gShown.yaw += dy * k;
    }
    const gm = this.guardM, mv = boss ? (this.guard.mode === 'walk' || this.guard.mode === 'go' ? 1 : 0) : 1;
    gm.root.position.set(this.gShown.x, UP, this.gShown.z); gm.root.rotation.y = this.gShown.yaw;
    gm.legs.forEach((l, i) => { l.rotation.x = Math.sin(time * 6 + i * Math.PI) * 0.4 * mv; });
    (gm.cone.material as THREE.MeshBasicMaterial).opacity = 0.09 + 0.04 * Math.sin(time * 3);
    // spotted?
    this.hmmCd -= dt;
    if (this.seesMe()) {
      this.seen += dt;
      if (this.seen > 0.25 && this.hmmCd <= 0) { this.hmmCd = 5; c.narrate('g_hmm', { interrupt: true, priority: 2 }); }
      if (this.seen > 1.1) {
        this.seen = 0; this.caught++; send({ k: 'qm', m: 1, c: 1 });
        const g = this.grabs.mine; if (g) this.grabs.drop(g, me, send, 0, 0, 0);
        c.narrate('g_caught', { interrupt: true, priority: 3 }); c.narrate('m2_caught', { priority: 3 }); c.sfx.denied(); c.haptic(0.8);
        c.player.teleport(OX + 0.3 * ((me % 3) - 1), OY + UP, OZ - 13.2, Math.PI);
      }
    } else this.seen = Math.max(0, this.seen - dt * 0.5);
    // ---- the escape
    if (this.st.alarm) {
      this.alarmLights.forEach((m, i) => (m.material as THREE.MeshBasicMaterial).color.set(Math.sin(time * 8 + i) > 0 ? '#ff2020' : '#400'));
      this.alarmT -= dt;
      // somebody holding a shelf up lets go when they walk away
      this.gate.forEach((v, i) => { if (v === 1 && this.gateBy[i] === me && Math.abs(p.x - GATES[i]) > 2.2) this.setGate(i, 0, -1); });
      // trophies past the end of the corridor
      this.trophies.forEach((t, i) => { if (!this.escaped.has(i) && t.x > 31 && Math.abs(t.z + 37) < 1.5 && (t.holder === me || (t.mode !== 1 && boss))) { this.escaped.add(i); send({ k: 'qp', m: 1, s: 'esc', i }); c.sfx.coin(); } });
      if (this.escaped.size >= 2 && !this.won) { this.won = true; c.player.shake(0.2); if (boss) setTimeout(() => c.complete(this.caught), 1500); }
      if (this.alarmT <= 0 && boss && !this.won) this.resetEscape(true);
    } else this.alarmLights.forEach((m) => (m.material as THREE.MeshBasicMaterial).color.set('#400'));
    // ---- hints
    if (boss) { this.hintT += dt; if (this.hintT > HINT_EVERY && !this.won) { this.hintT = 0; const h = this.nextHint(); if (h) c.narrateAll(h, { priority: 1 }); } }
    // ---- the top line
    const mm = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
    const txt = this.st.alarm ? `🚨 ALARM ${mm(this.alarmT)} · trophies out ${this.escaped.size}/2` : `🌙 Night at the museum · caught ${this.caught}${this.grabs.mine ? ` · carrying ${this.grabs.mine.name}` : ''}`;
    if (this.hud.textContent !== txt) this.hud.textContent = txt;
    this.hud.style.display = 'block';
    this.keyBoard.draw(`${this.entry.join(',')}|${this.st.vault}|${this.st.outGate}`, (g, W, H) => {
      g.fillStyle = '#0a140a'; g.fillRect(0, 0, W, H); g.fillStyle = this.st.vault ? '#7dff6b' : this.st.outGate ? '#9fe0ff' : '#ff6b4a';
      g.font = '800 64px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(this.st.vault ? 'OPEN' : !this.st.outGate ? 'LOCKED' : [0, 1, 2, 3].map((k) => (this.entry[k] !== undefined ? SYM[this.entry[k]] : '_')).join(' '), W / 2, H / 2);
    });
  }
  private nextHint(): string | null {
    const order: [string, () => boolean][] = [
      ['m2_hint_switch', () => !this.st.beams],
      ['m2_hint_lever', () => !!this.st.ladder],
      ['m2_hint_vent', () => !!this.st.door],
      ['m2_hint_drum', () => !!this.st.door],
      ['m2_hint_statues', () => !!this.st.outGate],
      ['m2_code', () => !!this.st.vault],
    ];
    const left = order.filter(([, ok]) => !ok());
    if (!left.length) return null;
    return left[this.hintI++ % Math.min(2, left.length)][0];
  }
}
