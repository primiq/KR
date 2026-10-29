// The Stalker: a tall black shape that only comes at night. It stands half behind a tree trunk and watches you with pale eyes.
// Get close, or hit it, and it bolts into the dark. The host simulates; clients just mirror the rows it sends.
// Babylon port: Castaway's code, drawn by render/mirror.ts.
import * as THREE from 'three';
import { Mesher } from '../net/playerModel';
import { heightAt } from '../world/island';
import type { Collider, ColliderGrid } from '../world/vegetation';

export type StalkerSound = 'creep' | 'hiss';
type SState = 'hidden' | 'peek' | 'flee';
const CODES: SState[] = ['hidden', 'peek', 'flee'];
const POOL = 2;
const RUN = 11.5;          // faster than a sprinting player
const SPOOK = 4.2;         // gets this close and it bolts

interface Stalker {
  root: THREE.Group; body: THREE.Mesh; eyes: THREE.Mesh;
  state: SState; x: number; z: number; y: number; yaw: number; t: number;
  tree: Collider | null; side: number; out: number; outTo: number; near: number; sound: number; hits: number; fx: number; fz: number; fade: number;
  net?: { x: number; z: number; yaw: number; st: number; out: number };
}

function build(shadows: boolean) {
  const m = new Mesher();
  const k = '#050608';
  for (const sx of [-1, 1]) {
    m.cyl(0.055, 0.04, 1.05, k, sx * 0.09, 0.52, 0, 1, 1, 6);                       // legs
    m.cyl(0.04, 0.03, 1.15, k, sx * 0.27, 1.12, 0.03, 1, 1, 6, 0, 0, sx * 0.07);    // arms hang past the knees
  }
  m.box(0.34, 0.78, 0.17, k, 0, 1.42, 0);                                            // torso
  m.cyl(0.05, 0.06, 0.2, k, 0, 1.88, 0.01, 1, 1, 6);                                 // neck
  m.sph(0.14, k, 0, 2.06, 0.02, 0.85, 1.3, 0.95, 10);                                // long head
  const body = m.build(false);
  body.material = new THREE.MeshBasicMaterial({ color: 0x050608 });
  body.castShadow = false;
  const e = new Mesher();
  for (const sx of [-1, 1]) e.sph(0.04, '#fff6c4', sx * 0.058, 2.1, 0.135, 1.5, 0.8, 0.7, 6, 0, 0, sx * -0.3);
  const eyes = e.build(false);
  const em = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.97, 0.7).multiplyScalar(2.2), fog: false });
  em.toneMapped = false;
  eyes.material = em;
  void shadows;
  return { body, eyes };
}

export class Stalkers {
  readonly group = new THREE.Group();
  readonly list: Stalker[] = [];
  remote = false;
  onSound: ((s: StalkerSound, x: number, z: number) => void) | null = null;
  onBlood: ((x: number, y: number, z: number, n: number) => void) | null = null;
  nearFire: ((x: number, z: number, r: number) => boolean) | null = null;
  private clock = 0;
  private cool = 25;
  private tmp: Collider[] = [];

  constructor(scene: THREE.Object3D, private colliders: ColliderGrid) {
    for (let i = 0; i < POOL; i++) {
      const root = new THREE.Group();
      const { body, eyes } = build(false);
      root.add(body, eyes);
      root.visible = false;
      this.group.add(root);
      this.list.push({ root, body, eyes, state: 'hidden', x: 0, z: 0, y: 0, yaw: 0, t: 0, tree: null, side: 1, out: 0, outTo: 0.2, near: 0, sound: 0, hits: 0, fx: 0, fz: 1, fade: 0 });
    }
    scene.add(this.group);
  }

  indexOf(s: Stalker) { return this.list.indexOf(s); }
  /** anything visible right now (for the HUD / tests) */
  get active() { return this.list.filter((s) => s.state !== 'hidden').length; }

  /** Host / solo. `targets` are the players on the island surface. */
  update(dt: number, targets: { x: number; y: number; z: number }[], night: boolean) {
    this.clock += dt;
    const sdt = Math.min(dt, 0.1);
    if (this.remote) { for (const s of this.list) this.puppet(s, sdt); return; }
    this.cool -= sdt;
    let want = night && this.cool <= 0 && targets.length > 0;
    for (const s of this.list) {
      if (s.state === 'hidden') continue;
      want = false;
      this.think(s, sdt, targets, night);
    }
    if (want) this.trySpawn(targets);
    // a second one can show up later in the night, when nothing is out
    for (const s of this.list) this.apply(s);
  }

