import * as THREE from 'three';
import { mulberry32 } from '../core/noise';
import { GeoBuilder, Vtx, addBlob, addTrunk, hex } from './geo';

/** Buttress roots flaring out of the base so trunks look planted instead of stuck in. */
function addRoots(b: GeoBuilder, rnd: () => number, n: number, spread: number, size: number, c0: THREE.Color, c1: THREE.Color, coarse = false) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.6;
    const d = spread * (0.9 + rnd() * 0.5);
    addBlob(b, new THREE.Vector3(Math.cos(a) * d, size * 0.2, Math.sin(a) * d), size * (0.8 + rnd() * 0.5), c0, c1,
      { lump: 0.2, upBias: 0.3, sway: 0, flutter: 0, squash: 0.55, seed: i * 5.1, coarse });
  }
}

/** Palm tree: leaning ringed trunk, ~11 drooping pinnate fronds with real leaflets, coconuts. */
/** `far`: the far-away version of the same palm (same random draws, so the same shape): a plainer trunk, coarse roots and
 *  nuts, a shorter rachis and three wide leaflets a side instead of `leaflets`, about a third of the triangles */
export function buildPalm(seed: number, leaflets: number, far = false): THREE.BufferGeometry {
  const rnd = mulberry32(seed);
  const b = new GeoBuilder();
  const H = 7.5 + rnd() * 4.5;
  const { top } = addTrunk(b, {
    H, r0: 0.3, r1: 0.14, lean: 0.8 + rnd() * 2.6, leanAng: rnd() * Math.PI * 2,
    rings: far ? 6 : 14, radial: far ? 5 : 7, c0: hex('#7d6a54'), c1: hex('#a08b72'), bulge: 0.14, swayAmp: 0.55, band: 0.36,
  });

  addRoots(b, rnd, 5, 0.26, 0.2, hex('#5f4d3a'), hex('#8d7a64'), far);

  const nFronds = 11 + Math.floor(rnd() * 3);
  const darkLeaf = hex('#2e6a1a'), lightLeaf = hex('#a9cc44');
  const golden = Math.PI * (3 - Math.sqrt(5));
  const sway0 = 0.55;

  for (let f = 0; f < nFronds; f++) {
    const a = f * golden + rnd() * 0.3;
    const dirH = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const side = new THREE.Vector3(-dirH.z, 0, dirH.x);
    const L = 3.3 + rnd() * 1.7;
    const pitch0 = 0.25 + rnd() * 0.75 + (f % 3 === 0 ? 0.5 : 0); // some fronds point up
    const droop = 1.1 + rnd() * 0.9;
    const maxLL = 0.95 + rnd() * 0.35;
    const tint = 0.85 + rnd() * 0.3;

    // sample the rachis
    const steps = 14;
    const pts: THREE.Vector3[] = [top.clone()];
    const tans: THREE.Vector3[] = [];
    let ang = pitch0;
    for (let i = 1; i <= steps; i++) {
      const s = i / steps;
      ang = pitch0 - droop * Math.pow(s, 1.4);
      const tan = new THREE.Vector3().addScaledVector(dirH, Math.cos(ang)).add(new THREE.Vector3(0, Math.sin(ang), 0));
      tans.push(tan);
      pts.push(pts[i - 1].clone().addScaledVector(tan, L / steps));
    }
    const at = (s: number) => {
      const x = s * steps, i = Math.min(steps - 1, Math.floor(x)), t = x - i;
      return { p: pts[i].clone().lerp(pts[i + 1], t), tan: tans[i] };
    };

    // rachis ribbon (far: every other segment, twice as long)
    const rs = far ? 2 : 1;
    for (let i = 0; i < steps; i += rs) {
      const s0 = i / steps, s1 = (i + rs) / steps;
      const w0 = 0.05 * (1 - s0 * 0.7), w1 = 0.05 * (1 - s1 * 0.7);
      const c0 = darkLeaf.clone().multiplyScalar(0.8);
      const mk = (p: THREE.Vector3, w: number, sg: number, s: number): Vtx => ({
        p: p.clone().addScaledVector(side, w * sg), c: c0, s: sway0 + 0.45 * s, f: 0.2 * s,
      });
      b.quad(mk(pts[i], w0, -1, s0), mk(pts[i], w0, 1, s0), mk(pts[i + rs], w1, 1, s1), mk(pts[i + rs], w1, -1, s1));
    }

    // leaflets on both sides (far: the random draws still run for every near leaflet, so the next frond comes out the same)
    const nl = far ? 3 : leaflets;
    for (let j = 0; j < leaflets; j++) if (far) { rnd(); rnd(); rnd(); rnd(); }
    for (let j = 0; j < nl; j++) {
      const s = 0.1 + (0.88 * (j + 0.5)) / nl;
      const ds = (0.88 / nl) * 0.9;
      const { p: pm, tan } = at(s);
      const pa = at(Math.max(0, s - ds)).p, pb = at(Math.min(1, s + ds)).p;
      const ll = maxLL * Math.sin(Math.PI * Math.pow(s, 0.75)) * (0.55 + 0.45 * (1 - s)) + 0.15;
      for (const sg of [-1, 1]) {
        const out = side.clone().multiplyScalar(sg).multiplyScalar(0.9)
          .addScaledVector(tan, 0.5)
          .add(new THREE.Vector3(0, -0.5 - 0.5 * s, 0)).normalize();
        const tip = pm.clone().addScaledVector(out, ll);
        const jitter = far ? 1 : 0.9 + rnd() * 0.2;
        const cb = darkLeaf.clone().lerp(lightLeaf, 0.25 + 0.2 * s).multiplyScalar(tint * jitter);
        const ct = darkLeaf.clone().lerp(lightLeaf, 0.75 + 0.2 * (far ? 0.5 : rnd())).multiplyScalar(tint * jitter);
        const swayB = sway0 + 0.45 * s;
        b.tri(
          { p: pa, c: cb, s: swayB, f: 0.2 * s },
          { p: pb, c: cb, s: swayB, f: 0.2 * s },
          { p: tip, c: ct, s: swayB + 0.12, f: 1 },
        );
      }
    }
  }

  // coconuts
  const nuts = 2 + Math.floor(rnd() * 3);
  for (let i = 0; i < nuts; i++) {
    const a = rnd() * Math.PI * 2;
    addBlob(b, top.clone().add(new THREE.Vector3(Math.cos(a) * 0.22, -0.25 - rnd() * 0.15, Math.sin(a) * 0.22)),
      0.15, hex('#3a2a18'), hex('#6a4a28'), { lump: 0.05, upBias: 0, sway: sway0, coarse: far });
  }
  return b.build();
}

