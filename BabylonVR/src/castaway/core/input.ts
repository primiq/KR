import nipplejs from 'nipplejs';
import { isTouchDevice } from './quality';
// Ported from Castaway: unchanged apart from the VR hooks at the bottom.

/** Unified input: keyboard+mouse on desktop, virtual joystick + touch buttons on phones/tablets. */
export class Input {
  readonly touch = isTouchDevice();
  move = { x: 0, y: 0 };      // x: strafe right, y: forward
  lookDX = 0;
  lookDY = 0;
  jumpQueued = false;
  jumpHeld = false;
  sprint = false;
  flyToggle = false;
  timeDelta = 0;
  enabled = false;
  locked = false;
  /** inventory or death screen is open: gameplay input is ignored */
  uiOpen = false;

  attackQueued = false;
  attackHeld = false;
  interactQueued = false;
  /** cat house: meow */
  meowQueued = false;
  interactHeld = false;
  hotbarSelect: number | null = null;
  hotbarDelta = 0;
  /** a right click (mouse): with a torch in hand it plants the torch where you aim */
  altQueued = false;
  modeQueued = false; // toggle the held item's alternate mode (a torch: carry <-> place it)
  rotateQueued = 0;   // number of rotate steps pending (R)
  cycleDelta = 0;     // building piece cycling (Q / shift+Q)
  onInventory: (() => void) | null = null;
  onCraft: (() => void) | null = null;
  onMute: (() => void) | null = null;
  onMap: (() => void) | null = null;

  private keys = new Set<string>();
  private lookTouch: { id: number; x: number; y: number } | null = null;
  private sprintToggle = false;

  constructor(private canvas: HTMLCanvasElement, private onLockChange: (locked: boolean) => void) {
    document.body.classList.toggle('touch', this.touch);

    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (e.code === 'Tab' || e.code === 'KeyI') { e.preventDefault(); if (!e.repeat) this.onInventory?.(); return; }
      if (e.code === 'KeyN' && !e.repeat) { this.onMute?.(); return; }
      if (e.code === 'KeyM' && !e.repeat) { this.onMap?.(); return; }
      if (e.code === 'KeyC' && !e.repeat) { this.onCraft?.(); return; }
      if (this.uiOpen) return;
      this.keys.add(e.code);
      if (e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar') { this.jumpQueued = true; this.jumpHeld = true; e.preventDefault(); }
      if (e.code === 'KeyF') this.flyToggle = true;
      if (e.code === 'KeyT') this.timeDelta -= 1;
      if (e.code === 'KeyY') this.timeDelta += 1;
      if (e.code === 'KeyB' && !e.repeat) this.modeQueued = true;
      if (e.code === 'KeyR' && !e.repeat) this.rotateQueued++;
      if (e.code === 'KeyQ' && !e.repeat) this.cycleDelta += e.shiftKey ? -1 : 1;
      if (e.code === 'KeyE' && !e.repeat) this.interactQueued = true;
      if (e.code === 'KeyG' && !e.repeat) this.meowQueued = true;
      if (e.code === 'KeyE') this.interactHeld = true;
      const m = /^Digit([1-6])$/.exec(e.code);
      if (m) this.hotbarSelect = parseInt(m[1], 10) - 1;
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar') this.jumpHeld = false;
      if (e.code === 'KeyE') this.interactHeld = false;
    });
    window.addEventListener('blur', () => { this.keys.clear(); this.attackHeld = false; this.interactHeld = false; });

