// Hand-maintained facts layered on top of the researched catalogs (research/*.json).
// Keys are regular expressions tested against the model's display name (case-insensitive).

// Reference device for calibration: an RTX 4090 is modelled at 82.6 FP16 TFLOPS × 2 (tensor
// cores) × 0.35 efficiency ≈ 58 effective TFLOPS. Each workload's `tflop` is therefore
// (measured seconds on a 4090) × 58, from community benchmarks (ComfyUI / Forge defaults).
export const DIFFUSION = [
  // [name regex, TFLOP per image/clip, unit, note]
  [/^stable diffusion 1\.5/i, 58, 'image', '512², 20 steps ≈ 1 s on an RTX 4090'],
  [/^stable diffusion xl/i, 260, 'image', '1024², 25 steps ≈ 4.5 s on an RTX 4090'],
  [/stable diffusion 3\.5 medium/i, 290, 'image', '1024², 28 steps ≈ 5 s on an RTX 4090'],
  [/stable diffusion 3\.5 large/i, 700, 'image', '1024², 28 steps ≈ 12 s on an RTX 4090'],
  [/flux\.1 \[schnell\]/i, 175, 'image', '1024², 4 steps ≈ 3 s on an RTX 4090'],
  [/flux\.1 \[dev\]/i, 1000, 'image', '1024², 20–28 steps ≈ 17 s on an RTX 4090'],
  [/flux\.2 \[dev\]/i, 4000, 'image', '1024², ~70 s on an RTX 4090 with offloading'],
  [/flux\.2 \[klein\] 4b/i, 90, 'image', 'distilled, ≈ 1.5 s on an RTX 4090'],
  [/flux\.2 \[klein\] 9b/i, 175, 'image', 'distilled, ≈ 3 s on an RTX 4090'],
  [/flux\.2 \[klein\]/i, 175, 'image', 'distilled'],
  [/z-image/i, 150, 'image', '8 steps ≈ 2.5 s on an RTX 4090'],
  [/qwen-image-2/i, 870, 'image', '≈ 15 s on an RTX 4090'],
  [/qwen-image/i, 3500, 'image', '50 steps with CFG ≈ 60 s on an RTX 4090 (FP8)'],
  [/hidream/i, 3500, 'image', '50 steps ≈ 60 s on an RTX 4090'],
  [/hunyuanimage/i, 5000, 'image', '80B MoE; needs 48 GB+'],
  [/wan 2\.1.*1\.3b/i, 14000, 'clip', '480p 5 s clip ≈ 4 min on an RTX 4090'],
  [/wan 2\.2.*5b/i, 31000, 'clip', '720p 5 s clip ≈ 9 min on an RTX 4090'],
  [/wan 2\.2.*a14b/i, 87000, 'clip', '720p 5 s clip ≈ 25 min on an RTX 4090'],
  [/ltx-video/i, 900, 'clip', 'distilled, ≈ 15 s per clip on an RTX 4090'],
  [/ltx-2/i, 9000, 'clip', '≈ 2.5 min per clip on an RTX 4090'],
  [/hunyuanvideo/i, 35000, 'clip', '480p ≈ 10 min on an RTX 4090'],
  [/mochi/i, 70000, 'clip', '≈ 20 min on an RTX 4090'],
  [/minimax h3/i, 14000, 'clip', 'video + audio, ≈ 4 min per clip on an RTX 4090 (INT8)'],
  [/musicgen/i, 170, 'clip', '10 s of music ≈ 3 s on an RTX 4090'],
  [/stable audio open small/i, 60, 'clip', 'Arm-optimised; ≈ 1 s per clip on a 4090'],
  [/stable audio open/i, 290, 'clip', '≈ 5 s per clip on an RTX 4090'],
  [/ace-step/i, 60, 'clip', '≈ 1 s per 10 s of music on an RTX 4090'],
];

