/*
 * Device detection. Every probe is optional: it is feature-checked, wrapped in try/catch and
 * (when async) given a timeout, so an old or locked-down browser still gets a result.
 * ES5 only.
 */
(function (LAC) {
  'use strict';

  var U = LAC.util;

  function nav() { return typeof navigator !== 'undefined' ? navigator : {}; }
  function has(obj, key) { try { return !!obj && key in obj; } catch (e) { return false; } }

  // ---------------------------------------------------------------- user agent

  function parseUA() {
    var n = nav();
    var ua = String(n.userAgent || '');
    var r = { raw: ua, browser: 'Unknown browser', browserVersion: '', engine: 'other', os: 'other', osVersion: '', formFactor: 'desktop', model: '' };
    var m;
    var touch = typeof n.maxTouchPoints === 'number' ? n.maxTouchPoints : 0;

    // KaiOS first: some KaiOS builds also say "Android". HarmonyOS 2-4 phones say "Android" and run
    // Android apps, so they stay 'android'; HarmonyOS NEXT (OpenHarmony/ArkWeb) has no Android token.
    if (/KAIOS/i.test(ua)) { r.os = 'kaios'; }
    else if (/iPhone|iPod/.test(ua)) { r.os = 'ios'; }
    else if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touch > 1)) { r.os = 'ipados'; }
    else if (/Android/.test(ua)) { r.os = 'android'; }
    else if (/OpenHarmony|HarmonyOS/i.test(ua)) { r.os = 'harmonyos'; }
    else if (/CrOS/.test(ua)) { r.os = 'chromeos'; }
    else if (/Windows/.test(ua)) { r.os = 'windows'; }
    else if (/Macintosh|Mac OS X/.test(ua)) { r.os = 'mac'; }
    else if (/Linux|X11/.test(ua)) { r.os = 'linux'; }

    if ((m = ua.match(/OS (\d+)[_.](\d+)/)) && (r.os === 'ios' || r.os === 'ipados')) { r.osVersion = m[1] + '.' + m[2]; }
    else if (r.os === 'android' && /Android 10; K\)/.test(ua)) { r.osVersion = ''; } // reduced UA: frozen at 10, real version comes from client hints
    else if ((m = ua.match(/Android (\d+(?:\.\d+)?)/))) { r.osVersion = m[1]; }
    else if ((m = ua.match(/Windows NT (\d+\.\d+)/))) { r.osVersion = m[1] === '10.0' ? '10 or 11' : m[1]; }
    else if ((m = ua.match(/(?:OpenHarmony|HarmonyOS)[ \/](\d+(?:\.\d+)?)/i))) { r.osVersion = m[1]; }
    else if ((m = ua.match(/KAIOS\/(\d+(?:\.\d+)?)/i))) { r.osVersion = m[1]; }

    if (r.os === 'ios') { r.formFactor = 'phone'; }
    else if (r.os === 'ipados') { r.formFactor = 'tablet'; }
    else if (r.os === 'android') { r.formFactor = /Mobile/.test(ua) ? 'phone' : 'tablet'; }
    else if (r.os === 'kaios') { r.formFactor = 'phone'; }
    else if (r.os !== 'windows' && r.os !== 'mac' && r.os !== 'chromeos') {
      // Any other OS that calls itself a phone or tablet (HarmonyOS NEXT, Linux phones…).
      if (/\(Tablet;|\bTablet\b/.test(ua)) { r.formFactor = 'tablet'; }
      else if (/\bMobile\b|\(Phone;|\bPhone\b/.test(ua)) { r.formFactor = 'phone'; }
    }

    if (r.os === 'android' && (m = ua.match(/Android [^;)]*;\s*(?:[a-z]{2}[-_][a-z]{2};\s*)?([^;)]+?)(?:\s+Build\/|\))/i))) {
      var model = m[1].replace(/^\s+|\s+$/g, '');
      if (model && model !== 'K' && !/^(Linux|U|wv)$/i.test(model)) { r.model = model; }
    }

    var browsers = [
      // In-app browsers of social apps come first: their UAs also carry Chrome/ or Safari tokens.
      [/Instagram (\d+)/, 'Instagram in-app browser'], [/FBAV\/(\d+)/, 'Facebook in-app browser'],
      [/musical_ly_(\d+)|BytedanceWebview\/(\d+)/, 'TikTok in-app browser'], [/GSA\/(\d+)/, 'Google app'],
      [/KAIOS\/(\d+(?:\.\d+)?)/i, 'KaiOS browser'], [/HuaweiBrowser\/(\d+)/, 'Huawei Browser'], [/ArkWeb\/(\d+)/, 'ArkWeb'],
      [/EdgA?\/(\d+)/, 'Edge'], [/EdgiOS\/(\d+)/, 'Edge'], [/OPR\/(\d+)/, 'Opera'], [/SamsungBrowser\/(\d+)/, 'Samsung Internet'],
      [/FxiOS\/(\d+)/, 'Firefox'], [/Firefox\/(\d+)/, 'Firefox'], [/CriOS\/(\d+)/, 'Chrome'], [/YaBrowser\/(\d+)/, 'Yandex Browser'],
      [/Vivaldi\/(\d+)/, 'Vivaldi'], [/Chrome\/(\d+)/, 'Chrome'], [/Version\/(\d+(?:\.\d+)?).*Safari/, 'Safari']
    ];
    for (var i = 0; i < browsers.length; i++) {
      if ((m = ua.match(browsers[i][0]))) { r.browser = browsers[i][1]; r.browserVersion = m[1] || m[2] || ''; break; }
    }
    if (r.browser === 'Unknown browser' && (r.os === 'ios' || r.os === 'ipados')) {
      // Apps that embed a web view without Safari's "Version/…" token (every iOS browser is WebKit).
      r.browser = 'In-app browser (Safari engine)';
    }
    if (r.os === 'ios' || r.os === 'ipados') { r.engine = 'webkit'; }
    else if (/Firefox\//.test(ua)) { r.engine = 'gecko'; }
    else if (/Chrome\/|Chromium\//.test(ua)) { r.engine = 'blink'; }
    else if (/AppleWebKit\//.test(ua)) { r.engine = 'webkit'; }
    return r;
  }

  // Client hints (Chromium only) give architecture, Windows 11 vs 10, and Android model.
  function clientHints(ua) {
    var n = nav();
    if (!has(n, 'userAgentData') || !n.userAgentData || typeof n.userAgentData.getHighEntropyValues !== 'function') {
      return Promise.resolve(null);
    }
    var p;
    try {
      p = n.userAgentData.getHighEntropyValues(['architecture', 'bitness', 'model', 'platformVersion', 'formFactors']);
    } catch (e) { return Promise.resolve(null); }
    return U.withTimeout(p, 1000, null).then(function (h) {
      if (!h) { return null; }
      applyHints(ua, h, n.userAgentData);
      return h;
    }, function () { return null; });
  }

  // Runs before readMemory, so a corrected OS / form factor also picks the right RAM cap.
  function applyHints(ua, h, uad) {
    var platform = uad && uad.platform ? String(uad.platform) : '';
    var ff = h.formFactors && h.formFactors.length ? String(h.formFactors.join(',')).toLowerCase() : '';
    // Chrome on large Android tablets (and Samsung DeX) sends a desktop "X11; Linux x86_64" UA.
    // Real ARM Linux desktops report the 'Desktop' form factor, so they are not affected.
    if (ua.os === 'linux' && (platform === 'Android' ||
        (h.architecture === 'arm' && (ff.indexOf('tablet') >= 0 || ff.indexOf('mobile') >= 0)))) {
      ua.os = 'android';
      ua.formFactor = ff.indexOf('mobile') >= 0 && ff.indexOf('tablet') < 0 ? 'phone' : 'tablet';
    }
    if (uad && uad.mobile === true && ua.formFactor === 'desktop') { ua.formFactor = 'phone'; }
    if (h.model) { ua.model = h.model; }
    var major = h.platformVersion ? parseInt(String(h.platformVersion).split('.')[0], 10) : 0;
    if (ua.os === 'windows' && h.platformVersion) {
      ua.osVersion = major >= 13 ? '11' : (major > 0 ? '10' : ua.osVersion);
    }
    if (ua.os === 'mac' && h.platformVersion) { ua.osVersion = h.platformVersion; }
    if (ua.os === 'android' && major > 0) { ua.osVersion = String(major); }
    if (ua.os === 'android' && ff.indexOf('tablet') >= 0 && ff.indexOf('mobile') < 0) { ua.formFactor = 'tablet'; }
  }

  // ---------------------------------------------------------------- memory

  function chromiumMajor(ua) {
    var m = String(ua.raw || '').match(/(?:Chrome|CriOS|Chromium)\/(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  }

  // Chromium reports RAM as a power of two with a cap: 8 GB before Chrome 147; from 147 desktop
  // reports up to 32 GB while Android stays capped at 8 GB. The top bucket is a floor, not a value.
  function readMemory(ua) {
    var n = nav();
    var mem = { reportedGB: null, estimatedGB: 8, source: 'default', capped: false, confidence: 'low' };
    var dm = null;
    try { dm = typeof n.deviceMemory === 'number' ? n.deviceMemory : null; } catch (e) { dm = null; }
    var desktop = ua.formFactor === 'desktop';
    if (dm && dm > 0) {
      var major = chromiumMajor(ua);
      var cap = desktop && (major >= 147 || dm > 8) ? 32 : 8;
      mem.reportedGB = dm;
      mem.source = 'deviceMemory';
      mem.estimatedGB = dm;
      mem.capped = dm >= cap;
      mem.confidence = mem.capped ? 'medium' : 'high';
      if (mem.capped && cap === 8) {
        // "8" on an older desktop browser or any phone means "8 GB or more".
        mem.estimatedGB = desktop ? 16 : 8;
        mem.confidence = desktop ? 'low' : 'medium';
      }
      if (!desktop && dm === 4) { mem.estimatedGB = 6; mem.confidence = 'medium'; } // 4-6 GB phones report 4
    } else {
      // No API (Safari, Firefox): fall back to common configurations per platform.
      mem.estimatedGB = platformGuessGB(ua);
      mem.source = 'default';
      mem.confidence = 'low';
    }
    return mem;
  }

  // Common RAM per platform, used when the browser does not say. KaiOS phones have 256-512 MB.
  var RAM_GUESS = { ios: 6, ipados: 8, android: 8, harmonyos: 8, kaios: 0.5, mac: 16, windows: 16, linux: 16, chromeos: 8 };
  function platformGuessGB(ua) {
    return RAM_GUESS[ua.os] || (ua.formFactor === 'desktop' ? 8 : 4);
  }

  // ---------------------------------------------------------------- WebGL

  function readWebGL() {
    var out = { version: 0, maxTextureSize: null, renderer: '', vendor: '', masked: false };
    if (typeof document === 'undefined' || !document.createElement) { return out; }
    var canvas, gl = null;
    try {
      canvas = document.createElement('canvas');
      var names = ['webgl2', 'webgl', 'experimental-webgl'];
      for (var i = 0; i < names.length && !gl; i++) {
        try { gl = canvas.getContext(names[i], { failIfMajorPerformanceCaveat: false }); } catch (e) { gl = null; }
        if (gl) { out.version = names[i] === 'webgl2' ? 2 : 1; }
      }
      if (!gl) { return out; }
      out.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) || null;
      var dbg = null;
      try { dbg = gl.getExtension('WEBGL_debug_renderer_info'); } catch (e2) { dbg = null; }
      if (dbg) {
        out.renderer = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '');
        out.vendor = String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) || '');
      }
      if (!out.renderer) {
        // Firefox exposes a sanitised renderer here; other browsers return a generic "WebKit WebGL".
        out.renderer = String(gl.getParameter(gl.RENDERER) || '');
        out.vendor = out.vendor || String(gl.getParameter(gl.VENDOR) || '');
      }
      // Safari always says "Apple GPU"; Firefox rounds to a bucket ending in ", or similar".
      out.masked = /^(webkit webgl|mozilla|generic renderer|apple gpu)$/i.test(out.renderer);
      out.bucketed = /or similar/i.test(out.renderer);
      out.software = /swiftshader|llvmpipe|softpipe|basic render|software rasterizer/i.test(out.renderer);
      // Virtual machine GPUs (VMware, VirtualBox, QEMU/virgl, Parallels) forward to the host or to software.
      out.virtual = /svga3d|vmware|virtualbox|virgl|virtio|parallels/i.test(out.renderer);
      // Apple GPUs expose ASTC texture compression; the Intel/AMD GPUs of Intel Macs do not.
      // Safari before 26 says "Apple GPU" on both, so this is the only Apple-silicon signal there.
      out.astc = null;
      try {
        var exts = gl.getSupportedExtensions ? gl.getSupportedExtensions() : null;
        if (exts && exts.length !== undefined) { out.astc = String(exts.join(',')).indexOf('WEBGL_compressed_texture_astc') >= 0; }
      } catch (e4) { out.astc = null; }
      try {
        var lose = gl.getExtension('WEBGL_lose_context');
        if (lose) { lose.loseContext(); }
      } catch (e3) { /* ignore */ }
    } catch (err) { /* WebGL blocked or crashed */ }
    return out;
  }

  // ---------------------------------------------------------------- WebGPU

  function readWebGPU() {
    var n = nav();
    var out = { available: false, isFallback: false, shaderF16: false, maxBufferGB: null, maxStorageBindingGB: null,
      info: { vendor: '', architecture: '', device: '', description: '' }, benchGBs: null, benchGflops: null, error: null, adapter: null };
    if (!has(n, 'gpu') || !n.gpu || typeof n.gpu.requestAdapter !== 'function') {
      out.error = 'WebGPU is not supported by this browser.';
      return Promise.resolve(out);
    }
    var req;
    try { req = n.gpu.requestAdapter({ powerPreference: 'high-performance' }); }
    catch (e) { out.error = 'WebGPU request failed.'; return Promise.resolve(out); }
    return U.withTimeout(req, 2500, null).then(function (adapter) {
      if (!adapter) { out.error = 'WebGPU is present but no GPU adapter was offered (blocked, disabled or unsupported GPU).'; return out; }
      out.available = true;
      out.adapter = adapter;
      try {
        var lim = adapter.limits || {};
        if (lim.maxBufferSize) { out.maxBufferGB = lim.maxBufferSize / 1073741824; }
        if (lim.maxStorageBufferBindingSize) { out.maxStorageBindingGB = lim.maxStorageBufferBindingSize / 1073741824; }
      } catch (e1) { /* ignore */ }
      try { out.shaderF16 = !!(adapter.features && adapter.features.has && adapter.features.has('shader-f16')); } catch (e2) { /* ignore */ }
      try { out.isFallback = !!(adapter.isFallbackAdapter || (adapter.info && adapter.info.isFallbackAdapter)); } catch (e3) { /* ignore */ }
      var infoP;
      try {
        if (adapter.info) { infoP = Promise.resolve(adapter.info); }
        else if (typeof adapter.requestAdapterInfo === 'function') { infoP = U.withTimeout(adapter.requestAdapterInfo(), 800, null); }
        else { infoP = Promise.resolve(null); }
      } catch (e4) { infoP = Promise.resolve(null); }
      return infoP.then(function (info) {
        if (info) {
          out.info = {
            vendor: String(info.vendor || ''), architecture: String(info.architecture || ''),
            device: String(info.device || ''), description: String(info.description || '')
          };
        }
        return out;
      }, function () { return out; });
    }, function () { out.error = 'WebGPU adapter request failed.'; return out; });
  }

  // ---------------------------------------------------------------- WebAssembly

  var WASM_PROBES = {
    // Minimal modules from wasm-feature-detect: each validates only if the feature is supported.
    simd: [0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11],
    threads: [0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 5, 4, 1, 3, 1, 1, 10, 11, 1, 9, 0, 65, 0, 254, 16, 2, 0, 26, 11],
    memory64: [0, 97, 115, 109, 1, 0, 0, 0, 5, 3, 1, 4, 1],
    relaxedSimd: [0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 15, 1, 13, 0, 65, 1, 253, 15, 65, 2, 253, 15, 253, 128, 2, 11]
  };

  function readWasm() {
    var out = { supported: false, simd: false, threads: false, memory64: false, relaxedSimd: false, crossOriginIsolated: false };
    try { out.crossOriginIsolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated === true; } catch (e) { /* ignore */ }
    try {
      if (typeof WebAssembly !== 'object' || typeof WebAssembly.validate !== 'function' || typeof Uint8Array === 'undefined') { return out; }
      out.supported = WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
      if (!out.supported) { return out; }
      for (var k in WASM_PROBES) {
        if (Object.prototype.hasOwnProperty.call(WASM_PROBES, k)) {
          try { out[k] = WebAssembly.validate(new Uint8Array(WASM_PROBES[k])); } catch (e2) { out[k] = false; }
        }
      }
      out.threads = out.threads && typeof SharedArrayBuffer !== 'undefined';
    } catch (err) { /* ignore */ }
    return out;
  }

  // ---------------------------------------------------------------- storage, network, built-in AI

  function readStorage() {
    var n = nav();
    var out = { quotaGB: null, usageGB: null };
    if (!n.storage || typeof n.storage.estimate !== 'function') { return Promise.resolve(out); }
    var p;
    try { p = n.storage.estimate(); } catch (e) { return Promise.resolve(out); }
    return U.withTimeout(p, 1000, null).then(function (est) {
      if (est && typeof est.quota === 'number') {
        out.quotaGB = est.quota / 1e9;
        out.usageGB = typeof est.usage === 'number' ? est.usage / 1e9 : null;
      }
      return out;
    }, function () { return out; });
  }

  function readNetwork() {
    var c = nav().connection;
    return { saveData: !!(c && c.saveData), effectiveType: c && c.effectiveType ? String(c.effectiveType) : null };
  }

  // Chrome's built-in Gemini Nano (Prompt API). Reports 'available', 'downloadable', 'downloading' or 'unavailable'.
  function readBuiltInAI() {
    var g = typeof window !== 'undefined' ? window : {};
    var LM = g.LanguageModel || (g.ai && g.ai.languageModel);
    if (!LM || typeof LM.availability !== 'function') { return Promise.resolve(null); }
    var p;
    try { p = LM.availability(); } catch (e) { return Promise.resolve(null); }
    return U.withTimeout(p, 1500, null).then(function (a) { return a ? String(a) : null; }, function () { return null; });
  }

  // ---------------------------------------------------------------- GPU identification

  // Names for the WebGPU architecture field when the renderer string is hidden.
  var ARCH_HINTS = {
    'blackwell': 'NVIDIA GeForce RTX 50-series', 'ada': 'NVIDIA GeForce RTX 40-series', 'ada-lovelace': 'NVIDIA GeForce RTX 40-series',
    'lovelace': 'NVIDIA GeForce RTX 40-series', 'ampere': 'NVIDIA GeForce RTX 30-series', 'turing': 'NVIDIA GeForce RTX 20 / GTX 16-series',
    'pascal': 'NVIDIA GeForce GTX 10-series',
    'rdna-4': 'AMD Radeon RX 9000-series', 'rdna-3': 'AMD Radeon RX 7000-series or 780M/890M', 'rdna-2': 'AMD Radeon RX 6000-series or 680M',
    'rdna-1': 'AMD Radeon RX 5000-series', 'gcn-5': 'AMD Radeon Vega',
    'xe-3lpg': 'Intel Arc (Panther Lake)', 'xe-2lpg': 'Intel Arc 130V/140V (Lunar Lake)', 'xe-lpg': 'Intel Arc (Meteor Lake)',
    'gen-12lp': 'Intel Iris Xe / UHD', 'gen-11': 'Intel Iris Plus (Ice Lake)', 'gen-9': 'Intel HD / UHD Graphics', 'xe-hpg': 'Intel Arc A-series',
    'adreno-8xx': 'Qualcomm Adreno 800-series', 'adreno-7xx': 'Qualcomm Adreno 700-series', 'adreno-6xx': 'Qualcomm Adreno 600-series',
    'valhall': 'Arm Mali (Valhall)', 'apple': 'Apple GPU', 'metal-3': 'Apple GPU', 'common-3': 'Apple GPU'
  };

  // Vendor named by a renderer / vendor string, when it names exactly one of the PC GPU makers.
  function pcVendor(s) {
    s = String(s || '').toLowerCase();
    var found = [];
    if (/nvidia|geforce|quadro/.test(s)) { found.push('nvidia'); }
    if (/\bamd\b|radeon|\bati\b/.test(s)) { found.push('amd'); }
    if (/intel/.test(s)) { found.push('intel'); }
    return found.length === 1 ? found[0] : '';
  }

  function identifyGpu(webgl, wg, ua) {
    var res = { renderer: webgl.renderer || '', vendorString: webgl.vendor || '', name: '', entry: null, source: 'none', confidence: 'low',
      archHint: '', software: !!(webgl.software || webgl.virtual), virtual: !!webgl.virtual, bucketed: !!webgl.bucketed, hybrid: false };
    var info = wg.info || {};
    var match = LAC.matchGpu || function () { return null; };
    if (info.architecture) { res.archHint = ARCH_HINTS[String(info.architecture).toLowerCase()] || ''; }

    // Chrome puts the exact model in the WebGL renderer; WebGPU rarely has more than a vendor.
    var fromGL = (!webgl.masked && webgl.renderer) ? match(webgl.renderer) : null;
    var fromGPU = info.description ? match(info.description) : null;
    // Hybrid laptops can report the integrated GPU on one API and the discrete one on the other:
    // installed apps can use the stronger one.
    var best = fromGL;
    if (fromGPU && (!best || (fromGPU.bandwidthGBs || 0) > (best.bandwidthGBs || 0))) { best = fromGPU; }

    if (webgl.bucketed && best === fromGL) {
      // Firefox's bucket names a representative GPU of the vendor ("GTX 980", "R9 200 Series",
      // "HD Graphics 400", "Apple M1"), not the real one: keep only the vendor.
      var bucketVendor = pcVendor(webgl.renderer + ' ' + webgl.vendor);
      var cls = null;
      if ((best && best.vendor === 'apple') || /^apple /i.test(webgl.renderer)) {
        cls = ua.os === 'mac' ? match('generic apple silicon mac') : best;
      } else if (bucketVendor) {
        cls = match('generic ' + bucketVendor + ' gpu');
      } else {
        cls = best; // phone GPU families (Adreno, Mali): the table already has family-level entries
      }
      if (cls) { res.entry = cls; res.name = cls.name; res.source = 'webgl'; res.confidence = 'low'; }
    } else if (best) {
      res.entry = best; res.name = best.name; res.source = best === fromGPU ? 'webgpu' : 'webgl';
      // A "Laptop GPU" string that only matched a desktop card gets a derived laptop entry.
      res.confidence = best.laptopGuess ? 'medium' : 'high';
    }

    // Chrome leaves adapter.info.description empty, but the vendor of the high-performance adapter
    // still shows a discrete GPU that WebGL (running on the integrated one) does not name.
    var wgVendor = String(info.vendor || '').toLowerCase();
    if (res.entry && !webgl.bucketed && wg.available && res.source === 'webgl' &&
        (wgVendor === 'nvidia' || wgVendor === 'amd') && wgVendor !== res.entry.vendor &&
        (res.entry.kind === 'integrated' || res.entry.vendor === 'intel')) {
      res.hybrid = true;
      res.discreteVendor = wgVendor;
      res.confidence = 'low';
    }

    if (!res.entry) {
      var generic = genericFor(ua, webgl, wg);
      if (generic) {
        res.entry = generic; res.name = generic.name; res.source = 'inferred'; res.confidence = 'low';
      } else {
        res.name = cleanRenderer(webgl.renderer) || res.archHint || info.vendor || '';
        if (res.name) { res.source = webgl.renderer ? 'webgl' : 'webgpu'; }
      }
    }
    return res;
  }

  function genericFor(ua, webgl, wg) {
    var match = LAC.matchGpu;
    if (!match) { return null; }
    var r = String(webgl.renderer || '').toLowerCase();
    var v = String((wg.info && wg.info.vendor) || '').toLowerCase();
    if (ua.os === 'ios') { return match('generic iphone'); }
    if (ua.os === 'ipados') { return match('generic ipad'); }
    if (ua.os === 'mac') {
      // Safari 26+ WebGPU names the vendor: 'apple' on Apple silicon, 'intelr'/'amd' on Intel Macs.
      // Firefox only offers WebGPU on Apple silicon Macs. Older Safari says "Apple GPU" on every
      // Mac, so only the ASTC texture extension (Apple GPUs only) tells them apart.
      if (v === 'intelr' || v === 'intel' || v === 'amd') { return match('generic intel mac'); }
      var appleSilicon = v === 'apple' || /apple m\d/.test(r) ||
        (r === 'apple gpu' && webgl.astc === true) ||
        (ua.engine === 'gecko' && wg.available);
      if (appleSilicon) { return match('generic apple silicon mac'); }
      if (r === 'apple gpu' && webgl.astc === false) { return match('generic intel mac'); }
      return null; // unknown: better no GPU than a wrong one
    }
    // WebGL blocked or masked, but the WebGPU adapter says NVIDIA: some GeForce card.
    if (v === 'nvidia' && ua.formFactor === 'desktop' && (!r || webgl.masked)) { return match('generic nvidia gpu'); }
    return null;
  }

  // Known vendor names that contain commas and would break the "ANGLE (vendor, model, …)" split.
  var COMMA_VENDORS = /^ANGLE \((?:VMware, Inc\.|Samsung Electronics Co\., Ltd\.|Advanced Micro Devices, Inc\.),\s*/i;

  function cleanRenderer(s) {
    s = String(s || '').replace(/,? or similar$/i, '');
    s = s.replace(COMMA_VENDORS, 'ANGLE (V, ');
    var m = s.match(/^ANGLE \(([^,]*),\s*([^,]*?)(?:\s+Direct3D.*|\s+\(0x[0-9a-f]+\).*|,.*)?\)$/i);
    if (m) {
      s = m[2];
      if (/^(Inc|Ltd|Co|Corp)\.?$/i.test(s)) { s = ''; }
    }
    // "ANGLE Vulkan 1.3 (Samsung Xclipse 940 (0x…))" and "ANGLE Metal Renderer: Apple M3"
    s = s.replace(/^ANGLE Vulkan [\d.]+ \((.*?)(?: \(0x[^)]*\))?\)?$/i, '$1').replace(/^ANGLE Metal Renderer:\s*/i, '');
    s = s.replace(/\s*\((TM|R)\)/gi, '').replace(/\s+/g, ' ');
    if (/^(webkit webgl|mozilla|generic renderer)$/i.test(s)) { return ''; }
    return s.replace(/^\s+|\s+$/g, '');
  }

  // Guess RAM when the browser hides it, from the matched chip entry (Apple devices, Lunar Lake).
  // Only an actual identification counts: a Firefox bucket or a low-confidence match names a
  // representative GPU, whose smallest configuration says nothing about this device.
  function refineMemory(mem, gpu, ua) {
    var fromName = LAC.ramFromRenderer ? LAC.ramFromRenderer(gpu.renderer) : null;
    if (fromName && (mem.source === 'default' || mem.capped)) {
      mem.estimatedGB = fromName; mem.source = 'device-lookup'; mem.confidence = 'high'; mem.capped = false;
      return;
    }
    if (mem.source !== 'default' || !gpu.entry) { return; }
    if (gpu.bucketed && !gpu.entry.generic) { return; }
    if (gpu.confidence !== 'high' && !gpu.entry.generic) { return; }
    ramFromEntry(mem, gpu.entry);
  }

  // The first listed configuration is the curated default (the entry-level model of the chip:
  // 16 GB for a base M-series Mac, 6 GB for an iPhone); the page asks the user to confirm.
  function ramFromEntry(mem, entry) {
    var opts = entry && entry.unifiedOptionsGB;
    if (!opts || !opts.length) { return false; }
    mem.estimatedGB = opts[0];
    mem.source = 'device-lookup';
    mem.confidence = opts.length === 1 ? 'medium' : 'low';
    return true;
  }

  // ---------------------------------------------------------------- overrides

  function applyOverrides(device, ov) {
    if (!ov) { return device; }
    var notes = device.notes || [];
    var ramSet = typeof ov.ramGB === 'number' && ov.ramGB > 0;
    if (ramSet) {
      device.memory.estimatedGB = ov.ramGB;
      device.memory.source = 'user';
      device.memory.confidence = 'high';
      notes = notes.filter(function (n) { return n.indexOf('RAM') < 0; });
    }
    if (ov.gpuName) {
      notes = notes.filter(function (n) { return n.indexOf('GPU') < 0; });
    }
    device.notes = notes;
    if (ov.gpuName && LAC.GPUS) {
      for (var i = 0; i < LAC.GPUS.length; i++) {
        if (LAC.GPUS[i].name === ov.gpuName) {
          var entry = LAC.GPUS[i];
          device.gpu.entry = entry;
          device.gpu.name = entry.name;
          device.gpu.source = 'user';
          device.gpu.confidence = 'high';
          device.gpu.hybrid = false;
          device.gpu.bucketed = false;
          var mem = device.memory;
          // RAM that was only guessed (from the platform or from the previously matched chip)
          // follows the chip the user picked. A value the browser or the renderer name reported
          // (confidence 'high') and one the user set stay.
          if (!ramSet && mem && (mem.source === 'device-lookup' || mem.source === 'default') && mem.confidence !== 'high') {
            if (!ramFromEntry(mem, entry) && mem.source === 'device-lookup') {
              mem.estimatedGB = platformGuessGB(device.ua || {});
              mem.source = 'default';
              mem.confidence = 'low';
            }
          }
          if (device.ua && device.ua.os === 'mac' && device.cpu) { device.cpu.arch = entry.vendor === 'apple' ? 'arm' : 'x86'; }
          break;
        }
      }
    }
    return device;
  }

  // ---------------------------------------------------------------- orchestration

  function baseDevice() {
    return {
      ua: parseUA(),
      cpu: { cores: null, arch: null, bitness: null, score: null, memBandwidthGBs: null },
      memory: null, gpu: null, webgpu: null, webgl: null, wasm: null,
      storage: { quotaGB: null, usageGB: null }, network: readNetwork(), builtInAI: null,
      notes: []
    };
  }

  function readCores(d) {
    var hc = nav().hardwareConcurrency;
    d.cpu.cores = typeof hc === 'number' && hc > 0 ? hc : null;
    if (d.ua.engine === 'webkit' && d.cpu.cores && d.ua.os !== 'ios' && d.ua.os !== 'ipados' && d.cpu.cores <= 8) {
      d.notes.push('Safari may report fewer CPU cores than the device has.');
    }
  }

  function inferArch(d, hints) {
    if (hints && hints.architecture) { d.cpu.arch = hints.architecture === 'arm' ? 'arm' : (hints.architecture === 'x86' ? 'x86' : null); }
    if (hints && hints.bitness) { d.cpu.bitness = String(hints.bitness); }
    if (!d.cpu.arch) {
      if (d.ua.os === 'ios' || d.ua.os === 'ipados' || d.ua.os === 'android') { d.cpu.arch = 'arm'; }
      else if (d.ua.os === 'mac') {
        var e = d.gpu && d.gpu.entry;
        d.cpu.arch = e && (e.vendor === 'apple') ? 'arm' : (e ? 'x86' : null);
      } else if (/arm|aarch64/i.test(d.ua.raw)) { d.cpu.arch = 'arm'; }
      else if (d.ua.os === 'windows' || d.ua.os === 'linux') { d.cpu.arch = 'x86'; }
    }
  }

  // Synchronous subset, used when Promise is unavailable.
  function detectSync() {
    var d = baseDevice();
    try { readCores(d); } catch (e) { /* ignore */ }
    d.memory = readMemory(d.ua);
    d.webgl = readWebGL();
    d.webgpu = { available: false, isFallback: false, shaderF16: false, maxBufferGB: null, maxStorageBindingGB: null, info: { vendor: '', architecture: '', device: '', description: '' }, benchGBs: null, benchGflops: null, error: 'Not checked (browser too old).' };
    d.wasm = readWasm();
    d.gpu = identifyGpu(d.webgl, d.webgpu, d.ua);
    refineMemory(d.memory, d.gpu, d.ua);
    inferArch(d, null);
    d.notes.push('This browser is too old for the full check, so results use basic information only.');
    return d;
  }

  function detect(onProgress) {
    var report = typeof onProgress === 'function' ? onProgress : function () {};
    function step(id, fn) {
      report(id, 'running', '');
      try { return fn(); } catch (e) { report(id, 'fail', 'Check failed'); return null; }
    }
    var d = baseDevice();

    step('browser', function () {
      report('browser', 'running', '');
    });
    return clientHints(d.ua).then(function (hints) {
      var ua = d.ua;
      report('browser', 'done', ua.browser + (ua.browserVersion ? ' ' + ua.browserVersion : '') + ' on ' + osName(ua));

      step('cpu', function () {
        readCores(d);
        inferArch(d, hints);
        report('cpu', d.cpu.cores ? 'done' : 'warn', d.cpu.cores ? d.cpu.cores + ' logical cores' : 'Core count hidden by browser');
      });

      step('memory', function () {
        d.memory = readMemory(ua);
      });
      if (!d.memory) { d.memory = { reportedGB: null, estimatedGB: 8, source: 'default', capped: false, confidence: 'low' }; }

      step('gpu', function () { d.webgl = readWebGL(); });
      if (!d.webgl) { d.webgl = { version: 0, maxTextureSize: null, renderer: '', vendor: '', masked: true }; }

      report('webgpu', 'running', '');
      return readWebGPU();
    }).then(function (wg) {
      d.webgpu = wg;
      report('webgpu', wg.available ? (wg.isFallback ? 'warn' : 'done') : 'warn',
        wg.available ? (wg.isFallback ? 'Software fallback only' : 'Available' + (wg.shaderF16 ? ', 16-bit floats supported' : ', no 16-bit float shaders'))
          : (wg.error || 'Not available'));

      d.gpu = identifyGpu(d.webgl, wg, d.ua);
      inferArch(d, null);
      refineMemory(d.memory, d.gpu, d.ua);
      report('gpu', d.gpu.entry ? (d.gpu.confidence === 'high' ? 'done' : 'warn') : 'warn',
        d.gpu.entry ? d.gpu.name : (d.gpu.name ? d.gpu.name + ' (not in our table)' : 'GPU model hidden by browser'));
      report('memory', d.memory.confidence === 'high' ? 'done' : 'warn', memoryText(d.memory));

      report('wasm', 'running', '');
      d.wasm = readWasm();
      report('wasm', d.wasm.supported ? 'done' : 'warn', d.wasm.supported
        ? 'Supported' + (d.wasm.simd ? ', SIMD' : '') + (d.wasm.threads && d.wasm.crossOriginIsolated ? ', threads' : '')
        : 'Not supported');

      report('storage', 'running', '');
      return readStorage();
    }).then(function (st) {
      d.storage = st;
      report('storage', st.quotaGB !== null ? 'done' : 'warn', st.quotaGB !== null ? U.fmtGB(st.quotaGB) + ' available to web pages' : 'Quota not reported');
      return readBuiltInAI();
    }).then(function (ai) {
      d.builtInAI = ai;
      if (!LAC.bench) { return null; }
      report('bench-cpu', 'running', '');
      return U.withTimeout(LAC.bench.cpu(), 4000, null);
    }).then(function (cpuRes) {
      if (cpuRes) {
        d.cpu.score = cpuRes.score;
        d.cpu.memBandwidthGBs = cpuRes.memBandwidthGBs;
        report('bench-cpu', 'done', 'Score ' + U.round(cpuRes.score, 2) + ' (1.0 = typical 2020 laptop core)');
      } else {
        report('bench-cpu', 'warn', 'Skipped');
      }
      if (!LAC.bench || !d.webgpu.available || d.webgpu.isFallback) {
        report('bench-gpu', 'warn', d.webgpu.available ? 'Skipped (software GPU)' : 'Skipped (no WebGPU)');
        return null;
      }
      report('bench-gpu', 'running', '');
      return U.withTimeout(LAC.bench.gpu(d.webgpu.adapter), 5000, null);
    }).then(function (gpuRes) {
      if (gpuRes) {
        d.webgpu.benchGBs = gpuRes.gbs;
        d.webgpu.benchGflops = gpuRes.gflops;
        report('bench-gpu', 'done', 'Memory ~' + Math.round(gpuRes.gbs) + ' GB/s, compute ~' + formatGflops(gpuRes.gflops));
        adoptMeasuredGpu(d, gpuRes);
      } else if (d.webgpu.available && !d.webgpu.isFallback) {
        report('bench-gpu', 'warn', 'Did not finish');
      }
      d.webgpu.adapter = null; // don't keep the adapter alive
      addNotes(d);
      return d;
    }).then(null, function (err) {
      // Anything unexpected: return what we have instead of failing the page.
      if (!d.memory) { d.memory = readMemory(d.ua); }
      if (!d.webgl) { d.webgl = { version: 0, maxTextureSize: null, renderer: '', vendor: '', masked: true }; }
      if (!d.webgpu) { d.webgpu = { available: false, isFallback: false, shaderF16: false, maxBufferGB: null, maxStorageBindingGB: null, info: { vendor: '', architecture: '', device: '', description: '' }, benchGBs: null, benchGflops: null, error: 'Check failed' }; }
      if (!d.gpu) { d.gpu = identifyGpu(d.webgl, d.webgpu, d.ua); }
      if (!d.wasm) { d.wasm = readWasm(); }
      d.webgpu.adapter = null;
      d.notes.push('Part of the check failed (' + (err && err.message ? err.message : 'unknown error') + '); results may be less precise.');
      return d;
    });
  }

  // Apple chip tiers by measured bandwidth (browser tests reach ~70-90% of peak).
  var APPLE_TIERS = [
    { min: 600, label: 'Ultra', bw: 800, tflops: 27 },
    { min: 300, label: 'Max', bw: 400, tflops: 13.6 },
    { min: 130, label: 'Pro', bw: 200, tflops: 6.8 }
  ];

  // Refines unknown or generic GPUs with the in-browser measurement.
  function adoptMeasuredGpu(d, gpuRes) {
    if (!gpuRes || !gpuRes.gbs) { return; }
    var e = d.gpu.entry;
    if (e && e.generic && e.kind === 'apple-silicon') {
      for (var i = 0; i < APPLE_TIERS.length; i++) {
        var t = APPLE_TIERS[i];
        if (gpuRes.gbs >= t.min) {
          d.gpu.entry = U.extend({}, e, {
            name: 'Apple silicon Mac, ' + t.label + '-class chip (measured)', bandwidthGBs: t.bw, fp16Tflops: t.tflops,
            unifiedOptionsGB: t.label === 'Pro' ? [18, 16, 24, 32, 36] : [36, 32, 48, 64, 96, 128], measured: true
          });
          d.gpu.name = d.gpu.entry.name;
          if (d.memory.source === 'device-lookup') { d.memory.estimatedGB = d.gpu.entry.unifiedOptionsGB[0]; }
          break;
        }
      }
      return;
    }
    var measuredBw = Math.round(gpuRes.gbs / 0.75);
    var measuredTflops = U.round((gpuRes.gflops || 0) * 2 / 1000, 1);
    if (e && e.generic && e.vendor !== 'apple') {
      // A vendor class (Firefox hides the model): the benchmark ran on this very GPU, so its
      // bandwidth replaces the placeholder. The conservative VRAM stays until the user picks the card.
      d.gpu.entry = U.extend({}, e, {
        name: e.name.replace(/ \(model hidden by the browser\)$/, '') + ' (speed measured)',
        bandwidthGBs: measuredBw, fp16Tflops: measuredTflops > 0 ? measuredTflops : e.fp16Tflops, measured: true
      });
      d.gpu.name = d.gpu.entry.name;
      return;
    }
    if (e && d.gpu.hybrid) {
      // The benchmark runs on the high-performance adapter. Clearly faster than the integrated GPU
      // WebGL named means it measured the discrete card.
      if (measuredBw > 1.5 * (e.bandwidthGBs || 0)) {
        var vendorName = d.gpu.discreteVendor === 'nvidia' ? 'NVIDIA' : 'AMD';
        var recent = /40-series|50-series|RX 7000|RX 9000/.test(d.gpu.archHint || '');
        d.gpu.entry = {
          match: [], name: (d.gpu.archHint || vendorName + ' graphics card') + ' (measured)', vendor: d.gpu.discreteVendor,
          kind: 'discrete-laptop', vramGB: recent ? 6 : 4, unifiedOptionsGB: [],
          bandwidthGBs: measuredBw, fp16Tflops: measuredTflops, year: 0, measured: true
        };
        d.gpu.name = d.gpu.entry.name;
        d.gpu.source = 'webgpu';
        d.gpu.confidence = 'low';
      }
      return;
    }
    if (e) { return; }
    var mobile = d.ua.formFactor !== 'desktop';
    // An unknown NVIDIA GPU (or an AMD one faster than any APU) has its own video memory.
    var vendor = pcVendor(d.gpu.renderer + ' ' + d.gpu.vendorString + ' ' + ((d.webgpu && d.webgpu.info && d.webgpu.info.vendor) || ''));
    var discrete = !mobile && (vendor === 'nvidia' || (vendor === 'amd' && measuredBw > 150));
    d.gpu.entry = {
      match: [], name: (d.gpu.name || 'Unrecognised GPU') + ' (measured)', vendor: vendor || 'other',
      kind: mobile ? 'mobile-soc' : (discrete ? 'discrete-desktop' : 'integrated'), vramGB: discrete ? 4 : 0, unifiedOptionsGB: [],
      bandwidthGBs: measuredBw, fp16Tflops: measuredTflops, year: 0, measured: true
    };
    d.gpu.source = 'webgpu';
    d.gpu.confidence = 'low';
    d.notes.push('Your GPU is not in our table, so its speed comes from a quick in-browser measurement. ' +
      (discrete ? 'We assumed 4 GB of video memory; pick your card' : 'If it has its own video memory, pick it') + ' under "Correct the details".');
  }

  function addNotes(d) {
    if (d.memory.capped) { d.notes.push('Your browser reports at least ' + d.memory.reportedGB + ' GB of RAM but will not report more. If you have more, set it under "Correct the details".'); }
    if (d.memory.source === 'default' || d.memory.source === 'device-lookup') { d.notes.push('Your browser does not report RAM, so we assumed ' + d.memory.estimatedGB + ' GB. Set the real amount under "Correct the details".'); }
    if (d.gpu.hybrid) {
      d.notes.push('This computer seems to have two GPUs: the browser draws on ' + (d.gpu.entry && !d.gpu.entry.measured ? d.gpu.entry.name : 'the built-in one') +
        ', but apps like Ollama can use the ' + (d.gpu.discreteVendor === 'nvidia' ? 'NVIDIA' : 'AMD') + ' card. Pick that card under "Correct the details".');
    } else if (d.gpu.bucketed && d.gpu.entry && d.gpu.entry.generic) {
      d.notes.push('Firefox only reveals the maker of your GPU, not the model. Choosing it under "Correct the details" improves accuracy.');
    } else if (d.gpu.confidence !== 'high') { d.notes.push('We could not pin down your exact GPU. Choosing it under "Correct the details" improves accuracy.'); }
    if (d.gpu.virtual) { d.notes.push('The graphics look virtual (a virtual machine or remote desktop), so AI apps may not get real GPU acceleration here.'); }
    if (d.network.saveData) { d.notes.push('Data Saver is on. Models are large downloads (hundreds of MB to many GB).'); }
  }

  function formatGflops(g) {
    if (!g) { return 'n/a'; }
    return g >= 1000 ? U.round(g / 1000, 1) + ' TFLOPS' : Math.round(g) + ' GFLOPS';
  }

  function memoryText(mem) {
    if (mem.source === 'deviceMemory') {
      return mem.capped ? 'At least ' + mem.reportedGB + ' GB (browser caps the value)' : 'About ' + mem.reportedGB + ' GB';
    }
    if (mem.source === 'device-lookup') { return 'Hidden by browser; assuming ' + mem.estimatedGB + ' GB for this chip'; }
    if (mem.source === 'user') { return mem.estimatedGB + ' GB (set by you)'; }
    return 'Hidden by browser; assuming ' + mem.estimatedGB + ' GB';
  }

  function osName(ua) {
    var names = { windows: 'Windows', mac: 'macOS', linux: 'Linux', android: 'Android', ios: 'iOS', ipados: 'iPadOS', chromeos: 'ChromeOS',
      kaios: 'KaiOS', harmonyos: 'HarmonyOS', other: 'an unknown OS' };
    return (names[ua.os] || 'an unknown OS') + (ua.osVersion ? ' ' + ua.osVersion : '');
  }

  LAC.detect = function (onProgress) {
    if (!U.hasPromise) { return null; }
    return detect(onProgress);
  };
  LAC.detectSync = detectSync;
  LAC.applyOverrides = applyOverrides;
  LAC.detectInternals = {
    parseUA: parseUA, applyHints: applyHints, cleanRenderer: cleanRenderer, readMemory: readMemory, platformGuessGB: platformGuessGB,
    readWebGL: readWebGL, identifyGpu: identifyGpu, refineMemory: refineMemory, adoptMeasuredGpu: adoptMeasuredGpu, addNotes: addNotes,
    memoryText: memoryText, osName: osName
  };
})(window.LAC = window.LAC || {});
