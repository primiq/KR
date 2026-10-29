// The paint editor: a full-screen panel over the game with a canvas and a few simple tools.
// Brush, eraser and paint bucket; brush size; a colour picker with swatches; undo; clear; save & close (or cancel).
import { CANVAS_W, CANVAS_H, PAPER, blankCanvas } from '../game/paintings';
import { strokeLine, floodFill } from '../game/brush';

export const SWATCHES = ['#111111', '#ffffff', '#7a7a7a', '#d8261d', '#f08a24', '#f6c21a', '#4caf3a', '#1f7a3a', '#2fb4d8', '#2b5fd2', '#6b3fb8', '#ec3f86', '#8a5a30', '#f2c8a0', '#9fd8ff', '#b8e986'];
export type Tool = 'brush' | 'eraser' | 'bucket';

const CSS = `
#painter{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;background:rgba(10,14,18,.72);font:14px system-ui,sans-serif;color:#f4efe4;touch-action:none}
#painter .pp{display:flex;flex-direction:column;gap:10px;background:#2b2118;border:3px solid #7a5230;border-radius:12px;padding:12px;max-width:96vw;max-height:96vh;overflow:auto;box-shadow:0 10px 40px rgba(0,0,0,.5)}
#painter .pp h3{margin:0;font-size:16px;letter-spacing:.02em}
#painter .row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
#painter canvas.art{background:${PAPER};border:6px solid #7a5230;border-radius:3px;cursor:crosshair;touch-action:none;width:min(86vw,calc((94vh - 250px) * 4 / 3),768px);height:auto;aspect-ratio:4/3;image-rendering:auto}
#painter button{font:inherit;color:#2b2118;background:#f3eee2;border:0;border-radius:7px;padding:7px 11px;cursor:pointer;min-height:34px}
#painter button.on{background:#ffd23f;box-shadow:0 0 0 2px #fff inset}
#painter button.go{background:#4caf3a;color:#fff;font-weight:700}
#painter button.warn{background:#c94a3a;color:#fff}
#painter .sw{width:26px;height:26px;min-height:0;padding:0;border-radius:50%;border:2px solid rgba(255,255,255,.35)}
#painter .sw.on{box-shadow:0 0 0 3px #ffd23f}
#painter input[type=range]{width:120px}
#painter input[type=color]{width:38px;height:32px;border:0;padding:0;background:none;cursor:pointer}
#painter .dot{display:inline-block;border-radius:50%;background:#f3eee2;vertical-align:middle}
`;

