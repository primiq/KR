// The warp pipe and the secret level. While Mario is about, a green warp pipe stands by the old hut with the odd door. Lead
// him to it (he follows you) and everybody near it jumps in after him: the game turns into a side-scrolling platformer, a
// screen of its own (a floating screen in VR). Run and jump right through one level together with Mario - platforms, pipes,
// gaps, ? blocks, coins - to the flag at the end. When everybody has reached it, Mario thanks you all and you are back on
// the island by the pipe; Mario goes home and the sky clears.
// Multiplayer: the host decides when it starts (who is in) and when it ends, and runs Mario; every player runs their own
// little character and tells the others where it is; coins and ? blocks are shared (event 'ml').
// Babylon port: Castaway's code. The pipe is drawn by render/mirror.ts; in VR the level's canvas is a screen named
// 'warpScreen' (the mirror re-uploads it whenever the canvas texture's version changes).
import * as THREE from 'three';
import { heightAt, slopeAt } from './island';
import type { ColliderGrid } from './vegetation';

/** player flag: away in the secret level (the 3D body is hidden) */
export const F_LEVEL = 1 << 30;

// ------------------------------------------------------------------ the level
const TS = 16, VW = 480, VH = 270, LH = 15, GY = 13, TOP = 30;          // tile px, view, rows, the ground row, HUD band
const AIR = 0, GND = 1, BRK = 2, QB = 3, USED = 4, PIPE = 5, HARD = 6, LIP = 7;
const GRAV = 48, JUMP = 20.5, CUT = 7, WALK = 6.5, RUN = 9.5, MAXF = 22;

interface Level { w: number; t: Uint8Array; coins: { x: number; y: number; got: boolean }[]; checks: number[]; flagX: number; castleX: number }

function buildLevel(): Level {
  const w = 216, t = new Uint8Array(w * LH);
  const set = (x: number, y: number, v: number) => { if (x >= 0 && x < w && y >= 0 && y < LH) t[y * w + x] = v; };
  const coins: Level['coins'] = [];
  const coin = (x: number, y: number) => coins.push({ x, y, got: false });
  for (let x = 0; x < w; x++) { set(x, GY, GND); set(x, GY + 1, GND); }
  const hole = (a: number, b: number) => { for (let x = a; x <= b; x++) { set(x, GY, AIR); set(x, GY + 1, AIR); } };
  const pipe = (x: number, h: number) => { for (let y = GY - h; y < GY; y++) { set(x, y, y === GY - h ? LIP : PIPE); set(x + 1, y, y === GY - h ? LIP : PIPE); } };
  const row = (a: number, b: number, y: number, v: number) => { for (let x = a; x <= b; x++) set(x, y, v); };
  const up = (x0: number, n: number, dir = 1) => { for (let i = 0; i < n; i++) { const h = dir > 0 ? i + 1 : n - i; for (let k = 0; k < h; k++) set(x0 + i, GY - 1 - k, HARD); } };
  // the opening: a ? block, a row of bricks with two more, one high up
  for (let x = 9; x <= 13; x++) coin(x, 11);
  set(16, 9, QB); row(20, 24, 9, BRK); set(21, 9, QB); set(23, 9, QB); set(22, 5, QB);
  // pipes, each a bit taller
  pipe(28, 2); pipe(38, 3); pipe(46, 4); pipe(57, 4);
  for (let x = 31; x <= 35; x++) coin(x, 11); for (let x = 41; x <= 44; x++) coin(x, 10); for (let x = 50; x <= 54; x++) coin(x, 7);
  // a first gap, with an arc of coins over it
  hole(68, 70); [[66, 10], [67, 9], [68, 8], [69, 8], [70, 8], [71, 9], [72, 10]].forEach(([x, y]) => coin(x, y));
  // bricks low and high, a long gap under the high ones
  row(77, 79, 9, BRK); set(78, 9, QB); row(81, 88, 5, BRK); for (let x = 81; x <= 88; x++) coin(x, 4);
  hole(85, 87);
  row(92, 94, 9, BRK); set(97, 9, QB); set(100, 9, QB); set(103, 9, QB); set(100, 5, QB);
  // stairs up and down, then up again over a gap
  up(110, 4, 1); up(116, 4, -1); up(124, 4, 1); set(128, GY - 1, HARD); set(128, GY - 2, HARD); set(128, GY - 3, HARD); set(128, GY - 4, HARD);
  hole(129, 130); up(131, 4, -1);
  [[129, 7], [130, 7]].forEach(([x, y]) => coin(x, y));
  pipe(138, 2); for (let x = 141; x <= 146; x++) coin(x, 10);
  // the long pit with stepping stones
  hole(149, 165);
  row(150, 152, 11, HARD); row(156, 158, 9, HARD); row(162, 164, 11, HARD);
  for (const x of [151, 157, 163]) coin(x, x === 157 ? 7 : 9);
  // the great staircase to the flag
  up(170, 8, 1); for (let k = 0; k < 8; k++) set(178, GY - 1 - k, HARD);
  for (let x = 171; x <= 177; x++) coin(x, GY - 3 - (x - 170));
  const flagX = 186, castleX = 192;
  set(flagX, GY - 1, HARD);
  return { w, t, coins, checks: [2, 60, 106, 146, 167], flagX, castleX };
}

interface Body { x: number; y: number; vx: number; vy: number; g: boolean; face: number; walk: number; state: 'play' | 'flag' | 'walk' | 'gone'; coyote: number; buf: number; blink: number; jumpWas: boolean }
const BW = 0.72, BH = 0.95;
const newBody = (x: number): Body => ({ x, y: GY - BH - 0.01, vx: 0, vy: 0, g: true, face: 1, walk: 0, state: 'play', coyote: 0, buf: 0, blink: 0, jumpWas: false });

