(function () {
  'use strict';

  var W = window;
  var S = W.Store;
  if (!S) return;
  var CFG = W.STORE_CONFIG || {};

  var sdkPromise = null;
  var mounted = [];

  function available() {
    return !!(CFG.paypalClientId && CFG.storeMode === 'live');
  }

  function errorBox(html) {
    var boxes = S.$$('[data-cart-error]');
    for (var i = 0; i < boxes.length; i++) {
      boxes[i].innerHTML = html ? '<div class="cart-err">' + html + '</div>' : '';
    }
  }

  function contactLink() {
    return ((CFG.base || '/') + 'contact/').replace(/\/+/g, '/');
  }

  function loadSdk() {
    if (sdkPromise) return sdkPromise;
    sdkPromise = new Promise(function (resolve, reject) {
      if (W.paypal) { resolve(W.paypal); return; }
      var sc = document.createElement('script');
      sc.src = 'https://www.paypal.com/sdk/js?client-id=' +
        encodeURIComponent(CFG.paypalClientId) + '&currency=USD&intent=capture';
      sc.async = true;
      sc.onload = function () { W.paypal ? resolve(W.paypal) : reject(new Error('sdk-empty')); };
      sc.onerror = function () { reject(new Error('sdk-failed')); };
      document.head.appendChild(sc);
    });
    return sdkPromise;
  }

  function payload() {
    return {
      items: W.Cart.items().map(function (it) {
        var line = { priceKey: W.Cart.priceKey(it), qty: it.qty };
        var text = W.Cart.customText ? W.Cart.customText(it) : ((it.custom && it.custom.text) || '');
        if (text) line.custom = { text: text };
        return line;
      }),
      cartId: W.Cart.cartId()
    };
  }

  function thankYouUrl(orderId, email) {
    var base = ((CFG.base || '/') + 'thank-you/').replace(/\/+/g, '/');
    var q = '?order=' + encodeURIComponent(orderId);
    if (email) q += '&email=' + encodeURIComponent(email);
    return base + q;
  }

  function mountInto(el, paypal) {
    if (!el || el.getAttribute('data-paypal-ready') === '1') return;
    el.setAttribute('data-paypal-ready', '1');

    var buttons = paypal.Buttons({
      style: { layout: 'horizontal', height: 44, tagline: false, shape: 'rect' },

      createOrder: function () {
        errorBox('');
        S.track('begin_checkout', {
          value: W.Cart.subtotal() / 100,
          currency: W.Cart.currency(),
          items: W.Cart.items().map(function (i) { return { item_id: i.productId, quantity: i.qty }; })
        });
        return S.postJson(S.apiUrl('/api/paypal/create-order'), payload(), 15000)
          .then(function (res) {
            if (!res || !res.id) throw new Error('no-order-id');
            return res.id;
          });
      },

      onApprove: function (data) {
        S.track('paypal_approve', {
          value: W.Cart.subtotal() / 100,
          currency: W.Cart.currency(),
          method: 'paypal'
        });
        return S.postJson(S.apiUrl('/api/paypal/capture-order'), { orderID: data.orderID }, 20000)
          .then(function (res) {
            if (!res || !res.orderId) throw new Error('no-capture');
            try { sessionStorage.setItem('checkout.pending', '1'); } catch (e) {}
            S.track('checkout_redirect', { method: 'paypal' });
            if (S.analytics) S.analytics.flush();
            W.location.href = thankYouUrl(res.orderId, res.email);
          });
      },

      onCancel: function () {
        errorBox('');
      },

      onError: function () {
        errorBox('PayPal could not complete that. You can try again, use the card ' +
          'checkout above, or <a href="' + S.escUrl(contactLink()) + '">contact us</a>.');
      }
    });

    if (buttons.isEligible && !buttons.isEligible()) {
      var wrap = el.closest ? el.closest('.pay-alt') : null;
      if (wrap) wrap.hidden = true;
      return;
    }
    buttons.render(el).catch(function () {
      el.removeAttribute('data-paypal-ready');
    });
    mounted.push(buttons);
  }

  function mountAll() {
    if (!available() || !W.Cart) return;
    var els = S.$$('[data-paypal-mount]').filter(function (el) {
      return el.getAttribute('data-paypal-ready') !== '1';
    });
    if (!els.length) return;
    if (!S.apiUrl('/api/paypal/create-order')) return;   // no apiBase configured
    loadSdk().then(function (paypal) {
      els.forEach(function (el) { mountInto(el, paypal); });
    }).catch(function () {
      els.forEach(function (el) {
        var wrap = el.closest ? el.closest('.pay-alt') : null;
        if (wrap) wrap.hidden = true;
      });
    });
  }

  W.Paypal = { available: available, mountAll: mountAll };

  function boot() { mountAll(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
