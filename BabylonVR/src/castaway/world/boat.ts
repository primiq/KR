// Boats: a wooden sailing boat you build at the workbench and set down on open water. It is big enough to walk about on:
// a planked deck with rails round it, a little white cabin (a table and a torch on the wall inside), a mast with a mainsail
// and a jib, a wheel in the cockpit at the back and a ladder down the stern. Walk up to the wheel and press E to steer
// (W / S trim the sails, A / D turn; in VR the left stick and the triggers); everyone else walks about, fishes over the rail
// or jumps in. Swim up to the boat and press E to climb back aboard.
// Far out past the reef the sea turns on you: an extreme storm builds (`storm`, 0..1, fed to the weather), and if you keep
// going a giant wave rolls in and smashes the boat (`onWreck`): everybody aboard blacks out and wakes up on the beach.
// Multiplayer: whoever holds the wheel moves the boat and tells the others (event 'bo' / op 'mv'); people aboard say where
// on the deck they are ('on'), so everybody sees them riding along; boats are part of the world save and the join snapshot.
// Babylon port: Castaway's code, drawn by render/mirror.ts. The deck planks ('woodSlab') and the cabin windows ('glass') get
// the Babylon building materials; the depth-only 'boatLid' keeps the sea out of the hull.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { heightAt, SEA_R } from './island';
import { keepInSea, northStorm } from './arctic';
import { CELL, type MatKey, type PieceKind, pieceGeometry, RAIL_H, STAIR_DIRS, WALL_H } from '../game/building';

let WOOD: { slab: THREE.Material } | null = null;
const woodMaterials = () => (WOOD ??= { slab: new THREE.MeshStandardMaterial({ name: 'woodSlab' }) });
const glassMaterial = () => new THREE.MeshStandardMaterial({ name: 'glass', color: '#cfe8f0', transparent: true, opacity: 0.3 });
/** a position (Babylon's Vector3 here) */
interface PV { x: number; y: number; z: number; set(x: number, y: number, z: number): unknown }

/** distance from the middle of the island where the storm starts, where it is at full force, and where the wave comes regardless */
export const STORM_R0 = 360, STORM_R1 = 430, WRECK_R = 560;
/** how long you can stay out in the full storm before the big wave finds you (s) */
const STORM_HOLD = 70;
/** with a compass aboard: past here the storm starts to ease, and past here it is gone (open sea, calm) */
export const PASS_R0 = 500, PASS_R1 = 640;
/** how far out the big wave rises (m): you watch it come, growing, for half a minute or so */
const WAVE_FROM = 420;
/** the giant wave's profile across it: d along the way it travels (the face is at +d), y up (m) */
export const WAVE_PROFILE: [number, number][] = [[-70, 0], [-42, 4.5], [-22, 10.5], [-9, 15.5], [0, 17.5], [6.5, 16.6], [10.5, 14], [11, 11], [8.5, 9.2], [5.5, 8.4], [3.4, 6.2], [4, 3], [8, 1.1], [16, -0.6]];
// boat space: origin on the waterline in the middle, +z is the stern (the bow points at -z, like a player's yaw), +x starboard
const LEN = 11, HB = 2.0;              // length, half the beam
/** the deck, above the waterline */
const DECK = 0.95;
/** the cabin: from z0 to z1, half as wide as cw; its floor is sunk below the deck (a step down through the doorway) so the
 *  roof stays low enough for the helmsman to see over; `h` is how far the walls stand above the deck */
const CAB = { z0: 0.0, z1: 3.4, cw: 1.2, h: 1.55, door: 0.45, sink: 0.6, step: 0.55 };
/** the mast, the wheel, where the helmsman stands, and the raised step they stand on */
const MAST_Z = -1.6, WHEEL_Z = 4.45, HELM_Z = 5.1, HELM_UP = 0.35;
/** the walking surface at a spot on the boat (boat space): the deck, the sunken cabin floor, the step at its door, the helm step */
function floorAt(lx: number, lz: number): number {
  if (Math.abs(lx) < CAB.cw && lz > CAB.z0 && lz < CAB.z1) return lz < CAB.z0 + CAB.step && Math.abs(lx) < CAB.door ? DECK - CAB.sink / 2 : DECK - CAB.sink;
  if (Math.abs(lx) < 0.65 && lz > HELM_Z - 0.4 && lz < HELM_Z + 0.38) return DECK + HELM_UP;
  return DECK;
}
/** the gap in the stern rail with the ladder down to the water */
const GAP = 0.45;
const MAX = 3;

export interface BoatRow { n: string; x: number; z: number; r: number; p?: RaftPiece[] }

export class Boat {
  group = new THREE.Group();
  /** who holds the wheel (player id) */
  helm: number | null = null;
  v = 0; yawV = 0; y = 0; pitch = 0; roll = 0;
  /** remote: where the helmsman says it is */
  tx: number; tz: number; tyaw: number; tv = 0;
  /** a giant wave is coming for it */
  doomed = false;
  /** the wave lifting it (m) */
  lift = 0;
  /** the moving parts */
  boom: THREE.Group | null = null; main: THREE.Mesh | null = null; jib: THREE.Mesh | null = null; wheel: THREE.Group | null = null; flames: THREE.Mesh[] = [];
  /** the cabin torch, as the structures' light pool sees it */
  torch = { kind: 'cabin', x: 0, y: 0, z: 0, phase: Math.random() * 9, lit: true };
  /** a raft (built on with the building plan), not the sailing boat */
  raft: Raft | null = null;
  constructor(public nid: string, public x: number, public z: number, public yaw: number) { this.tx = x; this.tz = z; this.tyaw = yaw; }
}

