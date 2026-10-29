import { CLASSIC } from '../world/island';
// A multiplayer session: one host, any number of clients, star topology.
// The host owns the room: it assigns ids, hands joiners a snapshot of the world, and relays everything.
import { hostRoom, joinRoom, newCode, type Link, type Room, type TransportKind } from './transport';

export interface PlayerInfo { id: number; name: string; /** shirt colour index */ look?: number[] }

/** Compact state of one player, sent ~12 times a second. */
export interface PState {
  x: number; y: number; z: number; yaw: number; pitch: number;
  spd: number; item: string; swing: number; flags: number; // flags: 1 sprint, 2 swim, 4 dead, 8 asleep, 16 cat, 32 drink, 64 driving ... 8192 campaign, 16384 gorilla, 32768 campaign cat, 2^29 on the water slide (64 also: sitting in a boat)
  hp: number;
  /** worn armor tiers as head*100 + chest*10 + legs (0..3 each) */
  arm?: number;
  /** VR players: head and hands, in metres relative to the feet (world axes); hands are 0 when not tracked */
  v?: VRPoseData | null;
}

/** h = [x, y, z, yaw, pitch, roll]; r / l = [x, y, z, qx, qy, qz, qw] */
export interface VRPoseData { h: number[]; r: number[] | 0; l: number[] | 0 }

const STATE_EVERY = 0.08;
const HOUR_EVERY = 4;
const STATIONS_EVERY = 3;
export const MAX_PLAYERS = 8;
/** bump when messages change incompatibly, so mismatched versions get a clear error instead of weirdness */
/** Babylon port: its own protocol line (the three.js and Babylon builds cannot share a room) */
export const PROTOCOL = CLASSIC ? 1001 : 1000;
const TIMEOUT_CLIENT = 12000, TIMEOUT_HOST = 15000, KEEPALIVE = 1500;
const now = () => performance.now();

const r2 = (n: number) => +n.toFixed(2), r3 = (n: number) => +n.toFixed(3);
const packHand = (a: number[] | 0): number[] | 0 => (a ? [r2(a[0]), r2(a[1]), r2(a[2]), r3(a[3]), r3(a[4]), r3(a[5]), r3(a[6])] : 0);
const packPose = (v: VRPoseData): VRPoseData => ({ h: [r2(v.h[0]), r2(v.h[1]), r2(v.h[2]), r3(v.h[3]), r3(v.h[4]), r3(v.h[5])], r: packHand(v.r), l: packHand(v.l) });
const pack = (s: PState): any[] => [+s.x.toFixed(2), +s.y.toFixed(2), +s.z.toFixed(2), +s.yaw.toFixed(3), +s.pitch.toFixed(3), +s.spd.toFixed(2), s.item, s.swing, s.flags, Math.round(s.hp), s.v ? packPose(s.v) : 0, s.arm ?? 0];
const unpack = (a: any[]): PState => ({ x: a[0], y: a[1], z: a[2], yaw: a[3], pitch: a[4], spd: a[5], item: a[6], swing: a[7], flags: a[8], hp: a[9] ?? 100, v: a[10] || null, arm: a[11] ?? 0 });

export class Session {
  readonly players = new Map<number, PlayerInfo>();
  readonly states = new Map<number, PState>();
  myId = 0;
  closed = false;
  /** can players hurt each other? set by the host */
  pvp = true;
  /** which saved world this is (characters are saved per world) */
  wid = '';

  // ---- callbacks the game side fills in
  onEvent: ((from: number, e: any) => void) | null = null;
  onJoin: ((p: PlayerInfo) => void) | null = null;
  onLeave: ((p: PlayerInfo) => void) | null = null;
  onHour: ((h: number) => void) | null = null;
  onDisconnect: ((why: string, fatal?: boolean) => void) | null = null;
  /** host only: describes the whole world for a newcomer */
  snapshot: (() => any) | null = null;
  /** host only: called every few seconds so the host can broadcast station state */
  onPeriodic: (() => void) | null = null;
  /** host only: ~8 times a second (animal positions) */
  onFast: (() => void) | null = null;
  getHour: (() => number) | null = null;

  private room: Room | null = null;
  private links = new Map<number, Link>(); // host: playerId -> link
  private up: Link | null = null;           // client: link to host
  private nextId = 1;
  private t = 0; private hourT = 0; private stT = 0; private fastT = 0;
  private mine: PState | null = null;
  private lastSent = ''; private lastSentAt = 0; private lastTx = 0; private lastRx = 0;
  private rx = new Map<number, number>();          // host: last time we heard from each player
  /** round-trip time in ms per player (host knows everyone's, a client knows its own) */
  readonly pings = new Map<number, number>();
  private pingAt = 0; private pump_: ReturnType<typeof setInterval> | null = null;
  kicked = false;

