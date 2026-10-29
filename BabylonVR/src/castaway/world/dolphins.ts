// Dolphins: every so often one (or a small pod) leaps out of the open sea a good way from the player, arcs through the air and
// dives back in with a ring of splash. Purely cosmetic and local to each client (nothing here needs to match between players).
// Babylon port: Castaway's code, drawn by render/mirror.ts.
import * as THREE from 'three';
import { Mesher } from '../net/playerModel';
import { heightAt } from './island';

const BACK = '#4a6275', BELLY = '#d3dde3', FIN = '#364b5b';

function buildDolphin(): THREE.Group {
  const m = new Mesher();
  // faces -Z, ~2.3 m long; body is an ellipsoid split into a dark back and a pale belly
  m.cap(1, BACK, 0, 0, 0, 0.2, 0.21, 1.05, Math.PI / 2);
  m.cap(1, BELLY, 0, 0, 0, 0.2, 0.2, 1.05, Math.PI / 2, Math.PI);
  m.cyl(0.075, 0.03, 0.34, BELLY, 0, -0.02, -1.18, 1, 1, 8, Math.PI / 2);            // beak
  m.cyl(0.17, 0.05, 0.9, BACK, 0, 0.02, 1.4, 1, 0.9, 8, Math.PI / 2);                // tail stock
  m.cyl(0.0, 0.11, 0.32, FIN, 0, 0.27, 0.15, 0.18, 1, 6, 0.55);                       // dorsal fin
  for (const s of [-1, 1]) {
    m.box(0.3, 0.03, 0.16, FIN, s * 0.26, -0.13, -0.4, 0, s * 0.35, s * 0.6);          // flippers
    m.box(0.3, 0.03, 0.15, FIN, s * 0.17, 0.0, 1.9, 0, -s * 0.5, 0);                    // flukes
  }
  const g = new THREE.Group();
  g.add(m.build(false));
  g.rotation.order = 'YXZ';
  return g;
}

interface Jump { g: THREE.Group; t: number; T: number; H: number; x0: number; z0: number; yaw: number; v: number; spin: number; delay: number; splashed: boolean }
interface Ring { m: THREE.Mesh; t: number; x: number; z: number; y: number; on: boolean }
interface Drop { m: THREE.Mesh; vx: number; vy: number; vz: number; t: number; y0: number }

