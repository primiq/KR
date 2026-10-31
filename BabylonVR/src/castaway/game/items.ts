import { FLOWERS } from '../world/flowerKinds';
// Item definitions. Recipes live in recipes.ts; placeable items become structures (structures.ts / building.ts).
export type ItemId =
  | 'rock' | 'hatchet' | 'pickaxe' | 'metal_hatchet' | 'metal_pickaxe' | 'diamond_pickaxe'
  | 'wood' | 'stone' | 'metal_ore' | 'metal' | 'fiber' | 'coal' | 'diamond'
  | 'coconut' | 'berries' | 'roasted_coconut' | 'turtle_egg'
  | 'flower_daisy' | 'flower_poppy' | 'flower_bluebell' | 'flower_sunflower' | 'flower_hibiscus' | 'flower_lavender' | 'flower_orchid' | 'flower_paradise'
  | 'spear' | 'fishing_rod' | 'raw_meat' | 'cooked_meat' | 'raw_fish' | 'cooked_fish'
  | 'campfire' | 'furnace' | 'workbench' | 'bed' | 'sleeping_bag' | 'box'
  | 'building_plan' | 'torch' | 'sapling' | 'picture_frame' | 'flower_pot' | 'rug' | 'lantern' | 'door'
  | 'leather' | 'leather_cap' | 'leather_vest' | 'leather_pants' | 'metal_helmet' | 'metal_chestplate' | 'metal_greaves'
  | 'diamond_helmet' | 'diamond_chestplate' | 'diamond_greaves' | 'boat' | 'table' | 'cat_bed' | 'lounger' | 'drum' | 'drumsticks'
  | 'meat_stick' | 'roast_stick' | 'guitar';
export type ArmorSlot = 'head' | 'chest' | 'legs';
export const ARMOR_SLOTS: ArmorSlot[] = ['head', 'chest', 'legs'];
export const ARMOR_SLOT_LABEL: Record<ArmorSlot, string> = { head: 'Head', chest: 'Chest', legs: 'Legs' };
export type PlaceKind = 'campfire' | 'furnace' | 'workbench' | 'bed' | 'sleeping_bag' | 'box' | 'torch' | 'flower_pot' | 'rug' | 'lantern' | 'table' | 'cat_bed' | 'lounger' | 'drum';
export type GatherKind = 'wood' | 'stone' | 'ore';
export type ItemKind = 'resource' | 'tool' | 'food' | 'placeable' | 'plan' | 'armor' | 'seed';

export interface ItemDef {
  id: ItemId;
  name: string;
  desc: string;
  stack: number;
  kind: ItemKind;
  icon: string;
  /** hits (or casts) before it breaks; omitted = never wears out */
  dur?: number;
  tool?: { reach: number; gather: Partial<Record<GatherKind, number>>; model: 'rock' | 'hatchet' | 'pickaxe' | 'spear' | 'rod'; dmg: number };
  place?: PlaceKind;
  /** worn in one of the three armor slots; `def` is the percentage of attack damage it absorbs */
  armor?: { slot: ArmorSlot; tier: 1 | 2 | 3; def: number };
  food?: { hunger: number; thirst: number; health?: number };
  /** a flower (index into FLOWERS): click the ground to plant it */
  flower?: number;
  /** a picture frame: hangs on a wall */
  frame?: boolean;
  /** a boat: goes on the water */
  boat?: boolean;
  /** raw food on a stick: hold its end over a burning campfire to roast it into this item */
  roast?: ItemId;
  /** a musical instrument: strum it */
  instrument?: boolean;
}

const svg = (inner: string) => `<svg viewBox="0 0 32 32" aria-hidden="true">${inner}</svg>`;

