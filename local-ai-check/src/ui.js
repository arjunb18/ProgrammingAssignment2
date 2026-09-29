/*
 * Rendering. Plain DOM + HTML strings (escaped) so it runs everywhere. ES5 only.
 */
(function (LAC) {
  'use strict';

  var U = LAC.util;
  var esc = U.esc;

  var els = {};
  var overrideHandler = null;
  var rescanHandler = null;
  var current = { device: null, budget: null };
  var state = {
    target: 'native',
    filter: 'all',
    query: '',
    expanded: { well: false, slow: false, no: false }
  };

  var FILTERS = [
    { id: 'all', label: 'All', mods: null },
    { id: 'chat', label: 'Chat, reasoning & code', mods: ['text', 'reasoning', 'code'] },
    { id: 'vision', label: 'Vision', mods: ['vision-language'] },
    { id: 'image', label: 'Image generation', mods: ['image-generation'] },
    { id: 'video', label: 'Video generation', mods: ['video-generation'] },
    { id: 'speech', label: 'Speech', mods: ['speech-to-text', 'text-to-speech'] },
    { id: 'other', label: 'Embeddings & music', mods: ['embedding', 'music-audio'] }
  ];

  var PICKS = [
    { label: 'Chat', mods: ['text'] },
    { label: 'Reasoning', mods: ['reasoning'] },
    { label: 'Coding', mods: ['code'] },
    { label: 'Vision (images in, text out)', mods: ['vision-language'] },
    { label: 'Image generation', mods: ['image-generation'] },
    { label: 'Speech to text', mods: ['speech-to-text'] },
    { label: 'Text to speech', mods: ['text-to-speech'] }
  ];

  var LIMITS = { well: 25, slow: 25, no: 12 };
  var RAM_OPTIONS = [2, 3, 4, 6, 8, 12, 16, 18, 24, 32, 36, 48, 64, 96, 128, 192, 256, 512];
  var VERDICT_TEXT = { well: 'Runs well', slow: 'Runs slowly', no: "Won't run" };

  function $(id) { return document.getElementById(id); }

  function init() {
    els.probes = $('probes');
    els.device = $('device');
    els.deviceBody = $('device-body');
    els.results = $('results');
    els.resultsBody = $('results-body');
    els.method = $('method-body');
    els.rescan = $('rescan');
    var saved = U.storage.get('view');
    if (saved) {
      if (saved.target === 'native' || saved.target === 'browser') { state.target = saved.target; }
      for (var i = 0; i < FILTERS.length; i++) { if (FILTERS[i].id === saved.filter) { state.filter = saved.filter; } }
    }
    if (els.rescan) {
      els.rescan.onclick = function () { if (rescanHandler) { rescanHandler(); } };
    }
    if (els.resultsBody) {
      els.resultsBody.onclick = onResultsClick;
      els.resultsBody.oninput = onResultsInput;
    }
    if (els.deviceBody) {
      els.deviceBody.onclick = onDeviceClick;
      els.deviceBody.onchange = onDeviceChange;
    }
    renderMethod();
  }

  function saveView() { U.storage.set('view', { target: state.target, filter: state.filter }); }

  // ---------------------------------------------------------------- scan checklist

  function progress(step, status, detail) {
    if (!els.probes) { return; }
    var li = els.probes.querySelector('[data-step="' + step + '"]');
    if (!li) { return; }
    li.setAttribute('data-status', status);
    var d = li.querySelector('.probe-detail');
    if (d) { d.textContent = status === 'running' ? 'Checking…' : (detail || (status === 'done' ? 'Done' : '')); }
  }

  function resetProgress() {
    if (!els.probes) { return; }
    var items = els.probes.querySelectorAll('.probe');
    for (var i = 0; i < items.length; i++) {
      items[i].removeAttribute('data-status');
      var d = items[i].querySelector('.probe-detail');
      if (d) { d.textContent = 'Waiting…'; }
    }
  }

  // ---------------------------------------------------------------- device plate

  var OS_NAMES = { windows: 'Windows', mac: 'macOS', linux: 'Linux', android: 'Android', ios: 'iOS', ipados: 'iPadOS', chromeos: 'ChromeOS', other: 'Unknown OS' };

  function deviceTitle(d) {
    var ua = d.ua;
    var os = OS_NAMES[ua.os] || 'Unknown OS';
    var ff = ua.os === 'ios' ? 'iPhone' : (ua.os === 'ipados' ? 'iPad' : (ua.formFactor === 'phone' ? 'Android phone' : (ua.formFactor === 'tablet' ? 'Tablet' : 'Computer')));
    if (ua.os === 'mac') { ff = 'Mac'; }
    if (ua.os === 'chromeos') { ff = 'Chromebook'; }
    var t = ff;
    if (ua.model) { t += ' · ' + ua.model; }
    if (ff !== 'iPhone' && ff !== 'iPad' && ff !== 'Mac') { t += ' · ' + os + (ua.osVersion ? ' ' + ua.osVersion : ''); }
    else if (ua.osVersion) { t += ' · ' + os + ' ' + ua.osVersion; }
    return t;
  }

  function conf(level) {
    var label = level === 'high' ? 'detected' : (level === 'medium' ? 'likely' : 'guess');
    return '<span class="conf conf-' + esc(level) + '">' + label + '</span>';
  }

  function spec(label, valueHtml) {
    return '<div class="spec"><dt>' + esc(label) + '</dt><dd>' + valueHtml + '</dd></div>';
  }

  function renderDevice(d, b) {
    current.device = d;
    current.budget = b;
    if (!els.deviceBody) { return; }
    var e = d.gpu.entry;
    var html = '<div class="plate">';
    html += '<div class="plate-head"><div><div class="plate-title">' + esc(deviceTitle(d)) + '</div>' +
      '<div class="plate-sub">' + esc(d.ua.browser + (d.ua.browserVersion ? ' ' + d.ua.browserVersion : '')) + '</div></div>' +
      '<div class="plate-sub mono">' + esc(b.native.label) + '</div></div>';

    html += '<dl class="specs">';
    var cpuTxt = (d.cpu.cores ? d.cpu.cores + ' threads' : 'Cores hidden') + (d.cpu.arch ? ' · ' + (d.cpu.arch === 'arm' ? 'ARM' : 'x86-64') : '');
    if (d.cpu.score) { cpuTxt += ' · speed ' + U.round(d.cpu.score, 2) + '×'; }
    html += spec('Processor', '<span class="val">' + esc(cpuTxt) + '</span>');
    html += spec('Memory (RAM)', '<span class="val">' + esc(U.fmtGB(d.memory.estimatedGB)) + '</span>' +
      (d.memory.capped && d.memory.source === 'deviceMemory' ? ' <span class="plate-sub">or more</span>' : '') + conf(d.memory.confidence));
    var gpuTxt = e ? e.name : (d.gpu.name || 'Not identified');
    var gpuSub = '';
    if (e) {
      var memTxt = e.vramGB > 0 ? U.fmtGB(e.vramGB) + ' VRAM' : 'shared memory';
      gpuSub = '<div class="val plate-sub">' + esc(memTxt + (e.bandwidthGBs ? ' · ' + Math.round(e.bandwidthGBs) + ' GB/s' : '')) + '</div>';
    }
    html += spec('Graphics', esc(gpuTxt) + conf(e ? d.gpu.confidence : 'low') + gpuSub);
    html += spec('WebGPU', esc(d.webgpu.available ? (d.webgpu.isFallback ? 'Software only' : 'Yes' + (d.webgpu.shaderF16 ? ', fp16' : ', no fp16')) : 'No'));
    var nb = b.native;
    var fast = nb.gpuMemGB > 0 ? U.fmtGB(nb.gpuMemGB) + (nb.unified ? ' usable by GPU' : ' usable VRAM') : U.fmtGB(nb.cpuMemGB) + ' usable RAM';
    html += spec('Room for models', '<span class="val">' + esc(fast) + (nb.gpuMemGB > 0 && nb.cpuMemGB > 0 ? ' + ' + esc(U.fmtGB(nb.cpuMemGB)) + ' RAM' : '') + '</span>');
    html += spec('In this browser', esc(b.browser.possible ? (b.browser.mode === 'webgpu' ? 'Up to ~' + U.fmtGB(b.browser.memGB) + ' via WebGPU' : 'Small models via WebAssembly') : 'Not supported'));
    html += '</dl>';
    if (d.builtInAI) {
      var aiTxt = { available: 'is ready to use', downloadable: 'is supported here (not downloaded yet)', downloading: 'is downloading', unavailable: 'is not supported on this device' }[d.builtInAI] || d.builtInAI;
      html += '<p class="plate-sub" style="padding:12px 20px;border-top:1px solid var(--line)">Chrome\'s built-in Gemini Nano ' + esc(aiTxt) + '.</p>';
    }

    html += askBlock(d);

    if (d.notes && d.notes.length) {
      html += '<ul class="notes">';
      for (var i = 0; i < d.notes.length; i++) { html += '<li>' + esc(d.notes[i]) + '</li>'; }
      html += '</ul>';
    }

    html += fixBlock(d);
    html += '</div>';
    els.deviceBody.innerHTML = html;
    els.device.hidden = false;
  }

  // A one-click question when the browser hid the RAM amount.
  function askBlock(d) {
    if (d.memory.source === 'user' || d.memory.confidence === 'high') { return ''; }
    var picks = d.ua.formFactor === 'desktop' ? [8, 16, 24, 32, 48, 64, 96, 128] : [3, 4, 6, 8, 12, 16];
    var h = '<div class="asks"><p>How much RAM does this device have? Your browser ' +
      (d.memory.capped ? 'only reports "at least ' + esc(d.memory.reportedGB) + ' GB".' : 'does not say.') + ' Pick it to sharpen the results.</p><div class="ram-picks">';
    for (var i = 0; i < picks.length; i++) {
      var on = picks[i] === d.memory.estimatedGB;
      h += '<button type="button" class="chip" data-action="ram" data-gb="' + picks[i] + '" aria-pressed="' + (on ? 'true' : 'false') + '">' + picks[i] + ' GB</button>';
    }
    h += '</div></div>';
    return h;
  }

  function fixBlock(d) {
    var ov = U.storage.get('overrides') || {};
    var h = '<details class="fix"' + (d.gpu.confidence === 'low' ? ' open' : '') + '><summary>Correct the details</summary><div class="fix-body">';
    h += '<div class="field"><label for="ov-ram">Memory (RAM)</label><select id="ov-ram"><option value="">Use detected value</option>';
    for (var i = 0; i < RAM_OPTIONS.length; i++) {
      h += '<option value="' + RAM_OPTIONS[i] + '"' + (ov.ramGB === RAM_OPTIONS[i] ? ' selected' : '') + '>' + RAM_OPTIONS[i] + ' GB</option>';
    }
    h += '</select><span class="hint">Windows: Settings › System › About. Mac: Apple menu › About This Mac. Phones: Settings › About.</span></div>';
    h += '<div class="field"><label for="ov-gpu">Graphics chip or processor family</label><select id="ov-gpu"><option value="">Use detected value</option>' + gpuOptions(ov.gpuName) + '</select>' +
      '<span class="hint">Macs, iPhones and iPads: pick the chip (M2 Pro, A17 Pro…). PCs: pick the graphics card.</span></div>';
    h += '<div class="fix-actions"><button type="button" class="btn" data-action="reset-ov">Reset to detected</button></div>';
    h += '</div></details>';
    return h;
  }

  function gpuOptions(selected) {
    var groups = [
      ['apple-silicon', 'Apple Mac chips'], ['mobile-soc', 'Phone & tablet chips'], ['discrete-desktop', 'Desktop graphics cards'],
      ['discrete-laptop', 'Laptop graphics'], ['integrated', 'Integrated graphics'], ['datacenter', 'Workstation & datacenter']
    ];
    var out = '';
    var list = LAC.GPUS || [];
    for (var g = 0; g < groups.length; g++) {
      var items = [];
      for (var i = 0; i < list.length; i++) {
        if (list[i].kind === groups[g][0] && !list[i].generic) { items.push(list[i]); }
      }
      if (!items.length) { continue; }
      items.sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });
      out += '<optgroup label="' + esc(groups[g][1]) + '">';
      for (var j = 0; j < items.length; j++) {
        var n = items[j].name;
        out += '<option value="' + esc(n) + '"' + (n === selected ? ' selected' : '') + '>' + esc(n) + '</option>';
      }
      out += '</optgroup>';
    }
    return out;
  }

  function onDeviceClick(ev) {
    var t = ev.target;
    while (t && t !== els.deviceBody && !(t.getAttribute && t.getAttribute('data-action'))) { t = t.parentNode; }
    if (!t || t === els.deviceBody) { return; }
    var action = t.getAttribute('data-action');
    var ov = U.storage.get('overrides') || {};
    if (action === 'ram') {
      ov.ramGB = parseFloat(t.getAttribute('data-gb'));
      emitOverride(ov);
    } else if (action === 'reset-ov') {
      emitOverride({});
    }
  }

  function onDeviceChange(ev) {
    var t = ev.target;
    if (!t || !t.id) { return; }
    var ov = U.storage.get('overrides') || {};
    if (t.id === 'ov-ram') {
      if (t.value) { ov.ramGB = parseFloat(t.value); } else { delete ov.ramGB; }
      emitOverride(ov);
    } else if (t.id === 'ov-gpu') {
      if (t.value) { ov.gpuName = t.value; } else { delete ov.gpuName; }
      emitOverride(ov);
    }
  }

  function emitOverride(ov) {
    U.storage.set('overrides', ov && (ov.ramGB || ov.gpuName) ? ov : null);
    if (overrideHandler) { overrideHandler(ov || {}); }
  }

  // ---------------------------------------------------------------- results

  function modsFor(filterId) {
    for (var i = 0; i < FILTERS.length; i++) { if (FILTERS[i].id === filterId) { return FILTERS[i].mods; } }
    return null;
  }

  function matchesQuery(m, q) {
    if (!q) { return true; }
    var hay = (m.name + ' ' + m.developer + ' ' + m.family + ' ' + m.modality + ' ' + (m.ollama || '')).toLowerCase();
    var parts = q.toLowerCase().split(/\s+/);
    for (var i = 0; i < parts.length; i++) { if (parts[i] && hay.indexOf(parts[i]) < 0) { return false; } }
    return true;
  }

  function sortGroup(list, verdict) {
    list.sort(function (a, b) {
      if (verdict === 'no') { return (a.v.memGB || 0) - (b.v.memGB || 0); }
      var pa = a.model.paramsB || 0, pb = b.model.paramsB || 0;
      if (pb !== pa) { return pb - pa; }
      return (b.model.release || '') < (a.model.release || '') ? -1 : 1;
    });
    return list;
  }

  function computeAll() {
    return LAC.estimate.classifyAll(LAC.MODELS || [], current.budget, state.target);
  }

  function renderResults(d, b) {
    if (d) { current.device = d; }
    if (b) { current.budget = b; }
    if (!els.resultsBody || !current.budget) { return; }
    var all = computeAll();
    var browser = state.target === 'browser';
    var visible = [];
    var unavailable = 0;
    for (var i = 0; i < all.length; i++) {
      if (browser && all[i].v.unavailable) { unavailable++; continue; }
      visible.push(all[i]);
    }
    var counts = { well: 0, slow: 0, no: 0 };
    for (var c = 0; c < visible.length; c++) { counts[visible[c].v.verdict]++; }

    var mods = modsFor(state.filter);
    var filtered = { well: [], slow: [], no: [] };
    var chipCounts = {};
    for (var k = 0; k < visible.length; k++) {
      var r = visible[k];
      for (var f = 0; f < FILTERS.length; f++) {
        var fm = FILTERS[f].mods;
        if (!fm || fm.indexOf(r.model.modality) >= 0) { chipCounts[FILTERS[f].id] = (chipCounts[FILTERS[f].id] || 0) + 1; }
      }
      if (mods && mods.indexOf(r.model.modality) < 0) { continue; }
      if (!matchesQuery(r.model, state.query)) { continue; }
      filtered[r.v.verdict].push(r);
    }

    var html = '';
    html += headline(visible, counts);
    html += verdictCards(counts);
    html += picks(visible);
    html += controls(chipCounts, unavailable, all.length);
    html += '<div id="groups">' + groupsHtml(filtered) + '</div>';
    els.resultsBody.innerHTML = html;
    els.results.hidden = false;
  }

  function rerenderGroupsOnly() {
    // Re-render everything except the search box so typing keeps focus.
    var box = document.getElementById('q');
    var pos = box ? box.selectionStart : null;
    renderResults();
    var nb = document.getElementById('q');
    if (nb && box) {
      nb.focus();
      try { if (pos !== null) { nb.setSelectionRange(pos, pos); } } catch (e) { /* ignore */ }
    }
  }

  function bestIn(list, mods, verdict) {
    var best = null;
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (r.v.verdict !== verdict || mods.indexOf(r.model.modality) < 0) { continue; }
      if (!best) { best = r; continue; }
      var tierRank = { flagship: 2, popular: 1, niche: 0 };
      var sa = (r.model.paramsB || 0) * (1 + 0.15 * (tierRank[r.model.tier] || 0));
      var sb = (best.model.paramsB || 0) * (1 + 0.15 * (tierRank[best.model.tier] || 0));
      if (sa > sb || (sa === sb && (r.model.release || '') > (best.model.release || ''))) { best = r; }
    }
    return best;
  }

  function headline(list, counts) {
    var chat = bestIn(list, ['text', 'reasoning', 'code', 'vision-language'], 'well') || bestIn(list, ['text', 'reasoning', 'code', 'vision-language'], 'slow');
    var where = state.target === 'browser' ? 'Right here in this browser' : 'With a free app installed';
    var s = '<p class="headline">' + esc(where) + ', this device runs <strong>' + counts.well + '</strong> of ' + (counts.well + counts.slow + counts.no) +
      ' models well and <strong>' + counts.slow + '</strong> slowly.';
    if (chat) {
      s += ' The most capable chat model it handles ' + (chat.v.verdict === 'well' ? 'comfortably' : '(slowly)') + ' is <strong>' + esc(chat.model.name) + '</strong>' +
        (chat.v.speed ? ' at ' + esc(speedText(chat.v.speed)) : '') + '.';
    } else {
      s += ' No chat model runs here' + (state.target === 'browser' ? '; try the installed-app view.' : '.');
    }
    return s + '</p>';
  }

  function verdictCards(counts) {
    var total = counts.well + counts.slow + counts.no || 1;
    var desc = {
      well: 'Fast enough to use comfortably.',
      slow: 'Works, but expect to wait.',
      no: 'Too big or too slow for this device.'
    };
    var h = '<div class="verdicts">';
    var keys = ['well', 'slow', 'no'];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      h += '<a class="vcard vcard-' + k + '" href="#g-' + k + '"><span class="n">' + counts[k] + '</span><span class="l">' + VERDICT_TEXT[k] + '</span><span class="d">' + desc[k] + '</span></a>';
    }
    h += '</div>';
    h += '<div class="bar" role="img" aria-label="' + counts.well + ' run well, ' + counts.slow + ' run slowly, ' + counts.no + " won't run\">" +
      '<span class="b-well" style="width:' + (counts.well / total * 100) + '%"></span>' +
      '<span class="b-slow" style="width:' + (counts.slow / total * 100) + '%"></span>' +
      '<span class="b-no" style="width:' + (counts.no / total * 100) + '%"></span></div>';
    return h;
  }

  function picks(list) {
    var h = '';
    var n = 0;
    for (var i = 0; i < PICKS.length; i++) {
      var p = PICKS[i];
      var r = bestIn(list, p.mods, 'well') || bestIn(list, p.mods, 'slow');
      if (!r) { continue; }
      n++;
      h += '<div class="pick"><div class="k">Best for ' + esc(p.label.toLowerCase()) + '</div><div class="m">' + esc(r.model.name) + '</div>' +
        '<div class="s' + (r.v.verdict === 'slow' ? ' slow' : '') + '">' + esc(r.v.verdict === 'slow' ? 'Slow: ' : '') + esc(r.v.speed ? speedText(r.v.speed) : VERDICT_TEXT[r.v.verdict]) + '</div></div>';
    }
    return n ? '<div class="picks" aria-label="Best picks for this device">' + h + '</div>' : '';
  }

  function controls(chipCounts, unavailable, totalModels) {
    var h = '<div class="controls">';
    h += '<div class="seg" role="group" aria-label="Where the model runs">' +
      '<button type="button" data-action="target" data-target="native" aria-pressed="' + (state.target === 'native') + '">Installed app</button>' +
      '<button type="button" data-action="target" data-target="browser" aria-pressed="' + (state.target === 'browser') + '">In this browser</button></div>';
    h += '<div class="grow"><label class="visually-hidden" for="q">Search models</label>' +
      '<input type="search" id="q" placeholder="Search models, e.g. qwen, whisper, flux" value="' + esc(state.query) + '" autocomplete="off"></div>';
    h += '</div>';
    h += '<div class="chips" role="group" aria-label="Filter by type">';
    for (var i = 0; i < FILTERS.length; i++) {
      var f = FILTERS[i];
      var cnt = chipCounts[f.id] || 0;
      if (!cnt && f.id !== 'all') { continue; }
      h += '<button type="button" class="chip" data-action="filter" data-filter="' + f.id + '" aria-pressed="' + (state.filter === f.id) + '">' + esc(f.label) + '<span class="count">' + cnt + '</span></button>';
    }
    h += '</div>';
    var b = current.budget.browser;
    var note = state.target === 'browser'
      ? b.reason + ' Only models with a ready-made browser version are listed (' + (totalModels - unavailable) + ' of ' + totalModels + '). The first run downloads the model into browser storage.'
      : 'Assumes a free app: Ollama or LM Studio on a computer, PocketPal or Google AI Edge Gallery on a phone, ComfyUI or Draw Things for images. Speeds use the standard 4-bit download.';
    h += '<p class="target-note">' + esc(note) + '</p>';
    return h;
  }

  function groupsHtml(filtered) {
    var h = '';
    var keys = ['well', 'slow', 'no'];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var list = sortGroup(filtered[k], k);
      h += '<section class="group" id="g-' + k + '" aria-labelledby="gh-' + k + '"><div class="group-head"><span class="tag tag-' + k + '">' + VERDICT_TEXT[k] + '</span>' +
        '<h3 id="gh-' + k + '">' + groupTitle(k) + '</h3><span class="count">' + list.length + '</span></div>';
      if (!list.length) {
        h += '<p class="empty">' + esc(emptyText(k)) + '</p>';
      } else {
        var limit = state.expanded[k] ? list.length : Math.min(list.length, LIMITS[k]);
        h += '<ul class="models">';
        for (var j = 0; j < limit; j++) { h += modelRow(list[j]); }
        h += '</ul>';
        if (list.length > limit) {
          h += '<button type="button" class="btn more" data-action="more" data-group="' + k + '">Show all ' + list.length + '</button>';
        }
      }
      h += '</section>';
    }
    return h;
  }

  function groupTitle(k) {
    return k === 'well' ? 'Ready to use' : (k === 'slow' ? 'Usable with patience' : 'Out of reach on this device');
  }

  function emptyText(k) {
    if (state.query) { return 'No models match your search here.'; }
    return k === 'well' ? 'Nothing in this category runs comfortably on this device.' :
      (k === 'slow' ? 'Nothing lands in between.' : 'Everything in this category fits.');
  }

  function speedText(sp) {
    if (!sp) { return ''; }
    if (sp.unit === 'tok/s') { return U.fmtRate(sp.value); }
    if (sp.unit === 'x realtime') { return (sp.value >= 10 ? Math.round(sp.value) : U.round(sp.value, 1)) + '× real time'; }
    var parts = sp.unit.split('/');
    return '~' + LAC.estimate.fmtSeconds(sp.value) + ' / ' + (parts[1] || 'run');
  }

  function sizeText(m) {
    if (!m.paramsB) { return ''; }
    var p = function (x) { return x >= 1 ? (x >= 100 ? Math.round(x) : U.round(x, 1)) + 'B' : Math.round(x * 1000) + 'M'; };
    var s = p(m.paramsB);
    if (m.activeB && m.activeB < m.paramsB * 0.8) { s += ' (' + p(m.activeB) + ' active)'; }
    return s;
  }

  var MOD_NAMES = {
    'text': 'Chat', 'reasoning': 'Reasoning', 'code': 'Coding', 'vision-language': 'Vision + chat',
    'image-generation': 'Image generation', 'video-generation': 'Video generation', 'speech-to-text': 'Speech to text',
    'text-to-speech': 'Text to speech', 'embedding': 'Embeddings', 'music-audio': 'Music & audio'
  };

  function modelRow(r) {
    var m = r.model, v = r.v;
    var meta = [m.developer, sizeText(m), MOD_NAMES[m.modality] || m.modality, m.release].filter(function (x) { return !!x; }).join(' · ');
    var figs = '';
    if (v.speed) { figs += '<span class="speed">' + esc(speedText(v.speed)) + '</span>'; }
    if (v.memGB) { figs += '<span class="mem">needs ' + esc(U.fmtGB(v.memGB)) + '</span>'; }
    var h = '<li class="model v-' + v.verdict + '"><div class="model-head"><span class="model-name">' + esc(m.name) + '</span> <span class="model-meta">' + esc(meta) + '</span></div>' +
      '<div class="model-figs">' + figs + '</div>' +
      '<div class="model-foot"><span class="model-reason">' + esc(v.reason) + (v.q8 ? ' The higher-quality 8-bit build also runs well (' + esc(U.fmtRate(v.q8.tps)) + ').' : '') + '</span>' +
      (v.verdict !== 'no' ? howTo(m) : '') + '</div>';
    return h + '</li>';
  }

  function howTo(m) {
    var d = current.device;
    var os = d ? d.ua.os : 'other';
    var mobile = d && d.ua.formFactor !== 'desktop';
    var parts = [];
    if (state.target === 'browser') {
      if (m.browser && m.browser.webllm) {
        parts.push('<a href="https://chat.webllm.ai/" target="_blank" rel="noopener">Open in WebLLM Chat</a> <span class="model-meta">(pick ' + esc(m.browser.webllm) + ')</span>');
      } else if (m.browser && m.browser.tjs) {
        parts.push('Runs with <a href="https://huggingface.co/docs/transformers.js" target="_blank" rel="noopener">Transformers.js</a>' + (m.browser.demo ? ' · <a href="' + esc(m.browser.demo) + '" target="_blank" rel="noopener">try the demo</a>' : ''));
      } else if (m.browser && m.browser.other) {
        parts.push(esc(m.browser.other));
      }
    } else if (m.kind === 'llm') {
      if (mobile) {
        parts.push(os === 'ios' || os === 'ipados' ? 'Use PocketPal AI or Private LLM from the App Store' : 'Use PocketPal AI or Google AI Edge Gallery');
      } else if (m.ollama) {
        parts.push('<span class="cmd"><code>ollama run ' + esc(m.ollama) + '</code><button type="button" data-action="copy" data-copy="ollama run ' + esc(m.ollama) + '">Copy</button></span>');
        parts.push('or search "' + esc(m.family || m.name) + '" in LM Studio');
      } else {
        parts.push('Search "' + esc(m.name) + '" in LM Studio');
      }
    } else if (m.kind === 'diffusion') {
      parts.push(os === 'mac' || os === 'ios' || os === 'ipados' ? 'Use Draw Things (App Store) or ComfyUI' : 'Use ComfyUI');
    } else if (m.modality === 'speech-to-text') {
      parts.push(/whisper/i.test(m.name) ? 'Use whisper.cpp, or an app built on it' : 'See the model page for runtimes');
    } else if (m.ollama) {
      parts.push('<span class="cmd"><code>ollama pull ' + esc(m.ollama) + '</code><button type="button" data-action="copy" data-copy="ollama pull ' + esc(m.ollama) + '">Copy</button></span>');
    }
    if (m.source) { parts.push('<a href="' + esc(m.source) + '" target="_blank" rel="noopener">Model page</a>'); }
    return parts.length ? '<span class="model-how">' + parts.join(' ') + '</span>' : '';
  }

  function onResultsClick(ev) {
    var t = ev.target;
    while (t && t !== els.resultsBody && !(t.getAttribute && t.getAttribute('data-action'))) { t = t.parentNode; }
    if (!t || t === els.resultsBody) { return; }
    var a = t.getAttribute('data-action');
    if (a === 'target') {
      state.target = t.getAttribute('data-target') === 'browser' ? 'browser' : 'native';
      state.expanded = { well: false, slow: false, no: false };
      saveView();
      renderResults();
    } else if (a === 'filter') {
      state.filter = t.getAttribute('data-filter');
      state.expanded = { well: false, slow: false, no: false };
      saveView();
      renderResults();
    } else if (a === 'more') {
      state.expanded[t.getAttribute('data-group')] = true;
      renderResults();
    } else if (a === 'copy') {
      copyText(t.getAttribute('data-copy'), t);
    }
  }

  var inputTimer = null;
  function onResultsInput(ev) {
    var t = ev.target;
    if (!t || t.id !== 'q') { return; }
    state.query = t.value;
    if (inputTimer) { clearTimeout(inputTimer); }
    inputTimer = setTimeout(rerenderGroupsOnly, 150);
  }

  function copyText(text, btn) {
    function done(ok) {
      var old = btn.textContent;
      btn.textContent = ok ? 'Copied' : 'Select & copy';
      setTimeout(function () { btn.textContent = old; }, 1600);
    }
    function fallback() {
      try {
        var code = btn.parentNode.querySelector('code');
        var range = document.createRange();
        range.selectNodeContents(code);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        done(document.execCommand && document.execCommand('copy'));
      } catch (e) { done(false); }
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
        return;
      }
    } catch (e) { /* fall through */ }
    fallback();
  }

  // ---------------------------------------------------------------- method section

  function renderMethod() {
    if (!els.method || !LAC.estimate) { return; }
    var T = LAC.estimate.THRESHOLDS;
    var rows = [
      ['Chat, coding, vision', '≥ ' + T.llm.well + ' tok/s', T.llm.slow + '–' + T.llm.well + ' tok/s'],
      ['Reasoning (long "thinking" output)', '≥ ' + T.reasoning.well + ' tok/s', T.reasoning.slow + '–' + T.reasoning.well + ' tok/s'],
      ['Image generation', '≤ ' + T.image.well + ' s per image', 'up to ' + T.image.slow / 60 + ' min per image'],
      ['Video generation (short clip)', '≤ ' + T.video.well / 60 + ' min', 'up to ' + T.video.slow / 60 + ' min'],
      ['Speech to text', '≥ ' + T.speech.well + '× real time', T.speech.slow + '–' + T.speech.well + '× real time'],
      ['Text to speech', '≥ ' + T.tts.well + '× real time', T.tts.slow + '–' + T.tts.well + '× real time']
    ];
    var h = '<p>A language model writes one token (about ¾ of a word) at a time, and every token requires reading all of its <em>active</em> weights from memory. Speed is therefore close to <strong>memory bandwidth ÷ model size</strong>. A graphics card with its own memory (VRAM) is fast; system RAM is several times slower; Apple and phone chips sit in between because the GPU shares fast unified memory.</p>';
    h += '<p>For each model the check adds the 4-bit download size, a cache for about 4,000 tokens of conversation, and runtime overhead, then asks where it fits: entirely in fast memory, split between VRAM and RAM, or not at all. Mixture-of-experts models (shown as "30B (3B active)") must fit whole but only read their active part per token, so they run much faster than their size suggests. Image and video models are limited by raw compute instead, so their times come from the chip\'s processing power.</p>';
    h += '<div class="table-wrap"><table class="thresholds"><thead><tr><th>Task</th><th>Runs well</th><th>Runs slowly</th></tr></thead><tbody>';
    for (var i = 0; i < rows.length; i++) { h += '<tr><th>' + esc(rows[i][0]) + '</th><td>' + esc(rows[i][1]) + '</td><td>' + esc(rows[i][2]) + '</td></tr>'; }
    h += '</tbody></table></div>';
    h += '<p>Anything slower, or anything that does not fit in memory, is listed as <strong>won\'t run</strong>. Models that fit only after closing other apps are listed as slow. Browsers hide some details (Safari and Firefox do not report RAM; some hide the graphics chip), so the check says how sure it is about each value and lets you correct it.</p>';
    els.method.innerHTML = h;
  }

  LAC.ui = {
    init: init,
    progress: progress,
    resetProgress: resetProgress,
    renderDevice: renderDevice,
    renderResults: renderResults,
    onOverride: function (fn) { overrideHandler = fn; },
    onRescan: function (fn) { rescanHandler = fn; },
    showRescan: function (show) { if (els.rescan) { els.rescan.hidden = !show; } },
    _speedText: speedText
  };
})(window.LAC = window.LAC || {});
