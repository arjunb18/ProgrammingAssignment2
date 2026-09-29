// Loads the built page in Chromium under emulated devices and browsers, including ones that
// lack modern APIs, and checks that it always finishes the scan and renders results.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

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
  {
    name: 'HarmonyOS NEXT phone (ArkWeb)', viewport: { width: 390, height: 844 }, mobile: true,
    ua: 'Mozilla/5.0 (Phone; OpenHarmony 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36 ArkWeb/4.1.6.1 Mobile',
    init: [removeNav('gpu')],
    // The plate must name the real OS, not "Android phone" or "Unknown OS".
    expect: { gpuText: 'Phone · HarmonyOS 5.0' },
  },
];

export async function runScenario(browser, sc, opts = {}, assert = null) {
  const ctx = await browser.newContext({ viewport: sc.viewport, userAgent: sc.ua, isMobile: !!sc.mobile, hasTouch: !!sc.mobile, colorScheme: opts.colorScheme || 'light' });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  for (const s of sc.init) await p.addInitScript(s);
  // Fonts are optional. The requests hang (never answer), as on networks that silently drop
  // Google Fonts: the page must still scan and render, so the font stylesheet may not block it.
  // Screenshots wait for document.fonts, so a run that takes one aborts the requests instead.
  if (opts.screenshot) await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  else await p.route(/fonts\.(googleapis|gstatic)\.com/, () => {});
  await p.goto(page, { waitUntil: 'domcontentloaded' });
  let finished = true;
  try { await p.waitForSelector('#results:not([hidden]) .vcard', { timeout: 15000 }); }
  catch (e) { finished = false; }
  const info = await p.evaluate(() => {
    const n = (sel) => { const el = document.querySelector(sel); return el ? el.textContent : ''; };
    const counts = Array.prototype.map.call(document.querySelectorAll('.vcard .n'), (e) => parseInt(e.textContent, 10));
    const card = document.querySelector('.vcard');
    return {
      counts,
      // bottom edge of the verdict counts, relative to the first screen
      cardsBottom: card ? card.getBoundingClientRect().bottom + window.scrollY : 1e9,
      headlineTop: document.querySelector('.headline') ? document.querySelector('.headline').getBoundingClientRect().top + window.scrollY : 1e9,
      viewportH: window.innerHeight,
      scanCollapsed: !document.getElementById('scan-details').open,
      rescanHidden: document.getElementById('rescan').hidden,
      plate: n('#device-body'),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      probes: Array.prototype.map.call(document.querySelectorAll('.probe'), (li) => li.getAttribute('data-status') + ':' + li.querySelector('.probe-detail').textContent),
    };
  });
  if (opts.after) await opts.after(p, assert);
  if (opts.screenshot) await p.screenshot({ path: opts.screenshot, fullPage: !!opts.fullPage });
  await ctx.close();
  return { finished, errors, ...info };
}

export default async function test(assert) {
  const pw = loadPlaywright();
  if (!pw) { console.log('    (Playwright not installed; skipping e2e)'); return; }
  if (!existsSync(fileURLToPath(page))) { assert.fail('docs/index.html missing; run node build.mjs'); return; }
  const artifact = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'artifact.html');
  if (existsSync(artifact)) {
    const a = readFileSync(artifact, 'utf8');
    assert.ok(!/<(html|head|body)[\s>]/i.test(a), 'artifact.html has no document wrapper');
    assert.ok(/media="print" onload="this\.media='all'">/.test(a) && /<noscript><link rel="stylesheet"/.test(a), 'artifact.html keeps the non-blocking font link and its noscript fallback');
  }
  const browser = await pw.chromium.launch();
  try {
    for (const sc of SCENARIOS) {
      const r = await runScenario(browser, sc);
      assert.ok(r.finished, `${sc.name}: results rendered (font requests hanging)`);
      // The answer is on the first screen: the whole verdict row on screens at least 760 px tall,
      // at least the headline sentence on shorter ones.
      if (r.viewportH >= 760) assert.ok(r.cardsBottom <= r.viewportH, `${sc.name}: verdict counts on the first screen (bottom ${Math.round(r.cardsBottom)} > ${r.viewportH})`);
      else assert.ok(r.headlineTop + 48 <= r.viewportH, `${sc.name}: headline starts on the first screen (top ${Math.round(r.headlineTop)}, screen ${r.viewportH})`);
      assert.ok(r.scanCollapsed, `${sc.name}: scan checklist folded after the scan`);
      assert.ok(!r.rescanHidden, `${sc.name}: "Scan again" shown after the scan`);
      assert.ok(r.errors.length === 0, `${sc.name}: no errors (${r.errors.join(' | ')})`);
      assert.ok(r.overflow <= 0, `${sc.name}: no horizontal scroll (overflow ${r.overflow}px)`);
      const total = (r.counts || []).reduce((a, b) => a + b, 0);
      assert.ok(total > 100, `${sc.name}: models classified (${total})`);
      if (sc.expect && sc.expect.gpuText) assert.ok(r.plate.indexOf(sc.expect.gpuText) >= 0, `${sc.name}: plate mentions ${sc.expect.gpuText}`);
      if (sc.expect && sc.expect.minWell) assert.ok(r.counts[0] >= sc.expect.minWell, `${sc.name}: at least ${sc.expect.minWell} run well (got ${r.counts[0]})`);
      console.log(`    ${sc.name}: well/slow/no = ${r.counts.join('/')}`);
    }
    await interactionTests(browser, assert);
  } finally {
    await browser.close();
  }
}

