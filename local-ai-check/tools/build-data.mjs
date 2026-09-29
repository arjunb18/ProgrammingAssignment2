// Generates src/data/models.js, src/data/gpus.js and src/data/runtimes.js from the researched
// catalogs in research/ plus the hand-maintained facts in tools/curation.mjs.
// Usage: node tools/build-data.mjs   (prints warnings for suspicious rows)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIFFUSION, SPEECH, WEBLLM, BROWSER_OTHER, DROP, kindFor } from './curation.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const research = (name) => {
  // Prefer the fact-checked version of a catalog when it exists.
  const verified = join(root, 'research', `research-${name}.verified.json`);
  const draft = join(root, 'research', `research-${name}.json`);
  const draftAlt = join(root, 'research', `research-${name}-draft.json`);
  const p = [verified, draft, draftAlt].find(existsSync);
  if (!p) throw new Error(`missing research file for ${name}`);
  console.log(`using ${p.replace(root + '/', '')}`);
  return JSON.parse(readFileSync(p, 'utf8'));
};

const warnings = [];
const warn = (m) => warnings.push(m);
const round = (x, d = 2) => (typeof x === 'number' && isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);
const slug = (s) => s.toLowerCase().replace(/\[|\]/g, '').replace(/[^a-z0-9.]+/g, '-').replace(/^-|-$/g, '');
const firstMatch = (table, name) => { for (const [re, v] of table) if (re.test(name)) return v; return undefined; };

// ------------------------------------------------------------------ models
const runtimes = research('runtimes');
const webllm = (runtimes.runtimes.find((r) => /webllm/i.test(r.name)) || { model_list: [] }).model_list;

function webllmFor(name) {
  const base = firstMatch(WEBLLM, name);
  if (!base) return null;
  const rows = webllm.filter((m) => m.base_model === base && !/-1k$/.test(m.model_id));
  const f16 = rows.find((m) => /q4f16/.test(m.model_id));
  const f32 = rows.find((m) => /q4f32/.test(m.model_id));
  if (!f16 && !f32) { warn(`WebLLM base ${base} not found in prebuilt list`); return null; }
  return {
    f16: f16 ? { id: f16.model_id, vramMB: Math.round(f16.vram_mb) } : null,
    f32: f32 ? { id: f32.model_id, vramMB: Math.round(f32.vram_mb) } : null,
    lowResource: !!(f16 || f32).low_resource,
  };
}

const catalogs = ['llm-small', 'llm-large', 'non-text'].map((k) => research(k));
const seen = new Map();
const models = [];
for (const cat of catalogs) {
  for (const r of cat.models) {
    const name = r.name.trim();
    const drop = DROP.find(([re]) => re.test(name));
    if (drop) continue;
    const id = slug(name);
    if (seen.has(id)) { warn(`duplicate ${name} (kept first)`); continue; }
    seen.set(id, true);

    const paramsB = round(r.params_total_b, 3);
    let activeB = round(r.params_active_b, 3);
    if (!activeB || activeB > paramsB) activeB = paramsB;
    const sizes = { q4: round(r.q4_gb, 3), q8: round(r.q8_gb, 3), fp16: round(r.fp16_gb, 3) };
    for (const k of Object.keys(sizes)) if (!(sizes[k] > 0)) sizes[k] = null;
    if (sizes.q4 && sizes.q8 && sizes.q4 > sizes.q8 * 1.02) warn(`${name}: q4 ${sizes.q4} > q8 ${sizes.q8}`);
    if (sizes.q8 && sizes.fp16 && sizes.q8 > sizes.fp16 * 1.02) warn(`${name}: q8 > fp16`);
    const kind = kindFor(r.modality);
    if (kind === 'llm' && sizes.q4 && paramsB && (sizes.q4 / paramsB < 0.45 || sizes.q4 / paramsB > 0.8)) {
      warn(`${name}: q4 ${sizes.q4} GB for ${paramsB}B params looks off`);
    }

    const m = {
      id, name, developer: r.developer, family: r.family, modality: r.modality, kind,
      paramsB, activeB, release: r.release, license: r.license, sizes,
      minMemGB: round(r.min_runtime_mem_gb, 2), contextK: round(r.context_k, 0),
      ollama: r.ollama_tag || '', tier: r.popularity, source: r.source, notes: r.notes,
    };

    const wl = webllmFor(name);
    const other = firstMatch(BROWSER_OTHER, name);
    if (wl) m.browser = { webllm: wl };
    else if (other) m.browser = { ...other };
    else m.browser = null;

    if (kind === 'diffusion' || kind === 'audio-gen') {
      const d = DIFFUSION.find(([re]) => re.test(name));
      if (d) m.diffusion = { tflop: d[1], unit: d[2], note: d[3] };
      else warn(`${name}: no diffusion calibration; estimator will use a default`);
    }
    if (kind === 'speech' || kind === 'tts') {
      const s = firstMatch(SPEECH, name);
      if (s) m.speech = s;
      else warn(`${name}: no speech calibration; estimator will use a default`);
    }
    models.push(m);
  }
}