interface Pal { cap: string; shirt: string; over: string; skin: string; hair: string; mustache: boolean }
const MARIO: Pal = { cap: '#d82800', shirt: '#d82800', over: '#2038ec', skin: '#ffcc9c', hair: '#6b3a10', mustache: true };

// ------------------------------------------------------------------ the pipe on the island
const _f = new THREE.Vector3(), _want = new THREE.Vector3(), _to = new THREE.Vector3();

export class Warp {
  /** am I in the level right now */
  inLevel = false;
  /** the level is running (somebody is in it) */
  running = false;
  /** the host / solo player decides; clients follow */
  remote = false;
  myId = 0;
  onEvent: ((e: Record<string, unknown>) => void) | null = null;
  /** who is still connected */
  present: (id: number) => boolean = () => true;
  /** a player's name and colour */
  who: (id: number) => { name: string; color: string } = () => ({ name: 'You', color: '#3cb043' });
  say: ((t: string) => void) | null = null;
  sfx: { jump8(): void; coin(): void; bump8(): void; pipe8(): void; flag8(): void; clear8(): void } | null = null;
  /** Mario speaks */
  voice: ((line: 'start' | 'thanks') => void) | null = null;
  /** set by the game when it should go back to the island */
  onExit: (() => void) | null = null;
  /** host: the level is over, Mario goes home */
  onFinished: (() => void) | null = null;

  readonly group = new THREE.Group();
  pipeAt: { x: number; y: number; z: number } | null = null;
  private col: { x: number; z: number; r: number } | null = null;

  // the level
  private L: Level = buildLevel();
  private me = newBody(2);
  private mario = newBody(4);
  private marioNet = { x: 4, y: 0, f: 1, a: 0 };
  private others = new Map<number, { x: number; y: number; tx: number; ty: number; f: number; a: number; done: boolean; t: number }>();
  private ids: number[] = [];
  private done = new Set<number>();
  private tally = new Map<number, number>();
  private pops: { x: number; y: number; t: number }[] = [];
  private bumps = new Map<number, number>();
  private t = 0;
  private sendT = 0;
  private endT = -1;
  private flagY = 2;
  private qcoin = new Set<number>();
  private mWait = 0;

  // drawing: a canvas (an overlay on screen, a texture in VR)
  readonly canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private overlay: HTMLDivElement;
  private vrMesh: THREE.Mesh | null = null;
  private tex: THREE.CanvasTexture | null = null;

