// NE Team: staff sign-up, delivery jobs, orders and money collected (talks to /api/team).
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var data = null;
  var catalogue = null;
  var cart = {};          // slug -> qty
  var tab = null;
  var focusJob = (/^\/team\/job\/(\d+)/.exec(location.pathname) || [])[1];

  function money(n) { return 'KES ' + Math.round(n || 0).toLocaleString('en-KE'); }
  function day(sql) {
    return new Date(String(sql).replace(' ', 'T') + 'Z').toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' });
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function digits(phone) { return String(phone || '').replace(/[^0-9]/g, '').replace(/^0/, '254'); }

  function api(body) {
    var init = { credentials: 'same-origin' };
    if (body) { init.method = 'POST'; init.headers = { 'content-type': 'application/json' }; init.body = JSON.stringify(body); }
    return fetch('/api/team', init).then(function (r) {
      return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || 'Something went wrong.'); return d; });
    });
  }

  function flash(text, ok) {
    var f = $('flash');
    f.textContent = text || '';
    f.className = 'msg' + (ok ? ' ok' : '');
    f.hidden = !text;
    if (text) window.scrollTo(0, 0);
  }

  // A screenshot, resized in the browser (a data: URL: the site's security policy blocks blob: images).
  function readImage(file) {
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
      var reader = new FileReader();
      reader.onload = function () { img.src = reader.result; };
      reader.onerror = img.onerror;
      reader.readAsDataURL(file);
    });
  }

  // Amount, method, code, screenshot and note: used for deliveries and for "Record a payment".
  function paymentFields(form, amount, extra) {
    form.innerHTML = '';
    (extra || []).forEach(function (f) { form.appendChild(f); });
    var methods = data.methods.map(function (m) { return '<option>' + m + '</option>'; }).join('');
    var wrap = el('div');
    wrap.style.cssText = 'display:grid;gap:13px';
    wrap.innerHTML =
      '<div class="two"><label>Amount collected (KES)<input name="amount" type="number" min="0" step="1" inputmode="numeric"></label>' +
      '<label>Paid by<select name="method">' + methods + '</select></label></div>' +
      '<label class="ref">Transaction code <small>M-Pesa or bank reference</small><input name="reference" maxlength="60" autocapitalize="characters"></label>' +
      '<label class="shot">Screenshot <small>optional: M-Pesa message or bank slip</small><input name="proof" type="file" accept="image/*"></label>' +
      '<label>Note <small>optional</small><input name="note" maxlength="300"></label>';
    form.appendChild(wrap);
    if (amount != null) form.elements.amount.value = amount;
    var select = wrap.querySelector('select');
    function sync() {
      var cash = select.value === 'Cash';
      wrap.querySelector('.ref').hidden = cash;
      wrap.querySelector('.shot').hidden = cash;
    }
    select.addEventListener('change', sync);
    sync();
  }

  function paymentBody(form) {
    var file = form.elements.proof && form.elements.proof.files[0];
    var cash = form.elements.method.value === 'Cash';
    var body = { amount: Number(form.elements.amount.value), method: form.elements.method.value,
      reference: cash ? '' : form.elements.reference.value, note: form.elements.note.value };
    if (!file || cash) return Promise.resolve(body);
    return readImage(file).then(function (url) { body.proof = url; return body; });
  }

  // ---- loading and tabs ---------------------------------------------------------
  var TABS = [
    ['home', 'Home', null], ['pool', 'Order pool', 'orders'], ['sales', 'My sales', null],
    ['jobs', 'My jobs', null], ['order', 'New order', 'orders'], ['collect', 'Record payment', null], ['mine', 'My payments', null],
    ['dispatch', 'Deliveries', 'dispatch'], ['confirm', 'Confirm', 'confirm'], ['team', 'Team', 'team'],
  ];

  function load() {
    return api().then(function (d) {
      data = d;
      $('loading').hidden = true;
      var s = d.staff;
      $('who').innerHTML = '';
      var name = el('div', null, d.owner ? (d.user.name || 'Owner') : s ? s.username : d.user.email);
      name.appendChild(el('small', null, d.owner ? 'Owner' : s && s.status === 'approved' ? d.roles[s.role] : ''));
      $('who').appendChild(name);
      var out = el('a', null, 'Sign out'); out.href = '/auth/logout?next=/team/';
      out.style.fontSize = '12px';
      $('who').appendChild(out);
      if (!d.can.length) return showGate(d);
      $('signup').hidden = $('waiting').hidden = true;
      buildTabs();
      render();
    });
  }

  function showGate(d) {
    $('tabs').hidden = true;
    var s = d.staff;
    if (d.owner) return;
    if (!s) { $('signup').hidden = false; $('waiting').hidden = true; return; }
    $('waiting').hidden = false;
    $('signup').hidden = true;
    $('wait-status').textContent = s.status;
    $('wait-status').className = 'status ' + s.status;
    $('wait-text').textContent = {
      pending: 'Thanks, ' + s.full_name.split(' ')[0] + '. The owner has been told and will approve you and set your role. Open this page again after that.',
      rejected: 'The owner did not approve this sign-up' + (s.note ? ': ' + s.note : '.') + ' Talk to them if you think this is a mistake.',
      suspended: 'Your team account is paused' + (s.note ? ': ' + s.note : '.') + ' Talk to the owner.',
    }[s.status] || '';
    $('edit-signup').hidden = s.status === 'suspended';
  }

  $('edit-signup').addEventListener('click', function () {
    var s = data.staff, f = $('signup-form');
    f.elements.username.value = s.username; f.elements.full_name.value = s.full_name; f.elements.phone.value = s.phone; f.elements.wanted.value = s.wanted || '';
    $('waiting').hidden = true; $('signup').hidden = false;
  });

  $('signup-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target, b = f.querySelector('button');
    b.disabled = true; flash('');
    api({ action: 'apply', username: f.elements.username.value, full_name: f.elements.full_name.value, phone: f.elements.phone.value, wanted: f.elements.wanted.value })
      .then(function () { return load(); })
      .catch(function (err) { flash(err.message); })
      .then(function () { b.disabled = false; });
  });

  function buildTabs() {
    var nav = $('tabs');
    nav.innerHTML = '';
    TABS.forEach(function (t) {
      if (t[2] && data.can.indexOf(t[2]) < 0) return;
      var b = el('button', null, t[1]);
      b.type = 'button';
      b.dataset.tab = t[0];
      if (t[0] === 'confirm' && data.toConfirm && data.toConfirm.length) b.appendChild(el('span', 'badge', data.toConfirm.length));
      if (t[0] === 'pool' && data.pool.length) b.appendChild(el('span', 'badge', data.pool.length));
      if (t[0] === 'sales') {
        var openSales = data.sales.filter(function (o) { return !o.finished_at; }).length;
        if (openSales) b.appendChild(el('span', 'badge', openSales));
      }
      if (t[0] === 'jobs') {
        var open = data.jobs.filter(function (j) { return j.status === 'assigned' || j.status === 'on_way'; }).length;
        if (open) b.appendChild(el('span', 'badge', open));
      }
      b.addEventListener('click', function () { location.hash = t[0]; });
      nav.appendChild(b);
    });
    nav.hidden = false;
  }

  function show() {
    var want = location.hash.slice(1);
    var allowed = Array.prototype.map.call($('tabs').querySelectorAll('button'), function (b) { return b.dataset.tab; });
    tab = allowed.indexOf(want) >= 0 ? want : focusJob ? 'jobs' : 'home';
    Array.prototype.forEach.call($('tabs').querySelectorAll('button'), function (b) {
      b.classList.toggle('on', b.dataset.tab === tab);
      if (b.dataset.tab === tab && b.scrollIntoView) b.scrollIntoView({ inline: 'center', block: 'nearest' });
    });
    TABS.forEach(function (t) { $('v-' + t[0]).hidden = t[0] !== tab; });
  }
  window.addEventListener('hashchange', function () { flash(''); show(); window.scrollTo(0, 0); });

  function render() {
    renderHome();
    renderPool();
    renderSales();
    renderJobs();
    renderMine();
    renderCollect();
    if (data.can.indexOf('orders') >= 0) setupOrder();
    if (data.can.indexOf('dispatch') >= 0) renderDispatch();
    if (data.can.indexOf('confirm') >= 0) renderConfirm();
    if (data.can.indexOf('team') >= 0) renderTeam();
    show();
    if (focusJob) {
      var card = document.querySelector('[data-job="' + focusJob + '"]');
      if (card) { card.classList.add('focus'); card.scrollIntoView({ block: 'center' }); }
      focusJob = null;
    }
  }

  // ---- home: my numbers ------------------------------------------------------------
  function renderHome() {
    var st = data.stats;
    $('home-hello').textContent = 'Hello, ' + (data.staff ? data.staff.full_name.split(' ')[0] : (data.user.name || 'Owner').split(' ')[0]);
    NECharts.tiles($('home-tiles'), [
      { label: 'My sales this month', value: money(st.salesMonth), sub: st.countMonth + ' finished order' + (st.countMonth === 1 ? '' : 's'), color: 'blue' },
      { label: 'Deliveries this month', value: String(st.jobsMonth), sub: 'delivered', color: 'orange' },
      { label: 'Money with me', value: money(data.holding), sub: 'not yet confirmed', color: 'aqua' },
      { label: 'Waiting in the pool', value: String(data.pool.length), sub: 'orders to accept', color: 'yellow' },
    ]);
    var weeks = st.salesWeeks.map(function (w) { return w.label; });
    NECharts.columns($('ch-sales'), { labels: weeks, money: true, series: [{ name: 'My sales', color: 'blue', values: st.salesWeeks.map(function (w) { return w.value; }) }],
      empty: 'No finished sales yet. Accept an order from the pool, then tap Finished when it is done.' });
    NECharts.columns($('ch-jobs'), { labels: st.jobWeeks.map(function (w) { return w.label; }), series: [{ name: 'Deliveries', color: 'orange', values: st.jobWeeks.map(function (w) { return w.value; }) }],
      empty: 'No deliveries yet.' });
    NECharts.hbars($('ch-methods'), { rows: st.methods, money: true, color: 'aqua', empty: 'No money recorded in the last 30 days.' });
    $('team-month-card').hidden = !st.teamMonth;
    if (st.teamMonth) NECharts.hbars($('ch-team'), { rows: st.teamMonth, money: true, color: 'blue', empty: 'No finished sales this month yet.' });
  }

  // ---- order pool ---------------------------------------------------------------------
  function orderHead(o, extra) {
    var head = el('div', 'head');
    var left = el('div');
    left.appendChild(el('div', 'st', extra));
    left.appendChild(el('h3', null, o.company && o.name.indexOf(o.company) < 0 ? o.company + ' (' + o.name + ')' : o.name));
    head.appendChild(left);
    var amt = el('div', 'amt', money(o.total));
    amt.insertBefore(el('small', null, o.items.reduce(function (n, i) { return n + i.qty; }, 0) + ' items'), amt.firstChild);
    head.appendChild(amt);
    return head;
  }

  function renderPool() {
    var box = $('pool');
    box.innerHTML = '';
    if (!data.pool.length) { box.appendChild(el('p', 'sub', 'No orders waiting. New ones also come to your WhatsApp.')); return; }
    data.pool.forEach(function (o) {
      var c = el('article', 'card job');
      c.appendChild(orderHead(o, o.number + ' · ' + o.status + ' · ' + day(o.created_at)));
      c.appendChild(el('div', 'where', (o.town || '') + (o.channel === 'partner' ? ' · trade partner' : o.customer === 'account' ? ' · has an account' : '')));
      var ul = el('ul', 'items');
      o.items.forEach(function (i) { ul.appendChild(el('li', null, i.qty + ' × ' + i.name + ' (' + i.model + ')')); });
      c.appendChild(ul);
      if (o.notes) c.appendChild(el('div', 'note', o.notes));
      var a = el('div', 'actions');
      var b = el('button', 'btn go', 'Accept: I will handle it'); b.type = 'button';
      b.addEventListener('click', function () { act({ action: 'accept', id: o.id }, b).then(function () { if (!$('flash').classList.contains('ok')) return; location.hash = 'sales'; }); });
      a.appendChild(b);
      c.appendChild(a);
      box.appendChild(c);
    });
  }

  // ---- my sales -----------------------------------------------------------------------
  var CLAIM = { pending: 'Your customer request is waiting for the owner', approved: 'Your customer: their orders come to you' };

  function renderSales() {
    var box = $('sales');
    box.innerHTML = '';
    if (!data.sales.length) box.appendChild(el('p', 'sub', 'No sales yet. Accept an order from the Order pool, or take a New order.'));
    data.sales.filter(function (o) { return !o.finished_at; }).forEach(function (o) { box.appendChild(saleCard(o)); });
    var finished = data.sales.filter(function (o) { return o.finished_at; });
    if (finished.length) {
      var card = el('div', 'card');
      card.appendChild(el('h2', null, 'Finished, last 30 days: ' + money(finished.reduce(function (n, o) { return n + o.total; }, 0))));
      finished.forEach(function (o) {
        var r = el('div', 'row');
        var left = el('div');
        left.appendChild(el('b', null, o.number + ' · ' + o.name));
        left.appendChild(el('small', null, 'Finished ' + day(o.finished_at) + ' · ' + o.status));
        r.appendChild(left);
        r.appendChild(el('div', 'r', money(o.total)));
        card.appendChild(r);
      });
      box.appendChild(card);
    }
    var docsBox = $('docs');
    docsBox.innerHTML = '';
    if (!data.documents.length) docsBox.appendChild(el('p', null, 'None yet. Make them from an order above.'));
    data.documents.forEach(function (d) {
      var r = el('div', 'row');
      var left = el('div');
      var link = el('a', null, d.number); link.href = '/team/doc/?id=' + d.id; link.target = '_blank';
      left.appendChild(link);
      left.appendChild(el('small', null, [d.customer.name, d.against, day(d.created_at), d.status === 'void' ? 'VOID' : ''].filter(Boolean).join(' · ')));
      r.appendChild(left);
      r.appendChild(el('div', 'r', money(d.kind === 'receipt' ? d.paid : d.total)));
      docsBox.appendChild(r);
    });
    var cust = $('customers');
    cust.innerHTML = '';
    if (!data.customers.length) cust.appendChild(el('p', null, 'No customers yet.'));
    data.customers.forEach(function (c) {
      var r = el('div', 'row');
      var left = el('div');
      left.appendChild(el('b', null, c.label));
      left.appendChild(el('small', null, [c.phone, c.from_order ? 'from ' + c.from_order : ''].filter(Boolean).join(' · ')));
      r.appendChild(left);
      r.appendChild(el('span', 'pill ' + (c.status === 'approved' ? 'confirmed' : ''), c.status === 'approved' ? 'Yours' : 'Waiting'));
      cust.appendChild(r);
    });
  }

  function saleCard(o) {
    var done = Boolean(o.finished_at);
    var c = el('article', 'card job sale' + (done ? ' done' : ''));
    c.appendChild(orderHead(o, (done ? 'Finished · ' : '') + o.number + ' · ' + o.status));
    if (!done) {
      var contact = el('div', 'contact');
      var call = el('a', 'btn primary', 'Call'); call.href = 'tel:' + o.phone;
      var wa = el('a', 'btn wa', 'WhatsApp'); wa.target = '_blank'; wa.rel = 'noopener';
      wa.href = 'https://wa.me/' + digits(o.phone) + '?text=' + encodeURIComponent('Hi ' + o.name.split(' ')[0] + ', this is ' + (data.staff ? data.staff.full_name.split(' ')[0] : 'NE') + ' from Nashnaal Electronics (NE) about your order ' + o.number + '.');
      var view = el('a', 'btn ghost', 'Order'); view.href = '/order/?n=' + encodeURIComponent(o.number) + '&k=' + encodeURIComponent(o.token); view.target = '_blank';
      contact.appendChild(call); contact.appendChild(wa); contact.appendChild(view);
      c.appendChild(contact);
      c.appendChild(el('div', 'hint', 'Phone: ' + o.phone + (o.paid ? ' · payments recorded: ' + money(o.paid) : '')));
    }
    var ul = el('ul', 'items');
    o.items.forEach(function (i) { ul.appendChild(el('li', null, i.qty + ' × ' + i.name + ' — ' + money(i.qty * i.price))); });
    c.appendChild(ul);
    if (o.notes) c.appendChild(el('div', 'note', o.notes));
    if (o.claim && o.claim !== 'rejected') c.appendChild(el('div', 'claim', o.claim_by && data.staff && o.claim_by !== data.staff.username ? 'Customer of ' + o.claim_by : CLAIM[o.claim]));
    if (done) { c.appendChild(el('div', 'hint', 'Finished ' + day(o.finished_at) + ': counted as your sale.')); return c; }

    var a = el('div', 'actions');
    var forms = el('div');
    function button(label, cls, fn) {
      var b = el('button', 'btn ' + cls + ' small', label); b.type = 'button';
      b.addEventListener('click', function () { fn(b); });
      a.appendChild(b);
      return b;
    }
    function toggle(form) {
      var open = forms.firstChild === form && !form.hidden;
      forms.innerHTML = '';
      if (!open) { forms.appendChild(form); form.hidden = false; }
    }
    button('Invoice', 'ghost', function () { toggle(docForm(o, 'invoice')); });
    button('Receipt', 'ghost', function () { toggle(docForm(o, 'receipt')); });
    if (!o.job && o.delivery !== 'pickup' && data.staff) button('I will deliver it', 'ghost', function () { toggle(selfJobForm(o)); });
    if (!o.claim || o.claim === 'rejected') button('Make my customer', 'ghost', function (b) { act({ action: 'claim', id: o.id }, b); });
    button('Finished', 'go', function (b) {
      if (confirm('Is ' + o.number + ' done (paid, delivered or collected)? It will count as your sale.')) act({ action: 'finish', id: o.id }, b);
    });
    button('Give back', 'danger', function (b) {
      if (confirm('Put ' + o.number + ' back in the order pool for someone else?')) act({ action: 'release', id: o.id }, b);
    });
    c.appendChild(a);
    c.appendChild(forms);
    return c;
  }

  function docForm(o, kind) {
    var f = el('form', 'docform');
    if (kind === 'invoice') {
      f.appendChild(el('p', 'hint', 'The order\'s products at website prices. Add installation or other services below if needed.'));
      var svc = el('div'); svc.style.cssText = 'display:grid;gap:8px';
      function addLine() {
        var row = el('div', 'svc');
        row.innerHTML = '<input placeholder="Service, e.g. Installation" maxlength="120"><input type="number" min="0" step="1" inputmode="numeric" placeholder="KES">';
        svc.appendChild(row);
      }
      addLine();
      f.appendChild(svc);
      var more = el('button', 'btn ghost small', '+ Another service'); more.type = 'button';
      more.addEventListener('click', addLine);
      f.appendChild(more);
      f.insertAdjacentHTML('beforeend', '<div class="two"><label>Customer KRA PIN <small>optional</small><input name="pin" maxlength="20" autocapitalize="characters"></label>' +
        '<label>Due date <small>optional</small><input name="due_date" type="date"></label></div>' +
        '<label>Address <small>optional</small><input name="address" maxlength="200"></label><label>Notes <small>optional</small><input name="notes" maxlength="300"></label>');
      var b = el('button', 'btn primary', 'Make invoice'); b.type = 'submit';
      f.appendChild(b);
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        var services = Array.prototype.map.call(svc.children, function (r) { var i = r.querySelectorAll('input'); return { name: i[0].value, price: Number(i[1].value) }; });
        makeDoc({ action: 'doc', kind: 'invoice', order_id: o.id, services: services, pin: f.elements.pin.value, due_date: f.elements.due_date.value,
          address: f.elements.address.value, notes: f.elements.notes.value }, b);
      });
      return f;
    }
    f.appendChild(el('p', 'hint', 'For money you received now. It is recorded as money with you until the office confirms it.'));
    var pay = el('div'); pay.style.cssText = 'display:grid;gap:12px';
    f.appendChild(pay);
    var inner = el('form'); // paymentFields builds into a form; move its children across
    paymentFields(inner, Math.max(0, o.total - o.paid));
    while (inner.firstChild) pay.appendChild(inner.firstChild);
    var rb = el('button', 'btn go', 'Make receipt'); rb.type = 'submit';
    f.appendChild(rb);
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      rb.disabled = true;
      paymentBody(f).then(function (body) {
        body.action = 'doc'; body.kind = 'receipt'; body.order_id = o.id;
        rb.disabled = false;
        makeDoc(body, rb);
      }).catch(function (err) { rb.disabled = false; flash(err.message); });
    });
    return f;
  }

  function makeDoc(body, b) {
    b.disabled = true; flash('');
    var win = window.open('', '_blank');
    api(body).then(function (r) {
      if (win) win.location = '/team/doc/?id=' + r.id; else location.href = '/team/doc/?id=' + r.id;
      return load().then(function () { flash(r.message, true); });
    }).catch(function (err) { if (win) win.close(); flash(err.message); b.disabled = false; });
  }

  function selfJobForm(o) {
    var f = el('form', 'docform');
    f.innerHTML = '<label>Delivery address<input name="address" maxlength="200" placeholder="Building, street, area"></label>' +
      '<label>Map link <small>optional</small><input name="map_url" inputmode="url"></label>' +
      '<label>Amount to collect<input name="collect" type="number" min="0" step="1" inputmode="numeric"></label>';
    f.elements.address.value = o.town || '';
    f.elements.collect.value = Math.max(0, o.total - o.paid);
    var b = el('button', 'btn primary', 'Add to My jobs'); b.type = 'submit';
    f.appendChild(b);
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      act({ action: 'self_job', order_id: o.id, address: f.elements.address.value, map_url: f.elements.map_url.value, collect: f.elements.collect.value }, b);
    });
    return f;
  }

  // ---- my jobs ---------------------------------------------------------------------
  var JOB_STATUS = { assigned: 'New job', on_way: 'On the way', delivered: 'Delivered', failed: 'Not delivered', cancelled: 'Cancelled' };

  function mapLink(j) {
    if (j.map_url) return j.map_url;
    var q = [j.address, j.town, 'Kenya'].filter(Boolean).join(', ');
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
  }

  function renderJobs() {
    $('hold-amt').textContent = money(data.holding);
    $('hold-card').hidden = !data.holding;
    var box = $('jobs');
    box.innerHTML = '';
    if (!data.jobs.length) { box.appendChild(el('p', 'sub', 'No deliveries for you right now. New jobs also come to your WhatsApp.')); return; }
    data.jobs.forEach(function (j) { box.appendChild(jobCard(j, true)); });
  }

  function jobCard(j, mine) {
    var c = el('article', 'card job ' + j.status);
    c.dataset.job = j.id;
    var head = el('div', 'head');
    var left = el('div');
    left.appendChild(el('div', 'st', JOB_STATUS[j.status] + ' · ' + j.number + (mine ? '' : ' · ' + j.staff)));
    left.appendChild(el('h3', null, j.customer));
    head.appendChild(left);
    var amt = el('div', 'amt', j.collect ? money(j.collect) : 'Paid');
    amt.insertBefore(el('small', null, j.collect ? 'Collect' : 'Nothing to collect'), amt.firstChild);
    head.appendChild(amt);
    c.appendChild(head);
    var where = el('div', 'where');
    where.textContent = (j.address || '') + (j.town && (j.address || '').indexOf(j.town) < 0 ? (j.address ? ', ' : '') + j.town : '');
    if (!where.textContent) where.textContent = j.delivery;
    c.appendChild(where);
    var open = j.status === 'assigned' || j.status === 'on_way';
    if (mine && open) {
      var contact = el('div', 'contact');
      var call = el('a', 'btn primary', 'Call'); call.href = 'tel:' + j.phone;
      var wa = el('a', 'btn wa', 'WhatsApp'); wa.target = '_blank'; wa.rel = 'noopener';
      wa.href = 'https://wa.me/' + digits(j.phone) + '?text=' + encodeURIComponent('Hi ' + j.customer.split(' ')[0] + ', this is ' + (data.staff ? data.staff.full_name.split(' ')[0] : 'NE') + ' from Nashnaal Electronics (NE). I am bringing your order ' + j.number + '.');
      var map = el('a', 'btn ghost', 'Map'); map.href = mapLink(j); map.target = '_blank'; map.rel = 'noopener';
      contact.appendChild(call); contact.appendChild(wa); contact.appendChild(map);
      c.appendChild(contact);
      c.appendChild(el('div', 'hint', 'Phone: ' + j.phone));
    }
    var ul = el('ul', 'items');
    j.items.forEach(function (i) { ul.appendChild(el('li', null, i.qty + ' × ' + i.name + ' (' + i.model + ')')); });
    c.appendChild(ul);
    if (j.notes) c.appendChild(el('div', 'note', 'Office: ' + j.notes));
    if (j.order_notes) c.appendChild(el('div', 'note', 'Order notes: ' + j.order_notes));
    if (j.reason && !open) c.appendChild(el('div', 'note', j.reason));
    if (!open) { c.appendChild(el('div', 'hint', (j.done_at ? JOB_STATUS[j.status] + ' ' + day(j.done_at) : 'Assigned ' + day(j.created_at)))); }
    if (mine && open) c.appendChild(jobActions(j));
    if (!mine && open && data.can.indexOf('dispatch') >= 0) {
      var a = el('div', 'actions');
      var cancel = el('button', 'btn danger small', 'Cancel job'); cancel.type = 'button';
      cancel.addEventListener('click', function () {
        if (!confirm('Cancel this delivery job for ' + j.number + '?')) return;
        act({ action: 'cancel_job', id: j.id }, cancel);
      });
      a.appendChild(cancel);
      c.appendChild(a);
    }
    return c;
  }

  function jobActions(j) {
    var wrap = el('div');
    var a = el('div', 'actions');
    if (j.status === 'assigned') {
      var go = el('button', 'btn ghost', 'On the way'); go.type = 'button';
      go.addEventListener('click', function () { act({ action: 'job_status', id: j.id, status: 'on_way' }, go); });
      a.appendChild(go);
    }
    var done = el('button', 'btn go', 'Delivered'); done.type = 'button';
    var fail = el('button', 'btn danger', 'Could not deliver'); fail.type = 'button';
    a.appendChild(done); a.appendChild(fail);
    wrap.appendChild(a);
    var form = el('form', 'done-form');
    form.hidden = true;
    paymentFields(form, j.collect || 0);
    var submit = el('button', 'btn go', 'Save: delivered'); submit.type = 'submit';
    form.appendChild(submit);
    form.appendChild(el('p', 'hint', j.collect ? 'If the customer paid less or nothing, enter what you got and say why in the note.' : 'Nothing to collect on this order. Leave the amount at 0.'));
    wrap.appendChild(form);
    done.addEventListener('click', function () { form.hidden = !form.hidden; });
    fail.addEventListener('click', function () {
      var reason = prompt('Why could it not be delivered? (customer not answering, wrong address…)');
      if (reason) act({ action: 'job_status', id: j.id, status: 'failed', reason: reason }, fail);
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      submit.disabled = true;
      paymentBody(form).then(function (body) {
        body.action = 'deliver'; body.id = j.id;
        return act(body, submit);
      }).catch(function (err) { submit.disabled = false; flash(err.message); });
    });
    return wrap;
  }

  function act(body, button) {
    if (button) button.disabled = true;
    flash('');
    return api(body).then(function (r) {
      return load().then(function () { flash(r.message || 'Saved.', true); });
    }).catch(function (err) { flash(err.message); if (button) button.disabled = false; });
  }

  // ---- record a payment --------------------------------------------------------------
  function renderCollect() {
    var form = $('collect-form');
    var who = el('div');
    who.style.cssText = 'display:grid;gap:13px';
    who.innerHTML = '<label>Who paid<input name="customer" maxlength="80" placeholder="Customer or company name"></label>' +
      '<div class="two"><label>Their phone <small>optional</small><input name="phone" inputmode="tel"></label>' +
      '<label>Order number <small>optional</small><input name="order_number" placeholder="NE-1005" autocapitalize="characters"></label></div>' +
      (data.partners.length ? '<label>Trade partner paying their account <small>optional</small><select name="partner_id"><option value="">Not a trade partner</option>' +
        data.partners.map(function (p) { return '<option value="' + p.user_id + '"></option>'; }).join('') + '</select></label>' : '');
    paymentFields(form, null, [who]);
    if (data.partners.length) {
      var opts = form.elements.partner_id.options;
      data.partners.forEach(function (p, i) { opts[i + 1].textContent = p.company; });
    }
    var b = el('button', 'btn primary', 'Save and tell the owner'); b.type = 'submit';
    form.appendChild(b);
  }

  $('collect-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target, b = f.querySelector('button[type=submit]');
    b.disabled = true;
    paymentBody(f).then(function (body) {
      body.action = 'record';
      body.customer = f.elements.customer.value;
      body.phone = f.elements.phone.value;
      body.order_number = f.elements.order_number.value;
      body.partner_id = f.elements.partner_id ? f.elements.partner_id.value : '';
      return api(body);
    }).then(function (r) {
      return load().then(function () { location.hash = 'mine'; flash(r.message, true); });
    }).catch(function (err) { flash(err.message); }).then(function () { b.disabled = false; });
  });

  // ---- my payments ---------------------------------------------------------------------
  var PAY_STATUS = { pending: 'With you · waiting', confirmed: 'Confirmed', rejected: 'Not confirmed' };

  function collectionRow(c, withStaff) {
    var r = el('div', 'row');
    var left = el('div');
    left.appendChild(el('b', null, c.customer));
    var pill = el('span', 'pill ' + c.status, withStaff && c.status === 'pending' ? 'Waiting' : PAY_STATUS[c.status]);
    pill.style.marginLeft = '6px';
    left.appendChild(pill);
    var facts = [c.method + (c.reference ? ' ' + c.reference : ''), c.order, c.partner ? 'partner account' : '', withStaff ? 'by ' + c.staff : '', day(c.created_at), 'C-' + c.id];
    left.appendChild(el('small', null, facts.filter(Boolean).join(' · ')));
    if (c.note) left.appendChild(el('small', null, '“' + c.note + '”'));
    if (c.decided_note) left.appendChild(el('small', null, 'Office: ' + c.decided_note));
    if (c.has_proof) {
      var a = el('a', null, 'Screenshot'); a.href = '/api/team/proof?id=' + c.id; a.target = '_blank'; a.style.fontSize = '13px';
      left.appendChild(a);
    }
    r.appendChild(left);
    r.appendChild(el('div', 'r', money(c.amount)));
    return r;
  }

  function renderMine() {
    $('hold-amt2').textContent = money(data.holding);
    var box = $('mine');
    box.innerHTML = '';
    if (!data.collections.length) box.appendChild(el('p', null, 'Nothing recorded yet.'));
    data.collections.forEach(function (c) { box.appendChild(collectionRow(c, false)); });
  }

  // ---- new order -----------------------------------------------------------------------
  var orderReady = false;
  function setupOrder() {
    if (orderReady) return;
    orderReady = true;
    fetch('/data/prices.json').then(function (r) { return r.json(); }).then(function (c) { catalogue = c; searchProducts(); });
    $('prod-q').addEventListener('input', searchProducts);
    var f = $('order-form');
    f.elements.delivery.addEventListener('change', function () { $('town-wrap').hidden = f.elements.delivery.value !== 'outside'; });
    f.elements.deliver_me.addEventListener('change', function () { $('me-fields').hidden = !f.elements.deliver_me.checked; });
    $('me-wrap').hidden = !data.staff;
    f.addEventListener('submit', submitOrder);
  }

  function searchProducts() {
    var box = $('prod-results');
    box.innerHTML = '';
    if (!catalogue) return;
    var q = $('prod-q').value.trim().toLowerCase().replace(/[\s-]+/g, '');
    if (q.length < 2) { box.appendChild(el('p', 'hint', 'Type at least 2 letters to find a product.')); return; }
    var hits = Object.keys(catalogue).filter(function (slug) {
      var p = catalogue[slug];
      return (p.m + p.n).toLowerCase().replace(/[\s-]+/g, '').indexOf(q) >= 0;
    }).slice(0, 25);
    if (!hits.length) box.appendChild(el('p', 'hint', 'No product matches.'));
    hits.forEach(function (slug) {
      var p = catalogue[slug];
      var row = el('div', 'prod');
      var img = el('img'); img.src = '/' + p.i; img.alt = ''; img.loading = 'lazy';
      var info = el('div');
      info.appendChild(el('b', null, p.m));
      info.appendChild(el('small', null, p.n + ' · ' + money(p.p)));
      var add = el('button', 'btn primary small', cart[slug] ? '+1' : 'Add'); add.type = 'button';
      add.addEventListener('click', function () { cart[slug] = (cart[slug] || 0) + 1; add.textContent = '+1'; renderCart(); });
      row.appendChild(img); row.appendChild(info); row.appendChild(add);
      box.appendChild(row);
    });
  }

  function renderCart() {
    var ul = $('cart');
    ul.innerHTML = '';
    var total = 0;
    Object.keys(cart).forEach(function (slug) {
      var p = catalogue[slug];
      total += p.p * cart[slug];
      var li = el('li', 'prod');
      var info = el('div');
      info.appendChild(el('b', null, p.m));
      info.appendChild(el('small', null, money(p.p) + ' each · ' + money(p.p * cart[slug])));
      var qty = el('input'); qty.type = 'number'; qty.min = '0'; qty.value = cart[slug]; qty.inputMode = 'numeric';
      qty.addEventListener('change', function () {
        var n = Math.floor(Number(qty.value));
        if (n > 0) cart[slug] = n; else delete cart[slug];
        renderCart();
      });
      li.appendChild(info); li.appendChild(qty);
      ul.appendChild(li);
    });
    $('cart-total').textContent = money(total);
  }

  function submitOrder(e) {
    e.preventDefault();
    var f = e.target, b = f.querySelector('button[type=submit]');
    var items = Object.keys(cart).map(function (slug) { return { slug: slug, qty: cart[slug] }; });
    if (!items.length) { flash('Add at least one product.'); return; }
    b.disabled = true; flash('');
    api({
      action: 'order', items: items,
      customer: { name: f.elements.name.value, phone: f.elements.phone.value, email: f.elements.email.value },
      delivery: f.elements.delivery.value, town: f.elements.town.value, notes: f.elements.notes.value, consent: f.elements.consent.checked,
      deliver_me: f.elements.deliver_me.checked, address: f.elements.address.value, map_url: f.elements.map_url.value,
    }).then(function (r) {
      var done = $('order-done');
      done.innerHTML = '';
      done.appendChild(el('h2', null, 'Order ' + r.number + ' saved'));
      done.appendChild(el('p', null, r.message + ' The owner has been told.'));
      var a = el('div', 'actions');
      var view = el('a', 'btn ghost', 'Open order / PDF'); view.href = r.viewUrl; view.target = '_blank';
      var wa = el('a', 'btn wa', 'Send to customer'); wa.target = '_blank'; wa.rel = 'noopener';
      wa.href = 'https://wa.me/' + digits(f.elements.phone.value) + '?text=' + encodeURIComponent('Hi ' + f.elements.name.value.split(' ')[0] + ', here is your Nashnaal Electronics order ' + r.number + ': ' + r.viewUrl);
      var mySales = el('a', 'btn go', 'Invoice / receipt in My sales'); mySales.href = '#sales';
      a.appendChild(mySales);
      var again = el('button', 'btn primary', 'New order'); again.type = 'button';
      again.addEventListener('click', function () { done.hidden = true; f.hidden = false; window.scrollTo(0, 0); });
      a.appendChild(view); a.appendChild(wa); a.appendChild(again);
      done.appendChild(a);
      done.hidden = false; f.hidden = true;
      cart = {}; f.reset(); renderCart(); searchProducts();
      $('me-fields').hidden = true; $('town-wrap').hidden = true;
      return load();
    }).catch(function (err) { flash(err.message); }).then(function () { b.disabled = false; });
  }

  // ---- dispatch (operations) ----------------------------------------------------------
  function staffOptions() {
    return data.team.map(function (s) { return { value: s.user_id, label: s.username + ' (' + s.full_name + ')' }; });
  }

  function renderDispatch() {
    var box = $('open-orders');
    box.innerHTML = '';
    var orders = data.orders.filter(function (o) { return !o.job; });
    if (!orders.length) box.appendChild(el('p', 'sub', 'Every open order has a delivery job.'));
    orders.forEach(function (o) {
      var c = el('article', 'card');
      var head = el('div', 'row');
      var left = el('div');
      left.appendChild(el('b', null, o.number + ' — ' + o.name));
      left.appendChild(el('small', null, [o.status, o.on_account ? 'on partner account' : '', o.items + ' items', o.delivery + (o.town ? ': ' + o.town : ''), o.phone, day(o.created_at)].filter(Boolean).join(' · ')));
      head.appendChild(left);
      head.appendChild(el('div', 'r', money(o.total)));
      c.appendChild(head);
      var open = el('button', 'btn primary small', 'Assign delivery'); open.type = 'button';
      c.appendChild(open);
      var form = assignForm(o);
      form.hidden = true;
      c.appendChild(form);
      open.addEventListener('click', function () { form.hidden = !form.hidden; });
      box.appendChild(c);
    });
    var all = $('all-jobs');
    all.innerHTML = '';
    if (!data.deliveries.length) all.appendChild(el('p', null, 'No delivery jobs in the last 3 days.'));
    data.deliveries.forEach(function (j) { all.appendChild(jobCard(j, false)); });
  }

  // Shared with the admin's Orders tab (same fields).
  function assignForm(o) {
    var form = el('form', 'assign');
    var sel = el('select'); sel.name = 'staff_id';
    sel.appendChild(new Option('Choose who delivers', ''));
    staffOptions().forEach(function (s) { sel.appendChild(new Option(s.label, s.value)); });
    var lab = el('label', null, 'Delivered by'); lab.appendChild(sel);
    form.appendChild(lab);
    form.insertAdjacentHTML('beforeend',
      '<label>Address<input name="address" maxlength="200" placeholder="Building, street, area"></label>' +
      '<label>Map link <small>optional: paste from Google Maps, or coordinates</small><input name="map_url" inputmode="url"></label>' +
      '<div class="two"><label>Amount to collect<input name="collect" type="number" min="0" step="1" inputmode="numeric"></label>' +
      '<label>Note for them <small>optional</small><input name="notes" maxlength="300"></label></div>');
    form.elements.address.value = o.town || '';
    form.elements.collect.value = o.status === 'paid' || o.on_account ? 0 : o.total;
    var b = el('button', 'btn go', 'Assign and send on WhatsApp'); b.type = 'submit';
    form.appendChild(b);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      act({ action: 'assign', order_id: o.id, staff_id: Number(sel.value), address: form.elements.address.value,
        map_url: form.elements.map_url.value, collect: form.elements.collect.value, notes: form.elements.notes.value }, b);
    });
    return form;
  }

  // ---- confirm payments (finance) ------------------------------------------------------
  function renderConfirm() {
    var box = $('to-confirm');
    box.innerHTML = '';
    if (!data.toConfirm.length) box.appendChild(el('p', null, 'Nothing waiting. Well done.'));
    data.toConfirm.forEach(function (c) {
      var row = collectionRow(c, true);
      var mine = c.staff_id === (data.staff && data.staff.user_id);
      var a = el('div', 'actions');
      if (mine && !data.owner) a.appendChild(el('span', 'hint', 'You collected this: someone else confirms it.'));
      else {
        var ok = el('button', 'btn go small', c.method === 'Cash' ? 'Cash handed in' : 'Confirm received'); ok.type = 'button';
        var no = el('button', 'btn danger small', 'Not received'); no.type = 'button';
        ok.addEventListener('click', function () { act({ action: 'decide', id: c.id, accept: true }, ok); });
        no.addEventListener('click', function () {
          var note = prompt('Why? The staff member sees this.', 'Not found in our account');
          if (note) act({ action: 'decide', id: c.id, accept: false, note: note }, no);
        });
        a.appendChild(ok); a.appendChild(no);
      }
      var wrap = el('div');
      wrap.appendChild(row); wrap.appendChild(a);
      wrap.style.borderBottom = '1px solid #E7ECF1'; wrap.style.paddingBottom = '10px';
      box.appendChild(wrap);
    });
    var cash = $('cash');
    cash.innerHTML = '';
    if (!data.cash.length) { cash.appendChild(el('p', null, 'No money recorded yet.')); return; }
    var t = el('table');
    t.innerHTML = '<thead><tr><th>Person</th><th class="n">Holding</th><th class="n">Cash</th><th class="n">This month</th></tr></thead>';
    var tb = el('tbody');
    data.cash.forEach(function (r) {
      var tr = el('tr');
      [r.username, money(r.holding), money(r.cash), money(r.month)].forEach(function (v, i) { tr.appendChild(el('td', i ? 'n' : null, v)); });
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    cash.appendChild(t);
  }

  // ---- team (HR / management) -----------------------------------------------------------
  function renderTeam() {
    var box = $('people');
    box.innerHTML = '';
    var t = el('table');
    t.innerHTML = '<thead><tr><th>Person</th><th>Role</th><th class="n">Delivered</th><th class="n">Orders</th><th class="n">With them</th><th class="n">Collected</th></tr></thead>';
    var tb = el('tbody');
    data.people.forEach(function (p) {
      var tr = el('tr');
      var who = el('td');
      who.appendChild(el('b', null, p.username));
      who.appendChild(el('div', 'hint', p.full_name + ' · ' + p.phone));
      tr.appendChild(who);
      tr.appendChild(el('td', null, p.status === 'approved' ? data.roles[p.role] || '' : p.status));
      [p.delivered, p.orders, money(p.holding), money(p.collected)].forEach(function (v) { tr.appendChild(el('td', 'n', v)); });
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    box.appendChild(t);
  }

  load().catch(function (err) { $('loading').hidden = true; flash(err.message); });
})();
