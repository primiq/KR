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

const BACKUP = WORLD + '.bak';
const get = (k: string): any | null => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } };
const put = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };

/** something went wrong saving (told once per kind, so the player is not nagged every 30 s) */
let onSaveProblem: ((msg: string) => void) | null = null;
const pending: string[] = [];
/** (messages from before there was anywhere to show them are shown now) */
export const setOnSaveProblem = (f: (msg: string) => void) => { onSaveProblem = f; for (const m of pending.splice(0)) f(m); };
const told = new Set<string>();
const problem = (k: string, msg: string) => { if (told.has(k)) return; told.add(k); if (onSaveProblem) onSaveProblem(msg); else pending.push(msg); };
/** when the island was last saved (ms), for the menu */
export let lastSaved = 0;

/** every painting's picture left out (they are most of a big save): the frames stay, blank */
function withoutPictures(world: any) {
  if (!world || !Array.isArray(world.paintings)) return world;
  return { ...world, paintings: world.paintings.map((r: unknown[]) => (Array.isArray(r) ? [...r.slice(0, 6), ''] : r)) };
}

export const newWorldId = () => Math.random().toString(36).slice(2, 10);
const valid = (w: any): w is WorldSave => !!w && w.v === 1 && typeof w.wid === 'string' && !!w.world;
/** the saved island; if the save is missing or damaged, the one before it (kept on every save) */
export const loadWorld = (): WorldSave | null => {
  const w = get(WORLD);
  if (valid(w)) return w;
  const b = get(BACKUP);
  if (valid(b)) { problem('restored', 'Your last save could not be read: the one before it was loaded instead.'); return b; }
  return null;
};
/**
 * Save the island. The save before it is kept as a backup first. If the browser's storage is full, it is saved again
 * without the paintings' pictures; if even that fails, the player is told (once) and the backup is left as it was.
 */
export function saveWorld(w: WorldSave): boolean {
  let prev: string | null = null;
  try { prev = localStorage.getItem(WORLD); } catch { /* blocked */ }
  if (prev) { try { localStorage.setItem(BACKUP, prev); } catch { try { localStorage.removeItem(BACKUP); } catch { /* */ } } }
  if (put(WORLD, w)) { lastSaved = Date.now(); return true; }
  // full: make room (the backup goes first), then try without the pictures
  try { localStorage.removeItem(BACKUP); } catch { /* */ }
  if (put(WORLD, w)) { lastSaved = Date.now(); problem('nobackup', 'Storage is nearly full: your island is saved, but without a backup copy.'); return true; }
  if (put(WORLD, { ...w, world: withoutPictures(w.world) })) {
    lastSaved = Date.now();
    problem('nopics', 'Storage is full: your island is saved, but the pictures in your paintings could not be.');
    return true;
  }
  problem('failed', 'Could not save your island: this browser has no room left. Try Settings > Export save.');
  return false;
}
export const loadChar = (wid: string): any | null => get(charKey(wid));
export const saveChar = (wid: string, c: unknown) => put(charKey(wid), c);
export function eraseSaves() {
  try {
    const w = loadWorld();
    localStorage.removeItem(WORLD); localStorage.removeItem(BACKUP);
    if (w) localStorage.removeItem(charKey(w.wid));
  } catch { /* ignore */ }
}


/** Banana or Salmon: the campaign progress (the host's / solo player's is the shared one) and the animal this browser picked */
export interface CampaignSave { v: 1; done: number[]; best: Record<number, { t: number; c: number; medal: string }>; mine?: 'g' | 'c' | null }
const CAMPAIGN = 'castaway.campaign';
export const loadCampaign = (): CampaignSave | null => { const c = get(CAMPAIGN); return c && c.v === 1 ? c : null; };
export const saveCampaign = (c: CampaignSave) => put(CAMPAIGN, c);

// ---- export / import: everything this browser keeps for the game, as one file the player can keep or move
const OURS = (k: string) => k.startsWith('castaway.') || k === 'outfit' || k === 'name';
export function exportSaves(): string {
  const out: Record<string, string> = {};
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i)!; if (OURS(k)) out[k] = localStorage.getItem(k) ?? ''; } } catch { /* */ }
  return JSON.stringify({ castaway: 1, at: new Date().toISOString(), keys: out });
}
/** put an exported file back (it replaces what is here); returns an error message, or null */
export function importSaves(text: string): string | null {
  let d: any;
  try { d = JSON.parse(text); } catch { return 'That file is not a Castaway save.'; }
  if (!d || d.castaway !== 1 || typeof d.keys !== 'object') return 'That file is not a Castaway save.';
  const keys = Object.entries(d.keys as Record<string, unknown>).filter(([k, v]) => OURS(k) && typeof v === 'string');
  if (!keys.some(([k]) => k === WORLD)) return 'That file has no island in it.';
  try { for (const [k, v] of keys) localStorage.setItem(k, v as string); } catch { return 'Could not import: this browser has no room left.'; }
  return null;
}
