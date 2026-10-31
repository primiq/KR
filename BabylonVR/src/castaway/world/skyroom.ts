// The secret room: a small hall floating high above the island, reached through the odd door in one of the huts.
// The floor is glass (you look straight down at the island), your photo hangs on the far wall and the song plays while you are inside.
// It is a cave-style "ground" for the player (floor + walls), so nothing else in the world needs to know about it.
// Babylon port: Castaway's code, drawn by render/mirror.ts. The mirror on the east wall is a plane named 'skyMirror' (the
// Babylon side gives it a MirrorTexture); only its gold frame is built here.
import * as THREE from 'three';
import photoUrl from '../assets/photo.jpg?inline';
import songUrl from '../assets/song.mp3?inline';

interface V3 { x: number; y: number; z: number }

export const SKY_Y = 300;
const HALF = 4, H = 3.6, EDGE = 0.32, CAT_X = -3.1, HIDE_X = 2.6, TRIAL_X = -2.6, CLOUD_X = 3.1, CAMP_Z = -2.5, LOC_Z = 2.5;

export class SkyRoom {
  readonly group = new THREE.Group();
  active = false;
  private audio: HTMLAudioElement | null = null;
  private vol = 0;
  private want = 0;
  /** where the hut door is (set by main), so the way back lands inside the hut */
  exitTo: { x: number; y: number; z: number; yaw: number } | null = null;
  muted = () => false;
  /** the cloud door: swings open, then (jump) is called to launch the skydive */
  readonly cloudDoor = new THREE.Group();
  private cloudT = -1;
  onJump: (() => void) | null = null;
  onDoorOpen: (() => void) | null = null;
  /** true while somebody is skydiving, so the usual "you are up in the sky, go home" rescue leaves them alone */
  skydiving = () => false;
  openCloud() { if (this.cloudT < 0) { this.cloudT = 0; this.onDoorOpen?.(); } }

