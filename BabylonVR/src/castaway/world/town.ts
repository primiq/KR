// Locations, Locations: one real place, built at run time from its baked level file (src/world/locations/<id>.data.json, made by
// scripts/loc-bake.mjs from OpenStreetMap or scripts/loc-layout.mjs from a hand-made layout). Generic: nothing here knows about
// any particular street. Same cave-style ground as the other special areas (player.cave = town).
// Built the first time somebody goes there. Everything static is merged into a handful of meshes; trees and lamps are instanced.
import * as THREE from 'three';
import { Mesher } from '../net/playerModel';
import { rayHit, sign, Board } from '../campaign/space';
import { townOrigin, OSM_CREDIT, type LocationEntry } from './locations';

const CELL = 0.5;                       // the ground mask (what you stand on: road, pavement, drive...)
const PAVE = 1.8, KERB = 0.13, ROAD_LIFT = 0.03;
const FOOT = new Set(['footway', 'path', 'cycleway', 'steps', 'bridleway', 'pedestrian', 'track']);
const AREA_COL: Record<string, string> = { drive_block: '#a8655c', drive_gravel: '#a9a49a', drive_tarmac: '#5a5e63', path: '#b9b4aa', lawn: '#5e9440', grass_mound: '#5a9a3c', grass: '#6a9a48', park: '#6a9a48', parking: '#5a5e63', plaza: '#b9b4aa', playground: '#c9a86a', pitch: '#5a9a40', water: '#3d7ea6', sand: '#d9c48a', wood: '#3f6a32', scrub: '#5d7a40', cemetery: '#6a9050', residential: '', farmland: '#a8a060', school: '' };
const AREA_LIFT: Record<string, number> = { drive_block: 0.035, drive_gravel: 0.035, drive_tarmac: 0.035, path: 0.045, lawn: 0.02, grass_mound: 0.025 };

type Seg = { ax: number; az: number; bx: number; bz: number; h: number };
type Circ = { x: number; z: number; r: number; h: number };

const hash = (n: number) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const shade = (hex: string, k: number) => '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();

export class Town {
  readonly group = new THREE.Group();
  readonly O: { x: number; y: number; z: number };
  active = false;
  built = false;
  private d: any;
  private R = 100;
  private mask!: Uint8Array; private mN = 0; private m0 = 0;
  private segs: Seg[] = []; private circs: Circ[] = [];
  private grid = new Map<number, number[]>(); private cgrid = new Map<number, number[]>();
  private night = { value: 0 };
  /** materials that follow the night (three's TSL nodes in Castaway; plain values the mirror re-reads here) */
  private nightFx: ((n: number) => void)[] = [];
  private glow!: THREE.Mesh;
  private litM: Mesher | null = null;
  private portal = new THREE.Group();
  private portalPane!: THREE.Mesh;
  private t = 0; private birdT = 2; private crickT = 1;
  sfx: { chirp(v: number): void; cricket(v: number): void; setHum(v: number): void } | null = null;

  constructor(readonly scene: THREE.Scene, readonly entry: LocationEntry, readonly index: number, private shadows: boolean, private lean: boolean) {
    this.O = townOrigin(index);
    this.group.position.set(this.O.x, this.O.y, this.O.z);
    this.group.visible = false;
    scene.add(this.group);
  }

  // ------------------------------------------------------------ the ground
  /** terrain height (local, metres) */
  gh(x: number, z: number) {
    const g = this.d.ground, fx = Math.max(0, Math.min(g.nx - 1.001, (x - g.x0) / g.sp)), fz = Math.max(0, Math.min(g.nz - 1.001, (z - g.z0) / g.sp));
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, H = (a: number, b: number) => g.h[b * g.nx + a] / 10;
    return (H(i, j) * (1 - u) + H(i + 1, j) * u) * (1 - v) + (H(i, j + 1) * (1 - u) + H(i + 1, j + 1) * u) * v;
  }
  private mk(x: number, z: number) { const i = Math.floor((x - this.m0) / CELL), j = Math.floor((z - this.m0) / CELL); return i < 0 || j < 0 || i >= this.mN || j >= this.mN ? 0 : this.mask[j * this.mN + i]; }
  private setMk(x: number, z: number, v: number, over = false) { const i = Math.floor((x - this.m0) / CELL), j = Math.floor((z - this.m0) / CELL); if (i < 0 || j < 0 || i >= this.mN || j >= this.mN) return; const k = j * this.mN + i; if (over || !this.mask[k]) this.mask[k] = v; }
  /** what you stand on (local): the terrain, raised by the pavement / drive under you */
  surf(x: number, z: number) { const m = this.mk(x, z); return this.gh(x, z) + (m === 2 ? KERB : m === 3 ? 0.035 : m === 1 ? ROAD_LIFT : 0); }

