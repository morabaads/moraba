<?php
defined( 'ABSPATH' ) || exit;

/**
 * REST API for the panel. Every permission rule lives here, never only in the browser:
 * - an employee sees and changes only their own tasks;
 * - a task a manager assigned (source = manager) is locked for its owner: only its status can change;
 * - projects, members, sections, milestones and folders are managed by managers.
 */
class MP_Rest {

	const NS = 'moraba-panel/v1';

	public static function register() {
		$auth    = array( __CLASS__, 'can_access' );
		$manager = array( __CLASS__, 'can_manage' );
		$id      = '(?P<id>\d+)';

		$routes = array(
			array( 'bootstrap', 'GET', 'bootstrap', $auth ),
			array( 'me', 'POST', 'update_me', $auth ),
			array( 'heartbeat', 'GET', 'heartbeat', $auth ),

			array( 'tasks', 'GET', 'list_tasks', $auth ),
			array( 'tasks', 'POST', 'create_task', $auth ),
			array( 'tasks/bulk', 'POST', 'create_tasks_bulk', $manager ),
			array( "tasks/$id", 'POST', 'update_task', $auth ),
			array( "tasks/$id", 'DELETE', 'delete_task', $auth ),
			array( "tasks/$id/restore", 'POST', 'restore_task', $auth ),
			array( "channels/$id/restore", 'POST', 'restore_channel', $auth ),
			array( "channels/$id/members", 'POST', 'set_channel_members', $auth ),
			array( "channels/$id/logo", 'POST', 'set_channel_logo', $auth ),
			array( "channels/$id/pin", 'POST', 'pin_channel', $auth ),

			array( 'goals', 'GET', 'get_goal', $auth ),
			array( 'goals', 'POST', 'save_goal', $auth ),

			array( 'projects', 'GET', 'list_projects', $auth ),
			array( 'projects', 'POST', 'create_project', $manager ),
			array( "projects/$id", 'POST', 'update_project', $manager ),
			array( "projects/$id", 'DELETE', 'delete_project', $manager ),
			array( "projects/$id/shift", 'POST', 'shift_project', $manager ),
			array( "projects/$id/shift/undo", 'POST', 'undo_shift', $manager ),
			array( "projects/$id/members", 'POST', 'add_members', $manager ),
			array( "projects/$id/members/(?P<user>\d+)", 'DELETE', 'remove_member', $manager ),
			array( "projects/$id/sections", 'POST', 'create_section', $manager ),
			array( "sections/$id", 'POST', 'update_section', $manager ),
			array( "sections/$id", 'DELETE', 'delete_section', $manager ),
			array( "projects/$id/milestones", 'POST', 'create_milestone', $manager ),
			array( "milestones/$id", 'POST', 'update_milestone', $manager ),
			array( "milestones/$id", 'DELETE', 'delete_milestone', $manager ),
			array( "projects/$id/notes", 'GET', 'list_notes', $auth ),
			array( "projects/$id/notes", 'POST', 'create_note', $auth ),
			array( "notes/$id", 'DELETE', 'delete_note', $auth ),

			array( 'folders', 'POST', 'create_folder', $manager ),
			array( "folders/$id", 'DELETE', 'delete_folder', $manager ),

			array( 'channels', 'GET', 'list_channels', $auth ),
			array( 'channels', 'POST', 'create_channel', $auth ),
			array( "channels/$id", 'DELETE', 'delete_channel', $auth ),
			array( "channels/$id/messages", 'GET', 'list_messages', $auth ),
			array( "channels/$id/messages", 'POST', 'send_message', $auth ),
			array( "channels/$id/activity", 'POST', 'chat_activity', $auth ),
			array( "messages/$id", 'DELETE', 'delete_message', $auth ),
			array( 'auth/logout', 'POST', 'logout', $auth ),


			array( 'reminders', 'GET', 'list_reminders', $auth ),
			array( 'reminders', 'POST', 'create_reminder', $auth ),
			array( "reminders/$id", 'DELETE', 'delete_reminder', $auth ),

			array( 'notifications', 'GET', 'list_notifications', $auth ),
			array( 'notifications/read', 'POST', 'read_notifications', $auth ),

			array( 'reports', 'GET', 'reports', $auth ),

			array( 'ledger', 'GET', 'list_ledger', $auth ),
			array( 'ledger', 'POST', 'create_ledger', $auth ),
			array( 'ledger/summary', 'GET', 'ledger_summary', $auth ),
			array( "ledger/$id", 'DELETE', 'delete_ledger', $auth ),

			array( 'client/(?P<token>[A-Za-z0-9]{32})', 'GET', 'client_messages', '__return_true' ),
			array( 'client/(?P<token>[A-Za-z0-9]{32})', 'POST', 'client_send', '__return_true' ),
		);

		foreach ( $routes as $r ) {
			register_rest_route(
				self::NS,
				'/' . $r[0],
				array(
					'methods'             => $r[1],
					'callback'            => array( __CLASS__, $r[2] ),
					'permission_callback' => $r[3],
				),
				false
			);
		}
	}

	public static function can_access() {
		return is_user_logged_in() && current_user_can( 'mp_access_panel' );
	}

	public static function can_manage() {
		return is_user_logged_in() && current_user_can( 'mp_manage_panel' );
	}

	private static function err( $message, $status = 400, $code = 'mp_error' ) {
		return new WP_Error( $code, $message, array( 'status' => $status ) );
	}

	private static function uid() {
		return get_current_user_id();
	}

	private static function t( $name ) {
		return MP_Install::table( $name );
	}

	/* ------------------------------------------------------------------ Bootstrap */

	public static function bootstrap() {
		$uid = self::uid();
		update_user_meta( $uid, 'mp_last_seen', time() );
		$users = array();
		foreach ( MP_Util::panel_users() as $id ) {
			$p = MP_Util::user_payload( $id );
			if ( $p ) {
				$users[] = $p;
			}
		}
		$prefs = get_user_meta( $uid, 'mp_prefs', true );
		return array(
			'me'        => MP_Util::user_payload( $uid ),
			'email'     => wp_get_current_user()->user_email,
			'prefs'     => wp_parse_args( is_array( $prefs ) ? $prefs : array(), array( 'dark' => true, 'motion' => false, 'emails' => true, 'telegram' => true, 'bale' => true, 'sms' => true ) ),
			'channels'  => array(
				'telegram'      => (bool) get_option( 'mp_telegram_token', '' ),
				'bale'          => (bool) get_option( 'mp_bale_token', '' ),
				'speech'        => MP_Speech::enabled(),
				'ai'            => MP_AI::enabled(),
				'sms'           => MP_Auth::otp_enabled(),
				'telegram_chat' => (string) get_user_meta( $uid, 'mp_telegram_chat', true ),
				'bale_chat'     => (string) get_user_meta( $uid, 'mp_bale_chat', true ),
			),
			'today'     => MP_Util::today(),
			'now'       => current_time( 'H:i' ),
			'users'     => $users,
			'manager'   => MP_Util::is_manager(),
			'logoutUrl' => wp_logout_url( home_url( '/' ) ),
			'clientUrl' => get_option( 'permalink_structure' ) ? home_url( '/c/' ) : add_query_arg( 'mp_client', '', home_url( '/' ) ),
			'counts'    => self::counts( $uid ),
		);
	}

	private static function counts( $uid ) {
		global $wpdb;
		$open = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM ' . self::t( 'tasks' ) . " WHERE archived_at IS NULL AND user_id = %d AND status <> 'done'", $uid ) );
		$rem  = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM ' . self::t( 'reminders' ) . ' WHERE user_id = %d AND (fired_at IS NULL OR repeat_every <> %s)', $uid, 'none' ) );
		$note = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM ' . self::t( 'notifications' ) . ' WHERE user_id = %d AND is_read = 0', $uid ) );
		$msgs = 0;
		foreach ( self::channels_for( $uid ) as $ch ) {
			$msgs += self::unread( $ch->id, $uid );
		}
		$leaves = MP_Util::is_manager( $uid ) ? (int) $wpdb->get_var( 'SELECT COUNT(*) FROM ' . self::t( 'leaves' ) . " WHERE status = 'pending'" ) : 0;
		return array( 'tasks' => $open, 'messages' => $msgs, 'reminders' => $rem, 'notifications' => $note, 'leaves' => $leaves );
	}

	public static function heartbeat() {
		MP_Live::seen( self::uid() );
		MP_Chat::flush_scheduled();
		return array( 'counts' => self::counts( self::uid() ), 'today' => MP_Util::today(), 'now' => current_time( 'H:i' ) );
	}

	public static function update_me( WP_REST_Request $r ) {
		$uid = self::uid();
		if ( null !== $r['name'] ) {
			$name = MP_Util::text( $r['name'], 80 );
			if ( '' === $name ) {
				return self::err( 'نام نمایشی را وارد کنید.' );
			}
			wp_update_user( array( 'ID' => $uid, 'display_name' => $name ) );
		}
		if ( null !== $r['title'] ) {
			update_user_meta( $uid, 'mp_job_title', MP_Util::text( $r['title'], 80 ) );
		}
		if ( null !== $r['phone'] ) {
			$phone = trim( (string) $r['phone'] );
			$norm  = MP_Auth::normalize( $phone );
			if ( '' !== $phone && ! $norm ) {
				return self::err( 'شماره موبایل معتبر نیست. نمونه: ۰۹۱۲۱۲۳۴۵۶۷' );
			}
			if ( $norm && MP_Auth::mobile_taken( $norm, $uid ) ) {
				return self::err( 'این شماره برای کارمند دیگری ثبت شده است.' );
			}
			update_user_meta( $uid, 'mp_phone', $norm );
		}
		foreach ( array( 'telegram_chat', 'bale_chat' ) as $k ) {
			if ( null !== $r[ $k ] ) {
				update_user_meta( $uid, 'mp_' . $k, preg_replace( '/[^0-9\-]/', '', MP_Util::text( J_latin( $r[ $k ] ), 30 ) ) );
			}
		}
		if ( is_array( $r['prefs'] ) ) {
			$p   = $r['prefs'];
			$out = array();
			foreach ( array( 'dark', 'motion', 'emails', 'telegram', 'bale', 'sms' ) as $k ) {
				$out[ $k ] = ! empty( $p[ $k ] );
			}
			update_user_meta( $uid, 'mp_prefs', $out );
		}
		return self::bootstrap();
	}

	/* ------------------------------------------------------------------ Tasks */

