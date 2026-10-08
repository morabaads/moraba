/* Tasks: create/edit form, detail dialog (status, checklist, timer, files, comments, "seen"), shared rows, My tasks page. */
(function () {
  'use strict';
  var MP = window.MP, S = MP.S, J = MP.J, el = MP.el, $ = MP.$, $$ = MP.$$, fa = MP.fa, icon = MP.icon;

  /* ------------------------------------------------------------ Status changes (optimistic) */

  MP.setStatus = function (t, status) {
    var before = Object.assign({}, t);
    var local = Object.assign({}, t, { status: status, done: status === 'done' });
    if (local.user_id === S.me.id) MP.upsertTask(local);
    MP.emit('task-local', local);
    return MP.api('tasks/' + t.id, { method: 'POST', body: { status: status } })
      .then(function (saved) {
        if (saved.user_id === S.me.id) MP.upsertTask(saved);
        MP.emit('task-saved', saved);
        if (status === 'done') MP.toast('آفرین! تسک انجام شد', { icon: 'check' });
        MP.refreshCounts();
        return saved;
      })
      .catch(function (err) { if (before.user_id === S.me.id) MP.upsertTask(before); MP.emit('task-saved', before); MP.soft(err); return before; });
  };
  MP.toggleTask = function (t, btn) {
    if (btn) { btn.classList.add('pop'); setTimeout(function () { btn.classList.remove('pop'); }, 400); }
    return MP.setStatus(t, t.done ? 'todo' : 'done');
  };
  /** Delete with undo; recurring tasks ask whether to delete only this one or the rest of the series. */
  MP.deleteTask = function (t, done) {
    function run(scope) {
      var removed = [];
      MP.undoable(scope === 'series' ? 'تسک و تکرارهای بعدی آرشیو شد' : 'تسک آرشیو شد',
        function () {
          S.tasks = S.tasks.filter(function (x) {
            var hit = x.id === t.id || (scope === 'series' && x.series && x.series === t.series && x.date >= t.date);
            if (hit) removed.push(x);
            return !hit;
          });
          MP.emit('tasks'); MP.emit('task-removed', { task: t, scope: scope });
        },
        function () { S.tasks = S.tasks.concat(removed); MP.emit('tasks'); MP.emit('task-restored', t); },
        function () { return MP.api('tasks/' + t.id, { method: 'DELETE', query: { scope: scope } }).then(function () { MP.refreshCounts(); MP.audit(); }); });
      if (done) done();
    }
    if (t.recurrence && t.recurrence !== 'none') {
      MP.dialog.open('آرشیو تسک تکرارشونده', el('div', null,
        el('p', { text: '«' + t.title + '» بخشی از یک سری تکرارشونده است.', style: { marginBottom: '16px' } }),
        el('div', { class: 'dialog-actions' },
          el('button', { type: 'button', class: 'btn btn-danger', text: 'فقط همین', onclick: function () { MP.dialog.close(); run('one'); } }),
          el('button', { type: 'button', class: 'btn btn-danger', text: 'این و تکرارهای بعدی', onclick: function () { MP.dialog.close(); run('series'); } }),
          el('button', { type: 'button', class: 'btn btn-ghost', text: 'انصراف', onclick: MP.dialog.close }))));
      return;
    }
    MP.dialog.close();
    run('one');
  };
  MP.audit = function () { MP.emit('audit'); };

  /**
   * Task description, tidy: «key: value» lines from an Excel import become small chips (the internal
   * شناسه is hidden), «• …» lines become a list of sub-task details, the rest stays as text.
   */
  var META = { 'زمان (دقیقه)': ['clock', function (v) { return v + ' دقیقه'; }], 'ددلاین پروژه': ['target', function (v) { return 'ددلاین: ' + v; }], 'ددلاین امروز': ['alarm', function (v) { return /بله/.test(v) ? 'تحویل امروز' : v; }], 'وضعیت': ['ban', function (v) { return v; }], 'درصد پیشرفت': ['checks', function (v) { return fa(v) + '٪'; }], 'هدف روز': ['target', function (v) { return 'هدف تیم: ' + v; }], 'پروژه': ['folder', function (v) { return v; }] };
  MP.describe = function (text) {
    var box = el('div', { class: 'td-desc' }), chips = el('div', { class: 'td-desc-chips' }), list = el('ul', { class: 'td-desc-list' }), rest = [];
    String(text).split('\n').forEach(function (line) {
      var m = line.match(/^([^:]{2,24}): (.+)$/);
      if (m && (m[1] === 'شناسه' || m[1] === 'هفته' || m[1] === 'اولویت')) return;
      if (m && META[m[1]]) { chips.append(el('span', { class: 'chip', html: icon(META[m[1]][0]) }, META[m[1]][1](m[2]))); return; }
      var b = line.match(/^• (.+?)(?: — (.+))?$/);
      if (b) { list.append(el('li', null, el('span', { text: b[1] }), b[2] ? el('small', { text: b[2] }) : null)); return; }
      rest.push(line);
    });
    var txt = rest.join('\n').trim();
    if (chips.children.length) box.append(chips);
    // The sub-tasks are already the checklist; their outputs and times stay folded away.
    if (list.children.length) box.append(el('details', { class: 'td-desc-more' }, el('summary', { text: 'خروجی و زمان هر مورد (' + fa(list.children.length) + ')' }), list));
    if (txt) box.append(el('p', { text: txt }));
    return box;
  };

  /* ------------------------------------------------------------ Shared task row */

  /** opts: {date:true show date, onOpen} */
  MP.taskRow = function (t, opts) {
    opts = opts || {};
    var p = MP.project(t.project_id), overdue = !t.done && t.date < S.today;
    var sec = t.section_id ? MP.section(t.section_id) : null;
    var meta = [];
    // Inside a project's own page the section leads (the project is obvious); elsewhere: project › section.
    if (opts.project === false && p) meta.push(sec ? el('span', { class: 'chip sec-chip', title: 'بخش پروژه', html: icon('grid') + '<b></b>' }) : el('span', { class: 'sec-none', text: 'بدون بخش' }));
    if (opts.project === false && sec) meta[0].lastChild.textContent = sec.title;
    if (opts.date !== false) meta.push(el('span', { class: 'due' }, J.format(t.date, false) + (overdue ? ' · عقب‌افتاده' : '')));
    if (t.time) meta.push(el('span', { class: 'meta-ico', html: icon('clock') }, MP.timeFa(t.time)));
    if (p && opts.project !== false) meta.push(el('span', { class: 'meta-ico', html: icon('folder'), title: sec ? 'پروژه › بخش' : 'پروژه' }, p.name + (sec ? ' › ' + sec.title : '')));
    if (t.items_total) meta.push(el('span', { class: 'meta-ico', html: icon('list') }, fa(t.items_done) + '/' + fa(t.items_total)));
    if (t.comments) meta.push(el('span', { class: 'meta-ico', html: icon('chat') }, fa(t.comments)));
    if (t.files) meta.push(el('span', { class: 'meta-ico', html: icon('clip') }, fa(t.files)));
    if (t.recurrence !== 'none') meta.push(el('span', { class: 'meta-ico', html: icon('repeat') }));
    if (t.timer_started) meta.push(el('span', { class: 'chip ok' }, '● در حال کار'));
    if (t.user_id !== S.me.id && opts.owner !== false) meta.push(el('span', { class: 'meta-ico', html: icon('user') }, MP.user(t.user_id).name));
    var tick = el('button', {
      type: 'button', class: 'tick' + (t.done ? ' on' : t.status === 'doing' ? ' doing' : ''), html: icon('check'),
      disabled: !t.can_status, 'aria-pressed': String(t.done), 'aria-label': (t.done ? 'برگرداندن ' : 'انجام شد: ') + t.title,
      onclick: function (e) { e.stopPropagation(); MP.toggleTask(t, tick); }
    });
    var row = el('div', { class: 'task-row' + (t.done ? ' done' : '') + (t.source === 'manager' ? ' locked' : '') + (overdue ? ' overdue' : ''), dataset: { id: t.id } },
      tick,
      el('button', { type: 'button', class: 'row-main', onclick: function () { MP.openTask(t.id, t); } },
        el('span', { class: 'row-title' }, t.source === 'manager' ? el('span', { class: 'lock-ico', title: 'تعیین‌شده توسط ناظر', html: icon('lock') }) : null,
          el('span', { text: t.title }), t.priority === 'high' ? el('span', { class: 'chip danger', text: 'فوری' }) : null,
          t.client_hidden && t.project_id ? el('span', { class: 'chip', title: 'در پرتال مشتری نمایش داده نمی‌شود', text: 'مخفی از مشتری' }) : null,
          t.source === 'client' ? el('span', { class: 'chip brand', title: 'مشتری این کار را از پرتال اضافه کرده', text: 'از طرف مشتری' }) : null,
          t.source === 'manager' && !t.seen_at && t.user_id === S.me.id ? el('span', { class: 'chip lock', text: 'جدید' }) : null),
        meta.length ? el('span', { class: 'row-meta' }, meta) : null));
    return MP.swipeable(row, {
      right: t.can_status ? { icon: 'check', label: t.done ? 'برگرداندن' : 'انجام شد', run: function () { MP.toggleTask(t, tick); } } : { icon: 'eye', label: 'جزئیات', run: function () { MP.openTask(t.id, t); } },
      left: { icon: 'eye', label: 'جزئیات', run: function () { MP.openTask(t.id, t); } }
    });
  };

  /**
   * Touch swipe on a row: finger right runs opts.right (revealed on the left), finger left runs opts.left.
   * Vertical movement is left to the browser (touch-action: pan-y), so scrolling stays smooth.
   */
  MP.swipeable = function (row, opts) {
    var wrap = el('div', { class: 'swipe-wrap' },
      el('div', { class: 'swipe-bg', 'aria-hidden': 'true' },
        el('span', { class: 'sb-right' }, MP.iconEl(opts.left.icon), opts.left.label),
        el('span', { class: 'sb-left' }, MP.iconEl(opts.right.icon), opts.right.label)),
      row);
    var st = null, LIMIT = 88;
    function suppress(ev) { ev.stopPropagation(); ev.preventDefault(); }
    row.addEventListener('pointerdown', function (e) { if (e.pointerType === 'touch') st = { x: e.clientX, y: e.clientY, id: e.pointerId, dx: 0, on: false }; });
    row.addEventListener('pointermove', function (e) {
      if (!st || e.pointerId !== st.id) return;
      var dx = e.clientX - st.x, dy = e.clientY - st.y;
      if (!st.on) {
        if (Math.abs(dy) > 10) { st = null; return; }
        if (Math.abs(dx) < 14) return;
        st.on = true; try { row.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ } row.style.transition = 'none';
      }
      st.dx = dx;
      var shown = Math.sign(dx) * Math.min(Math.abs(dx), LIMIT + (Math.abs(dx) - LIMIT) * 0.25 * (Math.abs(dx) > LIMIT));
      row.style.transform = 'translateX(' + shown + 'px)';
      wrap.classList.toggle('reveal-left', dx > 0);
      wrap.classList.toggle('reveal-right', dx < 0);
      var armed = Math.abs(dx) > LIMIT;
      if (armed && !wrap.classList.contains('armed')) MP.haptic(12);
      wrap.classList.toggle('armed', armed);
    });
    function end(e) {
      if (!st || e.pointerId !== st.id) return;
      var s = st; st = null;
      if (!s.on) return;
      row.style.transition = 'transform .28s cubic-bezier(.2,.8,.2,1)';
      row.style.transform = '';
      setTimeout(function () { wrap.classList.remove('reveal-left', 'reveal-right', 'armed'); }, 260);
      row.addEventListener('click', suppress, true);
      setTimeout(function () { row.removeEventListener('click', suppress, true); }, 350);
      if (Math.abs(s.dx) > LIMIT) (s.dx > 0 ? opts.right : opts.left).run();
    }
    row.addEventListener('pointerup', end);
    row.addEventListener('pointercancel', function () { if (st && st.on) { row.style.transition = 'transform .2s'; row.style.transform = ''; wrap.classList.remove('reveal-left', 'reveal-right', 'armed'); } st = null; });
    return wrap;
  };

  /* ------------------------------------------------------------ Create / edit form */

  MP.taskForm = function (opts) {
    opts = opts || {};
    var t = opts.task || null;
    var form = el('form', { class: 'form' });
    if (!t) form.append(MP.smartBar({
      placeholder: 'بگویید یا بنویسید…',
      examples: S.manager ? ['«برای رضا تماس با مشتری فردا ساعت ۱۰ فوری»', '«برای علی و مهدی گزارش هفتگی پنجشنبه»'] : ['«فردا ساعت ۱۰ طراحی صفحه ورود»', '«پنجشنبه گزارش هفتگی فوری»'],
      parse: parseTasksText,
      apply: function (r) {
        var g = r[0], many = r.length > 1 || g.tasks.length > 1 || g.dates.length > 1;
        if (many && S.manager) { var txt = $('.smart-input', form).value; setTimeout(function () { MP.voiceTasks(txt); }, 50); return; }
        var f = form.elements;
        function put(input, v) { if (v === undefined || v === null || v === '') return; input.value = v; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); var w = input.closest('.field') || input; w.classList.remove('filled'); void w.offsetWidth; w.classList.add('filled'); }
        put(f.title, g.tasks[0]); put(f.time, g.time); put(f.priority, g.priority); if (g.priority === 'high') { var m = $('.tf-more', form); if (m) m.open = true; }
        if (g.project_id) { put(f.project_id, String(g.project_id)); ss.fill(g.project_id); }
        if (g.dates[0]) MP.setDate(f.date, g.dates[0]);
        if (S.manager && g.user_ids.length) $$('input[name=assignees]', form).forEach(function (c) { c.checked = g.user_ids.indexOf(+c.value) >= 0; });
      },
      describe: function (r) {
        var g = r[0], many = r.length > 1 || g.tasks.length > 1 || g.dates.length > 1;
        if (many && S.manager) return [['چند تسک؛ پیش‌نمایش گروهی باز می‌شود']];
        var out = [];
        if (g.tasks[0]) out.push(['«' + g.tasks[0] + '»']);
        if (S.manager) out.push([g.user_ids.map(function (u) { return MP.user(u).name; }).join('، ')]);
        if (g.dates[0]) out.push([g.dates[0] === S.today ? 'امروز' : J.formatLong(g.dates[0])]);
        if (g.time) out.push(['ساعت ' + MP.timeFa(g.time)]);
        if (g.priority === 'high') out.push(['فوری', 'out']);
        return out;
      }
    }));
    /* ---- The essentials: what, who, when, checklist. Everything else sits under «تنظیمات بیشتر». */
    form.classList.add('tf');
    form.append(el('label', { class: 'tf-titlebox' }, el('span', { class: 'tf-label', html: icon('tasks') + 'عنوان تسک' + '<em>ضروری</em>' }), el('input', { name: 'title', class: 'tf-title', required: true, maxlength: 200, value: t ? t.title : (opts.taskTitle || ''), placeholder: 'چه کاری باید انجام شود؟', autocomplete: 'off', 'aria-label': 'عنوان تسک' })));
    if (S.manager) {
      if (t) form.append(el('div', { class: 'tf-sec' }, el('span', { class: 'tf-label', html: icon('user') + 'مسئول انجام' }), el('div', { class: 'tf-people' }, MP.peoplePicker('assignees', [t.user_id])),
        el('small', { class: 'tf-note', html: icon('plus') + ' با انتخاب نفرات بیشتر، یک نسخه از همین تسک برای هر کدام ساخته می‌شود.' })));
      else form.append(el('div', { class: 'tf-sec' }, el('span', { class: 'tf-label', html: icon('user') + 'مسئول انجام' }), el('div', { class: 'tf-people' }, MP.peoplePicker('assignees', [opts.userId || S.me.id])),
        el('small', { class: 'tf-note', html: icon('lock') + ' برای دیگران قفل است: عنوان و موعد را فقط ناظر تغییر می‌دهد.' })));
    }
    // When: quick picks + exact date and time.
    var dateF = MP.dateField('date', t ? t.date : (opts.date || S.today), 'تاریخ');
    var timeI = el('input', { name: 'time', type: 'time', value: t ? t.time : (opts.time || ''), 'aria-label': 'ساعت' });
    var quickDays = [['امروز', S.today], ['فردا', J.addDays(S.today, 1)], ['پس‌فردا', J.addDays(S.today, 2)], ['هفته بعد', J.addDays(S.today, 7)]];
    var dayChips = el('div', { class: 'tf-days' }), timeChips = el('div', { class: 'tf-chips' });
    function markDays() { var v = form.elements.date.value; $$(".tf-day", dayChips).forEach(function (b) { b.classList.toggle('on', b.dataset.d === v); }); }
    function markTimes() { $$('button', timeChips).forEach(function (b) { b.classList.toggle('on', b.dataset.t === timeI.value); }); }
    quickDays.forEach(function (q) {
      dayChips.append(el('button', { type: 'button', class: 'tf-day', 'data-d': q[1], onclick: function () { MP.setDate(form.elements.date, q[1]); markDays(); } },
        el('b', { text: q[0] }), el('small', { text: J.weekdays[J.weekday(q[1])] + ' ' + J.format(q[1], false) })));
    });
    timeI.addEventListener('input', markTimes);
    form.append(el('div', { class: 'tf-sec' }, el('span', { class: 'tf-label', html: icon('calendar') + 'موعد' }),
      dayChips, el('div', { class: 'tf-when' }, dateF, el('label', { class: 'field tf-time' }, el('span', { text: 'ساعت (اختیاری)' }), timeI))));
    setTimeout(function () { markDays(); markTimes(); var h = form.elements.date; h.addEventListener('change', markDays); }, 0);
    // Checklist: one line each, Enter adds the next.
    var cl = el('textarea', { name: 'checklist', hidden: true });
    var items = el('div', { class: 'tf-items' });
    var removed = [];
    function itemRow(v, it) {
      var inp = el('input', { value: v || '', placeholder: 'مورد چک‌لیست…', maxlength: 200 });
      var box = el('button', { type: 'button', class: 'tf-box' + (it && it.done ? ' done' : ''), 'aria-label': 'انجام شد', html: it && it.done ? icon('check') : '', onclick: function () { if (!it) return; it.done = !it.done; box.classList.toggle('done', it.done); box.innerHTML = it.done ? icon('check') : ''; } });
      var row = el('div', { class: 'tf-item' }, box, inp, el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'حذف', html: icon('close'), onclick: function () { if (it) removed.push(it.id); row.remove(); } }));
      if (it) { row.item = it; row.dataset.orig = it.text; it.wasDone = !!it.done; it.done = !!it.done; }
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); var n = itemRow(''); row.after(n); $('input', n).focus(); }
        if (e.key === 'Backspace' && !inp.value && items.children.length > 1) { e.preventDefault(); var prev = row.previousElementSibling; row.remove(); if (prev) $('input', prev).focus(); }
      });
      return row;
    }
    if (t) MP.api('tasks/' + t.id + '/detail').then(function (d) { (d.items || []).forEach(function (it) { items.append(itemRow(it.text, it)); }); if (!items.children.length) items.append(itemRow('')); }).catch(function () { items.append(itemRow('')); });
    {
      form.append(el('div', { class: 'tf-sec' }, el('span', { class: 'tf-label', html: icon('checks') + 'چک‌لیست' }), items,
        el('button', { type: 'button', class: 'chip-btn', html: icon('plus') + ' مورد', onclick: function () { var n = itemRow(''); items.append(n); $('input', n).focus(); } }), cl));
    }
    // Everything optional.
    var ps = MP.projectSelect('project_id', t ? t.project_id : (opts.projectId || 0));
    var ss = MP.sectionSelect('section_id', t ? t.project_id : (opts.projectId || 0), t ? t.section_id : (opts.sectionId || 0));
    ps.onchange = function () { ss.fill(ps.value); };
    var pri = el('input', { type: 'hidden', name: 'priority', value: t ? t.priority : 'medium' });
    var priSeg = el('div', { class: 'tf-chips' }, [['high', 'فوری'], ['medium', 'متوسط'], ['low', 'کم']].map(function (q) {
      return el('button', { type: 'button', class: 'tf-chip pri-' + q[0] + (pri.value === q[0] ? ' on' : ''), text: q[1], onclick: function () { pri.value = q[0]; $$('button', priSeg).forEach(function (b) { b.classList.toggle('on', b === this); }, this); } });
    }));
    pri.addEventListener('input', function () { $$('button', priSeg).forEach(function (b, i) { b.classList.toggle('on', ['high', 'medium', 'low'][i] === pri.value); }); });
    var adv = el('details', { class: 'tf-more', open: !!(t && (t.project_id || t.description)) || !!opts.projectId },
      el('summary', null, el('span', { html: icon('settings') + ' تنظیمات بیشتر' }), el('small', { text: 'پروژه، اولویت، تکرار، توضیحات' + (t ? '، وضعیت' : '') })));
    adv.append(el('div', { class: 'row' }, MP.field('پروژه', ps), MP.field('بخش', ss)));
    adv.append(el('div', { class: 'field' }, el('span', { text: 'اولویت' }), priSeg, pri));
    adv.append(el('label', { class: 'check-row tf-hide' }, el('input', { type: 'checkbox', name: 'client_hidden', checked: !!(t && t.client_hidden) }),
      el('span', null, el('b', { text: 'مخفی از مشتری' }), el('small', { text: ' — در پرتال مشتری و درصد پیشرفت پروژه حساب نمی‌شود (کارهای داخلی تیم).' }))));
    if (!t) {
      var until = MP.dateField('recur_until', J.addDays(opts.date || S.today, 30), 'تکرار تا');
      until.hidden = true;
      var rec = MP.select('recurrence', Object.keys(MP.RECUR).map(function (k) { return [k, MP.RECUR[k]]; }), 'none');
      rec.onchange = function () { until.hidden = rec.value === 'none'; };
      adv.append(el('div', { class: 'row' }, MP.field('تکرار', rec), until));
    }
    var st = MP.select('status', [['todo', 'انجام نشده'], ['doing', 'در حال انجام'], ['done', 'انجام شده']], t ? t.status : 'todo');
    if (t) adv.append(MP.field('وضعیت', st)); else { st.hidden = true; adv.append(st); }
    adv.append(MP.field('توضیحات', el('textarea', { name: 'description', maxlength: 4000, rows: 3, placeholder: 'جزئیات، لینک‌ها یا معیار انجام…' }, t ? t.description : '')));
    form.append(adv);
    if (!t) items.append(itemRow(''));
    form.append(MP.actions(t ? 'ذخیره تغییرات' : 'ثبت تسک', t ? el('button', { type: 'button', class: 'btn btn-danger', text: 'آرشیو', onclick: function () { MP.deleteTask(t); } }) : null));
    form.onsubmit = function (e) {
      e.preventDefault();
      var f = form.elements;
      var body = { title: f.title.value.trim(), date: f.date.value, time: f.time.value, project_id: +f.project_id.value, section_id: +f.section_id.value, priority: f.priority.value, status: f.status.value, description: f.description.value, client_hidden: f.client_hidden.checked };
      if (!body.title) { f.title.setCustomValidity('عنوان تسک را وارد کنید'); f.title.reportValidity(); return; }
      if (!t) {
        body.recurrence = f.recurrence.value; body.recur_until = f.recur_until.value;
        body.checklist = $$('.tf-item input', form).map(function (x) { return x.value.trim(); }).filter(Boolean);
        if (S.manager) { body.user_ids = MP.checked(form, 'assignees'); if (!body.user_ids.length) { MP.toast('حداقل یک نفر را انتخاب کنید', { error: true }); return; } }
      } else if (S.manager) {
        var who = MP.checked(form, 'assignees');
        if (!who.length) { MP.toast('حداقل یک نفر را انتخاب کنید', { error: true }); return; }
        body.user_id = who.indexOf(t.user_id) >= 0 ? t.user_id : who[0];
        var extra = who.filter(function (u) { return u !== body.user_id; });
      }
      MP.busy(form, true);
      var syncItems = function (saved) {
        if (!t) return saved;
        var jobs = removed.map(function (id) { return function () { return MP.api('task-items/' + id, { method: 'DELETE' }); }; });
        $$('.tf-item', items).forEach(function (row) {
          var txt = $('input', row).value.trim(), it = row.item;
          if (!it && txt) jobs.push(function () { return MP.api('tasks/' + t.id + '/items', { method: 'POST', body: { text: txt } }); });
          else if (it && txt && (txt !== row.dataset.orig || it.done !== it.wasDone)) jobs.push(function () { return MP.api('task-items/' + it.id, { method: 'POST', body: { text: txt, done: it.done } }); });
          else if (it && !txt) jobs.push(function () { return MP.api('task-items/' + it.id, { method: 'DELETE' }); });
        });
        return jobs.reduce(function (p, j) { return p.then(j); }, Promise.resolve()).then(function () { return saved; });
      };
      // Extra people on edit get their own copy (with the same checklist).
      var copies = function (saved) {
        if (!t || !extra || !extra.length) return saved;
        var c = Object.assign({}, body, { user_ids: extra, recurrence: 'none', checklist: $$('.tf-item input', form).map(function (x) { return x.value.trim(); }).filter(Boolean) });
        delete c.user_id;
        return MP.api('tasks', { method: 'POST', body: c }).then(function () { MP.toast('برای ' + extra.map(function (u) { return MP.user(u).name; }).join('، ') + ' هم ساخته شد'); return saved; });
      };
      (t ? MP.api('tasks/' + t.id, { method: 'POST', body: body }).then(syncItems).then(copies) : MP.api('tasks', { method: 'POST', body: body }))
        .then(function (saved) {
          MP.dialog.close();
          var many = saved.created > 1, others = body.user_ids && body.user_ids.filter(function (u) { return u !== S.me.id; });
          if (t) MP.toast('تسک به‌روز شد');
          else if (others && others.length) MP.toast('تسک برای ' + others.map(function (u) { return MP.user(u).name; }).join('، ') + ' تعیین شد' + (many ? ' (' + fa(saved.created) + ' مورد)' : ''));
          else MP.toast(many ? fa(saved.created) + ' تسک تکرارشونده ساخته شد' : 'تسک جدید اضافه شد');
          MP.lastCreated = saved.id;
          MP.loadTasks().then(function () { MP.emit('task-saved', saved); });
          if (opts.onSaved && !t) opts.onSaved(saved, body);
          MP.refreshCounts(); MP.audit();
        })
        .catch(function (err) { MP.busy(form, false); MP.soft(err); });
    };
    form.elements.title.oninput = function () { form.elements.title.setCustomValidity(''); };
    MP.dialog.open(t ? 'ویرایش تسک' : (opts.title || 'تسک جدید'), form, { wide: true });
    setTimeout(function () { if (!t) form.elements.title.focus(); }, 60);
  };

  /* ------------------------------------------------------------ Batch tasks by voice (supervisors) */

  function parseTasksText(text) {
    return MP.Voice.parseTasks(text, { today: S.today, J: J, users: S.users, me: S.me.id, projects: S.projects });
  }
  /**
   * One sentence → tasks for several people on several days, reviewed before anything is created:
   * «برای علی طراحی بنر و ارسال فاکتور شنبه و دوشنبه، برای رضا تماس با مشتری فردا ساعت ۱۰، مهدی گزارش هفتگی پنجشنبه فوری»
   */
  MP.voiceTasks = function (initial) {
    var groups = [], preview = el('div', { class: 'vt-preview' }), footer = el('div', { class: 'vt-footer' });
    var bar = MP.smartBar({
      placeholder: 'بگویید یا بنویسید…',
      examples: ['«برای علی طراحی بنر و ارسال فاکتور شنبه و دوشنبه، برای رضا تماس با مشتری فردا ساعت ۱۰»',
        '«رضا و مهدی از شنبه تا چهارشنبه تست صفحه پرداخت پروژه زیوا»',
        '«مهدی گزارش هفتگی هر پنجشنبه ساعت ۴ فوری»', '«برای همه کل هفته به‌روزرسانی پروفایل»'],
      parse: parseTasksText,
      apply: function (r) { groups = groups.concat(r); draw(); },
      describe: function (r) {
        var n = r.reduce(function (s, g) { return s + g.user_ids.length * g.tasks.length * g.dates.length; }, 0);
        return [[fa(r.length) + ' گروه'], [fa(n) + ' تسک'], r.some(function (g) { return g.warnings.length; }) ? ['چند مورد نیاز به بررسی دارد', 'warn'] : ['آماده ساخت']];
      }
    });
    function count() { return groups.reduce(function (s, g) { return s + g.user_ids.length * g.tasks.length * g.dates.length; }, 0); }
    function draw() {
      preview.replaceChildren();
      if (!groups.length) {
        preview.append(el('div', { class: 'vt-help' },
          el('strong', { text: 'چطور بگویید؟' }),
          el('ul', null,
            el('li', { text: 'اسم هر نفر، بعد کارهایش، بعد روزها و ساعت: «برای علی … شنبه و دوشنبه ساعت ۱۰»' }),
            el('li', { text: 'چند کار را با «و» یا «،» جدا کنید: «طراحی بنر و ارسال فاکتور»' }),
            el('li', { text: 'روزها: «فردا»، «شنبه و دوشنبه»، «از شنبه تا چهارشنبه»، «کل هفته»، «هفته بعد یکشنبه»، «۱۰ مهر»' }),
            el('li', { text: 'چند نفر با هم: «رضا و مهدی …»، یا «برای همه …»؛ «فوری» اولویت را بالا می‌برد و «پروژه زیوا» پروژه را تعیین می‌کند' }))));
      }
      groups.forEach(function (g, gi) {
        var people = el('div', { class: 'vt-people' });
        g.user_ids.forEach(function (uid, ui) {
          var sel = MP.userSelect('u', uid);
          sel.onchange = function () { g.user_ids[ui] = +sel.value; draw(); };
          people.append(el('div', { class: 'vt-person' }, MP.avatar(MP.user(uid), 'sm'), sel,
            g.user_ids.length > 1 ? el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'حذف نفر', html: icon('close'), onclick: function () { g.user_ids.splice(ui, 1); draw(); } }) : null));
        });
        people.append(el('button', { type: 'button', class: 'chip-btn', html: icon('plus') + ' نفر', onclick: function () { g.user_ids.push(S.users[0].id); draw(); } }));
        var tasks = el('div', { class: 'vt-tasks' });
        g.tasks.forEach(function (tt, ti) {
          var inp = el('input', { class: 'input', value: tt, maxlength: 200, 'aria-label': 'عنوان تسک' });
          inp.oninput = function () { g.tasks[ti] = inp.value; };
          tasks.append(el('div', { class: 'vt-task' }, MP.iconEl('tasks'), inp, el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'حذف تسک', html: icon('close'), onclick: function () { g.tasks.splice(ti, 1); draw(); } })));
        });
        tasks.append(el('button', { type: 'button', class: 'chip-btn', html: icon('plus') + ' تسک', onclick: function () { g.tasks.push(''); draw(); var l = $$('.vt-task input', tasks); if (l.length) l[l.length - 1].focus(); } }));
        var days = el('div', { class: 'vt-days' });
        g.dates.forEach(function (d, di) {
          days.append(el('span', { class: 'vt-day' + (d === S.today ? ' today' : '') }, J.weekdays[J.weekday(d)] + ' ' + J.format(d, false),
            el('button', { type: 'button', 'aria-label': 'حذف روز', html: icon('close'), onclick: function () { g.dates.splice(di, 1); draw(); } })));
        });
        var addWrap = MP.dateField('vt-add-' + gi, g.dates[g.dates.length - 1] || S.today, 'افزودن روز', function (iso) { if (g.dates.indexOf(iso) < 0) { g.dates.push(iso); g.dates.sort(); } draw(); });
        addWrap.classList.add('vt-addday');
        var time = el('input', { type: 'time', value: g.time || '', 'aria-label': 'ساعت' });
        time.addEventListener('change', function () { g.time = time.value; });
        var pri = MP.select('p', [['high', 'فوری'], ['medium', 'متوسط'], ['low', 'کم']], g.priority);
        pri.onchange = function () { g.priority = pri.value; };
        var proj = MP.projectSelect('pr', g.project_id);
        proj.onchange = function () { g.project_id = +proj.value; };
        var n = g.user_ids.length * g.tasks.filter(Boolean).length * g.dates.length;
        preview.append(el('section', { class: 'vt-group rise' },
          el('div', { class: 'vt-group-head' }, el('strong', { text: 'گروه ' + fa(gi + 1) }), el('span', { class: 'chip brand', text: fa(n) + ' تسک' }),
            el('button', { type: 'button', class: 'icon-btn sm danger', 'aria-label': 'حذف گروه', html: icon('trash'), onclick: function () { groups.splice(gi, 1); draw(); } })),
          g.warnings.length ? el('div', { class: 'vt-warn' }, g.warnings.map(function (w) { return el('span', { text: w }); })) : null,
          el('div', { class: 'vt-label', text: 'برای' }), people,
          el('div', { class: 'vt-label', text: 'کارها' }), tasks,
          el('div', { class: 'vt-label', text: 'روزها' }), days, addWrap,
          el('div', { class: 'row vt-meta' }, MP.field('ساعت', time), MP.field('اولویت', pri), MP.field('پروژه', proj))));
      });
      var total = count();
      footer.replaceChildren(
        el('span', { class: 'vt-total', text: total ? fa(total) + ' تسک برای ' + fa(uniquePeople()) + ' نفر ساخته می‌شود؛ برای کارمندان قفل است.' : 'هنوز تسکی آماده نیست.' }),
        groups.length ? el('button', { type: 'button', class: 'btn btn-ghost', text: 'پاک کردن', onclick: function () { groups = []; draw(); } }) : null,
        el('button', { type: 'button', class: 'btn btn-primary', disabled: !total, text: total ? 'ساخت ' + fa(total) + ' تسک' : 'ساخت تسک‌ها', onclick: create }));
    }
    function uniquePeople() { var s = {}; groups.forEach(function (g) { if (g.tasks.filter(Boolean).length && g.dates.length) g.user_ids.forEach(function (u) { s[u] = 1; }); }); return Object.keys(s).length; }
    function create(e) {
      var items = [];
      groups.forEach(function (g) { g.user_ids.forEach(function (u) { g.tasks.filter(function (t) { return t.trim(); }).forEach(function (t) { g.dates.forEach(function (d) {
        items.push({ user_id: u, title: t.trim(), date: d, time: g.time || '', priority: g.priority, project_id: g.project_id || 0 });
      }); }); }); });
      if (!items.length) return;
      var btn = e.currentTarget; btn.disabled = true; btn.textContent = 'در حال ساخت…';
      MP.api('tasks/bulk', { method: 'POST', body: { items: items } }).then(function (r) {
        MP.dialog.close();
        MP.toast(fa(r.created) + ' تسک ساخته و برای افراد ارسال شد' + (r.failed.length ? '؛ ' + fa(r.failed.length) + ' مورد ساخته نشد' : ''), { icon: 'check', duration: 5000 });
        MP.loadTasks().then(function () { MP.emit('task-saved', {}); }); MP.refreshCounts(); MP.audit();
      }).catch(function (err) { btn.disabled = false; btn.textContent = 'ساخت تسک‌ها'; MP.soft(err); });
    }
    var body = el('div', { class: 'vt' }, bar, preview, footer);
    MP.dialog.open('تسک گروهی با صدا', body, { wide: true, focus: false });
    draw();
    if (initial) { var inp = $('.smart-input', bar); inp.value = initial; $('.smart-go', bar).click(); }
  };

  /* ------------------------------------------------------------ Detail dialog */

  var timerTick = null;
  MP.openTask = function (id, preview) {
    var body = MP.dialog.open(preview ? preview.title : 'تسک', MP.skeleton(3), { wide: true, focus: false, onClose: function () { clearInterval(timerTick); } });
    MP.api('tasks/' + id + '/detail').then(function (d) { if (MP.dialog.isOpen()) renderDetail(d, body); })
      .catch(function (err) { body.replaceChildren(MP.empty('tasks', 'تسک پیدا نشد', err.message, null, true)); });
  };

  function renderDetail(d, body) {
    var t = d.task, p = MP.project(t.project_id), sec = MP.section(t.section_id), mine = t.user_id === S.me.id;
    $('#dialog-title').textContent = t.title;
    clearInterval(timerTick);
    function reload(nd) { if (MP.dialog.isOpen()) renderDetail(nd, body); }
    function refreshTask(nt) { if (nt.user_id === S.me.id) MP.upsertTask(nt); MP.emit('task-saved', nt); }
    var wrap = el('div');

    if (t.source === 'manager') {
      wrap.append(el('div', { class: 'banner lock' }, MP.iconEl('lock'), el('div', null,
        el('strong', { text: 'تعیین‌شده توسط ' + (t.assigned_by || 'ناظر') }),
        el('span', { text: t.locked ? 'عنوان، زمان و توضیحات قابل تغییر نیست؛ وضعیت، چک‌لیست و زمان کار را گزارش دهید.' : 'شما به‌عنوان ناظر می‌توانید این تسک را ویرایش کنید.' }))));
      if (mine && !t.seen_at) {
        wrap.lastChild.append(el('button', { type: 'button', class: 'btn btn-primary btn-sm', html: icon('check') + 'دیدم', onclick: function () {
          MP.api('tasks/' + t.id + '/seen', { method: 'POST' }).then(function (nt) { refreshTask(nt); MP.toast('دریافت تسک تأیید شد'); return MP.api('tasks/' + t.id + '/detail'); }).then(reload).catch(MP.soft);
        } }));
      }
    }
    var chips = el('div', { class: 'td-meta' },
      el('span', { class: 'chip', html: icon('calendar') }, J.formatLong(t.date) + (t.time ? ' · ' + MP.timeFa(t.time) : '')),
      el('span', { class: 'chip ' + (t.priority === 'high' ? 'danger' : ''), text: 'اولویت ' + MP.PRIORITY[t.priority] }),
      p ? el('span', { class: 'chip brand', html: icon('folder') }, p.name + (sec ? ' · ' + sec.title : '')) : null,
      !mine ? el('span', { class: 'chip', html: icon('user') }, MP.user(t.user_id).name) : null,
      t.recurrence !== 'none' ? el('span', { class: 'chip info', html: icon('repeat') }, MP.RECUR[t.recurrence]) : null,
      t.source === 'client' ? el('span', { class: 'chip brand', html: icon('user') }, 'از طرف مشتری (پرتال)') : null,
      t.source === 'manager' ? el('span', { class: 'chip ' + (t.seen_at ? 'ok' : 'warn'), text: t.seen_at ? 'دیده شد ' + MP.relTime(t.seen_at) : 'هنوز دیده نشده' }) : null,
      t.done_at ? el('span', { class: 'chip ok', text: 'انجام: ' + MP.relTime(t.done_at) }) : null);
    wrap.append(chips);
    if (t.description) wrap.append(MP.describe(t.description));

    // Status
    if (t.can_status) {
      var seg = el('div', { class: 'status-seg', role: 'group', 'aria-label': 'وضعیت' });
      ['todo', 'doing', 'done'].forEach(function (k) {
        seg.append(el('button', { type: 'button', dataset: { s: k }, 'aria-pressed': String(t.status === k), text: MP.STATUS[k], onclick: function () {
          MP.setStatus(t, k).then(function () { return MP.api('tasks/' + t.id + '/detail'); }).then(reload);
        } }));
      });
      wrap.append(el('div', { class: 'td-section' }, el('h3', { text: 'وضعیت' }), seg));
    }

    // Timer
    if (mine) {
      var running = !!t.timer_started, base = t.time_spent, startAt = Date.now() - (t.timer_elapsed || 0) * 1000;
      var val = el('span', { class: 't-val num' });
      var draw = function () { val.textContent = MP.clock(base + (running ? (Date.now() - startAt) / 1000 : 0)); };
      draw();
      if (running) timerTick = setInterval(draw, 1000);
      wrap.append(el('div', { class: 'td-section' }, el('h3', null, 'زمان کار', el('small', { text: 'فقط یک تایمر در هر لحظه فعال است' })),
        el('div', { class: 'timer-box' + (running ? ' running' : '') }, MP.iconEl('clock'), val,
          el('button', { type: 'button', class: 'btn btn-sm ' + (running ? 'btn-dark' : 'btn-ok'), html: icon(running ? 'pause' : 'play') + (running ? 'توقف' : 'شروع'), onclick: function () {
            MP.api('tasks/' + t.id + '/timer', { method: 'POST', body: { action: running ? 'stop' : 'start' } })
              .then(function (nt) { refreshTask(nt); if (!running) MP.loadTasks(); return MP.api('tasks/' + t.id + '/detail'); }).then(reload).catch(MP.soft);
          } }),
          base && !running ? el('button', { type: 'button', class: 'link', text: 'صفر کردن', onclick: function () {
            MP.api('tasks/' + t.id + '/timer', { method: 'POST', body: { action: 'reset' } }).then(function () { return MP.api('tasks/' + t.id + '/detail'); }).then(reload).catch(MP.soft);
          } }) : null)));
    } else if (t.time_spent) {
      wrap.append(el('div', { class: 'td-section' }, el('h3', { text: 'زمان کار ثبت‌شده' }), el('p', { text: MP.duration(t.time_spent) + (t.timer_started ? ' (در حال کار)' : '') })));
    }
    if (mine || S.manager) wrap.append(MP.timeLog(t, mine, function () { MP.api('tasks/' + t.id + '/detail').then(reload).catch(MP.soft); }));

    // Checklist
    var doneN = d.items.filter(function (i) { return i.done; }).length;
    var cl = el('div', { class: 'checklist' });
    d.items.forEach(function (it) {
      cl.append(el('div', { class: 'cl-item' + (it.done ? ' done' : '') },
        el('button', { type: 'button', class: 'tick' + (it.done ? ' on' : ''), html: icon('check'), disabled: !d.can_report, 'aria-pressed': String(it.done), 'aria-label': it.text, onclick: function () {
          MP.api('task-items/' + it.id, { method: 'POST', body: { done: !it.done } }).then(function (nd) { refreshTask(nd.task); reload(nd); }).catch(MP.soft);
        } }),
        el('span', { text: it.text }),
        d.can_items ? el('button', { type: 'button', class: 'icon-btn sm danger', 'aria-label': 'حذف ' + it.text, html: icon('close'), onclick: function () {
          MP.api('task-items/' + it.id, { method: 'DELETE' }).then(function (nd) { refreshTask(nd.task); reload(nd); }).catch(MP.soft);
        } }) : null));
    });
    if (d.can_items) {
      var addIn = el('input', { class: 'input', placeholder: 'مورد جدید…', maxlength: 200 });
      var add = el('form', { class: 'cl-add' }, addIn, el('button', { type: 'submit', class: 'btn btn-secondary btn-sm', text: 'افزودن' }));
      add.onsubmit = function (e) {
        e.preventDefault(); if (!addIn.value.trim()) return;
        MP.api('tasks/' + t.id + '/items', { method: 'POST', body: { text: addIn.value } }).then(function (nd) { refreshTask(nd.task); reload(nd); setTimeout(function () { var i = $('.cl-add input'); if (i) i.focus(); }, 50); }).catch(MP.soft);
      };
      cl.append(add);
    }
    if (d.items.length || d.can_items) {
      var bar = el('i'); bar.style.width = (d.items.length ? doneN / d.items.length * 100 : 0) + '%';
      wrap.append(el('div', { class: 'td-section' }, el('h3', null, 'چک‌لیست', el('small', { text: fa(doneN) + ' از ' + fa(d.items.length) })),
        d.items.length ? el('div', { class: 'bar ok', style: { marginBottom: '8px' } }, bar) : null, cl));
    }

    // Attachments
    var atts = el('div', { class: 'attachments' });
    d.attachments.forEach(function (f) {
      var card = el('a', { class: 'att', href: f.url, target: '_blank', rel: 'noopener', onclick: function (e) { if (f.image) { e.preventDefault(); MP.lightbox(f, d.attachments.filter(function (y) { return y.image; })); } } },
        f.image ? el('img', { src: f.url, alt: f.name, loading: 'lazy' }) : el('span', { class: 'att-ico', html: icon('file') }),
        el('small', { text: f.name }));
      if (f.can_delete) card.append(el('button', { type: 'button', class: 'att-del', 'aria-label': 'حذف ' + f.name, html: icon('close'), onclick: function (e) {
        e.preventDefault(); e.stopPropagation();
        MP.api('files/' + f.id, { method: 'DELETE' }).then(function () { return MP.api('tasks/' + t.id + '/detail'); }).then(function (nd) { refreshTask(nd.task); reload(nd); }).catch(MP.soft);
      } }));
      atts.append(card);
    });
    var prog = el('div', { class: 'upload-progress', hidden: true }, el('i'));
    atts.append(MP.dropzone('فایل را بکشید یا کلیک کنید', function (file) {
      prog.hidden = false;
      MP.upload('files', file, { context: 'task', context_id: t.id }, function (p) { $('i', prog).style.width = p * 100 + '%'; })
        .then(function () { return MP.api('tasks/' + t.id + '/detail'); }).then(function (nd) { refreshTask(nd.task); reload(nd); MP.toast('فایل پیوست شد'); })
        .catch(function (err) { prog.hidden = true; MP.soft(err); });
    }));
    wrap.append(el('div', { class: 'td-section' }, el('h3', null, 'پیوست‌ها', el('small', { text: 'تصویر، PDF، ورد، اکسل تا ۱۰ مگابایت' })), atts, prog));

    // Comments
    var list = el('div', { class: 'comments' });
    if (!d.comments.length) list.append(el('p', { class: 'hint', text: 'هنوز نظری ثبت نشده. سؤال یا گزارش خود را بنویسید؛ طرف مقابل اعلان می‌گیرد.' }));
    d.comments.forEach(function (c) {
      list.append(el('div', { class: 'comment' + (c.mine ? ' mine' : '') }, MP.avatar({ name: c.author, avatar: c.avatar }, 'sm'),
        el('div', { class: 'comment-body' },
          el('header', null, el('strong', { text: c.author }), el('span', null, MP.relTime(c.created_at),
            c.can_delete ? el('button', { type: 'button', class: 'link danger', text: ' · حذف', onclick: function () {
              MP.api('comments/' + c.id, { method: 'DELETE' }).then(function (nd) { refreshTask(nd.task); reload(nd); }).catch(MP.soft);
            } }) : null)),
          c.body ? el('p', { text: c.body }) : null, c.file ? MP.fileChip(c.file) : null)));
    });
    var ta = el('textarea', { class: 'input', placeholder: 'نظر، سؤال یا گزارش…', maxlength: 3000, rows: 1 });
    var pending = null, pendingChip = el('div', { hidden: true });
    var fileIn = el('input', { type: 'file', class: 'visually-hidden', onchange: function (e) {
      var f = e.target.files[0]; if (!f) return; e.target.value = '';
      MP.upload('files', f, { context: 'comment', context_id: 0 }).then(function (up) { pending = up; pendingChip.hidden = false; pendingChip.replaceChildren(MP.fileChip(up)); }).catch(MP.soft);
    } });
    var cform = el('form', { class: 'comment-form' }, el('label', { class: 'icon-btn', title: 'پیوست', html: icon('clip') }, fileIn), ta, el('button', { type: 'submit', class: 'icon-btn accent', 'aria-label': 'ارسال نظر', html: icon('send') }));
    ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); cform.requestSubmit(); } });
    cform.onsubmit = function (e) {
      e.preventDefault(); if (!ta.value.trim() && !pending) return;
      MP.api('tasks/' + t.id + '/comments', { method: 'POST', body: { body: ta.value, file_id: pending ? pending.id : 0 } })
        .then(function (nd) { refreshTask(nd.task); reload(nd); setTimeout(function () { var c = $('.comments'); if (c) c.scrollTop = c.scrollHeight; }, 30); })
        .catch(MP.soft);
    };
    wrap.append(el('div', { class: 'td-section' }, el('h3', null, 'گفت‌وگو', el('small', { text: fa(d.comments.length) + ' نظر' })), list, pendingChip, cform));

    // Footer
    var foot = el('div', { class: 'dialog-actions', style: { marginTop: '20px' } });
    if (!t.locked) {
      foot.append(el('button', { type: 'button', class: 'btn btn-secondary', html: icon('edit') + 'ویرایش', onclick: function () { MP.taskForm({ task: t }); } }));
      foot.append(el('span', { class: 'spacer' }), el('button', { type: 'button', class: 'btn btn-danger', text: d.series_ahead > 1 ? 'آرشیو…' : 'آرشیو', onclick: function () { MP.deleteTask(t); } }));
    }
    if (foot.children.length) wrap.append(foot);
    body.replaceChildren(wrap);
    setTimeout(function () { var c = $('.comments'); if (c) c.scrollTop = c.scrollHeight; }, 20);
  }

  /* ------------------------------------------------------------ My tasks page */

  /** Archived tasks (nothing is deleted); each can be brought back. */
  function renderArchive(box) {
    box.replaceChildren(MP.skeleton(3));
    MP.api('tasks', { query: { archived: 1, user_id: S.manager ? 'all' : '' } }).then(function (list) {
      if ($('#mt-status').value !== 'archived') return;
      var q = MP.norm($('#mt-q').value);
      list = list.filter(function (t) { return !q || MP.norm(t.title + ' ' + t.description).indexOf(q) >= 0; });
      $('#mt-count').textContent = fa(list.length) + ' تسک آرشیو';
      box.replaceChildren();
      if (!list.length) { box.append(MP.empty('folder', 'آرشیو خالی است', 'تسک‌هایی که آرشیو کنید اینجا می‌مانند و قابل بازگرداندن هستند.')); return; }
      var stack = el('div', { class: 'task-stack', style: { maxHeight: 'none', padding: '8px' } });
      list.forEach(function (t) {
        stack.append(el('div', { class: 'archived-row' },
          el('span', { class: 'ar-copy' }, el('strong', { text: t.title }), el('small', { text: J.format(t.date) + (t.user_id !== S.me.id ? ' · ' + MP.user(t.user_id).name : '') + (MP.project(t.project_id) ? ' · ' + MP.project(t.project_id).name : '') })),
          t.locked ? null : el('button', { type: 'button', class: 'btn btn-secondary btn-sm', html: icon('repeat') + 'بازگرداندن', onclick: function () {
            MP.api('tasks/' + t.id + '/restore', { method: 'POST' }).then(function () { MP.toast('تسک بازگردانده شد'); MP.loadTasks(); renderArchive(box); MP.refreshCounts(); }).catch(MP.soft);
          } })));
      });
      box.append(stack);
    }).catch(MP.soft);
  }

  function render() {
    if ($('#mt-status').value === 'archived') { renderArchive($('#mt-list')); return; }
    var q = MP.norm($('#mt-q').value), status = $('#mt-status').value, source = $('#mt-source').value, range = $('#mt-range').value;
    var box = $('#mt-list');
    var items = MP.myTasks().filter(function (t) {
      var p = MP.project(t.project_id), s = MP.section(t.section_id);
      if (q && MP.norm(t.title + ' ' + t.description + ' ' + (p ? p.name : '') + ' ' + (s ? s.title : '')).indexOf(q) < 0) return false;
      if (status === 'open' && t.done) return false;
      if (status === 'done' && !t.done) return false;
      if (source !== 'all' && t.source !== source) return false;
      if (range === 'overdue') return !t.done && t.date < S.today;
      return MP.inRange(t.date, range);
    }).sort(function (a, b) { return (a.done - b.done) || (a.date + (a.time || '99')).localeCompare(b.date + (b.time || '99')); });
    $('#mt-count').textContent = fa(items.length) + ' تسک';
    if (status === 'open' && tab === 'done') tab = 'today';
    box.replaceChildren();
    if (!items.length) {
      box.append(q || status !== 'open' || source !== 'all' || range !== 'all'
        ? MP.empty('search', 'تسکی با این فیلتر نیست', 'فیلترها را تغییر دهید.')
        : MP.empty('checks', 'همه کارها انجام شده!', 'تسک باز ندارید. یک تسک جدید اضافه کنید.', { text: 'افزودن تسک', onclick: function () { MP.taskForm(); } }));
      return;
    }
    // Tabs instead of one long list: each bucket holds one slice of time, none overlap.
    var t1 = J.addDays(S.today, 1), t2 = J.addDays(S.today, 2), weekEnd = J.addDays(J.weekStart(S.today), 6);
    var jm = J.fromIso(S.today), monthEnd = J.toIso(jm.jy, jm.jm, J.monthLength(jm.jy, jm.jm));
    var buckets = [
      ['overdue', 'عقب‌افتاده', function (t) { return !t.done && t.date < S.today; }],
      ['today', 'امروز', function (t) { return !t.done && t.date === S.today; }],
      ['tomorrow', 'فردا', function (t) { return !t.done && t.date === t1; }],
      ['after', 'پس‌فردا', function (t) { return !t.done && t.date === t2; }],
      ['week', 'بقیه این هفته', function (t) { return !t.done && t.date > t2 && t.date <= weekEnd; }],
      ['month', 'بقیه این ماه', function (t) { return !t.done && t.date > t2 && t.date > weekEnd && t.date <= monthEnd; }],
      ['later', 'بعدتر', function (t) { return !t.done && t.date > t2 && t.date > monthEnd; }],
      ['done', 'انجام‌شده', function (t) { return t.done; }]
    ];
    var counts = {};
    buckets.forEach(function (b) { counts[b[0]] = items.filter(b[2]).length; });
    if (!counts[tab] && tab !== 'today') { var firstFull = buckets.filter(function (b) { return counts[b[0]]; })[0]; tab = firstFull ? firstFull[0] : 'today'; }
    var bar = el('div', { class: 'mt-tabs', role: 'tablist' }, buckets.filter(function (b) { return counts[b[0]] || b[0] === 'today'; }).map(function (b) {
      return el('button', { type: 'button', role: 'tab', class: 'mt-tab' + (b[0] === 'overdue' ? ' late' : ''), 'aria-selected': String(b[0] === tab), onclick: function () { tab = b[0]; try { localStorage.setItem('mp_mt_tab', tab); } catch (e) { /* private mode */ } render(); } },
        el('span', { text: b[1] }), el('b', { text: fa(counts[b[0]]) }));
    }));
    box.append(bar);
    var cur = buckets.filter(function (b) { return b[0] === tab; })[0];
    var list = items.filter(cur[2]);
    if (!list.length) { box.append(MP.empty('checks', tab === 'today' ? 'برای امروز کاری نمانده' : 'موردی نیست', null, null, true)); return; }
    var stack = el('div', { class: 'task-stack', style: { maxHeight: 'none', padding: '0 8px 8px' } });
    var day = '';
    list.forEach(function (t) {
      // Multi-day tabs get a small date line between days.
      if (['overdue', 'week', 'month', 'later', 'done'].indexOf(tab) >= 0 && t.date !== day) { day = t.date; stack.append(el('div', { class: 'mt-day', text: J.formatLong(day) })); }
      var r = MP.taskRow(t); if (t.id === MP.lastCreated) r.classList.add('rise'); stack.append(r);
    });
    box.append(stack);
  }
  var tab = 'today';
  try { tab = localStorage.getItem('mp_mt_tab') || 'today'; } catch (e) { /* private mode */ }
  ['#mt-q', '#mt-status', '#mt-source', '#mt-range'].forEach(function (s) { $(s).addEventListener('input', render); });
  $('#mytasks-add').onclick = function () { MP.taskForm(); };
  MP.view('mytasks', { open: render });
  MP.on('tasks', function () { if (MP.visible('mytasks')) render(); });
})();
