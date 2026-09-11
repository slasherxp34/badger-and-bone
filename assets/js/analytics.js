(function () {
  'use strict';

  var W = window;
  var CFG = W.STORE_CONFIG || {};

  var S = null;
  var pendingInstall = true;

  function attach(store) {
    S = store;
    if (!S) return;
    if (pendingInstall) { pendingInstall = false; install(); }
  }

  if (W.Store) {
    attach(W.Store);
  } else {
    try {
      Object.defineProperty(W, 'Store', {
        configurable: true,
        get: function () { return S; },
        set: function (v) {
          attach(v);
          try {
            Object.defineProperty(W, 'Store', {
              value: S, writable: true, configurable: true, enumerable: true
            });
          } catch (e) {}
        }
      });
    } catch (e) {
    }
  }

  var SID_KEY = 'ba.sid';
  var UTM_KEY = 'ba.utm';
  var MAX_BATCH = 20;
  var FLUSH_MS = 4000;

  var queue = [];
  var timer = null;
  var sid = null;
  var utm = null;

  function dnt() {
    try {
      var n = W.navigator || {};
      return n.doNotTrack === '1' || n.msDoNotTrack === '1' || W.doNotTrack === '1';
    } catch (e) { return false; }
  }

  function endpoint() {
    var base = (W.STORE_CONFIG || {}).apiBase || '';
    if (!base) return '';
    return base.replace(/\/+$/, '') + '/api/events';
  }

  function enabled() {
    return !!endpoint() && !dnt();
  }

  function sessionId() {
    if (sid) return sid;
    try {
      sid = sessionStorage.getItem(SID_KEY);
      if (!sid) {
        sid = randomId();
        sessionStorage.setItem(SID_KEY, sid);
      }
    } catch (e) {
      sid = sid || randomId();
    }
    return sid;
  }

  function randomId() {
    try {
      if (W.crypto && W.crypto.getRandomValues) {
        var a = new Uint8Array(12);
        W.crypto.getRandomValues(a);
        var s = '';
        for (var i = 0; i < a.length; i++) s += (a[i] + 0x100).toString(16).slice(1);
        return s;
      }
    } catch (e) {}
    return 's' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  var UTM_FIELDS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

  function utmParams() {
    if (utm) return utm;
    var stored = null;
    try { stored = JSON.parse(sessionStorage.getItem(UTM_KEY) || 'null'); } catch (e) { stored = null; }

    var fresh = {};
    var found = false;
    for (var i = 0; i < UTM_FIELDS.length; i++) {
      var v = param(UTM_FIELDS[i]);
      if (v) { fresh[UTM_FIELDS[i]] = String(v).slice(0, 64); found = true; }
    }

    utm = found ? fresh : (stored && typeof stored === 'object' ? stored : {});
    if (found) {
      try { sessionStorage.setItem(UTM_KEY, JSON.stringify(utm)); } catch (e) {}
    }
    return utm;
  }

  function param(name) {
    try {
      var m = new RegExp('[?&]' + name + '=([^&#]*)').exec(W.location.search);
      return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
    } catch (e) { return ''; }
  }

  function pagePath() {
    try { return String(W.location.pathname || '/').slice(0, 120); } catch (e) { return '/'; }
  }

  var PROP_ALLOW = ['productId', 'variantSel', 'qty', 'valueCents', 'source', 'orderHash'];

  function cleanProps(props) {
    var out = {};
    if (props) {
      for (var i = 0; i < PROP_ALLOW.length; i++) {
        var k = PROP_ALLOW[i];
        var v = props[k];
        if (v === null || v === undefined || v === '') continue;
        if (k === 'qty' || k === 'valueCents') {
          var n = Number(v);
          if (isFinite(n)) out[k] = Math.max(0, Math.round(n));
        } else {
          out[k] = String(v).slice(0, 64);
        }
      }
    }
    var u = utmParams();
    for (var j = 0; j < UTM_FIELDS.length; j++) {
      if (u[UTM_FIELDS[j]]) out[UTM_FIELDS[j]] = u[UTM_FIELDS[j]];
    }
    return out;
  }

  function queueEvent(name, props) {
    if (!enabled()) return;
    queue.push({ name: name, ts: Date.now(), sid: sessionId(), page: pagePath(), props: cleanProps(props) });
    if (queue.length >= MAX_BATCH) { flush(); return; }
    if (timer) return;
    timer = W.setTimeout(flush, FLUSH_MS);
  }

  function flush() {
    if (timer) { W.clearTimeout(timer); timer = null; }
    if (!queue.length) return;
    var url = endpoint();
    if (!url) { queue.length = 0; return; }

    var batch = queue.splice(0, MAX_BATCH);
    var body = JSON.stringify({ events: batch });

    try {
      if (W.navigator && W.navigator.sendBeacon) {
        var blob = new Blob([body], { type: 'text/plain;charset=UTF-8' });
        if (W.navigator.sendBeacon(url, blob)) {
          if (queue.length) W.setTimeout(flush, 0);
          return;
        }
      }
    } catch (e) {}

    try {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', url, true);
      xhr.setRequestHeader('Content-Type', 'text/plain;charset=UTF-8');
      xhr.send(body);
    } catch (e2) {}
    if (queue.length) W.setTimeout(flush, 0);
  }

  function install() {
    var original = S.track;

    function mapPayload(name, payload) {
      var p = payload || {};
      var props = {};
      var first = (p.items && p.items[0]) || null;
      if (first) {
        if (first.item_id) props.productId = first.item_id;
        if (first.quantity) props.qty = first.quantity;
      }
      if (p.value !== undefined && p.value !== null) props.valueCents = Math.round(Number(p.value) * 100);
      if (p.method) props.source = p.method;
      if (p.transaction_id) props.orderHash = hashRef(p.transaction_id);
      return props;
    }

    var RENAME = { sign_up: 'email_capture' };
    var KNOWN = {
      page_view: 1, view_item: 1, add_to_cart: 1, view_cart: 1, begin_checkout: 1,
      checkout_redirect: 1, purchase: 1, email_capture: 1, paypal_approve: 1
    };

    S.track = function (name, payload) {
      try { original(name, payload); } catch (e) {}
      var mapped = RENAME[name] || name;
      if (!KNOWN[mapped]) return;
      queueEvent(mapped, mapPayload(mapped, payload));
    };

    S.event = function (name, props) { queueEvent(name, props); };
    S.analytics = {
      enabled: enabled, sid: sessionId, utm: utmParams, flush: flush,
      queued: function () { return queue.length; }
    };
  }

  function hashRef(ref) {
    var s = String(ref || '');
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(16);
  }

  function boot() {
    if (dnt()) return;
    sessionId();
    utmParams();

    if (!endpoint()) return;

    queueEvent('page_view', {});

    W.addEventListener('pagehide', flush, false);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flush();
    }, false);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
