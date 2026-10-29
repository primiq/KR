// The gorilla (the banana answer): a vertex-coloured model built with the Mesher, knuckle-walking, with a chest-beat emote.
// The same model is the remote avatar and the mirror image; first-person desktop players see two big hands; VR players get
// big gorilla hands on the controllers.
import * as THREE from 'three';
import { Mesher } from '../net/playerModel';

const FUR = '#2c2623', FUR2 = '#3b332d', SKIN = '#4a423d', SKIN2 = '#5c524b', SILVER = '#8e8a85', EYE = '#e2c46a';

function part(build: (M: Mesher) => void, shadows: boolean) { const M = new Mesher(); build(M); return M.build(shadows); }

export interface GorillaRig {
  root: THREE.Group; hips: THREE.Group; torso: THREE.Group; head: THREE.Group;
  arms: THREE.Group[]; elbows: THREE.Group[]; legs: THREE.Group[]; knees: THREE.Group[];
}

/** faces +z, feet at y = 0, about 1.9 m tall when it stands up straight */
export function buildGorilla(shadows: boolean): GorillaRig {
  const root = new THREE.Group();
  const hips = new THREE.Group(); hips.position.y = 0.8; root.add(hips);
  const torso = new THREE.Group(); hips.add(torso);
  torso.add(part((M) => {
    M.sph(0.44, FUR, 0, 0.42, -0.02, 1.2, 1.1, 0.95, 12);                    // the barrel chest
    M.sph(0.3, SKIN2, 0, 0.42, 0.24, 1.15, 1.2, 0.6, 10);                     // bare chest
    M.sph(0.36, SILVER, 0, 0.3, -0.18, 1.05, 0.8, 0.8, 10);                    // silverback saddle
    M.sph(0.34, FUR2, 0, 0.0, 0.0, 1.05, 0.8, 0.95, 10);                       // belly / hips
    M.sph(0.2, FUR, -0.42, 0.68, 0, 1.1, 0.9, 1, 8); M.sph(0.2, FUR, 0.42, 0.68, 0, 1.1, 0.9, 1, 8);    // shoulders
  }, shadows));
  const head = new THREE.Group(); head.position.set(0, 0.86, 0.14); torso.add(head);
  head.add(part((M) => {
    M.sph(0.22, FUR, 0, 0.06, -0.02, 1.0, 1.05, 1.0, 12);
    M.sph(0.1, FUR, 0, 0.24, -0.06, 1.3, 1.2, 1.4, 8);                         // the crest
    M.sph(0.15, SKIN, 0, 0.0, 0.13, 1.25, 0.9, 0.85, 10);                      // face
    M.box(0.34, 0.07, 0.12, SKIN, 0, 0.1, 0.17);                                // brow ridge
    M.sph(0.12, SKIN2, 0, -0.07, 0.22, 1.3, 0.85, 0.75, 10);                   // muzzle
    M.sph(0.028, '#141010', -0.045, -0.04, 0.31); M.sph(0.028, '#141010', 0.045, -0.04, 0.31);  // nostrils
    M.sph(0.032, EYE, -0.075, 0.05, 0.24); M.sph(0.032, EYE, 0.075, 0.05, 0.24);
    M.sph(0.017, '#120c08', -0.075, 0.05, 0.27); M.sph(0.017, '#120c08', 0.075, 0.05, 0.27);
    M.box(0.12, 0.022, 0.03, '#2a1f1b', 0, -0.13, 0.27);                        // mouth
    M.sph(0.05, SKIN, -0.21, 0.04, 0.0, 0.5, 1, 1, 8); M.sph(0.05, SKIN, 0.21, 0.04, 0.0, 0.5, 1, 1, 8);   // ears
  }, shadows));
  const arms: THREE.Group[] = [], elbows: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const a = new THREE.Group(); a.position.set(s * 0.46, 0.68, 0.02); torso.add(a);
    a.add(part((M) => { M.cyl(0.13, 0.11, 0.56, FUR, 0, -0.28, 0, 1, 1, 9); M.sph(0.12, FUR2, 0, -0.06, 0, 1.2, 1, 1.1, 8); }, shadows));
    const e = new THREE.Group(); e.position.y = -0.56; a.add(e);
    e.add(part((M) => {
      M.cyl(0.11, 0.09, 0.52, FUR2, 0, -0.26, 0, 1, 1, 9);
      M.box(0.2, 0.14, 0.22, SKIN, 0, -0.58, 0.02);                             // the big hand (knuckles down)
      for (let f = 0; f < 4; f++) M.box(0.045, 0.1, 0.06, SKIN, (f - 1.5) * 0.048, -0.67, 0.1);
      M.box(0.05, 0.08, 0.05, SKIN, s * 0.11, -0.56, 0.08);
    }, shadows));
    arms.push(a); elbows.push(e);
  }
  const legs: THREE.Group[] = [], knees: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const l = new THREE.Group(); l.position.set(s * 0.22, -0.05, 0); hips.add(l);
    l.add(part((M) => M.cyl(0.14, 0.12, 0.42, FUR, 0, -0.21, 0, 1, 1, 9), shadows));
    const k = new THREE.Group(); k.position.y = -0.42; l.add(k);
    k.add(part((M) => { M.cyl(0.11, 0.1, 0.32, FUR2, 0, -0.16, 0, 1, 1, 9); M.box(0.17, 0.08, 0.3, SKIN, 0, -0.34, 0.06); }, shadows));
    legs.push(l); knees.push(k);
  }
  return { root, hips, torso, head, arms, elbows, legs, knees };
}

