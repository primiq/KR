// Drivable cars for the airstrip: four open-top models and one arcade physics model (grip, drift, hand-brake, boost, ramps and
// air time). All positions are in the airstrip's own coordinates; `Env` supplies the ground height and the obstacles.
// Babylon port: Castaway's code, drawn by render/mirror.ts.
import * as THREE from 'three';
import { Mesher } from '../net/playerModel';

export interface Env {
  /** ground height; y = where you are (a spot can have roads at several heights), left out = the ground itself */
  ground(x: number, z: number, y?: number): number;
  /** pushes a circle out of walls / fences / buildings / the sea; returns the push direction (or null if nothing was touched) */
  obstacle(x: number, z: number, r: number, out: { x: number; z: number; nx: number; nz: number }, clear?: number, y?: number): boolean;
}

export interface CarSpec {
  id: string; name: string; blurb: string;
  maxSpeed: number; accel: number; grip: number; steer: number; steerFall: number; mass: number;
  /** half length / half width of the body, height, radius used for crashes */
  hl: number; hw: number; height: number; crash: number;
  wheelR: [number, number]; wheelX: number; wheelZ: [number, number];
  /** where the driver sits (local, floor level) */
  seat: [number, number, number];
  /** eye height of the driver (local, first person) */
  eye: number;
}

export const CAR_SPECS: CarSpec[] = [
  { id: 'roadster', name: 'Roadster', blurb: 'Fast and slippery', maxSpeed: 46, accel: 21, grip: 5.2, steer: 1.75, steerFall: 0.022, mass: 1, hl: 2.1, hw: 0.95, height: 1.1, crash: 1.25, wheelR: [0.36, 0.38], wheelX: 0.86, wheelZ: [1.3, -1.25], seat: [0.4, 0.3, -0.25], eye: 1.3 },
  { id: 'jeep', name: 'Jeep', blurb: 'Sturdy all-rounder', maxSpeed: 31, accel: 14, grip: 8, steer: 2.0, steerFall: 0.02, mass: 1.5, hl: 1.85, hw: 1.0, height: 1.6, crash: 1.35, wheelR: [0.46, 0.46], wheelX: 0.95, wheelZ: [1.15, -1.1], seat: [0.42, 0.45, -0.1], eye: 1.42 },
  { id: 'buggy', name: 'Dune Buggy', blurb: 'Light and nimble', maxSpeed: 37, accel: 19, grip: 6.4, steer: 2.35, steerFall: 0.02, mass: 0.8, hl: 1.6, hw: 1.0, height: 1.3, crash: 1.2, wheelR: [0.4, 0.52], wheelX: 1.0, wheelZ: [1.05, -1.0], seat: [0.35, 0.35, -0.1], eye: 1.25 },
  { id: 'pickup', name: 'Pickup', blurb: 'Heavy, great balloon pusher', maxSpeed: 27, accel: 11, grip: 7.4, steer: 1.65, steerFall: 0.018, mass: 2.4, hl: 2.4, hw: 1.05, height: 1.7, crash: 1.5, wheelR: [0.5, 0.5], wheelX: 1.0, wheelZ: [1.6, -1.45], seat: [0.45, 0.9, 0.35], eye: 1.8 },
];

export const SPEC_BY_ID: Record<string, CarSpec> = Object.fromEntries(CAR_SPECS.map((s) => [s.id, s]));

const TIRE = '#202225', HUB = '#c4c8cf', LIGHT = '#fff3b0', TAIL = '#d33232', DARKM = '#2b2d31', CHROME = '#bfc5cc';

function wheelGroup(r: number, w: number): THREE.Group {
  const m = new Mesher();
  m.cyl(r, r, w, TIRE, 0, 0, 0, 1, 1, 16, 0, 0, Math.PI / 2);
  m.cyl(r * 0.55, r * 0.55, w + 0.02, HUB, 0, 0, 0, 1, 1, 10, 0, 0, Math.PI / 2);
  m.box(0.02, r * 1.5, r * 0.18, DARKM, 0, 0, 0);                 // spokes, so the spin shows
  m.box(0.02, r * 0.18, r * 1.5, DARKM, 0, 0, 0);
  const g = new THREE.Group(); g.add(m.build(false)); return g;
}

function steeringWheel(): THREE.Group {
  const m = new Mesher();
  for (let k = 0; k < 14; k++) { const a = (k / 14) * Math.PI * 2; m.box(0.07, 0.035, 0.035, '#2a2a2e', Math.cos(a) * 0.17, Math.sin(a) * 0.17, 0, 0, 0, a + Math.PI / 2); }
  m.box(0.34, 0.03, 0.03, '#2a2a2e', 0, 0, 0); m.box(0.03, 0.17, 0.03, '#2a2a2e', 0, -0.08, 0);
  const g = new THREE.Group(); g.add(m.build(false)); return g;
}

