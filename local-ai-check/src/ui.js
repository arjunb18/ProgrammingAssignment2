/*
 * Rendering. Plain DOM + HTML strings (escaped) so it runs everywhere. ES5 only.
 *
 * Controls the user is operating (the search box, the "Correct the details" dropdowns) are built
 * once and never replaced, so typing, IME composition and keyboard focus survive re-renders.
 * Everything else is re-rendered from state; after a re-render the clicked control gets focus back.
 */
(function (LAC) {
  'use strict';

  var U = LAC.util;
  var esc = U.esc;

  var els = {};
  var overrideHandler = null;
  var rescanHandler = null;
  var current = { device: null, budget: null, all: null };
  var state = {
    target: 'native',
    filter: 'all',
    query: '',
    expanded: { well: false, slow: false, no: false }
  };
  var lastCounts = null;   // verdict counts of the last full render, for the "scan finished" announcement
  var askShown = false;    // the RAM question was shown during this scan (keep it after an answer)
  var fixBuilt = false;    // the "Correct the details" panel exists (rebuilt only by a new scan)
  var legendOpen = false;

  var FILTERS = [
    { id: 'all', label: 'All', mods: null },
    { id: 'chat', label: 'Chat, reasoning & code', mods: ['text', 'reasoning', 'code'] },
    { id: 'vision', label: 'Vision', mods: ['vision-language'] },
    { id: 'image', label: 'Image generation', mods: ['image-generation'] },
    { id: 'video', label: 'Video generation', mods: ['video-generation'] },
    { id: 'speech', label: 'Speech', mods: ['speech-to-text', 'text-to-speech'] },
    { id: 'other', label: 'Embeddings & music', mods: ['embedding', 'music-audio'] }
  ];

  // PICKS[0] also drives the headline's "most capable chat model", so the two always agree.
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
  var TOKS_TITLE = 'tokens per second: a token is about 3/4 of a word';

  // App store pages for the phone apps the page recommends.
  var APPS = {
    pocketpalIos: 'https://apps.apple.com/app/pocketpal-ai/id6502579498',
    pocketpalAndroid: 'https://play.google.com/store/apps/details?id=com.pocketpalai',
    privateLlm: 'https://privatellm.app/',
    edgeGallery: 'https://play.google.com/store/apps/details?id=com.google.ai.edge.gallery',
    drawThings: 'https://drawthings.ai/',
    comfy: 'https://www.comfy.org/'
  };

  function $(id) { return document.getElementById(id); }

  function init() {
    els.probes = $('probes');
    els.scanDetails = $('scan-details');
    els.scanSummary = $('scan-summary');
    els.status = $('sr-status');
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

  // Screen readers hear this once; the probe list itself is not a live region (it changes 18 times).
  function announce(text) {
    if (!els.status) { return; }
    els.status.textContent = '';
    setTimeout(function () { els.status.textContent = text; }, 50);
  }

  // Moves focus back to a control after the region holding it was re-rendered.
  function refocus(selector) {
    try {
      var el = els.resultsBody && els.resultsBody.querySelector(selector);
      if (el && el.focus) { el.focus(); }
    } catch (e) { /* ignore */ }
  }

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
    askShown = false;
    fixBuilt = false;
    if (els.scanDetails) { els.scanDetails.open = true; }
    if (els.scanSummary) { els.scanSummary.textContent = 'Checking this device…'; }
    if (!els.probes) { return; }
    var items = els.probes.querySelectorAll('.probe');
    for (var i = 0; i < items.length; i++) {
      items[i].removeAttribute('data-status');
      var d = items[i].querySelector('.probe-detail');
      if (d) { d.textContent = 'Waiting…'; }
    }
  }

  // The scan finished and results are on screen: fold the checklist into its one-line summary
  // so the answer sits right under the title. Focus and scroll position are left alone.
  function scanDone() {
    if (els.rescan) { els.rescan.hidden = false; }
    if (els.scanDetails && current.budget) { els.scanDetails.open = false; }
    if (lastCounts) {
      announce('Scan finished. ' + lastCounts.well + ' models run well, ' + lastCounts.slow + ' slowly, ' + lastCounts.no + " won't run.");
    }
  }

  // ---------------------------------------------------------------- device plate

  var OS_NAMES = { windows: 'Windows', mac: 'macOS', linux: 'Linux', android: 'Android', ios: 'iOS', ipados: 'iPadOS', chromeos: 'ChromeOS',
    kaios: 'KaiOS', harmonyos: 'HarmonyOS', other: 'Unknown OS' };

  function deviceTitle(d) {
    var ua = d.ua;
    var os = OS_NAMES[ua.os] || 'Unknown OS';
    var ff = ua.os === 'ios' ? 'iPhone' : (ua.os === 'ipados' ? 'iPad' : (ua.formFactor === 'phone' ? (ua.os === 'android' ? 'Android phone' : 'Phone') : (ua.formFactor === 'tablet' ? 'Tablet' : 'Computer')));
    if (ua.os === 'mac') { ff = 'Mac'; }
    if (ua.os === 'chromeos') { ff = 'Chromebook'; }
    var t = ff;
    if (ua.model) { t += ' · ' + ua.model; }
    if (ff !== 'iPhone' && ff !== 'iPad' && ff !== 'Mac') { t += ' · ' + os + (ua.osVersion ? ' ' + ua.osVersion : ''); }
    else if (ua.osVersion) { t += ' · ' + os + ' ' + ua.osVersion; }
    return t;
  }

  // A value the user entered is labelled as theirs, not as "detected".
  function conf(level, source) {
    if (source === 'user') { return '<span class="conf conf-user">you set</span>'; }
    var label = level === 'high' ? 'detected' : (level === 'medium' ? 'likely' : 'guess');
    return '<span class="conf conf-' + esc(level) + '">' + label + '</span>';
  }

  function spec(label, valueHtml, hint) {
    return '<div class="spec"><dt>' + esc(label) + '</dt><dd>' + valueHtml +
      (hint ? '<span class="spec-hint">' + esc(hint) + '</span>' : '') + '</dd></div>';
  }

  function renderDevice(d, b) {
    current.device = d;
    current.budget = b;
    current.all = null;
    if (!els.deviceBody) { return; }
    // The plate's facts are re-rendered; the correction panel below them is built once per scan.
    if (!$('plate-info') || !fixBuilt) {
      els.deviceBody.innerHTML = '<div class="plate"><div id="plate-info"></div><div id="plate-fix"></div></div>';
      $('plate-fix').innerHTML = fixBlock(d);
      fixBuilt = true;
    } else {
      syncFix();
    }
    var e = d.gpu.entry;
    var html = '';
    html += '<div class="plate-head"><div><div class="plate-title">' + esc(deviceTitle(d)) + '</div>' +
      '<div class="plate-sub">' + esc(d.ua.browser + (d.ua.browserVersion ? ' ' + d.ua.browserVersion : '')) + '</div></div>' +
      '<div class="plate-sub mono">' + esc(b.native.label) + '</div></div>';

    html += '<dl class="specs">';
    var cpuTxt = (d.cpu.cores ? d.cpu.cores + ' threads' : 'Cores hidden') + (d.cpu.arch ? ' · ' + (d.cpu.arch === 'arm' ? 'ARM' : 'x86-64') : '');
    if (d.cpu.score) { cpuTxt += ' · speed ' + U.round(d.cpu.score, 2) + '×'; }
    html += spec('Processor', '<span class="val">' + esc(cpuTxt) + '</span>', d.cpu.score ? 'Speed 1× = a typical 2020 laptop.' : '');
    html += spec('Memory (RAM)', '<span class="val">' + esc(U.fmtGB(d.memory.estimatedGB)) + '</span>' +
      (d.memory.capped && d.memory.source === 'deviceMemory' ? ' <span class="plate-sub">or more</span>' : '') + conf(d.memory.confidence, d.memory.source));
    var gpuTxt = e ? e.name : (d.gpu.name || 'Not identified');
    var gpuSub = '';
    if (e) {
      var memTxt = e.vramGB > 0 ? U.fmtGB(e.vramGB) + ' graphics memory (VRAM)' : 'shares the system memory';
      gpuSub = '<div class="val plate-sub">' + esc(memTxt + (e.bandwidthGBs ? ' · ' + Math.round(e.bandwidthGBs) + ' GB/s' : '')) + '</div>';
    }
    html += spec('Graphics', esc(gpuTxt) + conf(e ? d.gpu.confidence : 'low', d.gpu.source) + gpuSub,
      e && e.bandwidthGBs ? 'GB/s = how fast it reads memory; AI speed mostly follows it.' : '');
    html += spec('WebGPU', esc(d.webgpu.available ? (d.webgpu.isFallback ? 'Software only' : 'Yes' + (d.webgpu.shaderF16 ? ', with fast half-precision math' : ', without fast half-precision math')) : 'No'),
      'Lets web pages use the graphics chip.');
    var nb = b.native;
    var fast = nb.gpuMemGB > 0 ? U.fmtGB(nb.gpuMemGB) + (nb.unified ? ' usable by the GPU' : ' graphics memory') : U.fmtGB(nb.cpuMemGB) + ' of RAM';
    html += spec('Room for models', '<span class="val">' + esc(fast) + (nb.gpuMemGB > 0 && nb.cpuMemGB > 0 ? ' + ' + esc(U.fmtGB(nb.cpuMemGB)) + ' RAM' : '') + '</span>',
      'What is left for a model after the system and other apps.');
    html += spec('In this browser', esc(b.browser.possible ? (b.browser.mode === 'webgpu' ? 'Up to ~' + U.fmtGB(b.browser.memGB) + ' via WebGPU' : 'Small models via WebAssembly') : 'Not supported'));
    html += '</dl>';
    if (d.builtInAI) {
      var aiTxt = { available: 'is ready to use', downloadable: 'is supported here (not downloaded yet)', downloading: 'is downloading', unavailable: 'is not supported on this device' }[d.builtInAI] || d.builtInAI;
      html += '<p class="plate-sub plate-note">Chrome\'s built-in Gemini Nano ' + esc(aiTxt) + '.</p>';
    }

    if (d.notes && d.notes.length) {
      html += '<ul class="notes">';
      for (var i = 0; i < d.notes.length; i++) { html += '<li>' + esc(d.notes[i]) + '</li>'; }
      html += '</ul>';
    }
    $('plate-info').innerHTML = html;
    els.device.hidden = false;
    if (els.scanSummary) { els.scanSummary.textContent = scanSummary(d); }
  }

  // One line that stands in for the folded probe checklist.
  function scanSummary(d) {
    var e = d.gpu.entry;
    var gpu = e ? e.name : (d.gpu.name || 'graphics chip not identified');
    return 'Scanned: ' + deviceTitle(d) + ' · ' + gpu + ' · ' + U.fmtGB(d.memory.estimatedGB) + ' RAM';
  }

  // A one-click question when the browser hid the RAM amount. It sits with the results because
  // the answer changes them; after an answer it stays, showing the choice.
  function askBlock(d) {
    if (d.memory.source === 'user' ? !askShown : d.memory.confidence === 'high') { return ''; }
    askShown = true;
    var picks = d.ua.formFactor === 'desktop' ? [8, 16, 24, 32, 48, 64, 96, 128] : [3, 4, 6, 8, 12, 16];
    var q = d.memory.source === 'user' ? 'Using the ' + esc(U.fmtGB(d.memory.estimatedGB)) + ' of RAM you picked.' :
      'How much RAM does this device have? Your browser ' +
      (d.memory.capped ? 'only reports "at least ' + esc(d.memory.reportedGB) + ' GB".' : 'does not say, so this assumes ' + esc(U.fmtGB(d.memory.estimatedGB)) + '.') + ' Pick it to sharpen the results.';
    var h = '<div class="asks" role="group" aria-labelledby="ask-q"><p id="ask-q">' + q + '</p><div class="ram-picks">';
    for (var i = 0; i < picks.length; i++) {
      var on = d.memory.source === 'user' && picks[i] === d.memory.estimatedGB;
      h += '<button type="button" class="chip" data-action="ram" data-gb="' + picks[i] + '" aria-pressed="' + (on ? 'true' : 'false') + '">' + picks[i] + ' GB</button>';
    }
    h += '</div></div>';
    return h;
  }

  function currentOverrides() { return U.storage.get('overrides') || {}; }

  function fixBlock(d) {
    var ov = currentOverrides();
    var open = d.gpu.confidence === 'low' || !!(ov.ramGB || ov.gpuName);
    var h = '<details class="fix" id="fix"' + (open ? ' open' : '') + '><summary>Correct the details</summary><div class="fix-body">';
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

  // Keeps the (never rebuilt) dropdowns in step with corrections made elsewhere (RAM chips, Reset).
  function syncFix() {
    var ov = currentOverrides();
    var r = $('ov-ram'), g = $('ov-gpu');
    var rv = ov.ramGB ? String(ov.ramGB) : '';
    var gv = ov.gpuName || '';
    if (r && r.value !== rv) { r.value = rv; }
    if (g && g.value !== gv) { g.value = gv; }
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
    if (t.getAttribute('data-action') === 'reset-ov') {
      emitOverride({});
      announce('Corrections cleared; using the detected values.');
    }
  }

  // Chromium on Windows and Linux fires 'change' on every arrow key in a closed select, so the
  // recompute waits for a pause. The select itself is never rebuilt, so focus stays put.
  var changeTimer = null;
  function onDeviceChange(ev) {
    var t = ev.target;
    if (!t || (t.id !== 'ov-ram' && t.id !== 'ov-gpu')) { return; }
    if (changeTimer) { clearTimeout(changeTimer); }
    changeTimer = setTimeout(function () {
      changeTimer = null;
      var ov = currentOverrides();
      var r = $('ov-ram'), g = $('ov-gpu');
      if (r && r.value) { ov.ramGB = parseFloat(r.value); } else { delete ov.ramGB; }
      if (g && g.value) { ov.gpuName = g.value; } else { delete ov.gpuName; }
      emitOverride(ov);
      if (lastCounts) { announce('Results updated: ' + lastCounts.well + ' run well, ' + lastCounts.slow + ' slowly, ' + lastCounts.no + " won't run."); }
    }, 300);
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

  // Classifies every model once per device/target; searching reuses the result.
  function computeAll() {
    if (!current.all || current.all.target !== state.target) {
      current.all = { target: state.target, list: LAC.estimate.classifyAll(LAC.MODELS || [], current.budget, state.target) };
    }
    return current.all.list;
  }

  function compute() {
    var all = computeAll();
    var browser = state.target === 'browser';
    var visible = [];
    var unavailable = 0;
    for (var i = 0; i < all.length; i++) {
      if (browser && all[i].v.unavailable) { unavailable++; continue; }
      visible.push(all[i]);
    }
    var counts = { well: 0, slow: 0, no: 0 };
    var chipCounts = {};
    for (var k = 0; k < visible.length; k++) {
      var r = visible[k];
      counts[r.v.verdict]++;
      for (var f = 0; f < FILTERS.length; f++) {
        var fm = FILTERS[f].mods;
        if (!fm || fm.indexOf(r.model.modality) >= 0) { chipCounts[FILTERS[f].id] = (chipCounts[FILTERS[f].id] || 0) + 1; }
      }
    }
    // A saved filter whose chip is hidden in this view (no such models here) falls back to "All"
    // for display only; the saved preference is kept for when its models come back.
    var filter = state.filter !== 'all' && !chipCounts[state.filter] ? 'all' : state.filter;
    var mods = modsFor(filter);
    var filtered = { well: [], slow: [], no: [] };
    for (var j = 0; j < visible.length; j++) {
      var v = visible[j];
      if (mods && mods.indexOf(v.model.modality) < 0) { continue; }
      if (!matchesQuery(v.model, state.query)) { continue; }
      filtered[v.v.verdict].push(v);
    }
    return { all: all, visible: visible, unavailable: unavailable, counts: counts, chipCounts: chipCounts, filter: filter, filtered: filtered };
  }

  // Builds the parts of the results that must survive re-renders (the search box) once.
  function ensureResultsFrame() {
    if ($('q') && $('r-summary')) { return; }
    els.resultsBody.innerHTML =
      '<div id="r-view"></div>' +
      '<div id="r-summary"></div>' +
      '<div class="controls"><div class="grow"><label class="visually-hidden" for="q">Search models</label>' +
      '<input type="search" id="q" placeholder="Search models, e.g. qwen, whisper, flux" autocomplete="off"></div>' +
      '<div id="r-chips" class="chips" role="group" aria-label="Filter by type"></div></div>' +
      '<p class="target-note" id="r-note"></p>' +
      '<div id="groups"></div>';
    var q = $('q');
    q.value = state.query;
    // Input events also fire mid-composition (Chinese/Japanese/Korean IMEs, Android keyboards);
    // wait for the composed text before filtering.
    q.addEventListener('compositionend', function () { state.query = q.value; scheduleGroups(); });
  }

  function renderResults(d, b) {
    if (d) { current.device = d; }
    if (b) { current.budget = b; current.all = null; }
    if (!els.resultsBody || !current.budget) { return; }
    ensureResultsFrame();
    var c = compute();
    var lg = $('legend');
    if (lg) { legendOpen = !!lg.open; }

    $('r-view').innerHTML = viewToggle();
    var html = headline(c.visible, c.counts);
    html += verdictCards(c.counts);
    html += legend();
    if (current.device) { html += askBlock(current.device) + gpuPrompt(current.device); }
    html += picks(c.visible);
    $('r-summary').innerHTML = html;
    $('r-chips').innerHTML = chips(c.chipCounts, c.filter);
    $('r-note').textContent = targetNote(c.unavailable, c.all.length);
    $('groups').innerHTML = groupsHtml(c.filtered);
    lastCounts = c.counts;
    els.results.hidden = false;
    return c;
  }

  var inputTimer = null;
  function scheduleGroups() {
    if (inputTimer) { clearTimeout(inputTimer); }
    inputTimer = setTimeout(rerenderGroupsOnly, 150);
  }

  // Search only changes the lists; the search box and everything above it stay as they are.
  function rerenderGroupsOnly() {
    inputTimer = null;
    if (!current.budget || !$('groups')) { return; }
    var c = compute();
    $('groups').innerHTML = groupsHtml(c.filtered);
    announceFiltered(c.filtered);
  }

  function announceFiltered(f) {
    announce('Showing ' + f.well.length + ' that run well, ' + f.slow.length + ' slowly, ' + f.no.length + " that won't run" +
      (state.query ? ' for "' + state.query + '"' : '') + '.');
  }

  // Models a visitor can actually use for the job: not captioning-only models, and in the
  // installed-app view not models that need a special fork of the runtime.
  function usable(m) {
    if (m.chat === false) { return false; }
    if (state.target === 'native' && m.needsFork) { return false; }
    return true;
  }

  function bestIn(list, mods, verdict) {
    var best = null;
    var tierRank = { flagship: 2, popular: 1, niche: 0 };
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (r.v.verdict !== verdict || mods.indexOf(r.model.modality) < 0 || !usable(r.model)) { continue; }
      if (!best) { best = r; continue; }
      var sa = (r.model.paramsB || 0) * (1 + 0.15 * (tierRank[r.model.tier] || 0));
      var sb = (best.model.paramsB || 0) * (1 + 0.15 * (tierRank[best.model.tier] || 0));
      if (sa > sb || (sa === sb && (r.model.release || '') > (best.model.release || ''))) { best = r; }
    }
    return best;
  }

  function bestOf(list, mods) { return bestIn(list, mods, 'well') || bestIn(list, mods, 'slow'); }

  function headline(list, counts) {
    var kind = 'chat model';
    var chat = bestOf(list, PICKS[0].mods);
    if (!chat) { chat = bestOf(list, ['reasoning', 'code']); kind = 'model'; }
    var where = state.target === 'browser' ? 'Right here in this browser' : 'With a free app installed';
    var s = '<p class="headline">' + esc(where) + ', this device runs <strong>' + counts.well + '</strong> of ' + (counts.well + counts.slow + counts.no) +
      ' models well and <strong>' + counts.slow + '</strong> slowly.';
    if (chat) {
      s += ' The most capable ' + kind + ' it handles ' + (chat.v.verdict === 'well' ? 'comfortably' : '(slowly)') + ' is <strong>' + esc(chat.model.name) + '</strong>' +
        (chat.v.speed ? ' at ' + speedHtml(chat.v.speed) : '') + '.';
    } else {
      s += ' No chat model runs here' + (state.target === 'browser' ? '; try the installed-app view.' : '.');
    }
    return s + '</p>';
  }

  function viewToggle() {
    return '<div class="view"><span class="view-label" id="view-label">Run models with</span>' +
      '<div class="seg" role="group" aria-labelledby="view-label">' +
      '<button type="button" data-action="target" data-target="native" aria-pressed="' + (state.target === 'native') + '">An installed app</button>' +
      '<button type="button" data-action="target" data-target="browser" aria-pressed="' + (state.target === 'browser') + '">This browser</button></div></div>';
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

  // Plain-words key to the units and names used in the lists, next to where they first appear.
  function legend() {
    return '<details class="legend" id="legend"' + (legendOpen ? ' open' : '') + '><summary>What the numbers mean</summary><dl>' +
      '<div><dt>tok/s</dt><dd>Tokens per second, the writing speed. A token is about ¾ of a word. People read 4–6 words a second, so 10 tok/s or more feels quick.</dd></div>' +
      '<div><dt>8B, 350M</dt><dd>Model size in billions (B) or millions (M) of parameters. Bigger is usually smarter but needs more memory.</dd></div>' +
      '<div><dt>30B-A3B, “3B active”</dt><dd>A mixture-of-experts model: all 30B must fit in memory, but only 3B are used for each word, so it runs about as fast as a 3B model.</dd></div>' +
      '<div><dt>4-bit, 8-bit</dt><dd>How compressed the download is. 4-bit, the usual download, is about a quarter of the full size with a small loss in quality.</dd></div>' +
      '<div><dt>VRAM</dt><dd>A graphics card\'s own memory. It is much faster than normal RAM, so models that fit in it run fastest.</dd></div>' +
      '<div><dt>× real time</dt><dd>For speech: 10× means an hour of audio takes about 6 minutes.</dd></div>' +
      '</dl></details>';
  }

  // Points at the correction panel when the graphics chip is only a guess.
  function gpuPrompt(d) {
    if (d.gpu.source === 'user' || d.gpu.confidence !== 'low') { return ''; }
    return '<p class="sharpen">The graphics chip is a guess. <a href="#fix" data-action="open-fix">Pick the right one</a> to sharpen the results.</p>';
  }

  function picks(list) {
    var h = '';
    var n = 0;
    for (var i = 0; i < PICKS.length; i++) {
      var p = PICKS[i];
      var r = bestOf(list, p.mods);
      if (!r) { continue; }
      n++;
      h += '<div class="pick"><div class="k">Best for ' + esc(p.label.toLowerCase()) + '</div><div class="m">' + esc(r.model.name) + '</div>' +
        '<div class="s' + (r.v.verdict === 'slow' ? ' slow' : '') + '">' + esc(r.v.verdict === 'slow' ? 'Slow: ' : '') + (r.v.speed ? speedHtml(r.v.speed) : esc(VERDICT_TEXT[r.v.verdict])) + '</div></div>';
    }
    return n ? '<div class="picks" role="group" aria-label="Best picks for this device">' + h + '</div>' : '';
  }

  function chips(chipCounts, filter) {
    var h = '';
    for (var i = 0; i < FILTERS.length; i++) {
      var f = FILTERS[i];
      var cnt = chipCounts[f.id] || 0;
      if (!cnt && f.id !== 'all') { continue; }
      h += '<button type="button" class="chip" data-action="filter" data-filter="' + f.id + '" aria-pressed="' + (filter === f.id) + '">' + esc(f.label) + '<span class="count">' + cnt + '</span></button>';
    }
    return h;
  }

  function targetNote(unavailable, totalModels) {
    var b = current.budget.browser;
    return state.target === 'browser'
      ? b.reason + ' Only models with a ready-made browser version are listed (' + (totalModels - unavailable) + ' of ' + totalModels + '). The first run downloads the model into browser storage.'
      : 'Assumes a free app: Ollama or LM Studio on a computer, PocketPal or Google AI Edge Gallery on a phone, ComfyUI or Draw Things for images. Speeds use the standard 4-bit download.';
  }

  function groupsHtml(filtered) {
    var h = '';
    var keys = ['well', 'slow', 'no'];
    var none = !filtered.well.length && !filtered.slow.length && !filtered.no.length;
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var list = sortGroup(filtered[k], k);
      h += '<section class="group" id="g-' + k + '" aria-labelledby="gh-' + k + '"><div class="group-head"><span class="tag tag-' + k + '">' + VERDICT_TEXT[k] + '</span>' +
        '<h3 id="gh-' + k + '">' + groupTitle(k) + '</h3><span class="count">' + list.length + '</span></div>';
      if (!list.length) {
        h += '<p class="empty">' + esc(emptyText(k, none)) + '</p>';
      } else {
        var limit = state.expanded[k] ? list.length : Math.min(list.length, LIMITS[k]);
        h += '<ul class="models">';
        for (var j = 0; j < limit; j++) { h += modelRow(list[j]); }
        h += '</ul>';
        if (list.length > limit) {
          h += '<button type="button" class="btn more" data-action="more" data-group="' + k + '">Show all ' + list.length + '</button>';
        }
      }
      if (k === 'no' && state.target === 'browser') {
        h += '<p class="empty switch">Many models that are not available in a browser run with an installed app. ' +
          '<button type="button" class="btn" data-action="target" data-target="native">See installed-app results</button></p>';
      }
      h += '</section>';
    }
    return h;
  }

  function groupTitle(k) {
    if (k === 'no' && state.target === 'browser') { return 'Not in this browser'; }
    return k === 'well' ? 'Ready to use' : (k === 'slow' ? 'Usable with patience' : 'Out of reach on this device');
  }

  function emptyText(k, none) {
    if (state.query) { return 'No models match your search here.'; }
    if (none) { return 'No models of this type are listed here.'; }
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

  // speedText as HTML, with "tok/s" explained on hover (the legend explains it for touch).
  function speedHtml(sp) {
    return esc(speedText(sp)).replace('tok/s', '<abbr title="' + TOKS_TITLE + '">tok/s</abbr>');
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
    var modName = (m.chat === false && m.modality === 'vision-language') ? 'Vision (not chat)' : (MOD_NAMES[m.modality] || m.modality);
    var meta = [m.developer, sizeText(m), modName, m.release].filter(function (x) { return !!x; }).join(' · ');
    var figs = '';
    if (v.speed) { figs += '<span class="speed">' + speedHtml(v.speed) + '</span>'; }
    if (v.memGB) { figs += '<span class="mem">needs ' + esc(U.fmtGB(v.memGB)) + '</span>'; }
    // tabindex=-1 lets "Show all" move focus to the first newly shown row.
    var h = '<li class="model v-' + v.verdict + '" tabindex="-1"><div class="model-head"><span class="model-name">' + esc(m.name) + '</span> <span class="model-meta">' + esc(meta) + '</span></div>' +
      '<div class="model-figs">' + figs + '</div>' +
      '<div class="model-foot"><span class="model-reason">' + esc(v.reason) + (v.q8 ? ' The higher-quality 8-bit build also runs well (' + esc(U.fmtRate(v.q8.tps)) + ').' : '') + '</span>' +
      (v.verdict !== 'no' ? howTo(m) : '') + '</div>';
    return h + '</li>';
  }

  function link(href, text) {
    return '<a href="' + esc(href) + '" target="_blank" rel="noopener">' + esc(text) + '</a>';
  }

  function copyCmd(cmd) {
    return '<span class="cmd"><code>' + esc(cmd) + '</code><button type="button" data-action="copy" data-label="Copy" data-copy="' + esc(cmd) +
      '" aria-label="Copy command: ' + esc(cmd) + '">Copy</button></span>';
  }

  // A sentence with links inside must stay one flex item, or .model-how splits it into pieces.
  function sentence(html) { return '<span>' + html + '</span>'; }

  function howTo(m) {
    var d = current.device;
    var os = d ? d.ua.os : 'other';
    var apple = os === 'ios' || os === 'ipados';
    var mobile = d && d.ua.formFactor !== 'desktop';
    var find = 'then search "' + esc(m.family || m.name) + '" in the app';
    var parts = [];
    if (state.target === 'browser') {
      var b = current.budget && current.budget.browser;
      var build = m.browser && m.browser.webllm ? LAC.estimate.webllmBuild(m, !!(b && b.shaderF16)) : null;
      if (build) {
        parts.push(link('https://chat.webllm.ai/', 'Open in WebLLM Chat') + ' <span class="model-meta">(pick ' + esc(build.id) + ')</span>');
      } else if (m.browser && m.browser.tjs) {
        parts.push(m.browser.demo ? link(m.browser.demo, 'Try it in the browser demo') :
          sentence('No ready-made web page yet (developer library: ' + link('https://huggingface.co/docs/transformers.js', 'Transformers.js') + ')'));
      } else if (m.browser && m.browser.other) {
        parts.push(esc(m.browser.other));
      }
    } else if (m.kind === 'llm') {
      if (mobile) {
        // KaiOS and HarmonyOS NEXT have no Google Play, so they get no store links.
        parts.push(sentence(apple ? 'Get ' + link(APPS.pocketpalIos, 'PocketPal AI') + ' or ' + link(APPS.privateLlm, 'Private LLM') + ' from the App Store, ' + find :
          (os === 'android' || os === 'other' ? 'Get ' + link(APPS.pocketpalAndroid, 'PocketPal AI') + ' or ' + link(APPS.edgeGallery, 'Google AI Edge Gallery') + ' from Google Play, ' + find :
          'Look in your app store for an offline AI chat app, ' + find)));
      } else if (m.ollama) {
        parts.push(copyCmd('ollama run ' + m.ollama));
        parts.push('or search "' + esc(m.family || m.name) + '" in LM Studio');
      } else {
        parts.push('Search "' + esc(m.name) + '" in LM Studio');
      }
    } else if (m.kind === 'diffusion') {
      parts.push(sentence(os === 'mac' || apple ? 'Use ' + link(APPS.drawThings, 'Draw Things') + ' (App Store) or ' + link(APPS.comfy, 'ComfyUI') : 'Use ' + link(APPS.comfy, 'ComfyUI')));
    } else if (m.modality === 'speech-to-text') {
      parts.push(/whisper/i.test(m.name) ? sentence('Use ' + link('https://github.com/ggml-org/whisper.cpp', 'whisper.cpp') + ', or an app built on it') : 'See the model page for apps that run it');
    } else if (m.ollama) {
      parts.push(copyCmd('ollama pull ' + m.ollama));
    }
    if (m.source) { parts.push(link(m.source, 'Model page')); }
    return parts.length ? '<span class="model-how">' + parts.join(' ') + '</span>' : '';
  }

  function onResultsClick(ev) {
    var t = ev.target;
    while (t && t !== els.resultsBody && !(t.getAttribute && t.getAttribute('data-action'))) { t = t.parentNode; }
    if (!t || t === els.resultsBody) { return; }
    var a = t.getAttribute('data-action');
    var c;
    if (a === 'target') {
      state.target = t.getAttribute('data-target') === 'browser' ? 'browser' : 'native';
      state.expanded = { well: false, slow: false, no: false };
      saveView();
      c = renderResults();
      refocus('.seg [data-target="' + state.target + '"]');
      if (c) { announceFiltered(c.filtered); }
    } else if (a === 'filter') {
      state.filter = t.getAttribute('data-filter');
      state.expanded = { well: false, slow: false, no: false };
      saveView();
      c = renderResults();
      refocus('[data-action="filter"][data-filter="' + state.filter + '"]');
      if (c) { announceFiltered(c.filtered); }
    } else if (a === 'more') {
      var g = t.getAttribute('data-group');
      state.expanded[g] = true;
      renderResults();
      var rows = $('g-' + g) ? $('g-' + g).querySelectorAll('.model') : [];
      if (rows[LIMITS[g]]) { rows[LIMITS[g]].focus(); }
    } else if (a === 'ram') {
      var gb = t.getAttribute('data-gb');
      var ov = currentOverrides();
      ov.ramGB = parseFloat(gb);
      emitOverride(ov);
      refocus('[data-action="ram"][data-gb="' + gb + '"]');
    } else if (a === 'open-fix') {
      var fix = $('fix');
      if (fix) {
        if (ev.preventDefault) { ev.preventDefault(); }
        fix.open = true;
        var sel = $('ov-gpu');
        if (sel) {
          if (sel.scrollIntoView) { sel.scrollIntoView(); }
          sel.focus();
        }
      }
    } else if (a === 'copy') {
      copyText(t.getAttribute('data-copy'), t);
    }
  }

  function onResultsInput(ev) {
    var t = ev.target;
    if (!t || t.id !== 'q') { return; }
    state.query = t.value;
    if (ev.isComposing) { return; }
    scheduleGroups();
  }

  function copyText(text, btn) {
    function done(ok) {
      var label = btn.getAttribute('data-label') || 'Copy';
      if (btn._t) { clearTimeout(btn._t); }
      btn.textContent = ok ? 'Copied' : 'Select & copy';
      announce(ok ? 'Copied to clipboard.' : 'Could not copy; the command is selected, press Ctrl+C or Cmd+C.');
      btn._t = setTimeout(function () { btn.textContent = label; btn._t = null; }, 1600);
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
    scanDone: scanDone,
    renderDevice: renderDevice,
    renderResults: renderResults,
    onOverride: function (fn) { overrideHandler = fn; },
    onRescan: function (fn) { rescanHandler = fn; },
    showRescan: function (show) { if (els.rescan) { els.rescan.hidden = !show; } },
    _speedText: speedText,
    _bestIn: bestIn
  };
})(window.LAC = window.LAC || {});
