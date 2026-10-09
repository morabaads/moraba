<?php
defined( 'ABSPATH' ) || exit;

/**
 * Errors from people's browsers and apps, so problems are seen without anyone reporting them:
 * POST client-errors {msg, src, line, page, app} (any signed-in person, at most a few per page), kept as the last
 * 100 in option mp_js_errors (grouped: the same error from many people counts up instead of repeating);
 * GET client-errors / DELETE client-errors for supervisors (settings → advanced → «خطاهای برنامه»).
 */
class MP_Diag {

	public static function register() {
		register_rest_route(
			MP_Rest::NS,
			'/client-errors',
			array(
				array( 'methods' => 'POST', 'callback' => array( __CLASS__, 'add' ), 'permission_callback' => array( 'MP_Rest', 'can_access' ) ),
				array( 'methods' => 'GET', 'callback' => array( __CLASS__, 'list_all' ), 'permission_callback' => array( 'MP_Rest', 'can_manage' ) ),
				array( 'methods' => 'DELETE', 'callback' => array( __CLASS__, 'clear' ), 'permission_callback' => array( 'MP_Rest', 'can_manage' ) ),
			)
		);
	}

	public static function add( WP_REST_Request $r ) {
		$msg = MP_Util::text( (string) $r['msg'], 300 );
		if ( '' === $msg ) {
			return array( 'ok' => false );
		}
		$src  = MP_Util::text( (string) $r['src'], 200 );
		$line = (int) $r['line'];
		$key  = md5( $msg . '|' . preg_replace( '/\?.*$/', '', $src ) . '|' . $line );
		$all  = get_option( 'mp_js_errors', array() );
		$all  = is_array( $all ) ? $all : array();
		$uid  = get_current_user_id();
		if ( isset( $all[ $key ] ) ) {
			$all[ $key ]['n']++;
			$all[ $key ]['last'] = MP_Util::now();
			$all[ $key ]['users'] = array_values( array_unique( array_merge( $all[ $key ]['users'], array( $uid ) ) ) );
		} else {
			$all[ $key ] = array(
				'msg'   => $msg,
				'src'   => $src,
				'line'  => $line,
				'page'  => MP_Util::text( (string) $r['page'], 120 ),
				'app'   => MP_Util::text( (string) $r['app'], 40 ),
				'ua'    => MP_Util::text( isset( $_SERVER['HTTP_USER_AGENT'] ) ? (string) $_SERVER['HTTP_USER_AGENT'] : '', 160 ), // phpcs:ignore
				'ver'   => MP_VERSION,
				'first' => MP_Util::now(),
				'last'  => MP_Util::now(),
				'n'     => 1,
				'users' => array( $uid ),
			);
		}
		uasort( $all, function ( $a, $b ) { return strcmp( $b['last'], $a['last'] ); } );
		update_option( 'mp_js_errors', array_slice( $all, 0, 100, true ), false );
		return array( 'ok' => true );
	}

	public static function list_all() {
		$all = get_option( 'mp_js_errors', array() );
		$out = array();
		foreach ( is_array( $all ) ? $all : array() as $e ) {
			$names = array();
			foreach ( array_slice( $e['users'], 0, 5 ) as $u ) {
				$d       = get_userdata( $u );
				$names[] = $d ? $d->display_name : '#' . $u;
			}
			$out[] = array_merge( $e, array( 'users' => $names, 'people' => count( $e['users'] ) ) );
		}
		return $out;
	}

	public static function clear() {
		delete_option( 'mp_js_errors' );
		return array( 'ok' => true );
	}
}
