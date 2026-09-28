/* Projects: tabs by folder, sections with their tasks, team, timeline, progress, assigned tasks and notes. */
(function () {
  'use strict';
  var MP = window.MP, S = MP.S, J = MP.J, el = MP.el, $ = MP.$, $$ = MP.$$, fa = MP.fa, icon = MP.icon;
  var folderSel = $('#proj-folder'), notes = [], ptasks = [], ICONS = ['grid', 'folder', 'calendar', 'tasks', 'pie', 'video', 'wallet', 'chat'];

  function visibleProjects() {
    var f = folderSel.value;
    return S.projects.filter(function (p) { return !f || String(p.folder_id) === f; });
  }
  function fillFolders() {
    var v = folderSel.value;
    folderSel.replaceChildren(el('option', { value: '', text: 'همه فولدرها' }));
    S.folders.forEach(function (f) { folderSel.append(el('option', { value: f.id, text: f.name })); });
    folderSel.value = v;
    folderSel.hidden = !S.folders.length;
  }
  folderSel.onchange = function () { var list = visibleProjects(); if (list.length && !list.some(function (p) { return p.id === S.projectId; })) S.projectId = list[0].id; render(); };

  function render() {
    fillFolders();
    var tabs = $('#proj-tabs'), body = $('#proj-body'), list = visibleProjects();
    tabs.replaceChildren();
    list.forEach(function (p) {
      tabs.append(el('button', { type: 'button', role: 'tab', class: 'tab', 'aria-selected': String(p.id === S.projectId), html: icon(p.icon || 'grid'), onclick: function () { S.projectId = p.id; render(); } }, p.name));
    });
    if (!S.projects.length) {
      body.replaceChildren(el('section', { class: 'card' }, MP.empty('folder', 'هنوز پروژه‌ای نیست', S.manager ? 'اولین پروژه را بسازید و اعضای تیم را اضافه کنید.' : 'وقتی ناظر شما را به پروژه‌ای اضافه کند اینجا نمایش داده می‌شود.', S.manager ? { text: 'پروژه جدید', onclick: function () { projectForm(); } } : null)));
      return;
    }
    var p = MP.project(S.projectId);
    if (!p) return;
    var done = p.tasks.done, total = p.tasks.todo + p.tasks.doing + p.tasks.done;
    var grid = el('div', { class: 'proj-grid' });

    // Sections
    var cards = el('div', { class: 'section-cards' });
    p.sections.forEach(function (s) {
      var pct = s.total ? Math.round(s.done / s.total * 100) : 0, bar = el('i'); bar.style.width = pct + '%';
      cards.append(el('button', { type: 'button', class: 'card section-card', onclick: function () { openSection(p, s); } },
        el('div', { class: 'sc-meta' }, el('span', { class: 'chip ' + (s.priority === 'high' ? 'danger' : s.priority === 'low' ? '' : 'brand'), text: 'اولویت ' + MP.PRIORITY[s.priority] }), el('span', { class: 'chip ' + (s.status === 'done' || (s.total && pct === 100) ? 'ok' : s.status === 'waiting' ? 'warn' : ''), text: s.total && pct === 100 ? 'انجام شده' : MP.STATUS[s.status] })),
        el('h3', { text: s.title }),
        el('div', { class: 'sc-meta' }, el('span', { class: 'muted', text: fa(s.done) + ' از ' + fa(s.total) + ' تسک' }), el('span', { class: 'sc-pct', text: fa(pct) + '٪' })),
        el('div', { class: 'bar' + (pct === 100 ? ' ok' : '') }, bar)));
    });
    if (S.manager) cards.append(el('button', { type: 'button', class: 'card section-card', style: { alignItems: 'center', justifyContent: 'center', border: '2px dashed var(--line-strong)', boxShadow: 'none', background: 'transparent', minHeight: '150px' }, onclick: function () { sectionForm(p); } }, MP.iconEl('plus'), el('strong', { text: 'بخش جدید' })));
    grid.append(el('section', { class: 'proj-sections' },
      el('div', { class: 'card-head' }, el('h2', { text: 'بخش‌های پروژه' }),
        el('div', { class: 'card-tools' },
          el('span', { class: 'chip', text: J.format(p.start, false) + ' تا ' + J.format(p.end, false) }),
          el('button', { type: 'button', class: 'btn btn-secondary btn-sm', html: icon('eye') + 'پرتال مشتری', onclick: function () { MP.portal(p.id); } }),
          S.manager ? el('button', { type: 'button', class: 'btn btn-secondary btn-sm', html: icon('edit') + 'ویرایش پروژه', onclick: function () { projectForm(p); } }) : null)),
      p.sections.length || S.manager ? cards : el('div', { class: 'card' }, MP.empty('list', 'بخشی تعریف نشده', 'ناظر پروژه بخش‌ها را اضافه می‌کند.', null, true))));

    // Team
    var team = el('div', { class: 'team-list' });
    p.members.forEach(function (id) {
      var u = MP.user(id);
      team.append(el('button', { type: 'button', class: 'member', onclick: function () { memberMenu(p, u); } },
        el('span', { class: 'avatar-wrap', style: { position: 'relative' } }, MP.avatar(u, 'lg'), el('i', { class: 'presence ' + u.status })),
        el('span', { text: u.name }), el('small', { class: 'muted', text: u.title || '' })));
    });
    grid.append(el('section', { class: 'card proj-team' },
      el('div', { class: 'card-head' }, el('h2', { text: 'اعضای تیم · ' + fa(p.members.length) }),
        S.manager ? el('button', { type: 'button', class: 'icon-btn sm accent', 'aria-label': 'افزودن عضو', html: icon('plus'), onclick: function () { addMembers(p); } }) : null),
      p.members.length ? team : MP.empty('user', 'عضوی ندارد', null, null, true)));

    // Timeline + progress
    var tlHost = el('div', { class: 'proj-timeline' });
    tlHost.append(MP.Timeline.card);
    grid.append(tlHost);
    var prog = el('div');
    MP.donut(prog, p.tasks, fa(done) + ' از ' + fa(total));
    grid.append(el('section', { class: 'card proj-progress' }, el('div', { class: 'card-head' }, el('h2', { text: 'پیشرفت پروژه' })), prog));

    // Assignments
    var assign = el('section', { class: 'card proj-assign' }, el('div', { class: 'card-head' }, el('h2', { text: 'تسک‌های تعیین‌شده' }),
      S.manager ? el('button', { type: 'button', class: 'btn btn-primary btn-sm', html: icon('plus') + 'انتساب تسک', onclick: function () {
        MP.taskForm({ userId: p.members.filter(function (id) { return id !== S.me.id; })[0] || S.me.id, projectId: p.id, title: 'انتساب تسک در ' + p.name });
      } }) : null), el('div', { id: 'proj-assign-list' }, MP.skeleton(2)));
    grid.append(assign);

    // Notes
    grid.append(el('section', { class: 'card proj-notes' },
      el('div', { class: 'card-head' }, el('h2', { text: 'یادداشت‌ها' }),
        el('div', { class: 'card-tools' },
          el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'جستجو', html: icon('search'), onclick: searchNotes }),
          el('button', { type: 'button', class: 'icon-btn sm accent', 'aria-label': 'یادداشت جدید', html: icon('plus'), onclick: function () { noteForm(p); } }))),
      el('div', { id: 'proj-notes-list' }, MP.skeleton(2))));

    body.replaceChildren(grid);
    requestAnimationFrame(MP.Timeline.render);
    MP.api('projects/' + p.id + '/notes').then(function (l) { notes = l; renderNotes(); }).catch(function () {});
    MP.api('tasks', { query: { project_id: p.id } }).then(function (l) { ptasks = l; renderAssign(); }).catch(function () {});
  }

  function renderAssign() {
    var box = $('#proj-assign-list'); if (!box) return;
    var list = ptasks.filter(function (t) { return t.source === 'manager'; }).sort(function (a, b) { return (a.done - b.done) || a.date.localeCompare(b.date); });
    box.replaceChildren();
    if (!list.length) { box.append(MP.empty('tasks', 'تسکی تعیین نشده', S.manager ? 'برای اعضای پروژه تسک تعیین کنید.' : 'تسک‌هایی که ناظر در این پروژه تعیین کند اینجاست.', null, true)); return; }
    var stack = el('div', { class: 'task-stack', style: { maxHeight: '360px' } });
    list.forEach(function (t) { stack.append(MP.taskRow(t)); });
    box.append(stack);
  }
  function renderNotes(filter) {
    var box = $('#proj-notes-list'); if (!box) return;
    box.replaceChildren();
    var q = MP.norm(filter || '');
    var list = notes.filter(function (n) { return !q || MP.norm(n.title + ' ' + n.body).indexOf(q) >= 0; });
    if (!list.length) { box.append(MP.empty('edit', q ? 'یادداشتی پیدا نشد' : 'یادداشتی نیست', q ? null : 'تصمیم‌ها و مستندات پروژه را اینجا بنویسید.', null, true)); return; }
    list.forEach(function (n) { box.append(el('button', { type: 'button', class: 'note-item', onclick: function () { openNote(n); } }, el('strong', { text: n.title }), el('small', { text: n.author + ' · ' + MP.relTime(n.created_at) }))); });
  }
  function openNote(n) {
    MP.dialog.open(n.title, el('div', null,
      el('p', { text: n.body, style: { whiteSpace: 'pre-wrap', lineHeight: '1.9' } }),
      el('p', { class: 'hint', text: n.author + ' · ' + MP.relTime(n.created_at), style: { marginTop: '12px' } }),
      n.can_delete ? el('div', { class: 'dialog-actions', style: { marginTop: '14px' } }, el('button', { type: 'button', class: 'btn btn-danger', text: 'حذف یادداشت', onclick: function () {
        MP.dialog.close();
        var before = notes.slice();
        MP.undoable('یادداشت حذف شد', function () { notes = notes.filter(function (x) { return x.id !== n.id; }); renderNotes(); },
          function () { notes = before; renderNotes(); }, function () { return MP.api('notes/' + n.id, { method: 'DELETE' }); });
      } })) : null), { focus: false });
  }
  function noteForm(p) {
    var f = el('form', { class: 'form' }, MP.field('عنوان', el('input', { name: 'title', required: true, maxlength: 160 })), MP.field('متن', el('textarea', { name: 'body', required: true, maxlength: 5000, rows: 7 })), MP.actions('ذخیره یادداشت'));
    f.onsubmit = function (e) {
      e.preventDefault(); MP.busy(f, true);
      MP.api('projects/' + p.id + '/notes', { method: 'POST', body: { title: f.elements.title.value, body: f.elements.body.value } })
        .then(function (l) { notes = l; renderNotes(); MP.dialog.close(); MP.toast('یادداشت ذخیره شد'); }).catch(function (err) { MP.busy(f, false); MP.soft(err); });
    };
    MP.dialog.open('یادداشت جدید', f, { wide: true });
  }
  function searchNotes() {
    var input = el('input', { type: 'search', class: 'input', placeholder: 'جستجو در یادداشت‌ها…', autocomplete: 'off' });
    input.oninput = function () { renderNotes(input.value); };
    MP.dialog.open('جستجوی یادداشت‌ها', el('div', { class: 'form' }, input, el('p', { class: 'hint', text: 'نتیجه در کارت یادداشت‌ها فیلتر می‌شود.' })), { onClose: function () {} });
  }

  function openSection(p, s) {
    var box = el('div');
    function draw() {
      var items = ptasks.filter(function (t) { return t.section_id === s.id; });
      box.replaceChildren(
        el('p', { class: 'hint', text: fa(items.filter(function (t) { return t.done; }).length) + ' از ' + fa(items.length) + ' تسک انجام شده', style: { marginBottom: '10px' } }),
        items.length ? el('div', { class: 'task-stack', style: { maxHeight: '50vh' } }, items.map(function (t) { return MP.taskRow(t); })) : MP.empty('tasks', 'تسکی در این بخش نیست', null, null, true),
        el('div', { class: 'dialog-actions', style: { marginTop: '14px' } },
          el('button', { type: 'button', class: 'btn btn-primary', html: icon('plus') + 'تسک در این بخش', onclick: function () { MP.taskForm({ projectId: p.id, sectionId: s.id, title: 'تسک جدید — ' + s.title }); } }),
          S.manager ? el('button', { type: 'button', class: 'btn btn-secondary', text: 'ویرایش بخش', onclick: function () { sectionForm(p, s); } }) : null));
    }
    draw();
    MP.dialog.open(s.title, box, { wide: true, focus: false });
  }
  function sectionForm(p, s) {
    var f = el('form', { class: 'form' },
      MP.field('عنوان بخش', el('input', { name: 'title', required: true, maxlength: 160, value: s ? s.title : '', placeholder: 'مثلاً طراحی رابط کاربری' })),
      el('div', { class: 'row' },
        MP.field('اولویت', MP.select('priority', [['high', 'زیاد'], ['medium', 'متوسط'], ['low', 'کم']], s ? s.priority : 'medium')),
        MP.field('وضعیت', MP.select('status', [['doing', 'در حال انجام'], ['waiting', 'در انتظار'], ['done', 'انجام شده']], s ? s.status : 'doing'))),
      MP.actions(s ? 'ذخیره' : 'افزودن بخش', s ? el('button', { type: 'button', class: 'btn btn-danger', text: 'حذف بخش', onclick: function () {
        MP.confirm('حذف بخش', 'بخش «' + s.title + '» حذف شود؟ تسک‌هایش در تقویم افراد باقی می‌مانند.', 'حذف').then(function (ok) {
          if (ok) MP.api('sections/' + s.id, { method: 'DELETE' }).then(function (d) { MP.applyProjects(d); MP.toast('بخش حذف شد'); }).catch(MP.soft);
        });
      } }) : null));
    f.onsubmit = function (e) {
      e.preventDefault(); MP.busy(f, true);
      var body = { title: f.elements.title.value.trim(), priority: f.elements.priority.value, status: f.elements.status.value };
      (s ? MP.api('sections/' + s.id, { method: 'POST', body: body }) : MP.api('projects/' + p.id + '/sections', { method: 'POST', body: body }))
        .then(function (d) { MP.applyProjects(d); MP.dialog.close(); MP.toast(s ? 'بخش به‌روز شد' : 'بخش اضافه شد'); }).catch(function (err) { MP.busy(f, false); MP.soft(err); });
    };
    MP.dialog.open(s ? 'ویرایش بخش' : 'بخش جدید در ' + p.name, f);
  }
  function memberMenu(p, u) {
    var mine = u.id === S.me.id;
    var items = [
      !mine ? ['chat', 'ارسال پیام', function () { MP.dialog.close(); MP.startDirect(u.id); }] : null,
      S.manager ? ['tasks', 'تعیین تسک', function () { MP.taskForm({ userId: u.id, projectId: p.id }); }] : null,
      ['calendar', S.manager ? 'تقویم ' + u.name : 'تسک‌های پروژه', function () {
        if (S.manager) { MP.dialog.close(); MP.showView('calendar', { userId: u.id }); return; }
        var list = ptasks.filter(function (t) { return t.user_id === u.id; });
        MP.dialog.open('تسک‌های ' + u.name, list.length ? el('div', { class: 'task-stack', style: { maxHeight: '60vh' } }, list.map(function (t) { return MP.taskRow(t, { owner: false }); })) : MP.empty('tasks', 'تسکی در این پروژه ندارد', null, null, true), { focus: false });
      }],
      !mine ? ['video', 'جلسه با ' + u.name, function () { MP.meetingForm({ people: [u.id], projectId: p.id, title: 'جلسه با ' + u.name }); }] : null,
      u.phone && !mine ? ['help', 'تماس تلفنی', function () { location.href = 'tel:' + u.phone.replace(/[^0-9+]/g, ''); }] : null,
      ['user', 'پروفایل', function () { MP.openProfile(u.id); }],
      S.manager ? ['trash', 'حذف از پروژه', function () {
        MP.confirm('حذف عضو', u.name + ' از پروژه «' + p.name + '» حذف شود؟', 'حذف').then(function (ok) {
          if (ok) MP.api('projects/' + p.id + '/members/' + u.id, { method: 'DELETE' }).then(function (d) { MP.applyProjects(d); MP.toast('عضو حذف شد'); }).catch(MP.soft);
        });
      }] : null
    ].filter(Boolean);
    MP.dialog.open(u.name, el('div', null,
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' } }, MP.avatar(u, 'lg'), el('div', null, el('strong', { text: u.name }), el('p', { class: 'muted', text: u.title || '' }))),
      el('div', { class: 'menu', style: { padding: 0 } }, items.map(function (i) { return el('button', { type: 'button', class: i[0] === 'trash' ? 'danger' : '', html: icon(i[0]), onclick: i[2] }, i[1]); }))), { focus: false });
  }
  function addMembers(p) {
    var f = el('form', { class: 'form' }, el('p', { class: 'hint', text: 'اعضا به پروژه، گروه گفت‌وگو و تسک‌های آن دسترسی پیدا می‌کنند.' }), MP.peoplePicker('people', [], null, p.members), MP.actions('افزودن'));
    f.onsubmit = function (e) {
      e.preventDefault();
      var ids = MP.checked(f, 'people'); if (!ids.length) { MP.toast('حداقل یک نفر را انتخاب کنید', { error: true }); return; }
      MP.busy(f, true);
      MP.api('projects/' + p.id + '/members', { method: 'POST', body: { user_ids: ids } }).then(function (d) { MP.applyProjects(d); MP.dialog.close(); MP.toast('اعضا اضافه شدند'); MP.audit(); }).catch(function (err) { MP.busy(f, false); MP.soft(err); });
    };
    MP.dialog.open('افزودن عضو به ' + p.name, f, { wide: true });
  }
  function projectForm(p) {
    var iconIn = el('input', { type: 'hidden', name: 'icon', value: p ? p.icon : 'grid' });
    var picker = el('div', { class: 'icon-picker', role: 'radiogroup', 'aria-label': 'آیکون' });
    ICONS.forEach(function (n) {
      picker.append(el('button', { type: 'button', 'aria-pressed': String(iconIn.value === n), 'aria-label': n, html: icon(n), onclick: function (e) {
        iconIn.value = n; $$('button', picker).forEach(function (x) { x.setAttribute('aria-pressed', String(x === e.currentTarget)); });
      } }));
    });
    var f = el('form', { class: 'form' },
      MP.field('نام پروژه', el('input', { name: 'name', required: true, maxlength: 160, value: p ? p.name : '' })),
      el('div', { class: 'field' }, el('span', { text: 'آیکون' }), picker, iconIn),
      el('div', { class: 'row' },
        MP.field('فولدر', MP.select('folder_id', [[0, 'بدون فولدر']].concat(S.folders.map(function (x) { return [x.id, x.name]; })), p ? p.folder_id : 0)),
        MP.field('وضعیت', MP.select('status', [['doing', 'در حال انجام'], ['waiting', 'در انتظار'], ['done', 'انجام شده']], p ? p.status : 'doing'))),
      el('div', { class: 'row' }, MP.dateField('start', p ? p.start : S.today, 'شروع'), MP.dateField('end', p ? p.end : J.addDays(S.today, 60), 'پایان')),
      p ? null : el('div', { class: 'field' }, el('span', { text: 'اعضای تیم' }), MP.peoplePicker('people', [], [S.me.id])),
      MP.actions(p ? 'ذخیره' : 'ساخت پروژه', p ? el('button', { type: 'button', class: 'btn btn-danger', text: 'حذف پروژه', onclick: function () {
        MP.confirm('حذف پروژه', 'پروژه «' + p.name + '» با بخش‌ها، یادداشت‌ها و گروه گفت‌وگویش حذف شود؟ تسک‌ها در تقویم افراد باقی می‌مانند.', 'حذف پروژه').then(function (ok) {
          if (ok) MP.api('projects/' + p.id, { method: 'DELETE' }).then(function (d) { MP.applyProjects(d); MP.toast('پروژه حذف شد'); MP.loadChannels(); MP.audit(); }).catch(MP.soft);
        });
      } }) : null));
    f.onsubmit = function (e) {
      e.preventDefault();
      var x = f.elements;
      if (x.end.value < x.start.value) { MP.toast('پایان باید بعد از شروع باشد', { error: true }); return; }
      MP.busy(f, true);
      var body = { name: x.name.value.trim(), icon: x.icon.value, folder_id: +x.folder_id.value, status: x.status.value, start: x.start.value, end: x.end.value };
      if (!p) body.members = MP.checked(f, 'people');
      (p ? MP.api('projects/' + p.id, { method: 'POST', body: body }) : MP.api('projects', { method: 'POST', body: body }))
        .then(function (d) {
          if (!p) S.projectId = d.projects[d.projects.length - 1].id;
          MP.applyProjects(d); MP.dialog.close(); MP.loadChannels(); MP.audit();
          MP.toast(p ? 'پروژه به‌روز شد' : 'پروژه ساخته شد');
        }).catch(function (err) { MP.busy(f, false); MP.soft(err); });
    };
    MP.dialog.open(p ? 'ویرایش پروژه' : 'پروژه جدید', f, { wide: true });
  }
  function foldersDialog() {
    var list = el('div');
    S.folders.forEach(function (f) {
      list.append(el('div', { class: 'detail-row' }, el('span', { text: f.name + ' · ' + fa(S.projects.filter(function (p) { return p.folder_id === f.id; }).length) + ' پروژه' }),
        el('button', { type: 'button', class: 'link danger', text: 'حذف', onclick: function () {
          MP.api('folders/' + f.id, { method: 'DELETE' }).then(function (d) { MP.applyProjects(d); foldersDialog(); }).catch(MP.soft);
        } })));
    });
    var f = el('form', { class: 'cl-add' }, el('input', { class: 'input', name: 'name', required: true, maxlength: 120, placeholder: 'نام فولدر جدید' }), el('button', { type: 'submit', class: 'btn btn-primary', text: 'ساخت' }));
    f.onsubmit = function (e) {
      e.preventDefault();
      MP.api('folders', { method: 'POST', body: { name: f.elements.name.value } }).then(function (d) { MP.applyProjects(d); MP.toast('فولدر ساخته شد'); foldersDialog(); }).catch(MP.soft);
    };
    MP.dialog.open('فولدرهای پروژه', el('div', { class: 'form' }, f, S.folders.length ? list : el('p', { class: 'hint', text: 'پروژه‌ها را با فولدر دسته‌بندی کنید.' })));
  }
  $('#proj-new').onclick = function () { projectForm(); };
  $('#proj-folders').onclick = foldersDialog;

  MP.view('projects', { open: function () { MP.loadProjects().then(render); render(); } });
  MP.on('projects', function () { if (MP.visible('projects')) render(); });
  MP.on('task-saved', function (t) {
    if (!MP.visible('projects') || !t || t.project_id !== S.projectId) return;
    var i = ptasks.findIndex(function (x) { return x.id === t.id; }); if (i >= 0) ptasks[i] = t; else ptasks.push(t);
    renderAssign();
    MP.loadProjects();
  });
  MP.on('task-local', function (t) { if (!MP.visible('projects')) return; var i = ptasks.findIndex(function (x) { return x.id === t.id; }); if (i >= 0) { ptasks[i] = t; renderAssign(); } });
})();