// ------------------------------------------------------------------ the hull
const hw = (u: number) => HB * (u < 0.38 ? Math.pow(Math.sin((u / 0.38) * Math.PI / 2), 0.65) : 1 - 0.13 * Math.max(0, (u - 0.7) / 0.3));
const keel = (u: number) => -1.05 + (u < 0.22 ? ((0.22 - u) / 0.22) ** 1.5 * 1.6 : 0);
const sheer = (u: number) => DECK + 0.25 + (u < 0.3 ? ((0.3 - u) / 0.3) ** 2 * 0.55 : 0);
const uOf = (lz: number) => (lz + LEN / 2) / LEN;
/** half the width of the deck you can stand on at lz (inside the rails), or -1 off the ends */
function deckHalf(lz: number) { const u = uOf(lz); return u < 0.02 || u > 1 ? -1 : Math.max(0, hw(u) - 0.1); }
function hullPt(u: number, s: number, out: number[]) {
  const th = s * Math.PI / 2, w = hw(u), k = keel(u), sh = sheer(u);
  out.push(Math.sin(th) * w, k + (sh - k) * Math.pow(1 - Math.cos(th), 1.1), -LEN / 2 + u * LEN);
}
const N = 40;
function hullGeo(): THREE.BufferGeometry {
  const K = 16, pos: number[] = [], col: number[] = [], idx: number[] = [], c = new THREE.Color();
  for (let i = 0; i <= N; i++) for (let j = 0; j <= K; j++) {
    hullPt(i / N, j / K * 2 - 1, pos);
    const y = pos[pos.length - 2];
    c.set(y < 0.08 ? '#9c3324' : y > 0.62 && y < 0.76 ? '#1f3d66' : '#f2efe6');
    col.push(c.r, c.g, c.b);
  }
  for (let i = 0; i < N; i++) for (let j = 0; j < K; j++) { const a = i * (K + 1) + j, b = a + K + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  // the transom: a fan across the stern
  const base = pos.length / 3, a: number[] = [];
  pos.push(0, (keel(1) + sheer(1)) / 2, LEN / 2); c.set('#f2efe6'); col.push(c.r, c.g, c.b);
  for (let j = 0; j <= K; j++) { a.length = 0; hullPt(1, j / K * 2 - 1, a); pos.push(a[0], a[1], a[2]); c.set(a[1] < 0.08 ? '#9c3324' : '#f2efe6'); col.push(c.r, c.g, c.b); }
  for (let j = 0; j < K; j++) idx.push(base, base + j + 1, base + j + 2);
  // ... closed at the top (the fan's centre is halfway up: without this a V between the two top corners was left open)
  idx.push(base, base + K + 1, base + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
/** a strip between the two sides at each section: f(u, side) gives the point */
/** (`up`: the strip lies flat and faces the sky) */
function strip(f: (u: number, side: number) => [number, number, number], n = N, up = false): THREE.BufferGeometry {
  const pos: number[] = [], idx: number[] = [];
  for (let i = 0; i <= n; i++) for (const sd of [-1, 1]) pos.push(...f(i / n, sd));
  for (let i = 0; i < n; i++) { const k = i * 2; if (up) idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); else idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
/** the inside face of the bulwark on one side, from the deck up to the sheer */
function bulwark(side: number): THREE.BufferGeometry {
  return strip((u, t) => [side * (hw(u) - 0.07), t < 0 ? DECK : sheer(u), -LEN / 2 + u * LEN]);
}
/** a sail: a triangle (tack, head, clew), cut into a grid so it can belly out (along x, by the mesh's scale.x) */
function sailGeo(tack: THREE.Vector3, head: THREE.Vector3, clew: THREE.Vector3): THREE.BufferGeometry {
  const NH = 10, NC = 6, pos: number[] = [], idx: number[] = [], L = new THREE.Vector3(), R = new THREE.Vector3(), P = new THREE.Vector3();
  for (let i = 0; i <= NH; i++) {
    const h = i / NH;
    L.lerpVectors(tack, head, h); R.lerpVectors(clew, head, h);
    for (let j = 0; j <= NC; j++) { P.lerpVectors(L, R, j / NC); pos.push(Math.sin(Math.PI * j / NC) * (1 - 0.7 * h), P.y, P.z); }
  }
  for (let i = 0; i < NH; i++) for (let j = 0; j < NC; j++) { const a = i * (NC + 1) + j, b = a + NC + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

type Mats = Record<'paint' | 'white' | 'teak' | 'dark' | 'metal' | 'sail' | 'glass' | 'rope' | 'flame' | 'flameIn', THREE.Material>;
let MATS: Mats | null = null;
let LID_MAT: THREE.Material | null = null;
function mats(): Mats {
  if (MATS) return MATS;
  // lit like everything else that is built on the island: a little fill light by day that dies away at night (selfLit)
  const std = (c: string | null, r: number, m = 0, extra: Partial<THREE.MeshStandardMaterialParameters> = {}, fill = 0.14) => {
    const mt = new THREE.MeshStandardMaterial({ ...(c ? { color: c } : {}), roughness: r, metalness: m, side: THREE.DoubleSide, ...extra });
    if (c) mt.emissive = new THREE.Color(c).multiplyScalar(fill * 0.5);
    return mt;
  };
  const flame = (c: string) => { const m = new THREE.MeshBasicMaterial({ color: c, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }); m.fog = false; return m; };
  MATS = {
    paint: std(null, 0.5, 0, { vertexColors: true }), white: std('#efe9dc', 0.7), teak: std('#8a5a32', 0.8), dark: std('#5a3d24', 0.9),
    metal: std('#b8c0c6', 0.35, 0.6), sail: std('#f4f1e8', 0.85, 0, {}, 0.1), glass: glassMaterial(), rope: std('#2b2a28', 0.9),
    flame: flame('#ff8a2a'), flameIn: flame('#ffe49a'),
  };
  LID_MAT = new THREE.MeshBasicMaterial({ name: 'boatLid', colorWrite: false, depthWrite: true, side: THREE.DoubleSide });
  return MATS;
}

/** the whole boat; `ghost`: one see-through material for the placing preview */
function makeModel(ghost: THREE.Material | null, shadows: boolean, b: Boat | null): THREE.Group {
  const M = mats(), W = woodMaterials(), g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, to: THREE.Object3D = g) => {
    const o = new THREE.Mesh(geo, ghost ?? m); o.position.set(x, y, z); o.castShadow = shadows && !ghost; o.receiveShadow = shadows && !ghost; to.add(o); return o;
  };
  const boxAt = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, to: THREE.Object3D = g) => add(new THREE.BoxGeometry(w, h, d), m, x, y, z, to);
  const rod = (a: THREE.Vector3, c: THREE.Vector3, r: number, m: THREE.Material, to: THREE.Object3D = g) => {
    const len = a.distanceTo(c), o = add(new THREE.CylinderGeometry(r, r, len, 6), m, (a.x + c.x) / 2, (a.y + c.y) / 2, (a.z + c.z) / 2, to);
    o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), c.clone().sub(a).normalize()); o.castShadow = false;
    return o;
  };
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

  // ---- hull, deck and bulwarks
  add(hullGeo(), M.paint);
  // the planked deck, with a hole where the cabin is sunk into it
  {
    const ua = uOf(CAB.z0), ub = uOf(CAB.z1);
    const part = (u0: number, u1: number, x: (u: number, t: number) => number) => add(strip((u, t) => { const uu = u0 + (u1 - u0) * u; return [x(uu, t), DECK, -LEN / 2 + uu * LEN]; }, 16, true), W.slab);
    part(0, ua, (u, t) => t * Math.max(0, hw(u) - 0.06)); part(ub, 1, (u, t) => t * Math.max(0, hw(u) - 0.06));
    part(ua, ub, (u, t) => (t < 0 ? -(hw(u) - 0.06) : -CAB.cw)); part(ua, ub, (u, t) => (t < 0 ? CAB.cw : hw(u) - 0.06));
  }
  add(bulwark(-1), M.white); add(bulwark(1), M.white);
  add(strip((u, t) => [(hw(u) - (t < 0 ? 0.08 : -0.01)), sheer(u) + 0.02, -LEN / 2 + u * LEN]), M.teak);   // cap rails
  add(strip((u, t) => [-(hw(u) - (t < 0 ? 0.08 : -0.01)), sheer(u) + 0.02, -LEN / 2 + u * LEN]), M.teak);
  if (!ghost) {
    // keep the sea off the deck when the waves run high (see the note on the lid in the old dinghy: depth only, drawn before the sea)
    const lid = new THREE.Mesh(strip((u, t) => [t * (hw(u) - 0.04), DECK + 0.2, -LEN / 2 + u * LEN]), LID_MAT!); lid.renderOrder = 1; g.add(lid);
  }
  // ---- rails: stanchions and a top rail down both sides and round the bow, a stern rail with a gap for the ladder
  const RAIL = DECK + 1.0;
  for (const sd of [-1, 1]) {
    let prev: THREE.Vector3 | null = null;
    for (let z = -LEN / 2 + 0.5; z <= LEN / 2 - 0.05; z += 1.25) {
      const u = uOf(z), x = sd * (hw(u) - 0.05), top = V(x, Math.max(RAIL, sheer(u) + 0.35), z);
      rod(V(x, sheer(u), z), top, 0.022, M.metal);
      if (prev) rod(prev, top, 0.02, M.metal);
      prev = top;
    }
    const st = V(sd * (hw(1) - 0.05), RAIL, LEN / 2 - 0.05);
    if (prev) rod(prev, st, 0.02, M.metal);
    rod(V(sd * (hw(1) - 0.05), sheer(1), LEN / 2 - 0.05), st, 0.022, M.metal);
    rod(st, V(sd * GAP, RAIL, LEN / 2 - 0.05), 0.02, M.metal);
    rod(V(sd * GAP, sheer(1), LEN / 2 - 0.05), V(sd * GAP, RAIL, LEN / 2 - 0.05), 0.022, M.metal);
  }
  // the bow pulpit joins the two sides
  { const z = -LEN / 2 + 0.5, x = hw(uOf(z)) - 0.05, y = Math.max(RAIL, sheer(uOf(z)) + 0.35); rod(V(-x, y, z), V(x, y, z), 0.02, M.metal); }
  // ---- the ladder down the stern
  for (const sd of [-1, 1]) rod(V(sd * 0.28, DECK + 0.9, LEN / 2 + 0.02), V(sd * 0.28, -1.0, LEN / 2 + 0.16), 0.025, M.metal);
  for (let k = 0; k < 6; k++) { const t = k / 5, y = DECK + 0.6 - t * 1.5, z = LEN / 2 + 0.04 + t * 0.12; rod(V(-0.28, y, z), V(0.28, y, z), 0.02, M.metal); }

  // ---- the cabin: white walls, a teak roof, dark windows, a doorway facing the bow
  const { z0, z1, cw, h } = CAB, mid = (z0 + z1) / 2, T = 0.08, F = DECK - CAB.sink, WH = h + CAB.sink, Y = F + WH / 2;
  // walls with real window openings: a strip below, a strip above, and pieces between the windows; glass in each opening
  const wy0 = DECK + 0.62, wy1 = DECK + 1.08;
  const windowWall = (side: boolean, c: number, a0: number, a1: number, holes: [number, number][]) => {
    const piece = (b0: number, b1: number, y0: number, y1: number) => {
      if (b1 - b0 < 0.005 || y1 - y0 < 0.005) return;
      if (side) boxAt(T, y1 - y0, b1 - b0, c, (y0 + y1) / 2, (b0 + b1) / 2, M.white); else boxAt(b1 - b0, y1 - y0, T, (b0 + b1) / 2, (y0 + y1) / 2, c, M.white);
    };
    piece(a0, a1, F, wy0); piece(a0, a1, wy1, DECK + h);
    let at = a0;
    for (const [h0, h1] of holes) {
      piece(at, h0, wy0, wy1); at = h1;
      const gl = new THREE.Mesh(new THREE.PlaneGeometry(h1 - h0, wy1 - wy0), ghost ?? M.glass);
      gl.position.set(side ? c : (h0 + h1) / 2, (wy0 + wy1) / 2, side ? (h0 + h1) / 2 : c); if (side) gl.rotation.y = Math.PI / 2;
      gl.renderOrder = 3; g.add(gl);
      // a teak frame round the opening
      const fr = (w: number, hh: number, a: number, y: number) => (side ? boxAt(T + 0.03, hh, w, c, y, a, M.teak) : boxAt(w, hh, T + 0.03, a, y, c, M.teak));
      fr(h1 - h0 + 0.08, 0.04, (h0 + h1) / 2, wy0 - 0.02); fr(h1 - h0 + 0.08, 0.04, (h0 + h1) / 2, wy1 + 0.02);
      fr(0.04, wy1 - wy0, h0 - 0.02, (wy0 + wy1) / 2); fr(0.04, wy1 - wy0, h1 + 0.02, (wy0 + wy1) / 2);
    }
    piece(at, a1, wy0, wy1);
  };
  const sideHoles: [number, number][] = [[z0 + 0.52, z0 + 1.28], [z1 - 1.28, z1 - 0.52]];
  windowWall(true, -cw, z0, z1, sideHoles); windowWall(true, cw, z0, z1, sideHoles);
  windowWall(false, z1, -cw - T / 2, cw + T / 2, [[-0.45, 0.45]]);
  boxAt(cw - CAB.door, WH, T, -(cw + CAB.door) / 2, Y, z0, M.white); boxAt(cw - CAB.door, WH, T, (cw + CAB.door) / 2, Y, z0, M.white);
  const doorTop = F + 1.95;
  boxAt(2 * CAB.door, DECK + h - doorTop, T, 0, (doorTop + DECK + h) / 2, z0, M.white);
  boxAt(2 * cw + 0.3, 0.1, z1 - z0 + 0.3, 0, DECK + h + 0.05, mid, M.teak);
  boxAt(2 * cw - 0.02, 0.06, z1 - z0 - 0.02, 0, F - 0.03, mid, W.slab);                                 // the cabin sole
  boxAt(2 * CAB.door - 0.02, CAB.sink / 2, CAB.step, 0, F + CAB.sink / 4, z0 + CAB.step / 2, M.teak);    // the step down
  for (const sd of [-1, 1]) boxAt(0.05, 0.05, z1 - z0, sd * (cw - 0.25), DECK + h + 0.13, mid, M.metal);        // grab rails on the roof
  // inside: a table on a pedestal with a bench behind it, and a torch in a bracket on the port wall
  boxAt(1.1, 0.05, 0.62, 0, F + 0.75, z1 - 0.85, M.teak);
  add(new THREE.CylinderGeometry(0.05, 0.08, 0.72, 8), M.dark, 0, F + 0.37, z1 - 0.85);
  boxAt(1.9, 0.08, 0.42, 0, F + 0.45, z1 - 0.27, M.teak); boxAt(1.9, 0.4, 0.06, 0, F + 0.22, z1 - 0.07 - 0.2, M.dark);
  {
    const tx = -cw + T / 2 + 0.02, ty = F + 1.45, tz = z0 + 1.6;
    boxAt(0.04, 0.16, 0.08, tx, ty, tz, M.metal);
    const stick = add(new THREE.CylinderGeometry(0.03, 0.025, 0.4, 6), M.dark, tx + 0.12, ty + 0.12, tz); stick.rotation.z = -0.5;
    if (!ghost && b) {
      const fx = tx + 0.12 + Math.sin(0.5) * 0.2, fy = ty + 0.12 + Math.cos(0.5) * 0.2;   // the tip of the stick
      for (const [m, s] of [[M.flame, 1], [M.flameIn, 0.6]] as [THREE.Material, number][]) {
        const f = new THREE.Mesh(new THREE.ConeGeometry(0.07 * s, 0.24 * s, 7).translate(0, 0.12 * s, 0), m);
        f.position.set(fx, fy - 0.03, tz); f.renderOrder = 5; g.add(f); b.flames.push(f);
      }
      g.userData.torch = new THREE.Vector3(fx + 0.45, fy - 0.35, tz);              // (the light a little into the room, low: it stays in the cabin)
    }
  }
  // ---- the mast, its stays and shrouds, the boom swinging over the cabin roof, the mainsail and the jib
  const top = DECK + 9.6;
  add(new THREE.CylinderGeometry(0.06, 0.09, top - DECK, 10).translate(0, (top - DECK) / 2, 0), M.teak, 0, DECK, MAST_Z);
  rod(V(0, top - 0.3, MAST_Z), V(0, sheer(0.02) + 0.05, -LEN / 2 + 0.25), 0.012, M.rope);             // forestay
  rod(V(0, top - 0.1, MAST_Z), V(0, sheer(1) + 0.05, LEN / 2 - 0.1), 0.012, M.rope);                   // backstay
  for (const sd of [-1, 1]) { const u = uOf(MAST_Z); rod(V(0, top - 1.4, MAST_Z), V(sd * (hw(u) - 0.08), sheer(u), MAST_Z + 0.2), 0.01, M.rope); }
  const boom = new THREE.Group(); boom.position.set(0, 0, MAST_Z); g.add(boom);
  add(new THREE.CylinderGeometry(0.06, 0.05, 3.8, 8).rotateX(Math.PI / 2), M.teak, 0, DECK + 2.15, 1.9, boom);
  const main = add(sailGeo(V(0, DECK + 2.25, 0.1), V(0, top - 0.35, 0.08), V(0, DECK + 2.25, 3.7)), M.sail, 0, 0, 0, boom);
  main.castShadow = false;
  const jib = add(sailGeo(V(0, sheer(0.04) + 0.3, -LEN / 2 + 0.55), V(0, top - 1.0, MAST_Z - 0.05), V(0, DECK + 1.55, MAST_Z - 0.35)), M.sail);
  jib.castShadow = false;
  // ---- the wheel on its pedestal in the cockpit
  boxAt(0.24, 1.25, 0.24, 0, DECK + 0.625, WHEEL_Z, M.teak);
  boxAt(1.3, HELM_UP, 0.78, 0, DECK + HELM_UP / 2, HELM_Z, M.teak);                                          // the helm step
  const wheel = new THREE.Group(); wheel.position.set(0, DECK + 1.4, WHEEL_Z + 0.16); g.add(wheel);
  add(new THREE.TorusGeometry(0.4, 0.03, 6, 24), M.teak, 0, 0, 0, wheel);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    rod(V(0, 0, 0), V(Math.cos(a) * 0.4, Math.sin(a) * 0.4, 0), 0.018, M.teak, wheel);
    const hd = add(new THREE.CylinderGeometry(0.022, 0.026, 0.14, 6), M.teak, Math.cos(a) * 0.48, Math.sin(a) * 0.48, 0, wheel); hd.rotation.z = a - Math.PI / 2;
  }
  add(new THREE.CylinderGeometry(0.07, 0.07, 0.1, 10).rotateX(Math.PI / 2), M.metal, 0, 0, 0, wheel);
  // a cleat or two and a coil of rope on the foredeck
  boxAt(0.25, 0.05, 0.08, 0, DECK + 0.04, -LEN / 2 + 1.1, M.metal);
  add(new THREE.TorusGeometry(0.2, 0.04, 6, 14).rotateX(Math.PI / 2), M.rope, 0.6, DECK + 0.04, -2.8);
  if (b) { b.boom = boom; b.main = main; b.jib = jib; b.wheel = wheel; }
  return g;
}

/** circles and boxes on deck you walk round (boat space): the cabin walls (with the doorway), the mast, the wheel, the table */
const DECK_BOXES: { x0: number; x1: number; z0: number; z1: number; h: number }[] = (() => {
  const { z0, z1, cw, door } = CAB, t = 0.06, H = CAB.h + CAB.sink;
  return [
    { x0: -cw - t, x1: -cw + t, z0, z1, h: H }, { x0: cw - t, x1: cw + t, z0, z1, h: H },
    { x0: -cw, x1: cw, z0: z1 - t, z1: z1 + t, h: H },
    { x0: -cw, x1: -door, z0: z0 - t, z1: z0 + t, h: H }, { x0: door, x1: cw, z0: z0 - t, z1: z0 + t, h: H },
    { x0: -0.55, x1: 0.55, z0: z1 - 1.16, z1: z1 - 0.54, h: 0.8 },                 // the table
    { x0: -0.95, x1: 0.95, z0: z1 - 0.48, z1: z1, h: 0.49 },                       // the bench (you can step up on it)
    { x0: -0.14, x1: 0.14, z0: WHEEL_Z - 0.14, z1: WHEEL_Z + 0.2, h: 1.6 },        // the wheel pedestal
    { x0: -0.12, x1: 0.12, z0: MAST_Z - 0.12, z1: MAST_Z + 0.12, h: 9 },           // the mast
  ];
})();

// ------------------------------------------------------------------ the giant wave
/** a wall of water, curling over at the top, that rolls in from the open sea */
class Wave {
  mesh: THREE.Mesh;
  active = false;
  x = 0; z = 0; dx = 0; dz = 0;       // where its foot is and where it is heading
  t = 0;
  /** how tall it has grown (0..1): it rises as it rolls in */
  grow = 0;
  private fadeT = 0;
  constructor(scene: THREE.Scene) {
    // (the three.js mesh is kept for its shape only: the Babylon side draws the wave itself, world/bigWave.ts)
    const P = WAVE_PROFILE;
    const W = 130, NW = 40, pos: number[] = [], col: number[] = [], idx: number[] = [];
    const deep = new THREE.Color('#0f3a3c'), face = new THREE.Color('#2a7a76'), foam = new THREE.Color('#e9f4f2'), c = new THREE.Color();
    for (let i = 0; i <= NW; i++) {
      const w = (i / NW) * 2 - 1, hk = 1 - Math.pow(Math.abs(w), 4), back = w * w * 34;
      P.forEach(([d, y], j) => {
        pos.push(w * W, y * hk, d - back);
        const f = j >= 4 && j <= 8 ? 1 - Math.abs(j - 6) / 3 : 0;
        c.copy(j < 4 ? deep : face).lerp(deep, j > 9 ? 0.4 : 0).lerp(foam, Math.max(0, Math.min(1, f)) * hk);
        col.push(c.r, c.g, c.b);
      });
    }
    const n = P.length;
    for (let i = 0; i < NW; i++) for (let j = 0; j < n - 1; j++) { const a = i * n + j, b = a + n; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.15, metalness: 0.05, transparent: true, opacity: 0.94, side: THREE.DoubleSide, forceSinglePass: true });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false; this.mesh.visible = false;
    scene.add(this.mesh);
  }
  /** roll in at (x, z) from the open sea */
  start(x: number, z: number) {
    const r = Math.hypot(x, z) || 1, ux = x / r, uz = z / r;
    this.dx = -ux; this.dz = -uz;
    this.x = x + ux * WAVE_FROM; this.z = z + uz * WAVE_FROM;
    this.t = 0; this.active = true; this.grow = 0.3; this.fadeT = 0;
  }
  /** how far in front of the wave's foot (x, z) is */
  ahead(x: number, z: number) { return (x - this.x) * this.dx + (z - this.z) * this.dz; }
  /**
   * `push`: how fast its target runs away from it (it never lets them outrun it); `keep`: it has not reached them yet (else
   * it rolls on a few seconds more and is gone); `d`: how far in front of it they are (it grows as it comes)
   */
  update(dt: number, push = 0, keep = false, d = 0) {
    if (!this.active) return;
    this.t += dt;
    // slow while it is a dark line far out, faster as it rears up
    const near = Math.max(0, Math.min(1, 1 - (d - 25) / (WAVE_FROM - 25)));
    this.grow = Math.max(this.grow, 0.3 + 0.7 * Math.pow(near, 1.4));
    const sp = 9 + 7 * near + Math.max(0, push);
    this.x += this.dx * sp * dt; this.z += this.dz * sp * dt;
    this.mesh.position.set(this.x, -0.6, this.z);
    this.mesh.rotation.y = Math.atan2(this.dx, this.dz);
    this.mesh.scale.set(1, this.grow, 1);
    if (keep && this.t < 150) this.fadeT = 0;
    else if ((this.fadeT += dt) > 6) { this.active = false; this.mesh.visible = false; }
  }
  /** how high the water under something `d` metres in front of the foot is lifted */
  liftAt(d: number) { return d > 26 || d < -4 ? 0 : 15 * this.grow * Math.pow(Math.max(0, Math.min(1, (26 - d) / 24)), 2.2); }
}

