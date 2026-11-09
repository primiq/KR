// The ship's compass: a brass binnacle on a wooden stand, set down on a raft or a boat (or anywhere). Its card always shows
// true north (north = -z, as on the map) however the deck turns under it, a little red house on the bezel points home to
// the island, and a small screen on the stand says how far away home is. Built from three.js parts like every other
// structure (see structures.ts); the card, the bezel and the screen are kept as their own nodes so they can turn and change.
import { Color3, DynamicTexture, type Mesh, Quaternion, type Scene, StandardMaterial, type TransformNode } from "@babylonjs/core";
import * as THREE from "three";
import { tok } from "../render/bake";
import { heightAt } from "../world/island";

/** the card's height on the stand, and its radius */
export const CARD_Y = 1.06, CARD_R = 0.17;

/** the parts that move: added to the model by `compassModel`, found again after baking */
export interface CompassParts { card: THREE.Object3D; home: THREE.Object3D; screen: THREE.Object3D }

/** the stand, the brass bowl, the card, the home bezel and the screen (stand-in material keys, see structures matFor) */
export function compassModel(g: THREE.Group, shadows: boolean): CompassParts {
  const add = (geo: THREE.BufferGeometry, key: string, x = 0, y = 0, z = 0, to: THREE.Object3D = g) => {
    const m = new THREE.Mesh(geo, tok(key)); m.position.set(x, y, z); m.castShadow = shadows; m.receiveShadow = shadows; to.add(m); return m;
  };
  // a turned wooden post on a square foot, a brass bowl on top
  add(new THREE.BoxGeometry(0.42, 0.06, 0.42), "beam", 0, 0.03, 0);
  add(new THREE.CylinderGeometry(0.07, 0.09, 0.82, 10), "beam", 0, 0.47, 0);
  add(new THREE.CylinderGeometry(0.2, 0.12, 0.16, 20), "brass", 0, 0.95, 0);
  add(new THREE.TorusGeometry(0.2, 0.018, 6, 28).rotateX(Math.PI / 2), "brass", 0, CARD_Y + 0.01, 0);
  // the card: a flat disc with the rose painted on (it turns: kept)
  const card = add(new THREE.CircleGeometry(CARD_R, 32).rotateX(-Math.PI / 2), "card", 0, CARD_Y, 0);
  card.userData.keep = true; card.userData.uv = true;
  // the lubber line: a little brass pin at the front of the bowl, where the bow points
  add(new THREE.BoxGeometry(0.012, 0.03, 0.03), "brass", 0, CARD_Y + 0.02, -0.19);
  // the home bezel: a red house riding round the rim (it turns: kept)
  const home = new THREE.Group(); home.position.set(0, CARD_Y + 0.03, 0); home.userData.keep = true; g.add(home);
  add(new THREE.BoxGeometry(0.05, 0.035, 0.04), "homeMark", 0, 0, -0.2, home);
  add(new THREE.ConeGeometry(0.042, 0.035, 4).rotateY(Math.PI / 4), "homeMark", 0, 0.035, -0.2, home);
  // the screen: a dark slab on a bracket, angled up at whoever stands at the stand's front (+z)
  const bracket = new THREE.Group(); bracket.position.set(0, 0.72, 0.12); bracket.rotation.x = -0.6; g.add(bracket);
  add(new THREE.BoxGeometry(0.34, 0.18, 0.03), "iron", 0, 0, 0, bracket);
  const screen = add(new THREE.PlaneGeometry(0.31, 0.155), "screen", 0, 0, 0.016, bracket);
  screen.userData.keep = true; screen.userData.uv = true;
  return { card, home, screen };
}

