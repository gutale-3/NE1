// NE Partner Portal: trade partners apply, then use three sections:
// price list & order, permanent price requests, and their orders.
// Talks to /api/partner (worker/index.js + worker/partners.js).
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var data = null;        // last /api/partner response
  var products = [];
  var bySlug = {};
  var cart = {};          // slug -> { qty, requested }
  var asks = [];          // price requests being drafted: { slug, requested, volume }
  var orderFilter = '';
  var KEY = 'ne_partner_cart';
  var PAGE = 120;
  var STATUS = { new: 'Pending', confirmed: 'Confirmed', paid: 'Paid', delivered: 'Delivered', cancelled: 'Cancelled' };
  var STEPS = ['new', 'confirmed', 'paid', 'delivered'];
  var TABS = ['order', 'prices', 'orders', 'account'];
  var proof = null;       // { dataUrl, file } chosen in the payment form
  var lastPayment = null; // details of the payment just submitted

  function money(n) { return 'KES ' + Math.round(n).toLocaleString('en-KE'); }
  function day(sql) { return new Date(String(sql).replace(' ', 'T') + 'Z').toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }

  function api(body) {
    var init = { credentials: 'same-origin' };
    if (body) { init.method = 'POST'; init.headers = { 'content-type': 'application/json' }; init.body = JSON.stringify(body); }
    return fetch('/api/partner', init).then(function (r) {
      if (r.status === 401) { location.href = '/auth/google/login?next=/partner/'; throw new Error('Please sign in.'); }
      return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || 'Something went wrong.'); return d; });
    });
  }

  function error(text) { $('error').textContent = text || ''; $('error').hidden = !text; if (text) scrollTo(0, 0); }
  function done(nodes) {
    var box = $('done'); box.textContent = '';
    nodes.forEach(function (n) { box.appendChild(typeof n === 'string' ? document.createTextNode(n) : n); });
    box.hidden = !nodes.length;
    if (nodes.length) scrollTo(0, 0);
  }

  // ---- application -------------------------------------------------------------
  var APPLY_STATUS = {
    pending: ['Application received', 'Thank you. We review every application, usually with a quick call or WhatsApp. You will see your trade prices here as soon as your account is approved.'],
    rejected: ['Application not approved', 'We could not approve this application. WhatsApp us on 0737 454 891 if you think this is a mistake, or update your details below and apply again.'],
    suspended: ['Account paused', 'Your partner account is paused. Please WhatsApp us on 0737 454 891.'],
  };

  function showApply() {
    $('apply-view').hidden = false;
    var sel = $('kind');
    sel.length = 0;
    sel.add(new Option('Choose…', ''));
    data.kinds.forEach(function (k) { sel.add(new Option(k, k)); });
    var p = data.partner, form = $('apply-form');
    if (p) {
      var t = APPLY_STATUS[p.status] || APPLY_STATUS.pending;
      var card = $('status-card');
      card.textContent = '';
      card.appendChild(el('span', 'status ' + p.status, p.status.charAt(0).toUpperCase() + p.status.slice(1)));
      card.appendChild(el('h2', '', t[0]));
      card.appendChild(el('p', '', t[1]));
      card.hidden = false;
      ['company', 'contact', 'phone', 'town', 'kind', 'hik_id', 'kra_pin'].forEach(function (k) { if (p[k]) form.elements[k].value = p[k]; });
      form.parentNode.hidden = p.status === 'pending' || p.status === 'suspended';
    } else {
      form.elements.contact.value = data.user.name || '';
    }
  }

  // ---- tabs --------------------------------------------------------------------
  function tab() {
    var name = (location.hash || '#order').slice(1);
    if (TABS.indexOf(name) === -1) name = 'order';
    TABS.forEach(function (t) { $('tab-' + t).hidden = t !== name; });
    Array.prototype.forEach.call(document.querySelectorAll('.ptabs a'), function (a) { a.classList.toggle('on', a.getAttribute('data-tab') === name); });
    updateBar();
  }

  // ---- 1. price list and order ------------------------------------------------
  function save() { try { localStorage.setItem(KEY, JSON.stringify(cart)); } catch (e) { /* private mode */ } }

  function totals() {
    var t = { total: 0, lines: 0, units: 0, asks: 0 };
    products.forEach(function (p) {
      var c = cart[p.slug];
      if (!c || !c.qty) return;
      t.lines++; t.units += c.qty; t.total += c.qty * p.price;
      if (c.requested) t.asks++;
    });
    return t;
  }

  function updateBar() {
    var t = totals();
    $('bar').hidden = !t.lines || $('tab-order').hidden;
    $('bar-total').textContent = money(t.total);
    $('bar-sub').textContent = t.lines + ' product' + (t.lines === 1 ? '' : 's') + ', ' + t.units + ' unit' + (t.units === 1 ? '' : 's') +
      (t.asks ? ' · ' + t.asks + ' target price' + (t.asks === 1 ? '' : 's') : '');
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
    if (p.stock) {
      var back = p.stock.back ? ' · back ~' + new Date(p.stock.back + 'T00:00:00Z').toLocaleDateString('en-KE', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '';
      var badge = el('span', 'stock ' + p.stock.status, (p.stock.status === 'out' ? 'Out of stock' : 'Limited stock') + back + (p.stock.note ? ' · ' + p.stock.note : ''));
      tr.querySelector('.prod div').appendChild(badge);
    }
    tr.querySelector('.web').textContent = p.retail !== p.price ? money(p.retail) : '';
    var yours = tr.querySelector('.yours');
    yours.textContent = money(p.price);
    if (p.own) yours.appendChild(el('span', 'own', 'Your agreed price'));
    var qty = tr.querySelector('.qty'), ask = tr.querySelector('.ask'), line = tr.querySelector('.line');
    if (c.qty) qty.value = c.qty;
    // Out of stock: can't be ordered (an old cart line is dropped).
    if (p.stock && p.stock.status === 'out') {
      qty.disabled = true; ask.disabled = true; qty.placeholder = '—';
      if (cart[p.slug]) { delete cart[p.slug]; qty.value = ''; }
      tr.className = 'oos';
    }
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

  function matches(p, q) { return !q || (p.model + ' ' + p.name).toLowerCase().indexOf(q) !== -1; }

  function renderList() {
    var q = $('q').value.trim().toLowerCase(), cat = $('cat').value, only = $('only-sel').checked;
    var shown = products.filter(function (p) {
      if (only && !(cart[p.slug] && cart[p.slug].qty)) return false;
      return (!cat || p.category === cat) && matches(p, q);
    });
    var tbody = $('rows');
    tbody.textContent = '';
    shown.slice(0, PAGE).forEach(function (p) { tbody.appendChild(row(p)); });
    $('count').textContent = shown.length + ' of ' + products.length + ' products';
    $('more').hidden = shown.length <= PAGE;
    $('more').textContent = 'Showing the first ' + PAGE + '. Search to find the rest.';
  }

  function review() {
    var ul = $('lines');
    ul.textContent = '';
    products.forEach(function (p) {
      var c = cart[p.slug];
      if (!c || !c.qty) return;
      var li = el('li');
      var left = el('span', '', c.qty + ' × ' + p.name + ' (' + p.model + ')');
      if (c.requested) left.appendChild(el('small', '', ' · asking ' + money(c.requested) + ' each'));
      li.appendChild(left); li.appendChild(el('span', '', money(c.qty * p.price)));
      ul.appendChild(li);
    });
    var t = totals();
    var last = el('li');
    last.appendChild(el('b', '', 'Total at your prices')); last.appendChild(el('b', '', money(t.total)));
    ul.appendChild(last);
    $('send').textContent = t.asks ? 'Send order with target prices' : 'Send order';
    var acct = data.account || {}, sel = $('payment');
    sel.length = 1;
    if (acct.credit_limit) {
      var fits = t.total <= acct.available;
      var opt = new Option('On my account (credit): ' + money(acct.available) + ' available' + (fits ? '' : ', not enough for this order'), 'account');
      opt.disabled = !fits;
      sel.add(opt);
    }
    $('checkout').hidden = false;
    $('checkout').scrollIntoView({ behavior: 'smooth' });
  }

  function send() {
    var btn = $('send');
    btn.disabled = true; error('');
    var items = Object.keys(cart).map(function (s) { return { slug: s, qty: cart[s].qty, requested: cart[s].requested || 0 }; });
    api({ action: 'order', items: items, payment: $('payment').value, delivery: $('delivery').value, town: $('town').value, notes: $('notes').value })
      .then(function (r) {
        cart = {}; save();
        $('checkout').hidden = true;
        $('notes').value = '';
        location.hash = '#orders';
        var a = el('a', '', 'Open the order / PDF'); a.href = r.viewUrl; a.target = '_blank'; a.rel = 'noopener';
        done(['Order ' + r.number + ' sent (' + money(r.total) + '). ' +
          (r.requests ? 'We will reply to your ' + r.requests + ' target price' + (r.requests === 1 ? '' : 's') + ' shortly. ' : '') +
          'We will confirm stock and collection on WhatsApp. ', a]);
        return load();
      })
      .catch(function (e) { error(e.message); })
      .then(function () { btn.disabled = false; });
  }

  // ---- 2. permanent price requests -------------------------------------------
  function renderPicks() {
    var q = $('rq-q').value.trim().toLowerCase();
    var box = $('rq-results');
    box.textContent = '';
    if (q.length < 2) return;
    var taken = {};
    asks.forEach(function (a) { taken[a.slug] = true; });
    products.filter(function (p) { return matches(p, q); }).slice(0, 8).forEach(function (p) {
      var item = el('div', 'pick');
      var info = el('div', '', p.name);
      info.appendChild(el('small', '', p.model + ' · your price ' + money(p.price)));
      var b = el('button', 'btn ghost', taken[p.slug] ? 'Added' : 'Add');
      b.type = 'button'; b.disabled = !!taken[p.slug];
      b.addEventListener('click', function () {
        asks.push({ slug: p.slug, requested: '', volume: '' });
        $('rq-q').value = ''; box.textContent = '';
        renderAsks();
        var inputs = document.querySelectorAll('#rq-list .rq-price');
        if (inputs.length) inputs[inputs.length - 1].focus();
      });
      item.appendChild(info); item.appendChild(b);
      box.appendChild(item);
    });
    if (!box.children.length) box.appendChild(el('p', 'count', 'No products match.'));
  }

  function renderAsks() {
    var box = $('rq-list');
    box.textContent = '';
    if (asks.length) {
      var head = el('div', 'rq head');
      ['Product', 'Your price now', 'Price you need', 'Expected quantity', ''].forEach(function (h) { head.appendChild(el('span', '', h)); });
      box.appendChild(head);
    }
    asks.forEach(function (a, i) {
      var p = bySlug[a.slug];
      var r = el('div', 'rq');
      var info = el('div'); info.appendChild(el('b', '', p.name)); info.appendChild(el('small', '', p.model));
      var price = el('input', 'rq-price'); price.type = 'number'; price.min = 1; price.inputMode = 'numeric'; price.placeholder = 'KES'; price.value = a.requested;
      var vol = el('input'); vol.maxLength = 40; vol.placeholder = 'e.g. 20 a month'; vol.value = a.volume;
      var x = el('button', 'x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Remove');
      price.addEventListener('input', function () {
        a.requested = price.value;
        price.style.borderColor = Number(price.value) >= p.price ? '#D92D20' : '';
      });
      vol.addEventListener('input', function () { a.volume = vol.value; });
      x.addEventListener('click', function () { asks.splice(i, 1); renderAsks(); });
      r.appendChild(info); r.appendChild(el('span', 'now', money(p.price))); r.appendChild(price); r.appendChild(vol); r.appendChild(x);
      box.appendChild(r);
    });
    $('rq-actions').hidden = $('rq-note-wrap').hidden = !asks.length;
    $('rq-empty').hidden = !!asks.length;
  }

  function sendAsks() {
    var b = $('rq-send');
    b.disabled = true; error('');
    api({ action: 'request_prices', note: $('rq-note').value, items: asks.map(function (a) { return { slug: a.slug, requested: Number(a.requested) || 0, volume: a.volume }; }) })
      .then(function (r) {
        asks = []; $('rq-note').value = ''; renderAsks();
        done([r.count + ' price request' + (r.count === 1 ? '' : 's') + ' sent. We will review and reply, usually within a day. Agreed prices appear automatically in your price list.']);
        return load();
      })
      .catch(function (e) { error(e.message); })
      .then(function () { b.disabled = false; });
  }

  function renderHistory() {
    var box = $('rq-history');
    box.textContent = '';
    var reqs = data.requests || [];
    if (!reqs.length) { box.appendChild(el('p', 'sub', 'No price requests yet.')); return; }
    reqs.forEach(function (r) {
      var h = el('div', 'hist');
      var info = el('div', '', r.name);
      info.appendChild(el('small', '', r.model + ' · asked ' + money(r.requested) + (r.volume ? ' · ' + r.volume : '') + ' · ' + day(r.created_at)));
      var label = r.status === 'accepted' ? 'Agreed at ' + money(r.agreed) : r.status === 'declined' ? 'Not agreed' : 'Waiting';
      h.appendChild(info); h.appendChild(el('span', 'st ' + r.status, label));
      box.appendChild(h);
    });
  }

  // ---- 3. orders ----------------------------------------------------------------
  function monthChart() {
    var st = data.stats;
    if (!st || !window.NECharts) return;
    var labels = st.bought.map(function (m) { return m.label; });
    NECharts.columns($('ch-bought'), { labels: labels, money: true, series: [{ name: 'Bought', color: 'blue', values: st.bought.map(function (m) { return m.value; }) }],
      empty: 'Your monthly purchases will show here.' });
    NECharts.columns($('ch-account'), { labels: labels, money: true, empty: 'Nothing on your account yet.', series: [
      { name: 'Goods taken on credit', color: 'orange', values: st.taken.map(function (m) { return m.value; }) },
      { name: 'Payments', color: 'blue', values: st.paid.map(function (m) { return m.value; }) }] });
  }

  function renderOrders() {
    monthChart();
    var box = $('orders');
    box.textContent = '';
    var orders = (data.orders || []).filter(function (o) { return !orderFilter || o.status === orderFilter; });
    if (!orders.length) { box.appendChild(el('p', 'sub', orderFilter ? 'No ' + STATUS[orderFilter].toLowerCase() + ' orders.' : 'No orders yet. Your orders appear here with their status.')); return; }
    orders.forEach(function (o) {
      var card = el('article', 'ocard');
      var top = el('div', 'top2');
      var left = el('div');
      left.appendChild(el('h3', '', o.number));
      left.appendChild(el('div', 'meta', day(o.created_at) + ' · ' + o.items.length + ' product' + (o.items.length === 1 ? '' : 's') +
        ' · ' + (o.delivery === 'pickup' ? 'collect at NE' : o.delivery === 'nairobi' ? 'delivery in Nairobi' : 'send to ' + (o.town || 'outside Nairobi'))));
      var right = el('div');
      right.appendChild(el('span', 'st ' + o.status, STATUS[o.status] || o.status));
      right.appendChild(el('div', 'tot', money(o.total)));
      top.appendChild(left); top.appendChild(right);
      card.appendChild(top);

      if (o.status === 'cancelled') {
        card.appendChild(el('div', 'cancelled-note', 'This order was cancelled. WhatsApp us if you have questions.'));
      } else {
        var steps = el('div', 'steps');
        var at = STEPS.indexOf(o.status);
        STEPS.forEach(function (s, i) { steps.appendChild(el('div', i < at ? 'done' : i === at ? (s === 'delivered' ? 'done' : 'now') : '', STATUS[s])); });
        card.appendChild(steps);
      }

      var ul = el('ul', 'oitems');
      o.items.forEach(function (i) {
        var li = el('li');
        var name = el('span', '', i.qty + ' × ' + i.name + ' (' + i.model + ')');
        if (i.requested) {
          var res = i.request === 'accepted' ? ['ok', ' · target agreed at ' + money(i.agreed || i.price)]
            : i.request === 'declined' ? ['no', ' · target ' + money(i.requested) + ' not agreed'] : ['', ' · target ' + money(i.requested) + ' waiting'];
          name.appendChild(el('small', res[0], res[1]));
        }
        li.appendChild(name); li.appendChild(el('span', '', money(i.qty * i.price)));
        ul.appendChild(li);
      });
      card.appendChild(ul);

      var acts = el('div', 'oacts');
      var pdf = el('a', 'btn primary', 'Open / PDF');
      pdf.href = '/order/?n=' + encodeURIComponent(o.number) + '&k=' + encodeURIComponent(o.token); pdf.target = '_blank'; pdf.rel = 'noopener';
      var wa = el('a', 'btn go', 'WhatsApp us about this order');
      wa.href = 'https://wa.me/254737454891?text=' + encodeURIComponent('Hi NE, this is ' + data.partner.company + ' about order ' + o.number + '.');
      wa.target = '_blank'; wa.rel = 'noopener';
      var again = el('button', 'btn ghost', 'Order again'); again.type = 'button';
      again.addEventListener('click', function () {
        o.items.forEach(function (i) { if (bySlug[i.slug]) cart[i.slug] = { qty: i.qty, requested: 0 }; });
        save(); $('only-sel').checked = true; location.hash = '#order'; renderList(); updateBar();
        done(['Items from ' + o.number + ' added at your current prices. Check the quantities, then press Review order.']);
      });
      acts.appendChild(pdf); acts.appendChild(wa); acts.appendChild(again);
      card.appendChild(acts);
      box.appendChild(card);
    });
  }


  // ---- 4. account and payments ---------------------------------------------
  function renderAccount() {
    var a = data.account || { balance: 0, pending: 0, entries: [], methods: [] };
    var due = $('a-due').parentNode;
    $('a-due').textContent = money(Math.max(0, a.balance));
    due.classList.toggle('clear', a.balance <= 0);
    $('a-due-note').textContent = a.balance < 0 ? 'You have ' + money(-a.balance) + ' in credit with us.' : a.balance > 0 ? 'Owed to NE Falcon Apex Commerce Limited.' : 'Nothing owed. Thank you!';
    $('a-pending').textContent = money(a.pending);
    var bits = [];
    if (a.credit_limit != null) bits.push('Credit limit <b>' + money(a.credit_limit) + '</b>', 'Available <b>' + money(a.available) + '</b>');
    if (a.terms_days) bits.push('Payment terms <b>' + a.terms_days + ' days</b>');
    var line = $('a-credit');
    line.innerHTML = bits.map(function (b) { return '<span>' + b + '</span>'; }).join('');
    line.hidden = !bits.length;
    var od = $('a-overdue');
    od.hidden = !(a.overdue > 0);
    od.textContent = a.overdue > 0 ? money(a.overdue) + ' is past your ' + a.terms_days + '-day payment terms. Please pay it as soon as you can and report the payment below.' : '';
    var sel = $('pay-method');
    if (!sel.length) a.methods.forEach(function (m) { sel.add(new Option(m, m)); });
    var box = $('statement');
    box.textContent = '';
    if (!a.entries.length) { box.appendChild(el('p', 'sub', 'No account entries yet.')); return; }
    a.entries.forEach(function (e) {
      var row = el('div', 'entry' + (e.status === 'rejected' || e.status === 'void' ? ' muted' : ''));
      var info = el('div', '', e.kind === 'charge' ? (e.description || 'Goods on credit') : 'Payment' + (e.method ? ' by ' + e.method : ''));
      var bits = [day(e.paid_on ? e.paid_on + ' 00:00:00' : e.created_at)];
      if (e.kind === 'payment') bits.push('P-' + e.id);
      if (e.reference) bits.push('code ' + e.reference);
      if (e.ref && e.kind === 'charge') bits.push(e.ref);
      if (e.kind === 'payment' && e.description) bits.push(e.description);
      if (e.note) bits.push('NE: ' + e.note);
      info.appendChild(el('small', '', bits.join(' · ')));
      if (e.has_proof) {
        var link = el('a', '', 'View proof');
        link.href = '/api/partner/proof?id=' + e.id; link.target = '_blank'; link.rel = 'noopener';
        info.appendChild(link);
      }
      var right = el('div');
      right.appendChild(el('div', 'amt' + (e.kind === 'payment' ? ' pay' : ''), (e.kind === 'payment' ? '− ' : '+ ') + money(e.amount)));
      var stLabel = { pending: 'Awaiting confirmation', confirmed: e.kind === 'payment' ? 'Confirmed' : 'Owed', rejected: 'Not received', void: 'Cancelled' }[e.status];
      right.appendChild(el('span', 'st ' + (e.status === 'confirmed' ? 'accepted' : e.status === 'pending' ? '' : 'declined'), stLabel));
      row.appendChild(info); row.appendChild(right);
      row.appendChild(el('div', 'run', e.status === 'confirmed' ? 'Balance ' + money(e.running) : ''));
      box.appendChild(row);
    });
  }

  function shrink(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var scale = Math.min(1, 1600 / Math.max(img.width, img.height));
        var c = document.createElement('canvas');
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.78));
      };
      img.onerror = function () { reject(new Error('That file is not an image we can read. Try a JPG or PNG screenshot.')); };
      // A data: URL, not a blob: URL — the site's security policy only allows data: images.
      var reader = new FileReader();
      reader.onload = function () { img.src = reader.result; };
      reader.onerror = img.onerror;
      reader.readAsDataURL(file);
    });
  }

  function submitPayment(e) {
    e.preventDefault();
    var f = e.target, b = f.querySelector('button');
    var body = { action: 'payment', amount: Number(f.elements.amount.value), method: f.elements.method.value,
      reference: f.elements.reference.value, paid_on: f.elements.paid_on.value, note: f.elements.note.value, proof: proof ? proof.dataUrl : null };
    b.disabled = true; error('');
    api(body).then(function (r) {
      lastPayment = { number: r.number, amount: body.amount, method: body.method, reference: body.reference.toUpperCase(),
        paid_on: body.paid_on || new Date().toISOString().slice(0, 10), note: body.note, file: proof ? proof.file : null };
      f.reset(); proof = null; $('pay-preview').hidden = true; $('pay-date').value = new Date().toISOString().slice(0, 10);
      $('pay-card').hidden = true; $('pay-sent').hidden = false;
      $('sent-title').textContent = 'Payment ' + r.number + ' submitted';
      $('sent-text').textContent = money(lastPayment.amount) + ' by ' + lastPayment.method + ' is on your statement as "Awaiting confirmation". ' +
        'NE has been notified on WhatsApp automatically' + (lastPayment.file ? ', with your screenshot' : '') + ', so there is nothing else to send. We will confirm it once it reaches our account.';
      return load();
    }).catch(function (err) { error(err.message); }).then(function () { b.disabled = false; });
  }

  function badges() {
    var waiting = (data.requests || []).filter(function (r) { return r.status === 'pending'; }).length;
    $('b-prices').textContent = waiting; $('b-prices').hidden = !waiting;
    var open = (data.orders || []).filter(function (o) { return o.status === 'new' || o.status === 'confirmed'; }).length;
    $('b-orders').textContent = open; $('b-orders').hidden = !open;
    var owed = data.account ? data.account.balance : 0;
    $('b-account').textContent = owed > 0 ? money(owed) : ''; $('b-account').hidden = !(owed > 0);
  }

  function showPortal() {
    var p = data.partner;
    $('apply-view').hidden = true;
    $('portal-view').hidden = false;
    $('p-kind').textContent = p.kind;
    $('p-company').textContent = p.company;
    products = data.products;
    bySlug = {};
    products.forEach(function (x) { bySlug[x.slug] = x; });
    var own = products.filter(function (x) { return x.own; }).length;
    $('p-terms').textContent = (p.discount ? p.discount + '% off website prices' : 'Trade prices') +
      (own ? ', plus ' + own + ' agreed product price' + (own === 1 ? '' : 's') : '') + '. Prices in KES.';
    try { cart = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { cart = {}; }
    Object.keys(cart).forEach(function (s) { if (!bySlug[s]) delete cart[s]; });
    if ($('cat').length === 1) {
      Array.from(new Set(products.map(function (x) { return x.category; }))).sort().forEach(function (c) { $('cat').add(new Option(c, c)); });
    }
    renderList(); renderAsks(); renderHistory(); renderOrders(); renderAccount(); badges(); tab();
  }

  function load() {
    return api().then(function (d) {
      data = d;
      $('loading').hidden = true;
      if (d.partner && d.partner.status === 'approved') showPortal(); else showApply();
    });
  }

  $('apply-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target, btn = f.querySelector('button');
    var body = { action: 'apply' };
    ['company', 'contact', 'phone', 'town', 'kind', 'hik_id', 'kra_pin'].forEach(function (k) { body[k] = f.elements[k].value; });
    btn.disabled = true; error('');
    api(body).then(load).catch(function (err) { error(err.message); }).then(function () { btn.disabled = false; });
  });
  $('q').addEventListener('input', renderList);
  $('cat').addEventListener('change', renderList);
  $('only-sel').addEventListener('change', renderList);
  $('review').addEventListener('click', review);
  $('back').addEventListener('click', function () { $('checkout').hidden = true; });
  $('send').addEventListener('click', send);
  $('delivery').addEventListener('change', function () { $('town-wrap').hidden = $('delivery').value !== 'outside'; });
  $('rq-q').addEventListener('input', renderPicks);
  $('pay-date').value = new Date().toISOString().slice(0, 10);
  $('pay-form').addEventListener('submit', submitPayment);
  $('pay-file').addEventListener('change', function () {
    var file = this.files[0];
    proof = null; $('pay-preview').hidden = true;
    if (!file) return;
    shrink(file).then(function (dataUrl) {
      proof = { dataUrl: dataUrl, file: file };
      $('pay-preview').src = dataUrl; $('pay-preview').hidden = false;
    }).catch(function (err) { error(err.message); });
  });
  $('another-btn').addEventListener('click', function () { $('pay-sent').hidden = true; $('pay-card').hidden = false; });
  $('print-stmt').addEventListener('click', function () { window.print(); });
  $('rq-send').addEventListener('click', sendAsks);
  Array.prototype.forEach.call(document.querySelectorAll('#o-filter .chip'), function (chip) {
    chip.addEventListener('click', function () {
      orderFilter = chip.getAttribute('data-s');
      Array.prototype.forEach.call(document.querySelectorAll('#o-filter .chip'), function (c) { c.classList.toggle('on', c === chip); });
      renderOrders();
    });
  });
  window.addEventListener('hashchange', tab);
  Array.prototype.forEach.call(document.querySelectorAll('.ptabs a'), function (a) { a.addEventListener('click', function () { done([]); }); });

  load().catch(function (e) { $('loading').hidden = true; error(e.message); });
})();
