// Long session check (production plan 17). Needs a server: `npx vite build && npx vite preview --port 4173`, then
// `npm run soak` (LAPS=n, default 6; BASE=<url>). Each lap visits the island, the islets, the bergs, the Arctic, the
// Christmas village and back; prints heap, mesh, material, texture counts and which mesh names changed. A count that
// keeps climbing lap after lap is a leak; the first lap or two only fill caches.
// A long session: the same loop of places over and over (island, open sea, Arctic, the Christmas village, a grotto,
// back), recording JS heap, meshes, materials, textures and geometries after each lap. Growth lap over lap = a leak.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
  const p = await b.newPage({ viewport: { width: 640, height: 360 } });
  p.on('pageerror', (e) => console.log('ERR', e.message));
  await p.goto((process.env.BASE || 'http://localhost:4173') + '/index.html?quality=low&go');
  await p.waitForFunction(() => window.game && window.player, null, { timeout: 600000, polling: 1000 });
  await p.waitForTimeout(15000);
  const names = () => p.evaluate(() => { const h = {}; for (const m of scene.meshes) { const k = m.name.replace(/[0-9]+/g, '#'); h[k] = (h[k] || 0) + 1; } return h; });
  let prevN = null;
  const stat = () => p.evaluate(() => { if (window.gc) window.gc(); return { heap: Math.round(performance.memory.usedJSHeapSize / 1048576), meshes: scene.meshes.length, mats: scene.materials.length, tex: scene.textures.length, geo: scene.geometries.length, nodes: scene.transformNodes.length, lights: scene.lights.length }; });
  const go = (x, z, mode = 'walk') => p.evaluate(([x, z, mode]) => { player.mode = mode; player.teleport(x, Math.max(0.5, heightAt(x, z) + 0.1), z, 0); }, [x, z, mode]);
  const LAPS = +(process.env.LAPS || 6);
  console.log('start', JSON.stringify(await stat()));
  for (let lap = 1; lap <= LAPS; lap++) {
    await go(-122, -151); await p.waitForTimeout(6000);
    await p.evaluate(() => { game.inv.add('wood', 5); game.toggleMap(true); }); await p.waitForTimeout(1500); await p.evaluate(() => game.toggleMap(false));
    await go(900, 600, 'fly'); await p.waitForTimeout(6000);                // the islets
    await go(-1040, -4200, 'fly'); await p.waitForTimeout(8000);            // the bergs (mouths, camps)
    await go(0, -7900); await p.waitForTimeout(8000);                        // the Arctic, penguins
    await p.evaluate(() => { const a = -Math.PI / 2, r = 7600 + 230 * Math.sin(3 * a + 1.3) + 150 * Math.sin(7 * a + 0.4) + 80 * Math.sin(17 * a + 2.2) + 35 * Math.sin(41 * a + 0.9) + 650 - 3; player.mode = 'walk'; player.teleport(0, heightAt(0, -r + 1) + 0.1, -r + 1, 0); });
    await p.waitForTimeout(8000);                                            // into the Christmas village
    await p.evaluate(() => player.teleport(16000, 60.05, 116.5, Math.PI)); await p.waitForTimeout(6000);  // and out
    await go(-122, -151); await p.waitForTimeout(8000);
    console.log('lap', lap, JSON.stringify(await stat()));
    const n = await names(); if (prevN) { const d = Object.entries(n).map(([k, v]) => [k, v - (prevN[k] || 0)]).filter(([, v]) => v !== 0); console.log('  diff', JSON.stringify(d)); } prevN = n;
  }
  await b.close();
})().catch(e => console.error('FAIL', e.message));
