// Two friendly cats (a grey-and-white ragdoll and a brown tabby) that live on the island: they wander and doze, zoom around now and then,
// stalk and pounce on beach crabs (without hurting them), and when you come near they trot over, sit down and say hello.
// Purely cosmetic and simulated locally (same starting spots for everyone, so they are not synced between players).
// Babylon port: Castaway's code, drawn by render/mirror.ts.
import * as THREE from 'three';
import { Mesher } from '../net/playerModel';
import { heightAt, slopeAt, findSpawn } from './island';
import { mulberry32 } from '../core/noise';
import type { ColliderGrid } from './vegetation';

export interface Coat { name: string; back: string; side: string; belly: string; head: string; muzzle: string; ear: string; tail: string; paw: string; leg: string; eye: string; stripe?: string; fluff: number }
const COATS: Coat[] = [
  { name: 'ragdoll', back: '#8d8e94', side: '#b7b6b8', belly: '#f4f1ec', head: '#868790', muzzle: '#f4f1ec', ear: '#6f7077', tail: '#7c7d84', paw: '#f6f3ee', leg: '#a9a8ab', eye: '#5aa9ef', fluff: 1.25 },
  { name: 'brown', back: '#7c4f2c', side: '#8d5c34', belly: '#b58559', head: '#7c4f2c', muzzle: '#c29a70', ear: '#5d3a1f', tail: '#6e4426', paw: '#5d3a1f', leg: '#7c4f2c', eye: '#d6a835', stripe: '#4d2f18', fluff: 1 },
];

/** the coats players get as cats (by player id) */
export const PLAYER_COATS: Coat[] = [
  COATS[1],
  { name: 'orange', back: '#d98a3d', side: '#e5a259', belly: '#f6e2c4', head: '#d98a3d', muzzle: '#f6e2c4', ear: '#b86f2a', tail: '#cf7c2f', paw: '#f6e2c4', leg: '#dc9248', eye: '#7fb04a', stripe: '#a95d1c', fluff: 1.05 },
  { name: 'black', back: '#232326', side: '#2d2d31', belly: '#34343a', head: '#242427', muzzle: '#3a3a40', ear: '#1b1b1d', tail: '#202023', paw: '#2a2a2e', leg: '#27272a', eye: '#e6c43a', fluff: 1.1 },
  { name: 'tuxedo', back: '#1f1f23', side: '#26262a', belly: '#f4f1ec', head: '#1f1f23', muzzle: '#f4f1ec', ear: '#18181a', tail: '#1f1f23', paw: '#f6f3ee', leg: '#26262a', eye: '#7cc06a', fluff: 1.08 },
  COATS[0],
  { name: 'cream', back: '#e9d6b4', side: '#f0e2c6', belly: '#fbf6ea', head: '#e0c9a0', muzzle: '#fbf6ea', ear: '#c9ab7d', tail: '#d8bd90', paw: '#fbf6ea', leg: '#ecdcbc', eye: '#6aa7d8', stripe: '#c9ab7d', fluff: 1.2 },
];

/** a front paw and a little forearm, pointing along -z (VR hands and first-person view) */
export function buildPaw(c: Coat, shadows: boolean) {
  const m = new Mesher();
  m.cyl(0.03, 0.026, 0.2, c.leg, 0, 0.0, 0.1, 1, 1, 10, Math.PI / 2);        // forearm running back towards the body (+z)
  m.sph(1, c.paw, 0, -0.004, -0.04, 0.043, 0.032, 0.06, 10);                  // the paw itself
  for (const x of [-0.018, 0, 0.018]) m.sph(1, '#d98c8c', x * 1.2, -0.03, -0.075, 0.009, 0.005, 0.01, 5);   // toe beans
  m.sph(1, '#d98c8c', 0, -0.032, -0.04, 0.017, 0.006, 0.017, 6);
  for (const x of [-0.016, 0.016]) m.box(0.004, 0.003, 0.034, c.back, x, 0.03, -0.07, 0.15, 0, 0);       // the grooves between the toes
  const g = new THREE.Group(); g.add(m.build(shadows));
  return g;
}

