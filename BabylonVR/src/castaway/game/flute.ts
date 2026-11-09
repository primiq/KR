// The flute: a little wooden flute. It plays as long as you blow it: eight notes of a major scale (do re mi fa sol la ti
// do) picked with finger buttons, an octave higher when you want it.
//  - VR: bring it up to your lips (it only sounds there). X, Y and the left trigger are the fingers: together they make
//    the eight notes, as the guitar's chords are made. The right trigger is your breath (squeeze softly for a soft note,
//    hard for a strong one); hold the left grip for the octave up.
//  - On a screen: hold the mouse button to blow; while blowing, keys 1-8 pick the note (R steps through them); Shift
//    is the octave up. On a phone: hold HIT to blow, the turn button steps the note.
// Everybody nearby hears it, from where you stand (event 'fl': the note and the breath, as they change).
import type { FluteVoice, Sfx } from "./audio";

/** the scale: C major from C5, as semitones above it (the eighth is the C above) */
const SCALE = [0, 2, 4, 5, 7, 9, 11, 12], BASE = 72;
export const NOTE_NAMES = ["Do", "Re", "Mi", "Fa", "Sol", "La", "Ti", "Do"];
/** what is sent: the note (MIDI, -1 = stopped), the breath, where */
export interface FluteEvent { m: number; v: number; x: number; y: number; z: number }

export class Flute {
  /** the note picked on a screen (0..7) */
  note = 0;
  /** (set by vr.ts each frame while the flute is held) the finger buttons (0..7), the breath, the octave, at the lips */
  vrIn: { bits: number; breath: number; oct: boolean; mouth: boolean } | null = null;
  onPlay: ((e: FluteEvent) => void) | null = null;
  private voice: FluteVoice;
  private cur = -1;
  private sent = { m: -1, v: 0, t: 0 };
  private remotes = new Map<number, { v: FluteVoice; t: number }>();

  constructor(private readonly sfx: Sfx) { this.voice = sfx.fluteVoice(); }

  static midi(note: number, oct: boolean) { return BASE + SCALE[Math.max(0, Math.min(7, note))] + (oct ? 12 : 0); }

  /** this player's flute, every frame: `breath` 0 = not blowing */
  update(dt: number, breath: number, note: number, oct: boolean, at: { x: number; y: number; z: number }) {
    const m = breath > 0.03 ? Flute.midi(note, oct) : -1;
    if (m >= 0) this.voice.set(m, breath); else if (this.cur >= 0) this.voice.stop();
    this.cur = m;
    // tell the others: when the note changes, the breath moves noticeably, or now and then while it plays
    this.sent.t -= dt;
    if (m !== this.sent.m || Math.abs(breath - this.sent.v) > 0.15 || (m >= 0 && this.sent.t <= 0)) {
      this.sent = { m, v: breath, t: 0.4 };
      this.onPlay?.({ m, v: +breath.toFixed(2), x: +at.x.toFixed(2), y: +(at.y + 1.5).toFixed(2), z: +at.z.toFixed(2) });
    }
    // (players whose flute went quiet without saying so: stop hearing them)
    for (const [id, r] of this.remotes) { r.t -= dt; if (r.t <= 0) { r.v.stop(); this.remotes.delete(id); } }
  }

  /** another player's flute */
  remote(from: number, e: FluteEvent) {
    let r = this.remotes.get(from);
    if (e.m < 0 || !(e.v > 0.03)) { r?.v.stop(); return; }
    if (!r) { r = { v: this.sfx.fluteVoice(), t: 0 }; this.remotes.set(from, r); }
    r.t = 1.5;
    r.v.set(e.m, Math.min(1, e.v), { x: e.x, y: e.y, z: e.z });
  }

  /** put away: silence */
  stop() { if (this.cur >= 0) { this.voice.stop(); this.cur = -1; } }
}
