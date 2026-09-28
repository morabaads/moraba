<?php
defined( 'ABSPATH' ) || exit;

/**
 * AI assistant: a language model with tools over the panel.
 *
 * The model (any OpenAI-compatible chat API with function calling — OpenAI, or a gateway) gets the
 * person's context (who they are, today in both calendars, the team, the projects) and a set of tools.
 * Every tool runs through the panel's own REST routes as the current user (rest_do_request), so every
 * permission rule still applies: an employee can't do through the assistant what they can't do by hand.
 *
 * Reading tools run at once. Tools that change something wait for the person's «انجام بده» unless
 * they turned on «بدون تأیید». The conversation (OpenAI message list) lives in the browser and is sent
 * back on each turn; the server keeps nothing.
 */
class MP_AI {

	const HOURLY    = 90;
	const MAX_STEPS = 8;

	public static function register() {
		register_rest_route( MP_Rest::NS, '/assistant', array( 'methods' => 'POST', 'callback' => array( __CLASS__, 'chat' ), 'permission_callback' => array( 'MP_Rest', 'can_access' ) ) );
	}

	public static function key() {
		$k = trim( (string) get_option( 'mp_ai_key', '' ) );
		return $k ? $k : trim( (string) get_option( 'mp_speech_key', '' ) );
	}

	public static function enabled() {
		return (bool) self::key();
	}

	private static function base() {
		$u = trim( (string) get_option( 'mp_ai_url', '' ) );
		if ( ! $u ) {
			$u = trim( (string) get_option( 'mp_speech_url', '' ) );
		}
		return untrailingslashit( $u ? $u : 'https://api.openai.com/v1' );
	}

	private static function model() {
		$m = trim( (string) get_option( 'mp_ai_model', '' ) );
		return $m ? $m : 'gpt-4.1-mini';
	}

	private static function err( $m, $s = 400 ) {
		return new WP_Error( 'mp_ai', $m, array( 'status' => $s ) );
	}

	/* ------------------------------------------------------------------ Helpers */

	private static function norm( $s ) {
		$s = str_replace( array( 'ي', 'ك', "\xE2\x80\x8C" ), array( 'ی', 'ک', ' ' ), (string) $s );
		$s = preg_replace( '/\s+/u', ' ', trim( $s ) );
		return function_exists( 'mb_strtolower' ) ? mb_strtolower( $s ) : strtolower( $s );
	}

	/** Panel user by id, full name, first name, last name or login. Returns id, or WP_Error naming the choices. */
	private static function user( $who ) {
		if ( is_numeric( $who ) && MP_Util::is_panel_user( (int) $who ) ) {
			return (int) $who;
		}
		$q = self::norm( $who );
		if ( in_array( $q, array( 'من', 'خودم', 'me', 'myself' ), true ) || '' === $q ) {
			return get_current_user_id();
		}
		$hits = array();
		foreach ( MP_Util::panel_users() as $id ) {
			$u = get_userdata( $id );
			if ( ! $u ) {
				continue;
			}
			$full = self::norm( $u->display_name );
			if ( $full === $q || self::norm( $u->user_login ) === $q ) {
				return (int) $id;
			}
			$parts = explode( ' ', $full );
			if ( in_array( $q, $parts, true ) || ( mb_strlen( $q ) > 2 && false !== mb_strpos( $full, $q ) ) ) {
				$hits[ $id ] = $u->display_name;
			}
		}
		if ( 1 === count( $hits ) ) {
			return (int) key( $hits );
		}
		return self::err( $hits ? 'چند نفر با این نام هست: ' . implode( '، ', $hits ) . '. کدام؟' : 'کسی با نام «' . $who . '» در پنل نیست.' );
	}

	private static function project( $name ) {
		global $wpdb;
		if ( '' === (string) $name || null === $name ) {
			return 0;
		}
		if ( is_numeric( $name ) ) {
			return (int) $name;
		}
		$q    = self::norm( $name );
		$hits = array();
		foreach ( $wpdb->get_results( 'SELECT id, name FROM ' . MP_Install::table( 'projects' ) ) as $p ) {
			$n = self::norm( $p->name );
			if ( $n === $q ) {
				return (int) $p->id;
			}
			if ( false !== mb_strpos( $n, $q ) || false !== mb_strpos( $q, $n ) ) {
				$hits[ (int) $p->id ] = $p->name;
			}
		}
		if ( 1 === count( $hits ) ) {
			return (int) key( $hits );
		}
		return self::err( $hits ? 'چند پروژه با این نام هست: ' . implode( '، ', $hits ) : 'پروژه «' . $name . '» پیدا نشد.' );
	}

	/** Gregorian 'Y-m-d' from ISO, Jalali (۱۴۰۵/۰۷/۰۶) or امروز/فردا/پس‌فردا/دیروز. */
	private static function date( $v, $default = '' ) {
		$v = trim( J_latin( (string) $v ) );
		if ( '' === $v ) {
			return $default;
		}
		$rel = array( 'امروز' => 0, 'فردا' => 1, 'پس فردا' => 2, 'پس‌فردا' => 2, 'دیروز' => -1, 'today' => 0, 'tomorrow' => 1 );
		if ( isset( $rel[ $v ] ) ) {
			return MP_Util::add_days( MP_Util::today(), $rel[ $v ] );
		}
		if ( preg_match( '/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/', $v, $m ) ) {
			if ( (int) $m[1] < 1600 ) {
				return MP_Jalali::to_iso( (int) $m[1], (int) $m[2], (int) $m[3] );
			}
			$iso = sprintf( '%04d-%02d-%02d', $m[1], $m[2], $m[3] );
			return MP_Util::valid_date( $iso ) ? $iso : $default;
		}
		return $default;
	}

	private static function time( $v ) {
		$v = trim( J_latin( (string) $v ) );
		if ( preg_match( '/^(\d{1,2})(?::(\d{2}))?$/', $v, $m ) && (int) $m[1] < 24 ) {
			return sprintf( '%02d:%02d', $m[1], isset( $m[2] ) ? $m[2] : 0 );
		}
		return '';
	}

	/** Calls a panel route as the current user; returns data or WP_Error. */
	private static function call( $method, $route, array $params = array() ) {
		$req = new WP_REST_Request( $method, '/' . MP_Rest::NS . '/' . $route );
		foreach ( $params as $k => $v ) {
			$req->set_param( $k, $v );
		}
		$res = rest_do_request( $req );
		if ( $res->is_error() ) {
			return $res->as_error();
		}
		return $res->get_data();
	}

	private static function jfmt( $iso ) {
		return $iso ? MP_Jalali::format( $iso ) : '';
	}

	private static function uname( $id ) {
		$u = get_userdata( $id );
		return $u ? $u->display_name : '';
	}

	/* ------------------------------------------------------------------ Tools */

