// The sky spiral: a very tall tower on the airstrip island with a road that winds up around it (4+ turns, about 12 % grade),
// a big round deck on top and three side platforms with kickers at 18, 36 and 54 m. Cars and people ride it through the
// y-aware ground function (towerSurf): at one spot on the map there can be several roads at different heights, you stand on
// the highest one that is not more than a step above you.
// Babylon port: Castaway's code, drawn by render/mirror.ts.
import * as THREE from 'three';
import { Mesher } from '../net/playerModel';

export const TW = { x: -15, z: 0, rIn: 16, rOut: 26, rail: 25.2, rDeck: 27.2, H: 73.2, flat: 3.2, th0: Math.PI, grade: 0.12 };
const TAU = Math.PI * 2, STEP = 0.5;
const RMID = (TW.rIn + TW.rOut) / 2;
export const PR = TW.grade * RMID;                                   // metres of climb per radian
export const PHI = (TW.H - TW.flat) / PR;                            // radians of road
const PL = 24, PW = 14, LIP = 6, LIPH = 1.6;
const PAD_H = [TW.flat + 17, TW.flat + 35, TW.flat + 53];
const TH_END = TW.th0 + PHI;                                          // where the road reaches the deck
/** the deck is cut away over the last stretch of road (with less than ~4 m of headroom): angle span, ending where the road ends */
const CUT = 1.6;
const inCut = (psi: number) => ((((psi - (TH_END - CUT)) % TAU) + TAU) % TAU) <= CUT;
const PADS = [...PAD_H.map((h) => ({ h, th: TW.th0 + (h - TW.flat) / PR })), { h: TW.H, th: TH_END + Math.PI }];   // the last one is the dive platform on the deck
const roadTopAt = (th: number) => { let p = (((th - TW.th0) % TAU) + TAU) % TAU, top = TW.flat; for (; p <= PHI + 1e-6; p += TAU) top = TW.flat + PR * p; return top; };

const PILLAR_R = 28.4;
const pillars: { x: number; z: number; r: number; top: number }[] = [];
for (let i = 0; i < 30; i++) { const th = (i / 30) * TAU; pillars.push({ x: TW.x + Math.cos(th) * PILLAR_R, z: TW.z + Math.sin(th) * PILLAR_R, r: 0.75, top: Math.min(roadTopAt(th), TW.H) }); }
for (const p of PADS) {
  const c = Math.cos(p.th), s = Math.sin(p.th);
  for (const [u, v] of [[TW.rOut + 3, -PW / 2 + 1], [TW.rOut + 3, PW / 2 - 1], [TW.rOut + PL - 2, -PW / 2 + 1], [TW.rOut + PL - 2, PW / 2 - 1]]) pillars.push({ x: TW.x + c * u - s * v, z: TW.z + s * u + c * v, r: 0.6, top: p.h });
}

export interface Surf { h: number; kind: 0 | 1 | 2 | 3 }
const NONE: Surf = { h: -Infinity, kind: 0 };
const _s: Surf = { h: 0, kind: 0 };
/** highest tower surface at (x, z) that is at most a step above y (kind: 1 road, 2 deck, 3 platform) */
export function towerSurf(x: number, z: number, y: number): Surf {
  const dx = x - TW.x, dz = z - TW.z;
  if (Math.abs(dx) > 80 || Math.abs(dz) > 80) return NONE;
  const r = Math.hypot(dx, dz), tol = y + STEP;
  let best = -Infinity, kind: 0 | 1 | 2 | 3 = 0;
  if (r <= TW.rDeck && TW.H <= tol && !(r >= TW.rIn && inCut(Math.atan2(dz, dx)))) { best = TW.H; kind = 2; }
  if (r >= TW.rIn && r <= TW.rOut) {
    let p = (((Math.atan2(dz, dx) - TW.th0) % TAU) + TAU) % TAU;
    for (; p <= PHI + 1e-6; p += TAU) { const h = TW.flat + PR * p; if (h <= tol && h > best) { best = h; kind = 1; } }
  }
  for (const pd of PADS) {
    const c = Math.cos(pd.th), s = Math.sin(pd.th), u = dx * c + dz * s, v = -dx * s + dz * c;
    if (u < TW.rOut - 0.5 || u > TW.rOut + PL || Math.abs(v) > PW / 2) continue;
    const h = pd.h + (u > TW.rOut + PL - LIP ? ((u - (TW.rOut + PL - LIP)) / LIP) * LIPH : 0);
    if (h <= tol && h > best) { best = h; kind = 3; }
  }
  if (kind === 0) return NONE;
  _s.h = best; _s.kind = kind; return _s;
}

