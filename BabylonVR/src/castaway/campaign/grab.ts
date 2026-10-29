// Things you can pick up, carry, drop and throw in the Banana or Salmon missions: shopping, coins, crates, a pallet, a ball,
// the trophies. Generalised from the cat house mouse (grab / hold / throw / import / export): one holder at a time, the holder
// moves it (everybody else places it at the holder's hands from their state packets, so no positions are streamed while it is
// carried), a throw is simulated by everybody and the thrower announces where it came to rest.
// Heavy things need a gorilla (unless nobody here is a gorilla: then the "helper" rules let a cat shove them too).
import * as THREE from 'three';
import type { Space, SBox } from './space';

export type GrabKind = 'item' | 'coin' | 'heavy' | 'light' | 'trophy';
export interface GrabDef {
  name: string; kind: GrabKind; mesh: THREE.Object3D;
  x: number; y: number; z: number;
  /** pick radius / size for bouncing */
  r: number;
  /** heavy boxes are solid at rest (you can stand on them, they block the way): footprint and height */
  w?: number; d?: number; h?: number;
  /** starts hidden (inside something that has to be opened first) */
  hidden?: boolean;
  /** only a cat (crawling in) can take it from where it starts */
  catOnly?: boolean;
}
export interface Grab extends GrabDef {
  i: number; home: [number, number, number]; vx: number; vy: number; vz: number;
  /** 0 resting, 1 held, 2 flying */
  mode: 0 | 1 | 2; holder: number; hid: boolean; done: boolean; moved: boolean; box: SBox | null; spin: number; landed: boolean;
}
export type Species = 'g' | 'c';

const G = 9.8;

export class Grabs {
  readonly list: Grab[] = [];
  readonly group = new THREE.Group();
  /** what I am holding */
  mine: Grab | null = null;
  constructor(private space: Space, private m: number) {
    space.dyn = () => this.solids();
  }
  add(d: GrabDef): Grab {
    const g: Grab = { ...d, i: this.list.length, home: [d.x, d.y, d.z], vx: 0, vy: 0, vz: 0, mode: 0, holder: -1, hid: !!d.hidden, done: false, moved: false, box: null, spin: 0, landed: false };
    this.list.push(g); this.group.add(d.mesh); this.place(g);
    return g;
  }
  reset() {
    this.mine = null;
    for (const g of this.list) { [g.x, g.y, g.z] = g.home; g.vx = g.vy = g.vz = 0; g.mode = 0; g.holder = -1; g.hid = !!g.hidden; g.done = false; g.moved = false; g.landed = false; this.place(g); }
  }
  private place(g: Grab) { g.mesh.position.set(g.x, g.y, g.z); g.mesh.visible = !g.hid; }
  solids(): SBox[] {
    const out: SBox[] = [];
    for (const g of this.list) {
      if (!g.w || g.mode !== 0 || g.hid) { g.box = null; continue; }
      const b = (g.box ??= { x0: 0, x1: 0, y0: 0, y1: 0, z0: 0, z1: 0 });
      b.x0 = g.x - g.w / 2; b.x1 = g.x + g.w / 2; b.z0 = g.z - g.d! / 2; b.z1 = g.z + g.d! / 2; b.y0 = g.y; b.y1 = g.y + g.h!;
      out.push(b);
    }
    return out;
  }
  /** the nearest thing on the aim ray (local eye) that can be picked up */
  pick(eye: THREE.Vector3, dir: THREE.Vector3, reach: number, assist: number): { g: Grab; dist: number } | null {
    let best: { g: Grab; dist: number } | null = null;
    for (const g of this.list) {
      if (g.hid || g.done || g.mode === 1) continue;
      const cy = g.y + (g.h ? g.h / 2 : g.r * 0.6);
      const dx = g.x - eye.x, dy = cy - eye.y, dz = g.z - eye.z, t = dx * dir.x + dy * dir.y + dz * dir.z;
      if (t < 0 || t > reach + g.r) continue;
      const px = dx - dir.x * t, py = dy - dir.y * t, pz = dz - dir.z * t, rr = Math.max(0.22, g.r * 1.2) * assist;
      if (px * px + py * py + pz * pz <= rr * rr && (!best || t < best.dist)) best = { g, dist: t };
    }
    return best;
  }
  /** can this body pick it up? (null = yes, otherwise why not) */
  why(g: Grab, sp: Species, helper: boolean): string | null {
    if (g.kind === 'heavy' && sp === 'c' && !helper) return 'heavy';
    if (g.catOnly && !g.moved && sp === 'g' && !helper) return 'cat';
    return null;
  }

