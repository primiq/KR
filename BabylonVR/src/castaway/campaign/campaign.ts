// Banana or Salmon: a co-op mini campaign behind a door in the secret room.
// "Do you prefer a banana or a salmon?" - banana makes you a gorilla, salmon a cat. Then short co-op missions that need both
// animals, started from the TV in the Cosy room (the hub), with a scoreboard and a reset button.
//
// Sharing: the progress (missions done, best times) belongs to the host (or the solo player) like the island does, and goes
// to guests in the welcome snapshot. Everything else is events (all keys start with "q"): a choice (qc), ready at the TV (qr),
// a mission starting (qs), a mission won (qd), reset votes (qx) and the reset (qz), a line for everybody in an area (qn),
// a gorilla tossing a cat (qy), and the missions' own events (they carry m = the mission index).
// Timing that has to be the same for everybody is driven by the "controller": the lowest player id in that area.
import * as THREE from 'three';
import { ChoiceRoom, Hub, CHOICE, HUB } from './rooms';
import type { Mission, Ctx, Other, Species, MTarget } from './types';
import type { Narrator, SayOpts } from '../game/narrator';
import type { Sfx } from '../game/audio';
import type { Player } from '../world/player';
import type { Space } from './space';
import { loadCampaign, saveCampaign } from '../net/save';

/** the mission registry: the TV and the scoreboard are driven by this list, so a new mission is one entry (and a Mission) */
export const MISSIONS: { title: string; place: string; built: boolean }[] = [
  { title: 'The Odd Shopping List', place: "Bootle's Chemist", built: true },
  { title: 'Night at the Museum Gift Shop', place: 'The museum, after hours', built: true },
  { title: 'Moving Day', place: 'coming soon', built: false },
  { title: 'The Great Banana Bake-off', place: 'coming soon', built: false },
  { title: 'Rooftop Chase', place: 'coming soon', built: false },
];

/** multiplayer state flags (PState.flags) */
export const F_CAMP = 8192, F_GORILLA = 16384, F_CATSP = 32768;
/** which campaign area a world x is in: 0 choice room, 1 hub, 2.. missions (2 + index); -1 none */
export function areaOf(x: number): number {
  const k = Math.round((x - CHOICE.x) / 3000);
  return k >= 0 && k <= 8 && Math.abs(x - (CHOICE.x + k * 3000)) < 400 ? k : -1;
}
export const missionX = (m: number) => CHOICE.x + (m + 2) * 3000;

export type CampTarget = { w: 'exit' } | { w: 'plinth'; i: number } | { w: 'tv' } | { w: 'reset' } | { w: 'toss'; id: number } | { w: 'm'; t: MTarget } | { w: 'score'; i: number };
type Where = 'choice' | 'hub' | 'mission' | null;
interface Best { t: number; c: number; medal: string }

export class Campaign {
  active = false;
  where: Where = null;
  /** the mission I am in (index), -1 none */
  mi = -1;
  species: Species | null = null;
  done: number[] = [];
  best: Record<number, Best> = {};
  readonly choice: ChoiceRoom;
  readonly hub: Hub;
  readonly missions: (Mission | null)[] = MISSIONS.map(() => null);

  // ---- wired by main
  send: (e: any) => void = () => {};
  myId = () => 0;
  /** every other player (any area); the campaign filters by flags and position */
  others: () => Other[] = () => [];
  /** may this client write the shared progress to its save? (host or solo) */
  owner = () => true;
  say: (t: string) => void = () => {};
  /** the body changes: a species, or null for the usual human */
  onBody: (sp: Species | null) => void = () => {};
  fade: (on: boolean, text?: string) => void = () => {};
  haptic: (v: number) => void = () => {};
  inVR = () => false;
  /** where my carrying hand is (VR hand or in front of the eyes), world */
  carryAt: (out: THREE.Vector3) => void = () => {};
  /** game.swings++ (the others see a chest beat / a swat) */
  onEmote: () => void = () => {};
  onBeat: (() => void) | null = null;

  private choices = new Map<number, Species>();
  private countdown = -1;
  private ready = new Map<number, number>();
  private votes = new Set<number>();
  private armed = 0;
  private run: { rid: number; m: number; t0: number } | null = null;
  /** the run I walked out of (through the mission door or out of the campaign) while friends were still in it: the TV lets me back in.
   *  My copy of the mission kept up while I was away (its events still reach me), so I re-enter it as it is, not from the start. */
  private stepped: { rid: number; m: number; t0: number } | null = null;
  private doneRids = new Set<number>();
  private timers: { t: number; fn: () => void }[] = [];
  private lastPlayed = -1;
  private beatCd = 0;
  private outroLeft = -1;
  private toast: HTMLDivElement;
  readonly ctx: Ctx;

