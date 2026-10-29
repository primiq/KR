// The two rooms of Banana or Salmon that are not missions: the Choice room (a little stage with a banana and a salmon on plinths)
// and the Cosy room (the hub: sofas, a fire, the TV that starts missions, the scoreboard and the big red reset button).
import * as THREE from 'three';
import { Mesher } from '../net/playerModel';
import { Space, bake, Board, sign, rayHit } from './space';

export const CHOICE = { x: 9000, y: 40, z: 0 };
export const HUB = { x: 12000, y: 40, z: 0 };

/** a banana, lying on its side, about 0.45 m long (local origin at its middle, resting on y = 0) */
export function bananaMesh(M: Mesher, x: number, y: number, z: number, s = 1, ry = 0) {
  const n = 9;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), a = (t - 0.5) * 1.6, R = 0.3 * s;
    const px = Math.sin(a) * R, py = (1 - Math.cos(a)) * R * 0.9;
    const c = i === 0 || i === n - 1 ? '#5a4416' : '#f4d23c';
    const rr = (0.055 + 0.03 * Math.sin(t * Math.PI)) * s;
    M.sph(rr, c, x + Math.cos(ry) * px, y + rr * 0.9 + py, z - Math.sin(ry) * px, 1, 1, 1, 8);
  }
  M.cyl(0.018 * s, 0.022 * s, 0.07 * s, '#6b5520', x + Math.cos(ry) * 0.27 * s, y + 0.2 * s, z - Math.sin(ry) * 0.27 * s, 1, 1, 6, 0, 0, -0.6);
}
/** a salmon, about 0.7 m long, nose towards +x */
export function salmonMesh(M: Mesher, x: number, y: number, z: number, s = 1, ry = 0) {
  const at = (lx: number) => [x + Math.cos(ry) * lx * s, z - Math.sin(ry) * lx * s] as const;
  for (let i = 0; i < 7; i++) {
    const t = i / 6, lx = (t - 0.5) * 0.6, r = (0.03 + 0.09 * Math.sin(Math.PI * (0.15 + t * 0.8))) * s;
    const [px, pz] = at(lx);
    M.sph(r, '#d98a7a', px, y + 0.11 * s, pz, 1.2, 1, 0.7, 10, 0, ry, 0);
    M.sph(r * 0.95, '#c9ced6', px, y + 0.08 * s, pz, 1.2, 0.8, 0.72, 10, 0, ry, 0);
  }
  const [tx, tz] = at(-0.38); M.box(0.12 * s, 0.2 * s, 0.03 * s, '#b36a5c', tx, y + 0.11 * s, tz, 0, ry, 0);
  const [dx, dz] = at(0.02); M.box(0.12 * s, 0.07 * s, 0.02 * s, '#b36a5c', dx, y + 0.22 * s, dz, 0, ry, 0.3);
  const [ex, ez] = at(0.25);
  for (const side of [-1, 1]) M.sph(0.018 * s, '#111', ex + Math.sin(ry) * side * 0.05 * s, y + 0.14 * s, ez + Math.cos(ry) * side * 0.05 * s);
}

function wallsAndFloor(sp: Space, M: Mesher, x0: number, x1: number, z0: number, z1: number, h: number, wall: string, floor: string, ceil: string, trim: string) {
  M.box(x1 - x0, 0.1, z1 - z0, floor, (x0 + x1) / 2, -0.05, (z0 + z1) / 2);
  M.box(x1 - x0, 0.1, z1 - z0, ceil, (x0 + x1) / 2, h + 0.05, (z0 + z1) / 2);
  const T = 0.2;
  M.box(T, h, z1 - z0, wall, x0 - T / 2, h / 2, (z0 + z1) / 2); M.box(T, h, z1 - z0, wall, x1 + T / 2, h / 2, (z0 + z1) / 2);
  M.box(x1 - x0 + 2 * T, h, T, wall, (x0 + x1) / 2, h / 2, z0 - T / 2); M.box(x1 - x0 + 2 * T, h, T, wall, (x0 + x1) / 2, h / 2, z1 + T / 2);
  for (const [a, b, c, d] of [[x0, x1, z0, z0 + 0.06], [x0, x1, z1 - 0.06, z1], [x0, x0 + 0.06, z0, z1], [x1 - 0.06, x1, z0, z1]]) M.box(b - a, 0.14, d - c, trim, (a + b) / 2, 0.07, (c + d) / 2);
  sp.add(x0 - 1, x0, -1, h + 1, z0 - 1, z1 + 1); sp.add(x1, x1 + 1, -1, h + 1, z0 - 1, z1 + 1);
  sp.add(x0 - 1, x1 + 1, -1, h + 1, z0 - 1, z0); sp.add(x0 - 1, x1 + 1, -1, h + 1, z1, z1 + 1);
  sp.add(x0 - 1, x1 + 1, h, h + 2, z0 - 1, z1 + 1);
}