  private nearest(s: Stalker, targets: { x: number; z: number }[]) {
    let best = targets[0], bd = Infinity;
    for (const t of targets) { const d = Math.hypot(t.x - s.x, t.z - s.z); if (d < bd) { bd = d; best = t; } }
    return { t: best, d: bd };
  }

  private trySpawn(targets: { x: number; y: number; z: number }[]) {
    const s = this.list.find((q) => q.state === 'hidden');
    if (!s) return;
    const T = targets[Math.floor(Math.random() * targets.length)];
    if (Math.abs(T.x) > 5e5) { this.cool = 8; return; } // that player is underground / in a side room
    const cand = this.colliders.near(T.x, T.z, 24, (this.tmp.length = 0, this.tmp)).filter((c) => {
      const d = Math.hypot(c.x - T.x, c.z - T.z);
      return d > 11 && c.r > 0.18 && c.r < 0.75 && heightAt(c.x, c.z) > 0.9 && !this.nearFire?.(c.x, c.z, 16);
    });
    if (!cand.length) { this.cool = 6; return; }
    const c = cand[Math.floor(Math.random() * cand.length)];
    s.tree = c; s.side = Math.random() < 0.5 ? -1 : 1;
    s.out = -0.12; s.outTo = 0.03 + Math.random() * 0.08; s.hits = 0;
    s.state = 'peek'; s.t = 0; s.near = 0; s.sound = 3 + Math.random() * 5; s.fade = 0;
    this.place(s, T);
  }

  /** Stand half behind the trunk, as seen from the player. */
  private place(s: Stalker, T: { x: number; z: number }) {
    const c = s.tree!;
    const ux = T.x - c.x, uz = T.z - c.z, d = Math.hypot(ux, uz) || 1;
    const nx = ux / d, nz = uz / d, px = -nz * s.side, pz = nx * s.side;
    const lat = c.r + 0.07 + s.out, back = c.r * 0.5;
    s.x = c.x - nx * back + px * lat; s.z = c.z - nz * back + pz * lat;
    s.y = heightAt(s.x, s.z);
    s.yaw = Math.atan2(T.x - s.x, T.z - s.z);
    s.fx = nx; s.fz = nz;
  }

  private think(s: Stalker, dt: number, targets: { x: number; y: number; z: number }[], night: boolean) {
    s.t += dt;
    const { t: T, d } = this.nearest(s, targets);
    if (s.state === 'peek') {
      s.out += (s.outTo - s.out) * Math.min(1, dt * 0.7);
      this.place(s, T);
      // creepy noise every so often while it is near
      s.sound -= dt;
      if (s.sound <= 0 && d < 30) { this.onSound?.('creep', s.x, s.z); s.sound = 6 + Math.random() * 8; }
      if (s.t > 0.9) s.near += d < SPOOK ? dt : -s.near * dt; // spooked when someone walks up on it
      const gone = !night || this.nearFire?.(s.x, s.z, 12) || d > 40 || s.t > 16 + (s.hits ? 0 : 6);
      if (s.near > 0.25 || d < 2.2 || gone) this.bolt(s, T, gone ? 0.4 : 1);
      return;
    }
    // flee: run straight away from whoever scared it, then dissolve in the dark
    const sp = RUN * (s.hits ? 1.15 : 1);
    s.x += s.fx * sp * dt; s.z += s.fz * sp * dt;
    const gy = heightAt(s.x, s.z);
    if (gy < 0.2) { s.fx = -s.fx; s.fz = -s.fz; } // never into the sea
    s.y = gy;
    s.yaw = Math.atan2(s.fx, s.fz);
    s.fade += dt;
    if (d > 38 || s.fade > 3.2) { s.state = 'hidden'; s.tree = null; this.cool = 55 + Math.random() * 70 + (s.hits >= 2 ? 90 : 0); }
  }

  private bolt(s: Stalker, T: { x: number; z: number }, calm: number) {
    s.state = 'flee'; s.fade = 0;
    let dx = s.x - T.x, dz = s.z - T.z; const d = Math.hypot(dx, dz) || 1;
    dx /= d; dz /= d;
    // slip off sideways around the trunk first, then away
    s.fx = dx * 0.9 + (-dz) * s.side * 0.45; s.fz = dz * 0.9 + dx * s.side * 0.45;
    const n = Math.hypot(s.fx, s.fz) || 1; s.fx /= n; s.fz /= n;
    this.onSound?.('hiss', s.x, s.z);
    void calm;
  }

