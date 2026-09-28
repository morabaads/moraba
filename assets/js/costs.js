/* Real time and project cost: per-task time entries (timer + manual) and the supervisors' cost report. */
(function () {
  'use strict';
  var MP = window.MP, S = MP.S, J = MP.J, el = MP.el, $ = MP.$, fa = MP.fa, icon = MP.icon;
  var toman = function (n) { return MP.money(Math.round(n)) + ' تومان'; };
  var SRC = { timer: 'تایمر', manual: 'دستی', legacy: 'تایمر' };

  function faToLatin(v) { return String(v || '').replace(/[۰-۹]/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'.indexOf(d); }).replace(/[٠-٩]/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(d); }); }
  function numInput(name, value, label, max) {
    var i = el('input', { name: name, inputmode: 'numeric', maxlength: 3, value: value ? fa(value) : '', placeholder: '۰', 'aria-label': label, class: 'num-mini' });
    i.oninput = function () { var n = faToLatin(i.value).replace(/\D/g, ''); i.value = n === '' ? '' : fa(Math.min(max, +n)); };
    return i;
  }
  function numVal(i) { return +faToLatin(i.value).replace(/\D/g, '') || 0; }

  /* ------------------------------------------------ Task detail: time entries */

  MP.timeLog = function (t, mine, changed) {
    var list = el('div', { class: 'tl-list' }, el('span', { class: 'sk sk-text' }));
    var box = el('div', { class: 'td-section tl' },
      el('div', { class: 'tl-head' }, el('h3', null, 'ریز زمان‌های کار', el('small', { text: 'برای گزارش هزینه پروژه' })),
        el('button', { type: 'button', class: 'chip-btn', html: icon('plus') + ' ثبت دستی', onclick: form })), list);
    var formBox = null;
    function form() {
      if (formBox) { formBox.remove(); formBox = null; return; }
      var h = numInput('h', 1, 'ساعت', 24), m = numInput('m', 0, 'دقیقه', 59);
      var date = MP.dateField('date', S.today, 'روز کار');
      var note = el('input', { name: 'note', maxlength: 200, placeholder: 'توضیح (اختیاری)' });
      formBox = el('form', { class: 'form tl-form' },
        el('div', { class: 'tl-dur' }, el('span', { text: 'مدت' }), h, el('span', { text: 'ساعت و' }), m, el('span', { text: 'دقیقه' })),
        date, note,
        el('div', { class: 'tl-form-actions' }, el('button', { type: 'submit', class: 'btn btn-primary btn-sm', text: 'ثبت زمان' }),
          el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'انصراف', onclick: form })));
      formBox.onsubmit = function (e) {
        e.preventDefault();
        var minutes = numVal(h) * 60 + numVal(m);
        if (!minutes) { MP.toast('مدت را وارد کنید', { error: true }); return; }
        MP.busy(formBox, true);
        MP.api('tasks/' + t.id + '/time', { method: 'POST', body: { minutes: minutes, date: $('input[name=date]', formBox).value, note: note.value } })
          .then(function () { MP.toast(MP.duration(minutes * 60) + ' ثبت شد', { icon: 'clock' }); changed(); })
          .catch(function (err) { MP.busy(formBox, false); MP.soft(err); });
      };
      list.before(formBox);
      $('input[name=h]', formBox).focus();
    }
    if (!mine) box.querySelector('.chip-btn').title = 'ثبت زمان به جای مسئول تسک';
    MP.api('tasks/' + t.id + '/time').then(function (rows) {
      list.replaceChildren();
      if (!rows.length) { list.append(el('p', { class: 'muted', text: 'هنوز زمانی ثبت نشده. با تایمر کار کنید یا زمان را دستی ثبت کنید.' })); return; }
      rows.forEach(function (r) {
        list.append(el('div', { class: 'tl-row' },
          el('span', { class: 'tl-ico', html: icon(r.source === 'manual' ? 'edit' : 'clock') }),
          el('div', { class: 'tl-copy' },
            el('strong', { text: MP.duration(r.seconds) }),
            el('small', { text: J.formatLong(r.date) + ' · ' + SRC[r.source] + (r.user_id !== S.me.id ? ' · ' + r.user : '') + (r.note ? ' · ' + r.note : '') })),
          r.can_delete ? el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'حذف', html: icon('trash'), onclick: function () {
            MP.confirm('حذف ثبت زمان', MP.duration(r.seconds) + ' از زمان این تسک کم شود؟', 'حذف').then(function (ok) {
              if (ok) MP.api('time/' + r.id, { method: 'DELETE' }).then(changed).catch(MP.soft);
            });
          } }) : null));
      });
    }).catch(function () { list.replaceChildren(); });
    return box;
  };

  /* ------------------------------------------------ Cost report */

  var period = 'month';
  function range() {
    var j = J.fromIso(S.today), y = j.jy, mo = j.jm;
    if (period === 'month') return [J.toIso(y, mo, 1), S.today];
    if (period === 'last') { var py = mo === 1 ? y - 1 : y, pm = mo === 1 ? 12 : mo - 1; return [J.toIso(py, pm, 1), J.toIso(py, pm, J.monthLength(py, pm))]; }
    if (period === '3m') { var sy = y, sm = mo - 2; if (sm < 1) { sm += 12; sy--; } return [J.toIso(sy, sm, 1), S.today]; }
    if (period === 'year') return [J.toIso(y, 1, 1), S.today];
    return ['', ''];
  }

  function kpi(label, value, sub, cls, ic) {
    return el('article', { class: 'card stat cost-kpi ' + (cls || '') }, el('span', { class: 'ck-ico', html: icon(ic) }), el('small', { text: label }), el('strong', { text: value }), sub ? el('span', { text: sub }) : null);
  }

  MP.costReport = function (body) {
    var seg = el('div', { class: 'seg sm', role: 'tablist' });
    [['month', 'این ماه'], ['last', 'ماه قبل'], ['3m', '۳ ماه اخیر'], ['year', 'امسال'], ['all', 'همه']].forEach(function (p) {
      seg.append(el('button', { type: 'button', role: 'tab', 'aria-selected': String(p[0] === period), text: p[1], onclick: function () { period = p[0]; MP.costReport(body); } }));
    });
    var content = el('div', { class: 'cost-body' }, MP.skeleton(4));
    body.replaceChildren(el('div', { class: 'cost-bar' }, seg, el('button', { type: 'button', class: 'btn btn-secondary btn-sm', html: icon('wallet') + 'نرخ ساعتی افراد', onclick: rates })), content);
    var r = range();
    MP.api('costs', { query: { from: r[0], to: r[1] } }).then(function (d) {
      var T = d.totals, cost = T.labor + T.expense, profit = T.income - cost;
      var parts = [];
      if (d.unrated) parts.push(el('div', { class: 'cost-alert' }, MP.iconEl('help'),
        el('span', { text: 'برای ' + fa(d.unrated) + ' نفر نرخ ساعتی ثبت نشده؛ هزینه زمان آن‌ها صفر حساب شده است.' }),
        el('button', { type: 'button', class: 'link', text: 'ثبت نرخ‌ها', onclick: rates })));
      parts.push(el('div', { class: 'rep-stats cost-kpis' },
        kpi('زمان کار ثبت‌شده', MP.duration(T.seconds), fa(d.people.length) + ' نفر', '', 'clock'),
        kpi('هزینه نیروی انسانی', toman(T.labor), 'از روی نرخ ساعتی', '', 'user'),
        kpi('هزینه‌های مستقیم', toman(T.expense), 'از دخل و خرج پروژه‌ها', '', 'wallet'),
        kpi('هزینه کل', toman(cost), 'نیرو + مستقیم', 'is-cost', 'pie'),
        kpi('درآمد پروژه‌ها', toman(T.income), T.income || cost ? (profit >= 0 ? 'سود ' : 'زیان ') + toman(Math.abs(profit)) : '', profit >= 0 ? 'is-ok' : 'is-bad', 'target')));

      var projBox = el('section', { class: 'card rep-wide pad' }, el('h2', { class: 'card-title', text: 'هزینه هر پروژه' }));
      if (!d.projects.length) projBox.append(MP.empty('clock', 'در این بازه زمانی کاری ثبت نشده', 'وقتی افراد روی تسک‌ها تایمر بزنند یا زمان را دستی ثبت کنند، هزینه هر پروژه اینجا دیده می‌شود.', null, true));
      var max = Math.max.apply(null, d.projects.map(function (p) { return Math.max(p.labor + p.expense, p.income); }).concat([1]));
      d.projects.forEach(function (p) {
        var total = p.labor + p.expense, pr = p.income - total;
        var detail = el('div', { class: 'cp-detail', hidden: true },
          p.people.length ? el('div', { class: 'cp-col' }, el('h4', { text: 'افراد' }), p.people.map(function (x) {
            var u = MP.user(x.id);
            return el('div', { class: 'cp-line' }, MP.avatar(u, 'sm'), el('span', { class: 'cp-n', text: u ? u.name : '—' }), el('span', { class: 'muted', text: MP.duration(x.seconds) }), el('b', { text: toman(x.cost) }));
          })) : null,
          p.tasks.length ? el('div', { class: 'cp-col' }, el('h4', { text: 'پرهزینه‌ترین تسک‌ها' }), p.tasks.map(function (x) {
            return el('div', { class: 'cp-line' }, el('span', { class: 'cp-n', text: x.title }), el('span', { class: 'muted', text: MP.duration(x.seconds) }), el('b', { text: toman(x.cost) }));
          })) : null);
        var head = el('button', { type: 'button', class: 'cp-head', 'aria-expanded': 'false', onclick: function () { detail.hidden = !detail.hidden; head.setAttribute('aria-expanded', String(!detail.hidden)); } },
          el('div', { class: 'cp-title' }, el('strong', { text: p.name }), el('small', { text: MP.duration(p.seconds) + (p.people.length ? ' · ' + fa(p.people.length) + ' نفر' : '') })),
          el('div', { class: 'cp-bars' },
            el('div', { class: 'cp-bar' }, el('i', { class: 'lab', style: { width: p.labor / max * 100 + '%' } }), el('i', { class: 'exp', style: { width: p.expense / max * 100 + '%' } })),
            p.income ? el('div', { class: 'cp-bar' }, el('i', { class: 'inc', style: { width: p.income / max * 100 + '%' } })) : null),
          el('div', { class: 'cp-sum' }, el('b', { text: toman(total) }),
            p.income ? el('small', { class: pr >= 0 ? 'ok' : 'bad', text: (pr >= 0 ? 'سود ' : 'زیان ') + toman(Math.abs(pr)) }) : el('small', { class: 'muted', text: 'درآمدی ثبت نشده' })),
          MP.iconEl('down'));
        projBox.append(el('div', { class: 'cp' }, head, detail));
      });
      if (d.projects.length) projBox.append(el('div', { class: 'legend cp-legend' },
        el('span', null, el('i', { class: 'lg cp-lab' }), 'نیروی انسانی'), el('span', null, el('i', { class: 'lg cp-exp' }), 'هزینه مستقیم'), el('span', null, el('i', { class: 'lg cp-inc' }), 'درآمد')));
      parts.push(projBox);

      if (d.people.length) {
        var tb = el('tbody');
        d.people.forEach(function (x) {
          tb.append(el('tr', null, el('td', { text: x.name }), el('td', { text: MP.duration(x.seconds) }),
            el('td', { class: x.rate ? '' : 'prio-high', text: x.rate ? toman(x.rate) : 'ثبت نشده' }), el('td', null, el('b', { text: toman(x.cost) }))));
        });
        parts.push(el('section', { class: 'card rep-wide' }, el('h2', { class: 'card-title', text: 'زمان و هزینه هر نفر' }),
          el('div', { class: 'table-wrap' }, el('table', { class: 'table' }, el('thead', null, el('tr', null, ['عضو', 'زمان', 'نرخ ساعتی', 'هزینه'].map(function (h) { return el('th', { text: h }); }))), tb))));
      }
      content.replaceChildren.apply(content, parts);
    }).catch(MP.soft);
  };

  function rates() {
    var body = MP.dialog.open('نرخ ساعتی افراد', MP.skeleton(3), { focus: false });
    MP.api('costs/rates').then(function (list) {
      var form = el('form', { class: 'form rate-form' }, el('p', { class: 'muted', text: 'هزینه هر ساعت کار هر نفر برای شرکت (تومان). زمان‌هایی که قبلاً بدون نرخ ثبت شده‌اند، با اولین نرخی که وارد کنید حساب می‌شوند.' }));
      list.forEach(function (u) {
        var inp = el('input', { name: 'r' + u.id, inputmode: 'numeric', value: u.rate ? MP.money(u.rate) : '', placeholder: 'مثلاً ۲۵۰٬۰۰۰', dir: 'ltr' });
        inp.oninput = function () { var n = faToLatin(inp.value).replace(/\D/g, ''); inp.value = n ? MP.money(+n) : ''; };
        inp.dataset.id = u.id;
        form.append(el('label', { class: 'rate-row' }, MP.avatar(MP.user(u.id) || { name: u.name }, 'sm'),
          el('span', { class: 'rate-name' }, el('strong', { text: u.name }), u.title ? el('small', { text: u.title }) : null),
          el('span', { class: 'rate-in' }, inp, el('small', { text: 'تومان / ساعت' }))));
      });
      form.append(MP.actions('ذخیره نرخ‌ها'));
      form.onsubmit = function (e) {
        e.preventDefault();
        var out = {};
        form.querySelectorAll('input[data-id]').forEach(function (i) { out[i.dataset.id] = faToLatin(i.value).replace(/\D/g, '') || 0; });
        MP.busy(form, true);
        MP.api('costs/rates', { method: 'POST', body: { rates: out } }).then(function () {
          MP.dialog.close(); MP.toast('نرخ‌ها ذخیره شد', { icon: 'check' });
          var b = $('#rep-body'); if (b && MP.visible('reports')) MP.costReport(b);
        }).catch(function (err) { MP.busy(form, false); MP.soft(err); });
      };
      body.replaceChildren(form);
    }).catch(MP.soft);
  }
  MP.costRates = rates;
})();
