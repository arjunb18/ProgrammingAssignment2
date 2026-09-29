// Real WebGL/WebGPU renderer strings (from browser reports) must map to the right table entry.
import { loadLAC } from './load.mjs';

const CASES = [
  ['ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 (0x00002786) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'NVIDIA GeForce RTX 4070'],
  ['ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Laptop GPU (0x00002820) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'NVIDIA GeForce RTX 4070 Laptop'],
  ['ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Ti (0x00002803) Direct3D11 vs_5_0 ps_5_0, D3D11)', /RTX 4060 Ti/],
  ['ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11)', /RTX 3060 12GB/],
  ['ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 3080/PCIe/SSE2, OpenGL 4.5.0 NVIDIA 550.54)', /RTX 3080 \(/],
  ['ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 6GB (0x00001C03) Direct3D11 vs_5_0 ps_5_0, D3D11)', /GTX 1060/],
  ['ANGLE (AMD, AMD Radeon RX 7900 XTX (0x0000744C) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'AMD Radeon RX 7900 XTX'],
  ['ANGLE (AMD, AMD Radeon RX 580 2048SP (0x00006FDF) Direct3D11 vs_5_0 ps_5_0, D3D11)', /RX 570\/580\/590/],
  ['ANGLE (AMD, AMD Radeon(TM) Graphics (0x000015BF) Direct3D11 vs_5_0 ps_5_0, D3D11)', /780M/],
  ['ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001586) Direct3D11 vs_5_0 ps_5_0, D3D11)', /8060S/],
  ['ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'Intel UHD Graphics'],
  ['ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'Intel Iris Xe Graphics'],
  ['ANGLE (Intel, Intel(R) Arc(TM) 140V GPU (16GB) (0x000064A0) Direct3D11 vs_5_0 ps_5_0, D3D11)', /140V/],
  ['ANGLE (Intel, Mesa Intel(R) Xe Graphics (TGL GT2), OpenGL 4.6 (Core Profile) Mesa 24.0.5)', 'Intel Iris Xe Graphics'],
  ['ANGLE (Qualcomm, Qualcomm(R) Adreno(TM) X1-85 GPU (0x36334330) Direct3D11 vs_5_0 ps_5_0, D3D11)', /X1-85/],
  ['ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified Version)', 'Apple M3 Pro'],
  ['ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)', 'Apple M2'],
  ['ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Max, Unspecified Version)', /Apple M4 Max/],
  ['ANGLE (Qualcomm, Adreno (TM) 750, OpenGL ES 3.2)', /Adreno 750/],
  ['Adreno (TM) 830', /Adreno 830/],
  ['ANGLE (ARM, Mali-G715-Immortalis MC11, OpenGL ES 3.2)', /Immortalis-G715/],
  ['Mali-G78', /Mali-G78/],
  ['ANGLE (Samsung Electronics Co., Ltd., ANGLE Vulkan 1.3 (Samsung Xclipse 940 (0x...)), Samsung)', /Xclipse 940/],
  ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', null],
  ['ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)', null],
  ['Apple GPU', null],
  ['', null],
  // Mobile-workstation GPUs contain the desktop card's name but have about half its VRAM.
  ['ANGLE (NVIDIA, NVIDIA RTX 5000 Ada Generation Laptop GPU (0x000027BA) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'NVIDIA RTX 5000 Ada Laptop'],
  ['ANGLE (NVIDIA, NVIDIA RTX 2000 Ada Generation Laptop GPU (0x000028B8) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'NVIDIA RTX 2000 Ada Laptop'],
  ['ANGLE (NVIDIA, NVIDIA RTX A5000 Laptop GPU (0x000024B6) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'NVIDIA RTX A5000 Laptop'],
  ['ANGLE (NVIDIA, NVIDIA RTX A2000 Laptop GPU (0x000025B8) Direct3D11 vs_5_0 ps_5_0, D3D11)', /^NVIDIA RTX A2000 Laptop/],
  ['ANGLE (NVIDIA, NVIDIA RTX PRO 5000 Blackwell Generation Laptop GPU (0x00002C38) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'NVIDIA RTX PRO 5000 Blackwell Laptop'],
  ['ANGLE (NVIDIA Corporation, NVIDIA RTX 4000 Ada Generation Laptop GPU/PCIe/SSE2, OpenGL 4.5.0 NVIDIA 550.54)', 'NVIDIA RTX 4000 Ada Laptop'],
  ['ANGLE (NVIDIA, NVIDIA RTX 5000 Ada Generation (0x000026B2) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'NVIDIA RTX 5000 Ada'],
  // A laptop string that only a desktop entry matches gets a derived laptop entry, not the desktop VRAM.
  ['ANGLE (NVIDIA, NVIDIA GeForce RTX 3090 Laptop GPU (0x00002000) Direct3D11 vs_5_0 ps_5_0, D3D11)', /laptop version/],
  // Old GeForce laptop GPUs share model tokens with AMD APUs.
  ['ANGLE (NVIDIA, NVIDIA GeForce GTX 780M Direct3D11 vs_5_0 ps_5_0, D3D11)', null],
  ['ANGLE (NVIDIA, NVIDIA GeForce GTX 880M Direct3D11 vs_5_0 ps_5_0, D3D11)', null],
  ['ANGLE (NVIDIA, NVIDIA GeForce GT 740M Direct3D11 vs_5_0 ps_5_0, D3D11)', null],
  ['ANGLE (NVIDIA, NVIDIA GeForce GTX 680M Direct3D11 vs_5_0 ps_5_0, D3D11)', null],
  ['ANGLE (AMD, AMD Radeon 780M Graphics (0x000015BF) Direct3D11 vs_5_0 ps_5_0, D3D11)', /780M/],
  ['ANGLE (AMD, AMD Radeon 780M (radeonsi, gfx1103_r1, LLVM 17.0.6, DRM 3.57, 6.8.0), OpenGL 4.6 (Core Profile) Mesa 24.2.8)', /780M/],
  ['ANGLE (AMD, AMD Radeon(TM) 8060S Graphics (0x00001586) Direct3D11 vs_5_0 ps_5_0, D3D11)', /8060S/],
  // The PCI id only refines an unnumbered name: 880M and 890M share 0x150E.
  ['ANGLE (AMD, AMD Radeon(TM) 880M Graphics (0x0000150E) Direct3D11 vs_5_0 ps_5_0, D3D11)', /880M/],
  ['ANGLE (AMD, AMD Radeon(TM) 890M Graphics (0x0000150E) Direct3D11 vs_5_0 ps_5_0, D3D11)', /890M/],
  ['ANGLE (AMD, AMD Radeon(TM) Graphics (0x0000150E) Direct3D11 vs_5_0 ps_5_0, D3D11)', /890M/],
  ['ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)', /generic Ryzen APU/],
  // Virtual machine GPUs are not real hardware.
  ['ANGLE (VMware, Inc., SVGA3D; build: RELEASE; LLVM;, OpenGL 4.1)', null],
  // Class entries used when a browser hides the model (selected by detect.js).
  ['generic nvidia gpu', /^NVIDIA graphics card/],
  ['generic amd gpu', /^AMD Radeon graphics/],
  ['generic intel gpu', /^Intel graphics/],
  ['generic intel mac', /^Intel Mac/],
];

export default function test(assert) {
  const L = loadLAC(['util.js', 'data/gpus.js']);
  for (const [s, want] of CASES) {
    const e = L.matchGpu(s);
    const got = e ? e.name : null;
    const ok = want === null ? got === null : (want instanceof RegExp ? want.test(got || '') : got === want);
    assert.ok(ok, `"${s}" → ${got} (wanted ${want})`);
  }
  assert.equal(L.ramFromRenderer('Intel(R) Arc(TM) 140V GPU (16GB)'), 16, 'RAM from Lunar Lake renderer');
  assert.equal(L.ramFromRenderer('NVIDIA GeForce RTX 4070'), null, 'no RAM in ordinary renderer');
  const lap = L.matchGpu('NVIDIA GeForce RTX 3090 Laptop GPU');
  assert.ok(lap && lap.kind === 'discrete-laptop' && lap.vramGB === 12, `derived laptop entry halves the 24 GB desktop VRAM (${lap && lap.vramGB})`);
  // Table sanity.
  for (const g of L.GPUS) {
    assert.ok(g.bandwidthGBs > 0, `${g.name} has bandwidth`);
    assert.ok(/^(discrete-desktop|discrete-laptop|integrated|apple-silicon|mobile-soc|datacenter)$/.test(g.kind), `${g.name} kind`);
    if (g.kind.startsWith('discrete') || g.kind === 'datacenter') assert.ok(g.vramGB > 0, `${g.name} has VRAM`);
    // Bare APU tokens ("780m") would also match GeForce laptop names.
    if (g.vendor === 'amd' && g.kind === 'integrated') for (const m of g.match) assert.ok(!/^\d{3,4}[ms]$/.test(m), `${g.name}: match "${m}" needs the radeon prefix`);
  }
  // Every entry is reachable through its own match strings.
  for (const g of L.GPUS) for (const m of g.match) {
    const e = L.matchGpu(m);
    assert.ok(e === g, `"${m}" reaches ${g.name} (got ${e && e.name})`);
  }
}