  contains(x: number, z: number) { return Math.abs(x - this.O.x) < this.R + 120 && Math.abs(z - this.O.z) < this.R + 120; }
  floor(x: number, z: number, _y: number) { return this.O.y + this.surf(x - this.O.x, z - this.O.z); }
  resolve(x: number, z: number, r: number, feetY: number, out: { x: number; z: number }) {
    let lx = x - this.O.x, lz = z - this.O.z;
    const ly = feetY - this.O.y;
    for (let pass = 0; pass < 2; pass++) {
      const key = this.key(lx, lz);
      for (const k of [key, key + 1, key - 1, key + 4096, key - 4096, key + 4097, key - 4097, key + 4095, key - 4095]) {
        for (const si of this.grid.get(k) ?? []) {
          const s = this.segs[si]; if (ly > s.h - 0.25) continue;
          const dx = s.bx - s.ax, dz = s.bz - s.az, L2 = dx * dx + dz * dz || 1e-9;
          const t = Math.max(0, Math.min(1, ((lx - s.ax) * dx + (lz - s.az) * dz) / L2)), px = s.ax + dx * t, pz = s.az + dz * t;
          const ex = lx - px, ez = lz - pz, d = Math.hypot(ex, ez);
          if (d < r) { if (d > 1e-5) { lx = px + (ex / d) * r; lz = pz + (ez / d) * r; } else { lx += -dz / Math.sqrt(L2) * r; lz += dx / Math.sqrt(L2) * r; } }
        }
        for (const ci of this.cgrid.get(k) ?? []) {
          const c = this.circs[ci]; if (ly > c.h) continue;
          const ex = lx - c.x, ez = lz - c.z, d = Math.hypot(ex, ez), rr = r + c.r;
          if (d < rr && d > 1e-5) { lx = c.x + (ex / d) * rr; lz = c.z + (ez / d) * rr; }
        }
      }
    }
    // the boundary wall: a circle you cannot get past at any height
    const rr = Math.hypot(lx, lz), lim = this.R - 0.45 - r;
    if (rr > lim) { lx *= lim / rr; lz *= lim / rr; }
    out.x = lx + this.O.x; out.z = lz + this.O.z;
  }
  private key(x: number, z: number) { return (Math.floor(x / 8) + 2048) * 4096 + Math.floor(z / 8) + 2048; }
  private addSeg(ax: number, az: number, bx: number, bz: number, h: number) {
    const i = this.segs.push({ ax, az, bx, bz, h }) - 1;
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 4) + 1;
    const keys = new Set<number>();
    for (let k = 0; k <= n; k++) keys.add(this.key(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n));
    for (const k of keys) { let a = this.grid.get(k); if (!a) this.grid.set(k, (a = [])); a.push(i); }
  }
  private addCirc(x: number, z: number, r: number, h: number) { const i = this.circs.push({ x, z, r, h }) - 1, k = this.key(x, z); let a = this.cgrid.get(k); if (!a) this.cgrid.set(k, (a = [])); a.push(i); }

  // ------------------------------------------------------------ coming and going
  enter(p: { teleport(x: number, y: number, z: number, yaw: number): void; cave: any }) {
    if (!this.built) this.build();
    this.active = true; this.group.visible = true; p.cave = this;
    const [x, z, yaw] = this.d.spawn;
    p.teleport(this.O.x + x / 10, this.O.y + this.surf(x / 10, z / 10), this.O.z + z / 10, yaw);
  }
  leave(p: { cave: any }) { this.active = false; this.group.visible = false; if (p.cave === this) p.cave = null; this.sfx?.setHum(0); }
  /** the exit doorway */
  pick(eye0: PV, dir0: PV, reach: number, assist = 1): number | null {
    const eye = _pe.set(eye0.x, eye0.y, eye0.z), dir = _pd.set(dir0.x, dir0.y, dir0.z);
    if (!this.active) return null;
    const [x, z] = this.d.exit, e = this._e.set(eye.x - this.O.x, eye.y - this.O.y, eye.z - this.O.z);
    return rayHit(e, dir, x / 10, this.surf(x / 10, z / 10) + 1.2, z / 10, 1.2, Math.max(reach, 3.2) + 1, assist);
  }
  private _e = new THREE.Vector3();

  update(dt: number, time: number, sunY: number, p: { pos: { x: number; y: number; z: number }; yaw: number; teleport(x: number, y: number, z: number, yaw: number): void }) {
    if (!this.active) return;
    this.t += dt;
    const night = Math.min(1, Math.max(0, (0.12 - sunY) / 0.25));
    if (night !== this.night.value) { this.night.value = night; for (const f of this.nightFx) f(night); }
    // the safety net: outside the wall, or under the ground, means back to the spawn
    const lx = p.pos.x - this.O.x, lz = p.pos.z - this.O.z;
    if (Math.hypot(lx, lz) > this.R + 0.5 || p.pos.y - this.O.y < this.gh(lx, lz) - 6) { const [x, z, yaw] = this.d.spawn; p.teleport(this.O.x + x / 10, this.O.y + this.surf(x / 10, z / 10), this.O.z + z / 10, yaw); }
    // the doorway home shimmers
    (this.portalPane.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.2 * Math.sin(time * 2.5);
    this.portal.children[this.portal.children.length - 1].rotation.z = time * 0.6;
    // a quiet town: a distant hum of traffic, birds by day, crickets at night
    if (this.sfx) {
      this.sfx.setHum(0.25);
      this.birdT -= dt; this.crickT -= dt;
      if (night < 0.5 && this.birdT <= 0) { this.birdT = 2 + Math.random() * 6; this.sfx.chirp(0.25 + Math.random() * 0.4); }
      if (night > 0.5 && this.crickT <= 0) { this.crickT = 0.6 + Math.random() * 1.6; this.sfx.cricket(0.2 + Math.random() * 0.2); }
    }
  }

  // ------------------------------------------------------------ building it all (once)
  private build() {
    this.built = true;
    const d = (this.d = this.entry.data());
    this.R = d.R;
    const R = this.R, look = d.look ?? {};
    const lit = (side: THREE.Side = THREE.FrontSide) => { const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, side }); m.userData.vcGlow = 0.18; return m; };
    // ---- the mask: carriageways, then pavements, then drives and paths
    this.m0 = -(R + 4); this.mN = Math.ceil((2 * (R + 4)) / CELL); this.mask = new Uint8Array(this.mN * this.mN);
    const roads = d.roads.map((r: any) => ({ k: r[0], w: r[1] / 10, sw: r[2], n: r[3], pts: pts2(r[5]) }));
    for (const r of roads) walk(r.pts, 0.35, (x, z, nx, nz) => { for (let o = -r.w / 2; o <= r.w / 2; o += 0.35) this.setMk(x + nx * o, z + nz * o, 1, true); });
    for (const r of roads) if (r.sw) walk(r.pts, 0.35, (x, z, nx, nz) => {
      for (const s of [1, -1]) { if (!(r.sw & (s > 0 ? 2 : 1))) continue; for (let o = r.w / 2 + 0.1; o <= r.w / 2 + PAVE; o += 0.35) this.setMk(x + nx * o * s, z + nz * o * s, 2); }
    });
    const areas = d.areas.map((a: any) => ({ k: a[0], pts: pts2(a[1]) }));
    for (const a of areas) if (a.k.startsWith('drive') || a.k === 'path' || a.k === 'parking' || a.k === 'plaza') fillPoly(a.pts, CELL, (x, z) => this.setMk(x, z, 3));

    // ---- terrain (2 m grid), out past the wall into the woods, then hills all round so the world never just ends
    {
      const E = R + 70, sp = this.lean ? 4 : 2, n = Math.round((2 * E) / sp);
      const pos: number[] = [], col: number[] = [], idx: number[] = [], c = new THREE.Color(), g1 = new THREE.Color('#5d8f3e'), g2 = new THREE.Color('#4f7f36'), wood = new THREE.Color('#33502a');
      for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
        const x = -E + i * sp, z = -E + j * sp, r = Math.hypot(x, z);
        pos.push(x, this.gh(x, z) - (r > R + 1 ? 0.2 : 0), z);
        c.copy(g1).lerp(g2, hash(Math.floor(x / 3) * 31 + Math.floor(z / 3))).lerp(wood, Math.min(1, Math.max(0, (r - R) / 6)));
        col.push(c.r, c.g, c.b);
      }
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i, b = a + 1, e = a + n + 1, f = e + 1; idx.push(a, e, b, b, e, f); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
      const m = new THREE.Mesh(g, lit()); m.receiveShadow = this.shadows; m.frustumCulled = false; this.group.add(m);
      // the hills: a ring from the edge of the woods out to the horizon, rising, in fog-coloured greens
      const ring: number[] = [], rc: number[] = [], ri: number[] = [], seg = 64, rings = 6;
      for (let k = 0; k <= rings; k++) for (let a = 0; a <= seg; a++) {
        const th = (a / seg) * Math.PI * 2, rr = E - 2 + (k / rings) ** 1.6 * 900, h = this.gh(Math.cos(th) * E, Math.sin(th) * E) + (k / rings) * (40 + 30 * Math.sin(th * 3 + 1) * Math.sin(th * 5));
        ring.push(Math.cos(th) * rr, h, Math.sin(th) * rr); c.set('#2f4a2a').lerp(new THREE.Color('#6a8a6a'), k / rings); rc.push(c.r, c.g, c.b);
      }
      for (let k = 0; k < rings; k++) for (let a = 0; a < seg; a++) { const p0 = k * (seg + 1) + a, p1 = p0 + 1, p2 = p0 + seg + 1, p3 = p2 + 1; ri.push(p0, p1, p2, p1, p3, p2); }
      const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(ring, 3)); rg.setAttribute('color', new THREE.Float32BufferAttribute(rc, 3)); rg.setIndex(ri); rg.computeVertexNormals();
      const rm = new THREE.Mesh(rg, lit(THREE.DoubleSide)); rm.frustumCulled = false; this.group.add(rm);
    }

    // ---- roads, pavements with kerbs, areas, markings (one mesh each layer; polygon offset keeps the layers apart)
    const layer = (off: number) => { const m = lit(THREE.DoubleSide); m.polygonOffset = true; m.polygonOffsetFactor = -off; m.polygonOffsetUnits = -off * 2; return m; };
    {
      const asphalt = look.road?.asphalt ?? '#4b4f55', paveC = look.pavement ?? '#5d6166', kerbC = look.kerb ?? '#b9b6ae';
      const RM = new Strip(), PM = new Strip(), AM = new Strip(), XM = new Strip();
      for (const r of roads) {
        const c = FOOT.has(r.k) ? '#9a8a70' : asphalt;
        // the carriageway: a ribbon that follows the ground
        const L: number[][] = [], Rr: number[][] = [];
        walk(r.pts, 1.5, (x, z, nx, nz) => { L.push([x + (nx * r.w) / 2, z + (nz * r.w) / 2]); Rr.push([x - (nx * r.w) / 2, z - (nz * r.w) / 2]); }, true);
        for (let i = 1; i < L.length; i++) RM.quad(this.v(L[i - 1], ROAD_LIFT), this.v(L[i], ROAD_LIFT), this.v(Rr[i], ROAD_LIFT), this.v(Rr[i - 1], ROAD_LIFT), c);
        // the pavements: raised slabs with a kerb face towards the road, broken where another road joins
        for (const s of [1, -1]) {
          if (!(r.sw & (s > 0 ? 2 : 1))) continue;
          let prev: { a: number[]; b: number[] } | null = null;
          walk(r.pts, 1.0, (x, z, nx, nz) => {
            const a = [x + nx * s * (r.w / 2), z + nz * s * (r.w / 2)], b = [x + nx * s * (r.w / 2 + PAVE), z + nz * s * (r.w / 2 + PAVE)];
            const mid = [x + nx * s * (r.w / 2 + PAVE / 2), z + nz * s * (r.w / 2 + PAVE / 2)];
            const onRoad = this.mk(mid[0], mid[1]) === 1;
            if (prev && !onRoad) {
              const p = prev;
              PM.quad(this.v(p.a, KERB), this.v(a, KERB), this.v(b, KERB), this.v(p.b, KERB), paveC);
              PM.quad(this.v(p.a, 0), this.v(a, 0), this.v(a, KERB), this.v(p.a, KERB), kerbC);       // the kerb face
              PM.quad(this.v(b, 0), this.v(p.b, 0), this.v(p.b, KERB), this.v(b, KERB), shade(paveC, 0.8));
              PM.quad(this.v([p.a[0] + (a[0] - p.a[0]) * 0, p.a[1]], KERB + 0.005), this.v(a, KERB + 0.005), this.v([a[0] + (b[0] - a[0]) * 0.09, a[1] + (b[1] - a[1]) * 0.09], KERB + 0.005), this.v([p.a[0] + (p.b[0] - p.a[0]) * 0.09, p.a[1] + (p.b[1] - p.a[1]) * 0.09], KERB + 0.005), kerbC);
            }
            prev = onRoad ? null : { a, b };
          }, true);
        }
      }
      for (const a of areas) {
        const col = AREA_COL[a.k]; if (!col) continue;
        const lift = AREA_LIFT[a.k] ?? 0.03;
        const tris = THREE.ShapeUtils.triangulateShape(a.pts.map(([x, z]: number[]) => new THREE.Vector2(x, z)), []);
        for (const [i0, i1, i2] of tris) AM.tri(this.v(a.pts[i0], lift), this.v(a.pts[i1], lift), this.v(a.pts[i2], lift), shade(col, 0.92 + 0.16 * hash(i0 + a.pts.length)));
      }
      // patched tarmac strips along the road
      for (const [ri, from, to, off, w] of d.patches ?? []) {
        const r = roads[ri]; if (!r) continue;
        let s = 0, prev: number[][] | null = null;
        walk(r.pts, 1.0, (x, z, nx, nz) => {
          s += 1; if (s < from || s > to) { prev = null; return; }
          const a = [x + nx * (off - w / 2), z + nz * (off - w / 2)], b = [x + nx * (off + w / 2), z + nz * (off + w / 2)];
          if (prev) XM.quad(this.v(prev[0], ROAD_LIFT), this.v(a, ROAD_LIFT), this.v(b, ROAD_LIFT), this.v(prev[1], ROAD_LIFT), look.road?.patch ?? '#3c3f44');
          prev = [a, b];
        }, true);
      }
      const add = (S: Strip, off: number) => { if (!S.n) return; const m = new THREE.Mesh(S.geometry(), layer(off)); m.receiveShadow = this.shadows; m.frustumCulled = false; this.group.add(m); };
      add(RM, 2); add(PM, 1); add(AM, 3); add(XM, 4);
      // painted markings: "20" roundels and give-way lines (canvas decals)
      for (const [kind, x, z, yaw] of d.marks ?? []) {
        const b = new Board(kind === '20' ? 2.4 : 3.2, kind === '20' ? 3.2 : 0.8, 256, false, true);
        b.draw(kind, (g, W, H) => {
          g.clearRect(0, 0, W, H); g.strokeStyle = g.fillStyle = 'rgba(240,240,236,0.92)';
          if (kind === '20') { g.lineWidth = 16; g.beginPath(); g.ellipse(W / 2, H / 2, W / 2 - 12, H / 2 - 12, 0, 0, Math.PI * 2); g.stroke(); g.font = `900 ${H * 0.42}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.save(); g.translate(W / 2, H / 2); g.scale(1, 1.35); g.fillText('20', 0, 0); g.restore(); }
          else for (let i = 0; i < 6; i++) g.fillRect(i * (W / 6) + 6, H * 0.2, W / 6 - 18, H * 0.25);
        });
        const m = b.mesh; m.rotation.set(-Math.PI / 2, 0, yaw); m.position.set(x / 10, this.gh(x / 10, z / 10) + ROAD_LIFT + 0.004, z / 10);
        const mat = m.material as THREE.MeshBasicMaterial; mat.polygonOffset = true; mat.polygonOffsetFactor = -6; mat.polygonOffsetUnits = -12; mat.toneMapped = true;
        this.group.add(m);
      }
    }

    // ---- buildings (merged: walls and roofs in one mesh, the window glass in another that glows at night)
    const BM = new Mesher(), GM = new Mesher(), LM = new Mesher();
    this.litM = LM;
    d.bld.forEach((B: any, i: number) => this.house(B, i, BM, GM, look));
    {
      const m = BM.build(this.shadows); m.material = lit(THREE.DoubleSide); m.castShadow = this.shadows; m.receiveShadow = this.shadows; this.group.add(m);
      const g = GM.build(false); const gm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.15, metalness: 0.2 });
      gm.userData.vcGlow = 0.15; g.material = gm; this.group.add(g);
      // the windows with a light on inside: dark glass by day, warm at night
      const l = LM.build(false); const lm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.15, metalness: 0.2 });
      lm.userData.vcGlow = 0.15; lm.userData.liveEmissive = true; lm.emissive.setRGB(1.0, 0.72, 0.38); lm.emissiveIntensity = 0; this.nightFx.push((n) => { lm.emissiveIntensity = n * 1.9; }); l.material = lm; this.group.add(l);
    }
    // ---- fences, walls, hedges
    {
      const FM = new Mesher();
      for (const [kind, h10, colr, p] of d.bar) {
        const pts = pts2(p), h = h10 / 10, col = colr || (kind === 'hedge' ? '#3f6a2a' : kind === 'wall' ? '#9a8a7a' : '#5a3a24');
        for (let i = 1; i < pts.length; i++) {
          const [ax, az] = pts[i - 1], [bx, bz] = pts[i], L = Math.hypot(bx - ax, bz - az); if (L < 0.05) continue;
          const yaw = Math.atan2(bx - ax, bz - az), n = Math.max(1, Math.round(L / 2.4));
          for (let k = 0; k < n; k++) {
            const t0 = k / n, t1 = (k + 1) / n, x = ax + (bx - ax) * (t0 + t1) / 2, z = az + (bz - az) * (t0 + t1) / 2, y = this.gh(x, z);
            if (kind === 'hedge') FM.box(0.8, h, L / n + 0.1, shade(col, 0.9 + 0.2 * hash(k)), x, y + h / 2, z, 0, yaw, 0);
            else if (kind === 'fence') {
              FM.box(0.04, h, L / n, col, x, y + h / 2, z, 0, yaw, 0);
              for (let s = 0; s < 6; s++) FM.box(0.06, h - 0.05, 0.12, shade(col, 0.82 + 0.1 * (s % 2)), x + Math.sin(yaw) * (s / 6 - 0.42) * (L / n), y + h / 2, z + Math.cos(yaw) * (s / 6 - 0.42) * (L / n), 0, yaw, 0);
              FM.box(0.1, h + 0.1, 0.1, shade(col, 0.7), ax + (bx - ax) * t0, this.gh(ax + (bx - ax) * t0, az + (bz - az) * t0) + h / 2, az + (bz - az) * t0, 0, yaw, 0);
            } else FM.box(0.25, h, L / n + 0.02, col, x, y + h / 2, z, 0, yaw, 0);
          }
          this.addSeg(ax, az, bx, bz, h);
        }
      }
      if ((FM as any).pos?.length !== 0) { const m = FM.build(this.shadows); m.material = lit(); m.castShadow = this.shadows; this.group.add(m); }
    }
    // ---- trees and shrubs (instanced), the wood beyond the wall
    this.trees(d.trees, R);
    // ---- lamps, signs, bins, parked cars
    this.furniture(d, look, lit);
    // ---- the boundary wall: tall harled wall with brick piers, no ledges, deep foundations so the ground cannot dip under it
    {
      const WM = new Mesher(), n = Math.ceil((Math.PI * 2 * R) / 4), wallC = '#d8cfbf', pierC = '#b48a72';
      for (let k = 0; k < n; k++) {
        const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2, am = (a0 + a1) / 2, rr = R + 0.3;
        const x = Math.cos(am) * rr, z = Math.sin(am) * rr, len = 2 * rr * Math.sin((a1 - a0) / 2) + 0.05;
        const g0 = Math.min(this.gh(Math.cos(a0) * rr, Math.sin(a0) * rr), this.gh(Math.cos(a1) * rr, Math.sin(a1) * rr), this.gh(x, z)) - 2;
        const top = Math.max(this.gh(Math.cos(a0) * rr, Math.sin(a0) * rr), this.gh(x, z)) + 12;
        const yaw = -am - Math.PI;          // so that yaw + PI/2 lays the panel along the circle
        WM.box(len, top - g0, 0.6, wallC, x, (top + g0) / 2, z, 0, yaw + Math.PI / 2, 0);
        WM.box(len + 0.02, 0.9, 0.62, '#8a6a52', x, g0 + 2 + 0.45, z, 0, yaw + Math.PI / 2, 0);                       // a brick base course
        if (k % 3 === 0) WM.box(0.9, top - g0 + 0.4, 0.9, pierC, Math.cos(a0) * (R + 0.45), (top + g0) / 2 + 0.2, Math.sin(a0) * (R + 0.45), 0, -a0 - Math.PI / 2, 0);
        WM.box(len + 0.1, 0.18, 0.78, '#9a948a', x, top + 0.09, z, 0, yaw + Math.PI / 2, 0);                         // coping
      }
      const m = WM.build(this.shadows); m.material = lit(); m.receiveShadow = this.shadows; this.group.add(m);
    }
    // ---- the way out: a freestanding door frame that glows, with a sign
    {
      const [x10, z10, yaw] = d.exit, x = x10 / 10, z = z10 / 10, y = this.surf(x, z);
      const P = new Mesher();
      P.box(0.18, 2.6, 0.22, '#2a2d33', -0.75, 1.3, 0); P.box(0.18, 2.6, 0.22, '#2a2d33', 0.75, 1.3, 0); P.box(1.7, 0.2, 0.24, '#2a2d33', 0, 2.65, 0); P.box(1.9, 0.08, 0.6, '#3a3d44', 0, 0.04, 0);
      const f = P.build(false); f.material = lit(); this.portal.add(f);
      this.portalPane = new THREE.Mesh(new THREE.PlaneGeometry(1.32, 2.5), new THREE.MeshBasicMaterial({ color: '#7fffe0', transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }));
      this.portalPane.position.set(0, 1.3, 0); this.portal.add(this.portalPane);
      const s = sign(['EXIT', 'to Locations'], 1.3, 0.48, '#16a085', '#ffffff'); s.position.set(0, 3.05, 0.13); this.portal.add(s);
      const s2 = s.clone(); s2.rotation.y = Math.PI; s2.position.z = -0.13; this.portal.add(s2);
      const halo = new THREE.Mesh(new THREE.RingGeometry(0.2, 1.6, 32), new THREE.MeshBasicMaterial({ color: '#9ffff0', transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
      halo.position.set(0, 1.3, -0.02); this.portal.add(halo);
      this.portal.position.set(x, y, z); this.portal.rotation.y = yaw; this.group.add(this.portal);
      this.addCirc(x - Math.cos(yaw) * 0.75, z + Math.sin(yaw) * 0.75, 0.15, 3); this.addCirc(x + Math.cos(yaw) * 0.75, z - Math.sin(yaw) * 0.75, 0.15, 3);
      // the info board beside it: where this place comes from
      const info = sign([d.name, d.source === 'layout' ? 'Built by hand from photos of the real street' : OSM_CREDIT, d.source === 'layout' ? 'Positions are approximate · Locations, Locations' : 'Locations, Locations'], 1.6, 0.6, '#1d242c', '#e8eef5', '#16a085');
      const bx = x + Math.cos(yaw) * 1.6, bz = z - Math.sin(yaw) * 1.6;
      info.position.set(bx, this.gh(bx, bz) + 1.3, bz); info.rotation.y = yaw + Math.PI; this.group.add(info);
      const pm = new Mesher(); pm.box(0.08, 1.0, 0.08, '#333', 0, 0.5, 0); const post = pm.build(false); post.material = lit(); post.position.set(bx, this.gh(bx, bz), bz); this.group.add(post);
    }
  }
  /** a point on the ground (local) lifted a little, as a vertex */
  private v(p: number[], lift: number): number[] { return [p[0], this.gh(p[0], p[1]) + lift, p[1]]; }

  // ------------------------------------------------------------ houses
  private house(B: any, i: number, M: Mesher, G: Mesher, look: any) {
    const pts = pts2(B.p), s = B.sty;
    if (!s || pts.length !== 4) { this.block(B, pts, M, G, look, i); return; }
    let cx = 0, cz = 0; for (const [x, z] of pts) { cx += x; cz += z; } cx /= 4; cz /= 4;
    const w = s.w, dd = s.d, th = Math.atan2(s.fx, s.fz), C = Math.cos(th), S = Math.sin(th);
    const base = Math.min(...pts.map(([x, z]) => this.gh(x, z)), this.gh(cx, cz));
    const W = (a: number, c: number) => [cx + a * C + c * S, cz - a * S + c * C];
    const box = (bw: number, bh: number, bd: number, col: string, a: number, y: number, c: number, MM: Mesher = M, rx = 0) => { const [x, z] = W(a, c); MM.box(bw, bh, bd, col, x, base + y, z, rx, th, 0); };
    const type = s.type as string, split = type === 'split';
    const H = type === 'twostorey' ? 5.4 : split ? 5.2 : type === 'dormer' ? 2.9 : 2.7;
    const bh = split ? 2.6 : 0.5;
    const wall = s.wall ?? '#e6ddd0', baseC = s.base ?? (split ? '#9c4a32' : shade(wall, 0.55)), frame = look.windows?.frame ?? '#6b4426', glass = '#34444f';
    const ds = s.ds ?? -1, ga = Math.max(-w / 2 + 1.6, Math.min(w / 2 - 1.6, (w / 2 - 1.8)));     // the garage / drive side (local +a)
    // walls: a brick base course (or a whole brick garage storey), render above, a plinth down into the slope
    box(w, 2.2, dd, shade(baseC, 0.8), 0, -1.1, 0);
    box(w + 0.04, bh, dd + 0.04, baseC, 0, bh / 2, 0);
    box(w, H - bh, dd, wall, 0, bh + (H - bh) / 2, 0);
    const win = (a: number, y: number, ww: number, hh: number, face = 1, sideWall = false) => {
      const GG = hash(i * 13 + a * 7 + y) > 0.55 ? this.litM! : G;
      if (sideWall) { const c = face * (w / 2 + 0.02); const [x, z] = W(c, a); M.box(0.06, hh + 0.12, ww + 0.12, frame, x, base + y, z, 0, th, 0); GG.box(0.07, hh, ww, glass, x, base + y, z, 0, th, 0); return; }
      box(ww + 0.12, hh + 0.12, 0.06, frame, a, y, face * (dd / 2 + 0.02)); box(ww, hh, 0.07, glass, a, y, face * (dd / 2 + 0.025), GG);
      box(ww + 0.2, 0.06, 0.12, '#cfc9bd', a, y - hh / 2 - 0.08, face * (dd / 2 + 0.05));          // the sill
    };
    const doorAt = (a: number, y: number, col: string, c = dd / 2 + 0.02) => { box(1.0, 2.05, 0.06, col, a, y + 1.03, c); box(0.3, 0.5, 0.07, '#c8d8e0', a, y + 1.5, c + 0.005, G); box(0.06, 0.06, 0.06, '#d9a93a', a + 0.36, y + 1.0, c + 0.04); };
    if (split) {
      // ground storey: the garage under the house (this street's look), upper storey: a picture window over a balcony
      box(2.7, 2.15, 0.08, s.garage ?? '#2f6b4f', ga - 0.6, 1.08, dd / 2 + 0.03);
      for (let k = 0; k < 6; k++) box(2.6, 0.03, 0.1, shade(s.garage ?? '#2f6b4f', 0.8), ga - 0.6, 0.2 + k * 0.35, dd / 2 + 0.05);
      win(-ga + 0.4, 1.4, 1.0, 0.8);
      win(ga - 0.6, 3.9, 2.8, 1.5); win(-ga + 0.6, 4.0, 1.4, 1.2);
      if (s.balcony) {
        box(3.4, 0.14, 1.0, '#8a8580', ga - 0.6, 2.62, dd / 2 + 0.5);
        for (let k = 0; k <= 8; k++) box(0.03, 0.9, 0.03, '#141414', ga - 0.6 - 1.65 + k * (3.3 / 8), 3.15, dd / 2 + 0.98);
        box(3.4, 0.05, 0.05, '#141414', ga - 0.6, 3.6, dd / 2 + 0.98); box(3.4, 0.04, 0.04, '#141414', ga - 0.6, 2.85, dd / 2 + 0.98);
        for (const sx of [-1, 1]) box(0.04, 0.9, 1.0, '#141414', ga - 0.6 + sx * 1.68, 3.15, dd / 2 + 0.5);
      }
      // the door is up at the side, reached by steps with a black railing
      const sa = -w / 2 - 0.65;
      for (let k = 0; k < 8; k++) box(1.1, 0.33 * (k + 1), 0.4, '#9a958c', sa, 0.165 * (k + 1), dd / 2 - 0.3 - k * 0.38);
      for (let k = 0; k < 8; k++) box(0.03, 0.9, 0.03, '#141414', sa - 0.55, 0.33 * (k + 1) + 0.45, dd / 2 - 0.3 - k * 0.38);
      const dc = dd / 2 - 3.5;
      box(1.1, 2.64, 1.1, '#9a958c', sa, 1.32, dc);                                                        // the landing
      box(0.06, 2.05, 1.0, s.door ?? '#6b4426', -w / 2 - 0.03, 2.64 + 1.03, dc); box(0.07, 0.5, 0.3, '#c8d8e0', -w / 2 - 0.04, 2.64 + 1.5, dc, G);
      if (s.plaque) { const pb = new Board(0.22, 0.22, 64); pb.draw(s.plaque, (g, Wd, Hd) => { g.fillStyle = '#20262c'; g.beginPath(); g.arc(Wd / 2, Hd / 2, Wd / 2 - 2, 0, 7); g.fill(); g.fillStyle = '#f2f2f2'; g.font = `800 ${Wd * 0.45}px system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(s.plaque, Wd / 2, Hd / 2 + 2); }); const [px, pz] = W(-ga + 1.3, dd / 2 + 0.05); pb.mesh.position.set(px, base + 1.55, pz); pb.mesh.rotation.y = th; this.group.add(pb.mesh); }
    } else {
      const doorA = -ds * 0 + (s.garage ? -ga + 2.2 : 0);
      if (s.porch) { box(1.6, 2.3, 0.6, shade(wall, 0.45), doorA, 1.15, dd / 2 - 0.25); for (let k = 0; k < 3; k++) box(1.6, 0.15 * (k + 1), 0.35, '#9a958c', doorA, 0.075 * (k + 1), dd / 2 + 0.75 - k * 0.3); for (const sx of [-1, 1]) for (let k = 0; k < 5; k++) box(0.03, 0.85, 0.03, '#141414', doorA + sx * 0.82, 0.8, dd / 2 + 0.95 - k * 0.22); doorAt(doorA, 0.45, s.door ?? '#6b4426', dd / 2 - 0.55); }
      else { doorAt(doorA, 0.08, s.door ?? '#6b4426'); for (let k = 0; k < 2; k++) box(1.3, 0.15 * (k + 1), 0.35, '#9a958c', doorA, 0.075 * (k + 1), dd / 2 + 0.5 - k * 0.3); }
      const wins = s.garage ? [-ga - 0.6 + (doorA > 0 ? 0 : 0)] : [-w / 4 - 0.5, w / 4 + 0.5];
      for (const a of wins) if (Math.abs(a - doorA) > 1.3) win(a, 1.55, 1.7, 1.15);
      if (s.garage) { box(2.5, 2.1, 0.08, s.garage, ga - 0.5, 1.05, dd / 2 + 0.03); for (let k = 0; k < 6; k++) box(2.4, 0.03, 0.1, shade(s.garage, 0.82), ga - 0.5, 0.2 + k * 0.35, dd / 2 + 0.05); }
      if (s.bay) { box(2.4, 1.7, 0.7, wall, -ga + 0.4, 1.35, dd / 2 + 0.35); box(2.2, 1.2, 0.07, glass, -ga + 0.4, 1.55, dd / 2 + 0.71, G); box(2.6, 0.12, 0.9, frame, -ga + 0.4, 2.25, dd / 2 + 0.38); box(2.6, 0.12, 0.9, '#5b3a32', -ga + 0.4, 2.36, dd / 2 + 0.38); }
      if (type === 'twostorey') { win(-w / 4, 4.1, 1.4, 1.1); win(w / 4, 4.1, 1.4, 1.1); }
      if (s.conservatory) { box(3.2, 2.4, 2.4, '#f2f2f2', 0, 1.2, -dd / 2 - 1.2); box(3.0, 1.6, 2.2, '#c8dce4', 0, 1.4, -dd / 2 - 1.2, G); box(3.4, 0.1, 2.6, '#e8e8e8', 0, 2.5, -dd / 2 - 1.2, M, -0.25); }
    }
    // windows round the sides and back
    win(0, split ? 3.9 : 1.55, 1.3, 1.0, -1); win(w / 4, split ? 3.9 : 1.55, 1.0, 1.0, -1);
    win(0, split ? 3.9 : 1.55, 1.0, 0.9, 1, true); win(0, split ? 3.9 : 1.55, 1.0, 0.9, -1, true);
    // the roof
    const roofC = s.roof ?? '#4a4a4c', gabled = s.roofShape === 'gabled', ov = 0.35, Wr = w + 2 * ov, Dr = dd + 2 * ov;
    const rise = (type === 'dormer' ? 0.95 : gabled ? 0.62 : 0.52) * (Math.min(Wr, Dr) / 2);
    const rg = roofGeometry(Wr, Dr, rise, gabled);
    const [rx, rz] = W(0, 0);
    M.add(rg.roof, roofC, rx, base + H, rz, 0, th, 0);
    if (rg.gables) M.add(rg.gables, wall, rx, base + H, rz, 0, th, 0);
    // ridge tiles, a chimney sometimes, a TV aerial often (the photos are full of them)
    if (Wr >= Dr) box(gabled ? Wr : Wr - Dr + 0.1, 0.12, 0.2, shade(roofC, 0.75), 0, H + rise + 0.03, 0);
    else box(0.2, 0.12, gabled ? Dr : Dr - Wr + 0.1, shade(roofC, 0.75), 0, H + rise + 0.03, 0);
    if (type === 'dormer') {
      box(2.4, 1.3, 1.6, wall, -0.2, H + 0.65, dd / 2 - 0.9); box(2.0, 0.9, 0.07, glass, -0.2, H + 0.7, dd / 2 - 0.08, G);
      box(2.7, 0.12, 1.9, roofC, -0.2, H + 1.36, dd / 2 - 0.85);
      if (s.skylight) { const [kx, kz] = W(w / 4, dd / 4); G.box(0.8, 0.05, 1.0, '#7fa8c0', kx, base + H + rise * 0.55, kz, -Math.atan2(rise, Dr / 2), th, 0); }
    }
    if (hash(i * 3.3) > 0.62) box(0.5, 1.1, 0.6, shade(baseC, 0.9), (Wr >= Dr ? 1 : 0) * (w / 2 - 1.2), H + rise * 0.6 + 0.5, (Wr >= Dr ? 0 : 1) * (dd / 2 - 1.2));
    if (hash(i * 7.7) > 0.3) {
      const aa = (hash(i) - 0.5) * w * 0.5;
      box(0.04, 1.6, 0.04, '#777', aa, H + rise + 0.8, 0); box(0.9, 0.025, 0.025, '#777', aa, H + rise + 1.4, 0); box(0.6, 0.025, 0.025, '#777', aa, H + rise + 1.15, 0); box(0.025, 0.025, 0.7, '#777', aa, H + rise + 1.5, 0);
    }
    // solid walls for walking into
    for (let k = 0; k < 4; k++) { const [ax, az] = pts[k], [bx, bz] = pts[(k + 1) % 4]; this.addSeg(ax, az, bx, bz, base + H + rise); }
  }
  /** anything else (a footprint from the map): walls straight up, a flat roof with a little parapet, rows of windows */
  private block(B: any, pts: number[][], M: Mesher, G: Mesher, look: any, i: number) {
    if (pts.length < 3) return;
    const h = (B.h ?? 60) / 10, base = Math.min(...pts.map(([x, z]) => this.gh(x, z)));
    const pal = look.walls ?? ['#e6ddd0', '#d9cbb4', '#cbb79a'], wall = B.wc || pal[i % pal.length], roof = B.rc || (look.roofs ?? ['#4a4a4c'])[i % (look.roofs?.length ?? 1)];
    for (let k = 0; k < pts.length; k++) {
      const [ax, az] = pts[k], [bx, bz] = pts[(k + 1) % pts.length], L = Math.hypot(bx - ax, bz - az), yaw = Math.atan2(bx - ax, bz - az);
      M.box(0.25, h + 2, L + 0.2, wall, (ax + bx) / 2, base + (h - 2) / 2, (az + bz) / 2, 0, yaw, 0);
      const levels = Math.max(1, Math.round(h / 3)), nwin = Math.floor(L / 3);
      const ox = Math.cos(yaw) * 0.14, oz = -Math.sin(yaw) * 0.14;
      for (let lv = 0; lv < levels; lv++) for (let wi = 0; wi < nwin; wi++) {
        const t = (wi + 0.5) / nwin, x = ax + (bx - ax) * t + ox, z = az + (bz - az) * t + oz;
        (hash(i + lv * 9 + wi) > 0.6 ? this.litM! : G).box(0.05, 1.1, 1.2, '#34444f', x, base + 1.5 + lv * 3, z, 0, yaw, 0);
      }
      this.addSeg(ax, az, bx, bz, base + h);
    }
    const tris = THREE.ShapeUtils.triangulateShape(pts.map(([x, z]) => new THREE.Vector2(x, z)), []);
    const g = new THREE.BufferGeometry(), pos: number[] = [];
    for (const [a, b, c] of tris) for (const k of [a, c, b]) pos.push(pts[k][0], base + h, pts[k][1]);
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
    M.add(g, roof);
  }

  // ------------------------------------------------------------ trees
  private trees(list: number[], R: number) {
    const kinds: { geo: THREE.BufferGeometry; items: THREE.Matrix4[] }[] = [0, 1, 2, 3, 4].map((k) => ({ geo: treeGeometry(k), items: [] }));
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    const put = (k: number, x: number, z: number, s: number, seed: number) => {
      e.set(0, seed * 6.283, 0); q.setFromEuler(e); sc.set(s * (0.9 + 0.2 * hash(seed + 1)), s * (0.9 + 0.25 * hash(seed + 2)), s * (0.9 + 0.2 * hash(seed + 3)));
      p.set(x, this.gh(x, z) - 0.05, z); kinds[k].items.push(m4.compose(p, q, sc).clone());
    };
    for (let i = 0; i < list.length; i += 3) {
      const x = list[i] / 10, z = list[i + 1] / 10, k = list[i + 2];
      put(k, x, z, k >= 3 ? 1 : 1.1, i);
      if (k < 3) this.addCirc(x, z, 0.3, 6); else if (k === 3) this.addCirc(x, z, 0.7, 1.2);
    }
    // the dark conifer wood on the rising ground outside the wall (photos 1, 3, 6), in rows so it reads as a wood, not a fence
    const n = this.lean ? 260 : 520;
    for (let i = 0; i < n; i++) {
      const a = hash(i * 1.7) * Math.PI * 2, r = R + 3 + Math.pow(hash(i * 2.3), 0.7) * 62;
      put(hash(i * 5.1) > 0.25 ? 1 : 0, Math.cos(a) * r, Math.sin(a) * r, 1.6 + hash(i * 3.9) * 1.1, i + 1000);
    }
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }); mat.userData.vcGlow = 0.16;
    for (const k of kinds) {
      if (!k.items.length) continue;
      const im = new THREE.InstancedMesh(k.geo, mat, k.items.length);
      k.items.forEach((m, j) => im.setMatrixAt(j, m)); im.instanceMatrix.needsUpdate = true;
      im.castShadow = this.shadows; im.frustumCulled = false; this.group.add(im);
    }
  }

  // ------------------------------------------------------------ street furniture and cars
  private furniture(d: any, _look: any, lit: () => THREE.MeshStandardMaterial) {
    const M = new Mesher(), heads: THREE.Matrix4[] = [], m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
    for (const [kind, x10, z10, ni] of d.furn) {
      const x = x10 / 10, z = z10 / 10, y = this.surf(x, z);
      if (kind === 'lamp') {
        // a tall grey lamp post with a swan neck towards the nearest road
        const yaw = this.towardRoad(x, z);
        M.cyl(0.07, 0.1, 6.2, '#8a9096', x, y + 3.1, z, 1, 1, 8);
        const hx = x + Math.sin(yaw) * 0.9, hz = z + Math.cos(yaw) * 0.9;
        M.box(0.08, 0.08, 1.0, '#8a9096', x + Math.sin(yaw) * 0.45, y + 6.15, z + Math.cos(yaw) * 0.45, 0, yaw, 0);
        M.box(0.28, 0.12, 0.6, '#5a6066', hx, y + 6.1, hz, 0, yaw, 0);
        heads.push(m4.compose(new THREE.Vector3(hx, y + 6.02, hz), q.setFromEuler(new THREE.Euler(0, yaw, 0)), one).clone());
        this.addCirc(x, z, 0.15, 6);
      } else if (kind === 'street_sign') {
        // a Scottish street name plate: white, black letters, on two short posts
        const name = d.names[ni] ?? '';
        const yaw = this.towardRoad(x, z);
        for (const s of [-1, 1]) M.cyl(0.04, 0.04, 1.2, '#2a2a2a', x + Math.cos(yaw) * s * 0.7, y + 0.6, z - Math.sin(yaw) * s * 0.7, 1, 1, 6);
        const b = sign([name.toUpperCase()], 1.7, 0.32, '#f4f4f0', '#111111', '#111111'); b.position.set(x, y + 1.05, z); b.rotation.y = yaw; this.group.add(b);
        const b2 = b.clone(); b2.rotation.y = yaw + Math.PI; this.group.add(b2);
      } else if (kind === 'wheelie_bin') {
        M.box(0.58, 1.0, 0.72, '#1e2622', x, y + 0.5, z); M.box(0.62, 0.06, 0.76, '#1a1f1c', x, y + 1.03, z); this.addCirc(x, z, 0.4, 1.1);
      } else if (kind === 'bench') { M.box(1.6, 0.06, 0.45, '#6b4a30', x, y + 0.45, z); M.box(1.6, 0.4, 0.06, '#6b4a30', x, y + 0.7, z - 0.2); this.addCirc(x, z, 0.5, 0.8); }
      else if (kind === 'bin') { M.cyl(0.25, 0.22, 0.9, '#2a3a2a', x, y + 0.45, z, 1, 1, 10); this.addCirc(x, z, 0.3, 1); }
      else if (kind === 'post_box') { M.cyl(0.25, 0.25, 1.3, '#c8202a', x, y + 0.65, z, 1, 1, 12); this.addCirc(x, z, 0.3, 1.4); }
      else if (kind === 'bus_stop') { M.cyl(0.05, 0.05, 2.6, '#444', x, y + 1.3, z, 1, 1, 6); M.box(0.5, 0.5, 0.05, '#2a62b8', x, y + 2.4, z); }
      else if (kind === 'bollard') { M.cyl(0.08, 0.08, 0.9, '#333', x, y + 0.45, z, 1, 1, 8); this.addCirc(x, z, 0.12, 1); }
    }
    for (const [x10, z10, yaw, colr, kind] of d.cars ?? []) {
      const x = x10 / 10, z = z10 / 10, y = this.surf(x, z);
      carMesh(M, x, y, z, yaw, colr, kind);
      // a parked car is a box to walk round
      const hl = kind === 'small' ? 1.75 : kind === 'saloon' || kind === 'estate' ? 2.35 : 2.0, hw = 0.85, c = Math.cos(yaw), s = Math.sin(yaw);
      const cnr = [[-hw, -hl], [hw, -hl], [hw, hl], [-hw, hl]].map(([a, b]) => [x + a * c + b * s, z - a * s + b * c]);
      for (let k = 0; k < 4; k++) this.addSeg(cnr[k][0], cnr[k][1], cnr[(k + 1) % 4][0], cnr[(k + 1) % 4][1], y + 1.45);
    }
    const m = M.build(this.shadows); m.material = lit(); m.castShadow = this.shadows; this.group.add(m);
    if (heads.length) {
      const g = new THREE.SphereGeometry(0.17, 10, 6); g.scale(1, 0.55, 1.6);
      const hm = new THREE.MeshStandardMaterial({ color: '#fff1c8', roughness: 0.4 }); hm.userData.liveEmissive = true; hm.emissive.setRGB(1.0, 0.82, 0.5); hm.emissiveIntensity = 0.05; this.nightFx.push((n) => { hm.emissiveIntensity = n * 3.0 + 0.05; });
      const im = new THREE.InstancedMesh(g, hm, heads.length); heads.forEach((h, j) => im.setMatrixAt(j, h)); im.frustumCulled = false; this.group.add(im);
      // a soft pool of light on the ground under each lamp at night (no real lights: a decal each, all one mesh)
      const pg = new THREE.CircleGeometry(4.5, 20); pg.rotateX(-Math.PI / 2);
      const pm = new THREE.MeshBasicMaterial({ color: '#ffd9a0', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }); pm.opacity = 0; this.nightFx.push((n) => { pm.opacity = n * 0.16; });
      pm.polygonOffset = true; pm.polygonOffsetFactor = -8; pm.polygonOffsetUnits = -16;
      this.glow = new THREE.InstancedMesh(pg, pm, heads.length);
      heads.forEach((h, j) => { const p = new THREE.Vector3().setFromMatrixPosition(h); (this.glow as THREE.InstancedMesh).setMatrixAt(j, new THREE.Matrix4().makeTranslation(p.x, this.surf(p.x, p.z) + 0.06, p.z)); });
      this.glow.frustumCulled = false; this.group.add(this.glow);
    }
  }
  /** the yaw from (x, z) towards the nearest road centreline (lamps lean over the road) */
  private towardRoad(x: number, z: number) {
    let best = 1e9, bx = x, bz = z;
    for (const r of this.d.roads) { const p = pts2(r[5]); for (let i = 1; i < p.length; i++) { const [ax, az] = p[i - 1], [cx, cz] = p[i], dx = cx - ax, dz = cz - az, L2 = dx * dx + dz * dz || 1e-9, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)), px = ax + dx * t, pz = az + dz * t, dd = Math.hypot(x - px, z - pz); if (dd < best) { best = dd; bx = px; bz = pz; } } }
    return Math.atan2(bx - x, bz - z);
  }
}

