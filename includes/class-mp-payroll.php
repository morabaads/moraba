<?php
defined( 'ABSPATH' ) || exit;

/**
 * Monthly payroll from attendance, approved leave and overtime (Jalali months).
 *
 * Required time  = working days of the month × daily hours (Friday and holidays off, Thursday off/half/full).
 * Credited time  = worked time (closed check-in/out sessions) + paid leave (up to the monthly allowance).
 * Overtime       = credited − required when positive, paid at hourly wage × overtime factor.
 * Shortfall      = required − credited when positive, deducted at the hourly wage (can be turned off).
 * Hourly wage    = monthly base ÷ month hours (220 by default, as in Iranian labor practice).
 * Net            = base + allowances + overtime − shortfall + bonus − deductions − insurance (employee share).
 * Income tax is left to the accountant; the Excel export has every figure needed for it.
 */
class MP_Payroll {

	const DEFAULTS = array(
		'day_minutes'      => 440,
		'thursday'         => 'half',
		'overtime_factor'  => 1.4,
		'month_hours'      => 220,
		'insurance_rate'   => 7,
		'paid_leave_days'  => 2.5,
		'deduct_shortfall' => true,
	);

	public static function register() {
		$m = array( 'MP_Rest', 'can_manage' );
		foreach ( array(
			array( 'payroll', 'GET', 'month' ),
			array( 'payroll/settings', 'GET', 'get_settings' ),
			array( 'payroll/settings', 'POST', 'save_settings' ),
			array( 'payroll/profiles', 'POST', 'save_profiles' ),
			array( 'payroll/adjust', 'POST', 'adjust' ),
			array( 'payroll/holidays', 'POST', 'save_holidays' ),
		) as $r ) {
			register_rest_route( MP_Rest::NS, '/' . $r[0], array( 'methods' => $r[1], 'callback' => array( __CLASS__, $r[2] ), 'permission_callback' => $m ) );
		}
	}

	private static function err( $msg, $status = 400 ) {
		return new WP_Error( 'mp_payroll', $msg, array( 'status' => $status ) );
	}

	private static function num( $v ) {
		return (float) str_replace( array( ',', '٬', '٫', '/' ), array( '', '', '.', '.' ), J_latin( (string) $v ) );
	}

	/* ------------------------------------------------------------ Settings, profiles */

	public static function settings() {
		$s = get_option( 'mp_payroll', array() );
		return array_merge( self::DEFAULTS, is_array( $s ) ? $s : array() );
	}

	public static function get_settings() {
		$profiles = array();
		foreach ( MP_Util::panel_users() as $uid ) {
			$u          = get_userdata( $uid );
			$profiles[] = array( 'id' => $uid, 'name' => $u ? $u->display_name : '', 'title' => (string) get_user_meta( $uid, 'mp_job_title', true ) ) + self::profile( $uid );
		}
		return array( 'settings' => self::settings(), 'profiles' => $profiles );
	}

	public static function save_settings( WP_REST_Request $r ) {
		$s = self::settings();
		if ( null !== $r['day_minutes'] ) {
			$s['day_minutes'] = max( 60, min( 720, (int) self::num( $r['day_minutes'] ) ) );
		}
		if ( null !== $r['thursday'] ) {
			$s['thursday'] = MP_Util::pick( $r['thursday'], array( 'off', 'half', 'full' ), 'half' );
		}
		foreach ( array( 'overtime_factor' => array( 1, 3 ), 'month_hours' => array( 100, 300 ), 'insurance_rate' => array( 0, 30 ), 'paid_leave_days' => array( 0, 10 ) ) as $k => $lim ) {
			if ( null !== $r[ $k ] ) {
				$s[ $k ] = max( $lim[0], min( $lim[1], round( self::num( $r[ $k ] ), 2 ) ) );
			}
		}
		if ( null !== $r['deduct_shortfall'] ) {
			$s['deduct_shortfall'] = (bool) $r['deduct_shortfall'] && 'false' !== $r['deduct_shortfall'];
		}
		update_option( 'mp_payroll', $s, false );
		MP_Audit::log( 'update', 'member', 0, 'تغییر تنظیمات حقوق' );
		return self::get_settings();
	}

