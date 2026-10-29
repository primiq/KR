import { Color3, Constants, DynamicTexture, type Material, PBRMaterial, PointLight, type Scene, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { bakeGroup, disposeBaked, tok } from "../render/bake";
import { ghostMaterial, glow as glowMat, rockMaterial, setGhostOk, solid, woodMaterials as woodMats } from "../render/materials";
import { heightAt } from "../world/island";
import type { Collider, ColliderGrid } from "../world/vegetation";
import { rayGround } from "./building";
import { Inventory } from "./inventory";
import { ITEMS, type ItemId, type PlaceKind } from "./items";
import { MAX_FUEL, STATION_RECIPES, WOOD_BURN } from "./recipes";
import { raySphere } from "./resources";
import { flowerGeometry, FLOWERS } from "../world/flowers";
import { meshFromThree } from "../render/geometry";
import { foliageMaterial } from "../render/materials";

const S_TOK = {
  stone: tok("stone"), log: tok("log"), logEnd: tok("logEnd"), char: tok("char"), steel: tok("steel"), iron: tok("iron"),
  cream: tok("cream"), pillow: tok("pillow"), blanket: tok("blanket"), rope: tok("rope"), soot: tok("soot"), ash: tok("ash"),
  coal: tok("coal"), flameOuter: tok("flameOuter"), flameMid: tok("flameMid"), flameIn: tok("flameIn"), furnaceGlow: tok("furnaceGlow"),
  glow: tok("glow"), clay: tok("clay"), soil: tok("soil"), lamp: tok("lamp"), catbed: tok("catbed"),
};
const W_TOK = { wall: tok("wall"), slab: tok("slab"), beam: tok("beam"), pile: tok("pile") };

/** Real materials for the stand-in keys used by the model code. */
function matFor(scene: Scene, key: string): Material {
  const W = woodMats(scene);
  switch (key) {
    case "wall": return W.wall;
    case "slab": return W.slab;
    case "beam": return W.beam;
    case "pile": return W.pile;
    case "stone": return rockMaterial(scene);
    case "log": return solid(scene, "#6a4a2e", 1);
    case "logEnd": return solid(scene, "#c9a36c", 0.9);
    case "char": return solid(scene, "#1c1917", 1);
    case "steel": return solid(scene, "#9aa3aa", 0.4, 0.8);
    case "iron": return solid(scene, "#3d4348", 0.55, 0.7);
    case "cream": return solid(scene, "#eae3cd", 1);
    case "pillow": return solid(scene, "#f6f1e4", 1);
    case "blanket": return solid(scene, "#3f8a96", 1);
    case "rope": return solid(scene, "#b8a470", 1);
    case "soot": return solid(scene, "#0d0b0a", 1);
    case "ash": return solid(scene, "#2a2623", 1);
    case "coal": return solid(scene, "#17120f", 0.9);
    case "clay": return solid(scene, "#b5653a", 0.95);
    case "soil": return solid(scene, "#3a2a1c", 1);
    case "catbed": return solid(scene, "#c4634f", 1);
    case "flameOuter": return flameMaterial(scene, "#ff5a14", 0.8);
    case "flameMid": return flameMaterial(scene, "#ff9a2a", 0.85);
    case "flameIn": return flameMaterial(scene, "#ffe49a", 0.9);
    case "furnaceGlow": return glowMat(scene, "#ff9a3a", 0.9);
    case "glow": return glowCard(scene);
    case "lamp": return glowMat(scene, "#ffc46a");
    case "skirt": return solid(scene, "#7a6850", 1);
    default: return solid(scene, "#ff00ff");
  }
}

const flameMats = new Map<string, StandardMaterial>();
/** additive flame: bright at the root, fading to nothing at the tip */
function flameMaterial(scene: Scene, hex: string, op: number): StandardMaterial {
  let m = flameMats.get(hex);
  if (m) return m;
  m = new StandardMaterial(`flame${hex}`, scene);
  m.disableLighting = true;
  m.emissiveColor = Color3.FromHexString(hex).scale(1.6);
  const t = new DynamicTexture("flameGrad", { width: 4, height: 64 }, scene, false);
  const c = t.getContext();
  const gr = c.createLinearGradient(0, 0, 0, 64);
  gr.addColorStop(0, "rgba(255,255,255,0)");
  gr.addColorStop(0.9, `rgba(255,255,255,${op})`);
  gr.addColorStop(1, `rgba(255,255,255,${op})`);
  c.fillStyle = gr;
  c.fillRect(0, 0, 4, 64);
  t.update();
  t.hasAlpha = true;
  m.opacityTexture = t;
  m.alphaMode = Constants.ALPHA_ADD;
  m.disableDepthWrite = true;
  m.backFaceCulling = false;
  flameMats.set(hex, m);
  return m;
}
let GLOWCARD: StandardMaterial | null = null;
/** the warm pool of light a fire throws on the ground round it */
function glowCard(scene: Scene): StandardMaterial {
  if (GLOWCARD) return GLOWCARD;
  const m = new StandardMaterial("fireGlow", scene);
  m.disableLighting = true;
  m.emissiveColor = Color3.FromHexString("#ff8a2a");
  const t = new DynamicTexture("glowRad", 64, scene, false);
  const c = t.getContext();
  const gr = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,255,255,0.3)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = gr;
  c.fillRect(0, 0, 64, 64);
  t.update();
  t.hasAlpha = true;
  m.opacityTexture = t;
  m.alphaMode = Constants.ALPHA_ADD;
  m.disableDepthWrite = true;
  return (GLOWCARD = m);
}