    if (!this.touch) {
      document.addEventListener('pointerlockchange', () => {
        this.locked = document.pointerLockElement === canvas;
        this.onLockChange(this.locked);
      });
      document.addEventListener('mousemove', (e) => {
        if (!this.locked) return;
        this.lookDX += e.movementX;
        this.lookDY += e.movementY;
      });
      document.addEventListener('mousedown', (e) => {
        if (!this.locked || this.uiOpen) return;
        if (e.button === 0) { this.attackQueued = true; this.attackHeld = true; }
        if (e.button === 2) { this.interactQueued = true; this.interactHeld = true; this.altQueued = true; }
      });
      document.addEventListener('mouseup', (e) => {
        if (e.button === 0) this.attackHeld = false;
        if (e.button === 2) this.interactHeld = false;
      });
      document.addEventListener('contextmenu', (e) => { if (this.locked) e.preventDefault(); });
      document.addEventListener('wheel', (e) => {
        if (!this.locked || this.uiOpen) return;
        this.hotbarDelta += Math.sign(e.deltaY);
      }, { passive: true });
    } else {
      this.setupTouch();
    }
  }

  requestLock() {
    if (this.touch) { this.onLockChange(true); return; }
    try { const r: any = this.canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch { /* optional */ }
  }

  private hold(id: string, down: () => void, up: () => void) {
    const el = document.getElementById(id)!;
    el.addEventListener('touchstart', (e) => { e.preventDefault(); down(); el.classList.add('on'); }, { passive: false });
    const end = () => { up(); el.classList.remove('on'); };
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
  }

  private setupTouch() {
    const zone = document.getElementById('zone-left')!;
    // The joystick is rebuilt whenever it could have missed its 'end' (touchcancel from a system gesture, a menu opening
    // under the finger, the tab losing focus). A missed end used to leave a frozen ring that never accepted a touch again.
    let stick: any = null, engaged = false;
    const make = () => {
      stick = nipplejs.create({ zone, mode: 'dynamic', color: 'white', size: 110, fadeTime: 150, restOpacity: 0.5 } as any);
      stick.on('start', () => { engaged = true; });
      stick.on('move', (e: any, d: any) => {
        const data = d ?? e?.data ?? e;
        if (!data?.angle) return;
        const f = Math.min(1, data.force ?? 1);
        this.move.x = Math.cos(data.angle.radian) * f;
        this.move.y = Math.sin(data.angle.radian) * f;
        // pushing the stick to the edge sprints
        if (f > 0.98) this.sprintToggle = true; else if (f < 0.8) this.sprintToggle = false;
      });
      stick.on('end', () => { engaged = false; this.move.x = 0; this.move.y = 0; this.sprintToggle = false; });
    };
    const reset = () => {
      this.move.x = 0; this.move.y = 0; this.sprintToggle = false; engaged = false;
      try { stick?.destroy(); } catch { /* already gone */ }
      zone.querySelectorAll('.nipple').forEach((n) => n.remove());
      make();
    };
    make();
    // a finger is on the joystick only if some live touch started in its zone; if the browser says otherwise, reset
    const zoneTouches = new Set<number>();
    zone.addEventListener('touchstart', (e) => { for (const t of Array.from(e.changedTouches)) zoneTouches.add(t.identifier); }, { passive: true, capture: true });
    const lifted = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) zoneTouches.delete(t.identifier);
      const live = new Set(Array.from(e.touches).map((t) => t.identifier));
      for (const id of [...zoneTouches]) if (!live.has(id)) zoneTouches.delete(id);
      if (e.type === 'touchcancel' || (engaged && zoneTouches.size === 0)) { zoneTouches.clear(); reset(); }
    };
    window.addEventListener('touchend', lifted, { passive: true, capture: true });
    window.addEventListener('touchcancel', lifted, { passive: true, capture: true });
    window.addEventListener('blur', () => { zoneTouches.clear(); reset(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { zoneTouches.clear(); reset(); } });
    window.addEventListener('pagehide', () => { zoneTouches.clear(); reset(); });
    // watchdog: movement stuck on with no finger down (or a menu opened) means a lost 'end'
    setInterval(() => {
      if ((this.move.x || this.move.y) && (zoneTouches.size === 0 || this.uiOpen)) { zoneTouches.clear(); reset(); }
    }, 400);

    this.hold('btn-jump', () => { if (!this.uiOpen) { this.jumpQueued = true; this.jumpHeld = true; } }, () => { this.jumpHeld = false; });
    this.hold('btn-hit', () => { if (!this.uiOpen) { this.attackQueued = true; this.attackHeld = true; } }, () => { this.attackHeld = false; });
    this.hold('btn-use', () => { if (!this.uiOpen) { this.interactQueued = true; this.interactHeld = true; } }, () => { this.interactHeld = false; });
    document.getElementById('btn-mode')!.addEventListener('touchstart', (e) => { e.preventDefault(); if (!this.uiOpen) this.modeQueued = true; }, { passive: false });
    document.getElementById('btn-rot')!.addEventListener('touchstart', (e) => { e.preventDefault(); if (!this.uiOpen) this.rotateQueued++; }, { passive: false });
    document.getElementById('btn-piece')!.addEventListener('touchstart', (e) => { e.preventDefault(); if (!this.uiOpen) this.cycleDelta++; }, { passive: false });
    document.getElementById('btn-map')!.addEventListener('touchstart', (e) => { e.preventDefault(); this.onMap?.(); }, { passive: false });
    document.getElementById('btn-bag')!.addEventListener('touchstart', (e) => { e.preventDefault(); this.onInventory?.(); }, { passive: false });
    const sp = document.getElementById('btn-sprint')!;
    sp.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.sprint = !this.sprint;
      sp.classList.toggle('on', this.sprint);
    }, { passive: false });

    // look: any touch that starts on the canvas (right side of the screen)
    this.canvas.addEventListener('touchstart', (e) => {
      for (const t of Array.from(e.changedTouches)) {
        if (this.lookTouch || t.clientX < window.innerWidth * 0.4) continue;
        this.lookTouch = { id: t.identifier, x: t.clientX, y: t.clientY };
      }
    }, { passive: true });
    this.canvas.addEventListener('touchmove', (e) => {
      if (!this.lookTouch) return;
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier !== this.lookTouch.id) continue;
        this.lookDX += (t.clientX - this.lookTouch.x) * 1.8;
        this.lookDY += (t.clientY - this.lookTouch.y) * 1.8;
        this.lookTouch.x = t.clientX; this.lookTouch.y = t.clientY;
      }
      e.preventDefault();
    }, { passive: false });
    const end = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) if (this.lookTouch && t.identifier === this.lookTouch.id) this.lookTouch = null;
    };
    this.canvas.addEventListener('touchend', end);
    this.canvas.addEventListener('touchcancel', end);
  }

  /** Called once per frame; fills move from the keyboard on desktop. */
  poll() {
    if (this.uiOpen) {
      this.move.x = 0; this.move.y = 0; this.sprint = false; this.sprintToggle = false;
      this.jumpQueued = this.jumpHeld = this.attackQueued = this.attackHeld = this.interactQueued = this.interactHeld = false;
      this.lookDX = this.lookDY = 0; this.rotateQueued = 0; this.cycleDelta = 0; this.modeQueued = false; this.altQueued = false;
      return;
    }
    if (!this.touch) {
      let x = 0, y = 0;
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
      const l = Math.hypot(x, y) || 1;
      this.move.x = x / l; this.move.y = y / l;
      this.sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    }
  }

  get wantsSprint() { return this.sprint || this.sprintToggle; }
  /** swim down (Ctrl or X; the left trigger in VR) */
  diveVR = false;
  get wantsDive() { return this.diveVR || (!this.uiOpen && (this.keys.has('ControlLeft') || this.keys.has('ControlRight') || this.keys.has('KeyX'))); }

  consumeLook() {
    const r = { dx: this.lookDX, dy: this.lookDY };
    this.lookDX = 0; this.lookDY = 0;
    return r;
  }
}