export const ITEMS = {
  rock: {
    id: 'rock', name: 'Rock', stack: 1, kind: 'tool',
    desc: 'A fist-sized stone. Slow, but it gets wood, stone and ore until you can make better tools.',
    icon: svg('<path d="M5 21 8 11l8-5 9 3 3 10-7 7H10z" fill="#8e8a82"/><path d="M8 11l8-5 2 7-6 4z" fill="#b9b5ab"/><path d="M18 13l7-4 3 10-8 2z" fill="#7a766e"/>'),
    tool: { reach: 2.7, gather: { wood: 3, stone: 6, ore: 3 }, model: 'rock', dmg: 8 },
    // no `dur`: your first rock never wears out or breaks
  },
  hatchet: {
    id: 'hatchet', name: 'Hatchet', stack: 1, kind: 'tool',
    desc: 'Chops wood much faster than a rock, though a tree still takes a good few swings.',
    icon: svg('<rect x="14" y="5" width="4" height="23" rx="2" fill="#8b5e34" transform="rotate(35 16 16)"/><path d="M5 9c5-4 11-3 14 1l-3 5c-4-1-8-1-11 1z" fill="#a9afb5"/><path d="M5 9c5-4 11-3 14 1" stroke="#e3e7ea" stroke-width="1.6" fill="none"/>'),
    tool: { reach: 2.9, gather: { wood: 10, stone: 3, ore: 1 }, model: 'hatchet', dmg: 22 },
    dur: 130,
  },
  pickaxe: {
    id: 'pickaxe', name: 'Pickaxe', stack: 1, kind: 'tool',
    desc: 'Breaks stone and ore quickly.',
    icon: svg('<rect x="14" y="6" width="4" height="23" rx="2" fill="#8b5e34" transform="rotate(35 16 16)"/><path d="M3 15C9 5 22 4 29 11c-8-3-15-2-26 4z" fill="#a9afb5"/><path d="M3 15C9 5 22 4 29 11" stroke="#e3e7ea" stroke-width="1.5" fill="none"/>'),
    tool: { reach: 2.9, gather: { wood: 3, stone: 24, ore: 12 }, model: 'pickaxe', dmg: 18 },
    dur: 130,
  },
  metal_hatchet: {
    id: 'metal_hatchet', name: 'Metal Hatchet', stack: 1, kind: 'tool',
    desc: 'A proper axe. Fells trees almost twice as fast as the stone hatchet.',
    icon: svg('<rect x="14" y="5" width="4" height="23" rx="2" fill="#8b5e34" transform="rotate(35 16 16)"/><path d="M5 9c5-4 11-3 14 1l-3 5c-4-1-8-1-11 1z" fill="#d9dee3"/><path d="M5 9c5-4 11-3 14 1" stroke="#ffffff" stroke-width="1.6" fill="none"/><path d="M8 13l8 .5" stroke="#8fa0ad" stroke-width="1.2"/>'),
    tool: { reach: 3.0, gather: { wood: 18, stone: 5, ore: 2 }, model: 'hatchet', dmg: 34 },
    dur: 340,
  },
  metal_pickaxe: {
    id: 'metal_pickaxe', name: 'Metal Pickaxe', stack: 1, kind: 'tool',
    desc: 'Cuts through stone and ore at twice the speed of the stone pickaxe.',
    icon: svg('<rect x="14" y="6" width="4" height="23" rx="2" fill="#8b5e34" transform="rotate(35 16 16)"/><path d="M3 15C9 5 22 4 29 11c-8-3-15-2-26 4z" fill="#d9dee3"/><path d="M3 15C9 5 22 4 29 11" stroke="#ffffff" stroke-width="1.5" fill="none"/>'),
    tool: { reach: 3.0, gather: { wood: 4, stone: 44, ore: 24 }, model: 'pickaxe', dmg: 28 },
    dur: 340,
  },
  diamond_pickaxe: {
    id: 'diamond_pickaxe', name: 'Diamond Pickaxe', stack: 1, kind: 'tool',
    desc: 'Tears through rock and ore faster than anything else, and lasts a very long time.',
    icon: svg('<rect x="14" y="6" width="4" height="23" rx="2" fill="#8b5e34" transform="rotate(35 16 16)"/><path d="M3 15C9 5 22 4 29 11c-8-3-15-2-26 4z" fill="#5fe3f2"/><path d="M3 15C9 5 22 4 29 11" stroke="#d8fbff" stroke-width="1.5" fill="none"/><path d="M12 9l3 2" stroke="#fff" stroke-width="1.2"/>'),
    tool: { reach: 3.1, gather: { wood: 5, stone: 70, ore: 40 }, model: 'pickaxe', dmg: 36 },
    dur: 900,
  },
  wood: {
    id: 'wood', name: 'Wood', stack: 1000, kind: 'resource',
    desc: 'Used for tools, fires, beds and buildings.',
    icon: svg('<g transform="rotate(-30 16 16)"><rect x="4" y="10" width="22" height="12" rx="3" fill="#8b5e34"/><ellipse cx="26" cy="16" rx="3.4" ry="6" fill="#dbb67f"/><ellipse cx="26" cy="16" rx="1.4" ry="2.6" fill="#b88a55"/><path d="M8 14h13M8 19h13" stroke="#5f3b1d" stroke-width="1.2"/></g>'),
  },
  stone: {
    id: 'stone', name: 'Stone', stack: 1000, kind: 'resource',
    desc: 'Used for tools, furnaces and foundations. Hold one in your hand and you can bash wood, stone and ore with it, slowly (each stone lasts ~40 swings).',
    tool: { reach: 2.6, gather: { wood: 2, stone: 4, ore: 2 }, model: 'rock', dmg: 6 },
    dur: 40, // each stone chips away after 40 uses; only that one stone is lost, never the whole stack
    icon: svg('<path d="M4 22 7 12l9-6 10 4 3 11-8 7H10z" fill="#9b9a94"/><path d="M7 12l9-6 2 8-7 4z" fill="#c4c3bc"/><path d="M18 14l8-4 3 11-9 3z" fill="#84837d"/>'),
  },
  metal_ore: {
    id: 'metal_ore', name: 'Metal Ore', stack: 1000, kind: 'resource',
    desc: 'Raw ore. Smelt it in a furnace to get metal.',
    icon: svg('<path d="M4 22 7 12l9-6 10 4 3 11-8 7H10z" fill="#5d5249"/><path d="M7 12l9-6 2 8-7 4z" fill="#7a6c60"/><circle cx="20" cy="17" r="2.6" fill="#e0893f"/><circle cx="12" cy="20" r="2" fill="#f0a65a"/><circle cx="22" cy="23" r="1.6" fill="#c46e2c"/>'),
  },
  metal: {
    id: 'metal', name: 'Metal', stack: 1000, kind: 'resource',
    desc: 'Smelted metal. Used for tools and, later, weapons and fittings.',
    icon: svg('<path d="M4 20l5-9h17l3 9z" fill="#cfd5da"/><path d="M4 20h25v5H4z" fill="#8e99a2"/><path d="M9 11h17l-2 3H7z" fill="#f2f5f7"/><path d="M4 20h25" stroke="#6e7a84" stroke-width="1"/>'),
  },
  coal: {
    id: 'coal', name: 'Coal', stack: 1000, kind: 'resource',
    desc: 'Black rock that burns hot and long. Feed it to a campfire or furnace.',
    icon: svg('<path d="M4 22 7 12l9-6 10 4 3 11-8 7H10z" fill="#1d1e22"/><path d="M7 12l9-6 2 8-7 4z" fill="#3a3d45"/><path d="M18 14l8-4 3 11-9 3z" fill="#101114"/><path d="M12 10l3-2" stroke="#8a90a0" stroke-width="1.4"/>'),
  },
  diamond: {
    id: 'diamond', name: 'Diamond', stack: 100, kind: 'resource',
    desc: 'A flawless gem from deep underground. Craft a diamond pickaxe at a workbench.',
    icon: svg('<path d="M8 12 12 6h8l4 6-8 15z" fill="#6feeff"/><path d="M8 12h16L16 27z" fill="#a8f6ff"/><path d="M12 6l4 6 4-6" fill="#e4fdff"/><path d="M8 12h16M16 12v15" stroke="#3fc5d8" stroke-width="1"/>'),
  },
  fiber: {
    id: 'fiber', name: 'Plant Fiber', stack: 1000, kind: 'resource',
    desc: 'Tough strands from palm fronds and bushes. Binds tools and makes cloth.',
    icon: svg('<g stroke-linecap="round" fill="none"><path d="M9 28C8 18 12 9 16 4" stroke="#a8bd5a" stroke-width="2.6"/><path d="M14 28c0-9 2-16 5-22" stroke="#c4d37a" stroke-width="2.6"/><path d="M20 28c0-9 3-15 8-19" stroke="#8fa748" stroke-width="2.6"/><path d="M6 21h22" stroke="#7a5a30" stroke-width="3"/></g>'),
  },
  coconut: {
    id: 'coconut', name: 'Coconut', stack: 10, kind: 'food',
    desc: 'Sweet water and a little food.',
    icon: svg('<circle cx="16" cy="17" r="11" fill="#6b4a2c"/><path d="M8 11c3-4 11-5 16-1-5-1-11 0-16 1z" fill="#8a6540"/><circle cx="12.5" cy="15" r="1.6" fill="#2b1a0c"/><circle cx="18" cy="14" r="1.6" fill="#2b1a0c"/><circle cx="15.5" cy="19.5" r="1.6" fill="#2b1a0c"/>'),
    food: { hunger: 10, thirst: 18 },
  },
  berries: {
    id: 'berries', name: 'Berries', stack: 20, kind: 'food',
    desc: 'Small, sweet, and not very filling.',
    icon: svg('<path d="M16 6c1 3 4 4 7 4-1 3-4 4-7 3z" fill="#4c9a2e"/><circle cx="11" cy="21" r="5.6" fill="#d0243d"/><circle cx="21" cy="20" r="5.6" fill="#e03349"/><circle cx="16" cy="13" r="5.2" fill="#b81b32"/><circle cx="9.5" cy="19.5" r="1.4" fill="#ff9aa8"/><circle cx="19.5" cy="18.5" r="1.4" fill="#ff9aa8"/>'),
    food: { hunger: 6, thirst: 3 },
  },
  roasted_coconut: {
    id: 'roasted_coconut', name: 'Roasted Coconut', stack: 10, kind: 'food',
    desc: 'Cooked over a fire. Much more filling than a raw one.',
    icon: svg('<path d="M5 17a11 11 0 0 1 22 0z" fill="#a0642c"/><path d="M5 17h22l-2 4a11 11 0 0 1-18 0z" fill="#f1e6cf"/><path d="M8 17h16" stroke="#7a4a1c" stroke-width="1.5"/><path d="M10 9c2-3 8-3 12 0" stroke="#d98a3a" stroke-width="1.6" fill="none"/>'),
    food: { hunger: 26, thirst: 8 },
  },
  turtle_egg: {
    id: 'turtle_egg', name: 'Turtle Egg', stack: 20, kind: 'food',
    desc: 'Soft-shelled and the size of a ping-pong ball. Leave the nest alone and it hatches by the next tide.',
    icon: svg('<ellipse cx="11" cy="20" rx="6.5" ry="6" fill="#f4efe2"/><ellipse cx="21" cy="19" rx="6.5" ry="6" fill="#ebe4d2"/><ellipse cx="16" cy="12" rx="6.5" ry="6" fill="#fbf7ec"/><path d="M4 27c6-2 18-2 24 0" stroke="#d8bf88" stroke-width="2.4" stroke-linecap="round"/><circle cx="14" cy="10" r="1.6" fill="#fff"/>'),
    food: { hunger: 7, thirst: 3 },
  },
  spear: {
    id: 'spear', name: 'Spear', stack: 1, kind: 'tool', dur: 90,
    desc: 'A sharpened shaft with a stone point. The best way to deal with boars and cats.',
    icon: svg('<rect x="15" y="3" width="2.4" height="27" rx="1.2" fill="#8b5e34" transform="rotate(38 16 16)"/><path d="M23 3l6-1-1 6-4 4-4-4z" fill="#b8bcc0" transform="rotate(0)"/><path d="M23 3l6-1-1 6" stroke="#eef0f2" stroke-width="1.2" fill="none"/><path d="M19 8l3 3" stroke="#b5a560" stroke-width="2"/>'),
    tool: { reach: 3.5, gather: { wood: 3, stone: 1 }, model: 'spear', dmg: 40 },
  },
  fishing_rod: {
    id: 'fishing_rod', name: 'Fishing Rod', stack: 1, kind: 'tool', dur: 60,
    desc: 'Face open water, click to cast, then click again the moment the float dips.',
    icon: svg('<path d="M5 28 26 5" stroke="#8b5e34" stroke-width="2.6" stroke-linecap="round"/><path d="M26 5c4 3 3 10 1 15" stroke="#e8e8e8" stroke-width="1" fill="none"/><circle cx="27" cy="22" r="2.6" fill="#e03349"/><circle cx="27" cy="21" r="1.2" fill="#fff"/><circle cx="10" cy="22" r="2.6" fill="#7a7f85"/>'),
    tool: { reach: 3, gather: {}, model: 'rod', dmg: 4 },
  },
  raw_meat: {
    id: 'raw_meat', name: 'Raw Meat', stack: 20, kind: 'food',
    desc: 'Edible, but eating it raw makes you queasy. Cook it on a campfire.',
    icon: svg('<path d="M6 17c0-7 6-11 13-10 6 1 9 6 7 12-2 6-9 8-14 6-4-2-6-4-6-8z" fill="#c9444f"/><path d="M10 14c3-4 8-4 11-1" stroke="#f1a0a8" stroke-width="2" fill="none"/><circle cx="21" cy="19" r="3" fill="#f4e3d6"/>'),
    food: { hunger: 14, thirst: -4, health: -5 },
  },
  cooked_meat: {
    id: 'cooked_meat', name: 'Cooked Meat', stack: 20, kind: 'food',
    desc: 'Seared over the fire. Filling and good for you.',
    icon: svg('<path d="M6 17c0-7 6-11 13-10 6 1 9 6 7 12-2 6-9 8-14 6-4-2-6-4-6-8z" fill="#8a4a24"/><path d="M10 14c3-4 8-4 11-1" stroke="#c98a52" stroke-width="2" fill="none"/><path d="M9 20c3 3 9 3 13-1" stroke="#5a2c12" stroke-width="1.6" fill="none"/><circle cx="21" cy="19" r="3" fill="#f1e6cf"/>'),
    food: { hunger: 42, thirst: -3, health: 5 },
  },
  raw_fish: {
    id: 'raw_fish', name: 'Raw Fish', stack: 20, kind: 'food',
    desc: 'Fresh from the sea. Better cooked.',
    icon: svg('<path d="M3 16c5-7 14-9 21-2l5-4v12l-5-4c-7 7-16 5-21-2z" fill="#6fa8c9"/><path d="M6 16c5-5 12-6 18-1" stroke="#c9e4f2" stroke-width="2" fill="none"/><circle cx="9" cy="14.5" r="1.4" fill="#10232d"/><path d="M13 12c1 3 1 6 0 9" stroke="#4a85a8" stroke-width="1.4" fill="none"/>'),
    food: { hunger: 12, thirst: 0, health: -2 },
  },
  cooked_fish: {
    id: 'cooked_fish', name: 'Cooked Fish', stack: 20, kind: 'food',
    desc: 'Flaky and delicious.',
    icon: svg('<path d="M3 16c5-7 14-9 21-2l5-4v12l-5-4c-7 7-16 5-21-2z" fill="#c98a4e"/><path d="M6 16c5-5 12-6 18-1" stroke="#f0c98a" stroke-width="2" fill="none"/><circle cx="9" cy="14.5" r="1.4" fill="#3a1f0c"/><path d="M13 12c1 3 1 6 0 9M17 11c1 4 1 7 0 10" stroke="#8a5528" stroke-width="1.3" fill="none"/>'),
    food: { hunger: 32, thirst: 2, health: 7 },
  },
  meat_stick: {
    id: 'meat_stick', name: 'Meat on a Stick', stack: 5, kind: 'resource', roast: 'roast_stick',
    desc: 'Raw meat skewered on a stick. Hold the end over a burning campfire until it is roasted, then eat it.',
    icon: svg('<path d="M4 29 24 9" stroke="#8b5e34" stroke-width="2.4" stroke-linecap="round"/><ellipse cx="22" cy="11" rx="7" ry="5" transform="rotate(-45 22 11)" fill="#c9444f"/><path d="M18 11c2-3 5-4 7-3" stroke="#f1a0a8" stroke-width="1.6" fill="none"/><path d="M27 6l2-2" stroke="#8b5e34" stroke-width="2" stroke-linecap="round"/>'),
  },
  roast_stick: {
    id: 'roast_stick', name: 'Roasted Meat on a Stick', stack: 5, kind: 'food',
    desc: 'Roasted right over the flames. Smoky, hot and very filling.',
    icon: svg('<path d="M4 29 24 9" stroke="#6b4a2c" stroke-width="2.4" stroke-linecap="round"/><ellipse cx="22" cy="11" rx="7" ry="5" transform="rotate(-45 22 11)" fill="#7a3f1e"/><path d="M18 11c2-3 5-4 7-3" stroke="#c98a52" stroke-width="1.6" fill="none"/><path d="M17 15l2-1M20 16l2-2M23 14l1-2" stroke="#3a1c0c" stroke-width="1.2"/><path d="M27 6l2-2" stroke="#6b4a2c" stroke-width="2" stroke-linecap="round"/>'),
    food: { hunger: 48, thirst: -2, health: 8 },
  },
  guitar: {
    id: 'guitar', name: 'Guitar', stack: 1, kind: 'resource', instrument: true,
    desc: 'A little wooden guitar with fibre strings. Click to strum, R to change chord. In VR: hold the neck in your left hand and strum the strings with your right; the left thumbstick and trigger pick the chord.',
    icon: svg('<path d="M17 3l3 3-6 8" stroke="#5a3a1e" stroke-width="3" stroke-linecap="round" fill="none"/><path d="M15 12c-4-1-7 1-7 4 0 2 1 3 0 5-2 3 0 7 4 7 3 0 4-2 6-3 3-1 5 0 6-3 1-3-1-5-3-6-2-1-2-3-6-4z" fill="#d08a43"/><circle cx="14" cy="19" r="2.4" fill="#3a2414"/><path d="M19 7 9 23" stroke="#f3ead6" stroke-width=".7"/><path d="M10 24l3 2" stroke="#5a3a1e" stroke-width="1.6"/>'),
  },
  campfire: {
    id: 'campfire', name: 'Campfire', stack: 5, kind: 'placeable', place: 'campfire',
    desc: 'Light and warmth at night. Cooks food. Feed it wood to keep it burning.',
    icon: svg('<rect x="3" y="23" width="26" height="4" rx="2" fill="#7a5230" transform="rotate(-12 16 25)"/><rect x="3" y="23" width="26" height="4" rx="2" fill="#8b5e34" transform="rotate(12 16 25)"/><path d="M16 4c2 5 7 8 7 14a7 7 0 0 1-14 0c0-3 2-4 3-7 1 2 2 2 2 0 1-3 1-5 2-7z" fill="#f08a24"/><path d="M16 14c1 3 4 4 4 8a4 4 0 0 1-8 0c0-2 1-3 2-4z" fill="#ffd24d"/>'),
  },
  furnace: {
    id: 'furnace', name: 'Furnace', stack: 5, kind: 'placeable', place: 'furnace',
    desc: 'Smelts metal ore into metal. Needs wood as fuel.',
    icon: svg('<path d="M6 28V13c0-6 4-9 10-9s10 3 10 9v15z" fill="#8b8982"/><path d="M6 28V13c0-6 4-9 10-9" stroke="#b3b1a9" stroke-width="2" fill="none"/><path d="M11 28v-6c0-3 2-5 5-5s5 2 5 5v6z" fill="#2a2522"/><path d="M13 28v-4c0-2 1-3 3-3s3 1 3 3v4z" fill="#f08a24"/><rect x="13" y="3" width="6" height="5" fill="#6d6b64"/>'),
  },
  workbench: {
    id: 'workbench', name: 'Workbench', stack: 5, kind: 'placeable', place: 'workbench',
    desc: 'Craft better tools while standing near it.',
    icon: svg('<rect x="3" y="11" width="26" height="5" rx="1" fill="#b98a52"/><rect x="3" y="11" width="26" height="1.6" fill="#d6aa6e"/><rect x="5" y="16" width="3.5" height="12" fill="#8b5e34"/><rect x="23.5" y="16" width="3.5" height="12" fill="#8b5e34"/><rect x="8" y="19" width="16" height="2" fill="#7a5230"/><rect x="21" y="5" width="2.5" height="6" fill="#6b4a2c"/><rect x="18.5" y="4" width="7.5" height="3" rx="1" fill="#a9afb5"/>'),
  },
  bed: {
    id: 'bed', name: 'Bed', stack: 5, kind: 'placeable', place: 'bed',
    desc: 'Sets your respawn point. Sleep in it at night to skip to morning.',
    icon: svg('<rect x="2" y="19" width="28" height="6" rx="1.5" fill="#8b5e34"/><rect x="2" y="12" width="4" height="15" rx="1" fill="#6f4a28"/><rect x="5" y="14" width="23" height="6" rx="2.5" fill="#e9e3cf"/><rect x="6" y="11.5" width="8" height="5" rx="2.5" fill="#fffaf0"/><rect x="14" y="15" width="14" height="5" rx="2" fill="#4a8f9e"/>'),
  },
  sleeping_bag: {
    id: 'sleeping_bag', name: 'Sleeping Bag', stack: 5, kind: 'placeable', place: 'sleeping_bag',
    desc: 'Woven from plant fibre. Roll it out, set your respawn point and sleep through the night. Not as restful as a bed.',
    icon: svg('<rect x="3" y="14" width="26" height="11" rx="5.5" fill="#4f8f7a"/><rect x="3" y="14" width="26" height="4" rx="2" fill="#6fb39a"/><circle cx="7" cy="19.5" r="5" fill="#e9e3cf"/><circle cx="7" cy="19.5" r="2.6" fill="#cdbf96"/><path d="M14 15v10M20 15v10" stroke="#3b6e5d" stroke-width="1.4"/><rect x="12.5" y="13" width="2.6" height="13" rx="1" fill="#b8a470"/>'),
  },
  box: {
    id: 'box', name: 'Storage Box', stack: 5, kind: 'placeable', place: 'box',
    desc: 'A wooden chest with 12 slots. Keep your valuables safe from dying.',
    icon: svg('<rect x="3" y="11" width="26" height="16" rx="2" fill="#a47a46"/><rect x="3" y="11" width="26" height="6" rx="2" fill="#bd9358"/><path d="M3 17h26" stroke="#6b4a2c" stroke-width="1.5"/><rect x="13" y="15" width="6" height="5" rx="1" fill="#d4d8dc"/><path d="M9 11v16M23 11v16" stroke="#6b4a2c" stroke-width="1.4"/>'),
  },
  torch: {
    id: 'torch', name: 'Torch', stack: 10, kind: 'placeable', place: 'torch',
    desc: 'Hold it to light your way. Press B (Y in VR, the flame button on touch) to switch to placing mode, then click to plant it in the ground. Hold E to pick it back up.',
    icon: svg('<rect x="14.2" y="14" width="3.8" height="16" rx="1.6" fill="#8b5e34" transform="rotate(14 16 22)"/><rect x="12.4" y="12.2" width="7.4" height="5" rx="2" fill="#4a3322" transform="rotate(14 16 14)"/><path d="M17 2c3 4 7 6.5 5.6 11.4a5.6 5.6 0 0 1-11 0c0-3.2 2.2-4.6 3.4-7.4.7 1.8 1.8 2.3 2.3 2.3.8-2.2-.2-4.4-.3-6.3z" fill="#ff8a1f"/><path d="M17 8c2.2 2.6 3.4 4.3 2.6 6.6a3 3 0 0 1-5.6 0c-.6-2 1.6-3.2 3-6.6z" fill="#ffe08a"/>'),
  },
  sapling: {
    id: 'sapling', name: 'Sapling', stack: 10, kind: 'seed',
    desc: 'A young tree that fell out of the one you chopped. Hold it and click on open ground to plant it. It grows through four sizes over about a day, then you can chop it for wood (and more saplings).',
    icon: svg('<path d="M16 29V15" stroke="#7a5230" stroke-width="2.4" stroke-linecap="round"/><path d="M16 17c-5 0-9-3-10-8 5-1 9 1 10 8z" fill="#5fae45"/><path d="M16 14c0-5 3-9 9-10 1 6-3 10-9 10z" fill="#7cc95a"/><path d="M8 29h16" stroke="#6b4a2c" stroke-width="2.2" stroke-linecap="round"/><path d="M10 27c2-2 10-2 12 0" fill="#8a6a44"/>'),
  },
  leather: {
    id: 'leather', name: 'Leather', stack: 20, kind: 'resource',
    desc: 'A cured hide from a boar or jaguar. Craft leather armor at a workbench.',
    icon: svg('<path d="M5 9l6-4 5 2 5-2 6 4-2 7 2 6-7 6H11l-7-6 2-6z" fill="#a8693a"/><path d="M5 9l6-4 5 2 5-2 6 4" stroke="#d9a470" stroke-width="1.6" fill="none"/><path d="M10 14l4 3 4-3M12 21l4 2 4-2" stroke="#6f4424" stroke-width="1.3" fill="none" stroke-dasharray="2 1.6"/>'),
  },
  flower_pot: {
    id: 'flower_pot', name: 'Clay Pot', stack: 5, kind: 'placeable', place: 'flower_pot',
    desc: 'A terracotta pot full of earth. Put it anywhere, floors too, and press E on it to plant one of your flowers in it.',
    icon: svg('<path d="M8 13h16l-2.5 14h-11z" fill="#b5653a"/><path d="M6.5 11h19v4h-19z" fill="#c97a4a"/><path d="M16 11V5" stroke="#4f8a2a" stroke-width="2"/><circle cx="16" cy="5" r="3.4" fill="#ec3f86"/><circle cx="16" cy="5" r="1.3" fill="#f7e24a"/>'),
  },
  rug: {
    id: 'rug', name: 'Rug', stack: 5, kind: 'placeable', place: 'rug',
    desc: 'A woven rug for your floor. Every one comes out with its own pattern. R turns it.',
    icon: svg('<rect x="4" y="8" width="24" height="16" rx="1" fill="#8a2f2a"/><rect x="7" y="11" width="18" height="10" fill="#e8c46a"/><path d="M16 12l4 4-4 4-4-4z" fill="#2f4f6a"/><path d="M4 8v16M28 8v16" stroke="#f3e6cc" stroke-width="2" stroke-dasharray="1.5 1.5"/>'),
  },
  table: {
    id: 'table', name: 'Small Table', stack: 5, kind: 'placeable', place: 'table',
    desc: 'A little round side table. Put a clay pot, a cat bed or a lantern on top of it: hold the thing and aim at the table top.',
    icon: svg('<ellipse cx="16" cy="10" rx="12" ry="4" fill="#a8743f"/><path d="M4 10v2c0 2 5 4 12 4s12-2 12-4v-2" fill="#7a5230"/><path d="M8 15l-2 13M24 15l2 13M16 16v12" stroke="#6a4424" stroke-width="2.4" stroke-linecap="round"/>'),
  },
  drum: {
    id: 'drum', name: 'Drum', stack: 5, kind: 'placeable', place: 'drum',
    desc: 'A big deep drum: a hollowed log with a hide stretched over it. Press E at it to take up the sticks, then hit it: the harder you hit, the louder and deeper it booms. Everyone nearby hears it.',
    icon: svg('<path d="M7 11v13c0 2 4 4 9 4s9-2 9-4V11" fill="#8a5328"/><ellipse cx="16" cy="11" rx="9" ry="4" fill="#e8dcc0"/><path d="M8 13l4 13M24 13l-4 13M16 15v13" stroke="#c9a26a" stroke-width="1.4"/><path d="M22 3l-5 7M27 5l-7 6" stroke="#6a4424" stroke-width="2.2" stroke-linecap="round"/>'),
  },
  drumsticks: {
    id: 'drumsticks', name: 'Drumsticks', stack: 1, kind: 'resource',
    desc: 'For the drum.',
    icon: svg('<path d="M6 27 24 7M10 28 27 11" stroke="#8b5e34" stroke-width="2.4" stroke-linecap="round"/>'),
  },
  lounger: {
    id: 'lounger', name: 'Sun Lounger', stack: 5, kind: 'placeable', place: 'lounger',
    desc: 'A wooden sun lounger with a striped cushion. Put it on the beach or in your house; E lies you down on it, and you can look round while you lie there. Move (or press E) to get up. Best enjoyed side by side, at sunset.',
    icon: svg('<path d="M4 22l10-1 6-9 2 1-5 9 11-1" fill="none" stroke="#8a5a32" stroke-width="2.4" stroke-linejoin="round"/><path d="M6 20.5l9-.8 5.6-8.2" stroke="#e8c46a" stroke-width="3" stroke-linecap="round"/><path d="M15 21.5l11-.9" stroke="#3a86b8" stroke-width="3" stroke-linecap="round"/><path d="M7 23v4M24 22v5" stroke="#6a4424" stroke-width="2"/>'),
  },
  cat_bed: {
    id: 'cat_bed', name: 'Cat Bed', stack: 5, kind: 'placeable', place: 'cat_bed',
    desc: 'A small, soft, round bed. Put it somewhere cosy: now and then one of the island’s cats finds it and curls up on it for a nap.',
    icon: svg('<ellipse cx="16" cy="20" rx="13" ry="7" fill="#c4634f"/><ellipse cx="16" cy="18.5" rx="9.5" ry="4.6" fill="#f0e2c6"/><path d="M8 18c2-3 6-4 9-3 3 1 5 3 4 4" fill="#e39a4a"/><path d="M9 17l1-3 2 2M14 15l1-3 1 3" fill="#e39a4a"/>'),
  },
  lantern: {
    id: 'lantern', name: 'Lantern', stack: 5, kind: 'placeable', place: 'lantern',
    desc: 'A warm light that never goes out. Placed under a roof or an upper floor it hangs from the ceiling on a chain; anywhere else it hangs from its own hook post.',
    icon: svg('<path d="M16 3v4" stroke="#3d4348" stroke-width="2"/><path d="M10 11l6-4 6 4z" fill="#3d4348"/><rect x="11" y="11" width="10" height="13" fill="#ffc46a"/><path d="M11 11v13M21 11v13M16 11v13" stroke="#3d4348" stroke-width="1.6"/><rect x="10" y="24" width="12" height="3" fill="#3d4348"/>'),
  },
  door: {
    id: 'door', name: 'Door', stack: 5, kind: 'resource',
    desc: 'A plank door on hinges. Hold it and click a doorway to hang it; press E to open or close it.',
    icon: svg('<rect x="9" y="4" width="14" height="24" rx="1" fill="#8a5a30"/><path d="M12 6v20M16 6v20M20 6v20" stroke="#6a4424" stroke-width="1.2"/><path d="M9 9h14M9 22h14" stroke="#5a3a1c" stroke-width="2"/><circle cx="20.5" cy="16" r="1.3" fill="#d8b26a"/>'),
  },
  picture_frame: {
    id: 'picture_frame', name: 'Picture Frame', stack: 5, kind: 'resource', frame: true,
    desc: 'A wooden frame with a blank canvas. Hold it and click a plain wall of your house to hang it, then press E on it to paint.',
    icon: svg('<rect x="4" y="6" width="24" height="20" rx="1.5" fill="#8a5a30"/><rect x="7.5" y="9.5" width="17" height="13" fill="#f3eee2"/><path d="M8 21l5-6 4 4 3-3 4 5z" fill="#6fae4a"/><circle cx="20" cy="13" r="2" fill="#f6c21a"/>'),
  },
  boat: {
    id: 'boat', name: 'Boat', stack: 1, kind: 'resource', boat: true,
    desc: 'A wooden sailing boat, big enough to walk about on: a deck with rails, a little cabin with a table and a torch, a mast and two sails. Hold it and click open water to put it in. Press E at the wheel to steer; jump the rail to swim, and press E on the hull to climb back aboard. Don’t sail too far out…',
    icon: svg('<path d="M3 15h26l-4 9c-1 2-2 3-4 3H10c-2 0-3-1-4-3z" fill="#f2efe6"/><path d="M5 21h22l-1.6 3.6c-.8 1.8-2 2.4-3.4 2.4H10c-1.6 0-2.6-.8-3.4-2.4z" fill="#9c3324"/><path d="M4 17.5h24" stroke="#1f3d66" stroke-width="1.6"/><path d="M3 15h26" stroke="#7a5230" stroke-width="1.8"/><rect x="24" y="8" width="4" height="6" rx="1" fill="#2b2f33"/><path d="M26 14v8" stroke="#2b2f33" stroke-width="1.4"/>'),
  },
  building_plan: {
    id: 'building_plan', name: 'Building Plan', stack: 1, kind: 'plan',
    desc: 'Equip it to build foundations, walls, doorways and roofs from wood. Click to place, Q to change piece, R to rotate, E to remove.',
    icon: svg('<rect x="4" y="4" width="24" height="24" rx="2" fill="#3b73a8"/><path d="M4 12h24M4 20h24M12 4v24M20 4v24" stroke="#8fc0ee" stroke-width="1" opacity=".7"/><path d="M8 24V14l8-6 8 6v10z" fill="none" stroke="#ffffff" stroke-width="2"/><path d="M13 24v-6h6v6" stroke="#ffffff" stroke-width="1.8" fill="none"/>'),
  },
} as unknown as Record<ItemId, ItemDef>;


