// Far out at sea: now and then a whale passes the island (it blows, rolls its back through the swell a few times, sometimes
// breaches, and dives with its tail up), and very rarely a cargo ship crosses the horizon (lit up at dusk, with a horn as it
// passes). The host (or the solo player) decides when; everybody sees the same whale on the same path (events 'wh' / 'sp').
// Babylon port: Castaway's code, drawn by render/mirror.ts.
import * as THREE from 'three';
import { Mesher } from '../net/playerModel';
import { heightAt } from './island';
import { mulberry32 } from '../core/noise';
import { waveHeight } from './waves';

const BACK = '#3e4b57', BELLY = '#cdd3d6', FIN = '#36424c';

/** a humpback, ~14 m, facing -Z with its middle at the origin */
function buildWhale(): THREE.Mesh {
  const m = new Mesher();
  m.cap(1, BACK, 0, 0, 0, 1.55, 1.35, 5.4, Math.PI / 2);
  m.cap(1, BELLY, 0, -0.02, 0, 1.5, 1.2, 5.3, Math.PI / 2, Math.PI);
  m.cyl(0.4, 1.25, 5.2, BACK, 0, 0.1, 6.6, 1, 0.8, 10, Math.PI / 2);           // tail stock, narrowing to the flukes
  m.cyl(0.0, 0.42, 0.7, FIN, 0, 1.3, 3.4, 0.35, 1, 6, 0.6);                     // small dorsal hump
  for (const s of [-1, 1]) {
    m.box(4.2, 0.16, 0.95, BELLY, s * 3.0, -0.75, -1.6, 0, s * 0.45, s * 0.42); // the long white flippers
    m.box(2.7, 0.18, 1.35, FIN, s * 1.35, 0.1, 9.3, 0, -s * 0.42, 0);           // flukes
  }
  for (let i = 0; i < 5; i++) m.sph(0.16, '#3a4650', (i % 2 ? 0.35 : -0.35), 1.15 - i * 0.03, -4.6 + i * 0.5, 1, 0.6, 1, 6);   // knobbly head
  return m.build(false);
}

/** a cargo ship, ~70 m, facing -Z, waterline at y = 0 */
function buildShip(): { hull: THREE.Mesh; lights: THREE.Group } {
  const m = new Mesher(), HULL = '#1e2c3c';
  m.box(11, 5.4, 56, HULL, 0, 2.2, 0);
  m.box(10.6, 2.2, 55, '#7d2a22', 0, -0.9, 0);                                    // red below the waterline
  m.box(7.8, 5.4, 7.8, HULL, 0, 2.2, -27.5, 0, Math.PI / 4, 0);                   // pointed bow
  m.cyl(5.5, 5.5, 5.4, HULL, 0, 2.2, 28, 1, 0.55, 14);                            // round stern
  m.box(10.6, 0.3, 62, '#5d5f5a', 0, 5.05, -1);
  const pal = ['#c0392b', '#2471a3', '#d4ac0d', '#1e8449', '#e67e22', '#7f8c8d', '#a04000', '#5b2c6f'];
  const rnd = mulberry32(77);
  for (let row = 0; row < 6; row++) for (let col = 0; col < 4; col++) {
    const hgt = 1 + Math.floor(rnd() * 3);
    for (let k = 0; k < hgt; k++) m.box(2.4, 2.5, 6.2, pal[Math.floor(rnd() * pal.length)], -3.75 + col * 2.5, 6.45 + k * 2.6, -21 + row * 6.6);
  }
  m.box(10, 9, 7, '#ecebe4', 0, 9.6, 22);                                          // bridge
  m.box(14.5, 0.5, 2.2, '#ecebe4', 0, 13.8, 19);                                   // bridge wings
  m.box(10.1, 0.9, 0.2, '#22303a', 0, 12.6, 18.45);                                // windows
  m.cyl(1.5, 1.7, 6, '#b2332a', 0, 17, 24.5, 1.3, 1, 10);                          // funnel
  m.cyl(1.52, 1.52, 1.1, '#151515', 0, 20.4, 24.5, 1.3, 1, 10);
  m.cyl(0.18, 0.25, 11, '#d8d8d8', 0, 10.5, -25);                                  // foremast
  const hull = m.build(false);
  // navigation lights (seen at dusk and at night): green to starboard, red to port, white masthead and stern
  const lights = new THREE.Group();
  const lm = (c: string) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const add = (c: string, x: number, y: number, z: number, r = 1.4) => { const s = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), lm(c)); s.position.set(x, y, z); lights.add(s); };
  add('#ffffff', 0, 16.4, -25, 1.6); add('#ffffff', 0, 21.6, 23); add('#33ff66', 7.2, 13.8, 19); add('#ff3333', -7.2, 13.8, 19); add('#ffffff', 0, 6, 33);
  for (let i = 0; i < 6; i++) add('#ffcf7a', -4 + i * 1.6, 10.3, 18.4, 0.55);   // warm cabin windows
  return { hull, lights };
}