  constructor(scene: THREE.Scene, readonly narrator: Narrator, readonly sfx: Sfx, readonly player: Player) {
    this.choice = new ChoiceRoom(scene);
    this.hub = new Hub(scene);
    const s = loadCampaign();
    if (s) { this.done = s.done ?? []; this.best = s.best ?? {}; this.species = s.mine ?? null; }
    this.ctx = {
      me: () => this.myId(),
      species: () => this.species ?? 'g',
      helper: (sp) => this.helper(sp),
      others: () => this.here(),
      speciesOf: (id) => this.speciesOf(id),
      send: (e) => this.send(e),
      narrate: (id, o) => this.narrator.say(id, o),
      narrateAll: (id, o) => this.narrateAll(id, o),
      say: (t) => this.say(t),
      sfx,
      player,
      controller: () => this.controller(),
      complete: (c) => this.complete(c),
      carry: (out) => this.carryAt(out),
      haptic: (v) => this.haptic(v),
      inVR: () => this.inVR(),
    };
    this.toast = document.createElement('div');
    this.toast.style.cssText = 'position:fixed;left:50%;top:70px;transform:translateX(-50%);z-index:5;display:none;color:#fff;font:700 18px system-ui,sans-serif;text-align:center;text-shadow:0 1px 5px rgba(0,0,0,.8);pointer-events:none;letter-spacing:.03em';
    document.body.appendChild(this.toast);
  }
  addMission(m: Mission) { this.missions[m.index] = m; }

  // ------------------------------------------------------------ who is where
  get area() { return this.where === 'choice' ? 0 : this.where === 'hub' ? 1 : this.where === 'mission' ? 2 + this.mi : -1; }
  /** state flags for multiplayer */
  get flags() { return !this.active ? 0 : F_CAMP | (this.where === 'choice' || !this.species ? 0 : this.species === 'g' ? F_GORILLA : F_CATSP | 16); }
  /** everybody else in the campaign */
  private inCamp() { return this.others().filter((o) => (o.flags & F_CAMP) !== 0 && areaOf(o.x) >= 0); }
  /** everybody else in my area */
  private here() { const a = this.area; return a < 0 ? [] : this.inCamp().filter((o) => areaOf(o.x) === a); }
  private speciesOf(id: number): Species | null {
    if (id === this.myId()) return this.where === 'choice' ? null : this.species;
    const o = this.others().find((p) => p.id === id); if (!o) return null;
    return (o.flags & F_GORILLA) ? 'g' : (o.flags & F_CATSP) ? 'c' : null;
  }
  private helper(sp: Species) {
    if (this.species === sp) return false;
    return !this.here().some((o) => this.speciesOf(o.id) === sp);
  }
  private controller() { const me = this.myId(); return this.here().every((o) => o.id > me); }
  private narrateAll(id: string, o?: SayOpts) { this.narrator.say(id, o); this.send({ k: 'qn', id, a: this.area, i: o?.interrupt ? 1 : 0, p: o?.priority ?? 0 }); }
  private later(t: number, fn: () => void) { this.timers.push({ t, fn }); }
  private get space(): Space | null {
    return this.where === 'choice' ? this.choice.space : this.where === 'hub' ? this.hub.space : this.where === 'mission' ? this.missions[this.mi]?.space ?? null : null;
  }
  contains(x: number, z: number) {
    if (this.choice.space.contains(x, z) || this.hub.space.contains(x, z)) return true;
    return this.missions.some((m) => m?.space.contains(x, z));
  }

