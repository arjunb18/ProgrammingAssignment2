// Estimator checks against published real-world numbers, plus structural invariants.
import { loadLAC } from './load.mjs';

const L = loadLAC(['util.js', 'data/models.js', 'data/gpus.js', 'estimate.js']);
const gpu = (name) => L.GPUS.find((g) => g.name === name) || L.GPUS.find((g) => g.name.startsWith(name + ' (')) || (() => { throw new Error('no GPU ' + name); })();
const model = (re) => L.MODELS.find((m) => re.test(m.name)) || (() => { throw new Error('no model ' + re); })();

function device({ gpuName, ram, form = 'desktop', os = 'windows', cores = 8, score = 1.5, webgpu = true, f16 = true, threads = false }) {
  return {
    ua: { formFactor: form, os },
    cpu: { cores, score },
    memory: { estimatedGB: ram },
    gpu: { entry: gpuName ? gpu(gpuName) : null },
    webgpu: { available: webgpu, isFallback: false, shaderF16: f16 },
    wasm: { supported: true, simd: true, threads, crossOriginIsolated: threads },
    storage: { quotaGB: 100 },
  };
}

const RTX4090 = { gpuName: 'NVIDIA GeForce RTX 4090', ram: 64 };
const RTX3060 = { gpuName: 'NVIDIA GeForce RTX 3060 12GB', ram: 32 };
const RTX4060L = { gpuName: 'NVIDIA GeForce RTX 4060 Laptop', ram: 16 };
const GTX1060 = { gpuName: 'NVIDIA GeForce GTX 1060 6GB', ram: 16, cores: 4, score: 1.0, f16: false };
const M2ULTRA = { gpuName: 'Apple M2 Ultra', ram: 192, os: 'mac' };
const CHROMEBOOK = { gpuName: 'Intel UHD Graphics', ram: 4, os: 'chromeos', cores: 2, score: 0.5, f16: false };
const BUDGET_ANDROID = { gpuName: 'Arm Mali-G52', ram: 4, form: 'phone', os: 'android', cores: 8, score: 0.4, webgpu: false };
const TWO_CORE = { ram: 12, cores: 2, score: 0.8, os: 'linux' };

