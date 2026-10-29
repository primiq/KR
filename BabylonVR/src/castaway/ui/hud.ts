import { ITEMS, ItemId, ARMOR_SLOTS, ARMOR_SLOT_LABEL } from '../game/items';
import { Inventory } from '../game/inventory';
import type { Stats } from '../game/survival';
import { RECIPES, GROUP_LABEL, Recipe, canAfford, costHave, costLabel } from '../game/recipes';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const VITALS: { key: 'health' | 'hunger' | 'thirst' | 'stamina'; label: string; icon: string }[] = [
  { key: 'health', label: 'Health', icon: '<path d="M12 21s-7-4.4-9.3-9C1.2 8.8 3 5 6.5 5c2 0 3.6 1.1 5.5 3 1.9-1.9 3.5-3 5.5-3C21 5 22.8 8.8 21.3 12 19 16.6 12 21 12 21z"/>' },
  { key: 'hunger', label: 'Food', icon: '<path d="M12 7c-4.5-2.6-9 .6-8 6 .8 4.3 4 8 8 6.5 4 1.5 7.2-2.2 8-6.5 1-5.4-3.5-8.6-8-6z"/><path d="M12 7c0-2 1-3.6 3-4.4-.2 2-1 3.6-3 4.4z"/>' },
  { key: 'thirst', label: 'Water', icon: '<path d="M12 2.5c3.6 4.4 6.5 8 6.5 11.5a6.5 6.5 0 0 1-13 0C5.5 10.5 8.4 6.9 12 2.5z"/>' },
  { key: 'stamina', label: 'Stamina', icon: '<path d="M13.5 2 5 13.5h6L10 22l9-12h-6z"/>' },
];

const durBar = (s: { id: ItemId; dur?: number }) => {
  const max = ITEMS[s.id].dur;
  if (!max || s.dur === undefined || s.dur >= max) return '';
  const f = Math.max(0, s.dur / max);
  return `<span class="dur"><i style="width:${(f * 100).toFixed(0)}%;background:${f > 0.5 ? '#6fd36f' : f > 0.2 ? '#f2c14e' : '#e25555'}"></i></span>`;
};

export class Hud {
  selected = 0;
  /** VR mirrors: the plain-text version of what the HTML overlay is saying */
  onNote: ((text: string) => void) | null = null;
  promptText = '';
  promptName = ''; promptHint = ''; promptHot = false;
  buildText = '';
  /** the building chip's button line ("Trigger place · X rotate"), for the VR wrist panel */
  buildKeys = '';
  inventoryOpen = false;
  onUse: ((slot: number) => void) | null = null;
  onDrop: ((slot: number, all: boolean) => void) | null = null;
  onRespawn: (() => void) | null = null;
  onClose: (() => void) | null = null;
  onCraft: ((r: Recipe) => void) | null = null;
  onFuel: ((n: number) => void) | null = null;
  onChip: (() => void) | null = null;
  onXfer: ((fromContainer: boolean, slot: number) => void) | null = null;
  tab: 'bag' | 'craft' = 'bag';
  /** open storage box / furnace / campfire, if any */
  cont: Inventory | null = null;

  private hotSlots: HTMLElement[] = [];
  private gridSlots: HTMLElement[] = [];
  private contSlots: HTMLElement[] = [];
  private contTitle = '';
  private contStation = false;
  private contUnsub: (() => void) | null = null;
  private benchNear = false;
  private vit = new Map<string, { root: HTMLElement; fill: HTMLElement; val: HTMLElement }>();
  private pick: { c: 0 | 1 | 2; i: number } | null = null;
  private lastToast: { id: string; el: HTMLElement; n: number; t: number } | null = null;
  private promptKey = '';

  private armorEls: HTMLElement[] = [];
  onTakeOff: ((i: number) => void) | null = null;

