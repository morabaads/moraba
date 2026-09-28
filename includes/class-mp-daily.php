<?php
defined( 'ABSPATH' ) || exit;

/**
 * Daily end-of-day report (the team rule): done work, progress %, problems, decisions needed, tomorrow's plan.
 * Supervisors set the time; at that time every employee who hasn't written today's report gets a notification.
 */
class MP_Daily {

	const OPTION = 'mp_daily_report';

	public static function register() {
		$auth = array( 'MP_Rest', 'can_access' );
		$m    = array( 'MP_Rest', 'can_manage' );
		register_rest_route( MP_Rest::NS, '/daily-reports', array( 'methods' => 'GET', 'callback' => array( __CLASS__, 'index' ), 'permission_callback' => $auth ) );
		register_rest_route( MP_Rest::NS, '/daily-reports', array( 'methods' => 'POST', 'callback' => array( __CLASS__, 'save' ), 'permission_callback' => $auth ) );
		register_rest_route( MP_Rest::NS, '/daily-reports/settings', array( 'methods' => 'POST', 'callback' => array( __CLASS__, 'save_settings' ), 'permission_callback' => $m ) );
	}

	private static function t() {
		return MP_Install::table( 'daily_reports' );
	}

	public static function settings() {
		$s = get_option( self::OPTION, array() );
		return wp_parse_args( is_array( $s ) ? $s : array(), array( 'enabled' => false, 'time' => '18:00', 'days' => array( 0, 1, 2, 3, 4, 6 ) ) );
	}

	/** Panel users who write reports: employees (supervisors who are also employees included). */
	private static function staff() {
		return array_values( array_filter( MP_Util::panel_users(), array( 'MP_Util', 'is_employee' ) ) );
	}

	private static function payload( $x ) {
		$u = get_userdata( $x->user_id );
		return array(
			'id'         => (int) $x->id,
			'user_id'    => (int) $x->user_id,
			'name'       => $u ? $u->display_name : '',
			'date'       => $x->report_date,
			'done'       => $x->done_text,
			'progress'   => (int) $x->progress,
			'problems'   => (string) $x->problems,
			'decisions'  => (string) $x->decisions,
			'tomorrow'   => (string) $x->tomorrow,
			'updated_at' => $x->updated_at,
		);
	}

