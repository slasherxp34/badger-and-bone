(function () {
  'use strict';

  var W = window;
  var S = W.Store;
  if (!S) return;
  var CFG = W.STORE_CONFIG || {};

  function orderRef(o) {
    if (!o) return '';
    return o.orderId || o.orderNumber || o.number || o.id || '';
  }

  function deliveryText(o) {
    if (!o) return '';
    if (o.deliveryWindow) return o.deliveryWindow;
    if (o.eta) return o.eta;
    var d = o.delivery;
    if (d && typeof d === 'object') {
      if (d.earliest && d.latest) return d.earliest + '–' + d.latest;
      return d.earliest || d.latest || '';
    }
    if (typeof d === 'string') return d;
    return '';
  }

  function statusLabel(v) {
    var s = String(v || '').replace(/[_-]+/g, ' ').trim();
    if (!s) return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function dateLabel(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso || '');
    var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return MON[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }

  function purchaseValue(order) {
    var t = order && order.totals;
    if (t && typeof t.total === 'number') return t.total / 100;
    if (order && typeof order.totalCents === 'number') return order.totalCents / 100;
    if (W.Cart && W.Cart.subtotal) {
      var sub = W.Cart.subtotal();
      if (sub > 0) return sub / 100;
    }
    return undefined;
  }

  function purchaseCurrency(order) {
    var t = order && order.totals;
    return (t && t.currency) || (order && order.currency) ||
      (W.Cart && W.Cart.currency && W.Cart.currency()) || 'USD';
  }

  function initThankYou() {
    var loading = S.$('[data-ty-loading]');
    if (!loading) return;
    var content = S.$('[data-ty-content]');
    var errBox = S.$('[data-ty-error]');
    var sid = S.param('session_id');
    var orderParam = S.param('order');
    var emailParam = S.param('email');

    function show(el) {
      loading.hidden = true;
      if (el) el.hidden = false;
    }

    var guardKey = 'purchase.done.' + (sid || orderParam || 'none');
    var alreadyFired = false;
    try { alreadyFired = sessionStorage.getItem(guardKey) === '1'; } catch (e) {}

    function finalise(order) {
      if (!alreadyFired) {
        try { sessionStorage.setItem(guardKey, '1'); } catch (e) {}
        try { sessionStorage.removeItem('checkout.pending'); } catch (e) {}
        S.track('purchase', {
          transaction_id: orderRef(order) || orderParam || sid,
          value: purchaseValue(order),
          currency: purchaseCurrency(order)
        });
        if (S.analytics) S.analytics.flush();
        if (W.Cart) W.Cart.clear();
      }
    }

    if (!sid && !orderParam) {
      show(errBox);
      return;
    }

    var query = sid
      ? '?session_id=' + encodeURIComponent(sid)
      : '?order=' + encodeURIComponent(orderParam) + (emailParam ? '&email=' + encodeURIComponent(emailParam) : '');
    var url = S.apiUrl('/api/order' + query);
    if (!url) {
      var elO = S.$('[data-ty-order]');
      var elW = S.$('[data-ty-window]');
      if (elO) elO.textContent = orderParam || 'Emailed to you';
      if (elW) elW.textContent = S.deliveryRange();
      finalise(null);
      show(content);
      return;
    }

    var tries = 0;
    var MAX_TRIES = 8;

    function renderItems(order) {
      var wrap = S.$('[data-ty-items]');
      var list = S.$('[data-ty-item-list]');
      var note = S.$('[data-ty-personal-note]');
      if (!wrap || !list) return;
      var items = (order && order.items) || [];
      if (!items.length) { wrap.hidden = true; return; }
      var anyCustom = false;
      var html = '';
      for (var i = 0; i < items.length; i++) {
        var it = items[i] || {};
        var text = (it.custom && it.custom.text) ? String(it.custom.text) : '';
        if (text) anyCustom = true;
        html += '<li class="ty-item">' +
          '<span class="ty-item-name">' + S.escHtml(it.name || 'Item') + '</span>' +
          (it.variantName ? '<span class="ty-item-meta">' + S.escHtml(it.variantName) + '</span>' : '') +
          (text ? '<span class="ty-item-custom" data-ty-item-custom>Name: <b>' + S.escHtml(text) + '</b></span>' : '') +
          '<span class="ty-item-qty">Qty ' + S.escHtml(String(it.units || it.qty || 1)) + '</span>' +
          '</li>';
      }
      list.innerHTML = html;
      wrap.hidden = false;
      if (note) note.hidden = !anyCustom;
    }

    function render(order, confirmed) {
      var elO = S.$('[data-ty-order]');
      var elW = S.$('[data-ty-window]');
      if (elO) elO.textContent = orderRef(order) || orderParam || 'Emailed to you';
      if (elW) elW.textContent = deliveryText(order) || S.deliveryRange();
      renderItems(order);
      if (confirmed) finalise(order);
      show(content);
    }

    function poll() {
      tries += 1;
      S.getJson(url, 12000).then(function (res) {
        if (res && res.status === 'pending') {
          if (tries < MAX_TRIES) { W.setTimeout(poll, 1500); return; }
          render(null, false);
          return;
        }
        render(res && res.order ? res.order : res, true);
      }).catch(function () {
        if (tries < 3) { W.setTimeout(poll, 1500); return; }
        show(errBox);
      });
    }

    poll();
  }

  function initTrack() {
    var form = S.$('[data-track]');
    if (!form) return;
    var msg = S.$('[data-track-msg]');
    var out = S.$('[data-track-result]');

    S.on(form, 'submit', function (e) {
      e.preventDefault();
      var order = (S.$('#tk-order') || {}).value || '';
      var email = (S.$('#tk-email') || {}).value || '';
      order = order.trim();
      email = email.trim();
      if (!order || !email || email.indexOf('@') < 1) {
        msg.textContent = 'Please enter both your order number and the email you used.';
        msg.className = 'form-msg err';
        return;
      }
      msg.innerHTML = '<span class="spin" aria-hidden="true"></span> Looking that up…';
      msg.className = 'form-msg';
      if (out) out.hidden = true;

      var url = S.apiUrl('/api/track?order=' + encodeURIComponent(order) + '&email=' + encodeURIComponent(email));
      if (!url) {
        msg.textContent = 'Order lookup is not switched on yet. Email us and we will check it by hand.';
        msg.className = 'form-msg err';
        return;
      }

      S.getJson(url, 12000).then(function (res) {
        var o = res && res.order ? res.order : res;
        if (!o || (!o.status && !o.tracking && !o.trackingNumber)) throw new Error('not-found');
        msg.textContent = '';
        var rows = '';
        var ref = orderRef(o);
        if (ref) rows += row('Order', ref);
        if (o.status) rows += row('Status', statusLabel(o.status));
        if (o.fulfillmentStatus) rows += row('Fulfilment', statusLabel(o.fulfillmentStatus));
        var placed = o.placedAt || o.createdAt;
        if (placed) rows += row('Placed', dateLabel(placed));
        var eta = deliveryText(o);
        if (eta) rows += row('Estimated delivery', eta);

        var tk = o.tracking;
        var tn = (tk && typeof tk === 'object') ? tk.trackingNumber : (o.trackingNumber || tk);
        var tUrl = (tk && typeof tk === 'object' && tk.url) || o.trackingUrl || '';
        var carrier = (tk && typeof tk === 'object' && (tk.carrierName || tk.carrier)) || o.carrier || '';
        if (carrier) rows += row('Carrier', carrier);
        if (tn) {
          rows += tUrl
            ? (S.safeUrl(tUrl)
              ? '<div class="ty-row"><span>Tracking</span><b><a href="' + S.escUrl(tUrl) + '" rel="noopener" target="_blank" style="color:var(--accent)">' + S.escHtml(tn) + '</a></b></div>'
              : row('Tracking', tn))
            : row('Tracking', tn);
        } else {
          rows += row('Tracking', 'Not shipped yet — we email the link the moment it ships.');
        }
        out.innerHTML = '<div class="ty-card" style="margin:0">' + rows + '</div>';
        out.hidden = false;
      }).catch(function (err) {
        msg.textContent = err && err.message === 'not-found'
          ? 'We could not find an order with those details. Check the number and the email address, or contact us.'
          : 'We could not reach the order system just now. Please try again, or email us and we will look it up.';
        msg.className = 'form-msg err';
      });
    });

    function row(label, value) {
      return '<div class="ty-row"><span>' + S.escHtml(label) + '</span><b>' + S.escHtml(value) + '</b></div>';
    }
  }

  function initContact() {
    var form = S.$('[data-contact]');
    if (!form) return;
    var msg = S.$('[data-contact-msg]');

    S.on(form, 'submit', function (e) {
      e.preventDefault();
      var hp = S.$('#ct-hp');
      if (hp && hp.value) return;
      var body = {
        type: 'contact',
        name: (S.$('#ct-name') || {}).value || '',
        email: (S.$('#ct-email') || {}).value || '',
        order: (S.$('#ct-order') || {}).value || '',
        message: (S.$('#ct-msg') || {}).value || ''
      };
      if (!body.name.trim() || body.email.indexOf('@') < 1 || !body.message.trim()) {
        msg.textContent = 'Please fill in your name, a valid email, and a message.';
        msg.className = 'form-msg err';
        return;
      }
      var btn = form.querySelector('button[type=submit]');
      if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
      msg.textContent = '';
      msg.className = 'form-msg';

      function ok() {
        msg.textContent = 'Thanks — that reached us. We reply within one business day.';
        msg.className = 'form-msg ok';
        form.reset();
        if (btn) { btn.disabled = false; btn.textContent = 'Send message'; }
      }

      function fail() {
        var mailUrl = CFG.mailtoSupport || '';
        var addr = CFG.supportEmail || '';
        if (addr && S.safeUrl(mailUrl)) {
          msg.innerHTML = 'We could not send that from here. Please email us at ' +
            '<a href="' + S.escUrl(mailUrl) + '" style="color:var(--clay,var(--accent))">' +
            S.escHtml(addr) + '</a> and we will pick it up.';
        } else if (addr) {
          msg.textContent = 'We could not send that from here. Please email us at ' + addr + '.';
        } else {
          msg.textContent = 'We could not send that from here. Please email us directly.';
        }
        msg.className = 'form-msg err';
        if (btn) { btn.disabled = false; btn.textContent = 'Send message'; }
      }

      var api = S.apiUrl('/api/contact');
      var attempt = api
        ? S.postJson(api, body, 12000)
        : Promise.reject(new Error('no-api'));

      attempt.then(ok).catch(function () {
        var key = CFG.web3formsKey || '';
        if (!key || key.indexOf('REPLACE_') === 0) { fail(); return; }
        S.postJson('https://api.web3forms.com/submit', {
          access_key: key,
          subject: 'Contact form — ' + (CFG.brandName || 'store'),
          name: body.name, email: body.email, order: body.order, message: body.message
        }, 12000).then(ok).catch(fail);
      });
    });
  }

  function initReturn() {
    var form = S.$('[data-return]');
    if (!form) return;
    var msg = S.$('[data-return-msg]');

    S.on(form, 'submit', function (e) {
      e.preventDefault();
      var hp = S.$('#rt-hp');
      if (hp && hp.value) return;

      var checked = form.querySelector('input[name=reason]:checked');
      var body = {
        type: 'return',
        order: (S.$('#rt-order') || {}).value || '',
        email: (S.$('#rt-email') || {}).value || '',
        items: (S.$('#rt-items') || {}).value || '',
        reason: checked ? checked.value : '',
        notes: (S.$('#rt-notes') || {}).value || ''
      };
      body.message = 'Return request\n' +
        'Order: ' + body.order + '\n' +
        'Items: ' + body.items + '\n' +
        'Reason: ' + body.reason + '\n' +
        (body.notes ? 'Notes: ' + body.notes + '\n' : '');

      if (!body.order.trim() || body.email.indexOf('@') < 1 || !body.items.trim()) {
        msg.textContent = 'Please give your order number, the email you ordered with, and which item.';
        msg.className = 'form-msg err';
        return;
      }

      var btn = form.querySelector('button[type=submit]');
      if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
      msg.textContent = '';
      msg.className = 'form-msg';

      function ok() {
        msg.textContent = 'Got it. We will email you a return address and an authorisation number ' +
          'within one business day.';
        msg.className = 'form-msg ok';
        form.reset();
        if (btn) { btn.disabled = false; btn.textContent = 'Send return request'; }
      }

      function fail() {
        var mailUrl = CFG.mailtoSupport || '';
        var addr = CFG.supportEmail || '';
        var tail = body.order ? ' Quote order ' + body.order + '.' : '';
        if (addr && S.safeUrl(mailUrl)) {
          msg.innerHTML = 'We could not send that from here. Please email ' +
            '<a href="' + S.escUrl(mailUrl) + '" style="color:var(--clay,var(--accent))">' +
            S.escHtml(addr) + '</a> and we will start the return by hand.' + S.escHtml(tail);
        } else if (addr) {
          msg.textContent = 'We could not send that from here. Please email ' + addr + '.' + tail;
        } else {
          msg.textContent = 'We could not send that from here. Please email us to start the return.';
        }
        msg.className = 'form-msg err';
        if (btn) { btn.disabled = false; btn.textContent = 'Send return request'; }
      }

      var api = S.apiUrl('/api/contact');
      var attempt = api ? S.postJson(api, body, 12000) : Promise.reject(new Error('no-api'));

      attempt.then(ok).catch(function () {
        var key = CFG.web3formsKey || '';
        if (!key || key.indexOf('REPLACE_') === 0) { fail(); return; }
        S.postJson('https://api.web3forms.com/submit', {
          access_key: key,
          subject: 'Return request — ' + (CFG.brandName || 'store'),
          order: body.order, email: body.email, items: body.items,
          reason: body.reason, notes: body.notes
        }, 12000).then(ok).catch(fail);
      });
    });
  }

  function boot() {
    initThankYou();
    initTrack();
    initContact();
    initReturn();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