  /** Someone swung at it. Returns true when the blow connected. */
  hit(s: Stalker, px: number, pz: number) {
    if (this.remote || s.state === 'hidden') return;
    s.hits++;
    this.onBlood?.(s.x, s.y + 1.4, s.z, 8);
    this.bolt(s, { x: px, z: pz }, 1);
    s.fade = 0;
  }

  raycast(eye: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, reach: number, assist = 1): { s: Stalker; dist: number; point: THREE.Vector3 } | null {
    let best: { s: Stalker; dist: number; point: THREE.Vector3 } | null = null, bt = reach;
    for (const s of this.list) {
      if (s.state === 'hidden') continue;
      const ex = s.x - eye.x, ez = s.z - eye.z;
      if (ex * ex + ez * ez > (reach + 2) ** 2) continue;
      for (const h of [0.5, 1.2, 1.9]) {
        const lx = s.x - eye.x, ly = s.y + h - eye.y, lz = s.z - eye.z;
        const tca = lx * dir.x + ly * dir.y + lz * dir.z;
        const r = (h > 1.7 ? 0.28 : 0.4) * assist, d2 = lx * lx + ly * ly + lz * lz - tca * tca;
        if (d2 > r * r) continue;
        const t = Math.max(0, tca - Math.sqrt(r * r - d2));
        if (t < bt) { bt = t; best = { s, dist: t, point: new THREE.Vector3(eye.x + dir.x * t, eye.y + dir.y * t, eye.z + dir.z * t) }; }
      }
    }
    return best;
  }

  // ------------------------------------------------------------ visuals
  private apply(s: Stalker) {
    const r = s.root;
    r.visible = s.state !== 'hidden';
    if (!r.visible) return;
    r.position.set(s.x, s.y, s.z);
    r.rotation.set(0, s.yaw, 0);
    const k = this.clock;
    if (s.state === 'peek') {
      // a slow lean out from behind the trunk, head cocked
      r.rotation.z = -s.side * (0.08 + Math.sin(k * 0.7 + s.x) * 0.02);
      s.eyes.visible = true;
    } else {
      r.rotation.x = 0.5;
      r.position.y += Math.abs(Math.sin(k * 16)) * 0.14;
      r.scale.set(1, 1, 1);
      // eyes and body stay until it is lost in the dark
      const f = Math.max(0, 1 - Math.max(0, s.fade - 2.4) / 0.8);
      r.scale.setScalar(0.4 + 0.6 * f);
    }
    if (s.state === 'peek') { r.rotation.x = 0; r.scale.set(1, 1, 1); }
  }

  // ------------------------------------------------------------ multiplayer
  exportState(): number[][] {
    const rows: number[][] = [];
    this.list.forEach((s, i) => { if (s.state !== 'hidden') rows.push([i, +s.x.toFixed(2), +s.z.toFixed(2), +s.yaw.toFixed(2), CODES.indexOf(s.state), +s.out.toFixed(2)]); });
    return rows;
  }
  importState(rows: number[][]) {
    const seen = new Set<number>();
    for (const [i, x, z, yaw, st, out] of rows) {
      const s = this.list[i]; if (!s) continue;
      seen.add(i);
      if (s.state === 'hidden') { s.x = x; s.z = z; s.yaw = yaw; }
      s.net = { x, z, yaw, st, out };
    }
    this.list.forEach((s, i) => { if (!seen.has(i) && s.net) s.net.st = 0; });
  }
  private puppet(s: Stalker, dt: number) {
    const n = s.net; if (!n) return;
    const st = CODES[n.st] ?? 'hidden';
    if (st === 'hidden') { if (s.state !== 'hidden') { s.state = 'hidden'; } this.apply(s); return; }
    if (s.state === 'hidden') { s.x = n.x; s.z = n.z; s.fade = 0; }
    const k = Math.min(1, dt * (st === 'flee' ? 9 : 6));
    s.x += (n.x - s.x) * k; s.z += (n.z - s.z) * k;
    let dy = n.yaw - s.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
    s.yaw += dy * k; s.y = heightAt(s.x, s.z);
    if (st === 'flee' && s.state !== 'flee') s.fade = 0;
    if (st === 'flee') s.fade += dt;
    s.state = st; s.out = n.out;
    this.apply(s);
  }
  promote() {
    this.remote = false;
    for (const s of this.list) { s.state = 'hidden'; s.net = undefined; s.root.visible = false; }
    this.cool = 40;
  }
}
