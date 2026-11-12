// An on-screen diagnostics panel for devices we cannot test on (a phone that freezes or goes black): the version, how far
// loading got, whether frames are still being drawn, the graphics chip, and the last errors. Shown with `?diag` in the
// address, and by itself as soon as something goes wrong (an uncaught error, the graphics lost). It is plain HTML updated
// by a timer, so it stays readable even when the 3D view has stopped; a screenshot of it says where things stand.
import type { Engine, Scene } from "@babylonjs/core";

const on = new URLSearchParams(location.search).has("diag");
const t0 = performance.now();
const errors: string[] = [];
let stage = "page loaded";
let stageAt = t0;
let engine: Engine | null = null, scene: Scene | null = null;
let rafs = 0, renders = 0, lastRender = 0, lost = 0, gpu = "?";
let el: HTMLDivElement | null = null;
let shown = on;

const sec = (ms: number) => (ms / 1000).toFixed(1) + "s";

function panel(): HTMLDivElement {
  if (el) return el;
  el = document.createElement("div");
  el.id = "diag";
  el.style.cssText = "position:fixed;left:6px;top:6px;z-index:2147483647;max-width:min(96vw,560px);padding:8px 10px;background:rgba(0,0,0,.82);color:#9effc9;font:12px/1.35 monospace;white-space:pre-wrap;word-break:break-word;border-radius:8px;pointer-events:none";
  document.body.appendChild(el);
  return el;
}

function draw() {
  if (!shown) return;
  const now = performance.now();
  const ver = document.getElementById("version")?.textContent || "?";
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  const lines = [
    `Castaway diagnostics  ${ver}`,
    `time ${sec(now - t0)}   stage: ${stage} (${sec(now - stageAt)} ago)`,
    `frames: page ${rafs}, 3D ${renders}${renders ? `, last 3D ${sec(now - lastRender)} ago` : ""}${engine ? `, fps ${engine.getFps().toFixed(0)}` : ""}`,
    engine ? `canvas ${engine.getRenderWidth()}x${engine.getRenderHeight()}  dpr ${window.devicePixelRatio}  webgl ${engine.webGLVersion}` : "engine: not made yet",
    `gpu: ${gpu}`,
    `graphics lost: ${lost}   memory: ${(navigator as unknown as { deviceMemory?: number }).deviceMemory ?? "?"} GB${mem ? `, js ${(mem.usedJSHeapSize / 1048576) | 0}/${(mem.jsHeapSizeLimit / 1048576) | 0} MB` : ""}`,
    scene ? `meshes ${scene.meshes.length}, active ${scene.getActiveMeshes().length}` : "",
    errors.length ? "errors:\n" + errors.slice(-6).join("\n") : "errors: none",
  ];
  panel().textContent = lines.filter(Boolean).join("\n");
}

function show() { shown = true; draw(); }

function addError(msg: string) {
  errors.push(`[${sec(performance.now() - t0)}] ${msg}`.slice(0, 300));
  show();
}

window.addEventListener("error", (e) => addError(e.message || String(e.error)));
window.addEventListener("unhandledrejection", (e) => addError("promise: " + String((e.reason as Error)?.message ?? e.reason)));
const ce = console.error.bind(console);
console.error = (...a: unknown[]) => { if (shown || on) errors.push(`[${sec(performance.now() - t0)}] ${a.map(String).join(" ")}`.slice(0, 300)); ce(...a); };

const tick = () => { rafs++; requestAnimationFrame(tick); };
requestAnimationFrame(tick);
setInterval(draw, 500);

/** where loading has got to (main.ts passes its progress text) */
export function diagStage(s: string) { stage = s; stageAt = performance.now(); }

/** the engine and scene, once made: frames drawn, the graphics chip, the graphics being lost */
export function diagEngine(e: Engine, s: Scene) {
  engine = e; scene = s;
  s.onAfterRenderObservable.add(() => { renders++; lastRender = performance.now(); });
  try {
    const gl = (e as unknown as { _gl: WebGLRenderingContext })._gl;
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
  } catch { /* not told */ }
  e.onContextLostObservable.add(() => { lost++; addError("the graphics were lost (context lost)"); });
}

/** safe mode (`?safe`): the warm-up's spin and menu opening skipped, no edge smoothing (to find what upsets a device) */
export const SAFE = new URLSearchParams(location.search).has("safe");