/** a woven rug: stripes, borders and a few motifs from a seed (its position), so each rug is different but the same for everyone */
function rugMaterial(scene: Scene, seed: number): PBRMaterial {
  let s = (Math.abs(seed) % 2147483646) + 1;
  const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const pals = [["#8a2f2a", "#e8c46a", "#2f4f6a", "#f3e6cc"], ["#2f5a4a", "#e0a050", "#7a2a3a", "#efe4cf"], ["#3a3f7a", "#d8b26a", "#a8432c", "#f2ead8"], ["#6a3a7a", "#e8d2a0", "#2a6a6a", "#f5ecd8"]];
  const P = pals[Math.floor(r() * pals.length)];
  const t = new DynamicTexture("rug", { width: 256, height: 166 }, scene, true);
  const x = t.getContext() as CanvasRenderingContext2D;
  x.fillStyle = P[0]; x.fillRect(0, 0, 256, 166);
  x.fillStyle = P[3]; x.fillRect(10, 10, 236, 146);
  x.fillStyle = P[0]; x.fillRect(18, 18, 220, 130);
  const kind = Math.floor(r() * 3);
  if (kind === 0) for (let i = 0; i < 9; i++) { x.fillStyle = P[1 + (i % 3)]; x.fillRect(28 + i * 23, 26, 11, 114); }
  else if (kind === 1) for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) { x.fillStyle = P[1 + ((i + j) % 3)]; x.beginPath(); const cx = 46 + i * 41, cy = 43 + j * 40; x.moveTo(cx, cy - 16); x.lineTo(cx + 16, cy); x.lineTo(cx, cy + 16); x.lineTo(cx - 16, cy); x.fill(); }
  else { x.fillStyle = P[1]; x.beginPath(); x.ellipse(128, 83, 80, 46, 0, 0, 7); x.fill(); x.fillStyle = P[2]; x.beginPath(); x.ellipse(128, 83, 50, 28, 0, 0, 7); x.fill(); x.fillStyle = P[3]; x.beginPath(); x.ellipse(128, 83, 18, 10, 0, 0, 7); x.fill(); }
  x.fillStyle = P[3];
  for (let i = 0; i < 64; i++) { x.fillRect(i * 4, 0, 2, 5); x.fillRect(i * 4, 161, 2, 5); }
  t.update();
  const m = new PBRMaterial("rugMat", scene);
  m.albedoTexture = t;
  m.roughness = 1;
  m.metallic = 0;
  return m;
}

interface Foot { cols: [number, number, number][]; hits: [number, number, number, number][] }
/** Footprints in local space (x right, z toward the front/foot). Circles are used for walking collision and placement checks. */
const FOOT: Record<PlaceKind, Foot> = {
  campfire: { cols: [[0, 0, 0.45]], hits: [[0, 0.3, 0, 0.8]] },
  furnace: { cols: [[0, 0, 0.62]], hits: [[0, 0.8, 0, 1.0]] },
  workbench: { cols: [[-0.5, 0, 0.42], [0.5, 0, 0.42]], hits: [[-0.5, 0.6, 0, 0.7], [0.5, 0.6, 0, 0.7]] },
  bed: { cols: [[0, -0.5, 0.5], [0, 0.5, 0.5]], hits: [[0, 0.35, -0.5, 0.75], [0, 0.35, 0.5, 0.75]] },
  sleeping_bag: { cols: [], hits: [[0, 0.1, -0.5, 0.7], [0, 0.1, 0.5, 0.7]] },
  box: { cols: [[-0.2, 0, 0.32], [0.2, 0, 0.32]], hits: [[-0.2, 0.3, 0, 0.55], [0.2, 0.3, 0, 0.55]] },
  torch: { cols: [[0, 0, 0.1]], hits: [[0, 0.6, 0, 0.3], [0, 1.15, 0, 0.3]] },
  flower_pot: { cols: [[0, 0, 0.2]], hits: [[0, 0.25, 0, 0.32]] },
  rug: { cols: [], hits: [[-0.5, 0.05, 0, 0.45], [0.5, 0.05, 0, 0.45], [0, 0.05, 0, 0.45]] },
  lantern: { cols: [[0, 0, 0.1]], hits: [[0, 1.5, 0, 0.3]] },
  table: { cols: [[0, 0, 0.42]], hits: [[0, 0.5, 0, 0.5]] },
  cat_bed: { cols: [[0, 0, 0.3]], hits: [[0, 0.12, 0, 0.4]] },
};
/** height of a small table's top */
export const TABLE_TOP = 0.74;
const TABLE_R = 0.44;
/** the small things that can stand on a table top */
const ON_TABLE: PlaceKind[] = ['flower_pot', 'cat_bed', 'lantern'];

export const STRUCT_NAME: Record<PlaceKind, string> = { campfire: 'Campfire', furnace: 'Furnace', workbench: 'Workbench', bed: 'Bed', sleeping_bag: 'Sleeping Bag', box: 'Storage Box', torch: 'Torch', flower_pot: 'Clay Pot', rug: 'Rug', lantern: 'Lantern', table: 'Small Table', cat_bed: 'Cat Bed' };


export interface PlaceAim { ok: boolean; reason: string; x: number; y: number; z: number; yaw: number }

const flameGeo = (() => {
  const pts = [[0.0, 0], [0.14, 0.05], [0.2, 0.2], [0.17, 0.45], [0.09, 0.72], [0.0, 1]].map(([r, y]) => new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(pts, 10);
})();
const glowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const shared = () => S_TOK;
const woodMaterials = () => W_TOK;


function mesh(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, shadows = true) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z); o.castShadow = shadows; o.receiveShadow = shadows;
  return o;
}
const cyl = (r0: number, r1: number, h: number, seg = 8) => new THREE.CylinderGeometry(r0, r1, h, seg);

