# Can It Run Local AI? — architecture

A static, client-side web page. It inspects the visiting device, estimates what
open-weight AI models it can run locally, and sorts them into **Runs well**,
**Runs slowly** and **Won't run**. Nothing is uploaded; there is no server.

## Hard requirements

1. **Works on any visiting device.** Every script file is **ES5 syntax**
   (`var`, `function`, no arrow functions, template literals, classes,
   destructuring, spread, `let/const`, `async/await`, optional chaining,
   `**`). `npm test` parses every script with acorn `ecmaVersion: 5` and fails
   otherwise. Modern APIs (Promise, WebGPU, WebAssembly, BigInt, fetch…) are
   only touched behind feature checks and inside `try/catch`. If `Promise`
   is missing, the app runs the synchronous probes only and still renders
   results.
2. **Never hangs, never throws to the top.** Every async probe has a timeout
   (`LAC.util.withTimeout`). Each probe failure is recorded in
   `device.notes` and the pipeline continues. Total scan budget ≤ 6 s on a
   mid-range phone.
3. **Single file output.** `node build.mjs` inlines CSS and JS into
   `docs/index.html` (full HTML document, GitHub Pages ready) and
   `dist/artifact.html` (same content without doctype/html/head/body
   wrapper, for claude.ai Artifact publishing). No runtime network requests
   except the optional Google Fonts stylesheet.
4. **Works without JavaScript**: `<noscript>` explains what the page needs.
5. **Accessible and responsive**: 320 px → 2560 px, keyboard operable,
   `prefers-reduced-motion`, light + dark themes via tokens.

## Files

```
local-ai-check/
  build.mjs                 # inlines src → docs/index.html + dist/artifact.html
  package.json              # "test": node test/run.mjs (acorn ES5 check + unit + e2e)
  src/
    index.template.html     # markup; placeholders <!--STYLE--> and <!--SCRIPTS-->
    styles.css
    util.js                 # LAC namespace + helpers           (load order 1)
    data/models.js          # LAC.MODELS                         (2)
    data/gpus.js            # LAC.GPUS + LAC.matchGpu()          (3)
    data/runtimes.js        # LAC.RUNTIMES, LAC.WEBLLM_MODELS    (4)
    detect.js               # LAC.detect()                       (5)
    bench.js                # LAC.bench                          (6)
    estimate.js             # LAC.estimate                       (7)
    ui.js                   # LAC.ui                             (8)
    main.js                 # boots the app                      (9)
  test/
    run.mjs                 # runs all tests
    es5.test.mjs            # acorn ecmaVersion 5 parse of every src/*.js
    estimate.test.mjs       # unit tests of estimate.js with fixture devices
    gpus.test.mjs           # renderer-string → GPU entry matching tests
    e2e.test.mjs            # Playwright (Chromium) under emulated devices
docs/index.html             # built output served by GitHub Pages (repo root /docs)
```

Every JS file is wrapped as `(function (LAC) { 'use strict'; ... })(window.LAC = window.LAC || {});`
(data files may use the same wrapper). Node tests load files with `vm` by
providing a fake `window` object, so modules must not touch `document` or
`navigator` at load time — only inside functions.

## `util.js` — `LAC.util`

```
LAC.util = {
  withTimeout(promise, ms, fallbackValue) -> Promise   // resolves fallbackValue on timeout/reject
  now() -> number                                      // performance.now() or Date.now()
  round(x, digits) -> number
  fmtGB(gb) -> string                                  // "0.8 GB", "12 GB", "1.2 TB"
  fmtRate(tps) -> string                               // "~35 tok/s", "<1 tok/s"
  esc(str) -> string                                   // HTML escape
  storage: { get(key), set(key, value) }               // localStorage JSON wrapper, try/catch, never throws
  hasPromise: boolean
}
```

## Data — `LAC.MODELS` (array)