/** your own front paws in the first-person view (the cat house) */
export class FPPaws {
  readonly root = new THREE.Group();
  private paws: THREE.Group[] = [];
  private t = 0; private swat = 9; private bob = 0; private air = 0;
  constructor(coat: Coat, shadows: boolean) {
    for (const side of [-1, 1]) {
      const g = buildPaw(coat, shadows); g.scale.x = side; g.position.set(side * 0.1, -0.2, -0.42); g.rotation.x = -0.3;
      this.root.add(g); this.paws.push(g);
    }
    this.root.visible = false;
    this.root.traverse((o) => { o.renderOrder = 1011; });
  }
  swing() { this.swat = 0; }
  /** after the children were swapped for another coat */
  refresh() { this.paws = this.root.children.filter((c) => (c as THREE.Group).isGroup) as THREE.Group[]; this.root.traverse((o) => { o.renderOrder = 1011; }); }
  update(dt: number, speed: number, vy: number, sprint: boolean) {
    this.t += dt; this.swat += dt * 3.4;
    this.bob += speed * dt * (sprint ? 5.2 : 7);
    this.air += ((Math.abs(vy) > 1 ? 1 : 0) - this.air) * Math.min(1, dt * 10);
    const k = Math.min(1, speed / 1.5);
    this.paws.forEach((g, i) => {
      const ph = this.bob + (i ? Math.PI : 0), s = Math.sin(ph) * k * (1 - this.air);
      g.position.set((i ? 1 : -1) * (0.1 - this.air * 0.03), -0.2 + Math.max(0, Math.cos(ph)) * 0.03 * k + this.air * 0.05, -0.42 - s * 0.1 - this.air * 0.1);
      g.rotation.set(-0.3 - this.air * 0.4, 0, 0);
      if (i === 1 && this.swat < 1) {
        const a = Math.sin(Math.min(1, this.swat) * Math.PI);
        g.position.z -= a * 0.22; g.position.x -= a * 0.1; g.position.y += a * 0.07; g.rotation.y = a * 0.7;
      } else g.rotation.y = 0;
    });
  }
}

type State = 'idle' | 'wander' | 'greet' | 'visit' | 'stalk' | 'pounce' | 'bat' | 'zoom' | 'tobed' | 'nap';
/** a cat bed somebody put down (a structure: x, y, z, yaw) */
export interface CatBed { x: number; y: number; z: number; yaw: number }

interface Cat {
  coat: Coat; root: THREE.Group; torso: THREE.Group; head: THREE.Group; tail: THREE.Group; tailTip: THREE.Group; legs: THREE.Group[]; scale: number;
  x: number; z: number; y: number; yaw: number; state: State; t: number; tx: number; tz: number; speed: number;
  phase: number; sit: number; crouch: number; greetCd: number; playCd: number; crab: any; px: number; pz: number; pt: number; meowCd: number; lookYaw: number; hop: number;
  /** cat beds: the one it is going to / sleeping on, how long until it fancies a nap again, and how curled up it is */
  bed: CatBed | null; napCd: number; lie: number;
}

const turn = (cur: number, want: number, max: number) => {
  let d = want - cur; d = Math.atan2(Math.sin(d), Math.cos(d));
  return cur + Math.max(-max, Math.min(max, d));
};

/** where a leg hangs from the body (body space) and how far it reaches with its paw */
const LEG_TOP = -0.01, LEG_LEN = 0.225;
/**
 * Pose one leg (a child of the torso): `ang` is the angle it should make in the cat's own frame (0 straight down, + swung
 * back), whatever the torso is doing; it stretches or shortens to put the paw on the ground (folded legs keep their length).
 */
export function poseLeg(l: THREE.Object3D, torso: THREE.Object3D, ang: number, fold = 1) {
  const rx = torso.rotation.x, lz = l.position.z;
  l.rotation.x = ang - rx;
  const hy = torso.position.y + LEG_TOP * Math.cos(rx) - lz * Math.sin(rx);       // the hip / shoulder above the ground
  const reach = Math.max(0.3, Math.min(1.45, hy / Math.max(0.3, Math.cos(ang)) / LEG_LEN));
  const k = Math.min(1, Math.max(0, (Math.abs(ang) - 0.6) / 0.6));                 // folded flat: keep its own length
  l.scale.y = (reach * (1 - k) + 0.9 * k) * fold;
}

