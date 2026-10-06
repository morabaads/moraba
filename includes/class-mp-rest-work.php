<?php
defined( 'ABSPATH' ) || exit;

/**
 * Second half of the API: files and avatars, task details (checklist, comments, seen, timer),
 * attendance, leave requests, the change history and notification tests.
 */
class MP_Rest_Work {

	public static function register() {
		$auth    = array( 'MP_Rest', 'can_access' );
		$manager = array( 'MP_Rest', 'can_manage' );
		$id      = '(?P<id>\d+)';
		$routes  = array(
			array( 'files', 'POST', 'upload', $auth ),
			array( "files/$id", 'DELETE', 'delete_file', $auth ),
			array( 'me/avatar', 'POST', 'upload_avatar', $auth ),
			array( 'me/avatar', 'DELETE', 'delete_avatar', $auth ),
			array( 'me/test-notify', 'POST', 'test_notify', $auth ),

			array( "tasks/$id/detail", 'GET', 'task_detail', $auth ),
			array( "tasks/$id/items", 'POST', 'add_item', $auth ),
			array( "task-items/$id", 'POST', 'update_item', $auth ),
			array( "task-items/$id", 'DELETE', 'delete_item', $auth ),
			array( "tasks/$id/comments", 'POST', 'add_comment', $auth ),
			array( "comments/$id", 'DELETE', 'delete_comment', $auth ),
			array( "tasks/$id/seen", 'POST', 'mark_seen', $auth ),
			array( "tasks/$id/timer", 'POST', 'timer', $auth ),

			array( 'attendance', 'GET', 'list_attendance', $auth ),
			array( 'attendance', 'POST', 'punch', $auth ),
			array( "attendance/$id", 'DELETE', 'delete_attendance', $manager ),

			array( 'leaves', 'GET', 'list_leaves', $auth ),
			array( 'leaves', 'POST', 'create_leave', $auth ),
			array( "leaves/$id", 'POST', 'decide_leave', $manager ),
			array( "leaves/$id", 'DELETE', 'cancel_leave', $auth ),

			array( 'audit', 'GET', 'audit', $manager ),

			array( 'push', 'GET', 'push_key', $auth ),
			array( 'push', 'POST', 'push_subscribe', $auth ),
			array( 'push', 'DELETE', 'push_unsubscribe', $auth ),
			array( "messages/$id/transcribe", 'POST', array( 'MP_Speech', 'transcribe' ), $auth ),
			array( "messages/$id/speech", 'POST', array( 'MP_Speech', 'speak' ), $auth ),
			array( 'speech/transcribe', 'POST', array( 'MP_Speech', 'transcribe_upload' ), $auth ),
		);
		foreach ( $routes as $r ) {
			register_rest_route(
				MP_Rest::NS,
				'/' . $r[0],
				array(
					'methods'             => $r[1],
					'callback'            => is_array( $r[2] ) ? $r[2] : array( __CLASS__, $r[2] ),
					'permission_callback' => $r[3],
				)
			);
		}
	}

	private static function err( $message, $status = 400 ) {
		return new WP_Error( 'mp_error', $message, array( 'status' => $status ) );
	}

	private static function t( $name ) {
		return MP_Install::table( $name );
	}

	private static function uid() {
		return get_current_user_id();
	}

	private static function name( $user_id ) {
		$u = get_userdata( $user_id );
		return $u ? $u->display_name : '';
	}

	/* ------------------------------------------------------------------ Files */

