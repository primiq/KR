// Shared building blocks for the Banana or Salmon areas: a box-based "cave-style" ground (floor / resolve / ceiling / climbAt)
// that knows how tall the local body is (a cat slips under a shelf a gorilla bumps into), baked unlit meshes (indoors looks the
// same day or night), canvas signs, and a ray test. Boxes are in the area's local coordinates; the area sits at (ox, oy, oz).
import * as THREE from 'three';
import { Mesher } from '../net/playerModel';

export interface SBox { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; off?: boolean; tag?: string; soft?: boolean }
export interface Climb { x0: number; x1: number; z0: number; z1: number; y0: number; top: number; /** who may use it right now */ ok: () => boolean;
  /** where you are hauled onto at the top (local), when that is not the middle of the climb (a rope beside a ledge) */
  land?: { x: number; z: number } }

export class Space {
  readonly boxes: SBox[] = [];
  readonly climbs: Climb[] = [];
  /** solids that move (crates at rest, a pallet, a falling shelf) */
  dyn: () => SBox[] = () => [];
  /** the local body (set by the campaign every frame) */
  bodyH = 1.75;
  /** fall out of the bottom: the floor is this far below the base outside every floor rect (0 = solid floor everywhere) */
  readonly pits: { x0: number; x1: number; z0: number; z1: number }[] = [];
  constructor(readonly ox: number, readonly oy: number, readonly oz: number, readonly half: number) {}

  add(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, tag?: string): SBox {
    const b: SBox = { x0: Math.min(x0, x1), x1: Math.max(x0, x1), y0, y1, z0: Math.min(z0, z1), z1: Math.max(z0, z1), tag };
    this.boxes.push(b); return b;
  }
  contains(x: number, z: number) { return Math.abs(x - this.ox) < this.half && Math.abs(z - this.oz) < this.half; }

  private *all(): Iterable<SBox> { for (const b of this.boxes) if (!b.off) yield b; for (const b of this.dyn()) if (!b.off) yield b; }

  /** local floor height under (lx, lz) for something whose feet are at ly */
  floorL(lx: number, lz: number, ly: number) {
    let g = 0;
    for (const p of this.pits) if (lx > p.x0 && lx < p.x1 && lz > p.z0 && lz < p.z1) { g = -60; break; }
    for (const b of this.all()) if (!b.soft && b.y1 > g && b.y1 <= ly + 0.25 && lx >= b.x0 && lx <= b.x1 && lz >= b.z0 && lz <= b.z1) g = b.y1;
    return g;
  }
  floor(x: number, z: number, y: number) { return this.oy + this.floorL(x - this.ox, z - this.oz, y - this.oy); }
  ceiling(x: number, z: number, y: number) {
    const lx = x - this.ox, lz = z - this.oz, ly = y - this.oy;
    let c = 60;
    for (const b of this.all()) if (!b.soft && b.y0 > ly + 0.02 && b.y0 < c && lx >= b.x0 - 0.04 && lx <= b.x1 + 0.04 && lz >= b.z0 - 0.04 && lz <= b.z1 + 0.04) c = b.y0;
    return this.oy + c;
  }
  climbAt(x: number, z: number, y: number) {
    const lx = x - this.ox, lz = z - this.oz, ly = y - this.oy;
    for (const c of this.climbs) if (lx >= c.x0 && lx <= c.x1 && lz >= c.z0 && lz <= c.z1 && ly >= c.y0 - 0.05 && ly <= c.top + 0.1 && c.ok()) return { top: this.oy + c.top, cx: this.ox + (c.land ? c.land.x : (c.x0 + c.x1) / 2), cz: this.oz + (c.land ? c.land.z : (c.z0 + c.z1) / 2),
      // a rope: you hang at its middle while you climb (clear of any ledge overhead)
      hx: c.land ? this.ox + (c.x0 + c.x1) / 2 : undefined, hz: c.land ? this.oz + (c.z0 + c.z1) / 2 : undefined };
    return null;
  }
  /** push a circle (radius r, feet at ly, h tall) out of the solids; returns whether anything was hit (normal in out.nx/nz) */
  push(lx: number, lz: number, r: number, ly: number, h: number, out: { x: number; z: number; nx: number; nz: number }, skip?: SBox): boolean {
    let hit = false; out.nx = out.nz = 0;
    for (let pass = 0; pass < 2; pass++) for (const b of this.all()) {
      if (b === skip || b.soft || !(ly < b.y1 - 0.16 && ly + h > b.y0 + 0.02)) continue;
      const cx = Math.max(b.x0, Math.min(lx, b.x1)), cz = Math.max(b.z0, Math.min(lz, b.z1));
      const dx = lx - cx, dz = lz - cz, d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) { const d = Math.sqrt(d2); lx = cx + (dx / d) * r; lz = cz + (dz / d) * r; out.nx += dx / d; out.nz += dz / d; }
      else {
        const l = lx - b.x0, rr = b.x1 - lx, t = lz - b.z0, bt = b.z1 - lz, m = Math.min(l, rr, t, bt);
        if (m === l) { lx = b.x0 - r; out.nx -= 1; } else if (m === rr) { lx = b.x1 + r; out.nx += 1; } else if (m === t) { lz = b.z0 - r; out.nz -= 1; } else { lz = b.z1 + r; out.nz += 1; }
      }
      hit = true;
    }
    out.x = lx; out.z = lz;
    return hit;
  }
  private _o = { x: 0, z: 0, nx: 0, nz: 0 };
  resolve(x: number, z: number, r: number, feetY: number, out: { x: number; z: number }) {
    this.push(x - this.ox, z - this.oz, r, feetY - this.oy, this.bodyH, this._o);
    out.x = this._o.x + this.ox; out.z = this._o.z + this.oz;
  }
  /** is the segment between two local points (eye to target) blocked by a solid taller than `minH`? (line of sight) */
  blocked(ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.3);
    for (let k = 1; k < n; k++) {
      const t = k / n, x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t;
      for (const b of this.all()) if (!b.soft && x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1 && y > b.y0 && y < b.y1) return true;
    }
    return false;
  }
}

