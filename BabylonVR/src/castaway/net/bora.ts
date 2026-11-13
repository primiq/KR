// Bora: the second body a player can choose (Customise > Body). An old castaway made in Blender (assets/bora/bora.glb,
// built by scripts/build-bora.mjs): one skinned mesh per part (body, hair, beard, shorts, eyes, brows, lashes) on a
// 63-bone skeleton. He has no animation of his own: every player keeps the classic jointed rig (net/playerModel.ts)
// as an invisible puppet, the existing procedural animation moves it as always, and Bora's bones copy it each frame:
//  - every limb bone of his is first swung from his A-pose to hang like the puppet's at rest (straight down);
//  - then it takes the puppet joint's rotation, in the rig's own space; his hips follow the puppet's hips.
// So walking, swimming, sitting, swinging a tool, VR arms... all come for free. The mirror (render/mirror.ts) draws the
// skinned meshes. The puppet's wrists are moved onto his hands, so whatever the puppet holds sits in Bora's grip.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import boraUrl from '../assets/bora/bora.glb?url';
import type { Look, PlayerRig } from './playerModel';

/** model units to metres (he is about 9 units tall: 1.8 m) */
const SCALE = 0.2;

interface Template {
  scene: THREE.Group;
  /** each bone's rest rotation in the rig's space, and its "hang like the puppet" alignment */
  rest: Map<string, { q: THREE.Quaternion; ref: THREE.Quaternion }>;
  /** the hips' rest position in the rig's space, and the root bone's parent (rig space, inverted) */
  hip0: THREE.Vector3; rootParentInv: THREE.Matrix4;
  skin: THREE.Texture | null; brow: THREE.Texture | null; lash: THREE.Texture | null;
  /** his own skin colour in the texture (the recolouring keeps every shade relative to it) */
  skinBase: [number, number, number];
  chest: { y: number; z: number };
  /** the beard trimmed short: every point drawn in towards the jaw */
  beardShort: THREE.BufferGeometry | null;
  /** clothes cut from his own skin (see garments): shirts, trousers, boots, sandals */
  clothes: Record<string, THREE.BufferGeometry>;
  /** each bone's rest matrix in rig space (things worn on a bone: hat, shades, scarf, pack) */
  restM: Map<string, THREE.Matrix4>;
  /** his back at chest height (rig space z), for the pack */
  backZ: number;
  /** his forearms and hands on their own (first person, VR hands): see makeBoraArm */
  arms: { L: ArmData; R: ArmData } | null;
}

let T: Template | null = null;
let loading: Promise<void> | null = null;
const waiting: (() => void)[] = [];

/** start loading (once); `onReady` runs when he can be built */
export function loadBora(onReady?: () => void) {
  if (T) { onReady?.(); return; }
  if (onReady) waiting.push(onReady);
  loading ??= (async () => {
    const gltf = await new GLTFLoader().loadAsync(boraUrl);
    const scene = gltf.scene;
    // the pose maths below works in "rig space": the puppet's rig group, which faces -Z; Bora faces +Z, so he is turned
    const holder = new THREE.Group();
    scene.rotation.y = Math.PI; scene.scale.setScalar(SCALE);
    holder.add(scene); holder.updateMatrixWorld(true);
    const rest = new Map<string, { q: THREE.Quaternion; ref: THREE.Quaternion }>();
    const restM = new Map<string, THREE.Matrix4>();
    const down = new THREE.Vector3(0, -1, 0);
    const wp = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
    scene.traverse((o) => {
      if (!(o as THREE.Bone).isBone) return;
      const q = o.getWorldQuaternion(new THREE.Quaternion());
      let ref = q.clone();
      const to = HANG[o.name];
      if (to) {
        const child = scene.getObjectByName(to)!;
        const dir = wp(child).sub(wp(o)).normalize();
        ref = new THREE.Quaternion().setFromUnitVectors(dir, down).multiply(q);
      }
      rest.set(o.name, { q, ref });
      restM.set(o.name, o.matrixWorld.clone());
    });
    const hipBone = scene.getObjectByName('DEF-spine')!;
    const hip0 = wp(hipBone);
    const rootParentInv = hipBone.parent!.matrixWorld.clone().invert();
    // the textures, and his skin's own colour (the middle of the body texture's most common shade)
    let skin: THREE.Texture | null = null, brow: THREE.Texture | null = null, lash: THREE.Texture | null = null, beardShort: THREE.BufferGeometry | null = null;
    let chestY = 1.35, chestZ = -0.12, backZ = 0.1;
    let clothes: Record<string, THREE.BufferGeometry> = {};
    let arms: { L: ArmData; R: ArmData } | null = null;
    scene.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh) return;
      const mat = m.material as THREE.MeshBasicMaterial;
      if (m.name === 'Body') {
        skin = mat.map;
        // (where the chest's front is, for the name plate: the body's most forward point at chest height, near the middle)
        const P = m.geometry.getAttribute('position'), v = new THREE.Vector3();
        let best = Infinity;
        for (let i = 0; i < P.count; i++) {
          v.fromBufferAttribute(P, i).applyMatrix4(m.matrixWorld);
          if (Math.abs(v.x) < 0.04 && Math.abs(v.y - chestY) < 0.04 && v.z < best) best = v.z;
        }
        if (best < 0) chestZ = best;
        let back = -Infinity;
        for (let i = 0; i < P.count; i++) {
          v.fromBufferAttribute(P, i).applyMatrix4(m.matrixWorld);
          if (Math.abs(v.x) < 0.05 && Math.abs(v.y - chestY) < 0.05 && v.z > back) back = v.z;
        }
        if (back > 0) backZ = back;
        clothes = garments(m);
        arms = { L: armData(m, 'L'), R: armData(m, 'R') };
      }
      if (m.name === 'Beard') beardShort = trim(m.geometry);
      if (/eyebrow/.test(m.name)) brow = mat.map;
      if (/eyelash/.test(m.name)) lash = mat.map;
    });
    holder.remove(scene);
    scene.rotation.set(0, Math.PI, 0);
    T = { scene, rest, hip0, rootParentInv, skin, brow, lash, skinBase: baseColour(skin), chest: { y: chestY, z: chestZ }, beardShort, clothes, restM, backZ, arms };
    for (const f of waiting.splice(0)) f();
  })().catch((e) => { console.error('Bora failed to load', e); loading = null; });
}
export const boraReady = () => !!T;

