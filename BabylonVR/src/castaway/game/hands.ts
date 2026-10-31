// Castaway's first-person hands and held tools (game/viewmodel.ts there), drawn in Babylon by render/mirror.ts.
import * as THREE from 'three';
import { flowerGeometry, FLOWERS } from '../world/flowers';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ARMOR_TIER_COLOR, ITEMS, type ItemId } from './items';

export interface ViewState {
  speed: number;       // horizontal speed m/s (0..7)
  sprinting: boolean;
  swimming: boolean;
  underwater: boolean;
  onGround: boolean;
  vy: number;          // vertical velocity m/s
  yawRate: number;     // rad/s, +left turn
  pitchRate: number;   // rad/s, +look up
  time: number;        // seconds (monotonic)
}

/* ------------------------------------------------------------------ materials
 * Babylon port: Castaway's node materials become plain standard materials drawn by render/mirror.ts in a later rendering
 * group (so the hands never sink into trunks or walls, which Castaway did with a squeezed depth). Their self-light fades with
 * the daylight (VM_LIGHT); the rim light and the procedural sleeve stripes and crate slats are left out. */
interface MatOpt { metal?: number; rim?: number; emis?: number; double?: boolean; vc?: boolean }
/** how much the first-person hands and tools light themselves: 1 by day, low at night (set every frame by the game) */
export const VM_LIGHT = { value: 1 };
/** how far the held meat on a stick has roasted, 0 raw .. 1 done (browns the raw stick's meat) */
export const ROAST = { value: 0 };
/** every view-model material, with its own self-light strength (the mirror re-reads emissive and colour each frame) */
const LIVE: { m: THREE.MeshStandardMaterial; k: number }[] = [];
const mat = (hex: string, rough = 0.85, o: MatOpt = {}) => {
  const m = new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: o.metal ?? 0 });
  // the self-light fades with the daylight, so your hands are as dark as the night around you (torches and lamps still light them)
  m.emissive.set(hex);
  m.userData.liveEmissive = true;
  LIVE.push({ m, k: o.emis ?? 0.32 });
  if (o.double) m.side = THREE.DoubleSide;
  if (o.vc) m.vertexColors = true;
  return m;
};
/** once a frame: the self-light follows VM_LIGHT, the raw meat browns with ROAST */
export function tickViewMaterials() {
  for (const { m, k } of LIVE) m.emissiveIntensity = k * VM_LIGHT.value;
  if (ROAST_MATS.length) {
    const r = ROAST.value, a = Math.min(1, Math.max(0, r * 1.6)), b = Math.min(1, Math.max(0, (r - 0.6) * 2.5));
    _rc.set('#b8434d').lerp(_r1, a).lerp(_r2, b);
    for (const m of ROAST_MATS) { m.color.copy(_rc); m.emissive.copy(_rc); }
  }
}
const ROAST_MATS: THREE.MeshStandardMaterial[] = [];
const _rc = new THREE.Color(), _r1 = new THREE.Color('#8a4a26'), _r2 = new THREE.Color('#5e2c12');
const mesh = (g: THREE.BufferGeometry, m: THREE.Material, order: number) => {
  const o = new THREE.Mesh(g, m); o.renderOrder = 1000 + order; o.frustumCulled = false; return o;
};

// your own skin tone (the customise screen): the hands, forearm and fingers all follow it
const SK_BASE = new THREE.Color('#c98f66');
const SKIN_ARM = mat('#c98f66', 0.7, { rim: 0.3 });
const SKIN_F = mat('#c98f66', 0.7, { rim: 0.3, vc: true });
/** recolour the first-person hands to the chosen skin */
export function setViewSkin(hex: string) {
  SK_BASE.set(hex).multiplyScalar(0.96);
  for (const m of [SKIN_ARM, SKIN_F]) { m.color.copy(SK_BASE); m.emissive.copy(SK_BASE); }
}
const WOOD = mat('#8b5e34', 0.85, { rim: 0.12 });
const WOOD_D = mat('#5f3f22');
const WOOD_L = mat('#d7b27a');
const LEATHER = mat('#46301f', 0.9);
const WRAP = mat('#a9854f', 0.95);
const STONE = mat('#a8a39a', 0.95, { rim: 0.1 });
const STONE_H = mat('#8d8a83', 0.95, { rim: 0.1 });
const STEEL = mat('#c9d0d6', 0.28, { metal: 0.55, emis: 0.3, rim: 0.2 });
const DIAMOND_H = mat('#6feeff', 0.12, { metal: 0.2, emis: 0.9, rim: 0.4 });
const STEEL_EDGE = mat('#f4f8fb', 0.18, { metal: 0.6, emis: 0.5 });
const IRON = mat('#7b838a', 0.4, { metal: 0.5, emis: 0.28 });
const VCOL = (() => { const m = mat('#ffffff', 0.9, { vc: true }); m.userData.vcGlow = 0.32; LIVE[LIVE.length - 1].k = 0; return m; })();
const PAPER_D = mat('#c7bb98', 0.95);
const BLUE = mat('#3b6fae', 0.8);
const COCO = mat('#6b4a2c', 0.9, { rim: 0.12 });
const COCO_R = mat('#8a5528', 0.8, { rim: 0.12 });
const FLESH = mat('#f2ead6', 0.8);
const ORE = mat('#6a5b50', 0.95);
const NUGGET = mat('#e0893f', 0.4, { metal: 0.3, emis: 0.45 });
const CRATE = mat('#7a5230', 0.85, { rim: 0.12 });
const CLOTH_B = mat('#b8553f', 0.95);
// castaway sleeve: faded teal
const SLEEVE = mat('#4a928e', 0.97, { emis: 0.3 });

/* ------------------------------------------------------------------ geometry helpers */
const hash3 = (x: number, y: number, z: number) => {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
};
const withColor = (g: THREE.BufferGeometry, r = 1, gg = 1, b = 1) => {
  const n = g.attributes.position.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = r; c[i * 3 + 1] = gg; c[i * 3 + 2] = b; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
};
const place = (g: THREE.BufferGeometry, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) => {
  g.scale(sx, sy, sz); g.translate(x, y, z); return g;
};

function roundedBox(w: number, h: number, d: number, r: number, sx = 4, sy = 4, sz = 2) {
  const g = new THREE.BoxGeometry(w, h, d, sx, sy, sz);
  const p = g.attributes.position, n = g.attributes.normal;
  const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const ix = Math.max(-hx, Math.min(hx, x)), iy = Math.max(-hy, Math.min(hy, y)), iz = Math.max(-hz, Math.min(hz, z));
    const dx = x - ix, dy = y - iy, dz = z - iz, l = Math.hypot(dx, dy, dz);
    if (l > 1e-6) { p.setXYZ(i, ix + dx / l * r, iy + dy / l * r, iz + dz / l * r); n.setXYZ(i, dx / l, dy / l, dz / l); }
  }
  return g;
}

/** Tapered rounded phalange, joint at y=0, tip at y=L (+ cap). Optional fingernail on the dorsal (-Z) side. */
function phalanx(r0: number, r1: number, L: number, nail = false) {
  const pts: THREE.Vector2[] = [];
  for (let a = 0; a <= 3; a++) { const t = a / 3 * Math.PI / 2; pts.push(new THREE.Vector2(r0 * Math.sin(t), -r0 * Math.cos(t))); }
  for (let a = 1; a <= 3; a++) { const t = a / 3 * Math.PI / 2; pts.push(new THREE.Vector2(r1 * Math.cos(t), L + r1 * Math.sin(t))); }
  pts.splice(4, 0, new THREE.Vector2(r1 * 1.02, L));
  const g = withColor(new THREE.LatheGeometry(pts, 9));
  if (!nail) return g;
  const n = withColor(new THREE.SphereGeometry(1, 8, 6), 1.0, 0.78, 0.74);
  place(n, 0, L * 0.62, -r1 * 0.78, r1 * 0.78, L * 0.5, r1 * 0.34);
  return mergeGeometries([g, n])!;
}

/* ------------------------------------------------------------------ shared geometry */
const PALM = (() => {
  const parts = [place(roundedBox(0.088, 0.088, 0.032, 0.013, 6, 6, 2), 0, 0.046, 0)];
  for (const x of [0.032, 0.0105, -0.0115, -0.032]) parts.push(place(new THREE.SphereGeometry(1, 8, 6), x, 0.086, -0.009, 0.0125, 0.012, 0.011));
  parts.push(place(new THREE.SphereGeometry(1, 8, 6), 0.027, 0.032, 0.006, 0.024, 0.032, 0.017)); // thenar pad
  parts.push(place(new THREE.SphereGeometry(1, 8, 6), -0.012, 0.022, 0.004, 0.026, 0.02, 0.016)); // heel
  return mergeGeometries(parts)!;
})();
const WRIST = place(new THREE.SphereGeometry(1, 12, 8), 0, 0.006, 0, 0.0285, 0.04, 0.019);
const FOREARM = (() => { const g = new THREE.CylinderGeometry(0.03, 0.047, 1, 12, 1); g.translate(0, 0.5, 0); return g; })();
const SLEEVE_G = (() => {
  const seg = 28, g = new THREE.CylinderGeometry(0.047, 0.064, 1, seg, 4, true);
  g.translate(0, 0.5, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = Math.round((Math.atan2(z, x) + Math.PI) / (Math.PI * 2) * seg);
    const rnd = hash3(k, 3.1, 7.7);
    let ny = y, s = 1;
    if (y > 0.99) { ny = 1 - ((k % 2) ? 0.02 + 0.04 * rnd : 0.06 + 0.2 * rnd * rnd); s = 1.03 + 0.05 * rnd; }   // ragged teeth on the cuff
    else if (y > 0.2) s = 1 + 0.025 * Math.sin(k * 1.7 + y * 6);                              // loose folds
    p.setXYZ(i, x * s, ny, z * s);
  }
  g.computeVertexNormals();
  return g;
})();
// finger phalanges: [prox, mid, distal]
const FING_G = [phalanx(0.0108, 0.0100, 0.044), phalanx(0.0100, 0.0092, 0.029), phalanx(0.0092, 0.0079, 0.024, true)];
const FING_L = [0.044, 0.029, 0.024];
const THUMB_G = [phalanx(0.0125, 0.0112, 0.036), phalanx(0.0112, 0.0093, 0.03, true)];