const L = new THREE.Vector3(0.35, 0.85, 0.4).normalize();
/** paint a little directional shading into the vertex colours and draw unlit: an indoor room looks the same day or night */
export function bake(M: Mesher, bright = 1): THREE.Mesh {
  const m = M.build(false), g = m.geometry, n = g.attributes.normal, c = g.attributes.color as THREE.BufferAttribute;
  for (let i = 0; i < c.count; i++) {
    const d = n.getX(i) * L.x + n.getY(i) * L.y + n.getZ(i) * L.z, k = (0.6 + 0.4 * (0.5 + 0.5 * d)) * bright;
    c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
  }
  m.material = new THREE.MeshBasicMaterial({ vertexColors: true });
  m.frustumCulled = false;
  return m;
}

/** a canvas you can redraw, on a plane (signs, the TV, the scoreboard, the shopping list) */
export class Board {
  readonly mesh: THREE.Mesh;
  readonly cv = document.createElement('canvas');
  readonly g: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private key = '';
  constructor(w: number, h: number, px = 512, double = false, transparent = false) {
    this.cv.width = px; this.cv.height = Math.round(px * (h / w));
    this.g = this.cv.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.cv); this.tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: this.tex, side: double ? THREE.DoubleSide : THREE.FrontSide, transparent, depthWrite: !transparent });
    mat.toneMapped = false;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    this.mesh.frustumCulled = false;
  }
  get W() { return this.cv.width; } get H() { return this.cv.height; }
  /** redraw only when the key changed */
  draw(key: string, fn: (g: CanvasRenderingContext2D, W: number, H: number) => void) {
    if (key === this.key) return;
    this.key = key; fn(this.g, this.W, this.H); this.tex.needsUpdate = true;
  }
}

/** a simple sign: lines of text on a coloured board */
export function sign(lines: string[], w: number, h: number, bg: string, fg: string, border = fg) {
  const b = new Board(w, h, 512);
  b.draw('x', (g, W, H) => {
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.strokeStyle = border; g.lineWidth = Math.max(4, H * 0.05); g.strokeRect(g.lineWidth / 2 + 4, g.lineWidth / 2 + 4, W - g.lineWidth - 8, H - g.lineWidth - 8);
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    const lh = H / (lines.length + 0.4);
    lines.forEach((t, i) => {
      let fs = Math.round(lh * (i === 0 ? 0.62 : 0.5)); g.font = `800 ${fs}px system-ui, sans-serif`;
      while (g.measureText(t).width > W * 0.88 && fs > 10) { fs -= 2; g.font = `800 ${fs}px system-ui, sans-serif`; }
      g.fillText(t, W / 2, lh * (i + 0.7));
    });
  });
  return b.mesh;
}

/** distance along a ray to a sphere (null: missed) */
export function rayHit(eye: THREE.Vector3, dir: THREE.Vector3, cx: number, cy: number, cz: number, rad: number, reach: number, assist = 1): number | null {
  const dx = cx - eye.x, dy = cy - eye.y, dz = cz - eye.z, t = dx * dir.x + dy * dir.y + dz * dir.z;
  if (t < 0 || t > reach) return null;
  const px = dx - dir.x * t, py = dy - dir.y * t, pz = dz - dir.z * t, r = rad * assist;
  return px * px + py * py + pz * pz <= r * r ? t : null;
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
