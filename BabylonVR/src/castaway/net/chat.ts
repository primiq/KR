// Quick chat: pick a phrase (V then 1-8, or tap). No free text, so nothing to moderate and no keyboard on phones.
export const PHRASES = ['Hello!', 'Help!', 'Over here', 'Follow me', 'Thanks!', 'Danger!', 'Need wood', 'Nice base!'];

export class Chat {
  private log: HTMLElement;
  private menu: HTMLElement;
  private btn: HTMLButtonElement;
  private active = false;
  private open = false;

  constructor(private send: (text: string) => void, private ping: () => void = () => {}) {
    const hud = document.getElementById('hud')!;
    this.log = document.createElement('div'); this.log.id = 'chat-log';
    this.menu = document.createElement('div'); this.menu.id = 'chat-menu'; this.menu.className = 'hidden';
    this.btn = document.createElement('button'); this.btn.id = 'btn-chat'; this.btn.type = 'button'; this.btn.setAttribute('aria-label', 'Quick chat');
    this.btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/></svg>';
    this.btn.classList.add('hidden');
    PHRASES.forEach((p, i) => {
      const b = document.createElement('button'); b.type = 'button';
      b.innerHTML = `<i>${i + 1}</i>${p}`;
      b.addEventListener('click', () => this.pick(i));
      this.menu.appendChild(b);
    });
    const pb = document.createElement('button'); pb.type = 'button'; pb.className = 'ping';
    pb.innerHTML = '<i>9</i>📍 Ping where I look';
    pb.addEventListener('click', () => { this.toggle(false); this.ping(); });
    this.menu.appendChild(pb);
    hud.append(this.log, this.menu, this.btn);
    this.btn.addEventListener('click', () => this.toggle());
    // capture phase: while the menu is open it owns the number keys, so the hotbar does not change
    window.addEventListener('keydown', (e) => {
      if (!this.active || e.repeat) return;
      if (e.code === 'KeyV') { this.toggle(); e.stopImmediatePropagation(); return; }
      if (!this.open) return;
      const m = /^Digit([1-9])$/.exec(e.code);
      if (m) { const n = parseInt(m[1], 10) - 1; if (n < PHRASES.length) this.pick(n); else { this.toggle(false); this.ping(); } e.stopImmediatePropagation(); e.preventDefault(); }
      else if (e.code === 'Escape') { this.toggle(false); }
    }, true);
  }

  setActive(on: boolean) {
    this.active = on;
    this.btn.classList.toggle('hidden', !on);
    if (!on) this.toggle(false);
  }

  toggle(force?: boolean) {
    this.open = force ?? !this.open;
    this.menu.classList.toggle('hidden', !this.open);
  }

  private pick(i: number) {
    this.toggle(false);
    this.send(PHRASES[i]);
  }

  add(name: string, color: string, text: string) {
    const row = document.createElement('div');
    const b = document.createElement('b'); b.textContent = name; b.style.color = color;
    row.append(b, document.createTextNode(` ${text}`));
    this.log.appendChild(row);
    while (this.log.children.length > 5) this.log.firstChild!.remove();
    setTimeout(() => row.classList.add('old'), 9000);
    setTimeout(() => row.remove(), 10000);
  }
}
