// The raft engine: a metal stand with a big office water bottle on top (upside down, its neck in the stand, as on a water
// cooler), and in the bottle a little swarm of the island's butterflies, all facing the same way and beating their wings
// as hard as they can: that is what pushes the raft. Tubes and coloured wires run from a box of humming tech in the
// stand up into the bottle's neck and down to the deck, a gauge and a lamp on the box's front. Switched on and off with E;
// the raft goes the way the engine faces (its front, where the butterflies' heads point: local -z), and the oar steers.
// Built from three.js parts like every other structure (structures.ts bakes it); the wings are kept as their own nodes so
// they can flap.
import { Quaternion, type TransformNode, Vector3 } from "@babylonjs/core";
import * as THREE from "three";
import { tok } from "../render/bake";
import { wingGeometry } from "../world/butterflies";

/** the wing colours (structures.ts gives each key its material): the butterflies' own palette, a few of it */
export const ENGINE_WINGS = ["#f28a1a", "#2f7bff", "#ffd23a", "#ff6fb1", "#9be35a", "#8f6cff", "#36d1c4"];

/** where the butterflies sit in the bottle (local x, y, z) */
const FLIES: [number, number, number][] = [
  [-0.03, 0.92, -0.03], [0.03, 0.97, 0.03], [0, 1.03, -0.05], [-0.03, 1.08, 0.05], [0.03, 1.13, -0.02], [0, 1.19, 0.03], [-0.02, 0.99, 0.08],
];

/** each wing the model keeps apart: its mesh, which side it is on, and the butterfly's own beat phase */
export interface WingPart { o: THREE.Object3D; side: 1 | -1; ph: number }