/** `hook`: lanterns only, how high above the floor they hang from (a ceiling); 0 = on their own hook post */
function buildModel(kind: PlaceKind, shadows: boolean, hook = 0): { group: THREE.Group; flames: THREE.Mesh[]; glow: THREE.Mesh | null } {
  const S = shared(), W = woodMaterials(), g = new THREE.Group();
  const flames: THREE.Mesh[] = [];
  let glow: THREE.Mesh | null = null;
  const add = (...o: THREE.Object3D[]) => o.forEach((x) => g.add(x));

  switch (kind) {
    case 'campfire': {
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2, r = 0.44 + (k % 2) * 0.03;
        const s = mesh(new THREE.IcosahedronGeometry(0.12 + (k % 3) * 0.02, 0), S.stone, Math.cos(a) * r, 0.07, Math.sin(a) * r, shadows);
        s.scale.set(1.1, 0.75, 1); s.rotation.y = a * 3;
        add(s);
      }
      add(mesh(cyl(0.38, 0.4, 0.03, 12), S.char, 0, 0.02, 0, false));
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 + 0.3;
        const log = new THREE.Group();
        const body = mesh(cyl(0.055, 0.065, 0.78, 7), S.log, 0, 0, 0, shadows);
        const end = mesh(cyl(0.05, 0.05, 0.01, 7), S.logEnd, 0, 0.39, 0, false);
        log.add(body, end);
        log.position.set(Math.cos(a) * 0.17, 0.3, Math.sin(a) * 0.17);
        log.rotation.set(Math.sin(a) * 0.62, 0, -Math.cos(a) * 0.62);
        add(log);
      }
      const defs: [THREE.Material, number, number, number][] = [[S.flameOuter, 0.95, 0.6, 0], [S.flameMid, 0.7, 0.45, 1], [S.flameIn, 0.45, 0.32, 2]];
      for (const [m, h, w, k] of defs) {
        const f = new THREE.Mesh(flameGeo, m);
        f.scale.set(w * 1.6, h, w * 1.6); f.position.set((k - 1) * 0.04, 0.12, 0); f.visible = false; f.renderOrder = 5;
        flames.push(f); add(f);
      }
      glow = new THREE.Mesh(glowGeo, S.glow); glow.scale.set(4.2, 1, 4.2); glow.position.y = 0.06; glow.visible = false; glow.renderOrder = 4;
      add(glow);
      break;
    }
    case 'torch': {
      add(mesh(cyl(0.032, 0.045, 1.25, 8), W.beam, 0, 0.6, 0, shadows));
      add(mesh(cyl(0.07, 0.05, 0.16, 9), S.soot, 0, 1.3, 0, false));
      add(mesh(cyl(0.074, 0.074, 0.025, 9), S.rope, 0, 1.25, 0, false));
      add(mesh(cyl(0.05, 0.05, 0.03, 9), S.char, 0, 0.02, 0, false));
      const defs: [THREE.Material, number, number, number][] = [[S.flameOuter, 0.42, 0.26, 0], [S.flameMid, 0.3, 0.19, 1], [S.flameIn, 0.19, 0.12, 2]];
      for (const [m, h, w] of defs) {
        const f = new THREE.Mesh(flameGeo, m);
        f.scale.set(w * 1.6, h, w * 1.6); f.position.set(0, 1.36, 0); f.visible = false; f.renderOrder = 5;
        flames.push(f); add(f);
      }
      glow = new THREE.Mesh(glowGeo, S.glow); glow.scale.set(2.6, 1, 2.6); glow.position.y = 0.06; glow.visible = false; glow.renderOrder = 4;
      add(glow);
      break;
    }
    case 'furnace': {
      add(mesh(cyl(0.52, 0.72, 1.3, 9), S.stone, 0, 0.65, 0, shadows));
      add(mesh(cyl(0.62, 0.66, 0.12, 9), S.stone, 0, 0.06, 0, shadows));
      add(mesh(cyl(0.44, 0.52, 0.14, 9), S.stone, 0, 1.33, 0, shadows));
      add(mesh(cyl(0.21, 0.26, 0.6, 8), S.stone, 0, 1.68, 0, shadows));
      // firebox mouth: a dark back panel set just in front of the brickwork, a stone frame around it, ash and coals on the sill,
      // and an iron door swung open to the left. The fire (three flame cones and a glow card) sits inside the frame.
      add(mesh(new THREE.BoxGeometry(0.5, 0.46, 0.03), S.soot, 0, 0.52, 0.665, false));
      add(mesh(new THREE.BoxGeometry(0.74, 0.1, 0.24), S.stone, 0, 0.81, 0.72, shadows));
      add(mesh(new THREE.BoxGeometry(0.8, 0.09, 0.28), S.stone, 0, 0.255, 0.73, shadows));
      for (const sx of [-1, 1]) add(mesh(new THREE.BoxGeometry(0.11, 0.56, 0.24), S.stone, sx * 0.31, 0.54, 0.72, shadows));
      add(mesh(new THREE.BoxGeometry(0.46, 0.05, 0.2), S.ash, 0, 0.32, 0.725, false));
      for (let k = 0; k < 5; k++) add(mesh(new THREE.IcosahedronGeometry(0.045 + (k % 2) * 0.015, 0), S.coal, -0.17 + k * 0.085, 0.36, 0.72 + ((k * 7) % 3 - 1) * 0.02, false));
      const door = new THREE.Group();
      door.add(mesh(new THREE.BoxGeometry(0.4, 0.5, 0.035), S.iron, 0.2, 0, 0, shadows));
      door.add(mesh(new THREE.BoxGeometry(0.34, 0.04, 0.045), S.steel, 0.2, 0.15, 0, false), mesh(new THREE.BoxGeometry(0.34, 0.04, 0.045), S.steel, 0.2, -0.15, 0, false));
      door.add(mesh(new THREE.BoxGeometry(0.05, 0.14, 0.06), S.steel, 0.34, 0, 0.04, false));
      door.position.set(-0.37, 0.54, 0.82); door.rotation.y = -1.55;
      add(door);
      for (const [m, h, w, k] of [[S.flameOuter, 0.4, 0.3, 0], [S.flameMid, 0.3, 0.22, 1], [S.flameIn, 0.2, 0.14, 2]] as [THREE.Material, number, number, number][]) {
        const f = new THREE.Mesh(flameGeo, m);
        f.scale.set(w * 1.6, h, w * 1.6); f.position.set((k - 1) * 0.05, 0.33, 0.72); f.visible = false; f.renderOrder = 5;
        flames.push(f); add(f);
      }
      const f = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.4), S.furnaceGlow);
      f.position.set(0, 0.52, 0.745); f.visible = false; f.renderOrder = 5; flames.push(f); add(f);
      glow = new THREE.Mesh(glowGeo, S.glow); glow.scale.set(3.2, 1, 3.2); glow.position.set(0, 0.06, 1.1); glow.visible = false; glow.renderOrder = 4;
      add(glow);
      break;
    }
    case 'workbench': {
      add(mesh(new THREE.BoxGeometry(1.6, 0.1, 0.85), W.slab, 0, 0.92, 0, shadows));
      for (const [x, z] of [[-0.68, -0.3], [0.68, -0.3], [-0.68, 0.3], [0.68, 0.3]]) add(mesh(new THREE.BoxGeometry(0.12, 0.88, 0.12), W.beam, x, 0.44, z, shadows));
      add(mesh(new THREE.BoxGeometry(1.4, 0.06, 0.62), W.slab, 0, 0.3, 0, shadows));
      add(mesh(new THREE.BoxGeometry(1.4, 0.1, 0.08), W.beam, 0, 0.8, -0.38, shadows));
      add(mesh(new THREE.BoxGeometry(0.16, 0.16, 0.3), S.iron, 0.72, 1.04, 0.22, shadows));
      add(mesh(new THREE.BoxGeometry(0.1, 0.06, 0.3), S.steel, 0.78, 1.14, 0.22, shadows));
      const h = new THREE.Group();
      h.add(mesh(cyl(0.025, 0.03, 0.34, 6), S.log, 0, 0, 0, shadows), mesh(new THREE.BoxGeometry(0.16, 0.07, 0.07), S.steel, 0, 0.17, 0, shadows));
      h.position.set(-0.4, 1.0, 0.1); h.rotation.set(0, 0.5, Math.PI / 2 - 0.12);
      add(h);
      for (let k = 0; k < 3; k++) add(mesh(new THREE.BoxGeometry(0.55, 0.035, 0.12), W.wall, 0.15 + k * 0.01, 0.99 + k * 0.036, -0.15 + k * 0.01, shadows));
      add(mesh(new THREE.TorusGeometry(0.1, 0.03, 6, 12), S.rope, 0.35, 1.0, 0.18, shadows));
      break;
    }
    case 'bed': {
      for (const [x, z, h] of [[-0.46, -0.94, 0.75], [0.46, -0.94, 0.75], [-0.46, 0.94, 0.45], [0.46, 0.94, 0.45]]) add(mesh(new THREE.BoxGeometry(0.1, h, 0.1), W.beam, x, h / 2, z, shadows));
      for (const s of [-1, 1]) add(mesh(new THREE.BoxGeometry(0.07, 0.14, 1.9), W.beam, s * 0.46, 0.26, 0, shadows));
      add(mesh(new THREE.BoxGeometry(0.98, 0.5, 0.06), W.slab, 0, 0.5, -0.97, shadows));
      add(mesh(new THREE.BoxGeometry(0.98, 0.26, 0.05), W.slab, 0, 0.33, 0.97, shadows));
      add(mesh(new THREE.BoxGeometry(0.88, 0.06, 1.86), W.slab, 0, 0.3, 0, shadows));
      add(mesh(new RoundedBoxGeometry(0.86, 0.18, 1.8, 3, 0.06), S.cream, 0, 0.42, 0, shadows));
      add(mesh(new RoundedBoxGeometry(0.6, 0.13, 0.36, 3, 0.055), S.pillow, 0, 0.56, -0.68, shadows));
      add(mesh(new RoundedBoxGeometry(0.9, 0.1, 0.95, 3, 0.045), S.blanket, 0, 0.55, 0.38, shadows));
      add(mesh(new RoundedBoxGeometry(0.9, 0.12, 0.2, 3, 0.05), S.blanket, 0, 0.56, -0.12, shadows));
      break;
    }
    case 'sleeping_bag': {
      // a woven fibre mat with a quilted roll on top, a pillow and a tied bedroll strap
      add(mesh(new RoundedBoxGeometry(0.86, 0.05, 1.9, 2, 0.02), S.rope, 0, 0.025, 0, shadows));
      add(mesh(new RoundedBoxGeometry(0.78, 0.16, 1.78, 3, 0.07), S.blanket, 0, 0.13, 0.04, shadows));
      for (let i = 0; i < 5; i++) add(mesh(new RoundedBoxGeometry(0.8, 0.03, 0.05, 2, 0.012), S.cream, 0, 0.215, -0.55 + i * 0.32, shadows));
      add(mesh(new RoundedBoxGeometry(0.56, 0.12, 0.34, 3, 0.05), S.pillow, 0, 0.24, -0.72, shadows));
      add(mesh(new THREE.BoxGeometry(0.82, 0.04, 0.07), S.rope, 0, 0.2, 0.62, shadows));
      break;
    }
    case 'flower_pot': {
      // a terracotta pot with a rim and a saucer, full of earth; a flower planted in it is added later (see `potFlower`)
      const clay = S.clay;
      add(mesh(new THREE.LatheGeometry([[0.0, 0], [0.15, 0], [0.16, 0.02], [0.2, 0.3], [0.22, 0.3], [0.23, 0.36], [0.2, 0.36], [0.19, 0.34]].map(([r, y]) => new THREE.Vector2(r, y)), 16), clay, 0, 0.02, 0, shadows));
      add(mesh(cyl(0.21, 0.19, 0.025, 16), clay, 0, 0.012, 0, shadows));
      add(mesh(cyl(0.19, 0.19, 0.02, 14), S.soil, 0, 0.33, 0, false));
      break;
    }
    case 'rug': {
      // the pattern is painted in by `rugPattern` once the rug knows where it lies (so everyone sees the same one)
      const m = mesh(new RoundedBoxGeometry(1.7, 0.02, 1.1, 2, 0.008), S.cream, 0, 0.012, 0, false);
      m.name = 'rug'; m.receiveShadow = shadows; m.userData.keep = true;
      add(m);
      break;
    }
    case 'lantern': {
      // a little iron cage with warm glass, on a chain from the ceiling, or from the hook of its own post
      const top = hook > 0 ? hook : 2.0, ly = top - 0.55;
      if (hook > 0) add(mesh(cyl(0.008, 0.008, top - ly - 0.14, 5), S.iron, 0, (top + ly + 0.14) / 2, 0, false));
      else {
        add(mesh(cyl(0.025, 0.035, 2.0, 8), S.iron, 0, 1.0, 0, shadows));
        add(mesh(new THREE.BoxGeometry(0.42, 0.025, 0.025), S.iron, 0.2, 1.98, 0, false));
        add(mesh(cyl(0.008, 0.008, 0.3, 5), S.iron, 0.38, 1.83, 0, false));
        add(mesh(cyl(0.16, 0.2, 0.05, 10), S.iron, 0, 0.025, 0, shadows));
      }
      const lx = hook > 0 ? 0 : 0.38;
      add(mesh(new THREE.ConeGeometry(0.12, 0.12, 4), S.iron, lx, ly + 0.08, 0, false));
      add(mesh(new THREE.BoxGeometry(0.17, 0.025, 0.17), S.iron, lx, ly - 0.13, 0, false));
      for (const [x, z] of [[-0.075, -0.075], [0.075, -0.075], [-0.075, 0.075], [0.075, 0.075]]) add(mesh(new THREE.BoxGeometry(0.018, 0.22, 0.018), S.iron, lx + x, ly - 0.02, z, false));
      const glass = mesh(new THREE.BoxGeometry(0.13, 0.19, 0.13), S.lamp, lx, ly - 0.02, 0, false);
      add(glass);
      flames.push(glass);
      g.userData.lamp = new THREE.Vector3(lx, ly - 0.02, 0);
      glow = new THREE.Mesh(glowGeo, S.glow); glow.scale.set(2.2, 1, 2.2); glow.position.set(lx, 0.04, 0); glow.visible = false; glow.renderOrder = 4;
      add(glow);
      break;
    }
    case 'table': {
      // a round side table: a planked top with a rim, three turned legs splayed a little, a shelf ring between them
      add(mesh(cyl(TABLE_R, TABLE_R, 0.05, 20), W.slab, 0, TABLE_TOP - 0.025, 0, shadows));
      add(mesh(cyl(TABLE_R - 0.06, TABLE_R - 0.04, 0.07, 18), W.beam, 0, TABLE_TOP - 0.08, 0, shadows));
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + 0.5, r = TABLE_R - 0.14;
        const l = mesh(cyl(0.028, 0.022, TABLE_TOP - 0.06, 7), W.beam, Math.cos(a) * (r + 0.03), (TABLE_TOP - 0.06) / 2, Math.sin(a) * (r + 0.03), shadows);
        l.rotation.set(Math.sin(a) * 0.08, 0, -Math.cos(a) * 0.08);
        add(l);
      }
      add(mesh(new THREE.TorusGeometry(TABLE_R - 0.15, 0.014, 5, 18).rotateX(Math.PI / 2), W.beam, 0, 0.22, 0, false));
      break;
    }
    case 'cat_bed': {
      // a fat round cushion with a soft raised rim, a lighter cushion in the hollow and a little paw print
      const outer = S_TOK.catbed;
      const inner = shared().pillow;
      const rim = mesh(new THREE.TorusGeometry(0.24, 0.075, 8, 20).rotateX(Math.PI / 2), outer, 0, 0.085, 0, shadows); rim.scale.set(1, 1.05, 0.85);
      add(rim);
      const base = mesh(cyl(0.3, 0.29, 0.06, 20), outer, 0, 0.03, 0, shadows); base.scale.z = 0.85; add(base);
      const cush = mesh(new THREE.SphereGeometry(0.22, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2), inner, 0, 0.05, 0, shadows); cush.scale.set(1, 0.28, 0.85); add(cush);
      break;
    }
    case 'box': {
      add(mesh(new THREE.BoxGeometry(0.9, 0.46, 0.6), W.wall, 0, 0.23, 0, shadows));
      add(mesh(new RoundedBoxGeometry(0.96, 0.14, 0.66, 2, 0.04), W.slab, 0, 0.53, 0, shadows));
      for (const x of [-0.3, 0.3]) add(mesh(new THREE.BoxGeometry(0.07, 0.62, 0.68), S.iron, x, 0.31, 0, shadows));
      add(mesh(new THREE.BoxGeometry(0.14, 0.14, 0.05), S.steel, 0, 0.45, 0.33, shadows));
      for (const [x, z] of [[-0.43, -0.27], [0.43, -0.27], [-0.43, 0.27], [0.43, 0.27]]) add(mesh(new THREE.BoxGeometry(0.08, 0.5, 0.08), W.beam, x, 0.25, z, shadows));
      break;
    }
  }
  for (const f of flames) f.userData.keep = true;
  if (glow) glow.userData.keep = true;
  return { group: g, flames, glow };
}

