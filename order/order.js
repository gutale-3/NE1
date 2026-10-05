// Order page: shows one order as a printable document ("Download PDF" uses the
// browser's Save as PDF). The link carries a private token, so it works
// without signing in.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(window.location.search);
  var STATUS = { new: 'Received', confirmed: 'Confirmed', paid: 'Paid', delivered: 'Delivered', cancelled: 'Cancelled' };
  var TRANSPORT = { courier: 'courier', bus: 'bus / matatu parcel', other: 'other transport' };

  function money(n) { return 'KES ' + Math.round(n).toLocaleString('en-KE'); }
  function text(el, value) { el.textContent = value; return el; }

  function lines(el, rows) {
    el.textContent = '';
    rows.filter(Boolean).forEach(function (row, i) {
      if (i) el.appendChild(document.createElement('br'));
      el.appendChild(document.createTextNode(row));
    });
  }

  function render(o) {
    document.title = 'Order ' + o.number + ' | NE Nashnaal Electronics';
    text($('o-number'), o.number);
    text($('o-date'), new Date(o.created_at.replace(' ', 'T') + 'Z').toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' }));
    text($('o-status'), STATUS[o.status] || o.status);
    lines($('o-customer'), [o.name, o.phone, o.email]);
    var delivery = o.delivery === 'outside'
      ? ['Outside Nairobi: ' + (o.town || ''), 'By ' + (TRANSPORT[o.transport] || 'courier') + ' (fare paid by customer)']
      : [o.deliveryLabel];
    lines($('o-delivery'), delivery);

    var body = $('o-items');
    o.items.forEach(function (item) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td><strong></strong><br><small></small></td><td class="n"></td><td class="n"></td><td class="n"></td>';
      text(tr.querySelector('strong'), item.name);
      text(tr.querySelector('small'), item.model);
      text(tr.children[1], item.qty);
      text(tr.children[2], money(item.price));
      text(tr.children[3], money(item.qty * item.price));
      body.appendChild(tr);
    });

    var rows = [['Subtotal', money(o.subtotal)]];
    if (o.tech_discount) rows.push(['Technician discount', '−' + money(o.tech_discount)]);
    if (o.reward_used) rows.push(['Reward credit used', '−' + money(o.reward_used)]);
    rows.push(['Delivery', o.delivery === 'outside' ? 'Paid by customer' : 'Free']);
    rows.push(['Total', money(o.total)]);
    var totals = $('o-totals');
    rows.forEach(function (r, i) {
      var div = document.createElement('div');
      if (i === rows.length - 1) div.className = 'grand';
      div.innerHTML = '<span></span><span></span>';
      text(div.children[0], r[0]);
      text(div.children[1], r[1]);
      totals.appendChild(div);
    });
    if (o.notes) text($('o-notes'), 'Notes: ' + o.notes);
    if (o.reward_earned) {
      var earned = document.createElement('p');
      earned.textContent = 'Reward credit earned on this order: ' + money(o.reward_earned) + '.';
      $('o-notes').parentNode.insertBefore(earned, $('o-notes').nextSibling);
    }

    // A short WhatsApp message with the link, for orders sent to the website or reopened later.
    var wa = 'Hi NE, about my order ' + o.number + ' (' + money(o.total) + '): ' + window.location.href.replace(/&sent=[a-z]+/, '');
    $('wa-btn').href = 'https://wa.me/254737454891?text=' + encodeURIComponent(wa);
    $('wa-btn').hidden = false;

    var sent = params.get('sent');
    if (sent) {
      text($('thanks-text'), sent === 'whatsapp'
        ? 'Thank you! Your order ' + o.number + ' is saved. Send the WhatsApp message that opened to reach us fastest. You can download this order as a PDF.'
        : 'Thank you! We received your order ' + o.number + ' and will contact you on ' + o.phone + ' to confirm. Download it as a PDF for your records.');
      $('thanks').hidden = false;
    }
    $('doc').hidden = false;
  }

  $('pdf-btn').addEventListener('click', function () { window.print(); });

  fetch('/api/orders/view?n=' + encodeURIComponent(params.get('n') || '') + '&k=' + encodeURIComponent(params.get('k') || ''), { credentials: 'same-origin' })
    .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || 'Order not found.'); return d; }); })
    .then(function (d) { render(d.order); })
    .catch(function (err) {
      text($('error'), err.message + ' Check the link, or contact NE on 0737 454 891.');
      $('error').hidden = false;
      $('pdf-btn').hidden = true;
    });
})();