export class Painter {
  private root: HTMLDivElement | null = null;
  private art!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private tool: Tool = 'brush';
  private size = 8;
  private color = '#111111';
  private undo: ImageData[] = [];
  private down = false;
  private last: [number, number] | null = null;
  private done: ((data: string | null) => void) | null = null;
  private keyH = (e: KeyboardEvent) => {
    // the editor has the keyboard while it is open
    e.stopImmediatePropagation();
    if (e.type !== 'keydown') return;
    if (e.code === 'Escape') { e.preventDefault(); this.close(null); }
    else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); this.doUndo(); }
    else if (e.code === 'KeyB') this.setTool('brush');
    else if (e.code === 'KeyE') this.setTool('eraser');
    else if (e.code === 'KeyG') this.setTool('bucket');
  };

  get open() { return !!this.root; }

  /** open with the current picture ('' = blank); `onDone` gets the new PNG data URL, or null if cancelled */
  show(title: string, data: string, onDone: (data: string | null) => void) {
    if (this.root) this.close(null);
    if (!document.getElementById('painter-css')) { const s = document.createElement('style'); s.id = 'painter-css'; s.textContent = CSS; document.head.appendChild(s); }
    this.done = onDone;
    const r = document.createElement('div'); r.id = 'painter';
    r.innerHTML = `<div class="pp">
      <div class="row" style="justify-content:space-between"><h3>🖼️ ${title}</h3><span style="opacity:.7;font-size:12px">B brush · E eraser · G bucket · Ctrl+Z undo · Esc cancel</span></div>
      <canvas class="art" width="${CANVAS_W}" height="${CANVAS_H}"></canvas>
      <div class="row">
        <button data-t="brush" title="Brush (B)">🖌️ Brush</button><button data-t="eraser" title="Eraser (E)">🩹 Eraser</button><button data-t="bucket" title="Paint bucket (G)">🪣 Bucket</button>
        <label>Size <input type="range" min="1" max="48" value="${this.size}" data-k="size"></label><span class="dot" data-k="dot"></span>
      </div>
      <div class="row" data-k="sw">${SWATCHES.map((c) => `<button class="sw" data-c="${c}" style="background:${c}" title="${c}"></button>`).join('')}<input type="color" data-k="pick" value="${this.color}" title="Any colour"></div>
      <div class="row" style="justify-content:space-between">
        <span class="row"><button data-a="undo">↶ Undo</button><button class="warn" data-a="clear">Clear all</button></span>
        <span class="row"><button data-a="cancel">Cancel</button><button class="go" data-a="save">Save &amp; close</button></span>
      </div></div>`;
    document.body.appendChild(r);
    this.root = r;
    this.art = r.querySelector('canvas.art') as HTMLCanvasElement;
    this.ctx = this.art.getContext('2d', { willReadFrequently: true })!;
    this.ctx.drawImage(blankCanvas(), 0, 0);
    this.undo = [];
    if (data) { const img = new Image(); img.onload = () => this.ctx.drawImage(img, 0, 0, CANVAS_W, CANVAS_H); img.src = data; }
    r.querySelectorAll<HTMLButtonElement>('[data-t]').forEach((b) => b.addEventListener('click', () => this.setTool(b.dataset.t as Tool)));
    r.querySelectorAll<HTMLButtonElement>('[data-c]').forEach((b) => b.addEventListener('click', () => this.setColor(b.dataset.c!)));
    const pick = r.querySelector('[data-k=pick]') as HTMLInputElement;
    pick.addEventListener('input', () => this.setColor(pick.value));
    const size = r.querySelector('[data-k=size]') as HTMLInputElement;
    size.addEventListener('input', () => { this.size = +size.value; this.refresh(); });
    r.querySelector('[data-a=undo]')!.addEventListener('click', () => this.doUndo());
    r.querySelector('[data-a=clear]')!.addEventListener('click', () => { this.snap(); this.ctx.fillStyle = PAPER; this.ctx.fillRect(0, 0, CANVAS_W, CANVAS_H); });
    r.querySelector('[data-a=cancel]')!.addEventListener('click', () => this.close(null));
    r.querySelector('[data-a=save]')!.addEventListener('click', () => {
      // a PNG keeps drawings crisp and small; a very busy picture goes as a JPEG instead
      let d = this.art.toDataURL('image/png');
      if (d.length > 120_000) d = this.art.toDataURL('image/jpeg', 0.85);
      this.close(d);
    });
    this.art.addEventListener('pointerdown', (e) => this.onDown(e));
    this.art.addEventListener('pointermove', (e) => this.onMove(e));
    const up = () => { this.down = false; this.last = null; };
    this.art.addEventListener('pointerup', up); this.art.addEventListener('pointercancel', up); this.art.addEventListener('pointerleave', () => { this.last = null; });
    window.addEventListener('keydown', this.keyH, true); window.addEventListener('keyup', this.keyH, true);
    this.refresh();
  }

  close(data: string | null) {
    if (!this.root) return;
    window.removeEventListener('keydown', this.keyH, true); window.removeEventListener('keyup', this.keyH, true);
    this.root.remove(); this.root = null;
    const d = this.done; this.done = null;
    d?.(data);
  }

  private setTool(t: Tool) { this.tool = t; this.refresh(); }
  private setColor(c: string) { this.color = c; if (this.tool === 'eraser') this.tool = 'brush'; this.refresh(); }
  private refresh() {
    const r = this.root; if (!r) return;
    r.querySelectorAll<HTMLButtonElement>('[data-t]').forEach((b) => b.classList.toggle('on', b.dataset.t === this.tool));
    r.querySelectorAll<HTMLButtonElement>('[data-c]').forEach((b) => b.classList.toggle('on', b.dataset.c === this.color));
    (r.querySelector('[data-k=pick]') as HTMLInputElement).value = this.color;
    const dot = r.querySelector('[data-k=dot]') as HTMLSpanElement, d = Math.max(4, Math.min(34, this.size * 0.75));
    dot.style.width = dot.style.height = `${d}px`;
    dot.style.background = this.tool === 'eraser' ? PAPER : this.color;
  }

  private snap() { this.undo.push(this.ctx.getImageData(0, 0, CANVAS_W, CANVAS_H)); if (this.undo.length > 25) this.undo.shift(); }
  private doUndo() { const d = this.undo.pop(); if (d) this.ctx.putImageData(d, 0, 0); }

  private at(e: PointerEvent): [number, number] {
    const b = this.art.getBoundingClientRect(), bw = (b.width - this.art.clientWidth) / 2;   // inside the border
    const x = ((e.clientX - b.left - bw) / this.art.clientWidth) * CANVAS_W, y = ((e.clientY - b.top - bw) / this.art.clientHeight) * CANVAS_H;
    return [x, y];
  }

  private onDown(e: PointerEvent) {
    e.preventDefault();
    this.art.setPointerCapture?.(e.pointerId);
    const [x, y] = this.at(e);
    this.snap();
    if (this.tool === 'bucket') { this.fill(Math.floor(x), Math.floor(y)); return; }
    this.down = true; this.last = [x, y];
    this.stroke(x, y, x, y);
  }
  private onMove(e: PointerEvent) {
    if (!this.down) return;
    const [x, y] = this.at(e);
    if (this.last) this.stroke(this.last[0], this.last[1], x, y);
    this.last = [x, y];
  }
  private stroke(x0: number, y0: number, x1: number, y1: number) {
    strokeLine(this.ctx, x0, y0, x1, y1, this.tool === 'eraser' ? PAPER : this.color, this.size);
  }

  /** flood fill from (x, y) with the current colour */
  private fill(x: number, y: number) { floodFill(this.ctx, x, y, this.color); }
}
