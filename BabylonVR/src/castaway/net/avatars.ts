// Ported from Castaway (the cat-house and gorilla bodies are left for the world-content port); drawn by render/mirror.ts.
import * as THREE from 'three';
import type { Scene } from '@babylonjs/core';
import { ThreeMirror } from '../render/mirror';
import type { PState } from './session';
import { heightAt } from '../world/island';
import { ITEMS, type ItemId } from '../game/items';
import { buildPlayer, buildArmor, buildHeld, flicker, makeNamePlate, HIP_Y, BODY_Y, HEAD_Y, TAG_Y, type PlayerRig } from './playerModel';
import { lookFromOutfit, outfitFor, outfitKey, parseOutfit, getOutfit, myDisplayName, setPlayerOutfit, playerColor, type Outfit } from './outfit';

export { playerColor };

const lit = (hex: string, k = 0.28) => {
  const m = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.85 });
  m.emissive = new THREE.Color(hex).multiplyScalar(k); // the scene has little fill light
  return m;
};

function nameTag(text: string): THREE.Sprite {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d')!;
  g.font = '700 30px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const w = Math.min(244, g.measureText(text).width + 28);
  g.fillStyle = 'rgba(8,24,32,.62)'; g.beginPath(); g.roundRect(128 - w / 2, 8, w, 48, 18); g.fill();
  g.fillStyle = '#fff'; g.fillText(text, 128, 33, 230);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  m.fog = false;
  const s = new THREE.Sprite(m);
  s.scale.set(1.3, 0.325, 1);
  s.renderOrder = 6;
  return s;
}

/** A thin health bar that floats under the name. */
function healthBar() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 16;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }); m.fog = false;
  const sp = new THREE.Sprite(m); sp.scale.set(0.7, 0.0875, 1); sp.renderOrder = 6;
  let last = -1;
  const draw = (hp: number) => {
    const v = Math.max(0, Math.min(100, Math.round(hp / 4) * 4));
    if (v === last) return; last = v;
    const g = c.getContext('2d')!; g.clearRect(0, 0, 128, 16);
    g.fillStyle = 'rgba(8,24,32,.7)'; g.beginPath(); g.roundRect(0, 2, 128, 12, 6); g.fill();
    g.fillStyle = v > 55 ? '#6fd36f' : v > 25 ? '#e8c34a' : '#e85d4a';
    g.beginPath(); g.roundRect(2, 4, Math.max(6, 124 * v / 100), 8, 4); g.fill();
    tex.needsUpdate = true;
  };
  return { sprite: sp, draw };
}

// ------------------------------------------------------------------ animation helpers
const _pv = new THREE.Vector3();
const sstep = (t: number) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** [time, shoulderX, elbow, shoulderZ, torsoTwist, torsoLean] */
type Key = [number, number, number, number, number, number];
const CARRY: Key = [0, 0.6, 1.2, 0.05, 0, 0];
const SWINGS: Record<string, { dur: number; keys: Key[] }> = {
  chop: { dur: 0.52, keys: [CARRY, [0.3, 2.55, 1.35, 0, -0.35, 0.14], [0.48, 0.45, 0.4, 0.05, 0.45, -0.3], [0.7, 0.7, 0.9, 0.05, 0.15, -0.12], [1, ...CARRY.slice(1)] as Key] },
  pick: { dur: 0.56, keys: [CARRY, [0.32, 2.8, 1.5, 0, -0.2, 0.18], [0.5, 0.5, 0.3, 0, 0.3, -0.35], [0.72, 0.8, 1.0, 0.05, 0.1, -0.1], [1, ...CARRY.slice(1)] as Key] },
  spear: { dur: 0.5, keys: [[0, 0.85, 1.1, 0.05, 0, 0], [0.3, 0.55, 1.8, 0.1, -0.45, 0.1], [0.45, 1.45, 0.12, 0, 0.35, -0.25], [0.7, 1.1, 0.7, 0.05, 0.1, -0.08], [1, 0.85, 1.1, 0.05, 0, 0]] },
  hit: { dur: 0.42, keys: [CARRY, [0.3, 1.9, 1.1, 0.1, -0.3, 0.1], [0.5, 0.6, 0.5, 0, 0.3, -0.22], [1, ...CARRY.slice(1)] as Key] },
  cast: { dur: 0.8, keys: [[0, 0.95, 1.15, 0.05, 0, 0], [0.35, 2.2, 1.2, 0, -0.2, 0.2], [0.55, 0.85, 0.25, 0, 0.15, -0.12], [1, 0.95, 1.15, 0.05, 0, 0]] },
  eat: { dur: 0.9, keys: [[0, 0.55, 1.7, 0.05, 0, 0], [0.35, 1.35, 2.35, 0.1, 0, 0.05], [0.6, 1.35, 2.35, 0.1, 0, 0.05], [1, 0.55, 1.7, 0.05, 0, 0]] },
};
function sampleKeys(keys: Key[], t: number, out: number[]) {
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0] || i === keys.length - 1) {
      const a = keys[i - 1], b = keys[i], u = sstep((t - a[0]) / Math.max(1e-4, b[0] - a[0]));
      for (let j = 1; j < 6; j++) out[j - 1] = lerp(a[j], b[j], u);
      return;
    }
  }
}
/** how the right arm carries each thing: [shoulder, elbow] */
function carryFor(id: string): [number, number] {
  if (!id) return [0, 0];
  const t = ITEMS[id as ItemId];
  const m = t?.tool?.model;
  if (m === 'spear') return [0.85, 1.1];
  if (m === 'rod') return [0.95, 1.15];
  if (m) return [0.6, 1.2];
  if (t?.kind === 'plan') return [1.05, 1.5];
  return [0.55, 1.7];
}
function swingFor(id: string): string {
  const t = ITEMS[id as ItemId], m = t?.tool?.model;
  if (m === 'hatchet') return 'chop';
  if (m === 'pickaxe') return 'pick';
  if (m === 'spear') return 'spear';
  if (m === 'rod') return 'cast';
  if (t?.kind === 'food') return 'eat';
  return 'hit';
}