	public static function upload( WP_REST_Request $r ) {
		$context = MP_Util::pick( $r['context'], array( 'task', 'comment', 'message', 'ledger', 'client_item', 'client_logo' ), '' );
		$cid     = (int) $r['context_id'];
		if ( ! $context ) {
			return self::err( 'محل فایل معتبر نیست.' );
		}
		if ( 'task' === $context && ! MP_Rest::can_view_task_id( $cid ) ) {
			return self::err( 'تسک پیدا نشد.', 404 );
		}
		if ( 'message' === $context && ! MP_Rest::can_read_channel( $cid ) ) {
			return self::err( 'گفت‌وگو پیدا نشد.', 404 );
		}
		if ( 'client_logo' === $context && ! MP_Rest::can_read_channel( $cid ) ) {
			return self::err( 'گفت‌وگو پیدا نشد.', 404 );
		}
		if ( 'client_item' === $context && ! MP_Util::can_see_project( $cid ) ) {
			return self::err( 'پروژه پیدا نشد.', 404 );
		}
		// Comment and ledger files are attached (claimed) when the comment or entry is saved.
		$file = MP_Files::store( $context, in_array( $context, array( 'task', 'message', 'client_item', 'client_logo' ), true ) ? $cid : 0 );
		if ( is_wp_error( $file ) ) {
			return $file;
		}
		if ( 'message' === $context ) {
			// The message is sent separately with this file_id; keep context_id so the claim check passes.
			return MP_Files::payload( MP_Files::make_variants( $file ) );
		}
		if ( 'task' === $context ) {
			$task = MP_Rest::get_task( $cid );
			MP_Audit::log( 'file', 'task', $cid, 'پیوست «' . $file->name . '» به «' . $task->title . '»' );
		}
		return MP_Files::payload( $file );
	}

	public static function delete_file( WP_REST_Request $r ) {
		$file = MP_Files::get( (int) $r['id'] );
		if ( ! $file || ( (int) $file->user_id !== self::uid() && ! MP_Util::is_manager() ) ) {
			return self::err( 'فقط بارگذارکننده یا ناظر می‌تواند فایل را حذف کند.', 403 );
		}
		MP_Files::delete( $file->id );
		return array( 'deleted' => true );
	}

	public static function upload_avatar() {
		$file = MP_Files::store( 'avatar', self::uid(), true );
		if ( is_wp_error( $file ) ) {
			return $file;
		}
		// Profile photos are public images like any theme image: a plain file URL survives caching
		// plugins and compression that can break the PHP-served private files on some hosts.
		$exts = array( 'image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp', 'image/gif' => 'gif' );
		if ( ! isset( $exts[ $file->mime ] ) ) {
			MP_Files::delete( $file->id );
			return self::err( 'فقط عکس JPG، PNG، WebP یا GIF.' );
		}
		$name = self::uid() . '-' . strtolower( wp_generate_password( 12, false ) ) . '.' . $exts[ $file->mime ];
		$ok   = copy( MP_Files::dir() . '/' . $file->path, MP_Util::avatar_dir() . '/' . $name );
		MP_Files::delete( $file->id );
		if ( ! $ok ) {
			return self::err( 'ذخیره عکس انجام نشد؛ پوشه uploads قابل نوشتن نیست.', 500 );
		}
		self::remove_avatar();
		update_user_meta( self::uid(), 'mp_avatar_public', $name );
		return MP_Util::user_payload( self::uid() );
	}

	private static function remove_avatar() {
		$old = (int) get_user_meta( self::uid(), 'mp_avatar_file', true );
		if ( $old ) {
			MP_Files::delete( $old );
		}
		delete_user_meta( self::uid(), 'mp_avatar_file' );
		$pub = basename( (string) get_user_meta( self::uid(), 'mp_avatar_public', true ) );
		if ( $pub && is_file( MP_Util::avatar_dir() . '/' . $pub ) ) {
			wp_delete_file( MP_Util::avatar_dir() . '/' . $pub );
		}
		delete_user_meta( self::uid(), 'mp_avatar_public' );
	}

	public static function delete_avatar() {
		self::remove_avatar();
		return MP_Util::user_payload( self::uid() );
	}

	public static function test_notify() {
		$sent = MP_Notify::external( self::uid(), 'پیام آزمایشی پنل مربع', 'اعلان‌های شما به این کانال می‌رسد.', true );
		return $sent ? array( 'channels' => $sent ) : self::err( 'هیچ کانالی تنظیم نشده است؛ شناسه تلگرام/بله یا شماره موبایل را وارد کنید و مطمئن شوید ناظر سایت توکن‌ها را تنظیم کرده است.' );
	}

