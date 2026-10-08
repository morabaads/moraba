/*
 * Browser tests for «مربع چت» and the panel (Playwright + Chromium, the engine of the Windows app's WebView2).
 *   tests/e2e/setup.sh            → a test WordPress on localhost:8080 with sample data
 *   node tests/e2e/run.js         → MP_BASE=http://localhost:8080 by default; exit code 1 when anything fails
 * The Windows app is stood in for by a fake window.chrome.webview that records what the page posts to it.
 */
const { chromium } = require('playwright');
const BASE = process.env.MP_BASE || 'http://localhost:8080';
const CHAT = 'گروه آقای احمدی';
let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else fail++; console.log((c ? '  ok   ' : '  FAIL ') + m); }
const wait = ms => new Promise(r => setTimeout(r, ms));

const hostStub = () => {
  window.__posted = []; const ls = [];
  window.chrome = window.chrome || {};
  window.chrome.webview = { postMessage: m => window.__posted.push(m), addEventListener: (t, f) => ls.push(f) };
  window.__hostSend = d => ls.forEach(f => f({ data: d }));
  window.__MP_DESKTOP = { v: '9.9.9' };
};
async function open(b, user, opts = {}) {
  const ctx = await b.newContext({ viewport: opts.viewport || { width: 1440, height: 860 } });
  if (opts.app !== false) await ctx.addInitScript(hostStub);
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', e => { if (!/wp is not/.test(e.message)) p.errors.push(e.message); });
  await p.goto(BASE + (opts.path || '/chat/'));
  await p.fill('#user_login', user); await p.fill('#user_pass', user); await p.click('#wp-submit');
  await p.waitForSelector('body:not(.is-loading)', { timeout: 15000 });
  await wait(1500);
  return { ctx, p };
}
const chatId = p => p.evaluate(t => (MP.S.channels.find(c => c.title === t) || {}).id, CHAT);

async function session(b) {
  console.log('session');
  const { ctx, p } = await open(b, 'admin', { app: false });
  const ck = (await ctx.cookies()).find(c => /wordpress_logged_in/.test(c.name));
  ok(ck && ck.expires - Date.now() / 1000 > 170 * 86400, 'remembered sign-in lasts ~180 days');
  const r = await p.evaluate(async () => { MP_CONFIG.nonce = 'deadbeef00'; const d = await MP.api('channels', { noCache: true }); return Array.isArray(d) && MP_CONFIG.nonce !== 'deadbeef00'; });
  ok(r, 'an expired REST nonce is renewed and the call retried');
  const q = await (await b.newContext()).newPage();
  ok((await q.goto(BASE + '/?mp_nonce=1')).status() === 401, 'no fresh nonce without a sign-in');
  ok(!p.errors.length, 'no page errors ' + p.errors.join(' | '));
  await ctx.close();
}