/* ------------------------------------------------------------------ held items
 * Items are authored upright: handle along local +Y. For "handle" grips the item is rotated so item Y runs along the
 * hand's knuckle line (X) and item +X points the way the fingers point (forward). */
const grp = (...c: THREE.Object3D[]) => { const g = new THREE.Group(); g.add(...c); return g; };

function rockGeo(r: number, seed: number, sq = 0.8) {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(r, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + (hash3(Math.round(x * 900) + seed, Math.round(y * 900), Math.round(z * 900)) - 0.5) * 0.34;
    p.setXYZ(i, x * k, y * k * sq, z * k);
  }
  g.computeVertexNormals();
  return g;
}

function lashings(y: number, r: number, n = 3) {
  // fibre binding wrapped round the handle just below the head, plus a strap over the head's neck
  const gs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) gs.push(new THREE.CylinderGeometry(r, r, 0.0085, 10, 1, true).translate(0, y + (i - (n - 1) / 2) * 0.0095, 0));
  return mesh(mergeGeometries(gs)!, mat('#b5a560', 0.95), 6);
}

function shapeGeo(pts: [number, number][], depth: number) {
  const s = new THREE.Shape(); pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1, curveSegments: 4 });
  g.translate(0, 0, -depth / 2);
  return g;
}

function handle(len: number, y0: number, r = 0.0185) {
  const h = mesh(new THREE.CylinderGeometry(r * 0.9, r * 1.12, len, 8), WOOD, 5); h.position.y = y0 + len / 2;
  const wrap = mesh(new THREE.CylinderGeometry(r * 1.17, r * 1.17, 0.115, 8), WRAP, 5); wrap.position.y = -0.045;
  const knob = mesh(new THREE.SphereGeometry(r * 1.25, 8, 6), WOOD, 5); knob.position.y = y0;
  return [h, wrap, knob];
}

function hatchet(metal: boolean) {
  const g = grp(...handle(0.46, -0.13));
  const pts: [number, number][] = [[-0.024, -0.03], [0.02, -0.036], [0.075, -0.066], [0.118, -0.082], [0.134, -0.02], [0.134, 0.03], [0.118, 0.082], [0.075, 0.07], [0.02, 0.038], [-0.024, 0.032]];
  const head = mesh(shapeGeo(pts, metal ? 0.022 : 0.03), metal ? STEEL : STONE_H, 5);
  head.position.y = 0.3; g.add(head);
  if (metal) {
    const edge = mesh(shapeGeo([[0.124, -0.082], [0.138, -0.02], [0.138, 0.03], [0.124, 0.082], [0.112, 0.06], [0.122, 0.02], [0.122, -0.04]], 0.006), STEEL_EDGE, 6);
    edge.position.y = 0.3; g.add(edge);
  } else {
    g.add(lashings(0.252, 0.0225, 3));
  }
  return g;
}

function pickaxe(metal: boolean, diamond = false) {
  const g = grp(...handle(0.5, -0.15));
  const up: [number, number][] = [], dn: [number, number][] = [];
  for (let i = 0; i <= 12; i++) {
    const x = -0.2 + 0.4 * i / 12, u = x / 0.2, c = -0.085 * u * u, t = 0.026 * (1 - Math.pow(Math.abs(u), 1.4)) + 0.002;
    up.push([x, c + t]); dn.unshift([x, c - t]);
  }
  const head = mesh(shapeGeo([...up, ...dn], metal ? 0.022 : 0.03), diamond ? DIAMOND_H : metal ? STEEL : STONE_H, 5);
  head.position.y = 0.345; g.add(head);
  if (!metal) g.add(lashings(0.292, 0.0225, 3));
  return g;
}

function logGeo(r: number, len: number) {
  const g = new THREE.CylinderGeometry(r, r * 1.06, len, 10, 1, true);
  return g;
}
function caps(r: number, len: number) {
  const a = new THREE.CircleGeometry(r * 0.96, 10); a.rotateX(-Math.PI / 2); a.translate(0, len / 2 + 0.0008, 0);
  const b = new THREE.CircleGeometry(r * 0.96, 10); b.rotateX(Math.PI / 2); b.translate(0, -len / 2 - 0.0008, 0);
  return mergeGeometries([a, b])!;
}

const FLAME_G = (() => {
  const pts = [[0.0, 0], [0.14, 0.05], [0.2, 0.2], [0.17, 0.45], [0.09, 0.72], [0.0, 1]].map(([r, y]) => new THREE.Vector2(r * 5, y));
  return new THREE.LatheGeometry(pts, 9);
})();

