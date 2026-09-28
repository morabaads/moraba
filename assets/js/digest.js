/* Weekly report for supervisors (who worked how much, what is overdue, the week's money) and the settings of the morning brief. */
(function () {
  'use strict';
  var MP = window.MP, S = MP.S, J = MP.J, el = MP.el, fa = MP.fa, icon = MP.icon;
  var DAYS = [[6, 'شنبه'], [0, 'یکشنبه'], [1, 'دوشنبه'], [2, 'سه‌شنبه'], [3, 'چهارشنبه'], [4, 'پنجشنبه'], [5, 'جمعه']];
  function toman(n) { return (n < 0 ? '−' : '') + MP.money(Math.abs(n)) + ' تومان'; }

  function report(w, reload) {
    var box = el('div', { class: 'wk' });
    box.append(el('div', { class: 'daily-bar' },
      el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'هفته قبل', html: icon('right'), onclick: function () { reload(J.addDays(w.to, -7)); } }),
      el('strong', { text: J.format(w.from) + ' تا ' + J.format(w.to) }),
      el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'هفته بعد', html: icon('left'), disabled: w.to >= S.today, onclick: function () { var n = J.addDays(w.to, 7); reload(n > S.today ? S.today : n); } })));
    var m = w.money;
    box.append(el('div', { class: 'wk-kpis' },
      kpi('تسک انجام‌شده', fa(w.totals.done), 'checks'),
      kpi('حضور تیم', fa(w.totals.hours) + ' ساعت', 'clock'),
      kpi('عقب‌افتاده', fa(w.totals.overdue), 'alarm', w.totals.overdue ? 'warn' : ''),
      kpi('دخل / خرج هفته', MP.money(m.income) + ' / ' + MP.money(m.expense), 'wallet'),
      kpi('موجودی', toman(m.balance), 'wallet'),
      m.unpaid_count ? kpi(fa(m.unpaid_count) + ' فاکتور پرداخت‌نشده', toman(m.unpaid), 'file', 'warn') : null));
    var rows = el('div', { class: 'wk-people' });
    var maxDone = Math.max.apply(null, [1].concat(w.people.map(function (p) { return p.done; })));
    w.people.forEach(function (p) {
      rows.append(el('article', { class: 'wk-person' },
        el('div', { class: 'wk-who' }, MP.avatar(MP.user(p.user_id), 'sm'), el('strong', { text: p.name })),
        el('div', { class: 'wk-bar' }, el('i', { style: { width: (p.done / maxDone * 100) + '%' } })),
        el('div', { class: 'wk-nums' },
          el('span', { text: fa(p.done) + '/' + fa(p.planned) + ' تسک' }),
          el('span', { text: fa(p.hours) + ' ساعت حضور' }),
          p.logged ? el('span', { text: fa(p.logged) + ' ساعت ثبت زمان' }) : null,
          el('span', { class: p.reports < 4 ? 'low' : '', text: 'گزارش روزانه ' + fa(p.reports) + ' روز' }),
          p.overdue ? el('span', { class: 'late', text: fa(p.overdue) + ' عقب‌افتاده' }) : null),
        p.late.length ? el('details', { class: 'td-desc-more' }, el('summary', { text: 'عقب‌افتاده‌ها' }), el('ul', { class: 'wk-late' }, p.late.map(function (t) {
          return el('li', null, el('button', { type: 'button', class: 'link-btn', text: t.title, onclick: function () { MP.openTask(t.id); } }), el('small', { text: ' · ' + J.format(t.date) }));
        }))) : null));
    });
    if (!w.people.length) rows.append(MP.empty('user', 'کارمندی ثبت نشده', null, null, true));
    box.append(el('h3', { class: 'tio-sub', text: 'کار هر نفر' }), rows);
    if (w.late_projects.length) box.append(el('h3', { class: 'tio-sub', text: 'پروژه‌های عقب از موعد' }), el('div', { class: 'wk-proj' }, w.late_projects.map(function (p) {
      return el('button', { type: 'button', class: 'chip danger', text: p.name + ' · ' + J.format(p.end), onclick: function () { MP.dialog.close(); S.projectId = p.id; MP.showView('projects'); } });
    })));
    return box;
  }
  function kpi(label, value, ic, tone) {
    return el('div', { class: 'wk-kpi ' + (tone || '') }, el('span', { html: icon(ic) }), el('div', null, el('small', { text: label }), el('strong', { text: value })));
  }

  function settingsForm() {
    var f = el('form', { class: 'form' }), box = el('div', null, MP.skeleton(2));
    MP.api('digest/settings').then(function (s) {
      var mt = el('input', { name: 'morning_time', dir: 'ltr', maxlength: 5, value: s.morning_time, style: { maxWidth: '110px' } });
      var wt = el('input', { name: 'weekly_time', dir: 'ltr', maxlength: 5, value: s.weekly_time, style: { maxWidth: '110px' } });
      var days = el('div', { class: 'daily-days' }, DAYS.map(function (x) { return el('label', { class: 'check' }, el('input', { type: 'checkbox', value: x[0], checked: s.days.indexOf(x[0]) >= 0 }), el('span', { text: x[1] })); }));
      var on = el('input', { type: 'checkbox', checked: !!s.morning }), sms = el('input', { type: 'checkbox', checked: !!s.sms }), wk = el('input', { type: 'checkbox', checked: !!s.weekly });
      var wd = MP.select('weekly_day', DAYS, s.weekly_day);
      f.append(
        el('h3', { class: 'tio-sub', text: 'خلاصه صبحگاهی (برای همه)' }),
        el('label', { class: 'check' }, on, el('span', { text: 'هر صبح بفرست: «امروز ۴ تسک، ۱ جلسه، ۲ تسک عقب‌افتاده»' })),
        MP.field('ساعت', mt),
        el('div', { class: 'field' }, el('span', { text: 'روزهای کاری' }), days),
        el('label', { class: 'check' }, sms, el('span', { text: 'با پیامک هم بفرست (هزینه پیامک دارد)' })),
        el('p', { class: 'hint', text: 'همیشه در پنل، اعلان گوشی و تلگرام/بله (برای کسانی که شناسه‌شان را در پروفایل گذاشته‌اند) می‌رود.' }),
        el('h3', { class: 'tio-sub', text: 'گزارش هفتگی (برای ناظرها)' }),
        el('label', { class: 'check' }, wk, el('span', { text: 'گزارش هفتگی خودکار بفرست (اعلان + ایمیل کامل)' })),
        el('div', { class: 'row' }, MP.field('روز', wd), MP.field('ساعت', wt)),
        el('div', { class: 'dialog-actions' },
          el('button', { type: 'submit', class: 'btn btn-primary', text: 'ذخیره' }),
          el('button', { type: 'button', class: 'btn btn-secondary', text: 'خلاصه امروز را برای خودم بفرست', onclick: function () {
            MP.api('digest/test', { method: 'POST' }).then(function (b) { MP.toast(b.title, { duration: 6000 }); }).catch(MP.soft);
          } })));
      f.onsubmit = function (e) {
        e.preventDefault(); MP.busy(f, true);
        MP.api('digest/settings', { method: 'POST', body: { morning: on.checked, morning_time: J.latinDigits(mt.value.trim()), sms: sms.checked, days: Array.prototype.map.call(days.querySelectorAll('input:checked'), function (x) { return +x.value; }), weekly: wk.checked, weekly_day: +wd.value, weekly_time: J.latinDigits(wt.value.trim()) } })
          .then(function () { MP.busy(f, false); MP.toast('تنظیمات ذخیره شد'); }).catch(function (err) { MP.busy(f, false); MP.soft(err); });
      };
      box.replaceChildren(f);
    }).catch(MP.soft);
    return box;
  }

  MP.weeklyReport = function (to, tab) {
    var body = MP.dialog.open('گزارش هفتگی', MP.skeleton(4), { wide: true, focus: false });
    tab = tab || 'report';
    var seg = el('div', { class: 'seg daily-tabs', role: 'tablist' },
      el('button', { type: 'button', role: 'tab', 'aria-selected': String(tab === 'report'), text: 'گزارش', onclick: function () { MP.weeklyReport(to, 'report'); } }),
      el('button', { type: 'button', role: 'tab', 'aria-selected': String(tab === 'settings'), text: 'خلاصه صبحگاهی و زمان‌بندی', onclick: function () { MP.weeklyReport(to, 'settings'); } }));
    if (tab === 'settings') { body.replaceChildren(seg, settingsForm()); return; }
    MP.api('digest/weekly', { query: { to: to || S.today } }).then(function (w) {
      if (!MP.dialog.isOpen()) return;
      body.replaceChildren(seg, report(w, function (x) { MP.weeklyReport(x, 'report'); }));
    }).catch(MP.soft);
  };
})();
