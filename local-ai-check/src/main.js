/* Boots the page: scan → budget → render; re-renders on user corrections. ES5 only. */
(function (LAC) {
  'use strict';

  var U = LAC.util;
  var scanned = null; // raw scan result, before user corrections
  var scanning = false;
  var overrides = null; // the user's corrections; kept here too in case storage is unavailable

  function show(d) {
    var budget = LAC.estimate.budget(d);
    LAC.ui.renderDevice(d, budget);
    LAC.ui.renderResults(d, budget);
  }

  function scan() {
    if (scanning) { return; }
    scanning = true;
    LAC.ui.showRescan(false);
    LAC.ui.resetProgress();
    var p = LAC.detect(LAC.ui.progress);
    if (!p) { finishSync(); return; }
    p.then(function (d) {
      scanning = false;
      scanned = d;
      show(withOverrides(d));
      LAC.ui.scanDone();
    }, function () {
      scanning = false;
      finishSync();
    });
  }

  // Browsers without Promise: synchronous probes only.
  function finishSync() {
    var d = LAC.detectSync();
    scanned = d;
    var steps = ['browser', 'cpu', 'memory', 'gpu', 'webgpu', 'wasm', 'storage', 'bench-cpu', 'bench-gpu'];
    for (var i = 0; i < steps.length; i++) { LAC.ui.progress(steps[i], 'warn', i < 4 ? 'Basic check only' : 'Not supported by this browser'); }
    scanning = false;
    show(withOverrides(d));
    LAC.ui.scanDone();
  }

  function onOverride(ov) {
    overrides = ov && (ov.ramGB || ov.gpuName) ? ov : null;
    if (!scanned) { return; }
    show(withOverrides(scanned));
  }

  // Applies saved corrections to a copy of the scan, so "Reset" can always restore it.
  function withOverrides(base) {
    var d = JSON.parse(JSON.stringify(base));
    // JSON copies lose object identity; point the GPU back at its table entry.
    if (d.gpu && d.gpu.entry && d.gpu.entry.name && LAC.GPUS) {
      for (var i = 0; i < LAC.GPUS.length; i++) { if (LAC.GPUS[i].name === d.gpu.entry.name) { d.gpu.entry = LAC.GPUS[i]; break; } }
    }
    return LAC.applyOverrides(d, overrides);
  }

  function start() {
    try {
      overrides = U.storage.get('overrides');
      LAC.ui.init();
      LAC.ui.onOverride(onOverride);
      LAC.ui.onRescan(function () {
        scan();
      });
      scan();
    } catch (err) {
      var el = document.getElementById('scan');
      if (el) {
        var p = document.createElement('p');
        p.className = 'notice';
        p.textContent = 'The check could not start in this browser (' + (err && err.message ? err.message : 'unknown error') + '). Try a current version of Chrome, Edge, Safari or Firefox.';
        el.appendChild(p);
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})(window.LAC = window.LAC || {});