// ------------------------------------------------------------------ rafts
// A raft: a square of lashed logs the size of one building block, put on the sea like a boat. Build on it with the building
// plan, just like on land: more log sections next to it, walls, doorways, windows and railings round their edges, a floor
// (an upper deck or a roof) above, stairs up to it. Everything sits on the raft's own grid and sails with it. An oar at the
// back steers it. Raft space: origin on the waterline in the middle of the first section, +z the stern (the bow is -z).
/** a piece of a raft: a log section, an edge (wall, doorway, window, railing) on level L, an upper floor, a staircase */
export type RaftPiece = ['t', number, number] | ['e', 'x' | 'z', number, number, number, string] | ['f', number, number, number] | ['s', number, number, number, number]
  /** a door in a doorway: 0 shut, or open swung to +1 / -1 */
  | ['d', 'x' | 'z', number, number, number, number];
/** the deck of the logs, above the waterline */
const RDECK = 0.45;
const RC = CELL, RWH = WALL_H;
const RAFT_MAX = 4, RAFT_TILES = 36, RAFT_LEVELS = 2;
const EDGE_KINDS = ['wall', 'doorway', 'window', 'railing'];
export class Raft {
  tiles = new Set<string>();
  edges = new Map<string, string>();
  floors = new Set<string>();
  stairs = new Map<string, number>();
  /** doors hung in doorways (by the doorway's key): 0 shut, +1 / -1 open that way */
  doors = new Map<string, number>();
  /** the doors' hinges, as drawn, and how far each is swung now */
  doorPivots = new Map<string, { g: THREE.Group; ang: number }>();
  oar: THREE.Group | null = null;
  /** the section the oar is on (the back of the raft), its extent in raft space, how far it reaches from the origin */
  hi = 0; hj = 0;
  x0 = -RC / 2; x1 = RC / 2; z0 = -RC / 2; z1 = RC / 2; rad = 2.2;
  /** solid things to walk into (raft space) */
  boxes: { x0: number; x1: number; z0: number; z1: number; y0: number; y1: number }[] = [];
  constructor(plan?: RaftPiece[]) {
    if (plan) for (const p of plan) this.put(p);
    if (!this.tiles.size) this.tiles.add('0,0');
    this.refresh();
  }
  static key(p: RaftPiece) { return p[0] === 't' ? `${p[1]},${p[2]}` : p[0] === 'e' || p[0] === 'd' ? `${p[1]}${p[2]},${p[3]},${p[4]}` : `${p[1]},${p[2]},${p[3]}`; }
  has(p: RaftPiece) {
    const k = Raft.key(p);
    return p[0] === 't' ? this.tiles.has(k) : p[0] === 'e' ? this.edges.has(k) : p[0] === 'f' ? this.floors.has(k) : p[0] === 'd' ? this.doors.has(k) : this.stairs.has(k);
  }
  put(p: RaftPiece) {
    const k = Raft.key(p), n = (v: unknown) => Number.isInteger(v) && Math.abs(v as number) < 40;
    if (p[0] === 't' && n(p[1]) && n(p[2])) this.tiles.add(k);
    else if (p[0] === 'e' && (p[1] === 'x' || p[1] === 'z') && n(p[2]) && n(p[3]) && n(p[4]) && EDGE_KINDS.includes(p[5])) this.edges.set(k, p[5]);
    else if (p[0] === 'f' && n(p[1]) && n(p[2]) && n(p[3])) this.floors.add(k);
    else if (p[0] === 's' && n(p[1]) && n(p[2]) && n(p[3]) && n(p[4])) this.stairs.set(k, ((p[4] % 4) + 4) % 4);
    else if (p[0] === 'd' && this.edges.get(k) === 'doorway') this.doors.set(k, Math.sign(+p[5] || 0));
  }
  del(p: RaftPiece) {
    const k = Raft.key(p);
    if (p[0] === 't') this.tiles.delete(k); else if (p[0] === 'e') { this.edges.delete(k); this.doors.delete(k); } else if (p[0] === 'f') this.floors.delete(k); else if (p[0] === 'd') this.doors.delete(k); else this.stairs.delete(k);
  }
  list(): RaftPiece[] {
    const out: RaftPiece[] = [];
    const nums = (k: string) => k.split(',').map(Number);
    for (const k of this.tiles) { const [i, j] = nums(k); out.push(['t', i, j]); }
    for (const [k, kind] of this.edges) { const [i, j, L] = nums(k.slice(1)); out.push(['e', k[0] as 'x' | 'z', i, j, L, kind]); }
    for (const k of this.floors) { const [i, j, L] = nums(k); out.push(['f', i, j, L]); }
    for (const [k, d] of this.stairs) { const [i, j, L] = nums(k); out.push(['s', i, j, L, d]); }
    for (const [k, d] of this.doors) { const [i, j, L] = nums(k.slice(1)); out.push(['d', k[0] as 'x' | 'z', i, j, L, d]); }
    return out;
  }
  tile(i: number, j: number) { return this.tiles.has(`${i},${j}`); }
  floor(i: number, j: number, L: number) { return L === 0 ? this.tile(i, j) : this.floors.has(`${i},${j},${L}`); }
  /** extent, the oar's section, the solid boxes */
  refresh() {
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, hi = 0, hj = -1e9;
    for (const k of this.tiles) {
      const [i, j] = k.split(',').map(Number);
      x0 = Math.min(x0, i * RC - RC / 2); x1 = Math.max(x1, i * RC + RC / 2); z0 = Math.min(z0, j * RC - RC / 2); z1 = Math.max(z1, j * RC + RC / 2);
      if (j > hj || (j === hj && (Math.abs(i) < Math.abs(hi) || (Math.abs(i) === Math.abs(hi) && i < hi)))) { hi = i; hj = j; }
    }
    Object.assign(this, { x0, x1, z0, z1, hi, hj });
    this.rad = Math.max(Math.hypot(x0, z0), Math.hypot(x1, z0), Math.hypot(x0, z1), Math.hypot(x1, z1)) + 0.3;
    this.boxes = [];
    const T = 0.16;
    for (const [k, kind] of this.edges) {
      const [i, j, L] = k.slice(1).split(',').map(Number), y0 = RDECK + L * RWH, y1 = y0 + (kind === 'railing' ? RAIL_H : RWH);
      // along the edge from a to b (a span of it: a doorway leaves its middle open)
      const spans: [number, number][] = kind === 'doorway' ? [[-RC / 2, -0.6], [0.6, RC / 2]] : [[-RC / 2, RC / 2]];
      for (const [a, b] of spans) {
        if (k[0] === 'x') { const z = (j - 0.5) * RC, x = i * RC; this.boxes.push({ x0: x + a, x1: x + b, z0: z - T, z1: z + T, y0, y1 }); }
        else { const x = (i - 0.5) * RC, z = j * RC; this.boxes.push({ x0: x - T, x1: x + T, z0: z + a, z1: z + b, y0, y1 }); }
      }
    }
    // a shut door fills its doorway
    for (const [k, st] of this.doors) {
      if (st) continue;
      const [i, j, L] = k.slice(1).split(',').map(Number), y0 = RDECK + L * RWH, y1 = y0 + 2.3;
      if (k[0] === 'x') { const z = (j - 0.5) * RC, x = i * RC; this.boxes.push({ x0: x - 0.6, x1: x + 0.6, z0: z - 0.08, z1: z + 0.08, y0, y1 }); }
      else { const x = (i - 0.5) * RC, z = j * RC; this.boxes.push({ x0: x - 0.08, x1: x + 0.08, z0: z - 0.6, z1: z + 0.6, y0, y1 }); }
    }
    const [hx, , hz] = this.oarPost();
    this.boxes.push({ x0: hx - 0.12, x1: hx + 0.12, z0: hz - 0.12, z1: hz + 0.12, y0: RDECK, y1: RDECK + 1.1 });
  }
  /** the oar's post (raft space, its foot), and where whoever steers stands */
  oarPost(): [number, number, number] { return [this.hi * RC, RDECK, this.hj * RC + RC / 2 - 0.3]; }
  helmSpot(): [number, number, number] { return [this.hi * RC, RDECK, this.hj * RC + RC / 2 - 1.35]; }
  /** the walking surface at (lx, lz) for feet at ly (raft space): the logs, an upper floor, a stair; the highest one a step
   *  up at most; -1e9 off the raft */
  floorAt(lx: number, ly: number, lz: number): number {
    const i = Math.round(lx / RC), j = Math.round(lz / RC);
    if (!this.tile(i, j)) return -1e9;
    let best = RDECK;
    for (let L = 0; L <= RAFT_LEVELS; L++) {
      const base = RDECK + L * RWH;
      if (L > 0 && this.floors.has(`${i},${j},${L}`) && base <= ly + 0.9) best = Math.max(best, base);
      const d = this.stairs.get(`${i},${j},${L}`);
      if (d !== undefined) {
        const [dx, dz] = STAIR_DIRS[d], u = Math.max(0, Math.min(1, ((lx - i * RC) * dx + (lz - j * RC) * dz) / RC + 0.5)), h = base + u * RWH;
        if (h <= ly + 0.9) best = Math.max(best, h);
      }
    }
    return best;
  }
  /** the nearest point on the raft's sections to (lx, lz), kept `m` in from their edges */
  nearest(lx: number, lz: number, m: number): [number, number, number] {
    let bx = 0, bz = 0, bd = 1e9;
    for (const k of this.tiles) {
      const [i, j] = k.split(',').map(Number), cx = i * RC, cz = j * RC, h = RC / 2 - m;
      const x = Math.max(cx - h, Math.min(cx + h, lx)), z = Math.max(cz - h, Math.min(cz + h, lz)), d = Math.hypot(x - lx, z - lz);
      if (d < bd) { bd = d; bx = x; bz = z; }
    }
    return [bx, bz, bd];
  }
}

/** a door's leaf (the same as a house door's) */
const DOOR_W = 1.16, DOOR_H = 2.27;
let LEAF: THREE.BufferGeometry | null = null;
function doorLeaf() {
  if (LEAF) return LEAF;
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) parts.push(new THREE.BoxGeometry(DOOR_W / 6 - 0.006, DOOR_H, 0.06).translate(-DOOR_W / 2 + (i + 0.5) * (DOOR_W / 6), 0, 0));
  for (const y of [-0.75, 0.75]) for (const z of [-0.045, 0.045]) parts.push(new THREE.BoxGeometry(DOOR_W - 0.06, 0.12, 0.03).translate(0, y, z));
  return (LEAF = mergeGeometries(parts.map(clean))!);
}
let RMATS: Record<'log' | 'end' | 'rope' | 'wall' | 'beam' | 'pile', THREE.Material> | null = null;
function raftMats() {
  if (RMATS) return RMATS;
  const std = (c: string, r: number) => { const m = new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: 0 }); m.emissive = new THREE.Color(c).multiplyScalar(0.07); return m; };
  RMATS = { log: std('#8a6440', 0.95), end: std('#c9a06a', 0.9), rope: std('#a08a5c', 1), wall: new THREE.MeshStandardMaterial({ name: 'woodWall' }), beam: std('#7d5530', 0.9), pile: std('#5c4128', 1) };
  return RMATS;
}
const PIECE_GEO = new Map<string, Map<MatKey, THREE.BufferGeometry[]>>();
const pieceGeo = (k: PieceKind) => { let g = PIECE_GEO.get(k); if (!g) PIECE_GEO.set(k, (g = pieceGeometry(k))); return g; };
const clean = (g: THREE.BufferGeometry) => { const n = g.index ? g.toNonIndexed() : g.clone(); for (const a of Object.keys(n.attributes)) if (a !== 'position' && a !== 'normal') n.deleteAttribute(a); return n; };
/**
 * A raft's pieces are drawn from shared geometry: one set per kind (a log section, a wall, a doorway...), built once, and
 * every piece of that kind is the same geometry placed where it goes. Building on a raft then adds a few meshes made from
 * what is already on the GPU (it used to merge the whole raft anew, a stall each time, the new parts appearing one by one).
 */