class Avatar {
  readonly group = new THREE.Group();
  private R: PlayerRig;
  private arms: THREE.Object3D[];
  private head: THREE.Object3D;
  private held = new THREE.Group();
  private heldId = '';
  private phase = Math.random() * 6;
  private t = Math.random() * 50;
  private swingT = 1;
  private swingKind = 'hit';
  private lastSwing = -1;
  private cur = new THREE.Vector3();
  private prev = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private yaw = 0;
  private pitch = 0;
  private spd = 0;
  private turn = 0;     // how far the body is turned toward the direction of travel
  private run = 0;
  /** the water surface under a swimmer (this client's waves) */
  private surf = 0;
  private wAir = 0; private wSwim = 0; private wSleep = 0; private wDead = 0; private wCarry = 0; private wDrink = 0; private wSit = 0; private drinkT = 0;
  private deadT = 0;
  private blinkT = 2 + Math.random() * 3;
  private target: PState | null = null;
  private first = true;
  private bobber: THREE.Mesh | null = null;
  private line: THREE.Line | null = null;
  fish: { x: number; z: number } | null = null;
  private bubble: THREE.Sprite | null = null;
  private bubbleT = 0;
  private tag: THREE.Sprite;
  private bar = healthBar();
  private body: THREE.Object3D;
  private shirtMat: THREE.Material; private skinMat: THREE.Material;
  // VR: tracked head and hands drawn as a floating head, two hands and 2-bone arms
  private vrOn = false;
  private vr: { visor: THREE.Mesh; seg: THREE.Mesh[]; hand: THREE.Mesh[]; has: boolean[] } | null = null;
  private vh = new THREE.Vector3(); private vhq = new THREE.Quaternion();
  private vp = [new THREE.Vector3(), new THREE.Vector3()]; private vq = [new THREE.Quaternion(), new THREE.Quaternion()];
  private vInit = false;
  private stepAcc = 0;
  private swingOut = [0, 0, 0, 0, 0];
  /** footstep callback (world position) */
  onStep: ((x: number, y: number, z: number) => void) | null = null;

  private armorCode = 0; private armorParts: THREE.Object3D[] = []; private shadowsOn = false;

  /** what this avatar was built from, so it can be rebuilt when the player changes their look or name */
  readonly key: string;
  constructor(readonly id: number, readonly name: string, shadows: boolean, outfit: Outfit = outfitFor(id)) {
    this.shadowsOn = shadows;
    this.key = outfitKey(outfit) + '|' + name;
    const look = lookFromOutfit(outfit, id);
    this.shirtMat = lit(look.shirt); this.skinMat = lit(look.skin, 0.2);
    this.R = buildPlayer(look, shadows);
    this.arms = this.R.shoulders; this.head = this.R.head; this.body = this.R.body;
    // slightly sturdier limbs and a bigger head read better at game distance
    this.R.thighs.forEach((t) => t.scale.set(1.14, 1, 1.14)); this.R.shoulders.forEach((t) => t.scale.set(1.1, 1, 1.1));
    this.R.head.scale.setScalar(1.1); this.body.scale.set(1.05, 1, 1.07);
    this.R.grips[1].add(this.held);
    this.R.body.add(makeNamePlate(name));
    const tag = nameTag(name); tag.position.set(0, TAG_Y, 0);
    this.tag = tag; this.bar.sprite.position.set(0, TAG_Y - 0.14, 0);
    this.group.add(this.R.rig, tag, this.bar.sprite);
    this.group.frustumCulled = false;
  }

  /** tiers worn as one number: head*100 + chest*10 + legs (each 0..3) */
  private setArmor(code: number) {
    if (code === this.armorCode) return;
    this.armorCode = code;
    for (const o of this.armorParts) { o.parent?.remove(o); (o as THREE.Mesh).geometry?.dispose(); }
    this.armorParts = [];
    if (!code) return;
    const mk = buildArmor([Math.floor(code / 100) % 10, Math.floor(code / 10) % 10, code % 10], this.shadowsOn);
    const first = mk();
    if (first.head) { this.R.head.add(first.head); this.armorParts.push(first.head); }
    if (first.chest) { this.R.body.add(first.chest); this.armorParts.push(first.chest); }
    if (first.thigh && first.shin) {
      for (let i = 0; i < 2; i++) {
        const a = i === 0 ? first : mk();
        this.R.thighs[i].add(a.thigh!); this.R.knees[i].add(a.shin!); this.armorParts.push(a.thigh!, a.shin!);
      }
    }
  }