export interface Structure {
  id: number;
  /** network id, same on every client */
  nid: string;
  kind: PlaceKind;
  x: number; y: number; z: number; yaw: number;
  node: TransformNode;
  cols: Collider[];
  hits: { x: number; y: number; z: number; r: number }[];
  /** box: 12 storage slots. stations: slots 0-3 input, 4-7 output */
  inv: Inventory | null;
  fuel: number;
  lit: boolean;
  prog: number;
  flames: { n: TransformNode; base: THREE.Quaternion }[];
  glow: TransformNode | null;
  /** local position of a lantern's lamp */
  lamp: THREE.Vector3 | null;
  phase: number;
  emberT: number;
}

const _e = new THREE.Euler(), _q = new THREE.Quaternion();
/** flame wobble: scale and a small tilt on top of the flame's own orientation */
function poseFlame(f: { n: TransformNode; base: THREE.Quaternion }, sx: number, sy: number, sz: number, rx: number, rz: number) {
  f.n.scaling.set(sx, sy, sz);
  _q.setFromEuler(_e.set(rx, 0, rz)).premultiply(f.base);
  f.n.rotationQuaternion!.set(_q.x, _q.y, _q.z, _q.w);
}

/**
 * Castaway's placeable structures: campfires and furnaces that burn fuel and cook / smelt what is put in them,
 * workbenches, beds and sleeping bags (respawn points), storage boxes, torches, lanterns, pots, rugs, tables
 * and cat beds. Placement rules, footprints and station timing are Castaway's.
 */