  constructor(private inv: Inventory, private worn: Inventory | null = null) {
    // vitals
    const vitals = $('vitals');
    for (const v of VITALS) {
      const el = document.createElement('div');
      el.className = 'vital'; el.dataset.k = v.key; el.title = v.label;
      el.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${v.icon}</svg><div class="track"><div class="fill"></div></div><span class="val">100</span>`;
      vitals.appendChild(el);
      this.vit.set(v.key, { root: el, fill: el.querySelector('.fill') as HTMLElement, val: el.querySelector('.val') as HTMLElement });
    }
    // the air you have left: only while diving (or getting your breath back)
    {
      const el = document.createElement('div');
      el.className = 'vital hidden'; el.dataset.k = 'oxygen'; el.title = 'Air';
      el.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="15" r="4.5"/><circle cx="16.5" cy="9" r="3.2"/><circle cx="17" cy="18" r="2.2"/></svg><div class="track"><div class="fill"></div></div><span class="val">100</span>`;
      vitals.appendChild(el);
      this.vit.set('oxygen', { root: el, fill: el.querySelector('.fill') as HTMLElement, val: el.querySelector('.val') as HTMLElement });
    }

    // hotbar + grid
    const hotbar = $('hotbar'), grid = $('inv-grid');
    for (let i = 0; i < inv.size; i++) {
      if (i < inv.hotbar) {
        const b = this.makeSlot(i, true);
        b.addEventListener('click', () => this.select(i));
        hotbar.appendChild(b);
        this.hotSlots.push(b);
      }
      const g = this.makeSlot(i, i < inv.hotbar);
      if (i < inv.hotbar) g.classList.add('hot');
      g.addEventListener('click', () => this.gridClick(0, i));
      grid.appendChild(g);
      this.gridSlots.push(g);
    }

    if (worn) {
      const panel = document.createElement('section'); panel.id = 'armor';
      panel.innerHTML = '<h3>Armor <span id="armor-pct"></span></h3><div id="armor-slots"></div>';
      grid.parentElement!.insertBefore(panel, grid);
      const row = panel.querySelector('#armor-slots')!;
      ARMOR_SLOTS.forEach((sl, i) => {
        const b = this.makeSlot(i, false); b.classList.add('armor'); b.dataset.slot = ARMOR_SLOT_LABEL[sl];
        b.addEventListener('click', () => this.gridClick(2, i));
        row.appendChild(b); this.armorEls.push(b);
      });
      worn.subscribe(() => this.render());
    }
    inv.subscribe(() => this.render());
    $('inv-close').addEventListener('click', () => this.onClose?.());
    $('inventory').addEventListener('click', (e) => { if (e.target === $('inventory')) this.onClose?.(); });
    $('act-use').addEventListener('click', () => this.actUse());
    $('act-drop1').addEventListener('click', () => this.actDrop(false));
    $('act-dropall').addEventListener('click', () => this.actDrop(true));
    $('act-xfer').addEventListener('click', () => this.actXfer());
    $('tab-bag').addEventListener('click', () => this.setTab('bag'));
    $('tab-craft').addEventListener('click', () => this.setTab('craft'));
    $('fuel-add1').addEventListener('click', () => this.onFuel?.(1));
    $('fuel-add5').addEventListener('click', () => this.onFuel?.(5));
    $('build-chip').addEventListener('click', () => this.onChip?.());
    $('respawn').addEventListener('click', () => this.onRespawn?.());
    // the mouse is released while dead, so E (or Enter) respawns too
    window.addEventListener('keydown', (e) => {
      if ((e.code === 'KeyE' || e.code === 'Enter') && !e.repeat && !$('death').classList.contains('hidden')) { e.preventDefault(); this.onRespawn?.(); }
    });
    this.render();
  }

  // ---- actions on the picked slot (also used by the VR menu)
  actUse() { if (this.pick && this.pick.c === 0) this.onUse?.(this.pick.i); }
  actDrop(all: boolean) { if (this.pick && this.pick.c === 0) this.onDrop?.(this.pick.i, all); }
  actXfer() { if (this.pick) { const p = this.pick; this.pick = null; if (p.c === 2) this.onTakeOff?.(p.i); else this.onXfer?.(p.c === 1, p.i); this.render(); } }
  /** the slot currently picked in the bag (c = 0) or the open container (c = 1) */
  get picked() { return this.pick; }
  get bench() { return this.benchNear; }
  get contInfo() { return this.cont ? { title: this.contTitle, station: this.contStation } : null; }

