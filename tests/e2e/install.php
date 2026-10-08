<?php
// Installs the test WordPress, turns the plugin on and adds sample people and chats (setup.sh).
define( 'WP_INSTALLING', true );
$_SERVER['HTTP_HOST'] = getenv( 'HOST' ) ?: 'localhost:8080';
require $argv[1] . '/wp-load.php';
require ABSPATH . 'wp-admin/includes/upgrade.php';
require_once ABSPATH . 'wp-admin/includes/plugin.php';
wp_install( 'Test', 'admin', 'admin@example.com', true, '', 'admin' );
update_option( 'permalink_structure', '/%postname%/' );
$r = activate_plugin( 'moraba-panel/moraba-panel.php' );
if ( is_wp_error( $r ) ) {
	fwrite( STDERR, $r->get_error_message() . "\n" );
	exit( 1 );
}
flush_rewrite_rules();
foreach ( array( array( 'emp', 'سارا رضایی' ), array( 'emp2', 'علی محمدی' ) ) as $p ) {
	wp_insert_user( array( 'user_login' => $p[0], 'user_pass' => $p[0], 'display_name' => $p[1], 'user_email' => $p[0] . '@example.com', 'role' => 'moraba_employee' ) );
}
$emp = get_user_by( 'login', 'emp' );
wp_set_current_user( 1 );
function call( $m, $path, $b = array() ) {
	$r = new WP_REST_Request( $m, '/moraba-panel/v1/' . $path );
	foreach ( $b as $k => $v ) {
		$r->set_param( $k, $v );
	}
	return rest_do_request( $r )->get_data();
}
$list = call( 'POST', 'projects', array( 'name' => 'پروژه برندینگ', 'members' => array( 1, $emp->ID ) ) ); // answers with the project list
$proj = array( 'id' => 0 );
foreach ( ( isset( $list['projects'] ) ? $list['projects'] : $list ) as $p ) {
	$p = (array) $p;
	if ( isset( $p['name'] ) && 'پروژه برندینگ' === $p['name'] ) {
		$proj = $p;
	}
}
$ch   = call( 'POST', 'channels', array( 'type' => 'client', 'title' => 'گروه آقای احمدی', 'client_name' => 'آقای احمدی', 'project_id' => $proj['id'] ) );
call( 'POST', 'channels/' . $ch['id'] . '/messages', array( 'body' => 'سلام، طرح اولیه آماده است.' ) );
call( 'POST', 'channels/' . $ch['id'] . '/messages', array( 'body' => 'نمونه کارها: https://example.com' ) );
wp_set_current_user( $emp->ID );
call( 'POST', 'channels/' . $ch['id'] . '/messages', array( 'body' => 'ممنون، بررسی می‌کنم.' ) );
echo "installed; client chat #{$ch['id']}\n";
