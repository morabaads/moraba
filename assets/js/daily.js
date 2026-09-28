/* Daily end-of-day report: employees write it at the time supervisors set; supervisors read everyone's and see who is missing. */
(function () {
  'use strict';
  var MP = window.MP, S = MP.S, J = MP.J, el = MP.el, $ = MP.$, fa = MP.fa, icon = MP.icon;
  var DAYS = [[6, 'شنبه'], [0, 'یکشنبه'], [1, 'دوشنبه'], [2, 'سه‌شنبه'], [3, 'چهارشنبه'], [4, 'پنجشنبه'], [5, 'جمعه']];

  function area(name, label, value, ph, required) {
    return MP.field(label, el('textarea', { name: name, rows: 3, maxlength: 4000, required: !!required, placeholder: ph || '' }, value || ''));
  }

  /* ------------------------------------------------------------ My report */

  function myForm(d) {
    var r = d.mine || {};
    var f = el('form', { class: 'form daily-form' });
    var pct = el('input', { type: 'range', name: 'progress', min: 0, max: 100, step: 5, value: r.progress || 0 });
    var pctOut = el('strong', { class: 'daily-pct', text: fa(r.progress || 0) + '٪' });
    pct.oninput = function () { pctOut.textContent = fa(pct.value) + '٪'; };
    var done = area('done', 'کارهای انجام‌شده', r.done, 'هر کار در یک خط', true);
    var fill = el('button', { type: 'button', class: 'chip-btn', html: icon('checks') + ' از تسک‌های انجام‌شده امروز', onclick: function () {
      var list = MP.myTasks().filter(function (t) { return t.done && (t.date === d.date || (t.done_at || '').slice(0, 10) === d.date); });
      if (!list.length) { MP.toast('امروز تسک انجام‌شده‌ای ثبت نشده است.'); return; }
      var ta = $('textarea', done), cur = ta.value.trim();
      ta.value = (cur ? cur + '\n' : '') + list.map(function (t) { return '• ' + t.title; }).join('\n');
      var all = MP.myTasks().filter(function (t) { return t.date === d.date; });
      if (all.length && !+pct.value) { pct.value = Math.round(list.length / all.length * 20) * 5; pct.oninput(); }
    } });
    f.append(
      el('p', { class: 'muted', text: 'گزارش ' + J.formatLong(d.date) + (r.updated_at ? ' · آخرین ثبت ' + MP.timeFa(r.updated_at.slice(11, 16)) : '') }),
      done, fill,
      el('label', { class: 'field' }, el('span', null, 'درصد پیشرفت کار امروز ', pctOut), pct),
      area('problems', 'مشکلات', r.problems, 'اگر مانعی بود'),
      area('decisions', 'نیاز به تصمیم', r.decisions, 'چیزی که ناظر باید درباره‌اش تصمیم بگیرد'),
      area('tomorrow', 'برنامه فردا', r.tomorrow),
      MP.actions(d.mine ? 'به‌روزرسانی گزارش' : 'ثبت گزارش'));
    f.onsubmit = function (e) {
      e.preventDefault(); MP.busy(f, true);
      var v = f.elements;
      MP.api('daily-reports', { method: 'POST', body: { date: d.date, done: v.done.value, progress: +pct.value, problems: v.problems.value, decisions: v.decisions.value, tomorrow: v.tomorrow.value } })
        .then(function () { MP.dialog.close(); MP.toast('گزارش روزانه ثبت شد', { icon: 'checks' }); S.dailyDone = d.date; prompt(); })
        .catch(function (err) { MP.busy(f, false); MP.soft(err); });
    };
    return f;
  }

  /* ------------------------------------------------------------ Team view (supervisors) */

  function teamView(d, reload) {
    var wrap = el('div', { class: 'daily-team' });
    wrap.append(el('div', { class: 'daily-bar' },
      el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'روز قبل', html: icon('right'), onclick: function () { reload(J.addDays(d.date, -1)); } }),
      el('strong', { text: J.formatLong(d.date) }),
      el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'روز بعد', html: icon('left'), disabled: d.date >= S.today, onclick: function () { reload(J.addDays(d.date, 1)); } }),
      el('span', { class: 'chip', text: fa(d.all.length) + ' گزارش' }),
      d.missing.length ? el('span', { class: 'chip warn', text: fa(d.missing.length) + ' ثبت نکرده' }) : null));
    if (d.missing.length) wrap.append(el('div', { class: 'daily-missing' }, el('span', { text: 'ثبت نکرده‌اند: ' }), d.missing.map(function (m) { return el('span', { class: 'chip', text: m.name }); })));
    if (!d.all.length) wrap.append(MP.empty('list', 'هنوز گزارشی ثبت نشده', null, null, true));
    d.all.forEach(function (x) {
      function block(label, v) { return v ? el('div', { class: 'daily-block' }, el('small', { text: label }), el('p', { text: v })) : null; }
      wrap.append(el('article', { class: 'card daily-card' },
        el('div', { class: 'daily-head' }, MP.avatar(MP.user(x.user_id), 'sm'), el('strong', { text: x.name }),
          el('span', { class: 'daily-meter' }, el('i', { style: { width: x.progress + '%' } })), el('b', { text: fa(x.progress) + '٪' }),
          el('small', { class: 'muted', text: MP.timeFa(x.updated_at.slice(11, 16)) })),
        block('کارهای انجام‌شده', x.done), block('مشکلات', x.problems), block('نیاز به تصمیم', x.decisions), block('برنامه فردا', x.tomorrow)));
    });
    return wrap;
  }

  function settingsForm(st) {
    var f = el('form', { class: 'form' });
    var on = el('input', { type: 'checkbox', name: 'enabled', checked: !!st.enabled });
    var time = el('input', { name: 'time', value: st.time, dir: 'ltr', inputmode: 'numeric', maxlength: 5, placeholder: '18:00', style: { maxWidth: '120px' } });
    var days = el('div', { class: 'daily-days' }, DAYS.map(function (x) {
      return el('label', { class: 'check' }, el('input', { type: 'checkbox', value: x[0], checked: st.days.indexOf(x[0]) >= 0 }), el('span', { text: x[1] }));
    }));
    f.append(
      el('label', { class: 'check' }, on, el('span', { text: 'یادآوری گزارش روزانه فعال باشد' })),
      MP.field('ساعت ثبت گزارش', time, 'سر این ساعت به هر کارمندی که هنوز گزارش نداده اعلان (و پیام تلگرام/بله/پیامک در صورت فعال بودن) می‌رود.'),
      el('div', { class: 'field' }, el('span', { text: 'روزهای کاری' }), days),
      MP.actions('ذخیره تنظیمات'));
    f.onsubmit = function (e) {
      e.preventDefault();
      var t = J.latinDigits(time.value.trim());
      MP.busy(f, true);
      MP.api('daily-reports/settings', { method: 'POST', body: { enabled: on.checked, time: t, days: Array.prototype.map.call(days.querySelectorAll('input:checked'), function (x) { return +x.value; }) } })
        .then(function (s) { S.dailySettings = s; MP.busy(f, false); MP.toast('تنظیمات گزارش روزانه ذخیره شد'); })
        .catch(function (err) { MP.busy(f, false); MP.soft(err); });
    };
    return f;
  }

  /* ------------------------------------------------------------ Dialog */

  MP.dailyReport = function (date, tab) {
    var body = MP.dialog.open('گزارش روزانه', MP.skeleton(3), { wide: S.manager, focus: false });
    function load(dt, which) {
      return MP.api('daily-reports', { query: { date: dt } }).then(function (d) {
        if (!MP.dialog.isOpen()) return;
        S.dailySettings = d.settings;
        var tabs = [];
        if (d.required) tabs.push(['mine', 'گزارش من']);
        if (S.manager) tabs.push(['team', 'گزارش‌های تیم'], ['settings', 'تنظیمات']);
        which = which || (d.required ? 'mine' : 'team');
        var seg = el('div', { class: 'seg daily-tabs', role: 'tablist' }, tabs.map(function (t) {
          return el('button', { type: 'button', role: 'tab', 'aria-selected': String(t[0] === which), text: t[1], onclick: function () { load(dt, t[0]); } });
        }));
        var content = which === 'mine' ? myForm(d) : which === 'team' ? teamView(d, function (x) { load(x, 'team'); }) : settingsForm(d.settings);
        body.replaceChildren(tabs.length > 1 ? seg : el('span'), content);
      }).catch(MP.soft);
    }
    load(date || S.today, tab);
  };

  /* ------------------------------------------------------------ Reminder card on the dashboard */

  function prompt() {
    var old = $('#daily-prompt'); if (old) old.remove();
    var st = S.dailySettings, me = S.me;
    if (!st || !st.enabled || !me || !me.employee || S.dailyDone === S.today) return;
    var now = (S.now || '').slice(0, 5), dow = J.weekday(S.today); // 0 = Saturday in J
    var jsDow = (dow + 6) % 7; // → 0 = Sunday … 6 = Saturday, as on the server
    if (now < st.time || st.days.indexOf(jsDow) < 0) return;
    var anchor = $('#prompts'); if (!anchor) return;
    anchor.parentNode.insertBefore(el('div', { id: 'daily-prompt', class: 'card daily-prompt' },
      MP.iconEl('list'), el('span', null, el('strong', { text: 'وقت ثبت گزارش روزانه است' }), el('small', { text: 'کارهای امروز، درصد پیشرفت، مشکلات و برنامه فردا' })),
      el('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'ثبت گزارش', onclick: function () { MP.dailyReport(); } })), anchor);
  }
  function check() {
    MP.api('daily-reports').then(function (d) {
      S.dailySettings = d.settings;
      if (d.mine) S.dailyDone = d.date;
      prompt();
    }).catch(function () {});
  }
  setInterval(function () { if (!document.hidden && S.me) prompt(); }, 60000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && S.me) check(); });
  // Fallback when there is no «booted» event: first check shortly after load.
  setTimeout(function () { if (S.me && !S.dailySettings) check(); }, 2500);
})();
