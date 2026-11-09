// The deep: past the reef the sea floor drops away down a wall into the dark (about 100 m down). No daylight gets there;
// what lives there makes its own light. Shoals of little lantern fish with glowing spots, jellyfish that pulse pink and
// blue, squid with rows of blue lights jetting about, and anglerfish lurking near the floor with a glowing lure. They only
// exist round you while you are down there (a few dozen, made where you are and moved along with you).
// Treasure chests lie scattered on the floor of the abyss (the same places for everybody, from a fixed seed). A faint
// golden glow leaks from under the lid. Bring a submarine close and anyone inside can loot it; a looted chest stands open
// and empty, and fills up again after a while. Multiplayer: looting is an event ('dp'); the looted chests are saved.
import * as THREE from 'three';
import { mulberry32 } from '../core/noise';
import { heightAt, TERRAIN_SIZE } from './island';

/** where the abyss is: sea floor at least this deep (m) */
const DEEP = -55;
/** a chest fills up again this long after it was looted (ms) */
const REFILL = 40 * 60 * 1000;
const CHESTS = 30;
/** sea life further off than this is moved on; it fades in and out over FADE_S seconds */
const LOSE = 46, FADE_S = 1.6;
/** how far out the deep sea floor is drawn (the island's own ground ends at TERRAIN_SIZE / 2) */
const FLOOR_R = 700, FLOOR_STEP = 20;

export interface DeepChest { id: number; x: number; y: number; z: number; yaw: number; lid: THREE.Group; glow: THREE.Object3D[]; looted: number }

