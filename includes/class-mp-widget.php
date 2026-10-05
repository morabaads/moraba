<?php
defined( 'ABSPATH' ) || exit;

/**
 * Home-screen widgets: the Android app and the Windows (Edge PWA) widgets read one summary — attendance,
 * the dashboard's tasks card (today / week / overdue), unread conversations, the next meeting — and can
 * punch in/out or tick a task. The Android app signs in with a per-device code made in the panel
 * (X-MP-Widget-Token); the Windows widgets run in the panel's own service worker and use the session cookie
 * with an X-MP-Widget header, which a cross-site page cannot send.
 */
class MP_Widget {

	const META = 'mp_widget_devices';
	const MAX  = 30; // tasks per tab

	public static function register() {
		$auth = array( __CLASS__, 'auth' );
		register_rest_route( 'moraba-panel/v1', '/widget', array(
			array( 'methods' => 'GET', 'callback' => array( __CLASS__, 'data' ), 'permission_callback' => $auth ),
			array( 'methods' => 'POST', 'callback' => array( __CLASS__, 'act' ), 'permission_callback' => $auth ),
		) );
		register_rest_route( 'moraba-panel/v1', '/widget/devices', array(
			array( 'methods' => 'GET', 'callback' => array( __CLASS__, 'devices' ), 'permission_callback' => array( 'MP_Rest', 'can_access' ) ),
			array( 'methods' => 'POST', 'callback' => array( __CLASS__, 'pair' ), 'permission_callback' => array( 'MP_Rest', 'can_access' ) ),
		) );
		register_rest_route( 'moraba-panel/v1', '/widget/devices/(?P<id>[a-f0-9]{8})', array(
			'methods'             => 'DELETE',
			'callback'            => array( __CLASS__, 'unpair' ),
			'permission_callback' => array( 'MP_Rest', 'can_access' ),
		) );
	}

	/* ------------------------------------------------------------------ Auth */

	private static function header( $name ) {
		$key = 'HTTP_' . strtoupper( str_replace( '-', '_', $name ) );
		return isset( $_SERVER[ $key ] ) ? trim( wp_unslash( $_SERVER[ $key ] ) ) : ''; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
	}

	private static function hash( $secret ) {
		return hash_hmac( 'sha256', $secret, wp_salt( 'auth' ) );
	}

	/** User id for a device code «uid.id.secret», or 0. */
	public static function check( $token ) {
		if ( ! preg_match( '/^(\d+)\.([a-f0-9]{8})\.([A-Za-z0-9]{32})$/', $token, $m ) ) {
			return 0;
		}
		$list = self::list_for( (int) $m[1] );
		if ( ! isset( $list[ $m[2] ] ) || ! hash_equals( $list[ $m[2] ]['hash'], self::hash( $m[3] ) ) ) {
			return 0;
		}
		if ( time() - (int) $list[ $m[2] ]['used'] > 300 ) { // write at most every 5 minutes
			$list[ $m[2] ]['used'] = time();
			update_user_meta( (int) $m[1], self::META, $list );
		}
		return (int) $m[1];
	}

	public static function auth() {
		$token = self::header( 'X-MP-Widget-Token' );
		if ( '' === $token && preg_match( '/^Bearer\s+(\S+)$/', self::header( 'Authorization' ), $m ) ) {
			$token = $m[1];
		}
		$uid = 0;
		if ( '' !== $token ) {
			$uid = self::check( $token );
			if ( ! $uid ) {
				return new WP_Error( 'mp_widget_token', 'کد اتصال این دستگاه معتبر نیست؛ از پنل دوباره وصل کنید.', array( 'status' => 401 ) );
			}
		} elseif ( '1' === self::header( 'X-MP-Widget' ) && self::same_origin() ) {
			$uid = (int) wp_validate_auth_cookie( '', 'logged_in' );
		} elseif ( is_user_logged_in() ) {
			$uid = get_current_user_id(); // the panel itself (nonce checked by WordPress)
		}
		if ( ! $uid || ! user_can( $uid, 'mp_access_panel' ) ) {
			return new WP_Error( 'mp_widget_auth', 'وارد پنل نشده‌اید.', array( 'status' => 401 ) );
		}
		wp_set_current_user( $uid );
		return true;
	}

	private static function same_origin() {
		$origin = self::header( 'Origin' );
		return '' === $origin || wp_parse_url( $origin, PHP_URL_HOST ) === wp_parse_url( home_url(), PHP_URL_HOST );
	}

	/* ------------------------------------------------------------------ Devices */

