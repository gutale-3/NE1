// Admin reports, printed to PDF with the browser:
//   ?type=credit                 rebate (2% / 1% reward) NE owes, per customer
//   ?type=sales[&from=&to=]      how much each customer bought (paid orders)
//   ?type=statement&user=ID      one customer's orders and reward history
//   ?type=statement&phone=…      the same for a guest buyer
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(window.location.search);
  var type = params.get('type');
  var STATUS = { new: 'Received', confirmed: 'Confirmed', paid: 'Paid', delivered: 'Delivered', cancelled: 'Cancelled' };

  function money(n) { return 'KES ' + Math.round(n || 0).toLocaleString('en-KE'); }
  function day(sql) { return sql ? new Date(sql.replace(' ', 'T') + (sql.length > 10 ? 'Z' : 'T00:00:00Z')).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'; }
  function el(tag, text, cls) { var e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; }

  function table(head, rows, foot) {
    var t = el('table');
    var thead = el('thead'), tr = el('tr');
    head.forEach(function (h) { tr.appendChild(el('th', h[0], h[1] ? 'n' : '')); });
    thead.appendChild(tr); t.appendChild(thead);
    var tbody = el('tbody');
    rows.forEach(function (r) {
      var row = el('tr');
      r.forEach(function (cell, i) {
        var td = el('td', '', head[i][1] ? 'n' : '');
        if (Array.isArray(cell)) { td.appendChild(document.createTextNode(cell[0])); td.appendChild(el('br')); td.appendChild(el('small', cell[1])); }
        else td.textContent = cell;
        row.appendChild(td);
      });
      tbody.appendChild(row);
    });
    t.appendChild(tbody);
    if (foot) {
      var tfoot = el('tfoot'), fr = el('tr');
      foot.forEach(function (f, i) { fr.appendChild(el('td', f, head[i][1] ? 'n' : '')); });
      tfoot.appendChild(fr); t.appendChild(tfoot);
    }
    return t;
  }

  function summary(items) {
    var box = el('div', undefined, 'sum');
    items.forEach(function (s) { var d = el('div'); d.appendChild(el('b', s[0])); d.appendChild(el('span', s[1])); box.appendChild(d); });
    return box;
  }

  function get(url) {
    return fetch(url, { credentials: 'same-origin' }).then(function (r) {
      return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || 'Could not load the report.'); return d; });
    });
  }

  function header(title, sub) {
    document.title = title + ' | NE';
    $('r-title').textContent = title;
    $('r-sub').textContent = sub;
  }

  function creditReport(d) {
    var owed = d.customers.filter(function (c) { return c.credit > 0; });
    header('Rebate owed to customers', 'As of ' + day(d.generated));
    var body = $('r-body');
    body.appendChild(summary([[money(d.totals.credit), 'Total rebate owed'], [String(owed.length), 'Customers with rebate'],
      [money(owed.reduce(function (n, c) { return n + c.credit_earned; }, 0)), 'Rebate earned in total']]));
    body.appendChild(owed.length ? table(
      [['Customer'], ['Type'], ['Earned', 1], ['Used', 1], ['Expired', 1], ['Owed now', 1], ['Next expiry', 1]],
      owed.map(function (c) {
        return [[c.name, [c.phone, c.email].filter(Boolean).join(' · ')], c.type, money(c.credit_earned), money(c.credit_spent),
          money(c.credit_expired), money(c.credit), c.credit_next ? money(c.credit_next.amount) + ' on ' + day(c.credit_next.expires) : '—'];
      }),
      ['Total', '', '', '', '', money(d.totals.credit), '']
    ) : el('p', 'No customer has rebate owed right now.', 'empty'));
    $('r-foot').textContent = 'Rebate is the reward promotion: 2% of paid orders for customers, 1% for approved technicians (on top of their 5% technician price). It lasts 6 months, can only be used on purchases from NE and has no cash value.';
  }

  function salesReport(d) {
    var buyers = d.customers.filter(function (c) { return c.bought > 0 || c.pending > 0; });
    var period = d.from || d.to ? (d.from ? day(d.from) : 'Start') + ' – ' + (d.to ? day(d.to) : day(d.generated)) : 'All time';
    header('Sales by customer', period + ' · printed ' + day(d.generated));
    var body = $('r-body');
    body.appendChild(summary([[money(d.totals.bought), 'Bought (paid orders)'], [String(buyers.filter(function (c) { return c.bought > 0; }).length), 'Paying customers'],
      [money(d.totals.pending), 'Ordered, not paid yet']]));
    body.appendChild(buyers.length ? table(
      [['Customer'], ['Type'], ['Paid orders', 1], ['Bought', 1], ['Not paid yet', 1], ['Last order', 1]],
      buyers.map(function (c) {
        return [[c.name, [c.phone, c.email].filter(Boolean).join(' · ')], c.type, String(c.paid_orders), money(c.bought), money(c.pending), day(c.last_order)];
      }),
      ['Total', '', String(buyers.reduce(function (n, c) { return n + c.paid_orders; }, 0)), money(d.totals.bought), money(d.totals.pending), '']
    ) : el('p', 'No orders in this period.', 'empty'));
    $('r-foot').textContent = 'Bought = orders marked paid or delivered in the admin panel' + (d.from || d.to ? ' and placed within the period' : '') + '. Cancelled orders are not counted. Amounts in KES after discounts and rebate used.';
  }

  function statementReport(d) {
    var c = d.customer;
    header('Customer statement', 'Printed ' + day(d.generated));
    var body = $('r-body');
    var who = el('div', undefined, 'who');
    who.appendChild(el('h3', 'Customer'));
    [c.name, c.phone, c.email, c.role === 'guest' ? 'Guest buyer (not signed in)' : (c.role === 'technician' && c.technician_status === 'approved' ? 'Approved technician' : 'Customer account')]
      .filter(Boolean).forEach(function (line, i) { if (i) who.appendChild(el('br')); who.appendChild(document.createTextNode(line)); });
    body.appendChild(who);
    body.appendChild(summary([[money(d.bought), 'Total bought (paid orders)'], [money(d.credit.balance), 'Rebate available'],
      [d.credit.next ? money(d.credit.next.amount) + ' · ' + day(d.credit.next.expires) : '—', 'Next rebate to expire']]));
    body.appendChild(el('h4', 'Orders'));
    body.appendChild(d.orders.length ? table(
      [['Order'], ['Date'], ['Status'], ['Items', 1], ['Rebate used', 1], ['Rebate earned', 1], ['Total', 1]],
      d.orders.map(function (o) {
        return [o.number, day(o.created_at), STATUS[o.status] || o.status, String(o.items), o.reward_used ? money(o.reward_used) + (o.status === 'cancelled' ? ' (returned)' : '') : '—', o.reward_earned ? money(o.reward_earned) : '—', money(o.total)];
      }),
      ['Total bought (paid)', '', '', '', '', '', money(d.bought)]
    ) : el('p', 'No orders yet.', 'empty'));
    if (c.role !== 'guest') {
      body.appendChild(el('h4', 'Rebate history (2% / 1% reward)'));
      body.appendChild(d.ledger.length ? table(
        [['Date'], ['Order'], ['Activity'], ['Amount', 1], ['Expires', 1]],
        d.ledger.map(function (l) {
          return [day(l.created_at), l.number || '—', l.kind === 'earn' ? 'Earned' : 'Used', (l.kind === 'earn' ? '+' : '−') + money(l.amount), l.expires_at ? day(l.expires_at) : '—'];
        }),
        ['Available now', '', '', money(d.credit.balance), '']
      ) : el('p', 'No rebate yet.', 'empty'));
    }
    $('r-foot').textContent = 'Amounts in Kenya Shillings (KES). Rebate lasts 6 months from the date it is earned and can only be used on purchases from NE.';
  }

  $('pdf-btn').addEventListener('click', function () { window.print(); });

  var q = [];
  ['from', 'to'].forEach(function (k) { if (params.get(k)) q.push(k + '=' + encodeURIComponent(params.get(k))); });
  var job = type === 'statement'
    ? get('/api/admin/statement?' + (params.get('user') ? 'user=' + encodeURIComponent(params.get('user')) : 'phone=' + encodeURIComponent(params.get('phone') || ''))).then(statementReport)
    : type === 'credit' ? get('/api/admin/customers').then(creditReport)
    : type === 'sales' ? get('/api/admin/customers' + (q.length ? '?' + q.join('&') : '')).then(salesReport)
    : Promise.reject(new Error('Unknown report.'));
  job.then(function () { $('doc').hidden = false; }).catch(function (err) {
    $('error').textContent = err.message;
    $('error').hidden = false;
    $('pdf-btn').hidden = true;
  });
})();
