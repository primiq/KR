// The player model: a jointed, detailed low-poly castaway. Every body part is merged into one vertex-coloured mesh per
// bone (so a whole player is ~25 draw calls) and each player gets a stable, different look derived from their id.
//
// Conventions (same as the camera): the character stands with its feet on y = 0 and FACES -Z. Its right hand is +X.
// Joint rotations: a positive rotation about X swings a hanging limb FORWARD (toward -Z).
// Ported from Castaway; drawn by render/mirror.ts (the 'body' material is a vertex-coloured PBR material there).
import * as THREE from 'three';
import { mulberry32 } from '../core/noise';
import { ITEMS } from '../game/items';
import { FLOWERS } from '../world/flowerKinds';

export const HIP_Y = 0.92, BODY_Y = 1.17, HEAD_Y = 1.635, TAG_Y = 2.12, HEAD_S = 1.4, SH_Y = 1.37, SH_X = 0.26;
export const THIGH = 0.44, SHIN = 0.42, UPPER = 0.28, FORE = 0.26;

// ------------------------------------------------------------------ merged, vertex-coloured geometry
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

export class Mesher {
  private pos: number[] = []; private nor: number[] = []; private col: number[] = [];
  private c = new THREE.Color();
  add(g: THREE.BufferGeometry, color: THREE.ColorRepresentation, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    const geo = g.index ? g.toNonIndexed() : g;
    _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e); _p.set(x, y, z); _s.set(sx, sy, sz);
    geo.applyMatrix4(_m.compose(_p, _q, _s));
    const P = geo.attributes.position, N = geo.attributes.normal;
    this.c.set(color);
    for (let i = 0; i < P.count; i++) {
      this.pos.push(P.getX(i), P.getY(i), P.getZ(i));
      this.nor.push(N.getX(i), N.getY(i), N.getZ(i));
      this.col.push(this.c.r, this.c.g, this.c.b);
    }
    if (geo !== g) geo.dispose();
    g.dispose();
  }
  box(w: number, h: number, d: number, color: THREE.ColorRepresentation, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) { this.add(new THREE.BoxGeometry(w, h, d), color, x, y, z, rx, ry, rz); }
  cyl(rt: number, rb: number, h: number, color: THREE.ColorRepresentation, x = 0, y = 0, z = 0, sx = 1, sz = 1, seg = 10, rx = 0, ry = 0, rz = 0) {
    this.add(new THREE.CylinderGeometry(rt, rb, h, seg), color, x, y, z, rx, ry, rz, sx, 1, sz);
  }
  sph(r: number, color: THREE.ColorRepresentation, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, seg = 10, rx = 0, ry = 0, rz = 0) {
    this.add(new THREE.SphereGeometry(r, seg, Math.max(5, Math.round(seg * 0.75))), color, x, y, z, rx, ry, rz, sx, sy, sz);
  }
  /** upper cap of a sphere (hair, hats) */
  cap(r: number, color: THREE.ColorRepresentation, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, theta = Math.PI * 0.55, rx = 0) {
    this.add(new THREE.SphereGeometry(r, 14, 8, 0, Math.PI * 2, 0, theta), color, x, y, z, rx, 0, 0, sx, sy, sz);
  }
  build(shadows: boolean): THREE.Mesh {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    const m = new THREE.Mesh(g, bodyMaterial());
    m.castShadow = shadows; m.frustumCulled = false;
    return m;
  }
}

let MAT: THREE.MeshBasicMaterial | null = null;
export function bodyMaterial() {
  if (MAT) return MAT;
  MAT = new THREE.MeshBasicMaterial({ name: 'body', vertexColors: true });
  return MAT;
}

const tone = (hex: string, k: number) => '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();
const mix = (a: string, b: string, t: number) => '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();

// ------------------------------------------------------------------ looks
export interface Look {
  skin: string; hair: string; hairStyle: number; eye: string;
  shirt: string; shirtStyle: number; pants: string; pantsStyle: number; shoe: string; shoeStyle: number;
  beard: boolean; hat: number; glasses: boolean; pack: number; accent: string; canvas: string; scarf: boolean; smile: number;
}
export const SKINS = ['#f3d2ae', '#e8b88c', '#d29a6a', '#b07746', '#855230', '#5e3a22'];
export const HAIRS = ['#17120e', '#35261b', '#5b3a24', '#8a4b24', '#c89a4e', '#dac58a', '#b9b4ab', '#a02f1c'];
export const PANTS = ['#3b4a58', '#5a4a36', '#4b5a3a', '#2f3b4e', '#6b5b45', '#44484f', '#7b6a4c', '#c9b99a'];
export const SHIRTS = ['#d9534f', '#3f8fd2', '#e0a33a', '#59a869', '#9b6ad0', '#e07aa6', '#37a7a0', '#c5693a', '#f2f0e8', '#2f3a4a', '#7b9a3c', '#26262a'];
const ACCENTS = ['#e8c34a', '#d9534f', '#3f8fd2', '#f0efe6', '#59a869', '#e07a3a'];
const CANVAS = ['#9a8a62', '#7a8458', '#8a6a48', '#6e7480'];
const EYES = ['#3a2a1e', '#2d5a8a', '#3f7a4a', '#6a4a2a', '#5a6a72'];

export function lookFor(id: number, shirt: string): Look {
  const r = mulberry32(id * 7919 + 13);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  return {
    skin: pick(SKINS), hair: pick(HAIRS), hairStyle: Math.floor(r() * 7), eye: pick(EYES),
    shirt, shirtStyle: Math.floor(r() * 3), pants: pick(PANTS), pantsStyle: r() < 0.6 ? 0 : 1, shoe: pick(['#5a4330', '#3a3a3e', '#7a5a3a', '#4a3a2c']), shoeStyle: r() < 0.55 ? 0 : 1,
    beard: r() < 0.28, hat: r() < 0.3 ? 1 : 0, glasses: r() < 0.14, pack: r() < 0.7 ? 1 : r() < 0.5 ? 2 : 0,
    accent: pick(ACCENTS), canvas: pick(CANVAS), scarf: r() < 0.25, smile: r(),
  };
}

// ------------------------------------------------------------------ the rig
export interface PlayerRig {
  rig: THREE.Group; lower: THREE.Group; upper: THREE.Group; body: THREE.Group; head: THREE.Group; eyes: THREE.Object3D;
  thighs: THREE.Group[]; knees: THREE.Group[]; ankles: THREE.Group[];
  shoulders: THREE.Group[]; elbows: THREE.Group[]; wrists: THREE.Group[]; grips: THREE.Group[];
  open: THREE.Mesh[]; fist: THREE.Mesh[];
  chest: THREE.Mesh; pack: THREE.Mesh | null;
  look: Look;
}

