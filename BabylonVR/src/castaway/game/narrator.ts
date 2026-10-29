// The narrator (and the other voiced characters: the cashier, the museum guard). Every line is a pre-generated MP3
// (scripts/make-narration.mjs, Google Cloud Text-to-Speech) inlined into the bundle, so it works inside the artifact with no
// network. Lines are queued and played through WebAudio; the game's sound effects are ducked while somebody talks, the text
// is shown as a subtitle (and on the VR wrist panel). A missing MP3 falls back to the browser's own voice.
// Nothing is sent over the network: multiplayer events carry a line id and every client plays it locally.
import script from '../narration/script.json';
import { getPref, setPref } from '../core/prefs';
import type * as THREE from 'three';
import { setPannerPos } from '../campaign/mosquito';

const CLIPS = import.meta.glob('../assets/narration/*.mp3', { eager: true, query: '?inline', import: 'default' }) as Record<string, string>;
interface Line { id: string; voice: string; text: string; subtitle?: string }
const LINES = new Map<string, Line>((script.lines as Line[]).map((l) => [l.id, l]));
const clipOf = (id: string) => CLIPS[`../assets/narration/${id}.mp3`] as string | undefined;
const WHO: Record<string, string> = { cashier: 'Cashier', guard: 'Night guard' };

export interface SayOpts {
  /** cut off whatever is playing (and drop anything queued with a lower priority) */
  interrupt?: boolean;
  /** higher plays first; equal priorities keep their order */
  priority?: number;
}
interface Item { id: string; pri: number }

export class Narrator {
  /** the game's audio context (created on the first click) */
  ctx: () => AudioContext | null = () => null;
  /** duck the sound effects: 1 normal, lower while a line plays */
  duck: (k: number) => void = () => {};
  /** everything muted (N) */
  muted: () => boolean = () => false;
  /** the subtitle as a short note for the VR wrist panel */
  onCaption: ((text: string) => void) | null = null;
  /** where the narrator is (the mosquito), or null: then the voice is not placed in 3D */
  source: () => THREE.Vector3 | null = () => null;
  private pan: PannerNode | null = null;
  /** the narrator's voice (subtitles always show) */
  voiceOn = getPref('narration') !== '0';
  private queue: Item[] = [];
  private cur: { id: string; pri: number; src?: AudioBufferSourceNode; until: number; started: number } | null = null;
  private bufs = new Map<string, Promise<AudioBuffer | null>>();
  private gain: GainNode | null = null;
  private subs: HTMLDivElement;
  private subT = 0;
  private gen = 0;
  /** the last hint, for a replay */
  lastHint = '';

  constructor() {
    this.subs = document.createElement('div');
    this.subs.id = 'subs';
    this.subs.style.cssText = 'position:fixed;left:50%;bottom:118px;transform:translateX(-50%);z-index:6;max-width:min(760px,92vw);padding:8px 16px;border-radius:12px;background:rgba(10,14,20,.72);color:#fff;font:600 19px/1.35 system-ui,sans-serif;text-align:center;pointer-events:none;display:none;text-shadow:0 1px 2px #000';
    document.body.appendChild(this.subs);
    window.addEventListener('keydown', (e) => { if (e.code === 'KeyV' && !e.repeat && this.cur) this.skip(); });
    const box = document.getElementById('narration-on') as HTMLInputElement | null;
    if (box) { box.checked = this.voiceOn; box.addEventListener('change', () => this.setVoice(box.checked)); }
  }

  has(id: string) { return LINES.has(id); }
  text(id: string) { const l = LINES.get(id); return l ? l.subtitle ?? l.text : ''; }
  get busy() { return !!this.cur || this.queue.length > 0; }
  setVoice(on: boolean) { this.voiceOn = on; setPref('narration', on ? '1' : '0'); if (!on) this.cur?.src?.stop(); }

  /** queue a line (a line already playing or waiting is not queued twice) */
  say(id: string, o: SayOpts = {}) {
    if (!LINES.has(id)) { console.warn('no narration line', id); return; }
    const pri = o.priority ?? 0;
    if (id.includes('_hint_')) this.lastHint = id;
    if (o.interrupt) {
      this.queue = this.queue.filter((q) => q.pri > pri);
      if (this.cur && this.cur.id !== id) this.stopCur();
    }
    if (this.cur?.id === id || this.queue.some((q) => q.id === id)) return;
    let at = this.queue.findIndex((q) => q.pri < pri);
    if (at < 0) at = this.queue.length;
    this.queue.splice(at, 0, { id, pri });
    if (this.queue.length > 5) this.queue.length = 5;
    void this.load(this.queue[0].id);
  }
  /** stop talking and forget the queue */
  stop() { this.queue = []; this.stopCur(); this.show(''); }
  skip() { this.stopCur(); }
  replayHint() { if (this.lastHint) this.say(this.lastHint, { interrupt: true, priority: 2 }); }

