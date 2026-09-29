// LAC.bench: the CPU score must survive coarsened timers, stay chunked, and the WebGPU bench
// must respect device limits, keep submissions short and never leak a device.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

// Loads util.js + bench.js with performance.now() quantised to `tick` ms (0 = native).
// With `jitter`, each bucket edge moves by a random amount like Firefox's reduceTimerPrecision
// jitter: the clock still only reports multiples of `tick`, but each step from one multiple to the
// next happens at a random point of its bucket (fixed per bucket, so the clock never goes back).
function load(tick, jitter, extra) {
  const edge = new Map();
  const edgeOf = (k) => { if (!edge.has(k)) edge.set(k, Math.random() * tick); return edge.get(k); };
  const now = () => {
    const t = performance.now();
    if (!tick) return t;
    const k = Math.floor(t / tick);
    if (!jitter) return k * tick;
    return (t - k * tick >= edgeOf(k) ? k : k - 1) * tick;
  };
  const ctx = vm.createContext(Object.assign({ window: {}, console, setTimeout, clearTimeout, Promise, Math, JSON, Date,
    performance: { now }, Float32Array, Float64Array, isFinite }, extra || {}));
  for (const f of ['util.js', 'bench.js']) vm.runInContext(readFileSync(join(src, f), 'utf8'), ctx, { filename: f });
  return ctx.window.LAC;
}

// Longest stretch the main thread went without running a timer (blocking chunk length).
function watchBlocking() {
  let max = 0, prev = performance.now(), stop = false;
  (function tick() {
    const t = performance.now();
    max = Math.max(max, t - prev); prev = t;
    if (!stop) setTimeout(tick, 1);
  })();
  return () => { stop = true; return max; };
}

function fakeAdapter(opts) {
  const log = { buffers: [], dispatches: [], batchesMs: [], destroyed: false, created: false };
  const limits = opts.limits || {};
  const device = {
    limits,
    lost: new Promise(() => {}),
    destroy() { log.destroyed = true; },
    createBuffer(d) { log.buffers.push(d.size); return { destroy() {} }; },
    createShaderModule(d) { return { code: d.code }; },
    createComputePipeline(d) { return { fma: /fma/.test(d.compute.module.code), getBindGroupLayout() { return {}; } }; },
    createBindGroup() { return {}; },
    createCommandEncoder() {
      const passes = [];
      return {
        beginComputePass() {
          const p = { pipe: null, setPipeline(x) { p.pipe = x; }, setBindGroup() {},
            dispatchWorkgroups(x, y, z) { log.dispatches.push([x, y, z]); passes.push(p); }, end() {} };
          return p;
        },
        finish() { return passes; },
      };
    },
    queue: {
      pending: 0,
      submit(cmds) {
        const passes = cmds[0];
        const ms = passes.reduce((s, p) => s + (p.pipe.fma ? opts.fmaMs : opts.copyMs), 0);
        log.batchesMs.push(ms);
        device.queue.pending = ms;
      },
      onSubmittedWorkDone() { const ms = device.queue.pending; return new Promise((r) => setTimeout(r, ms)); },
    },
  };
  const adapter = {
    requestDevice() {
      return new Promise((res) => setTimeout(() => { log.created = true; res(device); }, opts.deviceDelay || 0));
    },
  };
  return { adapter, log };
}