// [label, device, model regex, expected verdict, [min, max] speed in the verdict's unit or null,
//  optional { target, placement, reason: RegExp }]
const ANCHORS = [
  ['RTX 4090 + Llama 3.1 8B (measured ~130-150 tok/s)', RTX4090, /^Llama 3\.1 8B/, 'well', [125, 170]],
  ['M2 base 16 GB + Llama 3.1 8B (measured ~12-15 tok/s)', { gpuName: 'Apple M2', ram: 16, os: 'mac' }, /^Llama 3\.1 8B/, 'well', [10, 18]],
  ['M4 Max 128 GB + Llama 3.3 70B (measured ~8-10 tok/s)', { gpuName: 'Apple M4 Max (40-core GPU; 32-core bin 410 GB/s)', ram: 128, os: 'mac' }, /^Llama 3\.3 70B/, 'slow', [6, 12]],
  ['iPhone 16 Pro + Llama 3.2 3B (measured ~14 tok/s)', { gpuName: 'Apple A18 Pro', ram: 8, form: 'phone', os: 'ios', cores: 6 }, /^Llama 3\.2 3B/, 'well', [10, 25]],
  ['RTX 4090 + gpt-oss-120b (MoE, needs RAM offload)', RTX4090, /^gpt-oss-120b/, 'well', [10, 60]],
  // llama.cpp tg128, gpt-oss MXFP4 (ggml-org/llama.cpp discussion #15396): fixed per-token cost + MoE reads.
  ['RTX 4090 + gpt-oss-20b (measured 225 tok/s)', RTX4090, /^gpt-oss-20b/, 'well', [180, 280]],
  ['M2 Ultra + gpt-oss-20b (measured 116 tok/s)', M2ULTRA, /^gpt-oss-20b/, 'well', [90, 150]],
  ['M2 Ultra + gpt-oss-120b (measured 80 tok/s)', M2ULTRA, /^gpt-oss-120b/, 'well', [60, 120]],
  // gpt-oss-20b is built for 16 GB: the 12.1 GB MXFP4 file plus Mac layers spilling to the CPU side.
  ['M2 Pro 16 GB + gpt-oss-20b (fits, tightly)', { gpuName: 'Apple M2 Pro', ram: 16, os: 'mac' }, /^gpt-oss-20b/, 'slow', [5, 60]],
  ['Snapdragon X Elite 16 GB + gpt-oss-20b (fits, tightly)', { gpuName: 'Qualcomm Adreno X1-85', ram: 16, cores: 12 }, /^gpt-oss-20b/, 'slow', [5, 60]],
  ['8 GB laptop, no GPU + Llama 3.1 70B', { ram: 8, cores: 4, score: 0.8 }, /^Llama 3\.3 70B/, 'no', null],
  // Writes quickly, but reading a 1,000-token prompt on 4 slow cores takes ~40 s (llama.cpp pp rates).
  ['8 GB laptop, no GPU + Qwen3 1.7B (slow to read long prompts)', { ram: 8, cores: 4, score: 0.8 }, /^Qwen3 1\.7B/, 'slow', [10, 60], { reason: /before the reply starts/ }],
  ['Chromebook 4 GB (2 cores) + Llama 3.2 1B', CHROMEBOOK, /^Llama 3\.2 1B/, 'slow', null, { reason: /before the reply starts/ }],
  ['Chromebook 4 GB + all-MiniLM (embeddings are not demoted for prompt reading)', CHROMEBOOK, /^all-MiniLM/, 'well', null],
  // Diffusion: seconds per image. Mid-range NVIDIA cards run closer to peak than the 4090 calibration.
  ['RTX 3060 12 GB + FLUX.1 dev (≈ 60-90 s/image)', RTX3060, /FLUX\.1 \[dev\]/, 'slow', [60, 120]],
  ['RTX 3060 12 GB + SDXL (≈ 20 s/image)', RTX3060, /Stable Diffusion XL/, 'well', [15, 30]],
  ['RTX 4090 + SDXL (≈ 4-5 s/image)', RTX4090, /Stable Diffusion XL/, 'well', [3, 7]],
  // 8 GB cards run FLUX/Wan (FP8/GGUF or offload); they must never fall back to a CPU time.
  ['RTX 4060 Laptop 8 GB + FLUX.1 dev (NF4 ≈ 45-60 s/image)', RTX4060L, /FLUX\.1 \[dev\]/, 'slow', [40, 150], { placement: 'gpu' }],
  ['RTX 4060 Laptop 8 GB + SDXL (≈ 15-20 s/image)', RTX4060L, /Stable Diffusion XL/, 'well', [10, 30]],
  ['RTX 4060 Laptop 8 GB + Wan 2.1 1.3B (8.19 GB VRAM)', RTX4060L, /^Wan 2\.1/, 'slow', [300, 3600], { placement: 'gpu' }],
  ['RTX 4060 Laptop 8 GB + SD 3.5 Large (offloads part to RAM)', RTX4060L, /Stable Diffusion 3\.5 Large/, 'slow', [30, 300], { placement: 'split', reason: /system memory/ }],
  ['GTX 1060 6 GB + SDXL (runs on the card)', GTX1060, /Stable Diffusion XL/, 'slow', [30, 150], { placement: 'gpu' }],
  ['GTX 1060 6 GB + FLUX.1 dev (needs more VRAM, not a CPU time)', GTX1060, /FLUX\.1 \[dev\]/, 'no', null, { reason: /graphics memory \(VRAM\); your graphics card has about 6 GB/ }],
  // Speech: real-time factor.
  ['M1 8 GB + whisper large-v3-turbo', { gpuName: 'Apple M1', ram: 8, os: 'mac' }, /Whisper large-v3-turbo/, 'well', null],
  ['M1 8 GB + Kokoro', { gpuName: 'Apple M1', ram: 8, os: 'mac' }, /^Kokoro/, 'well', [3, 60]],
  ['2-core CPU + Kokoro (measured 0.87× real time)', TWO_CORE, /^Kokoro/, 'slow', [0.4, 1.5]],
  ['2-core CPU + Piper (measured 8.3× real time)', TWO_CORE, /^Piper/, 'well', [4, 16]],
  ['Budget Android 4 GB, WebAssembly + Kokoro (single-threaded)', BUDGET_ANDROID, /^Kokoro/, 'no', null, { target: 'browser' }],
  // WebLLM q4f16-only builds need shader-f16.
  ['GTX 1060 (no shader-f16) + Gemma 3 1B in the browser', GTX1060, /^Gemma 3 1B$/, 'no', null, { target: 'browser', reason: /shader-f16/ }],
];

// Pull "Needs about X GB … about Y GB" out of a won't-run reason.
function gb(s) { const m = s.match(/^([\d.]+) (MB|GB|TB)$/); return m ? +m[1] * (m[2] === 'MB' ? 0.001 : m[2] === 'TB' ? 1000 : 1) : NaN; }

