// Cart page: lists the cart (kept by js/site.js in localStorage), works out the
// totals and sends the order to /api/orders. The server recalculates every
// price, so these figures are only a preview.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var prices = null;
  var me = { signedIn: false };
  var sending = false;

  function money(n) { return 'KES ' + Math.round(n).toLocaleString('en-KE'); }
  function cart() { return window.NECart ? window.NECart.read() : []; }
  function save(items) { if (window.NECart) window.NECart.write(items); render(); }

  function lines() {
    return cart().filter(function (i) { return prices[i.slug]; }).map(function (i) {
      var p = prices[i.slug];
      return { slug: i.slug, qty: i.qty, name: p.n, model: p.m, price: p.p, image: p.i, url: p.u };
    });
  }

  function totals(list) {
    var subtotal = list.reduce(function (n, l) { return n + l.qty * l.price; }, 0);
    var tech = me.techDiscount ? Math.round(subtotal * me.techDiscount / 100) : 0;
    var reward = me.balance && $('use-reward').checked ? Math.min(me.balance, subtotal - tech) : 0;
    return { subtotal: subtotal, tech: tech, reward: reward, total: subtotal - tech - reward };
  }

  function render() {
    if (!prices) return;
    var list = lines();
    $('cart-empty').hidden = list.length > 0;
    $('cart-full').hidden = list.length === 0;
    if (!list.length) return;

    var box = $('cart-items');
    box.textContent = '';
    list.forEach(function (l) {
      var row = document.createElement('div');
      row.className = 'ci';
      row.innerHTML = '<img alt="" loading="lazy" width="72" height="72"><div><a class="nm"></a><div class="sku"></div><div class="each"></div></div>' +
        '<div class="right"><div class="line"></div><div class="qty"><button type="button" aria-label="One less">&minus;</button>' +
        '<input type="number" min="1" max="999" inputmode="numeric" aria-label="Quantity"><button type="button" aria-label="One more">+</button></div>' +
        '<button type="button" class="rm">Remove</button></div>';
      row.querySelector('img').src = '/' + l.image;
      row.querySelector('.nm').textContent = l.name;
      row.querySelector('.nm').href = l.url;
      row.querySelector('.sku').textContent = l.model;
      row.querySelector('.each').textContent = money(l.price) + ' each';
      row.querySelector('.line').textContent = money(l.qty * l.price);
      var input = row.querySelector('input');
      input.value = l.qty;
      function setQty(q) {
        q = Math.max(1, Math.min(999, Math.floor(Number(q) || 1)));
        save(cart().map(function (i) { return i.slug === l.slug ? { slug: i.slug, qty: q } : i; }));
      }
      var buttons = row.querySelectorAll('.qty button');
      buttons[0].addEventListener('click', function () { setQty(l.qty - 1); });
      buttons[1].addEventListener('click', function () { setQty(l.qty + 1); });
      input.addEventListener('change', function () { setQty(input.value); });
      row.querySelector('.rm').addEventListener('click', function () {
        save(cart().filter(function (i) { return i.slug !== l.slug; }));
      });
      box.appendChild(row);
    });

    var t = totals(list);
    var sum = $('cart-sum');
    var count = list.reduce(function (n, l) { return n + l.qty; }, 0);
    var rows = [['Items (' + count + ')', money(t.subtotal), '']];
    if (t.tech) rows.push(['Technician discount (' + me.techDiscount + '%)', '−' + money(t.tech), 'minus']);
    if (t.reward) rows.push(['Reward credit', '−' + money(t.reward), 'minus']);
    var delivery = (document.querySelector('input[name=delivery]:checked') || {}).value;
    rows.push(['Delivery', delivery === 'outside' ? 'Fare paid by you' : 'Free', '']);
    rows.push(['Total', money(t.total), 'tot']);
    // The reward the order earns once paid: shown to members, and to guests as the reason to sign in.
    var pct = me.signedIn ? Number(me.rewardPercent) || 0 : 2;
    var earn = Math.floor(t.total * pct / 100);
    if (!me.signedIn) $('nudge-amount').textContent = earn > 0 ? 'Get ' + money(earn) + ' back on this order' : 'Get 2% back on every order';
    $('earn-line').hidden = !(me.signedIn && earn > 0);
    if (me.signedIn) $('earn-line').textContent = 'You earn ' + money(earn) + ' reward credit (' + pct + '%) when this order is paid.';
    sum.textContent = '';
    rows.forEach(function (r) {
      var div = document.createElement('div');
      if (r[2]) div.className = r[2];
      div.innerHTML = '<span></span><span></span>';
      div.children[0].textContent = r[0];
      div.children[1].textContent = r[1];
      sum.appendChild(div);
    });
  }

  function showError(text) {
    $('co-error').textContent = text;
    $('co-error').hidden = !text;
    if (text) $('co-error').scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function send(channel) {
    if (sending) return;
    var form = $('checkout');
    var data = {
      channel: channel,
      items: cart().map(function (i) { return { slug: i.slug, qty: i.qty }; }),
      customer: { name: form.elements.name.value, phone: form.elements.phone.value, email: form.elements.email.value },
      delivery: { type: (form.querySelector('input[name=delivery]:checked') || {}).value, town: form.elements.town.value, transport: form.elements.transport.value },
      notes: form.elements.notes.value,
      consent: form.elements.consent.checked,
      useReward: Boolean(me.balance && $('use-reward').checked),
    };
    if (!data.customer.name.trim()) return showError('Please enter your name.');
    if (!data.customer.phone.trim()) return showError('Please enter your phone number.');
    showError('');
    // WhatsApp must open from the tap itself, or phones block it as a pop-up.
    var waWindow = channel === 'whatsapp' ? window.open('', '_blank') : null;
    sending = true;
    Array.prototype.forEach.call(document.querySelectorAll('.send button'), function (b) { b.disabled = true; });
    fetch('/api/orders', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(data),
    }).then(function (r) {
      return r.json().then(function (res) { if (!r.ok) throw new Error(res.error || 'Could not send the order.'); return res; });
    }).then(function (res) {
      save([]);
      var orderPage = '/order/?n=' + encodeURIComponent(res.number) + '&k=' + encodeURIComponent(res.token) + '&sent=' + channel;
      if (channel === 'whatsapp') {
        var wa = 'https://wa.me/254737454891?text=' + encodeURIComponent(res.message);
        if (waWindow) waWindow.location.href = wa; else window.open(wa, '_blank');
      }
      window.location.href = orderPage;
    }).catch(function (err) {
      if (waWindow) waWindow.close();
      showError(err.message);
    }).then(function () {
      sending = false;
      Array.prototype.forEach.call(document.querySelectorAll('.send button'), function (b) { b.disabled = false; });
    });
  }

  function init() {
    var form = $('checkout');
    Array.prototype.forEach.call(form.querySelectorAll('input[name=delivery]'), function (radio) {
      radio.addEventListener('change', function () {
        $('outside-fields').hidden = radio.value !== 'outside' || !radio.checked;
        render();
      });
    });
    $('use-reward').addEventListener('change', render);
    Array.prototype.forEach.call(document.querySelectorAll('.send button'), function (b) {
      b.addEventListener('click', function () { send(b.getAttribute('data-channel')); });
    });
    window.addEventListener('ne:cart', function () { if (prices) render(); });

    var account = document.cookie.indexOf('ne_signed_in=1') !== -1
      ? fetch('/api/account/summary', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).catch(function () { return { signedIn: false }; })
      : Promise.resolve({ signedIn: false });
    Promise.all([fetch('/data/prices.json').then(function (r) { return r.json(); }), account]).then(function (out) {
      prices = out[0];
      me = out[1];
      if (me.signedIn) {
        if (!form.elements.name.value) form.elements.name.value = me.name || '';
        if (!form.elements.email.value) form.elements.email.value = me.email || '';
        if (me.balance > 0) {
          $('reward-text').textContent = 'Use my reward credit: ' + money(me.balance);
          $('use-reward').checked = true;
          $('reward-opt').hidden = false;
        }
      } else {
        $('signin-nudge').hidden = false;
      }
      render();
    }).catch(function () {
      $('cart-empty').hidden = false;
      $('cart-empty').querySelector('strong').textContent = 'Could not load the cart. Please refresh the page.';
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