  private setHeld(id: string) {
    if (id === this.heldId) return;
    this.heldId = id;
    for (const c of [...this.held.children]) { this.held.remove(c); c.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); }); }
    this.R.fist[1].visible = !!id; this.R.open[1].visible = !id;
    if (id) this.held.add(buildHeld(id, true));
  }

  set(s: PState) {
    this.target = s;
    if (this.first) { this.cur.set(s.x, s.y, s.z); this.prev.copy(this.cur); this.yaw = s.yaw; this.first = false; this.lastSwing = s.swing; }
  }

  update(dt: number) {
    const s = this.target;
    if (!s) return;
    dt = Math.min(dt, 0.1);
    this.t += dt;
    if (this.bubble && (this.bubbleT -= dt) <= 0) { this.group.remove(this.bubble); (this.bubble.material as THREE.Material).dispose(); this.bubble = null; }
    const k = (s.flags & 64) ? 1 : 1 - Math.exp(-dt * 12);       // a driver rides the already smoothed car
    this.prev.copy(this.cur);
    // swimming: ride MY water. A VR swimmer's head sits just above it (their real head height says where the feet go); a
    // desktop swimmer's hips are put on it below. The height follows more gently, so the waves don't make them judder.
    const swimNow = (s.flags & 2) !== 0 && (s.flags & 4) === 0;
    let ty = s.y;
    if (swimNow && swimSurface) {
      this.surf = swimSurface(this.cur.x, this.cur.z);
      if (s.v) ty = this.surf + 0.1 - s.v.h[1];
    } else this.surf = 0;
    const ky = swimNow ? 1 - Math.exp(-dt * 4) : k;
    this.cur.x += (s.x - this.cur.x) * k; this.cur.y += (ty - this.cur.y) * ky; this.cur.z += (s.z - this.cur.z) * k;
    let dy = s.yaw - this.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += dy * k; this.pitch += (s.pitch - this.pitch) * k;
    this.spd += (s.spd - this.spd) * Math.min(1, dt * 8);
    this.group.position.copy(this.cur);
    this.group.rotation.set(0, this.yaw, 0);
    this.setHeld((s.flags & 64) ? "" : s.item);
    this.setArmor(s.arm ?? 0);
    this.bar.draw(s.hp);

    const seatedF = (s.flags & 64) !== 0 || (s.flags & 536870912) !== 0;   // driving, or riding the water slide
    const asleep = (s.flags & 8) !== 0, dead = (s.flags & 4) !== 0, swim = (s.flags & 2) !== 0, sprint = (s.flags & 1) !== 0;
    const useVR = !!s.v && !dead && !asleep;
    this.setVR(useVR);
    // footsteps for the local player to hear
    if (!dead && !asleep && !swim && !seatedF && this.spd > 0.8) {
      this.stepAcc += this.spd * dt;
      if (this.stepAcc > (sprint ? 1.75 : 2.15)) { this.stepAcc = 0; this.onStep?.(this.cur.x, this.cur.y, this.cur.z); }
    } else if (this.spd < 0.4) this.stepAcc = 1.4;

    if (this.lastSwing !== s.swing) {
      if (this.lastSwing >= 0) { this.swingT = 0; this.swingKind = swingFor(s.item); }
      this.lastSwing = s.swing;
    }
    const sw = SWINGS[this.swingKind];
    this.swingT = Math.min(1, this.swingT + dt / sw.dur);

    // ---- motion relative to where the player faces (so backing up and strafing look right)
    const inv = 1 / Math.max(dt, 1e-3);
    const vx = (this.cur.x - this.prev.x) * inv, vy = (this.cur.y - this.prev.y) * inv, vz = (this.cur.z - this.prev.z) * inv;
    const kv = Math.min(1, dt * 10);
    this.vel.x += (vx - this.vel.x) * kv; this.vel.y += (vy - this.vel.y) * kv; this.vel.z += (vz - this.vel.z) * kv;
    const fwd = -this.vel.x * Math.sin(this.yaw) - this.vel.z * Math.cos(this.yaw);
    const side = this.vel.x * Math.cos(this.yaw) - this.vel.z * Math.sin(this.yaw);
    const hs = Math.hypot(fwd, side);
    let ang = hs > 0.35 ? Math.atan2(side, fwd) : 0, rev = 1;
    if (Math.abs(ang) > Math.PI / 2) { ang = ang > 0 ? ang - Math.PI : ang + Math.PI; rev = -1; }
    this.turn += (Math.max(-0.75, Math.min(0.75, ang * 0.55)) - this.turn) * Math.min(1, dt * 7);
    const moveAmt = Math.min(1, Math.max(this.spd, hs) / 2.6);
    this.run += ((sprint ? 1 : Math.min(1, Math.max(0, (this.spd - 2.4) / 3))) - this.run) * Math.min(1, dt * 5);
    const cycle = lerp(2.0, 3.3, this.run);                        // metres per full stride cycle
    this.phase += rev * hs * dt * (Math.PI * 2 / cycle) * (swim ? 0.7 : 1);

    // ---- which broad state are we in
    const airborne = !swim && !dead && !asleep && !seatedF && Math.abs(this.vel.y) > 1.8 + 0.5 * hs;
    const wr = (cur: number, on: boolean, rate: number) => cur + ((on ? 1 : 0) - cur) * Math.min(1, dt * rate);
    this.wAir = wr(this.wAir, airborne, 12); this.wSwim = wr(this.wSwim, swim && !dead, 6);
    this.wSleep = wr(this.wSleep, asleep && !dead, 3); this.wDead = wr(this.wDead, dead, 9);
    this.wCarry = wr(this.wCarry, !!s.item && !dead && !asleep && !seatedF, 8);
    this.wSit = wr(this.wSit, seatedF && !dead && !swim, 10);
    const drinking = (s.flags & 32) !== 0 && !dead && !asleep && !swim;
    if (drinking && this.wDrink < 0.02) this.drinkT = 0;
    this.wDrink = wr(this.wDrink, drinking, 6);
    if (drinking) this.drinkT += dt;
    this.deadT = dead ? Math.min(1, this.deadT + dt / 0.7) : 0;

    // ---- pose
    const R = this.R, T = this.t, ph = this.phase;
    const th = [0, 0], thZ = [0, 0], kn = [0, 0], an = [0, 0], shX = [0, 0], shZ = [0, 0], el = [0, 0];
    let upX = 0, upY = 0, upZ = 0, bob = 0, headX = 0, headY = 0, pitch = 0;
    const mv = moveAmt, idle = 1 - mv;
    const A = (0.5 + 0.45 * this.run) * mv, armA = (0.4 + 0.5 * this.run) * mv;
    for (let i = 0; i < 2; i++) {
      const f = ph + i * Math.PI, sn = Math.sin(f), cs = Math.cos(f), sd = i ? 1 : -1;
      th[i] = A * sn + sd * 0.0 + Math.sin(T * 0.5 + i * 2) * 0.012 * idle;
      thZ[i] = sd * (0.035 + 0.02 * mv);
      kn[i] = mv * (0.1 + (0.5 + 0.7 * this.run) * Math.max(0, cs)) + 0.02;
      an[i] = -th[i] * 0.3 + 0.18 * Math.max(0, -cs) * mv;
      shX[i] = -armA * sn + Math.sin(T * 0.9 + i * 1.7) * 0.035 * idle;
      shZ[i] = sd * (0.08 + 0.05 * mv + Math.sin(T * 1.1 + i) * 0.01);
      el[i] = 0.14 + mv * (0.15 + 0.75 * this.run) * Math.max(0, -sn) + 0.05 * Math.sin(T * 0.8 + i) * idle;
    }
    upX = -(0.03 + 0.13 * this.run) * mv; upY = Math.sin(ph) * 0.12 * (0.5 + this.run) * mv; upZ = Math.sin(ph) * 0.03 * mv + Math.sin(T * 0.6) * 0.012 * idle;
    bob = -Math.abs(Math.sin(ph)) * 0.035 * (1 + this.run) * mv;
    headX = -upX * 0.8;
    headY = Math.sin(T * 0.37) * 0.14 * idle + Math.sin(T * 0.9) * 0.03;

    // strafing: legs splay sideways
    if (hs > 0.35) { const sa = Math.sin(ang) * 0.5 * mv; thZ[0] -= sa * Math.max(0, Math.sin(ph)); thZ[1] -= sa * Math.max(0, -Math.sin(ph)); }

    // ---- carrying: the right arm holds the item up in front; spears and rods get a left-hand support
    const c = this.wCarry, [csh, cel] = carryFor(s.item);
    if (c > 0.001) {
      const bounce = Math.sin(ph * 2) * 0.05 * mv;
      shX[1] = lerp(shX[1], csh + bounce, c); el[1] = lerp(el[1], cel, c); shZ[1] = lerp(shZ[1], 0.06, c);
      const m2 = ITEMS[s.item as ItemId]?.tool?.model;
      if (m2 === 'spear' || m2 === 'rod') { shX[0] = lerp(shX[0], 0.5, c); el[0] = lerp(el[0], 1.05, c); shZ[0] = lerp(shZ[0], -0.12, c); }
      upY += -0.06 * c;
    }
    if (this.fish) { shX[1] = lerp(shX[1], 1.0, 0.7); el[1] = lerp(el[1], 1.1, 0.7); upX -= 0.04; }
    // ---- swing / eat overlay
    if (this.swingT < 1 && !dead && !asleep) {
      const o = this.swingOut; sampleKeys(sw.keys, this.swingT, o);
      const w = 1 - this.wSwim * 0.4;
      shX[1] = lerp(shX[1], o[0], w); el[1] = lerp(el[1], o[1], w); shZ[1] = lerp(shZ[1], o[2], w);
      upY += o[3] * w; upX += o[4] * w;
      if (this.swingKind === 'spear') { bob -= 0.05 * Math.sin(this.swingT * Math.PI); }
      if (this.swingKind !== 'eat') { th[0] += 0.18 * Math.sin(this.swingT * Math.PI); th[1] -= 0.14 * Math.sin(this.swingT * Math.PI); kn[0] += 0.12 * Math.sin(this.swingT * Math.PI); }
      if (this.swingKind === 'eat') headX += -0.28 * Math.sin(this.swingT * Math.PI);
    }

    // ---- drinking: crouch, both hands dip into the water and cup it, then lift to the mouth and sip
    if (this.wDrink > 0.001) {
      const w = this.wDrink, u = (this.drinkT % 2.4) / 2.4;
      // g: 1 = hands in the water, 0 = hands at the mouth
      const g = u < 0.3 ? 1 : u < 0.65 ? 1 - sstep((u - 0.3) / 0.35) : u < 0.88 ? 0 : sstep((u - 0.88) / 0.12);
      const scoop = u < 0.3 ? Math.sin(u / 0.3 * Math.PI) * 0.12 : 0;   // a little dip as the hands fill
      for (let i = 0; i < 2; i++) {
        const sd = i ? 1 : -1;
        th[i] = lerp(th[i], 0.8, w); kn[i] = lerp(kn[i], 1.5, w); an[i] = lerp(an[i], 0.35, w); thZ[i] = lerp(thZ[i], sd * 0.1, w);
        shX[i] = lerp(shX[i], lerp(1.3, 0.75 + scoop, g), w); el[i] = lerp(el[i], lerp(2.3, 0.7 + scoop, g), w); shZ[i] = lerp(shZ[i], -sd * lerp(0.55, 0.3, g), w);
      }
      upX = lerp(upX, lerp(-0.1, -0.55, g), w); upY = lerp(upY, 0, w); upZ = lerp(upZ, 0, w);
      headX = lerp(headX, lerp(-0.25, 0.35, g), w); headY = lerp(headY, 0, w);
      bob = lerp(bob, -0.3, w);
    }
    // ---- driving: sitting in the seat, thighs forward, both hands on the wheel (no run cycle however fast the car goes)
    if (this.wSit > 0.001) {
      const w = this.wSit;
      for (let i = 0; i < 2; i++) {
        const sd = i ? 1 : -1;
        th[i] = lerp(th[i], 1.45, w); kn[i] = lerp(kn[i], 1.5, w); an[i] = lerp(an[i], 0.1, w); thZ[i] = lerp(thZ[i], sd * 0.08, w);
        shX[i] = lerp(shX[i], 1.2, w); el[i] = lerp(el[i], 0.45, w); shZ[i] = lerp(shZ[i], -sd * 0.05, w);
      }
      upX = lerp(upX, 0.05, w); upY = lerp(upY, 0, w); upZ = lerp(upZ, 0, w); headX = lerp(headX, 0, w); headY = lerp(headY, 0, w);
      bob = lerp(bob, -0.78, w);
    }
    // ---- airborne: knees tuck, arms rise
    if (this.wAir > 0.001) {
      const w = this.wAir, up = this.vel.y > 0 ? 1 : 0.4;
      for (let i = 0; i < 2; i++) {
        th[i] = lerp(th[i], (i ? 0.55 : 0.2) * up + 0.1, w); kn[i] = lerp(kn[i], (i ? 1.0 : 0.6) * up + 0.15, w); an[i] = lerp(an[i], 0.3, w);
        shX[i] = lerp(shX[i], this.vel.y > 0 ? 0.9 : 0.5, w * (i === 1 && c > 0.5 ? 0.3 : 1)); shZ[i] = lerp(shZ[i], (i ? 1 : -1) * 0.7, w); el[i] = lerp(el[i], 0.5, w * (i === 1 && c > 0.5 ? 0.3 : 1));
      }
      upX = lerp(upX, this.vel.y > 0 ? -0.06 : 0.04, w);
    }
    // ---- swimming in VR: upright, treading water (the tracked head and hands do the rest), legs scissoring slowly below
    if (this.wSwim > 0.001 && useVR) {
      const w = this.wSwim, sp = this.t * 2.0;
      for (let i = 0; i < 2; i++) {
        const sd = i ? 1 : -1;
        th[i] = lerp(th[i], -0.15 + 0.28 * Math.sin(sp + i * Math.PI), w); kn[i] = lerp(kn[i], 0.35 + 0.2 * Math.sin(sp + i * Math.PI + 0.8), w); an[i] = lerp(an[i], 0.5, w);
        thZ[i] = lerp(thZ[i], sd * 0.07, w);
      }
    }
    // ---- swimming: face down in a crawl (an easy flutter kick, not a frantic one)
    if (this.wSwim > 0.001 && !useVR) {
      const w = this.wSwim, sp = this.t * (2.2 + Math.min(this.spd, 3) * 0.7);
      for (let i = 0; i < 2; i++) {
        const a = sp + i * Math.PI, sd = i ? 1 : -1;
        th[i] = lerp(th[i], 0.22 * Math.sin(sp * 1.5 + i * Math.PI), w); kn[i] = lerp(kn[i], 0.08 + 0.18 * Math.max(0, Math.cos(sp * 1.5 + i * Math.PI)), w); an[i] = lerp(an[i], 0.4, w);
        thZ[i] = lerp(thZ[i], sd * 0.05, w);
        shX[i] = lerp(shX[i], 2.7 - ((a % (Math.PI * 2)) / (Math.PI * 2)) * 3.8 + 0.0, w);  // reach, pull, push, recover
        el[i] = lerp(el[i], 0.15 + 0.9 * Math.max(0, Math.sin(a)), w);
        shZ[i] = lerp(shZ[i], sd * 0.25, w);
      }
      pitch = lerp(pitch, -1.28, w); upX = lerp(upX, 0.0, w); upY = lerp(upY, Math.sin(sp) * 0.25, w); upZ = lerp(upZ, Math.sin(sp) * 0.12, w);
      headX = lerp(headX, 1.0 + this.pitch * 0.3, w); headY = lerp(headY, Math.sin(sp) * 0.2, w);
    }
    // ---- asleep: flat on the back, arms resting at the sides, slow breathing
    if (this.wSleep > 0.001) {
      const w = this.wSleep;
      for (let i = 0; i < 2; i++) {
        const sd = i ? 1 : -1;
        th[i] = lerp(th[i], 0, w); kn[i] = lerp(kn[i], 0.05, w); thZ[i] = lerp(thZ[i], sd * 0.08, w); an[i] = lerp(an[i], 0.2, w);
        shX[i] = lerp(shX[i], 0.05, w); el[i] = lerp(el[i], 0.3, w); shZ[i] = lerp(shZ[i], sd * 0.16, w);
      }
      pitch = lerp(pitch, Math.PI / 2, w); upX = lerp(upX, 0, w); upY = lerp(upY, 0, w); upZ = lerp(upZ, 0, w); headX = lerp(headX, 0, w); headY = lerp(headY, 0.25, w);
    }
    // ---- dead: collapse backwards, limbs splayed
    if (this.wDead > 0.001) {
      const w = this.wDead, fall = sstep(this.deadT);
      for (let i = 0; i < 2; i++) {
        const sd = i ? 1 : -1;
        th[i] = lerp(th[i], 0.05 * sd, w); kn[i] = lerp(kn[i], 0.12, w); thZ[i] = lerp(thZ[i], sd * 0.16, w); an[i] = lerp(an[i], -0.1, w);
        shX[i] = lerp(shX[i], 0.1 * -sd, w); el[i] = lerp(el[i], 0.2, w); shZ[i] = lerp(shZ[i], sd * 0.95 * fall, w);
      }
      pitch = lerp(pitch, (Math.PI / 2) * fall * 0.98 + 0.0, w); upX = lerp(upX, 0, w); upY = lerp(upY, -0.15, w); upZ = lerp(upZ, 0, w); headX = lerp(headX, -0.2, w); headY = lerp(headY, -0.3, w);
    }

    // ---- apply
    const legsOnly = useVR;
    for (let i = 0; i < 2; i++) {
      R.thighs[i].rotation.set(th[i], 0, thZ[i]); R.knees[i].rotation.x = -kn[i]; R.ankles[i].rotation.x = an[i];
      if (!legsOnly) { R.shoulders[i].rotation.set(shX[i], 0, shZ[i]); R.elbows[i].rotation.x = el[i]; R.wrists[i].rotation.x = i === 1 && c > 0.3 ? -0.15 : 0.0; }
    }
    // body root: pitch about the hips, then a drop so a lying body rests on the ground / floats on the water
    const lying = Math.abs(Math.sin(pitch));
    let dropY = 0.78 * lying * (1 - this.wSwim);
    if (this.wSwim > 0.01 && !useVR) {
      const surface = (this.surf - 0.14) - (this.cur.y + HIP_Y * Math.cos(pitch));   // hips ride just under MY water line
      dropY = lerp(dropY, -surface, this.wSwim);
    }
    R.rig.rotation.set(pitch, 0, 0);
    R.rig.position.set(0, HIP_Y - HIP_Y * Math.cos(pitch) + bob - dropY, -HIP_Y * Math.sin(pitch));
    R.lower.rotation.y = this.turn;
    if (!useVR) {
      R.upper.rotation.set(upX, this.turn * 0.55 + upY, upZ);
      // rotate the upper body about the hips rather than the floor
      _pv.set(0, HIP_Y, 0).applyEuler(R.upper.rotation);
      R.upper.position.set(-_pv.x, HIP_Y - _pv.y, -_pv.z);
      this.head.rotation.set(Math.max(-1.0, Math.min(1.1, this.pitch * 0.85)) + headX, headY - this.turn * 0.55 - upY * 0.5, 0);
      // breathing
      const br = Math.sin(T * (asleep ? 1.1 : 1.9));
      this.body.scale.set(1.05 * (1 + br * 0.008), 1 + br * (asleep ? 0.02 : 0.012), 1.07 * (1 + br * 0.01));
    }
    // blinking
    this.blinkT -= dt;
    const blink = this.blinkT < 0.12 ? 0.1 : 1;
    if (this.blinkT < 0) this.blinkT = 2.5 + Math.random() * 4;
    R.eyes.scale.y = asleep || dead ? 0.1 : blink;
    if (R.pack) R.pack.visible = this.wSleep < 0.5;   // nobody sleeps on their rucksack
    this.tag.position.y = pitch !== 0 && lying > 0.5 ? 1.0 : TAG_Y;
    this.bar.sprite.position.y = this.tag.position.y - 0.14;

    // the held item stays in the fist; its angle follows the forearm so a swing sweeps it naturally
    this.held.visible = this.wDrink < 0.5;                        // both hands are busy
    if (this.held.children[0]) flicker(this.held.children[0], this.t);
    if (!useVR) { this.held.position.set(0, 0, 0); this.held.rotation.set(-Math.PI / 2 - 0.25, 0, 0); }
    this.group.visible = true;
    if (useVR) this.updateVR(s, dt, k);
  }

  // ---------------------------------------------------------------- VR rig
  private buildVR() {
    const seg: THREE.Mesh[] = [], hand: THREE.Mesh[] = [];
    for (let i = 0; i < 4; i++) {
      const g = new THREE.CylinderGeometry(0.048, 0.042, 1, 8);
      const m = new THREE.Mesh(g, i < 2 ? this.shirtMat : this.skinMat); // upper arms in the shirt colour, forearms bare
      m.visible = false; m.frustumCulled = false; seg.push(m); this.group.add(m);
    }
    for (let i = 0; i < 2; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.058, 10, 8), this.skinMat);
      m.visible = false; m.frustumCulled = false; hand.push(m); this.group.add(m);
    }
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.085, 0.1), lit('#2a2f36', 0.1));
    visor.position.set(0, 0.02, -0.128); visor.visible = false;
    const lens = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.05, 0.01), lit('#6fb6d8', 0.5));
    lens.position.set(0, 0, -0.054); visor.add(lens);
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.03, 0.02), lit('#2a2f36', 0.1));
    strap.position.set(0, 0.0, 0.1); visor.add(strap);
    this.head.add(visor);
    this.vr = { visor, seg, hand, has: [false, false] };
  }

  private setVR(on: boolean) {
    if (on === this.vrOn) return;
    this.vrOn = on;
    if (!this.vr && on) this.buildVR();
    const v = this.vr;
    if (!on) {
      if (v) { v.visor.visible = false; v.seg.forEach((m) => { m.visible = false; }); v.hand.forEach((m) => { m.visible = false; }); }
      this.arms.forEach((a) => { a.visible = true; });
      this.R.grips[1].add(this.held); this.held.position.set(0, 0, 0); this.held.rotation.set(-Math.PI / 2 - 0.25, 0, 0); this.held.quaternion.setFromEuler(this.held.rotation); this.held.scale.setScalar(1);
      this.head.position.set(0, HEAD_Y, 0); this.head.quaternion.identity();
      this.body.position.set(0, BODY_Y, 0); this.R.lower.position.set(0, 0, 0); this.R.lower.scale.set(1, 1, 1);
      this.R.upper.rotation.set(0, 0, 0); this.R.upper.position.set(0, 0, 0);
      this.tag.position.set(0, TAG_Y, 0); this.bar.sprite.position.set(0, TAG_Y - 0.14, 0);
      this.vInit = false;
    } else if (v) v.visor.visible = true;
  }

  private static readonly UP = new THREE.Vector3(0, 1, 0);
  private static readonly TOOL = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0.64, -0.77).normalize());

  private updateVR(s: PState, dt: number, _k: number) {
    const v = s.v!, vr = this.vr!;
    const yq = new THREE.Quaternion().setFromAxisAngle(Avatar.UP, this.yaw), yinv = yq.clone().invert();
    const loc = (o: THREE.Vector3, x: number, y: number, z: number) => o.set(x, y, z).applyQuaternion(yinv);
    const tgtH = loc(new THREE.Vector3(), v.h[0], v.h[1], v.h[2]);
    const tgtHq = new THREE.Quaternion().setFromEuler(new THREE.Euler(v.h[4], v.h[3], v.h[5], 'YXZ'));
    tgtHq.premultiply(yinv);
    const kk = this.vInit ? 1 - Math.exp(-dt * 16) : 1;
    this.vh.lerp(tgtH, kk); this.vhq.slerp(tgtHq, kk);
    this.head.position.copy(this.vh); this.head.quaternion.copy(this.vhq);
    // torso hangs below the head; legs stay on the ground
    // the chest hangs right under the head whatever its height, and the legs stretch (or squash, when crouching) to reach the hips
    const bx = this.vh.x * 0.8, bz = this.vh.z * 0.8, by = this.vh.y - (HEAD_Y - BODY_Y) - 0.02;
    const legK = Math.max(0.35, Math.min(1.4, (by - (BODY_Y - HIP_Y)) / HIP_Y));
    this.R.lower.position.set(bx, 0, bz); this.R.lower.scale.set(1, legK, 1);
    this.R.upper.rotation.set(0, 0, 0); this.R.upper.position.set(0, 0, 0);
    this.body.position.set(bx, by, bz);
    this.body.scale.set(1.05, 1, 1.07);
    this.tag.position.set(this.vh.x, this.vh.y + 0.5, this.vh.z);
    this.bar.sprite.position.set(this.vh.x, this.vh.y + 0.36, this.vh.z);

    const hands = [v.l, v.r]; // index 0 = left (-X), 1 = right (+X); matches arms[]
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1, d = hands[i];
      vr.has[i] = !!d;
      this.arms[i].visible = !d;
      const h = vr.hand[i], upper = vr.seg[i * 2], fore = vr.seg[i * 2 + 1];
      h.visible = upper.visible = fore.visible = !!d;
      if (!d) continue;
      const tp = loc(new THREE.Vector3(), d[0], d[1], d[2]);
      const tq = new THREE.Quaternion(d[3], d[4], d[5], d[6]).premultiply(yinv);
      if (!this.vInit) { this.vp[i].copy(tp); this.vq[i].copy(tq); }
      this.vp[i].lerp(tp, kk); this.vq[i].slerp(tq, kk);
      const H = this.vp[i];
      const S = new THREE.Vector3(bx + side * 0.27, by + 0.2, bz);
      // two-bone arm: the elbow bends down and slightly back
      const L1 = 0.3, L2 = 0.3;
      const dir = H.clone().sub(S), dist = Math.min(dir.length(), (L1 + L2) * 0.995);
      dir.normalize();
      const pole = new THREE.Vector3(side * 0.5, -1, 0.35); pole.addScaledVector(dir, -pole.dot(dir)).normalize();
      const along = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist), off = Math.sqrt(Math.max(0, L1 * L1 - along * along));
      const E = S.clone().addScaledVector(dir, along).addScaledVector(pole, off);
      const place = (m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) => {
        const len = a.distanceTo(b);
        m.position.copy(a).add(b).multiplyScalar(0.5);
        m.quaternion.setFromUnitVectors(Avatar.UP, b.clone().sub(a).normalize());
        m.scale.set(1, Math.max(0.02, len), 1);
      };
      place(upper, S, E); place(fore, E, H.distanceTo(S) > L1 + L2 ? S.clone().addScaledVector(dir, L1 + L2) : H);
      h.position.copy(H);
      if (i === 1) {
        if (this.held.parent !== h) { h.add(this.held); this.held.position.set(0, 0, 0); this.held.scale.setScalar(1); }
        this.held.quaternion.copy(this.vq[i]).multiply(Avatar.TOOL);
      }
    }
    // left-handed or missing right controller: put the tool back on the default arm
    if (!hands[1] && this.held.parent !== this.R.grips[1]) { this.R.grips[1].add(this.held); this.held.position.set(0, 0, 0); this.held.rotation.set(-Math.PI / 2 - 0.25, 0, 0); }
    this.vInit = true;
  }

  /** no labels at all (hide & seek: nobody should know who is who) */
  hideLabels(off: boolean) { if (off) { this.tag.visible = false; this.bar.sprite.visible = false; } if (off !== this.labelsWereOff) { this.labelsWereOff = off; this.group.traverse((o) => { if (o.name === 'nameplate') o.visible = !off; }); } }
  private labelsWereOff = false;
  /** Names fade out with distance so a crowd across the island is not a wall of labels. */
  fade(d: number) {
    const a = Math.max(0, Math.min(1, (70 - d) / 35));
    const far = Math.max(0, Math.min(1, (d - 9) / 9));   // up close the name is on the chest; the floating label only helps from afar
    const tm = this.tag.material as THREE.SpriteMaterial, bm = this.bar.sprite.material as THREE.SpriteMaterial;
    tm.opacity = a * far; bm.opacity = a * ((this.target?.hp ?? 100) < 100 ? 1 : 0.0);
    this.tag.visible = tm.opacity > 0.02; this.bar.sprite.visible = bm.opacity > 0.02;
    if (this.bubble) this.bubble.visible = d < 45;
  }

  say(text: string) {
    if (this.bubble) { this.group.remove(this.bubble); (this.bubble.material as THREE.Material).dispose(); }
    this.bubble = nameTag(text); this.bubble.position.set(0, 2.4, 0); this.bubble.scale.set(1.9, 0.475, 1);
    this.group.add(this.bubble); this.bubbleT = 5;
  }

  /** Fishing float and line for other players. Lives in world space, so it hangs off the scene, not the avatar. */
  private tipPos = new THREE.Vector3();
  updateFish(scene: THREE.Object3D, t: number) {
    if (!this.fish) { if (this.bobber) { this.bobber.visible = false; this.line!.visible = false; } return; }
    if (!this.bobber) {
      this.bobber = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff3b3b' }));
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      this.line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: '#f4f1e6' }));
      this.line.frustumCulled = false;
      scene.add(this.bobber, this.line);
    }
    this.bobber.visible = this.line!.visible = true;
    this.bobber.position.set(this.fish.x, Math.sin(t * 2.1) * 0.02 + 0.03, this.fish.z);
    // the line leaves the tip of the rod in the player's hand
    const tip = this.held.children[0]?.userData.tip as THREE.Object3D | undefined;
    if (tip) { this.group.updateMatrixWorld(true); tip.getWorldPosition(this.tipPos); }
    else this.tipPos.set(this.cur.x, this.cur.y + 1.4, this.cur.z);
    const pos = this.line!.geometry.attributes.position as THREE.BufferAttribute;
    pos.setXYZ(0, this.tipPos.x, this.tipPos.y, this.tipPos.z); pos.setXYZ(1, this.fish.x, this.bobber.position.y, this.fish.z);
    pos.needsUpdate = true;
  }

  dispose(scene?: THREE.Object3D) {
    if (scene && this.bobber) { scene.remove(this.bobber, this.line!); this.bobber.geometry.dispose(); this.line!.geometry.dispose(); }
    this.group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); if (m.name === 'nameplate') { const mm = m.material as THREE.MeshStandardMaterial; mm.map?.dispose(); mm.dispose(); } } });
  }
}