// ------------------------------------------------------------ helpers
const pts2 = (p: number[]) => { const out: number[][] = []; for (let i = 0; i < p.length; i += 2) out.push([p[i] / 10, p[i + 1] / 10]); return out; };
/** walk along a polyline every `step` metres: position and the left normal (nx, nz); `ends` also visits the last point */
function walk(pts: number[][], step: number, fn: (x: number, z: number, nx: number, nz: number) => void, ends = false) {
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i], L = Math.hypot(bx - ax, bz - az); if (L < 1e-4) continue;
    let tx = (bx - ax) / L, tz = (bz - az) / L;
    const n = Math.max(1, Math.ceil(L / step));
    for (let k = 0; k < n + (ends && i === pts.length - 1 ? 1 : 0); k++) {
      const t = k / n;
      // mitre at the corners: blend the direction with the next segment's near the end
      if (k === 0 && i > 1) { const [px, pz] = pts[i - 2], pl = Math.hypot(ax - px, az - pz) || 1; const mx = (ax - px) / pl + tx, mz = (az - pz) / pl + tz, ml = Math.hypot(mx, mz) || 1; fn(ax, az, -mz / ml, mx / ml); continue; }
      fn(ax + (bx - ax) * t, az + (bz - az) * t, -tz, tx);
    }
    void tx; void tz;
  }
}
/** call fn for every cell centre inside a polygon */
function fillPoly(pts: number[][], cell: number, fn: (x: number, z: number) => void) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  for (let z = Math.floor(z0 / cell) * cell + cell / 2; z < z1; z += cell) for (let x = Math.floor(x0 / cell) * cell + cell / 2; x < x1; x += cell) {
    let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, zi] = pts[i], [xj, zj] = pts[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; }
    if (c) fn(x, z);
  }
}
/** triangles with flat colours, built up and turned into one geometry */
class Strip {
  private pos: number[] = []; private col: number[] = []; private c = new THREE.Color();
  get n() { return this.pos.length; }
  tri(a: number[], b: number[], c: number[], colr: string) {
    this.c.set(colr);
    // flat things always face up (so they are lit the same whichever way the road was drawn); upright faces keep their order
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
    const order = Math.abs(ny / l) > 0.5 ? (ny > 0 ? [a, b, c] : [a, c, b]) : [a, c, b];
    for (const p of order) { this.pos.push(p[0], p[1], p[2]); this.col.push(this.c.r, this.c.g, this.c.b); }
  }
  quad(a: number[], b: number[], c: number[], d: number[], colr: string) { this.tri(a, b, c, colr); this.tri(a, c, d, colr); }
  geometry() { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3)); g.computeVertexNormals(); return g; }
}
/** a hipped or gabled roof over a W x D rectangle (local, eaves at y = 0, ridge along the longer side); gables are separate (wall colour) */
function roofGeometry(W: number, D: number, rise: number, gabled: boolean) {
  const swap = W < D, w = swap ? D : W, d = swap ? W : D, hw = w / 2, hd = d / 2;
  const r0 = gabled ? -hw : -hw + hd, r1 = gabled ? hw : hw - hd;
  const A = [-hw, 0, -hd], B = [hw, 0, -hd], C = [hw, 0, hd], Dd = [-hw, 0, hd], P0 = [r0, rise, 0], P1 = [r1, rise, 0];
  const pos: number[] = [], push = (...ps: number[][]) => { for (const p of ps) pos.push(p[0], p[1], p[2]); };
  push(Dd, C, P1, Dd, P1, P0);               // the front slope
  push(B, A, P0, B, P0, P1);                 // the back slope
  if (!gabled) { push(C, B, P1); push(A, Dd, P0); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); if (swap) g.rotateY(Math.PI / 2); g.computeVertexNormals();
  let gables: THREE.BufferGeometry | null = null;
  if (gabled) {
    const o = 0.35, gx = hw - o, gp: number[] = [];
    for (const s of [-1, 1]) { const x = s * gx, k = (hd - o) / hd; gp.push(x, 0, -hd + o, x, 0, hd - o, x, rise * k, 0); }
    gables = new THREE.BufferGeometry(); gables.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3)); if (swap) gables.rotateY(Math.PI / 2); gables.computeVertexNormals();
  }
  return { roof: g, gables };
}
/** low-poly trees: 0 broadleaf, 1 conifer, 2 birch, 3 garden shrub, 4 little conifer bush */
function treeGeometry(k: number) {
  const M = new Mesher();
  if (k === 0) { M.cyl(0.18, 0.26, 3.2, '#5a4030', 0, 1.6, 0, 1, 1, 7); M.add(new THREE.IcosahedronGeometry(2.4, 1), '#3f6a2e', 0, 4.6, 0, 0, 0, 0, 1, 0.9, 1); M.add(new THREE.IcosahedronGeometry(1.7, 1), '#4a7a34', 0.9, 5.6, 0.4); M.add(new THREE.IcosahedronGeometry(1.6, 0), '#3a6230', -1, 4.2, -0.6); }
  else if (k === 1) { M.cyl(0.16, 0.22, 2, '#4a3426', 0, 1, 0, 1, 1, 6); for (let i = 0; i < 4; i++) M.cyl(0.05, 2.2 - i * 0.45, 2.4, i % 2 ? '#22402a' : '#284a2e', 0, 2.2 + i * 1.5, 0, 1, 1, 8); }
  else if (k === 2) { M.cyl(0.1, 0.14, 6.5, '#e8e4dc', 0, 3.25, 0, 1, 1, 6); for (let i = 0; i < 4; i++) M.add(new THREE.IcosahedronGeometry(1.1 - i * 0.12, 0), i % 2 ? '#5a8a3a' : '#6a9a44', (hash(i) - 0.5) * 0.8, 4.2 + i * 1.0, (hash(i + 3) - 0.5) * 0.8, 0, 0, 0, 1, 1.4, 1); }
  else if (k === 3) { M.add(new THREE.IcosahedronGeometry(0.75, 1), '#3f6a2e', 0, 0.55, 0, 0, 0, 0, 1.1, 0.85, 1.1); M.add(new THREE.IcosahedronGeometry(0.5, 1), '#4f7f36', 0.4, 0.8, 0.2); }
  else { M.cyl(0.02, 0.55, 1.6, '#2e5530', 0, 0.8, 0, 1, 1, 8); }
  const g = M.build(false).geometry; return g;
}
/** a parked car (a small hatchback, a hatch, a saloon or an estate), facing +z turned by yaw */
function carMesh(M: Mesher, x: number, y: number, z: number, yaw: number, col: string, kind: string) {
  const L = kind === 'small' ? 3.5 : kind === 'saloon' || kind === 'estate' ? 4.7 : 4.0, Wd = 1.7, c = Math.cos(yaw), s = Math.sin(yaw);
  const P = (a: number, b: number) => [x + a * c + b * s, z - a * s + b * c];
  const bx = (w: number, h: number, l: number, colr: string, a: number, yy: number, b: number) => { const [px, pz] = P(a, b); M.box(w, h, l, colr, px, y + yy, pz, 0, yaw, 0); };
  bx(Wd, 0.55, L, col, 0, 0.62, 0);
  const cabin = kind === 'saloon' ? 2.2 : kind === 'estate' ? 2.9 : kind === 'small' ? 1.9 : 2.2, cb = kind === 'saloon' ? -0.1 : kind === 'estate' ? -0.5 : -0.35;
  bx(Wd - 0.12, 0.5, cabin, col, 0, 1.12, cb);
  bx(Wd - 0.08, 0.38, cabin - 0.15, '#26343c', 0, 1.13, cb);
  bx(Wd - 0.2, 0.4, cabin + 0.08, shade(col, 1.05), 0, 1.14, cb);
  for (const sa of [-1, 1]) for (const sb of [-1, 1]) { const [px, pz] = P(sa * (Wd / 2 - 0.08), sb * (L / 2 - 0.75)); M.cyl(0.33, 0.33, 0.24, '#1d1e20', px, y + 0.33, pz, 1, 1, 10, 0, yaw, Math.PI / 2); }
  bx(Wd - 0.4, 0.12, 0.05, '#f2f0e0', 0, 0.75, L / 2 + 0.01); bx(Wd - 0.3, 0.12, 0.05, '#c03030', 0, 0.8, -L / 2 - 0.01);
  bx(0.5, 0.11, 0.03, '#f4d32a', 0, 0.55, -L / 2 - 0.02);
}

type PV = { x: number; y: number; z: number };
const _pe = new THREE.Vector3(), _pd = new THREE.Vector3();