  // ------------------------------------------------------------ progress (host's / solo)
  private save() { if (this.owner()) saveCampaign({ v: 1, done: this.done, best: this.best, mine: this.species }); else saveCampaign({ ...(loadCampaign() ?? { v: 1, done: [], best: {} }), mine: this.species }); }
  exportProgress() { return { done: this.done, best: this.best }; }
  importProgress(p: any) {
    if (!p) return;
    this.done = Array.isArray(p.done) ? p.done.filter((n: any) => typeof n === 'number') : [];
    this.best = p.best && typeof p.best === 'object' ? p.best : {};
  }
  /** the mission somebody chose on the scoreboard (shared by everybody in the lobby; cleared when it starts) */
  picked: number | null = null;
  private pickMission(i: number, remote = false) {
    if (this.where !== 'hub' && !remote) return;
    if (!MISSIONS[i]?.built || !this.missions[i]) { if (!remote) this.sfx.denied(); return; }
    this.picked = i;
    if (!remote) { this.send({ k: 'qk', m: i }); this.sfx.bell(); }
  }
  private nextMission() {
    const built = MISSIONS.map((m, i) => (m.built && this.missions[i] ? i : -1)).filter((i) => i >= 0);
    if (this.picked !== null && built.includes(this.picked)) return { m: this.picked, replay: this.done.includes(this.picked) };
    const todo = built.find((i) => !this.done.includes(i));
    if (todo !== undefined) return { m: todo, replay: false };
    return { m: built[(built.indexOf(this.lastPlayed) + 1) % built.length] ?? 0, replay: true };
  }

  // ------------------------------------------------------------ coming and going
  private setSpace(sp: Space | null) { this.player.cave = sp; }
  private showOnly(where: Where, mi = -1) {
    this.choice.group.visible = where === 'choice';
    this.hub.group.visible = where === 'hub';
    this.missions.forEach((m, i) => { if (m) m.group.visible = where === 'mission' && i === mi; });
  }
  /** through the door in the secret room */
  enter() {
    this.active = true;
    if (this.species) this.goHub(true); else this.goChoice();
  }
  /** back to the secret room (the caller puts the player there) */
  leave() {
    if (this.where === 'mission') { this.missions[this.mi]?.leave(); if (this.run) this.stepped = { ...this.run }; }
    this.active = false; this.where = null; this.mi = -1; this.run = null; this.timers = []; this.countdown = -1; this.outroLeft = -1;
    this.showOnly(null); this.setSpace(null); this.onBody(null); this.toast.style.display = 'none';
    this.narrator.stop();
    this.ready.delete(this.myId()); this.votes.clear();
  }
  private goChoice() {
    if (this.where === 'mission') this.missions[this.mi]?.leave();
    this.where = 'choice'; this.mi = -1; this.choices.delete(this.myId()); this.countdown = -1;
    this.showOnly('choice'); this.setSpace(this.choice.space); this.onBody(null);
    this.player.teleport(CHOICE.x, CHOICE.y, CHOICE.z + 3.6, 0);
    this.narrator.stop();
    if (!this.metMosquito) { this.metMosquito = true; this.narrator.say('mozzie_hello'); }
    this.narrator.say('choose_welcome'); this.narrator.say('choose_question');
  }
  private goHub(fromDoor = false) {
    if (this.where === 'mission') { this.missions[this.mi]?.leave(); if (this.run && !this.doneRids.has(this.run.rid)) this.stepped = { ...this.run }; }
    if (this.forget) { this.forget = false; this.species = null; this.save(); }
    if (!this.species) { this.goChoice(); return; }
    const back = this.where === 'mission';
    this.where = 'hub'; this.mi = -1; this.run = null; this.outroLeft = -1;
    this.showOnly('hub'); this.setSpace(this.hub.space); this.onBody(this.species);
    this.ready.delete(this.myId());
    const me = this.myId(), a = (me % 4) - 1.5;
    this.player.teleport(HUB.x + a * 0.7, HUB.y, HUB.z + (fromDoor ? 3.0 : 1.6), 0);
    this.toast.style.display = 'none';
    const all = MISSIONS.every((m, i) => !m.built || !this.missions[i] || this.done.includes(i));
    if (back && all) this.narrator.say('hub_alldone');
    else if (this.inCamp().some((o) => areaOf(o.x) >= 2) && fromDoor) this.narrator.say('hub_inprogress');
    else this.narrator.say(this.done.length ? 'hub_next' : 'hub_welcome');
  }
  /** `resume`: back into a run already under way (its clock keeps running; nothing is reset) */
  private goMission(rid: number, m: number, resume?: { t0: number }) {
    const ms = this.missions[m]; if (!ms) return;
    this.where = 'mission'; this.mi = m; this.lastPlayed = m; this.stepped = null;
    this.run = { rid, m, t0: resume?.t0 ?? performance.now() };
    this.showOnly('mission', m); this.setSpace(ms.space); this.onBody(this.species);
    if (!resume) ms.begin(rid, this.ctx);
    ms.enter();
    if (!resume && this.here().length === 0) this.later(1.0, () => this.narrator.say('solo_help'));
  }

