#!/usr/bin/env bash
# A throwaway WordPress (SQLite, no MySQL) with this plugin and some sample data, served on localhost for the
# browser tests:  tests/e2e/setup.sh [dir=/tmp/mpwp] [port=8080]
# Offline: WP_CORE_DIR=/path/to/wordpress SQLITE_DIR=/path/to/sqlite-database-integration tests/e2e/setup.sh
set -euo pipefail
WP=${1:-/tmp/mpwp}
PORT=${2:-8080}
REPO=$(cd "$(dirname "$0")/../.." && pwd)
rm -rf "$WP"
mkdir -p "$WP"
if [ -n "${WP_CORE_DIR:-}" ]; then
  (cd "$WP_CORE_DIR" && tar cf - --exclude=./wp-content --exclude=./wp-config.php .) | (cd "$WP" && tar xf -)
  mkdir -p "$WP/wp-content/plugins" "$WP/wp-content/themes"
  cp -r "$WP_CORE_DIR/wp-content/themes/." "$WP/wp-content/themes/" 2>/dev/null || true
else
  curl -fsSL https://wordpress.org/latest.tar.gz | tar xz -C "$WP" --strip-components=1
fi
if [ -n "${SQLITE_DIR:-}" ]; then
  cp -r "$SQLITE_DIR" "$WP/wp-content/plugins/sqlite-database-integration"
else
  curl -fsSL -o "$WP/sqlite.zip" https://downloads.wordpress.org/plugin/sqlite-database-integration.zip
  unzip -q "$WP/sqlite.zip" -d "$WP/wp-content/plugins" && rm "$WP/sqlite.zip"
fi
cp "$WP/wp-content/plugins/sqlite-database-integration/db.copy" "$WP/wp-content/db.php"
cp "$WP/wp-config-sample.php" "$WP/wp-config.php"
ln -s "$REPO" "$WP/wp-content/plugins/moraba-panel"
sed "s#@WP@#$WP#g" "$REPO/tests/e2e/router.php" > "$WP/router.php"
HOST="localhost:$PORT" php "$REPO/tests/e2e/install.php" "$WP"
pkill -f "php -S localhost:$PORT" 2>/dev/null || true
(cd "$WP" && PHP_CLI_SERVER_WORKERS=8 nohup php -S "localhost:$PORT" "$WP/router.php" > "$WP/server.log" 2>&1 &)
sleep 2
curl -fsS -o /dev/null "http://localhost:$PORT/chat/" && echo "WordPress with moraba-panel on http://localhost:$PORT (admin/admin, emp/emp, emp2/emp2)"
