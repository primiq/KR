// Sea turtles. Every day or two, around dusk or dawn, a small group swims in, hauls itself up a sandy beach, digs a nest,
// lays its eggs, covers them and goes back to the sea. The eggs are ordinary pickups (players can take them and eat them);
// the ones left alone hatch half a day later, and the hatchlings mill about the nest for a while before they all scramble
// down the sand and swim away. The host simulates; clients mirror (like the other wildlife). Nests are saved with the world.
// Babylon port: Castaway's code, drawn by render/mirror.ts.
import * as THREE from 'three';
import { Mesher } from '../net/playerModel';
import { heightAt, slopeAt, rockiness, SEA_LEVEL } from '../world/island';

/** adult: 0 swim in, 1 crawl up, 2 dig, 3 lay, 4 cover, 5 crawl back, 6 swim off */
interface Adult { id: number; x: number; z: number; yaw: number; st: number; t: number; nx: number; nz: number; sx: number; sz: number; ex: number; ez: number; nest?: Nest; fx: number }
/** baby: 0 climbing out of the sand, 1 milling about, 2 running for the sea, 3 swimming */
interface Baby { id: number; x: number; z: number; yaw: number; st: number; t: number; tx: number; tz: number; nest: Nest }
interface Nest { x: number; z: number; sx: number; sz: number; hatchAt: number; eggs: string[]; leaveAt?: number }
interface NetA { id: number; x: number; z: number; yaw: number; st: number }

const GAP = [24, 48];          // game hours between groups
const HATCH = 12;              // game hours from laying to hatching
const WINDOWS: [number, number][] = [[5.5, 9], [15.5, 20.5]];   // they come ashore around dawn and dusk

function shell(baby: boolean) {
  const m = new Mesher(), top = baby ? '#2e3a2a' : '#6b5a34', rim = baby ? '#1f281d' : '#4a3d22', skin = baby ? '#3a4636' : '#8a8a6a', belly = baby ? '#c8c2a8' : '#d8c890';
  m.sph(0.5, top, 0, 0.16, 0, 0.78, 0.36, 1, 14);              // carapace
  for (const [x, z] of [[0, -0.18], [0, 0.12], [-0.18, -0.04], [0.18, -0.04], [-0.14, 0.24], [0.14, 0.24]]) m.sph(0.13, rim, x, 0.3, z, 1, 0.25, 1, 6);   // scutes
  m.sph(0.47, belly, 0, 0.1, 0, 0.74, 0.14, 0.95, 10);           // plastron
  m.sph(0.13, skin, 0, 0.17, -0.58, 0.9, 0.8, 1.15, 10);         // head
  m.sph(0.1, skin, 0, 0.13, -0.46, 1, 0.8, 1, 8);                // neck
  for (const s of [-1, 1]) m.sph(0.022, '#111', s * 0.08, 0.22, -0.64, 1, 1, 1, 5);   // eyes
  m.sph(0.07, skin, 0, 0.1, 0.52, 0.7, 0.4, 1.6, 6);             // tail
  return m;
}
function flipper(front: boolean, baby: boolean) {
  const m = new Mesher(), skin = baby ? '#3a4636' : '#8a8a6a';
  m.sph(front ? 0.36 : 0.2, skin, front ? 0.28 : 0.15, 0, 0, 1, 0.12, front ? 0.36 : 0.55, 8);
  return m.build(false);
}

export class Turtles {
  readonly group = new THREE.Group();
  remote = false;
  clock = 0;                 // game hours since the world began (counted from the time of day)
  next = 14;                 // the first group comes on the first evening
  adults: Adult[] = [];
  babies: Baby[] = [];
  nests: Nest[] = [];
  /** host: lay an egg (returns its pickup id), check it is still there, hatch it */
  layEgg: ((x: number, y: number, z: number) => string | null) | null = null;
  eggThere: ((nid: string) => boolean) | null = null;
  takeEgg: ((nid: string) => void) | null = null;
  onSand: ((x: number, y: number, z: number, n: number) => void) | null = null;
  /** a group of turtles has come ashore (x, z of the first one) */
  onArrive: ((x: number, z: number) => void) | null = null;
  private lastHour = -1;
  private ids = 1;
  private bodies = new Map<number, THREE.Group>();
  private babyMesh: THREE.InstancedMesh;
  private mounds: THREE.InstancedMesh;
  private bodyGeo: THREE.Mesh;
  private flips: THREE.Mesh[];
  private netA = new Map<number, NetA>();
  private netB = new Map<number, NetA>();
  private dummy = new THREE.Object3D();
  private seen = 0;