  // ------------------------------------------------------------ aiming
  pick(eye0: PV, dir0: PV, reach: number, assist: number): { t: CampTarget; dist: number } | null {
    if (!this.active || this.outroLeft >= 0) return null;
    const eye = _pe.set(eye0.x, eye0.y, eye0.z), dir = _pd.set(dir0.x, dir0.y, dir0.z);
    const sp = this.space; if (!sp) return null;
    const le = this._le.set(eye.x - sp.ox, eye.y - sp.oy, eye.z - sp.oz);
    let best: { t: CampTarget; dist: number } | null = null;
    if (this.where === 'choice') {
      const h = this.choice.pick(le, dir, reach, assist);
      if (h) best = { t: h.i === 2 ? { w: 'exit' } : { w: 'plinth', i: h.i }, dist: h.dist };
    } else if (this.where === 'hub') {
      const h = this.hub.pick(le, dir, reach, assist);
      if (h) best = { t: h.w === 'tv' ? { w: 'tv' } : h.w === 'reset' ? { w: 'reset' } : { w: 'exit' }, dist: h.dist };
      // the scoreboard: point at a mission to choose it
      const s = this.hub.scoreRow(le, dir, reach, MISSIONS.length);
      if (s && (!best || s.dist < best.dist)) best = { t: { w: 'score', i: s.i }, dist: s.dist };
    } else if (this.where === 'mission') {
      const h = this.missions[this.mi]?.pick(eye, dir, reach, assist);
      if (h) best = { t: { w: 'm', t: h.t }, dist: h.dist };
    }
    // a gorilla can toss a cat friend up high (to a shelf, a vent...)
    if (this.species === 'g' && this.where !== 'choice' && !this.holding()) {
      for (const o of this.here()) {
        if (this.speciesOf(o.id) !== 'c') continue;
        const dx = o.x - eye.x, dy = o.y + 0.2 - eye.y, dz = o.z - eye.z, t = dx * dir.x + dy * dir.y + dz * dir.z;
        if (t < 0 || t > 2.6) continue;
        const px = dx - dir.x * t, py = dy - dir.y * t, pz = dz - dir.z * t;
        if (px * px + py * py + pz * pz < 0.36 * assist * assist && (!best || t < best.dist + 0.3)) best = { t: { w: 'toss', id: o.id }, dist: t };
      }
    }
    return best;
  }
  private _le = new THREE.Vector3();
  private holding() { const m = this.where === 'mission' ? this.missions[this.mi] as any : null; return !!m?.grabs?.mine; }