export default function test(assert) {
  for (const [label, d, re, want, range, extra = {}] of ANCHORS) {
    const b = L.estimate.budget(device(d));
    const v = L.estimate.classify(model(re), b, extra.target || 'native');
    assert.equal(v.verdict, want, `${label}: verdict (${v.reason})`);
    if (range) {
      assert.ok(v.speed && v.speed.value >= range[0] && v.speed.value <= range[1],
        `${label}: ${v.speed ? v.speed.value.toFixed(1) + ' ' + v.speed.unit : 'no speed'} within ${range}`);
    }
    if (extra.placement) assert.equal(v.placement, extra.placement, `${label}: placement`);
    if (extra.reason) assert.ok(extra.reason.test(v.reason), `${label}: reason "${v.reason}" matches ${extra.reason}`);
  }

  // Single-threaded WebAssembly (no cross-origin isolation) gets one core's compute, not all of them.
  {
    const st = L.estimate.budget(device({ ram: 16, cores: 8, webgpu: false }));
    const mt = L.estimate.budget(device({ ram: 16, cores: 8, webgpu: false, threads: true }));
    assert.ok(Math.abs(st.browser.tflops - st.native.cpuTflops / 8 * 0.6) < 1e-9, `WASM single-thread TFLOPS ${st.browser.tflops}`);
    assert.ok(mt.browser.tflops > st.browser.tflops * 2 && mt.browser.bwGBs > st.browser.bwGBs, 'WASM threads add compute and bandwidth');
  }
  // Macs spill past the GPU's share to the CPU side; iPhones cannot.
  {
    const mac = L.estimate.budget(device({ gpuName: 'Apple M2 Pro', ram: 16, os: 'mac' }));
    assert.ok(mac.native.spillGB > 1 && mac.native.spillBwGBs > 0, `Mac spill pool ${mac.native.spillGB}`);
    const ph = L.estimate.budget(device({ gpuName: 'Apple A18 Pro', ram: 8, form: 'phone', os: 'ios', cores: 6 }));
    assert.equal(ph.native.spillGB, 0, 'no spill pool on iPhone');
  }
  // WebLLM: without shader-f16 only q4f32 builds count.
  assert.equal(L.estimate.webllmBuild(model(/^Gemma 3 1B$/), false), null, 'Gemma 3 1B has no q4f32 build');
  assert.ok(L.estimate.webllmBuild(model(/^Llama 3\.2 1B/), false).id.indexOf('q4f32') >= 0, 'Llama 3.2 1B falls back to q4f32');
  // Natively 4-bit models (gpt-oss) do not advertise a "better 8-bit build".
  assert.equal(L.estimate.classify(model(/^gpt-oss-20b/), L.estimate.budget(device(RTX4090)), 'native').q8, null, 'gpt-oss-20b: no 8-bit note');
  // Curated flags for the headline's best pick.
  assert.equal(model(/^Florence-2/).chat, false, 'Florence-2 is not a chat model');
  assert.equal(model(/^Moondream/).chat, false, 'Moondream is not a chat model');
  assert.equal(model(/^Ternary Bonsai/).needsFork, true, 'Ternary Bonsai needs a llama.cpp fork');
  for (const re of [/^Llama 3\.1 8B/, /^Qwen3 8B/, /^gpt-oss-20b/, /^Gemma 3 4B/]) {
    const m = model(re);
    assert.ok(m.chat !== false && !m.needsFork, `${m.name}: mainstream chat model is not flagged`);
  }

  // Invariants over every model on a spread of devices.
  const devices = [
    device(RTX4090),
    device({ gpuName: 'Apple M2', ram: 8, os: 'mac' }),
    device({ gpuName: 'Apple M2 Pro', ram: 16, os: 'mac' }),
    device({ ram: 4, form: 'phone', os: 'android', cores: 8, score: 0.5, webgpu: false }),
    device({ gpuName: 'Arm Mali-G52', ram: 8, form: 'phone', os: 'android', cores: 8, score: 0.6 }),
    device({ ram: 16, webgpu: false }),
    device(RTX4060L),
    device(GTX1060),
    device(CHROMEBOOK),
  ];
  for (const d of devices) {
    const b = L.estimate.budget(d);
    for (const target of ['native', 'browser']) {
      for (const m of L.MODELS) {
        const v = L.estimate.classify(m, b, target);
        assert.ok(['well', 'slow', 'no'].includes(v.verdict), `${m.name}: verdict valid`);
        assert.ok(typeof v.reason === 'string' && v.reason.length > 10 && !/NaN|undefined|null/.test(v.reason), `${m.name} (${target}): reason "${v.reason}"`);
        if (v.speed) assert.ok(isFinite(v.speed.value) && v.speed.value > 0, `${m.name}: speed finite`);
        // A won't-run reason never says the model fits: the need is larger than what is available.
        const nf = v.verdict === 'no' && v.reason.match(/^Needs about ([\d.]+ [MGT]B) .*about ([\d.]+ [MGT]B)\.$/);
        if (nf) assert.ok(gb(nf[1]) > gb(nf[2]), `${m.name} (${target}): non-contradictory "${v.reason}"`);
        // Plain language: embeddings do not "generate", and VRAM is always introduced.
        assert.ok(!/generate/.test(v.reason), `${m.name}: no "generate" in "${v.reason}"`);
        assert.ok(!/VRAM/.test(v.reason.replace(/graphics memory \(VRAM\)/g, '')), `${m.name}: VRAM explained in "${v.reason}"`);
        if (m.modality === 'embedding' && v.verdict !== 'no') assert.ok(/processes|index/.test(v.reason), `${m.name}: embedding reason "${v.reason}"`);
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