function build(id: ItemId, left = false): THREE.Group {
  switch (id) {
    case 'rock': return grp(mesh(rockGeo(0.056, 1, 0.82), STONE, 5));
    case 'stone': return grp(mesh(rockGeo(0.046, 7, 0.75), mat('#b7b6af', 0.95, { rim: 0.1 }), 5));
    case 'metal_ore': {
      const g = grp(mesh(rockGeo(0.05, 13, 0.8), ORE, 5));
      for (const [x, y, z, r] of [[0.03, 0.025, 0.03, 0.013], [-0.032, 0.012, 0.03, 0.01], [0.012, -0.02, 0.046, 0.011], [-0.01, 0.04, -0.02, 0.009]]) {
        const n = mesh(rockGeo(r, 3, 0.9), NUGGET, 5); n.position.set(x, y, z); g.add(n);
      }
      return g;
    }
    case 'wood': {
      const g = grp(mesh(logGeo(0.03, 0.26), mat('#6e4a2a', 0.95, { rim: 0.1 }), 5), mesh(caps(0.03, 0.26), WOOD_L, 5));
      const nub = mesh(new THREE.CylinderGeometry(0.008, 0.011, 0.03, 6), WOOD_D, 5); nub.position.set(0.026, 0.05, 0.0); nub.rotation.z = -1.2; g.add(nub);
      return g;
    }
    case 'coconut': case 'roasted_coconut': {
      const roast = id === 'roasted_coconut';
      const body = place(new THREE.IcosahedronGeometry(1, 2), 0, 0, 0, 0.056, 0.06, 0.056);
      const g = grp(mesh(body, roast ? COCO_R : COCO, 11));
      if (roast) {
        const top = new THREE.CircleGeometry(0.03, 12); top.rotateX(-Math.PI / 2); top.translate(0, 0.052, 0);
        g.add(mesh(top, FLESH, 11));
        const rim = new THREE.CylinderGeometry(0.031, 0.034, 0.008, 12, 1, true); rim.translate(0, 0.05, 0);
        g.add(mesh(rim, COCO_R, 11));
      } else {
        const eyes = mergeGeometries([[0.014, 0.054, 0.012], [-0.012, 0.054, 0.014], [0.0, 0.052, -0.016]].map(([x, y, z]) => place(new THREE.SphereGeometry(1, 6, 4), x, y, z, 0.007, 0.004, 0.007)))!;
        g.add(mesh(eyes, mat('#2c1d10', 0.9), 11));
      }
      return g;
    }
    case 'flower_daisy': case 'flower_poppy': case 'flower_bluebell': case 'flower_sunflower': case 'flower_hibiscus': case 'flower_lavender': case 'flower_orchid': case 'flower_paradise': {
      // the flower itself, small, held by the stem
      const k = ITEMS[id].flower ?? 0, g = flowerGeometry(k).clone(), s = 0.2 / Math.max(0.3, FLOWERS[k].h);
      g.scale(s, s, s); g.translate(0, -0.04, 0);
      return grp(mesh(g, VCOL, 11));
    }
    case 'picture_frame': {
      const fr = mat('#8a5a30', 0.8), pap = mat('#f3eee2', 0.95);
      const parts = [place(new THREE.BoxGeometry(0.2, 0.02, 0.012), 0, 0.075, 0), place(new THREE.BoxGeometry(0.2, 0.02, 0.012), 0, -0.075, 0), place(new THREE.BoxGeometry(0.02, 0.13, 0.012), 0.09, 0, 0), place(new THREE.BoxGeometry(0.02, 0.13, 0.012), -0.09, 0, 0)];
      const g = grp(mesh(mergeGeometries(parts)!, fr, 11));
      g.add(mesh(place(new THREE.PlaneGeometry(0.17, 0.13), 0, 0, 0.002), pap, 11));
      return g;
    }
    case 'turtle_egg': return grp(mesh(withColor(place(new THREE.IcosahedronGeometry(1, 2), 0, 0.01, 0, 0.032, 0.03, 0.032), 0.95, 0.93, 0.87), VCOL, 11));
    case 'berries': {
      const parts: THREE.BufferGeometry[] = [];
      const pos = [[0, 0.01, 0, 1], [0.034, 0, 0.012, 0.9], [-0.03, 0.004, 0.018, 0.95], [0.012, 0.005, 0.038, 0.9], [-0.008, 0.024, 0.012, 0.85], [0.026, 0.022, -0.012, 0.8], [-0.034, 0.016, -0.014, 0.85], [0.002, 0.012, -0.034, 0.9]];
      pos.forEach(([x, y, z, s], i) => parts.push(withColor(place(new THREE.IcosahedronGeometry(0.02 * s, 1), x, y, z), 0.62 + (i % 3) * 0.08, 0.05 + (i % 2) * 0.05, 0.1)));
      const g = grp(mesh(mergeGeometries(parts)!, VCOL, 11));
      const leaf = withColor(place(new THREE.SphereGeometry(1, 6, 4), 0.006, 0.042, 0.004, 0.022, 0.003, 0.012), 0.35, 0.7, 0.25);
      g.add(mesh(leaf, VCOL, 11));
      return g;
    }
    case 'sapling': {
      const parts: THREE.BufferGeometry[] = [withColor(place(new THREE.CylinderGeometry(0.004, 0.006, 0.16, 5), 0, 0.02, 0), 0.4, 0.26, 0.14), withColor(place(new THREE.IcosahedronGeometry(0.03, 1), 0, -0.07, 0), 0.3, 0.2, 0.12)];
      for (let i = 0; i < 6; i++) { const a = i * 1.05; parts.push(withColor(place(new THREE.SphereGeometry(1, 6, 4), Math.cos(a) * 0.03, 0.07 + 0.015 * i, Math.sin(a) * 0.03, 0.032, 0.004, 0.014), 0.3, 0.65 + 0.05 * (i % 2), 0.2)); }
      return grp(mesh(mergeGeometries(parts.map((q) => (q.index ? q.toNonIndexed() : q)))!, VCOL, 11));
    }
    case 'fiber': {
      const parts: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 9; i++) {
        const a = i * 2.4, rr = 0.007 + 0.007 * (i % 3) / 2, len = 0.22 + 0.04 * hash3(i, 1, 2);
        const s = new THREE.CylinderGeometry(0.0042, 0.0034, len, 4);
        const flare = 0.1 * Math.sin(i * 1.9);
        s.rotateX(flare * Math.cos(a)); s.rotateZ(flare * Math.sin(a));
        s.translate(Math.cos(a) * rr, 0.01 * (i % 3 - 1), Math.sin(a) * rr);
        parts.push(withColor(s, 0.55 + 0.25 * hash3(i, 5, 1), 0.65 + 0.2 * hash3(i, 2, 8), 0.28));
      }
      const g = grp(mesh(mergeGeometries(parts)!, VCOL, 5));
      const tie = new THREE.CylinderGeometry(0.0185, 0.0185, 0.012, 10, 1, true);
      const tie2 = tie.clone(); tie.translate(0, 0.045, 0); tie2.translate(0, -0.045, 0);
      g.add(mesh(mergeGeometries([tie, tie2])!, mat('#6b4a2a', 0.9), 5));
      return g;
    }
    case 'metal': {
      const g = grp(mesh(roundedBox(0.04, 0.17, 0.034, 0.007, 2, 4, 2), STEEL, 5));
      const top = mesh(roundedBox(0.026, 0.15, 0.006, 0.003, 1, 3, 1), STEEL_EDGE, 6); top.position.z = 0.0175; g.add(top);
      return g;
    }
    case 'building_plan': {
      const g = grp(mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.21, 12, 1, true), mat('#e9e0c4', 0.95), 5));
      const e = new THREE.CircleGeometry(0.024, 12); const e2 = e.clone(); e.rotateX(-Math.PI / 2); e.translate(0, 0.105, 0); e2.rotateX(Math.PI / 2); e2.translate(0, -0.105, 0);
      g.add(mesh(mergeGeometries([e, e2])!, PAPER_D, 5));
      const band = new THREE.CylinderGeometry(0.0285, 0.0285, 0.016, 12, 1, true); const b2 = band.clone(); band.translate(0, 0.055, 0); b2.translate(0, -0.055, 0);
      g.add(mesh(mergeGeometries([band, b2])!, BLUE, 6));
      return g;
    }
    case 'torch': {
      const g = grp(...handle(0.3, -0.1, 0.017));
      const rag = mesh(new THREE.CylinderGeometry(0.03, 0.022, 0.085, 9), mat('#3b2a1f', 1), 5); rag.position.y = 0.23; g.add(rag);
      const bind = mesh(new THREE.CylinderGeometry(0.031, 0.031, 0.012, 9), WRAP, 6); bind.position.y = 0.205; g.add(bind);
      const fl: THREE.Mesh[] = [];
      for (const [col, h, w, k] of [['#ff5a14', 0.17, 0.05, 0], ['#ff9a2a', 0.125, 0.036, 1], ['#ffe49a', 0.08, 0.024, 2]] as [string, number, number, number][]) {
        const m = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.88, depthWrite: false, blending: THREE.AdditiveBlending });
        m.fog = false;
        const f = mesh(FLAME_G, m, 12); f.scale.set(w, h, w); f.position.set(0, 0.27, 0); f.userData.k = k; f.frustumCulled = false; g.add(f); fl.push(f);
      }
      g.userData.tick = (t: number) => {
        for (const f of fl) {
          const k = f.userData.k as number, w = t * (10 + k * 3) + k * 2, fk = 1 + 0.16 * Math.sin(w) + 0.09 * Math.sin(w * 2.3 + 1);
          const base = [[0.17, 0.05], [0.125, 0.036], [0.08, 0.024]][k];
          f.scale.set(base[1] * (1 - 0.06 * Math.sin(w * 1.7)), base[0] * fk, base[1] * (1 + 0.06 * Math.sin(w * 1.3)));
          f.rotation.z = Math.sin(w * 0.7) * 0.08; f.rotation.x = Math.cos(w * 0.9) * 0.08;
        }
      };
      return g;
    }
    case 'campfire': {
      const parts = [[-0.021, -0.012, 0.12], [0.021, -0.012, -0.1], [0, 0.026, 0.0]].map(([x, z, tilt]) => { const c = new THREE.CylinderGeometry(0.022, 0.024, 0.2, 8); c.rotateZ(tilt * 0.3); c.translate(x, 0, z); return c; });
      const g = grp(mesh(mergeGeometries(parts)!, WOOD, 5));
      const ends = [[-0.021, -0.012], [0.021, -0.012], [0, 0.026]].map(([x, z]) => { const c = new THREE.CircleGeometry(0.02, 8); c.rotateX(-Math.PI / 2); c.translate(x, 0.101, z); return c; });
      g.add(mesh(mergeGeometries(ends)!, WOOD_L, 6));
      return g;
    }
    case 'furnace': {
      const g = grp(mesh(roundedBox(0.11, 0.095, 0.095, 0.014, 3, 3, 3), STONE_H, 5));
      const mouth = mesh(roundedBox(0.05, 0.042, 0.016, 0.01, 2, 2, 1), mat('#3a2f29', 0.9), 6); mouth.position.set(0, -0.012, 0.047); g.add(mouth);
      const ch = mesh(new THREE.CylinderGeometry(0.018, 0.024, 0.05, 8), STONE, 5); ch.position.set(0.02, 0.07, -0.01); g.add(ch);
      return g;
    }
    case 'workbench': {
      if (left) {
        const g = grp(mesh(roundedBox(0.05, 0.22, 0.014, 0.004, 1, 4, 1), WOOD_L, 5));
        const nails = mergeGeometries([0.07, -0.07].map((y) => place(new THREE.CylinderGeometry(1, 1, 1, 5), 0.012, y, 0.008, 0.004, 0.006, 0.004)))!;
        g.add(mesh(nails, IRON, 6));
        const grain = mesh(roundedBox(0.006, 0.2, 0.002, 0.001, 1, 2, 1), WOOD, 6); grain.position.set(-0.01, 0, 0.0075); g.add(grain);
        return g;
      }
      const g = grp(...handle(0.26, -0.1, 0.016));
      const head = mesh(roundedBox(0.11, 0.06, 0.06, 0.008, 3, 2, 2), WOOD_D, 5); head.position.y = 0.17; g.add(head);
      for (const s of [-1, 1]) { const b = mesh(new THREE.BoxGeometry(0.012, 0.064, 0.064), IRON, 6); b.position.set(s * 0.045, 0.17, 0); g.add(b); }
      return g;
    }
    case 'sleeping_bag':
    case 'bed': {
      const g = grp(mesh(new THREE.CylinderGeometry(0.043, 0.043, 0.2, 14, 1, true), CLOTH_B, 5));
      const e = new THREE.CircleGeometry(0.041, 14); const e2 = e.clone(); e.rotateX(-Math.PI / 2); e.translate(0, 0.1, 0); e2.rotateX(Math.PI / 2); e2.translate(0, -0.1, 0);
      g.add(mesh(mergeGeometries([e, e2])!, mat('#d9c9a0', 0.95), 5));
      const st = new THREE.CylinderGeometry(0.0445, 0.0445, 0.012, 14, 1, true); const st2 = st.clone(); st.translate(0, 0.055, 0); st2.translate(0, -0.055, 0);
      g.add(mesh(mergeGeometries([st, st2])!, LEATHER, 6));
      return g;
    }
    case 'box': return grp(mesh(roundedBox(0.105, 0.09, 0.105, 0.008, 6, 6, 6), CRATE, 5));
    case 'spear': {
      const g = grp(...handle(0.46, -0.14, 0.0165));
      const blade = mesh(shapeGeo([[0.0, -0.01], [0.021, 0.025], [0.014, 0.075], [0.0, 0.135], [-0.014, 0.075], [-0.021, 0.025]].map(([x, y]) => [y, x] as [number, number]).map(([a, b]) => [b, a] as [number, number]), 0.012), STONE_H, 5);
      blade.position.y = 0.3; g.add(blade);
      g.add(lashings(0.292, 0.0205, 4));
      return g;
    }
    case 'fishing_rod': {
      const g = new THREE.Group();
      const lean = new THREE.Group(); lean.rotation.z = -0.5; g.add(lean);
      const cork = mesh(new THREE.CylinderGeometry(0.0185, 0.017, 0.15, 10), mat('#c9a36c', 0.9, { rim: 0.1 }), 5); cork.position.y = -0.045; lean.add(cork);
      const rod = mesh(new THREE.CylinderGeometry(0.0042, 0.0125, 0.6, 8), mat('#5a3a1e', 0.7, { rim: 0.15 }), 5); rod.position.y = 0.33; lean.add(rod);
      const reel = mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.014, 12), IRON, 6); reel.rotation.z = Math.PI / 2; reel.position.set(0.026, 0.03, 0); lean.add(reel);
      const spool = mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.017, 10), mat('#e9e9e4', 0.9), 7); spool.rotation.z = Math.PI / 2; spool.position.set(0.026, 0.03, 0); lean.add(spool);
      for (const [y, r] of [[0.14, 0.009], [0.28, 0.0075], [0.42, 0.006], [0.62, 0.004]]) {
        const ring = mesh(new THREE.TorusGeometry(r, 0.0013, 4, 10), STEEL, 6); ring.position.set(0.0, y, 0.0); ring.rotation.y = Math.PI / 2; ring.position.x = r + 0.003; lean.add(ring);
      }
      lean.add(lashings(0.18, 0.0135, 2));
      return g;
    }
    case 'meat_stick': case 'roast_stick': {
      // a long green stick with chunks of meat skewered on its far end; the raw one browns as it roasts (ROAST)
      const g = new THREE.Group();
      const stick = mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.74, 7), WOOD, 5); stick.position.y = 0.25; g.add(stick);
      const end = mesh(new THREE.ConeGeometry(0.008, 0.03, 6), WOOD_L, 5); end.position.y = 0.635; g.add(end);
      let meat: THREE.Material;
      if (id === 'roast_stick') meat = mat('#6e3618', 0.6, { rim: 0.15 });
      else {
        const m = mat('#b8434d', 0.7, { rim: 0.12 });
        ROAST_MATS.push(m);
        meat = m;
      }
      [[0.47, 0.034, 0.3], [0.53, 0.04, 1.7], [0.59, 0.032, 2.9]].forEach(([y, r, sd]) => {
        const k = mesh(rockGeo(r, sd * 10, 0.85), meat, 6); k.position.set(0, y, 0); k.rotation.y = sd; g.add(k);
      });
      const tip = new THREE.Object3D(); tip.position.y = 0.53; g.add(tip); g.userData.tip = tip;
      return g;
    }
    case 'guitar': {
      // neck along +y (held in the hand at the nut end), the top with its strings facing -z, the body hanging below
      const g = new THREE.Group();
      const body = mat('#c98a43', 0.55, { rim: 0.18 }), dark = mat('#4a2a14', 0.7), side = mat('#8a5328', 0.7);
      const pts: [number, number][] = [];
      const half = (y: number) => {
        const lo = 0.165 ** 2 - (y + 0.68) ** 2, up = 0.125 ** 2 - (y + 0.45) ** 2;
        return Math.max(lo > 0 ? Math.sqrt(lo) : 0, up > 0 ? Math.sqrt(up) : 0, (y > -0.6 && y < -0.5) ? 0.1 : 0);
      };
      const N = 26, y0 = -0.844, y1 = -0.326;
      for (let i = 0; i <= N; i++) { const y = y0 + (y1 - y0) * (i / N); pts.push([half(y) || 0.01, y]); }
      for (let i = N; i >= 0; i--) { const y = y0 + (y1 - y0) * (i / N); pts.push([-(half(y) || 0.01), y]); }
      const top = mesh(shapeGeo(pts, 0.004), body, 5); top.position.z = -0.042; g.add(top);
      const back = mesh(shapeGeo(pts, 0.07), side, 5); back.position.z = 0.0; g.add(back);
      const hole = mesh(new THREE.CircleGeometry(0.042, 20), dark, 7); hole.position.set(0, -0.5, -0.0485); hole.rotation.y = Math.PI; g.add(hole);
      const ros = mesh(new THREE.RingGeometry(0.046, 0.054, 24), mat('#f1e3c2', 0.6), 7); ros.position.set(0, -0.5, -0.0482); ros.rotation.y = Math.PI; g.add(ros);
      const bridge = mesh(roundedBox(0.09, 0.022, 0.01, 0.003, 2, 1, 1), dark, 7); bridge.position.set(0, -0.72, -0.05); g.add(bridge);
      const neck = mesh(roundedBox(0.046, 0.5, 0.026, 0.008, 2, 4, 2), side, 5); neck.position.set(0, -0.1, -0.022); g.add(neck);
      const board = mesh(new THREE.BoxGeometry(0.044, 0.5, 0.006), dark, 6); board.position.set(0, -0.1, -0.037); g.add(board);
      const frets = mergeGeometries(Array.from({ length: 9 }, (_, i) => new THREE.BoxGeometry(0.044, 0.0022, 0.003).translate(0, 0.13 - i * (0.045 - i * 0.0015), -0.0415)))!;
      g.add(mesh(frets, STEEL, 7));
      const head = mesh(roundedBox(0.06, 0.13, 0.016, 0.01, 2, 2, 1), dark, 5); head.position.set(0, 0.215, -0.02); head.rotation.x = 0.2; g.add(head);
      const pegs = mergeGeometries([-1, 1].flatMap((sx) => [0, 1, 2].map((k) => new THREE.CylinderGeometry(0.005, 0.005, 0.03, 6).rotateZ(Math.PI / 2).translate(sx * 0.042, 0.18 + k * 0.032, -0.02))))!;
      g.add(mesh(pegs, IRON, 6));
      const strings = mergeGeometries(Array.from({ length: 6 }, (_, i) => new THREE.CylinderGeometry(0.0009 + (5 - i) * 0.0002, 0.0009 + (5 - i) * 0.0002, 0.88, 3).translate(0, -0.29, 0).translate((i - 2.5) * 0.0075, 0, -0.047)))!;
      g.add(mesh(strings, mat('#f4efe2', 0.3, { metal: 0.4, emis: 0.6 }), 8));
      const zone = new THREE.Object3D(); zone.position.set(0, -0.53, -0.05); g.add(zone); g.userData.strum = zone;
      return g;
    }
    case 'raw_meat': case 'cooked_meat': {
      const cooked = id === 'cooked_meat';
      const g = grp(mesh(place(new THREE.IcosahedronGeometry(1, 2), 0, 0, 0, 0.05, 0.085, 0.036), mat(cooked ? '#7a4422' : '#b8434d', 0.75, { rim: 0.12 }), 11));
      const top = mesh(place(new THREE.IcosahedronGeometry(1, 1), 0.012, 0.01, 0.026, 0.028, 0.05, 0.012), mat(cooked ? '#a8703c' : '#f0cfc4', 0.8), 12); g.add(top);
      const bone = mesh(new THREE.CylinderGeometry(0.0085, 0.0085, 0.06, 7), mat('#efe6d2', 0.8), 12); bone.position.y = 0.09; g.add(bone);
      const knob = mesh(new THREE.SphereGeometry(0.0125, 7, 5), mat('#efe6d2', 0.8), 12); knob.position.y = 0.122; g.add(knob);
      return g;
    }
    case 'raw_fish': case 'cooked_fish': {
      const cooked = id === 'cooked_fish';
      const g = grp(mesh(place(new THREE.IcosahedronGeometry(1, 2), 0, 0, 0, 0.026, 0.085, 0.0155), mat(cooked ? '#c98a4e' : '#6fa8c9', 0.55, { rim: 0.2 }), 11));
      const belly = mesh(place(new THREE.IcosahedronGeometry(1, 1), 0, 0.0, 0.008, 0.021, 0.088, 0.011), mat(cooked ? '#e8c58f' : '#d4e8f2', 0.6), 12); g.add(belly);
      const tail = mesh(shapeGeo([[0, 0], [0.032, -0.04], [0.032, 0.0], [0.032, 0.04]].map(([x, y]) => [y, x] as [number, number]).reverse(), 0.004), mat(cooked ? '#a8703c' : '#4f87a8', 0.6, { double: true }), 11);
      tail.position.set(0, -0.105, 0); tail.rotation.z = Math.PI / 2; g.add(tail);
      const eye = mesh(new THREE.SphereGeometry(0.0055, 6, 4), mat(cooked ? '#e8e0cc' : '#10232d', 0.4), 13); eye.position.set(0.012, 0.075, 0.012); g.add(eye);
      const fin = mesh(shapeGeo([[0, 0], [0.03, 0.0], [0.0, 0.04]], 0.003), mat(cooked ? '#a8703c' : '#4f87a8', 0.6, { double: true }), 11);
      fin.position.set(-0.01, 0.0, 0.0); fin.rotation.y = 0; g.add(fin);
      return g;
    }
    case 'leather': {
      const g = grp(mesh(roundedBox(0.17, 0.045, 0.12, 0.012, 3, 2, 3), mat('#a8693a', 0.9, { rim: 0.2 }), 5));
      g.add(mesh(roundedBox(0.12, 0.012, 0.07, 0.004, 2, 1, 2), mat('#d9a470', 0.9), 6));
      g.children[1].position.y = 0.02;
      return g;
    }
    case 'leather_cap': case 'metal_helmet': case 'diamond_helmet': case 'leather_vest': case 'metal_chestplate': case 'diamond_chestplate':
    case 'leather_pants': case 'metal_greaves': case 'diamond_greaves': {
      const a = ITEMS[id].armor!, c = ARMOR_TIER_COLOR[a.tier], soft = a.tier === 1;
      const main = mat(c.main, soft ? 0.9 : 0.35, { metal: soft ? 0 : 0.35, rim: 0.3 }), dark = mat(c.dark, 0.8);
      const g = new THREE.Group();
      if (a.slot === 'head') {
        g.add(mesh(new THREE.SphereGeometry(0.085, 14, 9, 0, Math.PI * 2, 0, Math.PI * 0.55), main, 5));
        const rim = mesh(new THREE.CylinderGeometry(0.088, 0.088, 0.014, 14), dark, 6); rim.position.y = -0.002; g.add(rim);
        if (!soft) { const crest = mesh(roundedBox(0.012, 0.05, 0.12, 0.004, 1, 2, 3), dark, 6); crest.position.y = 0.075; g.add(crest); }
        g.position.y = 0.03;
      } else if (a.slot === 'chest') {
        g.add(mesh(roundedBox(0.15, 0.17, 0.05, 0.016, 3, 3, 2), main, 5));
        for (const x of [-1, 1]) { const sh = mesh(roundedBox(0.05, 0.03, 0.06, 0.01, 2, 1, 2), dark, 6); sh.position.set(x * 0.085, 0.08, 0); g.add(sh); }
        const belt = mesh(roundedBox(0.152, 0.025, 0.052, 0.006, 3, 1, 2), dark, 6); belt.position.y = -0.07; g.add(belt);
      } else {
        for (const x of [-1, 1]) {
          const leg = mesh(new THREE.CylinderGeometry(0.036, 0.03, 0.17, 10), main, 5); leg.position.x = x * 0.04; g.add(leg);
          const cuff = mesh(new THREE.CylinderGeometry(0.033, 0.033, 0.02, 10), dark, 6); cuff.position.set(x * 0.04, -0.075, 0); g.add(cuff);
        }
        const belt = mesh(roundedBox(0.15, 0.022, 0.07, 0.006, 3, 1, 2), dark, 6); belt.position.y = 0.08; g.add(belt);
      }
      return g;
    }
    case 'boat': {
      // a toy of the boat: a half-egg hull, white over red, a wooden inside and the outboard
      const hull = place(new THREE.SphereGeometry(1, 14, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), 0, 0.02, 0, 0.05, 0.04, 0.11);
      const g = grp(mesh(hull, mat('#f2efe6', 0.6, { double: true }), 11));
      g.add(mesh(place(new THREE.SphereGeometry(1, 14, 4, 0, Math.PI * 2, Math.PI * 0.72, Math.PI * 0.28), 0, 0.021, 0, 0.051, 0.041, 0.111), mat('#9c3324', 0.7), 11));
      const deck = new THREE.CircleGeometry(1, 14); deck.rotateX(-Math.PI / 2); deck.scale(0.046, 1, 0.104); deck.translate(0, 0.012, 0);
      g.add(mesh(deck, mat('#9a6a3c', 0.85), 12));
      g.add(mesh(place(new THREE.BoxGeometry(0.018, 0.026, 0.022), 0, 0.03, 0.105), mat('#2b2f33', 0.5), 12));
      g.rotation.y = 0.4;
      return g;
    }
    case 'hatchet': return hatchet(false);
    case 'metal_hatchet': return hatchet(true);
    case 'pickaxe': return pickaxe(false);
    case 'metal_pickaxe': return pickaxe(true);
    case 'diamond_pickaxe': return pickaxe(true, true);
  }
  return new THREE.Group();
}