// Speech: decoder tokens per second of audio, decoder size (B params, read per token) and
// encoder/flow compute per audio second (TFLOP). Whisper encoder ≈ 2 × enc params × 50 frames/s.
export const SPEECH = [
  [/whisper large-v3-turbo/i, { tokPerAudioSec: 3, decB: 0.17, encTflopPerAudioSec: 0.064 }],
  [/whisper large/i, { tokPerAudioSec: 3, decB: 0.9, encTflopPerAudioSec: 0.064 }],
  [/whisper medium/i, { tokPerAudioSec: 3, decB: 0.46, encTflopPerAudioSec: 0.03 }],
  [/whisper small/i, { tokPerAudioSec: 3, decB: 0.15, encTflopPerAudioSec: 0.009 }],
  [/whisper base/i, { tokPerAudioSec: 3, decB: 0.05, encTflopPerAudioSec: 0.002 }],
  [/whisper tiny/i, { tokPerAudioSec: 3, decB: 0.03, encTflopPerAudioSec: 0.0008 }],
  [/distil-whisper/i, { tokPerAudioSec: 3, decB: 0.1, encTflopPerAudioSec: 0.064 }],
  [/parakeet/i, { tokPerAudioSec: 0, decB: 0, encTflopPerAudioSec: 0.015 }],
  [/moonshine/i, { tokPerAudioSec: 3, decB: 0.1, encTflopPerAudioSec: 0.005 }],
  [/voxtral/i, { tokPerAudioSec: 3, decB: 3.4, encTflopPerAudioSec: 0.06 }],
  [/qwen3-asr/i, { tokPerAudioSec: 3, decB: 1.4, encTflopPerAudioSec: 0.03 }],
  // Kokoro/Piper are rated from measured CPU speeds rather than parameter counts (their vocoders
  // dominate): Kokoro ≈ 0.87× real time on a 2-core ARM CPU and ≈ 2× on one M1 Max core in WASM;
  // Piper medium ≈ 8× on the same 2-core CPU (obole-ia/tts-cpu-benchmark, briantung.me).
  [/kokoro/i, { tokPerAudioSec: 0, decB: 0, encTflopPerAudioSec: 0.08 }],
  [/piper/i, { tokPerAudioSec: 0, decB: 0, encTflopPerAudioSec: 0.007 }],
  [/xtts/i, { tokPerAudioSec: 22, decB: 0.4, encTflopPerAudioSec: 0.01 }],
  [/f5-tts/i, { tokPerAudioSec: 0, decB: 0, encTflopPerAudioSec: 4 }],
  [/orpheus/i, { tokPerAudioSec: 83, decB: 3.3, encTflopPerAudioSec: 0.01 }],
  [/^dia\b/i, { tokPerAudioSec: 86, decB: 1.6, encTflopPerAudioSec: 0.01 }],
  [/chatterbox/i, { tokPerAudioSec: 25, decB: 0.5, encTflopPerAudioSec: 0.5 }],
  [/vibevoice/i, { tokPerAudioSec: 7.5, decB: 1.5, encTflopPerAudioSec: 0.3 }],
  [/qwen3-tts/i, { tokPerAudioSec: 25, decB: 1.7, encTflopPerAudioSec: 0.05 }],
  [/zonos/i, { tokPerAudioSec: 86, decB: 0.9, encTflopPerAudioSec: 0.01 }],
  [/breeze tts/i, { tokPerAudioSec: 25, decB: 3, encTflopPerAudioSec: 0.05 }],
  [/cohere transcribe/i, { tokPerAudioSec: 3, decB: 0.3, encTflopPerAudioSec: 0.15 }],
];

// WebLLM prebuilt models (mlc-ai/web-llm src/config.ts): our model name → WebLLM base model.
export const WEBLLM = [
  [/^llama 3\.2 1b/i, 'Llama-3.2-1B-Instruct'],
  [/^llama 3\.2 3b/i, 'Llama-3.2-3B-Instruct'],
  [/^llama 3\.1 8b/i, 'Llama-3.1-8B-Instruct'],
  [/deepseek-r1-distill-qwen 1\.5b/i, 'DeepSeek-R1-Distill-Qwen-1.5B'],
  [/deepseek-r1-distill-qwen 7b/i, 'DeepSeek-R1-Distill-Qwen-7B'],
  [/deepseek-r1-distill-llama 8b/i, 'DeepSeek-R1-Distill-Llama-8B'],
  [/^phi-4-mini-instruct/i, 'Phi-4-mini-instruct'],
  [/^mistral 7b instruct v0\.3/i, 'Mistral-7B-Instruct-v0.3'],
  [/^smollm2 1\.7b/i, 'SmolLM2-1.7B-Instruct'],
  [/^smollm2 360m/i, 'SmolLM2-360M-Instruct'],
  [/^gemma 3 1b/i, 'gemma-3-1b-it'],
  [/^qwen3 0\.6b/i, 'Qwen3-0.6B'],
  [/^qwen3 1\.7b/i, 'Qwen3-1.7B'],
  [/^qwen3 4b (instruct|thinking)/i, 'Qwen3-4B'],
  [/^qwen3 8b/i, 'Qwen3-8B'],
  [/^qwen3\.5 0\.8b/i, 'Qwen3.5-0.8B'],
  [/^qwen3\.5 2b/i, 'Qwen3.5-2B'],
  [/^qwen3\.5 4b/i, 'Qwen3.5-4B'],
  [/^qwen3\.5 9b/i, 'Qwen3.5-9B'],
  [/^qwen2\.5-coder 1\.5b/i, 'Qwen2.5-Coder-1.5B-Instruct'],
  [/^qwen2\.5-coder 7b/i, 'Qwen2.5-Coder-7B-Instruct'],
  [/^ministral 3 3b/i, 'Ministral-3-3B-Instruct-2512'],
];