export function buildCat(c: Coat, shadows: boolean) {
  const f = c.fluff;
  const body = new Mesher(), head = new Mesher(), tail = new Mesher(), tip = new Mesher();
  // torso: a long ellipsoid, darker saddle on top, pale belly; chest ruff
  body.sph(1, c.side, 0, 0.0, 0, 0.12, 0.11, 0.21, 12);
  body.sph(1, c.back, 0, 0.025, -0.01, 0.12, 0.09, 0.2, 12);
  body.sph(1, c.belly, 0, -0.04, 0.02, 0.1, 0.07, 0.19, 10);
  body.sph(1, c.belly, 0, 0.0, 0.2, 0.075 * f, 0.085, 0.07, 10);
  // tabby stripes: thin bands that follow the curve of the back (each a slice of the back's own ellipsoid, a hair bigger), so
  // they lie on the fur instead of sticking out of it
  if (c.stripe) for (let k = 0; k < 4; k++) {
    const z = -0.12 + k * 0.07, f = Math.sqrt(Math.max(0, 1 - (z / 0.2) ** 2));
    body.cap(1, c.stripe, 0, 0.025, z, 0.1215 * f, 0.0915 * f, 0.011, Math.PI * 0.36);
  }
  // head (pivot at the neck)
  // a round head with chubby cheeks, a little muzzle, big shiny eyes set low and wide, a tiny pink nose: cute, not spooky
  head.sph(1, c.head, 0, 0.0, 0.0, 0.1 * f, 0.09, 0.088, 14);
  for (const s of [-1, 1]) head.sph(1, c.head, s * 0.04, -0.03, 0.03, 0.055 * f, 0.048, 0.055, 10);          // cheeks
  head.sph(1, c.muzzle, 0, -0.03, 0.062, 0.042, 0.03, 0.036, 10);
  head.sph(1, '#e39aa0', 0, -0.014, 0.094, 0.011, 0.008, 0.007, 6);
  for (const s of [-1, 1]) {
    head.cyl(0, 0.034, 0.072, c.ear, s * 0.055, 0.072, -0.012, 1, 0.55, 4, 0, 0, -s * 0.24);
    head.cyl(0, 0.02, 0.045, '#e3b0b0', s * 0.055, 0.066, -0.004, 1, 0.35, 4, 0, 0, -s * 0.24);               // pink inside the ear
    head.sph(1, c.eye, s * 0.038, 0.01, 0.066, 0.02, 0.023, 0.01, 10);
    head.sph(1, '#101010', s * 0.038, 0.01, 0.073, 0.011, 0.017, 0.005, 8);
    head.sph(1, '#ffffff', s * 0.038 + 0.006, 0.019, 0.077, 0.0045, 0.0045, 0.002, 5);                         // the catchlight
    if (c.stripe) head.sph(1, c.stripe, s * 0.016, 0.06, 0.05, 0.007, 0.024, 0.012, 6);                       // the "M" on a tabby's forehead
  }
  head.sph(1, c.muzzle, 0, 0.03, 0.068, 0.022, 0.012, 0.016, 8);      // forehead blaze (ragdolls) / lighter nose bridge
  // tail
  // in two pieces, so it can curve: up and over at the tip when awake, round the body when asleep
  tail.cyl(0.026 * f, 0.034 * f, 0.17, c.tail, 0, 0.085, 0, 1, 1, 8);
  tail.sph(1, c.tail, 0, 0.17, 0, 0.026 * f, 0.026 * f, 0.026 * f, 8);
  tip.cyl(0.017 * f, 0.026 * f, 0.15, c.tail, 0, 0.075, 0, 1, 1, 8);
  tip.sph(1, c.stripe ?? c.tail, 0, 0.15, 0, 0.018 * f, 0.022, 0.018 * f, 6);

  const root = new THREE.Group(), torso = new THREE.Group();
  const bm = body.build(shadows), hm = head.build(shadows), tm = tail.build(shadows);
  torso.position.set(0, 0.255, -0.0);
  bm.position.set(0, 0, 0);
  torso.add(bm);
  const hg = new THREE.Group(); hg.position.set(0, 0.05, 0.22); hg.add(hm); torso.add(hg);
  const tg = new THREE.Group(); tg.position.set(0, 0.03, -0.2); tg.rotation.order = 'YXZ'; tg.rotation.x = -1.05; tg.add(tm); torso.add(tg);
  const tt = new THREE.Group(); tt.position.set(0, 0.17, 0); tt.add(tip.build(shadows)); tg.add(tt);
  root.add(torso);
  const legs: THREE.Group[] = [];
  // the legs hang from the body itself (shoulders and hips inside it), so however the body tilts, sits or crouches they stay
  // joined on; `poseLeg` keeps them reaching the ground
  for (const [lx, lz] of [[-0.06, 0.15], [0.06, 0.15], [-0.06, -0.15], [0.06, -0.15]]) {
    const m = new Mesher();
    m.cyl(0.026, 0.02, 0.2, c.leg, 0, -0.1, 0, 1, 1, 7);
    m.sph(1, c.paw, 0, -0.205, 0.012, 0.027, 0.02, 0.036, 7);
    // a rounded shoulder / haunch where the leg meets the body
    if (lz < 0) m.sph(1, c.side, 0, -0.035, -0.005, 0.042 * f, 0.07, 0.065, 8); else m.sph(1, c.side, 0, -0.03, 0, 0.034 * f, 0.055, 0.045, 8);
    const lg = new THREE.Group(); lg.position.set(lx, LEG_TOP, lz); lg.add(m.build(shadows));
    torso.add(lg); legs.push(lg);
  }
  root.rotation.order = 'YXZ';
  return { root, torso, head: hg, tail: tg, tailTip: tt, legs };
}