  private makeSlot(i: number, showKey: boolean) {
    const b = document.createElement('button');
    b.className = 'slot'; b.type = 'button'; b.dataset.i = String(i);
    if (showKey) b.dataset.key = String(i + 1);
    return b;
  }

  private fillSlot(el: HTMLElement, i: number) {
    const s = this.inv.slots[i];
    const key = el.dataset.key ? `<span class="key">${el.dataset.key}</span>` : '';
    el.innerHTML = s
      ? `${key}${ITEMS[s.id].icon}${s.count > 1 ? `<span class="cnt">${s.count}</span>` : ''}${durBar(s)}`
      : key;
    el.setAttribute('aria-label', s ? `${ITEMS[s.id].name} ×${s.count}` : 'Empty slot');
  }

  render() {
    for (let i = 0; i < this.inv.size; i++) {
      if (i < this.inv.hotbar) {
        this.fillSlot(this.hotSlots[i], i);
        this.hotSlots[i].classList.toggle('sel', i === this.selected);
      }
      this.fillSlot(this.gridSlots[i], i);
      this.gridSlots[i].classList.toggle('sel', i === this.selected);
      this.gridSlots[i].classList.toggle('pick', !!this.pick && this.pick.c === 0 && this.pick.i === i);
    }
    if (this.worn) {
      let pct = 0;
      this.worn.slots.forEach((st, i) => {
        const el = this.armorEls[i];
        if (!el) return;
        el.innerHTML = st ? `${ITEMS[st.id].icon}${durBar(st)}` : '';
        el.classList.toggle('has', !!st);
        el.setAttribute('aria-label', st ? ITEMS[st.id].name : `${ARMOR_SLOT_LABEL[ARMOR_SLOTS[i]]} slot, empty`);
        el.classList.toggle('pick', !!this.pick && this.pick.c === 2 && this.pick.i === i);
        if (st) pct += ITEMS[st.id].armor?.def ?? 0;
      });
      const pe = document.getElementById('armor-pct'); if (pe) pe.textContent = pct ? `${Math.min(75, pct)}% protection` : 'none worn';
    }
    if (this.cont) {
      this.cont.slots.forEach((st, i) => {
        const el = this.contSlots[i];
        if (!el) return;
        el.innerHTML = st ? `${ITEMS[st.id].icon}${st.count > 1 ? `<span class="cnt">${st.count}</span>` : ''}${durBar(st)}` : '';
        el.setAttribute('aria-label', st ? `${ITEMS[st.id].name} ×${st.count}` : 'Empty slot');
        el.classList.toggle('pick', !!this.pick && this.pick.c === 1 && this.pick.i === i);
      });
    }
    this.renderDetail();
    if (this.inventoryOpen && this.tab === 'craft') this.renderCraft();
  }

  private pickedSlot() {
    if (!this.pick) return null;
    const inv = this.pick.c === 0 ? this.inv : this.pick.c === 2 ? this.worn : this.cont;
    return inv ? inv.slots[this.pick.i] : null;
  }

