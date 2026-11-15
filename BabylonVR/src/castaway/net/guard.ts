// Checks on what arrives over the network, so a broken or hostile peer cannot break the game for anyone else:
// numbers that are not finite or absurdly large, oversized text or lists, malformed player states, and floods of events.
// Every event handler in net/sync.ts still checks its own fields; this is the gate in front of all of them.

/** the largest coordinate anything in the world can have (the levels are within 30 km of the middle) */
const FAR = 1e5;
/** event text can carry a painting or a flag (a data URL): generous, but not unbounded */
const MAX_TEXT = 600_000, MAX_LIST = 5000, MAX_DEPTH = 6;

/** a number that can be used: finite and not absurd */
export const num = (v: unknown, lim = FAR): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim;

/** walks a received value: false if any number is not finite or absurd, any text or list too long, or it nests too deep */
export function sane(v: unknown, depth = 0, budget = { text: MAX_TEXT * 2 }): boolean {
  if (v === null || v === undefined || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v) && Math.abs(v) <= 1e9;
  if (typeof v === 'string') { budget.text -= v.length; return v.length <= MAX_TEXT && budget.text >= 0; }
  if (depth > MAX_DEPTH) return false;
  if (Array.isArray(v)) { if (v.length > MAX_LIST) return false; for (const x of v) if (!sane(x, depth + 1, budget)) return false; return true; }
  if (typeof v === 'object') {
    let n = 0;
    for (const k in v as Record<string, unknown>) { if (++n > 200 || k.length > 40) return false; if (!sane((v as Record<string, unknown>)[k], depth + 1, budget)) return false; }
    return true;
  }
  return false;   // functions, symbols, bigints never come from JSON; anything else is not ours
}

/** an event as it must look before any handler sees it: an object with a short kind, sane all through */
export const eventOk = (e: unknown): boolean => !!e && typeof e === 'object' && !Array.isArray(e) && typeof (e as { k?: unknown }).k === 'string' && (e as { k: string }).k.length <= 8 && sane(e);

/** a VR pose as sent: head [x, y, z, yaw, pitch, roll], hands [x, y, z, qx, qy, qz, qw] or 0 */
function poseOk(v: unknown): boolean {
  if (!v) return true;
  if (typeof v !== 'object') return false;
  const p = v as { h?: unknown; r?: unknown; l?: unknown };
  const arr = (a: unknown, n: number) => a === 0 || (Array.isArray(a) && a.length === n && a.every((x) => num(x, 50)));
  return arr(p.h, 6) && arr(p.r ?? 0, 7) && arr(p.l ?? 0, 7);
}

/** a packed player state ([x, y, z, yaw, pitch, spd, item, swing, flags, hp, vr, armour]): true if usable */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function stateOk(a: unknown): a is any[] {
  if (!Array.isArray(a) || a.length < 10 || a.length > 16) return false;
  for (let i = 0; i < 6; i++) if (!num(a[i])) return false;
  if (typeof a[6] !== 'string' || a[6].length > 40) return false;
  if (!num(a[7], 1e9) || !Number.isInteger(a[8]) || !num(a[9], 1e4)) return false;
  if (!poseOk(a[10])) return false;
  return a[11] === undefined || a[11] === null || num(a[11], 1e4);
}

/** how many events a player may send: a burst, then a steady rate (more is dropped, not passed on) */
export class RateLimit {
  private tokens = new Map<number, { n: number; t: number }>();
  constructor(private readonly perSecond = 80, private readonly burst = 240) {}
  take(id: number): boolean {
    const now = performance.now(), b = this.tokens.get(id) ?? { n: this.burst, t: now };
    b.n = Math.min(this.burst, b.n + ((now - b.t) / 1000) * this.perSecond); b.t = now;
    this.tokens.set(id, b);
    if (b.n < 1) return false;
    b.n -= 1;
    return true;
  }
  forget(id: number) { this.tokens.delete(id); }
}
