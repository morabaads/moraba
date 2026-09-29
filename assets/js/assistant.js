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
      return { kind: 'reminder', data: r, label: 'یادآوری «' + r.title + '»، ' + J.format(r.date) + '، ساعت ' + J.faDigits(r.time) };
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
      if (title) return { kind: 'task', data: { title: title, date: d ? d.iso : S.today, time: tm ? tm.time : '' }, label: 'تسک «' + title + '»، ' + J.format(d ? d.iso : S.today) + (tm ? '، ساعت ' + J.faDigits(tm.time) : '') };
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

  function simpleAssistant(startListening) {
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
  }

  /* ------------------------------------------------------------ AI assistant (server model + tools) */

  var KEY = 'mp_ai_chat', AUTO = 'mp_ai_auto', SPEAK = 'mp_ai_speak';
  function store(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) { return null; } return null; }
  function pref(k, v) { try { if (v === undefined) return localStorage.getItem(k) === '1'; localStorage.setItem(k, v ? '1' : '0'); } catch (e) { return false; } return v; }
  var convo = [];
  try { convo = JSON.parse(store(KEY) || '[]') || []; } catch (e) { convo = []; }

  function refresh(changed) {
    var c = {}; (changed || []).forEach(function (n) { c[n] = 1; });
    if (c.create_task || c.update_task || c.archive_task || c.add_checklist_item || c.comment_task) { MP.loadTasks(); MP.refreshCounts(); }
    if (c.create_reminder && MP.loadReminders) MP.loadReminders();
    if (c.send_message && MP.loadChannels) MP.loadChannels();
    if (c.clock && MP.loadAttendance) MP.loadAttendance();
    if (c.add_ledger || c.create_invoice) MP.emit('ledger');
    if (c.create_project || c.add_project_members || c.create_task) MP.loadProjects();
    if (c.create_meeting && MP.loadMeetings) MP.loadMeetings().then(function () { MP.emit('meetings'); });
    if (Object.keys(c).length) MP.audit();
  }
  function clientActions(list) {
    (list || []).forEach(function (a) {
      var map = { daily_report: function () { MP.dailyReport(a.date); }, invoices: function () { MP.invoices(); }, weekly_report: function () { MP.weeklyReport(); }, portal: function () { if (a.project_id) MP.portal(a.project_id); } };
      if (map[a.page]) { map[a.page](); return; }
      MP.dialog.close();
      if (a.page === 'projects' && a.project_id) S.projectId = a.project_id;
      if (a.page === 'messages' && a.user_id && MP.startDirect) { MP.startDirect(a.user_id); return; }
      setTimeout(function () { MP.showView(a.page, a.date ? { date: a.date } : {}); }, 150);
    });
  }
  function say(text) {
    if (!pref(SPEAK) || !window.speechSynthesis || !text) return;
    var v = speechSynthesis.getVoices().filter(function (x) { return /^fa/i.test(x.lang); })[0];
    if (!v) return;
    var u = new SpeechSynthesisUtterance(text.replace(/[•*#]/g, '')); u.voice = v; u.lang = v.lang;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  }

  function aiAssistant(startListening) {
    var log = el('div', { class: 'ai-log', 'aria-live': 'polite' });
    var busy = false;
    function bubble(role, text) {
      var b = el('div', { class: 'ai-msg ' + role }, el('p', { text: text }));
      log.append(b); log.scrollTop = log.scrollHeight; return b;
    }
    function thinking() { var t = el('div', { class: 'ai-msg assistant thinking' }, el('span'), el('span'), el('span')); log.append(t); log.scrollTop = log.scrollHeight; return t; }
    function drawHistory() {
      log.replaceChildren();
      convo.forEach(function (m) {
        if (m.role === 'user') bubble('user', m.content);
        else if (m.role === 'assistant' && m.content) bubble('assistant', m.content);
      });
      if (!convo.length) log.append(el('div', { class: 'ai-empty' },
        el('strong', { text: 'سلام ' + (S.me.name || '').split(' ')[0] + '! چه کاری برایتان انجام بدهم؟' }),
        el('div', { class: 'ai-ideas' }, ['امروز چه کارهایی دارم؟', 'ورودم رو ثبت کن', 'به رضا بگو فایل نهایی رو فرستادم', 'فردا ساعت ۱۰ با تیم جلسه بذار'].concat(S.manager ? ['وضعیت تیم این هفته چطوره؟', 'برای مهدی تسک بررسی سئو پنجشنبه بذار'] : ['گزارش روزانه امروزم رو بنویس']).map(function (x) {
          return el('button', { type: 'button', class: 'chip-btn', text: x, onclick: function () { send(x); } });
        }))));
    }
    function pendingCard(p, res) {
      var decided = {};
      var card = el('div', { class: 'ai-pending' });
      if (res.reply) card.append(el('p', { class: 'ai-pending-note', text: res.reply }));
      var rows = el('div', { class: 'ai-actions' });
      p.forEach(function (a) {
        var yes = el('input', { type: 'checkbox', checked: true });
        decided[a.id] = yes;
        rows.append(el('label', { class: 'ai-action' }, yes, el('span', { text: a.summary })));
      });
      var go = el('button', { type: 'button', class: 'btn btn-primary', html: icon('check') + (p.length > 1 ? 'انجام موارد انتخاب‌شده' : 'انجام بده') });
      var no = el('button', { type: 'button', class: 'btn btn-ghost', text: 'لغو' });
      function finish(all) {
        var approve = [], reject = [];
        p.forEach(function (a) { (all !== false && decided[a.id].checked ? approve : reject).push(a.id); });
        card.classList.add('decided'); go.disabled = no.disabled = true;
        Array.prototype.forEach.call(card.querySelectorAll('input'), function (i) { i.disabled = true; });
        turn({ approve: approve, reject: reject });
      }
      go.onclick = function () { finish(true); };
      no.onclick = function () { finish(false); };
      card.append(rows, el('div', { class: 'dialog-actions' }, go, no));
      log.append(card); log.scrollTop = log.scrollHeight;
      setTimeout(function () { go.focus(); }, 30);
    }
    var llm = !!(S.boot && S.boot.channels && S.boot.channels.ai);
    function turn(extra, text) {
      busy = true; var t = thinking();
      // Built-in engine: only the new sentence (or the decision) goes up; memory stays on the server.
      var body = llm ? Object.assign({ messages: convo, auto: pref(AUTO) }, extra || {}) : Object.assign({ mode: 'local', text: text || '', auto: pref(AUTO) }, extra || {});
      return MP.api('assistant', { method: 'POST', body: body }).then(function (res) {
        t.remove(); busy = false;
        if (llm) convo = res.messages;
        else if (res.reply) convo.push({ role: 'assistant', content: res.reply });
        store(KEY, JSON.stringify(convo));
        if (res.done && res.done.length) log.append(el('div', { class: 'ai-done' }, res.done.map(function (d) { return el('span', { html: icon('checks') + '' }, d); })));
        refresh(res.changed);
        if (res.pending && res.pending.length) { pendingCard(res.pending, res); clientActions(res.client); return; }
        if (res.reply) { bubble('assistant', res.reply); say(res.reply); }
        if (res.suggestions && res.suggestions.length) log.append(el('div', { class: 'ai-ideas ai-sugg' }, res.suggestions.map(function (x) { return el('button', { type: 'button', class: 'chip-btn', text: x, onclick: function () { send(x); } }); })));
        log.scrollTop = log.scrollHeight;
        clientActions(res.client);
      }).catch(function (err) { t.remove(); busy = false; bubble('assistant error', err.message || 'خطایی رخ داد.'); });
    }
    function send(text) {
      text = String(text || '').trim();
      if (!text || busy) return;
      var e = $('.ai-empty', log); if (e) e.remove();
      Array.prototype.forEach.call(log.querySelectorAll('.ai-pending:not(.decided)'), function (c) { c.remove(); });
      // Changes left undecided count as cancelled, so the conversation stays valid for the model.
      var answered = {}, lastCalls = null;
      for (var i = llm ? convo.length - 1 : -1; i >= 0; i--) { if (convo[i].role === 'tool') { answered[convo[i].tool_call_id] = 1; continue; } if (convo[i].role === 'assistant' && convo[i].tool_calls) lastCalls = convo[i].tool_calls; break; }
      (lastCalls || []).forEach(function (c) { if (!answered[c.id]) convo.push({ role: 'tool', tool_call_id: c.id, content: '{"error":"کاربر این کار را لغو کرد."}' }); });
      convo.push({ role: 'user', content: text }); store(KEY, JSON.stringify(convo));
      bubble('user', text);
      turn(null, text);
    }
    var bar = MP.smartBar({
      placeholder: 'بگویید یا بنویسید… (هر کاری در پنل)',
      examples: ['«امروز چه کارهایی دارم؟»', '«به رضا بگو فایل نهایی رو فرستادم»', '«فردا ساعت ۱۰ با علی و مهدی جلسه بذار»', '«۲ میلیون از زیوا گرفتم برای پروژه زیوا»', '«تسک‌های عقب‌افتاده‌م رو بیار برای فردا»'],
      parse: function (t) { return t; },
      describe: function () { return []; },
      apply: function (t) {
        send(t);
        var i = $('.smart-input', bar); i.value = ''; bar.classList.remove('done');
        var h = $('.smart-hint', bar); if (h) h.hidden = false;
      }
    });
    var auto = el('input', { type: 'checkbox', checked: pref(AUTO) }); auto.onchange = function () { pref(AUTO, auto.checked); };
    var speak = el('input', { type: 'checkbox', checked: pref(SPEAK) }); speak.onchange = function () { pref(SPEAK, speak.checked); if (!speak.checked && window.speechSynthesis) speechSynthesis.cancel(); };
    var foot = el('div', { class: 'ai-foot' },
      el('label', { class: 'check' }, auto, el('span', { text: 'بدون تأیید انجام بده' })),
      window.speechSynthesis ? el('label', { class: 'check' }, speak, el('span', { text: 'خواندن پاسخ' })) : null,
      el('span', { class: 'spacer' }),
      el('button', { type: 'button', class: 'btn btn-ghost btn-sm', html: icon('plus') + 'گفت‌وگوی جدید', onclick: function () { convo = []; store(KEY, null); drawHistory(); } }));
    var body = MP.dialog.open('دستیار مربع', el('div', { class: 'ai' }, log, bar, foot), { focus: false, wide: true, onClose: function () { if (window.speechSynthesis) speechSynthesis.cancel(); } });
    drawHistory();
    setTimeout(function () { log.scrollTop = log.scrollHeight; }, 50);
    // A conversation left waiting for a decision gets its buttons back.
    if (convo.length) {
      var last = convo[convo.length - 1];
      if (last.role === 'assistant' && last.tool_calls && last.tool_calls.length) log.append(el('p', { class: 'hint', text: 'کار قبلی تأیید نشد و لغو حساب می‌شود؛ اگر هنوز لازم است دوباره بگویید.' }));
    }
    var input = $('.smart-input', bar);
    if (startListening && MP.speechSupported) $('.smart-mic', bar).click(); else if (input && !MP.isMobile()) input.focus();
    return body;
  }

  // One assistant for everyone: the built-in Persian engine, or a language model when one is configured.
  MP.assistant = function (startListening) { return aiAssistant(startListening); };
  MP.simpleAssistant = simpleAssistant;

  // Topbar button and shortcut.
  var tools = $('.topbar-tools');
  if (tools) tools.insertBefore(el('button', { type: 'button', class: 'icon-btn asst-btn', 'aria-label': 'دستیار صوتی', title: 'دستیار صوتی (Ctrl+Shift+Space)', html: icon('mic'), onclick: function () { MP.assistant(true); } }), tools.firstChild);
  document.addEventListener('keydown', function (e) { if (e.ctrlKey && e.shiftKey && (e.code === 'Space' || e.key === ' ')) { e.preventDefault(); MP.assistant(true); } });
})();