	private static function list_for( $uid ) {
		$l = get_user_meta( $uid, self::META, true );
		return is_array( $l ) ? $l : array();
	}

	public static function devices() {
		$out = array();
		foreach ( self::list_for( get_current_user_id() ) as $id => $d ) {
			$out[] = array(
				'id'      => $id,
				'label'   => $d['label'],
				'created' => MP_Jalali::format( wp_date( 'Y-m-d', $d['created'] ) ),
				'used'    => $d['used'] ? MP_Jalali::format( wp_date( 'Y-m-d', $d['used'] ) ) . '، ' . MP_Jalali::digits( wp_date( 'H:i', $d['used'] ) ) : '',
			);
		}
		return array_reverse( $out );
	}

	/** POST widget/devices {label} → a new device code (shown once) and the link that opens the app with it. */
	public static function pair( WP_REST_Request $r ) {
		$uid  = get_current_user_id();
		$list = self::list_for( $uid );
		if ( count( $list ) >= 10 ) {
			return new WP_Error( 'mp_error', 'حداکثر ۱۰ دستگاه؛ یکی از دستگاه‌های قبلی را حذف کنید.', array( 'status' => 400 ) );
		}
		$id            = bin2hex( random_bytes( 4 ) );
		$secret        = wp_generate_password( 32, false, false );
		$label         = MP_Util::text( $r['label'], 60 );
		$list[ $id ]   = array( 'hash' => self::hash( $secret ), 'label' => '' !== $label ? $label : 'گوشی', 'created' => time(), 'used' => 0 );
		update_user_meta( $uid, self::META, $list );
		$token = $uid . '.' . $id . '.' . $secret;
		$api   = rest_url( 'moraba-panel/v1/widget' );
		MP_Audit::log( 'create', 'widget', 0, 'اتصال دستگاه «' . $list[ $id ]['label'] . '» به ویجت' );
		return array(
			'token' => $token,
			'api'   => $api,
			// One string to paste in the app; the link opens the app directly on the same phone.
			'code'  => rtrim( strtr( base64_encode( wp_json_encode( array( 'a' => $api, 't' => $token, 'n' => get_bloginfo( 'name' ) ), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES ) ), '+/', '-_' ), '=' ),
			'link'  => 'moraba://pair?api=' . rawurlencode( $api ) . '&token=' . rawurlencode( $token ) . '&name=' . rawurlencode( get_bloginfo( 'name' ) ),
			'list'  => self::devices(),
		);
	}

	public static function unpair( WP_REST_Request $r ) {
		$uid  = get_current_user_id();
		$list = self::list_for( $uid );
		unset( $list[ (string) $r['id'] ] );
		update_user_meta( $uid, self::META, $list );
		return self::devices();
	}

	/* ------------------------------------------------------------------ Data */

	public static function data() {
		global $wpdb;
		$uid   = get_current_user_id();
		$today = MP_Util::today();
		$panel = MP_Frontend::panel_url();
		update_user_meta( $uid, 'mp_last_seen', time() );

		$att = MP_Rest_Work::list_attendance( new WP_REST_Request( 'GET' ) );

		return array(
			'ok'         => true,
			'site'       => get_bloginfo( 'name' ),
			'user'       => wp_get_current_user()->display_name,
			'today'      => $today,
			'today_fa'   => self::weekday( $today ) . ' ' . self::short_date( $today ),
			'now'        => current_time( 'H:i:s' ),
			'attendance' => array(
				'open'     => (bool) $att['open'],
				'since'    => $att['open'] ? MP_Jalali::digits( $att['open']['check_in'] ) : '',
				'seconds'  => (int) $att['today'],
				'worked'   => self::duration( (int) $att['today'] ),
			),
			'tasks'      => self::tasks( $uid, $today ),
			'messages'   => self::messages(),
			'meeting'    => self::next_meeting( $today ),
			'urls'       => array(
				'panel'      => $panel,
				'tasks'      => $panel . '#mytasks',
				'new_task'   => $panel . '#new-task',
				'messages'   => $panel . '#messages',
				'meetings'   => $panel . '#meetings',
				'attendance' => $panel . '#attendance',
				'task'       => $panel . '#task-',
			),
		);
	}

	private static function weekday( $iso ) {
		return MP_Jalali::WEEKDAYS[ ( (int) gmdate( 'w', strtotime( $iso . ' 12:00 UTC' ) ) + 1 ) % 7 ];
	}

	/** '۱۰ مهر' */
	private static function short_date( $iso ) {
		list( , $jm, $jd ) = MP_Jalali::from_iso( $iso );
		return MP_Jalali::digits( $jd ) . ' ' . MP_Jalali::MONTHS[ $jm - 1 ];
	}

