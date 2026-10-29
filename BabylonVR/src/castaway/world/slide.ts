// The giant water slide on the far side of the island (opposite the spawn beach).
//
// A white steel tower on the hill behind the shore, with a ladder up one face (walk into it and push forward / up to climb) to a
// railed platform 18 m up. From the platform an open half-pipe (yellow and orange, 2.6 m across so neither you nor a VR head
// ever pokes through it) spirals twice round the tower, runs downhill on posts and dives into the sea, where it closes into a
// glass tube: a long run under the water along the coast past the reef and the fish, then it climbs up out of the sea, drops
// towards the beach further along and throws you out onto the sand.
//
// Riding: walk into the chute at the top (or press E there). You slide by gravity (with a little push so you never stall in the
// long flat bits), bank up the wall in the bends, and come out at the end with your speed. You can't drown in the tube.
// Everything here is built from fixed numbers, so every player has the same slide; riders show to others sitting down.
// Babylon port: Castaway's code, drawn by render/mirror.ts (the chute is a plain warm yellow, the tube a faint glass).
import * as THREE from 'three';
import { heightAt, SPAWN_THETA } from './island';

/** a position or velocity (Babylon's Vector3 here) */
interface PV { x: number; y: number; z: number; set(x: number, y: number, z: number): unknown }
import type { ColliderGrid, Collider } from './vegetation';

const R = 1.3;                  // tube radius (m)
const UP = new THREE.Vector3(0, 1, 0);
const G = 9.81;

const shoreR = (a: number) => { for (let r = 30; r < 370; r += 0.5) if (heightAt(Math.cos(a) * r, Math.sin(a) * r) < 0) return r; return 200; };
const at = (a: number, r: number) => ({ x: Math.cos(a) * r, z: Math.sin(a) * r });

