<?php
defined( 'ABSPATH' ) || exit;

/**
 * Automatic attendance from «مربع چت» for Windows: the computer itself says when someone is working.
 *
 * Every minute (and on lock, unlock, sleep, wake, shutdown) the app reports, per device: how long since the
 * last keyboard/mouse input, whether the session is locked, and whether something keeps the screen awake
 * (a video call or a meeting). From that:
 * - a person counts as present while any of their devices is active: input in the last few minutes
 *   (option mp_presence_idle, default 5), not locked — or a call/meeting holding the screen on;
 * - the attendance session (source «auto») starts at the first input and ends at the last input, so idle
 *   minutes, lock, sleep and shutdown never count;
 * - when reports stop (sleep, shutdown, no internet, the app closed) the session ends at the last report;
 *   a short break in reports (under GAP) does not split it, nor does a gap of under MERGE minutes between two
 *   pieces of work;
 * - a session never crosses midnight: it is cut at 23:59:59 and goes on in the new day;
 * - a manual «خروج» pauses automatic attendance until the person checks in again or the next day; a manual
 *   open session is left alone.
 * Times are the site's local time (MP_Util::now); $now can be given for tests.
 */
class MP_Presence {

	/** Seconds without a report after which a device counts as gone (it reports every 60 s). */
	const GAP = 180;
	/** Two pieces of work closer than this (seconds) stay one session. */
	const MERGE = 120;

