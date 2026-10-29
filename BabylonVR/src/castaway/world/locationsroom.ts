// Locations, Locations: a cosy little control room (reached through a door in the secret room) with a wall of monitors.
// Each monitor shows one real place from the registry (src/world/locations.ts); click one to go there. Spare monitors show
// "Coming soon" static. Same cave-style ground as the other special areas (player.cave = room.space).
import * as THREE from 'three';
import { Mesher } from '../net/playerModel';
import { Space, bake, Board, sign } from '../campaign/space';
import { door } from '../campaign/rooms';
import { LOCATIONS, OSM_CREDIT, type LocationEntry } from './locations';

export const LR = { x: -9000, y: 40, z: 0 };
const COLS = 4, ROWS = 2, MW = 1.55, MH = 0.95, WALL_Z = -4.9;
const slotPos = (i: number) => ({ x: (i % COLS - (COLS - 1) / 2) * 1.85, y: 2.45 - Math.floor(i / COLS) * 1.15 });

export type LocTarget = { w: 'exit' } | { w: 'monitor'; i: number };

export class LocationsRoom {
  readonly group = new THREE.Group();
  readonly space = new Space(LR.x, LR.y, LR.z, 40);
  active = false;
  private screens: Board[] = [];
  private frames: THREE.Mesh[] = [];
  private hover = -1;
  private t = 0;
  private imgs = new Map<string, HTMLImageElement>();
  /** a monitor was chosen (the caller sends the player there) */
  onVisit: ((loc: LocationEntry, index: number) => void) | null = null;
  say: (t: string) => void = () => {};