type Mats = Record<'wood' | 'band' | 'gold' | 'seam' | 'fishBody' | 'fishGlow' | 'jellyA' | 'jellyB' | 'jellyCore' | 'squid' | 'squidSpot' | 'eye' | 'angler' | 'lure' | 'teeth', THREE.Material>;
let MATS: Mats | null = null;
function mats(): Mats {
  if (MATS) return MATS;
  const std = (c: string, r: number, m = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
  // (glowing: unlit, and not swallowed by the dark water's fog)
  const glow = (c: string, opacity = 1, add = false) => {
    const m = new THREE.MeshBasicMaterial({ color: c, ...(opacity < 1 || add ? { transparent: true, opacity, depthWrite: false } : {}), ...(add ? { blending: THREE.AdditiveBlending } : {}) });
    m.fog = false; return m;
  };
  MATS = {
    wood: std('#6b4a2b', 0.9), band: std('#9a8d74', 0.5, 0.7), gold: glow('#ffcf4a'), seam: glow('#ffb82e'),
    fishBody: std('#1d2833', 0.6), fishGlow: glow('#5ff4ff'),
    jellyA: glow('#ff6fd8', 0.35, true), jellyB: glow('#6fb6ff', 0.35, true), jellyCore: glow('#ffd0f4', 0.7, true),
    squid: std('#8a2f3a', 0.7), squidSpot: glow('#4fa8ff'), eye: glow('#f4fbff'),
    angler: std('#232224', 0.85), lure: glow('#c8ff6a'), teeth: std('#e9e6da', 0.5),
  };
  return MATS;
}

// ------------------------------------------------------------------ the creatures
interface Critter { kind: 'fish' | 'jelly' | 'squid' | 'angler'; g: THREE.Group; x: number; y: number; z: number; yaw: number; v: number; t: number; seed: number; parts?: THREE.Object3D[]; fade: number; glows: { m: THREE.MeshBasicMaterial; base: number }[] }

function fishSchool(M: Mats): THREE.Group {
  const g = new THREE.Group(), body = new THREE.SphereGeometry(1, 8, 6).scale(0.05, 0.045, 0.16), dot = new THREE.SphereGeometry(0.018, 5, 4);
  const tail = new THREE.ConeGeometry(0.05, 0.08, 4).rotateX(-Math.PI / 2).translate(0, 0, 0.19);
  const r = mulberry32(7);
  for (let k = 0; k < 9; k++) {
    const f = new THREE.Group();
    f.position.set((r() - 0.5) * 2.6, (r() - 0.5) * 1.4, (r() - 0.5) * 2.6);
    f.add(new THREE.Mesh(body, M.fishBody), new THREE.Mesh(tail, M.fishBody));
    for (const z of [-0.08, -0.02, 0.04, 0.1]) for (const sd of [-1, 1]) { const d = new THREE.Mesh(dot, M.fishGlow); d.position.set(sd * 0.045, -0.012, z); f.add(d); }
    g.add(f);
  }
  return g;
}
function jelly(M: Mats, blue: boolean): THREE.Group {
  const g = new THREE.Group(), s = 0.5 + Math.random() * 0.5;
  g.add(new THREE.Mesh(new THREE.SphereGeometry(0.5 * s, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), blue ? M.jellyB : M.jellyA));
  g.add(new THREE.Mesh(new THREE.SphereGeometry(0.2 * s, 10, 6).translate(0, 0.08 * s, 0), M.jellyCore));
  for (let k = 0; k < 8; k++) {
    const a = k / 8 * Math.PI * 2, len = (1.2 + Math.random() * 1.2) * s;
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.004, len, 4).translate(0, -len / 2, 0), blue ? M.jellyB : M.jellyA);
    t.position.set(Math.cos(a) * 0.32 * s, 0, Math.sin(a) * 0.32 * s); g.add(t);
  }
  return g;
}
function squid(M: Mats): THREE.Group {
  const g = new THREE.Group();
  // the mantle points forward (-z), the arms trail behind
  g.add(new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.5, 12).rotateX(-Math.PI / 2).translate(0, 0, -0.55), M.squid));
  for (const sd of [-1, 1]) g.add(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.02, 0.3).translate(sd * 0.22, 0, -1.0), M.squid));
  for (const sd of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), M.eye); e.position.set(sd * 0.2, 0.05, 0.25); g.add(e); }
  for (let k = 0; k < 7; k++) for (const sd of [-1, 1]) { const d = new THREE.Mesh(new THREE.SphereGeometry(0.035, 5, 4), M.squidSpot); d.position.set(sd * (0.08 + k * 0.025), -0.12, -0.9 + k * 0.17); g.add(d); }
  for (let k = 0; k < 8; k++) {
    const a = k / 8 * Math.PI * 2, len = 1.1 + (k % 3) * 0.3;
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.008, len, 5).rotateX(Math.PI / 2).translate(0, 0, len / 2), M.squid);
    t.position.set(Math.cos(a) * 0.14, Math.sin(a) * 0.14, 0.3); g.add(t);
  }
  g.scale.setScalar(1.3);
  return g;
}
function angler(M: Mats): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.SphereGeometry(0.55, 14, 10).scale(1, 0.85, 1.1), M.angler));
  g.add(new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.5, 6).rotateX(-Math.PI / 2).translate(0, 0, 0.75), M.angler));
  // the gaping jaw with its needle teeth
  for (let k = 0; k < 9; k++) {
    const a = -0.9 + k * 0.225;
    const t = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.16, 4).rotateX(Math.PI), M.teeth); t.position.set(Math.sin(a) * 0.38, -0.05, -0.5 + (1 - Math.cos(a)) * 0.25); g.add(t);
    const b = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.14, 4), M.teeth); b.position.set(Math.sin(a) * 0.36, -0.28, -0.46 + (1 - Math.cos(a)) * 0.25); g.add(b);
  }
  for (const sd of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 5), M.eye); e.position.set(sd * 0.3, 0.22, -0.32); g.add(e); }
  // the rod over its head, and the glowing lure dangling in front of its mouth
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.9, 5).translate(0, 0.45, 0).rotateX(-0.8), M.angler); rod.position.set(0, 0.4, -0.2); g.add(rod);
  const lure = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), M.lure); lure.position.set(0, 0.95, -0.85); g.add(lure);
  const halo = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshBasicMaterial({ color: '#c8ff6a', transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  halo.position.copy(lure.position); g.add(halo);
  return g;
}

// ------------------------------------------------------------------ chests
function chestModel(M: Mats): { g: THREE.Group; lid: THREE.Group; glow: THREE.Object3D[] } {
  const g = new THREE.Group(), W = 0.95, D = 0.6, H = 0.5;
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, to: THREE.Object3D = g) => { const o = new THREE.Mesh(geo, m); to.add(o); return o; };
  add(new THREE.BoxGeometry(W, H, D).translate(0, H / 2, 0), M.wood);
  for (const x of [-0.32, 0.32]) add(new THREE.BoxGeometry(0.07, H + 0.01, D + 0.02).translate(x, H / 2, 0), M.band);
  // gold inside (seen when it stands open, until it is looted)
  const coins = add(new THREE.BoxGeometry(W - 0.1, 0.08, D - 0.1).translate(0, H - 0.08, 0), M.gold);
  const lid = new THREE.Group(); lid.position.set(0, H, D / 2); g.add(lid);
  add(new THREE.CylinderGeometry(D / 2, D / 2, W, 14, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2).translate(0, 0, -D / 2), M.wood, lid);
  for (const x of [-0.32, 0.32]) add(new THREE.CylinderGeometry(D / 2 + 0.01, D / 2 + 0.01, 0.07, 14, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2).translate(x, 0, -D / 2), M.band, lid);
  add(new THREE.BoxGeometry(0.12, 0.14, 0.04).translate(0, -0.04, -D - 0.01), M.band, lid);
  // the glow leaking out under the lid
  const seam = add(new THREE.BoxGeometry(W - 0.04, 0.025, D + 0.005).translate(0, H + 0.005, 0), M.seam);
  return { g, lid, glow: [coins, seam] };
}