// ---------------------------------------------------------------- armor
type Tier = { name: string; tier: 1 | 2 | 3; main: string; dark: string; hi: string; dur: number; defs: [number, number, number] };
const TIERS: Tier[] = [
  { name: 'Leather', tier: 1, main: '#a8693a', dark: '#6f4424', hi: '#d9a470', dur: 90, defs: [5, 9, 6] },
  { name: 'Metal', tier: 2, main: '#b9c2c9', dark: '#6e7a84', hi: '#eef2f5', dur: 220, defs: [9, 16, 11] },
  { name: 'Diamond', tier: 3, main: '#58dff0', dark: '#1fa3bd', hi: '#c9fbff', dur: 480, defs: [13, 22, 15] },
];
const armorIcon = (slot: ArmorSlot, t: Tier) => slot === 'head'
  ? svg(`<path d="M5 21c0-9 4-15 11-15s11 6 11 15v4H5z" fill="${t.main}"/><path d="M5 21h22v4H5z" fill="${t.dark}"/><path d="M8 17c1-6 4-9 8-9" stroke="${t.hi}" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M13 14h6v11h-6z" fill="${t.dark}" opacity=".55"/>`)
  : slot === 'chest'
  ? svg(`<path d="M9 5l4 2c2 1 4 1 6 0l4-2 6 6-4 5-3-2v14H9V14l-3 2-4-5z" fill="${t.main}"/><path d="M13 7c2 1 4 1 6 0l-3 6z" fill="${t.dark}"/><path d="M9 26h14v2H9z" fill="${t.dark}"/><path d="M10 14v10M22 14v10" stroke="${t.hi}" stroke-width="1.4" opacity=".7"/><path d="M4 11l3-3" stroke="${t.hi}" stroke-width="1.6" stroke-linecap="round"/>`)
  : svg(`<path d="M8 4h16l1 24h-7l-2-14-2 14H7z" fill="${t.main}"/><path d="M8 4h16v4H8z" fill="${t.dark}"/><path d="M11 10v16M21 10v16" stroke="${t.hi}" stroke-width="1.4" opacity=".7"/><path d="M7 24h8M17 24h8" stroke="${t.dark}" stroke-width="2"/>`);
