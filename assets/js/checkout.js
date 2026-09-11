(function () {
  'use strict';

  var W = window;
  var S = W.Store;
  if (!S) return;
  var CFG = W.STORE_CONFIG || {};
  var failures = 0;

  function errorBox(html) {
    var boxes = S.$$('[data-cart-error]');
    for (var i = 0; i < boxes.length; i++) {
      boxes[i].innerHTML = html ? '<div class="cart-err">' + html + '</div>' : '';
    }
  }

  function contactLink() {
    var base = (CFG.base || '/');
    return (base + 'contact/').replace(/\/+/g, '/');
  }

  function payload() {
    var items = W.Cart.items().map(function (it) {
      var line = { priceKey: W.Cart.priceKey(it), qty: it.qty };
      var text = W.Cart.customText ? W.Cart.customText(it) : ((it.custom && it.custom.text) || '');
      if (text) line.custom = { text: text };
      return line;
    });
    return { items: items, cartId: W.Cart.cartId() };
  }

  function fallbackLink() {
    var items = W.Cart.items();
    if (items.length !== 1) return '';
    var links = CFG.paymentLinks || {};
    return links[items[0].productId] || '';
  }

  function start(btn) {
    if (!W.Cart || !W.Cart.items().length) return;

    if (CFG.storeMode !== 'live') {
      errorBox('This store is in preview. Checkout switches on at launch — ' +
        '<a href="' + S.escUrl(contactLink()) + '">contact us</a> if you need it sooner.');
      return;
    }

    var url = S.apiUrl('/api/checkout');
    if (!url) {
      var direct = fallbackLink();
      if (direct) { W.location.href = direct; return; }
      errorBox('Checkout isn’t reachable right now. Please <a href="' + S.escUrl(contactLink()) + '">contact us</a> and we’ll take your order directly.');
      return;
    }

    var label = btn ? btn.innerHTML : '';
    if (btn) {
      btn.setAttribute('aria-disabled', 'true');
      btn.disabled = true;
      btn.innerHTML = '<span class="spin" aria-hidden="true"></span> Redirecting…';
    }
    errorBox('');

    S.track('begin_checkout', {
      value: W.Cart.subtotal() / 100,
      currency: W.Cart.currency(),
      items: W.Cart.items().map(function (i) { return { item_id: i.productId, quantity: i.qty }; })
    });

    S.postJson(url, payload(), 15000).then(function (res) {
      if (res && res.url) {
        try { sessionStorage.setItem('checkout.pending', '1'); } catch (e) {}
        S.track('checkout_redirect', {
          value: W.Cart.subtotal() / 100,
          currency: W.Cart.currency(),
          method: 'stripe'
        });
        if (S.analytics) S.analytics.flush();
        W.location.href = res.url;
        return;
      }
      throw new Error('no-url');
    }).catch(function () {
      failures += 1;
      if (btn) {
        btn.removeAttribute('aria-disabled');
        btn.disabled = false;
        btn.innerHTML = label;
      }
      if (failures < 2) {
        errorBox('That didn’t go through. Please try once more.');
        return;
      }
      var direct = fallbackLink();
      if (direct) {
        errorBox('Redirecting you to our secure backup checkout…');
        W.setTimeout(function () { W.location.href = direct; }, 600);
        return;
      }
      errorBox('We can’t reach checkout at the moment. Please <a href="' + S.escUrl(contactLink()) +
        '">contact us</a> — we’ll send you a secure payment link and hold your order.');
    });
  }

  W.Checkout = { start: start };
})();
