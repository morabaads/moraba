/* Dashboard: KPI cards, project timeline, progress donut, mini calendar, task list, today's meetings. */
(function () {
  'use strict';
  var MP = window.MP, S = MP.S, J = MP.J, el = MP.el, $ = MP.$, $$ = MP.$$, fa = MP.fa, icon = MP.icon;

  /* ------------------------------------------------------------ Donut (shared with projects/reports) */

  MP.donut = function (host, counts, caption) {
    var c = counts, total = c.todo + c.doing + c.done, pct = total ? Math.round(c.done / total * 100) : 0, R = 70, circ = 2 * Math.PI * R;
    var svg = '<svg viewBox="0 0 170 170" aria-hidden="true"><circle class="d-bg" cx="85" cy="85" r="' + R + '"/>' +
      '<circle class="d-doing" cx="85" cy="85" r="' + R + '" stroke-dasharray="' + (total ? (c.done + c.doing) / total * circ : 0) + ' ' + circ + '"/>' +
      '<circle class="d-done" cx="85" cy="85" r="' + R + '" stroke-dasharray="' + (total ? c.done / total * circ : 0) + ' ' + circ + '"/></svg>';
    host.replaceChildren(
      el('div', { class: 'donut', role: 'img', 'aria-label': fa(pct) + ' درصد انجام شده', html: svg },
        el('div', { class: 'donut-text' }, el('strong', { text: fa(pct) + '٪' }), el('small', { text: caption || 'انجام شده' }))),
      el('div', { class: 'donut-stats' },
        el('div', null, el('strong', { text: fa(c.done) }), el('span', null, el('i', { class: 'i-done' }), 'انجام شده')),
        el('div', null, el('strong', { text: fa(c.doing) }), el('span', null, el('i', { class: 'i-doing' }), 'در حال انجام')),
        el('div', null, el('strong', { text: fa(c.todo) }), el('span', null, el('i'), 'انجام نشده'))));
  };
  function counts(tasks) { var c = { todo: 0, doing: 0, done: 0 }; tasks.forEach(function (t) { c[t.status]++; }); return c; }

  /* ------------------------------------------------------------ KPIs */

  function renderHero() {
    var today = MP.myTasks().filter(function (t) { return t.date === S.today; });
    var done = today.filter(function (t) { return t.done; }).length, left = today.length - done;
    var overdue = MP.myTasks().filter(function (t) { return !t.done && t.date < S.today; }).length;
    var meetings = S.meetingsToday.length, pct = today.length ? Math.round(done / today.length * 100) : 0;
    var headline = !today.length ? 'امروز برنامه‌ای ثبت نشده' : left ? fa(left) + ' کار برای امروز مانده' : 'همه کارهای امروز انجام شد';
    var bits = [];
    if (meetings) bits.push(fa(meetings) + ' جلسه');
    if (overdue) bits.push(fa(overdue) + ' عقب‌افتاده');
    if (S.attendance && S.attendance.open) bits.push('حاضر از ' + MP.timeFa(S.attendance.open.check_in));
    var bar = el('i'); bar.style.width = pct + '%';
    $('#hero').replaceChildren.apply($('#hero'), [
      el('p', { text: J.formatLong(S.today) }),
      el('h2', { class: 'hero-title', text: headline }),
      bits.length ? el('p', { class: 'hero-sub', text: bits.join(' · ') }) : null,
      today.length ? el('div', { class: 'progress-line hero-bar' }, bar) : null].filter(Boolean));
  }
  function renderKpis() {
    renderHero();
    var mine = MP.myTasks(), ws = J.weekStart(S.today), lws = J.addDays(ws, -7);
    var thisWeek = mine.filter(function (t) { return t.done && t.date >= ws && t.date <= J.addDays(ws, 6); }).length;
    var lastWeek = mine.filter(function (t) { return t.done && t.date >= lws && t.date < ws; }).length;
    var openWeek = mine.filter(function (t) { return !t.done && t.date >= ws && t.date <= J.addDays(ws, 6); }).length;
    $('#kpi-week').textContent = fa(thisWeek) + ' تسک انجام شد';
    var diff = lastWeek ? Math.round((thisWeek - lastWeek) / lastWeek * 100) : null;
    $('#kpi-week-sub').textContent = diff === null ? fa(openWeek) + ' تسک باز در این هفته' : (diff >= 0 ? '▲ ' + fa(diff) + '٪ بیشتر از هفته قبل' : '▼ ' + fa(-diff) + '٪ کمتر از هفته قبل');

    var open = mine.filter(function (t) { return !t.done; }).sort(function (a, b) { return (a.date + (a.time || '99')).localeCompare(b.date + (b.time || '99')); });
    var review = open.filter(function (t) { return t.source === 'manager' && !t.seen_at; })[0] || open.filter(function (t) { return t.date <= S.today; })[0] || open[0];
    S.reviewTask = review || null;
    $('#kpi-review').textContent = review ? review.title : 'همه کارها مرتب است';
    $('#kpi-review-sub').textContent = !review ? 'کار عقب‌افتاده‌ای ندارید' : review.source === 'manager' && !review.seen_at ? 'تسک جدید از ' + (review.assigned_by || 'ناظر') :
      review.date < S.today ? 'عقب‌افتاده از ' + J.format(review.date, false) : review.date === S.today ? 'امروز' + (review.time ? ' ساعت ' + MP.timeFa(review.time) : '') : J.format(review.date, false);

    var last = null;
    S.channels.forEach(function (c) { if (c.last && !c.last.mine && (!last || c.last.id > last.msg.id)) last = { msg: c.last, channel: c }; });
    S.lastMessage = last;
    var box = $('#kpi-msg-avatar');
    if (last) {
      $('#kpi-msg').textContent = last.msg.author;
      $('#kpi-msg-sub').textContent = last.msg.body || (last.msg.file && /^audio\//.test(last.msg.file.mime) ? 'پیام صوتی' : 'فایل');
      box.replaceChildren(MP.avatar({ name: last.msg.author, avatar: last.msg.avatar }));
    } else {
      $('#kpi-msg').textContent = 'پیامی نیست'; $('#kpi-msg-sub').textContent = 'گفت‌وگوهای تیم اینجا دیده می‌شود';
      box.innerHTML = icon('chat');
    }

    var a = S.attendance;
    if (a) {
      $('#kpi-att').textContent = a.open ? 'حاضر از ' + MP.timeFa(a.open.check_in) : a.today ? MP.duration(a.today) + ' کارکرد' : 'هنوز ورود نزده‌اید';
      $('#kpi-att-sub').textContent = a.open ? 'کارکرد امروز: ' + MP.duration(a.today) : 'برای ثبت ورود کلیک کنید';
    }
  }
  $$('.kpi').forEach(function (card) {
    function go() {
      var k = card.dataset.kpi;
      if (k === 'week') MP.showView('reports');
      else if (k === 'review') { if (S.reviewTask) MP.openTask(S.reviewTask.id, S.reviewTask); else MP.showView('mytasks'); }
      else if (k === 'messages') MP.showView('messages', S.lastMessage ? { channel: S.lastMessage.channel.id } : {});
      else MP.showView('attendance');
    }
    card.onclick = go;
    card.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });

  /* ------------------------------------------------------------ Timeline */

  MP.Timeline = (function () {
    var box = $('#timeline'), world = $('#tl-world'), picker = $('#timeline-picker');
    // The view is whole Jalali months from the current one: 1 month by default, zooming out adds the
    // months ahead (2, 3, 6, 12). Dragging the empty area moves the window by days.
    var LEVELS = [1, 2, 3, 6, 12], level = 0, shift = 0, DAYS = 30, drag = null, scope = 'all', items = [];
    function monthStart(iso) { var j = J.fromIso(iso); return J.toIso(j.jy, j.jm, 1); }
    function first() { return J.addDays(monthStart(S.today), shift); }
    function span() {
      var j = J.fromIso(monthStart(S.today)), n = 0, y = j.jy, m = j.jm;
      for (var k = 0; k < LEVELS[level]; k++) { n += J.monthLength(y, m); if (++m > 12) { m = 1; y++; } }
      return n;
    }
    function x(iso) { return J.diffDays(first(), iso) / DAYS * 100; }
    function collect() {
      items = [];
      var only = S.view === 'projects' ? String(S.projectId) : scope;
      S.projects.forEach(function (p) {
        if (only !== 'all' && String(p.id) !== only) return;
        if (p.start && p.end) items.push({ kind: 'project', id: p.id, name: p.name, start: p.start, end: p.end, status: p.status, project: p });
        p.milestones.forEach(function (m) { items.push({ kind: 'milestone', id: m.id, name: m.title, start: m.start, end: m.end, status: m.status, project: p }); });
      });
    }
    function fillPicker() {
      var v = picker.value;
      picker.replaceChildren(el('option', { value: 'all', text: 'همه پروژه‌ها' }));
      S.projects.forEach(function (p) { picker.append(el('option', { value: p.id, text: p.name })); });
      picker.value = MP.project(+v) ? v : 'all'; scope = picker.value;
    }
    function render() {
      if (!box.isConnected || !box.clientWidth) return;
      collect();
      world.replaceChildren();
      DAYS = span();
      world.style.width = '100%';
      world.style.setProperty('--pan', '0px');
      $('#timeline-zoom').textContent = fa(LEVELS[level]) + ' ماه';
      // RTL time: dates run right → left. Month starts get a strong line and the month's name;
      // a one- or two-month view also gets a line every 5 days.
      var end = J.addDays(first(), DAYS), step = LEVELS[level] <= 2 ? 5 : 0;
      for (var d = first(); d <= end; d = J.addDays(d, 1)) {
        var jd = J.fromIso(d), pos = 100 - x(d);
        if (jd.jd === 1) world.append(el('i', { class: 'tl-grid month', style: { left: pos + '%' } }), el('span', { class: 'tl-label month', style: { left: pos + '%' }, text: J.format(d, false).replace(/^\S+\s/, '') + (jd.jm === 1 ? ' ' + fa(jd.jy) : '') }));
        else if (step && jd.jd % step === 1 && jd.jd < 30) world.append(el('i', { class: 'tl-grid', style: { left: pos + '%' } }), el('span', { class: 'tl-label', style: { left: pos + '%' }, text: fa(jd.jd) }));
      }
      world.append(el('i', { class: 'tl-today', style: { left: (100 - x(S.today)) + '%' }, title: 'امروز' }));
      // Each bar takes the first lane that is free at its start, so bars never overlap.
      var lanes = [], used = 0;
      items.sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; });
      items.forEach(function (it) {
        var s = Math.max(0, x(it.start)), e = Math.min(100, x(J.addDays(it.end, 1)));
        if (e <= 0 || s >= 100) return;
        var n = 0; while (lanes[n] !== undefined && lanes[n] > s - 0.5) n++;
        lanes[n] = e; used = Math.max(used, n + 1);
        var bar = el('div', {
          class: 'tl-bar' + (it.kind === 'milestone' ? ' milestone' : '') + (it.status === 'done' ? ' done' : ''), tabindex: 0, role: 'button',
          'aria-label': it.name + '، ' + J.format(it.start) + ' تا ' + J.format(it.end) + (S.manager ? '؛ برای جابه‌جایی بکشید یا کلیدهای چپ و راست' : ''),
          style: { right: s + '%', width: 'calc(' + (e - s) + '% - 4px)', top: (10 + n * 54) + 'px' }
        }, el('div', { class: 'tl-copy' }, el('strong', { text: it.name }), el('small', { text: J.format(it.start, false) + ' تا ' + J.format(it.end, false) })),
          el('span', { class: 'chip ' + (it.status === 'done' ? 'ok' : it.status === 'waiting' ? '' : 'brand'), text: MP.STATUS[it.status] }));
        bar.style.left = 'auto';
        bar.item = it;
        bar.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); show(it); }
          if (S.manager && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight')) { ev.preventDefault(); move(it, ev.key === 'ArrowLeft' ? 1 : -1); }
        });
        world.append(bar);
      });
      // Same card size as before (up to three rows); more rows scroll inside the timeline.
      var full = Math.max(200, (used || 1) * 54 + 60);
      box.style.height = Math.min(full, 3 * 54 + 60) + 'px';
      world.style.bottom = 'auto'; world.style.height = full + 'px';
      box.classList.toggle('tl-scroll', full > 3 * 54 + 60);
      $('#timeline-hint').textContent = items.length ? (S.manager ? 'فضای خالی را برای مرور بکشید · کارت را برای تغییر زمان‌بندی بکشید' : 'فضای خالی را برای مرور بکشید · روی کارت بزنید تا جزئیات را ببینید') : '';
      if (!items.length) world.append(el('div', { style: { position: 'absolute', inset: '0', display: 'grid', placeItems: 'center', direction: 'rtl' } }, MP.empty('folder', 'پروژه‌ای برای نمایش نیست', S.manager ? 'یک پروژه بسازید تا اینجا نمایش داده شود.' : 'وقتی عضو پروژه‌ای شوید اینجا می‌بینید.', null, true)));
    }
    function show(it) {
      var box2 = el('div', null,
        MP.detailRow(it.kind === 'project' ? 'پروژه' : 'مرحله از پروژه', it.project.name),
        MP.detailRow('شروع', J.formatLong(it.start)), MP.detailRow('پایان', J.formatLong(it.end)), MP.detailRow('وضعیت', MP.STATUS[it.status]),
        el('div', { class: 'dialog-actions', style: { marginTop: '16px' } },
          el('button', { class: 'btn btn-primary', type: 'button', text: 'مشاهده پروژه', onclick: function () { MP.dialog.close(); S.projectId = it.project.id; MP.showView('projects'); } }),
          S.manager && it.kind === 'milestone' ? el('button', { class: 'btn btn-secondary', type: 'button', text: 'ویرایش', onclick: function () { MP.milestoneForm(it.project, it); } }) : null));
      MP.dialog.open(it.name, box2, { focus: false });
    }
    function move(it, days) {
      var path = it.kind === 'project' ? 'projects/' + it.id : 'milestones/' + it.id;
      MP.api(path, { method: 'POST', body: { start: J.addDays(it.start, days), end: J.addDays(it.end, days) } })
        .then(function (d) { MP.applyProjects(d); MP.toast('زمان‌بندی ذخیره شد'); MP.audit(); })
        .catch(function (err) { render(); MP.soft(err); });
    }
    box.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || drag) return;
      var bar = e.target.closest('.tl-bar');
      drag = { id: e.pointerId, x: e.clientX, shift: shift, bar: bar, item: bar ? bar.item : null, dx: 0, moved: false };
      box.setPointerCapture(e.pointerId);
    });
    box.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var dx = e.clientX - drag.x;
      if (!drag.moved && Math.abs(dx) < 5) return;
      drag.moved = true; box.classList.add('dragging');
      if (drag.item && S.manager) { drag.dx = dx; drag.bar.classList.add('dragging'); drag.bar.style.transform = 'translateX(' + dx + 'px)'; }
      else if (!drag.item) { var ns = drag.shift + Math.round(dx / world.getBoundingClientRect().width * DAYS); if (ns !== shift) { shift = ns; render(); } }
    });
    function end(e) {
      if (!drag || e.pointerId !== drag.id) return;
      var d = drag; drag = null; box.classList.remove('dragging');
      if (!d.moved) { if (d.item) show(d.item); return; }
      if (d.item && S.manager && e.type !== 'pointercancel') {
        var days = Math.round(-d.dx / world.getBoundingClientRect().width * DAYS);
        if (days) move(d.item, days); else render();
      } else if (d.item) render();
    }
    box.addEventListener('pointerup', end);
    box.addEventListener('pointercancel', end);
    box.addEventListener('keydown', function (e) {
      if (e.target !== box) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); shift += e.key === 'ArrowLeft' ? 7 : -7; render(); }
    });
    $$('[data-tl]').forEach(function (b) {
      b.onclick = function () {
        var a = b.dataset.tl;
        if (a === 'reset') { shift = 0; level = 0; } else if (a === 'in') level = Math.max(0, level - 1); else level = Math.min(LEVELS.length - 1, level + 1);
        render();
      };
    });
    picker.onchange = function () { scope = picker.value; shift = 0; render(); };
    new ResizeObserver(function () { render(); }).observe(box);
    $('#timeline-add').onclick = function () {
      var p = MP.project(S.view === 'projects' ? S.projectId : +picker.value) || S.projects[0];
      if (!p) { MP.toast('ابتدا یک پروژه بسازید', { error: true }); return; }
      MP.milestoneForm(p);
    };
    MP.on('projects', function () { fillPicker(); render(); });
    return { render: render, fillPicker: fillPicker, card: $('.timeline-card') };
  })();

  MP.milestoneForm = function (p, it) {
    var form = el('form', { class: 'form' },
      it ? null : MP.field('پروژه', (function () { var s = MP.projectSelect('project_id', p.id); s.firstChild.remove(); return s; })()),
      MP.field('عنوان مرحله', el('input', { name: 'title', required: true, maxlength: 160, value: it ? it.name : '', placeholder: 'مثلاً طراحی صفحه گزارش‌ها' })),
      el('div', { class: 'row' }, MP.dateField('start', it ? it.start : S.today, 'شروع'), MP.dateField('end', it ? it.end : J.addDays(S.today, 7), 'پایان')),
      MP.field('وضعیت', MP.select('status', [['waiting', 'در انتظار'], ['doing', 'در حال انجام'], ['done', 'انجام شده']], it ? it.status : 'waiting')),
      MP.actions(it ? 'ذخیره' : 'افزودن', it ? el('button', { type: 'button', class: 'btn btn-danger', text: 'حذف', onclick: function () {
        MP.api('milestones/' + it.id, { method: 'DELETE' }).then(function (d) { MP.applyProjects(d); MP.dialog.close(); MP.toast('مرحله حذف شد'); }).catch(MP.soft);
      } }) : null));
    form.onsubmit = function (e) {
      e.preventDefault();
      var f = form.elements;
      if (f.end.value < f.start.value) { MP.toast('پایان باید بعد از شروع باشد', { error: true }); return; }
      MP.busy(form, true);
      var body = { title: f.title.value.trim(), start: f.start.value, end: f.end.value, status: f.status.value };
      (it ? MP.api('milestones/' + it.id, { method: 'POST', body: body }) : MP.api('projects/' + f.project_id.value + '/milestones', { method: 'POST', body: body }))
        .then(function (d) { MP.applyProjects(d); MP.dialog.close(); MP.toast('تایم‌لاین به‌روز شد'); })
        .catch(function (err) { MP.busy(form, false); MP.soft(err); });
    };
    MP.dialog.open(it ? 'ویرایش مرحله' : 'مرحله جدید در تایم‌لاین', form);
  };

  /* ------------------------------------------------------------ Mini calendar */

  var mini = null;
  function renderMini() {
    if (!mini) { var j = J.fromIso(S.today); mini = { jy: j.jy, jm: j.jm }; }
    var host = $('#mini-cal'), first = J.toIso(mini.jy, mini.jm, 1), len = J.monthLength(mini.jy, mini.jm), i;
    var open = {}, locked = {};
    MP.myTasks().forEach(function (t) { if (!t.done) { open[t.date] = (open[t.date] || 0) + 1; if (t.source === 'manager') locked[t.date] = 1; } });
    var leaveDays = {};
    (S.leaves || []).forEach(function (l) { if (l.status === 'approved' && l.user_id === S.me.id) for (var d = l.start; d <= l.end; d = J.addDays(d, 1)) leaveDays[d] = 1; });
    var days = el('div', { class: 'mini-days' });
    for (i = 0; i < J.weekday(first); i++) days.append(el('span'));
    for (i = 1; i <= len; i++) {
      (function (d) {
        var iso = J.toIso(mini.jy, mini.jm, d), n = open[iso] || 0;
        days.append(el('button', {
          type: 'button', text: fa(d),
          class: [iso === S.today ? 'today' : '', n ? 'has' : '', locked[iso] ? 'locked' : '', J.weekday(iso) === 6 ? 'fri' : '', leaveDays[iso] ? 'leave' : ''].join(' '),
          'aria-label': J.formatLong(iso) + (n ? '، ' + fa(n) + ' تسک باز' : '') + (leaveDays[iso] ? '، مرخصی' : ''),
          onclick: function () { MP.showView('calendar', { date: iso }); }
        }));
      })(i);
    }
    host.replaceChildren(
      el('div', { class: 'mini-head' },
        el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'ماه قبل', html: icon('right'), onclick: function () { step(-1); } }),
        el('span', { text: J.months[mini.jm - 1] + ' ' + fa(mini.jy) }),
        el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'ماه بعد', html: icon('left'), onclick: function () { step(1); } })),
      el('div', { class: 'mini-week' }, J.weekdays.map(function (w) { return el('span', { text: w.slice(0, 1) }); })),
      days);
  }
  function step(n) { mini.jm += n; if (mini.jm < 1) { mini.jm = 12; mini.jy--; } if (mini.jm > 12) { mini.jm = 1; mini.jy++; } renderMini(); }

  /* ------------------------------------------------------------ Tasks card */

  var range = 'today';
  function renderTasks() {
    var box = $('#dash-tasks');
    var items = MP.myTasks().filter(function (t) { return range === 'overdue' ? !t.done && t.date < S.today : MP.inRange(t.date, range); })
      .sort(function (a, b) { return (a.done - b.done) || (a.date + (a.time || '99')).localeCompare(b.date + (b.time || '99')); });
    box.replaceChildren();
    if (!items.length) {
      box.append(range === 'overdue' ? MP.empty('checks', 'عقب‌افتاده‌ای ندارید', 'عالی! همه کارها به‌موقع است.', null, true)
        : MP.empty('tasks', range === 'today' ? 'امروز تسکی ندارید' : 'این هفته تسکی ندارید', 'یک تسک برای خودتان اضافه کنید.', { text: 'افزودن تسک', onclick: function () { MP.taskForm(); } }, true));
      return;
    }
    items.slice(0, 40).forEach(function (t) { var r = MP.taskRow(t, { date: range !== 'today' }); if (t.id === MP.lastCreated) r.classList.add('rise'); box.append(r); });
  }
  $$('#task-range button').forEach(function (b) {
    b.onclick = function () {
      range = b.dataset.range;
      $$('#task-range button').forEach(function (x) { x.setAttribute('aria-selected', String(x === b)); });
      renderTasks();
    };
  });
  $('#dash-add-task').onclick = function () { MP.taskForm(); };

  /* ------------------------------------------------------------ Meetings */

  MP.loadMeetings = function () { return MP.api('meetings', { query: { from: S.today, to: S.today } }).then(function (l) { S.meetingsToday = l; }); };
  function nextMeeting() {
    var now = S.now || '00:00';
    return S.meetingsToday.filter(function (m) { return m.time >= now; })[0] || null;
  }
  function renderMeetings() {
    var box = $('#dash-meetings'), next = nextMeeting();
    box.replaceChildren();
    if (!S.meetingsToday.length) box.append(MP.empty('video', 'امروز جلسه‌ای ندارید', 'با + جلسه بگذارید و همکاران را دعوت کنید.', null, true));
    S.meetingsToday.forEach(function (m) {
      var people = m.people.slice(); if (people.indexOf(m.created_by) < 0) people.unshift(m.created_by);
      var stack = el('span', { class: 'stack' });
      people.slice(0, 3).forEach(function (id) { stack.append(MP.avatar(MP.user(id), 'sm')); });
      box.append(el('button', { type: 'button', class: 'meeting-row' + (next && m.id === next.id ? ' next' : ''), onclick: function () { meetingDetails(m); } },
        el('span', { class: 'meeting-time num', text: MP.timeFa(m.time) }),
        el('span', { style: { flex: '1', minWidth: '0' } }, el('strong', { text: m.title }), el('small', { text: people.map(function (id) { return MP.user(id).name; }).join('، ') })),
        stack));
    });
    var join = $('#join-meeting');
    join.disabled = !next;
    $('span', join).textContent = next ? (next.url ? 'پیوستن به «' + next.title + '» ساعت ' + MP.timeFa(next.time) : 'جلسه بعدی ساعت ' + MP.timeFa(next.time)) : 'جلسه‌ای در پیش نیست';
    join.onclick = function () { if (next) { if (next.url) openUrl(next.url); else meetingDetails(next); } };
  }
  function openUrl(url) {
    try { var u = new URL(url); if (u.protocol === 'https:' || u.protocol === 'http:') { window.open(u.href, '_blank', 'noopener,noreferrer'); return; } } catch (e) { /* invalid */ }
    MP.toast('لینک جلسه معتبر نیست', { error: true });
  }
  function meetingDetails(m) {
    var people = m.people.map(function (id) { return MP.user(id).name; });
    MP.dialog.open(m.title, el('div', null,
      MP.detailRow('زمان', J.formatLong(m.date) + ' · ساعت ' + MP.timeFa(m.time)),
      MP.detailRow('برگزارکننده', MP.user(m.created_by).name),
      people.length ? MP.detailRow('شرکت‌کنندگان', people.join('، ')) : null,
      m.project_id && MP.project(m.project_id) ? MP.detailRow('پروژه', MP.project(m.project_id).name) : null,
      el('div', { class: 'dialog-actions', style: { marginTop: '16px' } },
        m.url ? el('button', { class: 'btn btn-primary', type: 'button', html: icon('video') + 'ورود به جلسه', onclick: function () { openUrl(m.url); } }) : null,
        m.can_delete ? el('button', { class: 'btn btn-danger', type: 'button', text: 'لغو جلسه', onclick: function () {
          MP.confirm('لغو جلسه', 'جلسه «' + m.title + '» لغو شود؟ به شرکت‌کنندگان اطلاع داده می‌شود.', 'لغو جلسه').then(function (ok) {
            if (ok) MP.api('meetings/' + m.id, { method: 'DELETE' }).then(function () { MP.toast('جلسه لغو شد'); return MP.loadMeetings(); }).then(renderMeetings).catch(MP.soft);
          });
        } }) : null)), { focus: false });
  }
  MP.meetingForm = function (preset) {
    preset = preset || {};
    var form = el('form', { class: 'form' },
      MP.field('عنوان جلسه', el('input', { name: 'title', required: true, maxlength: 160, placeholder: 'مثلاً بررسی طراحی داشبورد', value: preset.title || '' })),
      el('div', { class: 'row' }, MP.dateField('date', S.today, 'تاریخ'), MP.field('ساعت', el('input', { name: 'time', type: 'time', required: true }))),
      el('div', { class: 'field' }, el('span', { text: 'شرکت‌کنندگان' }), MP.peoplePicker('people', preset.people || [], [S.me.id])),
      el('div', { class: 'row' },
        MP.field('پروژه', MP.projectSelect('project_id', preset.projectId || 0)),
        MP.field('لینک جلسه (اختیاری)', el('input', { name: 'url', type: 'url', placeholder: 'https://…', dir: 'ltr' }))),
      MP.actions('ثبت و دعوت'));
    form.onsubmit = function (e) {
      e.preventDefault();
      var f = form.elements, url = f.url.value.trim();
      if (url) { try { if (['http:', 'https:'].indexOf(new URL(url).protocol) < 0) throw new Error(); } catch (err) { f.url.setCustomValidity('لینک باید با https یا http شروع شود'); f.url.reportValidity(); return; } }
      MP.busy(form, true);
      MP.api('meetings', { method: 'POST', body: { title: f.title.value.trim(), date: f.date.value, time: f.time.value, url: url, project_id: +f.project_id.value, people: MP.checked(form, 'people') } })
        .then(function () { MP.dialog.close(); MP.toast('جلسه ثبت شد و به شرکت‌کنندگان اطلاع داده شد'); return MP.loadMeetings(); })
        .then(renderMeetings)
        .catch(function (err) { MP.busy(form, false); MP.soft(err); });
    };
    form.elements.url.oninput = function () { form.elements.url.setCustomValidity(''); };
    MP.dialog.open('جلسه جدید', form, { wide: true });
  };
  $('#add-meeting').onclick = function () { MP.meetingForm(); };

  /* ------------------------------------------------------------ View */

  function render() {
    renderKpis(); MP.donut($('#dash-progress'), counts(MP.myTasks()), 'تسک‌های من'); renderMini(); renderTasks(); renderMeetings();
    $('.dash-grid').insertBefore(MP.Timeline.card, $('.progress-card'));
    requestAnimationFrame(MP.Timeline.render);
  }
  MP.view('dashboard', { open: render });
  MP.on('tasks', function () { if (MP.visible('dashboard')) { renderKpis(); MP.donut($('#dash-progress'), counts(MP.myTasks()), 'تسک‌های من'); renderMini(); renderTasks(); } });
  MP.on('attendance', function () { if (MP.visible('dashboard')) renderKpis(); });
  MP.on('channels', function () { if (MP.visible('dashboard')) renderKpis(); });
  MP.on('day', function () { mini = null; MP.loadMeetings().then(function () { if (MP.visible('dashboard')) render(); }); });
  MP.on('notification', function (n) {
    if (n.type === 'task' || n.type === 'project') MP.loadTasks().then(MP.loadProjects);
    if (n.type === 'meeting') MP.loadMeetings().then(function () { if (MP.visible('dashboard')) renderMeetings(); });
  });
  setInterval(function () { if (MP.visible('dashboard') && !document.hidden) renderMeetings(); }, 60000);
})();
