// Anonymous usage reporting (Settings > "Send anonymous usage data", on unless switched off). A handful of events, sent
// in batches to the site's own Worker (worker/index.ts), which writes them to Cloudflare's logs:
//   start (device kind, quality, body), play, level (which one), mp (host / join), err (how many), end (minutes played)
// Each carries a random id made in this browser (to tell one player's sessions apart, never who they are) and the
// game's version. No names, no chat, no paintings, no positions. Nothing is sent from a local test server.
import { getPref, setPref } from '../core/prefs';

type Ev = { k: string } & Record<string, string | number | boolean>;
const queue: Ev[] = [];
const local = /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(location.hostname) || location.protocol === 'file:';
let ver = '';

export const telemetryOn = () => getPref('castaway.telemetry') !== '0';
export const setTelemetry = (on: boolean) => { setPref('castaway.telemetry', on ? '1' : '0'); if (!on) queue.length = 0; };

function anonId(): string {
  let id = getPref('castaway.anon');
  if (!id) { id = Math.random().toString(36).slice(2, 12); setPref('castaway.anon', id); }
  return id;
}

/** something happened (only when reporting is on; sent with the next batch) */
export function track(k: string, fields: Record<string, string | number | boolean> = {}) {
  if (!telemetryOn() || local || queue.length > 60) return;
  queue.push({ k, ...fields });
}

function flush(beacon = false) {
  if (!queue.length || !telemetryOn() || local) return;
  const body = JSON.stringify({ id: anonId(), v: ver, ev: queue.splice(0, 40) });
  try {
    if (beacon && navigator.sendBeacon) navigator.sendBeacon('/api/e', new Blob([body], { type: 'application/json' }));
    else void fetch('/api/e', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {});
  } catch { /* never in the player's way */ }
}

/** once at boot: the version, the batch timer, the last batch as the page goes */
export function startTelemetry(version: string) {
  ver = version;
  const t0 = performance.now();
  setInterval(() => flush(), 60_000);
  let ended = false;
  const end = () => { if (ended) return; ended = true; track('end', { mins: Math.round((performance.now() - t0) / 6000) / 10 }); flush(true); };
  window.addEventListener('pagehide', end);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(true); });
}
