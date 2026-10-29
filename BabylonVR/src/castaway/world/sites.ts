// Surface points of interest: ruined huts dotted around the island and a couple of shipwrecks on the beaches, each with a chest.
// Placement is a pure function of the terrain (so every player gets the same sites); the vegetation keeps clear of them.
// Babylon port: drawn by render/mirror.ts (the image-based sky light gives the fill Castaway faked with emissive).
import * as THREE from 'three';
import { mulberry32 } from '../core/noise';
import { heightAt, slopeAt } from './island';
import { Mesher } from '../net/playerModel';
import { caveEntranceXZ } from './cave';
import type { Zone, ColliderGrid } from './vegetation';

export interface SitePlan { id: string; kind: 'hut' | 'wreck'; x: number; z: number; yaw: number; r: number }

const HUTS = 6, WRECKS = 2;

/** Where the sites go. `spawn` and `avoid` (springs...) are kept clear. */
export function planSites(spawn: { x: number; z: number }, avoid: Zone[]): SitePlan[] {
  const rnd = mulberry32(4242);
  const caves = caveEntranceXZ();
  const out: SitePlan[] = [];
  const clear = (x: number, z: number, minSite: number) =>
    Math.hypot(x - spawn.x, z - spawn.z) > 60 && avoid.every((a) => Math.hypot(x - a.x, z - a.z) > a.r + 12) &&
    caves.every((c) => Math.hypot(x - c.x, z - c.z) > 16) && out.every((s) => Math.hypot(x - s.x, z - s.z) > minSite);

  // ruined huts: flat, dry, inland ground
  for (let tries = 0; tries < 9000 && out.filter((s) => s.kind === 'hut').length < HUTS; tries++) {
    const a = rnd() * Math.PI * 2, r = 35 + rnd() * 150, x = Math.cos(a) * r, z = Math.sin(a) * r;
    const h = heightAt(x, z);
    if (h < 2.2 || h > 14) continue;
    if (!clear(x, z, 55)) continue;
    let hi = -1e9, lo = 1e9;
    for (let k = 0; k < 12; k++) {
      const rr = k < 4 ? 1.2 : 3.0, q = heightAt(x + Math.cos(k * 0.785) * rr, z + Math.sin(k * 0.785) * rr);
      hi = Math.max(hi, q); lo = Math.min(lo, q);
    }
    if (hi - lo > 0.55 || lo < 1.6 || slopeAt(x, z, 2) > 0.2) continue;
    out.push({ id: `S${out.length}`, kind: 'hut', x, z, yaw: rnd() * Math.PI * 2, r: 5.4 });
  }
  // shipwrecks: where the beach meets shallow water
  for (let tries = 0; tries < 400 && out.filter((s) => s.kind === 'wreck').length < WRECKS; tries++) {
    const a = rnd() * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a);
    let r0 = -1;
    for (let r = 335; r > 30; r -= 1) if (heightAt(dx * r, dz * r) >= 0.2) { r0 = r; break; }
    if (r0 < 0) continue;
    const x = dx * (r0 + 3.5), z = dz * (r0 + 3.5), h = heightAt(x, z);
    if (h > 0.1 || h < -1.6) continue;
    const back = heightAt(dx * (r0 - 4), dz * (r0 - 4));
    if (back < 0.3 || back > 3 || slopeAt(x, z, 3) > 0.3) continue;
    if (!clear(x, z, 80)) continue;
    out.push({ id: `S${out.length}`, kind: 'wreck', x, z, yaw: Math.atan2(-dz, dx) + Math.PI / 2 + (rnd() - 0.5) * 0.7, r: 9 });
  }
  return out;
}

/** how far the lid swings back: the hinge sits against the hut wall, so it must stop short of going through it */
const LID_OPEN = 1.68;

export interface SiteChest {
  id: string; kind: SitePlan['kind']; x: number; y: number; z: number; yaw: number;
  group: THREE.Group; lid: THREE.Group; open: number; opened: boolean;
}

const WOOD = '#8a6a47', WOOD2 = '#76593a', DARK = '#4d3724', THATCH = '#a99458', ROPE = '#b8a470', CLOTH = '#d9d0b4';
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const withSiteMat = (m: THREE.Mesh) => m;

export class SurfaceSites {
  readonly group = new THREE.Group();
  readonly chests: SiteChest[] = [];
  /** ids of looted chests (saved with the world) */
  readonly opened = new Set<string>();
  /** the odd door in the first hut (leads to the sky room) */
  door: { x: number; y: number; z: number; yaw: number; hx: number; hz: number } | null = null;