/** Broad-leaf jungle tree: tall straight trunk + several lumpy canopy clumps. */
/** `coarse`: the far-away version (crown blobs of 20 triangles instead of 80, fewer trunk segments) */
export function buildJungleTree(seed: number, coarse = false): THREE.BufferGeometry {
  const rnd = mulberry32(seed);
  const b = new GeoBuilder();
  const H = 11 + rnd() * 7;
  const { top } = addTrunk(b, {
    H, r0: 0.42, r1: 0.16, lean: 0.4 + rnd() * 1.4, leanAng: rnd() * Math.PI * 2,
    rings: coarse ? 5 : 10, radial: coarse ? 5 : 7, c0: hex('#6b5640'), c1: hex('#816a50'), bulge: 0.35, swayAmp: 0.25, band: 1.2,
  });
  addRoots(b, rnd, 6, 0.42, 0.34, hex('#4a3a2a'), hex('#6e5942'), coarse);
  const dark = [hex('#22501a'), hex('#2a5c1c'), hex('#3a6a1a')];
  const light = [hex('#80b032'), hex('#92ba3a'), hex('#6fa83c')];
  const clumps = 5 + Math.floor(rnd() * 3);
  for (let i = 0; i < clumps; i++) {
    const a = rnd() * Math.PI * 2, r = i === 0 ? 0 : 1.6 + rnd() * 2.4;
    const c = top.clone().add(new THREE.Vector3(Math.cos(a) * r, -0.8 + rnd() * 2.6 - (r > 0 ? 0.6 : 0), Math.sin(a) * r));
    const k = Math.floor(rnd() * 3);
    addBlob(b, c, 2.2 + rnd() * 1.8, dark[k], light[k], { lump: 0.28, upBias: 0.5, sway: 0.5, flutter: 0.35, squash: 0.7, seed: i * 3.7 + seed, coarse });
  }
  // a few branches' worth of smaller blobs lower down
  for (let i = 0; i < 2; i++) {
    const a = rnd() * Math.PI * 2;
    addBlob(b, new THREE.Vector3(top.x + Math.cos(a) * 2.2, top.y - 3.5, top.z + Math.sin(a) * 2.2),
      1.4 + rnd(), dark[1], light[1], { lump: 0.3, upBias: 0.4, sway: 0.4, flutter: 0.3, squash: 0.7, seed: i + 20, coarse });
  }
  return b.build();
}

/** Leafy shrub (with berries, the odd flower, or bare). 'bare' is a picked berry bush: the same shape with no berries and no flowers */
/** `far`: the far-away version of the same bush (same random draws, so the same shape and colours): no stems or sprigs, every
 *  other leaf cluster grown to fill the gap, one berry per bunch, about a third of the triangles */
