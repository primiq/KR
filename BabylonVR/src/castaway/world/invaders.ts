// The blue stones' call: an alien invasion, in the style of the old arcade game.
//
// Touch two blue stones together (or every player touches a blue one) and the sky turns to a burning sunrise. Every
// player on the island is put into a twin-barrelled laser cannon, the cannons in a line in the stone circle facing the
// gap in the ring (the sunrise). The cannon points wherever you look; click / trigger / any face button fires. Every shot
// is a laser bolt with a long fading tracer, yours and everybody else's.
//
// Level 1: out over the island a wall of blocky alien ships (squids, crabs and octopuses, two-frame voxel sprites)
// marches side to side, stepping down and closer at every edge, faster as their numbers fall, to a thumping four-note
// bass beat. Now and then a red saucer crosses above them. Shoot them all before they land.
// Level 2: they come from everywhere. Waves of ships spiral in from all round the sky, 360 degrees, straight at the
// cannons. Each one that gets through costs one of five shields; lose them all and it is over.
// In both, the ships shoot back: glowing plasma bolts with tracers, aimed at the cannons. A bolt that reaches you jolts
// your cannon and jams it for a moment. You can shoot the bolts down.
// A dashboard in front of your cannon shows the level, ships left, the shields and every player's score.
//
// The host runs the ships, decides hits, fires the aliens' bolts and decides the end; everybody else draws it
// (events: iv ops start / f / lv / s / h / k / u / b / bx / end).
// Babylon port: Castaway's code, drawn by render/mirror.ts (the tracers fade with a flat opacity instead of along their tails).
import * as THREE from 'three';

const COLS = 8, ROWS = 5;
const SX = 9.5, SY = 7.6;              // spacing in the formation (m)
const VOX = 0.56;                      // voxel size of the ships
const D0 = 118, OY0 = 52;              // start: distance out from the circle, height of the bottom row above it
const XR = 24;                         // how far the formation marches either side
const STEP_DOWN = 3.3, STEP_IN = 4;    // at each edge
const LAND = 9;                        // the bottom row this low: they have landed
const HIT_R = 4.2;                     // a ship's hit sphere
const LASER_V = 260, LASER_RANGE = 260, FIRE_CD = 0.2;
const BOLT_V = 38, BOLT_HIT = 1.7;     // the aliens' plasma bolts: speed, how close to your head counts
const STUN = 1.3;                      // a bolt that reaches you jams your cannon this long
const MAX_T = 480;                     // seconds: the invasion gives up waiting by then (they win)
// level 2: ships from every direction
const N2 = 36, WAVE = 8, WAVE_GAP = 9, R2 = 165, BREACH = 14, SHIELDS = 5;

// the classic sprites, two frames each
const SPRITES: string[][][] = [
  [[
    '...##...', '..####..', '.######.', '##.##.##', '########', '..#..#..', '.#.##.#.', '#.#..#.#',
  ], [
    '...##...', '..####..', '.######.', '##.##.##', '########', '.#.##.#.', '#......#', '.#....#.',
  ]],
  [[
    '..#.....#..', '...#...#...', '..#######..', '.##.###.##.', '###########', '#.#######.#', '#.#.....#.#', '...##.##...',
  ], [
    '..#.....#..', '#..#...#..#', '#.#######.#', '###.###.###', '###########', '.#########.', '..#.....#..', '.#.......#.',
  ]],
  [[
    '....####....', '.##########.', '############', '###..##..###', '############', '...##..##...', '..##.##.##..', '##........##',
  ], [
    '....####....', '.##########.', '############', '###..##..###', '############', '..###..###..', '.##..##..##.', '..##....##..',
  ]],
];
const KIND_OF_ROW = [0, 1, 1, 2, 2];
const POINTS = [30, 20, 10];
const COLORS = ['#ff4fd8', '#4fe8ff', '#7dff5a'];
const MAXN = Math.max(COLS * ROWS, N2);

function spriteGeo(rows: string[]) {
  const boxes: THREE.BufferGeometry[] = [];
  const h = rows.length, w = rows[0].length;
  rows.forEach((r, y) => [...r].forEach((ch, x) => {
    if (ch !== '#') return;
    boxes.push(new THREE.BoxGeometry(VOX, VOX, VOX * 1.4).translate((x - (w - 1) / 2) * VOX, ((h - 1) / 2 - y) * VOX, 0));
  }));
  return mergeBoxes(boxes);
}
function mergeBoxes(gs: THREE.BufferGeometry[]) {
  let n = 0; for (const g of gs) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3); const idx: number[] = [];
  let o = 0;
  for (const g of gs) {
    pos.set(g.attributes.position.array as Float32Array, o * 3); nor.set(g.attributes.normal.array as Float32Array, o * 3);
    const ia = g.index!.array; for (let k = 0; k < ia.length; k++) idx.push(ia[k] + o);
    o += g.attributes.position.count; g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); out.setIndex(idx);
  return out;
}
const glowMat = (hex: string, k = 1) => {
  const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k) });
  m.fog = false; m.toneMapped = false;
  return m;
};
/** a tracer: solid colour at the head, fading to nothing down its tail (normal blending: additive glow washes out to white
 *  against the bright sunrise sky, a solid colour does not) */