/* ------------------------------------------------------------------ grips
 * fit = finger flexion [prox, mid, distal] (rad) that wraps the object; cy/cz = where the item sits relative to the wrist
 * (y along the fingers, z out of the palm); gy = which point of a handle sits in the palm. th = [rx, rz, tip curl] of the
 * closed thumb. over = item drawn over the fingers (palm-up holds). */
type Fit = [number, number, number];
interface Grip { fit: Fit; cy: number; cz: number; handle?: boolean; gy?: number; roll?: number; fz?: number; fx?: number; th: [number, number, number]; over?: boolean; loose?: number; hx?: number }
const F_HANDLE: Fit = [1.35, 1.02, 0.97], F_LOG: Fit = [1.08, 0.68, 0.71], F_SMALL: Fit = [0.93, 0.51, 0.58], F_ROCK: Fit = [0.81, 0.37, 0.48], F_BIG: Fit = [0.71, 0.28, 0.41];
const F_FIST: Fit = [1.3, 1.4, 1.0];
const G_HANDLE: Grip = { fit: F_HANDLE, cy: 0.07, cz: 0.035, handle: true, gy: -0.02, th: [0.9, 0.9, 0.5], fz: 0.6 };
const G_LOG: Grip = { fit: F_LOG, cy: 0.07, cz: 0.047, handle: true, gy: 0, th: [0.8, 0.8, 0.4], fz: 0.1 };
const G_ROCK: Grip = { fit: F_ROCK, cy: 0.064, cz: 0.058, th: [0.9, 0.5, 0.35], roll: 0.1, fz: 0.1 };
const G_STONE: Grip = { fit: F_SMALL, cy: 0.07, cz: 0.057, th: [0.9, 0.5, 0.35], roll: 0.3, fz: 0.1 };
const G_CUP: Grip = { fit: F_ROCK, cy: 0.075, cz: 0.072, th: [0.7, 0.4, 0.3], roll: 1.0, fz: 0.0, over: true, loose: 0.8 };
const G_BERRY: Grip = { fit: F_SMALL, cy: 0.07, cz: 0.05, th: [0.6, 0.4, 0.3], roll: 1.05, fz: 0.0, over: true, loose: 0.6 };
const G_BUNDLE: Grip = { fit: F_SMALL, cy: 0.07, cz: 0.057, handle: true, gy: 0, th: [0.85, 0.7, 0.4], fz: 0.15 };
const G_BIG: Grip = { fit: F_BIG, cy: 0.07, cz: 0.075, th: [0.9, 0.5, 0.35], roll: 0.2, fz: 0.1 };
const GRIPS: Record<ItemId, Grip> = {
  rock: G_ROCK, hatchet: G_HANDLE, pickaxe: { ...G_HANDLE, gy: -0.04 }, metal_hatchet: G_HANDLE, metal_pickaxe: { ...G_HANDLE, gy: -0.04 }, diamond_pickaxe: { ...G_HANDLE, gy: -0.04 }, coal: G_STONE, diamond: G_STONE,
  wood: G_LOG, stone: G_STONE, metal_ore: G_STONE, metal: G_LOG, fiber: G_BUNDLE, coconut: G_CUP, berries: G_BERRY, roasted_coconut: G_CUP, turtle_egg: G_BERRY, picture_frame: G_BIG, flower_pot: G_BIG, rug: G_BUNDLE, lantern: G_HANDLE, table: G_BIG, cat_bed: G_BIG, door: G_BIG, flower_daisy: G_HANDLE, flower_poppy: G_HANDLE, flower_bluebell: G_HANDLE, flower_sunflower: G_HANDLE, flower_hibiscus: G_HANDLE, flower_lavender: G_HANDLE, flower_orchid: G_HANDLE, flower_paradise: G_HANDLE,
  spear: { ...G_HANDLE, gy: -0.08, cy: 0.07 }, fishing_rod: { ...G_HANDLE, gy: -0.06, fit: [1.3, 1.0, 0.95] }, raw_meat: G_STONE, cooked_meat: G_STONE, raw_fish: G_BUNDLE, cooked_fish: G_BUNDLE,
  sapling: G_BUNDLE, campfire: G_BUNDLE, torch: { ...G_HANDLE, gy: -0.03 }, furnace: G_BIG, workbench: { ...G_HANDLE, gy: -0.04 }, bed: G_BUNDLE, sleeping_bag: G_BUNDLE, box: G_BIG, building_plan: G_LOG,
  leather: G_BUNDLE, leather_cap: G_BIG, leather_vest: G_BIG, leather_pants: G_BIG, metal_helmet: G_BIG, metal_chestplate: G_BIG, metal_greaves: G_BIG,
  diamond_helmet: G_BIG, diamond_chestplate: G_BIG, diamond_greaves: G_BIG, boat: G_BIG,
  meat_stick: { ...G_HANDLE, gy: 0.0 }, roast_stick: { ...G_HANDLE, gy: 0.0 }, guitar: { ...G_HANDLE, gy: -0.02 },
};
const DESK_POSE: Partial<Record<ItemId, [number, number, number]>> = { meat_stick: [1.2, 0, -0.4], roast_stick: [1.2, 0, -0.4], guitar: [1.1, 0.35, 0.5] };
const GRIP_L: Partial<Record<ItemId, Grip>> = { workbench: { ...G_LOG, fit: F_HANDLE, cz: 0.034, th: [0.9, 0.8, 0.4], roll: 0.2, fz: 0.1 } };
const NO_GRIP: Grip = { fit: F_FIST, cy: 0, cz: 0, th: [0.8, 0.7, 0.4], roll: 0, fz: 0.0, loose: 0.9 };