function seat(m: Mesher, x: number, y: number, z: number, c: string) {
  m.box(0.5, 0.14, 0.5, c, x, y + 0.2, z); m.box(0.48, 0.55, 0.12, c, x, y + 0.55, z - 0.27, -0.1);
}

function buildBody(s: CarSpec, color: string, accent: string): Mesher {
  const m = new Mesher();
  const hl = s.hl, hw = s.hw;
  switch (s.id) {
    case 'roadster': {
      m.box(hw * 1.9, 0.42, hl * 1.92, color, 0, 0.55, 0);                    // tub
      m.box(hw * 1.7, 0.2, 1.3, color, 0, 0.76, hl * 0.6);                    // hood
      m.box(hw * 1.7, 0.2, 0.9, color, 0, 0.78, -hl * 0.78);                  // tail
      m.box(0.34, 0.03, hl * 1.9, '#f2f2f2', 0, 0.78, 0);                     // racing stripe
      m.box(hw * 1.96, 0.06, 0.1, DARKM, 0, 0.77, hl * 0.97); m.box(hw * 1.96, 0.1, 0.1, DARKM, 0, 0.5, -hl * 0.99);
      for (const sx of [-1, 1]) { m.box(0.2, 0.12, 0.06, LIGHT, sx * 0.6, 0.78, hl * 0.99); m.box(0.2, 0.1, 0.06, TAIL, sx * 0.62, 0.78, -hl * 0.99); }
      m.box(hw * 1.8, 0.05, 0.4, accent, 0, 1.05, -hl * 0.95);                // spoiler
      for (const sx of [-1, 1]) m.box(0.06, 0.3, 0.3, DARKM, sx * 0.55, 0.9, -hl * 0.9);
      seat(m, 0.4, 0.4, -0.25, '#2b2b30'); seat(m, -0.4, 0.4, -0.25, '#2b2b30');
      m.box(hw * 1.9, 0.4, 0.2, accent, 0, 0.55, 0.4);                        // dash
      break;
    }
    case 'jeep': {
      m.box(hw * 1.9, 0.62, hl * 1.9, color, 0, 0.78, 0);                     // body
      m.box(hw * 1.7, 0.2, 1.25, color, 0, 1.18, hl * 0.55);                  // hood
      m.box(hw * 1.5, 0.3, 0.1, DARKM, 0, 1.1, hl * 0.97);                    // grille
      for (const sx of [-1, 1]) { m.cyl(0.14, 0.14, 0.1, LIGHT, sx * 0.7, 1.15, hl * 1.0, 1, 1, 10, Math.PI / 2); m.box(0.16, 0.1, 0.06, TAIL, sx * 0.8, 1.05, -hl * 0.99); }
      m.box(hw * 2.0, 0.14, 0.3, DARKM, 0, 0.5, hl * 1.0); m.box(hw * 2.0, 0.14, 0.25, DARKM, 0, 0.5, -hl * 1.0);   // bumpers
      m.box(hw * 1.9, 0.07, 0.09, DARKM, 0, 1.87, 0.3, -0.12);
      for (const sx of [-1, 1]) { m.cyl(0.04, 0.04, 1.2, CHROME, sx * 0.85, 1.7, -0.55); m.cyl(0.04, 0.04, 1.8, CHROME, sx * 0.85, 1.9, -1.05, 1, 1, 6, Math.PI / 2); }  // roll bar
      m.cyl(0.04, 0.04, 1.7, CHROME, 0, 2.05, -1.05, 1, 1, 6, 0, 0, Math.PI / 2);
      m.cyl(0.42, 0.42, 0.22, DARKM, 0, 1.0, -hl * 1.03, 1, 1, 14, Math.PI / 2);   // spare wheel on the back
      seat(m, 0.42, 0.5, -0.1, '#4a3d2b'); seat(m, -0.42, 0.5, -0.1, '#4a3d2b'); m.box(hw * 1.9, 0.3, 0.25, DARKM, 0, 1.05, 0.5);
      m.box(hw * 1.9, 0.08, 0.6, accent, 0, 1.12, hl * 0.55);
      break;
    }
    case 'buggy': {
      for (const sx of [-1, 1]) {                                              // tube frame
        m.cyl(0.035, 0.035, 2.9, color, sx * 0.62, 0.62, 0, 1, 1, 8, Math.PI / 2);
        m.cyl(0.035, 0.035, 2.9, color, sx * 0.78, 1.35, -0.1, 1, 1, 8, Math.PI / 2);
        m.cyl(0.035, 0.035, 0.9, color, sx * 0.62, 1.0, 0.95); m.cyl(0.035, 0.035, 0.9, color, sx * 0.62, 1.0, -1.1);
        m.cyl(0.035, 0.035, 1.5, color, sx * 0.62, 0.9, 1.4, 1, 1, 8, 0.9, 0, 0);
      }
      m.cyl(0.035, 0.035, 1.3, color, 0, 1.4, -0.1, 1, 1, 8, 0, 0, Math.PI / 2);
      m.box(hw * 1.2, 0.12, 2.6, '#2b2b2f', 0, 0.5, 0);                        // floor pan
      m.box(hw * 1.1, 0.35, 0.9, accent, 0, 0.8, -hl * 0.78);                  // engine
      m.box(0.9, 0.1, 0.3, DARKM, 0, 0.45, hl * 1.0);
      m.box(hw * 1.4, 0.28, 0.9, color, 0, 0.72, hl * 0.62);                   // nose
      for (const sx of [-1, 1]) m.cyl(0.11, 0.11, 0.1, LIGHT, sx * 0.4, 0.76, hl * 0.96, 1, 1, 10, Math.PI / 2);
      seat(m, 0.35, 0.35, -0.1, '#c24a1c'); seat(m, -0.35, 0.35, -0.1, '#c24a1c');
      break;
    }
    default: { // pickup
      m.box(hw * 1.95, 0.55, hl * 1.95, color, 0, 0.9, 0);                     // chassis
      m.box(hw * 1.8, 0.7, 0.1, color, 0, 1.52, -0.05);                        // cab back wall (the cab is open: you sit inside it)
      m.box(hw * 1.8, 0.4, 0.14, color, 0, 1.4, 1.3);                          // dash wall
      m.box(hw * 1.8, 0.28, 1.05, color, 0, 1.2, hl * 0.62);                   // hood
      for (const sx of [-1, 1]) { m.box(0.08, 0.5, 1.4, color, sx * hw * 0.88, 1.43, 0.65); }
      m.box(hw * 1.9, 0.1, 0.9, DARKM, 0, 1.1, -hl * 0.45);                   // bed floor
      m.box(hw * 1.95, 0.45, 0.1, color, 0, 1.4, -hl * 0.98);                  // tailgate
      for (const sx of [-1, 1]) m.box(0.1, 0.45, 1.9, color, sx * hw * 0.95, 1.4, -hl * 0.45);
      m.box(hw * 1.95, 0.18, 0.3, CHROME, 0, 0.72, hl * 1.0); m.box(hw * 1.95, 0.18, 0.25, CHROME, 0, 0.72, -hl * 1.0);
      for (const sx of [-1, 1]) { m.cyl(0.13, 0.13, 0.1, LIGHT, sx * 0.72, 1.18, hl * 1.0, 1, 1, 10, Math.PI / 2); m.box(0.18, 0.12, 0.06, TAIL, sx * 0.8, 1.3, -hl * 0.995); }
      m.box(0.9, 0.04, 0.28, accent, 0, 1.0, hl * 0.9);
      seat(m, 0.45, 0.95, 0.35, '#3a3f4a'); seat(m, -0.45, 0.95, 0.35, '#3a3f4a'); m.box(hw * 1.9, 0.3, 0.25, DARKM, 0, 1.3, 1.1);
      break;
    }
  }
  return m;
}

