/*
 * Turns a detected Device into memory/bandwidth/compute budgets, then sorts every model into
 * "well" / "slow" / "no" for two targets: an installed app ("native") and this browser tab.
 *
 * Model of performance (see THRESHOLDS for the cut-offs):
 *   - LLM token generation is memory-bandwidth bound: every generated token reads all *active*
 *     weights once, so tok/s ≈ efficiency × bandwidth ÷ bytes read per token. MoE models read
 *     only their active parameters but must hold all parameters in memory.
 *   - When a model does not fit in VRAM, runtimes like llama.cpp split layers between GPU and
 *     system RAM; per-token time is then the sum of the time spent in each pool.
 *   - Diffusion (image/video) is compute bound: seconds ≈ work (TFLOP) ÷ effective TFLOPS.
 *   - Before the first word, the prompt itself must be read ("prefill"); that part is compute
 *     bound, so weak CPUs that generate quickly can still take long to start replying.
 *   - Speech models are rated by real-time factor (seconds of audio per second of compute).
 * ES5 only.
 */
(function (LAC) {
  'use strict';

  var THRESHOLDS = {
    // tok/s. ~10 tok/s is faster than most people read; below ~1.5 tok/s a reply takes minutes.
    llm: { well: 10, slow: 2 },
    // Reasoning models emit long hidden "thinking" traces before answering, so they need more.
    reasoning: { well: 15, slow: 2 },
    // Seconds per image at the model's default steps/resolution.
    image: { well: 30, slow: 300 },
    // Seconds per short clip (~5 s of video at the model's default resolution).
    video: { well: 600, slow: 3600 },
    // Real-time factor: audio seconds processed per wall-clock second.
    // ≥3× real time allows live dictation.
    speech: { well: 3, slow: 0.5 },
    tts: { well: 1.5, slow: 0.4 },
    // Embedding throughput in tokens/s (indexing a few thousand documents).
    embedding: { well: 200, slow: 20 },
    // Seconds per ~10 s music clip.
    audio: { well: 60, slow: 600 },
    // Seconds to read a 1,000-token prompt (about a page of pasted text) before replying.
    // Above 10 s a model that writes quickly still only "runs slowly"; above 60 s with an already
    // slow writing speed it is not usable.
    prefill: { well: 10, slow: 60 }
  };

  // Fraction of peak memory bandwidth that inference runtimes achieve in practice.
  var EFF = {
    gpuBw: 0.7,        // llama.cpp CUDA/ROCm/Metal decode on discrete or Apple GPUs
    cpuBw: 0.55,       // llama.cpp CPU decode on desktop DDR4/DDR5
    mobileBw: 0.45,    // phones: thermal limits and shared memory controller
    browserGpu: 0.8,   // WebGPU runtimes (WebLLM) relative to the same GPU natively
    wasmBw: 0.2,       // single-threaded WASM without cross-origin isolation
    gpuCompute: 0.35,  // diffusion: fraction of FP16 TFLOPS actually sustained
    appleCompute: 0.7, // MPS / Core ML diffusion (Apple table values are FP32-rate TFLOPS)
    mobileCompute: 0.35, // phones: GPU + neural engine, rated against GPU TFLOPS × 3
    cpuCompute: 0.6,
    prefill: 0.5       // prompt processing: fraction of the pool's TFLOPS reached on a batch
  };

  // Fixed cost per generated token (kernel launches, synchronisation, MoE routing) on top of the
  // bandwidth time. Calibrated on llama.cpp tg128 results (ggml-org/llama.cpp discussion #15396).
  var TOKEN_OVERHEAD_S = { nvidia: 0.0003, other: 0.003 };
  // MoE models read their active experts from scattered places plus the router: ~15% extra.
  var MOE_READ_FACTOR = 1.15;

  function num(x, d) { return (typeof x === 'number' && isFinite(x)) ? x : d; }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  // Memory the OS and other apps keep for themselves on a desktop/laptop.
  function osReserveGB(ram) { return clamp(ram * 0.2, 2.5, 8); }

  // Effective AI TFLOPS for a GPU entry: tensor/matrix cores roughly double throughput.
  function gpuAiTflops(e) {
    if (!e) { return 0; }
    var t = num(e.fp16Tflops, 0);
    if (!t) { t = num(e.bandwidthGBs, 0) / 25; }
    var n = (e.name || '').toLowerCase();
    // Pascal-era NVIDIA cards run FP16 at 1/64 rate, so diffusion falls back to FP32 (≈ bandwidth/40).
    if (t < 1 && e.vendor === 'nvidia') { t = Math.max(t, num(e.bandwidthGBs, 0) / 40); }
    if (e.vendor === 'nvidia' && (n.indexOf('rtx') >= 0 || e.kind === 'datacenter')) { t *= 2; }
    // RDNA 3/4 FP16 figures count dual-issue, which diffusion kernels rarely achieve.
    if (e.vendor === 'amd' && /rx [79]\d\d\d|radeon (pro|ai pro)|8060s|8050s|890m|880m|780m|760m/.test(n)) { t *= 0.7; }
    if (e.vendor === 'intel' && n.indexOf('arc') >= 0 && e.kind !== 'integrated') { t *= 1.5; }
    return t;
  }

  function cpuTflops(device) {
    var cores = num(device.cpu && device.cpu.cores, 4);
    var score = clamp(num(device.cpu && device.cpu.score, 1), 0.2, 4);
    // ~60 GFLOPS of sustained matmul per core for a 2020-era laptop core (score 1.0).
    return clamp(cores, 1, 64) * 0.06 * score;
  }

  function isMobile(device) {
    var f = device.ua && device.ua.formFactor;
    return f === 'phone' || f === 'tablet';
  }

  function defaultCpuBw(device) {
    if (isMobile(device)) { return 50; }
    var ram = num(device.memory && device.memory.estimatedGB, 8);
    return ram >= 32 ? 70 : 50; // dual-channel DDR5 vs DDR4-class laptops/desktops
  }

  // ---------------------------------------------------------------- budgets

  function budget(device) {
    var ram = num(device.memory && device.memory.estimatedGB, 8);
    var e = device.gpu && device.gpu.entry;
    var kind = e ? e.kind : null;
    var mobile = isMobile(device);
    var assumptions = [];
    var nat = {
      gpuMemGB: 0, gpuBwGBs: 0, gpuTflops: 0,
      cpuMemGB: 0, cpuBwGBs: 0, cpuTflops: cpuTflops(device),
      cpuEff: EFF.cpuBw, unified: false, label: '', path: 'cpu', mobile: false,
      vramGB: 0,                       // physical VRAM of a discrete card (gpuMemGB minus the display reserve)
      vendor: e ? (e.vendor || '') : '',
      spillGB: 0, spillBwGBs: 0        // Macs: RAM outside the GPU's share that llama.cpp can still use
    };

    if (e && (kind === 'discrete-desktop' || kind === 'discrete-laptop' || kind === 'datacenter')) {
      nat.vramGB = num(e.vramGB, 0);
      nat.gpuMemGB = Math.max(0, nat.vramGB - 0.5);
      nat.gpuBwGBs = num(e.bandwidthGBs, 0);
      nat.gpuTflops = gpuAiTflops(e);
      nat.cpuMemGB = Math.max(0, ram - osReserveGB(ram));
      nat.cpuBwGBs = defaultCpuBw(device);
      nat.path = 'gpu';
      nat.label = e.name + ' (' + LAC.util.fmtGB(e.vramGB) + ' VRAM) + ' + LAC.util.fmtGB(ram) + ' RAM';
      assumptions.push('About 0.5 GB of VRAM stays reserved for the display.');
    } else if (e && kind === 'apple-silicon' && !mobile) {
      // macOS lets the GPU wire ~2/3 of RAM (3/4 above 36 GB) by default.
      var share = ram > 36 ? 0.75 : 0.67;
      nat.unified = true;
      nat.gpuMemGB = ram * share;
      nat.gpuBwGBs = num(e.bandwidthGBs, 100);
      nat.gpuTflops = gpuAiTflops(e);
      nat.path = 'gpu';
      nat.label = e.name + ' with ' + LAC.util.fmtGB(ram) + ' unified memory';
      // Layers beyond the GPU's share run on the CPU cores, which reach only part of the bandwidth.
      nat.spillGB = Math.max(0, ram - osReserveGB(ram) - nat.gpuMemGB);
      nat.spillBwGBs = nat.gpuBwGBs * 0.6;
      assumptions.push('macOS lets the GPU use about ' + Math.round(share * 100) + '% of unified memory by default.');
    } else if (mobile) {
      // Phone/tablet apps (PocketPal, MLC Chat, AI Edge Gallery) get roughly half of RAM.
      var appShare = (device.ua.os === 'ios' || device.ua.os === 'ipados') ? 0.55 : 0.6;
      nat.cpuMemGB = ram * appShare;
      nat.cpuBwGBs = e ? num(e.bandwidthGBs, 50) : 50;
      nat.cpuEff = EFF.mobileBw;
      nat.gpuTflops = e ? gpuAiTflops(e) : 1;
      nat.unified = true;
      nat.mobile = true;
      nat.label = (e ? e.name : 'Mobile chip') + ' with ' + LAC.util.fmtGB(ram) + ' RAM';
      assumptions.push('Mobile apps can use about ' + Math.round(appShare * 100) + '% of RAM before the OS closes them.');
    } else {
      // Integrated graphics or unknown GPU: token generation runs at system-memory speed.
      nat.cpuMemGB = Math.max(0, ram - osReserveGB(ram));
      nat.cpuBwGBs = e ? num(e.bandwidthGBs, defaultCpuBw(device)) : defaultCpuBw(device);
      nat.gpuTflops = e ? gpuAiTflops(e) : 0;
      nat.unified = !!e;
      nat.label = (e ? e.name + ' (shared memory)' : 'CPU') + ' with ' + LAC.util.fmtGB(ram) + ' RAM';
      if (!e) { assumptions.push('No dedicated GPU identified, so estimates assume CPU inference.'); }
    }
    if (!mobile) {
      assumptions.push('The OS and open apps keep about ' + LAC.util.fmtGB(osReserveGB(ram)) + ' of RAM.');
    }

    return { native: nat, browser: browserBudget(device, nat, ram, mobile), assumptions: assumptions };
  }

  function browserBudget(device, nat, ram, mobile) {
    var wg = device.webgpu || {};
    var wasm = device.wasm || {};
    var b = { possible: false, reason: '', mode: 'none', memGB: 0, bwGBs: 0, tflops: 0, shaderF16: !!wg.shaderF16, quotaGB: null };
    b.quotaGB = device.storage && typeof device.storage.quotaGB === 'number' ? device.storage.quotaGB : null;

    if (wg.available && !wg.isFallback) {
      b.possible = true;
      b.mode = 'webgpu';
      var pool;
      if (mobile) {
        // Mobile browsers kill tabs well before the app limit.
        pool = ram * ((device.ua.os === 'ios' || device.ua.os === 'ipados') ? 0.3 : 0.35);
      } else if (nat.gpuMemGB > 0 && !nat.unified) {
        pool = nat.gpuMemGB * 0.9;
      } else if (nat.unified && nat.gpuMemGB > 0) {
        pool = nat.gpuMemGB * 0.8;
      } else {
        pool = Math.min(ram * 0.4, Math.max(0, ram - osReserveGB(ram)));
      }
      b.memGB = pool;
      var bw = nat.gpuBwGBs > 0 ? nat.gpuBwGBs * EFF.gpuBw : nat.cpuBwGBs * nat.cpuEff;
      b.bwGBs = bw * EFF.browserGpu;
      b.tflops = (nat.gpuTflops || 1) * 0.6;
      if (!b.shaderF16) { b.bwGBs *= 0.85; }
      b.reason = 'WebGPU is available' + (b.shaderF16 ? ' with 16-bit float support.' : ' (no 16-bit float shaders, so models use slower 32-bit variants).');
    } else if (wasm.supported) {
      b.possible = true;
      b.mode = 'wasm';
      // wasm32 caps a tab at 4 GB of linear memory; weights beyond ~2 GB rarely load.
      b.memGB = Math.min(2, ram * 0.25);
      // WebAssembly threads need cross-origin isolation, which this page (like most) does not have,
      // so in-browser runtimes usually get a single core.
      var mt = !!(wasm.threads && wasm.crossOriginIsolated);
      var cores = clamp(num(device.cpu && device.cpu.cores, 4), 1, 64);
      var bwFrom = nat.cpuBwGBs > 0 ? nat.cpuBwGBs : nat.spillBwGBs;
      b.bwGBs = bwFrom * EFF.wasmBw * (wasm.simd ? 1 : 0.5) * (mt ? 2.5 : 1);
      b.tflops = mt ? nat.cpuTflops * (wasm.simd ? 0.3 : 0.1) : (nat.cpuTflops / cores) * (wasm.simd ? 0.6 : 0.2);
      b.reason = wg.isFallback
        ? 'WebGPU only offers a software fallback here, so in-browser AI runs on the CPU through WebAssembly.'
        : 'WebGPU is not available in this browser, so in-browser AI is limited to small models on the CPU (WebAssembly).';
    } else {
      b.reason = 'This browser supports neither WebGPU nor WebAssembly, so it cannot run AI models itself.';
    }
    return b;
  }

  // ---------------------------------------------------------------- per-model helpers

  function kvGB(m) {
    // fp16 KV cache for ~4k tokens with grouped-query attention; ~0.5 GB for an 8B model.
    return clamp(0.12 + 0.05 * num(m.activeB, num(m.paramsB, 1)), 0.05, 1.5);
  }

  function weightsGB(m, p) {
    var s = m.sizes || {};
    if (typeof s[p] === 'number' && s[p] > 0) { return s[p]; }
    var f = p === 'q4' ? 0.6 : (p === 'q8' ? 1.07 : 2.0);
    return num(m.paramsB, 1) * f;
  }

  function hasPrecision(m, p) {
    var s = m.sizes || {};
    return s[p] !== null && s[p] !== undefined;
  }

  function llmNeedGB(m, p) {
    var w = weightsGB(m, p);
    return w + kvGB(m) + 0.3 + w * 0.05;
  }

  function thresholdsFor(m) {
    if (m.modality === 'reasoning') { return THRESHOLDS.reasoning; }
    if (m.modality === 'embedding') { return THRESHOLDS.embedding; }
    return THRESHOLDS.llm;
  }

  function rateVerdict(value, t, higherIsBetter) {
    if (higherIsBetter) { return value >= t.well ? 'well' : (value >= t.slow ? 'slow' : 'no'); }
    return value <= t.well ? 'well' : (value <= t.slow ? 'slow' : 'no');
  }

  // `needGB` and `haveGB` must describe the same pool, so the sentence can never say it fits.
  // `where` completes "…; <where> about X GB", e.g. 'this device can use', 'your graphics card has'.
  function noFit(needGB, haveGB, where, what) {
    var need = LAC.util.fmtGB(needGB);
    var have = LAC.util.fmtGB(Math.max(0, haveGB));
    what = what || 'memory';
    var reason = (needGB > haveGB && need !== have)
      ? 'Needs about ' + need + ' of ' + what + '; ' + where + ' about ' + have + '.'
      : 'Needs slightly more ' + what + ' than the ' + have + ' ' + where + '.';
    return { verdict: 'no', precision: null, memGB: needGB, placement: null, speed: null, reason: reason };
  }

  function canUse(target) { return target === 'browser' ? 'this browser tab can use' : 'this device can use'; }

  // Pools a model can use for a given target, fast first:
  // [{ memGB, bwGBs, tflops, batchTflops, overheadS, name, kind, vendor, physGB, spill }].
  // `tflops` caps generation and sizes diffusion; `batchTflops` is what mainstream runtimes get
  // for batch work such as reading the prompt or speech encoders (llama.cpp, whisper.cpp and
  // kokoro-onnx on an Intel/AMD integrated-graphics laptop use the CPU cores).
  function pools(budget, target) {
    if (target === 'browser') {
      var b = budget.browser;
      if (!b.possible) { return []; }
      return [{ memGB: b.memGB, bwGBs: b.bwGBs, tflops: b.tflops, batchTflops: b.tflops,
        overheadS: b.mode === 'webgpu' ? TOKEN_OVERHEAD_S.other : 0,
        name: 'this browser', kind: b.mode }];
    }
    var n = budget.native;
    var out = [];
    if (n.gpuMemGB > 0) {
      out.push({ memGB: n.gpuMemGB, bwGBs: n.gpuBwGBs * EFF.gpuBw, tflops: n.gpuTflops, batchTflops: n.gpuTflops,
        overheadS: n.vendor === 'nvidia' ? TOKEN_OVERHEAD_S.nvidia : TOKEN_OVERHEAD_S.other,
        name: n.unified ? 'unified memory' : 'graphics memory (VRAM)', kind: 'gpu', vendor: n.vendor,
        physGB: n.unified ? n.gpuMemGB : n.vramGB });
      // Macs: what does not fit the GPU's share runs on the CPU cores from the rest of RAM.
      if (n.unified && !n.mobile && n.spillGB > 0.5) {
        out.push({ memGB: n.spillGB, bwGBs: n.spillBwGBs * EFF.cpuBw, tflops: n.cpuTflops, batchTflops: n.cpuTflops,
          overheadS: 0, name: 'the rest of memory (CPU side)', kind: 'cpu', spill: true });
      }
    }
    if (n.cpuMemGB > 0 && !(n.unified && n.gpuMemGB > 0)) {
      if (n.mobile) {
        var mt = Math.max(n.cpuTflops, n.gpuTflops * 3);
        out.push({ memGB: n.cpuMemGB, bwGBs: n.cpuBwGBs * n.cpuEff, tflops: mt, batchTflops: mt, overheadS: 0, name: 'phone memory', kind: 'mobile' });
      } else {
        out.push({ memGB: n.cpuMemGB, bwGBs: n.cpuBwGBs * n.cpuEff, tflops: Math.max(n.cpuTflops, n.unified ? n.gpuTflops * 0.5 : 0),
          batchTflops: n.cpuTflops, overheadS: 0, name: 'system memory (RAM)', kind: 'cpu' });
      }
    }
    return out;
  }

  function totalMem(ps) { var t = 0; for (var i = 0; i < ps.length; i++) { t += ps[i].memGB; } return t; }

  // ---------------------------------------------------------------- LLM-style (bandwidth bound)

  function llmAt(m, p, ps) {
    var need = llmNeedGB(m, p);
    var paramsB = num(m.paramsB, 1);
    var activeB = num(m.activeB, paramsB);
    var bytesPerParam = weightsGB(m, p) / Math.max(0.01, paramsB);
    var tokenGB = activeB * bytesPerParam * (activeB < paramsB ? MOE_READ_FACTOR : 1) + kvGB(m) * 0.5;
    var gflopPerTok = 2 * activeB;
    if (!ps.length) { return null; }
    var fast = ps[0];
    // Reading a 1,000-token prompt costs 2 × active params × 1000 FLOP (= 2 × activeB TFLOP);
    // the first pool reads it (llama.cpp streams offloaded layers through the GPU for this).
    var prefillS = 2 * activeB / Math.max(0.005, num(fast.batchTflops, fast.tflops) * EFF.prefill);
    var placement, secPerTok, where;
    if (need <= fast.memGB) {
      placement = (fast.kind === 'cpu' || fast.kind === 'wasm') ? 'cpu' : 'gpu';
      where = fast.name;
      secPerTok = tokenGB / Math.max(0.1, fast.bwGBs) + num(fast.overheadS, 0);
      secPerTok = Math.max(secPerTok, gflopPerTok / Math.max(1, fast.tflops * 1000 * 0.5));
    } else if (ps.length > 1 && need <= totalMem(ps)) {
      var slow = ps[1];
      var fastShare = Math.max(0, fast.memGB - 0.3) / need;
      placement = 'split';
      where = slow.spill ? fast.name + ' (a small part on the CPU)' : fast.name + ' plus ' + slow.name;
      secPerTok = fastShare * tokenGB / Math.max(0.1, fast.bwGBs) + num(fast.overheadS, 0) +
        (1 - fastShare) * tokenGB / Math.max(0.1, slow.bwGBs);
      secPerTok = Math.max(secPerTok, (1 - fastShare) * gflopPerTok / Math.max(1, slow.tflops * 1000 * 0.5));
    } else if (need <= totalMem(ps) * 1.12) {
      // Within ~12% of the limit: it loads only once other apps are closed. Rate it at the
      // slowest pool's speed and never better than "slow".
      var last = ps[ps.length - 1];
      placement = ps.length > 1 ? 'split' : (last.kind === 'cpu' ? 'cpu' : 'gpu');
      secPerTok = tokenGB / Math.max(0.1, last.bwGBs) + num(last.overheadS, 0);
      secPerTok = Math.max(secPerTok, gflopPerTok / Math.max(1, last.tflops * 1000 * 0.5));
      return { fits: true, tight: true, need: need, placement: placement, where: last.name, tps: 1 / secPerTok, prefillS: prefillS };
    } else {
      return { fits: false, need: need, have: totalMem(ps) };
    }
    return { fits: true, need: need, placement: placement, where: where, fastName: fast.name, tps: 1 / secPerTok, prefillS: prefillS };
  }

  function classifyLLM(m, ps, target) {
    var t = thresholdsFor(m);
    var embedding = m.modality === 'embedding';
    // Rate the 4-bit build (Ollama's and LM Studio's default); fall back to 8/16-bit if that's all there is.
    var p = hasPrecision(m, 'q4') ? 'q4' : (hasPrecision(m, 'q8') ? 'q8' : 'fp16');
    var r = llmAt(m, p, ps);
    if (!r) { return null; }
    if (!r.fits) { return noFit(r.need, r.have, canUse(target)); }
    // Embedding models read documents in batches rather than writing, so they are rated on that rate.
    var rate = embedding ? r.tps * EMBED_BATCH : r.tps;
    var v = rateVerdict(rate, t, true);
    if (r.tight && v === 'well') { v = 'slow'; }
    // A model that writes quickly can still take long to read a pasted page before it starts.
    var slowStart = false;
    if (!embedding && v === 'well' && r.prefillS > THRESHOLDS.prefill.well) { v = 'slow'; slowStart = true; }
    else if (!embedding && v === 'slow' && !r.tight && r.prefillS > THRESHOLDS.prefill.slow) { v = 'no'; slowStart = true; }
    var speedWord = LAC.util.fmtRate(rate).replace('~', '');
    var where = target === 'browser' ? 'this browser' : r.where;
    var startText = 'a long message (about a page of text) takes around ' + fmtSeconds(r.prefillS) + ' to read before the reply starts';
    var reason;
    if (embedding) {
      reason = v === 'no'
        ? 'It fits in memory, but it would process only about ' + speedWord + ', too slow for indexing documents.'
        : 'Fits in ' + where + ' and processes about ' + speedWord + (v === 'well' ? ', fast enough to index documents here.' : ', so indexing many documents takes a while.');
    } else if (r.tight && v !== 'no') {
      reason = 'Needs about ' + LAC.util.fmtGB(r.need) + ', right at this device\'s limit: close other apps first. Expect about ' + speedWord + '.';
    } else if (slowStart && v === 'slow') {
      reason = 'Fits in ' + where + ' and writes about ' + speedWord + ', but ' + startText + '.';
    } else if (slowStart) {
      reason = 'Writes only about ' + speedWord + ', and ' + startText + ', which is too slow to be usable.';
    } else if (v === 'well') {
      reason = 'Fits in ' + where + ' as a compressed ' + precisionName(p) + ' version and should write about ' + speedWord + '.';
    } else if (v === 'slow') {
      reason = r.placement === 'split'
        ? 'Too big for ' + splitFastName(r.fastName) + ' alone, so part of it runs from slower memory at about ' + speedWord + '.'
        : 'Fits in ' + where + ', but writes slowly: about ' + speedWord + '.';
    } else {
      reason = 'It fits in memory, but at about ' + speedWord + ' it is too slow to be usable.';
    }
    var out = {
      verdict: v, precision: p, memGB: r.need, placement: r.placement,
      speed: { value: rate, unit: 'tok/s' }, reason: reason, q8: null
    };
    // Note when the higher-quality 8-bit build would also run well entirely in fast memory
    // (not for natively 4-bit models such as gpt-oss, whose 8-bit files are the same weights).
    if (!embedding && p === 'q4' && v === 'well' && hasPrecision(m, 'q8') && weightsGB(m, 'q8') > weightsGB(m, 'q4') * 1.1) {
      var r8 = llmAt(m, 'q8', ps);
      if (r8 && r8.fits && !r8.tight && r8.placement !== 'split' && rateVerdict(r8.tps, t, true) === 'well') {
        out.q8 = { memGB: r8.need, tps: r8.tps };
      }
    }
    return out;
  }

  function splitFastName(name) {
    return name === 'unified memory' ? 'the GPU\'s share of unified memory' : name;
  }

  // Embedding models process whole documents at once, so throughput is ~20× decode speed.
  var EMBED_BATCH = 20;

  function rank(v) { return v === 'well' ? 2 : (v === 'slow' ? 1 : 0); }

  function precisionName(p) {
    return p === 'q4' ? '4-bit' : (p === 'q8' ? '8-bit' : '16-bit');
  }

  // ---------------------------------------------------------------- compute-bound (diffusion, audio gen)

  // Workloads are calibrated on an RTX 4090 (≈ 165 AI TFLOPS in gpuAiTflops). Diffusion runtimes
  // keep smaller cards closer to their peak, so efficiency rises gently as TFLOPS fall. The rise is
  // smaller outside NVIDIA, where ROCm/DirectML/oneAPI kernels are less tuned.
  var CALIBRATION_TFLOPS = 165;
  function diffusionScale(pool) {
    var f = Math.pow(CALIBRATION_TFLOPS / Math.max(1, pool.tflops), 0.25);
    return clamp(f, 1, pool.vendor === 'nvidia' ? 2.2 : 1.3);
  }

  function classifyCompute(m, ps, budget, target) {
    var d = m.diffusion || {};
    var unit = d.unit === 'clip' ? 'clip' : 'image';
    var t = m.modality === 'video-generation' ? THRESHOLDS.video : (m.modality === 'music-audio' ? THRESHOLDS.audio : THRESHOLDS.image);
    var work = num(d.tflop, num(m.paramsB, 1) * 20);
    var minGpu = num(m.minMemGB, weightsGB(m, 'fp16'));
    var n = budget.native;
    if (!ps.length) { return null; }
    // With a discrete card of 4 GB or more, image tools run on that card (slowly if need be);
    // a CPU fallback would take hours, so it is never the answer there.
    var gpuOnly = target !== 'browser' && !n.unified && n.vramGB >= 4;
    var best = null, closest = null;
    for (var i = 0; i < ps.length; i++) {
      var pool = ps[i];
      if (pool.spill || (gpuOnly && pool.kind !== 'gpu')) { continue; }
      var discrete = target !== 'browser' && pool.kind === 'gpu' && !n.unified;
      var need, have, offload = false;
      if (target === 'browser') {
        need = minGpu * 1.2; have = pool.memGB;
      } else if (discrete) {
        // minMemGB is written against a card's nominal VRAM ("fits 8 GB cards"), and text
        // encoders can move to RAM, so compare with the physical size.
        need = minGpu; have = pool.physGB;
        // Smaller cards still work when the 4-bit weights plus ~1.5 GB for the text encoder and
        // VAE fit: ComfyUI/Forge keep the rest in system RAM, at roughly 1.4× the time.
        if (need > have && have >= weightsGB(m, 'q4') + 1.5 && n.cpuMemGB >= minGpu) {
          offload = true; need = have;
        }
      } else {
        // CPU and unified-memory paths must hold everything, including the text encoders.
        need = minGpu * 1.3; have = pool.memGB;
      }
      if (need > have) {
        if (!closest || need - have < closest.need - closest.have) { closest = { need: need, have: have, discrete: discrete }; }
        continue;
      }
      var eff = computeEff(pool, budget) * (discrete ? diffusionScale(pool) : 1);
      var secs = (offload ? 1.4 : 1) * work / Math.max(0.01, pool.tflops * eff);
      var v = rateVerdict(secs, t, false);
      if (!best || rank(v) > rank(best.v) || (rank(v) === rank(best.v) && secs < best.secs)) {
        best = { v: v, secs: secs, need: need, pool: pool, offload: offload };
      }
    }
    if (!best) {
      if (!closest) { return noFit(minGpu, 0, canUse(target)); }
      return closest.discrete
        ? noFit(closest.need, closest.have, 'your graphics card has', 'graphics memory (VRAM)')
        : noFit(closest.need, closest.have, canUse(target));
    }
    var unitWord = unit === 'clip' ? 'clip' : (m.modality === 'music-audio' ? 'clip' : 'image');
    var timeText = fmtSeconds(best.secs) + ' per ' + unitWord;
    var reason;
    if (best.v === 'no') {
      reason = 'Would take roughly ' + timeText + ', which is impractical.';
    } else if (best.offload) {
      reason = 'Runs with part of the model moved to system memory (RAM); expect roughly ' + timeText + '.';
    } else {
      reason = best.v === 'well'
        ? 'Fits in ' + (target === 'browser' ? 'this browser' : best.pool.name) + '; expect roughly ' + timeText + '.'
        : 'Runs, but expect roughly ' + timeText + '.';
    }
    return {
      verdict: best.v, precision: null, memGB: best.need,
      placement: best.offload ? 'split' : ((best.pool.kind === 'cpu' || best.pool.kind === 'wasm') ? 'cpu' : 'gpu'),
      speed: { value: best.secs, unit: 's/' + unitWord }, reason: reason
    };
  }

  function computeEff(pool, budget) {
    if (pool.kind === 'cpu' || pool.kind === 'wasm') { return EFF.cpuCompute; }
    if (pool.kind === 'mobile') { return EFF.mobileCompute; }
    if (pool.kind === 'webgpu') { return EFF.gpuCompute * 0.6; }
    return budget.native.unified ? EFF.appleCompute : EFF.gpuCompute;
  }

  function fmtSeconds(s) {
    if (s < 1) { return 'under a second'; }
    if (s < 90) { return Math.round(s) + ' s'; }
    if (s < 5400) { return Math.round(s / 60) + ' min'; }
    return LAC.util.round(s / 3600, 1) + ' h';
  }

  // ---------------------------------------------------------------- speech (real-time factor)

  function classifySpeech(m, ps, target, budget) {
    var sp = m.speech || {};
    var t = m.modality === 'text-to-speech' ? THRESHOLDS.tts : THRESHOLDS.speech;
    var tokPerAudioSec = num(sp.tokPerAudioSec, 10);
    var decB = num(sp.decB, num(m.activeB, num(m.paramsB, 0.5)));
    var encTflop = num(sp.encTflopPerAudioSec, num(m.paramsB, 0.5) * 0.05);
    var p = hasPrecision(m, 'q8') ? 'q8' : (hasPrecision(m, 'fp16') ? 'fp16' : 'q4');
    var w = weightsGB(m, p);
    var need = Math.max(num(m.minMemGB, 0), w * 1.2 + 0.2);
    if (!ps.length) { return null; }
    var best = null;
    for (var i = 0; i < ps.length; i++) {
      var pool = ps[i];
      if (pool.spill || need > pool.memGB) { continue; }
      var decodeSec = tokPerAudioSec * decB * (w / Math.max(0.01, num(m.paramsB, 0.5))) / Math.max(0.1, pool.bwGBs);
      var encSec = encTflop / Math.max(0.005, num(pool.batchTflops, pool.tflops) * computeEff(pool, budget));
      var rtf = 1 / Math.max(1e-6, decodeSec + encSec);
      var v = rateVerdict(rtf, t, true);
      if (!best || rtf > best.rtf) { best = { v: v, rtf: rtf, pool: pool }; }
    }
    if (!best) {
      // Report against the largest pool it was tried in, so the numbers always disagree.
      var biggest = 0;
      for (var j = 0; j < ps.length; j++) { if (!ps[j].spill) { biggest = Math.max(biggest, ps[j].memGB); } }
      return noFit(need, biggest, canUse(target));
    }
    var x = best.rtf >= 10 ? Math.round(best.rtf) : LAC.util.round(best.rtf, 1);
    var what = m.modality === 'text-to-speech' ? 'speech' : 'audio';
    var reason = best.v === 'no'
      ? 'Processes only about ' + x + '× real time, which is too slow to be practical.'
      : 'Handles ' + what + ' at about ' + x + '× real time' + (best.v === 'slow' ? ', so expect to wait.' : '.');
    return {
      verdict: best.v, precision: p, memGB: need, placement: (best.pool.kind === 'cpu' || best.pool.kind === 'wasm') ? 'cpu' : 'gpu',
      speed: { value: best.rtf, unit: 'x realtime' }, reason: reason
    };
  }

  // ---------------------------------------------------------------- public API

  function browserEligible(m) {
    return !!(m.browser && (m.browser.webllm || m.browser.tjs || m.browser.other));
  }

  // WebLLM ships 16-bit-float builds and slower, larger 32-bit ones for GPUs without shader-f16.
  function webllmBuild(m, shaderF16) {
    var w = m.browser && m.browser.webllm;
    if (!w) { return null; }
    // q4f16 builds declare the 'shader-f16' feature and WebLLM refuses them without it.
    return shaderF16 ? (w.f16 || w.f32 || null) : (w.f32 || null);
  }

  function classify(m, budget, target) {
    target = target === 'browser' ? 'browser' : 'native';
    if (target === 'browser') {
      if (!budget.browser.possible) {
        return { verdict: 'no', precision: null, memGB: 0, placement: null, speed: null, reason: budget.browser.reason };
      }
      if (!browserEligible(m)) {
        return { verdict: 'no', precision: null, memGB: 0, placement: null, speed: null, unavailable: true,
          reason: 'No in-browser version of this model exists yet; use an installed app instead.' };
      }
      if (budget.browser.mode === 'wasm' && (m.browser.webllm || m.browser.webgpuOnly !== false)) {
        return { verdict: 'no', precision: null, memGB: 0, placement: null, speed: null,
          reason: 'The in-browser version needs WebGPU, which this browser does not provide.' };
      }
    }
    var ps = pools(budget, target);
    var v = null;
    try {
      if (m.kind === 'diffusion' || m.kind === 'audio-gen') { v = classifyCompute(m, ps, budget, target); }
      else if (m.kind === 'speech' || m.kind === 'tts') { v = classifySpeech(m, ps, target, budget); }
      else {
        if (target === 'browser' && m.browser && m.browser.webllm && budget.browser.mode === 'webgpu') {
          v = classifyWebLLM(m, budget);
        } else {
          v = classifyLLM(m, ps, target);
        }
      }
    } catch (err) {
      v = null;
    }
    if (!v) {
      return { verdict: 'no', precision: null, memGB: 0, placement: null, speed: null, reason: 'Could not estimate this model on this device.' };
    }
    // In-browser models are downloaded into browser storage; a small quota blocks them.
    if (target === 'browser' && v.verdict !== 'no' && budget.browser.quotaGB !== null) {
      var dl = m.browser && m.browser.webllm ? weightsGB(m, 'q4') : weightsGB(m, hasPrecision(m, 'q8') ? 'q8' : 'q4');
      if (dl > budget.browser.quotaGB) {
        v.verdict = 'no';
        v.reason = 'The ' + LAC.util.fmtGB(dl) + ' download is larger than the ' + LAC.util.fmtGB(budget.browser.quotaGB) + ' this browser allows the page to store.';
      }
    }
    return v;
  }

  // WebLLM publishes the VRAM each prebuilt model needs, which beats our generic estimate.
  function classifyWebLLM(m, budget) {
    var b = budget.browser;
    var build = webllmBuild(m, b.shaderF16);
    if (!build) {
      return { verdict: 'no', precision: null, memGB: 0, placement: null, speed: null,
        reason: 'This model\'s in-browser version needs 16-bit float shaders (shader-f16), which this graphics chip or browser does not offer.' };
    }
    var need = num(build.vramMB, 0) / 1000;
    if (need > b.memGB) { return noFit(need, b.memGB, canUse('browser')); }
    var tokenGB = num(m.activeB, num(m.paramsB, 1)) * (weightsGB(m, 'q4') / Math.max(0.01, num(m.paramsB, 1)));
    if (build === m.browser.webllm.f32) { tokenGB *= 1.15; }
    var tps = b.bwGBs / Math.max(0.01, tokenGB);
    tps = Math.min(tps, (b.tflops * 1000 * 0.4) / (2 * num(m.activeB, 1)));
    var v = rateVerdict(tps, thresholdsFor(m), true);
    var s = LAC.util.fmtRate(tps).replace('~', '');
    return {
      verdict: v, precision: 'q4', memGB: need, placement: 'gpu', speed: { value: tps, unit: 'tok/s' },
      reason: v === 'well' ? 'Runs on your graphics chip right in this browser (WebGPU) at about ' + s + '.'
        : (v === 'slow' ? 'Runs on your graphics chip in this browser (WebGPU), but slowly: about ' + s + '.'
          : 'Loads in this browser (WebGPU) but manages only about ' + s + ', too slow to be usable.')
    };
  }

  function classifyAll(models, budget, target) {
    var out = [];
    for (var i = 0; i < models.length; i++) {
      out.push({ model: models[i], v: classify(models[i], budget, target) });
    }
    return out;
  }

  LAC.estimate = {
    THRESHOLDS: THRESHOLDS,
    EFF: EFF,
    budget: budget,
    classify: classify,
    classifyAll: classifyAll,
    browserEligible: browserEligible,
    webllmBuild: webllmBuild,
    // exposed for tests and the "how we estimate" section
    _llmNeedGB: llmNeedGB,
    _gpuAiTflops: gpuAiTflops,
    fmtSeconds: fmtSeconds
  };
})(window.LAC = window.LAC || {});
