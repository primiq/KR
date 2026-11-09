import { getPref, setPref } from '../core/prefs';
// Tiny synthesized sound set: no audio files to download. Everything starts after the first click (autoplay rules).
export type HitKind = 'wood' | 'stone' | 'ore' | 'leaf';

/** a flute voice: `set` plays (or slides to) a note with a breath of 0..1; `stop` lets it fade */
export interface FluteVoice { set(midi: number, breath: number, at?: { x: number; y: number; z: number }): void; stop(): void }

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private ocean: GainNode | null = null;
  /** when the next campfire crackle may pop (audio-clock seconds) */
  private crackleAt = 0;
  private fall: GainNode | null = null;
  muted = getPref('muted') === '1';
  /** the hide & seek seeker covers their ears while counting */
  private deaf = false;
  setDeaf(on: boolean) { if (on === this.deaf) return; this.deaf = on; this.applyGain(); }
  /** the narrator talks: everything else gets quieter (1 = normal) */
  private duckK = 1;
  setDuck(k: number) { if (Math.abs(k - this.duckK) < 0.01) return; this.duckK = k; this.applyGain(); }
  private applyGain() { if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted || this.deaf ? 0 : 0.7 * this.duckK, this.ctx.currentTime, 0.12); }
  /** the audio context (null until the first click) */
  get context() { return this.ctx; }

  init() {
    if (this.ctx) { void this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.7;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 2;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.04 * w) / 1.04; d[i] = w * 0.5 + last * 6; }
      this.startOcean();
      this.startFall();
    } catch { this.ctx = null; }
  }

  setMuted(m: boolean) {
    this.muted = m;
    setPref('muted', m ? '1' : '0');
    this.applyGain();
  }

  private startOcean() {
    const c = this.ctx!, src = c.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520;
    this.ocean = c.createGain(); this.ocean.gain.value = 0;
    const lfo = c.createOscillator(), lfoG = c.createGain();
    lfo.frequency.value = 0.11; lfoG.gain.value = 0.005;
    lfo.connect(lfoG); lfoG.connect(this.ocean.gain);
    src.connect(lp); lp.connect(this.ocean); this.ocean.connect(this.master!);
    src.start(); lfo.start();
  }

  private startFall() {
    const c = this.ctx!, src = c.createBufferSource();
    src.buffer = this.noise; src.loop = true; src.playbackRate.value = 1.3;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 260;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3400;
    this.fall = c.createGain(); this.fall.gain.value = 0;
    src.connect(hp); hp.connect(lp); lp.connect(this.fall); this.fall.connect(this.master!);
    src.start();
  }

  /** 0..1, how close the waterfall is: a steady roar. */
  setFall(v: number) {
    if (!this.fall || !this.ctx) return;
    this.fall.gain.setTargetAtTime(v * 0.3, this.ctx.currentTime, 0.4);
  }

  private windG: GainNode | null = null;
  /** 0..1 rushing air for the skydive */
  setWind(v: number) {
    const c = this.ctx; if (!c || !this.master || !this.noise) return;
    if (!this.windG) {
      const src = c.createBufferSource(); src.buffer = this.noise; src.loop = true; src.playbackRate.value = 0.9;
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.4;
      this.windG = c.createGain(); this.windG.gain.value = 0; src.connect(bp); bp.connect(this.windG); this.windG.connect(this.master); src.start();
    }
    this.windG.gain.setTargetAtTime(v * 0.55, c.currentTime, 0.3);
  }
  /** 0..1, how close the nearest burning fire is: no roar, just a quiet crackle now and then (a pop every 1.5 to 5 s, sometimes two) */
  setFire(v: number) {
    const c = this.ctx; if (!c || v < 0.05) return;
    const now = c.currentTime;
    if (now < this.crackleAt) return;
    this.crackleAt = now + 1.5 + Math.random() * 3.5;
    const vol = 0.025 + v * 0.045;
    this.burst(0.015 + Math.random() * 0.025, 2200 + Math.random() * 2600, 5, vol);
    if (Math.random() < 0.35) setTimeout(() => this.burst(0.012 + Math.random() * 0.02, 2600 + Math.random() * 2400, 5, vol * 0.7), 70 + Math.random() * 160);
  }

  /** the weather makes the surf louder (0 calm .. 1 storm) */
  surfK = 0;
  /** 0..1, how close the player is to the sea. */
  setOcean(v: number) {
    if (!this.ocean || !this.ctx) return;
    this.ocean.gain.setTargetAtTime((0.03 + v * 0.22) * 0.1 * (1 + this.surfK * 2.5), this.ctx.currentTime, 0.4);
  }

  // ---- weather
  private rainG: GainNode | null = null;
  private galeG: GainNode | null = null;
  private gust = 0; private gustV = 0;
  /** rain hiss (0..1; muffled under a roof) and the storm's howling wind (0..1), every frame */
  setWeather(rain: number, gale: number, roofed: boolean, dt: number) {
    const c = this.ctx; if (!c || !this.master || !this.noise) return;
    if (!this.rainG) {
      const src = c.createBufferSource(); src.buffer = this.noise; src.loop = true; src.playbackRate.value = 1.1;
      const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6500;
      this.rainG = c.createGain(); this.rainG.gain.value = 0;
      src.connect(hp); hp.connect(lp); lp.connect(this.rainG); this.rainG.connect(this.master); src.start();
      const s2 = c.createBufferSource(); s2.buffer = this.noise; s2.loop = true; s2.playbackRate.value = 0.45;
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 0.8;
      this.galeG = c.createGain(); this.galeG.gain.value = 0;
      s2.connect(bp); bp.connect(this.galeG); this.galeG.connect(this.master); s2.start(0, 0.7);
    }
    // gusts: a slow random walk on the wind's loudness
    this.gustV += (Math.random() - 0.5) * dt * 3 - this.gustV * dt * 0.8; this.gust = Math.max(-0.5, Math.min(0.5, this.gust + this.gustV * dt));
    this.rainG.gain.setTargetAtTime(rain * (roofed ? 0.09 : 0.2), c.currentTime, 0.5);
    this.galeG!.gain.setTargetAtTime(gale * 0.3 * (0.75 + this.gust) * (roofed ? 0.6 : 1), c.currentTime, 0.3);
  }
  /** thunder `dist` metres away: a crack if it is close, then a long low rumble */
  thunder(dist: number) {
    const c = this.ctx; if (!c || !this.master || !this.noise) return;
    const near = Math.max(0, 1 - dist / 1400), at = c.currentTime + dist / 343;
    const s = c.createBufferSource(); s.buffer = this.noise; s.loop = true; s.playbackRate.value = 0.35;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160 + near * 260;
    const g = c.createGain(), dur = 3 + Math.random() * 2.5, vol = 0.25 + near * 0.6;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.08 + (1 - near) * 0.5);
    g.gain.setTargetAtTime(vol * 0.55, at + 0.5, 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    s.connect(lp); lp.connect(g); g.connect(this.master);
    s.start(at, Math.random()); s.stop(at + dur + 0.1);
    if (near > 0.55) setTimeout(() => this.burst(0.25, 2500, 0.6, 0.3 * near, 'highpass'), Math.max(0, dist / 343 * 1000));
  }
  /** a whale breathing out, far off */
  blow(v: number) { if (v > 0.02) this.burst(0.9, 420, 0.6, 0.35 * v, 'lowpass'); }
  /** a big splash, far off (a whale landing) */
  bigSplash(v: number) { if (v > 0.02) { this.burst(1.2, 600, 0.5, 0.4 * v, 'lowpass'); this.burst(0.6, 1800, 0.7, 0.12 * v); } }
  /** a ship's horn: two long low blasts */
  horn(v: number) {
    const c = this.ctx; if (!c || !this.master || v < 0.02) return;
    for (const [t0, len] of [[0, 2.2], [3.0, 2.2]]) {
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600;
      const g = c.createGain(), at = c.currentTime + t0;
      g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.16 * v, at + 0.25);
      g.gain.setValueAtTime(0.16 * v, at + len - 0.4); g.gain.exponentialRampToValueAtTime(0.0001, at + len);
      lp.connect(g); g.connect(this.master);
      for (const f of [98, 147, 196]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(lp); o.start(at); o.stop(at + len + 0.05); }
    }
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slide = 0) {
    const c = this.ctx; if (!c || !this.master) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = freq;
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), c.currentTime + dur);
    g.gain.setValueAtTime(vol, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    o.connect(g); g.connect(this.out ?? this.master); o.start(); o.stop(c.currentTime + dur + 0.02);
  }

  /** where the short sounds go: the speakers, or (inside `at`) a panner placed where the sound happens */
  private out: AudioNode | null = null;
  /**
   * Play a sound where it happens in the world (somebody else chopping, mining): it comes from that spot, fainter with
   * distance, not straight into your ears as if you were doing it. The listener follows your eyes (setListener).
   */
  at(x: number, y: number, z: number, play: () => void) {
    const c = this.ctx; if (!c || !this.master) return;
    const p = c.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 2.5; p.maxDistance = 60; p.rolloffFactor = 1.3;
    p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z;
    p.connect(this.master);
    this.out = p;
    try { play(); } finally { this.out = null; }
    setTimeout(() => p.disconnect(), 2500);
  }
  /** a part of a sound a moment later, still from the same place */
  private later(ms: number, fn: () => void) {
    const o = this.out;
    setTimeout(() => { const prev = this.out; this.out = o; try { fn(); } finally { this.out = prev; } }, ms);
  }
  /** your ears: where you are and which way you face (every frame) */
  setListener(x: number, y: number, z: number, fx: number, fy: number, fz: number) {
    const L = this.ctx?.listener; if (!L) return;
    if (L.positionX) { L.positionX.value = x; L.positionY.value = y; L.positionZ.value = z; L.forwardX.value = fx; L.forwardY.value = fy; L.forwardZ.value = fz; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
    else { (L as unknown as { setPosition(a: number, b: number, c: number): void }).setPosition(x, y, z); (L as unknown as { setOrientation(...a: number[]): void }).setOrientation(fx, fy, fz, 0, 1, 0); }
  }

  private burst(dur: number, freq: number, q: number, vol: number, type: BiquadFilterType = 'bandpass') {
    const c = this.ctx; if (!c || !this.master || !this.noise) return;
    const s = c.createBufferSource(); s.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    s.connect(f); f.connect(g); g.connect(this.out ?? this.master);
    s.start(c.currentTime, Math.random()); s.stop(c.currentTime + dur + 0.02);
  }

  hit(kind: HitKind) {
    if (kind === 'wood') { this.tone(150, 0.13, 'triangle', 0.5, 0.5); this.burst(0.09, 900, 1.2, 0.5); }
    else if (kind === 'stone') { this.burst(0.1, 2400, 2, 0.6); this.tone(420, 0.07, 'square', 0.12, 0.6); }
    else if (kind === 'ore') { this.burst(0.08, 3000, 3, 0.5); this.tone(1300, 0.35, 'sine', 0.16, 0.9); }
    else this.burst(0.2, 3500, 0.7, 0.3, 'highpass');
  }
  swing() { this.burst(0.14, 700, 0.8, 0.12); }
  pickup() { this.tone(660, 0.08, 'sine', 0.2); setTimeout(() => this.tone(990, 0.1, 'sine', 0.18), 60); }
  eat() { this.burst(0.07, 1500, 1, 0.35); setTimeout(() => this.burst(0.07, 1200, 1, 0.3), 120); setTimeout(() => this.burst(0.08, 1000, 1, 0.3), 250); }
  drink() { this.tone(300, 0.1, 'sine', 0.2, 1.8); this.burst(0.12, 1800, 2, 0.1); }
  hurt() { this.tone(110, 0.25, 'sawtooth', 0.35, 0.5); }
  step(kind: 'sand' | 'grass' | 'wood' | 'water', g = 1) {
    const v = 0.85 + Math.random() * 0.3;
    if (kind === 'sand') this.burst(0.09, 1100 * v, 0.7, 0.09 * g, 'lowpass');
    else if (kind === 'grass') { this.burst(0.07, 2600 * v, 0.8, 0.07 * g); this.burst(0.06, 400, 0.7, 0.07 * g, 'lowpass'); }
    else if (kind === 'wood') { this.tone(130 * v, 0.07, 'triangle', 0.14 * g, 0.7); this.burst(0.04, 1500, 1.2, 0.05 * g); }
    else this.burst(0.2, 1000 * v, 0.9, 0.14 * g);
  }
  /** a soft two-note chime for map pings */
  ping() { this.tone(880, 0.25, 'sine', 0.16); setTimeout(() => this.tone(1320, 0.4, 'sine', 0.14), 110); }
  land(strength = 1) { this.burst(0.12, 300, 0.7, Math.min(0.5, 0.2 * strength), 'lowpass'); this.tone(70, 0.15, 'sine', Math.min(0.4, 0.2 * strength), 0.6); }
  splash(strength = 1) { this.burst(0.35, 1300, 0.7, 0.2 * strength); this.burst(0.18, 3200, 1.5, 0.08 * strength); }
  /** Mario: a cartoon bonk when hit, a springy hop, a puff of smoke, and the stone's hum when touched */
  bonk() { this.tone(520, 0.12, 'square', 0.12, 0.45); this.burst(0.08, 900, 1.2, 0.35, 'lowpass'); }
  hop(v = 1) { this.tone(260, 0.2, 'square', 0.07 * v, 3.2); }
  poof(v = 1) { this.burst(0.7, 700, 0.6, 0.5 * v, 'lowpass'); this.tone(90, 0.6, 'sine', 0.25 * v, 0.5); }
  hum(v = 1) { this.tone(110, 1.6, 'sine', 0.18 * v, 1.0); this.tone(165, 1.4, 'sine', 0.1 * v, 1.0); this.tone(220, 1.2, 'triangle', 0.05 * v, 1.0); }
  thwack() { this.burst(0.09, 500, 1.2, 0.5, 'lowpass'); this.tone(190, 0.1, 'triangle', 0.35, 0.5); }
  private eng: { o1: OscillatorNode; o2: OscillatorNode; g: GainNode; lp: BiquadFilterNode } | null = null;
  /** engine hum for the car being driven: v = 0..1 revs, or null when it is off */
  engine(v: number | null) {
    const c = this.ctx; if (!c || !this.master) return;
    if (v === null) { if (this.eng) this.eng.g.gain.setTargetAtTime(0, c.currentTime, 0.12); return; }
    if (!this.eng) {
      const o1 = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter();
      o1.type = 'sawtooth'; o2.type = 'square'; lp.type = 'lowpass'; lp.frequency.value = 800; g.gain.value = 0;
      o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(this.master); o1.start(); o2.start();
      this.eng = { o1, o2, g, lp };
    }
    const t = c.currentTime, e = this.eng;
    e.o1.frequency.setTargetAtTime(42 + v * 150, t, 0.06); e.o2.frequency.setTargetAtTime(21 + v * 75, t, 0.06);
    e.lp.frequency.setTargetAtTime(380 + v * 1500, t, 0.08);
    e.g.gain.setTargetAtTime(0.035 + v * 0.06, t, 0.08);
  }
  /** a big balloon thump / boing */
  boing(v: number) {
    if (!this.ctx || this.muted) return;
    const f = 150 + Math.random() * 60;
    this.tone(f, 0.28, 'sine', 0.22 * v + 0.04, 2.4);
    this.tone(f * 2.6, 0.12, 'triangle', 0.06 * v, 1.6);
  }
  /** a car hitting a wall or another car */
  crash(v: number) {
    if (!this.ctx || this.muted) return;
    this.burst(0.22, 500, 0.8, 0.35 * v + 0.06, 'lowpass');
    this.tone(70, 0.2, 'square', 0.12 * v + 0.02, 0.6);
  }

  /** a cat's meow: a short rising-then-falling mew */
  meow(vol = 1) {
    const c = this.ctx; if (!c || !this.master || this.muted) return;
    const f = 520 + Math.random() * 140, v = 0.07 * vol;
    this.tone(f, 0.34, 'triangle', v, 1.45);
    this.tone(f * 2.01, 0.3, 'sine', v * 0.35, 1.35);
    setTimeout(() => this.tone(f * 1.35, 0.22, 'triangle', v * 0.7, 0.62), 160);
  }

  /** One breathy sung "ah" with vibrato, filtered through two vowel formants. */
  private voice(freq: number, delay: number, dur: number, vol: number, detune = 0) {
    const c = this.ctx; if (!c || !this.master) return;
    const t0 = c.currentTime + delay;
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq; o.detune.value = detune;
    const vib = c.createOscillator(), vg = c.createGain(); vib.frequency.value = 5.2; vg.gain.value = freq * 0.012;
    vib.connect(vg); vg.connect(o.frequency);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(vol, t0 + 0.12); g.gain.setValueAtTime(vol, t0 + dur * 0.55); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    for (const [f, q, k] of [[820, 7, 1], [1180, 9, 0.55]] as const) {
      const b = c.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = f; b.Q.value = q;
      const m = c.createGain(); m.gain.value = k;
      o.connect(b); b.connect(m); m.connect(g);
    }
    g.connect(this.master);
    o.start(t0); vib.start(t0); o.stop(t0 + dur + 0.05); vib.stop(t0 + dur + 0.05);
  }

  /** A heartbeat: two low thumps. */
  heartbeat(vol = 1) {
    const v = Math.max(0, Math.min(1, vol));
    this.tone(62, 0.16, 'sine', 0.55 * v, 0.55);
    setTimeout(() => this.tone(54, 0.2, 'sine', 0.42 * v, 0.55), 150);
  }

  /** A very low, slow throb that seems to come from under the sea. */
  seaHum(vol = 1) {
    const c = this.ctx; if (!c || !this.master || this.muted) return;
    const t0 = c.currentTime, dur = 9 + Math.random() * 3, f = 38 + Math.random() * 10;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(0.33 * vol, t0 + 3); g.gain.setValueAtTime(0.33 * vol, t0 + dur - 3.5); g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    const trem = c.createOscillator(), tg = c.createGain(); trem.frequency.value = 0.35; tg.gain.value = 0.1 * vol;
    trem.connect(tg); tg.connect(g.gain);
    for (const [m, v] of [[1, 1], [1.012, 0.8], [2, 0.25], [1.5, 0.12]] as const) {
      const o = c.createOscillator(), og = c.createGain(); o.type = 'sine'; o.frequency.value = f * m; og.gain.value = v;
      o.connect(og); og.connect(g); o.start(t0); o.stop(t0 + dur + 0.1);
    }
    g.connect(this.master); trem.start(t0); trem.stop(t0 + dur + 0.1);
  }

  animal(kind: string, vol = 1) {
    const v = Math.max(0, Math.min(1, vol));
    if (v < 0.03) return;
    switch (kind) {
      case 'click': {
        // a crab scuttling off: a quick, uneven patter of tiny dry ticks (legs on sand and shell), soft, not a beep
        const n = 7 + Math.floor(Math.random() * 6);
        let t = 0;
        for (let i = 0; i < n; i++) {
          t += 22 + Math.random() * 38;
          const k = 1 - i / (n + 2);
          setTimeout(() => this.burst(0.012 + Math.random() * 0.01, 3200 + Math.random() * 2600, 2.2, (0.035 + 0.025 * Math.random()) * v * k, 'bandpass'), t);
        }
        break;
      }
      case 'snort': this.burst(0.18, 700, 1.2, 0.3 * v, 'lowpass'); this.tone(120, 0.16, 'sawtooth', 0.12 * v, 0.7); break;
      case 'grunt': this.tone(95, 0.22, 'sawtooth', 0.4 * v, 0.6); this.burst(0.15, 500, 1, 0.3 * v, 'lowpass'); break;
      case 'squeal': this.tone(780, 0.4, 'sawtooth', 0.22 * v, 1.6); this.tone(540, 0.4, 'square', 0.1 * v, 1.9); break;
      case 'growl': this.tone(75, 0.9, 'sawtooth', 0.38 * v, 1.2); this.burst(0.8, 300, 0.8, 0.28 * v, 'lowpass'); break;
      case 'roar': this.tone(160, 0.55, 'sawtooth', 0.45 * v, 0.45); this.burst(0.5, 600, 0.7, 0.4 * v); break;
      case 'gull': this.tone(1450, 0.18, 'triangle', 0.1 * v, 1.2); setTimeout(() => this.tone(1250, 0.22, 'triangle', 0.09 * v, 0.8), 190); setTimeout(() => this.tone(1500, 0.14, 'triangle', 0.07 * v, 1.1), 420); break;
      case 'die': this.tone(180, 0.5, 'sawtooth', 0.25 * v, 0.35); break;
      case 'creep': { // a breathy, slightly wrong whisper with a detuned moan under it
        const f = 210 + Math.random() * 60;
        this.burst(1.5, 2100, 4, 0.16 * v, 'bandpass');
        this.tone(f, 1.6, 'sine', 0.13 * v, 0.82); this.tone(f * 1.06, 1.6, 'sine', 0.11 * v, 0.78);
        setTimeout(() => this.burst(0.9, 3000, 6, 0.1 * v, 'bandpass'), 700);
        break;
      }
      case 'sing': { // two small voices, a hair apart, singing "la la la la"
        const tune = Math.random() < 0.5 ? [659, 523, 587, 440] : [523, 622, 587, 466];
        tune.forEach((f, i) => {
          const d = i * 0.62 + (i === 3 ? 0.15 : 0);
          this.voice(f, d, 0.55, 0.075 * v, -12); this.voice(f, d + 0.02, 0.55, 0.065 * v, 14); this.voice(f * 1.5, d + 0.03, 0.5, 0.02 * v, 4);
        });
        break;
      }
      case 'hiss': this.burst(0.7, 4200, 1.5, 0.3 * v, 'highpass'); this.tone(900, 0.5, 'sawtooth', 0.12 * v, 2.4); this.tone(1250, 0.5, 'square', 0.05 * v, 0.4); break;
    }
  }
  fish(kind: 'cast' | 'plop' | 'bite' | 'reel' | 'lost') {
    if (kind === 'cast') { this.burst(0.25, 900, 0.7, 0.2, 'highpass'); }
    else if (kind === 'plop') { this.tone(420, 0.12, 'sine', 0.3, 0.5); this.burst(0.2, 1500, 1, 0.14); }
    else if (kind === 'bite') { this.tone(300, 0.1, 'sine', 0.3, 1.8); this.burst(0.15, 2000, 1.4, 0.2); }
    else if (kind === 'reel') { this.burst(0.35, 1800, 1, 0.18); this.tone(660, 0.1, 'sine', 0.2); setTimeout(() => this.tone(990, 0.12, 'sine', 0.2), 90); }
    else this.tone(200, 0.2, 'triangle', 0.15, 0.6);
  }
  tool_break() { this.burst(0.12, 1200, 1, 0.45); this.tone(240, 0.3, 'square', 0.25, 0.4); }
  creak() { this.tone(150, 0.9, 'sawtooth', 0.12, 0.55); this.burst(0.7, 380, 1.5, 0.12, 'lowpass'); }
  thump(strength = 1) { this.tone(58, 0.55, 'sine', 0.55 * strength, 0.6); this.burst(0.5, 220, 0.6, 0.5 * strength, 'lowpass'); this.later(40, () => this.burst(0.35, 1400, 0.8, 0.12 * strength)); }
  crumble(ore = false) { this.burst(0.5, 700, 0.9, 0.4, 'lowpass'); this.burst(0.2, 2200, 2, 0.35); if (ore) this.tone(1100, 0.5, 'sine', 0.14, 0.9); this.later(120, () => this.burst(0.25, 1800, 2, 0.2)); }
  treeFall() { this.burst(0.9, 260, 0.6, 0.55, 'lowpass'); this.tone(80, 0.7, 'triangle', 0.4, 0.5); }
  craft() { this.burst(0.06, 1400, 2, 0.35); setTimeout(() => this.tone(520, 0.09, 'triangle', 0.22, 1.5), 70); setTimeout(() => this.tone(780, 0.12, 'triangle', 0.2, 1.3), 150); }
  place() { this.tone(110, 0.14, 'triangle', 0.5, 0.5); this.burst(0.1, 500, 1, 0.45, 'lowpass'); }
  remove() { this.burst(0.18, 700, 0.8, 0.3, 'lowpass'); }
  sleep() { this.tone(330, 1.4, 'sine', 0.12, 0.6); }
  denied() { this.tone(180, 0.12, 'square', 0.12); }
  // ---- the Chamber of Tiles (steampunk clanks, hisses and bells)
  tileTick(final: boolean) { this.tone(final ? 880 : 620, final ? 0.22 : 0.1, 'square', final ? 0.16 : 0.1); this.burst(0.05, 2400, 3, 0.1); }
  tileGo() { this.tone(523, 0.18, 'triangle', 0.2); setTimeout(() => this.tone(784, 0.3, 'triangle', 0.22, 1.1), 130); setTimeout(() => this.tone(1046, 0.4, 'sine', 0.14), 280); }
  tileSeal() { this.burst(0.7, 1800, 0.5, 0.22, 'highpass'); this.tone(70, 0.9, 'sawtooth', 0.25, 0.5); setTimeout(() => { this.tone(95, 0.3, 'square', 0.3, 0.6); this.burst(0.2, 300, 1, 0.5, 'lowpass'); }, 650); }
  tileDrop() { this.tone(160, 1.4, 'sawtooth', 0.25, 0.35); this.burst(1.2, 400, 0.6, 0.3, 'lowpass'); setTimeout(() => this.tone(1200, 0.5, 'sine', 0.12, 0.5), 100); }
  tileCrack() { this.burst(0.18, 1100, 2, 0.28); this.tone(240, 0.25, 'square', 0.1, 0.4); }
  tileFall() { this.tone(520, 1.2, 'sine', 0.2, 0.12); this.burst(0.9, 900, 0.5, 0.18, 'lowpass'); }
  tileWin() { this.tone(659, 0.16, 'triangle', 0.2); setTimeout(() => this.tone(880, 0.16, 'triangle', 0.2), 120); setTimeout(() => this.tone(1175, 0.4, 'triangle', 0.22), 240); }
  tileLose() { this.tone(220, 0.35, 'sawtooth', 0.2, 0.6); setTimeout(() => this.tone(165, 0.6, 'sawtooth', 0.22, 0.5), 260); }
  tilePress() { this.tone(110, 0.14, 'square', 0.3, 0.6); this.burst(0.08, 900, 1.5, 0.25, 'lowpass'); }
  // ---- Locations, Locations: a quiet street
  /** a small bird: two or three quick rising whistles */
  /** a penguin's call: a few short nasal honks, a chick's higher and thinner */
  squawk(v = 0.6, chick = false) {
    const f = (chick ? 900 : 520) * (0.9 + Math.random() * 0.2), n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) this.later(i * 120, () => { this.tone(f * (1 + 0.06 * i), 0.11, 'sawtooth', 0.035 * v, 0.82); this.tone(f * 2.01, 0.09, 'square', 0.01 * v, 0.85); });
  }
  chirp(v = 0.3) { const f = 2600 + Math.random() * 1600; for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i++) setTimeout(() => this.tone(f + i * 140, 0.07, 'sine', 0.05 * v, 1.25), i * 95); }
  /** a cricket at night */
  cricket(v = 0.2) { for (let i = 0; i < 3; i++) setTimeout(() => this.tone(4600, 0.035, 'square', 0.018 * v), i * 55); }
  private humG: GainNode | null = null;
  /** far-off traffic: a low, soft rumble (0..1) */
  setHum(v: number) {
    const c = this.ctx; if (!c || !this.master || !this.noise) return;
    if (!this.humG) {
      const src = c.createBufferSource(); src.buffer = this.noise; src.loop = true; src.playbackRate.value = 0.5;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160;
      this.humG = c.createGain(); this.humG.gain.value = 0; src.connect(lp); lp.connect(this.humG); this.humG.connect(this.master); src.start();
    }
    this.humG.gain.setTargetAtTime(v * 0.18, c.currentTime, 0.5);
  }
  // ---- Banana or Salmon (the campaign)
  chestBeat() { for (let i = 0; i < 6; i++) setTimeout(() => { this.tone(i % 2 ? 72 : 88, 0.16, 'sine', 0.5, 0.7); this.burst(0.08, 260, 0.8, 0.35, 'lowpass'); }, i * 115); }
  scan() { this.tone(1760, 0.09, 'square', 0.12); }
  // ---- the secret level: little 8-bit sounds (square waves, like an old games console)
  jump8() { this.tone(330, 0.16, 'square', 0.07, 2.6); }
  bump8() { this.tone(110, 0.08, 'square', 0.1, 0.8); }
  pipe8() { for (let i = 0; i < 3; i++) setTimeout(() => this.tone(520 - i * 90, 0.12, 'square', 0.08, 0.6), i * 110); }
  flag8() { [392, 523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.14, 'square', 0.07), i * 90)); }
  clear8() { [523, 659, 784, 1046, 784, 1046, 1318].forEach((f, i) => setTimeout(() => this.tone(f, i === 6 ? 0.6 : 0.16, 'square', 0.08), i * 150)); }
  coin() { this.tone(1320, 0.08, 'triangle', 0.22); setTimeout(() => this.tone(1980, 0.22, 'sine', 0.18), 70); }
  rip() { this.burst(0.35, 2600, 1.2, 0.35); this.burst(0.2, 900, 1, 0.2); }
  clang() { this.tone(420, 0.5, 'square', 0.12, 0.8); this.burst(0.25, 1600, 1.4, 0.25); }
  drum() { this.tone(64, 0.6, 'sine', 0.7, 0.55); this.burst(0.3, 300, 0.7, 0.6, 'lowpass'); }
  alarm() { for (let i = 0; i < 6; i++) setTimeout(() => this.tone(i % 2 ? 660 : 880, 0.28, 'square', 0.13), i * 300); }
  /** surfacing after a long dive: a sharp breath in */
  gasp(v = 0.7) { this.burst(0.35, 1100, 0.6, 0.35 * v, 'bandpass'); this.burst(0.25, 2600, 1.2, 0.15 * v); }
  /** a flamingo's nasal honk */
  honk(v = 0.4) { if (v <= 0.01) return; this.tone(520, 0.16, 'sawtooth', 0.07 * v, 0.85); setTimeout(() => this.tone(480, 0.14, 'sawtooth', 0.06 * v, 0.8), 170); }
  /** a bird taking off: a quick rattle of wingbeats */
  flutter(v = 0.3) { if (v <= 0.01) return; for (let i = 0; i < 6; i++) setTimeout(() => this.burst(0.04, 1500 + Math.random() * 1200, 1.4, 0.16 * v), i * 38 + Math.random() * 12); }
  // ---- the alien invasion
  /** a laser bolt: a quick falling zap */
  laser(v = 1) { this.tone(1500, 0.16, 'square', 0.045 * v, 0.28); this.tone(2400, 0.09, 'sawtooth', 0.025 * v, 0.35); }
  /** a ship blowing apart */
  alienBoom(v = 1) { this.burst(0.55, 900, 0.7, 0.32 * v, 'lowpass'); this.burst(0.18, 2600, 1.4, 0.12 * v); this.tone(150, 0.35, 'square', 0.08 * v, 0.35); }
  /** the march: the four falling bass notes, round and round */
  march(i: number) { this.tone([98, 87.3, 77.8, 73.4][i % 4], 0.13, 'square', 0.1); this.tone([49, 43.7, 38.9, 36.7][i % 4], 0.14, 'sine', 0.18); }
  /** an alien plasma bolt fired: a low wobbling pew */
  alienShot(v = 1) { this.tone(420, 0.35, 'sawtooth', 0.04 * v, 0.35); this.tone(210, 0.3, 'square', 0.03 * v, 0.5); }
  /** a plasma bolt slams into your cannon */
  jolt() { this.burst(0.35, 700, 0.8, 0.4, 'lowpass'); this.tone(90, 0.4, 'square', 0.14, 0.5); this.tone(1800, 0.25, 'sawtooth', 0.04, 0.3); }
  /** the saucer's warble */
  ufoBeep() { this.ufoHi = !this.ufoHi; this.tone(this.ufoHi ? 1180 : 860, 0.15, 'sine', 0.035); }
  private ufoHi = false;
  /** the sky turns: a long rising sweep under a shimmer */
  invadersStart() { this.tone(110, 2.2, 'sawtooth', 0.09, 6); this.tone(220, 2.2, 'sine', 0.06, 4); setTimeout(() => this.tone(1320, 0.6, 'sine', 0.05, 0.5), 1800); }
  /** fat spitting over a fire */
  sizzle(v = 0.5) { this.burst(0.22 + Math.random() * 0.2, 3800 + Math.random() * 1500, 0.9, 0.05 * v, 'highpass'); }
  whoosh() { this.burst(0.4, 900, 0.6, 0.3); }
  bell() { this.tone(988, 0.6, 'sine', 0.18, 0.98); setTimeout(() => this.tone(1319, 0.8, 'sine', 0.14, 0.98), 120); }
  zap() { this.tone(1600, 0.2, 'sawtooth', 0.12, 0.4); }
  /** a deep rumble under the ground for `dur` seconds (the sand worm coming, the volcano stirring) */
  rumble(dur: number, vol: number) {
    const c = this.ctx; if (!c || !this.master || !this.noise || vol < 0.01) return;
    const s = c.createBufferSource(); s.buffer = this.noise; s.loop = true; s.playbackRate.value = 0.25;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 110;
    const g = c.createGain(), at = c.currentTime;
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(vol, at + dur * 0.6); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    s.connect(lp); lp.connect(g); g.connect(this.master); s.start(at, Math.random()); s.stop(at + dur + 0.1);
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = 38; o.frequency.linearRampToValueAtTime(52, at + dur);
    const og = c.createGain(); og.gain.setValueAtTime(0.0001, at); og.gain.exponentialRampToValueAtTime(vol * 0.8, at + dur * 0.7); og.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(og); og.connect(this.master); o.start(at); o.stop(at + dur + 0.1);
  }
  /** the worm bursts out of the sand: a spray of sand and a low bellow */
  roar(vol: number) {
    if (vol < 0.01) return;
    this.burst(1.6, 500, 0.5, 0.5 * vol, 'lowpass'); this.burst(0.9, 1600, 0.6, 0.18 * vol);
    this.tone(64, 1.8, 'sawtooth', 0.22 * vol, 0.55); this.tone(92, 1.5, 'sawtooth', 0.12 * vol, 0.6);
  }
  /** a heavy body dives into sand (or lava spouts): a long hiss and a thud */
  sandDive(vol: number) { if (vol < 0.01) return; this.burst(1.3, 700, 0.5, 0.45 * vol, 'lowpass'); this.tone(48, 0.8, 'sine', 0.4 * vol, 0.6); }
  /** a lava geyser bursting `dist` metres away */
  geyser(dist: number) { const v = Math.max(0, 1 - dist / 90); if (v < 0.02) return; this.burst(1.4, 420, 0.5, 0.45 * v, 'lowpass'); this.burst(1.0, 2600, 0.7, 0.1 * v); }
  /** lava bubbling: one fat blub */
  blub(v: number) { if (v < 0.02) return; this.tone(70 + Math.random() * 40, 0.25, 'sine', 0.25 * v, 1.8); this.burst(0.2, 300, 1, 0.12 * v, 'lowpass'); }
  /** the volcano blows: a huge boom and a long roar */
  eruption() { this.thunder(0); this.tone(36, 4, 'sine', 0.6, 0.5); this.burst(5, 260, 0.4, 0.6, 'lowpass'); setTimeout(() => this.rumble(9, 0.5), 300); }
  /** the helicopter's rotor (0 off .. 1 close and loud): a looped chop */
  private rotor: { g: GainNode; o: OscillatorNode; s: AudioBufferSourceNode } | null = null;
  setRotor(v: number, rate = 1) {
    const c = this.ctx; if (!c || !this.master || !this.noise) return;
    if (!this.rotor) {
      if (v < 0.01) return;
      const s = c.createBufferSource(); s.buffer = this.noise; s.loop = true; s.playbackRate.value = 0.6;
      const bp = c.createBiquadFilter(); bp.type = 'lowpass'; bp.frequency.value = 420;
      const chop = c.createGain(); chop.gain.value = 0.5;
      const o = c.createOscillator(); o.type = 'square'; o.frequency.value = 14;
      const depth = c.createGain(); depth.gain.value = 0.5; o.connect(depth); depth.connect(chop.gain);
      const g = c.createGain(); g.gain.value = 0;
      s.connect(bp); bp.connect(chop); chop.connect(g); g.connect(this.master); s.start(); o.start();
      this.rotor = { g, o, s };
    }
    this.rotor.g.gain.setTargetAtTime(Math.max(0, Math.min(1, v)) * 0.5, c.currentTime, 0.2);
    this.rotor.o.frequency.setTargetAtTime(8 + 9 * rate, c.currentTime, 0.4);
    if (v < 0.01) { const r = this.rotor; this.rotor = null; r.g.gain.setTargetAtTime(0, c.currentTime, 0.1); setTimeout(() => { try { r.s.stop(); r.o.stop(); } catch { /* gone */ } }, 600); }
  }
  death() { this.tone(200, 1.2, 'sawtooth', 0.35, 0.25); }

  // ---- the guitar: plucked strings made with the Karplus-Strong method (a noise burst in a damped delay line),
  // rendered once per note and cached, then played through a soft body resonance
  private strings = new Map<number, AudioBuffer>();
  private gtBus: AudioNode | null = null;
  /**
   * One string's ring, rendered once per note and strength (soft / medium / hard) and cached. Karplus-Strong: a burst
   * of noise round a damped delay line. The burst is shaped like a real pluck: darker for a soft one, brighter for a
   * hard one, and with the notch a pick leaves when it plucks near the bridge (the hollow, guitar-y colour).
   */
  private stringBuf(midi: number, layer = 1) {
    const key = midi * 4 + layer;
    let b = this.strings.get(key);
    if (b) return b;
    const c = this.ctx!, sr = c.sampleRate, f = 440 * 2 ** ((midi - 69) / 12);
    const P = Math.max(2, Math.round(sr / f + 0.5)), len = Math.floor(sr * (midi < 52 ? 3.6 : 2.8));
    b = c.createBuffer(1, len, sr);
    const d = b.getChannelData(0), line = new Float32Array(P), raw = new Float32Array(P);
    const soft = [0.28, 0.5, 0.78][layer];
    let lp = 0, mean = 0;
    for (let i = 0; i < P; i++) { lp += (Math.random() * 2 - 1 - lp) * soft; raw[i] = lp; }
    // (plucked about an eighth of the way along: that harmonic and its kin are missing)
    const pp = Math.max(1, Math.round(P * 0.12));
    for (let i = 0; i < P; i++) { line[i] = raw[i] - 0.85 * raw[(i + pp) % P]; mean += line[i]; }
    mean /= P; for (let i = 0; i < P; i++) line[i] -= mean;
    // the loss per trip round the loop: about the same ring time for every pitch (bass longer); the highs fade first
    const t60 = midi < 52 ? 3.0 : midi < 60 ? 2.3 : 1.7, g = 10 ** (-3 / (t60 * f)), damp = midi < 52 ? 0.42 : 0.47;
    let peak = 0;
    for (let i = 0; i < len; i++) {
      const k = i % P, y = line[k];
      d[i] = y; peak = Math.max(peak, Math.abs(y));
      line[k] = g * ((1 - damp) * y + damp * line[(k + 1) % P]);
    }
    // (every note as loud as the others), and a tiny fade-in so the start never clicks
    const norm = peak > 0 ? 0.9 / peak : 1;
    for (let i = 0; i < len; i++) d[i] *= norm * (i < 48 ? i / 48 : 1);
    this.strings.set(key, b);
    return b;
  }
  private guitarBus() {
    if (this.gtBus) return this.gtBus;
    const c = this.ctx!;
    // the hollow body: the air resonance low down, the top plate's warmth, the sparkle rounded off
    const air = c.createBiquadFilter(); air.type = 'peaking'; air.frequency.value = 105; air.Q.value = 2.2; air.gain.value = 6;
    const body = c.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 210; body.Q.value = 1.2; body.gain.value = 4;
    const box = c.createBiquadFilter(); box.type = 'peaking'; box.frequency.value = 520; box.Q.value = 1.4; box.gain.value = -2.5;
    const top = c.createBiquadFilter(); top.type = 'lowpass'; top.frequency.value = 5200; top.Q.value = 0.45;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 2.5; comp.attack.value = 0.004; comp.release.value = 0.3;
    air.connect(body); body.connect(box); box.connect(top); top.connect(comp); comp.connect(this.master!);
    // ... and a soft room round it (a short, warm reverb), so it sounds played somewhere, not straight into your ear
    const verb = c.createConvolver(), sr = c.sampleRate, L = Math.floor(sr * 1.6), ir = c.createBuffer(2, L, sr);
    for (let ch = 0; ch < 2; ch++) {
      const o = ir.getChannelData(ch); let lpv = 0;
      for (let i = 0; i < L; i++) { const tt = i / sr; lpv += (Math.random() * 2 - 1 - lpv) * (0.5 - 0.35 * Math.min(1, tt / 1.2)); o[i] = lpv * Math.exp(-tt * 3.2) * (i < sr * 0.012 ? i / (sr * 0.012) : 1); }
    }
    verb.buffer = ir;
    const wet = c.createGain(); wet.gain.value = 0.22;
    top.connect(verb); verb.connect(wet); wet.connect(this.master!);
    this.gtBus = air;
    return air;
  }
  /**
   * A big deep drum: a low membrane tone that drops in pitch as it rings, a softer overtone, and the slap of the stick on
   * the hide. `vel` 0..1 how hard (louder, longer, a touch higher and brighter); `vol` the listener's distance falloff.
   */
  bigDrum(vel: number, vol = 1, edge = 0) {
    const c = this.ctx; if (!c || !this.master || vol < 0.01) return;
    const t = c.currentTime, v = Math.max(0.02, Math.min(1, vel)), e = Math.max(0, Math.min(1, edge));
    // a real drum's range: a tap is a soft, dark, short thud; a slam a loud, bright boom that rings on
    const peak = (0.03 + 0.85 * v ** 1.5) * vol, ring = (0.35 + 1.1 * v) * (1 - 0.45 * e);
    // the middle of the head: the deep fundamental; towards the rim: higher, thinner, more overtone (play a tune on it)
    const f0 = (56 + 14 * v) * (1 + 0.55 * e * e), bend = 1.25 + 0.9 * v;
    const tone = (f: number, k: number, dur: number) => {
      if (k < 0.002) return;
      const o = c.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(f * bend, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.02 + 0.03 * v); o.frequency.exponentialRampToValueAtTime(f * 0.9, t + dur);
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak * k, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.out ?? this.master!); o.start(t); o.stop(t + dur + 0.05);
    };
    tone(f0, 1 - 0.4 * e, ring);
    tone(f0 * 1.59, 0.25 + 0.35 * e, ring * 0.5);
    tone(f0 * 2.14, (0.05 + 0.3 * e) * v, ring * 0.3);
    tone(f0 * 2.65, 0.18 * e * v, ring * 0.22);
    if (this.noise) {
      // the stick on the hide: barely a whisper on a tap, a crack on a slam, a sharper click at the rim
      const n = c.createBufferSource(); n.buffer = this.noise;
      const lp = c.createBiquadFilter(); lp.type = e > 0.6 ? 'bandpass' : 'lowpass'; lp.frequency.value = 250 + 2600 * v * v + 1800 * e; lp.Q.value = e > 0.6 ? 1.2 : 0.7;
      const g = c.createGain(); g.gain.setValueAtTime(peak * (0.25 + 0.5 * v + 0.4 * e), t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03 + 0.06 * v);
      n.connect(lp); lp.connect(g); g.connect(this.out ?? this.master); n.start(t); n.stop(t + 0.12);
    }
  }
  /**
   * A flute voice that plays as long as it is blown: a soft, pure tone (a little second and third harmonic), breath
   * noise round the note and a breathy hiss, a puff of air ("chiff") as each note starts, and a gentle vibrato that
   * comes in when a note is held. `at` given: it sounds from there (another player's flute), else in your ears.
   */
  fluteVoice(): FluteVoice {
    let nodes: { o: OscillatorNode[]; vib: OscillatorNode; depth: GainNode; nG: GainNode; hG: GainNode; lp: BiquadFilterNode; bp: BiquadFilterNode; env: GainNode; src: AudioBufferSourceNode | null; pan: PannerNode | null } | null = null;
    let cur = -1, stopT: ReturnType<typeof setTimeout> | null = null;
    const build = (at: boolean) => {
      const c = this.ctx!, now = c.currentTime;
      const env = c.createGain(); env.gain.value = 0;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3000; lp.Q.value = 0.3;
      lp.connect(env);
      let pan: PannerNode | null = null;
      if (at) { pan = c.createPanner(); pan.panningModel = 'HRTF'; pan.distanceModel = 'inverse'; pan.refDistance = 2; pan.maxDistance = 60; pan.rolloffFactor = 1.2; env.connect(pan); pan.connect(this.master!); }
      else env.connect(this.master!);
      const o: OscillatorNode[] = [], vib = c.createOscillator(), depth = c.createGain();
      vib.frequency.value = 5.2; depth.gain.value = 0; vib.connect(depth);
      for (const [type, k, mul] of [['sine', 1, 1], ['triangle', 0.09, 2.003], ['sine', 0.035, 3]] as [OscillatorType, number, number][]) {
        const osc = c.createOscillator(); osc.type = type; osc.frequency.value = 440 * mul;
        const g = c.createGain(); g.gain.value = k; osc.connect(g); g.connect(lp);
        const dm = c.createGain(); dm.gain.value = mul; depth.connect(dm); dm.connect(osc.frequency);
        osc.start(now); o.push(osc);
      }
      vib.start(now);
      let src: AudioBufferSourceNode | null = null;
      const nG = c.createGain(), hG = c.createGain(), bp = c.createBiquadFilter(), hp = c.createBiquadFilter();
      nG.gain.value = 0; hG.gain.value = 0;
      if (this.noise) {
        src = c.createBufferSource(); src.buffer = this.noise; src.loop = true;
        bp.type = 'bandpass'; bp.Q.value = 7; bp.frequency.value = 440;
        hp.type = 'highpass'; hp.frequency.value = 4500;
        src.connect(bp); bp.connect(nG); nG.connect(env);
        src.connect(hp); hp.connect(hG); hG.connect(env);
        src.start(now);
      }
      nodes = { o, vib, depth, nG, hG, lp, bp, env, src, pan };
    };
    const kill = () => {
      if (!nodes) return;
      const n = nodes; nodes = null; cur = -1;
      try { for (const x of n.o) x.stop(); n.vib.stop(); n.src?.stop(); } catch { /* gone */ }
    };
    return {
      set: (midi, breath, at) => {
        const c = this.ctx; if (!c || !this.master) return;
        if (stopT) { clearTimeout(stopT); stopT = null; }
        if (!nodes) build(!!at);
        const n = nodes!, now = c.currentTime, f = 440 * 2 ** ((midi - 69) / 12), b = Math.max(0, Math.min(1, breath));
        if (at && n.pan) { n.pan.positionX.setTargetAtTime(at.x, now, 0.05); n.pan.positionY.setTargetAtTime(at.y, now, 0.05); n.pan.positionZ.setTargetAtTime(at.z, now, 0.05); }
        if (midi !== cur) {
          // a new note: a quick slide to it (no click), the vibrato starting again from nothing, and a puff of air
          const first = cur < 0;
          for (let i = 0; i < 3; i++) n.o[i].frequency.setTargetAtTime(f * [1, 2.003, 3][i], now, first ? 0.001 : 0.012);
          n.bp.frequency.setTargetAtTime(f, now, 0.01);
          n.depth.gain.cancelScheduledValues(now); n.depth.gain.setValueAtTime(0, now); n.depth.gain.setTargetAtTime(f * 0.0065, now + 0.28, 0.25);
          if (this.noise) {
            const ch = c.createBufferSource(); ch.buffer = this.noise;
            const cb = c.createBiquadFilter(); cb.type = 'bandpass'; cb.frequency.value = f * 2.2; cb.Q.value = 2;
            const cg = c.createGain(); cg.gain.setValueAtTime(0.05 * (0.4 + b), now); cg.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
            ch.connect(cb); cb.connect(cg); cg.connect(n.env); ch.start(now, Math.random()); ch.stop(now + 0.09);
          }
          cur = midi;
        }
        // breath: louder and a little brighter and breathier the harder you blow
        n.env.gain.setTargetAtTime(0.16 * b ** 0.8, now, 0.035);
        n.lp.frequency.setTargetAtTime(1800 + 4200 * b, now, 0.05);
        n.nG.gain.setTargetAtTime(0.35 * b, now, 0.05);
        n.hG.gain.setTargetAtTime(0.05 * b, now, 0.05);
      },
      stop: () => {
        const c = this.ctx; if (!c || !nodes) return;
        nodes.env.gain.setTargetAtTime(0, c.currentTime, 0.04);
        cur = -1;
        if (!stopT) stopT = setTimeout(() => { stopT = null; kill(); }, 400);
      },
    };
  }

  /** one plucked string: `vel` 0..1 how hard (louder and brighter), `vol` 0..1 the listener's distance falloff, `delay` seconds */
  pluck(midi: number, vel: number, vol = 1, delay = 0) {
    const c = this.ctx; if (!c || !this.master || vol < 0.01) return;
    const layer = vel < 0.4 ? 0 : vel < 0.75 ? 1 : 2;
    const src = c.createBufferSource(); src.buffer = this.stringBuf(midi, layer);
    // the loop is a whole number of samples (less the half sample the averaging filter takes off): retune with the playback rate
    const f = 440 * 2 ** ((midi - 69) / 12), P = Math.max(2, Math.round(c.sampleRate / f + 0.5));
    src.playbackRate.value = ((P - 0.5) * f) / c.sampleRate;
    const tone = c.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 1600 + 5200 * vel; tone.Q.value = 0.35;
    const g = c.createGain(); g.gain.value = (0.03 + 0.13 * vel) * vol;
    // (the strings a little apart, low ones to the left, high to the right, as you hear a guitar in front of you)
    const pan = c.createStereoPanner(); pan.pan.value = Math.max(-0.35, Math.min(0.35, (midi - 55) / 40));
    src.connect(tone); tone.connect(g); g.connect(pan); pan.connect(this.guitarBus());
    const t = c.currentTime + delay;
    src.start(t); src.stop(t + src.buffer!.duration);
    // the pick catching the string: a tiny bright click, more on a hard strum
    if (this.noise && vel > 0.25) {
      const n = c.createBufferSource(); n.buffer = this.noise;
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2600 + 1500 * vel; bp.Q.value = 1.5;
      const ng = c.createGain(); ng.gain.setValueAtTime(0.012 * vel * vol, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.012);
      n.connect(bp); bp.connect(ng); ng.connect(pan); n.start(t, Math.random()); n.stop(t + 0.02);
    }
  }

}
