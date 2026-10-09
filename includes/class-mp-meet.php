<?php
/**
 * Video meetings: scheduled, recurring or permanent rooms with their own link (/m/{token}/), a
 * waiting room, password, time limit, lock and one-time guest links. Sound and picture go through
 * this site (MP_Relay) by default, or browser to browser (WebRTC) when chosen in the settings.
 *
 * - Hosts: the organiser and every supervisor; a host can make anyone a co-host. Hosts admit or turn
 *   away people in the waiting room, mute one or all, lock microphones, remove people, lock the
 *   meeting, show a design for review, send a contract card, record, and end the meeting.
 * - Colleagues (panel users) join with their account; outside guests type a name (and the password),
 *   or come with a one-time invite link; clients come from their portal.
 * - Attendance, chat, recordings and minutes are kept with the meeting.
 */
defined( 'ABSPATH' ) || exit;

class MP_Meet {

	const SETTINGS = 'mp_meet_settings';
	const STALE    = 40;  // seconds without a poll before a peer counts as gone
	const REJOIN   = 600; // seconds in which a dropped participant comes back without the waiting room
	const STEPS    = array( 'daily' => '+1 day', 'weekly' => '+1 week', 'biweekly' => '+2 weeks', 'monthly' => '+1 month' );

	public static function register() {
		$auth = array( 'MP_Rest', 'can_access' );
		$m    = array( 'MP_Rest', 'can_manage' );
		$id   = '(?P<id>\d+)';
		$tok  = 'room/(?P<token>[A-Za-z0-9]{32})';
		$routes = array(
			array( 'meetings', 'GET', 'index', $auth ),
			array( 'meetings', 'POST', 'save', $auth ),
			array( 'meetings/settings', 'GET', 'get_settings', $auth ),
			array( 'meetings/settings', 'POST', 'save_settings', $m ),
			array( 'meetings/stats', 'GET', 'stats', $auth ),
			array( 'meetings/team-room', 'POST', 'team_room', $m ),
			array( "meetings/$id", 'GET', 'show', $auth ),
			array( "meetings/$id", 'POST', 'save', $auth ),
			array( "meetings/$id", 'DELETE', 'remove', $auth ),
			array( "meetings/$id/end", 'POST', 'end_meeting', $auth ),
			array( "meetings/$id/invite", 'POST', 'invite', $auth ),
			array( "meetings/$id/minutes", 'POST', 'save_minutes', $auth ),
			array( "meetings/$id/auto-minutes", 'POST', 'auto_minutes', $auth ),
			array( "meetings/$id/rec-start", 'POST', 'rec_start', $auth ),
			array( "meetings/$id/rec-chunk", 'POST', 'rec_chunk', $auth ),
			array( "meetings/$id/rec-stop", 'POST', 'rec_stop', $auth ),
			array( $tok, 'GET', 'room_info', '__return_true' ),
			array( "$tok/join", 'POST', 'room_join', '__return_true' ),
			array( "$tok/poll", 'POST', 'room_poll', '__return_true' ),
			array( "$tok/signal", 'POST', 'room_signal', '__return_true' ),
			array( "$tok/state", 'POST', 'room_state', '__return_true' ),
			array( "$tok/admit", 'POST', 'room_admit', '__return_true' ),
			array( "$tok/kick", 'POST', 'room_kick', '__return_true' ),
			array( "$tok/leave", 'POST', 'room_leave', '__return_true' ),
			array( "$tok/end", 'POST', 'room_end', '__return_true' ),
			array( "$tok/relay", 'POST', 'room_relay', '__return_true' ),
			array( "$tok/chat", 'POST', 'room_chat', '__return_true' ),
			array( "$tok/chat-file", 'POST', 'room_chat_file', '__return_true' ),
			array( "$tok/control", 'POST', 'room_control', '__return_true' ),
			array( "$tok/stage", 'POST', 'room_stage', '__return_true' ),
			array( "$tok/pin", 'POST', 'room_pin', '__return_true' ),
			array( "$tok/library", 'POST', 'room_library', '__return_true' ),
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
				'mode'      => 'relay', // relay: through this site, no outside server · p2p: WebRTC browser to browser
				'video'     => 'normal', // low | normal | high
				'remind'    => true, // 10 minutes before: panel, messenger and SMS
			)
		);
	}

	public static function get_settings() {
		$s = self::settings();
		if ( ! MP_Util::is_manager() ) {
			unset( $s['turn_user'], $s['turn_pass'] );
		}
		$s['ai']     = MP_AI::enabled();
		$s['speech'] = MP_Speech::enabled();
		$s['sms']    = '' !== MP_Auth::provider();
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
		if ( null !== $r['mode'] ) {
			$s['mode'] = MP_Util::pick( $r['mode'], array( 'relay', 'p2p' ), 'relay' );
		}
		if ( null !== $r['video'] ) {
			$s['video'] = MP_Util::pick( $r['video'], array( 'low', 'normal', 'high' ), 'normal' );
		}
		if ( null !== $r['remind'] ) {
			$s['remind'] = (bool) $r['remind'] && 'false' !== $r['remind'];
		}
		update_option( self::SETTINGS, $s, false );
		return self::get_settings();
	}

	/** ICE servers for the room page (WebRTC mode) and voice calls. */
	public static function ice() {
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

	/* ------------------------------------------------------------------ Basics */

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

	public static function people( $mid ) {
		global $wpdb;
		return array_map( 'intval', $wpdb->get_col( $wpdb->prepare( 'SELECT user_id FROM ' . self::t( 'meeting_people' ) . ' WHERE meeting_id = %d', $mid ) ) );
	}

	/** Organiser or supervisor. */
	private static function is_host( $m, $uid ) {
		return $uid && ( (int) $m->created_by === (int) $uid || MP_Util::is_manager( $uid ) );
	}

	public static function can_see( $m, $uid ) {
		return self::is_host( $m, $uid ) || in_array( (int) $uid, self::people( $m->id ), true ) || ( $m->permanent && MP_Util::is_panel_user( $uid ) );
	}

	/** A file link that also opens for guests of the meeting (chat files, the design on show). */
	public static function file_url( $file_id ) {
		return add_query_arg( 'mk', self::file_sig( $file_id ), MP_Files::url( $file_id ) );
	}

	public static function file_sig( $file_id ) {
		return substr( hash_hmac( 'sha256', 'mp-meet-file|' . (int) $file_id, wp_salt( 'auth' ) ), 0, 24 );
	}

	/** The portal's meeting link: lets the client in without password or waiting room. */
	public static function client_link( $m, $channel_token ) {
		$sig = substr( hash_hmac( 'sha256', 'mp-meet-client|' . $m->token . '|' . $channel_token, wp_salt( 'auth' ) ), 0, 24 );
		return add_query_arg( array( 'c' => $channel_token, 'cs' => $sig ), self::link( $m->token ) );
	}

	/** When the meeting ends by its time limit (unix time) or 0. */
	private static function ends_at( $m ) {
		return 'live' === $m->status && $m->duration && $m->started_at && ! $m->permanent ? self::ts( $m->started_at ) + 60 * (int) $m->duration : 0;
	}

	/** Recurring meetings move to their next date once a date has passed. */
	private static function roll( $m ) {
		global $wpdb;
		if ( ! $m || 'none' === $m->recurrence || $m->permanent || 'live' === $m->status || ! isset( self::STEPS[ $m->recurrence ] ) ) {
			return $m;
		}
		$today = MP_Util::today();
		$date  = $m->meeting_date;
		$moved = false;
		while ( $date < $today || ( 'ended' === $m->status && $date <= $today ) ) {
			$date        = gmdate( 'Y-m-d', strtotime( $date . ' ' . self::STEPS[ $m->recurrence ] . ' UTC' ) );
			$m->status   = 'scheduled';
			$moved       = true;
		}
		if ( $moved ) {
			$wpdb->update( self::t(), array( 'meeting_date' => $date, 'status' => 'scheduled', 'started_at' => null, 'ended_at' => null, 'locked' => 0, 'mic_lock' => 0, 'stage' => null, 'recording' => 0 ), array( 'id' => $m->id ) );
			delete_transient( 'mp_meeting_alert_' . $m->id );
			return self::get( $m->id );
		}
		return $m;
	}

	public static function roll_all() {
		global $wpdb;
		foreach ( $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::t() . " WHERE recurrence <> 'none' AND permanent = 0 AND status <> 'live' AND meeting_date < %s", MP_Util::today() ) ) as $m ) {
			self::roll( $m );
		}
	}

	/** Ends a live meeting whose time is up, or that everyone left 10 minutes ago; returns the fresh row. */
	private static function check_time( $m ) {
		global $wpdb;
		$end = self::ends_at( $m );
		if ( $end && self::ts() >= $end ) {
			self::finish( $m );
			return self::get( $m->id );
		}
		if ( 'live' === $m->status && $m->started_at && self::ts( $m->started_at ) < self::ts() - 600 ) {
			$last = $wpdb->get_var( $wpdb->prepare( 'SELECT MAX(COALESCE(left_at, seen_at)) FROM ' . self::t( 'meeting_peers' ) . ' WHERE meeting_id = %d', $m->id ) );
			$in   = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM ' . self::t( 'meeting_peers' ) . " WHERE meeting_id = %d AND state IN ('in','waiting') AND seen_at >= %s", $m->id, gmdate( 'Y-m-d H:i:s', self::ts() - self::STALE ) ) );
			if ( ! $in && ( ! $last || self::ts( $last ) < self::ts() - 600 ) ) {
				self::finish( $m );
				return self::get( $m->id );
			}
		}
		return self::roll( $m );
	}

	private static function finish( $m ) {
		global $wpdb;
		$now = MP_Util::now();
		// A team room is never "over": it simply empties. Recurring meetings wait for their next date.
		$wpdb->update( self::t(), array( 'status' => $m->permanent ? 'scheduled' : 'ended', 'ended_at' => $now, 'locked' => 0, 'mic_lock' => 0, 'stage' => null, 'recording' => 0 ), array( 'id' => $m->id ) );
		$wpdb->query( $wpdb->prepare( 'UPDATE ' . self::t( 'meeting_peers' ) . " SET state = 'left', left_at = %s WHERE meeting_id = %d AND state IN ('in','waiting')", $now, $m->id ) ); // phpcs:ignore
		$wpdb->delete( self::t( 'meeting_signals' ), array( 'meeting_id' => $m->id ) );
		MP_Relay::purge( $m->token );
		if ( 'none' !== $m->recurrence && ! $m->permanent ) {
			self::roll( self::get( $m->id ) );
		}
	}

	private static function minutes_of( $m ) {
		$x = $m->minutes ? json_decode( $m->minutes, true ) : null;
		return is_array( $x ) ? $x : null;
	}

	public static function payload( $m, $uid = 0 ) {
		global $wpdb;
		$uid  = $uid ? $uid : get_current_user_id();
		$m    = self::check_time( $m );
		self::sweep( $m );
		$in   = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM ' . self::t( 'meeting_peers' ) . " WHERE meeting_id = %d AND state = 'in'", $m->id ) );
		$host = self::is_host( $m, $uid );
		$ch   = $m->channel_id ? $wpdb->get_row( $wpdb->prepare( 'SELECT id, title, client_name FROM ' . self::t( 'channels' ) . ' WHERE id = %d', $m->channel_id ) ) : null;
		return array(
			'id'           => (int) $m->id,
			'title'        => $m->title,
			'description'  => (string) $m->description,
			'date'         => $m->meeting_date,
			'time'         => $m->meeting_time,
			'url'          => $m->url,
			'link'         => self::link( $m->token ),
			'project_id'   => (int) $m->project_id,
			'channel_id'   => (int) $m->channel_id,
			'channel'      => $ch ? ( $ch->client_name ? $ch->client_name : $ch->title ) : '',
			'people'       => self::people( $m->id ),
			'created_by'   => (int) $m->created_by,
			'duration'     => (int) $m->duration,
			'waiting'      => $m->waiting,
			'password'     => $host ? $m->password : '',
			'has_password' => '' !== $m->password,
			'status'       => $m->status,
			'recurrence'   => $m->recurrence,
			'permanent'    => (bool) $m->permanent,
			'started_at'   => $m->started_at,
			'ended_at'     => $m->ended_at,
			'online'       => $in,
			'has_minutes'  => (bool) $m->minutes,
			'is_host'      => $host,
			'can_delete'   => $host,
		);
	}

	/** GET meetings {from?, to?, scope?: upcoming|past|today|all, q?, mine?} */
	public static function index( WP_REST_Request $r ) {
		global $wpdb;
		$uid   = get_current_user_id();
		$where = array( 'm.permanent = 0' );
		$args  = array();
		if ( ! MP_Util::is_manager() || $r['mine'] ) {
			$where[] = '(m.created_by = %d OR p.user_id = %d)';
			$args[]  = $uid;
			$args[]  = $uid;
		}
		$today = MP_Util::today();
		$range = MP_Util::valid_date( $r['from'] );
		$to    = $range && MP_Util::valid_date( $r['to'] ) ? $r['to'] : $r['from'];
		if ( $range ) {
			// Recurring meetings are expanded below, so they are fetched whenever they started before the range ends.
			$where[] = "(m.meeting_date BETWEEN %s AND %s OR (m.recurrence <> 'none' AND m.meeting_date <= %s))";
			array_push( $args, $r['from'], $to, $to );
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
			$pl = self::payload( $m, $uid );
			if ( $range && 'none' !== $m->recurrence ) {
				// Every date of a recurring meeting inside the range (calendar).
				$d = $pl['date'];
				$n = 0;
				while ( $d <= $to && $n++ < 60 ) {
					if ( $d >= $r['from'] ) {
						$out[] = array_merge( $pl, array( 'date' => $d, 'occurrence' => $d !== $pl['date'] ) );
					}
					$d = gmdate( 'Y-m-d', strtotime( $d . ' ' . self::STEPS[ $m->recurrence ] . ' UTC' ) );
				}
				continue;
			}
			if ( ! $range || ( $pl['date'] >= $r['from'] && $pl['date'] <= $to ) ) {
				$out[] = $pl;
			}
		}
		if ( ! $range && in_array( (string) $r['scope'], array( '', 'upcoming', 'today' ), true ) && '' === $q ) {
			// Team rooms first: always open.
			$rooms = array();
			foreach ( $wpdb->get_results( 'SELECT * FROM ' . self::t() . ' WHERE permanent = 1 ORDER BY id' ) as $m ) { // phpcs:ignore
				$rooms[] = self::payload( $m, $uid );
			}
			$out = array_merge( $rooms, $out );
		}
		return $out;
	}

	/** GET meetings/{id}: the meeting with attendance, chat, recordings, invites and minutes. */
	public static function show( WP_REST_Request $r ) {
		global $wpdb;
		$m = self::get( (int) $r['id'] );
		if ( ! $m || ( ! self::can_see( $m, get_current_user_id() ) && ! MP_Util::is_manager() ) ) {
			return self::err( 'جلسه پیدا نشد.', 404 );
		}
		$out               = self::payload( $m );
		$out['attendance'] = self::attendance( $m );
		$chat              = array();
		foreach ( $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'meeting_chat' ) . " WHERE meeting_id = %d AND kind <> 'react' ORDER BY id DESC LIMIT 300", $m->id ) ) as $c ) {
			$chat[] = self::chat_payload( $c, 0 );
		}
		$out['chat'] = array_reverse( $chat );
		$recs        = array();
		foreach ( $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'files' ) . " WHERE context IN ('meeting_rec','meeting_audio') AND context_id = %d ORDER BY id DESC", $m->id ) ) as $f ) {
			$recs[] = array( 'id' => (int) $f->id, 'kind' => 'meeting_rec' === $f->context ? 'video' : 'audio', 'name' => $f->name, 'size' => (int) $f->size, 'mime' => $f->mime, 'url' => MP_Files::url( $f->id ), 'download' => MP_Files::url( $f->id, true ), 'at' => $f->created_at );
		}
		$out['recordings'] = $recs;
		$out['minutes']    = self::minutes_of( $m );
		if ( $out['is_host'] ) {
			$inv = array();
			foreach ( $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'meeting_invites' ) . ' WHERE meeting_id = %d ORDER BY id DESC LIMIT 50', $m->id ) ) as $i ) {
				$inv[] = array( 'id' => (int) $i->id, 'name' => $i->name, 'phone' => $i->phone, 'used' => (bool) $i->used_at, 'link' => add_query_arg( 'i', $i->code, self::link( $m->token ) ) );
			}
			$out['invites'] = $inv;
		}
		$out['export'] = add_query_arg( array( 'mp_export' => 'meeting', 'id' => $m->id, '_wpnonce' => wp_create_nonce( 'mp_export' ) ), home_url( '/' ) );
		return $out;
	}

	/** Per person: first join, time in the meeting, how many times; invited people who never came. */
	public static function attendance( $m ) {
		global $wpdb;
		$rows = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'meeting_peers' ) . ' WHERE meeting_id = %d AND joined_at IS NOT NULL ORDER BY joined_at', $m->id ) );
		$seen = array();
		foreach ( $rows as $p ) {
			$key = $p->user_id ? 'u' . $p->user_id : 'g' . $p->name;
			$end = $p->left_at ? $p->left_at : ( $p->seen_at ? $p->seen_at : $p->joined_at );
			$sec = max( 0, self::ts( $end ) - self::ts( $p->joined_at ) );
			if ( ! isset( $seen[ $key ] ) ) {
				$seen[ $key ] = array( 'name' => $p->name, 'user_id' => (int) $p->user_id, 'role' => $p->role, 'first' => $p->joined_at, 'last' => $end, 'seconds' => 0, 'times' => 0, 'online' => false, 'dates' => array() );
			}
			$seen[ $key ]['seconds'] += $sec;
			$seen[ $key ]['times']++;
			$seen[ $key ]['last']     = max( $seen[ $key ]['last'], $end );
			$seen[ $key ]['online']   = $seen[ $key ]['online'] || 'in' === $p->state;
			$seen[ $key ]['dates'][ substr( $p->joined_at, 0, 10 ) ] = 1;
			if ( 'host' === $p->role ) {
				$seen[ $key ]['role'] = 'host';
			}
		}
		foreach ( self::people( $m->id ) as $u ) {
			if ( ! isset( $seen[ 'u' . $u ] ) ) {
				$ud = get_userdata( $u );
				$seen[ 'u' . $u ] = array( 'name' => $ud ? $ud->display_name : '—', 'user_id' => $u, 'role' => 'member', 'first' => null, 'last' => null, 'seconds' => 0, 'times' => 0, 'online' => false, 'absent' => true, 'dates' => array() );
			}
		}
		foreach ( $seen as &$s ) {
			$s['dates'] = array_keys( $s['dates'] );
		}
		return array_values( $seen );
	}

	/** POST meetings[/{id}] {title, date, time, description?, people[], project_id?, channel_id?, url?, duration?, password?, waiting?, recurrence?} */
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
		$channel = null !== $r['channel_id'] ? (int) $r['channel_id'] : ( $old ? (int) $old->channel_id : 0 );
		if ( $channel && ! MP_Rest::can_read_channel( $channel ) ) {
			$channel = 0;
		}
		$f = array(
			'title'        => $title,
			'meeting_date' => $date,
			'meeting_time' => $time,
			'url'          => esc_url_raw( $url ),
			'project_id'   => (int) $r['project_id'],
			'channel_id'   => $channel,
			'description'  => MP_Util::long_text( $r['description'], 2000 ),
			'duration'     => null !== $r['duration'] ? max( 0, min( 600, (int) $r['duration'] ) ) : ( $old ? (int) $old->duration : (int) $s['duration'] ),
			'password'     => null !== $r['password'] ? MP_Util::text( $r['password'], 64 ) : ( $old ? $old->password : '' ),
			'waiting'      => MP_Util::pick( $r['waiting'], array( 'off', 'guests', 'all' ), $old ? $old->waiting : $s['waiting'] ),
			'recurrence'   => MP_Util::pick( $r['recurrence'], array( 'none', 'daily', 'weekly', 'biweekly', 'monthly' ), $old ? $old->recurrence : 'none' ),
		);
		if ( $channel && ! $f['project_id'] ) {
			$f['project_id'] = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT project_id FROM ' . self::t( 'channels' ) . ' WHERE id = %d', $channel ) );
		}
		if ( $old ) {
			$wpdb->update( self::t(), $f, array( 'id' => $id ) );
			$moved = $old->meeting_date !== $date || $old->meeting_time !== $time;
			if ( $moved ) {
				delete_transient( 'mp_meeting_alert_' . $id );
			}
			MP_Audit::log( 'update', 'meeting', $id, 'جلسه «' . $title . '» ویرایش شد' );
		} else {
			$wpdb->insert( self::t(), $f + array( 'token' => wp_generate_password( 32, false, false ), 'status' => 'scheduled', 'created_by' => $uid, 'created_at' => MP_Util::now() ) );
			$id    = (int) $wpdb->insert_id;
			$moved = false;
			MP_Audit::log( 'create', 'meeting', $id, 'جلسه «' . $title . '» ' . MP_Jalali::format( $date ) . ' ساعت ' . MP_Jalali::digits( $time ) );
		}
		$m    = self::get( $id );
		$when = MP_Jalali::format( $date ) . ' · ساعت ' . MP_Jalali::digits( $time );
		// The client's group hears about it, with a link that lets them straight in from the portal.
		if ( $channel && ( ! $old || $moved || (int) $old->channel_id !== $channel ) ) {
			MP_Client::system( $channel, 0, ( $old ? 'زمان جلسه آنلاین «' . $title . '» تغییر کرد: ' : 'جلسه آنلاین «' . $title . '» تنظیم شد: ' ) . $when . '. از بخش «جلسات» پرتال وارد شوید.', array( 't' => 'meeting', 'id' => $id ) );
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
			foreach ( $want as $p ) {
				$new = ! in_array( $p, $before, true );
				if ( $new ) {
					$wpdb->insert( self::t( 'meeting_people' ), array( 'meeting_id' => $id, 'user_id' => $p ) );
				}
				if ( $p === $uid ) {
					continue;
				}
				if ( $new ) {
					MP_Notify::event( 'meet_invite', $p, array( 'ACTOR' => wp_get_current_user()->display_name, 'TITLE' => $title, 'WHEN' => $when ), 'meetings', $id, MP_Rest::wants_email( $p ) );
				} elseif ( $moved ) {
					MP_Notify::event( 'meet_moved', $p, array( 'TITLE' => $title, 'WHEN' => $when ), 'meetings', $id, MP_Rest::wants_email( $p ) );
				}
			}
		}
		return self::payload( $m );
	}

	/** POST meetings/team-room {title?} — an always-open room for the team (one link, no date). */
	public static function team_room( WP_REST_Request $r ) {
		global $wpdb;
		$title = MP_Util::text( $r['title'], 160 );
		$wpdb->insert(
			self::t(),
			array(
				'title'        => '' !== $title ? $title : 'اتاق جلسه تیم',
				'meeting_date' => MP_Util::today(),
				'meeting_time' => '00:00',
				'token'        => wp_generate_password( 32, false, false ),
				'status'       => 'scheduled',
				'permanent'    => 1,
				'waiting'      => 'guests',
				'duration'     => 0,
				'created_by'   => get_current_user_id(),
				'created_at'   => MP_Util::now(),
			)
		);
		return self::payload( self::get( $wpdb->insert_id ) );
	}

	public static function remove( WP_REST_Request $r ) {
		global $wpdb;
		$m = self::get( (int) $r['id'] );
		if ( ! $m || ! self::is_host( $m, get_current_user_id() ) ) {
			return self::err( 'فقط برگزارکننده یا ناظر می‌تواند جلسه را حذف کند.', 403 );
		}
		if ( 'ended' !== $m->status && ! $m->permanent ) {
			foreach ( self::people( $m->id ) as $p ) {
				if ( $p !== get_current_user_id() ) {
					MP_Notify::event( 'meet_cancel', $p, array( 'TITLE' => $m->title, 'DATE' => MP_Jalali::format( $m->meeting_date ), 'TIME' => MP_Jalali::digits( $m->meeting_time ) ), 'meetings' );
				}
			}
		}
		MP_Audit::log( 'delete', 'meeting', $m->id, 'جلسه «' . $m->title . '» حذف شد' );
		MP_Relay::purge( $m->token );
		foreach ( array( 'meeting_people', 'meeting_peers', 'meeting_signals', 'meeting_invites', 'meeting_chat' ) as $tb ) {
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

	/* ------------------------------------------------------------------ Invites */

	/** POST meetings/{id}/invite {name, phone?} — a one-time guest link (no password, no waiting room); SMS when a phone is given. */
	public static function invite( WP_REST_Request $r ) {
		global $wpdb;
		$m = self::get( (int) $r['id'] );
		if ( ! $m || ! self::is_host( $m, get_current_user_id() ) ) {
			return self::err( 'فقط میزبان می‌تواند مهمان دعوت کند.', 403 );
		}
		$name  = MP_Util::text( $r['name'], 80 );
		$phone = (string) $r['phone'];
		$phone = '' !== trim( $phone ) ? MP_Auth::normalize( $phone ) : '';
		if ( '' !== trim( (string) $r['phone'] ) && ! $phone ) {
			return self::err( 'شماره موبایل معتبر نیست.' );
		}
		$code = strtolower( wp_generate_password( 12, false, false ) );
		$wpdb->insert( self::t( 'meeting_invites' ), array( 'meeting_id' => $m->id, 'code' => $code, 'name' => $name, 'phone' => (string) $phone, 'created_by' => get_current_user_id(), 'created_at' => MP_Util::now() ) );
		$link = add_query_arg( 'i', $code, self::link( $m->token ) );
		$sent = false;
		if ( $phone ) {
			$when = $m->permanent ? '' : ' ' . MP_Jalali::format( $m->meeting_date ) . ' ساعت ' . MP_Jalali::digits( $m->meeting_time );
			$sent = MP_Messages::send_sms( 'meet_guest_invite', $phone, array( 'NAME' => '' !== $name ? $name : 'مهمان', 'TITLE' => $m->title, 'WHEN' => trim( $when ), 'LINK' => $link ) );
		}
		return array( 'link' => $link, 'sms' => $sent, 'phone' => $phone );
	}

	/* ------------------------------------------------------------------ Minutes */

	/** POST meetings/{id}/minutes {summary, decisions[], actions[{text,user_id,due,task_id}], transcript?} */
	public static function save_minutes( WP_REST_Request $r ) {
		global $wpdb;
		$m = self::get( (int) $r['id'] );
		if ( ! $m || ! self::can_see( $m, get_current_user_id() ) ) {
			return self::err( 'جلسه پیدا نشد.', 404 );
		}
		$old = self::minutes_of( $m );
		$min = array(
			'summary'    => MP_Util::long_text( $r['summary'], 8000 ),
			'decisions'  => array(),
			'actions'    => array(),
			'transcript' => null !== $r['transcript'] ? MP_Util::long_text( $r['transcript'], 60000 ) : ( $old && isset( $old['transcript'] ) ? $old['transcript'] : '' ),
			'by'         => get_current_user_id(),
			'at'         => MP_Util::now(),
		);
		foreach ( is_array( $r['decisions'] ) ? $r['decisions'] : array() as $d ) {
			$d = MP_Util::text( $d, 500 );
			if ( '' !== $d ) {
				$min['decisions'][] = $d;
			}
		}
		foreach ( is_array( $r['actions'] ) ? $r['actions'] : array() as $a ) {
			$text = isset( $a['text'] ) ? MP_Util::text( $a['text'], 200 ) : '';
			if ( '' === $text ) {
				continue;
			}
			$min['actions'][] = array(
				'text'    => $text,
				'user_id' => isset( $a['user_id'] ) && MP_Util::is_panel_user( (int) $a['user_id'] ) ? (int) $a['user_id'] : 0,
				'due'     => isset( $a['due'] ) && MP_Util::valid_date( $a['due'] ) ? $a['due'] : '',
				'task_id' => isset( $a['task_id'] ) ? (int) $a['task_id'] : 0,
			);
		}
		$wpdb->update( self::t(), array( 'minutes' => wp_json_encode( $min, JSON_UNESCAPED_UNICODE ) ), array( 'id' => $m->id ) );
		if ( ! $old ) {
			foreach ( array_unique( array_merge( self::people( $m->id ), array( (int) $m->created_by ) ) ) as $p ) {
				if ( $p !== get_current_user_id() ) {
					MP_Notify::event( 'meet_minutes', $p, array( 'TITLE' => $m->title ), 'meetings', $m->id );
				}
			}
		}
		return $min;
	}

	/**
	 * POST meetings/{id}/auto-minutes — the meeting's recorded sound → text (speech service) → summary,
	 * decisions and action items with owner and due date (panel AI). Returns a draft to review.
	 */
	public static function auto_minutes( WP_REST_Request $r ) {
		global $wpdb;
		$m = self::get( (int) $r['id'] );
		if ( ! $m || ! self::is_host( $m, get_current_user_id() ) ) {
			return self::err( 'فقط میزبان.', 403 );
		}
		$old  = self::minutes_of( $m );
		$text = $old && ! empty( $old['transcript'] ) && ! $r['fresh'] ? $old['transcript'] : '';
		if ( '' === $text ) {
			$f = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'files' ) . " WHERE context = 'meeting_audio' AND context_id = %d AND size > 0 ORDER BY id DESC LIMIT 1", $m->id ) );
			if ( ! $f ) {
				return self::err( 'صدای این جلسه ضبط نشده است. در جلسه دکمه «ضبط» را بزنید تا صدا برای صورتجلسه هم ذخیره شود.' );
			}
			$text = MP_Speech::transcribe_file( MP_Files::dir() . '/' . $f->path, $f->mime );
			if ( is_wp_error( $text ) ) {
				return $text;
			}
		}
		$names = array();
		foreach ( self::attendance( $m ) as $a ) {
			$names[] = $a['name'];
		}
		$sys = 'تو منشی جلسات یک استودیوی طراحی هستی. از متن پیاده‌شده جلسه، صورتجلسه فارسی بنویس. فقط JSON برگردان با این کلیدها: '
			. '"summary" (خلاصه ۳ تا ۸ جمله‌ای)، "decisions" (آرایه‌ای از تصمیم‌های گرفته‌شده، هر کدام یک جمله)، '
			. '"actions" (آرایه‌ای از کارهای مشخص با کلیدهای "text" عنوان کوتاه کار، "owner" نام مسئول دقیقاً از فهرست شرکت‌کنندگان یا خالی، "due" تاریخ میلادی YYYY-MM-DD یا خالی). '
			. 'امروز ' . MP_Util::today() . ' است؛ «فردا»، «هفته بعد» و … را به تاریخ تبدیل کن. چیزی از خودت نساز.';
		$ans = MP_AI::ask( $sys, "عنوان جلسه: {$m->title}\nشرکت‌کنندگان: " . implode( '، ', $names ) . "\n\nمتن جلسه:\n" . mb_substr( $text, 0, 60000 ), true );
		if ( is_wp_error( $ans ) ) {
			return $ans;
		}
		$ans  = trim( preg_replace( '/^```(json)?|```$/m', '', $ans ) );
		$data = json_decode( $ans, true );
		if ( ! is_array( $data ) ) {
			return self::err( 'پاسخ هوش مصنوعی قابل خواندن نبود؛ دوباره امتحان کنید.', 502 );
		}
		$actions = array();
		foreach ( isset( $data['actions'] ) && is_array( $data['actions'] ) ? $data['actions'] : array() as $a ) {
			$owner     = isset( $a['owner'] ) ? (string) $a['owner'] : '';
			$uid       = '' !== trim( $owner ) ? MP_AI::user( $owner ) : 0;
			$actions[] = array(
				'text'    => isset( $a['text'] ) ? MP_Util::text( $a['text'], 200 ) : '',
				'user_id' => is_wp_error( $uid ) ? 0 : (int) $uid,
				'owner'   => $owner,
				'due'     => isset( $a['due'] ) && MP_Util::valid_date( $a['due'] ) ? $a['due'] : '',
				'task_id' => 0,
			);
		}
		return array(
			'summary'    => isset( $data['summary'] ) ? (string) $data['summary'] : '',
			'decisions'  => isset( $data['decisions'] ) && is_array( $data['decisions'] ) ? array_values( array_map( 'strval', $data['decisions'] ) ) : array(),
			'actions'    => $actions,
			'transcript' => $text,
		);
	}

	/* ------------------------------------------------------------------ Recording */

	private static function rec_meeting( WP_REST_Request $r ) {
		$m = self::get( (int) $r['id'] );
		return $m && self::is_host( $m, get_current_user_id() ) ? $m : null;
	}

	/** POST meetings/{id}/rec-start {kind: video|audio, mime} → {file} — an empty file the chunks are added to. */
	public static function rec_start( WP_REST_Request $r ) {
		global $wpdb;
		$m = self::rec_meeting( $r );
		if ( ! $m ) {
			return self::err( 'فقط میزبان می‌تواند ضبط کند.', 403 );
		}
		$audio = 'audio' === $r['kind'];
		$mime  = (string) $r['mime'];
		$ext   = false !== strpos( $mime, 'mp4' ) ? ( $audio ? 'm4a' : 'mp4' ) : ( $audio ? 'weba' : 'webm' );
		$mime  = $audio ? ( 'm4a' === $ext ? 'audio/mp4' : 'audio/webm' ) : ( 'mp4' === $ext ? 'video/mp4' : 'video/webm' );
		$name  = ( $audio ? 'صدای ' : 'ضبط ' ) . $m->title . ' ' . MP_Jalali::format( MP_Util::today() ) . '.' . $ext;
		$file  = MP_Files::store_bytes( $audio ? 'meeting_audio' : 'meeting_rec', $m->id, $name, $mime, '', $ext );
		if ( ! $file ) {
			return self::err( 'ساخت فایل ضبط انجام نشد.', 500 );
		}
		if ( ! $audio ) {
			$wpdb->update( self::t(), array( 'recording' => 1 ), array( 'id' => $m->id ) );
		}
		return array( 'file' => (int) $file->id );
	}

	/** POST meetings/{id}/rec-chunk?file= (raw bytes) — appends the next piece of a recording. */
	public static function rec_chunk( WP_REST_Request $r ) {
		global $wpdb;
		$m = self::rec_meeting( $r );
		$f = $m ? MP_Files::get( (int) $r['file'] ) : null;
		if ( ! $f || (int) $f->context_id !== (int) $m->id || ! in_array( $f->context, array( 'meeting_rec', 'meeting_audio' ), true ) ) {
			return self::err( 'دسترسی ندارید.', 403 );
		}
		$bytes = $r->get_body();
		if ( strlen( $bytes ) > 20 * MB_IN_BYTES ) {
			return self::err( 'تکه ضبط بزرگ است.' );
		}
		$path = MP_Files::dir() . '/' . $f->path;
		file_put_contents( $path, $bytes, FILE_APPEND | LOCK_EX ); // phpcs:ignore
		clearstatcache( true, $path );
		$wpdb->update( self::t( 'files' ), array( 'size' => filesize( $path ) ), array( 'id' => $f->id ) );
		return array( 'size' => filesize( $path ) );
	}

	public static function rec_stop( WP_REST_Request $r ) {
		global $wpdb;
		$m = self::rec_meeting( $r );
		if ( ! $m ) {
			return self::err( 'فقط میزبان.', 403 );
		}
		$wpdb->update( self::t(), array( 'recording' => 0 ), array( 'id' => $m->id ) );
		foreach ( array_map( 'intval', (array) $r['files'] ) as $fid ) {
			$f = MP_Files::get( $fid );
			if ( $f && (int) $f->context_id === (int) $m->id && 0 === (int) $f->size ) {
				MP_Files::delete( $f->id ); // nothing was recorded
			}
		}
		return array( 'ok' => true );
	}

	/* ------------------------------------------------------------------ Reports */

	/** GET meetings/stats {from, to} — meetings held, hours, and per person attendance. */
	public static function stats( WP_REST_Request $r ) {
		global $wpdb;
		$from = MP_Util::valid_date( $r['from'] ) ? $r['from'] : gmdate( 'Y-m-d', strtotime( MP_Util::today() . ' -30 days' ) );
		$to   = MP_Util::valid_date( $r['to'] ) ? $r['to'] : MP_Util::today();
		$rows = $wpdb->get_results( $wpdb->prepare( 'SELECT p.*, m.title, m.created_by FROM ' . self::t( 'meeting_peers' ) . ' p JOIN ' . self::t() . ' m ON m.id = p.meeting_id WHERE p.joined_at IS NOT NULL AND DATE(p.joined_at) BETWEEN %s AND %s', $from, $to ) );
		$held = array();
		$per  = array();
		foreach ( $rows as $p ) {
			$day = $p->meeting_id . '|' . substr( $p->joined_at, 0, 10 );
			$end = $p->left_at ? $p->left_at : ( $p->seen_at ? $p->seen_at : $p->joined_at );
			$sec = max( 0, self::ts( $end ) - self::ts( $p->joined_at ) );
			if ( ! isset( $held[ $day ] ) ) {
				$held[ $day ] = array( 'start' => $p->joined_at, 'end' => $end );
			}
			$held[ $day ]['start'] = min( $held[ $day ]['start'], $p->joined_at );
			$held[ $day ]['end']   = max( $held[ $day ]['end'], $end );
			if ( ! $p->user_id ) {
				continue;
			}
			if ( ! isset( $per[ $p->user_id ] ) ) {
				$per[ $p->user_id ] = array( 'user_id' => (int) $p->user_id, 'meetings' => array(), 'seconds' => 0 );
			}
			$per[ $p->user_id ]['meetings'][ $day ] = 1;
			$per[ $p->user_id ]['seconds']         += $sec;
		}
		$total = 0;
		foreach ( $held as $h ) {
			$total += max( 0, self::ts( $h['end'] ) - self::ts( $h['start'] ) );
		}
		$invited = array();
		foreach ( $wpdb->get_results( $wpdb->prepare( 'SELECT mp.user_id, COUNT(*) n FROM ' . self::t( 'meeting_people' ) . ' mp JOIN ' . self::t() . " m ON m.id = mp.meeting_id WHERE m.meeting_date BETWEEN %s AND %s AND m.status = 'ended' GROUP BY mp.user_id", $from, $to ) ) as $i ) {
			$invited[ (int) $i->user_id ] = (int) $i->n;
		}
		$people = array();
		foreach ( $per as $uid => $x ) {
			$people[] = array( 'user_id' => $uid, 'meetings' => count( $x['meetings'] ), 'minutes' => (int) round( $x['seconds'] / 60 ), 'invited' => isset( $invited[ $uid ] ) ? $invited[ $uid ] : 0 );
		}
		foreach ( $invited as $uid => $n ) {
			if ( ! isset( $per[ $uid ] ) ) {
				$people[] = array( 'user_id' => $uid, 'meetings' => 0, 'minutes' => 0, 'invited' => $n );
			}
		}
		usort( $people, function ( $a, $b ) { return $b['minutes'] - $a['minutes']; } );
		if ( ! MP_Util::is_manager() ) {
			// Colleagues see only their own attendance (attendance page).
			$me     = get_current_user_id();
			$people = array_values( array_filter( $people, function ( $x ) use ( $me ) { return (int) $x['user_id'] === $me; } ) );
		}
		return array( 'from' => $from, 'to' => $to, 'meetings' => count( $held ), 'minutes' => (int) round( $total / 60 ), 'avg' => count( $held ) ? (int) round( $total / 60 / count( $held ) ) : 0, 'people' => $people );
	}

	/** Attendance sheet (Excel) for one meeting. */
	public static function export( $id ) {
		$m = self::get( (int) $id );
		if ( ! $m || ! self::can_see( $m, get_current_user_id() ) ) {
			status_header( 404 );
			exit( 'Not found' );
		}
		$rows = array( array( 'نام', 'نقش', 'اولین ورود', 'آخرین حضور', 'دفعات ورود', 'مدت حضور (دقیقه)', 'وضعیت' ) );
		$role = array( 'host' => 'میزبان', 'cohost' => 'میزبان کمکی', 'member' => 'همکار', 'guest' => 'مهمان' );
		foreach ( self::attendance( $m ) as $a ) {
			$rows[] = array(
				$a['name'],
				isset( $role[ $a['role'] ] ) ? $role[ $a['role'] ] : $a['role'],
				$a['first'] ? MP_Jalali::format( substr( $a['first'], 0, 10 ) ) . ' ' . substr( $a['first'], 11, 5 ) : '',
				$a['last'] ? substr( $a['last'], 11, 5 ) : '',
				(int) $a['times'],
				(int) round( $a['seconds'] / 60 ),
				! empty( $a['absent'] ) ? 'غایب' : 'حاضر',
			);
		}
		MP_Export::workbook( array( array( 'name' => 'حضور جلسه', 'rows' => $rows, 'widths' => array( 24, 12, 22, 12, 12, 16, 10 ) ) ), 'meeting-' . $m->id . '-attendance.xlsx' );
	}

	/** Cron (every 5 min): reminders 10 minutes before, with the link, to the team and to invited guests. */
	public static function tick() {
		global $wpdb;
		self::roll_all();
		if ( ! self::settings()['remind'] ) {
			return;
		}
		$now  = current_time( 'H:i' );
		$soon = gmdate( 'H:i', strtotime( current_time( 'Y-m-d H:i' ) . ' UTC' ) + 10 * MINUTE_IN_SECONDS );
		$rows = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::t() . " WHERE meeting_date = %s AND meeting_time > %s AND meeting_time <= %s AND status = 'scheduled' AND permanent = 0", current_time( 'Y-m-d' ), $now, $soon ) );
		foreach ( $rows as $m ) {
			$key = 'mp_meeting_alert_' . $m->id;
			if ( get_transient( $key ) ) {
				continue;
			}
			set_transient( $key, 1, DAY_IN_SECONDS );
			$link   = self::link( $m->token );
			$people = array_unique( array_merge( self::people( $m->id ), array( (int) $m->created_by ) ) );
			foreach ( $people as $p ) {
				MP_Notify::event( 'meet_remind', $p, array( 'TITLE' => $m->title, 'TIME' => MP_Jalali::digits( $m->meeting_time ), 'LINK' => $link ), 'meetings', $m->id, true );
			}
			foreach ( $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'meeting_invites' ) . " WHERE meeting_id = %d AND phone <> ''", $m->id ) ) as $i ) {
				MP_Messages::send_sms( 'meet_guest_remind', $i->phone, array( 'TITLE' => $m->title, 'TIME' => MP_Jalali::digits( $m->meeting_time ), 'LINK' => add_query_arg( 'i', $i->code, $link ) ) );
			}
		}
	}

	/** Meetings with a link for the client portal. */
	public static function for_portal( $channel ) {
		global $wpdb;
		$out = array();
		foreach ( $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::t() . " WHERE channel_id = %d AND (status = 'live' OR meeting_date >= %s) ORDER BY meeting_date, meeting_time LIMIT 10", $channel->id, MP_Util::today() ) ) as $m ) {
			$m     = self::check_time( $m );
			$out[] = array( 'title' => $m->title, 'date' => $m->meeting_date, 'time' => $m->meeting_time, 'status' => $m->status, 'duration' => (int) $m->duration, 'link' => self::client_link( $m, $channel->token ) );
		}
		return $out;
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

	private static function in_peer( WP_REST_Request $r ) {
		$m  = self::room( $r );
		$me = $m ? self::me( $m, $r ) : null;
		return $me && 'in' === $me->state ? array( $m, $me ) : null;
	}

	private static function privileged( $p ) {
		return in_array( $p->role, array( 'host', 'cohost' ), true );
	}

	/** A host or co-host of the room. */
	private static function host_peer( WP_REST_Request $r ) {
		$h = self::in_peer( $r );
		return $h && self::privileged( $h[1] ) ? $h : null;
	}

	private static function ip() {
		return isset( $_SERVER['REMOTE_ADDR'] ) ? preg_replace( '/[^0-9a-f:.]/i', '', (string) $_SERVER['REMOTE_ADDR'] ) : ''; // phpcs:ignore
	}

	/** Who is opening the page: panel user, portal client or invited guest. */
	private static function visitor( $m, WP_REST_Request $r ) {
		global $wpdb;
		$uid = get_current_user_id();
		$uid = $uid && MP_Util::is_panel_user( $uid ) ? $uid : 0;
		$v   = array( 'uid' => $uid, 'client' => null, 'invite' => null );
		$ct  = preg_replace( '/[^A-Za-z0-9]/', '', (string) $r['c'] );
		if ( $ct && $m->channel_id && hash_equals( substr( hash_hmac( 'sha256', 'mp-meet-client|' . $m->token . '|' . $ct, wp_salt( 'auth' ) ), 0, 24 ), (string) $r['cs'] ) ) {
			$ch = MP_Client::channel( $ct );
			if ( $ch && (int) $ch->id === (int) $m->channel_id ) {
				$v['client'] = $ch;
			}
		}
		$code = preg_replace( '/[^a-z0-9]/', '', strtolower( (string) $r['i'] ) );
		if ( $code ) {
			$v['invite'] = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'meeting_invites' ) . ' WHERE meeting_id = %d AND code = %s', $m->id, $code ) );
		}
		return $v;
	}

	/** GET room/{token}: what the join screen needs. */
	public static function room_info( WP_REST_Request $r ) {
		$m = self::room( $r );
		if ( ! $m ) {
			return self::err( 'جلسه پیدا نشد.', 404 );
		}
		$v    = self::visitor( $m, $r );
		$uid  = $v['uid'];
		$user = $uid ? get_userdata( $uid ) : null;
		$host = get_userdata( $m->created_by );
		$inv  = $v['invite'];
		$users = array();
		if ( $uid ) {
			foreach ( MP_Util::panel_users() as $id ) {
				$u = get_userdata( $id );
				if ( $u ) {
					$users[] = array( 'id' => (int) $id, 'name' => $u->display_name );
				}
			}
		}
		return array(
			'title'     => $m->title,
			'date'      => $m->meeting_date,
			'time'      => $m->meeting_time,
			'status'    => $m->status,
			'permanent' => (bool) $m->permanent,
			'locked'    => (bool) $m->locked,
			'host'      => $host ? $host->display_name : '',
			'duration'  => (int) $m->duration,
			'password'  => '' !== $m->password && ! $uid && ! $v['client'] && ! ( $inv && ( ! $inv->used_at || $inv->ckey ) ),
			'invite'    => $inv ? array( 'name' => $inv->name, 'used' => (bool) $inv->used_at ) : null,
			'client'    => $v['client'] ? ( $v['client']->client_name ? $v['client']->client_name : '' ) : null,
			'user'      => $user ? array( 'id' => $uid, 'name' => $user->display_name, 'avatar' => MP_Util::avatar_url( $uid ), 'host' => self::is_host( $m, $uid ) ) : null,
			'users'     => $users,
			'project'   => (int) $m->project_id,
			'ice'       => self::ice(),
			'mode'      => self::settings()['mode'],
			'video'     => self::settings()['video'],
			'relay'     => MP_URL . 'relay.php',
		);
	}

	/** POST room/{token}/join {name?, password?, ckey, i?, c?, cs?, caps?} → {peer, secret, state, role} */
	public static function room_join( WP_REST_Request $r ) {
		global $wpdb;
		$m = self::room( $r );
		if ( ! $m ) {
			return self::err( 'جلسه پیدا نشد.', 404 );
		}
		$v    = self::visitor( $m, $r );
		$uid  = $v['uid'];
		$host = self::is_host( $m, $uid );
		$ckey = preg_replace( '/[^A-Za-z0-9]/', '', (string) $r['ckey'] );
		$now  = MP_Util::now();
		if ( 'ended' === $m->status && ! $host ) {
			return self::err( 'این جلسه به پایان رسیده است.', 410 );
		}
		// Coming back after a dropped connection (same browser or same account, recently in the room).
		$back = null;
		if ( $ckey || $uid ) {
			$back = $wpdb->get_row(
				$wpdb->prepare(
					'SELECT * FROM ' . self::t( 'meeting_peers' ) . " WHERE meeting_id = %d AND joined_at IS NOT NULL AND state IN ('in','left') AND (" . ( $uid ? 'user_id = %d' : 'ckey = %s' ) . ') AND COALESCE(left_at, seen_at) >= %s ORDER BY id DESC LIMIT 1',
					$m->id,
					$uid ? $uid : $ckey,
					gmdate( 'Y-m-d H:i:s', self::ts() - self::REJOIN )
				)
			);
			if ( $back && in_array( $back->state, array( 'kicked', 'rejected' ), true ) ) {
				$back = null;
			}
		}
		$inv = $v['invite'];
		if ( $inv && $inv->used_at && ( ! $ckey || $inv->ckey !== $ckey ) ) {
			return self::err( 'این لینک دعوت قبلاً استفاده شده است؛ از میزبان لینک تازه بخواهید.', 403 );
		}
		if ( $m->locked && ! $host && ! $back ) {
			return self::err( 'میزبان جلسه را قفل کرده است و ورود تازه ممکن نیست.', 423 );
		}
		$pre = $uid || $v['client'] || $inv || $back; // no password needed
		if ( ! $pre && '' !== $m->password ) {
			$lk    = 'mp_meet_pw_' . md5( self::ip() . '|' . $m->id );
			$tries = (int) get_transient( $lk );
			if ( $tries >= 5 ) {
				return self::err( 'به دلیل تلاش‌های ناموفق، ورود ۱۵ دقیقه بسته شد.', 429 );
			}
			if ( ! hash_equals( $m->password, trim( (string) $r['password'] ) ) ) {
				set_transient( $lk, $tries + 1, 15 * MINUTE_IN_SECONDS );
				return self::err( 'رمز جلسه درست نیست.' . ( $tries >= 2 ? ' (' . MP_Jalali::digits( (string) ( 4 - $tries ) ) . ' تلاش دیگر)' : '' ), 403 );
			}
		}
		$name = $uid ? wp_get_current_user()->display_name : MP_Util::text( $r['name'], 60 );
		if ( '' === $name && $inv ) {
			$name = $inv->name;
		}
		if ( '' === $name && $v['client'] ) {
			$name = $v['client']->client_name;
		}
		if ( '' === $name ) {
			return self::err( 'نام خود را وارد کنید.' );
		}
		if ( $host && 'live' !== $m->status ) {
			$wpdb->update( self::t(), array( 'status' => 'live', 'started_at' => $now, 'ended_at' => null ), array( 'id' => $m->id ) );
			if ( 'scheduled' === $m->status && ! $m->permanent ) {
				foreach ( self::people( $m->id ) as $p ) {
					if ( $p !== $uid ) {
						MP_Notify::event( 'meet_started', $p, array( 'TITLE' => $m->title, 'LINK' => self::link( $m->token ) ), 'meetings', $m->id );
					}
				}
			}
			$m = self::get( $m->id );
		}
		// A team room goes live with whoever comes first.
		if ( $m->permanent && 'live' !== $m->status ) {
			$wpdb->update( self::t(), array( 'status' => 'live', 'started_at' => $now, 'ended_at' => null ), array( 'id' => $m->id ) );
			$m = self::get( $m->id );
		}
		$role = $host ? 'host' : ( $back && 'cohost' === $back->role ? 'cohost' : ( $uid ? 'member' : 'guest' ) );
		$wait = ! $host && ! $back && ! $inv && ! $v['client'] && ( 'all' === $m->waiting || ( 'guests' === $m->waiting && ! $uid ) );
		// The same person on a second tab replaces the first one.
		if ( $uid ) {
			$wpdb->query( $wpdb->prepare( 'UPDATE ' . self::t( 'meeting_peers' ) . " SET state = 'left', left_at = %s WHERE meeting_id = %d AND user_id = %d AND state IN ('in','waiting')", $now, $m->id, $uid ) ); // phpcs:ignore
		} elseif ( $ckey ) {
			$wpdb->query( $wpdb->prepare( 'UPDATE ' . self::t( 'meeting_peers' ) . " SET state = 'left', left_at = %s WHERE meeting_id = %d AND ckey = %s AND state IN ('in','waiting')", $now, $m->id, $ckey ) ); // phpcs:ignore
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
				'ckey'       => $ckey,
				'caps'       => MP_Util::text( $r['caps'], 160 ),
				'allow_mic'  => $back ? (int) $back->allow_mic : 0,
				'mic'        => $r['mic'] && 'false' !== $r['mic'] ? 1 : 0,
				'cam'        => $r['cam'] && 'false' !== $r['cam'] ? 1 : 0,
				'created_at' => $now,
				'joined_at'  => $wait ? null : $now,
				'seen_at'    => $now,
			)
		);
		$pid = (int) $wpdb->insert_id;
		if ( $inv && ! $inv->used_at ) {
			$wpdb->update( self::t( 'meeting_invites' ), array( 'used_at' => $now, 'ckey' => $ckey ), array( 'id' => $inv->id ) );
		}
		return array( 'peer' => $pid, 'secret' => $secret, 'state' => $wait ? 'waiting' : 'in', 'role' => $role, 'back' => (bool) $back );
	}

	private static function chat_payload( $c, $me_id ) {
		$file = $c->file_id ? MP_Files::get( $c->file_id ) : null;
		$meta = $c->meta ? json_decode( $c->meta, true ) : null;
		return array(
			'id'   => (int) $c->id,
			'peer' => (int) $c->peer_id,
			'user' => (int) $c->user_id,
			'name' => $c->name,
			'kind' => $c->kind,
			'body' => (string) $c->body,
			'file' => $file ? array( 'name' => $file->name, 'size' => (int) $file->size, 'image' => 0 === strpos( $file->mime, 'image/' ), 'url' => self::file_url( $file->id ) ) : null,
			'meta' => $meta,
			'mine' => $me_id && (int) $c->peer_id === (int) $me_id,
			'at'   => $c->created_at,
		);
	}

	/** The design shown to everyone, with its comments. */
	private static function stage_payload( $m ) {
		global $wpdb;
		$st = $m->stage ? json_decode( $m->stage, true ) : null;
		if ( ! is_array( $st ) || empty( $st['item'] ) ) {
			return null;
		}
		$x = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'client_items' ) . ' WHERE id = %d', (int) $st['item'] ) );
		if ( ! $x || ! $x->file_id ) {
			return null;
		}
		$pins = array();
		foreach ( $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'design_pins' ) . ' WHERE item_id = %d ORDER BY id', $x->id ) ) as $p ) {
			$pins[] = array( 'id' => (int) $p->id, 'x' => (float) $p->x, 'y' => (float) $p->y, 'body' => $p->body, 'name' => $p->author_name ? $p->author_name : ( $p->user_id ? get_the_author_meta( 'display_name', $p->user_id ) : '' ), 'parent' => (int) $p->parent_id, 'resolved' => (bool) $p->resolved );
		}
		return array( 'item' => (int) $x->id, 'title' => $x->title, 'version' => (int) $x->version, 'url' => self::file_url( $x->file_id ), 'pins' => $pins );
	}

	/** POST room/{token}/poll {peer, secret, after, chat, wants{peer:hi|lo|off}} → everything the room page shows. */
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
			$f = array( 'seen_at' => $now );
			if ( is_array( $r['wants'] ) ) {
				$w = array();
				foreach ( $r['wants'] as $k => $val ) {
					$w[ (int) $k ] = MP_Util::pick( (string) $val, array( 'hi', 'lo', 'off' ), 'lo' );
				}
				$f['wants'] = substr( wp_json_encode( $w ), 0, 400 );
			}
			$wpdb->update( self::t( 'meeting_peers' ), $f, array( 'id' => $me->id ) );
		}
		self::sweep( $m );
		$after = (int) $r['after'];
		if ( $after ) {
			$wpdb->query( $wpdb->prepare( 'DELETE FROM ' . self::t( 'meeting_signals' ) . ' WHERE to_peer = %d AND id <= %d', $me->id, $after ) ); // phpcs:ignore
		}
		$priv    = self::privileged( $me );
		$peers   = array();
		$waiting = array();
		$need    = 'off';
		$rank    = array( 'off' => 0, 'lo' => 1, 'hi' => 2 );
		foreach ( $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'meeting_peers' ) . " WHERE meeting_id = %d AND state IN ('in','waiting') ORDER BY id", $m->id ) ) as $p ) {
			$row = array(
				'id'     => (int) $p->id,
				'name'   => $p->name,
				'role'   => $p->role,
				'user'   => (int) $p->user_id,
				'mic'    => (bool) $p->mic,
				'cam'    => (bool) $p->cam,
				'hand'   => (bool) $p->hand,
				'share'  => (bool) $p->share,
				'away'   => (bool) $p->away,
				'allow'  => (bool) $p->allow_mic,
				'rtt'    => (int) $p->rtt,
				'caps'   => (string) $p->caps,
				'avatar' => $p->user_id ? MP_Util::avatar_url( $p->user_id ) : '',
			);
			if ( 'in' === $p->state ) {
				$peers[] = $row;
				if ( (int) $p->id !== (int) $me->id ) {
					// How large anyone wants to see me decides how large my picture is sent.
					$w = $p->wants ? json_decode( $p->wants, true ) : null;
					$x = is_array( $w ) && isset( $w[ $me->id ] ) ? $w[ $me->id ] : 'lo';
					if ( $rank[ $x ] > $rank[ $need ] ) {
						$need = $x;
					}
				}
			} elseif ( $priv ) {
				$waiting[] = $row;
			}
		}
		$signals = array();
		$chat    = array();
		$stage   = null;
		$relay   = '';
		if ( 'in' === $me->state ) {
			foreach ( $wpdb->get_results( $wpdb->prepare( 'SELECT id, from_peer, kind, body FROM ' . self::t( 'meeting_signals' ) . ' WHERE to_peer = %d AND id > %d ORDER BY id LIMIT 200', $me->id, $after ) ) as $s ) {
				$signals[] = array( 'id' => (int) $s->id, 'from' => (int) $s->from_peer, 'kind' => $s->kind, 'body' => json_decode( $s->body, true ) );
			}
			$ca = (int) $r['chat'];
			$q  = $ca ? $wpdb->prepare( 'SELECT * FROM ' . self::t( 'meeting_chat' ) . ' WHERE meeting_id = %d AND id > %d ORDER BY id LIMIT 100', $m->id, $ca )
				: $wpdb->prepare( 'SELECT * FROM (SELECT * FROM ' . self::t( 'meeting_chat' ) . " WHERE meeting_id = %d AND kind <> 'react' ORDER BY id DESC LIMIT 60) x ORDER BY id", $m->id );
			foreach ( $wpdb->get_results( $q ) as $c ) { // phpcs:ignore
				$chat[] = self::chat_payload( $c, $me->id );
			}
			$stage = self::stage_payload( $m );
			if ( 'relay' === self::settings()['mode'] ) {
				$relay = MP_Relay::issue( $m->token, $me->id );
				// Locked microphones are enforced by the relay, not only by the page.
				MP_Relay::mute( $m->token, $me->id, $m->mic_lock && ! $priv && ! $me->allow_mic );
			}
		}
		$hosts = 0;
		foreach ( $peers as $p ) {
			$hosts += in_array( $p['role'], array( 'host', 'cohost' ), true ) ? 1 : 0;
		}
		$end = self::ends_at( $m );
		return array(
			'status'    => $m->status,
			'me'        => array( 'id' => (int) $me->id, 'state' => $me->state, 'role' => $me->role, 'allow' => (bool) $me->allow_mic ),
			'peers'     => $peers,
			'waiting'   => $waiting,
			'host_here' => $hosts > 0,
			'signals'   => $signals,
			'chat'      => $chat,
			'stage'     => $stage,
			'locked'    => (bool) $m->locked,
			'mic_lock'  => (bool) $m->mic_lock,
			'recording' => (bool) $m->recording,
			'need'      => count( $peers ) > 1 ? $need : 'off',
			'remaining' => $end ? max( 0, $end - self::ts() ) : -1,
			'relay'     => $relay,
		);
	}

	/** POST room/{token}/signal {peer, secret, to, kind, body} — offer / answer / ice (WebRTC) and mute. */
	public static function room_signal( WP_REST_Request $r ) {
		global $wpdb;
		$h = self::in_peer( $r );
		if ( ! $h ) {
			return self::err( 'دسترسی ندارید.', 403 );
		}
		list( $m, $me ) = $h;
		$kind = MP_Util::pick( (string) $r['kind'], array( 'offer', 'answer', 'ice', 'mute', 'bye' ), '' );
		if ( '' === $kind || ( 'mute' === $kind && ! self::privileged( $me ) ) ) {
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

	/** POST room/{token}/state {peer, secret, mic?, cam?, hand?, share?, away?, rtt?, caps?} */
	public static function room_state( WP_REST_Request $r ) {
		global $wpdb;
		$m  = self::room( $r );
		$me = $m ? self::me( $m, $r ) : null;
		if ( ! $me ) {
			return self::err( 'دسترسی ندارید.', 403 );
		}
		$f = array();
		foreach ( array( 'mic', 'cam', 'hand', 'share', 'away' ) as $k ) {
			if ( null !== $r[ $k ] ) {
				$f[ $k ] = $r[ $k ] && 'false' !== $r[ $k ] ? 1 : 0;
			}
		}
		if ( ! empty( $f['mic'] ) && $m->mic_lock && ! self::privileged( $me ) && ! $me->allow_mic ) {
			$f['mic'] = 0; // microphones are locked by the host
		}
		if ( null !== $r['rtt'] ) {
			$f['rtt'] = max( 0, min( 65000, (int) $r['rtt'] ) );
		}
		if ( null !== $r['caps'] ) {
			$f['caps'] = MP_Util::text( $r['caps'], 160 );
		}
		if ( $f ) {
			$wpdb->update( self::t( 'meeting_peers' ), $f, array( 'id' => $me->id ) );
		}
		return array( 'ok' => true, 'mic' => isset( $f['mic'] ) ? (bool) $f['mic'] : null );
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
		$wpdb->query( $wpdb->prepare( 'UPDATE ' . self::t( 'meeting_peers' ) . " SET state = 'kicked', left_at = %s WHERE id = %d AND meeting_id = %d AND role NOT IN ('host')", MP_Util::now(), (int) $r['target'], $h[0]->id ) ); // phpcs:ignore
		MP_Relay::revoke( $h[0]->token, (int) $r['target'] );
		return array( 'ok' => true );
	}

	/**
	 * POST room/{token}/control {peer, secret, what, on?, target?} — host controls:
	 * lock (no new people), miclock (only allowed people talk), allow (let one person talk),
	 * muteall, cohost (make / unmake a co-host).
	 */
	public static function room_control( WP_REST_Request $r ) {
		global $wpdb;
		$h = self::host_peer( $r );
		if ( ! $h ) {
			return self::err( 'فقط میزبان.', 403 );
		}
		list( $m, $me ) = $h;
		$on     = $r['on'] && 'false' !== $r['on'];
		$target = (int) $r['target'];
		$peers  = self::t( 'meeting_peers' );
		switch ( (string) $r['what'] ) {
			case 'lock':
				$wpdb->update( self::t(), array( 'locked' => $on ? 1 : 0 ), array( 'id' => $m->id ) );
				self::system_chat( $m, $on ? 'میزبان جلسه را قفل کرد؛ ورود تازه ممکن نیست.' : 'قفل جلسه باز شد.' );
				break;
			case 'miclock':
				$wpdb->update( self::t(), array( 'mic_lock' => $on ? 1 : 0 ), array( 'id' => $m->id ) );
				$wpdb->query( $wpdb->prepare( "UPDATE $peers SET allow_mic = 0, hand = 0 WHERE meeting_id = %d", $m->id ) ); // phpcs:ignore
				if ( $on ) {
					self::mute_all( $m, $me );
				}
				self::system_chat( $m, $on ? 'میکروفون‌ها قفل شد؛ برای صحبت دست خود را بالا ببرید.' : 'قفل میکروفون‌ها برداشته شد.' );
				break;
			case 'allow':
				$wpdb->query( $wpdb->prepare( "UPDATE $peers SET allow_mic = %d, hand = 0 WHERE id = %d AND meeting_id = %d", $on ? 1 : 0, $target, $m->id ) ); // phpcs:ignore
				MP_Relay::mute( $m->token, $target, $m->mic_lock && ! $on );
				if ( ! $on ) {
					$wpdb->insert( self::t( 'meeting_signals' ), array( 'meeting_id' => $m->id, 'from_peer' => $me->id, 'to_peer' => $target, 'kind' => 'mute', 'body' => '{}', 'created_at' => MP_Util::now() ) );
				}
				break;
			case 'muteall':
				self::mute_all( $m, $me );
				break;
			case 'cohost':
				if ( 'host' !== $me->role ) {
					return self::err( 'فقط میزبان اصلی می‌تواند میزبان کمکی تعیین کند.', 403 );
				}
				$wpdb->query( $wpdb->prepare( "UPDATE $peers SET role = %s WHERE id = %d AND meeting_id = %d AND role <> 'host'", $on ? 'cohost' : ( 'member' ), $target, $m->id ) ); // phpcs:ignore
				$t = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $peers WHERE id = %d", $target ) ); // phpcs:ignore
				if ( $t && ! $on && ! $t->user_id ) {
					$wpdb->update( $peers, array( 'role' => 'guest' ), array( 'id' => $t->id ) );
				}
				if ( $t ) {
					self::system_chat( $m, $t->name . ( $on ? ' میزبان کمکی شد.' : ' دیگر میزبان کمکی نیست.' ) );
				}
				break;
			default:
				return self::err( 'دستور نامعتبر.' );
		}
		return array( 'ok' => true );
	}

	private static function mute_all( $m, $me ) {
		global $wpdb;
		foreach ( $wpdb->get_results( $wpdb->prepare( 'SELECT id, role FROM ' . self::t( 'meeting_peers' ) . " WHERE meeting_id = %d AND state = 'in' AND id <> %d", $m->id, $me->id ) ) as $p ) {
			if ( ! in_array( $p->role, array( 'host', 'cohost' ), true ) ) {
				$wpdb->insert( self::t( 'meeting_signals' ), array( 'meeting_id' => $m->id, 'from_peer' => $me->id, 'to_peer' => $p->id, 'kind' => 'mute', 'body' => '{}', 'created_at' => MP_Util::now() ) );
			}
		}
	}

	private static function system_chat( $m, $text, $meta = null ) {
		global $wpdb;
		$wpdb->insert( self::t( 'meeting_chat' ), array( 'meeting_id' => $m->id, 'kind' => 'system', 'name' => '', 'body' => $text, 'meta' => $meta ? wp_json_encode( $meta, JSON_UNESCAPED_UNICODE ) : null, 'created_at' => MP_Util::now() ) );
	}

	/** POST room/{token}/chat {peer, secret, body, kind?: msg|react|card, card?} */
	public static function room_chat( WP_REST_Request $r ) {
		global $wpdb;
		$h = self::in_peer( $r );
		if ( ! $h ) {
			return self::err( 'دسترسی ندارید.', 403 );
		}
		list( $m, $me ) = $h;
		$kind = MP_Util::pick( (string) $r['kind'], array( 'msg', 'react', 'card', 'system' ), 'msg' );
		$body = 'react' === $kind ? MP_Util::pick( (string) $r['body'], array( '👍', '❤️', '😂', '👏', '🎉', '🙏' ), '👍' ) : MP_Util::long_text( $r['body'], 2000 );
		$meta = null;
		if ( 'system' === $kind ) {
			if ( ! $me->user_id ) {
				return self::err( 'دسترسی ندارید.', 403 );
			}
			$kind = 'system';
		}
		if ( 'card' === $kind ) {
			// A contract of this meeting's project, sent by a host for signing during the meeting.
			if ( ! self::privileged( $me ) || ! $me->user_id ) {
				return self::err( 'فقط میزبان.', 403 );
			}
			$token = preg_replace( '/[^A-Za-z0-9]/', '', (string) $r['card'] );
			$c     = $token ? MP_Contracts::by_token( $token ) : null;
			if ( ! $c || ( $m->project_id && (int) $c->project_id !== (int) $m->project_id ) ) {
				return self::err( 'قرارداد پیدا نشد.', 404 );
			}
			$meta = array( 't' => 'contract', 'title' => $c->title, 'number' => $c->number, 'url' => MP_Contracts::url( $c->token ), 'status' => $c->status );
			$body = 'قرارداد «' . $c->title . '» برای مطالعه و امضا';
		}
		if ( '' === trim( $body ) ) {
			return self::err( 'پیام خالی است.' );
		}
		$wpdb->insert( self::t( 'meeting_chat' ), array( 'meeting_id' => $m->id, 'peer_id' => $me->id, 'user_id' => $me->user_id, 'name' => $me->name, 'kind' => $kind, 'body' => $body, 'meta' => $meta ? wp_json_encode( $meta, JSON_UNESCAPED_UNICODE ) : null, 'created_at' => MP_Util::now() ) );
		return self::chat_payload( $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'meeting_chat' ) . ' WHERE id = %d', $wpdb->insert_id ) ), $me->id );
	}

	/** POST room/{token}/chat-file (multipart: peer, secret, file) */
	public static function room_chat_file( WP_REST_Request $r ) {
		global $wpdb;
		$h = self::in_peer( $r );
		if ( ! $h ) {
			return self::err( 'دسترسی ندارید.', 403 );
		}
		list( $m, $me ) = $h;
		$file = MP_Files::store( 'meeting', $m->id );
		if ( is_wp_error( $file ) ) {
			return $file;
		}
		$wpdb->insert( self::t( 'meeting_chat' ), array( 'meeting_id' => $m->id, 'peer_id' => $me->id, 'user_id' => $me->user_id, 'name' => $me->name, 'kind' => 'msg', 'body' => MP_Util::long_text( $r['body'], 500 ), 'file_id' => $file->id, 'created_at' => MP_Util::now() ) );
		return self::chat_payload( $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'meeting_chat' ) . ' WHERE id = %d', $wpdb->insert_id ) ), $me->id );
	}

	/** POST room/{token}/library {peer, secret} — designs and contracts of the meeting's project, for hosts to show. */
	public static function room_library( WP_REST_Request $r ) {
		global $wpdb;
		$h = self::host_peer( $r );
		if ( ! $h || ! $h[1]->user_id ) {
			return self::err( 'فقط میزبان.', 403 );
		}
		$m       = $h[0];
		$designs = array();
		$pid     = (int) $m->project_id;
		$rows    = $pid ? $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'client_items' ) . " WHERE project_id = %d AND kind = 'design' AND archived_at IS NULL AND status <> 'superseded' ORDER BY id DESC LIMIT 40", $pid ) )
			: $wpdb->get_results( 'SELECT * FROM ' . self::t( 'client_items' ) . " WHERE kind = 'design' AND archived_at IS NULL AND status <> 'superseded' ORDER BY id DESC LIMIT 40" ); // phpcs:ignore
		foreach ( $rows as $x ) {
			if ( $x->file_id ) {
				$designs[] = array( 'id' => (int) $x->id, 'title' => $x->title, 'version' => (int) $x->version, 'url' => self::file_url( $x->file_id ) );
			}
		}
		return array( 'designs' => $designs, 'contracts' => $pid ? MP_Contracts::for_portal( $pid ) : array() );
	}

	/** POST room/{token}/stage {peer, secret, item} — show a design to everyone (0 hides it). */
	public static function room_stage( WP_REST_Request $r ) {
		global $wpdb;
		$h = self::host_peer( $r );
		if ( ! $h ) {
			return self::err( 'فقط میزبان.', 403 );
		}
		$item = (int) $r['item'];
		$wpdb->update( self::t(), array( 'stage' => $item ? wp_json_encode( array( 'item' => $item ) ) : null ), array( 'id' => $h[0]->id ) );
		return array( 'ok' => true );
	}

	/** POST room/{token}/pin {peer, secret, x, y, body} — a comment on the design on show, saved with the design. */
	public static function room_pin( WP_REST_Request $r ) {
		global $wpdb;
		$h = self::in_peer( $r );
		if ( ! $h ) {
			return self::err( 'دسترسی ندارید.', 403 );
		}
		list( $m, $me ) = $h;
		$st   = $m->stage ? json_decode( $m->stage, true ) : null;
		$body = MP_Util::long_text( $r['body'], 1000 );
		if ( ! is_array( $st ) || empty( $st['item'] ) || '' === $body ) {
			return self::err( 'طرحی نمایش داده نمی‌شود.' );
		}
		$wpdb->insert(
			self::t( 'design_pins' ),
			array(
				'item_id'     => (int) $st['item'],
				'x'           => max( 0, min( 100, (float) $r['x'] ) ),
				'y'           => max( 0, min( 100, (float) $r['y'] ) ),
				'body'        => $body,
				'user_id'     => (int) $me->user_id,
				'author_name' => $me->user_id ? '' : $me->name,
				'created_at'  => MP_Util::now(),
			)
		);
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

	/** POST room/{token}/relay — the media relay through WordPress, when relay.php can't be used. */
	public static function room_relay( WP_REST_Request $r ) {
		if ( ! self::by_token( (string) $r['token'] ) ) {
			return self::err( 'جلسه پیدا نشد.', 404 );
		}
		$d   = $r->get_body_params();
		$res = MP_Relay::handle( MP_Relay::base_wp(), $r->get_query_params(), MP_Relay::body( isset( $d['d'] ) ? (string) $d['d'] : null, $r->get_body() ) );
		MP_Relay::reply( $res, ! empty( $r->get_query_params()['t'] ) );
	}

	public static function room_end( WP_REST_Request $r ) {
		$h = self::host_peer( $r );
		if ( ! $h || 'host' !== $h[1]->role ) {
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
