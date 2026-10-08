<?php
// php -S router for the test WordPress (setup.sh writes the folder in place of @WP@).
$p = parse_url( $_SERVER['REQUEST_URI'], PHP_URL_PATH );
$f = '@WP@' . $p;
if ( '/' !== $p && is_file( $f ) && '.php' !== substr( $f, -4 ) ) {
	return false;
}
if ( is_file( $f ) && '.php' === substr( $f, -4 ) ) {
	chdir( dirname( $f ) );
	require $f;
	return;
}
$_SERVER['SCRIPT_NAME'] = '/index.php';
chdir( '@WP@' );
require '@WP@/index.php';
