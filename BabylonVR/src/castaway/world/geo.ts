// Tiny procedural-geometry toolkit for foliage (non-indexed, per-vertex colour + wind weights).
import * as THREE from 'three';

/** `uv`: where on a texture (leaf cards); geometry with any of these gets a uv attribute, the rest at LEAF_SOLID */
export interface Vtx { p: THREE.Vector3; n?: THREE.Vector3; c: THREE.Color; s: number; f: number; uv?: [number, number] }
/** a solid, opaque spot on the leaf texture: for the parts of a textured plant that are not leaf cards */
export const LEAF_SOLID: [number, number] = [0.985, 0.985];

export class GeoBuilder {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  sway: number[] = [];
  flut: number[] = [];
  uvs: number[] = [];
  private hasUv = false;
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();
  private fn = new THREE.Vector3();

  tri(v0: Vtx, v1: Vtx, v2: Vtx) {
    if (!v0.n || !v1.n || !v2.n) {
      this.a.subVectors(v1.p, v0.p);
      this.b.subVectors(v2.p, v0.p);
      this.fn.crossVectors(this.a, this.b).normalize();
    }
    for (const v of [v0, v1, v2]) {
      const n = v.n ?? this.fn;
      this.pos.push(v.p.x, v.p.y, v.p.z);
      this.nor.push(n.x, n.y, n.z);
      this.col.push(v.c.r, v.c.g, v.c.b);
      this.sway.push(v.s);
      this.flut.push(v.f);
      const uv = v.uv ?? LEAF_SOLID;
      if (v.uv) this.hasUv = true;
      this.uvs.push(uv[0], uv[1]);
    }
  }

  quad(v0: Vtx, v1: Vtx, v2: Vtx, v3: Vtx) {
    this.tri(v0, v1, v2);
    this.tri(v0, v2, v3);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('sway', new THREE.Float32BufferAttribute(this.sway, 1));
    g.setAttribute('flutter', new THREE.Float32BufferAttribute(this.flut, 1));
    if (this.hasUv) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Linear-space colour from sRGB hex. */
export const hex = (h: string) => new THREE.Color(h);

export function hash3(x: number, y: number, z: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

const ICO = new THREE.IcosahedronGeometry(1, 1);
const ICO0 = new THREE.IcosahedronGeometry(1, 0);

/** A lumpy sphere used for canopies, bushes, coconuts and flowers. Smooth, sky-biased normals. */
export function addBlob(
  b: GeoBuilder, center: THREE.Vector3, radius: number, dark: THREE.Color, light: THREE.Color,
  opts: { lump?: number; upBias?: number; sway?: number; flutter?: number; squash?: number; seed?: number; coarse?: boolean } = {},
) {
  const { lump = 0.18, upBias = 0.35, sway = 0, flutter = 0, squash = 1, seed = 0 } = opts;
  const p = (opts.coarse ? ICO0 : ICO).attributes.position as THREE.BufferAttribute;
  const mk = (i: number): Vtx => {
    const ux = p.getX(i), uy = p.getY(i), uz = p.getZ(i);
    const l = Math.hypot(ux, uy, uz);
    const nx = ux / l, ny = uy / l, nz = uz / l;
    const r = radius * (1 + lump * hash3(nx * 3 + seed, ny * 3, nz * 3 + seed));
    const pt = new THREE.Vector3(center.x + nx * r, center.y + ny * r * squash, center.z + nz * r);
    const n = new THREE.Vector3(nx, ny + upBias, nz).normalize();
    const c = dark.clone().lerp(light, ny * 0.5 + 0.5);
    return { p: pt, n, c, s: sway, f: flutter };
  };
  for (let i = 0; i < p.count; i += 3) b.tri(mk(i), mk(i + 1), mk(i + 2));
}

export interface TrunkOpts {
  H: number; r0: number; r1: number; lean: number; leanAng: number;
  rings: number; radial: number; c0: THREE.Color; c1: THREE.Color;
  bulge?: number; swayAmp?: number; band?: number;
}

/** Tapered, leaning trunk. Returns the top position. */
export function addTrunk(b: GeoBuilder, o: TrunkOpts): { top: THREE.Vector3; dirTop: THREE.Vector3 } {
  const { H, r0, r1, lean, leanAng, rings, radial, c0, c1, bulge = 0.1, swayAmp = 0.6, band = 0.35 } = o;
  const cl = (t: number) => new THREE.Vector3(
    lean * Math.cos(leanAng) * t * t, H * t, lean * Math.sin(leanAng) * t * t,
  );
  const ring: Vtx[][] = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const c = cl(t);
    const r = r0 + (r1 - r0) * t + bulge * Math.pow(1 - t, 6);
    const y = c.y;
    const bandF = 0.86 + 0.14 * Math.sin(y * (Math.PI * 2 / band));
    const col = c0.clone().lerp(c1, t).multiplyScalar(bandF);
    const row: Vtx[] = [];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const nx = Math.cos(a), nz = Math.sin(a);
      row.push({
        p: new THREE.Vector3(c.x + nx * r, c.y, c.z + nz * r),
        n: new THREE.Vector3(nx, 0.15, nz).normalize(),
        c: col, s: t * t * swayAmp, f: 0,
      });
    }
    ring.push(row);
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < radial; j++) {
      b.quad(ring[i][j], ring[i + 1][j], ring[i + 1][j + 1], ring[i][j + 1]);
    }
  }
  const top = cl(1);
  const dirTop = cl(1).sub(cl(0.92)).normalize();
  return { top, dirTop };
}
