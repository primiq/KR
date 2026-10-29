// Giant beach-ball balloons: light, bouncy, rolling spheres that cars (and people) can knock around.
// Simulated locally in the airstrip's own coordinates; in multiplayer the host's state is blended in (see sync).
// Babylon port: Castaway's code, drawn by render/mirror.ts.
import * as THREE from 'three';
import { bodyMaterial } from '../net/playerModel';
import type { Car, Env } from '../game/cars';

export interface Balloon {
  id: number; r: number;
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  q: THREE.Quaternion; mesh: THREE.Mesh;
  /** host state we are easing toward (multiplayer clients) */
  tx?: number; ty?: number; tz?: number;
}
export interface Person { x: number; y: number; z: number; vx: number; vz: number }

const G = 13, E_GROUND = 0.3, E_WALL = 0.7, E_CAR = 0.95, E_BALL = 0.9;
const COLORS = [['#e8423a', '#ffffff'], ['#2f8de4', '#ffffff'], ['#f3c613', '#ffffff'], ['#35b45a', '#ffffff'], ['#a455e6', '#ffffff'], ['#f08a1c', '#ffffff'], ['#18b6b0', '#ffffff'], ['#ec5fa8', '#ffffff']];

function ballGeometry(a: string, b: string) {
  const g = new THREE.SphereGeometry(1, 32, 20);
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3), ca = new THREE.Color(a), cb = new THREE.Color(b);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const ang = Math.atan2(z, x) + Math.PI, wedge = Math.floor((ang / (Math.PI * 2)) * 8) % 8;
    const c = Math.abs(y) > 0.93 ? cb : wedge % 2 ? cb : ca;
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

export class Balloons {
  readonly list: Balloon[] = [];
  /** called with the strength of an impact and where it happened (airstrip coordinates) */
  onHit: ((strength: number, x: number, z: number) => void) | null = null;
  private cd = 0;

  constructor(parent: THREE.Group, private env: Env, spawn: { x: number; z: number }, private ax: number, private az: number, shadows: boolean) {
    const mat = bodyMaterial();
    const radii = [1.25, 1.0, 0.95, 1.15, 1.0, 1.2, 0.95, 1.1, 1.1, 0.9, 1.3, 1.05];
    for (let i = 0; i < radii.length; i++) {
      const a = (i / radii.length) * Math.PI * 2, rr = 10 + (i % 3) * 7;
      const [ca, cb] = COLORS[i % COLORS.length];
      const mesh = new THREE.Mesh(ballGeometry(ca, cb), mat);
      mesh.scale.setScalar(radii[i]); mesh.castShadow = shadows; mesh.frustumCulled = false;
      parent.add(mesh);
      const x = spawn.x + Math.cos(a) * rr, z = spawn.z + Math.sin(a) * rr;
      this.list.push({ id: i, r: radii[i], x, y: env.ground(x, z) + radii[i], z, vx: 0, vy: 0, vz: 0, q: new THREE.Quaternion(), mesh });
    }
    this.place();
  }

  private place() {
    for (const b of this.list) { b.mesh.position.set(this.ax + b.x, b.y, this.az + b.z); b.mesh.quaternion.copy(b.q); }
  }

  exportState(): number[][] { return this.list.map((b) => [+b.x.toFixed(2), +b.y.toFixed(2), +b.z.toFixed(2), +b.vx.toFixed(2), +b.vy.toFixed(2), +b.vz.toFixed(2)]); }
  /** a client receives the host's state: velocities are adopted, positions are eased in over the next frames */
  importState(rows: number[][]) {
    rows.forEach((r, i) => {
      const b = this.list[i]; if (!b) return;
      b.tx = r[0]; b.ty = r[1]; b.tz = r[2]; b.vx = r[3]; b.vy = r[4]; b.vz = r[5];
    });
  }

