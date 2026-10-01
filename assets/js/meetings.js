/* Meetings: video meetings with their own link (/m/{token}), waiting room, password and time limit;
   recurring meetings and always-open team rooms; list / search / filter, create / edit / delete,
   attendance (with Excel export), recordings, minutes (written or drafted by AI from the recording
   and turned into tasks), one-time guest links and SMS invites, calendar file. */
(function () {
  'use strict';
  var MP = window.MP, S = MP.S, J = MP.J, el = MP.el, $ = MP.$, $$ = MP.$$, fa = MP.fa, icon = MP.icon;
  var list = [], tab = 'upcoming', q = '', qTimer = null;
  var STATUS = { scheduled: 'برنامه‌ریزی‌شده', live: 'در حال برگزاری', ended: 'پایان‌یافته' };
  var WAITING = [['guests', 'فقط مهمان‌های بیرون از سازمان', 'همکاران مستقیم وارد می‌شوند؛ مهمان‌ها منتظر تأیید می‌مانند.'], ['all', 'همه شرکت‌کنندگان', 'هر کسی جز میزبان باید تأیید شود.'], ['off', 'بدون اتاق انتظار', 'هر کس لینک (و رمز) را دارد مستقیم وارد می‌شود.']];
  var DURATIONS = [[15, '۱۵ دقیقه'], [30, '۳۰ دقیقه'], [45, '۴۵ دقیقه'], [60, '۱ ساعت'], [90, '۱.۵ ساعت'], [120, '۲ ساعت'], [0, 'بدون محدودیت']];
  var REPEAT = [['none', 'یک‌بار'], ['daily', 'هر روز'], ['weekly', 'هر هفته'], ['biweekly', 'هر دو هفته'], ['monthly', 'هر ماه']];
  var REPEAT_NAME = { daily: 'هر روز', weekly: 'هر هفته', biweekly: 'هر دو هفته', monthly: 'هر ماه' };

  /* ------------------------------------------------------------ helpers */

  function dayLabel(d) {
    if (d === S.today) return 'امروز';
    if (d === J.addDays(S.today, 1)) return 'فردا';
    if (d === J.addDays(S.today, -1)) return 'دیروز';
    return J.weekdays[J.weekday(d)] + ' ' + J.format(d);
  }
  function minutes(sec) { var m = Math.round(sec / 60); return m < 60 ? fa(m) + ' دقیقه' : fa(Math.floor(m / 60)) + ' ساعت' + (m % 60 ? ' و ' + fa(m % 60) + ' دقیقه' : ''); }
  function size(b) { return b > 1048576 ? fa((b / 1048576).toFixed(1)) + ' مگابایت' : fa(Math.max(1, Math.round(b / 1024))) + ' کیلوبایت'; }
  function copy(text, done) {
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () { MP.toast(done || 'کپی شد'); }, function () {
      var i = el('textarea', { style: { position: 'fixed', opacity: '0' } }, text); document.body.append(i); i.select(); document.execCommand('copy'); i.remove(); MP.toast(done || 'کپی شد');
    });
  }
  function inviteText(m) {
    var when = m.permanent ? 'اتاق همیشگی تیم' : J.formatLong(m.date) + ' · ساعت ' + MP.timeFa(m.time) + (m.recurrence !== 'none' && REPEAT_NAME[m.recurrence] ? ' (' + REPEAT_NAME[m.recurrence] + ')' : '');
    return 'دعوت به جلسه آنلاین «' + m.title + '»\n' + when + '\n' + m.link + (m.password ? '\nرمز جلسه: ' + m.password : '');
  }
  MP.joinMeeting = function (m) { window.open(m.url || m.link, '_blank', 'noopener'); };

  /** An .ics file so the meeting lands in Google / Apple / Outlook calendars too (repeating ones repeat there as well). */
  function ics(m) {
    var d = m.date.replace(/-/g, ''), t = m.time.replace(':', '') + '00';
    var start = new Date(m.date + 'T' + m.time + ':00'), end = new Date(start.getTime() + (m.duration || 60) * 60000);
    function fmt(x) { function p(n) { return (n < 10 ? '0' : '') + n; } return x.getFullYear() + p(x.getMonth() + 1) + p(x.getDate()) + 'T' + p(x.getHours()) + p(x.getMinutes()) + '00'; }
    var rule = { daily: 'FREQ=DAILY', weekly: 'FREQ=WEEKLY', biweekly: 'FREQ=WEEKLY;INTERVAL=2', monthly: 'FREQ=MONTHLY' }[m.recurrence];
    var body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Moraba//Panel//FA', 'BEGIN:VEVENT', 'UID:mp-meeting-' + m.id + '@' + location.hostname,
      'DTSTAMP:' + d + 'T' + t, 'DTSTART:' + d + 'T' + t, 'DTEND:' + fmt(end), rule ? 'RRULE:' + rule : null, 'SUMMARY:' + m.title.replace(/[,;]/g, ' '),
      'DESCRIPTION:' + (m.description || '').replace(/\n/g, '\\n').replace(/[,;]/g, ' ') + '\\n' + m.link, 'URL:' + m.link, 'LOCATION:' + m.link,
      'BEGIN:VALARM', 'TRIGGER:-PT10M', 'ACTION:DISPLAY', 'DESCRIPTION:' + m.title, 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].filter(Boolean).join('\r\n');
    var a = el('a', { href: URL.createObjectURL(new Blob([body], { type: 'text/calendar' })), download: 'meeting-' + m.id + '.ics' });
    document.body.append(a); a.click(); a.remove();
  }

  /* ------------------------------------------------------------ list */

  function load() {
    var body = $('#mt-body');
    if (!list.length) body.replaceChildren(MP.skeleton(3));
    return MP.api('meetings', { query: { scope: tab === 'all' ? '' : tab, q: q } }).then(function (l) { list = l; draw(); }).catch(MP.soft);
  }
  function draw() {
    var tabs = $('#mt-tabs'), body = $('#mt-body');
    tabs.replaceChildren.apply(tabs, [['upcoming', 'پیش رو'], ['today', 'امروز'], ['past', 'گذشته'], ['all', 'همه']].map(function (t) {
      return el('button', { type: 'button', role: 'tab', class: 'tab', 'aria-selected': String(tab === t[0]), onclick: function () { tab = t[0]; list = []; load(); } }, t[1]);
    }));
    var rooms = list.filter(function (m) { return m.permanent; }), meetings = list.filter(function (m) { return !m.permanent; });
    var live = meetings.filter(function (m) { return m.status === 'live'; });
    var groups = [], last = null;
    meetings.forEach(function (m) { if (!last || last.date !== m.date) { last = { date: m.date, items: [] }; groups.push(last); } last.items.push(m); });
    body.replaceChildren.apply(body, [
      rooms.length ? el('div', { class: 'mt-rooms' }, rooms.map(roomCard)) : (S.manager && tab === 'upcoming' && !q ? el('button', { type: 'button', class: 'mt-room-new', html: icon('plus') + '<span><b>اتاق همیشگی تیم بسازید</b><small>یک لینک ثابت؛ هر کس هر وقت خواست وارد شود، مثل اتاق جلسه دفتر.</small></span>', onclick: teamRoom }) : null),
      live.length ? el('div', { class: 'mt-live-banner' }, el('span', { class: 'mt-pulse' }), el('div', null, el('b', { text: live.length > 1 ? fa(live.length) + ' جلسه در حال برگزاری است' : '«' + live[0].title + '» در حال برگزاری است' }), el('small', { text: live.length === 1 ? fa(live[0].online) + ' نفر داخل جلسه هستند' : 'برای ورود روی جلسه بزنید' })),
        live.length === 1 ? el('button', { type: 'button', class: 'btn btn-primary btn-sm', html: icon('video') + 'ورود', onclick: function () { MP.joinMeeting(live[0]); } }) : null) : null,
      meetings.length ? el('div', { class: 'mt-list' }, groups.map(function (g) {
        return el('section', { class: 'mt-day' }, el('h3', { class: 'mt-day-head' }, el('span', { text: dayLabel(g.date) }), el('small', { text: fa(g.items.length) + ' جلسه' })), g.items.map(card));
      })) : MP.empty('video', q ? 'جلسه‌ای پیدا نشد' : tab === 'past' ? 'جلسه گذشته‌ای نیست' : 'جلسه‌ای در پیش نیست', q ? null : 'جلسه آنلاین بسازید، همکاران را دعوت کنید و لینک را برای مهمان بفرستید.', q ? null : { text: 'جلسه جدید', onclick: function () { MP.meetingForm(); } })].filter(Boolean));
  }
  function teamRoom() {
    MP.api('meetings/team-room', { method: 'POST', body: { title: 'اتاق جلسه تیم' } }).then(function () { MP.toast('اتاق تیم ساخته شد؛ لینک آن ثابت است'); load(); }).catch(MP.soft);
  }
  function roomCard(m) {
    return el('article', { class: 'card mt-room' + (m.status === 'live' ? ' live' : '') },
      el('span', { class: 'mt-room-ico', html: icon('video') }),
      el('div', { class: 'mt-copy' }, el('strong', { text: m.title }), el('small', { class: 'muted', text: m.online ? fa(m.online) + ' نفر الان داخل اتاق هستند' : 'اتاق خالی است · همیشه باز' })),
      el('button', { type: 'button', class: 'btn btn-primary btn-sm', html: icon('video') + 'ورود', onclick: function () { MP.joinMeeting(m); } }),
      el('button', { type: 'button', class: 'icon-btn sm', title: 'لینک', 'aria-label': 'کپی لینک', html: icon('clip'), onclick: function () { copy(m.link, 'لینک اتاق کپی شد'); } }),
      el('button', { type: 'button', class: 'icon-btn sm', title: 'جزئیات', 'aria-label': 'جزئیات', html: icon('list'), onclick: function () { MP.meetingDetails(m); } }));
  }
  function card(m) {
    var people = m.people.slice(); if (people.indexOf(m.created_by) < 0) people.unshift(m.created_by);
    var stack = el('span', { class: 'stack' });
    people.slice(0, 4).forEach(function (id) { stack.append(MP.avatar(MP.user(id), 'sm')); });
    if (people.length > 4) stack.append(el('span', { class: 'avatar sm more', text: '+' + fa(people.length - 4) }));
    var proj = m.project_id && MP.project(m.project_id);
    return el('article', { class: 'card mt-card ' + m.status },
      el('button', { type: 'button', class: 'mt-main', onclick: function () { MP.meetingDetails(m); } },
        el('div', { class: 'mt-time' }, el('b', { class: 'num', text: MP.timeFa(m.time) }), el('small', { text: m.duration ? minutes(m.duration * 60) : 'آزاد' })),
        el('div', { class: 'mt-copy' },
          el('strong', { text: m.title }),
          el('div', { class: 'mt-chips' },
            el('span', { class: 'chip ' + (m.status === 'live' ? 'danger mt-live' : m.status === 'ended' ? '' : 'brand'), text: STATUS[m.status] + (m.status === 'live' && m.online ? ' · ' + fa(m.online) + ' نفر' : '') }),
            REPEAT_NAME[m.recurrence] ? el('span', { class: 'chip', html: icon('repeat') + ' ' + REPEAT_NAME[m.recurrence] }) : null,
            m.channel ? el('span', { class: 'chip info', html: icon('user') + ' ' }, m.channel) : proj ? el('span', { class: 'chip', html: icon('folder') + ' ' }, proj.name) : null,
            m.has_password ? el('span', { class: 'chip', html: icon('lock') + ' رمزدار' }) : null,
            m.has_minutes ? el('span', { class: 'chip ok', html: icon('checks') + ' صورتجلسه' }) : null)),
        stack),
      el('footer', { class: 'mt-actions' },
        m.status !== 'ended' || m.is_host ? el('button', { type: 'button', class: 'btn btn-sm ' + (m.status === 'live' ? 'btn-primary' : 'btn-secondary'), html: icon('video') + (m.status === 'live' ? 'پیوستن' : m.is_host && m.status !== 'live' ? 'شروع جلسه' : 'ورود'), onclick: function () { MP.joinMeeting(m); } }) : null,
        el('button', { type: 'button', class: 'btn btn-ghost btn-sm', html: icon('clip') + 'کپی دعوت', onclick: function () { copy(inviteText(m), 'متن دعوت کپی شد'); } }),
        el('span', { class: 'spacer' }),
        m.is_host && m.status !== 'ended' ? el('button', { type: 'button', class: 'icon-btn sm', title: 'ویرایش', 'aria-label': 'ویرایش', html: icon('edit'), onclick: function () { MP.meetingForm({ meeting: m }); } }) : null,
        m.can_delete ? el('button', { type: 'button', class: 'icon-btn sm', title: 'حذف', 'aria-label': 'حذف', html: icon('trash'), onclick: function () { remove(m); } }) : null));
  }
  function remove(m) {
    MP.confirm('حذف جلسه', 'جلسه «' + m.title + '» حذف شود؟' + (m.status !== 'ended' && !m.permanent ? ' به شرکت‌کنندگان اطلاع داده می‌شود.' : '') + ' گفت‌وگو و تاریخچه حضور هم پاک می‌شود.', 'حذف', true).then(function (ok) {
      if (!ok) return;
      MP.api('meetings/' + m.id, { method: 'DELETE' }).then(function () { MP.dialog.close(); MP.toast('جلسه حذف شد'); changed(); }).catch(MP.soft);
    });
  }
  function changed() { MP.emit('meetings'); if (MP.visible('meetings')) load(); }

  /* ------------------------------------------------------------ details */

  MP.meetingDetails = function (m0) {
    MP.dialog.open(m0.title, MP.skeleton(2), { wide: true });
    MP.api('meetings/' + m0.id).then(function (m) { details(m); }).catch(function (e) { MP.dialog.close(); MP.soft(e); });
  };
  function details(m) {
    var people = m.people.map(function (id) { return MP.user(id).name; });
    var att = m.attendance || [];
    var linkBox = el('div', { class: 'mt-link' }, el('input', { value: m.link, readonly: true, dir: 'ltr', onfocus: function (e) { e.target.select(); } }),
      el('button', { type: 'button', class: 'btn btn-secondary btn-sm', html: icon('clip') + 'کپی لینک', onclick: function () { copy(m.link, 'لینک کپی شد'); } }));
    var table = att.length ? el('div', { class: 'mt-att' }, att.map(function (a) {
      return el('div', { class: 'mt-att-row' + (a.absent ? ' absent' : '') },
        a.user_id ? MP.avatar(MP.user(a.user_id), 'sm') : el('span', { class: 'avatar sm guest', text: (a.name || '؟').slice(0, 1) }),
        el('div', { class: 'mt-att-name' }, el('b', { text: a.name }), el('small', { text: { host: 'میزبان', cohost: 'میزبان کمکی', guest: 'مهمان' }[a.role] || 'همکار' })),
        a.absent ? el('span', { class: 'chip danger', text: 'غایب' }) : el('div', { class: 'mt-att-time' },
          el('span', { text: 'ورود ' + MP.timeFa(a.first.slice(11, 16)) + (a.times > 1 ? ' · ' + fa(a.times) + ' بار' : '') + (a.dates && a.dates.length > 1 ? ' · ' + fa(a.dates.length) + ' جلسه' : '') }),
          el('b', { text: a.online ? 'الان داخل جلسه' : minutes(a.seconds) })));
    })) : el('p', { class: 'muted', text: m.status === 'scheduled' ? 'جلسه هنوز شروع نشده است.' : 'کسی وارد جلسه نشد.' });
    var recs = (m.recordings || []).filter(function (r) { return r.size > 0; });
    var minutesBox = m.minutes ? el('div', { class: 'mt-minutes' },
      m.minutes.summary ? el('p', { text: m.minutes.summary }) : null,
      m.minutes.decisions && m.minutes.decisions.length ? el('div', null, el('b', { text: 'تصمیم‌ها' }), el('ul', null, m.minutes.decisions.map(function (d) { return el('li', { text: d }); }))) : null,
      m.minutes.actions && m.minutes.actions.length ? el('div', null, el('b', { text: 'اقدامات' }), el('ul', null, m.minutes.actions.map(function (a) {
        return el('li', null, a.text + (a.user_id ? ' — ' + MP.user(a.user_id).name : '') + (a.due ? ' · ' + J.format(a.due) : ''), a.task_id ? el('span', { class: 'chip ok', text: 'تسک شد' }) : null);
      }))) : null) : null;
    var when = m.permanent ? 'اتاق همیشگی تیم' : J.formatLong(m.date) + ' · ساعت ' + MP.timeFa(m.time) + (m.duration ? ' · ' + minutes(m.duration * 60) : '') + (REPEAT_NAME[m.recurrence] ? ' · ' + REPEAT_NAME[m.recurrence] : '');
    MP.dialog.open(m.title, el('div', { class: 'mt-detail' },
      el('div', { class: 'mt-detail-head' },
        el('span', { class: 'chip ' + (m.status === 'live' ? 'danger mt-live' : m.status === 'ended' ? '' : 'brand'), text: m.permanent ? (m.status === 'live' ? 'فعال' : 'همیشه باز') : STATUS[m.status] }),
        el('span', { class: 'muted', text: when })),
      m.description ? el('p', { class: 'mt-desc', text: m.description }) : null,
      MP.detailRow('برگزارکننده', MP.user(m.created_by).name),
      people.length ? MP.detailRow('دعوت‌شدگان', people.join('، ')) : null,
      m.channel ? MP.detailRow('گروه مشتری', m.channel + ' (در پرتال دیده می‌شود)') : null,
      m.project_id && MP.project(m.project_id) ? MP.detailRow('پروژه', MP.project(m.project_id).name) : null,
      MP.detailRow('اتاق انتظار', WAITING.filter(function (w) { return w[0] === m.waiting; })[0][1]),
      m.is_host && m.password ? MP.detailRow('رمز جلسه', m.password) : null,
      m.started_at ? MP.detailRow('آخرین برگزاری', J.format(m.started_at.slice(0, 10)) + ' · شروع ' + MP.timeFa(m.started_at.slice(11, 16)) + (m.ended_at && m.ended_at > m.started_at ? ' · پایان ' + MP.timeFa(m.ended_at.slice(11, 16)) : '')) : null,
      el('h4', { class: 'mt-sub', text: 'لینک اختصاصی جلسه' }), linkBox,
      m.is_host ? inviteBox(m) : null,
      el('h4', { class: 'mt-sub' }, 'حضور شرکت‌کنندگان', att.length ? el('a', { class: 'link mt-sub-act', href: m.export, html: icon('download') + 'خروجی اکسل' }) : null), table,
      recs.length ? el('h4', { class: 'mt-sub', text: 'ضبط جلسه' }) : null,
      recs.length ? el('div', { class: 'mt-recs' }, recs.map(function (r) {
        return el('div', { class: 'mt-rec' },
          r.kind === 'video' ? el('video', { src: r.url, controls: true, preload: 'metadata', playsinline: true }) : el('audio', { src: r.url, controls: true, preload: 'none' }),
          el('div', { class: 'mt-rec-meta' }, el('small', { text: (r.kind === 'video' ? 'ویدیو' : 'صدا') + ' · ' + J.format(r.at.slice(0, 10)) + ' ' + MP.timeFa(r.at.slice(11, 16)) + ' · ' + size(r.size) }), el('a', { class: 'link', href: r.download, text: 'دانلود' })));
      })) : null,
      el('h4', { class: 'mt-sub' }, 'صورتجلسه', el('button', { type: 'button', class: 'link mt-sub-act', html: icon('edit') + (m.minutes ? 'ویرایش' : 'نوشتن صورتجلسه'), onclick: function () { minutesForm(m); } })),
      minutesBox || el('p', { class: 'muted', text: recs.some(function (r) { return r.kind === 'audio'; }) ? 'صدای جلسه ضبط شده است؛ می‌توانید صورتجلسه را خودکار بسازید.' : 'هنوز صورتجلسه‌ای ثبت نشده است.' }),
      m.chat && m.chat.length ? el('details', { class: 'mt-chatlog' }, el('summary', { text: 'گفت‌وگوی داخل جلسه (' + fa(m.chat.length) + ' پیام)' }), m.chat.map(function (c) {
        return el('div', { class: 'mt-chatline' + (c.kind === 'system' ? ' sys' : '') }, c.kind === 'system' ? null : el('b', { text: c.name + ': ' }), c.body || '', c.file ? el('a', { href: c.file.url, target: '_blank', rel: 'noopener', text: ' 📎 ' + c.file.name }) : null, el('small', { text: ' ' + MP.timeFa(c.at.slice(11, 16)) }));
      })) : null,
      el('div', { class: 'dialog-actions', style: { marginTop: '16px' } },
        m.status !== 'ended' || m.is_host ? el('button', { type: 'button', class: 'btn btn-primary', html: icon('video') + (m.status === 'live' ? 'پیوستن' : m.is_host && !m.permanent ? 'شروع جلسه' : 'ورود به جلسه'), onclick: function () { MP.joinMeeting(m); } }) : null,
        el('button', { type: 'button', class: 'btn btn-secondary', html: icon('send') + 'کپی متن دعوت', onclick: function () { copy(inviteText(m), 'متن دعوت کپی شد'); } }),
        m.permanent ? null : el('button', { type: 'button', class: 'btn btn-secondary', html: icon('calendar') + 'افزودن به تقویم', onclick: function () { ics(m); } }),
        el('span', { class: 'spacer' }),
        m.is_host && m.status === 'live' ? el('button', { type: 'button', class: 'btn btn-danger', text: 'پایان جلسه', onclick: function () {
          MP.confirm('پایان جلسه', 'جلسه برای همه شرکت‌کنندگان تمام شود؟', 'پایان جلسه', true).then(function (ok) { if (ok) MP.api('meetings/' + m.id + '/end', { method: 'POST' }).then(function () { MP.toast('جلسه پایان یافت'); changed(); MP.meetingDetails(m); }).catch(MP.soft); });
        } }) : null,
        m.is_host && m.status !== 'ended' && !m.permanent ? el('button', { type: 'button', class: 'btn btn-secondary', html: icon('edit') + 'ویرایش', onclick: function () { MP.meetingForm({ meeting: m }); } }) : null,
        m.can_delete ? el('button', { type: 'button', class: 'btn btn-ghost', html: icon('trash') + 'حذف', onclick: function () { remove(m); } }) : null)), { wide: true });
  }

  /** One-time guest links (no password, no waiting room), optionally sent by SMS. */
  function inviteBox(m) {
    var name = el('input', { class: 'input', maxlength: 80, placeholder: 'نام مهمان' });
    var phone = el('input', { class: 'input', maxlength: 20, placeholder: 'موبایل (اختیاری)', dir: 'ltr', inputmode: 'tel' });
    var listBox = el('div', { class: 'mt-invites' }, (m.invites || []).map(inviteRow));
    function inviteRow(i) {
      return el('div', { class: 'mt-inv' + (i.used ? ' used' : '') }, el('b', { text: i.name || 'مهمان' }), i.phone ? el('small', { class: 'num', text: fa(i.phone) }) : null,
        el('span', { class: 'chip ' + (i.used ? '' : 'brand'), text: i.used ? 'استفاده شد' : 'آماده' }),
        i.used ? null : el('button', { type: 'button', class: 'link', text: 'کپی لینک', onclick: function () { copy(i.link, 'لینک یک‌بارمصرف کپی شد'); } }));
    }
    var send = el('button', { type: 'button', class: 'btn btn-secondary btn-sm', html: icon('send') + 'ساخت لینک دعوت', onclick: function () {
      send.disabled = true;
      MP.api('meetings/' + m.id + '/invite', { method: 'POST', body: { name: name.value.trim(), phone: phone.value.trim() } }).then(function (r) {
        send.disabled = false;
        listBox.prepend(inviteRow({ name: name.value.trim(), phone: r.phone, used: false, link: r.link }));
        if (r.phone) MP.toast(r.sms ? 'لینک دعوت با پیامک فرستاده شد' : 'پیامک فرستاده نشد؛ لینک را کپی کنید', r.sms ? null : { error: true });
        else copy(r.link, 'لینک یک‌بارمصرف ساخته و کپی شد');
        name.value = ''; phone.value = '';
      }).catch(function (e) { send.disabled = false; MP.soft(e); });
    } });
    return el('div', { class: 'mt-invite-box' },
      el('h4', { class: 'mt-sub', text: 'دعوت مهمان با لینک یک‌بارمصرف' }),
      el('p', { class: 'hint', text: 'مهمان با این لینک بدون رمز و بدون اتاق انتظار وارد می‌شود و لینک فقط برای یک نفر کار می‌کند. با وارد کردن موبایل، لینک پیامک و ۱۰ دقیقه قبل از جلسه یادآوری می‌شود.' }),
      el('div', { class: 'mt-inv-form' }, name, phone, send), listBox);
  }

  /* ------------------------------------------------------------ minutes */

  function minutesForm(m) {
    var x = m.minutes || { summary: '', decisions: [], actions: [] };
    var summary = el('textarea', { rows: 4, maxlength: 8000, placeholder: 'خلاصه آنچه در جلسه گذشت…' }, x.summary || '');
    var decisions = el('textarea', { rows: 3, placeholder: 'هر تصمیم در یک خط' }, (x.decisions || []).join('\n'));
    var rows = el('div', { class: 'mt-actions-list' });
    var transcript = x.transcript || '';
    function actionRow(a) {
      a = a || { text: '', user_id: 0, due: '', task_id: 0 };
      var text = el('input', { class: 'input', maxlength: 200, value: a.text, placeholder: 'کار' });
      var who = MP.select('who', [[0, 'مسئول…']].concat(S.users.map(function (u) { return [u.id, u.name]; })), a.user_id);
      var due = MP.dateField('due', a.due || S.today, 'موعد');
      var row = el('div', { class: 'mt-action-row' + (a.task_id ? ' done' : '') }, text, who, due,
        a.task_id ? el('span', { class: 'chip ok', text: 'تسک شد' }) : el('button', { type: 'button', class: 'icon-btn sm', html: icon('trash'), 'aria-label': 'حذف', onclick: function () { row.remove(); } }));
      row.get = function () { return { text: text.value.trim(), user_id: +who.value, due: $('input[type=hidden]', due).value, task_id: a.task_id || 0 }; };
      rows.append(row);
    }
    (x.actions && x.actions.length ? x.actions : [null]).forEach(actionRow);
    var hasAudio = (m.recordings || []).some(function (r) { return r.kind === 'audio' && r.size > 0; });
    var auto = el('button', { type: 'button', class: 'btn btn-secondary btn-sm', html: icon('mic') + 'پیش‌نویس خودکار از صدای جلسه', disabled: !hasAudio, title: hasAudio ? '' : 'صدای این جلسه ضبط نشده است', onclick: function () {
      auto.disabled = true; auto.textContent = 'در حال تبدیل صدا و خلاصه‌سازی… (چند دقیقه)';
      MP.api('meetings/' + m.id + '/auto-minutes', { method: 'POST' }).then(function (d) {
        summary.value = d.summary || ''; decisions.value = (d.decisions || []).join('\n'); transcript = d.transcript || '';
        rows.replaceChildren(); (d.actions && d.actions.length ? d.actions : [null]).forEach(actionRow);
        MP.toast('پیش‌نویس آماده شد؛ بررسی و ذخیره کنید');
        auto.disabled = false; auto.innerHTML = icon('mic') + 'ساخت دوباره';
      }).catch(function (e) { auto.disabled = false; auto.innerHTML = icon('mic') + 'پیش‌نویس خودکار از صدای جلسه'; MP.soft(e); });
    } });
    function collect() {
      return { summary: summary.value.trim(), decisions: decisions.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean), actions: $$('.mt-action-row', rows).map(function (r) { return r.get(); }).filter(function (a) { return a.text; }), transcript: transcript };
    }
    function save(makeTasks) {
      var data = collect(), jobs = [];
      if (makeTasks) {
        data.actions.forEach(function (a) {
          if (a.task_id || !a.user_id) return;
          jobs.push(MP.api('tasks', { method: 'POST', body: { title: a.text, user_id: a.user_id, date: a.due || S.today, project_id: m.project_id || 0, description: 'از صورتجلسه «' + m.title + '»' } })
            .then(function (t) { a.task_id = (Array.isArray(t) ? t[0] : t).id; }));
        });
      }
      MP.busy(form, true);
      return Promise.all(jobs).then(function () { return MP.api('meetings/' + m.id + '/minutes', { method: 'POST', body: data }); })
        .then(function () { MP.toast(jobs.length ? fa(jobs.length) + ' تسک ساخته شد و صورتجلسه ذخیره شد' : 'صورتجلسه ذخیره شد'); if (jobs.length) MP.loadTasks && MP.loadTasks(); changed(); MP.meetingDetails(m); })
        .catch(function (e) { MP.busy(form, false); MP.soft(e); });
    }
    var form = el('form', { class: 'form mt-minutes-form' },
      el('div', { class: 'mt-auto' }, auto, el('small', { class: 'hint', text: 'صدای ضبط‌شده جلسه به متن تبدیل و با هوش مصنوعی پنل خلاصه می‌شود؛ تصمیم‌ها و کارها با مسئول و موعد پیشنهاد می‌شوند.' })),
      MP.field('خلاصه جلسه', summary),
      MP.field('تصمیم‌ها', decisions),
      el('div', { class: 'field' }, el('span', { text: 'اقدامات (کارها)' }), rows, el('button', { type: 'button', class: 'btn btn-ghost btn-sm mt-add', html: icon('plus') + 'افزودن کار', onclick: function () { actionRow(); } })),
      transcript ? el('details', null, el('summary', { text: 'متن کامل جلسه' }), el('p', { class: 'mt-transcript', text: transcript })) : null,
      el('div', { class: 'dialog-actions' },
        el('button', { type: 'submit', class: 'btn btn-primary', html: icon('tasks') + 'ذخیره و ساخت تسک اقدامات' }),
        el('button', { type: 'button', class: 'btn btn-secondary', text: 'فقط ذخیره', onclick: function () { save(false); } }),
        el('button', { type: 'button', class: 'btn btn-ghost', text: 'انصراف', onclick: function () { MP.meetingDetails(m); } })));
    form.onsubmit = function (e) { e.preventDefault(); save(true); };
    MP.dialog.open('صورتجلسه «' + m.title + '»', form, { wide: true });
  }

  /* ------------------------------------------------------------ form */

  MP.meetingForm = function (preset) {
    preset = preset || {};
    var m = preset.meeting || null;
    var settings = S.meetSettings || { duration: 60, waiting: 'guests' };
    var duration = m ? m.duration : settings.duration;
    var durInput = el('input', { type: 'hidden', name: 'duration', value: duration });
    var durChips = el('div', { class: 'tf-chips' }, DURATIONS.map(function (d) {
      return el('button', { type: 'button', class: 'tf-chip' + (d[0] === +duration ? ' on' : ''), text: d[1], onclick: function (e) { durInput.value = d[0]; Array.prototype.forEach.call(durChips.children, function (c) { c.classList.remove('on'); }); e.currentTarget.classList.add('on'); } });
    }));
    var rep = m ? m.recurrence : 'none';
    var repInput = el('input', { type: 'hidden', name: 'recurrence', value: rep });
    var repChips = el('div', { class: 'tf-chips' }, REPEAT.map(function (d) {
      return el('button', { type: 'button', class: 'tf-chip' + (d[0] === rep ? ' on' : ''), text: d[1], onclick: function (e) { repInput.value = d[0]; Array.prototype.forEach.call(repChips.children, function (c) { c.classList.remove('on'); }); e.currentTarget.classList.add('on'); } });
    }));
    var pass = el('input', { name: 'password', maxlength: 64, dir: 'ltr', value: m ? m.password : '', placeholder: 'بدون رمز', autocomplete: 'off' });
    var waitSel = el('div', { class: 'mt-wait-opts' }, WAITING.map(function (w) {
      return el('label', { class: 'mt-wait-opt' }, el('input', { type: 'radio', name: 'waiting', value: w[0], checked: (m ? m.waiting : settings.waiting) === w[0] }), el('span', null, el('b', { text: w[1] }), el('small', { text: w[2] })));
    }));
    var clients = (S.channels || []).filter(function (c) { return c.type === 'client' && !c.archived; });
    var chSel = MP.select('channel_id', [[0, 'بدون گروه مشتری']].concat(clients.map(function (c) { return [c.id, (c.client_name || c.title) + (c.project_id && MP.project(c.project_id) ? ' · ' + MP.project(c.project_id).name : '')]; })), m ? m.channel_id : preset.channelId || 0);
    var form = el('form', { class: 'form tf' },
      el('label', { class: 'tf-titlebox' }, el('span', { class: 'tf-label', html: icon('video') + 'عنوان جلسه' + '<em>ضروری</em>' }),
        el('input', { name: 'title', class: 'tf-title', required: true, maxlength: 160, placeholder: 'مثلاً بررسی طراحی داشبورد', value: m ? m.title : preset.title || '', autocomplete: 'off' })),
      el('section', { class: 'tf-sec' }, el('span', { class: 'tf-label', html: icon('calendar') + 'زمان' }),
        el('div', { class: 'row' }, MP.dateField('date', m ? m.date : preset.date || S.today, 'تاریخ'), MP.field('ساعت', el('input', { name: 'time', type: 'time', value: m ? m.time : preset.time || '' }), 'خالی بماند = همین الان')),
        el('span', { class: 'tf-note', text: 'مدت جلسه (پس از آن، جلسه خودکار پایان می‌یابد)' }), durChips, durInput,
        el('span', { class: 'tf-note', text: 'تکرار (با همان لینک ثابت)' }), repChips, repInput),
      el('section', { class: 'tf-sec' }, el('span', { class: 'tf-label', html: icon('user') + 'دعوت همکاران' }),
        MP.peoplePicker('people', m ? m.people : preset.people || [], [S.me.id]),
        el('span', { class: 'tf-note', html: icon('send') + ' به دعوت‌شدگان اعلان داده می‌شود و ۱۰ دقیقه قبل یادآوری می‌شود؛ برای مهمان بیرونی، پس از ساخت جلسه لینک یک‌بارمصرف یا پیامک بفرستید.' })),
      clients.length ? el('section', { class: 'tf-sec' }, el('span', { class: 'tf-label', html: icon('user') + 'جلسه با مشتری' }),
        MP.field('گروه مشتری', chSel), el('span', { class: 'tf-note', text: 'جلسه در گروه و پرتال این مشتری دیده می‌شود و مشتری از پرتال بدون رمز و انتظار وارد می‌شود.' })) : null,
      el('section', { class: 'tf-sec' }, el('span', { class: 'tf-label', html: icon('lock') + 'امنیت و ورود' }),
        MP.field('رمز جلسه (فقط برای مهمان‌های بیرونی)', el('div', { class: 'mt-pass' }, pass, el('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'رمز تصادفی', onclick: function () { pass.value = String(Math.floor(100000 + Math.random() * 900000)); } }))),
        el('span', { class: 'tf-note', text: 'اتاق انتظار: چه کسانی برای ورود باید تأیید میزبان را بگیرند؟' }), waitSel),
      el('details', { class: 'tf-more' }, el('summary', { text: 'تنظیمات بیشتر' }),
        MP.field('توضیحات / دستور جلسه', el('textarea', { name: 'description', rows: 3, maxlength: 2000, placeholder: 'موضوعاتی که بررسی می‌شود…' }, m ? m.description : '')),
        el('div', { class: 'row' },
          MP.field('پروژه', MP.projectSelect('project_id', m ? m.project_id : preset.projectId || 0)),
          MP.field('لینک بیرونی (اختیاری)', el('input', { name: 'url', type: 'url', placeholder: 'اگر جلسه در سرویس دیگری است', dir: 'ltr', value: m ? m.url : '' })))),
      MP.actions(m ? 'ذخیره تغییرات' : 'ساخت جلسه و دعوت'));
    if (m && m.url || m && m.description) $('.tf-more', form).open = true;
    form.onsubmit = function (e) {
      e.preventDefault();
      var f = form.elements, url = f.url.value.trim();
      if (!f.title.value.trim()) { f.title.focus(); MP.toast('عنوان جلسه را بنویسید', { error: true }); return; }
      if (url) { try { if (['http:', 'https:'].indexOf(new URL(url).protocol) < 0) throw new Error(); } catch (err) { f.url.setCustomValidity('لینک باید با https یا http شروع شود'); f.url.reportValidity(); return; } }
      MP.busy(form, true);
      MP.api(m ? 'meetings/' + m.id : 'meetings', { method: 'POST', body: {
        title: f.title.value.trim(), date: f.date.value, time: f.time.value, url: url, project_id: +f.project_id.value, channel_id: f.channel_id ? +f.channel_id.value : 0,
        people: MP.checked(form, 'people'), duration: +durInput.value, recurrence: repInput.value, password: pass.value.trim(), waiting: (form.querySelector('input[name="waiting"]:checked') || {}).value || 'guests',
        description: f.description.value.trim() } })
        .then(function (saved) {
          MP.toast(m ? 'جلسه ذخیره شد' : 'جلسه ساخته شد و به دعوت‌شدگان اطلاع داده شد');
          changed();
          MP.meetingDetails(saved);
        })
        .catch(function (err) { MP.busy(form, false); MP.soft(err); });
    };
    form.elements.url.oninput = function () { form.elements.url.setCustomValidity(''); };
    MP.dialog.open(m ? 'ویرایش جلسه' : 'جلسه جدید', form, { wide: true });
    if (!m) setTimeout(function () { form.elements.title.focus(); }, 60);
  };

  /* ------------------------------------------------------------ settings (supervisors) */

  /** Gathers ICE candidates with the servers in the form: shows whether STUN and TURN answer from this network. */
  function testIce(form, btn) {
    var f = form.elements, out = $('.mt-test-out', form), servers = [];
    f.stun.value.split(/[\s,]+/).filter(Boolean).forEach(function (u) { servers.push({ urls: u }); });
    if (f.turn_url.value.trim()) servers.push({ urls: f.turn_url.value.trim().split(/[\s,]+/), username: f.turn_user.value, credential: f.turn_pass.value });
    if (!window.RTCPeerConnection) { out.textContent = 'این مرورگر WebRTC ندارد.'; return; }
    var pc, found = { host: 0, srflx: 0, relay: 0 }, done = false;
    try { pc = new RTCPeerConnection({ iceServers: servers }); } catch (err) { out.textContent = 'آدرس سرورها معتبر نیست: ' + err.message; return; }
    btn.disabled = true; out.textContent = 'در حال تست (حداکثر ۸ ثانیه)…';
    function finish() {
      if (done) return; done = true; btn.disabled = false; pc.close();
      out.replaceChildren(
        el('div', { class: found.srflx ? 'ok' : 'bad', text: (found.srflx ? '✓ ' : '✗ ') + 'STUN: ' + (found.srflx ? 'پاسخ داد' : 'پاسخی نیامد (احتمالاً فیلتر است)') }),
        f.turn_url.value.trim() ? el('div', { class: found.relay ? 'ok' : 'bad', text: (found.relay ? '✓ ' : '✗ ') + 'TURN: ' + (found.relay ? 'کار می‌کند' : 'پاسخی نیامد؛ آدرس، نام کاربری و رمز را بررسی کنید') })
          : el('div', { class: 'bad', text: '✗ TURN تنظیم نشده؛ بدون آن، بیشتر اتصال‌ها روی اینترنت همراه برقرار نمی‌شود.' }),
        el('small', { text: 'این تست از شبکه همین دستگاه است؛ نتیجه برای شبکه‌های دیگر ممکن است فرق کند.' }));
    }
    pc.onicecandidate = function (e) {
      if (!e.candidate) return finish();
      var mm = / typ (\w+)/.exec(e.candidate.candidate); if (mm && found[mm[1]] !== undefined) found[mm[1]]++;
    };
    pc.createDataChannel('t');
    pc.createOffer().then(function (d) { return pc.setLocalDescription(d); }).catch(finish);
    setTimeout(finish, 8000);
  }

  function settingsDialog() {
    MP.api('meetings/settings').then(function (s) {
      var p2p = el('div', { class: 'mt-p2p' },
        el('p', { class: 'hint', text: 'تنظیمات زیر فقط برای روش «مستقیم بین مرورگرها» است.' }),
        MP.field('سرورهای STUN', el('input', { name: 'stun', dir: 'ltr', value: s.stun, placeholder: 'stun:stun.l.google.com:19302' }), 'چند آدرس را با فاصله یا ویرگول جدا کنید.'),
        MP.field('سرور TURN (اختیاری)', el('input', { name: 'turn_url', dir: 'ltr', value: s.turn_url || '', placeholder: 'turn:turn.example.com:3478' })),
        el('div', { class: 'row' }, MP.field('نام کاربری TURN', el('input', { name: 'turn_user', dir: 'ltr', value: s.turn_user || '' })), MP.field('رمز TURN', el('input', { name: 'turn_pass', dir: 'ltr', type: 'password', value: s.turn_pass || '' }))),
        el('div', { class: 'mt-test' }, el('button', { type: 'button', class: 'btn btn-secondary btn-sm', html: icon('repeat') + 'تست اتصال', onclick: function (e) { testIce(form, e.currentTarget); } }), el('div', { class: 'mt-test-out' })));
      var mode = MP.select('mode', [['relay', 'از طریق همین سایت (بدون هیچ سرور بیرونی) — پیشنهادی'], ['p2p', 'مستقیم بین مرورگرها (WebRTC، نیاز به STUN/TURN)']], s.mode || 'relay');
      var form = el('form', { class: 'form' },
        MP.field('روش انتقال صدا و تصویر', mode,
          'روش «همین سایت» روی هر اینترنتی کار می‌کند؛ مرورگرهای جدید صدا را با Opus و تصویر را با H.264/VP8 می‌فرستند و مرورگرهای قدیمی با روش ساده‌تر. تأخیر حدود نیم ثانیه است و برای جلسه‌های تا حدود ۸ نفر مناسب است.'),
        MP.field('کیفیت تصویر', MP.select('video', [['low', 'کم — اینترنت یا هاست ضعیف'], ['normal', 'معمولی'], ['high', 'خوب — مصرف بیشتر']], s.video || 'normal')),
        el('div', { class: 'row' },
          MP.field('مدت پیش‌فرض جلسه', MP.select('duration', DURATIONS.map(function (d) { return [d[0], d[1]]; }), +s.duration)),
          MP.field('اتاق انتظار پیش‌فرض', MP.select('waiting', WAITING.map(function (w) { return [w[0], w[1]]; }), s.waiting))),
        el('label', { class: 'check-row' }, el('input', { type: 'checkbox', name: 'remind', checked: s.remind !== false }), el('span', { text: 'یادآوری ۱۰ دقیقه قبل از جلسه (اعلان پنل، تلگرام/بله' + (s.sms ? '، پیامک' : '') + ' و پیامک به مهمان‌های دعوت‌شده)' })),
        el('p', { class: 'hint', text: 'صورتجلسه خودکار: ' + (s.speech && s.ai ? 'فعال است.' : 'برای فعال شدن، در تنظیمات پنل «سرویس تبدیل گفتار» و «هوش مصنوعی» را تنظیم کنید.') }),
        p2p,
        MP.actions('ذخیره'));
      function toggle() { p2p.hidden = mode.value !== 'p2p'; }
      mode.onchange = toggle; toggle();
      form.onsubmit = function (e) {
        e.preventDefault();
        var f = form.elements;
        MP.busy(form, true);
        MP.api('meetings/settings', { method: 'POST', body: { mode: f.mode.value, video: f.video.value, stun: f.stun.value, turn_url: f.turn_url.value, turn_user: f.turn_user.value, turn_pass: f.turn_pass.value, duration: +f.duration.value, waiting: f.waiting.value, remind: f.remind.checked } })
          .then(function (n) { S.meetSettings = n; MP.dialog.close(); MP.toast('تنظیمات جلسه ذخیره شد'); })
          .catch(function (err) { MP.busy(form, false); MP.soft(err); });
      };
      MP.dialog.open('تنظیمات جلسات آنلاین', form, { wide: true });
    }).catch(MP.soft);
  }

  /* ------------------------------------------------------------ view */

  $('#mt-new').onclick = function () { MP.meetingForm(); };
  $('#mt-settings').onclick = settingsDialog;
  $('#mt-q').oninput = function (e) { clearTimeout(qTimer); qTimer = setTimeout(function () { q = e.target.value.trim(); load(); }, 250); };
  MP.view('meetings', { open: function (o) {
    if (!S.meetSettings) MP.api('meetings/settings').then(function (s) { S.meetSettings = s; }).catch(function () {});
    load().then(function () { if (o && o.open) MP.meetingDetails({ id: +o.open, title: 'جلسه' }); });
  } });
  setInterval(function () { if (MP.visible('meetings') && !document.hidden && !MP.dialog.isOpen()) load(); }, 30000);
})();
