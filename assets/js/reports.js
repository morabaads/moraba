/* Reports: personal performance (managers can pick anyone), team table, project progress, change history. */
(function () {
  'use strict';
  var MP = window.MP, S = MP.S, J = MP.J, el = MP.el, $ = MP.$, $$ = MP.$$, fa = MP.fa, icon = MP.icon;
  var tab = 'perf', userSel = $('#rep-user'), auditType = '', auditPage = 1;

  function stat(label, value, sub, cls) { return el('article', { class: 'card stat' }, el('small', { text: label }), el('strong', { class: cls || '', text: value }), el('span', { text: sub })); }

  function perf() {
    var body = $('#rep-body');
    body.replaceChildren(el('div', { class: 'rep-stats' }, [1, 2, 3, 4, 5].map(function () { return el('div', { class: 'card stat' }, el('span', { class: 'sk sk-text' }), el('span', { class: 'sk sk-text', style: { height: '28px', width: '60%' } })); })));
    MP.api('reports', { query: { user_id: S.manager ? userSel.value : '' } }).then(function (r) {
      if (tab !== 'perf') return;
      var diff = r.lastWeek ? Math.round((r.thisWeek - r.lastWeek) / r.lastWeek * 100) : null;
      var onTime = r.doneTotal ? Math.round(r.onTime / r.doneTotal * 100) : 0;
      var mgr = r.managerTasks.total ? Math.round(r.managerTasks.done / r.managerTasks.total * 100) : 0;
      var parts = [el('div', { class: 'rep-stats' },
        stat('انجام‌شده این هفته', fa(r.thisWeek), diff === null ? 'هفته قبل: ' + fa(r.lastWeek) : (diff >= 0 ? '▲ ' + fa(diff) + '٪ بیشتر از هفته قبل' : '▼ ' + fa(-diff) + '٪ کمتر از هفته قبل')),
        stat('۳۰ روز اخیر', fa(r.month), 'تسک انجام‌شده'),
        stat('تسک‌های باز', fa(r.open), fa(r.overdue) + ' عقب‌افتاده', r.overdue ? 'prio-high' : ''),
        stat('انجام به‌موقع', fa(onTime) + '٪', 'از ' + fa(r.doneTotal) + ' تسک انجام‌شده'),
        stat('تسک‌های ناظر', fa(mgr) + '٪', fa(r.managerTasks.done) + ' از ' + fa(r.managerTasks.total) + ' انجام شده'))];

      var max = Math.max.apply(null, r.daily.map(function (d) { return d.total; }).concat([1]));
      var bars = el('div', { class: 'day-bars', role: 'img', 'aria-label': 'تسک‌ها در ۱۴ روز اخیر' });
      r.daily.forEach(function (d) {
        bars.append(el('div', { class: 'db', title: J.formatLong(d.date) + ': ' + fa(d.done) + ' از ' + fa(d.total) },
          el('span', { class: 'db-track' }, el('i', { class: 't', style: { height: d.total / max * 100 + '%' } }), el('i', { class: 'd', style: { height: d.done / max * 100 + '%' } })),
          el('small', { text: fa(J.fromIso(d.date).jd) })));
      });
      parts.push(el('section', { class: 'card rep-wide' }, el('div', { class: 'card-head' }, el('h2', { text: '۱۴ روز اخیر' }),
        el('div', { class: 'legend', style: { margin: 0 } }, el('span', null, el('i', { class: 'lg lg-self' }), 'انجام شده'), el('span', null, el('i', { class: 'lg', style: { background: 'var(--surface-3)' } }), 'کل تسک‌ها'))), bars));

      var proj = el('section', { class: 'card rep-wide' }, el('h2', { class: 'card-title', text: 'پیشرفت پروژه‌ها' }));
      if (!S.projects.length) proj.append(MP.empty('folder', 'پروژه‌ای ندارید', null, null, true));
      S.projects.forEach(function (p) {
        var total = p.tasks.todo + p.tasks.doing + p.tasks.done, pct = total ? Math.round(p.tasks.done / total * 100) : 0, bar = el('i'); bar.style.width = pct + '%';
        proj.append(el('div', { class: 'cat-row', style: { gridTemplateColumns: 'minmax(120px,220px) 1fr auto', padding: '10px 0', borderBottom: '1px solid var(--line)' } },
          el('strong', { text: p.name }), el('div', { class: 'bar' + (pct === 100 ? ' ok' : '') }, bar), el('span', { class: 'muted', text: fa(pct) + '٪ · ' + fa(p.tasks.done) + '/' + fa(total) })));
      });
      parts.push(proj);

      if (r.team.length) {
        var tb = el('tbody');
        r.team.forEach(function (m) {
          tb.append(el('tr', null,
            el('td', null, el('button', { type: 'button', class: 'link', text: m.name, onclick: function () { userSel.value = m.id; perf(); } })),
            el('td', { text: fa(m.open) }), el('td', { class: m.overdue ? 'prio-high' : '', text: fa(m.overdue) }), el('td', { text: fa(m.done) }),
            el('td', null, el('button', { type: 'button', class: 'link', text: 'تقویم', onclick: function () { MP.showView('calendar', { userId: m.id }); } }))));
        });
        parts.push(el('section', { class: 'card rep-wide' }, el('h2', { class: 'card-title', text: 'وضعیت تیم' }),
          el('div', { class: 'table-wrap' }, el('table', { class: 'table' }, el('thead', null, el('tr', null, ['عضو', 'باز', 'عقب‌افتاده', 'انجام‌شده این هفته', ''].map(function (h) { return el('th', { text: h }); }))), tb))));
      }
      body.replaceChildren.apply(body, parts);
    }).catch(MP.soft);
  }

  var AUDIT_ICON = { task: 'tasks', ledger: 'wallet', leave: 'leave', attendance: 'clock', project: 'folder', meeting: 'video', member: 'user' };
  var AUDIT_ACTION = { create: 'ایجاد', update: 'ویرایش', delete: 'حذف', approved: 'تأیید', rejected: 'رد', 'in': 'ورود', out: 'خروج', add: 'افزودن', remove: 'حذف', file: 'پیوست', import: 'ورود اکسل', undo: 'بازگردانی' };
  function audit(append) {
    var body = $('#rep-body');
    if (!append) {
      auditPage = 1;
      var types = el('div', { class: 'seg sm', role: 'tablist', style: { flexWrap: 'wrap' } });
      [['', 'همه'], ['task', 'تسک'], ['ledger', 'حسابداری'], ['leave', 'مرخصی'], ['attendance', 'حضور'], ['project', 'پروژه'], ['meeting', 'جلسه']].forEach(function (t) {
        types.append(el('button', { type: 'button', role: 'tab', 'aria-selected': String(t[0] === auditType), text: t[1], onclick: function () { auditType = t[0]; audit(); } }));
      });
      body.replaceChildren(el('section', { class: 'card pad' }, el('div', { class: 'card-head' }, el('h2', { text: 'تاریخچه تغییرات' }), types), el('div', { id: 'audit-list' }, MP.skeleton(5)), el('div', { id: 'audit-more' })));
    }
    MP.api('audit', { query: { type: auditType, user_id: userSel.value !== String(S.me.id) ? userSel.value : '', page: auditPage } }).then(function (rows) {
      var list = $('#audit-list'); if (!list) return;
      if (!append) list.replaceChildren();
      if (!rows.length && !append) list.append(MP.empty('list', 'تغییری ثبت نشده', null, null, true));
      rows.forEach(function (r) {
        list.append(el('div', { class: 'audit-item' }, el('span', { class: 'pop-ico', html: icon(AUDIT_ICON[r.type] || 'edit') }),
          el('div', { style: { flex: '1', minWidth: '0' } },
            el('strong', { text: r.user + ' · ' + (AUDIT_ACTION[r.action] || r.action) + ' ' + r.type_label }),
            el('p', { text: MP.faDigits(r.summary.replace(/→ (todo|doing|done)/, function (m, s) { return '→ ' + MP.STATUS[s]; })) }),
            el('small', { text: MP.relTime(r.created_at) }))));
      });
      var more = $('#audit-more'); more.replaceChildren();
      if (rows.length === 50) more.append(el('button', { type: 'button', class: 'btn btn-secondary btn-block', text: 'موارد بیشتر', onclick: function () { auditPage++; audit(true); } }));
    }).catch(MP.soft);
  }

  function open() {
    if (S.manager && userSel.options.length !== S.users.length) {
      userSel.replaceChildren();
      S.users.forEach(function (u) { userSel.append(el('option', { value: u.id, text: u.id === S.me.id ? 'خودم' : u.name })); });
      userSel.value = S.me.id;
    }
    userSel.hidden = tab === 'costs' || tab === 'payroll';
    if (tab === 'audit') audit(); else if (tab === 'costs') MP.costReport($('#rep-body')); else if (tab === 'payroll') MP.payroll($('#rep-body')); else perf();
  }
  userSel.onchange = open;
  $$('#rep-tab button').forEach(function (b) {
    b.onclick = function () { tab = b.dataset.tab; $$('#rep-tab button').forEach(function (x) { x.setAttribute('aria-selected', String(x === b)); }); open(); };
  });
  MP.view('reports', { open: open });
  MP.reportTab = function (name) {
    tab = name;
    $$('#rep-tab button').forEach(function (x) { x.setAttribute('aria-selected', String(x.dataset.tab === name)); });
    if (MP.visible('reports')) open(); else MP.showView('reports');
  };
  MP.on('audit', function () { if (MP.visible('reports') && tab === 'audit') audit(); });
})();