  constructor(scene: THREE.Object3D, private shadows: boolean) {
    this.bodyGeo = shell(false).build(shadows);
    this.flips = [flipper(true, false), flipper(false, false)];
    const b = shell(true);
    for (const s of [-1, 1]) { b.sph(0.36, '#3a4636', s * 0.36, 0.08, -0.16, 1, 0.12, 0.4, 6, 0, s * 0.5); b.sph(0.2, '#3a4636', s * 0.2, 0.08, 0.36, 1, 0.12, 0.5, 6, 0, -s * 0.5); }
    const bm = b.build(false);
    this.babyMesh = new THREE.InstancedMesh(bm.geometry, bm.material as THREE.Material, 64);
    this.babyMesh.count = 0; this.babyMesh.frustumCulled = false;
    const mound = new THREE.SphereGeometry(0.75, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.16, 1);
    this.mounds = new THREE.InstancedMesh(mound, new THREE.MeshStandardMaterial({ color: '#c9ab72', roughness: 1 }), 16);
    this.mounds.count = 0; this.mounds.frustumCulled = false; this.mounds.receiveShadow = shadows;
    this.group.add(this.babyMesh, this.mounds);
    scene.add(this.group);
  }

  get busy() { return this.adults.length > 0 || this.babies.length > 0; }

  // ------------------------------------------------------------------ places
  /** A sandy beach along bearing `theta`: the waterline, a nest site up the sand, and a spot out at sea. */
  private beach(theta: number) {
    const dx = Math.cos(theta), dz = Math.sin(theta);
    let r = 372;
    while (r > 40 && heightAt(dx * r, dz * r) < SEA_LEVEL) r -= 0.5;
    if (r <= 40) return null;
    // a gentle sandy slope: no cliffs, no rocks, the sea right there
    for (let k = 1; k <= 5; k++) { const q = r - k * 2.5; if (slopeAt(dx * q, dz * q) > 0.22 || rockiness(dx * q, dz * q) > 0.25) return null; }
    let d = 5, nx = 0, nz = 0;
    for (; d < 30; d += 0.5) { nx = dx * (r - d); nz = dz * (r - d); const h = heightAt(nx, nz); if (h > 1.0) break; }
    const h = heightAt(nx, nz);
    if (d >= 30 || h > 2.1 || slopeAt(nx, nz) > 0.22 || rockiness(nx, nz) > 0.25) return null;
    let o = 10;
    while (o < 60 && heightAt(dx * (r + o), dz * (r + o)) > -1.0) o += 2;
    return { nx, nz, ex: dx * r, ez: dz * r, sx: dx * (r + o), sz: dz * (r + o) };
  }

