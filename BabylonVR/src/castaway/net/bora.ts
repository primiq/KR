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
    });
    const hipBone = scene.getObjectByName('DEF-spine')!;
    const hip0 = wp(hipBone);
    const rootParentInv = hipBone.parent!.matrixWorld.clone().invert();
    // the textures, and his skin's own colour (the middle of the body texture's most common shade)
    let skin: THREE.Texture | null = null, brow: THREE.Texture | null = null, lash: THREE.Texture | null = null, beardShort: THREE.BufferGeometry | null = null;
    let chestY = 1.35, chestZ = -0.12;
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
      }
      if (m.name === 'Beard') beardShort = trim(m.geometry);
      if (/eyebrow/.test(m.name)) brow = mat.map;
      if (/eyelash/.test(m.name)) lash = mat.map;
    });
    holder.remove(scene);
    scene.rotation.set(0, Math.PI, 0);
    T = { scene, rest, hip0, rootParentInv, skin, brow, lash, skinBase: baseColour(skin), chest: { y: chestY, z: chestZ }, beardShort };
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
  const id = x.getImageData(0, 0, S, S), d = id.data, [br, bg, bb] = T.skinBase, to = new THREE.Color(hex);
  const tr = to.r * 255, tg = to.g * 255, tb = to.b * 255;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = Math.min(255, d[i] / br * tr); d[i + 1] = Math.min(255, d[i + 1] / bg * tg); d[i + 2] = Math.min(255, d[i + 2] / bb * tb);
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
  firstPerson(head: boolean, arms: boolean): void;
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
    else if (n === 'Pant') m.material = mat('pants' + look.pants, () => std(look.pants, 0.9));
    else if (/eyebrow/.test(n)) { m.material = mat('brow' + look.hair, () => std(look.hair, 0.9, { map: T!.brow, alphaTest: 0.4, side: THREE.DoubleSide })); hide.add(m); }
    else if (/eyelash/.test(n)) { m.material = mat('lash', () => std('#2a1e18', 0.9, { map: T!.lash, alphaTest: 0.4, side: THREE.DoubleSide })); hide.add(m); }
    else if (/eyes/.test(n)) { const iris = (m.material as THREE.Material).name === 'purple'; m.material = iris ? mat('iris' + look.eye, () => std(look.eye, 0.4)) : mat('eyeWhite', () => std('#f2efe8', 0.35)); hide.add(m); }
  });
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
  let fpHead = false, fpArms = false;

  return {
    root,
    pose() {
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
          world.set(b, parentQ.clone().multiply(b.quaternion));
        }
      }
      // the hips go where the puppet's hips go (crouching, sitting, lying down, swimming)
      hp.copy(T!.hip0).applyMatrix4(m4.copy(R.lower.matrix));
      hipBone.position.copy(hp).applyMatrix4(T!.rootParentInv);
      // first person: the head (and on a screen the arms) shrunk away to nothing
      headBone.scale.setScalar(fpHead ? 1e-3 : 1);
      for (const a of armBones) a.scale.setScalar(fpArms ? 1e-3 : 1);
      // whatever the puppet holds goes into Bora's hand: its wrists are put where his are
      scene.updateMatrixWorld(true);
      for (let i = 0; i < 2; i++) {
        const w = R.wrists[i], el = w.parent!;
        hands[i].getWorldPosition(v);
        el.updateWorldMatrix(true, false);
        w.position.copy(el.worldToLocal(v));
      }
    },
    firstPerson(head: boolean, arms: boolean) { fpHead = head; fpArms = arms; for (const o of hide) if (head) o.visible = false; },
    dispose() { R.rig.remove(root); },
  };
}
