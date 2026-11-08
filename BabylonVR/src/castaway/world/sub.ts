// Submarines: a little glass submarine for up to four, built at the workbench and set down on deep water like a boat. It
// floats three quarters under, only its top out of the water, with a hatch on top: climb in and you sit down in a seat
// (the first one in takes the controls at the console in front). Everybody stays in their seat the whole time, riding along
// exactly; the driver sails it (W / S, A / D, Shift for full speed) and takes it down and up (C dives, Space rises; in VR
// the left stick up and down). The hatch only opens at the surface. Out past the reef the storm can only find you on the
// surface: down below it is calm. If the giant wave does get you, the sub washes up off the beach, like a raft.
// Multiplayer: seats are claimed by whoever sits first (event 'su' / op 'seat'); the driver moves the sub and tells the
// others ('mv'); everyone's avatar is placed exactly in their seat. Subs are part of the world save and the join snapshot.
import * as THREE from 'three';
import { heightAt } from './island';
import { STORM_R0, WRECK_R } from './boat';

/** a position (Babylon's Vector3 here) */
interface PV { x: number; y: number; z: number; set(x: number, y: number, z: number): unknown }

// sub space: origin in the middle of the hull, +z the stern (the bow points at -z, like a player's yaw), +x starboard
/** the hull: an egg of glass, half its width, height and length */
export const SAX = 1.75, SAY = 1.5, SAZ = 3.0;
/** where the glass meets the yellow steel bottom, the cabin floor, the seats' cushions */
const BELT = -0.72, FLOOR = -0.95, CUSH = -0.5;
/** how far under the water the middle of the hull sits when it floats (a quarter of it shows) */
const FLOAT = SAY * 0.5;
/** the seats (x, z): the driver's at the console, two side by side, one at the back */
const SEATS: [number, number][] = [[0, -1.15], [-0.72, 0.25], [0.72, 0.25], [0, 1.45]];
const MAX = 2, MAX_DEPTH = 110;
/** the floodlights (x, y, at the stern?) and the light switch on the console (top left, in front of the driver) */
const LAMPS: [number, number, boolean][] = [[-0.55, -0.85, false], [0.55, -0.85, false], [0, 0.35, true]];
const BUTTON: [number, number, number] = [-0.24, -0.4, -2.1];
/** how far from the middle of the island a submarine may go under water (the sea floor's edge) */
const DEEP_R = 372;

export interface SubRow { n: string; x: number; z: number; r: number }

export class Sub {
  group = new THREE.Group();
  /** who sits where (player ids; seat 0 drives) */
  seats: (number | null)[] = [null, null, null, null];
  /** how far below its floating depth it is (m) */
  depth = 0;
  y = 0; v = 0; yawV = 0; vy = 0; pitch = 0; roll = 0;
  /** remote: where the driver says it is */
  tx: number; tz: number; tyaw: number; tv = 0; tdepth = 0;
  /** the moving parts */
  lid: THREE.Group | null = null; prop: THREE.Group | null = null; yoke: THREE.Group | null = null; screen: THREE.Mesh | null = null;
  lidAng = 0;
  /** the floodlights at bow and stern, and what shows them: the lamps lit, the beams in the water, the console button */
  lights = false;
  lit: THREE.Object3D[] = [];
  unlit: THREE.Object3D[] = [];
  constructor(public nid: string, public x: number, public z: number, public yaw: number) { this.tx = x; this.tz = z; this.tyaw = yaw; }
}