/** a hand part for the merged skinned hand: white vertex colour where it has none, every vertex on bone `bone` */
function skinPart(src: THREE.BufferGeometry, bone: number) {
  const g = src.clone();
  if (g.getAttribute('uv')) g.deleteAttribute('uv');
  if (!g.getAttribute('color')) withColor(g);
  const n = g.attributes.position.count, si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { si[i * 4] = bone; sw[i * 4] = 1; }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  return g;
}

/* ------------------------------------------------------------------ hand rig */
interface Finger { root: THREE.Group; p: THREE.Group; m: THREE.Group; d: THREE.Group; sc: number }
interface Pose { dx: number; dy: number; dz: number; ex: number; ey: number; ez: number; roll: number; fx: number; fy: number; fz: number; curl: number; th: number; spread: number; mul: number }
const newPose = (): Pose => ({ dx: 0, dy: 0, dz: 0, ex: 0, ey: 0, ez: 0, roll: 0, fx: 0, fy: 0, fz: 0, curl: 0, th: 0, spread: 0, mul: 1 });

const FINGER_X = [0.032, 0.0105, -0.0115, -0.032];
const FINGER_Y = [0.088, 0.091, 0.089, 0.083];
const FINGER_SC = [1.0, 1.07, 1.0, 0.82];
const OPEN: Fit = [0.1, 0.16, 0.1];

