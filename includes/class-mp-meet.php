<?php
/**
 * Video meetings: scheduled meetings with their own link (/m/{token}/), a waiting room, an optional
 * password and time limit, and a built-in WebRTC room (a mesh of peers; signalling goes through REST
 * polling, so nothing but this plugin and the browsers is needed).
 *
 * - Hosts: the organiser and every supervisor. They admit or turn away people in the waiting room,
 *   mute or remove participants and end the meeting for everyone.
 * - Colleagues (panel users) join with their account; outside guests type a name (and the password).
 * - Who joined, when and for how long is kept for the meeting's history.
 */
defined( 'ABSPATH' ) || exit;

class MP_Meet {

	const SETTINGS = 'mp_meet_settings';
	const STALE    = 25; // seconds without a poll before a peer counts as gone

	public static function register() {
		$auth = array( 'MP_Rest', 'can_access' );
		$m    = array( 'MP_Rest', 'can_manage' );
		$id   = '(?P<id>\d+)';
		$tok  = 'room/(?P<token>[A-Za-z0-9]{32})';
		$routes = array(
			array( 'meetings', 'GET', 'index', $auth ),
			array( 'meetings', 'POST', 'save', $auth ),
			array( "meetings/$id", 'GET', 'show', $auth ),
			array( "meetings/$id", 'POST', 'save', $auth ),
			array( "meetings/$id", 'DELETE', 'remove', $auth ),
			array( "meetings/$id/end", 'POST', 'end_meeting', $auth ),
			array( 'meetings/settings', 'GET', 'get_settings', $auth ),
			array( 'meetings/settings', 'POST', 'save_settings', $m ),
			array( $tok, 'GET', 'room_info', '__return_true' ),
			array( "$tok/join", 'POST', 'room_join', '__return_true' ),
			array( "$tok/poll", 'POST', 'room_poll', '__return_true' ),
			array( "$tok/signal", 'POST', 'room_signal', '__return_true' ),
			array( "$tok/state", 'POST', 'room_state', '__return_true' ),
			array( "$tok/admit", 'POST', 'room_admit', '__return_true' ),
			array( "$tok/kick", 'POST', 'room_kick', '__return_true' ),
			array( "$tok/leave", 'POST', 'room_leave', '__return_true' ),
			array( "$tok/end", 'POST', 'room_end', '__return_true' ),
		);
		foreach ( $routes as $r ) {
			register_rest_route( MP_Rest::NS, '/' . $r[0], array( 'methods' => $r[1], 'callback' => array( __CLASS__, $r[2] ), 'permission_callback' => $r[3] ) );
		}
	}

	private static function t( $n = 'meetings' ) {
		return MP_Install::table( $n );
	}

	private static function err( $m, $s = 400 ) {
		return new WP_Error( 'mp_error', $m, array( 'status' => $s ) );
	}

	private static function ts( $dt = null ) {
		return strtotime( null === $dt ? MP_Util::now() : $dt );
	}

	/** Older meetings get a link of their own. */
	public static function migrate() {
		global $wpdb;
		foreach ( $wpdb->get_col( 'SELECT id FROM ' . self::t() . " WHERE token = ''" ) as $id ) { // phpcs:ignore
			$wpdb->update( self::t(), array( 'token' => wp_generate_password( 32, false, false ) ), array( 'id' => $id ) );
		}
	}

	/* ------------------------------------------------------------------ Settings */

	public static function settings() {
		$s = get_option( self::SETTINGS, array() );
		return wp_parse_args(
			is_array( $s ) ? $s : array(),
			array(
				'stun'      => 'stun:stun.l.google.com:19302 stun:stun.cloudflare.com:3478 stun:stun.nextcloud.com:443',
				'turn_url'  => '',
				'turn_user' => '',
				'turn_pass' => '',
				'duration'  => 60,
				'waiting'   => 'guests',
			)
		);
	}

	public static function get_settings() {
		$s = self::settings();
		if ( ! MP_Util::is_manager() ) {
			unset( $s['turn_user'], $s['turn_pass'] );
		}
		return $s;
	}

