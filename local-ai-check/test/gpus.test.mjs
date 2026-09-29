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
  // Table sanity.
  for (const g of L.GPUS) {
    assert.ok(g.bandwidthGBs > 0, `${g.name} has bandwidth`);
    assert.ok(/^(discrete-desktop|discrete-laptop|integrated|apple-silicon|mobile-soc|datacenter)$/.test(g.kind), `${g.name} kind`);
    if (g.kind.startsWith('discrete') || g.kind === 'datacenter') assert.ok(g.vramGB > 0, `${g.name} has VRAM`);
  }
}