  private renderDetail() {
    const s = this.pickedSlot();
    if (this.pick && !s) this.pick = null;
    $('detail-empty').classList.toggle('hidden', !!s);
    $('detail-box').classList.toggle('hidden', !s);
    if (!s || !this.pick) return;
    const own = this.pick.c === 0, worn = this.pick.c === 2;
    const def = ITEMS[s.id];
    $('detail-icon').innerHTML = def.icon;
    $('detail-name').textContent = s.count > 1 ? `${def.name} ×${s.count}` : def.name;
    let desc = def.desc;
    if (def.tool) {
      const g = def.tool.gather;
      const per = Object.entries(g).map(([k, v]) => `${v} ${k}`).join(', ');
      desc += `${per ? ` Per hit: ${per}.` : ''} Damage ${def.tool.dmg}.`;
      if (def.dur && s.dur !== undefined) desc += ` Durability ${s.dur}/${def.dur}.`;
    }
    if (def.armor && s.dur !== undefined && def.dur) desc += ` Durability ${Math.max(0, Math.round(s.dur))}/${def.dur}.`;
    if (def.food) {
      const f = def.food, h = f.health ?? 0;
      desc += ` ${f.hunger >= 0 ? 'Restores' : 'Costs'} ${Math.abs(f.hunger)} food, ${f.thirst >= 0 ? 'restores' : 'costs'} ${Math.abs(f.thirst)} water${h ? `, ${h > 0 ? '+' : ''}${h} health` : ''}.`;
    }
    $('detail-desc').textContent = desc;
    $('act-use').classList.toggle('hidden', !own || (def.kind !== 'food' && def.kind !== 'armor'));
    $('act-use').textContent = def.kind === 'armor' ? 'Wear' : 'Eat';
    $('act-drop1').classList.toggle('hidden', !own || s.count < 2);
    $('act-dropall').classList.toggle('hidden', !own);
    $('act-dropall').textContent = s.count < 2 ? 'Drop' : 'Drop all';
    const x = $('act-xfer');
    x.classList.toggle('hidden', !this.cont && !worn);
    x.textContent = worn ? 'Take off' : own ? `Move to ${this.contTitle}` : 'Take';
  }

  slotClick(c: 0 | 1 | 2, i: number) { this.gridClick(c, i); }

  private gridClick(c: 0 | 1 | 2, i: number) {
    if (c === 2) { // an armor slot: tap with armor picked in the bag to wear it, otherwise select what is worn
      const pk = this.pick, it = pk && pk.c === 0 ? this.inv.slots[pk.i] : null;
      if (pk && it && ITEMS[it.id].armor?.slot === ARMOR_SLOTS[i]) { this.pick = null; this.onUse?.(pk.i); }
      else this.pick = this.worn?.slots[i] && !(pk && pk.c === 2 && pk.i === i) ? { c: 2, i } : null;
      this.render(); return;
    }
    const inv = c === 0 ? this.inv : this.cont;
    if (!inv) return;
    if (!this.pick) {
      if (inv.slots[i]) this.pick = { c, i };
    } else if (this.pick.c === c && this.pick.i === i) {
      this.pick = null;
    } else {
      if (this.pick.c === 2) { this.pick = { c, i }; this.render(); return; }
      const src = this.pick.c === 0 ? this.inv : this.cont!;
      const ok = Inventory.transfer(src, this.pick.i, inv, i);
      if (!ok && src !== inv) this.message(inv === this.cont ? 'That doesn’t go there' : 'Can’t take it there');
      this.pick = null;
    }
    if (c === 0 && i < this.inv.hotbar) this.selected = i;
    this.render();
  }

  // ------------------------------------------------------------ crafting pane
  setTab(t: 'bag' | 'craft') {
    this.tab = t;
    $('tab-bag').classList.toggle('on', t === 'bag');
    $('tab-craft').classList.toggle('on', t === 'craft');
    $('pane-bag').classList.toggle('hidden', t !== 'bag');
    $('pane-craft').classList.toggle('hidden', t !== 'craft');
    this.pick = null;
    this.render();
  }

  setBench(near: boolean) {
    if (near === this.benchNear) return;
    this.benchNear = near;
    if (this.inventoryOpen && this.tab === 'craft') this.renderCraft();
  }