/** a door (closed, with a frame) in a wall facing +z or -z, and its name plate */
export function door(M: Mesher, group: THREE.Group, x: number, z: number, face: 1 | -1, col: string, label: string, plateCol = col) {
  M.box(1.3, 2.3, 0.06, col, x, 1.15, z);
  M.box(1.5, 0.12, 0.12, '#2b1e15', x, 2.38, z); for (const s of [-1, 1]) M.box(0.1, 2.4, 0.12, '#2b1e15', x + s * 0.7, 1.2, z);
  M.sph(0.05, '#d9a93a', x + 0.45, 1.1, z + face * 0.06);
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#1b1612'; g.fillRect(0, 0, 512, 128); g.strokeStyle = '#d4a944'; g.lineWidth = 8; g.strokeRect(6, 6, 500, 116);
  g.fillStyle = plateCol; g.fillRect(18, 18, 14, 92); g.fillRect(480, 18, 14, 92);
  g.fillStyle = '#f6e7bd'; g.textAlign = 'center'; g.textBaseline = 'middle';
  let fs = 64; g.font = `800 ${fs}px system-ui, sans-serif`;
  while (g.measureText(label).width > 410 && fs > 20) { fs -= 4; g.font = `800 ${fs}px system-ui, sans-serif`; }
  g.fillText(label, 256, 68);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.375), new THREE.MeshBasicMaterial({ map: t }));
  m.position.set(x, 2.8, z + face * 0.08); m.rotation.y = face > 0 ? 0 : Math.PI; m.frustumCulled = false; group.add(m);
}

