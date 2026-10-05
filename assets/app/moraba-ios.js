// مربع — ویجت آیفون برای اپ Scriptable
// این اسکریپت را پنل مربع ساخته و کد اتصال شما داخلش است؛ آن را برای کسی نفرستید.
// پارامتر ویجت (اختیاری): tasks، tasks:week، tasks:overdue، attendance، messages، meeting
const API = '__API__';
const TOKEN = '__TOKEN__';

const C = {
  bg: new Color('#17191a'), card: new Color('#1e2022'), line: new Color('#2a2d2f'),
  ink: new Color('#f2f2f0'), muted: new Color('#9a9a95'), faint: new Color('#6f6f6b'),
  brand: new Color('#f28a24'), ok: new Color('#3fb96f'), okSoft: new Color('#15291e'),
  danger: new Color('#e5534b'), lock: new Color('#a792ff'), lockSoft: new Color('#241e3b')
};
const TABS = { today: 'امروز', week: 'هفته', overdue: 'عقب‌افتاده' };

async function call(method, body) {
  const r = new Request(API);
  r.method = method;
  r.headers = { 'X-MP-Widget-Token': TOKEN, 'Accept': 'application/json' };
  if (body) { r.headers['Content-Type'] = 'application/x-www-form-urlencoded'; r.body = body; }
  r.timeoutInterval = 20;
  const d = await r.loadJSON();
  if (!d || !d.ok) throw new Error((d && d.message) || 'اتصال به پنل انجام نشد');
  return d;
}
function run(q) { return 'scriptable:///run/' + encodeURIComponent(Script.name()) + '?' + q; }
function txt(stack, s, size, color, weight) {
  const t = stack.addText(String(s));
  t.font = weight === 'bold' ? Font.boldSystemFont(size) : Font.systemFont(size);
  t.textColor = color || C.ink;
  t.lineLimit = 1;
  return t;
}
/** A right-to-left row: items are added from the right edge. */
function row(parent) { const s = parent.addStack(); s.layoutHorizontally(); s.centerAlignContent(); s.addSpacer(); return s; }

function attendance(parent, d, big) {
  const a = d.attendance, s = row(parent);
  s.url = run('action=punch');
  s.backgroundColor = a.open ? C.okSoft : C.card;
  s.cornerRadius = 999; s.setPadding(6, 12, 6, 12);
  if (a.open) {
    const timer = s.addDate(new Date(Date.now() - a.seconds * 1000));
    timer.applyTimerStyle(); timer.font = Font.boldMonospacedSystemFont(big ? 15 : 13); timer.textColor = C.ok;
    s.addSpacer(6);
    txt(s, 'حاضر', big ? 15 : 13, C.ok, 'bold');
  } else {
    txt(s, 'ثبت ورود', big ? 15 : 13, C.muted, 'bold');
  }
  s.addSpacer(6);
  const dot = s.addText('●'); dot.font = Font.systemFont(9); dot.textColor = a.open ? C.ok : C.faint;
  return s;
}

function taskRow(parent, t, d) {
  const r = parent.addStack(); r.layoutHorizontally(); r.centerAlignContent();
  r.url = d.urls.task + t.id;
  r.backgroundColor = C.card; r.cornerRadius = 14; r.setPadding(8, 10, 8, 10);
  if (t.locked) { r.borderColor = C.lock; r.borderWidth = 1; }
  const body = r.addStack(); body.layoutVertically();
  const head = row(body);
  if (t.new) { const n = head.addStack(); n.backgroundColor = C.lockSoft; n.cornerRadius = 8; n.setPadding(1, 6, 1, 6); txt(n, 'جدید', 10, C.lock, 'bold'); head.addSpacer(6); }
  if (t.urgent) { txt(head, 'فوری ', 11, C.danger, 'bold'); }
  const title = txt(head, t.title, 13, t.done ? C.faint : C.ink, 'bold');
  if (t.locked) { head.addSpacer(4); txt(head, '🔒', 10); }
  const meta = [t.items ? t.items + ' ☰' : '', t.project, t.time ? t.time + ' ⏱' : ''].filter(Boolean);
  if (t.due || meta.length) {
    const m = row(body);
    if (meta.length) txt(m, meta.join('  '), 10, C.muted);
    if (t.due) { m.addSpacer(6); txt(m, t.due, 10, t.overdue ? C.danger : C.muted, 'bold'); }
  }
  r.addSpacer(8);
  const tick = r.addStack(); tick.size = new Size(24, 24); tick.cornerRadius = 12; tick.centerAlignContent();
  tick.borderColor = t.done ? C.brand : C.line; tick.borderWidth = 2;
  if (t.done) { tick.backgroundColor = C.brand; txt(tick, '✓', 12, Color.white(), 'bold'); }
  if (t.can) tick.url = run('action=' + (t.done ? 'undo' : 'done') + '&id=' + t.id);
}

