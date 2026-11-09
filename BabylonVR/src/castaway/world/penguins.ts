// Penguins: the Arctic's colonies along its southern shore (arctic.ts COLONIES). In each, a few tight huddles that slowly
// shuffle and turn (whoever is on the outside edges in), with fluffy grey chicks among the grown-ups, and a few walkers
// waddling from one huddle to another. They are friendly: come close and they stop, turn to look up at you, flap their
// flippers and chirp; they step aside rather than be trodden on. Cosmetic and local to each player.
// Cheap to draw: every penguin is made of a few instanced parts (a draw each, whatever the count); only matrices change.
import * as THREE from "three";
import { type Colony, coloniesNear } from "./arctic";
import { heightAt } from "./island";

const NEAR = 450, SLOTS = 3, PER = 22;

interface Pen {
  x: number; z: number; yaw: number; s: number; chick: boolean;
  /** which huddle it belongs to now, its place in it (angle, ring), or walking to another */
  colony: number; hud: number; a: number; ring: number; walking: boolean; tx: number; tz: number;
  ph: number; step: number; flap: number; look: number; wait: number;
  /** in a colony near you just now (the colonies all along the coast take turns with the same penguins) */
  on: boolean;
}

/** merge geometries (positions and normals) into one */
function merge(gs: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  let base = 0;
  for (const g of gs) {
    const p = g.getAttribute("position"), n = g.getAttribute("normal");
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(n.getX(i), n.getY(i), n.getZ(i)); }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + base); else for (let i = 0; i < p.count; i++) idx.push(i + base);
    base += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); out.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3)); out.setIndex(idx);
  return out;
}
const egg = (rx: number, ry: number, rz: number, x: number, y: number, z: number, seg = 12) => new THREE.SphereGeometry(1, seg, Math.round(seg * 0.75)).scale(rx, ry, rz).translate(x, y, z);

export class Penguins {
  readonly group = new THREE.Group();
  private pens: Pen[] = [];
  private huddles: { x: number; z: number; spin: number }[][] = [];
  /** which colony each set of penguins is in (null: none) */
  private slots: (Colony | null)[] = [];
  private near: Colony[] = [];
  private assignT = 0;
  private parts: THREE.InstancedMesh[];
  private dark: THREE.InstancedMesh;
  private t = 0;
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler(0, 0, 0, "YXZ");
  private base = new THREE.Matrix4(); private loc = new THREE.Matrix4(); private p = new THREE.Vector3(); private sc = new THREE.Vector3();
  /** a chirp at (x, z), loudness 0..1 */
  chirp: ((x: number, z: number, v: number) => void) | null = null;
  private chirpT = 0;

