/*
 * Short, safe micro-benchmarks. Each yields to the UI between chunks and gives up quietly on
 * any error. They refine the table-based estimates; they never block a result.
 * ES5 only.
 */
(function (LAC) {
  'use strict';

  var U = LAC.util;

  // Milliseconds a 2020-era mid-range laptop core (e.g. Core i5-1135G7, Chrome) needs for one
  // sample (ROUNDS × a 96×96 matmul). score = REF_MS / measured, so 1.0 ≈ that laptop.
  var REF_MS = 11;
  var N = 96;
  var ROUNDS = 8;

  // Timers may be coarsened to 1 ms (Safari, Firefox) or 16.7-100 ms (Firefox
  // resistFingerprinting, Tor/Mullvad Browser). So each chunk starts right after a clock tick and
  // runs whole rounds until at least CHUNK_MS has passed by that clock; both ends then sit on a
  // tick edge and the window is exact to within one round, whatever the resolution. Chunks yield
  // to the UI in between, and the score comes from all measured chunks added together.
  var CHUNK_MS = 40;       // target length of one blocking chunk (a 100 ms clock makes it 100)
  var MIN_WINDOW_MS = 150; // measured time needed before we may stop early
  var GOOD_WINDOW_MS = 300; // measured time after which we stop
  var SOFT_BUDGET_MS = 650; // stop once past this and MIN_WINDOW_MS is reached
  var HARD_BUDGET_MS = 900; // never start a new chunk after this
  var MAX_ROUNDS = 3000;   // per chunk; only a frozen clock gets near it

  function matmulRound(a, b, c) {
    for (var i = 0; i < N; i++) {
      for (var k = 0; k < N; k++) {
        var aik = a[i * N + k];
        var row = k * N, out = i * N;
        for (var j = 0; j < N; j++) { c[out + j] += aik * b[row + j]; }
      }
    }
    return c[0];
  }

  // One blocking chunk: { rounds, ms } counted between two clock ticks, or null if the clock
  // never moved.
  function timedChunk(a, b, c, minMs) {
    var t = U.now(), t0 = t, n = 0, t1;
    // Align to a tick edge; these rounds also warm up the JIT and are not counted.
    while (t0 === t && n < MAX_ROUNDS) { matmulRound(a, b, c); n++; t0 = U.now(); }
    if (t0 === t) { return null; }
    n = 0;
    do { matmulRound(a, b, c); n++; t1 = U.now(); } while (t1 - t0 < minMs && n < MAX_ROUNDS);
    return t1 > t0 ? { rounds: n, ms: t1 - t0 } : null;
  }

  function cpu() {
    if (typeof Float32Array === 'undefined') { return Promise.resolve(null); }
    var a = new Float32Array(N * N), b = new Float32Array(N * N), c = new Float32Array(N * N);
    for (var i = 0; i < N * N; i++) { a[i] = (i % 7) * 0.1; b[i] = (i % 5) * 0.2; }
    var start = U.now();
    var chunks = 0, rounds = 0, ms = 0;

    function runChunk() {
      var r = timedChunk(a, b, c, CHUNK_MS);
      if (!r) { return null; } // clock does not advance: no measurement possible
      // The first chunk is a warm-up (JIT tiers, CPU clock ramp) and is discarded.
      if (chunks++ > 0) { rounds += r.rounds; ms += r.ms; }
      var spent = U.now() - start;
      var done = ms >= GOOD_WINDOW_MS || (ms >= MIN_WINDOW_MS && spent >= SOFT_BUDGET_MS) ||
        spent >= HARD_BUDGET_MS;
      return done ? null : U.nextTick(0).then(runChunk);
    }

    return U.nextTick(0).then(runChunk).then(function () {
      if (!(rounds > 0 && ms > 0)) { return null; }
      var sampleMs = ms / rounds * ROUNDS;
      var score = Math.max(0.05, Math.min(8, REF_MS / sampleMs));
      // memBandwidthGBs stays in the result shape but is not measured: a large-copy test costs
      // a long main-thread stall and a big allocation, and no estimate uses it.
      return { score: score, memBandwidthGBs: null, ms: U.now() - start };
    }, function () { return null; });
  }

  // ---------------------------------------------------------------- WebGPU

  var COPY_WGSL = [
    '@group(0) @binding(0) var<storage, read> src: array<vec4<f32>>;',
    '@group(0) @binding(1) var<storage, read_write> dst: array<vec4<f32>>;',
    '@compute @workgroup_size(256)',
    'fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) nwg: vec3<u32>) {',
    '  let i = gid.x + gid.y * nwg.x * 256u;',
    '  if (i < arrayLength(&src)) { dst[i] = src[i] * 1.0001; }',
    '}'
  ].join('\n');

  var FMA_ITERS = 256;
  var FMA_WGSL = [
    '@group(0) @binding(0) var<storage, read_write> outBuf: array<vec4<f32>>;',
    '@compute @workgroup_size(256)',
    'fn main(@builtin(global_invocation_id) gid: vec3<u32>) {',
    '  var a = vec4<f32>(f32(gid.x) * 0.0001, 1.0, 2.0, 3.0);',
    '  var b = vec4<f32>(0.9999, 0.9998, 0.9997, 0.9996);',
    '  let c = vec4<f32>(0.0001, 0.0002, 0.0003, 0.0004);',
    '  for (var i = 0u; i < ' + FMA_ITERS + 'u; i = i + 1u) {',
    '    a = fma(a, b, c);',
    '    b = fma(b, a, c);',
    '  }',
    '  outBuf[gid.x] = a + b;',
    '}'
  ].join('\n');

  // Timed batches double from one dispatch until a batch lasts GPU_MIN_MS (long enough to time
  // even with a 100 ms clock) or reaches GPU_MAX_REPS. A batch is only doubled while the last one
  // measured under GPU_MIN_MS, so even with a 100 ms clock the largest batch stays under ~400 ms
  // and a weak GPU never gets a long submission (which can trip driver watchdogs).
  var GPU_MIN_MS = 100;
  var GPU_MAX_REPS = 64;

  function gpu(adapter) {
    if (!adapter || typeof adapter.requestDevice !== 'function' || typeof GPUBufferUsage === 'undefined') {
      return Promise.resolve(null);
    }
    var device = null;
    var buffers = [];
    var lost = false;
    var abandoned = false; // set once we stop waiting; a device that turns up later is destroyed
    var result = { gbs: null, gflops: null, ms: 0 };
    var t0 = U.now();

    function cleanup() {
      abandoned = true;
      for (var i = 0; i < buffers.length; i++) { try { buffers[i].destroy(); } catch (e) { /* ignore */ } }
      buffers = [];
      try { if (device) { device.destroy(); } } catch (e2) { /* ignore */ }
      device = null;
    }

    function makeBuffer(size, usage) {
      var b = device.createBuffer({ size: size, usage: usage });
      buffers.push(b);
      return b;
    }

    // Resolves { reps, secs } for the longest timed batch; rejects once the device is gone.
    function timeDispatches(pipeline, bindGroup, x, y) {
      function submit(n) {
        if (!device || lost) { return Promise.reject(new Error('device gone')); }
        var enc = device.createCommandEncoder();
        for (var r = 0; r < n; r++) {
          var pass = enc.beginComputePass();
          pass.setPipeline(pipeline);
          pass.setBindGroup(0, bindGroup);
          pass.dispatchWorkgroups(x, y, 1);
          pass.end();
        }
        device.queue.submit([enc.finish()]);
        return device.queue.onSubmittedWorkDone();
      }
      function batch(n) {
        var start = U.now();
        return submit(n).then(function () {
          var ms = U.now() - start;
          if (ms >= GPU_MIN_MS || n >= GPU_MAX_REPS) { return { reps: n, secs: ms / 1000 }; }
          return batch(Math.min(n * 2, GPU_MAX_REPS));
        });
      }
      // Warm-up compiles the pipeline and wakes the GPU from idle clocks.
      return submit(1).then(function () { return batch(1); });
    }

    var reqP;
    try { reqP = Promise.resolve(adapter.requestDevice()); } catch (e) { return Promise.resolve(null); }
    // requestDevice can resolve after we gave up (timeout below); release that device at once.
    reqP.then(function (d) {
      if (abandoned && d) { try { d.destroy(); } catch (e) { /* ignore */ } }
    }, function () { /* ignore */ });

    var chain = U.withTimeout(reqP, 2000, null).then(function (dev) {
      if (!dev) { abandoned = true; return null; }
      if (abandoned) { return null; } // already destroyed by the handler above
      device = dev;
      try {
        if (dev.lost && dev.lost.then) { dev.lost.then(function () { lost = true; }); }
      } catch (e) { /* ignore */ }

      // No requiredLimits are requested, so the device has the default limits
      // (128 MiB storage binding, 65535 workgroups per dimension); dev.limits reports them.
      // Bandwidth: copy a buffer of up to 64 MB within those limits.
      var lim = dev.limits || {};
      var maxBind = Math.min(lim.maxStorageBufferBindingSize || 134217728, lim.maxBufferSize || 268435456);
      var size = Math.min(64 * 1024 * 1024, Math.floor(maxBind / 16) * 16);
      var vecs = size / 16;
      var groups = Math.ceil(vecs / 256);
      var maxDim = lim.maxComputeWorkgroupsPerDimension || 65535;
      var gx = Math.min(groups, maxDim);
      var gy = Math.ceil(groups / gx);
      var src = makeBuffer(size, GPUBufferUsage.STORAGE);
      var dst = makeBuffer(size, GPUBufferUsage.STORAGE);
      var copyPipe = dev.createComputePipeline({ layout: 'auto', compute: { module: dev.createShaderModule({ code: COPY_WGSL }), entryPoint: 'main' } });
      var copyBind = dev.createBindGroup({ layout: copyPipe.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer: src } }, { binding: 1, resource: { buffer: dst } }] });
      return timeDispatches(copyPipe, copyBind, gx, gy).then(function (t) {
        if (lost || !device) { return null; }
        if (t.secs > 0) { result.gbs = (size * 2 * t.reps) / t.secs / 1e9; }
        // Compute: 256K threads × FMA_ITERS × 2 FMAs × 4 lanes × 2 FLOPs (~1 GFLOP per dispatch).
        var fGroups = Math.min(1024, maxDim);
        var threads = fGroups * 256;
        var out = makeBuffer(threads * 16, GPUBufferUsage.STORAGE);
        var fmaPipe = dev.createComputePipeline({ layout: 'auto', compute: { module: dev.createShaderModule({ code: FMA_WGSL }), entryPoint: 'main' } });
        var fmaBind = dev.createBindGroup({ layout: fmaPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: out } }] });
        return timeDispatches(fmaPipe, fmaBind, fGroups, 1).then(function (t2) {
          if (!lost && t2.secs > 0) { result.gflops = (threads * FMA_ITERS * 2 * 4 * 2 * t2.reps) / t2.secs / 1e9; }
          result.ms = U.now() - t0;
          return result.gbs ? result : null;
        });
      });
    });

    return U.withTimeout(chain, 4500, null).then(function (r) { cleanup(); return r; }, function () { cleanup(); return null; });
  }

  LAC.bench = { cpu: cpu, gpu: gpu, REF_MS: REF_MS };
})(window.LAC = window.LAC || {});
