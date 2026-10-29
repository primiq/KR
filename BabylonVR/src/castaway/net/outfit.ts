// What a player chooses to look like: a handful of small numbers (so it travels in the join handshake for free) that are
// turned into the full `Look` the player model is built from. The choice is saved in the browser; everyone else's arrives
// with their join (and again, as an event, when they change it).
import { getPref, setPref } from '../core/prefs';
import { mulberry32 } from '../core/noise';
import { lookFor, type Look, SKINS, HAIRS, SHIRTS, PANTS } from './playerModel';

export interface Part { name: string; set: Partial<Look> }
export const HEADS: Part[] = [
  { name: 'Short crop', set: { hairStyle: 0, hat: 0, beard: false, glasses: false } },
  { name: 'Long hair', set: { hairStyle: 1, hat: 0, beard: false, glasses: false } },
  { name: 'Ponytail', set: { hairStyle: 2, hat: 0, beard: false, glasses: false } },
  { name: 'Top bun', set: { hairStyle: 3, hat: 0, beard: false, glasses: false } },
  { name: 'Headband', set: { hairStyle: 4, hat: 0, beard: false, glasses: false } },
  { name: 'Buzz cut', set: { hairStyle: 5, hat: 0, beard: false, glasses: false } },
  { name: 'Curls', set: { hairStyle: 6, hat: 0, beard: false, glasses: false } },
  { name: 'Sun hat', set: { hairStyle: 0, hat: 1, beard: false, glasses: false } },
  { name: 'Beard', set: { hairStyle: 5, hat: 0, beard: true, glasses: false } },
  { name: 'Shades', set: { hairStyle: 0, hat: 0, beard: false, glasses: true } },
];
export const TORSOS: Part[] = [
  { name: 'T-shirt', set: { shirtStyle: 0, pack: 0, scarf: false } },
  { name: 'Sleeveless', set: { shirtStyle: 1, pack: 0, scarf: false } },
  { name: 'Camp shirt', set: { shirtStyle: 2, pack: 0, scarf: false } },
  { name: 'T-shirt + rucksack', set: { shirtStyle: 0, pack: 1, scarf: false } },
  { name: 'Camp shirt + satchel', set: { shirtStyle: 2, pack: 2, scarf: false } },
  { name: 'Sleeveless + scarf', set: { shirtStyle: 1, pack: 0, scarf: true } },
];
export const LEGS: Part[] = [
  { name: 'Trousers, boots', set: { pantsStyle: 0, shoeStyle: 0 } },
  { name: 'Shorts, boots', set: { pantsStyle: 1, shoeStyle: 0 } },
  { name: 'Trousers, sandals', set: { pantsStyle: 0, shoeStyle: 1 } },
  { name: 'Shorts, sandals', set: { pantsStyle: 1, shoeStyle: 1 } },
];

/** [head, hair colour, skin, torso, shirt colour, legs, trouser colour] */
export type Outfit = number[];
export interface Slot { label: string; n: number; names?: string[]; colors?: string[] }
export const SLOTS: Slot[] = [
  { label: 'Head', n: HEADS.length, names: HEADS.map((p) => p.name) },
  { label: 'Hair colour', n: HAIRS.length, colors: HAIRS },
  { label: 'Skin', n: SKINS.length, colors: SKINS },
  { label: 'Torso', n: TORSOS.length, names: TORSOS.map((p) => p.name) },
  { label: 'Shirt colour', n: SHIRTS.length, colors: SHIRTS },
  { label: 'Legs', n: LEGS.length, names: LEGS.map((p) => p.name) },
  { label: 'Trouser colour', n: PANTS.length, colors: PANTS },
];

/** accepts anything off the wire; returns a clean outfit or null */
export function parseOutfit(x: unknown): Outfit | null {
  if (!Array.isArray(x) || x.length !== SLOTS.length) return null;
  const o: number[] = [];
  for (let i = 0; i < SLOTS.length; i++) { const v = x[i]; if (!Number.isInteger(v) || v < 0 || v >= SLOTS[i].n) return null; o.push(v); }
  return o;
}

/** a stable random outfit for someone whose choice we do not know (old saves, a first visit) */
export function outfitFor(id: number): Outfit {
  const r = mulberry32(id * 4421 + 7);
  return SLOTS.map((s) => Math.floor(r() * s.n));
}

export const outfitKey = (o: Outfit) => o.join(',');

export function lookFromOutfit(o: Outfit, id = 0): Look {
  const base = lookFor(id, SHIRTS[o[4]]);   // the parts nobody chooses (eyes, accent colours, smile) stay stable per player
  return { ...base, ...HEADS[o[0]].set, hair: HAIRS[o[1]], skin: SKINS[o[2]], ...TORSOS[o[3]].set, shirt: SHIRTS[o[4]], ...LEGS[o[5]].set, pants: PANTS[o[6]] };
}

// ---- this player's own choice
let mine: Outfit | null = null;
const listeners: (() => void)[] = [];
export function getOutfit(): Outfit {
  if (mine) return mine;
  try { mine = parseOutfit(JSON.parse(getPref('outfit') ?? 'null')); } catch { mine = null; }
  if (!mine) { mine = outfitFor(Math.floor(Math.random() * 1e6)); setPref('outfit', JSON.stringify(mine)); }
  return mine;
}
export function setOutfit(o: Outfit) {
  mine = o.slice(); setPref('outfit', JSON.stringify(mine));
  for (const f of listeners) f();
}
export function onOutfitChange(f: () => void) { listeners.push(f); }
/** step one slot by +1 / -1 (wraps) */
export function cycleSlot(slot: number, d: number) {
  const o = getOutfit().slice(); const n = SLOTS[slot].n;
  o[slot] = (o[slot] + d + n) % n; setOutfit(o);
}
export function randomOutfit() { setOutfit(outfitFor(Math.floor(Math.random() * 1e6))); }

/** the name to show for yourself when no multiplayer session decided one */
export const myDisplayName = () => (getPref('name') ?? '').trim().slice(0, 14) || 'Castaway';

// ---- everybody's outfit by player id (filled in by the session), for chat / map colours and avatars
const others = new Map<number, Outfit>();
export const setPlayerOutfit = (id: number, o: Outfit | null) => { if (o) others.set(id, o); else others.delete(id); };
export const outfitOf = (id: number): Outfit => others.get(id) ?? outfitFor(id);
export const playerColor = (id: number) => SHIRTS[outfitOf(id)[4]];