export function engineModel(g: THREE.Group, shadows: boolean): WingPart[] {
  const add = (geo: THREE.BufferGeometry, key: string, x = 0, y = 0, z = 0, to: THREE.Object3D = g) => {
    const m = new THREE.Mesh(geo, tok(key)); m.position.set(x, y, z); m.castShadow = shadows; m.receiveShadow = shadows; to.add(m); return m;
  };
  const tube = (pts: [number, number, number][], r: number, key: string) => add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), 16, r, 6, false), key);
  // ---- the stand: a foot plate, four legs, a top ring that holds the bottle's neck
  add(new THREE.BoxGeometry(0.56, 0.05, 0.56), "iron", 0, 0.025, 0);
  for (const [x, z] of [[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22]]) add(new THREE.CylinderGeometry(0.022, 0.026, 0.58, 8), "steel", x, 0.33, z);
  add(new THREE.BoxGeometry(0.52, 0.04, 0.52), "steel", 0, 0.62, 0);
  add(new THREE.CylinderGeometry(0.075, 0.09, 0.07, 16), "iron", 0, 0.665, 0);
  // ---- the tech in the stand: a box with a gauge, a lamp and a few switches on its front (+z: the side you stand at)
  add(new THREE.BoxGeometry(0.34, 0.26, 0.3), "iron", 0, 0.2, 0);
  add(new THREE.BoxGeometry(0.3, 0.22, 0.01), "steel", 0, 0.2, 0.152);
  add(new THREE.CylinderGeometry(0.05, 0.05, 0.012, 18).rotateX(Math.PI / 2), "cream", -0.07, 0.23, 0.16);
  add(new THREE.BoxGeometry(0.006, 0.04, 0.004), "char", -0.07, 0.24, 0.168).rotation.z = -0.6;
  add(new THREE.SphereGeometry(0.022, 10, 8), "engineLamp", 0.08, 0.25, 0.158);
  for (const x of [0.04, 0.08, 0.12]) add(new THREE.BoxGeometry(0.014, 0.03, 0.02), "brass", x, 0.15, 0.162);
  // a fan grille on the side, and a coil of copper on top of the box
  add(new THREE.TorusGeometry(0.07, 0.008, 6, 20).rotateY(Math.PI / 2), "steel", 0.172, 0.2, 0);
  for (let k = 0; k < 3; k++) add(new THREE.BoxGeometry(0.004, 0.11, 0.008), "steel", 0.173, 0.2, -0.04 + k * 0.04);
  for (let k = 0; k < 5; k++) add(new THREE.TorusGeometry(0.045, 0.007, 6, 16).rotateX(Math.PI / 2), "copper", -0.08, 0.345 + k * 0.014, -0.06);
  // ---- tubes and wires: from the box up into the bottle's neck, and over the side down to the deck
  tube([[0.1, 0.33, 0.05], [0.16, 0.48, 0.1], [0.06, 0.6, 0.06], [0.03, 0.66, 0.02]], 0.016, "rubber");
  tube([[-0.12, 0.33, 0.08], [-0.2, 0.5, 0.06], [-0.07, 0.62, -0.02], [-0.04, 0.67, -0.01]], 0.012, "rubber");
  tube([[0.17, 0.25, -0.1], [0.3, 0.3, -0.18], [0.32, 0.12, -0.26], [0.28, 0.03, -0.3]], 0.011, "rubber");
  tube([[0.05, 0.33, -0.1], [0.14, 0.52, -0.14], [0.05, 0.64, -0.05]], 0.006, "wireRed");
  tube([[-0.02, 0.33, -0.12], [-0.12, 0.55, -0.16], [-0.03, 0.64, -0.06]], 0.006, "wireYellow");
  tube([[-0.17, 0.12, 0.1], [-0.3, 0.15, 0.2], [-0.32, 0.04, 0.28]], 0.006, "wireBlue");
  // ---- the bottle: an office water bottle upside down, its neck in the ring; ridged, see-through blue
  add(new THREE.CylinderGeometry(0.035, 0.035, 0.08, 14), "bottleCap", 0, 0.68, 0);
  add(new THREE.CylinderGeometry(0.04, 0.04, 0.06, 14, 1, true), "bottle", 0, 0.73, 0);
  add(new THREE.CylinderGeometry(0.16, 0.04, 0.1, 22, 1, true), "bottle", 0, 0.81, 0);
  add(new THREE.CylinderGeometry(0.16, 0.16, 0.38, 22, 1, true), "bottle", 0, 1.05, 0);
  add(new THREE.CylinderGeometry(0.155, 0.16, 0.04, 22), "bottle", 0, 1.26, 0);
  for (const y of [0.92, 1.02, 1.12]) add(new THREE.TorusGeometry(0.162, 0.006, 6, 26).rotateX(Math.PI / 2), "bottle", 0, y, 0);
  // ---- the butterflies: bodies baked with the bottle, each wing kept apart to flap. Heads to -z (the way it pushes).
  const wing = wingGeometry().scale(1.35, 1.35, 1.35), wingL = wing.clone().scale(-1, 1, 1);
  const wings: WingPart[] = [];
  FLIES.forEach(([x, y, z], i) => {
    const key = `wing${i % ENGINE_WINGS.length}`;
    const fly = new THREE.Group(); fly.position.set(x, y, z); fly.rotation.y = Math.PI; g.add(fly);   // (+z forward in the wing's own space)
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.009, 0.075, 5).rotateX(Math.PI / 2), tok("char")); fly.add(body);
    for (const side of [1, -1] as const) {
      const w = new THREE.Mesh(side === 1 ? wing : wingL, tok(key)); w.userData.keep = true; fly.add(w);
      wings.push({ o: w, side, ph: i * 1.7 });
    }
  });
  return wings;
}

/** the kept wing nodes after baking, with their resting turn */
export interface Wing { n: TransformNode; base: Quaternion; side: 1 | -1; ph: number }

export function makeWings(parts: WingPart[], kept: Map<THREE.Object3D, TransformNode>): Wing[] {
  return parts.map((p) => {
    const n = kept.get(p.o)!;
    const q = n.rotationQuaternion ?? new Quaternion();
    return { n, base: q.clone(), side: p.side, ph: p.ph };
  });
}

const FLAP = new Quaternion(), AXIS_Z = new Vector3(0, 0, 1);
/** beat the wings: fast and hard when the engine runs, a slow lazy fold when it is off */
export function flapWings(wings: Wing[], t: number, on: boolean) {
  for (const w of wings) {
    const a = on ? 0.15 + 0.85 * (0.5 + 0.5 * Math.sin(t * 34 + w.ph)) : 0.9 + 0.25 * Math.sin(t * 1.3 + w.ph);
    Quaternion.RotationAxisToRef(AXIS_Z, a * w.side, FLAP);
    w.base.multiplyToRef(FLAP, w.n.rotationQuaternion ??= new Quaternion());
  }
}