export class Dolphins {
  readonly group = new THREE.Group();
  private jumps: Jump[] = [];
  private rings: Ring[] = [];
  private drops: Drop[] = [];
  wait = 6 + Math.random() * 10;
  /** scales the pause between jumps (tests use a small value) */
  rate = 1;
  private ringMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide , forceSinglePass: true });
  private dropMat = new THREE.MeshBasicMaterial({ color: '#f2fbff', transparent: true, opacity: 0.85 });
  private dropGeo = new THREE.IcosahedronGeometry(0.07, 0);
  private ringGeo = new THREE.RingGeometry(0.82, 1, 28).rotateX(-Math.PI / 2);
  /** 0 = no dolphins (low-power devices keep their frame budget) */
  enabled = true;

  constructor(scene: THREE.Scene, private surface: (x: number, z: number) => number) {
    this.group.frustumCulled = false;
    for (let i = 0; i < 3; i++) { const g = buildDolphin(); g.visible = false; this.group.add(g); this.jumps.push({ g, t: 1, T: 1, H: 1, x0: 0, z0: 0, yaw: 0, v: 0, spin: 0, delay: 0, splashed: true }); }
    for (let i = 0; i < 6; i++) { const m = new THREE.Mesh(this.ringGeo, this.ringMat.clone()); m.visible = false; m.renderOrder = 3; this.group.add(m); this.rings.push({ m, t: 9, x: 0, z: 0, y: 0, on: false }); }
    for (let i = 0; i < 28; i++) { const m = new THREE.Mesh(this.dropGeo, this.dropMat); m.visible = false; this.group.add(m); this.drops.push({ m, vx: 0, vy: 0, vz: 0, t: 9, y0: 0 }); }
    scene.add(this.group);
  }

  private deepEnough(x: number, z: number) { return heightAt(x, z) < -4; }

  /** where a jump can start: open sea 30..95 m away, preferably somewhere in front of the player */
  private pick(px: number, pz: number, lookYaw: number): { x: number; z: number; yaw: number } | null {
    for (let k = 0; k < 16; k++) {
      const front = Math.random() < 0.7;
      const a = front ? -lookYaw - Math.PI / 2 + (Math.random() - 0.5) * 1.9 : Math.random() * Math.PI * 2;
      const d = 30 + Math.random() * 65;
      const x = px + Math.cos(a) * d, z = pz + Math.sin(a) * d;
      const yaw = Math.random() * Math.PI * 2;
      const ex = x - Math.sin(yaw) * 14, ez = z - Math.cos(yaw) * 14;
      if (this.deepEnough(x, z) && this.deepEnough(ex, ez) && this.deepEnough((x + ex) / 2, (z + ez) / 2)) return { x, z, yaw };
    }
    return null;
  }

  private splash(x: number, z: number, big: number) {
    const r = this.rings.find((q) => !q.on);
    if (r) { r.on = true; r.t = 0; r.x = x; r.z = z; r.y = this.surface(x, z) + 0.05; r.m.visible = true; }
    let n = Math.round(7 * big);
    for (const d of this.drops) {
      if (n <= 0) break;
      if (d.t < 1.4) continue;
      n--;
      const a = Math.random() * Math.PI * 2, s = 0.8 + Math.random() * 1.6;
      d.t = 0; d.vx = Math.cos(a) * s; d.vz = Math.sin(a) * s; d.vy = 2.6 + Math.random() * 2.4 * big; d.y0 = this.surface(x, z);
      d.m.position.set(x, d.y0, z); d.m.visible = true; d.m.userData.x = x; d.m.userData.z = z;
    }
  }

  update(dt: number, px: number, pz: number, lookYaw: number, hidden: boolean) {
    this.group.visible = !hidden;
    if (hidden || !this.enabled) return;
    dt = Math.min(dt, 0.1);
    this.wait -= dt;
    if (this.wait <= 0 && this.jumps.every((j) => j.t >= j.T)) {
      this.wait = (14 + Math.random() * 28) * this.rate;
      const at = this.pick(px, pz, lookYaw);
      if (at) {
        const pod = Math.random() < 0.4 ? 2 : 1, H = 1.4 + Math.random() * 1.5, v = 7 + Math.random() * 3, T = 1.15 + H * 0.2;
        for (let i = 0; i < pod; i++) {
          const j = this.jumps[i];
          j.t = -(i * (0.45 + Math.random() * 0.3)); j.T = T * (0.92 + Math.random() * 0.16); j.H = H * (0.8 + Math.random() * 0.4); j.v = v;
          j.x0 = at.x + Math.cos(at.yaw) * 3.2 * i; j.z0 = at.z - Math.sin(at.yaw) * 3.2 * i; j.yaw = at.yaw + (Math.random() - 0.5) * 0.25;
          j.spin = Math.random() < 0.25 ? (Math.random() < 0.5 ? 1 : -1) : 0; j.splashed = false;
          j.g.visible = false;
        }
      }
    }
    for (const j of this.jumps) {
      if (j.t >= j.T) continue;
      j.t += dt;
      if (j.t < 0) continue;
      const u = Math.min(1, j.t / j.T);
      if (!j.splashed) { j.splashed = true; this.splash(j.x0, j.z0, 1); }
      const dx = -Math.sin(j.yaw), dz = -Math.cos(j.yaw), s = j.v * j.t;
      const x = j.x0 + dx * s, z = j.z0 + dz * s, surf = this.surface(x, z);
      const y = surf + 4 * j.H * u * (1 - u) - 0.55 * (1 - Math.sin(Math.PI * u) * 0.0);
      const vy = 4 * j.H * (1 - 2 * u) / j.T;
      j.g.visible = true;
      j.g.position.set(x, y + 0.15, z);
      j.g.rotation.set(Math.atan2(vy, j.v), j.yaw, j.spin * u * Math.PI * 2);
      if (u >= 1) { j.g.visible = false; this.splash(x, z, 1.2); }
    }
    for (const r of this.rings) {
      if (!r.on) continue;
      r.t += dt;
      const k = r.t / 1.4;
      if (k >= 1) { r.on = false; r.m.visible = false; continue; }
      r.m.position.set(r.x, r.y, r.z); r.m.scale.setScalar(0.4 + k * 3.2);
      (r.m.material as THREE.MeshBasicMaterial).opacity = 0.65 * (1 - k) * (1 - k);
    }
    for (const d of this.drops) {
      if (d.t >= 1.4) { d.m.visible = false; continue; }
      d.t += dt;
      const y = d.y0 + d.vy * d.t - 4.9 * d.t * d.t;
      if (y < d.y0 - 0.05) { d.t = 9; d.m.visible = false; continue; }
      d.m.position.set(d.m.userData.x + d.vx * d.t, y, d.m.userData.z + d.vz * d.t);
    }
  }
}