// ------------------------------------------------------------------ the Choice room
export class ChoiceRoom {
  readonly group = new THREE.Group();
  readonly space = new Space(CHOICE.x, CHOICE.y, CHOICE.z, 60);
  readonly boards: Board[] = [];
  readonly wait: Board;
  private fruit: THREE.Group[] = [];
  private t = 0;
  static readonly PLINTH = [{ x: -1.8, z: -2.6 }, { x: 1.8, z: -2.6 }];
  constructor(scene: THREE.Scene) {
    const M = new Mesher(), sp = this.space;
    wallsAndFloor(sp, M, -6, 6, -5, 5, 4.6, '#3c2a4a', '#5b3b2a', '#2a1d33', '#d9a93a');
    // the stage: a raised platform with steps, red curtains behind, and two plinths
    M.box(10, 0.4, 3.4, '#7a4a2a', 0, 0.2, -3.3); sp.add(-5, 5, 0, 0.4, -5, -1.6);
    M.box(10, 0.05, 0.1, '#d9a93a', 0, 0.41, -1.62);
    for (let i = -5; i <= 5; i++) M.box(0.9, 4.4, 0.25, i % 2 ? '#a3202d' : '#8a1825', i * 0.95, 2.2, -4.85);
    M.box(10.5, 0.5, 0.35, '#d9a93a', 0, 4.3, -4.7);
    ChoiceRoom.PLINTH.forEach((p, i) => {
      M.cyl(0.42, 0.5, 1.0, i ? '#3d6b82' : '#b8902a', p.x, 0.9, p.z, 1, 1, 16); M.cyl(0.52, 0.52, 0.08, '#f2e6c8', p.x, 1.44, p.z, 1, 1, 16);
      sp.add(p.x - 0.5, p.x + 0.5, 0, 1.48, p.z - 0.5, p.z + 0.5);
      // spotlights: soft cones of light from the ceiling
    });
    // seats for the audience (it is a show, after all)
    for (let r = 0; r < 2; r++) for (let k = -2; k <= 2; k++) {
      const x = k * 1.9, z = 1.6 + r * 1.6;
      if (Math.abs(x) < 1) continue;
      M.box(1.0, 0.45, 0.6, '#5c1f2a', x, 0.22, z); M.box(1.0, 0.7, 0.12, '#4a1822', x, 0.6, z + 0.3);
      sp.add(x - 0.5, x + 0.5, 0, 0.45, z - 0.3, z + 0.36);
    }
    door(M, this.group, 0, 4.92, -1, '#2d6f7a', 'The Secret Room');
    this.group.add(bake(M));
    // the fruit (well...) on the plinths, slowly turning
    for (let i = 0; i < 2; i++) {
      const F = new Mesher();
      if (i === 0) bananaMesh(F, 0, 0, 0, 2.0); else salmonMesh(F, 0, 0, 0, 1.6);
      const g = new THREE.Group(); g.add(bake(F, 1.15)); g.position.set(ChoiceRoom.PLINTH[i].x, 1.5, ChoiceRoom.PLINTH[i].z); this.group.add(g); this.fruit.push(g);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.9, 3.0, 20, 1, true), new THREE.MeshBasicMaterial({ color: i ? '#bfe6ff' : '#fff1b0', transparent: true, opacity: 0.06, depthWrite: false, side: THREE.DoubleSide }));
      cone.position.set(ChoiceRoom.PLINTH[i].x, 3.05, ChoiceRoom.PLINTH[i].z); cone.frustumCulled = false; this.group.add(cone);
      const b = new Board(1.5, 0.9, 512, false, true); b.mesh.position.set(ChoiceRoom.PLINTH[i].x * 1.75, 2.15, -4.55); this.group.add(b.mesh); this.boards.push(b);
    }
    const title = sign(['Do you prefer...', 'a BANANA or a SALMON?'], 5.2, 1.3, '#1e1430', '#ffe28a', '#d9a93a');
    title.position.set(0, 3.75, -4.6); this.group.add(title);
    const lb = sign(['BANANA', '= gorilla'], 1.5, 0.6, '#b8902a', '#2a1a05'); lb.position.set(-1.8, 0.75, -2.08); this.group.add(lb);
    const ls = sign(['SALMON', '= cat'], 1.5, 0.6, '#3d6b82', '#f2f8ff'); ls.position.set(1.8, 0.75, -2.08); this.group.add(ls);
    this.wait = new Board(3.0, 0.7, 512); this.wait.mesh.position.set(0, 3.2, 4.85); this.wait.mesh.rotation.y = Math.PI; this.group.add(this.wait.mesh);
    this.group.position.set(CHOICE.x, CHOICE.y, CHOICE.z); this.group.visible = false;
    scene.add(this.group);
  }
  /** local aim: which plinth (0 banana, 1 salmon), or the door (2) */
  pick(eye: THREE.Vector3, dir: THREE.Vector3, reach: number, assist: number): { i: number; dist: number } | null {
    const hits: { i: number; dist: number }[] = [];
    ChoiceRoom.PLINTH.forEach((p, i) => { const d = rayHit(eye, dir, p.x, 1.4, p.z, 0.75, Math.max(reach, 4), assist); if (d != null) hits.push({ i, dist: d }); });
    const d = rayHit(eye, dir, 0, 1.2, 4.9, 1.1, Math.max(reach, 3.2), assist); if (d != null) hits.push({ i: 2, dist: d });
    hits.sort((a, b) => a.dist - b.dist);
    return hits[0] ?? null;
  }
  /** names over each plinth (with a tick when ready) and the waiting line on the back wall */
  show(lists: string[][], waiting: string) {
    this.boards.forEach((b, i) => b.draw(lists[i].join('|'), (g, W, H) => {
      g.clearRect(0, 0, W, H);
      g.fillStyle = 'rgba(16,10,24,0.82)'; g.beginPath(); g.roundRect(4, 4, W - 8, H - 8, 26); g.fill();
      g.fillStyle = i ? '#bfe6ff' : '#ffe28a'; g.font = '800 46px system-ui, sans-serif'; g.textAlign = 'center';
      g.fillText(i ? 'Salmon · cat' : 'Banana · gorilla', W / 2, 62);
      g.fillStyle = '#fff'; g.font = '700 36px system-ui, sans-serif';
      const L = lists[i].length ? lists[i] : ['(nobody yet)'];
      L.slice(0, 5).forEach((n, k) => g.fillText(n, W / 2, 118 + k * 42));
    }));
    this.wait.draw(waiting, (g, W, H) => {
      g.fillStyle = '#1e1430'; g.fillRect(0, 0, W, H); g.strokeStyle = '#d9a93a'; g.lineWidth = 8; g.strokeRect(4, 4, W - 8, H - 8);
      g.fillStyle = '#fff'; g.font = '700 40px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(waiting, W / 2, H / 2);
    });
  }
  update(dt: number) { this.t += dt; this.fruit.forEach((f, i) => { f.rotation.y = this.t * 0.6 + i; f.position.y = 1.5 + Math.sin(this.t * 2 + i) * 0.03; }); }
}

