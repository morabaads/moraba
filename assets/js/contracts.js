/* Contracts (supervisors): from a template with {variables}, filled per project and customer, sent for online signing. */
(function () {
  'use strict';
  var MP = window.MP, S = MP.S, J = MP.J, el = MP.el, $ = MP.$, fa = MP.fa, icon = MP.icon;
  var STATUS = { draft: 'پیش‌نویس', sent: 'منتظر امضای مشتری', signed: 'امضاشده', cancelled: 'لغوشده' };
  var TONE = { draft: '', sent: 'brand', signed: 'ok', cancelled: 'danger' };
  var SYSTEM = ['نام استودیو', 'نشانی استودیو', 'شماره قرارداد', 'تاریخ قرارداد', 'نام پروژه'];
  var list = [], templates = [], settings = {}, tab = 'all', q = '';

  /* ------------------------------------------------------------ text helpers (same rules as the server) */

  function vars(body) {
    var out = [], re = /\{([^{}\n]{1,60})\}/g, m;
    while ((m = re.exec(body))) { var n = m[1].trim(); if (out.indexOf(n) < 0 && SYSTEM.indexOf(n) < 0) out.push(n); }
    return out;
  }
  function kind(n) {
    if (/مبلغ|هزینه|قیمت/.test(n)) return 'money';
    if (/تاریخ/.test(n)) return 'date';
    if (/کد ?ملی|شناسه ملی/.test(n)) return 'national';
    if (/تماس|موبایل|تلفن/.test(n)) return 'phone';
    if (/آدرس|نشانی|شرح|توضیح|دامنه/.test(n)) return 'long';
    return 'text';
  }
  function num(v) { return +(J.latinDigits(String(v || '')).replace(/\D/g, '')) || 0; }
  function words(n) {
    var ones = ['', 'یک', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'هفت', 'هشت', 'نه'], teens = ['ده', 'یازده', 'دوازده', 'سیزده', 'چهارده', 'پانزده', 'شانزده', 'هفده', 'هجده', 'نوزده'];
    var tens = ['', '', 'بیست', 'سی', 'چهل', 'پنجاه', 'شصت', 'هفتاد', 'هشتاد', 'نود'], hund = ['', 'صد', 'دویست', 'سیصد', 'چهارصد', 'پانصد', 'ششصد', 'هفتصد', 'هشتصد', 'نهصد'];
    var units = ['', ' هزار', ' میلیون', ' میلیارد', ' هزار میلیارد'];
    function three(x) { var p = []; if (x >= 100) { p.push(hund[Math.floor(x / 100)]); x %= 100; } if (x >= 20) { p.push(tens[Math.floor(x / 10)]); x %= 10; } else if (x >= 10) { p.push(teens[x - 10]); x = 0; } if (x) p.push(ones[x]); return p.join(' و '); }
    if (!n) return 'صفر';
    var parts = [], i = 0;
    while (n > 0 && i < units.length) { var c = n % 1000; if (c) parts.unshift(c === 1 && i === 1 ? 'هزار' : three(c) + units[i]); n = Math.floor(n / 1000); i++; }
    return parts.join(' و ');
  }
  function no(x) { return '\u2066' + J.faDigits(x) + '\u2069'; } // keeps «CT-1405-003» in order inside RTL text
  function money(n) { return J.faDigits(Number(n || 0).toLocaleString('en-US')) + ' تومان'; }
  function show(name, v) {
    v = String(v || '').trim(); if (!v) return '';
    var k = kind(name);
    if (k === 'money') { var n = num(v); return n ? money(n) + ' (' + words(n) + ' تومان)' : v; }
    if (k === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return J.formatLong(v);
    return J.faDigits(v);
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function render(body, values, sys) {
    var all = Object.assign({}, values, sys);
    function fill(line) {
      return esc(line).replace(/\{([^{}\n]{1,60})\}/g, function (m, n) {
        n = n.trim(); var v = show(n, all[n]);
        return v ? '<b class="v">' + esc(v) + '</b>' : '<span class="blank">' + esc(n) + '</span>';
      });
    }
    var out = '', inList = false;
    String(body).split(/\r?\n/).forEach(function (line) {
      var t = line.trim();
      if (t.indexOf('- ') === 0) { if (!inList) { out += '<ul>'; inList = true; } out += '<li>' + fill(t.slice(2)) + '</li>'; return; }
      if (inList) { out += '</ul>'; inList = false; }
      if (!t) return;
      if (t.indexOf('### ') === 0) out += '<h3>' + fill(t.slice(4)) + '</h3>';
      else if (t.indexOf('## ') === 0) out += '<h2>' + fill(t.slice(3)) + '</h2>';
      else if (t.indexOf('# ') === 0) out += '<h1>' + fill(t.slice(2)) + '</h1>';
      else if (t.indexOf('> ') === 0) out += '<p class="note">' + fill(t.slice(2)) + '</p>';
      else out += '<p>' + fill(t) + '</p>';
    });
    return out + (inList ? '</ul>' : '');
  }
  function copy(url) { (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { MP.toast('لینک قرارداد کپی شد'); }, function () { prompt('لینک قرارداد', url); }); }

  /* ------------------------------------------------------------ list page */

  function load(openId) {
    if (!list.length) $('#ct-body').replaceChildren(MP.skeleton(3));
    return MP.api('contracts', { query: { archived: tab === 'archived' ? 1 : '' } }).then(function (d) {
      list = d.items; templates = d.templates; settings = d.settings; draw();
      if (openId) { var c = list.filter(function (x) { return x.id === +openId; })[0]; if (c) editor(c); }
    }).catch(MP.soft);
  }
  function draw() {
    var tabs = $('#ct-tabs'), body = $('#ct-body');
    var T = [['all', 'همه'], ['draft', 'پیش‌نویس'], ['sent', 'منتظر امضا'], ['signed', 'امضاشده'], ['archived', 'آرشیو']];
    tabs.replaceChildren.apply(tabs, T.map(function (t) {
      var n = t[0] === 'all' || t[0] === 'archived' ? null : list.filter(function (c) { return c.status === t[0]; }).length;
      return el('button', { type: 'button', role: 'tab', class: 'tab', 'aria-selected': String(tab === t[0]), onclick: function () { var was = tab; tab = t[0]; if ((was === 'archived') !== (tab === 'archived')) { list = []; load(); } else draw(); } }, t[1], n ? el('span', { class: 'tab-n', text: ' ' + fa(n) }) : null);
    }));
    var shown = list.filter(function (c) { return (tab === 'all' || tab === 'archived' || c.status === tab) && (!q || MP.norm(c.title + ' ' + c.client_name + ' ' + c.project + ' ' + c.number).indexOf(q) >= 0); });
    var signed = list.filter(function (c) { return c.status === 'signed'; }), waiting = list.filter(function (c) { return c.status === 'sent'; });
    body.replaceChildren(
      tab !== 'archived' ? el('div', { class: 'kpis ct-kpis' },
        kpi('edit', 'قرارداد', fa(list.length)),
        kpi('clock', 'منتظر امضای مشتری', fa(waiting.length), waiting.length ? 'warn' : ''),
        kpi('checks', 'امضاشده', fa(signed.length)),
        kpi('wallet', 'جمع قراردادهای امضاشده', signed.length ? money(signed.reduce(function (s, c) { return s + c.amount; }, 0)) : '—')) : null,
      shown.length ? el('div', { class: 'ct-grid' }, shown.map(card))
        : MP.empty('edit', tab === 'archived' ? 'آرشیو خالی است' : 'قراردادی نیست', tab === 'archived' ? null : 'از روی قالب قرارداد بسازید، جاهای خالی را پر کنید و برای امضای آنلاین مشتری بفرستید.', tab === 'archived' ? null : { text: 'قرارداد جدید', onclick: function () { editor(); } }));
  }
  function kpi(ic, label, value, tone) {
    return el('article', { class: 'card kpi static' }, el('div', { class: 'kpi-icon' + (tone ? ' ' + tone : ''), html: icon(ic) }), el('div', { class: 'kpi-copy' }, el('small', { text: label }), el('strong', { text: value })));
  }
  function card(c) {
    return el('article', { class: 'card ct-card ' + c.status },
      el('button', { type: 'button', class: 'ct-main', onclick: function () { editor(c); } },
        el('div', { class: 'ct-paper', 'aria-hidden': 'true' }, el('i'), el('i'), el('i'), c.status === 'signed' ? el('span', { class: 'ct-seal', html: icon('check') }) : null),
        el('div', { class: 'ct-copy' },
          el('small', { class: 'muted', text: no(c.number) + ' · ' + J.format(c.created_at.slice(0, 10)) }),
          el('strong', { text: c.title }),
          el('span', { class: 'ct-who', text: [c.client_name, c.project].filter(Boolean).join(' · ') || 'بدون مشتری' }),
          el('div', { class: 'ct-chips' }, el('span', { class: 'chip ' + TONE[c.status], text: STATUS[c.status] }), c.amount ? el('span', { class: 'chip', text: money(c.amount) }) : null))),
      c.status === 'signed' ? el('p', { class: 'ct-signed', html: icon('checks') + ' ' }, 'امضا: ' + c.signer_name + ' · ' + J.format(c.signed_at.slice(0, 10))) : null,
      el('footer', { class: 'ct-actions' },
        el('a', { class: 'btn btn-ghost btn-sm', href: c.url, target: '_blank', rel: 'noopener', html: icon('eye') + 'نمایش' }),
        el('a', { class: 'btn btn-ghost btn-sm', href: c.url + (c.url.indexOf('?') < 0 ? '?' : '&') + 'print=1', target: '_blank', rel: 'noopener', html: icon('print') + 'چاپ / PDF' }),
        c.status === 'draft' || c.status === 'sent' ? el('button', { type: 'button', class: 'btn btn-primary btn-sm', html: icon('send') + (c.status === 'sent' ? 'ارسال دوباره' : 'ارسال برای امضا'), onclick: function () { sendDialog(c); } }) : null));
  }

  /* ------------------------------------------------------------ editor */

  function editor(c) {
    c = c || {};
    var isNew = !c.id, locked = c.status === 'signed' || c.status === 'cancelled';
    var tpl = templates.filter(function (t) { return t.id === (c.template_id || 0); })[0] || templates[0];
    var body = c.body || tpl.body, values = Object.assign({}, c.vars || {});
    var preview = el('div', { class: 'ct-doc' }), fieldsBox = el('div', { class: 'ct-fields' });
    var customers = [];
    var f = el('form', { class: 'form ct-form' });
    var tplSel = MP.select('template_id', templates.map(function (t) { return [t.id, t.title]; }), tpl.id);
    var title = el('input', { name: 'title', maxlength: 200, value: c.title || 'قرارداد طراحی و توسعه وب‌سایت', placeholder: 'عنوان قرارداد' });
    var proj = MP.projectSelect('project_id', c.project_id || 0);
    var cust = el('select', { name: 'client_id' }, el('option', { value: '', text: '— مشتری —' }), el('option', { value: 'new', text: '＋ مشتری جدید…' }));
    var newName = el('input', { maxlength: 160, placeholder: 'نام مشتری جدید' }), newWrap = MP.field('نام مشتری جدید', newName);
    newWrap.hidden = true;
    var text = el('textarea', { class: 'ct-text', rows: 16, dir: 'rtl' }, body);
    function sys() { var p = MP.project(+proj.value); return { 'نام استودیو': settings.studio, 'نشانی استودیو': settings.address, 'شماره قرارداد': c.number || 'CT-…', 'تاریخ قرارداد': J.formatLong(c.created_at ? c.created_at.slice(0, 10) : S.today), 'نام پروژه': p ? p.name : '' }; }
    function paint() {
      var p = MP.project(+proj.value);
      preview.innerHTML = '<div class="ct-doc-head"><small>' + esc(settings.studio || '') + '</small><h2>' + esc(title.value || 'قرارداد') + '</h2><span>' + esc(J.faDigits(c.number || 'پیش‌نویس')) + (p ? ' · ' + esc(p.name) : '') + '</span></div>' + render(body, values, sys());
      var total = vars(body), done = total.filter(function (n) { return String(values[n] || '').trim(); }).length;
      $('.ct-progress', f).textContent = fa(done) + ' از ' + fa(total.length) + ' مورد پر شده';
    }
    function fields() {
      fieldsBox.replaceChildren();
      vars(body).forEach(function (n) {
        var k = kind(n), input;
        if (k === 'date') {
          if (!values[n]) values[n] = S.today;
          var df = MP.dateField('v_' + n, values[n], n, function () { values[n] = input.value; paint(); });
          input = df.querySelector('input'); fieldsBox.append(df);
        }
        else {
          input = k === 'long' ? el('textarea', { rows: 2, maxlength: 1000 }, values[n] || '') : el('input', { maxlength: 300, value: k === 'money' ? (values[n] ? J.faDigits(num(values[n]).toLocaleString('en-US')) : '') : values[n] || '', inputmode: k === 'money' || k === 'national' || k === 'phone' ? 'numeric' : null, dir: k === 'phone' || k === 'national' ? 'ltr' : null });
          var hint = k === 'money' ? el('small', { class: 'ct-words' }) : null;
          var box = MP.field(n, input); if (hint) box.append(hint);
          fieldsBox.append(box);
          if (k === 'money') { var upd = function () { var v = num(input.value); input.value = v ? J.faDigits(v.toLocaleString('en-US')) : ''; hint.textContent = v ? words(v) + ' تومان' : ''; }; input.addEventListener('input', upd); upd(); }
        }
        input.disabled = locked;
        var sync = function () { values[n] = k === 'money' ? String(num(input.value) || '') : k === 'national' || k === 'phone' ? J.latinDigits(input.value).trim() : input.value; paint(); };
        input.addEventListener('input', sync); input.addEventListener('change', sync);
      });
      if (!fieldsBox.children.length) fieldsBox.append(el('p', { class: 'muted', text: 'این متن جای خالی ندارد.' }));
    }
    function autofill(force) {
      var cu = customers.filter(function (x) { return String(x.id) === cust.value; })[0];
      var name = cu ? cu.name : cust.value === 'new' ? newName.value : '';
      vars(body).forEach(function (n) {
        if (!force && String(values[n] || '').trim()) return;
        if (/نام.*(مشتری|کارفرما)/.test(n) && name) values[n] = name;
        else if (/تماس|موبایل/.test(n) && cu && cu.phone) values[n] = cu.phone;
        else if (/آدرس|نشانی/.test(n) && !/استودیو/.test(n) && cu && cu.info) values[n] = cu.info;
        else if (n === 'نام مجری' && settings.agent) values[n] = settings.agent;
      });
      fields(); paint();
    }
    cust.onchange = function () {
      newWrap.hidden = cust.value !== 'new';
      var cu = customers.filter(function (x) { return String(x.id) === cust.value; })[0];
      if (cu && !+proj.value && cu.projects.length === 1) proj.value = cu.projects[0];
      autofill(false);
    };
    newName.addEventListener('input', function () { autofill(true); });
    tplSel.onchange = function () {
      var t = templates.filter(function (x) { return String(x.id) === tplSel.value; })[0];
      if (t) { body = t.body; text.value = body; autofill(false); }
    };
    text.addEventListener('input', function () { body = text.value; clearTimeout(text.t); text.t = setTimeout(function () { fields(); paint(); }, 250); });
    title.addEventListener('input', paint); proj.addEventListener('change', paint);
    [tplSel, title, proj, cust, newName, text].forEach(function (x) { x.disabled = locked; });
    MP.api('customers').then(function (l) {
      customers = l;
      l.forEach(function (x) { cust.insertBefore(el('option', { value: x.id, text: x.name }), cust.lastChild); });
      cust.value = c.client_id ? String(c.client_id) : c.client_name ? 'new' : '';
      if (cust.value === 'new') newName.value = c.client_name;
      newWrap.hidden = cust.value !== 'new';
      autofill(false);
    }).catch(function () { autofill(false); });

    var info = c.status === 'signed' ? el('div', { class: 'ct-signinfo' }, el('b', { html: icon('checks') + ' امضاشده توسط ' + esc(c.signer_name) }),
      el('small', { text: J.format(c.signed_at.slice(0, 10)) + ' · ' + (c.signer_mobile ? 'تأیید پیامکی ' + J.faDigits(c.signer_mobile) : 'امضای دستی') + ' · اثر انگشت ' + c.fingerprint })) : null;
    if (info) f.append(info);
    f.append(
      el('div', { class: 'ct-edit' },
        el('div', { class: 'ct-side' },
          el('div', { class: 'row' }, MP.field('قالب', tplSel), MP.field('عنوان', title)),
          el('div', { class: 'row' }, MP.field('مشتری', cust), MP.field('پروژه', proj)),
          newWrap,
          el('div', { class: 'ct-fields-head' }, el('strong', { text: 'جاهای خالی قرارداد' }), el('small', { class: 'ct-progress muted' })),
          fieldsBox,
          el('details', { class: 'ct-custom' }, el('summary', { text: 'ویرایش متن همین قرارداد' }),
            el('p', { class: 'hint', text: '«## » ماده، «### » زیرعنوان، «- » بند، «> » تبصره؛ هر چیزی داخل {آکولاد} یک جای خالی است.' }), text)),
        el('div', { class: 'ct-preview' }, el('div', { class: 'ct-preview-bar' }, el('span', { html: icon('eye') + ' پیش‌نمایش' }), c.url ? el('a', { href: c.url, target: '_blank', rel: 'noopener', text: 'صفحه کامل' }) : null), preview)),
      locked ? el('div', { class: 'dialog-actions' },
        el('a', { class: 'btn btn-primary', href: c.url + (c.url.indexOf('?') < 0 ? '?' : '&') + 'print=1', target: '_blank', rel: 'noopener', html: icon('print') + 'چاپ / PDF' }),
        el('button', { type: 'button', class: 'btn btn-secondary', html: icon('repeat') + 'نسخه تازه از روی این', onclick: function () { MP.api('contracts/' + c.id + '/duplicate', { method: 'POST' }).then(function (n) { MP.toast('نسخه ' + n.number + ' ساخته شد'); load(n.id); }).catch(MP.soft); } }),
        el('button', { type: 'button', class: 'btn btn-ghost', text: c.archived ? 'بازگرداندن' : 'آرشیو', onclick: function () { archive(c); } }))
      : MP.actions(isNew ? 'ذخیره پیش‌نویس' : 'ذخیره', el('span', { class: 'inv-edit-extra' },
        el('button', { type: 'button', class: 'btn btn-secondary', html: icon('send') + 'ذخیره و ارسال برای امضا', onclick: function () { save(true); } }),
        !isNew ? el('button', { type: 'button', class: 'btn btn-ghost', text: 'لغو', onclick: function () { MP.api('contracts/' + c.id + '/status', { method: 'POST', body: { status: 'cancelled' } }).then(function () { MP.dialog.close(); load(); }).catch(MP.soft); } }) : null,
        !isNew ? el('button', { type: 'button', class: 'btn btn-ghost', text: c.archived ? 'بازگرداندن' : 'آرشیو', onclick: function () { archive(c); } }) : null)));
    function save(andSend) {
      if (!cust.value) { MP.toast('مشتری را انتخاب کنید یا «مشتری جدید» را بزنید.', { error: true }); cust.focus(); return; }
      MP.busy(f, true);
      MP.api(isNew ? 'contracts' : 'contracts/' + c.id, { method: 'POST', body: { title: title.value, template_id: +tplSel.value, project_id: +proj.value, client_id: /^\d+$/.test(cust.value) ? +cust.value : 0, client_name: cust.value === 'new' ? newName.value : '', body: body, vars: values } })
        .then(function (saved) { MP.toast('قرارداد ' + saved.number + ' ذخیره شد'); load(); if (andSend) sendDialog(saved); else MP.dialog.close(); })
        .catch(function (err) { MP.busy(f, false); MP.soft(err); });
    }
    f.onsubmit = function (e) { e.preventDefault(); save(false); };
    fields(); paint();
    MP.dialog.open(isNew ? 'قرارداد جدید' : 'قرارداد ' + no(c.number), f, { wide: true, focus: false });
    var dlg = f.closest('.dialog'); if (dlg) dlg.classList.add('ct-dialog');
  }
  function archive(c) {
    MP.api('contracts/' + c.id, { method: 'DELETE', query: c.archived ? { restore: 1 } : {} }).then(function () { MP.dialog.close(); MP.toast(c.archived ? 'بازگردانده شد' : 'آرشیو شد'); list = []; load(); }).catch(MP.soft);
  }

  function sendDialog(c) {
    var sms = el('input', { type: 'checkbox', checked: !!c.phone });
    var box = el('div', { class: 'form' },
      el('p', { text: 'قرارداد ' + no(c.number) + ' برای ' + (c.client_name || 'مشتری') + ' فرستاده می‌شود. امضای مجری از «قالب‌ها و ظاهر» روی آن می‌نشیند و مشتری با کشیدن امضا' + (settings.otp ? ' و کد تأیید پیامکی' : '') + ' آن را امضا می‌کند.' }),
      c.phone ? el('label', { class: 'check' }, sms, el('span', { text: 'لینک امضا به ' + J.faDigits(c.phone) + ' پیامک شود' })) : el('p', { class: 'hint', text: 'در قرارداد شماره تماسی نیست؛ لینک را در گروه مشتری بفرستید یا کپی کنید.' }),
      el('div', { class: 'field' }, el('span', { text: 'ارسال در گفت‌وگوی مشتری' }),
        el('div', { class: 'inv-channels' }, c.channels.length ? c.channels.map(function (g) {
          return el('button', { type: 'button', class: 'btn btn-primary btn-sm', html: icon('chat') + g.title, onclick: function () { go(g.id); } });
        }) : el('p', { class: 'hint', text: 'این پروژه/مشتری گروه گفت‌وگو ندارد.' }))),
      el('div', { class: 'dialog-actions' },
        el('button', { type: 'button', class: 'btn btn-secondary', html: icon('send') + 'فقط ارسال (بدون گروه)', onclick: function () { go(0); } }),
        el('button', { type: 'button', class: 'btn btn-ghost', html: icon('clip') + 'کپی لینک', onclick: function () { copy(c.url); } })));
    function go(channel) {
      MP.api('contracts/' + c.id + '/send', { method: 'POST', body: { channel_id: channel, sms: sms.checked } }).then(function (n) {
        MP.dialog.close(); MP.toast('قرارداد برای امضا ارسال شد' + (n.sms_sent ? ' و پیامک شد' : '')); load();
      }).catch(MP.soft);
    }
    MP.dialog.open('ارسال برای امضا', box);
  }

  /* ------------------------------------------------------------ templates & look */

  function settingsDialog() {
    var s = settings, sig = s.signature || '';
    var pad = el('canvas', { class: 'ct-pad' }), ctx, drawn = false, down = false, last = null;
    var sigImg = el('img', { class: 'ct-sig-img', alt: 'امضای مجری', src: sig || '', hidden: !sig });
    function padInit() {
      var r = pad.getBoundingClientRect(), d = window.devicePixelRatio || 1;
      pad.width = r.width * d; pad.height = r.height * d; ctx = pad.getContext('2d'); ctx.scale(d, d);
      ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#1a2a6c';
    }
    function p(e) { var r = pad.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    pad.addEventListener('pointerdown', function (e) { if (!ctx) padInit(); down = true; last = p(e); pad.setPointerCapture(e.pointerId); });
    pad.addEventListener('pointermove', function (e) { if (!down) return; var q2 = p(e); ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(q2.x, q2.y); ctx.stroke(); last = q2; drawn = true; });
    ['pointerup', 'pointercancel'].forEach(function (t) { pad.addEventListener(t, function () { down = false; }); });
    var styles = el('div', { class: 'ct-styles' }, [['modern', 'مدرن'], ['classic', 'کلاسیک'], ['minimal', 'مینیمال']].map(function (x) {
      return el('label', { class: 'ct-style' }, el('input', { type: 'radio', name: 'style', value: x[0], checked: (s.style || 'modern') === x[0] }), el('span', { class: 'ct-style-art ' + x[0] }, el('i'), el('i'), el('i')), el('b', { text: x[1] }));
    }));
    var f = el('form', { class: 'form' },
      el('h3', { class: 'tio-sub', text: 'ظاهر قرارداد' }),
      styles,
      el('div', { class: 'row' },
        MP.field('رنگ اصلی', el('input', { type: 'color', name: 'accent', value: s.accent || '#f28a24', class: 'ct-color' })),
        el('label', { class: 'check', style: { alignSelf: 'end' } }, el('input', { type: 'checkbox', name: 'logo', checked: s.logo !== false }), el('span', { text: 'لوگو بالای قرارداد' }))),
      el('div', { class: 'row' }, MP.field('نام مجری (استودیو)', el('input', { name: 'studio', value: s.studio || '' })), MP.field('نماینده / امضاکننده', el('input', { name: 'agent', value: s.agent || '' }))),
      MP.field('نشانی مجری', el('input', { name: 'address', value: s.address || '' })),
      MP.field('متن پایین صفحه', el('input', { name: 'footer', value: s.footer || '' })),
      el('label', { class: 'check' }, el('input', { type: 'checkbox', name: 'otp', checked: s.otp !== false }), el('span', { text: 'امضای مشتری با کد تأیید پیامکی (وریفای موبایل)' })),
      el('div', { class: 'field' }, el('span', { text: 'امضای مجری' }),
        el('div', { class: 'ct-sig' }, sigImg, pad,
          el('div', { class: 'ct-sig-actions' },
            el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'پاک کردن', onclick: function () { if (ctx) ctx.clearRect(0, 0, pad.width, pad.height); drawn = false; sig = ''; sigImg.hidden = true; } }),
            el('small', { class: 'muted', text: 'امضای خود را در کادر بکشید؛ روی همه قراردادهای ارسال‌شده می‌نشیند.' })))),
      MP.actions('ذخیره ظاهر'));
    f.onsubmit = function (e) {
      e.preventDefault(); MP.busy(f, true);
      var v = f.elements;
      MP.api('contracts/settings', { method: 'POST', body: { style: f.querySelector('[name=style]:checked').value, accent: v.accent.value, logo: v.logo.checked, studio: v.studio.value, agent: v.agent.value, address: v.address.value, footer: v.footer.value, otp: v.otp.checked, signature: drawn ? pad.toDataURL('image/png') : sig } })
        .then(function (n) { settings = n; MP.toast('ظاهر قرارداد ذخیره شد'); MP.dialog.close(); }).catch(function (err) { MP.busy(f, false); MP.soft(err); });
    };
    var tl = el('div', { class: 'tio-history' });
    function drawTemplates() {
      tl.replaceChildren.apply(tl, templates.map(function (t) {
        return el('article', { class: 'tpl-card' }, el('div', { class: 'tpl-ico', html: icon('edit') }),
          el('div', { class: 'tpl-copy' }, el('strong', { text: t.title }), el('small', { text: fa(vars(t.body).length) + ' جای خالی' + (t.builtin ? ' · قالب پیش‌فرض' : '') })),
          el('div', { class: 'tpl-actions' },
            el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: t.builtin ? 'کپی و ویرایش' : 'ویرایش', onclick: function () { templateForm(t.builtin ? { title: t.title + ' (نسخه من)', body: t.body } : t); } }),
            t.builtin ? null : el('button', { type: 'button', class: 'icon-btn sm', title: 'حذف', 'aria-label': 'حذف', html: icon('trash'), onclick: function () { MP.api('contract-templates/' + t.id, { method: 'DELETE' }).then(function (l) { templates = l; drawTemplates(); }).catch(MP.soft); } })));
      }));
    }
    drawTemplates();
    MP.dialog.open('قالب‌ها و ظاهر قرارداد', el('div', null,
      el('h3', { class: 'tio-sub', text: 'قالب‌های متن' }), tl,
      el('button', { type: 'button', class: 'chip-btn', html: icon('plus') + ' قالب جدید', onclick: function () { templateForm({ title: '', body: '## ماده ۱: موضوع قرارداد\n...\n\n## ماده ۲: مبلغ قرارداد\nمبلغ قرارداد {مبلغ پروژه} می‌باشد.' }); } }),
      f), { wide: true, focus: false });
  }
  function templateForm(t) {
    var f = el('form', { class: 'form' },
      MP.field('نام قالب', el('input', { name: 'title', required: true, maxlength: 160, value: t.title || '' })),
      MP.field('متن', el('textarea', { name: 'body', rows: 18, class: 'ct-text' }, t.body || ''), '«## » ماده، «### » زیرعنوان، «- » بند، «> » تبصره؛ {نام مشتری}، {مبلغ پروژه}، {کد ملی مشتری}… جاهای خالی‌اند. {نام استودیو}، {شماره قرارداد}، {تاریخ قرارداد} و {نام پروژه} خودکار پر می‌شوند.'),
      MP.actions('ذخیره قالب'));
    f.onsubmit = function (e) {
      e.preventDefault(); MP.busy(f, true);
      MP.api(t.id ? 'contract-templates/' + t.id : 'contract-templates', { method: 'POST', body: { title: f.elements.title.value, body: f.elements.body.value } })
        .then(function (l) { templates = l; MP.toast('قالب ذخیره شد'); settingsDialog(); }).catch(function (err) { MP.busy(f, false); MP.soft(err); });
    };
    MP.dialog.open(t.id ? 'ویرایش قالب' : 'قالب جدید', f, { wide: true });
  }

  MP.newContract = function (o) { MP.showView('contracts'); load().then(function () { editor({ project_id: o.project_id, client_id: o.client_id }); }); };
  MP.view('contracts', { open: function (o) { load(o && o.open); } });
  $('#ct-new').onclick = function () { editor(); };
  $('#ct-settings').onclick = settingsDialog;
})();
