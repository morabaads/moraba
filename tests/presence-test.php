<?php
/**
 * Scenario tests for automatic attendance (MP_Presence). Run against a test WordPress with the plugin active:
 *   php tests/presence-test.php /path/to/wp-load.php
 * Each scenario plays reports minute by minute on a simulated clock and checks the attendance rows.
 */
$_SERVER['HTTP_HOST'] = $_SERVER['HTTP_HOST'] ?? 'localhost';
require $argv[1] ?? '/tmp/wp/wp-load.php';
global $wpdb;
$T = $wpdb->prefix . 'mp_attendance';
$fail = 0;
$pass = 0;
$uid  = 0;

function fresh_user() {
	global $uid, $wpdb, $T;
	$login = 'presence_' . wp_generate_password( 6, false, false );
	$uid   = wp_insert_user( array( 'user_login' => $login, 'user_pass' => wp_generate_password(), 'role' => 'moraba_employee' ) );
	update_option( 'mp_presence_on', 1 );
	update_option( 'mp_presence_idle', 5 );
	return $uid;
}
function at( $hm, $day = '2030-03-10' ) { return strtotime( "$day $hm:00" ); }
function rows() { global $wpdb, $T, $uid; return $wpdb->get_results( $wpdb->prepare( "SELECT work_date, check_in, check_out, source FROM $T WHERE user_id = %d ORDER BY check_in", $uid ) ); }
function sig() { return implode( ' | ', array_map( function ( $r ) { return substr( $r->check_in, 5, 11 ) . '→' . ( $r->check_out ? substr( $r->check_out, 5, 11 ) : 'open' ); }, rows() ) ); }
function check( $name, $want ) {
	global $fail, $pass;
	$got = sig();
	if ( $got === $want ) { $pass++; echo "  ok   $name\n"; }
	else { $fail++; echo "  FAIL $name\n       want: $want\n       got:  $got\n"; }
}
/** Reports every minute from $from to $to (inclusive); $idle(ts) gives the idle seconds at each minute. */
function play( $from, $to, $idle = null, $device = 'pc1', $busy = false ) {
	global $uid;
	for ( $t = $from; $t <= $to; $t += 60 ) {
		MP_Presence::beat( $uid, $device, $idle ? (int) $idle( $t ) : 0, false, $busy, 'tick', $t );
	}
}

echo "1. a working morning\n";
fresh_user();
play( at( '09:00' ), at( '12:00' ) );
check( 'one open session from 09:00', '03-10 09:00→open' );

echo "2. idle: the session ends at the last input, idle minutes do not count\n";
// last input 12:00; reports go on with growing idle until 12:10
play( at( '12:01' ), at( '12:10' ), function ( $t ) { return $t - at( '12:00' ); } );
check( 'closed at 12:00', '03-10 09:00→03-10 12:00' );

echo "3. back after lunch: a new session\n";
play( at( '13:00' ), at( '14:00' ) );
check( 'second session 13:00', '03-10 09:00→03-10 12:00 | 03-10 13:00→open' );

echo "4. sleep / shutdown: reports stop at 14:30, next report 16:00\n";
play( at( '14:01' ), at( '14:30' ) );
play( at( '16:00' ), at( '16:05' ) );
check( 'closed at the last report, new at 16:00', '03-10 09:00→03-10 12:00 | 03-10 13:00→03-10 14:30 | 03-10 16:00→open' );

echo "5. lock at 17:00 (last input 16:59:30)\n";
play( at( '16:06' ), at( '16:59' ) );
MP_Presence::beat( $uid, 'pc1', 30, true, false, 'lock', at( '17:00' ) );
check( 'closed at 16:59:30', '03-10 09:00→03-10 12:00 | 03-10 13:00→03-10 14:30 | 03-10 16:00→03-10 16:59' );

echo "6. the sweep: no reports at all after 18:02, listing at 19:00\n";
fresh_user();
play( at( '18:00' ), at( '18:02' ) );
MP_Presence::sweep( at( '19:00' ) );
check( 'ended at the last report', '03-10 18:00→03-10 18:02' );

echo "7. two computers: one idle, one busy, then both idle\n";
fresh_user();
for ( $t = at( '09:00' ); $t <= at( '10:00' ); $t += 60 ) {
	MP_Presence::beat( $uid, 'laptop', 0, false, false, 'tick', $t );
	MP_Presence::beat( $uid, 'desktop', 3600, false, false, 'tick', $t ); // untouched all along
}
check( 'open while the laptop is used', '03-10 09:00→open' );
for ( $t = at( '10:01' ); $t <= at( '10:20' ); $t += 60 ) {
	MP_Presence::beat( $uid, 'laptop', $t - at( '10:00' ), false, false, 'tick', $t );
	MP_Presence::beat( $uid, 'desktop', max( 0, $t - at( '10:10' ) ), false, false, 'tick', $t );
}
// from 10:00 the laptop is left alone; the desktop is used until 10:10, then left too
check( 'ends at the latest input on any device (10:10)', '03-10 09:00→03-10 10:10' );

