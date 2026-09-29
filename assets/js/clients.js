/* Clients page: every client group with its project, people, portal link and what is waiting (reply, designs, invoices). */
(function () {
  'use strict';
  var MP = window.MP, J = MP.J, el = MP.el, $ = MP.$, fa = MP.fa, icon = MP.icon;
  var list = [], manager = false, tab = 'all', q = '';
  var TABS = [['all', 'همه'], ['waiting', 'منتظر پاسخ ما'], ['review', 'منتظر نظر مشتری'], ['noproject', 'بدون پروژه']];

  function money(n) { return J.faDigits(Number(n || 0).toLocaleString('en-US')) + ' تومان'; }
  function initials(s) { return String(s || '؟').trim().split(/\s+/).slice(0, 2).map(function (w) { return w[0]; }).join(''); }
  function match(c) {
    if (tab === 'waiting' && !(c.waiting || c.unread)) return false;
    if (tab === 'review' && !c.designs) return false;
    if (tab === 'noproject' && c.project) return false;
    if (!q) return true;
    return MP.norm([c.client, c.title, c.project ? c.project.name : ''].concat(c.contacts.map(function (x) { return x.name + ' ' + x.mobile; })).join(' ')).indexOf(q) >= 0;
  }
  function copy(url) {
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { MP.toast('لینک پرتال کپی شد'); }, function () { MP.toast('کپی نشد؛ از تنظیمات مشتری بردارید'); });
  }
  function chat(c) { MP.showView('messages', { channel: c.id }); }

  function card(c) {
    var p = c.project, flags = [];
    if (c.waiting || c.unread) flags.push(el('span', { class: 'chip danger', text: c.unread ? fa(c.unread) + ' پیام خوانده‌نشده' : 'منتظر پاسخ ما' }));
    if (c.designs) flags.push(el('span', { class: 'chip brand', text: fa(c.designs) + ' طرح منتظر نظر مشتری' }));
    if (c.changes) flags.push(el('span', { class: 'chip', text: fa(c.changes) + ' درخواست تغییر' }));
    if (c.unpaid) flags.push(el('span', { class: 'chip info', text: fa(c.unpaid) + ' فاکتور پرداخت‌نشده · ' + money(c.due) }));
    return el('article', { class: 'card cl-card' + (c.waiting || c.unread ? ' hot' : '') },
      el('header', { class: 'cl-head' },
        el('span', { class: 'cl-logo' }, c.logo ? el('img', { src: c.logo, alt: '' }) : el('b', { text: initials(c.client) })),
        el('div', { class: 'cl-name' }, el('strong', { text: c.client }), el('small', { text: c.title })),
        c.auth ? el('span', { class: 'cl-lock', title: 'ورود با کد پیامک', html: icon('lock') }) : null),
      p ? el('button', { type: 'button', class: 'cl-proj', title: 'باز کردن پروژه', onclick: function () { MP.S.projectId = p.id; MP.showView('projects'); } },
        el('div', { class: 'cl-proj-top' }, el('span', { html: icon('folder') }), el('b', { text: p.name }), el('em', { text: fa(p.progress) + '٪' })),
        el('div', { class: 'cl-bar' }, el('i', { style: { width: p.progress + '%' } })),
        p.end ? el('small', { text: 'تحویل ' + J.formatLong(p.end) }) : null)
        : el('button', { type: 'button', class: 'cl-proj none', onclick: function () { MP.clientSettings(c); } }, el('span', { html: icon('plus') }), el('b', { text: 'وصل کردن به پروژه' }), el('small', { text: 'تا پرتال پیشرفت، طرح‌ها و فاکتورها را نشان دهد' })),
      flags.length ? el('div', { class: 'cl-flags' }, flags) : null,
      c.last ? el('button', { type: 'button', class: 'cl-last' + (c.last.client ? ' from-client' : ''), onclick: function () { chat(c); } },
        el('span', { class: 'cl-last-who', text: c.last.author }), el('p', { text: c.last.body || '—' }), el('time', { text: MP.relTime(c.last.at) }))
        : el('p', { class: 'cl-last empty muted', text: 'هنوز پیامی رد و بدل نشده' }),
      el('div', { class: 'cl-people' },
        el('div', { class: 'cl-avs' }, c.contacts.slice(0, 4).map(function (x) { return el('span', { class: 'cl-av', title: x.name + ' · ' + J.faDigits(x.mobile), text: initials(x.name) }); })),
        el('small', { class: 'muted', text: c.contacts.length ? fa(c.contacts.length) + ' نفر از طرف مشتری' : 'هنوز کسی ثبت نشده' })),
      el('footer', { class: 'cl-actions' },
        el('button', { type: 'button', class: 'btn btn-primary btn-sm', html: icon('chat') + 'گفت‌وگو', onclick: function () { chat(c); } }),
        p ? el('button', { type: 'button', class: 'btn btn-secondary btn-sm', html: icon('eye') + 'پرتال', onclick: function () { MP.portal(p.id); } }) : null,
        el('button', { type: 'button', class: 'btn btn-ghost btn-sm', html: icon('clip') + 'لینک', onclick: function () { copy(c.url); } }),
        el('button', { type: 'button', class: 'icon-btn sm', title: 'افراد، لوگو و تنظیمات', 'aria-label': 'تنظیمات مشتری', html: icon('settings'), onclick: function () { MP.clientSettings(c); } })));
  }

  function render() {
    var tabs = $('#cl-tabs'), body = $('#cl-body');
    tabs.replaceChildren();
    TABS.forEach(function (t) {
      var n = t[0] === 'all' ? list.length : list.filter(function (c) { var o = tab; tab = t[0]; var r = match(c); tab = o; return r; }).length;
      if (t[0] !== 'all' && !n) return;
      tabs.append(el('button', { type: 'button', role: 'tab', class: 'tab', 'aria-selected': String(tab === t[0]), onclick: function () { tab = t[0]; render(); } }, t[1] + ' ', el('span', { class: 'tab-n', text: fa(n) })));
    });
    if (!list.length) {
      body.replaceChildren(MP.empty('user', 'هنوز مشتری ثبت نشده', 'برای هر مشتری یک گروه بسازید: لینک پرتال، ورود با موبایل، پیشرفت پروژه، طرح‌ها و فاکتورها همه همان‌جاست.', { text: 'مشتری جدید', onclick: MP.newClientGroup }));
      return;
    }
    var shown = list.filter(match);
    var waiting = list.filter(function (c) { return c.waiting || c.unread; }).length, review = list.reduce(function (s, c) { return s + c.designs; }, 0);
    var due = list.reduce(function (s, c) { return s + c.due; }, 0);
    body.replaceChildren(
      el('div', { class: 'kpis cl-kpis' },
        kpi('user', 'مشتری فعال', fa(list.length)),
        kpi('chat', 'منتظر پاسخ ما', fa(waiting), waiting ? 'warn' : ''),
        kpi('eye', 'طرح منتظر نظر مشتری', fa(review)),
        manager ? kpi('wallet', 'فاکتور پرداخت‌نشده', due ? money(due) : '—', due ? 'warn' : '') : kpi('folder', 'وصل به پروژه', fa(list.filter(function (c) { return c.project; }).length))),
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
  $('#cl-new').onclick = function () { MP.newClientGroup(); };
  $('#cl-q').addEventListener('input', function () { q = MP.norm(this.value.trim()); render(); });
  MP.on('notification', function (n) { if (n.type === 'message' && MP.S.view === 'clients') load(); });
})();
