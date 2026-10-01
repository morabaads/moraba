/* Calendar: Jalali month with a day panel (locked manager tasks, own tasks, leave, reminders, weekly goal),
   and for managers a team week view (everyone × 7 days). */
(function () {
  'use strict';
  var MP = window.MP, S = MP.S, J = MP.J, el = MP.el, $ = MP.$, $$ = MP.$$, fa = MP.fa, icon = MP.icon;

  var st = { mode: 'person', userId: 0, view: null, selected: '', tasks: [], leaves: [], meetings: [], goal: '', goalWeek: '', teamStart: '', loading: false };
  var grid = $('#cal-grid'), panel = $('#day-panel'), userSel = $('#cal-user');

  function monthRange() {
    var f = J.toIso(st.view.jy, st.view.jm, 1);
    return { from: f, to: J.addDays(f, J.monthLength(st.view.jy, st.view.jm) - 1) };
  }
  function select(iso) { st.selected = iso; var j = J.fromIso(iso); st.view = { jy: j.jy, jm: j.jm }; }
  function isMe() { return st.userId === S.me.id; }

  function load() {
    if (!st.view) select(S.today);
    if (!st.userId) st.userId = S.me.id;
    var m = monthRange(), r = { from: J.addDays(m.from, -7), to: J.addDays(m.to, 7) };
    render();
    return Promise.all([
      MP.api('tasks', { query: { user_id: st.userId, from: r.from, to: r.to } }),
      MP.api('leaves', { query: { from: r.from, to: r.to, scope: S.manager ? '' : 'mine' } }),
      isMe() ? MP.api('meetings', { query: { from: r.from, to: r.to, mine: 1 } }).catch(function () { return []; }) : Promise.resolve([])
    ]).then(function (res) {
      st.tasks = res[0];
      st.meetings = res[2];
      st.leaves = res[1].filter(function (l) { return l.user_id === st.userId && l.status !== 'rejected'; });
      if (isMe()) res[0].forEach(function (t) { MP.upsertTask(t, true); });
      render(); loadGoal();
    }).catch(MP.soft);
  }
  function loadGoal() {
    var ws = J.weekStart(st.selected);
    st.goalWeek = ws;
    MP.api('goals', { query: { week_start: ws, user_id: st.userId } }).then(function (g) { if (st.goalWeek === ws) { st.goal = g.text; renderPanel(); } }).catch(function () {});
  }
  function leaveOn(iso) { return st.leaves.filter(function (l) { return iso >= l.start && iso <= l.end; })[0] || null; }
  function meetingsOn(iso) { return isMe() ? st.meetings.filter(function (m) { return m.date === iso; }) : []; }
  function remindersOn(iso) { return isMe() ? S.reminders.filter(function (r) { return r.date === iso && !(r.fired && r.repeat === 'none'); }) : []; }

  /* ---- Month grid */
  function compact() { return MP.isMobile() && !st.month; }
  function changeDay(iso) {
    var j = J.fromIso(iso), moved = j.jm !== st.view.jm || j.jy !== st.view.jy;
    st.selected = iso; st.view = { jy: j.jy, jm: j.jm };
    if (moved) load(); else { render(); loadGoal(); }
  }
  function dayCell(iso, strip) {
    var list = st.tasks.filter(function (t) { return t.date === iso; });
    var locked = list.filter(function (t) { return t.source === 'manager'; }).length, own = list.length - locked;
    var done = list.filter(function (t) { return t.done; }).length, leave = leaveOn(iso), rems = remindersOn(iso), meets = meetingsOn(iso);
    var cls = ['cal-day', iso === st.selected ? 'selected' : '', iso === S.today ? 'today' : '', J.weekday(iso) === 6 ? 'fri' : '', leave && leave.status === 'approved' && !strip ? 'leave' : '', list.length && done === list.length ? 'all-done' : ''].join(' ');
    var label = J.formatLong(iso) + (list.length ? '، ' + fa(list.length) + ' تسک' : '') + (locked ? '، ' + fa(locked) + ' تسک ناظر' : '') + (leave ? '، مرخصی' : '') + (rems.length ? '، یادآوری' : '') + (meets.length ? '، ' + fa(meets.length) + ' جلسه' : '');
    var click = function () {
      MP.haptic(6);
      if (strip) { changeDay(iso); return; }
      st.selected = iso; render(); loadGoal();
      if (window.innerWidth < 1180) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    if (strip) {
      var dots = el('span', { class: 'dots' });
      if (locked) dots.append(el('i', { class: 'lock' }));
      if (own) dots.append(el('i'));
      if (leave) dots.append(el('i', { class: 'leave' }));
      if (meets.length) dots.append(el('i', { class: 'meet' }));
      return el('button', { type: 'button', class: cls, dataset: { date: iso }, 'aria-pressed': String(iso === st.selected), 'aria-label': label, onclick: click },
        el('span', { class: 'wd', text: ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'][J.weekday(iso)] }),
        el('span', { class: 'd-num', text: fa(J.fromIso(iso).jd) }), dots);
    }
    var tags = el('span', { class: 'd-tags' });
    if (locked) tags.append(el('span', { class: 'd-tag lock', html: icon('lock') }, fa(locked)));
    if (own) tags.append(el('span', { class: 'd-tag', text: fa(own) + ' تسک' }));
    if (meets.length) tags.append(el('span', { class: 'd-tag meet', html: icon('video') }, fa(meets.length)));
    if (leave) tags.append(el('span', { class: 'd-tag leave', text: leave.status === 'approved' ? 'مرخصی' : 'مرخصی؟' }));
    var bar = null;
    if (list.length) { bar = el('span', { class: 'd-bar' }, el('i')); bar.firstChild.style.width = done / list.length * 100 + '%'; }
    return el('button', { type: 'button', dataset: { date: iso }, class: cls, 'aria-pressed': String(iso === st.selected), 'aria-label': label, onclick: click },
      el('span', { class: 'd-num', text: fa(J.fromIso(iso).jd) }), rems.length ? el('span', { class: 'd-rem', title: rems.map(function (r) { return r.title; }).join('، ') }) : null, tags, bar);
  }
  function render() {
    if (!st.view) return;
    if (S.manager && userSel.options.length !== S.users.length) {
      userSel.replaceChildren();
      S.users.forEach(function (u) { userSel.append(el('option', { value: u.id, text: u.id === S.me.id ? 'تقویم خودم' : u.name })); });
    }
    userSel.value = st.userId;
    var v = st.view, first = J.toIso(v.jy, v.jm, 1), len = J.monthLength(v.jy, v.jm), i, strip = compact();
    var title = $('#cal-title');
    title.textContent = J.months[v.jm - 1] + ' ' + fa(v.jy) + (isMe() ? '' : ' · ' + MP.user(st.userId).name) + (MP.isMobile() ? (strip ? ' ▾' : ' ▴') : '');
    title.setAttribute('role', MP.isMobile() ? 'button' : '');
    title.setAttribute('aria-label', MP.isMobile() ? (strip ? 'نمایش ماه کامل' : 'نمایش هفته') : '');
    grid.className = strip ? 'week-strip' : 'cal-grid';
    $('.cal-week').classList.toggle('strip-hidden', strip);
    grid.replaceChildren();
    if (strip) {
      var ws = J.weekStart(st.selected);
      for (i = 0; i < 7; i++) grid.append(dayCell(J.addDays(ws, i), true));
    } else {
      for (i = 0; i < J.weekday(first); i++) grid.append(el('span', { class: 'cal-day blank', 'aria-hidden': 'true' }));
      for (i = 1; i <= len; i++) grid.append(dayCell(J.toIso(v.jy, v.jm, i), false));
    }
    renderPanel();
  }
  $('#cal-title').addEventListener('click', function () { if (!MP.isMobile()) return; st.month = !st.month; MP.haptic(6); render(); });
  // Swipe the week strip: finger right → next week (RTL), left → previous.
  (function () {
    var sx = null;
    grid.addEventListener('pointerdown', function (e) { if (compact() && e.pointerType === 'touch') sx = e.clientX; });
    grid.addEventListener('pointerup', function (e) {
      if (sx === null) return;
      var dx = e.clientX - sx; sx = null;
      if (Math.abs(dx) > 50) {
        MP.haptic(8);
        grid.addEventListener('click', function stopClick(ev) { ev.stopPropagation(); ev.preventDefault(); }, { capture: true, once: true });
        setTimeout(function () { changeDay(J.addDays(st.selected, dx > 0 ? 7 : -7)); }, 0);
      }
    });
    grid.addEventListener('pointercancel', function () { sx = null; });
  })();

  /* ---- Day panel */
  function renderPanel() {
    var day = st.selected, other = !isMe(), who = MP.user(st.userId);
    var list = st.tasks.filter(function (t) { return t.date === day; }).sort(function (a, b) { return (a.done - b.done) || (a.time || '99').localeCompare(b.time || '99'); });
    var done = list.filter(function (t) { return t.done; }).length, pct = list.length ? Math.round(done / list.length * 100) : 0;
    var ws = J.weekStart(day), leave = leaveOn(day), rems = remindersOn(day);
    panel.replaceChildren();
    panel.append(el('div', { class: 'day-head' },
      el('div', null, el('small', { text: J.weekdays[J.weekday(day)] + (other ? ' · ' + who.name : '') }), el('strong', { text: J.format(day) })),
      el('button', { type: 'button', class: 'icon-btn accent', 'aria-label': other ? 'تعیین تسک برای ' + who.name : 'افزودن تسک', title: other ? 'تعیین تسک' : 'افزودن تسک', html: icon('plus'), onclick: quickAdd })));
    var line = el('i'); line.style.width = pct + '%';
    panel.append(el('div', null, el('div', { class: 'progress-copy' }, el('span', { text: fa(done) + ' از ' + fa(list.length) + ' کار' }), el('span', { text: fa(pct) + '٪' })), el('div', { class: 'progress-line' }, line)));
    var extra = el('div', { class: 'day-extra' });
    if (leave) extra.append(el('div', { class: 'day-note leave', html: icon('leave') }, (leave.status === 'approved' ? 'مرخصی تأییدشده' : 'درخواست مرخصی در انتظار') + (leave.kind === 'hourly' ? ' · ' + MP.timeFa(leave.from_time) + '–' + MP.timeFa(leave.to_time) : '')));
    rems.forEach(function (r) { extra.append(el('div', { class: 'day-note rem', html: icon('alarm') }, MP.timeFa(r.time) + ' · ' + r.title)); });
    meetingsOn(day).forEach(function (m) { extra.append(el('button', { type: 'button', class: 'day-note meet', html: icon('video'), onclick: function () { MP.meetingDetails(m); } }, MP.timeFa(m.time) + ' · جلسه «' + m.title + '»' + (m.status === 'live' ? ' · در حال برگزاری' : ''))); });
    if (extra.children.length) panel.append(extra);
    var box = el('div', { class: 'day-list' });
    if (!list.length) box.append(MP.empty('calendar', other ? 'برای ' + who.name + ' کاری تعیین نشده' : 'برای این روز کاری ندارید', other ? 'با + برای این روز تسک تعیین کنید.' : 'با + تسک شخصی اضافه کنید.', null, true));
    list.forEach(function (t) { var r = MP.taskRow(t, { date: false, owner: false }); if (t.id === MP.lastCreated) r.classList.add('rise'); box.append(r); });
    panel.append(box);
    panel.append(el('div', { class: 'goal-box' },
      el('div', null, el('small', { text: 'هدف هفته · ' + J.format(ws, false) + ' تا ' + J.format(J.addDays(ws, 6), false) }), el('strong', { text: st.goal || (other ? 'هدفی ثبت نشده' : 'هنوز هدفی ثبت نکرده‌اید') })),
      other ? null : el('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: st.goal ? 'ویرایش' : 'ثبت هدف', onclick: goalForm })));
  }

  function quickAdd() {
    var other = !isMe();
    if ($('.quick-add', panel)) { $('.quick-add input', panel).focus(); return; }
    var f = el('form', { class: 'quick-add' },
      el('div', { class: 'row' },
        el('input', { class: 'input', name: 'title', required: true, maxlength: 200, placeholder: other ? 'تسک برای ' + MP.user(st.userId).name : 'عنوان تسک', 'aria-label': 'عنوان تسک' }),
        el('input', { class: 'input', name: 'time', type: 'time', 'aria-label': 'ساعت' })),
      other ? el('p', { class: 'hint', html: icon('lock') + ' در تقویم ' + '<b></b>' + ' قفل خواهد بود.' }) : null,
      el('div', { class: 'dialog-actions' },
        el('button', { type: 'submit', class: 'btn btn-primary btn-sm', text: other ? 'تعیین تسک' : 'افزودن' }),
        el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'انصراف', onclick: function () { f.remove(); } }),
        el('span', { class: 'spacer' }),
        el('button', { type: 'button', class: 'link', text: 'جزئیات بیشتر…', onclick: function () { MP.taskForm({ date: st.selected, userId: st.userId, time: f.elements.time.value }); } })));
    if (other) { $('.hint b', f).textContent = MP.user(st.userId).name; $('.hint svg', f).style.display = 'inline'; }
    $('.day-list', panel).before(f);
    f.elements.title.focus();
    f.onsubmit = function (e) {
      e.preventDefault();
      var title = f.elements.title.value.trim(); if (!title) return;
      MP.busy(f, true);
      MP.api('tasks', { method: 'POST', body: { title: title, time: f.elements.time.value, date: st.selected, user_id: st.userId } })
        .then(function (t) {
          MP.lastCreated = t.id;
          st.tasks.push(t); if (t.user_id === S.me.id) MP.upsertTask(t);
          render(); MP.refreshCounts(); MP.audit();
          MP.toast(other ? 'تسک در تقویم ' + MP.user(t.user_id).name + ' ثبت شد' : 'تسک اضافه شد');
          setTimeout(quickAdd, 50);
        })
        .catch(function (err) { MP.busy(f, false); MP.soft(err); });
    };
  }
  function goalForm() {
    var input = el('input', { class: 'input', name: 'goal', maxlength: 200, value: st.goal, placeholder: 'مثلاً تحویل نسخه اول داشبورد' });
    var f = el('form', { class: 'form' }, MP.field('هدف این هفته', input), MP.actions('ذخیره'));
    f.onsubmit = function (e) {
      e.preventDefault(); MP.busy(f, true);
      MP.api('goals', { method: 'POST', body: { week_start: J.weekStart(st.selected), text: input.value } })
        .then(function (g) { st.goal = g.text; MP.dialog.close(); renderPanel(); MP.toast('هدف هفته ذخیره شد'); })
        .catch(function (err) { MP.busy(f, false); MP.soft(err); });
    };
    MP.dialog.open('هدف هفته', f);
  }

  function step(n) {
    if (compact()) { changeDay(J.addDays(st.selected, 7 * n)); return; }
    var v = st.view; v.jm += n;
    if (v.jm < 1) { v.jm = 12; v.jy--; } if (v.jm > 12) { v.jm = 1; v.jy++; }
    st.selected = v.jy === J.fromIso(S.today).jy && v.jm === J.fromIso(S.today).jm ? S.today : J.toIso(v.jy, v.jm, 1);
    load();
  }
  $('#cal-prev').onclick = function () { if (st.mode === 'team') teamStep(-7); else step(-1); };
  $('#cal-next').onclick = function () { if (st.mode === 'team') teamStep(7); else step(1); };
  $('#cal-today').onclick = function () { if (st.mode === 'team') { st.teamStart = J.weekStart(S.today); loadTeam(); } else { select(S.today); load(); } };
  $('#cal-add').onclick = function () { if (st.mode === 'team') MP.taskForm({ date: S.today }); else quickAdd(); };
  userSel.onchange = function () { st.userId = +userSel.value; load(); };
  grid.addEventListener('keydown', function (e) {
    var map = { ArrowLeft: 1, ArrowRight: -1, ArrowUp: -7, ArrowDown: 7 };
    if (!(e.key in map) || !e.target.closest('.cal-day')) return;
    e.preventDefault();
    var next = J.addDays(st.selected, map[e.key]), j = J.fromIso(next);
    st.selected = next;
    function focus() { var b = $('.cal-day.selected', grid); if (b) b.focus(); }
    if (j.jm !== st.view.jm || j.jy !== st.view.jy) { st.view = { jy: j.jy, jm: j.jm }; load().then(focus); } else { render(); loadGoal(); focus(); }
  });

  /* ---- Team week (managers) */
  function loadTeam() {
    if (!st.teamStart) st.teamStart = J.weekStart(S.today);
    var from = st.teamStart, to = J.addDays(from, 6);
    $('#team-title').textContent = J.format(from, false) + ' تا ' + J.format(to);
    $('#team-grid').replaceChildren(MP.skeleton(4));
    Promise.all([
      MP.api('tasks', { query: { user_id: 'all', from: from, to: to } }),
      MP.api('leaves', { query: { from: from, to: to } }),
      MP.api('attendance', { query: { user_id: 'all', from: from, to: to } })
    ]).then(function (res) { renderTeam(res[0], res[1].filter(function (l) { return l.status !== 'rejected'; }), res[2].sessions); }).catch(MP.soft);
  }
  function renderTeam(tasks, leaves, sessions) {
    var g = $('#team-grid'), from = st.teamStart;
    g.replaceChildren(el('div', { class: 'th', text: 'عضو تیم' }));
    for (var i = 0; i < 7; i++) {
      var d = J.addDays(from, i);
      g.append(el('div', { class: 'th' + (d === S.today ? ' today' : ''), text: J.weekdays[i] + ' ' + J.format(d, false) }));
    }
    S.users.forEach(function (u) {
      var mine = tasks.filter(function (t) { return t.user_id === u.id; });
      var open = mine.filter(function (t) { return !t.done; }).length;
      g.append(el('div', { class: 'who' }, MP.avatar(u, 'sm'), el('div', null, el('strong', { text: u.name }), el('small', { text: fa(open) + ' باز از ' + fa(mine.length) }))));
      for (var i = 0; i < 7; i++) {
        (function (d) {
          var list = mine.filter(function (t) { return t.date === d; });
          var leave = leaves.filter(function (l) { return l.user_id === u.id && d >= l.start && d <= l.end; })[0];
          var worked = sessions.filter(function (s) { return s.user_id === u.id && s.date === d; }).reduce(function (a, s) { return a + s.seconds; }, 0);
          var cell = el('div', { class: 'cell' + (leave && leave.status === 'approved' ? ' leave' : '') + (d === S.today ? ' today' : ''), role: 'button', tabindex: 0,
            'aria-label': u.name + '، ' + J.formatLong(d) + '، ' + fa(list.length) + ' تسک؛ برای تعیین تسک کلیک کنید',
            onclick: function (e) { if (e.target.closest('.t-pill')) return; MP.taskForm({ userId: u.id, date: d, title: 'تسک برای ' + u.name + ' · ' + J.format(d, false) }); },
            onkeydown: function (e) { if (e.key === 'Enter') e.currentTarget.click(); } });
          if (leave) cell.append(el('span', { class: 'chip info', text: leave.status === 'approved' ? 'مرخصی' : 'مرخصی (در انتظار)' }));
          if (worked) cell.append(el('span', { class: 'chip ok', text: MP.duration(worked) }));
          list.slice(0, 4).forEach(function (t) {
            cell.append(el('button', { type: 'button', class: 't-pill' + (t.source === 'manager' ? ' lock' : '') + (t.done ? ' done' : ''), title: t.title, onclick: function () { MP.openTask(t.id, t); } },
              t.done ? MP.iconEl('check') : null, t.title));
          });
          if (list.length > 4) cell.append(el('span', { class: 't-more', text: '+' + fa(list.length - 4) + ' تسک دیگر' }));
          g.append(cell);
        })(J.addDays(from, i));
      }
    });
  }
  function teamStep(n) { st.teamStart = J.addDays(st.teamStart || J.weekStart(S.today), n); loadTeam(); }
  $('#team-prev').onclick = function () { teamStep(-7); };
  $('#team-next').onclick = function () { teamStep(7); };
  $$('#cal-mode button').forEach(function (b) {
    b.onclick = function () {
      st.mode = b.dataset.mode;
      $$('#cal-mode button').forEach(function (x) { x.setAttribute('aria-selected', String(x === b)); });
      $('#cal-person').hidden = st.mode === 'team';
      $('#cal-team').hidden = st.mode !== 'team';
      userSel.hidden = st.mode === 'team';
      if (st.mode === 'team') loadTeam(); else load();
    };
  });

  MP.on('meetings', function () { if (MP.visible('calendar')) load(); });
  MP.view('calendar', {
    open: function (opts) {
      if (opts.date) select(opts.date);
      if (opts.userId) st.userId = opts.userId;
      if (st.mode === 'team') loadTeam(); else load();
    }
  });
  function sync(t) {
    if (!MP.visible('calendar')) return;
    if (st.mode === 'team') { loadTeam(); return; }
    if (t && t.id) {
      var i = st.tasks.findIndex(function (x) { return x.id === t.id; });
      if (t.user_id === st.userId && t.date >= monthRange().from && t.date <= monthRange().to) { if (i >= 0) st.tasks[i] = t; else st.tasks.push(t); } else if (i >= 0) st.tasks.splice(i, 1);
      render();
    } else load();
  }
  MP.on('task-local', sync);
  MP.on('task-saved', sync);
  MP.on('task-removed', function (ev) {
    var t = ev.task;
    st.tasks = st.tasks.filter(function (x) { return x.id !== t.id && !(ev.scope === 'series' && x.series && x.series === t.series && x.date >= t.date); });
    if (MP.visible('calendar')) { if (st.mode === 'team') loadTeam(); else render(); }
  });
  MP.on('task-restored', function () { if (MP.visible('calendar')) load(); });
  MP.on('reminders', function () { if (MP.visible('calendar')) render(); });
})();