const grp = (parent: THREE.Object3D | null, x = 0, y = 0, z = 0) => { const g = new THREE.Group(); g.position.set(x, y, z); parent?.add(g); return g; };

export function buildPlayer(look: Look, shadows: boolean): PlayerRig {
  const rig = grp(null), lower = grp(rig), upper = grp(rig);
  const skin = look.skin, skinD = tone(skin, 0.82), S = look.shirt, SD = tone(S, 0.78), SL = tone(S, 1.14);
  const P = look.pants, PD = tone(P, 0.78), leather = '#4a3322', brass = '#c9a24a';

  // ---------------- pelvis, belt, hip gear (lower body root)
  {
    const m = new Mesher();
    m.cyl(0.98, 0.9, 0.16, P, 0, 0.92, 0, 0.19, 0.115, 14);               // hips in trousers / shorts
    m.cyl(0.98, 0.98, 0.04, leather, 0, 0.995, 0, 0.194, 0.118, 14);     // belt
    m.box(0.05, 0.04, 0.012, brass, 0, 0.995, -0.121);                    // buckle
    m.box(0.03, 0.022, 0.004, leather, 0, 0.995, -0.128);
    for (const x of [-0.12, 0.12]) m.box(0.012, 0.05, 0.012, leather, x, 0.995, -0.118); // belt loops
    m.box(0.03, 0.13, 0.026, leather, 0.2, 0.9, -0.02, 0, 0, 0.06);       // knife sheath
    m.box(0.024, 0.05, 0.022, '#7a5a3a', 0.205, 0.99, -0.018, 0, 0, 0.06); // knife handle
    m.box(0.07, 0.075, 0.045, tone(leather, 1.1), -0.2, 0.935, 0.0);      // pouch
    m.box(0.074, 0.02, 0.05, leather, -0.2, 0.97, 0.0);
    m.box(0.012, 0.02, 0.01, brass, -0.2, 0.955, -0.025);
    lower.add(m.build(shadows));
  }

  // ---------------- legs
  const thighs: THREE.Group[] = [], knees: THREE.Group[] = [], ankles: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const th = grp(lower, side * 0.1, HIP_Y, 0), kn = grp(th, 0, -THIGH, 0), an = grp(kn, 0, -SHIN, 0);
    const mt = new Mesher(), ms = new Mesher(), mf = new Mesher();
    if (look.pantsStyle === 0) { // long trousers, worn and a little baggy
      mt.cyl(0.088, 0.07, THIGH, P, 0, -THIGH / 2, 0, 1, 1.05, 10);
      mt.box(0.06, 0.07, 0.012, PD, side * 0.03, -0.1, -0.082);          // pocket
      ms.cyl(0.07, 0.056, SHIN, P, 0, -SHIN / 2, 0, 1, 1.05, 10);
      ms.cyl(0.062, 0.062, 0.035, PD, 0, -SHIN + 0.025, 0, 1, 1.05, 10); // cuff
      ms.sph(0.07, P, 0, 0.01, -0.01, 1, 0.8, 1.05);                      // knee
      ms.box(0.035, 0.05, 0.012, tone(P, 1.15), 0, -0.14, -0.06);        // patch
    } else {                       // shorts + bare legs
      mt.cyl(0.09, 0.086, 0.27, P, 0, -0.135, 0, 1, 1.05, 10);
      mt.cyl(0.088, 0.088, 0.025, PD, 0, -0.27, 0, 1, 1.05, 10);          // hem
      mt.cyl(0.078, 0.066, 0.2, skin, 0, -0.345, 0, 1, 1.02, 10);
      ms.sph(0.066, skin, 0, 0.005, -0.008, 1, 0.9, 1.05);
      ms.cyl(0.066, 0.047, SHIN, skin, 0, -SHIN / 2, 0, 1, 1.02, 10);
    }
    if (look.shoeStyle === 0) { // boots
      ms.cyl(0.058, 0.052, 0.07, tone(look.shoe, 1.1), 0, -SHIN + 0.075, 0, 1, 1, 10);
      ms.cyl(0.066, 0.066, 0.016, '#e6e0d0', 0, -SHIN + 0.115, 0, 1, 1, 10); // sock
      mf.cyl(0.055, 0.055, 0.075, look.shoe, 0, 0.0, 0, 1, 1, 10);
      mf.box(0.1, 0.07, 0.245, look.shoe, 0, -0.025, -0.06);
      mf.sph(0.052, tone(look.shoe, 1.18), 0, -0.02, -0.17, 1, 0.75, 1.05);  // toe cap
      mf.box(0.106, 0.022, 0.26, '#2c2622', 0, -0.058, -0.06);             // sole
      mf.box(0.106, 0.026, 0.05, '#2c2622', 0, -0.054, 0.045);             // heel
      for (let i = 0; i < 3; i++) mf.box(0.05, 0.008, 0.01, '#efe9d6', 0, 0.012 - i * 0.0, -0.1 + i * 0.03, 0.5); // laces
    } else {                    // sandals
      ms.cyl(0.045, 0.04, 0.03, skin, 0, -SHIN + 0.03, 0, 1, 1, 8);
      mf.box(0.088, 0.04, 0.22, skin, 0, -0.03, -0.06);
      for (let i = 0; i < 5; i++) mf.sph(0.0125, skinD, (i - 2) * 0.0175, -0.034, -0.175 - (i === 2 ? 0 : 0.0) , 1, 0.9, 1.1, 6);
      mf.box(0.1, 0.018, 0.25, look.shoe, 0, -0.056, -0.06);
      mf.box(0.1, 0.012, 0.016, look.shoe, 0, -0.008, -0.08);              // strap over the foot
      mf.box(0.016, 0.03, 0.016, look.shoe, side * 0.05, -0.03, -0.08);
      mf.box(0.1, 0.012, 0.014, look.shoe, 0, -0.008, 0.02);               // ankle strap
    }
    th.add(mt.build(shadows)); kn.add(ms.build(shadows)); an.add(mf.build(shadows));
    thighs.push(th); knees.push(kn); ankles.push(an);
  }

  // ---------------- torso
  const body = grp(upper, 0, BODY_Y, 0);
  let chest: THREE.Mesh, pack: THREE.Mesh | null = null;
  {
    const m = new Mesher();
    m.cyl(1, 0.84, 0.33, S, 0, 0.09, 0, 0.215, 0.118, 16);                 // chest
    m.cyl(0.84, 0.9, 0.27, S, 0, -0.14, 0, 0.18, 0.108, 16);              // waist
    m.cyl(0.9, 0.9, 0.035, SD, 0, -0.26, 0, 0.183, 0.11, 16);             // hem
    m.sph(0.07, look.shirtStyle === 1 ? skin : S, 0.222, 0.2, 0, 1, 1, 1.05, 8);  // shoulder caps
    m.sph(0.07, look.shirtStyle === 1 ? skin : S, -0.222, 0.2, 0, 1, 1, 1.05, 8);
    m.cyl(0.05, 0.058, 0.1, skin, 0, 0.29, 0, 1, 1, 10);                  // neck
    m.sph(0.03, skinD, 0, 0.265, -0.028, 1.2, 0.8, 0.8, 6);               // throat
    // collar / neckline
    if (look.shirtStyle === 2) { // open camp shirt: V of skin, collar flaps, buttons
      m.box(0.06, 0.07, 0.01, skin, 0, 0.2, -0.116);                          // small V of skin
      m.box(0.05, 0.085, 0.012, SL, -0.05, 0.2, -0.121, 0, 0, 0.55);          // collar flaps
      m.box(0.05, 0.085, 0.012, SL, 0.05, 0.2, -0.121, 0, 0, -0.55);
      m.box(0.014, 0.28, 0.01, SD, 0, 0.03, -0.121);                          // button placket
      for (let i = 0; i < 4; i++) m.sph(0.009, '#f0ead6', 0.0, 0.14 - i * 0.07, -0.127, 1, 1, 0.6, 5);
    } else {
      m.cyl(0.062, 0.07, 0.035, SD, 0, 0.255, 0, 1, 0.95, 12);            // crew collar
      if (look.shirtStyle === 1) { m.box(0.05, 0.12, 0.02, S, -0.085, 0.3, -0.07, 0, 0, 0.05); m.box(0.05, 0.12, 0.02, S, 0.085, 0.3, -0.07, 0, 0, -0.05); }
    }
    m.box(0.085, 0.08, 0.012, SD, -0.1, 0.07, -0.119);                      // chest pocket
    m.box(0.085, 0.018, 0.014, tone(S, 0.68), -0.1, 0.105, -0.12);
    if (look.scarf) { // neckerchief
      m.cyl(0.07, 0.085, 0.045, look.accent, 0, 0.245, 0, 1, 0.95, 12);
      m.box(0.07, 0.06, 0.012, look.accent, 0, 0.2, -0.108, 0, 0, Math.PI / 4);
      m.box(0.03, 0.05, 0.012, tone(look.accent, 0.8), 0, 0.17, -0.11, 0, 0, Math.PI / 4);
    }
    const pk = new Mesher();
    // gear on the back (the +Z side, so you can read which way someone faces from behind)
    if (look.pack === 1) { // rucksack
      pk.box(0.34, 0.36, 0.14, look.canvas, 0, 0.07, 0.2);
      pk.box(0.35, 0.12, 0.15, tone(look.canvas, 0.82), 0, 0.22, 0.2);                 // flap
      pk.box(0.25, 0.15, 0.05, tone(look.canvas, 1.08), 0, -0.02, 0.29);               // front pocket
      for (const x of [-0.07, 0.07]) pk.box(0.03, 0.17, 0.012, leather, x, 0.15, 0.285); // straps
      for (const x of [-0.07, 0.07]) pk.box(0.028, 0.016, 0.018, brass, x, 0.1, 0.288);  // buckles
      pk.cyl(0.07, 0.07, 0.4, look.accent, 0, 0.34, 0.2, 1, 1, 10, 0, 0, Math.PI / 2);   // bedroll
      pk.cyl(0.072, 0.072, 0.02, tone(look.accent, 0.7), -0.1, 0.34, 0.2, 1, 1, 10, 0, 0, Math.PI / 2);
      pk.cyl(0.072, 0.072, 0.02, tone(look.accent, 0.7), 0.1, 0.34, 0.2, 1, 1, 10, 0, 0, Math.PI / 2);
      pk.cyl(0.035, 0.03, 0.06, '#aab1b6', 0.19, -0.04, 0.2, 1, 1, 8);                  // tin cup
      for (const x of [-0.115, 0.115]) pk.box(0.052, 0.34, 0.016, leather, x, 0.1, -0.117, 0, 0, x < 0 ? 0.06 : -0.06); // front straps
    } else if (look.pack === 2) { // satchel on a cross-body strap
      pk.box(0.045, 0.62, 0.014, leather, 0, 0.0, -0.122, 0, 0, 0.78);
      pk.box(0.045, 0.62, 0.014, leather, 0, 0.0, 0.122, 0, 0, 0.78);
      pk.box(0.2, 0.17, 0.07, look.canvas, -0.2, -0.17, 0.0);
      pk.box(0.21, 0.07, 0.075, tone(look.canvas, 0.8), -0.2, -0.105, 0.0);
      pk.box(0.03, 0.03, 0.012, brass, -0.2, -0.14, -0.04);
    }
    if (look.pack) { pack = pk.build(shadows); body.add(pack); }
    const mesh = m.build(shadows); body.add(mesh); chest = mesh;
  }

  // ---------------- head (modelled at 0.125 m radius, then scaled up HEAD_S for a cuter, chibi-ish proportion)
  const head = grp(upper, 0, HEAD_Y, 0);
  head.scale.setScalar(HEAD_S);
  const EY = -0.008, EX = 0.053;
  const eyes = grp(head, 0, EY, 0);
  {
    const m = new Mesher();
    m.sph(0.125, skin, 0, 0.0, 0, 1.0, 0.96, 0.98, 20);                     // round skull
    m.sph(0.108, skin, 0, -0.035, -0.012, 1.0, 0.78, 0.92, 16);             // full, soft cheeks and jaw
    for (const s of [-1, 1]) {
      m.sph(0.026, skin, s * 0.124, -0.012, 0.0, 0.45, 1.0, 0.9, 8);        // small round ears
      m.sph(0.013, skinD, s * 0.127, -0.012, -0.002, 0.35, 0.85, 0.7, 6);
      // soft little brows, a touch lighter than the hair
      m.sph(0.014, mix(look.hair, skin, 0.3), s * EX, 0.04, -0.1, 1.9, 0.38, 0.5, 7, 0, 0, s * -0.1);
    }
    m.sph(0.0145, mix(skin, '#f08a7a', 0.12), 0, -0.032, -0.118, 1.05, 0.85, 0.9, 8);      // button nose
    const sm = 0.25 + look.smile * 0.35;                                                  // gentle little smile
    const lip = mix(skin, '#8e353d', 0.7);
    m.box(0.016, 0.0065, 0.008, lip, 0, -0.072, -0.1105);
    for (const s of [-1, 1]) m.box(0.014, 0.0065, 0.008, lip, s * 0.0105, -0.0705 + sm * 0.006, -0.1095, 0, 0, s * sm);
    head.add(m.build(shadows));

    // eyes: big glossy irises with two catchlights, a hint of white, a soft lash line; centred on the group so a blink squashes them shut
    const e = new Mesher();
    const lash = mix(look.hair, '#1a1210', 0.6);
    for (const s of [-1, 1]) {
      const x = s * EX;
      e.sph(0.028, '#fbf8f2', x, 0, -0.1045, 1.0, 1.12, 0.34, 10);
      e.sph(0.0235, tone(look.eye, 1.15), x, -0.001, -0.1075, 1.0, 1.14, 0.36, 10);
      e.sph(0.0235, tone(look.eye, 0.55), x, 0.009, -0.1088, 0.92, 0.5, 0.36, 8);        // darker top of the iris
      e.sph(0.0135, '#100c0c', x, -0.001, -0.1115, 1.0, 1.1, 0.34, 9);
      e.sph(0.0078, '#ffffff', x + s * -0.0085, 0.0105, -0.1145, 1, 1, 0.4, 7);           // big catchlight
      e.sph(0.0036, '#ffffff', x + s * 0.0095, -0.0105, -0.1145, 1, 1, 0.4, 6);           // small catchlight
      e.sph(0.03, lash, x + s * 0.002, 0.0205, -0.1035, 1.08, 0.2, 0.36, 9, 0, 0, s * -0.12); // lash line
    }
    eyes.add(e.build(shadows));
    // sunglasses sit over the eyes and do not blink
    if (look.glasses) {
      const g = new Mesher();
      for (const s of [-1, 1]) {
        g.sph(0.034, '#1c2228', s * EX, EY, -0.108, 1.1, 0.95, 0.3, 12);
        g.sph(0.012, '#6a8aa4', s * EX + s * -0.011, EY + 0.012, -0.1195, 1.2, 0.6, 0.2, 6, 0, 0, s * 0.5);
        g.box(0.008, 0.008, 0.1, '#1c2228', s * 0.121, EY + 0.008, -0.06);
      }
      g.box(0.03, 0.007, 0.008, '#1c2228', 0, EY + 0.006, -0.112);
      head.add(g.build(shadows));
    }
    // hair, hat, beard
    const h = new Mesher(), H = look.hair, HD = tone(H, 0.8), HL = tone(H, 1.18);
    const capHair = (r = 0.134, y = 0.012, z = 0.012) => h.cap(r, H, 0, y, z, 0.97, 1.0, 1.0, Math.PI * 0.56);
    const fringe = (w = 0.2) => { // soft rounded fringe instead of a hard slab
      h.sph(0.05, H, -0.06, 0.088, -0.083, 1.25, 0.55, 0.7, 8, 0, 0, 0.18);
      h.sph(0.05, HL, 0.0, 0.092, -0.09, 1.3, 0.55, 0.7, 8);
      h.sph(0.05, H, 0.06, 0.088, -0.083, 1.25, 0.55, 0.7, 8, 0, 0, -0.18);
      if (w > 0.2) h.sph(0.04, HD, 0, 0.08, -0.09, 1.6, 0.5, 0.6, 8);
    };
    switch (look.hairStyle) {
      case 0: // short crop with a fringe
        capHair(); fringe();
        h.box(0.04, 0.05, 0.03, HD, -0.1, 0.045, -0.04); h.box(0.04, 0.05, 0.03, HD, 0.1, 0.045, -0.04);
        break;
      case 1: // long, past the shoulders
        capHair(0.138, 0.012, 0.016);
        h.box(0.27, 0.34, 0.06, H, 0, -0.12, 0.095);
        for (const s of [-1, 1]) { h.box(0.04, 0.24, 0.1, H, s * 0.132, -0.08, 0.025); h.box(0.036, 0.12, 0.05, HL, s * 0.132, -0.2, 0.05); }
        fringe();
        break;
      case 2: // ponytail
        capHair(); fringe();
        h.cyl(0.02, 0.028, 0.03, look.accent, 0, 0.0, 0.14, 1, 1, 8, Math.PI / 2 - 0.4);
        h.cyl(0.045, 0.012, 0.3, H, 0, -0.12, 0.17, 1, 1, 8, 0.28);
        break;
      case 3: // top bun
        capHair(); fringe();
        h.sph(0.06, H, 0, 0.13, 0.04, 1, 0.9, 1, 10); h.cyl(0.05, 0.05, 0.016, look.accent, 0, 0.11, 0.04, 1, 1, 10);
        break;
      case 4: // messy with a headband
        capHair(0.139, 0.016, 0.016);
        for (let i = 0; i < 6; i++) { const a = i * 1.05; h.box(0.04, 0.06, 0.04, i % 2 ? H : HL, Math.cos(a) * 0.1, 0.105, Math.sin(a) * 0.09, 0.4 * Math.sin(a), a, 0.4 * Math.cos(a)); }
        h.cyl(0.133, 0.133, 0.035, look.accent, 0, 0.065, 0.004, 0.97, 1.0, 16);
        h.box(0.04, 0.05, 0.015, look.accent, 0.04, 0.055, 0.135, 0, 0, 0.5); h.box(0.025, 0.09, 0.012, tone(look.accent, 0.85), 0.065, -0.005, 0.14, 0, 0, 0.3);
        break;
      case 5: // buzz cut
        h.cap(0.129, tone(H, 0.9), 0, 0.01, 0.01, 0.97, 1.0, 1.0, Math.PI * 0.54);
        break;
      default: // curls
        for (let i = 0; i < 14; i++) {
          const a = i * 2.4, el = 0.35 + (i % 4) * 0.28;
          h.sph(0.055, i % 3 ? H : HL, Math.cos(a) * 0.1 * Math.cos(el * 0.5), 0.045 + Math.sin(el) * 0.08, Math.sin(a) * 0.1 * Math.cos(el * 0.5) + 0.015, 1, 1, 1, 7);
        }
        h.cap(0.132, H, 0, 0.01, 0.012, 0.97, 1.0, 1.0, Math.PI * 0.54);
        break;
    }
    if (look.hat) { // straw sun hat
      const straw = '#d8bd78', band = look.accent;
      h.cyl(0.235, 0.24, 0.014, straw, 0, 0.09, -0.005, 1, 1, 24, -0.05);
      h.cyl(0.235, 0.235, 0.012, tone(straw, 0.85), 0, 0.097, -0.005, 0.99, 0.99, 24, -0.05);
      h.cyl(0.108, 0.125, 0.1, straw, 0, 0.145, 0.0, 1, 1, 20);
      h.cyl(0.098, 0.108, 0.02, tone(straw, 1.1), 0, 0.2, 0.0, 1, 1, 20);
      h.cyl(0.127, 0.127, 0.03, band, 0, 0.113, 0, 1, 1, 20);
    }
    if (look.beard) { // a short, tidy beard that frames the cheeks and leaves the smile showing
      h.sph(0.1, H, 0, -0.068, -0.016, 1.0, 0.6, 0.88, 14);
      h.sph(0.026, H, 0, -0.108, -0.06, 1.2, 0.9, 0.8, 8);
      for (const s of [-1, 1]) h.sph(0.016, HD, s * 0.02, -0.057, -0.108, 1.7, 0.5, 0.6, 6, 0, 0, s * -0.2); // moustache
    }
    head.add(h.build(shadows));
  }

  // ---------------- arms and hands
  const shoulders: THREE.Group[] = [], elbows: THREE.Group[] = [], wrists: THREE.Group[] = [], grips: THREE.Group[] = [];
  const open: THREE.Mesh[] = [], fist: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const sh = grp(upper, side * SH_X, SH_Y, 0), el = grp(sh, 0, -UPPER, 0), wr = grp(el, 0, -FORE, 0);
    const mu = new Mesher(), mf = new Mesher();
    mu.cyl(0.054, 0.046, UPPER, skin, 0, -UPPER / 2, 0, 1, 1, 10);
    if (look.shirtStyle === 0) { mu.cyl(0.068, 0.062, 0.14, S, 0, -0.07, 0, 1, 1, 12); mu.cyl(0.063, 0.063, 0.016, SD, 0, -0.14, 0, 1, 1, 12); }
    else if (look.shirtStyle === 2) { mu.cyl(0.068, 0.058, 0.26, S, 0, -0.13, 0, 1, 1, 12); mu.cyl(0.06, 0.06, 0.03, SD, 0, -0.255, 0, 1, 1, 12); } // sleeves rolled to the elbow
    else mu.sph(0.056, skin, 0, -0.01, 0, 1, 1, 1, 8);
    mf.sph(0.047, skin, 0, 0.0, -0.004, 1, 1, 1, 8);                       // elbow
    mf.cyl(0.046, 0.037, FORE, skin, 0, -FORE / 2, 0, 1, 1, 10);
    mf.cyl(0.043, 0.043, 0.03, look.accent, 0, -0.205, 0, 1, 1, 10);       // wristband
    mf.cyl(0.044, 0.044, 0.008, tone(look.accent, 0.7), 0, -0.19, 0, 1, 1, 10);
    sh.add(mu.build(shadows)); el.add(mf.build(shadows));

    const hand = (closed: boolean) => {
      const m = new Mesher();
      m.box(0.072, 0.07, 0.036, skin, 0, -0.04, 0);                       // palm
      m.sph(0.03, skin, 0, -0.01, 0, 1.15, 0.8, 0.8, 7);                   // wrist
      if (!closed) {
        const L = [0.05, 0.058, 0.054, 0.042];
        for (let i = 0; i < 4; i++) {
          const x = -0.027 + i * 0.018;
          m.box(0.016, L[i] * 0.55, 0.019, skin, x, -0.088 - L[i] * 0.22, -0.004 - i * 0.0, -0.12);
          m.box(0.015, L[i] * 0.5, 0.017, skin, x, -0.088 - L[i] * 0.72, -0.012, -0.34);
        }
        m.box(0.017, 0.048, 0.02, skin, -side * 0.04, -0.05, -0.016, -0.4, 0, -side * 0.5); // thumb
        m.sph(0.009, mix(skin, '#ffffff', 0.4), -side * 0.052, -0.084, -0.034, 1, 1, 1, 5);
      } else {
        // fingers curled around a handle that runs front-to-back (along Z) at the palm
        for (let i = 0; i < 4; i++) {
          const z = -0.027 + i * 0.018;
          m.box(0.03, 0.02, 0.017, skin, -side * 0.034, -0.062, z);
          m.box(0.018, 0.034, 0.016, skin, -side * 0.046, -0.082, z);
          m.box(0.026, 0.016, 0.015, skin, -side * 0.032, -0.1, z);
          m.sph(0.009, skinD, -side * 0.054, -0.07, z, 1, 1, 1, 5);          // knuckles
        }
        m.box(0.02, 0.026, 0.05, skin, side * 0.0, -0.1, -0.012);             // thumb closing over
        m.box(0.02, 0.02, 0.036, skin, side * 0.01, -0.12, -0.012);
      }
      const me = m.build(shadows); wr.add(me); return me;
    };
    const o = hand(false), f = hand(true); f.visible = false;
    const grip = grp(wr, -side * 0.02, -0.075, 0);
    shoulders.push(sh); elbows.push(el); wrists.push(wr); grips.push(grip); open.push(o); fist.push(f);
  }

  return { rig, lower, upper, body, head, eyes, thighs, knees, ankles, shoulders, elbows, wrists, grips, open, fist, chest: chest!, pack, look };
}

