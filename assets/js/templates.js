/* Task templates (supervisors): reusable step lists with roles, applied to people, a start date and a project. */
(function () {
  'use strict';
  var MP = window.MP, S = MP.S, J = MP.J, el = MP.el, $ = MP.$, $$ = MP.$$, fa = MP.fa, icon = MP.icon;
  var PRI = { high: 'فوری', medium: 'متوسط', low: 'کم' };
  var cache = null;

  function load() { return MP.api('templates').then(function (l) { cache = l; return l; }); }
  function span(t) { var d = t.items.reduce(function (m, i) { return Math.max(m, i.day); }, 0); return d + 1; }

  /** Day offset → date: with «skip Fridays», offsets count working days (Saturday–Thursday). */
  function dateFor(start, day, skipFri) {
    if (!skipFri) return J.addDays(start, day);
    var d = start;
    while (J.weekday(d) === 6) d = J.addDays(d, 1);
    for (var n = 0; n < day;) { d = J.addDays(d, 1); if (J.weekday(d) !== 6) n++; }
    return d;
  }

  /* ------------------------------------------------------------ List */

  MP.templates = function () {
    var body = MP.dialog.open('قالب‌های تسک', MP.skeleton(3), { wide: true, focus: false });
    load().then(function (list) {
      if (!MP.dialog.isOpen()) return;
      var wrap = el('div', { class: 'tpl-list' });
      if (!list.length) wrap.append(MP.empty('list', 'هنوز قالبی نساخته‌اید', 'کارهای تکراری هر پروژه را یک بار به‌صورت قالب بسازید و هر بار با یک کلیک برای تیم ایجاد کنید.', null, true));
      list.forEach(function (t) {
        wrap.append(el('article', { class: 'tpl-card' },
          el('div', { class: 'tpl-ico', html: icon('list') }),
          el('div', { class: 'tpl-copy' },
            el('strong', { text: t.name }),
            t.description ? el('small', { text: t.description }) : null,
            el('div', { class: 'tpl-meta' },
              el('span', { class: 'chip', text: fa(t.items.length) + ' مرحله' }),
              el('span', { class: 'chip', text: fa(span(t)) + ' روز' }),
              t.roles.map(function (r) { return el('span', { class: 'chip brand', text: r }); }))),
          el('div', { class: 'tpl-actions' },
            el('button', { type: 'button', class: 'btn btn-primary btn-sm', html: icon('play') + 'استفاده', onclick: function () { MP.applyTemplate(t); } }),
            el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'ویرایش', title: 'ویرایش', html: icon('edit'), onclick: function () { editor(t); } }),
            el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'کپی', title: 'کپی از این قالب', html: icon('file'), onclick: function () { var c = JSON.parse(JSON.stringify(t)); delete c.id; c.name += ' (کپی)'; editor(c); } }),
            el('button', { type: 'button', class: 'icon-btn sm danger', 'aria-label': 'حذف', title: 'حذف', html: icon('trash'), onclick: function () {
              MP.confirm('حذف قالب', '«' + t.name + '» حذف شود؟ تسک‌هایی که قبلاً از آن ساخته شده‌اند حذف نمی‌شوند.', 'حذف').then(function (ok) {
                if (ok) MP.api('templates/' + t.id, { method: 'DELETE' }).then(function () { MP.toast('قالب حذف شد'); MP.templates(); }).catch(MP.soft);
              });
            } }))));
      });
      body.replaceChildren(wrap, el('div', { class: 'dialog-actions' }, el('button', { type: 'button', class: 'btn btn-primary', html: icon('plus') + 'قالب جدید', onclick: function () { editor(null); } })));
    }).catch(MP.soft);
  };

  /* ------------------------------------------------------------ Editor */

  function editor(t) {
    var tpl = t ? JSON.parse(JSON.stringify(t)) : { name: '', description: '', roles: ['مسئول'], items: [{ title: '', day: 0, time: '', priority: 'medium', role: 0, checklist: [] }] };
    var form = el('form', { class: 'form tpl-editor' });
    var name = el('input', { name: 'name', required: true, maxlength: 120, value: tpl.name, placeholder: 'مثلاً شروع پروژه جدید' });
    var desc = el('input', { name: 'description', maxlength: 500, value: tpl.description, placeholder: 'اختیاری' });
    var rolesBox = el('div', { class: 'tpl-roles' }), steps = el('div', { class: 'tpl-steps' });
    function drawRoles() {
      rolesBox.replaceChildren();
      tpl.roles.forEach(function (r, i) {
        var inp = el('input', { value: r, maxlength: 40, 'aria-label': 'نقش ' + fa(i + 1) });
        inp.oninput = function () { tpl.roles[i] = inp.value; $$('.tpl-step select[name=role] option', steps).forEach(function (o) { if (+o.value === i) o.textContent = inp.value || '—'; }); };
        rolesBox.append(el('span', { class: 'tpl-role' }, MP.iconEl('user'), inp,
          tpl.roles.length > 1 ? el('button', { type: 'button', 'aria-label': 'حذف نقش', html: icon('close'), onclick: function () {
            tpl.roles.splice(i, 1); tpl.items.forEach(function (it) { if (it.role === i) it.role = 0; else if (it.role > i) it.role--; }); drawRoles(); drawSteps();
          } }) : null));
      });
      rolesBox.append(el('button', { type: 'button', class: 'chip-btn', html: icon('plus') + ' نقش', onclick: function () { tpl.roles.push('نقش ' + fa(tpl.roles.length + 1)); drawRoles(); drawSteps(); } }));
    }
    function drawSteps() {
      steps.replaceChildren();
      tpl.items.forEach(function (it, i) {
        var title = el('input', { value: it.title, maxlength: 200, placeholder: 'عنوان مرحله', 'aria-label': 'عنوان مرحله' });
        title.oninput = function () { it.title = title.value; };
        var day = el('input', { inputmode: 'numeric', maxlength: 3, value: fa(it.day), 'aria-label': 'روز', class: 'tpl-day' });
        day.oninput = function () { var n = day.value.replace(/[۰-۹]/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'.indexOf(d); }).replace(/\D/g, ''); it.day = Math.min(365, +n || 0); day.value = n === '' ? '' : fa(it.day); };
        var role = MP.select('role', tpl.roles.map(function (r, k) { return [k, r || '—']; }), it.role);
        role.onchange = function () { it.role = +role.value; };
        var pri = MP.select('priority', [['high', 'فوری'], ['medium', 'متوسط'], ['low', 'کم']], it.priority);
        pri.onchange = function () { it.priority = pri.value; };
        var time = el('input', { type: 'time', value: it.time || '', 'aria-label': 'ساعت' });
        time.addEventListener('change', function () { it.time = time.value; });
        var check = el('textarea', { rows: 2, placeholder: 'چک‌لیست (هر خط یک مورد، اختیاری)' }, (it.checklist || []).join('\n'));
        check.oninput = function () { it.checklist = check.value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean); };
        var more = el('div', { class: 'tpl-more', hidden: !(it.checklist && it.checklist.length) }, check);
        steps.append(el('div', { class: 'tpl-step' },
          el('span', { class: 'tpl-num', text: fa(i + 1) }),
          el('div', { class: 'tpl-step-main' },
            title,
            el('div', { class: 'tpl-step-row' },
              el('label', { class: 'tpl-inline' }, el('span', { text: 'روز' }), day),
              el('label', { class: 'tpl-inline' }, el('span', { text: 'نقش' }), role),
              el('label', { class: 'tpl-inline' }, el('span', { text: 'اولویت' }), pri),
              el('label', { class: 'tpl-inline tpl-time' }, el('span', { text: 'ساعت' }), time),
              el('button', { type: 'button', class: 'chip-btn', html: icon('list') + ' چک‌لیست' + (it.checklist && it.checklist.length ? ' (' + fa(it.checklist.length) + ')' : ''), onclick: function () { more.hidden = !more.hidden; if (!more.hidden) check.focus(); } })),
            more),
          el('div', { class: 'tpl-step-tools' },
            el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'بالا', html: icon('arrow-up'), disabled: i === 0, onclick: function () { var x = tpl.items.splice(i, 1)[0]; tpl.items.splice(i - 1, 0, x); drawSteps(); } }),
            el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'پایین', html: icon('arrow-down'), disabled: i === tpl.items.length - 1, onclick: function () { var x = tpl.items.splice(i, 1)[0]; tpl.items.splice(i + 1, 0, x); drawSteps(); } }),
            el('button', { type: 'button', class: 'icon-btn sm danger', 'aria-label': 'حذف مرحله', html: icon('trash'), disabled: tpl.items.length === 1, onclick: function () { tpl.items.splice(i, 1); drawSteps(); } }))));
      });
    }
    drawRoles(); drawSteps();
    form.append(
      el('div', { class: 'row' }, MP.field('نام قالب', name), MP.field('توضیح', desc)),
      el('div', { class: 'field' }, el('span', { text: 'نقش‌ها (موقع استفاده، برای هر نقش یک نفر انتخاب می‌کنید)' }), rolesBox),
      el('div', { class: 'field' }, el('span', { text: 'مراحل — «روز» یعنی چند روز بعد از تاریخ شروع (۰ = همان روز)' }), steps),
      el('button', { type: 'button', class: 'btn btn-secondary btn-sm tpl-add', html: icon('plus') + 'افزودن مرحله', onclick: function () {
        var last = tpl.items[tpl.items.length - 1];
        tpl.items.push({ title: '', day: last ? last.day + 1 : 0, time: '', priority: 'medium', role: last ? last.role : 0, checklist: [] });
        drawSteps(); var l = $$('.tpl-step-main > input', steps); l[l.length - 1].focus();
      } }),
      MP.actions(tpl.id ? 'ذخیره قالب' : 'ساخت قالب'));
    form.onsubmit = function (e) {
      e.preventDefault();
      tpl.name = name.value.trim(); tpl.description = desc.value.trim();
      if (!tpl.items.some(function (x) { return x.title.trim(); })) { MP.toast('حداقل یک مرحله عنوان داشته باشد', { error: true }); return; }
      MP.busy(form, true);
      MP.api(tpl.id ? 'templates/' + tpl.id : 'templates', { method: 'POST', body: { name: tpl.name, description: tpl.description, roles: tpl.roles, items: tpl.items } })
        .then(function () { MP.toast('قالب ذخیره شد', { icon: 'check' }); MP.audit(); MP.templates(); })
        .catch(function (err) { MP.busy(form, false); MP.soft(err); });
    };
    MP.dialog.open(tpl.id ? 'ویرایش قالب' : 'قالب جدید', form, { wide: true, focus: !tpl.id });
  }
  MP.templateEditor = editor;

  /* ------------------------------------------------------------ Apply */

  MP.applyTemplate = function (t, opts) {
    opts = opts || {};
    var start = MP.dateField('start', opts.date || S.today, 'تاریخ شروع', function () { draw(); });
    var proj = MP.projectSelect('project_id', opts.projectId || 0);
    var skip = el('input', { type: 'checkbox', checked: true });
    var people = t.roles.map(function () { return [opts.userId || S.me.id]; });
    var peopleBox = el('div', { class: 'tpl-assign' }), preview = el('div', { class: 'tpl-preview' }), go = el('button', { type: 'submit', class: 'btn btn-primary' });
    function drawPeople() {
      peopleBox.replaceChildren();
      t.roles.forEach(function (r, i) {
        var n = t.items.filter(function (x) { return x.role === i; }).length;
        var sel = MP.userSelect('role-' + i, people[i][0]);
        sel.onchange = function () { people[i] = [+sel.value]; draw(); };
        peopleBox.append(el('label', { class: 'tpl-assign-row' }, el('span', { class: 'tpl-assign-role' }, el('strong', { text: r }), el('small', { text: fa(n) + ' مرحله' })), sel));
      });
    }
    function tasks() {
      var s = $('input[name=start]', form).value || S.today;
      return t.items.map(function (it) { return { user_id: people[it.role][0], title: it.title, date: dateFor(s, it.day, skip.checked), time: it.time || '', priority: it.priority, project_id: +proj.value || 0, checklist: it.checklist || [] }; });
    }
    function draw() {
      var list = tasks(), last = '';
      preview.replaceChildren();
      list.forEach(function (x) {
        if (x.date !== last) { last = x.date; preview.append(el('div', { class: 'tpl-pday' }, J.formatLong(x.date))); }
        var u = MP.user(x.user_id);
        preview.append(el('div', { class: 'tpl-pitem' }, MP.avatar(u, 'sm'),
          el('span', { class: 'tpl-ptitle', text: x.title }),
          x.time ? el('span', { class: 'chip', text: MP.timeFa(x.time) }) : null,
          x.priority === 'high' ? el('span', { class: 'chip danger', text: 'فوری' }) : null,
          x.checklist.length ? el('span', { class: 'chip', html: icon('list') + fa(x.checklist.length) }) : null));
      });
      var end = list.length ? list[list.length - 1].date : S.today;
      go.textContent = 'ساخت ' + fa(list.length) + ' تسک';
      $('.tpl-range', form).textContent = 'از ' + J.format(list[0] ? list[0].date : S.today) + ' تا ' + J.format(end);
    }
    skip.onchange = draw; proj.onchange = draw;
    var form = el('form', { class: 'form tpl-apply' },
      el('div', { class: 'tpl-apply-head' }, el('div', { class: 'tpl-ico', html: icon('list') }), el('div', null, el('strong', { text: t.name }), el('small', { class: 'tpl-range' }))),
      el('div', { class: 'row' }, start, MP.field('پروژه', proj)),
      el('label', { class: 'check-row' }, skip, el('span', { text: 'جمعه‌ها را رد کن (روزها روز کاری شمرده شوند)' })),
      el('div', { class: 'field' }, el('span', { text: 'چه کسی؟' }), peopleBox),
      el('div', { class: 'field' }, el('span', { text: 'پیش‌نمایش' }), preview),
      el('div', { class: 'dialog-actions' }, go, el('button', { type: 'button', class: 'btn btn-ghost', text: 'بازگشت', onclick: MP.templates })));
    form.onsubmit = function (e) {
      e.preventDefault();
      MP.busy(form, true);
      MP.api('tasks/bulk', { method: 'POST', body: { items: tasks() } }).then(function (r) {
        MP.dialog.close();
        MP.toast('قالب «' + t.name + '» اجرا شد: ' + fa(r.created) + ' تسک' + (r.failed.length ? '؛ ' + fa(r.failed.length) + ' مورد ساخته نشد' : ''), { icon: 'check', duration: 5000 });
        MP.loadTasks().then(function () { MP.emit('task-saved', {}); }); MP.refreshCounts(); MP.audit();
      }).catch(function (err) { MP.busy(form, false); MP.soft(err); });
    };
    MP.dialog.open('استفاده از قالب', form, { wide: true, focus: false });
    drawPeople(); draw();
  };

  /** Quick entry: pick a template, or go straight to apply when there is only one. */
  MP.pickTemplate = function (opts) {
    load().then(function (l) {
      if (l.length === 1) MP.applyTemplate(l[0], opts);
      else MP.templates();
    }).catch(MP.soft);
  };
})();