	private static function tools() {
		$s = function ( $desc, $props, $req = array() ) {
			return array( 'description' => $desc, 'parameters' => array( 'type' => 'object', 'properties' => $props, 'required' => $req ) );
		};
		$str  = function ( $d ) { return array( 'type' => 'string', 'description' => $d ); };
		$num  = function ( $d ) { return array( 'type' => 'number', 'description' => $d ); };
		$arr  = function ( $d, $items = array( 'type' => 'string' ) ) { return array( 'type' => 'array', 'description' => $d, 'items' => $items ); };
		$date = $str( 'تاریخ: میلادی YYYY-MM-DD یا شمسی ۱۴۰۵/۰۷/۰۶ یا «امروز/فردا»' );
		$t    = array(
			// Reading
			'get_tasks'        => array( 'read', $s( 'List tasks. Without person: my own. Supervisors may pass a person name or "all". Returns id, title, date, time, status, project, owner, checklist progress.', array( 'person' => $str( 'نام فرد، یا all (فقط ناظر)' ), 'from' => $date, 'to' => $date, 'status' => array( 'type' => 'string', 'enum' => array( 'open', 'done', 'all', 'overdue' ) ), 'project' => $str( 'نام پروژه' ), 'query' => $str( 'متن برای جستجو در عنوان/توضیحات' ) ) ) ),
			'get_task'         => array( 'read', $s( 'Full detail of one task: description, checklist, comments.', array( 'task_id' => $num( 'شناسه تسک' ) ), array( 'task_id' ) ) ),
			'get_projects'     => array( 'read', $s( 'Projects I can see, with status, dates, members, sections, milestones and task counts.', array() ) ),
			'get_team'         => array( 'read', $s( 'Team members: name, job title, role, online status.', array() ) ),
			'get_meetings'     => array( 'read', $s( 'Meetings on a date (default today).', array( 'date' => $date ) ) ),
			'get_reminders'    => array( 'read', $s( 'My reminders.', array() ) ),
			'get_attendance'   => array( 'read', $s( 'Attendance (clock in/out). Supervisors may pass a person.', array( 'person' => $str( 'نام فرد' ), 'from' => $date, 'to' => $date ) ) ),
			'get_messages'     => array( 'read', $s( 'Recent messages of a conversation: with a person (direct) or a group by name.', array( 'with' => $str( 'نام فرد یا نام گروه/پروژه' ), 'limit' => $num( 'تعداد (پیش‌فرض ۱۵)' ) ), array( 'with' ) ) ),
			'get_conversations' => array( 'read', $s( 'My conversations with unread counts and last message.', array() ) ),
			'get_ledger'       => array( 'read', $s( 'Accounting rows and totals between two dates (default this Jalali month).', array( 'from' => $date, 'to' => $date, 'category' => $str( 'دسته' ), 'project' => $str( 'پروژه' ) ) ) ),
			'get_daily_reports' => array( 'read', $s( 'Daily reports of a date: mine; supervisors also get everyone and who is missing.', array( 'date' => $date ) ) ),
			'get_weekly_report' => array( 'read', $s( 'Supervisors: the 7-day report ending a date (work per person, overdue, money).', array( 'to' => $date ) ) ),
			'get_invoices'     => array( 'read', $s( 'Supervisors: invoices and pro-formas.', array( 'project' => $str( 'پروژه' ) ) ) ),
			'get_leaves'       => array( 'read', $s( 'Leave requests (mine; supervisors: everyone).', array() ) ),
			'open_page'        => array( 'client', $s( 'Open a page or window in the panel for the user.', array( 'page' => array( 'type' => 'string', 'enum' => array( 'dashboard', 'calendar', 'mytasks', 'projects', 'messages', 'attendance', 'reminders', 'accounting', 'reports', 'daily_report', 'invoices', 'weekly_report', 'portal' ) ), 'project' => $str( 'برای projects یا portal' ), 'person' => $str( 'برای messages: گفت‌وگو با این نفر' ), 'date' => $date ), array( 'page' ) ) ),
			// Changing
			'create_task'      => array( 'write', $s( 'Create a task. Assignees default to me; assigning to others needs supervisor role. Supports checklist and recurrence.', array( 'title' => $str( 'عنوان کوتاه' ), 'date' => $date, 'time' => $str( 'HH:MM' ), 'assignees' => $arr( 'نام افراد' ), 'project' => $str( 'نام پروژه' ), 'priority' => array( 'type' => 'string', 'enum' => array( 'low', 'medium', 'high' ) ), 'description' => $str( 'توضیحات' ), 'checklist' => $arr( 'موارد چک‌لیست' ), 'recurrence' => array( 'type' => 'string', 'enum' => array( 'none', 'daily', 'weekdays', 'weekly', 'monthly' ) ), 'recur_until' => $date ), array( 'title', 'date' ) ) ),
			'update_task'      => array( 'write', $s( 'Change a task: title, date, time, priority, status, description, project or owner.', array( 'task_id' => $num( 'شناسه' ), 'title' => $str( '' ), 'date' => $date, 'time' => $str( 'HH:MM' ), 'priority' => array( 'type' => 'string', 'enum' => array( 'low', 'medium', 'high' ) ), 'status' => array( 'type' => 'string', 'enum' => array( 'todo', 'doing', 'done' ) ), 'description' => $str( '' ), 'project' => $str( '' ), 'assignee' => $str( 'نام مسئول جدید' ) ), array( 'task_id' ) ) ),
			'archive_task'     => array( 'write', $s( 'Archive (remove from lists) a task. Nothing is deleted.', array( 'task_id' => $num( 'شناسه' ) ), array( 'task_id' ) ) ),
			'add_checklist_item' => array( 'write', $s( 'Add items to a task checklist.', array( 'task_id' => $num( 'شناسه' ), 'items' => $arr( 'موارد' ) ), array( 'task_id', 'items' ) ) ),
			'comment_task'     => array( 'write', $s( 'Comment on a task.', array( 'task_id' => $num( 'شناسه' ), 'text' => $str( 'متن' ) ), array( 'task_id', 'text' ) ) ),
			'send_message'     => array( 'write', $s( 'Send a chat message to a person (direct) or a group/project chat by name.', array( 'to' => $str( 'نام فرد یا گروه' ), 'text' => $str( 'متن پیام' ) ), array( 'to', 'text' ) ) ),
			'create_reminder'  => array( 'write', $s( 'Reminder for me at a date and time.', array( 'title' => $str( '' ), 'date' => $date, 'time' => $str( 'HH:MM' ), 'repeat' => array( 'type' => 'string', 'enum' => array( 'none', 'daily', 'weekly', 'monthly' ) ), 'note' => $str( '' ) ), array( 'title', 'date', 'time' ) ) ),
			'create_meeting'   => array( 'write', $s( 'Schedule a meeting and invite people.', array( 'title' => $str( '' ), 'date' => $date, 'time' => $str( 'HH:MM' ), 'people' => $arr( 'نام افراد' ), 'url' => $str( 'لینک جلسه آنلاین' ), 'project' => $str( '' ) ), array( 'title', 'date', 'time' ) ) ),
			'clock'            => array( 'write', $s( 'Clock me in or out (attendance).', array( 'action' => array( 'type' => 'string', 'enum' => array( 'in', 'out' ) ), 'note' => $str( '' ) ), array( 'action' ) ) ),
			'request_leave'    => array( 'write', $s( 'Request leave: daily (start..end dates) or hourly (one date, from_time..to_time).', array( 'kind' => array( 'type' => 'string', 'enum' => array( 'daily', 'hourly' ) ), 'start' => $date, 'end' => $date, 'from_time' => $str( 'HH:MM' ), 'to_time' => $str( 'HH:MM' ), 'reason' => $str( '' ) ), array( 'kind', 'start' ) ) ),
			'add_ledger'       => array( 'write', $s( 'Record income or expense in accounting (amount in toman).', array( 'type' => array( 'type' => 'string', 'enum' => array( 'income', 'expense' ) ), 'amount' => $num( 'مبلغ به تومان' ), 'title' => $str( 'بابت' ), 'category' => $str( 'دسته' ), 'project' => $str( '' ), 'date' => $date, 'time' => $str( 'HH:MM' ), 'note' => $str( '' ) ), array( 'type', 'amount', 'title' ) ) ),
			'save_daily_report' => array( 'write', $s( 'Write or update my daily report.', array( 'date' => $date, 'done' => $str( 'کارهای انجام‌شده' ), 'progress' => $num( 'درصد ۰ تا ۱۰۰' ), 'problems' => $str( '' ), 'decisions' => $str( 'نیاز به تصمیم' ), 'tomorrow' => $str( 'برنامه فردا' ) ), array( 'done' ) ) ),
			'create_project'   => array( 'write', $s( 'Supervisors: create a project with members.', array( 'name' => $str( '' ), 'members' => $arr( 'نام افراد' ), 'start' => $date, 'end' => $date ), array( 'name' ) ) ),
			'add_project_members' => array( 'write', $s( 'Supervisors: add people to a project.', array( 'project' => $str( '' ), 'members' => $arr( 'نام افراد' ) ), array( 'project', 'members' ) ) ),
			'create_invoice'   => array( 'write', $s( 'Supervisors: invoice or pro-forma for a client (amounts in toman).', array( 'kind' => array( 'type' => 'string', 'enum' => array( 'invoice', 'proforma' ) ), 'client_name' => $str( '' ), 'project' => $str( '' ), 'title' => $str( '' ), 'items' => $arr( 'ردیف‌ها', array( 'type' => 'object', 'properties' => array( 'title' => array( 'type' => 'string' ), 'qty' => array( 'type' => 'number' ), 'price' => array( 'type' => 'number' ) ), 'required' => array( 'title', 'price' ) ) ), 'discount' => $num( '' ), 'tax' => $num( 'درصد' ), 'due_date' => $date, 'note' => $str( '' ) ), array( 'kind', 'client_name', 'items' ) ) ),
		);
		if ( ! MP_Util::is_manager() ) {
			foreach ( array( 'get_weekly_report', 'get_invoices', 'create_project', 'add_project_members', 'create_invoice' ) as $k ) {
				unset( $t[ $k ] );
			}
		}
		return $t;
	}