export class StructureManager {
  readonly list: Structure[] = [];
  /** A fixed pool of fire lights: the nearest burning sources get one each, with a fade. */
  static POOL = 4;
  readonly lights: PointLight[];
  private lightFor: (Structure | null)[];
  private lightFade: number[];
  readonly heldLight: PointLight;
  private heldFade = 0;
  private ghosts = new Map<PlaceKind, TransformNode>();
  private ghostMat: StandardMaterial;
  private nextId = 1;
  private tmp = { x: 0, z: 0 };
  private time = 0;
  /** nearest lit fire strength 0..1 for audio */
  fireNear = 0;
  onPlace: ((s: Structure) => void) | null = null;
  onRemove: ((s: Structure) => void) | null = null;
  idPrefix = "s";
  onEmber: ((x: number, y: number, z: number) => void) | null = null;
  ground: (x: number, z: number, y?: number) => number = heightAt;
  touchesBuilding: ((x: number, z: number, r: number, y: number) => boolean) | null = null;
  ceilingAt: ((x: number, y: number, z: number) => number | null) | null = null;

  constructor(private readonly scene: Scene, private colliders: ColliderGrid, private shadows: boolean) {
    this.lights = Array.from({ length: StructureManager.POOL }, (_, i) => {
      const l = new PointLight(`fire${i}`, Vector3.Zero(), scene);
      l.diffuse = Color3.FromHexString("#ff9a48");
      l.specular = l.diffuse.scale(0.4);
      l.intensity = 0;
      l.range = 24;
      l.setEnabled(false);
      return l;
    });
    this.lightFor = new Array(StructureManager.POOL).fill(null);
    this.lightFade = new Array(StructureManager.POOL).fill(0);
    this.heldLight = new PointLight("heldTorch", Vector3.Zero(), scene);
    this.heldLight.diffuse = Color3.FromHexString("#ffa858");
    this.heldLight.intensity = 0;
    this.heldLight.range = 16;
    this.heldLight.setEnabled(false);
    this.ghostMat = ghostMaterial(scene, "placeGhost");
    for (const k of Object.keys(FOOT) as PlaceKind[]) {
      const gh = bakeGroup(`ghost_${k}`, buildModel(k, false).group, scene, (key) => matFor(scene, key), false, this.ghostMat).node;
      gh.setEnabled(false);
      this.ghosts.set(k, gh);
    }
  }

  reseat(x0: number, z0: number, x1: number, z1: number, ground: (x: number, z: number, y?: number) => number) {
    for (const s of this.list) {
      if (s.x < x0 || s.x > x1 || s.z < z0 || s.z > z1) continue;
      const g = Math.max(ground(s.x, s.z, s.y + 0.5), ON_TABLE.includes(s.kind) ? this.tableTop(s.x, s.z, s.y + 0.5, s) : -1e9), dy = g - s.y;
      if (Math.abs(dy) < 0.04) continue;
      s.y = g;
      s.node.position.y = g;
      for (const h of s.hits) h.y += dy;
    }
  }