function tasksCard(w, d, tab, max) {
  const head = row(w);
  const plus = head.addStack(); plus.size = new Size(26, 26); plus.cornerRadius = 13; plus.backgroundColor = C.brand; plus.centerAlignContent();
  plus.url = d.urls.new_task; txt(plus, '+', 18, Color.white(), 'bold');
  head.addSpacer();
  Object.keys(TABS).reverse().forEach(function (k) {
    const b = head.addStack(); b.setPadding(3, 8, 3, 8); b.cornerRadius = 10;
    if (k === tab) b.backgroundColor = C.card;
    txt(b, TABS[k], 11, k === tab ? C.ink : C.muted, 'bold');
  });
  head.addSpacer(8);
  txt(head, 'تسک‌ها', 16, C.ink, 'bold');
  w.addSpacer(8);
  const list = d.tasks[tab].items;
  if (!list.length) {
    const e = row(w); txt(e, tab === 'overdue' ? 'عقب‌افتاده‌ای ندارید 🎉' : tab === 'today' ? 'امروز تسکی ندارید' : 'این هفته تسکی ندارید', 13, C.muted);
  }
  list.slice(0, max).forEach(function (t) { taskRow(w, t, d); w.addSpacer(6); });
  if (list.length > max) { const more = row(w); txt(more, '+ ' + String(list.length - max).replace(/\d/g, function (c) { return '۰۱۲۳۴۵۶۷۸۹'[c]; }) + ' تسک دیگر', 11, C.muted); }
}

function summary(w, d, family) {
  const top = row(w);
  attendance(top, d, family !== 'small');
  if (family === 'small') {
    w.addSpacer(8);
    const r1 = row(w); txt(r1, d.attendance.open ? 'از ' + d.attendance.since : 'امروز ' + d.attendance.worked, 11, C.muted);
    w.addSpacer(4);
    const r2 = row(w); r2.url = d.urls.tasks; txt(r2, String(d.tasks.today.open) + ' تسک امروز', 12, C.ink, 'bold');
    if (d.tasks.overdue.count) { const r3 = row(w); txt(r3, String(d.tasks.overdue.count) + ' عقب‌افتاده', 11, C.danger, 'bold'); }
    if (d.messages.unread) { const r4 = row(w); r4.url = d.urls.messages; txt(r4, String(d.messages.unread) + ' پیام نخوانده', 11, C.brand, 'bold'); }
    return;
  }
  top.addSpacer();
  txt(top, d.today_fa, 13, C.muted, 'bold');
  w.addSpacer(10);
  const m = d.meeting, mr = row(w);
  mr.url = m ? m.url : d.urls.meetings;
  txt(mr, m ? m.when + ' · ' + m.title : 'جلسه‌ای پیش رو ندارید', 12, m && m.live ? C.ok : C.ink, 'bold');
  mr.addSpacer(6); txt(mr, '🎥', 11);
  w.addSpacer(6);
  const msg = row(w); msg.url = d.urls.messages;
  const last = d.messages.items[0];
  txt(msg, d.messages.unread ? (last ? last.text : '') : 'پیام نخوانده‌ای ندارید', 12, d.messages.unread ? C.ink : C.muted);
  msg.addSpacer(6); txt(msg, d.messages.unread ? '💬 ' + d.messages.unread : '💬', 11, C.brand, 'bold');
  w.addSpacer(6);
  const tr = row(w); tr.url = d.urls.tasks;
  txt(tr, 'تسک امروز: ' + d.tasks.today.open + (d.tasks.overdue.count ? ' · عقب‌افتاده: ' + d.tasks.overdue.count : ''), 12, d.tasks.overdue.count ? C.danger : C.ink, 'bold');
}

