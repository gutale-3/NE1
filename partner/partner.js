// NE Partner Portal: trade partners apply, see their own prices and order.
// Talks to /api/partner (worker/index.js + worker/partners.js).
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var products = [];
  var cart = {};          // slug -> { qty, requested }
  var KEY = 'ne_partner_cart';
  var PAGE = 120;

  function money(n) { return 'KES ' + Math.round(n).toLocaleString('en-KE'); }

  function api(body) {
    var init = { credentials: 'same-origin' };
    if (body) { init.method = 'POST'; init.headers = { 'content-type': 'application/json' }; init.body = JSON.stringify(body); }
    return fetch('/api/partner', init).then(function (r) {
      if (r.status === 401) { location.href = '/auth/google/login?next=/partner/'; throw new Error('Please sign in.'); }
      return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || 'Something went wrong.'); return d; });
    });
  }

  function error(text) { $('error').textContent = text || ''; $('error').hidden = !text; if (text) scrollTo(0, 0); }

  var STATUS = {
    pending: ['Application received', 'Thank you. We review every application, usually with a quick call or WhatsApp. You will see your trade prices here as soon as your account is approved.'],
    rejected: ['Application not approved', 'We could not approve this application. WhatsApp us on 0737 454 891 if you think this is a mistake, or update your details below and apply again.'],
    suspended: ['Account paused', 'Your partner account is paused. Please WhatsApp us on 0737 454 891.'],
  };

  function showApply(data) {
    $('apply-view').hidden = false;
    var sel = $('kind');
    sel.length = 0;
    sel.add(new Option('Choose…', ''));
    data.kinds.forEach(function (k) { sel.add(new Option(k, k)); });
    var p = data.partner;
    var form = $('apply-form');
    if (p) {
      var t = STATUS[p.status] || STATUS.pending;
      var card = $('status-card');
      card.innerHTML = '<span class="status"></span><h2></h2><p></p>';
      card.querySelector('.status').className = 'status ' + p.status;
      card.querySelector('.status').textContent = p.status.charAt(0).toUpperCase() + p.status.slice(1);
      card.querySelector('h2').textContent = t[0];
      card.querySelector('p').textContent = t[1];
      card.hidden = false;
      ['company', 'contact', 'phone', 'town', 'kind', 'hik_id', 'kra_pin'].forEach(function (k) { if (p[k]) form.elements[k].value = p[k]; });
      form.parentNode.hidden = p.status === 'pending' || p.status === 'suspended';
    } else {
      form.elements.contact.value = data.user.name || '';
    }
  }

  // ---- portal -----------------------------------------------------------------
  function save() { try { localStorage.setItem(KEY, JSON.stringify(cart)); } catch (e) { /* private mode */ } }

  function totals() {
    var total = 0, lines = 0, units = 0, asks = 0;
    products.forEach(function (p) {
      var c = cart[p.slug];
      if (!c || !c.qty) return;
      lines++; units += c.qty; total += c.qty * p.price;
      if (c.requested) asks++;
    });
    return { total: total, lines: lines, units: units, asks: asks };
  }

  function updateBar() {
    var t = totals();
    $('bar').hidden = !t.lines;
    $('bar-total').textContent = money(t.total);
    $('bar-sub').textContent = t.lines + ' product' + (t.lines === 1 ? '' : 's') + ', ' + t.units + ' unit' + (t.units === 1 ? '' : 's') +
      (t.asks ? ' · ' + t.asks + ' price request' + (t.asks === 1 ? '' : 's') : '');
  }

  function row(p) {
    var tr = document.createElement('tr');
    var c = cart[p.slug] || {};
    if (c.qty) tr.className = 'on';
    tr.innerHTML = '<td class="prod"><img alt="" loading="lazy"><div><b></b><small></small></div></td>' +
      '<td class="n" data-label="Website"><span class="web"></span></td>' +
      '<td class="n" data-label="Your price"><span class="yours"></span></td>' +
      '<td class="n" data-label="Qty"><input class="qty" type="number" min="0" max="9999" step="1" inputmode="numeric" placeholder="0"></td>' +
      '<td class="n" data-label="Target price"><input class="ask" type="number" min="1" step="1" inputmode="numeric" placeholder="—"></td>' +
      '<td class="n line" data-label="Line total"></td>';
    tr.querySelector('img').src = '/' + String(p.image || 'assets/nashnaal-favicon.png').replace(/^\//, '');
    tr.querySelector('b').textContent = p.name;
    tr.querySelector('small').textContent = p.model + ' · ' + p.category;
    tr.querySelector('.web').textContent = p.retail !== p.price ? money(p.retail) : '';
    var yours = tr.querySelector('.yours');
    yours.textContent = money(p.price);
    if (p.own) { var tag = document.createElement('span'); tag.className = 'own'; tag.textContent = 'Your agreed price'; yours.appendChild(tag); }
    var qty = tr.querySelector('.qty'), ask = tr.querySelector('.ask'), line = tr.querySelector('.line');
    if (c.qty) qty.value = c.qty;
    if (c.requested) ask.value = c.requested;
    function sync() {
      var n = Math.max(0, Math.min(9999, Math.floor(Number(qty.value) || 0)));
      var r = Math.round(Number(ask.value) || 0);
      if (n) cart[p.slug] = { qty: n, requested: r > 0 && r < p.price ? r : 0 }; else delete cart[p.slug];
      ask.style.borderColor = r && r >= p.price ? '#D92D20' : '';
      ask.title = r && r >= p.price ? 'A target price must be below your current price' : '';
      tr.className = n ? 'on' : '';
      line.textContent = n ? money(n * p.price) : '';
      save(); updateBar();
    }
    qty.addEventListener('input', sync);
    ask.addEventListener('input', sync);
    line.textContent = c.qty ? money(c.qty * p.price) : '';
    return tr;
  }

  function render() {
    var q = $('q').value.trim().toLowerCase();
    var cat = $('cat').value;
    var only = $('only-sel').checked;
    var shown = products.filter(function (p) {
      if (only && !(cart[p.slug] && cart[p.slug].qty)) return false;
      if (cat && p.category !== cat) return false;
      return !q || (p.model + ' ' + p.name).toLowerCase().indexOf(q) !== -1;
    });
    var tbody = $('rows');
    tbody.textContent = '';
    shown.slice(0, PAGE).forEach(function (p) { tbody.appendChild(row(p)); });
    $('count').textContent = shown.length + ' of ' + products.length + ' products';
    $('more').hidden = shown.length <= PAGE;
    $('more').textContent = 'Showing the first ' + PAGE + '. Search to find the rest.';
  }

  function showPortal(data) {
    var p = data.partner;
    $('portal-view').hidden = false;
    $('p-kind').textContent = p.kind;
    $('p-company').textContent = p.company;
    var own = data.products.filter(function (x) { return x.own; }).length;
    $('p-terms').textContent = (p.discount ? p.discount + '% off website prices' : 'Trade prices') +
      (own ? ', plus ' + own + ' agreed product price' + (own === 1 ? '' : 's') : '') + '. Prices in KES.';
    products = data.products;
    try { cart = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { cart = {}; }
    var known = {};
    products.forEach(function (x) { known[x.slug] = true; });
    Object.keys(cart).forEach(function (s) { if (!known[s]) delete cart[s]; });
    var cats = Array.from(new Set(products.map(function (x) { return x.category; }))).sort();
    cats.forEach(function (c) { $('cat').add(new Option(c, c)); });
    render(); updateBar();
    renderOrders(data.orders || []);
  }

  function renderOrders(orders) {
    var box = $('orders');
    box.textContent = '';
    if (!orders.length) { box.innerHTML = '<p class="sub">No orders yet.</p>'; return; }
    orders.forEach(function (o) {
      var a = document.createElement('a');
      a.className = 'order';
      a.href = '/order/?n=' + encodeURIComponent(o.number) + '&k=' + encodeURIComponent(o.token);
      a.target = '_blank'; a.rel = 'noopener';
      a.innerHTML = '<div><b></b><small></small></div><div style="text-align:right"><div class="st"></div><b class="tot"></b></div>';
      a.querySelector('b').textContent = o.number;
      var asks = o.requests.length ? ' · price requests: ' + o.requests.map(function (r) { return r.model + ' ' + money(r.requested) + ' (' + r.result + ')'; }).join(', ') : '';
      a.querySelector('small').textContent = new Date(o.created_at.replace(' ', 'T') + 'Z').toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) + ' · ' + o.lines + ' products' + asks;
      a.querySelector('.st').textContent = o.status;
      a.querySelector('.tot').textContent = money(o.total);
      box.appendChild(a);
    });
  }

  function review() {
    var ul = $('lines');
    ul.textContent = '';
    products.forEach(function (p) {
      var c = cart[p.slug];
      if (!c || !c.qty) return;
      var li = document.createElement('li');
      li.innerHTML = '<span></span><span></span>';
      li.firstChild.textContent = c.qty + ' × ' + p.name + ' (' + p.model + ')';
      li.lastChild.textContent = money(c.qty * p.price);
      if (c.requested) {
        var s = document.createElement('small');
        s.textContent = ' · asking ' + money(c.requested) + ' each';
        li.firstChild.appendChild(s);
      }
      ul.appendChild(li);
    });
    var t = totals();
    var li2 = document.createElement('li');
    li2.innerHTML = '<b>Total at your prices</b><b></b>';
    li2.lastChild.textContent = money(t.total);
    ul.appendChild(li2);
    $('send').textContent = t.asks ? 'Send order and price requests' : 'Send order';
    $('checkout').hidden = false;
    $('checkout').scrollIntoView({ behavior: 'smooth' });
  }

  function send() {
    var btn = $('send');
    btn.disabled = true;
    error('');
    var items = Object.keys(cart).map(function (s) { return { slug: s, qty: cart[s].qty, requested: cart[s].requested || 0 }; });
    api({ action: 'order', items: items, delivery: $('delivery').value, town: $('town').value, notes: $('notes').value })
      .then(function (r) {
        cart = {}; save();
        $('checkout').hidden = true;
        $('done').innerHTML = '';
        var t = document.createElement('span');
        t.textContent = 'Order ' + r.number + ' sent (' + money(r.total) + '). ' +
          (r.requests ? 'We will reply to your ' + r.requests + ' price request' + (r.requests === 1 ? '' : 's') + ' shortly. ' : '') +
          'We will confirm stock and collection on WhatsApp. ';
        var a = document.createElement('a'); a.href = r.viewUrl; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Open the order / PDF';
        $('done').appendChild(t); $('done').appendChild(a);
        $('done').hidden = false;
        scrollTo(0, 0);
        return load();
      })
      .catch(function (e) { error(e.message); })
      .then(function () { btn.disabled = false; });
  }

  function load() {
    return api().then(function (data) {
      $('loading').hidden = true;
      if (data.partner && data.partner.status === 'approved') { $('apply-view').hidden = true; showPortal(data); }
      else showApply(data);
    });
  }

  $('apply-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target, btn = f.querySelector('button');
    var body = { action: 'apply' };
    ['company', 'contact', 'phone', 'town', 'kind', 'hik_id', 'kra_pin'].forEach(function (k) { body[k] = f.elements[k].value; });
    btn.disabled = true; error('');
    api(body).then(function () { $('status-card').hidden = true; return load(); })
      .catch(function (err) { error(err.message); }).then(function () { btn.disabled = false; });
  });
  $('q').addEventListener('input', render);
  $('cat').addEventListener('change', render);
  $('only-sel').addEventListener('change', render);
  $('review').addEventListener('click', review);
  $('back').addEventListener('click', function () { $('checkout').hidden = true; });
  $('send').addEventListener('click', send);
  $('delivery').addEventListener('change', function () { $('town-wrap').hidden = $('delivery').value !== 'outside'; });

  load().catch(function (e) { $('loading').hidden = true; error(e.message); });
})();