  private checkCircles(kind: PlaceKind, x: number, z: number, yaw: number) {
    const real = this.worldCircles(kind, x, z, yaw);
    if (real.length) return real;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    return [[0, 0, 0.45], [0, -0.7, 0.3], [0, 0.7, 0.3]].map(([lx, lz, r]) => ({ x: x + lx * c + lz * s, z: z - lx * s + lz * c, r }));
  }
  private worldCircles(kind: PlaceKind, x: number, z: number, yaw: number) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    return FOOT[kind].cols.map(([lx, lz, r]) => ({ x: x + lx * c + lz * s, z: z - lx * s + lz * c, r }));
  }

  /** Any structure circle inside this box? (foundations must not swallow a campfire) */
  blockedBox = (x0: number, z0: number, x1: number, z1: number): boolean => {
    for (const s of this.list) for (const c of s.cols) {
      const cx = Math.max(x0, Math.min(c.x, x1)), cz = Math.max(z0, Math.min(c.z, z1));
      if ((c.x - cx) ** 2 + (c.z - cz) ** 2 < (c.r + 0.1) ** 2) return true;
    }
    return false;
  };

  tableTop(x: number, z: number, y = 1e9, except?: Structure): number {
    let best = -1e9;
    for (const t of this.list) {
      if (t.kind !== "table" || t === except) continue;
      if ((x - t.x) ** 2 + (z - t.z) ** 2 > (TABLE_R + 0.02) ** 2) continue;
      const h = t.y + TABLE_TOP;
      if (h <= y + 0.9 && h > best) best = h;
    }
    return best;
  }
  onTable(t: Structure) { return this.list.filter((s) => s !== t && ON_TABLE.includes(s.kind) && Math.hypot(s.x - t.x, s.z - t.z) < TABLE_R && Math.abs(s.y - (t.y + TABLE_TOP)) < 0.06); }

  updateGhost(kind: PlaceKind, eye: Vector3, dir: Vector3, yaw: number): PlaceAim {
    const small = ON_TABLE.includes(kind);
    const gnd = small ? (x: number, z: number, y?: number) => Math.max(this.ground(x, z, y), this.tableTop(x, z, y)) : this.ground;
    const r = rayGround(eye, dir, 6.5, gnd);
    if (small && r.hit) for (const t of this.list) {
      if (t.kind === "table" && Math.hypot(r.x - t.x, r.z - t.z) < TABLE_R && Math.abs(r.y - (t.y + TABLE_TOP)) < 0.1) { r.x = t.x; r.z = t.z; break; }
    }
    const circles = this.checkCircles(kind, r.x, r.z, yaw);
    const ref = r.y + 0.5;
    let hMax = -1e9, hMin = 1e9;
    for (const c of circles) {
      for (const [dx, dz] of [[0, 0], [c.r, 0], [-c.r, 0], [0, c.r], [0, -c.r]]) {
        const h = gnd(c.x + dx, c.z + dz, ref);
        hMax = Math.max(hMax, h);
        hMin = Math.min(hMin, h);
      }
    }
    const top = small ? this.tableTop(r.x, r.z, ref) : -1e9, onTop = top > -1e8 && Math.abs(hMax - top) < 0.03;
    const a: PlaceAim = { ok: true, reason: "", x: r.x, y: onTop ? top : hMax - 0.02, z: r.z, yaw };
    if (!r.hit) { a.ok = false; a.reason = "Too far away"; }
    else if (hMin < 0.12) { a.ok = false; a.reason = "Can’t build in the water"; }
    else if (hMax - hMin > 0.5) { a.ok = false; a.reason = "Ground is too uneven"; }
    else if (onTop) {
      for (const c of circles) for (const s of this.list) {
        if (s.kind === "table" || !ON_TABLE.includes(s.kind) || Math.abs(s.y - top) > 0.1) continue;
        for (const o of s.cols) if (Math.hypot(o.x - c.x, o.z - c.z) < o.r + c.r) { a.ok = false; a.reason = "Something is in the way"; }
      }
    } else {
      for (const c of circles) {
        this.colliders.resolve(c.x, c.z, c.r + 0.05, this.tmp);
        if (Math.abs(this.tmp.x - c.x) + Math.abs(this.tmp.z - c.z) > 1e-4) { a.ok = false; a.reason = "Something is in the way"; break; }
        if (this.touchesBuilding?.(c.x, c.z, c.r + 0.05, hMax)) { a.ok = false; a.reason = "Something is in the way"; break; }
        for (const s of this.list) for (const o of s.cols) if (Math.hypot(o.x - c.x, o.z - c.z) < o.r + c.r) { a.ok = false; a.reason = "Something is in the way"; }
        if (!a.ok) break;
      }
    }
    for (const [k, g] of this.ghosts) g.setEnabled(k === kind);
    const g = this.ghosts.get(kind)!;
    g.position.set(a.x, a.y, a.z);
    g.rotation.y = yaw;
    setGhostOk(this.ghostMat, a.ok);
    return a;
  }

  hideGhost() { for (const g of this.ghosts.values()) g.setEnabled(false); }

  place(kind: PlaceKind, a: PlaceAim, nid?: string, silent = false): Structure | null {
    if (!a.ok) return null;
    let hook = 0;
    if (kind === "lantern") {
      const c = this.ceilingAt?.(a.x, a.y, a.z);
      if (c !== null && c !== undefined && c - a.y > 1.7 && c - a.y < 4.2) hook = c - a.y;
    }
    const m = buildModel(kind, this.shadows, hook);
    // a packed-earth plinth under the footprint hides any gap where the ground falls away
    const onTop = ON_TABLE.includes(kind) && Math.abs(this.tableTop(a.x, a.z, a.y + 0.1) - a.y) < 0.05;
    for (const [lx, lz, r] of onTop ? [] : FOOT[kind].cols) {
      const gx = a.x + lx * Math.cos(a.yaw) + lz * Math.sin(a.yaw), gz = a.z - lx * Math.sin(a.yaw) + lz * Math.cos(a.yaw);
      let low = a.y;
      for (let k = 0; k < 8; k++) low = Math.min(low, this.ground(gx + Math.cos(k * 0.785) * (r + 0.1), gz + Math.sin(k * 0.785) * (r + 0.1), a.y + 0.5));
      const depth = Math.max(0.12, a.y - low + 0.15);
      const sk = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.98, r * 1.12, depth, 10), tok("skirt"));
      sk.position.set(lx, -depth / 2 + 0.005, lz);
      m.group.add(sk);
    }
    const baked = bakeGroup(`struct_${kind}`, m.group, this.scene, (key) => matFor(this.scene, key), this.shadows);
    const node = baked.node;
    node.position.set(a.x, a.y, a.z);
    node.rotation.y = a.yaw;
    const flames = m.flames.map((f) => {
      const n = baked.kept.get(f)!;
      n.setEnabled(false);
      const q = n.rotationQuaternion!;
      return { n, base: new THREE.Quaternion(q.x, q.y, q.z, q.w) };
    });
    const glow = m.glow ? baked.kept.get(m.glow) ?? null : null;
    glow?.setEnabled(false);
    if (kind === "rug") {
      const rugNode = [...baked.kept.values()][0];
      const rm = rugMaterial(this.scene, Math.round(a.x * 97) * 31 + Math.round(a.z * 89) * 17);
      for (const c of rugNode.getChildMeshes()) c.material = rm;
    }
    const cols: Collider[] = this.worldCircles(kind, a.x, a.z, a.yaw).map((c) => ({ x: c.x, z: c.z, r: c.r }));
    if (!onTop) cols.forEach((c) => this.colliders.add(c));
    const cs = Math.cos(a.yaw), sn = Math.sin(a.yaw);
    const hits = FOOT[kind].hits.map(([lx, ly, lz, r]) => ({ x: a.x + lx * cs + lz * sn, y: a.y + ly, z: a.z - lx * sn + lz * cs, r }));
    let inv: Inventory | null = null;
    if (kind === "box") inv = new Inventory(12, 0);
    else if (kind === "flower_pot") { inv = new Inventory(1, 0); inv.accepts = (_slot, id) => ITEMS[id]?.flower !== undefined; }
    else if (kind === "campfire" || kind === "furnace") {
      inv = new Inventory(8, 0);
      const rec = STATION_RECIPES[kind];
      inv.accepts = (slot, id) => slot < 4 && rec.some((r) => r.from === id);
    }
    const lamp = (m.group.userData.lamp as THREE.Vector3 | undefined) ?? null;
    const s: Structure = {
      id: this.nextId++, nid: nid ?? `${this.idPrefix}${this.nextId}`, kind, x: a.x, y: a.y, z: a.z, yaw: a.yaw, node, cols, hits, inv,
      // a new campfire is built with a few logs already burning
      fuel: kind === "campfire" ? 3 * WOOD_BURN.campfire : 0, lit: kind === "torch" || kind === "lantern" || kind === "campfire", prog: 0, flames, glow, lamp, phase: Math.random() * 10, emberT: 0,
    };
    if (kind === "lantern" && lamp) {
      hits.length = 0;
      hits.push({ x: a.x + lamp.x * cs, y: a.y + lamp.y, z: a.z - lamp.x * sn, r: 0.3 });
    }
    this.list.push(s);
    if (!silent) this.onPlace?.(s);
    return s;
  }

  remove(s: Structure, silent = false) {
    const i = this.list.indexOf(s);
    if (i < 0) return;
    if (!silent) this.onRemove?.(s);
    const above = s.kind === "table" ? this.onTable(s) : [];
    this.list.splice(i, 1);
    s.cols.forEach((c) => this.colliders.remove(c));
    if (above.length) this.reseat(s.x - 1, s.z - 1, s.x + 1, s.z + 1, this.ground);
    for (let k = 0; k < this.lightFor.length; k++) if (this.lightFor[k] === s) this.lightFor[k] = null;
    disposeBaked(s.node);
  }

  findTarget(eye: Vector3, dir: Vector3, reach: number, assist = 1): { s: Structure; dist: number } | null {
    let best: { s: Structure; dist: number } | null = null;
    for (const s of this.list) {
      if ((s.x - eye.x) ** 2 + (s.z - eye.z) ** 2 > (reach + 2.5) ** 2) continue;
      for (const h of s.hits) {
        const t = raySphere(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, h.x, h.y, h.z, h.r * assist);
        if (t >= 0 && t < reach && (!best || t < best.dist)) best = { s, dist: t };
      }
    }
    return best;
  }

  nearBench(x: number, y: number, z: number, reach: number): boolean {
    for (const s of this.list) if (s.kind === "workbench" && Math.hypot(s.x - x, s.z - z) < reach && Math.abs(s.y - y) < 3) return true;
    return false;
  }

  addFuel(s: Structure, woodCount: number) {
    if (s.kind !== "campfire" && s.kind !== "furnace") return;
    s.fuel = Math.min(MAX_FUEL, s.fuel + woodCount * WOOD_BURN[s.kind]);
  }

  private hasWork(s: Structure): { from: number; time: number; to: ItemId } | null {
    if (!s.inv || (s.kind !== "campfire" && s.kind !== "furnace")) return null;
    const rec = STATION_RECIPES[s.kind];
    for (let i = 0; i < 4; i++) {
      const it = s.inv.slots[i];
      if (!it) continue;
      const r = rec.find((q) => q.from === it.id);
      if (!r) continue;
      const room = s.inv.slots.slice(4).some((o) => !o || (o.id === r.to && o.count < 1000));
      if (room) return { from: i, time: r.time, to: r.to };
    }
    return null;
  }

  /** a clay pot shows the flower planted in it (its one slot) */
  private potFlower(s: Structure) {
    const it = s.inv?.slots[0], k = it ? ITEMS[it.id]?.flower ?? -1 : -1;
    const md = (s.node.metadata ??= {}) as { flowerK?: number };
    if (md.flowerK === k) return;
    md.flowerK = k;
    s.node.getChildMeshes(true).filter((m) => m.name === "potflower").forEach((m) => m.dispose(false, false));
    if (k < 0) return;
    const g = flowerGeometry(k).clone(), sc = Math.min(1.5, 0.55 / Math.max(0.25, FLOWERS[k].h));
    g.scale(sc, sc, sc);
    const m = meshFromThree("potflower", g, this.scene);
    m.material = foliageMaterial(this.scene, "potFlower", 0.0001);
    m.parent = s.node;
    m.position.y = 0.33;
    m.isPickable = false;
  }

  update(dt: number, px: number, _py: number, pz: number) {
    this.time += dt;
    const t = this.time;
    const cands: { s: Structure; d: number }[] = [];
    this.fireNear = 0;
    for (const s of this.list) {
      if (s.kind === "flower_pot") { this.potFlower(s); continue; }
      if (s.kind === "lantern") {
        const d = Math.hypot(s.x - px, s.z - pz);
        s.glow?.setEnabled(d < 60);
        if (d < 34) cands.push({ s, d });
        continue;
      }
      if (s.kind === "torch") {
        const d = Math.hypot(s.x - px, s.z - pz), show = d < 90;
        s.flames.forEach((f, k) => {
          f.n.setEnabled(show);
          if (!show) return;
          const base = [[0.42, 0.26], [0.3, 0.19], [0.19, 0.12]][k];
          const w = t * (10 + k * 3) + s.phase + k * 2, fl = 1 + 0.16 * Math.sin(w) + 0.09 * Math.sin(w * 2.3 + 1);
          poseFlame(f, base[1] * 1.6 * (1 - 0.06 * Math.sin(w * 1.7)), base[0] * fl, base[1] * 1.6 * (1 + 0.06 * Math.sin(w * 1.3)), Math.cos(w * 0.9) * 0.08, Math.sin(w * 0.7) * 0.08);
        });
        if (s.glow) { s.glow.setEnabled(show); if (show) s.glow.scaling.set(2.6 * (1 + 0.06 * Math.sin(t * 9 + s.phase)), 1, 2.6 * (1 + 0.06 * Math.sin(t * 9 + s.phase))); }
        if (d < 16) {
          s.emberT -= dt;
          if (s.emberT <= 0) { s.emberT = 0.6 + Math.random() * 0.8; this.onEmber?.(s.x + (Math.random() - 0.5) * 0.15, s.y + 1.5, s.z + (Math.random() - 0.5) * 0.15); }
          this.fireNear = Math.max(this.fireNear, Math.max(0, 0.35 - d / 40));
        }
        if (d < 34) cands.push({ s, d });
        continue;
      }
      if (s.kind !== "campfire" && s.kind !== "furnace") continue;
      const work = this.hasWork(s);
      s.lit = s.fuel > 0;
      if (s.lit) {
        s.fuel = Math.max(0, s.fuel - dt * (s.kind === "furnace" && !work ? 0.4 : 1));
        if (work) {
          s.prog += dt;
          if (s.prog >= work.time) {
            s.prog = 0;
            const it = s.inv!.slots[work.from]!;
            if (s.inv!.addRange(work.to, 1, 4, 8, true) === 0) {
              it.count -= 1;
              if (it.count <= 0) s.inv!.slots[work.from] = null;
              s.inv!.emit();
            }
          }
        } else s.prog = 0;
      } else if (!work) s.prog = 0;

      const d = Math.hypot(s.x - px, s.z - pz);
      const show = s.lit && d < 90;
      s.flames.forEach((f, k) => {
        f.n.setEnabled(show);
        if (!show) return;
        if (s.kind === "campfire") {
          const base = [[0.95, 0.6], [0.7, 0.45], [0.45, 0.32]][k];
          const w = t * (9 + k * 3) + s.phase + k * 2;
          const fl = 1 + 0.18 * Math.sin(w) + 0.1 * Math.sin(w * 2.3 + 1);
          poseFlame(f, base[1] * 1.6 * (1 - 0.06 * Math.sin(w * 1.7)), base[0] * fl, base[1] * 1.6 * (1 + 0.06 * Math.sin(w * 1.3)), Math.cos(w * 0.9) * 0.07, Math.sin(w * 0.7) * 0.07);
        } else if (k < 3) {
          const base = [[0.4, 0.3], [0.3, 0.22], [0.2, 0.14]][k];
          const w = t * (11 + k * 3) + s.phase + k * 2, fl = 1 + 0.2 * Math.sin(w) + 0.1 * Math.sin(w * 2.3 + 1);
          poseFlame(f, base[1] * 1.6 * (1 - 0.07 * Math.sin(w * 1.7)), base[0] * fl, base[1] * 1.6 * (1 + 0.07 * Math.sin(w * 1.3)), 0, Math.sin(w * 0.7) * 0.08);
        } else f.n.scaling.setAll(1 + 0.08 * Math.sin(t * 11 + s.phase));
      });
      if (s.glow) {
        s.glow.setEnabled(show);
        const k = (s.kind === "campfire" ? 4.2 : 2.6) * (1 + 0.05 * Math.sin(t * 8 + s.phase));
        if (show) s.glow.scaling.set(k, 1, k);
      }
      if (s.lit && d < 22) {
        s.emberT -= dt;
        if (s.emberT <= 0) { s.emberT = 0.25 + Math.random() * 0.35; this.onEmber?.(s.x + (Math.random() - 0.5) * 0.3, s.y + (s.kind === "furnace" ? 1.9 : 0.5), s.z + (Math.random() - 0.5) * 0.3); }
        this.fireNear = Math.max(this.fireNear, Math.max(0, 1 - d / 18));
      }
      if (s.lit && d < 44) cands.push({ s, d });
    }

    // pooled lights: keep a source's light while it stays among the nearest, give free lights to newcomers
    cands.sort((p, q) => p.d - q.d);
    const top = cands.slice(0, StructureManager.POOL).map((c) => c.s);
    const used = new Set<Structure>();
    for (let i = 0; i < this.lights.length; i++) {
      const cur = this.lightFor[i];
      if (cur && top.includes(cur)) used.add(cur);
      else if (cur && this.lightFade[i] < 0.05) this.lightFor[i] = null;
    }
    for (const n of top) {
      if (used.has(n)) continue;
      const i = this.lightFor.findIndex((c, k) => !c || (!top.includes(c) && this.lightFade[k] < 0.05));
      if (i >= 0) { this.lightFor[i] = n; this.lightFade[i] = 0; used.add(n); }
    }
    for (let i = 0; i < this.lights.length; i++) {
      const n = this.lightFor[i], L = this.lights[i];
      let target = 0;
      if (n && top.includes(n)) {
        if (n.kind === "furnace") L.position.set(n.x + Math.sin(n.yaw) * 1.0, n.y + 0.6, n.z + Math.cos(n.yaw) * 1.0);
        else if (n.kind === "lantern") { const h = n.hits[0]; L.position.set(h.x, h.y, h.z); }
        else L.position.set(n.x, n.y + (n.kind === "torch" ? 1.45 : 0.9), n.z);
        const fl = 0.85 + 0.15 * Math.sin(t * 13 + n.phase) + 0.08 * Math.sin(t * 31.7 + n.phase);
        target = (n.kind === "furnace" ? 4 : n.kind === "torch" ? 6 : n.kind === "lantern" ? 4 : 9) * fl;
        L.range = n.kind === "campfire" ? 40 : n.kind === "torch" ? 30 : n.kind === "lantern" ? 22 : 24;
      }
      this.lightFade[i] += (target - this.lightFade[i]) * Math.min(1, dt * 6);
      L.intensity = this.lightFade[i];
      L.setEnabled(this.lightFade[i] > 0.01);
    }
  }

  /** The torch in your hand. */
  setHeldLight(on: boolean, at: Vector3, dt: number, k = 1) {
    this.heldLight.position.copyFrom(at);
    const target = on ? 6 * k * (0.86 + 0.14 * Math.sin(this.time * 12.7) + 0.07 * Math.sin(this.time * 31.1)) : 0;
    this.heldFade += (target - this.heldFade) * Math.min(1, dt * 8);
    this.heldLight.intensity = this.heldFade;
    this.heldLight.setEnabled(this.heldFade > 0.01);
  }
}