/** The other players. */
/** the water surface here, as this client sees it (waves and all): swimmers are placed in it rather than at the height their own
 *  client reported (which follows that client's slightly different waves, and made them bob above the water and judder) */
let swimSurface: ((x: number, z: number) => number) | null = null;
export function setSwimSurface(fn: ((x: number, z: number) => number) | null) { swimSurface = fn; }

export class ThreeAvatars {
  readonly group = new THREE.Group();
  map = new Map<number, Avatar>();
  labelsOff = false;
  /** hide a player in a different special place (their state flags) */
  hideIf: ((flags: number) => boolean) | null = null;

  private clock = 0;
  /** someone nearby took a step */
  onStep: ((x: number, y: number, z: number, flying: boolean) => void) | null = null;
  private beacons: { g: THREE.Group; t: number; mats: THREE.Material[] }[] = [];
  constructor(private scene: THREE.Scene, private shadows: boolean) { scene.add(this.group); this.group.userData.keepUnderground = true; }

  /** A light column + ring at a place somebody pinged. */
  addPing(x: number, z: number, color: string) {
    const y = Math.max(0, heightAt(x, z));
    const mk = (geo: THREE.BufferGeometry, op: number) => {
      const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, depthWrite: false });
      m.blending = THREE.AdditiveBlending; m.fog = false;
      return { mesh: new THREE.Mesh(geo, m), m };
    };
    const g = new THREE.Group(); g.position.set(x, y, z);
    const col = mk(new THREE.CylinderGeometry(0.1, 0.1, 70, 10, 1, true), 0.35); col.mesh.position.y = 35;
    const ring = mk(new THREE.TorusGeometry(1, 0.05, 6, 28), 0.7); ring.mesh.rotation.x = Math.PI / 2; ring.mesh.position.y = 0.08;
    g.add(col.mesh, ring.mesh);
    g.frustumCulled = false; this.scene.add(g);
    this.beacons.push({ g, t: 0, mats: [col.m, ring.m] });
    if (this.beacons.length > 8) this.removeBeacon(0);
  }

  private removeBeacon(i: number) {
    const b = this.beacons[i]; this.scene.remove(b.g);
    b.g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } });
    this.beacons.splice(i, 1);
  }

  private updateBeacons(dt: number) {
    for (let i = this.beacons.length - 1; i >= 0; i--) {
      const b = this.beacons[i]; b.t += dt;
      if (b.t > 20) { this.removeBeacon(i); continue; }
      const fade = Math.min(1, (20 - b.t) / 4);
      (b.mats[0] as any).opacity = 0.35 * fade;
      (b.mats[1] as any).opacity = 0.7 * fade;
      const ring = b.g.children[1]; const p = (b.t * 0.9) % 1; ring.scale.setScalar(0.6 + p * 1.6); (b.mats[1] as any).opacity *= 1 - p * 0.8;
    }
  }

  say(id: number, text: string) { this.map.get(id)?.say(text); }

  setFishing(id: number, at: { x: number; z: number } | null) { const a = this.map.get(id); if (a) a.fish = at; }

  sync(players: Map<number, { id: number; name: string; look?: number[] }>, states: Map<number, PState>, myId: number, dt: number, viewer?: { x: number; y: number; z: number }) {
    this.clock += dt;
    this.updateBeacons(dt);
    for (const [id, p] of players) {
      const o = parseOutfit(p.look); setPlayerOutfit(id, id === myId ? getOutfit() : o);
      if (id === myId) continue;
      let a = this.map.get(id);
      const st = states.get(id);
      // somebody changed their look (or name): build them again
      if (a && a.key !== outfitKey(o ?? outfitFor(id)) + '|' + p.name) { this.group.remove(a.group); a.dispose(this.scene); this.map.delete(id); a = undefined; }
      if (!a && st) { a = new Avatar(id, p.name, this.shadows, o ?? outfitFor(id)); a.onStep = (x, y, z) => this.onStep?.(x, y, z, false); this.map.set(id, a); this.group.add(a.group); }
      if (a && st) a.set(st);
    }
    for (const [id, a] of this.map) {
      if (!players.has(id)) { this.group.remove(a.group); a.dispose(this.scene); this.map.delete(id); }
      else { a.update(dt); a.updateFish(this.scene, this.clock); if (viewer) a.fade(Math.hypot(a.group.position.x - viewer.x, a.group.position.y - viewer.y, a.group.position.z - viewer.z)); a.hideLabels(this.labelsOff); }
      // surface and caves are separate worlds: you only see the players who are in yours
      if (viewer) a.group.visible = a.group.visible && (a.group.position.y < -20) === (viewer.y < -20);
      if (((states.get(id)?.flags ?? 0) & 256) !== 0) a.group.visible = false;   // hiding in a box on Hideaway Isle
      if (this.hideIf?.(states.get(id)?.flags ?? 0)) a.group.visible = false;      // a different place (Locations, Locations)
    }
  }

  private selfAv: Avatar | null = null;
  /** a private copy of you, drawn only into the mirror (layer 2) */
  mirrorSelf(on: boolean, st: PState | null, myId: number, dt: number, name?: string) {
    if (!on || !st) { if (this.selfAv) this.selfAv.group.visible = false; return; }
    const me = getOutfit(), nm = name ?? myDisplayName();
    if (this.selfAv && this.selfAv.key !== outfitKey(me) + '|' + nm) { this.group.remove(this.selfAv.group); this.selfAv.dispose(); this.selfAv = null; }
    if (!this.selfAv) { this.selfAv = new Avatar(myId, nm, false, me); this.group.add(this.selfAv.group); }
    const a = this.selfAv; a.group.visible = true; a.set(st); a.update(dt);
    a.group.traverse((o) => { o.layers.set(5); if ((o as THREE.Sprite).isSprite) o.visible = false; });   // no name tag on your own reflection
  }

  get positions() { return [...this.map].map(([id, a]) => ({ id, name: a.name, x: a.group.position.x, y: a.group.position.y, z: a.group.position.z })); }

  clear() { for (const a of this.map.values()) { this.group.remove(a.group); a.dispose(this.scene); } this.map.clear(); while (this.beacons.length) this.removeBeacon(0); }
}