export class Slide {
  readonly group = new THREE.Group();
  readonly curve: THREE.CatmullRomCurve3;
  readonly length: number;
  /** arc length where the open chute closes into the glass tube, and where it opens again for the last drop */
  private sClose = 0; private sOpen = 0;
  // the tower
  readonly tower = { x: 0, z: 0, g: 0, top: 0 };
  private ladder = { x: 0, z: 0, nx: 0, nz: 0, yaw: 0 };
  /** which face of the square tower the ladder is on (the angle of its outward normal): the one looking most towards the
   *  island, never the side the chute leaves from */
  private ladderFace() {
    const T = this.tower, land = Math.atan2(-T.z, -T.x), toStart = Math.atan2(this.start.z - T.z, this.start.x - T.x);
    let la = 0, best = -9;
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      let ds = a - toStart; ds = Math.atan2(Math.sin(ds), Math.cos(ds));
      if (Math.abs(ds) < Math.PI / 4) continue;
      if (Math.cos(a - land) > best) { best = Math.cos(a - land); la = a; }
    }
    return la;
  }
  private start = new THREE.Vector3();
  private cols: Collider[] = [];
  // the ride
  riding = false;
  private s = 0; private v = 0; private bank = 0; private yawOff = 0; private lastYaw = 0;
  climbing = false;
  /** sounds and messages */
  sound: ((k: 'whoosh' | 'splash' | 'land', v: number) => void) | null = null;
  say: ((t: string) => void) | null = null;
  private _p = new THREE.Vector3(); private _t = new THREE.Vector3(); private _s = new THREE.Vector3(); private _n = new THREE.Vector3();

  constructor(scene: THREE.Scene, private colliders: ColliderGrid, shadows: boolean) {
    // ---- where: the far side, a tower on the hill behind the shore, the run along the coast, the exit on a beach
    const a0 = SPAWN_THETA + Math.PI - 0.84, a1 = a0 + 0.84;
    const r0 = shoreR(a0);
    const T = at(a0, r0 - 30);
    this.tower.x = T.x; this.tower.z = T.z; this.tower.g = heightAt(T.x, T.z); this.tower.top = this.tower.g + 18;
    const pts: THREE.Vector3[] = [];
    // the start, off the platform's edge, then two turns of a spiral round the tower down to ~3 m off the ground
    const HR = 5.2, turns = 2, outA = a0;                         // the spiral ends facing the sea
    const startA = outA - turns * Math.PI * 2 - 0.0;
    // the chute's floor starts level with the deck, right at its edge, and swings out onto the spiral
    const yTop = this.tower.top + R - 0.4, yBot = this.tower.g + 3.2;
    pts.push(new THREE.Vector3(T.x + Math.cos(startA - 0.5) * 2.1, yTop, T.z + Math.sin(startA - 0.5) * 2.1));
    const n = 26;
    for (let i = 0; i <= n; i++) {
      const k = i / n, a = startA + (outA - startA) * k;
      pts.push(new THREE.Vector3(T.x + Math.cos(a) * HR, yTop - 0.6 + (yBot - yTop + 0.6) * k, T.z + Math.sin(a) * HR));
    }
    this.start.copy(pts[0]); this.start.y = this.tower.top;
    // downhill to the sea (out along a0), a little above the ground
    const dir = { x: Math.cos(a0), z: Math.sin(a0) };
    for (const d of [12, 20, 27]) {
      const x = T.x + dir.x * d, z = T.z + dir.z * d, g = heightAt(x, z);
      pts.push(new THREE.Vector3(x, Math.max(g + 2.2, 0.8 + (27 - d) * 0.25), z));
    }
    // into the water and down, then along the coast under the sea (deep enough that the glass stays under the waves)
    // (deep enough all round, not just on the spot: reefs and sand bars rise between the points)
    const deepAround = (x: number, z: number) => { let h = -1e9; for (let k = 0; k < 8; k++) { const b = (k / 8) * Math.PI * 2; h = Math.max(h, heightAt(x + Math.cos(b) * 6, z + Math.sin(b) * 6)); } return Math.max(h, heightAt(x, z)); };
    const under = (a: number) => {
      const rs = shoreR(a);
      for (let off = 30; off <= 110; off += 2.5) {
        const p = at(a, rs + off), h = deepAround(p.x, p.z);
        if (h <= -3.9) return new THREE.Vector3(p.x, Math.min(-2.0, Math.max(h + 1.8, -5.2)), p.z);
      }
      const p = at(a, rs + 110); return new THREE.Vector3(p.x, -2.2, p.z);
    };
    const span = a1 - a0 - 0.08;
    const m = 26;
    for (let i = 0; i <= m; i++) pts.push(under(a0 + 0.02 + span * (i / m)));
    // up out of the sea, then down to the beach: the mouth points up the sand
    const rs1 = shoreR(a1);
    const rise = at(a1, rs1 + 26), top = at(a1, rs1 + 12), mouth = at(a1, rs1 - 6), out = at(a1, rs1 - 12);
    pts.push(new THREE.Vector3(rise.x, 2.5, rise.z));
    pts.push(new THREE.Vector3(top.x, 5.2, top.z));
    pts.push(new THREE.Vector3(mouth.x, heightAt(mouth.x, mouth.z) + 1.7, mouth.z));
    pts.push(new THREE.Vector3(out.x, heightAt(out.x, out.z) + 1.3, out.z));
    // ---- then the heights: resample the route every 4 m (the spiral round the tower stays as drawn) and lift every point to
    // clear the ground or the sea floor under and around it, smoothing the climbs and drops so the ride flows
    const c0 = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5); c0.arcLengthDivisions = 4000;
    const L0 = c0.getLength(), M = Math.ceil(L0 / 4);
    const xs: THREE.Vector3[] = [], fixed: boolean[] = [], floor: number[] = [];
    for (let i = 0; i <= M; i++) {
      const q = c0.getPointAt(i / M, new THREE.Vector3());
      const nearTower = Math.hypot(q.x - T.x, q.z - T.z) < HR + 1.2 && q.y > this.tower.g + 2.5;
      let g = -1e9; for (let k = 0; k < 6; k++) { const b = (k / 6) * Math.PI * 2; g = Math.max(g, heightAt(q.x + Math.cos(b) * 1.6, q.z + Math.sin(b) * 1.6)); }
      g = Math.max(g, heightAt(q.x, q.z));
      xs.push(q); fixed.push(nearTower || i === 0 || i === M); floor.push(g + R + 0.35);
    }
    for (let i = 0; i <= M; i++) if (!fixed[i]) xs[i].y = Math.max(xs[i].y, floor[i]);
    for (let pass = 0; pass < 6; pass++) {
      const ys = xs.map((q) => q.y);
      for (let i = 1; i < M; i++) if (!fixed[i]) xs[i].y = Math.max(floor[i], ys[i - 1] * 0.25 + ys[i] * 0.5 + ys[i + 1] * 0.25);
    }
    this.curve = new THREE.CatmullRomCurve3(xs, false, 'centripetal', 0.5);
    this.curve.arcLengthDivisions = 6000;
    this.length = this.curve.getLength();
    // where it goes under (the first point below -1) and where it comes back out for the drop to the beach
    const N = Math.ceil(this.length / 0.5);
    let sClose = -1, sOpen = this.length - 9;
    for (let i = 0; i <= N; i++) { const s = (i / N) * this.length, p = this.curve.getPointAt(s / this.length, this._p); if (sClose < 0 && p.y < 0.4) sClose = Math.max(0, s - 6); }
    this.sClose = sClose < 0 ? this.length * 0.4 : sClose; this.sOpen = sOpen;

    this.build(shadows);
    scene.add(this.group);
  }

  // ------------------------------------------------------------------ the frame along the slide
  /** centre, tangent, side (horizontal) and up (the tube's own "down" is -up) at arc length s */
  frame(s: number) {
    const u = Math.max(0, Math.min(1, s / this.length));
    const p = this.curve.getPointAt(u, this._p), t = this.curve.getTangentAt(u, this._t).normalize();
    const side = this._s.crossVectors(t, UP); if (side.lengthSq() < 1e-6) side.set(1, 0, 0); side.normalize();
    const up = this._n.crossVectors(side, t).normalize();
    return { p, t, side, up };
  }

  // ------------------------------------------------------------------ building it
  private build(shadows: boolean) {
    const L = this.length, step0 = 0.55;
    // the chute: yellow inside with orange stripes along it; the glass tube: barely there, catching the light at a slant
    const chute = new THREE.MeshStandardMaterial({ color: '#ffb52a', side: THREE.DoubleSide, roughness: 0.25, metalness: 0 });
    const glass = new THREE.MeshStandardMaterial({ color: '#d8f6ff', side: THREE.DoubleSide, transparent: true, opacity: 0.16, depthWrite: false, roughness: 0.05, metalness: 0 });
    const hoopM = new THREE.MeshStandardMaterial({ color: '#f4f7fa', roughness: 0.4, metalness: 0.2 });
    const steel = new THREE.MeshStandardMaterial({ color: '#e9eef2', roughness: 0.45, metalness: 0.35 });

    // a swept ring of the cross-section: open (bottom half plus a lip) or closed (all round)
    const sweep = (s0: number, s1: number, open: boolean, segs: number) => {
      const n = Math.max(2, Math.ceil((s1 - s0) / step0)), th0 = open ? Math.PI * 0.86 : 0, th1 = open ? Math.PI * 2.14 : Math.PI * 2;
      const pos: number[] = [], nor: number[] = [], uvs: number[] = [], idx: number[] = [];
      for (let i = 0; i <= n; i++) {
        const s = s0 + (s1 - s0) * (i / n), f = this.frame(s);
        for (let j = 0; j <= segs; j++) {
          const th = th0 + (th1 - th0) * (j / segs), c = Math.cos(th), sn = Math.sin(th);
          const nx = f.side.x * c + f.up.x * sn, ny = f.side.y * c + f.up.y * sn, nz = f.side.z * c + f.up.z * sn;
          pos.push(f.p.x + nx * R, f.p.y + ny * R, f.p.z + nz * R); nor.push(-nx, -ny, -nz); uvs.push(j / segs, s);
        }
      }
      for (let i = 0; i < n; i++) for (let j = 0; j < segs; j++) { const a = i * (segs + 1) + j, b = a + segs + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); g.setIndex(idx);
      return g;
    };
    const add = (g: THREE.BufferGeometry, m: THREE.Material, cast: boolean, order = 0) => { const o = new THREE.Mesh(g, m); o.castShadow = cast && shadows; o.receiveShadow = shadows; o.renderOrder = order; o.frustumCulled = true; this.group.add(o); return o; };
    add(sweep(0, this.sClose, true, 22), chute, true);
    add(sweep(this.sClose, this.sOpen, false, 28), glass, false, 3);
    add(sweep(this.sOpen, L, true, 22), chute, true);
    // the outside of the open chute, a little bigger, orange (so the half-pipe has a thickness)
    const outer = new THREE.MeshStandardMaterial({ color: '#f26b12', roughness: 0.35, side: THREE.BackSide });
    const shell = (s0: number, s1: number) => { const g = sweep(s0, s1, true, 22); const p = g.attributes.position as THREE.BufferAttribute, nrm = g.attributes.normal as THREE.BufferAttribute; for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) - nrm.getX(i) * 0.06, p.getY(i) - nrm.getY(i) * 0.06, p.getZ(i) - nrm.getZ(i) * 0.06); return g; };
    add(shell(0, this.sClose), outer, true); add(shell(this.sOpen, L), outer, true);

    // hoops round the glass every few metres, and a thicker collar where it closes and opens
    const hoops: THREE.BufferGeometry[] = [];
    const hoop = (s: number, w: number) => {
      const f = this.frame(s), g = new THREE.TorusGeometry(R + 0.04, w, 6, 28);
      const m = new THREE.Matrix4().makeBasis(f.side, f.up, f.t).setPosition(f.p); g.applyMatrix4(m); hoops.push(g);
    };
    for (let s = this.sClose; s <= this.sOpen; s += 4) hoop(s, 0.05);
    hoop(this.sClose, 0.12); hoop(this.sOpen, 0.12);
    // supports: posts from the tube down to the ground or the sea floor; radial arms from the spiral to the tower
    const posts: THREE.BufferGeometry[] = [];
    const post = (x: number, z: number, yTop: number, r = 0.14) => {
      const g0 = heightAt(x, z), h = yTop - g0; if (h < 0.4) return;
      posts.push(new THREE.CylinderGeometry(r, r * 1.2, h, 8).translate(x, g0 + h / 2, z));
      if (g0 > -0.5) { const c: Collider = { x, z, r: r + 0.1 }; this.colliders.add(c); this.cols.push(c); }
    };
    const sSpiralEnd = this.curve.getLength() * 0;
    void sSpiralEnd;
    for (let s = 3; s < L - 2; s += 7) {
      const f = this.frame(s), bottom = f.p.y - R;
      const dT = Math.hypot(f.p.x - this.tower.x, f.p.z - this.tower.z);
      const da = Math.atan2(f.p.z - this.tower.z, f.p.x - this.tower.x) - this.ladderFace();
      const offLadder = Math.abs(Math.atan2(Math.sin(da), Math.cos(da))) > 0.55;
      if (dT < 6.5 && f.p.y > this.tower.g + 2) {
        if (!offLadder) continue;                                            // (no arm across the ladder)
        // an arm to the tower
        const ax = this.tower.x - f.p.x, az = this.tower.z - f.p.z, al = Math.hypot(ax, az);
        const arm = new THREE.BoxGeometry(0.16, 0.16, al - 1.2); const mm = new THREE.Matrix4().lookAt(new THREE.Vector3(), new THREE.Vector3(ax, 0, az), UP);
        arm.applyMatrix4(mm); arm.translate(f.p.x + ax / al * (R + (al - 1.2 - R) / 2 + 0.0), bottom + 0.2, f.p.z + az / al * (R + (al - 1.2 - R) / 2));
        posts.push(arm);
      } else post(f.p.x, f.p.z, bottom + 0.05);
    }
    // the tower: four legs, bracing, the platform, railings and the ladder
    const T = this.tower, hw = 1.4, top = T.top;
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const x = T.x + sx * hw, z = T.z + sz * hw, g0 = heightAt(x, z);
      posts.push(new THREE.CylinderGeometry(0.13, 0.17, top - g0, 8).translate(x, (top + g0) / 2, z));
      const c: Collider = { x, z, r: 0.25 }; this.colliders.add(c); this.cols.push(c);
    }
    for (let y = T.g + 2; y < top - 0.5; y += 3) for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4, b = a + Math.PI / 2, r = hw * Math.SQRT2;
      const x0 = T.x + Math.cos(a) * r, z0 = T.z + Math.sin(a) * r, x1 = T.x + Math.cos(b) * r, z1 = T.z + Math.sin(b) * r;
      const len = Math.hypot(x1 - x0, 3, z1 - z0), br = new THREE.CylinderGeometry(0.05, 0.05, len, 6);
      const d = new THREE.Vector3(x1 - x0, 3, z1 - z0).normalize(); br.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d)); br.translate((x0 + x1) / 2, y + 1.5, (z0 + z1) / 2);
      posts.push(br);
    }
    const deck = new THREE.BoxGeometry(hw * 2 + 0.9, 0.18, hw * 2 + 0.9).translate(T.x, top - 0.09, T.z);
    const rails: THREE.BufferGeometry[] = [];
    // railings on three sides; the side facing the chute's start stays open
    const toStart = Math.atan2(this.start.z - T.z, this.start.x - T.x);
    // (and a gap in the railing where the ladder comes up: the same face the ladder picks below)
    const ladderFace = this.ladderFace();
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      let da = a - toStart; da = Math.atan2(Math.sin(da), Math.cos(da));
      if (Math.abs(da) < Math.PI / 4) continue;
      if (Math.abs(Math.atan2(Math.sin(a - ladderFace), Math.cos(a - ladderFace))) < 0.1) continue;
      const e = hw + 0.45, cx = T.x + Math.cos(a) * e, cz = T.z + Math.sin(a) * e;
      const along = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
      const rail = new THREE.BoxGeometry(0.06, 0.06, hw * 2 + 0.9); rail.applyMatrix4(new THREE.Matrix4().lookAt(new THREE.Vector3(), along, UP)); rail.translate(cx, top + 1.0, cz); rails.push(rail);
      for (const t of [-1, -0.5, 0, 0.5, 1]) rails.push(new THREE.CylinderGeometry(0.03, 0.03, 1.0, 5).translate(cx + along.x * t * (hw + 0.4), top + 0.5, cz + along.z * t * (hw + 0.4)));
    }
    // the ladder: square on to whichever face of the (square) tower looks most towards the island, never the chute's side;
    // just off the edge of the deck, its rails running up past the deck as handholds and its rungs across between them
    const la = this.ladderFace();
    const lr = hw + 0.6, lx = T.x + Math.cos(la) * lr, lz = T.z + Math.sin(la) * lr;
    this.ladder = { x: lx, z: lz, nx: Math.cos(la), nz: Math.sin(la), yaw: Math.atan2(Math.cos(la), Math.sin(la)) };
    const lg0 = heightAt(lx, lz) - 0.1, side = new THREE.Vector3(-Math.sin(la), 0, Math.cos(la));
    for (const sgn of [-1, 1]) rails.push(new THREE.CylinderGeometry(0.045, 0.045, top - lg0 + 1.1, 6).translate(lx + side.x * 0.32 * sgn, (top + lg0 + 1.1) / 2, lz + side.z * 0.32 * sgn));
    const across = new THREE.Quaternion().setFromUnitVectors(UP, side);
    for (let y = lg0 + 0.35; y < top + 0.05; y += 0.32) rails.push(new THREE.CylinderGeometry(0.028, 0.028, 0.64, 6).applyQuaternion(across).translate(lx, y, lz));
    // two stand-offs tying the ladder to the deck edge at the top
    for (const sgn of [-1, 1]) { const st = new THREE.CylinderGeometry(0.03, 0.03, 0.2, 5).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, new THREE.Vector3(Math.cos(la), 0, Math.sin(la)))); st.translate(lx + side.x * 0.32 * sgn - Math.cos(la) * 0.1, top - 0.1, lz + side.z * 0.32 * sgn - Math.sin(la) * 0.1); rails.push(st); }
    const merged = (list: THREE.BufferGeometry[]) => { const out = list.map((g) => g.index ? g.toNonIndexed() : g); for (const g of out) { g.deleteAttribute('uv'); } return mergeAll(out); };
    add(merged(posts), steel, true);
    add(merged([deck]), new THREE.MeshStandardMaterial({ color: '#7d5530', roughness: 0.9 }), true);
    add(merged(rails), steel, true);
    add(merged(hoops), hoopM, true);
    // a pennant on top
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.5), new THREE.MeshStandardMaterial({ color: '#e23b3b', side: THREE.DoubleSide, roughness: 0.8 }));
    flag.position.set(T.x - hw, top + 3.0, T.z - hw); this.group.add(flag);
    posts.length = 0;
    this.group.add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3.4, 5).translate(T.x - hw - 0.45, top + 1.7, T.z - hw), steel));
  }

  // ------------------------------------------------------------------ standing on the platform
  /** the platform's floor (for the player's ground) */
  ground(x: number, z: number, y: number): number {
    const T = this.tower, h = 1.4 + 0.45;
    if (Math.abs(x - T.x) <= h && Math.abs(z - T.z) <= h && y >= T.top - 0.7) return T.top;
    return -Infinity;
  }

  // ------------------------------------------------------------------ getting on
  /** near the chute's mouth on the platform? (E rides, or just walk into it) */
  nearStart(p: PV) { return Math.hypot(p.x - this.start.x, p.z - this.start.z) < 2.0 && Math.abs(p.y - this.tower.top) < 1.2; }
  /** walked into the ladder (or the chute) while pushing forward: take over */
  check(p: PV, yaw: number, push: number): 'ladder' | 'slide' | null {
    if (this.riding || this.climbing) return null;
    if (this.nearStart(p) && Math.hypot(p.x - this.start.x, p.z - this.start.z) < 1.2 && push > 0.2) return 'slide';
    const L = this.ladder, d = Math.hypot(p.x - L.x, p.z - L.z);
    if (d < 0.75 && p.y < this.tower.top - 0.3 && p.y > heightAt(L.x, L.z) - 0.5 && push > 0.2) {
      // facing the ladder (towards the tower)
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      if (fx * -L.nx + fz * -L.nz > 0.3) return 'ladder';
    }
    return null;
  }
  beginRide() { this.riding = true; this.climbing = false; this.s = 0.5; this.v = 2.5; this.bank = 0; this.yawOff = 0; this.lastYaw = NaN; this.sound?.('whoosh', 0.8); }
  beginClimb() { this.climbing = true; }

  /**
   * One frame of riding: moves `pos` (the feet) along the slide. Returns false when the ride is over (and sets `vel` to
   * the speed you leave with). `yaw` is the player's (desktop: the view turns with the slide; VR: left alone).
   */
  ride(dt: number, pos: PV, vel: PV, look: { yaw: number }, vr: boolean): boolean {
    let f = this.frame(this.s);
    // gravity along the slide, a little drag, and a push in the long flat bits and the tube so you never come to a stop
    const inTube = this.s > this.sClose && this.s < this.sOpen;
    const minV = this.s < 3 ? 2.5 : inTube ? 8 : 5;
    this.v += (-G * f.t.y - 0.06 * this.v) * dt;
    this.v = Math.max(minV, Math.min(17, this.v));
    this.s += this.v * dt;
    if (this.s >= this.length) {
      // spat out: leave along the slide's last direction
      f = this.frame(this.length);
      vel.set(f.t.x * this.v, Math.max(1.5, f.t.y * this.v + 2.5), f.t.z * this.v);
      pos.set(f.p.x + f.up.x * (-R + 0.35), f.p.y + f.up.y * (-R + 0.35), f.p.z + f.up.z * (-R + 0.35));
      this.riding = false; this.sound?.('land', 1);
      return false;
    }
    if (inTube && this.s - this.v * dt <= this.sClose) this.sound?.('splash', 0.8);
    f = this.frame(this.s);
    // bank up the wall in the bends: how hard the slide is turning (horizontal curvature) at this speed
    const ahead = this.frame(Math.min(this.length, this.s + 1.5));
    const t2x = ahead.t.x, t2z = ahead.t.z;
    f = this.frame(this.s);
    const turn = (f.t.x * t2z - f.t.z * t2x) / 1.5;                       // signed curvature (1/m)
    const want = Math.max(-1.0, Math.min(1.0, Math.atan2(this.v * this.v * turn, G)));
    this.bank += (want - this.bank) * Math.min(1, dt * 4);
    const c = Math.cos(this.bank), sn = Math.sin(this.bank);
    // feet on the floor of the chute (R - 0.25 out from the centre, swung up the wall by the bank); the eyes are then well inside
    const rr = R - 0.25;
    pos.set(f.p.x + (-f.up.x * c + f.side.x * sn) * rr, f.p.y + (-f.up.y * c + f.side.y * sn) * rr, f.p.z + (-f.up.z * c + f.side.z * sn) * rr);
    vel.set(f.t.x * this.v, f.t.y * this.v, f.t.z * this.v);
    if (!vr) {
      // the view turns with the slide; the mouse still looks about on top of that
      const ty = Math.atan2(-f.t.x, -f.t.z);
      if (Number.isNaN(this.lastYaw)) { this.yawOff = 0; this.lastYaw = ty; }
      let d = look.yaw - this.lastYaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yawOff = Math.max(-2.6, Math.min(2.6, this.yawOff + d));
      look.yaw = ty + this.yawOff; this.lastYaw = look.yaw;
      this.yawOff *= Math.exp(-dt * 0.8);                                      // drifts back to looking ahead
    }
    return true;
  }
  /** One frame on the ladder: up / down with forward / back (or jump), off at the top onto the platform */
  climb(dt: number, pos: PV, vel: PV, push: number, up: boolean): boolean {
    const L = this.ladder, g0 = heightAt(L.x, L.z);
    pos.x += (L.x + L.nx * 0.45 - pos.x) * Math.min(1, dt * 8); pos.z += (L.z + L.nz * 0.45 - pos.z) * Math.min(1, dt * 8);
    const sp = (up ? 1 : push) * 2.6;
    pos.y += sp * dt; vel.set(0, 0, 0);
    if (pos.y >= this.tower.top - 0.15) {
      // over the top and onto the deck
      pos.set(this.tower.x + L.nx * 0.9, this.tower.top, this.tower.z + L.nz * 0.9);
      this.climbing = false; this.say?.('At the top! Walk into the chute to slide.');
      return false;
    }
    if (pos.y <= g0 && push < -0.1) { pos.y = g0; this.climbing = false; return false; }
    return true;
  }

  dispose() { for (const c of this.cols) this.colliders.remove(c); }
}

function mergeAll(list: THREE.BufferGeometry[]) {
  let n = 0; for (const g of list) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of list) {
    if (!g.attributes.normal) g.computeVertexNormals();
    pos.set(g.attributes.position.array as Float32Array, o * 3); nor.set(g.attributes.normal.array as Float32Array, o * 3); o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}