class HandRig {
  readonly g = new THREE.Group();        // oriented at the wrist each frame
  readonly arm = new THREE.Group();      // elbow -> wrist frame
  readonly anchor = new THREE.Group();   // held item parent (inside g)
  readonly fingers: Finger[] = [];
  readonly tb = new THREE.Group();
  readonly ts = new THREE.Group();
  readonly forearm: THREE.Mesh;
  readonly sleeve: THREE.Mesh;
  readonly E = new THREE.Vector3();
  readonly W = new THREE.Vector3();
  readonly pose = newPose();
  item: THREE.Group | null = null;
  grip: Grip = NO_GRIP;
  stow = 0;

  constructor(readonly side: 1 | -1) {
    this.forearm = mesh(FOREARM, SKIN_ARM, 1);
    this.forearm.scale.set(1.04, 1, 0.92);
    this.sleeve = mesh(SLEEVE_G, SLEEVE, 2);
    this.arm.add(this.forearm, this.sleeve);
    // the whole hand (palm, wrist, fingers, thumb) is ONE skinned mesh: every part rides a bone placed in the joint group it
    // used to hang from, so the finger poses below work as before but the hand costs one draw instead of sixteen
    const bones: THREE.Bone[] = [], parts: THREE.BufferGeometry[] = [];
    const part = (g: THREE.BufferGeometry, at: THREE.Object3D) => { const b = new THREE.Bone(); at.add(b); parts.push(skinPart(g, bones.length)); bones.push(b); };
    part(WRIST, this.g); part(PALM, this.g);
    for (let i = 0; i < 4; i++) {
      const root = new THREE.Group(); root.position.set(FINGER_X[i], FINGER_Y[i], -0.002); root.scale.setScalar(FINGER_SC[i]);
      const p = new THREE.Group(), m = new THREE.Group(), d = new THREE.Group();
      m.position.y = FING_L[0]; d.position.y = FING_L[1];
      m.add(d); p.add(m); root.add(p); this.g.add(root);
      part(FING_G[0], p); part(FING_G[1], m); part(FING_G[2], d);
      this.fingers.push({ root, p, m, d, sc: FINGER_SC[i] });
    }
    this.tb.position.set(0.039, 0.03, 0.008); this.tb.rotation.order = 'ZXY';
    this.ts.position.y = 0.036; this.tb.add(this.ts);
    part(THUMB_G[0], this.tb); part(THUMB_G[1], this.ts);
    const hand = new THREE.SkinnedMesh(mergeGeometries(parts)!, SKIN_F);
    hand.renderOrder = 1006; hand.frustumCulled = false;
    // bones carry no bind offset: each part is modelled in its own joint's frame
    hand.bind(new THREE.Skeleton(bones, bones.map(() => new THREE.Matrix4())), new THREE.Matrix4());
    this.g.add(hand, this.tb, this.anchor);
    this.g.scale.x = side;
  }

  setItem(it: THREE.Group | null, grip: Grip) {
    if (this.item) this.anchor.remove(this.item);
    this.item = it; this.grip = grip;
    if (it) {
      this.anchor.add(it);
      const ord = grip.over ? 5 : 0;
      if (ord) it.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.renderOrder < 1011) o.renderOrder = 1011; });
    }
    this.anchor.quaternion.copy(grip.handle ? Q_HANDLE : Q_ID);
    this.anchor.position.set(grip.handle ? -(grip.gy ?? 0) : (grip.hx ?? 0), grip.cy, grip.cz);
  }
}
const Q_ID = new THREE.Quaternion();
const Q_HANDLE = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 1, 0).normalize(), Math.PI);

const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _qf = new THREE.Quaternion(), _e = new THREE.Euler();
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const eo = (k: number) => 1 - (1 - k) * (1 - k);
const sm = (k: number) => k * k * (3 - 2 * k);
const sat = (k: number) => clamp(k, 0, 1);

/** pose the fingers/thumb of one hand from its pose scalars */
function curlHand(h: HandRig, time: number) {
  const P = h.pose, gp = h.grip, c = P.curl, fit = gp.fit, mul = P.mul * (gp.loose ?? 1);
  for (let i = 0; i < 4; i++) {
    const f = h.fingers[i], st = i / 3;
    const cc = c * (1 + 0.03 * (i - 1));
    const o0 = OPEN[0] + st * 0.07, o1 = OPEN[1] + st * 0.12, o2 = OPEN[2] + st * 0.05;
    f.p.rotation.x = o0 + (fit[0] * mul - o0) * cc;
    f.m.rotation.x = o1 + (fit[1] * mul - o1) * cc;
    f.d.rotation.x = o2 + (fit[2] * mul - o2) * cc;
    f.root.rotation.z = -P.spread * (1.5 - i) * 0.33 - (1.5 - i) * 0.03;
  }
  // thumb: lerp relaxed -> closed pose by P.th
  const k = P.th, th = gp.th;
  h.tb.rotation.x = lerp(0.3, th[0], k);
  h.tb.rotation.z = lerp(-0.5 - P.spread * 0.4, th[1], k);
  h.ts.rotation.x = lerp(0.15, th[2], k);
  h.tb.rotation.y = 0;
  void time;
}

/** place elbow->wrist chain and orient the hand */
function poseArm(h: HandRig) {
  const P = h.pose, side = h.side, E = h.E, W = h.W;
  _y.subVectors(W, E);
  const len = _y.length(); _y.multiplyScalar(1 / len);
  _x.set(0, side, 0); _x.addScaledVector(_y, -_x.dot(_y));
  if (_x.lengthSq() < 1e-5) _x.set(side, 0, 0);
  _x.normalize(); _z.crossVectors(_x, _y);
  _m.makeBasis(_x, _y, _z); _q.setFromRotationMatrix(_m);
  h.arm.position.copy(E); h.arm.quaternion.copy(_q);
  h.forearm.scale.y = len + 0.022;
  const sl = Math.max(0.05, len - 0.075);
  h.sleeve.scale.y = sl;
  // hand: forearm basis, roll about the forearm axis, then wrist flex in local axes
  _qf.setFromAxisAngle(_y, P.roll * side);
  _q.premultiply(_qf);
  _e.set(P.fx, P.fy * side, P.fz * side, 'XYZ'); _qf.setFromEuler(_e);
  _q.multiply(_qf);
  h.g.position.copy(W); h.g.quaternion.copy(_q);
}

/* ------------------------------------------------------------------ the view model */
export class ViewModel {
  readonly root = new THREE.Group();
  onHit: (() => void) | null = null;

  private rig = new THREE.Group();
  private R = new HandRig(1);
  private Lh = new HandRig(-1);
  private cache = new Map<string, THREE.Group>();
  private cam: THREE.PerspectiveCamera;
  private current: ItemId | null | undefined = undefined;
  private pending: ItemId | null = null;
  private equipT = 1; private equipSwapped = true;
  private swingT = -1; private hitFired = false;
  private eatT = -1; private reachT = -1; private placeT = -1;
  private drinkWas = false; private drinkK = 0; private drinkT = 0;
  private bob = 0; private walkK = 0; private sprintK = 0; private swimK = 0; private swimPh = 0;
  private lagX = 0; private lagY = 0; private spY = 0; private spV = 0;
  private wasGround = true; private lastVy = 0;

  constructor(camera: THREE.PerspectiveCamera) {
    this.cam = camera;
    this.rig.add(this.R.arm, this.R.g, this.Lh.arm, this.Lh.g);
    this.root.add(this.rig);
    camera.add(this.root);
    this.apply(null);
  }

  get swinging() { return this.swingT >= 0; }

  private getItem(id: ItemId, left: boolean) {
    const key = id + (left ? ':L' : '');
    let g = this.cache.get(key);
    if (!g) {
      g = build(id, left);
      // on a screen (not in VR) a few long things are tilted out of the upright hatchet hold: the stick points ahead
      // at the fire, the guitar lies across you as if you were playing it
      const d = DESK_POSE[id];
      if (d) g.rotation.set(d[0], d[1], d[2]);
      this.cache.set(key, g);
    }
    return g;
  }
  private apply(id: ItemId | null) {
    this.current = id;
    this.R.setItem(id ? this.getItem(id, false) : null, id ? GRIPS[id] : NO_GRIP);
    const lg = id ? GRIP_L[id] : undefined;
    this.Lh.setItem(id && lg ? this.getItem(id, true) : null, lg ?? NO_GRIP);
  }

  setItem(id: ItemId | null) {
    if (id === this.current && this.equipSwapped) return;
    if (id === this.pending && !this.equipSwapped) return;
    if (this.current === undefined) { this.apply(id); this.equipT = 0.5; this.equipSwapped = true; return; }
    this.pending = id;
    if (this.equipSwapped) { this.equipT = 0; this.equipSwapped = false; }
    this.swingT = -1; this.eatT = -1; this.placeT = -1;
  }