  constructor(scene: THREE.Object3D) {
    // a plump little penguin about 0.75 m tall, facing -z: a black back and head, a white belly and face, an orange
    // beak, a golden patch on its chest, big shiny eyes; flippers and feet move on their own
    const black = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.55 });
    const white = new THREE.MeshStandardMaterial({ color: "#f7f5ef", roughness: 0.75 });
    const orange = new THREE.MeshStandardMaterial({ color: "#f29a2e", roughness: 0.6 });
    const gold = new THREE.MeshStandardMaterial({ color: "#ffd25a", roughness: 0.7 });
    const eye = new THREE.MeshStandardMaterial({ color: "#0b0b10", roughness: 0.15 });
    const shine = new THREE.MeshBasicMaterial({ color: "#ffffff" });
    const darkG = merge([egg(0.21, 0.3, 0.2, 0, 0.32, 0.02), egg(0.15, 0.14, 0.15, 0, 0.66, 0)]);
    const whiteG = merge([egg(0.165, 0.25, 0.1, 0, 0.3, -0.1), egg(0.06, 0.055, 0.05, -0.06, 0.67, -0.11), egg(0.06, 0.055, 0.05, 0.06, 0.67, -0.11)]);
    const beakG = new THREE.ConeGeometry(0.035, 0.11, 8).rotateX(-Math.PI / 2).translate(0, 0.63, -0.18);
    const goldG = merge([egg(0.09, 0.05, 0.04, -0.08, 0.53, -0.13), egg(0.09, 0.05, 0.04, 0.08, 0.53, -0.13)]);
    const eyeG = merge([egg(0.027, 0.03, 0.02, -0.06, 0.68, -0.145, 8), egg(0.027, 0.03, 0.02, 0.06, 0.68, -0.145, 8)]);
    const shineG = merge([egg(0.009, 0.009, 0.006, -0.052, 0.69, -0.163, 5), egg(0.009, 0.009, 0.006, 0.068, 0.69, -0.163, 5)]);
    // a flipper hangs from the shoulder (its pivot at the origin); a foot is a flat orange paddle
    const flipG = egg(0.025, 0.17, 0.07, 0, -0.15, 0);
    const footG = egg(0.055, 0.02, 0.075, 0, 0.012, -0.03, 8);
    const N = SLOTS * PER;
    const mk = (g: THREE.BufferGeometry, mat: THREE.Material) => { const im = new THREE.InstancedMesh(g, mat, N); im.frustumCulled = false; im.count = 0; this.group.add(im); return im; };
    this.dark = mk(darkG, black);
    this.dark.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);
    this.parts = [this.dark, mk(whiteG, white), mk(beakG, orange), mk(goldG, gold), mk(eyeG, eye), mk(shineG, shine), mk(flipG, black), mk(flipG.clone(), black), mk(footG, orange), mk(footG.clone(), orange)];
    // (the flippers share the body's colour: grey for the chicks)
    for (const k of [6, 7]) this.parts[k].instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);
    // the penguins: a set for each colony near you (the colonies, every few hundred metres along the whole coast, take
    // turns with them as you go); set up when a colony comes near (see assign)
    const col = new THREE.Color();
    for (let n = 0; n < N; n++) {
      const chick = n % 5 === 4;
      this.pens.push({ x: 0, z: 0, yaw: 0, s: chick ? 0.6 : 0.92 + Math.random() * 0.16, chick, colony: Math.floor(n / PER), hud: 0, a: 0, ring: 0, walking: false, tx: 0, tz: 0,
        ph: Math.random() * 10, step: 0, flap: 0, look: 0, wait: 5 + Math.random() * 40, on: false });
      col.set(chick ? "#8d8f96" : "#17181d");
      this.dark.setColorAt(n, col); this.parts[6].setColorAt(n, col); this.parts[7].setColorAt(n, col);
    }
    for (let k = 0; k < SLOTS; k++) { this.huddles.push([]); this.slots.push(null); }
    scene.add(this.group);
  }

  /** `me`: where you are (feet); `away`: in a cave, a level... */
  update(dt: number, me: { x: number; y: number; z: number }, away: boolean) {
    this.assignT -= dt;
    if (this.assignT <= 0) { this.assignT = 1; this.assign(me, away); }
    const near = this.slots.some((c) => c !== null);
    this.group.visible = near;
    if (!near) return;
    dt = Math.min(dt, 0.05);
    this.t += dt;
    this.chirpT -= dt;
    let n = 0;
    for (const p of this.pens) {
      // (a penguin not in a colony near you: an empty slot, nothing drawn)
      if (!p.on) { this.base.makeScale(0, 0, 0); for (const im of this.parts) im.setMatrixAt(n, this.base); n++; continue; }
      const dme = Math.hypot(p.x - me.x, p.z - me.z);
      let moving = false;
      // ---- friendly: close by, it stops, turns to look up at you, flaps and chirps
      if (dme < 3.2) {
        p.look = Math.min(1, p.look + dt * 2);
        const want = Math.atan2(p.x - me.x, p.z - me.z);
        let d = want - p.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); p.yaw += d * Math.min(1, dt * 3);
        if (p.look > 0.9 && p.flap <= 0 && Math.random() < dt * 0.6) { p.flap = 0.9; if (this.chirpT <= 0) { this.chirpT = 1.2; this.chirp?.(p.x, p.z, p.chick ? 1 : 0.7); } }
        // (and steps aside rather than be trodden on)
        if (dme < 0.7) { const k = (0.7 - dme) * dt * 4 / Math.max(0.05, dme); p.x += (p.x - me.x) * k; p.z += (p.z - me.z) * k; moving = true; }
      } else {
        p.look = Math.max(0, p.look - dt);
        const hs = this.huddles[p.colony];
        if (p.walking) {
          // ---- waddling over to another huddle
          const dx = p.tx - p.x, dz = p.tz - p.z, d = Math.hypot(dx, dz);
          if (d < 0.5) { p.walking = false; p.ring = 0.8 + Math.random() * 0.2; p.a = Math.atan2(p.z - hs[p.hud].z, p.x - hs[p.hud].x); }
          else {
            const want = Math.atan2(-dx, -dz);
            let a = want - p.yaw; a = Math.atan2(Math.sin(a), Math.cos(a)); p.yaw += a * Math.min(1, dt * 2.5);
            const v = (p.chick ? 0.45 : 0.55) * dt;
            p.x -= Math.sin(p.yaw) * v; p.z -= Math.cos(p.yaw) * v; moving = true;
          }
        } else {
          // ---- in the huddle: the whole huddle turns slowly; the ones on the outside slowly work their way in
          const H = hs[p.hud];
          p.a += H.spin * dt * (1.2 - p.ring * 0.4);
          p.ring = Math.max(0, p.ring - dt * 0.004);
          if (p.ring <= 0.02) p.ring = 1;
          const r = 0.35 + p.ring * 1.7, tx = H.x + Math.cos(p.a) * r, tz = H.z + Math.sin(p.a) * r;
          const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
          if (d > 0.05) { p.x += dx * Math.min(1, dt * 0.8); p.z += dz * Math.min(1, dt * 0.8); moving = d > 0.25; }
          // (huddlers face in, more or less, the same way: out of the wind)
          let a = (0.6 + (this.slots[p.colony]?.id ?? 0)) - p.yaw; a = Math.atan2(Math.sin(a), Math.cos(a)); p.yaw += a * Math.min(1, dt * 0.5);
          // now and then one sets off for another huddle
          p.wait -= dt;
          if (p.wait <= 0) {
            p.wait = 25 + Math.random() * 60;
            if (hs.length > 1 && Math.random() < 0.5) { p.hud = (p.hud + 1 + Math.floor(Math.random() * (hs.length - 1))) % hs.length; const T = hs[p.hud], ta = Math.random() * 6.28; p.tx = T.x + Math.cos(ta) * 1.8; p.tz = T.z + Math.sin(ta) * 1.8; p.walking = true; }
            else p.flap = 0.8;
          }
        }
      }
      // ---- the pose: a waddle (rocking side to side, feet lifting in turn), flippers out when flapping
      if (moving) p.step += dt * (p.chick ? 11 : 8);
      p.flap = Math.max(0, p.flap - dt);
      const w = moving ? 1 : 0.12, roll = Math.sin(p.step) * 0.16 * w + (moving ? 0 : 0.03 * Math.sin(this.t * 0.7 + p.ph));
      const lift = moving ? Math.max(0, Math.sin(p.step)) : 0, lift2 = moving ? Math.max(0, -Math.sin(p.step)) : 0;
      const flapA = p.flap > 0 ? 0.9 * Math.abs(Math.sin(p.flap * 14)) : 0.12 + 0.04 * Math.sin(this.t * 1.3 + p.ph);
      const y = heightAt(p.x, p.z);
      // (looking up at you: a tilt back of the head and body)
      this.e.set(-0.18 * p.look, p.yaw, roll); this.q.setFromEuler(this.e);
      this.base.compose(this.p.set(p.x, y + 0.02 * (lift + lift2), p.z), this.q, this.sc.setScalar(p.s));
      for (let k = 0; k < 6; k++) this.parts[k].setMatrixAt(n, this.base);
      for (const [k, sx] of [[6, -1], [7, 1]] as [number, number][]) {
        this.loc.makeRotationZ(sx * flapA).setPosition(sx * 0.2, 0.5, 0.0);
        this.m.multiplyMatrices(this.base, this.loc); this.parts[k].setMatrixAt(n, this.m);
      }
      for (const [k, sx, l] of [[8, -1, lift], [9, 1, lift2]] as [number, number, number][]) {
        this.loc.makeRotationX(-l * 0.5).setPosition(sx * 0.08, l * 0.05, 0);
        this.m.multiplyMatrices(this.base, this.loc); this.parts[k].setMatrixAt(n, this.m);
      }
      n++;
    }
    for (const im of this.parts) { im.count = n; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
  }

  /** the colonies near you get the penguins: a colony coming near gets a free set, one left behind gives its set back */
  private assign(me: { x: number; z: number }, away: boolean) {
    const near = away ? [] : coloniesNear(me.x, me.z, NEAR, this.near).sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z)).slice(0, SLOTS);
    for (let k = 0; k < SLOTS; k++) {
      const c = this.slots[k];
      if (c && !near.some((q) => q.id === c.id)) { this.slots[k] = null; for (let i = 0; i < PER; i++) this.pens[k * PER + i].on = false; }
    }
    for (const c of near) {
      if (this.slots.some((q) => q?.id === c.id)) continue;
      const k = this.slots.indexOf(null);
      if (k < 0) break;
      this.slots[k] = c;
      // two or three huddles, everybody placed in one
      const hs: { x: number; z: number; spin: number }[] = [], nh = 2 + (c.id % 2);
      for (let h = 0; h < nh; h++) { const a = h * 2.4 + c.id, d = h === 0 ? 0 : 9 + h * 4; hs.push({ x: c.x + Math.cos(a) * d, z: c.z + Math.sin(a) * d, spin: (h % 2 ? 1 : -1) * 0.025 }); }
      this.huddles[k] = hs;
      for (let i = 0; i < PER; i++) {
        const p = this.pens[k * PER + i];
        p.on = i < Math.min(PER, c.n);
        p.hud = i % nh; p.a = Math.random() * Math.PI * 2; p.ring = Math.random(); p.walking = false; p.look = 0; p.flap = 0;
        const H = hs[p.hud], r = 0.4 + p.ring * 1.6;
        p.x = H.x + Math.cos(p.a) * r; p.z = H.z + Math.sin(p.a) * r; p.yaw = Math.random() * 6.28;
      }
    }
  }
}
