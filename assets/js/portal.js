/* Client portal from the team's side: per project, upload designs for approval and delivered files, read the client's pins and reply. */
(function () {
  'use strict';
  var MP = window.MP, S = MP.S, J = MP.J, el = MP.el, fa = MP.fa, icon = MP.icon;
  var ST = { pending: 'در انتظار نظر مشتری', approved: 'تأیید شد', changes: 'نیاز به تغییر', delivered: 'تحویل شد', superseded: 'نسخه قبلی' };
  var TONE = { pending: 'brand', approved: 'ok', changes: 'danger', delivered: 'info', superseded: '' };

  MP.portal = function (pid) {
    var p = MP.project(+pid);
    if (!p) { MP.toast('پروژه پیدا نشد.', { error: true }); return; }
    var body = MP.dialog.open('پرتال مشتری · ' + p.name, MP.skeleton(3), { wide: true, focus: false });
    MP.api('portal/items', { query: { project_id: p.id } }).then(function (d) {
      if (!MP.dialog.isOpen()) return;
      var links = d.links.length ? el('div', { class: 'portal-links' }, d.links.map(function (l) {
        return el('button', { type: 'button', class: 'btn btn-secondary btn-sm', html: icon('send') + 'کپی لینک پرتال «' + l.title + '»', onclick: function () {
          (navigator.clipboard ? navigator.clipboard.writeText(l.url) : Promise.reject()).then(function () { MP.toast('لینک پرتال کپی شد'); }, function () { prompt('لینک پرتال', l.url); });
        } });
      })) : el('p', { class: 'hint', text: 'این پروژه هنوز گروه مشتری ندارد. از «پیام‌ها ← گروه مشتری» با همین پروژه بسازید؛ لینک همان گروه، پرتال مشتری است (پیشرفت، طرح‌ها، فایل‌ها، فاکتورها و گفت‌وگو).' });
      var designs = d.items.filter(function (x) { return x.kind === 'design' && x.status !== 'superseded'; });
      var files = d.items.filter(function (x) { return x.kind === 'file'; });
      var older = d.items.filter(function (x) { return x.status === 'superseded'; });
      body.replaceChildren(
        links,
        el('div', { class: 'portal-actions' },
          el('button', { type: 'button', class: 'btn btn-primary', html: icon('eye') + 'طرح برای تأیید مشتری', onclick: function () { uploadForm(p, 'design'); } }),
          el('button', { type: 'button', class: 'btn btn-secondary', html: icon('download') + 'فایل تحویلی', onclick: function () { uploadForm(p, 'file'); } })),
        el('h3', { class: 'tio-sub', text: 'طرح‌ها' }),
        designs.length ? el('div', { class: 'portal-grid' }, designs.map(function (x) {
          var open = x.pins.filter(function (q) { return !q.parent_id && !q.resolved; }).length;
          return el('button', { type: 'button', class: 'card portal-design', onclick: function () { review(p, x); } },
            el('img', { src: x.file.url, alt: x.title, loading: 'lazy' }),
            el('div', { class: 'pd-copy' }, el('strong', { text: x.title + (x.version > 1 ? ' · نسخه ' + fa(x.version) : '') }), el('span', { class: 'chip ' + TONE[x.status], text: ST[x.status] }), open ? el('small', { text: fa(open) + ' نظر باز' }) : null));
        })) : el('p', { class: 'muted', text: 'طرحی ارسال نشده است.' }),
        el('h3', { class: 'tio-sub', text: 'فایل‌های تحویلی' }),
        files.length ? el('div', { class: 'tio-history' }, files.map(function (x) {
          return el('article', { class: 'tpl-card' }, el('div', { class: 'tpl-ico', html: icon('file') }),
            el('div', { class: 'tpl-copy' }, el('strong', { text: x.title }), el('small', { text: J.format(x.created_at.slice(0, 10)) + (x.note ? ' · ' + x.note : '') })),
            el('div', { class: 'tpl-actions' }, MP.fileChip(x.file), archiveBtn(p, x)));
        })) : el('p', { class: 'muted', text: 'فایلی تحویل نشده است.' }),
        older.length ? el('details', { class: 'td-desc-more' }, el('summary', { text: 'نسخه‌های قبلی (' + fa(older.length) + ')' }), el('div', { class: 'tio-history' }, older.map(function (x) {
          return el('article', { class: 'tpl-card' }, el('div', { class: 'tpl-copy' }, el('strong', { text: x.title + ' · نسخه ' + fa(x.version) }), el('small', { text: (x.decided_by ? x.decided_by + ': ' : '') + (x.decision_note || '') })),
            el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'دیدن نظرها', onclick: function () { review(p, x); } }));
        }))) : null);
    }).catch(MP.soft);
  };

  function archiveBtn(p, x) {
    return el('button', { type: 'button', class: 'icon-btn sm', title: 'آرشیو', 'aria-label': 'آرشیو', html: icon('folder'), onclick: function (e) {
      e.stopPropagation();
      MP.api('portal/items/' + x.id, { method: 'DELETE' }).then(function () { MP.toast('آرشیو شد'); MP.portal(p.id); }).catch(MP.soft);
    } });
  }

  function uploadForm(p, kind, replaces) {
    var file = null, drop = el('label', { class: 'dropzone' }, MP.iconEl(kind === 'design' ? 'eye' : 'clip'), el('span', { text: kind === 'design' ? 'تصویر طرح را انتخاب کنید یا اینجا رها کنید' : 'فایل را انتخاب کنید یا اینجا رها کنید' }));
    var input = el('input', { type: 'file', accept: kind === 'design' ? 'image/*' : null, class: 'visually-hidden' });
    drop.append(input);
    function pick(f) { file = f; $('span', drop).textContent = f.name; }
    function $(s, r) { return r.querySelector(s); }
    input.onchange = function () { if (input.files[0]) pick(input.files[0]); };
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', function () { drop.classList.remove('over'); });
    drop.addEventListener('drop', function (e) { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) pick(e.dataTransfer.files[0]); });
    var f = el('form', { class: 'form' },
      drop,
      MP.field('عنوان', el('input', { name: 'title', maxlength: 200, value: replaces ? replaces.title : '', placeholder: kind === 'design' ? 'مثلاً صفحه اصلی — دسکتاپ' : 'مثلاً فایل‌های نهایی لوگو' })),
      MP.field('توضیح برای مشتری', el('textarea', { name: 'note', rows: 2, maxlength: 2000 })),
      MP.actions(replaces ? 'ارسال نسخه جدید' : 'ارسال برای مشتری'));
    f.onsubmit = function (e) {
      e.preventDefault();
      if (!file) { MP.toast('فایل را انتخاب کنید.', { error: true }); return; }
      MP.busy(f, true);
      MP.upload('files', file, { context: 'client_item', context_id: p.id }).then(function (up) {
        return MP.api('portal/items', { method: 'POST', body: { project_id: p.id, kind: kind, title: f.elements.title.value, note: f.elements.note.value, file_id: up.id, replaces: replaces ? replaces.id : 0 } });
      }).then(function () { MP.toast(kind === 'design' ? 'طرح در پرتال مشتری قرار گرفت' : 'فایل در پرتال مشتری قرار گرفت'); MP.portal(p.id); })
        .catch(function (err) { MP.busy(f, false); MP.soft(err); });
    };
    MP.dialog.open(replaces ? 'نسخه جدید «' + replaces.title + '»' : kind === 'design' ? 'طرح برای تأیید' : 'فایل تحویلی', f);
  }

  function review(p, x) {
    var viewer = el('div');
    var box = el('div', null,
      el('div', { class: 'portal-review-head' },
        el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: '→ پرتال', onclick: function () { MP.portal(p.id); } }),
        el('span', { class: 'chip ' + TONE[x.status], text: ST[x.status] }),
        x.decided_by ? el('small', { class: 'muted', text: x.decided_by + (x.decision_note ? ': ' + x.decision_note : '') }) : null,
        el('span', { class: 'spacer' }),
        x.status !== 'superseded' ? el('button', { type: 'button', class: 'btn btn-secondary btn-sm', html: icon('repeat') + 'نسخه جدید', onclick: function () { uploadForm(p, 'design', x); } }) : null,
        archiveBtn(p, x)),
      viewer);
    MP.dialog.open(x.title + (x.version > 1 ? ' · نسخه ' + fa(x.version) : ''), box, { wide: true, focus: false });
    window.MPPins.mount(viewer, x, {
      team: true,
      post: function (b) { return MP.api('portal/items/' + x.id + '/pins', { method: 'POST', body: b }); },
      resolve: function (id) { return MP.api('portal/pins/' + id + '/resolve', { method: 'POST' }); }
    });
  }
})();
