/*
 * Voice command from anywhere in the panel (topbar mic, or Ctrl+Shift+Space).
 * Understands: «ورودم رو ثبت کن» / «خروج»، «پیام به رضا: فایل رو فرستادم»، «یادم بنداز فردا ساعت ۱۰ …»،
 * «۱۳۰ تومن خرج برای …»، «تسک فردا ساعت ۱۱ …»، «برو به تقویم»، «گزارش روزانه»، «فاکتورها».
 * Clock in/out and navigation run at once; anything that sends or saves shows a preview with «انجام بده».
 */
(function () {
  'use strict';
  var MP = window.MP, S = MP.S, J = MP.J, el = MP.el, $ = MP.$, fa = MP.fa, icon = MP.icon;
  var V = MP.Voice;

  var VIEWS = [[/میز ?کار|داشبورد|خانه/, 'dashboard', 'میز کار'], [/تقویم/, 'calendar', 'تقویم'], [/تسک|کارهام|کارهای من/, 'mytasks', 'تسک‌های من'], [/پروژه/, 'projects', 'پروژه‌ها'], [/پیام|چت|گفتگو|گفت‌وگو/, 'messages', 'پیام‌ها'], [/حضور|مرخصی/, 'attendance', 'حضور و مرخصی'], [/یادآوری/, 'reminders', 'یادآوری'], [/حسابداری|حساب/, 'accounting', 'حسابداری'], [/گزارش/, 'reports', 'گزارش‌ها']];

  function findUser(text) {
    var best = null, len = 0;
    S.users.forEach(function (u) {
      if (u.id === S.me.id) return;
      var full = V.normalize(u.name), first = full.split(' ')[0];
      [full, first].forEach(function (n) {
        if (n && n.length > len && (text === n || text.indexOf(n + ' ') === 0 || text.indexOf(n + ':') === 0)) { best = { user: u, name: n }; len = n.length; }
      });
    });
    return best;
  }

  /** Text → {kind, …, label} */
  function parse(raw) {
    var t = V.normalize(raw), m;
    if (!t) return { kind: 'none' };
    // Attendance
    if (/خروج|رفتم|تموم کردم/.test(t) && !/ورود/.test(t)) return { kind: 'punch', action: 'out', label: 'ثبت خروج' };
    if (/^(ورود|ورودم|حضور|حضورم|اومدم|رسیدم)|ورود(م)? (رو |را )?ثبت|ثبت ورود/.test(t)) return { kind: 'punch', action: 'in', label: 'ثبت ورود' };
    // Message: «پیام به رضا: …», «به رضا بگو …», «پیام برای رضا …»
    m = t.match(/^(?:پیام|پیغام)(?: بده)? (?:به|برای) (.+)$/) || t.match(/^به (.+)$/);
    if (m) {
      var rest = m[1].replace(/\s*:\s*/, ' ').trim(), who = findUser(rest);
      if (who) {
        var body = rest.slice(who.name.length).replace(/^[\s:]+/, '').replace(/^(بگو|بنویس|که)\s+/, '').trim();
        if (/[۰-۹]/.test(raw)) body = J.faDigits(body); // keep the digits as the user wrote them
        if (body) return { kind: 'message', user: who.user, body: body, label: 'پیام به ' + who.user.name };
      }
      if (/^(?:پیام|پیغام)/.test(t)) return { kind: 'error', label: 'گیرنده پیدا نشد؛ مثلاً بگویید «پیام به رضا: فایل رو فرستادم».' };
    }
    // Reminder
    if (/^(یادم (بنداز|بیار)|یادآوری کن|یادآوری)/.test(t)) {
      var r = V.parseReminder(raw, { today: S.today, J: J, now: S.now });
      if (!r.time) r.time = '09:00';
      if (!r.date) r.date = r.time <= (S.now || '').slice(0, 5) ? J.addDays(S.today, 1) : S.today;
      return { kind: 'reminder', data: r, label: 'یادآوری «' + r.title + '» · ' + J.format(r.date) + ' ساعت ' + J.faDigits(r.time) };
    }
    // Money
    if (/(تومن|تومان|ریال|هزار|میلیون)/.test(t) && /(خرج|هزینه|دخل|درآمد|واریز|گرفتم|دادم|پرداخت|خریدم)/.test(t)) {
      var mo = V.parseMoney(raw, { today: S.today, J: J, projects: S.projects, categories: [] });
      if (mo.amount) {
        mo.date = mo.date || S.today; mo.time = mo.time || new Date().toTimeString().slice(0, 5);
        return { kind: 'ledger', data: mo, label: (mo.type === 'income' ? 'دخل ' : 'خرج ') + MP.money(mo.amount) + ' تومان' + (mo.title ? ' بابت «' + mo.title + '»' : '') };
      }
    }
    // Personal task
    if (/^(تسک|کار) /.test(t)) {
      var d = V.findDate(t, { today: S.today, J: J, future: true }), tm = V.findTime(t), title = t.replace(/^(تسک|کار) (جدید |بذار |اضافه کن )?/, '');
      if (d) title = title.replace(d.phrase, ''); if (tm) title = title.replace(tm.phrase, '');
      title = title.replace(/\s+(اضافه کن|بذار|ثبت کن|بزار)$/, '').replace(/\s+/g, ' ').trim();
      if (title) return { kind: 'task', data: { title: title, date: d ? d.iso : S.today, time: tm ? tm.time : '' }, label: 'تسک «' + title + '» · ' + J.format(d ? d.iso : S.today) + (tm ? ' ساعت ' + J.faDigits(tm.time) : '') };
    }
    // Panels
    if (/گزارش روزانه|گزارش امروز/.test(t)) return { kind: 'open', run: function () { MP.dailyReport(); }, label: 'گزارش روزانه' };
    if (/گزارش هفتگی/.test(t) && S.manager) return { kind: 'open', run: function () { MP.weeklyReport(); }, label: 'گزارش هفتگی' };
    if (/فاکتور/.test(t) && S.manager) return { kind: 'open', run: function () { MP.invoices(); }, label: 'فاکتورها' };
    for (var i = 0; i < VIEWS.length; i++) if (VIEWS[i][0].test(t)) return { kind: 'go', view: VIEWS[i][1], label: 'رفتن به ' + VIEWS[i][2] };
    return { kind: 'error', label: 'متوجه نشدم. مثال: «ورودم رو ثبت کن»، «پیام به رضا: فایل رو فرستادم»، «یادم بنداز فردا ساعت ۱۰ تماس با مشتری».' };
  }

  function execute(c) {
    switch (c.kind) {
      case 'punch': return Promise.resolve(MP.punch(c.action));
      case 'go': MP.showView(c.view); return Promise.resolve();
      case 'open': c.run(); return Promise.resolve();
      case 'message':
        return MP.api('channels', { method: 'POST', body: { type: 'direct', user_id: c.user.id } }).then(function (ch) {
          return MP.api('channels/' + ch.id + '/messages', { method: 'POST', body: { body: c.body } }).then(function () { MP.toast('پیام به ' + c.user.name + ' رفت', { icon: 'send', action: 'باز کردن', onAction: function () { MP.showView('messages', { channel: ch.id }); } }); MP.loadChannels && MP.loadChannels(); });
        });
      case 'reminder':
        return MP.api('reminders', { method: 'POST', body: { title: c.data.title, date: c.data.date, time: c.data.time, repeat: c.data.repeat || 'none', note: '' } }).then(function (l) { S.reminders = l; MP.emit('reminders'); MP.toast('یادآوری ثبت شد', { icon: 'alarm' }); });
      case 'ledger':
        return MP.api('ledger', { method: 'POST', body: { type: c.data.type, amount: c.data.amount, title: c.data.title || (c.data.type === 'income' ? 'دخل' : 'خرج'), category: c.data.category || '', project_id: c.data.project_id || 0, date: c.data.date, time: c.data.time, note: '' } }).then(function () { MP.toast('در حسابداری ثبت شد', { icon: 'wallet' }); MP.emit('ledger'); });
      case 'task':
        return MP.api('tasks', { method: 'POST', body: { title: c.data.title, date: c.data.date, time: c.data.time } }).then(function (tk) { MP.upsertTask && MP.upsertTask(tk); MP.emit('tasks'); MP.toast('تسک ثبت شد', { icon: 'checks' }); MP.refreshCounts(); });
    }
    return Promise.resolve();
  }

  MP.assistant = function (startListening) {
    var result = el('div', { class: 'asst-result', 'aria-live': 'polite' });
    var bar = MP.smartBar({
      placeholder: 'بگویید یا بنویسید…',
      examples: ['«ورودم رو ثبت کن»', '«پیام به رضا: فایل رو فرستادم»', '«یادم بنداز فردا ساعت ۱۰ تماس با مشتری»', '«۱۳۰ تومن خرج برای افزونه»', '«تسک فردا ساعت ۱۱ بررسی طرح»', '«برو به تقویم»'],
      parse: parse,
      describe: function (c) { return [[c.label, c.kind === 'error' ? 'warn' : '']]; },
      apply: function (c) {
        result.replaceChildren();
        if (c.kind === 'none') return;
        if (c.kind === 'error') { result.append(el('p', { class: 'hint', text: c.label })); return; }
        if (c.kind === 'punch' || c.kind === 'go' || c.kind === 'open') { MP.dialog.close(); setTimeout(function () { execute(c); }, 120); return; }
        var go = el('button', { type: 'button', class: 'btn btn-primary', html: icon('check') + 'انجام بده', onclick: function () {
          go.disabled = true;
          execute(c).then(function () { MP.dialog.close(); MP.audit(); }).catch(function (err) { go.disabled = false; MP.soft(err); });
        } });
        result.append(el('div', { class: 'asst-card' }, el('strong', { text: c.label }), c.body ? el('p', { text: c.body }) : null, el('div', { class: 'dialog-actions' }, go, el('button', { type: 'button', class: 'btn btn-ghost', text: 'انصراف', onclick: MP.dialog.close }))));
        setTimeout(function () { go.focus(); }, 30);
      }
    });
    MP.dialog.open('دستیار صوتی', el('div', { class: 'form asst' }, bar, result), { focus: false });
    var input = $('.smart-input', bar);
    if (startListening && MP.speechSupported) $('.smart-mic', bar).click(); else if (input) input.focus();
  };

  // Topbar button and shortcut.
  var tools = $('.topbar-tools');
  if (tools) tools.insertBefore(el('button', { type: 'button', class: 'icon-btn asst-btn', 'aria-label': 'دستیار صوتی', title: 'دستیار صوتی (Ctrl+Shift+Space)', html: icon('mic'), onclick: function () { MP.assistant(true); } }), tools.firstChild);
  document.addEventListener('keydown', function (e) { if (e.ctrlKey && e.shiftKey && (e.code === 'Space' || e.key === ' ')) { e.preventDefault(); MP.assistant(true); } });
})();