const FLAME = (() => {
  const pts = [[0.0, 0], [0.14, 0.05], [0.2, 0.2], [0.17, 0.45], [0.09, 0.72], [0.0, 1]].map(([r, y]) => new THREE.Vector2(r * 5, y));
  return new THREE.LatheGeometry(pts, 9);
})();
const FLAME_BASE = [[0.3, 0.09], [0.22, 0.065], [0.14, 0.04]];
/** gentle flicker for a held torch (called every frame by the avatar) */
export function flicker(g: THREE.Object3D, t: number) {
  const fl = g.userData.flame as THREE.Mesh[] | undefined;
  if (!fl) return;
  fl.forEach((f, k) => {
    const w = t * (10 + k * 3) + k * 2, fk = 1 + 0.16 * Math.sin(w) + 0.09 * Math.sin(w * 2.3 + 1);
    f.scale.set(FLAME_BASE[k][1] * (1 - 0.06 * Math.sin(w * 1.7)), FLAME_BASE[k][0] * fk, FLAME_BASE[k][1] * (1 + 0.06 * Math.sin(w * 1.3)));
    f.rotation.z = Math.sin(w * 0.7) * 0.08; f.rotation.x = Math.cos(w * 0.9) * 0.08;
  });
}

// ------------------------------------------------------------------ things held in the hand
// Built "upright": the grip is at the origin, the long axis runs along +Y (business end up), the blade faces -Z.
export function buildHeld(id: string, shadows: boolean): THREE.Group {
  const g = new THREE.Group();
  const m = new Mesher();
  const wood = '#8b6a44', woodD = '#6a4d2f', rope = '#cdbb8a', metalC = '#aab4bd', stoneC = '#8f8a82', darkMetal = '#6c7680';
  const handle = (len: number, y0: number, r = 0.02) => {
    m.cyl(r, r * 1.05, len, wood, 0, y0 + len / 2, 0, 1, 1, 8);
    m.cyl(r * 1.25, r * 1.25, 0.14, woodD, 0, y0 + 0.07, 0, 1, 1, 8);        // grip wrap
    m.sph(r * 1.5, woodD, 0, y0, 0, 1, 0.8, 1, 7);                            // pommel
  };
  const lash = (y: number, w = 0.05) => m.cyl(w, w, 0.016, rope, 0, y, 0, 1, 1, 8);
  let tip: THREE.Object3D | null = null;
  let flames: THREE.Mesh[] | null = null;
  switch (id) {
    case 'torch': {
      handle(0.5, -0.14, 0.022);
      m.cyl(0.05, 0.036, 0.12, '#3b2a1f', 0, 0.42, 0, 1, 1, 9);               // oil-soaked rags
      m.cyl(0.052, 0.052, 0.02, rope, 0, 0.385, 0, 1, 1, 9);
      flames = [];
      for (const [col, h, w] of [['#ff5a14', 0.3, 0.09], ['#ff9a2a', 0.22, 0.065], ['#ffe49a', 0.14, 0.04]] as [string, number, number][]) {
        const fm = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
        const f = new THREE.Mesh(FLAME, fm); f.scale.set(w, h, w); f.position.y = 0.47; f.frustumCulled = false; f.renderOrder = 5; flames.push(f);
      }
      break;
    }
    case 'rock': m.sph(0.07, stoneC, 0, 0.0, 0, 1, 0.85, 0.95, 7); m.sph(0.05, tone(stoneC, 1.15), 0.02, 0.04, -0.03, 1, 0.7, 1, 6); break;
    case 'hatchet': case 'metal_hatchet': {
      const mt = id === 'metal_hatchet';
      handle(0.52, -0.14);
      m.box(0.05, 0.13, 0.07, mt ? darkMetal : stoneC, 0, 0.34, -0.03);
      m.box(0.045, 0.17, 0.05, mt ? metalC : tone(stoneC, 1.1), 0, 0.34, -0.09, 0, 0, 0);
      m.box(0.02, 0.19, 0.03, mt ? '#e0e6ea' : tone(stoneC, 1.25), 0, 0.34, -0.125);   // edge
      lash(0.29); lash(0.4);
      break;
    }
    case 'pickaxe': case 'metal_pickaxe': case 'diamond_pickaxe': {
      const mt = id !== 'pickaxe', dia = id === 'diamond_pickaxe';
      handle(0.56, -0.14);
      const hc = mt ? darkMetal : stoneC;
      m.box(0.05, 0.06, 0.1, hc, 0, 0.4, 0);
      for (const s of [-1, 1]) {
        m.box(0.045, 0.05, 0.14, dia ? '#4fd8ea' : mt ? metalC : tone(stoneC, 1.1), 0, 0.41, s * 0.12, s * 0.0, 0, 0);
        m.box(0.035, 0.03, 0.1, dia ? '#bff8ff' : mt ? '#e0e6ea' : tone(stoneC, 1.25), 0, 0.395, s * 0.22, s * -0.25);
      }
      lash(0.36, 0.04); lash(0.44, 0.04);
      break;
    }
    case 'spear':
      m.cyl(0.018, 0.02, 1.7, wood, 0, 0.45, 0, 1, 1, 8);
      m.cyl(0.0, 0.04, 0.24, '#c4ccd2', 0, 1.42, 0, 1, 0.6, 6);
      m.box(0.02, 0.04, 0.05, '#c4ccd2', 0, 1.34, 0);
      m.cyl(0.03, 0.03, 0.05, rope, 0, 1.3, 0, 1, 1, 8);
      for (let i = 0; i < 3; i++) m.box(0.015, 0.1, 0.012, ['#e0554a', '#e8c34a', '#e0554a'][i], (i - 1) * 0.02, 1.2, 0.02, 0, 0, (i - 1) * 0.3); // feather tufts
      m.sph(0.03, woodD, 0, -0.4, 0, 1, 1.5, 1, 6);
      break;
    case 'fishing_rod': {
      m.cyl(0.012, 0.022, 1.5, wood, 0, 0.55, -0.02, 1, 1, 8);
      m.cyl(0.026, 0.026, 0.2, '#c9a56a', 0, 0.0, 0, 1, 1, 8);                  // cork handle
      m.cyl(0.032, 0.032, 0.05, '#aab1b6', 0.045, 0.2, 0, 1, 1, 10, 0, 0, Math.PI / 2); // reel
      m.box(0.03, 0.012, 0.012, '#aab1b6', 0.07, 0.2, 0);
      for (const y of [0.55, 0.95, 1.25]) m.cyl(0.012, 0.012, 0.006, '#aab1b6', 0, y, -0.03, 1, 1, 6, Math.PI / 2);
      tip = new THREE.Object3D(); tip.position.set(0, 1.3, -0.02);
      break;
    }
    case 'building_plan':
      m.cyl(0.045, 0.045, 0.32, '#e9dfc3', 0, 0.0, 0, 1, 1, 12, 0, 0, Math.PI / 2);
      m.cyl(0.047, 0.047, 0.03, '#3f78b4', -0.08, 0.0, 0, 1, 1, 12, 0, 0, Math.PI / 2);
      m.cyl(0.047, 0.047, 0.03, '#3f78b4', 0.08, 0.0, 0, 1, 1, 12, 0, 0, Math.PI / 2);
      m.sph(0.046, '#d9cfae', -0.16, 0, 0, 0.3, 1, 1, 8); m.sph(0.046, '#d9cfae', 0.16, 0, 0, 0.3, 1, 1, 8);
      break;
    case 'coconut': case 'roasted_coconut': {
      const c = id === 'coconut' ? '#7a5a3a' : '#5a3d24';
      m.sph(0.085, c, 0, 0.04, 0, 1, 1, 1, 10);
      for (const [x, y, z] of [[0, 0.1, -0.05], [-0.03, 0.08, -0.06], [0.03, 0.08, -0.06]]) m.sph(0.013, '#2a1e14', x, y, z, 1, 1, 0.6, 5);
      break;
    }
    case 'flower_daisy': case 'flower_poppy': case 'flower_bluebell': case 'flower_sunflower': case 'flower_hibiscus': case 'flower_lavender': case 'flower_orchid': case 'flower_paradise': {
      const f = FLOWERS[ITEMS[id].flower ?? 0];
      m.cyl(0.006, 0.008, 0.2, f.leaf, 0, 0.1, 0, 1, 1, 4);
      for (let i = 0; i < 5; i++) { const a = i * 1.257; m.sph(0.022, f.head, Math.cos(a) * 0.022, 0.2, Math.sin(a) * 0.022, 1, 0.35, 1, 5); }
      m.sph(0.012, f.mid, 0, 0.21, 0, 1, 0.7, 1, 5);
      break;
    }
    case 'picture_frame': m.box(0.24, 0.19, 0.02, '#8a5a30', 0, 0.1, 0); m.box(0.2, 0.15, 0.022, '#f3eee2', 0, 0.1, 0); break;
    case 'turtle_egg': m.sph(0.04, '#f4efe2', 0, 0.04, 0, 1, 0.95, 1, 8); break;
    case 'berries':
      for (let i = 0; i < 7; i++) m.sph(0.03, ['#d0243d', '#e03349', '#b81b32'][i % 3], Math.cos(i * 1.7) * 0.04, 0.03 + (i % 3) * 0.03, Math.sin(i * 1.7) * 0.04, 1, 1, 1, 7);
      m.box(0.07, 0.01, 0.05, '#4f8a2a', 0, 0.1, 0, 0.0, 0.5);
      break;
    case 'meat_stick': case 'roast_stick': {
      const c = id === 'meat_stick' ? '#c25a62' : '#6e3618';
      m.cyl(0.01, 0.013, 0.74, '#8b6a44', 0, 0.25, 0, 1, 1, 6);
      for (const [y, r] of [[0.47, 0.036], [0.53, 0.042], [0.59, 0.034]]) m.sph(r, c, 0, y, 0, 1, 0.9, 1, 7);
      break;
    }
    case 'guitar': {
      m.sph(0.17, '#c98a43', 0, -0.68, 0, 1, 1, 0.26, 12); m.sph(0.13, '#c98a43', 0, -0.45, 0, 1, 1, 0.3, 12);
      m.cyl(0.042, 0.042, 0.006, '#3a2414', 0, -0.5, -0.046, 1, 1, 14, Math.PI / 2, 0, 0);
      m.box(0.046, 0.5, 0.028, '#8a5328', 0, -0.1, -0.02); m.box(0.06, 0.13, 0.018, '#4a2a14', 0, 0.215, -0.02);
      m.box(0.04, 0.82, 0.003, '#f4efe2', 0, -0.3, -0.05);
      break;
    }
    case 'raw_meat': case 'cooked_meat': {
      const c = id === 'raw_meat' ? '#c25a62' : '#7a4a2c';
      m.sph(0.075, c, 0, 0.03, 0, 1.1, 0.8, 0.9, 8); m.sph(0.05, tone(c, 1.15), 0.03, 0.06, -0.02, 1, 0.8, 1, 7);
      m.cyl(0.014, 0.014, 0.16, '#efe6d0', 0, 0.13, 0.0, 1, 1, 6, 0, 0, 0.4);
      break;
    }
    case 'raw_fish': case 'cooked_fish': {
      const c = id === 'raw_fish' ? '#a9b8c4' : '#a8682c', b = id === 'raw_fish' ? '#e6ebef' : '#c98a44';
      m.sph(0.07, c, 0, 0.0, 0, 1.0, 0.45, 2.0, 10); m.sph(0.05, b, 0, -0.02, 0.0, 0.9, 0.35, 1.8, 8);
      m.box(0.012, 0.09, 0.07, tone(c, 0.85), 0, 0.0, 0.17, 0, 0, 0); m.box(0.012, 0.06, 0.05, tone(c, 0.9), 0, 0.035, 0.0);
      m.sph(0.008, '#10151a', 0.03, 0.01, -0.12, 1, 1, 1, 5); m.sph(0.008, '#10151a', -0.03, 0.01, -0.12, 1, 1, 1, 5);
      break;
    }
    case 'wood': m.cyl(0.055, 0.05, 0.34, '#8b6a44', 0, 0.0, 0, 1, 1, 10, 0, 0, Math.PI / 2); m.cyl(0.04, 0.04, 0.005, '#d9b987', 0.171, 0, 0, 1, 1, 10, 0, 0, Math.PI / 2); break;
    case 'stone': m.sph(0.07, stoneC, 0, 0.02, 0, 1, 0.85, 0.95, 6); m.sph(0.045, tone(stoneC, 1.2), 0.03, 0.06, -0.02, 1, 0.8, 1, 5); break;
    case 'metal_ore': m.sph(0.075, '#5c5f66', 0, 0.02, 0, 1, 0.85, 0.95, 6); for (let i = 0; i < 5; i++) m.sph(0.014, '#d38b3c', Math.cos(i * 2) * 0.05, 0.03 + (i % 2) * 0.03, Math.sin(i * 2) * 0.05, 1, 1, 1, 5); break;
    case 'metal': m.box(0.16, 0.05, 0.08, '#b9c2c9', 0, 0, 0); m.box(0.12, 0.02, 0.05, '#e3e8ec', 0, 0.035, 0); break;
    case 'fiber':
      for (let i = 0; i < 9; i++) m.box(0.01, 0.2, 0.01, i % 2 ? '#a9b86a' : '#8da356', (i - 4) * 0.011, 0.08, Math.sin(i) * 0.012, 0.0, 0, (i - 4) * 0.06);
      m.cyl(0.04, 0.04, 0.02, rope, 0, 0.0, 0, 1, 1, 8);
      break;
    default: // placeable kits: a lashed bundle
      m.box(0.2, 0.15, 0.17, '#8b6a44', 0, 0.03, 0); m.box(0.205, 0.02, 0.175, woodD, 0, 0.07, 0); m.box(0.02, 0.16, 0.18, rope, 0.05, 0.03, 0); m.box(0.02, 0.16, 0.18, rope, -0.05, 0.03, 0);
  }
  const mesh = m.build(shadows);
  g.add(mesh);
  if (tip) { g.add(tip); g.userData.tip = tip; }
  if (flames) { flames.forEach((f) => g.add(f)); g.userData.flame = flames; }
  return g;
}