	public static function profile( $uid ) {
		$p = get_user_meta( $uid, 'mp_pay', true );
		$p = is_array( $p ) ? $p : array();
		return array(
			'base'       => isset( $p['base'] ) ? (int) $p['base'] : 0,
			'allowances' => isset( $p['allowances'] ) ? (int) $p['allowances'] : 0,
			'insured'    => ! isset( $p['insured'] ) || (bool) $p['insured'],
		);
	}

	public static function save_profiles( WP_REST_Request $r ) {
		$n = 0;
		foreach ( is_array( $r['profiles'] ) ? $r['profiles'] : array() as $uid => $p ) {
			$uid = (int) $uid;
			if ( ! $uid || ! user_can( $uid, 'mp_access_panel' ) || ! is_array( $p ) ) {
				continue;
			}
			$new = array(
				'base'       => max( 0, min( 10000000000, (int) self::num( isset( $p['base'] ) ? $p['base'] : 0 ) ) ),
				'allowances' => max( 0, min( 10000000000, (int) self::num( isset( $p['allowances'] ) ? $p['allowances'] : 0 ) ) ),
				'insured'    => ! empty( $p['insured'] ) && 'false' !== $p['insured'],
			);
			if ( self::profile( $uid ) !== $new ) {
				update_user_meta( $uid, 'mp_pay', $new );
				++$n;
			}
		}
		if ( $n ) {
			MP_Audit::log( 'update', 'member', 0, 'تغییر حقوق پایه ' . MP_Jalali::digits( (string) $n ) . ' نفر' );
		}
		return self::get_settings();
	}

	/* ------------------------------------------------------------ Month helpers */

	/** '1405-7' → [jy, jm] or null. */
	private static function parse_month( $m ) {
		if ( ! preg_match( '/^(\d{4})-(\d{1,2})$/', (string) $m, $x ) || (int) $x[2] < 1 || (int) $x[2] > 12 ) {
			return null;
		}
		return array( (int) $x[1], (int) $x[2] );
	}

	private static function key( $jy, $jm ) {
		return $jy . '-' . $jm;
	}

	public static function holidays( $key ) {
		$all = get_option( 'mp_payroll_holidays', array() );
		return is_array( $all ) && isset( $all[ $key ] ) ? (array) $all[ $key ] : array();
	}

	public static function save_holidays( WP_REST_Request $r ) {
		$m = self::parse_month( $r['month'] );
		if ( ! $m ) {
			return self::err( 'ماه نامعتبر است.' );
		}
		list( $from, $to ) = array( MP_Jalali::to_iso( $m[0], $m[1], 1 ), MP_Jalali::to_iso( $m[0], $m[1], MP_Jalali::month_length( $m[0], $m[1] ) ) );
		$days = array();
		foreach ( is_array( $r['dates'] ) ? $r['dates'] : array() as $d ) {
			if ( MP_Util::valid_date( (string) $d ) && $d >= $from && $d <= $to ) {
				$days[] = (string) $d;
			}
		}
		$all = get_option( 'mp_payroll_holidays', array() );
		$all = is_array( $all ) ? $all : array();
		$all[ self::key( $m[0], $m[1] ) ] = array_values( array_unique( $days ) );
		update_option( 'mp_payroll_holidays', $all, false );
		return array( 'dates' => $all[ self::key( $m[0], $m[1] ) ] );
	}

	/** Scheduled minutes for a date: 0 on Friday and holidays. */
	private static function scheduled( $date, $s, $holidays ) {
		if ( in_array( $date, $holidays, true ) ) {
			return 0;
		}
		$w = ( (int) gmdate( 'w', strtotime( $date . ' 12:00:00 UTC' ) ) + 1 ) % 7; // Saturday = 0
		if ( 6 === $w ) {
			return 0;
		}
		if ( 5 === $w ) {
			return 'full' === $s['thursday'] ? (int) $s['day_minutes'] : ( 'half' === $s['thursday'] ? (int) round( $s['day_minutes'] / 2 ) : 0 );
		}
		return (int) $s['day_minutes'];
	}

