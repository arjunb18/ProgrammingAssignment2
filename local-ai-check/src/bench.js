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
  // Samples are ~10 ms so browsers that coarsen timers to 1 ms still measure within ~10%.
  var REF_MS = 11;
  var N = 96;
  var ROUNDS = 8;

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

  function cpu() {
    if (typeof Float32Array === 'undefined') { return Promise.resolve(null); }
    var a = new Float32Array(N * N), b = new Float32Array(N * N), c = new Float32Array(N * N);
    for (var i = 0; i < N * N; i++) { a[i] = (i % 7) * 0.1; b[i] = (i % 5) * 0.2; }
    var samples = [];
    var start = U.now();

    function runChunk() {
      // Warm-up round is discarded; then take the fastest of several rounds (least disturbed).
      var t0 = U.now();
      for (var r = 0; r < ROUNDS; r++) { matmulRound(a, b, c); }
      var dt = U.now() - t0;
      samples.push(dt);
      if (samples.length < 10 && U.now() - start < 900) {
        return U.nextTick(0).then(runChunk);
      }
      return null;
    }

    return U.nextTick(0).then(runChunk).then(function () {
      samples.shift();
      var best = Infinity;
      for (var s = 0; s < samples.length; s++) { if (samples[s] > 0 && samples[s] < best) { best = samples[s]; } }
      if (!isFinite(best)) { best = 1; } // timers can be coarsened to 1 ms or more
      var score = Math.max(0.05, Math.min(8, REF_MS / Math.max(best, 0.5)));
      return U.nextTick(0).then(function () {
        return { score: score, memBandwidthGBs: copyBandwidth(), ms: U.now() - start };
      });
    }, function () { return null; });
  }

  // Lower-bound memory bandwidth from large typed-array copies (single thread).
  function copyBandwidth() {
    var sizes = [4 * 1024 * 1024, 1024 * 1024]; // doubles: 32 MB, then 8 MB if allocation fails
    for (var s = 0; s < sizes.length; s++) {
      try {
        var src = new Float64Array(sizes[s]), dst = new Float64Array(sizes[s]);
        for (var i = 0; i < sizes[s]; i += 512) { src[i] = i; }
        dst.set(src);
        var best = Infinity;
        for (var r = 0; r < 4; r++) {
          var t0 = U.now();
          dst.set(src);
          var dt = U.now() - t0;
          if (dt > 0 && dt < best) { best = dt; }
        }
        if (!isFinite(best)) { return null; }
        var bytes = sizes[s] * 8 * 2; // read + write
        return U.round(bytes / (best / 1000) / 1e9, 1);
      } catch (e) { /* try a smaller buffer */ }
    }
    return null;
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

  function gpu(adapter) {
    if (!adapter || typeof adapter.requestDevice !== 'function' || typeof GPUBufferUsage === 'undefined') {
      return Promise.resolve(null);
    }
    var device = null;
    var buffers = [];
    var lost = false;
    var result = { gbs: null, gflops: null, ms: 0 };
    var t0 = U.now();

    function cleanup() {
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

    function timeDispatches(pipeline, bindGroup, x, y, reps) {
      function submit(n) {
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
      // Warm-up compiles the pipeline and wakes the GPU from idle clocks.
      return submit(2).then(function () {
        var start = U.now();
        return submit(reps).then(function () { return (U.now() - start) / 1000; });
      });
    }

    var chain = U.withTimeout(adapter.requestDevice(), 2000, null).then(function (dev) {
      if (!dev) { return null; }
      device = dev;
      try {
        if (dev.lost && dev.lost.then) { dev.lost.then(function () { lost = true; }); }
      } catch (e) { /* ignore */ }

      // Bandwidth: copy a buffer of up to 64 MB (bounded by the adapter's binding limit).
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
      var reps = 10;
      return timeDispatches(copyPipe, copyBind, gx, gy, reps).then(function (secs) {
        if (lost) { return null; }
        if (secs > 0) { result.gbs = (size * 2 * reps) / secs / 1e9; }
        // Compute: 1M threads × FMA_ITERS × 2 FMAs × 4 lanes × 2 FLOPs.
        var threads = 4096 * 256;
        var out = makeBuffer(threads * 16, GPUBufferUsage.STORAGE);
        var fmaPipe = dev.createComputePipeline({ layout: 'auto', compute: { module: dev.createShaderModule({ code: FMA_WGSL }), entryPoint: 'main' } });
        var fmaBind = dev.createBindGroup({ layout: fmaPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: out } }] });
        var fReps = 8;
        return timeDispatches(fmaPipe, fmaBind, 4096, 1, fReps).then(function (s2) {
          if (!lost && s2 > 0) { result.gflops = (threads * FMA_ITERS * 2 * 4 * 2 * fReps) / s2 / 1e9; }
          result.ms = U.now() - t0;
          return result.gbs ? result : null;
        });
      });
    });

    return U.withTimeout(chain, 4500, null).then(function (r) { cleanup(); return r; }, function () { cleanup(); return null; });
  }

  LAC.bench = { cpu: cpu, gpu: gpu, REF_MS: REF_MS };
})(window.LAC = window.LAC || {});
