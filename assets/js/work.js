/* Attendance (check in/out, worked time), leave requests with manager approval, and reminders. */
(function () {
  'use strict';
  var MP = window.MP, S = MP.S, J = MP.J, el = MP.el, $ = MP.$, $$ = MP.$$, fa = MP.fa, icon = MP.icon;
  var chip = $('#punch-chip'), tick = null;

  /* ------------------------------------------------------------ Attendance state + top chip */

  MP.loadAttendance = function () {
    return MP.api('attendance', { query: { from: J.addDays(S.today, -30), to: S.today } }).then(function (a) { S.attendance = a; drawChip(); MP.emit('attendance'); return a; });
  };
  function liveToday() {
    var a = S.attendance; if (!a) return 0;
    return a.today + (a.open ? (Date.now() - a.loadedAt) / 1000 : 0);
  }
  function drawChip() {
    var a = S.attendance; if (!a) return;
    a.loadedAt = a.loadedAt || Date.now();
    chip.hidden = false;
    chip.classList.toggle('is-in', !!a.open);
    chip.classList.toggle('is-out', !a.open);
    $('.punch-text', chip).textContent = a.open ? (MP.isMobile() ? 'حاضر' : 'حاضر · ' + MP.duration(liveToday())) : (MP.isMobile() ? 'ورود' : 'ثبت ورود');
    chip.title = a.open ? 'ثبت خروج' : 'ثبت ورود';
  }
  MP.punch = function (action, note) {
    return MP.api('attendance', { method: 'POST', body: { action: action, note: note || '' } }).then(function (a) {
      a.loadedAt = Date.now(); S.attendance = a; drawChip(); MP.emit('attendance');
      MP.toast(action === 'in' ? 'ورود ثبت شد؛ روز خوبی داشته باشید' : 'خروج ثبت شد · کارکرد امروز ' + MP.duration(a.today));
      MP.audit();
    }).catch(MP.soft);
  };
  chip.onclick = function () {
    var a = S.attendance;
    if (a && a.open) MP.confirm('ثبت خروج', 'خروج در ساعت ' + J.faDigits(new Date().toTimeString().slice(0, 5)) + ' ثبت شود؟', 'ثبت خروج', false).then(function (ok) { if (ok) MP.punch('out'); });
    else MP.punch('in');
  };
  setInterval(function () { if (S.attendance && S.attendance.open && !document.hidden) { drawChip(); if (MP.visible('attendance')) drawClock(); } }, 30000);

  /* ------------------------------------------------------------ Attendance page */

  var LEAVE_STATUS = { pending: ['در انتظار', 'warn'], approved: ['تأیید شده', 'ok'], rejected: ['رد شده', 'danger'] };
  function leaveWhen(l) {
    return l.kind === 'hourly' ? J.format(l.start, false) + ' · ' + MP.timeFa(l.from_time) + ' تا ' + MP.timeFa(l.to_time)
      : J.format(l.start, false) + (l.end !== l.start ? ' تا ' + J.format(l.end, false) + ' (' + fa(J.diffDays(l.start, l.end) + 1) + ' روز)' : ' (۱ روز)');
  }
  function drawClock() {
    var c = $('#att-clock'); if (c) c.textContent = MP.clock(liveToday());
  }
  /** Time in online meetings over the last 30 days (from the meetings' attendance). */
  var meetStat = null;
  function meetCard() {
    var c = el('section', { class: 'card stat', style: { cursor: 'pointer' }, onclick: function () { MP.showView('meetings'); } }, el('small', { text: 'جلسات آنلاین ۳۰ روز اخیر' }), el('strong', { text: meetStat ? MP.duration(meetStat.minutes * 60) : '…' }), el('span', { text: meetStat ? fa(meetStat.meetings) + ' جلسه' + (meetStat.invited ? ' · دعوت به ' + fa(meetStat.invited) : '') : '' }));
    if (!meetStat) MP.api('meetings/stats', { query: { from: J.addDays(S.today, -29), to: S.today } }).then(function (r) {
      var mine = r.people.filter(function (p) { return p.user_id === S.me.id; })[0] || { minutes: 0, meetings: 0, invited: 0 };
      meetStat = mine;
      c.querySelector('strong').textContent = MP.duration(mine.minutes * 60);
      c.querySelector('span').textContent = fa(mine.meetings) + ' جلسه' + (mine.invited ? ' · دعوت به ' + fa(mine.invited) : '');
    }).catch(function () {});
    return c;
  }
  function render() {
    var body = $('#att-body'), a = S.attendance;
    if (!a) { body.replaceChildren(MP.skeleton(4)); return; }
    clearInterval(tick);
    var ws = J.weekStart(S.today), perDay = {};
    a.sessions.forEach(function (s) { if (s.user_id === S.me.id) perDay[s.date] = (perDay[s.date] || 0) + s.seconds; });
    var week = 0, bars = el('div', { class: 'week-bars' }), maxSec = 1;
    for (var i = 0; i < 7; i++) { var d0 = J.addDays(ws, i); maxSec = Math.max(maxSec, perDay[d0] || 0); }
    for (i = 0; i < 7; i++) {
      var d = J.addDays(ws, i), sec = d === S.today ? liveToday() : (perDay[d] || 0); week += sec;
      bars.append(el('div', { title: J.formatLong(d) + ': ' + MP.duration(sec) }, el('i', { class: sec ? '' : 'empty-bar', style: { height: Math.max(4, sec / Math.max(maxSec, 8 * 3600) * 100) + '%' } }), el('small', { class: 'muted', text: J.weekdays[i].slice(0, 1) })));
    }
    var month = a.sessions.filter(function (s) { return s.user_id === S.me.id; }).reduce(function (x, s) { return x + s.seconds; }, 0);
    var days = Object.keys(perDay).length;

    var top = el('div', { class: 'att-top' },
      el('section', { class: 'card punch-card' },
        el('small', { text: J.formatLong(S.today) }),
        el('div', { class: 'clock num', id: 'att-clock', text: MP.clock(liveToday()) }),
        el('small', { text: a.open ? 'حاضر از ساعت ' + MP.timeFa(a.open.check_in) : 'کارکرد امروز' }),
        a.open ? el('button', { type: 'button', class: 'btn btn-out', html: icon('logout') + 'ثبت خروج', onclick: function () { MP.punch('out').then(render); } })
          : el('button', { type: 'button', class: 'btn btn-primary', html: icon('clock') + 'ثبت ورود', onclick: function () { MP.punch('in').then(render); } })),
      el('section', { class: 'card stat' }, el('small', { text: 'کارکرد این هفته' }), el('strong', { text: MP.duration(week) }), bars),
      el('section', { class: 'card stat' }, el('small', { text: '۳۰ روز اخیر' }), el('strong', { text: MP.duration(month) }), el('span', { text: fa(days) + ' روز حضور · میانگین ' + MP.duration(days ? month / days : 0) })),
      meetCard());
    if (a.open) tick = setInterval(drawClock, 1000);

    var sessions = el('section', { class: 'card pad' }, el('h2', { class: 'card-title', text: 'ورود و خروج‌های من' }));
    var mine = a.sessions.filter(function (s) { return s.user_id === S.me.id; });
    if (!mine.length) sessions.append(MP.empty('clock', 'هنوز ورودی ثبت نشده', 'با دکمه «ثبت ورود» حضور امروز را ثبت کنید.', null, true));
    var lastDate = '';
    mine.forEach(function (s) {
      if (s.date !== lastDate) { lastDate = s.date; sessions.append(el('div', { class: 'group-title', text: J.formatLong(s.date) + ' · ' + MP.duration(perDay[s.date]) })); }
      sessions.append(el('div', { class: 'row-item' },
        el('span', { class: 'lock-ico', style: { background: 'var(--ok-soft)', color: 'var(--ok)' }, html: icon('clock') }),
        el('span', { class: 'row-main' }, el('span', { class: 'row-title', text: MP.timeFa(s.check_in) + ' تا ' + (s.open ? 'اکنون' : MP.timeFa(s.check_out)) }), s.note ? el('span', { class: 'row-meta', text: s.note }) : null),
        el('span', { class: 'chip ' + (s.open ? 'ok' : ''), text: s.open ? 'در حال کار' : MP.duration(s.seconds) })));
    });

    var leaves = el('section', { class: 'card pad' }, el('h2', { class: 'card-title', text: 'مرخصی‌های من' }), el('div', { id: 'leave-mine' }, MP.skeleton(2)));
    var parts = [top, el('div', { class: 'split' }, leaves, sessions)];
    if (S.manager) {
      parts.splice(1, 0, el('section', { class: 'card pad' }, el('div', { class: 'card-head' }, el('h2', { text: 'درخواست‌های مرخصی تیم' }), el('span', { class: 'chip warn', id: 'leave-pending-count' })), el('div', { id: 'leave-team' }, MP.skeleton(2))));
      parts.push(el('section', { class: 'card pad' }, el('h2', { class: 'card-title', text: 'حضور امروز تیم' }), el('div', { id: 'att-team' }, MP.skeleton(2))));
    }
    body.replaceChildren.apply(body, parts);
    loadLeaves();
    if (S.manager) loadTeamToday();
  }
  function leaveRow(l, managerView) {
    var st = LEAVE_STATUS[l.status];
    return el('div', { class: 'row-item leave-row' },
      managerView ? MP.avatar(MP.user(l.user_id), 'sm') : el('span', { class: 'lock-ico', style: { background: 'var(--info-soft)', color: 'var(--info)' }, html: icon('leave') }),
      el('span', { class: 'row-main', style: { cursor: 'default' } },
        el('span', { class: 'row-title' }, el('span', { text: (managerView ? l.user + ' · ' : '') + (l.kind === 'hourly' ? 'مرخصی ساعتی' : 'مرخصی روزانه') })),
        el('span', { class: 'row-meta' }, el('span', { text: leaveWhen(l) }), l.reason ? el('span', { text: '«' + l.reason + '»' }) : null,
          l.reviewer ? el('span', { text: l.reviewer + (l.review_note ? ': ' + l.review_note : '') }) : null)),
      el('span', { class: 'row-side' },
        el('span', { class: 'chip ' + st[1], text: st[0] }),
        managerView && l.status === 'pending' ? el('button', { type: 'button', class: 'btn btn-ok btn-sm', text: 'تأیید', onclick: function () { decide(l, 'approved'); } }) : null,
        managerView && l.status === 'pending' ? el('button', { type: 'button', class: 'btn btn-danger btn-sm', text: 'رد', onclick: function () { decide(l, 'rejected'); } }) : null,
        !managerView && l.can_cancel ? el('button', { type: 'button', class: 'link danger', text: 'لغو', onclick: function () {
          MP.api('leaves/' + l.id, { method: 'DELETE' }).then(function () { MP.toast('درخواست لغو شد'); loadLeaves(); MP.refreshCounts(); }).catch(MP.soft);
        } }) : null));
  }
  function loadLeaves() {
    MP.api('leaves', { query: { scope: 'mine' } }).then(function (list) {
      S.leaves = list;
      var box = $('#leave-mine'); if (!box) return;
      box.replaceChildren();
      if (!list.length) box.append(MP.empty('leave', 'درخواستی ندارید', 'مرخصی روزانه یا ساعتی درخواست دهید؛ ناظر اعلان می‌گیرد.', { text: 'درخواست مرخصی', onclick: leaveForm }, true));
      list.forEach(function (l) { box.append(leaveRow(l, false)); });
    }).catch(function () {});
    if (S.manager) MP.api('leaves').then(function (all) {
      var box = $('#leave-team'); if (!box) return;
      var pending = all.filter(function (l) { return l.status === 'pending'; }), recent = all.filter(function (l) { return l.status !== 'pending'; }).slice(0, 8);
      $('#leave-pending-count').textContent = fa(pending.length) + ' در انتظار';
      box.replaceChildren();
      if (!all.length) box.append(MP.empty('leave', 'درخواستی نیست', null, null, true));
      pending.forEach(function (l) { box.append(leaveRow(l, true)); });
      if (recent.length) { box.append(el('div', { class: 'group-title', text: 'اخیر' })); recent.forEach(function (l) { box.append(leaveRow(l, true)); }); }
    }).catch(function () {});
  }
  function decide(l, status) {
    var note = el('input', { class: 'input', maxlength: 300, placeholder: 'اختیاری' });
    var f = el('form', { class: 'form' }, el('p', { text: l.user + ' · ' + leaveWhen(l) + (l.reason ? ' · «' + l.reason + '»' : '') }), MP.field('توضیح برای کارمند', note),
      MP.actions(status === 'approved' ? 'تأیید مرخصی' : 'رد درخواست'));
    f.onsubmit = function (e) {
      e.preventDefault(); MP.busy(f, true);
      MP.api('leaves/' + l.id, { method: 'POST', body: { status: status, note: note.value } })
        .then(function () { MP.dialog.close(); MP.toast(status === 'approved' ? 'مرخصی تأیید شد' : 'درخواست رد شد'); loadLeaves(); MP.refreshCounts(); MP.audit(); })
        .catch(function (err) { MP.busy(f, false); MP.soft(err); });
    };
    MP.dialog.open(status === 'approved' ? 'تأیید مرخصی' : 'رد مرخصی', f);
  }
  function loadTeamToday() {
    MP.api('attendance', { query: { user_id: 'all', from: S.today, to: S.today } }).then(function (a) {
      var box = $('#att-team'); if (!box) return;
      box.replaceChildren();
      var grid = el('div', { class: 'people-picker', style: { maxHeight: 'none' } });
      S.users.forEach(function (u) {
        var ss = a.sessions.filter(function (s) { return s.user_id === u.id; });
        var open = ss.filter(function (s) { return s.open; })[0], total = ss.reduce(function (x, s) { return x + s.seconds; }, 0);
        grid.append(el('div', { class: 'person-opt', style: { cursor: 'default' } }, MP.avatar(u, 'sm'),
          el('span', { style: { flex: '1' } }, el('strong', { text: u.name, style: { display: 'block' } }), el('small', { class: 'muted', text: open ? 'حاضر از ' + MP.timeFa(open.check_in) : total ? 'خارج شده · ' + MP.duration(total) : 'ورود ثبت نشده' })),
          el('span', { class: 'chip ' + (open ? 'ok' : total ? '' : 'warn'), text: open ? 'حاضر' : total ? 'رفته' : 'غایب' })));
      });
      box.append(grid);
    }).catch(function () {});
  }
  function leaveForm() {
    var kind = el('div', { class: 'seg', role: 'radiogroup' },
      el('label', null, el('input', { type: 'radio', name: 'kind', value: 'daily', checked: true }), el('span', { text: 'روزانه' })),
      el('label', null, el('input', { type: 'radio', name: 'kind', value: 'hourly' }), el('span', { text: 'ساعتی' })));
    var endField = MP.dateField('end', S.today, 'تا تاریخ'), hours = el('div', { class: 'row', hidden: true },
      MP.field('از ساعت', el('input', { name: 'from_time', type: 'time', value: '10:00' })), MP.field('تا ساعت', el('input', { name: 'to_time', type: 'time', value: '12:00' })));
    var f = el('form', { class: 'form' }, el('div', { class: 'field' }, el('span', { text: 'نوع مرخصی' }), kind),
      el('div', { class: 'row' }, MP.dateField('start', S.today, 'از تاریخ', function (v) { var e = f.elements.end; if (e.value < v) { e.value = v; } }), endField), hours,
      MP.field('دلیل', el('textarea', { name: 'reason', maxlength: 500, rows: 3, placeholder: 'اختیاری' })), MP.actions('ارسال درخواست'));
    $$('input[name=kind]', f).forEach(function (r) { r.onchange = function () { var h = f.elements.kind.value === 'hourly'; hours.hidden = !h; endField.hidden = h; }; });
    f.onsubmit = function (e) {
      e.preventDefault();
      var x = f.elements, body = { kind: x.kind.value, start: x.start.value, end: x.end.value, from_time: x.from_time.value, to_time: x.to_time.value, reason: x.reason.value };
      if (body.kind === 'daily' && body.end < body.start) { MP.toast('تاریخ پایان باید بعد از شروع باشد', { error: true }); return; }
      MP.busy(f, true);
      MP.api('leaves', { method: 'POST', body: body }).then(function () { MP.dialog.close(); MP.toast('درخواست مرخصی برای ناظر ارسال شد'); loadLeaves(); MP.audit(); })
        .catch(function (err) { MP.busy(f, false); MP.soft(err); });
    };
    MP.dialog.open('درخواست مرخصی', f);
  }
  $('#leave-new').onclick = leaveForm;
  MP.view('attendance', { open: function () { render(); MP.loadAttendance().then(render); } });
  MP.on('notification', function (n) { if (n.type === 'leave' && MP.visible('attendance')) loadLeaves(); });

  /* ------------------------------------------------------------ Reminders */

  var REPEAT = { none: 'بدون تکرار', daily: 'روزانه', weekly: 'هفتگی', monthly: 'ماهانه' };
  MP.loadReminders = function () { return MP.api('reminders').then(function (l) { S.reminders = l; MP.emit('reminders'); }); };
  function reminderForm() {
    var host = $('#reminder-form-card');
    var f = el('form', { class: 'form' },
      el('h2', { class: 'card-title', text: 'یادآوری جدید' }),
      MP.smartBar({
        placeholder: 'بگویید یا بنویسید…',
        examples: ['مثلاً: «ساعت ۱۱ باید کار فلان تحویل داده شود»', 'مثلاً: «فردا ساعت ۳ و نیم جلسه با مشتری»', 'مثلاً: «هر روز ساعت ۹ گزارش روزانه»', 'مثلاً: «۱۰ آبان تمدید دامنه»'],
        parse: function (t) { return MP.Voice.parseReminder(t, { today: S.today, J: J, now: S.now }); },
        apply: function (r) {
          var x = f.elements;
          function put(input, v) { if (!v) return; input.value = v; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); var w = input.closest('.field') || input; w.classList.remove('filled'); void w.offsetWidth; w.classList.add('filled'); }
          put(x.title, r.title); put(x.time, r.time); put(x.repeat, r.repeat);
          if (r.date) { MP.setDate ? MP.setDate(x.date, r.date) : put(x.date, r.date); }
        },
        describe: function (r) {
          var out = [['«' + r.title + '»']];
          out.push([r.date ? (r.date === S.today ? 'امروز' : J.formatLong(r.date)) : 'امروز']);
          if (r.time) out.push(['ساعت ' + MP.timeFa(r.time)]); else out.push(['ساعت را نفهمیدم', 'warn']);
          if (r.repeat) out.push([REPEAT[r.repeat]]);
          return out;
        }
      }),
      MP.field('عنوان', el('input', { name: 'title', required: true, maxlength: 120, placeholder: 'مثلاً تماس با مشتری' })),
      el('div', { class: 'row' }, MP.dateField('date', S.today, 'تاریخ'), MP.field('ساعت', el('input', { name: 'time', type: 'time', required: true, value: '10:00' }))),
      MP.field('تکرار', MP.select('repeat', Object.keys(REPEAT).map(function (k) { return [k, REPEAT[k]]; }), 'none')),
      MP.field('توضیحات', el('textarea', { name: 'note', maxlength: 1000, rows: 3, placeholder: 'اختیاری' })),
      el('div', { class: 'dialog-actions' }, el('button', { type: 'submit', class: 'btn btn-primary', text: 'ذخیره یادآوری' })));
    f.onsubmit = function (e) {
      e.preventDefault();
      var x = f.elements; MP.busy(f, true);
      MP.api('reminders', { method: 'POST', body: { title: x.title.value.trim(), date: x.date.value, time: x.time.value, repeat: x.repeat.value, note: x.note.value } })
        .then(function (l) { S.reminders = l; MP.emit('reminders'); MP.busy(f, false); reminderForm(); renderReminders(); MP.refreshCounts(); MP.toast('یادآوری ذخیره شد'); })
        .catch(function (err) { MP.busy(f, false); MP.soft(err); });
    };
    host.replaceChildren(f);
  }
  function renderReminders() {
    var box = $('#reminder-list'); box.replaceChildren();
    var up = S.reminders.filter(function (r) { return !r.fired || r.repeat !== 'none'; }), past = S.reminders.filter(function (r) { return r.fired && r.repeat === 'none'; });
    if (!up.length && !past.length) { box.append(MP.empty('alarm', 'یادآوری‌ای ندارید', 'در زمان تعیین‌شده اعلان، ایمیل و پیام تلگرام/بله می‌گیرید.', null, true)); return; }
    function row(r, old) {
      return el('div', { class: 'rem-row' + (old ? ' past' : '') },
        el('span', { class: 'pop-ico', html: icon(r.repeat !== 'none' ? 'repeat' : 'alarm') }),
        el('span', { class: 'row-main', style: { cursor: 'default' } }, el('span', { class: 'row-title', text: r.title }),
          el('span', { class: 'row-meta', text: J.formatLong(r.date) + ' · ' + MP.timeFa(r.time) + (r.repeat !== 'none' ? ' · ' + REPEAT[r.repeat] : '') + (r.note ? ' · ' + r.note : '') })),
        el('button', { type: 'button', class: 'icon-btn sm danger', 'aria-label': 'حذف ' + r.title, html: icon('trash'), onclick: function () {
          var before = S.reminders.slice();
          MP.undoable('یادآوری حذف شد', function () { S.reminders = S.reminders.filter(function (x) { return x.id !== r.id; }); renderReminders(); MP.emit('reminders'); },
            function () { S.reminders = before; renderReminders(); MP.emit('reminders'); },
            function () { return MP.api('reminders/' + r.id, { method: 'DELETE' }).then(function (l) { S.reminders = l; MP.refreshCounts(); }); });
        } }));
    }
    up.forEach(function (r) { box.append(row(r)); });
    if (past.length) { box.append(el('div', { class: 'group-title', text: 'گذشته' })); past.slice(-10).reverse().forEach(function (r) { box.append(row(r, true)); }); }
  }
  MP.view('reminders', { open: function () { reminderForm(); renderReminders(); MP.loadReminders().then(renderReminders); } });
  MP.on('notification', function (n) { if (n.type === 'reminder') MP.loadReminders(); });
})();