/** a short beard: the full one drawn in towards a point behind the chin (its hanging length goes, it stays on the face) */
function trim(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const s = g.clone(), P = s.getAttribute('position') as THREE.BufferAttribute;
  s.computeBoundingBox();
  const b = s.boundingBox!, c = new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y - (b.max.y - b.min.y) * 0.25, (b.min.z + b.max.z) / 2 - (b.max.z - b.min.z) * 0.2);
  const v = new THREE.Vector3();
  for (let i = 0; i < P.count; i++) {
    v.fromBufferAttribute(P, i);
    // (more off the bottom, where it hangs, than round the cheeks)
    const k = v.y < c.y ? 0.45 : 0.75;
    v.sub(c).multiplyScalar(k).add(c);
    P.setXYZ(i, v.x, v.y, v.z);
  }
  P.needsUpdate = true; s.computeVertexNormals();
  return s;
}

/**
 * Clothes cut from his own skin, so they fit him exactly and bend with him: the triangles of the body that the garment
 * covers (chosen by which bones move them, and by height), pushed out a little along their normals, with the body's own
 * bone weights. A shirt's hem flares a touch so it hangs rather than looks painted on; the shirt's bottom tucks into his
 * shorts. Heights are the model's own units (he is about 9 tall, feet at 0).
 */