export function buildBush(seed: number, mode: 'plain' | 'berry' | 'bare' = 'plain', far = false): THREE.BufferGeometry {
  // A leafy shrub: a few woody stems, a dark core, and many small leaf clusters over the outside of the crown (each a little
  // different in colour) with sprigs poking out of the edge, so the silhouette is ragged like real foliage, not a smooth blob.
  // The clusters are coarse (20 triangles each), so a bush costs about as much as the old three or four smooth blobs.
  const rnd = mulberry32(seed);
  const b = new GeoBuilder();
  const W = 0.7 + rnd() * 0.25, Hc = 0.55 + rnd() * 0.15, cy = 0.62 + rnd() * 0.1;   // crown half-width, half-height, centre height
  const greens: [THREE.Color, THREE.Color][] = [[hex('#24501a'), hex('#6fa83a')], [hex('#2c5a16'), hex('#86b234')], [hex('#1f4a22'), hex('#5f9a3e')], [hex('#33601c'), hex('#94b844')]];
  const bark0 = hex('#4a3420'), bark1 = hex('#6a4a2c');
  // stems from the ground into the crown (three-sided: they're thin and mostly hidden)
  for (let i = 0; i < 4; i++) {
    const a = rnd() * Math.PI * 2, lean = 0.25 + rnd() * 0.2;
    if (!far) addTrunk(b, { H: cy + 0.1, r0: 0.035, r1: 0.015, lean, leanAng: a, rings: 2, radial: 3, c0: bark0, c1: bark1, bulge: 0, swayAmp: 0.2, band: 0.3 });
  }
  // the dark heart of the bush, so you never see through it (the clusters cover it, so it can be coarse)
  addBlob(b, new THREE.Vector3(0, cy, 0), Math.min(W, Hc) * 0.85, hex('#16300f'), hex('#2c5a16'), { lump: 0.2, upBias: 0.2, sway: 0.35, flutter: 0.2, squash: Hc / W, seed, coarse: true });
  // leaf clusters over the crown, more on top and the sunny side
  const clusters: { c: THREE.Vector3; r: number; sway: number }[] = [];
  const N = 16 + Math.floor(rnd() * 6);
  for (let i = 0; i < N; i++) {
    const u = rnd() * 2 - 0.6, th = rnd() * Math.PI * 2, rr = Math.sqrt(1 - Math.min(1, u * u));
    const c = new THREE.Vector3(Math.cos(th) * rr * W * 0.82, cy + u * Hc * 0.85, Math.sin(th) * rr * W * 0.82);
    const r = 0.2 + rnd() * 0.14, g = greens[Math.floor(rnd() * greens.length)];
    const sway = 0.35 + 0.25 * (u + 0.6);
    if (!far || i % 2 === 0) addBlob(b, c, far ? r * 1.3 : r, g[0], g[1], { lump: 0.38, upBias: 0.55, sway, flutter: 0.55, squash: 0.8, seed: seed * 7 + i, coarse: true });
    clusters.push({ c, r, sway });
  }
  // sprigs sticking out of the edge
  for (let i = 0; i < 9; i++) {
    const th = rnd() * Math.PI * 2, y = cy + (rnd() - 0.3) * Hc;
    const c = new THREE.Vector3(Math.cos(th) * W * 1.02, y, Math.sin(th) * W * 1.02), g = greens[Math.floor(rnd() * greens.length)];
    if (!far && i < 6) addBlob(b, c, 0.13 + rnd() * 0.06, g[0], g[1], { lump: 0.45, upBias: 0.5, sway: 0.6, flutter: 0.8, squash: 0.55, seed: seed * 13 + i, coarse: true });
  }
  // berries / flowers sit ON the leaf clusters: a point on a cluster's outward, upper half, a little sunk into it
  const onSurface = (k: number) => {
    const cl = clusters[k], out = new THREE.Vector3(cl.c.x, (cl.c.y - cy) * 0.6, cl.c.z).normalize();
    const d = new THREE.Vector3(out.x + (rnd() - 0.5) * 0.9, Math.abs(out.y) + 0.25 + rnd() * 0.5, out.z + (rnd() - 0.5) * 0.9).normalize();
    return { p: cl.c.clone().addScaledVector(d, cl.r * 0.92), sway: cl.sway };
  };
  if (mode === 'berry') {
    const reds = [hex('#e0302e'), hex('#ee4a30'), hex('#cf2230')];
    for (let i = 0; i < 9; i++) {
      // bunches of two or three
      const s = onSurface(Math.floor(rnd() * clusters.length));
      for (let j = 0; j < 2 + Math.floor(rnd() * 2); j++) {
        const c = reds[(i + j) % 3], o = new THREE.Vector3((rnd() - 0.5) * 0.09, (rnd() - 0.5) * 0.05, (rnd() - 0.5) * 0.09);
        if (!far || j === 0) addBlob(b, s.p.clone().add(o), far ? 0.06 : 0.048, c, c, { lump: 0, upBias: 0.2, sway: s.sway, flutter: 0.55, coarse: true });
      }
    }
  } else if (mode === 'plain' && rnd() < 0.55) {
    const fc = [hex('#ff5a6e'), hex('#ffd84a'), hex('#ff8a3c'), hex('#f06be0')][Math.floor(rnd() * 4)];
    for (let i = 0; i < 6; i++) {
      const s = onSurface(Math.floor(rnd() * clusters.length));
      if (!far || i % 2 === 0) addBlob(b, s.p, 0.075, fc, fc.clone().lerp(hex('#ffffff'), 0.3), { lump: 0.1, upBias: 0.3, sway: s.sway, flutter: 0.55, squash: 0.6, coarse: true });
    }
  }
  return b.build();
}

