// The secret room: a long hall high above the island, reached through the odd door in one of the huts. Doors to every
// other place line both walls, evenly spaced, with bays to spare for places still to come; your photo hangs at the far
// end over the button that plays the song, and a big mirror fills one bay. It is closed all round (nothing outside it is
// drawn while you are in it: main.ts switches the world off).
// Dark walnut panelling, deep green walls between cream pilasters, a gold cornice, a coffered ceiling with warm light in
// every bay, brass wall lamps, polished boards and a long red runner. Everything is drawn unlit (its light is painted
// in), so it looks the same by day and night and costs next to nothing.
// It is a cave-style "ground" for the player (floor + walls), so nothing else in the world needs to know about it.
// Babylon port: drawn by render/mirror.ts. The mirror is a plane named 'skyMirror' (the Babylon side gives it a
// MirrorTexture, world/skyView.ts, about MIRROR_X).
import * as THREE from 'three';
import photoUrl from '../assets/photo.jpg?inline';
import songUrl from '../assets/song.mp3?inline';

interface V3 { x: number; y: number; z: number }

export const SKY_Y = 300;
/** the hall: half its width (x), half its length (z), its height */
const HW = 2.5, HL = 13, H = 4.2, EDGE = 0.32;
/** the bays along each wall (z of each door's middle), from the entrance end to the far end */
const BAYS = [9.6, 6.4, 3.2, 0, -3.2, -6.4, -9.6];
/** which door is in which bay: west wall (x = -HW) and east wall (x = +HW) */
const W_HIDE = BAYS[0], W_TRIAL = BAYS[1], W_CAMP = BAYS[2], W_LOC = BAYS[3], W_AIR = BAYS[4];
const E_CAT = BAYS[0], E_DUNE = BAYS[1], E_CLOUD = BAYS[2], E_MIRROR = BAYS[3];
const SONG_Z = -HL + 0.9;
/** the mirror's plane (x), for world/skyView.ts */
export const MIRROR_X = HW - 0.075;
/** the mirror's middle along the wall */
export const MIRROR_Z = E_MIRROR;

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
  /** the song button's cap (it dips when pressed) */
  private songCap = new THREE.Group();
  private capT = 0;
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
    // the palette (light painted in: lighter up high where the lamps are, darker low down)
    const walnut = basic('#3a2417'), walnutD = basic('#2a190f'), walnutL = basic('#4c3020'), green = basic('#1f3d36'), greenD = basic('#183129');
    const cream = basic('#e8dcc2'), creamD = basic('#cbbd9f'), gold = basic('#c9a24a'), goldL = basic('#e6c46a'), glow = basic('#fff1cf'), glowW = basic('#ffd890');
    const carpet = basic('#7a1f26'), carpetB = basic('#c9a24a'), boardA = basic('#5a3a24'), boardB = basic('#4d311e'), ceil = basic('#efe6d2'), ceilD = basic('#d9cdb3');
    const trim = walnutD, steel = basic('#8a97a3');
    // ---- floor: polished boards, a long red runner with gold borders
    for (let i = 0; i < 10; i++) box(HW * 2 / 10, 0.04, HL * 2, -HW + (i + 0.5) * (HW * 2 / 10), -0.02, 0, i % 2 ? boardA : boardB);
    box(1.9, 0.012, HL * 2 - 1.2, 0, 0.006, 0, carpetB); box(1.7, 0.016, HL * 2 - 1.4, 0, 0.008, 0, carpet);
    for (const z of BAYS) box(1.5, 0.018, 0.05, 0, 0.009, z, carpetB);
    // ---- the long walls: wainscot below a dado rail, green between cream pilasters above, a gold cornice
    for (const side of [-1, 1]) {
      const x = side * HW;
      box(0.12, 1.1, HL * 2, x, 0.55, 0, walnut);                        // wainscot
      box(0.16, 0.08, HL * 2, x - side * 0.02, 1.12, 0, walnutL);        // dado rail
      box(0.14, 0.22, HL * 2, x - side * 0.01, 0.11, 0, walnutD);        // skirting
      box(0.12, H - 1.16, HL * 2, x, 1.16 + (H - 1.16) / 2, 0, green);   // upper wall
      box(0.2, 0.18, HL * 2, x - side * 0.04, H - 0.09, 0, gold);        // cornice
      box(0.26, 0.1, HL * 2, x - side * 0.06, H - 0.24, 0, creamD);
      // pilasters between the bays, with a brass lamp on each
      for (let k = 0; k <= BAYS.length; k++) {
        const z = k === 0 ? BAYS[0] + 1.6 : k === BAYS.length ? BAYS[BAYS.length - 1] - 1.6 : (BAYS[k - 1] + BAYS[k]) / 2;
        box(0.08, H - 1.2, 0.32, x - side * 0.05, 1.2 + (H - 1.2) / 2, z, cream);
        box(0.1, 0.12, 0.42, x - side * 0.06, H - 0.4, z, creamD);
        box(0.1, 0.1, 0.4, x - side * 0.07, 1.25, z, creamD);
        if (k > 0 && k < BAYS.length) {
          box(0.18, 0.05, 0.05, x - side * 0.14, 2.35, z, gold);
          box(0.14, 0.2, 0.14, x - side * 0.24, 2.48, z, glowW);
          box(0.18, 0.04, 0.18, x - side * 0.24, 2.6, z, goldL);
        }
      }
      // each bay: a recessed green panel framed in gold above the door (where a name plate hangs)
    }
    // ---- the end walls
    for (const end of [-1, 1]) {
      const z = end * HL;
      box(HW * 2, 1.1, 0.12, 0, 0.55, z, walnut); box(HW * 2, 0.08, 0.16, 0, 1.12, z - end * 0.02, walnutL); box(HW * 2, 0.22, 0.14, 0, 0.11, z - end * 0.01, walnutD);
      box(HW * 2, H - 1.16, 0.12, 0, 1.16 + (H - 1.16) / 2, z, green); box(HW * 2, 0.18, 0.2, 0, H - 0.09, z - end * 0.04, gold);
      for (const x of [-HW + 0.3, HW - 0.3]) box(0.4, H - 1.2, 0.08, x, 1.2 + (H - 1.2) / 2, z - end * 0.05, cream);
    }
    // ---- the ceiling: coffers with warm light in each bay, beams between
    box(HW * 2 + 0.3, 0.12, HL * 2 + 0.3, 0, H + 0.06, 0, ceil);
    for (let k = 0; k <= BAYS.length; k++) {
      const z = k === 0 ? HL - 0.1 : k === BAYS.length ? -HL + 0.1 : (BAYS[k - 1] + BAYS[k]) / 2;
      box(HW * 2, 0.22, 0.24, 0, H - 0.11, z, ceilD);
    }
    box(0.24, 0.22, HL * 2, 0, H - 0.11, 0, ceilD);
    for (const z of BAYS) for (const x of [-HW / 2, HW / 2]) { box(1.6, 0.03, 2.1, x, H - 0.02, z, glow); box(1.8, 0.05, 2.3, x, H - 0.03, z, goldL); }
    // a chandelier of light over the middle of the hall
    for (const z of [BAYS[1], BAYS[3], BAYS[5]]) {
      box(0.03, 0.6, 0.03, 0, H - 0.3, z, gold);
      const c = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 10), glowW); c.position.set(0, SKY_Y + H - 0.75, z); c.frustumCulled = false; this.group.add(c);
      box(0.6, 0.04, 0.6, 0, H - 0.62, z, goldL);
    }
    // ---- name plates over the doors
    const plate = (text: string, col: string, x: number, z: number, ry: number, y = 2.85) => {
      const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
      const g = cv.getContext('2d')!;
      g.fillStyle = '#1b1612'; g.fillRect(0, 0, 512, 128);
      g.strokeStyle = '#d4a944'; g.lineWidth = 8; g.strokeRect(6, 6, 500, 116);
      g.fillStyle = col; g.fillRect(18, 18, 14, 92); g.fillRect(480, 18, 14, 92);
      g.fillStyle = '#f6e7bd'; g.textAlign = 'center'; g.textBaseline = 'middle';
      let fs = 64; g.font = `800 ${fs}px Georgia, serif`;
      while (g.measureText(text).width > 410 && fs > 20) { fs -= 4; g.font = `800 ${fs}px Georgia, serif`; }
      g.fillText(text, 256, 68);
      const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.375), new THREE.MeshBasicMaterial({ map: t }));
      m.position.set(x, SKY_Y + y, z); m.rotation.y = ry; m.frustumCulled = false; this.group.add(m);
    };
    /**
     * A door in a side wall (side -1 west, +1 east) at bay z: a walnut and gold architrave, the door leaf in its own
     * colour, a brass knob, its name over it, and `deco(put)` painting its motif on it (put: a flat shape w x h, along the
     * wall at dz, up at y, standing proud of the leaf by `out`).
     */
    const door = (side: number, z: number, col: string, name: string, deco?: (put: (w: number, h: number, dz: number, y: number, m: THREE.Material, out?: number) => void) => void, leaf = true) => {
      const x = side * HW, fx = x - side * 0.08, ry = side < 0 ? Math.PI / 2 : -Math.PI / 2;
      if (leaf) box(0.06, 2.3, 1.3, fx, 1.15, z, basic(col));
      box(0.12, 0.16, 1.62, x - side * 0.1, 2.4, z, walnutL); box(0.14, 0.05, 1.66, x - side * 0.11, 2.5, z, gold);
      for (const s2 of [-1, 1]) { box(0.12, 2.42, 0.14, x - side * 0.1, 1.21, z + s2 * 0.73, walnutL); box(0.13, 2.42, 0.03, x - side * 0.1, 1.21, z + s2 * 0.81, gold); }
      if (leaf) { const k = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), goldL); k.position.set(fx - side * 0.07, SKY_Y + 1.1, z + 0.45 * (side < 0 ? 1 : -1)); k.frustumCulled = false; this.group.add(k); }
      plate(name, col, x - side * 0.16, z, ry);
      deco?.((w, h, dz, y, m, out = 0.02) => box(0.02, h, w, fx - side * (0.035 + out), y, z + dz * (side < 0 ? 1 : -1), m));
    };
    // ---- the way back: a teal door in the entrance end
    {
      const z = HL - 0.08;
      box(1.3, 2.3, 0.06, 0, 1.15, z, basic('#2d6f7a'));
      box(1.62, 0.16, 0.12, 0, 2.4, HL - 0.1, walnutL); for (const s2 of [-1, 1]) box(0.14, 2.42, 0.12, s2 * 0.73, 1.21, HL - 0.1, walnutL);
      const k = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), goldL); k.position.set(0.45, SKY_Y + 1.1, HL - 0.16); k.frustumCulled = false; this.group.add(k);
      plate('Back to the hut', '#2d6f7a', 0, HL - 0.16, Math.PI);
    }
    // ---- west wall
    door(-1, W_HIDE, '#2f9e5c', 'The Island', (put) => { put(0.5, 0.5, 0, 1.75, gold); put(0.38, 0.38, 0, 1.75, basic('#2f9e5c'), 0.03); });
    door(-1, W_TRIAL, '#a8582c', 'Tile Floor', (put) => { put(0.5, 0.5, 0, 1.55, gold); put(0.38, 0.38, 0, 1.55, basic('#5a3a1e'), 0.03); for (const [dz, y] of [[-0.3, 1.9], [0.3, 1.9], [-0.3, 0.6], [0.3, 0.6]]) put(0.12, 0.12, dz, y, steel); });
    door(-1, W_CAMP, '#f2c94c', 'Banana or Salmon', (put) => { put(0.12, 0.5, -0.25, 1.75, basic('#ffe680')); put(0.42, 0.12, 0.22, 1.55, basic('#e88a7a')); put(0.08, 0.18, 0.46, 1.55, basic('#e88a7a')); });
    door(-1, W_LOC, '#34495e', 'Locations, Locations', (put) => { put(0.6, 0.45, 0, 1.7, basic('#16a085')); put(0.5, 0.35, 0, 1.7, basic('#9ff5e0'), 0.03); });
    door(-1, W_AIR, '#c8431b', 'The Airstrip', (put) => { put(1.1, 0.4, 0, 2.0, basic('#1d3a5c')); put(0.7, 0.08, 0, 2.0, basic('#f6e7bd'), 0.03); });
    for (const z of [BAYS[5], BAYS[6]]) door(-1, z, '#5d544a', 'Coming soon', (put) => { put(0.42, 0.42, 0, 1.6, basic('#3d3630')); put(0.1, 0.22, 0, 1.68, creamD, 0.03); put(0.08, 0.08, 0, 1.48, creamD, 0.03); });
    // ---- east wall
    door(1, E_CAT, '#7b4fb0', "You're a Cat!", (put) => { for (const [dz, y] of [[-0.18, 1.55], [0.0, 1.62], [0.18, 1.55], [-0.08, 1.38], [0.1, 1.38]]) put(0.09, 0.09, dz, y, gold); put(0.26, 0.2, 0, 1.2, gold); });
    door(1, E_DUNE, '#d9a35f', 'The Desert', (put) => {
      put(0.4, 0.4, 0.2, 1.8, basic('#ffd34d')); put(1.2, 0.3, -0.05, 0.75, basic('#b5702e')); put(0.8, 0.22, -0.05, 0.98, basic('#c27c37'));
      put(0.05, 0.5, -0.3, 1.4, basic('#6b4a2a'), 0.03); put(0.4, 0.06, -0.3, 1.66, basic('#2f8f3a'), 0.04);
    });
    {
      // Free Fall: a sky-blue door painted with clouds that really opens, onto the open sky
      const z = E_CLOUD, x = HW, W = 1.3, Hh = 2.3;
      box(0.02, Hh + 0.1, W + 0.2, x - 0.03, 1.15, z, basic('#cfe9ff'));                                          // behind the door: the sky
      for (const [dz, dy, s2] of [[-0.3, 0.5, 0.35], [0.2, 1.3, 0.3], [-0.1, 1.9, 0.28], [0.3, 0.3, 0.25]] as const) {
        const c = new THREE.Mesh(new THREE.SphereGeometry(s2, 10, 8), basic('#ffffff')); c.scale.set(0.3, 0.7, 1.6); c.position.set(x - 0.07, SKY_Y + dy, z + dz); c.frustumCulled = false; this.group.add(c);
      }
      this.cloudDoor.position.set(x - 0.1, SKY_Y, z + W / 2);                                                    // hinged on the entrance side
      const leafM = new THREE.Mesh(new THREE.BoxGeometry(0.06, Hh, W), basic('#7ec4f0')); leafM.position.set(0, Hh / 2, -W / 2); leafM.frustumCulled = false; this.cloudDoor.add(leafM);
      for (const [dz, dy, s2] of [[-0.2, 1.7, 1.4], [0.25, 0.9, 1.1], [-0.25, 0.35, 0.9]] as const) {
        for (const [oz, oy, r] of [[0, 0, 1], [0.7, -0.1, 0.8], [-0.7, -0.1, 0.8], [0.3, 0.35, 0.8], [-0.35, 0.3, 0.7]] as const) {
          const m = new THREE.Mesh(new THREE.SphereGeometry(0.2 * s2 * r, 10, 8), basic('#ffffff')); m.scale.set(0.28, 0.8, 1); m.position.set(-0.04, dy + oy * 0.2 * s2, -W / 2 + dz + oz * 0.22 * s2); m.frustumCulled = false; this.cloudDoor.add(m);
        }
      }
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), goldL); knob.position.set(-0.07, 1.1, -W + 0.12); knob.frustumCulled = false; this.cloudDoor.add(knob);
      this.group.add(this.cloudDoor);
      door(1, z, '#7ec4f0', 'Free Fall', undefined, false);
    }
    {
      // the mirror: a whole bay, in a gold frame
      const Wm = 2.6, Hh = 2.6, CY = 1.6, wx = HW - 0.06;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(Wm, Hh), new THREE.MeshBasicMaterial({ name: 'skyMirror' }));
      plane.rotation.y = -Math.PI / 2; plane.position.set(MIRROR_X, SKY_Y + CY, E_MIRROR); this.group.add(plane);
      const t = 0.14;
      const fr = (d: number, h: number, w: number, y: number, z: number) => box(d, h, w, wx - 0.05, y, z, gold);
      fr(0.1, t, Wm + 2 * t, CY + Hh / 2 + t / 2, E_MIRROR); fr(0.1, t, Wm + 2 * t, CY - Hh / 2 - t / 2, E_MIRROR);
      fr(0.1, Hh, t, CY, E_MIRROR + Wm / 2 + t / 2); fr(0.1, Hh, t, CY, E_MIRROR - Wm / 2 - t / 2);
    }
    for (const z of [BAYS[4], BAYS[5], BAYS[6]]) door(1, z, '#5d544a', 'Coming soon', (put) => { put(0.42, 0.42, 0, 1.6, basic('#3d3630')); put(0.1, 0.22, 0, 1.68, creamD, 0.03); put(0.08, 0.08, 0, 1.48, creamD, 0.03); });
    // ---- the far end: your photo in a big gold frame, lamps either side, and the song button on a stand before it
    {
      const tex = new THREE.TextureLoader().load(photoUrl); tex.colorSpace = THREE.SRGBColorSpace;
      const PH = 2.2, pz = -HL + 0.1, py = 2.05;
      box(PH + 0.44, PH + 0.44, 0.1, 0, py, pz, gold);
      box(PH + 0.24, PH + 0.24, 0.12, 0, py, pz + 0.01, walnutD);
      const pic = new THREE.Mesh(new THREE.PlaneGeometry(PH, PH), new THREE.MeshBasicMaterial({ map: tex }));
      pic.position.set(0, SKY_Y + py, pz + 0.08); pic.frustumCulled = false; this.group.add(pic);
      for (const x of [-1.85, 1.85]) { box(0.14, 1.0, 0.14, x, 0.5, -HL + 0.5, walnutD); box(0.4, 0.34, 0.4, x, 1.15, -HL + 0.5, glowW); box(0.46, 0.04, 0.46, x, 1.34, -HL + 0.5, goldL); }
      box(0.34, 0.95, 0.34, 0, 0.475, SONG_Z, walnutD);
      box(0.42, 0.05, 0.42, 0, 0.975, SONG_Z, gold);
      const red = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.06, 20), basic('#d23a2a'));
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.03, 20), gold);
      red.position.y = 0.035; rim.position.y = 0.0; red.frustumCulled = rim.frustumCulled = false;
      this.songCap.add(rim, red); this.songCap.position.set(0, SKY_Y + 1.0, SONG_Z); this.group.add(this.songCap);
    }
    void trim; void greenD;
    this.group.visible = false;
    this.group.userData.babylonTag = { skyroom: true };
    this.group.position.set(0, 0, 0);
    scene.add(this.group);
  }

  // the player's "ground" while inside (same shape as the caves')
  floor(x: number, z: number, _y: number) { return Math.abs(x) < HW && Math.abs(z) < HL ? SKY_Y : SKY_Y - 400; }
  resolve(x: number, z: number, r: number, _feetY: number, out: { x: number; z: number }) {
    const mx = HW - EDGE - r * 0.4, mz = HL - EDGE - r * 0.4;
    out.x = Math.max(-mx, Math.min(mx, x)); out.z = Math.max(-mz, Math.min(mz, z));
  }

  /** looking at a point (x, z) on the walls at door height, within reach? */
  private pickAt(x: number, z: number, y: number, r: number, eye: V3, dir: V3, reach: number, assist: number): number | null {
    if (!this.active) return null;
    const dx = x - eye.x, dy = SKY_Y + y - eye.y, dz = z - eye.z;
    const t = dx * dir.x + dy * dir.y + dz * dir.z;
    if (t < 0 || t > reach + 1) return null;
    const px = dx - dir.x * t, py = dy - dir.y * t, pz = dz - dir.z * t, rr = r * assist;
    return px * px + py * py + pz * pz <= rr * rr ? t : null;
  }
  /** looking at the door back to the hut? */
  pick(eye: V3, dir: V3, reach: number, assist = 1) { return this.pickAt(0, HL, 1.1, 1.1, eye, dir, reach, assist); }
  /** the other doors */
  pickAir(eye: V3, dir: V3, reach: number, assist = 1) { return this.pickAt(-HW, W_AIR, 1.1, 1.0, eye, dir, reach, assist); }
  pickCat(eye: V3, dir: V3, reach: number, assist = 1) { return this.pickAt(HW, E_CAT, 1.1, 1.0, eye, dir, reach, assist); }
  pickHide(eye: V3, dir: V3, reach: number, assist = 1) { return this.pickAt(-HW, W_HIDE, 1.1, 1.0, eye, dir, reach, assist); }
  pickTrial(eye: V3, dir: V3, reach: number, assist = 1) { return this.pickAt(-HW, W_TRIAL, 1.1, 1.0, eye, dir, reach, assist); }
  pickCamp(eye: V3, dir: V3, reach: number, assist = 1) { return this.pickAt(-HW, W_CAMP, 1.1, 1.0, eye, dir, reach, assist); }
  pickLoc(eye: V3, dir: V3, reach: number, assist = 1) { return this.pickAt(-HW, W_LOC, 1.1, 1.0, eye, dir, reach, assist); }
  pickDesert(eye: V3, dir: V3, reach: number, assist = 1) { return this.pickAt(HW, E_DUNE, 1.1, 1.0, eye, dir, reach, assist); }
  pickCloud(eye: V3, dir: V3, reach: number, assist = 1) { return this.cloudT >= 0 ? null : this.pickAt(HW, E_CLOUD, 1.1, 1.0, eye, dir, reach, assist); }
  /** the song button under the photo */
  pickSong(eye: V3, dir: V3, reach: number, assist = 1) { return this.pickAt(0, SONG_Z, 1.03, 0.35, eye, dir, reach, assist); }

  /** is the song playing now */
  get songOn() { return this.want > 0 && !this.ended; }
  /** press the button: the song plays once from the start (pressed while it plays, it stops) */
  pressSong() {
    this.capT = 0.25;
    if (this.songOn) this.play(false);
    else this.play(true, true);
  }
  private closeCloud() { this.cloudT = -1; this.cloudDoor.rotation.y = 0; }
  /** (back) from one of the other places: arrive in front of the door you left by, facing into the hall */
  enter(p: { teleport(x: number, y: number, z: number, yaw: number): void; cave: any }, from: 'hut' | 'air' | 'cat' | 'hide' | 'trial' | 'camp' | 'loc' | 'desert' = 'hut') {
    this.active = true; this.group.visible = true; this.closeCloud();
    p.cave = this;
    const W = (z: number) => p.teleport(-HW + 1.4, SKY_Y, z, -Math.PI / 2), E = (z: number) => p.teleport(HW - 1.4, SKY_Y, z, Math.PI / 2);
    if (from === 'desert') E(E_DUNE); else if (from === 'cat') E(E_CAT);
    else if (from === 'air') W(W_AIR); else if (from === 'camp') W(W_CAMP); else if (from === 'loc') W(W_LOC); else if (from === 'hide') W(W_HIDE); else if (from === 'trial') W(W_TRIAL);
    else p.teleport(0, SKY_Y, HL - 1.5, 0);
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
  /** the song (at 40% of its old volume), once, when the button is pressed; it fades out when you leave the room */
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
      this.cloudDoor.rotation.y = Math.min(1, this.cloudT / 1.1) * 1.75;                   // swings into the hall
      if (this.cloudT > 2.2) { this.cloudT = -1; this.onJump?.(); }
    }
    this.fadeSong(dt);
    if (this.capT > 0) this.capT = Math.max(0, this.capT - dt);
    this.songCap.position.y = SKY_Y + 1.0 - (this.capT > 0 ? 0.03 : 0);
    if (this.skydiving()) return;
    if (this.active && (Math.abs(p.pos.x) > HW + 1 || Math.abs(p.pos.z) > HL + 1 || p.pos.y < SKY_Y - 60)) {
      this.active = false; this.group.visible = false; p.cave = null; this.play(false);
      const to = this.exitTo; if (to) p.teleport(to.x, to.y, to.z, to.yaw); else p.teleport(p.pos.x, groundY(p.pos.x, p.pos.z), p.pos.z, p.yaw);
    } else if (!this.active && p.pos.y > 150) {
      const to = this.exitTo; if (to) p.teleport(to.x, to.y, to.z, to.yaw); else p.teleport(p.pos.x, groundY(p.pos.x, p.pos.z), p.pos.z, p.yaw);
    }
  }
}