/** walls of the tower for a walker/car of radius rad at height y: moves st and reports each push as a normal */
export function towerPush(st: { x: number; z: number }, rad: number, y: number, hit: (nx: number, nz: number) => void) {
  const dx0 = st.x - TW.x, dz0 = st.z - TW.z;
  if (Math.abs(dx0) > 85 || Math.abs(dz0) > 85) return;
  let dx = dx0, dz = dz0, r = Math.hypot(dx, dz);
  // the core (and nothing once you are on the deck)
  if (y < TW.H - 0.6 && r < TW.rIn + rad) { const ux = r > 1e-4 ? dx / r : 1, uz = r > 1e-4 ? dz / r : 0; st.x = TW.x + ux * (TW.rIn + rad); st.z = TW.z + uz * (TW.rIn + rad); hit(ux, uz); dx = st.x - TW.x; dz = st.z - TW.z; r = Math.hypot(dx, dz); }
  // the rail on the outer edge of the road and the deck (open where a platform leaves it, and at the foot of the road)
  if (r > TW.rail - rad && r <= TW.rDeck + 1) {
    // judge by the road under the closest point of the lane, so a car that is already past the road's edge is still held
    const rc = Math.min(r, TW.rOut - 0.01), s = towerSurf(TW.x + (dx / r) * rc, TW.z + (dz / r) * rc, y);
    if ((s.kind === 1 || s.kind === 2) && s.h > TW.flat + 0.6 && y - s.h < 1.8) {
      let gap = false;
      for (const pd of PADS) {
        const c = Math.cos(pd.th), sn = Math.sin(pd.th), u = dx * c + dz * sn, v = -dx * sn + dz * c;
        if (u > 0 && Math.abs(v) < PW / 2 + 0.3 && Math.abs(y - pd.h) < 2.6) { gap = true; break; }
      }
      if (!gap) { const ux = dx / r, uz = dz / r; st.x = TW.x + ux * (TW.rail - rad); st.z = TW.z + uz * (TW.rail - rad); hit(-ux, -uz); }
    }
  }
  for (const p of pillars) {
    if (y > p.top - 0.5) continue;
    const ex = st.x - p.x, ez = st.z - p.z;
    if (Math.abs(ex) > 3 || Math.abs(ez) > 3) continue;
    const d = Math.hypot(ex, ez), rr = rad + p.r;
    if (d < rr) { const ux = d > 1e-4 ? ex / d : 1, uz = d > 1e-4 ? ez / d : 0; st.x = p.x + ux * rr; st.z = p.z + uz * rr; hit(ux, uz); }
  }
}

// ------------------------------------------------------------------ geometry
type Tri = [number[], number[], number[], THREE.Color];

/** flat-shaded triangles, each wound so that its normal points along `want` */
function addQuad(tris: Tri[], a: number[], b: number[], c: number[], d: number[], k: THREE.Color, want: number[]) {
  const n = (p: number[], q: number[], r: number[]) => {
    const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2], vx = r[0] - p[0], vy = r[1] - p[1], vz = r[2] - p[2];
    return ((uy * vz - uz * vy) * want[0] + (uz * vx - ux * vz) * want[1] + (ux * vy - uy * vx) * want[2]);
  };
  if (n(a, b, c) >= 0) tris.push([a, b, c, k], [a, c, d, k]); else tris.push([a, c, b, k], [a, d, c, k]);
}

