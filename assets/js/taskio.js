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

  /* ------------------------------------------------------------ Main dialog */

  MP.taskIO = function () {
    var body = MP.dialog.open('اکسل تسک‌ها', MP.skeleton(3), { wide: true, focus: false });
    MP.api('tasks/imports').then(function (hist) {
      if (!MP.dialog.isOpen()) return;
      var range = MP.select('range', [['all', 'همه تسک‌ها'], ['month', 'ماه جاری'], ['week', 'هفته جاری']], 'all');
      var who = MP.userSelect('user', '', { any: 'همه افراد' });
      var exp = el('section', { class: 'tio-block' },
        el('h3', { text: 'خروجی اکسل' }),
        el('p', { class: 'muted', text: 'برای هر نفر یک شیت با همان ستون‌های برنامه تیم (شناسه، تاریخ، پروژه، اولویت، ریزتسک، زمان، خروجی، ددلاین، وضعیت، درصد، توضیحات). می‌توانید در اکسل ویرایش کنید و دوباره وارد کنید؛ تسک‌ها با شناسه پیدا و به‌روز می‌شوند.' }),
        el('div', { class: 'row' }, MP.field('بازه', range), MP.field('نفر', who)),
        el('div', { class: 'dialog-actions' }, el('button', { type: 'button', class: 'btn btn-secondary', html: icon('download') + 'دانلود اکسل', onclick: function () {
          location.href = MP.C.tasksExport + '&range=' + range.value + (who.value ? '&user=' + who.value : '');
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
      body.replaceChildren(exp, imp, el('section', { class: 'tio-block' }, el('h3', { text: 'تاریخچه ورود و بازگردانی' }), historyList(hist)));
    }).catch(MP.soft);
  };

  /* ------------------------------------------------------------ Preview & mapping */

  function preview(p) {
    var form = el('form', { class: 'form tio-map' });
    var rows = el('div', { class: 'tio-people' });
    p.people.forEach(function (x, i) {
      var sel = MP.userSelect('u' + i, x.user_id || '', { any: '— وارد نشود —' });
      sel.dataset.name = x.name;
      rows.append(el('div', { class: 'tpl-card tio-person' },
        el('div', { class: 'tpl-copy' },
          el('strong', { text: 'شیت «' + x.name + '»' }),
          el('small', { text: fa(x.count) + ' تسک' + (x.from ? ' · ' + J.format(x.from) + ' تا ' + J.format(x.to) : '') + (x.invalid ? ' · ' + fa(x.invalid) + ' ردیف بدون تاریخ معتبر (رد می‌شود)' : '') }),
          el('small', { class: 'muted', text: x.sample.join(' · ') })),
        el('label', { class: 'field tio-user' }, 'وصل به', sel)));
    });
    var mk = el('input', { type: 'checkbox', name: 'create_projects', checked: true });
    form.append(
      el('p', { class: 'muted', text: 'فایل «' + p.file + '» — هر شیت را به کارمند مربوط وصل کنید. تطبیق خودکار با نام انجام شده؛ اگر درست نیست تغییر دهید.' }),
      rows,
      p.new_projects.length ? el('label', { class: 'check' }, mk, el('span', { text: 'ساخت ' + fa(p.new_projects.length) + ' پروژه جدید: ' + p.new_projects.join('، ') })) : null,
      MP.actions('ورود تسک‌ها'));
    form.onsubmit = function (e) {
      e.preventDefault();
      var map = {}, n = 0;
      Array.prototype.forEach.call(form.querySelectorAll('select'), function (s) { if (s.value) { map[s.dataset.name] = +s.value; n++; } });
      if (!n) { MP.toast('حداقل یک شیت را به یک نفر وصل کنید.', { error: true }); return; }
      MP.busy(form, true);
      MP.api('tasks/import', { method: 'POST', body: { token: p.token, map: map, create_projects: mk.checked } }).then(function (r) {
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
