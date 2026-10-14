// NE admin: list, edit, add and delete catalogue products.
// Talks to /api/admin/* (worker/index.js), which commits to GitHub.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var products = [];
  var editing = null;      // product being edited, or null when adding
  var newImage = null;     // { base64, type } chosen in the form

  function api(path, body) {
    var init = { credentials: 'same-origin', headers: { 'x-ne-admin': '1' } };
    if (body) {
      init.method = 'POST';
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    return fetch(path, init).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok) throw new Error(data.error || 'Request failed');
        return data;
      });
    });
  }

  function notice(text, isError) {
    var el = $('notice');
    el.textContent = text;
    el.className = 'notice' + (isError ? ' error' : '');
    el.hidden = !text;
    if (text) window.scrollTo(0, 0);
  }

  function money(n) { return 'KES ' + Number(n).toLocaleString('en-KE'); }

  function img(src) { return src ? '/' + src.replace(/^\//, '') : '/assets/nashnaal-favicon.png'; }

  // ---- list ----------------------------------------------------------------
  function renderList() {
    var q = $('search').value.trim().toLowerCase();
    var cat = $('filter-cat').value;
    var shown = products.filter(function (p) {
      if (cat && p.category !== cat) return false;
      return !q || (p.model + ' ' + p.name).toLowerCase().indexOf(q) !== -1;
    });
    $('count').textContent = shown.length + ' of ' + products.length + ' products';
    var list = $('list');
    list.textContent = '';
    shown.slice(0, 200).forEach(function (p) {
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'row';
      row.innerHTML = '<img alt="" loading="lazy"><div><div class="name"></div><div class="meta"></div></div><div class="price"></div>';
      row.querySelector('img').src = img(p.image);
      row.querySelector('.name').textContent = p.name;
      row.querySelector('.meta').textContent = p.model.trim() + ' · ' + p.category;
      row.querySelector('.price').textContent = money(p.price);
      row.addEventListener('click', function () { openEditor(p); });
      list.appendChild(row);
    });
  }

  function load() {
    return api('/api/admin/products').then(function (data) {
      products = data.products;
      $('who').textContent = data.user.email;
      var cats = Array.from(new Set(products.map(function (p) { return p.category; }))).sort();
      [$('filter-cat'), $('f-category')].forEach(function (sel, i) {
        var keep = sel.value;
        sel.length = i === 0 ? 1 : 0;
        cats.forEach(function (c) { sel.add(new Option(c, c)); });
        sel.value = keep;
      });
      renderList();
    });
  }

  function loadLog() {
    api('/api/admin/log').then(function (data) {
      var ol = $('log');
      ol.textContent = '';
      data.log.forEach(function (entry) {
        var li = document.createElement('li');
        li.textContent = entry.created_at + ' UTC — ' + entry.detail;
        ol.appendChild(li);
      });
      if (!data.log.length) ol.innerHTML = '<li>No changes yet.</li>';
    }).catch(function () {});
  }

  // ---- editor --------------------------------------------------------------
  function show(view) {
    $('list-view').hidden = view !== 'list';
    $('edit-view').hidden = view !== 'edit';
    $('tech-view').hidden = view !== 'tech';
    $('orders-view').hidden = view !== 'orders';
    $('customers-view').hidden = view !== 'customers';
    $('wa-view').hidden = view !== 'wa';
    $('partners-view').hidden = view !== 'partners';
    $('partner-view').hidden = view !== 'partner';
    $('docs-view').hidden = view !== 'docs';
    $('doc-edit').hidden = view !== 'doc';
    $('team-view').hidden = view !== 'team';
    var PARENT = { edit: 'list', partner: 'partners', doc: 'docs' };
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
      tab.classList.toggle('on', tab.getAttribute('data-tab') === (PARENT[view] || view));
    });
    window.scrollTo(0, 0);
  }

  // ---- technicians ---------------------------------------------------------
  var LABELS = [['phone', 'Phone'], ['business', 'Business'], ['town', 'Town'], ['years', 'Years'],
    ['cert_number', 'Certificate'], ['work_link', 'Work'], ['email', 'Google'], ['created_at', 'Applied']];

  function loadTechs() {
    return api('/api/admin/technicians').then(function (data) {
      var pending = data.technicians.filter(function (t) { return t.status === 'pending'; }).length;
      $('tech-badge').textContent = pending;
      $('tech-badge').hidden = !pending;
      $('tech-count').textContent = data.technicians.length
        ? pending + ' waiting · ' + data.technicians.length + ' total · approved technicians get ' + data.discount + '% off'
        : 'No applications yet. Technicians apply from the "Sign in" link on the website.';
      var list = $('tech-list');
      list.textContent = '';
      data.technicians.forEach(function (t) { list.appendChild(techCard(t)); });
    });
  }

  function techCard(t) {
    var el = document.createElement('article');
    el.className = 'tech ' + t.status;
    el.innerHTML = '<div class="st"></div><h3></h3><dl></dl><div class="row-actions"></div>';
    el.querySelector('.st').className = 'st ' + t.status;
    el.querySelector('.st').textContent = t.status;
    el.querySelector('h3').textContent = t.full_name;
    var dl = el.querySelector('dl');
    LABELS.forEach(function (pair) {
      if (!t[pair[0]]) return;
      var dt = document.createElement('dt'); dt.textContent = pair[1];
      var dd = document.createElement('dd');
      if (pair[0] === 'work_link' && /^https?:\/\//.test(t.work_link)) {
        var a = document.createElement('a'); a.href = t.work_link; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = t.work_link;
        dd.appendChild(a);
      } else {
        dd.textContent = pair[0] === 'created_at' ? t[pair[0]] + ' UTC' : t[pair[0]];
      }
      dl.appendChild(dt); dl.appendChild(dd);
    });
    var actions = el.querySelector('.row-actions');
    var digits = String(t.phone).replace(/[^0-9]/g, '').replace(/^0/, '254');
    var wa = document.createElement('a');
    wa.className = 'wa'; wa.target = '_blank'; wa.rel = 'noopener';
    wa.href = 'https://wa.me/' + digits + '?text=' + encodeURIComponent('Hi ' + t.full_name.split(' ')[0] + ', this is NE (Nashnaal Electronics) about your technician account application.');
    wa.textContent = 'WhatsApp';
    actions.appendChild(wa);
    function button(label, cls, decision, confirmText) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = cls; b.textContent = label;
      b.addEventListener('click', function () {
        if (confirmText && !window.confirm(confirmText)) return;
        b.disabled = true;
        api('/api/admin/technicians', { user_id: t.user_id, decision: decision }).then(function () {
          notice(t.full_name + ': ' + (decision === 'approve' ? 'approved. They now see technician prices.' : decision === 'reject' ? 'not approved.' : 'technician prices turned off.'));
          loadTechs(); loadLog();
        }).catch(function (err) { b.disabled = false; notice(err.message, true); });
      });
      actions.appendChild(b);
    }
    if (t.status !== 'approved') button('Approve', 'ok', 'approve');
    if (t.status === 'pending') button('Reject', 'danger', 'reject', 'Reject ' + t.full_name + '?');
    if (t.status === 'approved') button('Remove technician prices', 'danger', 'remove', 'Turn off technician prices for ' + t.full_name + '?');
    return el;
  }

  // ---- orders --------------------------------------------------------------
  var orderFilter = '';
  var ORDER_NEXT = {
    new: [['confirmed', 'Confirm', 'primary'], ['paid', 'Mark paid', 'ok'], ['cancelled', 'Cancel', 'danger']],
    confirmed: [['paid', 'Mark paid', 'ok'], ['cancelled', 'Cancel', 'danger']],
    paid: [['delivered', 'Mark delivered', 'ok']],
    delivered: [],
    cancelled: [],
  };

  function loadOrders() {
    return api('/api/admin/orders' + (orderFilter ? '?status=' + orderFilter : '')).then(function (data) {
      var waiting = data.counts.new || 0;
      $('orders-badge').textContent = waiting;
      $('orders-badge').hidden = !waiting;
      $('removed-badge').textContent = data.counts.deleted || 0;
      $('removed-badge').hidden = !data.counts.deleted;
      var total = Object.keys(data.counts).reduce(function (n, k) { return k === 'deleted' ? n : n + data.counts[k]; }, 0);
      $('orders-count').textContent = total ? data.orders.length + ' shown · ' + waiting + ' new · ' + total + ' total' : 'No orders yet. They appear here when customers check out from the cart.';
      var list = $('orders-list');
      list.textContent = '';
      data.orders.forEach(function (o) { list.appendChild(orderCard(o)); });
    });
  }

  // An order a team member removed: who, when, why, and Restore.
  function removedCard(o) {
    var el = document.createElement('article');
    el.className = 'tech ord cancelled';
    el.innerHTML = '<div class="head"><div><div class="st cancelled"></div><h3></h3></div><div class="tot"></div></div><dl></dl><div class="row-actions"></div>';
    el.querySelector('.st').textContent = 'removed by ' + o.removed.by;
    el.querySelector('h3').textContent = o.number + ' — ' + o.name;
    el.querySelector('.tot').textContent = money(o.total);
    var dl = el.querySelector('dl');
    [['Why', o.removed.reason], ['Removed', o.removed.at + ' UTC'], ['Was', o.removed.was], ['Phone', o.phone],
      ['Items', o.items.map(function (i) { return i.qty + ' × ' + i.model; }).join(', ')], ['Placed', o.created_at + ' UTC']].forEach(function (f) {
      if (!f[1]) return;
      var dt = document.createElement('dt'); dt.textContent = f[0];
      var dd = document.createElement('dd'); dd.textContent = f[1];
      dl.appendChild(dt); dl.appendChild(dd);
    });
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'ok'; b.textContent = 'Restore';
    b.addEventListener('click', function () {
      b.disabled = true;
      api('/api/admin/team', { action: 'restore', order_id: o.id }).then(function (r) { notice(r.message); loadOrders(); })
        .catch(function (err) { b.disabled = false; notice(err.message, true); });
    });
    el.querySelector('.row-actions').appendChild(b);
    return el;
  }

  function orderCard(o) {
    if (o.removed) return removedCard(o);
    var el = document.createElement('article');
    el.className = 'tech ord ' + o.status;
    el.innerHTML = '<div class="head"><div><div class="st"></div><h3></h3></div><div class="tot"></div></div><dl></dl><ul></ul><div class="row-actions"></div>';
    el.querySelector('.st').className = 'st ' + o.status;
    el.querySelector('.st').textContent = o.status + ' · ' + (o.channel === 'partner' ? 'trade partner order' : o.channel === 'whatsapp' ? 'sent via WhatsApp' : 'sent on website');
    el.querySelector('h3').textContent = o.number + ' — ' + o.name;
    el.querySelector('.tot').textContent = money(o.total);
    var delivery = o.delivery === 'outside' ? 'Outside Nairobi: ' + o.town + ' (' + o.transport + ', customer pays)' : o.deliveryLabel;
    var facts = [['Phone', o.phone], ['Email', o.email], ['Delivery', delivery], ['Account', o.account_email ? o.account_email + ' (earns ' + o.earn_rate + '%)' : 'Guest – no rewards'],
      ['Discounts', [o.tech_discount ? 'technician −' + money(o.tech_discount) : '', o.reward_used ? 'reward −' + money(o.reward_used) : ''].filter(Boolean).join(', ')],
      ['Reward earned', o.reward_earned ? money(o.reward_earned) : ''], ['Notes', o.notes], ['Placed', o.created_at + ' UTC'],
      ['Handled by', o.handler ? o.handler + (o.finished_at ? ' — finished, counts as their sale' : ' — working on it') : (o.status === 'cancelled' ? '' : 'Nobody yet (in the team order pool)')]];
    var dl = el.querySelector('dl');
    facts.forEach(function (f) {
      if (!f[1]) return;
      var dt = document.createElement('dt'); dt.textContent = f[0];
      var dd = document.createElement('dd'); dd.textContent = f[1];
      dl.appendChild(dt); dl.appendChild(dd);
    });
    var ul = el.querySelector('ul');
    o.items.forEach(function (i) {
      var li = document.createElement('li');
      li.textContent = i.qty + ' × ' + i.name + ' (' + i.model + ') — ' + money(i.qty * i.price) +
        (i.requested ? '  · partner asked ' + money(i.requested) + ' each (' + (i.request === 'accepted' ? 'agreed at ' + money(i.agreed || i.price) : i.request || 'waiting — see Partners tab') + ')' : '');
      ul.appendChild(li);
    });
    var actions = el.querySelector('.row-actions');
    var digits = String(o.phone).replace(/[^0-9]/g, '').replace(/^0/, '254');
    var wa = document.createElement('a');
    wa.className = 'wa'; wa.target = '_blank'; wa.rel = 'noopener';
    wa.href = 'https://wa.me/' + digits + '?text=' + encodeURIComponent('Hi ' + o.name.split(' ')[0] + ', this is NE (Nashnaal Electronics) about your order ' + o.number + ' (' + money(o.total) + ').');
    wa.textContent = 'WhatsApp';
    actions.appendChild(wa);
    var view = document.createElement('a');
    view.className = 'chip'; view.target = '_blank'; view.rel = 'noopener';
    view.href = '/order/?n=' + encodeURIComponent(o.number) + '&k=' + encodeURIComponent(o.token);
    view.textContent = 'Open / PDF';
    actions.appendChild(view);
    if (o.channel === 'partner' && o.status !== 'cancelled') {
      var credit = document.createElement('button');
      credit.type = 'button'; credit.className = 'chip'; credit.textContent = 'Put on account (credit)';
      credit.addEventListener('click', function () {
        if (!window.confirm('Add ' + money(o.total) + ' for ' + o.number + ' to this partner\'s amount due?')) return;
        credit.disabled = true;
        api('/api/admin/partners', { action: 'charge_order', order_id: o.id }).then(function (r) { notice(r.message); loadPartners(); })
          .catch(function (err) { credit.disabled = false; notice(err.message, true); });
      });
      actions.appendChild(credit);
    }
    [['invoice', 'Invoice'], ['receipt', 'Receipt']].forEach(function (k) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'chip'; b.textContent = k[1];
      b.addEventListener('click', function () { openDoc(k[0], { order: o }); });
      actions.appendChild(b);
    });
    if (o.status !== 'cancelled') {
      var give = document.createElement('button');
      give.type = 'button'; give.className = 'chip'; give.textContent = o.handler ? 'Change handler' : 'Give to…';
      give.addEventListener('click', function () {
        var open = el.querySelector('.handler-form');
        if (open) { open.remove(); return; }
        teamReady().then(function (t) {
          var f = document.createElement('form');
          f.className = 'assign-form handler-form';
          f.innerHTML = '<label>Who handles this sale <select name="who"></select></label><button class="primary" type="submit">Save</button>';
          f.elements.who.appendChild(new Option('Nobody: back to the team order pool', '0'));
          t.people.filter(function (p) { return p.status === 'approved'; }).forEach(function (p) {
            f.elements.who.appendChild(new Option(p.username + ' (' + t.roles[p.role] + ')', p.user_id));
          });
          f.elements.who.value = String(o.handler_id || 0);
          f.addEventListener('submit', function (e) {
            e.preventDefault();
            api('/api/admin/team', { action: 'handler', order_id: o.id, staff_id: Number(f.elements.who.value) })
              .then(function (r) { notice(r.message); loadOrders(); }).catch(function (err) { notice(err.message, true); });
          });
          el.appendChild(f);
        }).catch(function (err) { notice(err.message, true); });
      });
      actions.appendChild(give);
    }
    if (['new', 'confirmed', 'paid'].indexOf(o.status) >= 0) {
      var assign = document.createElement('button');
      assign.type = 'button'; assign.className = 'chip'; assign.textContent = 'Assign delivery';
      assign.addEventListener('click', function () {
        var open = el.querySelector('.assign-form');
        if (open) { open.remove(); return; }
        teamReady().then(function (t) { el.appendChild(assignForm(o, t)); }).catch(function (err) { notice(err.message, true); });
      });
      actions.appendChild(assign);
    }
    (ORDER_NEXT[o.status] || []).forEach(function (step) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = step[2]; b.textContent = step[1];
      b.addEventListener('click', function () {
        if (step[0] === 'cancelled' && !window.confirm('Cancel order ' + o.number + '? Any reward credit used on it goes back to the customer.')) return;
        b.disabled = true;
        api('/api/admin/orders', { id: o.id, status: step[0] }).then(function (res) {
          notice(res.message);
          loadOrders(); loadLog();
        }).catch(function (err) { b.disabled = false; notice(err.message, true); });
      });
      actions.appendChild(b);
    });
    return el;
  }

  Array.prototype.forEach.call(document.querySelectorAll('#order-filter .chip'), function (chip) {
    chip.addEventListener('click', function () {
      orderFilter = chip.getAttribute('data-status');
      Array.prototype.forEach.call(document.querySelectorAll('#order-filter .chip'), function (c) { c.classList.toggle('on', c === chip); });
      loadOrders().catch(function (err) { notice(err.message, true); });
    });
  });

  // ---- customers ------------------------------------------------------------
  var customers = [];

  function day(sql) { return sql ? new Date(sql.replace(' ', 'T') + 'Z').toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'; }

  function rangeQuery() {
    var q = [];
    if ($('cust-from').value) q.push('from=' + $('cust-from').value);
    if ($('cust-to').value) q.push('to=' + $('cust-to').value);
    return q.join('&');
  }

  function loadCustomers() {
    var q = rangeQuery();
    $('pdf-sales').href = '/admin/report/?type=sales' + (q ? '&' + q : '');
    return api('/api/admin/customers' + (q ? '?' + q : '')).then(function (data) {
      customers = data.customers;
      var t = data.totals;
      var label = data.from || data.to ? 'Bought ' + (data.from ? 'from ' + day(data.from + ' 00:00:00') : '') + (data.to ? ' to ' + day(data.to + ' 00:00:00') : '') : 'Bought (paid orders)';
      $('cust-tiles').innerHTML = '';
      [[money(t.credit), 'Rebate we owe (2% / 1%) · ' + t.with_credit + ' people', 'owe'], [money(t.bought), label, ''],
       [money(t.pending), 'Waiting for payment', ''], [String(t.customers), 'Customers', '']].forEach(function (x) {
        var d = document.createElement('div');
        d.className = 'tile ' + x[2];
        d.innerHTML = '<b></b><span></span>';
        d.querySelector('b').textContent = x[0];
        d.querySelector('span').textContent = x[1];
        $('cust-tiles').appendChild(d);
      });
      renderCustomers();
    });
  }

  function renderCustomers() {
    var q = $('cust-search').value.trim().toLowerCase();
    var f = $('cust-filter').value;
    var shown = customers.filter(function (c) {
      if (f === 'credit' && !(c.credit > 0)) return false;
      if (f && f !== 'credit' && c.type !== f) return false;
      return !q || (c.name + ' ' + c.phone + ' ' + c.email).toLowerCase().indexOf(q) !== -1;
    });
    $('cust-count').textContent = shown.length + ' of ' + customers.length + ' customers · sorted by most bought';
    var list = $('cust-list');
    list.textContent = '';
    shown.forEach(function (c) { list.appendChild(customerCard(c)); });
    if (!customers.length) $('cust-count').textContent = 'No customers yet. People appear here when they sign in or place an order.';
  }

  function customerCard(c) {
    var el = document.createElement('article');
    el.className = 'tech cust';
    el.innerHTML = '<h3></h3><div class="meta"></div><div class="nums"></div><div class="meta extra"></div><div class="row-actions"></div>';
    var h3 = el.querySelector('h3');
    h3.textContent = c.name;
    var tag = document.createElement('span');
    tag.className = 'tag ' + c.type;
    tag.textContent = c.type;
    h3.appendChild(tag);
    el.querySelector('.meta').textContent = [c.phone, c.email].filter(Boolean).join(' · ') || 'No contact details yet';
    var nums = el.querySelector('.nums');
    [[money(c.bought), 'Bought (' + c.paid_orders + ' paid)', ''], [money(c.pending), 'Not paid yet', ''],
     [c.type === 'guest' ? '—' : money(c.credit), 'Rebate owed', c.credit > 0 ? 'owe' : '']].forEach(function (n) {
      var d = document.createElement('div');
      d.className = n[2];
      d.innerHTML = '<b></b><span></span>';
      d.querySelector('b').textContent = n[0];
      d.querySelector('span').textContent = n[1];
      nums.appendChild(d);
    });
    var extra = [];
    if (c.credit_next) extra.push(money(c.credit_next.amount) + ' expires ' + day(c.credit_next.expires));
    if (c.credit_expired) extra.push(money(c.credit_expired) + ' rebate expired unused');
    extra.push(c.orders + ' order' + (c.orders === 1 ? '' : 's') + ' · last ' + day(c.last_order));
    el.querySelector('.extra').textContent = extra.join(' · ');
    var actions = el.querySelector('.row-actions');
    if (c.phone) {
      var digits = String(c.phone).replace(/[^0-9]/g, '').replace(/^0/, '254');
      var msg = 'Hi ' + c.name.split(' ')[0] + ', this is NE (Nashnaal Electronics).' + (c.credit > 0 ? ' You have ' + money(c.credit) + ' rebate (your NE reward) to use on your next order at nashnaal.com.' : '');
      var wa = document.createElement('a');
      wa.className = 'wa'; wa.target = '_blank'; wa.rel = 'noopener';
      wa.href = 'https://wa.me/' + digits + '?text=' + encodeURIComponent(msg);
      wa.textContent = 'WhatsApp';
      actions.appendChild(wa);
    }
    var pdf = document.createElement('a');
    pdf.className = 'chip'; pdf.target = '_blank'; pdf.rel = 'noopener';
    pdf.href = '/admin/report/?type=statement&' + (c.user_id ? 'user=' + c.user_id : 'phone=' + encodeURIComponent(c.phone));
    pdf.textContent = 'Statement PDF';
    actions.appendChild(pdf);
    return el;
  }

  // ---- funnel: accounts -> orders -> paid -> revenue -----------------------
  var funnelData = null, funnelPeriod = '30';
  function pct(a, b) { return b ? Math.round(a * 100 / b) + '%' : '—'; }
  function renderFunnel() {
    if (!funnelData) return;
    var f = funnelData.periods[funnelPeriod];
    var steps = [
      [String(f.accounts), 'New accounts', ''],
      [String(f.orders), 'Orders sent', f.member_orders + ' from signed-in customers (' + pct(f.member_orders, f.orders) + ')'],
      [String(f.paid), 'Paid orders', pct(f.paid, f.orders) + ' of orders paid' + (f.cancelled ? ' · ' + f.cancelled + ' cancelled' : '')],
      [money(f.revenue), 'Paid sales', f.paid ? 'Average ' + money(Math.round(f.revenue / f.paid)) : ''],
    ];
    var box = $('funnel');
    box.textContent = '';
    steps.forEach(function (st) {
      var d = document.createElement('div');
      d.className = 'fstep';
      d.innerHTML = '<b></b><span></span><em></em>';
      d.querySelector('b').textContent = st[0];
      d.querySelector('span').textContent = st[1];
      d.querySelector('em').textContent = st[2];
      box.appendChild(d);
    });
    var idle = funnelData.idle;
    $('idle-box').hidden = !idle.length;
    $('idle-title').textContent = idle.length + (idle.length === 20 ? '+' : '') + ' signed up but never ordered (most recent first)';
    $('idle-list').textContent = '';
    idle.forEach(function (u) {
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = 'mailto:' + u.email;
      a.textContent = u.email;
      li.appendChild(document.createTextNode((u.name || 'No name') + ' · '));
      li.appendChild(a);
      li.appendChild(document.createTextNode(' · joined ' + day(u.created_at)));
      $('idle-list').appendChild(li);
    });
  }
  function loadFunnel() {
    return api('/api/admin/funnel').then(function (data) { funnelData = data; renderFunnel(); });
  }
  Array.prototype.forEach.call(document.querySelectorAll('#funnel-period .chip'), function (chip) {
    chip.addEventListener('click', function () {
      funnelPeriod = chip.getAttribute('data-p');
      Array.prototype.forEach.call(document.querySelectorAll('#funnel-period .chip'), function (c) { c.classList.toggle('on', c === chip); });
      renderFunnel();
    });
  });

  // ---- WhatsApp updates number -------------------------------------------
  function dl(box, pairs) {
    box.textContent = '';
    pairs.forEach(function (p) {
      var dt = document.createElement('dt'); dt.textContent = p[0];
      var dd = document.createElement('dd');
      if (p[2]) { var c = document.createElement('span'); c.className = 'copy'; c.textContent = p[1]; dd.appendChild(c); } else dd.textContent = p[1];
      box.appendChild(dt); box.appendChild(dd);
    });
  }
  function loadWhatsApp() {
    return api('/api/admin/whatsapp').then(function (d) {
      var n = d.number || {};
      dl($('wa-status'), [
        ['Number', n.display_phone_number || '+254 141 444 982'],
        ['Display name', (n.verified_name || 'Nashnaal Electronics') + (n.name_status ? ' (' + n.name_status.toLowerCase().replace(/_/g, ' ') + ')' : '')],
        ['Quality', n.quality_rating || '—'],
        ['Access key', d.hasToken ? 'Saved in Cloudflare' : 'Missing: add WHATSAPP_TOKEN secret'],
        ['App secret', d.hasAppSecret ? 'Saved in Cloudflare' : 'Missing: add META_APP_SECRET secret'],
        ['Owner alerts to', d.owner ? '+' + d.owner : '—'],
      ].concat(d.numberError ? [['Error', d.numberError]] : []));
      dl($('wa-hook'), [['Callback URL', d.webhookUrl, true], ['Verify token', d.verifyToken || 'Add META_APP_SECRET first', Boolean(d.verifyToken)]]);
      var tl = $('wa-templates'); tl.textContent = '';
      if (d.templatesError) tl.textContent = d.templatesError;
      (d.templates || []).forEach(function (t) {
        var el = document.createElement('div'); el.className = 'tpl';
        el.innerHTML = '<div><b></b><p></p></div><span class="s"></span>';
        el.querySelector('b').textContent = t.name;
        el.querySelector('p').textContent = t.body + (t.reason && t.reason !== 'NONE' ? ' — Rejected: ' + t.reason : '');
        el.querySelector('.s').className = 's ' + t.status; el.querySelector('.s').textContent = t.status;
        tl.appendChild(el);
      });
      if (!d.configured) tl.textContent = 'Templates appear here once the access key is saved in Cloudflare.';
      var log = $('wa-log'); log.textContent = '';
      var inbound = 0;
      d.messages.forEach(function (m) {
        if (m.direction === 'in' && m.created_at > (localStorage.getItem('ne_wa_seen') || '')) inbound++;
        var el = document.createElement('div'); el.className = 'wa-msg ' + m.direction;
        el.innerHTML = '<span class="dir"></span><div><div class="txt"></div><small></small></div><span class="st"></span>';
        el.querySelector('.dir').textContent = m.direction === 'in' ? 'From' : 'To';
        el.querySelector('.txt').textContent = m.body || '';
        var who = '+' + m.phone + ' · ' + (m.direction === 'in' ? m.kind : m.kind.replace(/^ne_/, '').replace(/_/g, ' ')) + ' · ' + day(m.created_at);
        el.querySelector('small').textContent = who + (m.error ? ' · ' + m.error : '');
        if (m.direction === 'in') {
          var a = document.createElement('a'); a.href = 'https://wa.me/' + m.phone; a.target = '_blank'; a.rel = 'noopener'; a.textContent = ' Reply from my WhatsApp';
          el.querySelector('small').appendChild(a);
        }
        el.querySelector('.st').className = 'st ' + m.status; el.querySelector('.st').textContent = m.status;
        log.appendChild(el);
      });
      if (!d.messages.length) log.textContent = 'No messages yet.';
      try { if (d.messages[0]) localStorage.setItem('ne_wa_seen', d.messages[0].created_at); } catch (e) { /* ignore */ }
    });
  }
  // ---- WhatsApp conversations ------------------------------------------
  var openPhone = null, chatTimer = null;
  function when(sql) {
    var d = new Date(String(sql).replace(' ', 'T') + 'Z');
    return d.toDateString() === new Date().toDateString()
      ? d.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short' });
  }
  function loadChats() {
    return api('/api/admin/whatsapp/chats').then(function (d) {
      $('wa-badge').textContent = d.waiting;
      $('wa-badge').hidden = !d.waiting;
      var list = $('chat-list'); list.textContent = '';
      if (!d.chats.length) list.innerHTML = '<p class="hint" style="padding:14px">No conversations yet.</p>';
      d.chats.forEach(function (c) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'chat-item' + (c.waiting ? ' waiting' : '') + (c.phone === openPhone ? ' on' : '');
        b.innerHTML = '<div class="ci-top"><b></b><time></time></div><p></p>';
        b.querySelector('b').textContent = c.name && c.name !== 'message' ? c.name : '+' + c.phone;
        b.querySelector('time').textContent = when(c.last_at);
        b.querySelector('p').textContent = (c.last_dir === 'out' ? 'You: ' : '') + (c.last_body || '');
        b.addEventListener('click', function () { openChat(c.phone); });
        list.appendChild(b);
      });
    });
  }
  function openChat(phone) {
    openPhone = phone;
    $('chat-app').classList.add('open');
    return api('/api/admin/whatsapp/chat?phone=' + phone).then(function (d) {
      if (openPhone !== phone) return;
      $('chat-empty').hidden = true;
      $('chat-head').hidden = false; $('chat-msgs').hidden = false;
      $('chat-name').textContent = d.name && d.name !== 'message' ? d.name : '+' + phone;
      $('chat-phone').textContent = ' +' + phone;
      $('chat-wa').href = 'https://wa.me/' + phone;
      $('chat-form').hidden = !d.open; $('chat-closed').hidden = d.open;
      var box = $('chat-msgs');
      var atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
      box.textContent = '';
      d.messages.forEach(function (m) {
        var el = document.createElement('div');
        var auto = m.direction === 'out' && m.kind !== 'reply';
        el.className = 'bubble ' + m.direction + (auto ? ' auto' : '');
        el.textContent = m.body || '';
        var meta = document.createElement('small');
        var label = auto ? (m.kind === 'auto_reply' ? 'Auto-reply' : 'Update: ' + m.kind.replace(/^ne_/, '').replace(/_/g, ' ')) + ' · ' : '';
        var tick = m.direction === 'out' ? (m.status === 'read' ? ' ✓✓ read' : m.status === 'delivered' ? ' ✓✓' : m.status === 'failed' ? ' failed' : ' ✓') : '';
        meta.textContent = label + when(m.created_at) + tick;
        if (m.status === 'failed') { meta.className = 'failed'; meta.title = m.error || ''; }
        el.appendChild(meta);
        box.appendChild(el);
      });
      if (atBottom || !box.dataset.phone || box.dataset.phone !== phone) box.scrollTop = box.scrollHeight;
      box.dataset.phone = phone;
      loadChats();
    });
  }
  $('chat-back').addEventListener('click', function () { openPhone = null; $('chat-app').classList.remove('open'); loadChats(); });
  $('chat-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var text = $('chat-text').value.trim();
    if (!text || !openPhone) return;
    $('chat-send').disabled = true;
    api('/api/admin/whatsapp', { action: 'reply', phone: openPhone, text: text }).then(function () {
      $('chat-text').value = '';
      return openChat(openPhone);
    }).catch(function (err) { notice(err.message, true); }).then(function () { $('chat-send').disabled = false; });
  });
  $('chat-text').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(min-width: 761px)').matches) { e.preventDefault(); $('chat-form').requestSubmit(); }
  });
  function startChatPolling() {
    clearInterval(chatTimer);
    chatTimer = setInterval(function () {
      if ($('wa-view').hidden || document.hidden) return;
      (openPhone ? openChat(openPhone) : loadChats()).catch(function () {});
    }, 15000);
  }

  Array.prototype.forEach.call(document.querySelectorAll('[data-wa]'), function (b) {
    b.addEventListener('click', function () {
      b.disabled = true;
      api('/api/admin/whatsapp', { action: b.getAttribute('data-wa') }).then(function (r) {
        notice(r.message); return loadWhatsApp();
      }).catch(function (err) { notice(err.message, true); }).then(function () { b.disabled = false; });
    });
  });

  function askReview(phone, name, btn) {
    btn.disabled = true;
    return api('/api/admin/whatsapp', { action: 'review', phone: phone, name: name }).then(function (r) {
      notice(r.message); return true;
    }).catch(function (err) { notice(err.message, true); }).then(function (ok) { btn.disabled = false; return ok; });
  }
  $('review-form').addEventListener('submit', function (e) {
    e.preventDefault();
    askReview($('rv-phone').value, $('rv-name').value, this.querySelector('button')).then(function (ok) {
      if (ok) $('review-form').reset();
    });
  });
  $('rv-mine').addEventListener('click', function () {
    var d = $('rv-phone').value.replace(/\D/g, '');
    if (d.charAt(0) === '0') d = '254' + d.slice(1);
    else if (d.length === 9) d = '254' + d;
    if (!/^254[17]\d{8}$/.test(d)) { notice("Enter the customer's WhatsApp number first.", true); return; }
    var n = $('rv-name').value.trim().split(/\s+/)[0];
    n = n ? n.charAt(0).toUpperCase() + n.slice(1).toLowerCase() : 'there';
    var text = 'Hi ' + n + ', thank you for choosing Nashnaal Electronics. If you have a minute, we would really appreciate a short Google review. ' +
      'A line about the product or our service helps other customers find us. Thank you!\n\nhttps://nashnaal.com/review';
    window.open('https://wa.me/' + d + '?text=' + encodeURIComponent(text), '_blank', 'noopener');
  });
  $('chat-review').addEventListener('click', function () {
    var name = $('chat-name').textContent;
    if (openPhone) askReview(openPhone, name.charAt(0) === '+' ? '' : name, this).then(function (ok) { if (ok) openChat(openPhone); });
  });

  $('tpl-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = this.querySelector('button'); btn.disabled = true;
    api('/api/admin/whatsapp', { action: 'create', template: { name: $('tpl-name').value, category: $('tpl-cat').value, body: $('tpl-body').value } }).then(function (r) {
      notice(r.message); $('tpl-form').reset(); return loadWhatsApp();
    }).catch(function (err) { notice(err.message, true); }).then(function () { btn.disabled = false; });
  });

  $('cust-search').addEventListener('input', renderCustomers);
  $('cust-filter').addEventListener('change', renderCustomers);
  ['cust-from', 'cust-to'].forEach(function (id) {
    $(id).addEventListener('change', function () { loadCustomers().catch(function (err) { notice(err.message, true); }); });
  });
  $('cust-range-clear').addEventListener('click', function () {
    $('cust-from').value = ''; $('cust-to').value = '';
    loadCustomers().catch(function (err) { notice(err.message, true); });
  });


  // ---- trade partners ---------------------------------------------------------
  var partnerKinds = [];
  var current = null;          // { partner, products } open in the partner view
  var priceEdits = {};         // slug -> new price ('' = remove)

  function loadPartners() {
    return api('/api/admin/partners').then(function (data) {
      partnerKinds = data.kinds;
      var pending = data.partners.filter(function (p) { return p.status === 'pending'; }).length;
      var waiting = pending + data.requests.length + data.payments.length;
      var pays = $('payments');
      pays.textContent = '';
      data.payments.forEach(function (x) { pays.appendChild(paymentRow(x)); });
      $('payments-box').hidden = !data.payments.length;
      $('partners-badge').textContent = waiting;
      $('partners-badge').hidden = !waiting;
      $('partners-count').textContent = data.partners.length
        ? data.partners.length + ' partners · ' + pending + ' waiting for approval'
        : 'No partners yet. Share nashnaal.com/partners with the companies you supply.';
      var list = $('partners-list');
      list.textContent = '';
      data.partners.forEach(function (p) { list.appendChild(partnerCard(p)); });
      var req = $('requests');
      req.textContent = '';
      data.requests.forEach(function (r) { req.appendChild(requestRow(r)); });
      $('requests-box').hidden = !data.requests.length;
    });
  }

  function partnerCard(p) {
    var el = document.createElement('article');
    el.className = 'tech ' + p.status;
    el.innerHTML = '<div class="st"></div><h3></h3><dl></dl><div class="row-actions"></div>';
    el.querySelector('.st').className = 'st ' + p.status;
    el.querySelector('.st').textContent = p.status + ' · ' + p.kind;
    el.querySelector('h3').textContent = p.company;
    if (p.credit_limit != null && p.balance > p.credit_limit) {
      var flag = document.createElement('span'); flag.className = 'flag'; flag.textContent = 'Over credit limit';
      el.querySelector('h3').appendChild(flag);
    }
    var facts = [['Contact', p.contact], ['Phone', p.phone], ['Town', p.town], ['Google', p.email], ['Hikvision ID', p.hik_id], ['KRA PIN', p.kra_pin],
      ['Pricing', (p.discount ? p.discount + '% off website' : 'Website prices') + (p.prices ? ' + ' + p.prices + ' agreed prices' : '')],
      ['Amount due', (p.balance > 0 ? money(p.balance) : p.balance < 0 ? 'In credit ' + money(-p.balance) : '') +
        (p.credit_limit != null ? ' (limit ' + money(p.credit_limit) + ')' : '') + (p.terms_days ? ' · ' + p.terms_days + '-day terms' : '') +
        (p.remind_days ? ' · reminders every ' + p.remind_days + ' day' + (p.remind_days === 1 ? '' : 's') : '')],
      ['Bought', p.bought ? money(p.bought) : ''], ['Note', p.note], ['Applied', day(p.created_at)]];
    var dl = el.querySelector('dl');
    facts.forEach(function (f) {
      if (!f[1]) return;
      var dt = document.createElement('dt'); dt.textContent = f[0];
      var dd = document.createElement('dd'); dd.textContent = f[1];
      dl.appendChild(dt); dl.appendChild(dd);
    });
    var actions = el.querySelector('.row-actions');
    function btn(label, cls, fn) {
      var b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = label;
      b.addEventListener('click', function () { b.disabled = true; fn(b); });
      actions.appendChild(b);
    }
    if (p.status === 'pending') {
      btn('Approve', 'ok', function (b) { setPartner(p.user_id, { status: 'approved' }, b); });
      btn('Reject', 'danger', function (b) { setPartner(p.user_id, { status: 'rejected' }, b); });
    }
    btn('Prices & settings', 'chip', function (b) { b.disabled = false; openPartner(p.user_id); });
    var digits = String(p.phone).replace(/[^0-9]/g, '').replace(/^0/, '254');
    var wa = document.createElement('a');
    wa.className = 'wa'; wa.target = '_blank'; wa.rel = 'noopener'; wa.textContent = 'WhatsApp';
    wa.href = 'https://wa.me/' + digits + '?text=' + encodeURIComponent('Hi ' + p.contact.split(' ')[0] + ', this is NE (Nashnaal Electronics) about your trade partner account.');
    actions.appendChild(wa);
    return el;
  }

  function setPartner(id, fields, b) {
    return api('/api/admin/partners', Object.assign({ action: 'update', id: id }, fields)).then(function (r) {
      notice(r.message); return loadPartners();
    }).catch(function (err) { notice(err.message, true); }).then(function () { if (b) b.disabled = false; });
  }

  function requestRow(r) {
    var el = document.createElement('div');
    el.className = 'req';
    el.innerHTML = '<div><b></b><small></small></div><div class="row-actions"><label class="agree">KES <input type="number" min="1" step="1" inputmode="numeric"></label></div>';
    el.querySelector('b').textContent = r.company + ' asks ' + money(r.requested) + ' for ' + r.model;
    var facts = r.type === 'order'
      ? [r.qty + ' × on order ' + r.number]
      : ['Permanent price request' + (r.volume ? ' · expects ' + r.volume : '')];
    facts.push('their price now ' + money(r.price), 'website ' + money(r.retail));
    if (r.retail) facts.push(Math.round((1 - r.requested / r.retail) * 100) + '% off website');
    if (r.note) facts.push('“' + r.note + '”');
    el.querySelector('small').textContent = r.name + ' · ' + facts.join(' · ');
    var input = el.querySelector('input');
    input.value = r.requested;
    input.title = 'Agreed price. Change it to make a counter-offer.';
    [['Agree', 'ok', true], ['Decline', 'danger', false]].forEach(function (a) {
      var b = document.createElement('button'); b.type = 'button'; b.className = a[1]; b.textContent = a[0];
      b.addEventListener('click', function () {
        b.disabled = true;
        var body = { action: 'decide', accept: a[2], price: Number(input.value) || r.requested };
        if (r.type === 'order') { body.order_id = r.order_id; body.slug = r.slug; } else body.request_id = r.id;
        api('/api/admin/partners', body).then(function (res) {
          notice(res.message); loadPartners(); loadOrders();
        }).catch(function (err) { b.disabled = false; notice(err.message, true); });
      });
      el.querySelector('.row-actions').appendChild(b);
    });
    return el;
  }


  function accountApi(body, b) {
    if (b) b.disabled = true;
    return api('/api/admin/partners', body).then(function (r) {
      notice(r.message); loadPartners();
      if (current && !$('partner-view').hidden) return openPartner(current.partner.id, true);
    }).catch(function (err) { notice(err.message, true); }).then(function () { if (b) b.disabled = false; });
  }

  function proofLink(id) {
    var a = document.createElement('a');
    a.className = 'proof chip'; a.href = '/api/partner/proof?id=' + id; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'View screenshot';
    return a;
  }

  function paymentRow(x) {
    var el = document.createElement('div');
    el.className = 'req';
    el.innerHTML = '<div><b></b><small></small></div><div class="row-actions"></div>';
    el.querySelector('b').textContent = x.company + ' paid ' + money(x.amount) + ' by ' + x.method;
    el.querySelector('small').textContent = ['P-' + x.id, x.reference ? 'code ' + x.reference : 'no code', 'paid ' + day(x.paid_on + ' 00:00:00'), x.description, 'reported ' + day(x.created_at)].filter(Boolean).join(' · ');
    var acts = el.querySelector('.row-actions');
    if (x.has_proof) acts.appendChild(proofLink(x.id));
    [['Confirm', 'ok', true], ['Not received', 'danger', false]].forEach(function (a) {
      var b = document.createElement('button'); b.type = 'button'; b.className = a[1]; b.textContent = a[0];
      b.addEventListener('click', function () {
        var note = '';
        if (!a[2]) { note = window.prompt('Why? The partner sees this note (e.g. "Not found in M-Pesa statement").', 'Not found in our account'); if (note === null) return; }
        accountApi({ action: 'decide_payment', entry_id: x.id, accept: a[2], note: note }, b);
      });
      acts.appendChild(b);
    });
    return el;
  }

  function renderAccount(a) {
    var due = $('ac-due');
    due.textContent = a.balance < 0 ? 'In credit ' + money(-a.balance) : money(a.balance);
    due.parentNode.classList.toggle('clear', a.balance <= 0);
    $('ac-pending').textContent = a.pending ? money(a.pending) + ' reported, waiting for you to confirm' : '';
    var c = $('ac-credit');
    c.textContent = [a.credit_limit != null ? 'Limit ' + money(a.credit_limit) + (a.over_limit ? ' — OVER LIMIT' : ', ' + money(a.available) + ' available') : 'No credit limit set',
      a.terms_days ? a.terms_days + '-day terms' : '', a.overdue ? money(a.overdue) + ' OVERDUE' : ''].filter(Boolean).join(' · ');
    c.className = a.over_limit || a.overdue ? 'warn' : '';
    $('ac-remind-btn').hidden = !((a.terms_days ? a.overdue : a.balance) > 0);
    var box = $('ac-statement');
    box.textContent = '';
    if (!a.entries.length) { box.innerHTML = '<p class="hint">No entries yet. Add an amount owed when this partner takes goods on credit.</p>'; return; }
    a.entries.forEach(function (e) {
      var row = document.createElement('div');
      row.className = 'ent' + (e.status === 'rejected' || e.status === 'void' ? ' muted' : '');
      row.innerHTML = '<div><b></b><small></small></div><div class="amt"></div><div class="row-actions"></div>';
      row.querySelector('b').textContent = e.kind === 'charge' ? (e.description || 'Goods on credit') : 'Payment by ' + (e.method || '—') + ' (P-' + e.id + ')';
      row.querySelector('small').textContent = [day(e.paid_on ? e.paid_on + ' 00:00:00' : e.created_at), e.reference ? 'code ' + e.reference : '', e.kind === 'payment' && e.description ? e.description : '',
        e.by_partner ? 'reported by partner' : '', { pending: 'WAITING FOR YOU', rejected: 'not received', void: 'voided' }[e.status] || '', e.note ? 'note: ' + e.note : '',
        e.status === 'confirmed' ? 'balance ' + money(e.running) : ''].filter(Boolean).join(' · ');
      var amt = row.querySelector('.amt');
      amt.textContent = (e.kind === 'payment' ? '− ' : '+ ') + money(e.amount);
      if (e.kind === 'payment') amt.className = 'amt pay';
      var acts = row.querySelector('.row-actions');
      if (e.has_proof) acts.appendChild(proofLink(e.id));
      if (e.status === 'pending') {
        var ok = document.createElement('button'); ok.type = 'button'; ok.className = 'ok'; ok.textContent = 'Confirm';
        ok.addEventListener('click', function () { accountApi({ action: 'decide_payment', entry_id: e.id, accept: true }, ok); });
        acts.appendChild(ok);
      }
      if (e.status === 'confirmed') {
        var v = document.createElement('button'); v.type = 'button'; v.className = 'danger'; v.textContent = 'Void';
        v.addEventListener('click', function () {
          var note = window.prompt('Void this entry? It stays on the statement, crossed out. Reason (the partner sees it):', 'Entered by mistake');
          if (note === null) return;
          accountApi({ action: 'void_entry', entry_id: e.id, note: note }, v);
        });
        acts.appendChild(v);
      }
      box.appendChild(row);
    });
  }

  $('pt-remind-on').addEventListener('change', function () { $('pt-remind-days').disabled = !this.checked; });
  ['ac-statement-btn', 'ac-remind-btn'].forEach(function (id) {
    $(id).addEventListener('click', function () {
      var reminder = id === 'ac-remind-btn';
      if (!window.confirm((reminder ? 'Send a payment reminder' : 'Send an account statement') + ' to ' + current.partner.company + ' on WhatsApp now?')) return;
      accountApi({ action: reminder ? 'send_reminder' : 'send_statement', id: current.partner.id }, this);
    });
  });
  $('ac-charge').addEventListener('submit', function (e) {
    e.preventDefault();
    accountApi({ action: 'charge', id: current.partner.id, amount: Number($('ac-c-amount').value), ref: $('ac-c-ref').value, description: $('ac-c-desc').value }, this.querySelector('button'))
      .then(function () { $('ac-charge').reset(); });
  });
  $('ac-pay').addEventListener('submit', function (e) {
    e.preventDefault();
    accountApi({ action: 'payment', id: current.partner.id, amount: Number($('ac-p-amount').value), method: $('ac-p-method').value, reference: $('ac-p-ref').value, paid_on: $('ac-p-date').value }, this.querySelector('button'))
      .then(function () { $('ac-pay').reset(); });
  });

  function openPartner(id, keepScroll) {
    notice('');
    return api('/api/admin/partners?id=' + id).then(function (data) {
      current = data; if (!keepScroll) priceEdits = {};
      var p = data.partner;
      $('pt-title').textContent = p.company;
      $('pt-facts').textContent = [p.kind, p.contact, p.phone, p.town].filter(Boolean).join(' · ');
      var kind = $('pt-kind'); kind.length = 0;
      partnerKinds.forEach(function (k) { kind.add(new Option(k, k)); });
      kind.value = p.kind;
      $('pt-status').value = p.status;
      $('pt-discount').value = p.discount;
      $('pt-note').value = p.note || '';
      $('pt-limit').value = p.credit_limit == null ? '' : p.credit_limit;
      $('pt-terms').value = p.terms_days == null ? '' : p.terms_days;
      $('pt-remind-on').checked = p.remind_days != null;
      $('pt-remind-days').value = p.remind_days || 7;
      $('pt-remind-days').disabled = p.remind_days == null;
      var cat = $('pt-cat'); cat.length = 1;
      Array.from(new Set(data.products.map(function (x) { return x.category; }))).sort().forEach(function (c) { cat.add(new Option(c, c)); });
      renderPrices(); updateSavebar();
      renderAccount(data.account);
      if (!keepScroll) show('partner');
    }).catch(function (err) { notice(err.message, true); });
  }

  function defaultPrice(x) { return Math.round(x.retail * (1 - (Number($('pt-discount').value) || 0) / 100)); }

  function renderPrices() {
    if (!current) return;
    var q = $('pt-search').value.trim().toLowerCase(), cat = $('pt-cat').value, own = $('pt-own').checked;
    var shown = current.products.filter(function (x) {
      if (own && !x.own && !(x.slug in priceEdits)) return false;
      if (cat && x.category !== cat) return false;
      return !q || (x.model + ' ' + x.name).toLowerCase().indexOf(q) !== -1;
    });
    $('pt-count').textContent = shown.length + ' of ' + current.products.length + ' products' + (shown.length > 150 ? ' (first 150 shown, search to narrow)' : '');
    var box = $('pt-prices');
    box.textContent = '';
    var head = document.createElement('div');
    head.className = 'prow head';
    head.innerHTML = '<span>Product</span><span class="r">Website</span><span class="r">Default for them</span><span class="r">Agreed price</span>';
    box.appendChild(head);
    shown.slice(0, 150).forEach(function (x) {
      var row = document.createElement('div');
      var edited = x.slug in priceEdits;
      row.className = 'prow' + (x.own ? ' own' : '') + (edited ? ' dirty' : '');
      row.innerHTML = '<div><b></b><small></small></div><span class="r web"></span><span class="r def"></span><input type="number" min="0" step="1" inputmode="numeric">';
      row.querySelector('b').textContent = x.name;
      row.querySelector('small').textContent = x.model + ' · ' + x.category;
      row.querySelector('.web').textContent = money(x.retail);
      row.querySelector('.def').textContent = money(defaultPrice(x));
      var input = row.querySelector('input');
      input.placeholder = 'default';
      input.value = edited ? priceEdits[x.slug] : (x.own ? x.price : '');
      input.addEventListener('input', function () {
        var v = input.value.trim();
        if ((x.own && Number(v) === x.price) || (!x.own && !v)) delete priceEdits[x.slug]; else priceEdits[x.slug] = v;
        row.classList.toggle('dirty', x.slug in priceEdits);
        updateSavebar();
      });
      box.appendChild(row);
    });
  }

  function updateSavebar() {
    var n = Object.keys(priceEdits).length;
    $('pt-savebar').hidden = !n;
    $('pt-changes').textContent = n + ' unsaved price change' + (n === 1 ? '' : 's');
  }

  $('pt-save').addEventListener('click', function () {
    var b = this; b.disabled = true;
    var prices = Object.keys(priceEdits).map(function (slug) { return { slug: slug, price: priceEdits[slug] === '' ? 0 : Number(priceEdits[slug]) }; });
    api('/api/admin/partners', { action: 'prices', id: current.partner.id, prices: prices }).then(function (r) {
      notice(r.message);
      return openPartner(current.partner.id);
    }).catch(function (err) { notice(err.message, true); }).then(function () { b.disabled = false; });
  });
  $('pt-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var b = this.querySelector('button'); b.disabled = true;
    api('/api/admin/partners', { action: 'update', id: current.partner.id, status: $('pt-status').value, kind: $('pt-kind').value,
      discount: Number($('pt-discount').value) || 0, note: $('pt-note').value,
      credit_limit: $('pt-limit').value.trim(), terms_days: $('pt-terms').value.trim(),
      remind_days: $('pt-remind-on').checked ? ($('pt-remind-days').value.trim() || '7') : '' }).then(function (r) {
      notice(r.message); loadPartners(); return openPartner(current.partner.id);
    }).catch(function (err) { notice(err.message, true); }).then(function () { b.disabled = false; });
  });
  $('pt-discount').addEventListener('input', renderPrices);
  $('pt-search').addEventListener('input', renderPrices);
  $('pt-cat').addEventListener('change', renderPrices);
  $('pt-own').addEventListener('change', renderPrices);
  $('partner-back').addEventListener('click', function () {
    if (Object.keys(priceEdits).length && !window.confirm('Leave without saving your price changes?')) return;
    show('partners'); loadPartners();
  });

  // ---- invoices and receipts ----------------------------------------------------
  var docKind = 'invoice', docOrderId = null, docAgainst = '';

  function loadDocs() {
    var q = $('docs-search').value.trim();
    return api('/api/admin/documents' + (q ? '?q=' + encodeURIComponent(q) : '')).then(function (data) {
      $('docs-count').textContent = data.documents.length ? data.documents.length + ' documents' + (q ? ' found' : '') : (q ? 'Nothing found.' : 'No invoices or receipts yet.');
      var list = $('docs-list'); list.textContent = '';
      data.documents.forEach(function (d) { list.appendChild(docCard(d)); });
    });
  }

  function docCard(d) {
    var el = document.createElement('article');
    el.className = 'tech doc-card' + (d.status === 'void' ? ' void' : '');
    el.innerHTML = '<div><h3><span class="k"></span><span class="num"></span></h3><div class="meta"></div></div><div class="tot"></div><div class="row-actions"></div>';
    el.querySelector('.k').className = 'k ' + d.kind;
    el.querySelector('.k').textContent = d.status === 'void' ? 'void' : d.kind;
    el.querySelector('.num').textContent = d.number + ' — ' + d.customer.name;
    el.querySelector('.meta').textContent = day(d.created_at) + (d.customer.phone ? ' · ' + d.customer.phone : '') +
      (d.kind === 'invoice' ? (d.balance ? ' · balance ' + money(d.balance) : ' · paid in full') : ' · received ' + money(d.paid) + (d.method ? ' by ' + d.method : '')) +
      (d.against ? ' · for ' + d.against : '');
    el.querySelector('.tot').textContent = money(d.total);
    var actions = el.querySelector('.row-actions');
    var open = document.createElement('a');
    open.className = 'chip'; open.href = '/admin/doc/?id=' + d.id; open.target = '_blank'; open.rel = 'noopener'; open.textContent = 'Open / PDF';
    actions.appendChild(open);
    if (d.status !== 'void') {
      if (d.kind === 'invoice' && d.balance) {
        var rc = document.createElement('button'); rc.type = 'button'; rc.className = 'chip'; rc.textContent = 'Receipt for this';
        rc.addEventListener('click', function () { openDoc('receipt', { doc: d }); });
        actions.appendChild(rc);
      }
      var v = document.createElement('button'); v.type = 'button'; v.className = 'danger'; v.textContent = 'Void';
      v.addEventListener('click', function () {
        if (!window.confirm('Void ' + d.number + '? It stays in the list marked VOID; the number is not reused.')) return;
        v.disabled = true;
        api('/api/admin/documents', { action: 'void', id: d.id }).then(function (r) { notice(r.message); loadDocs(); })
          .catch(function (err) { v.disabled = false; notice(err.message, true); });
      });
      actions.appendChild(v);
    }
    return el;
  }

  function productLabel(p) { return p.model.trim() + ' — ' + p.name; }

  function addLine(line) {
    line = line || {};
    var row = document.createElement('div');
    row.className = 'dline';
    row.innerHTML = '<input class="nm" list="d-products" placeholder="Type a model or describe the item" maxlength="160"><input class="q" type="number" min="0" step="any" value="1" inputmode="decimal">' +
      '<input class="p" type="number" min="0" step="1" inputmode="numeric" placeholder="Unit price"><span class="amt"></span><button type="button" class="x" aria-label="Remove line">&times;</button>';
    var nm = row.querySelector('.nm'), q = row.querySelector('.q'), pr = row.querySelector('.p');
    nm.value = line.name ? (line.model ? line.model + ' — ' + line.name : line.name) : '';
    if (line.qty) q.value = line.qty;
    if (line.price !== undefined) pr.value = line.price;
    nm.addEventListener('change', function () {
      var hit = products.filter(function (p) { return productLabel(p) === nm.value; })[0];
      if (hit && !pr.value) pr.value = hit.price;
      sumDoc();
    });
    [q, pr].forEach(function (i) { i.addEventListener('input', sumDoc); });
    row.querySelector('.x').addEventListener('click', function () { row.remove(); sumDoc(); });
    $('d-lines').appendChild(row);
    sumDoc();
  }

  function readLines() {
    return Array.prototype.map.call(document.querySelectorAll('#d-lines .dline'), function (row) {
      var text = row.querySelector('.nm').value.trim();
      var hit = products.filter(function (p) { return productLabel(p) === text; })[0];
      var parts = hit ? null : text.match(/^(\S+) — (.+)$/);
      return {
        name: hit ? hit.name : parts ? parts[2] : text, model: hit ? hit.model.trim() : parts ? parts[1] : '',
        qty: Number(row.querySelector('.q').value) || 0, price: Number(row.querySelector('.p').value) || 0,
      };
    }).filter(function (l) { return l.name && l.qty > 0; });
  }

  function sumDoc() {
    var subtotal = 0;
    Array.prototype.forEach.call(document.querySelectorAll('#d-lines .dline'), function (row) {
      var a = (Number(row.querySelector('.q').value) || 0) * (Number(row.querySelector('.p').value) || 0);
      row.querySelector('.amt').textContent = a ? money(Math.round(a)) : '';
      subtotal += a;
    });
    subtotal = Math.round(subtotal);
    var discount = Math.min(subtotal, Number($('d-discount').value) || 0);
    var total = subtotal - discount;
    var paid = docKind === 'receipt' ? Number($('d-paid').value) || 0 : Number($('d-paid-inv').value) || 0;
    $('d-sum').innerHTML = '';
    var lines = [['Subtotal', subtotal]];
    if (discount) lines.push(['Discount', -discount]);
    lines.push(['Total', total]);
    if (paid) lines.push([docKind === 'receipt' ? 'Received' : 'Already paid', paid], ['Balance', Math.max(0, total - paid)]);
    lines.forEach(function (l) {
      var d = document.createElement('div');
      d.innerHTML = l[0] === 'Total' ? '<b></b>' : '<span></span>';
      d.firstChild.textContent = l[0] + ': ' + money(l[1]);
      $('d-sum').appendChild(d);
    });
  }

  // from: { order } or { doc } to prefill, or nothing for a blank document.
  function openDoc(kind, from) {
    from = from || {};
    docKind = kind; docOrderId = null; docAgainst = '';
    notice('');
    $('doc-form').reset();
    $('doc-form').className = kind === 'receipt' ? 'rct-mode' : 'inv-mode';
    $('doc-title').textContent = kind === 'receipt' ? 'New receipt' : 'New invoice';
    $('d-lines').textContent = '';
    var dl = $('d-products');
    if (!dl.options.length) products.forEach(function (p) { var o = document.createElement('option'); o.value = productLabel(p); dl.appendChild(o); });
    try { $('d-notes').value = localStorage.getItem('ne_doc_notes_' + kind) || ''; } catch (e) { /* ignore */ }
    var o = from.order, src = from.doc;
    if (o) {
      docOrderId = o.id; docAgainst = 'Order ' + o.number;
      $('d-name').value = o.name; $('d-phone').value = o.phone || ''; $('d-email').value = o.email || '';
      o.items.forEach(function (i) { addLine({ name: i.name, model: i.model, qty: i.qty, price: i.price }); });
      if (o.tech_discount || o.reward_used) $('d-discount').value = (o.tech_discount || 0) + (o.reward_used || 0);
      if (kind === 'receipt') { $('d-paid').value = o.total; $('d-against').value = o.number; }
    } else if (src) {
      docOrderId = src.order_id;
      var c = src.customer;
      $('d-name').value = c.name; $('d-phone').value = c.phone || ''; $('d-email').value = c.email || ''; $('d-pin').value = c.pin || ''; $('d-address').value = c.address || '';
      src.items.forEach(addLine);
      $('d-discount').value = src.discount || 0;
      $('d-paid').value = src.balance; $('d-against').value = src.number;
    } else {
      addLine();
    }
    sumDoc();
    show('doc');
  }

  $('d-add').addEventListener('click', function () { addLine(); });
  ['d-discount', 'd-paid', 'd-paid-inv'].forEach(function (id) { $(id).addEventListener('input', sumDoc); });
  $('doc-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var b = $('d-save'); b.disabled = true;
    var doc = {
      kind: docKind, order_id: docOrderId,
      customer: { name: $('d-name').value, phone: $('d-phone').value, email: $('d-email').value, pin: $('d-pin').value, address: $('d-address').value },
      items: readLines(), discount: Number($('d-discount').value) || 0, notes: $('d-notes').value,
      paid: docKind === 'receipt' ? Number($('d-paid').value) || 0 : Number($('d-paid-inv').value) || 0,
      due_date: $('d-due').value, method: $('d-method').value, reference: $('d-ref').value,
      against: docKind === 'receipt' ? $('d-against').value : docAgainst,
    };
    try { localStorage.setItem('ne_doc_notes_' + docKind, doc.notes); } catch (err) { /* ignore */ }
    api('/api/admin/documents', { action: 'create', document: doc }).then(function (r) {
      notice(r.document.number + ' created.');
      window.open('/admin/doc/?id=' + r.document.id, '_blank', 'noopener');
      show('docs'); return loadDocs();
    }).catch(function (err) { notice(err.message, true); }).then(function () { b.disabled = false; });
  });
  $('doc-back').addEventListener('click', function () { show('docs'); });
  $('new-invoice').addEventListener('click', function () { openDoc('invoice'); });
  $('new-receipt').addEventListener('click', function () { openDoc('receipt'); });
  var docTimer = null;
  $('docs-search').addEventListener('input', function () {
    clearTimeout(docTimer);
    docTimer = setTimeout(function () { loadDocs().catch(function (err) { notice(err.message, true); }); }, 300);
  });

  // ---- team (staff area at /team) ------------------------------------------------
  var teamData = null;
  function teamApi(body, b) {
    if (b) b.disabled = true;
    return api('/api/admin/team', body).then(function (r) { notice(r.message); return loadTeam(); })
      .catch(function (err) { notice(err.message, true); }).then(function () { if (b) b.disabled = false; });
  }
  function teamReady() { return teamData ? Promise.resolve(teamData) : loadTeam(); }

  function loadTeam() {
    return api('/api/admin/team').then(function (t) {
      teamData = t;
      var pending = t.people.filter(function (p) { return p.status === 'pending'; }).length;
      var waiting = pending + t.toConfirm.length;
      $('team-badge').textContent = waiting; $('team-badge').hidden = !waiting;
      $('tm-count').textContent = t.people.length ? t.people.length + ' people · ' + pending + ' waiting for approval' : 'Nobody has signed up yet. Send your staff to nashnaal.com/team.';
      var pay = $('tm-pay'); pay.textContent = '';
      t.toConfirm.forEach(function (c) { pay.appendChild(collectionRow(c)); });
      $('tm-pay-box').hidden = !t.toConfirm.length;
      var pendingClaims = t.claims.filter(function (c) { return c.status === 'pending'; });
      var claimsBox = $('tm-claims'); claimsBox.textContent = '';
      pendingClaims.forEach(function (c) { claimsBox.appendChild(claimRow(c)); });
      $('tm-claim-box').hidden = !pendingClaims.length;
      var owned = $('tm-owned'); owned.textContent = '';
      var approved = t.claims.filter(function (c) { return c.status === 'approved'; });
      if (!approved.length) owned.appendChild(textEl('p', 'hint', 'None yet. Staff claim customers from orders they handle.'));
      approved.forEach(function (c) { owned.appendChild(claimRow(c)); });
      $('team-badge').textContent = waiting + pendingClaims.length; $('team-badge').hidden = !(waiting + pendingClaims.length);
      var list = $('tm-people'); list.textContent = '';
      t.people.forEach(function (p) { list.appendChild(staffCard(p, t.roles)); });
      var cash = $('tm-cash'); cash.textContent = '';
      if (!t.cash.length) cash.appendChild(textEl('p', 'hint', 'No money recorded by staff yet.'));
      t.cash.forEach(function (r) {
        var d = document.createElement('div'); d.className = 'req';
        d.innerHTML = '<div><b></b><small></small></div>';
        d.querySelector('b').textContent = r.username + ': ' + money(r.holding) + ' not yet confirmed';
        d.querySelector('small').textContent = 'Cash ' + money(r.cash) + ' · ' + r.pending + ' payment(s) waiting · confirmed this month ' + money(r.month);
        cash.appendChild(d);
      });
      var jobs = $('tm-jobs'); jobs.textContent = '';
      if (!t.deliveries.length) jobs.appendChild(textEl('p', 'hint', 'No delivery jobs in the last 3 days.'));
      t.deliveries.forEach(function (j) { jobs.appendChild(jobRow(j)); });
      var log = $('tm-log'); log.textContent = '';
      t.activity.forEach(function (a) {
        var d = document.createElement('div'); d.className = 'req';
        d.innerHTML = '<div><b></b><small></small></div>';
        d.querySelector('b').textContent = a.username + ': ' + a.detail;
        d.querySelector('small').textContent = a.created_at + ' UTC';
        log.appendChild(d);
      });
      return t;
    });
  }

  function claimRow(c) {
    var d = document.createElement('div'); d.className = 'req';
    d.innerHTML = '<div><b></b><small></small></div><div class="row-actions"></div>';
    d.querySelector('b').textContent = c.status === 'pending' ? c.username + ' wants ' + c.label + ' as their customer' : c.label + ' → ' + c.username;
    d.querySelector('small').textContent = [c.phone, c.from_order ? 'from ' + c.from_order : '', 'asked ' + day(c.requested_at)].filter(Boolean).join(' · ');
    var acts = d.querySelector('.row-actions');
    (c.status === 'pending' ? [['Approve', 'ok', 'approve'], ['Decline', 'danger', 'reject']] : [['Remove', 'danger', 'remove']]).forEach(function (x) {
      var b = document.createElement('button'); b.type = 'button'; b.className = x[1]; b.textContent = x[0];
      b.addEventListener('click', function () {
        if (x[2] === 'remove' && !window.confirm('Stop sending ' + c.label + '\'s orders to ' + c.username + '?')) return;
        teamApi({ action: 'claim', key: c.customer_key, decision: x[2] }, b);
      });
      acts.appendChild(b);
    });
    return d;
  }

  function textEl(tag, cls, text) { var e = document.createElement(tag); e.className = cls; e.textContent = text; return e; }

  function staffCard(p, roles) {
    var el = document.createElement('article');
    el.className = 'tech ' + p.status;
    el.innerHTML = '<div class="st"></div><h3></h3><dl></dl><div class="row-actions"></div>';
    el.querySelector('.st').className = 'st ' + p.status;
    el.querySelector('.st').textContent = p.status + (p.role ? ' · ' + roles[p.role] : '');
    el.querySelector('h3').textContent = p.username + ' — ' + p.full_name;
    var facts = [['Phone', p.phone], ['Google', p.email], ['Says they do', p.wanted], ['Last 30 days', p.delivered + ' delivered · ' + p.orders + ' orders · ' + money(p.collected) + ' confirmed'],
      ['Holding now', p.holding ? money(p.holding) : ''], ['Open jobs', p.open_jobs || ''], ['Signed up', day(p.created_at)], ['Last sign-in', p.last_login ? day(p.last_login) : '']];
    var dl = el.querySelector('dl');
    facts.forEach(function (f) {
      if (!f[1]) return;
      var dt = document.createElement('dt'); dt.textContent = f[0];
      var dd = document.createElement('dd'); dd.textContent = f[1];
      dl.appendChild(dt); dl.appendChild(dd);
    });
    var acts = el.querySelector('.row-actions');
    var sel = document.createElement('select');
    sel.appendChild(new Option('Choose role…', ''));
    Object.keys(roles).forEach(function (k) { sel.appendChild(new Option(roles[k], k)); });
    sel.value = p.role || '';
    acts.appendChild(sel);
    function btn(label, cls, fields) {
      var b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = label;
      b.addEventListener('click', function () {
        var f = Object.assign({ action: 'update', id: p.user_id, role: sel.value || null }, fields);
        if (f.status === 'approved' && !sel.value) { notice('Choose a role first.', true); return; }
        if (fields.status === 'suspended' || fields.status === 'rejected') {
          var note = window.prompt('Note (they see it):', ''); if (note === null) return; f.note = note;
        }
        teamApi(f, b);
      });
      acts.appendChild(b);
    }
    if (p.status === 'approved') btn('Save role', 'chip', {});
    else btn('Approve', 'ok', { status: 'approved' });
    if (p.status === 'pending') btn('Reject', 'danger', { status: 'rejected' });
    if (p.status === 'approved') btn('Suspend', 'danger', { status: 'suspended' });
    var digits = String(p.phone).replace(/[^0-9]/g, '').replace(/^0/, '254');
    var wa = document.createElement('a'); wa.className = 'wa'; wa.target = '_blank'; wa.rel = 'noopener'; wa.textContent = 'WhatsApp';
    wa.href = 'https://wa.me/' + digits + '?text=' + encodeURIComponent('Hi ' + p.full_name.split(' ')[0] + ', your NE team account is ready: nashnaal.com/team');
    acts.appendChild(wa);
    return el;
  }

  function collectionRow(c) {
    var el = document.createElement('div');
    el.className = 'req';
    el.innerHTML = '<div><b></b><small></small></div><div class="row-actions"></div>';
    el.querySelector('b').textContent = c.staff + ' collected ' + money(c.amount) + ' by ' + c.method + ' from ' + c.customer;
    el.querySelector('small').textContent = ['C-' + c.id, c.reference ? 'code ' + c.reference : '', c.order, c.partner ? 'partner account: ' + c.partner : '', c.note ? '“' + c.note + '”' : '', day(c.created_at)].filter(Boolean).join(' · ');
    var acts = el.querySelector('.row-actions');
    if (c.has_proof) {
      var a = document.createElement('a'); a.className = 'chip'; a.target = '_blank'; a.href = '/api/team/proof?id=' + c.id; a.textContent = 'Screenshot';
      acts.appendChild(a);
    }
    [[c.method === 'Cash' ? 'Cash handed in' : 'Confirm', 'ok', true], ['Not received', 'danger', false]].forEach(function (x) {
      var b = document.createElement('button'); b.type = 'button'; b.className = x[1]; b.textContent = x[0];
      b.addEventListener('click', function () {
        var note = '';
        if (!x[2]) { note = window.prompt('Why? The staff member sees this note.', 'Not found in our account'); if (!note) return; }
        teamApi({ action: 'decide', id: c.id, accept: x[2], note: note }, b);
      });
      acts.appendChild(b);
    });
    return el;
  }

  var JOB_LABEL = { assigned: 'assigned', on_way: 'on the way', delivered: 'delivered', failed: 'not delivered', cancelled: 'cancelled' };
  function jobRow(j) {
    var el = document.createElement('div');
    el.className = 'req';
    el.innerHTML = '<div><b></b><small></small></div><div class="row-actions"></div>';
    el.querySelector('b').textContent = j.number + ' → ' + j.staff + ': ' + JOB_LABEL[j.status];
    el.querySelector('small').textContent = [j.customer, j.address, j.collect ? 'collect ' + money(j.collect) : 'nothing to collect', j.reason, day(j.created_at)].filter(Boolean).join(' · ');
    if (j.status === 'assigned' || j.status === 'on_way') {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'danger'; b.textContent = 'Cancel job';
      b.addEventListener('click', function () { if (window.confirm('Cancel this delivery job?')) teamApi({ action: 'cancel_job', id: j.id }, b); });
      el.querySelector('.row-actions').appendChild(b);
    }
    return el;
  }

  function assignForm(o, t) {
    var f = document.createElement('form');
    f.className = 'assign-form';
    var people = t.people.filter(function (p) { return p.status === 'approved'; });
    if (!people.length) { f.appendChild(textEl('p', 'hint', 'Nobody is approved on the team yet (Team tab).')); return f; }
    f.innerHTML = '<label>Delivered by <select name="staff_id"></select></label>' +
      '<label>Address <input name="address" maxlength="200" placeholder="Building, street, area"></label>' +
      '<label>Map link <input name="map_url" placeholder="Google Maps link or -1.27, 36.85"></label>' +
      '<label>Amount to collect (KES) <input name="collect" type="number" min="0" step="1"></label>' +
      '<label>Note for them <input name="notes" maxlength="300"></label><button class="primary" type="submit">Assign and send on WhatsApp</button>';
    people.forEach(function (p) { f.elements.staff_id.appendChild(new Option(p.username + ' (' + t.roles[p.role] + ')', p.user_id)); });
    f.elements.address.value = o.town || '';
    f.elements.collect.value = o.status === 'paid' || String(o.notes || '').indexOf('Payment: on my account') === 0 ? 0 : o.total;
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var b = f.querySelector('button'); b.disabled = true;
      api('/api/admin/team', { action: 'assign', order_id: o.id, staff_id: Number(f.elements.staff_id.value), address: f.elements.address.value,
        map_url: f.elements.map_url.value, collect: f.elements.collect.value, notes: f.elements.notes.value })
        .then(function (r) { notice(r.message); f.remove(); teamData = null; })
        .catch(function (err) { notice(err.message, true); b.disabled = false; });
    });
    return f;
  }

  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
    tab.addEventListener('click', function () {
      notice('');
      var view = tab.getAttribute('data-tab');
      show(view);
      if (view === 'tech') loadTechs().catch(function (err) { notice(err.message, true); });
      if (view === 'orders') loadOrders().catch(function (err) { notice(err.message, true); });
      if (view === 'partners') loadPartners().catch(function (err) { notice(err.message, true); });
      if (view === 'docs') loadDocs().catch(function (err) { notice(err.message, true); });
      if (view === 'team') loadTeam().catch(function (err) { notice(err.message, true); });
      if (view === 'wa') {
        loadChats().catch(function (err) { notice(err.message, true); });
        loadWhatsApp().catch(function (err) { notice(err.message, true); });
        startChatPolling();
      }
      if (view === 'customers') {
        loadCustomers().catch(function (err) { notice(err.message, true); });
        loadFunnel().catch(function (err) { notice(err.message, true); });
      }
    });
  });

  function openEditor(p) {
    editing = p;
    newImage = null;
    $('photo').value = '';
    $('edit-title').textContent = p ? 'Edit product' : 'Add a product';
    $('f-model').value = p ? p.model.trim() : '';
    $('f-model').readOnly = Boolean(p);
    $('f-name').value = p ? p.name : '';
    $('f-category').value = p ? p.category : '';
    $('f-price').value = p ? p.price : '';
    $('f-features').value = p ? p.features : '';
    $('f-pcs').value = p ? p.pcsCtn : '';
    $('photo-preview').src = img(p && p.image);
    $('delete-btn').hidden = !p;
    $('view-link').hidden = !p;
    if (p) $('view-link').href = p.url;
    notice('');
    show('edit');
  }

  // Resize to at most 1000px and convert to WebP in the browser.
  function readPhoto(file) {
    return createImageBitmap(file).then(function (bitmap) {
      var scale = Math.min(1, 1000 / Math.max(bitmap.width, bitmap.height));
      var canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      var type = canvas.toDataURL('image/webp').indexOf('data:image/webp') === 0 ? 'image/webp' : 'image/jpeg';
      var dataUrl = canvas.toDataURL(type, 0.82);
      return { dataUrl: dataUrl, image: { type: type, base64: dataUrl.split(',')[1] } };
    });
  }

  $('photo').addEventListener('change', function () {
    var file = this.files[0];
    if (!file) return;
    readPhoto(file).then(function (out) {
      newImage = out.image;
      $('photo-preview').src = out.dataUrl;
    }).catch(function () { notice('Could not read that photo. Try a JPEG or PNG.', true); });
  });

  function busy(on) {
    $('save-btn').disabled = on;
    $('save-btn').textContent = on ? 'Saving…' : 'Save';
  }

  $('edit-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var fields = {
      name: $('f-name').value, category: $('f-category').value, price: $('f-price').value,
      features: $('f-features').value, pcsCtn: $('f-pcs').value,
    };
    var body = editing
      ? { action: 'update', slug: editing.slug, product: fields }
      : { action: 'add', product: Object.assign({ model: $('f-model').value }, fields) };
    if (newImage) body.image = newImage;
    busy(true);
    api('/api/admin/products', body).then(function (res) {
      busy(false);
      return load().then(function () {
        loadLog();
        show('list');
        notice(res.unchanged ? 'Nothing changed.' : 'Saved: ' + res.message + '. It will be live on the website in about 2–3 minutes.');
      });
    }).catch(function (err) { busy(false); notice(err.message, true); });
  });

  $('delete-btn').addEventListener('click', function () {
    if (!editing) return;
    if (!window.confirm('Delete ' + editing.model.trim() + ' from the website? Its page will stop working.')) return;
    api('/api/admin/products', { action: 'delete', slug: editing.slug }).then(function (res) {
      return load().then(function () { loadLog(); show('list'); notice('Deleted: ' + res.message + '.'); });
    }).catch(function (err) { notice(err.message, true); });
  });

  $('add-btn').addEventListener('click', function () { openEditor(null); });
  $('back-btn').addEventListener('click', function () { notice(''); show('list'); });
  $('search').addEventListener('input', renderList);
  $('filter-cat').addEventListener('change', renderList);

  load().then(loadLog).catch(function (err) { notice(err.message, true); $('count').textContent = ''; });
  loadTechs().catch(function () {});  // fills the badge
  loadOrders().catch(function () {});
  loadPartners().catch(function () {});  // fills the Partners badge
  loadTeam().catch(function () {});  // fills the Team badge
  loadChats().catch(function () {});  // fills the WhatsApp badge
  // The home-screen app opens straight on the chats (start_url /admin/#wa).
  // Links from WhatsApp alerts open a tab directly: /admin/#wa, /admin/#partners, /admin/#orders.
  var hashTab = location.hash && document.querySelector('[data-tab="' + location.hash.slice(1) + '"]');
  if (hashTab) hashTab.click();
})();