const KIND_GEO = new Map<string, [THREE.Material, THREE.BufferGeometry][]>();
function kindGeo(kind: string): [THREE.Material, THREE.BufferGeometry][] {
  let out = KIND_GEO.get(kind);
  if (out) return out;
  const RM = raftMats(), W = woodMaterials(), by = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const put = (m: THREE.Material, g: THREE.BufferGeometry) => { let a = by.get(m); if (!a) by.set(m, (a = [])); a.push(clean(g)); };
  const matOf = (k: MatKey) => (k === 'wall' || k === 'swall' ? RM.wall : k === 'slab' || k === 'sslab' ? W.slab : k === 'beam' ? RM.beam : k === 'glass' ? mats().glass : RM.pile);
  if (kind === 'tile') {
    // five logs, their cut ends, the cross-pieces they are lashed to and the lashings (centred on the section)
    for (let k = 0; k < 5; k++) {
      const x = (k - 2) * 0.6, len = RC - 0.06 - ((k * 7) % 3) * 0.04;
      put(RM.log, new THREE.CylinderGeometry(0.29, 0.29, len, 10, 1, true).rotateX(Math.PI / 2).translate(x, RDECK - 0.31, 0));
      for (const sd of [-1, 1]) put(RM.end, new THREE.CircleGeometry(0.29, 10).rotateY(sd > 0 ? 0 : Math.PI).translate(x, RDECK - 0.31, sd * len / 2));
    }
    for (const sd of [-1, 1]) {
      put(RM.beam, new THREE.BoxGeometry(RC - 0.08, 0.09, 0.18).translate(0, RDECK - 0.03, sd * 0.95));
      for (let k = 0; k < 5; k++) put(RM.rope, new THREE.BoxGeometry(0.1, 0.1, 0.24).translate((k - 2) * 0.6, RDECK - 0.02, sd * 0.95));
    }
  } else if (kind === 'sill') {
    // a squared sill under a wall on the logs, down between the round logs (no gap under the wall)
    put(RM.beam, new THREE.BoxGeometry(RC + 0.02, 0.4, 0.34).translate(0, -0.2 + 0.005, 0));
  } else for (const [k, list] of pieceGeo(kind as PieceKind)) for (const g of list) put(matOf(k), g);
  out = [...by].map(([m, list]) => [m, mergeGeometries(list)!] as [THREE.Material, THREE.BufferGeometry]);
  KIND_GEO.set(kind, out);
  return out;
}
/** the meshes of one piece of a raft, placed in raft space */
function pieceMeshes(p: RaftPiece, shadows: boolean, ghost: THREE.Material | null, to: THREE.Object3D) {
  const put = (kind: string, x: number, y: number, z: number, ry: number) => {
    for (const [m, g] of kindGeo(kind)) {
      const o = new THREE.Mesh(g, ghost ?? m);
      o.position.set(x, y, z); o.rotation.y = ry;
      o.castShadow = shadows && !ghost && m !== mats().glass; o.receiveShadow = shadows && !ghost;
      to.add(o);
    }
  };
  if (p[0] === 't') put('tile', p[1] * RC, 0, p[2] * RC, 0);
  else if (p[0] === 'e') {
    const [, ax, i, j, L, kind] = p, x = ax === 'x' ? i * RC : (i - 0.5) * RC, z = ax === 'x' ? (j - 0.5) * RC : j * RC, ry = ax === 'x' ? 0 : Math.PI / 2;
    put(kind, x, RDECK + L * RWH, z, ry);
    if (L === 0) put('sill', x, RDECK, z, ry);
  }
  else if (p[0] === 'd') return;
  else if (p[0] === 'f') put('floor', p[1] * RC, RDECK + p[3] * RWH, p[2] * RC, 0);
  else { const [dx, dz] = STAIR_DIRS[p[4]]; put('stairs', p[1] * RC, RDECK + p[3] * RWH, p[2] * RC, Math.atan2(dx, dz)); }
}
/** the oar's parts (shared geometry) */
let OAR: { post: THREE.BufferGeometry; pole: THREE.BufferGeometry; blade: THREE.BufferGeometry; grip: THREE.BufferGeometry } | null = null;
function makeRaft(r: Raft, shadows: boolean, ghost: THREE.Material | null = null, only?: RaftPiece): THREE.Group {
  const g = new THREE.Group();
  if (only) pieceMeshes(only, shadows, ghost, g); else for (const p of r.list()) pieceMeshes(p, shadows, ghost, g);
  if (only || ghost) return g;
  // the oar: a post at the back, the oar on a pivot at its top, its blade trailing in the water behind
  const RM = raftMats(), [px, py, pz] = r.oarPost();
  const a = new THREE.Vector3(0, 0.12, -0.75), b = new THREE.Vector3(0, -1.45, 3.1), len = a.distanceTo(b);
  OAR ??= { post: new THREE.CylinderGeometry(0.07, 0.09, 1.1, 8), pole: new THREE.CylinderGeometry(0.045, 0.045, len, 7), blade: new THREE.BoxGeometry(0.34, 0.05, 0.85), grip: new THREE.CylinderGeometry(0.055, 0.055, 0.3, 7).rotateZ(Math.PI / 2) };
  const post = new THREE.Mesh(OAR.post, RM.beam); post.position.set(px, py + 0.55, pz); post.castShadow = shadows; g.add(post);
  const pv = new THREE.Group(); pv.position.set(px, py + 1.05, pz + 0.02); g.add(pv);
  const pole = new THREE.Mesh(OAR.pole, RM.end);
  pole.position.copy(a).add(b).multiplyScalar(0.5); pole.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()); pv.add(pole);
  const blade = new THREE.Mesh(OAR.blade, RM.beam);
  blade.position.copy(b).add(b.clone().sub(a).normalize().multiplyScalar(-0.35)); blade.quaternion.copy(pole.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)); pv.add(blade);
  const grip = new THREE.Mesh(OAR.grip, RM.beam); grip.position.copy(a); pv.add(grip);
  r.oar = pv;
  // the doors: a leaf on a hinge in each doorway that has one
  r.doorPivots.clear();
  for (const [k, st] of r.doors) {
    const [i, j, L] = k.slice(1).split(',').map(Number), ax = k[0] === 'x';
    const frame = new THREE.Group(); frame.position.set(ax ? i * RC : (i - 0.5) * RC, RDECK + L * RWH, ax ? (j - 0.5) * RC : j * RC); frame.rotation.y = ax ? 0 : Math.PI / 2; g.add(frame);
    const hinge = new THREE.Group(); hinge.position.set(-0.6, 0, 0); frame.add(hinge);
    const leaf = new THREE.Mesh(doorLeaf(), woodMaterials().slab); leaf.position.set(DOOR_W / 2 + 0.02, DOOR_H / 2 + 0.01, 0); leaf.castShadow = shadows; leaf.receiveShadow = shadows; hinge.add(leaf);
    const ang = st ? st * Math.PI / 2 * 0.92 : 0; hinge.rotation.y = ang;
    r.doorPivots.set(k, { g: hinge, ang });
  }
  return g;
}
/** the raft's sections all clear of the bottom at (x, z, yaw)? (`extra`: one more section, to try) */
function raftAfloat(r: Raft, x: number, z: number, yaw: number, draft: number, extra?: [number, number]): boolean {
  const s = Math.sin(yaw), c = Math.cos(yaw), h = RC / 2 - 0.1;
  const test = (i: number, j: number) => {
    for (const [ox, oz] of [[0, 0], [-h, -h], [h, -h], [-h, h], [h, h]]) {
      const lx = i * RC + ox, lz = j * RC + oz, wx = x + lx * c + lz * s, wz = z - lx * s + lz * c;
      if (heightAt(wx, wz) > -draft) return false;
    }
    return true;
  };
  for (const k of r.tiles) { const [i, j] = k.split(',').map(Number); if (!test(i, j)) return false; }
  return !extra || test(extra[0], extra[1]);
}
/** what the building plan would put on a raft, and whether it can */
export interface RaftAim { b: Boat; p: RaftPiece; ok: boolean; reason: string; t: number }

// ------------------------------------------------------------------ the boats
const tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(0, 0, 0, 'YXZ');
interface Pose { x: number; y: number; z: number; yaw: number; pitch: number; roll: number }
/** where boat-space (lx, ly, lz) is in the world, for a boat at `p` */
function toWorld<T extends PV>(p: Pose, lx: number, ly: number, lz: number, out: T): T {
  tmpE.set(p.pitch, p.yaw, p.roll); tmpQ.setFromEuler(tmpE);
  const w = _tw.set(lx, ly, lz).applyQuaternion(tmpQ).add(tmpV.set(p.x, p.y, p.z));
  out.set(w.x, w.y, w.z);
  return out;
}
const _tw = new THREE.Vector3(), _yq = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);
/** and back (the exact inverse) */
function toLocal(p: Pose, x: number, y: number, z: number, out: THREE.Vector3) {
  tmpE.set(p.pitch, p.yaw, p.roll); tmpQ.setFromEuler(tmpE).invert();
  return out.set(x - p.x, y - p.y, z - p.z).applyQuaternion(tmpQ);
}
const pose = (b: Boat): Pose => ({ x: b.x, y: b.y + b.lift, z: b.z, yaw: b.yaw, pitch: b.pitch, roll: b.roll });
const L1 = new THREE.Vector3(), L2 = new THREE.Vector3();
/** how far from its middle anything of a boat or raft reaches (m) */
const reach = (b: Boat) => (b.raft ? b.raft.rad : LEN / 2 + 0.5);

export class Boats {
  readonly list: Boat[] = [];
  myId = 0;
  /** the boat I'm standing on (or swimming beside: null), and whether I hold its wheel */
  on: Boat | null = null;
  atHelm = false;
  /** 0..1: how hard the sea storm blows where I am */
  storm = 0;
  private fullT = 0;
  private warned = 0;
  /** (set by the game) the deck I'm on carries a compass: the storm can be steered through */
  compass = false;
  private edgeT = 0;
  private warnN = 0;
  readonly wave: Wave;
  private waveFor: Boat | null = null;   // the boat (or null: just me, swimming) the wave is coming for
  private waveMine = false;              // ... and it will hit me
  private roarT = 0;
  private mvT = 0;
  private onT = 0;
  private sndT = 0;
  private lastYaw = NaN;
  private ghost: THREE.Group;
  /** the raft being set down, and a piece being built on a raft */
  private raftGhost: THREE.Group | null = null;
  private pieceGhost: THREE.Group | null = null;
  private pieceGhostKey = '';
  private ghostMat = Object.assign(new THREE.MeshBasicMaterial({ color: 0x7cff9a, transparent: true, opacity: 0.35, depthWrite: false }), { userData: { liveColor: true } });
  /** other players on deck: where on which boat (boat space), and when we last heard */
  private riders = new Map<number, { b: Boat; x: number; y: number; z: number; r: number; t: number }>();
  private clock = 0;

  /** network: tell the others */
  onEvent: ((e: Record<string, unknown>) => void) | null = null;
  /** is this player still here? (lets go of the wheel for them when they leave) */
  present: (id: number) => boolean = () => true;
  /** the water surface (waves included) */
  surface: (x: number, z: number) => number = () => 0;
  say: ((t: string) => void) | null = null;
  sfx: { splash(v?: number): void; creak(): void; bonk(): void; bigSplash(v: number): void; blow(v: number): void; thunder(d: number): void } | null = null;
  shake: ((a: number) => void) | null = null;
  /** the giant wave reached me */
  onWreck: (() => void) | null = null;

  constructor(private scene: THREE.Scene, private shadows: boolean) {
    this.ghost = makeModel(this.ghostMat, false, null);
    this.ghost.visible = false;
    scene.add(this.ghost);
    this.wave = new Wave(scene);
  }

  // -------------------------------------------------------------- placing
  /** is the hull clear of the bottom at (x, z, yaw)? */
  afloat(x: number, z: number, yaw: number, draft = 1.1) {
    const s = Math.sin(yaw), c = Math.cos(yaw);
    for (const [lx, lz] of [[0, -5.3], [0, 5.4], [-1.9, 0], [1.9, 0], [-1.7, 3.8], [1.7, 3.8], [-1.4, -3.2], [1.4, -3.2], [0, 0]]) {
      const wx = x + lx * c + lz * s, wz = z - lx * s + lz * c;
      if (heightAt(wx, wz) > -draft) return false;
    }
    return true;
  }
  /**
   * Where a held boat would go: on the water where you are looking (or pointing, in VR). If that exact spot will not take
   * it (too shallow, too near the beach, another boat), the nearest spot that will is found for you: a little further
   * out along your line of sight or to either side, and the boat turned along or across it, whichever fits.
   */
  aim(eye: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, yaw: number, raft = false): { ok: boolean; why: string; x: number; z: number; yaw: number; raft?: boolean } {
    const out = { ok: false, why: '', x: 0, z: 0, yaw, raft };
    if (!raft && this.list.filter((b) => !b.raft).length >= MAX) { out.why = `There are ${MAX} boats already`; return out; }
    if (raft && this.list.filter((b) => b.raft).length >= RAFT_MAX) { out.why = `There are ${RAFT_MAX} rafts already`; return out; }
    const one = raft ? new Raft() : null, room = raft ? 2.6 : 6;
    const hl = Math.hypot(dir.x, dir.z) || 1, hx = dir.x / hl, hz = dir.z / hl;
    // looking at (or near) the horizon still works: the boat goes 9 m out
    const t = dir.y < -0.05 ? Math.max(3, Math.min(30, eye.y / -dir.y)) * hl : 9;
    const bx = eye.x + hx * t, bz = eye.z + hz * t;
    out.x = bx; out.z = bz;
    if (t > 30) { out.why = 'Too far away'; return out; }
    const fits = (x: number, z: number, r: number) => heightAt(x, z) < -0.3 && (one ? raftAfloat(one, x, z, r, 0.6) : this.afloat(x, z, r, 0.95)) && !this.list.some((b) => Math.hypot(b.x - x, b.z - z) < reach(b) + room)
      && Math.hypot(x - eye.x, z - eye.z) > 3;
    const yaws = [yaw, yaw + Math.PI / 2, yaw + Math.PI / 4, yaw - Math.PI / 4];
    for (let step = 0; step <= 14; step++) {
      for (const side of step === 0 ? [0] : [0, -1, 1]) {
        const x = bx + hx * step * 2 - hz * side * step * 1.2, z = bz + hz * step * 2 + hx * side * step * 1.2;
        for (const r of yaws) if (fits(x, z, r)) { out.x = x; out.z = z; out.yaw = r; out.ok = true; return out; }
      }
    }
    out.why = heightAt(bx, bz) > -0.05 ? `${raft ? 'Rafts' : 'Boats'} go on the water: aim at the sea` : this.list.some((b) => Math.hypot(b.x - bx, b.z - bz) < reach(b) + room) ? 'Another boat is in the way' : 'Too shallow here: aim a bit further out';
    return out;
  }
  showGhost(a: { ok: boolean; x: number; z: number; yaw: number; raft?: boolean } | null, time = 0) {
    if (a?.raft && !this.raftGhost) { this.raftGhost = makeRaft(new Raft(), false, this.ghostMat); this.scene.add(this.raftGhost); }
    const gh = a?.raft ? this.raftGhost! : this.ghost, other = a?.raft ? this.ghost : this.raftGhost;
    if (other) other.visible = false;
    gh.visible = !!a && a.x !== 0;
    if (!a || !gh.visible) return;
    gh.position.set(a.x, this.surface(a.x, a.z) + 0.05 * Math.sin(time * 2), a.z);
    gh.rotation.set(0, a.yaw, 0);
    (this.ghostMat as THREE.MeshBasicMaterial).color.set(a.ok ? 0x7cff9a : 0xff6a5a);
  }

