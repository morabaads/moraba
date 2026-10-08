# Tests

- `php tests/presence-test.php /path/to/wp-load.php` — automatic attendance scenarios (sleep, lock, idle, midnight,
  two computers, manual check-in/out, review flags…). Makes throwaway users and removes them again.
- `tests/e2e/setup.sh [dir] [port]` — a throwaway WordPress with SQLite (no MySQL) and this plugin, sample people
  (admin/admin manager, emp/emp, emp2/emp2) and a client chat, served with `php -S`.
  Offline: `WP_CORE_DIR=… SQLITE_DIR=… tests/e2e/setup.sh`.
- `node tests/e2e/run.js` (`MP_BASE=http://localhost:8080`) — browser tests with Playwright/Chromium (the engine of
  the Windows app's WebView2); the app itself is stood in for by a fake `window.chrome.webview`.
- The Windows host is checked under Wine with a stand-in WebView2Loader.dll (see CLAUDE.md); not part of CI.

CI: `.github/workflows/tests.yml` runs all of the above (except Wine) and builds + verifies the signed EXE.
