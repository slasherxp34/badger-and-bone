(function () {
  'use strict';

  var W = window;
  var CFG = W.STORE_CONFIG || {};

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { var n = (root || document).querySelectorAll(sel); return Array.prototype.slice.call(n); }

  function money(cents, currency) {
    var sign = cents < 0 ? '-' : '';
    var n = Math.abs(Math.round(cents));
    var s = (n / 100).toFixed(2);
    if (!currency || currency === 'USD') return sign + '$' + s;
    return sign + s + ' ' + currency;
  }

  function moneyShort(cents, currency) {
    if (cents % 100 === 0) {
      var sign = cents < 0 ? '-' : '';
      var whole = Math.abs(cents) / 100;
      if (!currency || currency === 'USD') return sign + '$' + whole;
      return sign + whole + ' ' + currency;
    }
    return money(cents, currency);
  }

  function escHtml(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function safeUrl(v) {
    var s = String(v === null || v === undefined ? '' : v)
      .replace(/[\u0000-\u0020\u007F-\u009F]/g, '');
    if (!s) return '';
    if (s.slice(0, 2) === '//') return '';
    if (/^(https?:|mailto:)/i.test(s)) return s;
    if (s.charAt(0) === '/' || s.charAt(0) === '#' ||
      s.slice(0, 2) === './' || s.slice(0, 3) === '../') return s;
    var colon = s.indexOf(':');
    if (colon < 0) return s;
    var sep = s.search(/[/?#]/);
    if (sep >= 0 && sep < colon) return s;
    return '';
  }

  function escUrl(v) {
    return escHtml(safeUrl(v));
  }

  function addBusinessDays(date, days) {
    var d = new Date(date.getTime());
    var left = Math.max(0, Math.round(days));
    while (left > 0) {
      d.setDate(d.getDate() + 1);
      var day = d.getDay();
      if (day !== 0 && day !== 6) left -= 1;
    }
    return d;
  }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function deliveryRange(from) {
    var s = CFG.shipping || {};
    var proc = s.processingDays || [1, 2];
    var tran = s.transitDaysUS || [3, 6];
    var base = from || new Date();
    var a = addBusinessDays(base, (proc[0] || 0) + (tran[0] || 0));
    var b = addBusinessDays(base, (proc[1] == null ? proc[0] : proc[1]) + (tran[1] == null ? tran[0] : tran[1]));
    if (a.getMonth() === b.getMonth()) return MONTHS[a.getMonth()] + ' ' + a.getDate() + '–' + b.getDate();
    return MONTHS[a.getMonth()] + ' ' + a.getDate() + '–' + MONTHS[b.getMonth()] + ' ' + b.getDate();
  }

  function on(el, ev, fn, opts) { if (el) el.addEventListener(ev, fn, opts || false); }

  function trackBase(name, payload) {
    try {
      W.dataLayer = W.dataLayer || [];
      W.dataLayer.push({ event: name, ecommerce: payload || {} });
    } catch (e) {}
  }

  function track(name, payload) {
    var fn = (W.Store && W.Store.track) || trackBase;
    fn(name, payload);
  }

  function apiUrl(path) {
    var base = CFG.apiBase || '';
    if (!base) return '';
    return base.replace(/\/+$/, '') + path;
  }

  function postJson(url, body, timeoutMs) {
    return new Promise(function (resolve, reject) {
      if (!url) { reject(new Error('no-api')); return; }
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        reject(new Error('timeout'));
      }, timeoutMs || 12000);
      var xhr = new XMLHttpRequest();
      xhr.open('POST', url, true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4 || done) return;
        done = true;
        clearTimeout(timer);
        var data = null;
        try { data = JSON.parse(xhr.responseText); } catch (e) { data = null; }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data || {});
        else reject(new Error('http-' + xhr.status));
      };
      xhr.onerror = function () {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(new Error('network'));
      };
      xhr.send(JSON.stringify(body || {}));
    });
  }

  function getJson(url, timeoutMs) {
    return new Promise(function (resolve, reject) {
      if (!url) { reject(new Error('no-api')); return; }
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        reject(new Error('timeout'));
      }, timeoutMs || 12000);
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4 || done) return;
        done = true;
        clearTimeout(timer);
        var data = null;
        try { data = JSON.parse(xhr.responseText); } catch (e) { data = null; }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data || {});
        else reject(new Error('http-' + xhr.status));
      };
      xhr.onerror = function () {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(new Error('network'));
      };
      xhr.send();
    });
  }

  function param(name) {
    var m = new RegExp('[?&]' + name + '=([^&#]*)').exec(W.location.search);
    return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
  }

  function initNav() {
    var nav = document.getElementById('nav');
    if (nav) {
      var onScroll = function () {
        if (W.pageYOffset > 8) nav.classList.add('scrolled');
        else nav.classList.remove('scrolled');
      };
      on(W, 'scroll', onScroll, { passive: true });
      onScroll();
    }
    var btn = document.getElementById('hamburger');
    var menu = document.getElementById('mobile-menu');
    if (!btn || !menu) return;
    var close = function () {
      menu.classList.remove('open');
      btn.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
      btn.setAttribute('aria-label', 'Open menu');
      document.body.style.overflow = '';
    };
    on(btn, 'click', function () {
      var isOpen = menu.classList.toggle('open');
      btn.classList.toggle('open', isOpen);
      btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      btn.setAttribute('aria-label', isOpen ? 'Close menu' : 'Open menu');
      document.body.style.overflow = isOpen ? 'hidden' : '';
    });
    $$('a', menu).forEach(function (a) { on(a, 'click', close); });
    on(document, 'keydown', function (e) {
      if (e.key === 'Escape' && menu.classList.contains('open')) close();
    });
  }

  function initAccordions() {
    $$('[data-acc]').forEach(function (root) {
      $$('.acc-q', root).forEach(function (q) {
        on(q, 'click', function () {
          var item = q.parentNode;
          var open = item.classList.toggle('open');
          q.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
      });
    });
  }

  function initGallery() {
    var gal = $('[data-gallery]');
    if (!gal) return;
    var track = $('[data-gal-track]', gal);
    var slides = $$('.gal-slide', track);
    if (!track || slides.length < 1) return;
    var thumbs = $$('[data-gal-thumb]', gal);
    var dots = $$('[data-gal-dot]', gal);
    var current = 0;

    function setActive(i) {
      current = Math.max(0, Math.min(slides.length - 1, i));
      thumbs.forEach(function (t, n) { t.classList.toggle('on', n === current); });
      dots.forEach(function (d, n) {
        d.classList.toggle('on', n === current);
        d.setAttribute('aria-current', n === current ? 'true' : 'false');
      });
      var vids = $$('video', track);
      vids.forEach(function (v, n) {
        var slideIndex = slides.indexOf(v.closest('.gal-slide'));
        if (slideIndex !== current) { try { v.pause(); } catch (e) {} }
        else { var pr = v.play(); if (pr && pr.catch) pr.catch(function () {}); }
      });
    }

    function goTo(i) {
      var idx = Math.max(0, Math.min(slides.length - 1, i));
      track.scrollTo({ left: slides[idx].offsetLeft - track.offsetLeft, behavior: 'smooth' });
      setActive(idx);
    }

    thumbs.forEach(function (t, n) { on(t, 'click', function () { goTo(n); }); });
    dots.forEach(function (d, n) { on(d, 'click', function () { goTo(n); }); });
    var prev = $('[data-gal-prev]', gal);
    var next = $('[data-gal-next]', gal);
    on(prev, 'click', function () { goTo(current - 1); });
    on(next, 'click', function () { goTo(current + 1); });

    var raf = null;
    on(track, 'scroll', function () {
      if (raf) return;
      raf = W.requestAnimationFrame(function () {
        raf = null;
        var mid = track.scrollLeft + track.clientWidth / 2;
        var best = 0, bestD = Infinity;
        slides.forEach(function (s, n) {
          var c = s.offsetLeft - track.offsetLeft + s.clientWidth / 2;
          var d = Math.abs(c - mid);
          if (d < bestD) { bestD = d; best = n; }
        });
        if (best !== current) setActive(best);
      });
    }, { passive: true });

    on(gal, 'keydown', function (e) {
      if (e.key === 'ArrowLeft') { goTo(current - 1); }
      else if (e.key === 'ArrowRight') { goTo(current + 1); }
    });

    setActive(0);
  }

  function initBuyBox() {
    var box = $('[data-buy]');
    if (!box) return;
    var data = null;
    try { data = JSON.parse(($('#product-data') || {}).textContent || 'null'); } catch (e) { data = null; }
    if (!data) return;

    var axisOrder = (data.axisOrder && data.axisOrder.length)
      ? data.axisOrder.slice()
      : (function () {
        var seen = [];
        (data.variants || []).forEach(function (v) {
          var a = v.axis || v.group || 'coat';
          if (seen.indexOf(a) === -1) seen.push(a);
        });
        return seen;
      })();

    function variantsOnAxis(axis) {
      return (data.variants || []).filter(function (v) { return (v.axis || v.group || 'coat') === axis; });
    }

    var state = { sel: {}, bundleQty: data.defaultBundleQty || 1, qty: 1 };
    axisOrder.forEach(function (axis, i) {
      var pool = variantsOnAxis(axis);
      var pre = (data.defaultCombo || [])[i];
      var chosen = null;
      for (var j = 0; j < pool.length; j++) if (pool[j].id === pre) { chosen = pool[j]; break; }
      if (!chosen) {
        for (var k = 0; k < pool.length; k++) if (pool[k].inStock) { chosen = pool[k]; break; }
      }
      if (!chosen) chosen = pool[0];
      if (chosen) state.sel[axis] = chosen.id;
    });

    var pers = data.personalization || null;
    var elPersonal = $('[data-personal-input]', box);
    var elPersonalErr = $('[data-personal-error]', box);
    var elPersonalUsed = $('[data-personal-used]', box);
    var elPersonalCount = $('[data-personal-count]', box);
    var personalRe = null;
    if (pers && pers.pattern) {
      try { personalRe = new RegExp(pers.pattern); } catch (e) { personalRe = null; }
    }

    function personalText() {
      if (!pers || !elPersonal) return '';
      return String(elPersonal.value || '').replace(/^\s+|\s+$/g, '');
    }

    function personalProblem() {
      if (!pers) return '';
      var t = personalText();
      if (!t) return pers.required ? 'Please add ' + (pers.label || 'a name') + ' before adding to cart.' : '';
      if (pers.maxLength && t.length > pers.maxLength) {
        return 'Please use ' + pers.maxLength + ' characters or fewer.';
      }
      if (personalRe && !personalRe.test(t)) {
        return 'Letters, numbers, spaces, apostrophes, & and - only.';
      }
      return '';
    }

    function showPersonalError(msg) {
      if (elPersonalErr) {
        elPersonalErr.textContent = msg || '';
        elPersonalErr.hidden = !msg;
      }
      if (elPersonal) {
        if (msg) elPersonal.classList.add('invalid');
        else elPersonal.classList.remove('invalid');
        elPersonal.setAttribute('aria-invalid', msg ? 'true' : 'false');
      }
    }

    function renderPersonalCount() {
      if (!pers || !elPersonal) return;
      var used = String(elPersonal.value || '').length;
      if (elPersonalUsed) elPersonalUsed.textContent = String(used);
      if (elPersonalCount) {
        var near = pers.maxLength && used >= pers.maxLength - 2;
        if (near) elPersonalCount.classList.add('near');
        else elPersonalCount.classList.remove('near');
      }
    }

    if (elPersonal) {
      on(elPersonal, 'input', function () {
        renderPersonalCount();
        if (elPersonalErr && !elPersonalErr.hidden) showPersonalError(personalProblem());
      });
      on(elPersonal, 'blur', function () { showPersonalError(personalProblem()); });
      renderPersonalCount();
    }

    var elNow = $('[data-price-now]', box);
    var elUnit = $('[data-price-unit]', box);
    var elWas = $('[data-price-was]', box);
    var elSave = $('[data-price-save]', box);
    var elVarLabel = $('[data-variant-label]', box);
    var elQty = $('[data-qty-value]', box);

    function byId(id) {
      for (var i = 0; i < data.variants.length; i++) if (data.variants[i].id === id) return data.variants[i];
      return null;
    }

    function combo() {
      return axisOrder.map(function (axis) { return byId(state.sel[axis]); })
        .filter(function (v) { return !!v; });
    }

    function variantSel() {
      var ids = combo().map(function (v) { return v.id; });
      return ids.length ? ids.join('+') : '_';
    }

    function comboDelta() {
      return combo().reduce(function (n, v) { return n + (v.priceDelta || 0); }, 0);
    }

    function imageVariant() {
      var c = combo();
      for (var i = 0; i < c.length; i++) {
        if ((c[i].axis || c[i].group) === 'coat') return c[i];
      }
      return c[0] || null;
    }

    function comboLabel() {
      return combo().map(function (v) { return v.name; }).join(' \u00b7 ');
    }

    function variant() { return imageVariant(); }

    function bundle() {
      for (var i = 0; i < data.bundles.length; i++) if (data.bundles[i].qty === state.bundleQty) return data.bundles[i];
      return data.bundles[0];
    }

    function lineTotal() {
      var b = bundle();
      return (b.price + comboDelta() * b.qty) * state.qty;
    }

    function render() {
      var b = bundle();
      var v = imageVariant();
      var vDeltaPerUnit = comboDelta();
      var delta = vDeltaPerUnit * b.qty;
      var total = b.price + delta;
      var unit = Math.round(total / b.qty);
      if (elNow) elNow.textContent = money(total, data.currency);
      if (elUnit) {
        elUnit.textContent = b.qty > 1
          ? money(unit, data.currency) + ' per unit · ' + b.qty + ' units'
          : money(unit, data.currency) + ' each';
      }
      if (elWas && data.compareAt) elWas.textContent = money(data.compareAt * b.qty, data.currency);
      if (elSave) {
        var save = data.price > 0 ? Math.round((1 - unit / data.price) * 100) : 0;
        if (save > 0) { elSave.textContent = 'Save ' + save + '%'; elSave.hidden = false; }
        else elSave.hidden = true;
      }
      if (elVarLabel) elVarLabel.textContent = comboLabel();
      if (elQty) elQty.textContent = String(state.qty);

      axisOrder.forEach(function (axis) {
        var el = $('[data-axis-label="' + axis + '"]', box);
        var sv = byId(state.sel[axis]);
        if (el && sv) el.textContent = sv.name;
      });

      $$('[data-variant]', box).forEach(function (btn) {
        var axis = btn.getAttribute('data-variant-axis') || 'coat';
        var isOn = btn.getAttribute('data-variant') === state.sel[axis];
        btn.classList.toggle('on', isOn);
        btn.setAttribute('aria-pressed', isOn ? 'true' : 'false');
      });
      $$('[data-tier]', box).forEach(function (btn) {
        var tierQty = parseInt(btn.getAttribute('data-tier'), 10);
        var isOn = tierQty === state.bundleQty;
        btn.classList.toggle('on', isOn);
        btn.setAttribute('aria-pressed', isOn ? 'true' : 'false');

        var tb = null;
        for (var t = 0; t < data.bundles.length; t++) {
          if (data.bundles[t].qty === tierQty) { tb = data.bundles[t]; break; }
        }
        if (!tb) return;
        var vDelta = vDeltaPerUnit;
        var tierTotal = tb.price + vDelta * tb.qty;
        var tierUnit = Math.round(tierTotal / tb.qty);
        var elTotal = $('[data-tier-total]', btn) || $('.tier-total', btn);
        var elTierUnit = $('[data-tier-unit]', btn) || $('.tier-unit', btn);
        if (elTotal) elTotal.textContent = money(tierTotal, data.currency);
        if (elTierUnit) elTierUnit.textContent = money(tierUnit, data.currency) + ' per unit';
        var elOff = $('[data-tier-off]', btn) || $('.tier-off', btn);
        if (elOff) {
          var singleUnit = data.bundles[0] ? (data.bundles[0].price + vDelta * data.bundles[0].qty) / data.bundles[0].qty : 0;
          var off = singleUnit > 0 ? Math.round((1 - tierUnit / singleUnit) * 100) : 0;
          if (off > 0) { elOff.textContent = 'Save ' + off + '%'; elOff.hidden = false; }
          else elOff.hidden = true;
        }
      });

      var sName = $('[data-sticky-name]');
      var sPrice = $('[data-sticky-price]');
      if (sName) sName.textContent = data.name + (data.variants.length > 1 && comboLabel() ? ' \u00b7 ' + comboLabel() : '');
      if (sPrice) sPrice.textContent = money(total * state.qty, data.currency);

      var img = $('[data-sticky-img]');
      if (img && v && typeof v.image === 'number' && data.imageSrcs && data.imageSrcs[v.image]) {
        img.setAttribute('src', data.imageSrcs[v.image]);
      }
    }

    $$('[data-variant]', box).forEach(function (btn) {
      on(btn, 'click', function () {
        if (btn.classList.contains('out')) return;
        var axis = btn.getAttribute('data-variant-axis') || 'coat';
        state.sel[axis] = btn.getAttribute('data-variant');
        if (axis === 'coat') {
          var gi = btn.getAttribute('data-image');
          if (gi !== null && gi !== '') {
            var gal = $('[data-gallery]');
            var track = gal && $('[data-gal-track]', gal);
            var slides = track ? $$('.gal-slide', track) : [];
            var target = parseInt(gi, 10) + (data.hasVideo ? 1 : 0);
            if (slides[target]) track.scrollTo({ left: slides[target].offsetLeft - track.offsetLeft, behavior: 'smooth' });
          }
        }
        render();
      });
    });

    $$('[data-tier]', box).forEach(function (btn) {
      on(btn, 'click', function () {
        state.bundleQty = parseInt(btn.getAttribute('data-tier'), 10);
        render();
      });
    });

    on($('[data-qty-dec]', box), 'click', function () {
      state.qty = Math.max(1, state.qty - 1);
      render();
    });
    on($('[data-qty-inc]', box), 'click', function () {
      state.qty = Math.min(10, state.qty + 1);
      render();
    });

    var attachIds = (CFG.attachOnly || []).map(function (a) { return a.id; });
    function cartHasAnchor() {
      if (!W.Cart) return false;
      return W.Cart.items().some(function (it) { return attachIds.indexOf(it.productId) === -1; });
    }
    function syncAttachControl() {
      if (!data.attachOnly) return;
      var ok = cartHasAnchor();
      $$('[data-attach-add]').forEach(function (btn) { btn.disabled = !ok; });
      var why = $('[data-attach-why]');
      if (why) {
        why.textContent = ok
          ? 'Rides along with the rest of your order — no extra shipping.'
          : why.getAttribute('data-default') || why.textContent;
      }
    }
    if (data.attachOnly) {
      var whyEl = $('[data-attach-why]');
      if (whyEl) whyEl.setAttribute('data-default', whyEl.textContent);
      if (W.Cart && W.Cart.onChange) W.Cart.onChange(syncAttachControl);
      syncAttachControl();
    }

    function addToCart() {
      if (data.attachOnly && !cartHasAnchor()) {
        syncAttachControl();
        return;
      }

      var problem = personalProblem();
      if (problem) {
        showPersonalError(problem);
        if (elPersonal) {
          try { elPersonal.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {}
          elPersonal.focus();
        }
        return;
      }
      showPersonalError('');

      var b = bundle();
      var v = imageVariant();
      var delta = comboDelta() * b.qty;
      var custom = null;
      if (pers) {
        var text = personalText();
        if (text) custom = { text: text };
      }
      W.Cart.add({
        productId: data.id,
        variantSel: variantSel(),
        variantId: variantSel() === '_' ? null : variantSel(),
        variantName: comboLabel(),
        bundleQty: b.qty,
        bundleLabel: b.label,
        name: data.name,
        slug: data.slug,
        href: data.href,
        image: data.imageSrcs && data.imageSrcs[v && typeof v.image === 'number' ? v.image : 0] || (data.imageSrcs || [])[0] || '',
        unitAmount: b.price + delta,
        currency: data.currency,
        qty: state.qty,
        custom: custom,
        personalizationLabel: pers ? pers.label : ''
      });
      track('add_to_cart', { value: lineTotal() / 100, currency: data.currency, items: [{ item_id: data.id, item_name: data.name, quantity: state.qty }] });
    }

    $$('[data-add]').forEach(function (btn) { on(btn, 'click', addToCart); });

    var sticky = $('[data-sticky]');
    var inlineAtc = $('[data-atc-anchor]');
    if (sticky && inlineAtc && 'IntersectionObserver' in W) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          sticky.classList.toggle('up', !en.isIntersecting && en.boundingClientRect.top < 0);
        });
      }, { rootMargin: '0px', threshold: 0 });
      io.observe(inlineAtc);
    }

    render();
    track('view_item', { items: [{ item_id: data.id, item_name: data.name, price: data.price / 100 }] });
  }

  function initReveal() {
    var items = $$('.reveal');
    if (!items.length) return;
    var reduce = W.matchMedia && W.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !('IntersectionObserver' in W)) {
      items.forEach(function (el) { el.classList.add('in'); });
      return;
    }
    document.documentElement.classList.add('js-anim');
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        en.target.classList.add('in');
        io.unobserve(en.target);
      });
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0 });
    items.forEach(function (el) { io.observe(el); });

    var sweep = function () {
      $$('.reveal:not(.in)').forEach(function (el) {
        var r = el.getBoundingClientRect();
        if (r.top < (W.innerHeight || 0) * 1.15) el.classList.add('in');
      });
    };
    on(W, 'scroll', sweep, { passive: true });
    W.setTimeout(sweep, 2000);
  }

  function initCapture() {
    var form = $('[data-capture]');
    if (!form) return;
    on(form, 'submit', function (e) {
      e.preventDefault();
      var input = $('input[type=email]', form);
      var msg = $('[data-capture-msg]', form.parentNode) || $('[data-capture-msg]', form);
      var email = (input && input.value || '').trim();
      if (!email || email.indexOf('@') < 1) {
        if (msg) { msg.textContent = 'Please enter a valid email address.'; msg.className = 'cap-msg form-msg err'; }
        return;
      }
      try {
        var list = JSON.parse(localStorage.getItem('subscribers.v1') || '[]');
        if (list.indexOf(email) < 0) list.push(email);
        localStorage.setItem('subscribers.v1', JSON.stringify(list));
      } catch (err) {}
      if (msg) { msg.textContent = 'Thanks — you’re on the list.'; msg.className = 'cap-msg form-msg ok'; }
      if (input) input.value = '';
      track('sign_up', { method: 'email_capture' });
      var url = apiUrl('/api/contact');
      if (url) postJson(url, { type: 'subscribe', email: email }, 8000).catch(function () {});
    });
  }

  W.Store = {
    $: $, $$: $$, on: on, money: money, moneyShort: moneyShort, escHtml: escHtml,
    safeUrl: safeUrl, escUrl: escUrl,
    deliveryRange: deliveryRange, track: trackBase, apiUrl: apiUrl,
    postJson: postJson, getJson: getJson, param: param, cfg: CFG
  };

  function boot() {
    initNav();
    initAccordions();
    initGallery();
    initBuyBox();
    initReveal();
    initCapture();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