echo "8. midnight\n";
fresh_user();
for ( $t = strtotime( '2030-03-10 23:50:00' ); $t <= strtotime( '2030-03-11 00:10:00' ); $t += 60 ) {
	MP_Presence::beat( $uid, 'pc1', 0, false, false, 'tick', $t );
}
check( 'split at midnight', '03-10 23:50→03-10 23:59 | 03-11 00:00→open' );

echo "9. a call / meeting keeps it going without keyboard input\n";
fresh_user();
play( at( '10:00' ), at( '11:00' ), function ( $t ) { return $t - at( '10:00' ); }, 'pc1', true );
check( 'still open at 11:00', '03-10 10:00→open' );

echo "10. a short network gap (90 s) does not split\n";
fresh_user();
play( at( '09:00' ), at( '09:30' ) );
MP_Presence::beat( $uid, 'pc1', 0, false, false, 'tick', at( '09:30' ) + 150 );
play( at( '09:33' ), at( '09:40' ) );
check( 'one session', '03-10 09:00→open' );

echo "11. a break under two minutes merges with the session before\n";
fresh_user();
play( at( '09:00' ), at( '09:20' ) );
MP_Presence::beat( $uid, 'pc1', 0, true, false, 'lock', at( '09:20' ) + 30 );
MP_Presence::beat( $uid, 'pc1', 0, false, false, 'unlock', at( '09:21' ) + 30 );
play( at( '09:22' ), at( '09:30' ) );
check( 'carried on', '03-10 09:00→open' );

echo "12. a mouse bump under a minute is not a session\n";
fresh_user();
MP_Presence::beat( $uid, 'pc1', 0, false, false, 'tick', at( '20:00' ) );
MP_Presence::beat( $uid, 'pc1', 0, true, false, 'lock', at( '20:00' ) + 20 );
check( 'nothing kept', '' );

echo "13. manual check-out pauses automatic attendance for the day; manual check-in takes over\n";
fresh_user();
wp_set_current_user( $uid );
$day = gmdate( 'Y-m-d', strtotime( MP_Util::now() ) );
$now = strtotime( MP_Util::now() );
MP_Presence::beat( $uid, 'pc1', 0, false, false, 'tick', $now - 600 );
MP_Presence::beat( $uid, 'pc1', 0, false, false, 'tick', $now - 540 );
$out = new WP_REST_Request( 'POST' ); $out->set_param( 'action', 'out' ); MP_Rest_Work::punch( $out );
MP_Presence::beat( $uid, 'pc1', 0, false, false, 'tick', $now + 60 );
$n = count( array_filter( rows(), function ( $r ) { return ! $r->check_out; } ) );
if ( 0 === $n ) { $pass++; echo "  ok   no new session after «خروج»\n"; } else { $fail++; echo "  FAIL a session opened after manual check-out\n"; }
$in = new WP_REST_Request( 'POST' ); $in->set_param( 'action', 'in' ); MP_Rest_Work::punch( $in );
$st = MP_Presence::beat( $uid, 'pc1', 0, false, false, 'tick', $now + 120 );
$open = array_values( array_filter( rows(), function ( $r ) { return ! $r->check_out; } ) );
if ( 1 === count( $open ) && 'manual' === $open[0]->source && ! empty( $st['manual'] ) ) { $pass++; echo "  ok   manual check-in is left alone\n"; } else { $fail++; echo "  FAIL manual session: " . sig() . "\n"; }

echo "14. switched off by the manager\n";
fresh_user();
update_option( 'mp_presence_on', 0 );
play( at( '09:00' ), at( '09:10' ) );
check( 'no sessions', '' );
update_option( 'mp_presence_on', 1 );

echo "15. sleep then wake: the wake report starts fresh, not from the sleep\n";
fresh_user();
play( at( '09:00' ), at( '10:00' ) );
MP_Presence::beat( $uid, 'pc1', 5, false, false, 'sleep', at( '10:00' ) + 20 );
MP_Presence::beat( $uid, 'pc1', 0, false, false, 'wake', at( '11:30' ) );
play( at( '11:31' ), at( '11:40' ) );
check( 'two sessions', '03-10 09:00→03-10 10:00 | 03-10 11:30→open' );

echo "\n$pass passed, $fail failed\n";
exit( $fail ? 1 : 0 );