	private static function tool_schema() {
		$out = array();
		foreach ( self::tools() as $name => $d ) {
			$out[] = array( 'type' => 'function', 'function' => array_merge( array( 'name' => $name ), $d[1] ) );
		}
		return $out;
	}

	private static function kind( $name ) {
		$t = self::tools();
		return isset( $t[ $name ] ) ? $t[ $name ][0] : '';
	}

	/** Persian one-liner for a pending change, shown on its confirm card. */
	private static function summary( $name, $a ) {
		$g = function ( $k, $d = '' ) use ( $a ) { return isset( $a[ $k ] ) && '' !== $a[ $k ] ? $a[ $k ] : $d; };
		$d = self::date( $g( 'date' ) );
		$w = $d ? self::jfmt( $d ) : '';
		switch ( $name ) {
			case 'create_task':
				return 'ساخت تسک «' . $g( 'title' ) . '»' . ( $g( 'assignees' ) ? ' برای ' . implode( '، ', (array) $g( 'assignees' ) ) : '' ) . ( $w ? '، ' . $w : '' ) . ( $g( 'time' ) ? ' ساعت ' . MP_Jalali::digits( self::time( $g( 'time' ) ) ) : '' ) . ( $g( 'project' ) ? '، پروژه ' . $g( 'project' ) : '' ) . ( $g( 'checklist' ) ? '، با ' . MP_Jalali::digits( count( (array) $g( 'checklist' ) ) ) . ' مورد چک‌لیست' : '' );
			case 'update_task':
				$ch = array();
				foreach ( array( 'title' => 'عنوان', 'date' => 'تاریخ', 'time' => 'ساعت', 'priority' => 'اولویت', 'status' => 'وضعیت', 'description' => 'توضیحات', 'project' => 'پروژه', 'assignee' => 'مسئول' ) as $k => $l ) {
					if ( '' !== $g( $k ) ) {
						$ch[] = $l . ': ' . ( 'date' === $k ? $w : ( 'status' === $k ? array( 'todo' => 'انجام نشده', 'doing' => 'در حال انجام', 'done' => 'انجام شد' )[ $g( $k ) ] ?? $g( $k ) : $g( $k ) ) );
					}
				}
				return 'ویرایش تسک ' . self::task_title( $g( 'task_id' ) ) . ' — ' . implode( '، ', $ch );
			case 'archive_task':
				return 'آرشیو تسک ' . self::task_title( $g( 'task_id' ) );
			case 'add_checklist_item':
				return 'افزودن ' . MP_Jalali::digits( count( (array) $g( 'items', array() ) ) ) . ' مورد به چک‌لیست ' . self::task_title( $g( 'task_id' ) );
			case 'comment_task':
				return 'نظر روی ' . self::task_title( $g( 'task_id' ) ) . ': ' . $g( 'text' );
			case 'send_message':
				return 'پیام به ' . $g( 'to' ) . ': ' . $g( 'text' );
			case 'create_reminder':
				return 'یادآوری «' . $g( 'title' ) . '»، ' . $w . ' ساعت ' . MP_Jalali::digits( self::time( $g( 'time' ) ) );
			case 'create_meeting':
				return 'جلسه «' . $g( 'title' ) . '»، ' . $w . ' ساعت ' . MP_Jalali::digits( self::time( $g( 'time' ) ) ) . ( $g( 'people' ) ? ' با ' . implode( '، ', (array) $g( 'people' ) ) : '' );
			case 'clock':
				return 'in' === $g( 'action' ) ? 'ثبت ورود' : 'ثبت خروج';
			case 'request_leave':
				return 'درخواست مرخصی ' . ( 'hourly' === $g( 'kind' ) ? 'ساعتی ' . self::jfmt( self::date( $g( 'start' ) ) ) . ' از ' . MP_Jalali::digits( $g( 'from_time' ) ) . ' تا ' . MP_Jalali::digits( $g( 'to_time' ) ) : 'روزانه ' . self::jfmt( self::date( $g( 'start' ) ) ) . ( $g( 'end' ) ? ' تا ' . self::jfmt( self::date( $g( 'end' ) ) ) : '' ) );
			case 'add_ledger':
				return ( 'income' === $g( 'type' ) ? 'دخل ' : 'خرج ' ) . MP_Jalali::digits( number_format( (float) $g( 'amount', 0 ) ) ) . ' تومان بابت «' . $g( 'title' ) . '»' . ( $g( 'project' ) ? ' · ' . $g( 'project' ) : '' );
			case 'save_daily_report':
				return 'ثبت گزارش روزانه' . ( $g( 'progress' ) !== '' ? ' (' . MP_Jalali::digits( $g( 'progress' ) ) . '٪)' : '' );
			case 'create_project':
				return 'ساخت پروژه «' . $g( 'name' ) . '»' . ( $g( 'members' ) ? ' با ' . implode( '، ', (array) $g( 'members' ) ) : '' );
			case 'add_project_members':
				return 'افزودن ' . implode( '، ', (array) $g( 'members' ) ) . ' به پروژه ' . $g( 'project' );
			case 'create_invoice':
				$sum = 0;
				foreach ( (array) $g( 'items', array() ) as $it ) {
					$sum += ( isset( $it['qty'] ) ? (float) $it['qty'] : 1 ) * ( isset( $it['price'] ) ? (float) $it['price'] : 0 );
				}
				return ( 'proforma' === $g( 'kind' ) ? 'پیش‌فاکتور' : 'فاکتور' ) . ' برای ' . $g( 'client_name' ) . '، ' . MP_Jalali::digits( number_format( $sum ) ) . ' تومان';
		}
		return $name;
	}