export class DeepSea {
  readonly group = new THREE.Group();
  readonly chests: DeepChest[] = [];
  private critters: Critter[] = [];
  private life = new THREE.Group();
  private time = 0;
  /** how deep the eyes are into the dark (0..1, set each frame) */
  private on = false;
  /** all of the sea life together: 1 in the deep, fading to 0 as you leave it */
  private lifeK = 0;
  onEvent: ((e: Record<string, unknown>) => void) | null = null;

  constructor(scene: THREE.Scene) {
    const M = mats();
    scene.add(this.group);
    this.group.add(this.life);
    this.life.visible = false;
    // (their glowing parts get Babylon's glow layer round them: see main)
    this.life.userData.babylonTag = { deepGlow: true };
    // ---- the chests: spread round the abyss, each at its own bearing (fixed seed: the same for everybody)
    const r = mulberry32(48151);
    for (let i = 0; i < CHESTS; i++) {
      const a = (i / CHESTS) * Math.PI * 2 + (r() - 0.5) * 0.25;
      let at: [number, number] | null = null;
      for (let d = 240; d < 600; d += 2) {
        const x = Math.cos(a) * d, z = Math.sin(a) * d;
        if (heightAt(x, z) > DEEP - 10) continue;
        // (anywhere from the foot of the wall out to the far deep)
        const d2 = Math.min(600, d + 6 + r() * (600 - d)), x2 = Math.cos(a) * d2, z2 = Math.sin(a) * d2;
        // (somewhere fairly level on the floor)
        if (heightAt(x2, z2) < DEEP - 10 && Math.abs(heightAt(x2 + 1, z2) - heightAt(x2 - 1, z2)) < 1.6) at = [x2, z2];
        break;
      }
      if (!at) continue;
      const [x, z] = at, y = heightAt(x, z) - 0.05, yaw = r() * Math.PI * 2;
      const c = chestModel(M);
      c.g.position.set(x, y, z);
      c.g.rotation.set((heightAt(x, z + 0.5) - heightAt(x, z - 0.5)) * -0.6, yaw, (heightAt(x + 0.5, z) - heightAt(x - 0.5, z)) * 0.6, 'YXZ');
      this.group.add(c.g);
      this.chests.push({ id: i, x, y, z, yaw, lid: c.lid, glow: c.glow, looted: 0 });
    }
    // ---- the floor of the deep beyond the island's own ground (which ends 380 m out): on to the edge of the world
    {
      const n = (FLOOR_R * 2) / FLOOR_STEP, pos: number[] = [], idx: number[] = [], v = (i: number, j: number) => j * (n + 1) + i;
      for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) { const x = -FLOOR_R + i * FLOOR_STEP, z = -FLOOR_R + j * FLOOR_STEP; pos.push(x, heightAt(x, z), z); }
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const x0 = -FLOOR_R + i * FLOOR_STEP, z0 = -FLOOR_R + j * FLOOR_STEP;
        // (not where the island's own ground is)
        if (x0 >= -TERRAIN_SIZE / 2 && x0 + FLOOR_STEP <= TERRAIN_SIZE / 2 && z0 >= -TERRAIN_SIZE / 2 && z0 + FLOOR_STEP <= TERRAIN_SIZE / 2) continue;
        idx.push(v(i, j), v(i, j + 1), v(i + 1, j), v(i + 1, j), v(i, j + 1), v(i + 1, j + 1));
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      const floor = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: '#6b604c', roughness: 1, metalness: 0 }));
      floor.frustumCulled = false;
      this.group.add(floor);
    }
    // ---- the creatures (placed round you when you come down)
    const add = (kind: Critter['kind'], g: THREE.Group, n: number) => {
      for (let k = 0; k < n; k++) {
        const gg = k === 0 ? g : g.clone();
        // (each creature's glowing parts get their own copy of the glow material, so each one fades on its own, glow and all)
        const own = new Map<THREE.Material, THREE.MeshBasicMaterial>(), glows: Critter['glows'] = [];
        gg.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh || !(m.material instanceof THREE.MeshBasicMaterial)) return;
          let c = own.get(m.material);
          if (!c) { c = m.material.clone(); c.transparent = true; c.depthWrite = false; own.set(m.material, c); glows.push({ m: c, base: m.material.opacity }); }
          m.material = c;
        });
        this.life.add(gg);
        this.critters.push({ kind, g: gg, x: 0, y: -1e4, z: 0, yaw: 0, v: 0, t: Math.random() * 10, seed: Math.random() * 100, fade: 0, glows });
      }
    };
    add('fish', fishSchool(M), 5);
    for (let k = 0; k < 7; k++) add('jelly', jelly(M, k % 2 === 1), 1);
    add('squid', squid(M), 3);
    add('angler', angler(M), 3);
    for (const c of this.critters) c.parts = [...c.g.children];
  }

  /** is the sea floor here part of the abyss? */
  static isDeep(x: number, z: number) { return heightAt(x, z) < DEEP; }

  /** `eye`: where you are looking from; `deep`: 0..1 how far down into the dark */
  update(dt: number, eye: { x: number; y: number; z: number }, deep: number) {
    this.time += dt;
    const t = this.time;
    // looted chests fill up again in time
    const now = Date.now();
    for (const c of this.chests) {
      const open = c.looted > 0 && now - c.looted < REFILL;
      const want = open ? -1.9 : 0;
      c.lid.rotation.x += (want - c.lid.rotation.x) * Math.min(1, dt * 2);
      for (const o of c.glow) o.visible = !open;
    }
    const on = deep > 0.15 && heightAt(eye.x, eye.z) < DEEP + 15;
    if (on !== this.on) { this.on = on; if (on) { this.life.visible = true; for (const c of this.critters) { c.y = -1e4; c.fade = 0; } } }
    // (leaving the deep: they fade away rather than vanish)
    this.lifeK = Math.max(0, Math.min(1, this.lifeK + (on ? dt : -dt) / FADE_S));
    if (!on && this.lifeK <= 0) { this.life.visible = false; return; }
    for (const c of this.critters) {
      // too far from you (or never placed): somewhere new round you, in the open water over the abyss
      const dist = Math.hypot(c.x - eye.x, c.y - eye.y, c.z - eye.z);
      const far = on && dist > LOSE;
      if (far) {
        let ok = false;
        for (let k = 0; k < 8 && !ok; k++) {
          const a = Math.random() * Math.PI * 2, d = 12 + Math.random() * 22, x = eye.x + Math.cos(a) * d, z = eye.z + Math.sin(a) * d, fl = heightAt(x, z);
          if (fl > DEEP) continue;
          const lo = fl + (c.kind === 'angler' ? 1.2 : 4), hi = Math.min(-30, eye.y + 14);
          if (hi <= lo) continue;
          c.x = x; c.z = z; c.y = c.kind === 'angler' ? lo + Math.random() * 2 : lo + Math.random() * (hi - lo); c.yaw = Math.random() * Math.PI * 2;
          c.v = c.kind === 'fish' ? 1.6 : c.kind === 'squid' ? 0.8 : c.kind === 'jelly' ? 0.15 : 0.25;
          ok = true;
        }
        if (!ok) { c.g.visible = false; continue; }
        c.g.visible = true;
        c.fade = 0;
      }
      // fading in when it turns up, and out again as it drifts off into the dark (before it is moved on)
      c.fade = Math.min(1, c.fade + dt / FADE_S);
      const k = c.fade * this.lifeK * Math.max(0, Math.min(1, (LOSE - Math.hypot(c.x - eye.x, c.y - eye.y, c.z - eye.z)) / 8));
      c.g.userData.fade = k;
      for (const gm of c.glows) gm.m.opacity = gm.base * k;
      c.t += dt;
      // wander: a slow turn, and (squid) a pulse of the jet now and then
      c.yaw += Math.sin(c.t * 0.3 + c.seed) * 0.25 * dt;
      let v = c.v;
      if (c.kind === 'squid') v = c.v * (0.3 + 2.4 * Math.max(0, Math.sin(c.t * 1.4 + c.seed)) ** 4);
      const nx = c.x - Math.sin(c.yaw) * v * dt, nz = c.z - Math.cos(c.yaw) * v * dt;
      // (they stay over the abyss and off the floor)
      if (heightAt(nx, nz) < DEEP) { c.x = nx; c.z = nz; } else c.yaw += Math.PI * dt;
      const floor = heightAt(c.x, c.z);
      if (c.kind === 'jelly') c.y += Math.max(0, Math.sin(c.t * 1.6 + c.seed)) * 0.25 * dt - 0.04 * dt;
      else c.y += Math.sin(c.t * 0.5 + c.seed) * 0.12 * dt;
      c.y = Math.max(floor + (c.kind === 'angler' ? 0.9 : 2.5), Math.min(-12, c.y));
      c.g.position.set(c.x, c.y, c.z);
      c.g.rotation.set(0, c.yaw, 0);
      if (c.kind === 'jelly') { const p = 1 + 0.18 * Math.sin(c.t * 1.6 + c.seed); c.g.scale.set(p, 2 - p, p); }
      if (c.kind === 'fish') c.parts!.forEach((f, k) => { f.position.y += Math.sin(t * 2 + k + c.seed) * 0.003; f.rotation.y = Math.sin(t * 6 + k) * 0.15; });
      if (c.kind === 'angler') c.g.rotation.x = Math.sin(t * 0.7 + c.seed) * 0.05;
    }
  }

  // ------------------------------------------------------------------ looting
  /** the nearest unlooted chest within `max` of a point, or null */
  near(x: number, y: number, z: number, max: number): DeepChest | null {
    let best: DeepChest | null = null, bd = max;
    const now = Date.now();
    for (const c of this.chests) {
      if (c.looted > 0 && now - c.looted < REFILL) continue;
      const d = Math.hypot(c.x - x, (c.y + 0.3 - y) * 0.8, c.z - z);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }
  /** open it up and take what's inside (the loot, for whoever opened it); others hear it was looted */
  loot(c: DeepChest, remote = false, at = Date.now()) {
    c.looted = at;
    if (!remote) this.onEvent?.({ i: c.id, t: at });
  }
  /** what a deep chest holds */
  static treasure(): [string, number][] {
    const r = Math.random, n = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
    const out: [string, number][] = [['diamond', n(2, 5)], ['metal', n(8, 20)], ['coal', n(4, 10)]];
    const ARMOR = ['diamond_helmet', 'diamond_chestplate', 'diamond_greaves'];
    if (r() < 0.45) out.push([ARMOR[Math.floor(r() * 3)], 1]);
    if (r() < 0.3) out.push(['diamond_pickaxe', 1]);
    if (r() < 0.5) out.push(['leather', n(3, 8)]);
    if (r() < 0.5) out.push(['cooked_fish', n(2, 5)]);
    return out;
  }

  // ------------------------------------------------------------------ save, network
  capture(): [number, number][] { return this.chests.filter((c) => c.looted > 0 && Date.now() - c.looted < REFILL).map((c) => [c.id, c.looted]); }
  restore(rows: unknown) {
    for (const c of this.chests) c.looted = 0;
    if (Array.isArray(rows)) for (const r of rows) if (Array.isArray(r)) { const c = this.chests.find((q) => q.id === r[0]); if (c && Number.isFinite(+r[1])) c.looted = +r[1]; }
  }
  net(e: Record<string, unknown>) {
    const c = this.chests.find((q) => q.id === e.i);
    if (c) this.loot(c, true, Number.isFinite(e.t as number) ? (e.t as number) : Date.now());
  }
}
