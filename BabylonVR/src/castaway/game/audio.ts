import { getPref, setPref } from '../core/prefs';
// Tiny synthesized sound set: no audio files to download. Everything starts after the first click (autoplay rules).
export type HitKind = 'wood' | 'stone' | 'ore' | 'leaf';

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
    o.connect(g); g.connect(this.master); o.start(); o.stop(c.currentTime + dur + 0.02);
  }

  private burst(dur: number, freq: number, q: number, vol: number, type: BiquadFilterType = 'bandpass') {
    const c = this.ctx; if (!c || !this.master || !this.noise) return;
    const s = c.createBufferSource(); s.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    s.connect(f); f.connect(g); g.connect(this.master);
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
      case 'click': this.tone(2400, 0.03, 'square', 0.05 * v); setTimeout(() => this.tone(2100, 0.03, 'square', 0.04 * v), 55); break;
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
  thump(strength = 1) { this.tone(58, 0.55, 'sine', 0.55 * strength, 0.6); this.burst(0.5, 220, 0.6, 0.5 * strength, 'lowpass'); setTimeout(() => this.burst(0.35, 1400, 0.8, 0.12 * strength), 40); }
  crumble(ore = false) { this.burst(0.5, 700, 0.9, 0.4, 'lowpass'); this.burst(0.2, 2200, 2, 0.35); if (ore) this.tone(1100, 0.5, 'sine', 0.14, 0.9); setTimeout(() => this.burst(0.25, 1800, 2, 0.2), 120); }
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
  death() { this.tone(200, 1.2, 'sawtooth', 0.35, 0.25); }

  // ---- the guitar: plucked strings made with the Karplus-Strong method (a noise burst in a damped delay line),
  // rendered once per note and cached, then played through a soft body resonance
  private strings = new Map<number, AudioBuffer>();
  private gtBus: AudioNode | null = null;
  private stringBuf(midi: number) {
    let b = this.strings.get(midi);
    if (b) return b;
    const c = this.ctx!, sr = c.sampleRate, f = 440 * 2 ** ((midi - 69) / 12);
    const P = Math.max(2, Math.round(sr / f + 0.5)), len = Math.floor(sr * (midi < 52 ? 3.2 : 2.4));
    b = c.createBuffer(1, len, sr);
    const d = b.getChannelData(0), line = new Float32Array(P);
    // a softened pluck: low-passed noise with the DC taken out, so it starts warm rather than scratchy
    let lp = 0, mean = 0;
    for (let i = 0; i < P; i++) { lp += (Math.random() * 2 - 1 - lp) * 0.55; line[i] = lp; mean += lp; }
    mean /= P; for (let i = 0; i < P; i++) line[i] -= mean;
    // the loss per trip round the loop: about the same ring time (T60) for every pitch, bass a little longer
    const t60 = midi < 52 ? 2.6 : midi < 60 ? 2.0 : 1.5, g = 10 ** (-3 / (t60 * f)), damp = 0.5;
    for (let i = 0; i < len; i++) {
      const k = i % P, y = line[k];
      d[i] = y;
      line[k] = g * ((1 - damp) * y + damp * line[(k + 1) % P]);
    }
    // a tiny fade-in so the start never clicks
    for (let i = 0; i < 48 && i < len; i++) d[i] *= i / 48;
    this.strings.set(midi, b);
    return b;
  }
  private guitarBus() {
    if (this.gtBus) return this.gtBus;
    const c = this.ctx!;
    // the hollow body: a warm low bump, a soft top, nothing harsh
    const body = c.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 180; body.Q.value = 1.1; body.gain.value = 5;
    const air = c.createBiquadFilter(); air.type = 'lowshelf'; air.frequency.value = 110; air.gain.value = 3;
    const top = c.createBiquadFilter(); top.type = 'lowpass'; top.frequency.value = 4200; top.Q.value = 0.5;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -20; comp.ratio.value = 3; comp.attack.value = 0.003; comp.release.value = 0.25;
    body.connect(air); air.connect(top); top.connect(comp); comp.connect(this.master!);
    this.gtBus = body;
    return body;
  }
  /** one plucked string: `vel` 0..1 how hard (louder and brighter), `vol` 0..1 the listener's distance falloff, `delay` seconds */
  pluck(midi: number, vel: number, vol = 1, delay = 0) {
    const c = this.ctx; if (!c || !this.master || vol < 0.01) return;
    const src = c.createBufferSource(); src.buffer = this.stringBuf(midi);
    // the loop is a whole number of samples (less the half sample the averaging filter takes off): retune with the playback rate
    const f = 440 * 2 ** ((midi - 69) / 12), P = Math.max(2, Math.round(c.sampleRate / f + 0.5));
    src.playbackRate.value = ((P - 0.5) * f) / c.sampleRate;
    const tone = c.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 1400 + 4200 * vel; tone.Q.value = 0.4;
    const g = c.createGain(); g.gain.value = (0.05 + 0.11 * vel) * vol;
    src.connect(tone); tone.connect(g); g.connect(this.guitarBus());
    const t = c.currentTime + delay;
    src.start(t); src.stop(t + src.buffer!.duration);
  }
}
