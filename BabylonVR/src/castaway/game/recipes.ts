import type { ItemId } from './items';
import type { Inventory } from './inventory';

export interface Recipe {
  out: ItemId;
  count: number;
  cost: [ItemId, number][];
  /** needs a workbench within reach */
  bench?: boolean;
  group: 'tools' | 'build' | 'furniture' | 'armor' | 'food';
  /** a cost item that other items can stand in for ("any raw meat"), with the label shown for it */
  subs?: Partial<Record<ItemId, { alts: ItemId[]; label: string }>>;
}

/** how far a workbench's crafting reaches (m): a whole house round it */
export const BENCH_REACH = 14;

export const RECIPES: Recipe[] = [
  // by hand: the bare essentials for surviving the first days
  { group: 'tools', out: 'hatchet', count: 1, cost: [['wood', 15], ['stone', 10], ['fiber', 5]] },
  { group: 'tools', out: 'pickaxe', count: 1, cost: [['wood', 15], ['stone', 15], ['fiber', 5]] },
  { group: 'tools', out: 'spear', count: 1, cost: [['wood', 12], ['stone', 8], ['fiber', 6]] },
  { group: 'tools', out: 'fishing_rod', count: 1, cost: [['wood', 10], ['fiber', 16]] },
  { group: 'food', out: 'meat_stick', count: 1, cost: [['raw_meat', 1], ['wood', 1]], subs: { raw_meat: { alts: ['raw_fish'], label: 'Raw Meat or Fish' } } },
  { group: 'build', out: 'torch', count: 2, cost: [['wood', 4], ['fiber', 3]] },
  { group: 'build', out: 'campfire', count: 1, cost: [['wood', 15], ['stone', 5]] },
  { group: 'build', out: 'building_plan', count: 1, cost: [['wood', 20], ['fiber', 5]] },
  { group: 'build', out: 'workbench', count: 1, cost: [['wood', 40], ['stone', 20], ['fiber', 10]] },
  { group: 'furniture', out: 'sleeping_bag', count: 1, cost: [['fiber', 25]] },
  { group: 'furniture', out: 'picture_frame', count: 1, cost: [['wood', 6], ['fiber', 4]] },
  { group: 'furniture', out: 'flower_pot', count: 1, cost: [['stone', 6], ['fiber', 2]] },
  { group: 'furniture', out: 'rug', count: 1, bench: true, cost: [['fiber', 30]] },
  { group: 'furniture', out: 'table', count: 1, bench: true, cost: [['wood', 12]] },
  { group: 'furniture', out: 'lounger', count: 1, bench: true, cost: [['wood', 18], ['fiber', 12]] },
  { group: 'furniture', out: 'cat_bed', count: 1, bench: true, cost: [['fiber', 20], ['leather', 1]] },
  { group: 'furniture', out: 'guitar', count: 1, bench: true, cost: [['wood', 20], ['fiber', 12]] },
  { group: 'furniture', out: 'lantern', count: 1, bench: true, cost: [['metal', 2], ['wood', 4], ['fiber', 2]] },
  { group: 'build', out: 'door', count: 1, bench: true, cost: [['wood', 14], ['fiber', 4]] },
  { group: 'build', out: 'boat', count: 1, bench: true, cost: [['wood', 100], ['fiber', 40], ['metal', 4]] },
  // a building plan needs no workbench (build your house first); the workbench unlocks storage, furnaces, metal tools and armor
  { group: 'build', out: 'furnace', count: 1, bench: true, cost: [['stone', 40], ['wood', 15]] },
  { group: 'furniture', out: 'bed', count: 1, bench: true, cost: [['wood', 30], ['fiber', 30]] },
  { group: 'furniture', out: 'box', count: 1, bench: true, cost: [['wood', 25], ['fiber', 4]] },
  { group: 'tools', out: 'metal_hatchet', count: 1, bench: true, cost: [['wood', 10], ['metal', 12], ['fiber', 5]] },
  { group: 'tools', out: 'metal_pickaxe', count: 1, bench: true, cost: [['wood', 10], ['metal', 18], ['fiber', 5]] },
  { group: 'tools', out: 'diamond_pickaxe', count: 1, bench: true, cost: [['diamond', 3], ['metal', 10], ['wood', 10]] },
  { group: 'armor', out: 'leather_cap', count: 1, bench: true, cost: [['leather', 4], ['fiber', 4]] },
  { group: 'armor', out: 'leather_vest', count: 1, bench: true, cost: [['leather', 8], ['fiber', 6]] },
  { group: 'armor', out: 'leather_pants', count: 1, bench: true, cost: [['leather', 6], ['fiber', 5]] },
  { group: 'armor', out: 'metal_helmet', count: 1, bench: true, cost: [['metal', 10], ['leather', 2]] },
  { group: 'armor', out: 'metal_chestplate', count: 1, bench: true, cost: [['metal', 20], ['leather', 4]] },
  { group: 'armor', out: 'metal_greaves', count: 1, bench: true, cost: [['metal', 14], ['leather', 3]] },
  { group: 'armor', out: 'diamond_helmet', count: 1, bench: true, cost: [['diamond', 4], ['metal', 6]] },
  { group: 'armor', out: 'diamond_chestplate', count: 1, bench: true, cost: [['diamond', 8], ['metal', 10]] },
  { group: 'armor', out: 'diamond_greaves', count: 1, bench: true, cost: [['diamond', 6], ['metal', 8]] },
];

