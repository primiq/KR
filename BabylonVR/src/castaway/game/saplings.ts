// Saplings: a rare drop from felled trees. Plant one and it grows through four looks (sapling, young, growing, full-grown) over about one
// in-game day (1500 s of play), and the grown tree can be chopped like any other. Trees live in a pool of slots made in the Vegetation.
import type { Vegetation } from '../world/vegetation';
import type { Resources } from './resources';
import { heightAt, slopeAt } from '../world/island';

export const GROW_DAY = 1500;
export const STAGES = [
  { age: 0, scale: 0.14, name: 'Sapling' },
  { age: 500, scale: 0.4, name: 'Young tree' },
  { age: 1000, scale: 0.7, name: 'Growing tree' },
  { age: GROW_DAY, scale: 1.05, name: 'Full-grown tree' },
];
export const stageOf = (age: number) => { let s = 0; for (let i = 0; i < STAGES.length; i++) if (age >= STAGES[i].age) s = i; return s; };
export const scaleAt = (age: number) => {
  if (age >= GROW_DAY) return STAGES[3].scale;
  const s = stageOf(age), a = STAGES[s], b = STAGES[s + 1];
  const t = (age - a.age) / (b.age - a.age);
  return a.scale + (b.scale - a.scale) * t * t * (3 - 2 * t);
};

export interface Planted { slot: number; x: number; y: number; z: number; rot: number; age: number; stage: number; acc: number; fin?: boolean }

export class Saplings {
  readonly list: Planted[] = [];
  onPlant: ((p: Planted) => void) | null = null;
  /** a tree finished one growth step (for a puff of leaves) */
  onGrow: ((p: Planted) => void) | null = null;
  constructor(private veg: Vegetation, private res: Resources) {}

  /** can a tree stand here? returns '' when yes, or the reason */
  check(x: number, z: number): string {
    const h = heightAt(x, z);
    if (h < 1.3) return 'Too close to the water';
    if (h > 34 || slopeAt(x, z) > 0.5) return 'Too steep';
    const near: any[] = []; this.veg.colliders.near(x, z, 1.6, near);
    if (near.length) return 'Too close to something';
    for (const p of this.list) if (Math.hypot(p.x - x, p.z - z) < 2.2) return 'Too close to another tree';
    return '';
  }
  kindAt(x: number, z: number): 'palm' | 'tree' { return heightAt(x, z) < 7 ? 'palm' : 'tree'; }

  plant(x: number, y: number, z: number, opts: { slot?: number; age?: number; rot?: number; remote?: boolean } = {}): Planted | null {
    const kind = this.kindAt(x, z);
    let idx = opts.slot ?? -1;
    if (idx < 0 || !this.veg.plantSlots[idx]) idx = this.veg.plantSlots.findIndex((s) => !s.used && s.kind === kind);
    const slot = this.veg.plantSlots[idx];
    if (!slot) return null;
    const old = this.list.findIndex((p) => p.slot === idx);
    if (old >= 0) this.list.splice(old, 1);
    const age = opts.age ?? 0;
    const p: Planted = { slot: idx, x, y, z, rot: opts.rot ?? Math.random() * 6.28, age, stage: stageOf(age), acc: 0, fin: age >= GROW_DAY };
    slot.set(x, y, z, p.rot, scaleAt(age));
    slot.node.left = slot.node.total;
    this.res.release(slot.node);
    this.list.push(p);
    if (!opts.remote) this.onPlant?.(p);
    return p;
  }

  update(dt: number) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i], slot = this.veg.plantSlots[p.slot];
      if (slot.node.depleted) { slot.clear(); this.res.release(slot.node); this.list.splice(i, 1); continue; }   // chopped down
      p.age += dt; p.acc += dt;
      if (!p.fin && p.acc > 2) {
        p.acc = 0; if (p.age >= GROW_DAY) p.fin = true;
        slot.set(p.x, p.y, p.z, p.rot, scaleAt(p.age));
        const st = stageOf(p.age);
        if (st !== p.stage) { p.stage = st; this.onGrow?.(p); }
      }
    }
  }

  byNode(node: { pool?: number }): Planted | undefined { return node.pool === undefined ? undefined : this.list.find((p) => p.slot === node.pool); }
  capture() { return this.list.map((p) => [p.slot, +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +p.rot.toFixed(2), Math.round(p.age)]); }
  restore(rows: number[][]) {
    for (const p of [...this.list]) { this.veg.plantSlots[p.slot].clear(); this.res.release(this.veg.plantSlots[p.slot].node); }
    this.list.length = 0;
    for (const [slot, x, y, z, rot, age] of rows) this.plant(x, y, z, { slot, rot, age, remote: true });
  }
}