  add(nid: string, x: number, z: number, yaw: number, remote = false, plan?: RaftPiece[]): Boat | null {
    if (this.list.some((b) => b.nid === nid)) return null;
    const b = new Boat(nid, x, z, yaw);
    if (plan) { b.raft = new Raft(plan); b.torch.lit = false; }
    b.group = b.raft ? makeRaft(b.raft, this.shadows) : makeModel(null, this.shadows, b);
    b.y = this.surface(x, z);
    this.place(b);
    this.scene.add(b.group);
    this.list.push(b);
    if (!remote) this.onEvent?.({ op: 'add', n: nid, x: +x.toFixed(2), z: +z.toFixed(2), r: +yaw.toFixed(3), ...(plan ? { p: b.raft!.list() } : {}) });
    return b;
  }
  /** a raft's pieces changed: draw it again */
  private remodel(b: Boat) {
    if (!b.raft) return;
    b.raft.refresh();
    this.scene.remove(b.group);
    // (the pieces share their geometry: nothing to dispose)
    b.group = makeRaft(b.raft, this.shadows);
    this.place(b);
    this.scene.add(b.group);
  }
  remove(b: Boat, remote = false) {
    const i = this.list.indexOf(b); if (i < 0) return;
    this.list.splice(i, 1);
    this.scene.remove(b.group);
    if (this.on === b) { this.on = null; this.atHelm = false; }
    if (this.waveFor === b) this.waveFor = null;
    for (const [id, r] of this.riders) if (r.b === b) this.riders.delete(id);
    if (!remote) this.onEvent?.({ op: 'del', n: b.nid });
  }
  byId(nid: string) { return this.list.find((b) => b.nid === nid) ?? null; }
  /** something set down at (x, y, z): on which boat's deck, and where on it (boat-space) and turned how, or null */
  deckSpot(x: number, y: number, z: number, yaw: number): { n: string; l: [number, number, number, number] } | null {
    for (const b of this.list) {
      if (Math.abs(b.x - x) > LEN || Math.abs(b.z - z) > LEN) continue;
      const l = toLocal(pose(b), x, y, z, L1);
      if (b.raft) {
        // (a torch on a railing's post stands right on the raft's edge)
        let f = b.raft.floorAt(l.x, l.y, l.z);
        if (f < -1e8 && b.raft.nearest(l.x, l.z, 0)[2] < 0.4) f = RDECK;
        if (f > -1e8 && l.y > f - 0.6 && l.y < f + 3) return { n: b.nid, l: [+l.x.toFixed(3), +l.y.toFixed(3), +l.z.toFixed(3), +(yaw - b.yaw).toFixed(3)] };
        continue;
      }
      if (Math.abs(l.x) < HB + 0.3 && Math.abs(l.z) < LEN / 2 + 0.3 && l.y > DECK - 0.6 && l.y < DECK + 3) return { n: b.nid, l: [+l.x.toFixed(3), +l.y.toFixed(3), +l.z.toFixed(3), +(yaw - b.yaw).toFixed(3)] };
    }
    return null;
  }
  /** where a spot on a boat's deck is now (and how it is turned, tilted with the boat), or null if that boat is gone */
  deckWorld(n: string, l: [number, number, number, number], out: { x: number; y: number; z: number; yaw: number; q: THREE.Quaternion }): boolean {
    const b = this.byId(n); if (!b) return false;
    const p = pose(b), w = toWorld(p, l[0], l[1], l[2], L2);
    out.x = w.x; out.y = w.y; out.z = w.z; out.yaw = b.yaw + l[3];
    tmpE.set(p.pitch, p.yaw, p.roll); out.q.setFromEuler(tmpE).multiply(_yq.setFromAxisAngle(_up, l[3]));
    return true;
  }
  /** somebody aboard? (me, or anyone whose deck position we heard lately) */
  aboard(b: Boat) { return this.on === b || [...this.riders.values()].some((r) => r.b === b && this.clock - r.t < 2); }