/** animates a gorilla rig: knuckle-walk, jump, and the chest beat (beat = seconds since it started, or > 2 when not beating) */
export class GorillaAnim {
  private phase = 0; private t = Math.random() * 10; private air = 0;
  constructor(readonly g: GorillaRig) {}
  update(dt: number, spd: number, vy: number, pitch: number, beat: number) {
    const g = this.g; this.t += dt;
    const sw = Math.min(1, spd / 2.5), run = spd > 4;
    this.phase += spd * dt * (run ? 2.6 : 3.4);
    this.air += ((Math.abs(vy) > 1.2 ? 1 : 0) - this.air) * Math.min(1, dt * 10);
    const beating = beat < 1.6 ? Math.sin(Math.min(1, beat / 0.25) * Math.PI / 2) * Math.min(1, (1.6 - beat) / 0.3) : 0;
    const lean = 0.5 * (1 - beating) * (1 - this.air * 0.4);
    g.torso.rotation.x = lean;
    g.hips.position.y = 0.8 + Math.abs(Math.sin(this.phase)) * 0.04 * sw + beating * 0.08;
    g.head.rotation.x = -lean * 0.8 - pitch * 0.5;
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 1 : -1;
      const walk = Math.sin(this.phase + (i ? Math.PI : 0)) * 0.55 * sw;
      // knuckle-walking: arms reach down to the ground ahead (counter the torso lean)
      let ax = -lean - 0.12 + walk, ex = -0.1;
      if (this.air > 0.1) { ax = ax * (1 - this.air) - 1.2 * this.air; ex = -0.6 * this.air; }
      if (beating > 0) {
        const hit = Math.max(0, Math.sin(beat * 22 + i * Math.PI));               // alternate fists on the chest
        ax = ax * (1 - beating) + (-1.25 - hit * 0.25) * beating; ex = ex * (1 - beating) + (-1.6 + hit * 0.35) * beating;
        g.arms[i].rotation.z = s * 0.35 * beating;
      } else g.arms[i].rotation.z = s * 0.08;
      g.arms[i].rotation.x = ax; g.elbows[i].rotation.x = ex;
      const leg = -Math.sin(this.phase + (i ? 0 : Math.PI)) * 0.5 * sw;
      g.legs[i].rotation.x = leg - 0.25 - this.air * 0.5; g.knees[i].rotation.x = 0.35 + Math.max(0, -leg) * 0.6 + this.air * 0.6;
    }
    g.torso.rotation.z = Math.sin(this.phase) * 0.05 * sw + Math.sin(this.t * 1.3) * 0.01;
  }
}