	public static function save_settings( WP_REST_Request $r ) {
		$s = self::settings();
		foreach ( array( 'stun', 'turn_url', 'turn_user', 'turn_pass' ) as $k ) {
			if ( null !== $r[ $k ] ) {
				$s[ $k ] = MP_Util::text( $r[ $k ], 300 );
			}
		}
		if ( null !== $r['duration'] ) {
			$s['duration'] = max( 0, min( 600, (int) $r['duration'] ) );
		}
		if ( null !== $r['waiting'] ) {
			$s['waiting'] = MP_Util::pick( $r['waiting'], array( 'off', 'guests', 'all' ), 'guests' );
		}
		update_option( self::SETTINGS, $s, false );
		return $s;
	}

	/** ICE servers for the room page. */
	private static function ice() {
		$s   = self::settings();
		$out = array();
		foreach ( preg_split( '/[\s,]+/', (string) $s['stun'] ) as $u ) {
			if ( $u ) {
				$out[] = array( 'urls' => $u );
			}
		}
		if ( $s['turn_url'] ) {
			$out[] = array( 'urls' => preg_split( '/[\s,]+/', $s['turn_url'] ), 'username' => $s['turn_user'], 'credential' => $s['turn_pass'] );
		}
		return $out;
	}

	/* ------------------------------------------------------------------ Meetings (panel) */

	public static function link( $token ) {
		return get_option( 'permalink_structure' ) ? home_url( '/m/' . $token . '/' ) : add_query_arg( 'mp_meet', $token, home_url( '/' ) );
	}