  constructor(scene: THREE.Scene) {
    const basic = (c: string, o: Partial<THREE.MeshBasicMaterialParameters> = {}) => new THREE.MeshBasicMaterial({ color: c, ...o });
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
      const q = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); q.position.set(x, SKY_Y + y, z); q.frustumCulled = false; this.group.add(q); return q;
    };
    const wall = basic('#5a4030'), wall2 = basic('#6b4c38'), trim = basic('#2b1e15'), gold = basic('#d9a93a'), steel = basic('#8a97a3');
    const ceil = basic('#352619'), glow = basic('#fff2c8');
    // glass floor with a steel grid, so it reads as see-through
    box(HALF * 2, 0.04, HALF * 2, 0, -0.03, 0, basic('#9fd8ef', { transparent: true, opacity: 0.16, depthWrite: false }));
    for (let i = -HALF; i <= HALF; i++) {
      box(0.07, 0.07, HALF * 2, i, -0.04, 0, steel);
      box(HALF * 2, 0.07, 0.07, 0, -0.04, i, steel);
    }
    // walls in alternating panels, a ceiling with light strips, skirting and cornice
    for (const side of [-1, 1]) {
      for (let k = 0; k < 8; k++) {
        box(0.12, H, 1, side * HALF, H / 2, -HALF + 0.5 + k, k % 2 ? wall : wall2);
        box(1, H, 0.12, -HALF + 0.5 + k, H / 2, side * HALF, k % 2 ? wall : wall2);
      }
      box(0.2, 0.25, HALF * 2, side * (HALF - 0.04), 0.12, 0, trim); box(HALF * 2, 0.25, 0.2, 0, 0.12, side * (HALF - 0.04), trim);
      box(0.2, 0.2, HALF * 2, side * (HALF - 0.04), H - 0.1, 0, trim); box(HALF * 2, 0.2, 0.2, 0, H - 0.1, side * (HALF - 0.04), trim);
    }
    box(HALF * 2 + 0.3, 0.12, HALF * 2 + 0.3, 0, H + 0.06, 0, ceil);
    for (const x of [-2.2, 0, 2.2]) box(0.5, 0.03, HALF * 2 - 1.4, x, H - 0.02, 0, glow);
    // the photo: a big gold frame on the north wall
    const tex = new THREE.TextureLoader().load(photoUrl); tex.colorSpace = THREE.SRGBColorSpace;
    const PH = 2.5, pz = -HALF + 0.1, py = 1.95;
    box(PH + 0.5, PH + 0.5, 0.1, 0, py, pz, gold);
    box(PH + 0.3, PH + 0.3, 0.12, 0, py, pz + 0.01, trim);
    const pic = new THREE.Mesh(new THREE.PlaneGeometry(PH, PH), new THREE.MeshBasicMaterial({ map: tex }));
    pic.position.set(0, SKY_Y + py, pz + 0.08); pic.frustumCulled = false; this.group.add(pic);
    // a runner carpet leading in from the door, and two small lamps flanking the picture
    box(1.6, 0.03, 6.4, 0, 0.0, 0.8, basic('#7a2c33'));
    for (const x of [-2.2, 2.2]) { box(0.14, 0.9, 0.14, x, 0.45, -HALF + 0.5, trim); box(0.4, 0.3, 0.4, x, 1.05, -HALF + 0.5, glow); }
    // the way back: a door in the south wall
    box(1.3, 2.3, 0.06, 0, 1.15, HALF - 0.08, basic('#2d6f7a'));
    box(1.5, 0.12, 0.1, 0, 2.38, HALF - 0.08, trim); for (const s of [-1, 1]) box(0.1, 2.4, 0.1, s * 0.7, 1.2, HALF - 0.08, trim);
    box(0.1, 0.1, 0.1, 0.45, 1.1, HALF - 0.16, gold);
    // a second door, in the west wall: leads to the airstrip island
    box(0.06, 2.3, 1.3, -HALF + 0.08, 1.15, 0, basic('#c8431b'));
    box(0.1, 0.12, 1.5, -HALF + 0.08, 2.38, 0, trim); for (const s of [-1, 1]) box(0.1, 2.4, 0.1, -HALF + 0.08, 1.2, s * 0.7, trim);
    box(0.1, 0.1, 0.1, -HALF + 0.16, 1.1, 0.45, gold);
    box(0.04, 0.4, 1.1, -HALF + 0.1, 2.85, 0, basic('#1d3a5c'));
    // a third door, in the north wall beside the picture: a cat flap's big brother, leads to the cat house
    box(1.3, 2.3, 0.06, CAT_X, 1.15, -HALF + 0.08, basic('#7b4fb0'));
    box(1.5, 0.12, 0.1, CAT_X, 2.38, -HALF + 0.08, trim); for (const s of [-1, 1]) box(0.1, 2.4, 0.1, CAT_X + s * 0.7, 1.2, -HALF + 0.08, trim);
    box(0.1, 0.1, 0.1, CAT_X + 0.45, 1.1, -HALF + 0.16, gold);
    for (const [dx, dy] of [[-0.18, 1.55], [0.0, 1.62], [0.18, 1.55], [-0.08, 1.38], [0.1, 1.38]]) box(0.09, 0.09, 0.02, CAT_X + dx, dy, -HALF + 0.13, gold);   // a paw print
    box(0.26, 0.2, 0.02, CAT_X, 1.2, -HALF + 0.13, gold);
    // a fourth door, in the south wall beside the way home: leads to Hideaway Isle (hide and seek)
    box(1.3, 2.3, 0.06, HIDE_X, 1.15, HALF - 0.08, basic('#2f9e5c'));
    box(1.5, 0.12, 0.1, HIDE_X, 2.38, HALF - 0.08, trim); for (const s of [-1, 1]) box(0.1, 2.4, 0.1, HIDE_X + s * 0.7, 1.2, HALF - 0.08, trim);
    box(0.1, 0.1, 0.1, HIDE_X - 0.45, 1.1, HALF - 0.16, gold);
    box(0.5, 0.5, 0.02, HIDE_X, 1.75, HALF - 0.13, gold); box(0.38, 0.38, 0.03, HIDE_X, 1.75, HALF - 0.14, basic('#2f9e5c'));   // a "?" plate: where are they hiding?
    // a fifth door, south wall, other side of the way home: a copper steampunk door to the Chamber of Tiles
    box(1.3, 2.3, 0.06, TRIAL_X, 1.15, HALF - 0.08, basic('#a8582c'));
    box(1.5, 0.12, 0.1, TRIAL_X, 2.38, HALF - 0.08, trim); for (const s of [-1, 1]) box(0.1, 2.4, 0.1, TRIAL_X + s * 0.7, 1.2, HALF - 0.08, trim);
    box(0.1, 0.1, 0.1, TRIAL_X + 0.45, 1.1, HALF - 0.16, gold);
    for (const [dx, dy] of [[-0.3, 1.9], [0.3, 1.9], [-0.3, 0.6], [0.3, 0.6]]) box(0.12, 0.12, 0.02, TRIAL_X + dx, dy, HALF - 0.13, steel);   // rivets
    box(0.5, 0.5, 0.03, TRIAL_X, 1.55, HALF - 0.13, gold); box(0.38, 0.38, 0.04, TRIAL_X, 1.55, HALF - 0.14, basic('#5a3a1e'));          // a brass gear plate
    // a name plate above every door
    const plate = (text: string, col: string, x: number, z: number, ry: number) => {
      const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
      const g = cv.getContext('2d')!;
      g.fillStyle = '#1b1612'; g.fillRect(0, 0, 512, 128);
      g.strokeStyle = '#d4a944'; g.lineWidth = 8; g.strokeRect(6, 6, 500, 116);
      g.fillStyle = col; g.fillRect(18, 18, 14, 92); g.fillRect(480, 18, 14, 92);
      g.fillStyle = '#f6e7bd'; g.textAlign = 'center'; g.textBaseline = 'middle';
      let fs = 64; g.font = `800 ${fs}px system-ui, sans-serif`;
      while (g.measureText(text).width > 410 && fs > 20) { fs -= 4; g.font = `800 ${fs}px system-ui, sans-serif`; }
      g.fillText(text, 256, 68);
      const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.375), new THREE.MeshBasicMaterial({ map: t }));
      m.position.set(x, SKY_Y + 2.8, z); m.rotation.y = ry; m.frustumCulled = false; this.group.add(m);
    };
    plate('Back to the hut', '#2d6f7a', 0, HALF - 0.16, Math.PI);
    plate('The Island', '#2f9e5c', HIDE_X, HALF - 0.16, Math.PI);
    plate('Tile Floor', '#a8582c', TRIAL_X, HALF - 0.16, Math.PI);
    plate("You're a Cat!", '#7b4fb0', CAT_X, -HALF + 0.16, 0);
    plate('Free Fall', '#7ec4f0', CLOUD_X, -HALF + 0.16, 0);
    plate('The Airstrip', '#c8431b', -HALF + 0.16, 0, Math.PI / 2);
    // a seventh door, west wall: yellow and pink, a banana and a fish painted on it - Banana or Salmon (the co-op campaign)
    box(0.06, 2.3, 1.3, -HALF + 0.08, 1.15, CAMP_Z, basic('#f2c94c'));
    box(0.1, 0.12, 1.5, -HALF + 0.08, 2.38, CAMP_Z, trim); for (const s of [-1, 1]) box(0.1, 2.4, 0.1, -HALF + 0.08, 1.2, CAMP_Z + s * 0.7, trim);
    box(0.1, 0.1, 0.1, -HALF + 0.16, 1.1, CAMP_Z + 0.45, gold);
    box(0.03, 0.5, 0.12, -HALF + 0.12, 1.75, CAMP_Z - 0.25, basic('#ffe680')); box(0.03, 0.12, 0.42, -HALF + 0.12, 1.55, CAMP_Z + 0.22, basic('#e88a7a'));
    box(0.03, 0.18, 0.08, -HALF + 0.12, 1.55, CAMP_Z + 0.46, basic('#e88a7a'));
    plate('Banana or Salmon', '#f2c94c', -HALF + 0.16, CAMP_Z, Math.PI / 2);
    // an eighth door, west wall on the other side of the airstrip door: dark blue-grey with a little screen in it - Locations, Locations
    box(0.06, 2.3, 1.3, -HALF + 0.08, 1.15, LOC_Z, basic('#34495e'));
    box(0.1, 0.12, 1.5, -HALF + 0.08, 2.38, LOC_Z, trim); for (const s of [-1, 1]) box(0.1, 2.4, 0.1, -HALF + 0.08, 1.2, LOC_Z + s * 0.7, trim);
    box(0.1, 0.1, 0.1, -HALF + 0.16, 1.1, LOC_Z - 0.45, gold);
    box(0.03, 0.45, 0.6, -HALF + 0.12, 1.7, LOC_Z, basic('#16a085')); box(0.035, 0.35, 0.5, -HALF + 0.13, 1.7, LOC_Z, basic('#9ff5e0'));
    plate('Locations, Locations', '#16a085', -HALF + 0.16, LOC_Z, Math.PI / 2);
    // a sixth door, north wall: sky blue, painted with clouds. It really opens - onto the open sky - and you jump out to parachute down.
    {
      const nz = -HALF + 0.08, W = 1.3, Hh = 2.3;
      box(W + 0.2, Hh + 0.1, 0.02, CLOUD_X, 1.15, -HALF + 0.03, basic('#cfe9ff'));                                  // behind the door: the sky
      for (const [dx, dy, s] of [[-0.3, 0.5, 0.35], [0.2, 1.3, 0.3], [-0.1, 1.9, 0.28], [0.3, 0.3, 0.25]] as const) {
        const c = new THREE.Mesh(new THREE.SphereGeometry(s, 10, 8), basic('#ffffff')); c.scale.set(1.6, 0.7, 0.3); c.position.set(CLOUD_X + dx, SKY_Y + dy, -HALF + 0.07); c.frustumCulled = false; this.group.add(c);
      }
      this.cloudDoor.position.set(CLOUD_X - W / 2, SKY_Y, nz + 0.02);                                              // hinge on the left edge
      const door = new THREE.Mesh(new THREE.BoxGeometry(W, Hh, 0.06), basic('#7ec4f0')); door.position.set(W / 2, Hh / 2, 0); door.frustumCulled = false; this.cloudDoor.add(door);
      const cloud = (x: number, y: number, s: number) => {
        for (const [ox, oy, r] of [[0, 0, 1], [0.7, -0.1, 0.8], [-0.7, -0.1, 0.8], [0.3, 0.35, 0.8], [-0.35, 0.3, 0.7]] as const) {
          const m = new THREE.Mesh(new THREE.SphereGeometry(0.2 * s * r, 10, 8), basic('#ffffff')); m.scale.set(1, 0.8, 0.28); m.position.set(W / 2 + x + ox * 0.22 * s, y + oy * 0.2 * s, 0.04); m.frustumCulled = false; this.cloudDoor.add(m);
        }
      };
      cloud(-0.2, 1.7, 1.4); cloud(0.25, 0.9, 1.1); cloud(-0.25, 0.35, 0.9);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), gold); knob.position.set(W - 0.12, 1.1, 0.06); knob.frustumCulled = false; this.cloudDoor.add(knob);
      this.group.add(this.cloudDoor);
      box(1.5, 0.12, 0.1, CLOUD_X, 2.38, -HALF + 0.08, trim); for (const sd of [-1, 1]) box(0.1, 2.4, 0.1, CLOUD_X + sd * 0.7, 1.2, -HALF + 0.08, trim);
    }
    {
      // the mirror: a plane in the east wall in a gold frame
      const W = 3.4, Hh = 2.3, CY = 1.55, wx = HALF - 0.06;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(W, Hh), new THREE.MeshBasicMaterial({ name: 'skyMirror' }));
      plane.rotation.y = -Math.PI / 2; plane.position.set(wx - 0.015, SKY_Y + CY, 0); this.group.add(plane);
      const t = 0.16;
      const fr = (d: number, h: number, w: number, y: number, z: number) => box(d, h, w, wx - 0.05, y, z, gold);
      fr(0.1, t, W + 2 * t, CY + Hh / 2 + t / 2, 0); fr(0.1, t, W + 2 * t, CY - Hh / 2 - t / 2, 0);
      fr(0.1, Hh, t, CY, W / 2 + t / 2); fr(0.1, Hh, t, CY, -W / 2 - t / 2);
    }
    this.group.visible = false;
    this.group.userData.babylonTag = { skyroom: true };
    this.group.position.set(0, 0, 0);
    scene.add(this.group);
  }

  // the player's "ground" while inside (same shape as the caves')
  floor(x: number, z: number, _y: number) { return Math.abs(x) < HALF && Math.abs(z) < HALF ? SKY_Y : SKY_Y - 400; }
  resolve(x: number, z: number, r: number, _feetY: number, out: { x: number; z: number }) {
    const m = HALF - EDGE - r * 0.4;
    out.x = Math.max(-m, Math.min(m, x)); out.z = Math.max(-m, Math.min(m, z));
  }

  /** looking at the door back to the hut? */
  pick(eye: V3, dir: V3, reach: number, assist = 1): number | null {
    if (!this.active) return null;
    const dx = 0 - eye.x, dy = SKY_Y + 1.1 - eye.y, dz = HALF - eye.z;
    const t = dx * dir.x + dy * dir.y + dz * dir.z;
    if (t < 0 || t > reach + 1) return null;
    const px = dx - dir.x * t, py = dy - dir.y * t, pz = dz - dir.z * t, r = 1.1 * assist;
    return px * px + py * py + pz * pz <= r * r ? t : null;
  }

  /** looking at the west door (to the airstrip)? */
  pickAir(eye: V3, dir: V3, reach: number, assist = 1): number | null {
    if (!this.active) return null;
    const dx = -HALF - eye.x, dy = SKY_Y + 1.1 - eye.y, dz = 0 - eye.z;
    const t = dx * dir.x + dy * dir.y + dz * dir.z;
    if (t < 0 || t > reach + 1) return null;
    const px = dx - dir.x * t, py = dy - dir.y * t, pz = dz - dir.z * t, r = 1.1 * assist;
    return px * px + py * py + pz * pz <= r * r ? t : null;
  }
  /** looking at the north-wall door (to the cat house)? */
  pickCat(eye: V3, dir: V3, reach: number, assist = 1): number | null {
    if (!this.active) return null;
    const dx = CAT_X - eye.x, dy = SKY_Y + 1.1 - eye.y, dz = -HALF - eye.z;
    const t = dx * dir.x + dy * dir.y + dz * dir.z;
    if (t < 0 || t > reach + 1) return null;
    const px = dx - dir.x * t, py = dy - dir.y * t, pz = dz - dir.z * t, r = 1.1 * assist;
    return px * px + py * py + pz * pz <= r * r ? t : null;
  }
  /** looking at the south-wall door beside the way home (to Hideaway Isle)? */
  pickHide(eye: V3, dir: V3, reach: number, assist = 1): number | null {
    if (!this.active) return null;
    const dx = HIDE_X - eye.x, dy = SKY_Y + 1.1 - eye.y, dz = HALF - eye.z;
    const t = dx * dir.x + dy * dir.y + dz * dir.z;
    if (t < 0 || t > reach + 1) return null;
    const px = dx - dir.x * t, py = dy - dir.y * t, pz = dz - dir.z * t, r = 1.0 * assist;
    return px * px + py * py + pz * pz <= r * r ? t : null;
  }
  /** looking at the copper door (to the Chamber of Tiles)? */
  pickTrial(eye: V3, dir: V3, reach: number, assist = 1): number | null {
    if (!this.active) return null;
    const dx = TRIAL_X - eye.x, dy = SKY_Y + 1.1 - eye.y, dz = HALF - eye.z;
    const t = dx * dir.x + dy * dir.y + dz * dir.z;
    if (t < 0 || t > reach + 1) return null;
    const px = dx - dir.x * t, py = dy - dir.y * t, pz = dz - dir.z * t, r = 1.0 * assist;
    return px * px + py * py + pz * pz <= r * r ? t : null;
  }
  /** looking at the Banana or Salmon door? */
  pickCamp(eye: V3, dir: V3, reach: number, assist = 1): number | null {
    if (!this.active) return null;
    const dx = -HALF - eye.x, dy = SKY_Y + 1.1 - eye.y, dz = CAMP_Z - eye.z;
    const t = dx * dir.x + dy * dir.y + dz * dir.z;
    if (t < 0 || t > reach + 1) return null;
    const px = dx - dir.x * t, py = dy - dir.y * t, pz = dz - dir.z * t, r = 1.0 * assist;
    return px * px + py * py + pz * pz <= r * r ? t : null;
  }
  /** looking at the Locations, Locations door? */
  pickLoc(eye: V3, dir: V3, reach: number, assist = 1): number | null {
    if (!this.active) return null;
    const dx = -HALF - eye.x, dy = SKY_Y + 1.1 - eye.y, dz = LOC_Z - eye.z;
    const t = dx * dir.x + dy * dir.y + dz * dir.z;
    if (t < 0 || t > reach + 1) return null;
    const px = dx - dir.x * t, py = dy - dir.y * t, pz = dz - dir.z * t, r = 1.0 * assist;
    return px * px + py * py + pz * pz <= r * r ? t : null;
  }
  /** looking at the cloud door? */
  pickCloud(eye: V3, dir: V3, reach: number, assist = 1): number | null {
    if (!this.active || this.cloudT >= 0) return null;
    const dx = CLOUD_X - eye.x, dy = SKY_Y + 1.1 - eye.y, dz = -HALF - eye.z;
    const t = dx * dir.x + dy * dir.y + dz * dir.z;
    if (t < 0 || t > reach + 1) return null;
    const px = dx - dir.x * t, py = dy - dir.y * t, pz = dz - dir.z * t, r = 1.0 * assist;
    return px * px + py * py + pz * pz <= r * r ? t : null;
  }
  private closeCloud() { this.cloudT = -1; this.cloudDoor.rotation.y = 0; }
  /** (back) from the airstrip or the cat house: arrive in front of the door you left by */
  enter(p: { teleport(x: number, y: number, z: number, yaw: number): void; cave: any }, from: 'hut' | 'air' | 'cat' | 'hide' | 'trial' | 'camp' | 'loc' = 'hut') {
    this.active = true; this.group.visible = true; this.closeCloud();
    p.cave = this;
    if (from === 'air') p.teleport(-HALF + 1.6, SKY_Y, 0, -Math.PI / 2); else if (from === 'camp') p.teleport(-HALF + 1.6, SKY_Y, CAMP_Z, -Math.PI / 2); else if (from === 'loc') p.teleport(-HALF + 1.6, SKY_Y, LOC_Z, -Math.PI / 2); else if (from === 'cat') p.teleport(CAT_X, SKY_Y, -HALF + 1.6, Math.PI); else if (from === 'hide') p.teleport(HIDE_X, SKY_Y, HALF - 1.6, 0); else if (from === 'trial') p.teleport(TRIAL_X, SKY_Y, HALF - 1.6, 0); else p.teleport(0, SKY_Y, HALF - 1.5, 0);
    this.play(true, from === 'hut');
  }
  /** the player goes elsewhere (the airstrip sets its own ground): just hide the room and stop the song */
  depart() { this.active = false; this.group.visible = false; this.play(false); this.closeCloud(); }
  leave(p: { teleport(x: number, y: number, z: number, yaw: number): void; cave: any }, to: { x: number; y: number; z: number; yaw: number }) {
    this.active = false; this.group.visible = false;
    p.cave = null;
    p.teleport(to.x, to.y, to.z, to.yaw);
    this.play(false);
  }

  private ended = false;
  /** the song plays once, at 40% of its old volume; coming back from another door carries on where it was and never restarts a finished song */
  private play(on: boolean, fresh = false) {
    this.want = on ? 0.32 : 0;
    if (!on) return;
    try {
      if (!this.audio) { this.audio = new Audio(songUrl); this.audio.loop = false; this.audio.preload = 'auto'; this.audio.onended = () => { this.ended = true; this.want = 0; }; fresh = true; }
      if (fresh) { this.ended = false; this.audio.currentTime = 0; this.vol = 0; }
      if (this.ended) { this.want = 0; return; }
      this.audio.volume = this.vol;
      void this.audio.play().catch(() => { /* needs a tap first: the next frame retries */ });
    } catch { /* no audio available */ }
  }

  private fadeSong(dt: number) {
    const a = this.audio; if (!a) return;
    const goal = this.muted() ? 0 : this.want;
    this.vol += Math.sign(goal - this.vol) * Math.min(Math.abs(goal - this.vol), dt * (goal > this.vol ? 0.5 : 1.2));
    a.volume = Math.max(0, Math.min(1, this.vol));
    if (this.want > 0 && !this.ended && a.paused && !this.muted()) void a.play().catch(() => {});
    if (this.want === 0 && this.vol <= 0.001 && !a.paused) a.pause();
  }

  /** fades the song in and out; also pulls anybody who ended up in the sky by other means (a save, a respawn) back down */
  update(dt: number, p: { pos: V3; cave: any; yaw: number; teleport(x: number, y: number, z: number, yaw: number): void }, groundY: (x: number, z: number) => number) {
    if (this.cloudT >= 0 && this.active) {
      this.cloudT += dt;
      this.cloudDoor.rotation.y = Math.min(1, this.cloudT / 1.1) * -1.75;                  // swings into the room
      if (this.cloudT > 2.2) { this.cloudT = -1; this.onJump?.(); }
    }
    this.fadeSong(dt);
    if (this.skydiving()) return;
    if (this.active && (Math.abs(p.pos.x) > HALF + 1 || Math.abs(p.pos.z) > HALF + 1 || p.pos.y < SKY_Y - 60)) {
      this.active = false; this.group.visible = false; p.cave = null; this.play(false);
      const to = this.exitTo; if (to) p.teleport(to.x, to.y, to.z, to.yaw); else p.teleport(p.pos.x, groundY(p.pos.x, p.pos.z), p.pos.z, p.yaw);
    } else if (!this.active && p.pos.y > 150) {
      const to = this.exitTo; if (to) p.teleport(to.x, to.y, to.z, to.yaw); else p.teleport(p.pos.x, groundY(p.pos.x, p.pos.z), p.pos.z, p.yaw);
    }
  }
}