interface WhaleEv { at: number; dur: number; kind: 'surf' | 'dive' | 'breach' }
interface WhaleRun { x: number; z: number; h: number; t: number; evs: WhaleEv[]; end: number; blown: Set<number>; splashed: Set<string> }
interface Puff { on: boolean; x: number; y: number; z: number; vx: number; vy: number; vz: number; t: number; life: number; s0: number; s1: number }

const SHIP_R = 720, SHIP_L = 3200, SHIP_V = 8;

export class Offshore {
  readonly group = new THREE.Group();
  /** clients are told by the host */
  remote = false;
  onWhale: ((x: number, z: number, h: number, seed: number) => void) | null = null;
  onShip: ((a: number, dir: number, p: number) => void) | null = null;
  /** sound hooks: v = 0..1 loudness at the listener */
  sound: ((k: 'blow' | 'splash' | 'horn', v: number) => void) | null = null;

  private whale: THREE.Group;
  private run: WhaleRun | null = null;
  private ship: THREE.Group;
  private shipLights: THREE.Group;
  private shipRun: { a: number; dir: number; p: number; honked: boolean } | null = null;
  private smoke: THREE.Mesh[] = [];
  private puffs: Puff[] = [];
  private puffMesh: THREE.InstancedMesh;
  private lastHour = -1;
  private _m = new THREE.Matrix4(); private _q = new THREE.Quaternion(); private _v = new THREE.Vector3(); private _s = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.whale = new THREE.Group(); this.whale.rotation.order = 'YXZ'; this.whale.add(buildWhale()); this.whale.visible = false;
    const { hull, lights } = buildShip();
    this.ship = new THREE.Group(); this.ship.rotation.order = 'YXZ'; this.ship.add(hull, lights); this.ship.visible = false; this.shipLights = lights;
    const sm = new THREE.MeshStandardMaterial({ color: '#4a4a4a', roughness: 1, transparent: true, opacity: 0.55, depthWrite: false });
    for (let i = 0; i < 9; i++) { const s = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), sm); s.frustumCulled = false; this.smoke.push(s); this.ship.add(s); }
    const pm = new THREE.MeshStandardMaterial({ color: '#f4f8fa', roughness: 1, transparent: true, opacity: 0.75, depthWrite: false });
    pm.emissive = new THREE.Color('#5c6670');
    this.puffMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), pm, 80);
    this.puffMesh.frustumCulled = false; this.puffMesh.count = 0; this.puffMesh.renderOrder = 3;
    for (let i = 0; i < 80; i++) this.puffs.push({ on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, t: 0, life: 1, s0: 0, s1: 0 });
    this.group.add(this.whale, this.ship, this.puffMesh);
    scene.add(this.group);
  }

  get whaleActive() { return !!this.run; }
  get shipActive() { return !!this.shipRun; }
  /** for the late-joiner resend */
  get shipState() { return this.shipRun ? { a: this.shipRun.a, d: this.shipRun.dir, p: this.shipRun.p } : null; }

  // ------------------------------------------------------------------ starting things
  /** host: a whale somewhere off the coast, on deep water the whole way */
  private pickWhale(): { x: number; z: number; h: number } | null {
    for (let k = 0; k < 20; k++) {
      const a = Math.random() * Math.PI * 2, r = 190 + Math.random() * 170;
      const x = Math.cos(a) * r, z = Math.sin(a) * r, h = a + (Math.random() < 0.5 ? 1 : -1) * Math.PI / 2 + (Math.random() - 0.5) * 0.6;
      const ok = [0, 60, 120, 200].every((s) => heightAt(x - Math.sin(h) * s, z - Math.cos(h) * s) < -16);
      if (ok) return { x, z, h };
    }
    return null;
  }
  /** start a whale run (also what a client does when told) */
  startWhale(x: number, z: number, h: number, seed: number) {
    const r = mulberry32(seed | 0);
    const evs: WhaleEv[] = [];
    let t = 1;
    const n = 3 + Math.floor(r() * 3), breachAt = r() < 0.35 ? 1 + Math.floor(r() * (n - 1)) : -1;
    for (let i = 0; i < n; i++) {
      if (i === breachAt) { evs.push({ at: t, dur: 7.5, kind: 'breach' }); t += 7.5 + 6 + r() * 4; }
      else { evs.push({ at: t, dur: 9, kind: 'surf' }); t += 9 + 3 + r() * 4; }
    }
    evs.push({ at: t, dur: 13, kind: 'dive' });
    this.run = { x, z, h, t: 0, evs, end: t + 13, blown: new Set(), splashed: new Set() };
    this.whale.visible = true;
    if (!this.remote) this.onWhale?.(x, z, h, seed);
  }
  /** start the ship (a = angle of its closest point to the island, dir = which way round, p = metres along its path) */
  startShip(a: number, dir: number, p = 0) {
    this.shipRun = { a, dir, p, honked: p > SHIP_L / 2 };
    this.ship.visible = true;
    if (!this.remote) this.onShip?.(a, dir, p);
  }
  private pickShip(): { a: number; dir: number } | null {
    for (let k = 0; k < 12; k++) {
      const a = Math.random() * Math.PI * 2, dir = Math.random() < 0.5 ? 1 : -1;
      let ok = true;
      for (let p = 0; p <= SHIP_L && ok; p += 200) { const q = this.shipAt(a, dir, p); if (heightAt(q.x, q.z) > -6) ok = false; }
      if (ok) return { a, dir };
    }
    return null;
  }
  private shipAt(a: number, dir: number, p: number) {
    const cx = Math.cos(a) * SHIP_R, cz = Math.sin(a) * SHIP_R, tx = -Math.sin(a) * dir, tz = Math.cos(a) * dir, s = p - SHIP_L / 2;
    return { x: cx + tx * s, z: cz + tz * s, yaw: Math.atan2(-tx, -tz) };
  }

  /** host: each new hour of the day there's a chance of a whale, and a much smaller one of a ship (fair weather, daylight) */
  tick(hour: number, fair: boolean) {
    const h = Math.floor(hour);
    if (h === this.lastHour) return;
    const first = this.lastHour < 0; this.lastHour = h;
    if (this.remote || first || !fair) return;
    if (!this.run && h >= 6 && h <= 18 && Math.random() < 0.18) { const w = this.pickWhale(); if (w) this.startWhale(w.x, w.z, w.h, Math.floor(Math.random() * 1e9)); }
    if (!this.shipRun && h >= 7 && h <= 16 && Math.random() < 0.035) { const s = this.pickShip(); if (s) this.startShip(s.a, s.dir, 0); }
  }
  /** debug / tests: a whale or the ship in view of (x, z) looking along yaw */
  debugWhale(px: number, pz: number, yaw: number, d = 140) {
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    this.startWhale(px + fx * d, pz + fz * d, yaw + Math.PI / 2, Math.floor(Math.random() * 1e9));
  }

  // ------------------------------------------------------------------ spray
  private puff(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number) {
    const p = this.puffs.find((q) => !q.on); if (!p) return;
    Object.assign(p, { on: true, x, y, z, vx, vy, vz, t: 0, life, s0, s1 });
  }
  private spout(x: number, y: number, z: number) {
    for (let i = 0; i < 22; i++) this.puff(x, y, z, (Math.random() - 0.5) * 1.4, 8 + Math.random() * 5, (Math.random() - 0.5) * 1.4, 2.4 + Math.random(), 0.5, 2.0 + Math.random() * 1.2);
  }
  private splash(x: number, z: number, big: number) {
    for (let i = 0; i < 26 * big; i++) {
      const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 6;
      this.puff(x + Math.cos(a) * 2, 0.3, z + Math.sin(a) * 2, Math.cos(a) * s, 5 + Math.random() * 9 * big, Math.sin(a) * s, 1.6 + Math.random() * 1.2, 0.8, 2.4 + Math.random() * 1.5);
    }
  }

  // ------------------------------------------------------------------ frame
  update(dt: number, me: { x: number; y: number; z: number }, time: number, rough: number, night: number, hidden: boolean) {
    this.group.visible = !hidden;
    dt = Math.min(dt, 0.1);
    const loud = (x: number, z: number, R: number) => Math.max(0, 1 - Math.hypot(x - me.x, z - me.z) / R);
    // ---- the whale
    const w = this.run;
    if (w) {
      w.t += dt;
      const t = w.t, v = 2.8;
      const fx = -Math.sin(w.h), fz = -Math.cos(w.h);
      let along = v * t, y = -7, pitch = 0, roll = 0;
      for (let i = 0; i < w.evs.length; i++) {
        const e = w.evs[i], u = (t - e.at) / e.dur;
        if (u < 0 || u >= 1) continue;
        if (e.kind === 'surf') {
          const k = Math.sin(Math.PI * u);
          y = -7 + 6.9 * Math.pow(k, 0.7); pitch = 0.2 * Math.cos(Math.PI * u);
          if (u > 0.2 && !w.blown.has(i)) { w.blown.add(i); this.blowAt(w, along, y, pitch, loud); }
        } else if (e.kind === 'dive') {
          const tau = t - e.at;
          if (tau < 4) { const k = Math.sin(Math.PI * Math.min(1, tau / 5)); y = -7 + 6.3 * Math.pow(k, 0.7); pitch = 0.18; if (tau > 1.2 && !w.blown.has(i)) { w.blown.add(i); this.blowAt(w, along, y, pitch, loud); } }
          else { const k = Math.min(1, (tau - 4) / 4); y = -0.9 - 1.6 * k - Math.max(0, tau - 7.5) * 3.2; pitch = -1.2 * (k * k * (3 - 2 * k)); }
        } else {
          // breach: up from the deep, out of the water, a twist in the air, down on its side
          const tau = t - e.at;
          if (tau < 1) { y = -12 + 8 * tau; pitch = 1.15; }
          else if (tau < 3.9) { const s = tau - 1; y = -4 + 13.5 * s - 4.9 * s * s; pitch = 1.15 - 1.5 * (s / 2.9); roll = 1.8 * Math.min(1, s / 2.4); along += 6 * s; }
          else { const s = (tau - 3.9) / 3.6; y = -4 - 3 * s; pitch = -0.35 * (1 - s); roll = 1.8 * (1 - s); along += 6 * 2.9; }
          const px = w.x + fx * along, pz = w.z + fz * along;
          if (tau > 1.35 && !w.splashed.has('o' + i)) { w.splashed.add('o' + i); this.splash(px, pz, 0.7); this.sound?.('splash', loud(px, pz, 700) * 0.6); }
          if (tau > 3.55 && !w.splashed.has('i' + i)) { w.splashed.add('i' + i); this.splash(px, pz, 1.4); this.sound?.('splash', loud(px, pz, 700)); }
        }
      }
      const x = w.x + fx * along, z = w.z + fz * along;
      this.whale.position.set(x, y + waveHeight(x, z, time) * 0.6, z);
      this.whale.rotation.set(pitch, w.h, roll);
      if (t >= w.end) { this.run = null; this.whale.visible = false; }
    }

    // ---- the ship
    const s = this.shipRun;
    if (s) {
      s.p += SHIP_V * dt;
      const q = this.shipAt(s.a, s.dir, s.p);
      const swell = 1 + rough * 2;
      this.ship.position.set(q.x, waveHeight(q.x, q.z, time) * 0.25 - 0.2, q.z);
      this.ship.rotation.set(Math.sin(time * 0.31) * 0.012 * swell, q.yaw, Math.sin(time * 0.23 + 1) * 0.02 * swell);
      this.shipLights.visible = night > 0.25;
      // smoke drifting back from the funnel
      for (let i = 0; i < this.smoke.length; i++) {
        const k = ((time * 0.12 + i / this.smoke.length) % 1);
        const sm = this.smoke[i];
        sm.position.set(Math.sin(i * 2.3) * 0.6 * k * 4, 21 + k * 9, 24.5 + k * 34);
        sm.scale.setScalar(1.2 + k * 4.5);
      }
      if (!s.honked && s.p > SHIP_L / 2) { s.honked = true; this.sound?.('horn', loud(q.x, q.z, 1400)); }
      if (s.p >= SHIP_L) { this.shipRun = null; this.ship.visible = false; }
    }

    // ---- spray
    let n = 0;
    for (const p of this.puffs) {
      if (!p.on) continue;
      p.t += dt;
      if (p.t >= p.life) { p.on = false; continue; }
      p.vy -= 6 * dt; p.vx *= 1 - dt * 0.8; p.vz *= 1 - dt * 0.8;
      p.x += p.vx * dt; p.y = Math.max(0, p.y + p.vy * dt); p.z += p.vz * dt;
      const k = p.t / p.life, sc = (p.s0 + (p.s1 - p.s0) * Math.sqrt(k)) * (1 - k * k);
      this._m.compose(this._v.set(p.x, p.y, p.z), this._q, this._s.set(sc, sc, sc));
      this.puffMesh.setMatrixAt(n++, this._m);
    }
    this.puffMesh.count = n;
    if (n) this.puffMesh.instanceMatrix.needsUpdate = true;
  }

  /** the whale breathes out: a tall puff of spray from its blowhole */
  private blowAt(w: WhaleRun, along: number, y: number, pitch: number, loud: (x: number, z: number, R: number) => number) {
    const fx = -Math.sin(w.h), fz = -Math.cos(w.h), ahead = 2.8 * Math.cos(pitch);
    const x = w.x + fx * (along + ahead), z = w.z + fz * (along + ahead);
    this.spout(x, Math.max(0.3, y + 1.4), z);
    this.sound?.('blow', loud(x, z, 450));
  }
}
