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
  try { localStorage.setItem('mp_tour_done', '1'); } catch (e) { /* private */ }
};
async function open(b, user, opts = {}) {
  const ctx = await b.newContext({ viewport: opts.viewport || { width: 1440, height: 860 } });
  if (opts.app !== false) await ctx.addInitScript(hostStub);
  else await ctx.addInitScript(() => { try { localStorage.setItem('mp_tour_done', '1'); } catch (e) { /* private */ } });
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
  ok(await p.evaluate(() => [...document.scripts].some(x => /\/moraba-panel\/bundle-[\w.-]+\.js$/.test(x.src))), 'scripts load as one bundle');
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

/* «مربع چت» on phones: the Android app (window.MorabaApp stood in for) and the iPhone home-screen app. */
const appStub = () => {
  window.__app = { calls: [], shared: null };
  const log = (n, a) => window.__app.calls.push([n].concat([].slice.call(a)));
  window.MorabaApp = {
    version: () => 'chat-1.1',
    theme: function () { log('theme', arguments); }, secure: function () { log('secure', arguments); },
    canBiometric: () => true, biometric: function () { log('biometric', arguments); setTimeout(() => window.__mpBio(true), 50); },
    notifySettings: function () { log('notifySettings', arguments); }, haptic: () => {},
    shared: () => JSON.stringify(window.__app.shared), clearShared: () => { window.__app.shared = null; }
  };
  try { localStorage.setItem('mp_tour_done', '1'); } catch (e) { /* private */ }
};
async function openPhone(b, user, ios) {
  const { devices } = require('playwright');
  const { defaultBrowserType, ...d } = devices[ios ? 'iPhone 13' : 'Pixel 7'];
  const ctx = await b.newContext(d);
  if (!ios) await ctx.addInitScript(appStub);
  else await ctx.addInitScript(() => { try { localStorage.setItem('mp_tour_done', '1'); } catch (e) { /* private */ } });
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', e => { if (!/wp is not/.test(e.message)) p.errors.push(e.message); });
  await p.goto(BASE + '/chat/');
  await p.fill('#user_login', user); await p.fill('#user_pass', user); await p.press('#user_pass', 'Enter');
  await p.waitForSelector('body:not(.is-loading)', { timeout: 15000 });
  await wait(2000);
  return { ctx, p };
}

async function android(b) {
  console.log('phone: Android app');
  const { ctx, p } = await openPhone(b, 'admin', false);
  ok(await p.evaluate(() => document.body.classList.contains('tgm') && document.documentElement.classList.contains('tgm-and') && !!document.querySelector('#tgm-fab') && document.documentElement.scrollWidth <= innerWidth), 'phone shell: top bar, ✎ button, no sideways scroll');
  ok(await p.evaluate(() => /مربع چت/.test(document.querySelector('.tgm-title').textContent)), 'title once loaded');
  ok(await p.evaluate(() => window.__app.calls.some(c => c[0] === 'theme' && /^#|rgb/.test(c[1]))), 'theme colour → system bars');
  await p.click('.tgm-burger'); await wait(400);
  ok(await p.evaluate(() => !!document.querySelector('.tg-drawer.in') && /اندروید/.test(document.querySelector('.tg-dfoot').textContent)), 'drawer');
  await p.goBack(); await wait(500);
  ok(await p.evaluate(() => !document.querySelector('.tg-drawer')), 'back button closes the drawer');
  await p.evaluate(() => MP.contacts()); await wait(400);
  ok(await p.evaluate(() => document.querySelectorAll('.tgm-crow').length >= 1), 'contacts page');
  await p.goBack(); await wait(400);
  await p.evaluate(() => MP.tgSettings('privacy')); await wait(300);
  await p.evaluate(() => [...document.querySelectorAll('.tg-srow')][0].click()); await wait(300);
  const ins = await p.$$('.tg-pass input');
  await ins[0].fill('1234'); await ins[1].fill('1234'); await p.click('.tg-pass button'); await wait(600);
  ok(await p.evaluate(() => window.__app.calls.some(c => c[0] === 'secure' && c[1] === true)), 'passcode → no screenshots / recents preview');
  await p.evaluate(() => [...document.querySelectorAll('.tg-srow input[role=switch]')].find(x => /اثر انگشت/.test(x.closest('.tg-srow').textContent)).click()); await wait(600);
  ok(await p.evaluate(() => JSON.parse(localStorage.getItem('mp_lock_' + MP_CONFIG.user)).bio === 'app'), 'fingerprint unlock turned on');
  await p.evaluate(() => { document.querySelector('.tg-modal').close(); MP.lockNow(); }); await wait(900);
  ok(await p.evaluate(() => !MP.isLocked() && window.__app.calls.some(c => c[0] === 'biometric')), 'locked → fingerprint asked by itself → open');
  await p.evaluate(() => { localStorage.removeItem('mp_lock_' + MP_CONFIG.user); localStorage.removeItem('mp_locked_at'); });
  // a photo shared from the gallery
  await p.route('**/__mp_share/0', r => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') }));
  await p.evaluate(() => { window.__app.shared = { text: '', files: [{ name: 'shot.png', type: 'image/png' }] }; window.__mpShared(); }); await wait(800);
  ok(await p.evaluate(() => /ارسال/.test((document.querySelector('.dialog') || {}).textContent || '')), 'shared photo → «ارسال به…» a chat');
  await p.evaluate(() => MP.dialog.close());
  ok(await p.evaluate(() => window.__app.shared === null), 'share taken once');
  // «پاسخ» typed in an Android notification
  const id = await chatId(p);
  const cookie = (await ctx.cookies()).map(c => c.name + '=' + c.value).join('; ');
  const r1 = await ctx.request.post(BASE + '/?mp_push_feed=1&chat=1&reply=' + id, { headers: { 'X-MP-Push': '1', Cookie: cookie }, form: { text: 'پاسخ از اعلان اندروید' } });
  ok(r1.status() === 200 && await p.evaluate(i => MP.api('channels/' + i + '/messages', { noCache: true }).then(d => d.messages.some(m => m.body === 'پاسخ از اعلان اندروید')), id), 'reply from an Android notification is posted');
  const r2 = await ctx.request.post(BASE + '/?mp_push_feed=1&chat=1&reply=' + id, { headers: { Cookie: cookie }, form: { text: 'بدون سرآیند' } });
  ok(!(await p.evaluate(i => MP.api('channels/' + i + '/messages', { noCache: true }).then(d => d.messages.some(m => m.body === 'بدون سرآیند')), id)) && r2.status() !== 500, 'no reply without the app header');
  ok(!p.errors.length, 'no page errors ' + p.errors.join(' | '));
  await ctx.close();
}

async function iphone(b) {
  console.log('phone: iPhone web app');
  const { ctx, p } = await openPhone(b, 'admin', true);
  ok(await p.evaluate(() => document.documentElement.classList.contains('tgm-ios') && document.querySelectorAll('#tgm-tabs .tgm-tab').length === 4), 'floating tab bar: chats · contacts · settings · profile');
  await p.click('#tgm-tabs .tgm-tab:nth-child(3)'); await wait(500);
  ok(await p.evaluate(() => { const m = document.querySelector('.tg-modal'); return m && m.getBoundingClientRect().width >= innerWidth - 1; }), 'settings full screen');
  await p.goBack(); await wait(400);
  ok(await p.evaluate(() => !document.querySelector('.tg-modal')), 'back closes settings');
  await p.click('#tgm-tabs .tgm-tab:nth-child(2)'); await wait(400);
  ok(await p.evaluate(() => !!document.querySelector('.tgm-page[data-tab=contacts]') && document.querySelector('#tgm-tabs .tgm-tab:nth-child(2)').classList.contains('on')), 'contacts from the tab bar');
  await p.click('#tgm-tabs .tgm-tab:nth-child(4)'); await wait(500);
  ok(await p.evaluate(() => !document.querySelector('.tgm-page[data-tab=contacts]') && !!document.querySelector('.tgm-page[data-tab=profile] .tgm-hero')), 'profile tab replaces contacts');
  await p.click('#tgm-tabs .tgm-tab:nth-child(1)'); await wait(500);
  ok(await p.evaluate(() => !document.querySelector('.tgm-page') && document.body.classList.contains('tgm-root')), 'back to the chats');
  const id = await chatId(p);
  await p.evaluate(i => MP.chatDesk.select(i), id); await wait(1200);
  ok(await p.evaluate(() => document.body.classList.contains('chat-full') && getComputedStyle(document.querySelector('#tgm-tabs')).display === 'none'), 'open chat hides the tab bar');
  ok(!p.errors.length, 'no page errors ' + p.errors.join(' | '));
  await ctx.close();
}

async function callPush(b) {
  console.log('call while the phone app is closed');
  const { ctx, p } = await open(b, 'admin', { app: false });
  const emp = await p.evaluate(() => MP.S.users.find(u => u.id !== MP.S.me.id && /سارا/.test(u.name)).id);
  const c = await p.evaluate(u => MP.api('calls', { method: 'POST', body: { user_id: u, video: false } }), emp);
  const q = await open(b, 'emp', { app: false });
  ok(await q.p.evaluate(() => MP.api('notifications', { noCache: true }).then(l => l.some(n => /تماس/.test(n.title)))), 'the callee gets a notification (push wakes the phone)');
  await q.p.evaluate(i => MP.api('calls/' + i, { method: 'POST', body: { action: 'decline' } }), c.id);
  await q.ctx.close(); await ctx.close();
}

/* Voice call between two browsers with fake microphones: through the site's relay, then device to device. */
async function voice() {
  const vb = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  for (const direct of [false, true]) {
    console.log('voice call ' + (direct ? '(direct)' : '(through the site)'));
    const two = [];
    for (const user of ['admin', 'emp']) {
      const ctx = await vb.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['microphone'] });
      await ctx.addInitScript(d => { try { localStorage.setItem('mp_tour_done', '1'); if (!d) localStorage.setItem('mp_call_p2p', '0'); } catch (e) { /* private */ } }, direct);
      const p = await ctx.newPage(); p.errors = [];
      p.on('pageerror', e => { if (!/wp is not/.test(e.message)) p.errors.push(e.message); });
      await p.goto(BASE + '/chat/'); await p.fill('#user_login', user); await p.fill('#user_pass', user); await p.press('#user_pass', 'Enter');
      await p.waitForSelector('body:not(.is-loading)', { timeout: 15000 }); await wait(1500);
      two.push({ ctx, p });
    }
    const [A, B] = two;
    const emp = await A.p.evaluate(() => MP.S.users.find(u => /سارا/.test(u.name)).id);
    await A.p.evaluate(u => MP.call(u, false), emp);
    ok(await A.p.evaluate(() => /زنگ/.test(document.querySelector('.vc-status').textContent)), 'caller: «در حال زنگ زدن…»');
    await B.p.waitForSelector('.call-ring', { timeout: 15000 });
    await B.p.click('.cr-yes');
    const up = async x => x.p.waitForFunction(() => MP.voice.current() && MP.voice.current().state === 'active', null, { timeout: 15000 }).then(() => true, () => false);
    ok(await up(A) && await up(B), 'both sides connected');
    await wait(3000);
    const st = await A.p.evaluate(() => { const v = MP.voice.current(); return { p2p: v.p2p, opus: !!v.enc, buf: (v.stats || {}).target || 0, txt: document.querySelector('.vc-status').textContent }; });
    if (direct) ok(st.p2p, 'direct connection between the two devices');
    else ok(!st.p2p && st.opus && st.buf > 0 && st.buf <= 300, 'Opus through the relay, jitter buffer ' + st.buf + ' ms');
    ok(/^[۰-۹]{2}:[۰-۹]{2}$/.test(st.txt), 'call timer ' + st.txt);
    await A.p.evaluate(() => MP.voice.end());
    ok(await B.p.waitForFunction(() => !MP.voice.current() || MP.voice.current().ended, null, { timeout: 8000 }).then(() => true, () => false), 'hang-up reaches the other side');
    await wait(1500);
    const id = await A.p.evaluate(u => MP.S.channels.find(c => c.type === 'direct' && c.other === u).id, emp);
    ok(/تماس صوتی · /.test(await A.p.evaluate(i => MP.api('channels/' + i + '/messages', { noCache: true }).then(d => d.messages.slice(-1)[0].body), id)), 'call length written in the chat');
    ok(!A.p.errors.length && !B.p.errors.length, 'no page errors ' + A.p.errors.concat(B.p.errors).join(' | '));
    await A.ctx.close(); await B.ctx.close();
  }
  await vb.close();
}

(async () => {
  try { await voice(); } catch (e) { ok(false, 'voice: ' + e.message.split('\n')[0]); }
  const b = await chromium.launch();
  for (const t of [session, shell, lock, presence, android, iphone, callPush]) {
    try { await t(b); } catch (e) { ok(false, t.name + ': ' + e.message.split('\n')[0]); }
    await wait(1000);
  }
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