	private static function task_title( $id ) {
		$t = MP_Rest::get_task( (int) $id );
		return $t ? '«' . $t->title . '»' : '#' . (int) $id;
	}

	private static function brief_task( $t ) {
		return array(
			'id'        => $t['id'],
			'title'     => $t['title'],
			'date'      => $t['date'] . ' (' . self::jfmt( $t['date'] ) . ')',
			'time'      => $t['time'],
			'status'    => $t['status'],
			'priority'  => $t['priority'],
			'owner'     => self::uname( $t['user_id'] ),
			'project'   => $t['project_id'] ? (string) $GLOBALS['wpdb']->get_var( $GLOBALS['wpdb']->prepare( 'SELECT name FROM ' . MP_Install::table( 'projects' ) . ' WHERE id = %d', $t['project_id'] ) ) : '',
			'checklist' => $t['items_total'] ? $t['items_done'] . '/' . $t['items_total'] : '',
			'locked'    => $t['locked'],
		);
	}

	/** Runs one tool; returns array (sent back to the model as JSON) or WP_Error. */
	private static function run( $name, array $a, array &$client ) {
		$g = function ( $k, $d = null ) use ( $a ) { return isset( $a[ $k ] ) && '' !== $a[ $k ] && null !== $a[ $k ] ? $a[ $k ] : $d; };
		switch ( $name ) {
			case 'get_tasks':
				$who = $g( 'person' );
				$q   = array( 'from' => self::date( $g( 'from' ) ), 'to' => self::date( $g( 'to' ) ) );
				if ( $who && 'all' === strtolower( $who ) ) {
					$q['user_id'] = 'all';
				} elseif ( $who ) {
					$u = self::user( $who );
					if ( is_wp_error( $u ) ) {
						return $u;
					}
					$q['user_id'] = $u;
				}
				if ( $g( 'project' ) ) {
					$p = self::project( $g( 'project' ) );
					if ( is_wp_error( $p ) ) {
						return $p;
					}
					$q = array( 'project_id' => $p, 'from' => $q['from'], 'to' => $q['to'] );
				}
				$list = self::call( 'GET', 'tasks', $q );
				if ( is_wp_error( $list ) ) {
					return $list;
				}
				$st    = $g( 'status', 'all' );
				$today = MP_Util::today();
				$query = self::norm( $g( 'query', '' ) );
				$list  = array_values(
					array_filter(
						$list,
						function ( $t ) use ( $st, $today, $query ) {
							if ( 'open' === $st && $t['done'] ) {
								return false;
							}
							if ( 'done' === $st && ! $t['done'] ) {
								return false;
							}
							if ( 'overdue' === $st && ( $t['done'] || $t['date'] >= $today ) ) {
								return false;
							}
							return '' === $query || false !== mb_strpos( self::norm( $t['title'] . ' ' . $t['description'] ), $query );
						}
					)
				);
				return array( 'count' => count( $list ), 'tasks' => array_map( array( __CLASS__, 'brief_task' ), array_slice( $list, 0, 60 ) ) );

			case 'get_task':
				$d = self::call( 'GET', 'tasks/' . (int) $g( 'task_id' ) . '/detail' );
				if ( is_wp_error( $d ) ) {
					return $d;
				}
				$t = MP_Rest::get_task( (int) $g( 'task_id' ) );
				return array( 'task' => $t ? self::brief_task( MP_Rest::task_payload( $t ) ) + array( 'description' => $t->description ) : null, 'detail' => $d );

			case 'get_projects':
				$d = self::call( 'GET', 'projects' );
				if ( is_wp_error( $d ) ) {
					return $d;
				}
				return array_map(
					function ( $p ) {
						return array( 'id' => $p['id'], 'name' => $p['name'], 'status' => $p['status'], 'start' => self::jfmt( $p['start'] ), 'end' => self::jfmt( $p['end'] ), 'members' => array_map( array( __CLASS__, 'uname' ), $p['members'] ), 'tasks' => $p['tasks'], 'sections' => wp_list_pluck( $p['sections'], 'title' ), 'milestones' => array_map( function ( $m ) { return $m['title'] . ' (' . MP_Jalali::format( $m['start'] ) . ' تا ' . MP_Jalali::format( $m['end'] ) . '، ' . $m['status'] . ')'; }, $p['milestones'] ) );
					},
					$d['projects']
				);

			case 'get_team':
				$out = array();
				foreach ( MP_Util::panel_users() as $id ) {
					$p = MP_Util::user_payload( $id );
					if ( $p ) {
						$out[] = array( 'name' => $p['name'], 'title' => $p['title'], 'role' => $p['role'], 'status' => array( 'online' => 'آنلاین', 'away' => 'اخیراً', 'busy' => 'آفلاین' )[ $p['status'] ] ?? '' );
					}
				}
				return $out;

			case 'get_meetings':
				return self::call( 'GET', 'meetings', array( 'date' => self::date( $g( 'date' ), MP_Util::today() ) ) );

			case 'get_reminders':
				return self::call( 'GET', 'reminders' );

			case 'get_attendance':
				$q = array( 'from' => self::date( $g( 'from' ), MP_Util::add_days( MP_Util::today(), -6 ) ), 'to' => self::date( $g( 'to' ), MP_Util::today() ) );
				if ( $g( 'person' ) ) {
					$u = self::user( $g( 'person' ) );
					if ( is_wp_error( $u ) ) {
						return $u;
					}
					$q['user_id'] = $u;
				}
				return self::call( 'GET', 'attendance', $q );

			case 'get_conversations':
				$d = self::call( 'GET', 'channels' );
				if ( is_wp_error( $d ) ) {
					return $d;
				}
				return array_map( function ( $c ) { return array( 'title' => $c['title'], 'type' => $c['type'], 'unread' => $c['unread'], 'last' => $c['last'] ? $c['last']['author'] . ': ' . ( $c['last']['body'] ? $c['last']['body'] : '(فایل/ویس)' ) : '' ); }, array_values( array_filter( $d, function ( $c ) { return $c['last'] || $c['unread']; } ) ) );

			case 'get_messages':
				$ch = self::channel_for( $g( 'with', '' ) );
				if ( is_wp_error( $ch ) ) {
					return $ch;
				}
				$d = self::call( 'GET', 'channels/' . $ch . '/messages', array( 'after' => 0 ) );
				if ( is_wp_error( $d ) ) {
					return $d;
				}
				$msgs = array_slice( $d['messages'], -1 * max( 1, min( 50, (int) $g( 'limit', 15 ) ) ) );
				return array_map( function ( $m ) { return array( 'from' => $m['author'], 'text' => $m['deleted'] ? '(آرشیو شده)' : ( $m['body'] ? $m['body'] : ( $m['transcript'] ? '(ویس) ' . $m['transcript'] : '(فایل)' ) ), 'at' => MP_Jalali::format( substr( $m['created_at'], 0, 10 ) ) . ' ' . substr( $m['created_at'], 11, 5 ) ); }, $msgs );

			case 'get_ledger':
				list( $mf, $mt ) = MP_Jalali::month_range( MP_Util::today() );
				$p = $g( 'project' ) ? self::project( $g( 'project' ) ) : 0;
				if ( is_wp_error( $p ) ) {
					return $p;
				}
				$d = MP_Rest::ledger_rows( self::date( $g( 'from' ), $mf ), self::date( $g( 'to' ), $mt ), array( 'category' => (string) $g( 'category', '' ), 'project_id' => $p ) );
				$d['items'] = array_slice( $d['items'], -40 );
				return $d;

			case 'get_daily_reports':
				return self::call( 'GET', 'daily-reports', array( 'date' => self::date( $g( 'date' ), MP_Util::today() ) ) );

			case 'get_weekly_report':
				return class_exists( 'MP_Digest' ) ? MP_Digest::weekly( self::date( $g( 'to' ), MP_Util::today() ) ) : array();

			case 'get_invoices':
				$d = self::call( 'GET', 'invoices' );
				if ( is_wp_error( $d ) ) {
					return $d;
				}
				return array_map( function ( $x ) { return array( 'number' => $x['number'], 'kind' => $x['kind'], 'client' => $x['client_name'], 'project' => $x['project'], 'total' => $x['total'], 'status' => $x['status'], 'date' => MP_Jalali::format( $x['issue_date'] ), 'url' => $x['url'] ); }, $d['items'] );

			case 'get_leaves':
				return self::call( 'GET', 'leaves' );

			case 'open_page':
				$act = array( 'page' => (string) $g( 'page', 'dashboard' ) );
				if ( $g( 'project' ) ) {
					$p = self::project( $g( 'project' ) );
					$act['project_id'] = is_wp_error( $p ) ? 0 : $p;
				}
				if ( $g( 'person' ) ) {
					$u = self::user( $g( 'person' ) );
					$act['user_id'] = is_wp_error( $u ) ? 0 : $u;
				}
				if ( $g( 'date' ) ) {
					$act['date'] = self::date( $g( 'date' ) );
				}
				$client[] = $act;
				return array( 'opened' => $act['page'] );

			/* ---- changes ---- */

			case 'create_task':
				$ids = array();
				foreach ( (array) $g( 'assignees', array() ) as $n ) {
					$u = self::user( $n );
					if ( is_wp_error( $u ) ) {
						return $u;
					}
					$ids[] = $u;
				}
				$p = self::project( $g( 'project' ) );
				if ( is_wp_error( $p ) ) {
					return $p;
				}
				$res = self::call( 'POST', 'tasks', array_filter( array( 'title' => $g( 'title' ), 'date' => self::date( $g( 'date' ), MP_Util::today() ), 'time' => self::time( $g( 'time', '' ) ), 'user_ids' => $ids ? $ids : null, 'project_id' => $p, 'priority' => $g( 'priority' ), 'description' => $g( 'description' ), 'checklist' => $g( 'checklist' ), 'recurrence' => $g( 'recurrence' ), 'recur_until' => self::date( $g( 'recur_until' ) ) ), function ( $v ) { return null !== $v && '' !== $v; } ) );
				return is_wp_error( $res ) ? $res : array( 'created' => isset( $res['created'] ) ? $res['created'] : 1, 'task_id' => $res['id'] );

			case 'update_task':
				$f = array();
				foreach ( array( 'title', 'priority', 'status', 'description' ) as $k ) {
					if ( null !== $g( $k ) ) {
						$f[ $k ] = $g( $k );
					}
				}
				if ( $g( 'date' ) ) {
					$f['date'] = self::date( $g( 'date' ) );
				}
				if ( null !== $g( 'time' ) ) {
					$f['time'] = self::time( $g( 'time' ) );
				}
				if ( $g( 'project' ) ) {
					$p = self::project( $g( 'project' ) );
					if ( is_wp_error( $p ) ) {
						return $p;
					}
					$f['project_id'] = $p;
				}
				if ( $g( 'assignee' ) ) {
					$u = self::user( $g( 'assignee' ) );
					if ( is_wp_error( $u ) ) {
						return $u;
					}
					$f['user_id'] = $u;
				}
				$res = self::call( 'POST', 'tasks/' . (int) $g( 'task_id' ), $f );
				return is_wp_error( $res ) ? $res : array( 'updated' => $res['id'], 'status' => $res['status'] );

			case 'archive_task':
				return self::call( 'DELETE', 'tasks/' . (int) $g( 'task_id' ) );

			case 'add_checklist_item':
				$n = 0;
				foreach ( (array) $g( 'items', array() ) as $text ) {
					$res = self::call( 'POST', 'tasks/' . (int) $g( 'task_id' ) . '/items', array( 'text' => $text ) );
					if ( is_wp_error( $res ) ) {
						return $res;
					}
					++$n;
				}
				return array( 'added' => $n );

			case 'comment_task':
				$res = self::call( 'POST', 'tasks/' . (int) $g( 'task_id' ) . '/comments', array( 'body' => $g( 'text' ) ) );
				return is_wp_error( $res ) ? $res : array( 'commented' => true );

			case 'send_message':
				$ch = self::channel_for( $g( 'to', '' ), true );
				if ( is_wp_error( $ch ) ) {
					return $ch;
				}
				$res = self::call( 'POST', 'channels/' . $ch . '/messages', array( 'id' => $ch, 'body' => $g( 'text' ) ) );
				return is_wp_error( $res ) ? $res : array( 'sent' => true, 'channel_id' => $ch );

			case 'create_reminder':
				$res = self::call( 'POST', 'reminders', array( 'title' => $g( 'title' ), 'date' => self::date( $g( 'date' ), MP_Util::today() ), 'time' => self::time( $g( 'time', '09:00' ) ), 'repeat' => $g( 'repeat', 'none' ), 'note' => $g( 'note', '' ) ) );
				return is_wp_error( $res ) ? $res : array( 'saved' => true );

			case 'create_meeting':
				$ids = array();
				foreach ( (array) $g( 'people', array() ) as $n ) {
					$u = self::user( $n );
					if ( is_wp_error( $u ) ) {
						return $u;
					}
					$ids[] = $u;
				}
				$p = self::project( $g( 'project' ) );
				if ( is_wp_error( $p ) ) {
					return $p;
				}
				$res = self::call( 'POST', 'meetings', array( 'title' => $g( 'title' ), 'date' => self::date( $g( 'date' ), MP_Util::today() ), 'time' => self::time( $g( 'time' ) ), 'people' => $ids, 'url' => $g( 'url', '' ), 'project_id' => $p ) );
				return is_wp_error( $res ) ? $res : array( 'scheduled' => true );

			case 'clock':
				$res = self::call( 'POST', 'attendance', array( 'action' => $g( 'action' ), 'note' => $g( 'note', '' ) ) );
				return is_wp_error( $res ) ? $res : array( 'done' => true, 'open' => ! empty( $res['open'] ) );

			case 'request_leave':
				$res = self::call( 'POST', 'leaves', array( 'kind' => $g( 'kind', 'daily' ), 'start' => self::date( $g( 'start' ) ), 'end' => self::date( $g( 'end' ), self::date( $g( 'start' ) ) ), 'from_time' => self::time( $g( 'from_time', '' ) ), 'to_time' => self::time( $g( 'to_time', '' ) ), 'reason' => $g( 'reason', '' ) ) );
				return is_wp_error( $res ) ? $res : array( 'requested' => true );

			case 'add_ledger':
				$p = self::project( $g( 'project' ) );
				if ( is_wp_error( $p ) ) {
					return $p;
				}
				$res = self::call( 'POST', 'ledger', array( 'type' => $g( 'type' ), 'amount' => (int) round( (float) $g( 'amount', 0 ) ), 'title' => $g( 'title' ), 'category' => $g( 'category', '' ), 'project_id' => $p, 'date' => self::date( $g( 'date' ), MP_Util::today() ), 'time' => self::time( $g( 'time', current_time( 'H:i' ) ) ), 'note' => $g( 'note', '' ) ) );
				return is_wp_error( $res ) ? $res : array( 'recorded' => true );

			case 'save_daily_report':
				$res = self::call( 'POST', 'daily-reports', array( 'date' => self::date( $g( 'date' ), MP_Util::today() ), 'done' => $g( 'done' ), 'progress' => (int) $g( 'progress', 0 ), 'problems' => $g( 'problems', '' ), 'decisions' => $g( 'decisions', '' ), 'tomorrow' => $g( 'tomorrow', '' ) ) );
				return is_wp_error( $res ) ? $res : array( 'saved' => true );

			case 'create_project':
				$ids = array();
				foreach ( (array) $g( 'members', array() ) as $n ) {
					$u = self::user( $n );
					if ( is_wp_error( $u ) ) {
						return $u;
					}
					$ids[] = $u;
				}
				$res = self::call( 'POST', 'projects', array( 'name' => $g( 'name' ), 'members' => $ids, 'start' => self::date( $g( 'start' ) ), 'end' => self::date( $g( 'end' ) ) ) );
				return is_wp_error( $res ) ? $res : array( 'created' => true );

			case 'add_project_members':
				$p = self::project( $g( 'project' ) );
				if ( is_wp_error( $p ) ) {
					return $p;
				}
				$ids = array();
				foreach ( (array) $g( 'members', array() ) as $n ) {
					$u = self::user( $n );
					if ( is_wp_error( $u ) ) {
						return $u;
					}
					$ids[] = $u;
				}
				$res = self::call( 'POST', 'projects/' . $p . '/members', array( 'members' => $ids, 'user_ids' => $ids ) );
				return is_wp_error( $res ) ? $res : array( 'added' => count( $ids ) );

			case 'create_invoice':
				$p = self::project( $g( 'project' ) );
				if ( is_wp_error( $p ) ) {
					return $p;
				}
				$res = self::call( 'POST', 'invoices', array( 'kind' => $g( 'kind', 'invoice' ), 'client_name' => $g( 'client_name' ), 'project_id' => $p, 'title' => $g( 'title', '' ), 'items' => $g( 'items', array() ), 'discount' => $g( 'discount', 0 ), 'tax' => $g( 'tax' ), 'due_date' => self::date( $g( 'due_date' ) ), 'note' => $g( 'note', '' ) ) );
				return is_wp_error( $res ) ? $res : array( 'number' => $res['number'], 'total' => $res['total'], 'client_link' => $res['url'] );
		}
		return self::err( 'ابزار ناشناخته: ' . $name );
	}