  prompt(t: CampTarget): { name: string; hint: string; ok: boolean } {
    switch (t.w) {
      case 'exit': return { name: 'Door', hint: '<b>E</b> back to the secret room', ok: true };
      case 'plinth': {
        const mine = this.choices.get(this.myId());
        const what = t.i === 0 ? 'A banana' : 'A salmon';
        return { name: what, hint: mine === (t.i === 0 ? 'g' : 'c') ? 'Your choice ✓' : `<b>E</b> / click · choose it (${t.i === 0 ? 'become a gorilla' : 'become a cat'})`, ok: true };
      }
      case 'tv': {
        const st = this.tvState();
        return { name: 'Television', hint: st.blocked ? st.line : this.ready.has(this.myId()) ? 'Ready ✓ · <b>E</b> not ready' : `<b>E</b> / click · ${st.line}`, ok: !st.blocked };
      }
      case 'score': {
        const m = MISSIONS[t.i], ok = !!m.built && !!this.missions[t.i];
        return { name: `Mission ${t.i + 1}: ${m.title}`, hint: !ok ? 'Coming soon' : this.picked === t.i ? 'Chosen ✓ · the TV will start it' : '<b>E</b> / click · choose this mission', ok };
      }
      case 'reset': return { name: 'Big red button', hint: Date.now() < this.armed ? '<b>E</b> again: yes, start over' : '<b>E</b> lift the flap · reset everything', ok: true };
      case 'toss': return { name: 'Your cat friend', hint: '<b>E</b> toss them up high', ok: true };
      case 'm': return this.missions[this.mi]!.prompt(t.t);
    }
  }
  /** E / A; returns 'exit' when the player leaves for the secret room */
  interact(t: CampTarget): 'exit' | null {
    switch (t.w) {
      case 'exit': return 'exit';
      case 'plinth': this.choose(t.i === 0 ? 'g' : 'c'); return null;
      case 'tv': this.pressTV(); return null;
      case 'score': this.pickMission(t.i); return null;
      case 'reset': this.pressReset(); return null;
      case 'toss': {
        const yaw = this.player.yaw;
        this.send({ k: 'qy', t: t.id, y: +yaw.toFixed(2) }); this.sfx.whoosh(); this.onEmote();
        this.narrateAll('toss', { priority: -1 });
        return null;
      }
      case 'm': if (this.missions[this.mi]?.interact(t.t) === 'exit') this.fadeTo(() => this.goHub()); return null;
    }
  }
  /** click / trigger */
  click(t: CampTarget | null) {
    if (t?.w === 'plinth' || t?.w === 'tv' || t?.w === 'reset' || t?.w === 'score') { this.interact(t); return; }
    if (this.where === 'mission' && this.missions[this.mi]?.click(t?.w === 'm' ? t.t : null)) return;
    // nothing to do with it: the gorilla beats its chest, the cat swats
    this.onEmote();
    if (this.species === 'g' && this.where !== 'choice') {
      this.sfx.chestBeat(); this.onBeat?.();
      if (this.beatCd <= 0 && Math.random() < 0.4) { this.narrator.say('beat', { priority: -2 }); this.beatCd = 25; }
    }
  }
  vrGrab(pos: THREE.Vector3, down: boolean, vel: THREE.Vector3) { return this.where === 'mission' && !!this.missions[this.mi]?.vrGrab?.(pos, down, vel); }
  private fadeTo(fn: () => void) { this.fade(true); this.later(0.6, () => { fn(); this.fade(false); }); }

  // ------------------------------------------------------------ the choice
  private choose(sp: Species) {
    if (this.where !== 'choice' || this.countdown >= 0) return;
    if (this.choices.get(this.myId()) === sp) return;
    this.choices.set(this.myId(), sp);
    this.send({ k: 'qc', s: sp });
    this.sfx.bell();
    this.narrator.say(sp === 'g' ? 'choose_banana' : 'choose_salmon', { interrupt: true, priority: 1 });
    if (this.here().some((o) => !this.choices.has(o.id))) this.narrator.say('choose_wait');
  }

  // ------------------------------------------------------------ the TV, ready lights, starting a mission
  private tvState(): { line: string; title: string; sub: string; blocked: boolean; m: number; rejoin?: boolean } {
    const busy = this.inCamp().some((o) => areaOf(o.x) >= 2);
    // friends still out on the run I stepped out of: I can go back in
    const back = this.stepped;
    if (back && this.inCamp().some((o) => areaOf(o.x) === back.m + 2)) {
      const nm = `Mission ${back.m + 1}: ${MISSIONS[back.m].title}`;
      return { line: 'rejoin your friends', title: 'Mission in progress', sub: `Your friends are still in ${nm}. Click here to rejoin them.`, blocked: false, m: back.m, rejoin: true };
    }
    const { m, replay } = this.nextMission();
    const name = `Mission ${m + 1}: ${MISSIONS[m].title}`;
    if (busy) return { line: 'A mission is on - wait for your friends', title: 'Mission in progress', sub: 'Your friends are out on a mission. Wait here for the next one.', blocked: true, m };
    if (this.picked === m) return { line: `start ${name}`, title: name, sub: replay ? 'Chosen on the scoreboard: click here to play it again' : 'Chosen on the scoreboard: click here to start', blocked: false, m };
    if (replay) return { line: `play ${name} again`, title: 'All missions complete!', sub: `Click here to replay ${name}`, blocked: false, m };
    const last = this.done.length ? Math.max(...this.done) : -1;
    if (last >= 0 && m === last + 1) return { line: `progress to mission ${m + 1}`, title: `Mission ${last + 1} complete!`, sub: `Click here to progress to ${name}`, blocked: false, m };
    return { line: `start ${name}`, title: `${name}`, sub: 'Ready: click here to start', blocked: false, m };
  }
  private pressTV() {
    const st = this.tvState(), me = this.myId();
    if (st.blocked) { this.narrator.say('hub_inprogress'); return; }
    if (st.rejoin && this.stepped) {
      const r = this.stepped;
      this.sfx.bell(); this.fade(true, MISSIONS[r.m].title);
      this.later(1.2, () => { if (this.where === 'hub') this.goMission(r.rid, r.m, { t0: r.t0 }); this.fade(false); });
      return;
    }
    if (this.ready.has(me)) { this.ready.delete(me); this.send({ k: 'qr', on: 0, m: st.m }); this.sfx.denied(); return; }
    this.ready.set(me, st.m); this.send({ k: 'qr', on: 1, m: st.m }); this.sfx.bell();
    if (this.here().some((o) => this.ready.get(o.id) !== st.m)) this.narrator.say('hub_ready', { interrupt: true });
    this.tryStart();
  }
  private tryStart() {
    if (this.where !== 'hub' || !this.controller()) return;
    const ids = [this.myId(), ...this.here().map((o) => o.id)];
    const m = this.ready.get(this.myId());
    if (m === undefined || !ids.every((id) => this.ready.get(id) === m)) return;
    const e = { k: 'qs', rid: Math.floor(Math.random() * 1e9) + 1, m, ids };
    this.send(e); this.start(e);
  }
  private start(e: { rid: number; m: number; ids: number[] }) {
    if (this.where !== 'hub' || !e.ids.includes(this.myId())) return;
    this.picked = null;
    for (const id of e.ids) this.ready.delete(id);
    this.narrator.say('hub_go', { interrupt: true, priority: 2 });
    this.fade(true, MISSIONS[e.m].title);
    this.later(2.6, () => { if (this.where === 'hub') { this.goMission(e.rid, e.m); this.fade(false); } else this.fade(false); });
  }