	private static function duration( $sec ) {
		$h = intdiv( $sec, 3600 );
		$m = intdiv( $sec % 3600, 60 );
		return $h ? MP_Jalali::digits( $h ) . ' ساعت' . ( $m ? ' و ' . MP_Jalali::digits( $m ) . ' دقیقه' : '' ) : MP_Jalali::digits( $m ) . ' دقیقه';
	}

	/** The dashboard's tasks card: the same three tabs, order and row details. */
	private static function tasks( $uid, $today ) {
		global $wpdb;
		$ws   = gmdate( 'Y-m-d', strtotime( $today . ' UTC -' . ( ( (int) gmdate( 'w', strtotime( $today . ' UTC' ) ) + 1 ) % 7 ) . ' days' ) );
		$we   = gmdate( 'Y-m-d', strtotime( $ws . ' UTC +6 days' ) );
		$rows = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . MP_Install::table( 'tasks' ) . " WHERE archived_at IS NULL AND user_id = %d AND ( task_date BETWEEN %s AND %s OR ( task_date < %s AND status <> 'done' ) ) ORDER BY task_date, task_time = '', task_time, id LIMIT 500", $uid, min( $ws, $today ), max( $we, $today ), $today ) );
		$all  = MP_Rest::payloads( $rows );

		$pids     = array_unique( array_filter( wp_list_pluck( $all, 'project_id' ) ) );
		$sids     = array_unique( array_filter( wp_list_pluck( $all, 'section_id' ) ) );
		$projects = $pids ? wp_list_pluck( $wpdb->get_results( 'SELECT id, name FROM ' . MP_Install::table( 'projects' ) . ' WHERE id IN (' . implode( ',', array_map( 'intval', $pids ) ) . ')' ), 'name', 'id' ) : array(); // phpcs:ignore
		$sections = $sids ? wp_list_pluck( $wpdb->get_results( 'SELECT id, title FROM ' . MP_Install::table( 'sections' ) . ' WHERE id IN (' . implode( ',', array_map( 'intval', $sids ) ) . ')' ), 'title', 'id' ) : array(); // phpcs:ignore

		$tabs = array( 'today' => array(), 'week' => array(), 'overdue' => array() );
		foreach ( $all as $t ) {
			if ( $t['date'] === $today ) {
				$tabs['today'][] = $t;
			}
			if ( $t['date'] >= $ws && $t['date'] <= $we ) {
				$tabs['week'][] = $t;
			}
			if ( ! $t['done'] && $t['date'] < $today ) {
				$tabs['overdue'][] = $t;
			}
		}
		$out = array();
		foreach ( $tabs as $tab => $list ) {
			usort( $list, function ( $a, $b ) {
				return ( (int) $a['done'] - (int) $b['done'] ) ?: strcmp( $a['date'] . ( $a['time'] ? $a['time'] : '99' ), $b['date'] . ( $b['time'] ? $b['time'] : '99' ) );
			} );
			$open        = count( array_filter( $list, function ( $t ) { return ! $t['done']; } ) );
			$out[ $tab ] = array(
				'count' => count( $list ),
				'open'  => $open,
				'items' => array_map( function ( $t ) use ( $today, $tab, $projects, $sections, $uid ) {
					$overdue = ! $t['done'] && $t['date'] < $today;
					$p       = isset( $projects[ $t['project_id'] ] ) ? $projects[ $t['project_id'] ] : '';
					$s       = isset( $sections[ $t['section_id'] ] ) ? $sections[ $t['section_id'] ] : '';
					return array(
						'id'      => $t['id'],
						'title'   => $t['title'],
						'done'    => $t['done'],
						'doing'   => 'doing' === $t['status'],
						'can'     => $t['can_status'],
						'locked'  => 'manager' === $t['source'],
						'new'     => 'manager' === $t['source'] && ! $t['seen_at'] && $t['user_id'] === $uid,
						'urgent'  => 'high' === $t['priority'],
						'overdue' => $overdue,
						// The dashboard shows the date on the week and overdue tabs only.
						'due'     => 'today' === $tab ? '' : self::short_date( $t['date'] ) . ( $overdue ? ' · عقب‌افتاده' : '' ),
						'time'    => $t['time'] ? MP_Jalali::digits( $t['time'] ) : '',
						'project' => $p ? $p . ( $s ? ' ، ' . $s : '' ) : '',
						'items'   => $t['items_total'] ? MP_Jalali::digits( $t['items_done'] . '/' . $t['items_total'] ) : '',
					);
				}, array_slice( $list, 0, self::MAX ) ),
			);
		}
		return $out;
	}

	private static function messages() {
		$list  = MP_Rest::list_channels();
		$un    = array_values( array_filter( $list, function ( $c ) { return $c['unread'] > 0; } ) );
		usort( $un, function ( $a, $b ) { return ( $b['last'] ? $b['last']['id'] : 0 ) - ( $a['last'] ? $a['last']['id'] : 0 ); } );
		$total = array_sum( wp_list_pluck( $list, 'unread' ) );
		return array(
			'unread' => $total,
			'items'  => array_map( function ( $c ) {
				$l = $c['last'];
				return array(
					'id'     => $c['id'],
					'title'  => $c['title'],
					'unread' => MP_Jalali::digits( $c['unread'] ),
					'text'   => $l ? $l['author'] . ': ' . ( '' !== trim( (string) $l['body'] ) ? wp_strip_all_tags( mb_substr( $l['body'], 0, 90 ) ) : 'فایل یا ویس' ) : '',
					'time'   => $l && ! empty( $l['created_at'] ) ? MP_Jalali::digits( substr( $l['created_at'], 11, 5 ) ) : '',
				);
			}, array_slice( $un, 0, 5 ) ),
		);
	}

	private static function next_meeting( $today ) {
		$req = new WP_REST_Request( 'GET' );
		$req->set_param( 'from', $today );
		$req->set_param( 'to', gmdate( 'Y-m-d', strtotime( $today . ' UTC +14 days' ) ) );
		$req->set_param( 'mine', 1 );
		$list = MP_Meet::index( $req );
		if ( is_wp_error( $list ) ) {
			return null;
		}
		$now  = current_time( 'H:i' );
		$best = null;
		foreach ( $list as $m ) {
			if ( ! empty( $m['permanent'] ) || 'ended' === $m['status'] ) {
				continue;
			}
			$live = 'live' === $m['status'] && $m['date'] === $today;
			if ( ! $live && ( $m['date'] < $today || ( $m['date'] === $today && substr( (string) $m['time'], 0, 5 ) < $now ) ) ) {
				continue;
			}
			$key = ( $live ? '0' : '1' ) . $m['date'] . $m['time'];
			if ( ! $best || $key < $best[0] ) {
				$best = array( $key, $m, $live );
			}
		}
		if ( ! $best ) {
			return null;
		}
		list( , $m, $live ) = $best;
		$tomorrow = gmdate( 'Y-m-d', strtotime( $today . ' UTC +1 day' ) );
		$day      = $m['date'] === $today ? 'امروز' : ( $m['date'] === $tomorrow ? 'فردا' : self::weekday( $m['date'] ) . ' ' . self::short_date( $m['date'] ) );
		return array(
			'title' => $m['title'],
			'when'  => $live ? 'در حال برگزاری' : $day . ( $m['time'] ? ' ساعت ' . MP_Jalali::digits( substr( $m['time'], 0, 5 ) ) : '' ),
			'live'  => $live,
			'url'   => $m['url'] ? $m['url'] : $m['link'],
			'with'  => $m['channel'],
		);
	}

	/* ------------------------------------------------------------------ Actions */

	/** POST widget {action: punch|in|out|done|undo, id} → the fresh summary. */
	public static function act( WP_REST_Request $r ) {
		$action = (string) $r['action'];
		if ( in_array( $action, array( 'punch', 'in', 'out' ), true ) ) {
			if ( 'punch' === $action ) {
				$att    = MP_Rest_Work::list_attendance( new WP_REST_Request( 'GET' ) );
				$action = $att['open'] ? 'out' : 'in';
			}
			$req = new WP_REST_Request( 'POST' );
			$req->set_param( 'action', $action );
			$res = MP_Rest_Work::punch( $req );
		} elseif ( in_array( $action, array( 'done', 'undo' ), true ) ) {
			$req = new WP_REST_Request( 'POST' );
			$req->set_param( 'id', (int) $r['id'] );
			$req->set_param( 'status', 'done' === $action ? 'done' : 'todo' );
			$res = MP_Rest::update_task( $req );
		} else {
			return new WP_Error( 'mp_error', 'عملیات معتبر نیست.', array( 'status' => 400 ) );
		}
		if ( is_wp_error( $res ) ) {
			return $res;
		}
		$out           = self::data();
		$out['toast']  = 'in' === $action ? 'ورود ثبت شد' : ( 'out' === $action ? 'خروج ثبت شد' : ( 'done' === $action ? 'تسک انجام شد' : 'تسک برگشت' ) );
		return $out;
	}
}
