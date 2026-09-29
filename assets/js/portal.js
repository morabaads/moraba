/* Client portal from the team's side: per project, upload designs for approval and delivered files, read the client's pins and reply. */
(function () {
  'use strict';
  var MP = window.MP, S = MP.S, J = MP.J, el = MP.el, fa = MP.fa, icon = MP.icon;
  var ST = { pending: 'در انتظار نظر مشتری', approved: 'تأیید شد', changes: 'نیاز به تغییر', delivered: 'تحویل شد', superseded: 'نسخه قبلی' };
  var TONE = { pending: 'brand', approved: 'ok', changes: 'danger', delivered: 'info', superseded: '' };

  var IST = { draft: 'پیش‌نویس', sent: 'ارسال‌شده', accepted: 'تأیید مشتری', paid: 'پرداخت‌شده', cancelled: 'لغوشده' };
  var ITONE = { draft: '', sent: 'info', accepted: 'brand', paid: 'ok', cancelled: 'danger' };
  function money(n) { return J.faDigits(Number(n || 0).toLocaleString('en-US')) + ' تومان'; }
  function copy(url) { (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { MP.toast('لینک پرتال کپی شد'); }, function () { prompt('لینک پرتال', url); }); }

  MP.portal = function (pid) {
    var p = MP.project(+pid);
    if (!p) { MP.toast('پروژه پیدا نشد.', { error: true }); return; }
    var body = MP.dialog.open('پرتال مشتری · ' + p.name, MP.skeleton(3), { wide: true, focus: false });
    var inv = S.manager ? MP.api('invoices', { query: { project_id: p.id } }).then(function (d) { return d.items; }, function () { return []; }) : Promise.resolve(null);
    Promise.all([MP.api('portal/items', { query: { project_id: p.id } }), inv]).then(function (res) {
      if (!MP.dialog.isOpen()) return;
      var d = res[0], invoices = res[1], sum = d.project || { progress: 0 };
      var designs = d.items.filter(function (x) { return x.kind === 'design' && x.status !== 'superseded'; });
      var files = d.items.filter(function (x) { return x.kind === 'file'; });
      var older = d.items.filter(function (x) { return x.status === 'superseded'; });
      var cust = d.customers[0] || null;
      var waiting = designs.filter(function (x) { return x.status === 'pending'; }).length;
      var unpaid = (invoices || []).filter(function (x) { return x.kind === 'invoice' && x.status === 'sent'; });

      // Hero: project, its customers, progress and the portal links.
      var hero = el('section', { class: 'pt-hero' },
        el('div', { class: 'pt-hero-main' },
          el('small', { class: 'pt-kicker', text: 'پرتال مشتری' }),
          el('h2', { text: p.name }),
          el('div', { class: 'pt-customers' }, d.customers.length ? d.customers.map(function (c) { return el('span', { class: 'chip dark', html: icon('user') + '' }, c.name); })
            : el('span', { class: 'chip', text: 'مشتری‌ای به این پروژه وصل نیست' })),
          el('div', { class: 'pt-progress' }, el('div', { class: 'pt-bar' }, el('i', { style: { width: sum.progress + '%' } })), el('b', { text: fa(sum.progress) + '٪' })),
          sum.end ? el('small', { class: 'muted', text: 'تحویل ' + J.formatLong(sum.end) }) : null),
        el('div', { class: 'pt-hero-side' },
          el('div', { class: 'pt-stats' },
            stat(fa(waiting), 'منتظر نظر مشتری'), stat(fa(designs.filter(function (x) { return x.status === 'approved'; }).length), 'طرح تأییدشده'), stat(fa(files.length), 'فایل تحویلی'),
            invoices ? stat(unpaid.length ? money(unpaid.reduce(function (a, x) { return a + x.total; }, 0)) : '—', 'مانده فاکتورها') : null),
          d.links.length ? el('div', { class: 'pt-links' }, d.links.map(function (l) {
            return el('div', { class: 'pt-link' }, el('span', { html: icon('chat') }), el('b', { text: l.title }),
              el('button', { type: 'button', class: 'icon-btn sm', title: 'کپی لینک', 'aria-label': 'کپی لینک', html: icon('clip'), onclick: function () { copy(l.url); } }),
              el('a', { class: 'icon-btn sm', href: l.url, target: '_blank', rel: 'noopener', title: 'باز کردن پرتال', 'aria-label': 'باز کردن پرتال', html: icon('eye') }));
          })) : el('button', { type: 'button', class: 'btn btn-secondary btn-sm', html: icon('plus') + 'ساخت گروه و لینک پرتال', onclick: function () { MP.dialog.close(); MP.newClientGroup({ project_id: p.id, client_id: cust ? cust.id : 0 }); } })));

      // What the team sends to the client from here.
      var tiles = el('section', { class: 'pt-actions' },
        tile('eye', 'طرح برای تأیید', 'مشتری روی طرح نظر می‌دهد و تأیید می‌کند', 'primary', function () { uploadForm(p, 'design'); }),
        tile('download', 'فایل تحویلی', 'فایل نهایی برای دانلود مشتری', '', function () { uploadForm(p, 'file'); }),
        S.manager ? tile('file', 'پیش‌فاکتور', 'برای تأیید مشتری' + (cust ? ' · ' + cust.name : ''), '', function () { MP.newInvoice({ kind: 'proforma', project_id: p.id, client_id: cust ? cust.id : 0 }); }) : null,
        S.manager ? tile('wallet', 'فاکتور', 'با لینک و پرداخت آنلاین' + (cust ? ' · ' + cust.name : ''), '', function () { MP.newInvoice({ kind: 'invoice', project_id: p.id, client_id: cust ? cust.id : 0 }); }) : null);

      var parts = [hero, tiles,
        section('eye', 'طرح‌ها', designs.length, designs.length ? el('div', { class: 'portal-grid' }, designs.map(function (x) {
          var open = x.pins.filter(function (q) { return !q.parent_id && !q.resolved; }).length;
          return el('button', { type: 'button', class: 'card portal-design', onclick: function () { review(p, x); } },
            el('img', { src: x.file.url, alt: x.title, loading: 'lazy' }),
            el('div', { class: 'pd-copy' }, el('strong', { text: x.title + (x.version > 1 ? ' · نسخه ' + fa(x.version) : '') }), el('span', { class: 'chip ' + TONE[x.status], text: ST[x.status] }), open ? el('small', { text: fa(open) + ' نظر باز' }) : null));
        })) : blank('هنوز طرحی برای مشتری نفرستاده‌اید.')),
        section('download', 'فایل‌های تحویلی', files.length, files.length ? el('div', { class: 'tio-history' }, files.map(function (x) {
          return el('article', { class: 'tpl-card' }, el('div', { class: 'tpl-ico', html: icon('file') }),
            el('div', { class: 'tpl-copy' }, el('strong', { text: x.title }), el('small', { text: J.format(x.created_at.slice(0, 10)) + (x.note ? ' · ' + x.note : '') })),
            el('div', { class: 'tpl-actions' }, MP.fileChip(x.file), archiveBtn(p, x)));
        })) : blank('فایلی تحویل نشده است.'))];
      if (invoices) parts.push(section('wallet', 'فاکتورها و پیش‌فاکتورها', invoices.length, invoices.length ? el('div', { class: 'pt-invoices' }, invoices.map(function (x) {
        return el('button', { type: 'button', class: 'pt-inv', onclick: function () { MP.invoices(x.id); } },
          el('span', { class: 'chip ' + (x.kind === 'proforma' ? 'info' : 'brand'), text: x.kind === 'proforma' ? 'پیش‌فاکتور' : 'فاکتور' }),
          el('div', { class: 'pt-inv-copy' }, el('strong', { text: x.number + (x.title ? ' — ' + x.title : '') }), el('small', { text: x.client_name + ' · ' + J.format(x.issue_date) })),
          el('b', { text: money(x.total) }),
          el('span', { class: 'chip ' + ITONE[x.status], text: IST[x.status] + (x.status === 'paid' && x.pay_gateway ? ' · آنلاین' : '') }));
      })) : blank('برای این پروژه هنوز فاکتوری صادر نشده.')));
      if (older.length) parts.push(el('details', { class: 'td-desc-more' }, el('summary', { text: 'نسخه‌های قبلی طرح‌ها (' + fa(older.length) + ')' }), el('div', { class: 'tio-history' }, older.map(function (x) {
        return el('article', { class: 'tpl-card' }, el('div', { class: 'tpl-copy' }, el('strong', { text: x.title + ' · نسخه ' + fa(x.version) }), el('small', { text: (x.decided_by ? x.decided_by + ': ' : '') + (x.decision_note || '') })),
          el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'دیدن نظرها', onclick: function () { review(p, x); } }));
      }))));
      body.replaceChildren.apply(body, parts);
    }).catch(MP.soft);
  };
  function stat(v, label) { return el('div', { class: 'pt-stat' }, el('b', { text: v }), el('small', { text: label })); }
  function tile(ic, title, sub, tone, fn) {
    return el('button', { type: 'button', class: 'pt-tile' + (tone ? ' ' + tone : ''), onclick: fn }, el('span', { class: 'pt-tile-ico', html: icon(ic) }), el('strong', { text: title }), el('small', { text: sub }));
  }
  function section(ic, title, n, content) {
    return el('section', { class: 'pt-section' }, el('h3', null, el('span', { html: icon(ic) }), title, n ? el('em', { text: fa(n) }) : null), content);
  }
  function blank(t) { return el('p', { class: 'pt-blank', text: t }); }

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