// ---------------------------------------------------------------- worn armor (drawn on other players)
const ARMOR_COL: Record<1 | 2 | 3, { main: string; dark: string; trim: string }> = {
  1: { main: '#9a6236', dark: '#5f3b20', trim: '#d6a874' },
  2: { main: '#aeb7be', dark: '#69747d', trim: '#eef2f5' },
  3: { main: '#4fd6e8', dark: '#1b93ad', trim: '#d4fbff' },
};
export interface ArmorMeshes { head: THREE.Mesh | null; chest: THREE.Mesh | null; thigh: THREE.Mesh | null; shin: THREE.Mesh | null }

/** tiers = [head, chest, legs], each 0 (nothing) .. 3. The parts are attached by the caller: head -> head group, chest -> body group,
 *  thigh -> each thigh group, shin -> each knee group (a fresh mesh per leg, as geometry cannot be shared across disposals). */
export function buildArmor(tiers: [number, number, number], shadows: boolean): (() => ArmorMeshes) {
  return () => {
    const out: ArmorMeshes = { head: null, chest: null, thigh: null, shin: null };
    const [th, tc, tl] = tiers;
    if (th) {
      const c = ARMOR_COL[th as 1 | 2 | 3], m = new Mesher(), soft = th === 1;
      m.cap(0.143, c.main, 0, 0.004, 0.012, 0.98, 1.02, 1.02, Math.PI * 0.56);
      m.cyl(0.146, 0.146, 0.03, c.dark, 0, 0.0, 0.01, 1, 1, 18);                       // brow band
      if (soft) { m.box(0.03, 0.09, 0.02, c.dark, -0.132, -0.05, 0.02); m.box(0.03, 0.09, 0.02, c.dark, 0.132, -0.05, 0.02); } // ear flaps
      else {
        m.box(0.016, 0.075, 0.012, c.dark, 0, -0.02, -0.14);                          // nose guard
        m.box(0.018, 0.04, 0.2, c.trim, 0, 0.14, 0.0);                                 // crest
        for (const x of [-0.1, 0.1]) m.sph(0.012, c.trim, x, 0.0, -0.138, 1, 1, 1, 5);  // rivets
        if (th === 3) m.sph(0.02, '#ffffff', 0, 0.05, -0.145, 1, 1, 0.6, 6);          // gem
      }
      out.head = m.build(shadows);
    }
    if (tc) {
      const c = ARMOR_COL[tc as 1 | 2 | 3], m = new Mesher(), soft = tc === 1;
      m.cyl(1, 0.86, 0.34, c.main, 0, 0.09, 0, 0.228, 0.128, 16);                      // breastplate over the chest
      m.cyl(0.86, 0.92, 0.12, c.dark, 0, -0.1, 0, 0.19, 0.116, 16);                    // plates / belt line
      m.sph(0.088, c.main, 0.232, 0.205, 0, 1.05, 0.85, 1.1, 8);                        // pauldrons
      m.sph(0.088, c.main, -0.232, 0.205, 0, 1.05, 0.85, 1.1, 8);
      m.box(0.016, 0.3, 0.012, c.dark, 0, 0.08, -0.128);                               // centre seam
      if (!soft) {
        for (const [x, y] of [[-0.12, 0.16], [0.12, 0.16], [-0.12, 0.0], [0.12, 0.0]]) m.sph(0.012, c.trim, x, y, -0.126, 1, 1, 0.7, 5);
        m.box(0.2, 0.012, 0.012, c.trim, 0, 0.22, -0.124);                             // gorget line
        if (tc === 3) m.sph(0.03, '#ffffff', 0, 0.09, -0.135, 1, 1, 0.55, 6);          // gem
      } else for (let i = 0; i < 4; i++) m.box(0.22, 0.01, 0.01, c.trim, 0, 0.17 - i * 0.07, -0.128); // stitched bands
      out.chest = m.build(shadows);
    }
    if (tl) {
      const c = ARMOR_COL[tl as 1 | 2 | 3], mt = new Mesher(), ms = new Mesher();
      mt.cyl(0.098, 0.08, THIGH * 0.72, c.main, 0, -THIGH * 0.42, 0, 1, 1.06, 12);     // thigh guard
      mt.cyl(0.1, 0.1, 0.03, c.dark, 0, -0.03, 0, 1, 1.06, 12);
      ms.cyl(0.078, 0.064, SHIN * 0.78, c.main, 0, -SHIN * 0.44, 0, 1, 1.06, 12);      // shin guard
      ms.sph(0.085, c.main, 0, 0.005, -0.012, 1, 0.8, 1.05, 8);                         // knee cap
      ms.cyl(0.07, 0.07, 0.025, c.dark, 0, -SHIN * 0.86, 0, 1, 1.06, 12);
      if (tl > 1) ms.box(0.014, SHIN * 0.5, 0.01, c.trim, 0, -SHIN * 0.42, -0.072);
      out.thigh = mt.build(shadows); out.shin = ms.build(shadows);
    }
    return out;
  };
}


/** The name plate pinned to the chest: cream with dark lettering so it reads on any shirt colour. Parent it to `PlayerRig.body`. */
export function makeNamePlate(name: string): THREE.Mesh {
  const c = document.createElement('canvas'); c.width = 320; c.height = 124;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f4efe0'; g.beginPath(); g.roundRect(2, 2, 316, 120, 22); g.fill();
  g.strokeStyle = '#6b5a3c'; g.lineWidth = 6; g.stroke();
  let px = 64; g.textAlign = 'center'; g.textBaseline = 'middle';
  do { g.font = `800 ${px}px system-ui, sans-serif`; px -= 4; } while (g.measureText(name).width > 284 && px > 20);
  g.fillStyle = '#2a2217'; g.fillText(name, 160, 66);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 });
  m.emissiveMap = tex; m.emissive = new THREE.Color(0.3, 0.3, 0.3);   // like the rest of the body: the island has little fill light
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.078), m);
  mesh.position.set(0.04, 0.07, -0.133); mesh.rotation.y = Math.PI;      // faces -Z, like the character
  mesh.name = 'nameplate'; mesh.frustumCulled = false;
  return mesh;
}