const trailMats = new Map<string, THREE.Material>();
function trailMat(hex: string) {
  let m = trailMats.get(hex);
  if (!m) {
    const t = new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(1.15), transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide });
    t.fog = false; t.toneMapped = false;
    trailMats.set(hex, m = t);
  }
  return m;
}
const headMats = new Map<string, THREE.Material>();
const headMat = (hex: string) => { let m = headMats.get(hex); if (!m) headMats.set(hex, m = glowMat(new THREE.Color(hex).lerp(new THREE.Color('#ffffff'), 0.45).getHexString().replace(/^/, '#'), 1.6)); return m; };
// a unit tracer along +Z, from the tail (z = -1) to the head (z = 0); scaled to its length
const TRAIL_GEO = new THREE.CylinderGeometry(1, 0.15, 1, 8, 1, true).rotateX(Math.PI / 2).translate(0, 0, -0.5);
const LASER_HEAD = new THREE.CylinderGeometry(0.17, 0.17, 5, 8).rotateX(Math.PI / 2).translate(0, 0, -2.5);
const BOLT_HEAD = new THREE.IcosahedronGeometry(1.0, 1);
// the plasma bolt's halo: a soft glowing ball round it, so it shows from far off as it comes at you
const HALO_MAT = (() => { const m = new THREE.MeshBasicMaterial({ color: '#fff27a', transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }); m.fog = false; m.toneMapped = false; return m; })();
const HALO_GEO = new THREE.SphereGeometry(2.3, 12, 8);

export type InvEvent = Record<string, any>;
/** a laser bolt (a player's) or a plasma bolt (the aliens') in flight */
interface Tracer { head: THREE.Mesh; trail: THREE.Mesh; p: THREE.Vector3; d: THREE.Vector3; v: number; left: number; run: number; mine: boolean; alien: boolean; id: number; hex: string; r: number }
interface Bit { p: THREE.Vector3; v: THREE.Vector3; life: number; c: THREE.Color; s: number }

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _z = new THREE.Vector3(0, 0, 1);
/** the same little random numbers for ship i on every machine */
const h01 = (i: number, k: number) => { const s = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return s - Math.floor(s); };

export class Invaders {
  /** the host runs it */
  remote = false;
  myId = 0;
  running = false;
  /** I am sitting in a cannon */
  seated = false;
  /** 0..1 how far the sky has turned to sunrise (the atmosphere reads it) */
  sky = 0;
  ids: number[] = [];
  readonly score = new Map<number, number>();
  // hooks
  onEvent: ((e: InvEvent) => void) | null = null;
  who: (id: number) => { name: string; color: string } = (id) => ({ name: id === this.myId ? 'You' : 'Friend', color: '#ffd23f' });
  /** another player's look (yaw, pitch), for pointing their cannon */
  aimOf: (id: number) => { yaw: number; pitch: number } | null = () => null;
  say: ((t: string) => void) | null = null;
  sfx: { laser(v?: number): void; alienBoom(v?: number): void; march(i: number): void; ufoBeep(): void; invadersStart(): void; clear8(): void; alienShot?(v?: number): void; jolt?(): void } | null = null;
  /** put me in (or out of) my seat */
  onSeat: ((x: number, y: number, z: number, yaw: number) => void) | null = null;
  onRelease: (() => void) | null = null;
  /** an alien bolt got me (shake the view, buzz the controller) */
  onJolt: (() => void) | null = null;

  private group = new THREE.Group();
  private C = new THREE.Vector3();
  private fwd = new THREE.Vector3(1, 0, 0);
  private right = new THREE.Vector3(0, 0, 1);
  private facing = 0;              // the yaw that looks along fwd
  level = 1;
  private alive: boolean[] = [];
  private ships: THREE.InstancedMesh[][] = [];   // [kind][frame]
  private fx = 0; private fy = OY0; private fd = D0; private fdir = 1; private frame = 0; private beatT = 0; private beat = 0;
  private netF = { x: 0, y: OY0, d: D0 };
  /** level 2: its own clock (negative during the "level 2" pause), and the shields left */
  private lt = 0; shields = SHIELDS;
  private t = 0; private endT = -1; private win = false; private lastNet = 0;
  private ufo: THREE.Group; private ufoT = -1; private ufoDir = 1; private ufoNext = 22; private ufoBeepT = 0;
  private tracers: Tracer[] = [];
  private bits: Bit[] = [];
  private bitMesh: THREE.InstancedMesh;
  private flashes: { mesh: THREE.Mesh; t: number }[] = [];
  private cannons = new Map<number, { base: THREE.Group; gun: THREE.Group; seat: THREE.Vector3; side: number; aim: THREE.Vector3; jolt: number }>();
  private fireCd = 0; private stun = 0;
  private board: THREE.Mesh; private boardCtx: CanvasRenderingContext2D; private boardTex: THREE.CanvasTexture; private boardKey = '';
  private home: { x: number; y: number; z: number; yaw: number } | null = null;
  private boltT = 3; private boltId = 1;
  private banner = 0;              // seconds left of the "LEVEL 2" title on the board