function digits(s) { return String(s).replace(/\d/g, function (c) { return '۰۱۲۳۴۵۶۷۸۹'[c]; }); }

async function build(d) {
  const w = new ListWidget();
  w.backgroundColor = C.bg; w.setPadding(14, 14, 14, 14);
  w.url = d.urls.panel;
  w.refreshAfterDate = new Date(Date.now() + 10 * 60 * 1000);
  const param = String(args.widgetParameter || '').trim();
  const family = config.widgetFamily || 'large';
  ['today', 'week', 'overdue'].forEach(function (k) { d.tasks[k].open = digits(d.tasks[k].open); d.tasks[k].count = digits(d.tasks[k].count); });
  d.messages.unread = digits(d.messages.unread);
  if (param.indexOf('tasks') === 0 || (!param && family === 'large')) {
    tasksCard(w, d, param.split(':')[1] || 'today', family === 'large' ? 5 : 2);
  } else if (param === 'attendance') {
    w.addSpacer(); attendance(row(w), d, true); w.addSpacer(6);
    const s = row(w); txt(s, d.attendance.open ? 'ورود ' + d.attendance.since + ' · امروز ' + d.attendance.worked : 'امروز ' + d.attendance.worked, 11, C.muted); w.addSpacer();
  } else if (param === 'messages') {
    const h = row(w); txt(h, 'پیام‌ها' + (d.messages.unread !== '۰' ? ' · ' + d.messages.unread : ''), 15, C.ink, 'bold'); w.addSpacer(8);
    if (!d.messages.items.length) { const e = row(w); txt(e, 'پیام نخوانده‌ای ندارید', 12, C.muted); }
    d.messages.items.slice(0, family === 'large' ? 5 : 2).forEach(function (c) { const r = row(w); r.url = d.urls.messages; txt(r, c.title + ' (' + c.unread + ')', 12, C.ink, 'bold'); const t = row(w); txt(t, c.text, 11, C.muted); w.addSpacer(6); });
  } else if (param === 'meeting') {
    const h = row(w); txt(h, 'جلسه بعدی', 15, C.ink, 'bold'); w.addSpacer(8);
    const m = d.meeting; const r = row(w); r.url = m ? m.url : d.urls.meetings;
    txt(r, m ? m.title : 'جلسه‌ای پیش رو ندارید', 14, C.ink, 'bold');
    if (m) { const t = row(w); txt(t, m.when, 12, m.live ? C.ok : C.muted, 'bold'); }
  } else {
    summary(w, d, family);
  }
  w.addSpacer();
  return w;
}

async function errorWidget(msg) {
  const w = new ListWidget(); w.backgroundColor = C.bg;
  const r = row(w); txt(r, 'مربع', 15, C.brand, 'bold'); w.addSpacer(6);
  const t = w.addText(msg); t.font = Font.systemFont(12); t.textColor = C.muted; t.rightAlignText();
  return w;
}

const q = args.queryParameters || {};
if (q.action) {
  // Tapped from the widget: do it, then say so.
  try {
    let go = true;
    if (q.action === 'punch' && (await call('GET')).attendance.open) {
      const c = new Alert(); c.title = 'ثبت خروج'; c.message = 'خروج الان ثبت شود؟'; c.addAction('ثبت خروج'); c.addCancelAction('انصراف');
      go = (await c.present()) === 0;
    }
    if (go) {
      const d = await call('POST', 'action=' + encodeURIComponent(q.action) + (q.id ? '&id=' + encodeURIComponent(q.id) : ''));
      const a = new Alert(); a.title = d.toast || 'انجام شد'; a.addAction('باشه'); await a.present();
    }
  } catch (e) {
    const a = new Alert(); a.title = 'انجام نشد'; a.message = e.message; a.addAction('باشه'); await a.present();
  }
  Script.complete();
} else {
  let w;
  try { w = await build(await call('GET')); } catch (e) { w = await errorWidget(e.message); }
  if (config.runsInWidget) Script.setWidget(w); else await w.presentLarge();
  Script.complete();
}