```
{
  id: 'llama-3.1-8b',            // unique, kebab-case
  name: 'Llama 3.1 8B Instruct',
  developer: 'Meta',
  family: 'Llama 3.1',
  modality: 'text'|'reasoning'|'code'|'vision-language'|'image-generation'|
            'video-generation'|'speech-to-text'|'text-to-speech'|'embedding'|'music-audio',
  kind: 'llm'|'diffusion'|'speech'|'tts'|'embedding'|'audio-gen',   // drives the estimator
  paramsB: 8.0,                  // total parameters, billions
  activeB: 8.0,                  // active per token (MoE < paramsB)
  release: '2024-07',
  license: 'Llama 3.1 Community',
  sizes: { q4: 4.9, q8: 8.5, fp16: 16.1 },   // GB on disk; null when a precision isn't distributed
  minMemGB: 6,                   // practical minimum RAM/VRAM at smallest sensible precision, 4k ctx
  contextK: 128,
  ollama: 'llama3.1:8b',         // '' if none
  browser: { webllm: 'Llama-3.1-8B-Instruct-q4f16_1-MLC', vramMB: 5295 } | null,
  // diffusion only: reference compute per image (TFLOP) at default steps/resolution
  diffusion: { tflopPerImage: 90, steps: 20, resolution: 1024 } | undefined,
  // speech only: compute per audio second (GFLOP) so RTF can be estimated
  speech: { gflopPerAudioSec: 15 } | undefined,
  notes: 'Strong general assistant; the default 8B choice.',
  tier: 'flagship'|'popular'|'niche',
  source: 'https://…'
}
```

## Data — `LAC.GPUS` (array, most specific match first) + `LAC.matchGpu(str)`

```
{ match: ['rtx 4070 laptop'], name: 'NVIDIA GeForce RTX 4070 Laptop GPU',
  vendor: 'nvidia', kind: 'discrete-desktop'|'discrete-laptop'|'integrated'|'apple-silicon'|'mobile-soc'|'datacenter',
  vramGB: 8, unifiedOptionsGB: [], bandwidthGBs: 256, fp16Tflops: 15.6, year: 2023 }
```

`LAC.matchGpu(rendererOrDescription)` lower-cases the input, strips ANGLE
wrappers (`angle (nvidia, nvidia geforce rtx 3060 direct3d11 vs_5_0 ps_5_0, d3d11)` →
`nvidia geforce rtx 3060`), `(tm)`, `(r)`, and returns the first entry whose
any `match` substring is contained, or `null`. Word-boundary aware so
`rtx 4060` does not match `rtx 4060 ti` entries wrongly (ti entries listed
first) and `m1` does not match `m1 pro`.

## Data — `LAC.RUNTIMES`, `LAC.WEBLLM_MODELS`

`LAC.RUNTIMES`: `[{ id, name, kind: 'in-browser'|'native-desktop'|'native-mobile'|'browser-built-in', url, platforms: ['windows','mac','linux','android','ios','chromeos'], handles: ['llm','diffusion',...], blurb }]`.
`LAC.WEBLLM_MODELS`: `[{ id, baseModelId (LAC.MODELS id or ''), vramMB, lowResource }]`.

## `LAC.detect(onProgress) -> Promise<Device>`

`onProgress(stepId, status, detailText)` where stepId ∈
`'browser','cpu','memory','gpu','webgpu','wasm','storage','bench-cpu','bench-gpu'`
and status ∈ `'running'|'done'|'warn'|'fail'`.

```
Device = {
  ua: { raw, browser, browserVersion, engine: 'blink'|'webkit'|'gecko'|'other',
        os: 'windows'|'mac'|'linux'|'android'|'ios'|'ipados'|'chromeos'|'other', osVersion,
        formFactor: 'phone'|'tablet'|'desktop', model: '' },
  cpu: { cores: number|null, arch: 'arm'|'x86'|null, bitness: '64'|'32'|null,
         score: number|null,              // bench: relative single-thread score, 1.0 ≈ 2020 mid laptop
         memBandwidthGBs: number|null },  // bench: measured JS copy bandwidth (lower bound)
  memory: { reportedGB: number|null,      // navigator.deviceMemory as given
            estimatedGB: number,          // best guess used for estimates
            source: 'deviceMemory'|'device-lookup'|'user'|'default',
            capped: boolean,              // reportedGB is a known cap (lower bound)
            confidence: 'high'|'medium'|'low' },
  gpu: { renderer: string, vendorString: string, name: string,
         entry: GPU|null,                 // LAC.GPUS entry
         source: 'webgpu'|'webgl'|'user'|'inferred'|'none',
         confidence: 'high'|'medium'|'low' },
  webgpu: { available: boolean, isFallback: boolean, shaderF16: boolean,
            maxBufferGB: number|null, maxStorageBindingGB: number|null,
            info: { vendor, architecture, device, description },
            benchGBs: number|null, benchGflops: number|null, error: string|null },
  webgl: { version: 0|1|2, maxTextureSize: number|null },
  wasm: { supported, simd, threads, memory64, relaxedSimd, crossOriginIsolated },
  storage: { quotaGB: number|null, usageGB: number|null },
  network: { saveData: boolean, effectiveType: string|null },
  notes: [string]                          // human-readable caveats
}
```