export function towerRoadGeometry(): THREE.BufferGeometry {
  const tris: Tri[] = [];
  const col = (h: string) => new THREE.Color(h);
  const ASPH = col('#3d4046'), WHITE = col('#ececec'), YEL = col('#f0c419'), SLAB = col('#8e8e88'), UNDER = col('#6b6b66'), OUTER = col('#a3a39c');
  const dphi = 0.045, n = Math.ceil(PHI / dphi), T = 0.7;
  const bands: [number, number, THREE.Color | null][] = [[TW.rIn, TW.rIn + 0.5, WHITE], [TW.rIn + 0.5, RMID - 0.15, ASPH], [RMID - 0.15, RMID + 0.15, null], [RMID + 0.15, TW.rOut - 0.5, ASPH], [TW.rOut - 0.5, TW.rOut, WHITE]];
  const pt = (phi: number, r: number, h: number) => { const th = TW.th0 + phi; return [TW.x + Math.cos(th) * r, h, TW.z + Math.sin(th) * r]; };
  for (let i = 0; i < n; i++) {
    const p0 = i * dphi, p1 = Math.min(PHI, (i + 1) * dphi), h0 = TW.flat + PR * p0, h1 = TW.flat + PR * p1, thm = TW.th0 + (p0 + p1) / 2;
    for (const [r0, r1, k] of bands) addQuad(tris, pt(p0, r0, h0), pt(p1, r0, h1), pt(p1, r1, h1), pt(p0, r1, h0), k ?? (Math.floor(i / 5) % 2 ? ASPH : YEL), [0, 1, 0]);
    addQuad(tris, pt(p0, TW.rIn, h0 - T), pt(p1, TW.rIn, h1 - T), pt(p1, TW.rOut, h1 - T), pt(p0, TW.rOut, h0 - T), UNDER, [0, -1, 0]);
    addQuad(tris, pt(p0, TW.rOut, h0), pt(p1, TW.rOut, h1), pt(p1, TW.rOut, h1 - T), pt(p0, TW.rOut, h0 - T), i % 2 ? OUTER : SLAB, [Math.cos(thm), 0, Math.sin(thm)]);
  }
  // the end of the road runs into the deck
  const g = new THREE.BufferGeometry(), pos: number[] = [], nor: number[] = [], cl: number[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), nn = new THREE.Vector3();
  for (const [p, q, r, k] of tris) {
    a.fromArray(p); b.fromArray(q); c.fromArray(r); nn.copy(b).sub(a).cross(c.clone().sub(a)).normalize();
    for (const v of [p, q, r]) { pos.push(...v); nor.push(nn.x, nn.y, nn.z); cl.push(k.r, k.g, k.b); }
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(cl, 3));
  g.computeBoundingSphere();
  return g;
}

