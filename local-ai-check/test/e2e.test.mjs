// Loads the built page in Chromium under emulated devices and browsers, including ones that
// lack modern APIs, and checks that it always finishes the scan and renders results.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';

const require = createRequire(import.meta.url);
function loadPlaywright() {
  for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(p); } catch (e) { /* try next */ }
  }
  return null;
}

const page = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'index.html')).href;

// Init scripts run before the page's own scripts.
const fakeWebGL = (renderer, vendor) => `
  (function () {
    var patch = function (proto) {
      if (!proto) return;
      var orig = proto.getParameter;
      proto.getParameter = function (p) {
        if (p === 0x9246) return ${JSON.stringify(renderer)};
        if (p === 0x9245) return ${JSON.stringify(vendor)};
        if (p === 0x1F01) return ${JSON.stringify(renderer)};
        return orig.apply(this, arguments);
      };
    };
    patch(window.WebGLRenderingContext && WebGLRenderingContext.prototype);
    patch(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype);
  })();`;
const setNav = (key, value) => `try { Object.defineProperty(Navigator.prototype, ${JSON.stringify(key)}, { get: function () { return ${JSON.stringify(value)}; }, configurable: true }); } catch (e) {}`;
const removeNav = (key) => `try { Object.defineProperty(Navigator.prototype, ${JSON.stringify(key)}, { get: function () { return undefined; }, configurable: true }); } catch (e) {}`;

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
const WIN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';
const MAC_FF_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:150.0) Gecko/20100101 Firefox/150.0';

export const SCENARIOS = [
  { name: 'default headless Chromium (desktop)', viewport: { width: 1280, height: 900 }, init: [] },
  {
    name: 'Windows gaming PC (RTX 4070, 32 GB)', viewport: { width: 1440, height: 900 }, ua: WIN_UA,
    init: [fakeWebGL('ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 (0x00002786) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'Google Inc. (NVIDIA)'), setNav('deviceMemory', 32)],
    expect: { gpuText: 'RTX 4070', minWell: 40 },
  },
  {
    name: 'iPhone Safari (no deviceMemory, Apple GPU)', viewport: { width: 390, height: 844 }, ua: IPHONE_UA, mobile: true,
    init: [fakeWebGL('Apple GPU', 'Apple Inc.'), removeNav('deviceMemory'), removeNav('gpu'), setNav('maxTouchPoints', 5)],
    expect: { gpuText: 'iPhone' },
  },
  {
    name: 'Android phone (Adreno 750, 8 GB)', viewport: { width: 360, height: 780 }, ua: ANDROID_UA, mobile: true,
    init: [fakeWebGL('ANGLE (Qualcomm, Adreno (TM) 750, OpenGL ES 3.2)', 'Google Inc. (Qualcomm)'), setNav('deviceMemory', 8), removeNav('gpu')],
    expect: { gpuText: 'Adreno 750' },
  },
  {
    name: 'Firefox on Apple silicon Mac (bucketed renderer)', viewport: { width: 1280, height: 800 }, ua: MAC_FF_UA,
    init: [fakeWebGL('Apple M1, or similar', 'Apple'), removeNav('deviceMemory'), removeNav('gpu')],
    expect: { gpuText: 'Apple silicon Mac' },
  },
  {
    name: 'old browser: no Promise, no WebAssembly, no WebGL', viewport: { width: 1024, height: 768 },
    init: ['window.Promise = undefined; window.WebAssembly = undefined; HTMLCanvasElement.prototype.getContext = function () { return null; };', removeNav('gpu')],
  },
  {
    name: 'locked-down: storage throws, no WebGPU, no clipboard', viewport: { width: 800, height: 700 },
    init: ["Object.defineProperty(window, 'localStorage', { get: function () { throw new Error('denied'); } });", removeNav('gpu'), removeNav('clipboard'), removeNav('storage')],
  },
  { name: 'narrow 320 px phone', viewport: { width: 320, height: 640 }, ua: ANDROID_UA, mobile: true, init: [setNav('deviceMemory', 4), removeNav('gpu')] },
];

export async function runScenario(browser, sc, opts = {}) {
  const ctx = await browser.newContext({ viewport: sc.viewport, userAgent: sc.ua, isMobile: !!sc.mobile, hasTouch: !!sc.mobile, colorScheme: opts.colorScheme || 'light' });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  for (const s of sc.init) await p.addInitScript(s);
  // Fonts are optional; don't let a blocked network slow the test.
  await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await p.goto(page);
  let finished = true;
  try { await p.waitForSelector('#results:not([hidden]) .vcard', { timeout: 15000 }); }
  catch (e) { finished = false; }
  const info = await p.evaluate(() => {
    const n = (sel) => { const el = document.querySelector(sel); return el ? el.textContent : ''; };
    const counts = Array.prototype.map.call(document.querySelectorAll('.vcard .n'), (e) => parseInt(e.textContent, 10));
    return {
      counts,
      plate: n('#device-body'),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      probes: Array.prototype.map.call(document.querySelectorAll('.probe'), (li) => li.getAttribute('data-status') + ':' + li.querySelector('.probe-detail').textContent),
    };
  });
  if (opts.screenshot) await p.screenshot({ path: opts.screenshot, fullPage: !!opts.fullPage });
  await ctx.close();
  return { finished, errors, ...info };
}

export default async function test(assert) {
  const pw = loadPlaywright();
  if (!pw) { console.log('    (Playwright not installed; skipping e2e)'); return; }
  if (!existsSync(fileURLToPath(page))) { assert.fail('docs/index.html missing; run node build.mjs'); return; }
  const browser = await pw.chromium.launch();
  try {
    for (const sc of SCENARIOS) {
      const r = await runScenario(browser, sc);
      assert.ok(r.finished, `${sc.name}: results rendered`);
      assert.ok(r.errors.length === 0, `${sc.name}: no errors (${r.errors.join(' | ')})`);
      assert.ok(r.overflow <= 0, `${sc.name}: no horizontal scroll (overflow ${r.overflow}px)`);
      const total = (r.counts || []).reduce((a, b) => a + b, 0);
      assert.ok(total > 100, `${sc.name}: models classified (${total})`);
      if (sc.expect && sc.expect.gpuText) assert.ok(r.plate.indexOf(sc.expect.gpuText) >= 0, `${sc.name}: plate mentions ${sc.expect.gpuText}`);
      if (sc.expect && sc.expect.minWell) assert.ok(r.counts[0] >= sc.expect.minWell, `${sc.name}: at least ${sc.expect.minWell} run well (got ${r.counts[0]})`);
      console.log(`    ${sc.name}: well/slow/no = ${r.counts.join('/')}`);
    }
  } finally {
    await browser.close();
  }
}