	private static function adjustments( $key ) {
		$all = get_option( 'mp_payroll_adj', array() );
		return is_array( $all ) && isset( $all[ $key ] ) ? $all[ $key ] : array();
	}

	public static function adjust( WP_REST_Request $r ) {
		$m   = self::parse_month( $r['month'] );
		$uid = (int) $r['user_id'];
		if ( ! $m || ! $uid || ! user_can( $uid, 'mp_access_panel' ) ) {
			return self::err( 'ماه یا فرد نامعتبر است.' );
		}
		$key = self::key( $m[0], $m[1] );
		$all = get_option( 'mp_payroll_adj', array() );
		$all = is_array( $all ) ? $all : array();
		$all[ $key ][ $uid ] = array(
			'bonus'     => max( 0, (int) self::num( $r['bonus'] ) ),
			'deduction' => max( 0, (int) self::num( $r['deduction'] ) ),
			'note'      => MP_Util::text( $r['note'], 200 ),
		);
		update_option( 'mp_payroll_adj', $all, false );
		$u = get_userdata( $uid );
		MP_Audit::log( 'update', 'member', $uid, 'پاداش/کسورات حقوق ' . ( $u ? $u->display_name : '' ) . ' — ' . MP_Jalali::MONTHS[ $m[1] - 1 ] . ' ' . MP_Jalali::digits( (string) $m[0] ) );
		return self::month( new WP_REST_Request( 'GET', '/' ), $key );
	}

	/* ------------------------------------------------------------ Calculation */

	/** Minutes between two datetimes (clipped at zero). */
	private static function span( $a, $b ) {
		return max( 0, (int) round( ( strtotime( $b ) - strtotime( $a ) ) / 60 ) );
	}

