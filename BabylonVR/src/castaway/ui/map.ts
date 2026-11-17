import { heightAt } from '../world/island';
import { featuresNear, SEA_END, SEA_START, type SeaFeature } from '../world/seafeatures';
import { BERG_R0, GATE, ICE_R0, iceNear, landShore, OUTER, wallR } from '../world/arctic';
import { getPref, setPref } from '../core/prefs';

const R = 335;          // the map covers [-R, R] metres on both axes (north = -Z, east = +X)
const RES = 336;        // terrain texture size (2 m per pixel)
const CELL = 12;        // metres per "seen" cell
const NC = Math.ceil((2 * R) / CELL);
const REVEAL = 62;      // how far around you the map is uncovered
/** how far out the map zooms (the whole sea to its edge), and where the island map becomes a sea chart */
const ZMIN = (2 * R) / (2.1 * OUTER);
export const MAP_ZMIN = ZMIN;
const CHART = 0.75;

export interface MapMarkers {
  bed: { x: number; z: number } | null;
  death: { x: number; z: number } | null;
  springs: { x: number; z: number }[];
  camps: { x: number; z: number; kind: string }[];
  /** other players (multiplayer) */
  friends?: { x: number; z: number; name: string; color: string }[];
  /** locations other players (or you) marked */
  pings?: { x: number; z: number; name: string; color: string; age: number }[];
}