  constructor(scene: THREE.Scene) {
    const M = new Mesher(), sp = this.space;
    const X0 = -5, X1 = 5, Z0 = -5, Z1 = 4, H = 3.6;
    // shell: dark panelled walls, a warm wooden floor, a low ceiling with a lamp strip
    M.box(X1 - X0, 0.1, Z1 - Z0, '#5a3f2c', 0, -0.05, (Z0 + Z1) / 2);
    for (let x = X0 + 0.4; x < X1; x += 0.4) M.box(0.02, 0.012, Z1 - Z0, '#4a3324', x, 0.006, (Z0 + Z1) / 2);
    M.box(X1 - X0, 0.1, Z1 - Z0, '#1e2228', 0, H + 0.05, (Z0 + Z1) / 2);
    const wall = (x0: number, x1: number, z0: number, z1: number, c: string) => { M.box(x1 - x0, H, z1 - z0, c, (x0 + x1) / 2, H / 2, (z0 + z1) / 2); sp.add(x0, x1, -1, H + 1, z0, z1); };
    wall(X0 - 0.2, X0, Z0, Z1, '#2c3440'); wall(X1, X1 + 0.2, Z0, Z1, '#2c3440'); wall(X0, X1, Z0 - 0.2, Z0, '#232a33'); wall(X0, X1, Z1, Z1 + 0.2, '#2c3440');
    sp.add(X0 - 1, X1 + 1, H, H + 2, Z0 - 1, Z1 + 1);
    for (let x = X0 + 0.5; x < X1; x += 1) M.box(0.05, H, 0.04, '#3a4452', x, H / 2, Z1 - 0.02);
    M.box(9.6, 0.04, 0.5, '#fff1c8', 0, H - 0.02, -1);
    // the monitor wall: a steel rack, a bezel per screen, cables hanging down
    M.box(7.8, 2.5, 0.12, '#15181d', 0, 1.95, WALL_Z - 0.05);
    for (let i = 0; i < COLS * ROWS; i++) {
      const p = slotPos(i);
      M.box(MW + 0.14, MH + 0.14, 0.16, '#2a2d33', p.x, p.y, WALL_Z + 0.02);
      M.box(0.06, 0.06, 0.04, i % 3 ? '#3ad65a' : '#e8b33a', p.x + MW / 2 - 0.05, p.y - MH / 2 - 0.04, WALL_Z + 0.11);
      const b = new Board(MW, MH, 512); b.mesh.position.set(p.x, p.y, WALL_Z + 0.105); this.group.add(b.mesh); this.screens.push(b);
      const f = new THREE.Mesh(new THREE.PlaneGeometry(MW + 0.2, MH + 0.2), new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 0, depthWrite: false }));
      f.position.set(p.x, p.y, WALL_Z + 0.1); f.frustumCulled = false; this.group.add(f); this.frames.push(f);
    }
    for (let k = 0; k < 9; k++) M.cyl(0.012, 0.012, 0.7, ['#111', '#222', '#a33', '#333'][k % 4], -3.6 + k * 0.9, 0.35, WALL_Z + 0.05, 1, 1, 5, 0.1);
    sp.add(-3.9, 3.9, 0, 3.3, WALL_Z - 0.2, WALL_Z + 0.2);
    // the desk with its keyboards, two swivel chairs, a rug, lamps
    M.box(6.4, 0.08, 0.9, '#6b4a30', 0, 0.78, -3.6); M.box(6.4, 0.7, 0.06, '#4e3522', 0, 0.4, -3.2);
    for (const x of [-3.1, 3.1]) M.box(0.08, 0.78, 0.86, '#4e3522', x, 0.39, -3.6);
    sp.add(-3.2, 3.2, 0, 0.82, -4.05, -3.15);
    for (let k = 0; k < 4; k++) { M.box(0.5, 0.03, 0.18, '#2a2d33', -2.2 + k * 1.45, 0.83, -3.45); M.box(0.08, 0.02, 0.12, '#e8e8e8', -1.85 + k * 1.45, 0.83, -3.45); }
    M.cyl(0.07, 0.09, 0.12, '#c8343a', 2.7, 0.88, -3.8, 1, 1, 10); M.cyl(0.07, 0.07, 0.04, '#3a1a10', 2.7, 0.95, -3.8, 1, 1, 10);   // a mug of tea
    for (const x of [-1.5, 1.5]) {
      M.cyl(0.25, 0.25, 0.1, '#7a2c33', x, 0.5, -2.6, 1, 1, 12); M.box(0.5, 0.55, 0.08, '#7a2c33', x, 0.82, -2.35); M.cyl(0.03, 0.03, 0.45, '#333', x, 0.23, -2.6, 1, 1, 6);
      sp.add(x - 0.3, x + 0.3, 0, 0.55, -2.9, -2.3);
    }
    M.box(5.6, 0.02, 3.4, '#8a3a2a', 0, 0.01, -0.6); M.box(5.0, 0.025, 2.8, '#c49a5a', 0, 0.012, -0.6);
    for (const [x, z] of [[-4.4, -4.3], [4.4, -4.3], [-4.4, 3.4]] as [number, number][]) { M.cyl(0.035, 0.035, 1.6, '#3a2a1a', x, 0.8, z, 1, 1, 6); M.cyl(0.18, 0.25, 0.3, '#ffe1a0', x, 1.7, z, 1, 1, 12); sp.add(x - 0.2, x + 0.2, 0, 1.8, z - 0.2, z + 0.2); }
    // a sofa at the back, facing the screens
    M.box(2.6, 0.45, 0.85, '#3d6b82', 0, 0.22, 2.9); M.box(2.6, 0.8, 0.2, '#3d6b82', 0, 0.5, 3.3); sp.add(-1.3, 1.3, 0, 0.45, 2.45, 3.4);
    door(M, this.group, -3.4, Z1 - 0.08, -1, '#2d6f7a', 'Secret Room');
    this.group.add(bake(M, 1.0));
    const title = sign(['LOCATIONS, LOCATIONS', 'pick a place on the screens'], 4.2, 0.6, '#15181d', '#ffd27a', '#3a4452'); title.position.set(0, 3.35, WALL_Z + 0.02); this.group.add(title);
    const credit = sign(['Real places, rebuilt from open map data', OSM_CREDIT, 'Street pictures are our own renders'], 2.0, 0.75, '#1d242c', '#e8eef5', '#3a4452');
    credit.position.set(X1 - 0.03, 1.6, 1.2); credit.rotation.y = -Math.PI / 2; this.group.add(credit);
    for (const l of LOCATIONS) if (l.preview) { const im = new Image(); im.src = l.preview; this.imgs.set(l.id, im); }
    this.group.position.set(LR.x, LR.y, LR.z); this.group.visible = false;
    scene.add(this.group);
  }

  contains(x: number, z: number) { return this.space.contains(x, z); }
  enter(p: { teleport(x: number, y: number, z: number, yaw: number): void; cave: any }, fromLoc = -1) {
    this.active = true; this.group.visible = true; p.cave = this.space;
    if (fromLoc >= 0) { const s = slotPos(fromLoc); p.teleport(LR.x + s.x, LR.y, LR.z - 1.9, 0); }
    else p.teleport(LR.x - 3.4, LR.y, LR.z + 2.8, 0);
  }
  leave(p: { cave: any }) { this.active = false; this.group.visible = false; if (p.cave === this.space) p.cave = null; this.hover = -1; }

  pick(eye0: PV, dir0: PV, reach: number, assist = 1): { t: LocTarget; dist: number } | null {
    const eye = _pe.set(eye0.x, eye0.y, eye0.z), dir = _pd.set(dir0.x, dir0.y, dir0.z);
    if (!this.active) return null;
    const lx = eye.x - LR.x, ly = eye.y - LR.y, lz = eye.z - LR.z;
    let best: { t: LocTarget; dist: number } | null = null;
    // the screens: where the aim ray meets the monitor wall (you can point at them from across the room)
    if (dir.z < -0.05) {
      const t = (WALL_Z + 0.1 - lz) / dir.z, x = lx + dir.x * t, y = ly + dir.y * t, pad = 0.06 * assist;
      if (t > 0 && t < 9) for (let i = 0; i < COLS * ROWS; i++) { const s = slotPos(i); if (Math.abs(x - s.x) < MW / 2 + pad && Math.abs(y - s.y) < MH / 2 + pad) best = { t: { w: 'monitor', i }, dist: t }; }
    }
    // the door back
    const dx = -3.4 - lx, dy = 1.1 - ly, dz = 3.9 - lz, t2 = dx * dir.x + dy * dir.y + dz * dir.z;
    if (t2 > 0 && t2 < Math.max(reach, 3.2) + 1) { const px = dx - dir.x * t2, py = dy - dir.y * t2, pz = dz - dir.z * t2; if (px * px + py * py + pz * pz < 1.1 * assist * (1.1 * assist) && (!best || t2 < best.dist)) best = { t: { w: 'exit' }, dist: t2 }; }
    this.hover = best?.t.w === 'monitor' ? best.t.i : -1;
    return best;
  }
  prompt(t: LocTarget): { name: string; hint: string; ok: boolean } {
    if (t.w === 'exit') return { name: 'Door', hint: '<b>E</b> back to the secret room', ok: true };
    const l = LOCATIONS[t.i];
    if (!l) return { name: 'Coming soon', hint: 'More places are on the way', ok: false };
    if (l.status !== 'ready') return { name: l.name, hint: 'Not built yet: the map data has not been fetched', ok: false };
    return { name: l.name, hint: `<b>E</b> / click · Visit ${l.name}`, ok: true };
  }
  /** E / click: 'exit' to go back to the secret room */
  interact(t: LocTarget): 'exit' | null {
    if (t.w === 'exit') return 'exit';
    const l = LOCATIONS[t.i];
    if (!l) { this.say('Coming soon!'); return null; }
    if (l.status !== 'ready') { this.say(`${l.name} is not built yet: its map data still has to be fetched (npm run loc -- ${l.id}).`); return null; }
    this.onVisit?.(l, t.i);
    return null;
  }

  update(dt: number) {
    if (!this.active) { this.hover = -1; return; }
    this.t += dt;
    const tick = Math.floor(this.t * 6);
    this.screens.forEach((b, i) => {
      const l = LOCATIONS[i], hov = this.hover === i;
      (this.frames[i].material as THREE.MeshBasicMaterial).opacity = hov ? 0.55 + 0.2 * Math.sin(this.t * 6) : 0;
      if (!l) { if (i % 2 === tick % 2 || hov) b.draw(`soon|${tick}|${hov}`, (g, W, H) => this.drawStatic(g, W, H, hov)); return; }
      const img = this.imgs.get(l.id), ready = !!img?.complete && img.naturalWidth > 0;
      b.draw(`${l.id}|${l.status}|${hov}|${ready}|${Math.floor(this.t * 2)}`, (g, W, H) => {
        if (ready) g.drawImage(img!, 0, 0, W, H);
        else {
          // no picture yet: a little map-like card in the screen's colours
          const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#1b3a4a'); gr.addColorStop(1, '#0d1c26'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
          g.strokeStyle = 'rgba(160,220,255,0.18)'; g.lineWidth = 10;
          for (let k = 0; k < 5; k++) { g.beginPath(); g.moveTo(0, 60 + k * 70); g.bezierCurveTo(W * 0.3, 20 + k * 60, W * 0.6, 120 + k * 55, W, 80 + k * 65); g.stroke(); }
        }
        g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(0, H - 110, W, 110);
        g.fillStyle = '#fff'; g.font = '800 40px system-ui, sans-serif'; g.fillText(l.name, 20, H - 62);
        g.fillStyle = '#cfe6ff'; g.font = '500 20px system-ui, sans-serif'; g.fillText(l.status === 'ready' ? l.description : 'Map data not fetched yet', 20, H - 28, W - 40);
        if (hov && l.status === 'ready') { g.fillStyle = '#ff3a3a'; g.fillRect(16, 16, 196, 40); g.fillStyle = '#fff'; g.font = '800 24px system-ui, sans-serif'; g.fillText('NOW SHOWING', 26, 45); }
        g.fillStyle = 'rgba(255,255,255,0.05)'; for (let y = (Math.floor(this.t * 40) % 6); y < H; y += 6) g.fillRect(0, y, W, 2);   // scan lines
      });
    });
  }
  private drawStatic(g: CanvasRenderingContext2D, W: number, H: number, hov: boolean) {
    const img = g.createImageData(W / 4, H / 4), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const v = Math.random() * 120 + 40; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    g.putImageData(img, 0, 0); g.drawImage(g.canvas, 0, 0, W / 4, H / 4, 0, 0, W, H);
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(0, H / 2 - 40, W, 80);
    g.fillStyle = hov ? '#ffd27a' : '#fff'; g.font = '800 40px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('Coming soon', W / 2, H / 2 + 14); g.textAlign = 'left';
  }
}

type PV = { x: number; y: number; z: number };
const _pe = new THREE.Vector3(), _pd = new THREE.Vector3();