	/** Conversation id for a person (direct chat, created if needed) or a group/project chat by name. */
	private static function channel_for( $to, $create = false ) {
		$list = self::call( 'GET', 'channels' );
		if ( is_wp_error( $list ) ) {
			return $list;
		}
		$q = self::norm( $to );
		foreach ( $list as $c ) {
			if ( 'direct' !== $c['type'] && self::norm( $c['title'] ) === $q ) {
				return (int) $c['id'];
			}
		}
		$u = self::user( $to );
		if ( ! is_wp_error( $u ) && $u !== get_current_user_id() ) {
			foreach ( $list as $c ) {
				if ( 'direct' === $c['type'] && (int) $c['other'] === $u ) {
					return (int) $c['id'];
				}
			}
			$ch = self::call( 'POST', 'channels', array( 'type' => 'direct', 'user_id' => $u ) );
			return is_wp_error( $ch ) ? $ch : (int) $ch['id'];
		}
		$hits = array();
		foreach ( $list as $c ) {
			if ( 'direct' !== $c['type'] && false !== mb_strpos( self::norm( $c['title'] ), $q ) ) {
				$hits[ (int) $c['id'] ] = $c['title'];
			}
		}
		if ( 1 === count( $hits ) ) {
			return (int) key( $hits );
		}
		return is_wp_error( $u ) && ! $hits ? $u : self::err( $hits ? 'چند گفت‌وگو پیدا شد: ' . implode( '، ', $hits ) : 'گفت‌وگو پیدا نشد.' );
	}