/**
 * Babylon side: Castaway's avatars live in a private three.js scene graph (animated by their own code) and are drawn
 * by a ThreeMirror each frame.
 */
export class Avatars {
  private holder = new THREE.Scene();
  readonly three = new ThreeAvatars(this.holder, false);
  private mirror: ThreeMirror;
  constructor(scene: Scene, shadows: boolean) { this.mirror = new ThreeMirror(scene, this.holder, null, shadows, { tag: { keepUnderground: true } }); }
  set onStep(f: ((x: number, y: number, z: number) => void) | null) { this.three.onStep = f ? (x, y, z) => f(x, y, z) : null; }
  set surfaceAt(f: (x: number, z: number) => number) { setSwimSurface(f); }
  get positions() { return this.three.positions; }
  say(id: number, text: string) { this.three.say(id, text); }
  addPing(x: number, z: number, color: string) { this.three.addPing(x, z, color); }
  sync(players: Map<number, { id: number; name: string; look?: number[] }>, states: Map<number, PState>, myId: number, dt: number, viewer?: { x: number; y: number; z: number }) {
    this.three.sync(players, states, myId, dt, viewer);
    this.holder.updateMatrixWorld();
    this.mirror.sync();
  }
  clear() { this.three.clear(); this.holder.updateMatrixWorld(); this.mirror.sync(); }
}