const ARMOR_NAMES: Record<number, [string, string, string]> = { 1: ['Leather Cap', 'Leather Vest', 'Leather Pants'], 2: ['Metal Helmet', 'Metal Chestplate', 'Metal Greaves'], 3: ['Diamond Helmet', 'Diamond Chestplate', 'Diamond Greaves'] };
const ARMOR_IDS: ItemId[][] = [['leather_cap', 'leather_vest', 'leather_pants'], ['metal_helmet', 'metal_chestplate', 'metal_greaves'], ['diamond_helmet', 'diamond_chestplate', 'diamond_greaves']];
const ARMOR_DESC = ['Boiled hide, stitched with fibre. Light and quiet.', 'Beaten from smelted metal. Heavy, and it stops a lot.', 'Cut from flawless underground gems. The best protection on the island.'];
TIERS.forEach((t, ti) => ARMOR_SLOTS.forEach((slot, si) => {
  const id = ARMOR_IDS[ti][si];
  (ITEMS as Record<string, ItemDef>)[id] = {
    id, name: ARMOR_NAMES[t.tier][si], stack: 1, kind: 'armor', icon: armorIcon(slot, t), dur: t.dur,
    desc: `${ARMOR_DESC[ti]} Worn on the ${slot === 'chest' ? 'body' : slot}: absorbs ${t.defs[si]}% of attack damage and wears down each time you are hit.`,
    armor: { slot, tier: t.tier, def: t.defs[si] },
  };
}));
// ---------------------------------------------------------------- flowers
const FLOWER_DESC = [
  'A meadow daisy. Pick them, plant them, make a lawn of them.', 'A bright red poppy that nods in the wind.', 'A little arch of blue bells that likes the shade up the hill.',
  'Taller than a child and always looking for the sun.', 'A big pink trumpet from the jungle edge.', 'Grey-green spikes of purple that smell of summer.',
  'A spray of delicate blooms from the shady uplands.', 'An orange crest on a beak: the showiest flower on the island.',
];
FLOWERS.forEach((f, k) => {
  const petals = Array.from({ length: 6 }, (_, i) => { const a = (i / 6) * Math.PI * 2; return `<ellipse cx="${(16 + Math.cos(a) * 6).toFixed(1)}" cy="${(12 + Math.sin(a) * 6).toFixed(1)}" rx="4.2" ry="2.6" transform="rotate(${(a * 180 / Math.PI).toFixed(0)} ${(16 + Math.cos(a) * 6).toFixed(1)} ${(12 + Math.sin(a) * 6).toFixed(1)})" fill="${f.head}"/>`; }).join('');
  (ITEMS as Record<string, ItemDef>)[f.id] = {
    id: f.id as ItemId, name: f.name, stack: 30, kind: 'resource', flower: k,
    desc: `${FLOWER_DESC[k]} Hold it and click the ground to plant it; press E on a planted flower to pick it up again.`,
    icon: svg(`<path d="M16 16v13" stroke="${f.leaf}" stroke-width="2.2" stroke-linecap="round"/><path d="M16 24c-3-4-7-4-9-3 2 3 6 4 9 3zM16 22c3-3 7-3 9-2-2 3-6 3-9 2z" fill="${f.leaf}"/>${petals}<circle cx="16" cy="12" r="3.4" fill="${f.mid}"/>`),
  };
});

export const ARMOR_TIER_COLOR: Record<1 | 2 | 3, { main: string; dark: string }> = { 1: { main: '#a8693a', dark: '#6f4424' }, 2: { main: '#b9c2c9', dark: '#6e7a84' }, 3: { main: '#58dff0', dark: '#1fa3bd' } };

export const GATHER_ITEM: Record<GatherKind, ItemId> = { wood: 'wood', stone: 'stone', ore: 'metal_ore' };
export const GATHER_LABEL: Record<GatherKind, string> = { wood: 'wood', stone: 'stone', ore: 'ore' };