	/* ------------------------------------------------------------------ Model */

	private static function system_prompt() {
		$uid   = get_current_user_id();
		$me    = MP_Util::user_payload( $uid );
		$today = MP_Util::today();
		$days  = array( 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه' );
		$cal   = array();
		for ( $i = -7; $i <= 21; $i++ ) {
			$d     = MP_Util::add_days( $today, $i );
			$cal[] = $days[ (int) gmdate( 'w', strtotime( $d . ' UTC' ) ) ] . ' ' . MP_Jalali::format( $d ) . ' = ' . $d . ( 0 === $i ? ' (امروز)' : '' );
		}
		$team = array();
		foreach ( MP_Util::panel_users() as $id ) {
			$p = MP_Util::user_payload( $id );
			if ( $p ) {
				$team[] = $p['name'] . ( $p['title'] ? ' — ' . $p['title'] : '' ) . ' (' . $p['role'] . ( $id === $uid ? '، خود کاربر' : '' ) . ')';
			}
		}
		$projects = array();
		$pl       = self::call( 'GET', 'projects' );
		if ( ! is_wp_error( $pl ) ) {
			foreach ( array_slice( $pl['projects'], 0, 80 ) as $p ) {
				$projects[] = $p['name'];
			}
		}
		return implode(
			"\n",
			array(
				'تو «دستیار مربع» هستی: دستیار هوشمند پنل کاری مربع استودیو (یک استودیوی طراحی و توسعه وب در ایران). با ابزارهایی که داری هر کاری را که کاربر در پنل می‌خواهد انجام می‌دهی: تسک، تقویم، پیام، جلسه، یادآوری، حضور و مرخصی، حسابداری، گزارش روزانه، پروژه و فاکتور.',
				'',
				'قواعد:',
				'- همیشه فارسی، کوتاه، گرم و حرفه‌ای جواب بده. از قالب‌بندی سنگین پرهیز کن؛ فهرست کوتاه با • اشکالی ندارد. اعداد و تاریخ‌ها را به فارسی و شمسی بنویس.',
				'- هیچ داده‌ای را حدس نزن یا نساز. برای هر سؤالی درباره تسک‌ها، پیام‌ها، پروژه‌ها، حضور، پول و… اول ابزار خواندنی مناسب را صدا بزن.',
				'- وقتی کاربر کاری خواست، مستقیم ابزار تغییر را با پارامترهای کامل صدا بزن؛ تأیید نهایی را خود پنل از کاربر می‌گیرد، پس دوباره نپرس «مطمئنی؟». فقط وقتی چیزی واقعاً مبهم است (مثلاً دو نفر با یک نام) یک سؤال کوتاه بپرس.',
				'- چند کار مستقل را در یک نوبت با چند فراخوانی هم‌زمان انجام بده (مثلاً سه تسک برای سه نفر).',
				'- برای ویرایش/آرشیو/نظر روی تسک، اول با get_tasks شناسه را پیدا کن.',
				'- تاریخ‌ها را به میلادی YYYY-MM-DD به ابزار بده و از جدول تقویم زیر استفاده کن؛ خودت تبدیل نکن. ساعت‌ها HH:MM (۲۴ساعته). «عصر ۵» یعنی 17:00. «صبح» پیش‌فرض 09:00.',
				'- مبلغ‌ها به تومان‌اند. «۱۳۰ تومن» در گفتار روزمره یعنی ۱۳۰ هزار تومان، «۲ میلیون» یعنی ۲٬۰۰۰٬۰۰۰ تومان.',
				'- هفته ایرانی از شنبه شروع می‌شود و جمعه تعطیل است.',
				'- اگر ابزاری خطا داد، علت را ساده بگو و اگر راهی هست پیشنهاد بده. اگر کاربر اجازه کاری را ندارد (مثلاً کارمند برای دیگری تسک بسازد)، مودبانه بگو ناظر باید انجام دهد.',
				'- بعد از انجام کارها در یکی دو جمله بگو چه شد. برای خلاصه‌ها (کارهای امروز، وضعیت تیم، مالی) مرتب و کاربردی بنویس و نکته مهم را اول بگو.',
				'- درخواست‌های بی‌ربط به کار را کوتاه و مؤدبانه جواب بده.',
				'',
				'کاربر: ' . $me['name'] . ( $me['title'] ? ' — ' . $me['title'] : '' ) . ' (' . $me['role'] . ( MP_Util::is_manager() ? '؛ ناظر است و می‌تواند برای دیگران تسک تعیین کند و گزارش تیم و مالی را ببیند' : '؛ کارمند است' ) . ').',
				'اکنون: ' . $days[ (int) gmdate( 'w', strtotime( $today . ' UTC' ) ) ] . ' ' . MP_Jalali::format( $today ) . ' (' . $today . ')، ساعت ' . current_time( 'H:i' ) . '.',
				'',
				'تیم: ' . implode( ' | ', $team ),
				'پروژه‌ها: ' . ( $projects ? implode( ' | ', $projects ) : '—' ),
				'',
				'تقویم (شمسی = میلادی):',
				implode( "\n", $cal ),
			)
		);
	}

	private static function complete( array $messages ) {
		$res = wp_remote_post(
			self::base() . '/chat/completions',
			array(
				'timeout' => 60,
				'headers' => array( 'Authorization' => 'Bearer ' . self::key(), 'Content-Type' => 'application/json' ),
				'body'    => wp_json_encode(
					array(
						'model'       => self::model(),
						'messages'    => $messages,
						'tools'       => self::tool_schema(),
						'tool_choice' => 'auto',
						'temperature' => 0.2,
					)
				),
			)
		);
		if ( is_wp_error( $res ) ) {
			return self::err( 'سرویس هوش مصنوعی در دسترس نیست: ' . $res->get_error_message(), 502 );
		}
		$body = json_decode( wp_remote_retrieve_body( $res ), true );
		if ( 200 !== (int) wp_remote_retrieve_response_code( $res ) || empty( $body['choices'][0]['message'] ) ) {
			return self::err( 'سرویس هوش مصنوعی خطا داد: ' . ( isset( $body['error']['message'] ) ? $body['error']['message'] : 'HTTP ' . wp_remote_retrieve_response_code( $res ) ), 502 );
		}
		$m = $body['choices'][0]['message'];
		return array_filter(
			array(
				'role'       => 'assistant',
				'content'    => isset( $m['content'] ) ? (string) $m['content'] : '',
				'tool_calls' => ! empty( $m['tool_calls'] ) ? $m['tool_calls'] : null,
			),
			function ( $v ) { return null !== $v; }
		);
	}

	/** Only well-formed turns from the browser; old turns trimmed. */
	private static function clean( $messages ) {
		$out = array();
		foreach ( is_array( $messages ) ? $messages : array() as $m ) {
			if ( ! is_array( $m ) || ! isset( $m['role'] ) || ! in_array( $m['role'], array( 'user', 'assistant', 'tool' ), true ) ) {
				continue;
			}
			$x = array( 'role' => $m['role'], 'content' => isset( $m['content'] ) ? mb_substr( (string) $m['content'], 0, 12000 ) : '' );
			if ( 'assistant' === $m['role'] && ! empty( $m['tool_calls'] ) && is_array( $m['tool_calls'] ) ) {
				$x['tool_calls'] = array_values( array_filter( $m['tool_calls'], function ( $c ) { return isset( $c['id'], $c['function']['name'] ); } ) );
				if ( ! $x['tool_calls'] ) {
					unset( $x['tool_calls'] );
				}
			}
			if ( 'tool' === $m['role'] ) {
				if ( empty( $m['tool_call_id'] ) ) {
					continue;
				}
				$x['tool_call_id'] = (string) $m['tool_call_id'];
			}
			$out[] = $x;
		}
		// Keep the last ~40 turns, starting at a user message so tool pairs stay whole.
		if ( count( $out ) > 40 ) {
			$out = array_slice( $out, -40 );
			while ( $out && 'user' !== $out[0]['role'] ) {
				array_shift( $out );
			}
		}
		return $out;
	}

	/** Tool calls of the last assistant turn that have no answer yet. */
	private static function open_calls( array $messages ) {
		$answered = array();
		for ( $i = count( $messages ) - 1; $i >= 0; $i-- ) {
			$m = $messages[ $i ];
			if ( 'tool' === $m['role'] ) {
				$answered[ $m['tool_call_id'] ] = true;
				continue;
			}
			if ( 'assistant' === $m['role'] && ! empty( $m['tool_calls'] ) ) {
				return array_values( array_filter( $m['tool_calls'], function ( $c ) use ( $answered ) { return empty( $answered[ $c['id'] ] ); } ) );
			}
			return array();
		}
		return array();
	}

	private static function answer( $call, $result ) {
		$data = is_wp_error( $result ) ? array( 'error' => $result->get_error_message() ) : $result;
		$json = wp_json_encode( $data, JSON_UNESCAPED_UNICODE );
		return array( 'role' => 'tool', 'tool_call_id' => $call['id'], 'content' => mb_substr( (string) $json, 0, 14000 ) );
	}

	/**
	 * POST assistant {messages, approve: [call ids], reject: [call ids], auto: bool}
	 * → {messages, reply, pending: [{id, name, summary}], client: [actions], changed: [tool names], done: [summaries]}
	 */
	public static function chat( WP_REST_Request $r ) {
		if ( ! self::enabled() ) {
			return self::err( 'دستیار هوشمند فعال نیست. مدیر سایت باید در «پنل مربع ← تنظیمات» کلید سرویس هوش مصنوعی را وارد کند.', 503 );
		}
		$key = 'mp_ai_' . get_current_user_id();
		$n   = (int) get_transient( $key );
		if ( $n >= self::HOURLY ) {
			return self::err( 'در این ساعت درخواست زیادی به دستیار فرستاده شد؛ کمی بعد دوباره امتحان کنید.', 429 );
		}
		set_transient( $key, $n + 1, HOUR_IN_SECONDS );

		$messages = self::clean( $r['messages'] );
		$approve  = array_map( 'strval', (array) $r['approve'] );
		$reject   = array_map( 'strval', (array) $r['reject'] );
		$auto     = ! empty( $r['auto'] );
		$client   = array();
		$changed  = array();
		$done     = array();

		// Answer the calls that were waiting for the person's decision.
		foreach ( self::open_calls( $messages ) as $c ) {
			$args = json_decode( (string) $c['function']['arguments'], true );
			$args = is_array( $args ) ? $args : array();
			if ( in_array( $c['id'], $approve, true ) ) {
				$res = self::run( $c['function']['name'], $args, $client );
				if ( ! is_wp_error( $res ) ) {
					$changed[] = $c['function']['name'];
					$done[]    = self::summary( $c['function']['name'], $args );
				}
				$messages[] = self::answer( $c, $res );
			} else {
				$messages[] = self::answer( $c, self::err( in_array( $c['id'], $reject, true ) ? 'کاربر این کار را لغو کرد.' : 'انجام نشد.' ) );
			}
		}
		if ( ! $messages || 'user' === end( $messages )['role'] && '' === trim( end( $messages )['content'] ) ) {
			return self::err( 'چیزی بگویید یا بنویسید.' );
		}

		$system = array( 'role' => 'system', 'content' => self::system_prompt() );
		for ( $step = 0; $step < self::MAX_STEPS; $step++ ) {
			$msg = self::complete( array_merge( array( $system ), $messages ) );
			if ( is_wp_error( $msg ) ) {
				return $msg;
			}
			$messages[] = $msg;
			if ( empty( $msg['tool_calls'] ) ) {
				return array( 'messages' => $messages, 'reply' => $msg['content'], 'pending' => array(), 'client' => $client, 'changed' => array_values( array_unique( $changed ) ), 'done' => $done );
			}
			$pending = array();
			foreach ( $msg['tool_calls'] as $c ) {
				$name = $c['function']['name'];
				$args = json_decode( (string) $c['function']['arguments'], true );
				$args = is_array( $args ) ? $args : array();
				$kind = self::kind( $name );
				if ( 'write' === $kind && ! $auto ) {
					$pending[] = array( 'id' => $c['id'], 'name' => $name, 'summary' => self::summary( $name, $args ) );
					continue;
				}
				$res = $kind ? self::run( $name, $args, $client ) : self::err( 'این ابزار وجود ندارد.' );
				if ( 'write' === $kind && ! is_wp_error( $res ) ) {
					$changed[] = $name;
					$done[]    = self::summary( $name, $args );
				}
				$messages[] = self::answer( $c, $res );
			}
			if ( $pending ) {
				return array( 'messages' => $messages, 'reply' => $msg['content'], 'pending' => $pending, 'client' => $client, 'changed' => array_values( array_unique( $changed ) ), 'done' => $done );
			}
		}
		return array( 'messages' => $messages, 'reply' => 'کار طولانی شد؛ لطفاً درخواست را کوتاه‌تر یا مرحله‌به‌مرحله بگویید.', 'pending' => array(), 'client' => $client, 'changed' => array_values( array_unique( $changed ) ), 'done' => $done );
	}
}
