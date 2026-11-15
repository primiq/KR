// Browser smoke tests: the built game (npx vite preview) is opened in headless Chromium and each check fails on any
// page error. Run with `npm run smoke` after `npx vite build`; BASE=<url> tests another server (a deployed site).
// Two players in one room is not covered: two headless WebGL pages run at about 1 fps, too slow to hold a room.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const PORT = 4179;
const BASE = process.env.BASE || `http://localhost:${PORT}`;
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const results = [];

async function page(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 450 }, ...opts });
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(e.message));
  p.setDefaultTimeout(600_000);
  return p;
}

async function check(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push([name, 'ok', Date.now() - t0]); }
  catch (e) { results.push([name, 'FAIL: ' + (e.message || e).toString().slice(0, 300), Date.now() - t0]); }
}

const noErrors = (p) => { if (p.errors.length) throw new Error('page errors: ' + p.errors.slice(0, 3).join(' | ')); };

/** boots straight into the island (`?go`) and checks frames are drawn and the player stands on something */
async function boot(p, quality) {
  await p.goto(`${BASE}/index.html?quality=${quality}&go`);
  await p.waitForFunction(() => window.engine && window.player && window.game, null, { polling: 1000 });
  const before = await p.evaluate(() => window.scene.getFrameId());
  await p.waitForTimeout(4000);
  const s = await p.evaluate(() => ({ frames: window.scene.getFrameId(), y: window.player.pos.y }));
  if (s.frames <= before) throw new Error('no frames drawn after boot');
  if (!Number.isFinite(s.y)) throw new Error('player position is not a number');
  noErrors(p);
}

async function main() {
  let server = null;
  if (!process.env.BASE) {
    server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true });
    for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/index.html')).ok) break; } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 500)); }
  }
  const browser = await chromium.launch({ args: ARGS });
  try {
    await check('boots on Low', async () => { const p = await page(browser); await boot(p, 'low'); await p.context().close(); });
    await check('boots on High', async () => { const p = await page(browser); await boot(p, 'high'); await p.context().close(); });

    await check('save and reload keep the island', async () => {
      const p = await page(browser);
      await boot(p, 'low');
      const mark = await p.evaluate(() => { window.game.inv.add('rock', 7); window.board.menuActions.save(); return window.game.inv.count('rock'); });
      await p.reload();
      await p.waitForFunction(() => window.game && window.player, null, { polling: 1000 });
      await p.waitForTimeout(2000);
      const after = await p.evaluate(() => window.game.inv.count('rock'));
      if (after !== mark) throw new Error(`stones before ${mark}, after reload ${after}`);
      noErrors(p); await p.context().close();
    });

    await check('customise with each body', async () => {
      const p = await page(browser, { viewport: { width: 1100, height: 750 } });
      await p.goto(`${BASE}/index.html`);
      await p.click('#customise');
      await p.waitForTimeout(1500);
      for (let i = 0; i < 2; i++) { await p.click('#cz-rows .cz-row >> nth=0 >> button >> nth=1'); await p.waitForTimeout(3000); }
      if (!(await p.isVisible('#cz-canvas'))) throw new Error('no preview canvas');
      noErrors(p); await p.context().close();
    });

    await check('phone: menu and Settings fit the screen', async () => {
      const p = await page(browser, { ...devices['iPhone 13'] });
      await p.goto(`${BASE}/index.html`);
      await p.waitForTimeout(1500);
      const over = await p.evaluate(() => {
        document.querySelectorAll('.menu-sub').forEach((e) => e.classList.add('hidden'));
        document.getElementById('settings').classList.remove('hidden');
        return [...document.querySelectorAll('#settings *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).map((e) => e.id || e.className || e.tagName).slice(0, 5);
      });
      if (over.length) throw new Error('wider than the screen: ' + over.join(', '));
      noErrors(p); await p.context().close();
    });
  } finally {
    await browser.close();
    if (server) try { process.kill(-server.pid); } catch { /* gone */ }
  }
  for (const [n, r, ms] of results) console.log(`${r === 'ok' ? 'ok  ' : 'FAIL'} ${n} (${(ms / 1000).toFixed(1)} s)${r === 'ok' ? '' : '\n     ' + r}`);
  process.exit(results.every((r) => r[1] === 'ok') ? 0 : 1);
}
main();