export const CAR_COLORS: [string, string][] = [['#d6322d', '#f2d12b'], ['#3f7a3a', '#d9d1b0'], ['#f08a1c', '#2b2b2f'], ['#2f62b8', '#e8e8e8']];

export class Car {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private wheels: THREE.Group[] = [];       // fl, fr, rl, rr
  readonly wheel = steeringWheel();
  /** the dash readout (made on first use by the airstrip) */
  dash: THREE.Mesh | null = null;
  // state (airstrip coordinates)
  x = 0; y = 0; z = 0; yaw = 0; vx = 0; vz = 0; vy = 0; pitch = 0; roll = 0;
  steerVis = 0; spin = 0; grounded = true; boost = 0;
  /** player id of whoever drives it, or null */
  driver: number | null = null;
  /** last frame's controls (also what remote players' cars show) */
  gas = 0; steerIn = 0; brake = false;
  /** where it parks */
  readonly home: { x: number; z: number; yaw: number };
  /** impact strength from the last collision (read by the sound code) */
  bump = 0;
  private lastGy = NaN;

  constructor(readonly spec: CarSpec, readonly index: number, home: { x: number; z: number; yaw: number }, shadows: boolean) {
    const [col, acc] = CAR_COLORS[index % CAR_COLORS.length];
    const bodyMesh = buildBody(spec, col, acc).build(shadows);
    this.body.add(bodyMesh);
    this.root.add(this.body);
    const [rf, rr] = spec.wheelR, wf = spec.wheelZ[0], wr = spec.wheelZ[1];
    const pos: [number, number, number, number][] = [[-spec.wheelX, rf, wf, rf], [spec.wheelX, rf, wf, rf], [-spec.wheelX, rr, wr, rr], [spec.wheelX, rr, wr, rr]];
    for (const [x, y, z, r] of pos) {
      const g = new THREE.Group(); g.position.set(x, y, z);
      const w = wheelGroup(r, spec.id === 'buggy' && r > 0.45 ? 0.5 : 0.32); g.add(w); (g as any).spinner = w;
      this.body.add(g); this.wheels.push(g);
    }
    this.wheel.position.set(spec.seat[0], spec.eye - 0.33, spec.seat[2] + 0.72);
    this.wheel.rotation.x = -0.9;
    this.body.add(this.wheel);
    this.root.rotation.order = 'YXZ';
    this.home = { ...home };
    this.reset();
  }