async function shell(b) {
  console.log('desktop shell');
  const { ctx, p } = await open(b, 'admin');
  ok(await p.evaluate(() => document.body.classList.contains('tg') && document.querySelectorAll('.tg-folder').length >= 3), 'folder rail');
  ok(await p.evaluate(() => document.querySelectorAll('#chat-list .ci-av .initials').length >= 1), 'chat avatars: initials on a colour');
  await p.keyboard.press('Control+2'); await wait(300);
  ok(await p.evaluate(() => MP.chatDesk.folder() === MP.chatDesk.folders()[1].id), 'Ctrl+2 → second folder');
  await p.keyboard.press('Control+1');
  await p.click('.tg-burger'); await wait(400);
  ok(await p.evaluate(() => !!document.querySelector('.tg-drawer.in')), 'drawer opens');
  await p.keyboard.press('Escape'); await wait(300);
  const id = await chatId(p);
  await p.evaluate(i => { localStorage.setItem('mp_chat_side', '1'); MP.chatDesk.select(i); }, id); await wait(1500);
  ok(await p.evaluate(() => document.querySelector('.chat-layout').classList.contains('side-open') && /اطلاعات/.test(document.getElementById('chat-side').textContent)), 'info column beside the chat');
  ok(await p.evaluate(() => [...document.querySelectorAll('#chat-side .tg-row')].some(r => /لینک/.test(r.textContent))), 'info column counts links');
  ok(await p.evaluate(() => ![...document.querySelectorAll('#chat-tools .tool-pill')].some(x => x.offsetParent)), 'clean chat header');
  await p.evaluate(() => { window.__posted = []; MP.tgSettings('chat'); }); await wait(300);
  await p.click('.th-tinted'); await wait(800);
  ok(await p.evaluate(() => document.documentElement.matches('.dark.tinted')), 'tinted theme');
  ok(await p.evaluate(() => window.__posted.some(m => m.t === 'theme' && /^#/.test(m.bg))), 'title bar colour sent to the app');
  await p.keyboard.press('Escape'); await wait(300);
  ok(await p.evaluate(() => MP.openChannel() > 0), 'Esc in settings keeps the chat open');
  await p.evaluate(() => { window.__posted = []; }); await p.keyboard.press('Control+='); await wait(200);
  ok(await p.evaluate(() => window.__posted.some(m => m.t === 'zoom' && m.v === 1.1)), 'Ctrl+= → app zoom');
  await p.keyboard.press('Control+-');
  await p.evaluate(() => { window.__posted = []; MP.popOut(MP.openChannel()); });
  ok(await p.evaluate(() => window.__posted.some(m => m.t === 'popout')), 'separate window asked of the app');
  await p.evaluate(() => { const q = MP.S.boot.prefs; q.tint = false; q.dark = true; return MP.savePrefs(); });
  await p.click('.chat-messages'); await p.keyboard.press('Escape'); await wait(400);
  ok(await p.evaluate(() => !MP.openChannel() && !!document.querySelector('.chat-none')), 'Esc → «یک گفت‌وگو را انتخاب کنید»');
  await ctx.setOffline(true); await wait(200);
  ok(await p.evaluate(() => window.__posted.some(m => m.t === 'status' && m.text)), 'offline shown in the title bar');
  await ctx.setOffline(false);
  ok(!p.errors.length, 'no page errors ' + p.errors.join(' | '));
  await ctx.close();
}

async function lock(b) {
  console.log('local passcode');
  const { ctx, p } = await open(b, 'admin');
  await p.keyboard.press('Control+l'); await wait(400);
  await p.evaluate(() => [...document.querySelectorAll('.tg-srow')][0].click()); await wait(300);
  const ins = await p.$$('.tg-pass input');
  await ins[0].fill('1234'); await ins[1].fill('۱۲۳۴'); await p.click('.tg-pass button'); await wait(600);
  ok(await p.evaluate(() => { const c = JSON.parse(localStorage.getItem('mp_lock_' + MP_CONFIG.user)); return c && c.hash.length === 64; }), 'passcode kept hashed');
  await p.keyboard.press('Escape'); await p.keyboard.press('Control+l'); await wait(400);
  ok(await p.evaluate(() => MP.isLocked() && getComputedStyle(document.querySelector('.app')).visibility === 'hidden'), 'Ctrl+L locks');
  await p.fill('.tg-lock-in', '9999'); await p.keyboard.press('Enter'); await wait(400);
  ok(await p.evaluate(() => MP.isLocked()), 'wrong code refused');
  await p.fill('.tg-lock-in', '1234'); await p.keyboard.press('Enter'); await wait(400);
  ok(await p.evaluate(() => !MP.isLocked()), 'right code unlocks');
  await p.reload(); await wait(2500);
  ok(await p.evaluate(() => MP.isLocked()), 'opens locked');
  await p.evaluate(() => { localStorage.removeItem('mp_lock_' + MP_CONFIG.user); localStorage.removeItem('mp_locked_at'); });
  await ctx.close();
}

async function presence(b) {
  console.log('automatic attendance (as the app reports it)');
  const { ctx, p } = await open(b, 'emp');
  await p.evaluate(() => { window.__posted = []; window.__hostSend({ t: 'activity', ev: 'start', idle: 3, locked: 0, busy: 0, device: 'w00112233445566778899aabbcc' }); });
  await wait(1500);
  ok(await p.evaluate(() => window.__posted.some(m => m.t === 'presence' && m.present === 1)), 'activity → present');
  await p.evaluate(() => { window.__posted = []; window.__hostSend({ t: 'activity', ev: 'lock', idle: 0, locked: 1, busy: 0, device: 'w00112233445566778899aabbcc' }); });
  await wait(1500);
  ok(await p.evaluate(() => window.__posted.some(m => m.t === 'presence' && m.present === 0)), 'lock → not present');
  const id = await chatId(p);
  await p.evaluate(i => window.__hostSend({ t: 'reply', channel: i, text: 'پاسخ از اعلان' }), id); await wait(1500);
  ok(await p.evaluate(i => MP.api('channels/' + i + '/messages', { noCache: true }).then(d => d.messages.some(m => m.body === 'پاسخ از اعلان')), id), 'reply typed in a Windows notification is sent');
  ok(!p.errors.length, 'no page errors ' + p.errors.join(' | '));
  await ctx.close();
}

(async () => {
  const b = await chromium.launch();
  for (const t of [session, shell, lock, presence]) {
    try { await t(b); } catch (e) { ok(false, t.name + ': ' + e.message.split('\n')[0]); }
    await wait(1000);
  }
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