  swing() {
    if (this.swingT >= 0) return;
    if (!(this.current && ITEMS[this.current].tool)) { this.place(); return; }
    this.swingT = 0; this.hitFired = false;
  }
  eat() { if (this.eatT < 0) this.eatT = 0; }
  reach() { if (this.reachT < 0) this.reachT = 0; }
  place() { if (this.placeT < 0) this.placeT = 0; }
  drink(active: boolean) {
    if (active && !this.drinkWas) this.drinkT = 0;
    this.drinkWas = active;
  }
  visible(v: boolean) { this.root.visible = v; }

  /** one crawl stroke: the hand sweeps forward through the air, then pulls back low in the water */
  private stroke(side: number, p: number, sx: number, r0x: number, r0y: number, r0z: number, P: Pose, swk: number) {
    const z = -0.42 + 0.14 * Math.cos(p), y = -0.23 + 0.1 * Math.sin(p);
    const x = side * (sx - 0.04 * Math.sin(p));
    P.dx += (x - r0x) * swk; P.dy += (y - r0y) * swk; P.dz += (z - r0z) * swk;
    P.roll = lerp(P.roll, -0.5 * Math.cos(p), swk);
    P.fx = lerp(P.fx, 0.15 - 0.35 * Math.sin(p), swk); P.fz = lerp(P.fz, 0, swk);
    P.curl = lerp(P.curl, 0.12, swk); P.th = lerp(P.th, 0.1, swk); P.mul = 1; P.spread = lerp(P.spread, 0.1, swk);
    P.ey += 0.05 * swk * Math.sin(p); P.ez -= 0.06 * swk * Math.cos(p);
  }

