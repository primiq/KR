// Transports for the multiplayer session. A Link is one reliable, ordered, JSON message pipe between two peers.
//  - 'peer':  WebRTC data channels via PeerJS (needs the page to be hosted somewhere that allows it)
//  - 'local': BroadcastChannel between tabs of the same browser (for testing without any network)
import { Peer, type DataConnection } from 'peerjs';

export interface Link {
  send(msg: unknown): void;
  close(): void;
  onMessage: ((msg: any) => void) | null;
  onClose: (() => void) | null;
}

export interface Room {
  code: string;
  onLink: ((l: Link) => void) | null;
  close(): void;
}

export type TransportKind = 'peer' | 'local';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const newCode = () => Array.from({ length: 5 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
export const cleanCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);

/** Turn PeerJS error objects into something a player can act on. */
const friendly = (e: any, fallback: string): Error => {
  const t = String(e?.type ?? '');
  if (t === 'peer-unavailable') return new Error('No game found with that code. Check the letters, and that the host is still online');
  if (t === 'unavailable-id') return new Error('That room code is already in use');
  if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') return new Error('Could not reach the matchmaking server. Check your internet connection');
  if (t === 'browser-incompatible') return new Error('This browser does not support peer-to-peer connections');
  return e instanceof Error ? e : new Error(fallback);
};

const withTimeout = <T,>(p: Promise<T>, ms: number, what: string) =>
  new Promise<T>((res, rej) => { const t = setTimeout(() => rej(new Error(what)), ms); p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); }); });

// ------------------------------------------------------------------ ICE servers (STUN, optionally TURN)
export interface TurnConfig { urls: string; username?: string; credential?: string }
let turn: TurnConfig | null = null;
/** Set a TURN relay for players behind strict NATs (some mobile networks). */
export function setTurn(t: TurnConfig | null) { turn = t && t.urls ? t : null; }
const iceServers = (): RTCIceServer[] => [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
  ...(turn ? [{ urls: turn.urls.split(/[\s,]+/).filter(Boolean), username: turn.username, credential: turn.credential }] : []),
];

// ------------------------------------------------------------------ PeerJS
/** (the Babylon port keeps its rooms apart from the three.js Castaway's) */
const peerId = (code: string) => `castaway-bjs-${code}`;

// WebRTC data channels refuse big messages (the world snapshot a joiner receives can be hundreds of KB once a base has been built),
// so anything long is cut into pieces here and put back together on the other side.
const CHUNK = 8000;
let chunkId = 1;
function wrapConn(c: DataConnection): Link {
  const l: Link = {
    send: (m) => {
      if (!c.open) return;
      const s = JSON.stringify(m);
      if (s.length <= CHUNK) { c.send(m); return; }
      const id = chunkId++, n = Math.ceil(s.length / CHUNK);
      for (let i = 0; i < n; i++) c.send({ __c: id, i, n, d: s.slice(i * CHUNK, (i + 1) * CHUNK) });
    },
    close: () => c.close(), onMessage: null, onClose: null,
  };
  const parts = new Map<number, string[]>();
  c.on('data', (d: any) => {
    if (d && typeof d === 'object' && d.__c !== undefined) {
      let a = parts.get(d.__c); if (!a) { a = []; parts.set(d.__c, a); }
      a[d.i] = d.d;
      if (a.filter((x) => x !== undefined).length === d.n) { parts.delete(d.__c); try { l.onMessage?.(JSON.parse(a.join(''))); } catch { /* damaged message */ } }
      return;
    }
    l.onMessage?.(d);
  });
  c.on('close', () => l.onClose?.());
  c.on('error', () => l.onClose?.());
  return l;
}

async function hostPeer(code: string): Promise<Room> {
  const peer = new Peer(peerId(code), { debug: 0, config: { iceServers: iceServers() } });
  await withTimeout(new Promise<void>((res, rej) => { peer.on('open', () => res()); peer.on('error', (e) => rej(friendly(e, 'Could not reach the matchmaking server'))); }), 12000, 'Could not reach the matchmaking server. Check your internet connection');
  const room: Room = { code, onLink: null, close: () => peer.destroy() };
  peer.on('connection', (c) => c.on('open', () => room.onLink?.(wrapConn(c))));
  return room;
}

async function joinPeer(code: string): Promise<Link> {
  const peer = new Peer({ debug: 0, config: { iceServers: iceServers() } });
  await withTimeout(new Promise<void>((res, rej) => { peer.on('open', () => res()); peer.on('error', (e) => rej(friendly(e, 'Could not reach the matchmaking server'))); }), 12000, 'Could not reach the matchmaking server. Check your internet connection');
  const conn = peer.connect(peerId(code), { reliable: true, serialization: 'json' });
  await withTimeout(new Promise<void>((res, rej) => { conn.on('open', () => res()); conn.on('error', (e) => rej(friendly(e, 'Connection failed'))); peer.on('error', (e) => rej(friendly(e, 'Connection failed'))); }), 15000, 'Could not connect. Check that the host is still online and that you both have the same, freshly reloaded version of the game. A strict school / work network can also block it (a TURN relay fixes that)');
  const l = wrapConn(conn);
  const close = l.close; l.close = () => { close(); peer.destroy(); };
  return l;
}

// ------------------------------------------------------------------ BroadcastChannel (same browser)
function hostLocal(code: string): Room {
  const ch = new BroadcastChannel(`castaway-bjs-${code}`);
  const links = new Map<string, Link>();
  const room: Room = { code, onLink: null, close: () => { ch.close(); } };
  ch.onmessage = (e) => {
    const m = e.data;
    if (m.to !== 'host') return;
    if (m.k === 'open') {
      const id = m.from as string;
      const l: Link = { send: (x) => { try { ch.postMessage({ from: 'host', to: id, k: 'msg', d: x }); } catch { /* closed */ } }, close: () => { try { ch.postMessage({ from: 'host', to: id, k: 'close' }); } catch { /* closed */ } }, onMessage: null, onClose: null };
      links.set(id, l);
      ch.postMessage({ from: 'host', to: id, k: 'ack' });
      room.onLink?.(l);
    } else if (m.k === 'msg') links.get(m.from)?.onMessage?.(m.d);
    else if (m.k === 'close') { links.get(m.from)?.onClose?.(); links.delete(m.from); }
  };
  return room;
}

function joinLocal(code: string): Promise<Link> {
  const ch = new BroadcastChannel(`castaway-bjs-${code}`);
  const id = Math.random().toString(36).slice(2);
  const l: Link = { send: (x) => { try { ch.postMessage({ from: id, to: 'host', k: 'msg', d: x }); } catch { /* closed */ } }, close: () => { try { ch.postMessage({ from: id, to: 'host', k: 'close' }); ch.close(); } catch { /* closed */ } }, onMessage: null, onClose: null };
  return withTimeout(new Promise<Link>((res) => {
    ch.onmessage = (e) => {
      const m = e.data;
      if (m.to !== id) return;
      if (m.k === 'ack') res(l);
      else if (m.k === 'msg') l.onMessage?.(m.d);
      else if (m.k === 'close') l.onClose?.();
    };
    ch.postMessage({ from: id, to: 'host', k: 'open' });
  }), 20000, 'No game found with that code');
}

export async function hostRoom(kind: TransportKind, code = newCode()): Promise<Room> {
  return kind === 'local' ? hostLocal(code) : hostPeer(code);
}
export function joinRoom(kind: TransportKind, code: string): Promise<Link> {
  return kind === 'local' ? joinLocal(code) : joinPeer(code);
}