// Other in-browser builds (Transformers.js / ONNX Runtime Web / MediaPipe).
// webgpuOnly: needs WebGPU; otherwise also runs on the CPU through WebAssembly.
export const BROWSER_OTHER = [
  [/^whisper (tiny|base|small)/i, { tjs: true, webgpuOnly: false }],
  [/^whisper large-v3-turbo/i, { tjs: true, webgpuOnly: true }],
  [/moonshine/i, { tjs: true, webgpuOnly: false }],
  [/kokoro/i, { tjs: true, webgpuOnly: false }],
  [/piper/i, { other: 'Runs in the browser through community WebAssembly builds of Piper', webgpuOnly: false }],
  [/all-minilm/i, { tjs: true, webgpuOnly: false }],
  [/nomic-embed/i, { tjs: true, webgpuOnly: false }],
  [/bge-m3/i, { tjs: true, webgpuOnly: false }],
  [/embeddinggemma/i, { tjs: true, webgpuOnly: false }],
  [/qwen3-embedding 0\.6b/i, { tjs: true, webgpuOnly: false }],
  [/florence-2/i, { tjs: true, webgpuOnly: false }],
  [/moondream/i, { tjs: true, webgpuOnly: true }],
  [/smolvlm/i, { tjs: true, webgpuOnly: true }],
  [/^smollm3/i, { tjs: true, webgpuOnly: true }],
  [/^lfm2\.5 (350m|1\.2b)/i, { tjs: true, webgpuOnly: false }],
  [/^gemma 3 270m/i, { tjs: true, webgpuOnly: false }],
  [/^granite 4\.\d+ 3b/i, { tjs: true, webgpuOnly: true }],
  [/^gpt-oss-20b/i, { tjs: true, webgpuOnly: true }],
  [/^gemma 3n e[24]b/i, { other: 'Runs in Chrome through Google’s MediaPipe / LiteRT-LM web runtime', webgpuOnly: true }],
  [/^gemma 4 e[24]b/i, { other: 'Runs in Chrome through Google’s MediaPipe / LiteRT-LM web runtime', webgpuOnly: true }],
];

// Models that must never be offered as "the chat model to try": task-prompted captioners/OCR
// models and tiny bases meant for fine-tuning. build-data sets `chat: false` on them.
export const NOT_CHAT = [
  [/^florence-2/i, 'task-prompted captioning/OCR/detection, not chat'],
  [/^moondream/i, 'captioning and pointing model, not a general assistant'],
  [/^gemma 3 270m/i, 'base for task-specific fine-tuning'],
  [/^lfm2\.5 350m/i, 'extraction/classification model'],
];

// Models with no mainstream runtime yet (a llama.cpp fork, an unmerged PR build or server-only
// engines). build-data sets `needsFork: true`; the headline does not recommend them.
export const NEEDS_FORK = [
  [/^ternary bonsai/i, "needs PrismML's llama.cpp fork"],
  [/^glm-5\.3-flash/i, 'needs a llama.cpp PR build'],
  [/^minimax m3\b/i, 'GGUFs need a llama.cpp PR build'],
  [/^deepseek v4\.1 flash/i, 'no llama.cpp/MLX support yet'],
  [/^command a\+/i, 'vLLM builds only; GGUF support unconfirmed'],
];

// Duplicates across the researched catalogs: [name regex to drop, reason].
export const DROP = [
  // Vision variants listed in the non-text catalog duplicate the chat entries.
  [/^gemma 3 (4|12|27)b \(vision\)$/i, 'same weights as the Gemma 3 chat entry'],
];

// kind by modality (drives the estimator).
export function kindFor(modality) {
  switch (modality) {
    case 'image-generation':
    case 'video-generation': return 'diffusion';
    case 'music-audio': return 'audio-gen';
    case 'speech-to-text': return 'speech';
    case 'text-to-speech': return 'tts';
    case 'embedding': return 'embedding';
    default: return 'llm';
  }
}