  update(dt: number, s: ViewState) {
    const R = this.R, L = this.Lh, pr = R.pose, pl = L.pose;
    const t = s.time;
    dt = Math.max(0, dt);
    if (this.current === 'torch') this.cache.get('torch')?.userData.tick?.(t);
    const sdt = Math.min(dt, 0.05);

    // ---- smoothed state
    const swimmingNow = s.swimming ? 1 : 0;
    this.swimK += (swimmingNow - this.swimK) * (1 - Math.exp(-dt * 7));
    if (!s.swimming && this.swimK < 0.002) this.swimK = 0;
    const moving = s.onGround && !s.swimming ? clamp(s.speed / 3.5, 0, 1) : 0;
    this.walkK += (moving - this.walkK) * (1 - Math.exp(-dt * 8));
    const spr = s.sprinting && s.speed > 3 && s.onGround && !s.swimming ? 1 : 0;
    this.sprintK += (spr - this.sprintK) * (1 - Math.exp(-dt * 7));
    this.bob += dt * (1.2 + s.speed * 1.1);
    this.swimPh += dt * (3.2 + s.speed * 1.4);
    this.drinkT += dt;
    this.drinkK += ((this.drinkWas && !s.swimming ? 1 : 0) - this.drinkK) * (1 - Math.exp(-dt * 7));
    if (!this.drinkWas && this.drinkK < 0.002) this.drinkK = 0;
    // mouse-look lag
    const lx = clamp(s.yawRate * 0.012, -0.05, 0.05), ly = clamp(s.pitchRate * 0.01, -0.04, 0.04);
    const lk = 1 - Math.exp(-dt * 9);
    this.lagX += (lx - this.lagX) * lk; this.lagY += (ly - this.lagY) * lk;
    // jump / landing spring
    if (s.onGround && !this.wasGround) this.spV -= clamp(-this.lastVy / 9, 0, 1) * 0.9;
    this.wasGround = s.onGround; this.lastVy = s.vy;
    const spT = s.onGround ? 0 : clamp(-s.vy * 0.0045, -0.03, 0.035);
    { let rem = sdt; while (rem > 0) { const h = Math.min(rem, 1 / 90); this.spV += ((spT - this.spY) * 160 - this.spV * 14) * h; this.spY += this.spV * h; rem -= h; } }

    // ---- equip timeline: lower old, swap, raise new
    let dip = 0;
    if (!this.equipSwapped || this.equipT < 1) {
      this.equipT = Math.min(1, this.equipT + dt / 0.25);
      if (!this.equipSwapped && this.equipT >= 0.5) { this.apply(this.pending); this.equipSwapped = true; }
      dip = this.equipT < 0.5 ? sm(this.equipT * 2) : 1 - sm((this.equipT - 0.5) * 2);
    }

    // ---- base poses (rest)
    const w = Math.min(1, this.cam.aspect / 1.4);
    const rx = 0.075 + 0.165 * w, ry = -0.2, rz = -0.45;
    const lxw = -(0.075 + 0.225 * w), ly0 = -0.25, lz = -0.4;
    const gr = R.grip, gl = L.grip;
    Object.assign(pr, ZERO); Object.assign(pl, ZERO);
    pr.roll = gr.roll ?? 0; pr.fz = gr.fz ?? 0; pr.fx = gr.fx ?? 0; pr.curl = this.current ? 0.97 : 0.5; pr.th = this.current ? 1 : 0.6;
    pl.roll = (L.item ? gl.roll ?? 0 : 0.35); pl.fx = L.item ? 0.1 : 0.3; pl.fz = L.item ? gl.fz ?? 0 : 0.12; pl.curl = L.item ? 0.97 : 0.62; pl.th = L.item ? 1 : 0.5;
    pr.th = this.current ? 1 : 0.6;
    pl.dy -= 0.02;
    let rigDx = 0, rigDy = 0, rigRx = 0, rigRy = 0, rigDz = 0;

    // idle breathing + sway
    const br = Math.sin(t * 1.6), sw = Math.sin(t * 0.9);
    pr.dy += br * 0.0035; pl.dy += Math.sin(t * 1.6 + 0.9) * 0.0035;
    pr.dx += sw * 0.003; pl.dx += Math.sin(t * 0.9 + 1.3) * 0.003;
    pr.fz += Math.sin(t * 0.7) * 0.015; pl.fx += Math.sin(t * 0.8 + 1) * 0.02;
    pr.curl += Math.sin(t * 1.1) * 0.01;

    // walk bob: hands alternate
    const ph = this.bob * 2, wk = this.walkK;
    pr.dy += wk * (0.006 * Math.abs(Math.sin(ph)) + 0.004 * Math.sin(ph));
    pl.dy += wk * (0.006 * Math.abs(Math.cos(ph)) - 0.004 * Math.sin(ph));
    pr.dz += wk * 0.012 * Math.sin(ph + 0.4); pl.dz -= wk * 0.012 * Math.sin(ph + 0.4);
    pr.dx += wk * 0.007 * Math.sin(ph * 0.5); pl.dx += wk * 0.007 * Math.sin(ph * 0.5);
    pr.fz += wk * 0.03 * Math.sin(ph);

    // sprint: arms pump, tool tilts down/back
    const sk = this.sprintK;
    if (sk > 0.001) {
      const sp = this.bob * 2.2;
      pr.dy += -0.04 * sk + 0.025 * sk * Math.cos(sp); pr.dz += 0.01 * sk + 0.05 * sk * Math.sin(sp); pr.dx -= 0.01 * sk;
      pl.dy += -0.03 * sk - 0.025 * sk * Math.cos(sp); pl.dz += 0.01 * sk - 0.05 * sk * Math.sin(sp);
      pr.fz += -0.3 * sk; pr.fx += -0.2 * sk; pl.fz += -0.2 * sk;
      pr.ey += 0.04 * sk * Math.sin(sp); pl.ey -= 0.04 * sk * Math.sin(sp);
      rigDy -= 0.012 * sk; rigRx += 0.03 * sk;
      pr.curl += 0.03 * sk;
    }

    // mouse look lag: items drift opposite to the turn
    rigDx += this.lagX; rigDy += this.lagY - this.spY * 0.0 ;
    rigRy += this.lagX * 1.4; rigRx += -this.lagY * 0.9;
    pr.dy += this.spY; pl.dy += this.spY;
    pr.fz += this.lagX * 2.5;

    // equip dip
    if (dip > 0) { pr.dy -= 0.3 * dip; pr.fz -= 0.25 * dip; pl.dy -= 0.1 * dip; pr.ey -= 0.1 * dip; pl.ey -= 0.1 * dip; }

    // ---- tool swing
    if (this.swingT >= 0) {
      this.swingT += dt;
      const u = this.swingT / 0.62;
      // the hit lands once the swing passes this point, however coarse the frame time is
      if (!this.hitFired && u >= 0.47) { this.hitFired = true; this.onHit?.(); }
      let a = 0, b = 0;
      if (u < 0.32) a = eo(u / 0.32);
      else if (u < 0.5) { const k = (u - 0.32) / 0.18; a = 1 - k * k; b = k * k; }
      else if (u < 0.62) { b = 1 + 0.12 * eo((u - 0.5) / 0.12); }
      else if (u < 1) { const k = sm((u - 0.62) / 0.38); b = 1.12 * (1 - k); }
      else this.swingT = -1;
      pr.dx += (0.03 * a - 0.07 * b) * (0.2 + 0.8 * w); pr.dy += 0.07 * a - 0.1 * b; pr.dz += 0.03 * a + 0.0 * b;
      pr.fz += -0.35 * a + 0.62 * b; pr.fx += 0.1 * a - 0.1 * b; pr.roll += 0.0 * a - 0.3 * b;
      pr.curl += 0.03 * a + 0.1 * b; pr.mul += 0.04 * b;
      pr.ex += 0.03 * a - 0.03 * b; pr.ey += 0.05 * a - 0.04 * b; pr.ez += 0.04 * a - 0.05 * b;
      pl.dx += (-0.01 * a + 0.04 * b) * (0.2 + 0.8 * w); pl.dy += 0.04 * a - 0.07 * b; pl.dz += 0.03 * a - 0.06 * b;
      pl.fz += -0.2 * b; pl.curl += 0.1 * b;
      rigDy += -0.014 * b; rigDx -= 0.012 * b; rigRx += 0.05 * b - 0.025 * a; rigRy -= 0.03 * b;
    }

    // ---- eat: bring item to mouth, bite shake
    if (this.eatT >= 0) {
      this.eatT += dt;
      const u = this.eatT / 0.7;
      const up = sm(sat(u / 0.38)) * (1 - sm(sat((u - 0.74) / 0.26)));
      const bite = sat((u - 0.4) / 0.35) * (1 - sat((u - 0.75) / 0.25));
      const shake = Math.sin(u * 62) * bite;
      pr.dx += (0.03 - rx) * up + shake * 0.006; pr.dy += (-0.115 - ry) * up + Math.abs(shake) * 0.01; pr.dz += (-0.3 - rz) * up;
      pr.roll += 0.5 * up; pr.fx += 0.5 * up + shake * 0.12; pr.fz -= 0.3 * up * (this.current && GRIPS[this.current].handle ? 1 : 0);
      pr.ey += 0.08 * up; pr.ex -= 0.1 * up;
      pl.dx += 0.05 * up; pl.dy += 0.05 * up; pl.dz -= 0.02 * up; pl.curl -= 0.1 * up;
      rigRx -= 0.04 * up;
      if (R.item) R.item.scale.setScalar(1 - 0.12 * sat((u - 0.5) / 0.4) * (u < 0.9 ? 1 : 0));
      if (u >= 1) { this.eatT = -1; if (R.item) R.item.scale.setScalar(1); }
    }

    // ---- reach: off hand grabs forward
    if (this.reachT >= 0) {
      this.reachT += dt;
      const u = this.reachT / 0.35;
      const out = u < 0.45 ? eo(u / 0.45) : 1 - sm(sat((u - 0.5) / 0.5));
      const grab = sm(sat((u - 0.38) / 0.22)) * (1 - sm(sat((u - 0.7) / 0.3)));
      pl.dx += (-0.03 - lxw) * out; pl.dy += (-0.13 - ly0) * out; pl.dz += (-0.5 - lz) * out;
      pl.roll -= 1.0 * out; pl.fx += 0.2 * out;
      pl.curl = lerp(pl.curl, 0.05, out) + grab * 0.95; pl.th = lerp(pl.th, 0.1, out) + grab * 0.7; pl.spread += 0.5 * out * (1 - grab);
      pl.ey += 0.1 * out; pl.ez -= 0.12 * out;
      pr.dy -= 0.01 * out; pr.dz += 0.01 * out;
      if (u >= 1) this.reachT = -1;
    }

    // ---- place: push forward and plant
    if (this.placeT >= 0) {
      this.placeT += dt;
      const u = this.placeT / 0.4;
      const k = u < 0.5 ? eo(u / 0.5) : 1 - sm((u - 0.5) / 0.5) * 0.98;
      const thump = Math.exp(-Math.pow((u - 0.5) * 9, 2));
      pr.dz -= 0.15 * k; pr.dy += -0.04 * k - 0.02 * thump; pr.dx -= 0.03 * k; pr.fz += 0.25 * k; pr.fx += 0.1 * k;
      pr.ez -= 0.08 * k; pr.ey += 0.03 * k;
      pl.dz -= 0.12 * k; pl.dx += 0.07 * k; pl.dy += 0.0 * k - 0.02 * thump; pl.roll -= 0.3 * k;
      rigRx += 0.03 * thump; rigDy -= 0.008 * thump;
      if (u >= 1) this.placeT = -1;
    }

    // ---- drink: both hands cupped and raised to the face
    const dk = this.drinkK;
    if (dk > 0.001) {
      // a cycle: both hands dip into the water and fill, then lift, tilt and come up to the mouth for a sip
      const u = (this.drinkT % 2.3) / 2.3, sm2 = (x: number) => x * x * (3 - 2 * x);
      const g = u < 0.3 ? 1 : u < 0.65 ? 1 - sm2((u - 0.3) / 0.35) : u < 0.88 ? 0 : sm2((u - 0.88) / 0.12);   // 1: in the water, 0: at the mouth
      const fill = u < 0.3 ? Math.sin((u / 0.3) * Math.PI) : 0;                                              // a dip as the hands fill
      const ripple = Math.sin(this.drinkT * 9) * 0.004 * g;
      const dyT = -0.105 - 0.235 * g - 0.04 * fill, dzT = -0.29 - 0.21 * g, dxT = 0.045 + 0.035 * g + 0.01 * fill;
      pr.dx += (dxT - rx) * dk; pr.dy += (dyT - ry) * dk + ripple * dk; pr.dz += (dzT - rz) * dk;
      pl.dx += (-dxT - lxw) * dk; pl.dy += (dyT - ly0) * dk + ripple * dk; pl.dz += (dzT - lz) * dk;
      const roll = 1.2 + 0.4 * (1 - g);                       // palms tip toward the face as they rise
      pr.roll = lerp(pr.roll, roll, dk); pl.roll = lerp(pl.roll, roll, dk);
      const fx = -0.12 - 0.25 * (1 - g) - 0.08 * Math.sin(u * Math.PI * 2) * (1 - g);
      pr.fx = lerp(pr.fx, fx, dk); pl.fx = lerp(pl.fx, fx, dk);
      pr.fz = lerp(pr.fz, 0.0, dk); pl.fz = lerp(pl.fz, -0.1, dk);
      const curl = 0.4 + 0.35 * (1 - g) + 0.25 * fill;        // fingers open under the surface, close around the water
      pr.curl = lerp(pr.curl, curl, dk); pl.curl = lerp(pl.curl, curl, dk);
      pr.th = lerp(pr.th, 0.45, dk); pl.th = lerp(pl.th, 0.45, dk);
      pr.mul = lerp(pr.mul, 0.9, dk);
      pr.ey += 0.06 * dk; pl.ey += 0.06 * dk; pr.ex -= 0.08 * dk; pl.ex += 0.08 * dk;
      rigRx -= (0.05 - 0.04 * g) * dk;
    }

    // ---- swim: alternating crawl strokes, item stowed
    const swk = this.swimK;
    if (swk > 0.001) {
      const p0 = this.swimPh, p1 = p0 + Math.PI;
      const sx = 0.17 + 0.05 * w;
      this.stroke(1, p0, sx, rx, ry, rz, pr, swk); this.stroke(-1, p1, sx, lxw, ly0, lz, pl, swk);
      rigRx += 0.05 * swk; rigDy -= 0.01 * swk;
    }

    // ---- stow the held item while swimming / drinking
    const stow = Math.max(swk, dk);
    const sc = Math.max(1 - sm(sat(stow * 1.15)), 0.0001);
    R.anchor.scale.setScalar(sc); R.anchor.visible = sc > 0.03;
    L.anchor.scale.setScalar(sc); L.anchor.visible = sc > 0.03;

    // ---- aspect-aware rest positions -> elbow/wrist, pseudo-IK
    R.W.set(rx + pr.dx, ry + pr.dy, rz + pr.dz);
    R.E.set(rx + 0.12 + pr.ex + pr.dx * 0.5, ry - 0.31 + pr.ey + pr.dy * 0.6, rz + 0.3 + pr.ez + pr.dz * 0.45);
    L.W.set(lxw + pl.dx, ly0 + pl.dy, lz + pl.dz);
    L.E.set(lxw - 0.11 + pl.ex + pl.dx * 0.5, ly0 - 0.31 + pl.ey + pl.dy * 0.6, lz + 0.3 + pl.ez + pl.dz * 0.45);
    poseArm(R); poseArm(L);
    curlHand(R, t); curlHand(L, t);

    this.rig.position.set(rigDx, rigDy, rigDz);
    this.rig.rotation.set(rigRx, rigRy, 0);
  }
}
const ZERO: Pose = newPose();


/**
 * Your own hand in a headset: the same hand as on a screen (skin, fingers, thumb), without the arm, held round the
 * controller: the fingers wrap its handle, the thumb on top, and close as you squeeze the trigger and the grip.
 * `group` goes on the controller's grip (its -z runs along the handle, +x to your right).
 */
export class VRHand {
  readonly group = new THREE.Group();
  private h: HandRig;
  constructor(left: boolean) {
    this.h = new HandRig(left ? -1 : 1);
    // the hand's frame: y along the fingers, z out of the palm, x to the thumb. Fingers forward along the handle, the
    // palm against it (facing in, towards the other hand), the thumb on top; the wrist a little behind the grip
    const hx = new THREE.Vector3(0, left ? -1 : 1, 0), hy = new THREE.Vector3(0, 0, -1), hz = new THREE.Vector3(left ? 1 : -1, 0, 0);
    const m = new THREE.Matrix4().makeBasis(hx, hy, hz);
    const holder = new THREE.Group();
    holder.quaternion.setFromRotationMatrix(m);
    holder.position.set(left ? -0.025 : 0.025, -0.01, 0.075);
    holder.add(this.h.g);
    this.group.add(holder);
    this.update(0.35);
  }
  /** how closed the hand is: 0 open .. 1 a fist */
  update(curl: number) {
    const P = this.h.pose;
    P.curl = curl; P.th = Math.min(1, curl * 1.1); P.mul = 1; P.spread = 0.15 * (1 - curl);
    curlHand(this.h, 0);
  }
}