	public static function register() {
		register_rest_route(
			MP_Rest::NS,
			'/presence',
			array(
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'beat_route' ),
				'permission_callback' => array( 'MP_Rest', 'can_access' ),
			)
		);
		register_rest_route(
			MP_Rest::NS,
			'/attendance/(?P<id>\\d+)/review',
			array(
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'review' ),
				'permission_callback' => array( 'MP_Rest', 'can_manage' ),
			)
		);
		register_rest_route(
			MP_Rest::NS,
			'/presence/settings',
			array(
				'methods'             => 'GET, POST',
				'callback'            => array( __CLASS__, 'settings' ),
				'permission_callback' => array( 'MP_Rest', 'can_manage' ),
			)
		);
	}

	/** GET presence/settings · POST presence/settings {on, idle} (supervisors) */
	public static function settings( WP_REST_Request $r ) {
		if ( 'POST' === $r->get_method() ) {
			if ( null !== $r['on'] ) {
				update_option( 'mp_presence_on', $r['on'] && 'false' !== $r['on'] ? 1 : 0 );
			}
			if ( null !== $r['idle'] ) {
				update_option( 'mp_presence_idle', max( 1, min( 60, (int) $r['idle'] ) ) );
			}
			MP_Audit::log( 'update', 'attendance', 0, 'حضور خودکار: ' . ( self::enabled() ? 'روشن، بیکاری ' . MP_Jalali::digits( (int) get_option( 'mp_presence_idle', 5 ) ) . ' دقیقه' : 'خاموش' ) );
		}
		return array( 'on' => self::enabled(), 'idle' => (int) get_option( 'mp_presence_idle', 5 ) );
	}

	private static function t() {
		return MP_Install::table( 'attendance' );
	}

	public static function enabled() {
		return (bool) get_option( 'mp_presence_on', 1 );
	}

	public static function idle_limit() {
		return max( 60, min( 3600, (int) get_option( 'mp_presence_idle', 5 ) * 60 ) );
	}

	private static function now_ts() {
		return strtotime( MP_Util::now() );
	}

	private static function fmt( $ts ) {
		return gmdate( 'Y-m-d H:i:s', (int) $ts );
	}

	/** POST presence {active?, idle (seconds), locked, busy (call/meeting keeps the screen on), ev, device} */
	public static function beat_route( WP_REST_Request $r ) {
		$device = preg_replace( '/[^A-Za-z0-9_-]/', '', (string) $r['device'] );
		$ev     = MP_Util::pick( (string) $r['ev'], array( 'tick', 'lock', 'unlock', 'sleep', 'wake', 'end', 'start' ), 'tick' );
		// The Windows app runs on WebView2, whose browser name says «Edg/»; anything else is noted for review.
		$ua     = isset( $_SERVER['HTTP_USER_AGENT'] ) ? (string) $_SERVER['HTTP_USER_AGENT'] : ''; // phpcs:ignore
		$state  = self::beat( get_current_user_id(), substr( '' !== $device ? $device : 'web', 0, 40 ), max( 0, (int) $r['idle'] ), ! empty( $r['locked'] ) && 'false' !== $r['locked'], ! empty( $r['busy'] ) && 'false' !== $r['busy'], $ev, 0, false !== stripos( $ua, 'Edg/' ) );
		return $state;
	}

	/**
	 * One report from one device. Returns {enabled, present, since} for the app.
	 *
	 * @param int    $uid    Panel user.
	 * @param string $device The computer's id (the Windows app keeps one per installation).
	 * @param int    $idle   Seconds since the last keyboard/mouse input on that computer.
	 * @param bool   $locked The Windows session is locked.
	 * @param bool   $busy   Something keeps the screen on (call, meeting, video): counts as active.
	 * @param string $ev     tick | lock | unlock | sleep | wake | end | start.
	 * @param int    $now    Local time as a timestamp (tests); default now.
	 */
	public static function beat( $uid, $device, $idle, $locked, $busy, $ev = 'tick', $now = 0, $app_ua = true ) {
		global $wpdb;
		$now = $now ? (int) $now : self::now_ts();
		if ( ! self::enabled() || ! $uid ) {
			return array( 'enabled' => false, 'present' => false, 'since' => '' );
		}
		$going  = in_array( $ev, array( 'lock', 'sleep', 'end' ), true );
		$active = ! $going && ! $locked && ( $busy || $idle < self::idle_limit() );
		// The last input on this device; a call/meeting counts as input right now.
		$input = $active && $busy ? $now : $now - min( $idle, 86400 );
		if ( $going ) {
			$input = $now - min( $idle, 86400 );
		}
		$devices = get_user_meta( $uid, 'mp_presence_devices', true );
		$devices = is_array( $devices ) ? $devices : array();
		$devices[ $device ] = array( 't' => $now, 'a' => $active ? 1 : 0, 'i' => $input );
		// Forget devices silent for a day.
		foreach ( $devices as $k => $d ) {
			if ( $now - (int) $d['t'] > DAY_IN_SECONDS ) {
				unset( $devices[ $k ] );
			}
		}
		update_user_meta( $uid, 'mp_presence_devices', $devices );

		$any_active = false;
		$last_input = 0;
		foreach ( $devices as $d ) {
			$fresh = $now - (int) $d['t'] <= self::GAP;
			if ( $fresh && $d['a'] ) {
				$any_active = true;
			}
			$last_input = max( $last_input, (int) $d['i'] );
		}

		$open = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t() . ' WHERE user_id = %d AND check_out IS NULL ORDER BY id DESC LIMIT 1', $uid ) );
		if ( $open && 'auto' !== $open->source ) {
			// A manual check-in is running: the person is present by their own word.
			return array( 'enabled' => true, 'present' => true, 'since' => $open->check_in, 'manual' => true );
		}
		// Reports stopped for a while (sleep, shutdown, no internet): the session ended at its last report.
		if ( $open && $open->last_beat && $now - strtotime( $open->last_beat ) > self::GAP ) {
			self::close( $open, strtotime( $open->last_beat ) );
			$open = null;
		}
		// A manual check-out today pauses automatic attendance until a manual check-in or tomorrow.
		$paused = get_user_meta( $uid, 'mp_presence_paused', true ) === gmdate( 'Y-m-d', $now );

		if ( $any_active && ! $paused ) {
			if ( $open ) {
				$open = self::split_midnight( $open, $now );
				$wpdb->update( self::t(), array( 'last_beat' => self::fmt( $now ) ), array( 'id' => $open->id ) );
				self::track( $open->id, $now, $idle, $busy, $device, $app_ua );
				return array( 'enabled' => true, 'present' => true, 'since' => $open->check_in );
			}
			$start = max( $input, $now - self::GAP ); // when this stretch of work began (not before the device came back)
			$start = min( $start, $now );
			// A short pause since the last automatic session: carry on with it.
			$last = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t() . " WHERE user_id = %d AND source = 'auto' AND check_out IS NOT NULL AND work_date = %s ORDER BY check_out DESC LIMIT 1", $uid, gmdate( 'Y-m-d', $now ) ) );
			if ( $last && $start - strtotime( $last->check_out ) <= self::MERGE && $start >= strtotime( $last->check_out ) ) {
				$wpdb->update( self::t(), array( 'check_out' => null, 'last_beat' => self::fmt( $now ) ), array( 'id' => $last->id ) );
				self::track( $last->id, $now, $idle, $busy, $device, $app_ua );
				return array( 'enabled' => true, 'present' => true, 'since' => $last->check_in );
			}
			if ( gmdate( 'Y-m-d', $start ) !== gmdate( 'Y-m-d', $now ) ) {
				$start = strtotime( gmdate( 'Y-m-d', $now ) . ' 00:00:00' );
			}
			$wpdb->insert(
				self::t(),
				array(
					'user_id'   => $uid,
					'work_date' => gmdate( 'Y-m-d', $start ),
					'check_in'  => self::fmt( $start ),
					'note'      => 'خودکار (مربع چت ویندوز)',
					'source'    => 'auto',
					'last_beat' => self::fmt( $now ),
				)
			);
			self::track( $wpdb->insert_id, $now, $idle, $busy, $device, $app_ua );
			MP_Live::bump();
			return array( 'enabled' => true, 'present' => true, 'since' => self::fmt( $start ) );
		}
		if ( $open ) {
			// Nobody at any device: the session ends at the last input (not before it began).
			$open->last_beat = self::fmt( $now );
			self::close( self::split_midnight( $open, $now ), max( strtotime( $open->check_in ), min( $now, $last_input ) ) );
		}
		return array( 'enabled' => true, 'present' => false, 'since' => '', 'paused' => $paused );
	}

	/**
	 * Signs that a session may not be real work, for a supervisor to look at (attendance.flags; «ok» once reviewed):
	 * idle0   — over 2 hours the report always says «input this very second» (a script, not a person);
	 * nobreak — more than 5 hours without even a 2-minute pause;
	 * night   — more than half an hour between midnight and 6 in the morning;
	 * device  — reports not from the Windows app's own device id;
	 * browser — reports not from the Windows app's browser (WebView2).
	 * Counters live in attendance.stats: b beats, z beats with idle ≤ 1 s, k last pause, n night beats.
	 */
	const FLAGS = array( 'idle0', 'nobreak', 'night', 'device', 'browser' );
	private static function track( $id, $now, $idle, $busy, $device, $app_ua ) {
		global $wpdb;
		$row = $wpdb->get_row( $wpdb->prepare( 'SELECT check_in, stats, flags FROM ' . self::t() . ' WHERE id = %d', $id ) );
		if ( ! $row ) {
			return;
		}
		$st = json_decode( (string) $row->stats, true );
		$st = is_array( $st ) ? $st : array( 'b' => 0, 'z' => 0, 'k' => strtotime( $row->check_in ), 'n' => 0 );
		$st['b']++;
		if ( $idle <= 1 && ! $busy ) {
			$st['z']++;
		}
		if ( $idle >= 120 ) {
			$st['k'] = $now;
		}
		if ( (int) gmdate( 'G', $now ) < 6 ) {
			$st['n']++;
		}
		$flags = 'ok' === $row->flags ? array() : array_filter( explode( ',', (string) $row->flags ) );
		if ( 'ok' !== $row->flags ) {
			if ( $st['b'] >= 120 && $st['z'] / $st['b'] >= 0.95 ) {
				$flags[] = 'idle0';
			}
			if ( $now - (int) $st['k'] > 5 * HOUR_IN_SECONDS ) {
				$flags[] = 'nobreak';
			}
			if ( $st['n'] >= 30 ) {
				$flags[] = 'night';
			}
			if ( ! preg_match( '/^w[0-9a-f]{20,}$/', (string) $device ) ) {
				$flags[] = 'device';
			}
			if ( ! $app_ua ) {
				$flags[] = 'browser';
			}
		}
		$flags = 'ok' === $row->flags ? 'ok' : implode( ',', array_values( array_unique( array_intersect( $flags, self::FLAGS ) ) ) );
		$wpdb->update( self::t(), array( 'stats' => wp_json_encode( $st ), 'flags' => $flags ), array( 'id' => $id ) );
	}

	/** POST attendance/{id}/review — a supervisor looked at a flagged automatic session and accepts it. */
	public static function review( WP_REST_Request $r ) {
		global $wpdb;
		$s = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t() . ' WHERE id = %d', (int) $r['id'] ) );
		if ( ! $s ) {
			return new WP_Error( 'mp_not_found', 'پیدا نشد.', array( 'status' => 404 ) );
		}
		$wpdb->update( self::t(), array( 'flags' => 'ok' ), array( 'id' => $s->id ) );
		$u = get_userdata( $s->user_id );
		MP_Audit::log( 'update', 'attendance', (int) $s->id, 'تأیید حضور خودکار ' . ( $u ? $u->display_name : '' ) . ' (' . MP_Jalali::digits( substr( $s->check_in, 0, 16 ) ) . ')' );
		return array( 'ok' => true );
	}

	/** Ends an automatic session at $end (never before its start, never after its last report or its day). */
	private static function close( $s, $end ) {
		global $wpdb;
		$start = strtotime( $s->check_in );
		$end   = max( $start, (int) $end );
		if ( $s->last_beat ) {
			$end = min( $end, strtotime( $s->last_beat ) );
		}
		$end = min( $end, strtotime( $s->work_date . ' 23:59:59' ) );
		$end = max( $start, $end );
		if ( $end - $start < 60 ) {
			// Under a minute is noise (a mouse bumped while passing by): not a session.
			$wpdb->delete( self::t(), array( 'id' => $s->id ) );
		} else {
			$wpdb->update( self::t(), array( 'check_out' => self::fmt( $end ) ), array( 'id' => $s->id ) );
		}
		MP_Live::bump();
	}

	/** An open session from an earlier day ends at 23:59:59 and goes on from 00:00:00 today. */
	private static function split_midnight( $s, $now ) {
		global $wpdb;
		$today = gmdate( 'Y-m-d', $now );
		if ( $s->work_date >= $today ) {
			return $s;
		}
		$wpdb->update( self::t(), array( 'check_out' => $s->work_date . ' 23:59:59', 'last_beat' => $s->work_date . ' 23:59:59' ), array( 'id' => $s->id ) );
		$wpdb->insert(
			self::t(),
			array(
				'user_id'   => $s->user_id,
				'work_date' => $today,
				'check_in'  => $today . ' 00:00:00',
				'note'      => $s->note,
				'source'    => 'auto',
				'last_beat' => self::fmt( $now ),
			)
		);
		return $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t() . ' WHERE id = %d', $wpdb->insert_id ) );
	}

	/** Automatic sessions whose computers went quiet: ended at their last report (cron and before every listing). */
	public static function sweep( $now = 0 ) {
		global $wpdb;
		$now = $now ? (int) $now : self::now_ts();
		foreach ( $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::t() . " WHERE source = 'auto' AND check_out IS NULL AND last_beat < %s", self::fmt( $now - self::GAP ) ) ) as $s ) {
			self::close( $s, strtotime( $s->last_beat ) );
		}
	}

	/** A manual check-out pauses automatic attendance for the rest of the day; a manual check-in lifts it. */
	public static function manual( $uid, $action ) {
		if ( 'out' === $action ) {
			update_user_meta( $uid, 'mp_presence_paused', MP_Util::today() );
		} else {
			delete_user_meta( $uid, 'mp_presence_paused' );
		}
	}
}