// ------------------------------------------------------------------ the Cosy room (hub)
export class Hub {
  readonly group = new THREE.Group();
  readonly space = new Space(HUB.x, HUB.y, HUB.z, 60);
  readonly tv = new Board(2.2, 1.24, 768);
  readonly score = new Board(1.7, 2.0, 512);
  readonly lights: THREE.Mesh[] = [];
  readonly flap = new THREE.Group();
  private fire: THREE.Mesh;
  private t = 0;
  static readonly TV = { x: 0, y: 1.75, z: -3.88 };
  static readonly BTN = { x: 4.3, y: 1.0, z: 1.2 };
  constructor(scene: THREE.Scene) {
    const M = new Mesher(), sp = this.space;
    wallsAndFloor(sp, M, -5, 5, -4, 4, 3.0, '#d9b98f', '#8a5a34', '#f1e4cc', '#5c3a1e');
    for (let i = -5; i < 5; i += 0.5) M.box(0.02, 0.012, 8, '#6f4626', i, 0.006, 0);                 // floorboards
    for (let x = -4.5; x <= 4.5; x += 1.5) M.box(0.16, 0.18, 8, '#6b4428', x, 2.9, 0);              // ceiling beams
    M.box(4.2, 0.02, 3.0, '#a8402e', 0, 0.01, 0.3); M.box(3.6, 0.025, 2.4, '#d2a35a', 0, 0.012, 0.3);   // the rug
    // two sofas facing the TV, a coffee table, an armchair
    const sofa = (x: number, z: number, ry: number, c: string, w = 2.2) => {
      const cs = Math.cos(ry), sn = Math.sin(ry);
      const at = (lx: number, lz: number) => [x + lx * cs + lz * sn, z - lx * sn + lz * cs];
      const [ax, az] = at(0, 0); M.box(w, 0.45, 0.9, c, ax, 0.22, az, 0, ry, 0);
      const [bx, bz] = at(0, 0.4); M.box(w, 0.85, 0.22, c, bx, 0.5, bz, 0, ry, 0);
      for (const s of [-1, 1]) { const [cx, cz] = at(s * (w / 2 - 0.1), 0); M.box(0.22, 0.65, 0.9, c, cx, 0.32, cz, 0, ry, 0); }
      const hw = Math.abs(cs) > 0.5 ? w / 2 : 0.45, hd = Math.abs(cs) > 0.5 ? 0.45 : w / 2;
      sp.add(x - hw, x + hw, 0, 0.45, z - hd, z + hd);
    };
    sofa(0, 2.6, 0, '#3d6b82'); sofa(-3.4, 0.4, -Math.PI / 2, '#7a4f8a', 1.8);
    M.box(1.3, 0.08, 0.7, '#7a4a28', 0, 0.42, 0.4); for (const [dx, dz] of [[-0.55, -0.25], [0.55, -0.25], [-0.55, 0.25], [0.55, 0.25]]) M.box(0.06, 0.4, 0.06, '#5c3a1e', dx, 0.2, 0.4 + dz);
    sp.add(-0.65, 0.65, 0, 0.46, 0.05, 0.75);
    M.cyl(0.11, 0.11, 0.1, '#f2f2f2', 0.3, 0.51, 0.35, 1, 1, 10); M.cyl(0.09, 0.09, 0.02, '#4a2a14', 0.3, 0.565, 0.35, 1, 1, 10);   // a mug of tea
    // the TV on a low cabinet, with ready lights on the wall below
    M.box(2.6, 0.55, 0.5, '#5c3a1e', 0, 0.28, -3.7); sp.add(-1.3, 1.3, 0, 0.55, -4, -3.45);
    M.box(2.4, 1.42, 0.1, '#16161a', Hub.TV.x, Hub.TV.y, -3.93);
    this.tv.mesh.position.set(Hub.TV.x, Hub.TV.y, Hub.TV.z); this.group.add(this.tv.mesh);
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), new THREE.MeshBasicMaterial({ color: '#333' }));
      m.position.set(-0.98 + i * 0.28, 0.75, -3.42); m.frustumCulled = false; this.group.add(m); this.lights.push(m);
    }
    const rl = sign(['READY'], 0.6, 0.16, '#5c3a1e', '#f6e7bd'); rl.position.set(-1.25, 0.75, -3.44); this.group.add(rl);
    // a fireplace on the east wall, a bookshelf on the west, a window, lamps
    M.box(0.5, 1.3, 1.8, '#8a7a6a', 4.75, 0.65, -1.6); M.box(0.45, 0.7, 1.0, '#1a1210', 4.6, 0.45, -1.6); M.box(0.6, 0.12, 2.0, '#5c3a1e', 4.72, 1.36, -1.6);
    sp.add(4.4, 5, 0, 1.4, -2.5, -0.7);
    this.fire = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.5, 8), new THREE.MeshBasicMaterial({ color: '#ffb347' }));
    this.fire.position.set(4.6, 0.35, -1.6); this.group.add(this.fire);
    // the bookshelf stands on the east wall, out of the way of the scoreboard
    M.box(0.4, 2.4, 2.2, '#6b4428', 4.78, 1.2, 2.65); sp.add(4.55, 5, 0, 2.4, 1.55, 3.75);
    const bc = ['#a33', '#36a', '#3a6', '#ca3', '#839', '#d72', '#555', '#2aa'];
    for (let s = 0; s < 4; s++) { M.box(0.42, 0.04, 2.1, '#5c3a1e', 4.6, 0.25 + s * 0.55, 2.65); for (let b = 0; b < 11; b++) M.box(0.25, 0.32 + (b % 3) * 0.05, 0.1, bc[(b + s * 3) % 8], 4.55, 0.45 + s * 0.55, 1.75 + b * 0.18); }
    M.box(0.06, 1.2, 1.8, '#dff2ff', -4.92, 1.7, 1.8); M.box(0.1, 1.3, 0.08, '#5c3a1e', -4.88, 1.7, 1.8); M.box(0.1, 0.08, 1.9, '#5c3a1e', -4.88, 1.7, 1.8);
    for (const [x, z] of [[-4.2, 3.4], [4.2, -3.4]]) { M.cyl(0.04, 0.04, 1.4, '#3a2a1a', x, 0.7, z, 1, 1, 6); M.cyl(0.18, 0.26, 0.3, '#f7e2a8', x, 1.5, z, 1, 1, 12); }
    // the big red button (with a guard flap) on a pedestal by the east wall
    M.box(0.5, 0.9, 0.5, '#444a52', Hub.BTN.x, 0.45, Hub.BTN.z); sp.add(Hub.BTN.x - 0.25, Hub.BTN.x + 0.25, 0, 0.9, Hub.BTN.z - 0.25, Hub.BTN.z + 0.25);
    M.cyl(0.14, 0.16, 0.08, '#d22', Hub.BTN.x, 0.95, Hub.BTN.z, 1, 1, 16);
    const fm = new Mesher(); fm.box(0.38, 0.02, 0.38, '#ffd23f', 0, 0.01, -0.19); const f = bake(fm); f.material = new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.55 });
    this.flap.add(f); this.flap.position.set(Hub.BTN.x, 1.0, Hub.BTN.z + 0.19); this.group.add(this.flap);
    const rs = sign(['RESET', 'start over'], 0.7, 0.32, '#5a0e0e', '#ffd9d0'); rs.position.set(Hub.BTN.x, 1.55, Hub.BTN.z); rs.rotation.y = -Math.PI / 2; this.group.add(rs);
    // the scoreboard: a framed board on the west wall
    M.box(0.08, 2.2, 1.9, '#d9a93a', -4.95, 1.5, 1.8 - 2.3);
    this.score.mesh.position.set(-4.9, 1.5, -0.5); this.score.mesh.rotation.y = Math.PI / 2; this.group.add(this.score.mesh);
    door(M, this.group, 0, 3.92, -1, '#2d6f7a', 'The Secret Room');
    this.group.add(bake(M));
    this.group.position.set(HUB.x, HUB.y, HUB.z); this.group.visible = false;
    scene.add(this.group);
  }
  /** which mission row of the scoreboard a ray points at (the board hangs on the west wall facing east) */
  scoreRow(eye: THREE.Vector3, dir: THREE.Vector3, reach: number, rows: number): { i: number; dist: number } | null {
    if (dir.x > -1e-3) return null;
    const t = (-4.89 - eye.x) / dir.x; if (t < 0 || t > Math.max(reach, 6)) return null;
    const y = eye.y + dir.y * t, z = eye.z + dir.z * t;
    if (Math.abs(z + 0.5) > 0.85 || Math.abs(y - 1.5) > 1.0) return null;
    const py = ((2.5 - y) / 2.0) * this.score.H;
    for (let i = 0; i < rows; i++) if (py > 76 + i * 100 && py < 166 + i * 100) return { i, dist: t };   // (rows as drawn in campaign.ts: 112 + i * 100)
    return null;
  }
  pick(eye: THREE.Vector3, dir: THREE.Vector3, reach: number, assist: number): { w: 'tv' | 'reset' | 'exit'; dist: number } | null {
    let best: { w: 'tv' | 'reset' | 'exit'; dist: number } | null = null;
    const take = (w: 'tv' | 'reset' | 'exit', d: number | null) => { if (d != null && (!best || d < best.dist)) best = { w, dist: d }; };
    take('tv', rayHit(eye, dir, Hub.TV.x, Hub.TV.y, Hub.TV.z, 0.9, 8, assist));
    take('reset', rayHit(eye, dir, Hub.BTN.x, 0.95, Hub.BTN.z, 0.35, Math.max(reach, 3), assist));
    take('exit', rayHit(eye, dir, 0, 1.2, 3.92, 1.1, Math.max(reach, 3.2), assist));
    return best;
  }
  setLights(states: (0 | 1 | 2)[]) {
    this.lights.forEach((m, i) => { (m.material as THREE.MeshBasicMaterial).color.set(states[i] === 2 ? '#5dff6a' : states[i] === 1 ? '#a03a2a' : '#2a2a2a'); });
  }
  update(dt: number, armed: boolean) {
    this.t += dt;
    this.fire.scale.set(1 + Math.sin(this.t * 9) * 0.08, 1 + Math.sin(this.t * 13) * 0.15, 1);
    this.flap.rotation.x += ((armed ? -1.6 : 0) - this.flap.rotation.x) * Math.min(1, dt * 8);
  }
}