  constructor(private scene: THREE.Scene, private colliders: ColliderGrid, shadows: boolean) {
    this.canvas.width = VW; this.canvas.height = VH;
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
    this.overlay = document.createElement('div');
    this.overlay.id = 'warp';
    this.overlay.appendChild(this.canvas);
    document.body.appendChild(this.overlay);
    // the pipe: a fat green tube with a lip, dark inside
    const green = (c: string, k = 0.25) => { const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.35, metalness: 0.05 }); m.emissive = new THREE.Color(c).multiplyScalar(k * 0.5); return m; };
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 1.7, 28), green('#20a838'));
    body.position.y = 0.85;
    const lip = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.42, 28), green('#2cc048'));
    lip.position.y = 1.7 + 0.21;
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.86, 28), new THREE.MeshBasicMaterial({ color: '#04150a' }));
    hole.rotation.x = -Math.PI / 2; hole.position.y = 2.125;
    const shine = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.6, 0.05), green('#9be870', 0.5));
    shine.position.set(-0.45, 0.85, 0.7); shine.rotation.y = -0.6;
    for (const m of [body, lip, shine]) { m.castShadow = shadows; m.receiveShadow = shadows; }
    this.group.add(body, lip, hole, shine);
    this.group.visible = false;
    scene.add(this.group);
  }

  /** where the pipe goes: on open, level ground a little way from the hut with the odd door (the same spot for everybody) */
  place(hut: { hx: number; hz: number; yaw: number } | null) {
    if (this.pipeAt || !hut) return;
    const tmp = { x: 0, z: 0 };
    for (let r = 7; r <= 16 && !this.pipeAt; r += 1.5) {
      for (let k = 0; k < 24; k++) {
        const a = hut.yaw + (k / 24) * Math.PI * 2, x = hut.hx + Math.sin(a) * r, z = hut.hz + Math.cos(a) * r;
        const h = heightAt(x, z);
        if (h < 0.8 || slopeAt(x, z, 1.2) > 0.22) continue;
        this.colliders.resolve(x, z, 1.4, tmp);
        if (Math.abs(tmp.x - x) + Math.abs(tmp.z - z) > 1e-3) continue;
        this.pipeAt = { x, y: h, z };
        break;
      }
    }
    if (!this.pipeAt) this.pipeAt = { x: hut.hx + Math.sin(hut.yaw) * 6, y: heightAt(hut.hx + Math.sin(hut.yaw) * 6, hut.hz + Math.cos(hut.yaw) * 6), z: hut.hz + Math.cos(hut.yaw) * 6 };
    this.group.position.set(this.pipeAt.x, this.pipeAt.y - 0.05, this.pipeAt.z);
  }
  /** show the pipe (Mario is about) or take it away */
  setShown(on: boolean) {
    if (this.group.visible === on) return;
    this.group.visible = on;
    if (on && this.pipeAt && !this.col) { this.col = { x: this.pipeAt.x, z: this.pipeAt.z, r: 1.05 }; this.colliders.add(this.col); }
    if (!on && this.col) { this.colliders.remove(this.col); this.col = null; }
  }

  // -------------------------------------------------------------- starting and ending
  /** host: Mario has reached the pipe with players round it: everybody within reach goes in */
  hostStart(ids: number[]) {
    if (this.running || !ids.length) return;
    this.onEvent?.({ op: 'start', ids });
    this.begin(ids);
  }
  private begin(ids: number[]) {
    this.running = true; this.ids = ids.slice(); this.done.clear(); this.tally.clear(); this.others.clear();
    this.L = buildLevel(); this.qcoin.clear(); this.bumps.clear(); this.pops.length = 0;
    this.mario = newBody(4); this.marioNet = { x: 4, y: this.mario.y, f: 1, a: 0 };
    this.t = 0; this.endT = -1; this.flagY = 2;
    for (const id of ids) this.tally.set(id, 0);
    this.inLevel = ids.includes(this.myId);
    this.sfx?.pipe8();
    if (this.inLevel) {
      const k = ids.indexOf(this.myId);
      this.me = newBody(1.2 + k * 0.9);
      this.overlay.classList.add('on'); document.body.classList.add('inwarp');
      this.voice?.('start');
    } else this.say?.('Mario and your friends jumped into the pipe!');
  }
  /** everybody back to the island */
  private finish() {
    const was = this.inLevel;
    this.running = false; this.inLevel = false;
    this.overlay.classList.remove('on'); document.body.classList.remove('inwarp');
    if (this.vrMesh) this.vrMesh.visible = false;
    if (was) this.onExit?.();
    if (!this.remote) this.onFinished?.();
  }

  // -------------------------------------------------------------- every frame
  /**
   * `ctl`: the stick / keys (x -1..1), jump held, run held. `vr`: show the level on a floating screen in front of `head`,
   * facing along `fwd`.
   */
  update(dt: number, ctl: { x: number; jump: boolean; run: boolean }, vr: { on: boolean; head: { x: number; y: number; z: number }; fwd: { x: number; y: number; z: number } } | null) {
    if (!this.running) return;
    dt = Math.min(dt, 1 / 30);
    this.t += dt;
    // others: drop anybody who left
    this.ids = this.ids.filter((id) => id === this.myId || this.present(id));
    // ---- me
    if (this.inLevel) this.step(this.me, dt, this.me.state === 'play' ? ctl : { x: 0, jump: false, run: false }, true);
    // ---- Mario: the host runs him, everybody else follows
    if (!this.remote) this.thinkMario(dt);
    else {
      const m = this.mario, k = Math.min(1, dt * 12);
      m.x += (this.marioNet.x - m.x) * k; m.y += (this.marioNet.y - m.y) * k; m.face = this.marioNet.f;
      m.walk += Math.abs(this.marioNet.x - m.x) > 0.02 ? dt * 10 : 0; m.g = this.marioNet.a !== 2;
    }
    for (const o of this.others.values()) { const k = Math.min(1, dt * 12); o.x += (o.tx - o.x) * k; o.y += (o.ty - o.y) * k; }
    // ---- tell the others where I am, ~12 times a second
    this.sendT -= dt;
    if (this.sendT <= 0) {
      this.sendT = 0.08;
      if (this.inLevel) this.onEvent?.({ op: 'p', x: +this.me.x.toFixed(2), y: +this.me.y.toFixed(2), f: this.me.face, a: this.me.g ? (Math.abs(this.me.vx) > 0.5 ? 1 : 0) : 2, d: this.me.state === 'play' ? 0 : 1 });
      if (!this.remote) this.onEvent?.({ op: 'm', x: +this.mario.x.toFixed(2), y: +this.mario.y.toFixed(2), f: this.mario.face, a: this.mario.g ? (Math.abs(this.mario.vx) > 0.5 ? 1 : 0) : 2 });
    }
    // ---- the end
    if (!this.remote && this.endT < 0) {
      const all = this.ids.length > 0 && this.ids.every((id) => this.done.has(id));
      if (all && this.mario.state === 'gone' || this.t > 600 || this.ids.length === 0) { this.endT = 0; this.onEvent?.({ op: 'end' }); this.outro(); }
    }
    if (this.endT >= 0) {
      this.endT += dt;
      if (this.endT > 6.5) this.finish();
    }
    for (const p of this.pops) p.t += dt;
    this.pops = this.pops.filter((p) => p.t < 0.6);
    for (const [k, v] of this.bumps) { if (v - dt <= 0) this.bumps.delete(k); else this.bumps.set(k, v - dt); }
    if (this.flagY < 11.5 && this.done.size) this.flagY = Math.min(11.5, this.flagY + dt * 9);
    // ---- draw
    if (this.inLevel) {
      this.draw();
      if (vr?.on) this.showVR(vr.head, vr.fwd); else if (this.vrMesh) this.vrMesh.visible = false;
    }
  }
  private outro() {
    this.voice?.('thanks');
    this.sfx?.clear8();
  }

  // -------------------------------------------------------------- physics
  private solid(x: number, y: number) {
    if (x < 0 || x >= this.L.w) return true;
    if (y < 0 || y >= LH) return false;
    const v = this.L.t[y * this.L.w + x];
    return v !== AIR;
  }
  private step(b: Body, dt: number, ctl: { x: number; jump: boolean; run: boolean }, mine: boolean) {
    b.blink = Math.max(0, b.blink - dt);
    if (b.state === 'gone') return;
    if (b.state === 'flag') {
      // sliding down the pole, then off to the castle
      b.vx = 0; b.x = this.L.flagX - BW + 0.35; b.y = Math.min(GY - 1 - BH, b.y + dt * 9);
      if (b.y >= GY - 1 - BH - 0.01) { b.state = 'walk'; b.x = this.L.flagX + 0.7; b.y = GY - 1 - BH; }
      return;
    }
    if (b.state === 'walk') {
      b.face = 1; b.vx = 3.2; ctl = { x: 1, jump: false, run: false };
      if (b.x > this.L.castleX + 2.2) { b.state = 'gone'; return; }
    }
    const want = ctl.x * (ctl.run ? RUN : WALK);
    const acc = b.g ? 34 : 20;
    b.vx += Math.max(-acc * dt, Math.min(acc * dt, want - b.vx));
    if (Math.abs(ctl.x) > 0.2) b.face = ctl.x > 0 ? 1 : -1;
    // jump: a press just before landing or just after running off an edge still counts; let go early for a little hop
    const press = ctl.jump && !b.jumpWas; b.jumpWas = ctl.jump;
    b.coyote = b.g ? 0.1 : b.coyote - dt;
    b.buf = press ? 0.12 : b.buf - dt;
    if (b.buf > 0 && b.coyote > 0) { b.vy = -JUMP; b.g = false; b.coyote = 0; b.buf = 0; if (mine) this.sfx?.jump8(); }
    if (!ctl.jump && b.vy < -CUT) b.vy = -CUT;
    b.vy = Math.min(MAXF, b.vy + GRAV * dt);
    // x, then y, against the tiles
    b.x += b.vx * dt;
    const y0 = Math.floor(b.y + 0.02), y1 = Math.floor(b.y + BH - 0.02);
    if (b.vx > 0) { const tx = Math.floor(b.x + BW); for (let ty = y0; ty <= y1; ty++) if (this.solid(tx, ty)) { b.x = tx - BW - 1e-3; b.vx = 0; break; } }
    else if (b.vx < 0) { const tx = Math.floor(b.x); for (let ty = y0; ty <= y1; ty++) if (this.solid(tx, ty)) { b.x = tx + 1 + 1e-3; b.vx = 0; break; } }
    b.x = Math.max(0, Math.min(this.L.w - 1, b.x));
    b.y += b.vy * dt;
    const x0 = Math.floor(b.x + 0.02), x1 = Math.floor(b.x + BW - 0.02);
    b.g = false;
    if (b.vy >= 0) { const ty = Math.floor(b.y + BH); for (let tx = x0; tx <= x1; tx++) if (this.solid(tx, ty)) { b.y = ty - BH; b.vy = 0; b.g = true; break; } }
    else {
      const ty = Math.floor(b.y);
      let hit = -1;
      for (let tx = x0; tx <= x1; tx++) if (this.solid(tx, ty)) { hit = tx; if (tx === Math.floor(b.x + BW / 2)) break; }
      if (hit >= 0) { b.y = ty + 1; b.vy = 1; if (mine) this.bump(hit, ty, true); }
    }
    b.walk += b.g ? Math.abs(b.vx) * dt * 1.6 : 0;
    // fell down a gap: back at the last checkpoint (Mario: next to whoever is furthest on)
    if (b.y > LH + 2) {
      if (mine) { const c = this.L.checks.filter((x) => x <= b.x + 1).pop() ?? 2; b.x = c; b.y = GY - BH - 4; b.vx = b.vy = 0; b.blink = 1.5; }
      else this.marioRescue();
    }
    if (mine) {
      // coins
      for (let i = 0; i < this.L.coins.length; i++) {
        const c = this.L.coins[i];
        if (!c.got && Math.abs(c.x + 0.5 - (b.x + BW / 2)) < 0.75 && Math.abs(c.y + 0.5 - (b.y + BH / 2)) < 0.85) { c.got = true; this.gotCoin(this.myId); this.onEvent?.({ op: 'c', i }); }
      }
      // the flag
      if (b.state === 'play' && b.x + BW >= this.L.flagX + 0.3) {
        b.state = 'flag'; this.done.add(this.myId); this.sfx?.flag8();
        this.onEvent?.({ op: 'f' });
      }
    }
  }
  private gotCoin(id: number) { this.tally.set(id, (this.tally.get(id) ?? 0) + 1); if (id === this.myId) this.sfx?.coin(); }
  /** a head under a block: a ? gives a coin and goes dull; a brick just bounces */
  private bump(tx: number, ty: number, mine: boolean) {
    const i = ty * this.L.w + tx, v = this.L.t[i];
    if (v === QB) {
      this.L.t[i] = USED; this.pops.push({ x: tx, y: ty - 1, t: 0 }); this.bumps.set(i, 0.15);
      if (mine) { this.gotCoin(this.myId); this.onEvent?.({ op: 'q', i }); }
    } else if (v === BRK) { this.bumps.set(i, 0.15); if (mine) this.sfx?.bump8(); }
    else if (mine) this.sfx?.bump8();
  }

  // -------------------------------------------------------------- Mario (host)
  private thinkMario(dt: number) {
    const m = this.mario;
    // where is everybody? he keeps up with whoever is in front (a little behind them), and heads for the flag once all are there
    let lead = -1, back = 1e9;
    const pos: number[] = [];
    if (this.inLevel && this.me.state === 'play') pos.push(this.me.x);
    for (const [id, o] of this.others) if (this.ids.includes(id) && !o.done) pos.push(o.x);
    for (const x of pos) { lead = Math.max(lead, x); back = Math.min(back, x); }
    const allDone = this.ids.length > 0 && this.ids.every((id) => this.done.has(id));
    let goal = allDone || !pos.length ? this.L.flagX + 1 : Math.min(this.L.flagX - 2, lead - 1.2);
    if (!allDone && pos.length && lead - back > 14) goal = back + 3;      // don't leave the slow ones behind
    const d = goal - m.x;
    let x = Math.abs(d) > 0.8 ? Math.sign(d) : 0;
    if (m.state !== 'play') x = 0;
    // jump when there is a wall, a gap or a block ahead, or when stuck
    let jump = false;
    if (x !== 0) {
      const fx = Math.floor(m.x + BW / 2 + x * 1.1), fy = Math.floor(m.y + BH - 0.05);
      const wall = this.solid(fx, fy) || this.solid(fx, fy - 1);
      const stuck = Math.abs(m.vx) < 0.5 && m.g;
      jump = wall || !this.solid(fx, fy + 1) || stuck || (!m.g && m.vy < 0);
      if (m.g && m.jumpWas) jump = false;                                      // let go for a moment on landing, so he can jump again
    }
    // everybody is at the flag and he is still a long way back: he takes a short cut (a warp of his own)
    if (allDone) { this.mWait += dt; if (this.mWait > 5 && m.state === 'play' && m.x < this.L.flagX - 8) { m.x = this.L.flagX - 1.5; m.y = 2; m.vx = m.vy = 0; m.blink = 1; this.mWait = -1e9; } } else this.mWait = 0;
    this.step(m, dt, { x, jump, run: Math.abs(d) > 5 }, false);
    if (m.state === 'play' && m.x + BW >= this.L.flagX + 0.3 && allDone) m.state = 'flag';
  }
  /** Mario fell: he pops up next to whoever is furthest along (on solid ground) */
  private marioRescue() {
    const m = this.mario;
    let x = this.inLevel ? this.me.x : 2;
    for (const o of this.others.values()) x = Math.max(x, o.x);
    x = Math.max(2, x - 1.5);
    let tx = Math.floor(x);
    while (tx > 0 && !this.solid(tx, GY)) tx--;
    m.x = tx; m.y = GY - BH - 3; m.vx = m.vy = 0; m.blink = 1.5;
  }

  // -------------------------------------------------------------- network
  net(e: Record<string, any>, from: number) {
    switch (e.op) {
      case 'start': if (Array.isArray(e.ids) && !this.running) this.begin(e.ids.map(Number)); break;
      case 'p': {
        if (!this.running) break;
        let o = this.others.get(from);
        if (!o) { o = { x: +e.x, y: +e.y, tx: +e.x, ty: +e.y, f: 1, a: 0, done: false, t: 0 }; this.others.set(from, o); }
        o.tx = +e.x; o.ty = +e.y; o.f = +e.f || 1; o.a = +e.a || 0; o.done = !!e.d;
        if (e.d) this.done.add(from);
        break;
      }
      case 'm': if (this.remote) this.marioNet = { x: +e.x, y: +e.y, f: +e.f || 1, a: +e.a || 0 }; break;
      case 'c': { const c = this.L.coins[+e.i]; if (c && !c.got) { c.got = true; this.gotCoin(from); } break; }
      case 'q': { const i = +e.i; if (this.L.t[i] === QB) { this.L.t[i] = USED; this.pops.push({ x: i % this.L.w, y: Math.floor(i / this.L.w) - 1, t: 0 }); this.gotCoin(from); } break; }
      case 'f': this.done.add(from); this.flagY = Math.max(this.flagY, 2); break;
      case 'end': if (this.running && this.endT < 0) { this.endT = 0; this.outro(); } break;
    }
  }

  // -------------------------------------------------------------- drawing
  private showVR(head: { x: number; y: number; z: number }, fwd: { x: number; y: number; z: number }) {
    if (!this.vrMesh) {
      this.tex = new THREE.CanvasTexture(this.canvas);
      this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.magFilter = THREE.NearestFilter; this.tex.minFilter = THREE.LinearFilter;
      const m = new THREE.MeshBasicMaterial({ name: 'warpScreen', map: this.tex, side: THREE.DoubleSide, depthTest: false });
      m.toneMapped = false; m.fog = false;
      this.vrMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.92, 1.08), m);
      this.vrMesh.renderOrder = 70; this.vrMesh.frustumCulled = false;
      this.vrMesh.visible = false;          // (hidden until it is put in front of you just below)
      this.scene.add(this.vrMesh);
    }
    const f = _f.set(fwd.x, 0, fwd.z); if (f.lengthSq() < 1e-4) f.set(0, 0, -1); f.normalize();
    _want.set(head.x + f.x * 1.5, head.y - 0.05, head.z + f.z * 1.5);
    const M = this.vrMesh;
    if (!M.visible) {
      // straight in front of your eyes as you go in
      M.position.copy(_want); M.visible = true; this.vrFollow = false;
    } else {
      // it stays locked to your view: look away (or get moved) and it glides back in front of you
      _to.set(M.position.x - head.x, 0, M.position.z - head.z);
      const off = Math.abs(M.position.y - _want.y), dist = _to.length(), ang = dist > 1e-3 ? Math.acos(Math.max(-1, Math.min(1, _to.dot(f) / dist))) : Math.PI;
      if (ang > 0.45 || Math.abs(dist - 1.5) > 0.4 || off > 0.3) this.vrFollow = true;
      if (this.vrFollow) {
        M.position.lerp(_want, 0.12);
        if (M.position.distanceTo(_want) < 0.03) this.vrFollow = false;
      }
    }
    M.lookAt(head.x, M.position.y, head.z);
    this.tex!.needsUpdate = true;
  }
  private vrFollow = false;

  private draw() {
    const c = this.ctx, L = this.L, me = this.me;
    const camX = Math.max(0, Math.min(L.w - VW / TS, me.x + BW / 2 - VW / TS / 2));
    const ox = -camX * TS;
    // sky, clouds and hills (slower: they are far away)
    // a deeper, natural blue overhead, paler down by the hills
    const sky = c.createLinearGradient(0, 0, 0, TOP + GY * TS);
    sky.addColorStop(0, '#1d5fd0'); sky.addColorStop(0.65, '#4b8fe6'); sky.addColorStop(1, '#8cc2f2');
    c.fillStyle = sky; c.fillRect(0, 0, VW, VH);
    for (let k = -1; k < 12; k++) {
      const cx = ((k * 211 - camX * TS * 0.5) % (12 * 211)), x = cx < -80 ? cx + 12 * 211 : cx;
      this.cloud(x, 46 + (k % 3) * 14);
    }
    for (let k = -1; k < 14; k++) {
      const hx = k * 190 - (camX * TS * 0.75) % 190;
      const hh = 36 + (k % 2) * 16;
      c.fillStyle = '#0d5a1c'; c.beginPath(); c.ellipse(hx, TOP + GY * TS, 72, hh + 2, 0, Math.PI, 0); c.fill();        // a dark rim
      const hg = c.createLinearGradient(0, TOP + GY * TS - hh, 0, TOP + GY * TS);
      hg.addColorStop(0, '#34a845'); hg.addColorStop(1, '#1f7f30');
      c.fillStyle = hg; c.beginPath(); c.ellipse(hx, TOP + GY * TS, 70, hh, 0, Math.PI, 0); c.fill();
      c.fillStyle = '#145c22'; c.fillRect(hx - 18, TOP + GY * TS - 26, 4, 8); c.fillRect(hx + 10, TOP + GY * TS - 30, 4, 8);
    }
    // tiles
    const x0 = Math.floor(camX), x1 = Math.min(L.w - 1, x0 + Math.ceil(VW / TS) + 1);
    for (let ty = 0; ty < LH; ty++) for (let tx = x0; tx <= x1; tx++) {
      const v = L.t[ty * L.w + tx]; if (v === AIR) continue;
      const lift = this.bumps.has(ty * L.w + tx) ? -4 : 0;
      this.tile(v, Math.round(tx * TS + ox), TOP + ty * TS + lift, tx, ty);
    }
    // the flag and the castle
    const fx = Math.round(L.flagX * TS + ox + TS / 2);
    c.fillStyle = '#9ad01a'; c.fillRect(fx - 1, TOP + 1 * TS + 6, 3, (GY - 2) * TS - 6);
    c.fillStyle = '#1e8a1e'; c.beginPath(); c.arc(fx + 0.5, TOP + TS + 5, 4, 0, 7); c.fill();
    const fy = TOP + this.flagY * TS;
    c.fillStyle = '#ffffff'; c.beginPath(); c.moveTo(fx - 1, fy); c.lineTo(fx - 17, fy + 7); c.lineTo(fx - 1, fy + 14); c.fill();
    c.fillStyle = '#1e8a1e'; c.beginPath(); c.arc(fx - 7, fy + 7, 3, 0, 7); c.fill();
    this.castle(Math.round(L.castleX * TS + ox), TOP + GY * TS);
    // coins
    for (const k of L.coins) {
      if (k.got) continue;
      const px = k.x * TS + ox; if (px < -16 || px > VW) continue;
      const s = Math.abs(Math.sin(this.t * 4 + k.x * 0.7));
      c.fillStyle = '#fcbc3c'; c.beginPath(); c.ellipse(px + 8, TOP + k.y * TS + 8, 1 + 4 * s, 7, 0, 0, 7); c.fill();
      c.fillStyle = '#fff3b0'; c.fillRect(px + 7, TOP + k.y * TS + 4, 1, 6);
    }
    for (const p of this.pops) { c.fillStyle = '#fcbc3c'; c.beginPath(); c.ellipse(p.x * TS + ox + 8, TOP + (p.y - p.t * 3) * TS + 8, 3, 7, 0, 0, 7); c.fill(); }
    // the others, Mario, me
    for (const [id, o] of this.others) {
      if (!this.ids.includes(id) || (o.done && o.x > L.castleX + 2)) continue;
      const w = this.who(id);
      this.guy(o.x * TS + ox, TOP + o.y * TS, o.f, o.a === 1 ? Math.floor(this.t * 10) % 2 : 0, o.a === 2, this.pal(w.color), w.name, w.color);
    }
    const m = this.mario;
    if (m.state !== 'gone' && (m.blink <= 0 || Math.floor(this.t * 12) % 2)) this.guy(m.x * TS + ox, TOP + m.y * TS, m.face, m.g && Math.abs(this.remote ? 1 : m.vx) > 0.5 ? Math.floor(m.walk * 2) % 2 : 0, !m.g, MARIO, 'Mario', '#d82800');
    if (me.state !== 'gone' && (me.blink <= 0 || Math.floor(this.t * 12) % 2)) this.guy(me.x * TS + ox, TOP + me.y * TS, me.face, me.g && Math.abs(me.vx) > 0.5 ? Math.floor(me.walk * 2) % 2 : 0, !me.g, this.pal(this.who(this.myId).color), this.who(this.myId).name, '#ffd23f', true);
    // HUD band
    c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(0, 0, VW, TOP - 4);
    c.fillStyle = '#fff'; c.font = 'bold 11px monospace'; c.textBaseline = 'middle';
    c.textAlign = 'left'; c.fillText(`COINS x${this.tally.get(this.myId) ?? 0}`, 10, 13);
    c.textAlign = 'center'; c.fillText('SECRET LEVEL 1-1', VW / 2 - 20, 13);
    c.textAlign = 'right'; c.fillText(`FLAG ${this.done.size}/${this.ids.length}`, VW - 64, 13);      // (clear of the menu buttons)
    // messages (Mario's speech sits above his name tag)
    if (this.t < 3 && m.x * TS + ox > -10 && m.x * TS + ox < VW) this.bubble(m.x * TS + ox + 6, TOP + m.y * TS - 20, "Let's-a go!");
    if (this.me.state === 'gone' && this.endT < 0) this.banner('You made it! Waiting for the others...');
    if (this.endT >= 0) {
      const mx = this.mario.state === 'gone' ? L.castleX * TS + ox + 40 : m.x * TS + ox + 6, my = this.mario.state === 'gone' ? TOP + (GY - 4) * TS : TOP + m.y * TS - 20;
      this.bubble(mx, my, 'Thank you, everybody!');
      const rows = this.ids.map((id) => `${id === this.myId ? 'You' : this.who(id).name}: ${this.tally.get(id) ?? 0} coins`);
      this.banner('COURSE CLEAR!', rows);
    }
    c.textBaseline = 'alphabetic'; c.textAlign = 'left';
  }
  private pal(col: string): Pal { return { cap: col, shirt: col, over: '#33407e', skin: '#f2c29a', hair: '#5a3a1a', mustache: false }; }
  private cloud(x: number, y: number) {
    const c = this.ctx;
    // a soft blue-grey underside, then the white puffs on top
    c.fillStyle = '#b9d0ec'; c.beginPath(); c.arc(x, y + 2, 10, 0, 7); c.arc(x + 12, y - 4, 12, 0, 7); c.arc(x + 26, y + 2, 10, 0, 7); c.fill(); c.fillRect(x - 6, y + 2, 40, 8);
    c.fillStyle = '#ffffff';
    c.beginPath(); c.arc(x, y, 10, 0, 7); c.arc(x + 12, y - 6, 12, 0, 7); c.arc(x + 26, y, 10, 0, 7); c.fill();
    c.fillRect(x - 6, y, 40, 6);
  }
  private castle(x: number, ground: number) {
    const c = this.ctx;
    c.fillStyle = '#c84c0c'; c.fillRect(x, ground - 80, 80, 80);
    c.fillStyle = '#7a2a00';
    for (let y = ground - 80; y < ground; y += 8) c.fillRect(x, y, 80, 1);
    for (let k = 0; k < 5; k++) c.fillRect(x + k * 16 + 4, ground - 96, 10, 16);
    c.fillStyle = '#c84c0c'; for (let k = 0; k < 5; k++) c.fillRect(x + k * 16 + 4, ground - 95, 9, 14);
    c.fillStyle = '#000'; c.beginPath(); c.arc(x + 40, ground - 22, 12, Math.PI, 0); c.fill(); c.fillRect(x + 28, ground - 22, 24, 22);
    c.fillRect(x + 14, ground - 60, 8, 14); c.fillRect(x + 58, ground - 60, 8, 14);
  }
  private tile(v: number, x: number, y: number, tx: number, ty: number) {
    const c = this.ctx;
    if (v === GND || v === BRK) {
      c.fillStyle = '#c84c0c'; c.fillRect(x, y, 16, 16);
      c.fillStyle = '#000';
      if (v === BRK) { c.fillRect(x, y + 7, 16, 1); c.fillRect(x, y + 15, 16, 1); c.fillRect(x + 7, y, 1, 7); c.fillRect(x + 3, y + 8, 1, 7); c.fillRect(x + 11, y + 8, 1, 7); }
      else { c.fillRect(x + 15, y, 1, 16); c.fillRect(x, y + 15, 16, 1); c.fillStyle = '#fca044'; c.fillRect(x, y, 15, 1); c.fillRect(x, y, 1, 15); }
      return;
    }
    if (v === QB) {
      const sh = 0.9 + 0.1 * Math.sin(this.t * 5);
      c.fillStyle = `rgb(${Math.round(252 * sh)},${Math.round(160 * sh)},${Math.round(68 * sh)})`; c.fillRect(x, y, 16, 16);
      c.fillStyle = '#7a2a00'; c.fillRect(x, y + 15, 16, 1); c.fillRect(x + 15, y, 1, 16);
      c.fillStyle = '#fff'; c.font = 'bold 12px monospace'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('?', x + 8, y + 9);
      c.fillStyle = '#7a2a00'; for (const [a, b] of [[2, 2], [13, 2], [2, 13], [13, 13]]) c.fillRect(x + a, y + b, 1, 1);
      return;
    }
    if (v === USED) { c.fillStyle = '#9a5a2a'; c.fillRect(x, y, 16, 16); c.fillStyle = '#5a2a0a'; c.fillRect(x, y + 15, 16, 1); c.fillRect(x + 15, y, 1, 16); return; }
    if (v === HARD) {
      c.fillStyle = '#c86a3c'; c.fillRect(x, y, 16, 16);
      c.fillStyle = '#fcbc8c'; c.fillRect(x, y, 16, 2); c.fillRect(x, y, 2, 16);
      c.fillStyle = '#6a2a0a'; c.fillRect(x, y + 14, 16, 2); c.fillRect(x + 14, y, 2, 16);
      return;
    }
    if (v === PIPE || v === LIP) {
      const left = this.pipeLeftOf(tx, ty);
      const lip = v === LIP, inset = lip ? 0 : 2;
      c.fillStyle = '#00a800';
      if (left) c.fillRect(x + inset, y, 16 - inset, 16); else c.fillRect(x, y, 16 - inset, 16);
      c.fillStyle = '#80d010'; if (left) c.fillRect(x + inset + 3, y, 3, 16);
      c.fillStyle = '#005800'; if (!left) c.fillRect(x + 16 - inset - 2, y, 2, 16); else c.fillRect(x + inset, y, 1, 16);
      if (lip) { c.fillStyle = '#005800'; c.fillRect(x, y + 15, 16, 1); c.fillRect(x, y, 16, 1); }
    }
  }
  private pipeLeftOf(tx: number, ty: number) {
    // a pipe tile is a left half when the run of pipe tiles to its left is even
    let n = 0; while (tx - n >= 0 && (this.L.t[ty * this.L.w + tx - n] === PIPE || this.L.t[ty * this.L.w + tx - n] === LIP)) n++;
    return n % 2 === 1;
  }
  /** a little character, 12 x 16 px, top-left at (x, y); frame 0 stand / 1 stride; `air`: jumping */
  private guy(x: number, y: number, face: number, frame: number, air: boolean, p: Pal, name: string, tag = '#ffffff', mine = false) {
    const c = this.ctx; x = Math.round(x); y = Math.round(y + (BH * TS - 16));
    const r = (px: number, py: number, w: number, h: number, col: string) => { c.fillStyle = col; c.fillRect(face > 0 ? x + px : x + 12 - px - w, y + py, w, h); };
    r(2, 0, 7, 2, p.cap); r(6, 2, 5, 1, p.cap);                                       // cap and its peak
    r(3, 3, 6, 4, p.skin); r(9, 4, 2, 2, p.skin);                                     // face, nose
    r(2, 3, 2, 3, p.hair); r(7, 3, 1, 2, '#000');                                     // hair, eye
    if (p.mustache) r(6, 6, 5, 1, p.hair);
    r(2, 7, 8, 4, p.shirt); r(3, 9, 6, 4, p.over); r(4, 7, 1, 2, p.over); r(7, 7, 1, 2, p.over); r(4, 9, 1, 1, '#fcd000'); r(7, 9, 1, 1, '#fcd000');
    if (air) { r(9, 2, 2, 3, p.skin); r(0, 9, 2, 2, p.skin); r(1, 12, 3, 2, p.over); r(8, 12, 3, 2, p.over); r(0, 14, 3, 2, '#5a2a0a'); r(9, 14, 3, 2, '#5a2a0a'); }
    else if (frame === 1) { r(0, 8, 2, 2, p.skin); r(10, 10, 2, 2, p.skin); r(2, 13, 3, 1, p.over); r(7, 12, 2, 2, p.over); r(1, 14, 3, 2, '#5a2a0a'); r(8, 14, 3, 2, '#5a2a0a'); }
    else { r(0, 9, 2, 2, p.skin); r(10, 9, 2, 2, p.skin); r(3, 13, 2, 1, p.over); r(7, 13, 2, 1, p.over); r(2, 14, 3, 2, '#5a2a0a'); r(7, 14, 3, 2, '#5a2a0a'); }
    if (name) {
      // a name tag over everybody: a dark pill edged in their colour (yours in gold, with a little arrow), so you can tell who is who
      c.font = 'bold 8px monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
      const label = name.length > 12 ? name.slice(0, 11) + '…' : name, w = Math.ceil(c.measureText(label).width) + 8, ty = y - (mine ? 16 : 13);
      c.fillStyle = 'rgba(10,14,30,0.78)'; c.beginPath(); c.roundRect(x + 6 - w / 2, ty - 5, w, 10, 4); c.fill();
      c.strokeStyle = tag; c.lineWidth = 1; c.stroke();
      c.fillStyle = mine ? tag : '#ffffff'; c.fillText(label, x + 6, ty + 0.5);
      if (mine) { c.fillStyle = tag; c.beginPath(); c.moveTo(x + 3, ty + 6); c.lineTo(x + 9, ty + 6); c.lineTo(x + 6, ty + 9); c.fill(); }
      c.textBaseline = 'alphabetic';
    }
  }
  private bubble(x: number, y: number, text: string) {
    const c = this.ctx; c.font = 'bold 10px monospace'; const w = c.measureText(text).width + 12;
    const bx = Math.max(4, Math.min(VW - w - 4, x - w / 2)), by = Math.max(TOP, y - 22);
    c.fillStyle = '#fff'; c.beginPath(); c.roundRect(bx, by, w, 16, 5); c.fill();
    c.beginPath(); c.moveTo(Math.max(bx + 6, Math.min(bx + w - 6, x)) - 3, by + 16); c.lineTo(Math.max(bx + 6, Math.min(bx + w - 6, x)), by + 21); c.lineTo(Math.max(bx + 6, Math.min(bx + w - 6, x)) + 3, by + 16); c.fill();
    c.fillStyle = '#d82800'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, bx + w / 2, by + 8.5);
  }
  private banner(title: string, rows: string[] = []) {
    const c = this.ctx, h = 26 + rows.length * 12;
    c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(VW / 2 - 130, 70, 260, h);
    c.fillStyle = '#fcbc3c'; c.font = 'bold 13px monospace'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(title, VW / 2, 82);
    c.fillStyle = '#fff'; c.font = 'bold 10px monospace';
    rows.forEach((t, i) => c.fillText(t, VW / 2, 98 + i * 12));
  }
}
