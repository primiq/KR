// Drawing on a picture's canvas: shared by the desktop paint editor and VR painting.
import { CANVAS_W, CANVAS_H } from './paintings';

/** a round-ended line of `size` pixels */
export function strokeLine(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, color: string, size: number) {
  ctx.strokeStyle = ctx.fillStyle = color;
  ctx.lineWidth = size; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1 + 0.01, y1); ctx.stroke();
}

/** flood fill from (x, y) with `color` (a little tolerance, so soft brush edges fill too) */
export function floodFill(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
  x = Math.floor(x); y = Math.floor(y);
  if (x < 0 || y < 0 || x >= CANVAS_W || y >= CANVAS_H) return;
  const img = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H), d = img.data, W = CANVAS_W, H = CANVAS_H;
  const hex = color.replace('#', ''), nr = parseInt(hex.slice(0, 2), 16), ng = parseInt(hex.slice(2, 4), 16), nb = parseInt(hex.slice(4, 6), 16);
  const o = (y * W + x) * 4, tr = d[o], tg = d[o + 1], tb = d[o + 2];
  if (Math.abs(tr - nr) + Math.abs(tg - ng) + Math.abs(tb - nb) < 6) return;
  const TOL = 70, same = (i: number) => Math.abs(d[i] - tr) + Math.abs(d[i + 1] - tg) + Math.abs(d[i + 2] - tb) <= TOL;
  const seen = new Uint8Array(W * H), stack = [x, y];
  while (stack.length) {
    const sy = stack.pop()!, sx0 = stack.pop()!;
    let sx = sx0;
    while (sx > 0 && !seen[sy * W + sx - 1] && same((sy * W + sx - 1) * 4)) sx--;
    let upOn = false, dnOn = false;
    for (; sx < W && !seen[sy * W + sx] && same((sy * W + sx) * 4); sx++) {
      const i = sy * W + sx, p = i * 4;
      seen[i] = 1; d[p] = nr; d[p + 1] = ng; d[p + 2] = nb; d[p + 3] = 255;
      if (sy > 0) { const u = i - W; const ok = !seen[u] && same(u * 4); if (ok && !upOn) { stack.push(sx, sy - 1); upOn = true; } else if (!ok) upOn = false; }
      if (sy < H - 1) { const v = i + W; const ok = !seen[v] && same(v * 4); if (ok && !dnOn) { stack.push(sx, sy + 1); dnOn = true; } else if (!ok) dnOn = false; }
    }
  }
  ctx.putImageData(img, 0, 0);
  }
