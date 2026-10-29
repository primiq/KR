import { ITEMS, ItemId } from './items';

export interface Slot { id: ItemId; count: number; /** remaining uses for tools that wear out */ dur?: number }

/** Player bag: 24 slots, the first 6 are the hotbar. Also used for storage boxes and furnace/campfire slots. */
export class Inventory {
  slots: (Slot | null)[];
  /** containers can restrict what a slot takes (furnace output, input recipes, ...) */
  accepts: ((slot: number, id: ItemId) => boolean) | null = null;
  private subs = new Set<() => void>();

  constructor(readonly size = 24, readonly hotbar = size >= 24 ? 6 : 0) {
    this.slots = new Array(size).fill(null);
  }

  subscribe(fn: () => void) { this.subs.add(fn); return () => this.subs.delete(fn); }
  emit() { this.subs.forEach((f) => f()); }

  /** Returns how many items did NOT fit. */
  add(id: ItemId, count: number, dur?: number): number {
    const max = ITEMS[id].stack;
    let left = count;
    for (const s of this.slots) {
      if (left <= 0) break;
      if (s && s.id === id && s.count < max) {
        const n = Math.min(max - s.count, left);
        s.count += n; left -= n;
      }
    }
    for (let i = 0; i < this.size && left > 0; i++) {
      if (!this.slots[i]) {
        const n = Math.min(max, left);
        this.slots[i] = this.fresh(id, n, dur); left -= n;
      }
    }
    if (left !== count) this.emit();
    return left;
  }

  private fresh(id: ItemId, count: number, dur?: number): Slot {
    const max = ITEMS[id].dur;
    return max ? { id, count, dur: Math.min(max, dur ?? max) } : { id, count };
  }

  /** Adds only into slots in [from, to) that accept the item. Returns what did not fit. */
  addRange(id: ItemId, count: number, from: number, to: number, force = false, dur?: number): number {
    const max = ITEMS[id].stack;
    let left = count;
    const ok = (i: number) => force || !this.accepts || this.accepts(i, id);
    for (let i = from; i < to && left > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id && s.count < max && ok(i)) { const n = Math.min(max - s.count, left); s.count += n; left -= n; }
    }
    for (let i = from; i < to && left > 0; i++) {
      if (!this.slots[i] && ok(i)) { const n = Math.min(max, left); this.slots[i] = this.fresh(id, n, dur); left -= n; }
    }
    if (left !== count) this.emit();
    return left;
  }

  /** Moves the whole stack in slot `i` to another container. Returns how many moved. */
  sendTo(i: number, other: Inventory): number {
    const s = this.slots[i];
    if (!s) return 0;
    const left = other.addRange(s.id, s.count, 0, other.size, false, s.dur);
    const moved = s.count - left;
    if (moved > 0) { s.count = left; if (s.count <= 0) this.slots[i] = null; this.emit(); }
    return moved;
  }

  /** Tap-to-move between two (or the same) containers: swap, merge or place. */
  static transfer(a: Inventory, i: number, b: Inventory, j: number): boolean {
    if (a === b) { if (i === j) return false; a.move(i, j); return true; }
    const s = a.slots[i];
    if (!s) return false;
    if (b.accepts && !b.accepts(j, s.id)) return false;
    const t = b.slots[j];
    if (t && t.id === s.id) {
      const n = Math.min(ITEMS[s.id].stack - t.count, s.count);
      if (n <= 0) return false;
      t.count += n; s.count -= n;
      if (s.count <= 0) a.slots[i] = null;
    } else if (!t) {
      b.slots[j] = s; a.slots[i] = null;
    } else {
      if (a.accepts && !a.accepts(i, t.id)) return false;
      b.slots[j] = s; a.slots[i] = t;
    }
    a.emit(); b.emit();
    return true;
  }

  canFit(id: ItemId, count: number): number {
    const max = ITEMS[id].stack;
    let room = 0;
    for (const s of this.slots) room += s ? (s.id === id ? max - s.count : 0) : max;
    return Math.min(count, room);
  }

  count(id: ItemId): number {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.count;
    return n;
  }

  remove(id: ItemId, count: number): boolean {
    if (this.count(id) < count) return false;
    let left = count;
    for (let i = this.size - 1; i >= 0 && left > 0; i--) {
      const s = this.slots[i];
      if (s && s.id === id) {
        const n = Math.min(s.count, left);
        s.count -= n; left -= n;
        if (s.count <= 0) this.slots[i] = null;
      }
    }
    this.emit();
    return true;
  }

  takeAt(i: number, n: number): Slot | null {
    const s = this.slots[i];
    if (!s) return null;
    const k = Math.min(n, s.count);
    s.count -= k;
    const out: Slot = s.dur !== undefined ? { id: s.id, count: k, dur: s.dur } : { id: s.id, count: k };
    if (s.count <= 0) this.slots[i] = null;
    this.emit();
    return out;
  }

  /** Swap two slots, or merge when both hold the same stackable item. */
  move(from: number, to: number) {
    if (from === to) return;
    const a = this.slots[from], b = this.slots[to];
    if (a && b && a.id === b.id) {
      const room = ITEMS[a.id].stack - b.count;
      const n = Math.min(room, a.count);
      b.count += n; a.count -= n;
      if (a.count <= 0) this.slots[from] = null;
    } else {
      this.slots[from] = b; this.slots[to] = a;
    }
    this.emit();
  }

  /** Wears the tool in slot `i` by one use. Returns true if it just broke. */
  wear(i: number, amount = 1): boolean {
    const s = this.slots[i];
    if (!s || s.dur === undefined) return false;
    s.dur -= amount;
    if (s.dur <= 0) {
      // a stack wears one item at a time: lose a single one and start the next at full strength
      if (s.count > 1) { s.count -= 1; s.dur = ITEMS[s.id].dur ?? 1; } else this.slots[i] = null;
      this.emit(); return true;
    }
    this.emit();
    return false;
  }

  clear() { this.slots.fill(null); this.emit(); }
}