  private renderCraft() {
    $('craft-note').textContent = this.benchNear ? 'A workbench is within reach.' : 'Some recipes need a workbench within reach.';
    const list = $('craft-list');
    list.textContent = '';
    let group = '';
    for (const r of RECIPES) {
      if (r.group !== group) {
        group = r.group;
        const h = document.createElement('div');
        h.className = 'craft-group'; h.textContent = GROUP_LABEL[r.group];
        list.appendChild(h);
      }
      const def = ITEMS[r.out];
      const afford = canAfford(this.inv, r);
      const canMake = afford && (!r.bench || this.benchNear);
      const row = document.createElement('div');
      row.className = 'craft-row';
      const costs = r.cost.map(([id, n]) => {
        const have = costHave(this.inv, r, id);
        return `<span class="${have >= n ? 'ok' : 'lack'}">${n} ${costLabel(r, id, ITEMS[id].name)} <small>(${have})</small></span>`;
      }).join('');
      row.innerHTML = `${def.icon}<div><div class="nm">${def.name}</div><div class="ds">${def.desc}</div><div class="cost">${costs}</div>${r.bench && !this.benchNear ? '<div class="need">Needs a workbench nearby</div>' : ''}</div><button type="button"${canMake ? '' : ' disabled'}>Craft</button>`;
      row.querySelector('button')!.addEventListener('click', () => this.onCraft?.(r));
      list.appendChild(row);
    }
  }

  // ------------------------------------------------------------ containers (storage box, furnace, campfire)
  openContainer(title: string, inv: Inventory, station: boolean, hint: string) {
    this.closeContainer(false);
    this.cont = inv; this.contTitle = title; this.contStation = station;
    $('cont-title').textContent = title;
    $('cont-hint').textContent = hint;
    $('cont').classList.remove('hidden');
    $('cont-fuel').classList.toggle('hidden', !station);
    const grid = $('cont-grid');
    grid.textContent = '';
    grid.classList.toggle('st', station);
    this.contSlots = [];
    for (let i = 0; i < inv.size; i++) {
      const b = document.createElement('button');
      b.className = 'slot'; b.type = 'button';
      if (station && i >= 4) b.classList.add('out');
      b.addEventListener('click', () => this.gridClick(1, i));
      grid.appendChild(b);
      this.contSlots.push(b);
    }
    this.contUnsub = inv.subscribe(() => this.render());
    this.setTab('bag');
  }

  closeContainer(rerender = true) {
    this.contUnsub?.(); this.contUnsub = null;
    this.cont = null; this.contSlots = [];
    if (this.pick?.c === 1) this.pick = null;
    $('cont').classList.add('hidden');
    if (rerender) this.render();
  }

  /** Fuel row of the open furnace/campfire. */
  setFuel(seconds: number, max: number, wood: number, lit: boolean, working: boolean) {
    if (!this.cont || !this.contStation) return;
    $('fuel-fill').style.width = `${Math.min(100, (seconds / max) * 100)}%`;
    const m = Math.floor(seconds / 60), sec = Math.floor(seconds % 60);
    $('fuel-text').textContent = seconds > 0 ? `${lit ? '🔥 ' : ''}${m}:${String(sec).padStart(2, '0')}${working ? ' · working' : ''}` : 'Out of fuel';
    $('fuel-text').classList.toggle('out', seconds <= 0);
    ($('fuel-add1') as HTMLButtonElement).disabled = wood < 1;
    ($('fuel-add5') as HTMLButtonElement).disabled = wood < 5;
  }

  select(i: number) {
    this.selected = ((i % this.inv.hotbar) + this.inv.hotbar) % this.inv.hotbar;
    this.render();
  }

  setInventory(open: boolean, tab: 'bag' | 'craft' = 'bag') {
    this.inventoryOpen = open;
    $('inventory').classList.toggle('hidden', !open);
    if (!open) { this.pick = null; this.closeContainer(false); }
    else this.setTab(this.cont ? 'bag' : tab);
    this.render();
  }

  setVitals(s: Stats) {
    for (const v of VITALS) {
      const val = s[v.key];
      const e = this.vit.get(v.key)!;
      e.fill.style.transform = `scaleX(${Math.max(0, val) / 100})`;
      const r = String(Math.round(val));
      if (e.val.textContent !== r) e.val.textContent = r;
      e.root.classList.toggle('low', val < 20);
    }
    const o = this.vit.get('oxygen')!;
    o.root.classList.toggle('hidden', s.oxygen >= 99.9);
    o.fill.style.transform = `scaleX(${Math.max(0, s.oxygen) / 100})`;
    const ov = String(Math.round(s.oxygen)); if (o.val.textContent !== ov) o.val.textContent = ov;
    o.root.classList.toggle('low', s.oxygen < 25);
    const vg = $('vignette');
    vg.classList.toggle('low', s.health < 25 && !s.dead);
  }

