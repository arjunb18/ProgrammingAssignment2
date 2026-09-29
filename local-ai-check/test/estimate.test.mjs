// Estimator checks against published real-world numbers, plus structural invariants.
import { loadLAC } from './load.mjs';

const L = loadLAC(['util.js', 'data/models.js', 'data/gpus.js', 'estimate.js']);
const gpu = (name) => L.GPUS.find((g) => g.name === name) || (() => { throw new Error('no GPU ' + name); })();
const model = (re) => L.MODELS.find((m) => re.test(m.name)) || (() => { throw new Error('no model ' + re); })();

function device({ gpuName, ram, form = 'desktop', os = 'windows', cores = 8, score = 1.5, webgpu = true, f16 = true }) {
  return {
    ua: { formFactor: form, os },
    cpu: { cores, score },
    memory: { estimatedGB: ram },
    gpu: { entry: gpuName ? gpu(gpuName) : null },
    webgpu: { available: webgpu, isFallback: false, shaderF16: f16 },
    wasm: { supported: true, simd: true, threads: false, crossOriginIsolated: false },
    storage: { quotaGB: 100 },
  };
}

// [label, device, model regex, expected verdict, [min tok/s, max tok/s] or null]
const ANCHORS = [
  ['RTX 4090 + Llama 3.1 8B (measured ~130-150 tok/s)', { gpuName: 'NVIDIA GeForce RTX 4090', ram: 64 }, /^Llama 3\.1 8B/, 'well', [100, 180]],
  ['M2 base 16 GB + Llama 3.1 8B (measured ~12-15 tok/s)', { gpuName: 'Apple M2', ram: 16, os: 'mac' }, /^Llama 3\.1 8B/, 'well', [10, 18]],
  ['M4 Max 128 GB + Llama 3.3 70B (measured ~8-10 tok/s)', { gpuName: 'Apple M4 Max (40-core GPU; 32-core bin 410 GB/s)', ram: 128, os: 'mac' }, /^Llama 3\.3 70B/, 'slow', [6, 12]],
  ['iPhone 16 Pro + Llama 3.2 3B (measured ~14 tok/s)', { gpuName: 'Apple A18 Pro (iPhone 16 Pro / Pro Max)', ram: 8, form: 'phone', os: 'ios', cores: 6 }, /^Llama 3\.2 3B/, 'well', [10, 25]],
  ['RTX 4090 + gpt-oss-120b (MoE, needs RAM offload)', { gpuName: 'NVIDIA GeForce RTX 4090', ram: 64 }, /^gpt-oss-120b/, 'well', [10, 60]],
  ['8 GB laptop, no GPU + Llama 3.1 70B', { ram: 8, cores: 4, score: 0.8 }, /^Llama 3\.3 70B/, 'no', null],
  ['8 GB laptop, no GPU + Qwen3 1.7B', { ram: 8, cores: 4, score: 0.8 }, /^Qwen3 1\.7B/, 'well', [10, 60]],
  ['RTX 3060 12 GB + FLUX.1 dev (≈ 60-90 s/image)', { gpuName: 'NVIDIA GeForce RTX 3060 12GB', ram: 32 }, /FLUX\.1 \[dev\]/, 'slow', null],
  ['RTX 4090 + SDXL (≈ 4-5 s/image)', { gpuName: 'NVIDIA GeForce RTX 4090', ram: 64 }, /Stable Diffusion XL/, 'well', null],
  ['M1 8 GB + whisper large-v3-turbo', { gpuName: 'Apple M1', ram: 8, os: 'mac' }, /Whisper large-v3-turbo/, 'well', null],
];

export default function test(assert) {
  for (const [label, d, re, want, range] of ANCHORS) {
    const b = L.estimate.budget(device(d));
    const v = L.estimate.classify(model(re), b, 'native');
    assert.equal(v.verdict, want, `${label}: verdict (${v.reason})`);
    if (range && v.speed) {
      assert.ok(v.speed.value >= range[0] && v.speed.value <= range[1], `${label}: ${v.speed.value.toFixed(1)} tok/s within ${range}`);
    }
  }

  // Invariants over every model on a spread of devices.
  const devices = [
    device({ gpuName: 'NVIDIA GeForce RTX 4090', ram: 64 }),
    device({ gpuName: 'Apple M2', ram: 8, os: 'mac' }),
    device({ ram: 4, form: 'phone', os: 'android', cores: 8, score: 0.5, webgpu: false }),
    device({ ram: 16, webgpu: false }),
  ];
  for (const d of devices) {
    const b = L.estimate.budget(d);
    for (const target of ['native', 'browser']) {
      for (const m of L.MODELS) {
        const v = L.estimate.classify(m, b, target);
        assert.ok(['well', 'slow', 'no'].includes(v.verdict), `${m.name}: verdict valid`);
        assert.ok(typeof v.reason === 'string' && v.reason.length > 10 && !/NaN|undefined|null/.test(v.reason), `${m.name} (${target}): reason "${v.reason}"`);
        if (v.speed) assert.ok(isFinite(v.speed.value) && v.speed.value > 0, `${m.name}: speed finite`);
      }
    }
  }

  // More memory never makes a model run worse.
  const rank = { no: 0, slow: 1, well: 2 };
  for (const m of L.MODELS) {
    let prev = -1;
    for (const ram of [4, 8, 16, 32, 64, 128]) {
      const v = L.estimate.classify(m, L.estimate.budget(device({ ram, webgpu: false })), 'native');
      assert.ok(rank[v.verdict] >= prev, `${m.name}: monotonic in RAM (${ram} GB → ${v.verdict})`);
      prev = rank[v.verdict];
    }
  }
}