  // ---- my actions (each also goes out as an event)
  grab(g: Grab, me: number, send: (e: any) => void) {
    if (this.mine) this.drop(this.mine, me, send, 0, 0, 0);
    g.mode = 1; g.holder = me; g.moved = true; g.vx = g.vy = g.vz = 0; this.mine = g;
    send({ k: 'qi', m: this.m, i: g.i, s: 1, h: me });
  }
  /** let go: with a velocity (throw) or (0,0,0) to just drop it where it is */
  drop(g: Grab, me: number, send: (e: any) => void, vx: number, vy: number, vz: number) {
    if (g.holder !== me) return;
    g.mode = 2; g.holder = -1; g.vx = vx; g.vy = vy; g.vz = vz; g.landed = false;
    if (this.mine === g) this.mine = null;
    this.thrown.add(g.i);
    send({ k: 'qi', m: this.m, i: g.i, s: 2, p: [r2(g.x), r2(g.y), r2(g.z)], v: [r2(vx), r2(vy), r2(vz)] });
  }
  /** put it somewhere for good (the till belt, the tray): no longer in play */
  consume(g: Grab, x: number, y: number, z: number) {
    if (this.mine === g) this.mine = null;
    g.done = true; g.mode = 0; g.holder = -1; g.x = x; g.y = y; g.z = z; this.place(g);
  }
  reveal(g: Grab) { g.hid = false; this.place(g); }

  net(e: any, from: number) {
    const g = this.list[e.i]; if (!g || g.done) return;
    if (e.s === 1) {
      // somebody grabbed it: if I hold it too, the lower id keeps it
      if (this.mine === g && from > (g.holder < 0 ? 1e9 : g.holder)) return;
      if (this.mine === g) this.mine = null;
      g.mode = 1; g.holder = from; g.moved = true; g.hid = false;
    } else if (e.s === 2) {
      if (this.mine === g) return;
      g.mode = 2; g.holder = -1; [g.x, g.y, g.z] = e.p; [g.vx, g.vy, g.vz] = e.v; g.landed = false; g.hid = false;
    } else if (e.s === 0) {
      if (this.mine === g) return;
      g.mode = 0; g.holder = -1; [g.x, g.y, g.z] = e.p; g.vx = g.vy = g.vz = 0; g.hid = false;
    }
    this.place(g);
  }

  /**
   * holdAt(id) gives where a holder's hands are (local coordinates) or null when they are gone.
   * Returns the things that came to rest this frame that I threw (to announce them).
   */
  update(dt: number, holdAt: (id: number) => { x: number; y: number; z: number; yaw: number } | null, me: number, send: (e: any) => void) {
    for (const g of this.list) {
      if (g.hid || g.done) continue;
      if (g.mode === 1) {
        const h = holdAt(g.holder);
        if (!h) { g.mode = 2; g.holder = -1; g.vx = g.vy = g.vz = 0; if (this.mine === g) this.mine = null; continue; }
        g.x = h.x; g.y = h.y - (g.h ? g.h / 2 : 0); g.z = h.z; g.mesh.rotation.set(0, h.yaw, 0);
        g.mesh.position.set(g.x, g.y, g.z); continue;
      }
      if (g.mode === 2) {
        const mineToAnnounce = !g.landed;
        g.vy -= G * dt;
        let nx = g.x + g.vx * dt, nz = g.z + g.vz * dt;
        const o = this._o;
        if (this.space.push(nx, nz, g.w ? Math.max(g.w, g.d!) / 2 : g.r * 0.8, g.y, g.h ?? g.r, o)) {
          const l = Math.hypot(o.nx, o.nz);
          if (l > 1e-4) { const wx = o.nx / l, wz = o.nz / l, vn = g.vx * wx + g.vz * wz; if (vn < 0) { g.vx -= 1.5 * vn * wx; g.vz -= 1.5 * vn * wz; } }
          nx = o.x; nz = o.z;
        }
        g.x = nx; g.z = nz; g.y += g.vy * dt;
        const fl = this.space.floorL(g.x, g.z, g.y + 0.05);
        if (g.y < -30) { [g.x, g.y, g.z] = g.home; g.vx = g.vy = g.vz = 0; }
        if (g.y <= fl) {
          g.y = fl;
          if (g.vy < -2 && !g.w) { g.vy *= -0.3; g.vx *= 0.6; g.vz *= 0.6; }
          else { g.vy = 0; const f = Math.exp(-(g.w ? 14 : 6) * dt); g.vx *= f; g.vz *= f; }
        }
        g.spin += dt * Math.hypot(g.vx, g.vz) * 3;
        g.mesh.rotation.set(g.w ? 0 : g.spin, g.mesh.rotation.y, 0);
        if (g.y <= fl + 0.001 && Math.hypot(g.vx, g.vz) < 0.12 && Math.abs(g.vy) < 0.1) {
          g.mode = 0; g.vx = g.vy = g.vz = 0; g.landed = true;
          if (!g.w) g.mesh.rotation.set(0, g.mesh.rotation.y, 0);
          // whoever let go announces the resting place (everybody simulated it the same way, this just settles any drift)
          if (mineToAnnounce && this.thrown.has(g.i)) { this.thrown.delete(g.i); send({ k: 'qi', m: this.m, i: g.i, s: 0, p: [r2(g.x), r2(g.y), r2(g.z)] }); }
        }
        g.mesh.position.set(g.x, g.y, g.z);
      }
    }
    void me;
  }
  /** things I threw that are still flying (I announce where they land) */
  readonly thrown = new Set<number>();
  private _o = { x: 0, z: 0, nx: 0, nz: 0 };
  /** state for a late joiner of a running mission (not used yet: late joiners wait in the hub) */
  export() { return this.list.map((g) => [r2(g.x), r2(g.y), r2(g.z), g.hid ? 1 : 0, g.done ? 1 : 0]); }
}

const r2 = (v: number) => Math.round(v * 100) / 100;