	public static function get_task( $id ) {
		global $wpdb;
		return $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'tasks' ) . ' WHERE id = %d', $id ) );
	}

	/** True when the current user may change everything on the task, not only its status. */
	public static function can_edit_task( $task ) {
		// Every supervisor may edit every task, including ones another supervisor assigned to them.
		if ( MP_Util::is_manager() ) {
			return true;
		}
		return (int) $task->user_id === self::uid() && 'self' === $task->source;
	}

	public static function can_view_task( $task ) {
		if ( (int) $task->user_id === self::uid() || MP_Util::is_manager() ) {
			return true;
		}
		return $task->project_id && MP_Util::can_see_project( $task->project_id );
	}

	public static function can_view_task_id( $id ) {
		$task = self::get_task( (int) $id );
		return $task && self::can_view_task( $task );
	}

	/** Checklist, comment and file counts for many tasks in three queries. */
	private static function task_counts( array $ids ) {
		global $wpdb;
		$out = array();
		if ( ! $ids ) {
			return $out;
		}
		$in = implode( ',', array_map( 'intval', $ids ) );
		foreach ( $wpdb->get_results( 'SELECT task_id, COUNT(*) n, SUM(done) d FROM ' . self::t( 'task_items' ) . " WHERE task_id IN ($in) GROUP BY task_id" ) as $r ) {
			$out[ (int) $r->task_id ]['items'] = array( (int) $r->n, (int) $r->d );
		}
		foreach ( $wpdb->get_results( 'SELECT task_id, COUNT(*) n FROM ' . self::t( 'task_comments' ) . " WHERE task_id IN ($in) GROUP BY task_id" ) as $r ) {
			$out[ (int) $r->task_id ]['comments'] = (int) $r->n;
		}
		foreach ( $wpdb->get_results( 'SELECT context_id, COUNT(*) n FROM ' . self::t( 'files' ) . " WHERE context = 'task' AND context_id IN ($in) GROUP BY context_id" ) as $r ) {
			$out[ (int) $r->context_id ]['files'] = (int) $r->n;
		}
		return $out;
	}

	public static function task_payload( $task, $counts = null ) {
		$by = $task->assigned_by ? get_userdata( $task->assigned_by ) : null;
		$me = self::uid();
		if ( null === $counts ) {
			$all    = self::task_counts( array( (int) $task->id ) );
			$counts = isset( $all[ (int) $task->id ] ) ? $all[ (int) $task->id ] : array();
		}
		$spent = (int) $task->time_spent;
		return array(
			'id'            => (int) $task->id,
			'user_id'       => (int) $task->user_id,
			'title'         => $task->title,
			'description'   => (string) $task->description,
			'date'          => $task->task_date,
			'time'          => $task->task_time,
			'project_id'    => (int) $task->project_id,
			'section_id'    => (int) $task->section_id,
			'priority'      => $task->priority,
			'client_hidden' => ! empty( $task->client_hidden ),
			'status'        => $task->status,
			'done'          => 'done' === $task->status,
			'source'        => $task->source,
			'assigned_by'   => $by ? $by->display_name : '',
			'assigned_by_id'=> (int) $task->assigned_by,
			'locked'        => ! self::can_edit_task( $task ),
			'can_status'    => (int) $task->user_id === $me || MP_Util::is_manager(),
			'done_at'       => $task->done_at,
			'recurrence'    => $task->recurrence,
			'series'        => (int) ( $task->recur_parent ? $task->recur_parent : ( 'none' !== $task->recurrence ? $task->id : 0 ) ),
			'seen_at'       => $task->seen_at,
			'time_spent'    => $spent,
			'timer_started' => $task->timer_started,
			'timer_elapsed' => $task->timer_started ? max( 0, current_time( 'timestamp' ) - strtotime( $task->timer_started ) ) : 0, // phpcs:ignore WordPress.DateTime.CurrentTimeTimestamp
			'items_total'   => isset( $counts['items'] ) ? $counts['items'][0] : 0,
			'items_done'    => isset( $counts['items'] ) ? $counts['items'][1] : 0,
			'comments'      => isset( $counts['comments'] ) ? $counts['comments'] : 0,
			'files'         => isset( $counts['files'] ) ? $counts['files'] : 0,
		);
	}

	public static function payloads( array $rows ) {
		$counts = self::task_counts( wp_list_pluck( $rows, 'id' ) );
		$out    = array();
		foreach ( $rows as $row ) {
			$out[] = self::task_payload( $row, isset( $counts[ (int) $row->id ] ) ? $counts[ (int) $row->id ] : array() );
		}
		return $out;
	}

	public static function list_tasks( WP_REST_Request $r ) {
		global $wpdb;
		// Nothing is deleted: removed tasks are archived and listed only with ?archived=1.
		$where = array( $r['archived'] ? 'archived_at IS NOT NULL' : 'archived_at IS NULL' );
		$args  = array();

		$project = (int) $r['project_id'];
		if ( $project ) {
			if ( ! MP_Util::can_see_project( $project ) ) {
				return self::err( 'به این پروژه دسترسی ندارید.', 403 );
			}
			$where[] = 'project_id = %d';
			$args[]  = $project;
		} else {
			$user = (int) $r['user_id'];
			if ( ( $user && $user !== self::uid() || 'all' === $r['user_id'] ) && ! MP_Util::is_manager() ) {
				return self::err( 'فقط ناظر می‌تواند تقویم دیگران را ببیند.', 403 );
			}
			if ( 'all' === $r['user_id'] ) {
				$user = 0;
			} elseif ( ! $user ) {
				$user = self::uid();
			}
			if ( $user ) {
				$where[] = 'user_id = %d';
				$args[]  = $user;
			}
		}
		if ( MP_Util::valid_date( $r['from'] ) ) {
			$where[] = 'task_date >= %s';
			$args[]  = $r['from'];
		}
		if ( MP_Util::valid_date( $r['to'] ) ) {
			$where[] = 'task_date <= %s';
			$args[]  = $r['to'];
		}
		$sql  = 'SELECT * FROM ' . self::t( 'tasks' ) . ' WHERE ' . implode( ' AND ', $where ) . " ORDER BY task_date, task_time = '', task_time, id LIMIT 3000";
		$rows = $args ? $wpdb->get_results( $wpdb->prepare( $sql, $args ) ) : $wpdb->get_results( $sql );
		return self::payloads( $rows );
	}

	/** Validates task fields; returns array or WP_Error. */
	private static function task_fields( WP_REST_Request $r, $current = null ) {
		$f = array();
		if ( null !== $r['title'] || ! $current ) {
			$f['title'] = MP_Util::text( $r['title'], 200 );
			if ( '' === $f['title'] ) {
				return self::err( 'عنوان تسک را وارد کنید.' );
			}
		}
		if ( null !== $r['description'] ) {
			$f['description'] = MP_Util::long_text( $r['description'], 4000 );
		}
		if ( null !== $r['date'] || ! $current ) {
			if ( ! MP_Util::valid_date( $r['date'] ) ) {
				return self::err( 'تاریخ تسک معتبر نیست.' );
			}
			$f['task_date'] = $r['date'];
		}
		if ( null !== $r['time'] ) {
			if ( ! MP_Util::valid_time( $r['time'] ) ) {
				return self::err( 'ساعت را به شکل ۱۰:۳۰ وارد کنید.' );
			}
			$f['task_time'] = $r['time'];
		}
		if ( null !== $r['priority'] ) {
			$f['priority'] = MP_Util::pick( $r['priority'], array( 'low', 'medium', 'high' ), 'medium' );
		}
		if ( null !== $r['client_hidden'] ) {
			$f['client_hidden'] = $r['client_hidden'] && 'false' !== $r['client_hidden'] ? 1 : 0;
		}
		if ( null !== $r['project_id'] ) {
			$project = (int) $r['project_id'];
			if ( $project && ! MP_Util::can_see_project( $project ) ) {
				return self::err( 'به این پروژه دسترسی ندارید.', 403 );
			}
			$f['project_id'] = $project;
			$f['section_id'] = 0;
		}
		if ( null !== $r['section_id'] ) {
			global $wpdb;
			$section = (int) $r['section_id'];
			if ( $section ) {
				$project = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT project_id FROM ' . self::t( 'sections' ) . ' WHERE id = %d', $section ) );
				if ( ! $project || ! MP_Util::can_see_project( $project ) ) {
					return self::err( 'بخش پروژه پیدا نشد.', 404 );
				}
				$f['project_id'] = $project;
			}
			$f['section_id'] = $section;
		}
		if ( null !== $r['status'] ) {
			$f['status'] = MP_Util::pick( $r['status'], array( 'todo', 'doing', 'done' ), 'todo' );
		}
		return $f;
	}

	/** Dates of a recurring series: at most 120 occurrences and one year. */
	private static function series_dates( $start, $rule, $until ) {
		$dates = array( $start );
		if ( 'none' === $rule ) {
			return $dates;
		}
		$limit = MP_Util::add_days( $start, 366 );
		$until = MP_Util::valid_date( $until ) && $until < $limit ? $until : $limit;
		$step  = array( 'daily' => '+1 day', 'weekdays' => '+1 day', 'weekly' => '+1 week', 'monthly' => '+1 month' );
		$d     = $start;
		while ( count( $dates ) < 120 ) {
			$d = gmdate( 'Y-m-d', strtotime( $d . ' ' . $step[ $rule ] . ' UTC' ) );
			if ( $d > $until ) {
				break;
			}
			// "weekdays" skips Friday (Iranian weekend).
			if ( 'weekdays' === $rule && '5' === gmdate( 'w', strtotime( $d . ' UTC' ) ) ) {
				continue;
			}
			$dates[] = $d;
		}
		return $dates;
	}

	/**
	 * POST tasks/bulk {items: [{user_id, title, date, time?, priority?, project_id?, description?}]}
	 * Supervisor's batch (e.g. from one spoken sentence): every item goes through create_task, so the
	 * same checks, locking and notifications apply. Stops nothing on a bad item; reports it instead.
	 */
	public static function create_tasks_bulk( WP_REST_Request $r ) {
		$items = is_array( $r['items'] ) ? array_slice( $r['items'], 0, 200 ) : array();
		if ( ! $items ) {
			return self::err( 'هیچ تسکی برای ساختن نیست.' );
		}
		$made   = 0;
		$failed = array();
		foreach ( $items as $i => $it ) {
			$one = new WP_REST_Request( 'POST' );
			foreach ( array( 'user_id', 'title', 'date', 'time', 'priority', 'project_id', 'section_id', 'description', 'checklist', 'client_hidden' ) as $k ) {
				if ( isset( $it[ $k ] ) ) {
					$one->set_param( $k, $it[ $k ] );
				}
			}
			$res = self::create_task( $one );
			if ( is_wp_error( $res ) ) {
				$failed[] = array( 'index' => $i, 'message' => $res->get_error_message() );
			} else {
				$made += isset( $res['created'] ) ? (int) $res['created'] : 1;
			}
		}
		return array( 'created' => $made, 'failed' => $failed );
	}

	public static function create_task( WP_REST_Request $r ) {
		global $wpdb;
		$uid    = self::uid();
		$owners = is_array( $r['user_ids'] ) && $r['user_ids'] ? array_values( array_unique( array_map( 'intval', $r['user_ids'] ) ) ) : array( (int) $r['user_id'] ? (int) $r['user_id'] : $uid );
		foreach ( $owners as $owner ) {
			if ( $owner !== $uid && ! MP_Util::is_manager() ) {
				return self::err( 'فقط ناظر می‌تواند برای دیگران تسک تعیین کند.', 403 );
			}
			if ( ! MP_Util::is_panel_user( $owner ) ) {
				return self::err( 'کاربر انتخاب‌شده عضو پنل نیست.', 404 );
			}
		}
		$f = self::task_fields( $r );
		if ( is_wp_error( $f ) ) {
			return $f;
		}
		$rule  = MP_Util::pick( $r['recurrence'], array( 'none', 'daily', 'weekdays', 'weekly', 'monthly' ), 'none' );
		$dates = self::series_dates( $f['task_date'], $rule, (string) $r['recur_until'] );
		$items = is_array( $r['checklist'] ) ? array_slice( array_filter( array_map( function ( $x ) { return MP_Util::text( $x, 200 ); }, $r['checklist'] ) ), 0, 50 ) : array();
		$first = null;
		$made  = 0;
		foreach ( $owners as $owner ) {
			$by_manager = $owner !== $uid || ( MP_Util::is_manager() && ! empty( $r['locked'] ) );
			$parent     = 0;
			foreach ( $dates as $date ) {
				$row = $f + array(
					'user_id'      => $owner,
					'source'       => $by_manager ? 'manager' : 'self',
					'assigned_by'  => $by_manager ? $uid : 0,
					'recurrence'   => $rule,
					'recur_parent' => $parent,
					'created_at'   => MP_Util::now(),
					'updated_at'   => MP_Util::now(),
				);
				$row['task_date'] = $date;
				if ( isset( $row['status'] ) && 'done' === $row['status'] ) {
					$row['done_at'] = MP_Util::now();
				}
				$wpdb->insert( self::t( 'tasks' ), $row );
				$id = (int) $wpdb->insert_id;
				if ( ! $parent && 'none' !== $rule ) {
					$parent = $id;
				}
				foreach ( $items as $i => $text ) {
					$wpdb->insert( self::t( 'task_items' ), array( 'task_id' => $id, 'text' => $text, 'done' => 0, 'sort' => $i ) );
				}
				if ( ! $first ) {
					$first = $id;
				}
				++$made;
			}
			if ( $by_manager && $owner !== $uid ) {
				$when = MP_Jalali::format( $dates[0] ) . ( count( $dates ) > 1 ? ' (' . MP_Jalali::digits( count( $dates ) ) . ' بار تکرار)' : '' );
				MP_Notify::event( 'task_assigned', $owner, array( 'ACTOR' => wp_get_current_user()->display_name, 'TASK' => $f['title'], 'WHEN' => $when ), 'calendar', $parent ? $parent : $id, self::wants_email( $owner ) );
			}
		}
		$who = implode( '، ', array_map( function ( $o ) { $u = get_userdata( $o ); return $u ? $u->display_name : $o; }, $owners ) );
		MP_Audit::log( 'create', 'task', $first, '«' . $f['title'] . '» برای ' . $who . ' در ' . MP_Jalali::format( $dates[0] ) . ( $made > count( $owners ) ? ' (تکرار: ' . MP_Jalali::digits( count( $dates ) ) . ')' : '' ) );
		$payload            = self::task_payload( self::get_task( $first ) );
		$payload['created'] = $made;
		return $payload;
	}

	public static function update_task( WP_REST_Request $r ) {
		global $wpdb;
		$task = self::get_task( (int) $r['id'] );
		if ( ! $task || ! self::can_view_task( $task ) ) {
			return self::err( 'تسک پیدا نشد.', 404 );
		}
		$uid  = self::uid();
		$full = self::can_edit_task( $task );
		if ( ! $full ) {
			// Locked task: its owner may only report progress.
			if ( (int) $task->user_id !== $uid ) {
				return self::err( 'اجازه تغییر این تسک را ندارید.', 403 );
			}
			foreach ( array( 'title', 'description', 'date', 'time', 'priority', 'project_id', 'section_id', 'user_id', 'client_hidden' ) as $k ) {
				if ( null !== $r[ $k ] ) {
					return self::err( 'این تسک را ناظر تعیین کرده و قابل ویرایش نیست؛ فقط وضعیت آن را می‌توانید تغییر دهید.', 403, 'mp_locked' );
				}
			}
		}
		$f = self::task_fields( $r, $task );
		if ( is_wp_error( $f ) ) {
			return $f;
		}
		if ( $full && MP_Util::is_manager() && null !== $r['user_id'] ) {
			$owner = (int) $r['user_id'];
			if ( ! MP_Util::is_panel_user( $owner ) ) {
				return self::err( 'کاربر انتخاب‌شده عضو پنل نیست.', 404 );
			}
			$f['user_id'] = $owner;
			if ( $owner !== $uid ) {
				$f['source']      = 'manager';
				$f['assigned_by'] = $uid;
			}
		}
		if ( isset( $f['status'] ) ) {
			$f['done_at'] = 'done' === $f['status'] ? MP_Util::now() : null;
		}
		if ( ! $f ) {
			return self::task_payload( $task );
		}
		$f['updated_at'] = MP_Util::now();
		$wpdb->update( self::t( 'tasks' ), $f, array( 'id' => $task->id ) );
		if ( isset( $f['project_id'] ) || isset( $f['title'] ) ) {
			MP_Costs::follow_task( $task->id );
		}
		$new = self::get_task( $task->id );

		$changes = array();
		foreach ( array( 'title' => 'عنوان', 'task_date' => 'تاریخ', 'task_time' => 'ساعت', 'status' => 'وضعیت', 'priority' => 'اولویت', 'user_id' => 'مسئول', 'description' => 'توضیحات' ) as $col => $label ) {
			if ( isset( $f[ $col ] ) && (string) $f[ $col ] !== (string) $task->$col ) {
				$changes[] = $label;
			}
		}
		if ( $changes ) {
			MP_Audit::log( 'update', 'task', $task->id, '«' . $new->title . '»: ' . implode( '، ', $changes ) . ( isset( $f['status'] ) ? ' → ' . $f['status'] : '' ) );
		}
		if ( 'manager' === $new->source ) {
			if ( (int) $new->user_id !== $uid && $full && array_diff( $changes, array( 'وضعیت' ) ) ) {
				MP_Notify::event( 'task_updated', $new->user_id, array( 'TASK' => $new->title, 'DATE' => MP_Jalali::format( $new->task_date ) ), 'calendar', $new->id );
			} elseif ( isset( $f['status'] ) && 'done' === $f['status'] && $new->assigned_by && (int) $new->assigned_by !== $uid ) {
				MP_Notify::event( 'task_done', $new->assigned_by, array( 'ACTOR' => wp_get_current_user()->display_name, 'TASK' => $new->title ), 'calendar', $new->id );
			}
		}
		return self::task_payload( $new );
	}

	public static function delete_task( WP_REST_Request $r ) {
		global $wpdb;
		$task = self::get_task( (int) $r['id'] );
		if ( ! $task || ! self::can_view_task( $task ) ) {
			return self::err( 'تسک پیدا نشد.', 404 );
		}
		if ( ! self::can_edit_task( $task ) ) {
			return self::err( 'این تسک را ناظر تعیین کرده و قابل حذف نیست.', 403, 'mp_locked' );
		}
		$ids = array( (int) $task->id );
		if ( 'series' === $r['scope'] && 'none' !== $task->recurrence ) {
			$parent = $task->recur_parent ? (int) $task->recur_parent : (int) $task->id;
			$ids    = array_map(
				'intval',
				$wpdb->get_col( $wpdb->prepare( 'SELECT id FROM ' . self::t( 'tasks' ) . ' WHERE (id = %d OR recur_parent = %d) AND user_id = %d AND task_date >= %s', $parent, $parent, $task->user_id, $task->task_date ) )
			);
		}
		foreach ( $ids as $id ) {
			$wpdb->update( self::t( 'tasks' ), array( 'archived_at' => MP_Util::now(), 'timer_started' => null ), array( 'id' => $id ) );
		}
		MP_Audit::log( 'archive', 'task', $task->id, '«' . $task->title . '»' . ( count( $ids ) > 1 ? ' و ' . MP_Jalali::digits( count( $ids ) - 1 ) . ' تکرار بعدی' : '' ) . ' از تقویم ' . ( get_userdata( $task->user_id ) ? get_userdata( $task->user_id )->display_name : '' ) );
		if ( 'manager' === $task->source && (int) $task->user_id !== self::uid() ) {
			MP_Notify::event( 'task_archived', $task->user_id, array( 'TASK' => $task->title, 'DATE' => MP_Jalali::format( $task->task_date ) ), 'calendar' );
		}
		return array( 'deleted' => count( $ids ), 'archived' => count( $ids ), 'ids' => $ids );
	}

	/** POST tasks/{id}/restore — brings an archived task back. */
	public static function restore_task( WP_REST_Request $r ) {
		global $wpdb;
		$task = self::get_task( (int) $r['id'] );
		if ( ! $task || ! self::can_view_task( $task ) ) {
			return self::err( 'تسک پیدا نشد.', 404 );
		}
		if ( ! self::can_edit_task( $task ) ) {
			return self::err( 'اجازه بازگرداندن این تسک را ندارید.', 403 );
		}
		$wpdb->update( self::t( 'tasks' ), array( 'archived_at' => null, 'updated_at' => MP_Util::now() ), array( 'id' => $task->id ) );
		MP_Audit::log( 'restore', 'task', $task->id, '«' . $task->title . '» از آرشیو' );
		return self::task_payload( self::get_task( $task->id ) );
	}

	private static function purge_task( $id ) {
		global $wpdb;
		foreach ( $wpdb->get_col( $wpdb->prepare( 'SELECT id FROM ' . self::t( 'files' ) . " WHERE context = 'task' AND context_id = %d", $id ) ) as $fid ) {
			MP_Files::delete( $fid );
		}
		foreach ( $wpdb->get_col( $wpdb->prepare( 'SELECT file_id FROM ' . self::t( 'task_comments' ) . ' WHERE task_id = %d AND file_id > 0', $id ) ) as $fid ) {
			MP_Files::delete( $fid );
		}
		$wpdb->delete( self::t( 'task_items' ), array( 'task_id' => $id ) );
		$wpdb->delete( self::t( 'task_comments' ), array( 'task_id' => $id ) );
		$wpdb->delete( self::t( 'tasks' ), array( 'id' => $id ) );
	}

	public static function wants_email( $user_id ) {
		$p = get_user_meta( $user_id, 'mp_prefs', true );
		return ! is_array( $p ) || ! isset( $p['emails'] ) || $p['emails'];
	}

	/* ------------------------------------------------------------------ Weekly goals */

	public static function get_goal( WP_REST_Request $r ) {
		global $wpdb;
		if ( ! MP_Util::valid_date( $r['week_start'] ) ) {
			return self::err( 'هفته معتبر نیست.' );
		}
		$user = (int) $r['user_id'] ? (int) $r['user_id'] : self::uid();
		if ( $user !== self::uid() && ! MP_Util::is_manager() ) {
			return self::err( 'دسترسی ندارید.', 403 );
		}
		$text = $wpdb->get_var( $wpdb->prepare( 'SELECT text FROM ' . self::t( 'goals' ) . ' WHERE user_id = %d AND week_start = %s', $user, MP_Util::week_start( $r['week_start'] ) ) );
		return array( 'text' => (string) $text );
	}

	public static function save_goal( WP_REST_Request $r ) {
		global $wpdb;
		if ( ! MP_Util::valid_date( $r['week_start'] ) ) {
			return self::err( 'هفته معتبر نیست.' );
		}
		$text = MP_Util::text( $r['text'], 200 );
		$week = MP_Util::week_start( $r['week_start'] );
		if ( '' === $text ) {
			$wpdb->delete( self::t( 'goals' ), array( 'user_id' => self::uid(), 'week_start' => $week ) );
		} else {
			$wpdb->replace( self::t( 'goals' ), array( 'user_id' => self::uid(), 'week_start' => $week, 'text' => $text, 'updated_at' => MP_Util::now() ) );
		}
		return array( 'text' => $text );
	}

	/* ------------------------------------------------------------------ Projects */

	public static function list_projects() {
		global $wpdb;
		$ids = MP_Util::project_ids_for( self::uid() );
		$out = array( 'projects' => array(), 'folders' => array() );

		foreach ( $wpdb->get_results( 'SELECT id, name FROM ' . self::t( 'folders' ) . ' ORDER BY name' ) as $f ) {
			$out['folders'][] = array( 'id' => (int) $f->id, 'name' => $f->name );
		}
		if ( ! $ids ) {
			return $out;
		}
		$in       = implode( ',', array_map( 'intval', $ids ) );
		$projects = $wpdb->get_results( 'SELECT * FROM ' . self::t( 'projects' ) . " WHERE id IN ($in) ORDER BY id" );
		$members  = $wpdb->get_results( 'SELECT * FROM ' . self::t( 'project_members' ) . " WHERE project_id IN ($in)" );
		$sections = $wpdb->get_results( 'SELECT * FROM ' . self::t( 'sections' ) . " WHERE project_id IN ($in) ORDER BY sort, id" );
		$miles    = $wpdb->get_results( 'SELECT * FROM ' . self::t( 'milestones' ) . " WHERE project_id IN ($in) ORDER BY start_date, id" );
		$counts   = $wpdb->get_results( 'SELECT project_id, section_id, status, COUNT(*) n FROM ' . self::t( 'tasks' ) . " WHERE archived_at IS NULL AND project_id IN ($in) GROUP BY project_id, section_id, status" );

		foreach ( $projects as $p ) {
			$pid  = (int) $p->id;
			$item = array(
				'id'         => $pid,
				'name'       => $p->name,
				'icon'       => $p->icon,
				'folder_id'  => (int) $p->folder_id,
				'status'     => $p->status,
				'start'      => $p->start_date,
				'end'        => $p->end_date,
				'members'    => array(),
				'sections'   => array(),
				'milestones' => array(),
				'tasks'      => array( 'todo' => 0, 'doing' => 0, 'done' => 0 ),
			);
			foreach ( $members as $m ) {
				if ( (int) $m->project_id === $pid ) {
					$item['members'][] = (int) $m->user_id;
				}
			}
			foreach ( $sections as $s ) {
				if ( (int) $s->project_id !== $pid ) {
					continue;
				}
				$total = 0;
				$done  = 0;
				foreach ( $counts as $c ) {
					if ( (int) $c->section_id === (int) $s->id ) {
						$total += (int) $c->n;
						$done  += 'done' === $c->status ? (int) $c->n : 0;
					}
				}
				$item['sections'][] = array(
					'id'       => (int) $s->id,
					'title'    => $s->title,
					'priority' => $s->priority,
					'status'   => $s->status,
					'total'    => $total,
					'done'     => $done,
				);
			}
			foreach ( $miles as $m ) {
				if ( (int) $m->project_id === $pid ) {
					$item['milestones'][] = array(
						'id'     => (int) $m->id,
						'title'  => $m->title,
						'start'  => $m->start_date,
						'end'    => $m->end_date,
						'status' => $m->status,
					);
				}
			}
			foreach ( $counts as $c ) {
				if ( (int) $c->project_id === $pid && isset( $item['tasks'][ $c->status ] ) ) {
					$item['tasks'][ $c->status ] += (int) $c->n;
				}
			}
			$out['projects'][] = $item;
		}
		return $out;
	}

	private static function project_fields( WP_REST_Request $r, $creating ) {
		$f = array();
		if ( $creating || null !== $r['name'] ) {
			$f['name'] = MP_Util::text( $r['name'], 160 );
			if ( '' === $f['name'] ) {
				return self::err( 'نام پروژه را وارد کنید.' );
			}
		}
		if ( null !== $r['icon'] ) {
			$f['icon'] = MP_Util::pick( $r['icon'], array( 'grid', 'folder', 'calendar', 'tasks', 'pie', 'video' ), 'grid' );
		}
		if ( null !== $r['folder_id'] ) {
			$f['folder_id'] = (int) $r['folder_id'];
		}
		if ( null !== $r['status'] ) {
			$f['status'] = MP_Util::pick( $r['status'], array( 'waiting', 'doing', 'done' ), 'doing' );
		}
		foreach ( array( 'start' => 'start_date', 'end' => 'end_date' ) as $in => $col ) {
			if ( null !== $r[ $in ] ) {
				if ( '' !== $r[ $in ] && ! MP_Util::valid_date( $r[ $in ] ) ) {
					return self::err( 'تاریخ پروژه معتبر نیست.' );
				}
				$f[ $col ] = '' === $r[ $in ] ? null : $r[ $in ];
			}
		}
		return $f;
	}

	public static function create_project( WP_REST_Request $r ) {
		global $wpdb;
		$f = self::project_fields( $r, true );
		if ( is_wp_error( $f ) ) {
			return $f;
		}
		$f += array( 'created_by' => self::uid(), 'created_at' => MP_Util::now() );
		if ( empty( $f['start_date'] ) ) {
			$f['start_date'] = MP_Util::today();
		}
		if ( empty( $f['end_date'] ) ) {
			$f['end_date'] = MP_Util::add_days( $f['start_date'], 60 );
		}
		$wpdb->insert( self::t( 'projects' ), $f );
		$pid = (int) $wpdb->insert_id;
		$wpdb->insert( self::t( 'project_members' ), array( 'project_id' => $pid, 'user_id' => self::uid() ) );
		$wpdb->insert(
			self::t( 'channels' ),
			array( 'type' => 'project', 'project_id' => $pid, 'title' => $f['name'], 'created_by' => self::uid(), 'created_at' => MP_Util::now() )
		);
		$ids = is_array( $r['members'] ) ? $r['members'] : array();
		self::insert_members( $pid, $ids, $f['name'] );
		MP_Audit::log( 'create', 'project', $pid, 'پروژه «' . $f['name'] . '»' );
		return self::list_projects();
	}

	public static function update_project( WP_REST_Request $r ) {
		global $wpdb;
		$pid = (int) $r['id'];
		$f   = self::project_fields( $r, false );
		if ( is_wp_error( $f ) ) {
			return $f;
		}
		if ( $f ) {
			$wpdb->update( self::t( 'projects' ), $f, array( 'id' => $pid ) );
			if ( isset( $f['name'] ) ) {
				$wpdb->update( self::t( 'channels' ), array( 'title' => $f['name'] ), array( 'project_id' => $pid, 'type' => 'project' ) );
			}
		}
		return self::list_projects();
	}

	public static function delete_project( WP_REST_Request $r ) {
		global $wpdb;
		$pid = (int) $r['id'];
		foreach ( $wpdb->get_col( $wpdb->prepare( 'SELECT id FROM ' . self::t( 'channels' ) . ' WHERE project_id = %d', $pid ) ) as $cid ) {
			foreach ( $wpdb->get_col( $wpdb->prepare( 'SELECT file_id FROM ' . self::t( 'messages' ) . ' WHERE channel_id = %d AND file_id > 0', $cid ) ) as $fid ) {
				MP_Files::delete( $fid );
			}
			$wpdb->delete( self::t( 'messages' ), array( 'channel_id' => $cid ) );
			$wpdb->delete( self::t( 'reads' ), array( 'channel_id' => $cid ) );
		}
		foreach ( array( 'channels', 'project_members', 'sections', 'milestones', 'notes' ) as $table ) {
			$wpdb->delete( self::t( $table ), array( 'project_id' => $pid ) );
		}
		// Its tasks go too (archived ones included), with their checklists, comments and files.
		// Hours already worked stay in the time log (it keeps the task title) for payroll and reports.
		$tids = array_map( 'intval', $wpdb->get_col( $wpdb->prepare( 'SELECT id FROM ' . self::t( 'tasks' ) . ' WHERE project_id = %d', $pid ) ) );
		foreach ( $tids as $tid ) {
			self::purge_task( $tid );
		}
		// Notifications that would open a task or project that no longer exists.
		$wpdb->query( $wpdb->prepare( 'DELETE FROM ' . self::t( 'notifications' ) . " WHERE target = 'projects' AND ref_id = %d", $pid ) ); // phpcs:ignore
		if ( $tids ) {
			$wpdb->query( 'DELETE FROM ' . self::t( 'notifications' ) . " WHERE target IN ('task','calendar') AND ref_id IN (" . implode( ',', $tids ) . ')' ); // phpcs:ignore -- integers
		}
		MP_Audit::log( 'delete', 'project', $pid, 'پروژه «' . $wpdb->get_var( $wpdb->prepare( 'SELECT name FROM ' . self::t( 'projects' ) . ' WHERE id = %d', $pid ) ) . '»' . ( $tids ? ' با ' . MP_Jalali::digits( count( $tids ) ) . ' تسک' : '' ) );
		$wpdb->delete( self::t( 'projects' ), array( 'id' => $pid ) );
		return self::list_projects();
	}

	/**
	 * POST projects/{id}/shift {days, from?, skip_off?, preview?}
	 * Moves the unfinished part of a project by N days (negative = earlier): its open tasks on everyone's
	 * calendar, unfinished milestones and the project's dates. With «from», only what lies on/after that date.
	 * skip_off: a task that lands on a Friday or a holiday (payroll calendar) goes on to the next working day.
	 * preview returns what would move without changing anything; the last shift can be undone for an hour.
	 */
	public static function shift_project( WP_REST_Request $r ) {
		global $wpdb;
		$pid  = (int) $r['id'];
		$proj = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'projects' ) . ' WHERE id = %d', $pid ) );
		if ( ! $proj ) {
			return self::err( 'پروژه پیدا نشد.', 404 );
		}
		$days = (int) J_latin( (string) $r['days'] );
		if ( ! $days || abs( $days ) > 365 ) {
			return self::err( 'تعداد روز باید بین ۱ تا ۳۶۵ باشد.' );
		}
		$from = (string) $r['from'];
		if ( '' !== $from && ! MP_Util::valid_date( $from ) ) {
			return self::err( 'تاریخ شروع جابه‌جایی معتبر نیست.' );
		}
		$skip = null === $r['skip_off'] || ! empty( $r['skip_off'] );

		$sql   = 'SELECT id, user_id, task_date FROM ' . self::t( 'tasks' ) . " WHERE project_id = %d AND status <> 'done' AND archived_at IS NULL";
		$tasks = '' !== $from
			? $wpdb->get_results( $wpdb->prepare( $sql . ' AND task_date >= %s ORDER BY task_date, id', $pid, $from ) ) // phpcs:ignore
			: $wpdb->get_results( $wpdb->prepare( $sql . ' ORDER BY task_date, id', $pid ) ); // phpcs:ignore
		$off = array();
		if ( $skip ) {
			foreach ( (array) get_option( 'mp_payroll_holidays', array() ) as $month ) {
				$off = array_merge( $off, (array) $month );
			}
			$off = array_flip( $off );
		}
		$moves  = array(); // task id => [old date, new date, user]
		$people = array(); // user => tasks moved
		foreach ( $tasks as $t ) {
			$new = MP_Util::add_days( $t->task_date, $days );
			// Fridays and holidays: on to the next working day in the same direction.
			for ( $i = 0; $skip && $i < 14 && ( 5 === (int) gmdate( 'w', strtotime( $new . ' UTC' ) ) || isset( $off[ $new ] ) ); $i++ ) {
				$new = MP_Util::add_days( $new, $days > 0 ? 1 : -1 );
			}
			$moves[ (int) $t->id ]       = array( $t->task_date, $new, (int) $t->user_id );
			$people[ (int) $t->user_id ] = ( isset( $people[ (int) $t->user_id ] ) ? $people[ (int) $t->user_id ] : 0 ) + 1;
		}
		$miles = array(); // milestone id => [old start, old end, new start, new end]
		$msql  = 'SELECT id, start_date, end_date FROM ' . self::t( 'milestones' ) . " WHERE project_id = %d AND status <> 'done'";
		$mrows = '' !== $from
			? $wpdb->get_results( $wpdb->prepare( $msql . ' AND end_date >= %s', $pid, $from ) ) // phpcs:ignore
			: $wpdb->get_results( $wpdb->prepare( $msql, $pid ) ); // phpcs:ignore
		foreach ( $mrows as $m ) {
			// A stage already under way when «from» falls inside it keeps its start and only ends later.
			$start                 = '' === $from || $m->start_date >= $from ? MP_Util::add_days( $m->start_date, $days ) : $m->start_date;
			$end                   = max( $start, MP_Util::add_days( $m->end_date, $days ) );
			$miles[ (int) $m->id ] = array( $m->start_date, $m->end_date, $start, $end );
		}
		$pstart = $proj->start_date && ( '' === $from || $proj->start_date >= $from ) ? MP_Util::add_days( $proj->start_date, $days ) : $proj->start_date;
		$pend   = $proj->end_date && ( '' === $from || $proj->end_date >= $from ) ? MP_Util::add_days( $proj->end_date, $days ) : $proj->end_date;
		if ( $pstart && $pend && $pend < $pstart ) {
			$pend = $pstart;
		}

		$first   = $moves ? reset( $moves ) : null;
		$last    = $moves ? end( $moves ) : null;
		$summary = array(
			'tasks'      => count( $moves ),
			'people'     => count( $people ),
			'milestones' => count( $miles ),
			'first'      => $first ? array( $first[0], $first[1] ) : null,
			'last'       => $last ? array( $last[0], $last[1] ) : null,
			'start'      => array( $proj->start_date, $pstart ),
			'end'        => array( $proj->end_date, $pend ),
			'skipped'    => count(
				array_filter(
					$moves,
					function ( $m ) use ( $days ) {
						return MP_Util::add_days( $m[0], $days ) !== $m[1];
					}
				)
			),
		);
		if ( ! empty( $r['preview'] ) ) {
			return $summary;
		}
		if ( ! $moves && ! $miles && $pstart === $proj->start_date && $pend === $proj->end_date ) {
			return self::err( 'چیزی برای جابه‌جایی نیست: تسک انجام‌نشده یا مرحله‌ای در این بازه وجود ندارد.' );
		}

		$now = MP_Util::now();
		foreach ( $moves as $id => $m ) {
			$wpdb->update( self::t( 'tasks' ), array( 'task_date' => $m[1], 'updated_at' => $now ), array( 'id' => $id ) );
		}
		foreach ( $miles as $id => $m ) {
			$wpdb->update( self::t( 'milestones' ), array( 'start_date' => $m[2], 'end_date' => $m[3] ), array( 'id' => $id ) );
		}
		$wpdb->update( self::t( 'projects' ), array( 'start_date' => $pstart, 'end_date' => $pend ), array( 'id' => $pid ) );
		set_transient( 'mp_shift_' . self::uid() . '_' . $pid, array( 'tasks' => $moves, 'miles' => $miles, 'project' => array( $proj->start_date, $proj->end_date ) ), HOUR_IN_SECONDS );

		$dir = $days > 0 ? 'عقب انداخت' : 'جلو انداخت';
		foreach ( $people as $uid => $n ) {
			if ( $uid !== self::uid() ) {
				MP_Notify::event( 'project_shifted', $uid, array( 'ACTOR' => wp_get_current_user()->display_name, 'PROJECT' => $proj->name, 'DAYS' => MP_Jalali::digits( abs( $days ) ), 'DIRECTION' => $dir, 'COUNT' => MP_Jalali::digits( $n ) ), 'calendar', 0, self::wants_email( $uid ) );
			}
		}
		MP_Audit::log( 'update', 'project', $pid, 'زمان‌بندی «' . $proj->name . '» ' . MP_Jalali::digits( abs( $days ) ) . ' روز ' . ( $days > 0 ? 'عقب' : 'جلو' ) . ' رفت: ' . MP_Jalali::digits( count( $moves ) ) . ' تسک، ' . MP_Jalali::digits( count( $miles ) ) . ' مرحله' . ( '' !== $from ? ' (از ' . MP_Jalali::format( $from ) . ')' : '' ) );
		return array( 'summary' => $summary, 'list' => self::list_projects() );
	}

	/** POST projects/{id}/shift/undo — puts back the last shift (within an hour); items edited since then stay as they are. */
	public static function undo_shift( WP_REST_Request $r ) {
		global $wpdb;
		$pid  = (int) $r['id'];
		$key  = 'mp_shift_' . self::uid() . '_' . $pid;
		$snap = get_transient( $key );
		if ( ! $snap ) {
			return self::err( 'جابه‌جایی قابل بازگردانی پیدا نشد (فقط تا یک ساعت بعد ممکن است).', 404 );
		}
		delete_transient( $key );
		$back = 0;
		foreach ( $snap['tasks'] as $id => $m ) {
			$back += (int) $wpdb->update( self::t( 'tasks' ), array( 'task_date' => $m[0], 'updated_at' => MP_Util::now() ), array( 'id' => (int) $id, 'task_date' => $m[1] ) );
		}
		foreach ( $snap['miles'] as $id => $m ) {
			$wpdb->update( self::t( 'milestones' ), array( 'start_date' => $m[0], 'end_date' => $m[1] ), array( 'id' => (int) $id, 'start_date' => $m[2], 'end_date' => $m[3] ) );
		}
		$wpdb->update( self::t( 'projects' ), array( 'start_date' => $snap['project'][0], 'end_date' => $snap['project'][1] ), array( 'id' => $pid ) );
		MP_Audit::log( 'update', 'project', $pid, 'بازگردانی جابه‌جایی زمان‌بندی: ' . MP_Jalali::digits( $back ) . ' تسک' );
		return array( 'restored' => $back, 'list' => self::list_projects() );
	}

	private static function insert_members( $pid, array $ids, $name ) {
		global $wpdb;
		$existing = MP_Util::project_members( $pid );
		foreach ( array_unique( array_map( 'intval', $ids ) ) as $uid ) {
			if ( ! MP_Util::is_panel_user( $uid ) || in_array( $uid, $existing, true ) ) {
				continue;
			}
			$wpdb->insert( self::t( 'project_members' ), array( 'project_id' => $pid, 'user_id' => $uid ) );
			MP_Audit::log( 'add', 'member', $pid, get_userdata( $uid )->display_name . ' به پروژه «' . $name . '»' );
			if ( $uid !== self::uid() ) {
				MP_Notify::event( 'project_added', $uid, array( 'PROJECT' => $name ), 'projects', $pid );
			}
		}
	}

	public static function add_members( WP_REST_Request $r ) {
		global $wpdb;
		$pid  = (int) $r['id'];
		$name = $wpdb->get_var( $wpdb->prepare( 'SELECT name FROM ' . self::t( 'projects' ) . ' WHERE id = %d', $pid ) );
		if ( ! $name ) {
			return self::err( 'پروژه پیدا نشد.', 404 );
		}
		self::insert_members( $pid, is_array( $r['user_ids'] ) ? $r['user_ids'] : array(), $name );
		return self::list_projects();
	}

	public static function remove_member( WP_REST_Request $r ) {
		global $wpdb;
		$wpdb->delete( self::t( 'project_members' ), array( 'project_id' => (int) $r['id'], 'user_id' => (int) $r['user'] ) );
		$gone = get_userdata( (int) $r['user'] );
		MP_Audit::log( 'remove', 'member', (int) $r['id'], ( $gone ? $gone->display_name : '' ) . ' از پروژه حذف شد' );
		return self::list_projects();
	}

	public static function create_section( WP_REST_Request $r ) {
		global $wpdb;
		$pid   = (int) $r['id'];
		$title = MP_Util::text( $r['title'], 160 );
		if ( '' === $title ) {
			return self::err( 'عنوان بخش را وارد کنید.' );
		}
		$dup = $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM ' . self::t( 'sections' ) . ' WHERE project_id = %d AND title = %s', $pid, $title ) );
		if ( $dup ) {
			return self::err( 'این بخش در پروژه وجود دارد.' );
		}
		$wpdb->insert(
			self::t( 'sections' ),
			array(
				'project_id' => $pid,
				'title'      => $title,
				'priority'   => MP_Util::pick( $r['priority'], array( 'low', 'medium', 'high' ), 'medium' ),
				'status'     => MP_Util::pick( $r['status'], array( 'waiting', 'doing', 'done' ), 'doing' ),
				'sort'       => (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM ' . self::t( 'sections' ) . ' WHERE project_id = %d', $pid ) ),
			)
		);
		return self::list_projects();
	}

	public static function update_section( WP_REST_Request $r ) {
		global $wpdb;
		$f = array();
		if ( null !== $r['title'] ) {
			$f['title'] = MP_Util::text( $r['title'], 160 );
		}
		if ( null !== $r['priority'] ) {
			$f['priority'] = MP_Util::pick( $r['priority'], array( 'low', 'medium', 'high' ), 'medium' );
		}
		if ( null !== $r['status'] ) {
			$f['status'] = MP_Util::pick( $r['status'], array( 'waiting', 'doing', 'done' ), 'doing' );
		}
		if ( $f ) {
			$wpdb->update( self::t( 'sections' ), $f, array( 'id' => (int) $r['id'] ) );
		}
		return self::list_projects();
	}

	public static function delete_section( WP_REST_Request $r ) {
		global $wpdb;
		$wpdb->update( self::t( 'tasks' ), array( 'section_id' => 0 ), array( 'section_id' => (int) $r['id'] ) );
		$wpdb->delete( self::t( 'sections' ), array( 'id' => (int) $r['id'] ) );
		return self::list_projects();
	}

	private static function milestone_fields( WP_REST_Request $r, $creating ) {
		$f = array();
		if ( $creating || null !== $r['title'] ) {
			$f['title'] = MP_Util::text( $r['title'], 160 );
			if ( '' === $f['title'] ) {
				return self::err( 'عنوان را وارد کنید.' );
			}
		}
		if ( $creating || null !== $r['start'] || null !== $r['end'] ) {
			if ( ! MP_Util::valid_date( $r['start'] ) || ! MP_Util::valid_date( $r['end'] ) || $r['end'] < $r['start'] ) {
				return self::err( 'پایان باید بعد از شروع باشد.' );
			}
			$f['start_date'] = $r['start'];
			$f['end_date']   = $r['end'];
		}
		if ( null !== $r['status'] ) {
			$f['status'] = MP_Util::pick( $r['status'], array( 'waiting', 'doing', 'done' ), 'waiting' );
		}
		return $f;
	}

	public static function create_milestone( WP_REST_Request $r ) {
		global $wpdb;
		$f = self::milestone_fields( $r, true );
		if ( is_wp_error( $f ) ) {
			return $f;
		}
		$f['project_id'] = (int) $r['id'];
		$wpdb->insert( self::t( 'milestones' ), $f );
		return self::list_projects();
	}

	public static function update_milestone( WP_REST_Request $r ) {
		global $wpdb;
		$f = self::milestone_fields( $r, false );
		if ( is_wp_error( $f ) ) {
			return $f;
		}
		if ( $f ) {
			$wpdb->update( self::t( 'milestones' ), $f, array( 'id' => (int) $r['id'] ) );
			if ( isset( $f['status'] ) && 'done' === $f['status'] ) {
				MP_Contracts::milestone_done( (int) $r['id'] ); // a contract's payment stage may wait on it
			}
		}
		return self::list_projects();
	}

	public static function delete_milestone( WP_REST_Request $r ) {
		global $wpdb;
		$wpdb->delete( self::t( 'milestones' ), array( 'id' => (int) $r['id'] ) );
		return self::list_projects();
	}

	public static function list_notes( WP_REST_Request $r ) {
		global $wpdb;
		$pid = (int) $r['id'];
		if ( ! MP_Util::can_see_project( $pid ) ) {
			return self::err( 'به این پروژه دسترسی ندارید.', 403 );
		}
		$rows = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'notes' ) . ' WHERE project_id = %d ORDER BY id DESC', $pid ) );
		$out  = array();
		foreach ( $rows as $n ) {
			$u     = get_userdata( $n->user_id );
			$out[] = array(
				'id'         => (int) $n->id,
				'title'      => $n->title,
				'body'       => $n->body,
				'author'     => $u ? $u->display_name : '',
				'created_at' => $n->created_at,
				'can_delete' => (int) $n->user_id === self::uid() || MP_Util::is_manager(),
			);
		}
		return $out;
	}

	public static function create_note( WP_REST_Request $r ) {
		global $wpdb;
		$pid = (int) $r['id'];
		if ( ! MP_Util::can_see_project( $pid ) ) {
			return self::err( 'به این پروژه دسترسی ندارید.', 403 );
		}
		$title = MP_Util::text( $r['title'], 160 );
		$body  = MP_Util::long_text( $r['body'], 5000 );
		if ( '' === $title || '' === $body ) {
			return self::err( 'عنوان و متن یادداشت را وارد کنید.' );
		}
		$wpdb->insert( self::t( 'notes' ), array( 'project_id' => $pid, 'user_id' => self::uid(), 'title' => $title, 'body' => $body, 'created_at' => MP_Util::now() ) );
		return self::list_notes( $r );
	}

	public static function delete_note( WP_REST_Request $r ) {
		global $wpdb;
		$note = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'notes' ) . ' WHERE id = %d', (int) $r['id'] ) );
		if ( ! $note || ! MP_Util::can_see_project( $note->project_id ) ) {
			return self::err( 'یادداشت پیدا نشد.', 404 );
		}
		if ( (int) $note->user_id !== self::uid() && ! MP_Util::is_manager() ) {
			return self::err( 'فقط نویسنده یا ناظر می‌تواند یادداشت را حذف کند.', 403 );
		}
		$wpdb->delete( self::t( 'notes' ), array( 'id' => $note->id ) );
		return array( 'deleted' => true );
	}

	public static function create_folder( WP_REST_Request $r ) {
		global $wpdb;
		$name = MP_Util::text( $r['name'], 120 );
		if ( '' === $name ) {
			return self::err( 'نام فولدر را وارد کنید.' );
		}
		if ( $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM ' . self::t( 'folders' ) . ' WHERE name = %s', $name ) ) ) {
			return self::err( 'این فولدر قبلاً ساخته شده است.' );
		}
		$wpdb->insert( self::t( 'folders' ), array( 'name' => $name, 'created_by' => self::uid() ) );
		return self::list_projects();
	}

	public static function delete_folder( WP_REST_Request $r ) {
		global $wpdb;
		$wpdb->update( self::t( 'projects' ), array( 'folder_id' => 0 ), array( 'folder_id' => (int) $r['id'] ) );
		$wpdb->delete( self::t( 'folders' ), array( 'id' => (int) $r['id'] ) );
		return self::list_projects();
	}

	/* ------------------------------------------------------------------ Messages */

	/** Channels the user can read: project channels of their projects, their direct chats, and client groups of their projects. */
	public static function channels_for( $uid ) {
		global $wpdb;
		$projects = MP_Util::project_ids_for( $uid );
		$in       = $projects ? implode( ',', array_map( 'intval', $projects ) ) : '0';
		return $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM ' . self::t( 'channels' ) . " WHERE (type IN ('project','client') AND project_id IN ($in))
				OR (type = 'client' AND project_id = 0 AND created_by = %d)
				OR (type = 'direct' AND (user_a = %d OR user_b = %d))
				OR (type = 'saved' AND user_a = %d)
				OR (type IN ('group','client') AND id IN (SELECT channel_id FROM " . self::t( 'channel_members' ) . ' WHERE user_id = %d)) ORDER BY id',
				$uid,
				$uid,
				$uid,
				$uid,
				$uid
			)
		);
	}

	public static function channel_for( $id, $uid ) {
		foreach ( self::channels_for( $uid ) as $ch ) {
			if ( (int) $ch->id === (int) $id ) {
				return $ch;
			}
		}
		return null;
	}

	public static function can_read_channel( $id ) {
		return (bool) self::channel_for( (int) $id, self::uid() );
	}

	public static function channel_members( $ch ) {
		if ( 'saved' === $ch->type ) {
			return array( (int) $ch->user_a );
		}
		if ( 'direct' === $ch->type ) {
			return array( (int) $ch->user_a, (int) $ch->user_b );
		}
		if ( 'group' === $ch->type ) {
			global $wpdb;
			return array_map( 'intval', $wpdb->get_col( $wpdb->prepare( 'SELECT user_id FROM ' . self::t( 'channel_members' ) . ' WHERE channel_id = %d', $ch->id ) ) );
		}
		// Client groups: the project's members (or the maker) plus colleagues added to the group.
		$base = $ch->project_id ? MP_Util::project_members( $ch->project_id ) : array( (int) $ch->created_by );
		return 'client' === $ch->type ? array_values( array_unique( array_merge( $base, MP_Client::extra_staff( $ch->id ) ) ) ) : $base;
	}

	public static function unread( $channel_id, $uid ) {
		global $wpdb;
		$last = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT last_id FROM ' . self::t( 'reads' ) . ' WHERE channel_id = %d AND user_id = %d', $channel_id, $uid ) );
		return (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM ' . self::t( 'messages' ) . ' WHERE channel_id = %d AND id > %d AND user_id <> %d AND deleted_at IS NULL', $channel_id, $last, $uid ) );
	}

	public static function channel_payload( $ch, $uid ) {
		global $wpdb;
		$title = $ch->title;
		$other = 0;
		if ( 'direct' === $ch->type ) {
			$other = (int) $ch->user_a === $uid ? (int) $ch->user_b : (int) $ch->user_a;
			$u     = get_userdata( $other );
			$title = $u ? $u->display_name : 'گفت‌وگو';
		} elseif ( 'saved' === $ch->type ) {
			$title = 'پیام‌های ذخیره‌شده';
		}
		$last    = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'messages' ) . ' WHERE channel_id = %d ORDER BY id DESC LIMIT 1', $ch->id ) );
		$reads   = self::channel_reads( $ch->id );
		$members = self::channel_members( $ch );
		return array(
			'id'          => (int) $ch->id,
			'type'        => $ch->type,
			'title'       => $title,
			'project_id'  => (int) $ch->project_id,
			'client_name' => $ch->client_name,
			'client_id'   => (int) $ch->client_id,
			'token'       => 'client' === $ch->type ? $ch->token : '',
			'other'       => $other,
			// Online now / last seen, from the panel's heartbeat (unix time).
			'last_seen'   => $other ? (int) get_user_meta( $other, 'mp_last_seen', true ) : 0,
			'unread'      => 'saved' === $ch->type ? 0 : self::unread( $ch->id, $uid ),
			'read_id'     => isset( $reads[ $uid ] ) ? $reads[ $uid ] : 0,
			'members'     => count( $members ),
			'member_ids'  => $members,
			'muted'       => MP_Chat::muted( $ch->id, $uid ),
			'last'        => $last ? self::message_payload( $last, $uid, $reads ) : null,
			'can_delete'  => in_array( $ch->type, array( 'client', 'group' ), true ) && ( (int) $ch->created_by === $uid || MP_Util::is_manager() ),
			'can_manage'  => 'group' === $ch->type && ( (int) $ch->created_by === $uid || MP_Util::is_manager() ),
			'archived'    => ! empty( $ch->archived_at ),
			'logo'        => MP_Client::logo_url( $ch ),
			'can_logo'    => ! in_array( $ch->type, array( 'direct', 'saved' ), true ) && ( MP_Util::is_manager() || (int) $ch->created_by === $uid ),
			// «all» = a manager pinned it for everyone; «me» = pinned in my own list only.
			'pinned'      => ! empty( $ch->pinned_at ) ? 'all' : ( in_array( (int) $ch->id, self::my_pins( $uid ), true ) ? 'me' : '' ),
			'pinned_at'   => ! empty( $ch->pinned_at ) ? $ch->pinned_at : '',
		) + MP_Chat::channel_extra( $ch, $uid );
	}

	/** Conversations a person pinned for themselves (newest pin last). */
	private static function my_pins( $uid ) {
		$p = get_user_meta( $uid, 'mp_pins', true );
		return is_array( $p ) ? array_values( array_map( 'intval', $p ) ) : array();
	}

	/**
	 * POST channels/{id}/pin {scope: me|all, on: bool}
	 * Anyone can pin a conversation at the top of their own list; managers can also pin a group for everyone.
	 */
	public static function pin_channel( WP_REST_Request $r ) {
		global $wpdb;
		$uid = self::uid();
		$ch  = self::channel_for( (int) $r['id'], $uid );
		if ( ! $ch ) {
			return self::err( 'گفت‌وگو پیدا نشد.', 404 );
		}
		$on = ! empty( $r['on'] ) && 'false' !== $r['on'];
		if ( 'all' === $r['scope'] ) {
			if ( ! MP_Util::is_manager() ) {
				return self::err( 'فقط ناظر می‌تواند برای همه سنجاق کند.', 403 );
			}
			if ( 'direct' === $ch->type ) {
				return self::err( 'گفت‌وگوی خصوصی را فقط برای خودتان می‌توانید سنجاق کنید.' );
			}
			$wpdb->update( self::t( 'channels' ), array( 'pinned_at' => $on ? MP_Util::now() : null ), array( 'id' => $ch->id ) );
			MP_Audit::log( 'update', 'channel', $ch->id, '«' . $ch->title . '» ' . ( $on ? 'برای همه سنجاق شد' : 'از سنجاق همه برداشته شد' ) );
		} else {
			$pins = array_values( array_diff( self::my_pins( $uid ), array( (int) $ch->id ) ) );
			if ( $on ) {
				$pins[] = (int) $ch->id;
			}
			update_user_meta( $uid, 'mp_pins', array_slice( $pins, -30 ) );
		}
		return self::channel_payload( self::channel_for( $ch->id, $uid ), $uid );
	}

	public static function message_payload( $m, $uid, $reads = array() ) {
		$u    = $m->user_id ? get_userdata( $m->user_id ) : null;
		$seen = 0;
		foreach ( $reads as $reader => $last ) {
			if ( (int) $reader !== (int) $m->user_id && $last >= (int) $m->id ) {
				++$seen;
			}
		}
		if ( ! $reads && (int) $m->user_id === (int) $uid ) {
			$seen = MP_Chat::seen_count( $m );
		}
		if ( ! empty( $m->deleted_at ) && MP_Util::is_manager( $uid ) && ( $m->body || $m->file_id ) ) {
			// Messages are archived, never erased: supervisors still see what was archived.
			$u = $m->user_id ? get_userdata( $m->user_id ) : null;
			return array(
				'id'         => (int) $m->id,
				'user_id'    => (int) $m->user_id,
				'deleted'    => false,
				'archived'   => true,
				'author'     => $u ? $u->display_name : ( ! empty( $m->kind ) ? 'مربع استودیو' : ( $m->guest_name ? $m->guest_name . ' (مشتری)' : 'مشتری' ) ),
				'avatar'     => $u ? MP_Util::avatar_url( $u->ID ) : '',
				'body'       => $m->body,
				'file'       => $m->file_id ? MP_Files::payload( MP_Files::get( $m->file_id ) ) : null,
				'transcript' => isset( $m->transcript ) ? (string) $m->transcript : '',
				'mine'       => (int) $m->user_id === $uid,
				'seen_by'    => $seen,
				'created_at' => $m->created_at,
			) + MP_Chat::extra( $m, $uid );
		}
		if ( ! empty( $m->deleted_at ) ) {
			// Everyone sees that something was removed, nobody sees what (the site admin can, in the dashboard).
			return array(
				'id'         => (int) $m->id,
				'user_id'    => (int) $m->user_id,
				'author'     => $u ? $u->display_name : 'مشتری',
				'avatar'     => $u ? MP_Util::avatar_url( $u->ID ) : '',
				'body'       => '',
				'file'       => null,
				'transcript' => '',
				'deleted'    => true,
				'mine'       => (int) $m->user_id === $uid,
				'seen_by'    => 0,
				'created_at' => $m->created_at,
			);
		}
		return array(
			'id'         => (int) $m->id,
			'user_id'    => (int) $m->user_id,
			'deleted'    => false,
			'author'     => $u ? $u->display_name : ( ! empty( $m->kind ) ? 'مربع استودیو' : ( $m->guest_name ? $m->guest_name . ' (مشتری)' : 'مشتری' ) ),
			'avatar'     => $u ? MP_Util::avatar_url( $u->ID ) : '',
			'body'       => $m->body,
			'file'       => $m->file_id ? MP_Files::payload( MP_Files::get( $m->file_id ) ) : null,
			'transcript' => isset( $m->transcript ) ? (string) $m->transcript : '',
			'mine'       => (int) $m->user_id === $uid,
			'seen_by'    => $seen,
			'created_at' => $m->created_at,
		) + MP_Chat::extra( $m, $uid ) + MP_Client::msg_extra( $m );
	}

	/** user_id => last read message id, for every reader of the channel. */
	public static function channel_reads( $channel_id ) {
		global $wpdb;
		$out = array();
		foreach ( $wpdb->get_results( $wpdb->prepare( 'SELECT user_id, last_id FROM ' . self::t( 'reads' ) . ' WHERE channel_id = %d', $channel_id ) ) as $r ) {
			$out[ (int) $r->user_id ] = (int) $r->last_id;
		}
		return $out;
	}

	public static function list_channels( $r = null ) {
		$uid  = self::uid();
		$out  = array();
		$arch = $r instanceof WP_REST_Request && $r['archived'];
		foreach ( self::channels_for( $uid ) as $ch ) {
			if ( $arch !== ! empty( $ch->archived_at ) ) {
				continue;
			}
			$out[] = self::channel_payload( $ch, $uid );
		}
		return $out;
	}

	public static function create_channel( WP_REST_Request $r ) {
		global $wpdb;
		$uid = self::uid();
		if ( 'direct' === $r['type'] ) {
			$other = (int) $r['user_id'];
			if ( $other === $uid || ! MP_Util::is_panel_user( $other ) ) {
				return self::err( 'همکار انتخاب‌شده پیدا نشد.', 404 );
			}
			$a  = min( $uid, $other );
			$b  = max( $uid, $other );
			$id = $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM ' . self::t( 'channels' ) . " WHERE type = 'direct' AND user_a = %d AND user_b = %d", $a, $b ) );
			if ( ! $id ) {
				$wpdb->insert( self::t( 'channels' ), array( 'type' => 'direct', 'user_a' => $a, 'user_b' => $b, 'created_by' => $uid, 'created_at' => MP_Util::now() ) );
				$id = $wpdb->insert_id;
			}
			return self::channel_payload( self::channel_for( $id, $uid ), $uid );
		}
		if ( 'client' === $r['type'] ) {
			$title  = MP_Util::text( $r['title'], 160 );
			$cust   = (int) $r['client_id'] ? MP_Client::customer( (int) $r['client_id'] ) : null;
			$client = $cust ? $cust->name : MP_Util::text( $r['client_name'], 120 );
			$pid    = (int) $r['project_id'];
			if ( '' === $title && '' !== $client ) {
				$title = $client;
			}
			if ( '' === $title || '' === $client ) {
				return self::err( 'نام گروه و نام مشتری را وارد کنید.' );
			}
			if ( $pid && ! MP_Util::can_see_project( $pid ) ) {
				return self::err( 'به این پروژه دسترسی ندارید.', 403 );
			}
			$wpdb->insert(
				self::t( 'channels' ),
				array(
					'type'        => 'client',
					'project_id'  => $pid,
					'title'       => $title,
					'client_name' => $client,
					'client_id'   => MP_Client::customer_id( $client, $cust ? $cust->id : 0, $pid ),
					'token'       => wp_generate_password( 32, false, false ),
					'created_by'  => $uid,
					'created_at'  => MP_Util::now(),
				)
			);
			$new = (int) $wpdb->insert_id;
			// The customer's mobile: their portal login, and the group's link goes to it right away.
			$sms    = null;
			$error  = '';
			$mobile = MP_Auth::normalize( $r['mobile'] );
			if ( $mobile ) {
				$row   = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'channels' ) . ' WHERE id = %d', $new ) );
				$res   = MP_Client::add_person( $row, $client, $mobile );
				$sms   = $res['sms'];
				$error = $res['error'];
				if ( $cust && '' === trim( (string) $cust->phone ) ) {
					$wpdb->update( self::t( 'clients' ), array( 'phone' => $mobile ), array( 'id' => $cust->id ) );
				}
			}
			return self::channel_payload( self::channel_for( $new, $uid ), $uid ) + array( 'sms_sent' => $sms, 'sms_error' => $error );
		}
		if ( 'group' === $r['type'] ) {
			if ( ! MP_Util::is_manager() ) {
				return self::err( 'فقط ناظر می‌تواند گروه بسازد.', 403 );
			}
			$title = MP_Util::text( $r['title'], 160 );
			if ( '' === $title ) {
				return self::err( 'نام گروه را وارد کنید.' );
			}
			$wpdb->insert( self::t( 'channels' ), array( 'type' => 'group', 'title' => $title, 'created_by' => $uid, 'created_at' => MP_Util::now() ) );
			$id = (int) $wpdb->insert_id;
			self::write_members( $id, is_array( $r['members'] ) ? $r['members'] : array(), $title );
			MP_Audit::log( 'create', 'channel', $id, 'گروه «' . $title . '»' );
			return self::channel_payload( self::channel_for( $id, $uid ), $uid );
		}
		return self::err( 'نوع گفت‌وگو معتبر نیست.' );
	}

	/** Replaces a group's members (its creator always stays in); new members get a notification. */
	private static function write_members( $id, array $ids, $title ) {
		global $wpdb;
		$ch   = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'channels' ) . ' WHERE id = %d', $id ) );
		$old  = array_map( 'intval', $wpdb->get_col( $wpdb->prepare( 'SELECT user_id FROM ' . self::t( 'channel_members' ) . ' WHERE channel_id = %d', $id ) ) );
		$want = array( (int) $ch->created_by, self::uid() );
		foreach ( $ids as $u ) {
			if ( MP_Util::is_panel_user( (int) $u ) ) {
				$want[] = (int) $u;
			}
		}
		$want = array_values( array_unique( $want ) );
		foreach ( array_diff( $old, $want ) as $u ) {
			$wpdb->delete( self::t( 'channel_members' ), array( 'channel_id' => $id, 'user_id' => $u ) );
		}
		foreach ( array_diff( $want, $old ) as $u ) {
			$wpdb->insert( self::t( 'channel_members' ), array( 'channel_id' => $id, 'user_id' => $u ) );
			if ( $u !== self::uid() ) {
				MP_Notify::event( 'group_added', $u, array( 'GROUP' => $title ), 'messages', $id );
			}
		}
	}

	/** POST channels/{id}/members {members: [ids], title?} — managers edit a team group. */
	public static function set_channel_members( WP_REST_Request $r ) {
		global $wpdb;
		$ch = self::channel_for( (int) $r['id'], self::uid() );
		if ( ! $ch || 'group' !== $ch->type || ( (int) $ch->created_by !== self::uid() && ! MP_Util::is_manager() ) ) {
			return self::err( 'اجازه ویرایش این گروه را ندارید.', 403 );
		}
		$title = null !== $r['title'] ? MP_Util::text( $r['title'], 160 ) : $ch->title;
		if ( '' !== $title && $title !== $ch->title ) {
			$wpdb->update( self::t( 'channels' ), array( 'title' => $title ), array( 'id' => $ch->id ) );
		}
		self::write_members( (int) $ch->id, is_array( $r['members'] ) ? $r['members'] : array(), $title );
		return self::channel_payload( self::channel_for( $ch->id, self::uid() ), self::uid() );
	}

	/** POST channels/{id}/logo {logo_file_id} — a logo for a project, team or client group (0 removes it). */
	public static function set_channel_logo( WP_REST_Request $r ) {
		global $wpdb;
		$ch = self::channel_for( (int) $r['id'], self::uid() );
		if ( ! $ch || 'direct' === $ch->type || ( (int) $ch->created_by !== self::uid() && ! MP_Util::is_manager() ) ) {
			return self::err( 'اجازه تغییر لوگوی این گروه را ندارید.', 403 );
		}
		$fid = (int) $r['logo_file_id'];
		if ( $fid ) {
			$file = MP_Files::get( $fid );
			if ( ! $file || 'client_logo' !== $file->context || 0 !== strpos( $file->mime, 'image/' ) ) {
				return self::err( 'فقط تصویر مجاز است.' );
			}
		}
		$wpdb->update( self::t( 'channels' ), array( 'logo_file_id' => $fid ), array( 'id' => $ch->id ) );
		return self::channel_payload( self::channel_for( $ch->id, self::uid() ), self::uid() );
	}

	public static function delete_channel( WP_REST_Request $r ) {
		global $wpdb;
		$ch = self::channel_for( (int) $r['id'], self::uid() );
		if ( ! $ch || ! in_array( $ch->type, array( 'client', 'group' ), true ) || ( (int) $ch->created_by !== self::uid() && ! MP_Util::is_manager() ) ) {
			return self::err( 'اجازه آرشیو این گروه را ندارید.', 403 );
		}
		// Archived, not deleted: messages stay and the group can be restored.
		$wpdb->update( self::t( 'channels' ), array( 'archived_at' => MP_Util::now() ), array( 'id' => $ch->id ) );
		MP_Audit::log( 'archive', 'channel', $ch->id, 'گروه «' . $ch->title . '»' );
		return array( 'deleted' => true, 'archived' => true );
	}

	public static function restore_channel( WP_REST_Request $r ) {
		global $wpdb;
		$ch = self::channel_for( (int) $r['id'], self::uid() );
		if ( ! $ch || ( (int) $ch->created_by !== self::uid() && ! MP_Util::is_manager() ) ) {
			return self::err( 'اجازه بازگرداندن این گروه را ندارید.', 403 );
		}
		$wpdb->update( self::t( 'channels' ), array( 'archived_at' => null ), array( 'id' => $ch->id ) );
		MP_Audit::log( 'restore', 'channel', $ch->id, 'گروه «' . $ch->title . '»' );
		return self::channel_payload( self::channel_for( $ch->id, self::uid() ), self::uid() );
	}

	/**
	 * Messages after ?after, plus how many members have seen each of my recent messages
	 * (so read receipts update on messages already on screen).
	 */
	public static function list_messages( WP_REST_Request $r ) {
		global $wpdb;
		$uid = self::uid();
		$ch  = self::channel_for( (int) $r['id'], $uid );
		if ( ! $ch ) {
			return self::err( 'گفت‌وگو پیدا نشد.', 404 );
		}
		// Older history (scrolling up): a page before ?before, nothing else.
		$where = MP_Chat::list_where( $ch, $uid, $r );
		if ( (int) $r['before'] ) {
			$rows = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM (SELECT * FROM ' . self::t( 'messages' ) . ' WHERE channel_id = %d AND id < %d' . $where . ' ORDER BY id DESC LIMIT 60) x ORDER BY id', $ch->id, (int) $r['before'] ) ); // phpcs:ignore
			MP_Chat::preload( $rows );
			$reads = MP_Chat::reads_for( $ch, $r );
			$out   = array();
			foreach ( $rows as $m ) {
				$out[] = self::message_payload( $m, $uid, $reads );
			}
			return array( 'messages' => $out, 'has_more' => count( $rows ) >= 60 );
		}
		$after = (int) $r['after'];
		// ?wait=1: hold the request (up to ~6 s) until something in this chat changes, so news arrives at once.
		if ( $after && $r['wait'] && '' !== (string) $r['sig'] ) {
			MP_Chat::wait( $ch, (string) $r['sig'] );
		}
		MP_Chat::flush_scheduled();
		// ?around=ID (a message link, a date jump): the page that holds it, not the newest one.
		$around = (int) $r['around'];
		if ( $around && ! $after ) {
			$rows = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM (SELECT * FROM ' . self::t( 'messages' ) . ' WHERE channel_id = %d AND id >= %d' . $where . ' ORDER BY id LIMIT 40) x UNION SELECT * FROM (SELECT * FROM ' . self::t( 'messages' ) . ' WHERE channel_id = %d AND id < %d' . $where . ' ORDER BY id DESC LIMIT 40) y ORDER BY id', $ch->id, $around, $ch->id, $around ) ); // phpcs:ignore
		} else {
			$rows = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM (SELECT * FROM ' . self::t( 'messages' ) . ' WHERE channel_id = %d AND id > %d' . $where . ' ORDER BY id DESC LIMIT ' . ( $after ? 200 : 80 ) . ') x ORDER BY id', $ch->id, $after ) ); // phpcs:ignore
		}
		// ?peek=1 (holding a chat in the list): look without marking anything read.
		if ( $rows && ! $r['peek'] ) {
			MP_Chat::mark_read( $ch, $uid, (int) end( $rows )->id, $r );
		}
		MP_Chat::preload( $rows );
		$reads = MP_Chat::reads_for( $ch, $r );
		$out   = array();
		foreach ( $rows as $m ) {
			$out[] = self::message_payload( $m, $uid, $reads );
		}
		$seen = array();
		$got  = array();
		$gmap = MP_Chat::got_map( $ch->id );
		$mine = $wpdb->get_col( $wpdb->prepare( 'SELECT id FROM ' . self::t( 'messages' ) . ' WHERE channel_id = %d AND user_id = %d ORDER BY id DESC LIMIT 50', $ch->id, $uid ) );
		foreach ( $mine as $mid ) {
			$n = 0;
			foreach ( $reads as $reader => $last_id ) {
				if ( (int) $reader !== $uid && $last_id >= (int) $mid ) {
					++$n;
				}
			}
			$seen[ (int) $mid ] = $n;
			foreach ( $gmap as $reader => $g ) {
				if ( (int) $reader !== $uid && $g >= (int) $mid ) {
					$got[ (int) $mid ] = 1;
					break;
				}
			}
		}
		// Edited / reacted / pinned messages already on screen (?since = the server time of the previous answer).
		$changed = array();
		if ( $after && MP_Util::valid_datetime( (string) $r['since'] ) ) {
			$crow = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'messages' ) . ' WHERE channel_id = %d AND id <= %d AND updated_at >= %s' . $where . ' ORDER BY id LIMIT 100', $ch->id, $after, $r['since'] ) ); // phpcs:ignore
			MP_Chat::preload( $crow );
			foreach ( $crow as $m ) {
				$changed[] = self::message_payload( $m, $uid, $reads );
			}
		}
		// Deletions of already-loaded messages, and who is typing / recording right now.
		$deleted = array_map( 'intval', $wpdb->get_col( $wpdb->prepare( 'SELECT id FROM ' . self::t( 'messages' ) . ' WHERE channel_id = %d AND deleted_at IS NOT NULL AND deleted_at >= %s', $ch->id, gmdate( 'Y-m-d H:i:s', current_time( 'timestamp' ) - 20 * MINUTE_IN_SECONDS ) ) ) ); // phpcs:ignore WordPress.DateTime.CurrentTimeTimestamp
		$purged  = get_transient( 'mp_purged_' . $ch->id );
		return array(
			'messages' => $out,
			'has_more' => ! $after && count( $rows ) >= 80,
			'seen'     => (object) $seen,
			'got'      => (object) $got,
			'hidden'   => MP_Chat::hidden_since( $uid, $ch->id, (string) $r['since'] ),
			'changed'  => $changed,
			'pinned'   => MP_Chat::pinned( $ch, $uid ),
			'members'  => count( self::channel_members( $ch ) ),
			'deleted'  => $deleted,
			'removed'  => is_array( $purged ) ? array_map( 'intval', array_keys( $purged ) ) : array(),
			'activity' => self::activity_of( $ch->id, $uid ),
			'now'      => MP_Util::now(),
			'sig'      => MP_Chat::sig( $ch ),
			'has_newer'=> $around && ! $after && $rows && (int) end( $rows )->id < (int) $wpdb->get_var( $wpdb->prepare( 'SELECT MAX(id) FROM ' . self::t( 'messages' ) . ' WHERE channel_id = %d', $ch->id ) ),
		);
	}

	/** POST channels/{id}/activity {state: typing|recording|idle} — kept for 6 seconds. */
	public static function chat_activity( WP_REST_Request $r ) {
		$uid = self::uid();
		$ch  = self::channel_for( (int) $r['id'], $uid );
		if ( ! $ch ) {
			return self::err( 'گفت‌وگو پیدا نشد.', 404 );
		}
		$state = MP_Util::pick( $r['state'], array( 'typing', 'recording', 'video', 'uploading', 'idle' ), 'idle' );
		MP_Live::set_activity( (int) $ch->id, $uid, $state );
		return array( 'ok' => true );
	}

	public static function activity_of( $channel_id, $uid ) {
		$a = MP_Live::activity( $uid, $channel_id );
		return isset( $a[ (int) $channel_id ] ) ? $a[ (int) $channel_id ] : array();
	}

	/** DELETE messages/{id} — people delete their own messages; the row is kept for the site admin. */
	public static function delete_message( WP_REST_Request $r ) {
		global $wpdb;
		$uid = self::uid();
		$m   = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'messages' ) . ' WHERE id = %d', (int) $r['id'] ) );
		if ( ! $m || ! self::channel_for( (int) $m->channel_id, $uid ) ) {
			return self::err( 'پیام پیدا نشد.', 404 );
		}
		$manager = MP_Util::is_manager();
		// {hard: 1} — a manager erases it for good (with its file); everyone's screen drops it on the next poll.
		if ( ! empty( $r['hard'] ) && 'false' !== $r['hard'] ) {
			if ( ! $manager ) {
				return self::err( 'فقط ناظر می‌تواند پیام را برای همیشه پاک کند.', 403 );
			}
			$u = $m->user_id ? get_userdata( $m->user_id ) : null;
			if ( $m->file_id && ! (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM ' . self::t( 'messages' ) . ' WHERE file_id = %d AND id <> %d', $m->file_id, $m->id ) ) ) {
				MP_Files::delete( (int) $m->file_id );
			}
			$wpdb->delete( self::t( 'messages' ), array( 'id' => $m->id ) );
			$key  = 'mp_purged_' . (int) $m->channel_id;
			$list = get_transient( $key );
			$list = array_filter(
				is_array( $list ) ? $list : array(),
				function ( $t ) {
					return $t > time() - 20 * MINUTE_IN_SECONDS;
				}
			);
			$list[ (int) $m->id ] = time();
			set_transient( $key, $list, 20 * MINUTE_IN_SECONDS );
			MP_Live::bump();
			MP_Audit::log( 'delete', 'message', $m->id, 'پاک کردن کامل پیام ' . ( $u ? $u->display_name : ( $m->guest_name ? $m->guest_name : 'مشتری' ) ) . ': ' . wp_trim_words( $m->body ? $m->body : '(فایل/ویس)', 10 ) );
			return array( 'id' => (int) $m->id, 'removed' => true );
		}
		// Archiving: your own messages, or anyone's for a manager.
		if ( (int) $m->user_id !== $uid && ! $manager ) {
			return self::err( 'فقط پیام‌های خودتان را می‌توانید آرشیو کنید.', 403 );
		}
		if ( empty( $m->deleted_at ) ) {
			$wpdb->update( self::t( 'messages' ), array( 'deleted_at' => MP_Util::now(), 'deleted_by' => $uid, 'updated_at' => MP_Util::now() ), array( 'id' => $m->id ) );
			MP_Audit::log( 'archive', 'message', $m->id, 'آرشیو پیام: ' . wp_trim_words( $m->body ? $m->body : '(فایل/ویس)', 10 ) );
			MP_Live::bump();
		}
		$m->deleted_at = MP_Util::now();
		return self::message_payload( $m, $uid );
	}

	/** POST auth/logout — sign out without passing through wp-login.php. */
	public static function logout() {
		wp_logout();
		return array( 'ok' => true, 'redirect' => home_url( '/' ) );
	}

	public static function send_message( WP_REST_Request $r ) {
		global $wpdb;
		$uid  = self::uid();
		$ch   = self::channel_for( (int) $r['id'], $uid );
		$body = MP_Util::long_text( $r['body'], 4000 );
		if ( ! $ch ) {
			return self::err( 'گفت‌وگو پیدا نشد.', 404 );
		}
		$can = MP_Chat::can_post( $ch, $uid );
		if ( is_wp_error( $can ) ) {
			return $can;
		}
		$file = (int) $r['file_id'] ? MP_Files::claim( (int) $r['file_id'], 'message', $ch->id ) : 0;
		// A studio sticker or a saved GIF: the library's file, no upload.
		if ( (int) $r['sticker_id'] ) {
			$stk = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'stickers' ) . ' WHERE id = %d', (int) $r['sticker_id'] ) );
			if ( ! $stk ) {
				return self::err( 'این استیکر دیگر وجود ندارد.', 404 );
			}
			$file = (int) $stk->file_id;
			$x    = is_array( $r['x'] ) ? $r['x'] : array();
			$x[ 'gif' === $stk->kind ? 'gif' : 'sticker' ] = 1;
			$r->set_param( 'x', $x );
		}
		$row  = array( 'channel_id' => $ch->id, 'user_id' => $uid, 'body' => $body, 'file_id' => $file, 'created_at' => MP_Util::now() );
		$row  = MP_Chat::send_fields( $r, $ch, $row );
		if ( is_wp_error( $row ) ) {
			return $row;
		}
		if ( '' === trim( $body ) && ! $file && empty( $row['extra'] ) ) {
			return self::err( 'متن پیام را بنویسید یا فایلی پیوست کنید.' );
		}
		$fo = $file ? MP_Files::get( $file ) : null;
		if ( $fo && 0 === strpos( $fo->mime, 'audio/' ) && '' !== trim( (string) $r['transcript'] ) ) {
			$row['transcript'] = MP_Util::long_text( $r['transcript'], 4000 ); // captured live while recording
		}
		// «Send later»: kept aside and posted at its time (by the live connection, the heartbeat or cron).
		$at = (string) $r['send_at'];
		if ( '' !== $at ) {
			return MP_Chat::schedule( $ch, $uid, $row, $at );
		}
		$mid = self::post_message( $ch, $uid, $row );
		return self::message_payload( $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'messages' ) . ' WHERE id = %d', $mid ) ), $uid );
	}

	/** Stores a staff message and tells the right people (not for a «silent» one). Returns its id. */
	public static function post_message( $ch, $uid, array $row ) {
		global $wpdb;
		$wpdb->insert( self::t( 'messages' ), $row );
		$mid = (int) $wpdb->insert_id;
		$wpdb->replace( self::t( 'reads' ), array( 'channel_id' => $ch->id, 'user_id' => $uid, 'last_id' => $mid, 'got_id' => $mid ) );
		MP_Live::set_activity( (int) $ch->id, $uid, 'idle' );
		MP_Live::bump();
		if ( ! empty( $row['silent'] ) ) {
			return $mid;
		}
		$m       = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'messages' ) . ' WHERE id = %d', $mid ) );
		$preview = MP_Chat::snippet( $m );
		$actor   = get_userdata( $uid );
		$actor   = $actor ? $actor->display_name : '';
		if ( 'direct' === $ch->type ) {
			$other = (int) $ch->user_a === $uid ? (int) $ch->user_b : (int) $ch->user_a;
			if ( ! MP_Chat::muted( $ch->id, $other ) ) {
				MP_Notify::event( 'message_direct', $other, array( 'ACTOR' => $actor, 'PREVIEW' => $preview ), 'messages', $ch->id );
			}
		}
		MP_Chat::mentions( $ch, $uid, (string) $row['body'], $preview, $actor );
		MP_Chat::reply_notify( $ch, $uid, $m, $preview, $actor );
		return $mid;
	}

	/* ------------------------------------------------------------------ Client group (public, by token) */

	/** At most 20 client posts (messages, design notes) per IP and group every 10 minutes. */
	public static function client_rate_ok( $channel_id ) {
		$ip  = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '';
		$key = 'mp_client_rate_' . md5( $ip . $channel_id );
		$n   = (int) get_transient( $key );
		if ( $n >= 20 ) {
			return false;
		}
		set_transient( $key, $n + 1, 10 * MINUTE_IN_SECONDS );
		return true;
	}

	private static function client_channel( $token ) {
		global $wpdb;
		return $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'channels' ) . " WHERE type = 'client' AND token = %s AND archived_at IS NULL", $token ) );
	}

	public static function client_messages( WP_REST_Request $r ) {
		global $wpdb;
		$ch = self::client_channel( $r['token'] );
		if ( ! $ch ) {
			return self::err( 'این گروه وجود ندارد یا حذف شده است.', 404 );
		}
		$gate = MP_Client::gate( $ch );
		if ( $gate ) {
			return $gate;
		}
		$rows = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM (SELECT * FROM ' . self::t( 'messages' ) . ' WHERE channel_id = %d AND id > %d AND deleted_at IS NULL ORDER BY id DESC LIMIT 200) x ORDER BY id', $ch->id, (int) $r['after'] ) );
		$out  = array();
		foreach ( $rows as $m ) {
			$u     = $m->user_id ? get_userdata( $m->user_id ) : null;
			$out[] = array(
				'id'         => (int) $m->id,
				'author'     => $u ? $u->display_name : ( ! empty( $m->kind ) ? 'مربع استودیو' : ( $m->guest_name ? $m->guest_name : $ch->client_name ) ),
				'team'       => (bool) $m->user_id,
				'body'       => $m->body,
				'file'       => $m->file_id ? self::client_file( $m->file_id, $ch->token ) : null,
				'created_at' => $m->created_at,
				'x'          => MP_Chat::x_client( $m ),
			) + MP_Client::msg_extra( $m );
		}
		return array( 'title' => $ch->title, 'client' => $ch->client_name, 'messages' => $out );
	}

	private static function client_file( $id, $token ) {
		$p = MP_Files::payload( MP_Files::get( $id ) );
		if ( $p ) {
			$p['url'] = add_query_arg( 't', $token, $p['url'] );
		}
		return $p;
	}

	public static function client_send( WP_REST_Request $r ) {
		global $wpdb;
		$ch = self::client_channel( $r['token'] );
		if ( ! $ch ) {
			return self::err( 'این گروه وجود ندارد یا حذف شده است.', 404 );
		}
		$gate = MP_Client::gate( $ch );
		if ( $gate ) {
			return $gate;
		}
		if ( MP_Client::is_preview( $ch ) ) {
			return self::err( 'این پرتال را در حالت «دیدن مثل مشتری» باز کرده‌اید؛ فقط مشاهده ممکن است.', 403 );
		}
		if ( ! self::client_rate_ok( $ch->id ) ) {
			return self::err( 'تعداد پیام‌ها زیاد است؛ چند دقیقه بعد دوباره تلاش کنید.', 429 );
		}
		$body = MP_Util::long_text( $r['body'], 2000 );
		if ( '' === trim( $body ) ) {
			return self::err( 'متن پیام را بنویسید.' );
		}
		$name = MP_Client::author( $ch, $r['name'] );
		$wpdb->insert(
			self::t( 'messages' ),
			array( 'channel_id' => $ch->id, 'user_id' => 0, 'guest_name' => $name, 'body' => $body, 'created_at' => MP_Util::now() )
		);
		foreach ( self::channel_members( $ch ) as $member ) {
			MP_Notify::event( 'message_client', $member, array( 'GROUP' => $ch->title, 'PREVIEW' => wp_trim_words( $body, 12 ) ), 'messages', $ch->id );
		}
		return array( 'sent' => true );
	}

	/* ------------------------------------------------------------------ Reminders */

	private static function reminder_payload( $x ) {
		return array(
			'id'     => (int) $x->id,
			'title'  => $x->title,
			'note'   => (string) $x->note,
			'date'   => $x->remind_date,
			'time'   => $x->remind_time,
			'repeat' => $x->repeat_every,
			'fired'  => (bool) $x->fired_at,
		);
	}

	public static function list_reminders() {
		global $wpdb;
		$rows = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'reminders' ) . ' WHERE user_id = %d ORDER BY remind_date, remind_time', self::uid() ) );
		return array_map( array( __CLASS__, 'reminder_payload' ), $rows );
	}

	public static function create_reminder( WP_REST_Request $r ) {
		global $wpdb;
		$title = MP_Util::text( $r['title'], 160 );
		if ( '' === $title ) {
			return self::err( 'عنوان یادآوری را وارد کنید.' );
		}
		if ( ! MP_Util::valid_date( $r['date'] ) ) {
			return self::err( 'تاریخ یادآوری معتبر نیست.' );
		}
		if ( ! MP_Util::valid_time( (string) $r['time'] ) || '' === $r['time'] ) {
			return self::err( 'ساعت یادآوری معتبر نیست.' );
		}
		$wpdb->insert(
			self::t( 'reminders' ),
			array(
				'user_id'      => self::uid(),
				'title'        => $title,
				'note'         => MP_Util::long_text( $r['note'], 1000 ),
				'remind_date'  => $r['date'],
				'remind_time'  => $r['time'],
				'repeat_every' => MP_Util::pick( $r['repeat'], array( 'none', 'daily', 'weekly', 'monthly' ), 'none' ),
				'created_at'   => MP_Util::now(),
			)
		);
		return self::list_reminders();
	}

	public static function delete_reminder( WP_REST_Request $r ) {
		global $wpdb;
		$wpdb->delete( self::t( 'reminders' ), array( 'id' => (int) $r['id'], 'user_id' => self::uid() ) );
		return self::list_reminders();
	}

	/* ------------------------------------------------------------------ Notifications */

	public static function list_notifications() {
		global $wpdb;
		$rows = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'notifications' ) . ' WHERE user_id = %d ORDER BY id DESC LIMIT 40', self::uid() ) );
		$out  = array();
		foreach ( $rows as $n ) {
			$out[] = array(
				'id'         => (int) $n->id,
				'type'       => $n->type,
				'title'      => $n->title,
				'detail'     => $n->detail,
				'target'     => $n->target,
				'ref_id'     => (int) $n->ref_id,
				'read'       => (bool) $n->is_read,
				'created_at' => $n->created_at,
			);
		}
		return $out;
	}

	public static function read_notifications( WP_REST_Request $r ) {
		global $wpdb;
		$table = self::t( 'notifications' );
		if ( (int) $r['id'] ) {
			$wpdb->update( $table, array( 'is_read' => 1 ), array( 'id' => (int) $r['id'], 'user_id' => self::uid() ) );
		} else {
			$wpdb->update( $table, array( 'is_read' => 1 ), array( 'user_id' => self::uid() ) );
		}
		return self::list_notifications();
	}

	/* ------------------------------------------------------------------ Accounting (visible to every panel user) */

	/** Entries between two dates, oldest first, each with the running balance after it. */
	public static function ledger_rows( $from, $to, $filters = array() ) {
		global $wpdb;
		$t       = self::t( 'ledger' );
		$opening = (int) $wpdb->get_var( $wpdb->prepare( "SELECT COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE -amount END),0) FROM $t WHERE entry_date < %s", $from ) );
		$rows    = $wpdb->get_results( $wpdb->prepare( "SELECT * FROM $t WHERE entry_date BETWEEN %s AND %s ORDER BY entry_date, entry_time, id", $from, $to ) );
		$running = $opening;
		$items   = array();
		$in      = 0;
		$out     = 0;
		$cats    = array();
		foreach ( $rows as $x ) {
			$amount   = (int) $x->amount;
			$running += 'income' === $x->type ? $amount : -$amount;
			if ( ! empty( $filters['category'] ) && $x->category !== $filters['category'] ) {
				continue;
			}
			if ( ! empty( $filters['project_id'] ) && (int) $x->project_id !== (int) $filters['project_id'] ) {
				continue;
			}
			$in  += 'income' === $x->type ? $amount : 0;
			$out += 'expense' === $x->type ? $amount : 0;
			$key  = $x->type . '|' . ( '' !== $x->category ? $x->category : 'بدون دسته' );
			$cats[ $key ] = ( isset( $cats[ $key ] ) ? $cats[ $key ] : 0 ) + $amount;
			$u        = get_userdata( $x->user_id );
			$items[]  = array(
				'id'         => (int) $x->id,
				'type'       => $x->type,
				'amount'     => $amount,
				'title'      => $x->title,
				'note'       => (string) $x->note,
				'category'   => $x->category,
				'project_id' => (int) $x->project_id,
				'file'       => $x->file_id ? MP_Files::payload( MP_Files::get( $x->file_id ) ) : null,
				'date'       => $x->entry_date,
				'time'       => $x->entry_time,
				'author'     => $u ? $u->display_name : '',
				'balance'    => $running,
				'created_at' => $x->created_at,
				'can_delete' => (int) $x->user_id === self::uid() || MP_Util::is_manager(),
			);
		}
		$breakdown = array();
		foreach ( $cats as $key => $sum ) {
			list( $type, $name ) = explode( '|', $key, 2 );
			$breakdown[]         = array( 'type' => $type, 'category' => $name, 'amount' => $sum );
		}
		usort( $breakdown, function ( $a, $b ) { return $b['amount'] - $a['amount']; } );
		return array( 'items' => $items, 'opening' => $opening, 'income' => $in, 'expense' => $out, 'categories' => $breakdown );
	}

	public static function list_ledger( WP_REST_Request $r ) {
		global $wpdb;
		$from = MP_Util::valid_date( $r['from'] ) ? $r['from'] : '1900-01-01';
		$to   = MP_Util::valid_date( $r['to'] ) ? $r['to'] : '2200-12-31';
		$data = self::ledger_rows( $from, $to, array( 'category' => MP_Util::text( $r['category'], 60 ), 'project_id' => (int) $r['project_id'] ) );
		$data['items']   = array_reverse( $data['items'] );
		$data['balance'] = (int) $wpdb->get_var( 'SELECT COALESCE(SUM(CASE WHEN type = \'income\' THEN amount ELSE -amount END),0) FROM ' . self::t( 'ledger' ) );
		return $data;
	}

	/** Income and expense for the last $months Jalali months, and every category used so far. */
	public static function ledger_summary( WP_REST_Request $r ) {
		global $wpdb;
		$t      = self::t( 'ledger' );
		$months = min( 12, max( 3, (int) $r['months'] ? (int) $r['months'] : 6 ) );
		$out    = array();
		for ( $i = $months - 1; $i >= 0; $i-- ) {
			list( $from, $to, $label ) = MP_Jalali::month_range( MP_Util::today(), -$i );
			$row   = $wpdb->get_row( $wpdb->prepare( "SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END),0) i, COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0) e FROM $t WHERE entry_date BETWEEN %s AND %s", $from, $to ) );
			$out[] = array( 'label' => $label, 'from' => $from, 'income' => (int) $row->i, 'expense' => (int) $row->e );
		}
		return array(
			'months'     => $out,
			'categories' => $wpdb->get_col( "SELECT DISTINCT category FROM $t WHERE category <> '' ORDER BY category" ),
		);
	}

	/** The list for the range the client is viewing, ignoring the saved entry's own category/project. */
	private static function ledger_view( WP_REST_Request $r ) {
		$q = new WP_REST_Request( 'GET' );
		$q->set_param( 'from', $r['from'] );
		$q->set_param( 'to', $r['to'] );
		$q->set_param( 'category', $r['filter_category'] );
		$q->set_param( 'project_id', $r['filter_project'] );
		return self::list_ledger( $q );
	}

	public static function create_ledger( WP_REST_Request $r ) {
		global $wpdb;
		$type   = MP_Util::pick( $r['type'], array( 'income', 'expense' ), '' );
		$amount = (int) preg_replace( '/\D/', '', (string) $r['amount'] );
		$title  = MP_Util::text( $r['title'], 200 );
		$pid    = (int) $r['project_id'];
		if ( ! $type ) {
			return self::err( 'نوع (دخل یا خرج) را انتخاب کنید.' );
		}
		if ( $amount <= 0 ) {
			return self::err( 'مبلغ را وارد کنید.' );
		}
		if ( '' === $title ) {
			return self::err( 'بابت را وارد کنید.' );
		}
		if ( ! MP_Util::valid_date( $r['date'] ) || ! MP_Util::valid_time( (string) $r['time'] ) ) {
			return self::err( 'تاریخ یا ساعت معتبر نیست.' );
		}
		if ( $pid && ! MP_Util::can_see_project( $pid ) ) {
			return self::err( 'به این پروژه دسترسی ندارید.', 403 );
		}
		$wpdb->insert(
			self::t( 'ledger' ),
			array(
				'type'       => $type,
				'amount'     => $amount,
				'title'      => $title,
				'note'       => MP_Util::long_text( $r['note'], 1000 ),
				'category'   => MP_Util::text( $r['category'], 60 ),
				'project_id' => $pid,
				'entry_date' => $r['date'],
				'entry_time' => (string) $r['time'],
				'user_id'    => self::uid(),
				'created_at' => MP_Util::now(),
			)
		);
		$id = (int) $wpdb->insert_id;
		if ( (int) $r['file_id'] ) {
			$wpdb->update( self::t( 'ledger' ), array( 'file_id' => MP_Files::claim( (int) $r['file_id'], 'ledger', $id ) ), array( 'id' => $id ) );
		}
		MP_Audit::log( 'create', 'ledger', $id, ( 'income' === $type ? 'دخل ' : 'خرج ' ) . MP_Jalali::digits( number_format( $amount ) ) . ' تومان بابت «' . $title . '» در ' . MP_Jalali::format( $r['date'] ) );
		return self::ledger_view( $r );
	}

	public static function delete_ledger( WP_REST_Request $r ) {
		global $wpdb;
		$row = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'ledger' ) . ' WHERE id = %d', (int) $r['id'] ) );
		if ( ! $row ) {
			return self::err( 'ردیف پیدا نشد.', 404 );
		}
		if ( (int) $row->user_id !== self::uid() && ! MP_Util::is_manager() ) {
			return self::err( 'فقط ثبت‌کننده یا ناظر می‌تواند این ردیف را حذف کند.', 403 );
		}
		if ( $row->file_id ) {
			MP_Files::delete( $row->file_id );
		}
		$wpdb->delete( self::t( 'ledger' ), array( 'id' => $row->id ) );
		MP_Audit::log( 'delete', 'ledger', $row->id, ( 'income' === $row->type ? 'دخل ' : 'خرج ' ) . MP_Jalali::digits( number_format( $row->amount ) ) . ' تومان بابت «' . $row->title . '»' );
		return self::ledger_view( $r );
	}

	/* ------------------------------------------------------------------ Reports */

	public static function reports( WP_REST_Request $r ) {
		global $wpdb;
		$uid = self::uid();
		if ( (int) $r['user_id'] && MP_Util::is_manager() ) {
			$uid = (int) $r['user_id'];
		}
		$t      = self::t( 'tasks' );
		$today  = MP_Util::today();
		$week   = MP_Util::week_start( $today );
		$last   = MP_Util::add_days( $week, -7 );
		$month  = MP_Util::add_days( $today, -29 );
		$doneIn = function ( $from, $to ) use ( $wpdb, $t, $uid ) {
			return (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM $t WHERE archived_at IS NULL AND user_id = %d AND status = 'done' AND task_date BETWEEN %s AND %s", $uid, $from, $to ) );
		};
		$daily = array();
		for ( $i = 13; $i >= 0; $i-- ) {
			$d       = MP_Util::add_days( $today, -$i );
			$daily[] = array(
				'date'  => $d,
				'done'  => $doneIn( $d, $d ),
				'total' => (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM $t WHERE archived_at IS NULL AND user_id = %d AND task_date = %s", $uid, $d ) ),
			);
		}
		$out = array(
			'user_id'   => $uid,
			'thisWeek'  => $doneIn( $week, MP_Util::add_days( $week, 6 ) ),
			'lastWeek'  => $doneIn( $last, MP_Util::add_days( $last, 6 ) ),
			'month'     => $doneIn( $month, $today ),
			'overdue'   => (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM $t WHERE archived_at IS NULL AND user_id = %d AND status <> 'done' AND task_date < %s", $uid, $today ) ),
			'open'      => (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM $t WHERE archived_at IS NULL AND user_id = %d AND status <> 'done'", $uid ) ),
			'onTime'    => (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM $t WHERE archived_at IS NULL AND user_id = %d AND status = 'done' AND DATE(done_at) <= task_date", $uid ) ),
			'doneTotal' => (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM $t WHERE archived_at IS NULL AND user_id = %d AND status = 'done'", $uid ) ),
			'managerTasks' => array(
				'total' => (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM $t WHERE archived_at IS NULL AND user_id = %d AND source = 'manager'", $uid ) ),
				'done'  => (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM $t WHERE archived_at IS NULL AND user_id = %d AND source = 'manager' AND status = 'done'", $uid ) ),
			),
			'daily'     => $daily,
			'team'      => array(),
		);
		if ( MP_Util::is_manager() ) {
			foreach ( MP_Util::panel_users() as $member ) {
				$u = get_userdata( $member );
				if ( ! $u ) {
					continue;
				}
				$out['team'][] = array(
					'id'      => $member,
					'name'    => $u->display_name,
					'open'    => (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM $t WHERE archived_at IS NULL AND user_id = %d AND status <> 'done'", $member ) ),
					'done'    => (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM $t WHERE archived_at IS NULL AND user_id = %d AND status = 'done' AND task_date BETWEEN %s AND %s", $member, $week, MP_Util::add_days( $week, 6 ) ) ),
					'overdue' => (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM $t WHERE archived_at IS NULL AND user_id = %d AND status <> 'done' AND task_date < %s", $member, $today ) ),
				);
			}
		}
		return $out;
	}
}
