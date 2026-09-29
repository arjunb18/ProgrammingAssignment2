// Hand-maintained GPU facts layered on top of research/research-gpu-table*.json.
// Used by tools/build-data.mjs to generate src/data/gpus.js (first matching entry wins).

// Extra renderer spellings for GPU table entries (entry name regex → additional match strings).
export const GPU_EXTRA_MATCH = [
  [/^Intel Iris Xe Graphics$/, ['xe graphics']], // Linux Mesa: "Mesa Intel(R) Xe Graphics (TGL GT2)"
];

// AMD APU entries in the research table match on bare "780m"-style tokens, which also appear in
// old GeForce laptop names ("GeForce GTX 780M", "GT 740M"). Windows, Linux (Mesa) and the PCI-id
// hint all spell the APU as "Radeon 780M", so require the "radeon" prefix.
export function curateGpuMatch(g, match) {
  if (g.vendor === 'amd' && g.kind === 'integrated') {
    return match.map((m) => (/^\d{3,4}[ms]$/.test(m) ? 'radeon ' + m : m));
  }
  return match;
}

// Entries that only name a family, not a chip. LAC.matchGpu lets a PCI device id refine them.
export const GPU_FAMILY = [/^AMD Radeon Graphics \(generic Ryzen APU\)$/];

// Mobile-workstation GPUs. Their renderer strings ("NVIDIA RTX 5000 Ada Generation Laptop GPU")
// contain the desktop card's name, and the laptop parts have half the VRAM and less bandwidth, so
// these go ahead of the whole table. Specs: NVIDIA product briefs (VRAM, bus width × data rate);
// fp16Tflops is the non-tensor FP16 = FP32 figure at the reference boost clock.
export const GPU_LEADING = [
  { match: ['rtx pro 5000 blackwell generation laptop', 'rtx pro 5000 blackwell laptop', 'rtx pro 5000 laptop'], name: 'NVIDIA RTX PRO 5000 Blackwell Laptop', vendor: 'nvidia', kind: 'discrete-laptop', vramGB: 24, unifiedOptionsGB: [], bandwidthGBs: 896, fp16Tflops: 36, year: 2025 },
  { match: ['rtx pro 4000 blackwell generation laptop', 'rtx pro 4000 blackwell laptop', 'rtx pro 4000 laptop'], name: 'NVIDIA RTX PRO 4000 Blackwell Laptop', vendor: 'nvidia', kind: 'discrete-laptop', vramGB: 16, unifiedOptionsGB: [], bandwidthGBs: 672, fp16Tflops: 27, year: 2025 },
  { match: ['rtx 5000 ada generation laptop', 'rtx 5000 ada laptop'], name: 'NVIDIA RTX 5000 Ada Laptop', vendor: 'nvidia', kind: 'discrete-laptop', vramGB: 16, unifiedOptionsGB: [], bandwidthGBs: 576, fp16Tflops: 42.6, year: 2023 },
  { match: ['rtx 4000 ada generation laptop', 'rtx 4000 ada laptop'], name: 'NVIDIA RTX 4000 Ada Laptop', vendor: 'nvidia', kind: 'discrete-laptop', vramGB: 12, unifiedOptionsGB: [], bandwidthGBs: 432, fp16Tflops: 33.6, year: 2023 },
  { match: ['rtx 3500 ada generation laptop', 'rtx 3500 ada laptop'], name: 'NVIDIA RTX 3500 Ada Laptop', vendor: 'nvidia', kind: 'discrete-laptop', vramGB: 12, unifiedOptionsGB: [], bandwidthGBs: 432, fp16Tflops: 23, year: 2023 },
  { match: ['rtx 3000 ada generation laptop', 'rtx 3000 ada laptop'], name: 'NVIDIA RTX 3000 Ada Laptop', vendor: 'nvidia', kind: 'discrete-laptop', vramGB: 8, unifiedOptionsGB: [], bandwidthGBs: 256, fp16Tflops: 19.9, year: 2023 },
  { match: ['rtx 2000 ada generation laptop', 'rtx 2000 ada laptop'], name: 'NVIDIA RTX 2000 Ada Laptop', vendor: 'nvidia', kind: 'discrete-laptop', vramGB: 8, unifiedOptionsGB: [], bandwidthGBs: 256, fp16Tflops: 14.5, year: 2023 },
  { match: ['rtx a5500 laptop'], name: 'NVIDIA RTX A5500 Laptop', vendor: 'nvidia', kind: 'discrete-laptop', vramGB: 16, unifiedOptionsGB: [], bandwidthGBs: 448, fp16Tflops: 24.7, year: 2022 },
  { match: ['rtx a5000 laptop'], name: 'NVIDIA RTX A5000 Laptop', vendor: 'nvidia', kind: 'discrete-laptop', vramGB: 16, unifiedOptionsGB: [], bandwidthGBs: 448, fp16Tflops: 21.7, year: 2021 },
  { match: ['rtx a4000 laptop'], name: 'NVIDIA RTX A4000 Laptop', vendor: 'nvidia', kind: 'discrete-laptop', vramGB: 8, unifiedOptionsGB: [], bandwidthGBs: 384, fp16Tflops: 17.8, year: 2021 },
  { match: ['rtx a3000 12gb laptop'], name: 'NVIDIA RTX A3000 12GB Laptop', vendor: 'nvidia', kind: 'discrete-laptop', vramGB: 12, unifiedOptionsGB: [], bandwidthGBs: 264, fp16Tflops: 12.8, year: 2022 },
  { match: ['rtx a3000 laptop'], name: 'NVIDIA RTX A3000 Laptop (6GB; 12GB variant exists)', vendor: 'nvidia', kind: 'discrete-laptop', vramGB: 6, unifiedOptionsGB: [], bandwidthGBs: 264, fp16Tflops: 12.8, year: 2021 },
  { match: ['rtx a2000 8gb laptop'], name: 'NVIDIA RTX A2000 8GB Laptop', vendor: 'nvidia', kind: 'discrete-laptop', vramGB: 8, unifiedOptionsGB: [], bandwidthGBs: 224, fp16Tflops: 9.3, year: 2022 },
  { match: ['rtx a2000 laptop'], name: 'NVIDIA RTX A2000 Laptop (4GB; 8GB variant exists)', vendor: 'nvidia', kind: 'discrete-laptop', vramGB: 4, unifiedOptionsGB: [], bandwidthGBs: 192, fp16Tflops: 9.3, year: 2021 },
];