const pick = (prefix) => SCENARIOS.find((s) => s.name.startsWith(prefix));
const active = (p) => p.evaluate(() => { const a = document.activeElement; return a ? (a.id || a.getAttribute('data-filter') || a.getAttribute('data-target') || a.getAttribute('data-gb') || a.tagName) : ''; });

// A Windows PC whose browser exposes WebGPU with shader-f16, so WebLLM models are offered.
const WEBGPU_PC = {
  name: 'Windows PC with WebGPU (GTX 1060)', viewport: { width: 1280, height: 900 }, ua: WIN_UA,
  init: [
    fakeWebGL('ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 6GB Direct3D11 vs_5_0 ps_5_0, D3D11)', 'Google Inc. (NVIDIA)'), setNav('deviceMemory', 16),
    "window.GPUBufferUsage = { STORAGE: 128 }; Object.defineProperty(Navigator.prototype, 'gpu', { configurable: true, get: function () { return { requestAdapter: function () { return Promise.resolve({ limits: { maxBufferSize: 2147483648, maxStorageBufferBindingSize: 1073741824 }, features: new Set(['shader-f16']), info: { vendor: 'nvidia', architecture: 'pascal', device: '', description: '' }, requestDevice: function () { return new Promise(function () {}); } }); } }; } });",
  ],
};

