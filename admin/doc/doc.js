// Printable invoice / receipt for the admin (admin/doc/?id=N). Print or save as PDF from the browser.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  function money(n) { return 'KES ' + Math.round(n).toLocaleString('en-KE'); }
  function day(sql) { return new Date(String(sql).replace(' ', 'T') + 'Z').toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric' }); }
  function text(el, value) { el.textContent = value; return el; }
  function lines(el, parts) {
    el.textContent = '';
    parts.filter(Boolean).forEach(function (p, i) {
      if (i) el.appendChild(document.createElement('br'));
      el.appendChild(document.createTextNode(p));
    });
  }

  function render(d) {
    var receipt = d.kind === 'receipt';
    document.title = d.number + ' | NE Nashnaal Electronics';
    text($('d-kind'), receipt ? 'RECEIPT' : 'INVOICE');
    text($('d-number'), d.number);
    text($('d-date'), day(d.created_at));
    text($('d-extra'), !receipt && d.due_date ? 'Due ' + day(d.due_date + ' 00:00:00') : '');
    text($('d-to-label'), receipt ? 'Received from' : 'Bill to');
    var c = d.customer;
    lines($('d-customer'), [c.name, c.address, c.phone, c.email, c.pin ? 'KRA PIN: ' + c.pin : '']);
    text($('d-ref-label'), receipt ? 'Payment' : (d.against ? 'Reference' : ''));
    lines($('d-ref'), receipt
      ? [d.method ? 'Paid by ' + d.method : '', d.reference ? 'Reference: ' + d.reference : '', d.against ? 'For: ' + d.against : '']
      : [d.against ? d.against : '']);

    var tbody = $('d-items');
    d.items.forEach(function (i, n) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td></td><td><b></b><br><small></small></td><td class="n"></td><td class="n"></td><td class="n"></td>';
      text(tr.children[0], n + 1);
      text(tr.querySelector('b'), i.name);
      text(tr.querySelector('small'), i.model || '');
      text(tr.children[2], i.qty);
      text(tr.children[3], money(i.price));
      text(tr.children[4], money(i.qty * i.price));
      tbody.appendChild(tr);
    });
    var rows = [['Subtotal', d.subtotal]];
    if (d.discount) rows.push(['Discount', -d.discount]);
    rows.push(['Total', d.total, true]);
    if (!receipt && d.paid) rows.push(['Paid', -d.paid], ['Balance due', d.balance, true]);
    rows.forEach(function (r) {
      var div = document.createElement('div');
      if (r[2]) div.className = 'grand';
      div.innerHTML = '<span></span><span></span>';
      text(div.firstChild, r[0]);
      text(div.lastChild, r[1] < 0 ? '− ' + money(-r[1]) : money(r[1]));
      $('d-totals').appendChild(div);
    });
    if (receipt) {
      $('d-paidbox').hidden = false;
      text($('d-paidbox'), 'Received with thanks: ' + money(d.paid) + (d.method ? ' by ' + d.method : '') + (d.reference ? ' (ref ' + d.reference + ')' : '') + '.' +
        (d.total - d.paid > 0 ? ' Balance remaining: ' + money(d.total - d.paid) + '.' : ' Paid in full.'));
      text($('sign-right'), 'Customer signature');
    }
    text($('d-notes'), d.notes || '');
    $('void').hidden = d.status !== 'void';

    var digits = String(c.phone || '').replace(/[^0-9]/g, '').replace(/^0/, '254');
    if (digits.length >= 11) {
      var msg = 'Hi ' + c.name.split(' ')[0] + ', this is NE (Nashnaal Electronics). ' +
        (receipt ? 'Thank you for your payment of ' + money(d.paid) + '. Your receipt is ' + d.number + '.' : 'Your invoice ' + d.number + ' is ' + money(d.total) + (d.paid ? ', balance ' + money(d.balance) : '') + '.') +
        ' We will attach the PDF here.';
      $('wa-btn').href = 'https://wa.me/' + digits + '?text=' + encodeURIComponent(msg);
      $('wa-btn').hidden = false;
    }
    $('doc').hidden = false;
  }

  $('pdf-btn').addEventListener('click', function () { window.print(); });
  var id = new URLSearchParams(location.search).get('id');
  fetch('/api/admin/documents?id=' + encodeURIComponent(id || ''), { credentials: 'same-origin', headers: { 'x-ne-admin': '1' } })
    .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || 'Not found'); return d; }); })
    .then(function (d) { render(d.document); })
    .catch(function (e) { $('error').textContent = e.message; $('error').hidden = false; });
})();
