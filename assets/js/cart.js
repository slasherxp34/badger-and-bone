(function () {
  'use strict';

  var W = window;
  var S = W.Store;
  if (!S) return;
  var CFG = W.STORE_CONFIG || {};
  var KEY = 'cart.v1';
  var SCHEMA = 1;

  function newId() {
    var hex = '';
    var i;
    if (W.crypto && W.crypto.getRandomValues && typeof Uint8Array !== 'undefined') {
      try {
        var bytes = new Uint8Array(16);
        W.crypto.getRandomValues(bytes);
        for (i = 0; i < bytes.length; i++) {
          hex += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
        }
        return 'c_' + hex;
      } catch (e) { /* fall through to the weak path */ }
    }
    for (i = 0; i < 32; i++) hex += Math.floor(Math.random() * 16).toString(16);
    return 'c_' + hex;
  }

  function emptyState() {
    return { schema: SCHEMA, cartId: newId(), items: [], updatedAt: Date.now() };
  }

  function read() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { return emptyState(); }
    if (!raw) return emptyState();
    var data = null;
    try { data = JSON.parse(raw); } catch (e) { return emptyState(); }
    if (!data || data.schema !== SCHEMA || !(data.items instanceof Array)) return emptyState();
    if (!data.cartId) data.cartId = newId();
    return data;
  }

  function write(state) {
    state.updatedAt = Date.now();
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
    return state;
  }

  var state = read();

  function priceKey(it) {
    var sel = it.variantSel || it.variantId || '_';
    return it.productId + ':' + sel + ':' + it.bundleQty;
  }

  function customText(it) {
    return (it && it.custom && it.custom.text) ? String(it.custom.text) : '';
  }

  function lineKey(it) {
    var t = customText(it);
    return t ? priceKey(it) + '#' + t : priceKey(it);
  }

  function count() {
    var n = 0;
    for (var i = 0; i < state.items.length; i++) n += state.items[i].qty;
    return n;
  }

  function subtotal() {
    var t = 0;
    for (var i = 0; i < state.items.length; i++) t += state.items[i].unitAmount * state.items[i].qty;
    return t;
  }

  function currency() {
    return (state.items[0] && state.items[0].currency) || 'USD';
  }

  var listeners = [];
  function emit() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](state); } catch (e) {}
    }
  }

  function add(item) {
    var key = lineKey(item);
    var found = null;
    for (var i = 0; i < state.items.length; i++) {
      if (lineKey(state.items[i]) === key) { found = state.items[i]; break; }
    }
    if (found) found.qty = Math.min(20, found.qty + (item.qty || 1));
    else {
      var copy = {
        productId: item.productId,
        variantSel: item.variantSel || item.variantId || '_',
        variantId: item.variantId || null, variantName: item.variantName || '',
        bundleQty: item.bundleQty || 1, bundleLabel: item.bundleLabel || '', name: item.name,
        slug: item.slug, href: item.href || '', image: item.image || '',
        unitAmount: item.unitAmount, currency: item.currency || 'USD', qty: Math.min(20, item.qty || 1),
        custom: (item.custom && item.custom.text) ? { text: String(item.custom.text) } : null,
        personalizationLabel: item.personalizationLabel || ''
      };
      state.items.push(copy);
    }
    write(state);
    emit();
    open();
  }

  function setQty(key, qty) {
    for (var i = 0; i < state.items.length; i++) {
      if (lineKey(state.items[i]) === key) {
        var q = Math.max(0, Math.min(20, qty));
        if (q === 0) state.items.splice(i, 1);
        else state.items[i].qty = q;
        break;
      }
    }
    write(state);
    emit();
  }

  function remove(key) { setQty(key, 0); }

  function clear() {
    state = emptyState();
    write(state);
    emit();
  }

  var panel, scrim, lastFocus;

  function open() {
    if (!panel) return;
    panel.hidden = false;
    scrim.hidden = false;
    lastFocus = document.activeElement;
    W.requestAnimationFrame(function () {
      panel.classList.add('on');
      scrim.classList.add('on');
    });
    panel.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    var close = panel.querySelector('[data-cart-close]');
    if (close) close.focus();
    S.track('view_cart', { value: subtotal() / 100, currency: currency() });
  }

  function close() {
    if (!panel) return;
    panel.classList.remove('on');
    scrim.classList.remove('on');
    panel.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    setTimeout(function () {
      if (!panel.classList.contains('on')) { panel.hidden = true; scrim.hidden = true; }
    }, 300);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function shippingLine() {
    var free = (CFG.shipping && CFG.shipping.freeOverCents) || 0;
    var sub = subtotal();
    if (!free) return '';
    var pct = Math.max(0, Math.min(100, Math.round((sub / free) * 100)));
    if (sub >= free) {
      return '<div class="ship-bar"><p class="done">✓ You’ve unlocked free US shipping.</p>' +
        '<div class="ship-track"><div class="ship-fill done" style="width:100%"></div></div></div>';
    }
    var left = free - sub;
    return '<div class="ship-bar"><p>You’re <b>' + S.money(left) + '</b> away from free US shipping.</p>' +
      '<div class="ship-track"><div class="ship-fill" style="width:' + pct + '%"></div></div></div>';
  }

  function lineHtml(it) {
    var key = lineKey(it);
    var meta = [];
    if (it.variantName) meta.push(S.escHtml(it.variantName));
    if (it.bundleQty > 1) meta.push(S.escHtml(it.bundleLabel || (it.bundleQty + '-pack')) + ' · ' + it.bundleQty + ' units');
    var ct = customText(it);
    var nameRow = ct
      ? '<div class="line-custom" data-line-custom><span>Name:</span> <b>' + S.escHtml(ct) + '</b></div>'
      : '';
    var href = it.href ? (CFG.base || '/') .replace(/\/+$/, '/') + it.href : '';
    return '<div class="line" data-line="' + S.escHtml(key) + '">' +
      (S.safeUrl(it.image) ? '<img class="line-img" src="' + S.escUrl(it.image) + '" alt="" width="66" height="66" loading="lazy" decoding="async">' : '<div class="line-img"></div>') +
      '<div class="line-main">' +
      '<div class="line-name">' + (S.safeUrl(href) ? '<a href="' + S.escUrl(href) + '">' + S.escHtml(it.name) + '</a>' : S.escHtml(it.name)) + '</div>' +
      (meta.length ? '<div class="line-meta">' + meta.join(' · ') + '</div>' : '') +
      nameRow +
      '<div class="line-bot">' +
      '<span class="line-qty">' +
      '<button type="button" data-dec="' + S.escHtml(key) + '" aria-label="Decrease quantity">−</button>' +
      '<span>' + it.qty + '</span>' +
      '<button type="button" data-inc="' + S.escHtml(key) + '" aria-label="Increase quantity">+</button>' +
      '</span>' +
      '<button type="button" class="line-rm" data-rm="' + S.escHtml(key) + '">Remove</button>' +
      '<span class="line-price">' + S.money(it.unitAmount * it.qty, it.currency) + '</span>' +
      '</div></div></div>';
  }

  function emptyHtml() {
    var shopHref = (CFG.base || '/') + 'collections/all/';
    var art = S.safeUrl(CFG.emptyCartArt)
      ? '<img class="cart-empty-dog" src="' + S.escUrl(CFG.emptyCartArt) + '" alt="" aria-hidden="true" width="360" height="140" loading="lazy" decoding="async">'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="21" r="1.4"/><circle cx="19" cy="21" r="1.4"/><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/></svg>';
    return '<div class="cart-empty">' +
      art +
      '<h3>Your cart is empty</h3>' +
      '<p>Nothing here yet — have a look at what we make.</p>' +
      '<a class="btn btn-primary" href="' + S.escUrl(shopHref.replace(/\/+/g, '/')) + '">Browse products</a>' +
      '</div>';
  }

  function payIcons() {
    var icons = ['Visa', 'Mastercard', 'Amex', 'Apple&nbsp;Pay', 'Google&nbsp;Pay'];
    if (paypalAvailable()) icons.push('PayPal');
    return '<div class="pay-icons" data-pay-icons>' +
      icons.map(function (n) { return '<span>' + n + '</span>'; }).join('') + '</div>';
  }

  var ATTACH = Array.isArray(CFG.attachOnly) ? CFG.attachOnly : [];
  var ATTACH_IDS = ATTACH.map(function (a) { return a.id; });

  function isAttach(it) { return ATTACH_IDS.indexOf(it.productId) !== -1; }

  function hasAnchor() {
    for (var i = 0; i < state.items.length; i++) if (!isAttach(state.items[i])) return true;
    return false;
  }

  function attachOnlyCart() {
    return state.items.length > 0 && !hasAnchor();
  }

  function addonsHtml() {
    if (!ATTACH.length || !hasAnchor()) return '';
    var inCart = {};
    for (var i = 0; i < state.items.length; i++) inCart[state.items[i].productId] = true;
    var offers = ATTACH.filter(function (a) { return !inCart[a.id]; });
    if (!offers.length) return '';
    return '<div class="cart-addons" data-cart-addons>' +
      '<p class="cart-addons-head">Add to this order</p>' +
      offers.map(function (a) {
        var needsText = a.personalization && a.personalization.required;
        var label = S.escHtml(a.addLabel) + ' — ' + S.money(a.price, a.currency || currency());
        return needsText
          ? '<a class="cart-addon" href="' + S.escUrl((CFG.base || '/') + a.href) + '">' + label + '</a>'
          : '<button class="cart-addon" type="button" data-addon="' + S.escHtml(a.id) + '">' + label + '</button>';
      }).join('') +
      '<p class="cart-addons-note">Ships with the rest of your order — no extra shipping.</p>' +
      '</div>';
  }

  function addAddon(id) {
    if (!hasAnchor()) return;
    var a = null;
    for (var i = 0; i < ATTACH.length; i++) if (ATTACH[i].id === id) { a = ATTACH[i]; break; }
    if (!a) return;
    add({
      productId: a.id,
      variantSel: a.defaultVariantSel || '_',
      variantId: (a.defaultVariantSel && a.defaultVariantSel !== '_') ? a.defaultVariantSel : null,
      variantName: a.defaultVariantName || '',
      bundleQty: 1, bundleLabel: '',
      name: a.name, slug: a.slug, href: a.href, image: a.image || '',
      unitAmount: a.price, currency: a.currency || currency(), qty: 1,
      custom: null, personalizationLabel: ''
    });
  }

  function footHtml() {
    var free = (CFG.shipping && CFG.shipping.freeOverCents) || 0;
    var flat = (CFG.shipping && CFG.shipping.flatCents) || 0;
    var sub = subtotal();
    var note = free && sub < free
      ? (flat
        ? S.moneyShort(flat) + ' US shipping — free over ' + S.moneyShort(free) + '.'
        : 'Shipping calculated at checkout — free over ' + S.moneyShort(free) + '.')
      : 'Free US shipping applied at checkout.';
    var live = CFG.storeMode === 'live';
    var attachBlock = attachOnlyCart();
    var blockNote = attachBlock
      ? '<p class="cart-note cart-blocked" data-cart-blocked>Add something else to check out — postage on these alone costs more than they do, so they ride along with another item.</p>'
      : '';
    return shippingLine() +
      '<div data-cart-error></div>' +
      '<div class="cart-sub"><span>Subtotal</span><b>' + S.money(sub, currency()) + '</b></div>' +
      '<p class="cart-note">' + note + ' Taxes calculated at checkout.</p>' +
      blockNote +
      '<button class="btn btn-primary btn-block btn-lg" type="button" data-checkout' +
      (live && !attachBlock ? '' : ' aria-disabled="true"') + (attachBlock ? ' disabled' : '') + '>' +
      (live ? 'Checkout · ' + S.money(sub, currency()) : 'Checkout opens soon') + '</button>' +
      addonsHtml() +
      (paypalAvailable()
        ? '<div class="pay-alt"><span class="pay-or">or</span><div class="paypal-mount" data-paypal-mount></div></div>'
        : '') +
      payIcons();
  }

  function paypalAvailable() {
    return !!(CFG.paypalClientId && CFG.storeMode === 'live');
  }

  function renderInto(bodyEl, footEl) {
    if (!bodyEl) return;
    if (!state.items.length) {
      bodyEl.innerHTML = emptyHtml();
      if (footEl) { footEl.innerHTML = ''; footEl.hidden = true; }
      return;
    }
    bodyEl.innerHTML = state.items.map(lineHtml).join('');
    if (footEl) { footEl.innerHTML = footHtml(); footEl.hidden = false; }
  }

  function renderAll() {
    S.$$('[data-cart-count]').forEach(function (el) {
      var n = count();
      el.textContent = String(n);
      el.hidden = n === 0;
    });
    renderInto(S.$('[data-cart-body]'), S.$('[data-cart-foot]'));
    renderInto(S.$('[data-cart-page-body]'), S.$('[data-cart-page-foot]'));
    if (W.Paypal && W.Paypal.mountAll) W.Paypal.mountAll();
    var pageEmpty = S.$('[data-cart-page-empty]');
    if (pageEmpty) pageEmpty.hidden = state.items.length > 0;
    var pageMain = S.$('[data-cart-page-main]');
    if (pageMain) pageMain.hidden = state.items.length === 0;
  }

  listeners.push(renderAll);

  function delegate(e) {
    var t = e.target;
    if (!t || !t.getAttribute) return;
    var el = t.closest ? t.closest('[data-inc],[data-dec],[data-rm],[data-checkout],[data-addon]') : null;
    if (!el) return;
    var inc = el.getAttribute('data-inc');
    var dec = el.getAttribute('data-dec');
    var rm = el.getAttribute('data-rm');
    var addon = el.getAttribute('data-addon');
    if (addon) {
      addAddon(addon);
    } else if (inc) {
      var a = find(inc);
      if (a) setQty(inc, a.qty + 1);
    } else if (dec) {
      var b = find(dec);
      if (b) setQty(dec, b.qty - 1);
    } else if (rm) {
      remove(rm);
    } else if (el.hasAttribute('data-checkout')) {
      if (attachOnlyCart()) { renderAll(); return; }
      if (W.Checkout) W.Checkout.start(el);
    }
  }

  function find(key) {
    for (var i = 0; i < state.items.length; i++) if (lineKey(state.items[i]) === key) return state.items[i];
    return null;
  }

  function boot() {
    panel = S.$('[data-cart-panel]');
    scrim = S.$('[data-cart-scrim]');
    S.$$('[data-cart-open]').forEach(function (b) { S.on(b, 'click', open); });
    S.on(S.$('[data-cart-close]'), 'click', close);
    S.on(scrim, 'click', close);
    S.on(document, 'keydown', function (e) {
      if (e.key === 'Escape' && panel && panel.classList.contains('on')) close();
    });
    S.on(document, 'click', delegate);
    S.on(W, 'storage', function (e) {
      if (e.key !== KEY) return;
      state = read();
      renderAll();
    });
    renderAll();
  }

  W.Cart = {
    add: add, setQty: setQty, remove: remove, clear: clear, open: open, close: close,
    count: count, subtotal: subtotal, currency: currency, priceKey: priceKey,
    lineKey: lineKey, customText: customText,
    isAttachOnlyCart: attachOnlyCart, hasAnchorItem: hasAnchor,
    items: function () { return state.items.slice(); },
    cartId: function () { return state.cartId; },
    onChange: function (fn) { listeners.push(fn); },
    render: renderAll
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