/** One grass tuft: fan of tapered, bent blades. */
export function buildGrassTuft(far = false): THREE.BufferGeometry {
  const rnd = mulberry32(far ? 9 : 5);
  const b = new GeoBuilder();
  const base = hex('#608a26'), tip = hex('#c8d85a');
  const up = new THREE.Vector3(0, 1, 0);
  const blades = far ? 4 : 6;
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2 + rnd() * 0.5;
    const ox = Math.cos(a) * (0.04 + rnd() * 0.1), oz = Math.sin(a) * (0.04 + rnd() * 0.1);
    const H = 0.3 + rnd() * 0.4; // same blade height as the near tier; distance scaling happens per instance
    const bend = 0.1 + rnd() * 0.22;
    const dir = new THREE.Vector3(Math.cos(a + 1.2), 0, Math.sin(a + 1.2));
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const w = far ? 0.04 + rnd() * 0.02 : 0.028 + rnd() * 0.02;
    const mk = (t: number, sg: number): Vtx => {
      const wd = w * (1 - t * t) * sg;
      const p = new THREE.Vector3(ox, H * t, oz).addScaledVector(dir, bend * t * t).addScaledVector(side, wd);
      return { p, n: up, c: base.clone().lerp(tip, t * 0.9 + rnd() * 0.05), s: t * t, f: t * 0.4 };
    };
    b.quad(mk(0, -1), mk(0, 1), mk(0.5, 1), mk(0.5, -1));
    b.tri(mk(0.5, -1), mk(0.5, 1), { ...mk(1, 0), p: new THREE.Vector3(ox, H, oz).addScaledVector(dir, bend) });
  }
  return b.build();
}

/** What is left standing after a tree is felled. */
export function buildStump(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const H = 0.55, radial = 9;
  addTrunk(b, {
    H, r0: 0.36, r1: 0.31, lean: 0, leanAng: 0, rings: 2, radial,
    c0: hex('#6d5a46'), c1: hex('#7d6a54'), bulge: 0.1, swayAmp: 0, band: 5,
  });
  const cut = hex('#d6b583'), mid = hex('#b8905c');
  const up = new THREE.Vector3(0, 1, 0);
  const centre: Vtx = { p: new THREE.Vector3(0, H, 0), n: up, c: mid, s: 0, f: 0 };
  for (let j = 0; j < radial; j++) {
    const a0 = (j / radial) * Math.PI * 2, a1 = ((j + 1) / radial) * Math.PI * 2;
    const r = 0.31;
    b.tri(
      centre,
      { p: new THREE.Vector3(Math.cos(a1) * r, H, Math.sin(a1) * r), n: up, c: cut, s: 0, f: 0 },
      { p: new THREE.Vector3(Math.cos(a0) * r, H, Math.sin(a0) * r), n: up, c: cut, s: 0, f: 0 },
    );
  }
  return b.build();
}


/** A dry, fallen palm frond lying on the ground (scenery). Vertex colours only. */
export function buildDryFrond(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(1, 1, 3, 8);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const a = new THREE.Color('#8a6a3a'), b = new THREE.Color('#c9a468'), t = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i) + 0.5; // y 0..1 along the frond
    const w = Math.sin(Math.PI * Math.min(1, 0.12 + y * 0.9)) * 0.22;
    pos.setXYZ(i, x * w * 2, y * 1.8, Math.abs(x) * 0.12 - Math.sin(y * 3.1) * 0.03);
    t.copy(a).lerp(b, Math.min(1, y * 0.7 + (x + 0.5) * 0.3 * Math.abs(Math.sin(y * 40))));
    col.set([t.r, t.g, t.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.rotateX(-Math.PI / 2);
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}