function garments(body: THREE.SkinnedMesh): Record<string, THREE.BufferGeometry> {
  const g = body.geometry, P = g.getAttribute('position'), N = g.getAttribute('normal'), UV = g.getAttribute('uv');
  const SI = g.getAttribute('skinIndex'), SW = g.getAttribute('skinWeight'), I = g.getIndex()!;
  const names = body.skeleton.bones.map((b) => b.name);
  const set = (re: RegExp) => new Set(names.map((n, i) => (re.test(n) ? i : -1)).filter((i) => i >= 0));
  const TORSO = set(/^DEF-(spine|spine00[123]|shoulder|pelvis)/), NECK = set(/^DEF-spine00[456]/);
  const UP1 = set(/^DEF-upper_arm[LR]$/), UP2 = set(/^DEF-upper_arm[LR]001/), FORE = set(/^DEF-(forearm|hand|f_|thumb)/);
  const LEG = set(/^DEF-(thigh|shin|spine$|pelvis)/), FOOT = set(/^DEF-(foot|toe)/), SHIN2 = set(/^DEF-shin[LR]001/);
  const w = (i: number, s: Set<number>) => { let t = 0; for (let k = 0; k < 4; k++) if (s.has(SI.getComponent(i, k))) t += SW.getComponent(i, k); return t; };
  const sstep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const cut = (keep: (i: number, y: number) => boolean, off: (i: number, y: number) => number) => {
    const ok = new Uint8Array(P.count);
    for (let i = 0; i < P.count; i++) ok[i] = keep(i, P.getY(i)) ? 1 : 0;
    const map = new Map<number, number>(), pos: number[] = [], nor: number[] = [], uv: number[] = [], si: number[] = [], sw: number[] = [], idx: number[] = [];
    const vert = (i: number) => {
      let j = map.get(i);
      if (j !== undefined) return j;
      j = pos.length / 3; map.set(i, j);
      const d = off(i, P.getY(i));
      pos.push(P.getX(i) + N.getX(i) * d, P.getY(i) + N.getY(i) * d, P.getZ(i) + N.getZ(i) * d);
      nor.push(N.getX(i), N.getY(i), N.getZ(i));
      if (UV) uv.push(UV.getX(i), UV.getY(i));
      for (let k = 0; k < 4; k++) { si.push(SI.getComponent(i, k)); sw.push(SW.getComponent(i, k)); }
      return j;
    };
    for (let t = 0; t < I.count; t += 3) {
      const a = I.getX(t), b = I.getX(t + 1), c = I.getX(t + 2);
      if (ok[a] && ok[b] && ok[c]) idx.push(vert(a), vert(b), vert(c));
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    if (UV) out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    out.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    out.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    out.setIndex(idx);
    return out;
  };
  const shirt = (sleeve: 0 | 1 | 2) => cut(
    (i, y) => y > 4.95 && w(i, NECK) < 0.35 && w(i, FORE) < 0.25 && (sleeve === 2 ? true : sleeve === 1 ? w(i, UP2) < 0.5 : w(i, UP1) + w(i, UP2) < 0.55),
    (i, y) => 0.05 + 0.13 * sstep(5.9, 5.0, y) * w(i, TORSO));
  return {
    // T-shirt (sleeves to mid upper arm), sleeveless, camp shirt (sleeves to the elbow)
    shirt0: shirt(1), shirt1: shirt(0), shirt2: shirt(2),
    trousers: cut((i, y) => y < 5.75 && y > 0.45 && w(i, LEG) >= 0.5 && w(i, FOOT) < 0.3, (_i, y) => 0.07 + 0.06 * sstep(1.4, 0.6, y)),
    boots: cut((i, y) => y < 1.15 && w(i, FOOT) + w(i, SHIN2) >= 0.5, () => 0.09),
    sandals: cut((i, y) => y < 0.2 && w(i, FOOT) >= 0.5, () => 0.035),
  };
}

// ------------------------------------------------------------------ his arm on its own (first person, VR hands)
/** the bones of one forearm and hand, in the order the arm's own skeleton has them */
const ARM_BONES = (s: string) => [`DEF-forearm${s}`, `DEF-forearm${s}001`, `DEF-hand${s}`,
  ...['thumb', 'f_index', 'f_middle', 'f_ring', 'f_pinky'].flatMap((f) => ['01', '02', '03'].map((k) => `DEF-${f}${k}${s}`))];
interface ArmData {
  geo: THREE.BufferGeometry;
  names: string[];
  /** each bone's rest in model space (the inverse of its bind matrix), its parent in the arm (-1 for the forearm) */
  rest: THREE.Matrix4[]; inv: THREE.Matrix4[]; parent: number[];
  /** each bone's "hand frame" (along the bone, out of the palm) in its own rest space: what lines it up with a rig's joint */
  frame: THREE.Quaternion[];
  /** the forearm's length; each bone's length (to its next bone; the tips as long as 0.8 of the one before); the palm's
   *  length (wrist to the middle finger's root) and width (index to little finger root); all model units */
  fore: number; len: number[]; palm: number; knuckles: number;
}
/** his forearm and hand cut from the body (with weights only on their own bones), and the frames to drive them by */
function armData(body: THREE.SkinnedMesh, side: 'L' | 'R'): ArmData {
  const names = ARM_BONES(side), all = body.skeleton.bones.map((b) => b.name);
  const map = new Map(names.map((n, i) => [all.indexOf(n), i]));
  const g = body.geometry, P = g.getAttribute('position'), N = g.getAttribute('normal'), UV = g.getAttribute('uv');
  const SI = g.getAttribute('skinIndex'), SW = g.getAttribute('skinWeight'), I = g.getIndex()!;
  const own = (i: number) => { let t = 0; for (let k = 0; k < 4; k++) if (map.has(SI.getComponent(i, k))) t += SW.getComponent(i, k); return t; };
  const vmap = new Map<number, number>(), pos: number[] = [], nor: number[] = [], uv: number[] = [], si: number[] = [], sw: number[] = [], idx: number[] = [];
  const vert = (i: number) => {
    let j = vmap.get(i);
    if (j !== undefined) return j;
    j = pos.length / 3; vmap.set(i, j);
    pos.push(P.getX(i), P.getY(i), P.getZ(i)); nor.push(N.getX(i), N.getY(i), N.getZ(i)); if (UV) uv.push(UV.getX(i), UV.getY(i));
    const ws: [number, number][] = [];
    for (let k = 0; k < 4; k++) { const b = map.get(SI.getComponent(i, k)), w = SW.getComponent(i, k); if (b !== undefined && w > 0) ws.push([b, w]); }
    const sum = ws.reduce((a, x) => a + x[1], 0) || 1;
    for (let k = 0; k < 4; k++) { si.push(ws[k]?.[0] ?? 0); sw.push((ws[k]?.[1] ?? 0) / sum); }
    return j;
  };
  for (let t = 0; t < I.count; t += 3) {
    const a = I.getX(t), b = I.getX(t + 1), c = I.getX(t + 2);
    if (own(a) > 0.5 && own(b) > 0.5 && own(c) > 0.5) idx.push(vert(a), vert(b), vert(c));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  if (UV) geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  geo.setIndex(idx);
  // rest matrices (model space) and the frames
  const inv = names.map((n) => body.skeleton.boneInverses[all.indexOf(n)].clone());
  const rest = inv.map((m) => m.clone().invert());
  const at = (n: string) => new THREE.Vector3().setFromMatrixPosition(rest[names.indexOf(n)]);
  const across = at(`DEF-f_index01${side}`).sub(at(`DEF-f_pinky01${side}`));
  const along = at(`DEF-f_middle01${side}`).sub(at(`DEF-hand${side}`));
  // out of the palm: for the right hand thumb x fingers, for the left the other way round
  const palm = (side === 'R' ? along.clone().cross(across) : across.clone().cross(along)).normalize();
  const parent = names.map((n) => {
    if (n.startsWith('DEF-forearm') && !n.includes('001')) return -1;
    if (n.includes('forearm')) return 0;
    if (n.startsWith('DEF-hand')) return 1;
    const k = n.slice(-3, -1);      // the segment: 01, 02, 03
    return k === '01' ? 2 : names.indexOf(n.replace(k + side, String(+k - 1).padStart(2, '0') + side));
  });
  const next = (i: number) => { const c = parent.indexOf(i); return c >= 0 ? c : -1; };
  const frame = names.map((n, i) => {
    const p0 = at(n);
    let to = n.startsWith('DEF-hand') ? at(`DEF-f_middle01${side}`) : next(i) >= 0 ? at(names[next(i)]) : null;
    const dir = to ? to.sub(p0) : p0.clone().sub(at(names[parent[i]]));
    const y = dir.normalize(), z = palm.clone().addScaledVector(y, -palm.dot(y)).normalize(), x = new THREE.Vector3().crossVectors(y, z);
    const F = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    const q0 = new THREE.Quaternion(); rest[i].decompose(new THREE.Vector3(), q0, new THREE.Vector3());
    return q0.invert().multiply(F);
  });
  const fore = at(`DEF-hand${side}`).distanceTo(at(`DEF-forearm${side}`));
  const len = names.map(() => 0);
  names.forEach((n, i) => { const c = next(i); if (c >= 0 && !n.startsWith('DEF-hand')) len[i] = at(n).distanceTo(at(names[c])); });
  names.forEach((_n, i) => { if (!len[i] && A_TIP(names[i])) len[i] = len[parent[i]] * 0.8; });
  const palmLen = at(`DEF-f_middle01${side}`).distanceTo(at(`DEF-hand${side}`));
  const knuckles = at(`DEF-f_index01${side}`).distanceTo(at(`DEF-f_pinky01${side}`));
  return { geo, names, rest, inv, parent, frame, fore, len, palm: palmLen, knuckles };
}

const A_TIP = (n: string) => /03[LR]$/.test(n);

/** the joints of a hand rig an arm follows (game/hands.ts HandRig): each a group whose y runs along the bone, z out of the palm */
export interface HandJoints {
  /** the elbow (null: no arm, as in a headset: the forearm then runs straight back from the wrist) */
  elbow: THREE.Object3D | null;
  wrist: THREE.Object3D;
  /** index, middle, ring, little: three segments each */
  fingers: [THREE.Object3D, THREE.Object3D, THREE.Object3D][];
  thumb: [THREE.Object3D, THREE.Object3D];
}
export interface BoraArm { mesh: THREE.SkinnedMesh; pose(j: HandJoints): void; dispose(): void }

/** Bora's forearm and hand for a first-person or VR hand rig; it goes into `parent` (the rig's unmirrored group) */
export function makeBoraArm(left: boolean, look: Look, parent: THREE.Object3D, selfLight = 0): BoraArm | null {
  const A = T?.arms?.[left ? 'L' : 'R'];
  if (!A) return null;
  const bones = A.names.map((n) => { const b = new THREE.Bone(); b.name = n; b.matrixAutoUpdate = false; parent.add(b); return b; });
  const sk = new THREE.Skeleton(bones, A.inv);
  const m = mat('arm' + look.skin + selfLight, () => {
    const t = skinFor(look.skin);
    const mm = std('#ffffff', 0.72, { map: t, emissiveMap: t, emissive: new THREE.Color(selfLight, selfLight, selfLight) });
    return mm;
  });
  const mesh = new THREE.SkinnedMesh(A.geo, m);
  mesh.frustumCulled = false; mesh.name = 'boraArm';
  mesh.bind(sk, new THREE.Matrix4());
  parent.add(mesh);
  const world = A.names.map(() => new THREE.Matrix4());
  const G = new THREE.Quaternion(), Q = new THREE.Quaternion(), P = new THREE.Vector3();
  const x = new THREE.Vector3(), y = new THREE.Vector3(), z = new THREE.Vector3(), b = new THREE.Matrix4(), pinv = new THREE.Matrix4();
  /** a joint's frame from its world matrix (y along it, z out of the palm; a mirrored joint's x is ignored) */
  const frameOf = (o: THREE.Object3D, out: THREE.Quaternion) => {
    const e = o.matrixWorld.elements;
    y.set(e[4], e[5], e[6]).normalize(); z.set(e[8], e[9], e[10]); z.addScaledVector(y, -z.dot(y)).normalize(); x.crossVectors(y, z);
    return out.setFromRotationMatrix(b.makeBasis(x, y, z));
  };
  /** bone i takes frame `q` (rig joint) at position `p`, stretched by `k` along the frame's axes (x across, y along, z out of the palm) */
  const one = new THREE.Vector3(1, 1, 1), rot = new THREE.Matrix4(), sc = new THREE.Matrix4().makeScale(SCALE, SCALE, SCALE);
  const put = (i: number, q: THREE.Quaternion, p: THREE.Vector3, k: THREE.Vector3 = one) => {
    world[i].compose(p, q, k).multiply(rot.makeRotationFromQuaternion(A.frame[i].clone().invert())).multiply(sc);
  };
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3(), sv = new THREE.Vector3();
  /** where bone i sits under its (already placed) parent, at rest */
  const under = (i: number) => P.setFromMatrixPosition(A.rest[i]).applyMatrix4(A.inv[A.parent[i]]).applyMatrix4(world[A.parent[i]]);
  const wristQ = new THREE.Quaternion(), W = new THREE.Vector3(), E = new THREE.Vector3(), mid = new THREE.Vector3(), fq = new THREE.Quaternion();
  return {
    mesh,
    pose(j: HandJoints) {
      frameOf(j.wrist, wristQ); j.wrist.getWorldPosition(W);
      // the forearm: from the elbow to the wrist, turned with the hand (so the skin does not twist between them)
      if (j.elbow) j.elbow.getWorldPosition(E);
      else E.copy(W).addScaledVector(y.set(0, 1, 0).applyQuaternion(wristQ), -A.fore * SCALE);
      y.subVectors(W, E).normalize();
      z.set(0, 0, 1).applyQuaternion(wristQ); z.addScaledVector(y, -z.dot(y)).normalize(); x.crossVectors(y, z);
      fq.setFromRotationMatrix(b.makeBasis(x, y, z));
      put(0, fq, E); put(1, fq, mid.lerpVectors(E, W, 0.5));
      // (no elbow, in a headset: your body's own arm reaches the wrist, so the forearm folds away into it)
      if (!j.elbow) for (const i of [0, 1]) { world[i].compose(W, Q.copy(fq).multiply(A.frame[i].clone().invert()), mid.setScalar(SCALE * 1e-3)); }
      // his hand takes the rig's measurements, so every grip in the game (tuned for the rig's hand) closes his fingers and
      // thumb round the item just as it closes the rig's: the palm as long and wide as the rig's, each finger and thumb
      // segment starting at the rig's joint and as long as the rig's
      const at = (o: THREE.Object3D, v: THREE.Vector3) => o.getWorldPosition(v);
      const F = j.fingers, wide = at(F[0][0], va).distanceTo(at(F[3][0], vb)) / (A.knuckles * SCALE);
      const palmL = at(F[1][0], va).distanceTo(W) / (A.palm * SCALE);
      put(2, wristQ, W, sv.set(wide, palmL, wide));
      const seg = (i: number, o: THREE.Object3D, rigLen: number) => put(i, frameOf(o, G), at(o, vc).clone(), sv.set(wide, rigLen / (A.len[i] * SCALE), wide));
      F.forEach((f, k) => {
        const l0 = at(f[0], va).distanceTo(at(f[1], vb)), l1 = vb.distanceTo(at(f[2], vc));
        seg(6 + k * 3, f[0], l0); seg(7 + k * 3, f[1], l1); seg(8 + k * 3, f[2], l1 * 0.83);
      });
      const t0 = at(j.thumb[0], va).distanceTo(at(j.thumb[1], vb));
      seg(3, j.thumb[0], t0); seg(4, j.thumb[1], t0 * 0.83);
      put(5, frameOf(j.thumb[1], G), under(5).clone(), sv.set(wide, t0 * 0.6 / (A.len[5] * SCALE), wide));
      pinv.copy(parent.matrixWorld).invert();
      bones.forEach((bn, i) => { bn.matrix.multiplyMatrices(pinv, world[i]); bn.matrixWorldNeedsUpdate = true; });
      parent.updateMatrixWorld(true);
    },
    dispose() { parent.remove(mesh); for (const bn of bones) parent.remove(bn); },
  };
}

/** the bones that hang: each is swung so the way to the named bone points straight down, as the puppet's limbs do */
const HANG: Record<string, string> = {};
for (const s of ['L', 'R']) {
  HANG[`DEF-upper_arm${s}`] = `DEF-upper_arm${s}001`; HANG[`DEF-upper_arm${s}001`] = `DEF-forearm${s}`;
  HANG[`DEF-forearm${s}`] = `DEF-forearm${s}001`; HANG[`DEF-forearm${s}001`] = `DEF-hand${s}`;
  HANG[`DEF-hand${s}`] = `DEF-f_middle01${s}`;
  HANG[`DEF-thigh${s}`] = `DEF-thigh${s}001`; HANG[`DEF-thigh${s}001`] = `DEF-shin${s}`;
  HANG[`DEF-shin${s}`] = `DEF-shin${s}001`; HANG[`DEF-shin${s}001`] = `DEF-foot${s}`;
}

/** which puppet joint each of Bora's bones follows (the puppet's index 0 is its left, Bora's ".L") */
function sources(R: PlayerRig): Map<string, THREE.Object3D> {
  const m = new Map<string, THREE.Object3D>();
  m.set('DEF-spine', R.lower); m.set('DEF-spine001', R.lower);
  m.set('DEF-spine002', R.body); m.set('DEF-spine003', R.body); m.set('DEF-spine004', R.body);
  m.set('DEF-spine005', R.head); m.set('DEF-spine006', R.head);
  ['L', 'R'].forEach((s, i) => {
    m.set(`DEF-thigh${s}`, R.thighs[i]); m.set(`DEF-thigh${s}001`, R.thighs[i]);
    m.set(`DEF-shin${s}`, R.knees[i]); m.set(`DEF-shin${s}001`, R.knees[i]);
    m.set(`DEF-foot${s}`, R.ankles[i]);
    m.set(`DEF-shoulder${s}`, R.body);
    m.set(`DEF-upper_arm${s}`, R.shoulders[i]); m.set(`DEF-upper_arm${s}001`, R.shoulders[i]);
    m.set(`DEF-forearm${s}`, R.elbows[i]); m.set(`DEF-forearm${s}001`, R.elbows[i]);
    m.set(`DEF-hand${s}`, R.wrists[i]);
  });
  return m;
}

// ---- materials, shared by everyone with the same colours (and one recoloured skin texture per skin tone)
const mats = new Map<string, THREE.Material>();
const skinTex = new Map<string, THREE.Texture>();
function baseColour(t: THREE.Texture | null): [number, number, number] {
  const img = t?.image as CanvasImageSource & { width: number; height: number } | undefined;
  if (!img) return [0.55, 0.43, 0.38];
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d')!; x.drawImage(img, 0, 0, 64, 64);
  const d = x.getImageData(0, 0, 64, 64).data, n = new Map<number, number>();
  for (let i = 0; i < d.length; i += 4) { const k = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3); n.set(k, (n.get(k) ?? 0) + 1); }
  const top = [...n].sort((a, b) => b[1] - a[1])[0][0];
  return [((top >> 10) & 31) * 8 + 4, ((top >> 5) & 31) * 8 + 4, (top & 31) * 8 + 4];
}
/** his skin texture with its skin shade swapped for `hex` (darker and lighter marks, the tattoos, stay as they are relative to it) */
function skinFor(hex: string): THREE.Texture | null {
  if (!T?.skin) return null;
  let t = skinTex.get(hex);
  if (t) return t;
  const img = T.skin.image as CanvasImageSource, S = 512;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d')!; x.drawImage(img, 0, 0, S, S);
  const id = x.getImageData(0, 0, S, S), d = id.data, [br, bg, bb] = T.skinBase;
  // (the swatch as it shows on screen: three's Color holds linear values, which made every tone redder and darker)
  const hx = parseInt(hex.slice(1), 16), tr = (hx >> 16) & 255, tg = (hx >> 8) & 255, tb = hx & 255;
  // (by brightness, not channel by channel: the chosen tone's own colour, lighter where his texture is lighter, the tattoos)
  const lb = 0.3 * br + 0.59 * bg + 0.11 * bb;
  for (let i = 0; i < d.length; i += 4) {
    const k = (0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]) / lb;
    d[i] = Math.min(255, k * tr); d[i + 1] = Math.min(255, k * tg); d[i + 2] = Math.min(255, k * tb);
  }
  x.putImageData(id, 0, 0);
  t = new THREE.Texture(c);
  t.userData.still = true;
  t.flipY = T.skin.flipY; t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true;
  skinTex.set(hex, t);
  return t;
}
function mat(key: string, make: () => THREE.Material) { let m = mats.get(key); if (!m) { m = make(); m.name = 'bora_' + key; mats.set(key, m); } return m; }
const std = (color: string, rough = 0.85, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, ...extra });