  constructor(scene: THREE.Scene, readonly plan: SitePlan[], colliders: ColliderGrid, private shadows: boolean) {
    for (const s of plan) (s.kind === 'hut' ? this.buildHut(s, colliders) : this.buildWreck(s, colliders));
    scene.add(this.group);
  }

  // ------------------------------------------------------------------ geometry helpers
  private finish(m: Mesher, x: number, y: number, z: number, yaw: number) {
    const mesh = withSiteMat(m.build(this.shadows));
    mesh.position.set(x, y, z); mesh.rotation.set(0, yaw, 0);
    mesh.geometry.computeBoundingSphere();
    mesh.frustumCulled = true;
    this.group.add(mesh);
    return mesh;
  }

  private makeChest(s: SitePlan, x: number, y: number, z: number, yaw: number, id: string) {
    const g = new THREE.Group(), M = new Mesher(), L = new Mesher();
    const wood = s.kind === 'wreck' ? '#6a4a2c' : '#8a5a2e';
    M.box(0.9, 0.5, 0.58, wood, 0, 0.25, 0);
    for (const dx of [-0.3, 0.3]) M.box(0.07, 0.52, 0.62, '#3d4348', dx, 0.25, 0);
    M.box(0.88, 0.05, 0.56, '#3a2a1a', 0, 0.02, 0);
    M.box(0.82, 0.04, 0.5, '#e0b341', 0, 0.5, 0);               // a glint of coins under the lid
    L.box(0.94, 0.14, 0.62, tone(wood, 1.08), 0, 0.07, -0.3);
    L.cyl(0.31, 0.31, 0.94, tone(wood, 1.12), 0, 0.14, -0.3, 0.55, 1, 14, 0, 0, Math.PI / 2);
    for (const dx of [-0.3, 0.3]) L.box(0.07, 0.2, 0.64, '#3d4348', dx, 0.1, -0.3);
    L.box(0.13, 0.13, 0.04, '#d6b24a', 0, 0.02, -0.62);          // lock plate
    const base = withSiteMat(M.build(false)), lid = new THREE.Group();
    lid.add(withSiteMat(L.build(false))); lid.position.set(0, 0.5, 0.3);
    g.add(base, lid);
    g.position.set(x, y, z); g.rotation.y = yaw;
    this.group.add(g);
    const ch: SiteChest = { id, kind: s.kind, x, y: y + 0.3, z, yaw, group: g, lid, open: 0, opened: false };
    this.chests.push(ch);
    return ch;
  }

  /** local (lx, lz) of a site -> world */
  private w(s: SitePlan, lx: number, lz: number): [number, number] {
    const c = Math.cos(s.yaw), n = Math.sin(s.yaw);
    return [s.x + lx * c + lz * n, s.z - lx * n + lz * c];
  }