  // -------------------------------------------------------------- walking on deck
  /** the deck under (x, z) a walker at height y can stand on (the highest boat's), or -1e9 */
  ground(x: number, z: number, y = 1e9): number {
    let best = -1e9;
    for (const b of this.list) {
      const R = reach(b);
      if (Math.abs(x - b.x) > R || Math.abs(z - b.z) > R) continue;
      const p = pose(b), l = toLocal(p, x, Math.min(y, p.y + 30), z, L1);
      if (b.raft) {
        const f = b.raft.floorAt(l.x, l.y, l.z);
        if (f < -1e8) continue;
        const d = toWorld(p, l.x, f, l.z, L2).y;
        if (d <= y + 0.9 && d > best) best = d;
        continue;
      }
      const hh = deckHalf(l.z);
      if (hh < 0 || Math.abs(l.x) > hh || l.z > LEN / 2) continue;
      // the deck's height right here (or the cabin floor, the helm step), tilted with the boat
      const d = toWorld(p, l.x, floorAt(l.x, l.z), l.z, L2).y;
      if (d <= y + 0.9 && d > best) best = d;
    }
    return best;
  }
  /** pushes a walker (or a swimmer) out of everything solid on a boat: rails, cabin walls, mast, wheel, table; the hull from outside */
  resolve(x: number, z: number, r: number, feetY: number, out: { x: number; z: number }) {
    for (const b of this.list) {
      const R = reach(b) + 1;
      if (Math.abs(x - b.x) > R || Math.abs(z - b.z) > R) continue;
      const p = pose(b), l = toLocal(p, x, feetY, z, L1);
      if (b.raft) {
        const o = this.resolveRaft(b.raft, l.x, l.y, l.z, r);
        if (o) { const w = toWorld(p, o[0], l.y, o[1], L2); x = w.x; z = w.z; }
        continue;
      }
      const deckY = toWorld(p, l.x, floorAt(l.x, l.z), l.z, L2).y, up = feetY - deckY;
      let lx = l.x, lz = l.z;
      const hh = deckHalf(lz);
      if (up > -0.4) {
        if (up > 2.6) continue;
        // on deck: the rails keep you aboard (jump high enough and you go over); the gap at the stern lets you down the ladder
        const inside = hh > 0 && Math.abs(lx) < hh + 0.3 && lz > -LEN / 2 && lz < LEN / 2 + 0.3;
        if (inside && up < 0.95) {
          const lim = Math.max(0, hh - r);
          if (Math.abs(lx) > lim) lx = Math.sign(lx) * lim;
          if (lz > LEN / 2 - r && Math.abs(lx) > GAP - r * 0.5) lz = LEN / 2 - r;
          const bowLim = -LEN / 2 + 0.9;
          if (lz < bowLim) lz = bowLim;
        }
        for (const bx of DECK_BOXES) {
          if (up > bx.h - 0.3 && bx.h < 1) continue;                    // stepped up on the bench
          const cx = Math.max(bx.x0, Math.min(lx, bx.x1)), cz = Math.max(bx.z0, Math.min(lz, bx.z1));
          const dx = lx - cx, dz = lz - cz, d2 = dx * dx + dz * dz;
          if (d2 >= r * r) continue;
          if (d2 > 1e-8) { const d = Math.sqrt(d2); lx = cx + (dx / d) * r; lz = cz + (dz / d) * r; }
          else { const m = Math.min(lx - bx.x0, bx.x1 - lx, lz - bx.z0, bx.z1 - lz); if (m === lx - bx.x0) lx = bx.x0 - r; else if (m === bx.x1 - lx) lx = bx.x1 + r; else if (m === lz - bx.z0) lz = bx.z0 - r; else lz = bx.z1 + r; }
        }
      } else if (lz > -LEN / 2 - r && lz < LEN / 2 + r) {
        // in the water: the hull is solid, swim round it
        const half = Math.max(hw(Math.min(1, Math.max(0, uOf(lz)))), 0.2) + r;
        if (Math.abs(lx) < half) {
          const toSide = half - Math.abs(lx), toStern = LEN / 2 + r - lz, toBow = lz + LEN / 2 + r;
          if (toStern < toSide && toStern < toBow) lz = LEN / 2 + r; else if (toBow < toSide) lz = -LEN / 2 - r; else lx = Math.sign(lx || 1) * half;
        }
      } else continue;
      if (lx !== l.x || lz !== l.z) { const w = toWorld(p, lx, l.y, lz, L2); x = w.x; z = w.z; }
    }
    out.x = x; out.z = z;
  }
  /** on a raft: walls and railings are solid; from the water, the logs are (swim round them). The new (x, z), or null. */
  private resolveRaft(rf: Raft, lx0: number, ly: number, lz0: number, r: number): [number, number] | null {
    let lx = lx0, lz = lz0;
    if (ly > RDECK - 0.4) {
      for (const bx of rf.boxes) {
        if (bx.y1 < ly + 0.35 || bx.y0 > ly + 1.7) continue;
        const cx = Math.max(bx.x0, Math.min(lx, bx.x1)), cz = Math.max(bx.z0, Math.min(lz, bx.z1));
        const dx = lx - cx, dz = lz - cz, d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-8) { const d = Math.sqrt(d2); lx = cx + (dx / d) * r; lz = cz + (dz / d) * r; }
        else { const m = Math.min(lx - bx.x0, bx.x1 - lx, lz - bx.z0, bx.z1 - lz); if (m === lx - bx.x0) lx = bx.x0 - r; else if (m === bx.x1 - lx) lx = bx.x1 + r; else if (m === lz - bx.z0) lz = bx.z0 - r; else lz = bx.z1 + r; }
      }
    } else if (ly > -2.5) {
      // in the water: out from under the logs, the shortest way
      const i = Math.round(lx / RC), j = Math.round(lz / RC);
      const fx = lx - i * RC, fz = lz - j * RC, h = RC / 2 + r;
      const inT = (a: number, b: number) => rf.tile(a, b) && Math.abs(lx - a * RC) < h && Math.abs(lz - b * RC) < h;
      let hit: [number, number] | null = null;
      for (const [a, b] of [[i, j], [i + Math.sign(fx || 1), j], [i, j + Math.sign(fz || 1)], [i + Math.sign(fx || 1), j + Math.sign(fz || 1)]]) if (inT(a, b)) { hit = [a, b]; break; }
      if (!hit) return null;
      const run = (dx: number, dz: number) => { let a = hit![0], b = hit![1]; while (rf.tile(a + dx, b + dz)) { a += dx; b += dz; } return [a, b]; };
      const [ax] = run(-1, 0), [bx2] = run(1, 0), [, az] = run(0, -1), [, bz] = run(0, 1);
      const opts: [number, number][] = [[(ax - 0.5) * RC - r, lz], [(bx2 + 0.5) * RC + r, lz], [lx, (az - 0.5) * RC - r], [lx, (bz + 0.5) * RC + r]];
      let best = opts[0], bd = 1e9;
      for (const o of opts) { const d = Math.hypot(o[0] - lx, o[1] - lz); if (d < bd) { bd = d; best = o; } }
      lx = best[0]; lz = best[1];
    }
    return lx !== lx0 || lz !== lz0 ? [lx, lz] : null;
  }
  /** which boat (if any) someone at (x, y, z) is standing or jumping on */
  private boatUnder(x: number, y: number, z: number): Boat | null {
    for (const b of this.list) {
      const R = reach(b);
      if (Math.abs(x - b.x) > R || Math.abs(z - b.z) > R) continue;
      if (b.raft) {
        const l = toLocal(pose(b), x, y, z, L1), f = b.raft.floorAt(l.x, l.y, l.z), up = l.y - f;
        if (f > -1e8 && up > -0.35 && up < 2.2) return b;
        continue;
      }
      const p = pose(b), l = toLocal(p, x, y, z, L1), hh = deckHalf(l.z);
      if (hh < 0 || Math.abs(l.x) > hh + 0.15 || l.z > LEN / 2 + 0.2) continue;
      const up = y - toWorld(p, l.x, floorAt(l.x, l.z), l.z, L2).y;
      if (up > -0.35 && up < 2.2) return b;
    }
    return null;
  }

  // -------------------------------------------------------------- getting aboard, the wheel
  /** what the player is looking at on a boat: its hull from outside ('board'), or the wheel from on deck ('helm') */
  target(eye: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, max: number): { b: Boat; what: 'board' | 'helm'; dist: number } | null {
    let best: { b: Boat; what: 'board' | 'helm'; dist: number } | null = null;
    for (const b of this.list) {
      if (Math.hypot(b.x - eye.x, b.z - eye.z) > max + reach(b)) continue;
      const p = pose(b), o = toLocal(p, eye.x, eye.y, eye.z, L1).clone();
      const e2 = toLocal(p, eye.x + dir.x, eye.y + dir.y, eye.z + dir.z, L2), d = e2.sub(o);
      const hit = (lo: number[], hi: number[]) => {
        let t0 = 0, t1 = max; const oo = [o.x, o.y, o.z], dd = [d.x, d.y, d.z];
        for (let k = 0; k < 3; k++) {
          if (Math.abs(dd[k]) < 1e-6) { if (oo[k] < lo[k] || oo[k] > hi[k]) return -1; continue; }
          let a = (lo[k] - oo[k]) / dd[k], c = (hi[k] - oo[k]) / dd[k]; if (a > c) [a, c] = [c, a];
          t0 = Math.max(t0, a); t1 = Math.min(t1, c);
        }
        return t0 <= t1 ? t0 : -1;
      };
      if (b.raft) {
        const rf = b.raft;
        if (this.on === b) {
          if (this.atHelm) continue;
          const [px, , pz] = rf.oarPost(), t = hit([px - 0.5, RDECK + 0.2, pz - 0.5], [px + 0.5, RDECK + 1.6, pz + 0.6]);
          if (t >= 0 && (!best || t < best.dist)) best = { b, what: 'helm', dist: t };
        } else {
          const t = hit([rf.x0 - 0.2, -0.8, rf.z0 - 0.2], [rf.x1 + 0.2, RDECK + 1.0, rf.z1 + 0.2]);
          if (t >= 0 && (!best || t < best.dist)) best = { b, what: 'board', dist: t };
        }
        continue;
      }
      if (this.on === b) {
        if (this.atHelm) continue;
        const t = hit([-0.65, DECK + 0.8, WHEEL_Z - 0.3], [0.65, DECK + 2.0, WHEEL_Z + 0.45]);
        if (t >= 0 && (!best || t < best.dist)) best = { b, what: 'helm', dist: t };
      } else {
        const t = hit([-HB - 0.2, -0.8, -LEN / 2 - 0.2], [HB + 0.2, DECK + 1.2, LEN / 2 + 0.4]);
        if (t >= 0 && (!best || t < best.dist)) best = { b, what: 'board', dist: t };
      }
    }
    return best;
  }
  /** a boat you are close to (beside it in the water, or on a jetty by it), from any side: you can climb aboard with use */
  nearHull(x: number, y: number, z: number, pad = 2.2): Boat | null {
    let best: Boat | null = null, bd = 1e9;
    for (const b of this.list) {
      if (this.on === b || Math.abs(b.x - x) > reach(b) + pad || Math.abs(b.z - z) > reach(b) + pad) continue;
      const l = toLocal(pose(b), x, y, z, L1);
      if (b.raft) {
        const d = b.raft.nearest(l.x, l.z, 0)[2];
        if (d < pad && l.y > -3.5 && l.y < RDECK + 2.5 && d < bd) { bd = d; best = b; }
        continue;
      }
      const ox = Math.max(0, Math.abs(l.x) - HB), oz = Math.max(0, l.z - LEN / 2, -LEN / 2 - l.z), d = Math.hypot(ox, oz);
      if (d < pad && l.y > -3.5 && l.y < DECK + 2.5 && d < bd) { bd = d; best = b; }
    }
    return best;
  }
  /** climb aboard from the water (or a jetty): onto the nearest bit of deck. Sets the feet `pos`. */
  board(b: Boat, pos: PV, vel: PV) {
    const p = pose(b), l = toLocal(p, pos.x, pos.y, pos.z, L1);
    if (b.raft) {
      const [nx, nz] = b.raft.nearest(l.x, l.z, 0.55), w = toWorld(p, nx, RDECK + 0.05, nz, L2);
      pos.set(w.x, w.y, w.z); vel.set(0, 0, 0); this.sfx?.splash(0.4);
      return;
    }
    let lz = Math.max(-LEN / 2 + 1.5, Math.min(LEN / 2 - 0.7, l.z)), lx = l.x;
    const hh = deckHalf(lz) - 0.5;
    lx = Math.max(-hh, Math.min(hh, lx));
    if (lz > CAB.z0 - 0.4 && lz < CAB.z1 + 0.4 && Math.abs(lx) < CAB.cw + 0.45) lx = Math.sign(lx || 1) * Math.min(hh, CAB.cw + 0.42);
    if (Math.abs(lz - MAST_Z) < 0.5 && Math.abs(lx) < 0.5) lx = 0.6;
    const w = toWorld(p, lx, DECK + 0.05, lz, L2);
    pos.set(w.x, w.y, w.z); vel.set(0, 0, 0);
    this.sfx?.splash(0.4);
  }
  takeHelm(b: Boat): boolean {
    if (b.helm !== null && b.helm !== this.myId && this.present(b.helm)) return false;
    b.helm = this.myId; this.on = b; this.atHelm = true; this.lastYaw = NaN; b.tv = b.v;
    this.onEvent?.({ op: 'helm', n: b.nid, on: 1 });
    return true;
  }
  leaveHelm() {
    const b = this.on;
    if (!this.atHelm || !b) { this.atHelm = false; return; }
    this.atHelm = false;
    if (b.helm === this.myId) b.helm = null;
    this.onEvent?.({ op: 'helm', n: b.nid, on: 0 });
  }
  /** One frame at the wheel: stand behind it (feet `pos`), the view turning with the boat. False once you let go. */
  carryHelm(pos: PV, look: { yaw: number }): boolean {
    const b = this.on; if (!b || !this.atHelm) return false;
    if (b.raft) { const [hx, hy, hz] = b.raft.helmSpot(); toWorld(pose(b), hx, hy, hz, pos); }
    else toWorld(pose(b), 0, DECK + HELM_UP, HELM_Z, pos);
    if (!Number.isNaN(this.lastYaw)) { let d = b.yaw - this.lastYaw; d = Math.atan2(Math.sin(d), Math.cos(d)); look.yaw += d; }
    this.lastYaw = b.yaw;
    return true;
  }
  /** multiplayer: where a remote player on a deck is (their avatar rides the boat, not their own laggy position packets) */
  deckOf(id: number, out: { x: number; y: number; z: number; yaw: number }): boolean {
    const r = this.riders.get(id);
    if (!r || this.clock - r.t > 4 || !this.list.includes(r.b)) return false;
    const w = toWorld(pose(r.b), r.x, r.y, r.z, L2);
    out.x = w.x; out.y = w.y; out.z = w.z; out.yaw = r.b.yaw + r.r;
    return true;
  }

  // -------------------------------------------------------------- every frame
  /**
   * `ctl`: my stick / keys (used at the wheel). `me`: my feet (I ride along when I'm on a deck); `look`: my yaw (turns with the
   * boat); `free`: I'm walking about normally (not on the slide, not dead...); `away`: in a cave or a room (no storm).
   */
  update(dt: number, time: number, ctl: { x: number; y: number; boost: boolean }, me: PV, look: { yaw: number }, free: boolean, away: boolean) {
    this.clock += dt;
    // ---- the storm round me
    const r = away ? 0 : Math.hypot(me.x, me.z);
    let want = Math.max(0, Math.min(1, (r - STORM_R0) / (STORM_R1 - STORM_R0)));
    // (the storm only rages over the reef's ring: once you are through it, out on the open sea or up north, it is behind you)
    if (r > PASS_R1) want = 0;
    // (the second storm, up among the big icebergs: rides out with or without a wave, as the reef's does with a compass)
    const north = away ? 0 : northStorm(me.x, me.z);
    want = Math.max(want, 0.85 * north);
    // (a compass aboard: you hold your course through it, and out past the worst of it the storm blows itself out)
    if (this.compass) want *= 0.85 * Math.max(0, Math.min(1, 1 - (r - PASS_R0) / (PASS_R1 - PASS_R0)));
    // (it builds over half a minute or so: the sky darkens, the rain comes on, the waves grow)
    this.storm += (want - this.storm) * Math.min(1, dt / (want > this.storm ? 22 : 6));
    if (this.storm > 0.85) this.fullT += dt; else this.fullT = Math.max(0, this.fullT - dt * 0.5);
    if (this.storm > 0.1 && this.warned < 1) { this.warned = 1; this.say?.('The sky is turning black out here…'); }
    if (this.storm > 0.6 && this.warned < 2) { this.warned = 2; this.say?.(this.compass ? 'Hold her steady! The compass keeps you on course through the storm.' : 'This is no sea for a little boat. Turn back!'); }
    if (this.compass && this.warned >= 1 && this.warned < 3 && r > PASS_R0 + 30 && want < this.storm) { this.warned = 3; this.say?.('The storm is easing. The sun breaks through the clouds and the sea calms down.'); }
    if (north > 0.3 && this.warnN === 0) { this.warnN = 1; this.say?.('Another storm is blowing up among the icebergs! Steer carefully: they are hard to see.'); }
    if (this.warnN === 1 && north < 0.05 && this.storm > 0.3) { this.warnN = 2; this.say?.('The storm passes. The sky clears over the ice.'); }
    if (north < 0.01 && this.storm < 0.05) this.warnN = 0;
    if (this.storm < 0.02 && (r < STORM_R0 || r > PASS_R1)) this.warned = 0;
    if (!this.wave.active && !away && !this.compass && r < PASS_R1 && (r > WRECK_R || this.fullT > STORM_HOLD)) this.bringWave();

    // ---- which deck am I on (before the boats move: I ride along with mine)
    const was = this.on;
    if (!this.atHelm) this.on = free && !away ? this.boatUnder(me.x, me.y, me.z) : null;
    const ride = this.on && !this.atHelm ? toLocal(pose(this.on), me.x, me.y, me.z, new THREE.Vector3()) : null;
    // (in the storm nobody goes over the side: whoever is on deck stays on it)
    if (ride && this.storm > 0.1 && this.on?.raft) {
      const [nx, nz] = this.on.raft.nearest(ride.x, ride.z, 0.3); ride.x = nx; ride.z = nz;
    } else if (ride && this.storm > 0.1) {
      ride.z = Math.max(-LEN / 2 + 1.5, Math.min(LEN / 2 - 0.7, ride.z));
      const hh = deckHalf(ride.z) - 0.25;
      if (hh > 0) ride.x = Math.max(-hh, Math.min(hh, ride.x));
    }
    const yaw0 = this.on ? this.on.yaw : 0;

    for (const b of this.list) {
      if (b.helm !== null && b.helm !== this.myId && !this.present(b.helm)) b.helm = null;
      const mine = b === this.on && this.atHelm;
      if (mine) {
        this.drive(b, dt, time, ctl);
        // (the edge of the open sea: a current that will not let you further, you are turned back)
        const back = keepInSea(b.x, b.z, SEA_R);
        if (back) {
          b.x = back[0]; b.z = back[1]; b.v *= 0.9;
          if (this.edgeT <= 0) { this.edgeT = 20; this.say?.('A strong current holds you back. Nothing out here but empty ocean. Only the way north, where the air turns cold, goes on.'); }
        }
        this.edgeT -= dt;
      }
      else if (b.helm !== null) {
        // somebody else steers: follow what they say (and guess ahead a little)
        b.tx -= Math.sin(b.tyaw) * b.tv * dt; b.tz -= Math.cos(b.tyaw) * b.tv * dt;
        const k = 1 - Math.exp(-dt * 6);
        b.x += (b.tx - b.x) * k; b.z += (b.tz - b.z) * k;
        let d = b.tyaw - b.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); b.yaw += d * k; b.yawV = d * 2;
        b.v = b.tv;
      } else { b.v *= Math.exp(-dt * 0.5); b.yawV *= Math.exp(-dt); b.tx = b.x; b.tz = b.z; b.tyaw = b.yaw; }
      b.lift = this.wave.active ? this.wave.liftAt(this.wave.ahead(b.x, b.z)) : 0;
      this.float(b, dt, time);
      this.animate(b, dt, time);
    }
    // at the wheel: stand where it is now; carried along by my deck
    if (this.atHelm && this.on) this.carryHelm(me, look);
    else if (ride && this.on) {
      const w = toWorld(pose(this.on), ride.x, ride.y, ride.z, L2);
      me.set(w.x, w.y, w.z);
      let d = this.on.yaw - yaw0; d = Math.atan2(Math.sin(d), Math.cos(d)); look.yaw += d;
    }
    // tell the others where on the deck I am (and that I left it)
    const m = this.on;
    if (m) {
      this.onT -= dt;
      if (this.onT <= 0) {
        this.onT = 0.1;
        const l = toLocal(pose(m), me.x, me.y, me.z, L1);
        this.onEvent?.({ op: 'on', n: m.nid, x: +l.x.toFixed(2), y: +l.y.toFixed(2), z: +l.z.toFixed(2), r: +(look.yaw - m.yaw).toFixed(2) });
      }
    } else if (was) this.onEvent?.({ op: 'off', n: was.nid });
    if (m && this.atHelm) {
      this.mvT -= dt;
      if (this.mvT <= 0) { this.mvT = 0.1; this.onEvent?.({ op: 'mv', n: m.nid, x: +m.x.toFixed(2), z: +m.z.toFixed(2), r: +m.yaw.toFixed(3), v: +m.v.toFixed(2) }); }
    }
    // the sea against the hull, the rigging creaking
    if (m) {
      this.sndT -= dt;
      if (this.sndT <= 0) { this.sndT = 2 + Math.random() * 3; if (Math.abs(m.v) > 1.2 || this.storm > 0.3) this.sfx?.splash(0.15 + Math.min(0.3, Math.abs(m.v) * 0.03)); if (Math.random() < 0.3) this.sfx?.creak(); }
    }
    // ---- the giant wave
    {
      const w = this.wave, f = this.waveFor;
      const run = f ? (-Math.sin(f.yaw) * f.v) * w.dx + (-Math.cos(f.yaw) * f.v) * w.dz : 0;
      const dt0 = w.active ? w.ahead(f ? f.x : me.x, f ? f.z : me.z) : 0;
      w.update(dt, run, this.waveMine || f !== null, dt0);
    }
    if (this.wave.active) {
      const tgt = this.waveFor ?? null;
      const tx = tgt ? tgt.x : me.x, tz = tgt ? tgt.z : me.z;
      const d = this.wave.ahead(tx, tz);
      this.roarT -= dt;
      if (this.roarT <= 0 && d < 330) { this.roarT = 0.45; const k = Math.max(0.12, 1 - d / 300); this.sfx?.blow(k); this.sfx?.bigSplash(k * 0.6); }
      if ((this.waveMine || (tgt && this.on === tgt)) && this.warned < 4 && d < 170) { this.warned = 4; this.say?.('It\'s a wave! Hold on!'); }
      // it hits whoever is aboard when it arrives (or the swimmer it came for)
      if (this.waveMine || (tgt && this.on === tgt)) {
        this.shake?.(Math.max(0, 1 - d / 60) * 0.6);
        if (d < 5) {
          this.waveMine = false; this.waveFor = null;
          this.sfx?.bigSplash(1); this.sfx?.thunder(40);
          this.onWreck?.();
        }
      }
    }
  }

  /** the helm: sails filling or spilled, the rudder, aground on the shallows, and the storm shoving you about */
  private drive(b: Boat, dt: number, time: number, ctl: { x: number; y: number; boost: boolean }) {
    const rf = b.raft;
    const maxV = rf ? (ctl.boost ? 4.6 : 3.4) : ctl.boost ? 9.5 : 7;
    const want = ctl.y >= 0 ? ctl.y * maxV : ctl.y * (rf ? 1.4 : 2);
    b.v += (want - b.v) * Math.min(1, dt * (Math.abs(want) > Math.abs(b.v) ? 0.3 : 0.6));
    const turn = -ctl.x * (rf ? 0.42 : 0.5) * Math.min(1, 0.3 + Math.abs(b.v) / 4) * (b.v < -0.1 ? -1 : 1);
    b.yawV += (turn - b.yawV) * Math.min(1, dt * 2);
    const st = this.storm;
    if (st > 0) { b.yawV += st * Math.sin(time * 0.9 + Math.sin(time * 0.37) * 2) * 0.35 * dt; b.v -= st * 0.5 * dt * Math.sign(b.v); }
    b.yaw += b.yawV * dt;
    const nx = b.x - Math.sin(b.yaw) * b.v * dt, nz = b.z - Math.cos(b.yaw) * b.v * dt;
    const clear = (rf ? raftAfloat(rf, nx, nz, b.yaw, 0.55) : this.afloat(nx, nz, b.yaw, 0.9)) && Math.hypot(nx, nz) < WRECK_R + 60
      && !this.list.some((o) => o !== b && Math.hypot(o.x - nx, o.z - nz) < reach(o) + reach(b) - 1);
    if (clear) { b.x = nx; b.z = nz; }
    else {
      if (Math.abs(b.v) > 1.5) { this.sfx?.bonk(); this.shake?.(0.3); this.say?.('Aground! Back off with S.'); }
      b.v *= -0.25;
    }
    b.tx = b.x; b.tz = b.z; b.tyaw = b.yaw; b.tv = b.v;
  }

  /** ride the waves: sit on the surface, pitch and roll with it (a big boat moves slowly) */
  private float(b: Boat, dt: number, time: number) {
    const s = Math.sin(b.yaw), c = Math.cos(b.yaw);
    const at = (lx: number, lz: number) => this.surface(b.x + lx * c + lz * s, b.z - lx * s + lz * c);
    if (b.raft) {
      // a raft sits right on the water and rocks with every wave (a big one less)
      const r = b.raft, mx = (r.x0 + r.x1) / 2, mz = (r.z0 + r.z1) / 2, hx = (r.x1 - r.x0) / 2, hz = (r.z1 - r.z0) / 2;
      const fwd = at(mx, r.z0), aft = at(mx, r.z1), port = at(r.x0, mz), stbd = at(r.x1, mz), mid = at(mx, mz);
      const y = (fwd + aft + port + stbd + mid * 2) / 6 + 0.02 * Math.sin(time * 1.3 + b.x);
      const k = 1 - Math.exp(-dt * 3.5);
      b.y += (y - b.y) * k;
      const pitch = Math.atan2(fwd - aft, hz * 2) - (b.lift > 0.5 ? 0.3 * Math.min(1, b.lift / 8) : 0);
      const roll = Math.atan2(port - stbd, hx * 2) + this.storm * 0.08 * Math.sin(time * 1.4 + b.z);
      b.pitch += (pitch - b.pitch) * k; b.roll += (roll - b.roll) * k;
      this.place(b);
      return;
    }
    const fwd = at(0, -4.5), aft = at(0, 4.5), port = at(-1.8, 0), stbd = at(1.8, 0);
    const y = (fwd + aft + port + stbd) / 4 + Math.sin(time * 0.9 + b.x) * 0.03;
    const k = 1 - Math.exp(-dt * 2.5);
    b.y += (y - b.y) * k;
    const pitch = Math.atan2(fwd - aft, 9) + Math.min(0.04, Math.abs(b.v) * 0.004) - (b.lift > 0.5 ? 0.3 * Math.min(1, b.lift / 8) : 0);
    // heeling: the wind in the sails leans her over a little, more in the storm
    const roll = Math.atan2(port - stbd, 3.6) * 0.8 + 0.035 * Math.min(1, Math.abs(b.v) / 6) + b.yawV * Math.abs(b.v) * 0.02 + this.storm * 0.1 * Math.sin(time * 1.1 + b.z);
    b.pitch += (pitch - b.pitch) * k; b.roll += (roll - b.roll) * k;
    this.place(b);
  }
  private place(b: Boat) {
    b.group.position.set(b.x, b.y + b.lift, b.z);
    b.group.rotation.set(b.pitch, b.yaw, b.roll, 'YXZ');
    const T: THREE.Vector3 | undefined = b.group.userData.torch;
    if (T) { b.group.updateMatrixWorld(); const w = T.clone().applyMatrix4(b.group.matrixWorld); b.torch.x = w.x + 0; b.torch.y = w.y; b.torch.z = w.z; }
  }
  /** sails fill with speed (and flog when there is none), the boom swings out to leeward, the wheel turns, the torch flickers */
  private animate(b: Boat, dt: number, time: number) {
    if (b.raft) {
      // the oar sweeps to steer, and paddles along while under way
      for (const [k, d] of b.raft.doorPivots) {
        const st = b.raft.doors.get(k) ?? 0, want = st * Math.PI / 2 * 0.92;
        if (Math.abs(want - d.ang) > 1e-3) { d.ang += Math.sign(want - d.ang) * Math.min(Math.abs(want - d.ang), dt * 3.2); d.g.rotation.y = d.ang; }
      }
      const o = b.raft.oar;
      if (o) {
        const row = Math.abs(b.v) > 0.3 ? Math.sin(time * 2.2) * Math.min(1, Math.abs(b.v) / 3) : 0;
        const want = Math.max(-0.6, Math.min(0.6, b.yawV * 1.6)) + row * 0.25;
        o.rotation.y += (want - o.rotation.y) * Math.min(1, dt * 4);
        o.rotation.x = row * 0.08;
      }
      return;
    }
    const v = Math.abs(b.v), fill = Math.min(1, v / 6);
    const flog = (1 - fill) * 0.12 * Math.sin(time * 9 + b.x);
    const belly = 0.12 + fill * 0.55 + this.storm * 0.25;
    if (b.main) b.main.scale.x = belly + flog;
    if (b.jib) b.jib.scale.x = belly * 0.9 - flog;
    if (b.boom) { const out = 0.18 + fill * 0.25 + 0.05 * Math.sin(time * 0.7); b.boom.rotation.y += (out - b.boom.rotation.y) * Math.min(1, dt * 1.5); }
    if (b.wheel) b.wheel.rotation.z += (-b.yawV * 4 - b.wheel.rotation.z) * Math.min(1, dt * 4);
    b.flames.forEach((f, i) => { const k = 1 + 0.18 * Math.sin(time * (13 + i * 4) + b.torch.phase) + 0.08 * Math.sin(time * 31 + i); f.scale.set(1, k, 1); });
  }
  /** the cabin torches, for the light pool */
  lights() { return this.list.filter((b) => !b.raft).map((b) => b.torch); }

  // -------------------------------------------------------------- the giant wave and after
  /** the sea has had enough: a wave for my boat (and everybody on it), or just for me */
  private bringWave(remote = false, b: Boat | null = this.on) {
    if (this.wave.active) return;
    if (!remote) this.say?.('Something is rising out there on the horizon…');
    if (this.warned < 3) this.warned = 3;
    if (!b && !remote) { this.waveFor = null; this.waveMine = true; this.wave.start(this.selfX, this.selfZ); }
    else if (b) { b.doomed = true; this.waveFor = b; this.waveMine = false; this.wave.start(b.x, b.z); }
    this.roarT = 0;
    this.say?.('A GIANT WAVE!');
    if (b && !remote) this.onEvent?.({ op: 'wave', n: b.nid });
  }
  private selfX = 0; private selfZ = 0;
  /** where I am (for a wave that comes for a swimmer) */
  setSelf(x: number, z: number) { this.selfX = x; this.selfZ = z; }
  /** after the wreck: no storm, no wave, ready to go again */
  reset() {
    this.storm = 0; this.fullT = 0; this.warned = 0; this.waveMine = false; this.waveFor = null;
    this.wave.active = false; this.wave.mesh.visible = false;
  }

  // -------------------------------------------------------------- building on a raft
  /**
   * What the building plan would build on a raft I'm looking at (a piece of the kind `kind`), or null when no raft is in
   * view. `face`: which way I'm facing (a staircase climbs that way).
   */
  raftAim(kind: PieceKind, eye: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, face: number, max = 7): RaftAim | null {
    let best: RaftAim | null = null, near: { b: Boat; t: number } | null = null;
    for (const b of this.list) {
      const rf = b.raft;
      if (!rf || Math.hypot(b.x - eye.x, b.z - eye.z) > max + rf.rad + 3) continue;
      const p = pose(b), o = toLocal(p, eye.x, eye.y, eye.z, L1).clone(), d = toLocal(p, eye.x + dir.x, eye.y + dir.y, eye.z + dir.z, L2).sub(o);
      const plane = (h: number) => { if (Math.abs(d.y) < 1e-4) return null; const t = (h - o.y) / d.y; return t > 0.2 && t < max ? { t, x: o.x + d.x * t, z: o.z + d.z * t } : null; };
      const cand = (pc: RaftPiece, t: number, ok: boolean, reason = '') => { if (!best || (ok && !best.ok) || (ok === best.ok && t < best.t)) best = { b, p: pc, ok, reason, t }; };
      // (is the raft in view at all: the ray passes over or near it)
      for (let L = 0; L <= RAFT_LEVELS; L++) {
        const h = plane(RDECK + L * RWH);
        if (h && rf.nearest(h.x, h.z, 0)[2] < RC && (!near || h.t < near.t)) near = { b, t: h.t };
      }
      const cell = (x: number, z: number) => [Math.round(x / RC), Math.round(z / RC)];
      if (kind === 'pool') continue;
      if (kind === 'foundation') {
        const h = plane(RDECK); if (!h) continue;
        let [i, j] = cell(h.x, h.z);
        if (rf.tile(i, j)) {
          // looking at a section already there: the next one out, on the side you are looking at
          const fx = h.x / RC - i, fz = h.z / RC - j;
          if (Math.abs(fx) > Math.abs(fz)) i += Math.sign(fx); else j += Math.sign(fz);
          if (rf.tile(i, j)) continue;
        }
        const nb = rf.tile(i - 1, j) || rf.tile(i + 1, j) || rf.tile(i, j - 1) || rf.tile(i, j + 1);
        if (!nb) continue;
        if (rf.tiles.size >= RAFT_TILES) cand(['t', i, j], h.t, false, `A raft can have ${RAFT_TILES} sections at most`);
        else if (!raftAfloat(rf, b.x, b.z, b.yaw, 0.4, [i, j])) cand(['t', i, j], h.t, false, 'Too shallow there');
        else if (this.list.some((o) => o !== b && Math.hypot(o.x - b.x, o.z - b.z) < reach(o) + Math.hypot(i * RC, j * RC) + RC)) cand(['t', i, j], h.t, false, 'Too close to another boat');
        else cand(['t', i, j], h.t, true);
      } else if (kind === 'floor') {
        for (let L = 1; L <= RAFT_LEVELS; L++) for (const h of [plane(RDECK + L * RWH), plane(RDECK + (L - 1) * RWH)]) {
          if (!h) continue;
          const [i, j] = cell(h.x, h.z);
          if (!rf.tile(i, j) || rf.floors.has(`${i},${j},${L}`)) continue;
          if (L > 1 && !rf.floors.has(`${i},${j},${L - 1}`)) continue;
          if (rf.stairs.has(`${i},${j},${L - 1}`)) cand(['f', i, j, L], h.t, false, 'Leave the floor above stairs open');
          else cand(['f', i, j, L], h.t, true);
        }
      } else if (kind === 'stairs') {
        const lf = face - b.yaw, fx = -Math.sin(lf), fz = -Math.cos(lf);
        let dd = 0, bd = -2;
        STAIR_DIRS.forEach(([x, z], k) => { const v = x * fx + z * fz; if (v > bd) { bd = v; dd = k; } });
        for (let L = 0; L < RAFT_LEVELS; L++) {
          const h = plane(RDECK + L * RWH); if (!h) continue;
          const [i, j] = cell(h.x, h.z);
          if (!rf.floor(i, j, L) || rf.stairs.has(`${i},${j},${L}`)) continue;
          if (rf.floors.has(`${i},${j},${L + 1}`)) cand(['s', i, j, L, dd], h.t, false, 'There is a floor right above');
          else cand(['s', i, j, L, dd], h.t, true);
        }
      } else {
        for (let L = 0; L < RAFT_LEVELS; L++) {
          const h = plane(RDECK + L * RWH); if (!h) continue;
          const [i, j] = cell(h.x, h.z), fx = h.x / RC - i, fz = h.z / RC - j;
          const pc: RaftPiece = Math.abs(fx) > Math.abs(fz) ? ['e', 'z', i + (fx > 0 ? 1 : 0), j, L, kind] : ['e', 'x', i, j + (fz > 0 ? 1 : 0), L, kind];
          const [ii, jj] = [pc[2], pc[3]], other = pc[1] === 'x' ? [ii, jj - 1] : [ii - 1, jj];
          if (!rf.floor(ii, jj, L) && !rf.floor(other[0], other[1], L)) continue;
          if (rf.has(pc)) cand(pc, h.t, false, 'Something is there already');
          else cand(pc, h.t, true);
        }
      }
    }
    if (!best && near) {
      const nb = (near as { b: Boat; t: number });
      return { b: nb.b, p: ['t', 0, 0], ok: false, reason: kind === 'pool' ? 'No pools on a raft' : kind === 'foundation' ? 'Aim at the edge of the raft' : 'Can’t build that there', t: nb.t };
    }
    return best;
  }
  /** show (or hide: null) the piece the building plan would put on a raft */
  showRaftGhost(a: RaftAim | null) {
    if (!a || (a.p[0] === 't' && !a.ok && a.p[1] === 0 && a.p[2] === 0)) { if (this.pieceGhost) this.pieceGhost.visible = false; return; }
    const key = JSON.stringify(a.p);
    if (key !== this.pieceGhostKey) {
      if (this.pieceGhost) { this.scene.remove(this.pieceGhost); }
      this.pieceGhost = makeRaft(a.b.raft!, false, this.ghostMat, a.p);
      this.pieceGhostKey = key;
      this.scene.add(this.pieceGhost);
    }
    const g = this.pieceGhost!;
    g.visible = true;
    g.position.copy(a.b.group.position); g.rotation.copy(a.b.group.rotation);
    (this.ghostMat as THREE.MeshBasicMaterial).color.set(a.ok ? 0x7cff9a : 0xff6a5a);
  }
  /** build it */
  raftPlace(a: RaftAim) {
    const b = a.b; if (!b.raft || !a.ok) return;
    b.raft.put(a.p); this.remodel(b);
    this.pieceGhostKey = '';
    this.onEvent?.({ op: 'rp', n: b.nid, a: 1, p: a.p });
  }
  /** the raft piece I'm looking at (to take down), or null */
  raftFind(eye: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, max: number): { b: Boat; p: RaftPiece; dist: number } | null {
    let best: { b: Boat; p: RaftPiece; dist: number } | null = null;
    for (const b of this.list) {
      const rf = b.raft;
      if (!rf || Math.hypot(b.x - eye.x, b.z - eye.z) > max + rf.rad) continue;
      const p = pose(b), o = toLocal(p, eye.x, eye.y, eye.z, L1).clone(), d = toLocal(p, eye.x + dir.x, eye.y + dir.y, eye.z + dir.z, L2).sub(o);
      const hit = (lo: number[], hi: number[]) => {
        let t0 = 0, t1 = max; const oo = [o.x, o.y, o.z], dd = [d.x, d.y, d.z];
        for (let k = 0; k < 3; k++) {
          if (Math.abs(dd[k]) < 1e-6) { if (oo[k] < lo[k] || oo[k] > hi[k]) return -1; continue; }
          let a = (lo[k] - oo[k]) / dd[k], c = (hi[k] - oo[k]) / dd[k]; if (a > c) [a, c] = [c, a];
          t0 = Math.max(t0, a); t1 = Math.min(t1, c);
        }
        return t0 <= t1 ? t0 : -1;
      };
      const take = (pc: RaftPiece, t: number) => { if (t >= 0 && (!best || t < best.dist)) best = { b, p: pc, dist: t }; };
      for (const pc of rf.list()) {
        if (pc[0] === 'd') continue;
        const h = RC / 2;
        if (pc[0] === 't') { const x = pc[1] * RC, z = pc[2] * RC; take(pc, hit([x - h, -0.4, z - h], [x + h, RDECK, z + h])); }
        else if (pc[0] === 'f') { const x = pc[1] * RC, z = pc[2] * RC, y = RDECK + pc[3] * RWH; take(pc, hit([x - h, y - 0.35, z - h], [x + h, y, z + h])); }
        else if (pc[0] === 's') { const x = pc[1] * RC, z = pc[2] * RC, y = RDECK + pc[3] * RWH; take(pc, hit([x - h + 0.15, y, z - h + 0.15], [x + h - 0.15, y + RWH * 0.6, z + h - 0.15])); }
        else {
          const [, ax, i, j, L, kind] = pc, y0 = RDECK + L * RWH, y1 = y0 + (kind === 'railing' ? RAIL_H : RWH);
          if (ax === 'x') { const z = (j - 0.5) * RC, x = i * RC; take(pc, hit([x - h, y0, z - 0.2], [x + h, y1, z + 0.2])); }
          else { const x = (i - 0.5) * RC, z = j * RC; take(pc, hit([x - 0.2, y0, z - h], [x + 0.2, y1, z + h])); }
        }
      }
    }
    return best;
  }
  /** why a raft piece can't come down yet (null: it can) */
  raftCanRemove(b: Boat, pc: RaftPiece): string | null {
    const rf = b.raft; if (!rf) return 'Not a raft';
    if (pc[0] === 't') {
      const [, i, j] = pc;
      if (rf.tiles.size <= 1) return 'Pack the whole raft up instead (hold E on it from the water)';
      if (b.helm !== null) return 'Not while somebody is at the oar';
      if (rf.floors.has(`${i},${j},1`) || rf.stairs.has(`${i},${j},0`)) return 'Take down what is built on it first';
      for (const [k] of rf.edges) {
        const [ii, jj, L] = k.slice(1).split(',').map(Number), other = k[0] === 'x' ? [ii, jj - 1] : [ii - 1, jj];
        const mine = (ii === i && jj === j) || (other[0] === i && other[1] === j);
        if (!mine || L > 0) continue;
        const keep = ii === i && jj === j ? rf.tile(other[0], other[1]) : rf.tile(ii, jj);
        if (!keep) return 'Take its walls and railings down first';
      }
      // (the rest must still hang together)
      const left = [...rf.tiles].filter((k) => k !== `${i},${j}`), seen = new Set([left[0]]), q = [left[0]];
      while (q.length) { const [a, c] = q.pop()!.split(',').map(Number); for (const n of [`${a + 1},${c}`, `${a - 1},${c}`, `${a},${c + 1}`, `${a},${c - 1}`]) if (left.includes(n) && !seen.has(n)) { seen.add(n); q.push(n); } }
      if (seen.size !== left.length) return 'That would cut the raft in two';
    } else if (pc[0] === 'e' && rf.doors.has(Raft.key(pc))) {
      return 'Take the door out first';
    } else if (pc[0] === 'f') {
      const [, i, j, L] = pc;
      if (rf.floors.has(`${i},${j},${L + 1}`) || rf.stairs.has(`${i},${j},${L}`)) return 'Take down what is built on it first';
      for (const [k] of rf.edges) {
        const [ii, jj, LL] = k.slice(1).split(',').map(Number); if (LL !== L) continue;
        const other = k[0] === 'x' ? [ii, jj - 1] : [ii - 1, jj];
        const a = ii === i && jj === j, c = other[0] === i && other[1] === j;
        if ((a && !rf.floor(other[0], other[1], L)) || (c && !rf.floor(ii, jj, L))) return 'Take down the walls on it first';
      }
    }
    return null;
  }
  raftRemove(b: Boat, pc: RaftPiece, remote = false) {
    if (!b.raft) return;
    b.raft.del(pc); this.remodel(b);
    if (!remote) this.onEvent?.({ op: 'rp', n: b.nid, a: 0, p: pc });
  }
  /** what a raft is worth in wood beyond the raft itself (the pieces built on it, at the building plan's prices) */
  raftPieces(b: Boat): RaftPiece[] { return b.raft ? b.raft.list().filter((p) => !(p[0] === 't' && p[1] === 0 && p[2] === 0)) : []; }

  /** hang a door in a raft's doorway, open or shut one (state 0 shut, +1 / -1 open), or take it out (null) */
  raftDoor(b: Boat, key: string, state: number | null) {
    const rf = b.raft; if (!rf || rf.edges.get(key) !== 'doorway') return;
    const ax = key[0] as 'x' | 'z', [i, j, L] = key.slice(1).split(',').map(Number), had = rf.doors.has(key);
    const pc: RaftPiece = ['d', ax, i, j, L, state ?? 0];
    if (state === null) { if (!had) return; rf.del(pc); this.remodel(b); this.onEvent?.({ op: 'rp', n: b.nid, a: 0, p: pc }); return; }
    rf.put(pc);
    if (had) rf.refresh(); else this.remodel(b);
    this.onEvent?.({ op: 'rp', n: b.nid, a: 1, p: pc });
  }
  /** which way a raft's door swings open, away from someone at (x, y, z) */
  raftDoorSwing(b: Boat, key: string, x: number, y: number, z: number) {
    const l = toLocal(pose(b), x, y, z, L1), [i, j] = key.slice(1).split(',').map(Number);
    return (key[0] === 'x' ? Math.sign(l.z - (j - 0.5) * RC) : Math.sign(l.x - (i - 0.5) * RC)) >= 0 ? 1 : -1;
  }
  /** a plain wall of a raft I'm looking at, for hanging a picture: where on it (raft space, and in the world for the preview) */
  raftWall(eye: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, max: number, fw: number, fh: number): { b: Boat; key: string; kind: string; dist: number; l: [number, number, number, number]; w: { x: number; y: number; z: number; yaw: number } } | null {
    const h = this.raftFind(eye, dir, max);
    if (!h || h.p[0] !== 'e') return null;
    const [, ax, i, j, L, kind] = h.p, b = h.b, p = pose(b), o = toLocal(p, eye.x, eye.y, eye.z, L1).clone(), d = toLocal(p, eye.x + dir.x, eye.y + dir.y, eye.z + dir.z, L2).sub(o);
    const hx = o.x + d.x * h.dist, hy = o.y + d.y * h.dist, hz = o.z + d.z * h.dist, y0 = RDECK + L * RWH;
    let lx: number, lz: number, yaw: number;
    if (ax === 'x') { const ez = (j - 0.5) * RC, front = o.z > ez; lz = ez + (front ? 0.1 : -0.1); yaw = front ? 0 : Math.PI; lx = Math.max(i * RC - RC / 2 + fw / 2 + 0.05, Math.min(i * RC + RC / 2 - fw / 2 - 0.05, hx)); }
    else { const ex = (i - 0.5) * RC, front = o.x > ex; lx = ex + (front ? 0.1 : -0.1); yaw = front ? Math.PI / 2 : -Math.PI / 2; lz = Math.max(j * RC - RC / 2 + fw / 2 + 0.05, Math.min(j * RC + RC / 2 - fw / 2 - 0.05, hz)); }
    const ly = Math.max(y0 + fh / 2 + 0.25, Math.min(y0 + RWH - fh / 2 - 0.1, hy));
    const w = toWorld(p, lx, ly, lz, new THREE.Vector3());
    return { b, key: Raft.key(h.p), kind, dist: h.dist, l: [lx, ly, lz, yaw], w: { x: w.x, y: w.y, z: w.z, yaw: b.yaw + yaw } };
  }
  /** where a picture on a raft's wall is now: false once that wall (or the raft) is gone */
  raftWallWorld(n: string, key: string, l: [number, number, number, number], out: { x: number; y: number; z: number; yaw: number; q: THREE.Quaternion }) {
    const b = this.byId(n);
    return !!b?.raft && b.raft.edges.get(key) === 'wall' && this.deckWorld(n, l, out);
  }
  /** the tops of rafts' railing posts (a torch stands on one), in the world */
  raftRailPosts(): { x: number; y: number; z: number }[] {
    const out: { x: number; y: number; z: number }[] = [];
    for (const b of this.list) {
      if (!b.raft) continue;
      const p = pose(b);
      for (const [k, kind] of b.raft.edges) {
        if (kind !== 'railing') continue;
        const [i, j, L] = k.slice(1).split(',').map(Number), y = RDECK + L * RWH + RAIL_H + 0.11;
        const ends = k[0] === 'x' ? [[i * RC - RC / 2, (j - 0.5) * RC], [i * RC + RC / 2, (j - 0.5) * RC]] : [[(i - 0.5) * RC, j * RC - RC / 2], [(i - 0.5) * RC, j * RC + RC / 2]];
        for (const [x, z] of ends) { const w = toWorld(p, x, y, z, new THREE.Vector3()); if (!out.some((q) => Math.hypot(q.x - w.x, q.z - w.z) < 0.05 && Math.abs(q.y - w.y) < 0.05)) out.push({ x: w.x, y: w.y, z: w.z }); }
      }
    }
    return out;
  }
  /** the underside of a raft's upper floor above (x, y, z) (a lantern hangs from it), or null */
  raftCeiling(x: number, y: number, z: number): number | null {
    for (const b of this.list) {
      if (!b.raft || Math.hypot(b.x - x, b.z - z) > b.raft.rad + 1) continue;
      const p = pose(b), l = toLocal(p, x, y, z, L1), i = Math.round(l.x / RC), j = Math.round(l.z / RC);
      if (!b.raft.tile(i, j)) continue;
      for (let L = 1; L <= RAFT_LEVELS; L++) {
        const under = RDECK + L * RWH - 0.16;
        if (under > l.y + 0.3 && b.raft.floors.has(`${i},${j},${L}`)) return toWorld(p, l.x, under, l.z, L2).y;
      }
    }
    return null;
  }
  /** would something round (radius r, standing at y) bump into a raft's walls? */
  raftTouches(x: number, z: number, r: number, y: number): boolean {
    for (const b of this.list) {
      if (!b.raft || Math.hypot(b.x - x, b.z - z) > b.raft.rad + r + 1) continue;
      const l = toLocal(pose(b), x, y, z, L1);
      for (const bx of b.raft.boxes) {
        if (bx.y1 < l.y + 0.1 || bx.y0 > l.y + 1.6) continue;
        const cx = Math.max(bx.x0, Math.min(l.x, bx.x1)), cz = Math.max(bx.z0, Math.min(l.z, bx.z1));
        if (Math.hypot(l.x - cx, l.z - cz) < r) return true;
      }
    }
    return false;
  }

  // -------------------------------------------------------------- a raft after the giant wave
  /** washed back near the island: out from the beach the way it went, in water deep enough for all of it, bow to the sea */
  respawnRaft(b: Boat, remote = false) {
    const rf = b.raft; if (!rf) return;
    const a0 = Math.round(Math.atan2(b.z, b.x) * 8) / 8;
    let at: [number, number, number] | null = null;
    for (const da of [0, 0.2, -0.2, 0.4, -0.4, 0.7, -0.7, 1.0, -1.0, 1.4, -1.4, 1.9, -1.9, 2.5, -2.5, 3.1]) {
      const a = a0 + da, ux = Math.cos(a), uz = Math.sin(a), yaw = Math.atan2(-ux, -uz);
      for (let r = 40; r < 300; r += 4) {
        if (!raftAfloat(rf, ux * r, uz * r, yaw, 1.2)) continue;
        // well clear of the shallows: a little further out than the first spot it floats
        const R = r + 10 + rf.rad, x = ux * R, z = uz * R;
        if (R < STORM_R0 - 40 && raftAfloat(rf, x, z, yaw, 1.5) && !this.list.some((o) => o !== b && Math.hypot(o.x - x, o.z - z) < reach(o) + rf.rad + 3)) at = [x, z, yaw];
        break;
      }
      if (at) break;
    }
    if (!at) { const a = a0, R = 260; at = [Math.cos(a) * R, Math.sin(a) * R, Math.atan2(-Math.cos(a), -Math.sin(a))]; }
    this.warp(b, at[0], at[1], at[2]);
    if (!remote) this.onEvent?.({ op: 'warp', n: b.nid, x: +at[0].toFixed(2), z: +at[1].toFixed(2), r: +at[2].toFixed(3) });
  }
  private warp(b: Boat, x: number, z: number, yaw: number) {
    b.x = b.tx = x; b.z = b.tz = z; b.yaw = b.tyaw = yaw; b.v = b.tv = 0; b.yawV = 0; b.lift = 0; b.pitch = b.roll = 0;
    b.doomed = false; b.helm = null;
    b.y = this.surface(x, z);
    if (this.on === b) { this.on = null; this.atHelm = false; }
    if (this.waveFor === b) this.waveFor = null;
    for (const [id, r] of this.riders) if (r.b === b) this.riders.delete(id);
    this.place(b);
  }

  // -------------------------------------------------------------- network
  net(e: Record<string, any>, from: number) {
    const b = typeof e.n === 'string' ? this.byId(e.n) : null;
    switch (e.op) {
      case 'add': if (!b && Number.isFinite(+e.x) && Number.isFinite(+e.z)) this.add(e.n, +e.x, +e.z, +e.r || 0, true, Array.isArray(e.p) ? e.p : undefined); break;
      case 'rp': if (b?.raft && Array.isArray(e.p)) {
        const pc = e.p as RaftPiece;
        // (a door opening or shutting: just swing it)
        if (pc[0] === 'd' && e.a && b.raft.doors.has(Raft.key(pc))) { b.raft.put(pc); b.raft.refresh(); break; }
        if (e.a) b.raft.put(pc); else b.raft.del(pc);
        this.remodel(b);
      } break;
      case 'warp': if (b && Number.isFinite(+e.x) && Number.isFinite(+e.z)) this.warp(b, +e.x, +e.z, +e.r || 0); break;
      case 'del': if (b) this.remove(b, true); break;
      case 'helm': {
        if (!b) break;
        if (e.on) {
          // both of us took the wheel at once: the lower id keeps it
          if (b.helm === this.myId && this.atHelm && this.on === b) { if (this.myId < from) { this.onEvent?.({ op: 'helm', n: b.nid, on: 1 }); break; } this.atHelm = false; this.say?.('Somebody else has the wheel'); }
          b.helm = from;
        } else if (b.helm === from) b.helm = null;
        break;
      }
      case 'on': if (b && [e.x, e.y, e.z].every((v: unknown) => Number.isFinite(+(v as number)))) this.riders.set(from, { b, x: +e.x, y: +e.y, z: +e.z, r: +e.r || 0, t: this.clock }); break;
      case 'off': this.riders.delete(from); break;
      case 'mv': if (b && !(b === this.on && this.atHelm)) { b.tx = +e.x; b.tz = +e.z; b.tyaw = +e.r; b.tv = +e.v || 0; } break;
      case 'wave': if (b && !b.doomed) this.bringWave(true, b); break;
    }
  }

  // -------------------------------------------------------------- save
  capture(): BoatRow[] { return this.list.filter((b) => !b.doomed || b.raft).map((b) => ({ n: b.nid, x: +b.x.toFixed(2), z: +b.z.toFixed(2), r: +b.yaw.toFixed(3), ...(b.raft ? { p: b.raft.list() } : {}) })); }
  restore(rows: BoatRow[] | undefined) {
    for (const b of [...this.list]) this.remove(b, true);
    if (Array.isArray(rows)) for (const r of rows) if (r && typeof r.n === 'string') this.add(r.n, +r.x, +r.z, +r.r || 0, true, Array.isArray(r.p) ? r.p : undefined);
  }
}
