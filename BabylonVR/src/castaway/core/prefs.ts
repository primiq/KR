// Tiny preference store. localStorage can be blocked (sandboxed frames, private windows),
// so fall back to window.name, which survives a reload of the same frame.
export function getPref(key: string): string | null {
  try { const v = localStorage.getItem(key); if (v !== null) return v; } catch { /* blocked */ }
  try {
    const m = new RegExp('(?:^|;)' + key + '=([^;]*)').exec(window.name);
    return m ? decodeURIComponent(m[1]) : null;
  } catch { return null; }
}

export function setPref(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* blocked */ }
  try {
    const rest = window.name.split(';').filter((p) => p && !p.startsWith(key + '=')).join(';');
    window.name = (rest ? rest + ';' : '') + key + '=' + encodeURIComponent(value);
  } catch { /* ignore */ }
}