async function interactionTests(browser, assert) {
  // Page structure and landmarks.
  await runScenario(browser, pick('Windows gaming'), { after: async (p) => {
    const s = await p.evaluate(() => ({
      main: !!document.querySelector('main #results'),
      status: !!document.querySelector('#sr-status[role="status"]'),
      probesLive: document.getElementById('probes').hasAttribute('aria-live'),
      order: document.getElementById('results').compareDocumentPosition(document.getElementById('device')) & 4,
      fontLink: (document.querySelector('link[href*="fonts.googleapis.com/css2"]') || {}).media,
    }));
    assert.ok(s.main && s.status && !s.probesLive, `landmarks: <main>, a status region, no chatty live probe list (${JSON.stringify(s)})`);
    assert.ok(s.order, 'results come before the device plate');
    assert.equal(s.fontLink, 'print', 'font stylesheet is non-blocking (media=print until it loads)');

    // Search: the input is never replaced and keeps focus; IME composition is not interrupted.
    const q = await p.$('#q');
    await q.focus();
    await p.keyboard.type('qwen', { delay: 30 });
    await p.waitForTimeout(400);
    assert.ok(await p.evaluate((el) => el === document.getElementById('q') && document.activeElement === el, q), 'search box survives typing and keeps focus');
    const cdp = await p.context().newCDPSession(p);
    await p.fill('#q', '');
    await q.focus();
    await cdp.send('Input.insertText', { text: 'qw' });
    await cdp.send('Input.imeSetComposition', { text: 'qwe', selectionStart: 3, selectionEnd: 3 });
    await p.waitForTimeout(400);
    await cdp.send('Input.insertText', { text: 'qwen' });
    await p.waitForTimeout(400);
    const v = await p.$eval('#q', (el) => el.value);
    // A plain input ends with 'qwqwen' for this CDP sequence; rebuilding the box mid-composition gave 'qwqweqwen'.
    assert.ok(v === 'qwqwen' && await p.evaluate((el) => el === document.getElementById('q'), q), `IME composition not duplicated (value ${JSON.stringify(v)})`);
    await p.fill('#q', '');
    await p.waitForTimeout(300);

    // Keyboard focus stays on the control that re-rendered the results.
    await p.focus('[data-action="filter"][data-filter="vision"]');
    await p.keyboard.press('Enter');
    assert.equal(await active(p), 'vision', 'focus stays on a filter chip after Enter');
    await p.focus('[data-action="filter"][data-filter="all"]');
    await p.keyboard.press('Enter');
    await p.focus('.seg [data-target="browser"]');
    await p.keyboard.press('Space');
    assert.equal(await active(p), 'browser', 'focus stays on the view toggle');
    await p.focus('.seg [data-target="native"]');
    await p.keyboard.press('Space');
    await p.focus('#g-well .more');
    await p.keyboard.press('Enter');
    assert.ok(await p.evaluate(() => { const a = document.activeElement; return a && a.classList.contains('model') && a.parentNode.children[25] === a; }), 'Show all moves focus to the first newly shown model');

    // Correcting the GPU with the keyboard: arrows step through options, focus stays, badge says "you set".
    await p.evaluate(() => { document.getElementById('fix').open = true; });
    await p.focus('#ov-gpu');
    for (let i = 0; i < 3; i++) { await p.keyboard.press('ArrowDown'); await p.waitForTimeout(50); }
    await p.waitForTimeout(500);
    const g = await p.evaluate(() => ({ idx: document.getElementById('ov-gpu').selectedIndex, focus: document.activeElement.id, open: document.getElementById('fix').open,
      badge: Array.prototype.map.call(document.querySelectorAll('#device-body .conf'), (e) => e.textContent).join(',') }));
    assert.ok(g.idx === 3 && g.focus === 'ov-gpu' && g.open, `GPU dropdown: arrows step, focus and panel stay (${JSON.stringify(g)})`);
    assert.ok(g.badge.indexOf('you set') >= 0, `a corrected value is badged "you set" (${g.badge})`);

    // Copy: a double click still restores the label.
    await p.click('[data-action="reset-ov"]');
    await p.waitForTimeout(100);
    const btn = p.locator('.cmd button').first();
    await btn.click(); await btn.click();
    await p.waitForTimeout(1900);
    assert.equal(await btn.textContent(), 'Copy', 'copy button label restored after a double click');
    assert.ok(/^Copy command: /.test(await btn.getAttribute('aria-label')), 'copy buttons name their command');

    // A saved filter hidden in the other view falls back to All instead of an empty page.
    await p.click('[data-action="filter"][data-filter="video"]');
    await p.click('.seg [data-target="browser"]');
    const h = await p.evaluate(() => ({ pressed: Array.prototype.map.call(document.querySelectorAll('#r-chips [aria-pressed="true"]'), (e) => e.getAttribute('data-filter')).join(','),
      rows: document.querySelectorAll('.model').length, noTitle: document.getElementById('gh-no').textContent }));
    assert.ok(h.pressed === 'all' && h.rows > 0, `hidden saved filter shows All (${JSON.stringify(h)})`);
    assert.equal(h.noTitle, 'Not in this browser', 'browser view titles the won\'t-run group');
    await p.click('.seg [data-target="native"]');
    assert.equal(await p.evaluate(() => document.querySelector('#r-chips [aria-pressed="true"]').getAttribute('data-filter')), 'video', 'saved filter comes back in the installed-app view');
  } }, assert);

  // Storage that throws: corrections still apply (kept in memory).
  await runScenario(browser, pick('locked-down'), { after: async (p) => {
    await p.click('[data-action="ram"][data-gb="64"]');
    const s = await p.evaluate(() => ({ plate: document.getElementById('device-body').textContent, focus: document.activeElement.getAttribute('data-gb') }));
    assert.ok(/Memory \(RAM\)64 GByou set/.test(s.plate), 'RAM correction applies without localStorage');
    assert.equal(s.focus, '64', 'focus stays on the RAM chip that was clicked');
  } }, assert);

  // No Promise: the synchronous path still offers "Scan again".
  const old = await runScenario(browser, pick('old browser'));
  assert.ok(!old.rescanHidden, 'no-Promise path shows "Scan again"');

  // In this browser with WebGPU: WebLLM builds are named, the headline names a chat model.
  await runScenario(browser, WEBGPU_PC, { after: async (p) => {
    await p.click('.seg [data-target="browser"]');
    const s = await p.evaluate(() => ({ body: document.getElementById('results-body').textContent, headline: document.querySelector('.headline').textContent,
      chat: (document.querySelector('.pick .m') || {}).textContent }));
    assert.ok(s.body.indexOf('[object Object]') < 0 && /\(pick [\w.-]+-MLC/.test(s.body), 'WebLLM rows name the build to pick');
    assert.ok(s.headline.indexOf(s.chat) >= 0, `headline chat model matches the "Best for chat" pick (${s.headline} / ${s.chat})`);
    assert.ok(!/Florence/.test(s.headline + s.chat), 'captioning-only models are not called chat models');
  } }, assert);
}
