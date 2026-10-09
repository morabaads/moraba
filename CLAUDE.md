# Moraba Panel (WordPress plugin `moraba-panel`)

Persian (RTL) staff panel «مربع آفیس» + client portal for a design studio. PHP 7.4+, vanilla JS, no build step.
Active branch: `claude/awesome-hopper-84p492`. Reply to the owner in Persian; say plainly what was and wasn't tested.

## Release routine (every change)
1. Bump the version in `moraba-panel.php` (header `Version:` and `MP_VERSION`); bump `MP_DB_VERSION` when tables/columns change (`dbDelta` in `includes/class-mp-install.php` runs on upgrade).
2. Commit, push `git push -u origin claude/awesome-hopper-84p492`.
3. Zip for the owner: `git archive HEAD` into a folder named `moraba-panel/`, then zip that folder (the owner installs it through WordPress).

## Layout
- `moraba-panel.php` — bootstrap, requires every class, registers REST routes (`moraba-panel/v1`).
- `includes/` — one class per area:
  - `class-mp-rest.php` tasks, projects, channels/messages, reminders; `class-mp-rest-work.php` files, attendance, leaves.
  - `class-mp-chat.php` Telegram-style chat extras (polls, topics, roles, invite links, scheduled, stickers, edit history, «delete for me», cards, AI summary/translate); `class-mp-live.php` the live connection (`GET live`: SSE, `?mode=poll` held-request fallback; a version file + newest message id, `MP_Live::bump()` after any chat change).
  - `class-mp-client.php` client groups/portal auth (+ per-group «اجازه‌های مشتری»: `client_tasks` in `channels.settings`, `POST client/{token}/tasks` {title, description, file_ids} — always for today, attachments uploaded through `client/{token}/upload` and moved to the task; one private chat per customer = client channel with `settings.pv = 1` (`MP_Client::pv_for`), seen by the colleagues of the customer's projects (no project yet: everyone); groups are only made by hand, a new customer gets just the private chat; `POST client/{token}/switch` moves a logged-in person between their conversations; «از طرف مشتری» preview is supervisors only and may do everything, logged via `MP_Client::log_acting`), `class-mp-portal.php` portal data (designs, pins, invoices…).
  - `class-mp-client-chat.php` the portal chat (files of any format in pieces, reply, edit/delete own, reactions, reads, typing); a client person gets a stand-in user id (`PSEUDO + contact id`, or `GUEST + hash` of the browser key header `X-MP-Client-Key`) for reactions/reads/typing; own messages carry `extra.cc`/`extra.ck`.
  - `class-mp-invoices.php` invoices + Zibal/ZarinPal, `class-mp-contracts.php` contracts (templates, two-party signing, PDF).
  - `class-mp-meet.php` video meetings (rooms, waiting room, invites, recording, minutes, stats, reminders),
    `class-mp-relay.php` + root `relay.php` media relay (no STUN/TURN needed; relay.php runs without WordPress).
  - `class-mp-backup.php` export/import, granular reset (`RESET_ITEMS`), factory reset.
  - `class-mp-chat.php` Telegram-style chat on top of MP_Rest's channels/messages: reply, edit, reactions (`reactions` table), pinned message (`channels.pinned_msg`), forward, «saved messages» (channel type `saved`), mute (user meta `mp_mutes`), @mentions, search, media tabs, link preview, «seen by»; `list_messages` with `wait=1&sig=` holds up to ~6 s until the chat changes (needs a host that runs PHP requests in parallel; the test server needs `PHP_CLI_SERVER_WORKERS=6`).
  - `class-mp-chat.php` Telegram-style chat extras (edit, reactions, pin, forward, search, media, link preview) + `chat-upload`:
    chat files go up in 1.5 MB pieces (`MP.uploadChunked`), so no host upload/size limit applies; any format is accepted (unknown types are stored on disk as `.bin`, `application/octet-stream`, always downloaded).
    Apple emoji ship as one sprite `assets/emoji/apple.webp` (48px tiles, 40 per row) indexed by `assets/js/emoji-map.js`.
  - `class-mp-widget.php` home-screen widgets API (`widget` GET summary / POST punch·done·undo, `widget/devices` pairing codes kept hashed in user meta `mp_widget_devices`).
  - `class-mp-install.php` schema, `class-mp-frontend.php` routes (`/panel`, `/c/{token}` portal, `/i/` invoice, `/k/` contract, `/m/` meeting).
- `templates/` — `panel.php` (staff app shell + views), `client.php` (portal), `meet.php` (meeting room), `contract.php`, `login.php`, `sprite.svg` (icons; element ids must not clash with symbol ids).
- `assets/js/` — `core.js` (MP.el, MP.api, MP.dialog, MP.field, MP.dateField (Jalali), MP.peoplePicker…), one file per view (`tasks.js`, `projects.js`, `messages.js`, `meetings.js`, …), `viewer.js` (`MPViewer`: full-screen photo viewer with a thumbnail strip, used by the chat gallery, `MP.lightbox` and the portal chat; loaded in panel + portal), `chat-kit.js` (chat formatting, photo editor, polls, place/contact, round video, «send later»; loaded before messages.js), `client.js` (portal), `client-chat.js` (`MPClientChat`: the portal chat, same markup/CSS classes as the panel chat), `meet.js` (meeting room: WebCodecs Opus/H.264/VP8 with μ-law/JPEG fallback, loopback echo cancellation, chat, design review, recording).
- `assets/css/app.css` (panel + portal, dark default), `assets/css/meet.css` (meeting room).
- «مربع چت» (the staff chat as its own app; profile menu → «مربع چت»):
  - PWA at `/chat/` (option `mp_chat_slug`; `?mp_panel=chat` without pretty links): `templates/panel.php` with `$mp_chat_app`
    (body `chat-app`, CSS hides everything but the messages view; `MP_CONFIG.chatApp` makes `MP.showView` open other views in the panel),
    own manifest `?mp_manifest=chat`, service worker `?mp_sw=chat` (scope `/chat/`), icons `assets/img/chat-*.png`.
    Push: chat subscriptions live in user meta `mp_push_chat` and wake only for message notifications; the feed takes `&chat=1`.
  - Android: same sources built with `APP=chat apps/android/build.sh` (`Config.CHAT`, `AndroidManifest.chat.xml`, package renamed to
    `ir.moraba.chat`, no widgets) → `assets/app/moraba-chat.apk`; bump its own `versionCode` in `AndroidManifest.chat.xml`.
  - Windows: `apps/windows/moraba-chat.c` (C, mingw-w64, `build.sh` fetches the WebView2 SDK from NuGet into `.vendor/`) →
    `assets/app/MorabaChat.exe`: a native window hosting the chat in WebView2 (WebView2Loader.dll embedded as resource 2, written
    beside the exe), Telegram-Desktop-like: tray icon (close = tray), unread number on the taskbar + dot on the tray, Windows
    notifications (via the tray icon; click opens that chat), Do-not-disturb, Ctrl+Shift+M global hotkey, start with Windows
    (HKCU Run, `--tray`), jump list, single instance (`--open=saved|--switch|--panel|--quit` forwarded by WM_COPYDATA),
    self-update (`app/info` → `desktop` = `MP_Frontend::CHAT_EXE_VERSION`; bump it together with APP_VERSION), settings in
    HKCU\Software\MorabaChat, Edge `--app` fallback without WebView2. Installs itself to %LOCALAPPDATA%\MorabaChat on first run.
    The site's chat URL is written into the file on download (`?mp_chat_exe=1` replaces a UTF-16 placeholder).
    Page side: `assets/js/chat-desktop.js` (`window.__MP_DESKTOP`, `chrome.webview` messages: badge/notify/set/settings? ↔
    tick/open/saved/switch/panel/focus/settings) plus desktop UX for everyone with a mouse: Ctrl+K quick switcher, Alt+↑/↓,
    Ctrl+F/0, typing goes to the composer, hover toolbar on messages (react/reply/menu, double-click = reply), resizable chat list.
    Tested under Wine + Xvfb with a stand-in WebView2Loader.dll that records calls and replays page messages (no real WebView2 in Wine).
    2.1: Windows toasts with a reply box (WinRT called by hand via IIDs/vtable slots, no SDK headers; Activated on a worker
    thread → WM_TOAST → page `{t:'reply'|'read'}`; balloon fallback, registry `toast=0` forces it), a chat in its own window
    (page `{t:'popout'}` → window class `MorabaChatPop` + own controller, page `?pop=ID` = body `chat-pop`, just that chat),
    attendance activity (`{t:'activity', idle, locked, busy, ev, device}` every 60 s + lock/unlock/sleep/wake/end; device id in
    registry `device`; the page POSTs `presence` and answers `{t:'presence'}` for the tray tooltip).
  - Third column beside an open chat (≥1200px with a mouse): `#chat-side` = `sideInfo(c, side)` in messages.js, Telegram's
    «Group Info» (hero, about rows, notifications switch, counts from `GET channels/{id}/media-counts` that open lists in the
    column, members with search/add, actions), toggled by the chat header, remembered in localStorage `mp_chat_side`.
  - Telegram-Desktop shell, `assets/js/chat-shell.js` (body `tg`: chat app, ≥861px, mouse): folder rail `#tg-rail` (from
    `MP.chatDesk.folders()`/`folder(id)`, Ctrl+1…9), ☰ drawer, settings in pages `MP.tgSettings(page)` (`notify` | `chat` |
    `advanced`; a native `<dialog class="tg-modal">`), interface scale `MP.setScale` (localStorage `mp_scale`; in the app the
    host zooms the WebView, in browsers CSS `zoom` + `--z`), Ctrl+W/Ctrl+Q in the app. Themes in `S.boot.prefs`
    (`dark`, `tint` = Telegram «Tinted» blue night, `auto` = follow Windows, `accent` #rrggbb) applied by `MP.applyPrefs`
    (html classes `dark` / `tinted` / `accent`), saved by `MP.savePrefs`; chat defaults in localStorage `mp_chat_wall`,
    `mp_chat_bub`, `mp_chat_font` (`MP.chatLooks`). «ظاهر پنل» opens the same theme page.
  - Instant start: in the chat app `app.js` boots from the IndexedDB copy (`MP.kv`: bootstrap, channels, projects) and
    refreshes from the server behind it. 2.2 host: page `{t:'theme', dark, bg, ink}` colours the title bar + WebView
    background (registry `bg`/`ink`/`dark`), `{t:'zoom', v}` (registry `zoom` %), `{t:'hide'|'quit'}`, memory target
    LOW after 5 min hidden, `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` without background throttling.
    2.3 host: its own title bar (WM_NCCALCSIZE drops the caption, keeps side/bottom borders; 32px bar painted in the theme
    colours with Segoe MDL2 glyphs; WM_NCHITTEST answers HTCAPTION/HTMIN/HTMAX/HTCLOSE/HTTOP so drag, snap layouts and the
    system menu work; WebView bounds start below it); registry `sysframe` = 1 (settings → advanced) = normal frame.
    Default context menus are on so text boxes get the browser menu with spelling suggestions (page `MP.spellOn`,
    localStorage `mp_spell`); everything else keeps the page's own menus.
  - Local passcode (chat app): `PAGES.privacy`/`passcode` in chat-shell.js, SHA-256 + salt in localStorage `mp_lock_{user}`,
    auto-lock after idle (`after` minutes), Ctrl+L, opens locked; `mp_locked_at` syncs the lock across chat windows (storage
    event); while locked `.app` is inert/hidden, notifications go out as «مربع چت / پیام تازه» without reply. «فراموش کردن» = log out.
  - Chat header in the shell: client pills hidden (they are in the ⋯ menu), `.side-btn` toggles the info column.
  - Glass (frosted) look: `prefs.glass` (default on, settings → تنظیمات گفت‌وگو) = html class `glass`; every rule is scoped
    `html.glass body.chat-app` (the panel is untouched): coloured radial backdrop on body, panels `--glass*` + backdrop-filter
    blur, translucent bubbles (blur off with reduced motion).
  - 2.4/2.5 host: signed self-update — `build.sh` signs the pristine EXE with `apps/windows/update-key.pem` (ECDSA P-256,
    `sign.py`; the key and `update-key.h` live only in apps/, never in the plugin zip — keep them and the repo private;
    a new key = installed copies refuse updates) → `assets/app/MorabaChat.exe.sig`; the app downloads `?mp_chat_exe=V&raw=1`
    + `&sig=1`, verifies with BCrypt, then writes its own site address over the placeholder and swaps. The placeholder text
    must appear only once in the binary (the update code assembles it at run time). Ctrl+Shift+S / tray «اسکرین‌شات» runs
    Windows snipping and sends the clipboard picture (`{t:'clip'}`); «ارسال به» in Explorer (SendTo shortcut, `--share`
    paths → WebView2 file handles, `{t:'share'}` with additionalObjects); `{t:'window', url}` opens any same-origin page
    (call rooms) in its own window; opt-in Acrylic (registry `mica`, Windows 11 22621+, page html class `mica`);
    toast COM activator (CLSID 8E3B7A4C-…, HKCU Classes LocalServer32, shortcut ToastActivatorCLSID; `-Embedding` starts
    hidden; actions queue until the page is loaded and are de-duplicated). Test builds: `-DHOST_TEST` (no snipping tool),
    `-DUPD_DEBUG` (C:\upd.log), `-DAPP_VERSION=L"2.3.9"` to exercise an update.
  - Session: `?mp_nonce=1` gives a fresh REST nonce (MP.renewNonce every 4 h, on wake, and on rest_cookie_invalid_nonce with
    one retry inside MP.apiRaw); «مرا به خاطر بسپار» is ticked by default and lasts 180 days (auth_cookie_expiration).
  - Calls (`class-mp-calls.php`, `assets/js/chat-calls.js`): `POST calls {user_id, video}` makes a two-person meeting room,
    the callee's live state carries `ring` (45 s, user meta `mp_ring`), `POST calls/{id} {action}`; caller gets `call`
    state; the private chat gets system lines. Live state also has `st` (MP_Presence::status: busy/away) shown as
    «در تماس یا جلسه» / «دور از سیستم».
  - Chat extras: own folders (`chat-folders`, user meta `mp_chat_folders`, tabs `u{id}`), search filters (kind/from),
    several pins (`channels.pins`, newest first; bar «۱ از ۳»), drafts synced (`drafts`, user meta `mp_drafts`), undo send
    (localStorage `mp_undo_send`; sender may hard-delete own message ≤ 30 s), Ctrl+↑/↓ reply picking, «@» jump button,
    scroll position per chat, settings search, first-run tour (`mp_tour_done`), tablet landscape gets the shell.
  - Scripts are served as one bundle (`MP_Frontend::script_urls`, uploads/moraba-panel/bundle-VER-HASH.js; separate files
    with `?mp_debug=1` or MP_NO_BUNDLE; each file is wrapped in try/catch in the bundle → `window.__mpBootErr`; old bundles kept 2 days; a bundle that fails to load falls back to the separate files; still on the splash after 15 s → the reason + «تلاش دوباره» / «پاک کردن حافظه», reported as `stuck on start`). Browser errors go to `client-errors` (MP_Diag, option `mp_js_errors`, supervisors:
    settings → advanced → «خطاهای برنامه»).
  - Phones (`assets/js/chat-mobile.js`, body `tgm` = chat app below the desktop shell; html `tgm-and` / `tgm-ios`):
    Telegram's 2025 phone look on both: large title `#tgm-head` («در حال اتصال…» from `MP.connState`/event `conn`,
    ⋮ → `MP.tgDrawer`, iPhone also ✎), round search, folder pills, floating tab bar `#tgm-tabs` (گفت‌وگوها · مخاطبین ·
    تنظیمات · پروفایل, `MP.mobileTab`, unread badge, `navigator.setAppBadge`); Android ✎ `#tgm-fab` + edge swipe for the
    drawer. Tab pages `.tgm-page[data-tab]`: `MP.contacts()` (`MP.lastSeenOf`, call button), `MP.myProfile()`;
    settings on phones = non-modal `dialog.tg-modal.tg-page` under the bar, cards with coloured icons (`.tg-sico.i-{icon}`). Drawer/settings/pages close with the back button (`MP.pushLayer`). Settings are
    full screen. Backdrop behind the glass per person: `prefs.backdrop` color/soft/plain (html `bd-soft`/`bd-plain`). Passcode on phones: lock after `after` minutes in the background, fingerprint / Face ID
    (Android app `MorabaApp.biometric` → `window.__mpBio`; web app WebAuthn platform key, `cfg.cred`), Android
    FLAG_SECURE while a passcode is set. Shared files/text: `#share` → `MP.takeShared()` (Android app:
    `MorabaApp.shared()` + `/__mp_share/N` served by `shouldInterceptRequest`; web app: manifest `share_target`
    → service worker cache `mp-share`). Home-screen shortcuts `#new-dm`, `#contacts`, `#saved`
    (Android: `morabachat://open?to=…`, `res/xml/shortcuts_chat.xml`). Theme → `meta theme-color` and
    `MorabaApp.theme` (status/navigation bars). Android notifications: «پاسخ» (RemoteInput) and «خوانده شد» →
    `ReplyReceiver` → `?mp_push_feed=1&reply=CH` (POST, header `X-MP-Push`) / `&read=CH`. A call also makes a
    notification (push) for the callee.
- Tests: `tests/README.md` — `tests/e2e/setup.sh` (throwaway WordPress + SQLite + sample data), `node tests/e2e/run.js`,
  `php tests/presence-test.php`; CI `.github/workflows/tests.yml` runs them and builds + verifies the signed EXE.
- Automatic attendance review: `attendance.stats` / `attendance.flags` (idle0, nobreak, night, device, browser) from
  MP_Presence::track; supervisors see «حضور خودکار نیازمند بررسی» and `POST attendance/{id}/review` sets `ok`.
- Automatic attendance (`class-mp-presence.php`, options `mp_presence_on` / `mp_presence_idle`, «حضور خودکار» in the
  attendance page for supervisors): sessions with `attendance.source = 'auto'` from first to last real input, closed at the last
  report when reports stop (sleep/shutdown), cut at midnight, merged across gaps < 2 min, < 1 min dropped; manual «خروج» pauses
  it for the day. Scenario test: `php tests/presence-test.php /tmp/wp/wp-load.php`.
- Widgets (profile menu → «ویجت‌ها روی صفحه اصلی», `assets/js/widgets.js`):
  - Android: `apps/android/` plain-Java app (no Gradle/AndroidX), four widgets (tasks card, attendance with live Chronometer, messages, next meeting).
    Build with `apps/android/build.sh` (needs SDK at `/opt/android`: platforms;android-34 + build-tools;35.0.0 — d8 34 crashes) → `assets/app/moraba.apk`.
    Signed with `apps/android/moraba.keystore` (keep it: a new key forces users to uninstall). Bump `versionCode` in its manifest on every app change.
    `apps/` is export-ignored, so the plugin zip ships only the APK.
  - Windows 11: manifest `widgets` + Adaptive Cards `assets/app/win-*.json`, driven by the service worker (cookie + `X-MP-Widget` header).
  - iPhone: Scriptable script `assets/app/moraba-ios.js` (panel fills in the API URL + device code).

## Local testing used so far
WordPress 6.6 + SQLite plugin in `/tmp/wp`, plugin symlinked into `wp-content/plugins/moraba-panel`, served with
`php -S localhost:8080 /tmp/router.php`; Playwright (`NODE_PATH=$(npm root -g) node script.js`) with
`--use-fake-device-for-media-stream` for meeting tests. These live outside the repo and must be recreated in a new environment.

## Android app (`apps/android`, output `assets/app/moraba.apk`)
- Plain Java, no Gradle/AndroidX. `MainActivity` = the app (WebView on the site's `/mp-app/` → `MP_App`: staff → panel, client → portal, one mobile+code login), `WidgetsActivity` = home-screen widgets, `NotifyJob` = notifications (polls `?mp_push_feed=1` / `?mp_client_feed=1` with the WebView's cookies), `Bridge` = `window.MorabaApp` (auto widget pairing, saveFile, openWidgets).
- Build: `apps/android/build.sh` (same keystore every time; bump `versionCode` in the manifest). Without an Android SDK (dl.google.com is blocked here): aapt2 from npm `aaptjs3` (bin/x64/linux/aapt2), `ANDROID_JAR` = Maven Central `org/robolectric/android-all/14-robolectric-10818077` jar, and apt `dalvik-exchange apksigner zipalign`:
  `AAPT2=…/aapt2 ANDROID_JAR=…/android-all.jar SITE=https://… apps/android/build.sh`
- No emulator here: the APK is checked with `aapt2 dump badging` + dexdump, the web side with a `MorabaApp` stub in Playwright.

## Conventions
- Font Dana: `MP_Frontend::font_style()` after app.css in every page loads it from the page's own address (path only), so www/non-www or the Windows app never fall back to Tahoma; `assets/fonts/.htaccess` adds CORS.
- UI text Persian; digits shown with `fa()` / `MP_Jalali::digits`; dates stored Gregorian, shown Jalali.
- varchar columns must fit their values (past bugs: files.context, contracts.status).
- Not testable here: real SMS, payment gateways, iOS/Android devices, real hosting speed, Windows widgets board.
  Android widgets were checked on an API 24 emulator (`-accel off`, no KVM) with a throwaway AppWidgetHost app.
