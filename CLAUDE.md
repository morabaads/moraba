# Moraba Panel (WordPress plugin `moraba-panel`)

Persian (RTL) staff panel «مربع آفیس» + client portal for a design studio. PHP 7.4+, vanilla JS, no build step.
Active branch: `claude/kind-wright-cxk6d0`. Reply to the owner in Persian; say plainly what was and wasn't tested.

## Release routine (every change)
1. Bump the version in `moraba-panel.php` (header `Version:` and `MP_VERSION`); bump `MP_DB_VERSION` when tables/columns change (`dbDelta` in `includes/class-mp-install.php` runs on upgrade).
2. Commit, push `git push -u origin claude/kind-wright-cxk6d0`.
3. Zip for the owner: `git archive HEAD` into a folder named `moraba-panel/`, then zip that folder (the owner installs it through WordPress).

## Layout
- `moraba-panel.php` — bootstrap, requires every class, registers REST routes (`moraba-panel/v1`).
- `includes/` — one class per area:
  - `class-mp-rest.php` tasks, projects, channels/messages, reminders; `class-mp-rest-work.php` files, attendance, leaves.
  - `class-mp-client.php` client groups/portal auth, `class-mp-portal.php` portal data (designs, pins, invoices…).
  - `class-mp-invoices.php` invoices + Zibal/ZarinPal, `class-mp-contracts.php` contracts (templates, two-party signing, PDF).
  - `class-mp-meet.php` video meetings (rooms, waiting room, invites, recording, minutes, stats, reminders),
    `class-mp-relay.php` + root `relay.php` media relay (no STUN/TURN needed; relay.php runs without WordPress).
  - `class-mp-backup.php` export/import, granular reset (`RESET_ITEMS`), factory reset.
  - `class-mp-widget.php` home-screen widgets API (`widget` GET summary / POST punch·done·undo, `widget/devices` pairing codes kept hashed in user meta `mp_widget_devices`).
  - `class-mp-install.php` schema, `class-mp-frontend.php` routes (`/panel`, `/c/{token}` portal, `/i/` invoice, `/k/` contract, `/m/` meeting).
- `templates/` — `panel.php` (staff app shell + views), `client.php` (portal), `meet.php` (meeting room), `contract.php`, `login.php`, `sprite.svg` (icons; element ids must not clash with symbol ids).
- `assets/js/` — `core.js` (MP.el, MP.api, MP.dialog, MP.field, MP.dateField (Jalali), MP.peoplePicker…), one file per view (`tasks.js`, `projects.js`, `messages.js`, `meetings.js`, …), `client.js` (portal), `meet.js` (meeting room: WebCodecs Opus/H.264/VP8 with μ-law/JPEG fallback, loopback echo cancellation, chat, design review, recording).
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

## Conventions
- UI text Persian; digits shown with `fa()` / `MP_Jalali::digits`; dates stored Gregorian, shown Jalali.
- varchar columns must fit their values (past bugs: files.context, contracts.status).
- Not testable here: real SMS, payment gateways, iOS/Android devices, real hosting speed, Windows widgets board.
  Android widgets were checked on an API 24 emulator (`-accel off`, no KVM) with a throwaway AppWidgetHost app.
