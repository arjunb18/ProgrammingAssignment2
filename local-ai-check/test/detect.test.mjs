// Device detection (src/detect.js) against user-agent strings, renderer strings and fake browser
// APIs taken from real browsers. Loads the scripts into a vm with a scriptable navigator/document.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

// o: { ua, deviceMemory, maxTouchPoints, hints, platform, mobile, renderer, vendor, glRenderer,
//      noDebugExt, extensions (array | null = getSupportedExtensions missing), webgpu: { info }, bench }
function makeLAC(o = {}) {
  const nav = { userAgent: o.ua || '', maxTouchPoints: o.maxTouchPoints || 0, hardwareConcurrency: o.hc || 8 };
  if (o.deviceMemory !== undefined) nav.deviceMemory = o.deviceMemory;
  if (o.hints) nav.userAgentData = { mobile: !!o.mobile, platform: o.platform || '', getHighEntropyValues: () => Promise.resolve(o.hints) };
  if (o.webgpu) {
    nav.gpu = { requestAdapter: () => Promise.resolve({
      info: Object.assign({ vendor: '', architecture: '', device: '', description: '' }, o.webgpu.info || {}),
      limits: { maxBufferSize: 2 ** 31, maxStorageBufferBindingSize: 2 ** 31 }, features: { has: (f) => f === 'shader-f16' },
    }) };
  }
  const gl = {
    MAX_TEXTURE_SIZE: 1, RENDERER: 2, VENDOR: 3,
    getParameter: (p) => (p === 1 ? 16384 : p === 0x9246 ? (o.renderer || '') : p === 0x9245 ? (o.vendor || '')
      : p === 2 ? (o.glRenderer || 'WebKit WebGL') : p === 3 ? 'WebKit' : null),
    getExtension: (n) => (n === 'WEBGL_debug_renderer_info' ? (o.noDebugExt ? null : { UNMASKED_RENDERER_WEBGL: 0x9246, UNMASKED_VENDOR_WEBGL: 0x9245 }) : null),
  };
  if (o.extensions !== null) gl.getSupportedExtensions = () => o.extensions || [];
  const document = { createElement: () => ({ getContext: () => gl }) };
  const store = {};
  const window = { localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } } };
  const ctx = vm.createContext({ window, navigator: nav, document, console, setTimeout, clearTimeout, Promise, Math, JSON, Date, Uint8Array, WebAssembly });
  for (const f of ['util.js', 'data/gpus.js', 'detect.js']) vm.runInContext(readFileSync(join(src, f), 'utf8'), ctx, { filename: f });
  const L = window.LAC;
  L.bench = { cpu: () => Promise.resolve({ score: 1, memBandwidthGBs: 20, ms: 1 }), gpu: () => Promise.resolve(o.bench || null) };
  return L;
}
const run = async (o) => { const L = makeLAC(o); return { L, d: await L.detect(() => {}) }; };
const clone = (x) => JSON.parse(JSON.stringify(x));

const UA = {
  chromeWin147: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
  chromeWin146: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
  chromeLinux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36',
  ffWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0',
  ffMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:143.0) Gecko/20100101 Firefox/143.0',
  ffLinux: 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0',
  ffAndroid: 'Mozilla/5.0 (Android 16; Mobile; rv:143.0) Gecko/143.0 Firefox/143.0',
  safariMac18: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
  safariMac26: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  kaios: 'Mozilla/5.0 (Mobile; Nokia_8110_4G; rv:48.0) Gecko/48.0 Firefox/48.0 KAIOS/2.5',
  harmony: 'Mozilla/5.0 (Phone; OpenHarmony 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36 ArkWeb/4.1.6.1 Mobile',
};

