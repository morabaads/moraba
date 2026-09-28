<?php
defined( 'ABSPATH' ) || exit;

/** Fires due reminders and upcoming-meeting alerts every five minutes. */
class MP_Cron {

	const HOOK = 'mp_tick';

	public static function init() {
		add_filter( 'cron_schedules', array( __CLASS__, 'interval' ) );
		add_action( self::HOOK, array( __CLASS__, 'run' ) );
		add_action( 'init', array( __CLASS__, 'schedule' ) );
	}

	public static function interval( $s ) {
		$s['mp_five_minutes'] = array( 'interval' => 5 * MINUTE_IN_SECONDS, 'display' => 'هر ۵ دقیقه' );
		return $s;
	}

	public static function schedule() {
		if ( ! wp_next_scheduled( self::HOOK ) ) {
			wp_schedule_event( time() + 60, 'mp_five_minutes', self::HOOK );
		}
	}

	public static function unschedule() {
		wp_clear_scheduled_hook( self::HOOK );
	}

	public static function run() {
		global $wpdb;
		$now   = current_time( 'Y-m-d H:i' );
		$table = MP_Install::table( 'reminders' );
		$due   = $wpdb->get_results(
			$wpdb->prepare( "SELECT * FROM $table WHERE fired_at IS NULL AND CONCAT(remind_date, ' ', remind_time) <= %s LIMIT 200", $now )
		);
		foreach ( $due as $r ) {
			MP_Notify::send( $r->user_id, 'reminder', 'یادآوری: ' . $r->title, (string) $r->note, 'reminders', $r->id, true );
			if ( 'none' === $r->repeat_every ) {
				$wpdb->update( $table, array( 'fired_at' => MP_Util::now() ), array( 'id' => $r->id ) );
				continue;
			}
			$step = array( 'daily' => '+1 day', 'weekly' => '+1 week', 'monthly' => '+1 month' );
			$next = $r->remind_date;
			do {
				$next = gmdate( 'Y-m-d', strtotime( $next . ' ' . $step[ $r->repeat_every ] . ' UTC' ) );
			} while ( $next . ' ' . $r->remind_time <= $now );
			$wpdb->update( $table, array( 'remind_date' => $next ), array( 'id' => $r->id ) );
		}

		MP_Daily::tick();
		MP_Digest::tick();

		// Meetings starting within the next 10 minutes.
		$soon     = gmdate( 'H:i', strtotime( $now . ' UTC' ) + 10 * MINUTE_IN_SECONDS );
		$meetings = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM ' . MP_Install::table( 'meetings' ) . ' WHERE meeting_date = %s AND meeting_time > %s AND meeting_time <= %s',
				current_time( 'Y-m-d' ),
				current_time( 'H:i' ),
				$soon
			)
		);
		foreach ( $meetings as $m ) {
			$key = 'mp_meeting_alert_' . $m->id;
			if ( get_transient( $key ) ) {
				continue;
			}
			set_transient( $key, 1, DAY_IN_SECONDS );
			$people   = $wpdb->get_col( $wpdb->prepare( 'SELECT user_id FROM ' . MP_Install::table( 'meeting_people' ) . ' WHERE meeting_id = %d', $m->id ) );
			$people[] = $m->created_by;
			foreach ( array_unique( array_map( 'intval', $people ) ) as $p ) {
				MP_Notify::send( $p, 'meeting', 'جلسه «' . $m->title . '» تا چند دقیقه دیگر شروع می‌شود', 'ساعت ' . $m->meeting_time, 'meeting', $m->id );
			}
		}
	}
}
