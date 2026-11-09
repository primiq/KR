// The flag: a tall wooden pole (nearly a wall's height) with a gold knob on top and a cloth flying from it, white until
// somebody paints it. Open it (E) to paint it, the same way as a picture (the same editor; in VR straight onto the cloth,
// held still while you paint); the picture is kept as a small PNG, saved with the world and sent to everybody. It stands
// anywhere a structure can, rafts and boats included, and sails with them.
// Built like the other structures (structures.ts); the cloth is kept as its own mesh so it can wave in the wind and wear
// its picture.
import { Color3, DynamicTexture, type Mesh, type Scene, StandardMaterial, type TransformNode, VertexBuffer } from "@babylonjs/core";
import * as THREE from "three";
import { tok } from "../render/bake";
import { WALL_H } from "./building";
import { CANVAS_H, CANVAS_W, PAPER } from "./paintings";

/** the pole's height, the cloth's size (4:3, like a picture's canvas) */
export const POLE_H = WALL_H * 0.92, CLOTH_W = 1.3, CLOTH_H = 0.975;
const MAX_DATA = 160_000;

/** the pole and its foot, and the cloth (kept: it waves and wears the picture) */
export function flagModel(g: THREE.Group, shadows: boolean): THREE.Object3D {
  const add = (geo: THREE.BufferGeometry, key: string, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, tok(key)); m.position.set(x, y, z); m.castShadow = shadows; m.receiveShadow = shadows; g.add(m); return m;
  };
  // a weighted wooden foot (it stands on a deck as well as on the ground), the pole, a gold knob, the rope's cleat
  add(new THREE.CylinderGeometry(0.2, 0.24, 0.1, 12), "beam", 0, 0.05, 0);
  add(new THREE.CylinderGeometry(0.035, 0.045, POLE_H, 10), "beam", 0, POLE_H / 2 + 0.05, 0);
  add(new THREE.SphereGeometry(0.065, 12, 8), "brass", 0, POLE_H + 0.1, 0);
  add(new THREE.BoxGeometry(0.03, 0.12, 0.04), "iron", 0.045, 1.1, 0);
  // the cloth: a grid (so it can ripple), its near edge at the pole, flying out along +x
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(CLOTH_W, CLOTH_H, 14, 8), tok("screen"));
  cloth.position.set(0.04 + CLOTH_W / 2, POLE_H - CLOTH_H / 2 - 0.02, 0);
  cloth.userData.keep = true; cloth.userData.uv = true;
  g.add(cloth);
  return cloth;
}

/** one flag's cloth: its picture (canvas, texture), the mesh and its resting shape */
export interface Cloth { canvas: HTMLCanvasElement; tex: DynamicTexture; data: string; mesh: Mesh; base: Float32Array; now: Float32Array; phase: number }

export function makeCloth(scene: Scene, node: TransformNode): Cloth | null {
  const mesh = node.getChildMeshes()[0] as Mesh | undefined;
  if (!mesh) return null;
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_W; canvas.height = CANVAS_H;
  const x = canvas.getContext("2d")!; x.fillStyle = "#ffffff"; x.fillRect(0, 0, CANVAS_W, CANVAS_H);
  const tex = new DynamicTexture("flagTex", canvas, { scene, invertY: true } as never);
  tex.update();
  const m = new StandardMaterial("flagMat", scene);
  m.diffuseTexture = tex; m.backFaceCulling = false; m.twoSidedLighting = true;
  m.specularColor = new Color3(0.05, 0.05, 0.05);
  m.emissiveColor = new Color3(0.12, 0.12, 0.12);
  mesh.material = m;
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind)!;
  mesh.markVerticesDataAsUpdatable(VertexBuffer.PositionKind, true);
  return { canvas, tex, data: "", mesh, base: Float32Array.from(pos), now: Float32Array.from(pos), phase: Math.random() * 10 };
}

/** a new picture on the cloth (a PNG data URL, '' = plain white). False if it is not a picture */
export function setClothData(c: Cloth, data: string): boolean {
  if (data.length > MAX_DATA || (data && !/^data:image\/(png|jpeg);base64,/.test(data))) return false;
  c.data = data;
  const x = c.canvas.getContext("2d")!;
  x.fillStyle = data ? PAPER : "#ffffff"; x.fillRect(0, 0, CANVAS_W, CANVAS_H);
  c.tex.update();
  if (data) {
    const img = new Image();
    img.onload = () => { if (c.data !== data) return; x.drawImage(img, 0, 0, CANVAS_W, CANVAS_H); c.tex.update(); };
    img.src = data;
  }
  return true;
}

/** the cloth flies and ripples in the wind (`wind`: about 1 calm, 3+ a gale); `still`: held flat (being painted) */
export function waveCloth(c: Cloth, time: number, wind: number, still: boolean) {
  const B = c.base, P = c.now, w = Math.min(1.6, 0.35 + wind * 0.3), x0 = -CLOTH_W / 2;
  for (let i = 0; i < B.length; i += 3) {
    const u = (B[i] - x0) / CLOTH_W, v = B[i + 1];
    if (still) { P[i] = B[i]; P[i + 1] = B[i + 1]; P[i + 2] = B[i + 2]; continue; }
    // waves running out along the cloth, bigger towards its free end; it droops a little when the air is still
    const ph = time * (3.2 + w * 2) - u * 6 + c.phase + v * 0.8;
    P[i] = B[i] - u * u * 0.06 * (1.6 - w);
    P[i + 1] = B[i + 1] - u * u * 0.22 * Math.max(0, 1.1 - w);
    P[i + 2] = B[i + 2] + Math.sin(ph) * 0.11 * u * w + Math.sin(ph * 2.3 + 1.7) * 0.03 * u * w;
  }
  c.mesh.updateVerticesData(VertexBuffer.PositionKind, P);
}

/** the cloth as a flat canvas, for painting on it in VR (as a picture: centre, which way it faces, size) */
export function clothPlane(c: Cloth): { x: number; y: number; z: number; normal: { x: number; z: number } } {
  const m = c.mesh.getWorldMatrix(), o = m.getTranslation();
  const n = { x: m.m[8], z: m.m[10] }, l = Math.hypot(n.x, n.z) || 1;
  return { x: o.x, y: o.y, z: o.z, normal: { x: n.x / l, z: n.z / l } };
}
