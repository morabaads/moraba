<?php
defined( 'ABSPATH' ) || exit;

/**
 * Real time and project cost.
 * Every stop of a task timer (and every manual entry) becomes a row in `timelog` with the person's
 * hourly rate at that moment. The cost report adds these up per project, next to the project's
 * expenses and income from accounting, so supervisors see what each project really cost.
 * A row logged while the person had no rate yet is priced at their current rate.
 */
class MP_Costs {

	public static function register() {
		$auth = array( 'MP_Rest', 'can_access' );
		$m    = array( 'MP_Rest', 'can_manage' );
		$id   = '(?P<id>\d+)';
		foreach ( array(
			array( "tasks/$id/time", 'GET', 'entries', $auth ),
			array( "tasks/$id/time", 'POST', 'add', $auth ),
			array( "time/$id", 'DELETE', 'remove', $auth ),
			array( 'costs', 'GET', 'report', $m ),
			array( 'costs/rates', 'GET', 'rates', $m ),
			array( 'costs/rates', 'POST', 'save_rates', $m ),
		) as $r ) {
			register_rest_route( MP_Rest::NS, '/' . $r[0], array( 'methods' => $r[1], 'callback' => array( __CLASS__, $r[2] ), 'permission_callback' => $r[3] ) );
		}
	}

	private static function t() {
		return MP_Install::table( 'timelog' );
	}

	private static function err( $msg, $status = 400 ) {
		return new WP_Error( 'mp_time', $msg, array( 'status' => $status ) );
	}

	/** Hourly rate in toman. */
	public static function rate( $uid ) {
		return max( 0, (int) get_user_meta( $uid, 'mp_hourly_rate', true ) );
	}

	/** Records worked seconds on a task (timer stop). Ignores blips under 30 seconds. */
	public static function log( $task, $seconds, $source = 'timer', $date = '', $note = '' ) {
		global $wpdb;
		$seconds = (int) $seconds;
		if ( $seconds < ( 'timer' === $source ? 30 : 60 ) ) {
			return 0;
		}
		$wpdb->insert(
			self::t(),
			array(
				'task_id'    => (int) $task->id,
				'task_title' => mb_substr( (string) $task->title, 0, 200 ),
				'project_id' => (int) $task->project_id,
				'user_id'    => (int) $task->user_id,
				'work_date'  => $date ? $date : MP_Util::today(),
				'seconds'    => $seconds,
				'rate'       => self::rate( $task->user_id ),
				'source'     => $source,
				'note'       => $note,
				'created_at' => MP_Util::now(),
			)
		);
		return (int) $wpdb->insert_id;
	}

	/** Keeps logged time with the task when its project or title changes. */
	public static function follow_task( $task_id ) {
		global $wpdb;
		$task = MP_Rest::get_task( $task_id );
		if ( $task ) {
			$wpdb->update( self::t(), array( 'project_id' => (int) $task->project_id, 'task_title' => mb_substr( (string) $task->title, 0, 200 ) ), array( 'task_id' => (int) $task_id ) );
		}
	}

	/** Timer time recorded before the log existed becomes one entry per task, on the task's date. */
	public static function migrate() {
		global $wpdb;
		if ( get_option( 'mp_timelog_migrated' ) ) {
			return;
		}
		$rows = $wpdb->get_results( 'SELECT * FROM ' . MP_Install::table( 'tasks' ) . ' WHERE time_spent > 0' ); // phpcs:ignore
		foreach ( $rows as $task ) {
			if ( ! $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM ' . self::t() . ' WHERE task_id = %d LIMIT 1', $task->id ) ) ) {
				self::log( $task, $task->time_spent, 'legacy', $task->task_date );
			}
		}
		update_option( 'mp_timelog_migrated', 1, false );
	}

	private static function entry_payload( $e ) {
		$u    = get_userdata( $e->user_id );
		$mine = (int) $e->user_id === get_current_user_id();
		return array(
			'id'         => (int) $e->id,
			'user_id'    => (int) $e->user_id,
			'user'       => $u ? $u->display_name : '',
			'date'       => $e->work_date,
			'seconds'    => (int) $e->seconds,
			'source'     => $e->source,
			'note'       => $e->note,
			'can_delete' => MP_Util::is_manager() || ( $mine && 'manual' === $e->source ),
		);
	}