export class Cats {
  readonly group = new THREE.Group();
  private cats: Cat[] = [];
  /** called when a cat meows: volume 0..1 */
  onMeow: ((v: number) => void) | null = null;
  /** the cat beds in the world (set by main.ts) */
  beds: () => CatBed[] = () => [];
  /** where the cats are (Mario picks one to chase) */
  positions() { return this.cats.map((c) => ({ x: c.x, z: c.z })); }
  /** something scary at (x, z): every cat within r bolts away from it */
  scare(x: number, z: number, r: number) {
    for (const c of this.cats) {
      const d = Math.hypot(c.x - x, c.z - z);
      if (d > r || (c.state === 'zoom' && c.t > 0.5)) continue;
      const a = Math.atan2(c.x - x, c.z - z) + (Math.random() - 0.5) * 0.6;
      c.state = 'zoom'; c.t = 2.2 + Math.random(); c.tx = c.x + Math.sin(a) * 14; c.tz = c.z + Math.cos(a) * 14;
    }
  }
  private tmp = { x: 0, z: 0 };
  private clock = 0;

  constructor(scene: THREE.Scene, private colliders: ColliderGrid, shadows: boolean, private crabs: () => any[]) {
    const rnd = mulberry32(31337), sp = findSpawn();
    COATS.forEach((coat, i) => {
      let x = 0, z = 0;
      for (let tries = 0; tries < 600; tries++) {
        const a = rnd() * Math.PI * 2, r = 22 + rnd() * 30 + i * 18;
        x = sp.x + Math.cos(a) * r; z = sp.z + Math.sin(a) * r;
        const h = heightAt(x, z);
        if (h > 0.9 && h < 6 && slopeAt(x, z, 1.5) < 0.18) break;
      }
      const g = buildCat(coat, shadows);
      const cat: Cat = { coat, ...g, scale: 1.0, x, z, y: heightAt(x, z), yaw: rnd() * 6.28, state: 'idle', t: 2 + rnd() * 3, tx: x, tz: z, speed: 0, phase: rnd() * 6, sit: 0, crouch: 0, greetCd: 6 + i * 25, playCd: 8, crab: null, px: 0, pz: 0, pt: 0, meowCd: 0, lookYaw: 0, hop: 0, bed: null, napCd: 20 + rnd() * 50, lie: 0 };
      this.cats.push(cat); this.group.add(g.root);
    });
    scene.add(this.group);
  }