	public static function get( $id ) {
		global $wpdb;
		return $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t() . ' WHERE id = %d', $id ) );
	}

	public static function by_token( $token ) {
		global $wpdb;
		return $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t() . ' WHERE token = %s', $token ) );
	}

	private static function people( $mid ) {
		global $wpdb;
		return array_map( 'intval', $wpdb->get_col( $wpdb->prepare( 'SELECT user_id FROM ' . self::t( 'meeting_people' ) . ' WHERE meeting_id = %d', $mid ) ) );
	}

	/** Organiser or supervisor. */
	private static function is_host( $m, $uid ) {
		return $uid && ( (int) $m->created_by === (int) $uid || MP_Util::is_manager( $uid ) );
	}

	private static function can_see( $m, $uid ) {
		return self::is_host( $m, $uid ) || in_array( (int) $uid, self::people( $m->id ), true );
	}

	/** When the meeting ends by its time limit (unix time) or 0. */
	private static function ends_at( $m ) {
		return 'live' === $m->status && $m->duration && $m->started_at ? self::ts( $m->started_at ) + 60 * (int) $m->duration : 0;
	}

	/** Ends a live meeting whose time is up; returns the fresh row. */
	private static function check_time( $m ) {
		$end = self::ends_at( $m );
		if ( $end && self::ts() >= $end ) {
			self::finish( $m );
			return self::get( $m->id );
		}
		return $m;
	}

	private static function finish( $m ) {
		global $wpdb;
		$now = MP_Util::now();
		$wpdb->update( self::t(), array( 'status' => 'ended', 'ended_at' => $now ), array( 'id' => $m->id ) );
		$wpdb->query( $wpdb->prepare( 'UPDATE ' . self::t( 'meeting_peers' ) . " SET state = 'left', left_at = %s WHERE meeting_id = %d AND state IN ('in','waiting')", $now, $m->id ) ); // phpcs:ignore
		$wpdb->delete( self::t( 'meeting_signals' ), array( 'meeting_id' => $m->id ) );
	}

	public static function payload( $m, $uid = 0 ) {
		global $wpdb;
		$uid = $uid ? $uid : get_current_user_id();
		$m   = self::check_time( $m );
		self::sweep( $m );
		$in  = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM ' . self::t( 'meeting_peers' ) . " WHERE meeting_id = %d AND state = 'in'", $m->id ) );
		$host = self::is_host( $m, $uid );
		return array(
			'id'          => (int) $m->id,
			'title'       => $m->title,
			'description' => (string) $m->description,
			'date'        => $m->meeting_date,
			'time'        => $m->meeting_time,
			'url'         => $m->url,
			'link'        => self::link( $m->token ),
			'project_id'  => (int) $m->project_id,
			'people'      => self::people( $m->id ),
			'created_by'  => (int) $m->created_by,
			'duration'    => (int) $m->duration,
			'waiting'     => $m->waiting,
			'password'    => $host ? $m->password : '',
			'has_password'=> '' !== $m->password,
			'status'      => $m->status,
			'started_at'  => $m->started_at,
			'ended_at'    => $m->ended_at,
			'online'      => $in,
			'is_host'     => $host,
			'can_delete'  => $host,
		);
	}

	/** GET meetings {from?, to?, scope?: upcoming|past|today|all, q?} */
	public static function index( WP_REST_Request $r ) {
		global $wpdb;
		$uid   = get_current_user_id();
		$where = array( '1=1' );
		$args  = array();
		if ( ! MP_Util::is_manager() || $r['mine'] ) {
			$where[] = '(m.created_by = %d OR p.user_id = %d)';
			$args[]  = $uid;
			$args[]  = $uid;
		}
		$today = MP_Util::today();
		if ( MP_Util::valid_date( $r['from'] ) ) {
			$where[] = 'm.meeting_date >= %s';
			$args[]  = $r['from'];
			$where[] = 'm.meeting_date <= %s';
			$args[]  = MP_Util::valid_date( $r['to'] ) ? $r['to'] : $r['from'];
		} elseif ( 'upcoming' === $r['scope'] ) {
			$where[] = "(m.meeting_date >= %s AND m.status <> 'ended' OR m.status = 'live')";
			$args[]  = $today;
		} elseif ( 'past' === $r['scope'] ) {
			$where[] = "(m.meeting_date < %s OR m.status = 'ended') AND m.status <> 'live'";
			$args[]  = $today;
		} elseif ( 'today' === $r['scope'] ) {
			$where[] = 'm.meeting_date = %s';
			$args[]  = $today;
		}
		$q = MP_Util::text( $r['q'], 80 );
		if ( '' !== $q ) {
			$where[] = '(m.title LIKE %s OR m.description LIKE %s)';
			$like    = '%' . $wpdb->esc_like( $q ) . '%';
			$args[]  = $like;
			$args[]  = $like;
		}
		$order = 'past' === $r['scope'] ? 'DESC' : 'ASC';
		$sql   = 'SELECT DISTINCT m.* FROM ' . self::t() . ' m LEFT JOIN ' . self::t( 'meeting_people' ) . ' p ON p.meeting_id = m.id WHERE ' . implode( ' AND ', $where ) . " ORDER BY m.meeting_date $order, m.meeting_time $order LIMIT 300";
		$rows  = $wpdb->get_results( $args ? $wpdb->prepare( $sql, $args ) : $sql ); // phpcs:ignore
		$out   = array();
		foreach ( $rows as $m ) {
			$out[] = self::payload( $m, $uid );
		}
		return $out;
	}

	/** GET meetings/{id}: the meeting with its attendance history. */
	public static function show( WP_REST_Request $r ) {
		global $wpdb;
		$m = self::get( (int) $r['id'] );
		if ( ! $m || ( ! self::can_see( $m, get_current_user_id() ) && ! MP_Util::is_manager() ) ) {
			return self::err( 'جلسه پیدا نشد.', 404 );
		}
		$out   = self::payload( $m );
		$rows  = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'meeting_peers' ) . " WHERE meeting_id = %d AND joined_at IS NOT NULL ORDER BY joined_at", $m->id ) );
		$seen  = array();
		foreach ( $rows as $p ) {
			$key = $p->user_id ? 'u' . $p->user_id : 'g' . $p->name;
			$end = $p->left_at ? $p->left_at : ( $p->seen_at ? $p->seen_at : $p->joined_at );
			$sec = max( 0, self::ts( $end ) - self::ts( $p->joined_at ) );
			if ( ! isset( $seen[ $key ] ) ) {
				$seen[ $key ] = array( 'name' => $p->name, 'user_id' => (int) $p->user_id, 'role' => $p->role, 'first' => $p->joined_at, 'last' => $end, 'seconds' => 0, 'times' => 0, 'online' => false );
			}
			$seen[ $key ]['seconds'] += $sec;
			$seen[ $key ]['times']++;
			$seen[ $key ]['last']     = max( $seen[ $key ]['last'], $end );
			$seen[ $key ]['online']   = $seen[ $key ]['online'] || 'in' === $p->state;
		}
		$invited = self::people( $m->id );
		foreach ( $invited as $u ) {
			if ( ! isset( $seen[ 'u' . $u ] ) ) {
				$ud = get_userdata( $u );
				$seen[ 'u' . $u ] = array( 'name' => $ud ? $ud->display_name : '—', 'user_id' => $u, 'role' => 'member', 'first' => null, 'last' => null, 'seconds' => 0, 'times' => 0, 'online' => false, 'absent' => true );
			}
		}
		$out['attendance'] = array_values( $seen );
		return $out;
	}

	/** POST meetings[/{id}] {title, date, time, description?, people[], project_id?, url?, duration?, password?, waiting?} */
	public static function save( WP_REST_Request $r ) {
		global $wpdb;
		$uid  = get_current_user_id();
		$id   = (int) $r['id'];
		$old  = $id ? self::get( $id ) : null;
		if ( $id && ( ! $old || ! self::is_host( $old, $uid ) ) ) {
			return self::err( 'فقط برگزارکننده یا ناظر می‌تواند جلسه را ویرایش کند.', 403 );
		}
		$s     = self::settings();
		$title = MP_Util::text( $r['title'], 160 );
		$date  = MP_Util::valid_date( $r['date'] ) ? $r['date'] : MP_Util::today();
		$time  = (string) $r['time'];
		$url   = trim( (string) $r['url'] );
		if ( '' === $time ) {
			// No time chosen: an instant meeting (now), or the old time when editing.
			$time = $old ? $old->meeting_time : current_time( 'H:i' );
		}
		if ( '' === $title ) {
			return self::err( 'عنوان جلسه را وارد کنید.' );
		}
		if ( '' === $time || ! MP_Util::valid_time( $time ) ) {
			return self::err( 'ساعت جلسه معتبر نیست.' );
		}
		if ( '' !== $url && ( ! filter_var( $url, FILTER_VALIDATE_URL ) || ! in_array( wp_parse_url( $url, PHP_URL_SCHEME ), array( 'http', 'https' ), true ) ) ) {
			return self::err( 'لینک باید با https یا http شروع شود.' );
		}
		$f = array(
			'title'        => $title,
			'meeting_date' => $date,
			'meeting_time' => $time,
			'url'          => esc_url_raw( $url ),
			'project_id'   => (int) $r['project_id'],
			'description'  => MP_Util::long_text( $r['description'], 2000 ),
			'duration'     => null !== $r['duration'] ? max( 0, min( 600, (int) $r['duration'] ) ) : ( $old ? (int) $old->duration : (int) $s['duration'] ),
			'password'     => null !== $r['password'] ? MP_Util::text( $r['password'], 64 ) : ( $old ? $old->password : '' ),
			'waiting'      => MP_Util::pick( $r['waiting'], array( 'off', 'guests', 'all' ), $old ? $old->waiting : $s['waiting'] ),
		);
		if ( $old ) {
			$wpdb->update( self::t(), $f, array( 'id' => $id ) );
			$moved = $old->meeting_date !== $date || $old->meeting_time !== $time;
			MP_Audit::log( 'update', 'meeting', $id, 'جلسه «' . $title . '» ویرایش شد' );
		} else {
			$wpdb->insert( self::t(), $f + array( 'token' => wp_generate_password( 32, false, false ), 'status' => 'scheduled', 'created_by' => $uid, 'created_at' => MP_Util::now() ) );
			$id    = (int) $wpdb->insert_id;
			$moved = false;
			MP_Audit::log( 'create', 'meeting', $id, 'جلسه «' . $title . '» ' . MP_Jalali::format( $date ) . ' ساعت ' . MP_Jalali::digits( $time ) );
		}
		$before = self::people( $id );
		if ( is_array( $r['people'] ) ) {
			$want = array();
			foreach ( array_unique( array_map( 'intval', $r['people'] ) ) as $p ) {
				if ( MP_Util::is_panel_user( $p ) ) {
					$want[] = $p;
				}
			}
			foreach ( array_diff( $before, $want ) as $p ) {
				$wpdb->delete( self::t( 'meeting_people' ), array( 'meeting_id' => $id, 'user_id' => $p ) );
			}
			$when = MP_Jalali::format( $date ) . ' · ساعت ' . MP_Jalali::digits( $time );
			foreach ( $want as $p ) {
				$new = ! in_array( $p, $before, true );
				if ( $new ) {
					$wpdb->insert( self::t( 'meeting_people' ), array( 'meeting_id' => $id, 'user_id' => $p ) );
				}
				if ( $p === $uid ) {
					continue;
				}
				if ( $new ) {
					MP_Notify::send( $p, 'meeting', wp_get_current_user()->display_name . ' شما را به جلسه «' . $title . '» دعوت کرد', $when, 'meetings', $id, MP_Rest::wants_email( $p ) );
				} elseif ( $moved ) {
					MP_Notify::send( $p, 'meeting', 'زمان جلسه «' . $title . '» تغییر کرد', $when, 'meetings', $id, MP_Rest::wants_email( $p ) );
				}
			}
		}
		return self::payload( self::get( $id ) );
	}

	public static function remove( WP_REST_Request $r ) {
		global $wpdb;
		$m = self::get( (int) $r['id'] );
		if ( ! $m || ! self::is_host( $m, get_current_user_id() ) ) {
			return self::err( 'فقط برگزارکننده یا ناظر می‌تواند جلسه را حذف کند.', 403 );
		}
		if ( 'ended' !== $m->status ) {
			foreach ( self::people( $m->id ) as $p ) {
				if ( $p !== get_current_user_id() ) {
					MP_Notify::send( $p, 'meeting', 'جلسه «' . $m->title . '» لغو شد', MP_Jalali::format( $m->meeting_date ) . ' · ' . MP_Jalali::digits( $m->meeting_time ), 'meetings' );
				}
			}
		}
		MP_Audit::log( 'delete', 'meeting', $m->id, 'جلسه «' . $m->title . '» حذف شد' );
		foreach ( array( 'meeting_people', 'meeting_peers', 'meeting_signals' ) as $tb ) {
			$wpdb->delete( self::t( $tb ), array( 'meeting_id' => $m->id ) );
		}
		$wpdb->delete( self::t(), array( 'id' => $m->id ) );
		return array( 'deleted' => true );
	}

	public static function end_meeting( WP_REST_Request $r ) {
		$m = self::get( (int) $r['id'] );
		if ( ! $m || ! self::is_host( $m, get_current_user_id() ) ) {
			return self::err( 'فقط میزبان می‌تواند جلسه را پایان دهد.', 403 );
		}
		self::finish( $m );
		MP_Audit::log( 'update', 'meeting', $m->id, 'جلسه «' . $m->title . '» پایان یافت' );
		return self::payload( self::get( $m->id ) );
	}

	/* ------------------------------------------------------------------ Room (public page) */

	/** Marks peers that stopped polling as gone. */
	private static function sweep( $m ) {
		global $wpdb;
		$cut = gmdate( 'Y-m-d H:i:s', self::ts() - self::STALE );
		$wpdb->query( $wpdb->prepare( 'UPDATE ' . self::t( 'meeting_peers' ) . " SET state = 'left', left_at = seen_at WHERE meeting_id = %d AND state IN ('in','waiting') AND seen_at < %s", $m->id, $cut ) ); // phpcs:ignore
	}

	private static function room( WP_REST_Request $r ) {
		$m = self::by_token( (string) $r['token'] );
		return $m ? self::check_time( $m ) : null;
	}

	/** The caller's peer row, checked against its secret. */
	private static function me( $m, WP_REST_Request $r ) {
		global $wpdb;
		$p = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'meeting_peers' ) . ' WHERE id = %d AND meeting_id = %d', (int) $r['peer'], $m->id ) );
		return $p && hash_equals( $p->secret, (string) $r['secret'] ) ? $p : null;
	}

	/** GET room/{token}: what the join screen needs. */
	public static function room_info( WP_REST_Request $r ) {
		$m = self::room( $r );
		if ( ! $m ) {
			return self::err( 'جلسه پیدا نشد.', 404 );
		}
		$uid  = get_current_user_id();
		$user = $uid && MP_Util::is_panel_user( $uid ) ? wp_get_current_user() : null;
		$host = get_userdata( $m->created_by );
		return array(
			'title'      => $m->title,
			'date'       => $m->meeting_date,
			'time'       => $m->meeting_time,
			'status'     => $m->status,
			'host'       => $host ? $host->display_name : '',
			'duration'   => (int) $m->duration,
			'password'   => '' !== $m->password && ! $user,
			'user'       => $user ? array( 'id' => $uid, 'name' => $user->display_name, 'avatar' => MP_Util::avatar_url( $uid ), 'host' => self::is_host( $m, $uid ) ) : null,
			'ice'        => self::ice(),
		);
	}

	/** POST room/{token}/join {name?, password?} → {peer, secret, state} */
	public static function room_join( WP_REST_Request $r ) {
		global $wpdb;
		$m = self::room( $r );
		if ( ! $m ) {
			return self::err( 'جلسه پیدا نشد.', 404 );
		}
		$uid  = get_current_user_id();
		$uid  = $uid && MP_Util::is_panel_user( $uid ) ? $uid : 0;
		$host = self::is_host( $m, $uid );
		if ( 'ended' === $m->status && ! $host ) {
			return self::err( 'این جلسه به پایان رسیده است.', 410 );
		}
		if ( ! $uid && '' !== $m->password && ! hash_equals( $m->password, trim( (string) $r['password'] ) ) ) {
			return self::err( 'رمز جلسه درست نیست.', 403 );
		}
		$name = $uid ? wp_get_current_user()->display_name : MP_Util::text( $r['name'], 60 );
		if ( '' === $name ) {
			return self::err( 'نام خود را وارد کنید.' );
		}
		$now = MP_Util::now();
		if ( $host && 'live' !== $m->status ) {
			$wpdb->update( self::t(), array( 'status' => 'live', 'started_at' => $now, 'ended_at' => null ), array( 'id' => $m->id ) );
			if ( 'scheduled' === $m->status ) {
				foreach ( self::people( $m->id ) as $p ) {
					if ( $p !== $uid ) {
						MP_Notify::send( $p, 'meeting', 'جلسه «' . $m->title . '» شروع شد', 'برای ورود روی اعلان بزنید.', 'meetings', $m->id );
					}
				}
			}
			$m = self::get( $m->id );
		}
		$role = $host ? 'host' : ( $uid ? 'member' : 'guest' );
		$wait = ! $host && ( 'all' === $m->waiting || ( 'guests' === $m->waiting && ! $uid ) );
		// The same person on a second tab replaces the first one.
		if ( $uid ) {
			$wpdb->query( $wpdb->prepare( 'UPDATE ' . self::t( 'meeting_peers' ) . " SET state = 'left', left_at = %s WHERE meeting_id = %d AND user_id = %d AND state IN ('in','waiting')", $now, $m->id, $uid ) ); // phpcs:ignore
		}
		$secret = wp_generate_password( 32, false, false );
		$wpdb->insert(
			self::t( 'meeting_peers' ),
			array(
				'meeting_id' => $m->id,
				'user_id'    => $uid,
				'name'       => $name,
				'role'       => $role,
				'state'      => $wait ? 'waiting' : 'in',
				'secret'     => $secret,
				'mic'        => $r['mic'] ? 1 : 0,
				'cam'        => $r['cam'] ? 1 : 0,
				'created_at' => $now,
				'joined_at'  => $wait ? null : $now,
				'seen_at'    => $now,
			)
		);
		return array( 'peer' => (int) $wpdb->insert_id, 'secret' => $secret, 'state' => $wait ? 'waiting' : 'in', 'role' => $role );
	}

	/** POST room/{token}/poll {peer, secret, after} → room state, peers, waiting list (hosts), signals for me. */
	public static function room_poll( WP_REST_Request $r ) {
		global $wpdb;
		$m = self::room( $r );
		if ( ! $m ) {
			return self::err( 'جلسه پیدا نشد.', 404 );
		}
		$me = self::me( $m, $r );
		if ( ! $me ) {
			return self::err( 'دسترسی ندارید.', 403 );
		}
		$now = MP_Util::now();
		if ( in_array( $me->state, array( 'in', 'waiting' ), true ) ) {
			$wpdb->update( self::t( 'meeting_peers' ), array( 'seen_at' => $now ), array( 'id' => $me->id ) );
		}
		self::sweep( $m );
		$after = (int) $r['after'];
		if ( $after ) {
			$wpdb->query( $wpdb->prepare( 'DELETE FROM ' . self::t( 'meeting_signals' ) . ' WHERE to_peer = %d AND id <= %d', $me->id, $after ) ); // phpcs:ignore
		}
		$peers   = array();
		$waiting = array();
		foreach ( $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'meeting_peers' ) . " WHERE meeting_id = %d AND state IN ('in','waiting') ORDER BY id", $m->id ) ) as $p ) {
			$row = array(
				'id'     => (int) $p->id,
				'name'   => $p->name,
				'role'   => $p->role,
				'mic'    => (bool) $p->mic,
				'cam'    => (bool) $p->cam,
				'hand'   => (bool) $p->hand,
				'share'  => (bool) $p->share,
				'avatar' => $p->user_id ? MP_Util::avatar_url( $p->user_id ) : '',
			);
			if ( 'in' === $p->state ) {
				$peers[] = $row;
			} elseif ( 'host' === $me->role ) {
				$waiting[] = $row;
			}
		}
		$signals = array();
		if ( 'in' === $me->state ) {
			foreach ( $wpdb->get_results( $wpdb->prepare( 'SELECT id, from_peer, kind, body FROM ' . self::t( 'meeting_signals' ) . ' WHERE to_peer = %d AND id > %d ORDER BY id LIMIT 200', $me->id, $after ) ) as $s ) {
				$signals[] = array( 'id' => (int) $s->id, 'from' => (int) $s->from_peer, 'kind' => $s->kind, 'body' => json_decode( $s->body, true ) );
			}
		}
		$hosts = 0;
		foreach ( $peers as $p ) {
			$hosts += 'host' === $p['role'] ? 1 : 0;
		}
		$end = self::ends_at( $m );
		return array(
			'status'    => $m->status,
			'me'        => array( 'id' => (int) $me->id, 'state' => $me->state, 'role' => $me->role ),
			'peers'     => $peers,
			'waiting'   => $waiting,
			'host_here' => $hosts > 0,
			'signals'   => $signals,
			'remaining' => $end ? max( 0, $end - self::ts() ) : -1,
		);
	}

	/** POST room/{token}/signal {peer, secret, to, kind, body} — offer / answer / ice / mute. */
	public static function room_signal( WP_REST_Request $r ) {
		global $wpdb;
		$m  = self::room( $r );
		$me = $m ? self::me( $m, $r ) : null;
		if ( ! $me || 'in' !== $me->state ) {
			return self::err( 'دسترسی ندارید.', 403 );
		}
		$kind = MP_Util::pick( (string) $r['kind'], array( 'offer', 'answer', 'ice', 'mute', 'bye' ), '' );
		if ( '' === $kind || ( 'mute' === $kind && 'host' !== $me->role ) ) {
			return self::err( 'پیام نامعتبر.' );
		}
		$to = $wpdb->get_row( $wpdb->prepare( 'SELECT id FROM ' . self::t( 'meeting_peers' ) . " WHERE id = %d AND meeting_id = %d AND state = 'in'", (int) $r['to'], $m->id ) );
		if ( ! $to ) {
			return array( 'sent' => false );
		}
		$body = wp_json_encode( $r['body'] );
		if ( strlen( $body ) > 60000 ) {
			return self::err( 'پیام بزرگ است.' );
		}
		$wpdb->insert( self::t( 'meeting_signals' ), array( 'meeting_id' => $m->id, 'from_peer' => $me->id, 'to_peer' => $to->id, 'kind' => $kind, 'body' => $body, 'created_at' => MP_Util::now() ) );
		return array( 'sent' => true );
	}

	/** POST room/{token}/state {peer, secret, mic?, cam?, hand?, share?} */
	public static function room_state( WP_REST_Request $r ) {
		global $wpdb;
		$m  = self::room( $r );
		$me = $m ? self::me( $m, $r ) : null;
		if ( ! $me ) {
			return self::err( 'دسترسی ندارید.', 403 );
		}
		$f = array();
		foreach ( array( 'mic', 'cam', 'hand', 'share' ) as $k ) {
			if ( null !== $r[ $k ] ) {
				$f[ $k ] = $r[ $k ] && 'false' !== $r[ $k ] ? 1 : 0;
			}
		}
		if ( $f ) {
			$wpdb->update( self::t( 'meeting_peers' ), $f, array( 'id' => $me->id ) );
		}
		return array( 'ok' => true );
	}

	private static function host_peer( WP_REST_Request $r ) {
		$m  = self::room( $r );
		$me = $m ? self::me( $m, $r ) : null;
		return $me && 'host' === $me->role && 'in' === $me->state ? array( $m, $me ) : null;
	}

	/** POST room/{token}/admit {peer, secret, target, ok} — host lets someone in or turns them away. */
	public static function room_admit( WP_REST_Request $r ) {
		global $wpdb;
		$h = self::host_peer( $r );
		if ( ! $h ) {
			return self::err( 'فقط میزبان.', 403 );
		}
		$ok = $r['ok'] && 'false' !== $r['ok'];
		$targets = 'all' === $r['target'] ? $wpdb->get_col( $wpdb->prepare( 'SELECT id FROM ' . self::t( 'meeting_peers' ) . " WHERE meeting_id = %d AND state = 'waiting'", $h[0]->id ) ) : array( (int) $r['target'] );
		foreach ( $targets as $t ) {
			if ( $ok ) {
				$wpdb->query( $wpdb->prepare( 'UPDATE ' . self::t( 'meeting_peers' ) . " SET state = 'in', joined_at = %s WHERE id = %d AND meeting_id = %d AND state = 'waiting'", MP_Util::now(), (int) $t, $h[0]->id ) ); // phpcs:ignore
			} else {
				$wpdb->query( $wpdb->prepare( 'UPDATE ' . self::t( 'meeting_peers' ) . " SET state = 'rejected' WHERE id = %d AND meeting_id = %d AND state = 'waiting'", (int) $t, $h[0]->id ) ); // phpcs:ignore
			}
		}
		return array( 'ok' => true );
	}

	/** POST room/{token}/kick {peer, secret, target} */
	public static function room_kick( WP_REST_Request $r ) {
		global $wpdb;
		$h = self::host_peer( $r );
		if ( ! $h ) {
			return self::err( 'فقط میزبان.', 403 );
		}
		$wpdb->query( $wpdb->prepare( 'UPDATE ' . self::t( 'meeting_peers' ) . " SET state = 'kicked', left_at = %s WHERE id = %d AND meeting_id = %d AND role <> 'host'", MP_Util::now(), (int) $r['target'], $h[0]->id ) ); // phpcs:ignore
		return array( 'ok' => true );
	}

	public static function room_leave( WP_REST_Request $r ) {
		global $wpdb;
		$m  = self::room( $r );
		$me = $m ? self::me( $m, $r ) : null;
		if ( $me && in_array( $me->state, array( 'in', 'waiting' ), true ) ) {
			$wpdb->update( self::t( 'meeting_peers' ), array( 'state' => 'left', 'left_at' => MP_Util::now() ), array( 'id' => $me->id ) );
		}
		return array( 'ok' => true );
	}

	public static function room_end( WP_REST_Request $r ) {
		$h = self::host_peer( $r );
		if ( ! $h ) {
			return self::err( 'فقط میزبان.', 403 );
		}
		self::finish( $h[0] );
		return array( 'ok' => true );
	}

	/* ------------------------------------------------------------------ Page */

	public static function render_public( $token ) {
		$m = self::by_token( $token );
		nocache_headers();
		header( 'X-Robots-Tag: noindex' );
		if ( ! $m ) {
			status_header( 404 );
			exit( 'Not found' );
		}
		$nonce = is_user_logged_in() ? wp_create_nonce( 'wp_rest' ) : '';
		include MP_DIR . 'templates/meet.php';
		exit;
	}
}