// Class entries for devices whose browsers hide the chip. `generic: true` keeps them out of the
// "Correct the details" picker; detect.js selects them with LAC.matchGpu('generic …').
export const GPU_GENERIC = [
  // Safari on iPhone / iPad / Apple-silicon Mac ("Apple GPU").
  { match: ['generic iphone'], name: 'iPhone (chip hidden by the browser)', vendor: 'apple', kind: 'mobile-soc', vramGB: 0, unifiedOptionsGB: [6, 8, 12], bandwidthGBs: 51, fp16Tflops: 1.8, year: 0, generic: true },
  { match: ['generic ipad'], name: 'iPad (chip hidden by the browser)', vendor: 'apple', kind: 'mobile-soc', vramGB: 0, unifiedOptionsGB: [8, 4, 6, 16], bandwidthGBs: 68, fp16Tflops: 2.6, year: 0, generic: true },
  { match: ['generic apple silicon mac'], name: 'Apple silicon Mac (chip hidden by the browser)', vendor: 'apple', kind: 'apple-silicon', vramGB: 0, unifiedOptionsGB: [16, 8, 24, 32], bandwidthGBs: 100, fp16Tflops: 3.6, year: 0, generic: true },
  // Safari before 26 on an Intel Mac (no ASTC textures): UHD 630 / Iris Plus class on DDR4/LPDDR3.
  { match: ['generic intel mac'], name: 'Intel Mac graphics (model hidden by the browser)', vendor: 'intel', kind: 'integrated', vramGB: 0, unifiedOptionsGB: [], bandwidthGBs: 38, fp16Tflops: 0.8, year: 0, generic: true },
  // Firefox's sanitised buckets name only the vendor ("GTX 980, or similar" can be anything from a
  // GTX 900-series card to an RTX 4090). Conservative: an entry-level card of recent years
  // (RTX 3050 / RX 6500 XT class). A WebGPU benchmark replaces the bandwidth when it runs.
  { match: ['generic nvidia gpu'], name: 'NVIDIA graphics card (model hidden by the browser)', vendor: 'nvidia', kind: 'discrete-desktop', vramGB: 6, unifiedOptionsGB: [], bandwidthGBs: 200, fp16Tflops: 9, year: 0, generic: true },
  { match: ['generic amd gpu'], name: 'AMD Radeon graphics (model hidden by the browser)', vendor: 'amd', kind: 'discrete-desktop', vramGB: 4, unifiedOptionsGB: [], bandwidthGBs: 144, fp16Tflops: 9, year: 0, generic: true },
  // Intel's bucket covers HD Graphics to Arc: assume typical laptop integrated graphics on dual-channel memory.
  { match: ['generic intel gpu'], name: 'Intel graphics (model hidden by the browser)', vendor: 'intel', kind: 'integrated', vramGB: 0, unifiedOptionsGB: [], bandwidthGBs: 51, fp16Tflops: 2, year: 0, generic: true },
];