  private arrive(players: { x: number; z: number }[]) {
    const near = players.filter((p) => Math.hypot(p.x, p.z) < 420);
    for (let attempt = 0; attempt < 60; attempt++) {
      // usually somewhere a player might see them, otherwise anywhere round the island
      const p = near.length && attempt < 40 ? near[Math.floor(Math.random() * near.length)] : null;
      const base = p ? Math.atan2(p.z, p.x) + (Math.random() - 0.5) * 0.9 : Math.random() * Math.PI * 2;
      const first = this.beach(base);
      if (!first) continue;
      const n = 3 + Math.floor(Math.random() * 3), R = Math.hypot(first.ex, first.ez);
      const spots = [first];
      for (let i = 1; spots.length < n && i < n * 3; i++) {
        const b = this.beach(base + ((i % 2 ? 1 : -1) * Math.ceil(i / 2) * (4 + Math.random() * 2.5)) / R);
        if (b) spots.push(b);
      }
      if (spots.length < 2) continue;
      for (const s of spots) {
        const a: Adult = { id: this.ids++, x: s.sx, z: s.sz, yaw: 0, st: 0, t: -Math.random() * 10, nx: s.nx + (Math.random() - 0.5) * 1.5, nz: s.nz + (Math.random() - 0.5) * 1.5, sx: s.sx, sz: s.sz, ex: s.ex, ez: s.ez, fx: 0 };
        a.yaw = Math.atan2(-(a.ex - a.x), -(a.ez - a.z));
        this.adults.push(a);
      }
      this.onArrive?.(first.ex, first.ez);
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ simulation
  update(dt: number, hour: number, players: { x: number; z: number }[]) {
    const sdt = Math.min(dt, 0.1);
    if (this.lastHour >= 0) { let dh = hour - this.lastHour; if (dh < 0) dh += 24; if (dh < 14) this.clock += dh; }
    this.lastHour = hour;
    if (this.remote) { this.puppet(sdt); this.draw(); return; }

    if (this.clock >= this.next && !this.adults.length && WINDOWS.some(([a, b]) => hour >= a && hour < b)) {
      this.next = this.clock + GAP[0] + Math.random() * (GAP[1] - GAP[0]);
      if (!this.arrive(players)) this.next = this.clock + 2;
    }
    for (let i = this.adults.length - 1; i >= 0; i--) if (this.stepAdult(this.adults[i], sdt)) this.adults.splice(i, 1);

    // nests hatch half a day after laying
    for (let i = this.nests.length - 1; i >= 0; i--) {
      const n = this.nests[i];
      n.eggs = n.eggs.filter((e) => this.eggThere?.(e) ?? true);
      if (!n.eggs.length && n.leaveAt === undefined) { this.nests.splice(i, 1); continue; }   // somebody took them all
      if (n.leaveAt === undefined && this.clock >= n.hatchAt) {
        for (const e of n.eggs) {
          this.takeEgg?.(e);
          const a = Math.random() * Math.PI * 2, r = Math.random() * 0.4;
          this.babies.push({ id: this.ids++, x: n.x + Math.cos(a) * r, z: n.z + Math.sin(a) * r, yaw: Math.random() * 6.28, st: 0, t: -Math.random() * 2, tx: n.x, tz: n.z, nest: n });
        }
        n.eggs = [];
        n.leaveAt = this.clock + 1.6 + Math.random() * 0.8;   // they stay on the beach for a while (a couple of game hours)
        this.onSand?.(n.x, heightAt(n.x, n.z) + 0.1, n.z, 16);
      }
      if (n.leaveAt !== undefined && !this.babies.some((b) => b.nest === n)) this.nests.splice(i, 1);
    }
    for (let i = this.babies.length - 1; i >= 0; i--) if (this.stepBaby(this.babies[i], sdt)) this.babies.splice(i, 1);
    this.draw();
  }

  private move(a: { x: number; z: number; yaw: number }, tx: number, tz: number, speed: number, dt: number, turn = 1.4) {
    const dx = tx - a.x, dz = tz - a.z, d = Math.hypot(dx, dz);
    if (d < 1e-3) return 0;
    const want = Math.atan2(-dx, -dz);
    let dy = want - a.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
    a.yaw += Math.max(-turn * dt, Math.min(turn * dt, dy));
    const s = Math.min(d, speed * dt) * Math.max(0.2, Math.cos(dy));
    a.x -= Math.sin(a.yaw) * s; a.z -= Math.cos(a.yaw) * s;
    return d;
  }

  /** true when the turtle has gone */
  private stepAdult(a: Adult, dt: number) {
    a.t += dt;
    if (a.t < 0) return false;
    const lurch = 0.35 + 0.65 * Math.max(0, Math.sin(a.t * 2.4));   // heave, rest, heave
    switch (a.st) {
      case 0: this.move(a, a.ex, a.ez, 1.1, dt, 0.8); if (heightAt(a.x, a.z) > SEA_LEVEL - 0.15) { a.st = 1; a.t = 0; } break;
      case 1: if (this.move(a, a.nx, a.nz, 0.3 * lurch, dt) < 0.25) { a.st = 2; a.t = 0; } break;
      case 2: case 4:
        a.fx -= dt;
        if (a.fx <= 0) { a.fx = 0.45 + Math.random() * 0.3; const bx = a.x + Math.sin(a.yaw) * 0.6, bz = a.z + Math.cos(a.yaw) * 0.6; this.onSand?.(bx, heightAt(bx, bz) + 0.15, bz, 5); }
        if (a.st === 2 && a.t > 24) { a.st = 3; a.t = 0; }
        if (a.st === 4 && a.t > 9) { a.st = 5; a.t = 0; }
        break;
      case 3:
        if (a.t > 14) {
          // the babies will head for a spot a few metres out past the waterline
          const ox = a.ex - a.x, oz = a.ez - a.z, ol = Math.hypot(ox, oz) || 1;
          const nest: Nest = { x: a.x, z: a.z, sx: a.ex + (ox / ol) * 7, sz: a.ez + (oz / ol) * 7, hatchAt: this.clock + HATCH, eggs: [] };
          const n = 4 + Math.floor(Math.random() * 3);
          for (let i = 0; i < n; i++) {
            const ang = (i / n) * Math.PI * 2 + Math.random() * 0.5, r = 0.12 + Math.random() * 0.22;
            const x = a.x + Math.cos(ang) * r, z = a.z + Math.sin(ang) * r, id = this.layEgg?.(x, heightAt(x, z) + 0.02, z);
            if (id) nest.eggs.push(id);
          }
          if (nest.eggs.length) this.nests.push(nest);
          a.st = 4; a.t = 0;
        }
        break;
      case 5: if (this.move(a, a.ex, a.ez, 0.32 * lurch, dt) < 0.5 || heightAt(a.x, a.z) < SEA_LEVEL - 0.2) { a.st = 6; a.t = 0; } break;
      case 6: if (this.move(a, a.sx, a.sz, 1.2, dt, 0.8) < 1 || a.t > 60) return true; break;
    }
    return false;
  }

  private stepBaby(b: Baby, dt: number) {
    b.t += dt;
    if (b.t < 0) return false;
    switch (b.st) {
      case 0: if (b.t > 2.5) { b.st = 1; b.t = 0; } break;
      case 1:
        if (Math.hypot(b.tx - b.x, b.tz - b.z) < 0.15 || Math.random() < dt * 0.3) { const a = Math.random() * 6.28, r = Math.random() * 3.2; b.tx = b.nest.x + Math.cos(a) * r; b.tz = b.nest.z + Math.sin(a) * r; }
        this.move(b, b.tx, b.tz, 0.18 * (Math.random() < 0.7 ? 1 : 0), dt, 3);
        if (b.nest.leaveAt !== undefined && this.clock >= b.nest.leaveAt + Math.random() * 0.002) { b.st = 2; b.t = 0; b.tx = b.nest.sx + (Math.random() - 0.5) * 5; b.tz = b.nest.sz + (Math.random() - 0.5) * 5; }
        break;
      case 2: this.move(b, b.tx, b.tz, 0.42 + 0.25 * Math.max(0, Math.sin(b.t * 9 + b.id)), dt, 3); if (heightAt(b.x, b.z) < SEA_LEVEL - 0.08 || b.t > 240) { b.st = 3; b.t = 0; } break;
      case 3: {
        const dx = b.tx - b.nest.x, dz = b.tz - b.nest.z, l = Math.hypot(dx, dz) || 1;
        b.x += (dx / l) * 0.5 * dt; b.z += (dz / l) * 0.5 * dt;
        if (b.t > 6) return true;
        break;
      }
    }
    return false;
  }

  // ------------------------------------------------------------------ network
  exportState(): number[][][] {
    if (!this.busy && !this.nests.length) { if (this.seen) { this.seen = 0; return [[], [], []]; } return [] as any; }
    this.seen = 1;
    const r2 = (v: number) => +v.toFixed(2);
    return [
      this.adults.map((a) => [a.id, r2(a.x), r2(a.z), r2(a.yaw), a.t < 0 ? -1 : a.st]),
      this.babies.map((b) => [b.id, r2(b.x), r2(b.z), r2(b.yaw), b.t < 0 ? -1 : b.st]),
      this.nests.filter((n) => n.leaveAt === undefined).map((n) => [r2(n.x), r2(n.z)]),
    ];
  }
  importState(rows: number[][][]) {
    if (!rows.length) return;
    const [A, B, N] = rows;
    const sync = (m: Map<number, NetA>, list: number[][]) => {
      const keep = new Set<number>();
      for (const [id, x, z, yaw, st] of list) { keep.add(id); const o = m.get(id); if (o) { o.st = st; Object.assign(o, { tx: x, tz: z, ty: yaw }); } else m.set(id, { id, x, z, yaw, st, tx: x, tz: z, ty: yaw } as any); }
      for (const id of [...m.keys()]) if (!keep.has(id)) m.delete(id);
    };
    sync(this.netA, A); sync(this.netB, B);
    const was = this.adults.length;
    this.adults = [...this.netA.values()].map((o) => ({ id: o.id, x: o.x, z: o.z, yaw: o.yaw, st: o.st, t: 0, nx: 0, nz: 0, sx: 0, sz: 0, ex: 0, ez: 0, fx: (this.adults.find((a) => a.id === o.id)?.fx ?? 0) }));
    if (!was && this.adults.length) this.onArrive?.(this.adults[0].x, this.adults[0].z);
    this.nests = N.map(([x, z]) => ({ x, z, sx: x, sz: z, hatchAt: Infinity, eggs: [] }));
  }
  private puppet(dt: number) {
    const k = Math.min(1, dt * 6);
    const ease = (o: any) => { o.x += (o.tx - o.x) * k; o.z += (o.tz - o.z) * k; let d = o.ty - o.yaw; while (d > Math.PI) d -= 6.283; while (d < -Math.PI) d += 6.283; o.yaw += d * k; };
    this.netA.forEach(ease); this.netB.forEach(ease);
    for (const a of this.adults) {
      const o = this.netA.get(a.id); if (!o) continue;
      a.x = o.x; a.z = o.z; a.yaw = o.yaw; a.st = o.st; a.t += dt;
      if (a.st === 2 || a.st === 4) { a.fx -= dt; if (a.fx <= 0) { a.fx = 0.5 + Math.random() * 0.3; const bx = a.x + Math.sin(a.yaw) * 0.6, bz = a.z + Math.cos(a.yaw) * 0.6; this.onSand?.(bx, heightAt(bx, bz) + 0.15, bz, 5); } }
    }
    this.babies = [...this.netB.values()].map((o) => ({ id: o.id, x: o.x, z: o.z, yaw: o.yaw, st: o.st, t: 3, tx: 0, tz: 0, nest: null as any }));
  }
  /** Stop mirroring: the host left and this player took over. Whatever is on the beach right now just goes back to sea. */
  promote() {
    this.remote = false; this.netA.clear(); this.netB.clear();
    this.adults = []; this.babies = [];
    this.nests = this.nests.filter((n) => n.eggs.length);
  }

  // ------------------------------------------------------------------ save
  capture() { return { c: +this.clock.toFixed(2), n: +this.next.toFixed(2), nests: this.nests.filter((n) => n.eggs.length).map((n) => [+n.x.toFixed(2), +n.z.toFixed(2), +n.sx.toFixed(1), +n.sz.toFixed(1), +n.hatchAt.toFixed(2), n.eggs]) }; }
  restore(s: any) {
    if (!s) return;
    this.clock = s.c ?? 0; this.next = s.n ?? this.clock + 14;
    this.nests = (s.nests ?? []).map(([x, z, sx, sz, hatchAt, eggs]: any[]) => ({ x, z, sx, sz, hatchAt, eggs }));
    this.adults = []; this.babies = [];
  }

  // ------------------------------------------------------------------ drawing
  private draw() {
    const live = new Set<number>();
    const t = performance.now() / 1000;
    for (const a of this.adults) {
      if (a.st < 0) continue;
      live.add(a.id);
      let g = this.bodies.get(a.id);
      if (!g) {
        g = new THREE.Group();
        g.add(new THREE.Mesh(this.bodyGeo.geometry, this.bodyGeo.material));
        for (const [fx, , front] of [[-1, -1, 1], [1, -1, 1], [-1, 1, 0], [1, 1, 0]]) {
          const f = new THREE.Mesh(this.flips[front ? 0 : 1].geometry, this.flips[front ? 0 : 1].material);
          // front flippers by the head (-z), back ones by the tail
          f.position.set(fx * (front ? 0.3 : 0.24), 0.1, front ? -0.22 : 0.34); f.userData = { fx, front };
          f.castShadow = this.shadows;
          g.add(f);
        }
        (g.children[0] as THREE.Mesh).castShadow = this.shadows;
        this.group.add(g); this.bodies.set(a.id, g);
      }
      const ground = heightAt(a.x, a.z), swim = a.st === 0 || a.st === 6 || ground < SEA_LEVEL - 0.3;
      const fwdx = -Math.sin(a.yaw), fwdz = -Math.cos(a.yaw);
      const pitch = swim ? 0 : Math.atan2(heightAt(a.x + fwdx * 0.5, a.z + fwdz * 0.5) - heightAt(a.x - fwdx * 0.5, a.z - fwdz * 0.5), 1.0);
      const dig = a.st === 2 || a.st === 4, lay = a.st === 3;
      const y = swim ? Math.max(ground, SEA_LEVEL - 0.22) + Math.sin(t * 1.3 + a.id) * 0.03 : ground + (dig ? -0.04 : lay ? -0.12 : 0);
      g.position.set(a.x, y, a.z);
      g.rotation.set(pitch, a.yaw, 0, 'YXZ');
      const crawl = a.st === 1 || a.st === 5;
      for (const f of g.children.slice(1)) {
        const { fx, front } = f.userData as { fx: number; front: number };
        let sw = 0, lift = 0;
        if (swim) { sw = front ? Math.sin(t * 2.2 + a.id) * 0.6 : Math.sin(t * 2.2 + a.id + 1) * 0.3; lift = front ? Math.sin(t * 2.2 + a.id) * 0.4 : 0; }
        else if (crawl) sw = front ? Math.sin(a.t * 2.4) * 0.7 : Math.sin(a.t * 2.4 + 1.2) * 0.4;
        else if (dig) sw = front ? 0.2 : Math.sin(a.t * 6 + fx) * 0.8;
        f.rotation.set(0, (fx < 0 ? Math.PI : 0) + sw * fx, lift);
      }
    }
    for (const [id, g] of this.bodies) if (!live.has(id)) { this.group.remove(g); this.bodies.delete(id); }

    const d = this.dummy;
    let n = 0;
    for (const b of this.babies) {
      if (b.st < 0 || n >= 64) continue;
      const ground = heightAt(b.x, b.z), swim = b.st === 3 || ground < SEA_LEVEL - 0.1;
      const up = b.st === 0 ? Math.min(1, b.t / 2.5) : 1;
      d.position.set(b.x, swim ? Math.max(ground, SEA_LEVEL - 0.06) : ground - 0.06 * (1 - up), b.z);
      d.rotation.set(0, b.yaw + Math.sin(t * 14 + b.id) * 0.18, Math.sin(t * 14 + b.id) * 0.06, 'YXZ');
      d.scale.setScalar(0.11);
      d.updateMatrix();
      this.babyMesh.setMatrixAt(n++, d.matrix);
    }
    this.babyMesh.count = n; this.babyMesh.instanceMatrix.needsUpdate = true;
    let m = 0;
    for (const nest of this.nests) {
      if (nest.leaveAt !== undefined || m >= 16) continue;
      d.position.set(nest.x, heightAt(nest.x, nest.z) - 0.09, nest.z); d.rotation.set(0, 0, 0); d.scale.setScalar(1); d.updateMatrix();
      this.mounds.setMatrixAt(m++, d.matrix);
    }
    this.mounds.count = m; this.mounds.instanceMatrix.needsUpdate = true;
  }
}
