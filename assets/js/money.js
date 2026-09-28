/* Accounting: record income/expense with category, project and receipt; balance, month browser,
   six-month chart, category breakdown, Excel and PDF export. Visible to every role. */
(function () {
  'use strict';
  var MP = window.MP, S = MP.S, J = MP.J, el = MP.el, $ = MP.$, $$ = MP.$$, fa = MP.fa, icon = MP.icon;
  var view = null, data = null, summary = null, filter = { type: 'all', category: '', project: 0 }, receipt = null;

  function range() { var f = J.toIso(view.jy, view.jm, 1); return { from: f, to: J.addDays(f, J.monthLength(view.jy, view.jm) - 1) }; }
  function parseAmount(v) { return parseInt(J.latinDigits(v).replace(/\D/g, ''), 10) || 0; }
  function nowTime() { return S.now || new Date().toTimeString().slice(0, 5); }

  function layout() {
    var body = $('#acc-body');
    body.replaceChildren(
      el('section', { class: 'acc-hero' },
        el('div', { class: 'acc-hero-main' },
          el('small', { html: icon('wallet') + ' موجودی فعلی' }),
          el('strong', { id: 'acc-balance', class: 'num' }, el('span', { class: 'sk sk-text' })),
          el('span', { class: 'acc-hero-unit', text: 'تومان' }),
          el('span', { class: 'acc-net', id: 'acc-net' })),
        el('div', { class: 'acc-hero-stats' },
          el('div', { class: 'acc-stat in' }, el('span', { class: 'acc-stat-ico', html: icon('arrow-down') }), el('div', null, el('small', { text: 'دخل این ماه' }), el('strong', { id: 'acc-in', class: 'num' }, '…'), el('span', { id: 'acc-in-sub' }))),
          el('div', { class: 'acc-stat out' }, el('span', { class: 'acc-stat-ico', html: icon('arrow-up') }), el('div', null, el('small', { text: 'خرج این ماه' }), el('strong', { id: 'acc-out', class: 'num' }, '…'), el('span', { id: 'acc-out-sub' }))),
          el('div', { class: 'acc-ratio', title: 'نسبت دخل به خرج این ماه' }, el('i', { class: 'in', id: 'acc-ratio-in' }), el('i', { class: 'out', id: 'acc-ratio-out' })))),
      el('div', { class: 'acc-layout' },
        el('div', { class: 'acc-side' },
          el('section', { class: 'card pad', id: 'acc-form-card' }),
          el('section', { class: 'card pad' }, el('h2', { class: 'card-title', text: 'شش ماه اخیر' }), el('div', { id: 'acc-chart' }, el('span', { class: 'sk sk-block' }))),
          el('section', { class: 'card pad' }, el('h2', { class: 'card-title', text: 'به تفکیک دسته' }), el('div', { id: 'acc-cats' }))),
        el('section', { class: 'card pad' },
          el('div', { class: 'acc-list-head' },
            el('div', { class: 'acc-month' },
              el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'ماه قبل', html: icon('right'), onclick: function () { step(-1); } }),
              el('span', { id: 'acc-month-title' }),
              el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'ماه بعد', html: icon('left'), onclick: function () { step(1); } })),
            el('div', { class: 'seg sm', role: 'tablist', id: 'acc-type' },
              el('button', { type: 'button', role: 'tab', 'aria-selected': 'true', dataset: { t: 'all' }, text: 'همه' }),
              el('button', { type: 'button', role: 'tab', 'aria-selected': 'false', dataset: { t: 'income' }, text: 'دخل' }),
              el('button', { type: 'button', role: 'tab', 'aria-selected': 'false', dataset: { t: 'expense' }, text: 'خرج' }))),
          el('div', { class: 'toolbar', style: { marginBottom: '10px' } },
            el('select', { class: 'select sm', id: 'acc-cat-filter', 'aria-label': 'دسته' }),
            el('select', { class: 'select sm', id: 'acc-proj-filter', 'aria-label': 'پروژه' }),
            el('span', { class: 'toolbar-count', id: 'acc-opening' })),
          el('div', { id: 'acc-list' }, MP.skeleton(5)))));
    $$('#acc-type button').forEach(function (b) {
      b.onclick = function () { filter.type = b.dataset.t; $$('#acc-type button').forEach(function (x) { x.setAttribute('aria-selected', String(x === b)); }); renderList(); };
    });
    $('#acc-cat-filter').onchange = function (e) { filter.category = e.target.value; load(); };
    $('#acc-proj-filter').onchange = function (e) { filter.project = +e.target.value; load(); };
    form();
  }

  function form() {
    receipt = null;
    var cats = el('datalist', { id: 'acc-cats-list' });
    ((summary && summary.categories) || []).forEach(function (c) { cats.append(el('option', { value: c })); });
    var amount = el('input', { name: 'amount', required: true, inputmode: 'numeric', autocomplete: 'off', class: 'amount-input', dir: 'ltr', placeholder: '۰' });
    var words = el('div', { class: 'amount-words' });
    amount.addEventListener('input', function () {
      var n = parseAmount(amount.value);
      amount.value = n ? n.toLocaleString('fa-IR') : '';
      words.textContent = n >= 1000 ? MP.money(n * 10) + ' ریال' : '';
      amount.setCustomValidity('');
    });
    var amountWrap = el('div', { class: 'amount-wrap' }, amount, el('span', { class: 'amount-unit', text: 'تومان' }));
    var quick = el('div', { class: 'amount-quick' }, [[50000, '۵۰ هزار'], [100000, '۱۰۰ هزار'], [500000, '۵۰۰ هزار'], [1000000, '۱ میلیون']].map(function (q) {
      return el('button', { type: 'button', class: 'chip-btn', text: '+' + q[1], onclick: function () { amount.value = String(parseAmount(amount.value) + q[0]); amount.dispatchEvent(new Event('input')); } });
    }));
    var attach = el('div');
    function drawAttach() {
      attach.replaceChildren(receipt ? el('div', { class: 'composer-attach' }, MP.fileChip(receipt), el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'حذف رسید', html: icon('close'), onclick: function () { receipt = null; drawAttach(); } }))
        : MP.dropzone('عکس رسید یا فاکتور (اختیاری)', function (file) {
          attach.replaceChildren(el('div', { class: 'upload-progress' }, el('i')));
          MP.upload('files', file, { context: 'ledger', context_id: 0 }, function (p) { var i = $('i', attach); if (i) i.style.width = p * 100 + '%'; })
            .then(function (f) { receipt = f; drawAttach(); }).catch(function (err) { drawAttach(); MP.soft(err); });
        }, 'image/*,application/pdf'));
    }
    drawAttach();
    var smart = MP.smartBar({
      placeholder: 'بگویید یا بنویسید…',
      examples: ['مثلاً: «۱۳۰ تومن برای افزونه برای پروژه زیوا»', 'مثلاً: «دو میلیون پیش‌پرداخت گرفتیم از زیوا»', 'مثلاً: «۴۵۰ هزار تومان ناهار تیم دیروز»', 'مثلاً: «۱.۵ میلیون اجاره دفتر»'],
      parse: function (t) { return MP.Voice.parseMoney(t, { today: S.today, J: J, projects: S.projects, categories: (summary && summary.categories) || [] }); },
      apply: function (r) {
        var x = f.elements;
        function put(input, v) { if (v === undefined || v === null || v === '') return; input.value = v; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); var w = input.closest('.field') || input; w.classList.remove('filled'); void w.offsetWidth; w.classList.add('filled'); }
        f.querySelector('[name=type][value=' + r.type + ']').checked = true;
        if (r.amount) put(x.amount, String(r.amount));
        put(x.title, r.title); put(x.category, r.category);
        if (r.project_id) put(x.project_id, String(r.project_id));
        if (r.date) { MP.setDate ? MP.setDate(x.date, r.date) : put(x.date, r.date); }
        put(x.time, r.time);
      },
      describe: function (r) {
        var p = r.project_id && MP.project(r.project_id), out = [[r.type === 'income' ? 'دخل' : 'خرج', r.type === 'income' ? 'in' : 'out']];
        if (r.amount) out.push([MP.money(r.amount) + ' تومان']);
        if (r.title) out.push(['بابت: ' + r.title]);
        if (p) out.push(['پروژه: ' + p.name]);
        if (r.category) out.push(['دسته: ' + r.category]);
        if (r.date && r.date !== S.today) out.push([J.format(r.date)]);
        if (r.time) out.push(['ساعت ' + MP.timeFa(r.time)]);
        if (!r.amount) out.push(['مبلغ را نفهمیدم؛ دستی وارد کنید', 'warn']);
        return out;
      }
    });
    var f = el('form', { class: 'form' },
      el('div', { class: 'acc-form-head' }, el('h2', { class: 'card-title', text: 'ثبت دخل یا خرج' }), el('span', { class: 'chip brand', html: icon('mic') + ' با صدا' })),
      smart,
      el('div', { class: 'seg money', role: 'radiogroup', style: { display: 'grid', gridTemplateColumns: '1fr 1fr' } },
        el('label', null, el('input', { type: 'radio', name: 'type', value: 'income', class: 'in', checked: true }), el('span', { text: '+ دخل' })),
        el('label', null, el('input', { type: 'radio', name: 'type', value: 'expense', class: 'out' }), el('span', { text: '− خرج' }))),
      MP.field('مبلغ', amountWrap), quick, words,
      MP.field('بابت', el('input', { name: 'title', required: true, maxlength: 200, placeholder: 'مثلاً پیش‌پرداخت پروژه زیوا' })),
      el('div', { class: 'row' },
        MP.field('دسته', el('input', { name: 'category', maxlength: 60, list: 'acc-cats-list', placeholder: 'مثلاً حقوق، اجاره، پروژه' })),
        MP.field('پروژه', MP.projectSelect('project_id', 0))),
      cats,
      el('div', { class: 'row' }, MP.dateField('date', S.today, 'تاریخ'), MP.field('ساعت', el('input', { name: 'time', type: 'time', required: true, value: nowTime() }))),
      MP.field('توضیحات', el('textarea', { name: 'note', maxlength: 1000, rows: 2, placeholder: 'اختیاری' })),
      attach,
      el('button', { type: 'submit', class: 'btn btn-primary btn-block', text: 'ثبت' }));
    f.onsubmit = function (e) {
      e.preventDefault();
      var x = f.elements, n = parseAmount(x.amount.value);
      if (!n) { x.amount.setCustomValidity('مبلغ را وارد کنید'); x.amount.reportValidity(); return; }
      var j = J.fromIso(x.date.value); view = { jy: j.jy, jm: j.jm };
      var r = range();
      MP.busy(f, true);
      MP.api('ledger', { method: 'POST', body: {
        type: f.querySelector('[name=type]:checked').value, amount: n, title: x.title.value.trim(), category: x.category.value.trim(), project_id: +x.project_id.value,
        date: x.date.value, time: x.time.value, note: x.note.value, file_id: receipt ? receipt.id : 0,
        from: r.from, to: r.to, filter_category: filter.category, filter_project: filter.project
      } }).then(function (d) {
        MP.toast((f.querySelector('[name=type]:checked').value === 'income' ? 'دخل ' : 'خرج ') + MP.money(n) + ' تومان ثبت شد');
        MP.lastLedger = d.items[0] ? d.items[0].id : 0;
        apply(d); form(); loadSummary(); MP.audit();
      }).catch(function (err) { MP.busy(f, false); MP.soft(err); });
    };
    $('#acc-form-card').replaceChildren(f);
  }

  function load() {
    var r = range();
    $('#acc-month-title').textContent = J.months[view.jm - 1] + ' ' + fa(view.jy);
    return MP.api('ledger', { query: { from: r.from, to: r.to, category: filter.category, project_id: filter.project || '' } }).then(apply).catch(MP.soft);
  }
  function loadSummary() {
    return MP.api('ledger/summary').then(function (s) { summary = s; renderChart(); fillFilters(); var dl = $('#acc-cats-list'); if (dl) { dl.replaceChildren(); s.categories.forEach(function (c) { dl.append(el('option', { value: c })); }); } }).catch(function () {});
  }
  function fillFilters() {
    var c = $('#acc-cat-filter'), p = $('#acc-proj-filter');
    c.replaceChildren(el('option', { value: '', text: 'همه دسته‌ها' }));
    (summary ? summary.categories : []).forEach(function (x) { c.append(el('option', { value: x, text: x })); });
    c.value = filter.category;
    p.replaceChildren(el('option', { value: 0, text: 'همه پروژه‌ها' }));
    S.projects.forEach(function (x) { p.append(el('option', { value: x.id, text: x.name })); });
    p.value = filter.project;
  }
  function apply(d) {
    data = d;
    var bal = $('#acc-balance');
    bal.textContent = MP.money(d.balance); bal.classList.toggle('neg', d.balance < 0);
    $('#acc-in').textContent = MP.money(d.income);
    $('#acc-out').textContent = MP.money(d.expense);
    var net = d.income - d.expense;
    $('#acc-in-sub').textContent = fa(d.items.filter(function (x) { return x.type === 'income'; }).length) + ' ردیف';
    $('#acc-out-sub').textContent = fa(d.items.filter(function (x) { return x.type === 'expense'; }).length) + ' ردیف';
    var netEl = $('#acc-net'); netEl.textContent = (net >= 0 ? '+' : '−') + MP.money(Math.abs(net)) + ' خالص این ماه'; netEl.className = 'acc-net ' + (net >= 0 ? 'pos' : 'neg');
    var tot = d.income + d.expense;
    $('#acc-ratio-in').style.width = (tot ? d.income / tot * 100 : 50) + '%';
    $('#acc-ratio-out').style.width = (tot ? d.expense / tot * 100 : 50) + '%';
    $('#acc-opening').textContent = 'مانده ابتدای ماه: ' + MP.money(d.opening) + ' تومان';
    renderList(); renderCats();
  }
  function renderList() {
    var box = $('#acc-list'); box.replaceChildren();
    var items = data.items.filter(function (x) { return filter.type === 'all' || x.type === filter.type; });
    if (!items.length) { box.append(MP.empty('wallet', 'ردیفی در این ماه نیست', 'اولین دخل یا خرج این ماه را ثبت کنید.', null, true)); return; }
    var last = '', dayNet = {};
    items.forEach(function (x) { dayNet[x.date] = (dayNet[x.date] || 0) + (x.type === 'income' ? x.amount : -x.amount); });
    items.forEach(function (x) {
      if (x.date !== last) {
        last = x.date; var dn = dayNet[x.date];
        box.append(el('div', { class: 'acc-day' }, el('span', { text: x.date === S.today ? 'امروز' : J.formatLong(x.date) }), el('span', { class: 'num ' + (dn >= 0 ? 'pos' : 'neg'), text: (dn >= 0 ? '+' : '−') + MP.money(Math.abs(dn)) })));
      }
      var p = MP.project(x.project_id);
      var row = el('div', { class: 'acc-row ' + (x.type === 'income' ? 'in' : 'out') + (x.id === MP.lastLedger ? ' rise' : '') },
        x.category ? el('span', { class: 'acc-type', text: x.category.trim().charAt(0) }) : el('span', { class: 'acc-type', html: icon(x.type === 'income' ? 'arrow-down' : 'arrow-up') }),
        el('div', { class: 'row-main', style: { cursor: 'default' } },
          el('span', { class: 'row-title' }, el('span', { text: x.title })),
          el('span', { class: 'row-meta' },
            el('span', { text: MP.timeFa(x.time) + ' · ' + x.author }),
            x.category ? el('span', { class: 'chip', text: x.category }) : null,
            p ? el('span', { class: 'chip brand', text: p.name }) : null,
            x.note ? el('span', { text: x.note }) : null,
            x.file ? el('button', { type: 'button', class: 'link', html: icon('clip') + ' رسید', onclick: function () { if (x.file.image) MP.lightbox(x.file); else window.open(x.file.url, '_blank', 'noopener'); } }) : null)),
        el('div', { class: 'acc-amt' }, el('strong', { class: 'num', text: (x.type === 'income' ? '+' : '−') + MP.money(x.amount) }), el('small', { text: 'مانده: ' + MP.money(x.balance) })),
        x.can_delete ? el('button', { type: 'button', class: 'icon-btn sm danger', 'aria-label': 'حذف ' + x.title, html: icon('trash'), onclick: function () { remove(x); } }) : null);
      box.append(row);
    });
  }
  function remove(x) {
    MP.confirm('حذف ردیف', '«' + x.title + '» به مبلغ ' + MP.money(x.amount) + ' تومان حذف شود؟ این کار در تاریخچه تغییرات ثبت می‌شود.', 'حذف').then(function (ok) {
      if (!ok) return;
      var r = range();
      MP.api('ledger/' + x.id, { method: 'DELETE', query: { from: r.from, to: r.to, filter_category: filter.category, filter_project: filter.project } })
        .then(function (d) { apply(d); loadSummary(); MP.toast('ردیف حذف شد'); MP.audit(); }).catch(MP.soft);
    });
  }
  function renderCats() {
    var box = $('#acc-cats'); if (!box) return;
    box.replaceChildren();
    if (!data.categories.length) { box.append(el('p', { class: 'hint', text: 'با دسته‌بندی ردیف‌ها، اینجا سهم هر دسته را می‌بینید.' })); return; }
    var max = Math.max.apply(null, data.categories.map(function (c) { return c.amount; }));
    data.categories.slice(0, 8).forEach(function (c) {
      var bar = el('i'); bar.style.width = c.amount / max * 100 + '%';
      box.append(el('div', { class: 'cat-row ' + (c.type === 'income' ? 'in' : 'out') }, el('span', { text: (c.type === 'income' ? '+ ' : '− ') + c.category }), el('div', { class: 'bar' }, bar), el('span', { class: 'num', text: MP.money(c.amount) })));
    });
  }
  function renderChart() {
    var box = $('#acc-chart'); if (!box || !summary) return;
    var max = Math.max.apply(null, summary.months.map(function (m) { return Math.max(m.income, m.expense); }).concat([1]));
    var bars = el('div', { class: 'bars', role: 'img', 'aria-label': 'دخل و خرج شش ماه اخیر' });
    summary.months.forEach(function (m) {
      bars.append(el('div', { class: 'b-col', title: m.label + ' — دخل: ' + MP.money(m.income) + ' · خرج: ' + MP.money(m.expense) },
        el('div', { class: 'b-pair' }, el('i', { class: 'b-in', style: { height: m.income / max * 100 + '%' } }), el('i', { class: 'b-out', style: { height: m.expense / max * 100 + '%' } })),
        el('small', { text: m.label.split(' ')[0] })));
    });
    box.replaceChildren(bars, el('div', { class: 'legend', style: { marginTop: '8px' } }, el('span', null, el('i', { class: 'lg', style: { background: 'var(--ok)' } }), 'دخل'), el('span', null, el('i', { class: 'lg', style: { background: 'var(--danger)' } }), 'خرج')));
  }
  function step(n) { view.jm += n; if (view.jm < 1) { view.jm = 12; view.jy--; } if (view.jm > 12) { view.jm = 1; view.jy++; } load(); }
  function exportUrl(format) { var r = range(); return MP.C.export + '&format=' + format + '&from=' + r.from + '&to=' + r.to; }
  $('#acc-xlsx').onclick = function () { location.href = exportUrl('xlsx'); };
  $('#acc-print').onclick = function () { window.open(exportUrl('print'), '_blank', 'noopener'); };

  MP.view('accounting', {
    open: function () {
      if (!view) { var j = J.fromIso(S.today); view = { jy: j.jy, jm: j.jm }; }
      layout(); load(); loadSummary();
    }
  });
})();
