// Ported from Castaway (three.js maths only).
import * as THREE from 'three';
import type { Sfx } from './audio';
// The guitar: eight open chords, strummed string by string. In VR the strings are real: sweep your right hand across them
// over the sound hole and each string you cross rings, in the order you crossed it, as hard as you hit it. On a screen a
// click strums the whole chord (down, then up). Every strum is sent to the other players, who hear it from where you stand.

/** MIDI notes, low E string first; null = a string that is not played in this chord */
export const CHORDS: { name: string; notes: (number | null)[] }[] = [
  { name: 'G', notes: [43, 47, 50, 55, 59, 67] },
  { name: 'C', notes: [null, 48, 52, 55, 60, 64] },
  { name: 'D', notes: [null, null, 50, 57, 62, 66] },
  { name: 'F', notes: [41, 48, 53, 57, 60, 65] },
  { name: 'Em', notes: [40, 47, 52, 55, 59, 64] },
  { name: 'Am', notes: [null, 45, 52, 57, 60, 64] },
  { name: 'E', notes: [40, 47, 52, 56, 59, 64] },
  { name: 'Dm', notes: [null, null, 50, 57, 62, 65] },
];

/** a strum as sent over the network: chord, the strings (in the order they were hit), how hard, and where */
export interface StrumEvent { c: number; s: number[]; v: number; x: number; y: number; z: number }

// the strum zone, in the guitar's own frame around the sound hole: strings run along y, lie across x, face -z
const ZONE_Y = 0.16, ZONE_Z0 = -0.1, ZONE_Z1 = 0.05;
/** where the hand crosses each string (spread wider than the real strings so a natural sweep catches them all) */
const STR_X = [0, 1, 2, 3, 4, 5].map((i) => (i - 2.5) * 0.024);
const HEAR = 45;

const _l = new THREE.Vector3();

export class Guitar {
  chord = 0;
  /** a strum this player made (for the network) */
  onStrum: ((e: StrumEvent) => void) | null = null;
  private down = true;
  private prev = new THREE.Vector3();
  private hasPrev = false;
  private last = new Float32Array(6).fill(-1);   // when each string last rang (seconds), so a hand resting on it does not buzz
  private t = 0;

  constructor(private sfx: Sfx) {}

  get chordName() { return CHORDS[this.chord].name; }

  /** play strings `s` (indices, in the order hit) of chord `c`; `vol` is the listener's distance falloff */
  play(c: number, s: number[], v: number, vol = 1) {
    const ch = CHORDS[c] ?? CHORDS[0];
    let k = 0;
    for (const i of s) {
      const n = ch.notes[i];
      if (n == null) continue;
      // a strum is not a block chord: the strings follow each other by a few milliseconds, quicker when you hit harder
      this.sfx.pluck(n, v, vol, k * (0.016 - 0.008 * v));
      k++;
    }
  }

  private emit(s: number[], v: number, at: THREE.Vector3) {
    if (!s.length) return;
    this.play(this.chord, s, v);
    this.onStrum?.({ c: this.chord, s, v: +v.toFixed(2), x: +at.x.toFixed(2), y: +at.y.toFixed(2), z: +at.z.toFixed(2) });
  }

  /** a click on a screen: the whole chord, alternating down and up strokes */
  click(at: THREE.Vector3) {
    const s = this.down ? [0, 1, 2, 3, 4, 5] : [5, 4, 3, 2, 1];
    this.down = !this.down;
    this.emit(s, this.down ? 0.55 : 0.7, at);
  }

  /** VR: the strumming hand at world position `hand` against the guitar's strum zone. Returns how hard it strummed (0 = not). */
  track(dt: number, zone: THREE.Object3D, hand: THREE.Vector3, at: THREE.Vector3): number {
    this.t += dt;
    _l.copy(hand); zone.worldToLocal(_l);
    const inside = Math.abs(_l.y) < ZONE_Y && _l.z > ZONE_Z0 && _l.z < ZONE_Z1;
    let hit = 0;
    if (this.hasPrev && inside) {
      const x0 = this.prev.x, x1 = _l.x, dx = x1 - x0;
      // speed across the strings (m/s); the zone frame may be mirrored (left hand) but distances are not
      const speed = Math.abs(dx) / Math.max(dt, 1 / 120);
      if (Math.abs(dx) > 1e-4 && speed > 0.12) {
        const crossed: number[] = [];
        for (let i = 0; i < 6; i++) {
          const sx = STR_X[i];
          if ((x0 - sx) * (x1 - sx) <= 0 && x0 !== x1 && this.t - this.last[i] > 0.07) crossed.push(i);
        }
        if (crossed.length) {
          // in the order the hand met them
          crossed.sort((a, b) => (dx > 0 ? STR_X[a] - STR_X[b] : STR_X[b] - STR_X[a]));
          for (const i of crossed) this.last[i] = this.t;
          hit = Math.min(1, 0.2 + speed / 2.2);
          this.emit(crossed, hit, at);
        }
      }
    }
    // leaving the zone forgets the old position, so coming back in from the side does not count as a sweep
    if (inside) { this.prev.copy(_l); this.hasPrev = true; } else this.hasPrev = false;
    return hit;
  }

  /** a strum from another player, `d` metres away */
  remote(e: StrumEvent, d: number) {
    if (d > HEAR) return;
    const vol = Math.max(0, 1 - d / HEAR) ** 1.6;
    this.play(e.c, e.s.filter((i) => i >= 0 && i < 6), Math.max(0, Math.min(1, e.v)), vol);
  }

  /** forget the hand (the guitar was put away) */
  reset() { this.hasPrev = false; }
}
