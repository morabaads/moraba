/* Monthly payroll (supervisors): attendance + leave + overtime → net pay per person, holidays, bonuses, Excel export. */
(function () {
  'use strict';
  var MP = window.MP, S = MP.S, J = MP.J, el = MP.el, $ = MP.$, fa = MP.fa, icon = MP.icon;
  var cur = null; // [jy, jm]
  var T = function (n) { return MP.money(Math.round(n)); };
  var toman = function (n) { return T(n) + ' تومان'; };
  function hm(min) { min = Math.round(min || 0); var h = Math.floor(min / 60), m = min % 60; return fa(h) + ':' + (m < 10 ? '۰' : '') + fa(m); }
  function latin(v) { return String(v == null ? '' : v).replace(/[۰-۹]/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'.indexOf(d); }).replace(/[٠-٩]/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(d); }).replace(/٫/g, '.'); }
  function moneyInput(name, value, ph) {
    var i = el('input', { name: name, inputmode: 'numeric', dir: 'ltr', value: value ? MP.money(value) : '', placeholder: ph || '۰' });
    i.oninput = function () { var n = latin(i.value).replace(/\D/g, ''); i.value = n ? MP.money(+n) : ''; };
    return i;
  }
  function moneyVal(i) { return +latin(i.value).replace(/\D/g, '') || 0; }
  function key() { return cur[0] + '-' + cur[1]; }
  function shift(n) { var y = cur[0], m = cur[1] + n; while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; } cur = [y, m]; }

  function kpi(label, value, sub, ic, cls) {
    return el('article', { class: 'card stat cost-kpi ' + (cls || '') }, el('span', { class: 'ck-ico', html: icon(ic) }), el('small', { text: label }), el('strong', { text: value }), sub ? el('span', { text: sub }) : null);
  }

  MP.payroll = function (body) {
    if (!cur) { var j = J.fromIso(S.today); cur = [j.jy, j.jm]; }
    var label = el('strong', { class: 'pr-month', text: J.months[cur[1] - 1] + ' ' + fa(cur[0]) });
    var content = el('div', { class: 'cost-body' }, MP.skeleton(4));
    var excel = el('a', { class: 'btn btn-primary btn-sm', href: MP.C.payrollExport + '&month=' + key(), html: icon('download') + 'خروجی اکسل' });
    body.replaceChildren(
      el('div', { class: 'cost-bar' },
        el('div', { class: 'pr-nav' },
          el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'ماه قبل', html: icon('right'), onclick: function () { shift(-1); MP.payroll(body); } }),
          label,
          el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'ماه بعد', html: icon('left'), onclick: function () { shift(1); MP.payroll(body); } })),
        el('div', { class: 'pr-actions' },
          el('button', { type: 'button', class: 'btn btn-secondary btn-sm', html: icon('calendar') + 'تعطیلات ماه', onclick: function () { holidays(body); } }),
          el('button', { type: 'button', class: 'btn btn-secondary btn-sm', html: icon('settings') + 'حقوق و تنظیمات', onclick: function () { settings(body); } }),
          excel)),
      content);
    MP.api('payroll', { query: { month: key() } }).then(function (d) {
      var t = d.totals, parts = [];
      var open = d.rows.filter(function (r) { return r.open_sessions; }), nobase = d.rows.filter(function (r) { return !r.base; });
      if (open.length) parts.push(el('div', { class: 'cost-alert' }, MP.iconEl('help'), el('span', { text: open.map(function (r) { return r.name + ' (' + fa(r.open_sessions) + ' روز)'; }).join('، ') + ' خروج ثبت نکرده‌اند؛ آن روزها در کارکرد حساب نشده‌اند. از حضور و مرخصی اصلاح کنید.' })));
      if (nobase.length) parts.push(el('div', { class: 'cost-alert' }, MP.iconEl('wallet'), el('span', { text: 'حقوق پایه برای ' + nobase.map(function (r) { return r.name; }).join('، ') + ' ثبت نشده است.' }), el('button', { type: 'button', class: 'link', text: 'ثبت حقوق', onclick: function () { settings(body); } })));
      if (!d.finished) parts.push(el('p', { class: 'muted pr-note', text: 'این ماه هنوز تمام نشده؛ موظفی کل ماه حساب شده و کسر کار تا پایان ماه قطعی نیست.' }));
      parts.push(el('div', { class: 'rep-stats cost-kpis' },
        kpi('روز کاری ماه', fa(d.workdays) + ' روز', 'موظفی ' + hm(d.required) + ' ساعت', 'calendar'),
        kpi('جمع خالص پرداختی', toman(t.net), fa(d.rows.length) + ' نفر', 'wallet', 'is-cost'),
        kpi('اضافه‌کار', toman(t.overtime_pay), 'ضریب ' + fa(d.settings.overtime_factor), 'clock'),
        kpi('کسر کار', toman(t.shortfall_pay), d.settings.deduct_shortfall ? 'از حقوق کم می‌شود' : 'کسر نمی‌شود', 'target'),
        kpi('بیمه سهم کارمند', toman(t.insurance), fa(d.settings.insurance_rate) + '٪', 'check')));

      var list = el('section', { class: 'card rep-wide pad' }, el('h2', { class: 'card-title', text: 'فیش حقوق ' + d.label }));
      if (!d.rows.length) list.append(MP.empty('wallet', 'کسی در این ماه در لیست حقوق نیست', 'حقوق پایه افراد را ثبت کنید یا منتظر ثبت ورود و خروج بمانید.', null, true));
      d.rows.forEach(function (r) {
        var u = MP.user(r.id), pct = r.required ? Math.min(100, (r.worked + r.paid_leave) / r.required * 100) : 0;
        var line = function (l, v, cls) { return el('div', { class: 'pr-line ' + (cls || '') }, el('span', { text: l }), el('b', { text: v })); };
        var detail = el('div', { class: 'pr-detail', hidden: true },
          el('div', { class: 'pr-col' }, el('h4', { text: 'کارکرد' }),
            line('روز حضور', fa(r.present_days) + ' روز'),
            line('کارکرد', hm(r.worked)),
            line('موظفی', hm(r.required)),
            line('مرخصی با حقوق', hm(r.paid_leave)),
            r.unpaid_leave ? line('مرخصی بدون حقوق', hm(r.unpaid_leave), 'bad') : null,
            line('اضافه‌کار', hm(r.overtime), r.overtime ? 'ok' : ''),
            line('کسر کار', hm(r.shortfall), r.shortfall ? 'bad' : '')),
          el('div', { class: 'pr-col' }, el('h4', { text: 'مبالغ (تومان)' }),
            line('حقوق پایه', T(r.base)),
            r.allowances ? line('مزایای ثابت', T(r.allowances)) : null,
            r.overtime_pay ? line('اضافه‌کار', '+ ' + T(r.overtime_pay), 'ok') : null,
            r.shortfall_pay ? line('کسر کار', '− ' + T(r.shortfall_pay), 'bad') : null,
            r.bonus ? line('پاداش', '+ ' + T(r.bonus), 'ok') : null,
            r.deduction ? line('مساعده / کسورات', '− ' + T(r.deduction), 'bad') : null,
            r.insurance ? line('بیمه سهم کارمند', '− ' + T(r.insurance), 'bad') : null,
            line('خالص پرداختی', T(r.net), 'total'),
            r.note ? el('p', { class: 'muted', text: r.note }) : null,
            el('button', { type: 'button', class: 'btn btn-secondary btn-sm', html: icon('edit') + 'پاداش / کسورات', onclick: function () { adjust(r, d, body); } })));
        var bar = el('i'); bar.style.width = pct + '%';
        var head = el('button', { type: 'button', class: 'pr-head', 'aria-expanded': 'false', onclick: function () { detail.hidden = !detail.hidden; head.setAttribute('aria-expanded', String(!detail.hidden)); } },
          MP.avatar(u || { name: r.name }, 'md'),
          el('div', { class: 'pr-who' }, el('strong', { text: r.name }),
            el('div', { class: 'pr-chips' },
              el('span', { class: 'chip', text: 'کارکرد ' + hm(r.worked + r.paid_leave) + ' از ' + hm(r.required) }),
              r.overtime ? el('span', { class: 'chip ok', text: 'اضافه‌کار ' + hm(r.overtime) }) : null,
              r.shortfall ? el('span', { class: 'chip danger', text: 'کسر ' + hm(r.shortfall) }) : null,
              r.leave ? el('span', { class: 'chip', text: 'مرخصی ' + hm(r.leave) }) : null),
            el('div', { class: 'bar' + (pct >= 100 ? ' ok' : '') }, bar)),
          el('div', { class: 'pr-net' }, el('small', { text: 'خالص' }), el('b', { text: r.base ? toman(r.net) : '—' })),
          MP.iconEl('down'));
        list.append(el('div', { class: 'pr' }, head, detail));
      });
      parts.push(list);
      content.replaceChildren.apply(content, parts);
    }).catch(MP.soft);
  };

  function adjust(r, d, body) {
    var bonus = moneyInput('bonus', r.bonus), ded = moneyInput('deduction', r.deduction);
    var note = el('input', { name: 'note', maxlength: 200, value: r.note, placeholder: 'مثلاً پاداش پروژه زیوا، مساعده ۱۰ مهر' });
    var f = el('form', { class: 'form' },
      el('p', { class: 'muted', text: r.name + ' — ' + d.label }),
      el('div', { class: 'row' }, MP.field('پاداش (تومان)', bonus), MP.field('مساعده / کسورات (تومان)', ded)),
      MP.field('توضیح', note), MP.actions('ذخیره'));
    f.onsubmit = function (e) {
      e.preventDefault(); MP.busy(f, true);
      MP.api('payroll/adjust', { method: 'POST', body: { month: key(), user_id: r.id, bonus: moneyVal(bonus), deduction: moneyVal(ded), note: note.value } })
        .then(function () { MP.dialog.close(); MP.toast('ذخیره شد', { icon: 'check' }); MP.payroll(body); })
        .catch(function (err) { MP.busy(f, false); MP.soft(err); });
    };
    MP.dialog.open('پاداش و کسورات', f);
  }

  function holidays(body) {
    MP.api('payroll', { query: { month: key() } }).then(function (d) {
      var picked = d.holidays.slice(), grid = el('div', { class: 'pr-days' });
      var len = J.monthLength(cur[0], cur[1]), first = J.toIso(cur[0], cur[1], 1), pad = J.weekday(first);
      J.weekdays.forEach(function (w) { grid.append(el('span', { class: 'pr-wd', text: w.slice(0, 1) })); });
      for (var i = 0; i < pad; i++) grid.append(el('span'));
      for (var dd = 1; dd <= len; dd++) (function (iso, n) {
        var fri = J.weekday(iso) === 6;
        var b = el('button', { type: 'button', class: 'pr-day' + (fri ? ' fri' : '') + (picked.indexOf(iso) >= 0 ? ' on' : ''), text: fa(n), disabled: fri, 'aria-pressed': String(picked.indexOf(iso) >= 0) });
        b.onclick = function () { var k = picked.indexOf(iso); if (k >= 0) picked.splice(k, 1); else picked.push(iso); b.classList.toggle('on', k < 0); b.setAttribute('aria-pressed', String(k < 0)); };
        grid.append(b);
      })(J.toIso(cur[0], cur[1], dd), dd);
      var f = el('form', { class: 'form' }, el('p', { class: 'muted', text: 'تعطیلات رسمی ' + d.label + ' را انتخاب کنید. جمعه‌ها خودکار تعطیل‌اند. این روزها از موظفی کم می‌شوند.' }), grid, MP.actions('ذخیره تعطیلات'));
      f.onsubmit = function (e) {
        e.preventDefault(); MP.busy(f, true);
        MP.api('payroll/holidays', { method: 'POST', body: { month: key(), dates: picked } }).then(function () { MP.dialog.close(); MP.toast('تعطیلات ذخیره شد', { icon: 'check' }); MP.payroll(body); }).catch(function (err) { MP.busy(f, false); MP.soft(err); });
      };
      MP.dialog.open('تعطیلات ' + d.label, f);
    }).catch(MP.soft);
  }

  function settings(body) {
    var dlg = MP.dialog.open('حقوق و تنظیمات', MP.skeleton(4), { wide: true, focus: false });
    MP.api('payroll/settings').then(function (d) {
      var s = d.settings;
      var dayH = el('input', { name: 'dh', inputmode: 'numeric', value: fa(Math.floor(s.day_minutes / 60)), class: 'num-mini' });
      var dayM = el('input', { name: 'dm', inputmode: 'numeric', value: fa(s.day_minutes % 60), class: 'num-mini' });
      var thu = MP.select('thursday', [['off', 'تعطیل'], ['half', 'نیمه‌وقت'], ['full', 'تمام‌وقت']], s.thursday);
      var num = function (n, v) { return el('input', { name: n, inputmode: 'decimal', value: fa(v), class: 'num-mini wide' }); };
      var otf = num('otf', s.overtime_factor), mh = num('mh', s.month_hours), ins = num('ins', s.insurance_rate), pl = num('pl', s.paid_leave_days);
      var sf = el('input', { type: 'checkbox', checked: !!s.deduct_shortfall });
      var people = el('div', { class: 'pay-people' });
      d.profiles.forEach(function (p) {
        var base = moneyInput('base', p.base, 'مثلاً ۱۵٬۰۰۰٬۰۰۰'), al = moneyInput('al', p.allowances), insd = el('input', { type: 'checkbox', checked: p.insured });
        base.dataset.id = p.id;
        people.append(el('div', { class: 'pay-row', 'data-id': p.id }, MP.avatar(MP.user(p.id) || { name: p.name }, 'sm'),
          el('span', { class: 'rate-name' }, el('strong', { text: p.name }), p.title ? el('small', { text: p.title }) : null),
          el('label', { class: 'pay-in' }, el('small', { text: 'حقوق پایه ماهانه' }), base),
          el('label', { class: 'pay-in' }, el('small', { text: 'مزایای ثابت (مسکن، بن…)' }), al),
          el('label', { class: 'check-row pay-ins' }, insd, el('span', { text: 'بیمه' }))));
      });
      var f = el('form', { class: 'form pay-form' },
        el('h3', { text: 'قوانین محاسبه' }),
        el('div', { class: 'pay-rules' },
          el('label', { class: 'pay-rule' }, el('span', { text: 'ساعت کار روزانه' }), el('span', { class: 'tl-dur' }, dayH, el('span', { text: 'ساعت و' }), dayM, el('span', { text: 'دقیقه' }))),
          el('label', { class: 'pay-rule' }, el('span', { text: 'پنجشنبه‌ها' }), thu),
          el('label', { class: 'pay-rule' }, el('span', { text: 'ضریب اضافه‌کار' }), otf),
          el('label', { class: 'pay-rule' }, el('span', { text: 'مقسوم‌علیه ساعت (حقوق ÷ …)' }), mh),
          el('label', { class: 'pay-rule' }, el('span', { text: 'بیمه سهم کارمند ٪' }), ins),
          el('label', { class: 'pay-rule' }, el('span', { text: 'مرخصی با حقوق در ماه (روز)' }), pl),
          el('label', { class: 'check-row' }, sf, el('span', { text: 'کسر کار از حقوق کم شود' }))),
        el('h3', { text: 'حقوق افراد (تومان)' }), people, MP.actions('ذخیره'));
      f.onsubmit = function (e) {
        e.preventDefault();
        var profiles = {};
        people.querySelectorAll('.pay-row').forEach(function (row) {
          var ins2 = row.querySelector('input[type=checkbox]');
          profiles[row.dataset.id] = { base: moneyVal(row.querySelector('input[name=base]')), allowances: moneyVal(row.querySelector('input[name=al]')), insured: ins2.checked };
        });
        var n = function (i) { return +latin(i.value).replace(/[^\d.]/g, '') || 0; };
        MP.busy(f, true);
        MP.api('payroll/settings', { method: 'POST', body: { day_minutes: n(dayH) * 60 + n(dayM), thursday: thu.value, overtime_factor: n(otf), month_hours: n(mh), insurance_rate: n(ins), paid_leave_days: n(pl), deduct_shortfall: sf.checked } })
          .then(function () { return MP.api('payroll/profiles', { method: 'POST', body: { profiles: profiles } }); })
          .then(function () { MP.dialog.close(); MP.toast('تنظیمات حقوق ذخیره شد', { icon: 'check' }); MP.payroll(body); })
          .catch(function (err) { MP.busy(f, false); MP.soft(err); });
      };
      dlg.replaceChildren(f);
    }).catch(MP.soft);
  }
})();