export interface BoraBody {
  root: THREE.Group;
  /** copy the puppet's pose onto him (call after the puppet has been animated this frame) */
  pose(): void;
  /** first person: `head` hides the head (the camera is in it), `arms` the arms too (a flat screen draws its own) */
  firstPerson(head: boolean, arms: boolean, hands?: boolean): void;
  dispose(): void;
}

/** a Bora for one player, following the puppet rig `R` (added under R.rig) */
export function makeBora(R: PlayerRig, look: Look): BoraBody | null {
  if (!T) return null;
  const scene = cloneSkinned(T.scene) as THREE.Group;
  scene.rotation.set(0, Math.PI, 0); scene.scale.setScalar(SCALE);
  const root = new THREE.Group(); root.name = 'bora'; root.add(scene);
  R.rig.add(root);
  const hide = new Set<THREE.Object3D>();
  scene.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true;
    const n = m.name;
    if (n === 'Body') m.material = mat('skin' + look.skin, () => std('#ffffff', 0.75, { map: skinFor(look.skin) }));
    else if (n === 'Hair') { m.material = mat('hair' + look.hair, () => std(look.hair, 0.95)); if (look.hairStyle === 5) m.visible = false; hide.add(m); }
    else if (n === 'Beard') { m.material = mat('hair' + look.hair, () => std(look.hair, 0.95)); m.visible = look.beardStyle !== 2; if (look.beardStyle === 1 && T!.beardShort) m.geometry = T!.beardShort; hide.add(m); }
    else if (n === 'Pant') { m.material = mat('pants' + look.pants, () => std(look.pants, 0.9)); m.visible = look.pantsStyle === 1; }
    else if (/eyebrow/.test(n)) { m.material = mat('brow' + look.hair, () => std(look.hair, 0.9, { map: T!.brow, alphaTest: 0.4, side: THREE.DoubleSide })); hide.add(m); }
    else if (/eyelash/.test(n)) { m.material = mat('lash', () => std('#2a1e18', 0.9, { map: T!.lash, alphaTest: 0.4, side: THREE.DoubleSide })); hide.add(m); }
    else if (/eyes/.test(n)) { const iris = (m.material as THREE.Material).name === 'purple'; m.material = iris ? mat('iris' + look.eye, () => std(look.eye, 0.4)) : mat('eyeWhite', () => std('#f2efe8', 0.35)); hide.add(m); }
  });
  // ---- what he wears: clothes cut from his skin (they share his skeleton), and things worn on a bone
  const body = scene.getObjectByName('Body') as THREE.SkinnedMesh;
  const wear = (key: string, m: THREE.Material) => {
    const g = new THREE.SkinnedMesh(T!.clothes[key], m);
    g.name = 'bora_' + key; g.frustumCulled = false; g.castShadow = true; g.receiveShadow = true;
    g.bind(body.skeleton, body.bindMatrix);
    body.parent!.add(g);
  };
  const cloth = (c: string) => mat('cloth' + c, () => std(c, 0.95, { side: THREE.DoubleSide }));
  wear('shirt' + (look.shirtStyle ?? 0), cloth(look.shirt));
  if (look.pantsStyle !== 1) wear('trousers', cloth(look.pants));
  wear(look.shoeStyle === 1 ? 'sandals' : 'boots', mat('shoe' + look.shoe, () => std(look.shoe, 0.8, { side: THREE.DoubleSide })));
  /** `obj`, made in rig space (metres, facing -Z), worn on bone `name`: it follows the bone from now on */
  const onBone = (name: string, obj: THREE.Object3D) => {
    const b = scene.getObjectByName(name)!, M = T!.restM.get(name)!;
    obj.updateMatrix();
    new THREE.Matrix4().copy(M).invert().multiply(obj.matrix).decompose(obj.position, obj.quaternion, obj.scale);
    b.add(obj);
    return obj;
  };
  const part = (geo: THREE.BufferGeometry, color: string, x = 0, y = 0, z = 0, rough = 0.85) => {
    const m = new THREE.Mesh(geo, mat('acc' + color, () => std(color, rough))); m.position.set(x, y, z); m.castShadow = true; return m;
  };
  if (look.hat) {
    const hat = new THREE.Group();
    hat.add(part(new THREE.CylinderGeometry(0.235, 0.24, 0.014, 28), '#d8c08a', 0, 0, 0, 0.95));
    hat.add(part(new THREE.CylinderGeometry(0.105, 0.125, 0.11, 22), '#d8c08a', 0, 0.06, 0, 0.95));
    hat.add(part(new THREE.CylinderGeometry(0.127, 0.127, 0.03, 22), look.accent, 0, 0.022, 0));
    hat.position.set(0, 1.745, 0.01); hat.rotation.x = -0.08;
    onBone('DEF-spine006', hat);
  }
  if (look.glasses) {
    const g = new THREE.Group(), dark = '#121314';
    for (const x of [-0.03, 0.03]) g.add(part(new THREE.BoxGeometry(0.036, 0.024, 0.005), dark, x, 0, 0, 0.2));
    g.add(part(new THREE.BoxGeometry(0.03, 0.005, 0.005), dark, 0, 0.008, 0, 0.3));
    for (const x of [-0.05, 0.05]) g.add(part(new THREE.BoxGeometry(0.004, 0.005, 0.07), dark, x, 0.008, 0.035, 0.3));
    g.position.set(0, 1.645, -0.032);
    onBone('DEF-spine006', g);
  }
  if (look.scarf) {
    const sc = new THREE.Group(), ny = T!.restM.get('DEF-spine004')!.elements[13];
    sc.add(part(new THREE.TorusGeometry(0.058, 0.02, 8, 18).rotateX(Math.PI / 2), look.accent, 0, 0, 0, 0.95));
    sc.add(part(new THREE.BoxGeometry(0.06, 0.06, 0.012), look.accent, 0, -0.045, -0.062, 0.95).rotateZ(Math.PI / 4));
    sc.position.set(0, ny + 0.01, 0.005);
    onBone('DEF-spine004', sc);
  }
  // the rucksack or satchel: the puppet's own, moved onto his back (he is slimmer than the puppet)
  if (R.pack) {
    const bodyRest = new THREE.Vector3();
    for (let p: THREE.Object3D | null = R.body; p && p !== R.rig; p = p.parent) bodyRest.add(p.position);
    const pk = R.pack;
    pk.parent?.remove(pk);
    // (squeezed to his depth and width: the straps lie on his chest, the pack on his back)
    const back = new THREE.Group(); back.position.copy(bodyRest);
    const depth = T!.backZ - T!.chest.z;
    back.position.z = (T!.backZ + T!.chest.z) / 2 + 0.01; back.scale.set(0.8, 1, Math.min(1, depth / 0.235));
    back.add(pk);
    onBone('DEF-spine003', back);
  }
  // the name plate: on his chest, not in front of it
  const plate = R.body.getObjectByName('nameplate');
  if (plate) {
    let bz = 0;
    for (let p: THREE.Object3D | null = R.body; p && p !== R.rig; p = p.parent) bz += p.position.z;
    plate.position.z = T.chest.z - 0.01 - bz;
  }

  // the puppet's own meshes stay out of sight (it still carries the held tool, the name plate and the armour)
  const keep = (o: THREE.Object3D) => { for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.name === 'nameplate' || p.userData.held || p === root) return true; return false; };
  const puppetMeshes: THREE.Object3D[] = [];
  R.rig.traverse((o) => { if ((o as THREE.Mesh).isMesh && !keep(o)) puppetMeshes.push(o); });

  const src = sources(R);
  const bones: THREE.Bone[] = [];
  scene.traverse((o) => { if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone); });   // (parents before children)
  const restLocal = new Map(bones.map((b) => [b, b.quaternion.clone()]));
  const world = new Map<THREE.Object3D, THREE.Quaternion>();
  const rigInv = new THREE.Quaternion(), tq = new THREE.Quaternion(), rootQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI, 0));
  const hipBone = scene.getObjectByName('DEF-spine') as THREE.Bone;
  const headBone = scene.getObjectByName('DEF-spine006') as THREE.Bone;
  const armBones = ['L', 'R'].map((s) => scene.getObjectByName(`DEF-upper_arm${s}`) as THREE.Bone);
  const hands = ['L', 'R'].map((s) => scene.getObjectByName(`DEF-hand${s}`) as THREE.Bone);
  const hp = new THREE.Vector3(), m4 = new THREE.Matrix4(), v = new THREE.Vector3();
  let fpHead = false, fpArms = false, fpHands = false;
  // a fist: each finger's segments bend about their own x (01 most at the knuckle), the thumb a little
  const FIST: Record<string, number> = { '01': 1.25, '02': 1.35, '03': 0.95 };
  const curlOf = new Map<THREE.Bone, { side: number; a: number }>();
  for (const b of bones) {
    const m = /^DEF-(f_[a-z]+|thumb)(0[123])([LR])$/.exec(b.name);
    if (m) curlOf.set(b, { side: m[3] === 'L' ? 0 : 1, a: (m[1] === 'thumb' ? 0.45 : 1) * FIST[m[2]] });
  }
  const qc = new THREE.Quaternion(), XA = new THREE.Vector3(1, 0, 0);

  return {
    root,
    pose() {
      // (whether the puppet's hands are fists this frame: holding something)
      const fist = [R.fist[0].visible, R.fist[1].visible];
      for (const o of puppetMeshes) o.visible = false;
      R.rig.updateMatrixWorld(true);
      R.rig.getWorldQuaternion(rigInv).invert();
      // every bone, parents first: those that follow a puppet joint take its rotation (after hanging like it at rest);
      // the others (fingers, toes, the pelvis wings) keep their own rest pose under their parent
      for (const b of bones) {
        const parentQ = world.get(b.parent!) ?? rootQ;
        const s = src.get(b.name), r = T!.rest.get(b.name);
        if (s && r) {
          s.getWorldQuaternion(tq);
          const q = rigInv.clone().multiply(tq).multiply(r.ref);
          b.quaternion.copy(parentQ.clone().invert().multiply(q));
          world.set(b, q);
        } else {
          b.quaternion.copy(restLocal.get(b)!);
          const c = curlOf.get(b);
          if (c && fist[c.side]) b.quaternion.multiply(qc.setFromAxisAngle(XA, c.a));
          world.set(b, parentQ.clone().multiply(b.quaternion));
        }
      }
      // the hips go where the puppet's hips go (crouching, sitting, lying down, swimming)
      hp.copy(T!.hip0).applyMatrix4(m4.copy(R.lower.matrix));
      hipBone.position.copy(hp).applyMatrix4(T!.rootParentInv);
      // first person: the head (and on a screen the arms) shrunk away to nothing
      headBone.scale.setScalar(fpHead ? 1e-3 : 1);
      for (const a of armBones) a.scale.setScalar(fpArms ? 1e-3 : 1);
      // (in a headset your own hands are drawn at the controllers: the body's are tucked away)
      for (const h of hands) h.scale.setScalar(fpHands ? 1e-3 : 1);
      // whatever the puppet holds goes into Bora's hand: its wrists are put where his are
      scene.updateMatrixWorld(true);
      for (let i = 0; i < 2; i++) {
        const w = R.wrists[i], el = w.parent!;
        hands[i].getWorldPosition(v);
        el.updateWorldMatrix(true, false);
        w.position.copy(el.worldToLocal(v));
      }
    },
    firstPerson(head: boolean, arms: boolean, handsToo = false) { fpHead = head; fpArms = arms; fpHands = handsToo; for (const o of hide) if (head) o.visible = false; },
    dispose() { R.rig.remove(root); },
  };
}