const CARD = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const css = (v: string, fb: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || fb;

/** Compass strip + a fog-of-war map. The terrain image is drawn once in the background, in slices. */
export class MapView {
  private terrain = document.createElement('canvas');
  private fog = document.createElement('canvas');
  private tctx = this.terrain.getContext('2d')!;
  private fctx = this.fog.getContext('2d')!;
  private seen = new Uint8Array(NC * NC);
  private heights: Float32Array | null = null;
  private row = 0;
  private ready = false;
  private lastRevealX = 1e9; private lastRevealZ = 1e9;
  private root = document.getElementById('map')!;
  private canvas = document.getElementById('map-canvas') as HTMLCanvasElement;
  private ctx = this.canvas.getContext('2d')!;
  private compass = document.getElementById('compass-canvas') as HTMLCanvasElement;
  private cctx = this.compass.getContext('2d')!;
  open = false;
  /** VR draws the map into its own menu: build the terrain fast while that is showing */
  boost = false;
  private zoom = 1;
  private cx = 0; private cz = 0; private follow = true;
  private drag: { x: number; y: number; cx: number; cz: number } | null = null;
  private last = { x: 0, z: 0, yaw: 0 };
  private markers: MapMarkers = { bed: null, death: null, springs: [], camps: [] };
  private compassKey = '';
  /** the compass ticks and letters for a full turn (plus overlap), drawn once and slid along: see drawCompass */
  private strip: HTMLCanvasElement | null = null;
  onClose: (() => void) | null = null;

  constructor() {
    this.terrain.width = this.terrain.height = RES;
    this.fog.width = this.fog.height = RES;
    this.fctx.fillStyle = 'rgba(14, 26, 30, 0.96)';
    this.fctx.fillRect(0, 0, RES, RES);
    this.heights = new Float32Array(RES * RES);

    const q = (id: string) => document.getElementById(id)!;
    q('map-close').addEventListener('click', () => this.onClose?.());
    q('map-zoom-in').addEventListener('click', () => this.setZoom(this.zoom * 1.6));
    q('map-zoom-out').addEventListener('click', () => this.setZoom(this.zoom / 1.6));
    q('map-center').addEventListener('click', () => { this.follow = true; this.draw(); });
    q('map-world')?.addEventListener('click', () => { this.follow = false; this.cx = 0; this.cz = 0; this.zoom = ZMIN; this.draw(); });
    this.root.addEventListener('click', (e) => { if (e.target === this.root) this.onClose?.(); });
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => { c.setPointerCapture(e.pointerId); this.drag = { x: e.clientX, y: e.clientY, cx: this.cx, cz: this.cz }; });
    c.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const k = (2 * R) / (this.canvas.width / (window.devicePixelRatio || 1)) / this.zoom;
      this.cx = this.drag.cx - (e.clientX - this.drag.x) * k; this.cz = this.drag.cz - (e.clientY - this.drag.y) * k;
      this.follow = false; this.draw();
    });
    const end = () => { this.drag = null; };
    c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
    c.addEventListener('wheel', (e) => { e.preventDefault(); this.setZoom(this.zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2)); }, { passive: false });
    window.addEventListener('resize', () => { if (this.open) this.draw(); });
  }

  private setZoom(z: number) { this.zoom = Math.max(ZMIN, Math.min(6, z)); this.draw(); }
  /** the sea's islets and wrecks (worked out once: the same for everybody), and whether the Ice Gate has been seen */
  private sea: SeaFeature[] | null = null;
  private gateSeen = getPref('castaway.gateSeen') === '1';

  /** Draw a few rows of terrain per call so the first frames stay smooth. */
  private buildSome(rows: number) {
    const H = this.heights!;
    const end = Math.min(RES, this.row + rows);
    for (let j = this.row; j < end; j++) {
      const z = -R + (j + 0.5) * (2 * R / RES);
      for (let i = 0; i < RES; i++) H[j * RES + i] = heightAt(-R + (i + 0.5) * (2 * R / RES), z);
    }
    this.row = end;
    if (this.row < RES) return;
    // shade + colour once all heights are known
    const img = this.tctx.createImageData(RES, RES);
    const d = img.data;
    const lerp = (a: number[], b: number[], t: number) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    for (let j = 0; j < RES; j++) {
      for (let i = 0; i < RES; i++) {
        const h = H[j * RES + i];
        const hx = H[j * RES + Math.min(RES - 1, i + 1)] - H[j * RES + Math.max(0, i - 1)];
        const hz = H[Math.min(RES - 1, j + 1) * RES + i] - H[Math.max(0, j - 1) * RES + i];
        const shade = Math.max(0.65, Math.min(1.25, 1 + (-hx * 0.7 - hz * 0.7) * 0.07));
        let c: number[];
        if (h < -9) c = [14, 66, 98];
        else if (h < -1.2) c = lerp([14, 66, 98], [38, 150, 170], (h + 9) / 7.8);
        else if (h < 0) c = lerp([38, 150, 170], [130, 224, 214], (h + 1.2) / 1.2);
        else if (h < 0.35) c = [248, 244, 226];                                          // foam / wet sand edge
        else if (h < 2.3) c = lerp([236, 212, 158], [214, 196, 134], h / 2.3);
        else if (h < 14) c = lerp([142, 186, 88], [96, 152, 64], (h - 2.3) / 11.7);
        else if (h < 30) c = lerp([84, 138, 58], [140, 134, 104], (h - 14) / 16);
        else c = [160, 156, 134];
        const sh = h < 0 ? 1 : shade;
        const o = (j * RES + i) * 4;
        d[o] = Math.min(255, c[0] * sh); d[o + 1] = Math.min(255, c[1] * sh); d[o + 2] = Math.min(255, c[2] * sh); d[o + 3] = 255;
      }
    }
    this.tctx.putImageData(img, 0, 0);
    this.ready = true;
    this.heights = null;
  }

  private reveal(x: number, z: number) {
    const k = RES / (2 * R);
    const px = (x + R) * k, py = (z + R) * k, rr = REVEAL * k;
    const g = this.fctx.createRadialGradient(px, py, rr * 0.55, px, py, rr);
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    this.fctx.globalCompositeOperation = 'destination-out';
    this.fctx.fillStyle = g;
    this.fctx.beginPath(); this.fctx.arc(px, py, rr, 0, Math.PI * 2); this.fctx.fill();
    this.fctx.globalCompositeOperation = 'source-over';
    const c0 = Math.floor((x - REVEAL + R) / CELL), c1 = Math.floor((x + REVEAL + R) / CELL);
    const r0 = Math.floor((z - REVEAL + R) / CELL), r1 = Math.floor((z + REVEAL + R) / CELL);
    for (let j = r0; j <= r1; j++) for (let i = c0; i <= c1; i++) {
      if (i < 0 || j < 0 || i >= NC || j >= NC) continue;
      if (Math.hypot((i + 0.5) * CELL - R - x, (j + 0.5) * CELL - R - z) < REVEAL * 0.8) this.seen[j * NC + i] = 1;
    }
  }

  isSeen(x: number, z: number) {
    const i = Math.floor((x + R) / CELL), j = Math.floor((z + R) / CELL);
    return i >= 0 && j >= 0 && i < NC && j < NC && this.seen[j * NC + i] === 1;
  }

  setOpen(o: boolean) {
    this.open = o;
    this.root.classList.toggle('hidden', !o);
    // (out at sea, off the island map: a chart a few kilometres across round you)
    if (o) { this.follow = true; this.zoom = Math.hypot(this.last.x, this.last.z) > R ? (2 * R) / 3200 : 1.6; this.size(); this.draw(); }
  }

  private size() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const box = this.canvas.parentElement!.getBoundingClientRect();
    const s = Math.max(240, Math.min(box.width - 4, window.innerHeight - 190, 760));
    this.canvas.style.width = this.canvas.style.height = `${s}px`;
    this.canvas.width = this.canvas.height = Math.round(s * dpr);
  }

  /** Per frame. */
  update(x: number, z: number, yaw: number, markers: MapMarkers) {
    if (!this.ready) {
      // a few milliseconds of terrain per frame (more while the map is showing), however fast or slow the device is
      const t0 = performance.now(), budget = this.open || this.boost ? 12 : 3;
      do this.buildSome(4); while (!this.ready && performance.now() - t0 < budget);
      if (this.ready && this.open) this.draw();
    }
    this.last.x = x; this.last.z = z; this.last.yaw = yaw;
    if (!this.gateSeen && Math.hypot(x - GATE.x, z - GATE.z) < 1500) { this.gateSeen = true; setPref('castaway.gateSeen', '1'); }
    this.markers = markers;
    if (Math.hypot(x - this.lastRevealX, z - this.lastRevealZ) > 5) {
      this.reveal(x, z); this.lastRevealX = x; this.lastRevealZ = z;
      if (this.open) this.draw();
    }
    this.drawCompass();
    if (this.open && this.follow) { this.cx = x; this.cz = z; this.draw(); }
  }

  // ------------------------------------------------------------ the compass strip
  private drawCompass() {
    const { x, z, yaw } = this.last;
    const bearing = ((-yaw * 180 / Math.PI) % 360 + 360) % 360;
    const m = this.markers;
    const key = `${bearing.toFixed(1)}|${m.bed ? 1 : 0}${m.death ? 1 : 0}${m.springs.length}|${Math.round(x / 4)},${Math.round(z / 4)}|${(m.friends ?? []).map((f) => `${Math.round(f.x / 3)},${Math.round(f.z / 3)}`).join(';')}|${(m.pings ?? []).map((f) => `${Math.round(f.x)},${Math.round(f.z)}`).join(';')}`;
    if (key === this.compassKey) return;
    this.compassKey = key;
    const c = this.cctx, W = this.compass.width, Hh = this.compass.height;
    c.clearRect(0, 0, W, Hh);
    const span = 150; // degrees visible
    const px = (b: number) => { let d = b - bearing; d = ((d + 540) % 360) - 180; return W / 2 + (d / span) * W; };
    const grad = c.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0)'); grad.addColorStop(0.2, 'rgba(255,255,255,1)'); grad.addColorStop(0.8, 'rgba(255,255,255,1)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    c.save();
    c.fillStyle = 'rgba(0,0,0,.4)'; c.fillRect(0, 0, W, Hh * 0.74);
    c.globalCompositeOperation = 'source-over';
    // the ticks and letters never change, only slide: they are drawn once into a strip covering bearings -180..540 (so any
    // window of the visible 150 degrees is one piece) and copied across each time (re-drawing text every frame while turning
    // was most of the HUD's cost)
    const k = W / span, SW = Math.ceil(720 * k);
    if (!this.strip || this.strip.width !== SW || this.strip.height !== Hh) {
      const st = this.strip ?? document.createElement('canvas');
      st.width = SW; st.height = Hh;
      const s = st.getContext('2d')!;
      s.clearRect(0, 0, SW, Hh);
      s.font = `700 ${Hh * 0.34}px system-ui, sans-serif`; s.textAlign = 'center'; s.textBaseline = 'middle';
      for (let b = -180; b <= 540; b += 5) {
        const X = (b + 180) * k, bb = ((b % 360) + 360) % 360;
        const major = bb % 45 === 0, mid = bb % 15 === 0;
        if (major) {
          s.fillStyle = bb === 0 ? '#ff6b5e' : '#ffffff';
          s.fillText(CARD[bb / 45], X, Hh * 0.37);
        } else {
          s.fillStyle = 'rgba(255,255,255,.75)';
          s.fillRect(X - 1, Hh * (mid ? 0.2 : 0.3), 2, Hh * (mid ? 0.3 : 0.14));
        }
      }
      this.strip = st;
    }
    // bearing b is drawn at W/2 + (b - bearing) * k on screen and at (b + 180) * k in the strip
    const sx = (bearing + 180) * k - W / 2;
    c.drawImage(this.strip, sx, 0, W, Hh, 0, 0, W, Hh);
    // markers: a bearing to each, drawn under the strip
    const mark = (tx: number, tz: number, col: string, shape: 'tri' | 'dot' | 'x') => {
      const b = ((Math.atan2(tx - x, -(tz - z)) * 180 / Math.PI) % 360 + 360) % 360;
      const X = px(b);
      if (X < 4 || X > W - 4) return;
      c.fillStyle = col; c.strokeStyle = col; c.lineWidth = 3;
      const y = Hh * 0.88;
      if (shape === 'tri') { c.beginPath(); c.moveTo(X, y - Hh * 0.13); c.lineTo(X - Hh * 0.12, y + Hh * 0.1); c.lineTo(X + Hh * 0.12, y + Hh * 0.1); c.closePath(); c.fill(); }
      else if (shape === 'dot') { c.beginPath(); c.arc(X, y, Hh * 0.1, 0, 7); c.fill(); }
      else { const s = Hh * 0.09; c.beginPath(); c.moveTo(X - s, y - s); c.lineTo(X + s, y + s); c.moveTo(X + s, y - s); c.lineTo(X - s, y + s); c.stroke(); }
    };
    for (const s of m.springs) if (this.isSeen(s.x, s.z)) mark(s.x, s.z, '#52d6ff', 'dot');
    if (m.bed) mark(m.bed.x, m.bed.z, '#ffd34d', 'tri');
    if (m.death) mark(m.death.x, m.death.z, '#ff5a5a', 'x');
    for (const f of m.friends ?? []) mark(f.x, f.z, f.color, 'dot');
    for (const f of m.pings ?? []) mark(f.x, f.z, f.color, 'tri');
    // heading pointer
    c.fillStyle = '#ffffff';
    c.beginPath(); c.moveTo(W / 2, Hh * 0.74); c.lineTo(W / 2 - Hh * 0.08, Hh * 0.74 + Hh * 0.12); c.lineTo(W / 2 + Hh * 0.08, Hh * 0.74 + Hh * 0.12); c.closePath(); c.fill();
    c.globalCompositeOperation = 'destination-in'; c.fillStyle = grad; c.fillRect(0, 0, W, Hh);
    c.restore();
  }

  // ------------------------------------------------------------ the map
  draw() {
    if (!this.open) return;
    this.render(this.ctx, this.canvas.width);
  }

  // ---- used by the VR menu, which draws the map into its own canvas
  get isReady() { return this.ready; }
  setView(cx: number, cz: number, zoom: number) { this.cx = cx; this.cz = cz; this.zoom = Math.max(ZMIN, Math.min(6, zoom)); }
  get zoomLevel() { return this.zoom; }
  /** map position (metres) under a point of the square map, u/v in 0..1 */
  toWorld(u: number, v: number) {
    const view = (2 * R) / this.zoom;
    return { x: this.cx - view / 2 + u * view, z: this.cz - view / 2 + v * view };
  }

  /** the sea chart: rings of sea round the island out to the end of the sea, drawn as the player would describe them */
  private chart(c: CanvasRenderingContext2D, S: number, X: (x: number) => number, Z: (z: number) => number, sc: number, u: number) {
    const fade = Math.min(1, (1 - this.zoom) / (1 - CHART));
    // deep sea, a little lighter where the islets' shallows are
    c.fillStyle = '#0d3a55'; c.fillRect(0, 0, S, S);
    const ring = (r0: number, r1: number, col: string) => { c.beginPath(); c.moveTo(X(0) + r1 * sc, Z(0)); c.arc(X(0), Z(0), r1 * sc, 0, Math.PI * 2); c.moveTo(X(0) + r0 * sc, Z(0)); c.arc(X(0), Z(0), r0 * sc, 0, Math.PI * 2); c.fillStyle = col; c.fill('evenodd'); };
    ring(SEA_START - 100, SEA_END + 100, 'rgba(60,170,190,.18)');
    ring(ICE_R0, BERG_R0, 'rgba(210,235,250,.10)');
    ring(BERG_R0, 9000, 'rgba(210,235,250,.18)');
    // the Arctic: from its coast in to the wall (snow), and past the wall (no one goes there)
    const path = (rad: (a: number) => number) => { for (let k = 0; k <= 180; k++) { const a = (k / 180) * Math.PI * 2, r = rad(a); if (k) c.lineTo(X(Math.cos(a) * r), Z(Math.sin(a) * r)); else c.moveTo(X(Math.cos(a) * r), Z(Math.sin(a) * r)); } };
    c.beginPath(); path(() => OUTER + 400); path(landShore); c.fillStyle = '#e8f1f7'; c.fill('evenodd');
    c.beginPath(); path(() => OUTER + 400); path(wallR); c.fillStyle = '#b9cad6'; c.fill('evenodd');
    c.beginPath(); path(wallR); c.strokeStyle = '#6fb3e0'; c.lineWidth = Math.max(2, 26 * sc); c.stroke();
    c.beginPath(); path(landShore); c.strokeStyle = 'rgba(255,255,255,.9)'; c.lineWidth = 1.5; c.stroke();
    // the islets and the wrecks
    this.sea ??= featuresNear(0, 0, SEA_END + 400);
    for (const f of this.sea) {
      const px = X(f.x), py = Z(f.z);
      if (px < -10 || py < -10 || px > S + 10 || py > S + 10) continue;
      if (f.kind === 'islet') { c.beginPath(); c.arc(px, py, Math.max(2.5 * u, f.r * sc), 0, 7); c.fillStyle = '#ecd59a'; c.fill(); c.fillStyle = '#5aa04a'; c.beginPath(); c.arc(px, py, Math.max(1.2 * u, f.r * sc * 0.5), 0, 7); c.fill(); }
      else { c.strokeStyle = '#8a5a30'; c.lineWidth = 2 * u; c.beginPath(); c.moveTo(px - 4 * u, py - 4 * u); c.lineTo(px + 4 * u, py + 4 * u); c.moveTo(px + 4 * u, py - 4 * u); c.lineTo(px - 4 * u, py + 4 * u); c.stroke(); }
    }
    // up close (a few kilometres across): the icebergs themselves
    const view = S / sc;
    if (view < 7000) {
      c.fillStyle = 'rgba(236,246,252,.95)';
      for (const f of iceNear(this.cx, this.cz, view * 0.75, [], false, true)) {
        const px = X(f.x), py = Z(f.z);
        if (px < -20 || py < -20 || px > S + 20 || py > S + 20) continue;
        // (the waterline: the profile's widest point above the sea)
        const wl = f.prof.find((p) => p[1] <= 0.6)?.[0] ?? f.reach * 0.5;
        c.beginPath(); c.arc(px, py, Math.max(1.5 * u, wl * sc), 0, Math.PI * 2); c.fill();
      }
    }
    // the Ice Gate, once you have seen it
    if (this.gateSeen) {
      const gx = X(GATE.x), gy = Z(GATE.z), s = 7 * u;
      c.fillStyle = '#1f5aa8'; c.strokeStyle = '#fff'; c.lineWidth = 2 * u;
      c.beginPath(); c.moveTo(gx - s, gy + s); c.lineTo(gx - s, gy - s * 0.2); c.arc(gx, gy - s * 0.2, s, Math.PI, 0); c.lineTo(gx + s, gy + s); c.closePath(); c.fill(); c.stroke();
    }
    // labels
    c.globalAlpha = fade;
    c.font = `700 ${13 * u}px system-ui`; c.textAlign = 'center'; c.textBaseline = 'middle';
    const label = (t: string, x: number, z: number, col = '#e6f4fa') => { c.lineWidth = 3 * u; c.strokeStyle = 'rgba(6,20,28,.8)'; c.strokeText(t, X(x), Z(z)); c.fillStyle = col; c.fillText(t, X(x), Z(z)); };
    label('The islets', 0, (SEA_START + SEA_END) / 2);
    label('Drift ice', 0, (ICE_R0 + BERG_R0) / 2);
    label('Icebergs', 0, BERG_R0 + 1400);
    label('The Arctic', 0, landShore(Math.PI / 2) + 325);
    label('Ice wall', -(wallR(Math.PI) + 700), 0);
    if (this.gateSeen) label("Ice Gate", GATE.x, GATE.z + 22 * u / sc);
    c.globalAlpha = 1;
  }

  /** Draw the map into any 2D context, S pixels square. */
  render(c: CanvasRenderingContext2D, S: number) {
    c.clearRect(0, 0, S, S);
    c.fillStyle = '#0c181c'; c.fillRect(0, 0, S, S);
    if (!this.ready) {
      c.fillStyle = '#9fb7bd'; c.font = `${S * 0.04}px system-ui`; c.textAlign = 'center';
      c.fillText('Drawing the map…', S / 2, S / 2);
      return;
    }
    const view = (2 * R) / this.zoom;                 // metres visible across
    const x0 = this.cx - view / 2, z0 = this.cz - view / 2;
    const sc = S / view;                              // px per metre
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
    const X = (x: number) => (x - x0) * sc, Z = (z: number) => (z - z0) * sc;
    const u = S / 560;
    // the sea chart round the island (zoomed out): the islets, the ice, the Arctic and its wall
    if (this.zoom < 1) this.chart(c, S, X, Z, sc, u);
    c.drawImage(this.terrain, X(-R), Z(-R), 2 * R * sc, 2 * R * sc);
    c.drawImage(this.fog, X(-R), Z(-R), 2 * R * sc, 2 * R * sc);

    // the grid: lines every 100 m, or 1 km, 5 km... as you zoom out
    const step = [100, 500, 1000, 2000, 5000].find((g) => g * sc >= 46) ?? 5000;
    c.strokeStyle = 'rgba(255,255,255,.12)'; c.lineWidth = 1;
    for (let g = Math.ceil((x0) / step) * step; g < x0 + view; g += step) { c.beginPath(); c.moveTo(X(g), 0); c.lineTo(X(g), S); c.stroke(); }
    for (let g = Math.ceil((z0) / step) * step; g < z0 + view; g += step) { c.beginPath(); c.moveTo(0, Z(g)); c.lineTo(S, Z(g)); c.stroke(); }

    const icon = (x: number, z: number, col: string, r: number, ring = '#102024') => {
      const px = X(x), py = Z(z);
      if (px < -20 || py < -20 || px > S + 20 || py > S + 20) return;
      c.beginPath(); c.arc(px, py, r + 2, 0, 7); c.fillStyle = ring; c.fill();
      c.beginPath(); c.arc(px, py, r, 0, 7); c.fillStyle = col; c.fill();
    };
    for (const s of this.markers.springs) if (this.isSeen(s.x, s.z)) icon(s.x, s.z, '#52d6ff', 6 * u);
    for (const cmp of this.markers.camps) icon(cmp.x, cmp.z, cmp.kind === 'bed' || cmp.kind === 'sleeping_bag' ? '#ffd34d' : cmp.kind === 'campfire' ? '#ff9a3a' : '#cfd5da', 4.5 * u);
    if (this.markers.bed) {
      const px = X(this.markers.bed.x), py = Z(this.markers.bed.z);
      c.fillStyle = '#ffd34d'; c.strokeStyle = '#102024'; c.lineWidth = 2 * u;
      c.beginPath(); c.moveTo(px, py - 9 * u); c.lineTo(px + 8 * u, py + 6 * u); c.lineTo(px - 8 * u, py + 6 * u); c.closePath(); c.fill(); c.stroke();
    }
    if (this.markers.death) {
      const px = X(this.markers.death.x), py = Z(this.markers.death.z), s = 7 * u;
      c.strokeStyle = '#102024'; c.lineWidth = 7 * u; c.beginPath(); c.moveTo(px - s, py - s); c.lineTo(px + s, py + s); c.moveTo(px + s, py - s); c.lineTo(px - s, py + s); c.stroke();
      c.strokeStyle = '#ff5a5a'; c.lineWidth = 3.5 * u; c.beginPath(); c.moveTo(px - s, py - s); c.lineTo(px + s, py + s); c.moveTo(px + s, py - s); c.lineTo(px - s, py + s); c.stroke();
    }
    for (const f of this.markers.friends ?? []) {
      icon(f.x, f.z, f.color, 6.5 * u);
      const fx = X(f.x), fy = Z(f.z);
      if (fx > 0 && fy > 0 && fx < S && fy < S) {
        c.font = `700 ${12 * u}px system-ui`; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
        c.lineWidth = 3 * u; c.strokeStyle = '#102024'; c.strokeText(f.name, fx, fy - 11 * u); c.fillStyle = '#fff'; c.fillText(f.name, fx, fy - 11 * u);
      }
    }
    for (const pg of this.markers.pings ?? []) {
      const fx = X(pg.x), fy = Z(pg.z), t = pg.age;
      const r = (10 + ((t * 18) % 26)) * u;
      c.strokeStyle = pg.color; c.lineWidth = 3 * u; c.globalAlpha = Math.max(0, 1 - (t * 18 % 26) / 26);
      c.beginPath(); c.arc(fx, fy, r, 0, 7); c.stroke(); c.globalAlpha = 1;
      icon(pg.x, pg.z, pg.color, 5 * u);
      c.font = `700 ${12 * u}px system-ui`; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
      c.lineWidth = 3 * u; c.strokeStyle = '#102024'; c.strokeText(pg.name, fx, fy - 16 * u); c.fillStyle = '#fff'; c.fillText(pg.name, fx, fy - 16 * u);
    }
    // you
    const px = X(this.last.x), py = Z(this.last.z), a = this.last.yaw;
    c.save(); c.translate(px, py); c.rotate(-a);
    c.fillStyle = '#ffffff'; c.strokeStyle = '#0e2a33'; c.lineWidth = 2.5 * u;
    c.beginPath(); c.moveTo(0, -11 * u); c.lineTo(8 * u, 9 * u); c.lineTo(0, 4 * u); c.lineTo(-8 * u, 9 * u); c.closePath(); c.fill(); c.stroke();
    c.restore();

    // north arrow + scale bar
    c.fillStyle = 'rgba(8,20,24,.7)'; c.beginPath(); c.arc(S - 30 * u, 30 * u, 20 * u, 0, 7); c.fill();
    c.fillStyle = '#ff6b5e'; c.font = `700 ${15 * u}px system-ui`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('N', S - 30 * u, 24 * u);
    c.beginPath(); c.moveTo(S - 30 * u, 33 * u); c.lineTo(S - 36 * u, 42 * u); c.lineTo(S - 24 * u, 42 * u); c.closePath(); c.fill();
    const bar = step * sc, label = step >= 1000 ? `${step / 1000} km` : `${step} m`;
    c.fillStyle = 'rgba(8,20,24,.7)'; c.fillRect(14 * u, S - 34 * u, bar + 64 * u, 24 * u);
    c.fillStyle = '#fff'; c.fillRect(22 * u, S - 24 * u, bar, 3 * u);
    c.fillRect(22 * u, S - 28 * u, 2 * u, 11 * u); c.fillRect(22 * u + bar - 2 * u, S - 28 * u, 2 * u, 11 * u);
    c.font = `600 ${12 * u}px system-ui`; c.textAlign = 'left'; c.fillText(label, 30 * u + bar, S - 21 * u);
    void css;
  }
}
