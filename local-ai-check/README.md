# Can It Run Local AI?

A single web page that checks the device it is opened on and lists which of today's
open-weight AI models that device can run locally: **runs well**, **runs slowly**, or
**won't run**. It gives separate answers for running a model in an installed app (Ollama,
LM Studio, PocketPal, ComfyUI…) and running it inside the browser itself (WebGPU/WebAssembly).

Everything runs in the visitor's browser. The page makes no network requests except for
an optional Google Fonts stylesheet, and it sends nothing anywhere.

- **Built page:** [`docs/index.html`](../docs/index.html). It is one self-contained file, so any static host works.
- **Model data:** 167 open-weight models (chat, reasoning, coding, vision, image and video
  generation, speech, embeddings, music) and 240 GPUs/chips, current as of 29 September 2026.

## What it checks

| Probe | Source | Notes |
|---|---|---|
| Browser, OS, phone/tablet/desktop | User agent + client hints | Reduced UAs handled via `userAgentData` |
| CPU threads, architecture | `hardwareConcurrency`, client hints | Safari caps the thread count at 8 |
| RAM | `navigator.deviceMemory` | Chrome caps it (8 GB before v147; 32 GB on desktop from v147). Safari and Firefox hide it, so the page asks |
| GPU model | WebGL renderer, WebGPU adapter info | Matched against the GPU table for VRAM, bandwidth and compute |
| WebGPU | `navigator.gpu` | Adapter limits, `shader-f16`, software fallback |
| WebAssembly | `WebAssembly.validate` | SIMD, threads, memory64, relaxed SIMD |
| Browser storage | `navigator.storage.estimate()` | Limits which models can be cached in the browser |
| CPU speed | 96×96 matmul micro-benchmark | ≈0.5 s, yields between rounds |
| GPU speed | WebGPU copy + FMA compute shaders | ≈1 s, only with a hardware adapter; refines unknown or hidden chips |

When a value is hidden or uncertain, the page says so (“detected”, “likely”, “guess”) and
lets the visitor correct RAM and GPU. Corrections are kept in `localStorage` on that device only.

## How verdicts are made

- **Language models** generate text at roughly *memory bandwidth ÷ bytes read per token*.
  The estimator sums the 4-bit weights, a 4k-token KV cache and runtime overhead, then places the
  model in VRAM, splits it across VRAM and RAM, or declares it too big. Mixture-of-experts
  models need memory for all parameters but read only the active ones per token.
- **Image, video and music models** are compute-bound. Their costs are calibrated so that an
  RTX 4090 matches measured community timings (see `tools/curation.mjs`).
- **Speech models** are rated by real-time factor.
- Thresholds: chat ≥ 10 tok/s is *well* and 2–10 is *slow*. Reasoning models need ≥ 15 tok/s.
  Images: ≤ 30 s is *well* and ≤ 5 min is *slow*. Speech to text needs ≥ 3× real time.

The estimator is checked against published measurements in `test/estimate.test.mjs`, for
example Llama 3.1 8B on an RTX 4090 (≈130–150 tok/s) and on an M2 (≈12–15 tok/s).

## Compatibility

- All shipped JavaScript is **ES5**. `npm test` parses every file with `ecmaVersion: 5`, so the
  page loads on old engines. Every modern API is feature-detected and wrapped in `try/catch` with a timeout.
- Browsers without `Promise` still get a result from the synchronous probes.
  Without JavaScript, a `<noscript>` message explains what is needed.
- The layout works from 320 px phones to wide desktops, in light and dark themes.
- The Playwright suite emulates a gaming PC, an iPhone under Safari, an Android phone, Firefox on a
  Mac, a browser without Promise/WebAssembly/WebGL, a browser with storage blocked, and a 320 px phone.

## Develop

```sh
cd local-ai-check
npm install                 # acorn, for the ES5 check
node tools/build-data.mjs   # research/*.json + tools/curation.mjs → src/data/*.js
npm test                    # builds docs/index.html, then runs ES5, unit and browser tests
npm run serve               # http://localhost:8080
```

Source layout: `src/` holds the page's modules, which are inlined into one file by `build.mjs`.
`research/` holds the fact-checked catalogs the data is generated from.
`ARCHITECTURE.md` describes the module contracts.

## Publish

GitHub Pages can serve the `docs/` folder directly. In the repository settings, go to
**Pages → Build and deployment → Deploy from a branch**, then pick the branch and the `/docs` folder.