  // ------------------------------------------------------------ winning
  private complete(caught: number) {
    const r = this.run; if (!r || this.doneRids.has(r.rid)) return;
    const t = Math.round((performance.now() - r.t0) / 1000);
    const e = { k: 'qd', rid: r.rid, m: r.m, t, c: caught };
    this.send(e); this.applyDone(e);
  }
  private medal(m: number, t: number, c: number) {
    if (m === 0) return t < 360 ? 'gold' : t < 720 ? 'silver' : 'bronze';
    return c === 0 && t < 600 ? 'gold' : c <= 2 && t < 1100 ? 'silver' : 'bronze';
  }
  private applyDone(e: { rid: number; m: number; t: number; c: number }) {
    if (this.doneRids.has(e.rid)) return;
    this.doneRids.add(e.rid);
    if (this.stepped?.rid === e.rid) this.stepped = null;   // finished without me: nothing to go back to
    if (!this.done.includes(e.m)) this.done.push(e.m);
    const medal = this.medal(e.m, e.t, e.c), b = this.best[e.m], rank = (s: string) => ['bronze', 'silver', 'gold'].indexOf(s);
    if (!b || e.t < b.t || rank(medal) > rank(b.medal)) this.best[e.m] = { t: !b ? e.t : Math.min(b.t, e.t), c: !b ? e.c : Math.min(b.c, e.c), medal: !b || rank(medal) > rank(b.medal) ? medal : b.medal };
    this.save();
    if (this.where === 'mission' && this.run?.rid === e.rid) {
      const ms = this.missions[this.mi]!;
      this.narrator.say(ms.outro, { interrupt: true, priority: 3 });
      this.narrator.say(`medal_${medal}`, { priority: 3 });
      this.sfx.tileWin();
      this.toast.textContent = `Mission complete! ${Math.floor(e.t / 60)}:${String(e.t % 60).padStart(2, '0')} · ${medal} medal`; this.toast.style.display = 'block';
      this.outroLeft = 16;
    }
  }

  // ------------------------------------------------------------ reset
  private pressReset() {
    if (this.where !== 'hub') return;
    const me = this.myId();
    if (Date.now() > this.armed) { this.armed = Date.now() + 4000; this.sfx.clang(); this.narrator.say('hub_reset_ask', { interrupt: true }); return; }
    this.armed = 0;
    this.votes.add(me); this.send({ k: 'qx' });
    this.checkReset(me);
  }
  private checkReset(from: number) {
    const ids = [this.myId(), ...this.here().map((o) => o.id)];
    for (const v of [...this.votes]) if (!ids.includes(v)) this.votes.delete(v);
    if (from === 0 || ids.every((id) => this.votes.has(id))) {
      if (this.controller() || from === this.myId()) { this.send({ k: 'qz' }); this.applyReset(); }
    } else if (from === this.myId()) this.narrator.say('hub_reset_vote', { interrupt: true });
  }
  /** a reset arrived while I was out on a mission: I keep my animal until I am back in the hub */
  private forget = false;
  private metMosquito = false;
  private applyReset() {
    this.done = []; this.best = {}; this.choices.clear(); this.votes.clear(); this.ready.clear(); this.lastPlayed = -1;
    if (this.where === 'mission') this.forget = true; else this.species = null;
    this.save();
    if (this.where === 'hub' || this.where === 'choice') { this.narrator.say('hub_reset_done', { interrupt: true, priority: 2 }); this.fadeTo(() => this.goChoice()); }
  }