  /** an easy way for tests and the console to find them */
  get all() { return this.cats; }

  private walkable(x: number, z: number, fromY: number) {
    const h = heightAt(x, z);
    return h > 0.45 && h < 60 && Math.abs(h - fromY) < 0.5;
  }

  private pickWander(c: Cat, px: number, pz: number) {
    for (let k = 0; k < 14; k++) {
      const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 14, x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
      if (heightAt(x, z) > 0.6 && Math.hypot(x - c.x, z - c.z) > 3 && (Math.hypot(x - px, z - pz) > 3 || k > 10)) { c.tx = x; c.tz = z; return; }
    }
    c.tx = c.x; c.tz = c.z;
  }

  private nearestCrab(c: Cat, maxD: number) {
    let best: any = null, bd = maxD;
    for (const a of this.crabs()) {
      if (a.kind !== 'crab' || a.state === 'dead') continue;
      const d = Math.hypot(a.x - c.x, a.z - c.z);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }

  /** move toward (tx, tz) at `speed`; returns the distance left */
  private go(c: Cat, dt: number, tx: number, tz: number, speed: number, turnRate = 6) {
    const dx = tx - c.x, dz = tz - c.z, d = Math.hypot(dx, dz);
    if (d > 0.05) c.yaw = turn(c.yaw, Math.atan2(dx, dz), turnRate * dt);
    const turnErr = Math.abs(Math.atan2(Math.sin(Math.atan2(dx, dz) - c.yaw), Math.cos(Math.atan2(dx, dz) - c.yaw)));
    const sp = speed * (turnErr > 1.2 ? 0.25 : 1);
    const step = Math.min(d, sp * dt);
    let nx = c.x + Math.sin(c.yaw) * step, nz = c.z + Math.cos(c.yaw) * step;
    if (!this.walkable(nx, nz, c.y)) { c.speed = 0; return -1; }
    this.colliders.resolve(nx, nz, 0.2, this.tmp); nx = this.tmp.x; nz = this.tmp.z;
    if (!this.walkable(nx, nz, c.y)) { c.speed = 0; return -1; }
    c.speed = step / Math.max(dt, 1e-4);
    c.x = nx; c.z = nz;
    return d;
  }

  update(dt: number, px: number, pz: number, py: number) {
    dt = Math.min(dt, 0.1);
    this.clock += dt;
    for (const c of this.cats) {
      const dp = Math.hypot(px - c.x, pz - c.z);
      this.group.visible = true;
      c.root.visible = dp < 110;   // a cat further off than this is a speck anyway (about 10 draws each)
      c.greetCd -= dt; c.playCd -= dt; c.meowCd -= dt; c.t -= dt; c.napCd -= dt;
      let lieT = 0;
      c.speed = 0;
      let sitT = 0, crouchT = 0, lookP = false;

      // decisions
      const next = () => {
        // now and then a cat remembers a cat bed it knows (one nobody else is in) and goes for a nap
        if (c.napCd <= 0) {
          const taken = new Set(this.cats.filter((o) => o !== c && o.bed).map((o) => o.bed));
          let best: CatBed | null = null, bd = 80;
          for (const b of this.beds()) { const d = Math.hypot(b.x - c.x, b.z - c.z); if (d < bd && !taken.has(b)) { bd = d; best = b; } }
          c.napCd = 25 + Math.random() * 30;
          if (best && Math.random() < 0.5) { c.state = 'tobed'; c.bed = best; c.t = 60; return; }
        }
        const crab = c.playCd <= 0 ? this.nearestCrab(c, 16) : null;
        if (dp < 32 && dp > 6 && c.greetCd <= 0) { c.state = 'greet'; c.t = 14; return; }
        if (crab && Math.random() < 0.7) { c.state = 'stalk'; c.crab = crab; c.t = 12; return; }
        const r = Math.random();
        if (r < 0.5) { c.state = 'wander'; c.t = 14; this.pickWander(c, px, pz); }
        else if (r < 0.8) { c.state = 'idle'; c.t = 3 + Math.random() * 6; }
        else { c.state = 'zoom'; c.t = 2.5 + Math.random() * 2; const a = Math.random() * 6.28; c.tx = c.x + Math.cos(a) * 12; c.tz = c.z + Math.sin(a) * 12; }
      };
      // a player walking right up to a cat gets a greeting too
      if (c.state !== 'greet' && c.state !== 'visit' && c.state !== 'nap' && c.state !== 'tobed' && dp < 10 && c.greetCd <= 0) { c.state = 'greet'; c.t = 14; }
      // its bed was picked up
      if (c.bed && !this.beds().includes(c.bed)) { c.bed = null; if (c.state === 'nap' || c.state === 'tobed') { c.state = 'idle'; c.t = 2; } }
      if (c.state !== 'nap' && c.state !== 'tobed') c.bed = null;

      switch (c.state) {
        case 'idle': sitT = 1; lookP = dp < 18; if (c.t <= 0) next(); break;
        case 'wander': {
          const d = this.go(c, dt, c.tx, c.tz, 1.1);
          if (d < 0.4 || c.t <= 0) next();
          break;
        }
        case 'zoom': {
          const d = this.go(c, dt, c.tx, c.tz, 5.2, 9);
          if (d < 0.5) { const a = Math.random() * 6.28; c.tx = c.x + Math.cos(a) * 10; c.tz = c.z + Math.sin(a) * 10; }
          if (c.t <= 0) next();
          break;
        }
        case 'greet': {
          const d = this.go(c, dt, px, pz, dp > 8 ? 3.6 : 2.0, 8);
          if (dp < 1.5) { c.state = 'visit'; c.t = 9 + Math.random() * 5; c.lookYaw = 0; if (c.meowCd <= 0) { this.onMeow?.(Math.max(0.15, 1 - dp / 8)); c.meowCd = 3; } }
          else if (d < 0 || c.t <= 0) { c.greetCd = 25; next(); }
          if (dp < 12 && c.meowCd <= 0) { this.onMeow?.(0.6); c.meowCd = 6; }
          break;
        }
        case 'visit': {
          // sit near the player, watching them; if they walk off, tag along a little, then lose interest
          lookP = true; c.yaw = turn(c.yaw, Math.atan2(px - c.x, pz - c.z), 4 * dt);
          if (dp > 3.2) { this.go(c, dt, px, pz, 2.6, 8); } else if (dp < 1.0) { this.go(c, dt, c.x - (px - c.x), c.z - (pz - c.z), 0.8); } else sitT = 1;
          if (c.meowCd <= 0 && dp < 4) { this.onMeow?.(0.7); c.meowCd = 5 + Math.random() * 4; }
          if (c.t <= 0) { c.greetCd = 70 + Math.random() * 40; c.state = 'zoom'; c.t = 2.5; const a = Math.random() * 6.28; c.tx = c.x + Math.cos(a) * 12; c.tz = c.z + Math.sin(a) * 12; }
          break;
        }
        case 'stalk': {
          const a = c.crab;
          if (!a || a.state === 'dead') { c.playCd = 12; next(); break; }
          const d0 = Math.hypot(a.x - c.x, a.z - c.z);
          crouchT = d0 < 6 ? 1 : 0.4;
          const d = this.go(c, dt, a.x, a.z, d0 > 6 ? 2.6 : 0.8, 7);
          if (d0 < 0.75) { c.state = 'pounce'; c.t = 0.5; c.hop = 0; c.px = a.x; c.pz = a.z; }
          else if (d < 0 || c.t <= 0) { c.playCd = 15; next(); }
          break;
        }
        case 'pounce': {
          crouchT = 0.2; c.hop = Math.min(1, c.hop + dt / 0.45);
          const dx = c.px - c.x, dz = c.pz - c.z, l = Math.hypot(dx, dz);
          if (l > 0.2) { c.x += (dx / l) * Math.min(l, 2.4 * dt); c.z += (dz / l) * Math.min(l, 2.4 * dt); c.yaw = turn(c.yaw, Math.atan2(dx, dz), 10 * dt); }
          if (c.hop >= 1) {
            // the crab scuttles off; the cat bats the air, then bounds away
            const a = c.crab; if (a && a.state !== 'dead') { a.state = 'flee'; a.t = 2.5; }
            c.state = 'bat'; c.t = 1.2; c.hop = 0;
          }
          break;
        }
        case 'tobed': {
          // trot straight there (over a doorstep, up onto a table), then turn round once and settle
          const b = c.bed!; const dx = b.x - c.x, dz = b.z - c.z, d = Math.hypot(dx, dz);
          if (d > 0.08) {
            c.yaw = turn(c.yaw, Math.atan2(dx, dz), 6 * dt);
            const st = Math.min(d, (d > 3 ? 2.2 : 1.0) * dt);
            c.x += (dx / d) * st; c.z += (dz / d) * st; c.speed = st / Math.max(dt, 1e-4);
          } else { c.state = 'nap'; c.t = 45 + Math.random() * 90; if (dp < 12) this.onMeow?.(0.25); }
          if (c.t <= 0) { c.state = 'idle'; c.t = 2; }
          break;
        }
        case 'nap': {
          // curled up, nose to tail, slowly breathing; wakes after a while, stretches (sits) and wanders off
          const b = c.bed!; c.x = b.x; c.z = b.z; c.yaw += dt * 0.02 * Math.sin(this.clock * 0.1);
          lieT = 1;
          if (c.t <= 0) { c.napCd = 120 + Math.random() * 150; c.state = 'idle'; c.t = 3; c.bed = null; }
          break;
        }
        case 'bat': sitT = 0.6; lookP = false; c.yaw += Math.sin(this.clock * 9) * 0.01; if (c.t <= 0) { c.playCd = 25 + Math.random() * 20; c.state = 'zoom'; c.t = 2; const a = Math.random() * 6.28; c.tx = c.x + Math.cos(a) * 9; c.tz = c.z + Math.sin(a) * 9; } break;
      }

      // pose
      c.sit += (sitT - c.sit) * Math.min(1, dt * 5);
      c.crouch += (crouchT - c.crouch) * Math.min(1, dt * 6);
      c.phase += c.speed * dt * 7.5;
      c.lie += (lieT - c.lie) * Math.min(1, dt * 2.5);
      // on (or nearly at) a cat bed the cat is on the cushion, wherever the bed stands (a floor, a table)
      const bedNear = c.bed && Math.hypot(c.bed.x - c.x, c.bed.z - c.z) < 0.9;
      const gy = bedNear ? c.bed!.y + 0.07 : heightAt(c.x, c.z);
      c.y += (gy - c.y) * Math.min(1, dt * (bedNear ? 8 : 14));
      const hopY = c.state === 'pounce' ? Math.sin(c.hop * Math.PI) * 0.32 : 0;
      const gallop = c.state === 'zoom' ? 1 : 0;
      c.root.position.set(c.x, c.y + hopY + (gallop ? Math.abs(Math.sin(c.phase)) * 0.05 : 0), c.z);
      // lean with the slope
      const hf = heightAt(c.x + Math.sin(c.yaw) * 0.25, c.z + Math.cos(c.yaw) * 0.25), hb = heightAt(c.x - Math.sin(c.yaw) * 0.25, c.z - Math.cos(c.yaw) * 0.25);
      c.root.rotation.set(-Math.atan2(hf - hb, 0.5) * 0.8, c.yaw, 0);
      const sit = c.sit, cr = c.crouch, sw = Math.min(1, c.speed / 1.4);
      c.torso.position.y = 0.255 - cr * 0.075 - sit * 0.085;
      c.torso.rotation.x = -sit * 0.62 + cr * 0.12 + (c.state === 'pounce' ? -0.35 * c.hop : 0);
      c.torso.position.z = -sit * 0.07;
      // lying curled: the body drops onto the cushion and bends round, legs tucked in, chin on the tail
      const li = c.lie;
      if (li > 0.01) {
        c.torso.position.y -= li * 0.13 * (1 - sit);
        c.torso.rotation.x *= 1 - li;
        c.torso.rotation.z = li * 0.25;
        c.torso.scale.set(1 + li * 0.04 * Math.sin(this.clock * 1.6), 1 + li * 0.05 * Math.sin(this.clock * 1.6), 1 - li * 0.12);
      } else { c.torso.rotation.z = 0; c.torso.scale.set(1, 1, 1); }
      // legs: diagonal pairs swing; sitting folds the hind legs forward and props up the front
      const amp = (gallop ? 0.95 : 0.6) * sw, ph = c.phase;
      const swing = [Math.sin(ph) * amp, Math.sin(ph + Math.PI) * amp, Math.sin(ph + Math.PI) * amp, Math.sin(ph) * amp];
      c.legs.forEach((l, i) => {
        const hind = i >= 2;
        // sitting: front legs straight down under the chest, hind legs folded forward under the haunches; asleep: tucked in
        let ang = swing[i] + (hind ? -sit * 1.35 : -sit * 0.12 - (c.state === 'pounce' ? 0.9 * c.hop : 0));
        if (c.lie > 0.01) ang = ang * (1 - c.lie) + c.lie * (hind ? -1.2 : 1.2);
        poseLeg(l, c.torso, ang, 1 - c.lie * 0.55);
      });
      // head: watches the player when interested, else idles around
      let hy = Math.sin(this.clock * 0.7 + c.phase * 0.1) * 0.25 * (c.state === 'idle' ? 1 : 0.2);
      if (lookP) {
        const want = Math.atan2(px - c.x, pz - c.z) - c.yaw;
        hy = Math.max(-1.0, Math.min(1.0, Math.atan2(Math.sin(want), Math.cos(want))));
      }
      c.head.rotation.y += (hy - c.head.rotation.y) * Math.min(1, dt * 6);
      c.head.rotation.x = sit * 0.55 - cr * 0.15 + (lookP ? Math.max(-0.2, Math.min(0.4, (py - c.y - 0.5) * -0.06)) : 0) + (c.state === 'bat' ? Math.sin(this.clock * 14) * 0.15 : 0);
      // tail: sways; straight up when happy to see you
      if (c.lie > 0.01) { c.head.rotation.x = c.head.rotation.x * (1 - c.lie) + c.lie * 0.45; c.head.rotation.y = c.head.rotation.y * (1 - c.lie) + c.lie * 0.9; }
      const happy = c.state === 'greet' || c.state === 'visit' ? 1 : 0;
      c.tail.rotation.x = -1.05 + happy * -0.45 + cr * 0.6 + (gallop ? 0.2 : 0);
      c.tail.rotation.z = Math.sin(this.clock * (happy ? 3.5 : 1.8) + c.phase) * (0.25 + happy * 0.2) + (c.state === 'stalk' ? Math.sin(this.clock * 10) * 0.3 : 0);
      // asleep: the tail lies along the ground and wraps round the front, its tip twitching now and then
      // (the tail swings out sideways and then forward, so it lies along the cat's flank)
      // the tip curls over (a question mark, more so when happy) and sways a beat behind the base
      c.tailTip.rotation.x = 0.55 + happy * 0.35 - cr * 0.4 - (gallop ? 0.3 : 0);
      c.tailTip.rotation.z = Math.sin(this.clock * (happy ? 3.5 : 1.8) + c.phase - 0.8) * 0.3;
      if (c.lie > 0.01) {
        const li = c.lie;
        c.tail.rotation.x *= 1 - li; c.tail.rotation.z = c.tail.rotation.z * (1 - li) - li * 1.45; c.tail.rotation.y = -li * 0.55;
        // the tip wraps on round the front, twitching now and then
        c.tailTip.rotation.x = c.tailTip.rotation.x * (1 - li) + li * (1.25 + 0.12 * Math.max(0, Math.sin(this.clock * 0.7 + c.phase)) ** 8);
        c.tailTip.rotation.z *= 1 - li;
      } else c.tail.rotation.y = 0;
    }
  }
}
