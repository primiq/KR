// Saved games, kept in the browser. The world belongs to whoever hosts (or plays solo); every player keeps their own
// character per world id, so rejoining a friend's island gives you your stuff back.
export interface WorldSave { v: 1; wid: string; hour: number; world: any; savedAt: number; layout?: number }
/** bump when the generated island changes (node indices stop matching old saves) */
import { CLASSIC } from '../world/island';
export const LAYOUT = CLASSIC ? 6 : 4; // the two landscapes are different worlds
/** saves from before the current layout keep buildings, structures and caves, but their tree / rock states refer to other objects */
export function migrateWorld(s: WorldSave): any {
  const w = s.world;
  if (w && (s.layout ?? 1) !== LAYOUT) return { ...w, nodes: [], cave: undefined };
  return w;
}

const WORLD = 'castaway.bjs.world';
const charKey = (wid: string) => `castaway.bjs.char.${wid}`;
/** a guest keeps a character of their own per world and name, so it can never collide with the host's save (same browser, two tabs) */
export const guestKey = (wid: string, name: string) => `${wid}~guest~${name.trim().toLowerCase().slice(0, 24)}`;

const get = (k: string): any | null => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } };
const put = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };

export const newWorldId = () => Math.random().toString(36).slice(2, 10);
export const loadWorld = (): WorldSave | null => { const w = get(WORLD); return w && w.v === 1 ? w : null; };
export const saveWorld = (w: WorldSave) => put(WORLD, w);
export const loadChar = (wid: string): any | null => get(charKey(wid));
export const saveChar = (wid: string, c: unknown) => put(charKey(wid), c);
export function eraseSaves() {
  try {
    const w = loadWorld();
    localStorage.removeItem(WORLD);
    if (w) localStorage.removeItem(charKey(w.wid));
  } catch { /* ignore */ }
}


/** Banana or Salmon: the campaign progress (the host's / solo player's is the shared one) and the animal this browser picked */
export interface CampaignSave { v: 1; done: number[]; best: Record<number, { t: number; c: number; medal: string }>; mine?: 'g' | 'c' | null }
const CAMPAIGN = 'castaway.campaign';
export const loadCampaign = (): CampaignSave | null => { const c = get(CAMPAIGN); return c && c.v === 1 ? c : null; };
export const saveCampaign = (c: CampaignSave) => put(CAMPAIGN, c);