	/* ------------------------------------------------------------------ Task details */

	private static function task_or_error( $id ) {
		$task = MP_Rest::get_task( (int) $id );
		if ( ! $task || ! MP_Rest::can_view_task( $task ) ) {
			return self::err( 'تسک پیدا نشد.', 404 );
		}
		return $task;
	}

	private static function can_report( $task ) {
		return (int) $task->user_id === self::uid() || MP_Util::is_manager();
	}

	public static function task_detail( WP_REST_Request $r ) {
		global $wpdb;
		$task = self::task_or_error( $r['id'] );
		if ( is_wp_error( $task ) ) {
			return $task;
		}
		$items = array();
		foreach ( $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'task_items' ) . ' WHERE task_id = %d ORDER BY sort, id', $task->id ) ) as $i ) {
			$items[] = array( 'id' => (int) $i->id, 'text' => $i->text, 'done' => (bool) $i->done );
		}
		$comments = array();
		foreach ( $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'task_comments' ) . ' WHERE task_id = %d ORDER BY id', $task->id ) ) as $c ) {
			$comments[] = array(
				'id'         => (int) $c->id,
				'user_id'    => (int) $c->user_id,
				'author'     => self::name( $c->user_id ),
				'avatar'     => MP_Util::avatar_url( $c->user_id ),
				'body'       => $c->body,
				'file'       => $c->file_id ? MP_Files::payload( MP_Files::get( $c->file_id ) ) : null,
				'mine'       => (int) $c->user_id === self::uid(),
				'can_delete' => (int) $c->user_id === self::uid() || MP_Util::is_manager(),
				'created_at' => $c->created_at,
			);
		}
		$files = array();
		foreach ( $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'files' ) . " WHERE context = 'task' AND context_id = %d ORDER BY id", $task->id ) ) as $f ) {
			$p               = MP_Files::payload( $f );
			$p['author']     = self::name( $f->user_id );
			$p['can_delete'] = (int) $f->user_id === self::uid() || MP_Util::is_manager();
			$files[]         = $p;
		}
		$series = 0;
		if ( 'none' !== $task->recurrence ) {
			$parent = $task->recur_parent ? (int) $task->recur_parent : (int) $task->id;
			$series = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM ' . self::t( 'tasks' ) . ' WHERE (id = %d OR recur_parent = %d) AND user_id = %d AND task_date >= %s', $parent, $parent, $task->user_id, $task->task_date ) );
		}
		return array(
			'task'         => MP_Rest::task_payload( $task ),
			'items'        => $items,
			'comments'     => $comments,
			'attachments'  => $files,
			'series_ahead' => $series,
			'can_items'    => MP_Rest::can_edit_task( $task ),
			'can_report'   => self::can_report( $task ),
		);
	}

	public static function add_item( WP_REST_Request $r ) {
		global $wpdb;
		$task = self::task_or_error( $r['id'] );
		if ( is_wp_error( $task ) ) {
			return $task;
		}
		if ( ! MP_Rest::can_edit_task( $task ) ) {
			return self::err( 'چک‌لیست این تسک را ناظر تعیین کرده است.', 403 );
		}
		$text = MP_Util::text( $r['text'], 200 );
		if ( '' === $text ) {
			return self::err( 'متن مورد را بنویسید.' );
		}
		$sort = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM ' . self::t( 'task_items' ) . ' WHERE task_id = %d', $task->id ) );
		$wpdb->insert( self::t( 'task_items' ), array( 'task_id' => $task->id, 'text' => $text, 'done' => 0, 'sort' => $sort ) );
		return self::task_detail( $r );
	}

	private static function item_and_task( $id ) {
		global $wpdb;
		$item = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'task_items' ) . ' WHERE id = %d', $id ) );
		if ( ! $item ) {
			return self::err( 'مورد پیدا نشد.', 404 );
		}
		$task = self::task_or_error( $item->task_id );
		return is_wp_error( $task ) ? $task : array( $item, $task );
	}

	public static function update_item( WP_REST_Request $r ) {
		global $wpdb;
		$pair = self::item_and_task( (int) $r['id'] );
		if ( is_wp_error( $pair ) ) {
			return $pair;
		}
		list( $item, $task ) = $pair;
		$f                   = array();
		if ( null !== $r['done'] ) {
			if ( ! self::can_report( $task ) ) {
				return self::err( 'فقط مسئول تسک می‌تواند موارد را تیک بزند.', 403 );
			}
			$f['done'] = $r['done'] ? 1 : 0;
		}
		if ( null !== $r['text'] ) {
			if ( ! MP_Rest::can_edit_task( $task ) ) {
				return self::err( 'این چک‌لیست قابل ویرایش نیست.', 403 );
			}
			$f['text'] = MP_Util::text( $r['text'], 200 );
		}
		if ( $f ) {
			$wpdb->update( self::t( 'task_items' ), $f, array( 'id' => $item->id ) );
		}
		$r->set_param( 'id', $task->id );
		return self::task_detail( $r );
	}

	public static function delete_item( WP_REST_Request $r ) {
		global $wpdb;
		$pair = self::item_and_task( (int) $r['id'] );
		if ( is_wp_error( $pair ) ) {
			return $pair;
		}
		list( $item, $task ) = $pair;
		if ( ! MP_Rest::can_edit_task( $task ) ) {
			return self::err( 'این چک‌لیست قابل ویرایش نیست.', 403 );
		}
		$wpdb->delete( self::t( 'task_items' ), array( 'id' => $item->id ) );
		$r->set_param( 'id', $task->id );
		return self::task_detail( $r );
	}

	public static function add_comment( WP_REST_Request $r ) {
		global $wpdb;
		$task = self::task_or_error( $r['id'] );
		if ( is_wp_error( $task ) ) {
			return $task;
		}
		$body = MP_Util::long_text( $r['body'], 3000 );
		if ( '' === trim( $body ) && ! (int) $r['file_id'] ) {
			return self::err( 'متن نظر را بنویسید.' );
		}
		$wpdb->insert( self::t( 'task_comments' ), array( 'task_id' => $task->id, 'user_id' => self::uid(), 'body' => $body, 'created_at' => MP_Util::now() ) );
		$cid = (int) $wpdb->insert_id;
		if ( (int) $r['file_id'] ) {
			$wpdb->update( self::t( 'task_comments' ), array( 'file_id' => MP_Files::claim( (int) $r['file_id'], 'comment', $cid ) ), array( 'id' => $cid ) );
		}
		// Notify the other side of the conversation: the owner, or whoever assigned it (managers when self-made).
		$targets = array( (int) $task->user_id );
		if ( $task->assigned_by ) {
			$targets[] = (int) $task->assigned_by;
		}
		foreach ( $wpdb->get_col( $wpdb->prepare( 'SELECT DISTINCT user_id FROM ' . self::t( 'task_comments' ) . ' WHERE task_id = %d', $task->id ) ) as $u ) {
			$targets[] = (int) $u;
		}
		foreach ( array_unique( $targets ) as $target ) {
			if ( $target && $target !== self::uid() ) {
				MP_Notify::event( 'task_comment', $target, array( 'ACTOR' => wp_get_current_user()->display_name, 'TASK' => $task->title, 'PREVIEW' => wp_trim_words( '' !== $body ? $body : 'فایل', 14 ) ), 'task', $task->id );
			}
		}
		return self::task_detail( $r );
	}

	public static function delete_comment( WP_REST_Request $r ) {
		global $wpdb;
		$c = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'task_comments' ) . ' WHERE id = %d', (int) $r['id'] ) );
		if ( ! $c || ( (int) $c->user_id !== self::uid() && ! MP_Util::is_manager() ) ) {
			return self::err( 'فقط نویسنده یا ناظر می‌تواند نظر را حذف کند.', 403 );
		}
		if ( $c->file_id ) {
			MP_Files::delete( $c->file_id );
		}
		$wpdb->delete( self::t( 'task_comments' ), array( 'id' => $c->id ) );
		$r->set_param( 'id', $c->task_id );
		return self::task_detail( $r );
	}

	/** "I've seen it": the owner acknowledges a task a manager assigned. */
	public static function mark_seen( WP_REST_Request $r ) {
		global $wpdb;
		$task = self::task_or_error( $r['id'] );
		if ( is_wp_error( $task ) ) {
			return $task;
		}
		if ( (int) $task->user_id !== self::uid() ) {
			return self::err( 'فقط مسئول تسک می‌تواند دریافت آن را تأیید کند.', 403 );
		}
		if ( ! $task->seen_at ) {
			$wpdb->update( self::t( 'tasks' ), array( 'seen_at' => MP_Util::now() ), array( 'id' => $task->id ) );
			if ( $task->assigned_by && (int) $task->assigned_by !== self::uid() ) {
				MP_Notify::event( 'task_seen', $task->assigned_by, array( 'ACTOR' => wp_get_current_user()->display_name, 'TASK' => $task->title ), 'task', $task->id );
			}
		}
		return MP_Rest::task_payload( MP_Rest::get_task( $task->id ) );
	}

	public static function timer( WP_REST_Request $r ) {
		global $wpdb;
		$task = self::task_or_error( $r['id'] );
		if ( is_wp_error( $task ) ) {
			return $task;
		}
		if ( (int) $task->user_id !== self::uid() ) {
			return self::err( 'فقط مسئول تسک می‌تواند زمان آن را ثبت کند.', 403 );
		}
		$now = current_time( 'timestamp' ); // phpcs:ignore WordPress.DateTime.CurrentTimeTimestamp
		if ( 'start' === $r['action'] && ! $task->timer_started ) {
			// Only one running timer per person: stop any other.
			foreach ( $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'tasks' ) . ' WHERE user_id = %d AND timer_started IS NOT NULL', self::uid() ) ) as $other ) {
				$wpdb->update( self::t( 'tasks' ), array( 'time_spent' => (int) $other->time_spent + max( 0, $now - strtotime( $other->timer_started ) ), 'timer_started' => null ), array( 'id' => $other->id ) );
				MP_Costs::log( $other, $now - strtotime( $other->timer_started ) );
			}
			$wpdb->update( self::t( 'tasks' ), array( 'timer_started' => MP_Util::now(), 'status' => 'done' === $task->status ? 'done' : 'doing' ), array( 'id' => $task->id ) );
		} elseif ( 'stop' === $r['action'] && $task->timer_started ) {
			$wpdb->update( self::t( 'tasks' ), array( 'time_spent' => (int) $task->time_spent + max( 0, $now - strtotime( $task->timer_started ) ), 'timer_started' => null ), array( 'id' => $task->id ) );
			MP_Costs::log( $task, $now - strtotime( $task->timer_started ) );
		} elseif ( 'reset' === $r['action'] ) {
			$wpdb->update( self::t( 'tasks' ), array( 'time_spent' => 0, 'timer_started' => null ), array( 'id' => $task->id ) );
			$wpdb->delete( MP_Install::table( 'timelog' ), array( 'task_id' => $task->id, 'user_id' => $task->user_id ) );
		}
		return MP_Rest::task_payload( MP_Rest::get_task( $task->id ) );
	}

	/* ------------------------------------------------------------------ Attendance */

	/** A stored local time as a real Unix timestamp (through the site's time zone, whatever PHP's own is set to). */
	private static function ts( $local ) {
		$d = date_create( $local, wp_timezone() );
		return $d ? $d->getTimestamp() : 0;
	}

	private static function session_payload( $s ) {
		$start = self::ts( $s->check_in );
		$end   = $s->check_out ? self::ts( $s->check_out ) : time();
		return array(
			'started'   => $start,
			'id'        => (int) $s->id,
			'user_id'   => (int) $s->user_id,
			'date'      => $s->work_date,
			'check_in'  => substr( $s->check_in, 11, 5 ),
			'check_out' => $s->check_out ? substr( $s->check_out, 11, 5 ) : '',
			'open'      => ! $s->check_out,
			'seconds'   => max( 0, $end - $start ),
			'note'      => $s->note,
		);
	}

	public static function list_attendance( WP_REST_Request $r ) {
		global $wpdb;
		$user = self::uid();
		if ( 'all' === $r['user_id'] || ( (int) $r['user_id'] && (int) $r['user_id'] !== self::uid() ) ) {
			if ( ! MP_Util::is_manager() ) {
				return self::err( 'فقط ناظر حضور دیگران را می‌بیند.', 403 );
			}
			$user = 'all' === $r['user_id'] ? 0 : (int) $r['user_id'];
		}
		$from = MP_Util::valid_date( $r['from'] ) ? $r['from'] : MP_Util::add_days( MP_Util::today(), -30 );
		$to   = MP_Util::valid_date( $r['to'] ) ? $r['to'] : MP_Util::today();
		$sql  = 'SELECT * FROM ' . self::t( 'attendance' ) . ' WHERE work_date BETWEEN %s AND %s' . ( $user ? ' AND user_id = %d' : '' ) . ' ORDER BY work_date DESC, check_in DESC';
		$rows = $wpdb->get_results( $user ? $wpdb->prepare( $sql, $from, $to, $user ) : $wpdb->prepare( $sql, $from, $to ) );
		$open = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'attendance' ) . ' WHERE user_id = %d AND check_out IS NULL ORDER BY id DESC LIMIT 1', self::uid() ) );
		// Today's finished sessions; the open one counts in full even when it began before midnight.
		$closed = 0;
		foreach ( $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'attendance' ) . ' WHERE user_id = %d AND work_date = %s AND check_out IS NOT NULL', self::uid(), MP_Util::today() ) ) as $s ) {
			$closed += self::session_payload( $s )['seconds'];
		}
		$op = $open ? self::session_payload( $open ) : null;
		return array(
			'sessions' => array_map( array( __CLASS__, 'session_payload' ), $rows ),
			'open'     => $op,
			'closed'   => $closed,
			'today'    => $closed + ( $op ? $op['seconds'] : 0 ),
			'now'      => time(),
		);
	}

	public static function punch( WP_REST_Request $r ) {
		global $wpdb;
		$uid  = self::uid();
		$open = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'attendance' ) . ' WHERE user_id = %d AND check_out IS NULL ORDER BY id DESC LIMIT 1', $uid ) );
		$note = MP_Util::text( $r['note'], 200 );
		if ( 'in' === $r['action'] ) {
			if ( $open ) {
				return self::err( 'ورود شما از ساعت ' . MP_Jalali::digits( substr( $open->check_in, 11, 5 ) ) . ' ثبت شده است.' );
			}
			$wpdb->insert( self::t( 'attendance' ), array( 'user_id' => $uid, 'work_date' => MP_Util::today(), 'check_in' => MP_Util::now(), 'note' => $note ) );
			MP_Audit::log( 'in', 'attendance', $wpdb->insert_id, 'ورود ' . MP_Jalali::digits( current_time( 'H:i' ) ) );
		} elseif ( 'out' === $r['action'] ) {
			if ( ! $open ) {
				return self::err( 'ورودی ثبت نشده است.' );
			}
			$wpdb->update( self::t( 'attendance' ), array( 'check_out' => MP_Util::now(), 'note' => '' !== $note ? $note : $open->note ), array( 'id' => $open->id ) );
			MP_Audit::log( 'out', 'attendance', $open->id, 'خروج ' . MP_Jalali::digits( current_time( 'H:i' ) ) );
		} else {
			return self::err( 'عملیات معتبر نیست.' );
		}
		return self::list_attendance( new WP_REST_Request( 'GET' ) );
	}

	public static function delete_attendance( WP_REST_Request $r ) {
		global $wpdb;
		$s = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'attendance' ) . ' WHERE id = %d', (int) $r['id'] ) );
		if ( ! $s ) {
			return self::err( 'ردیف پیدا نشد.', 404 );
		}
		$wpdb->delete( self::t( 'attendance' ), array( 'id' => $s->id ) );
		MP_Audit::log( 'delete', 'attendance', $s->id, 'حذف حضور ' . self::name( $s->user_id ) . ' در ' . MP_Jalali::format( $s->work_date ) );
		return array( 'deleted' => true );
	}

	/* ------------------------------------------------------------------ Leaves */

	const LEAVE_STATUS = array( 'pending' => 'در انتظار', 'approved' => 'تأیید شده', 'rejected' => 'رد شده' );

	private static function leave_payload( $l ) {
		return array(
			'id'          => (int) $l->id,
			'user_id'     => (int) $l->user_id,
			'user'        => self::name( $l->user_id ),
			'kind'        => $l->kind,
			'start'       => $l->start_date,
			'end'         => $l->end_date,
			'from_time'   => $l->from_time,
			'to_time'     => $l->to_time,
			'reason'      => $l->reason,
			'status'      => $l->status,
			'reviewer'    => $l->reviewed_by ? self::name( $l->reviewed_by ) : '',
			'review_note' => $l->review_note,
			'created_at'  => $l->created_at,
			'can_cancel'  => (int) $l->user_id === self::uid() && 'pending' === $l->status,
		);
	}

	public static function list_leaves( WP_REST_Request $r ) {
		global $wpdb;
		$where = array( '1=1' );
		$args  = array();
		if ( ! MP_Util::is_manager() || 'mine' === $r['scope'] ) {
			$where[] = 'user_id = %d';
			$args[]  = self::uid();
		}
		if ( 'pending' === $r['scope'] ) {
			$where[] = "status = 'pending'";
		}
		if ( MP_Util::valid_date( $r['from'] ) && MP_Util::valid_date( $r['to'] ) ) {
			$where[] = 'end_date >= %s AND start_date <= %s';
			$args[]  = $r['from'];
			$args[]  = $r['to'];
		}
		$sql  = 'SELECT * FROM ' . self::t( 'leaves' ) . ' WHERE ' . implode( ' AND ', $where ) . ' ORDER BY start_date DESC, id DESC LIMIT 300';
		$rows = $args ? $wpdb->get_results( $wpdb->prepare( $sql, $args ) ) : $wpdb->get_results( $sql );
		return array_map( array( __CLASS__, 'leave_payload' ), $rows );
	}

	public static function create_leave( WP_REST_Request $r ) {
		global $wpdb;
		$kind  = MP_Util::pick( $r['kind'], array( 'daily', 'hourly' ), 'daily' );
		$start = (string) $r['start'];
		$end   = 'hourly' === $kind ? $start : (string) $r['end'];
		if ( ! MP_Util::valid_date( $start ) || ! MP_Util::valid_date( $end ) || $end < $start ) {
			return self::err( 'تاریخ مرخصی معتبر نیست؛ پایان باید بعد از شروع باشد.' );
		}
		$from = (string) $r['from_time'];
		$to   = (string) $r['to_time'];
		if ( 'hourly' === $kind && ( ! MP_Util::valid_time( $from ) || ! MP_Util::valid_time( $to ) || '' === $from || $to <= $from ) ) {
			return self::err( 'ساعت شروع و پایان مرخصی ساعتی را درست وارد کنید.' );
		}
		$wpdb->insert(
			self::t( 'leaves' ),
			array(
				'user_id'    => self::uid(),
				'kind'       => $kind,
				'start_date' => $start,
				'end_date'   => $end,
				'from_time'  => 'hourly' === $kind ? $from : '',
				'to_time'    => 'hourly' === $kind ? $to : '',
				'reason'     => MP_Util::text( $r['reason'], 500 ),
				'status'     => 'pending',
				'created_at' => MP_Util::now(),
			)
		);
		$id   = (int) $wpdb->insert_id;
		$when = 'hourly' === $kind ? MP_Jalali::format( $start ) . ' ساعت ' . MP_Jalali::digits( $from . '–' . $to ) : MP_Jalali::format( $start ) . ( $end !== $start ? ' تا ' . MP_Jalali::format( $end ) : '' );
		MP_Audit::log( 'create', 'leave', $id, 'درخواست مرخصی ' . $when );
		foreach ( MP_Util::panel_users() as $u ) {
			if ( $u !== self::uid() && MP_Util::is_manager( $u ) ) {
				MP_Notify::event( 'leave_request', $u, array( 'ACTOR' => wp_get_current_user()->display_name, 'WHEN' => $when ), 'attendance', $id, MP_Rest::wants_email( $u ) );
			}
		}
		return self::list_leaves( new WP_REST_Request( 'GET' ) );
	}

	public static function decide_leave( WP_REST_Request $r ) {
		global $wpdb;
		$l = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'leaves' ) . ' WHERE id = %d', (int) $r['id'] ) );
		if ( ! $l ) {
			return self::err( 'درخواست پیدا نشد.', 404 );
		}
		if ( (int) $l->user_id === self::uid() && ! current_user_can( 'manage_options' ) ) {
			return self::err( 'درخواست مرخصی خودتان را ناظر دیگری باید بررسی کند.', 403 );
		}
		$status = MP_Util::pick( $r['status'], array( 'approved', 'rejected' ), '' );
		if ( ! $status ) {
			return self::err( 'تصمیم معتبر نیست.' );
		}
		$note = MP_Util::text( $r['note'], 300 );
		$wpdb->update( self::t( 'leaves' ), array( 'status' => $status, 'reviewed_by' => self::uid(), 'review_note' => $note, 'reviewed_at' => MP_Util::now() ), array( 'id' => $l->id ) );
		$label = self::LEAVE_STATUS[ $status ];
		MP_Audit::log( $status, 'leave', $l->id, 'مرخصی ' . self::name( $l->user_id ) . ' (' . MP_Jalali::format( $l->start_date ) . '): ' . $label );
		MP_Notify::event( 'leave_decision', $l->user_id, array( 'STATUS' => $label, 'DATE' => MP_Jalali::format( $l->start_date ), 'NOTE' => $note ), 'attendance', $l->id, MP_Rest::wants_email( $l->user_id ) );
		$r2 = new WP_REST_Request( 'GET' );
		$r2->set_param( 'scope', $r['scope'] );
		return self::list_leaves( $r2 );
	}

	public static function cancel_leave( WP_REST_Request $r ) {
		global $wpdb;
		$l = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'leaves' ) . ' WHERE id = %d', (int) $r['id'] ) );
		if ( ! $l || (int) $l->user_id !== self::uid() || 'pending' !== $l->status ) {
			return self::err( 'فقط درخواست در انتظار خودتان را می‌توانید لغو کنید.', 403 );
		}
		$wpdb->delete( self::t( 'leaves' ), array( 'id' => $l->id ) );
		MP_Audit::log( 'delete', 'leave', $l->id, 'لغو درخواست مرخصی ' . MP_Jalali::format( $l->start_date ) );
		return self::list_leaves( new WP_REST_Request( 'GET' ) );
	}

	/* ------------------------------------------------------------------ Push devices */

	public static function push_key() {
		if ( ! MP_Push::supported() ) {
			return array( 'supported' => false );
		}
		list( , $pub ) = MP_Push::keys();
		return array( 'supported' => (bool) $pub, 'key' => $pub, 'devices' => count( MP_Push::devices( self::uid() ) ) );
	}

	public static function push_subscribe( WP_REST_Request $r ) {
		if ( ! MP_Push::valid_endpoint( $r['endpoint'] ) ) {
			return self::err( 'نشانی اعلان معتبر نیست.' );
		}
		MP_Push::subscribe( self::uid(), (string) $r['endpoint'] );
		return array( 'devices' => count( MP_Push::devices( self::uid() ) ) );
	}

	public static function push_unsubscribe( WP_REST_Request $r ) {
		MP_Push::unsubscribe( self::uid(), (string) $r['endpoint'] );
		return array( 'devices' => count( MP_Push::devices( self::uid() ) ) );
	}

	/* ------------------------------------------------------------------ Change history */

	public static function audit( WP_REST_Request $r ) {
		return MP_Audit::query( (string) $r['type'], (int) $r['user_id'], max( 1, (int) $r['page'] ) );
	}
}
