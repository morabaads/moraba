<?php
defined( 'ABSPATH' ) || exit;

/**
 * Morning brief and weekly report.
 *
 * - Morning (each working day at the set time): everyone gets one short line —
 *   «امروز ۴ تسک، ۱ جلسه، ۲ تسک عقب‌افتاده» — in the panel, on the phone (push) and on Telegram/Bale;
 *   by SMS too when «پیامک» is on in the settings (and in the person's own preferences).
 * - Weekly (on the set day and time): supervisors get the last seven days: who worked how much
 *   (attendance hours, logged time, tasks done), what is overdue, and the week's money (income, expense,
 *   unpaid invoices). A summary goes as a notification and the full text by email; the panel shows it
 *   in «گزارش هفتگی».
 */
class MP_Digest {

	const OPTION = 'mp_digest';

	public static function register() {
		$auth = array( 'MP_Rest', 'can_access' );
		$m    = array( 'MP_Rest', 'can_manage' );
		register_rest_route( MP_Rest::NS, '/digest/settings', array( 'methods' => 'GET', 'callback' => array( __CLASS__, 'get_settings' ), 'permission_callback' => $auth ) );
		register_rest_route( MP_Rest::NS, '/digest/settings', array( 'methods' => 'POST', 'callback' => array( __CLASS__, 'save_settings' ), 'permission_callback' => $m ) );
		register_rest_route( MP_Rest::NS, '/digest/weekly', array( 'methods' => 'GET', 'callback' => array( __CLASS__, 'weekly_rest' ), 'permission_callback' => $m ) );
		register_rest_route( MP_Rest::NS, '/digest/test', array( 'methods' => 'POST', 'callback' => array( __CLASS__, 'test' ), 'permission_callback' => $auth ) );
	}

	private static function t( $n ) {
		return MP_Install::table( $n );
	}

	public static function settings() {
		$s = get_option( self::OPTION, array() );
		return wp_parse_args(
			is_array( $s ) ? $s : array(),
			array( 'morning' => true, 'morning_time' => '08:00', 'sms' => false, 'days' => array( 0, 1, 2, 3, 4, 6 ), 'weekly' => true, 'weekly_day' => 4, 'weekly_time' => '18:00' )
		);
	}

	public static function get_settings() {
		return self::settings();
	}

	public static function save_settings( WP_REST_Request $r ) {
		foreach ( array( 'morning_time', 'weekly_time' ) as $k ) {
			if ( ! preg_match( '/^([01]\d|2[0-3]):[0-5]\d$/', (string) $r[ $k ] ) ) {
				return new WP_Error( 'mp_error', 'ساعت را به شکل ۰۸:۰۰ وارد کنید.', array( 'status' => 400 ) );
			}
		}
		$days = is_array( $r['days'] ) ? array_values( array_unique( array_filter( array_map( 'intval', $r['days'] ), function ( $d ) { return $d >= 0 && $d <= 6; } ) ) ) : array();
		update_option(
			self::OPTION,
			array(
				'morning'      => (bool) $r['morning'],
				'morning_time' => (string) $r['morning_time'],
				'sms'          => (bool) $r['sms'],
				'days'         => $days,
				'weekly'       => (bool) $r['weekly'],
				'weekly_day'   => max( 0, min( 6, (int) $r['weekly_day'] ) ),
				'weekly_time'  => (string) $r['weekly_time'],
			),
			false
		);
		// Saving after today's time doesn't send a late brief; it starts from the next one.
		$today = current_time( 'Y-m-d' );
		if ( current_time( 'H:i' ) >= (string) $r['morning_time'] ) {
			update_option( 'mp_digest_morning_sent', $today, false );
		}
		if ( current_time( 'H:i' ) >= (string) $r['weekly_time'] ) {
			update_option( 'mp_digest_weekly_sent', $today, false );
		}
		MP_Audit::log( 'update', 'settings', 0, 'خلاصه صبحگاهی و گزارش هفتگی' );
		return self::settings();
	}

	/* ------------------------------------------------------------------ Morning brief */