  private stopCur() {
    const c = this.cur; if (!c) return;
    this.cur = null; this.gen++;
    try { c.src?.stop(); } catch { /* already ended */ }
    try { speechSynthesis?.cancel(); } catch { /* none */ }
  }

  private load(id: string): Promise<AudioBuffer | null> {
    let p = this.bufs.get(id);
    if (p) return p;
    const ctx = this.ctx(), url = clipOf(id);
    if (!ctx || !url) return Promise.resolve(null);
    p = (async () => {
      try {
        const b64 = url.slice(url.indexOf(',') + 1), bin = atob(b64), arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return await ctx.decodeAudioData(arr.buffer);
      } catch (e) { console.warn('narration decode', id, e); return null; }
    })();
    this.bufs.set(id, p);
    return p;
  }

  private show(text: string, who = '') {
    if (!text) { this.subs.style.display = 'none'; return; }
    this.subs.innerHTML = who ? `<b style="color:#ffd27a">${who}:</b> ${esc(text)}` : `${this.source() ? '🦟 ' : ''}<i>${esc(text)}</i>`;
    this.subs.style.display = 'block';
    this.onCaption?.(who ? `${who}: ${text}` : text);
  }

  private async start(item: Item) {
    const line = LINES.get(item.id)!, text = line.subtitle ?? line.text, gen = ++this.gen;
    const words = text.split(/\s+/).length, guess = 1.2 + words / 2.6;
    this.cur = { id: item.id, pri: item.pri, until: performance.now() + guess * 1000, started: performance.now() };
    this.show(text, WHO[line.voice] ?? '');
    const ctx = this.ctx();
    const wantVoice = this.voiceOn && !this.muted();
    if (!wantVoice) return;
    if (ctx && clipOf(item.id)) {
      const buf = await this.load(item.id);
      if (gen !== this.gen || !this.cur) return;
      if (buf) {
        if (!this.gain) { this.gain = ctx.createGain(); this.gain.gain.value = 1; this.gain.connect(ctx.destination); }
        const src = ctx.createBufferSource(); src.buffer = buf;
        // the narrator (the mosquito) speaks from where it is; the cashier and the guard do too in spirit, but they are mixed flat
        const at = line.voice === 'narrator' ? this.source() : null;
        if (at) {
          if (!this.pan) { this.pan = ctx.createPanner(); this.pan.panningModel = 'HRTF'; this.pan.distanceModel = 'inverse'; this.pan.refDistance = 1.2; this.pan.rolloffFactor = 0.5; this.pan.connect(this.gain); }
          setPannerPos(this.pan, ctx, at); src.connect(this.pan);
        } else src.connect(this.gain);
        src.onended = () => { if (this.cur?.src === src) { this.cur = null; this.subT = 0.6; } };
        src.start();
        this.cur.src = src; this.cur.until = performance.now() + (buf.duration + 3) * 1000;
        return;
      }
    }
    // no recording for this line: the browser's own voice reads the subtitle
    try {
      if (!('speechSynthesis' in window)) return;
      const u = new SpeechSynthesisUtterance(text.replace(/\.\.\./g, ', '));
      u.rate = 0.98; u.pitch = line.voice === 'guard' ? 0.7 : line.voice === 'cashier' ? 1.2 : 1;
      u.onend = () => { if (gen === this.gen && this.cur) { this.cur = null; this.subT = 0.6; } };
      speechSynthesis.speak(u);
      this.cur.until = performance.now() + (guess + 4) * 1000;
    } catch { /* no speech either: the subtitle stays up for the guessed time */ }
  }

  /** is the narrator (not the cashier or the guard) talking right now? */
  get narrating() { return !!this.cur && LINES.get(this.cur.id)?.voice === 'narrator'; }
  update(dt: number) {
    const now = performance.now();
    const ctx = this.ctx(), at = this.source();
    if (this.pan && ctx && at) setPannerPos(this.pan, ctx, at);
    if (this.cur && now > this.cur.until) { this.cur = null; this.subT = 0.6; }
    if (!this.cur && this.queue.length) void this.start(this.queue.shift()!);
    if (!this.cur && this.subT > 0) { this.subT -= dt; if (this.subT <= 0) this.show(''); }
    this.duck(this.cur?.src && this.voiceOn && !this.muted() ? 0.4 : 1);
    if (this.queue.length) void this.load(this.queue[0].id);
  }
}

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
