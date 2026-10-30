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
import { heightAt } from './island';

let WOOD: { slab: THREE.Material } | null = null;
const woodMaterials = () => (WOOD ??= { slab: new THREE.MeshStandardMaterial({ name: 'woodSlab' }) });
const glassMaterial = () => new THREE.MeshStandardMaterial({ name: 'glass', color: '#cfe8f0', transparent: true, opacity: 0.3 });
/** a position (Babylon's Vector3 here) */
interface PV { x: number; y: number; z: number; set(x: number, y: number, z: number): unknown }

/** distance from the middle of the island where the storm starts, where it is at full force, and where the wave comes regardless */
export const STORM_R0 = 360, STORM_R1 = 430, WRECK_R = 560;
/** how long you can stay out in the full storm before the big wave finds you (s) */
const STORM_HOLD = 70;
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

export interface BoatRow { n: string; x: number; z: number; r: number }

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
const _tw = new THREE.Vector3();
/** and back (the exact inverse) */
function toLocal(p: Pose, x: number, y: number, z: number, out: THREE.Vector3) {
  tmpE.set(p.pitch, p.yaw, p.roll); tmpQ.setFromEuler(tmpE).invert();
  return out.set(x - p.x, y - p.y, z - p.z).applyQuaternion(tmpQ);
}
const pose = (b: Boat): Pose => ({ x: b.x, y: b.y + b.lift, z: b.z, yaw: b.yaw, pitch: b.pitch, roll: b.roll });
const L1 = new THREE.Vector3(), L2 = new THREE.Vector3();

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
  readonly wave: Wave;
  private waveFor: Boat | null = null;   // the boat (or null: just me, swimming) the wave is coming for
  private waveMine = false;              // ... and it will hit me
  private roarT = 0;
  private mvT = 0;
  private onT = 0;
  private sndT = 0;
  private lastYaw = NaN;
  private ghost: THREE.Group;
  private ghostMat = new THREE.MeshBasicMaterial({ color: 0x7cff9a, transparent: true, opacity: 0.35, depthWrite: false });
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
  aim(eye: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, yaw: number): { ok: boolean; why: string; x: number; z: number; yaw: number } {
    const out = { ok: false, why: '', x: 0, z: 0, yaw };
    if (this.list.length >= MAX) { out.why = `There are ${MAX} boats already`; return out; }
    const hl = Math.hypot(dir.x, dir.z) || 1, hx = dir.x / hl, hz = dir.z / hl;
    // looking at (or near) the horizon still works: the boat goes 9 m out
    const t = dir.y < -0.05 ? Math.max(3, Math.min(30, eye.y / -dir.y)) * hl : 9;
    const bx = eye.x + hx * t, bz = eye.z + hz * t;
    out.x = bx; out.z = bz;
    if (t > 30) { out.why = 'Too far away'; return out; }
    const fits = (x: number, z: number, r: number) => heightAt(x, z) < -0.3 && this.afloat(x, z, r, 0.95) && !this.list.some((b) => Math.hypot(b.x - x, b.z - z) < 12)
      && Math.hypot(x - eye.x, z - eye.z) > 3;
    const yaws = [yaw, yaw + Math.PI / 2, yaw + Math.PI / 4, yaw - Math.PI / 4];
    for (let step = 0; step <= 14; step++) {
      for (const side of step === 0 ? [0] : [0, -1, 1]) {
        const x = bx + hx * step * 2 - hz * side * step * 1.2, z = bz + hz * step * 2 + hx * side * step * 1.2;
        for (const r of yaws) if (fits(x, z, r)) { out.x = x; out.z = z; out.yaw = r; out.ok = true; return out; }
      }
    }
    out.why = heightAt(bx, bz) > -0.05 ? 'Boats go on the water: aim at the sea' : this.list.some((b) => Math.hypot(b.x - bx, b.z - bz) < 12) ? 'Another boat is in the way' : 'Too shallow here: aim a bit further out';
    return out;
  }
  showGhost(a: { ok: boolean; x: number; z: number; yaw: number } | null, time = 0) {
    this.ghost.visible = !!a && a.x !== 0;
    if (!a || !this.ghost.visible) return;
    this.ghost.position.set(a.x, this.surface(a.x, a.z) + 0.05 * Math.sin(time * 2), a.z);
    this.ghost.rotation.set(0, a.yaw, 0);
    (this.ghostMat as THREE.MeshBasicMaterial).color.set(a.ok ? 0x7cff9a : 0xff6a5a);
  }

  add(nid: string, x: number, z: number, yaw: number, remote = false): Boat | null {
    if (this.list.some((b) => b.nid === nid)) return null;
    const b = new Boat(nid, x, z, yaw);
    b.group = makeModel(null, this.shadows, b);
    b.y = this.surface(x, z);
    this.place(b);
    this.scene.add(b.group);
    this.list.push(b);
    if (!remote) this.onEvent?.({ op: 'add', n: nid, x: +x.toFixed(2), z: +z.toFixed(2), r: +yaw.toFixed(3) });
    return b;
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
  /** somebody aboard? (me, or anyone whose deck position we heard lately) */
  aboard(b: Boat) { return this.on === b || [...this.riders.values()].some((r) => r.b === b && this.clock - r.t < 2); }

  // -------------------------------------------------------------- walking on deck
  /** the deck under (x, z) a walker at height y can stand on (the highest boat's), or -1e9 */
  ground(x: number, z: number, y = 1e9): number {
    let best = -1e9;
    for (const b of this.list) {
      if (Math.abs(x - b.x) > 7 || Math.abs(z - b.z) > 7) continue;
      const p = pose(b), l = toLocal(p, x, y, z, L1);
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
      if (Math.abs(x - b.x) > 8 || Math.abs(z - b.z) > 8) continue;
      const p = pose(b), l = toLocal(p, x, feetY, z, L1);
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
  /** which boat (if any) someone at (x, y, z) is standing or jumping on */
  private boatUnder(x: number, y: number, z: number): Boat | null {
    for (const b of this.list) {
      if (Math.abs(x - b.x) > 7 || Math.abs(z - b.z) > 7) continue;
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
      if (Math.hypot(b.x - eye.x, b.z - eye.z) > max + 7) continue;
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
  /** climb aboard from the water (or a jetty): onto the nearest bit of deck. Sets the feet `pos`. */
  board(b: Boat, pos: PV, vel: PV) {
    const p = pose(b), l = toLocal(p, pos.x, pos.y, pos.z, L1);
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
    toWorld(pose(b), 0, DECK + HELM_UP, HELM_Z, pos);
    if (!Number.isNaN(this.lastYaw)) { let d = b.yaw - this.lastYaw; d = Math.atan2(Math.sin(d), Math.cos(d)); look.yaw += d; }
    this.lastYaw = b.yaw;
    return true;
  }
  /** multiplayer: where a remote player on a deck is (their avatar rides the boat, not their own laggy position packets) */
  deckOf(id: number, out: { x: number; y: number; z: number; yaw: number }): boolean {
    const r = this.riders.get(id);
    if (!r || this.clock - r.t > 1.5 || !this.list.includes(r.b)) return false;
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
    const want = Math.max(0, Math.min(1, (r - STORM_R0) / (STORM_R1 - STORM_R0)));
    // (it builds over half a minute or so: the sky darkens, the rain comes on, the waves grow)
    this.storm += (want - this.storm) * Math.min(1, dt / (want > this.storm ? 22 : 6));
    if (this.storm > 0.85) this.fullT += dt; else this.fullT = Math.max(0, this.fullT - dt * 0.5);
    if (this.storm > 0.1 && this.warned < 1) { this.warned = 1; this.say?.('The sky is turning black out here…'); }
    if (this.storm > 0.6 && this.warned < 2) { this.warned = 2; this.say?.('This is no sea for a little boat. Turn back!'); }
    if (this.storm < 0.02) this.warned = 0;
    if (!this.wave.active && !away && (r > WRECK_R || this.fullT > STORM_HOLD)) this.bringWave();

    // ---- which deck am I on (before the boats move: I ride along with mine)
    const was = this.on;
    if (!this.atHelm) this.on = free && !away ? this.boatUnder(me.x, me.y, me.z) : null;
    const ride = this.on && !this.atHelm ? toLocal(pose(this.on), me.x, me.y, me.z, new THREE.Vector3()) : null;
    const yaw0 = this.on ? this.on.yaw : 0;

    for (const b of this.list) {
      if (b.helm !== null && b.helm !== this.myId && !this.present(b.helm)) b.helm = null;
      const mine = b === this.on && this.atHelm;
      if (mine) this.drive(b, dt, time, ctl);
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
    const maxV = ctl.boost ? 9.5 : 7;
    const want = ctl.y >= 0 ? ctl.y * maxV : ctl.y * 2;
    b.v += (want - b.v) * Math.min(1, dt * (Math.abs(want) > Math.abs(b.v) ? 0.3 : 0.6));
    const turn = -ctl.x * 0.5 * Math.min(1, 0.3 + Math.abs(b.v) / 4) * (b.v < -0.1 ? -1 : 1);
    b.yawV += (turn - b.yawV) * Math.min(1, dt * 2);
    const st = this.storm;
    if (st > 0) { b.yawV += st * Math.sin(time * 0.9 + Math.sin(time * 0.37) * 2) * 0.35 * dt; b.v -= st * 0.5 * dt * Math.sign(b.v); }
    b.yaw += b.yawV * dt;
    const nx = b.x - Math.sin(b.yaw) * b.v * dt, nz = b.z - Math.cos(b.yaw) * b.v * dt;
    const clear = this.afloat(nx, nz, b.yaw, 0.9) && Math.hypot(nx, nz) < WRECK_R + 60 && !this.list.some((o) => o !== b && Math.hypot(o.x - nx, o.z - nz) < 10);
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
  lights() { return this.list.map((b) => b.torch); }

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

  // -------------------------------------------------------------- network
  net(e: Record<string, any>, from: number) {
    const b = typeof e.n === 'string' ? this.byId(e.n) : null;
    switch (e.op) {
      case 'add': if (!b && Number.isFinite(+e.x) && Number.isFinite(+e.z)) this.add(e.n, +e.x, +e.z, +e.r || 0, true); break;
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
  capture(): BoatRow[] { return this.list.filter((b) => !b.doomed).map((b) => ({ n: b.nid, x: +b.x.toFixed(2), z: +b.z.toFixed(2), r: +b.yaw.toFixed(3) })); }
  restore(rows: BoatRow[] | undefined) {
    for (const b of [...this.list]) this.remove(b, true);
    if (Array.isArray(rows)) for (const r of rows) if (r && typeof r.n === 'string') this.add(r.n, +r.x, +r.z, +r.r || 0, true);
  }
}