  private constructor(readonly role: 'host' | 'client', readonly code: string, readonly name: string) {
    this.lastRx = now();
    // runs even when the tab is in the background (rAF does not), so friends are not dropped when you alt-tab
    this.pump_ = setInterval(() => this.pump(), 500);
  }

  get isHost() { return this.role === 'host'; }
  get others() { return [...this.players.values()].filter((p) => p.id !== this.myId); }

  // ---------------------------------------------------------------- creating
  static async host(kind: TransportKind, name: string, pvp = true, wid = '', code = newCode()): Promise<Session> {
    const s = new Session('host', code, name);
    s.pvp = pvp; s.wid = wid;
    s.room = await hostRoom(kind, code);
    s.players.set(0, { id: 0, name });
    s.room.onLink = (l) => s.acceptLink(l);
    return s;
  }

  /** Resolves with the session and the world snapshot the host sent. */
  static async join(kind: TransportKind, code: string, name: string, quick = false): Promise<{ session: Session; snap: any; hour: number }> {
    const s = new Session('client', code, name);
    const pending = joinRoom(kind, code);
    let link: Link;
    if (quick) {
      let late = false;
      link = await Promise.race([pending, new Promise<never>((_, rej) => setTimeout(() => { late = true; rej(new Error('no answer')); }, 4000))]).catch((e) => { pending.then((l) => { if (late) l.close(); }, () => {}); throw e; });
    } else link = await pending;
    s.up = link;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { link.close(); reject(new Error('The host did not answer')); }, 15000);
      link.onMessage = (m) => {
        if (m.t === 'full') { clearTimeout(timer); link.close(); reject(new Error('That game is full')); return; }
        if (m.t === 'bad') { clearTimeout(timer); link.close(); reject(new Error(m.why)); return; }
        if (m.t !== 'welcome') return;
        clearTimeout(timer);
        s.myId = m.id; s.pvp = m.pvp !== false; s.wid = m.wid ?? '';
        for (const p of m.players as PlayerInfo[]) s.players.set(p.id, p);
        s.lastRx = now();
        link.onMessage = (x) => { s.lastRx = now(); s.fromHost(x); };
        link.onClose = () => s.lost('The host left the game');
        resolve({ session: s, snap: m.snap, hour: m.hour });
      };
      link.onClose = () => { clearTimeout(timer); reject(new Error('Connection closed')); };
      link.send({ t: 'hi', name, v: PROTOCOL });
    });
  }

  // ---------------------------------------------------------------- host side
  private acceptLink(l: Link) {
    let id = -1;
    l.onMessage = (m) => {
      if (m.t === 'hi' && id < 0) {
        if (m.v !== PROTOCOL) { l.send({ t: 'bad', why: 'This game is a different version. Everyone should reload the page, then try again.' }); l.close(); return; }
        if (this.players.size >= MAX_PLAYERS) { l.send({ t: 'full' }); l.close(); return; }
        id = this.nextId++;
        const info: PlayerInfo = { id, name: this.uniqueName(String(m.name || 'Castaway').slice(0, 14)) };
        this.players.set(id, info);
        this.links.set(id, l);
        this.rx.set(id, now());
        l.send({ t: 'welcome', id, pvp: this.pvp, wid: this.wid, players: [...this.players.values()], hour: this.getHour?.() ?? 12, snap: this.snapshot?.() });
        this.broadcast({ t: 'join', p: info }, id);
        this.onJoin?.(info);
      } else if (id >= 0 && this.players.has(id)) { this.rx.set(id, now()); this.fromClient(id, m); }
    };
    l.onClose = () => {
      if (id < 0) return;
      this.drop(id);
    };
  }

  private drop(id: number) {
    const info = this.players.get(id);
    if (!info || !this.links.has(id)) return;
    this.links.delete(id); this.players.delete(id); this.states.delete(id); this.pings.delete(id); this.rx.delete(id);
    this.broadcast({ t: 'left', id });
    this.onLeave?.(info);
  }

  /** Host: remove a player. */
  kick(id: number) {
    const l = this.links.get(id);
    if (!l) return;
    l.send({ t: 'kick' });
    setTimeout(() => l.close(), 200);
    this.drop(id);
  }

  /** Host: send an event to one player only. */
  sendTo(id: number, e: unknown) { this.links.get(id)?.send({ t: 'ev', from: 0, e }); }

  private uniqueName(n: string) {
    const taken = new Set([...this.players.values()].map((p) => p.name));
    if (!taken.has(n)) return n;
    for (let k = 2; ; k++) if (!taken.has(`${n} ${k}`)) return `${n} ${k}`;
  }

  private fromClient(id: number, m: any) {
    if (m.t === 'me') this.states.set(id, unpack(m.s));
    else if (m.t === 'ev') {
      this.safeEvent(id, m.e);
      this.broadcast({ t: 'ev', from: id, e: m.e }, id);
    } else if (m.t === 'pg') {
      if (typeof m.rtt === 'number') this.pings.set(id, Math.round(m.rtt));
      this.links.get(id)?.send({ t: 'pn', ts: m.ts });
    }
  }

  private broadcast(msg: unknown, except = -1) {
    for (const [id, l] of this.links) if (id !== except) l.send(msg);
    this.lastTx = now();
  }

  /** One bad event must never take the message loop down. */
  private safeEvent(from: number, e: any) {
    try { this.onEvent?.(from, e); } catch (err) { console.warn('event failed', e?.k, err); }
  }

  // ---------------------------------------------------------------- client side
  private fromHost(m: any) {
    switch (m.t) {
      case 'ps':
        for (const row of m.p as any[]) {
          const id = row[0] as number;
          if (id === this.myId) continue;
          this.states.set(id, unpack(row.slice(1)));
        }
        break;
      case 'ev': this.safeEvent(m.from, m.e); break;
      case 'pn': this.pings.set(this.myId, Math.round(now() - m.ts)); break;
      case 'kick': this.kicked = true; this.lost('You were removed from the game by the host', true); break;
      case 'join': this.players.set(m.p.id, m.p); this.onJoin?.(m.p); break;
      case 'left': {
        const info = this.players.get(m.id);
        this.players.delete(m.id); this.states.delete(m.id);
        if (info) this.onLeave?.(info);
        break;
      }
      case 'hour':
        this.onHour?.(m.h);
        if (m.pg) for (const k of Object.keys(m.pg)) if (+k !== this.myId) this.pings.set(+k, m.pg[k]);
        break;
    }
  }

  private lost(why: string, fatal = false) {
    if (this.closed) return;
    this.closed = true;
    if (this.pump_) clearInterval(this.pump_);
    this.up?.close();
    this.onDisconnect?.(why, fatal);
  }

  // ---------------------------------------------------------------- shared API
  /** A world event from this player. */
  sendEvent(e: unknown) {
    if (this.isHost) this.broadcast({ t: 'ev', from: 0, e });
    else { this.up?.send({ t: 'ev', e }); this.lastTx = now(); }
  }

  /** Background work: keepalives, pings, timeouts. */
  private pump() {
    if (this.closed) return;
    const t = now();
    if (this.isHost) {
      for (const [id, at] of this.rx) if (t - at > TIMEOUT_HOST) { this.links.get(id)?.close(); this.drop(id); }
      if (t - this.lastTx > KEEPALIVE && this.links.size) this.broadcast({ t: 'ka' });
    } else {
      if (t - this.lastRx > TIMEOUT_CLIENT) { this.lost('Lost connection to the host'); return; }
      if (t - this.pingAt > 2000) { this.pingAt = t; this.up?.send({ t: 'pg', ts: t, rtt: this.pings.get(this.myId) ?? 0 }); this.lastTx = t; }
      else if (t - this.lastTx > KEEPALIVE) { this.up?.send({ t: 'ka' }); this.lastTx = t; }
    }
  }

  setMyState(s: PState) { this.mine = s; if (this.isHost) this.states.set(0, s); }

  update(dt: number) {
    if (this.closed) return;
    this.t += dt;
    if (this.t >= STATE_EVERY) {
      this.t = 0;
      if (this.isHost) {
        const rows = [...this.states].map(([id, s]) => [id, ...pack(s)]);
        if (rows.length && this.links.size) this.broadcast({ t: 'ps', p: rows });
      } else if (this.mine) {
        // standing still: a heartbeat twice a second is plenty
        const row = pack(this.mine), key = JSON.stringify(row), t = now();
        if (key !== this.lastSent || t - this.lastSentAt > 500) { this.lastSent = key; this.lastSentAt = t; this.up?.send({ t: 'me', s: row }); this.lastTx = t; }
      }
    }
    if (this.isHost) {
      this.hourT += dt; this.stT += dt; this.fastT += dt;
      if (this.fastT >= 0.125) { this.fastT = 0; if (this.links.size) this.onFast?.(); }
      if (this.hourT >= HOUR_EVERY) { this.hourT = 0; if (this.links.size) this.broadcast({ t: 'hour', h: this.getHour?.() ?? 12, pg: Object.fromEntries(this.pings) }); }
      if (this.stT >= STATIONS_EVERY) { this.stT = 0; if (this.links.size) this.onPeriodic?.(); }
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.pump_) clearInterval(this.pump_);
    if (this.isHost) { for (const l of this.links.values()) l.close(); this.room?.close(); }
    else this.up?.close();
  }
}