// ------------------------------------------------------------------ the model
let MATS: Record<'hull' | 'lining' | 'steel' | 'dark' | 'glass' | 'seat' | 'floor' | 'screen' | 'lamp' | 'lampOff' | 'beam' | 'beam2' | 'btnOn' | 'btnOff', THREE.Material> | null = null;
function mats() {
  if (MATS) return MATS;
  const std = (c: string, r: number, m = 0, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => {
    const mt = new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m, ...extra });
    mt.emissive = new THREE.Color(c).multiplyScalar(0.06);
    return mt;
  };
  MATS = {
    hull: std('#f2b705', 0.45, 0.2), lining: std('#6d767d', 0.6, 0.5, { side: THREE.DoubleSide }), steel: std('#c3cbd1', 0.3, 0.8), dark: std('#2f3438', 0.6, 0.4),
    glass: new THREE.MeshStandardMaterial({ name: 'glass', color: '#cfe8f0', transparent: true, opacity: 0.3 }),
    seat: std('#2e5b8a', 0.8), floor: std('#4a5157', 0.7, 0.5),
    screen: new THREE.MeshBasicMaterial({ color: '#5ef2c0' }), lamp: new THREE.MeshBasicMaterial({ color: '#fff6c8' }), lampOff: std('#8d9499', 0.3, 0.6),
    // the beams: faint additive cones in the water (two lengths, so they fade along)
    beam: new THREE.MeshBasicMaterial({ color: '#cfe6ff', transparent: true, opacity: 0.045, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    beam2: new THREE.MeshBasicMaterial({ color: '#cfe6ff', transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    btnOn: new THREE.MeshBasicMaterial({ color: '#5dff7a' }), btnOff: new THREE.MeshBasicMaterial({ color: '#d0302a' }),
  };
  return MATS;
}
/** the egg's half width (x) at height y and length z, or 0 */
const halfX = (y: number, z: number) => SAX * Math.sqrt(Math.max(0, 1 - (y / SAY) ** 2 - (z / SAZ) ** 2));

function makeModel(ghost: THREE.Material | null, shadows: boolean, s: Sub | null): THREE.Group {
  const M = mats(), g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, to: THREE.Object3D = g) => {
    const o = new THREE.Mesh(geo, ghost ?? m); o.castShadow = shadows && !ghost && m !== M.glass; o.receiveShadow = shadows && !ghost; to.add(o); return o;
  };
  // the steel bottom, up to the belt, and the glass dome over it (the glass a hair inside the steel where they meet)
  const tBelt = Math.acos(BELT / SAY);
  add(new THREE.SphereGeometry(1, 36, 12, 0, Math.PI * 2, tBelt, Math.PI - tBelt).scale(SAX, SAY, SAZ), M.hull);
  add(new THREE.SphereGeometry(0.995, 40, 20, 0, Math.PI * 2, 0, tBelt + 0.02).scale(SAX, SAY, SAZ), M.glass);
  // ... lined with grey steel inside, from the belt down to the floor (no seeing out through the bottom)
  add(new THREE.SphereGeometry(0.985, 36, 12, 0, Math.PI * 2, tBelt - 0.03, Math.PI - tBelt + 0.03).scale(SAX, SAY, SAZ), M.lining);
  // a steel belt round it, ribs over the dome, and a spine
  const ring = (rx: number, rz: number, r: number) => new THREE.TorusGeometry(1, r, 6, 56).rotateX(Math.PI / 2).scale(rx, 1, rz);
  add(ring(halfX(BELT, 0) + 0.02, SAZ * Math.sqrt(1 - (BELT / SAY) ** 2) + 0.02, 0.06).translate(0, BELT, 0), M.steel);
  // (each rib runs from the belt on one side, over the top, down to the belt on the other)
  for (const z of [-0.4, 1.6]) {
    const hx = halfX(0, z) + 0.01, hy = SAY * Math.sqrt(1 - (z / SAZ) ** 2) + 0.01, a0 = Math.asin(Math.max(-1, BELT / hy));
    add(new THREE.TorusGeometry(1, 0.035, 5, 48, Math.PI - 2 * a0).rotateZ(a0).scale(hx, hy, 1).translate(0, 0, z), M.steel);
  }
  // the hatch on top: a collar, and its lid on a hinge
  add(new THREE.CylinderGeometry(0.5, 0.52, 0.16, 24, 1, true).translate(0, SAY - 0.02, 0), M.steel);
  add(new THREE.TorusGeometry(0.5, 0.04, 6, 24).rotateX(Math.PI / 2).translate(0, SAY + 0.06, 0), M.steel);
  const hinge = new THREE.Group(); hinge.position.set(0, SAY + 0.07, 0.5); g.add(hinge);
  add(new THREE.CylinderGeometry(0.5, 0.5, 0.06, 24).translate(0, 0.03, -0.5), M.hull, hinge);
  add(new THREE.TorusGeometry(0.16, 0.025, 5, 12).translate(0, 0.08, -0.5), M.steel, hinge);
  // the cabin floor and the seats
  add(new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2).scale(halfX(FLOOR, 0) - 0.02, 1, SAZ * Math.sqrt(1 - (FLOOR / SAY) ** 2) - 0.02).translate(0, FLOOR, 0), M.floor);
  for (const [x, z] of SEATS) {
    add(new THREE.BoxGeometry(0.52, 0.12, 0.5).translate(x, CUSH - 0.06, z), M.seat);
    add(new THREE.BoxGeometry(0.52, 0.62, 0.1).rotateX(-0.12).translate(x, CUSH + 0.3, z + 0.29), M.seat);
    add(new THREE.CylinderGeometry(0.06, 0.1, CUSH - 0.12 - FLOOR, 8).translate(x, (CUSH - 0.12 + FLOOR) / 2, z), M.steel);
  }
  // the console in front of the driver: a pedestal, a sloping panel with a screen, a yoke
  add(new THREE.BoxGeometry(0.56, 0.4, 0.26).translate(0, FLOOR + 0.2, -2.1), M.dark);
  add(new THREE.BoxGeometry(0.62, 0.05, 0.34).rotateX(0.7).translate(0, FLOOR + 0.44, -2.04), M.dark);
  const screen = add(new THREE.PlaneGeometry(0.3, 0.16).rotateX(-Math.PI / 2 + 0.7).translate(0, FLOOR + 0.475, -2.03), M.screen);
  const yoke = new THREE.Group(); yoke.position.set(0, FLOOR + 0.55, -1.86); g.add(yoke);
  add(new THREE.CylinderGeometry(0.02, 0.02, 0.2, 6).rotateX(Math.PI / 2).translate(0, 0, 0.1), M.steel, yoke);
  add(new THREE.BoxGeometry(0.4, 0.04, 0.04).translate(0, 0, 0.2), M.dark, yoke);
  for (const sd of [-1, 1]) add(new THREE.CylinderGeometry(0.025, 0.025, 0.14, 6).translate(sd * 0.2, 0.05, 0.2), M.dark, yoke);
  // floodlights: two at the bow, one at the stern, each a lamp (dark when off) and a beam out into the water
  const lit: THREE.Object3D[] = [], unlit: THREE.Object3D[] = [];
  for (const [x, y, back] of LAMPS) {
    const z = (back ? 1 : -1) * (SAZ * Math.sqrt(1 - (x / SAX) ** 2 - (y / SAY) ** 2) + 0.02), ry = back ? 0 : Math.PI;
    add(new THREE.CylinderGeometry(0.17, 0.2, 0.12, 16).rotateX(Math.PI / 2).rotateY(ry).translate(x, y, z), M.steel);
    unlit.push(add(new THREE.CircleGeometry(0.14, 16).rotateY(ry).translate(x, y, z + (back ? 0.065 : -0.065)), M.lampOff));
    lit.push(add(new THREE.CircleGeometry(0.14, 16).rotateY(ry).translate(x, y, z + (back ? 0.07 : -0.07)), M.lamp));
    if (!ghost) {
      // (pointing out along the hull, tipped a little down)
      const dz = back ? 1 : -1, tip = back ? 0.18 : -0.22;
      for (const [len, rad, mt] of [[13, 3.2, M.beam]] as [number, number, THREE.Material][]) {
        const c = new THREE.Mesh(new THREE.ConeGeometry(rad, len, 20, 1, true).translate(0, -len / 2, 0).rotateX(-dz * Math.PI / 2).rotateX(tip), mt);
        c.position.set(x, y, z); c.renderOrder = 3; g.add(c); lit.push(c);
      }
    }
  }
  // the switch: a button at the top left of the console (red off, green on)
  // (on the sloping panel: tipped back with it)
  const onPanel = (geo: THREE.BufferGeometry, up: number) => geo.translate(0, up, 0).rotateX(0.7).translate(BUTTON[0], BUTTON[1], BUTTON[2]);
  add(onPanel(new THREE.BoxGeometry(0.1, 0.02, 0.1), -0.005), M.steel);
  unlit.push(add(onPanel(new THREE.CylinderGeometry(0.032, 0.032, 0.03, 14), 0.02), M.btnOff));
  lit.push(add(onPanel(new THREE.CylinderGeometry(0.032, 0.032, 0.03, 14), 0.014), M.btnOn));
  for (const o of lit) o.visible = false;
  add(new THREE.CylinderGeometry(0.16, 0.05, 0.5, 12).rotateX(Math.PI / 2).translate(0, -0.3, SAZ + 0.1), M.hull);
  const prop = new THREE.Group(); prop.position.set(0, -0.3, SAZ + 0.38); g.add(prop);
  for (let k = 0; k < 3; k++) add(new THREE.BoxGeometry(0.06, 0.42, 0.02).translate(0, 0.21, 0).rotateY(0.4).rotateZ(k * Math.PI * 2 / 3), M.steel, prop);
  for (const sd of [-1, 1]) add(new THREE.BoxGeometry(0.5, 0.04, 0.3).translate(sd * 0.3, -0.3, SAZ + 0.05), M.hull);
  if (s) { s.lid = hinge; s.prop = prop; s.yoke = yoke; s.screen = screen; s.lit = lit; s.unlit = unlit; }
  return g;
}

// ------------------------------------------------------------------ space
const _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _v = new THREE.Vector3(), _o = new THREE.Vector3();
function toWorld<T extends PV>(s: Sub, lx: number, ly: number, lz: number, out: T): T {
  _e.set(s.pitch, s.yaw, s.roll); _q.setFromEuler(_e);
  const w = _v.set(lx, ly, lz).applyQuaternion(_q).add(_o.set(s.x, s.y, s.z));
  out.set(w.x, w.y, w.z);
  return out;
}
function toLocal(s: Sub, x: number, y: number, z: number, out: THREE.Vector3) {
  _e.set(s.pitch, s.yaw, s.roll); _q.setFromEuler(_e).invert();
  return out.set(x - s.x, y - s.y, z - s.z).applyQuaternion(_q);
}
const L1 = new THREE.Vector3(), L2 = new THREE.Vector3();

export class Subs {
  readonly list: Sub[] = [];
  myId = 0;
  /** the sub I sit in, and my seat in it (-1: none) */
  mine: Sub | null = null;
  seat = -1;
  private ghost: THREE.Group;
  private ghostMat = new THREE.MeshBasicMaterial({ color: 0x7cff9a, transparent: true, opacity: 0.35, depthWrite: false });
  private mvT = 0;
  private hum = 0;
  private lastYaw = NaN;

  onEvent: ((e: Record<string, unknown>) => void) | null = null;
  present: (id: number) => boolean = () => true;
  surface: (x: number, z: number) => number = () => 0;
  say: ((t: string) => void) | null = null;
  sfx: { splash(v?: number): void; bonk(): void; creak(): void } | null = null;
  shake: ((a: number) => void) | null = null;
  /** (set by the game) the sea surface's cut-outs: the hulls, so no water shows inside them */
  holes: number[] = new Array(32).fill(0);

  constructor(private scene: THREE.Scene, private shadows: boolean) {
    this.ghost = makeModel(this.ghostMat, false, null);
    this.ghost.visible = false;
    scene.add(this.ghost);
  }

  // -------------------------------------------------------------- placing
  /** deep enough under the whole hull at (x, z, yaw) for it to float (or sit `depth` lower)? */
  clear(x: number, z: number, yaw: number, depth = 0, sea = 0): boolean {
    const s = Math.sin(yaw), c = Math.cos(yaw), bottom = sea - FLOAT - depth - SAY;
    for (const [lx, lz, k] of [[0, 0, 1], [0, -SAZ, 0.35], [0, SAZ, 0.35], [-SAX, 0, 0.35], [SAX, 0, 0.35], [-1.2, -2, 0.6], [1.2, -2, 0.6], [-1.2, 2, 0.6], [1.2, 2, 0.6]]) {
      const wx = x + lx * c + lz * s, wz = z - lx * s + lz * c;
      // (the egg's bottom is highest out at its edges)
      if (heightAt(wx, wz) > bottom + SAY * (1 - k) - 0.3) return false;
    }
    return true;
  }
  aim(eye: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, yaw: number): { ok: boolean; why: string; x: number; z: number; yaw: number } {
    const out = { ok: false, why: '', x: 0, z: 0, yaw };
    if (this.list.length >= MAX) { out.why = `There are ${MAX} submarines already`; return out; }
    const hl = Math.hypot(dir.x, dir.z) || 1, hx = dir.x / hl, hz = dir.z / hl;
    const t = dir.y < -0.05 ? Math.max(4, Math.min(30, eye.y / -dir.y)) * hl : 10;
    const bx = eye.x + hx * t, bz = eye.z + hz * t;
    out.x = bx; out.z = bz;
    if (t > 30) { out.why = 'Too far away'; return out; }
    const fits = (x: number, z: number, r: number) => this.clear(x, z, r, 0.6) && !this.list.some((b) => Math.hypot(b.x - x, b.z - z) < 9) && Math.hypot(x - eye.x, z - eye.z) > 4;
    for (let step = 0; step <= 14; step++) {
      for (const side of step === 0 ? [0] : [0, -1, 1]) {
        const x = bx + hx * step * 2 - hz * side * step * 1.2, z = bz + hz * step * 2 + hx * side * step * 1.2;
        for (const r of [yaw, yaw + Math.PI / 2]) if (fits(x, z, r)) { out.x = x; out.z = z; out.yaw = r; out.ok = true; return out; }
      }
    }
    out.why = heightAt(bx, bz) > -0.05 ? 'Submarines go on the water: aim at the sea' : 'Too shallow: a submarine needs deeper water';
    return out;
  }
  showGhost(a: { ok: boolean; x: number; z: number; yaw: number } | null, time = 0) {
    this.ghost.visible = !!a && a.x !== 0;
    if (!a || !this.ghost.visible) return;
    this.ghost.position.set(a.x, this.surface(a.x, a.z) - FLOAT + 0.05 * Math.sin(time * 2), a.z);
    this.ghost.rotation.set(0, a.yaw, 0);
    this.ghostMat.color.set(a.ok ? 0x7cff9a : 0xff6a5a);
  }

  add(nid: string, x: number, z: number, yaw: number, remote = false): Sub | null {
    if (this.list.some((b) => b.nid === nid)) return null;
    const s = new Sub(nid, x, z, yaw);
    s.group = makeModel(null, this.shadows, s);
    s.y = this.surface(x, z) - FLOAT;
    this.place(s);
    this.scene.add(s.group);
    this.list.push(s);
    if (!remote) this.onEvent?.({ op: 'add', n: nid, x: +x.toFixed(2), z: +z.toFixed(2), r: +yaw.toFixed(3) });
    return s;
  }
  remove(s: Sub, remote = false) {
    const i = this.list.indexOf(s); if (i < 0) return;
    this.list.splice(i, 1);
    this.scene.remove(s.group);
    if (this.mine === s) { this.mine = null; this.seat = -1; }
    if (!remote) this.onEvent?.({ op: 'del', n: s.nid });
  }
  byId(nid: string) { return this.list.find((s) => s.nid === nid) ?? null; }
  /** at the surface (the hatch can open) */
  surfaced(s: Sub) { return s.depth < 0.4; }
  occupied(s: Sub) { return s.seats.some((p) => p !== null && (p === this.myId || this.present(p))); }

  // -------------------------------------------------------------- outside: standing on it, bumping into it
  /** the top of the hull under (x, z), for someone at height y (stand on it, by the hatch), or -1e9 */
  ground(x: number, z: number, y = 1e9): number {
    let best = -1e9;
    for (const s of this.list) {
      if (Math.abs(x - s.x) > SAZ + 1 || Math.abs(z - s.z) > SAZ + 1) continue;
      const l = toLocal(s, x, Math.min(y, s.y + 10), z, L1), k = (l.x / SAX) ** 2 + (l.z / SAZ) ** 2;
      if (k >= 1) continue;
      const top = toWorld(s, l.x, SAY * Math.sqrt(1 - k), l.z, L2).y;
      if (top <= y + 0.9 && top > best) best = top;
    }
    return best;
  }
  /** pushes a walker or a swimmer out of the hull */
  resolve(x: number, z: number, r: number, feetY: number, out: { x: number; z: number }) {
    for (const s of this.list) {
      if (Math.abs(x - s.x) > SAZ + 2 || Math.abs(z - s.z) > SAZ + 2) continue;
      if (s === this.mine) continue;
      const l = toLocal(s, x, feetY + 0.5, z, L1);
      if (l.y > SAY || l.y < -SAY - 1.8) continue;
      const yy = Math.max(-SAY + 0.01, Math.min(SAY - 0.01, l.y)), f = Math.sqrt(1 - (yy / SAY) ** 2), ax = SAX * f + r, az = SAZ * f + r;
      const k = (l.x / ax) ** 2 + (l.z / az) ** 2;
      if (k >= 1) continue;
      // standing on its top: no push
      if (feetY > toWorld(s, l.x, SAY * Math.sqrt(Math.max(0, 1 - (l.x / SAX) ** 2 - (l.z / SAZ) ** 2)), l.z, L2).y - 0.25) continue;
      const m = 1 / Math.sqrt(k), w = toWorld(s, l.x * m, l.y, l.z * m, L2);
      x = w.x; z = w.z;
    }
    out.x = x; out.z = z;
  }
  /** a sub I'm looking at (from outside) or close beside, within reach */
  target(eye: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, max: number): { s: Sub; dist: number } | null {
    let best: { s: Sub; dist: number } | null = null;
    for (const s of this.list) {
      if (s === this.mine || Math.hypot(s.x - eye.x, s.z - eye.z) > max + SAZ) continue;
      const o = toLocal(s, eye.x, eye.y, eye.z, L1).clone(), d = toLocal(s, eye.x + dir.x, eye.y + dir.y, eye.z + dir.z, L2).sub(o);
      // a ray into the egg: scale it to a unit sphere
      const ox = o.x / SAX, oy = o.y / SAY, oz = o.z / SAZ, dx = d.x / SAX, dy = d.y / SAY, dz = d.z / SAZ;
      const A = dx * dx + dy * dy + dz * dz, B = 2 * (ox * dx + oy * dy + oz * dz), C = ox * ox + oy * oy + oz * oz - 1.15;
      const disc = B * B - 4 * A * C; if (disc < 0) continue;
      const t = (-B - Math.sqrt(disc)) / (2 * A);
      if (t >= -0.5 && t <= max && (!best || t < best.dist)) best = { s, dist: Math.max(0, t) };
    }
    return best;
  }

  // -------------------------------------------------------------- seats
  /** climb in through the hatch: the first free seat (the controls first, if free). False if there is no room / no way in. */
  enter(s: Sub): string | null {
    if (this.mine) return 'You are in one already';
    if (!this.surfaced(s)) return 'The hatch only opens at the surface';
    const free = s.seats.findIndex((p) => p === null || (p !== this.myId && !this.present(p)));
    if (free < 0) return 'All four seats are taken';
    this.sit(s, free);
    this.sfx?.creak();
    return null;
  }
  private sit(s: Sub, i: number) {
    if (this.mine && this.seat >= 0 && this.mine.seats[this.seat] === this.myId) this.mine.seats[this.seat] = null;
    s.seats[i] = this.myId; this.mine = s; this.seat = i; this.lastYaw = NaN;
    if (i === 0) { s.tdepth = s.depth; s.tv = s.v; }
    this.onEvent?.({ op: 'seat', n: s.nid, s: i });
  }
  /** move to the controls (if nobody has them) */
  takeControls(): boolean {
    const s = this.mine; if (!s || this.seat === 0) return false;
    const d = s.seats[0];
    if (d !== null && d !== this.myId && this.present(d)) return false;
    this.sit(s, 0);
    return true;
  }
  /** climb out through the hatch onto the top of the hull. Sets the feet `pos`. Null when done, else why not. */
  leave(pos: PV, force = false): string | null {
    const s = this.mine; if (!s) return null;
    if (!force && !this.surfaced(s)) return 'Take it up to the surface first (Space / left stick up), then open the hatch';
    if (s.seats[this.seat] === this.myId) s.seats[this.seat] = null;
    this.onEvent?.({ op: 'seat', n: s.nid, s: -1 });
    this.mine = null; this.seat = -1;
    toWorld(s, 0.6, SAY * Math.sqrt(1 - (0.6 / SAX) ** 2) + 0.05, 0, pos);
    this.sfx?.splash(0.3);
    return null;
  }
  /** One frame in my seat: where my feet go (on the cabin floor in front of the seat), where my eyes are, the view turning
   *  with the sub. False once I'm out. */
  carry(pos: PV, eye: { x: number; y: number; z: number }, look: { yaw: number }): boolean {
    const s = this.mine; if (!s || this.seat < 0) return false;
    const [sx, sz] = SEATS[this.seat];
    toWorld(s, sx, CUSH - 0.06, sz, pos);
    toWorld(s, sx, CUSH + 0.78, sz - 0.05, L2); eye.x = L2.x; eye.y = L2.y; eye.z = L2.z;
    if (!Number.isNaN(this.lastYaw)) { let d = s.yaw - this.lastYaw; d = Math.atan2(Math.sin(d), Math.cos(d)); look.yaw += d; }
    this.lastYaw = s.yaw;
    return true;
  }
  /** multiplayer: where another player's seat is right now (their avatar sits in it, not at their laggy position) */
  seatOf(id: number, out: { x: number; y: number; z: number; yaw: number }): boolean {
    for (const s of this.list) {
      const i = s.seats.indexOf(id); if (i < 0) continue;
      const [sx, sz] = SEATS[i];
      toWorld(s, sx, CUSH - 0.06, sz, L2);
      out.x = L2.x; out.y = L2.y; out.z = L2.z; out.yaw = s.yaw;
      return true;
    }
    return false;
  }
  /** is this player sitting in a sub? */
  seated(id: number) { return this.list.some((s) => s.seats.includes(id)); }

  // -------------------------------------------------------------- every frame
  /** `ctl`: my stick / keys (if I drive): x turn, y ahead, rise up (+) or down (-) */
  update(dt: number, time: number, ctl: { x: number; y: number; rise: number; boost: boolean }) {
    for (const s of this.list) {
      for (let i = 0; i < 4; i++) { const p = s.seats[i]; if (p !== null && p !== this.myId && !this.present(p)) s.seats[i] = null; }
      const driver = s.seats[0];
      if (s === this.mine && this.seat === 0) this.drive(s, dt, ctl);
      else if (driver !== null && driver !== this.myId) {
        s.tx -= Math.sin(s.tyaw) * s.tv * dt; s.tz -= Math.cos(s.tyaw) * s.tv * dt;
        const k = 1 - Math.exp(-dt * 6);
        s.x += (s.tx - s.x) * k; s.z += (s.tz - s.z) * k;
        let d = s.tyaw - s.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); s.yaw += d * k; s.yawV = d * 2;
        s.depth += (s.tdepth - s.depth) * k; s.v = s.tv;
      } else {
        // nobody at the controls: it drifts to a stop and floats up
        s.v *= Math.exp(-dt * 0.6); s.yawV *= Math.exp(-dt);
        s.depth = Math.max(0, s.depth - dt * 0.8);
        s.tx = s.x; s.tz = s.z; s.tyaw = s.yaw; s.tdepth = s.depth;
      }
      this.float(s, dt, time);
      this.animate(s, dt, time);
    }
    const m = this.mine;
    if (m && this.seat === 0) {
      this.mvT -= dt;
      if (this.mvT <= 0) { this.mvT = 0.1; this.onEvent?.({ op: 'mv', n: m.nid, x: +m.x.toFixed(2), z: +m.z.toFixed(2), r: +m.yaw.toFixed(3), v: +m.v.toFixed(2), d: +m.depth.toFixed(2) }); }
      this.hum -= dt;
      if (this.hum <= 0) { this.hum = 2.5 + Math.random() * 2; if (m.depth < 1 && Math.abs(m.v) > 1) this.sfx?.splash(0.12); }
    }
    // the sea surface stays out of the hulls
    for (let i = 0; i < 4; i++) {
      const s = this.list[i], o = i * 4;
      if (!s) { this.holes[16 + o + 3] = 0; continue; }
      this.holes[o] = s.x; this.holes[o + 1] = s.y; this.holes[o + 2] = s.z; this.holes[o + 3] = s.yaw;
      this.holes[16 + o] = SAX - 0.02; this.holes[16 + o + 1] = SAY - 0.02; this.holes[16 + o + 2] = SAZ - 0.02; this.holes[16 + o + 3] = 1;
    }
  }
  /** the controls: ahead and astern, turning, diving and rising; it won't go aground or dig into the bottom */
  private drive(s: Sub, dt: number, ctl: { x: number; y: number; rise: number; boost: boolean }) {
    const maxV = ctl.boost ? 6.5 : 4.5;
    const want = ctl.y >= 0 ? ctl.y * maxV : ctl.y * 2;
    s.v += (want - s.v) * Math.min(1, dt * (Math.abs(want) > Math.abs(s.v) ? 0.5 : 0.8));
    const turn = -ctl.x * 0.55 * Math.min(1, 0.35 + Math.abs(s.v) / 3) * (s.v < -0.1 ? -1 : 1);
    s.yawV += (turn - s.yawV) * Math.min(1, dt * 2.5);
    s.yaw += s.yawV * dt;
    // up and down
    s.vy += (ctl.rise * 1.6 - s.vy) * Math.min(1, dt * 1.5);
    const sea = this.surface(s.x, s.z);
    let nd = Math.max(0, Math.min(MAX_DEPTH, s.depth - s.vy * dt));
    // (the sea floor ends at the edge of the world: out there it stays at the surface)
    if (nd > 1.5 && Math.hypot(s.x, s.z) > DEEP_R) { nd = Math.min(nd, s.depth); if (nd > 1.5) s.vy = Math.max(s.vy, 0.8); }
    if (nd > s.depth && !this.clear(s.x, s.z, s.yaw, nd + 0.3, sea)) { nd = s.depth; s.vy = 0; }
    s.depth = nd;
    const nx = s.x - Math.sin(s.yaw) * s.v * dt, nz = s.z - Math.cos(s.yaw) * s.v * dt;
    const ok = this.clear(nx, nz, s.yaw, s.depth, sea) && Math.hypot(nx, nz) < WRECK_R + 60 && !(s.depth > 1.5 && Math.hypot(nx, nz) > DEEP_R && Math.hypot(nx, nz) > Math.hypot(s.x, s.z)) && !this.list.some((o) => o !== s && Math.hypot(o.x - nx, o.z - nz) < 7);
    if (ok) { s.x = nx; s.z = nz; }
    else {
      const edge = s.depth > 1.5 && Math.hypot(nx, nz) > DEEP_R;
      if (Math.abs(s.v) > 1.2 || edge) { if (!edge) { this.sfx?.bonk(); this.shake?.(0.25); } this.sayOnce(edge ? 'Past here the sea has no floor: surface to go on.' : s.depth > 1 ? 'Bump! The bottom is too close: rise (Space) or back off (S).' : 'Too shallow here. Back off with S.'); }
      s.v *= -0.25;
    }
    s.tx = s.x; s.tz = s.z; s.tyaw = s.yaw; s.tv = s.v; s.tdepth = s.depth;
  }
  /** at the surface it rides the swell; below, it hangs still in the water, nosing up or down as it rises or dives */
  private float(s: Sub, dt: number, time: number) {
    const sn = Math.sin(s.yaw), c = Math.cos(s.yaw);
    const at = (lx: number, lz: number) => this.surface(s.x + lx * c + lz * sn, s.z - lx * sn + lz * c);
    const wave = Math.max(0, 1 - s.depth / 3);
    const fwd = at(0, -SAZ), aft = at(0, SAZ), port = at(-SAX, 0), stbd = at(SAX, 0);
    const sea = (fwd + aft + port + stbd) / 4;
    const y = sea - FLOAT - s.depth + 0.02 * Math.sin(time * 1.1 + s.x) * wave;
    const k = 1 - Math.exp(-dt * 3);
    s.y += (y - s.y) * k;
    const pitch = (Math.atan2(fwd - aft, SAZ * 2) * 0.6) * wave + s.vy * 0.08;
    const roll = Math.atan2(port - stbd, SAX * 2) * 0.5 * wave + s.yawV * Math.abs(s.v) * 0.015;
    s.pitch += (pitch - s.pitch) * k; s.roll += (roll - s.roll) * k;
    this.place(s);
  }
  private sayT = 0;
  private sayOnce(t: string) { const n = performance.now(); if (n < this.sayT) return; this.sayT = n + 3000; this.say?.(t); }

  // -------------------------------------------------------------- the floodlights
  setLights(s: Sub, on: boolean, remote = false) {
    if (s.lights === on) return;
    s.lights = on;
    for (const o of s.lit) o.visible = on;
    for (const o of s.unlit) o.visible = !on;
    if (!remote) this.onEvent?.({ op: 'lights', n: s.nid, on: on ? 1 : 0 });
  }
  /** the light switch in my sub, if I'm looking at it (or pointing at it) within arm's reach: how far */
  switchHit(eye: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }): number | null {
    const s = this.mine; if (!s) return null;
    const b = toWorld(s, BUTTON[0], BUTTON[1] + 0.03, BUTTON[2], L2), vx = b.x - eye.x, vy = b.y - eye.y, vz = b.z - eye.z, t = vx * dir.x + vy * dir.y + vz * dir.z;
    if (t < 0.1 || t > 1.8) return null;
    return Math.hypot(vx - dir.x * t, vy - dir.y * t, vz - dir.z * t) < 0.09 ? t : null;
  }
  /** a hand (VR) pressing the switch? */
  switchTouch(p: { x: number; y: number; z: number }): boolean {
    const s = this.mine; if (!s) return false;
    const b = toWorld(s, BUTTON[0], BUTTON[1] + 0.03, BUTTON[2], L2);
    return Math.hypot(p.x - b.x, p.y - b.y, p.z - b.z) < 0.08;
  }
  /** where a sub's floodlights are and which way they shine (world): the bow pair as one, and the stern */
  lightPose(s: Sub, back: boolean, pos: PV, dir: PV) {
    if (back) { toWorld(s, 0, 0.35, SAZ, pos); const a = toWorld(s, 0, 0.35 - 0.18, SAZ + 1, new THREE.Vector3()); dir.set(a.x - (pos.x as number), a.y - (pos.y as number), a.z - (pos.z as number)); }
    else { toWorld(s, 0, -0.85, -SAZ + 0.4, pos); const a = toWorld(s, 0, -0.85 - 0.22, -SAZ - 0.6, new THREE.Vector3()); dir.set(a.x - (pos.x as number), a.y - (pos.y as number), a.z - (pos.z as number)); }
  }
  /** the point in the sub (world) for things near it (a chest to loot) */
  centre(s: Sub, out: PV) { return toWorld(s, 0, -0.6, 0, out); }

  private place(s: Sub) {
    s.group.position.set(s.x, s.y, s.z);
    s.group.rotation.set(s.pitch, s.yaw, s.roll, 'YXZ');
  }
  private animate(s: Sub, dt: number, time: number) {
    if (s.prop) s.prop.rotation.z += s.v * dt * 4;
    if (s.yoke) s.yoke.rotation.z += (-s.yawV * 1.2 - s.yoke.rotation.z) * Math.min(1, dt * 5);
    // the hatch stands open at the surface while it is still; it shuts to sail or dive
    const open = this.surfaced(s) && Math.abs(s.v) < 0.6 ? 1.45 : 0;
    s.lidAng += (open - s.lidAng) * Math.min(1, dt * 2.5);
    if (s.lid) s.lid.rotation.x = s.lidAng;
    if (s.screen) (s.screen.material as THREE.MeshBasicMaterial).color.setHSL(0.45, 0.85, 0.55 + 0.05 * Math.sin(time * 3));
  }

  // -------------------------------------------------------------- after the giant wave
  /** washed back off the beach (everybody out), floating in water deep enough for it */
  respawn(s: Sub, remote = false) {
    const a0 = Math.round(Math.atan2(s.z, s.x) * 8) / 8;
    let at: [number, number, number] | null = null;
    for (const da of [0, 0.2, -0.2, 0.4, -0.4, 0.7, -0.7, 1.0, -1.0, 1.4, -1.4, 1.9, -1.9, 2.5, -2.5, 3.1]) {
      const a = a0 + da, ux = Math.cos(a), uz = Math.sin(a), yaw = Math.atan2(-ux, -uz);
      for (let r = 40; r < 320; r += 4) {
        if (!this.clear(ux * r, uz * r, yaw, 0.6)) continue;
        const R = r + 14, x = ux * R, z = uz * R;
        if (R < STORM_R0 - 40 && this.clear(x, z, yaw, 1.5) && !this.list.some((o) => o !== s && Math.hypot(o.x - x, o.z - z) < 9)) at = [x, z, yaw];
        break;
      }
      if (at) break;
    }
    if (!at) { const R = 260; at = [Math.cos(a0) * R, Math.sin(a0) * R, Math.atan2(-Math.cos(a0), -Math.sin(a0))]; }
    this.warp(s, at[0], at[1], at[2]);
    if (!remote) this.onEvent?.({ op: 'warp', n: s.nid, x: +at[0].toFixed(2), z: +at[1].toFixed(2), r: +at[2].toFixed(3) });
  }
  private warp(s: Sub, x: number, z: number, yaw: number) {
    s.x = s.tx = x; s.z = s.tz = z; s.yaw = s.tyaw = yaw; s.v = s.tv = 0; s.yawV = 0; s.vy = 0; s.depth = s.tdepth = 0; s.pitch = s.roll = 0;
    s.seats = [null, null, null, null];
    if (this.mine === s) { this.mine = null; this.seat = -1; }
    s.y = this.surface(x, z) - FLOAT;
    this.place(s);
  }

  // -------------------------------------------------------------- network
  net(e: Record<string, any>, from: number) {
    const s = typeof e.n === 'string' ? this.byId(e.n) : null;
    switch (e.op) {
      case 'add': if (!s && Number.isFinite(+e.x) && Number.isFinite(+e.z)) this.add(e.n, +e.x, +e.z, +e.r || 0, true); break;
      case 'del': if (s) this.remove(s, true); break;
      case 'seat': {
        // (they left any other seat)
        for (const o of this.list) for (let i = 0; i < 4; i++) if (o.seats[i] === from) o.seats[i] = null;
        const i = +e.s;
        if (!s || !(i >= 0 && i < 4)) break;
        // both of us sat in the same seat at once: the lower id keeps it, the other moves along (or the controls go back)
        if (s === this.mine && this.seat === i) {
          if (this.myId < from) { this.onEvent?.({ op: 'seat', n: s.nid, s: i }); break; }
          const free = s.seats.findIndex((p, k) => k !== i && (p === null || !this.present(p)));
          if (free >= 0) { s.seats[i] = from; this.sit(s, free); } else { this.say?.('That seat was taken'); }
          break;
        }
        s.seats[i] = from;
        break;
      }
      case 'mv': if (s && !(s === this.mine && this.seat === 0)) { s.tx = +e.x; s.tz = +e.z; s.tyaw = +e.r; s.tv = +e.v || 0; s.tdepth = Math.max(0, +e.d || 0); } break;
      case 'lights': if (s) this.setLights(s, !!e.on, true); break;
      case 'warp': if (s && Number.isFinite(+e.x) && Number.isFinite(+e.z)) this.warp(s, +e.x, +e.z, +e.r || 0); break;
    }
  }

  // -------------------------------------------------------------- save
  capture(): SubRow[] { return this.list.map((s) => ({ n: s.nid, x: +s.x.toFixed(2), z: +s.z.toFixed(2), r: +s.yaw.toFixed(3) })); }
  /** who sits where, for someone joining (seat rows: [sub, seat, player]) */
  seatRows() { const out: [string, number, number][] = []; for (const s of this.list) s.seats.forEach((p, i) => { if (p !== null) out.push([s.nid, i, p]); }); return out; }
  restore(rows: SubRow[] | undefined, seats?: [string, number, number][]) {
    for (const s of [...this.list]) this.remove(s, true);
    if (Array.isArray(rows)) for (const r of rows) if (r && typeof r.n === 'string') this.add(r.n, +r.x, +r.z, +r.r || 0, true);
    if (Array.isArray(seats)) for (const [n, i, p] of seats) { const s = this.byId(n); if (s && i >= 0 && i < 4 && p !== this.myId) s.seats[i] = p; }
  }
}