  flashHurt() {
    const vg = $('vignette');
    vg.classList.remove('hurt'); void vg.offsetWidth; vg.classList.add('hurt');
  }

  setHold(frac: number) {
    const el = $('prompt-hold');
    el.classList.toggle('hidden', frac <= 0);
    (el.firstElementChild as HTMLElement).style.width = `${Math.min(1, frac) * 100}%`;
  }

  /** Building/placing HUD: a chip with the current piece, and body classes for the touch buttons. */
  setBuild(chip: string | null, placing: boolean, planning: boolean, bad = false) {
    const el = $('build-chip');
    el.classList.toggle('hidden', !chip);
    el.classList.toggle('bad', bad);
    if (chip !== null && el.innerHTML !== chip) el.innerHTML = chip;
    this.buildText = chip ? chip.replace(/<small>.*?<\/small>/g, '').replace(/<[^>]*>/g, '') : '';
    this.buildKeys = chip ? (/<small>(.*?)<\/small>/.exec(chip)?.[1] ?? '').replace(/<[^>]*>/g, '') : '';
    document.body.classList.toggle('placing', placing || planning);
    document.body.classList.toggle('planning', planning);
  }

  /** VR: the screen fade can't be an HTML overlay */
  onFade: ((on: boolean) => void) | null = null;
  fade(on: boolean, text = '') {
    this.onFade?.(on);
    $('fade-text').textContent = text;
    $('fade').classList.toggle('on', on);
  }

  setPrompt(name: string | null, hint = '', hot = false) {
    const key = `${name}|${hint}|${hot}`;
    if (key === this.promptKey) return;
    this.promptText = name ? `${name}${hint ? ' · ' + hint.replace(/<[^>]*>/g, '') : ''}` : '';
    this.promptKey = key;
    this.promptName = name ?? ''; this.promptHint = name ? hint.replace(/<[^>]*>/g, '') : ''; this.promptHot = hot;
    $('prompt').classList.toggle('hidden', !name);
    $('crosshair').classList.toggle('hot', hot);
    if (name) { $('prompt-name').textContent = name; $('prompt-hint').innerHTML = hint; }
  }

  private pushToast(el: HTMLElement) {
    const box = $('toasts');
    box.appendChild(el);
    while (box.children.length > 5) box.firstElementChild!.remove();
    el.addEventListener('animationend', () => el.remove());
  }

  /** "+6 Wood" that grows while you keep hitting the same thing. */
  gain(id: ItemId, n: number) {
    this.onNote?.(`+${n} ${ITEMS[id].name}`);
    const now = performance.now();
    const lt = this.lastToast;
    if (lt && lt.id === id && now - lt.t < 1400 && lt.el.isConnected) {
      lt.n += n; lt.t = now;
      (lt.el.querySelector('.t') as HTMLElement).textContent = `+${lt.n} ${ITEMS[id].name}`;
      lt.el.style.animation = 'none'; void lt.el.offsetWidth; lt.el.style.animation = '';
      return;
    }
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `${ITEMS[id].icon}<span class="t">+${n} ${ITEMS[id].name}</span>`;
    this.pushToast(el);
    this.lastToast = { id, el, n, t: now };
  }

  message(text: string) {
    this.onNote?.(text);
    const el = document.createElement('div');
    el.className = 'toast msg';
    el.textContent = text;
    this.pushToast(el);
  }

  showDeath(cause: string, atBed = false) {
    $('death-cause').textContent = cause;
    $('respawn').innerHTML = (atBed ? 'Respawn at your bed' : 'Respawn on the beach') + ' &nbsp;<kbd>E</kbd>';
    $('death').classList.remove('hidden');
  }
  hideDeath() { $('death').classList.add('hidden'); }
}
