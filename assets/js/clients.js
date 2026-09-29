/* Clients page: every customer with their projects, client groups (chat + portal), what is waiting and unpaid invoices. */
(function () {
  'use strict';
  var MP = window.MP, J = MP.J, el = MP.el, $ = MP.$, fa = MP.fa, icon = MP.icon;
  var list = [], manager = false, tab = 'all', q = '';
  var TABS = [['all', 'همه'], ['waiting', 'منتظر پاسخ ما'], ['review', 'منتظر نظر مشتری'], ['unpaid', 'فاکتور پرداخت‌نشده'], ['noproject', 'بدون پروژه']];

  function money(n) { return J.faDigits(Number(n || 0).toLocaleString('en-US')) + ' تومان'; }
  function initials(s) { return String(s || '؟').trim().split(/\s+/).slice(0, 2).map(function (w) { return w[0]; }).join(''); }
  function waiting(c) { return c.groups.some(function (g) { return g.waiting || g.unread; }); }
  function unread(c) { return c.groups.reduce(function (s, g) { return s + g.unread; }, 0); }
  function designs(c) { return c.project_list.reduce(function (s, p) { return s + p.designs; }, 0); }
  function test(c, t) {
    if (t === 'waiting') return waiting(c);
    if (t === 'review') return designs(c) > 0;
    if (t === 'unpaid') return c.unpaid > 0;
    if (t === 'noproject') return !c.project_list.length;
    return true;
  }
  function match(c) {
    if (!test(c, tab)) return false;
    if (!q) return true;
    var hay = [c.name, c.phone].concat(c.project_list.map(function (p) { return p.name; }), c.groups.map(function (g) { return g.title + ' ' + g.contacts.map(function (x) { return x.name + ' ' + x.mobile; }).join(' '); }));
    return MP.norm(hay.join(' ')).indexOf(q) >= 0;
  }
  function copy(url) {
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { MP.toast('لینک پرتال کپی شد'); }, function () { MP.toast('کپی نشد؛ از تنظیمات گروه بردارید'); });
  }
  function chat(g) { MP.showView('messages', { channel: g.id }); }
  function lastOf(c) {
    return c.groups.filter(function (g) { return g.last; }).sort(function (a, b) { return a.last.at < b.last.at ? 1 : -1; })[0] || null;
  }

  function card(c) {
    var flags = [], lg = lastOf(c), n = unread(c), dz = designs(c);
    var ch = c.project_list.reduce(function (s, p) { return s + p.changes; }, 0);
    if (waiting(c)) flags.push(el('span', { class: 'chip danger', text: n ? fa(n) + ' پیام خوانده‌نشده' : 'منتظر پاسخ ما' }));
    if (dz) flags.push(el('span', { class: 'chip brand', text: fa(dz) + ' طرح منتظر نظر مشتری' }));
    if (ch) flags.push(el('span', { class: 'chip', text: fa(ch) + ' درخواست تغییر' }));
    if (c.unpaid) flags.push(el('span', { class: 'chip info', text: fa(c.unpaid) + ' فاکتور پرداخت‌نشده · ' + money(c.due) }));
    var people = [];
    c.groups.forEach(function (g) { g.contacts.forEach(function (x) { if (!people.some(function (y) { return y.mobile === x.mobile; })) people.push(x); }); });
    return el('article', { class: 'card cl-card' + (waiting(c) ? ' hot' : '') },
      el('header', { class: 'cl-head' },
        el('span', { class: 'cl-logo' }, c.logo ? el('img', { src: c.logo, alt: '' }) : el('b', { text: initials(c.name) })),
        el('div', { class: 'cl-name' }, el('strong', { text: c.name }), el('small', { text: [c.phone ? J.faDigits(c.phone) : '', fa(c.project_list.length) + ' پروژه', fa(c.groups.length) + ' گروه'].filter(Boolean).join(' · ') })),
        el('button', { type: 'button', class: 'icon-btn sm', title: 'ویرایش مشتری و پروژه‌ها', 'aria-label': 'ویرایش مشتری', html: icon('edit'), onclick: function () { edit(c); } })),
      c.project_list.length ? el('div', { class: 'cl-projs' }, c.project_list.map(function (p) {
        return el('button', { type: 'button', class: 'cl-proj', title: 'پرتال این پروژه', onclick: function () { MP.portal(p.id); } },
          el('div', { class: 'cl-proj-top' }, el('span', { html: icon('folder') }), el('b', { text: p.name }), el('em', { text: fa(p.progress) + '٪' })),
          el('div', { class: 'cl-bar' }, el('i', { style: { width: p.progress + '%' } })),
          el('small', { text: [p.end ? 'تحویل ' + J.formatLong(p.end) : '', p.designs ? fa(p.designs) + ' طرح منتظر نظر' : ''].filter(Boolean).join(' · ') || 'پرتال پروژه' }));
      })) : el('button', { type: 'button', class: 'cl-proj none', onclick: function () { edit(c); } }, el('span', { html: icon('plus') }), el('b', { text: 'وصل کردن به پروژه' }), el('small', { text: 'هر مشتری می‌تواند یک یا چند پروژه داشته باشد' })),
      flags.length ? el('div', { class: 'cl-flags' }, flags) : null,
      lg ? el('button', { type: 'button', class: 'cl-last' + (lg.last.client ? ' from-client' : ''), onclick: function () { chat(lg); } },
        el('span', { class: 'cl-last-who', text: lg.last.author + (c.groups.length > 1 ? ' · ' + lg.title : '') }), el('p', { text: lg.last.body || '—' }), el('time', { text: MP.relTime(lg.last.at) }))
        : el('p', { class: 'cl-last empty muted', text: c.groups.length ? 'هنوز پیامی رد و بدل نشده' : 'گروه گفت‌وگو و پرتال ندارد' }),
      people.length ? el('div', { class: 'cl-people' },
        el('div', { class: 'cl-avs' }, people.slice(0, 5).map(function (x) { return el('span', { class: 'cl-av', title: x.name + ' · ' + J.faDigits(x.mobile), text: initials(x.name) }); })),
        el('small', { class: 'muted', text: fa(people.length) + ' نفر از طرف مشتری' })) : null,
      el('footer', { class: 'cl-actions' },
        c.groups.length ? el('button', { type: 'button', class: 'btn btn-primary btn-sm', html: icon('chat') + 'گفت‌وگو', onclick: function () { pickGroup(c, chat); } })
          : el('button', { type: 'button', class: 'btn btn-primary btn-sm', html: icon('plus') + 'گروه و پرتال', onclick: function () { MP.newClientGroup({ client_id: c.id, project_id: c.project_list[0] ? c.project_list[0].id : 0 }); } }),
        manager ? el('button', { type: 'button', class: 'btn btn-secondary btn-sm', html: icon('file') + 'فاکتور', onclick: function () { invoiceMenu(c); } }) : null,
        c.groups.length ? el('button', { type: 'button', class: 'btn btn-ghost btn-sm', html: icon('clip') + 'لینک', onclick: function () { pickGroup(c, function (g) { copy(g.url); }); } }) : null,
        c.groups.length ? el('button', { type: 'button', class: 'icon-btn sm', title: 'افراد، لوگو و ورود پرتال', 'aria-label': 'تنظیمات گروه', html: icon('settings'), onclick: function () { pickGroup(c, function (g) { MP.clientSettings(g); }); } }) : null));
  }

  /** One group → act at once; several → a small chooser. */
  function pickGroup(c, fn) {
    if (c.groups.length === 1) { fn(c.groups[0]); return; }
    var box = el('div', { class: 'tio-history' }, c.groups.map(function (g) {
      var p = c.project_list.filter(function (x) { return x.id === g.project_id; })[0];
      return el('button', { type: 'button', class: 'tpl-card cl-pick', onclick: function () { MP.dialog.close(); fn(g); } },
        el('div', { class: 'tpl-ico', html: icon('chat') }), el('div', { class: 'tpl-copy' }, el('strong', { text: g.title }), el('small', { text: p ? 'پروژه ' + p.name : 'بدون پروژه' })),
        g.unread ? el('span', { class: 'badge', text: fa(g.unread) }) : null);
    }));
    MP.dialog.open('کدام گروه «' + c.name + '»؟', box);
  }

  function invoiceMenu(c) {
    var pid = c.project_list.length === 1 ? c.project_list[0].id : 0;
    var box = el('div', { class: 'pt-actions two' },
      el('button', { type: 'button', class: 'pt-tile', onclick: function () { MP.newInvoice({ kind: 'proforma', client_id: c.id, project_id: pid }); } }, el('span', { class: 'pt-tile-ico', html: icon('file') }), el('strong', { text: 'پیش‌فاکتور' }), el('small', { text: 'برای تأیید مشتری' })),
      el('button', { type: 'button', class: 'pt-tile primary', onclick: function () { MP.newInvoice({ kind: 'invoice', client_id: c.id, project_id: pid }); } }, el('span', { class: 'pt-tile-ico', html: icon('wallet') }), el('strong', { text: 'فاکتور' }), el('small', { text: 'با لینک و پرداخت آنلاین' })));
    MP.dialog.open('صدور برای ' + c.name, box);
  }

  /** Customer form: name, phone, info and their projects (any number). */
  function edit(c) {
    c = c || { name: '', phone: '', info: '', projects: [] };
    var picks = el('div', { class: 'cl-proj-picks' }, MP.S.projects.map(function (p) {
      return el('label', { class: 'check' }, el('input', { type: 'checkbox', value: p.id, checked: c.projects.indexOf(p.id) >= 0 }), el('span', { text: p.name }));
    }));
    var f = el('form', { class: 'form' },
      el('div', { class: 'row' },
        MP.field('نام مشتری', el('input', { name: 'name', required: true, maxlength: 160, value: c.name })),
        MP.field('تلفن', el('input', { name: 'phone', maxlength: 40, dir: 'ltr', value: c.phone }))),
      MP.field('اطلاعات (برای فاکتور)', el('textarea', { name: 'info', rows: 2, maxlength: 1000, placeholder: 'نشانی، کد اقتصادی، …' }, c.info || '')),
      el('div', { class: 'field' }, el('span', { text: 'پروژه‌های این مشتری' }), picks),
      MP.actions(c.id ? 'ذخیره' : 'ساخت مشتری', c.id && manager ? el('button', { type: 'button', class: 'btn btn-ghost', text: 'آرشیو مشتری', onclick: function () {
        MP.confirm('آرشیو مشتری', '«' + c.name + '» از فهرست برداشته شود؟ گروه‌ها، پیام‌ها و فاکتورهایش می‌مانند.', 'آرشیو').then(function (ok) {
          if (ok) MP.api('customers/' + c.id, { method: 'DELETE' }).then(function () { MP.dialog.close(); MP.toast('آرشیو شد'); load(); }).catch(MP.soft);
        });
      } }) : null));
    f.onsubmit = function (e) {
      e.preventDefault(); MP.busy(f, true);
      var ids = Array.prototype.filter.call(picks.querySelectorAll('input'), function (i) { return i.checked; }).map(function (i) { return +i.value; });
      MP.api(c.id ? 'customers/' + c.id : 'customers', { method: 'POST', body: { name: f.elements.name.value, phone: f.elements.phone.value, info: f.elements.info.value, project_ids: ids } })
        .then(function () { MP.dialog.close(); MP.toast(c.id ? 'ذخیره شد' : 'مشتری ساخته شد'); load(); }).catch(function (err) { MP.busy(f, false); MP.soft(err); });
    };
    MP.dialog.open(c.id ? 'مشتری · ' + c.name : 'مشتری جدید', f);
  }

  function render() {
    var tabs = $('#cl-tabs'), body = $('#cl-body');
    tabs.replaceChildren();
    TABS.forEach(function (t) {
      var n = list.filter(function (c) { return test(c, t[0]); }).length;
      if (t[0] !== 'all' && !n) return;
      tabs.append(el('button', { type: 'button', role: 'tab', class: 'tab', 'aria-selected': String(tab === t[0]), onclick: function () { tab = t[0]; render(); } }, t[1] + ' ', el('span', { class: 'tab-n', text: fa(n) })));
    });
    if (!list.length) {
      body.replaceChildren(MP.empty('user', 'هنوز مشتری ثبت نشده', 'هر مشتری را یک بار بسازید و به پروژه‌هایش وصل کنید؛ گروه گفت‌وگو، پرتال و فاکتورها همه زیر همان مشتری جمع می‌شوند.', { text: 'مشتری جدید', onclick: function () { edit(); } }));
      return;
    }
    var shown = list.filter(match);
    var w = list.filter(waiting).length, rv = list.reduce(function (s, c) { return s + designs(c); }, 0), due = list.reduce(function (s, c) { return s + c.due; }, 0);
    body.replaceChildren(
      el('div', { class: 'kpis cl-kpis' },
        kpi('user', 'مشتری', fa(list.length)),
        kpi('chat', 'منتظر پاسخ ما', fa(w), w ? 'warn' : ''),
        kpi('eye', 'طرح منتظر نظر مشتری', fa(rv)),
        manager ? kpi('wallet', 'فاکتور پرداخت‌نشده', due ? money(due) : '—', due ? 'warn' : '') : kpi('folder', 'پروژه مشتری‌ها', fa(list.reduce(function (s, c) { return s + c.project_list.length; }, 0)))),
      shown.length ? el('div', { class: 'cl-grid' }, shown.map(card)) : MP.empty('search', 'موردی پیدا نشد', null, null, true));
  }
  function kpi(ic, label, value, tone) {
    return el('article', { class: 'card kpi static' }, el('div', { class: 'kpi-icon' + (tone ? ' ' + tone : ''), html: icon(ic) }), el('div', { class: 'kpi-copy' }, el('small', { text: label }), el('strong', { text: value })));
  }

  function load() {
    if (!list.length) $('#cl-body').replaceChildren(MP.skeleton(3));
    return MP.api('clients').then(function (d) { list = d.clients; manager = d.manager; render(); }).catch(MP.soft);
  }
  MP.view('clients', { open: load });
  $('#cl-new').onclick = function () { edit(); };
  $('#cl-q').addEventListener('input', function () { q = MP.norm(this.value.trim()); render(); });
  MP.on('notification', function (n) { if (n.type === 'message' && MP.S.view === 'clients') load(); });
})();