  reset() {
    this.x = this.home.x; this.z = this.home.z; this.yaw = this.home.yaw; this.vx = this.vz = this.vy = 0; this.pitch = this.roll = 0; this.driver = null;
    this.grounded = true; this.gas = this.steerIn = 0; this.brake = false; this.boost = 0; this.lastGy = NaN;
  }

  get speed() { return Math.hypot(this.vx, this.vz); }
  /** signed speed along the heading */
  get fwdSpeed() { return this.vx * Math.sin(this.yaw) + this.vz * Math.cos(this.yaw); }

  /** the driver's seat in airstrip coordinates (floor level) */
  seatPos(out: THREE.Vector3): THREE.Vector3 {
    const [sx, sy, sz] = this.spec.seat;
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    // local +x is the car's left; world: left = (cos, -sin)... (see yaw convention: forward (sin, cos), right (-cos, sin))
    const lx = sx, lz = sz;
    out.set(this.x + lx * c + lz * s, this.y + sy + 0.05, this.z - lx * s + lz * c);
    return out;
  }

  /** advance the physics by dt (the airstrip calls this in small steps) */
  step(dt: number, env: Env, gas: number, steer: number, handbrake: boolean, boost: boolean) {
    const sp = this.spec;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let fx = sin, fz = cos;
    let f = this.vx * fx + this.vz * fz;
    this.gas = gas; this.steerIn = steer; this.brake = handbrake;
    this.boost = boost ? 1 : 0;
    const maxS = sp.maxSpeed * (boost ? 1.28 : 1), acc = sp.accel * (boost ? 1.6 : 1);

    // ---- steering: the heading turns with speed, less so when very fast; in reverse the sense flips
    const sf = Math.min(1, Math.abs(f) / 4) / (1 + Math.abs(f) * sp.steerFall);
    this.yaw += -steer * sp.steer * sf * (f >= 0 ? 1 : -1) * (handbrake ? 1.7 : 1) * dt;
    fx = Math.sin(this.yaw); fz = Math.cos(this.yaw);
    const rx = -Math.cos(this.yaw), rz = Math.sin(this.yaw);
    f = this.vx * fx + this.vz * fz;
    let l = this.vx * rx + this.vz * rz;

    if (this.grounded) {
      // ---- engine / brakes / rolling resistance
      if (Math.abs(gas) > 0.02) {
        if (gas * f >= -0.5) {
          const want = gas > 0 ? gas * maxS : gas * maxS * 0.45;
          const d = want - f;
          f += Math.sign(d) * Math.min(Math.abs(d), acc * Math.abs(gas) * dt * (0.35 + 0.65 * (1 - Math.min(1, Math.abs(f) / maxS))));
        } else f -= Math.sign(f) * Math.min(Math.abs(f), 30 * dt);        // pressing the other way: brake first
      } else f -= Math.sign(f) * Math.min(Math.abs(f), (2.2 + 0.01 * f * f) * dt);
      if (handbrake) f -= Math.sign(f) * Math.min(Math.abs(f), 13 * dt);
      // ---- uphill slows, downhill speeds up
      const gh = env.ground(this.x + fx * 1.2, this.z + fz * 1.2, this.y) - env.ground(this.x - fx * 1.2, this.z - fz * 1.2, this.y);
      f -= (gh / 2.4) * 9.8 * 0.55 * dt;
      // ---- tyres: sideways speed is killed (slowly with the hand-brake, so the tail swings out)
      l *= Math.exp(-(handbrake ? 0.9 : sp.grip) * dt);
    }
    this.vx = fx * f + rx * l; this.vz = fz * f + rz * l;

    // ---- move, then crash into whatever is in the way
    this.x += this.vx * dt; this.z += this.vz * dt;
    const out = { x: this.x, z: this.z, nx: 0, nz: 0 };
    for (let k = 0; k < 2; k++) {
      out.x = this.x; out.z = this.z;
      if (env.obstacle(this.x, this.z, sp.crash, out, this.y - env.ground(this.x, this.z, this.y), this.y)) {
        this.x = out.x; this.z = out.z;
        const vn = this.vx * out.nx + this.vz * out.nz;
        if (vn < 0) { this.vx -= vn * out.nx * 1.35; this.vz -= vn * out.nz * 1.35; this.bump = Math.max(this.bump, -vn); }
      }
    }

    // ---- height: ride the ground, fly off the end of ramps
    const g = this.groundUnder(env);
    this.vy -= 22 * dt;
    this.y += this.vy * dt;
    if (Number.isNaN(this.lastGy)) { this.lastGy = g; this.y = g; }
    const slopeVy = Math.max(-12, Math.min(14, (g - this.lastGy) / Math.max(dt, 1e-4)));
    if (this.y <= g + 0.02) {
      if (!this.grounded && this.vy < -6) this.bump = Math.max(this.bump, -this.vy * 0.5);
      this.y = g; this.vy = Math.max(slopeVy, 0) * (this.vy > 0 ? 1 : 1); this.grounded = true;
      if (slopeVy < 0) this.vy = Math.max(slopeVy, -8);
    } else if (this.grounded && this.y - g < 0.12 && slopeVy <= 0.5) { this.y = g; this.vy = 0; }
    else this.grounded = false;
    this.lastGy = g;

    // ---- tilt to match the wheels' ground (and level out in the air)
    const sx = this.spec.wheelX, zf = this.spec.wheelZ[0], zr = this.spec.wheelZ[1];
    const at = (lx: number, lz: number) => env.ground(this.x + lx * Math.cos(this.yaw) + lz * Math.sin(this.yaw), this.z - lx * Math.sin(this.yaw) + lz * Math.cos(this.yaw), this.y);
    let tp = 0, tr = 0;
    if (this.grounded) {
      const hf = (at(-sx, zf) + at(sx, zf)) / 2, hr = (at(-sx, zr) + at(sx, zr)) / 2;
      tp = -Math.atan2(hf - hr, zf - zr);
      tr = Math.atan2(at(-sx, 0) - at(sx, 0), 2 * sx) * -1;
    } else tp = -Math.atan2(this.vy, Math.max(4, Math.abs(f))) * 0.6;
    tp = Math.max(-0.5, Math.min(0.5, tp)); tr = Math.max(-0.45, Math.min(0.45, tr));   // never roll over an edge
    const k = 1 - Math.exp(-(this.grounded ? 14 : 4) * dt);
    this.pitch += (tp - this.pitch) * k; this.roll += (tr - this.roll) * k;

    // ---- wheels
    this.steerVis += (-steer * 0.5 - this.steerVis) * (1 - Math.exp(-14 * dt));
    this.spin += (f / sp.wheelR[1]) * dt;
  }

  private groundUnder(env: Env) {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    let g = -1e9;
    for (const [lx, lz] of [[-this.spec.wheelX, this.spec.wheelZ[0]], [this.spec.wheelX, this.spec.wheelZ[0]], [-this.spec.wheelX, this.spec.wheelZ[1]], [this.spec.wheelX, this.spec.wheelZ[1]]]) {
      g = Math.max(g, env.ground(this.x + lx * c + lz * s, this.z - lx * s + lz * c, this.y));
    }
    // the body rides on the average of the wheels, so the highest wheel pulls it up only partly
    const m = env.ground(this.x, this.z, this.y);
    return (g + m * 2) / 3;
  }

  /** copy the state onto the meshes */
  place(ax: number, az: number) {
    this.root.position.set(ax + this.x, this.y, az + this.z);
    this.root.rotation.set(this.pitch, this.yaw, this.roll);
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      (w as any).spinner.rotation.x = this.spin;
      if (i < 2) w.rotation.y = this.steerVis;
    }
    this.wheel.rotation.z = this.steerVis * 2.4;
  }
}