  // ------------------------------------------------------------------ the hut
  private buildHut(s: SitePlan, colliders: ColliderGrid) {
    const rnd = mulberry32(Math.floor(s.x * 31 + s.z * 17) | 0);
    const m = new Mesher();
    const W = 3.7, D = 3.3, hw = W / 2, hd = D / 2, H = 2.35;
    let top = -1e9;
    for (let ix = -2; ix <= 2; ix++) for (let iz = -2; iz <= 2; iz++) { const [wx, wz] = this.w(s, ix * hw / 2, iz * hd / 2); top = Math.max(top, heightAt(wx, wz)); }
    const gnd = (lx: number, lz: number) => { const [wx, wz] = this.w(s, lx, lz); return heightAt(wx, wz); };
    // vertical planks standing on the real ground; the tops are ragged because it is a ruin
    const plank = (lx: number, lz: number, rot: number, ruin: number) => {
      const g0 = gnd(lx, lz) - 0.15, hh = (top + H - g0) * (1 - ruin * rnd() * 0.55);
      m.box(0.2, hh, 0.07, rnd() < 0.5 ? WOOD : WOOD2, lx, g0 + hh / 2, lz, 0, rot, (rnd() - 0.5) * 0.04);
    };
    const wall = (x0: number, z0: number, x1: number, z1: number, rot: number, door = false, ruin = 0.4) => {
      const len = Math.hypot(x1 - x0, z1 - z0), n = Math.round(len / 0.215);
      for (let i = 0; i <= n; i++) {
        const t = i / n, lx = lerp(x0, x1, t), lz = lerp(z0, z1, t);
        if (door && Math.abs(lx) < 0.58) continue;
        if (rnd() < 0.07) continue;                                // a missing board
        plank(lx, lz, rot + (rnd() - 0.5) * 0.04, ruin);
      }
    };
    wall(-hw, hd, hw, hd, 0, true, 0.25);            // front (with the doorway)
    wall(-hw, -hd, hw, -hd, 0, false, 0.5);          // back
    wall(-hw, -hd, -hw, hd, Math.PI / 2, false, 0.45);
    wall(hw, -hd, hw, hd, Math.PI / 2, false, 0.45);
    // corner posts, door frame and lintel
    for (const [lx, lz] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd]]) { const g0 = gnd(lx, lz) - 0.25; m.box(0.16, top + H + 0.15 - g0, 0.16, DARK, lx, (g0 + top + H + 0.15) / 2, lz); }
    for (const sx of [-1, 1]) { const g0 = gnd(sx * 0.62, hd) - 0.2; m.box(0.12, top + H - g0, 0.14, DARK, sx * 0.62, (g0 + top + H) / 2, hd + 0.01); }
    m.box(1.4, 0.14, 0.14, DARK, 0, top + 1.95, hd + 0.01);
    // a roof of sagging thatch strips over a ridge pole, with gaps where it has fallen in
    const ridge = top + H + 0.85, slope = Math.atan2(0.85, hw + 0.35), len = Math.hypot(hw + 0.35, 0.85);
    m.box(0.12, 0.12, D + 0.5, DARK, 0, ridge, 0);
    for (let k = 0; k < 9; k++) {
      const lz = -hd - 0.15 + (k / 8) * (D + 0.3);
      for (const sx of [-1, 1]) {
        if (rnd() < 0.16) continue;
        m.box(len, 0.06, 0.42, rnd() < 0.5 ? THATCH : '#8f7c47', sx * (hw + 0.35) / 2, ridge - 0.43, lz, 0, 0, -sx * slope);
      }
    }
    for (const sx of [-1, 1]) m.box(0.1, 0.1, D + 0.5, DARK, sx * (hw + 0.35), top + H - 0.02, 0);   // eaves beams
    // inside: crates, a barrel, a stool and a rolled mat
    const prop = (lx: number, lz: number, fn: (x: number, y: number, z: number) => void) => fn(lx, gnd(lx, lz), lz);
    prop(hw - 0.55, -hd + 0.5, (x, y, z) => { m.box(0.6, 0.55, 0.6, WOOD, x, y + 0.27, z, 0, 0.3, 0); m.box(0.5, 0.45, 0.5, WOOD2, x - 0.1, y + 0.78, z + 0.05, 0, -0.2, 0); });
    prop(hw - 0.5, -hd + 1.3, (x, y, z) => { m.cyl(0.3, 0.3, 0.75, '#6a4a2c', x, y + 0.37, z, 1, 1, 12); m.cyl(0.31, 0.31, 0.04, '#3d4348', x, y + 0.2, z, 1, 1, 12); m.cyl(0.31, 0.31, 0.04, '#3d4348', x, y + 0.55, z, 1, 1, 12); });
    prop(-0.4, hd - 0.7, (x, y, z) => { m.cyl(0.2, 0.22, 0.36, WOOD2, x, y + 0.18, z, 1, 1, 10); });
    prop(hw - 0.5, 0.5, (x, y, z) => { m.cyl(0.13, 0.13, 1.1, CLOTH, x, y + 0.14, z, 1, 1, 10, 0, 0, Math.PI / 2); m.cyl(0.14, 0.14, 0.05, ROPE, x - 0.25, y + 0.14, z, 1, 1, 10, 0, 0, Math.PI / 2); });
    if (!this.door) {                                              // the odd door, standing against the back wall
      const gy = gnd(0.2, -hd + 0.12);
      m.box(1.0, 2.0, 0.07, '#2d6f7a', 0.2, gy + 1.0, -hd + 0.14);
      m.box(0.9, 0.9, 0.02, '#245a63', 0.2, gy + 1.45, -hd + 0.19);
      m.box(0.9, 0.55, 0.02, '#245a63', 0.2, gy + 0.45, -hd + 0.19);
      for (const sx of [-1, 1]) m.box(0.1, 2.14, 0.12, DARK, 0.2 + sx * 0.55, gy + 1.07, -hd + 0.14);
      m.box(1.2, 0.12, 0.12, DARK, 0.2, gy + 2.1, -hd + 0.14);
      m.box(0.09, 0.09, 0.07, '#e0b341', 0.45, gy + 1.0, -hd + 0.22);
      const [dx, dz] = this.w(s, 0.2, -hd + 0.4);
      this.door = { x: dx, y: gy + 1.0, z: dz, yaw: s.yaw, hx: s.x, hz: s.z };
    }
    // low stone footing at the corners to hide the gaps under the boards
    for (const [lx, lz] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd], [0, -hd], [-hw, 0], [hw, 0]]) { const g0 = gnd(lx, lz); m.box(0.38, 0.3, 0.38, '#8d877b', lx, g0 + 0.05, lz, 0, rnd(), 0); }
    this.finish(m, s.x, 0, s.z, s.yaw);
    // the chest stands against the back wall
    const [cx, cz] = this.w(s, -hw + 0.75, -hd + 0.85);
    this.makeChest(s, cx, heightAt(cx, cz), cz, s.yaw + Math.PI, s.id);
    // walls you cannot walk through (door gap left open)
    const ring = (x0: number, z0: number, x1: number, z1: number, door: boolean) => {
      const len = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(len / 0.5);
      for (let i = 0; i <= n; i++) {
        const t = i / n, lx = lerp(x0, x1, t), lz = lerp(z0, z1, t);
        if (door && Math.abs(lx) < 0.78) continue;
        const [wx, wz] = this.w(s, lx, lz);
        colliders.add({ x: wx, z: wz, r: 0.3 });
      }
    };
    ring(-hw, hd, hw, hd, true); ring(-hw, -hd, hw, -hd, false); ring(-hw, -hd, -hw, hd, false); ring(hw, -hd, hw, hd, false);
  }

  // ------------------------------------------------------------------ the shipwreck
  private buildWreck(s: SitePlan, colliders: ColliderGrid) {
    const rnd = mulberry32(Math.floor(s.x * 13 + s.z * 7) | 0);
    const m = new Mesher();
    const baseY = heightAt(s.x, s.z) - 0.45;
    // half-beam along the hull (bow at -z, stern at +z)
    const beam = (z: number) => 0.45 + 1.15 * Math.max(0, 1 - (z / 4.9) ** 2);
    m.box(0.22, 0.3, 9.6, DARK, 0, 0.15, 0.1);                                       // keel
    for (let z = -4.2; z <= 4.2; z += 0.9) {                                         // ribs
      const w = beam(z), ang = Math.atan2(w, 1.85), len = Math.hypot(w, 1.85);
      for (const sx of [-1, 1]) {
        if (z > 2.2 && rnd() < 0.55) continue;                                       // the stern is broken open
        m.box(0.12, len, 0.13, DARK, sx * w / 2, 1.08, z, 0, 0, -sx * ang);
      }
    }
    for (let z = -4.3; z <= 4.3; z += 0.92) {                                        // side planking, patchy toward the stern
      const w = beam(z);
      for (let row = 0; row < 5; row++) {
        const y = 0.32 + row * 0.4, x = 0.2 + (w - 0.2) * Math.pow(y / 2.0, 0.7);
        for (const sx of [-1, 1]) {
          const gone = z > 0.5 ? rnd() < 0.2 + (z - 0.5) * 0.14 : rnd() < 0.1;
          if (gone) continue;
          m.box(0.07, 0.38, 0.9, rnd() < 0.5 ? WOOD : WOOD2, sx * x, y, z, 0, 0, -sx * 0.22);
        }
      }
    }
    for (let z = -4.3; z < -0.9; z += 0.34) if (rnd() > 0.12) m.box(beam(z) * 1.55, 0.06, 0.3, rnd() < 0.5 ? WOOD : WOOD2, 0, 1.16, z);   // bow deck
    m.box(0.18, 2.9, 0.24, DARK, 0, 1.4, -4.9, 0.4);                                  // stem post
    m.cyl(0.1, 0.14, 6.2, '#5a4128', 0.6, 3.9, -1.1, 1, 1, 8, 0, 0, 0.32);            // broken mast
    m.box(2.4, 0.1, 0.1, '#5a4128', 1.2, 4.7, -1.1, 0, 0, 0.32 + 0.05);
    m.box(1.9, 1.7, 0.03, CLOTH, 1.05, 3.8, -1.05, 0, 0.1, 0.36);                      // torn sail
    m.box(0.5, 0.9, 0.03, CLOTH, 1.9, 3.1, -1.0, 0, 0.1, 0.5);
    for (const sx of [-1, 1]) m.cyl(0.015, 0.015, 3.6, ROPE, sx * 0.9 + 0.3, 2.4, -1.1, 1, 1, 4, 0, 0, sx * 0.5);   // rigging
    // cargo: barrels and a crate in the hold
    m.cyl(0.32, 0.32, 0.8, '#6a4a2c', -0.5, 0.55, -3.2, 1, 1, 12); m.cyl(0.33, 0.33, 0.04, '#3d4348', -0.5, 0.4, -3.2, 1, 1, 12); m.cyl(0.33, 0.33, 0.04, '#3d4348', -0.5, 0.75, -3.2, 1, 1, 12);
    m.cyl(0.3, 0.3, 0.75, '#6a4a2c', 0.45, 0.5, -2.6, 1, 1, 12, 0, 0, 0.9);
    m.box(0.6, 0.5, 0.6, WOOD, 0.35, 0.4, -3.6, 0, 0.5, 0);
    const mesh = withSiteMat(m.build(this.shadows));
    mesh.position.set(s.x, baseY, s.z);
    mesh.rotation.order = 'YXZ'; mesh.rotation.set(0.1, s.yaw, 0.2);
    mesh.geometry.computeBoundingSphere(); mesh.frustumCulled = true;
    this.group.add(mesh);
    // the chest sits on the sand toward the open stern
    const [cx, cz] = this.w(s, 0.1, 2.3);
    this.makeChest(s, cx, Math.max(0.05, heightAt(cx, cz)), cz, s.yaw + 0.4, s.id);
    for (let z = -4.4; z <= 1.6; z += 0.8) {
      const w = beam(z);
      for (const sx of [-1, 1]) { const [wx, wz] = this.w(s, sx * (w + 0.05), z); colliders.add({ x: wx, z: wz, r: 0.38 }); }
    }
    const [bx, bz] = this.w(s, 0, -4.9); colliders.add({ x: bx, z: bz, r: 0.5 });
  }

  // ------------------------------------------------------------------ interaction
  update(dt: number) {
    for (const c of this.chests) {
      const target = c.opened ? 1 : 0;
      if (c.open === target) continue;
      c.open += Math.sign(target - c.open) * Math.min(Math.abs(target - c.open), dt * 2.6);
      c.lid.rotation.x = c.open * LID_OPEN;
    }
  }

  setOpened(id: string, instant = false) {
    this.opened.add(id);
    const c = this.chests.find((q) => q.id === id);
    if (c) { c.opened = true; if (instant) { c.open = 1; c.lid.rotation.x = LID_OPEN; } }
  }

  pick(eye: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, reach: number, assist = 1): { chest: SiteChest; dist: number } | null {
    let best: { chest: SiteChest; dist: number } | null = null;
    for (const c of this.chests) {
      const dx = c.x - eye.x, dy = c.y - eye.y, dz = c.z - eye.z;
      if (dx * dx + dz * dz > (reach + 2) ** 2) continue;
      const t = dx * dir.x + dy * dir.y + dz * dir.z;
      if (t < 0 || t > reach + 0.8) continue;
      const px = dx - dir.x * t, py = dy - dir.y * t, pz = dz - dir.z * t, r = 0.75 * assist;
      if (px * px + py * py + pz * pz <= r * r && (!best || t < best.dist)) best = { chest: c, dist: t };
    }
    return best;
  }

  /** looking at the odd door? */
  pickDoor(eye: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, reach: number, assist = 1): number | null {
    const d = this.door; if (!d) return null;
    const dx = d.x - eye.x, dy = d.y - eye.y, dz = d.z - eye.z;
    if (dx * dx + dz * dz > (reach + 2) ** 2) return null;
    const t = dx * dir.x + dy * dir.y + dz * dir.z;
    if (t < 0 || t > reach + 0.8) return null;
    const px = dx - dir.x * t, py = dy - dir.y * t, pz = dz - dir.z * t, r = 0.9 * assist;
    return px * px + py * py + pz * pz <= r * r ? t : null;
  }
  /** where the way back from the sky room puts you: just in front of the door, facing into the hut */
  doorExit() {
    const d = this.door!; const c = Math.cos(d.yaw), n = Math.sin(d.yaw), lx = 0.2, lz = -1.65 + 1.4;
    const x = d.hx + lx * c + lz * n, z = d.hz - lx * n + lz * c;
    return { x, z, yaw: Math.atan2(-Math.sin(d.yaw), -Math.cos(d.yaw)) };
  }

  /** a rough spot to show on the compass / for tests */
  chestOf(id: string) { return this.chests.find((c) => c.id === id) ?? null; }
}

function tone(hex: string, k: number) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(k);
  return `#${c.getHexString()}`;
}