	/** @return array{title:string,detail:string,count:int} */
	public static function morning_for( $uid, $today ) {
		global $wpdb;
		$tasks   = $wpdb->get_col( $wpdb->prepare( 'SELECT title FROM ' . self::t( 'tasks' ) . " WHERE user_id = %d AND task_date = %s AND status <> 'done' AND archived_at IS NULL ORDER BY task_time = '', task_time, id", $uid, $today ) );
		$overdue = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM ' . self::t( 'tasks' ) . " WHERE user_id = %d AND task_date < %s AND status <> 'done' AND archived_at IS NULL", $uid, $today ) );
		$meet    = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT DISTINCT m.title, m.meeting_time FROM ' . self::t( 'meetings' ) . ' m LEFT JOIN ' . self::t( 'meeting_people' ) . ' p ON p.meeting_id = m.id WHERE m.meeting_date = %s AND (m.created_by = %d OR p.user_id = %d) ORDER BY m.meeting_time',
				$today,
				$uid,
				$uid
			)
		);
		$rem     = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM ' . self::t( 'reminders' ) . ' WHERE user_id = %d AND remind_date = %s AND fired_at IS NULL', $uid, $today ) );
		$bits    = array();
		$bits[]  = count( $tasks ) ? MP_Jalali::digits( count( $tasks ) ) . ' تسک' : 'تسکی ندارید';
		if ( $meet ) {
			$bits[] = MP_Jalali::digits( count( $meet ) ) . ' جلسه';
		}
		if ( $overdue ) {
			$bits[] = MP_Jalali::digits( $overdue ) . ' تسک عقب‌افتاده';
		}
		if ( $rem ) {
			$bits[] = MP_Jalali::digits( $rem ) . ' یادآوری';
		}
		$u      = get_userdata( $uid );
		$first  = $u ? explode( ' ', trim( $u->display_name ) )[0] : '';
		$title  = 'صبح بخیر' . ( $first ? ' ' . $first : '' ) . '! امروز ' . implode( '، ', $bits );
		$detail = array();
		foreach ( $meet as $m ) {
			$detail[] = 'جلسه ' . MP_Jalali::digits( $m->meeting_time ) . ': ' . $m->title;
		}
		foreach ( array_slice( $tasks, 0, 3 ) as $t ) {
			$detail[] = '• ' . $t;
		}
		return array( 'title' => $title, 'detail' => implode( ' | ', $detail ), 'count' => count( $tasks ) + count( $meet ) + $overdue );
	}

	private static function on_leave( $uid, $date ) {
		global $wpdb;
		return (bool) $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM ' . self::t( 'leaves' ) . " WHERE user_id = %d AND kind = 'daily' AND status = 'approved' AND start_date <= %s AND end_date >= %s LIMIT 1", $uid, $date, $date ) );
	}

	private static function send_morning( $uid, $today, $sms ) {
		$b = self::morning_for( $uid, $today );
		// In the panel + push + Telegram/Bale; SMS only when turned on (it costs per message).
		MP_Notify::send( $uid, 'digest', $b['title'], $b['detail'], 'calendar', 0, false );
		if ( $sms ) {
			$phone = (string) get_user_meta( $uid, 'mp_phone', true );
			$prefs = get_user_meta( $uid, 'mp_prefs', true );
			if ( $phone && ( ! is_array( $prefs ) || ! isset( $prefs['sms'] ) || $prefs['sms'] ) ) {
				MP_Auth::text( $phone, $b['title'] );
			}
		}
	}

	/** POST digest/test — sends my own morning brief now (to check the channels). */
	public static function test() {
		$uid = get_current_user_id();
		self::send_morning( $uid, MP_Util::today(), self::settings()['sms'] );
		return self::morning_for( $uid, MP_Util::today() );
	}

	/* ------------------------------------------------------------------ Weekly report */

	/** Numbers for the seven days ending $to. */
	public static function weekly( $to ) {
		global $wpdb;
		$from   = MP_Util::add_days( $to, -6 );
		$people = array();
		foreach ( MP_Util::panel_users() as $uid ) {
			if ( ! MP_Util::is_employee( $uid ) ) {
				continue;
			}
			$u    = get_userdata( $uid );
			$secs = 0;
			foreach ( $wpdb->get_results( $wpdb->prepare( 'SELECT check_in, check_out FROM ' . self::t( 'attendance' ) . ' WHERE user_id = %d AND work_date BETWEEN %s AND %s', $uid, $from, $to ) ) as $a ) {
				$end   = $a->check_out ? strtotime( $a->check_out ) : min( current_time( 'timestamp' ), strtotime( substr( $a->check_in, 0, 10 ) . ' 23:59:59' ) ); // phpcs:ignore WordPress.DateTime.CurrentTimeTimestamp
				$secs += max( 0, $end - strtotime( $a->check_in ) );
			}
			$logged   = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COALESCE(SUM(seconds),0) FROM ' . self::t( 'timelog' ) . ' WHERE user_id = %d AND work_date BETWEEN %s AND %s', $uid, $from, $to ) );
			$planned  = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM ' . self::t( 'tasks' ) . ' WHERE user_id = %d AND task_date BETWEEN %s AND %s AND archived_at IS NULL', $uid, $from, $to ) );
			$done     = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM ' . self::t( 'tasks' ) . " WHERE user_id = %d AND status = 'done' AND DATE(done_at) BETWEEN %s AND %s AND archived_at IS NULL", $uid, $from, $to ) );
			$overdue  = $wpdb->get_results( $wpdb->prepare( 'SELECT id, title, task_date FROM ' . self::t( 'tasks' ) . " WHERE user_id = %d AND status <> 'done' AND task_date < %s AND archived_at IS NULL ORDER BY task_date LIMIT 50", $uid, MP_Util::add_days( $to, 1 ) ) );
			$reports  = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM ' . self::t( 'daily_reports' ) . ' WHERE user_id = %d AND report_date BETWEEN %s AND %s', $uid, $from, $to ) );
			$people[] = array(
				'user_id'  => (int) $uid,
				'name'     => $u ? $u->display_name : '',
				'hours'    => round( $secs / 3600, 1 ),
				'logged'   => round( $logged / 3600, 1 ),
				'planned'  => $planned,
				'done'     => $done,
				'overdue'  => count( $overdue ),
				'late'     => array_map( function ( $t ) { return array( 'id' => (int) $t->id, 'title' => $t->title, 'date' => $t->task_date ); }, array_slice( $overdue, 0, 5 ) ),
				'reports'  => $reports,
			);
		}
		usort( $people, function ( $a, $b ) { return $b['done'] - $a['done'] ?: ( $b['hours'] <=> $a['hours'] ); } );
		$lt      = self::t( 'ledger' );
		$income  = (int) $wpdb->get_var( $wpdb->prepare( "SELECT COALESCE(SUM(amount),0) FROM $lt WHERE type = 'income' AND entry_date BETWEEN %s AND %s", $from, $to ) ); // phpcs:ignore
		$expense = (int) $wpdb->get_var( $wpdb->prepare( "SELECT COALESCE(SUM(amount),0) FROM $lt WHERE type = 'expense' AND entry_date BETWEEN %s AND %s", $from, $to ) ); // phpcs:ignore
		$balance = (int) $wpdb->get_var( "SELECT COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE -CAST(amount AS SIGNED) END),0) FROM $lt" ); // phpcs:ignore
		$unpaid  = 0;
		$unpaidn = 0;
		if ( class_exists( 'MP_Invoices' ) ) {
			foreach ( $wpdb->get_results( 'SELECT * FROM ' . self::t( 'invoices' ) . " WHERE kind = 'invoice' AND status IN ('draft','sent','accepted') AND archived_at IS NULL" ) as $inv ) { // phpcs:ignore
				$unpaid += MP_Invoices::payload( $inv )['total'];
				++$unpaidn;
			}
		}
		$projects = array();
		foreach ( $wpdb->get_results( $wpdb->prepare( 'SELECT id, name, end_date FROM ' . self::t( 'projects' ) . " WHERE status <> 'done' AND end_date IS NOT NULL AND end_date < %s ORDER BY end_date", MP_Util::add_days( $to, 1 ) ) ) as $p ) {
			$projects[] = array( 'id' => (int) $p->id, 'name' => $p->name, 'end' => $p->end_date );
		}
		return array(
			'from'     => $from,
			'to'       => $to,
			'people'   => $people,
			'money'    => array( 'income' => $income, 'expense' => $expense, 'net' => $income - $expense, 'balance' => $balance, 'unpaid' => $unpaid, 'unpaid_count' => $unpaidn ),
			'late_projects' => $projects,
			'totals'   => array(
				'done'    => array_sum( wp_list_pluck( $people, 'done' ) ),
				'hours'   => round( array_sum( wp_list_pluck( $people, 'hours' ) ), 1 ),
				'overdue' => array_sum( wp_list_pluck( $people, 'overdue' ) ),
			),
		);
	}

	public static function weekly_rest( WP_REST_Request $r ) {
		return self::weekly( MP_Util::valid_date( $r['to'] ) ? $r['to'] : MP_Util::today() );
	}

	private static function toman( $n ) {
		return MP_Jalali::digits( number_format( (int) $n ) ) . ' تومان';
	}

	/** Plain-text weekly report (email and Telegram). */
	public static function weekly_text( array $w ) {
		$d     = 'MP_Jalali::digits';
		$lines = array( 'گزارش هفتگی ' . MP_Jalali::format( $w['from'] ) . ' تا ' . MP_Jalali::format( $w['to'] ), '' );
		$lines[] = 'کار تیم:';
		foreach ( $w['people'] as $p ) {
			$lines[] = '• ' . $p['name'] . ': ' . $d( $p['done'] ) . ' تسک انجام از ' . $d( $p['planned'] ) . ' · حضور ' . $d( $p['hours'] ) . ' ساعت' . ( $p['logged'] ? ' · ثبت زمان ' . $d( $p['logged'] ) . ' ساعت' : '' ) . ( $p['overdue'] ? ' · ' . $d( $p['overdue'] ) . ' عقب‌افتاده' : '' ) . ' · گزارش روزانه ' . $d( $p['reports'] ) . ' روز';
		}
		$late = array();
		foreach ( $w['people'] as $p ) {
			foreach ( $p['late'] as $t ) {
				$late[] = '• ' . $t['title'] . ' (' . $p['name'] . '، ' . MP_Jalali::format( $t['date'] ) . ')';
			}
		}
		if ( $late || $w['late_projects'] ) {
			$lines[] = '';
			$lines[] = 'عقب‌افتاده‌ها:';
			foreach ( $w['late_projects'] as $p ) {
				$lines[] = '• پروژه «' . $p['name'] . '» — موعد ' . MP_Jalali::format( $p['end'] );
			}
			$lines = array_merge( $lines, array_slice( $late, 0, 15 ) );
		}
		$m       = $w['money'];
		$lines[] = '';
		$lines[] = 'مالی هفته:';
		$lines[] = '• دخل ' . self::toman( $m['income'] ) . ' · خرج ' . self::toman( $m['expense'] ) . ' · خالص ' . ( $m['net'] < 0 ? '−' : '' ) . self::toman( abs( $m['net'] ) );
		$lines[] = '• موجودی فعلی ' . ( $m['balance'] < 0 ? '−' : '' ) . self::toman( abs( $m['balance'] ) );
		if ( $m['unpaid_count'] ) {
			$lines[] = '• ' . $d( $m['unpaid_count'] ) . ' فاکتور پرداخت‌نشده: ' . self::toman( $m['unpaid'] );
		}
		return implode( "\n", $lines );
	}

	private static function send_weekly() {
		$w     = self::weekly( MP_Util::today() );
		$title = 'گزارش هفتگی: ' . MP_Jalali::digits( $w['totals']['done'] ) . ' تسک انجام، ' . MP_Jalali::digits( $w['totals']['overdue'] ) . ' عقب‌افتاده، دخل ' . self::toman( $w['money']['income'] );
		$text  = self::weekly_text( $w );
		foreach ( MP_Util::panel_users() as $uid ) {
			if ( ! MP_Util::is_manager( $uid ) ) {
				continue;
			}
			MP_Notify::send( $uid, 'weekly', $title, 'خرج ' . self::toman( $w['money']['expense'] ) . ' · حضور تیم ' . MP_Jalali::digits( $w['totals']['hours'] ) . ' ساعت', 'weekly', 0, false );
			$u = get_userdata( $uid );
			if ( $u && is_email( $u->user_email ) && get_option( 'mp_email_notifications', '1' ) ) {
				wp_mail( $u->user_email, '[' . get_bloginfo( 'name' ) . '] ' . $title, $text . "\n\n" . MP_Frontend::panel_url() );
			}
		}
	}

	/* ------------------------------------------------------------------ Cron */

	public static function tick() {
		$s     = self::settings();
		$today = current_time( 'Y-m-d' );
		$now   = current_time( 'H:i' );
		$dow   = (int) gmdate( 'w', strtotime( $today . ' UTC' ) );
		if ( $s['morning'] && $now >= $s['morning_time'] && get_option( 'mp_digest_morning_sent' ) !== $today ) {
			update_option( 'mp_digest_morning_sent', $today, false );
			if ( in_array( $dow, array_map( 'intval', $s['days'] ), true ) ) {
				foreach ( MP_Util::panel_users() as $uid ) {
					if ( ! self::on_leave( $uid, $today ) ) {
						self::send_morning( $uid, $today, $s['sms'] );
					}
				}
			}
		}
		if ( $s['weekly'] && $dow === (int) $s['weekly_day'] && $now >= $s['weekly_time'] && get_option( 'mp_digest_weekly_sent' ) !== $today ) {
			update_option( 'mp_digest_weekly_sent', $today, false );
			self::send_weekly();
		}
	}
}
