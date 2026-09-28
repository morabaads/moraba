/* Excel import / export of team tasks (supervisors): download a workbook, bring one in with each sheet linked
   to a panel user, and undo any import with «بازگردانی». */
(function () {
  'use strict';
  var MP = window.MP, S = MP.S, J = MP.J, el = MP.el, fa = MP.fa, icon = MP.icon;

  function when(dt) { var d = String(dt || '').slice(0, 10); return d ? J.format(d, true) + ' · ' + J.faDigits(String(dt).slice(11, 16)) : ''; }
  function afterChange() { MP.loadTasks().then(function () { MP.emit('task-saved', {}); }); MP.loadProjects(); MP.refreshCounts(); MP.audit(); }

  function undo(b) {
    return MP.confirm('بازگردانی ورود اکسل',
      'همه تغییرات ورود «' + b.file + '» برگردانده شود؟ ' + fa(b.created) + ' تسک ساخته‌شده حذف می‌شود' + (b.updated ? ' و ' + fa(b.updated) + ' تسک به حالت قبل برمی‌گردد' : '') + (b.projects ? '؛ ' + fa(b.projects) + ' پروژه‌ای که ساخته شد هم حذف می‌شود' : '') + '.',
      'بازگردانی').then(function (ok) {
      if (!ok) return null;
      return MP.api('tasks/imports/' + b.id + '/undo', { method: 'POST' }).then(function (r) {
        MP.toast('بازگردانی شد: ' + fa(r.removed) + ' تسک حذف' + (r.restored ? '، ' + fa(r.restored) + ' تسک به حالت قبل' : ''), { icon: 'repeat' });
        afterChange();
        return r;
      }).catch(MP.soft);
    });
  }

  function historyList(list) {
    var wrap = el('div', { class: 'tio-history' });
    if (!list.length) { wrap.append(el('p', { class: 'muted', text: 'هنوز فایلی وارد نشده است.' })); return wrap; }
    list.forEach(function (b) {
      wrap.append(el('article', { class: 'tpl-card tio-batch' + (b.undone ? ' undone' : '') },
        el('div', { class: 'tpl-ico', html: icon(b.undone ? 'repeat' : 'file') }),
        el('div', { class: 'tpl-copy' },
          el('strong', { text: b.file }),
          el('small', { text: when(b.time) + (b.by ? ' · ' + b.by : '') }),
          el('div', { class: 'tpl-meta' },
            el('span', { class: 'chip', text: fa(b.created) + ' تسک جدید' }),
            b.updated ? el('span', { class: 'chip', text: fa(b.updated) + ' به‌روزرسانی' }) : null,
            b.projects ? el('span', { class: 'chip', text: fa(b.projects) + ' پروژه جدید' }) : null,
            b.people.map(function (p) { return el('span', { class: 'chip brand', text: p.name + ' ← ' + p.user }); }),
            b.undone ? el('span', { class: 'chip', text: 'بازگردانده شد' }) : null)),
        b.undone ? null : el('div', { class: 'tpl-actions' },
          el('button', { type: 'button', class: 'btn btn-danger btn-sm', html: icon('repeat') + 'بازگردانی', onclick: function () { undo(b).then(function (r) { if (r) MP.taskIO(); }); } }))));
    });
    return wrap;
  }

  /* ------------------------------------------------------------ Tasks-only reset */

  function resetBlock(list) {
    var wrap = el('section', { class: 'tio-block tio-danger' },
      el('h3', { text: 'ریست کارخانه تسک‌ها' }),
      el('p', { class: 'muted', text: 'همه تسک‌های همه افراد (با چک‌لیست و نظرها) پاک می‌شود. پروژه‌ها، افراد، حسابداری و ثبت زمان‌ها دست نمی‌خورند. قبل از پاک کردن یک نسخه پشتیبان از تسک‌ها ذخیره می‌شود که از همین‌جا قابل بازگردانی و دانلود است.' }),
      el('div', { class: 'dialog-actions' }, el('button', { type: 'button', class: 'btn btn-danger', html: icon('trash') + 'پاک کردن همه تسک‌ها', onclick: confirmReset })));
    if (list.length) {
      var h = el('div', { class: 'tio-history' });
      list.forEach(function (x) {
        h.append(el('article', { class: 'tpl-card tio-batch' + (x.restored ? ' undone' : '') },
          el('div', { class: 'tpl-ico', html: icon('trash') }),
          el('div', { class: 'tpl-copy' },
            el('strong', { text: 'ریست — ' + fa(x.count) + ' تسک' }),
            el('small', { text: when(x.time) + (x.by ? ' · ' + x.by : '') + (x.restored ? ' · بازگردانده شد' : '') })),
          el('div', { class: 'tpl-actions' },
            el('button', { type: 'button', class: 'icon-btn sm', title: 'دانلود پشتیبان', 'aria-label': 'دانلود پشتیبان', html: icon('download'), onclick: function () { location.href = MP.C.tasksExport + '&snapshot=' + x.id; } }),
            x.restored ? null : el('button', { type: 'button', class: 'btn btn-secondary btn-sm', html: icon('repeat') + 'بازگردانی', onclick: function () {
              MP.confirm('بازگردانی تسک‌ها', fa(x.count) + ' تسک پاک‌شده برگردانده شود؟ تسک‌هایی که بعد از ریست ساخته‌اید می‌مانند.', 'بازگردانی', false).then(function (ok) {
                if (ok) MP.api('tasks/resets/' + x.id + '/restore', { method: 'POST' }).then(function (r) { MP.toast(fa(r.restored) + ' تسک برگشت', { icon: 'repeat' }); afterChange(); MP.taskIO(); }).catch(MP.soft);
              });
            } }))));
      });
      wrap.append(h);
    }
    return wrap;
  }

  function confirmReset() {
    var phrase = 'حذف همه تسک‌ها';
    var input = el('input', { name: 'confirm', autocomplete: 'off', placeholder: phrase });
    var form = el('form', { class: 'form' },
      el('p', { text: 'همه تسک‌های همه افراد پاک می‌شود. برای تأیید عبارت «' + phrase + '» را بنویسید.' }),
      MP.field('تأیید', input),
      el('div', { class: 'dialog-actions' },
        el('button', { type: 'submit', class: 'btn btn-danger', text: 'پاک کن' }),
        el('button', { type: 'button', class: 'btn btn-ghost', text: 'انصراف', onclick: MP.taskIO })));
    form.onsubmit = function (e) {
      e.preventDefault();
      if (input.value.trim() !== phrase) { MP.toast('عبارت تأیید درست نیست.', { error: true }); return; }
      MP.busy(form, true);
      MP.api('tasks/reset', { method: 'POST', body: { confirm: phrase } }).then(function (r) {
        MP.toast(fa(r.removed) + ' تسک پاک شد', { icon: 'trash' });
        afterChange(); MP.taskIO();
      }).catch(function (err) { MP.busy(form, false); MP.soft(err); });
    };
    MP.dialog.open('ریست کارخانه تسک‌ها', form, { focus: true });
  }

  /* ------------------------------------------------------------ Main dialog */

  MP.taskIO = function () {
    var body = MP.dialog.open('اکسل تسک‌ها', MP.skeleton(3), { wide: true, focus: false });
    MP.api('tasks/imports', { query: { with: 1 } }).then(function (all) {
      var hist = all.imports;
      if (!MP.dialog.isOpen()) return;
      var range = MP.select('range', [['all', 'همه تسک‌ها'], ['month', 'ماه جاری'], ['week', 'هفته جاری']], 'all');
      var who = MP.userSelect('user', '', { any: 'همه افراد' });
      var exp = el('section', { class: 'tio-block' },
        el('h3', { text: 'خروجی اکسل' }),
        el('p', { class: 'muted', text: 'برای هر نفر یک شیت با همان ستون‌های برنامه تیم (شناسه، تاریخ، پروژه، اولویت، ریزتسک، زمان، خروجی، ددلاین، وضعیت، درصد، توضیحات). می‌توانید در اکسل ویرایش کنید و دوباره وارد کنید؛ تسک‌ها با شناسه پیدا و به‌روز می‌شوند.' }),
        el('div', { class: 'row' }, MP.field('بازه', range), MP.field('نفر', who)),
        el('div', { class: 'dialog-actions' }, el('button', { type: 'button', class: 'btn btn-secondary', html: icon('download') + 'دانلود اکسل', onclick: function () {
          location.href = MP.C.tasksExport + '&range=' + range.value + (who.value ? '&user=' + who.value : '');
        } }), el('button', { type: 'button', class: 'btn btn-ghost', html: icon('download') + 'پشتیبان کامل تسک‌ها (JSON)', onclick: function () {
          location.href = MP.C.tasksExport + '&format=json';
        } })));
      var file = el('input', { type: 'file', accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', hidden: true });
      var pick = el('button', { type: 'button', class: 'btn btn-primary', html: icon('file') + 'انتخاب فایل اکسل…', onclick: function () { file.click(); } });
      file.onchange = function () {
        var f = file.files[0]; if (!f) return;
        pick.disabled = true; pick.textContent = 'در حال خواندن فایل…';
        MP.upload('tasks/import/preview', f, {}).then(preview).catch(function (err) { pick.disabled = false; pick.innerHTML = icon('file') + 'انتخاب فایل اکسل…'; file.value = ''; MP.soft(err); });
      };
      var imp = el('section', { class: 'tio-block' },
        el('h3', { text: 'ورود از اکسل' }),
        el('p', { class: 'muted', text: 'هر شیت (مثلاً «رضا») به یک نفر در پنل وصل می‌شود و تسک‌هایش با همه جزئیات، قفل‌شده و تعیین‌شده توسط ناظر، در تقویم او قرار می‌گیرد. پروژه‌ها با نام پیدا یا ساخته می‌شوند. هر ورود را بعداً می‌توانید کامل بازگردانی کنید.' }),
        el('div', { class: 'dialog-actions' }, pick, file));
      body.replaceChildren(exp, imp, el('section', { class: 'tio-block' }, el('h3', { text: 'تاریخچه ورود و بازگردانی' }), historyList(hist)), resetBlock(all.resets));
    }).catch(MP.soft);
  };

  /* ------------------------------------------------------------ Preview & mapping */

  var ST = { todo: 'انجام نشده', doing: 'در حال انجام', done: 'انجام شده' };
  /** Read-only preview of the tasks a sheet becomes: one task per day and project, sub-tasks as its checklist. */
  function taskPreview(tasks) {
    var box = el('details', { class: 'tio-preview' }, el('summary', { text: 'پیش‌نمایش تسک‌ها و چک‌لیست‌ها' }));
    var day = '';
    tasks.forEach(function (t) {
      if (t.date !== day) { day = t.date; box.append(el('div', { class: 'tio-day', text: J.formatLong(day) + (t.goal ? ' — ' + t.goal : '') })); }
      box.append(el('div', { class: 'tio-task' },
        el('div', { class: 'tio-task-head' },
          el('strong', { text: t.title }),
          el('span', { class: 'chip', text: ST[t.status] }),
          t.minutes ? el('span', { class: 'chip', text: fa(t.minutes) + ' دقیقه' }) : null,
          el('span', { class: 'chip', text: fa(t.items.length) + ' مورد چک‌لیست' })),
        el('ul', null, t.items.map(function (i) {
          return el('li', { class: i.done ? 'done' : '' }, el('span', { text: i.title }),
            (i.output || i.minutes) ? el('small', { text: [i.output, i.minutes ? fa(i.minutes) + ' دقیقه' : ''].filter(Boolean).join(' · ') }) : null);
        }))));
    });
    return box;
  }

  function preview(p) {
    var form = el('form', { class: 'form tio-map' });
    var rows = el('div', { class: 'tio-people' });
    p.people.forEach(function (x, i) {
      var sel = MP.userSelect('u' + i, x.user_id || '', { any: '— وارد نشود —' });
      sel.dataset.name = x.name;
      rows.append(el('div', { class: 'tpl-card tio-person' },
        el('div', { class: 'tpl-copy' },
          el('strong', { text: 'شیت «' + x.name + '»' }),
          el('small', { text: fa(x.tasks.length) + ' تسک با ' + fa(x.count) + ' مورد چک‌لیست' + (x.from ? ' · ' + J.format(x.from) + ' تا ' + J.format(x.to) : '') + (x.invalid ? ' · ' + fa(x.invalid) + ' ردیف بدون تاریخ معتبر (رد می‌شود)' : '') }),
          taskPreview(x.tasks)),
        el('label', { class: 'field tio-user' }, 'وصل به', sel)));
    });
    var projRows = el('div', { class: 'tio-people' }), popts = [];
    p.projects.forEach(function (x) {
      var sel = MP.select('p', [[0, '+ ساخت پروژه جدید با همین نام'], [-1, '— بدون پروژه (تسک‌ها وارد شوند) —'], [-2, '✕ این پروژه و تسک‌هایش وارد نشود']].concat(S.projects.map(function (q) { return [q.id, q.name]; })), x.project_id);
      sel.dataset.name = x.name; sel.dataset.kind = 'project';
      // Folder for a new project.
      var folder = MP.select('f', [[-1, 'بدون فولدر'], [0, '+ فولدر جدید…']].concat((S.folders || []).map(function (f) { return [f.id, f.name]; })), -1);
      folder.dataset.kind = 'opt';
      var folderName = el('input', { maxlength: 120, placeholder: 'نام فولدر جدید', hidden: true });
      folder.onchange = function () { folderName.hidden = folder.value !== '0'; if (!folderName.hidden) folderName.focus(); };
      var folderBox = el('label', { class: 'field tio-user' }, 'فولدر پروژه جدید', folder, folderName);
      // Section inside the chosen project: lets a file «project» become just a part of a bigger one.
      var section = el('select', { name: 's' }); section.dataset.kind = 'opt';
      var sectionName = el('input', { maxlength: 160, value: x.name, placeholder: 'نام بخش', hidden: true });
      section.onchange = function () { sectionName.hidden = section.value !== '-1'; };
      var sectionBox = el('label', { class: 'field tio-user' }, 'بخش داخل پروژه', section, sectionName);
      function sync() {
        var v = +sel.value, pr = v > 0 ? MP.project(v) : null;
        folderBox.hidden = v !== 0;
        sectionBox.hidden = v < 0;
        section.replaceChildren(el('option', { value: 0, text: 'بدون بخش' }), el('option', { value: -1, text: '+ بخش جدید…' }));
        if (pr) pr.sections.forEach(function (q) { section.append(el('option', { value: q.id, text: q.title })); });
        section.value = pr ? '-1' : '0'; section.onchange();
      }
      sel.onchange = sync; sync();
      popts.push({ name: x.name, get: function () { return { folder: +folder.value, folder_name: folderName.value.trim(), section: +section.value, section_name: sectionName.value.trim() }; } });
      projRows.append(el('div', { class: 'tpl-card tio-person tio-proj' },
        el('div', { class: 'tpl-copy' }, el('strong', { text: 'پروژه «' + x.name + '»' }), el('small', { text: fa(x.count) + ' مورد' })),
        el('div', { class: 'tio-proj-fields' }, el('label', { class: 'field tio-user' }, 'وصل به', sel), folderBox, sectionBox)));
    });
    form.append(
      el('p', { class: 'muted', text: 'فایل «' + p.file + '» — هر شیت را به کارمند مربوط وصل کنید. تطبیق خودکار با نام انجام شده؛ اگر درست نیست تغییر دهید.' }),
      rows,
      p.projects.length ? el('h3', { class: 'tio-sub', text: 'اتصال پروژه‌ها' }) : null,
      p.projects.length ? el('p', { class: 'muted', text: 'هر پروژه فایل را به یک پروژه پنل وصل کنید (و در صورت نیاز به یک بخش داخل آن)، یا پروژه جدید در فولدر دلخواه بسازید.' }) : null,
      projRows,
      MP.actions('تأیید و ورود تسک‌ها'));
    form.onsubmit = function (e) {
      e.preventDefault();
      var map = {}, n = 0;
      var pmap = {};
      Array.prototype.forEach.call(form.querySelectorAll('select'), function (s) {
        if (s.dataset.kind === 'project') pmap[s.dataset.name] = +s.value;
        else if (s.dataset.kind === 'opt') return;
        else if (s.value) { map[s.dataset.name] = +s.value; n++; }
      });
      if (!n) { MP.toast('حداقل یک شیت را به یک نفر وصل کنید.', { error: true }); return; }
      MP.busy(form, true);
      MP.api('tasks/import', { method: 'POST', body: { token: p.token, map: map, project_map: pmap, project_opts: popts.reduce(function (o, x) { o[x.name] = x.get(); return o; }, {}) } }).then(function (r) {
        var b = r.batch;
        MP.dialog.close();
        afterChange();
        MP.toast(fa(b.created) + ' تسک وارد شد' + (b.updated ? '، ' + fa(b.updated) + ' تسک به‌روز شد' : '') + (b.skipped ? ' (' + fa(b.skipped) + ' ردیف رد شد)' : ''), {
          icon: 'checks', action: 'بازگردانی', duration: 12000, onAction: function () { undo(b); }
        });
      }).catch(function (err) { MP.busy(form, false); MP.soft(err); });
    };
    MP.dialog.open('ورود تسک‌ها از اکسل', form, { wide: true, focus: false });
  }
})();