  constructor(scene: THREE.Scene) {
    // ships: per kind, one instanced mesh per animation frame (only the current frame's is shown)
    SPRITES.forEach((frames, k) => {
      const mat = glowMat(COLORS[k], 1.25);
      this.ships.push(frames.map((f) => {
        const im = new THREE.InstancedMesh(spriteGeo(f), mat, MAXN);
        im.frustumCulled = false; im.count = MAXN; this.group.add(im);
        for (let i = 0; i < MAXN; i++) im.setMatrixAt(i, _m.makeScale(0, 0, 0));      // a kind only uses its own slots
        return im;
      }));
    });
    // the saucer: a red disc with a dome and a ring of lights
    this.ufo = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.SphereGeometry(4.2, 20, 8).scale(1, 0.28, 1), glowMat('#ff3a3a', 1.1));
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1.7, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), glowMat('#ffd0d0', 1));
    dome.position.y = 0.6; this.ufo.add(disc, dome);
    for (let i = 0; i < 10; i++) { const l = new THREE.Mesh(new THREE.SphereGeometry(0.35, 6, 4), glowMat(i % 2 ? '#ffff7a' : '#ffffff', 1.4)); const a = (i / 10) * Math.PI * 2; l.position.set(Math.cos(a) * 3.6, -0.15, Math.sin(a) * 3.6); this.ufo.add(l); }
    this.ufo.visible = false; this.group.add(this.ufo);
    // explosion debris: little glowing cubes
    const bm = new THREE.MeshBasicMaterial({ color: '#ffffff' }); bm.fog = false; bm.toneMapped = false;
    this.bitMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(VOX, VOX, VOX), bm, 400);
    this.bitMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(400 * 3), 3);
    this.bitMesh.count = 0; this.bitMesh.frustumCulled = false; this.group.add(this.bitMesh);
    // flashes
    for (let i = 0; i < 8; i++) {
      const fm = new THREE.MeshBasicMaterial({ color: '#fff3c0', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }); fm.fog = false; fm.toneMapped = false;
      const f = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), fm); f.visible = false; this.group.add(f); this.flashes.push({ mesh: f, t: 0 });
    }
    // the dashboard
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 300;
    this.boardCtx = cv.getContext('2d')!;
    this.boardTex = new THREE.CanvasTexture(cv); this.boardTex.colorSpace = THREE.SRGBColorSpace;
    const pm = new THREE.MeshBasicMaterial({ map: this.boardTex, transparent: true, depthWrite: false }); pm.fog = false; pm.toneMapped = false;
    this.board = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.5), pm); this.board.visible = false; this.board.renderOrder = 60;
    this.group.add(this.board);
    this.group.visible = false;
    scene.add(this.group);
  }

  /** where the circle is and which way the cannons face (out through the gap in the ring) */
  setSite(x: number, y: number, z: number, facing: number) {
    this.C.set(x, y, z); this.facing = facing;
    this.fwd.set(-Math.sin(facing), 0, -Math.cos(facing));
    this.right.set(Math.cos(facing), 0, -Math.sin(facing));
  }

  // ------------------------------------------------------------------ start / end
  hostStart(ids: number[]) {
    if (this.running || !ids.length) return;
    this.onEvent?.({ op: 'start', ids });
    this.begin(ids);
  }
  private begin(ids: number[]) {
    this.running = true; this.ids = ids.slice(); this.t = 0; this.endT = -1; this.win = false; this.lastNet = 0;
    this.level = 1; this.shields = SHIELDS; this.banner = 0; this.stun = 0;
    this.alive = new Array(COLS * ROWS).fill(true);
    this.fx = -XR; this.fy = OY0; this.fd = D0; this.fdir = 1; this.frame = 0; this.beatT = 0.5; this.beat = 0;
    this.netF = { x: this.fx, y: this.fy, d: this.fd };
    this.ufoT = -1; this.ufoNext = 18 + Math.random() * 8; this.boltT = 4;
    this.score.clear(); for (const id of ids) this.score.set(id, 0);
    for (const s of this.tracers) s.left = 0;
    this.bits.length = 0;
    // a cannon for everybody, in a line across the circle
    for (const c of this.cannons.values()) this.group.remove(c.base, c.gun);
    this.cannons.clear();
    const n = ids.length, sp = 2.3;
    ids.forEach((id, k) => {
      const off = (k - (n - 1) / 2) * sp;
      const seat = this.C.clone().addScaledVector(this.right, off).addScaledVector(this.fwd, -1.6);
      seat.y = this.C.y + 0.05;
      const { base, gun } = this.buildCannon(this.who(id).color);
      base.position.copy(seat); base.rotation.y = this.facing;
      this.group.add(base, gun);
      this.cannons.set(id, { base, gun, seat, side: 1, aim: this.fwd.clone().add(_v.set(0, 0.5, 0)).normalize(), jolt: 0 });
    });
    this.group.visible = true;
    this.sfx?.invadersStart();
    const me = this.cannons.get(this.myId);
    if (me) {
      this.seated = true;
      this.onSeat?.(me.seat.x, me.seat.y, me.seat.z, this.facing);
      this.say?.('Into the cannons! Look where you want to shoot. Shoot them all before they land!');
    } else this.say?.('The sky is full of alien ships!');
  }
  /** level 2: they come from everywhere */
  private startLevel2() {
    this.level = 2; this.lt = -4; this.shields = SHIELDS; this.banner = 4.5;
    this.alive = new Array(N2).fill(true);
    this.ufoT = -1; this.ufo.visible = false; this.boltT = 5;
    this.sfx?.invadersStart();
    this.say?.('LEVEL 2! They are coming from every direction - look all round the sky!');
  }
  private finish() {
    this.running = false; this.endT = -1;
    this.group.visible = false; this.board.visible = false; this.ufo.visible = false;
    for (const s of this.tracers) { s.left = 0; s.head.visible = s.trail.visible = false; }
    if (this.seated) { this.seated = false; this.onRelease?.(); }
  }
  /** I was put back where I was before (a release hook can use it) */
  setHome(h: { x: number; y: number; z: number; yaw: number } | null) { this.home = h; }
  get homeSpot() { return this.home; }

  // ------------------------------------------------------------------ models
  private buildCannon(hex: string) {
    const base = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: '#3a4250', roughness: 0.35, metalness: 0.7 });
    const trim = glowMat(hex, 1.1), cyan = glowMat('#5ff6ff', 1.3);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.1, 0.5, 20, 1, true), metal); ring.position.y = 0.25; ring.material.side = THREE.DoubleSide;
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.15, 0.08, 20), metal); floor.position.y = 0.04;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.97, 0.05, 6, 28), trim); rim.rotation.x = Math.PI / 2; rim.position.y = 0.5;
    base.add(ring, floor, rim);
    // the gun: twin barrels out either side of your head and below it, glowing coils, a yoke behind; pointing along +Z
    const gun = new THREE.Group();
    for (const s of [-1, 1]) {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.075, 1.5, 10).rotateX(Math.PI / 2), metal); barrel.position.set(s * 0.5, -0.12, 1.25);
      const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.1, 10).rotateX(Math.PI / 2), cyan); tip.position.set(s * 0.5, -0.12, 2.02);
      gun.add(barrel, tip);
      for (let i = 0; i < 3; i++) { const coil = new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.01, 4, 12), cyan); coil.position.set(s * 0.5, -0.12, 1.15 + i * 0.22); gun.add(coil); }
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.9), metal); arm.position.set(s * 0.5, -0.12, 0.1); gun.add(arm);
    }
    const yoke = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.035, 6, 20, Math.PI), metal); yoke.rotation.z = Math.PI; yoke.position.set(0, -0.12, -0.35); gun.add(yoke);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.018, 4, 20, Math.PI), trim); band.rotation.z = Math.PI; band.position.set(0, -0.12, -0.3); gun.add(band);
    return { base, gun };
  }

  /** the kind of ship i (0 squid, 1 crab, 2 octopus) */
  private kindOf(i: number) { return this.level === 1 ? KIND_OF_ROW[Math.floor(i / COLS)] : i % 3; }
  private pointsOf(i: number) { return i === -1 ? 100 : POINTS[this.kindOf(i)] + (this.level === 2 ? 10 : 0); }
  /** level 2, ship i: how far it still is from the circle (≤ BREACH: it got through), and -1 while its wave has not come yet */
  private dist2(i: number) {
    const tt = this.lt - Math.floor(i / WAVE) * WAVE_GAP;
    if (tt < 0) return -1;
    return R2 - (3.4 + 1.8 * h01(i, 3)) * tt * (1 + 0.12 * Math.floor(i / WAVE));
  }
  /** is ship i in the sky now (alive, and in level 2 its wave has come) */
  private present(i: number) { return this.alive[i] && (this.level === 1 || this.dist2(i) > 0); }
  /** where ship i is now (world) */
  private shipPos(i: number, out: THREE.Vector3) {
    if (this.level === 1) {
      const c = i % COLS, r = Math.floor(i / COLS);
      return out.copy(this.C).addScaledVector(this.fwd, this.fd).addScaledVector(this.right, this.fx + (c - (COLS - 1) / 2) * SX).setY(this.C.y + this.fy + (ROWS - 1 - r) * SY);
    }
    // level 2: each ship starts somewhere round the whole sky and spirals in, weaving as it comes
    const tt = Math.max(0, this.lt - Math.floor(i / WAVE) * WAVE_GAP), d = Math.max(BREACH, this.dist2(i));
    const az = i * 2.39996 + h01(i, 1) * 0.8 + (h01(i, 2) < 0.5 ? -1 : 1) * (0.05 + 0.07 * h01(i, 4)) * tt + 0.25 * Math.sin(tt * 0.8 + i);
    const el = (0.2 + 0.55 * h01(i, 5)) * (0.45 + 0.55 * (d / R2)) + 0.05 * Math.sin(tt * 1.3 + i * 2);
    return out.set(Math.sin(az) * Math.cos(el) * d, 2 + Math.sin(el) * d, Math.cos(az) * Math.cos(el) * d).add(this.C);
  }
  private ufoPos(out: THREE.Vector3) {
    const k = this.ufoT / 13, x = this.ufoDir * (-XR - 40 + k * (2 * XR + 80));
    return out.copy(this.C).addScaledVector(this.fwd, this.fd + 6).addScaledVector(this.right, x).setY(this.C.y + this.fy + ROWS * SY + 10);
  }
  get left() { let n = 0; for (const a of this.alive) if (a) n++; return n; }
  private get total() { return this.level === 1 ? COLS * ROWS : N2; }

  // ------------------------------------------------------------------ every frame
  /**
   * `eye` / `dir`: where I look from and along (head in VR). `fire`: the trigger / mouse is down.
   */
  update(dt: number, eye: THREE.Vector3, dir: THREE.Vector3, fire: boolean) {
    // the sky follows: sunrise while it runs, back over a few seconds after
    this.sky += ((this.running ? 1 : 0) - this.sky) * Math.min(1, dt * (this.running ? 0.9 : 0.6));
    if (!this.running) return;
    dt = Math.min(dt, 1 / 20);
    this.t += dt; this.banner = Math.max(0, this.banner - dt);
    if (this.level === 2) this.lt += dt;
    const total = this.total, left = this.left;
    // ---- the ships (host), or follow the host's
    if (!this.remote) {
      if (this.endT < 0) {
        if (this.level === 1) {
          const speed = 3 + 10 * (1 - left / total);
          this.fx += this.fdir * speed * dt;
          if (this.fx > XR || this.fx < -XR) { this.fx = Math.max(-XR, Math.min(XR, this.fx)); this.fdir = -this.fdir; this.fy -= STEP_DOWN; this.fd = Math.max(40, this.fd - STEP_IN); }
          // the saucer
          if (this.ufoT < 0) { this.ufoNext -= dt; if (this.ufoNext <= 0) { this.ufoNext = 24 + Math.random() * 12; this.startUfo(Math.random() < 0.5 ? 1 : -1); this.onEvent?.({ op: 'u', r: this.ufoDir }); } }
          // all shot down: on to level 2; landed: over
          if (left === 0) { this.onEvent?.({ op: 'lv', n: 2 }); this.startLevel2(); }
          else if (this.fy < LAND) this.hostEnd(false);
        } else {
          // a ship that gets right in costs a shield (it bursts over the cannons)
          for (let i = 0; i < N2; i++) if (this.alive[i] && this.dist2(i) >= 0 && this.dist2(i) <= BREACH) this.kill(i, -1);
          if (this.left === 0) this.hostEnd(true);
          else if (this.shields <= 0) this.hostEnd(false);
        }
        if (this.t > MAX_T && this.endT < 0) this.hostEnd(false);
        this.lastNet -= dt;
        if (this.lastNet <= 0) { this.lastNet = 0.2; this.onEvent?.({ op: 'f', x: +this.fx.toFixed(2), y: +this.fy.toFixed(2), d: +this.fd.toFixed(1), r: this.fdir, l: this.level, lt: +this.lt.toFixed(2) }); }
        this.hostBolts(dt);
      }
    } else {
      const k = Math.min(1, dt * 6);
      this.fx += (this.netF.x - this.fx) * k; this.fy += (this.netF.y - this.fy) * k; this.fd += (this.netF.d - this.fd) * k;
      if (this.t - this.lastNet > 12 && this.endT < 0) { this.endT = 0; this.win = false; }   // the host went away
    }
    // ---- the march beat: the four-note bass, quicker as they thin out; the legs swap on every beat
    this.beatT -= dt;
    if (this.beatT <= 0 && this.endT < 0) {
      this.beatT = 0.18 + 0.62 * (left / total);
      this.frame ^= 1; this.sfx?.march(this.beat++);
    }
    // ---- draw the ships
    const face = _q.setFromUnitVectors(_z, _w.copy(this.fwd).negate());
    for (let k = 0; k < 3; k++) for (let f = 0; f < 2; f++) this.ships[k][f].visible = f === this.frame;
    for (let i = 0; i < MAXN; i++) {
      if (i >= total) { for (let k = 0; k < 3; k++) for (let f = 0; f < 2; f++) this.ships[k][f].setMatrixAt(i, _m.makeScale(0, 0, 0)); continue; }
      const kind = this.kindOf(i), im = this.ships[kind][this.frame];
      if (!this.present(i)) _m.makeScale(0, 0, 0);
      else {
        this.shipPos(i, _v);
        let grow = 1;
        if (this.level === 1) { _v.y += Math.sin(this.t * 3 + i) * 0.25; grow = 1 + 0.35 * (1 - (this.fd - 40) / (D0 - 40)); _m.compose(_v, face, _s.setScalar(grow)); }
        else {
          // facing the cannons as it comes
          _q.setFromUnitVectors(_z, _w.copy(this.C).setY(this.C.y + 2).sub(_v).normalize());
          _m.compose(_v, _q, _s.setScalar(1.1));
        }
      }
      im.setMatrixAt(i, _m);
      // the other frame and the other kinds must not show a stale ship in this slot
      this.ships[kind][this.frame ^ 1].setMatrixAt(i, _m.makeScale(0, 0, 0));
      for (let k = 0; k < 3; k++) if (k !== kind) for (let f = 0; f < 2; f++) this.ships[k][f].setMatrixAt(i, _m);
    }
    for (let k = 0; k < 3; k++) for (const im of this.ships[k]) im.instanceMatrix.needsUpdate = true;
    // ---- the saucer
    if (this.ufoT >= 0) {
      this.ufoT += dt;
      if (this.ufoT > 13 || this.level !== 1) { this.ufoT = -1; this.ufo.visible = false; }
      else {
        this.ufoPos(this.ufo.position); this.ufo.rotation.y += dt * 2; this.ufo.visible = true;
        this.ufoBeepT -= dt; if (this.ufoBeepT <= 0) { this.ufoBeepT = 0.16; this.sfx?.ufoBeep(); }
      }
    }
    // ---- the cannons: mine follows my eyes, the others' follow theirs; a jolted one shakes
    for (const [id, c] of this.cannons) {
      if (id === this.myId) { c.gun.position.copy(eye).addScaledVector(_up, -0.3); c.aim.copy(dir); }
      else {
        const a = this.aimOf(id);
        if (a) c.aim.set(-Math.sin(a.yaw) * Math.cos(a.pitch), Math.sin(a.pitch), -Math.cos(a.yaw) * Math.cos(a.pitch));
        c.gun.position.copy(c.seat).setY(c.seat.y + 1.32);
      }
      c.jolt = Math.max(0, c.jolt - dt);
      if (c.jolt > 0) c.gun.position.add(_v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.12 * c.jolt));
      c.gun.lookAt(_v.copy(c.gun.position).add(c.aim));
      c.gun.updateMatrixWorld();
    }
    // ---- firing (not while my cannon is jammed by a hit)
    this.fireCd -= dt; this.stun = Math.max(0, this.stun - dt);
    if (this.seated && fire && this.fireCd <= 0 && this.stun <= 0 && this.endT < 0) {
      this.fireCd = FIRE_CD;
      const c = this.cannons.get(this.myId)!;
      c.side = -c.side;
      const o = this.muzzle(c, _v).clone();
      this.spawnTracer(o, dir.clone().normalize(), LASER_V, LASER_RANGE, true, false, 0, this.who(this.myId).color);
      this.onEvent?.({ op: 's', o: [+o.x.toFixed(2), +o.y.toFixed(2), +o.z.toFixed(2)], d: [+dir.x.toFixed(3), +dir.y.toFixed(3), +dir.z.toFixed(3)] });
      this.sfx?.laser(1);
    }
    this.updateTracers(dt, eye);
    this.updateBits(dt);
    // ---- the dashboard, in front of my cannon below the sights
    const me = this.cannons.get(this.myId);
    if (me && this.seated) {
      this.board.visible = true;
      this.board.position.copy(me.seat).addScaledVector(this.fwd, 1.05).setY(me.seat.y + 1.0);
      this.board.lookAt(_v.copy(me.seat).setY(me.seat.y + 1.6));
      this.drawBoard();
    } else this.board.visible = false;
    // ---- the end: a few seconds of results, then everybody goes back
    if (this.endT >= 0) {
      this.endT += dt;
      if (this.endT > 7) this.finish();
    }
  }
  private muzzle(c: { gun: THREE.Group; side: number }, out: THREE.Vector3) {
    return out.set(c.side * 0.5, -0.12, 2.1).applyMatrix4(c.gun.matrixWorld);
  }
  private startUfo(dir: number) { this.ufoT = 0; this.ufoDir = dir; }

  /** host: now and then a ship fires a plasma bolt at somebody's cannon (not always dead on: some only scorch past) */
  private hostBolts(dt: number) {
    this.boltT -= dt;
    if (this.boltT > 0 || this.banner > 0) return;
    const live: number[] = []; for (let i = 0; i < this.total; i++) if (this.present(i)) live.push(i);
    if (!live.length || !this.cannons.size) { this.boltT = 1; return; }
    const frac = live.length / this.total;
    this.boltT = (this.level === 1 ? 1.3 : 0.9) + Math.random() * (this.level === 1 ? 2.4 : 1.6) * (0.4 + 0.6 * frac);
    const i = live[Math.floor(Math.random() * live.length)];
    const cs = [...this.cannons.values()], c = cs[Math.floor(Math.random() * cs.length)];
    const o = this.shipPos(i, new THREE.Vector3());
    const miss = Math.random() < 0.3 ? 0.6 : 6;
    const target = _v.copy(c.seat).setY(c.seat.y + 1.45).add(_w.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.6, Math.random() - 0.5).multiplyScalar(miss * 2));
    const d = target.sub(o).normalize();
    const id = this.boltId++;
    this.spawnTracer(o, d, BOLT_V, 300, false, true, id, COLORS[this.kindOf(i)]);
    this.onEvent?.({ op: 'b', id, o: [+o.x.toFixed(2), +o.y.toFixed(2), +o.z.toFixed(2)], d: [+d.x.toFixed(3), +d.y.toFixed(3), +d.z.toFixed(3)], c: this.kindOf(i) });
    this.sfx?.alienShot?.(1);
  }

  private spawnTracer(o: THREE.Vector3, d: THREE.Vector3, v: number, range: number, mine: boolean, alien: boolean, id: number, hex: string) {
    let s = this.tracers.find((q) => q.left <= 0 && q.alien === alien);
    if (!s) {
      const head = new THREE.Mesh(alien ? BOLT_HEAD : LASER_HEAD, headMat(hex)); head.frustumCulled = false;
      if (alien) head.add(new THREE.Mesh(HALO_GEO, HALO_MAT));
      const trail = new THREE.Mesh(TRAIL_GEO, trailMat(hex)); trail.frustumCulled = false; trail.renderOrder = 8;
      // a white-hot core down the middle of the colour, so it reads against any sky
      const core = new THREE.Mesh(TRAIL_GEO, trailMat('#ffffff')); core.scale.set(0.38, 0.38, 1); core.position.z = 0.001; core.renderOrder = 9; trail.add(core);
      this.group.add(head, trail);
      s = { head, trail, p: new THREE.Vector3(), d: new THREE.Vector3(), v, left: 0, run: 0, mine, alien, id, hex, r: 0 };
      this.tracers.push(s);
    }
    if (s.hex !== hex) { s.head.material = headMat(hex); s.trail.material = trailMat(hex); s.hex = hex; }
    s.p.copy(o); s.d.copy(d); s.v = v; s.left = range; s.run = 0; s.mine = mine; s.alien = alien; s.id = id;
    s.r = alien ? 1.0 : 0.34;                      // the tracer's width at its head
    s.head.visible = s.trail.visible = true;
    this.placeTracer(s);
  }
  private placeTracer(s: Tracer) {
    // the tail stretches out behind the head as it flies, up to its full length (lasers long and thin, plasma short and fat)
    const L = Math.min(s.run + 0.5, s.alien ? 24 : 45);
    _q.setFromUnitVectors(_z, s.d);
    s.head.position.copy(s.p); s.head.quaternion.copy(_q);
    s.trail.position.copy(s.p); s.trail.quaternion.copy(_q); s.trail.scale.set(s.r, s.r, L);
    if (s.alien) s.head.rotation.z += this.t * 9;
  }
  private updateTracers(dt: number, eye: THREE.Vector3) {
    for (const s of this.tracers) {
      if (s.left <= 0) continue;
      const step = s.v * dt;
      if (!s.alien) {
        // my own lasers: did this stretch pass through a ship, the saucer or an alien bolt?
        if (s.mine && this.endT < 0) {
          let hit = -2, best = step, bolt: Tracer | null = null;
          for (let i = 0; i < this.total; i++) {
            if (!this.present(i)) continue;
            const t = raySphere(s.p, s.d, this.shipPos(i, _v), HIT_R);
            if (t >= 0 && t < best) { best = t; hit = i; }
          }
          if (this.ufoT >= 0) { const t = raySphere(s.p, s.d, this.ufoPos(_v), 4.6); if (t >= 0 && t < best) { best = t; hit = -1; } }
          for (const b of this.tracers) {
            if (!b.alien || b.left <= 0) continue;
            const t = raySphere(s.p, s.d, b.p, 1.5); if (t >= 0 && t < best) { best = t; hit = -2; bolt = b; }
          }
          if (bolt) { this.endTracer(s); this.popBolt(bolt); this.onEvent?.({ op: 'bx', id: bolt.id }); continue; }
          if (hit !== -2) {
            this.endTracer(s);
            if (this.remote) { this.onEvent?.({ op: 'h', i: hit }); this.boom(hit, true); }
            else this.kill(hit, this.myId);
            continue;
          }
        }
      } else if (this.endT < 0) {
        // an alien bolt: does it reach a cannon (mine jolts me), or the ground?
        let gone = false;
        for (const [id, c] of this.cannons) {
          const head = id === this.myId ? eye : _w.copy(c.seat).setY(c.seat.y + 1.45);
          const t = raySphere(s.p, s.d, head, BOLT_HIT);
          if (t >= 0 && t < step) {
            c.jolt = 0.6; this.flash(_v.copy(s.p).addScaledVector(s.d, t), 0.35, 3);
            if (id === this.myId && this.seated) { this.stun = STUN; this.onJolt?.(); this.sfx?.jolt?.(); }
            gone = true; break;
          }
        }
        if (!gone && s.p.y + s.d.y * step < this.C.y - 0.5) { this.popBolt(s); continue; }
        if (gone) { this.endTracer(s); continue; }
      }
      s.p.addScaledVector(s.d, step); s.left -= step; s.run += step;
      this.placeTracer(s);
      if (s.left <= 0) this.endTracer(s);
    }
  }
  private endTracer(s: Tracer) { s.left = 0; s.head.visible = s.trail.visible = false; }
  /** an alien bolt bursts (shot down, or into the ground) */
  private popBolt(b: Tracer) {
    this.flash(b.p, 0.3, 2.5);
    const c = new THREE.Color(b.hex);
    for (let k = 0; k < 12; k++) this.bits.push({ p: b.p.clone(), v: new THREE.Vector3(Math.random() - 0.5, Math.random(), Math.random() - 0.5).multiplyScalar(9), life: 0.6, c, s: 0.35 });
    this.endTracer(b);
    this.sfx?.alienBoom(0.3);
  }
  private flash(p: THREE.Vector3, t: number, s: number) {
    const fl = this.flashes.reduce((a, b) => (b.t < a.t ? b : a));
    fl.t = t; fl.mesh.position.copy(p); fl.mesh.visible = true; fl.mesh.userData.s = s;
  }
  /** host: ship i (-1 = the saucer) is down, by player `by` (-1: it got through, and takes a shield) */
  private kill(i: number, by: number) {
    if (i === -1 ? this.ufoT < 0 : !this.alive[i]) return;
    const pts = by < 0 ? 0 : this.pointsOf(i);
    if (by >= 0) this.score.set(by, (this.score.get(by) ?? 0) + pts);
    else this.shields--;
    this.onEvent?.({ op: 'k', i, by, p: pts, sh: this.shields });
    this.applyKill(i);
  }
  private applyKill(i: number) {
    this.boom(i, false);
    if (i === -1) { this.ufoT = -1; this.ufo.visible = false; } else this.alive[i] = false;
  }
  /** an explosion where ship i is (`spark`: just my shot's flash while the host decides) */
  private boom(i: number, spark: boolean) {
    const p = i === -1 ? this.ufoPos(new THREE.Vector3()) : this.shipPos(i, new THREE.Vector3());
    const col = new THREE.Color(i === -1 ? '#ff4a3a' : COLORS[this.kindOf(i)]);
    this.flash(p, 0.45, 1);
    if (spark) return;
    for (let k = 0; k < (i === -1 ? 60 : 36); k++) {
      if (this.bits.length >= 400) this.bits.shift();
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize().multiplyScalar(6 + Math.random() * 16);
      this.bits.push({ p: p.clone().add(v.clone().multiplyScalar(0.12)), v, life: 1.2 + Math.random() * 0.9, c: col.clone().lerp(new THREE.Color('#fff7c8'), Math.random() * 0.5), s: 0.6 + Math.random() * 0.9 });
    }
    this.sfx?.alienBoom(1);
  }
  private updateBits(dt: number) {
    let n = 0;
    for (const b of this.bits) {
      b.life -= dt; if (b.life <= 0) continue;
      b.v.y -= 9 * dt; b.v.multiplyScalar(1 - dt * 0.6); b.p.addScaledVector(b.v, dt);
      _m.compose(b.p, _q.setFromAxisAngle(_v.set(1, 1, 0).normalize(), b.life * 6), _s.setScalar(b.s * Math.min(1, b.life * 1.4)));
      this.bitMesh.setMatrixAt(n, _m); this.bitMesh.setColorAt(n, b.c); n++;
    }
    this.bits = this.bits.filter((b) => b.life > 0);
    this.bitMesh.count = n;
    if (n) { this.bitMesh.instanceMatrix.needsUpdate = true; if (this.bitMesh.instanceColor) this.bitMesh.instanceColor.needsUpdate = true; }
    for (const f of this.flashes) {
      if (f.t <= 0) { f.mesh.visible = false; continue; }
      f.t -= dt; const k = Math.max(0, f.t / 0.45), s = (f.mesh.userData.s as number) ?? 1;
      f.mesh.scale.setScalar((2 + (1 - k) * 7) / s); (f.mesh.material as THREE.MeshBasicMaterial).opacity = k * 0.9;
    }
  }
  private hostEnd(win: boolean) {
    if (this.endT >= 0) return;
    this.endT = 0; this.win = win;
    this.onEvent?.({ op: 'end', w: win ? 1 : 0, sc: [...this.score.entries()] });
    this.ended();
  }
  private ended() {
    if (this.win) { this.sfx?.clear8(); this.say?.('Both waves beaten! The sky is ours again.'); }
    else if (this.level === 2) this.say?.('They broke through... and, finding only coconuts, flew off again.');
    else this.say?.('The invaders landed... they took one look at the island and flew off again.');
  }

  private drawBoard() {
    const left = this.left, rows = [...this.score.entries()].sort((a, b) => b[1] - a[1]);
    const key = `${this.level}|${left}|${this.shields}|${this.stun > 0 ? 1 : 0}|${this.banner > 0 ? 1 : 0}|${rows.map((r) => r.join(':')).join(',')}|${this.endT >= 0 ? (this.win ? 'w' : 'l') : ''}`;
    if (key === this.boardKey) return;
    this.boardKey = key;
    const c = this.boardCtx, W = 512, H = 300;
    c.clearRect(0, 0, W, H);
    c.fillStyle = this.stun > 0 ? 'rgba(60,8,12,0.88)' : 'rgba(8,10,30,0.82)'; c.beginPath(); c.roundRect(4, 4, W - 8, H - 8, 22); c.fill();
    c.strokeStyle = this.stun > 0 ? '#ff5a4a' : '#5ff6ff'; c.lineWidth = 4; c.stroke();
    c.textBaseline = 'middle'; c.textAlign = 'left';
    c.fillStyle = '#ff4fd8'; c.font = 'bold 28px monospace'; c.fillText(`LEVEL ${this.level}`, 26, 36);
    c.textAlign = 'right'; c.fillStyle = '#7dff5a';
    c.fillText(`${left}/${this.total} LEFT`, W - 26, 36);
    if (this.level === 2) {
      c.textAlign = 'left'; c.fillStyle = '#5ff6ff'; c.font = 'bold 22px monospace'; c.fillText('SHIELDS', 26, 70);
      for (let k = 0; k < SHIELDS; k++) { c.fillStyle = k < this.shields ? '#5ff6ff' : 'rgba(95,246,255,0.18)'; c.fillRect(140 + k * 30, 60, 22, 20); }
    }
    c.textAlign = 'left'; c.font = 'bold 24px monospace';
    const y0 = this.level === 2 ? 108 : 86;
    rows.slice(0, 5).forEach(([id, sc], k) => {
      const w = this.who(id), y = y0 + k * 32;
      c.fillStyle = w.color; c.fillRect(26, y - 10, 18, 18);
      c.fillStyle = id === this.myId ? '#ffd23f' : '#ffffff';
      c.fillText((id === this.myId && w.name !== 'You' ? `${w.name} (you)` : w.name).slice(0, 18), 56, y);
      c.textAlign = 'right'; c.fillText(String(sc).padStart(5, ' '), W - 26, y); c.textAlign = 'left';
    });
    const strip = (txt: string, col: string) => {
      c.fillStyle = 'rgba(0,0,0,0.7)'; c.fillRect(4, H - 66, W - 8, 58);
      c.fillStyle = col; c.font = 'bold 28px monospace'; c.textAlign = 'center'; c.fillText(txt, W / 2, H - 37);
    };
    if (this.endT >= 0) strip(this.win ? 'EARTH IS SAVED!' : this.level === 2 ? 'THEY BROKE THROUGH!' : 'THEY LANDED!', this.win ? '#7dff5a' : '#ff6a5a');
    else if (this.banner > 0) strip('LEVEL 2: LOOK ALL AROUND!', '#ffd23f');
    else if (this.stun > 0) strip('HIT! CANNON JAMMED', '#ff6a5a');
    this.boardTex.needsUpdate = true;
  }

  // ------------------------------------------------------------------ network
  net(e: InvEvent, from: number) {
    const v3 = (a: any) => new THREE.Vector3(+a[0], +a[1], +a[2]);
    switch (e.op) {
      case 'start': if (this.remote && Array.isArray(e.ids)) this.begin(e.ids.map(Number)); break;
      case 'f':
        if (!this.remote) break;
        this.netF = { x: +e.x, y: +e.y, d: +e.d }; this.fdir = +e.r || 1; this.lastNet = this.t;
        if (+e.l === 2 && this.level !== 2) this.startLevel2();
        if (this.level === 2 && Number.isFinite(+e.lt)) { const d = +e.lt - this.lt; this.lt += Math.abs(d) > 0.4 ? d : d * 0.3; }
        break;
      case 'lv': if (this.remote && this.running && +e.n === 2 && this.level !== 2) this.startLevel2(); break;
      case 'u': if (this.remote && this.running) this.startUfo(+e.r || 1); break;
      case 's': {
        if (!this.running || !Array.isArray(e.o) || !Array.isArray(e.d)) break;
        const c = this.cannons.get(from), d = v3(e.d).normalize();
        this.spawnTracer(v3(e.o), d, LASER_V, LASER_RANGE, false, false, 0, this.who(from).color);
        if (c) c.aim.copy(d);
        this.sfx?.laser(0.45);
        break;
      }
      case 'b': {
        if (!this.remote || !this.running || !Array.isArray(e.o) || !Array.isArray(e.d)) break;
        this.spawnTracer(v3(e.o), v3(e.d).normalize(), BOLT_V, 300, false, true, +e.id, COLORS[+e.c] ?? COLORS[0]);
        this.sfx?.alienShot?.(0.8);
        break;
      }
      case 'bx': { const b = this.tracers.find((q) => q.alien && q.left > 0 && q.id === +e.id); if (b) this.popBolt(b); break; }
      case 'h': if (!this.remote && this.running && this.endT < 0) this.kill(+e.i, from); break;
      case 'k':
        if (this.remote && this.running) {
          if (+e.by >= 0) this.score.set(+e.by, (this.score.get(+e.by) ?? 0) + (+e.p || 0));
          if (Number.isFinite(+e.sh)) this.shields = +e.sh;
          this.applyKill(+e.i);
        }
        break;
      case 'end':
        if (this.remote && this.running && this.endT < 0) {
          this.endT = 0; this.win = !!e.w;
          if (Array.isArray(e.sc)) for (const [id, s] of e.sc) this.score.set(+id, +s);
          this.ended();
        }
        break;
    }
  }
}

function raySphere(o: THREE.Vector3, d: THREE.Vector3, c: THREE.Vector3, r: number) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z, cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : cc < 0 ? 0 : -1;
}