	/** GET daily-reports?date= — my report; supervisors also get everyone's and who is missing. */
	public static function index( WP_REST_Request $r ) {
		global $wpdb;
		$date = MP_Util::valid_date( $r['date'] ) ? $r['date'] : MP_Util::today();
		$uid  = get_current_user_id();
		$mine = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t() . ' WHERE user_id = %d AND report_date = %s', $uid, $date ) );
		$out  = array(
			'date'     => $date,
			'settings' => self::settings(),
			'mine'     => $mine ? self::payload( $mine ) : null,
			'required' => MP_Util::is_employee( $uid ),
		);
		if ( MP_Util::is_manager() ) {
			$rows       = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::t() . ' WHERE report_date = %s ORDER BY updated_at', $date ) );
			$out['all'] = array_map( array( __CLASS__, 'payload' ), $rows );
			$have       = array_map( 'intval', wp_list_pluck( $rows, 'user_id' ) );
			$out['missing'] = array();
			foreach ( self::staff() as $id ) {
				if ( ! in_array( (int) $id, $have, true ) ) {
					$u                = get_userdata( $id );
					$out['missing'][] = array( 'user_id' => (int) $id, 'name' => $u ? $u->display_name : '' );
				}
			}
		}
		return $out;
	}

	/** POST daily-reports {date, done, progress, problems, decisions, tomorrow} — writes or updates my report. */
	public static function save( WP_REST_Request $r ) {
		global $wpdb;
		$uid  = get_current_user_id();
		$date = MP_Util::valid_date( $r['date'] ) ? $r['date'] : MP_Util::today();
		if ( $date > MP_Util::today() ) {
			return new WP_Error( 'mp_error', 'گزارش روزهای آینده را نمی‌توان ثبت کرد.', array( 'status' => 400 ) );
		}
		$done = MP_Util::long_text( $r['done'], 4000 );
		if ( '' === trim( $done ) ) {
			return new WP_Error( 'mp_error', 'کارهای انجام‌شده امروز را بنویسید.', array( 'status' => 400 ) );
		}
		$row = array(
			'done_text'  => $done,
			'progress'   => max( 0, min( 100, (int) $r['progress'] ) ),
			'problems'   => MP_Util::long_text( $r['problems'], 2000 ),
			'decisions'  => MP_Util::long_text( $r['decisions'], 2000 ),
			'tomorrow'   => MP_Util::long_text( $r['tomorrow'], 2000 ),
			'updated_at' => MP_Util::now(),
		);
		$id = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM ' . self::t() . ' WHERE user_id = %d AND report_date = %s', $uid, $date ) );
		if ( $id ) {
			$wpdb->update( self::t(), $row, array( 'id' => $id ) );
		} else {
			$wpdb->insert( self::t(), $row + array( 'user_id' => $uid, 'report_date' => $date, 'created_at' => MP_Util::now() ) );
			$id = (int) $wpdb->insert_id;
			// Supervisors hear about new reports (not about edits).
			foreach ( MP_Util::panel_users() as $m ) {
				if ( (int) $m !== $uid && MP_Util::is_manager( $m ) ) {
					MP_Notify::send( $m, 'report', wp_get_current_user()->display_name . ' گزارش روزانه را ثبت کرد', MP_Jalali::format( $date ) . ' · ' . MP_Jalali::digits( $row['progress'] ) . '٪', 'daily', $id );
				}
			}
		}
		return self::payload( $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t() . ' WHERE id = %d', $id ) ) );
	}

	/** POST daily-reports/settings {enabled, time, days} */
	public static function save_settings( WP_REST_Request $r ) {
		$time = (string) $r['time'];
		if ( ! preg_match( '/^([01]\d|2[0-3]):[0-5]\d$/', $time ) ) {
			return new WP_Error( 'mp_error', 'ساعت را به شکل ۱۸:۰۰ وارد کنید.', array( 'status' => 400 ) );
		}
		$days = is_array( $r['days'] ) ? array_values( array_unique( array_filter( array_map( 'intval', $r['days'] ), function ( $d ) { return $d >= 0 && $d <= 6; } ) ) ) : array();
		update_option( self::OPTION, array( 'enabled' => (bool) $r['enabled'], 'time' => $time, 'days' => $days ), false );
		// A time later today than now fires again today.
		if ( current_time( 'H:i' ) < $time ) {
			delete_option( 'mp_daily_report_sent' );
		}
		MP_Audit::log( 'update', 'settings', 0, 'گزارش روزانه: ' . ( $r['enabled'] ? 'ساعت ' . $time : 'غیرفعال' ) );
		return self::settings();
	}

	/** Called by the 5-minute cron: at the set time, remind everyone who hasn't written today's report. */
	public static function tick() {
		global $wpdb;
		$s     = self::settings();
		$today = current_time( 'Y-m-d' );
		if ( ! $s['enabled'] || current_time( 'H:i' ) < $s['time'] || get_option( 'mp_daily_report_sent' ) === $today ) {
			return;
		}
		update_option( 'mp_daily_report_sent', $today, false );
		if ( ! in_array( (int) gmdate( 'w', strtotime( $today . ' UTC' ) ), array_map( 'intval', $s['days'] ), true ) ) {
			return;
		}
		$have = array_map( 'intval', $wpdb->get_col( $wpdb->prepare( 'SELECT user_id FROM ' . self::t() . ' WHERE report_date = %s', $today ) ) );
		foreach ( self::staff() as $id ) {
			if ( ! in_array( (int) $id, $have, true ) && ! self::on_leave( $id, $today ) ) {
				MP_Notify::send( $id, 'report', 'وقت ثبت گزارش روزانه است', 'کارهای امروز، درصد پیشرفت، مشکلات، نیاز به تصمیم و برنامه فردا', 'daily', 0, true );
			}
		}
	}

	private static function on_leave( $uid, $date ) {
		global $wpdb;
		return (bool) $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM ' . MP_Install::table( 'leaves' ) . " WHERE user_id = %d AND kind = 'daily' AND status = 'approved' AND start_date <= %s AND end_date >= %s LIMIT 1", $uid, $date, $date ) );
	}
}