// [ua, maxTouchPoints, 'os formFactor', browser, osVersion]
const UA_CORPUS = [
  [UA.chromeWin147, 0, 'windows desktop', 'Chrome', '10 or 11'],
  [UA.chromeWin147 + ' Edg/147.0.0.0', 0, 'windows desktop', 'Edge', '10 or 11'],
  [UA.ffWin, 0, 'windows desktop', 'Firefox', '10 or 11'],
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36 OPR/131.0.0.0', 0, 'windows desktop', 'Opera', '10 or 11'],
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 YaBrowser/26.3.0.0 Safari/537.36', 0, 'windows desktop', 'Yandex Browser', '10 or 11'],
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36 Vivaldi/7.6', 0, 'windows desktop', 'Vivaldi', '10 or 11'],
  ['Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36', 0, 'windows desktop', 'Chrome', '6.1'],
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edge/18.19045', 0, 'windows desktop', 'Edge', '10 or 11'],
  ['Mozilla/5.0 (Windows NT 10.0; ARM64; rv:143.0) Gecko/20100101 Firefox/143.0', 0, 'windows desktop', 'Firefox', '10 or 11'],
  ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36', 0, 'mac desktop', 'Chrome', ''],
  [UA.safariMac26, 0, 'mac desktop', 'Safari', ''],
  [UA.ffMac, 0, 'mac desktop', 'Firefox', ''],
  [UA.safariMac26, 5, 'ipados tablet', 'Safari', ''], // iPadOS 13+ desktop-class UA, told apart by touch points
  [UA.chromeLinux, 0, 'linux desktop', 'Chrome', ''],
  [UA.ffLinux, 0, 'linux desktop', 'Firefox', ''],
  ['Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36', 0, 'chromeos desktop', 'Chrome', ''],
  [UA.chromeAndroid, 5, 'android phone', 'Chrome', ''], // reduced UA: "Android 10; K" is frozen, not the real version
  ['Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36', 5, 'android tablet', 'Chrome', ''],
  ['Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/29.0 Chrome/136.0.0.0 Mobile Safari/537.36', 5, 'android phone', 'Samsung Internet', ''],
  [UA.ffAndroid, 5, 'android phone', 'Firefox', '16'],
  ['Mozilla/5.0 (Android 15; Tablet; rv:143.0) Gecko/143.0 Firefox/143.0', 5, 'android tablet', 'Firefox', '15'],
  ['Mozilla/5.0 (Linux; Android 14; SM-X916B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36', 5, 'android tablet', 'Chrome', '14'],
  ['Mozilla/5.0 (Linux; Android 14; SM-S928B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/450.0.0.0;]', 5, 'android phone', 'Facebook in-app browser', '14'],
  ['Mozilla/5.0 (Linux; U; Android 4.0.3; ko-kr; LG-L160L Build/IML74K) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30', 5, 'android phone', 'Safari', '4.0'],
  [UA.safariIphone, 5, 'ios phone', 'Safari', '26.0'],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.7339.101 Mobile/15E148 Safari/604.1', 5, 'ios phone', 'Chrome', '18.6'],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/143.0 Mobile/15E148 Safari/605.1.15', 5, 'ios phone', 'Firefox', '18.6'],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/140.0.3485.94 Version/18.0 Mobile/15E148 Safari/604.1', 5, 'ios phone', 'Edge', '18.6'],
  // iOS in-app web views have no "Version/… Safari" token.
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0.0.0 (iPhone12,1; iOS 16_6; en_US; en; scale=2.00; 828x1792; 123456789)', 5, 'ios phone', 'Instagram in-app browser', '16.6'],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22G86 [FBAN/FBIOS;FBAV/500.0.0.0;FBBV/1;FBDV/iPhone16,2;FBMD/iPhone;FBSN/iOS;FBSV/18.6]', 5, 'ios phone', 'Facebook in-app browser', '18.6'],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/380.0.123456 Mobile/15E148 Safari/604.1', 5, 'ios phone', 'Google app', '18.6'],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 SomeApp/1.2', 5, 'ios phone', 'In-app browser (Safari engine)', '18.6'],
  ['Mozilla/5.0 (iPad; CPU OS 12_5_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1', 5, 'ipados tablet', 'Safari', '12.5'],
  // Phones outside Android/iOS.
  [UA.kaios, 5, 'kaios phone', 'KaiOS browser', '2.5'],
  ['Mozilla/5.0 (Mobile; LYF/F300B/LYF-F300B-001-01-15-130718-i; Android; rv:48.0) Gecko/48.0 Firefox/48.0 KAIOS/2.5', 5, 'kaios phone', 'KaiOS browser', '2.5'],
  [UA.harmony, 5, 'harmonyos phone', 'ArkWeb', '5.0'],
  ['Mozilla/5.0 (Phone; OpenHarmony 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36 ArkWeb/4.1.6.1 Mobile HuaweiBrowser/5.0.4.300', 5, 'harmonyos phone', 'Huawei Browser', '5.0'],
  ['Mozilla/5.0 (Tablet; OpenHarmony 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36 ArkWeb/4.1.6.1', 5, 'harmonyos tablet', 'ArkWeb', '5.0'],
  ['Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/38.0.0.0 SamsungBrowser/4.0 Chrome/132.0.0.0 VR Safari/537.36', 0, 'linux desktop', 'Samsung Internet', ''],
  ['Mozilla/5.0 (SMART-TV; LINUX; Tizen 8.0) AppleWebKit/537.36 (KHTML, like Gecko) Version/8.0 TV Safari/537.36', 0, 'linux desktop', 'Safari', ''],
];

