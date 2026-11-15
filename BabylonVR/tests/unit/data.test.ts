// The game's data tables: every recipe's ingredients and products exist, and outfits from older versions still read.
import { describe, expect, it } from "vitest";
import { ITEMS, type ItemId } from "../../src/castaway/game/items";
import { RECIPES, STATION_RECIPES } from "../../src/castaway/game/recipes";
import { parseOutfit, SLOTS, outfitFor, lookFromOutfit } from "../../src/castaway/net/outfit";

describe("recipes", () => {
  it("make and use only items that exist", () => {
    for (const r of RECIPES) {
      expect(ITEMS[r.out], `recipe output ${r.out}`).toBeDefined();
      for (const [id, n] of r.cost) { expect(ITEMS[id as ItemId], `ingredient ${id} of ${r.out}`).toBeDefined(); expect(n).toBeGreaterThan(0); }
    }
    for (const list of Object.values(STATION_RECIPES)) for (const s of list) { expect(ITEMS[s.from]).toBeDefined(); expect(ITEMS[s.to]).toBeDefined(); }
  });
  it("every item has a name and an icon", () => {
    for (const [id, d] of Object.entries(ITEMS)) { expect(d.name, id).toBeTruthy(); expect(d.icon, id).toBeTruthy(); }
  });
});

describe("outfits", () => {
  it("reads a current outfit", () => { const o = SLOTS.map(() => 0); expect(parseOutfit(o)).toEqual(o); });
  it("reads a 7-number outfit from before the Body and Beard slots (classic, full beard)", () => {
    expect(parseOutfit([1, 2, 3, 0, 4, 1, 2])).toEqual([1, 2, 3, 0, 4, 1, 2, 0, 0]);
  });
  it("refuses nonsense", () => {
    expect(parseOutfit("x")).toBeNull();
    expect(parseOutfit([1, 2])).toBeNull();
    expect(parseOutfit(SLOTS.map((s) => s.n))).toBeNull();       // each one past its last choice
    expect(parseOutfit(SLOTS.map(() => 0.5))).toBeNull();
  });
  it("a random outfit is always valid and makes a look", () => {
    for (let id = 0; id < 200; id++) { const o = outfitFor(id); expect(parseOutfit(o)).toEqual(o); expect(lookFromOutfit(o, id).skin).toMatch(/^#/); }
  });
  it("the Body slot picks Bora", () => {
    const o = SLOTS.map(() => 0); o[7] = 1; expect(lookFromOutfit(o).bora).toBe(true);
  });
});