  // ------------------------------------------------------------ events from the others
  net(e: any, from: number) {
    switch (e.k) {
      case 'qc': if (e.s === 'g' || e.s === 'c') this.choices.set(from, e.s); else this.choices.delete(from); return;
      case 'qr': if (e.on) this.ready.set(from, e.m); else this.ready.delete(from); this.tryStart(); return;
      case 'qs': this.start(e); return;
      case 'qk': this.pickMission(e.m, true); return;
      case 'qd': this.applyDone(e); return;
      case 'qx': this.votes.add(from); if (this.where === 'hub') this.checkReset(from); return;
      case 'qz': this.applyReset(); return;
      case 'qn': if (this.active && e.a === this.area) this.narrator.say(e.id, { interrupt: !!e.i, priority: e.p ?? 0 }); return;
      case 'qy': if (e.t === this.myId() && this.active && this.species === 'c') {
        const p = this.player; p.vel.y = 9.6; p.vel.x = -Math.sin(e.y) * 1.8; p.vel.z = -Math.cos(e.y) * 1.8; p.onGround = false; this.haptic(0.6); this.sfx.whoosh();
      } return;
    }
    if (typeof e.m === 'number') this.missions[e.m]?.net(e, from);
  }

  // ------------------------------------------------------------ per frame
  update(dt: number, time: number) {
    // a mission run keeps going for the others even if I am not in it; nothing to simulate here when I am away
    if (!this.active) return;
    for (const tm of [...this.timers]) { tm.t -= dt; if (tm.t <= 0) { this.timers.splice(this.timers.indexOf(tm), 1); tm.fn(); } }
    if (!this.active) return;
    this.beatCd -= dt;
    const sp = this.space; if (sp) sp.bodyH = this.player.body.height;
    // the solo helper: a cat with no gorilla around gets a double jump
    this.player.extraJumps = this.where === 'mission' && this.species === 'c' && this.helper('g') ? 1 : 0;
    const me = this.myId();
    if (this.where === 'choice') {
      this.choice.update(dt);
      const ids = [me, ...this.here().map((o) => o.id)];
      const names = (sp: Species) => ids.filter((id) => this.choices.get(id) === sp).map((id) => (id === me ? 'You ✓' : `${this.others().find((o) => o.id === id)?.name ?? 'Player ' + (id + 1)} ✓`));
      const left = ids.filter((id) => !this.choices.has(id)).length;
      this.choice.show([names('g'), names('c')], this.countdown >= 0 ? `Here we go... ${Math.max(1, Math.ceil(this.countdown))}` : left ? `Waiting for ${left} player${left === 1 ? '' : 's'} to choose` : '');
      if (left === 0) {
        if (this.countdown < 0) { this.countdown = 4.2; this.narrator.say('choose_countdown', { priority: 1 }); }
        this.countdown -= dt;
        if (this.countdown <= 0) { this.countdown = -1; this.species = this.choices.get(me)!; this.save(); this.fadeTo(() => this.goHub(true)); }
      } else this.countdown = -1;
    } else if (this.where === 'hub') {
      const ids = [me, ...this.here().map((o) => o.id)];
      for (const id of [...this.ready.keys()]) if (!ids.includes(id)) this.ready.delete(id);
      const st = this.tvState();
      const nReady = ids.filter((id) => this.ready.get(id) === st.m).length;
      this.hub.setLights(Array.from({ length: 8 }, (_, i) => (i < ids.length ? (this.ready.get(ids[i]) === st.m ? 2 : 1) : 0)) as (0 | 1 | 2)[]);
      this.hub.update(dt, Date.now() < this.armed);
      this.hub.tv.draw(`${st.title}|${st.sub}|${nReady}/${ids.length}|${Math.floor(time * 2) % 2}`, (g, W, H) => {
        const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#12324a'); gr.addColorStop(1, '#0a1622');
        g.fillStyle = gr; g.fillRect(0, 0, W, H);
        g.fillStyle = 'rgba(255,255,255,0.05)'; for (let y = 0; y < H; y += 6) g.fillRect(0, y, W, 2);
        g.textAlign = 'center'; g.fillStyle = '#ffd27a'; g.font = '800 30px system-ui, sans-serif'; g.fillText('BANANA OR SALMON', W / 2, 52);
        g.fillStyle = '#fff'; let fs = 46; g.font = `800 ${fs}px system-ui, sans-serif`;
        while (g.measureText(st.title).width > W - 60 && fs > 20) { fs -= 2; g.font = `800 ${fs}px system-ui, sans-serif`; }
        g.fillText(st.title, W / 2, H * 0.4);
        g.font = '600 30px system-ui, sans-serif'; g.fillStyle = '#cfe6ff';
        wrap(g, st.sub, W / 2, H * 0.55, W - 80, 36);
        g.fillStyle = st.blocked ? '#ff9a8a' : '#7dff8a'; g.font = '700 30px system-ui, sans-serif';
        g.fillText(st.blocked ? 'Please wait' : `Ready ${nReady} of ${ids.length}${Math.floor(time * 2) % 2 && nReady < ids.length ? '  ▶' : ''}`, W / 2, H - 40);
      });
      this.hub.score.draw(JSON.stringify([this.done, this.best, this.picked, this.nextMission().m]), (g, W, H) => {
        g.fillStyle = '#21301f'; g.fillRect(0, 0, W, H);
        g.fillStyle = '#f2e6c8'; g.textAlign = 'center'; g.font = '800 44px system-ui, sans-serif'; g.fillText('SCOREBOARD', W / 2, 60);
        g.textAlign = 'left';
        MISSIONS.forEach((m, i) => {
          const y = 112 + i * 100, d = this.done.includes(i), b = this.best[i];
          // the mission the TV will start is highlighted
          if (m.built && this.nextMission().m === i) { g.fillStyle = 'rgba(255,210,122,0.18)'; g.fillRect(8, y - 36, W - 16, 90); g.strokeStyle = '#ffd27a'; g.lineWidth = 3; g.strokeRect(8, y - 36, W - 16, 90); }
          g.fillStyle = m.built ? '#fff' : 'rgba(255,255,255,0.45)'; g.font = '700 28px system-ui, sans-serif';
          g.fillText(`${i + 1}. ${m.title}`, 24, y);
          g.font = '500 24px system-ui, sans-serif'; g.fillStyle = d ? '#9dff8a' : m.built ? '#d8d0b8' : 'rgba(255,255,255,0.4)';
          const medal = b ? ` · ${b.medal === 'gold' ? '🥇' : b.medal === 'silver' ? '🥈' : '🥉'} ${b.medal}` : '';
          g.fillText(d ? `✓ done · best ${Math.floor((b?.t ?? 0) / 60)}:${String((b?.t ?? 0) % 60).padStart(2, '0')}${medal}` : m.built ? 'not done yet' : 'coming soon', 44, y + 36);
        });
        g.textAlign = 'center'; g.font = '600 20px system-ui, sans-serif'; g.fillStyle = '#ffd27a';
        g.fillText('Point at a mission and press E to choose it', W / 2, H - 14);
      });
    } else if (this.where === 'mission') {
      const ms = this.missions[this.mi];
      ms?.update(dt, time);
      if (this.outroLeft >= 0) {
        this.outroLeft -= dt;
        if (this.outroLeft <= 0 || (this.outroLeft < 12 && !this.narrator.busy)) { this.outroLeft = -1; this.fadeTo(() => this.goHub()); }
      }
    }
  }
  /** night vision tint: a cat in a dark mission */
  get nightVision() { return this.active && this.where === 'mission' && this.species === 'c' && !!this.missions[this.mi]?.dark; }
}

function wrap(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number) {
  const words = text.split(' '); let line = '', yy = y;
  for (const w of words) { const t = line ? line + ' ' + w : w; if (g.measureText(t).width > maxW && line) { g.fillText(line, x, yy); line = w; yy += lh; } else line = t; }
  if (line) g.fillText(line, x, yy);
}

type PV = { x: number; y: number; z: number };
const _pe = new THREE.Vector3(), _pd = new THREE.Vector3();