/** core, deck, rails, pillars, platforms: boxes and cylinders in one mesh (decor only; the physics is above) */
export function towerDecorMesher(): Mesher {
  const m = new Mesher();
  const { x: cx, z: cz, H, flat: F } = TW;
  // core with red bands
  m.cyl(TW.rIn - 0.05, TW.rIn - 0.05, H - F, '#c9c5b8', cx, F + (H - F) / 2, cz, 1, 1, 48);
  for (let h = 8; h < H - 4; h += 12) m.cyl(TW.rIn + 0.04, TW.rIn + 0.04, 1.4, '#c0392b', cx, F + h, cz, 1, 1, 48);
  // deck, helipad, rim
  // (a sector is missing where the road comes in, so the road runs onto the deck instead of into it)
  const cutLen = TAU - CUT, cutStart = Math.PI / 2 - (TH_END + cutLen);
  m.cyl(TW.rIn, TW.rIn, 1.3, '#9a9a94', cx, H - 0.65, cz, 1, 1, 40); m.cyl(TW.rIn - 0.1, TW.rIn - 0.1, 0.06, '#42474f', cx, H + 0.03, cz, 1, 1, 40);
  m.add(new THREE.CylinderGeometry(TW.rDeck, TW.rDeck, 1.3, 56, 1, false, cutStart, cutLen), '#9a9a94', cx, H - 0.65, cz);
  m.add(new THREE.CylinderGeometry(TW.rDeck - 0.3, TW.rDeck - 0.3, 0.06, 56, 1, false, cutStart, cutLen), '#42474f', cx, H + 0.03, cz);
  for (const psi of [TH_END - CUT, TH_END]) m.box(TW.rDeck - TW.rIn, 1.3, 0.1, '#9a9a94', cx + Math.cos(psi) * (TW.rIn + TW.rDeck) / 2, H - 0.65, cz + Math.sin(psi) * (TW.rIn + TW.rDeck) / 2, 0, -psi, 0);
  m.cyl(11, 11, 0.07, '#2b3a55', cx, H + 0.07, cz, 1, 1, 40); m.cyl(10, 10, 0.08, '#e9eef5', cx, H + 0.09, cz, 1, 1, 40); m.cyl(9.4, 9.4, 0.09, '#2b3a55', cx, H + 0.1, cz, 1, 1, 40);
  m.box(1.2, 0.1, 9, '#e9eef5', cx - 3, H + 0.16, cz); m.box(1.2, 0.1, 9, '#e9eef5', cx + 3, H + 0.16, cz); m.box(6, 0.1, 1.2, '#e9eef5', cx, H + 0.16, cz);
  m.cyl(0.25, 0.35, 16, '#d8d8d8', cx, H + 8, cz, 1, 1, 10); m.sph(0.7, '#ff3b30', cx, H + 16.4, cz, 1, 1, 1, 10);
  for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; m.box(2, 2.4, 0.3, i % 2 ? '#f0c419' : '#c0392b', cx + Math.cos(a) * 20, H + 1.2, cz + Math.sin(a) * 20, 0, -a - Math.PI / 2, 0); }   // chevrons around the helipad
  // rail along the road's outer edge and round the deck
  const rb = (th: number, h: number, len: number, tilt: number, c1: string) => m.box(len, 0.14, 0.12, c1, cx + Math.cos(th) * TW.rail, h, cz + Math.sin(th) * TW.rail, 0, -(th + Math.PI / 2), tilt);
  const dphi = 0.045, tilt = Math.atan2(PR, TW.rail);
  for (let i = 0; i * dphi < PHI; i++) {
    const p = (i + 0.5) * dphi, h = F + PR * p, th = TW.th0 + p;
    if (h < F + 0.6) continue;
    // open stretches where a platform leaves the road
    let gap = false; for (const pd of PADS) if (Math.abs(h - pd.h) < 8 && Math.abs(((th - pd.th + Math.PI * 3) % TAU) - Math.PI) < 0.30) gap = true;
    if (gap) continue;
    rb(th, h + 0.95, 1.25, tilt, i % 2 ? '#f2f2f2' : '#d33232'); rb(th, h + 0.5, 1.25, tilt, i % 2 ? '#d33232' : '#f2f2f2');
    if (i % 6 === 0) m.box(0.14, 1.1, 0.14, '#d33232', cx + Math.cos(th) * TW.rail, h + 0.55, cz + Math.sin(th) * TW.rail);
  }
  for (let i = 0; i < 72; i++) {
    const th = (i / 72) * TAU;
    if (inCut(th)) continue;                                           // the road's own rail runs here
    let skip = false; for (const pd of PADS) if (pd.h === H && Math.abs(Math.atan2(Math.sin(th - pd.th), Math.cos(th - pd.th))) < 0.32) skip = true;
    if (skip) continue;                                                // open edge: the dive platform
    m.box(0.14, 1.1, 0.14, '#d33232', cx + Math.cos(th) * TW.rail, H + 0.55, cz + Math.sin(th) * TW.rail);
    m.box(2.35, 0.14, 0.12, i % 2 ? '#f2f2f2' : '#d33232', cx + Math.cos(th + 0.0436) * TW.rail, H + 0.95, cz + Math.sin(th + 0.0436) * TW.rail, 0, -(th + 0.0436 + Math.PI / 2), 0);
  }
  // pillars and the brackets that carry every turn of the road
  for (let i = 0; i < 30; i++) {
    const th = (i / 30) * TAU, p = pillars[i];
    m.cyl(0.75, 0.9, p.top - F, '#b4b1a6', p.x, F + (p.top - F) / 2, p.z, 1, 1, 10);
    let q = (((th - TW.th0) % TAU) + TAU) % TAU;
    for (; q <= PHI + 1e-6; q += TAU) m.box(2.6, 0.7, 1.1, '#a3a39c', cx + Math.cos(th) * (TW.rOut + 1.5), F + PR * q - 0.35, cz + Math.sin(th) * (TW.rOut + 1.5), 0, -th, 0);
    m.box(2.6, 0.7, 1.1, '#a3a39c', cx + Math.cos(th) * (TW.rDeck + 0.7), H - 0.65, cz + Math.sin(th) * (TW.rDeck + 0.7), 0, -th, 0);
  }
  // platforms with a kicker at the end, a pad stripe and columns
  PADS.forEach((pd, idx) => {
    const c = Math.cos(pd.th), s = Math.sin(pd.th), at = (u: number, v = 0) => [cx + c * u - s * v, cz + s * u + c * v];
    const flatLen = PL - LIP + 0.5, u0 = TW.rOut - 0.5, [fx, fz] = at(u0 + flatLen / 2);
    m.box(flatLen, 0.8, PW, '#9a9a94', fx, pd.h - 0.4, fz, 0, -pd.th, 0);
    m.box(flatLen, 0.06, PW - 1.2, '#42474f', fx, pd.h + 0.03, fz, 0, -pd.th, 0);
    const la = Math.atan2(LIPH, LIP), ll = LIP / Math.cos(la), [lx, lz] = at(TW.rOut + PL - LIP / 2);
    m.box(ll, 0.5, PW, '#d9a93a', lx, pd.h + LIPH / 2 - 0.25 / Math.cos(la), lz, 0, -pd.th, la);
    for (let k = 0; k < 4; k++) { const [sx, sz] = at(u0 + 3 + k * 4.2); m.box(2.4, 0.07, PW - 2.4, k % 2 ? '#f0c419' : '#2a2a2a', sx, pd.h + 0.07, sz, 0, -pd.th, 0); }
    for (const sv of [-1, 1]) { const [rx, rz] = at(u0 + flatLen / 2, sv * (PW / 2 - 0.1)); m.box(flatLen, 0.5, 0.15, '#d33232', rx, pd.h + 0.4, rz, 0, -pd.th, 0); }
    const [nx, nz] = at(TW.rOut + 6, 0); void nx; void nz; void idx;
  });
  return m;
}