Stages (each wrapped in try/catch + timeout): UA parse (+ `userAgentData.getHighEntropyValues`,
1 s timeout) → CPU cores → memory → WebGL renderer → WebGPU adapter (2 s timeout) →
WASM features → storage estimate → `LAC.bench.cpu()` → `LAC.bench.gpu()` (only if WebGPU).
User overrides (`LAC.util.storage.get('overrides')` → `{ ramGB, gpuName }`) are
applied last by `LAC.applyOverrides(device, overrides)` (exported from detect.js), which
sets `source: 'user'` and confidence high.

## `LAC.bench`

```
LAC.bench.cpu() -> Promise<{ score, memBandwidthGBs, ms }>   // ≤ 1.2 s, yields to UI between chunks
LAC.bench.gpu() -> Promise<{ gbs, gflops, ms } | null>       // WebGPU only, ≤ 2 s, always destroys buffers/device
```

## `LAC.estimate`

```
LAC.estimate.budget(device) -> Budget
Budget = {
  native: {                              // an installed app (Ollama, LM Studio, MLX, PocketPal…)
    gpuMemGB, gpuBwGBs, gpuTflops,       // fast pool (VRAM, or unified GPU-addressable share); 0 if none
    cpuMemGB, cpuBwGBs, cpuTflops,       // system RAM available to a CPU runtime
    unified: boolean, label: string      // e.g. "RTX 4070 (8 GB) + 32 GB RAM"
  },
  browser: {                             // right here in this browser tab
    possible: boolean, reason: string,   // e.g. "WebGPU not available in this browser"
    memGB, bwGBs, tflops, shaderF16
  },
  assumptions: [string]
}
LAC.estimate.classify(model, budget, target: 'native'|'browser') -> Verdict
Verdict = {
  verdict: 'well'|'slow'|'no',
  precision: 'q4'|'q8'|'fp16'|null,      // what the estimate assumed
  memGB: number,                         // memory the model needs at that precision incl. overhead
  placement: 'gpu'|'split'|'cpu'|null,
  speed: { value: number, unit: 'tok/s'|'s/image'|'s/clip'|'x realtime' } | null,
  reason: string                         // one plain sentence: why this verdict
}
LAC.estimate.classifyAll(models, budget, target) -> [{ model, v: Verdict }]
LAC.estimate.THRESHOLDS                  // documented constants, surfaced in the "How we estimate" section
```

Decode speed ≈ efficiency × bandwidth ÷ bytes read per token (active params ×
bytes/param + KV reads). Memory need = weights + KV cache (4k ctx) + runtime
overhead. Split placement (GPU + CPU offload) uses time-weighted harmonic
combination. Diffusion is compute-bound: seconds ≈ tflopPerImage ÷ (tflops ×
efficiency). Speech: real-time factor from compute. Thresholds live in
`THRESHOLDS` with a comment citing the rationale.

## `LAC.ui`

```
LAC.ui.init(rootEl)                        // builds static structure, wires controls
LAC.ui.progress(stepId, status, detail)    // live probe checklist
LAC.ui.renderDevice(device, budget)        // device summary + correction controls
LAC.ui.renderResults(device, budget)       // verdict counts, best picks, filterable lists
LAC.ui.onOverride(fn)                      // fn({ ramGB, gpuName }) when the user corrects detection
```

## `main.js`

On DOMContentLoaded (or immediately if already loaded): `LAC.ui.init`, run
`LAC.detect(LAC.ui.progress)`, then `LAC.estimate.budget`, then render. When the
user overrides RAM/GPU: save, re-apply, re-budget, re-render (no re-scan). A
"Scan again" button re-runs everything. Without `Promise`: synchronous fallback
path using only UA/cores/deviceMemory/WebGL.