export const GROUP_LABEL: Record<Recipe['group'], string> = { tools: 'Tools', build: 'Stations & building', furniture: 'Furniture', armor: 'Armor', food: 'Food' };

/** Items a station turns into other items while it burns. `time` is seconds per item. */
export interface Smelt { from: ItemId; to: ItemId; time: number }
export const STATION_RECIPES: Record<'campfire' | 'furnace', Smelt[]> = {
  campfire: [
    { from: 'coconut', to: 'roasted_coconut', time: 8 },
    { from: 'raw_meat', to: 'cooked_meat', time: 10 },
    { from: 'raw_fish', to: 'cooked_fish', time: 7 },
  ],
  furnace: [{ from: 'metal_ore', to: 'metal', time: 5 }],
};
/** how long one piece of wood burns, per station (seconds) */
export const WOOD_BURN: Record<'campfire' | 'furnace', number> = { campfire: 60, furnace: 36 };
export const MAX_FUEL = 600;
/** coal burns 2.5x longer than wood */
export const COAL_BURN = 2.5;

/** how many of a cost item you have, counting the items that may stand in for it */
export function costHave(inv: Inventory, r: Recipe, id: ItemId): number {
  return inv.count(id) + (r.subs?.[id]?.alts ?? []).reduce((a, s) => a + inv.count(s), 0);
}

/** the name shown for a cost item */
export function costLabel(r: Recipe, id: ItemId, name: string): string { return r.subs?.[id]?.label ?? name; }

export function canAfford(inv: Inventory, r: Recipe): boolean {
  return r.cost.every(([id, n]) => costHave(inv, r, id) >= n);
}

/** Pays for and produces the recipe. Returns false (and changes nothing) if it can't. */
export function craft(inv: Inventory, r: Recipe): boolean {
  if (!canAfford(inv, r)) return false;
  const paid: [ItemId, number][] = [];
  for (const [id, n] of r.cost) {
    let need = n;
    for (const k of [id, ...(r.subs?.[id]?.alts ?? [])]) {
      const take = Math.min(need, inv.count(k));
      if (take > 0) { inv.remove(k, take); paid.push([k, take]); need -= take; }
      if (need <= 0) break;
    }
  }
  const left = inv.add(r.out, r.count);
  if (left > 0) {
    inv.remove(r.out, r.count - left);
    for (const [id, n] of paid) inv.add(id, n);
    return false;
  }
  return true;
}
