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

    if (/iPhone|iPod/.test(ua)) { r.os = 'ios'; }
    else if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touch > 1)) { r.os = 'ipados'; }
    else if (/Android/.test(ua)) { r.os = 'android'; }
    else if (/CrOS/.test(ua)) { r.os = 'chromeos'; }
    else if (/Windows/.test(ua)) { r.os = 'windows'; }
    else if (/Macintosh|Mac OS X/.test(ua)) { r.os = 'mac'; }
    else if (/Linux|X11/.test(ua)) { r.os = 'linux'; }

    if ((m = ua.match(/OS (\d+)[_.](\d+)/)) && (r.os === 'ios' || r.os === 'ipados')) { r.osVersion = m[1] + '.' + m[2]; }
    else if ((m = ua.match(/Android (\d+(?:\.\d+)?)/))) { r.osVersion = m[1]; }
    else if ((m = ua.match(/Windows NT (\d+\.\d+)/))) { r.osVersion = m[1] === '10.0' ? '10 or 11' : m[1]; }

    if (r.os === 'ios') { r.formFactor = 'phone'; }
    else if (r.os === 'ipados') { r.formFactor = 'tablet'; }
    else if (r.os === 'android') { r.formFactor = /Mobile/.test(ua) ? 'phone' : 'tablet'; }

    if (r.os === 'android' && (m = ua.match(/Android [^;)]*;\s*(?:[a-z]{2}[-_][a-z]{2};\s*)?([^;)]+?)(?:\s+Build\/|\))/i))) {
      var model = m[1].replace(/^\s+|\s+$/g, '');
      if (model && model !== 'K' && !/^(Linux|U|wv)$/i.test(model)) { r.model = model; }
    }

    var browsers = [
      [/EdgA?\/(\d+)/, 'Edge'], [/EdgiOS\/(\d+)/, 'Edge'], [/OPR\/(\d+)/, 'Opera'], [/SamsungBrowser\/(\d+)/, 'Samsung Internet'],
      [/FxiOS\/(\d+)/, 'Firefox'], [/Firefox\/(\d+)/, 'Firefox'], [/CriOS\/(\d+)/, 'Chrome'], [/YaBrowser\/(\d+)/, 'Yandex Browser'],
      [/Vivaldi\/(\d+)/, 'Vivaldi'], [/Chrome\/(\d+)/, 'Chrome'], [/Version\/(\d+(?:\.\d+)?).*Safari/, 'Safari']
    ];
    for (var i = 0; i < browsers.length; i++) {
      if ((m = ua.match(browsers[i][0]))) { r.browser = browsers[i][1]; r.browserVersion = m[1]; break; }
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
      if (n.userAgentData.mobile === true && ua.formFactor === 'desktop') { ua.formFactor = 'phone'; }
      if (h.model) { ua.model = h.model; }
      if (ua.os === 'windows' && h.platformVersion) {
        var major = parseInt(String(h.platformVersion).split('.')[0], 10);
        ua.osVersion = major >= 13 ? '11' : (major > 0 ? '10' : ua.osVersion);
      }
      if (ua.os === 'mac' && h.platformVersion) { ua.osVersion = h.platformVersion; }
      if (h.formFactors && h.formFactors.length) {
        var ff = h.formFactors.join(',').toLowerCase();
        if (ff.indexOf('tablet') >= 0 && ua.formFactor === 'desktop' && ua.os === 'android') { ua.formFactor = 'tablet'; }
      }
      return h;
    }, function () { return null; });
  }

  // ---------------------------------------------------------------- memory

  // Chromium reports RAM rounded to a power of two, capped (8 GB historically; 32 GB on newer desktop builds).
  function readMemory(ua) {
    var n = nav();
    var mem = { reportedGB: null, estimatedGB: 8, source: 'default', capped: false, confidence: 'low' };
    var dm = null;
    try { dm = typeof n.deviceMemory === 'number' ? n.deviceMemory : null; } catch (e) { dm = null; }
    if (dm && dm > 0) {
      mem.reportedGB = dm;
      mem.source = 'deviceMemory';
      mem.estimatedGB = dm;
      var desktop = ua.formFactor === 'desktop';
      // Treat the top bucket as a floor: the real amount may be higher.
      mem.capped = dm >= 32 || (dm === 8 && desktop);
      mem.confidence = mem.capped ? 'medium' : 'high';
      // Values are rounded down to a power of two; a "4" is usually a 6 GB phone, "8" often 12 GB.
      if (!desktop && dm === 4) { mem.estimatedGB = 6; mem.confidence = 'medium'; }
      if (!desktop && dm === 8) { mem.estimatedGB = 8; mem.confidence = 'medium'; }
      if (desktop && dm === 8) { mem.estimatedGB = 16; mem.confidence = 'low'; }
    } else {
      // No API (Safari, Firefox): fall back to common configurations per platform.
      var guess = { ios: 6, ipados: 8, android: 8, mac: 16, windows: 16, linux: 16, chromeos: 8, other: 8 };
      mem.estimatedGB = guess[ua.os] || 8;
      mem.source = 'default';
      mem.confidence = 'low';
    }
    return mem;
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
    'ampere': 'NVIDIA GeForce RTX 30-series', 'turing': 'NVIDIA GeForce RTX 20 / GTX 16-series', 'pascal': 'NVIDIA GeForce GTX 10-series',
    'rdna-4': 'AMD Radeon RX 9000-series', 'rdna-3': 'AMD Radeon RX 7000-series or 780M/890M', 'rdna-2': 'AMD Radeon RX 6000-series or 680M',
    'xe-2lpg': 'Intel Arc 130V/140V (Lunar Lake)', 'xe-lpg': 'Intel Arc (Meteor Lake)', 'gen-12lp': 'Intel Iris Xe / UHD', 'xe-hpg': 'Intel Arc A-series',
    'apple': 'Apple GPU', 'metal-3': 'Apple GPU'
  };

  function identifyGpu(webgl, wg, ua) {
    var res = { renderer: webgl.renderer || '', vendorString: webgl.vendor || '', name: '', entry: null, source: 'none', confidence: 'low', archHint: '', software: !!webgl.software };
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

    if (best && webgl.bucketed && best === fromGL) {
      // Firefox's bucket names a representative GPU, not necessarily the real one.
      if (best.vendor === 'apple') {
        best = ua.os === 'mac' ? match('generic apple silicon mac') : best;
        res.entry = best; res.name = best.name; res.source = 'webgl'; res.confidence = 'low';
      } else {
        res.entry = best; res.name = best.name; res.source = 'webgl'; res.confidence = 'medium';
      }
    } else if (best) {
      res.entry = best; res.name = best.name; res.source = best === fromGPU ? 'webgpu' : 'webgl'; res.confidence = 'high';
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
      // Firefox only offers WebGPU on Apple silicon Macs.
      var appleSilicon = v === 'apple' || /apple m\d/.test(r) ||
        (r === 'apple gpu' && v !== 'intelr' && v !== 'intel' && v !== 'amd') ||
        (ua.engine === 'gecko' && wg.available);
      if (appleSilicon) { return match('generic apple silicon mac'); }
    }
    return null;
  }

  function cleanRenderer(s) {
    s = String(s || '');
    var m = s.match(/^ANGLE \(([^,]*),\s*([^,]*?)(?:\s+Direct3D.*|\s+\(0x[0-9a-f]+\).*|,.*)?\)$/i);
    if (m) { s = m[2]; }
    s = s.replace(/\s*\((TM|R)\)/gi, '').replace(/, or similar$/i, '').replace(/\s+/g, ' ');
    if (/^(webkit webgl|mozilla|generic renderer)$/i.test(s)) { return ''; }
    return s.replace(/^\s+|\s+$/g, '');
  }

  // Guess RAM for Apple devices when the browser hides it, from the matched chip entry.
  function refineMemory(mem, gpu, ua) {
    var fromName = LAC.ramFromRenderer ? LAC.ramFromRenderer(gpu.renderer) : null;
    if (fromName && (mem.source === 'default' || mem.capped)) {
      mem.estimatedGB = fromName; mem.source = 'device-lookup'; mem.confidence = 'high'; mem.capped = false;
      return;
    }
    if (mem.source !== 'default' || !gpu.entry) { return; }
    var opts = gpu.entry.unifiedOptionsGB;
    if (opts && opts.length) {
      // The smallest configuration is the safe assumption; the page asks the user to confirm.
      mem.estimatedGB = opts[0];
      mem.source = 'device-lookup';
      mem.confidence = opts.length === 1 ? 'medium' : 'low';
    }
  }

  // ---------------------------------------------------------------- overrides

  function applyOverrides(device, ov) {
    if (!ov) { return device; }
    var notes = device.notes || [];
    if (typeof ov.ramGB === 'number' && ov.ramGB > 0) {
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
          device.gpu.entry = LAC.GPUS[i];
          device.gpu.name = LAC.GPUS[i].name;
          device.gpu.source = 'user';
          device.gpu.confidence = 'high';
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
    if (e) { return; }
    var mobile = d.ua.formFactor !== 'desktop';
    d.gpu.entry = {
      match: [], name: (d.gpu.name || 'Unrecognised GPU') + ' (measured)', vendor: 'other',
      kind: mobile ? 'mobile-soc' : 'integrated', vramGB: 0, unifiedOptionsGB: [],
      bandwidthGBs: Math.round(gpuRes.gbs / 0.75), fp16Tflops: U.round((gpuRes.gflops || 0) * 2 / 1000, 1), year: 0, measured: true
    };
    d.gpu.source = 'webgpu';
    d.gpu.confidence = 'low';
    d.notes.push('Your GPU is not in our table, so its speed comes from a quick in-browser measurement. If it has its own video memory, pick it under "Correct the details".');
  }

  function addNotes(d) {
    if (d.memory.capped) { d.notes.push('Your browser reports at least ' + d.memory.reportedGB + ' GB of RAM but will not report more. If you have more, set it under "Correct the details".'); }
    if (d.memory.source === 'default' || d.memory.source === 'device-lookup') { d.notes.push('Your browser does not report RAM, so we assumed ' + d.memory.estimatedGB + ' GB. Set the real amount under "Correct the details".'); }
    if (d.gpu.confidence !== 'high') { d.notes.push('We could not pin down your exact GPU. Choosing it under "Correct the details" improves accuracy.'); }
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
    var names = { windows: 'Windows', mac: 'macOS', linux: 'Linux', android: 'Android', ios: 'iOS', ipados: 'iPadOS', chromeos: 'ChromeOS', other: 'an unknown OS' };
    return (names[ua.os] || 'an unknown OS') + (ua.osVersion ? ' ' + ua.osVersion : '');
  }

  LAC.detect = function (onProgress) {
    if (!U.hasPromise) { return null; }
    return detect(onProgress);
  };
  LAC.detectSync = detectSync;
  LAC.applyOverrides = applyOverrides;
  LAC.detectInternals = { parseUA: parseUA, cleanRenderer: cleanRenderer, readMemory: readMemory, memoryText: memoryText, osName: osName };
})(window.LAC = window.LAC || {});