const RENDER = {
  ffNvidia: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 980 Direct3D11 vs_5_0 ps_5_0), or similar',
  ffAmd: 'ANGLE (AMD, Radeon R9 200 Series Direct3D11 vs_5_0 ps_5_0), or similar',
  ffIntel: 'ANGLE (Intel, Intel(R) HD Graphics 400 Direct3D11 vs_5_0 ps_5_0), or similar',
  irisXe: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)',
  apu780: 'ANGLE (AMD, AMD Radeon(TM) Graphics (0x000015BF) Direct3D11 vs_5_0 ps_5_0, D3D11)',
};

export default async function test(assert) {
  // ---------------------------------------------------------------- parseUA
  for (const [ua, tp, osff, browser, osv] of UA_CORPUS) {
    const r = makeLAC({ ua, maxTouchPoints: tp }).detectInternals.parseUA();
    assert.equal(`${r.os} ${r.formFactor}`, osff, `parseUA os/formFactor: ${ua.slice(0, 90)}`);
    assert.equal(r.browser, browser, `parseUA browser: ${ua.slice(0, 90)}`);
    assert.equal(r.osVersion, osv, `parseUA osVersion: ${ua.slice(0, 90)}`);
  }
  {
    const r = makeLAC({ ua: UA.safariIphone }).detectInternals.parseUA();
    assert.equal(r.engine, 'webkit', 'iOS is always WebKit');
    const i = makeLAC({ ua: UA_CORPUS[28][0] }).detectInternals;
    assert.equal(i.osName({ os: 'kaios', osVersion: '2.5' }), 'KaiOS 2.5', 'KaiOS has a display name');
    assert.equal(i.osName({ os: 'harmonyos', osVersion: '' }), 'HarmonyOS', 'HarmonyOS has a display name');
  }

  // ---------------------------------------------------------------- client hints
  {
    const I = makeLAC({}).detectInternals;
    // Chrome in desktop mode on an Android tablet (and Samsung DeX): desktop Linux UA + Tablet + arm.
    let ua = I.parseUA.call(null); ua = Object.assign(ua, { raw: UA.chromeLinux, os: 'linux', formFactor: 'desktop' });
    I.applyHints(ua, { architecture: 'arm', formFactors: ['Tablet'], platformVersion: '15.0.0' }, { mobile: false, platform: '' });
    assert.equal(`${ua.os} ${ua.formFactor} ${ua.osVersion}`, 'android tablet 15', 'desktop-mode Android tablet becomes an Android tablet');
    ua = { raw: UA.chromeLinux, os: 'linux', formFactor: 'desktop', osVersion: '' };
    I.applyHints(ua, { architecture: 'arm', formFactors: ['Desktop'] }, { mobile: false, platform: 'Linux' });
    assert.equal(`${ua.os} ${ua.formFactor}`, 'linux desktop', 'an ARM Linux desktop stays a desktop');
    ua = { raw: UA.chromeLinux, os: 'linux', formFactor: 'desktop', osVersion: '' };
    I.applyHints(ua, { architecture: 'x86', formFactors: ['Desktop'] }, { mobile: false, platform: 'Android' });
    assert.equal(ua.os, 'android', 'userAgentData.platform "Android" wins over a desktop UA');
    ua = { raw: UA.chromeAndroid, os: 'android', formFactor: 'phone', osVersion: '' };
    I.applyHints(ua, { platformVersion: '16.0.0', model: 'Pixel 10 Pro', formFactors: ['Mobile'] }, { mobile: true });
    assert.equal(`${ua.osVersion} ${ua.model}`, '16 Pixel 10 Pro', 'Android version and model come from client hints');
    ua = { raw: UA.chromeWin147, os: 'windows', formFactor: 'desktop', osVersion: '10 or 11' };
    I.applyHints(ua, { platformVersion: '15.0.0', formFactors: ['Desktop', 'Tablet'] }, { mobile: false });
    assert.equal(`${ua.os} ${ua.formFactor} ${ua.osVersion}`, 'windows desktop 11', 'a Windows 2-in-1 stays a computer; Win11 from platformVersion');
  }
  {
    // End to end: the Android cap applies after the desktop-mode correction.
    const { d } = await run({ ua: UA.chromeLinux, deviceMemory: 8, hints: { architecture: 'arm', formFactors: ['Tablet'], platformVersion: '15.0.0' }, renderer: 'ANGLE (Qualcomm, Adreno (TM) 750, OpenGL ES 3.2)' });
    assert.equal(`${d.ua.os} ${d.ua.formFactor}`, 'android tablet', 'desktop-mode tablet detected in detect()');
    assert.ok(d.memory.capped && d.memory.confidence !== 'high', 'desktop-mode tablet: 8 GB is a capped Android value');
  }

  // ---------------------------------------------------------------- readMemory
  {
    const I = makeLAC({}).detectInternals;
    const mem = (ua, dm) => { const L = makeLAC({ ua, deviceMemory: dm }); const u = L.detectInternals.parseUA(); return L.detectInternals.readMemory(u); };
    let m = mem(UA.chromeWin146, 8);
    assert.ok(m.capped && m.estimatedGB === 16 && m.confidence === 'low', 'Chrome <147 desktop: 8 means "8 or more", assume 16');
    m = mem(UA.chromeWin147, 8);
    assert.ok(!m.capped && m.estimatedGB === 8 && m.confidence === 'high', 'Chrome 147 desktop: 8 is exact');
    m = mem(UA.chromeWin147, 32);
    assert.ok(m.capped && m.estimatedGB === 32 && m.confidence === 'medium', 'Chrome 147 desktop: 32 is the cap');
    m = mem(UA.chromeWin146, 16);
    assert.ok(!m.capped && m.estimatedGB === 16, 'a value above 8 proves the 32 GB cap');
    m = mem(UA.chromeAndroid, 8);
    assert.ok(m.capped && m.estimatedGB === 8 && m.confidence === 'medium', 'Android stays capped at 8');
    m = mem(UA.chromeAndroid, 4);
    assert.ok(m.estimatedGB === 6 && m.confidence === 'medium', 'Android 4 GB bucket covers 4-6 GB phones');
    m = mem(UA.harmony, 8);
    assert.ok(m.capped && m.estimatedGB === 8, 'HarmonyOS phone: 8 is a phone cap, not a desktop one (was 16)');
    for (const [ua, want] of [[UA.safariIphone, 6], [UA.kaios, 0.5], [UA.harmony, 8], [UA.ffWin, 16], [UA.ffAndroid, 8], ['Mozilla/5.0 (Mobile; rv:1.0) Something', 4]]) {
      m = mem(ua, undefined);
      assert.ok(m.source === 'default' && m.estimatedGB === want, `default RAM for ${ua.slice(0, 50)} is ${want} (got ${m.estimatedGB})`);
    }
    assert.equal(I.platformGuessGB({ os: 'other', formFactor: 'desktop' }), 8, 'unknown desktop OS default');
  }
  {
    const { d } = await run({ ua: UA.kaios });
    assert.ok(d.ua.formFactor === 'phone' && d.memory.estimatedGB <= 1, 'KaiOS feature phone is a phone with under 1 GB');
    const h = await run({ ua: UA.harmony, deviceMemory: 8, renderer: 'ANGLE (Huawei, Maleoon 910, OpenGL ES 3.2)' });
    assert.ok(h.d.ua.formFactor === 'phone' && h.d.memory.estimatedGB === 8, 'HarmonyOS NEXT phone keeps 8 GB (not 16)');
  }

  // ---------------------------------------------------------------- identifyGpu: Firefox buckets
  {
    const cases = [
      [UA.ffWin, RENDER.ffNvidia, 'nvidia', 'discrete-desktop'],
      [UA.ffLinux, 'GeForce GTX 980, or similar', 'nvidia', 'discrete-desktop'],
      [UA.ffWin, RENDER.ffAmd, 'amd', 'discrete-desktop'],
      [UA.ffMac, 'Radeon R9 200 Series, or similar', 'amd', 'discrete-desktop'],
      [UA.ffWin, RENDER.ffIntel, 'intel', 'integrated'],
      [UA.ffLinux, 'Intel(R) HD Graphics, or similar', 'intel', 'integrated'],
      [UA.ffMac, 'Intel(R) HD Graphics, or similar', 'intel', 'integrated'],
      [UA.ffMac, 'Apple M1, or similar', 'apple', 'apple-silicon'],
    ];
    for (const [ua, renderer, vendor, kind] of cases) {
      const { d } = await run({ ua, renderer });
      const e = d.gpu.entry;
      assert.ok(e && e.vendor === vendor && e.kind === kind && e.generic, `Firefox bucket "${renderer}" → ${vendor} ${kind} class (got ${e && e.name})`);
      assert.equal(d.gpu.confidence, 'low', `Firefox bucket "${renderer}" is a low-confidence guess`);
      if (vendor !== 'apple') {
        assert.equal(d.memory.estimatedGB, 16, `Firefox bucket "${renderer}" keeps the 16 GB desktop default`);
        assert.equal(d.cpu.arch, 'x86', `Firefox bucket "${renderer}" on ${d.ua.os} is x86`);
      } else {
        assert.equal(d.memory.source, 'device-lookup', 'Firefox Apple bucket on a Mac uses the Apple-silicon default');
      }
      assert.ok(d.notes.some((n) => /Firefox only reveals/.test(n)), `Firefox bucket "${renderer}" explains itself`);
      assert.ok(!/ANGLE|or similar/.test(d.gpu.name), `display name is clean: ${d.gpu.name}`);
    }
    const a = await run({ ua: UA.ffAndroid, renderer: 'Adreno (TM) 640, or similar' });
    assert.ok(a.d.gpu.entry && a.d.gpu.confidence === 'low', 'Firefox Adreno bucket → Adreno family, low confidence');
    assert.equal(a.d.memory.estimatedGB, 8, 'Firefox Android keeps the 8 GB default (not the bucket\'s 4 GB)');
    const i = await run({ ua: UA.ffWin, renderer: RENDER.ffIntel });
    assert.ok(i.d.gpu.entry.bandwidthGBs >= 45, 'Firefox Intel bucket is not modelled as a 2015 HD Graphics chip');
    // With Firefox WebGPU the benchmark refines the class, and it never becomes "integrated".
    const b = await run({ ua: UA.ffWin, renderer: RENDER.ffNvidia, webgpu: { info: {} }, bench: { gbs: 400, gflops: 20000 } });
    assert.ok(b.d.gpu.entry.kind === 'discrete-desktop' && b.d.gpu.entry.vramGB > 0, 'measured NVIDIA bucket stays a discrete card');
    assert.equal(b.d.gpu.entry.bandwidthGBs, Math.round(400 / 0.75), 'measured bandwidth replaces the placeholder');
  }

  // ---------------------------------------------------------------- identifyGpu: Safari on Macs
  {
    const ASTC = ['WEBGL_compressed_texture_astc', 'WEBGL_compressed_texture_etc'];
    const S3TC = ['WEBGL_compressed_texture_s3tc', 'WEBGL_compressed_texture_s3tc_srgb'];
    let r = await run({ ua: UA.safariMac18, renderer: 'Apple GPU', vendor: 'Apple Inc.', extensions: ASTC });
    assert.ok(r.d.gpu.entry && r.d.gpu.entry.kind === 'apple-silicon' && r.d.cpu.arch === 'arm', 'Safari 18, Apple silicon (ASTC) → Apple silicon Mac');
    r = await run({ ua: UA.safariMac18, renderer: 'Apple GPU', vendor: 'Apple Inc.', extensions: S3TC });
    assert.ok(r.d.gpu.entry && r.d.gpu.entry.vendor === 'intel' && r.d.gpu.entry.kind === 'integrated', 'Safari 18, Intel Mac (no ASTC) → Intel Mac graphics');
    assert.equal(r.d.cpu.arch, 'x86', 'Safari 18 Intel Mac is x86');
    r = await run({ ua: UA.safariMac18, renderer: 'Apple GPU', vendor: 'Apple Inc.', extensions: null });
    assert.ok(!r.d.gpu.entry && r.d.cpu.arch !== 'arm', 'Safari 18, extensions unreadable → unknown, not Apple silicon');
    r = await run({ ua: UA.safariMac26, renderer: 'Apple GPU', webgpu: { info: { vendor: 'intelr' } }, extensions: ASTC });
    assert.ok(r.d.gpu.entry && r.d.gpu.entry.vendor === 'intel', 'Safari 26 WebGPU vendor "intelr" → Intel Mac');
    r = await run({ ua: UA.safariMac26, renderer: 'Apple GPU', webgpu: { info: { vendor: 'apple' } }, extensions: [] });
    assert.ok(r.d.gpu.entry && r.d.gpu.entry.kind === 'apple-silicon', 'Safari 26 WebGPU vendor "apple" → Apple silicon');
    r = await run({ ua: UA.safariMac26, renderer: 'Apple GPU', webgpu: { info: { vendor: 'apple' } }, bench: { gbs: 350, gflops: 9000 } });
    assert.ok(/Max-class/.test(r.d.gpu.name), 'Apple silicon benchmark picks the chip tier');
  }

  // ---------------------------------------------------------------- identifyGpu: hybrid laptops
  {
    const hints = { architecture: 'x86', platformVersion: '15.0.0' };
    let r = await run({ ua: UA.chromeWin147, deviceMemory: 16, hints, renderer: RENDER.irisXe, webgpu: { info: { vendor: 'nvidia', architecture: 'lovelace' } }, bench: { gbs: 230, gflops: 15000 } });
    assert.ok(r.d.gpu.hybrid, 'Iris Xe in WebGL + NVIDIA WebGPU adapter is a hybrid laptop');
    assert.ok(r.d.gpu.entry.vendor === 'nvidia' && /^discrete/.test(r.d.gpu.entry.kind) && r.d.gpu.entry.vramGB >= 4, 'fast benchmark → measured NVIDIA card');
    assert.ok(/40-series/.test(r.d.gpu.name), 'WebGPU architecture "lovelace" names the RTX 40 series');
    assert.equal(r.d.gpu.confidence, 'low', 'hybrid result asks the user to confirm');
    assert.ok(r.d.notes.some((n) => /two GPUs/.test(n)), 'hybrid note shown');
    r = await run({ ua: UA.chromeWin147, deviceMemory: 16, hints, renderer: RENDER.irisXe, webgpu: { info: { vendor: 'nvidia', architecture: 'ampere' } }, bench: { gbs: 60, gflops: 2000 } });
    assert.ok(r.d.gpu.hybrid && r.d.gpu.entry.name === 'Intel Iris Xe Graphics', 'slow benchmark (it ran on the iGPU) keeps the iGPU, flagged');
    r = await run({ ua: UA.chromeWin147, deviceMemory: 16, hints, renderer: RENDER.irisXe, webgpu: { info: { vendor: 'intel', architecture: 'gen-12lp' } } });
    assert.ok(!r.d.gpu.hybrid && r.d.gpu.confidence === 'high', 'Intel on both APIs is not hybrid');
    r = await run({ ua: UA.chromeWin147, deviceMemory: 16, hints, renderer: RENDER.apu780, webgpu: { info: { vendor: 'amd', architecture: 'rdna-3' } } });
    assert.ok(!r.d.gpu.hybrid && /780M/.test(r.d.gpu.name), 'AMD APU with AMD adapter is not hybrid');
    r = await run({ ua: UA.chromeWin147, deviceMemory: 16, hints, renderer: RENDER.apu780, webgpu: { info: { vendor: 'nvidia', architecture: 'ada' } } });
    assert.ok(r.d.gpu.hybrid, 'Radeon 780M + NVIDIA adapter is hybrid');
    r = await run({ ua: UA.chromeWin147, deviceMemory: 16, hints, renderer: '', webgpu: { info: { vendor: 'nvidia', architecture: 'lovelace' } } });
    assert.ok(r.d.gpu.entry && r.d.gpu.entry.vendor === 'nvidia' && r.d.gpu.confidence === 'low', 'WebGL blocked + NVIDIA adapter → NVIDIA class');
  }

  // ---------------------------------------------------------------- misc renderer handling
  {
    const I = makeLAC({}).detectInternals;
    const C = [
      ['ANGLE (VMware, Inc., SVGA3D; build: RELEASE; LLVM;, OpenGL 4.1)', /^SVGA3D/],
      ['ANGLE (Samsung Electronics Co., Ltd., Samsung Xclipse 999, OpenGL ES 3.2)', /^Samsung Xclipse 999$/],
      ['ANGLE (Samsung Electronics Co., Ltd., ANGLE Vulkan 1.3 (Samsung Xclipse 999 (0x...)), Samsung)', /^Samsung Xclipse 999$/],
      [RENDER.ffNvidia, /^NVIDIA GeForce GTX 980$/],
      ['ANGLE (Apple, ANGLE Metal Renderer: Apple M9 Pro, Unspecified Version)', /^Apple M9 Pro$/],
      ['ANGLE (NVIDIA, NVIDIA GeForce GTX 760 (0x00001187) Direct3D11 vs_5_0 ps_5_0, D3D11)', /^NVIDIA GeForce GTX 760$/],
      ['Mozilla', /^$/],
      ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', /^SwiftShader Device \(Subzero\)$/],
    ];
    for (const [s, re] of C) {
      const got = I.cleanRenderer(s);
      assert.ok(re.test(got) && !/^(Inc|Ltd)\.?$/.test(got), `cleanRenderer("${s}") → "${got}"`);
    }
    const { d } = await run({ ua: UA.chromeWin147, deviceMemory: 16, renderer: 'ANGLE (VMware, Inc., SVGA3D; build: RELEASE; LLVM;, OpenGL 4.1)' });
    assert.ok(d.gpu.virtual && d.notes.some((n) => /virtual/.test(n)), 'VMware SVGA3D is flagged as a virtual GPU');
    const w = await run({ ua: UA.chromeWin147, deviceMemory: 32, renderer: 'ANGLE (NVIDIA, NVIDIA RTX 5000 Ada Generation Laptop GPU (0x000027BA) Direct3D11 vs_5_0 ps_5_0, D3D11)' });
    assert.ok(w.d.gpu.entry.kind === 'discrete-laptop' && w.d.gpu.entry.vramGB === 16, 'RTX 5000 Ada Laptop has 16 GB, not the desktop 32');
    const g = await run({ ua: UA.chromeWin147, deviceMemory: 8, renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 780M Direct3D11 vs_5_0 ps_5_0, D3D11)' });
    assert.ok(!g.d.gpu.entry || g.d.gpu.entry.vendor === 'nvidia', 'GeForce GTX 780M is never the Radeon 780M');
  }

  // ---------------------------------------------------------------- refineMemory
  {
    const L = makeLAC({});
    const I = L.detectInternals;
    const def = (gb) => ({ reportedGB: null, estimatedGB: gb, source: 'default', capped: false, confidence: 'low' });
    const gpu = (renderer, entry, extra) => Object.assign({ renderer, entry, confidence: 'high', bucketed: false }, extra || {});
    let m = def(16);
    I.refineMemory(m, gpu('ANGLE (Intel, Intel(R) Arc(TM) 140V GPU (16GB) (0x000064A0) Direct3D11 vs_5_0 ps_5_0, D3D11)', L.matchGpu('arc 140v')), {});
    assert.ok(m.estimatedGB === 16 && m.confidence === 'high' && m.source === 'device-lookup', 'Lunar Lake renderer names the RAM');
    m = def(6);
    I.refineMemory(m, gpu('Apple GPU', L.matchGpu('generic iphone'), { confidence: 'low' }), {});
    assert.ok(m.estimatedGB === 6 && m.source === 'device-lookup', 'generic iPhone uses its curated default');
    m = def(16);
    I.refineMemory(m, gpu(RENDER.ffIntel, L.matchGpu(RENDER.ffIntel), { confidence: 'low', bucketed: true }), {});
    assert.ok(m.estimatedGB === 16 && m.source === 'default', 'a Firefox bucket never sets RAM (was 4 GB)');
    m = def(8);
    I.refineMemory(m, gpu('Adreno (TM) 640, or similar', L.matchGpu('Adreno (TM) 640, or similar'), { confidence: 'medium', bucketed: true }), {});
    assert.equal(m.estimatedGB, 8, 'Firefox Adreno bucket keeps the Android default');
    m = def(16);
    I.refineMemory(m, gpu('x', L.matchGpu('apple m3 pro'), { confidence: 'medium' }), {});
    assert.equal(m.source, 'default', 'a non-generic entry below high confidence does not set RAM');
    m = { reportedGB: 8, estimatedGB: 8, source: 'deviceMemory', capped: false, confidence: 'high' };
    I.refineMemory(m, gpu('x', L.matchGpu('apple m3 pro')), {});
    assert.equal(m.source, 'deviceMemory', 'a reported value is never replaced by a lookup');
  }

  // ---------------------------------------------------------------- applyOverrides
  {
    const byName = (L, re) => L.GPUS.find((g) => re.test(g.name)).name;
    let { L, d } = await run({ ua: UA.safariIphone, maxTouchPoints: 5, renderer: 'Apple GPU' });
    assert.ok(d.memory.estimatedGB === 6 && d.memory.source === 'device-lookup', 'iPhone before override: 6 GB guess');
    let d2 = L.applyOverrides(clone(d), { gpuName: byName(L, /^Apple A19 Pro/) });
    assert.ok(d2.memory.estimatedGB === 12 && d2.gpu.confidence === 'high', 'overriding to A19 Pro realigns RAM to 12 GB');
    d2 = L.applyOverrides(clone(d), { gpuName: byName(L, /^Apple A19 Pro/), ramGB: 8 });
    assert.ok(d2.memory.estimatedGB === 8 && d2.memory.source === 'user', 'a RAM override wins over the chip default');

    ({ L, d } = await run({ ua: UA.safariMac26, renderer: 'Apple GPU', webgpu: { info: { vendor: 'apple' } } }));
    assert.equal(d.memory.estimatedGB, 16, 'Mac before override: 16 GB guess');
    d2 = L.applyOverrides(clone(d), { gpuName: byName(L, /^Apple M4 Max/) });
    assert.ok(d2.memory.estimatedGB >= 36, `overriding to M4 Max realigns RAM (got ${d2.memory.estimatedGB})`);
    d2 = L.applyOverrides(clone(d), { gpuName: byName(L, /^NVIDIA GeForce RTX 4070$/) });
    assert.ok(d2.memory.estimatedGB === 16 && d2.memory.source === 'default', 'a chip without RAM options resets a chip-derived guess to the platform default');
    assert.equal(d2.cpu.arch, 'x86', 'picking a non-Apple GPU on a Mac means an Intel Mac');

    ({ L, d } = await run({ ua: UA.chromeWin147, deviceMemory: 32, renderer: 'ANGLE (Intel, Intel(R) Arc(TM) 140V GPU (16GB) (0x000064A0) Direct3D11 vs_5_0 ps_5_0, D3D11)' }));
    d2 = L.applyOverrides(clone(d), { gpuName: byName(L, /^Apple M4 Max/) });
    assert.equal(d2.memory.estimatedGB, 16, 'RAM read from the renderer name (high confidence) is kept on a GPU override');
    ({ L, d } = await run({ ua: UA.chromeWin147, deviceMemory: 16, renderer: RENDER.irisXe }));
    d2 = L.applyOverrides(clone(d), { gpuName: byName(L, /^Apple M4 Max/) });
    assert.equal(d2.memory.estimatedGB, 16, 'deviceMemory is kept on a GPU override');

    ({ L, d } = await run({ ua: UA.chromeWin147, deviceMemory: 16, hints: { architecture: 'x86' }, renderer: RENDER.irisXe, webgpu: { info: { vendor: 'nvidia' } } }));
    d2 = L.applyOverrides(clone(d), { gpuName: byName(L, /^NVIDIA GeForce RTX 4070 Laptop$/) });
    assert.ok(!d2.gpu.hybrid && !d2.notes.some((n) => /two GPUs/.test(n)), 'picking the card clears the hybrid warning');
  }
}
