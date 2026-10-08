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
		MP_Presence::sweep();
		$now   = current_time( 'Y-m-d H:i' );
		$table = MP_Install::table( 'reminders' );
		$due   = $wpdb->get_results(
			$wpdb->prepare( "SELECT * FROM $table WHERE fired_at IS NULL AND CONCAT(remind_date, ' ', remind_time) <= %s LIMIT 200", $now )
		);
		foreach ( $due as $r ) {
			if ( preg_match( '/^chat:(\d+):(\d+)$/', (string) $r->note, $cm ) ) {
				// «Remind me about this message»: opens the message itself.
				MP_Notify::event( 'reminder', $r->user_id, array( 'TITLE' => $r->title, 'NOTE' => 'برای دیدن پیام بزنید' ), 'chatmsg', (int) $cm[2], true );
			} else {
				MP_Notify::event( 'reminder', $r->user_id, array( 'TITLE' => $r->title, 'NOTE' => (string) $r->note ), 'reminders', $r->id, true );
			}
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

		MP_Chat::flush_scheduled();
		MP_Daily::tick();
		MP_Digest::tick();
		MP_Contracts::tick();

		// Meetings: recurring dates move on; reminders 10 minutes before (panel, messengers, SMS, invited guests).
		MP_Meet::tick();
	}
}
