// Player settings from the Settings page (Sound and Controls), kept in prefs and applied live: the game reads these
// values every frame or every sound, so a slider takes effect as it moves.
import { getPref, setPref } from './prefs';

const num = (k: string, d: number, lo: number, hi: number) => {
  const v = Number(getPref(k));
  return getPref(k) !== null && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
};

export const settings = {
  /** everything (0..1) */
  master: num('castaway.vol.master', 1, 0, 1),
  /** the sky room's song (0..1) */
  music: num('castaway.vol.music', 1, 0, 1),
  /** the narrator and the other voices (0..1) */
  voice: num('castaway.vol.voice', 1, 0, 1),
  /** mouse and touch look speed (1 = as before) */
  look: num('castaway.look', 1, 0.3, 3),
  invertY: getPref('castaway.invertY') === '1',
  /** field of view on flat screens, degrees (the headset sets its own) */
  fov: num('castaway.fov', 69, 55, 100),
  /** no view bob and no screen shake */
  calm: getPref('castaway.calm') === '1',
};

type Key = keyof typeof settings;
const keys: Record<Key, string> = {
  master: 'castaway.vol.master', music: 'castaway.vol.music', voice: 'castaway.vol.voice',
  look: 'castaway.look', invertY: 'castaway.invertY', fov: 'castaway.fov', calm: 'castaway.calm',
};
const listeners: Array<(k: Key) => void> = [];

/** change one setting: stored, and told to whoever listens (the sound mixer, the camera) */
export function setSetting<K extends Key>(k: K, v: (typeof settings)[K]) {
  settings[k] = v;
  setPref(keys[k], typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
  for (const f of listeners) f(k);
}

export function onSetting(f: (k: Key) => void) { listeners.push(f); }
