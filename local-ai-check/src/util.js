/* Shared helpers. ES5 only: this file must parse in every browser still in use. */
(function (LAC) {
  'use strict';

  var hasPromise = typeof Promise === 'function' &&
    typeof Promise.resolve === 'function' && typeof Promise.prototype.then === 'function';

  function now() {
    try {
      if (typeof performance !== 'undefined' && performance.now) { return performance.now(); }
    } catch (e) { /* ignore */ }
    return new Date().getTime();
  }

  // Resolves with the promise's value, or fallbackValue if it rejects or takes longer than ms.
  function withTimeout(promise, ms, fallbackValue) {
    return new Promise(function (resolve) {
      var settled = false;
      var timer = setTimeout(function () {
        if (!settled) { settled = true; resolve(fallbackValue); }
      }, ms);
      function finish(v) {
        if (!settled) { settled = true; clearTimeout(timer); resolve(v); }
      }
      try {
        Promise.resolve(promise).then(finish, function () { finish(fallbackValue); });
      } catch (e) {
        finish(fallbackValue);
      }
    });
  }

  // Yield to the event loop so the UI can paint between heavy steps.
  function nextTick(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms || 0); });
  }

  function round(x, digits) {
    var f = Math.pow(10, digits || 0);
    return Math.round(x * f) / f;
  }

  function fmtGB(gb) {
    if (gb === null || gb === undefined || isNaN(gb)) { return '—'; }
    if (gb >= 1000) { return round(gb / 1000, gb >= 10000 ? 0 : 1) + ' TB'; }
    if (gb >= 10) { return Math.round(gb) + ' GB'; }
    if (gb >= 1) { return round(gb, 1) + ' GB'; }
    return Math.max(1, Math.round(gb * 1000)) + ' MB';
  }

  function fmtRate(tps) {
    if (tps === null || tps === undefined || isNaN(tps)) { return '—'; }
    if (tps < 1) { return '<1 tok/s'; }
    if (tps < 10) { return '~' + round(tps, 1) + ' tok/s'; }
    return '~' + Math.round(tps) + ' tok/s';
  }

  function esc(str) {
    return String(str === null || str === undefined ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  var PREFIX = 'lac:';
  var storage = {
    get: function (key) {
      try {
        var raw = window.localStorage.getItem(PREFIX + key);
        return raw ? JSON.parse(raw) : null;
      } catch (e) { return null; }
    },
    set: function (key, value) {
      try {
        if (value === null || value === undefined) { window.localStorage.removeItem(PREFIX + key); }
        else { window.localStorage.setItem(PREFIX + key, JSON.stringify(value)); }
        return true;
      } catch (e) { return false; }
    }
  };

  function extend(target) {
    for (var i = 1; i < arguments.length; i++) {
      var src = arguments[i];
      if (!src) { continue; }
      for (var k in src) {
        if (Object.prototype.hasOwnProperty.call(src, k)) { target[k] = src[k]; }
      }
    }
    return target;
  }

  LAC.util = {
    hasPromise: hasPromise,
    now: now,
    withTimeout: withTimeout,
    nextTick: nextTick,
    round: round,
    fmtGB: fmtGB,
    fmtRate: fmtRate,
    esc: esc,
    storage: storage,
    extend: extend
  };
})(window.LAC = window.LAC || {});