	public static function entries( WP_REST_Request $r ) {
		global $wpdb;
		$task = MP_Rest::get_task( (int) $r['id'] );
		if ( ! $task || ! MP_Rest::can_view_task( $task ) ) {
			return self::err( 'تسک پیدا نشد.', 404 );
		}
		$rows = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::t() . ' WHERE task_id = %d ORDER BY work_date DESC, id DESC', $task->id ) );
		return array_map( array( __CLASS__, 'entry_payload' ), $rows );
	}

	/** Manual entry: «۲ ساعت و ۳۰ دقیقه روی این تسک کار کردم». Owner or supervisor. */
	public static function add( WP_REST_Request $r ) {
		global $wpdb;
		$task = MP_Rest::get_task( (int) $r['id'] );
		if ( ! $task || ! MP_Rest::can_view_task( $task ) ) {
			return self::err( 'تسک پیدا نشد.', 404 );
		}
		if ( (int) $task->user_id !== get_current_user_id() && ! MP_Util::is_manager() ) {
			return self::err( 'فقط مسئول تسک یا ناظر می‌تواند زمان ثبت کند.', 403 );
		}
		$min = (int) $r['minutes'];
		if ( $min < 1 || $min > 24 * 60 ) {
			return self::err( 'مدت باید بین ۱ دقیقه و ۲۴ ساعت باشد.' );
		}
		$date = MP_Util::valid_date( (string) $r['date'] ) ? (string) $r['date'] : MP_Util::today();
		if ( $date > MP_Util::today() ) {
			return self::err( 'برای روزهای آینده نمی‌توان زمان کار ثبت کرد.' );
		}
		$id = self::log( $task, $min * 60, 'manual', $date, MP_Util::text( $r['note'], 200 ) );
		$wpdb->query( $wpdb->prepare( 'UPDATE ' . MP_Install::table( 'tasks' ) . ' SET time_spent = time_spent + %d WHERE id = %d', $min * 60, $task->id ) ); // phpcs:ignore
		MP_Audit::log( 'create', 'task', $task->id, 'ثبت دستی ' . MP_Jalali::digits( (string) $min ) . ' دقیقه کار روی «' . $task->title . '»' );
		return self::entry_payload( $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t() . ' WHERE id = %d', $id ) ) );
	}

	public static function remove( WP_REST_Request $r ) {
		global $wpdb;
		$e = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t() . ' WHERE id = %d', (int) $r['id'] ) );
		if ( ! $e ) {
			return self::err( 'ثبت زمان پیدا نشد.', 404 );
		}
		if ( ! MP_Util::is_manager() && ! ( (int) $e->user_id === get_current_user_id() && 'manual' === $e->source ) ) {
			return self::err( 'اجازه حذف این ثبت زمان را ندارید.', 403 );
		}
		$wpdb->delete( self::t(), array( 'id' => $e->id ) );
		$wpdb->query( $wpdb->prepare( 'UPDATE ' . MP_Install::table( 'tasks' ) . ' SET time_spent = GREATEST(0, CAST(time_spent AS SIGNED) - %d) WHERE id = %d', $e->seconds, $e->task_id ) ); // phpcs:ignore
		MP_Audit::log( 'delete', 'task', $e->task_id, 'حذف ثبت زمان «' . $e->task_title . '»' );
		return array( 'deleted' => true );
	}

	public static function rates() {
		$out = array();
		foreach ( MP_Util::panel_users() as $uid ) {
			$u     = get_userdata( $uid );
			$out[] = array( 'id' => $uid, 'name' => $u ? $u->display_name : '', 'title' => (string) get_user_meta( $uid, 'mp_job_title', true ), 'rate' => self::rate( $uid ) );
		}
		return $out;
	}

	public static function save_rates( WP_REST_Request $r ) {
		$changed = 0;
		foreach ( is_array( $r['rates'] ) ? $r['rates'] : array() as $uid => $amount ) {
			$uid    = (int) $uid;
			$amount = max( 0, min( 100000000, (int) preg_replace( '/\D/', '', J_latin( (string) $amount ) ) ) );
			if ( ! $uid || ! user_can( $uid, 'mp_access_panel' ) || self::rate( $uid ) === $amount ) {
				continue;
			}
			update_user_meta( $uid, 'mp_hourly_rate', $amount );
			// Time logged while there was no rate takes the first rate set.
			global $wpdb;
			$wpdb->update( self::t(), array( 'rate' => $amount ), array( 'user_id' => $uid, 'rate' => 0 ) );
			++$changed;
		}
		if ( $changed ) {
			MP_Audit::log( 'update', 'member', 0, 'تغییر نرخ ساعتی ' . MP_Jalali::digits( (string) $changed ) . ' نفر' );
		}
		return self::rates();
	}

	/** Per-project time, labor cost, expenses and income for a date range. */
	public static function report( WP_REST_Request $r ) {
		global $wpdb;
		$from = MP_Util::valid_date( (string) $r['from'] ) ? (string) $r['from'] : '1970-01-01';
		$to   = MP_Util::valid_date( (string) $r['to'] ) ? (string) $r['to'] : '2999-12-31';
		$rows = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::t() . ' WHERE work_date BETWEEN %s AND %s', $from, $to ) );

		$names = array();
		foreach ( $wpdb->get_results( 'SELECT id, name FROM ' . MP_Install::table( 'projects' ) ) as $p ) { // phpcs:ignore
			$names[ (int) $p->id ] = $p->name;
		}
		$blank = function ( $pid ) use ( $names ) {
			return array(
				'id'      => $pid,
				'name'    => $pid ? ( isset( $names[ $pid ] ) ? $names[ $pid ] : 'پروژه حذف‌شده' ) : 'بدون پروژه',
				'seconds' => 0,
				'labor'   => 0,
				'expense' => 0,
				'income'  => 0,
				'people'  => array(),
				'tasks'   => array(),
			);
		};
		$projects = array();
		$people   = array();
		$unrated  = array();
		foreach ( $rows as $e ) {
			$pid  = (int) $e->project_id;
			$uid  = (int) $e->user_id;
			$rate = (int) $e->rate ? (int) $e->rate : self::rate( $uid );
			$cost = (int) round( $e->seconds / 3600 * $rate );
			if ( ! $rate ) {
				$unrated[ $uid ] = true;
			}
			if ( ! isset( $projects[ $pid ] ) ) {
				$projects[ $pid ] = $blank( $pid );
			}
			$p             = &$projects[ $pid ];
			$p['seconds'] += (int) $e->seconds;
			$p['labor']   += $cost;
			if ( ! isset( $p['people'][ $uid ] ) ) {
				$p['people'][ $uid ] = array( 'id' => $uid, 'seconds' => 0, 'cost' => 0 );
			}
			$p['people'][ $uid ]['seconds'] += (int) $e->seconds;
			$p['people'][ $uid ]['cost']    += $cost;
			$tk = (int) $e->task_id;
			if ( ! isset( $p['tasks'][ $tk ] ) ) {
				$p['tasks'][ $tk ] = array( 'id' => $tk, 'title' => $e->task_title, 'seconds' => 0, 'cost' => 0 );
			}
			$p['tasks'][ $tk ]['seconds'] += (int) $e->seconds;
			$p['tasks'][ $tk ]['cost']    += $cost;
			unset( $p );
			if ( ! isset( $people[ $uid ] ) ) {
				$u              = get_userdata( $uid );
				$people[ $uid ] = array( 'id' => $uid, 'name' => $u ? $u->display_name : 'کاربر حذف‌شده', 'rate' => self::rate( $uid ), 'seconds' => 0, 'cost' => 0 );
			}
			$people[ $uid ]['seconds'] += (int) $e->seconds;
			$people[ $uid ]['cost']    += $cost;
		}
		$money = $wpdb->get_results( $wpdb->prepare( 'SELECT project_id, type, SUM(amount) AS total FROM ' . MP_Install::table( 'ledger' ) . ' WHERE project_id > 0 AND entry_date BETWEEN %s AND %s GROUP BY project_id, type', $from, $to ) );
		foreach ( $money as $m ) {
			$pid = (int) $m->project_id;
			if ( ! isset( $projects[ $pid ] ) ) {
				$projects[ $pid ] = $blank( $pid );
			}
			$projects[ $pid ][ 'income' === $m->type ? 'income' : 'expense' ] += (int) $m->total;
		}
		$totals = array( 'seconds' => 0, 'labor' => 0, 'expense' => 0, 'income' => 0 );
		foreach ( $projects as &$p ) {
			foreach ( $totals as $k => $v ) {
				$totals[ $k ] += $p[ $k ];
			}
			$p['people'] = array_values( $p['people'] );
			usort( $p['people'], function ( $a, $b ) { return $b['seconds'] - $a['seconds']; } );
			$p['tasks'] = array_values( $p['tasks'] );
			usort( $p['tasks'], function ( $a, $b ) { return $b['seconds'] - $a['seconds']; } );
			$p['tasks'] = array_slice( $p['tasks'], 0, 8 );
		}
		unset( $p );
		$projects = array_values( $projects );
		usort( $projects, function ( $a, $b ) { return ( $b['labor'] + $b['expense'] ) - ( $a['labor'] + $a['expense'] ); } );
		$people = array_values( $people );
		usort( $people, function ( $a, $b ) { return $b['seconds'] - $a['seconds']; } );
		return array(
			'from'     => $from,
			'to'       => $to,
			'totals'   => $totals,
			'projects' => $projects,
			'people'   => $people,
			'unrated'  => count( $unrated ),
		);
	}
}
