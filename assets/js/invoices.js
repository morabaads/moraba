/* Invoices and pro-forma invoices (supervisors): list, editor, client link, send to the client group, mark paid (→ accounting). */
(function () {
  'use strict';
  var MP = window.MP, S = MP.S, J = MP.J, el = MP.el, $ = MP.$, fa = MP.fa, icon = MP.icon;
  var STATUS = { draft: 'پیش‌نویس', sent: 'ارسال‌شده', accepted: 'تأیید مشتری', paid: 'پرداخت‌شده', cancelled: 'لغوشده' };
  var TONE = { draft: '', sent: 'info', accepted: 'brand', paid: 'ok', cancelled: 'danger' };
  var tab = 'all', settings = null;

  function money(n) { return J.faDigits(Number(n || 0).toLocaleString('en-US')) + ' تومان'; }
  function num(v) { return +(J.latinDigits(String(v || '')).replace(/[^\d.]/g, '')) || 0; }
  function moneyInput(name, value, ph) {
    var i = el('input', { name: name, inputmode: 'numeric', dir: 'ltr', placeholder: ph || '۰', value: value ? J.faDigits(Number(value).toLocaleString('en-US')) : '' });
    i.addEventListener('input', function () { var n = num(i.value); i.value = n ? J.faDigits(n.toLocaleString('en-US')) : ''; i.dispatchEvent(new Event('recalc', { bubbles: true })); });
    return i;
  }
  function kindName(x) { return x.kind === 'proforma' ? 'پیش‌فاکتور' : 'فاکتور'; }

  /* ------------------------------------------------------------ List */

  MP.invoices = function (openId) {
    var body = MP.dialog.open('فاکتورها و پیش‌فاکتورها', MP.skeleton(3), { wide: true, focus: false });
    MP.api('invoices', { query: { archived: tab === 'archived' ? 1 : '' } }).then(function (d) {
      if (!MP.dialog.isOpen()) return;
      settings = d.settings;
      var list = d.items.filter(function (x) {
        return tab === 'all' || tab === 'archived' || (tab === 'unpaid' ? x.kind === 'invoice' && x.status !== 'paid' && x.status !== 'cancelled' : x.kind === tab);
      });
      var unpaid = d.items.filter(function (x) { return x.kind === 'invoice' && ['paid', 'cancelled'].indexOf(x.status) < 0; }).reduce(function (s, x) { return s + x.total; }, 0);
      var tabs = el('div', { class: 'mt-tabs inv-tabs', role: 'tablist' }, [['all', 'همه'], ['proforma', 'پیش‌فاکتورها'], ['invoice', 'فاکتورها'], ['unpaid', 'پرداخت‌نشده'], ['archived', 'آرشیو']].map(function (t) {
        return el('button', { type: 'button', role: 'tab', class: 'mt-tab', 'aria-selected': String(t[0] === tab), onclick: function () { tab = t[0]; MP.invoices(); } }, el('span', { text: t[1] }));
      }));
      var head = el('div', { class: 'inv-head' },
        el('div', { class: 'inv-sum' }, el('small', { text: 'مانده دریافت‌نشده' }), el('strong', { text: money(unpaid) })),
        el('span', { class: 'spacer' }),
        el('button', { type: 'button', class: 'icon-btn', title: 'تنظیمات فاکتور', 'aria-label': 'تنظیمات فاکتور', html: icon('settings'), onclick: settingsForm }),
        el('button', { type: 'button', class: 'btn btn-secondary', html: icon('plus') + 'پیش‌فاکتور', onclick: function () { editor({ kind: 'proforma' }); } }),
        el('button', { type: 'button', class: 'btn btn-primary', html: icon('plus') + 'فاکتور', onclick: function () { editor({ kind: 'invoice' }); } }));
      var wrap = el('div', { class: 'inv-list' });
      if (!list.length) wrap.append(MP.empty('file', tab === 'archived' ? 'آرشیو خالی است' : 'هنوز فاکتوری نیست', tab === 'archived' ? null : 'برای مشتری پیش‌فاکتور یا فاکتور بسازید و لینکش را بفرستید؛ پرداخت‌شده‌ها خودکار در حسابداری ثبت می‌شوند.', null, true));
      list.forEach(function (x) { wrap.append(card(x)); });
      body.replaceChildren(head, tabs, wrap);
      if (openId) { var f = d.items.filter(function (x) { return x.id === +openId; })[0]; if (f) editor(f); }
    }).catch(MP.soft);
  };

  function card(x) {
    return el('article', { class: 'inv-card' + (x.status === 'paid' ? ' paid' : '') },
      el('div', { class: 'inv-main', onclick: function () { editor(x); } },
        el('div', { class: 'inv-top' },
          el('span', { class: 'chip ' + (x.kind === 'proforma' ? 'info' : 'brand'), text: kindName(x) }),
          el('strong', { text: x.client_name }),
          el('small', { class: 'muted', text: x.number })),
        el('small', { class: 'muted', text: [x.title, x.project, J.format(x.issue_date)].filter(Boolean).join(' · ') })),
      el('div', { class: 'inv-side' },
        el('strong', { class: 'inv-total', text: money(x.total) }),
        el('span', { class: 'chip ' + TONE[x.status], text: STATUS[x.status] + (x.status === 'paid' && x.pay_gateway ? ' · آنلاین' : '') })),
      el('div', { class: 'inv-actions' },
        el('button', { type: 'button', class: 'icon-btn sm', title: 'دیدن لینک مشتری', 'aria-label': 'دیدن', html: icon('eye'), onclick: function () { window.open(x.url, '_blank', 'noopener'); } }),
        x.archived ? null : el('button', { type: 'button', class: 'icon-btn sm', title: 'ارسال برای مشتری', 'aria-label': 'ارسال', html: icon('send'), onclick: function () { sendDialog(x); } }),
        x.archived ? null : x.kind === 'invoice' ? el('button', { type: 'button', class: 'btn btn-sm ' + (x.status === 'paid' ? 'btn-ghost' : 'btn-secondary'), html: icon('checks') + (x.status === 'paid' ? 'پرداخت‌نشده' : 'پرداخت شد'), onclick: function () { setStatus(x, x.status === 'paid' ? 'sent' : 'paid'); } })
          : el('button', { type: 'button', class: 'btn btn-secondary btn-sm', html: icon('repeat') + 'تبدیل به فاکتور', onclick: function () { convert(x); } })));
  }

  function setStatus(x, status) {
    MP.api('invoices/' + x.id + '/status', { method: 'POST', body: { status: status } }).then(function () {
      MP.toast(status === 'paid' ? 'پرداخت ثبت شد و به حسابداری اضافه شد' : status === 'sent' && x.status === 'paid' ? 'پرداخت برداشته شد و از حسابداری حذف شد' : 'وضعیت: ' + STATUS[status], { icon: 'checks' });
      MP.emit('ledger'); MP.invoices();
    }).catch(MP.soft);
  }
  function convert(x) {
    MP.api('invoices/' + x.id + '/convert', { method: 'POST' }).then(function (n) { MP.toast('فاکتور ' + n.number + ' ساخته شد'); tab = 'all'; MP.invoices(n.id); }).catch(MP.soft);
  }

  /* ------------------------------------------------------------ Send */

  function sendDialog(x) {
    var input = el('input', { class: 'input', value: x.url, readonly: true, dir: 'ltr', onfocus: function (e) { e.target.select(); } });
    function mark() { return MP.api('invoices/' + x.id + '/send', { method: 'POST', body: {} }); }
    var box = el('div', { class: 'form' },
      el('p', { text: kindName(x) + ' ' + x.number + ' برای ' + x.client_name + ' · ' + money(x.total) }),
      MP.field('لینک مشتری', input, 'مشتری بدون ورود به سایت فاکتور را می‌بیند، چاپ یا PDF می‌گیرد و ' + (x.kind === 'proforma' ? 'پیش‌فاکتور را تأیید می‌کند.' : 'پرداخت می‌کند.')),
      el('div', { class: 'dialog-actions' },
        el('button', { type: 'button', class: 'btn btn-primary', text: 'کپی لینک', onclick: function () {
          (navigator.clipboard ? navigator.clipboard.writeText(x.url) : Promise.reject()).then(function () { MP.toast('لینک کپی شد'); }, function () { input.select(); document.execCommand('copy'); MP.toast('لینک کپی شد'); });
          mark();
        } }),
        navigator.share ? el('button', { type: 'button', class: 'btn btn-secondary', text: 'اشتراک‌گذاری', onclick: function () { navigator.share({ title: kindName(x) + ' ' + x.number, url: x.url }).then(mark).catch(function () {}); } }) : null));
    if (x.channels.length) {
      box.append(el('div', { class: 'field' }, el('span', { text: 'ارسال در گروه مشتری' }),
        el('div', { class: 'inv-channels' }, x.channels.map(function (c) {
          return el('button', { type: 'button', class: 'btn btn-secondary btn-sm', html: icon('chat') + c.title, onclick: function () {
            MP.api('invoices/' + x.id + '/send', { method: 'POST', body: { channel_id: c.id } }).then(function () { MP.toast('در گروه «' + c.title + '» ارسال شد'); MP.invoices(); }).catch(MP.soft);
          } });
        }))));
    } else if (x.project_id) box.append(el('p', { class: 'hint', text: 'این پروژه گروه مشتری ندارد؛ از «پیام‌ها ← گروه مشتری» بسازید تا فاکتور را مستقیم آنجا بفرستید.' }));
    MP.dialog.open('ارسال برای مشتری', box);
  }

  /* ------------------------------------------------------------ Editor */

  function editor(x) {
    var isNew = !x.id;
    var f = el('form', { class: 'form inv-form' });
    var rows = el('div', { class: 'inv-rows' });
    var totals = el('div', { class: 'inv-totals' });
    function addRow(it) {
      it = it || { title: '', qty: 1, price: 0 };
      var r = el('div', { class: 'inv-row' },
        el('input', { class: 'r-title', placeholder: 'شرح (مثلاً طراحی صفحه اصلی)', maxlength: 200, value: it.title }),
        el('input', { class: 'r-qty', inputmode: 'decimal', dir: 'ltr', value: J.faDigits(it.qty), 'aria-label': 'تعداد' }),
        moneyInput('price', it.price, 'مبلغ واحد'),
        el('span', { class: 'r-total' }),
        el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'حذف ردیف', html: icon('close'), onclick: function () { r.remove(); calc(); } }));
      $('.r-qty', r).addEventListener('input', calc);
      $('.r-title', r).addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addRow(); $$last(); } });
      rows.append(r);
      calc();
    }
    function $$last() { var l = rows.querySelectorAll('.r-title'); if (l.length) l[l.length - 1].focus(); }
    function items() {
      return Array.prototype.map.call(rows.children, function (r) { return { title: $('.r-title', r).value.trim(), qty: num($('.r-qty', r).value) || 0, price: num($('[name=price]', r).value) }; });
    }
    function calc() {
      var sub = 0;
      Array.prototype.forEach.call(rows.children, function (r) {
        var t = Math.round((num($('.r-qty', r).value) || 0) * num($('[name=price]', r).value)); sub += t;
        $('.r-total', r).textContent = t ? J.faDigits(t.toLocaleString('en-US')) : '—';
      });
      var disc = Math.min(sub, num(f.elements.discount && f.elements.discount.value)), tax = num(f.elements.tax && f.elements.tax.value), vat = Math.round((sub - disc) * tax / 100);
      totals.replaceChildren(
        el('div', null, el('span', { text: 'جمع' }), el('b', { text: money(sub) })),
        disc ? el('div', null, el('span', { text: 'تخفیف' }), el('b', { text: '− ' + money(disc) })) : null,
        tax ? el('div', null, el('span', { text: 'مالیات ' + fa(tax) + '٪' }), el('b', { text: money(vat) })) : null,
        el('div', { class: 'grand' }, el('span', { text: 'قابل پرداخت' }), el('b', { text: money(sub - disc + vat) })));
    }
    f.addEventListener('recalc', calc);
    var proj = MP.projectSelect('project_id', x.project_id || (isNew ? 0 : S.projectId) || 0);
    // Customer: pick one already known, or type a new one right here (saved as a customer on save).
    var custSel = el('select', { name: 'client_id', class: 'select' }, el('option', { value: '', text: 'در حال بارگذاری مشتری‌ها…' }));
    var newName = el('input', { name: 'client_name', maxlength: 160, value: x.client_id ? '' : x.client_name || '', placeholder: 'نام مشتری جدید (شخص یا شرکت)' });
    var newWrap = MP.field('نام مشتری جدید', newName, 'با ذخیره فاکتور، این مشتری ساخته و به پروژه وصل می‌شود.');
    var customers = [];
    function custChanged() {
      var v = custSel.value, c = customers.filter(function (q) { return String(q.id) === v; })[0];
      newWrap.hidden = v !== 'new'; newName.required = v === 'new';
      if (v === 'new') { setTimeout(function () { newName.focus(); }, 30); return; }
      if (!c) return;
      if (!f.elements.client_phone.value) f.elements.client_phone.value = c.phone || '';
      if (!f.elements.client_info.value) f.elements.client_info.value = c.info || '';
      // Its projects come first in the project list; with just one, it is picked.
      var mine = c.projects.filter(function (id) { return MP.project(id); });
      Array.prototype.forEach.call(proj.options, function (o) { o.textContent = o.textContent.replace(/^★ /, ''); if (mine.indexOf(+o.value) >= 0) o.textContent = '★ ' + o.textContent; });
      if (!+proj.value && mine.length === 1) proj.value = mine[0];
    }
    custSel.onchange = custChanged;
    MP.api('customers').then(function (list) {
      customers = list;
      custSel.replaceChildren(el('option', { value: '', text: '— انتخاب مشتری —' }),
        list.map(function (c) { return el('option', { value: c.id, text: c.name + (c.phone ? ' · ' + J.faDigits(c.phone) : '') }); }),
        el('option', { value: 'new', text: '＋ مشتری جدید…' }));
      custSel.value = x.client_id ? String(x.client_id) : x.client_name ? 'new' : '';
      if (!custSel.value) custSel.value = '';
      custChanged();
    }).catch(function () { custSel.replaceChildren(el('option', { value: 'new', text: '＋ مشتری جدید…' })); custChanged(); });
    newWrap.hidden = true;
    f.append(
      el('div', { class: 'row' },
        MP.field('مشتری', custSel),
        MP.field('پروژه', proj)),
      newWrap,
      el('div', { class: 'row' },
        MP.field('تلفن مشتری', el('input', { name: 'client_phone', maxlength: 40, dir: 'ltr', value: x.client_phone || '' })),
        MP.field('عنوان', el('input', { name: 'title', maxlength: 200, value: x.title || '', placeholder: 'مثلاً طراحی و توسعه سایت' }))),
      MP.field('اطلاعات خریدار (اختیاری)', el('textarea', { name: 'client_info', rows: 2, maxlength: 1000, placeholder: 'نشانی، کد اقتصادی، …' }, x.client_info || '')),
      el('div', { class: 'field' }, el('span', { text: 'ردیف‌ها' }),
        el('div', { class: 'inv-row inv-row-head' }, el('small', { text: 'شرح' }), el('small', { text: 'تعداد' }), el('small', { text: 'مبلغ واحد (تومان)' }), el('small', { text: 'جمع' }), el('span')),
        rows,
        el('button', { type: 'button', class: 'chip-btn', html: icon('plus') + ' ردیف', onclick: function () { addRow(); $$last(); } })),
      el('div', { class: 'row' },
        MP.field('تخفیف (تومان)', moneyInput('discount', x.discount)),
        MP.field('مالیات (٪)', el('input', { name: 'tax', inputmode: 'numeric', dir: 'ltr', maxlength: 3, value: J.faDigits(isNew ? (settings ? settings.tax : 0) : x.tax), oninput: calc }))),
      totals,
      el('div', { class: 'row' },
        MP.dateField('issue_date', x.issue_date || S.today, 'تاریخ صدور'),
        x.kind === 'invoice' ? MP.dateField('due_date', x.due_date || J.addDays(S.today, 7), 'مهلت پرداخت') : el('span')),
      x.kind === 'invoice' ? MP.field('لینک پرداخت (اختیاری)', el('input', { name: 'pay_url', dir: 'ltr', maxlength: 500, value: x.pay_url || '', placeholder: settings && settings.pay_url ? settings.pay_url : 'https://zarinp.al/…' }), 'خالی بماند، لینک پیش‌فرض تنظیمات استفاده می‌شود.') : null,
      MP.field('توضیحات برای مشتری', el('textarea', { name: 'note', rows: 2, maxlength: 2000, placeholder: 'شرایط پرداخت، زمان تحویل، …' }, x.note || '')),
      MP.actions(isNew ? 'ساخت ' + kindName(x) : 'ذخیره', isNew ? null : el('span', { class: 'inv-edit-extra' },
        x.archived ? el('button', { type: 'button', class: 'btn btn-secondary', text: 'بازگرداندن از آرشیو', onclick: function () { MP.api('invoices/' + x.id, { method: 'DELETE', query: { restore: 1 } }).then(function () { tab = 'all'; MP.invoices(); }).catch(MP.soft); } })
          : el('button', { type: 'button', class: 'btn btn-ghost', text: 'آرشیو', onclick: function () { MP.api('invoices/' + x.id, { method: 'DELETE' }).then(function () { MP.toast('آرشیو شد'); MP.invoices(); }).catch(MP.soft); } }),
        x.status !== 'cancelled' && !x.archived ? el('button', { type: 'button', class: 'btn btn-ghost', text: 'لغو', onclick: function () { setStatus(x, 'cancelled'); } }) : null)));
    (x.items && x.items.length ? x.items : [null]).forEach(addRow);
    f.onsubmit = function (e) {
      e.preventDefault();
      if (!custSel.value) { MP.toast('مشتری را انتخاب کنید یا «مشتری جدید» را بزنید.', { error: true }); custSel.focus(); return; }
      var v = f.elements, body = {
        kind: x.kind, client_id: /^\d+$/.test(custSel.value) ? +custSel.value : 0, client_name: custSel.value === 'new' ? newName.value : '', project_id: +v.project_id.value, client_phone: v.client_phone.value, title: v.title.value,
        client_info: v.client_info.value, items: items(), discount: num(v.discount.value), tax: num(v.tax.value), issue_date: v.issue_date.value,
        due_date: v.due_date ? v.due_date.value : '', pay_url: v.pay_url ? v.pay_url.value.trim() : '', note: v.note.value
      };
      MP.busy(f, true);
      MP.api(isNew ? 'invoices' : 'invoices/' + x.id, { method: 'POST', body: body }).then(function (saved) {
        MP.toast(kindName(saved) + ' ' + saved.number + ' ذخیره شد');
        if (isNew) sendDialog(saved); else MP.invoices();
      }).catch(function (err) { MP.busy(f, false); MP.soft(err); });
    };
    MP.dialog.open(isNew ? kindName(x) + ' جدید' : kindName(x) + ' ' + x.number, f, { wide: true });
  }

  /** New invoice or pro-forma from anywhere (portal dialog, clients page): {kind, project_id, client_id}. */
  MP.newInvoice = function (o) {
    var go = function () { editor({ kind: o.kind || 'invoice', project_id: o.project_id || 0, client_id: o.client_id || 0, client_name: o.client_name || '' }); };
    if (settings) go(); else MP.api('invoices', { query: { client_id: -1 } }).then(function (d) { settings = d.settings; go(); }).catch(go);
  };

  /* ------------------------------------------------------------ Settings */

  function settingsForm() {
    var s = settings || {};
    var f = el('form', { class: 'form' },
      MP.field('نام فروشنده', el('input', { name: 'seller', maxlength: 160, value: s.seller || '' })),
      MP.field('اطلاعات فروشنده', el('textarea', { name: 'seller_info', rows: 2, maxlength: 1000, placeholder: 'نشانی، تلفن، شناسه ملی، …' }, s.seller_info || '')),
      MP.field('لینک پرداخت پیش‌فرض', el('input', { name: 'pay_url', dir: 'ltr', value: s.pay_url || '', placeholder: 'https://zarinp.al/moraba' }), 'مثلاً لینک پرداخت زرین‌پال/آیدی‌پی؛ روی دکمه «پرداخت» فاکتورها قرار می‌گیرد.'),
      el('fieldset', { class: 'inv-gw' }, el('legend', { text: 'پرداخت آنلاین' }),
        el('div', { class: 'row' },
          MP.field('درگاه', MP.select('gateway', [['', 'خاموش (فقط لینک/کارت)'], ['zibal', 'زیبال'], ['zarinpal', 'زرین‌پال']], s.gateway || '')),
          MP.field('کد مرچنت', el('input', { name: 'merchant', dir: 'ltr', value: s.merchant || '', placeholder: 'xxxxxxxx-xxxx-…' }))),
        el('label', { class: 'check' }, el('input', { type: 'checkbox', name: 'sandbox', checked: !!s.sandbox }), el('span', { text: 'حالت آزمایشی (بدون پول واقعی، برای تست درگاه)' })),
        el('p', { class: 'hint', text: 'روشن باشد، روی هر فاکتور دکمه «پرداخت آنلاین» می‌آید؛ بعد از پرداخت موفق، فاکتور خودکار «پرداخت‌شده» می‌شود، در حسابداری ثبت می‌شود و در گفت‌وگوی مشتری پیام می‌رود. مبلغ‌ها به تومان‌اند و به ریال به درگاه فرستاده می‌شوند.' })),
      el('div', { class: 'row' },
        MP.field('شماره کارت (کارت به کارت)', el('input', { name: 'card', dir: 'ltr', value: s.card || '', placeholder: '6037-…' })),
        MP.field('به نام', el('input', { name: 'card_owner', value: s.card_owner || '' }))),
      el('div', { class: 'row' },
        MP.field('مالیات پیش‌فرض (٪)', el('input', { name: 'tax', inputmode: 'numeric', dir: 'ltr', value: J.faDigits(s.tax || 0) })),
        MP.field('متن پایین فاکتور', el('input', { name: 'footer', maxlength: 300, value: s.footer || '' }))),
      MP.actions('ذخیره تنظیمات'));
    f.onsubmit = function (e) {
      e.preventDefault(); MP.busy(f, true);
      var v = f.elements;
      MP.api('invoices/settings', { method: 'POST', body: { seller: v.seller.value, seller_info: v.seller_info.value, pay_url: v.pay_url.value.trim(), card: v.card.value, card_owner: v.card_owner.value, tax: num(v.tax.value), footer: v.footer.value, gateway: v.gateway.value, merchant: v.merchant.value.trim(), sandbox: v.sandbox.checked } })
        .then(function (n) { settings = n; MP.toast('تنظیمات فاکتور ذخیره شد'); MP.invoices(); }).catch(function (err) { MP.busy(f, false); MP.soft(err); });
    };
    MP.dialog.open('تنظیمات فاکتور', f);
  }
})();