	/**
	 * Full month calculation. With $detail, each row also carries a per-day breakdown for the Excel export.
	 * @return array|WP_Error
	 */
	public static function compute( $month, $detail = false ) {
		global $wpdb;
		$m = self::parse_month( $month );
		if ( ! $m ) {
			list( $jy, $jm ) = MP_Jalali::from_iso( MP_Util::today() );
			$m               = array( $jy, $jm );
		}
		list( $jy, $jm ) = $m;
		$key      = self::key( $jy, $jm );
		$s        = self::settings();
		$len      = MP_Jalali::month_length( $jy, $jm );
		$from     = MP_Jalali::to_iso( $jy, $jm, 1 );
		$to       = MP_Jalali::to_iso( $jy, $jm, $len );
		$holidays = self::holidays( $key );
		$days     = array();
		$required = 0;
		$workdays = 0;
		for ( $d = 1; $d <= $len; $d++ ) {
			$iso          = MP_Jalali::to_iso( $jy, $jm, $d );
			$days[ $iso ] = self::scheduled( $iso, $s, $holidays );
			$required    += $days[ $iso ];
			$workdays    += $days[ $iso ] > 0 ? 1 : 0;
		}
		$hour_wage_div = max( 1, (float) $s['month_hours'] );
		$leave_cap     = (int) round( (float) $s['paid_leave_days'] * $s['day_minutes'] );
		$adj           = self::adjustments( $key );
		$today         = MP_Util::today();

		$rows   = array();
		$totals = array( 'base' => 0, 'allowances' => 0, 'overtime_pay' => 0, 'shortfall_pay' => 0, 'bonus' => 0, 'deduction' => 0, 'insurance' => 0, 'net' => 0 );
		foreach ( MP_Util::panel_users() as $uid ) {
			$u = get_userdata( $uid );
			$p = self::profile( $uid );

			$per_day = array();
			foreach ( $days as $iso => $min ) {
				$per_day[ $iso ] = array( 'worked' => 0, 'leave' => 0, 'sessions' => array() );
			}
			$open     = 0;
			$sessions = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . MP_Install::table( 'attendance' ) . ' WHERE user_id = %d AND work_date BETWEEN %s AND %s ORDER BY check_in', $uid, $from, $to ) );
			foreach ( $sessions as $x ) {
				if ( ! $x->check_out ) {
					if ( $x->work_date < $today ) {
						++$open; // forgot to check out: not counted, flagged for the supervisor
					}
					$per_day[ $x->work_date ]['sessions'][] = substr( $x->check_in, 11, 5 ) . '–؟';
					continue;
				}
				$per_day[ $x->work_date ]['worked']    += self::span( $x->check_in, $x->check_out );
				$per_day[ $x->work_date ]['sessions'][] = substr( $x->check_in, 11, 5 ) . '–' . substr( $x->check_out, 11, 5 );
			}
			$leaves = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . MP_Install::table( 'leaves' ) . " WHERE user_id = %d AND status = 'approved' AND start_date <= %s AND end_date >= %s", $uid, $to, $from ) );
			foreach ( $leaves as $l ) {
				if ( 'hourly' === $l->kind ) {
					if ( isset( $per_day[ $l->start_date ] ) && $l->from_time && $l->to_time ) {
						$per_day[ $l->start_date ]['leave'] += self::span( '2000-01-01 ' . $l->from_time, '2000-01-01 ' . $l->to_time );
					}
					continue;
				}
				for ( $d = max( $l->start_date, $from ); $d <= min( $l->end_date, $to ); $d = MP_Util::add_days( $d, 1 ) ) {
					$per_day[ $d ]['leave'] += $days[ $d ];
				}
			}

			$worked  = 0;
			$leave   = 0;
			$present = 0;
			foreach ( $per_day as $iso => $x ) {
				$per_day[ $iso ]['leave'] = min( $x['leave'], $days[ $iso ] ); // no leave on days off
				$worked                  += $x['worked'];
				$leave                   += $per_day[ $iso ]['leave'];
				$present                 += $x['worked'] > 0 ? 1 : 0;
			}
			$paid_leave   = min( $leave, $leave_cap );
			$unpaid_leave = $leave - $paid_leave;
			$credited     = $worked + $paid_leave;
			$overtime     = max( 0, $credited - $required );
			$shortfall    = max( 0, $required - $credited );
			$hour         = $p['base'] / $hour_wage_div;
			$ot_pay       = (int) round( $overtime / 60 * $hour * (float) $s['overtime_factor'] );
			$sf_pay       = $s['deduct_shortfall'] ? (int) round( min( $shortfall / 60 * $hour, $p['base'] ) ) : 0;
			$a            = isset( $adj[ $uid ] ) ? $adj[ $uid ] : array( 'bonus' => 0, 'deduction' => 0, 'note' => '' );
			$insurable    = max( 0, $p['base'] + $p['allowances'] + $ot_pay - $sf_pay );
			$insurance    = $p['insured'] && $p['base'] ? (int) round( $insurable * (float) $s['insurance_rate'] / 100 ) : 0;
			$net          = $p['base'] + $p['allowances'] + $ot_pay - $sf_pay + $a['bonus'] - $a['deduction'] - $insurance;

			if ( ! $p['base'] && ! $worked && ! $leave ) {
				continue; // not on payroll and nothing happened this month
			}
			$row = array(
				'id'            => $uid,
				'name'          => $u ? $u->display_name : '',
				'title'         => (string) get_user_meta( $uid, 'mp_job_title', true ),
				'present_days'  => $present,
				'worked'        => $worked,
				'required'      => $required,
				'leave'         => $leave,
				'paid_leave'    => $paid_leave,
				'unpaid_leave'  => $unpaid_leave,
				'overtime'      => $overtime,
				'shortfall'     => $shortfall,
				'open_sessions' => $open,
				'base'          => $p['base'],
				'allowances'    => $p['allowances'],
				'insured'       => $p['insured'],
				'overtime_pay'  => $ot_pay,
				'shortfall_pay' => $sf_pay,
				'bonus'         => (int) $a['bonus'],
				'deduction'     => (int) $a['deduction'],
				'note'          => (string) $a['note'],
				'insurance'     => $insurance,
				'net'           => $net,
			);
			if ( $detail ) {
				$row['days'] = array();
				foreach ( $per_day as $iso => $x ) {
					$row['days'][] = array( 'date' => $iso, 'scheduled' => $days[ $iso ] ) + $x;
				}
			}
			foreach ( $totals as $k => $v ) {
				$totals[ $k ] += $row[ $k ];
			}
			$rows[] = $row;
		}
		return array(
			'month'     => $key,
			'label'     => MP_Jalali::MONTHS[ $jm - 1 ] . ' ' . MP_Jalali::digits( (string) $jy ),
			'from'      => $from,
			'to'        => $to,
			'workdays'  => $workdays,
			'required'  => $required,
			'holidays'  => $holidays,
			'settings'  => $s,
			'rows'      => $rows,
			'totals'    => $totals,
			'finished'  => $to < $today,
		);
	}

	public static function month( WP_REST_Request $r, $key = '' ) {
		return self::compute( $key ? $key : (string) $r['month'] );
	}

	/* ------------------------------------------------------------ Excel */

	private static function hm( $min ) {
		return sprintf( '%d:%02d', intdiv( (int) $min, 60 ), (int) $min % 60 );
	}

	/** Two sheets: the payroll summary and the per-day attendance of everyone. */
	public static function sheets( $month ) {
		$d    = self::compute( $month, true );
		$sum  = array( array( 'نام', 'سمت', 'روز حضور', 'کارکرد (ساعت)', 'موظفی (ساعت)', 'مرخصی با حقوق', 'مرخصی بدون حقوق', 'اضافه‌کار (ساعت)', 'کسر کار (ساعت)', 'حقوق پایه', 'مزایای ثابت', 'مبلغ اضافه‌کار', 'کسر کار', 'پاداش', 'مساعده/کسورات', 'بیمه سهم کارمند', 'خالص پرداختی', 'توضیح' ) );
		foreach ( $d['rows'] as $r ) {
			$sum[] = array( $r['name'], $r['title'], $r['present_days'], self::hm( $r['worked'] ), self::hm( $r['required'] ), self::hm( $r['paid_leave'] ), self::hm( $r['unpaid_leave'] ), self::hm( $r['overtime'] ), self::hm( $r['shortfall'] ), $r['base'], $r['allowances'], $r['overtime_pay'], $r['shortfall_pay'], $r['bonus'], $r['deduction'], $r['insurance'], $r['net'], trim( $r['note'] . ( $r['open_sessions'] ? ' — ' . $r['open_sessions'] . ' روز بدون ثبت خروج' : '' ), ' —' ) );
		}
		$t     = $d['totals'];
		$sum[] = array( 'جمع', '', '', '', '', '', '', '', '', $t['base'], $t['allowances'], $t['overtime_pay'], $t['shortfall_pay'], $t['bonus'], $t['deduction'], $t['insurance'], $t['net'], '' );

		$week = array( 'شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه' );
		$det  = array( array( 'نام', 'تاریخ', 'روز', 'موظفی', 'ورود و خروج', 'کارکرد', 'مرخصی' ) );
		foreach ( $d['rows'] as $r ) {
			foreach ( $r['days'] as $x ) {
				$w     = ( (int) gmdate( 'w', strtotime( $x['date'] . ' 12:00:00 UTC' ) ) + 1 ) % 7;
				$det[] = array( $r['name'], MP_Jalali::format( $x['date'] ), $week[ $w ], $x['scheduled'] ? self::hm( $x['scheduled'] ) : 'تعطیل', implode( '، ', $x['sessions'] ), $x['worked'] ? self::hm( $x['worked'] ) : '', $x['leave'] ? self::hm( $x['leave'] ) : '' );
			}
		}
		return array(
			'title'  => 'حقوق ' . $d['label'],
			'file'   => 'moraba-payroll-' . $d['month'] . '.xlsx',
			'sheets' => array(
				array( 'name' => 'حقوق ' . $d['label'], 'rows' => $sum, 'widths' => array( 18, 14, 9, 12, 12, 12, 13, 13, 12, 15, 14, 14, 12, 12, 14, 14, 16, 30 ) ),
				array( 'name' => 'ریز کارکرد', 'rows' => $det, 'widths' => array( 18, 16, 10, 9, 30, 9, 9 ) ),
			),
		);
	}
}