  step(dt: number, cars: Car[], people: Person[]) {
    this.cd -= dt;
    const out = { x: 0, z: 0, nx: 0, nz: 0 };
    for (const b of this.list) {
      b.vy -= G * dt;
      const dr = Math.exp(-0.1 * dt); b.vx *= dr; b.vz *= dr; b.vy *= Math.exp(-0.04 * dt);
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      if (b.tx !== undefined) {                                   // ease toward the host's idea of where we are
        const k = Math.min(1, dt * 7);
        b.x += (b.tx - b.x) * k; b.y += (b.ty! - b.y) * k; b.z += (b.tz! - b.z) * k;
        if (Math.hypot(b.tx - b.x, b.tz! - b.z) < 0.03) b.tx = undefined;
      }
      // ground (and slopes: it rolls downhill)
      const g = this.env.ground(b.x, b.z);
      if (b.y - b.r < g) {
        b.y = g + b.r;
        if (b.vy < 0) { const imp = -b.vy; b.vy = imp > 2 ? imp * E_GROUND : 0; if (imp > 4 && this.cd <= 0) { this.onHit?.(imp * 0.5, b.x, b.z); this.cd = 0.12; } }
        const gx = (this.env.ground(b.x + 1, b.z) - this.env.ground(b.x - 1, b.z)) / 2, gz = (this.env.ground(b.x, b.z + 1) - this.env.ground(b.x, b.z - 1)) / 2;
        b.vx -= gx * G * 0.6 * dt; b.vz -= gz * G * 0.6 * dt;
        const fr = Math.exp(-0.35 * dt); b.vx *= fr; b.vz *= fr;
      }
      // walls, fences, buildings, the sea edge
      out.x = b.x; out.z = b.z;
      if (this.env.obstacle(b.x, b.z, b.r, out)) {
        b.x = out.x; b.z = out.z;
        const vn = b.vx * out.nx + b.vz * out.nz;
        if (vn < 0) { b.vx -= (1 + E_WALL) * vn * out.nx; b.vz -= (1 + E_WALL) * vn * out.nz; if (-vn > 3 && this.cd <= 0) { this.onHit?.(-vn * 0.4, b.x, b.z); this.cd = 0.12; } }
      }
      // cars: an open box (the body) against a sphere
      for (const c of cars) this.carHit(b, c);
      for (const p of people) {
        const dx = b.x - p.x, dy = b.y - (p.y + 0.9), dz = b.z - p.z, d = Math.hypot(dx, dy, dz), rr = b.r + 0.5;
        if (d < rr && d > 1e-4) {
          const nx = dx / d, ny = dy / d, nz = dz / d;
          b.x += nx * (rr - d); b.y += ny * (rr - d); b.z += nz * (rr - d);
          const vn = (b.vx - p.vx) * nx + b.vy * ny + (b.vz - p.vz) * nz;
          if (vn < 0) { b.vx -= (1 + 0.8) * vn * nx; b.vy -= (1 + 0.8) * vn * ny; b.vz -= (1 + 0.8) * vn * nz; }
          // a shove from someone walking always gives a little push
          b.vx += p.vx * 0.15; b.vz += p.vz * 0.15;
        }
      }
      const sp = Math.hypot(b.vx, b.vy, b.vz);
      if (b.vy > 6) b.vy = 6;                                     // they hop, they do not fly
      if (sp > 36) { const k = 36 / sp; b.vx *= k; b.vy *= k; b.vz *= k; }
      if (b.y > 80) { b.y = 80; b.vy = Math.min(0, b.vy); }
      // roll
      const hv = Math.hypot(b.vx, b.vz);
      if (hv > 0.02) {
        const ax = new THREE.Vector3(b.vz, 0, -b.vx).normalize();
        const dq = new THREE.Quaternion().setFromAxisAngle(ax, (hv * dt) / b.r);
        b.q.premultiply(dq);
      }
    }
    // balloons against each other
    for (let i = 0; i < this.list.length; i++) for (let j = i + 1; j < this.list.length; j++) {
      const a = this.list[i], c = this.list[j];
      const dx = c.x - a.x, dy = c.y - a.y, dz = c.z - a.z, d = Math.hypot(dx, dy, dz), rr = a.r + c.r;
      if (d >= rr || d < 1e-4) continue;
      const nx = dx / d, ny = dy / d, nz = dz / d, push = (rr - d) / 2;
      a.x -= nx * push; a.y -= ny * push; a.z -= nz * push; c.x += nx * push; c.y += ny * push; c.z += nz * push;
      const vn = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny + (c.vz - a.vz) * nz;
      if (vn < 0) {
        const ma = a.r ** 3, mc = c.r ** 3, j2 = (-(1 + E_BALL) * vn) / (1 / ma + 1 / mc);
        a.vx -= (j2 / ma) * nx; a.vy -= (j2 / ma) * ny; a.vz -= (j2 / ma) * nz;
        c.vx += (j2 / mc) * nx; c.vy += (j2 / mc) * ny; c.vz += (j2 / mc) * nz;
        if (-vn > 2.5 && this.cd <= 0) { this.onHit?.(-vn * 0.5, a.x, a.z); this.cd = 0.1; }
      }
    }
    this.place();
  }

  private carHit(b: Balloon, c: Car) {
    const s = c.spec, cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
    const dx = b.x - c.x, dz = b.z - c.z;
    if (Math.abs(dx) > s.hl + b.r + 1 || Math.abs(dz) > s.hl + b.r + 1) return;
    const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs, ly = b.y - c.y;
    const px = Math.max(-s.hw, Math.min(s.hw, lx)), pz = Math.max(-s.hl, Math.min(s.hl, lz)), py = Math.max(0.15, Math.min(s.height, ly));
    let nx = lx - px, ny = ly - py, nz = lz - pz, d = Math.hypot(nx, ny, nz);
    if (d >= b.r) return;
    if (d < 1e-4) { nx = 0; ny = 1; nz = 0; d = 1e-4; } else { nx /= d; ny /= d; nz /= d; }
    const wx = nx * cs + nz * sn, wz = -nx * sn + nz * cs;
    const push = b.r - d;
    b.x += wx * push; b.y += ny * push; b.z += wz * push;
    const vn = (b.vx - c.vx) * wx + (b.vy - c.vy) * ny + (b.vz - c.vz) * wz;
    if (vn < 0) {
      const mc = s.mass * 3, mb = 0.45, j = (-(1 + E_CAR) * vn) * (mc / (mc + mb));
      b.vx += wx * j; b.vy += ny * j + Math.min(2.2, -vn * 0.06); b.vz += wz * j;
      if (-vn > 1.5 && this.cd <= 0) { this.onHit?.(-vn, b.x, b.z); this.cd = 0.1; }
    }
  }
}