let ROSE: StandardMaterial | null = null;
/** the compass rose: N (red), E, S, W, the points between, and ticks every 10 degrees; lit a little, like a binnacle lamp */
export function roseMaterial(scene: Scene): StandardMaterial {
  if (ROSE) return ROSE;
  const S = 512, t = new DynamicTexture("compassRose", S, scene, true), c = t.getContext() as CanvasRenderingContext2D, h = S / 2;
  c.fillStyle = "#16242f"; c.fillRect(0, 0, S, S);
  c.beginPath(); c.arc(h, h, h - 4, 0, Math.PI * 2); c.fillStyle = "#f2ead6"; c.fill();
  c.beginPath(); c.arc(h, h, h - 26, 0, Math.PI * 2); c.fillStyle = "#1f3140"; c.fill();
  c.strokeStyle = "#f2ead6"; c.lineCap = "round";
  for (let d = 0; d < 360; d += 10) {
    const a = (d * Math.PI) / 180, r0 = d % 90 === 0 ? h - 74 : d % 30 === 0 ? h - 56 : h - 44, r1 = h - 30;
    c.lineWidth = d % 30 === 0 ? 5 : 3;
    c.beginPath(); c.moveTo(h + Math.sin(a) * r0, h - Math.cos(a) * r0); c.lineTo(h + Math.sin(a) * r1, h - Math.cos(a) * r1); c.stroke();
  }
  // the star: long points to N E S W, short ones between
  const point = (d: number, len: number, w: number, col: string) => {
    const a = (d * Math.PI) / 180, s = Math.sin(a), co = Math.cos(a);
    c.beginPath(); c.moveTo(h + s * len, h - co * len); c.lineTo(h + co * w, h + s * w); c.lineTo(h - co * w, h - s * w); c.closePath(); c.fillStyle = col; c.fill();
  };
  for (const d of [45, 135, 225, 315]) point(d, 110, 18, "#8fa3ad");
  for (const d of [90, 180, 270]) point(d, 160, 26, "#f2ead6");
  point(0, 160, 26, "#e8452e");
  c.textAlign = "center"; c.textBaseline = "middle"; c.font = "bold 64px sans-serif";
  for (const [d, l] of [[0, "N"], [90, "E"], [180, "S"], [270, "W"]] as [number, string][]) {
    const a = (d * Math.PI) / 180, r = h - 106;
    c.fillStyle = d === 0 ? "#ff6a4a" : "#f2ead6";
    c.save(); c.translate(h + Math.sin(a) * r, h - Math.cos(a) * r); c.rotate(a); c.fillText(l, 0, 0); c.restore();
  }
  c.beginPath(); c.arc(h, h, 12, 0, Math.PI * 2); c.fillStyle = "#c99a3c"; c.fill();
  t.update();
  const m = new StandardMaterial("compassCard", scene);
  // (lit from within, as a binnacle's lamp lights it: readable by night. The emissive texture adds to the emissive colour)
  t.level = 0.85;
  m.disableLighting = true; m.emissiveTexture = t; m.emissiveColor = new Color3(0, 0, 0); m.diffuseColor = new Color3(0, 0, 0); m.specularColor = new Color3(0, 0, 0);
  ROSE = m;
  return m;
}

/** one compass's moving parts once baked, and its own little screen */
export interface Dial { card: TransformNode; home: TransformNode; tex: DynamicTexture; shown: string; t: number; home_m: number }

export function makeDial(scene: Scene, card: TransformNode, home: TransformNode, screen: TransformNode): Dial {
  const tex = new DynamicTexture("compassScreen", { width: 256, height: 128 }, scene, true);
  const m = new StandardMaterial("compassScreenMat", scene);
  m.disableLighting = true; m.emissiveTexture = tex; m.emissiveColor = new Color3(0, 0, 0); m.diffuseColor = new Color3(0, 0, 0); m.specularColor = new Color3(0, 0, 0); m.backFaceCulling = false;
  for (const c of screen.getChildMeshes()) (c as Mesh).material = m;
  // (the card's own material, the rose, is set by its key: see structures matFor "card")
  return { card, home, tex, shown: "", t: 0, home_m: 0 };
}

/** how far from (x, z) to the island's shore, walking straight towards its middle (m) */
export function homeDistance(x: number, z: number): number {
  const r = Math.hypot(x, z);
  // (only the island itself is home: the islets, the ice and the Arctic further out are not)
  const HOME = 700;
  if (r < 1 || (r < HOME && heightAt(x, z) > 0)) return 0;
  // step in towards the middle until the island's ground comes out of the sea
  for (let d = Math.max(0, r - HOME); d < r; d += 4) { const k = (r - d) / r; if (heightAt(x * k, z * k) > 0) return d; }
  return r;
}

/** turn the card to north and the house towards home; now and then, write the distance on the screen */
export function updateDial(dl: Dial, x: number, z: number, yaw: number, dt: number) {
  // (yaw: which way the stand faces; the card turns the other way so its north stays north)
  Quaternion.RotationYawPitchRollToRef(-yaw, 0, 0, dl.card.rotationQuaternion ??= new Quaternion());
  Quaternion.RotationYawPitchRollToRef(Math.atan2(x, z) - yaw, 0, 0, dl.home.rotationQuaternion ??= new Quaternion());
  dl.t -= dt;
  if (dl.t > 0) return;
  dl.t = 0.5;
  dl.home_m = homeDistance(x, z);
  const d = dl.home_m;
  const txt = d < 5 ? "HOME" : d < 1000 ? `${Math.round(d / 5) * 5} m` : `${(d / 1000).toFixed(2)} km`;
  if (txt === dl.shown) return;
  dl.shown = txt;
  const c = dl.tex.getContext() as CanvasRenderingContext2D;
  c.fillStyle = "#06120e"; c.fillRect(0, 0, 256, 128);
  c.strokeStyle = "#2c6b55"; c.lineWidth = 4; c.strokeRect(4, 4, 248, 120);
  // a little house, then the distance
  c.fillStyle = "#ff6a4a"; c.beginPath(); c.moveTo(18, 62); c.lineTo(38, 40); c.lineTo(58, 62); c.closePath(); c.fill(); c.fillRect(24, 62, 28, 24);
  c.fillStyle = "#7dffc8"; c.font = "bold 46px monospace"; c.textAlign = "right"; c.textBaseline = "middle";
  c.fillText(txt, 240, 66);
  dl.tex.update();
}