export default async function test(assert) {
  // ---- CPU: same score whatever the timer resolution, in UI-friendly chunks.
  const L0 = load(0);
  const nativeRes = await L0.bench.cpu();
  assert.ok(nativeRes && nativeRes.score > 0, 'cpu bench returns a score with a native timer');
  assert.equal(nativeRes.memBandwidthGBs, null, 'memBandwidthGBs is kept in the result but not measured');
  const native = nativeRes.score;
  for (const [tick, jitter] of [[1, false], [16.67, false], [100, false], [100, true]]) {
    const stopWatch = watchBlocking();
    const r = await load(tick, jitter).bench.cpu();
    const blocked = stopWatch();
    const ratio = r.score / native;
    assert.ok(ratio > 0.6 && ratio < 1.6,
      `cpu score with a ${tick} ms${jitter ? ' jittered' : ''} timer (${r.score.toFixed(2)}) is close to native (${native.toFixed(2)})`);
    assert.ok(r.ms < 1300, `cpu bench with a ${tick} ms timer finishes in time (${Math.round(r.ms)} ms)`);
    // One chunk may span one alignment tick plus one measured tick.
    const allowed = Math.max(80, 2 * tick + 60);
    assert.ok(blocked < allowed, `cpu bench with a ${tick} ms timer yields to the UI (longest block ${Math.round(blocked)} ms)`);
  }
  // A frozen clock gives no score instead of a made-up one.
  {
    const ctx = { performance: { now: () => 5 } };
    const r = await load(0, false, ctx).bench.cpu();
    assert.equal(r, null, 'cpu bench with a frozen clock returns null');
  }

  // ---- GPU: a device that arrives after the requestDevice timeout is destroyed.
  {
    const { adapter, log } = fakeAdapter({ deviceDelay: 2300, copyMs: 1, fmaMs: 1 });
    const L = load(0, false, { GPUBufferUsage: { STORAGE: 128 } });
    const r = await L.bench.gpu(adapter);
    await new Promise((res) => setTimeout(res, 500));
    assert.equal(r, null, 'gpu bench gives up on a slow requestDevice');
    assert.ok(log.created && log.destroyed, 'late GPUDevice is destroyed');
  }

  // ---- GPU: a weak GPU never gets a batch anywhere near 500 ms, and limits are respected.
  {
    const limits = { maxStorageBufferBindingSize: 32 * 1024 * 1024, maxBufferSize: 256 * 1024 * 1024, maxComputeWorkgroupsPerDimension: 1000 };
    const { adapter, log } = fakeAdapter({ limits, copyMs: 60, fmaMs: 90 });
    const L = load(0, false, { GPUBufferUsage: { STORAGE: 128 } });
    const r = await L.bench.gpu(adapter);
    assert.ok(r && r.gbs > 0 && r.gflops > 0, 'gpu bench returns rates on a weak GPU');
    assert.ok(Math.max(...log.batchesMs) < 500, `weak GPU: longest batch ${Math.max(...log.batchesMs)} ms < 500 ms`);
    assert.ok(log.buffers.every((s) => s <= limits.maxStorageBufferBindingSize), 'buffers fit maxStorageBufferBindingSize');
    assert.ok(log.dispatches.every(([x, y, z]) => x <= 1000 && y <= 1000 && z <= 1000), 'dispatches fit maxComputeWorkgroupsPerDimension');
    // 32 MiB copied as vec4 with 256 threads per group must still be fully covered.
    const copy = log.dispatches.find(([x, y]) => y > 1);
    assert.ok(copy && copy[0] * copy[1] * 256 * 16 >= limits.maxStorageBufferBindingSize, 'copy dispatch covers the whole buffer');
    assert.ok(log.destroyed, 'device destroyed after the weak-GPU run');
  }

  // ---- GPU: a fast GPU gets more repetitions (enough work to time) but a bounded count.
  {
    const { adapter, log } = fakeAdapter({ copyMs: 0.5, fmaMs: 0.5 });
    const L = load(0, false, { GPUBufferUsage: { STORAGE: 128 } });
    const r = await L.bench.gpu(adapter);
    assert.ok(r && r.gbs > 0, 'gpu bench returns a rate on a fast GPU');
    assert.ok(log.dispatches.length > 20 && log.dispatches.length < 400, `fast GPU: reps scale up but stay bounded (${log.dispatches.length} dispatches)`);
    assert.ok(log.destroyed, 'device destroyed after the fast-GPU run');
  }
}