// Every curated browser mapping should have found a model.
for (const [re, base] of WEBLLM) if (!models.some((m) => re.test(m.name))) warn(`WebLLM mapping ${re} (${base}) matched no model`);
for (const [re] of BROWSER_OTHER) if (!models.some((m) => re.test(m.name))) warn(`browser mapping ${re} matched no model`);
for (const [re] of DIFFUSION) if (!models.some((m) => re.test(m.name))) warn(`diffusion calibration ${re} matched no model`);

// ------------------------------------------------------------------ GPUs
const gpuCat = research('gpu-table');
const gpus = [];
for (const g of gpuCat.gpus) {
  const match = (g.match || []).map((s) => s.toLowerCase().trim()).filter(Boolean);
  // Safari's fixed "Apple GPU" string says nothing about the chip; detect.js handles it per OS.
  if (match.length === 1 && match[0] === 'apple gpu') continue;
  if (!match.length) { warn(`GPU ${g.name} has no match strings`); continue; }
  gpus.push({
    match, name: g.name.replace(/\s+/g, ' ').trim(), vendor: g.vendor, kind: g.kind,
    vramGB: round(g.vram_gb, 1) || 0, unifiedOptionsGB: g.unified_mem_options_gb || [],
    bandwidthGBs: round(g.bandwidth_gbs, 0), fp16Tflops: round(g.fp16_tflops, 2) || 0, year: g.year || 0,
  });
}
// Generic entries for devices whose browsers hide the chip (Safari on iPhone/iPad/Mac, Firefox buckets).
gpus.push(
  { match: ['generic iphone'], name: 'iPhone (chip hidden by the browser)', vendor: 'apple', kind: 'mobile-soc', vramGB: 0, unifiedOptionsGB: [6, 8, 12], bandwidthGBs: 51, fp16Tflops: 1.8, year: 0, generic: true },
  { match: ['generic ipad'], name: 'iPad (chip hidden by the browser)', vendor: 'apple', kind: 'mobile-soc', vramGB: 0, unifiedOptionsGB: [8, 4, 6, 16], bandwidthGBs: 68, fp16Tflops: 2.6, year: 0, generic: true },
  { match: ['generic apple silicon mac'], name: 'Apple silicon Mac (chip hidden by the browser)', vendor: 'apple', kind: 'apple-silicon', vramGB: 0, unifiedOptionsGB: [16, 8, 24, 32], bandwidthGBs: 100, fp16Tflops: 3.6, year: 0, generic: true },
);
// Match strings shadowed by an earlier, more general entry would never be reached.
for (let i = 0; i < gpus.length; i++) {
  for (const s of gpus[i].match) {
    for (let j = 0; j < i; j++) {
      for (const t of gpus[j].match) {
        const idx = s.indexOf(t);
        if (idx >= 0 && s !== t) {
          const before = idx === 0 || !/[a-z0-9]/.test(s[idx - 1]);
          const after = idx + t.length === s.length || !/[a-z0-9]/.test(s[idx + t.length]);
          if (before && after) warn(`GPU match "${s}" (${gpus[i].name}) is shadowed by earlier "${t}" (${gpus[j].name})`);
        }
      }
    }
  }
}

// ------------------------------------------------------------------ runtimes
const RUNTIME_KEEP = /ollama|lm studio|llama\.cpp|mlx|jan|comfyui|whisper\.cpp|draw things|pocketpal|ai edge gallery|webllm|transformers\.js|chrome built-in|apple foundation/i;
const rts = runtimes.runtimes.filter((r) => RUNTIME_KEEP.test(r.name)).map((r) => ({
  name: r.name.replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+v?\d[\w.]*.*$/, '').trim(),
  kind: r.kind, url: r.url,
}));

// ------------------------------------------------------------------ write
const header = (what) => `/* Generated by tools/build-data.mjs from research/*.json and tools/curation.mjs — edit those, not this file.\n   ${what} */\n`;
const js = (v) => JSON.stringify(v).replace(/[\u2028\u2029]/g, ' ');
const today = '2026-09-29';

writeFileSync(join(root, 'src/data/models.js'),
  header(`${models.length} open-weight models, data as of ${today}.`) +
  `(function (LAC) {\n  'use strict';\n  LAC.DATA_DATE = '${today}';\n  LAC.MODELS = [\n` +
  models.map((m) => '    ' + js(m)).join(',\n') + `\n  ];\n})(window.LAC = window.LAC || {});\n`);

writeFileSync(join(root, 'src/data/gpus.js'),
  header(`${gpus.length} GPUs and chips; the first entry whose match string appears in the renderer wins.`) +
  `(function (LAC) {\n  'use strict';\n  LAC.GPUS = [\n` + gpus.map((g) => '    ' + js(g)).join(',\n') + `\n  ];\n` +
  readFileSync(join(root, 'tools/match-gpu.js.txt'), 'utf8') +
  `})(window.LAC = window.LAC || {});\n`);

writeFileSync(join(root, 'src/data/runtimes.js'),
  header('Runtimes the page links to.') +
  `(function (LAC) {\n  'use strict';\n  LAC.RUNTIMES = ${js(rts)};\n})(window.LAC = window.LAC || {});\n`);

console.log(`models: ${models.length}  (browser builds: ${models.filter((m) => m.browser).length})`);
console.log(`gpus: ${gpus.length}  runtimes: ${rts.length}`);
if (warnings.length) { console.log(`\n${warnings.length} warnings:`); for (const w of warnings) console.log('  - ' + w); }
