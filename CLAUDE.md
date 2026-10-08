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
- UI text Persian; digits shown with `fa()` / `MP_Jalali::digits`; dates stored Gregorian, shown Jalali.
- varchar columns must fit their values (past bugs: files.context, contracts.status).
- Not testable here: real SMS, payment gateways, iOS/Android devices, real hosting speed, Windows widgets board.
  Android widgets were checked on an API 24 emulator (`-accel off`, no KVM) with a throwaway AppWidgetHost app.