/** the remote / mirror avatar */
export class GorillaBody {
  readonly root = new THREE.Group();
  private anim: GorillaAnim;
  private beat = 9;
  constructor(shadows: boolean) {
    const g = buildGorilla(shadows);
    g.root.rotation.y = Math.PI;                 // the model faces +z, a player's yaw 0 faces -z
    this.root.add(g.root);
    this.anim = new GorillaAnim(g);
  }
  thump() { this.beat = 0; }
  update(dt: number, spd: number, vy: number, pitch: number) { this.beat += dt; this.anim.update(dt, spd, vy, pitch, this.beat); }
}

/** first person (desktop / phone): two big hands at the bottom of the view */
export class FPGorilla {
  readonly root = new THREE.Group();
  private hands: THREE.Object3D[] = [];
  private t = 0; private beat = 9; private walk = 0;
  constructor() {
    for (const s of [-1, 1]) {
      const h = part((M) => {
        M.cyl(0.06, 0.075, 0.34, FUR, 0, -0.16, 0.1, 1, 1, 10, 0.5);
        M.sph(0.075, SKIN, 0, 0.02, -0.03, 1.15, 0.85, 1.1, 10);
        for (let f = 0; f < 4; f++) M.sph(0.026, SKIN2, (f - 1.5) * 0.034, 0.0, -0.105, 1, 1.1, 1, 6);
        M.sph(0.03, SKIN2, -s * 0.075, 0.035, -0.06, 1, 1, 1.3, 6);
      }, false);
      // its own material: the shared body material must keep its depth test (every player model uses it)
      const mat = (h.material as THREE.Material).clone(); mat.depthTest = false; h.material = mat;
      h.renderOrder = 1010;
      const g = new THREE.Group(); g.add(h); g.position.set(s * 0.24, -0.27, -0.42); this.root.add(g); this.hands.push(g);
    }
    this.root.visible = false;
  }
  thump() { this.beat = 0; }
  update(dt: number, spd: number) {
    this.t += dt; this.beat += dt; this.walk += spd * dt * 3.2;
    const b = this.beat < 1.4 ? 1 : 0;
    this.hands.forEach((h, i) => {
      const s = i ? 1 : -1, sw = Math.sin(this.walk + i * Math.PI) * Math.min(1, spd / 3);
      const hit = b ? Math.max(0, Math.sin(this.beat * 22 + i * Math.PI)) : 0;
      h.position.set(s * (0.24 - hit * 0.1), -0.27 + sw * 0.03 + hit * 0.06 + Math.sin(this.t * 1.7) * 0.004, -0.42 + sw * 0.04);
      h.rotation.set(-0.2 + hit * 0.4, 0, s * hit * 0.4);
    });
  }
}

/** a VR controller's hand when you are the gorilla */
export function buildGorillaHand(left: boolean) {
  const g = part((M) => {
    M.box(0.1, 0.05, 0.12, SKIN, 0, 0, 0.0);
    for (let f = 0; f < 4; f++) M.box(0.022, 0.03, 0.07, SKIN2, (f - 1.5) * 0.025, -0.005, -0.085);
    M.box(0.026, 0.028, 0.05, SKIN2, (left ? 1 : -1) * 0.06, -0.005, -0.03, 0, left ? 0.5 : -0.5, 0);
    M.cyl(0.055, 0.06, 0.1, FUR, 0, 0.0, 0.1, 1, 1, 9, Math.PI / 2);
  }, false);
  g.renderOrder = 1011;
  return g;
}
